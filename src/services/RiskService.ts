import Anthropic from '@anthropic-ai/sdk';

export interface TokenMetrics {
    multiplier: number;
    priceChange24h: number;
    volume24h: number;
    holdersCount: number;
    buyPressure: number;
    sellPressure: number;
}

export class RiskService {
    private anthropic: Anthropic | null = null;
    constructor(apiKey?: string) {
        if (apiKey) this.anthropic = new Anthropic({ apiKey });
    }

    async analyzeRisk(metrics: TokenMetrics, position: any): Promise<{ action: string, reason: string, confidence: number }> {
        if (this.anthropic) {
            try {
                return await this.analyzeWithClaude(metrics, position);
            } catch (e) {
                return this.analyzeLocally(metrics, position);
            }
        }
        return this.analyzeLocally(metrics, position);
    }

    private async analyzeWithClaude(metrics: TokenMetrics, position: any): Promise<any> {
        const prompt = `Analyze Solana token: Multiplier ${metrics.multiplier}x, Vol $${metrics.volume24h}. Position open for ${Date.now() - position.created_at}ms. Action: HOLD, PARTIAL_EXIT, FULL_EXIT?`;
        const response = await this.anthropic!.messages.create({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 150,
            messages: [{ role: 'user', content: prompt }]
        });
        const content = response.content[0].type === 'text' ? response.content[0].text : '{"action":"HOLD"}';
        return JSON.parse(content);
    }

    private analyzeLocally(metrics: TokenMetrics, position: any): any {
        if (metrics.multiplier <= 0.34) return { action: "FULL_EXIT", reason: "Hard Stop Loss" };
        if (metrics.multiplier >= 2.0 && !position.partialTPTaken) return { action: "PARTIAL_EXIT", reason: "Take Profit 2x" };
        return { action: "HOLD", reason: "Stable" };
    }

    calculateTrailingStop(highestPrice: number, currentPrice: number, multiplier: number, entryPrice: number): any {
        const stopLoss = entryPrice * 0.34;
        if (currentPrice <= stopLoss) return { action: "FULL_EXIT", reason: "Stop Loss" };

        let tsPercentage = 20;
        if (multiplier > 10) tsPercentage = Math.min(30 + (multiplier - 10) * 2, 50);

        const tsPrice = highestPrice * (1 - tsPercentage / 100);
        if (currentPrice <= tsPrice) return { action: "FULL_EXIT", reason: "Trailing Stop" };

        return { action: "HOLD" };
    }
}
