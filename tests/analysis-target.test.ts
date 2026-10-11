import assert from "node:assert/strict";
import test from "node:test";
import {
  contextForTarget,
  generateTargetPrompts,
  parseTargetDiscovery,
  parseTargetInput,
  safeSourceUrl,
  targetCacheKey,
  type AnalysisTarget,
  type TargetInput,
} from "../lib/analysis-target";
import {
  aggregateActualVisibility,
  analyzeVisibilityResponse,
  runActualVisibility,
  type VisibilityEngineRun,
} from "../lib/ai-visibility";
import type {
  EngineAdapter,
  EngineResponse,
} from "../lib/ai-engines/engine-adapter";

const input: TargetInput = {
  input: "عمر مثال",
  kind: "person",
  context: "",
  language: "ar",
  websiteUrl: null,
};
const target: AnalysisTarget = {
  kind: "person",
  input: input.input,
  name: input.input,
  category: "صناعة المحتوى",
  country: "Global",
  language: "ar",
  aliases: ["Omar Example"],
  websiteUrl: null,
  identityConfirmed: true,
};
function response(
  text: string,
  urls: string[] = ["https://profiles.example/omar"],
): EngineResponse {
  return {
    provider: "Test",
    model: "test",
    responseText: text,
    surfaceType: "api_with_search",
    sources: [],
    citations: urls.map((url) => ({
      url,
      title: null,
      startIndex: null,
      endIndex: null,
    })),
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      totalTokens: 2,
    },
    estimatedCostMicros: 100,
    durationMs: 1,
    retryCount: 0,
    providerRunId: "run-test",
    timestamp: new Date().toISOString(),
    error: null,
  };
}
function candidate(name = "عمر مثال") {
  return {
    kind: "person",
    name,
    description: "كاتب",
    category: "صناعة المحتوى",
    country: "Global",
    aliases: [],
    websiteUrl: null,
    sources: ["https://profiles.example/omar"],
  };
}

test("classifies URL inputs without forcing personal names or topics into domains", () => {
  assert.equal(
    parseTargetInput({ input: "example.com/CaseSensitive" }).websiteUrl,
    "https://example.com/CaseSensitive",
  );
  assert.equal(parseTargetInput({ url: "example.com" }).kind, "website");
  assert.equal(parseTargetInput({ input: "Dr. Ada Example" }).websiteUrl, null);
  assert.equal(parseTargetInput({ input: "صناعة المحتوى" }).kind, "auto");
  assert.equal(
    parseTargetInput({ input: "Apple", kind: "topic" }).kind,
    "topic",
  );
  assert.throws(() => parseTargetInput({ input: "https://127.0.0.1" }));
  assert.throws(() => parseTargetInput({ input: "x" }));
  assert.throws(() => parseTargetInput({ input: "Valid", kind: "unknown" }));
});

test("safe source URLs reject credentials and private hosts without rejecting fc-prefixed public names", () => {
  assert.equal(
    safeSourceUrl("https://fc-example.com"),
    "https://fc-example.com/",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://localhost/",
    "https://10.0.0.1/",
    "https://user:secret@example.com/",
    "https://[::1]/",
  ])
    assert.equal(safeSourceUrl(url), null);
});

test("resolution requires citations returned by the API, not invented links in model JSON", () => {
  const good = parseTargetDiscovery(
    response(JSON.stringify({ status: "resolved", candidates: [candidate()] })),
    input,
  );
  assert.equal(good.status, "resolved");
  assert.equal(good.candidates[0].name, target.name);
  assert.equal(
    parseTargetDiscovery(
      response(
        JSON.stringify({ status: "resolved", candidates: [candidate()] }),
        [],
      ),
      input,
    ).status,
    "unresolved",
  );
  const noSearch = {
    ...response(
      JSON.stringify({ status: "resolved", candidates: [candidate()] }),
    ),
    surfaceType: "api_without_search" as const,
  };
  assert.equal(parseTargetDiscovery(noSearch, input).status, "unresolved");
  assert.equal(
    parseTargetDiscovery(response("not valid JSON"), input).status,
    "unresolved",
  );
});

