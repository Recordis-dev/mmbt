// Limits — overridable via env (mirrors src/core/config.js DEFAULT_LIMITS).
const LIMITS = {
  baseBetUsd:          Number($env.BASE_BET_USD ?? 0.25),
  dailyLossLimitUsd:   Number($env.DAILY_LOSS_LIMIT_USD ?? -15),
  maxConsecutiveLosses: Number($env.MAX_CONSECUTIVE_LOSSES ?? 15),
  minBetUsd:           Number($env.MIN_BET_USD ?? 0.10),
  reduceLossThreshold: Number($env.REDUCE_LOSS_THRESHOLD ?? -10),
  hardReduceLossThreshold: Number($env.HARD_REDUCE_LOSS_THRESHOLD ?? -20)
};

const tokenAddress = $json.tokenAddress;
const dailyPnL = Number($json.dailyPnL ?? 0);
const consecutiveLosses = Number($json.consecutiveLosses ?? 0);
const sampleCount = Number($json.sample_count ?? 0);
const winCount = Number($json.win_count ?? 0);
const totalPnlUsd = Number($json.total_pnl_usd ?? 0);
const avgMaxMultiplier = Number($json.avg_max_multiplier ?? 0);
const entryPriceUsd = Number($json.entryPriceUsd ?? 0);

// --- Bet size (budget engine) ---
let betSizeUsd = LIMITS.baseBetUsd;
if (dailyPnL <= LIMITS.dailyLossLimitUsd || consecutiveLosses >= LIMITS.maxConsecutiveLosses) {
  return [{ json: { ...$json, status: "halt", action: "HALT", reason: "Circuit breaker activated", betSizeUsd: 0 } }];
}
if (dailyPnL < LIMITS.reduceLossThreshold) betSizeUsd = 0.15;
if (dailyPnL < LIMITS.hardReduceLossThreshold) betSizeUsd = LIMITS.minBetUsd;
if (consecutiveLosses >= 5)  betSizeUsd *= 0.8;
if (consecutiveLosses >= 10) betSizeUsd *= 0.5;

// --- Learning filter ---
let learningAction = "neutral";
let learningReason = "Insufficient samples";
let confidenceScore = 0;
if (sampleCount >= 5) {
  const winRate = winCount / sampleCount;
  const pnlPerTrade = totalPnlUsd / sampleCount;
  confidenceScore = Math.round(
    ((winRate - 0.5) * 2 + pnlPerTrade + Math.min(avgMaxMultiplier, 10) / 10) * 10000
  ) / 10000;
  if (confidenceScore <= -0.5) {
    learningAction = "reduce";
    learningReason = "Pattern has negative historical expectancy";
    betSizeUsd = Math.max(LIMITS.minBetUsd, betSizeUsd * 0.5);
  } else if (confidenceScore >= 0.8) {
    learningAction = "allow";
    learningReason = "Pattern has positive historical expectancy";
  }
}

betSizeUsd = Math.round(betSizeUsd * 100) / 100;

// --- Env / SOL price ---
const solUsd = Number($json.solUsd ?? $env.SOL_USD);
if (!Number.isFinite(solUsd) || solUsd <= 0) {
  return [{ json: { ...$json, status: "config_missing", reason: "Set SOL_USD env" } }];
}
const userPublicKey = $env.SOLANA_WALLET_PUBLIC_KEY;
if (!userPublicKey) {
  return [{ json: { ...$json, status: "config_missing", reason: "Set SOLANA_WALLET_PUBLIC_KEY env" } }];
}
if (!(entryPriceUsd > 0)) {
  return [{ json: { ...$json, status: "config_missing", reason: "entryPriceUsd missing" } }];
}

const lamportsAmount = Math.max(1, Math.floor((betSizeUsd / solUsd) * 1_000_000_000));
const slippageBps = Number($env.JUPITER_SLIPPAGE_BPS ?? 1500);

// --- Jupiter quote ---
let quote;
try {
  quote = await this.helpers.httpRequest({
    url: `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${lamportsAmount}&slippageBps=${slippageBps}`,
    method: "GET", json: true, timeout: 10000
  });
} catch (err) {
  return [{ json: { ...$json, status: "quote_failed", reason: err.message, betSizeUsd } }];
}

if (!quote?.outAmount || !quote?.inAmount) {
  return [{ json: { ...$json, status: "quote_failed", reason: "Jupiter returned no amounts", betSizeUsd } }];
}

// --- Jupiter swap build ---
let swapBuild;
try {
  swapBuild = await this.helpers.httpRequest({
    url: "https://quote-api.jup.ag/v6/swap",
    method: "POST", json: true, timeout: 15000,
    body: {
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: Number($env.JUPITER_MAX_PRIORITY_LAMPORTS ?? 10000000),
          priorityLevel: "veryHigh"
        }
      }
    }
  });
} catch (err) {
  return [{ json: { ...$json, status: "swap_build_failed", reason: err.message, betSizeUsd } }];
}

if (!swapBuild?.swapTransaction) {
  return [{ json: { ...$json, status: "swap_build_failed", reason: "No swapTransaction returned", betSizeUsd } }];
}

// --- Signer (paper mode if SIGNER_URL not set) ---
const signerUrl = $env.SIGNER_URL ?? "";

if (!signerUrl) {
  // Paper mode: flow through as "bought" so the position is recorded
  // and the monitor can manage it end-to-end without a real signer.
  return [{
    json: {
      ...$json,
      status: "bought",
      paperMode: true,
      reason: "SIGNER_URL not configured (paper mode)",
      betSizeUsd, learningAction, learningReason, confidenceScore,
      lamportsAmount,
      outputAmount: Number(quote.outAmount),
      entryPriceUsd,
      txHash: null,
      signedAt: Date.now()
    }
  }];
}

let signerResult;
try {
  signerResult = await this.helpers.httpRequest({
    url: signerUrl,
    method: "POST", json: true, timeout: 30000,
    headers: $env.SIGNER_API_KEY ? { Authorization: `Bearer ${$env.SIGNER_API_KEY}` } : {},
    body: {
      action: "buy",
      tokenAddress,
      serializedTransaction: swapBuild.swapTransaction,
      expectedOutputAmount: quote.outAmount
    }
  });
} catch (err) {
  return [{ json: { ...$json, status: "signer_failed", reason: err.message, betSizeUsd } }];
}

const txHash = signerResult?.txHash ?? signerResult?.signature ?? signerResult?.transactionHash;
if (!txHash) {
  return [{ json: { ...$json, status: "signer_failed", reason: "Signer returned no tx hash" } }];
}

return [{
  json: {
    ...$json,
    status: "bought",
    betSizeUsd, learningAction, learningReason, confidenceScore,
    lamportsAmount,
    outputAmount: Number(signerResult?.amount ?? quote.outAmount),
    entryPriceUsd,
    txHash,
    signedAt: Date.now()
  }
}];
