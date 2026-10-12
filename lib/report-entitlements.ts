import { FULL_REPORT_CAPABILITY, planById, type PlanId } from "./plans";

export type SubscriptionRecord = {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
};

export type ReportEntitlement = {
  canViewFullReport: boolean;
  planId: PlanId | null;
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function isSubscriptionActive(
  subscription: SubscriptionRecord,
  now = new Date(),
) {
  if (!ACTIVE_STATUSES.has(subscription.status.trim().toLowerCase()))
    return false;
  if (!subscription.currentPeriodEnd) return true;
  const periodEnd = Date.parse(subscription.currentPeriodEnd);
  return Number.isFinite(periodEnd) && periodEnd > now.getTime();
}

export function resolveReportEntitlement(
  subscriptions: readonly SubscriptionRecord[],
  now = new Date(),
): ReportEntitlement {
  for (const subscription of subscriptions) {
    if (!isSubscriptionActive(subscription, now)) continue;
    const plan = planById(subscription.plan);
    if (plan?.capabilities.includes(FULL_REPORT_CAPABILITY)) {
      return { canViewFullReport: true, planId: plan.id };
    }
  }
  return { canViewFullReport: false, planId: null };
}

export function canViewFullReport(
  subscriptions: readonly SubscriptionRecord[],
  now = new Date(),
) {
  return resolveReportEntitlement(subscriptions, now).canViewFullReport;
}
