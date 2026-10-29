import { getAuthenticatedUser } from "@/app/auth";
import { ensureWorkspace, upsertPayPalSubscription } from "@/db/product";
import { verifyAndMapSubscription } from "@/lib/paypal";

export const runtime = "edge";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return json({ error: "Authentication required", code: "unauthorized" }, 401);
  }

  let body: { subscriptionId?: string; plan?: "essential" | "growth" | "pro" };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body", code: "invalid_request" }, 400);
  }

  const subscriptionId = body.subscriptionId?.trim();
  if (!subscriptionId) {
    return json({ error: "subscriptionId is required", code: "missing_subscription_id" }, 400);
  }

  const workspace = await ensureWorkspace(user);

  try {
    const verified = await verifyAndMapSubscription(subscriptionId, {
      organizationId: workspace.organizationId,
      plan: body.plan,
    });

    await upsertPayPalSubscription({
      organizationId: workspace.organizationId,
      plan: verified.verifiedPlan,
      status: verified.mappedState.internalStatus,
      providerSubscriptionId: subscriptionId,
      currentPeriodEnd: verified.nextBillingTime,
      cancelAtPeriodEnd: verified.mappedState.internalStatus === "cancelled",
    });

    return json({
      subscriptionId,
      plan: verified.verifiedPlan,
      status: verified.mappedState.internalStatus,
      paypalStatus: verified.subscription.status,
      currentPeriodEnd: verified.nextBillingTime,
      isActive: verified.mappedState.isActive,
    });
  } catch (err: any) {
    return json(
      { error: err.message || "Failed to verify subscription with PayPal", code: "verification_failed" },
      err.status || 400,
    );
  }
}
