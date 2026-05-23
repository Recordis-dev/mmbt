// Runs in "Run Once for All Items" mode. Processes claimed positions in parallel.
const LIMITS = {
  hardStopFraction:    Number($env.HARD_STOP_FRACTION ?? 0.34),
  partialTpMultiplier: Number($env.PARTIAL_TP_MULTIPLIER ?? 2),
  partialTpFraction:   Number($env.PARTIAL_TP_FRACTION ?? 0.5),
  riskSignalThreshold: Number($env.RISK_SIGNAL_THRESHOLD ?? 3),
  volumeDeclineRatio:  Number($env.VOLUME_DECLINE_RATIO ?? 0.5),
  holderDropRatio:     Number($env.HOLDER_DROP_RATIO ?? 0.9),
  sellPressureRatio:   Number($env.SELL_PRESSURE_RATIO ?? 3)
};

const positions = items.map((it) => ({
  id: it.json.id,
  tokenAddress: it.json.token_address,
  entryPriceUsd: Number(it.json.entry_price),
  entryAmount: Number(it.json.entry_amount),
  betSizeUsd: Number(it.json.bet_size_usd ?? 0.25),
  highestPriceUsd: Number(it.json.highest_price ?? it.json.entry_price),
  partialTPTaken: Boolean(it.json.partial_tp_taken),
  avgVolume: Number(it.json.avg_volume ?? 0),
  peakHolders: Number(it.json.peak_holders ?? 0),
  paperMode: Boolean(it.json.paper_mode),
  createdAt: it.json.created_at
}));

const _h = this.helpers;
const _env = $env;

async function safeGet(url, timeout = 5000) {
  try { return await _h.httpRequest({ url, method: "GET", json: true, timeout }); }
  catch (err) { return { __error: err.message }; }
}

async function jupiterQuote(input, output, amount) {
  const slip = Number(_env.JUPITER_EXIT_SLIPPAGE_BPS ?? 2000);
  return safeGet(
    `https://quote-api.jup.ag/v6/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=${slip}`,
    10000
  );
}

async function jupiterSwap(quote, userPublicKey) {
  try {
    return await _h.httpRequest({
      url: "https://quote-api.jup.ag/v6/swap",
      method: "POST", json: true, timeout: 15000,
      body: {
        quoteResponse: quote, userPublicKey,
        wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: Number(_env.JUPITER_MAX_PRIORITY_LAMPORTS ?? 10000000),
            priorityLevel: "veryHigh"
          }
        }
      }
    });
  } catch (err) { return { __error: err.message }; }
}

async function callSigner(action, position, swapBuild, expectedOutputAmount) {
  const url = _env.SIGNER_URL ?? "";
  if (!url) return { __paper: true };
  try {
    return await _h.httpRequest({
      url, method: "POST", json: true, timeout: 30000,
      headers: _env.SIGNER_API_KEY ? { Authorization: `Bearer ${_env.SIGNER_API_KEY}` } : {},
      body: {
        action,
        tokenAddress: position.tokenAddress,
        serializedTransaction: swapBuild.swapTransaction,
        expectedOutputAmount,
        positionId: position.id
      }
    });
  } catch (err) { return { __error: err.message }; }
}

function classifyOutcome(finalMul, maxMul, pnl) {
  if (maxMul >= 10) return "moonshot";
  if (finalMul >= 2 || pnl > 0) return "winner";
  if (finalMul <= 0.34) return "hard_loss";
  if (pnl < 0) return "loser";
  return "flat";
}

