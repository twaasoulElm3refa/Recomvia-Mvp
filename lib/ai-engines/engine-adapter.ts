export type EngineSurfaceType = "api_with_search" | "api_without_search" | "consumer_experience";

export type EngineCitation = {
  url: string;
  title: string | null;
  startIndex: number | null;
  endIndex: number | null;
};

export type EngineSource = {
  url: string;
  title: string | null;
  type: string | null;
};

export type EngineUsage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type EngineRunRequest = {
  prompt: string;
  language: string;
  country: string;
  useSearch: boolean;
};

export type EngineProviderError = {
  code: string;
  message: string;
  status: number | null;
  retryable: boolean;
};

export type EngineResponse = {
  provider: string;
  model: string;
  surfaceType: EngineSurfaceType;
  responseText: string | null;
  sources: EngineSource[];
  citations: EngineCitation[];
  usage: EngineUsage;
  estimatedCostMicros: number | null;
  durationMs: number;
  retryCount: number;
  providerRunId: string | null;
  timestamp: string;
  error: EngineProviderError | null;
};

export interface EngineAdapter {
  readonly provider: string;
  readonly model: string;
  run(request: EngineRunRequest): Promise<EngineResponse>;
}
