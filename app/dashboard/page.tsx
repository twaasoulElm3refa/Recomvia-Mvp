import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/app/auth";
import { getLatestScanSummaryForUser, listScansForUser, getEntitlementForUser } from "@/db/product";
import { DashboardContent } from "./dashboard-content";
import { listMonitoringSchedulesForUser } from "@/db/monitoring-controls";
import { listProjectSlotsForUser } from "@/db/project-slots";
export const dynamic = "force-dynamic";
export const runtime = "edge";
export const metadata: Metadata = {
  title: "Private visibility workspace",
  robots: { index: false, follow: false },
};
export default async function DashboardPage() {
  const user = await requireAuthenticatedUser();
  const [latest, scans, entitlement, monitoringSchedules] = await Promise.all([
    getLatestScanSummaryForUser(user.userId),
    listScansForUser(user.userId),
    getEntitlementForUser(user),
    listMonitoringSchedulesForUser(user.userId),
  ]);
  const projectSlots = await listProjectSlotsForUser(user, entitlement.projectLimit, entitlement.canMonitor);
  return (
    <DashboardContent
      displayName={user.displayName}
      latest={latest}
      scans={scans}
      entitlement={entitlement}
      monitoringSchedules={monitoringSchedules}
      projectSlots={projectSlots}
    />
  );
}
