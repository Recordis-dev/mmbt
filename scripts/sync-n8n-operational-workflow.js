import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workflowPath = "n8n/workflows/trench-predator-v1.1.workflow.json";
const snippetDirectory = "n8n/code-nodes";
const code = (file) => readFileSync(join(snippetDirectory, file), "utf8").trimEnd();

const n = (id, name, type, typeVersion, parameters, position) => ({ id, name, type, typeVersion, parameters, position });
const codeNode = (id, name, file, position) => n(id, name, "n8n-nodes-base.code", 2, { jsCode: code(file) }, position);
const webhook = (id, name, path, position) => n(id, name, "n8n-nodes-base.webhook", 2, { path, httpMethod: "POST", responseMode: "lastNode" }, position);
const manual = (id, name, position) => n(id, name, "n8n-nodes-base.manualTrigger", 1, {}, position);
const noop = (id, name, position) => n(id, name, "n8n-nodes-base.noOp", 1, {}, position);
const ifString = (id, name, value1, operation, value2, position) =>
  n(id, name, "n8n-nodes-base.if", 2, { conditions: { string: [{ value1, operation, value2 }] } }, position);
const schedule = (id, name, field, intervalKey, intervalValue, position) =>
  n(id, name, "n8n-nodes-base.scheduleTrigger", 1.3, { rule: { interval: [{ field, [intervalKey]: intervalValue }] } }, position);
const redis = (id, name, parameters, position) => ({
  ...n(id, name, "n8n-nodes-base.redis", 1, parameters, position),
  credentials: { redis: { id: "trench-redis-local", name: "Trench Redis Local" } }
});
const pg = (id, name, query, position, queryReplacement = "") =>
  ({
    ...n(id, name, "n8n-nodes-base.postgres", 2.6, {
      operation: "executeQuery",
      query,
      options: queryReplacement ? { queryReplacement } : {}
    }, position),
    credentials: { postgres: { id: "trench-postgres-local", name: "Trench Postgres Local" } }
  });
const http = (id, name, method, url, position, extra = {}) =>
  n(id, name, "n8n-nodes-base.httpRequest", 4.4, {
    method,
    url,
    authentication: "none",
    sendHeaders: Boolean(extra.headers),
    specifyHeaders: "keypair",
    headerParameters: { parameters: extra.headers ?? [] },
    sendBody: Boolean(extra.body),
    contentType: "json",
    specifyBody: "json",
    jsonBody: extra.body ?? "",
    options: { timeout: extra.timeout ?? 30000, response: { response: { neverError: true, responseFormat: "json" } } }
  }, position);
const merge = (id, name, position) =>
  n(id, name, "n8n-nodes-base.merge", 3.2, {
    mode: "combine",
    combineBy: "combineByPosition",
    options: { clashHandling: { values: { resolveClash: "preferInput1" } }, includeUnpaired: false }
  }, position);

const c = {};
const link = (from, to, fromOutput = 0, toInput = 0) => {
  c[from] ??= { main: [] };
  c[from].main[fromOutput] ??= [];
  c[from].main[fromOutput].push({ node: to, type: "main", index: toInput });
};

