const solUsd = Number($json.solUsd ?? $env.SOL_USD);
const betSizeUsd = Number($json.betSizeUsd ?? 0.25);

if (!Number.isFinite(solUsd) || solUsd <= 0) {
  return [{ json: { ...$json, status: "sol_price_missing", reason: "Set SOL_USD in n8n environment" } }];
}

const lamportsAmount = Math.max(1, Math.floor((betSizeUsd / solUsd) * 1_000_000_000));
const quoteUrl = new URL("https://quote-api.jup.ag/v6/quote");
quoteUrl.searchParams.set("inputMint", "So11111111111111111111111111111111111111112");
quoteUrl.searchParams.set("outputMint", $json.tokenAddress);
quoteUrl.searchParams.set("amount", String(lamportsAmount));
quoteUrl.searchParams.set("slippageBps", String(Number($env.JUPITER_SLIPPAGE_BPS ?? 1500)));

return [{ json: { ...$json, status: "quote_requested", betSizeUsd, solUsd, lamportsAmount, quoteUrl: quoteUrl.toString() } }];
