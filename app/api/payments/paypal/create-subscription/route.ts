import { getAuthenticatedUser } from "@/app/auth";
import { ensureWorkspace, upsertPayPalSubscription } from "@/db/product";
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

  const rawPlan = body.plan?.toLowerCase().trim();
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
  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/subscriptions?flow=subscription&plan=${rawPlan}`;
  const cancelUrl = `${origin}/subscriptions?flow=cancelled`;

  try {
    const { subscriptionId, approveUrl } = await createPayPalSubscription({
      plan: rawPlan,
      organizationId: workspace.organizationId,
      returnUrl,
      cancelUrl,
    });

    // Record initial inactive subscription record
    await upsertPayPalSubscription({
      organizationId: workspace.organizationId,
      plan: rawPlan,
      status: "inactive",
      providerSubscriptionId: subscriptionId,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });

    return json({ subscriptionId, approveUrl });
  } catch (err: any) {
    return json(
      { error: err.message || "Failed to create PayPal subscription", code: "paypal_error" },
      err.status || 500,
    );
  }
}
