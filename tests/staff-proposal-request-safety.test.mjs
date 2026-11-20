import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/fix-proposals/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const env = { RECOMVIA_ADMIN_USER_ID: "staff-owner" };
let user = { userId: "staff-owner" };
let workspaces = 0;
const saves = [];
let databaseError = false;
class FixProposalNotAllowed extends Error {}
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "cloudflare:workers") return { env };
  if (name === "@/app/auth") return { getAuthenticatedUser: async () => user };
  if (name === "@/db/product") return {
    ensureWorkspace: async () => { workspaces++; return { organizationId: "staff-org" }; },
  };
  if (name === "@/db/fix-review") return {
    FixProposalNotAllowed,
    createFixProposalVersion: async (...args) => {
      saves.push(args);
      if (databaseError) throw new FixProposalNotAllowed();
      return { id: "proposal_1", version: 1 };
    },
  };
  throw new Error("Unexpected import: " + name);
}, loaded, loaded.exports);
const { POST } = loaded.exports;

const draft = {
  fixId: "review_finding-1",
  scope: "Metadata on the public services page",
  proposedText: "Suggested improvement for the current page description.",
  rationale: "The analysis found unclear descriptive metadata.",
  rollbackPlan: "Restore the verified original text on approval.",
};
const valid = JSON.stringify(draft);
function request(body = valid, headers = {}) {
  return new Request("https://recomvia.test/api/fix-proposals", {
    method: "POST", body,
    headers: { "Content-Type": "application/json", Origin: "https://recomvia.test", ...headers },
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
function chunked(text, splitAt) {
  const data = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data.slice(0, splitAt));
      controller.enqueue(data.slice(splitAt));
      controller.close();
    },
  });
}
const assertPrivate = (response) => {
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
};

test("staff proposal drafts reject anonymous and non-admin users before workspace writes", async () => {
  const before = workspaces;
  user = null;
  const anonymous = await POST(request());
  user = { userId: "unrelated-user" };
  const unrelated = await POST(request());
  user = { userId: "staff-owner" };
  assert.equal(anonymous.status, 401);
  assert.equal(unrelated.status, 404);
  assertPrivate(anonymous);
  assertPrivate(unrelated);
  assert.equal(workspaces, before);
  assert.equal(saves.length, 0);
});

test("staff proposal drafts require same-origin JSON with strict declared lengths", async () => {
  const before = workspaces;
  const cases = [
    [request(valid, { Origin: "https://foreign.test" }), 403],
    [request(valid, { Origin: "" }), 403],
    [request(valid, { "Content-Type": "text/plain" }), 415],
    [request(valid, { "Content-Type": "application/jsonp" }), 415],
    [request(valid, { "Content-Length": "-1" }), 400],
    [request(valid, { "Content-Length": "01" }), 400],
    [request(valid, { "Content-Length": "Infinity" }), 400],
    [request(valid, { "Content-Length": "24577" }), 413],
  ];
  for (const [req, status] of cases) {
    const response = await POST(req);
    assert.equal(response.status, status);
    assertPrivate(response);
  }
  assert.equal(workspaces, before);
  assert.equal(saves.length, 0);
});

test("staff proposal drafts stop oversized UTF-8 streams before any database work", async () => {
  const before = workspaces;
  for (const body of [
    "x".repeat(24_577),
    JSON.stringify({ ...draft, proposedText: "م".repeat(13_000) }),
    chunked("x".repeat(24_577), 200),
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 413);
    assertPrivate(response);
  }
  for (const body of ["null", "[]", "{bad", new Uint8Array([0xff, 0xfe])]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(workspaces, before);
  assert.equal(saves.length, 0);
});

test("full-length Arabic draft survives a split UTF-8 sequence without changing approval semantics", async () => {
  const before = workspaces;
  const full = {
    ...draft,
    scope: "ن".repeat(200),
    proposedText: "م".repeat(3_000),
    rationale: "ر".repeat(1_200),
    rollbackPlan: "خ".repeat(1_200),
  };
  const json = JSON.stringify(full);
  assert.ok(new TextEncoder().encode(json).byteLength > 7_000);
  const bytes = new TextEncoder().encode(json);
  const firstArabic = bytes.indexOf(0xd9);
  assert.ok(firstArabic > 0);
  const response = await POST(request(chunked(json, firstArabic + 1), {
    "Content-Type": "application/json; charset=utf-8",
  }));
  assert.equal(response.status, 201);
  assertPrivate(response);
  assert.deepEqual(await response.json(), {
    proposal: { id: "proposal_1", version: 1 },
    applied: false, approved: false, creditsCharged: 0,
  });
  assert.equal(workspaces, before + 1);
  assert.deepEqual(saves.at(-1), [
    "staff-owner", full.fixId,
    { scope: full.scope, proposedText: full.proposedText,
      rationale: full.rationale, rollbackPlan: full.rollbackPlan },
  ]);
});

test("staff proposal ownership errors stay private and do not grant execution", async () => {
  databaseError = true;
  const response = await POST(request());
  assert.equal(response.status, 404);
  assertPrivate(response);
  databaseError = false;
});
