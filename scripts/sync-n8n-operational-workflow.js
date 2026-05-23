import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workflowPath = "n8n/workflows/trench-predator-v1.1.workflow.json";
const snippetDirectory = "n8n/code-nodes";
const code = (file) => readFileSync(join(snippetDirectory, file), "utf8").trimEnd();

// ─── Node builders ───────────────────────────────────────────────────────────

const n = (id, name, type, typeVersion, parameters, position) => ({
  id, name, type, typeVersion, parameters, position
});

const codeNode = (id, name, file, position, mode = "runOnceForEachItem") =>
  n(id, name, "n8n-nodes-base.code", 2, { mode, jsCode: code(file) }, position);

const webhook = (id, name, path, position) =>
  n(id, name, "n8n-nodes-base.webhook", 2,
    { path, httpMethod: "POST", responseMode: "lastNode" }, position);

const manual = (id, name, position) =>
  n(id, name, "n8n-nodes-base.manualTrigger", 1, {}, position);

const ifBool = (id, name, expr, position) => {
  const inner = expr.replace(/^=\{\{\s*/, "").replace(/\s*\}\}$/, "");
  return n(id, name, "n8n-nodes-base.if", 2, {
    conditions: {
      string: [{
        value1: `={{ String(${inner}) }}`,
        operation: "equal",
        value2: "true"
      }]
    }
  }, position);
};

const ifString = (id, name, value1, operation, value2, position) =>
  n(id, name, "n8n-nodes-base.if", 2, {
    conditions: { string: [{ value1, operation, value2 }] }
  }, position);

const schedule = (id, name, field, intervalKey, intervalValue, position) =>
  n(id, name, "n8n-nodes-base.scheduleTrigger", 1.3, {
    rule: { interval: [{ field, [intervalKey]: intervalValue }] }
  }, position);

const pg = (id, name, query, position, queryReplacement = "") => ({
  ...n(id, name, "n8n-nodes-base.postgres", 2.6, {
    operation: "executeQuery",
    query,
    options: queryReplacement ? { queryReplacement } : {}
  }, position),
  credentials: { postgres: { id: "trench-postgres-local", name: "Trench Postgres Local" } }
});

// ─── Connection helper ───────────────────────────────────────────────────────

const c = {};
const link = (from, to, fromOutput = 0, toInput = 0) => {
  c[from] ??= { main: [] };
  c[from].main[fromOutput] ??= [];
  c[from].main[fromOutput].push({ node: to, type: "main", index: toInput });
};

// ─── SQL queries ─────────────────────────────────────────────────────────────

// Admission: atomic dedup via INSERT ... ON CONFLICT DO NOTHING.
// If the INSERT succeeds (returns row), we are the first; admission proceeds.
// If ON CONFLICT swallows the row (returns empty), it's a duplicate.
const Q_ADMISSION_STATE = `
WITH dedup AS (
  INSERT INTO signal_dedup (token_address)
  VALUES ($1)
  ON CONFLICT (token_address) DO NOTHING
  RETURNING token_address
)
SELECT
  $1::text AS "tokenAddress",
  $2::text AS "sourceChannel",
  $3::text AS "rawMessage",
  COALESCE((SELECT daily_pnl FROM system_state ORDER BY timestamp DESC LIMIT 1), 0) AS daily_pnl,
  COALESCE((SELECT consecutive_losses FROM system_state ORDER BY timestamp DESC LIMIT 1), 0) AS consecutive_losses,
  COALESCE((SELECT circuit_breaker_active FROM system_state ORDER BY timestamp DESC LIMIT 1), false) AS circuit_breaker_active,
  (SELECT COUNT(*)::int FROM positions WHERE status='open') AS open_positions,
  (SELECT COUNT(*)::int FROM signals WHERE received_at::date = CURRENT_DATE AND status='approved') AS trades_today,
  NOT EXISTS(SELECT 1 FROM dedup) AS duplicate
`.trim();

