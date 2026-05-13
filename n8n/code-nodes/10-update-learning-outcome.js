const position = $json.position;
const entryPrice = Number(position.entryPrice);
const exitPrice = Number($json.exitPrice);
const finalMultiplier = exitPrice / entryPrice;
const maxMultiplier = Number(position.highestPrice ?? exitPrice) / entryPrice;
const pnlUsd = Number($json.pnlUsd ?? position.pnlUsd ?? 0);
const holdTimeSeconds = Math.max(0, Math.floor((Date.now() - new Date(position.createdAt ?? position.created_at).getTime()) / 1000));
const wasWinner = pnlUsd > 0 || finalMultiplier >= 2;
const outcomeLabel = labelOutcome({ finalMultiplier, maxMultiplier, pnlUsd });

await db.query(
  `INSERT INTO trade_outcomes (
    position_id,
    token_address,
    hold_time_seconds,
    entry_price,
    exit_price,
    max_multiplier,
    final_multiplier,
    pnl_usd,
    exit_reason,
    was_winner,
    outcome_label
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [
    position.id,
    position.tokenAddress ?? position.token_address,
    holdTimeSeconds,
    entryPrice,
    exitPrice,
    maxMultiplier,
    finalMultiplier,
    pnlUsd,
    $json.exitReason ?? "unknown",
    wasWinner,
    outcomeLabel
  ]
);

const featureResult = await db.query(
  "SELECT pattern_key FROM trade_features WHERE position_id = $1 ORDER BY captured_at DESC LIMIT 1",
  [position.id]
);

const patternKey = featureResult.rows[0]?.pattern_key;
if (!patternKey) {
  return [{ json: { ...$json, learningUpdated: false, reason: "pattern_key_not_found" } }];
}

const patternResult = await db.query(
  "SELECT * FROM learning_patterns WHERE pattern_key = $1",
  [patternKey]
);

const current = patternResult.rows[0] ?? {};
const updated = updatePatternStats(current, {
  wasWinner,
  pnlUsd,
  maxMultiplier,
  outcomeLabel
});

await db.query(
  `INSERT INTO learning_patterns (
    pattern_key,
    sample_count,
    win_count,
    loss_count,
    total_pnl_usd,
    avg_pnl_usd,
    avg_max_multiplier,
    last_outcome_label,
    confidence_score,
    updated_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
  ON CONFLICT (pattern_key) DO UPDATE SET
    sample_count = EXCLUDED.sample_count,
    win_count = EXCLUDED.win_count,
    loss_count = EXCLUDED.loss_count,
    total_pnl_usd = EXCLUDED.total_pnl_usd,
    avg_pnl_usd = EXCLUDED.avg_pnl_usd,
    avg_max_multiplier = EXCLUDED.avg_max_multiplier,
    last_outcome_label = EXCLUDED.last_outcome_label,
    confidence_score = EXCLUDED.confidence_score,
    updated_at = NOW()`,
  [
    patternKey,
    updated.sampleCount,
    updated.winCount,
    updated.lossCount,
    updated.totalPnlUsd,
    updated.avgPnlUsd,
    updated.avgMaxMultiplier,
    updated.lastOutcomeLabel,
    updated.confidenceScore
  ]
);

return [{
  json: {
    ...$json,
    learningUpdated: true,
    patternKey,
    outcomeLabel,
    patternStats: updated
  }
}];

function labelOutcome(outcome = {}) {
  if (Number(outcome.maxMultiplier ?? 0) >= 10) return "moonshot";
  if (Number(outcome.finalMultiplier ?? 0) >= 2 || Number(outcome.pnlUsd ?? 0) > 0) return "winner";
  if (Number(outcome.finalMultiplier ?? 0) <= 0.34) return "hard_loss";
  if (Number(outcome.pnlUsd ?? 0) < 0) return "loser";
  return "flat";
}

function updatePatternStats(pattern = {}, outcome = {}) {
  const sampleCount = Number(pattern.sample_count ?? pattern.sampleCount ?? 0) + 1;
  const winCount = Number(pattern.win_count ?? pattern.winCount ?? 0) + (outcome.wasWinner ? 1 : 0);
  const lossCount = sampleCount - winCount;
  const totalPnlUsd = Number(pattern.total_pnl_usd ?? pattern.totalPnlUsd ?? 0) + Number(outcome.pnlUsd ?? 0);
  const previousAvgMax = Number(pattern.avg_max_multiplier ?? pattern.avgMaxMultiplier ?? 0);
  const avgMaxMultiplier = previousAvgMax + (Number(outcome.maxMultiplier ?? 0) - previousAvgMax) / sampleCount;
  const avgPnlUsd = totalPnlUsd / sampleCount;
  const winRate = winCount / sampleCount;
  const confidenceScore = sampleCount < 5 ? 0 : (winRate - 0.5) * 2 + avgPnlUsd + Math.min(avgMaxMultiplier, 10) / 10;

  return {
    sampleCount,
    winCount,
    lossCount,
    totalPnlUsd: round(totalPnlUsd),
    avgPnlUsd: round(avgPnlUsd),
    avgMaxMultiplier: round(avgMaxMultiplier),
    lastOutcomeLabel: outcome.outcomeLabel,
    confidenceScore: round(confidenceScore)
  };
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}
