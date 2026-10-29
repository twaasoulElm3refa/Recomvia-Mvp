import { getAuthenticatedUser } from "@/app/auth";
import { activePaidSubscriptions, ensureWorkspace } from "@/db/product";

export const runtime = "edge";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return Response.json({ error: "Authentication required", code: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const workspace = await ensureWorkspace(user);
  const active = await activePaidSubscriptions(workspace.organizationId);
  return Response.json({ currentPlan: active[0]?.status === "active" ? active[0].plan : null, billingConflict: active.length > 1, billingReview: Boolean(active[0] && active[0].status !== "active") }, { headers: { "Cache-Control": "no-store" } });
}
