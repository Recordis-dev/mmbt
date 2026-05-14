import { createClient, RedisClientType } from 'redis';

export class RedisService {
    private client: RedisClientType;
    constructor(url: string) {
        this.client = createClient({ url });
    }
    async connect() {
        if (!this.client.isOpen) await this.client.connect();
    }
    async isTokenProcessed(tokenAddress: string): Promise<boolean> {
        const key = `trench:token:${tokenAddress}`;
        const exists = await this.client.exists(key);
        return exists === 1;
    }
    async markTokenProcessed(tokenAddress: string, ttl: number = 86400) {
        await this.client.set(`trench:token:${tokenAddress}`, '1', { EX: ttl });
    }
    async isCircuitBreakerActive(): Promise<boolean> {
        return (await this.client.get('trench:circuit_breaker')) === 'true';
    }
    async getOpenPositionsCount(): Promise<number> {
        const count = await this.client.get('trench:open_positions');
        return count ? parseInt(count) : 0;
    }
    async incrementOpenPositions() { await this.client.incr('trench:open_positions'); }
}
