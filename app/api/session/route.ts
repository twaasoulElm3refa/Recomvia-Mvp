import { getAuthenticatedUser } from "@/app/auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET() {
  const user = await getAuthenticatedUser();
  return Response.json({ signedIn: Boolean(user) }, { headers: { "Cache-Control": "no-store" } });
}
