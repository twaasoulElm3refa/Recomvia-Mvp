import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/support/tickets/[id]/reply/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const env = { RECOMVIA_ADMIN_USER_ID: "admin-123" };
let user = { userId: "admin-123" };
let identityError = null;
const writes = [];
let found = true;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "cloudflare:workers") return { env };
  if (name === "@/app/auth") return { getAuthenticatedUser: async () => {
    if (identityError) throw identityError;
    return user;
  } };
  if (name === "@/db/support") return {
    replyToSupportTicket: async (...args) => { writes.push(args); return found; },
  };
  throw new Error("Unexpected import: " + name);
}, loaded, loaded.exports);
const { POST } = loaded.exports;

function request(body, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (options.origin !== null) headers.Origin = options.origin ?? "https://recomvia.test";
  return new Request("https://recomvia.test/api/support/tickets/12/reply", {
    method: "POST", headers, body,
  });
}
const context = (id = "12") => ({ params: Promise.resolve({ id }) });
const valid = JSON.stringify({ reply: "A helpful, complete reply." });

test("admin support replies reject non-admin identities before any writes", async () => {
  const before = writes.length;
  user = null;
  assert.equal((await POST(request(valid), context())).status, 404);
  user = { userId: "customer" };
  assert.equal((await POST(request(valid), context())).status, 404);
  user = { userId: "admin-123" };
  assert.equal(writes.length, before);
});

test("admin support replies require same-origin JSON and private non-sniffable responses", async () => {
  const before = writes.length;
  for (const [req, expected] of [
    [request(valid, { origin: null }), 403],
    [request(valid, { origin: "https://evil.example" }), 403],
    [request(valid, { headers: { "Content-Type": "text/plain" } }), 415],
    [request(valid, { headers: { "Content-Type": "application/jsonp" } }), 415],
  ]) {
    const response = await POST(req, context());
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(writes.length, before);
});

test("admin reply endpoint validates IDs and non-object or invalid JSON", async () => {
  const before = writes.length;
  for (const id of ["0", "-1", "1e2", "0x10", "9007199254740991", "1111111111111111"]) {
    assert.equal((await POST(request(valid), context(id))).status, 400, id);
  }
  for (const body of ["null", "[]", "123", '"text"', "{bad", JSON.stringify({ reply: 7 })]) {
    const response = await POST(request(body), context());
    assert.equal(response.status, body.includes("reply") ? 400 : 400, body);
  }
  assert.equal(writes.length, before);
});

test("admin reply endpoint rejects declared and streamed byte overflows", async () => {
  const before = writes.length;
  const declared = await POST(request(valid, { headers: { "Content-Length": "16385" } }), context());
  assert.equal(declared.status, 413);
  const streamed = await POST(request("x".repeat(16_385)), context());
  assert.equal(streamed.status, 413);
  const multibyte = await POST(request(JSON.stringify({ reply: "🌐".repeat(4_100) })), context());
  assert.equal(multibyte.status, 413);
  assert.equal(writes.length, before);
});

test("valid admin reply saves once and keeps the existing success contract", async () => {
  const response = await POST(request(valid, { headers: { "Content-Type": "application/json; charset=utf-8" } }), context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "answered" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(writes.at(-1), [12, "A helpful, complete reply.", "admin-123"]);
  found = false;
  const missing = await POST(request(valid), context());
  assert.equal(missing.status, 404);
  found = true;
});

test("admin reply rejects ambiguous declared lengths before any writes", async () => {
  const before = writes.length;
  for (const length of ["-1", "+1", "01", "1.5", "1e2", "0x10", "3, 3", "Infinity", "NaN", ""]) {
    const response = await POST(request(valid, { headers: { "Content-Length": length } }), context());
    assert.equal(response.status, 400, length);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(writes.length, before);
});

test("admin reply rejects malformed UTF-8 but accepts chunked Arabic replies", async () => {
  const before = writes.length;
  const prefix = new TextEncoder().encode('{"reply":"A valid reply ');
  const invalid = new Uint8Array([...prefix, 0xff, ...new TextEncoder().encode(' inside."}')]);
  const malformed = await POST(request(invalid), context());
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("Cache-Control"), "no-store");
  assert.equal(writes.length, before);

  const reply = "هذا رد واضح ومفيد بشأن التقرير";
  const encoded = new TextEncoder().encode(JSON.stringify({ reply }));
  const firstArabicByte = encoded.findIndex((byte) => byte >= 0x80);
  assert.ok(firstArabicByte > 0);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded.slice(0, firstArabicByte + 1));
      controller.enqueue(encoded.slice(firstArabicByte + 1));
      controller.close();
    },
  });
  const response = await POST(new Request("https://recomvia.test/api/support/tickets/12/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recomvia.test" },
    body: stream,
    duplex: "half",
  }), context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(writes.length, before + 1);
  assert.deepEqual(writes.at(-1), [12, reply, "admin-123"]);
});


