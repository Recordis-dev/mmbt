const features = buildLearningFeatures({
  securityScore: $json.securityScore,
  market: $json.market,
  risk: $json.riskSignals
});

const patternKey = buildPatternKey(features);

return [{
  json: {
    ...$json,
    learningFeatures: features,
    patternKey,
    securitySnapshot: JSON.stringify(features.security),
    marketSnapshot: JSON.stringify(features.market),
    riskSnapshot: JSON.stringify(features.risk)
  }
}];

function buildLearningFeatures(input = {}) {
  const securityScore = input.securityScore ?? {};
  const market = input.market ?? {};
  const risk = input.risk ?? {};

  return {
    featureVersion: "v1.1",
    security: {
      rugcheck: Boolean(securityScore.rugcheck),
      goplus: Boolean(securityScore.goplus),
      solsniffer: Boolean(securityScore.solsniffer)
    },
    market: {
      liquidityUsd: Number(market.liquidityUsd ?? 0),
      volume5mUsd: Number(market.volume5mUsd ?? 0),
      volume24hUsd: Number(market.volume24hUsd ?? 0),
      holderCount: Number(market.holderCount ?? 0),
      top10HolderPercentage: Number(market.top10HolderPercentage ?? 100),
      buyPressure: Number(market.buyPressure ?? 0),
      sellPressure: Number(market.sellPressure ?? 0),
      tokenAgeMinutes: Number(market.tokenAgeMinutes ?? 0)
    },
    risk: {
      negativeCount: Number(risk.negativeCount ?? 0),
      source: risk.source ?? "unknown"
    }
  };
}

function buildPatternKey(features) {
  const pressureRatio = features.market.sellPressure / (features.market.buyPressure || 1);
  return [
    `liq:${bucket(features.market.liquidityUsd, [1000, 5000, 10000, 25000, 50000])}`,
    `vol5:${bucket(features.market.volume5mUsd, [500, 2500, 5000, 10000, 25000])}`,
    `holders:${bucket(features.market.holderCount, [25, 75, 150, 300, 600])}`,
    `top10:${bucket(features.market.top10HolderPercentage, [10, 20, 25, 35, 50])}`,
    `age:${bucket(features.market.tokenAgeMinutes, [5, 15, 30, 60, 180])}`,
    `sellbuy:${bucket(pressureRatio, [0.5, 1, 2, 3, 5])}`,
    `risk:${bucket(features.risk.negativeCount, [0, 1, 2, 3])}`
  ].join("|");
}

function bucket(value, thresholds) {
  for (const threshold of thresholds) {
    if (Number(value) <= threshold) return `lte_${threshold}`;
  }
  return `gt_${thresholds[thresholds.length - 1]}`;
}
