export function buildLearningFeatures(input = {}) {
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

export function buildPatternKey(features) {
  const liquidityBucket = bucket(features.market.liquidityUsd, [1000, 5000, 10000, 25000, 50000]);
  const volumeBucket = bucket(features.market.volume5mUsd, [500, 2500, 5000, 10000, 25000]);
  const holdersBucket = features.market.holderCount > 0
    ? bucket(features.market.holderCount, [25, 75, 150, 300, 600])
    : "unknown";
  const top10Bucket = features.market.top10HolderPercentage > 0 && features.market.top10HolderPercentage < 100
    ? bucket(features.market.top10HolderPercentage, [10, 20, 25, 35, 50])
    : "unknown";
  const ageBucket = bucket(features.market.tokenAgeMinutes, [5, 15, 30, 60, 180]);
  const pressureRatio = features.market.sellPressure / (features.market.buyPressure || 1);
  const pressureBucket = bucket(pressureRatio, [0.5, 1, 2, 3, 5]);
  const riskBucket = bucket(features.risk.negativeCount, [0, 1, 2, 3]);

  return [
    `liq:${liquidityBucket}`,
    `vol5:${volumeBucket}`,
    `holders:${holdersBucket}`,
    `top10:${top10Bucket}`,
    `age:${ageBucket}`,
    `sellbuy:${pressureBucket}`,
    `risk:${riskBucket}`
  ].join("|");
}

export function labelOutcome(outcome = {}) {
  const finalMultiplier = Number(outcome.finalMultiplier ?? 0);
  const maxMultiplier = Number(outcome.maxMultiplier ?? finalMultiplier);
  const pnlUsd = Number(outcome.pnlUsd ?? 0);

  if (maxMultiplier >= 10) return "moonshot";
  if (finalMultiplier >= 2 || pnlUsd > 0) return "winner";
  if (finalMultiplier <= 0.34) return "hard_loss";
  if (pnlUsd < 0) return "loser";
  return "flat";
}

export function scorePattern(pattern = {}) {
  const sampleCount = Number(pattern.sampleCount ?? 0);
  const winCount = Number(pattern.winCount ?? 0);
  const totalPnlUsd = Number(pattern.totalPnlUsd ?? 0);
  const avgMaxMultiplier = Number(pattern.avgMaxMultiplier ?? 0);

  if (sampleCount < 5) {
    return {
      action: "neutral",
      confidenceScore: 0,
      reason: "Insufficient samples"
    };
  }

  const winRate = winCount / sampleCount;
  const pnlPerTrade = totalPnlUsd / sampleCount;
  const confidenceScore = roundScore((winRate - 0.5) * 2 + pnlPerTrade + Math.min(avgMaxMultiplier, 10) / 10);

  if (confidenceScore <= -0.5) {
    return {
      action: "block_or_reduce",
      confidenceScore,
      reason: "Pattern has negative historical expectancy"
    };
  }

  if (confidenceScore >= 0.8) {
    return {
      action: "allow",
      confidenceScore,
      reason: "Pattern has positive historical expectancy"
    };
  }

  return {
    action: "neutral",
    confidenceScore,
    reason: "Pattern is inconclusive"
  };
}

export function updatePatternStats(pattern = {}, outcome = {}) {
  const sampleCount = Number(pattern.sampleCount ?? 0) + 1;
  const wasWinner = Boolean(outcome.wasWinner);
  const winCount = Number(pattern.winCount ?? 0) + (wasWinner ? 1 : 0);
  const lossCount = sampleCount - winCount;
  const totalPnlUsd = Number(pattern.totalPnlUsd ?? 0) + Number(outcome.pnlUsd ?? 0);
  const previousAvgMax = Number(pattern.avgMaxMultiplier ?? 0);
  const maxMultiplier = Number(outcome.maxMultiplier ?? 0);
  const avgMaxMultiplier = previousAvgMax + (maxMultiplier - previousAvgMax) / sampleCount;
  const avgPnlUsd = totalPnlUsd / sampleCount;

  const scored = scorePattern({
    sampleCount,
    winCount,
    totalPnlUsd,
    avgMaxMultiplier
  });

  return {
    sampleCount,
    winCount,
    lossCount,
    totalPnlUsd: roundMoney(totalPnlUsd),
    avgPnlUsd: roundMoney(avgPnlUsd),
    avgMaxMultiplier: roundScore(avgMaxMultiplier),
    lastOutcomeLabel: outcome.outcomeLabel,
    confidenceScore: scored.confidenceScore
  };
}

function bucket(value, thresholds) {
  const numeric = Number(value);
  for (const threshold of thresholds) {
    if (numeric <= threshold) return `lte_${threshold}`;
  }
  return `gt_${thresholds.at(-1)}`;
}

function roundMoney(value) {
  return Math.round(value * 10000) / 10000;
}

function roundScore(value) {
  return Math.round(value * 10000) / 10000;
}
