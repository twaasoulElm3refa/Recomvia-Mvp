import assert from "node:assert/strict";
import test from "node:test";
import { aggregateActualVisibility, analyzeVisibilityResponse, businessContextForVisibility, discoverWebsiteContext, discoverWebsiteIdentityCandidates, generateIntentPrompts, isTechnicalWebsiteVocabulary, runActualVisibility, type DiscoveredSiteContext, type VisibilityEngineRun } from "../lib/ai-visibility";
import { generateTargetPrompts, parseTargetDiscovery, type AnalysisTarget, type TargetInput } from "../lib/analysis-target";
import { runLiveReadinessScan } from "../lib/live-readiness";
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

test("OpenRouter adapter retries a 429 and records returned sources, citations, usage, actual cost, and run ID", async () => {
  let requests = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requests += 1;
    assert.match(String(new Headers(init?.headers).get("authorization")), /^Bearer /);
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, OPENROUTER_TEST_MODEL);
    assert.deepEqual(request.usage, { include: true });
    assert.deepEqual(request.reasoning, { enabled: false });
    assert.deepEqual(request.plugins, [{ id: "web", max_results: 1 }]);
    assert.equal(request.tools, undefined);
    if (requests === 1) return new Response(JSON.stringify({ error: { code: "rate_limit", message: "Try again" } }), { status: 429, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({
      id: "generation_real_shape", model: OPENROUTER_TEST_MODEL,
      choices: [{ message: {
        content: "Northstar is listed.",
        annotations: [{ type: "url_citation", url_citation: { url: "https://source.example/a", title: "Source A", start_index: 0, end_index: 9 } }],
      } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 20 }, cost: 0.010152 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: OPENROUTER_TEST_MODEL, fetchImpl, maxRetries: 1, backoffBaseMs: 0 });
  const response = await adapter.run({ prompt: "Which options?", language: "en", country: "UK", useSearch: true });
  assert.equal(response.provider, "OpenRouter");
  assert.equal(response.model, OPENROUTER_TEST_MODEL);
  assert.equal(response.surfaceType, "api_with_search");
  assert.equal(response.retryCount, 1);
  assert.equal(response.providerRunId, "generation_real_shape");
  assert.deepEqual(response.usage, { inputTokens: 100, cachedInputTokens: 20, outputTokens: 20, totalTokens: 120, reasoningTokens: null, visibleOutputTokens: null });
  assert.equal(response.sources[0].url, "https://source.example/a");
  assert.equal(response.citations[0].url, "https://source.example/a");
  assert.equal(response.estimatedCostMicros, 10_152);
});

test("OpenRouter adapter keeps absent citations and provider cost empty without fabrication", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(request.plugins, [{ id: "web", max_results: 1 }]);
    return new Response(JSON.stringify({
      id: "generation_without_search", model: OPENROUTER_TEST_MODEL,
      choices: [{ message: { content: [{ type: "text", text: "A plain answer." }] } }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: OPENROUTER_TEST_MODEL, fetchImpl });
  const response = await adapter.run({ prompt: "Answer plainly", language: "en", country: "Global", useSearch: true });
  assert.equal(response.surfaceType, "api_without_search");
  assert.deepEqual(response.sources, []);
  assert.deepEqual(response.citations, []);
  assert.equal(response.estimatedCostMicros, null);
});

test("short visibility answers are final without continuation or summarization and keep at most two sources", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.max_tokens, 180);
    assert.deepEqual(request.reasoning, { enabled: false });
    assert.deepEqual(request.plugins, [{ id: "web", max_results: 1 }]);
    assert.match(request.messages[0].content, /No introduction, repeated question, chain-of-thought/);
    assert.match(request.messages[0].content, /at most 2 short paragraphs or 4 short bullets/);
    assert.match(request.messages[0].content, /at most 2 supporting sources/);
    assert.match(request.messages[0].content, /in Arabic/);
    return Response.json({ id: "short-answer", choices: [{ finish_reason: "stop", message: {
      content: "خيار مناسب.",
      annotations: ["a", "b", "c"].map((id) => ({ type: "url_citation", url_citation: { url: `https://source.example/${id}`, title: id } })),
    } }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, cost: 0.0007 } });
  };
  const result = await new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: OPENROUTER_TEST_MODEL, fetchImpl })
    .run({ prompt: "ما الخيار المناسب؟", language: "ar", country: "Egypt", useSearch: true, maxOutputTokens: 180 });
  assert.equal(calls, 1);
  assert.equal(result.error, null);
  assert.equal(result.responseText, "خيار مناسب.");
  assert.equal(result.sources.length, 2);
  assert.equal(result.citations.length, 2);
  assert.equal(result.estimatedCostMicros, 700);
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
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
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

