import { paypalRequest, PayPalError } from "./client";
import { getPayPalConfig, getPlanFromPayPalPlanId } from "./config";
import { mapPayPalSubscriptionStatus } from "./status-mapping";
import { parseStarterCustomId, STARTER_CURRENCY, STARTER_PRICE_AMOUNT, STARTER_AMOUNT_CENTS } from "./orders";
import { parseSubscriptionCustomId } from "./subscriptions";
import type {
  PayPalConfig,
  PayPalTransport,
  PayPalWebhookEvent,
  PayPalWebhookHeaders,
} from "./types";

export function extractWebhookHeaders(headers: Headers): PayPalWebhookHeaders {
  return {
    authAlgo: headers.get("paypal-auth-algo") || headers.get("PAYPAL-AUTH-ALGO"),
    certUrl: headers.get("paypal-cert-url") || headers.get("PAYPAL-CERT-URL"),
    transmissionId: headers.get("paypal-transmission-id") || headers.get("PAYPAL-TRANSMISSION-ID"),
    transmissionSig: headers.get("paypal-transmission-sig") || headers.get("PAYPAL-TRANSMISSION-SIG"),
    transmissionTime: headers.get("paypal-transmission-time") || headers.get("PAYPAL-TRANSMISSION-TIME"),
  };
}

/**
 * Verifies webhook signature with PayPal's official verification API.
 * Rejects unverified or missing signature webhooks.
 */
export async function verifyWebhookSignature(
  headers: PayPalWebhookHeaders,
  webhookEvent: Record<string, unknown>,
  options: {
    config?: Partial<PayPalConfig>;
    transport?: PayPalTransport;
  } = {},
): Promise<boolean> {
  const config = getPayPalConfig(options.config);

  if (!config.PAYPAL_WEBHOOK_ID) {
    throw new PayPalError(
      "PAYPAL_WEBHOOK_ID is not configured. Webhook verification is required.",
      500,
    );
  }

  if (
    !headers.authAlgo ||
    !headers.certUrl ||
    !headers.transmissionId ||
    !headers.transmissionSig ||
    !headers.transmissionTime
  ) {
    return false;
  }

  const verificationBody = {
    auth_algo: headers.authAlgo,
    cert_url: headers.certUrl,
    transmission_id: headers.transmissionId,
    transmission_sig: headers.transmissionSig,
    transmission_time: headers.transmissionTime,
    webhook_id: config.PAYPAL_WEBHOOK_ID,
    webhook_event: webhookEvent,
  };

  try {
    const result = await paypalRequest<{ verification_status: string }>(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: verificationBody,
        config,
        transport: options.transport,
      },
    );

    return result.verification_status?.toUpperCase() === "SUCCESS";
  } catch (err) {
    return false;
  }
}

export type DbExecutor = {
  prepare: (query: string) => {
    bind: (...values: any[]) => {
      run: () => Promise<any>;
      first: <T = any>(col?: string) => Promise<T | null>;
      all: <T = any>() => Promise<{ results: T[] }>;
    };
  };
};

/**
 * Processes a verified PayPal webhook event with full idempotency.
 */
