export type RecomviaSubscriptionStatus =
  | "active"
  | "cancelled"
  | "suspended"
  | "expired"
  | "inactive"
  | "payment_failed";

export type MappedSubscriptionState = {
  internalStatus: RecomviaSubscriptionStatus;
  isActive: boolean;
};

/**
 * Centralized mapping from PayPal subscription status to Recomvia entitlement state.
 *
 * Rules:
 * - ACTIVE: maps to "active" (entitled to paid features)
 * - CANCELLED: maps to "cancelled" (not entitled to new paid features)
 * - SUSPENDED: maps to "suspended" (access paused per existing subscription rules)
 * - EXPIRED: maps to "expired" (inactive)
 * - PAYMENT_FAILED: maps to "payment_failed" (no grace period defined in Recomvia)
 * - APPROVAL_PENDING / APPROVED: maps to "inactive" (awaiting activation confirmation)
 */
export function mapPayPalSubscriptionStatus(
  paypalStatus: string | null | undefined,
): MappedSubscriptionState {
  if (!paypalStatus) {
    return { internalStatus: "inactive", isActive: false };
  }

  const normalized = paypalStatus.toUpperCase().trim();

  switch (normalized) {
    case "ACTIVE":
      return { internalStatus: "active", isActive: true };

    case "CANCELLED":
      return { internalStatus: "cancelled", isActive: false };

    case "SUSPENDED":
      return { internalStatus: "suspended", isActive: false };

    case "EXPIRED":
      return { internalStatus: "expired", isActive: false };

    case "PAYMENT_FAILED":
      return { internalStatus: "payment_failed", isActive: false };

    case "APPROVAL_PENDING":
    case "APPROVED":
    default:
      return { internalStatus: "inactive", isActive: false };
  }
}
