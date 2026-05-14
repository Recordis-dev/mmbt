const quote = $json.outAmount ? $json : ($json.quote ?? {});
const userPublicKey = $env.SOLANA_WALLET_PUBLIC_KEY;

if (!userPublicKey) {
  return [{ json: { ...$json, status: "wallet_missing", reason: "Set SOLANA_WALLET_PUBLIC_KEY" } }];
}

if (!quote.outAmount || !quote.inAmount) {
  return [{ json: { ...$json, status: "quote_failed", reason: $json.error ?? "Jupiter quote did not return amounts" } }];
}

return [{
  json: {
    ...$json,
    status: "swap_requested",
    quote,
    entryPrice: Number(quote.outAmount) / Number(quote.inAmount),
    outputAmount: quote.outAmount,
    swapUrl: "https://quote-api.jup.ag/v6/swap",
    swapPayload: {
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
  }
}];
