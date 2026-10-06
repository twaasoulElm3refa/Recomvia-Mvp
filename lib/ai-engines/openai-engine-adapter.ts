import type { EngineAdapter, EngineCitation, EngineProviderError, EngineResponse, EngineRunRequest, EngineSource, EngineUsage } from "./engine-adapter";
import { estimateOpenAiCostMicros, OPENAI_DEFAULT_MODEL } from "./pricing";

type FetchLike = typeof fetch;

type OpenAIResponse = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<Record<string, unknown>>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  error?: { code?: string; message?: string };
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageFrom(response: OpenAIResponse): EngineUsage {
  return {
    inputTokens: finite(response.usage?.input_tokens),
    cachedInputTokens: finite(response.usage?.input_tokens_details?.cached_tokens),
    outputTokens: finite(response.usage?.output_tokens),
    totalTokens: finite(response.usage?.total_tokens),
  };
}

function outputText(response: OpenAIResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  for (const item of response.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content as Array<Record<string, unknown>>) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text.trim();
    }
  }
  return null;
}

function citationsFrom(response: OpenAIResponse): EngineCitation[] {
  const output: EngineCitation[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content as Array<Record<string, unknown>>) {
      if (!Array.isArray(content.annotations)) continue;
      for (const annotation of content.annotations as Array<Record<string, unknown>>) {
        if (annotation.type !== "url_citation" || typeof annotation.url !== "string") continue;
        output.push({
          url: annotation.url,
          title: typeof annotation.title === "string" ? annotation.title : null,
          startIndex: finite(annotation.start_index),
          endIndex: finite(annotation.end_index),
        });
      }
    }
  }
  return [...new Map(output.map(item => [item.url, item])).values()];
}

function sourcesFrom(response: OpenAIResponse, citations: EngineCitation[]): EngineSource[] {
  const output: EngineSource[] = citations.map(citation => ({ url: citation.url, title: citation.title, type: "url_citation" }));
  for (const item of response.output ?? []) {
    if (item.type !== "web_search_call") continue;
    const action = item.action as Record<string, unknown> | undefined;
    if (!action || !Array.isArray(action.sources)) continue;
    for (const source of action.sources as Array<Record<string, unknown>>) {
      if (typeof source.url !== "string") continue;
      output.push({ url: source.url, title: typeof source.title === "string" ? source.title : null, type: typeof source.type === "string" ? source.type : null });
    }
  }
  return [...new Map(output.map(item => [item.url, item])).values()];
}

function webSearchCalls(response: OpenAIResponse) {
  return (response.output ?? []).filter(item => item.type === "web_search_call").length;
}

function retryableStatus(status: number) { return status === 408 || status === 409 || status === 429 || status >= 500; }

function safeError(status: number | null, body: OpenAIResponse | null, fallback: string): EngineProviderError {
  return {
    code: body?.error?.code || (status ? `http_${status}` : "network_error"),
    message: (body?.error?.message || fallback).slice(0, 500),
    status,
    retryable: status === null || retryableStatus(status),
  };
}

function emptyUsage(): EngineUsage { return { inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null }; }

export class OpenAIEngineAdapter implements EngineAdapter {
  readonly provider = "OpenAI API";
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;

  constructor(input: { apiKey: string; model?: string; endpoint?: string; timeoutMs?: number; maxRetries?: number; fetchImpl?: FetchLike }) {
    if (!input.apiKey.trim()) throw new Error("OPENAI_API_KEY is required to initialize the OpenAI engine adapter.");
    this.apiKey = input.apiKey;
    this.model = input.model || OPENAI_DEFAULT_MODEL;
    this.endpoint = input.endpoint || "https://api.openai.com/v1/responses";
    this.timeoutMs = input.timeoutMs ?? 30_000;
    this.maxRetries = Math.max(0, Math.min(2, input.maxRetries ?? 2));
    this.fetchImpl = input.fetchImpl || fetch;
  }

  async run(request: EngineRunRequest): Promise<EngineResponse> {
    const started = Date.now();
    const timestamp = new Date().toISOString();
    let retries = 0;
    let lastError: EngineProviderError | null = null;

    while (retries <= this.maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            store: false,
            reasoning: { effort: "low" },
            max_output_tokens: 1_200,
            tools: request.useSearch ? [{ type: "web_search", search_context_size: "low" }] : undefined,
            tool_choice: request.useSearch ? "required" : undefined,
            include: request.useSearch ? ["web_search_call.action.sources"] : undefined,
            input: [
              { role: "system", content: "Answer the question directly and independently. Use current web evidence when search is enabled. Name concrete options where appropriate, preserve uncertainty, and do not assume any brand must appear." },
              { role: "user", content: request.prompt },
            ],
          }),
        });
        const body = await response.json().catch(() => null) as OpenAIResponse | null;
        if (!response.ok || !body) {
          lastError = safeError(response.status, body, "OpenAI returned an invalid response.");
          if (!lastError.retryable || retries >= this.maxRetries) break;
        } else {
          const text = outputText(body);
          if (!text) {
            lastError = safeError(response.status, body, "OpenAI returned no answer text.");
            if (retries >= this.maxRetries) break;
          } else {
            const citations = citationsFrom(body);
            const sources = sourcesFrom(body, citations);
            const usage = usageFrom(body);
            const actualModel = body.model || this.model;
            return {
              provider: this.provider,
              model: actualModel,
              surfaceType: request.useSearch ? "api_with_search" : "api_without_search",
              responseText: text,
              sources,
              citations,
              usage,
              estimatedCostMicros: estimateOpenAiCostMicros(actualModel, usage, webSearchCalls(body)),
              durationMs: Date.now() - started,
              retryCount: retries,
              providerRunId: body.id || null,
              timestamp,
              error: null,
            };
          }
        }
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        lastError = safeError(null, null, aborted ? "OpenAI request timed out." : "OpenAI network request failed.");
        if (retries >= this.maxRetries) break;
      } finally {
        clearTimeout(timer);
      }
      retries += 1;
      await new Promise(resolve => setTimeout(resolve, Math.min(1_500, 250 * (2 ** retries))));
    }

    return {
      provider: this.provider,
      model: this.model,
      surfaceType: request.useSearch ? "api_with_search" : "api_without_search",
      responseText: null,
      sources: [],
      citations: [],
      usage: emptyUsage(),
      estimatedCostMicros: null,
      durationMs: Date.now() - started,
      retryCount: retries,
      providerRunId: null,
      timestamp,
      error: lastError || safeError(null, null, "OpenAI request failed."),
    };
  }
}
