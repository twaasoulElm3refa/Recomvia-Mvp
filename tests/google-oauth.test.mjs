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
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  for (const name of [auth.SESSION_COOKIE, auth.OAUTH_STATE_COOKIE, auth.OAUTH_VERIFIER_COOKIE]) {
    assert.equal(response.cookies.get(name).value, "");
    assert.deepEqual(response.cookies.get(name).options, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0,
    });
  }
});

test("signout cancels pending Google OAuth before a later callback can exchange tokens", async () => {
  const origin = "https://recomvia.test";
  const started = await start.GET(request(origin + "/auth/google"));
  const { request: pending } = callbackRequest(origin, started);
  const browserCookies = new Map(started.cookies.values);
  const signedOut = await signout.GET(request(origin + "/auth/signout"));
  for (const [name, cookie] of signedOut.cookies.values) {
    if (cookie.options.maxAge === 0) browserCookies.delete(name);
  }
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Abandoned OAuth must not contact Google"); };
  try {
    const response = await callback.GET(request(pending.url, browserCookies));
    assert.equal(response.location, origin + "/?auth_error=invalid_oauth_state");
    assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    const chatgptSignout = await signout.GET(request(`${origin}/auth/signout`));
    assert.equal(chatgptSignout.location, `${origin}/signout-with-chatgpt?return_to=%2F`);
    assert.equal(chatgptSignout.headers.get("Cache-Control"), "private, no-store, max-age=0");
    assert.equal(chatgptSignout.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(chatgptSignout.cookies.get(auth.SESSION_COOKIE), undefined,
      "The hosted ChatGPT identity provider, not the standalone cookie, handles its own sign-out");
  } finally {
    credentials.AUTH_PROVIDER = "google";
    mockIdentityHeaders = new Headers();
  }
});

test("Sites authentication rejects network paths exposed by normalization", () => {
  const provider = credentials.AUTH_PROVIDER;
  credentials.AUTH_PROVIDER = "chatgpt";
  try {
    for (const path of [
      "//outside.example",
      "/a/..//outside.example",
      "/%2e%2e//outside.example",
      "/a/../\\outside.example",
      "/%2Foutside.example",
      "/%5coutside.example",
    ]) {
      assert.equal(auth.signInPath(path), "/signin-with-chatgpt?return_to=%2F", path);
      assert.equal(auth.signOutPath(path), "/signout-with-chatgpt?return_to=%2F", path);
    }
    for (const [path, expected] of [
      ["/a/../dashboard", "/dashboard"],
      ["/ar/blog?from=%2Fdashboard#intro", "/ar/blog?from=%2Fdashboard#intro"],
    ]) {
      assert.equal(auth.signInPath(path), "/signin-with-chatgpt?return_to=" + encodeURIComponent(expected));
      assert.equal(auth.signOutPath(path), "/signout-with-chatgpt?return_to=" + encodeURIComponent(expected));
    }
  } finally {
    credentials.AUTH_PROVIDER = provider;
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

test("Google session verification fails closed when the deployment secret is unavailable", async () => {
  const secret = credentials.AUTH_SECRET;
  try {
    mockSessionCookie = await auth.createSession({ sub: "user-456", email: "person@example.com", name: null });
    assert.equal((await auth.getAuthenticatedUser())?.userId, "google:user-456");
    for (const missingSecret of [undefined, "", "   "]) {
      credentials.AUTH_SECRET = missingSecret;
      assert.equal(await auth.getAuthenticatedUser(), null);
      await assert.rejects(auth.createSession({ sub: "user-456", email: "person@example.com", name: null }), /Authentication is not configured/);
    }
    credentials.AUTH_SECRET = secret;
    assert.equal((await auth.getAuthenticatedUser())?.userId, "google:user-456");
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

test("Google callback bounds both identity provider requests with separate 10-second signals", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const startResponse = await start.GET(request(`${origin}/auth/google`));
  const { request: incoming } = callbackRequest(origin, startResponse);
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const deadlines = [];
  const signals = [];
  try {
    AbortSignal.timeout = (milliseconds) => {
      deadlines.push(milliseconds);
      const signal = new AbortController().signal;
      signals.push(signal);
      return signal;
    };
    globalThis.fetch = async (url, options) => {
      assert.equal(options.signal, signals[signals.length - 1], `Missing timeout on ${url}`);
      assert.equal(options.redirect, "error", `Provider redirects must be blocked on ${url}`);
      if (url === "https://oauth2.googleapis.com/token") {
        return { ok: true, json: async () => ({ access_token: "test-token" }) };
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return { ok: true, json: async () => ({ sub: "user-789", email: "owner@example.com", email_verified: true }) };
      }
      throw new Error(`Unexpected identity provider URL: ${url}`);
    };
    const response = await callback.GET(incoming);
    assert.equal(response.location, `${origin}/dashboard`);
    assert.deepEqual(deadlines, [10_000, 10_000]);
    assert.notEqual(signals[0], signals[1], "Each provider request needs a fresh deadline");
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});

test("Google callback fails closed and clears transient OAuth cookies when either provider times out", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const originalFetch = globalThis.fetch;
  try {
    for (const failingUrl of [
      "https://oauth2.googleapis.com/token",
      "https://openidconnect.googleapis.com/v1/userinfo",
    ]) {
      const startResponse = await start.GET(request(`${origin}/auth/google`));
      const { request: incoming } = callbackRequest(origin, startResponse);
      const requests = [];
      globalThis.fetch = async (url, options) => {
        requests.push(url);
        assert.ok(options.signal instanceof AbortSignal, "Provider fetch must carry a timeout signal");
        if (url === failingUrl) throw new DOMException("Identity provider timeout", "TimeoutError");
        if (url === "https://oauth2.googleapis.com/token") {
          return { ok: true, json: async () => ({ access_token: "test-token" }) };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };
      const response = await callback.GET(incoming);
      assert.equal(response.location, `${origin}/?auth_error=authentication_failed`);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
      assert.equal(response.cookies.get(auth.OAUTH_STATE_COOKIE).options.maxAge, 0);
      assert.equal(response.cookies.get(auth.OAUTH_VERIFIER_COOKIE).options.maxAge, 0);
      assert.equal(requests.length, failingUrl.includes("/userinfo") ? 2 : 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Google callback rejects malformed or oversized access tokens before userinfo", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const originalFetch = globalThis.fetch;
  try {
    for (const accessToken of [null, 42, {}, "", "bad token", "bad\nheader", "x".repeat(4_097)]) {
      const started = await start.GET(request(origin + "/auth/google"));
      const { request: incoming } = callbackRequest(origin, started);
      const requests = [];
      globalThis.fetch = async (url) => {
        requests.push(url);
        if (url === "https://oauth2.googleapis.com/token") {
          return { ok: true, json: async () => ({ access_token: accessToken }) };
        }
        throw new Error("Malformed token must not be sent to userinfo");
      };
      const response = await callback.GET(incoming);
      assert.equal(response.location, origin + "/?auth_error=token_exchange_failed");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
      assert.equal(response.cookies.get(auth.OAUTH_STATE_COOKIE).options.maxAge, 0);
      assert.equal(response.cookies.get(auth.OAUTH_VERIFIER_COOKIE).options.maxAge, 0);
      assert.deepEqual(requests, ["https://oauth2.googleapis.com/token"]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google callback rejects malformed identity claims without creating sessions", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const originalFetch = globalThis.fetch;
  const baseline = { sub: "user-123", email: "USER@example.org", email_verified: true, name: "مستخدم عربي" };
  const invalidProfiles = [
    { ...baseline, sub: 123 },
    { ...baseline, sub: "x".repeat(256) },
    { ...baseline, sub: "abc\n" },
    { ...baseline, email: {} },
    { ...baseline, email: "not-an-email" },
    { ...baseline, email: "x".repeat(246) + "@test.org" },
    { ...baseline, email: "x\u202ee@example.org" },
    { ...baseline, email_verified: "true" },
    { ...baseline, name: { invalid: "object" } },
    { ...baseline, name: "x".repeat(201) },
    { ...baseline, name: "اسم\u2066مضلل" },
  ];
  try {
    for (const profile of invalidProfiles) {
      const started = await start.GET(request(origin + "/auth/google"));
      const { request: incoming } = callbackRequest(origin, started);
      let requests = 0;
      globalThis.fetch = async (url) => {
        requests++;
        if (url === "https://oauth2.googleapis.com/token")
          return { ok: true, json: async () => ({ access_token: "safe-token" }) };
        if (url === "https://openidconnect.googleapis.com/v1/userinfo")
          return { ok: true, json: async () => profile };
        throw new Error("Unexpected identity URL");
      };
      const response = await callback.GET(incoming);
      assert.equal(response.location, origin + "/?auth_error=unverified_google_account");
      assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
      assert.equal(response.cookies.get(auth.OAUTH_STATE_COOKIE).options.maxAge, 0);
      assert.equal(response.cookies.get(auth.OAUTH_VERIFIER_COOKIE).options.maxAge, 0);
      assert.equal(requests, 2);
    }
    const started = await start.GET(request(origin + "/auth/google"));
    const { request: incoming } = callbackRequest(origin, started);
    globalThis.fetch = async (url) => ({
      ok: true, json: async () => url === "https://oauth2.googleapis.com/token"
        ? { access_token: "safe-token" } : baseline,
    });
    const accepted = await callback.GET(incoming);
    assert.equal(accepted.location, origin + "/dashboard");
    assert.ok(accepted.cookies.get(auth.SESSION_COOKIE)?.value, "Arabic display name must remain supported");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Sites blocks direct and stale Google OAuth routes before credentials or network access", async () => {
  const origin = "https://recomvia-ai-visibility.omarghazi85.chatgpt.site";
  const started = await start.GET(request(origin + "/auth/google"));
  const { request: incoming } = callbackRequest(origin, started);
  const originalFetch = globalThis.fetch;
  const originalClientId = credentials.GOOGLE_CLIENT_ID;
  let calls = 0;
  credentials.AUTH_PROVIDER = "chatgpt";
  credentials.GOOGLE_CLIENT_ID = "";
  globalThis.fetch = async () => { calls++; throw new Error("Inactive provider must not contact Google"); };
  try {
    const direct = await start.GET(request(origin + "/auth/google"));
    const stale = await callback.GET(incoming);
    for (const response of [direct, stale]) {
      assert.equal(response.location, origin + "/auth/start");
      assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
    }
    assert.equal(direct.cookies.get(auth.OAUTH_STATE_COOKIE), undefined);
    assert.equal(direct.cookies.get(auth.OAUTH_VERIFIER_COOKIE), undefined);
    assert.equal(stale.cookies.get(auth.OAUTH_STATE_COOKIE).options.maxAge, 0);
    assert.equal(stale.cookies.get(auth.OAUTH_VERIFIER_COOKIE).options.maxAge, 0);
    assert.equal(calls, 0);
  } finally {
    credentials.AUTH_PROVIDER = "google";
    credentials.GOOGLE_CLIENT_ID = originalClientId;
    globalThis.fetch = originalFetch;
  }
});

test("auth entry always resolves the current provider and prevents cached redirects", async () => {
  const origin = "https://recomvia.test";
  try {
    for (const [provider, path] of [
      ["google", "/auth/google"],
      ["chatgpt", "/signin-with-chatgpt?return_to=%2Fdashboard"],
      ["google", "/auth/google"],
    ]) {
      credentials.AUTH_PROVIDER = provider;
      const response = authStart.GET(request(origin + "/auth/start"));
      assert.equal(response.location, origin + path);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(response.cookies.values.size, 0);
    }
  } finally {
    credentials.AUTH_PROVIDER = "google";
  }
});


test("Google OAuth rejects redirects at either provider endpoint without following them or creating a session", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const originalFetch = globalThis.fetch;
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const profileUrl = "https://openidconnect.googleapis.com/v1/userinfo";
  try {
    for (const redirectingUrl of [tokenUrl, profileUrl]) {
      const started = await start.GET(request(origin + "/auth/google"));
      const { request: incoming } = callbackRequest(origin, started);
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push(url);
        assert.equal(options.redirect, "error");
        // Fetch with redirect:error rejects an HTTP redirect before following it.
        if (url === redirectingUrl) throw new TypeError("Unexpected redirect");
        if (url === tokenUrl) return { ok: true, json: async () => ({ access_token: "test-token" }) };
        throw new Error("Unexpected provider request");
      };
      const response = await callback.GET(incoming);
      assert.equal(response.location, origin + "/?auth_error=authentication_failed");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
      assert.equal(response.cookies.get(auth.OAUTH_STATE_COOKIE).options.maxAge, 0);
      assert.equal(response.cookies.get(auth.OAUTH_VERIFIER_COOKIE).options.maxAge, 0);
      assert.deepEqual(calls, redirectingUrl === tokenUrl ? [tokenUrl] : [tokenUrl, profileUrl]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google OAuth start safely rejects missing credentials and recovers after configuration", async () => {
  const origin = "https://recomvia-staging.recomvia.workers.dev";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Login start must not contact the provider"); };
  try {
    for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_SECRET"]) {
      const configured = credentials[key];
      try {
        for (const missing of [undefined, "", "   "]) {
          credentials[key] = missing;
          const response = await start.GET(request(origin + "/auth/google"));
          assert.equal(response.location, origin + "/?auth_error=authentication_failed");
          assert.equal(response.headers.get("Cache-Control"), "no-store");
          assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
          assert.equal(response.cookies.get(auth.SESSION_COOKIE), undefined);
          for (const name of [auth.OAUTH_STATE_COOKIE, auth.OAUTH_VERIFIER_COOKIE]) {
            assert.equal(response.cookies.get(name).value, "");
            assert.deepEqual(response.cookies.get(name).options, {
              httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0,
            });
          }
        }
      } finally {
        credentials[key] = configured;
      }
    }
    const restored = await start.GET(request(origin + "/auth/google"));
    assert.equal(new URL(restored.location).origin, "https://accounts.google.com");
    assert.equal(restored.cookies.get(auth.OAUTH_STATE_COOKIE).options.maxAge, 600);
    assert.equal(restored.cookies.get(auth.OAUTH_VERIFIER_COOKIE).options.maxAge, 600);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
