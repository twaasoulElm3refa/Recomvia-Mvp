import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const credentials = {
  AUTH_PROVIDER: "google",
  GOOGLE_CLIENT_ID: "configured-client-id",
  GOOGLE_CLIENT_SECRET: "configured-client-secret",
  AUTH_SECRET: "test-hmac-secret",
};
let mockIdentityHeaders = new Headers();
let mockSessionCookie = null;

class MockResponse {
  constructor(location) {
    this.location = location.toString();
    this.headers = new Headers();
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
  const loadedModule = { exports: {} };
  const requireMock = (specifier) => {
    if (specifier === "cloudflare:workers") return { env: credentials };
    if (specifier === "next/server") return { NextResponse: MockResponse };
    if (specifier === "next/headers") return {
      cookies: async () => ({ get: (name) => name === "__Host-recomvia_session" && mockSessionCookie ? { value: mockSessionCookie } : undefined }),
      headers: async () => mockIdentityHeaders,
    };
    if (specifier === "next/navigation") return { redirect: () => { throw new Error("Unexpected redirect"); } };
    if (specifier === "@/app/auth") return load("app/auth.ts");
    if (specifier === "@/app/chatgpt-auth") return load("app/chatgpt-auth.ts");
    throw new Error(`Unexpected import: ${specifier}`);
  };
  new Function("require", "module", "exports", outputText)(requireMock, loadedModule, loadedModule.exports);
  loaded.set(relativePath, loadedModule.exports);
  return loadedModule.exports;
}

const auth = load("app/auth.ts");
const start = load("app/auth/google/route.ts");
const callback = load("app/auth/google/callback/route.ts");
const signout = load("app/auth/signout/route.ts");
const authStart = load("app/auth/start/route.ts");

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
    assert.equal(response.headers.get("Cache-Control"), "no-store");
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
    assert.equal(response.headers.get("Cache-Control"), "no-store");
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
    assert.equal(response.headers.get("Cache-Control"), "no-store");
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
    assert.equal(response.headers.get("Cache-Control"), "no-store");
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

test("standalone login entry uses Google without accepting identity headers", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  mockIdentityHeaders = new Headers({
    "oai-authenticated-user-id": "spoofed-user",
    "oai-authenticated-user-email": "spoofed@example.com",
  });
  assert.equal(await auth.getAuthenticatedUser(), null);
  assert.equal((await authStart.GET(request(`${origin}/auth/start`))).location, `${origin}/auth/google`);
  mockIdentityHeaders = new Headers();
});

test("Sites login preserves the authenticated platform user and redirects safely", async () => {
  const origin = "https://recomvia-ai-visibility.omarghazi85.chatgpt.site";
  credentials.AUTH_PROVIDER = "chatgpt";
  mockIdentityHeaders = new Headers({
    "oai-authenticated-user-id": "existing-site-user",
    "oai-authenticated-user-email": "owner@example.com",
    "oai-authenticated-user-full-name": encodeURIComponent("عمر"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  try {
    assert.deepEqual(await auth.getAuthenticatedUser(), {
      userId: "existing-site-user", displayName: "عمر", email: "owner@example.com", fullName: "عمر",
    });
    assert.equal(auth.signInPath("//outside.example"), "/signin-with-chatgpt?return_to=%2F");
    assert.equal((await authStart.GET(request(`${origin}/auth/start`))).location, `${origin}/signin-with-chatgpt?return_to=%2Fdashboard`);
    assert.equal((await signout.GET(request(`${origin}/auth/signout`))).location, `${origin}/signout-with-chatgpt?return_to=%2F`);
  } finally {
    credentials.AUTH_PROVIDER = "google";
    mockIdentityHeaders = new Headers();
  }
});

test("Google sessions reject oversized and malformed cookies before crypto work", async () => {
  const secret = credentials.AUTH_SECRET;
  try {
    mockSessionCookie = await auth.createSession({ sub: "user-456", email: "person@example.com", name: "مستخدم تجريبي" });
    assert.deepEqual(await auth.getAuthenticatedUser(), {
      userId: "google:user-456", email: "person@example.com",
      displayName: "مستخدم تجريبي", fullName: "مستخدم تجريبي",
    });
    // Missing secrets make it observable if an invalid request reaches HMAC verification.
    credentials.AUTH_SECRET = "";
    for (const malformed of [
      "A".repeat(4097),
      mockSessionCookie + ".extra",
      "unexpected.invalid",
      "a".repeat(4020) + "!" + "." + "a".repeat(43),
    ]) {
      const result = mockSessionCookie;
      mockSessionCookie = malformed;
      assert.equal(await auth.getAuthenticatedUser(), null);
      mockSessionCookie = result;
    }
  } finally {
    credentials.AUTH_SECRET = secret;
    mockSessionCookie = null;
  }
});

test("Google session verifier rejects signed but invalid claims and extended lifetimes", async () => {
  const secret = credentials.AUTH_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const baseline = { v: 1, sub: "person-456", email: "person@example.com", name: null, iat: now, exp: now + auth.SESSION_MAX_AGE };
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  async function signedCookie(payload) {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded))).toString("base64url");
    return `${encoded}.${signature}`;
  }
  try {
    for (const claims of [
      { ...baseline, email: { value: "person@example.com" } },
      { ...baseline, iat: "not-a-timestamp" },
      { ...baseline, exp: now + auth.SESSION_MAX_AGE * 3 },
      { ...baseline, exp: now - 1 },
    ]) {
      mockSessionCookie = await signedCookie(claims);
      assert.equal(await auth.getAuthenticatedUser(), null);
    }
    mockSessionCookie = await signedCookie(baseline);
    assert.equal((await auth.getAuthenticatedUser())?.userId, "google:person-456");
  } finally {
    mockSessionCookie = null;
  }
});


test("Google callback rejects oversized, duplicate, and malformed OAuth inputs without network calls", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const startResponse = await start.GET(request(`${origin}/auth/google`));
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = () => { externalCalls++; throw new Error("Invalid OAuth input must not reach Google"); };
  try {
    const cases = [
      (incoming) => incoming.nextUrl.searchParams.append("code", "another-code"),
      (incoming) => incoming.nextUrl.searchParams.append("state", "another-state"),
      (incoming) => incoming.nextUrl.searchParams.set("code", "x".repeat(4_097)),
      (incoming) => incoming.nextUrl.searchParams.set("state", "x".repeat(4_097)),
      (incoming) => {
        const getCookie = incoming.cookies.get;
        incoming.cookies = { get: (name) => name === auth.OAUTH_VERIFIER_COOKIE
          ? { value: "x".repeat(65) } : getCookie(name) };
      },
      (incoming) => {
        const getCookie = incoming.cookies.get;
        incoming.cookies = { get: (name) => name === auth.OAUTH_STATE_COOKIE
          ? { value: "invalid-saved-state" } : getCookie(name) };
      },
    ];
    for (const mutate of cases) {
      const { request: incoming } = callbackRequest(origin, startResponse);
      mutate(incoming);
      const response = await callback.GET(incoming);
      assert.equal(response.location, `${origin}/?auth_error=invalid_oauth_state`);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.cookies.get(auth.OAUTH_STATE_COOKIE).options.maxAge, 0);
      assert.equal(response.cookies.get(auth.OAUTH_VERIFIER_COOKIE).options.maxAge, 0);
    }
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
