const tokenAddress = $json.tokenAddress;
const SECURITY_TIMEOUT_MS = 800;
const MARKET_TIMEOUT_MS = 5000;
const BIRDEYE_TIMEOUT_MS = 3000;
const RUGCHECK_MAX_SCORE = Number($env.RUGCHECK_MAX_SCORE ?? 500);
const SOLSNIFFER_MAX_TOP10_PCT = Number($env.SOLSNIFFER_MAX_TOP10_PCT ?? 25);

async function safeRequest(opts) {
  try {
    return await this.helpers.httpRequest(opts);
  } catch (err) {
    return { __error: err.message };
  }
}

const birdeyeKey = $env.BIRDEYE_API_KEY ?? "";
const birdeyeCall = birdeyeKey
  ? safeRequest.call(this, {
      url: `https://public-api.birdeye.so/defi/token_overview?address=${tokenAddress}`,
      method: "GET", json: true, timeout: BIRDEYE_TIMEOUT_MS,
      headers: { "X-API-KEY": birdeyeKey, "x-chain": "solana" }
    })
  : Promise.resolve({ __skipped: true });

const [rugcheckRaw, goplusRaw, sniffRaw, dexRaw, birdeyeRaw] = await Promise.all([
  safeRequest.call(this, {
    url: `https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`,
    method: "GET", json: true, timeout: SECURITY_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${$env.RUGCHECK_API_KEY ?? ""}` }
  }),
  safeRequest.call(this, {
    url: `https://api.gopluslabs.io/api/v1/token_security/solana?contract_addresses=${tokenAddress}`,
    method: "GET", json: true, timeout: SECURITY_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${$env.GOPLUS_API_KEY ?? ""}` }
  }),
  safeRequest.call(this, {
    url: `https://api.solsniffer.com/v2/token/${tokenAddress}`,
    method: "GET", json: true, timeout: SECURITY_TIMEOUT_MS,
    headers: { "X-API-KEY": $env.SOLSNIFFER_API_KEY ?? "" }
  }),
  safeRequest.call(this, {
    url: `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
    method: "GET", json: true, timeout: MARKET_TIMEOUT_MS
  }),
  birdeyeCall
]);

const securityResults = [];
if (!rugcheckRaw.__error) securityResults.push({ source: "rugcheck", ...rugcheckRaw });
if (!goplusRaw.__error)   securityResults.push({ source: "goplus", tokenAddress, ...goplusRaw });
if (!sniffRaw.__error)    securityResults.push({ source: "solsniffer", ...sniffRaw });

if (securityResults.length < 2) {
  return [{ json: { ...$json, status: "abort", reason: "Insufficient security data", failedAPIs: 3 - securityResults.length } }];
}

function isFalseLike(v) { return v === false || v === "0" || v === 0 || v === "false"; }

function evalResult(r) {
  if (r.source === "rugcheck") {
    return Number(r.score ?? Infinity) < RUGCHECK_MAX_SCORE && r.token?.liquidityBurned === true;
  }
  if (r.source === "goplus") {
    const data = r.data?.[tokenAddress] ?? r.data;
    return isFalseLike(data?.is_mintable) && isFalseLike(data?.is_freezable) && isFalseLike(data?.is_honeypot);
  }
  if (r.source === "solsniffer") {
    const top10 = Number(r.topHolders?.top10Percentage ?? r.top10Percentage ?? 100);
    return top10 <= SOLSNIFFER_MAX_TOP10_PCT;
  }
  return false;
}

const securityScore = Object.fromEntries(securityResults.map((r) => [r.source, evalResult(r)]));
const passedAll = Object.values(securityScore).every(Boolean);

if (!passedAll) {
  return [{ json: { ...$json, status: "abort", reason: "Security check failed", securityScore } }];
}

const pairs = Array.isArray(dexRaw?.pairs) ? dexRaw.pairs : [];
const pair = pairs
  .filter((p) => p.chainId === "solana")
  .sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))[0];

if (!pair || !(Number(pair.priceUsd) > 0)) {
  return [{ json: { ...$json, status: "abort", reason: "No DexScreener pair or price", securityScore } }];
}

const buys5m = Number(pair.txns?.m5?.buys ?? 0);
const sells5m = Number(pair.txns?.m5?.sells ?? 0);
const createdAt = Number(pair.pairCreatedAt ?? 0);

// Birdeye overrides DexScreener for holders/top10 when available (DexScreener
// rarely returns these fields, which collapses the learning pattern bucket).
const birdeyeData = birdeyeRaw && !birdeyeRaw.__error && !birdeyeRaw.__skipped
  ? (birdeyeRaw.data ?? birdeyeRaw)
  : null;

const holderCount = Number(
  birdeyeData?.holder ?? birdeyeData?.holderCount ?? pair.info?.holders ?? 0
);
const top10Pct = Number(
  birdeyeData?.top10HolderPercent ?? birdeyeData?.top10HolderPercentage ??
  pair.info?.top10HolderPercentage ?? 0
);

const market = {
  dexId: pair.dexId,
  pairAddress: pair.pairAddress,
  priceUsd: Number(pair.priceUsd ?? 0),
  liquidityUsd: Number(pair.liquidity?.usd ?? 0),
  volume5mUsd: Number(pair.volume?.m5 ?? 0),
  volume24hUsd: Number(pair.volume?.h24 ?? 0),
  holderCount,
  top10HolderPercentage: top10Pct,
  buyPressure: buys5m,
  sellPressure: sells5m,
  tokenAgeMinutes: createdAt > 0 ? Math.max(0, (Date.now() - createdAt) / 60000) : 0,
  holdersSource: birdeyeData ? "birdeye" : "dexscreener"
};

const features = {
  featureVersion: "v1.2",
  security: {
    rugcheck: !!securityScore.rugcheck,
    goplus: !!securityScore.goplus,
    solsniffer: !!securityScore.solsniffer
  },
  market,
  risk: { negativeCount: 0, source: "entry_snapshot" }
};

function bucket(value, thresholds) {
  const n = Number(value);
  for (const t of thresholds) if (n <= t) return `lte_${t}`;
  return `gt_${thresholds[thresholds.length - 1]}`;
}

const holdersBucket = market.holderCount > 0
  ? bucket(market.holderCount, [25, 75, 150, 300, 600])
  : "unknown";
const top10Bucket = market.top10HolderPercentage > 0 && market.top10HolderPercentage < 100
  ? bucket(market.top10HolderPercentage, [10, 20, 25, 35, 50])
  : "unknown";
const pressureRatio = market.sellPressure / (market.buyPressure || 1);

const patternKey = [
  `liq:${bucket(market.liquidityUsd, [1000, 5000, 10000, 25000, 50000])}`,
  `vol5:${bucket(market.volume5mUsd, [500, 2500, 5000, 10000, 25000])}`,
  `holders:${holdersBucket}`,
  `top10:${top10Bucket}`,
  `age:${bucket(market.tokenAgeMinutes, [5, 15, 30, 60, 180])}`,
  `sellbuy:${bucket(pressureRatio, [0.5, 1, 2, 3, 5])}`,
  `risk:0`
].join("|");

return [{
  json: {
    ...$json,
    status: "safe",
    securityScore,
    market,
    learningFeatures: features,
    patternKey,
    securitySnapshot: JSON.stringify(features.security),
    marketSnapshot: JSON.stringify(market),
    riskSnapshot: JSON.stringify(features.risk),
    entryPriceUsd: market.priceUsd,
    entryAvgVolume: market.volume24hUsd,
    entryPeakHolders: market.holderCount
  }
}];
