import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/scans/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let authenticated = true;
let workspaceCalls = 0;
let reportReads = [];
const boundaryError = new Error("Scan workspace boundary reached");
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((specifier) => {
  if (specifier === "@/app/auth") return {
    getAuthenticatedUser: async () => authenticated ? { userId: "customer-1" } : null,
  };
  if (specifier === "@/db/product") return {
    ensureWorkspace: async () => { workspaceCalls++; throw boundaryError; },
    getReportForUser: async (userId, scanId) => {
      reportReads.push([userId, scanId]);
      return scanId === "scan_abc" ? { scan: { id: scanId }, entitlement: { reportLevel: "full" } } : null;
    },
  };
  if (specifier === "cloudflare:workers") return { env: {} };
  // Other imports are not used until after the deliberately stopped workspace boundary.
  if (specifier.startsWith("@/")) return {};
  throw new Error("Unexpected import " + specifier);
}, loaded, loaded.exports);

const { POST, GET } = loaded.exports;
const valid = JSON.stringify({ input: "https://example.com", kind: "website", language: "en" });
function request(body = valid, { headers = {}, noOrigin = false } = {}) {
  return new Request("https://recomvia.test/api/scans", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(noOrigin ? {} : { Origin: "https://recomvia.test" }),
      ...headers,
    },
    body,
  });
}

