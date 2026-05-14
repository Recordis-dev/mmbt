const position = {
  id: $json.id,
  tokenAddress: $json.token_address ?? $json.tokenAddress,
  entryPrice: Number($json.entry_price ?? $json.entryPrice),
  entryAmount: Number($json.entry_amount ?? $json.entryAmount),
  highestPrice: Number($json.highest_price ?? $json.highestPrice ?? $json.entry_price ?? $json.entryPrice),
  partialTPTaken: Boolean($json.partial_tp_taken ?? $json.partialTPTaken),
  avgVolume: Number($json.avg_volume ?? $json.avgVolume ?? 0),
  peakHolders: Number($json.peak_holders ?? $json.peakHolders ?? 0),
  createdAt: $json.created_at ?? $json.createdAt
};

return [{ json: { position, tokenAddress: position.tokenAddress } }];
