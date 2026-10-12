import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/app/auth";
import { getLatestScanSummaryForUser, listScansForUser } from "@/db/product";
import { DashboardContent } from "./dashboard-content";
export const dynamic = "force-dynamic";
export const runtime = "edge";
export const metadata: Metadata = {
  title: "Private visibility workspace",
  robots: { index: false, follow: false },
};
export default async function DashboardPage() {
  const user = await requireAuthenticatedUser();
  const [latest, scans] = await Promise.all([
    getLatestScanSummaryForUser(user.userId),
    listScansForUser(user.userId),
  ]);
  return (
    <DashboardContent
      displayName={user.displayName}
      latest={latest}
      scans={scans}
    />
  );
}