test("empty HTTP 200 with exhausted reasoning budget stays failed and keeps usage, finish reason, and cost", async () => {
  let calls = 0;
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: "qwen/test", fetchImpl: async () => {
    calls++;
    return Response.json({ id: "charged-empty", model: "qwen/test", choices: [{ finish_reason: "length", message: { content: "" } }],
      usage: { prompt_tokens: 100, completion_tokens: 1200, total_tokens: 1300, completion_tokens_details: { reasoning_tokens: 1200 }, cost: 0.007 } });
  } });
  const result = await adapter.run({ prompt: "Which options?", language: "en", country: "UK", useSearch: true });
  assert.equal(calls, 1);
  assert.equal(result.error?.code, "empty_final_response");
  assert.equal(result.responseText, null);
  assert.equal(result.finishReason, "length");
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.usage.outputTokens, 1200);
  assert.equal(result.usage.reasoningTokens, 1200);
  assert.equal(result.usage.visibleOutputTokens, 0);
  assert.equal(result.estimatedCostMicros, 7_000);
  assert.equal(result.providerRunId, "charged-empty");
  assert.equal(result.retryCount, 0);
});

test("thinking-only content fails while a marked final answer is accepted without exposing reasoning", async () => {
  let calls = 0;
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: "qwen/test", fetchImpl: async () => {
    calls++;
    return Response.json({ id: `reasoning-${calls}`, choices: [{ finish_reason: "stop", message: { content: calls === 1
      ? "Thinking Process:\nFirst I should analyze the options.\nThen I should compare them."
      : "Thinking Process:\nFirst I should analyze the options.\nFinal Answer: Northstar is recommended." } }],
      usage: { completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 20 }, cost: 0.002 } });
  } });
  const request = { prompt: "Which options?", language: "en", country: "UK", useSearch: true };
  const failed = await adapter.run(request);
  assert.equal(failed.error?.code, "reasoning_only_response");
  assert.equal(failed.responseText, null);
  assert.equal(failed.estimatedCostMicros, 2_000);
  const passed = await adapter.run(request);
  assert.equal(passed.error, null);
  assert.equal(passed.responseText, "Northstar is recommended.");
  assert.ok(!passed.responseText?.includes("Thinking Process"));
});

test("discovery JSON must parse before the adapter reports success", async () => {
  const input: TargetInput = { input: "Ada Example", kind: "person", context: "", language: "en", websiteUrl: null };
  const source = "https://source.example/ada";
  const valid = JSON.stringify({ status: "resolved", candidates: [{ kind: "person", name: "Ada Example", description: "Researcher", category: "Analytics", aliases: [], country: "Global", websiteUrl: null, sources: [source] }] });
  let calls = 0;
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: "qwen/test", fetchImpl: async () => {
    calls++;
    return Response.json({ id: `discovery-${calls}`, choices: [{ message: { content: calls === 1 ? "not valid JSON" : valid,
      annotations: [{ type: "url_citation", url_citation: { url: source, title: "Profile" } }] } }], usage: { cost: 0.001 } });
  } });
  const request = { prompt: "Resolve identity", language: "en", country: "Global", useSearch: true, expectedFormat: "discovery_json" as const };
  const invalid = await adapter.run(request);
  assert.equal(invalid.error?.code, "invalid_final_response");
  assert.equal(invalid.estimatedCostMicros, 1_000);
  const parsed = await adapter.run(request);
  assert.equal(parsed.error, null);
  assert.equal(parseTargetDiscovery(parsed, input).status, "resolved");
});

