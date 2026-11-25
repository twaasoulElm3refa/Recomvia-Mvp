import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/assistant/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let searched = [];
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((specifier) => {
  if (specifier === "@/lib/knowledge-base") return {
    searchKnowledge: (question) => {
      searched.push(question);
      return { answered: true, answer: "Approved knowledge only", confidence: 100 };
    },
  };
  throw new Error("Unexpected import " + specifier);
}, loaded, loaded.exports);
const { POST } = loaded.exports;
function request(body, headers = {}) {
  return new Request("https://recomvia.test/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recomvia.test", ...headers },
    body,
  });
}

test("assistant accepts Arabic and English questions with no-store headers", async () => {
  searched = [];
  for (const question of ["ما هي باقات Recomvia؟", "What does Essential include?"]) {
    const response = await POST(request(JSON.stringify({ question })));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal((await response.json()).answered, true);
  }
  assert.deepEqual(searched, ["ما هي باقات Recomvia؟", "What does Essential include?"]);
});

test("assistant rejects cross-site calls and non-JSON before knowledge lookup", async () => {
  searched = [];
  assert.equal((await POST(request('{"question":"Valid text"}', { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(request('{"question":"Valid text"}', { "Content-Type": "text/plain" }))).status, 415);
  assert.equal(searched.length, 0);
});

test("assistant rejects invalid shapes, malformed JSON and oversized requests", async () => {
  searched = [];
  for (const payload of ["null", "[]", '"text"', "23", "{bad", '{"question":1}', '{"question":"a"}']) {
    const response = await POST(request(payload));
    assert.equal(response.status, 400, payload);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal((await POST(request(JSON.stringify({ question: "hello" }), { "Content-Length": "4000" }))).status, 413);
  assert.equal((await POST(request(JSON.stringify({ question: "hello", filler: "x".repeat(3500) })))).status, 413);
  assert.equal(searched.length, 0);
});

test("assistant enforces an exact JSON media type and preserves charset compatibility", async () => {
  searched = [];
  const valid = JSON.stringify({ question: "هل يشمل الفحص المجاني التقرير؟" });
  for (const contentType of ["application/jsonp", "application/json-patch+json", "text/json", ""]) {
    const response = await POST(request(valid, { "Content-Type": contentType }));
    assert.equal(response.status, 415, contentType);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(searched.length, 0);
  assert.equal((await POST(request(valid, { "Content-Type": "application/json; charset=utf-8" }))).status, 200);
  assert.deepEqual(searched, ["هل يشمل الفحص المجاني التقرير؟"]);
});

test("assistant rejects malformed declared lengths and invalid UTF-8 before knowledge lookup", async () => {
  searched = [];
  const valid = JSON.stringify({ question: "What does Essential include?" });
  for (const value of ["-1", "Infinity", "NaN", "1e3", "301.0", ""]) {
    const response = await POST(request(valid, { "Content-Length": value }));
    assert.equal(response.status, 400, value);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal((await POST(request(valid, { "Content-Length": "3001" }))).status, 413);
  const badUtf8 = new Request("https://recomvia.test/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recomvia.test" },
    body: new Uint8Array([0x7b, 0xff, 0x7d]),
  });
  assert.equal((await POST(badUtf8)).status, 400);
  assert.equal(searched.length, 0);
});

test("assistant rejects ambiguous decimal content lengths before knowledge lookup", async () => {
  searched = [];
  const valid = JSON.stringify({ question: "ما هي باقات Recomvia؟" });
  for (const value of ["00", "01", "00042", "09", "+42", "-0"]) {
    const response = await POST(request(valid, { "Content-Length": value }));
    assert.equal(response.status, 400, value);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.deepEqual(searched, []);
  const canonical = String(new TextEncoder().encode(valid).byteLength);
  assert.equal((await POST(request(valid, { "Content-Length": canonical }))).status, 200);
  assert.deepEqual(searched, ["ما هي باقات Recomvia؟"]);
});

test("assistant continues accepting Arabic split across UTF-8 stream boundaries", async () => {
  searched = [];
  const valid = JSON.stringify({ question: "كيف أُحسّن ظهور الموقع؟" });
  const bytes = new TextEncoder().encode(valid);
  const firstArabicByte = bytes.indexOf(0xd9);
  assert.ok(firstArabicByte > 0);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, firstArabicByte + 1));
      controller.enqueue(bytes.subarray(firstArabicByte + 1));
      controller.close();
    },
  });
  const response = await POST(new Request("https://recomvia.test/api/assistant", {
    method: "POST", body, duplex: "half",
    headers: { Origin: "https://recomvia.test", "Content-Type": "application/json; charset=utf-8" },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(searched, ["كيف أُحسّن ظهور الموقع؟"]);
});

test("assistant cancels rejected streams without waiting for upstream cleanup", async () => {
  searched = [];
  for (const [chunk, status] of [
    [new Uint8Array([0x7b, 0xff]), 400],
    [new Uint8Array(3001), 413],
  ]) {
    let cancelled = false;
    let finishCleanup;
    const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
    const body = new ReadableStream({
      start(controller) { controller.enqueue(chunk); },
      cancel() {
        cancelled = true;
        return cleanup;
      },
    });
    const responsePromise = POST(new Request("https://recomvia.test/api/assistant", {
      method: "POST", body, duplex: "half",
      headers: { Origin: "https://recomvia.test", "Content-Type": "application/json" },
    }));
    try {
      // Local streams settle via microtasks. Upstream cleanup remains pending.
      const response = await Promise.race([
        responsePromise,
        new Promise((resolve) => setImmediate(() => resolve(null))),
      ]);
      assert.equal(cancelled, true);
      assert.ok(response, "rejection must not wait for cancellation to settle");
      assert.equal(response.status, status);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(body.locked, false);
    } finally {
      finishCleanup();
      await responsePromise;
    }
  }
  assert.deepEqual(searched, []);
});

test("assistant handles rejected upstream cancellation without leaking an error", async () => {
  searched = [];
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([0xff])); },
    cancel() { return Promise.reject(new Error("upstream cleanup failed")); },
  });
  const response = await POST(new Request("https://recomvia.test/api/assistant", {
    method: "POST", body, duplex: "half",
    headers: { Origin: "https://recomvia.test", "Content-Type": "application/json" },
  }));
  assert.equal(response.status, 400);
  assert.equal(body.locked, false);
  assert.deepEqual(searched, []);
});

