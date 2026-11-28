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
let identityUnavailable = false;
let workspaces = 0;
const saves = [];
let databaseError = false;
class FixProposalNotAllowed extends Error {}
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "cloudflare:workers") return { env };
  if (name === "@/app/auth") return { getAuthenticatedUser: async () => {
    if (identityUnavailable) throw new Error("private identity diagnostics");
    return user;
  } };
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

test("staff proposal text fields reject hidden controls and bidi overrides before any writes", async () => {
  const initialWorkspaces = workspaces;
  const initialSaves = saves.length;
  const unsafe = [
    ["NUL", "\u0000"],
    ["escape", "\u001b"],
    ["vertical tab", "\u000b"],
    ["form feed", "\u000c"],
    ["delete", "\u007f"],
    ["Arabic letter mark", "\u061c"],
    ["LTR mark", "\u200e"],
    ["RTL mark", "\u200f"],
    ["RTL override", "\u202e"],
    ["LTR isolate", "\u2066"],
    ["pop directional format", "\u202c"],
  ];
  for (const field of ["scope", "proposedText", "rationale", "rollbackPlan"]) {
    for (const [label, control] of unsafe) {
      const payload = { ...draft, [field]: draft[field] + control + " Extra text" };
      const response = await POST(request(JSON.stringify(payload)));
      assert.equal(response.status, 400, field + ": " + label);
      assertPrivate(response);
      assert.equal(workspaces, initialWorkspaces, field + ": " + label);
      assert.equal(saves.length, initialSaves, field + ": " + label);
    }
  }
});

test("legitimate Arabic proposal text with line breaks and tabs is retained exactly", async () => {
  const before = saves.length;
  const arabic = {
    ...draft,
    scope: "مراجعة وصف الخدمة",
    proposedText: "تحسين العنوان\nووصف الصفحة\r\nمع مراعاة\tالمصطلحات",
    rationale: "الحاجة إلى توضيح مضمون الصفحة",
    rollbackPlan: "استعادة النص الأصلي\nثم التحقق من النتيجة",
  };
  const response = await POST(request(JSON.stringify(arabic)));
  assert.equal(response.status, 201);
  assertPrivate(response);
  assert.equal(saves.length, before + 1);
  assert.deepEqual(saves.at(-1), [
    "staff-owner", arabic.fixId,
    { scope: arabic.scope, proposedText: arabic.proposedText,
      rationale: arabic.rationale, rollbackPlan: arabic.rollbackPlan },
  ]);
});


test("staff proposal upload has a single deadline even when chunks arrive or cancellation stalls", async (t) => {
  const initialWorkspaces = workspaces;
  const initialSaves = saves.length;
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
  const pending = POST(request(body));
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
    assert.deepEqual(await response.json(), { code: "invalid_request" });
    assertPrivate(response);
    assert.equal(body.locked, false);
    assert.equal(workspaces, initialWorkspaces);
    assert.equal(saves.length, initialSaves);
  } finally {
    if (!cancelled) controller.close();
    finishCleanup();
    await pending;
    t.mock.timers.reset();
  }
});

test("staff proposal rejects invalid or oversized streams even when cancellation stalls", async () => {
  const initialWorkspaces = workspaces;
  const initialSaves = saves.length;
  for (const [bytes, status] of [[new Uint8Array([0xff]), 400], [new Uint8Array(24577), 413]]) {
    let controller;
    let cancelled = false;
    let finishCleanup;
    const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
    const body = new ReadableStream({
      start(value) { controller = value; value.enqueue(bytes); },
      cancel() { cancelled = true; return cleanup; },
    });
    const pending = POST(request(body));
    try {
      const response = await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve(null)))]);
      assert.equal(cancelled, true);
      assert.ok(response, "invalid stream must not await upstream cancellation");
      assert.equal(response.status, status);
      assertPrivate(response);
      assert.equal(body.locked, false);
      assert.equal(workspaces, initialWorkspaces);
      assert.equal(saves.length, initialSaves);
    } finally {
      if (!cancelled) controller.close();
      finishCleanup();
      await pending;
    }
  }
});

test("completed staff proposal clears its deadline and remains a free planning draft", async (t) => {
  const initialWorkspaces = workspaces;
  const initialSaves = saves.length;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const req = request(chunked(valid, 12));
    const response = await POST(req);
    assert.equal(response.status, 201);
    assertPrivate(response);
    assert.deepEqual(await response.json(), {
      proposal: { id: "proposal_1", version: 1 },
      applied: false, approved: false, creditsCharged: 0,
    });
    assert.equal(req.body.locked, false);
    t.mock.timers.tick(5000);
    assert.equal(workspaces, initialWorkspaces + 1);
    assert.equal(saves.length, initialSaves + 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("staff proposal identity outages reject drafts before request access or writes and recover", async () => {
  const beforeWorkspaces = workspaces;
  const beforeSaves = saves.length;
  let requestReads = 0;
  const blocked = new Proxy(request(), {
    get() {
      requestReads++;
      throw new Error("request must not be read");
    },
  });
  identityUnavailable = true;
  try {
    const response = await POST(blocked);
    assert.equal(response.status, 503);
    assertPrivate(response);
    assert.deepEqual(await response.json(), { code: "temporarily_unavailable" });
    assert.equal(requestReads, 0);
    assert.equal(workspaces, beforeWorkspaces);
    assert.equal(saves.length, beforeSaves);
  } finally {
    identityUnavailable = false;
  }
  const scope = "مراجعة وصف الخدمة — service metadata";
  const response = await POST(request(JSON.stringify({ ...draft, scope })));
  assert.equal(response.status, 201);
  assertPrivate(response);
  assert.deepEqual(await response.json(), {
    proposal: { id: "proposal_1", version: 1 },
    applied: false, approved: false, creditsCharged: 0,
  });
  assert.equal(workspaces, beforeWorkspaces + 1);
  assert.equal(saves.length, beforeSaves + 1);
  assert.deepEqual(saves.at(-1), [
    "staff-owner", draft.fixId,
    { scope, proposedText: draft.proposedText,
      rationale: draft.rationale, rollbackPlan: draft.rollbackPlan },
  ]);
});
