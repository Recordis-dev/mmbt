import { DEFAULT_LIMITS } from "./config.js";

export function evaluateCircuitBreaker(stats = {}, limits = DEFAULT_LIMITS) {
  const triggers = [
    {
      condition: Number(stats.dailyPnL ?? 0) <= limits.dailyLossLimitUsd,
      reason: "Daily loss limit reached"
    },
    {
      condition: Number(stats.consecutiveLosses ?? 0) >= limits.maxConsecutiveLosses,
      reason: "Consecutive losses limit"
    },
    {
      condition: Number(stats.apiFailures ?? 0) > 20,
      reason: "Excessive API failures"
    },
    {
      condition: Number(stats.oldestOpenPositionAgeMs ?? 0) > limits.positionTimeoutMs,
      reason: "Position timeout risk"
    }
  ];

  const trigger = triggers.find((candidate) => candidate.condition);

  if (!trigger) {
    return { status: "healthy" };
  }

  return {
    status: "halted",
    reason: trigger.reason
  };
}
