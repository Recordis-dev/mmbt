const serializedTransaction = $json.swapTransaction ?? $json.serializedTransaction;

if (!serializedTransaction) {
  return [{ json: { ...$json, status: "swap_build_failed", reason: $json.error ?? "Jupiter did not return swapTransaction" } }];
}

return [{
  json: {
    ...$json,
    status: "swap_ready",
    serializedTransaction,
    signerUrl: $env.SIGNER_URL ?? "",
    signerApiKey: $env.SIGNER_API_KEY ?? "",
    timestamp: Date.now()
  }
}];
