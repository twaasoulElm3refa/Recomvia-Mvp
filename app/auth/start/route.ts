import { NextResponse } from "next/server";
import { getAppOrigin, signInPath } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export function GET(request: Request) {
  // The chosen identity provider depends on the current deployment, not on a
  // previously cached redirect from a different configuration.
  const response = NextResponse.redirect(new URL(signInPath(), getAppOrigin(request)));
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
