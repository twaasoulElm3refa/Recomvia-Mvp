import { getAuthenticatedUser } from "@/app/auth";
import { getReportForUser } from "@/db/product";
import { listFixProposalHistoryForScan, listFixReviewRequests } from "@/db/fix-review";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function error(status: number, code: string) {
  return Response.json({ code }, { status, headers: noStore });
}

/**
 * Export a complete, private, read-only evidence pack for one owned scan.
 * This is NOT a backup of the customer website or authorization to deploy.
 */
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return error(401, "sign_in");

  const scanId = new URL(request.url).searchParams.get("scan");
  if (!scanId || !/^[a-zA-Z0-9_-]{1,100}$/.test(scanId)) {
    return error(400, "invalid_scan");
  }

  try {
    const report = await getReportForUser(user.userId, scanId);
    if (!report || !report.entitlement.canViewFullReport ||
        !report.entitlement.canUseFixCredits ||
        !("findings" in report.scan) ||
        report.scan.status !== "completed" ||
        report.scan.readinessScore === null ||
        !report.scan.siteId) {
      return error(404, "not_found");
    }

    const [reviews, versions] = await Promise.all([
      listFixReviewRequests(user.userId, scanId),
      listFixProposalHistoryForScan(user.userId, scanId),
    ]);
    const ownedFindings = new Map(report.scan.findings.map((finding) => [finding.id, finding]));
    const requested = reviews.filter((review) => ownedFindings.has(review.findingId));
    const relevantIds = new Set(requested.map((review) => review.id));
    const history = versions.filter((entry) =>
      relevantIds.has(entry.fixId) && ownedFindings.has(entry.findingId),
    );

    const payload = {
      schemaVersion: 1,
      kind: "recomvia_fix_review_evidence",
      generatedAt: new Date().toISOString(),
      scanId,
      website: report.scan.target?.websiteUrl ?? null,
      executionEnabled: false,
      siteBackupIncluded: false,
      creditsCharged: 0,
      warning: "Review evidence only. Not an implementation approval, website backup, or rollback execution.",
      reviews: requested.map((review) => ({
        reviewId: review.id,
        finding: ownedFindings.get(review.findingId),
        status: review.status,
        createdAt: review.createdAt,
        proposals: history.filter((entry) => entry.fixId === review.id)
          .map((entry) => ({
            proposalId: entry.proposalId,
            version: entry.version,
            scope: entry.scope,
            proposedText: entry.proposedText,
            rationale: entry.rationale,
            rollbackPlan: entry.rollbackPlan,
            createdAt: entry.createdAt,
            decision: entry.decision,
            decisionComment: entry.decisionComment,
            decisionAt: entry.decisionAt,
          })),
      })),
    };

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        ...noStore,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="recomvia-fix-review-${scanId}.json"`,
      },
    });
  } catch {
    return error(503, "temporarily_unavailable");
  }
}
