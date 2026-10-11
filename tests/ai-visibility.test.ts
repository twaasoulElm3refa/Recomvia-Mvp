import assert from "node:assert/strict";
import test from "node:test";
import { aggregateActualVisibility, analyzeVisibilityResponse, businessContextForVisibility, discoverWebsiteContext, discoverWebsiteIdentityCandidates, generateIntentPrompts, isTechnicalWebsiteVocabulary, runActualVisibility, type DiscoveredSiteContext, type VisibilityEngineRun } from "../lib/ai-visibility";
import { generateTargetPrompts, type AnalysisTarget } from "../lib/analysis-target";
import { decodeHtmlEntities, sanitizeProviderAnswer } from "../lib/answer-text";
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

test("URL identity stays anchored to the submitted domain and similar external names are not proof", () => {
  const html = `<html><head><title>AI Arabic &#8211; Artificial intelligence news</title></head><body>
    <script type="application/ld+json">{"@type":"Organization","name":"Belarabi","url":"https://belarabi.me"}</script>
    <script type="application/ld+json">{"@type":"Organization","name":"AI Arabic Telegram","url":"https://t.me/aiarabic"}</script>
  </body></html>`;
  const identities = discoverWebsiteIdentityCandidates({
    html,
    title: "AI Arabic &#8211; Artificial intelligence news",
    finalUrl: "https://aiarabic.com/",
  });
  assert.deepEqual(identities.map((item) => item.name), ["AI Arabic"]);
  const discovered = discoverWebsiteContext({
    sourceUrl: "https://aiarabic.com/",
    finalUrl: "https://aiarabic.com/",
    title: "AI Arabic &#8211; Artificial intelligence news",
    description: "Arabic artificial intelligence news",
    htmlLang: "en",
    html,
    visibleText: "Arabic artificial intelligence news",
  });
  assert.equal(discovered.brand.value, "AI Arabic");
  assert.equal(discovered.category.value, "Artificial intelligence news");
});

test("conflicting identities anchored on the submitted website remain ambiguous", () => {
  const html = `<html><head><meta property="og:site_name" content="Second Identity"></head><body>
    <script type="application/ld+json">{"@type":"Organization","name":"First Identity","url":"https://same.example/about"}</script>
  </body></html>`;
  assert.deepEqual(
    discoverWebsiteIdentityCandidates({
      html,
      title: "Ignored title",
      finalUrl: "https://same.example/",
    }).map((item) => item.name),
    ["First Identity", "Second Identity"],
  );
});

test("visible business content outranks SearchAction and other structured-data vocabulary", () => {
  const html = `<html lang="en"><head>
    <title>Northstar | Retail analytics for modern stores</title>
    <meta name="description" content="Northstar provides retail analytics and inventory planning services.">
    <script type="application/ld+json">{
      "@context":"https://schema.org",
      "@type":"WebSite",
      "name":"Northstar",
      "url":"https://northstar.example/",
      "potentialAction":{"@type":"SearchAction","target":"https://northstar.example/?s={search_term_string}","query-input":"required name=search_term_string"},
      "publisher":{"@type":"Organization","name":"Organization","description":"Northstar provides retail analytics and inventory planning services."},
      "mainEntity":{"@type":"WebPage","category":"potentialAction"},
      "hasOfferCatalog":{"@type":"ItemList","itemListElement":[
        {"@type":"Product","name":"Organization"},
        {"@type":"Service","name":"Demand forecasting"}
      ]}
    }</script>
  </head><body>
    <h1>Retail analytics for modern stores</h1>
    <p>We provide retail analytics and demand forecasting for modern retailers.</p>
    <nav><a href="/services/inventory-planning">Inventory planning</a></nav>
    <section class="product-cards"><article><h2>Demand forecasting</h2></article></section>
  </body></html>`;
  const visibleText = "Northstar Retail analytics for modern stores We provide retail analytics and demand forecasting for modern retailers. Inventory planning Demand forecasting";
  const discovered = discoverWebsiteContext({
    sourceUrl: "https://northstar.example/",
    finalUrl: "https://northstar.example/",
    title: "Northstar | Retail analytics for modern stores",
    description: "Northstar provides retail analytics and inventory planning services.",
    htmlLang: "en",
    html,
    visibleText,
  });
  assert.equal(
    discovered.category.value,
    "retail analytics and demand forecasting for modern retailers",
  );
  assert.equal(discovered.category.evidence[0], "Visible homepage business copy");
  assert.ok(discovered.category.confidence >= 80);
  assert.ok(discovered.offerings.value.includes("Inventory planning"));
  assert.ok(discovered.offerings.value.includes("Demand forecasting"));
  for (const forbidden of [
    "SearchAction",
    "SearchAction services",
    "WebSite",
    "WebPage",
    "Organization",
    "potentialAction",
    "publisher",
    "mainEntity",
  ]) {
    assert.notEqual(discovered.category.value, forbidden);
    assert.ok(!discovered.offerings.value.includes(forbidden));
  }
  const selected = businessContextForVisibility(discovered);
  assert.ok(selected);
  const target: AnalysisTarget = {
    kind: "website",
    input: "https://northstar.example/",
    name: "Northstar",
    websiteUrl: "https://northstar.example/",
    aliases: [],
    category: selected,
    language: "en",
    country: "Global",
    identityConfirmed: false,
  };
  const prompts = generateTargetPrompts(target);
  assert.equal(prompts.length, 3);
  assert.ok(prompts.slice(1).every((prompt) => prompt.question.includes(selected)));
  assert.ok(prompts.every((prompt) => !prompt.question.includes("SearchAction")));
});

