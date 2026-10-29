import type {
  EngineAdapter,
  EngineCitation,
  EngineProviderError,
  EngineResponse,
  EngineRunRequest,
  EngineSource,
  EngineUsage,
} from "./engine-adapter";
import { actualProviderCostMicros } from "./pricing";
import { safeSourceUrl } from "../analysis-target";
import { sanitizeProviderAnswer } from "../answer-text";

type FetchLike = typeof fetch;
const nativeFetch = globalThis.fetch;

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
    finish_reason?: string | null;
    native_finish_reason?: string | null;
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
    completion_tokens_details?: { reasoning_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
    server_tool_use?: { web_search_requests?: number };
    cost?: number;
  };
  error?: { code?: string | number; message?: string };
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageFrom(response: OpenRouterResponse): EngineUsage {
  const outputTokens = finite(response.usage?.completion_tokens ?? response.usage?.output_tokens);
  const reasoningTokens = finite(response.usage?.completion_tokens_details?.reasoning_tokens ?? response.usage?.output_tokens_details?.reasoning_tokens);
  return {
    inputTokens: finite(
      response.usage?.prompt_tokens ?? response.usage?.input_tokens,
    ),
    cachedInputTokens: finite(
      response.usage?.prompt_tokens_details?.cached_tokens ??
        response.usage?.input_tokens_details?.cached_tokens,
    ),
    outputTokens,
    totalTokens: finite(response.usage?.total_tokens),
    reasoningTokens,
    visibleOutputTokens: outputTokens !== null && reasoningTokens !== null ? Math.max(0, outputTokens - reasoningTokens) : null,
  };
}

function rawOutputText(response: OpenRouterResponse) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim())
    return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text!.trim())
    .filter(Boolean)
    .join("\n");
  return text || null;
}

function outputText(response: OpenRouterResponse) {
  const raw = rawOutputText(response);
  if (!raw) return null;
  const thinkingHeading = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:thinking process|reasoning|analysis|internal steps)\s*(?::|\n|$)/i;
  if (thinkingHeading.test(raw)) {
    const finalHeading = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:final answer|final response)\s*:?\s*/i.exec(raw);
    if (!finalHeading || finalHeading.index === undefined) return null;
    return sanitizeProviderAnswer(raw.slice(finalHeading.index + finalHeading[0].length)) || null;
  }
  return sanitizeProviderAnswer(raw) || null;
}

function validDiscoveryJson(text: string) {
  try {
    const data: unknown = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""));
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const result = data as { status?: unknown; candidates?: unknown };
    if (!["resolved", "ambiguous", "unresolved", "topic"].includes(String(result.status)) || !Array.isArray(result.candidates)) return false;
    if (result.status === "unresolved" || result.status === "topic") return true;
    return result.candidates.some((candidate: unknown) => {
      if (!candidate || typeof candidate !== "object") return false;
      const item = candidate as { kind?: unknown; name?: unknown; sources?: unknown };
      return ["person", "brand"].includes(String(item.kind)) && typeof item.name === "string" && Boolean(item.name.trim())
        && Array.isArray(item.sources) && item.sources.some((source: unknown) => typeof source === "string" && Boolean(safeSourceUrl(source)));
    });
  } catch { return false; }
}

function finishReasonFrom(response: OpenRouterResponse) {
  return response.choices?.[0]?.finish_reason ?? response.choices?.[0]?.native_finish_reason ?? null;
}

function citationsFrom(response: OpenRouterResponse): EngineCitation[] {
  const citations: EngineCitation[] = [];
  for (const annotation of response.choices?.[0]?.message?.annotations ?? []) {
    if (annotation.type !== "url_citation") continue;
    const citation = annotation.url_citation ?? annotation;
    const sourceUrl = safeSourceUrl(citation.url);
    if (!sourceUrl) continue;
    citations.push({
      url: sourceUrl,
      title: typeof citation.title === "string" ? citation.title : null,
      startIndex: finite(citation.start_index ?? citation.startIndex),
      endIndex: finite(citation.end_index ?? citation.endIndex),
    });
  }
  return [
    ...new Map(citations.map((citation) => [citation.url, citation])).values(),
  ];
}

function sourcesFrom(citations: EngineCitation[]): EngineSource[] {
  return citations.map((citation) => ({
    url: citation.url,
    title: citation.title,
    type: "url_citation",
  }));
}

function surfaceTypeFrom(
  response: OpenRouterResponse,
  searchRequested: boolean,
) {
  const searchRequests =
    finite(response.usage?.server_tool_use?.web_search_requests) ?? 0;
  const searchUsed =
    searchRequested &&
    (searchRequests > 0 || citationsFrom(response).length > 0);
  return searchUsed
    ? ("api_with_search" as const)
    : ("api_without_search" as const);
}

function safeError(
  status: number | null,
  body: OpenRouterResponse | null,
  fallback: string,
  fallbackCode = "network_error",
): EngineProviderError {
  return {
    code:
      body?.error?.code !== undefined
        ? String(body.error.code)
        : status !== null && status >= 400
          ? `http_${status}`
          : fallbackCode,
    message: (body?.error?.message || fallback).slice(0, 500),
    status,
    retryable: status === 429,
  };
}

