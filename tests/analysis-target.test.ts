import assert from "node:assert/strict";
import { runLiveReadinessScan } from "../lib/live-readiness";
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

test("crawl input rejects IANA special-use IPv4 addresses before any network access", async () => {
  const rejected = [
    "https://192.0.0.8/",        // IETF protocol assignments
    "https://192.0.2.1/",        // TEST-NET-1
    "https://192.88.99.2/",      // deprecated anycast
    "https://198.18.0.1/",       // benchmarking
    "http://198.19.255.254/",   // second benchmarking /16
    "https://198.51.100.42/",   // TEST-NET-2
    "https://203.0.113.5/",     // TEST-NET-3
    "https://0xc0000201/",      // non-decimal spelling of 192.0.2.1
  ];
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests++;
    throw new Error("A rejected URL must never reach fetch");
  };
  try {
    for (const address of rejected) {
      assert.equal(safeSourceUrl(address), null, address);
      assert.throws(() => parseTargetInput({ input: address }), /not a public website/, address);
      await assert.rejects(runLiveReadinessScan(address), /not a public website/, address);
    }
    assert.equal(networkRequests, 0, "all rejected addresses must fail before any request");
    // Do not accidentally block ordinary public IPv4 hosts or DNS names.
    assert.equal(safeSourceUrl("https://93.184.216.34/"), "https://93.184.216.34/");
    assert.equal(safeSourceUrl("https://public.example/"), "https://public.example/");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness rejects HTTP error and partial homepages before auxiliary crawling", async () => {
  const homepage = '<!doctype html><html lang="en"><head><title>Example</title></head><body><h1>Example</h1></body></html>';
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  try {
    for (const status of [206, 403, 404, 410, 429, 500, 503]) {
      requests.length = 0;
      globalThis.fetch = async (input) => {
        requests.push(String(input));
        return new Response(homepage, {
          status,
          headers: { "Content-Type": "text/html" },
        });
      };
      await assert.rejects(
        runLiveReadinessScan("https://status.example/"),
        new RegExp(`HTTP ${status}`),
        `a ${status} HTML response must never produce a readiness score`,
      );
      assert.deepEqual(requests, ["https://status.example/"], `status ${status} must not trigger auxiliary requests`);
    }

    requests.length = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "Content-Type": "text/plain" } });
      if (url.endsWith("/sitemap.xml")) return new Response("<urlset></urlset>", { headers: { "Content-Type": "application/xml" } });
      return new Response(homepage, { status: 200, headers: { "Content-Type": "text/html" } });
    };
    const result = await runLiveReadinessScan("https://status.example/");
    assert.equal(result.httpStatus, 200);
    assert.equal(requests.length, 3, "a valid homepage still performs the normal bounded crawl");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness rejects non-200 success statuses before auxiliary requests", async () => {
  const homepage = '<!doctype html><html lang="en"><head><title>Valid-looking placeholder</title></head><body><h1>Placeholder</h1></body></html>';
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  try {
    for (const status of [201, 202, 203, 204, 205, 207, 208, 226]) {
      requests.length = 0;
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        // The Fetch API forbids response bodies for 204 and 205.
        return new Response(status === 204 || status === 205 ? null : homepage, {
          status,
          headers: { "Content-Type": "text/html" },
        });
      };
      await assert.rejects(
        runLiveReadinessScan("https://pending.example/"),
        new RegExp(`HTTP ${status}; a complete HTTP 200 page is required`),
        `status ${status} must not produce a readiness score`,
      );
      assert.deepEqual(
        requests,
        ["https://pending.example/"],
        `status ${status} must not crawl robots.txt or sitemap.xml`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
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
  for (const category of [
    `${target.category} ${target.name} Omar Example`,
    "",
  ]) {
    const protectedPrompts = generateTargetPrompts({ ...target, category });
    assert.equal(protectedPrompts.length, category ? 3 : 1);
    assert.equal(
      protectedPrompts.filter((prompt) => prompt.intent !== "identity").length,
      category ? 2 : 0,
    );
    for (const prompt of protectedPrompts.slice(1)) {
      assert.ok(!prompt.question.includes(target.name));
      assert.ok(!prompt.question.includes("Omar Example"));
    }
  }
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

test("unknown personal-brand specialty cannot generate generic unbranded visibility measurements", () => {
  const prompts = generateTargetPrompts({ kind: "person", input: "Ada Example", name: "Ada Example", aliases: [], category: "", language: "en", country: "Global", websiteUrl: null, identityConfirmed: true }, 12);
  assert.deepEqual(prompts.map((prompt) => prompt.intent), ["identity"]);
});


test("oversized unannounced crawler response is cancelled before the whole body is buffered", async () => {
  const originalFetch = globalThis.fetch;
  let chunksProduced = 0;
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksProduced++;
      controller.enqueue(new Uint8Array(256_000));
      if (chunksProduced === 20) controller.close();
    },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "text/html" } });
  try {
    await assert.rejects(
      runLiveReadinessScan("https://large.example/"),
      /larger than the scan safety limit/,
    );
    assert.equal(cancelled, true, "stream must be cancelled when the cap is reached");
    assert.ok(chunksProduced < 20, "the crawler must not download the entire response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bounded crawler preserves UTF-8 across response stream chunks and counts bytes", async () => {
  const originalFetch = globalThis.fetch;
  const html = '<!doctype html><html lang="ar"><head><title>اختبار تقني</title></head><body><h1>مرحبًا بالعالم</h1></body></html>';
  const robots = "User-agent: *\nAllow: /";
  const sitemap = "<urlset></urlset>";
  const encoded = new TextEncoder().encode(html);
  const firstArabicByte = encoded.findIndex((byte) => byte > 127);
  assert.ok(firstArabicByte >= 0);
  const usage = { bytesFetched: 0, requestCount: 0 };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response(robots, { headers: { "Content-Type": "text/plain" } });
    if (url.endsWith("/sitemap.xml")) return new Response(sitemap, { headers: { "Content-Type": "application/xml" } });
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, firstArabicByte + 1));
        controller.enqueue(encoded.slice(firstArabicByte + 1));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/html" } });
  };
  try {
    const result = await runLiveReadinessScan("https://arabic.example/", undefined, usage);
    assert.match(result.pageText, /مرحبًا بالعالم/);
    assert.equal(usage.requestCount, 3);
    assert.equal(usage.bytesFetched,
      encoded.byteLength + new TextEncoder().encode(robots).byteLength + new TextEncoder().encode(sitemap).byteLength);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("redirect crawl cancels unused response streams before following a safe location", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  let redirectCancelled = false;
  let redirectChunks = 0;
  const usage = { requestCount: 0, bytesFetched: 0 };
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === "https://redirected.example/") {
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          redirectChunks++;
          controller.enqueue(new Uint8Array(64_000));
        },
        cancel() { redirectCancelled = true; },
      }), { status: 302, headers: { Location: "/landing" } });
    }
    if (url.endsWith("/landing")) {
      return new Response('<!doctype html><html lang="en"><head><title>Redirect target</title></head><body><h1>Landing</h1></body></html>',
        { headers: { "Content-Type": "text/html" } });
    }
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\\nAllow: /");
    if (url.endsWith("/sitemap.xml")) return new Response("<urlset></urlset>");
    throw new Error("Unexpected crawler destination: " + url);
  };
  try {
    const result = await runLiveReadinessScan("https://redirected.example/", undefined, usage);
    assert.equal(result.finalUrl, "https://redirected.example/landing");
    assert.equal(redirectCancelled, true, "discard the redirect body instead of leaving it downloading");
    assert.ok(redirectChunks <= 2, "must not consume a large redirect body");
    assert.deepEqual(urls, [
      "https://redirected.example/",
      "https://redirected.example/landing",
      "https://redirected.example/robots.txt",
      "https://redirected.example/sitemap.xml",
    ]);
    assert.equal(usage.requestCount, 4);
    assert.ok(usage.bytesFetched < 64_000, "discarded redirect bytes are not page evidence");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed redirect without Location also releases its unused body", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(32_000)); },
      cancel() { cancelled = true; },
    }), { status: 301 });
  };
  try {
    await assert.rejects(runLiveReadinessScan("https://redirected.example/"), /incomplete redirect/);
    assert.equal(cancelled, true, "failed redirects must not leave downloads running");
    assert.equal(calls, 1, "missing redirect targets must never be fetched");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("declared oversized homepage responses cancel their body before a download starts", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  let produced = 0;
  const usage = { requestCount: 0, bytesFetched: 0 };
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      produced++;
      controller.enqueue(new Uint8Array(64_000));
    },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "text/html", "Content-Length": "1500001" } });
  try {
    await assert.rejects(
      runLiveReadinessScan("https://oversized.example/", undefined, usage),
      /larger than the scan safety limit/,
    );
    assert.equal(cancelled, true, "discarded response must release its stream");
    assert.ok(produced <= 2, "rejected payload must never be downloaded");
    assert.deepEqual(usage, { requestCount: 1, bytesFetched: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("declared oversized robots responses are cancelled without losing homepage evidence", async () => {
  const originalFetch = globalThis.fetch;
  const html = '<!doctype html><html lang="ar"><head><title>صفحة عربية</title></head><body><h1>مرحبًا</h1></body></html>';
  const sitemap = "<urlset></urlset>";
  let cancelled = false;
  const usage = { requestCount: 0, bytesFetched: 0 };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(8)); },
        cancel() { cancelled = true; },
      }), { headers: { "Content-Length": "350001" } });
    }
    if (url.endsWith("/sitemap.xml")) return new Response(sitemap);
    if (url === "https://oversized-robots.example/") return new Response(html, { headers: { "Content-Type": "text/html" } });
    throw new Error("Unexpected destination: " + url);
  };
  try {
    const result = await runLiveReadinessScan("https://oversized-robots.example/", undefined, usage);
    assert.equal(cancelled, true, "rejected robots payload must stop downloading");
    assert.equal(result.findings.find((item) => item.code === "robots_policy")?.status, "fail");
    assert.match(result.pageText, /مرحبًا/);
    assert.deepEqual(usage, {
      requestCount: 3,
      bytesFetched: new TextEncoder().encode(html + sitemap).byteLength,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("robots readiness scopes root Disallow to wildcard groups rather than unrelated bots", async () => {
  const originalFetch = globalThis.fetch;
  const html = '<!doctype html><html lang="en"><head><title>Fixture for robots policies</title></head><body><h1>Home</h1></body></html>';
  const cases: Array<[string, boolean]> = [
    ["User-agent: *\nAllow: /\n\nUser-agent: BadBot\nDisallow: /", true],
    ["User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /", true],
    ["User-agent: *\nDisallow: /private\n\nUser-agent: BadBot\nDisallow: /", true],
    ["User-agent: *\nDisallow: / # site-wide block\n\nUser-agent: BadBot\nAllow: /", false],
    ["User-agent: ExampleBot\nUser-agent: *\nDisallow: /", false],
    ["User-agent: *\nDisallow: /\nAllow: /", true],
    ["User-agent: *\nAllow: /\nUser-agent: BadBot\nDisallow: / # only the named bot", true],
  ];
  try {
    for (const [robots, allowed] of cases) {
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/robots.txt") return new Response(robots, { headers: { "content-type": "text/plain" } });
        if (path === "/sitemap.xml") return new Response("<urlset></urlset>", { headers: { "content-type": "application/xml" } });
        return new Response(html, { headers: { "content-type": "text/html" } });
      };
      const result = await runLiveReadinessScan("https://robots-fixture.example/");
      const finding = result.findings.find((item) => item.code === "robots_policy");
      assert.ok(finding);
      assert.equal(finding.status, allowed ? "pass" : "fail", robots);
      assert.equal(finding.awardedPoints, allowed ? 7 : 0, robots);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness awards schema scores only for parseable JSON-LD with declared types", async () => {
  const originalFetch = globalThis.fetch;
  const script = (data: string) => '<script type="application/ld+json">' + data + "</script>";
  const cases: Array<{
    name: string;
    markup: string;
    validBlocks: number;
    organization: boolean;
    faq: boolean;
  }> = [
    { name: "malformed object", markup: script('{"@type":"Organization",}'), validBlocks: 0, organization: false, faq: false },
    { name: "schema graph and type array", markup: script('{"@context":"https://schema.org","@graph":[{"@type":["Thing","Organization"]},{"@type":"FAQPage"}]}'), validBlocks: 1, organization: true, faq: true },
    { name: "only the valid block counts", markup: script('{"@type":"FAQPage",}') + script('[{"@type":"https://schema.org/Organization"},{"@type":"Product"}]'), validBlocks: 1, organization: true, faq: false },
    { name: "scalar is not structured data", markup: script('"Organization"'), validBlocks: 0, organization: false, faq: false },
    { name: "generic JSON lacks schema fields", markup: script('{"name":"No schema keywords"}'), validBlocks: 0, organization: false, faq: false },
    { name: "unrelated JSON script is not JSON-LD", markup: '<script type="application/json">{"@type":"Organization"}</script>', validBlocks: 0, organization: false, faq: false },
    { name: "type must match exactly", markup: script('{"@type":"OtherOrganization"}'), validBlocks: 1, organization: false, faq: false },
  ];
  try {
    for (const entry of cases) {
      const html = '<!doctype html><html lang="en"><head><title>Structured data fixture</title>' +
        entry.markup + '</head><body><h1>Welcome</h1></body></html>';
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /");
        if (path === "/sitemap.xml") return new Response("<urlset></urlset>");
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      };
      const result = await runLiveReadinessScan("https://schema-fixture.example/");
      const findings = new Map(result.findings.map((finding) => [finding.code, finding]));
      assert.equal(findings.get("structured_data")?.status, entry.validBlocks ? "pass" : "fail", entry.name);
      assert.equal(findings.get("structured_data")?.awardedPoints, entry.validBlocks ? 8 : 0, entry.name);
      assert.match(findings.get("structured_data")?.evidence || "", new RegExp("^" + entry.validBlocks + " parseable"), entry.name);
      assert.equal(findings.get("organization_entity")?.status, entry.organization ? "pass" : "fail", entry.name);
      assert.equal(findings.get("answer_structure")?.status, entry.faq ? "pass" : "fail", entry.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("robots readiness rejects named search and scan crawler blocks without misreading unrelated bots", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://named-robots.example";
  const html = '<!doctype html><html lang="en"><head><title>Named robots fixture</title></head><body><h1>Home</h1></body></html>';
  const cases: Array<{ label: string; path: string; policy: string; blocked: boolean }> = [
    { label: "Googlebot blocked despite wildcard allow", path: "/", policy: "User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /", blocked: true },
    { label: "Bingbot blocked despite wildcard allow", path: "/", policy: "User-agent: Bingbot\nDisallow: /\n\nUser-agent: *\nAllow: /", blocked: true },
    { label: "RecomviaBot blocked despite wildcard allow", path: "/", policy: "User-agent: *\nAllow: /\n\nUser-agent: RECOMVIABOT\nDisallow: /", blocked: true },
    { label: "named path block applies to scanned path", path: "/private/report", policy: "User-agent: Googlebot\nDisallow: /private\n\nUser-agent: *\nAllow: /", blocked: true },
    { label: "named path exception overrides a broader block", path: "/private/open", policy: "User-agent: Googlebot\nDisallow: /private\nAllow: /private/open\n\nUser-agent: *\nAllow: /", blocked: false },
    { label: "named bot allow does not override wildcard denial of others", path: "/", policy: "User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /", blocked: true },
    { label: "unrelated bot denied while major crawlers are permitted", path: "/", policy: "User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /", blocked: false },
    { label: "Googlebot-Image policy does not apply to Googlebot", path: "/", policy: "User-agent: Googlebot-Image\nDisallow: /\n\nUser-agent: *\nAllow: /", blocked: false },
    { label: "named agent with no rules does not inherit wildcard denial", path: "/", policy: "User-agent: Googlebot\nAllow: /\n\nUser-agent: Bingbot\nAllow: /\n\nUser-agent: RecomviaBot\nAllow: /\n\nUser-agent: *\nDisallow: /", blocked: false },
  ];
  try {
    for (const entry of cases) {
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        const pathname = new URL(String(input)).pathname;
        requested.push(pathname);
        if (pathname === "/robots.txt") return new Response(entry.policy, { headers: { "Content-Type": "text/plain" } });
        if (pathname === "/sitemap.xml") return new Response("<urlset></urlset>", { headers: { "Content-Type": "application/xml" } });
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      };
      const result = await runLiveReadinessScan(origin + entry.path);
      const finding = result.findings.find((row) => row.code === "robots_policy");
      assert.ok(finding, entry.label);
      assert.equal(finding.awardedPoints, entry.blocked ? 0 : 7, entry.label);
      assert.equal(finding.status, entry.blocked ? "fail" : "pass", entry.label);
      assert.deepEqual(requested, [entry.path, "/robots.txt", "/sitemap.xml"], entry.label);
      assert.equal(result.requestCount, 3, entry.label + ": no additional HTTP requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auxiliary discovery never fetches cross-origin robots or sitemap URLs", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://auxiliary-fixture.example";
  const homepage = '<!doctype html><html lang="en"><head><title>Bounded auxiliary crawl</title></head><body><h1>Home</h1></body></html>';
  const cases: Array<{
    name: string;
    robots: string;
    sitemapPath: string;
    robotsRedirect?: boolean;
    sitemapRedirect?: boolean;
    robotsPass: boolean;
    sitemapPass: boolean;
  }> = [
    {
      name: "absolute off-origin sitemap hint falls back to default",
      robots: "User-agent: *\nAllow: /\nSitemap: https://unrelated.example/sitemap.xml",
      sitemapPath: "/sitemap.xml", robotsPass: true, sitemapPass: true,
    },
    {
      name: "protocol-relative off-origin sitemap hint is also ignored",
      robots: "User-agent: *\nAllow: /\nSitemap: //unrelated.example/sitemap.xml",
      sitemapPath: "/sitemap.xml", robotsPass: true, sitemapPass: true,
    },
    {
      name: "relative same-origin sitemap hint is honored",
      robots: "User-agent: *\nAllow: /\nSitemap: /maps/index.xml",
      sitemapPath: "/maps/index.xml", robotsPass: true, sitemapPass: true,
    },
    {
      name: "same-origin sitemap redirect cannot escape to an unrelated host",
      robots: "User-agent: *\nAllow: /\nSitemap: /redirect.xml",
      sitemapPath: "/redirect.xml", sitemapRedirect: true, robotsPass: true, sitemapPass: false,
    },
    {
      name: "robots redirect cannot escape to an unrelated host",
      robots: "",
      sitemapPath: "/sitemap.xml", robotsRedirect: true, robotsPass: false, sitemapPass: true,
    },
  ];
  try {
    for (const entry of cases) {
      const fetched: string[] = [];
      globalThis.fetch = async (input) => {
        const target = new URL(String(input));
        fetched.push(target.toString());
        assert.equal(target.origin, origin, entry.name + ": unexpected external fetch");
        if (target.pathname === "/") {
          return new Response(homepage, { headers: { "Content-Type": "text/html" } });
        }
        if (target.pathname === "/robots.txt") {
          if (entry.robotsRedirect) {
            return new Response(null, { status: 302, headers: { Location: "https://unrelated.example/robots.txt" } });
          }
          return new Response(entry.robots, { headers: { "Content-Type": "text/plain" } });
        }
        assert.equal(target.pathname, entry.sitemapPath, entry.name);
        if (entry.sitemapRedirect) {
          return new Response(null, { status: 302, headers: { Location: "https://unrelated.example/sitemap.xml" } });
        }
        return new Response("<urlset></urlset>", { headers: { "Content-Type": "application/xml" } });
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan(origin + "/", undefined, usage);
      assert.deepEqual(fetched, [origin + "/", origin + "/robots.txt", origin + entry.sitemapPath], entry.name);
      assert.equal(usage.requestCount, 3, entry.name + ": only the target host should be contacted");
      assert.equal(result.findings.find((finding) => finding.code === "robots_policy")?.status,
        entry.robotsPass ? "pass" : "fail", entry.name);
      assert.equal(result.findings.find((finding) => finding.code === "xml_sitemap")?.status,
        entry.sitemapPass ? "pass" : "fail", entry.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("sitemap readiness rejects embedded tags, truncated XML and error pages", async () => {
  const originalFetch = globalThis.fetch;
  const homepage = '<!doctype html><html lang="en"><head><title>Sitemap fixture site</title></head><body><h1>Welcome</h1></body></html>';
  const cases: Array<{ label: string; xml: string; pass: boolean; status?: number }> = [
    { label: "basic urlset", xml: "<urlset></urlset>", pass: true },
    { label: "XML declaration and namespace", xml: '<?xml version="1.0" encoding="UTF-8"?>\n<!-- mapped -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url></url></urlset>', pass: true },
    { label: "sitemap index", xml: '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap></sitemap></sitemapindex>', pass: true },
    { label: "self-closing empty sitemap", xml: "<urlset/>", pass: true },
    { label: "XML stylesheet", xml: '<?xml version="1.0"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset></urlset>', pass: true },
    { label: "HTML error embeds urlset", xml: "<html><body><urlset></urlset></body></html>", pass: false },
    { label: "root only in comment", xml: "<!-- <urlset></urlset> -->", pass: false },
    { label: "text before root", xml: "Bad XML <urlset></urlset>", pass: false },
    { label: "truncated response", xml: "<urlset><url></url>", pass: false },
    { label: "wrong closing root", xml: "<urlset></sitemapindex>", pass: false },
    { label: "trailing HTML", xml: "<urlset></urlset><html></html>", pass: false },
    { label: "similarly named tag", xml: "<urlsetfake></urlsetfake>", pass: false },
    { label: "non-successful sitemap HTTP", xml: "<urlset></urlset>", status: 404, pass: false },
  ];
  try {
    for (const entry of cases) {
      const requests: string[] = [];
      globalThis.fetch = async (input) => {
        const pathname = new URL(String(input)).pathname;
        requests.push(pathname);
        if (pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
        if (pathname === "/sitemap.xml") return new Response(entry.xml, {
          status: entry.status ?? 200,
          headers: { "Content-Type": "application/xml" },
        });
        assert.equal(pathname, "/", entry.label);
        return new Response(homepage, { headers: { "Content-Type": "text/html" } });
      };
      const result = await runLiveReadinessScan("https://sitemap-fixture.example/");
      const finding = result.findings.find((item) => item.code === "xml_sitemap");
      assert.ok(finding, entry.label);
      assert.equal(finding.status, entry.pass ? "pass" : "fail", entry.label);
      assert.equal(finding.awardedPoints, entry.pass ? 7 : 0, entry.label);
      assert.deepEqual(requests, ["/", "/robots.txt", "/sitemap.xml"], entry.label);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("robots readiness rejects HTML fallbacks and ignores hints from failed policies", async () => {
  const originalFetch = globalThis.fetch;
  const homepage = '<!doctype html><html lang="en"><head><title>Robots fallback fixture</title></head><body><h1>Home</h1></body></html>';
  const cases: Array<{
    label: string;
    robots: string;
    robotsPass: boolean;
    sitemapPath: string;
    status?: number;
    contentType?: string;
  }> = [
    {
      label: "plain robots with same-origin sitemap",
      robots: "User-agent: *\nAllow: /\nSitemap: /custom.xml",
      robotsPass: true, sitemapPath: "/custom.xml",
    },
    {
      label: "valid empty robots resource",
      robots: "",
      robotsPass: true, sitemapPath: "/sitemap.xml",
    },
    {
      label: "SPA HTML fallback with spoofed sitemap hint",
      robots: "<!doctype html>\n<html><body>not robots\nSitemap: /spoof.xml\n</body></html>",
      robotsPass: false, sitemapPath: "/sitemap.xml",
      contentType: "text/html",
    },
    {
      label: "HTML response mislabeled as plain text",
      robots: "  <html><body>\nSitemap: /spoof.xml\n</body></html>",
      robotsPass: false, sitemapPath: "/sitemap.xml",
      contentType: "text/plain",
    },
    {
      label: "HTML fallback with a UTF-8 BOM",
      robots: "\uFEFF\n<body>Missing robots.txt</body>",
      robotsPass: false, sitemapPath: "/sitemap.xml",
    },
    {
      label: "404 robots body with a misleading directive",
      robots: "User-agent: *\nAllow: /\nSitemap: /spoof.xml",
      robotsPass: false, sitemapPath: "/sitemap.xml", status: 404,
    },
    {
      label: "a real plain-text robots body remains valid despite HTML MIME",
      robots: "User-agent: *\nAllow: /\nSitemap: /custom.xml",
      robotsPass: true, sitemapPath: "/custom.xml", contentType: "text/html",
    },
    {
      label: "wildcard disallow remains blocked",
      robots: "User-agent: *\nDisallow: /\nSitemap: /custom.xml",
      robotsPass: false, sitemapPath: "/custom.xml",
    },
  ];
  try {
    for (const entry of cases) {
      const requests: string[] = [];
      globalThis.fetch = async (input) => {
        const pathname = new URL(String(input)).pathname;
        requests.push(pathname);
        if (pathname === "/robots.txt") {
          return new Response(entry.robots, {
            status: entry.status ?? 200,
            headers: { "Content-Type": entry.contentType ?? "text/plain" },
          });
        }
        if (pathname === entry.sitemapPath) {
          return new Response("<urlset></urlset>", { headers: { "Content-Type": "application/xml" } });
        }
        assert.equal(pathname, "/", entry.label);
        return new Response(homepage, { headers: { "Content-Type": "text/html" } });
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan("https://robots-fallback.example/", undefined, usage);
      const finding = result.findings.find((item) => item.code === "robots_policy");
      assert.ok(finding, entry.label);
      assert.equal(finding.status, entry.robotsPass ? "pass" : "fail", entry.label);
      assert.equal(finding.awardedPoints, entry.robotsPass ? 7 : 0, entry.label);
      assert.deepEqual(requests, ["/", "/robots.txt", entry.sitemapPath], entry.label);
      assert.equal(usage.requestCount, 3, entry.label + ": no extra network calls");
      assert.equal(result.findings.find((item) => item.code === "xml_sitemap")?.status, "pass", entry.label);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("homepage meta robots noindex prevents a false indexing readiness pass", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://indexing-fixture.example";
  const cases: Array<{ label: string; head: string; blocked: boolean; body?: string }> = [
    { label: "plain noindex", head: '<meta name="robots" content="noindex">', blocked: true },
    { label: "none is equivalent to noindex", head: '<meta name="robots" content="none">', blocked: true },
    { label: "mixed case and comma-separated directives", head: '<meta NAME="ROBOTS" CONTENT="follow, NoIndex">', blocked: true },
    { label: "attributes in reverse order", head: '<meta content="NOINDEX" name="robots">', blocked: true },
    { label: "later robots tag overrides initial index", head: '<meta name="robots" content="index"><meta name="robots" content="noindex">', blocked: true },
    { label: "follow and index remain indexable", head: '<meta name="robots" content="index,follow">', blocked: false },
    { label: "nofollow does not imply noindex", head: '<meta name="robots" content="nofollow">', blocked: false },
    { label: "Googlebot noindex blocks a major crawler", head: '<meta name="googlebot" content="noindex">', blocked: true },
    { label: "Bingbot none blocks a major crawler", head: '<meta name="BingBot" content="follow, NONE">', blocked: true },
    { label: "RecomviaBot noindex blocks scan crawler", head: '<meta name="recomviabot" content="NOINDEX">', blocked: true },
    { label: "unrelated crawler directive does not block major crawlers", head: '<meta name="otherbot" content="noindex">', blocked: false },
    { label: "Googlebot nofollow alone does not block indexing", head: '<meta name="googlebot" content="nofollow">', blocked: false },
    { label: "lookalike directive is not noindex", head: '<meta name="robots" content="noindexing">', blocked: false },
    { label: "comment is not an active robots directive", head: '<!-- <meta name="robots" content="noindex"> -->', blocked: false },
    { label: "body-only robots tag is not valid head metadata", head: "", body: '<meta name="robots" content="noindex">', blocked: false },
    { label: "script example is not an active robots directive", head: '<script>const example = \'<meta name="robots" content="noindex">\';</script>', blocked: false },
  ];
  try {
    for (const entry of cases) {
      const html = '<!doctype html><html lang="en"><head><title>Indexing fixture</title>' +
        entry.head + '</head><body><h1>Welcome</h1>' + (entry.body || "") + '</body></html>';
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        const url = String(input);
        requested.push(url);
        const pathname = new URL(url).pathname;
        if (pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
        if (pathname === "/sitemap.xml") return new Response("<urlset></urlset>");
        assert.equal(pathname, "/", entry.label);
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan(origin + "/", undefined, usage);
      const finding = result.findings.find((item) => item.code === "robots_policy");
      assert.ok(finding, entry.label);
      assert.equal(finding.status, entry.blocked ? "fail" : "pass", entry.label);
      assert.equal(finding.awardedPoints, entry.blocked ? 0 : 7, entry.label);
      assert.equal(finding.sourceUrl, entry.blocked ? origin + "/" : origin + "/robots.txt", entry.label);
      if (entry.blocked) assert.match(finding.evidence, /meta robots requests noindex\/none/, entry.label);
      assert.deepEqual(requested, [origin + "/", origin + "/robots.txt", origin + "/sitemap.xml"], entry.label);
      assert.equal(usage.requestCount, 3, entry.label + ": no additional network work");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("homepage X-Robots-Tag blocks a false indexing readiness pass without extra requests", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://header-indexing.example";
  const html = '<!doctype html><html lang="en"><head><title>Header indexation fixture</title></head><body><h1>Home</h1></body></html>';
  const cases: Array<{ label: string; header: string; blocked: boolean }> = [
    { label: "global noindex", header: "noindex", blocked: true },
    { label: "global none", header: "none", blocked: true },
    { label: "mixed case and multiple directives", header: "nofollow, NoIndex", blocked: true },
    { label: "global directive before named crawler", header: "noindex, googlebot: index", blocked: true },
    { label: "named Googlebot noindex only", header: "googlebot: noindex", blocked: true },
    { label: "Googlebot scope continues through comma directives", header: "googlebot: nofollow, noindex", blocked: true },
    { label: "named bot has more than one directive", header: "googlebot: noindex, nofollow", blocked: true },
    { label: "multiple named bots block indexing", header: "googlebot: noindex, bingbot: none", blocked: true },
    { label: "Bingbot none without global noindex", header: "BiNgBoT: none", blocked: true },
    { label: "RecomviaBot noindex without global noindex", header: "recomviabot: noindex", blocked: true },
    { label: "other crawler noindex is not a blocker", header: "otherbot: noindex", blocked: false },
    { label: "other crawler scope does not leak", header: "otherbot: noindex, nofollow, googlebot: index", blocked: false },
    { label: "named bot has lookalike directive", header: "googlebot: noindexing", blocked: false },
    { label: "ordinary index and follow", header: "index, follow", blocked: false },
    { label: "noindex substring is not a directive", header: "noindexing", blocked: false },
    { label: "none substring is not a directive", header: "nonetheless", blocked: false },
    { label: "non-indexing directive", header: "noarchive", blocked: false },
    { label: "empty header", header: "", blocked: false },
  ];
  try {
    for (const entry of cases) {
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        const url = String(input);
        requested.push(url);
        const path = new URL(url).pathname;
        if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /");
        if (path === "/sitemap.xml") return new Response("<urlset></urlset>");
        assert.equal(path, "/", entry.label);
        return new Response(html, {
          headers: { "Content-Type": "text/html", "X-Robots-Tag": entry.header },
        });
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan(origin + "/", undefined, usage);
      const finding = result.findings.find((item) => item.code === "robots_policy");
      assert.ok(finding, entry.label);
      assert.equal(finding.status, entry.blocked ? "fail" : "pass", entry.label);
      assert.equal(finding.awardedPoints, entry.blocked ? 0 : 7, entry.label);
      assert.equal(finding.sourceUrl, entry.blocked ? origin + "/" : origin + "/robots.txt", entry.label);
      if (entry.blocked) assert.ok(finding.evidence.includes("X-Robots-Tag requests noindex/none"), entry.label);
      assert.deepEqual(requested, [origin + "/", origin + "/robots.txt", origin + "/sitemap.xml"], entry.label);
      assert.equal(usage.requestCount, 3, entry.label + ": no extra network requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("canonical readiness counts only active head links, not HTML examples or body tags", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://canonical-fixture.example";
  const valid = '<link rel="canonical" href="/actual">';
  const cases: Array<{ label: string; head: string; body?: string; expected?: string; prefix?: string }> = [
    { label: "head relative canonical", head: valid, expected: origin + "/actual" },
    { label: "absolute canonical", head: '<link href="https://canonical-fixture.example/absolute" rel="alternate canonical">', expected: origin + "/absolute" },
    { label: "same-origin query canonical", head: '<link rel="canonical" href="/article?lang=ar">', expected: origin + "/article?lang=ar" },
    { label: "same-origin protocol-relative canonical", head: '<link rel="canonical" href="//canonical-fixture.example/article">', expected: origin + "/article" },
    { label: "external syndication canonical does not credit the local site", head: '<link rel="canonical" href="https://original-publisher.example/article">' },
    { label: "external protocol-relative canonical", head: '<link rel="canonical" href="//other.example/page">' },
    { label: "lookalike subdomain is another origin", head: '<link rel="canonical" href="https://blog.canonical-fixture.example/">' },
    { label: "http canonical downgrades the https origin", head: '<link rel="canonical" href="http://canonical-fixture.example/article">' },
    { label: "external canonical with matching path", head: '<link rel="canonical" href="https://other.example/">' },
    { label: "case-insensitive rel", head: '<link REL="CANONICAL" HREF="/case">', expected: origin + "/case" },
    { label: "commented-out canonical", head: '<!-- ' + valid + ' -->' },
    { label: "script string example", head: '<script>const example = \'<link rel="canonical" href="/fake">\';</script>' },
    { label: "style example", head: '<style>/* <link rel="canonical" href="/fake"> */</style>' },
    { label: "template element", head: '<template><link rel="canonical" href="/fake"></template>' },
    { label: "noscript example", head: '<noscript><link rel="canonical" href="/fake"></noscript>' },
    { label: "body-only canonical", head: "", body: valid },
    { label: "head missing closing tag", head: valid, prefix: "<head>" },
    { label: "unsafe scheme", head: '<link rel="canonical" href="javascript:alert(1)">' },
    { label: "fragment-only href", head: '<link rel="canonical" href="#home">' },
    { label: "fake head inside HTML comment", head: valid, prefix: '<!-- <head><link rel="canonical" href="/fake"></head> -->', expected: origin + "/actual" },
  ];
  try {
    for (const entry of cases) {
      const html = '<!doctype html><html lang="en">' + (entry.prefix || "") +
        (entry.prefix === "<head>" ? "" : "<head>") +
        '<title>Canonical readiness fixture</title>' + entry.head +
        (entry.prefix === "<head>" ? "" : "</head>") +
        '<body><h1>Home</h1>' + (entry.body || "") + '</body></html>';
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        const url = String(input);
        requested.push(url);
        const path = new URL(url).pathname;
        if (path === "/robots.txt") return new Response("User-agent: *\\nAllow: /");
        if (path === "/sitemap.xml") return new Response("<urlset></urlset>");
        assert.equal(path, "/", entry.label);
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan(origin + "/", undefined, usage);
      const finding = result.findings.find((row) => row.code === "canonical");
      assert.ok(finding, entry.label);
      assert.equal(finding.status, entry.expected ? "pass" : "fail", entry.label);
      assert.equal(finding.awardedPoints, entry.expected ? 7 : 0, entry.label);
      if (entry.expected) assert.equal(finding.evidence, entry.expected, entry.label);
      else assert.equal(finding.evidence, "Canonical link is missing or invalid.", entry.label);
      assert.deepEqual(requested, [origin + "/", origin + "/robots.txt", origin + "/sitemap.xml"], entry.label);
      assert.equal(usage.requestCount, 3, entry.label + ": no extra network requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("canonical readiness rejects duplicate active head hints without counting inert examples", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://canonical-duplicates.example";
  const valid = '<link rel="canonical" href="/primary">';
  const cases = [
    { label: "one valid canonical", head: valid, pass: true },
    { label: "conflicting canonical", head: valid + '<link rel="canonical" href="/other">', pass: false },
    { label: "identical duplicate canonical", head: valid + valid, pass: false },
    { label: "invalid second canonical", head: valid + '<link rel="canonical" href="javascript:alert(1)">', pass: false },
    { label: "empty first canonical", head: '<link rel="canonical" href="">' + valid, pass: false },
    { label: "canonical combined with alternate rel", head: valid + '<link rel="alternate canonical" href="/other">', pass: false },
    { label: "different noncanonical link is harmless", head: valid + '<link rel="alternate" href="/ar">', pass: true },
    { label: "commented-out duplicate is inert", head: valid + '<!-- ' + valid + ' -->', pass: true },
    { label: "template duplicate is inert", head: valid + '<template>' + valid + '</template>', pass: true },
  ];
  try {
    for (const entry of cases) {
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        requested.push(url.pathname);
        if (url.pathname === "/robots.txt") return new Response("User-agent: *\\nAllow: /");
        if (url.pathname === "/sitemap.xml") return new Response("<urlset></urlset>");
        assert.equal(url.pathname, "/", entry.label);
        return new Response(
          '<!doctype html><html lang="en"><head><title>Duplicate canonical fixture</title>' +
            entry.head + '</head><body><h1>Home</h1></body></html>',
          { headers: { "content-type": "text/html" } },
        );
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan(origin + "/", undefined, usage);
      const finding = result.findings.find((row) => row.code === "canonical");
      assert.ok(finding, entry.label);
      assert.equal(finding.status, entry.pass ? "pass" : "fail", entry.label);
      assert.equal(finding.awardedPoints, entry.pass ? 7 : 0, entry.label);
      if (entry.pass) assert.equal(finding.evidence, origin + "/primary", entry.label);
      assert.deepEqual(requested, ["/", "/robots.txt", "/sitemap.xml"], entry.label);
      assert.equal(usage.requestCount, 3, entry.label + ": no extra network requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness accepts only one active title in the document head", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://title-readiness.example";
  const realTitle = "Northstar analytics and demand planning";
  const titleTag = "<title>" + realTitle + "</title>";
  const page = (head: string, body = "<h1>Northstar</h1>") =>
    '<!doctype html><html lang="en"><head>' + head + "</head><body>" + body + "</body></html>";
  const cases: Array<{ label: string; html: string; points: number; title?: string }> = [
    { label: "one active head title", html: page(titleTag), points: 7, title: realTitle },
    { label: "case-insensitive title tag", html: page("<TITLE>" + realTitle + "</TITLE>"), points: 7, title: realTitle },
    { label: "HTML entities decoded", html: page("<title>Northstar &amp; partners official website</title>"), points: 7, title: "Northstar & partners" },
    { label: "short active title stays partial", html: page("<title>Short</title>"), points: 4, title: "Short" },
    { label: "overlong active title stays partial", html: page("<title>" + "A".repeat(75) + "</title>"), points: 4 },
    { label: "HTML comment is not a title", html: page("<!-- " + titleTag + " -->"), points: 0 },
    { label: "title in script example is ignored", html: page("<script>const example = '" + titleTag + "';</script>"), points: 0 },
    { label: "title in style example is ignored", html: page("<style>" + titleTag + "</style>"), points: 0 },
    { label: "template example is ignored", html: page("<template>" + titleTag + "</template>"), points: 0 },
    { label: "noscript example is ignored", html: page("<noscript>" + titleTag + "</noscript>"), points: 0 },
    { label: "body-only title is ignored", html: page("", titleTag + "<h1>Northstar</h1>"), points: 0 },
    { label: "title before document head is ignored", html: titleTag + page(""), points: 0 },
    { label: "commented fake head is ignored", html: "<!-- <head>" + titleTag + "</head> -->" + page(""), points: 0 },
    { label: "unclosed head does not earn title points", html: '<!doctype html><html><head>' + titleTag + "<body>Hi</body></html>", points: 0 },
    { label: "identical duplicate titles are ambiguous", html: page(titleTag + titleTag), points: 0 },
    { label: "conflicting duplicate titles are ambiguous", html: page(titleTag + "<title>Other legitimate-looking title</title>"), points: 0 },
    { label: "inert duplicate is harmless", html: page(titleTag + "<!-- " + titleTag + " -->"), points: 7, title: realTitle },
    { label: "body title does not override active head", html: page(titleTag, titleTag), points: 7, title: realTitle },
  ];
  try {
    for (const entry of cases) {
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        const url = String(input);
        requested.push(url);
        const path = new URL(url).pathname;
        if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /");
        if (path === "/sitemap.xml") return new Response("<urlset></urlset>");
        assert.equal(path, "/", entry.label);
        return new Response(entry.html, { headers: { "Content-Type": "text/html" } });
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan(origin + "/", undefined, usage);
      const finding = result.findings.find((row) => row.code === "title");
      assert.ok(finding, entry.label);
      assert.equal(finding.awardedPoints, entry.points, entry.label);
      assert.equal(finding.status, entry.points === 7 ? "pass" : entry.points === 4 ? "partial" : "fail", entry.label);
      if (entry.title) assert.ok(finding.evidence.includes(entry.title), entry.label);
      else if (entry.points === 0) assert.equal(finding.evidence, "No title element was found.", entry.label);
      assert.deepEqual(requested, [origin + "/", origin + "/robots.txt", origin + "/sitemap.xml"], entry.label);
      assert.equal(usage.requestCount, 3, entry.label + ": no additional network requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness rejects duplicate active SEO meta and Open Graph declarations", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://meta-duplicates.example";
  const description = "Northstar Analytics provides clear forecasting, reliable business intelligence, and practical recommendations for growing teams.";
  const descTag = '<meta name="description" content="' + description + '">';
  const ogTitle = '<meta property="og:title" content="Northstar Analytics overview">';
  const ogDescription = '<meta property="og:description" content="Insights and forecasting services">';
  const ogTags = ogTitle + ogDescription;
  const cases: Array<{
    label: string; head: string; body?: string; descriptionPoints: number; ogPoints: number;
  }> = [
    { label: "one of each active field", head: descTag + ogTags, descriptionPoints: 7, ogPoints: 6 },
    { label: "same description twice", head: descTag + descTag + ogTags, descriptionPoints: 0, ogPoints: 6 },
    { label: "conflicting descriptions", head: descTag + '<meta name="description" content="Different description">' + ogTags, descriptionPoints: 0, ogPoints: 6 },
    { label: "empty first description", head: '<meta name="description" content="">' + descTag + ogTags, descriptionPoints: 0, ogPoints: 6 },
    { label: "empty second description", head: descTag + '<meta name="description">' + ogTags, descriptionPoints: 0, ogPoints: 6 },
    { label: "duplicate identical og title", head: descTag + ogTags + ogTitle, descriptionPoints: 7, ogPoints: 0 },
    { label: "conflicting og description", head: descTag + ogTags + '<meta property="og:description" content="Another summary">', descriptionPoints: 7, ogPoints: 0 },
    { label: "missing og description", head: descTag + ogTitle, descriptionPoints: 7, ogPoints: 0 },
    { label: "short single description remains partial", head: '<meta name="description" content="Short">' + ogTags, descriptionPoints: 4, ogPoints: 6 },
    { label: "commented duplicate is inert", head: descTag + '<!-- ' + descTag + ' -->' + ogTags, descriptionPoints: 7, ogPoints: 6 },
    { label: "template duplicate is inert", head: descTag + '<template>' + descTag + '</template>' + ogTags, descriptionPoints: 7, ogPoints: 6 },
    { label: "script example is inert", head: descTag + '<script>const example = "' + descTag + '";</script>' + ogTags, descriptionPoints: 7, ogPoints: 6 },
    { label: "body-only duplicate does not count", head: descTag + ogTags, body: descTag + ogTitle, descriptionPoints: 7, ogPoints: 6 },
    { label: "different meta key is harmless", head: descTag + ogTags + '<meta name="keywords" content="analytics">', descriptionPoints: 7, ogPoints: 6 },
  ];
  try {
    for (const entry of cases) {
      const fetched: string[] = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        fetched.push(url.pathname);
        if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
        if (url.pathname === "/sitemap.xml") return new Response("<urlset></urlset>");
        assert.equal(url.pathname, "/", entry.label);
        return new Response(
          '<!doctype html><html lang="en"><head><title>Northstar Analytics overview</title>' +
            entry.head + '</head><body><h1>Northstar Analytics</h1>' + (entry.body || "") + '</body></html>',
          { headers: { "Content-Type": "text/html" } },
        );
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan(origin + "/", undefined, usage);
      const metaFinding = result.findings.find((row) => row.code === "meta_description");
      const ogFinding = result.findings.find((row) => row.code === "open_graph");
      assert.ok(metaFinding, entry.label);
      assert.ok(ogFinding, entry.label);
      assert.equal(metaFinding.awardedPoints, entry.descriptionPoints, entry.label);
      assert.equal(ogFinding.awardedPoints, entry.ogPoints, entry.label);
      if (!entry.descriptionPoints) assert.equal(metaFinding.evidence, "No meta description was found.", entry.label);
      assert.deepEqual(fetched, ["/", "/robots.txt", "/sitemap.xml"], entry.label);
      assert.equal(usage.requestCount, 3, entry.label + ": no additional crawl requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("robots readiness evaluates the scanned URL path, with specific Allow rules taking precedence", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://robots-path.example";
  const page = '<!doctype html><html lang="en"><head><title>Robots path example</title></head><body><h1>Page</h1></body></html>';
  const cases: Array<{ label: string; path: string; robots: string; blocked: boolean }> = [
    { label: "specific path blocked", path: "/private/report", robots: "User-agent: *\nDisallow: /private", blocked: true },
    { label: "prefix matching follows robots conventions", path: "/private2", robots: "User-agent: *\nDisallow: /private", blocked: true },
    { label: "unrelated path remains allowed", path: "/public", robots: "User-agent: *\nDisallow: /private", blocked: false },
    { label: "robots paths are case-sensitive", path: "/Private", robots: "User-agent: *\nDisallow: /private", blocked: false },
    { label: "matching uppercase path is blocked", path: "/Private", robots: "User-agent: *\nDisallow: /Private", blocked: true },
    { label: "more-specific allow wins", path: "/private/open", robots: "User-agent: *\nDisallow: /private\nAllow: /private/open", blocked: false },
    { label: "more-specific disallow wins", path: "/private/open", robots: "User-agent: *\nAllow: /private\nDisallow: /private/open", blocked: true },
    { label: "equal specificity allow wins", path: "/private", robots: "User-agent: *\nDisallow: /private\nAllow: /private", blocked: false },
    { label: "root disallow remains enforced", path: "/anything", robots: "User-agent: *\nDisallow: /\nAllow: /special", blocked: true },
    { label: "root exception is allowed", path: "/special", robots: "User-agent: *\nDisallow: /\nAllow: /special", blocked: false },
    { label: "end-anchored rule matches exact path", path: "/private", robots: "User-agent: *\nDisallow: /private$", blocked: true },
    { label: "end-anchored rule does not match descendants", path: "/private/page", robots: "User-agent: *\nDisallow: /private$", blocked: false },
    { label: "wildcard pattern blocks matching path", path: "/articles/private/info", robots: "User-agent: *\nDisallow: /*/private/", blocked: true },
    { label: "wildcard pattern leaves other paths accessible", path: "/articles/public/info", robots: "User-agent: *\nDisallow: /*/private/", blocked: false },
    { label: "named bot rule cannot block general crawler", path: "/private", robots: "User-agent: ExampleBot\nDisallow: /private\nUser-agent: *\nAllow: /", blocked: false },
    { label: "consecutive wildcard group agents respected", path: "/private", robots: "User-agent: ExampleBot\nUser-agent: *\nDisallow: /private", blocked: true },
    { label: "path query can be blocked by robots", path: "/search?q=private", robots: "User-agent: *\nDisallow: /search?*", blocked: true },
    { label: "empty Disallow is not a ban", path: "/public", robots: "User-agent: *\nDisallow:", blocked: false },
  ];
  try {
    for (const entry of cases) {
      const fetched: string[] = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        fetched.push(url.pathname);
        if (url.pathname === "/robots.txt") return new Response(entry.robots, { headers: { "Content-Type": "text/plain" } });
        if (url.pathname === "/sitemap.xml") return new Response("<urlset></urlset>", { headers: { "Content-Type": "application/xml" } });
        assert.equal(url.pathname + url.search, entry.path, entry.label);
        return new Response(page, { headers: { "Content-Type": "text/html" } });
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan(origin + entry.path, undefined, usage);
      const finding = result.findings.find((item) => item.code === "robots_policy");
      assert.ok(finding, entry.label);
      assert.equal(finding.status, entry.blocked ? "fail" : "pass", entry.label);
      assert.equal(finding.awardedPoints, entry.blocked ? 0 : 7, entry.label);
      assert.deepEqual(fetched, [new URL(origin + entry.path).pathname, "/robots.txt", "/sitemap.xml"], entry.label);
      assert.equal(usage.requestCount, 3, entry.label + ": unchanged bounded network budget");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("partial auxiliary documents cannot earn robots or sitemap readiness points", async () => {
  const originalFetch = globalThis.fetch;
  const origin = "https://partial-auxiliary.example";
  const homepage = '<!doctype html><html lang="en"><head><title>Auxiliary response fixture</title></head><body><h1>Welcome</h1></body></html>';
  const robots = "User-agent: *\nAllow: /";
  const sitemap = "<urlset><url><loc>https://partial-auxiliary.example/</loc></url></urlset>";
  const cases = [
    { label: "complete documents", robotsStatus: 200, sitemapStatus: 200, robotsPass: true, sitemapPass: true },
    { label: "partial robots policy", robotsStatus: 206, sitemapStatus: 200, robotsPass: false, sitemapPass: true },
    { label: "empty no-content robots policy", robotsStatus: 204, sitemapStatus: 200, robotsPass: false, sitemapPass: true },
    { label: "partial sitemap with a syntactically complete XML fragment", robotsStatus: 200, sitemapStatus: 206, robotsPass: true, sitemapPass: false },
    { label: "asynchronous sitemap is not a completed document", robotsStatus: 200, sitemapStatus: 202, robotsPass: true, sitemapPass: false },
    { label: "both auxiliary documents partial", robotsStatus: 206, sitemapStatus: 206, robotsPass: false, sitemapPass: false },
  ];
  try {
    for (const entry of cases) {
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        requested.push(url.pathname);
        if (url.pathname === "/robots.txt") {
          return new Response(entry.robotsStatus === 204 ? null : robots, {
            status: entry.robotsStatus,
            headers: { "Content-Type": "text/plain" },
          });
        }
        if (url.pathname === "/sitemap.xml") {
          return new Response(sitemap, {
            status: entry.sitemapStatus,
            headers: { "Content-Type": "application/xml" },
          });
        }
        assert.equal(url.pathname, "/", entry.label);
        return new Response(homepage, { headers: { "Content-Type": "text/html" } });
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      const result = await runLiveReadinessScan(origin + "/", undefined, usage);
      const robotsFinding = result.findings.find((finding) => finding.code === "robots_policy");
      const sitemapFinding = result.findings.find((finding) => finding.code === "xml_sitemap");
      assert.equal(robotsFinding?.status, entry.robotsPass ? "pass" : "fail", entry.label);
      assert.equal(robotsFinding?.awardedPoints, entry.robotsPass ? 7 : 0, entry.label);
      assert.equal(sitemapFinding?.status, entry.sitemapPass ? "pass" : "fail", entry.label);
      assert.equal(sitemapFinding?.awardedPoints, entry.sitemapPass ? 7 : 0, entry.label);
      assert.deepEqual(requested, ["/", "/robots.txt", "/sitemap.xml"], entry.label);
      assert.equal(usage.requestCount, 3, entry.label + ": no extra requests");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("HTTP 200 HTML placeholders cannot earn readiness points or trigger auxiliary requests", async () => {
  const originalFetch = globalThis.fetch;
  const validPage = '<!doctype html><html lang="en"><head><title>Actual homepage</title></head><body><h1>Real content</h1></body></html>';
  const cases = [
    { label: "empty HTML body", html: "", valid: false },
    { label: "whitespace HTML body", html: " \n\t ", valid: false },
    { label: "plain text mislabeled HTML", html: "Service is temporarily unavailable", valid: false },
    { label: "doctype without a document", html: "<!doctype html>", valid: false },
    { label: "commented-out fake document", html: "<!-- " + validPage + " -->", valid: false },
    { label: "inert script containing fake document", html: "<script>const demo = " + JSON.stringify(validPage) + ";</script>", valid: false },
    { label: "inert template containing fake document", html: "<template>" + validPage + "</template>", valid: false },
    { label: "real HTML document", html: validPage, valid: true },
    { label: "valid optional html root omitted", html: "<head><title>Valid page</title></head><body><h1>Valid content</h1></body>", valid: true },
  ];
  try {
    for (const entry of cases) {
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        requested.push(url.pathname);
        if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
        if (url.pathname === "/sitemap.xml") return new Response("<urlset></urlset>");
        assert.equal(url.pathname, "/", entry.label);
        return new Response(entry.html, { status: 200, headers: { "Content-Type": "text/html" } });
      };
      const usage = { requestCount: 0, bytesFetched: 0 };
      if (entry.valid) {
        const result = await runLiveReadinessScan("https://html-status.example/", undefined, usage);
        assert.equal(result.findings.find((row) => row.code === "page_access")?.awardedPoints, 15, entry.label);
        assert.deepEqual(requested, ["/", "/robots.txt", "/sitemap.xml"], entry.label);
        assert.equal(usage.requestCount, 3, entry.label);
      } else {
        await assert.rejects(
          runLiveReadinessScan("https://html-status.example/", undefined, usage),
          /did not return an HTML webpage/,
          entry.label,
        );
        assert.deepEqual(requested, ["/"], entry.label);
        assert.equal(usage.requestCount, 1, entry.label);
      }
    }
    globalThis.fetch = async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
      if (pathname === "/sitemap.xml") return new Response("<urlset></urlset>");
      return new Response(validPage, { headers: { "Content-Type": "text/plain" } });
    };
    const realMarkupWithoutHtmlMime = await runLiveReadinessScan("https://html-status.example/");
    assert.equal(realMarkupWithoutHtmlMime.findings.find((row) => row.code === "page_access")?.awardedPoints, 15);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
