import { getAuthenticatedUser } from "@/app/auth";
import { activePaidSubscriptions, ensureWorkspace } from "@/db/product";
import { isPayPalPaymentsEnabled } from "@/lib/paypal/availability";

export const runtime = "edge";

export async function GET() {
  const paymentsEnabled = isPayPalPaymentsEnabled();
  const checkoutAvailability = {
    starter: paymentsEnabled,
    essential: isPayPalPaymentsEnabled("essential"),
    growth: isPayPalPaymentsEnabled("growth"),
    pro: isPayPalPaymentsEnabled("pro"),
  };
  const user = await getAuthenticatedUser();
  if (!user) return Response.json({ error: "Authentication required", code: "unauthorized", paymentsEnabled, checkoutAvailability }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const workspace = await ensureWorkspace(user);
  const active = await activePaidSubscriptions(workspace.organizationId);
  return Response.json({ currentPlan: active[0]?.status === "active" ? active[0].plan : null, billingConflict: active.length > 1, billingReview: Boolean(active[0] && active[0].status !== "active"), paymentsEnabled, checkoutAvailability }, { headers: { "Cache-Control": "no-store" } });
}
