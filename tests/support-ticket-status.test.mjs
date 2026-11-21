import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/support/tickets/status/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let databaseLookups = 0;
const fixture = { publicId: "RCV-TEST123-ABCDEF", status: "answered", humanReply: "A documented reply" };
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/db/support") return {
    findTicketForRequester: async (reference, keyHash) => {
      databaseLookups++;
      assert.equal(reference, fixture.publicId);
      assert.equal(keyHash.length, 64);
      return fixture;
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
  const crossOrigin = await POST(request(valid, "https://evil.example"));
  assert.equal(crossOrigin.status, 403);
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
