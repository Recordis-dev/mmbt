const pairs = Array.isArray($json.pairs) ? $json.pairs : [];
const pair = pairs
  .filter((item) => item.chainId === "solana")
  .sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))[0];

if (!pair) {
  return [{
    json: {
      ...$json,
      marketStatus: "missing",
      market: {},
      riskSignals: { negativeCount: 0, source: "market_unavailable" }
    }
  }];
}

const buys5m = Number(pair.txns?.m5?.buys ?? 0);
const sells5m = Number(pair.txns?.m5?.sells ?? 0);
const createdAt = Number(pair.pairCreatedAt ?? 0);
const tokenAgeMinutes = createdAt > 0 ? Math.max(0, (Date.now() - createdAt) / 60000) : 0;

return [{
  json: {
    ...$json,
    marketStatus: "ok",
    market: {
      dexId: pair.dexId,
      pairAddress: pair.pairAddress,
      url: pair.url,
      priceUsd: Number(pair.priceUsd ?? 0),
      liquidityUsd: Number(pair.liquidity?.usd ?? 0),
      volume5mUsd: Number(pair.volume?.m5 ?? 0),
      volume24hUsd: Number(pair.volume?.h24 ?? 0),
      holderCount: Number(pair.info?.holders ?? 0),
      top10HolderPercentage: Number(pair.info?.top10HolderPercentage ?? 100),
      buyPressure: buys5m,
      sellPressure: sells5m,
      tokenAgeMinutes
    },
    metrics: {
      currentPrice: Number(pair.priceUsd ?? 0),
      volume24h: Number(pair.volume?.h24 ?? 0),
      holdersCount: Number(pair.info?.holders ?? 0),
      buyPressure: buys5m,
      sellPressure: sells5m,
      networkFees: 0
    },
    riskSignals: { negativeCount: 0, source: "market_snapshot" }
  }
}];
