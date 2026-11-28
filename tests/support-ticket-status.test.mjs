import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/support/tickets/status/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let databaseLookups = 0;
const fixture = {
  publicId: "RCV-TEST123-ABCDEF", status: "answered", humanReply: "A documented reply",
  createdAt: "2026-11-28 05:00:00", updatedAt: "2026-11-28 05:10:00", answeredAt: "2026-11-28 05:10:00",
};
let storageResult = fixture;
let storageUnavailable = false;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/db/support") return {
    findTicketForRequester: async (reference, keyHash) => {
      databaseLookups++;
      assert.equal(reference, fixture.publicId);
      assert.equal(keyHash.length, 64);
      if (storageUnavailable) throw new Error("private database diagnostics");
      return storageResult;
    },
  };
  throw new Error("Unexpected import: " + name);
}, loaded, loaded.exports);

const { POST } = loaded.exports;
const accessKey = "abcdef".repeat(6);
function request(body, origin = "https://recomvia.test") {
  return new Request("https://recomvia.test/api/support/tickets/status", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body,
  });
}

test("ticket status endpoint rejects non-object JSON without lookup or internal errors", async () => {
  for (const body of ["null", "[]", "17", '"text"', "{bad"]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(databaseLookups, 0);
});

test("ticket status lookup rejects invalid keys and off-origin requests", async () => {
  const valid = JSON.stringify({ reference: fixture.publicId, accessKey });
  const missingOrigin = await POST(new Request("https://recomvia.test/api/support/tickets/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: valid,
  }));
  const blankOrigin = await POST(request(valid, ""));
  const opaqueOrigin = await POST(request(valid, "null"));
  const crossOrigin = await POST(request(valid, "https://evil.example"));
  for (const response of [missingOrigin, blankOrigin, opaqueOrigin, crossOrigin]) {
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  const invalid = await POST(request(JSON.stringify({ reference: fixture.publicId, accessKey: "nothex".repeat(6) })));
  assert.equal(invalid.status, 404);
  assert.equal(databaseLookups, 0);
});

test("valid tracking key returns only the private ticket status with no-store", async () => {
  const response = await POST(request(JSON.stringify({ reference: fixture.publicId.toLowerCase(), accessKey })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), fixture);
  assert.equal(databaseLookups, 1);
});

test("ticket status requires JSON and returns non-sniffable private errors", async () => {
  const valid = JSON.stringify({ reference: fixture.publicId, accessKey });
  const before = databaseLookups;
  for (const type of ["text/plain", "application/jsonp", ""]) {
    const headers = { Origin: "https://recomvia.test" };
    if (type) headers["Content-Type"] = type;
    const response = await POST(new Request("https://recomvia.test/api/support/tickets/status", {
      method: "POST", headers, body: valid,
    }));
    assert.equal(response.status, 415, type);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(databaseLookups, before);
});

test("ticket status rejects declared and streamed overflow before database lookup", async () => {
  const valid = JSON.stringify({ reference: fixture.publicId, accessKey });
  const before = databaseLookups;
  const declared = await POST(new Request("https://recomvia.test/api/support/tickets/status", {
    method: "POST", headers: { Origin: "https://recomvia.test", "Content-Type": "application/json", "Content-Length": "513" },
    body: valid,
  }));
  assert.equal(declared.status, 413);
  const streamed = await POST(request("x".repeat(513)));
  assert.equal(streamed.status, 413);
  const unicode = await POST(request(JSON.stringify({ reference: "🌐".repeat(150), accessKey })));
  assert.equal(unicode.status, 413);
  assert.equal(databaseLookups, before);
});

test("ticket status accepts bounded JSON with charset without caching the private reply", async () => {
  const valid = JSON.stringify({ reference: fixture.publicId, accessKey });
  const before = databaseLookups;
  const response = await POST(new Request("https://recomvia.test/api/support/tickets/status", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Origin: "https://recomvia.test" },
    body: valid,
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(await response.json(), fixture);
  assert.equal(databaseLookups, before + 1);
});

test("ticket status rejects ambiguous content lengths and malformed UTF-8 before any lookup", async () => {
  const valid = JSON.stringify({ reference: fixture.publicId, accessKey });
  const before = databaseLookups;
  for (const length of ["-1", "+1", "01", "1.5", "1e2", "0x10", "3, 3", "NaN"]) {
    const response = await POST(new Request("https://recomvia.test/api/support/tickets/status", {
      method: "POST",
      headers: { Origin: "https://recomvia.test", "Content-Type": "application/json", "Content-Length": length },
      body: valid,
    }));
    assert.equal(response.status, 400, length);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }

  // The invalid byte is inside an otherwise valid JSON string; replacement decoding
  // would have accepted it and queried the private ticket.
  const prefix = new TextEncoder().encode(`{"reference":"${fixture.publicId}","accessKey":"${accessKey}","note":"`);
  const bytes = new Uint8Array([...prefix, 0xff, ...new TextEncoder().encode('"}')]);
  const malformed = await POST(request(bytes));
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("Cache-Control"), "no-store");
  assert.equal(databaseLookups, before);
});

test("ticket status accepts valid multibyte UTF-8 split between stream chunks", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({
    reference: fixture.publicId,
    accessKey,
    note: "مرحبا",
  }));
  const boundary = bytes.findIndex((byte) => byte === 0xd9 || byte === 0xd8);
  assert.ok(boundary > 0);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, boundary + 1));
      controller.enqueue(bytes.slice(boundary + 1));
      controller.close();
    },
  });
  const before = databaseLookups;
  const response = await POST(new Request("https://recomvia.test/api/support/tickets/status", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recomvia.test" },
    body,
    duplex: "half",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), fixture);
  assert.equal(databaseLookups, before + 1);
});


