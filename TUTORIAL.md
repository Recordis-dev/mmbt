# Step-by-Step Implementation Guide

This guide helps you set up Trench Predator V1.1 from scratch.

## Prerequisites

- **Node.js 20+** installed.
- **n8n** (self-hosted recommended for Redis/Postgres access).
- **Redis** and **PostgreSQL**.
- API Keys for:
  - RugCheck (optional, but recommended).
  - GoPlus.
  - SolSniffer.
  - Solana RPC (Helius, QuickNode, etc).

---

## Step 1: Database Setup

Run the provided schema in your PostgreSQL instance:

```bash
psql -h localhost -U your_user -d your_database -f database/schema.sql
```

This will create necessary tables for signals, positions, decision logs, and the learning loop.

## Step 2: Environment Variables

Set up environment variables in your n8n environment:

```env
# Solana
SOLANA_WALLET_PUBLIC_KEY=your_public_key

# Security APIs
RUGCHECK_API_KEY=your_api_key
GOPLUS_API_KEY=your_api_key
SOLSNIFFER_API_KEY=your_api_key

# Database
DATABASE_URL=postgres://user:password@localhost:5432/trench
REDIS_URL=redis://localhost:6379
```

## Step 3: Import Workflow into n8n

1. Open n8n.
2. Create a new Workflow.
3. Import the following file from the top-right menu:
   `n8n/workflows/trench-predator-v1.1.workflow.json`.
4. Configure PostgreSQL and Redis credentials in their respective nodes.

## Step 4: Code Node Setup

Logic snippets are located in `n8n/code-nodes/`. If the imported workflow doesn't have the code loaded:
1. Open each "Code" node.
2. Copy the content from the matching file (e.g., `01-extract-token-address.js`) and paste it into the node.

## Step 5: Paper Mode Testing

Before activating the real swap node (`05-jupiter-buy.js`):
1. Ensure the Telegram/Webhook flow is receiving messages.
2. Verify that entries are being inserted into the `signals` table in PostgreSQL.
3. Check the `decision_logs` table to see why tokens are being approved or rejected.

## Step 6: Activating the Signer

The bot generates a `serializedTransaction` but **does not sign it automatically** for security reasons.
1. Implement a private node or service that takes this field, signs it with your private key, and broadcasts it to the network.
2. Once broadcasted, update the position status in the `positions` table.

---

## Maintenance

- **Learning Loop**: The `learning_patterns` table will populate automatically. After ~100 trades, the bot will begin filtering based on the historical performance of similar patterns.
- **Circuit Breaker**: If the bot stops trading, check the `trench:circuit_breaker` key in Redis to find the security reason.
