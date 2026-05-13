import { DEFAULT_LIMITS } from "./config.js";

export function calculateBetSize(stats = {}, limits = DEFAULT_LIMITS) {
  const dailyPnL = Number(stats.dailyPnL ?? 0);
  const consecutiveLosses = Number(stats.consecutiveLosses ?? 0);

  if (
    dailyPnL <= limits.dailyLossLimitUsd ||
    consecutiveLosses >= limits.maxConsecutiveLosses
  ) {
    return {
      action: "HALT",
      reason: "Circuit breaker activated",
      betSizeUsd: 0
    };
  }

  let betSizeUsd = limits.baseBetUsd;

  if (dailyPnL < -10) betSizeUsd = 0.15;
  if (dailyPnL < -20) betSizeUsd = 0.1;
  if (consecutiveLosses >= 5) betSizeUsd *= 0.8;
  if (consecutiveLosses >= 10) betSizeUsd *= 0.5;

  return {
    action: "TRADE",
    betSizeUsd: roundUsd(betSizeUsd)
  };
}

export function evaluateAdmission(state = {}, limits = DEFAULT_LIMITS) {
  if (state.duplicate) {
    return { status: "duplicate" };
  }

  if (Number(state.dailyCount ?? 0) >= limits.maxTradesPerDay) {
    return { status: "daily_limit_reached" };
  }

  if (state.circuitBreakerActive) {
    return { status: "circuit_breaker_active" };
  }

  if (Number(state.openPositions ?? 0) >= limits.maxOpenPositions) {
    return { status: "queue" };
  }

  return { status: "approved" };
}

function roundUsd(value) {
  return Math.round(value * 100) / 100;
}
