import { getAuthenticatedUser } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    return Response.json({ signedIn: Boolean(user) }, { headers });
  } catch {
    // A transient identity failure is not an anonymous session. Never expose
    // provider or cookie diagnostics or allow error responses to be cached.
    return Response.json({ code: "temporarily_unavailable" }, { status: 503, headers });
  }
}
