import type { EngineUsage } from "./engine-adapter";

type ModelPrice = {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  webSearchUsdPerCall: number;
};

export const OPENAI_DEFAULT_MODEL = "gpt-5.4-mini-2026-03-17";

const openAiPrices: Record<string, ModelPrice> = {
  "gpt-5.4-mini": { inputUsdPerMillion: 0.75, cachedInputUsdPerMillion: 0.075, outputUsdPerMillion: 4.5, webSearchUsdPerCall: 0.01 },
  "gpt-5.4-mini-2026-03-17": { inputUsdPerMillion: 0.75, cachedInputUsdPerMillion: 0.075, outputUsdPerMillion: 4.5, webSearchUsdPerCall: 0.01 },
};

export function estimateOpenAiCostMicros(model: string, usage: EngineUsage, webSearchCalls: number): number | null {
  const price = openAiPrices[model];
  if (!price || usage.inputTokens === null || usage.outputTokens === null) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncached = Math.max(0, usage.inputTokens - cached);
  const tokenCostMicros = uncached * price.inputUsdPerMillion + cached * price.cachedInputUsdPerMillion + usage.outputTokens * price.outputUsdPerMillion;
  const searchCostMicros = Math.max(0, webSearchCalls) * price.webSearchUsdPerCall * 1_000_000;
  return Math.round(tokenCostMicros + searchCostMicros);
}
