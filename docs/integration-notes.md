# Integration Notes

## n8n Runtime Assumptions

The Code node snippets assume these helpers are available in the node context:

- `env`: environment variable accessor.
- `redis`: Redis client with `get`, `set` and `exists`.
- `db`: PostgreSQL client with `query`.

If your n8n instance does not expose shared clients directly, wire these snippets through native n8n Redis/Postgres nodes instead:

- Use Redis nodes before admission decisions and pass values into the Code node as JSON.
- Use Postgres nodes after each decision to persist `signals`, `positions` and `decision_logs`.
- Keep wallet signing in a dedicated secure node or external service.

## Required Workflow Credentials

- Telegram webhook or bot trigger.
- Redis connection.
- PostgreSQL connection.
- RugCheck, GoPlus and SolSniffer API keys.
- Jupiter does not require an API key for the quote/swap endpoints used here.
- Helius RPC key for monitoring and optional webhooks.
- Claude API key only if semantic risk analysis is enabled.

## Wallet Signing Boundary

`05-jupiter-buy.js` returns `serializedTransaction` with status `swap_ready`.

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
