import { NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, authProvider, getAppOrigin, getGoogleCallbackUrl, getGoogleCredentials, randomBase64Url, sha256Base64Url } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(request: Request) {
  // Hosted Sites must not start a second identity provider, even if Google
  // credentials happen to be present in the deployment environment.
  if (authProvider() !== "google") {
    const response = NextResponse.redirect(new URL("/auth/start", getAppOrigin(request)));
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  }
  const { clientId } = getGoogleCredentials();
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", getGoogleCallbackUrl(request));
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", await sha256Base64Url(verifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");
  const response = NextResponse.redirect(authorizationUrl);
  // OAuth state and PKCE verifier are single-use secrets: never cache this redirect.
  response.headers.set("Cache-Control", "no-store");
  const options = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
  response.cookies.set(OAUTH_STATE_COOKIE, state, options);
  response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, options);
  return response;
}
