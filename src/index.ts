import { Pool } from 'pg';
import { SolanaService } from './services/SolanaService.js';
import { SecurityService } from './services/SecurityService.js';
import { RiskService } from './services/RiskService.js';
import { RedisService } from './services/RedisService.js';
import dotenv from 'dotenv';

dotenv.config();

export class TrenchPredator {
    private db: Pool;
    private solana: SolanaService;
    private security: SecurityService;
    private risk: RiskService;
    private redis: RedisService;

    constructor() {
        this.db = new Pool({ connectionString: process.env.POSTGRES_URL });
        this.solana = new SolanaService(process.env.SOLANA_RPC_URL!, process.env.SOLANA_PRIVATE_KEY!);
        this.security = new SecurityService(process.env.RUGCHECK_API_KEY, process.env.SOLSNIFFER_API_KEY);
        this.risk = new RiskService(process.env.CLAUDE_API_KEY);
        this.redis = new RedisService(process.env.REDIS_URL!);
    }

    async processSignal(tokenAddress: string, source: string, rawMessage: string) {
        await this.redis.connect();
        if (await this.redis.isTokenProcessed(tokenAddress)) return { status: 'duplicate' };
        if (await this.redis.isCircuitBreakerActive()) return { status: 'circuit_breaker' };

        const securityReport = await this.security.checkToken(tokenAddress);

        // Log Signal
        await this.db.query(
            'INSERT INTO signals (token_address, source_channel, status, security_scores, raw_message) VALUES ($1, $2, $3, $4, $5)',
            [tokenAddress, source, securityReport.safe ? 'approved' : 'rejected', JSON.stringify(securityReport.reports), rawMessage]
        );

        if (!securityReport.safe) {
            await this.redis.markTokenProcessed(tokenAddress);
            return { status: 'rejected' };
        }

        try {
            const entryAmount = 0.25 * 1e9;
            const quote = await this.solana.getJupiterQuote('So11111111111111111111111111111111111111112', tokenAddress, entryAmount);
            const swapTx = await this.solana.getJupiterSwapTransaction(quote, process.env.SOLANA_WALLET_PUBLIC_KEY!);
            const bundleResult = await this.solana.sendJitoBundle(swapTx, 0.001 * 1e9);

            await this.redis.markTokenProcessed(tokenAddress);
            await this.redis.incrementOpenPositions();

            const entryPrice = parseFloat(quote.outAmount) / parseFloat(quote.inAmount);
            await this.db.query(
                'INSERT INTO positions (token_address, entry_price, entry_amount_sol, entry_tx_hash, status) VALUES ($1, $2, $3, $4, $5)',
                [tokenAddress, entryPrice, 0.25, bundleResult.bundleId || 'pending', 'open']
            );

            return { status: 'bought', txHash: bundleResult.bundleId };
        } catch (e) {
            return { status: 'failed' };
        }
    }

    async monitorPositions() {
        const result = await this.db.query("SELECT * FROM positions WHERE status = 'open'");
        for (const pos of result.rows) {
            const currentPrice = await this.solana.getTokenPrice(pos.token_address);
            const multiplier = currentPrice / pos.entry_price;

            const decision = this.risk.calculateTrailingStop(pos.highest_price || pos.entry_price, currentPrice, multiplier, pos.entry_price);

            if (decision.action === 'FULL_EXIT') {
                // Execute Exit
                const quote = await this.solana.getJupiterQuote(pos.token_address, 'So11111111111111111111111111111111111111112', 100); // Should use actual balance
                const swapTx = await this.solana.getJupiterSwapTransaction(quote, process.env.SOLANA_WALLET_PUBLIC_KEY!);
                await this.solana.sendJitoBundle(swapTx, 0.001 * 1e9);

                await this.db.query('UPDATE positions SET status = $1, closed_at = NOW() WHERE id = $2', ['closed', pos.id]);
            } else if (currentPrice > (pos.highest_price || 0)) {
                await this.db.query('UPDATE positions SET highest_price = $1 WHERE id = $2', [currentPrice, pos.id]);
            }
        }
    }
}
