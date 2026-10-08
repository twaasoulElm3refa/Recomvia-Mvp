import assert from "node:assert/strict";
import test from "node:test";
import { aggregateActualVisibility, analyzeVisibilityResponse, discoverWebsiteContext, generateIntentPrompts, runActualVisibility, type DiscoveredSiteContext, type VisibilityEngineRun } from "../lib/ai-visibility";
import type { EngineAdapter, EngineResponse } from "../lib/ai-engines/engine-adapter";
import { OpenRouterEngineAdapter } from "../lib/ai-engines/openrouter-engine-adapter";
import { actualProviderCostMicros } from "../lib/ai-engines/pricing";

const OPENROUTER_TEST_MODEL = "openai/test-model";

const context: DiscoveredSiteContext = {
  brand: { value: "Northstar", confidence: 94, evidence: ["Organization structured data"] },
  description: { value: "Analytics for retailers", confidence: 86, evidence: ["Meta description"] },
  category: { value: "Retail analytics", confidence: 82, evidence: ["Structured data type/category"] },
  offerings: { value: ["Demand forecasting"], confidence: 86, evidence: ["Product structured data"] },
  languages: { value: ["en"], confidence: 92, evidence: ["HTML lang"] },
  markets: { value: ["United Kingdom"], confidence: 86, evidence: ["Structured geographic data"] },
  intents: { value: ["discovery", "comparison", "recommendation", "alternatives"], confidence: 75, evidence: ["Framework"] },
  competitors: { value: ["RivalCo"], confidence: 66, evidence: ["Comparison language"] },
  sourceUrl: "https://northstar.example/",
};

test("discovers entity, offerings, language, market, and explicit competitors from one URL crawl", () => {
  const discovered = discoverWebsiteContext({
    sourceUrl: "https://northstar.co.uk/",
    finalUrl: "https://northstar.co.uk/",
    title: "Northstar | Retail Intelligence",
    description: "Demand forecasting for modern retailers.",
    htmlLang: "en-GB",
    html: `<html lang="en-GB"><head><meta property="og:site_name" content="Northstar"><script type="application/ld+json">{"@type":"Organization","name":"Northstar","areaServed":"United Kingdom","makesOffer":{"@type":"Service","name":"Demand forecasting"}}</script></head><body><a href="/services/forecasting">Demand forecasting</a><p>Compare Northstar with RivalCo.</p></body></html>`,
    visibleText: "Compare Northstar with RivalCo. Demand forecasting for retailers.",
  });
  assert.equal(discovered.brand.value, "Northstar");
  assert.ok(discovered.offerings.value.includes("Demand forecasting"));
  assert.ok(discovered.languages.value.includes("en"));
  assert.ok(discovered.markets.value.includes("United Kingdom"));
  assert.ok(discovered.competitors.value.includes("RivalCo"));
  assert.ok(discovered.brand.confidence > 90);
});

test("generates contextual intent prompts without forcing the tested brand into the answer", () => {
  const prompts = generateIntentPrompts(context);
  assert.deepEqual(prompts.map(item => item.intent), ["discovery", "comparison", "recommendation", "alternatives"]);
  assert.ok(prompts.every(item => item.question.includes("Demand forecasting")));
  assert.ok(prompts.every(item => !item.question.includes("Northstar")));
});

test("extracts brand visibility, recommendation, list position, competitors, and citations", () => {
  const analysis = analyzeVisibilityResponse({
    responseText: "1. Northstar — a top recommended option.\n2. RivalCo — an alternative.",
    brand: "Northstar",
    sourceUrl: context.sourceUrl,
    knownCompetitors: ["RivalCo"],
    citations: [{ url: "https://source.example/a", title: "Market guide", startIndex: 0, endIndex: 10 }],
  });
  assert.equal(analysis.brandVisible, true);
  assert.equal(analysis.mentionCount, 1);
  assert.equal(analysis.recommendationStatus, "recommended");
  assert.equal(analysis.recommendationPosition, 1);
  assert.ok(analysis.competitorsMentioned.includes("RivalCo"));
  assert.ok(analysis.evidence.some(item => item.type === "citation" && item.sourceUrl === "https://source.example/a"));
});

