const LIMITS = {
  dailyLossLimitUsd:    Number($env.DAILY_LOSS_LIMIT_USD ?? -15),
  maxConsecutiveLosses: Number($env.MAX_CONSECUTIVE_LOSSES ?? 15),
  apiFailuresThreshold: Number($env.API_FAILURES_THRESHOLD ?? 20),
  positionTimeoutMs:    Number($env.POSITION_TIMEOUT_MS ?? 45 * 60 * 1000)
};

const dailyPnL = Number($json.dailyPnL ?? 0);
const consecutiveLosses = Number($json.consecutiveLosses ?? 0);
const apiFailures = Number($json.apiFailures ?? 0);
const oldestOpenPositionAgeMs = Number($json.oldestOpenPositionAgeMs ?? 0);
const openPositionsCount = Number($json.openPositionsCount ?? 0);

const triggers = [
  { condition: dailyPnL <= LIMITS.dailyLossLimitUsd, reason: "Daily loss limit reached" },
  { condition: consecutiveLosses >= LIMITS.maxConsecutiveLosses, reason: "Consecutive losses limit" },
  { condition: apiFailures > LIMITS.apiFailuresThreshold, reason: "Excessive API failures" },
  { condition: oldestOpenPositionAgeMs > LIMITS.positionTimeoutMs, reason: "Position timeout risk" }
];

const trigger = triggers.find((t) => t.condition);

return [{
  json: {
    status: trigger ? "halted" : "healthy",
    circuitBreakerActive: !!trigger,
    circuitBreakerReason: trigger?.reason ?? null,
    dailyPnL,
    consecutiveLosses,
    apiFailures,
    oldestOpenPositionAgeMs,
    openPositionsCount
  }
}];