test("unauthenticated scan is rejected without any workspace or provider work", async () => {
  const before = workspaceCalls;
  authenticated = false;
  const response = await POST(request());
  authenticated = true;
  assert.equal(response.status, 401);
  assert.equal(workspaceCalls, before);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("billable scans require a same-origin browser request", async () => {
  const before = workspaceCalls;
  for (const req of [request(valid, { noOrigin: true }), request(valid, {
    headers: { Origin: "https://another.example" },
  })]) {
    const response = await POST(req);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(workspaceCalls, before);
});

test("billable scans reject non-JSON content types before workspace work", async () => {
  const before = workspaceCalls;
  for (const contentType of ["text/plain", "application/jsonp", "application/x-www-form-urlencoded", ""]) {
    const headers = contentType ? { "Content-Type": contentType } : { "Content-Type": "" };
    const response = await POST(request(valid, { headers }));
    assert.equal(response.status, 415, contentType);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(workspaceCalls, before);
});

test("billable scans reject invalid JSON or non-object payloads", async () => {
  const before = workspaceCalls;
  for (const payload of ["null", "[]", "42", '"text"', "{bad", ""]) {
    const response = await POST(request(payload));
    assert.equal(response.status, 400, payload);
  }
  assert.equal(workspaceCalls, before);
});

test("scan request limits count UTF-8 bytes, not JavaScript characters", async () => {
  const before = workspaceCalls;
  const cases = [
    [request(valid, { headers: { "Content-Length": "4001" } }), 413],
    [request(valid, { headers: { "Content-Length": "-1" } }), 400],
    [request(valid, { headers: { "Content-Length": "Infinity" } }), 400],
    [request(JSON.stringify({ input: "x".repeat(4001) })), 413],
    [request(JSON.stringify({ input: "🌐".repeat(1_050) })), 413],
  ];
  for (const [req, status] of cases) {
    const response = await POST(req);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(workspaceCalls, before);
});

test("billable scans reject noncanonical declared lengths before workspace access", async () => {
  const before = workspaceCalls;
  for (const length of ["", "00", "0001", "+1", "1e3", "0x10", "4_000"]) {
    const response = await POST(request(valid, { headers: { "Content-Length": length } }));
    assert.equal(response.status, 400, `length=${JSON.stringify(length)}`);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(workspaceCalls, before);
});

test("billable scans reject malformed UTF-8 even inside otherwise JSON-shaped bytes", async () => {
  const before = workspaceCalls;
  const malformed = Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
  const response = await POST(request(malformed));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(workspaceCalls, before);
});

test("billable scans accept valid Arabic UTF-8 split across stream chunks", async () => {
  const before = workspaceCalls;
  const bytes = new TextEncoder().encode(JSON.stringify({
    input: "مدونة عربية", kind: "topic", language: "ar",
  }));
  const splitAt = bytes.findIndex((byte) => byte > 0x7f) + 1;
  assert.ok(splitAt > 1 && splitAt < bytes.length);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, splitAt));
      controller.enqueue(bytes.subarray(splitAt));
      controller.close();
    },
  });
  const req = new Request("https://recomvia.test/api/scans", {
    method: "POST", duplex: "half", body,
    headers: { Origin: "https://recomvia.test", "Content-Type": "application/json" },
  });
  await assert.rejects(POST(req), /Scan workspace boundary reached/);
  assert.equal(workspaceCalls, before + 1);
});

test("valid JSON with charset passes the ingress gate without starting a provider", async () => {
  const before = workspaceCalls;
  await assert.rejects(
    POST(request(valid, { headers: { "Content-Type": "application/json; charset=utf-8" } })),
    /Scan workspace boundary reached/,
  );
  assert.equal(workspaceCalls, before + 1);
});

test("identity confirmation rejects malformed selectors before workspace or provider work", async () => {
  const before = workspaceCalls;
  const cases = [
    { scanId: "", candidateId: "candidate_1" },
    { scanId: "../another-scan", candidateId: "candidate_1" },
    { scanId: "scan_1", candidateId: "../other" },
    { scanId: "scan_1", candidateId: "x".repeat(101) },
    { scanId: "x".repeat(101), candidateId: "candidate_1" },
    { scanId: "scan_1", candidateId: 1 },
    { scanId: 7, candidateId: "candidate_1" },
    { scanId: "scan_1" },
    { scanId: "scan_1", candidateId: "candidate_1\\n" },
  ];
  for (const payload of cases) {
    const response = await POST(request(JSON.stringify(payload)));
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.deepEqual(await response.json(), { code: "invalid_choice" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(workspaceCalls, before, "invalid confirmation IDs must not touch workspace data");
});

test("orphan identity candidates never start a new billable scan", async () => {
  const before = workspaceCalls;
  for (const candidateId of ["candidate_1", "", "../other", 1, null]) {
    // An otherwise valid website request must not turn an incomplete
    // identity confirmation into a fresh scan or provider invocation.
    const response = await POST(request(JSON.stringify({
      input: "https://example.com", kind: "website", language: "en", candidateId,
    })));
    assert.equal(response.status, 400, JSON.stringify(candidateId));
    assert.deepEqual(await response.json(), { code: "invalid_choice" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(workspaceCalls, before, "orphan confirmations must not access workspace data");
});

test("valid identity confirmation selectors reach the existing authenticated workflow", async () => {
  const before = workspaceCalls;
  await assert.rejects(
    POST(request(JSON.stringify({ scanId: "scan_abc", candidateId: "candidate_2" }))),
    /Scan workspace boundary reached/,
  );
  assert.equal(workspaceCalls, before + 1, "valid IDs must not be rejected by ingress validation");
});

test("private scan lookup rejects missing, repeated, malformed and oversized selectors before database access", async () => {
  reportReads = [];
  const invalid = [
    "", "?scan", "?scan=", "?scan=scan_abc&scan=scan_abc",
    "?scan=scan_abc&scan=other", "?scan=../other",
    "?scan=%00", "?scan=%20scan_abc", "?scan=scan%2Fabc",
    "?scan=" + "a".repeat(101),
  ];
  for (const query of invalid) {
    const response = await GET(new Request("https://recomvia.test/api/scans" + query));
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { code: "invalid_input" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.deepEqual(reportReads, [], "rejected selectors must not query private reports");
});

test("private scan lookup is authenticated and owner-scoped for valid identifiers", async () => {
  reportReads = [];
  authenticated = false;
  const anonymous = await GET(new Request("https://recomvia.test/api/scans?scan=scan_abc"));
  authenticated = true;
  assert.equal(anonymous.status, 401);
  assert.deepEqual(reportReads, []);

  const request = (id) => new Request("https://recomvia.test/api/scans?scan=" + id);
  const found = await GET(request("scan_abc"));
  assert.equal(found.status, 200);
  assert.equal(found.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await found.json(), {
    scan: { id: "scan_abc" }, entitlement: { reportLevel: "full" },
  });
  const missing = await GET(request("scan_other"));
  assert.equal(missing.status, 404);
  assert.deepEqual(reportReads, [
    ["customer-1", "scan_abc"],
    ["customer-1", "scan_other"],
  ], "all private reads must remain scoped to the signed-in user");
});
