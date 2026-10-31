import { getAuthenticatedUser } from "@/app/auth";
import { ensureWorkspace, paypalSubscriptionOwner, releaseSubscriptionCheckout, upsertPayPalSubscription } from "@/db/product";
import { cancelConflictingPayPalSubscription, verifyAndMapSubscription } from "@/lib/paypal";
import { isPayPalPaymentsEnabled, paymentNotConfiguredResponse } from "@/lib/paypal/availability";

export const runtime = "edge";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return json({ error: "Authentication required", code: "unauthorized" }, 401);
  }
  if (!isPayPalPaymentsEnabled()) return paymentNotConfiguredResponse();

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
  const owner = await paypalSubscriptionOwner(subscriptionId);
  if (!owner || owner.organizationId !== workspace.organizationId)
    return json({ error: "Subscription does not belong to this organization.", code: "subscription_not_found" }, 404);
  if (!isPayPalPaymentsEnabled(owner.plan as "essential" | "growth" | "pro") ||
      (body.plan && !isPayPalPaymentsEnabled(body.plan))) return paymentNotConfiguredResponse();

  try {
    const verified = await verifyAndMapSubscription(subscriptionId, {
      organizationId: workspace.organizationId,
      plan: body.plan,
    });

    if (owner.status === "active" && verified.mappedState.internalStatus === "inactive") {
      // PayPal keeps billing the old plan until the buyer approves a revision.
      return json({ subscriptionId, plan: owner.plan, status: "active", paypalStatus: verified.subscription.status, isActive: false, pendingPlanChange: true });
    }

    const stored = await upsertPayPalSubscription({
      organizationId: workspace.organizationId,
      plan: verified.verifiedPlan,
      status: verified.mappedState.internalStatus,
      providerSubscriptionId: subscriptionId,
      currentPeriodEnd: verified.nextBillingTime,
      cancelAtPeriodEnd: verified.mappedState.internalStatus === "cancelled",
    });
    if (!stored.accepted) {
      if (verified.mappedState.isActive && owner.status !== "active") {
        await cancelConflictingPayPalSubscription(subscriptionId);
        await upsertPayPalSubscription({ organizationId: workspace.organizationId, plan: verified.verifiedPlan, status: "cancelled", providerSubscriptionId: subscriptionId, cancelAtPeriodEnd: true });
        await releaseSubscriptionCheckout(workspace.organizationId, subscriptionId);
      }
      return json({ error: "Another paid subscription is already active. The conflicting checkout was cancelled or requires billing review.", code: "billing_conflict" }, 409);
    }
    if (verified.mappedState.isActive || ["cancelled", "suspended", "expired", "payment_failed"].includes(verified.mappedState.internalStatus))
      await releaseSubscriptionCheckout(workspace.organizationId, subscriptionId);

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
