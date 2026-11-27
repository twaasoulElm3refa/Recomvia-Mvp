import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../app/api/scans/route";
import { POST as monitor } from "../app/api/internal/monitor/route";
import { createFixture, state, userA } from "./target-runtime-fixture";
import { getReportForUser } from "../db/product";
import type { StoredScan } from "../db/product";
import { triggerMonitoring } from "../workers/monitor-trigger";
import { monitoringScanStatus } from "../lib/monitoring-scan-status";
import { OpenRouterEngineAdapter } from "../lib/ai-engines/openrouter-engine-adapter";

type Db = ReturnType<typeof createFixture>;
type Payload = { scan: StoredScan; cached?: boolean; code?: string; scanId?: string };
type ProviderRequest = { model: string; messages: { content: string }[]; max_tokens: number; reasoning: { enabled: boolean }; plugins: { id: string; max_results: number }[]; tools?: unknown };
const secret = "test-only-monitoring-secret-with-32-characters";
const candidate = { kind: "person", name: "Ada Example", description: "Public researcher", category: "Retail analytics", aliases: [], country: "Global", websiteUrl: null, sources: ["https://profiles.example/ada"] };
const request = (body: unknown) => new Request("https://recomvia.test/api/scans", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://recomvia.test" }, body: JSON.stringify(body) });
const tick = (token = secret) => monitor(new Request("https://recomvia.test/api/internal/monitor", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
const person = { input: "Ada Example", kind: "person" };
function reply(body: ProviderRequest, options: { search?: boolean; cost?: number | null; fail?: boolean; model?: string } = {}) {
  const search = options.search !== false;
  const discovery = body.messages[1].content.includes("INPUT_DATA:");
  return Response.json({
    id: crypto.randomUUID(), model: options.model || body.model,
    choices: [{ message: { content: options.fail ? "" : discovery ? JSON.stringify({ status: "resolved", candidates: [candidate] }) : body.model === "test/model" ? "1. Ada Example — recommended for retail analytics." : "1. Other Researcher — recommended for retail analytics.",
      annotations: search ? [{ type: "url_citation", url_citation: { url: "https://profiles.example/ada", title: "Profile" } }] : [] } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, ...(options.cost === null ? {} : { cost: options.cost ?? 0.001 }) },
  });
}
async function setup(plan: "free" | "essential" | "growth" | "pro", action: (db: Db, requests: ProviderRequest[]) => Promise<void>, handler: (body: ProviderRequest) => Response | Promise<Response> = reply) {
  const db = createFixture(false, plan !== "free"), original = globalThis.fetch;
  if (plan !== "free") db.prepare("UPDATE subscriptions SET plan=?").run(plan);
  const requests: ProviderRequest[] = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith("https://openrouter.ai/"), `Unexpected network destination: ${url}`);
    const body = JSON.parse(String(init?.body)) as ProviderRequest;
    assert.deepEqual(body.reasoning, { enabled: false });
    assert.deepEqual(body.plugins, [{ id: "web", max_results: 1 }]);
    assert.equal(body.tools, undefined);
    requests.push(body); return handler(body);
  };
  try { await action(db, requests); } finally { globalThis.fetch = original; db.close(); }
}
const read = (response: Response) => response.json() as Promise<Payload>;
const count = (db: Db, table: string) => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n);

for (const [plan, models, questions, depth] of [
  ["free", 1, 3, "initial"], ["essential", 2, 6, "detailed"], ["growth", 3, 12, "advanced"], ["pro", 3, 12, "advanced"],
] as const) test(`${plan} executes independent plan-sized observations; client cannot select a richer plan`, async () => {
  await setup(plan, async (db, requests) => {
    const response = await POST(request({ ...person, plan: "pro", promptLimit: 1000, models: ["forged/model"], monitoring: true }));
    const body = await read(response);
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(count(db, "engine_runs"), models * questions);
    assert.equal(requests.length, models * questions + 1); // Identity discovery is a separate recorded request.
    const measurementRequests = requests.filter((item) => !item.messages[1].content.includes("INPUT_DATA:"));
    assert.equal(requests.find((item) => item.messages[1].content.includes("INPUT_DATA:"))?.max_tokens, 600);
    assert.ok(measurementRequests.every((item) => item.max_tokens === (plan === "free" ? 180 : 280)));
    assert.ok(measurementRequests.every((item) => /Answer the question directly/.test(item.messages[0].content) && /at most 2 supporting sources/.test(item.messages[0].content)));
    assert.equal(new Set(measurementRequests.map((item) => item.model)).size, models);
    const perModel = [...new Set(measurementRequests.map((item) => item.model))].map((model) => measurementRequests.filter((item) => item.model === model).map((item) => item.messages[1].content).sort());
    for (const questionsForModel of perModel) assert.deepEqual(questionsForModel, perModel[0]);
    assert.equal(Number(db.prepare("SELECT SUM(cost_micros) n FROM cost_ledger WHERE category IN ('ai_engine','entity_discovery')").get()?.n), requests.length * 1000);
    const stored = JSON.parse(String(db.prepare("SELECT details_json FROM scan_insights").get()?.details_json));
    assert.equal(stored.level, depth);
    assert.equal(stored.scope.questions, questions);
    assert.equal(stored.scope.coverageComplete, true);
    if (plan === "free") {
      assert.ok(!("engineRuns" in body.scan)); assert.ok(!("insights" in body.scan));
      assert.equal(count(db, "monitoring_schedules"), 0);
    } else {
      assert.equal(body.scan.engineRuns.length, models * questions);
      assert.equal(body.scan.insights!.byEngine[0].mentionRate, 100);
      assert.equal(body.scan.insights!.byEngine[1].mentionRate, 0);
      assert.equal(Boolean(body.scan.insights!.advanced), depth === "advanced");
      if (depth === "advanced") assert.equal(body.scan.insights!.advanced!.agreement.length, questions - 1);
      assert.equal(count(db, "monitoring_schedules"), 1);
    }
    const again = await POST(request({ ...person, monitoring: true }));
    assert.equal((await read(again)).cached, true);
    assert.equal(requests.length, models * questions + 1);
  });
});

test("Starter opens saved evidence without a new request; upgrading runs a deeper sample instead of using the free cache", async () => {
  await setup("free", async (db, requests) => {
    const body = await read(await POST(request(person)));
    const scan = db.prepare("SELECT id,organization_id FROM scans").get()!;
    db.prepare("INSERT INTO report_purchases (id,organization_id,scan_id,provider,provider_payment_id,amount_cents,status,paid_at) VALUES ('purchase',?,?,'test','payment',499,'paid',CURRENT_TIMESTAMP)").run(scan.organization_id, scan.id);
    const unlocked = await getReportForUser(userA.userId, body.scan.id);
    assert.equal(unlocked!.entitlement.reportLevel, "starter");
    assert.ok("engineRuns" in unlocked!.scan);
    assert.equal((unlocked!.scan as StoredScan).insights, null);
    assert.equal(requests.length, 4);
    db.prepare("INSERT INTO subscriptions (id,organization_id,plan,status,current_period_end) VALUES ('paid',?,'essential','active','2099-01-01')").run(scan.organization_id);
    const upgraded = await POST(request(person));
    assert.equal(upgraded.status, 201);
    const full = await read(upgraded);
    assert.notEqual(full.scan.id, body.scan.id);
    assert.equal(full.scan.engineRuns.length, 12);
    assert.equal(full.scan.insights!.history[0].comparable, false);
    assert.equal(full.scan.insights!.change, null);
    assert.equal(requests.length, 17);
  });
});

test("missing or duplicate model configuration blocks paid work before calls or scan creation", async () => {
  await setup("growth", async (db, requests) => {
    state.env.OPENROUTER_MODELS_JSON = '["test/model","test/second","test/second"]';
    const result = await POST(request(person));
    assert.equal(result.status, 503); assert.equal((await read(result)).code, "analysis_configuration");
    assert.equal(requests.length, 0); assert.equal(count(db, "scans"), 0);
  });
});

test("Pro allows three distinct projects with Growth depth and blocks a fourth before consumption", async () => {
  await setup("pro", async (db, requests) => {
    for (const input of ["Retail analytics", "Hotel operations", "Travel booking"]) {
      const response = await POST(request({ input, kind: "topic" }));
      assert.equal(response.status, 201);
      assert.equal((await read(response)).scan.engineRuns.length, 36);
    }
    const fourth = await POST(request({ input: "A fourth project", kind: "topic" }));
    assert.equal(fourth.status, 403); assert.equal((await read(fourth)).code, "project_limit");
    assert.equal(requests.length, 108); assert.equal(count(db, "subscription_projects"), 3);
  });
});

test("Growth rolling monthly allowance is enforced independently of daily allowance", async () => {
  await setup("growth", async (db, requests) => {
    for (let i = 0; i < 8; i++) {
      const response = await POST(request({ input: "Retail analytics", kind: "topic", context: `sample ${i}` }));
      assert.equal(response.status, 201);
      db.prepare("UPDATE scans SET created_at=datetime('now','-2 days')").run();
    }
    const rejected = await POST(request({ input: "Retail analytics", kind: "topic", context: "extra sample" }));
    assert.equal(rejected.status, 429); assert.equal(requests.length, 288);
  });
});

test("Growth runs at most two outbound observations and one per model", async () => {
  let active = 0, peak = 0;
  const perModel = new Map<string, number>();
  await setup("growth", async (_db, requests) => {
    const response = await POST(request(person));
    assert.equal(response.status, 201);
    assert.equal(requests.length, 37);
    assert.equal(peak, 2);
  }, async (body) => {
    active++;
    peak = Math.max(peak, active);
    const modelActive = (perModel.get(body.model) || 0) + 1;
    perModel.set(body.model, modelActive);
    assert.equal(modelActive, 1, `concurrent requests for ${body.model}`);
    await new Promise((resolve) => setTimeout(resolve, 3));
    perModel.set(body.model, modelActive - 1);
    active--;
    return reply(body);
  });
});

test("Growth recovers from one 429, retains billed attempt costs, and records retry latency", async () => {
  let limited = false;
  await setup("growth", async (db, requests) => {
    const response = await POST(request(person));
    assert.equal(response.status, 201);
    const body = await read(response);
    assert.equal(body.scan.actualVisibilityStatus, "measured");
    assert.equal(requests.length, 38);
    const recovered = body.scan.engineRuns.find((run) => run.model === "test/second" && run.retryCount === 1)!;
    assert.equal(recovered.error, null);
    assert.equal(recovered.estimatedCostMicros, 3_000);
    const ledger = db.prepare("SELECT metadata_json AS metadata FROM cost_ledger WHERE id=?").get(`engine_${recovered.id}`) as { metadata: string };
    assert.equal(JSON.parse(ledger.metadata).retryCount, 1);
    assert.equal(typeof JSON.parse(ledger.metadata).latencyMs, "number");
  }, (body) => {
    if (body.model === "test/second" && !limited) {
      limited = true;
      return Response.json({ error: { code: "rate_limit", message: "Slow down" }, usage: { cost: 0.002 } }, { status: 429 });
    }
    return reply(body);
  });
});

test("repeated 429s open only the failing model circuit and preserve other results", async () => {
  await setup("growth", async (_db, requests) => {
    const response = await POST(request(person));
    assert.equal(response.status, 201);
    const body = await read(response);
    assert.equal(body.scan.actualVisibilityStatus, "partial");
    assert.equal(requests.length, 31); // discovery + 24 successes + 2 questions x 3 attempts
    const failed = body.scan.engineRuns.filter((run) => run.model === "test/second");
    assert.equal(failed.length, 12);
    assert.equal(failed.filter((run) => run.error?.code === "rate_limit" && run.retryCount === 2).length, 2);
    assert.equal(failed.filter((run) => run.error?.code === "model_rate_limited").length, 10);
    assert.equal(body.scan.insights!.byEngine.find((row) => row.model === "test/second")?.mentionRate, null);
  }, (body) => body.model === "test/second" && !body.messages[1].content.includes("INPUT_DATA:")
    ? Response.json({ error: { code: "rate_limit", message: "Slow down" } }, { status: 429 }) : reply(body));
});

test("Growth shares a four-retry ceiling across all observations", async () => {
  const attempts = new Map<string, number>();
  await setup("growth", async (_db, requests) => {
    const response = await POST(request(person));
    assert.equal(response.status, 201);
    const body = await read(response);
    assert.equal(body.scan.actualVisibilityStatus, "partial");
    assert.equal(body.scan.engineRuns.filter((run) => run.retryCount === 1).length, 4);
    assert.equal(requests.length, 35); // discovery + 24 other models + 6 attempted questions + 4 retries
  }, (body) => {
    if (body.model !== "test/second" || body.messages[1].content.includes("INPUT_DATA:")) return reply(body);
    const key = body.messages[1].content;
    const attempt = (attempts.get(key) || 0) + 1;
    attempts.set(key, attempt);
    return attempt === 1 ? Response.json({ error: { code: "rate_limit", message: "Slow down" } }, { status: 429 }) : reply(body);
  });
});

test("timeout, empty paid response, and deterministic 4xx do not trigger extra calls", async () => {
  const run = { prompt: "Find evidence", language: "en", country: "Global", useSearch: true };
  let timeoutCalls = 0;
  const timeoutFetch: typeof fetch = async (_url, init) => {
    timeoutCalls++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  };
  const timedOut = await new OpenRouterEngineAdapter({ apiKey: "mock", model: "test/model", fetchImpl: timeoutFetch, timeoutMs: 1, maxRetries: 1 }).run(run);
  assert.equal(timedOut.error?.code, "timeout");
  assert.equal(timedOut.retryCount, 0);
  assert.equal(timeoutCalls, 1);
  let emptyCalls = 0;
  const empty = await new OpenRouterEngineAdapter({ apiKey: "mock", model: "test/model", fetchImpl: async () => {
    emptyCalls++;
    return Response.json({ id: "charged-empty", choices: [{ message: { content: "" } }], usage: { cost: 0.007 } });
  }, maxRetries: 1 }).run(run);
  assert.equal(empty.error?.code, "empty_final_response");
  assert.equal(empty.estimatedCostMicros, 7_000);
  assert.equal(empty.retryCount, 0);
  assert.equal(emptyCalls, 1);
  let invalidCalls = 0;
  const invalid = await new OpenRouterEngineAdapter({ apiKey: "mock", model: "test/model", fetchImpl: async () => {
    invalidCalls++;
    return Response.json({ error: { code: "invalid_model", message: "Invalid model" } }, { status: 400 });
  }, maxRetries: 1 }).run(run);
  assert.equal(invalid.error?.code, "invalid_model");
  assert.equal(invalid.retryCount, 0);
  assert.equal(invalidCalls, 1);
  let serverCalls = 0;
  const server = await new OpenRouterEngineAdapter({ apiKey: "mock", model: "test/model", fetchImpl: async () => {
    serverCalls++;
    return Response.json({ error: { code: "server_error", message: "Unavailable" } }, { status: 503 });
  }, maxRetries: 1 }).run(run);
  assert.equal(server.error?.code, "server_error");
  assert.equal(server.retryCount, 0);
  assert.equal(serverCalls, 1);
});

test("a single 429 observation stops after two backoff retries", async () => {
  let calls = 0;
  const result = await new OpenRouterEngineAdapter({ apiKey: "mock", model: "test/model", backoffBaseMs: 0, fetchImpl: async () => {
    calls++;
    return Response.json({ error: { code: "rate_limit", message: "Slow down" } }, { status: 429 });
  } }).run({ prompt: "Find evidence", language: "en", country: "Global", useSearch: true });
  assert.equal(calls, 3);
  assert.equal(result.retryCount, 2);
  assert.equal(result.error?.status, 429);
});

test("failed billed final answers retain reasoning and finish metadata without reducing visibility to zero", async () => {
  let secondModelCalls = 0;
  await setup("essential", async (db) => {
    const response = await POST(request(person));
    assert.equal(response.status, 201);
    const body = await read(response);
    assert.equal(body.scan.actualVisibilityStatus, "partial");
    const scored = body.scan.engineRuns.filter((run) => !run.error && run.responseText && run.surfaceType === "api_with_search" && !["identity", "topic", "entity_resolution"].includes(run.intent));
    assert.equal(body.scan.actualVisibilityScore, Math.round(100 * scored.filter((run) => run.analysis.brandVisible).length / scored.length));
    const failed = body.scan.engineRuns.find((run) => run.error?.code === "empty_final_response")!;
    assert.equal(failed.estimatedCostMicros, 6_000);
    const ledger = db.prepare("SELECT cost_micros AS cost, metadata_json AS metadata FROM cost_ledger WHERE id=?").get(`engine_${failed.id}`) as { cost: number; metadata: string };
    assert.equal(ledger.cost, 6_000);
    const metadata = JSON.parse(ledger.metadata);
    assert.equal(metadata.model, "test/second");
    assert.equal(metadata.providerRunId, "billed-empty");
    assert.equal(metadata.promptTokens, 100);
    assert.equal(metadata.completionTokens, 1200);
    assert.equal(metadata.reasoningTokens, 1200);
    assert.equal(metadata.visibleOutputTokens, 0);
    assert.equal(metadata.finishReason, "length");
    assert.equal(metadata.errorCode, "empty_final_response");
    assert.equal(metadata.retryCount, 0);
    assert.equal(typeof metadata.latencyMs, "number");
  }, (body) => {
    if (body.model === "test/second" && ++secondModelCalls === 2) {
      return Response.json({ id: "billed-empty", model: "test/second", choices: [{ finish_reason: "length", message: { content: "" } }],
        usage: { prompt_tokens: 100, completion_tokens: 1200, total_tokens: 1300, completion_tokens_details: { reasoning_tokens: 1200 }, cost: 0.006 } });
    }
    return reply(body);
  });
});

test("failed search coverage remains partial and does not become a zero visibility observation", async () => {
  await setup("essential", async () => {
    const body = await read(await POST(request(person)));
    assert.equal(body.scan.actualVisibilityStatus, "partial");
    assert.equal(body.scan.actualVisibilityScore, 100);
    assert.equal(body.scan.insights!.scope.coverageComplete, false);
    const missing = body.scan.insights!.byEngine.find((row) => row.model === "test/second")!;
    assert.equal(missing.observed, 0); assert.equal(missing.mentionRate, null);
  }, (body) => reply(body, { search: body.model !== "test/second" }));
});

test("all failed observations retain billed costs, fail the scan, and do not consume the completed free allowance", async () => {
  await setup("free", async (db, requests) => {
    const result = await POST(request({ input: "Retail analytics", kind: "topic" }));
    assert.equal(result.status, 502); assert.equal(db.prepare("SELECT status FROM scans").get()?.status, "failed");
    assert.equal(Number(db.prepare("SELECT SUM(cost_micros) n FROM cost_ledger").get()?.n), requests.length * 1000);
    assert.equal(count(db, "monitoring_schedules"), 0);
    const retry = await POST(request({ input: "Retail analytics", kind: "topic" }));
    assert.equal(retry.status, 502); assert.equal(count(db, "scans"), 2);
  }, (body) => reply(body, { fail: true }));
});

test("unknown provider costs stay unknown and a costly discovery stops further calls", async () => {
  await setup("essential", async () => {
    const body = await read(await POST(request(person)));
    assert.equal(body.scan.insights!.scope.missingCostRuns, 12);
    assert.equal(body.scan.insights!.scope.recordedProviderCostMicros, 0);
  }, (body) => reply(body, { cost: null }));
  await setup("free", async (db, requests) => {
    const result = await POST(request(person));
    assert.equal(result.status, 502); assert.equal(requests.length, 1);
    assert.equal(Number(db.prepare("SELECT SUM(cost_micros) n FROM cost_ledger").get()?.n), 200000);
  }, (body) => reply(body, { cost: 0.2 }));
});

for (const [plan, pages] of [["essential", 3], ["growth", 8]] as const) test(`${plan} audits up to ${pages} actual same-origin pages with crawl accounting and evidence`, async () => {
  await setup(plan, async (db, requests) => {
    const modelFetch = globalThis.fetch;
    const visited: string[] = [];
    globalThis.fetch = async (url, init) => {
      const address = String(url);
      if (address.includes("openrouter.ai")) return modelFetch(url, init);
      visited.push(address);
      assert.equal(new URL(address).origin, "https://northstar.example");
      if (address.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "Content-Type": "text/plain" } });
      if (address.includes("sitemap")) return new Response("<urlset></urlset>", { headers: { "Content-Type": "application/xml" } });
      return new Response(`<html lang="en"><head><title>Northstar | Retail analytics</title><meta name="description" content="Retail analytics for modern stores"></head><body><h1>Retail analytics for modern stores</h1><p>We provide retail analytics for stores.</p>${Array.from({ length: 7 }, (_, i) => `<a href="/service-${i + 1}">Service ${i + 1}</a>`).join("")}<a href="https://external.example/">External</a><a href="/download.pdf">PDF</a></body></html>`, { headers: { "Content-Type": "text/html" } });
    };
    const response = await POST(request({ input: "https://northstar.example", kind: "website" }));
    assert.equal(response.status, 201);
    const body = await read(response);
    assert.equal(body.scan.insights!.scope.auditedPages, pages);
    assert.equal(body.scan.insights!.pages.length, pages);
    assert.equal(visited.length, pages * 3);
    assert.equal(Number(db.prepare("SELECT SUM(units) n FROM cost_ledger WHERE category='crawl'").get()?.n), visited.length);
    assert.ok(body.scan.insights!.actionPlan.every((action) => action.evidenceUrls.length || action.runIds.length));
    if (plan === "growth") assert.ok(body.scan.insights!.advanced!.contentGaps.length > 0);
    assert.equal(requests.length, plan === "essential" ? 12 : 36);
  });
});

