const position = $json.position;
const currentAmount = Number(position.entryAmount ?? position.entry_amount ?? 0);
const tokenAmount = Number($json.exitAmount ?? ($json.action === "partial_take_profit" ? currentAmount * 0.5 : currentAmount));

if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
  return [{ json: { ...$json, status: "sell_amount_missing", reason: "Position entry amount is missing" } }];
}

const quoteUrl = new URL("https://quote-api.jup.ag/v6/quote");
quoteUrl.searchParams.set("inputMint", position.tokenAddress ?? position.token_address);
quoteUrl.searchParams.set("outputMint", "So11111111111111111111111111111111111111112");
quoteUrl.searchParams.set("amount", String(Math.floor(tokenAmount)));
quoteUrl.searchParams.set("slippageBps", String(Number($env.JUPITER_EXIT_SLIPPAGE_BPS ?? 2000)));

return [{
  json: {
    ...$json,
    signerAction: "sell",
    status: "sell_quote_requested",
    exitAmount: Math.floor(tokenAmount),
    quoteUrl: quoteUrl.toString()
  }
}];
