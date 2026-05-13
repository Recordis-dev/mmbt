const tokenAddress = $json.tokenAddress;
const today = new Date().toISOString().slice(0, 10);

const tokenKey = `trench:token:${tokenAddress}`;
const dailyCountKey = `trench:daily:count:${today}`;
const circuitBreakerKey = "trench:circuit_breaker";
const openPositionsKey = "trench:open_positions";

const duplicate = await redis.exists(tokenKey);
if (duplicate) {
  return [{ json: { status: "duplicate", tokenAddress } }];
}

const dailyCount = Number(await redis.get(dailyCountKey) ?? 0);
if (dailyCount >= 200) {
  return [{ json: { status: "daily_limit_reached", tokenAddress } }];
}

const circuitBreaker = await redis.get(circuitBreakerKey);
if (circuitBreaker) {
  return [{ json: { status: "circuit_breaker_active", tokenAddress } }];
}

const openPositions = Number(await redis.get(openPositionsKey) ?? 0);
if (openPositions >= 3) {
  await db.query(
    "INSERT INTO signal_queue (token_address, source_channel, raw_message) VALUES ($1, $2, $3)",
    [tokenAddress, $json.sourceChannel, $json.rawMessage]
  );
  return [{ json: { status: "queue", tokenAddress } }];
}

await redis.set(tokenKey, "seen", "EX", 86400);
return [{ json: { status: "approved", tokenAddress } }];