const nodes = [
  webhook("signal-webhook", "Signal Webhook", "trench-signal", [120, 220]),
  codeNode("extract-token-address", "Extract Token Address", "01-extract-token-address.js", [340, 220]),
  ifString("if-parsed", "IF Parsed", "={{ $json.status }}", "equal", "parsed", [560, 220]),
  noop("ignored-signal", "Ignored Signal", [780, 400]),
  redis("redis-get-duplicate", "Redis Get Duplicate", { operation: "get", propertyName: "duplicateValue", key: "=trench:token:{{ $json.tokenAddress }}", keyType: "string" }, [780, 80]),
  merge("merge-duplicate", "Merge Duplicate", [1000, 220]),
  redis("redis-get-daily", "Redis Get Daily Count", { operation: "get", propertyName: "dailyCountValue", key: "=trench:daily:count:{{ $now.toFormat('yyyy-MM-dd') }}", keyType: "string" }, [1220, 80]),
  merge("merge-daily", "Merge Daily", [1440, 220]),
  redis("redis-get-circuit", "Redis Get Circuit Breaker", { operation: "get", propertyName: "circuitBreakerValue", key: "trench:circuit_breaker", keyType: "string" }, [1660, 80]),
  merge("merge-circuit", "Merge Circuit", [1880, 220]),
  pg("pg-system-state", "Postgres System State",
    `SELECT COALESCE((SELECT daily_pnl FROM system_state ORDER BY timestamp DESC LIMIT 1), 0) AS daily_pnl,
COALESCE((SELECT consecutive_losses FROM system_state ORDER BY timestamp DESC LIMIT 1), 0) AS consecutive_losses,
COALESCE((SELECT circuit_breaker_active FROM system_state ORDER BY timestamp DESC LIMIT 1), false) AS circuit_breaker_active,
(SELECT COUNT(*)::int FROM positions WHERE status = 'open') AS open_positions_count,
COALESCE((SELECT trades_executed_today FROM system_state ORDER BY timestamp DESC LIMIT 1), 0) AS trades_executed_today`, [2100, 80]),
  merge("merge-state", "Merge System State", [2320, 220]),
  codeNode("admission-decision", "Admission Decision", "13-admission-decision-native.js", [2540, 220]),
  ifString("if-admitted", "IF Admitted", "={{ $json.status }}", "equal", "approved", [2760, 220]),
  ifString("if-queued", "IF Queued", "={{ $json.status }}", "equal", "queue", [2980, 400]),
  pg("pg-insert-queue", "Postgres Insert Queue",
    "INSERT INTO signal_queue (token_address, source_channel, raw_message) VALUES ($1,$2,$3) RETURNING id",
    [3200, 400], "={{ [$json.tokenAddress, $json.sourceChannel, $json.rawMessage] }}"),
  pg("pg-log-rejection", "Postgres Log Rejection",
    "INSERT INTO decision_logs (decision_type, reason, metrics_snapshot, source) VALUES ('signal_rejected',$1,$2::jsonb,'local_engine') RETURNING id",
    [3200, 560], "={{ [$json.reason || $json.status, JSON.stringify($json)] }}"),
  redis("redis-mark-token", "Redis Mark Token Seen", { operation: "set", key: "=trench:token:{{ $json.tokenAddress }}", value: "seen", keyType: "string", expire: true, ttl: 86400 }, [2980, 40]),
  pg("pg-insert-signal", "Postgres Insert Signal",
    `INSERT INTO signals (token_address, source_channel, raw_message, status)
VALUES ($1,$2,$3,'approved')
RETURNING id AS "signalId", $1::text AS "tokenAddress", $2::text AS "sourceChannel", $3::text AS "rawMessage",
$4::numeric AS "dailyPnL", $5::int AS "consecutiveLosses", $6::int AS "dailyCount", $7::int AS "openPositions"`,
    [3200, 40], "={{ [$json.tokenAddress, $json.sourceChannel, $json.rawMessage, $json.dailyPnL, $json.consecutiveLosses, $json.dailyCount, $json.openPositions] }}"),
  codeNode("security-check", "Parallel Security Check", "03-parallel-security-check.js", [3420, 40]),
  ifString("if-security-safe", "IF Security Safe", "={{ $json.status }}", "equal", "safe", [3640, 40]),
  pg("pg-log-security-abort", "Postgres Log Security Abort",
    "INSERT INTO decision_logs (decision_type, reason, metrics_snapshot, source) VALUES ('security_abort',$1,$2::jsonb,'local_engine') RETURNING id",
    [3860, 220], "={{ [$json.reason || $json.status, JSON.stringify($json)] }}"),
  http("http-market-entry", "HTTP Market Data Entry", "GET", "=https://api.dexscreener.com/latest/dex/tokens/{{ $json.tokenAddress }}", [3860, -80], { timeout: 10000 }),
  merge("merge-market-entry", "Merge Market Entry", [4080, 40]),
  codeNode("normalize-market-entry", "Normalize Market Entry", "14-normalize-market-data.js", [4300, 40]),
  codeNode("learning-features", "Build Learning Features", "09-capture-learning-features.js", [4520, 40]),
  pg("pg-insert-features", "Postgres Insert Features",
    `INSERT INTO trade_features (position_id, signal_id, token_address, source_channel, security_score, market_snapshot, risk_snapshot, pattern_key, entry_decision, entry_reason)
VALUES (NULL,$1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,'approved','security_passed')
RETURNING $1::int AS "signalId", $2::text AS "tokenAddress", $3::text AS "sourceChannel", $4::jsonb AS "securityScore",
$5::jsonb AS market, $6::jsonb AS risk, $7::text AS "patternKey", $8::numeric AS "dailyPnL", $9::int AS "consecutiveLosses"`,
    [4740, 40], "={{ [$json.signalId, $json.tokenAddress, $json.sourceChannel, $json.securitySnapshot, $json.marketSnapshot, $json.riskSnapshot, $json.patternKey, $json.dailyPnL, $json.consecutiveLosses] }}"),
  pg("pg-get-pattern", "Postgres Get Pattern",
    `SELECT $1::int AS "signalId", $2::text AS "tokenAddress", $3::text AS "sourceChannel", $4::jsonb AS market, $5::jsonb AS risk,
$6::text AS "patternKey", $7::numeric AS "dailyPnL", $8::int AS "consecutiveLosses",
COALESCE(lp.sample_count,0) AS sample_count, COALESCE(lp.win_count,0) AS win_count,
COALESCE(lp.total_pnl_usd,0) AS total_pnl_usd, COALESCE(lp.avg_max_multiplier,0) AS avg_max_multiplier
FROM (SELECT 1) seed LEFT JOIN learning_patterns lp ON lp.pattern_key = $6`,
    [4960, 40], "={{ [$json.signalId, $json.tokenAddress, $json.sourceChannel, JSON.stringify($json.market), JSON.stringify($json.risk), $json.patternKey, $json.dailyPnL, $json.consecutiveLosses] }}"),
  codeNode("learning-filter", "Learning Admission Filter", "11-learning-admission-filter.js", [5180, 40]),
  codeNode("bet-size", "Dynamic Bet Size", "04-dynamic-bet-size.js", [5400, 40]),
  ifString("if-trade", "IF Trade Allowed", "={{ $json.action }}", "equal", "TRADE", [5620, 40]),
  redis("redis-set-budget-circuit", "Redis Set Budget Circuit", { operation: "set", key: "trench:circuit_breaker", value: "={{ $json.reason }}", keyType: "string", expire: true, ttl: 86400 }, [5840, 220]),
  codeNode("prepare-buy-quote", "Prepare Buy Quote", "15-prepare-buy-quote.js", [5840, -80]),
  ifString("if-buy-quote", "IF Buy Quote Ready", "={{ $json.status }}", "equal", "quote_requested", [6060, -80]),
  pg("pg-log-buy-not-ready", "Postgres Log Buy Not Ready",
    "INSERT INTO decision_logs (decision_type, reason, metrics_snapshot, source) VALUES ('buy_not_ready',$1,$2::jsonb,'local_engine') RETURNING id",
    [6280, 100], "={{ [$json.reason || $json.status, JSON.stringify($json)] }}"),
  http("http-buy-quote", "HTTP Jupiter Buy Quote", "GET", "={{ $json.quoteUrl }}", [6280, -200], { timeout: 10000 }),
  merge("merge-buy-quote", "Merge Buy Quote", [6500, -80]),
  codeNode("prepare-buy-swap", "Prepare Buy Swap", "16-prepare-jupiter-swap.js", [6720, -80]),
  ifString("if-buy-swap", "IF Buy Swap Ready", "={{ $json.status }}", "equal", "swap_requested", [6940, -80]),
  http("http-buy-swap", "HTTP Jupiter Buy Swap", "POST", "={{ $json.swapUrl }}", [7160, -200], { body: "={{ JSON.stringify($json.swapPayload) }}", timeout: 15000 }),
  merge("merge-buy-swap", "Merge Buy Swap", [7380, -80]),
  codeNode("normalize-buy-swap", "Normalize Buy Swap", "17-normalize-swap-transaction.js", [7600, -80]),
  codeNode("prepare-buy-signer", "Prepare Buy Signer", "18-prepare-signer-request.js", [7820, -80]),
  ifString("if-buy-signer", "IF Buy Signer Configured", "={{ $json.status }}", "notEqual", "paper_swap_ready", [8040, -80]),
  pg("pg-log-paper-buy", "Postgres Log Paper Buy",
    "INSERT INTO decision_logs (decision_type, reason, metrics_snapshot, source) VALUES ('paper_swap_ready',$1,$2::jsonb,'local_engine') RETURNING id",
    [8260, 100], "={{ [$json.reason || $json.status, JSON.stringify($json)] }}"),
  http("http-buy-signer", "HTTP Buy Signer", "POST", "={{ $json.signerUrl }}", [8260, -200], {
    headers: [{ name: "Authorization", value: "=Bearer {{ $json.signerApiKey }}" }],
    body: "={{ JSON.stringify($json.signerPayload) }}",
    timeout: 30000
  }),
  merge("merge-buy-signer", "Merge Buy Signer", [8480, -80]),
  codeNode("normalize-buy-signer", "Normalize Buy Signer", "19-normalize-signer-result.js", [8700, -80]),
  ifString("if-bought", "IF Bought", "={{ $json.status }}", "equal", "bought", [8920, -80]),
  pg("pg-insert-position", "Postgres Insert Position",
    `INSERT INTO positions (token_address, entry_price, entry_amount, entry_tx_hash, highest_price, status, trailing_stop_percentage, avg_volume, peak_holders)
VALUES ($1,$2,$3,$4,$2,'open',20,$5,$6)
RETURNING id AS "positionId", token_address AS "tokenAddress"`,
    [9140, -80], "={{ [$json.tokenAddress, $json.entryPrice, $json.entryAmount || $json.outputAmount, $json.txHash, $json.market?.volume24hUsd || 0, $json.market?.holderCount || 0] }}"),
  redis("redis-incr-daily", "Redis Increment Daily Count", { operation: "incr", key: "=trench:daily:count:{{ $now.toFormat('yyyy-MM-dd') }}", expire: true, ttl: 86400 }, [9360, -80]),

  schedule("monitor-schedule", "Monitor Schedule", "seconds", "secondsInterval", 5, [120, 760]),
  pg("pg-open-positions", "Postgres Open Positions", "SELECT * FROM positions WHERE status = 'open' ORDER BY created_at ASC", [340, 760]),
  codeNode("prepare-monitor", "Prepare Monitor Item", "20-prepare-monitor-item.js", [560, 760]),
  http("http-market-monitor", "HTTP Market Data Monitor", "GET", "=https://api.dexscreener.com/latest/dex/tokens/{{ $json.tokenAddress }}", [780, 640], { timeout: 10000 }),
  merge("merge-monitor-market", "Merge Monitor Market", [1000, 760]),
  codeNode("normalize-market-monitor", "Normalize Market Monitor", "14-normalize-market-data.js", [1220, 760]),
  codeNode("exit-decision", "Monitor Exit Decision", "06-monitor-exit-decision.js", [1440, 760]),
  ifString("if-exit", "IF Exit Needed", "={{ $json.action }}", "notEqual", "hold", [1660, 760]),
  pg("pg-update-hold", "Postgres Update Hold",
    "UPDATE positions SET highest_price = GREATEST(COALESCE(highest_price,0),$2), multiplier = $3, risk_confluences = $4::jsonb WHERE id = $1 RETURNING id",
    [1880, 920], "={{ [$json.positionId, $json.highestPrice || 0, $json.multiplier || 0, JSON.stringify($json.riskSignals || {})] }}"),
  codeNode("prepare-sell-quote", "Prepare Sell Quote", "21-prepare-sell-quote.js", [1880, 640]),
  http("http-sell-quote", "HTTP Jupiter Sell Quote", "GET", "={{ $json.quoteUrl }}", [2100, 540], { timeout: 10000 }),
  merge("merge-sell-quote", "Merge Sell Quote", [2320, 640]),
  codeNode("prepare-sell-swap", "Prepare Sell Swap", "16-prepare-jupiter-swap.js", [2540, 640]),
  http("http-sell-swap", "HTTP Jupiter Sell Swap", "POST", "={{ $json.swapUrl }}", [2760, 540], { body: "={{ JSON.stringify($json.swapPayload) }}", timeout: 15000 }),
  merge("merge-sell-swap", "Merge Sell Swap", [2980, 640]),
  codeNode("normalize-sell-swap", "Normalize Sell Swap", "17-normalize-swap-transaction.js", [3200, 640]),
  codeNode("prepare-sell-signer", "Prepare Sell Signer", "18-prepare-signer-request.js", [3420, 640]),
  ifString("if-sell-signer", "IF Sell Signer Configured", "={{ $json.status }}", "notEqual", "paper_swap_ready", [3640, 640]),
  pg("pg-log-paper-sell", "Postgres Log Paper Sell",
    "INSERT INTO decision_logs (position_id, decision_type, reason, metrics_snapshot, source) VALUES ($1,'paper_exit_ready',$2,$3::jsonb,'local_engine') RETURNING id",
    [3860, 820], "={{ [$json.positionId, $json.reason || $json.status, JSON.stringify($json)] }}"),
  http("http-sell-signer", "HTTP Sell Signer", "POST", "={{ $json.signerUrl }}", [3860, 540], {
    headers: [{ name: "Authorization", value: "=Bearer {{ $json.signerApiKey }}" }],
    body: "={{ JSON.stringify($json.signerPayload) }}",
    timeout: 30000
  }),
  merge("merge-sell-signer", "Merge Sell Signer", [4080, 640]),
  codeNode("normalize-sell-signer", "Normalize Sell Signer", "19-normalize-signer-result.js", [4300, 640]),
  ifString("if-sold", "IF Sold", "={{ $json.status }}", "equal", "sold", [4520, 640]),
  pg("pg-log-sell-not-ready", "Postgres Log Sell Not Ready",
    "INSERT INTO decision_logs (position_id, decision_type, reason, metrics_snapshot, source) VALUES ($1,'sell_not_ready',$2,$3::jsonb,'local_engine') RETURNING id",
    [4740, 820], "={{ [$json.positionId, $json.reason || $json.status, JSON.stringify($json)] }}"),
  ifString("if-partial-exit", "IF Partial Exit", "={{ $json.action }}", "equal", "partial_take_profit", [4740, 640]),
  pg("pg-mark-partial-tp", "Postgres Mark Partial TP",
    `UPDATE positions
SET partial_tp_taken = true,
    entry_amount = GREATEST(entry_amount - $2, 0),
    highest_price = GREATEST(COALESCE(highest_price, 0), $3),
    multiplier = $4,
    risk_confluences = $5::jsonb
WHERE id = $1
RETURNING id`,
    [4960, 520], "={{ [$json.positionId, $json.exitAmount || 0, $json.stop?.highestPrice || $json.metrics?.currentPrice || 0, $json.stop?.multiplier || 0, JSON.stringify($json.riskSignals || {})] }}"),
  codeNode("learning-outcome", "Prepare Learning Outcome", "22-prepare-learning-outcome.js", [4960, 700]),
  pg("pg-close-and-learn", "Postgres Close Position And Learn",
    `WITH closed AS (
  UPDATE positions SET status='closed', closed_at=NOW(), exit_price=$2, exit_tx_hash=$3, exit_reason=$4, pnl_usd=$5, multiplier=$6
  WHERE id=$1 RETURNING id, token_address
), outcome AS (
  INSERT INTO trade_outcomes (position_id, token_address, hold_time_seconds, entry_price, exit_price, max_multiplier, final_multiplier, pnl_usd, exit_reason, was_winner, outcome_label)
  SELECT $1, token_address, $7, $8, $2, $9, $6, $5, $4, $10, $11 FROM closed
), feature AS (
  SELECT pattern_key FROM trade_features WHERE position_id=$1 OR token_address=(SELECT token_address FROM closed) ORDER BY captured_at DESC LIMIT 1
), current_pattern AS (
  SELECT lp.* FROM learning_patterns lp JOIN feature f ON f.pattern_key=lp.pattern_key
), calc AS (
  SELECT (SELECT pattern_key FROM feature) AS pattern_key,
    COALESCE((SELECT sample_count FROM current_pattern),0)+1 AS sample_count,
    COALESCE((SELECT win_count FROM current_pattern),0)+CASE WHEN $10 THEN 1 ELSE 0 END AS win_count,
    COALESCE((SELECT total_pnl_usd FROM current_pattern),0)+$5 AS total_pnl_usd,
    COALESCE((SELECT avg_max_multiplier FROM current_pattern),0) AS previous_avg_max
)
INSERT INTO learning_patterns (pattern_key, sample_count, win_count, loss_count, total_pnl_usd, avg_pnl_usd, avg_max_multiplier, last_outcome_label, confidence_score, updated_at)
SELECT pattern_key, sample_count, win_count, sample_count-win_count, total_pnl_usd, total_pnl_usd/sample_count,
  previous_avg_max + ($9 - previous_avg_max)/sample_count, $11,
  CASE WHEN sample_count < 5 THEN 0 ELSE ROUND((((win_count::numeric/sample_count)-0.5)*2 + (total_pnl_usd/sample_count) + LEAST(previous_avg_max + ($9 - previous_avg_max)/sample_count,10)/10)::numeric,4) END,
  NOW()
FROM calc WHERE pattern_key IS NOT NULL
ON CONFLICT (pattern_key) DO UPDATE SET sample_count=EXCLUDED.sample_count, win_count=EXCLUDED.win_count, loss_count=EXCLUDED.loss_count,
total_pnl_usd=EXCLUDED.total_pnl_usd, avg_pnl_usd=EXCLUDED.avg_pnl_usd, avg_max_multiplier=EXCLUDED.avg_max_multiplier,
last_outcome_label=EXCLUDED.last_outcome_label, confidence_score=EXCLUDED.confidence_score, updated_at=NOW()
RETURNING pattern_key, sample_count, confidence_score`,
    [4740, 640], "={{ [$json.positionId, $json.exitPrice, $json.txHash, $json.exitReason, $json.pnlUsd, $json.finalMultiplier, $json.holdTimeSeconds, $json.entryPrice, $json.maxMultiplier, $json.wasWinner, $json.outcomeLabel] }}"),

  schedule("health-schedule", "Health Schedule", "minutes", "minutesInterval", 1, [120, 1180]),
  pg("pg-health-stats", "Postgres Health Stats",
    `SELECT COALESCE(SUM(CASE WHEN closed_at::date=CURRENT_DATE THEN pnl_usd ELSE 0 END),0) AS "dailyPnL",
COALESCE((SELECT COUNT(*) FROM positions WHERE status='closed' AND pnl_usd < 0 AND closed_at::date=CURRENT_DATE),0) AS "consecutiveLosses",
0 AS "apiFailures",
COALESCE((SELECT EXTRACT(EPOCH FROM (NOW()-MIN(created_at)))*1000 FROM positions WHERE status='open'),0) AS "oldestOpenPositionAgeMs",
(SELECT COUNT(*)::int FROM positions WHERE status='open') AS "openPositionsCount"`,
    [340, 1180]),
  codeNode("health-check", "Circuit Breaker Health Check", "07-circuit-breaker-health-check.js", [560, 1180]),
  ifString("if-health-halted", "IF Health Halted", "={{ $json.status }}", "equal", "halted", [780, 1180]),
  redis("redis-health-circuit", "Redis Set Health Circuit", { operation: "set", key: "trench:circuit_breaker", value: "={{ $json.reason }}", keyType: "string", expire: true, ttl: 86400 }, [1000, 1080]),
  pg("pg-write-system-state", "Postgres Write System State",
    `INSERT INTO system_state (daily_pnl, consecutive_losses, open_positions_count, circuit_breaker_active, api_failures_today, trades_executed_today)
VALUES ($1,$2,$3,$4,$5,COALESCE((SELECT trades_executed_today FROM system_state ORDER BY timestamp DESC LIMIT 1),0)) RETURNING id`,
    [1220, 1080], "={{ [$json.dailyPnL, $json.consecutiveLosses, $json.openPositionsCount, $json.status === 'halted', $json.apiFailures] }}"),
  noop("health-ok", "Health OK", [1000, 1280]),

  manual("startup-manual", "Startup Recovery Manual", [120, 1500]),
  pg("pg-startup-close-stale", "Postgres Startup Close Stale",
    "UPDATE positions SET status='timeout', closed_at=NOW(), exit_reason='timeout_recovery' WHERE status='open' AND created_at < NOW() - INTERVAL '45 minutes' RETURNING id",
    [340, 1500]),
  pg("pg-startup-count-open", "Postgres Startup Count Open", "SELECT COUNT(*)::int AS open_positions_count FROM positions WHERE status='open'", [560, 1500]),
  redis("redis-set-open-positions", "Redis Set Open Positions", { operation: "set", key: "trench:open_positions", value: "={{ $json.open_positions_count }}", keyType: "string" }, [780, 1500])
];

