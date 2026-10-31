import { getAuthenticatedUser } from "@/app/auth";
import { activePaidSubscriptions, claimSubscriptionCheckout, ensureWorkspace, releaseSubscriptionCheckout, upsertPayPalSubscription } from "@/db/product";
import { revisePayPalSubscription, verifyAndMapSubscription } from "@/lib/paypal";
import { isPayPalPaymentsEnabled, paymentNotConfiguredResponse } from "@/lib/paypal/availability";

export const runtime = "edge";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return json({ error: "Authentication required", code: "unauthorized" }, 401);
  if (!isPayPalPaymentsEnabled()) return paymentNotConfiguredResponse();
  let body: { plan?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body", code: "invalid_request" }, 400); }
  const plan = typeof body.plan === "string" ? body.plan.toLowerCase().trim() : null;
  if (plan !== "essential" && plan !== "growth" && plan !== "pro") return json({ error: "Invalid paid plan.", code: "invalid_plan" }, 400);
  if (!isPayPalPaymentsEnabled(plan)) return paymentNotConfiguredResponse();

  const workspace = await ensureWorkspace(user);
  const active = await activePaidSubscriptions(workspace.organizationId);
  if (active.length > 1) return json({ error: "Multiple active PayPal subscriptions require billing review.", code: "billing_conflict" }, 409);
  const current = active[0];
  if (!current) return json({ error: "No active subscription to change.", code: "no_active_subscription" }, 409);
  if (current.status !== "active") return json({ error: "The existing PayPal agreement needs billing review before a plan change.", code: "subscription_review_required" }, 409);
  if (current.plan === plan) return json({ error: "This plan is already active.", code: "already_active", currentPlan: plan }, 409);
  if (current.provider !== "paypal" || !current.providerSubscriptionId) return json({ error: "This subscription cannot be changed through PayPal.", code: "unsupported_provider" }, 409);
  if (!await claimSubscriptionCheckout(workspace.organizationId, plan, "revise", current.providerSubscriptionId))
    return json({ error: "A subscription checkout is already in progress.", code: "checkout_in_progress" }, 409);

  try {
    const verified = await verifyAndMapSubscription(current.providerSubscriptionId, { organizationId: workspace.organizationId, plan: current.plan });
    if (!verified.mappedState.isActive) {
      await releaseSubscriptionCheckout(workspace.organizationId, current.providerSubscriptionId);
      return json({ error: "PayPal no longer reports this subscription as active. Refresh your account before changing plans.", code: "subscription_not_active" }, 409);
    }
    const origin = new URL(request.url).origin;
    const returnUrl = `${origin}/subscriptions?flow=subscription&plan=${plan}&subscription_id=${encodeURIComponent(current.providerSubscriptionId)}`;
    const cancelUrl = `${origin}/subscriptions?flow=cancelled`;
    const revised = await revisePayPalSubscription(current.providerSubscriptionId, plan, returnUrl, cancelUrl);
    if (revised.approveUrl) return json({ subscriptionId: current.providerSubscriptionId, approveUrl: revised.approveUrl, flow: "plan_change" });

    // Some payment methods do not require re-consent. Verify PayPal's current
    // plan before changing the application's entitlement.
    const confirmed = await verifyAndMapSubscription(current.providerSubscriptionId, { organizationId: workspace.organizationId, plan });
    if (!confirmed.mappedState.isActive) throw new Error("PayPal has not confirmed the revised plan.");
    const stored = await upsertPayPalSubscription({ organizationId: workspace.organizationId, plan, status: "active", providerSubscriptionId: current.providerSubscriptionId, currentPeriodEnd: confirmed.nextBillingTime });
    if (!stored.accepted) throw new Error("The revised plan could not be recorded.");
    await releaseSubscriptionCheckout(workspace.organizationId, current.providerSubscriptionId);
    return json({ subscriptionId: current.providerSubscriptionId, flow: "plan_change", isActive: true, plan });
  } catch (error) {
    await releaseSubscriptionCheckout(workspace.organizationId, current.providerSubscriptionId);
    const cause = error as { message?: string; status?: number };
    return json({ error: cause.message || "Could not change the PayPal plan.", code: "plan_change_failed" }, cause.status || 500);
  }
}