test("scheduled jobs require the secret, lease once under concurrent ticks, and persist comparable history", async () => {
  await setup("essential", async (db, requests) => {
    await POST(request(person));
    state.env.MONITORING_SECRET = secret;
    db.exec("UPDATE monitoring_schedules SET next_run_at=datetime('now','-1 hour')");
    assert.equal((await tick("wrong")).status, 401); assert.equal(requests.length, 13);
    state.user = null; // The scheduler uses the stored owner, not an arbitrary browser session.
    const results = await Promise.all([tick(), tick()]);
    const bodies = await Promise.all(results.map((result) => result.json() as Promise<{ processed: number; status?: string }>));
    assert.equal(bodies.reduce((sum, body) => sum + body.processed, 0), 1);
    assert.equal(bodies.find((body) => body.processed)?.status, "completed");
    assert.equal(requests.length, 25); // Stored confirmed identity reused; all visibility observations fresh.
    const row = db.prepare("SELECT details_json FROM scan_insights ORDER BY rowid DESC LIMIT 1").get()!;
    const details = JSON.parse(String(row.details_json));
    assert.equal(details.history[0].comparable, true); assert.equal(details.change.percentagePoints, 0);
    assert.equal(db.prepare("SELECT lease_token FROM monitoring_schedules").get()?.lease_token, null);
    assert.equal((await (await tick()).json() as { processed: number }).processed, 0);
  });
});

