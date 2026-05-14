const tokenAddress = $json.tokenAddress;
const timeoutMs = 800;

const checks = await Promise.allSettled([
  apiCallWithRetry(`https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`, {
    headers: { Authorization: `Bearer ${$env.RUGCHECK_API_KEY ?? ""}` }
  }).then((data) => ({ source: "rugcheck", tokenAddress, ...data })),
  apiCallWithRetry(`https://api.gopluslabs.io/api/v1/token_security/solana?contract_addresses=${tokenAddress}`, {
    headers: { Authorization: `Bearer ${$env.GOPLUS_API_KEY ?? ""}` }
  }).then((data) => ({ source: "goplus", tokenAddress, ...data })),
  apiCallWithRetry(`https://api.solsniffer.com/v2/token/${tokenAddress}`, {
    headers: { "X-API-KEY": $env.SOLSNIFFER_API_KEY ?? "" }
  }).then((data) => ({ source: "solsniffer", tokenAddress, ...data }))
]);

const results = checks
  .filter((check) => check.status === "fulfilled")
  .map((check) => check.value);

if (results.length < 2) {
  return [{
    json: {
      status: "abort",
      reason: "Insufficient security data",
      tokenAddress,
      failedAPIs: checks.filter((check) => check.status === "rejected").length
    }
  }];
}

const securityScore = Object.fromEntries(
  results.map((result) => [result.source, evaluateResult(result)])
);

const passedChecks = Object.values(securityScore).filter(Boolean).length;

if (passedChecks === results.length) {
  return [{ json: { status: "safe", tokenAddress, securityScore, results } }];
}

return [{
  json: {
    status: "abort",
    reason: "Security check failed",
    tokenAddress,
    securityScore,
    results
  }
}];

async function apiCallWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function evaluateResult(result) {
  if (result.source === "rugcheck") {
    return Number(result.score ?? Infinity) < 500 && result.token?.liquidityBurned === true;
  }

  if (result.source === "goplus") {
    const data = result.data?.[tokenAddress] ?? result.result?.[tokenAddress] ?? result.data;
    return isFalseLike(data?.is_mintable) && isFalseLike(data?.is_freezable) && isFalseLike(data?.is_honeypot);
  }

  if (result.source === "solsniffer") {
    const top10 = Number(result.topHolders?.top10Percentage ?? result.top10Percentage ?? 100);
    return top10 <= 25;
  }

  return false;
}

function isFalseLike(value) {
  return value === false || value === "0" || value === 0 || value === "false";
}
