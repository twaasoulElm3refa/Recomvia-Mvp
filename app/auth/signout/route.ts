import { NextResponse } from "next/server";
import { SESSION_COOKIE, getAppOrigin } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(request: Request) {
  const response = NextResponse.redirect(getAppOrigin(request));
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
