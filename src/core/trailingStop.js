export function calculateTrailingStop(position, currentPrice) {
  const entryPrice = Number(position.entryPrice);
  const highestPrice = Number(position.highestPrice ?? currentPrice);
  const price = Number(currentPrice);
  const partialTPTaken = Boolean(position.partialTPTaken);

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error("entryPrice must be a positive number");
  }

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("currentPrice must be a positive number");
  }

  const multiplier = price / entryPrice;
  const stopLossPrice = entryPrice * 0.34;

  if (price <= stopLossPrice) {
    return {
      type: "hard_stop_loss",
      action: "full_exit",
      price: stopLossPrice,
      multiplier
    };
  }

  if (multiplier >= 2 && !partialTPTaken) {
    return {
      type: "partial_take_profit",
      action: "partial_exit",
      amount: "50%",
      multiplier: 2
    };
  }

  if (multiplier <= 2) {
    return {
      type: "stop_loss_only",
      action: "hold",
      price: stopLossPrice,
      multiplier
    };
  }

  const trailingStopPercentage = multiplier <= 10
    ? 20 + (multiplier - 2) * 1.5
    : Math.min(32 + (multiplier - 10) * 2.5, 55);

  const trailingStopPrice = highestPrice * (1 - trailingStopPercentage / 100);

  return {
    type: "trailing_stop",
    action: price <= trailingStopPrice ? "full_exit" : "hold",
    price: trailingStopPrice,
    percentage: trailingStopPercentage,
    highestPrice,
    multiplier
  };
}