const Q_INSERT_SIGNAL_FEATURES_GET_PATTERN = `
WITH ins AS (
  INSERT INTO signals (token_address, source_channel, raw_message, status, security_scores)
  VALUES ($1, $2, $3, 'approved', $4::jsonb)
  RETURNING id
),
feat AS (
  INSERT INTO trade_features (
    signal_id, token_address, source_channel,
    security_score, market_snapshot, risk_snapshot,
    pattern_key, entry_decision, entry_reason
  )
  SELECT id, $1, $2, $4::jsonb, $5::jsonb, $6::jsonb, $7, 'approved', 'security_passed'
  FROM ins
  RETURNING signal_id
)
SELECT
  feat.signal_id AS "signalId",
  $7::text AS "patternKey",
  $1::text AS "tokenAddress",
  $8::numeric AS "entryPriceUsd",
  $9::numeric AS "dailyPnL",
  $10::int AS "consecutiveLosses",
  COALESCE(lp.sample_count, 0) AS sample_count,
  COALESCE(lp.win_count, 0) AS win_count,
  COALESCE(lp.total_pnl_usd, 0) AS total_pnl_usd,
  COALESCE(lp.avg_max_multiplier, 0) AS avg_max_multiplier
FROM feat
LEFT JOIN learning_patterns lp ON lp.pattern_key = $7
`.trim();

const Q_INSERT_POSITION = `
INSERT INTO positions (
  token_address, entry_price, entry_amount, entry_tx_hash, highest_price, status,
  trailing_stop_percentage, avg_volume, peak_holders, bet_size_usd, paper_mode
)
VALUES ($1, $2, $3::numeric, $4, $2, 'open', 20, $5, $6, $7, $8::boolean)
RETURNING id AS "positionId", token_address AS "tokenAddress"
`.trim();

// Lock window of 60 s: covers DexScreener (5s) + Jupiter quote (10s) +
// Jupiter swap (15s) + signer (30s) = 60 s worst case.
const Q_CLAIM_POSITIONS = `
UPDATE positions
SET locked_until = NOW() + interval '60 seconds'
WHERE id IN (
  SELECT id FROM positions
  WHERE status = 'open' AND (locked_until IS NULL OR locked_until < NOW())
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 10
)
RETURNING *
`.trim();

const Q_UPDATE_HIGHEST = `
UPDATE positions
SET highest_price = GREATEST(COALESCE(highest_price, 0), $2::numeric),
    locked_until = NULL
WHERE id = $1
RETURNING id
`.trim();

const Q_PARTIAL_UPDATE = `
UPDATE positions
SET
  entry_amount = GREATEST(entry_amount - $2::numeric, 0),
  bet_size_usd = COALESCE(bet_size_usd, 0) * 0.5,
  partial_tp_taken = true,
  highest_price = GREATEST(COALESCE(highest_price, 0), $3::numeric),
  multiplier = $4,
  locked_until = NULL
WHERE id = $1
RETURNING id
`.trim();

