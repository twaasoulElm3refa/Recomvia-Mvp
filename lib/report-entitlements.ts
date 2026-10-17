import { FIX_CREDITS_CAPABILITY, isSubscriptionPlan, planById, type PlanId, type ReportLevel } from "./plans";

export type SubscriptionRecord = { plan: string; status: string; currentPeriodEnd: string | null };
export type ReportEntitlement = {
  canViewFullReport: boolean;
  canViewStarterReport: boolean;
  canViewAdvancedReport: boolean;
  canUseFixCredits: boolean;
  canMonitor: boolean;
  reportLevel: ReportLevel;
  projectLimit: number;
  planId: PlanId | null;
};
export const FREE_REPORT_ENTITLEMENT: ReportEntitlement = {
  canViewFullReport: false, canViewStarterReport: false, canViewAdvancedReport: false,
  canUseFixCredits: false, canMonitor: false, reportLevel: "summary", projectLimit: 1, planId: null,
};
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
export function isSubscriptionActive(subscription: SubscriptionRecord, now = new Date()) {
  if (!ACTIVE_STATUSES.has(subscription.status.trim().toLowerCase())) return false;
  if (!subscription.currentPeriodEnd) return true;
  // SQLite CURRENT_TIMESTAMP is UTC but has no explicit zone.
  const raw = subscription.currentPeriodEnd;
  const periodEnd = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(" ", "T") + "Z" : raw);
  return Number.isFinite(periodEnd) && periodEnd > now.getTime();
}

/** hasPaidStarter must come from an owner- and scan-scoped verified purchase,
 * never a request parameter or the browser's checkout return URL. */
export function resolveReportEntitlement(subscriptions: readonly SubscriptionRecord[], now = new Date(), hasPaidStarter = false): ReportEntitlement {
  const plan = subscriptions
    .filter((subscription) => isSubscriptionActive(subscription, now))
    .map((subscription) => planById(subscription.plan))
    .filter(isSubscriptionPlan)
    .sort((a, b) => b.price.amountCents - a.price.amountCents)[0];
  if (plan) return {
    canViewFullReport: true, canViewStarterReport: true,
    canViewAdvancedReport: plan.reportLevel === "advanced",
    canUseFixCredits: plan.capabilities.includes(FIX_CREDITS_CAPABILITY),
    canMonitor: true, reportLevel: plan.reportLevel, projectLimit: plan.projectLimit, planId: plan.id,
  };
  return hasPaidStarter
    ? { ...FREE_REPORT_ENTITLEMENT, canViewStarterReport: true, reportLevel: "starter", planId: "starter" }
    : { ...FREE_REPORT_ENTITLEMENT };
}
export function canViewFullReport(subscriptions: readonly SubscriptionRecord[], now = new Date()) {
  return resolveReportEntitlement(subscriptions, now).canViewFullReport;
}
