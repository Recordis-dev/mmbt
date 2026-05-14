const patternKey = $json.patternKey;

if (!patternKey) {
  return [{ json: { ...$json, learningAction: "neutral", learningReason: "No pattern key" } }];
}

const pattern = $json.learningPattern ?? $json;
const decision = scorePattern(pattern);

if (decision.action === "block_or_reduce") {
  return [{
    json: {
      ...$json,
      learningAction: "reduce",
      betSizeUsd: Math.max(0.1, Number($json.betSizeUsd ?? 0.25) * 0.5),
      learningReason: decision.reason,
      confidenceScore: decision.confidenceScore
    }
  }];
}

return [{
  json: {
    ...$json,
    learningAction: decision.action,
    learningReason: decision.reason,
    confidenceScore: decision.confidenceScore
  }
}];

function scorePattern(pattern = {}) {
  const sampleCount = Number(pattern.sample_count ?? 0);
  const winCount = Number(pattern.win_count ?? 0);
  const totalPnlUsd = Number(pattern.total_pnl_usd ?? 0);
  const avgMaxMultiplier = Number(pattern.avg_max_multiplier ?? 0);

  if (sampleCount < 5) {
    return { action: "neutral", confidenceScore: 0, reason: "Insufficient samples" };
  }

  const winRate = winCount / sampleCount;
  const pnlPerTrade = totalPnlUsd / sampleCount;
  const confidenceScore = round((winRate - 0.5) * 2 + pnlPerTrade + Math.min(avgMaxMultiplier, 10) / 10);

  if (confidenceScore <= -0.5) {
    return { action: "block_or_reduce", confidenceScore, reason: "Pattern has negative historical expectancy" };
  }

  if (confidenceScore >= 0.8) {
    return { action: "allow", confidenceScore, reason: "Pattern has positive historical expectancy" };
  }

  return { action: "neutral", confidenceScore, reason: "Pattern is inconclusive" };
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}