test("technical or low-confidence context cannot create unbranded prompts", () => {
  for (const value of [
    "SearchAction",
    "WebSite",
    "Organization",
    "potentialAction",
    "mainEntityOfPage",
    "SoftwareApplication",
    "MedicalOrganization",
    "og:title",
    "meta tag",
    "JSON-LD",
    "<h1>",
  ])
    assert.equal(isTechnicalWebsiteVocabulary(value), true, value);

  const html = `<html><head><title>Example</title><script type="application/ld+json">{"@type":"WebSite","potentialAction":{"@type":"SearchAction"}}</script></head><body><h1>Welcome</h1></body></html>`;
  const discovered = discoverWebsiteContext({
    sourceUrl: "https://example.test/",
    finalUrl: "https://example.test/",
    title: "Example",
    description: "",
    htmlLang: "en",
    html,
    visibleText: "Example Welcome",
  });
  assert.equal(discovered.category.value, "");
  assert.equal(discovered.category.confidence, 0);
  assert.deepEqual(discovered.offerings.value, []);
  assert.equal(businessContextForVisibility(discovered), "");
  assert.equal(
    generateTargetPrompts({
      kind: "website",
      input: "https://example.test/",
      name: "Example",
      websiteUrl: "https://example.test/",
      aliases: [],
      category: "SearchAction",
      language: "en",
      country: "Global",
      identityConfirmed: false,
    }).length,
    1,
  );
});

test("Arabic production regression shape derives AI-news context from visible copy, not SearchAction", () => {
  const visibleBusinessCopy = "أخبار وتحليلات الذكاء الاصطناعي باللغة العربية";
  const html = `<html dir="rtl" lang="ar"><head>
    <title>AI بالعربي | إيه آي بالعربي &#8211; أخبار الذكاء الاصطناعي باللغة العربية</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"AI بالعربي","url":"https://aiarabic.com/","potentialAction":{"@type":"SearchAction","target":"https://aiarabic.com/?s={search_term_string}"}}</script>
  </head><body><h1>أخبار الذكاء الاصطناعي باللغة العربية</h1><p>نقدم ${visibleBusinessCopy}.</p></body></html>`;
  const discovered = discoverWebsiteContext({
    sourceUrl: "https://aiarabic.com/",
    finalUrl: "https://aiarabic.com/",
    title: "AI بالعربي | إيه آي بالعربي – أخبار الذكاء الاصطناعي باللغة العربية",
    description: "",
    htmlLang: "ar",
    html,
    visibleText: `AI بالعربي أخبار الذكاء الاصطناعي باللغة العربية نقدم ${visibleBusinessCopy}`,
  });
  assert.equal(discovered.category.value, visibleBusinessCopy);
  assert.ok(!businessContextForVisibility(discovered).includes("SearchAction"));
  assert.ok(
    generateTargetPrompts({
      kind: "website",
      input: "https://aiarabic.com/",
      name: discovered.brand.value,
      websiteUrl: "https://aiarabic.com/",
      aliases: ["إيه آي بالعربي"],
      category: businessContextForVisibility(discovered),
      language: "ar",
      country: "Global",
      identityConfirmed: false,
    })
      .slice(1)
      .every((prompt) => !prompt.question.includes("SearchAction")),
  );
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
    responseText: "No tested brand appears.", surfaceType: "api_with_search", intent: "recommendation",
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

test("Qwen reasoning is removed before storage while citations and the final answer remain", async () => {
  assert.equal(decodeHtmlEntities("News &#8211; Arabic"), "News – Arabic");
  assert.equal(
    sanitizeProviderAnswer("The user wants current options.\nLet me search.\nFinal answer: Useful answer."),
    "Useful answer.",
  );
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        id: "qwen-clean",
        model: "qwen/test",
        choices: [{
          message: {
            content: "The user wants...\n</think>\n## Final answer\n**Useful** answer &#8211; verified.",
            annotations: [{ type: "url_citation", url_citation: { url: "https://source.example/qwen", title: "Evidence" } }],
          },
        }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, server_tool_use: { web_search_requests: 1 } },
      }),
      { headers: { "content-type": "application/json" } },
    );
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: "qwen/test", fetchImpl });
  const result = await runActualVisibility({
    adapter,
    context,
    prompts: [generateIntentPrompts(context)[0]],
  });
  assert.equal(result.engineRuns[0].responseText, "## Final answer\n**Useful** answer – verified.");
  assert.ok(!result.engineRuns[0].responseText?.includes("think"));
  assert.ok(!result.engineRuns[0].responseText?.includes("The user wants"));
  assert.equal(result.engineRuns[0].citations[0].url, "https://source.example/qwen");
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
