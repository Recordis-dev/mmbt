import { DEFAULT_LIMITS } from "./config.js";

/**
 * Wraps a promise with a timeout.
 * @param {Promise} promise - The promise to wrap.
 * @param {number} [timeoutMs=DEFAULT_LIMITS.securityTimeoutMs] - Timeout in milliseconds.
 * @returns {Promise} - Resolves with the original promise or rejects with a timeout error.
 */
export async function withTimeout(promise, timeoutMs = DEFAULT_LIMITS.securityTimeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs security checks in parallel and enforces a timeout.
 * @param {Array<Object>} checks - Array of check objects { run: () => Promise }.
 * @param {Object} [limits=DEFAULT_LIMITS] - Security limits (timeout and min responses).
 * @returns {Promise<Object>} - The result of the security evaluation.
 */
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

/**
 * Routes a provider result to its specific evaluation logic.
 * @param {Object} result - The result from a security provider.
 * @returns {boolean} - True if passed, false otherwise.
 */
export function evaluateProviderResult(result) {
  if (!result) return false;

  if (result.source === "rugcheck") return evaluateRugCheck(result);
  if (result.source === "goplus") return evaluateGoPlus(result);
  if (result.source === "solsniffer") return evaluateSolSniffer(result);

  return false;
}

/**
 * Logic for RugCheck evaluation.
 * @param {Object} result - RugCheck API response.
 * @returns {boolean}
 */
export function evaluateRugCheck(result, limits = DEFAULT_LIMITS) {
  return Number(result.score ?? Number.POSITIVE_INFINITY) < limits.rugcheckMaxScore &&
    result.token?.liquidityBurned === true;
}

/**
 * Logic for GoPlus evaluation.
 * @param {Object} result - GoPlus API response.
 * @returns {boolean}
 */
export function evaluateGoPlus(result) {
  const data = result.data?.[result.tokenAddress] ?? result.data;

  if (!data) return false;

  return isFalseLike(data.is_mintable) &&
    isFalseLike(data.is_freezable) &&
    isFalseLike(data.is_honeypot);
}

/**
 * Logic for SolSniffer evaluation.
 * @param {Object} result - SolSniffer API response.
 * @returns {boolean}
 */
export function evaluateSolSniffer(result, limits = DEFAULT_LIMITS) {
  const top10Concentration = Number(
    result.topHolders?.top10Percentage ??
    result.top10Percentage ??
    100
  );

  return top10Concentration <= limits.solSnifferMaxTop10Pct;
}

/**
 * Helper to check if a value is falsy in various string/number formats.
 * @param {any} value
 * @returns {boolean}
 */
function isFalseLike(value) {
  return value === false || value === "0" || value === 0 || value === "false";
}
