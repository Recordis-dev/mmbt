const position = $json.position ?? {};
const entryPrice = Number(position.entryPrice ?? position.entry_price);
const exitPrice = Number($json.exitPrice ?? $json.metrics?.currentPrice ?? position.exit_price);
const finalMultiplier = entryPrice > 0 ? exitPrice / entryPrice : 0;
const maxMultiplier = entryPrice > 0 ? Number(position.highestPrice ?? position.highest_price ?? exitPrice) / entryPrice : finalMultiplier;
const pnlUsd = Number($json.pnlUsd ?? position.pnl_usd ?? 0);
const createdAt = position.createdAt ?? position.created_at ?? Date.now();
const holdTimeSeconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
const wasWinner = pnlUsd > 0 || finalMultiplier >= 2;
const outcomeLabel = labelOutcome({ finalMultiplier, maxMultiplier, pnlUsd });

return [{
  json: {
    ...$json,
    positionId: position.id ?? $json.positionId,
    tokenAddress: position.tokenAddress ?? position.token_address ?? $json.tokenAddress,
    holdTimeSeconds,
    entryPrice,
    exitPrice,
    maxMultiplier,
    finalMultiplier,
    pnlUsd,
    wasWinner,
    outcomeLabel,
    exitReason: $json.exitReason ?? $json.reason ?? $json.action ?? "unknown"
  }
}];

function labelOutcome(outcome = {}) {
  if (Number(outcome.maxMultiplier ?? 0) >= 10) return "moonshot";
  if (Number(outcome.finalMultiplier ?? 0) >= 2 || Number(outcome.pnlUsd ?? 0) > 0) return "winner";
  if (Number(outcome.finalMultiplier ?? 0) <= 0.34) return "hard_loss";
  if (Number(outcome.pnlUsd ?? 0) < 0) return "loser";
  return "flat";
}
