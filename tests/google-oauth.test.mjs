import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const credentials = {
  GOOGLE_CLIENT_ID: "configured-client-id",
  GOOGLE_CLIENT_SECRET: "configured-client-secret",
  AUTH_SECRET: "test-hmac-secret",
};

class MockResponse {
  constructor(location) {
    this.location = location.toString();
    this.cookies = {
      values: new Map(),
      set: (name, value, options) => this.cookies.values.set(name, { value, options }),
      get: (name) => this.cookies.values.get(name),
    };
  }

  static redirect(location) {
    return new MockResponse(location);
  }
}

const loaded = new Map();
function load(relativePath) {
  if (loaded.has(relativePath)) return loaded.get(relativePath);
  const source = readFileSync(resolve(root, relativePath), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
  });
  const module = { exports: {} };
  const requireMock = (specifier) => {
    if (specifier === "cloudflare:workers") return { env: credentials };
    if (specifier === "next/server") return { NextResponse: MockResponse };
    if (specifier === "next/headers") return { cookies: async () => ({ get: () => undefined }) };
    if (specifier === "next/navigation") return { redirect: () => { throw new Error("Unexpected redirect"); } };
    if (specifier === "@/app/auth") return load("app/auth.ts");
    throw new Error(`Unexpected import: ${specifier}`);
  };
  new Function("require", "module", "exports", outputText)(requireMock, module, module.exports);
  loaded.set(relativePath, module.exports);
  return module.exports;
}

const auth = load("app/auth.ts");
const start = load("app/auth/google/route.ts");
const callback = load("app/auth/google/callback/route.ts");
const signout = load("app/auth/signout/route.ts");

function request(url, cookies = new Map()) {
  return {
    url,
    nextUrl: new URL(url),
    cookies: { get: (name) => cookies.get(name) },
  };
}

function callbackRequest(origin, startResponse, extraQuery = "") {
  const state = startResponse.cookies.get(auth.OAUTH_STATE_COOKIE).value;
  const verifier = startResponse.cookies.get(auth.OAUTH_VERIFIER_COOKIE).value;
  const url = `${origin}/auth/google/callback?code=test-code&state=${state}${extraQuery}`;
  return { request: request(url, new Map([
    [auth.OAUTH_STATE_COOKIE, { value: state }],
    [auth.OAUTH_VERIFIER_COOKIE, { value: verifier }],
  ])), verifier };
}

test("staging and production authorization use their own callback URL and configured client ID", async () => {
  for (const origin of [
    "https://recomvia-staging.recomvia.workers.dev",
    "https://recomvia.recomvia.workers.dev",
    "http://localhost:3000",
  ]) {
    const response = await start.GET(request(`${origin}/auth/google?origin=https://attacker.example`));
    const authorization = new URL(response.location);
    assert.equal(authorization.searchParams.get("redirect_uri"), `${origin}/auth/google/callback`);
    assert.equal(authorization.searchParams.get("client_id"), credentials.GOOGLE_CLIENT_ID);
    assert.equal(authorization.searchParams.get("state"), response.cookies.get(auth.OAUTH_STATE_COOKIE).value);
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorization.searchParams.get("client_secret"), null);
    for (const name of [auth.OAUTH_STATE_COOKIE, auth.OAUTH_VERIFIER_COOKIE]) {
      assert.deepEqual(
        { httpOnly: response.cookies.get(name).options.httpOnly, secure: response.cookies.get(name).options.secure, sameSite: response.cookies.get(name).options.sameSite },
        { httpOnly: true, secure: true, sameSite: "lax" },
      );
    }
  }
});

test("callback exchanges with the exact request-specific redirect URI and returns to staging dashboard", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const startResponse = await start.GET(request(`${origin}/auth/google`));
  const authorization = new URL(startResponse.location);
  const { request: incoming, verifier } = callbackRequest(origin, startResponse);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://oauth2.googleapis.com/token") return { ok: true, json: async () => ({ access_token: "test-access-token" }) };
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") return { ok: true, json: async () => ({ sub: "user-123", email: "TEST@example.com", email_verified: true, name: "Test User" }) };
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await callback.GET(incoming);
    assert.equal(calls.length, 2);
    const body = calls[0].options.body;
    assert.equal(body.get("redirect_uri"), authorization.searchParams.get("redirect_uri"));
    assert.equal(body.get("client_id"), credentials.GOOGLE_CLIENT_ID);
    assert.equal(body.get("client_secret"), credentials.GOOGLE_CLIENT_SECRET);
    assert.equal(body.get("code_verifier"), verifier);
    assert.equal(response.location, `${origin}/dashboard`);
    assert.match(response.cookies.get(auth.SESSION_COOKIE).value, /^[^.]+\.[^.]+$/);
    assert.deepEqual(
      { httpOnly: response.cookies.get(auth.SESSION_COOKIE).options.httpOnly, secure: response.cookies.get(auth.SESSION_COOKIE).options.secure, sameSite: response.cookies.get(auth.SESSION_COOKIE).options.sameSite },
      { httpOnly: true, secure: true, sameSite: "lax" },
    );
    assert.equal(response.cookies.get(auth.OAUTH_STATE_COOKIE).options.maxAge, 0);
    assert.equal(response.cookies.get(auth.OAUTH_VERIFIER_COOKIE).options.maxAge, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid OAuth state returns to staging with an error without exchanging a token", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Invalid state must not call Google"); };
  try {
    const response = await callback.GET(request(`${origin}/auth/google/callback?code=test-code&state=bad`));
    assert.equal(response.location, `${origin}/?auth_error=invalid_oauth_state`);
    assert.equal(response.cookies.get(auth.OAUTH_STATE_COOKIE).options.maxAge, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google token errors return to the staging origin", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const startResponse = await start.GET(request(`${origin}/auth/google`));
  const { request: incoming } = callbackRequest(origin, startResponse);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  try {
    const response = await callback.GET(incoming);
    assert.equal(response.location, `${origin}/?auth_error=token_exchange_failed`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signout returns to the request origin", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const response = await signout.GET(request(`${origin}/auth/signout`));
  assert.equal(response.location, origin);
  assert.equal(response.cookies.get(auth.SESSION_COOKIE).options.maxAge, 0);
});
