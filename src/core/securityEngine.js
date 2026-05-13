import { DEFAULT_LIMITS } from "./config.js";

export async function withTimeout(promise, timeoutMs = DEFAULT_LIMITS.securityTimeoutMs) {
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]);
}

export async function runParallelSecurityChecks(checks, limits = DEFAULT_LIMITS) {
  const settled = await Promise.allSettled(
    checks.map((check) => withTimeout(check.run(), limits.securityTimeoutMs))
  );

  const fulfilled = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  if (fulfilled.length < limits.minSecurityResponses) {
    return {
      status: "abort",
      reason: "Insufficient security data",
      failedAPIs: settled.length - fulfilled.length,
      results: fulfilled
    };
  }

  const securityScore = Object.fromEntries(
    fulfilled.map((result) => [result.source, evaluateProviderResult(result)])
  );

  const passedChecks = Object.values(securityScore).filter(Boolean).length;

  if (passedChecks === fulfilled.length) {
    return {
      status: "safe",
      securityScore,
      results: fulfilled
    };
  }

  return {
    status: "abort",
    reason: "Security check failed",
    securityScore,
    results: fulfilled
  };
}

export function evaluateProviderResult(result) {
  if (!result) return false;

  if (result.source === "rugcheck") return evaluateRugCheck(result);
  if (result.source === "goplus") return evaluateGoPlus(result);
  if (result.source === "solsniffer") return evaluateSolSniffer(result);

  return false;
}

export function evaluateRugCheck(result) {
  return Number(result.score ?? Number.POSITIVE_INFINITY) < 500 &&
    result.token?.liquidityBurned === true;
}

export function evaluateGoPlus(result) {
  const data = result.data?.[result.tokenAddress] ?? result.data;

  if (!data) return false;

  return isFalseLike(data.is_mintable) &&
    isFalseLike(data.is_freezable) &&
    isFalseLike(data.is_honeypot);
}

export function evaluateSolSniffer(result) {
  const top10Concentration = Number(
    result.topHolders?.top10Percentage ??
    result.top10Percentage ??
    100
  );

  return top10Concentration <= 25;
}

function isFalseLike(value) {
  return value === false || value === "0" || value === 0 || value === "false";
}
