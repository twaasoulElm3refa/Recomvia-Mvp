import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/app/auth";
import { getLatestReportForUser, getReportForUser } from "@/db/product";
import { ReportContent } from "./report-content";
export const dynamic = "force-dynamic";
export const runtime = "edge";
export const metadata: Metadata = {
  title: "Private visibility report",
  robots: { index: false, follow: false },
};
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ scan?: string }>;
}) {
  const { scan: scanId } = await searchParams;
  const user = await requireAuthenticatedUser();
  const report = scanId
    ? await getReportForUser(user.userId, scanId)
    : await getLatestReportForUser(user.userId);
  return <ReportContent report={report} displayName={user.displayName} />;
}
