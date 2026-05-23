const LIMITS = {
  maxTradesPerDay: 200,
  maxOpenPositions: 3,
  dailyLossLimitUsd: -15,
  maxConsecutiveLosses: 15
};

const dailyPnL = Number($json.daily_pnl ?? 0);
const consecutiveLosses = Number($json.consecutive_losses ?? 0);
const tradesToday = Number($json.trades_today ?? 0);
const openPositions = Number($json.open_positions ?? 0);
const circuitBreakerActive = Boolean($json.circuit_breaker_active);
const duplicate = Boolean($json.duplicate);

if (duplicate) {
  return [{ json: { ...$json, status: "duplicate", reason: "Token seen in last 24h" } }];
}

if (circuitBreakerActive
    || dailyPnL <= LIMITS.dailyLossLimitUsd
    || consecutiveLosses >= LIMITS.maxConsecutiveLosses) {
  return [{ json: { ...$json, status: "circuit_breaker_active", reason: "Circuit breaker engaged" } }];
}

if (tradesToday >= LIMITS.maxTradesPerDay) {
  return [{ json: { ...$json, status: "daily_limit_reached", reason: "Daily trade limit reached" } }];
}

if (openPositions >= LIMITS.maxOpenPositions) {
  return [{ json: { ...$json, status: "queue", reason: "Open positions at cap" } }];
}

return [{
  json: {
    ...$json,
    status: "approved",
    dailyPnL,
    consecutiveLosses,
    tradesToday,
    openPositions
  }
}];
