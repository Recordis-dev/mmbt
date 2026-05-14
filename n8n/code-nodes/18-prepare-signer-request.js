if (!$json.signerUrl) {
  return [{
    json: {
      ...$json,
      status: "paper_swap_ready",
      reason: "SIGNER_URL not configured; transaction built but not signed"
    }
  }];
}

return [{
  json: {
    ...$json,
    signerPayload: {
      action: $json.signerAction ?? "buy",
      tokenAddress: $json.tokenAddress,
      serializedTransaction: $json.serializedTransaction,
      expectedOutputAmount: $json.outputAmount,
      positionId: $json.positionId ?? null
    }
  }
}];
