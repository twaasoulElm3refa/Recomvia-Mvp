import { getAuthenticatedUser } from "@/app/auth";
import { activePaidSubscriptions, attachSubscriptionCheckout, claimSubscriptionCheckout, ensureWorkspace, releaseSubscriptionCheckout, upsertPayPalSubscription } from "@/db/product";
import { createPayPalSubscription } from "@/lib/paypal";

export const runtime = "edge";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return json({ error: "Authentication required", code: "unauthorized" }, 401);
  }

  let body: { plan?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body", code: "invalid_request" }, 400);
  }

  const rawPlan = typeof body.plan === "string" ? body.plan.toLowerCase().trim() : null;
  if (rawPlan !== "essential" && rawPlan !== "growth" && rawPlan !== "pro") {
    return json(
      {
        error: "Invalid plan. Only essential, growth, and pro are supported subscription plans.",
        code: "invalid_plan",
      },
      400,
    );
  }

  const workspace = await ensureWorkspace(user);
  const active = await activePaidSubscriptions(workspace.organizationId);
  if (active.length > 1) return json({ error: "Multiple active PayPal subscriptions require billing review before another checkout.", code: "billing_conflict" }, 409);
  if (active[0] && active[0].status !== "active") return json({ error: "An existing PayPal agreement needs billing review before another checkout.", code: "subscription_review_required" }, 409);
  if (active[0]) return json(active[0].plan === rawPlan
    ? { error: "This plan is already active.", code: "already_active", currentPlan: active[0].plan }
    : { error: "Change the current plan instead of starting a second subscription.", code: "plan_change_required", currentPlan: active[0].plan, targetPlan: rawPlan }, 409);
  if (!await claimSubscriptionCheckout(workspace.organizationId, rawPlan, "create"))
    return json({ error: "A subscription checkout is already in progress.", code: "checkout_in_progress" }, 409);
  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/subscriptions?flow=subscription&plan=${rawPlan}`;
  const cancelUrl = `${origin}/subscriptions?flow=cancelled`;

  try {
    // Close the gap between the initial read and the organization claim.
    if ((await activePaidSubscriptions(workspace.organizationId)).length) {
      await releaseSubscriptionCheckout(workspace.organizationId);
      return json({ error: "An active plan appeared while checkout was starting.", code: "plan_change_required" }, 409);
    }
    const { subscriptionId, approveUrl } = await createPayPalSubscription({
      plan: rawPlan,
      organizationId: workspace.organizationId,
      returnUrl,
      cancelUrl,
    });

    if (!approveUrl) throw new Error("PayPal did not provide an approval URL.");
    const stored = await upsertPayPalSubscription({
      organizationId: workspace.organizationId,
      plan: rawPlan,
      status: "inactive",
      providerSubscriptionId: subscriptionId,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    if (!stored.accepted) throw new Error("Subscription ownership could not be recorded.");
    await attachSubscriptionCheckout(workspace.organizationId, subscriptionId);

    return json({ subscriptionId, approveUrl });
  } catch (err: any) {
    await releaseSubscriptionCheckout(workspace.organizationId);
    return json(
      { error: err.message || "Failed to create PayPal subscription", code: "paypal_error" },
      err.status || 500,
    );
  }
}
