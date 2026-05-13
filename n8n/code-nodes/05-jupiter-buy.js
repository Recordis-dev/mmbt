const tokenAddress = $json.tokenAddress;
const solUsd = Number($json.solUsd);
const betSizeUsd = Number($json.betSizeUsd ?? 0.25);
const lamportsAmount = Math.max(1, Math.floor((betSizeUsd / solUsd) * 1_000_000_000));

const quoteUrl = new URL("https://quote-api.jup.ag/v6/quote");
quoteUrl.searchParams.set("inputMint", "So11111111111111111111111111111111111111112");
quoteUrl.searchParams.set("outputMint", tokenAddress);
quoteUrl.searchParams.set("amount", String(lamportsAmount));
quoteUrl.searchParams.set("slippageBps", "1500");

const quoteResponse = await fetch(quoteUrl);
const quote = await quoteResponse.json();

if (!quoteResponse.ok || quote.error) {
  return [{ json: { status: "quote_failed", tokenAddress, error: quote.error ?? quote } }];
}

const swapResponse = await fetch("https://quote-api.jup.ag/v6/swap", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: env.SOLANA_WALLET_PUBLIC_KEY,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports: 10000000,
        priorityLevel: "veryHigh"
      }
    }
  })
});

const swapResult = await swapResponse.json();

if (!swapResponse.ok || swapResult.error) {
  return [{ json: { status: "swap_build_failed", tokenAddress, error: swapResult.error ?? swapResult } }];
}

return [{
  json: {
    status: "swap_ready",
    tokenAddress,
    betSizeUsd,
    lamportsAmount,
    entryPrice: Number(quote.outAmount) / Number(quote.inAmount),
    outputAmount: quote.outAmount,
    serializedTransaction: swapResult.swapTransaction,
    timestamp: Date.now()
  }
}];