link("Signal Webhook", "Extract Token Address");
link("Extract Token Address", "IF Parsed");
link("IF Parsed", "Redis Get Duplicate", 0);
link("IF Parsed", "Merge Duplicate", 0, 0);
link("IF Parsed", "Ignored Signal", 1);
link("Redis Get Duplicate", "Merge Duplicate", 0, 1);
link("Merge Duplicate", "Redis Get Daily Count");
link("Merge Duplicate", "Merge Daily", 0, 0);
link("Redis Get Daily Count", "Merge Daily", 0, 1);
link("Merge Daily", "Redis Get Circuit Breaker");
link("Merge Daily", "Merge Circuit", 0, 0);
link("Redis Get Circuit Breaker", "Merge Circuit", 0, 1);
link("Merge Circuit", "Postgres System State");
link("Merge Circuit", "Merge System State", 0, 0);
link("Postgres System State", "Merge System State", 0, 1);
link("Merge System State", "Admission Decision");
link("Admission Decision", "IF Admitted");
link("IF Admitted", "Redis Mark Token Seen", 0);
link("IF Admitted", "IF Queued", 1);
link("IF Queued", "Postgres Insert Queue", 0);
link("IF Queued", "Postgres Log Rejection", 1);
link("Redis Mark Token Seen", "Postgres Insert Signal");
link("Postgres Insert Signal", "Parallel Security Check");
link("Parallel Security Check", "IF Security Safe");
link("IF Security Safe", "HTTP Market Data Entry", 0);
link("IF Security Safe", "Merge Market Entry", 0, 0);
link("IF Security Safe", "Postgres Log Security Abort", 1);
link("HTTP Market Data Entry", "Merge Market Entry", 0, 1);
link("Merge Market Entry", "Normalize Market Entry");
link("Normalize Market Entry", "Build Learning Features");
link("Build Learning Features", "Postgres Insert Features");
link("Postgres Insert Features", "Postgres Get Pattern");
link("Postgres Get Pattern", "Learning Admission Filter");
link("Learning Admission Filter", "Dynamic Bet Size");
link("Dynamic Bet Size", "IF Trade Allowed");
link("IF Trade Allowed", "Prepare Buy Quote", 0);
link("IF Trade Allowed", "Redis Set Budget Circuit", 1);
link("Prepare Buy Quote", "IF Buy Quote Ready");
link("IF Buy Quote Ready", "HTTP Jupiter Buy Quote", 0);
link("IF Buy Quote Ready", "Postgres Log Buy Not Ready", 1);
link("Prepare Buy Quote", "Merge Buy Quote", 0, 0);
link("HTTP Jupiter Buy Quote", "Merge Buy Quote", 0, 1);
link("Merge Buy Quote", "Prepare Buy Swap");
link("Prepare Buy Swap", "IF Buy Swap Ready");
link("IF Buy Swap Ready", "HTTP Jupiter Buy Swap", 0);
link("IF Buy Swap Ready", "Postgres Log Buy Not Ready", 1);
link("Prepare Buy Swap", "Merge Buy Swap", 0, 0);
link("HTTP Jupiter Buy Swap", "Merge Buy Swap", 0, 1);
link("Merge Buy Swap", "Normalize Buy Swap");
link("Normalize Buy Swap", "Prepare Buy Signer");
link("Prepare Buy Signer", "IF Buy Signer Configured");
link("IF Buy Signer Configured", "HTTP Buy Signer", 0);
link("IF Buy Signer Configured", "Postgres Log Paper Buy", 1);
link("Prepare Buy Signer", "Merge Buy Signer", 0, 0);
link("HTTP Buy Signer", "Merge Buy Signer", 0, 1);
link("Merge Buy Signer", "Normalize Buy Signer");
link("Normalize Buy Signer", "IF Bought");
link("IF Bought", "Postgres Insert Position", 0);
link("IF Bought", "Postgres Log Buy Not Ready", 1);
link("Postgres Insert Position", "Redis Increment Daily Count");

