import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/support/tickets/status/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let databaseLookups = 0;
const fixture = { publicId: "RCV-TEST123-ABCDEF", status: "answered", humanReply: "A documented reply" };
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/db/support") return {
    findTicketForRequester: async (reference, keyHash) => {
      databaseLookups++;
      assert.equal(reference, fixture.publicId);
      assert.equal(keyHash.length, 64);
      return fixture;
    },
  };
  throw new Error("Unexpected import: " + name);
}, loaded, loaded.exports);

const { POST } = loaded.exports;
const accessKey = "abcdef".repeat(6);
function request(body, origin = "https://recomvia.test") {
  return new Request("https://recomvia.test/api/support/tickets/status", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body,
  });
}

test("ticket status endpoint rejects non-object JSON without lookup or internal errors", async () => {
  for (const body of ["null", "[]", "17", '"text"', "{bad"]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(databaseLookups, 0);
});

test("ticket status lookup rejects invalid keys and off-origin requests", async () => {
  const valid = JSON.stringify({ reference: fixture.publicId, accessKey });
  const crossOrigin = await POST(request(valid, "https://evil.example"));
  assert.equal(crossOrigin.status, 403);
  const invalid = await POST(request(JSON.stringify({ reference: fixture.publicId, accessKey: "nothex".repeat(6) })));
  assert.equal(invalid.status, 404);
  assert.equal(databaseLookups, 0);
});

test("valid tracking key returns only the private ticket status with no-store", async () => {
  const response = await POST(request(JSON.stringify({ reference: fixture.publicId.toLowerCase(), accessKey })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), fixture);
  assert.equal(databaseLookups, 1);
});
