export const FULL_REPORT_CAPABILITY = "report.full" as const;

export type PlanId = "essential" | "growth" | "pro";
export type PlanCapability = typeof FULL_REPORT_CAPABILITY;

export type PlanDefinition = {
  id: PlanId;
  name: { en: string; ar: string };
  price: { amount: string; cadence: { en: string; ar: string } } | null;
  availability: "available" | "coming_soon";
  description: { en: string; ar: string };
  capabilities: readonly PlanCapability[];
};

/**
 * The single product-plan catalog. Payment-provider IDs belong in a future
 * billing integration, not in report components or entitlement checks.
 */
export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    id: "essential",
    name: { en: "Essential", ar: "Essential" },
    price: {
      amount: "$19",
      cadence: { en: "per month", ar: "شهريًا" },
    },
    availability: "available",
    description: {
      en: "Full Report Access",
      ar: "الوصول إلى التقرير الكامل",
    },
    capabilities: [FULL_REPORT_CAPABILITY],
  },
  {
    id: "growth",
    name: { en: "Growth", ar: "Growth" },
    price: null,
    availability: "coming_soon",
    description: {
      en: "Additional capabilities will be announced soon.",
      ar: "سيتم الإعلان عن إمكانات إضافية قريبًا.",
    },
    capabilities: [],
  },
  {
    id: "pro",
    name: { en: "Pro", ar: "Pro" },
    price: null,
    availability: "coming_soon",
    description: {
      en: "Additional capabilities will be announced soon.",
      ar: "سيتم الإعلان عن إمكانات إضافية قريبًا.",
    },
    capabilities: [],
  },
] as const;

export function planById(plan: string | null | undefined) {
  const normalized = plan?.trim().toLowerCase();
  return PLAN_CATALOG.find((item) => item.id === normalized) ?? null;
}
