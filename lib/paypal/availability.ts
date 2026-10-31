import { getPayPalEnv } from "./config";

type PaymentRequirement = "starter" | "essential" | "growth" | "pro" | "webhook";
type PaymentEnvironment = Record<string, string | undefined>;

export function isPayPalPaymentsEnabled(requirement: PaymentRequirement = "starter", source: PaymentEnvironment = getPayPalEnv()): boolean {
  if (source.PAYPAL_ENABLED?.trim() !== "true" || !source.PAYPAL_CLIENT_ID?.trim() || !source.PAYPAL_CLIENT_SECRET?.trim()) return false;
  if (requirement === "webhook") return Boolean(source.PAYPAL_WEBHOOK_ID?.trim());
  if (requirement === "essential") return Boolean(source.PAYPAL_ESSENTIAL_PLAN_ID?.trim());
  if (requirement === "growth") return Boolean(source.PAYPAL_GROWTH_PLAN_ID?.trim());
  if (requirement === "pro") return Boolean(source.PAYPAL_PRO_PLAN_ID?.trim());
  return requirement === "starter";
}

export function paymentNotConfiguredResponse() {
  return Response.json({ error: "Payments are not available yet.", code: "payment_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
