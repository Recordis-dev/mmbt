export const DEFAULT_LIMITS = Object.freeze({
  dailyBudgetUsd: 50,
  maxTradesPerDay: 200,
  baseBetUsd: 0.25,
  dailyLossLimitUsd: -15,
  maxConsecutiveLosses: 15,
  maxOpenPositions: 3,
  positionTimeoutMs: 45 * 60 * 1000,
  securityTimeoutMs: 800,
  minSecurityResponses: 2,
  rugcheckMaxScore: 500,
  solSnifferMaxTop10Pct: 25,
  monitorLockSeconds: 60,
  apiFailuresThreshold: 20
});

export const SOL_MINT = "So11111111111111111111111111111111111111112";
