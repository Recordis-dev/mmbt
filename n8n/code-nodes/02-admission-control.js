const tokenAddress = $json.tokenAddress;

if (!tokenAddress) {
  return [{
    json: {
      ...$json,
      status: $json.status ?? "ignored",
      reason: $json.reason ?? "No token address found"
    }
  }];
}

const today = new Date().toISOString().slice(0, 10);

const tokenKey = `trench:token:${tokenAddress}`;
const dailyCountKey = `trench:daily:count:${today}`;
const circuitBreakerKey = "trench:circuit_breaker";
const openPositionsKey = "trench:open_positions";

const systemStateResult = await db.query(
  `SELECT daily_pnl, consecutive_losses, open_positions_count, circuit_breaker_active, trades_executed_today
   FROM system_state
   ORDER BY timestamp DESC
   LIMIT 1`
);

const systemState = systemStateResult.rows[0] ?? {};
const dailyPnL = Number(systemState.daily_pnl ?? 0);
const consecutiveLosses = Number(systemState.consecutive_losses ?? 0);
const dbOpenPositions = Number(systemState.open_positions_count ?? 0);
const dbDailyCount = Number(systemState.trades_executed_today ?? 0);

const duplicate = await redis.exists(tokenKey);
if (duplicate) {
  return [{ json: { status: "duplicate", tokenAddress } }];
}

const dailyCount = Math.max(Number(await redis.get(dailyCountKey) ?? 0), dbDailyCount);
if (dailyCount >= 200) {
  return [{ json: { status: "daily_limit_reached", tokenAddress } }];
}

const circuitBreaker = await redis.get(circuitBreakerKey);
if (circuitBreaker || systemState.circuit_breaker_active) {
  return [{ json: { status: "circuit_breaker_active", tokenAddress } }];
}

const openPositions = Math.max(Number(await redis.get(openPositionsKey) ?? 0), dbOpenPositions);
if (openPositions >= 3) {
  await db.query(
    "INSERT INTO signal_queue (token_address, source_channel, raw_message) VALUES ($1, $2, $3)",
    [tokenAddress, $json.sourceChannel, $json.rawMessage]
  );
  return [{ json: { status: "queue", tokenAddress } }];
}

await redis.set(tokenKey, "seen", "EX", 86400);

const signalResult = await db.query(
  `INSERT INTO signals (token_address, source_channel, raw_message, status)
   VALUES ($1, $2, $3, $4)
   RETURNING id`,
  [tokenAddress, $json.sourceChannel, $json.rawMessage, "approved"]
);

return [{
  json: {
    ...$json,
    status: "approved",
    tokenAddress,
    signalId: signalResult.rows[0]?.id,
    dailyPnL,
    consecutiveLosses,
    openPositions,
    dailyCount
  }
}];
