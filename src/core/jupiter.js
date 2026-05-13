import { SOL_MINT } from "./config.js";

export function buildQuoteUrl({ tokenAddress, lamportsAmount, slippageBps = 1500 }) {
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: tokenAddress,
    amount: String(lamportsAmount),
    slippageBps: String(slippageBps)
  });

  return `https://quote-api.jup.ag/v6/quote?${params.toString()}`;
}

export function buildSwapPayload({ quoteResponse, userPublicKey, maxLamports = 10000000 }) {
  return {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports,
        priorityLevel: "veryHigh"
      }
    }
  };
}