export async function processVerifiedWebhookEvent(
  db: DbExecutor,
  event: PayPalWebhookEvent,
  options: { config?: Partial<PayPalConfig> } = {},
): Promise<{
  processed: boolean;
  duplicate: boolean;
  action: string;
}> {
  const eventId = event.id;
  if (!eventId) {
    throw new PayPalError("Missing webhook event id.", 400);
  }

  // 1. Idempotency check via payment_events table
  const existingEvent = await db
    .prepare("SELECT id FROM payment_events WHERE id = ? LIMIT 1")
    .bind(eventId)
    .first<{ id: string }>();

  if (existingEvent) {
    return { processed: false, duplicate: true, action: "already_processed" };
  }

  const config = getPayPalConfig(options.config);
  const resource = event.resource || {};
  let actionTaken = "none";

  switch (event.event_type) {
    // ----------------------------------------------------
    // Subscriptions
    // ----------------------------------------------------
    case "BILLING.SUBSCRIPTION.CREATED": {
      const subId = resource.id;
      const customData = parseSubscriptionCustomId(resource.custom_id);
      if (subId && customData) {
        await db
          .prepare(
            `
          INSERT INTO subscriptions (id, organization_id, plan, status, provider, provider_subscription_id, current_period_end)
          VALUES (?, ?, ?, 'inactive', 'paypal', ?, ?)
          ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
            status = 'inactive',
            updated_at = CURRENT_TIMESTAMP
        `,
          )
          .bind(
            `sub_${subId.slice(0, 36)}`,
            customData.organizationId,
            customData.plan,
            subId,
            resource.billing_info?.next_billing_time || null,
          )
          .run();
        actionTaken = "subscription_created";
      }
      break;
    }

    case "BILLING.SUBSCRIPTION.ACTIVATED": {
      const subId = resource.id;
      const planId = resource.plan_id;
      const customData = parseSubscriptionCustomId(resource.custom_id);
      const verifiedPlan = planId ? getPlanFromPayPalPlanId(planId, config) : customData?.plan;
      const mapped = mapPayPalSubscriptionStatus(resource.status || "ACTIVE");
      const nextBilling = resource.billing_info?.next_billing_time || null;

      if (subId && verifiedPlan) {
        if (customData?.organizationId) {
          await db
            .prepare(
              `
            INSERT INTO subscriptions (id, organization_id, plan, status, provider, provider_subscription_id, current_period_end, cancel_at_period_end)
            VALUES (?, ?, ?, ?, 'paypal', ?, ?, 0)
            ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
              plan = excluded.plan,
              status = excluded.status,
              current_period_end = excluded.current_period_end,
              cancel_at_period_end = 0,
              updated_at = CURRENT_TIMESTAMP
          `,
            )
            .bind(
              `sub_${subId.slice(0, 36)}`,
              customData.organizationId,
              verifiedPlan,
              mapped.internalStatus,
              subId,
              nextBilling,
            )
            .run();
        } else {
          await db
            .prepare(
              `
            UPDATE subscriptions SET
              status = ?,
              current_period_end = COALESCE(?, current_period_end),
              updated_at = CURRENT_TIMESTAMP
            WHERE provider = 'paypal' AND provider_subscription_id = ?
          `,
            )
            .bind(mapped.internalStatus, nextBilling, subId)
            .run();
        }
        actionTaken = "subscription_activated";
      }
      break;
    }

    case "BILLING.SUBSCRIPTION.UPDATED": {
      const subId = resource.id;
      const planId = resource.plan_id;
      const verifiedPlan = planId ? getPlanFromPayPalPlanId(planId, config) : null;
      const mapped = mapPayPalSubscriptionStatus(resource.status);
      const nextBilling = resource.billing_info?.next_billing_time || null;

      if (subId) {
        await db
          .prepare(
            `
          UPDATE subscriptions SET
            plan = COALESCE(?, plan),
            status = ?,
            current_period_end = COALESCE(?, current_period_end),
            updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'paypal' AND provider_subscription_id = ?
        `,
          )
          .bind(verifiedPlan, mapped.internalStatus, nextBilling, subId)
          .run();
        actionTaken = "subscription_updated";
      }
      break;
    }

    case "BILLING.SUBSCRIPTION.CANCELLED": {
      const subId = resource.id;
      if (subId) {
        await db
          .prepare(
            `
          UPDATE subscriptions SET
            status = 'cancelled',
            cancel_at_period_end = 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'paypal' AND provider_subscription_id = ?
        `,
          )
          .bind(subId)
          .run();
        actionTaken = "subscription_cancelled";
      }
      break;
    }

    case "BILLING.SUBSCRIPTION.SUSPENDED": {
      const subId = resource.id;
      if (subId) {
        await db
          .prepare(
            `
          UPDATE subscriptions SET
            status = 'suspended',
            updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'paypal' AND provider_subscription_id = ?
        `,
          )
          .bind(subId)
          .run();
        actionTaken = "subscription_suspended";
      }
      break;
    }

    case "BILLING.SUBSCRIPTION.EXPIRED": {
      const subId = resource.id;
      if (subId) {
        await db
          .prepare(
            `
          UPDATE subscriptions SET
            status = 'expired',
            updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'paypal' AND provider_subscription_id = ?
        `,
          )
          .bind(subId)
          .run();
        actionTaken = "subscription_expired";
      }
      break;
    }

    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
      const subId = resource.id || resource.billing_agreement_id;
      if (subId) {
        await db
          .prepare(
            `
          UPDATE subscriptions SET
            status = 'payment_failed',
            updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'paypal' AND provider_subscription_id = ?
        `,
          )
          .bind(subId)
          .run();
        actionTaken = "subscription_payment_failed";
      }
      break;
    }

    // ----------------------------------------------------
    // Recurring Payments (Sales)
    // ----------------------------------------------------
    case "PAYMENT.SALE.COMPLETED": {
      const subId = resource.billing_agreement_id;
      if (subId) {
        await db
          .prepare(
            `
          UPDATE subscriptions SET
            status = 'active',
            updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'paypal' AND provider_subscription_id = ?
        `,
          )
          .bind(subId)
          .run();
        actionTaken = "sale_completed";
      }
      break;
    }

    case "PAYMENT.SALE.REFUNDED":
    case "PAYMENT.SALE.REVERSED": {
      const subId = resource.billing_agreement_id;
      if (subId) {
        await db
          .prepare(
            `
          UPDATE subscriptions SET
            status = 'suspended',
            updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'paypal' AND provider_subscription_id = ?
        `,
          )
          .bind(subId)
          .run();
        actionTaken = "sale_refunded";
      }
      break;
    }

    // ----------------------------------------------------
    // One-Time Captures (Starter)
    // ----------------------------------------------------
    case "PAYMENT.CAPTURE.COMPLETED": {
      const captureId = resource.id;
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      const customId = resource.custom_id;
      const customData = parseStarterCustomId(customId);
      const amountVal = resource.amount?.value;
      const currency = resource.amount?.currency_code;

      if (customData && amountVal === STARTER_PRICE_AMOUNT && currency === STARTER_CURRENCY) {
        const paymentId = orderId || captureId;
        // Verify target scan belongs to organization
        const scan = await db
          .prepare("SELECT id FROM scans WHERE id = ? AND organization_id = ? LIMIT 1")
          .bind(customData.scanId, customData.organizationId)
          .first();

        if (scan) {
          await db
            .prepare(
              `
            INSERT INTO report_purchases
              (id, organization_id, scan_id, plan, status, provider, provider_payment_id, amount_cents, currency, paid_at)
            VALUES (?, ?, ?, 'starter', 'paid', 'paypal', ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(provider, provider_payment_id) DO UPDATE SET
              status = 'paid',
              paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          `,
            )
            .bind(
              `pur_${paymentId.slice(0, 36)}`,
              customData.organizationId,
              customData.scanId,
              paymentId,
              STARTER_AMOUNT_CENTS,
              STARTER_CURRENCY,
            )
            .run();
          actionTaken = "capture_completed";
        }
      }
      break;
    }

    case "PAYMENT.CAPTURE.DENIED": {
      const captureId = resource.id;
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      const paymentId = orderId || captureId;
      if (paymentId) {
        await db
          .prepare(
            `
          UPDATE report_purchases SET
            status = 'failed',
            updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'paypal' AND provider_payment_id = ?
        `,
          )
          .bind(paymentId)
          .run();
        actionTaken = "capture_denied";
      }
      break;
    }

    case "PAYMENT.CAPTURE.REFUNDED": {
      const captureId = resource.id;
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      const paymentId = orderId || captureId;
      if (paymentId) {
        await db
          .prepare(
            `
          UPDATE report_purchases SET
            status = 'refunded',
            updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'paypal' AND provider_payment_id = ?
        `,
          )
          .bind(paymentId)
          .run();
        actionTaken = "capture_refunded";
      }
      break;
    }

    default:
      actionTaken = `unhandled_${event.event_type}`;
      break;
  }

  // 2. Durable idempotency: record event in payment_events table
  await db
    .prepare(
      `
    INSERT INTO payment_events (id, provider, event_type, resource_type, resource_id, status)
    VALUES (?, 'paypal', ?, ?, ?, 'processed')
    ON CONFLICT(id) DO NOTHING
  `,
    )
    .bind(
      eventId,
      event.event_type,
      event.resource_type || null,
      resource.id || null,
    )
    .run();

  return { processed: true, duplicate: false, action: actionTaken };
}
