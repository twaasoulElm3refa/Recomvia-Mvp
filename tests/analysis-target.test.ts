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
      assert.throws(() => parseTargetInput({ input: address }), undefined, address);
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
