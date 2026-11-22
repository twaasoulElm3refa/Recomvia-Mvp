import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/fix-proposals/decision/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let authenticated = true;
let databaseError = "";
const writes = [];
class FixReviewNotAllowed extends Error {}
class FixProposalDecisionConflict extends Error {}
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/app/auth") return {
    getAuthenticatedUser: async () => authenticated ? { userId: "owner" } : null,
  };
  if (name === "@/db/fix-review") return {
    FixReviewNotAllowed,
    FixProposalDecisionConflict,
    recordFixProposalDecision: async (...args) => {
      writes.push(args);
      if (databaseError === "not_found") throw new FixReviewNotAllowed();
      if (databaseError === "conflict") throw new FixProposalDecisionConflict();
      return { proposalId: args[2], alreadyRecorded: false };
    },
  };
  throw new Error("Unexpected import " + name);
}, loaded, loaded.exports);
const { POST } = loaded.exports;

const validData = {
  scanId: "scan_1", proposalId: "proposal_123",
  decision: "accepted_for_planning", comment: "Reviewed for planning",
};
const valid = JSON.stringify(validData);
function request(body = valid, headers = {}) {
  return new Request("https://recomvia.test/api/fix-proposals/decision", {
    method: "POST", body,
    headers: { Origin: "https://recomvia.test", "Content-Type": "application/json", ...headers },
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
function chunked(text, slice) {
  const data = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data.slice(0, slice));
      controller.enqueue(data.slice(slice));
      controller.close();
    },
  });
}

test("fix decisions deny unauthenticated or foreign-origin mutations", async () => {
  const before = writes.length;
  authenticated = false;
  const unauthorized = await POST(request());
  authenticated = true;
  const offOrigin = await POST(request(valid, { Origin: "https://foreign.example" }));
  assert.equal(unauthorized.status, 401);
  assert.equal(offOrigin.status, 403);
  for (const response of [unauthorized, offOrigin]) {
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(writes.length, before);
});

test("fix decisions require real JSON and well-formed declared lengths before writes", async () => {
  const before = writes.length;
  for (const [req, status] of [
    [request(valid, { "Content-Type": "text/plain" }), 415],
    [request(valid, { "Content-Type": "application/jsonp" }), 415],
    [request(valid, { "Content-Length": "-1" }), 400],
    [request(valid, { "Content-Length": "01" }), 400],
    [request(valid, { "Content-Length": "Infinity" }), 400],
    [request(valid, { "Content-Length": "4097" }), 413],
  ]) {
    const response = await POST(req);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(writes.length, before);
});

test("fix decisions bound streamed UTF-8 bytes and reject bad JSON before writes", async () => {
  const before = writes.length;
  for (const body of [
    "x".repeat(4097),
    JSON.stringify({ ...validData, comment: "🌐".repeat(1100) }),
    chunked("x".repeat(4097), 100),
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  for (const body of ["null", "[]", "{broken", new Uint8Array([0xff, 0xfe])]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(writes.length, before);
});

test("valid Arabic comments remain accepted, including UTF-8 split across chunks", async () => {
  const before = writes.length;
  const comment = "م".repeat(800);
  const payload = JSON.stringify({ ...validData, decision: "changes_requested", comment });
  const response = await POST(request(chunked(payload, 103), {
    "Content-Type": "application/json; charset=utf-8",
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    proposalId: validData.proposalId,
    alreadyRecorded: false,
    applied: false, approvedForExecution: false, creditsCharged: 0,
  });
  assert.equal(writes.length, before + 1);
  assert.deepEqual(writes.at(-1), [
    "owner", "scan_1", "proposal_123", "changes_requested", comment,
  ]);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("fix decision keeps ownership and stale-version protections", async () => {
  databaseError = "not_found";
  assert.equal((await POST(request())).status, 404);
  databaseError = "conflict";
  assert.equal((await POST(request())).status, 409);
  databaseError = "";
});


test("fix decision comments reject invisible controls and bidi overrides without database writes", async () => {
  const before = writes.length;
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
  for (const decision of ["accepted_for_planning", "changes_requested"]) {
    for (const [label, character] of unsafe) {
      const comment = "Please review" + character + " this recommendation.";
      const response = await POST(request(JSON.stringify({ ...validData, decision, comment })));
      assert.equal(response.status, 400, decision + ": " + label);
      assert.equal(response.headers.get("Cache-Control"), "no-store", label);
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", label);
      assert.equal(writes.length, before, decision + ": " + label);
    }
  }
});

test("fix decision comments preserve legitimate Arabic line breaks and internal tabs", async () => {
  const before = writes.length;
  const comment = "أرجو تعديل النطاق\nوتوضيح السبب\r\nثم متابعة\tالعمل";
  const response = await POST(request(JSON.stringify({
    ...validData, decision: "changes_requested", comment,
  })));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(writes.length, before + 1);
  assert.deepEqual(writes.at(-1), [
    "owner", "scan_1", "proposal_123", "changes_requested", comment,
  ]);
});
