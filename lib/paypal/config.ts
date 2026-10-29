import { env as cfEnv } from "cloudflare:workers";
import type { PayPalConfig } from "./types";

export const SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";
export const LIVE_API_BASE = "https://api-m.paypal.com";

export function getPayPalEnv(): Record<string, string | undefined> {
  const nodeEnv =
    typeof process !== "undefined" && process.env ? process.env : {};
  let workerEnv: Record<string, unknown> = {};
  try {
    if (typeof cfEnv !== "undefined" && cfEnv) {
      workerEnv = cfEnv as unknown as Record<string, unknown>;
    }
  } catch {
    // Non-worker environment fallback
  }
  return {
    ...nodeEnv,
    ...(workerEnv as Record<string, string | undefined>),
  };
}

/**
 * Resolves the PayPal API base URL.
 * Strictly guards against PayPal Live in this task/environment.
 */
export function getPayPalBaseUrl(paypalEnv?: string): string {
  const rawEnv = (paypalEnv || getPayPalEnv().PAYPAL_ENV || "sandbox")
    .toLowerCase()
    .trim();

  if (rawEnv === "live" || rawEnv === "production") {
    throw new Error(
      "PayPal Live mode is disabled in this environment. Only PayPal Sandbox is permitted.",
    );
  }

  if (rawEnv === "sandbox") {
    return SANDBOX_API_BASE;
  }

  throw new Error(
    `Unsupported PAYPAL_ENV: "${rawEnv}". Expected "sandbox".`,
  );
}

export function getPayPalConfig(overrides?: Partial<PayPalConfig>): PayPalConfig {
  const env = getPayPalEnv();

  const config: PayPalConfig = {
    PAYPAL_ENV: overrides?.PAYPAL_ENV || env.PAYPAL_ENV || "sandbox",
    PAYPAL_CLIENT_ID: (overrides?.PAYPAL_CLIENT_ID || env.PAYPAL_CLIENT_ID || "").trim(),
    PAYPAL_CLIENT_SECRET: (overrides?.PAYPAL_CLIENT_SECRET || env.PAYPAL_CLIENT_SECRET || "").trim(),
    PAYPAL_WEBHOOK_ID: (overrides?.PAYPAL_WEBHOOK_ID || env.PAYPAL_WEBHOOK_ID || "").trim(),
    PAYPAL_PRODUCT_ID: (overrides?.PAYPAL_PRODUCT_ID || env.PAYPAL_PRODUCT_ID || "").trim() || undefined,
    PAYPAL_ESSENTIAL_PLAN_ID: (overrides?.PAYPAL_ESSENTIAL_PLAN_ID || env.PAYPAL_ESSENTIAL_PLAN_ID || "").trim(),
    PAYPAL_GROWTH_PLAN_ID: (overrides?.PAYPAL_GROWTH_PLAN_ID || env.PAYPAL_GROWTH_PLAN_ID || "").trim(),
    PAYPAL_PRO_PLAN_ID: (overrides?.PAYPAL_PRO_PLAN_ID || env.PAYPAL_PRO_PLAN_ID || "").trim(),
    NEXT_PUBLIC_PAYPAL_CLIENT_ID: (
      overrides?.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
      env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
      env.PAYPAL_CLIENT_ID ||
      ""
    ).trim() || undefined,
  };

  // Enforce sandbox-only guard
  getPayPalBaseUrl(config.PAYPAL_ENV);

  return config;
}

export function getPayPalPlanId(
  plan: string,
  config: Pick<
    PayPalConfig,
    | "PAYPAL_ESSENTIAL_PLAN_ID"
    | "PAYPAL_GROWTH_PLAN_ID"
    | "PAYPAL_PRO_PLAN_ID"
  >,
): string {
  const normalized = plan.toLowerCase().trim();
  switch (normalized) {
    case "essential": {
      const planId = config.PAYPAL_ESSENTIAL_PLAN_ID?.trim();
      if (!planId) throw new Error("PAYPAL_ESSENTIAL_PLAN_ID is not configured.");
      return planId;
    }
    case "growth": {
      const planId = config.PAYPAL_GROWTH_PLAN_ID?.trim();
      if (!planId) throw new Error("PAYPAL_GROWTH_PLAN_ID is not configured.");
      return planId;
    }
    case "pro": {
      const planId = config.PAYPAL_PRO_PLAN_ID?.trim();
      if (!planId) throw new Error("PAYPAL_PRO_PLAN_ID is not configured.");
      return planId;
    }
    default:
      throw new Error(
        `Invalid subscription plan: "${plan}". Only "essential", "growth", and "pro" are supported.`,
      );
  }
}

export function getPlanFromPayPalPlanId(
  payPalPlanId: string,
  config: Pick<
    PayPalConfig,
    | "PAYPAL_ESSENTIAL_PLAN_ID"
    | "PAYPAL_GROWTH_PLAN_ID"
    | "PAYPAL_PRO_PLAN_ID"
  >,
): "essential" | "growth" | "pro" | null {
  const trimmed = payPalPlanId.trim();
  if (config.PAYPAL_ESSENTIAL_PLAN_ID?.trim() === trimmed) return "essential";
  if (config.PAYPAL_GROWTH_PLAN_ID?.trim() === trimmed) return "growth";
  if (config.PAYPAL_PRO_PLAN_ID?.trim() === trimmed) return "pro";
  return null;
}
