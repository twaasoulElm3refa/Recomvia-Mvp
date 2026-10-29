import { paypalRequest, PayPalError } from "./client";
import type { PayPalConfig, PayPalOrder, PayPalTransport } from "./types";

export const STARTER_PRICE_AMOUNT = "4.99";
export const STARTER_AMOUNT_CENTS = 499;
export const STARTER_CURRENCY = "USD";

export type StarterOrderCustomData = {
  organizationId: string;
  scanId: string;
};

export function serializeStarterCustomId(data: StarterOrderCustomData): string {
  return `${data.organizationId}:${data.scanId}`;
}

export function parseStarterCustomId(customId: string | null | undefined): StarterOrderCustomData | null {
  if (!customId) return null;
  const parts = customId.split(":");
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return {
      organizationId: parts[0],
      scanId: parts.slice(1).join(":"),
    };
  }
  try {
    const parsed = JSON.parse(customId);
    if (parsed.organizationId && parsed.scanId) {
      return {
        organizationId: String(parsed.organizationId),
        scanId: String(parsed.scanId),
      };
    }
  } catch {
    // not JSON
  }
  return null;
}

export async function createStarterOrder(
  params: {
    organizationId: string;
    scanId: string;
    returnUrl?: string;
    cancelUrl?: string;
  },
  options: {
    config?: Partial<PayPalConfig>;
    transport?: PayPalTransport;
  } = {},
): Promise<{ orderId: string; approveUrl: string | null; order: PayPalOrder }> {
  const customId = serializeStarterCustomId({
    organizationId: params.organizationId,
    scanId: params.scanId,
  });

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: `starter_${params.scanId}`,
        description: "Recomvia Starter Report",
        custom_id: customId,
        amount: {
          currency_code: STARTER_CURRENCY,
          value: STARTER_PRICE_AMOUNT,
        },
      },
    ],
    application_context: {
      brand_name: "Recomvia",
      landing_page: "NO_PREFERENCE",
      user_action: "PAY_NOW",
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
    },
  };

  const order = await paypalRequest<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    body,
    config: options.config,
    transport: options.transport,
  });

  const approveLink = order.links?.find((l) => l.rel === "approve");

  return {
    orderId: order.id,
    approveUrl: approveLink?.href || null,
    order,
  };
}

export async function captureStarterOrder(
  orderId: string,
  expected: {
    organizationId: string;
    scanId: string;
  },
  options: {
    config?: Partial<PayPalConfig>;
    transport?: PayPalTransport;
  } = {},
): Promise<{
  orderId: string;
  captureId: string;
  amountCents: number;
  currency: string;
  order: PayPalOrder;
}> {
  // If order is already completed on PayPal, attempting another capture will fail with ORDER_ALREADY_CAPTURED.
  // In that case, fetch order details to verify.
  let order: PayPalOrder;
  try {
    order = await paypalRequest<PayPalOrder>(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        config: options.config,
        transport: options.transport,
      },
    );
  } catch (err) {
    if (
      err instanceof PayPalError &&
      (err.status === 422 || err.paypalName === "ORDER_ALREADY_CAPTURED" || (err.message && err.message.includes("ORDER_ALREADY_CAPTURED")))
    ) {
      order = await getOrderDetails(orderId, options);
    } else {
      throw err;
    }
  }

  if (order.status !== "COMPLETED") {
    throw new PayPalError(
      `PayPal Order is not completed (current status: ${order.status})`,
      400,
    );
  }

  const purchaseUnit = order.purchase_units?.[0];
  if (!purchaseUnit) {
    throw new PayPalError("PayPal Order missing purchase unit.", 400);
  }

  const capture = purchaseUnit.payments?.captures?.[0];
  const captureAmount = capture?.amount?.value || purchaseUnit.amount?.value;
  const captureCurrency = capture?.amount?.currency_code || purchaseUnit.amount?.currency_code;

  // Strict price and currency verification
  if (captureCurrency !== STARTER_CURRENCY) {
    throw new PayPalError(
      `Invalid currency "${captureCurrency}". Expected "${STARTER_CURRENCY}".`,
      400,
    );
  }

  if (captureAmount !== STARTER_PRICE_AMOUNT) {
    throw new PayPalError(
      `Invalid payment amount "${captureAmount}". Expected "${STARTER_PRICE_AMOUNT}".`,
      400,
    );
  }

  // Strict reconciliation: custom_id verification
  const customId = capture?.custom_id || purchaseUnit.custom_id;
  const customData = parseStarterCustomId(customId);

  if (!customData) {
    throw new PayPalError("Order custom reconciliation data is missing.", 400);
  }

  if (customData.organizationId !== expected.organizationId) {
    throw new PayPalError(
      "Payment organization ownership mismatch.",
      403,
    );
  }

  if (customData.scanId !== expected.scanId) {
    throw new PayPalError(
      "Payment report target mismatch.",
      400,
    );
  }

  const captureId = capture?.id || order.id;

  return {
    orderId: order.id,
    captureId,
    amountCents: STARTER_AMOUNT_CENTS,
    currency: STARTER_CURRENCY,
    order,
  };
}

export async function getOrderDetails(
  orderId: string,
  options: {
    config?: Partial<PayPalConfig>;
    transport?: PayPalTransport;
  } = {},
): Promise<PayPalOrder> {
  return paypalRequest<PayPalOrder>(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      config: options.config,
      transport: options.transport,
    },
  );
}