function emptyUsage(): EngineUsage {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningTokens: null,
    visibleOutputTokens: null,
  };
}

export class OpenRouterEngineAdapter implements EngineAdapter {
  readonly provider = "OpenRouter";
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly retryPermit: () => boolean;
  private readonly fetchImpl: FetchLike;

  constructor(input: {
    apiKey: string;
    model: string;
    endpoint?: string;
    timeoutMs?: number;
    maxRetries?: number;
    backoffBaseMs?: number;
    retryPermit?: () => boolean;
    fetchImpl?: FetchLike;
    testMode?: "mock";
  }) {
    if (!input.apiKey.trim())
      throw new Error(
        "OPENROUTER_API_KEY is required to initialize the OpenRouter engine adapter.",
      );
    if (!input.model.trim())
      throw new Error(
        "OPENROUTER_MODEL is required to initialize the OpenRouter engine adapter.",
      );
    if (
      input.testMode === "mock" &&
      (!input.fetchImpl || input.fetchImpl === nativeFetch)
    )
      throw new Error(
        "AI_TEST_MODE=mock blocks the native OpenRouter transport. Inject a mock fetch implementation.",
      );
    this.apiKey = input.apiKey;
    this.model = input.model.trim();
    this.endpoint =
      input.endpoint || "https://openrouter.ai/api/v1/chat/completions";
    this.timeoutMs = input.timeoutMs ?? 60_000;
    this.maxRetries = Math.max(0, Math.min(2, input.maxRetries ?? 2));
    this.backoffBaseMs = Math.max(0, Math.min(2_000, input.backoffBaseMs ?? 800));
    this.retryPermit = input.retryPermit ?? (() => true);
    this.fetchImpl = input.fetchImpl || fetch;
  }

  async run(request: EngineRunRequest): Promise<EngineResponse> {
    const started = Date.now();
    const timestamp = new Date().toISOString();
    let retries = 0;
    let lastError: EngineProviderError | null = null;
    let lastBody: OpenRouterResponse | null = null;
    let chargedCostMicros = 0;
    let costKnown = false;

    while (retries <= this.maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            provider: { allow_fallbacks: false, require_parameters: true },
            reasoning: { enabled: false },
            messages: [
              {
                role: "system",
                content:
                  "Return only the requested final answer or JSON result. Never output reasoning, analysis, a thinking process, internal steps, or <think> tags. Answer independently using the supplied web evidence and cite sources when appropriate. Name concrete options, preserve uncertainty, and do not assume any brand must appear.",
              },
              { role: "user", content: request.prompt },
            ],
            max_tokens: Math.max(
              200,
              Math.min(request.maxOutputTokens || 1_200, 2_400),
            ),
            usage: { include: true },
            // A comparative measurement needs one search before every answer.
            // The deprecated web plugin is intentional until methodology changes;
            // the server tool lets each model choose zero or multiple searches.
            plugins: request.useSearch ? [{ id: "web", max_results: request.searchResults ?? 3 }] : undefined,
          }),
        });
        const body = (await response
          .json()
          .catch(() => null)) as OpenRouterResponse | null;
        lastBody = body;
        const attemptCost = actualProviderCostMicros(body?.usage?.cost);
        if (attemptCost !== null) { chargedCostMicros += attemptCost; costKnown = true; }
        if (!response.ok || !body) {
          lastError = safeError(
            response.status,
            body,
            "OpenRouter returned an invalid response.",
          );
          if (response.status !== 429 || retries >= this.maxRetries || !this.retryPermit()) break;
        } else {
          const text = outputText(body);
          if (!text) {
            lastError = safeError(
              response.status,
              body,
              "OpenRouter returned no usable final answer.",
              rawOutputText(body) ? "reasoning_only_response" : "empty_final_response",
            );
            break;
          } else if (request.expectedFormat === "discovery_json" && !validDiscoveryJson(text)) {
            lastError = safeError(response.status, body, "OpenRouter returned an invalid discovery JSON result.", "invalid_final_response");
            break;
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
              estimatedCostMicros: costKnown ? chargedCostMicros : null,
              durationMs: Date.now() - started,
              retryCount: retries,
              providerRunId: body.id || null,
              finishReason: finishReasonFrom(body),
              timestamp,
              error: null,
            };
          }
        }
      } catch (error) {
        const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
        lastError = safeError(
          null,
          null,
          aborted
            ? "OpenRouter request timed out."
            : "OpenRouter network request failed.",
          aborted ? "timeout" : "network_error",
        );
        break;
      } finally {
        clearTimeout(timer);
      }
      retries += 1;
      const delayMs = Math.min(4_000, this.backoffBaseMs * 2 ** (retries - 1)) * (0.75 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return {
      provider: this.provider,
      model: this.model,
      surfaceType: "api_without_search",
      responseText: null,
      sources: [],
      citations: [],
      usage: lastBody ? usageFrom(lastBody) : emptyUsage(),
      estimatedCostMicros: costKnown ? chargedCostMicros : null,
      durationMs: Date.now() - started,
      retryCount: retries,
      providerRunId: lastBody?.id || null,
      finishReason: lastBody ? finishReasonFrom(lastBody) : null,
      timestamp,
      error: lastError || safeError(null, null, "OpenRouter request failed."),
    };
  }
}
