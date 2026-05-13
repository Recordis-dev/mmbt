# Trench Predator V1.1

Implementation pack for a Solana micro-position trading bot orchestrated by n8n with Redis and PostgreSQL state.

This repository is intentionally split into:

- `src/core`: deterministic logic that can be tested outside n8n.
- `n8n/code-nodes`: copy/paste JavaScript for n8n Code nodes.
- `n8n/workflows`: importable workflow skeletons.
- `database/schema.sql`: PostgreSQL tables and indexes.

## V1.1 Scope

- Parallel anti-rug checks with an 800 ms timeout budget.
- Local deterministic fallback engine for risk confluence decisions.
- Budget, loss-streak and concurrent exposure guards.
- Dynamic trailing stop and hard stop logic.
- Startup recovery and circuit breaker support.
- PostgreSQL audit trail and Redis fast state.
- Learning loop that stores trade features, outcomes and aggregate pattern scores.

## Quick Start

1. Create the PostgreSQL schema:

```sql
\i database/schema.sql
```

2. Set the environment variables from `.env.example`.

3. Import `n8n/workflows/trench-predator-v1.1.workflow.json` into n8n.

4. Paste the matching files from `n8n/code-nodes` into their Code nodes, or keep them as source control references while wiring credentials in n8n.

5. Run local deterministic tests:

```bash
npm test
```

## Learning Loop

Read `docs/learning-loop.md` for the data flow. In short:

- `09-capture-learning-features.js` saves the setup before entry.
- `10-update-learning-outcome.js` saves the result after exit.
- `11-learning-admission-filter.js` uses past pattern stats to keep, reduce or block future exposure.

## Safety Defaults

The bot is biased toward aborting when safety data is incomplete:

- At least 2 security providers must respond.
- All responding providers must pass.
- The circuit breaker halts on daily loss, loss streak, API failure surge or stale positions.
- No more than 3 positions should be open at once.

Wallet signing is deliberately isolated in the Jupiter execution node. Keep private keys in n8n credentials or a secret manager, never in workflow JSON.
