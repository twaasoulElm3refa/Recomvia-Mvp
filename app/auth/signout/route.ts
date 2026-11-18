import { NextResponse } from "next/server";
import { SESSION_COOKIE, authProvider, getAppOrigin, signOutPath } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(request: Request) {
  if (authProvider() === "chatgpt") return NextResponse.redirect(new URL(signOutPath(), getAppOrigin(request)));
  const response = NextResponse.redirect(getAppOrigin(request));
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
