import { getAuthenticatedUser } from "@/app/auth";
import { ensureWorkspace, getScanForUser, recordStarterPurchase } from "@/db/product";
import { createStarterOrder, STARTER_AMOUNT_CENTS } from "@/lib/paypal";
import { isPayPalPaymentsEnabled, paymentNotConfiguredResponse } from "@/lib/paypal/availability";
import { paymentFailure, paymentString, readPaymentBody } from "@/lib/paypal/http";

export const runtime = "edge";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return json({ error: "Authentication required", code: "unauthorized" }, 401);
  }
  if (!isPayPalPaymentsEnabled()) return paymentNotConfiguredResponse();

  const body = await readPaymentBody(request);
  if (!body) {
    return json({ error: "Invalid JSON body", code: "invalid_request" }, 400);
  }

  const scanId = paymentString(body, "scanId");
  if (!scanId) {
    return json({ error: "scanId is required", code: "missing_scan_id" }, 400);
  }

  const workspace = await ensureWorkspace(user);
  const scan = await getScanForUser(user.userId, scanId);

  if (!scan) {
    return json({ error: "Scan not found or not owned by user", code: "not_found" }, 404);
  }

  if (scan.status !== "completed") {
    return json({ error: "Only completed scans can be purchased", code: "scan_not_completed" }, 400);
  }

  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/subscriptions?flow=starter&scan=${encodeURIComponent(scanId)}`;
  const cancelUrl = `${origin}/subscriptions?flow=cancelled`;

  try {
    const { orderId, approveUrl } = await createStarterOrder({
      organizationId: workspace.organizationId,
      scanId,
      returnUrl,
      cancelUrl,
    });

    // Record pending purchase
    await recordStarterPurchase({
      organizationId: workspace.organizationId,
      scanId,
      providerPaymentId: orderId,
      amountCents: STARTER_AMOUNT_CENTS,
      status: "pending",
    });

    return json({ orderId, approveUrl });
  } catch (error) {
    return paymentFailure(error, "Failed to create PayPal order", "paypal_error");
  }
}