function streamRequest(body) {
  return new Request("https://recomvia.test/api/support/tickets/status", {
    method: "POST", duplex: "half", body,
    headers: { Origin: "https://recomvia.test", "Content-Type": "application/json" },
  });
}

test("ticket status upload deadline is not extended by partial chunks or slow cancellation", async (t) => {
  const before = databaseLookups;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let controller;
  let cancelled = false;
  let finishCleanup;
  const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
  const body = new ReadableStream({
    start(value) {
      controller = value;
      value.enqueue(new TextEncoder().encode('{"reference":'));
    },
    cancel() { cancelled = true; return cleanup; },
  });
  const pending = POST(streamRequest(body));
  try {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(4999);
    assert.equal(cancelled, false);
    controller.enqueue(new TextEncoder().encode(JSON.stringify(fixture.publicId) + ',"accessKey":' + JSON.stringify(accessKey) + '}'));
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(1);
    const response = await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve(null)))]);
    assert.equal(cancelled, true);
    assert.ok(response, "deadline must not await upstream cancellation");
    assert.equal(response.status, 408);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(body.locked, false);
    assert.equal(databaseLookups, before);
  } finally {
    if (!cancelled) controller.close();
    finishCleanup();
    await pending;
    t.mock.timers.reset();
  }
});

test("ticket status cancels malformed and oversized streams without waiting for cleanup", async () => {
  const before = databaseLookups;
  for (const [bytes, status] of [[new Uint8Array([0xff]), 400], [new Uint8Array(513), 413]]) {
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
      assert.ok(response, "invalid upload must not await upstream cancellation");
      assert.equal(response.status, status);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(body.locked, false);
      assert.equal(databaseLookups, before);
    } finally {
      if (!cancelled) controller.close();
      finishCleanup();
      await pending;
    }
  }
});

test("completed status upload clears its deadline and preserves authorized lookup", async (t) => {
  const before = databaseLookups;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const req = request(JSON.stringify({ reference: fixture.publicId, accessKey }));
    const response = await POST(req);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), fixture);
    assert.equal(req.body.locked, false);
    t.mock.timers.tick(5000);
    assert.equal(databaseLookups, before + 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("ticket tracking exposes only its public response contract even if storage returns extra columns", async () => {
  const humanReply = "تمت المراجعة — reviewed";
  storageResult = {
    ...fixture, humanReply,
    requesterEmail: "private@example.test",
    accessKeyHash: "private hash",
    authenticatedUserId: "private user",
    answeredBy: "private staff",
  };
  try {
    const response = await POST(request(JSON.stringify({ reference: fixture.publicId, accessKey })));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(await response.json(), { ...fixture, humanReply });
  } finally {
    storageResult = fixture;
  }
});

test("ticket tracking rejects mismatched storage identity and recovers privately after an outage", async () => {
  const valid = JSON.stringify({ reference: fixture.publicId, accessKey });
  const before = databaseLookups;
  try {
    for (const result of [null, { ...fixture, publicId: "RCV-OTHER-ABCDEF" }]) {
      storageResult = result;
      const response = await POST(request(valid));
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await response.json(), { error: "Ticket not found." });
    }
    storageUnavailable = true;
    const response = await POST(request(valid));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(await response.json(), { error: "Support status is temporarily unavailable." });
  } finally {
    storageUnavailable = false;
    storageResult = fixture;
  }
  const recovered = await POST(request(valid));
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), fixture);
  assert.equal(databaseLookups, before + 4);
});


test("header-rejected ticket tracking uploads are cancelled without reads or private lookups", async () => {
  const before = databaseLookups;
  const validHeaders = { Origin: "https://recomvia.test", "Content-Type": "application/json" };
  const cases = [
    [{ "Content-Type": "application/json" }, 403],
    [{ ...validHeaders, Origin: "https://evil.example" }, 403],
    [{ ...validHeaders, "Content-Type": "text/plain" }, 415],
    [{ ...validHeaders, "Content-Length": "01" }, 400],
    [{ ...validHeaders, "Content-Length": "513" }, 413],
  ];
  for (const [headers, status] of cases) {
    let reads = 0;
    let cancelled = false;
    let finishCleanup;
    const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
    const body = new ReadableStream({
      pull() { reads++; },
      cancel() { cancelled = true; return cleanup; },
    }, { highWaterMark: 0 });
    const pending = POST(new Request("https://recomvia.test/api/support/tickets/status", {
      method: "POST", duplex: "half", headers, body,
    }));
    try {
      const response = await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve(null)))]);
      assert.ok(response, "header rejection must not await upstream cancellation");
      assert.equal(response.status, status);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(cancelled, true);
      assert.equal(reads, 0);
      assert.equal(body.locked, false);
      assert.equal(databaseLookups, before);
    } finally {
      finishCleanup();
      await pending;
    }
  }
});

test("ticket tracking suppresses cancellation failures and preserves Arabic reply recovery", async () => {
  const before = databaseLookups;
  const body = new ReadableStream({
    cancel() { return Promise.reject(new Error("private upload cleanup diagnostic")); },
  }, { highWaterMark: 0 });
  const response = await POST(new Request("https://recomvia.test/api/support/tickets/status", {
    method: "POST", duplex: "half", body,
    headers: { Origin: "https://recomvia.test", "Content-Type": "text/plain" },
  }));
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "JSON content type required." });
  assert.equal(databaseLookups, before);
  const humanReply = "تمت مراجعة التقرير، شكرًا لتواصلك معنا.";
  storageResult = { ...fixture, humanReply };
  try {
    const recovered = await POST(request(JSON.stringify({ reference: fixture.publicId, accessKey })));
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), { ...fixture, humanReply });
    assert.equal(databaseLookups, before + 1);
  } finally {
    storageResult = fixture;
  }
});