test("admin replies reject invisible controls and bidi overrides without writing customer-visible text", async () => {
  const before = writes.length;
  const invalid = [
    ["NUL", "Hello\u0000 there"],
    ["escape", "Hello\u001b there"],
    ["vertical tab", "Hello\u000b there"],
    ["delete", "Hello\u007f there"],
    ["RTL override", "Report\u202e.html"],
    ["LTR isolate", "Hello\u2066 there"],
    ["pop directional format", "Hello\u202c there"],
    ["Arabic letter mark", "Hello\u061c there"],
    ["left-to-right mark", "Hello\u200e there"],
    ["right-to-left mark", "Hello\u200f there"],
  ];
  for (const [label, reply] of invalid) {
    const response = await POST(request(JSON.stringify({ reply })), context());
    assert.equal(response.status, 400, label);
    assert.equal(response.headers.get("Cache-Control"), "no-store", label);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", label);
    assert.equal(writes.length, before, label);
  }
});

test("admin replies preserve ordinary Arabic multiline formatting", async () => {
  const reply = "مرحبًا،\nشكرًا لتواصلك معنا.\r\nسوف نراجع التقرير\tونرد عليك قريبًا.";
  const before = writes.length;
  const response = await POST(request(JSON.stringify({ reply })), context());
  assert.equal(response.status, 200);
  assert.equal(writes.length, before + 1);
  assert.deepEqual(writes.at(-1), [12, reply, "admin-123"]);
});


function streamRequest(body) {
  return new Request("https://recomvia.test/api/support/tickets/12/reply", {
    method: "POST", duplex: "half", body,
    headers: { Origin: "https://recomvia.test", "Content-Type": "application/json" },
  });
}

test("admin reply upload deadline is not extended by chunks or slow cancellation", async (t) => {
  const before = writes.length;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let controller;
  let cancelled = false;
  let finishCleanup;
  const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
  const body = new ReadableStream({
    start(value) {
      controller = value;
      value.enqueue(new TextEncoder().encode(valid.slice(0, 12)));
    },
    cancel() { cancelled = true; return cleanup; },
  });
  const pending = POST(streamRequest(body), context());
  try {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(4999);
    assert.equal(cancelled, false);
    controller.enqueue(new TextEncoder().encode(valid.slice(12)));
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(1);
    const response = await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve(null)))]);
    assert.equal(cancelled, true);
    assert.ok(response, "deadline must not await upstream cancellation");
    assert.equal(response.status, 408);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(body.locked, false);
    assert.equal(writes.length, before);
  } finally {
    if (!cancelled) controller.close();
    finishCleanup();
    await pending;
    t.mock.timers.reset();
  }
});

test("admin reply rejects malformed and oversized streams without waiting for cleanup", async () => {
  const before = writes.length;
  for (const [bytes, status] of [[new Uint8Array([0xff]), 400], [new Uint8Array(16385), 413]]) {
    let controller;
    let cancelled = false;
    let finishCleanup;
    const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
    const body = new ReadableStream({
      start(value) { controller = value; value.enqueue(bytes); },
      cancel() { cancelled = true; return cleanup; },
    });
    const pending = POST(streamRequest(body), context());
    try {
      const response = await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve(null)))]);
      assert.equal(cancelled, true);
      assert.ok(response, "invalid upload must not await upstream cancellation");
      assert.equal(response.status, status);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(body.locked, false);
      assert.equal(writes.length, before);
    } finally {
      if (!cancelled) controller.close();
      finishCleanup();
      await pending;
    }
  }
});

test("completed Arabic admin reply clears its deadline and saves exactly once", async (t) => {
  const before = writes.length;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const reply = "شكرًا لتواصلك معنا، سنراجع التقرير.";
    const req = request(JSON.stringify({ reply }));
    const response = await POST(req, context());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, status: "answered" });
    assert.equal(req.body.locked, false);
    t.mock.timers.tick(5000);
    assert.equal(writes.length, before + 1);
    assert.deepEqual(writes.at(-1), [12, reply, "admin-123"]);
  } finally {
    t.mock.timers.reset();
  }
});

test("staff reply identity outages are private, prevent body access and writes, and permit recovery", async () => {
  const before = writes.length;
  const req = request(valid);
  Object.defineProperty(req, "body", { get() { throw new Error("reply body must not be read"); } });
  const inaccessibleContext = {};
  Object.defineProperty(inaccessibleContext, "params", { get() { throw new Error("ticket selector must not be read"); } });
  identityError = new Error("private staff identity diagnostic");
  try {
    const response = await POST(req, inaccessibleContext);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Support is temporarily unavailable." });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(writes.length, before);
  } finally {
    identityError = null;
  }
  const reply = "شكرًا لتواصلك معنا بشأن تقرير Recomvia.";
  const recovered = await POST(request(JSON.stringify({ reply })), context());
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { ok: true, status: "answered" });
  assert.equal(writes.length, before + 1);
  assert.deepEqual(writes.at(-1), [12, reply, "admin-123"]);
});
