const metricsSnapshot = {
  tokenAddress: $json.tokenAddress,
  status: $json.status,
  betSizeUsd: $json.betSizeUsd,
  lamportsAmount: $json.lamportsAmount,
  outputAmount: $json.outputAmount,
  learningAction: $json.learningAction,
  learningReason: $json.learningReason,
  confidenceScore: $json.confidenceScore,
  patternKey: $json.patternKey,
  securityScore: $json.securityScore
};

await db.query(
  `INSERT INTO decision_logs (decision_type, reason, metrics_snapshot, source)
   VALUES ($1, $2, $3, $4)`,
  [
    "buy_attempt",
    $json.status === "swap_ready" ? "swap_transaction_built" : $json.reason ?? $json.status,
    JSON.stringify(metricsSnapshot),
    "local_engine"
  ]
);

if ($json.status === "swap_ready") {
  const dailyCountKey = "trench:daily:count:" + new Date().toISOString().slice(0, 10);
  const dailyCount = Number(await redis.get(dailyCountKey) ?? 0) + 1;
  await redis.set(dailyCountKey, String(dailyCount), "EX", 86400);
}

return [{ json: $json }];