test("namesakes require confirmation, including explicit ambiguity after one source is rejected", () => {
  const two = parseTargetDiscovery(
    response(
      JSON.stringify({
        status: "resolved",
        candidates: [candidate(), candidate("عمر مثال الثاني")],
      }),
    ),
    input,
  );
  assert.equal(two.status, "ambiguous");
  assert.notEqual(two.candidates[0].id, two.candidates[1].id);
  const one = parseTargetDiscovery(
    response(
      JSON.stringify({ status: "ambiguous", candidates: [candidate()] }),
    ),
    input,
  );
  assert.equal(one.status, "ambiguous");
});

test("explicit people and brands cannot be silently reinterpreted as topics", () => {
  const result = response(JSON.stringify({ status: "topic", candidates: [] }));
  assert.equal(parseTargetDiscovery(result, input).status, "unresolved");
  assert.equal(
    parseTargetDiscovery(result, { ...input, kind: "auto" }).status,
    "topic",
  );
});

test("named identity questions are separated from unbranded questions and aliases do not leak", () => {
  const prompts = generateTargetPrompts(target);
  assert.equal(prompts.length, 3);
  assert.equal(prompts[0].intent, "identity");
  assert.ok(prompts[0].question.includes(target.name));
  for (const prompt of prompts.slice(1)) {
    assert.ok(!prompt.question.includes(target.name));
    assert.ok(!prompt.question.includes("Omar Example"));
    assert.ok(prompt.question.includes("صناعة المحتوى"));
  }
  assert.equal(
    generateTargetPrompts({ ...target, category: "صناعة المحتوى عند عمر مثال" })
      .length,
    1,
  );
  assert.equal(generateTargetPrompts({ ...target, category: "" }).length, 1);
});

test("missing website does not break alias detection and negative recommendations are not promoted", () => {
  const result = analyzeVisibilityResponse({
    brand: target.name,
    aliases: target.aliases,
    sourceUrl: "",
    knownCompetitors: [],
    citations: [],
    responseText: "Omar Example is not recommended for this task.",
  });
  assert.equal(result.brandVisible, true);
  assert.notEqual(result.recommendationStatus, "recommended");
});

test("identity mentions and runs without evidenced search never inflate the visibility percentage", () => {
  const run = (
    intent: VisibilityEngineRun["intent"],
    mentioned: boolean,
    surfaceType: VisibilityEngineRun["surfaceType"] = "api_with_search",
  ) =>
    ({
      intent,
      responseText: "Sample",
      error: null,
      surfaceType,
      analysis: { brandVisible: mentioned },
    }) as VisibilityEngineRun;
  const result = aggregateActualVisibility(
    [
      run("identity", true),
      run("recommendation", false),
      run("discovery", true, "api_without_search"),
    ],
    3,
  );
  assert.equal(result.score, 0);
  assert.equal(result.status, "partial");
  assert.equal(
    aggregateActualVisibility([run("identity", true)], 1).score,
    null,
  );
});

test("topic analysis preserves names and sources while having no brand or readiness score", async () => {
  const topic = { ...target, kind: "topic" as const, name: "Content strategy" };
  const adapter: EngineAdapter = {
    provider: "Test",
    model: "test",
    run: async () =>
      response(
        "1. Sample Institute — research on content.\n2. Example Author — a practitioner.",
      ),
  };
  const result = await runActualVisibility({
    adapter,
    context: contextForTarget(topic),
    prompts: generateTargetPrompts(topic),
    useDomainAlias: false,
  });
  assert.equal(result.score, null);
  assert.equal(result.status, "measured");
  assert.equal(result.engineRuns.length, 2);
  assert.ok(
    result.engineRuns[0].analysis.competitorsMentioned.includes(
      "Sample Institute",
    ),
  );
  assert.equal(
    result.engineRuns[0].analysis.recommendationStatus,
    "unavailable",
  );
});

test("cache separates kinds, clarification, language, model and URL path case", async () => {
  const base = await targetCacheKey(input, "model-a", true);
  const variants = [
    { ...input, kind: "topic" as const },
    { ...input, context: "different person" },
    { ...input, language: "en" as const },
  ];
  for (const variant of variants)
    assert.notEqual(await targetCacheKey(variant, "model-a", true), base);
  assert.notEqual(await targetCacheKey(input, "model-b", true), base);
  assert.notEqual(
    await targetCacheKey(
      parseTargetInput({ input: "example.com/Path" }),
      "a",
      true,
    ),
    await targetCacheKey(
      parseTargetInput({ input: "example.com/path" }),
      "a",
      true,
    ),
  );
});