test("keeps Actual AI Visibility scoring independent from readiness", () => {
  const readinessScore = 91;
  const run = {
    error: null,
    responseText: "No tested brand appears.",
    analysis: { brandVisible: false, recommendationStatus: "absent", recommendationPosition: null },
  } as VisibilityEngineRun;
  const visibility = aggregateActualVisibility([run], 1);
  assert.equal(visibility.score, 0);
  assert.equal(readinessScore, 91);
});

test("runs through the EngineAdapter contract and preserves provider failure as a partial result", async () => {
  let calls = 0;
  const adapter: EngineAdapter = {
    provider: "Test API",
    model: "test-model",
    async run(request): Promise<EngineResponse> {
      calls += 1;
      return calls === 2 ? {
        provider: "Test API", model: "test-model", surfaceType: "api_with_search", responseText: null,
        sources: [], citations: [], usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null },
        estimatedCostMicros: null, durationMs: 2, retryCount: 2, providerRunId: null, timestamp: new Date().toISOString(),
        error: { code: "rate_limit", message: "Rate limited", status: 429, retryable: true },
      } : {
        provider: "Test API", model: "test-model", surfaceType: request.useSearch ? "api_with_search" : "api_without_search",
        responseText: "Northstar is a recommended option.", sources: [], citations: [],
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 8, totalTokens: 18 }, estimatedCostMicros: null,
        durationMs: 3, retryCount: 0, providerRunId: `response_${calls}`, timestamp: new Date().toISOString(), error: null,
      };
    },
  };
  const measurement = await runActualVisibility({ adapter, context, prompts: generateIntentPrompts(context).slice(0, 2) });
  assert.equal(measurement.status, "partial");
  assert.equal(measurement.engineRuns.length, 2);
  assert.equal(measurement.engineRuns[1].error?.status, 429);
});

test("isolates an unexpected adapter exception so the remaining prompts are still stored", async () => {
  let calls = 0;
  const adapter: EngineAdapter = {
    provider: "Throwing API",
    model: "throwing-model",
    async run(): Promise<EngineResponse> {
      calls += 1;
      if (calls === 1) throw new Error("Unexpected adapter failure");
      return {
        provider: "Throwing API", model: "throwing-model", surfaceType: "api_with_search", responseText: "Northstar is listed.",
        sources: [], citations: [], usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 5, totalTokens: 10 },
        estimatedCostMicros: null, durationMs: 1, retryCount: 0, providerRunId: "response_ok", timestamp: new Date().toISOString(), error: null,
      };
    },
  };
  const measurement = await runActualVisibility({ adapter, context, prompts: generateIntentPrompts(context).slice(0, 2) });
  assert.equal(measurement.status, "partial");
  assert.equal(measurement.engineRuns[0].error?.code, "adapter_error");
  assert.equal(measurement.engineRuns[1].providerRunId, "response_ok");
});