// Close + outcome + learning. Param $13 is paper_mode: learning_patterns is
// only updated when paper_mode is false (real trades only).
const Q_CLOSE_POSITION_AND_LEARN = `
WITH pos AS (
  UPDATE positions
  SET status='closed', closed_at=NOW(),
      exit_price=$2, exit_tx_hash=$3, exit_reason=$4,
      pnl_usd=$5, multiplier=$6,
      highest_price = GREATEST(COALESCE(highest_price, 0), $7::numeric),
      locked_until = NULL
  WHERE id = $1
  RETURNING id, token_address, paper_mode
),
ins_outcome AS (
  INSERT INTO trade_outcomes (
    position_id, token_address, hold_time_seconds, entry_price, exit_price,
    max_multiplier, final_multiplier, pnl_usd, exit_reason, was_winner,
    outcome_label, paper_mode
  )
  SELECT $1, token_address, $8, $9, $2, $10, $6, $5, $4, $11, $12, paper_mode
  FROM pos
  RETURNING id
),
feat AS (
  SELECT pattern_key FROM trade_features
  WHERE position_id = $1 OR (position_id IS NULL AND token_address = (SELECT token_address FROM pos))
  ORDER BY captured_at DESC LIMIT 1
),
cur AS (
  SELECT lp.* FROM learning_patterns lp JOIN feat f ON f.pattern_key = lp.pattern_key
),
calc AS (
  SELECT (SELECT pattern_key FROM feat) AS pattern_key,
    COALESCE((SELECT sample_count FROM cur), 0) + 1 AS sample_count,
    COALESCE((SELECT win_count FROM cur), 0) + CASE WHEN $11 THEN 1 ELSE 0 END AS win_count,
    COALESCE((SELECT total_pnl_usd FROM cur), 0) + $5 AS total_pnl_usd,
    COALESCE((SELECT avg_max_multiplier FROM cur), 0) AS previous_avg_max
)
INSERT INTO learning_patterns (
  pattern_key, sample_count, win_count, loss_count, total_pnl_usd, avg_pnl_usd,
  avg_max_multiplier, last_outcome_label, confidence_score, updated_at
)
SELECT
  pattern_key, sample_count, win_count, sample_count - win_count, total_pnl_usd,
  total_pnl_usd / sample_count,
  previous_avg_max + ($10 - previous_avg_max) / sample_count,
  $12,
  CASE WHEN sample_count < 5 THEN 0
       ELSE ROUND((((win_count::numeric/sample_count) - 0.5) * 2
            + (total_pnl_usd / sample_count)
            + LEAST(previous_avg_max + ($10 - previous_avg_max) / sample_count, 10) / 10
       )::numeric, 4)
  END,
  NOW()
FROM calc WHERE pattern_key IS NOT NULL AND NOT $13::boolean
ON CONFLICT (pattern_key) DO UPDATE SET
  sample_count = EXCLUDED.sample_count,
  win_count = EXCLUDED.win_count,
  loss_count = EXCLUDED.loss_count,
  total_pnl_usd = EXCLUDED.total_pnl_usd,
  avg_pnl_usd = EXCLUDED.avg_pnl_usd,
  avg_max_multiplier = EXCLUDED.avg_max_multiplier,
  last_outcome_label = EXCLUDED.last_outcome_label,
  confidence_score = EXCLUDED.confidence_score,
  updated_at = NOW()
RETURNING pattern_key
`.trim();

// Health Stats: only counts REAL trades (paper_mode=false) for consecutive losses.
const Q_HEALTH_STATS = `
WITH ordered AS (
  SELECT pnl_usd,
    ROW_NUMBER() OVER (ORDER BY closed_at DESC) AS rn,
    CASE WHEN pnl_usd >= 0 THEN 1 ELSE 0 END AS is_winner
  FROM positions
  WHERE status='closed' AND pnl_usd IS NOT NULL AND COALESCE(paper_mode, false) = false
  ORDER BY closed_at DESC
  LIMIT 100
),
streak AS (
  SELECT MIN(rn) AS first_winner_rn FROM ordered WHERE is_winner = 1
)
SELECT
  COALESCE((SELECT SUM(pnl_usd) FROM positions
            WHERE closed_at::date=CURRENT_DATE AND COALESCE(paper_mode,false)=false), 0) AS "dailyPnL",
  CASE
    WHEN (SELECT first_winner_rn FROM streak) IS NULL
      THEN COALESCE((SELECT COUNT(*) FROM ordered WHERE is_winner = 0), 0)
    ELSE (SELECT first_winner_rn FROM streak) - 1
  END AS "consecutiveLosses",
  0 AS "apiFailures",
  COALESCE((SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) * 1000
            FROM positions WHERE status='open'), 0) AS "oldestOpenPositionAgeMs",
  (SELECT COUNT(*)::int FROM positions WHERE status='open') AS "openPositionsCount"
`.trim();

