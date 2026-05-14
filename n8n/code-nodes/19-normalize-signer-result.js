if ($json.status === "paper_swap_ready") {
  return [{ json: $json }];
}

const txHash = $json.txHash ?? $json.signature ?? $json.transactionHash;
if (!txHash) {
  return [{ json: { ...$json, status: "signer_failed", reason: $json.error ?? "Signer did not return a transaction hash" } }];
}

return [{
  json: {
    ...$json,
    status: $json.signerAction === "sell" ? "sold" : "bought",
    txHash,
    entryAmount: $json.amount ?? $json.outputAmount,
    signedAt: Date.now()
  }
}];