test("OpenRouter adapter retries bounded provider errors and records returned sources, citations, usage, actual cost, and run ID", async () => {
  let requests = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requests += 1;
    assert.match(String(new Headers(init?.headers).get("authorization")), /^Bearer /);
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, OPENROUTER_TEST_MODEL);
    assert.deepEqual(request.usage, { include: true });
    assert.equal(request.tools[0].type, "openrouter:web_search");
    if (requests === 1) return new Response(JSON.stringify({ error: { code: "server_error", message: "Try again" } }), { status: 500, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({
      id: "generation_real_shape", model: OPENROUTER_TEST_MODEL,
      choices: [{ message: {
        content: "Northstar is listed.",
        annotations: [{ type: "url_citation", url_citation: { url: "https://source.example/a", title: "Source A", start_index: 0, end_index: 9 } }],
      } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 20 }, server_tool_use: { web_search_requests: 1 }, cost: 0.010152 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: OPENROUTER_TEST_MODEL, fetchImpl, maxRetries: 1 });
  const response = await adapter.run({ prompt: "Which options?", language: "en", country: "UK", useSearch: true });
  assert.equal(response.provider, "OpenRouter");
  assert.equal(response.model, OPENROUTER_TEST_MODEL);
  assert.equal(response.surfaceType, "api_with_search");
  assert.equal(response.retryCount, 1);
  assert.equal(response.providerRunId, "generation_real_shape");
  assert.deepEqual(response.usage, { inputTokens: 100, cachedInputTokens: 20, outputTokens: 20, totalTokens: 120 });
  assert.equal(response.sources[0].url, "https://source.example/a");
  assert.equal(response.citations[0].url, "https://source.example/a");
  assert.equal(response.estimatedCostMicros, 10_152);
});

test("OpenRouter adapter keeps absent citations and provider cost empty without fabrication", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.tools[0].type, "openrouter:web_search");
    return new Response(JSON.stringify({
      id: "generation_without_search", model: OPENROUTER_TEST_MODEL,
      choices: [{ message: { content: [{ type: "text", text: "A plain answer." }] } }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10, server_tool_use: { web_search_requests: 1 } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: OPENROUTER_TEST_MODEL, fetchImpl });
  const response = await adapter.run({ prompt: "Answer plainly", language: "en", country: "Global", useSearch: true });
  assert.equal(response.surfaceType, "api_with_search");
  assert.deepEqual(response.sources, []);
  assert.deepEqual(response.citations, []);
  assert.equal(response.estimatedCostMicros, null);
});

test("OpenRouter adapter labels a run without an executed search accurately", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.tools, undefined);
    assert.equal(request.max_tool_calls, undefined);
    return new Response(JSON.stringify({
      id: "generation_no_tool", model: OPENROUTER_TEST_MODEL,
      choices: [{ message: { content: "A plain answer." } }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const response = await new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: OPENROUTER_TEST_MODEL, fetchImpl })
    .run({ prompt: "Answer plainly", language: "en", country: "Global", useSearch: false });
  assert.equal(response.surfaceType, "api_without_search");
});

test("OpenRouter adapter records bounded timeout and provider failures", async () => {
  const timeoutFetch: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const timedOut = await new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: OPENROUTER_TEST_MODEL, fetchImpl: timeoutFetch, timeoutMs: 1, maxRetries: 0 })
    .run({ prompt: "Timeout", language: "en", country: "Global", useSearch: true });
  assert.equal(timedOut.error?.code, "timeout");
  assert.equal(timedOut.retryCount, 0);
  assert.equal(timedOut.responseText, null);

  const providerFetch: typeof fetch = async () => new Response(JSON.stringify({ error: { code: "invalid_model", message: "Model unavailable" } }), { status: 400, headers: { "content-type": "application/json" } });
  const failed = await new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: OPENROUTER_TEST_MODEL, fetchImpl: providerFetch, maxRetries: 2 })
    .run({ prompt: "Failure", language: "en", country: "Global", useSearch: true });
  assert.equal(failed.error?.code, "invalid_model");
  assert.equal(failed.error?.retryable, false);
  assert.equal(failed.retryCount, 0);
});

test("OpenRouter adapter requires both server-side configuration values", () => {
  assert.throws(() => new OpenRouterEngineAdapter({ apiKey: "", model: OPENROUTER_TEST_MODEL }), /OPENROUTER_API_KEY/);
  assert.throws(() => new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: "" }), /OPENROUTER_MODEL/);
});

test("cost calculation uses only actual provider cost and returns null when unavailable", () => {
  assert.equal(actualProviderCostMicros(0.010152), 10_152);
  assert.equal(actualProviderCostMicros(0), 0);
  assert.equal(actualProviderCostMicros(undefined), null);
  assert.equal(actualProviderCostMicros(-1), null);
});
