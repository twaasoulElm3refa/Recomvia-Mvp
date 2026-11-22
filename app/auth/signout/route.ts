import { NextResponse } from "next/server";
import { SESSION_COOKIE, authProvider, getAppOrigin, signOutPath } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(request: Request) {
  const origin = getAppOrigin(request);
  const chatgpt = authProvider() === "chatgpt";
  const response = NextResponse.redirect(chatgpt ? new URL(signOutPath(), origin) : origin);
  // Never cache a sign-out redirect: a cached response may skip the cookie
  // deletion or replay an authentication transition across visitors.
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (!chatgpt) {
    response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  }
  return response;
}
