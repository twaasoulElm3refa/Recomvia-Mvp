import { NextResponse } from "next/server";
import { GOOGLE_CALLBACK_URL, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, getGoogleCredentials, randomBase64Url, sha256Base64Url } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET() {
  const { clientId } = getGoogleCredentials();
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", GOOGLE_CALLBACK_URL);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", await sha256Base64Url(verifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");
  const response = NextResponse.redirect(authorizationUrl);
  const options = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
  response.cookies.set(OAUTH_STATE_COOKIE, state, options);
  response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, options);
  return response;
}
