export function canStartPaidCheckout(paymentsEnabled: boolean | null, planStatus: "loading" | "ready" | "error", billingConflict = false, billingReview = false) {
  return paymentsEnabled === true && planStatus === "ready" && !billingConflict && !billingReview;
}

export function isPlanActionDisabled(
  plan: "free" | "starter" | "essential" | "growth" | "pro",
  availability: Record<"starter" | "essential" | "growth" | "pro", boolean>,
  paymentsEnabled: boolean | null,
  planStatus: "loading" | "ready" | "error",
  billingConflict = false,
  billingReview = false,
) {
  if (plan === "free") return false;
  return !availability[plan] || !canStartPaidCheckout(paymentsEnabled, planStatus, billingConflict, billingReview);
}