test("assistant applies one upload deadline even when partial chunks arrive", async (t) => {
  searched = [];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let controller;
  let cancelled = false;
  let finishCleanup;
  const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
  const body = new ReadableStream({
    start(value) {
      controller = value;
      value.enqueue(new TextEncoder().encode('{"question":"'));
    },
    cancel() {
      cancelled = true;
      return cleanup;
    },
  });
  const pending = POST(new Request("https://recomvia.test/api/assistant", {
    method: "POST", body, duplex: "half",
    headers: { Origin: "https://recomvia.test", "Content-Type": "application/json" },
  }));
  try {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(4999);
    assert.equal(cancelled, false);
    controller.enqueue(new TextEncoder().encode('Valid text"}'));
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(1);
    const response = await Promise.race([
      pending,
      new Promise((resolve) => setImmediate(() => resolve(null))),
    ]);
    assert.equal(cancelled, true);
    assert.ok(response, "deadline must not wait for upstream cleanup");
    assert.equal(response.status, 408);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(body.locked, false);
    assert.deepEqual(searched, []);
  } finally {
    if (!cancelled) controller.close();
    finishCleanup();
    await pending;
    t.mock.timers.reset();
  }
});

test("assistant clears the upload deadline after a complete valid request", async (t) => {
  searched = [];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const response = await POST(request(JSON.stringify({ question: "Valid text" })));
  assert.equal(response.status, 200);
  t.mock.timers.tick(5000);
  assert.deepEqual(searched, ["Valid text"]);
  t.mock.timers.reset();
});
