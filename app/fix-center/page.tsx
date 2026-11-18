import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/app/auth";
import {
  getEntitlementForUser,
  getLatestWebsiteReportForUser,
  getReportForUser,
} from "@/db/product";
import { FixAccessGate } from "./fix-access-gate";
import { FixCenterExperience } from "./fix-center-experience";

export const dynamic = "force-dynamic";
export const runtime = "edge";
export const metadata: Metadata = {
  title: "Private Fix Center",
  robots: { index: false, follow: false },
};

export default async function FixCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ scan?: string }>;
}) {
  const user = await requireAuthenticatedUser();
  const entitlement = await getEntitlementForUser(user);
  if (!entitlement.canUseFixCredits) return <FixAccessGate />;

  const requested = (await searchParams).scan;
  const scanId = requested && /^[a-zA-Z0-9_-]{1,100}$/.test(requested)
    ? requested : null;
  const report = requested
    ? (scanId ? await getReportForUser(user.userId, scanId) : null)
    : await getLatestWebsiteReportForUser(user.userId);
  const scan = report?.entitlement.canViewFullReport &&
    "findings" in report.scan &&
    report.scan.status === "completed" &&
    report.scan.readinessScore !== null
      ? report.scan
      : null;

  return (
    <FixCenterExperience
      scanId={scan?.id ?? null}
      targetName={scan?.target?.name || scan?.displayName || null}
      hasWebsiteAudit={Boolean(scan)}
      findings={scan?.findings.filter((finding) => finding.status !== "pass") ?? []}
    />
  );
}
