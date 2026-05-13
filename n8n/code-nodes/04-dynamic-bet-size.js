const dailyPnL = Number($json.dailyPnL ?? 0);
const consecutiveLosses = Number($json.consecutiveLosses ?? 0);

let betSizeUsd = 0.25;

if (dailyPnL <= -15 || consecutiveLosses >= 15) {
  await redis.set("trench:circuit_breaker", "1", "EX", 86400);
  return [{
    json: {
      action: "HALT",
      reason: "Circuit breaker activated",
      betSizeUsd: 0
    }
  }];
}

if (dailyPnL < -10) betSizeUsd = 0.15;
if (dailyPnL < -20) betSizeUsd = 0.10;
if (consecutiveLosses >= 5) betSizeUsd *= 0.8;
if (consecutiveLosses >= 10) betSizeUsd *= 0.5;

return [{
  json: {
    ...$json,
    action: "TRADE",
    betSizeUsd: Math.round(betSizeUsd * 100) / 100
  }
}];