const Q_WRITE_SYSTEM_STATE = `
INSERT INTO system_state (
  daily_pnl, consecutive_losses, open_positions_count, circuit_breaker_active,
  api_failures_today
) VALUES ($1, $2, $3, $4, $5)
RETURNING id
`.trim();

// Cleanup runs alongside the health check: timeouts stale positions, unlocks
// expired locks, and purges signal_dedup older than 24 h.
const Q_PERIODIC_CLEANUP = `
WITH closed AS (
  UPDATE positions SET status='timeout', closed_at=NOW(),
    exit_reason='timeout_recovery', locked_until=NULL
  WHERE status='open' AND created_at < NOW() - INTERVAL '45 minutes'
  RETURNING id
),
unlocked AS (
  UPDATE positions SET locked_until=NULL
  WHERE status='open' AND locked_until IS NOT NULL AND locked_until < NOW()
  RETURNING id
),
dedup_purged AS (
  DELETE FROM signal_dedup WHERE claimed_at < NOW() - interval '24 hours'
  RETURNING token_address
)
SELECT
  (SELECT COUNT(*) FROM closed)::int AS "timedOutCount",
  (SELECT COUNT(*) FROM unlocked)::int AS "unlockedCount",
  (SELECT COUNT(*) FROM dedup_purged)::int AS "dedupPurgedCount"
`.trim();

// ─── Nodes ───────────────────────────────────────────────────────────────────

const nodes = [
  // === ENTRY / BUY FLOW (12 nodes) ===
  webhook("signal-webhook", "Signal Webhook", "trench-signal", [120, 220]),
  codeNode("extract-token", "Extract Token", "01-extract-token.js", [340, 220]),
  ifString("if-parsed", "IF Parsed", "={{ $json.status }}", "equal", "parsed", [560, 220]),
  pg("pg-admission-state", "PG Admission State", Q_ADMISSION_STATE, [780, 140],
     "={{ [$json.tokenAddress, $json.sourceChannel, $json.rawMessage] }}"),
  codeNode("admission-decision", "Admission Decision", "02-admission-decision.js", [1000, 140]),
  ifString("if-approved", "IF Approved", "={{ $json.status }}", "equal", "approved", [1220, 140]),
  codeNode("security-and-market", "Security + Market + Features", "03-security-and-market.js", [1440, 60]),
  ifString("if-safe", "IF Safe", "={{ $json.status }}", "equal", "safe", [1660, 60]),
  pg("pg-insert-features", "PG Insert Signal + Features + Get Pattern",
     Q_INSERT_SIGNAL_FEATURES_GET_PATTERN, [1880, 60],
     "={{ [$json.tokenAddress, $json.sourceChannel, $json.rawMessage, $json.securitySnapshot, $json.marketSnapshot, $json.riskSnapshot, $json.patternKey, $json.entryPriceUsd, $json.dailyPnL, $json.consecutiveLosses] }}"),
  codeNode("execute-buy", "Execute Buy", "04-execute-buy.js", [2100, 60]),
  ifString("if-bought", "IF Bought", "={{ $json.status }}", "equal", "bought", [2320, 60]),
  // entry_amount as string to preserve precision for tokens with >9 decimals
  pg("pg-insert-position", "PG Insert Position", Q_INSERT_POSITION, [2540, 60],
     "={{ [$json.tokenAddress, $json.entryPriceUsd, String($json.outputAmount), $json.txHash, $json.entryAvgVolume, $json.entryPeakHolders, $json.betSizeUsd, !!$json.paperMode] }}"),

  // === MONITOR FLOW (8 nodes) ===
  schedule("monitor-schedule", "Monitor Schedule", "seconds", "secondsInterval", 5, [120, 600]),
  pg("pg-claim-positions", "PG Claim Open Positions", Q_CLAIM_POSITIONS, [340, 600]),
  codeNode("monitor-process", "Monitor Process", "05-monitor-process.js", [560, 600], "runOnceForAllItems"),
  ifBool("if-should-exit", "IF Should Exit", "={{ $json.shouldExit }}", [780, 600]),
  pg("pg-update-highest", "PG Update Highest", Q_UPDATE_HIGHEST, [1000, 720],
     "={{ [$json.positionId, $json.highestPriceUsd || 0] }}"),
  ifBool("if-should-close", "IF Should Close", "={{ $json.shouldClose }}", [1000, 480]),
  pg("pg-partial-update", "PG Partial TP Update", Q_PARTIAL_UPDATE, [1220, 600],
     "={{ [$json.positionId, String($json.sellAmount), $json.highestPriceUsd, $json.multiplier] }}"),
  pg("pg-close-and-learn", "PG Close + Outcome + Learning",
     Q_CLOSE_POSITION_AND_LEARN, [1220, 360],
     "={{ [$json.positionId, $json.exitPriceUsd, $json.txHash, $json.action, $json.pnlUsd, $json.finalMultiplier, $json.highestPriceUsd, $json.holdTimeSeconds, $json.entryPriceUsd, $json.maxMultiplier, $json.wasWinner, $json.outcomeLabel, !!$json.paperMode] }}"),

  // === HEALTH + CLEANUP (5 nodes) ===
  schedule("health-schedule", "Health Schedule", "minutes", "minutesInterval", 1, [120, 900]),
  pg("pg-health-stats", "PG Health Stats", Q_HEALTH_STATS, [340, 900]),
  codeNode("health-check", "Health Check", "06-health-check.js", [560, 900]),
  pg("pg-write-system-state", "PG Write System State", Q_WRITE_SYSTEM_STATE, [780, 900],
     "={{ [$json.dailyPnL, $json.consecutiveLosses, $json.openPositionsCount, $json.circuitBreakerActive, $json.apiFailures] }}"),
  pg("pg-periodic-cleanup", "PG Periodic Cleanup", Q_PERIODIC_CLEANUP, [1000, 900]),

  // === STARTUP RECOVERY (2 nodes — manual fallback for ops) ===
  manual("startup-manual", "Startup Recovery", [120, 1100]),
  pg("pg-startup-cleanup", "PG Startup Cleanup", Q_PERIODIC_CLEANUP, [340, 1100])
];

