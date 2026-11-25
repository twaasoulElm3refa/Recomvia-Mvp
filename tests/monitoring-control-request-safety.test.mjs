import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/monitoring/control/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let authenticated = true;
let changes = 0;
let entitlements = 0;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/app/auth") return {
    getAuthenticatedUser: async () => authenticated ? { userId: "owner" } : null,
  };
  if (name === "@/db/product") return {
    getEntitlementForUser: async () => { entitlements++; return { canMonitor: true }; },
  };
  if (name === "@/db/monitoring-controls") return {
    MonitoringControlError: class MonitoringControlError extends Error {},
    setMonitoringScheduleState: async () => { changes++; return { status: "paused" }; },
  };
  throw new Error("Unexpected import " + name);
}, loaded, loaded.exports);
const { POST } = loaded.exports;
const valid = JSON.stringify({ scheduleId: "schedule_1", action: "pause" });
const request = (body = valid, headers = {}) => new Request("https://recomvia.test/api/monitoring/control", {
  method: "POST", body,
  headers: { Origin: "https://recomvia.test", "Content-Type": "application/json", ...headers },
});

test("monitor controls require authentication and same origin", async () => {
  authenticated = false;
  assert.equal((await POST(request())).status, 401);
  authenticated = true;
  assert.equal((await POST(request(valid, { Origin: "https://evil.test" }))).status, 403);
  assert.equal(changes, 0);
});

test("monitor controls reject JSON lookalikes and malformed lengths", async () => {
  for (const [req, status] of [
    [request(valid, { "Content-Type": "application/jsonp" }), 415],
    [request(valid, { "Content-Type": "text/plain" }), 415],
    [request(valid, { "Content-Length": "-1" }), 400],
    [request(valid, { "Content-Length": "Infinity" }), 400],
    [request(valid, { "Content-Length": "301" }), 413],
  ]) {
    const response = await POST(req);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(changes, 0);
  assert.equal(entitlements, 0);
});

test("monitor controls enforce streamed UTF-8 byte limits before writes", async () => {
  for (const body of ["x".repeat(301), JSON.stringify({ scheduleId: "🌐".repeat(90), action: "pause" })]) {
    assert.equal((await POST(request(body))).status, 413);
  }
  for (const body of ["null", "[]", "{bad"]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(changes, 0);
});

test("valid charset JSON still invokes the existing schedule control once", async () => {
  const response = await POST(request(valid, { "Content-Type": "application/json; charset=utf-8" }));
  assert.equal(response.status, 200);
  assert.equal(changes, 1);
  assert.equal(entitlements, 0);
});


function streamRequest(body) {
  return new Request("https://recomvia.test/api/monitoring/control", {
    method: "POST", duplex: "half", body,
    headers: { Origin: "https://recomvia.test", "Content-Type": "application/json" },
  });
}

test("monitor control upload deadline covers partial chunks and slow cancellation before any schedule changes", async (t) => {
  const before = [changes, entitlements];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let controller;
  let cancelled = false;
  let finishCleanup;
  const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
  const body = new ReadableStream({
    start(value) {
      controller = value;
      value.enqueue(new TextEncoder().encode('{"scheduleId":'));
    },
    cancel() { cancelled = true; return cleanup; },
  });
  const pending = POST(streamRequest(body));
  try {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(4999);
    assert.equal(cancelled, false);
    controller.enqueue(new TextEncoder().encode('"schedule_1","action":"resume"}'));
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(1);
    const response = await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve(null)))]);
    assert.equal(cancelled, true);
    assert.ok(response, "deadline must not await upstream cancellation");
    assert.equal(response.status, 408);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(body.locked, false);
    assert.deepEqual([changes, entitlements], before);
  } finally {
    if (!cancelled) controller.close();
    finishCleanup();
    await pending;
    t.mock.timers.reset();
  }
});

test("monitor control cancels malformed UTF-8 and oversized uploads without awaiting cleanup", async () => {
  const before = [changes, entitlements];
  for (const [bytes, status] of [[new Uint8Array([0xff]), 400], [new Uint8Array(301), 413]]) {
    let controller;
    let cancelled = false;
    let finishCleanup;
    const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
    const body = new ReadableStream({
      start(value) { controller = value; value.enqueue(bytes); },
      cancel() { cancelled = true; return cleanup; },
    });
    const pending = POST(streamRequest(body));
    try {
      const response = await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve(null)))]);
      assert.equal(cancelled, true);
      assert.ok(response, "rejected upload must not await upstream cancellation");
      assert.equal(response.status, status);
      assert.equal(body.locked, false);
      assert.deepEqual([changes, entitlements], before);
    } finally {
      if (!cancelled) controller.close();
      finishCleanup();
      await pending;
    }
  }
});

test("completed streamed resume clears the deadline and invokes entitlement and control once", async (t) => {
  const before = [changes, entitlements];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"scheduleId":"schedule_1",'));
        controller.enqueue(new TextEncoder().encode('"action":"resume"}'));
        controller.close();
      },
    });
    const response = await POST(streamRequest(body));
    assert.equal(response.status, 200);
    assert.equal(body.locked, false);
    t.mock.timers.tick(5000);
    assert.deepEqual([changes, entitlements], before.map((value) => value + 1));
  } finally {
    t.mock.timers.reset();
  }
});