async function processOne(position) {
  const userPublicKey = _env.SOLANA_WALLET_PUBLIC_KEY;
  const dexRaw = await safeGet(
    `https://api.dexscreener.com/latest/dex/tokens/${position.tokenAddress}`
  );

  if (dexRaw.__error) {
    return { positionId: position.id, shouldExit: false, shouldClose: false, reason: "market_fetch_failed" };
  }

  const pairs = Array.isArray(dexRaw?.pairs) ? dexRaw.pairs : [];
  const pair = pairs.filter((p) => p.chainId === "solana")
    .sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))[0];

  if (!pair || !(Number(pair.priceUsd) > 0)) {
    return { positionId: position.id, shouldExit: false, shouldClose: false, reason: "no_pair_or_price" };
  }

  const currentPriceUsd = Number(pair.priceUsd);
  const newHighest = Math.max(position.highestPriceUsd, currentPriceUsd);
  const multiplier = currentPriceUsd / position.entryPriceUsd;
  const buys5m = Number(pair.txns?.m5?.buys ?? 0);
  const sells5m = Number(pair.txns?.m5?.sells ?? 0);
  const volume24h = Number(pair.volume?.h24 ?? 0);
  const holders = Number(pair.info?.holders ?? 0);

  // --- Risk signals ---
  const signals = [];
  if (position.avgVolume > 0 && volume24h < position.avgVolume * LIMITS.volumeDeclineRatio)
    signals.push("volume_decline");
  if (position.peakHolders > 0 && holders > 0 && holders < position.peakHolders * LIMITS.holderDropRatio)
    signals.push("holder_drop");
  if ((sells5m / (buys5m || 1)) > LIMITS.sellPressureRatio) signals.push("sell_pressure_spike");

  // --- Decide exit action ---
  const stopLossPrice = position.entryPriceUsd * LIMITS.hardStopFraction;
  let action = "hold";
  let exitFraction = 0;
  let reason = "";

  if (signals.length >= LIMITS.riskSignalThreshold) {
    action = "panic_exit"; exitFraction = 1.0; reason = signals.join(", ");
  } else if (currentPriceUsd <= stopLossPrice) {
    action = "hard_stop_loss"; exitFraction = 1.0; reason = "below 66% stop";
  } else if (multiplier >= LIMITS.partialTpMultiplier && !position.partialTPTaken) {
    action = "partial_take_profit"; exitFraction = LIMITS.partialTpFraction; reason = `${LIMITS.partialTpMultiplier}x reached`;
  } else if (multiplier > LIMITS.partialTpMultiplier) {
    const pct = multiplier <= 10 ? 20 + (multiplier - 2) * 1.5
                                 : Math.min(32 + (multiplier - 10) * 2.5, 55);
    const trailPrice = newHighest * (1 - pct / 100);
    if (currentPriceUsd <= trailPrice) {
      action = "trailing_stop_exit"; exitFraction = 1.0; reason = `trail ${pct.toFixed(1)}%`;
    }
  }

  // --- Hold branch ---
  if (action === "hold") {
    return {
      positionId: position.id,
      tokenAddress: position.tokenAddress,
      shouldExit: false,
      shouldClose: false,
      highestPriceUsd: newHighest,
      currentPriceUsd,
      multiplier,
      paperMode: position.paperMode,
      signals
    };
  }

  // --- Need to sell: get sell quote/swap ---
  const sellAmount = Math.floor(position.entryAmount * exitFraction);
  if (sellAmount <= 0) {
    return { positionId: position.id, shouldExit: false, shouldClose: false, reason: "sell_amount_zero" };
  }

  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const quote = await jupiterQuote(position.tokenAddress, SOL_MINT, sellAmount);
  if (quote.__error || !quote?.outAmount) {
    return { positionId: position.id, shouldExit: false, shouldClose: false, reason: "sell_quote_failed", error: quote.__error };
  }

  const swap = await jupiterSwap(quote, userPublicKey);
  if (swap.__error || !swap?.swapTransaction) {
    return { positionId: position.id, shouldExit: false, shouldClose: false, reason: "sell_swap_failed", error: swap.__error };
  }

  const signer = await callSigner("sell", position, swap, quote.outAmount);
  const txHash = signer?.__paper ? null : (signer?.txHash ?? signer?.signature ?? signer?.transactionHash);
  const paperMode = !!signer?.__paper;

  if (!paperMode && !txHash) {
    return { positionId: position.id, shouldExit: false, shouldClose: false, reason: "signer_failed", error: signer?.__error };
  }

  // --- PnL ---
  // Prefer exact signer numbers when present, fall back to a price-based estimate.
  // Signer contract (if implemented) returns:
  //   solReceivedLamports: bigint/number — actual SOL credited to the wallet
  //   feeLamports:         bigint/number — total network fees paid
  let pnlUsd;
  const solUsd = Number(_env.SOL_USD ?? 0);
  if (!paperMode && signer?.solReceivedLamports != null && solUsd > 0) {
    const solReceived = Number(signer.solReceivedLamports) / 1e9;
    const fees = Number(signer.feeLamports ?? 0) / 1e9;
    const usdReceived = (solReceived - fees) * solUsd;
    const usdSpentForThisSlice = position.betSizeUsd * exitFraction;
    pnlUsd = Math.round((usdReceived - usdSpentForThisSlice) * 100) / 100;
  } else {
    pnlUsd = Math.round(
      ((currentPriceUsd / position.entryPriceUsd - 1) * exitFraction * position.betSizeUsd) * 100
    ) / 100;
  }

  const finalMultiplier = multiplier;
  const maxMultiplier = newHighest / position.entryPriceUsd;
  const wasWinner = pnlUsd > 0 || finalMultiplier >= 2;
  const outcomeLabel = classifyOutcome(finalMultiplier, maxMultiplier, pnlUsd);
  const holdTimeSeconds = Math.max(0, Math.floor(
    (Date.now() - new Date(position.createdAt).getTime()) / 1000
  ));

  return {
    positionId: position.id,
    tokenAddress: position.tokenAddress,
    shouldExit: true,
    shouldClose: action !== "partial_take_profit",
    action,
    exitFraction,
    reason,
    exitPriceUsd: currentPriceUsd,
    highestPriceUsd: newHighest,
    multiplier,
    finalMultiplier,
    maxMultiplier,
    pnlUsd,
    wasWinner,
    outcomeLabel,
    holdTimeSeconds,
    entryPriceUsd: position.entryPriceUsd,
    sellAmount,
    txHash,
    paperMode: paperMode || position.paperMode,
    signals
  };
}

const results = await Promise.all(positions.map(async (p) => {
  try {
    return await processOne(p);
  } catch (err) {
    return {
      positionId: p.id,
      tokenAddress: p.tokenAddress,
      shouldExit: false,
      shouldClose: false,
      reason: "exception",
      error: String(err && err.message ? err.message : err)
    };
  }
}));
return results.map((r) => ({ json: r }));
