import { NextResponse } from "next/server";
import { getAppOrigin, signInPath } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export function GET(request: Request) {
  return NextResponse.redirect(new URL(signInPath(), getAppOrigin(request)));
}
