import { NextRequest, NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE, authProvider, constantTimeEqual, createSession, getAppOrigin, getGoogleCallbackUrl, getGoogleCredentials } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

type GoogleTokenResponse = { access_token?: unknown };
type GoogleProfile = { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };

// Google returns small JSON documents. Limit decoded bytes even when a
// successful response omits Content-Length or is compressed in transit.
const MAX_PROVIDER_BODY_BYTES = 32_768;
async function readProviderJson(response: Response): Promise<Record<string, unknown>> {
  const length = response.headers.get("content-length");
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!response.body || mime !== "application/json" ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_PROVIDER_BODY_BYTES))) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Invalid authentication response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    // Fetch's existing abort signal also governs consumption of the body.
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PROVIDER_BODY_BYTES) throw new Error("Oversized authentication response");
      text += decoder.decode(value, { stream: true });
    }
    const result: unknown = JSON.parse(text + decoder.decode());
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Invalid authentication response");
    }
    return result as Record<string, unknown>;
  } catch {
    void reader.cancel().catch(() => undefined);
    throw new Error("Invalid authentication response");
  } finally {
    reader.releaseLock();
  }
}

export async function GET(request: NextRequest) {
  const appOrigin = getAppOrigin(request);
  // Ignore stale callbacks after a provider change without exchanging tokens
  // or replacing any existing authenticated identity.
  if (authProvider() !== "google") {
    const response = NextResponse.redirect(new URL("/auth/start", appOrigin));
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    clearOAuthCookies(response);
    return response;
  }
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const savedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  // The app issues a 32-byte state and 48-byte PKCE verifier. Reject tampered
  // cookies, ambiguous query parameters, and oversized codes before contacting Google.
  if (params.getAll("code").length !== 1 || params.getAll("state").length !== 1 ||
      !code || code.length > 4_096 ||
      !state || !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !savedState || !/^[A-Za-z0-9_-]{43}$/.test(savedState) ||
      !verifier || !/^[A-Za-z0-9_-]{64}$/.test(verifier) ||
      !constantTimeEqual(state, savedState)) return authError(appOrigin, "invalid_oauth_state");

  try {
    const { clientId, clientSecret } = getGoogleCredentials();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      // Never forward OAuth credentials or the authorization code through redirects.
      redirect: "error",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      // A stalled identity provider must not hold the callback worker indefinitely.
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: getGoogleCallbackUrl(request), grant_type: "authorization_code", code_verifier: verifier }),
    });
    // Error bodies are not needed for authentication; release them without parsing.
    if (!tokenResponse.ok) {
      void tokenResponse.body?.cancel().catch(() => undefined);
      return authError(appOrigin, "token_exchange_failed");
    }
    const token = (await readProviderJson(tokenResponse)) as GoogleTokenResponse;
    // Reject malformed tokens before constructing an outbound Authorization header.
    const accessToken = token.access_token;
    if (typeof accessToken !== "string" ||
        accessToken.length < 1 || accessToken.length > 4_096 ||
        !/^[\x21-\x7e]+$/.test(accessToken)) return authError(appOrigin, "token_exchange_failed");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!profileResponse.ok) {
      void profileResponse.body?.cancel().catch(() => undefined);
      return authError(appOrigin, "unverified_google_account");
    }
    const profile = (await readProviderJson(profileResponse)) as GoogleProfile;
    // Bound verified identity claims before signing a session or displaying them.
    // Regular Arabic and Latin display names remain valid; invisible controls do not.
    const { sub, email, name } = profile;
    const unsafeText = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
    if (typeof sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(sub) ||
        typeof email !== "string" || email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || unsafeText.test(email) ||
        profile.email_verified !== true ||
        (name != null && (typeof name !== "string" || name.length > 200 || unsafeText.test(name)))) {
      return authError(appOrigin, "unverified_google_account");
    }

    const response = NextResponse.redirect(`${appOrigin}/dashboard`);
    // Never cache the session redirect or forward the callback URL (code and state).
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.cookies.set(SESSION_COOKIE, await createSession({ sub, email: email.toLowerCase(), name: typeof name === "string" ? name.trim() || null : null }), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
    });
    clearOAuthCookies(response);
    return response;
  } catch {
    return authError(appOrigin, "authentication_failed");
  }
}

function authError(appOrigin: string, reason: string) {
  const response = NextResponse.redirect(`${appOrigin}/?auth_error=${encodeURIComponent(reason)}`);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  clearOAuthCookies(response);
  return response;
}

function clearOAuthCookies(response: NextResponse) {
  for (const name of [OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE]) response.cookies.set(name, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}
