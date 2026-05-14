import axios from 'axios';

export interface SecurityReport {
    source: string;
    safe: boolean;
    score?: number;
    risks: string[];
}

export class SecurityService {
    constructor(
        private rugCheckApiKey?: string,
        private solSnifferApiKey?: string
    ) {}

    async checkToken(tokenAddress: string): Promise<{ safe: boolean, reports: SecurityReport[] }> {
        const results = await Promise.allSettled([
            this.checkRugCheck(tokenAddress),
            this.checkGoPlus(tokenAddress),
            this.checkSolSniffer(tokenAddress)
        ]);

        const reports: SecurityReport[] = results
            .filter((r): r is PromiseFulfilledResult<SecurityReport> => r.status === 'fulfilled')
            .map(r => r.value);

        if (reports.length < 2) return { safe: false, reports };

        const isSafe = reports.every(r => r.safe);
        return { safe: isSafe, reports };
    }

    private async checkRugCheck(tokenAddress: string): Promise<SecurityReport> {
        const url = `https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`;
        const response = await axios.get(url, { timeout: 1000 });
        const data = response.data;
        const risks = data.risks ? data.risks.map((r: any) => r.name) : [];
        const score = data.score || 0;
        const isSafe = score < 500 && (data.markets?.some((m: any) => m.lp?.lpBurned > 0 || m.lp?.lpLocked > 0));
        return { source: 'rugcheck', safe: isSafe, score, risks };
    }

    private async checkGoPlus(tokenAddress: string): Promise<SecurityReport> {
        const url = `https://api.gopluslabs.io/api/v1/token_security/solana?contract_addresses=${tokenAddress}`;
        const response = await axios.get(url, { timeout: 1000 });
        const data = response.data.result[tokenAddress.toLowerCase()] || response.data.result[tokenAddress];
        const risks: string[] = [];
        if (data.is_mintable === "1") risks.push("Mintable");
        if (data.is_freezable === "1") risks.push("Freezable");
        if (data.is_honeypot === "1") risks.push("Honeypot");
        return { source: 'goplus', safe: risks.length === 0, risks };
    }

    private async checkSolSniffer(tokenAddress: string): Promise<SecurityReport> {
        const url = `https://api.solsniffer.com/v2/token/${tokenAddress}`;
        const response = await axios.get(url, {
            headers: { 'X-API-KEY': this.solSnifferApiKey },
            timeout: 1000
        });
        const data = response.data;
        const risks: string[] = [];
        const score = data.score || 0;
        const isSafe = score >= 70;
        if (data.risks) {
            data.risks.forEach((r: any) => {
                if (r.level === 'critical' || r.level === 'high') risks.push(r.name);
            });
        }
        return { source: 'solsniffer', safe: isSafe, score, risks };
    }
}
