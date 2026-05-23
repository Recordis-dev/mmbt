const message = $json.body?.message ?? $json.message ?? $json.text ?? "";
const regex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const matches = String(message).match(regex);

if (!matches || matches.length === 0) {
  return [{ json: { status: "ignored", reason: "No token address found" } }];
}

return [{
  json: {
    status: "parsed",
    tokenAddress: matches[0],
    sourceChannel: $json.body?.channel ?? $json.channel ?? "unknown",
    timestamp: Date.now(),
    rawMessage: String(message)
  }
}];
