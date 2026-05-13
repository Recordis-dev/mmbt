const SOLANA_ADDRESS_REGEX = /([1-9A-HJ-NP-Za-km-z]{32,44})/g;

export function extractTokenAddress(message) {
  if (typeof message !== "string" || message.length === 0) {
    return null;
  }

  const matches = message.match(SOLANA_ADDRESS_REGEX);
  return matches?.[0] ?? null;
}

export function normalizeSignalPayload(body = {}) {
  const message = body.message ?? body.text ?? "";
  const tokenAddress = extractTokenAddress(message);

  if (!tokenAddress) {
    return {
      status: "ignored",
      reason: "No token address found"
    };
  }

  return {
    status: "parsed",
    tokenAddress,
    sourceChannel: body.channel ?? body.sourceChannel ?? "unknown",
    timestamp: Date.now(),
    rawMessage: message
  };
}
