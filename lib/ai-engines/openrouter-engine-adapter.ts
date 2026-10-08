import type { EngineAdapter, EngineCitation, EngineProviderError, EngineResponse, EngineRunRequest, EngineSource, EngineUsage } from "./engine-adapter";
import { actualProviderCostMicros } from "./pricing";

type FetchLike = typeof fetch;

type OpenRouterAnnotation = {
  type?: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
  startIndex?: number;
  endIndex?: number;
  url_citation?: {
    url?: string;
    title?: string;
    start_index?: number;
    end_index?: number;
    startIndex?: number;
    endIndex?: number;
  };
};

type OpenRouterResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      annotations?: OpenRouterAnnotation[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
    server_tool_use?: { web_search_requests?: number };
    cost?: number;
  };
  error?: { code?: string | number; message?: string };
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageFrom(response: OpenRouterResponse): EngineUsage {
  return {
    inputTokens: finite(response.usage?.prompt_tokens ?? response.usage?.input_tokens),
    cachedInputTokens: finite(response.usage?.prompt_tokens_details?.cached_tokens ?? response.usage?.input_tokens_details?.cached_tokens),
    outputTokens: finite(response.usage?.completion_tokens ?? response.usage?.output_tokens),
    totalTokens: finite(response.usage?.total_tokens),
  };
}

function outputText(response: OpenRouterResponse) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (!Array.isArray(content)) return null;
  const text = content
    .filter(item => item.type === "text" && typeof item.text === "string")
    .map(item => item.text!.trim())
    .filter(Boolean)
    .join("\n");
  return text || null;
}

function citationsFrom(response: OpenRouterResponse): EngineCitation[] {
  const citations: EngineCitation[] = [];
  for (const annotation of response.choices?.[0]?.message?.annotations ?? []) {
    if (annotation.type !== "url_citation") continue;
    const citation = annotation.url_citation ?? annotation;
    if (typeof citation.url !== "string" || !citation.url.trim()) continue;
    citations.push({
      url: citation.url,
      title: typeof citation.title === "string" ? citation.title : null,
      startIndex: finite(citation.start_index ?? citation.startIndex),
      endIndex: finite(citation.end_index ?? citation.endIndex),
    });
  }
  return [...new Map(citations.map(citation => [citation.url, citation])).values()];
}

function sourcesFrom(citations: EngineCitation[]): EngineSource[] {
  return citations.map(citation => ({ url: citation.url, title: citation.title, type: "url_citation" }));
}

function surfaceTypeFrom(response: OpenRouterResponse, searchRequested: boolean) {
  const searchRequests = finite(response.usage?.server_tool_use?.web_search_requests) ?? 0;
  const searchUsed = searchRequested && (searchRequests > 0 || citationsFrom(response).length > 0);
  return searchUsed ? "api_with_search" as const : "api_without_search" as const;
}

function retryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function safeError(status: number | null, body: OpenRouterResponse | null, fallback: string, fallbackCode = "network_error"): EngineProviderError {
  return {
    code: body?.error?.code !== undefined ? String(body.error.code) : status !== null && status >= 400 ? `http_${status}` : fallbackCode,
    message: (body?.error?.message || fallback).slice(0, 500),
    status,
    retryable: status === null || retryableStatus(status),
  };
}

function emptyUsage(): EngineUsage {
  return { inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null };
}

export class OpenRouterEngineAdapter implements EngineAdapter {
  readonly provider = "OpenRouter";
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;

  constructor(input: { apiKey: string; model: string; endpoint?: string; timeoutMs?: number; maxRetries?: number; fetchImpl?: FetchLike }) {
    if (!input.apiKey.trim()) throw new Error("OPENROUTER_API_KEY is required to initialize the OpenRouter engine adapter.");
    if (!input.model.trim()) throw new Error("OPENROUTER_MODEL is required to initialize the OpenRouter engine adapter.");
    this.apiKey = input.apiKey;
    this.model = input.model.trim();
    this.endpoint = input.endpoint || "https://openrouter.ai/api/v1/chat/completions";
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
            messages: [
              { role: "system", content: "Answer the question directly and independently. When web search is available, use current web evidence and cite it. Name concrete options where appropriate, preserve uncertainty, and do not assume any brand must appear." },
              { role: "user", content: request.prompt },
            ],
            max_tokens: 1_200,
            usage: { include: true },
            tools: request.useSearch ? [{ type: "openrouter:web_search", parameters: { max_results: 5, max_total_results: 10, search_context_size: "low" } }] : undefined,
            max_tool_calls: request.useSearch ? 3 : undefined,
          }),
        });
        const body = await response.json().catch(() => null) as OpenRouterResponse | null;
        if (!response.ok || !body) {
          lastError = safeError(response.status, body, "OpenRouter returned an invalid response.");
          if (!lastError.retryable || retries >= this.maxRetries) break;
        } else {
          const text = outputText(body);
          if (!text) {
            lastError = safeError(response.status, body, "OpenRouter returned no answer text.", "empty_response");
            if (retries >= this.maxRetries) break;
          } else {
            const citations = citationsFrom(body);
            return {
              provider: this.provider,
              model: body.model || this.model,
              surfaceType: surfaceTypeFrom(body, request.useSearch),
              responseText: text,
              sources: sourcesFrom(citations),
              citations,
              usage: usageFrom(body),
              estimatedCostMicros: actualProviderCostMicros(body.usage?.cost),
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
        lastError = safeError(null, null, aborted ? "OpenRouter request timed out." : "OpenRouter network request failed.", aborted ? "timeout" : "network_error");
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
      error: lastError || safeError(null, null, "OpenRouter request failed."),
    };
  }
}
