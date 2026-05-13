const position = $json.position;
const metrics = $json.metrics;
const currentPrice = Number(metrics.currentPrice);
const entryPrice = Number(position.entryPrice);
const highestPrice = Math.max(Number(position.highestPrice ?? currentPrice), currentPrice);
const multiplier = currentPrice / entryPrice;

const riskSignals = analyzeLocally(metrics, position);
if (riskSignals.negativeCount >= 3) {
  return [{
    json: {
      action: "panic_exit",
      reason: riskSignals.reasons,
      riskSignals,
      positionId: position.id
    }
  }];
}

const stop = calculateTrailingStop(position, currentPrice, highestPrice);
if (stop.action === "full_exit") {
  return [{
    json: {
      action: "trailing_stop_exit",
      reason: `Price ${currentPrice} <= stop ${stop.price}`,
      stop,
      riskSignals,
      positionId: position.id
    }
  }];
}

if (stop.action === "partial_exit") {
  return [{
    json: {
      action: "partial_take_profit",
      amount: "50%",
      stop,
      riskSignals,
      positionId: position.id
    }
  }];
}

return [{
  json: {
    action: "hold",
    positionId: position.id,
    highestPrice,
    multiplier,
    stop,
    riskSignals
  }
}];

function analyzeLocally(metrics, position) {
  const signals = [];

  if (Number(position.avgVolume ?? 0) > 0 && Number(metrics.volume24h ?? 0) < Number(position.avgVolume) * 0.5) {
    signals.push("volume_decline");
  }

  if (Number(position.peakHolders ?? 0) > 0 && Number(metrics.holdersCount ?? 0) < Number(position.peakHolders) * 0.9) {
    signals.push("holder_drop");
  }

  const sellPressure = Number(metrics.sellPressure ?? 0) / (Number(metrics.buyPressure ?? 0) || 1);
  if (sellPressure > 3) signals.push("sell_pressure_spike");

  if (Number(metrics.networkFees ?? 0) > 100000) signals.push("network_congestion");

  return {
    negativeCount: signals.length,
    signals,
    reasons: signals.join(", "),
    source: "local_engine"
  };
}

function calculateTrailingStop(position, currentPrice, highestPrice) {
  const entryPrice = Number(position.entryPrice);
  const multiplier = currentPrice / entryPrice;
  const stopLossPrice = entryPrice * 0.34;

  if (currentPrice <= stopLossPrice) {
    return { type: "hard_stop_loss", action: "full_exit", price: stopLossPrice, multiplier };
  }

  if (multiplier >= 2 && !position.partialTPTaken) {
    return { type: "partial_take_profit", action: "partial_exit", amount: "50%", multiplier: 2 };
  }

  if (multiplier <= 2) {
    return { type: "stop_loss_only", action: "hold", price: stopLossPrice, multiplier };
  }

  const percentage = multiplier <= 10
    ? 20 + (multiplier - 2) * 1.5
    : Math.min(32 + (multiplier - 10) * 2.5, 55);

  const price = highestPrice * (1 - percentage / 100);
  return {
    type: "trailing_stop",
    action: currentPrice <= price ? "full_exit" : "hold",
    price,
    percentage,
    highestPrice,
    multiplier
  };
}
