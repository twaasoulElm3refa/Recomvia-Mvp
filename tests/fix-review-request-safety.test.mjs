import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync("app/api/fix-reviews/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let user = { userId: "customer-1" };
const writes = [];
class FixReviewNotAllowed extends Error {}
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/app/auth") return { getAuthenticatedUser: async () => user };
  if (name === "@/db/fix-review") return {
    FixReviewNotAllowed,
    requestFindingReview: async (...args) => {
      writes.push(args);
      return { request: { id: "review-1", status: "review_requested" }, alreadyRequested: false };
    },
  };
  throw new Error("Unexpected import " + name);
}, loaded, loaded.exports);
const { POST } = loaded.exports;

const valid = JSON.stringify({ scanId: "scan-1", findingId: "finding_1" });
function request(body = valid, headers = {}) {
  return new Request("https://recomvia.test/api/fix-reviews", {
    method: "POST", body,
    headers: { "Content-Type": "application/json", Origin: "https://recomvia.test", ...headers },
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
function split(text, offset) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, offset));
      controller.enqueue(bytes.slice(offset));
      controller.close();
    },
  });
}
function privateResponse(response) {
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
}

test("review intake blocks unauthenticated and off-origin requests before writes", async () => {
  user = null;
  const anonymous = await POST(request());
  user = { userId: "customer-1" };
  const offOrigin = await POST(request(valid, { Origin: "https://foreign.test" }));
  const missingOrigin = await POST(request(valid, { Origin: "" }));
  assert.equal(anonymous.status, 401);
  assert.equal(offOrigin.status, 403);
  assert.equal(missingOrigin.status, 403);
  for (const response of [anonymous, offOrigin, missingOrigin]) privateResponse(response);
  assert.equal(writes.length, 0);
});

test("review intake rejects non-JSON MIME and malformed declared lengths before writes", async () => {
  const cases = [
    [request(valid, { "Content-Type": "application/jsonp" }), 415],
    [request(valid, { "Content-Type": "text/plain" }), 415],
    [request(valid, { "Content-Length": "-1" }), 400],
    [request(valid, { "Content-Length": "01" }), 400],
    [request(valid, { "Content-Length": "Infinity" }), 400],
    [request(valid, { "Content-Length": "501" }), 413],
  ];
  for (const [req, status] of cases) {
    const response = await POST(req);
    assert.equal(response.status, status);
    privateResponse(response);
  }
  assert.equal(writes.length, 0);
});

test("review intake enforces the byte cap on ASCII, multibyte, and chunked data", async () => {
  for (const body of [
    "x".repeat(501),
    JSON.stringify({ scanId: "scan-1", findingId: "finding_1", extra: "🌐".repeat(130) }),
    split("x".repeat(501), 100),
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 413);
    privateResponse(response);
  }
  for (const body of ["null", "[]", "{bad", new Uint8Array([0xff, 0xfe])]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(writes.length, 0);
});

test("valid streamed UTF-8 JSON still creates a planning-only review", async () => {
  const payload = JSON.stringify({
    scanId: "scan-1", findingId: "finding_1", context: "ملاحظة",
  });
  const bytes = new TextEncoder().encode(payload);
  const arabic = bytes.indexOf(0xd9);
  assert.ok(arabic > 0);
  const response = await POST(request(split(payload, arabic + 1), {
    "Content-Type": "application/json; charset=utf-8",
  }));
  assert.equal(response.status, 201);
  privateResponse(response);
  const result = await response.json();
  assert.equal(result.executionEnabled, false);
  assert.equal(result.approved, false);
  assert.equal(result.creditsCharged, 0);
  assert.deepEqual(writes, [["customer-1", "scan-1", "finding_1"]]);
});
