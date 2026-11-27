import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/internal/monitor/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Load the real classifier so route-level regression tests exercise its contract.
const classifier = { exports: {} };
const classifierSource = readFileSync("lib/monitoring-scan-status.ts", "utf8");
const classifierCompiled = ts.transpileModule(classifierSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("module", "exports", classifierCompiled)(classifier, classifier.exports);

const env = { MONITORING_SECRET: "s".repeat(48) };
let claimCalls = 0;
let scanCalls = 0;
let digests = 0;
let pendingJob = null;
let scanResponse = null;
const releases = [];
const crypto = {
  subtle: {
    digest: (...args) => {
      digests++;
      return webcrypto.subtle.digest(...args);
    },
  },
};
const loaded = { exports: {} };
new Function("require", "module", "exports", "crypto", compiled)((name) => {
  if (name === "cloudflare:workers") return { env };
  if (name === "@/lib/monitoring-scan-status") return classifier.exports;
  if (name === "@/db/analysis") return {
    claimMonitoringJob: async () => { claimCalls++; return pendingJob; },
    releaseMonitoringJob: async (job, status, pause) => {
      assert.equal(job, pendingJob);
      releases.push({ status, pause });
    },
  };
  if (name === "@/db/product") return {
    ensureWorkspace: async () => { assert.ok(pendingJob); return { organizationId: pendingJob.organizationId }; },
  };
  if (name === "@/app/api/scans/route") return {
    runScanForUser: async () => { scanCalls++; assert.ok(scanResponse); return scanResponse; },
  };
  throw new Error("Unexpected import: " + name);
}, loaded, loaded.exports, crypto);

const { POST } = loaded.exports;
const request = (authorization) => new Request("https://recomvia.test/api/internal/monitor", {
  method: "POST",
  headers: authorization === undefined ? {} : { Authorization: authorization },
});
function privateResponse(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
}

test("unconfigured internal monitoring secret denies without touching jobs", async () => {
  const configuredSecret = env.MONITORING_SECRET;
  env.MONITORING_SECRET = "";
  privateResponse(await POST(request()), 503);
  env.MONITORING_SECRET = "short";
  privateResponse(await POST(request("Bearer short")), 503);
  env.MONITORING_SECRET = configuredSecret;
  assert.equal(claimCalls, 0);
  assert.equal(scanCalls, 0);
});

test("malformed or oversized Authorization fails before cryptography and job claims", async () => {
  const before = digests;
  for (const value of [
    undefined,
    "Basic " + env.MONITORING_SECRET,
    "bearer " + env.MONITORING_SECRET,
    "Bearer " + "x".repeat(1_025),
  ]) {
    const response = await POST(request(value));
    privateResponse(response, 401);
    assert.deepEqual(await response.json(), { code: "unauthorized" });
  }
  assert.equal(digests, before);
  assert.equal(claimCalls, 0);
});

test("wrong Bearer secret cannot claim monitoring jobs", async () => {
  const before = digests;
  privateResponse(await POST(request("Bearer " + "x".repeat(48))), 401);
  assert.equal(digests, before + 2);
  assert.equal(claimCalls, 0);
});

test("correct scheduled-worker Bearer token preserves idle success contract", async () => {
  const response = await POST(request("Bearer " + env.MONITORING_SECRET));
  privateResponse(response, 200);
  assert.deepEqual(await response.json(), { processed: 0 });
  assert.equal(claimCalls, 1);
  assert.equal(scanCalls, 0);
});

test("authenticated monitoring releases a claimed job with only a trusted result and pause policy", async () => {
  pendingJob = {
    userId: "test-user", email: "test@example.invalid", displayName: "Test",
    organizationId: "test-org",
    inputJson: JSON.stringify({ input: "Example", kind: "entity", language: "en" }),
    targetJson: "{}",
  };
  try {
    for (const [body, httpStatus, status, pause] of [
      [{ code: "completed" }, 500, "monitor_failed", false],
      [{ code: "subscription_required" }, 403, "subscription_required", true],
      [{ privateReport: "not returned" }, 201, "completed", false],
    ]) {
      scanResponse = Response.json(body, { status: httpStatus });
      const before = releases.length;
      const response = await POST(request("Bearer " + env.MONITORING_SECRET));
      privateResponse(response, 200);
      assert.deepEqual(await response.json(), { processed: 1, status });
      assert.equal(releases.length, before + 1);
      assert.deepEqual(releases.at(-1), { status, pause });
    }
  } finally {
    pendingJob = null;
    scanResponse = null;
  }
});
