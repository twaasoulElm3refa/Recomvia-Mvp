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
  method: "POST", headers: { "content-type": "application/json", Origin: "https://recomvia.test", ...extraHeaders }, body,
});

test("support rejects invalid JSON shapes without creating tickets", async () => {
  for (const body of ["null", "[]", "42", "\"text\"", "{bad"]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { error: "Invalid request body." });
  }
  assert.equal(created.length, 0);
});

test("support requires a trustworthy same-origin request before creating tickets", async () => {
  const valid = JSON.stringify({ name: "Test Sender", email: "sender@example.org", question: "I need help with a report" });
  const before = created.length;
  const withoutOrigin = new Request("https://recomvia.test/api/support/tickets", {
    method: "POST", headers: { "content-type": "application/json" }, body: valid,
  });
  for (const [caseName, submission] of [
    ["missing", withoutOrigin],
    ["blank", request(valid, { Origin: "" })],
    ["opaque", request(valid, { Origin: "null" })],
    ["external", request(valid, { Origin: "https://another.example" })],
  ]) {
    const response = await POST(submission);
    assert.equal(response.status, 403, caseName);
    assert.equal(response.headers.get("Cache-Control"), "no-store", caseName);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", caseName);
    assert.equal(created.length, before, caseName);
  }
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


test("support rejects malformed declared lengths before creating tickets", async () => {
  const body = JSON.stringify({ name: "Test Sender", email: "sender@example.org", question: "Please help with this report" });
  const before = created.length;
  for (const value of ["-1", "Infinity", "NaN", "1e3", "16.0", "01", ""]) {
    const response = await POST(request(body, { "Content-Length": value }));
    assert.equal(response.status, 400, value);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(created.length, before);
});

test("support rejects invalid UTF-8 but preserves streamed Arabic text", async () => {
  const before = created.length;
  const invalid = await POST(request(new Uint8Array([0x7b, 0x22, 0x71, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(created.length, before);

  const input = {
    name: "مستخدم عربي",
    email: "arabic@example.org",
    question: "أحتاج مساعدة في قراءة التقرير الخاص بموقعي",
  };
  const encoded = new TextEncoder().encode(JSON.stringify(input));
  const firstArabicByte = encoded.findIndex((byte) => byte >= 0x80);
  assert.ok(firstArabicByte >= 0);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded.slice(0, firstArabicByte + 1));
      controller.enqueue(encoded.slice(firstArabicByte + 1));
      controller.close();
    },
  });
  const response = await POST(new Request("https://recomvia.test/api/support/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recomvia.test" },
    body: stream,
    duplex: "half",
  }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(created.length, before + 1);
  assert.equal(created.at(-1).requesterName, input.name);
  assert.equal(created.at(-1).question, input.question);
});

test("support source links stay on the app origin even for backslash or absolute URL tricks", async () => {
  const base = created.length;
  const input = {
    name: "Test Sender", email: "sender@example.org",
    question: "Please help me understand this report",
  };
  const unsafeSources = [
    "//evil.example/phishing",
    "/\\\\evil.example/phishing",
    "https://evil.example/phishing",
    "javascript:alert(1)",
    "contact", // Relative links without a leading slash are not accepted.
  ];
  for (const pageUrl of unsafeSources) {
    const response = await POST(request(JSON.stringify({ ...input, pageUrl })));
    assert.equal(response.status, 201, pageUrl);
    assert.equal(created.at(-1).pageUrl, "", pageUrl);
  }

  for (const [pageUrl, expected] of [
    ["/ar/contact?from=help", "/ar/contact?from=help"],
    ["https://recomvia.test/blog?from=faq#section", "/blog?from=faq"],
  ]) {
    const response = await POST(request(JSON.stringify({ ...input, pageUrl })));
    assert.equal(response.status, 201, pageUrl);
    assert.equal(created.at(-1).pageUrl, expected);
    assert.equal(new URL(expected, "https://recomvia.test").origin, "https://recomvia.test");
  }
  assert.equal(created.length, base + unsafeSources.length + 2);
});
