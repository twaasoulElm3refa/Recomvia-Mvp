import { database, getReportForUser } from "@/db/product";

export type FixReviewRequest = {
  id: string;
  findingId: string;
  status: string;
  createdAt: string;
};

/** Only returns requests for a scan owned by the logged-in account. */
export async function listFixReviewRequests(userId: string, scanId: string): Promise<FixReviewRequest[]> {
  const result = await database().prepare(`
    SELECT f.id, f.finding_id AS findingId, f.status, f.created_at AS createdAt
    FROM fixes f
    JOIN scans s ON s.id = f.scan_id AND s.organization_id = f.organization_id
    JOIN organization_members m ON m.organization_id = s.organization_id
    WHERE s.id = ? AND m.user_id = ? AND f.kind = 'finding_review'
    ORDER BY f.created_at DESC
    LIMIT 100
  `).bind(scanId, userId).all<FixReviewRequest>();
  return result.results;
}

export class FixReviewNotAllowed extends Error {
  constructor() { super("This finding is not eligible for review."); }
}

/**
 * Register a request for human review of an existing website finding.
 * No change is approved/applied, no credit is reserved or charged and no
 * third-party website API is called. The finding ID is the idempotency key.
 */
export async function requestFindingReview(userId: string, scanId: string, findingId: string) {
  const report = await getReportForUser(userId, scanId);
  if (!report || !report.entitlement.canViewFullReport || !report.entitlement.canUseFixCredits ||
      !("findings" in report.scan) || !report.scan.siteId ||
      report.scan.status !== "completed" || report.scan.readinessScore === null ||
      !report.scan.findings.some((finding) => finding.id === findingId && finding.status !== "pass")) {
    throw new FixReviewNotAllowed();
  }

  const id = `review_${findingId}`;
  const db = database();
  const statements = [
    db.prepare(`
      INSERT INTO fixes (id, organization_id, site_id, scan_id, finding_id, kind, status, credits)
      SELECT ?, s.organization_id, s.site_id, s.id, finding.id,
             'finding_review', 'review_requested', 0
      FROM scan_findings finding
      JOIN scans s ON s.id = finding.scan_id
      JOIN organization_members m ON m.organization_id = s.organization_id
      WHERE finding.id = ? AND s.id = ? AND m.user_id = ?
        AND s.status = 'completed' AND s.site_id IS NOT NULL
        AND s.readiness_score IS NOT NULL AND finding.status != 'pass'
        AND EXISTS (
          SELECT 1 FROM subscriptions sub
          WHERE sub.organization_id = s.organization_id
            AND sub.plan IN ('essential', 'growth', 'pro')
            AND sub.status IN ('active', 'trialing')
            AND (sub.current_period_end IS NULL OR datetime(sub.current_period_end) > datetime('now'))
        )
      ON CONFLICT(id) DO NOTHING
    `).bind(id, findingId, scanId, userId),
    db.prepare(`
      INSERT INTO audit_logs
        (id, organization_id, actor_user_id, action, target_type, target_id, metadata_json)
      SELECT ?, f.organization_id, ?, 'fix_review_requested', 'fix', f.id, ?
      FROM fixes f
      JOIN organization_members m ON m.organization_id = f.organization_id
      WHERE f.id = ? AND f.kind = 'finding_review' AND m.user_id = ?
      ON CONFLICT(id) DO NOTHING
    `).bind(
      `audit_${id}`, userId,
      JSON.stringify({ source: "fix_center", applied: false, approved: false, creditsCharged: 0 }),
      id, userId,
    ),
  ];
  const [insert] = await db.batch(statements);
  const record = await db.prepare(`
    SELECT f.id, f.finding_id AS findingId, f.status, f.created_at AS createdAt
    FROM fixes f
    JOIN organization_members m ON m.organization_id = f.organization_id
    WHERE f.id = ? AND f.scan_id = ? AND f.finding_id = ?
      AND m.user_id = ? AND f.kind = 'finding_review'
    LIMIT 1
  `).bind(id, scanId, findingId, userId).first<FixReviewRequest>();
  if (!record) throw new FixReviewNotAllowed();
  return { request: record, alreadyRequested: insert.meta.changes === 0 };
}

/** Private staff queue. Caller must enforce the configured admin user ID. */
export async function listPendingFixReviews(): Promise<Array<{
  id: string;
  organizationName: string;
  website: string;
  findingTitle: string;
  explanation: string;
  evidence: string;
  sourceUrl: string;
  severity: string;
  createdAt: string;
}>> {
  const result = await database().prepare(`
    SELECT f.id, o.name AS organizationName, site.normalized_url AS website,
           finding.title AS findingTitle, finding.explanation,
           finding.evidence, finding.source_url AS sourceUrl,
           finding.severity, f.created_at AS createdAt
    FROM fixes f
    JOIN organizations o ON o.id = f.organization_id
    JOIN sites site ON site.id = f.site_id AND site.organization_id = f.organization_id
    JOIN scans scan ON scan.id = f.scan_id AND scan.organization_id = f.organization_id
    JOIN scan_findings finding ON finding.id = f.finding_id AND finding.scan_id = scan.id
    WHERE f.kind = 'finding_review' AND f.status = 'review_requested'
    ORDER BY f.created_at DESC
    LIMIT 100
  `).all<{
    id: string;
    organizationName: string;
    website: string;
    findingTitle: string;
    explanation: string;
    evidence: string;
    sourceUrl: string;
    severity: string;
    createdAt: string;
  }>();
  return result.results;
}
