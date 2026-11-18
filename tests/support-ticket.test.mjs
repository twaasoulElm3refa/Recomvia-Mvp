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
const compiledModule = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/app/auth") return { getAuthenticatedUser: async () => null };
  if (name === "@/db/support") return { createSupportTicket: async (ticket) => { created.push(ticket); } };
  throw new Error("Unexpected dependency: " + name);
}, compiledModule, compiledModule.exports);
const { POST } = compiledModule.exports;
const request = (body) => new Request("https://recomvia.test/api/support/tickets", {
  method: "POST", headers: { "content-type": "application/json" }, body,
});

test("support rejects invalid JSON shapes without creating tickets", async () => {
  for (const body of ["null", "[]", "42", "\"text\"", "{bad"]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { error: "Invalid request body." });
  }
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