// ─── Connections ─────────────────────────────────────────────────────────────

// Entry/Buy flow
link("Signal Webhook", "Extract Token");
link("Extract Token", "IF Parsed");
link("IF Parsed", "PG Admission State", 0);
link("PG Admission State", "Admission Decision");
link("Admission Decision", "IF Approved");
link("IF Approved", "Security + Market + Features", 0);
link("Security + Market + Features", "IF Safe");
link("IF Safe", "PG Insert Signal + Features + Get Pattern", 0);
link("PG Insert Signal + Features + Get Pattern", "Execute Buy");
link("Execute Buy", "IF Bought");
link("IF Bought", "PG Insert Position", 0);

// Monitor flow
link("Monitor Schedule", "PG Claim Open Positions");
link("PG Claim Open Positions", "Monitor Process");
link("Monitor Process", "IF Should Exit");
link("IF Should Exit", "IF Should Close", 0);            // true: shouldExit
link("IF Should Exit", "PG Update Highest", 1);          // false: hold / release
link("IF Should Close", "PG Close + Outcome + Learning", 0);
link("IF Should Close", "PG Partial TP Update", 1);

// Health + cleanup
link("Health Schedule", "PG Health Stats");
link("PG Health Stats", "Health Check");
link("Health Check", "PG Write System State");
link("PG Write System State", "PG Periodic Cleanup");

// Startup
link("Startup Recovery", "PG Startup Cleanup");

// ─── Write workflow ──────────────────────────────────────────────────────────

const workflow = {
  name: "Trench Predator V1.2",
  nodes,
  connections: c,
  settings: { executionOrder: "v1" },
  pinData: {}
};

writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Synced ${nodes.length} nodes into ${workflowPath}.`);
