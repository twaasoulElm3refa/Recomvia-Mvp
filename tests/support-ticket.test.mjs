import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(resolve("app/api/support/tickets/route.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "app/api/support/tickets/route.ts",
}).outputText;
const created = [];
class MockSupportRateLimitError extends Error {}
let simulateRateLimit = false;
const compiledModule = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/app/auth") return { getAuthenticatedUser: async () => null };
  if (name === "@/db/support") return { SupportRateLimitError: MockSupportRateLimitError, createSupportTicket: async (ticket) => { if (simulateRateLimit) throw new MockSupportRateLimitError(); created.push(ticket); } };
  throw new Error("Unexpected dependency: " + name);
}, compiledModule, compiledModule.exports);
const { POST } = compiledModule.exports;
const request = (body, extraHeaders = {}) => new Request("https://recomvia.test/api/support/tickets", {
  method: "POST", headers: { "content-type": "application/json", ...extraHeaders }, body,
});

test("support rejects invalid JSON shapes without creating tickets", async () => {
  for (const body of ["null", "[]", "42", "\"text\"", "{bad"]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { error: "Invalid request body." });
  }
  assert.equal(created.length, 0);
});

test("support rejects cross-origin and non-JSON submissions without database writes", async () => {
  const valid = JSON.stringify({ name: "Test Sender", email: "sender@example.org", question: "I need help with a report" });
  const crossOrigin = await POST(request(valid, { Origin: "https://another.example" }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.get("Cache-Control"), "no-store");
  assert.equal(crossOrigin.headers.get("X-Content-Type-Options"), "nosniff");
  const invalidType = await POST(request(valid, { "content-type": "text/plain" }));
  assert.equal(invalidType.status, 415);
  const jsonp = await POST(request(valid, { "content-type": "application/jsonp" }));
  assert.equal(jsonp.status, 415);
  assert.equal(created.length, 0);
});

test("support rejects oversized payloads before database writes", async () => {
  const valid = JSON.stringify({ name: "Test Sender", email: "sender@example.org", question: "I need help with a report" });
  const declared = await POST(request(valid, { "Content-Length": "16385" }));
  assert.equal(declared.status, 413);
  const streamed = await POST(request("x".repeat(16_385)));
  assert.equal(streamed.status, 413);
  assert.equal(streamed.headers.get("Cache-Control"), "no-store");
  assert.equal(created.length, 0);
});

test("support validates fields and honeypot before writing", async () => {
  const valid = { name: "Test Sender", email: "sender@example.org", question: "I need help with a report", pageUrl: "/contact" };
  for (const body of [{ ...valid, companyWebsite: "bot.example" }, { ...valid, question: "" }, { ...valid, email: "invalid" }]) {
    const response = await POST(request(JSON.stringify(body)));
    assert.equal(response.status, 400);
  }
  assert.equal(created.length, 0);
});

test("support creates one trackable ticket for a valid request", async () => {
  const valid = { name: "Test Sender", email: "SENDER@example.org", question: "I need help with a report", pageUrl: "/contact" };
  const response = await POST(request(JSON.stringify(valid)));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.reference, /^RCV-/);
  assert.match(body.accessKey, /^[a-f0-9]{36}$/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(created.length, 1);
  assert.equal(created[0].requesterEmail, "sender@example.org");
  assert.equal(created[0].accessKeyHash.length, 64);
  assert.equal(created[0].question, valid.question);
});

test("support responds 429 without exposing database errors when hourly limit is reached", async () => {
  simulateRateLimit = true;
  try {
    const response = await POST(request(JSON.stringify({
      name: "Test Sender", email: "sender@example.org", question: "Please help with this report",
    })));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "3600");
    assert.deepEqual(await response.json(), {
      error: "Too many requests. Please try again later.", code: "rate_limited",
    });
    assert.equal(created.length, 1);
  } finally {
    simulateRateLimit = false;
  }
});
