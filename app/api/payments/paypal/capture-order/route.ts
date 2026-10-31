import { getAuthenticatedUser } from "@/app/auth";
import { database, ensureWorkspace, recordStarterPurchase } from "@/db/product";
import { captureStarterOrder, STARTER_AMOUNT_CENTS, STARTER_CURRENCY } from "@/lib/paypal";
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

  let body: { orderId?: string; scanId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body", code: "invalid_request" }, 400);
  }

  const orderId = body.orderId?.trim();
  if (!orderId) {
    return json({ error: "orderId is required", code: "missing_order_id" }, 400);
  }

  const workspace = await ensureWorkspace(user);
  const db = database();

  // 1. Idempotency check: has this order already been captured and paid?
  const existingPurchase = await db
    .prepare(
      `
    SELECT id, organization_id AS organizationId, scan_id AS scanId, status
    FROM report_purchases
    WHERE provider = 'paypal' AND provider_payment_id = ?
    LIMIT 1
  `,
    )
    .bind(orderId)
    .first<{
      id: string;
      organizationId: string;
      scanId: string;
      status: string;
    }>();

  if (existingPurchase && existingPurchase.status === "paid") {
    // Cross-account guard: verify caller belongs to the same organization
    if (existingPurchase.organizationId !== workspace.organizationId) {
      return json({ error: "Purchase ownership mismatch", code: "forbidden" }, 403);
    }
    return json({
      success: true,
      scanId: existingPurchase.scanId,
      alreadyProcessed: true,
    });
  }

  const scanId = body.scanId?.trim() || existingPurchase?.scanId;
  if (!scanId) {
    return json({ error: "Target scan could not be resolved", code: "missing_scan" }, 400);
  }

  try {
    // 2. Server captures order with PayPal and strictly validates amount (USD 4.99) & ownership
    const captured = await captureStarterOrder(orderId, {
      organizationId: workspace.organizationId,
      scanId,
    });

    // 3. Update report_purchases
    await recordStarterPurchase({
      organizationId: workspace.organizationId,
      scanId,
      providerPaymentId: orderId,
      amountCents: STARTER_AMOUNT_CENTS,
      currency: STARTER_CURRENCY,
      status: "paid",
    });

    return json({
      success: true,
      scanId,
      captureId: captured.captureId,
      status: "completed",
    });
  } catch (err: any) {
    return json(
      { error: err.message || "Failed to capture PayPal order", code: "capture_failed" },
      err.status || 400,
    );
  }
}