test("expiry pauses monitoring without a provider call; downgrade cannot expose advanced report sections", async () => {
  await setup("growth", async (db, requests) => {
    const body = await read(await POST(request(person)));
    db.exec("UPDATE subscriptions SET plan='essential'");
    const downgraded = await getReportForUser(userA.userId, body.scan.id);
    assert.equal((downgraded!.scan as StoredScan).insights!.advanced, null);
    db.exec("UPDATE subscriptions SET current_period_end='2000-01-01'; UPDATE monitoring_schedules SET next_run_at=datetime('now','-1 hour')");
    state.env.MONITORING_SECRET = secret;
    const result = await (await tick()).json() as { status: string };
    assert.equal(result.status, "subscription_required"); assert.equal(requests.length, 37);
    assert.equal(db.prepare("SELECT state FROM monitoring_schedules").get()?.state, "paused");
    const locked = await GET(new Request(`https://recomvia.test/api/scans?scan=${body.scan.id}`));
    assert.ok(!JSON.stringify(await locked.json()).includes("insights"));
  });
});

test("monitor classifies completed scans without parsing the private report body", async () => {
  let cancelled = false;
  const report = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("private report")); },
    cancel() { cancelled = true; },
  });
  assert.equal(await monitoringScanStatus(new Response(report, { status: 201 })), "completed");
  assert.equal(cancelled, true);
});

