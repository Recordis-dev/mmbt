const stats = $json.stats ?? $json;

const triggers = [
  { condition: Number(stats.dailyPnL ?? 0) <= -15, reason: "Daily loss limit reached" },
  { condition: Number(stats.consecutiveLosses ?? 0) >= 15, reason: "Consecutive losses limit" },
  { condition: Number(stats.apiFailures ?? 0) > 20, reason: "Excessive API failures" },
  { condition: Number(stats.oldestOpenPositionAgeMs ?? 0) > 45 * 60 * 1000, reason: "Position timeout risk" }
];

const trigger = triggers.find((item) => item.condition);

if (!trigger) {
  return [{ json: { status: "healthy" } }];
}

await redis.set("trench:circuit_breaker", trigger.reason, "EX", 86400);

return [{
  json: {
    status: "halted",
    reason: trigger.reason,
    closeAllPositions: true,
    notifyAdmin: true
  }
}];
