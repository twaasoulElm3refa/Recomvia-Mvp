import { paypalRequest, PayPalError } from "./client";
import { getPayPalPlanId, getPlanFromPayPalPlanId, getPayPalConfig } from "./config";
import { mapPayPalSubscriptionStatus, type MappedSubscriptionState } from "./status-mapping";
import type { PayPalConfig, PayPalSubscription, PayPalTransport } from "./types";

export type SubscriptionCustomData = {
  organizationId: string;
  plan: "essential" | "growth" | "pro";
};

export function serializeSubscriptionCustomId(data: SubscriptionCustomData): string {
  return `${data.organizationId}:${data.plan}`;
}

export function parseSubscriptionCustomId(
  customId: string | null | undefined,
): SubscriptionCustomData | null {
  if (!customId) return null;
  const parts = customId.split(":");
  if (parts.length >= 2 && parts[0] && parts[1]) {
    const plan = parts[1].toLowerCase().trim();
    if (plan === "essential" || plan === "growth" || plan === "pro") {
      return {
        organizationId: parts[0],
        plan,
      };
    }
  }
  try {
    const parsed = JSON.parse(customId);
    const plan = String(parsed.plan || "").toLowerCase().trim();
    if (parsed.organizationId && (plan === "essential" || plan === "growth" || plan === "pro")) {
      return {
        organizationId: String(parsed.organizationId),
        plan: plan as "essential" | "growth" | "pro",
      };
    }
  } catch {
    // not JSON
  }
  return null;
}

export async function createPayPalSubscription(
  params: {
    plan: "essential" | "growth" | "pro";
    organizationId: string;
    returnUrl?: string;
    cancelUrl?: string;
  },
  options: {
    config?: Partial<PayPalConfig>;
    transport?: PayPalTransport;
  } = {},
): Promise<{
  subscriptionId: string;
  approveUrl: string | null;
  subscription: PayPalSubscription;
}> {
  const config = getPayPalConfig(options.config);
  const planId = getPayPalPlanId(params.plan, config);

  const customId = serializeSubscriptionCustomId({
    organizationId: params.organizationId,
    plan: params.plan,
  });

  const body = {
    plan_id: planId,
    custom_id: customId,
    application_context: {
      brand_name: "Recomvia",
      user_action: "SUBSCRIBE_NOW",
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
    },
  };

  const subscription = await paypalRequest<PayPalSubscription>(
    "/v1/billing/subscriptions",
    {
      method: "POST",
      body,
      config,
      transport: options.transport,
    },
  );

  const approveLink = subscription.links?.find((l) => l.rel === "approve");

  return {
    subscriptionId: subscription.id,
    approveUrl: approveLink?.href || null,
    subscription,
  };
}

export async function getPayPalSubscription(
  subscriptionId: string,
  options: {
    config?: Partial<PayPalConfig>;
    transport?: PayPalTransport;
  } = {},
): Promise<PayPalSubscription> {
  return paypalRequest<PayPalSubscription>(
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "GET",
      config: options.config,
      transport: options.transport,
    },
  );
}

/** Revise the existing PayPal agreement; PayPal approval is required before
 * its new plan can be used as an entitlement. No second agreement is created. */
export async function revisePayPalSubscription(
  subscriptionId: string,
  plan: "essential" | "growth" | "pro",
  returnUrl: string,
  cancelUrl: string,
  options: { config?: Partial<PayPalConfig>; transport?: PayPalTransport } = {},
) {
  const config = getPayPalConfig(options.config);
  const revised = await paypalRequest<{ links?: PayPalSubscription["links"] }>(
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/revise`,
    {
      method: "POST",
      body: {
        plan_id: getPayPalPlanId(plan, config),
        application_context: { return_url: returnUrl, cancel_url: cancelUrl },
      },
      config,
      transport: options.transport,
    },
  );
  return { approveUrl: revised.links?.find((link) => link.rel === "approve")?.href ?? null };
}

export async function cancelConflictingPayPalSubscription(
  subscriptionId: string,
  options: { config?: Partial<PayPalConfig>; transport?: PayPalTransport } = {},
) {
  await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: "POST",
    body: { reason: "Duplicate active organization subscription" },
    ...options,
  });
  const confirmed = await getPayPalSubscription(subscriptionId, options);
  if (confirmed.status !== "CANCELLED") throw new PayPalError("PayPal has not confirmed cancellation of the conflicting subscription.", 409);
}

export async function verifyAndMapSubscription(
  subscriptionId: string,
  expected: {
    organizationId: string;
    plan?: "essential" | "growth" | "pro";
  },
  options: {
    config?: Partial<PayPalConfig>;
    transport?: PayPalTransport;
  } = {},
): Promise<{
  subscription: PayPalSubscription;
  verifiedPlan: "essential" | "growth" | "pro";
  mappedState: MappedSubscriptionState;
  nextBillingTime: string | null;
}> {
  const config = getPayPalConfig(options.config);
  const subscription = await getPayPalSubscription(subscriptionId, options);

  // Validate plan
  const verifiedPlan = getPlanFromPayPalPlanId(subscription.plan_id, config);
  if (!verifiedPlan) {
    throw new PayPalError(
      `PayPal subscription plan "${subscription.plan_id}" does not match any configured Recomvia plan.`,
      400,
    );
  }

  if (expected.plan && verifiedPlan !== expected.plan) {
    throw new PayPalError(
      `Plan mismatch. Expected "${expected.plan}", but PayPal subscription has "${verifiedPlan}".`,
      400,
    );
  }

  // Validate custom reconciliation data if present
  if (subscription.custom_id) {
    const customData = parseSubscriptionCustomId(subscription.custom_id);
    if (customData && customData.organizationId !== expected.organizationId) {
      throw new PayPalError(
        "Subscription organization ownership mismatch.",
        403,
      );
    }
  }

  const mappedState = mapPayPalSubscriptionStatus(subscription.status);
  const nextBillingTime = subscription.billing_info?.next_billing_time || null;

  return {
    subscription,
    verifiedPlan,
    mappedState,
    nextBillingTime,
  };
}
