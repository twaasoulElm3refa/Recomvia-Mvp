import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/session/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let currentUser = null;
let authFailure = null;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/app/auth") return { getAuthenticatedUser: async () => {
    if (authFailure) throw authFailure;
    return currentUser;
  } };
  throw new Error("Unexpected import: " + name);
}, loaded, loaded.exports);
const { GET } = loaded.exports;

test("anonymous session state is private and not sniffable", async () => {
  currentUser = null;
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signedIn: false });
  assert.match(response.headers.get("Cache-Control") ?? "", /private/);
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("authenticated session state never exposes user identity or caches the response", async () => {
  currentUser = { userId: "customer-1", email: "private@example.test" };
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signedIn: true });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  currentUser = null;
});

test("identity service failures return private generic 503 and allow recovery", async () => {
  currentUser = null;
  authFailure = new Error("private@example.test session-token diagnostic");
  try {
    const response = await GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: "temporarily_unavailable" });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  } finally {
    authFailure = null;
  }
  const recovered = await GET();
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { signedIn: false });
});
