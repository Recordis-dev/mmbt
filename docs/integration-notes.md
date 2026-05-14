# Integration Notes

## n8n Runtime Assumptions

The importable workflow now uses native n8n Redis, PostgreSQL and HTTP Request nodes for state, persistence and external I/O. Code nodes are kept for deterministic transformations and decisions.

Required native credentials:

- `Trench Redis Local` or your production Redis credential.
- `Trench Postgres Local` or your production PostgreSQL credential.

Required environment variables:

- `SOLANA_WALLET_PUBLIC_KEY`
- `SOL_USD`
- `RUGCHECK_API_KEY`
- `GOPLUS_API_KEY`
- `SOLSNIFFER_API_KEY`
- `SIGNER_URL` and `SIGNER_API_KEY` for live trading.

If `SIGNER_URL` is not configured, the workflow runs in paper mode: Jupiter transactions are built and logged, but not signed or broadcast.

## Required Workflow Credentials

- Telegram webhook or bot trigger.
- Redis connection.
- PostgreSQL connection.
- RugCheck, GoPlus and SolSniffer API keys.
- Jupiter does not require an API key for the quote/swap endpoints used here.
- Helius RPC key for monitoring and optional webhooks.
- Claude API key only if semantic risk analysis is enabled.

## Wallet Signing Boundary

The Jupiter swap path returns `serializedTransaction` with status `swap_ready`.

Do not sign inside a public workflow export. Recommended options:

- n8n credential-backed custom node.
- A small private signer service on the same network.
- Hardware-wallet or MPC-backed signer if this graduates beyond micro-bets.

The signer should return:

```json
{
  "status": "bought",
  "txHash": "...",
  "tokenAddress": "...",
  "entryPrice": 0.0000001,
  "amount": "123456"
}
```

## V1.1 Import Order

1. Apply `database/schema.sql`.
2. Configure env vars from `.env.example`.
3. Import `n8n/workflows/trench-predator-v1.1.workflow.json`.
4. Add the Code node snippets.
5. Add credentials and replace placeholder nodes with concrete Redis/Postgres/native nodes where needed.
6. Run in paper mode before enabling the signer.
