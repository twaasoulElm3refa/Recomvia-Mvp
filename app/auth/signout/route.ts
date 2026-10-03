import { NextResponse } from "next/server";
import { APP_ORIGIN, SESSION_COOKIE } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET() {
  const response = NextResponse.redirect(APP_ORIGIN);
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