test("truncated structured discovery fails once with the same token cap and provider cost", async () => {
  let calls = 0;
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: OPENROUTER_TEST_MODEL, fetchImpl: async (_input, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.max_tokens, 600);
    assert.deepEqual(request.reasoning, { enabled: false });
    assert.deepEqual(request.plugins, [{ id: "web", max_results: 1 }]);
    return Response.json({ id: "truncated-discovery", choices: [{ finish_reason: "length", message: { content: '{"status":"unresolved","candidates":[]}' } }], usage: { cost: 0.003 } });
  } });
  const result = await adapter.run({ prompt: "Resolve identity", language: "en", country: "Global", useSearch: true, expectedFormat: "discovery_json" });
  assert.equal(calls, 1);
  assert.equal(result.error?.code, "invalid_final_response");
  assert.equal(result.responseText, null);
  assert.equal(result.estimatedCostMicros, 3_000);
});

test("a billed empty final answer is excluded from visibility scoring", async () => {
  let calls = 0;
  const adapter = new OpenRouterEngineAdapter({ apiKey: "test-only-key", model: "qwen/test", fetchImpl: async () => {
    calls++;
    return Response.json({ id: `score-${calls}`, choices: [{ message: { content: calls === 1 ? "Northstar is recommended." : "",
      annotations: [{ type: "url_citation", url_citation: { url: "https://source.example/a", title: "Evidence" } }] } }],
      usage: { cost: 0.001 } });
  } });
  const measurement = await runActualVisibility({ adapter, context, prompts: generateIntentPrompts(context).slice(0, 2) });
  assert.equal(measurement.status, "partial");
  assert.equal(measurement.score, 100);
  assert.equal(measurement.engineRuns[1].error?.code, "empty_final_response");
  assert.equal(measurement.engineRuns[1].estimatedCostMicros, 1_000);
});

test("OpenRouter adapter labels a run without an executed search accurately", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.plugins, undefined);
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


test("OpenRouter rejects oversized declared provider bodies without parsing or retrying", async () => {
  let cancelled = false;
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array([123])); },
      cancel() { cancelled = true; },
    });
    return new Response(stream, { headers: { "Content-Length": "1048577", "Content-Type": "application/json" } });
  };
  const result = await new OpenRouterEngineAdapter({
    apiKey: "mock-only", model: OPENROUTER_TEST_MODEL, fetchImpl, maxRetries: 2,
  }).run({ prompt: "Answer briefly", language: "en", country: "Global", useSearch: false });
  assert.equal(result.error?.code, "response_too_large");
  assert.equal(result.estimatedCostMicros, null);
  assert.equal(result.responseText, null);
  assert.equal(result.retryCount, 0);
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test("OpenRouter stops an undeclared oversized response stream before buffering it", async () => {
  let chunks = 0;
  let cancelled = false;
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(131_072).fill(97));
      if (chunks === 32) controller.close();
    },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json" } });
  const result = await new OpenRouterEngineAdapter({
    apiKey: "mock-only", model: OPENROUTER_TEST_MODEL, fetchImpl, maxRetries: 0,
  }).run({ prompt: "Answer briefly", language: "en", country: "Global", useSearch: false });
  assert.equal(result.error?.code, "response_too_large");
  assert.equal(result.estimatedCostMicros, null);
  assert.equal(result.responseText, null);
  assert.ok(chunks < 32, "stream cancelled well before full remote payload");
  assert.equal(cancelled, true);
});

test("OpenRouter bounded JSON decoding preserves split Arabic text and real cost", async () => {
  const reply = "مرحبًا بالعالم";
  const payload = new TextEncoder().encode(JSON.stringify({
    id: "split-utf8", choices: [{ message: { content: reply } }], usage: { cost: 0.0012 },
  }));
  const split = payload.findIndex((byte) => byte >= 0x80);
  assert.ok(split > 0);
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload.slice(0, split + 1));
      controller.enqueue(payload.slice(split + 1));
      controller.close();
    },
  }), { headers: { "Content-Type": "application/json" } });
  const result = await new OpenRouterEngineAdapter({
    apiKey: "mock-only", model: OPENROUTER_TEST_MODEL, fetchImpl,
  }).run({ prompt: "أجب بالعربية", language: "ar", country: "Global", useSearch: false });
  assert.equal(result.error, null);
  assert.equal(result.responseText, reply);
  assert.equal(result.estimatedCostMicros, 1200);
});


