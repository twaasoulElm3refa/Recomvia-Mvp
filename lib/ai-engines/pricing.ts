/** Converts provider-reported USD cost to integer microdollars without estimating missing data. */
export function actualProviderCostMicros(costUsd: unknown): number | null {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) return null;
  return Math.round(costUsd * 1_000_000);
}
