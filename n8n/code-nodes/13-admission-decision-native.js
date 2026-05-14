const duplicate = $json.duplicateValue !== null && $json.duplicateValue !== undefined;
const dailyCount = Math.max(
  Number($json.dailyCountValue ?? 0),
  Number($json.trades_executed_today ?? 0)
);
const circuitBreakerActive = Boolean($json.circuitBreakerValue) || Boolean($json.circuit_breaker_active);
const openPositions = Math.max(
  Number($json.open_positions_count ?? 0),
  Number($json.openPositionsCount ?? 0)
);

if (duplicate) {
  return [{ json: { ...$json, status: "duplicate", reason: "Token already seen in Redis" } }];
}

if (dailyCount >= 200) {
  return [{ json: { ...$json, status: "daily_limit_reached", reason: "Daily trade limit reached", dailyCount } }];
}

if (circuitBreakerActive) {
  return [{ json: { ...$json, status: "circuit_breaker_active", reason: "Circuit breaker is active" } }];
}

if (openPositions >= 3) {
  return [{ json: { ...$json, status: "queue", reason: "Open position cap reached", openPositions } }];
}

return [{
  json: {
    ...$json,
    status: "approved",
    dailyPnL: Number($json.daily_pnl ?? 0),
    consecutiveLosses: Number($json.consecutive_losses ?? 0),
    dailyCount,
    openPositions
  }
}];
