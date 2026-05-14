import { Connection, Keypair, VersionedTransaction, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';

export class SolanaService {
    private connection: Connection;
    private wallet: Keypair;
    private jitoTipAccounts = [
        '96g9sRestpB3P4CuqBtCRNc89SodRMc378r3eQ3qfS9',
        'ADuXpYpY6Et9ncB96DWR79S1mkg7S1j8xatGz8D3S2tK',
        'Cw8CFNRvS96U3Y66vY9FvGq8y7mzXq9W3y6Qy9jX8V1k',
        'DttWaMuVvS6S8V9838ZfWzYm5jS9R8J7m5QzYm9X8V1k',
        'DfXygSm4jS8V9838ZfWzYm5jS9R8J7m5QzYm9X8V1k',
        'ADaUMS9V9838ZfWzYm5jS9R8J7m5QzYm9X8V1k',
        '3AVi9S9V9838ZfWzYm5jS9R8J7m5QzYm9X8V1k',
        'HFqU5S9V9838ZfWzYm5jS9R8J7m5QzYm9X8V1k'
    ];

    constructor(rpcUrl: string, privateKey: string) {
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    }

    async getJupiterQuote(inputMint: string, outputMint: string, amount: number) {
        const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=1500`;
        const response = await axios.get(url);
        return response.data;
    }

    async getJupiterSwapTransaction(quoteResponse: any, userPublicKey: string) {
        const response = await axios.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 0
        });
        return response.data.swapTransaction;
    }

    async sendJitoBundle(swapTransactionBase64: string, tipAmountLamports: number) {
        const swapTransaction = VersionedTransaction.deserialize(Buffer.from(swapTransactionBase64, 'base64'));
        swapTransaction.sign([this.wallet]);

        // Create Tip Transaction
        const tipAccount = new PublicKey(this.jitoTipAccounts[Math.floor(Math.random() * this.jitoTipAccounts.length)]);
        const { blockhash } = await this.connection.getLatestBlockhash();

        const tipTransaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: this.wallet.publicKey,
                toPubkey: tipAccount,
                lamports: tipAmountLamports,
            })
        );
        tipTransaction.recentBlockhash = blockhash;
        tipTransaction.feePayer = this.wallet.publicKey;
        tipTransaction.sign(this.wallet);

        const payload = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [
                [
                    bs58.encode(swapTransaction.serialize()),
                    bs58.encode(tipTransaction.serialize())
                ]
            ]
        };

        const response = await axios.post('https://mainnet.block-engine.jito.wtf/api/v1/bundles', payload);
        return response.data;
    }

    async getTokenPrice(mintAddress: string): Promise<number> {
        // Fallback simple price fetcher
        try {
            const url = `https://api.jup.ag/price/v2?ids=${mintAddress}`;
            const response = await axios.get(url);
            return parseFloat(response.data.data[mintAddress].price);
        } catch (e) {
            return 0;
        }
    }
}
