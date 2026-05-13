# Trench Predator V1.1

Implementation pack for a Solana micro-position trading bot orchestrated by n8n with Redis and PostgreSQL state.

This repository provides a modular, secure, and learning-capable infrastructure for trading Solana tokens in high-frequency environments.

## Features

- **Multi-Source Signal Intake**: Telegram webhooks, WebSocket streams, or manual entry.
- **Sub-Second Security Analysis**: Parallel scans using RugCheck, GoPlus, and SolSniffer with an 800ms budget.
- **Agentic Learning Loop**: Automatically correlates market features (liquidity, volume, holder count) with trade outcomes to optimize future entries.
- **Dynamic Risk Management**:
  - Auto-adjusting trailing stops.
  - Partial take-profits at 2x.
  - Hard stop-loss at ~66%.
  - Local risk engine to detect "rug-like" behavior (volume drop, holder exit).
- **Circuit Breaker System**: Halts trading on excessive daily loss, loss streaks, or API instability.
- **Secure Boundary**: Transaction building is separated from signing to keep private keys isolated.

## Repository Structure

- `src/core`: Deterministic logic (Security, Risk, Budget, Trailing Stop) that can be tested locally.
- `n8n/code-nodes`: JavaScript snippets designed for n8n Code nodes.
- `n8n/workflows`: Importable `.json` workflow for n8n.
- `database/`: PostgreSQL schema and migration scripts.
- `docs/`: In-depth documentation on architecture and the learning loop.

## Quick Start

1. **Deploy Database**:
   ```sql
   psql -f database/schema.sql
   ```
2. **Setup n8n**:
   - Import `n8n/workflows/trench-predator-v1.1.workflow.json`.
   - Configure Environment Variables (see `TUTORIAL.md`).
3. **Run Tests**:
   ```bash
   npm test
   ```

## Documentation

- [Detailed Architecture](./docs/ARCHITECTURE.md)
- [Implementation Tutorial (English)](./TUTORIAL.md)
- [Guía de Implementación (Español)](./TUTORIAL_ES.md)
- [Learning Loop Details](./docs/learning-loop.md)

## Safety Defaults

The bot is biased toward aborting when safety data is incomplete:
- At least 2 security providers must respond.
- All responding providers must pass.
- The circuit breaker halts on daily loss ($15), loss streak (15), or stale positions.
- No more than 3 positions should be open at once.

---
*Disclaimer: Trading cryptocurrencies involves significant risk. This software is provided "as is" for educational and experimental purposes.*
