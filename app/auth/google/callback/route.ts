import { NextRequest, NextResponse } from "next/server";
import { APP_ORIGIN, GOOGLE_CALLBACK_URL, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE, constantTimeEqual, createSession, getGoogleCredentials } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

type GoogleTokenResponse = { access_token?: string };
type GoogleProfile = { sub?: string; email?: string; email_verified?: boolean; name?: string };

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  if (!code || !state || !savedState || !verifier || !constantTimeEqual(state, savedState)) return authError("invalid_oauth_state");

  try {
    const { clientId, clientSecret } = getGoogleCredentials();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: GOOGLE_CALLBACK_URL, grant_type: "authorization_code", code_verifier: verifier }),
    });
    const token = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!tokenResponse.ok || !token.access_token) return authError("token_exchange_failed");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } });
    const profile = (await profileResponse.json()) as GoogleProfile;
    if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) return authError("unverified_google_account");

    const response = NextResponse.redirect(`${APP_ORIGIN}/dashboard`);
    response.cookies.set(SESSION_COOKIE, await createSession({ sub: profile.sub, email: profile.email.toLowerCase(), name: profile.name?.trim() || null }), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
    });
    clearOAuthCookies(response);
    return response;
  } catch {
    return authError("authentication_failed");
  }
}

function authError(reason: string) {
  const response = NextResponse.redirect(`${APP_ORIGIN}/?auth_error=${encodeURIComponent(reason)}`);
  clearOAuthCookies(response);
  return response;
}

function clearOAuthCookies(response: NextResponse) {
  for (const name of [OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE]) response.cookies.set(name, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}
