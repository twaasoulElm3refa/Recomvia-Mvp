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


function accountEntryHarness() {
  const source = readFileSync("hooks/use-account-entry.ts", "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const updates = [];
  let effect;
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)((name) => {
    if (name === "react") return {
      useState: (initial) => [initial, (value) => updates.push(value)],
      useEffect: (callback) => { effect = callback; },
    };
    throw new Error("Unexpected import: " + name);
  }, mod, mod.exports);
  assert.equal(mod.exports.useAccountEntry(), false);
  return { updates, mount: () => effect() };
}

const flushSession = () => new Promise((resolve) => setImmediate(resolve));

test("public session lookup has one deadline covering headers and body, with no retry or stale update", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = accountEntryHarness();
  let finishBody;
  const calls = [];
  const body = new Promise((resolve) => { finishBody = resolve; });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: () => body };
  });
  const cleanup = h.mount();
  try {
    await flushSession();
    assert.equal(calls.length, 1);
    const [url, options] = calls[0];
    assert.equal(url, "/api/session");
    assert.equal(options.cache, "no-store");
    t.mock.timers.tick(4_999);
    assert.equal(options.signal.aborted, false);
    t.mock.timers.tick(1);
    assert.equal(options.signal.aborted, true);
    // Simulate a response body that still resolves despite cancellation.
    finishBody({ signedIn: true });
    await flushSession();
    assert.deepEqual(h.updates, []);
    assert.equal(calls.length, 1);
  } finally {
    cleanup();
    t.mock.timers.reset();
  }
});

test("public session cleanup ignores a late response and successful remount clears its timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = accountEntryHarness();
  const calls = [];
  t.mock.method(globalThis, "fetch", (url, options) => new Promise((resolve) => {
    calls.push({ url, signal: options.signal, resolve });
  }));
  const firstCleanup = h.mount();
  firstCleanup();
  const secondCleanup = h.mount();
  try {
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal.aborted, true);
    calls[1].resolve({ ok: true, json: async () => ({ signedIn: true }) });
    await flushSession();
    assert.deepEqual(h.updates, [true]);
    let staleBodyReads = 0;
    calls[0].resolve({ ok: true, json: async () => {
      staleBodyReads++;
      return { signedIn: false };
    } });
    await flushSession();
    assert.equal(staleBodyReads, 0);
    assert.deepEqual(h.updates, [true]);
    t.mock.timers.tick(5_000);
    assert.equal(calls[1].signal.aborted, false, "completed lookup must clear its deadline");
  } finally {
    secondCleanup();
    t.mock.timers.reset();
  }
});
