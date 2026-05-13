# Trench Predator Architecture

Trench Predator is a high-frequency trading (HFT) orchestration system for Solana tokens, designed to run within **n8n** and utilize **PostgreSQL** and **Redis** for state management and long-term learning.

## System Components

### 1. Orchestration Layer (n8n)
n8n manages the workflow lifecycle. It handles:
- **Webhooks**: Receiving signals from Telegram or other sources.
- **Task Scheduling**: Running the monitoring loop every few seconds.
- **Error Handling**: Retries and notifications.
- **Node Execution**: Executing JavaScript snippets that contain the bot's core logic.

### 2. Fast State Layer (Redis)
Redis is used for low-latency checks to ensure the bot responds within sub-second windows:
- **Duplicate Prevention**: Storing recently seen token addresses.
- **Circuit Breaker**: Global flags to halt trading during high volatility or consecutive losses.
- **Daily Limits**: Keeping track of trades executed in the last 24 hours.
- **Concurrency Control**: Managing the number of open positions.

### 3. Persistent Data Layer (PostgreSQL)
PostgreSQL handles the "memory" of the bot:
- **Audit Trail**: Every signal, decision, and trade is logged.
- **Position Tracking**: Detailed history of entry, exit, PnL, and reasons.
- **Learning Loop**: Storing "features" (market conditions at entry) and "outcomes" (how the trade ended) to optimize future decisions.

### 4. Deterministic Core (src/core)
Pure JavaScript logic that can be tested independently of n8n.
- `securityEngine.js`: Evaluates RugCheck, GoPlus, and SolSniffer reports.
- `riskEngine.js`: Analyzes local market metrics for panic exits.
- `budgetEngine.js`: Calculates bet sizes based on performance.
- `trailingStop.js`: Logic for dynamic exits and profit taking.

---

## Data Flow

### Entry Flow (The "Filter")
1. **Signal Received**: Token address extracted from message.
2. **Admission Control (Redis)**: Check for duplicates, daily limits, and open position cap.
3. **Security Check (Parallel)**: Concurrent requests to RugCheck, GoPlus, and SolSniffer. All must pass within 800ms.
4. **Learning Filter (Postgres)**: Compares current market conditions against historical "Pattern Keys".
5. **Execution**: Builds a swap transaction via Jupiter API.
6. **Confirmation**: Records the open position in PostgreSQL.

### Monitoring & Exit Flow (The "Guardian")
1. **Market Watch**: Fetches latest price, volume, and holder data.
2. **Risk Analysis**: Checks for "red flags" (holder drops, volume decline).
3. **Exit Decision**: Trailing stop, hard stop loss, or take profit.
4. **Outcome Recording**: Updates PostgreSQL with final PnL and updates the Learning Loop patterns.

---

## Security Boundary
Private keys are **never** stored in the code or workflow JSON. They should be managed via n8n credentials or a dedicated secure signing service that receives the `serializedTransaction` from the Jupiter node.
