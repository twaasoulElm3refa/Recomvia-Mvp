import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/assistant/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let searched = [];
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((specifier) => {
  if (specifier === "@/lib/knowledge-base") return {
    searchKnowledge: (question) => {
      searched.push(question);
      return { answered: true, answer: "Approved knowledge only", confidence: 100 };
    },
  };
  throw new Error("Unexpected import " + specifier);
}, loaded, loaded.exports);
const { POST } = loaded.exports;
function request(body, headers = {}) {
  return new Request("https://recomvia.test/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recomvia.test", ...headers },
    body,
  });
}

test("assistant accepts Arabic and English questions with no-store headers", async () => {
  searched = [];
  for (const question of ["ما هي باقات Recomvia؟", "What does Essential include?"]) {
    const response = await POST(request(JSON.stringify({ question })));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal((await response.json()).answered, true);
  }
  assert.deepEqual(searched, ["ما هي باقات Recomvia؟", "What does Essential include?"]);
});

test("assistant rejects cross-site calls and non-JSON before knowledge lookup", async () => {
  searched = [];
  assert.equal((await POST(request('{"question":"Valid text"}', { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(request('{"question":"Valid text"}', { "Content-Type": "text/plain" }))).status, 415);
  assert.equal(searched.length, 0);
});

test("assistant rejects invalid shapes, malformed JSON and oversized requests", async () => {
  searched = [];
  for (const payload of ["null", "[]", '"text"', "23", "{bad", '{"question":1}', '{"question":"a"}']) {
    const response = await POST(request(payload));
    assert.equal(response.status, 400, payload);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal((await POST(request(JSON.stringify({ question: "hello" }), { "Content-Length": "4000" }))).status, 413);
  assert.equal((await POST(request(JSON.stringify({ question: "hello", filler: "x".repeat(3500) })))).status, 413);
  assert.equal(searched.length, 0);
});