test("monitor persists only recognized failure codes, never a forged completion", async () => {
  for (const [body, status, expected] of [
    [{ code: "subscription_required" }, 403, "subscription_required"],
    [{ status: "needs_confirmation" }, 202, "needs_confirmation"],
    [{ code: "identity_unresolved", status: "needs_clarification" }, 202, "identity_unresolved"],
    [{ code: "scan_limit" }, 429, "scan_limit"],
    [{ code: "completed" }, 500, "monitor_failed"],
    [{ status: "private customer data" }, 422, "monitor_failed"],
    [{ code: { secret: "private" } }, 500, "monitor_failed"],
    [null, 500, "monitor_failed"],
  ] as const) {
    assert.equal(await monitoringScanStatus(Response.json(body, { status })), expected);
  }
  assert.equal(await monitoringScanStatus(new Response("not JSON", { status: 500 })), "monitor_failed");
});

test("monitor trigger refuses missing configuration and uses the protected endpoint without redirects", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++; assert.equal(String(url), "https://recomvia.test/api/internal/monitor");
    assert.equal(init?.redirect, "error"); assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${secret}`);
    return Response.json({ processed: 0 });
  };
  await assert.rejects(triggerMonitoring({ RECOMVIA_ORIGIN: "http://recomvia.test", MONITORING_SECRET: secret }, transport));
  await triggerMonitoring({ RECOMVIA_ORIGIN: "https://recomvia.test", MONITORING_SECRET: secret }, transport);
  assert.equal(calls, 1);
});

test("monitor trigger rejects malformed or credential-bearing origins without disclosing configuration", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return Response.json({ processed: 0 });
  };
  for (const origin of ["private malformed origin", "https://user:private@recomvia.test", "https://recomvia.test/?private=1"]) {
    await assert.rejects(triggerMonitoring({ RECOMVIA_ORIGIN: origin, MONITORING_SECRET: secret }, transport),
      { message: "Monitoring configuration is incomplete" });
  }
  assert.equal(calls, 0);
});

test("monitor trigger sanitizes transport failures without retrying potentially leased work", async () => {
  const config = { RECOMVIA_ORIGIN: "https://recomvia.test", MONITORING_SECRET: secret };
  for (const failure of [new Error("private upstream data " + secret), new DOMException("private URL", "TimeoutError")]) {
    let calls = 0;
    await assert.rejects(triggerMonitoring(config, async () => {
      calls++;
      throw failure;
    }), { message: "Monitoring endpoint request failed" });
    assert.equal(calls, 1);
  }
});

test("monitor trigger accepts only an idle or completed single-job response", async () => {
  const config = { RECOMVIA_ORIGIN: "https://recomvia.test", MONITORING_SECRET: secret };
  for (const body of [{ processed: 0 }, { processed: 1, status: "completed" }]) {
    await triggerMonitoring(config, async () => Response.json(body));
  }
  for (const body of [null, [], {}, { processed: "0" }, { processed: false },
    { processed: 0, status: "completed" }, { processed: 2, status: "completed" },
    { processed: -1, status: "completed" }, { processed: 1.5, status: "completed" },
    { processed: 1 }, { processed: 1, status: {} }]) {
    await assert.rejects(triggerMonitoring(config, async () => Response.json(body)), /Invalid monitoring response/);
  }
});

test("monitor trigger reports failed jobs without logging untrusted status text", async () => {
  const config = { RECOMVIA_ORIGIN: "https://recomvia.test", MONITORING_SECRET: secret };
  for (const status of ["monitor_failed", "subscription_required", "private_customer_data"]) {
    await assert.rejects(
      triggerMonitoring(config, async () => Response.json({ processed: 1, status })),
      { message: "Monitoring job did not complete" },
    );
  }
  await assert.rejects(triggerMonitoring(config, async () => new Response("not JSON", { status: 200 })));
  await assert.rejects(triggerMonitoring(config, async () => new Response("unavailable", { status: 503 })),
    /Monitoring endpoint returned HTTP 503/);
});

test("monitor trigger bounds declared and actual response size and cancels rejected streams", async () => {
  const config = { RECOMVIA_ORIGIN: "https://recomvia.test", MONITORING_SECRET: secret };
  for (const declared of ["4097", "invalid", "1", undefined]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"processed":0,"extra":"'));
        controller.enqueue(new TextEncoder().encode("界".repeat(1500)));
      },
      cancel() { cancelled = true; },
    });
    const headers = new Headers({ "Content-Type": "application/json" });
    if (declared !== undefined) headers.set("Content-Length", declared);
    await assert.rejects(triggerMonitoring(config, async () => new Response(body, { headers })),
      { message: "Invalid monitoring response" });
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  }
});

test("monitor trigger sanitizes malformed JSON, invalid UTF-8, and read errors", async () => {
  const config = { RECOMVIA_ORIGIN: "https://recomvia.test", MONITORING_SECRET: secret };
  const jsonHeaders = { "Content-Type": "application/json" };
  const broken = new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new Error("private upstream data")); },
  });
  for (const response of [
    new Response("private customer data", { headers: jsonHeaders }),
    new Response(new Uint8Array([0xff, 0xfe]), { headers: jsonHeaders }),
    new Response(broken, { headers: jsonHeaders }),
    new Response('{"processed":0}', { headers: { "Content-Type": "text/html" } }),
  ]) {
    await assert.rejects(triggerMonitoring(config, async () => response),
      { message: "Invalid monitoring response" });
  }
});

test("monitor trigger accepts valid chunked UTF-8 without requiring Content-Length", async () => {
  const config = { RECOMVIA_ORIGIN: "https://recomvia.test", MONITORING_SECRET: secret };
  const bytes = new TextEncoder().encode(JSON.stringify({ processed: 1, status: "completed", note: "عربي" }));
  const split = bytes.indexOf(0xd8) + 1;
  assert.ok(split > 0);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
  await triggerMonitoring(config, async () => new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  }));
  assert.equal(body.locked, false);
});

test("a repeated provider model cannot masquerade as multiple independent models", async () => {
  await setup("essential", async () => {
    const body = await read(await POST(request(person)));
    assert.equal(body.scan.actualVisibilityStatus, "partial");
    assert.equal(body.scan.insights!.scope.coverageComplete, false);
    const insights = body.scan.insights!;
    assert.deepEqual(insights.byEngine.map((row) => row.model), insights.scope.models);
    assert.deepEqual(insights.scope.models, ["test/model", "test/second"]);
    // Both configured models have no unambiguous observations: one has
    // duplicate responses for every question and the other has none.
    for (const row of insights.byEngine) {
      assert.equal(row.attempted, 5);
      assert.equal(row.observed, 0);
      assert.equal(row.mentionRate, null);
      assert.equal(row.citationRate, null);
      assert.deepEqual(row.surfaces, []);
    }
    assert.equal(body.scan.engineRuns.length, 12);
    assert.ok(body.scan.engineRuns.every((run) => run.model === "test/model"));
  }, (body) => reply(body, { model: "test/model" }));
});

for (const returnedModel of ["test/model", "test/unconfigured"]) {
  test(`one substituted provider response (${returnedModel}) cannot count as complete model coverage`, async () => {
    let secondCalls = 0;
    await setup("essential", async (_db, requests) => {
      const response = await POST(request(person));
      assert.equal(response.status, 201);
      const body = await read(response);
      assert.equal(requests.length, 13);
      assert.equal(body.scan.engineRuns.length, 12);
      assert.ok(body.scan.engineRuns.some((run) => run.model === "test/second"));
      assert.equal(body.scan.actualVisibilityStatus, "partial");
      assert.equal(body.scan.insights!.scope.coverageComplete, false);
    }, (body) => {
      if (body.model === "test/second" && ++secondCalls === 2)
        return reply(body, { model: returnedModel });
      return reply(body);
    });
  });
}

for (const returnedModel of ["test/model", "test/unconfigured"]) {
  test(`advanced agreement accounts for each configured model once when a provider substitutes ${returnedModel}`, async () => {
    let secondCalls = 0;
    await setup("growth", async (_db, requests) => {
      const response = await POST(request(person));
      assert.equal(response.status, 201);
      const { scan } = await read(response);
      assert.equal(requests.length, 37);
      const insights = scan.insights!;
      const models = insights.scope.models;
      const rows = insights.advanced!.agreement;
      assert.equal(rows.length, 11);
      const affected = rows.filter((row) => row.unavailable.includes("test/second"));
      assert.equal(affected.length, 1);
      const row = affected[0];
      assert.equal(row.unavailable.includes("test/model"), returnedModel === "test/model");
      assert.equal(row.mentionedBy.includes("test/model"), returnedModel !== "test/model");
      for (const item of rows) {
        const listed = [...item.mentionedBy, ...item.absentFrom, ...item.unavailable];
        assert.equal(listed.length, models.length);
        assert.deepEqual(listed.sort(), [...models].sort());
      }
      assert.ok(scan.engineRuns.some((run) => run.promptId === row.promptId && run.model === returnedModel));
    }, (body) => {
      if (body.model === "test/second" && ++secondCalls === 2)
        return reply(body, { model: returnedModel });
      return reply(body);
    });
  });
}

for (const returnedModel of ["test/model", "test/unconfigured"]) {
  test(`engine summaries retain configured denominators when a provider substitutes ${returnedModel}`, async () => {
    let secondCalls = 0;
    await setup("growth", async (_db, requests) => {
      const response = await POST(request(person));
      assert.equal(response.status, 201);
      const { scan } = await read(response);
      const insights = scan.insights!;
      assert.equal(requests.length, 37);
      assert.equal(scan.engineRuns.length, 36);
      assert.equal(insights.scope.coverageComplete, false);
      assert.deepEqual(insights.byEngine.map((row) => row.model), insights.scope.models);
      assert.ok(insights.byEngine.every((row) => row.attempted === 11));
      const first = insights.byEngine.find((row) => row.model === "test/model")!;
      const second = insights.byEngine.find((row) => row.model === "test/second")!;
      assert.equal(first.observed, returnedModel === "test/model" ? 10 : 11);
      assert.equal(first.mentionRate, 100);
      assert.equal(second.observed, 10);
      assert.equal(second.mentionRate, 0);
      assert.equal(second.citationRate, 100);
      assert.ok(scan.engineRuns.some((run) => run.model === returnedModel));
    }, (body) => {
      if (body.model === "test/second" && ++secondCalls === 2)
        return reply(body, { model: returnedModel });
      return reply(body);
    });
  });
}

test("concurrent analyses of one project reserve only one running job", async () => {
  await setup("essential", async (db, requests) => {
    const responses = await Promise.all([POST(request(person)), POST(request(person))]);
    assert.deepEqual(responses.map((result) => result.status).sort(), [201, 429]);
    assert.equal(requests.length, 13); assert.equal(count(db, "scans"), 1);
  });
});

test("scheduled monitoring shares the manual monthly allowance and delays exhausted jobs", async () => {
  await setup("essential", async (db, requests) => {
    for (let i = 0; i < 4; i++) await POST(request({ input: "Retail analytics", kind: "topic", context: `sample ${i}` }));
    state.env.MONITORING_SECRET = secret;
    db.exec("UPDATE monitoring_schedules SET next_run_at=datetime('now','-1 hour')");
    const response = await (await tick()).json() as { status: string };
    assert.equal(response.status, "scan_limit"); assert.equal(requests.length, 48);
    assert.equal(db.prepare("SELECT next_run_at > datetime('now') AS later FROM monitoring_schedules").get()?.later, 1);
    assert.equal((await (await tick()).json() as { processed: number }).processed, 0);
  });
});
