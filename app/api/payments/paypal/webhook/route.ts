import { database } from "@/db/product";
import {
  extractWebhookHeaders,
  processVerifiedWebhookEvent,
  verifyWebhookSignature,
  type PayPalWebhookEvent,
} from "@/lib/paypal";

export const runtime = "edge";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  let webhookBody: PayPalWebhookEvent;
  try {
    webhookBody = await request.json();
  } catch {
    return json({ error: "Invalid JSON body", code: "bad_request" }, 400);
  }

  const webhookHeaders = extractWebhookHeaders(request.headers);

  // 1. Signature Verification with PayPal's official API & PAYPAL_WEBHOOK_ID
  const isVerified = await verifyWebhookSignature(webhookHeaders, webhookBody);
  if (!isVerified) {
    return json({ error: "Webhook verification failed", code: "invalid_signature" }, 400);
  }

  // 2. Idempotent Processing
  try {
    const db = database();
    const result = await processVerifiedWebhookEvent(db, webhookBody);
    return json({ received: true, ...result });
  } catch (err: any) {
    return json(
      { error: err.message || "Failed to process webhook event", code: "processing_error" },
      500,
    );
  }
}
