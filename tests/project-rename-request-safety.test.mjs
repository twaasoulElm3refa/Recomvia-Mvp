import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("app/api/projects/rename/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let authenticated = true;
const writes = [];
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/app/auth") return {
    getAuthenticatedUser: async () => authenticated ? { userId: "owner" } : null,
  };
  if (name === "@/db/project-slots") return {
    ProjectSlotError: class ProjectSlotError extends Error {},
    renameProjectSlot: async (...args) => {
      writes.push(args);
      return { projectId: args[1], displayName: args[3], changed: true };
    },
  };
  throw new Error("Unexpected import " + name);
}, loaded, loaded.exports);
const { POST } = loaded.exports;
const validData = { projectId: "project-one", expectedName: "Old name", displayName: "New name" };
const valid = JSON.stringify(validData);
function request(body = valid, headers = {}) {
  return new Request("https://recomvia.test/api/projects/rename", {
    method: "POST",
    headers: { Origin: "https://recomvia.test", "Content-Type": "application/json", ...headers },
    body,
  });
}

test("project renaming rejects unauthenticated and off-origin requests without writes", async () => {
  authenticated = false;
  const unauthenticated = await POST(request());
  assert.equal(unauthenticated.status, 401);
  authenticated = true;
  const foreign = await POST(request(valid, { Origin: "https://evil.example" }));
  assert.equal(foreign.status, 403);
  for (const response of [unauthenticated, foreign]) {
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(writes.length, 0);
});

test("project rename rejects JSON lookalikes and invalid declared lengths", async () => {
  for (const [req, status] of [
    [request(valid, { "Content-Type": "text/plain" }), 415],
    [request(valid, { "Content-Type": "application/jsonp" }), 415],
    [request(valid, { "Content-Length": "-1" }), 400],
    [request(valid, { "Content-Length": "Infinity" }), 400],
    [request(valid, { "Content-Length": "2049" }), 413],
  ]) {
    const response = await POST(req);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal(writes.length, 0);
});

test("project rename counts streamed UTF-8 bytes before any database write", async () => {
  for (const body of [
    "x".repeat(2049),
    JSON.stringify({ ...validData, displayName: "🌐".repeat(520) }),
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  for (const body of ["null", "[]", "123", "{broken"]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(writes.length, 0);
});

test("valid Arabic Unicode labels keep their original rename contract", async () => {
  const expectedName = "م".repeat(160);
  const displayName = "ع".repeat(80);
  const response = await POST(request(JSON.stringify({
    projectId: "project-one", expectedName, displayName,
  }), { "Content-Type": "application/json; charset=utf-8" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: "project-one", displayName, changed: true,
    projectKeyUnchanged: true, quotasReset: false,
  });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], [{ userId: "owner" }, "project-one", expectedName, displayName]);
});
