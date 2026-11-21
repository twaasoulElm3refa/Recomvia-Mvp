import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/app/auth";
import { notFound } from "next/navigation";
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
  searchParams: Promise<{ scan?: string | string[] }>;
}) {
  const { scan: scanId } = await searchParams;
  const user = await requireAuthenticatedUser();
  // An explicit but malformed selector must never fall back to the latest report.
  // Bound untrusted query input before any account-scoped database lookup.
  if (scanId !== undefined &&
      (typeof scanId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(scanId))) notFound();
  const report = scanId === undefined
    ? await getLatestReportForUser(user.userId)
    : await getReportForUser(user.userId, scanId);
  return <ReportContent report={report} displayName={user.displayName} />;
}
