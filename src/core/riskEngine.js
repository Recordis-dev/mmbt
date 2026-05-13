/**
 * Analyzes market metrics against current position state to detect red flags.
 * @param {Object} metrics - Current market metrics (volume, holders, pressure, fees).
 * @param {Object} position - Current position data (avgVolume, peakHolders).
 * @returns {Object} - Analysis result with signals and negative count.
 */
export function analyzeLocally(metrics = {}, position = {}) {
  const signals = [];

  const avgVolume = Number(position.avgVolume ?? 0);
  if (avgVolume > 0 && Number(metrics.volume24h ?? 0) < avgVolume * 0.5) {
    signals.push("volume_decline");
  }

  const peakHolders = Number(position.peakHolders ?? 0);
  if (peakHolders > 0 && Number(metrics.holdersCount ?? 0) < peakHolders * 0.9) {
    signals.push("holder_drop");
  }

  const buyPressure = Number(metrics.buyPressure ?? 0) || 1;
  const sellPressureRatio = Number(metrics.sellPressure ?? 0) / buyPressure;
  if (sellPressureRatio > 3) {
    signals.push("sell_pressure_spike");
  }

  if (Number(metrics.networkFees ?? 0) > 100000) {
    signals.push("network_congestion");
  }

  return {
    negativeCount: signals.length,
    signals,
    reasons: signals.join(", "),
    source: "local_engine"
  };
}

/**
 * Decides if a panic exit is required based on risk signals.
 * @param {Object} riskSignals - The output from analyzeLocally.
 * @returns {Object} - Action (panic_exit or continue).
 */
export function decideRiskAction(riskSignals) {
  if (Number(riskSignals?.negativeCount ?? 0) >= 3) {
    return {
      action: "panic_exit",
      reason: riskSignals.reasons
    };
  }

  return {
    action: "continue"
  };
}
