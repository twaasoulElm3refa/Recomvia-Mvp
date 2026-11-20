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
const boundaryError = new Error("Scan workspace boundary reached");
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((specifier) => {
  if (specifier === "@/app/auth") return {
    getAuthenticatedUser: async () => authenticated ? { userId: "customer-1" } : null,
  };
  if (specifier === "@/db/product") return {
    ensureWorkspace: async () => { workspaceCalls++; throw boundaryError; },
  };
  if (specifier === "cloudflare:workers") return { env: {} };
  // Other imports are not used until after the deliberately stopped workspace boundary.
  if (specifier.startsWith("@/")) return {};
  throw new Error("Unexpected import " + specifier);
}, loaded, loaded.exports);

const { POST } = loaded.exports;
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

test("valid JSON with charset passes the ingress gate without starting a provider", async () => {
  const before = workspaceCalls;
  await assert.rejects(
    POST(request(valid, { headers: { "Content-Type": "application/json; charset=utf-8" } })),
    /Scan workspace boundary reached/,
  );
  assert.equal(workspaceCalls, before + 1);
});
