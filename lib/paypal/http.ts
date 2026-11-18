import { PayPalError } from "./client";

const headers = { "Cache-Control": "no-store" };

/** Checkout routes only accept a JSON object, never arrays, null, or scalar JSON. */
export async function readPaymentBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function paymentString(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? body[key].trim() : "";
}

/** Never return provider messages, configuration details, or database errors to callers. */
export function paymentFailure(error: unknown, message: string, code: string): Response {
  let status = 500;
  if (error instanceof PayPalError) {
    if (error.status === 400 || error.status === 403) status = error.status;
    else if (error.status === 429) status = 503;
    else status = 502;
  }
  return Response.json({ error: message, code }, { status, headers });
}
