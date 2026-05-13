import { DEFAULT_LIMITS } from "./config.js";

/**
 * Calculates the bet size for a new trade based on recent performance.
 * Also acts as a circuit breaker if losses are too high.
 * @param {Object} stats - System performance stats (dailyPnL, consecutiveLosses).
 * @param {Object} [limits=DEFAULT_LIMITS] - Budget and loss limits.
 * @returns {Object} - Action (TRADE/HALT) and recommended bet size.
 */
export function calculateBetSize(stats = {}, limits = DEFAULT_LIMITS) {
  const dailyPnL = Number(stats.dailyPnL ?? 0);
  const consecutiveLosses = Number(stats.consecutiveLosses ?? 0);

  // Check circuit breaker conditions
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

  // Dynamic sizing based on drawdown
  if (dailyPnL < -10) betSizeUsd = 0.15;
  if (dailyPnL < -20) betSizeUsd = 0.1;
  if (consecutiveLosses >= 5) betSizeUsd *= 0.8;
  if (consecutiveLosses >= 10) betSizeUsd *= 0.5;

  return {
    action: "TRADE",
    betSizeUsd: roundUsd(betSizeUsd)
  };
}

/**
 * Evaluates if a signal should be admitted for processing.
 * @param {Object} state - Current system state (duplicate, dailyCount, etc).
 * @param {Object} [limits=DEFAULT_LIMITS] - System limits.
 * @returns {Object} - Status (approved, duplicate, daily_limit_reached, circuit_breaker_active, queue).
 */
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

/**
 * Utility to round USD values to 2 decimal places.
 * @param {number} value
 * @returns {number}
 */
function roundUsd(value) {
  return Math.round(value * 100) / 100;
}