test("readiness canonical scoring rejects unsafe or broken href values but accepts public relative and entity-encoded URLs", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const cases = [
      { href: "/articles?lang=ar", valid: true, expected: "https://fixture.example/articles?lang=ar" },
      { href: "https://other.example/page?x=1&amp;y=2", valid: true, expected: "https://other.example/page?x=1&y=2" },
      { href: "", valid: false },
      { href: "#section", valid: false },
      { href: "javascript:alert(1)", valid: false },
      { href: "https://localhost/private", valid: false },
      { href: "http://127.0.0.1/private", valid: false },
      { href: "https://fixture.example:8443/private", valid: false },
      { href: "https://user:secret@fixture.example/", valid: false },
      { href: "https://fixture.example/page#fragment", valid: false },
    ];
    for (const { href, valid, expected } of cases) {
      const pageHtml = `<!doctype html><html lang="en"><head><title>Fixture site for canonical testing</title>
        <link rel="canonical" href="${href}"></head><body><h1>Fixture page</h1></body></html>`;
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/robots.txt") return new Response("User-agent: *\\nAllow: /", { headers: { "content-type": "text/plain" } });
        if (path === "/sitemap.xml") return new Response('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', { headers: { "content-type": "application/xml" } });
        return new Response(pageHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
      };
      const result = await runLiveReadinessScan("https://fixture.example/");
      const finding = result.findings.find((item) => item.code === "canonical");
      assert.ok(finding, "canonical readiness finding is required");
      assert.equal(finding.status, valid ? "pass" : "fail", href);
      assert.equal(finding.awardedPoints, valid ? 7 : 0, href);
      if (expected) assert.equal(finding.evidence, expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("readiness trusts only live head metadata, not comments, inert examples, or body tags", async () => {
  const originalFetch = globalThis.fetch;
  const description = "Northstar provides reliable retail analytics, inventory planning, and demand forecasting for merchants.";
  const metadata = '<meta name="description" content="' + description + '">' +
    '<meta property="og:title" content="Northstar retail analytics">' +
    '<meta property="og:description" content="Demand forecasting for merchants">';
  const noindex = '<meta name="robots" content="noindex">';
  const html = (head: string, body = "<h1>Northstar</h1>") =>
    '<!doctype html><html lang="en"><head><title>Northstar analytics</title>' + head + '</head><body>' + body + '</body></html>';
  const cases = [
    { label: "HTML comment", markup: html("<!-- " + metadata + noindex + " -->"), valid: false, blocked: false },
    { label: "script text", markup: html('<script type="text/plain">' + metadata + noindex + '</script>'), valid: false, blocked: false },
    { label: "style example", markup: html("<style>" + metadata + noindex + "</style>"), valid: false, blocked: false },
    { label: "template content", markup: html("<template>" + metadata + noindex + "</template>"), valid: false, blocked: false },
    { label: "noscript example", markup: html("<noscript>" + metadata + noindex + "</noscript>"), valid: false, blocked: false },
    { label: "body meta", markup: html("", metadata + noindex + "<h1>Northstar</h1>"), valid: false, blocked: false },
    { label: "commented fake head", markup: "<!-- <head>" + metadata + noindex + "</head> -->" + html(""), valid: false, blocked: false },
    { label: "no document head", markup: "<!doctype html><html><body>" + metadata + noindex + "</body></html>", valid: false, blocked: false },
    { label: "real document head", markup: html(metadata), valid: true, blocked: false },
    { label: "mixed-case live tags", markup: html('<META PROPERTY="og:title" CONTENT="Northstar"><META CONTENT="Merchants" PROPERTY="og:description"><META CONTENT="' + description + '" NAME="description">'), valid: true, blocked: false },
    { label: "real global noindex", markup: html(metadata + noindex), valid: true, blocked: true },
  ];
  try {
    for (const entry of cases) {
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
        if (path === "/sitemap.xml") return new Response("<urlset></urlset>", { headers: { "content-type": "application/xml" } });
        return new Response(entry.markup, { headers: { "content-type": "text/html" } });
      };
      const result = await runLiveReadinessScan("https://fixture.example/");
      const descriptionFinding = result.findings.find((finding) => finding.code === "meta_description");
      const socialFinding = result.findings.find((finding) => finding.code === "open_graph");
      const robotsFinding = result.findings.find((finding) => finding.code === "robots_policy");
      assert.ok(descriptionFinding && socialFinding && robotsFinding, entry.label);
      assert.equal(descriptionFinding.awardedPoints, entry.valid ? 7 : 0, entry.label);
      assert.equal(socialFinding.awardedPoints, entry.valid ? 6 : 0, entry.label);
      assert.equal(robotsFinding.status, entry.blocked ? "fail" : "pass", entry.label);
      assert.equal(result.requestCount, 3, entry.label);
      if (entry.valid) assert.equal(result.discoveredContext.description.value, description, entry.label);
      else assert.notEqual(result.discoveredContext.description.value, description, entry.label);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness ignores inert JSON-LD examples but accepts genuine head and body scripts", async () => {
  const originalFetch = globalThis.fetch;
  const organization = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Northstar"}</script>';
  const faq = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage"}</script>';
  const cases: Array<{ label: string; head?: string; body?: string; points: [number, number, number]; inspected: number }> = [
    { label: "HTML comment", body: "<!-- " + organization + faq + " -->", points: [0, 0, 0], inspected: 0 },
    { label: "template", body: "<template>" + organization + faq + "</template>", points: [0, 0, 0], inspected: 0 },
    { label: "noscript", body: "<noscript>" + organization + faq + "</noscript>", points: [0, 0, 0], inspected: 0 },
    { label: "textarea", body: "<textarea>" + organization + faq + "</textarea>", points: [0, 0, 0], inspected: 0 },
    { label: "style example", head: "<style>" + organization + "</style>", points: [0, 0, 0], inspected: 0 },
    { label: "other script type", body: '<script type="text/plain">' + organization + "</script>", points: [0, 0, 0], inspected: 0 },
    { label: "malformed JSON-LD", head: '<script type="application/ld+json">{invalid}</script>', points: [0, 0, 0], inspected: 1 },
    { label: "active head scripts", head: organization + faq, points: [8, 8, 8], inspected: 2 },
    { label: "active body, attribute order, unquoted mixed-case type", body: '<script data-test="yes" TYPE=APPLICATION/LD+JSON>{"@type":"Organization"}</script>', points: [8, 8, 0], inspected: 1 },
    { label: "active body closing-tag whitespace", body: '<script type="application/ld+json">{"@type":"Organization"}</script >', points: [8, 8, 0], inspected: 1 },
    { label: "mixed inactive FAQ and active Organization", body: "<template>" + faq + "</template>" + organization, points: [8, 8, 0], inspected: 1 },
  ];
  try {
    for (const entry of cases) {
      const html = '<!doctype html><html lang="en"><head><title>Northstar structured data fixture</title>' +
        (entry.head || "") + '</head><body><h1>Northstar</h1>' + (entry.body || "") + "</body></html>";
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
        if (path === "/sitemap.xml") return new Response("<urlset></urlset>", { headers: { "content-type": "application/xml" } });
        return new Response(html, { headers: { "content-type": "text/html" } });
      };
      const result = await runLiveReadinessScan("https://fixture.example/");
      const codes = ["structured_data", "organization_entity", "answer_structure"];
      for (const [index, code] of codes.entries()) {
        const finding = result.findings.find((item) => item.code === code);
        assert.ok(finding, entry.label + ": missing " + code);
        assert.equal(finding.awardedPoints, entry.points[index], entry.label + ": " + code);
      }
      assert.match(result.findings.find((item) => item.code === "structured_data")!.evidence,
        new RegExp("\\(" + entry.inspected + " inspected\\)"), entry.label);
      assert.equal(result.requestCount, 3, entry.label);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness counts only active body headings for H1 and question structure", async () => {
  const originalFetch = globalThis.fetch;
  const fake = "<h1>Sample fake heading</h1><h2>How does it work?</h2>";
  const cases: Array<{
    label: string; body: string; h1: number; answer: number;
    head?: string; preceding?: string; noBody?: boolean;
  }> = [
    { label: "commented example", body: "<!-- " + fake + " -->", h1: 0, answer: 0 },
    { label: "JavaScript example", body: "<script>const example = '" + fake + "';</script>", h1: 0, answer: 0 },
    { label: "CSS example", body: "<style>" + fake + "</style>", h1: 0, answer: 0 },
    { label: "template example", body: "<template>" + fake + "</template>", h1: 0, answer: 0 },
    { label: "noscript example", body: "<noscript>" + fake + "</noscript>", h1: 0, answer: 0 },
    { label: "textarea example", body: "<textarea>" + fake + "</textarea>", h1: 0, answer: 0 },
    { label: "head-only headings", head: fake, body: "", h1: 0, answer: 0 },
    { label: "headings outside body", preceding: fake, body: "", h1: 0, answer: 0 },
    { label: "missing body", noBody: true, body: "", head: fake, h1: 0, answer: 0 },
    { label: "visible H1", body: "<h1>Northstar analytics</h1>", h1: 6, answer: 0 },
    { label: "visible question heading", body: "<h2>How does Northstar work?</h2>", h1: 0, answer: 8 },
    { label: "visible H1 and question", body: "<h1>Northstar</h1><h2>How does it work?</h2>", h1: 6, answer: 8 },
    { label: "two visible H1s", body: "<h1>First</h1><h1>Second</h1>", h1: 3, answer: 0 },
    { label: "real H1 with commented duplicate", body: "<h1>Northstar</h1><!-- " + fake + " -->", h1: 6, answer: 0 },
    { label: "real question with scripted H1", body: "<h2>How does it work?</h2><script>" + fake + "</script>", h1: 0, answer: 8 },
  ];
  try {
    for (const entry of cases) {
      const head = "<!doctype html><html lang=\"en\"><head><title>Northstar heading fixture</title>" +
        (entry.head || "") + "</head>";
      const markup = head + (entry.preceding || "") +
        (entry.noBody ? "" : "<body>" + entry.body + "</body>") + "</html>";
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
        if (path === "/sitemap.xml") return new Response("<urlset></urlset>", { headers: { "content-type": "application/xml" } });
        return new Response(markup, { headers: { "content-type": "text/html" } });
      };
      const result = await runLiveReadinessScan("https://fixture.example/");
      const primary = result.findings.find((finding) => finding.code === "primary_heading");
      const answer = result.findings.find((finding) => finding.code === "answer_structure");
      assert.ok(primary, entry.label + ": primary heading finding missing");
      assert.ok(answer, entry.label + ": answer structure finding missing");
      assert.equal(primary.awardedPoints, entry.h1, entry.label + ": H1");
      assert.equal(answer.awardedPoints, entry.answer, entry.label + ": question heading");
      assert.equal(result.requestCount, 3, entry.label + ": unexpected network requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("readiness uses only active same-origin body anchors for identity and page sampling", async () => {
  const originalFetch = globalThis.fetch;
  const fakeAbout = '<a href="/about">About this site</a>';
  const cases: Array<{ label: string; head?: string; body: string; identity: number; links: string[] }> = [
    { label: "HTML comment", body: "<!-- " + fakeAbout + " -->", identity: 0, links: [] },
    { label: "script string", body: "<script>const example = '" + fakeAbout + "';</script>", identity: 0, links: [] },
    { label: "template content", body: "<template>" + fakeAbout + "</template>", identity: 0, links: [] },
    { label: "noscript content", body: "<noscript>" + fakeAbout + "</noscript>", identity: 0, links: [] },
    { label: "textarea example", body: "<textarea>" + fakeAbout + "</textarea>", identity: 0, links: [] },
    { label: "style example", body: "<style>" + fakeAbout + "</style>", identity: 0, links: [] },
    { label: "head-only anchor", head: fakeAbout, body: "", identity: 0, links: [] },
    { label: "plain text imitating an href", body: '<p>href="/about"</p>', identity: 0, links: [] },
    { label: "external About", body: '<a href="https://other.example/about">Other company</a>', identity: 0, links: [] },
    { label: "different-origin similar domain", body: '<a href="https://fixture.example.evil/about">Other site</a>', identity: 0, links: [] },
    { label: "real About", body: fakeAbout, identity: 6, links: ["https://fixture.example/about"] },
    { label: "relative Company", body: '<a href="./company/">Company</a>', identity: 6, links: ["https://fixture.example/company/"] },
    { label: "real Contact", body: '<a href="/contact">Contact</a>', identity: 6, links: ["https://fixture.example/contact"] },
    { label: "real unrelated internal page", body: '<a href="/services">Services</a>', identity: 0, links: ["https://fixture.example/services"] },
    { label: "fake About plus real Services", body: "<!-- " + fakeAbout + ' --><a href="/services">Services</a>', identity: 0, links: ["https://fixture.example/services"] },
  ];
  try {
    for (const entry of cases) {
      const html = '<!doctype html><html lang="en"><head><title>Fixture company</title>' +
        (entry.head || "") + "</head><body>" + entry.body + "</body></html>";
      globalThis.fetch = async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
        if (pathname === "/sitemap.xml") return new Response("<urlset></urlset>", { headers: { "content-type": "application/xml" } });
        return new Response(html, { headers: { "content-type": "text/html" } });
      };
      const result = await runLiveReadinessScan("https://fixture.example/");
      const identity = result.findings.find((finding) => finding.code === "identity_paths");
      assert.ok(identity, entry.label + ": identity finding missing");
      assert.equal(identity.awardedPoints, entry.identity, entry.label + ": identity score");
      assert.deepEqual(result.internalLinks, entry.links, entry.label + ": sampled links");
      assert.equal(result.requestCount, 3, entry.label + ": unexpected network requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness counts visible body copy without inert content or markup examples", async () => {
  const originalFetch = globalThis.fetch;
  const fakeWords = Array(350).fill("phantomexample").join(" ");
  const realWords = Array(105).fill("realcontent").join(" ");
  const richWords = Array(305).fill("realcontent").join(" ");
  const cases: Array<{ label: string; body: string; expectedPoints: number; expectedCount: number; head?: string; preceding?: string; noBody?: boolean }> = [
    { label: "HTML comment", body: `<!-- ${fakeWords} -->`, expectedPoints: 0, expectedCount: 0 },
    { label: "script block", body: `<script type="text/plain">${fakeWords}</script>`, expectedPoints: 0, expectedCount: 0 },
    { label: "style block", body: `<style>${fakeWords}</style>`, expectedPoints: 0, expectedCount: 0 },
    { label: "template block", body: `<template>${fakeWords}</template>`, expectedPoints: 0, expectedCount: 0 },
    { label: "noscript example", body: `<noscript>${fakeWords}</noscript>`, expectedPoints: 0, expectedCount: 0 },
    { label: "textarea example", body: `<textarea>${fakeWords}</textarea>`, expectedPoints: 0, expectedCount: 0 },
    { label: "head-only copy", head: `<script type="text/plain">${fakeWords}</script>`, body: "", expectedPoints: 0, expectedCount: 0 },
    { label: "text outside body", preceding: `<p>${fakeWords}</p>`, body: "", expectedPoints: 0, expectedCount: 0 },
    { label: "missing body", noBody: true, body: "", preceding: `<p>${fakeWords}</p>`, expectedPoints: 0, expectedCount: 0 },
    { label: "visible paragraph", body: `<main><p>${realWords}</p></main>`, expectedPoints: 4, expectedCount: 105 },
    { label: "visible substantial content", body: `<article><p>${richWords}</p></article>`, expectedPoints: 8, expectedCount: 305 },
    { label: "inert words cannot boost a short body", body: `<p>${realWords}</p><!-- ${fakeWords} --><template>${fakeWords}</template>`, expectedPoints: 4, expectedCount: 105 },
    { label: "mixed visible and scripted text", body: `<p>${realWords}</p><script>${fakeWords}</script><style>${fakeWords}</style>`, expectedPoints: 4, expectedCount: 105 },
  ];
  try {
    for (const entry of cases) {
      const html = `<!doctype html><html lang="en"><head><title>Fixture content depth</title>${entry.head ?? ""}</head>${entry.preceding ?? ""}${entry.noBody ? "" : `<body>${entry.body}</body>`}</html>`;
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
        if (path === "/sitemap.xml") return new Response("<urlset></urlset>", { headers: { "content-type": "application/xml" } });
        return new Response(html, { headers: { "content-type": "text/html" } });
      };
      const result = await runLiveReadinessScan("https://fixture.example/");
      const depth = result.findings.find((item) => item.code === "content_depth");
      assert.ok(depth, entry.label + ": missing content finding");
      assert.equal(depth.awardedPoints, entry.expectedPoints, entry.label + ": readiness points");
      assert.match(depth.evidence, new RegExp(`\\b${entry.expectedCount} visible words\\b`), entry.label + ": reported word count");
      assert.equal(result.pageText.includes("phantomexample"), false, entry.label + ": inert text leaked into sampled content");
      assert.equal(result.pageText.includes("realcontent"), entry.expectedCount > 0, entry.label + ": real content missing");
      assert.equal(result.requestCount, 3, entry.label + ": extra HTTP requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