link("Monitor Schedule", "Postgres Open Positions");
link("Postgres Open Positions", "Prepare Monitor Item");
link("Prepare Monitor Item", "HTTP Market Data Monitor");
link("Prepare Monitor Item", "Merge Monitor Market", 0, 0);
link("HTTP Market Data Monitor", "Merge Monitor Market", 0, 1);
link("Merge Monitor Market", "Normalize Market Monitor");
link("Normalize Market Monitor", "Monitor Exit Decision");
link("Monitor Exit Decision", "IF Exit Needed");
link("IF Exit Needed", "Prepare Sell Quote", 0);
link("IF Exit Needed", "Postgres Update Hold", 1);
link("Prepare Sell Quote", "HTTP Jupiter Sell Quote");
link("Prepare Sell Quote", "Merge Sell Quote", 0, 0);
link("HTTP Jupiter Sell Quote", "Merge Sell Quote", 0, 1);
link("Merge Sell Quote", "Prepare Sell Swap");
link("Prepare Sell Swap", "HTTP Jupiter Sell Swap");
link("Prepare Sell Swap", "Merge Sell Swap", 0, 0);
link("HTTP Jupiter Sell Swap", "Merge Sell Swap", 0, 1);
link("Merge Sell Swap", "Normalize Sell Swap");
link("Normalize Sell Swap", "Prepare Sell Signer");
link("Prepare Sell Signer", "IF Sell Signer Configured");
link("IF Sell Signer Configured", "HTTP Sell Signer", 0);
link("IF Sell Signer Configured", "Postgres Log Paper Sell", 1);
link("Prepare Sell Signer", "Merge Sell Signer", 0, 0);
link("HTTP Sell Signer", "Merge Sell Signer", 0, 1);
link("Merge Sell Signer", "Normalize Sell Signer");
link("Normalize Sell Signer", "IF Sold");
link("IF Sold", "IF Partial Exit", 0);
link("IF Sold", "Postgres Log Sell Not Ready", 1);
link("IF Partial Exit", "Postgres Mark Partial TP", 0);
link("IF Partial Exit", "Prepare Learning Outcome", 1);
link("Prepare Learning Outcome", "Postgres Close Position And Learn");

link("Health Schedule", "Postgres Health Stats");
link("Postgres Health Stats", "Circuit Breaker Health Check");
link("Circuit Breaker Health Check", "IF Health Halted");
link("IF Health Halted", "Redis Set Health Circuit", 0);
link("IF Health Halted", "Health OK", 1);
link("Redis Set Health Circuit", "Postgres Write System State");
link("Startup Recovery Manual", "Postgres Startup Close Stale");
link("Postgres Startup Close Stale", "Postgres Startup Count Open");
link("Postgres Startup Count Open", "Redis Set Open Positions");

writeFileSync(workflowPath, `${JSON.stringify({ name: "Trench Predator V1.1", nodes, connections: c, settings: { executionOrder: "v1" }, pinData: {} }, null, 2)}\n`);
console.log(`Synced ${nodes.length} nodes into ${workflowPath}.`);
