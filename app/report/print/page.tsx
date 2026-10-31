import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/app/auth";
import { getReportForUser } from "@/db/product";
import { PrintableReport } from "../printable-report";
import { PrintControls } from "./print-controls";
import "./print.css";

export const dynamic = "force-dynamic";
export const runtime = "edge";
export const metadata: Metadata = { title: "Private visibility report · Print", robots: { index: false, follow: false } };

export default async function PrintReportPage({ searchParams }: { searchParams: Promise<{ scan?: string; lang?: string }> }) {
  const user = await requireAuthenticatedUser();
  const { scan: scanId, lang } = await searchParams;
  if (!scanId) notFound();
  const report = await getReportForUser(user.userId, scanId);
  if (!report || !report.entitlement.canViewStarterReport || !("engineRuns" in report.scan)) notFound();
  const ar = lang === "ar" || (lang !== "en" && report.scan.language.toLowerCase().startsWith("ar"));
  return <main className="print-page"><PrintControls scanId={scanId} ar={ar} /><PrintableReport scan={report.scan} starter={report.entitlement.reportLevel === "starter"} ar={ar} plan={report.entitlement.planId || "Free"} /></main>;
}
