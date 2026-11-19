import { database, getReportForUser } from "@/db/product";
import { env } from "cloudflare:workers";

export type FixReviewRequest = {
  id: string;
  findingId: string;
  status: string;
  createdAt: string;
  proposalId: string | null;
  proposalVersion: number | null;
  scope: string | null;
  proposedText: string | null;
  rationale: string | null;
  rollbackPlan: string | null;
  decision: string | null;
  decisionComment: string | null;
};

/** Only returns requests for a scan owned by the logged-in account. */
export async function listFixReviewRequests(userId: string, scanId: string): Promise<FixReviewRequest[]> {
  const result = await database().prepare(`
    SELECT f.id, f.finding_id AS findingId, f.status, f.created_at AS createdAt,
           proposal.id AS proposalId, proposal.version AS proposalVersion,
           proposal.scope, proposal.proposed_text AS proposedText,
           proposal.rationale, proposal.rollback_plan AS rollbackPlan,
           decision.decision, decision.comment AS decisionComment
    FROM fixes f
    JOIN scans s ON s.id = f.scan_id AND s.organization_id = f.organization_id
    JOIN organization_members m ON m.organization_id = s.organization_id
    LEFT JOIN fix_proposal_versions proposal
      ON proposal.id = (
        SELECT version.id FROM fix_proposal_versions version
        WHERE version.fix_id = f.id AND version.organization_id = f.organization_id
        ORDER BY version.version DESC LIMIT 1
      )
    LEFT JOIN fix_proposal_decisions decision ON decision.proposal_id = proposal.id
    WHERE s.id = ? AND m.user_id = ? AND f.kind = 'finding_review'
    ORDER BY f.created_at DESC
    LIMIT 100
  `).bind(scanId, userId).all<FixReviewRequest>();
  return result.results;
}

export type FixProposalHistoryEntry = {
  proposalId: string;
  fixId: string;
  findingId: string;
  version: number;
  scope: string;
  proposedText: string;
  rationale: string;
  rollbackPlan: string;
  createdAt: string;
  decision: string | null;
  decisionComment: string | null;
  decisionAt: string | null;
};

/** Read-only proposal revisions, filtered to the signed-in report owner's organization. */
export async function listFixProposalHistoryForScan(
  userId: string, scanId: string,
): Promise<FixProposalHistoryEntry[]> {
  const report = await getReportForUser(userId, scanId);
  if (!report || !report.entitlement.canViewFullReport || !report.entitlement.canUseFixCredits ||
      !("findings" in report.scan) || report.scan.status !== "completed") return [];
  const rows = await database().prepare(`
    SELECT p.id AS proposalId, f.id AS fixId, f.finding_id AS findingId,
      p.version, p.scope, p.proposed_text AS proposedText,
      p.rationale, p.rollback_plan AS rollbackPlan, p.created_at AS createdAt,
      d.decision, d.comment AS decisionComment, d.created_at AS decisionAt
    FROM fix_proposal_versions p
    JOIN fixes f ON f.id = p.fix_id AND f.organization_id = p.organization_id
    JOIN scans s ON s.id = f.scan_id AND s.organization_id = f.organization_id
    JOIN organization_members m ON m.organization_id = s.organization_id
    LEFT JOIN fix_proposal_decisions d ON d.proposal_id = p.id
    WHERE s.id = ? AND m.user_id = ? AND f.kind = 'finding_review'
    ORDER BY f.id ASC, p.version DESC
    LIMIT 200
  `).bind(scanId, userId).all<FixProposalHistoryEntry>();
  return rows.results;
}

/** Defense in depth: only the configured administrator can read the staff history. */
export async function listFixProposalHistoryForStaff(
  adminUserId: string,
): Promise<FixProposalHistoryEntry[]> {
  if (!env.RECOMVIA_ADMIN_USER_ID || adminUserId !== env.RECOMVIA_ADMIN_USER_ID) return [];
  const rows = await database().prepare(`
    SELECT p.id AS proposalId, f.id AS fixId, f.finding_id AS findingId,
      p.version, p.scope, p.proposed_text AS proposedText,
      p.rationale, p.rollback_plan AS rollbackPlan, p.created_at AS createdAt,
      d.decision, d.comment AS decisionComment, d.created_at AS decisionAt
    FROM fix_proposal_versions p
    JOIN fixes f ON f.id = p.fix_id AND f.organization_id = p.organization_id
    LEFT JOIN fix_proposal_decisions d ON d.proposal_id = p.id
    WHERE f.kind = 'finding_review'
      AND f.status IN ('review_requested', 'proposal_ready', 'proposal_reviewed', 'changes_requested')
    ORDER BY p.created_at DESC, p.version DESC
    LIMIT 300
  `).all<FixProposalHistoryEntry>();
  return rows.results;
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
  status: string;
  proposalVersion: number | null;
  proposedText: string | null;
}>> {
  const result = await database().prepare(`
    SELECT f.id, o.name AS organizationName, site.normalized_url AS website,
           finding.title AS findingTitle, finding.explanation,
           finding.evidence, finding.source_url AS sourceUrl,
           finding.severity, f.created_at AS createdAt, f.status,
           (SELECT MAX(version) FROM fix_proposal_versions WHERE fix_id = f.id) AS proposalVersion,
           (SELECT proposed_text FROM fix_proposal_versions WHERE fix_id = f.id ORDER BY version DESC LIMIT 1) AS proposedText
    FROM fixes f
    JOIN organizations o ON o.id = f.organization_id
    JOIN sites site ON site.id = f.site_id AND site.organization_id = f.organization_id
    JOIN scans scan ON scan.id = f.scan_id AND scan.organization_id = f.organization_id
    JOIN scan_findings finding ON finding.id = f.finding_id AND finding.scan_id = scan.id
    WHERE f.kind = 'finding_review' AND f.status IN ('review_requested', 'proposal_ready', 'proposal_reviewed', 'changes_requested')
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
    status: string;
    proposalVersion: number | null;
    proposedText: string | null;
  }>();
  return result.results;
}

export type FixProposalDraft = {
  scope: string;
  proposedText: string;
  rationale: string;
  rollbackPlan: string;
};

export class FixProposalNotAllowed extends Error {
  constructor() {
    super("The review request is not eligible for a proposal.");
  }
}

/** A staff proposal is an immutable snapshot; creating it cannot apply a change. */
export async function createFixProposalVersion(
  authorUserId: string,
  fixId: string,
  draft: FixProposalDraft,
) {
  if (!env.RECOMVIA_ADMIN_USER_ID || env.RECOMVIA_ADMIN_USER_ID !== authorUserId) {
    throw new FixProposalNotAllowed();
  }

  const id = `proposal_${crypto.randomUUID().replaceAll("-", "")}`;
  const db = database();
  const [created] = await db.batch([
    db.prepare(`
      INSERT INTO fix_proposal_versions
        (id, fix_id, organization_id, version, scope, proposed_text, rationale, rollback_plan, authored_by_user_id)
      SELECT ?, fix.id, fix.organization_id,
        COALESCE((SELECT MAX(version) FROM fix_proposal_versions WHERE fix_id = fix.id), 0) + 1,
        ?, ?, ?, ?, ?
      FROM fixes fix
      WHERE fix.id = ? AND fix.kind = 'finding_review'
        AND fix.status IN ('review_requested','proposal_ready','proposal_reviewed','changes_requested')
    `).bind(
      id, draft.scope, draft.proposedText, draft.rationale,
      draft.rollbackPlan, authorUserId, fixId,
    ),
    db.prepare(`
      UPDATE fixes SET status = 'proposal_ready', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND kind = 'finding_review'
        AND EXISTS (SELECT 1 FROM fix_proposal_versions WHERE id = ? AND fix_id = fixes.id)
    `).bind(fixId, id),
    db.prepare(`
      INSERT INTO audit_logs
        (id, organization_id, actor_user_id, action, target_type, target_id, metadata_json)
      SELECT ?, proposal.organization_id, ?, 'fix_proposal_drafted', 'fix', proposal.fix_id, ?
      FROM fix_proposal_versions proposal
      WHERE proposal.id = ?
    `).bind(
      `audit_${id}`, authorUserId,
      JSON.stringify({ proposalId: id, executionEnabled: false, creditsCharged: 0 }),
      id,
    ),
  ]);
  if (created.meta.changes !== 1) throw new FixProposalNotAllowed();
  const proposal = await db.prepare(`
    SELECT id, fix_id AS fixId, version, scope, proposed_text AS proposedText,
           rationale, rollback_plan AS rollbackPlan, created_at AS createdAt
    FROM fix_proposal_versions WHERE id = ? AND authored_by_user_id = ? LIMIT 1
  `).bind(id, authorUserId).first<{
    id: string;
    fixId: string;
    version: number;
    scope: string;
    proposedText: string;
    rationale: string;
    rollbackPlan: string;
    createdAt: string;
  }>();
  if (!proposal) throw new FixProposalNotAllowed();
  return proposal;
}

export type ProposalDecision = "accepted_for_planning" | "changes_requested";

export class FixProposalDecisionConflict extends Error {
  constructor() { super("This draft is no longer available for a decision."); }
}

/**
 * An authenticated member can record one decision per immutable proposal.
 * Acceptance is for review/planning ONLY, never permission to apply changes.
 */
export async function recordFixProposalDecision(
  userId: string,
  scanId: string,
  proposalId: string,
  decision: ProposalDecision,
  comment: string,
) {
  const report = await getReportForUser(userId, scanId);
  if (!report || !report.entitlement.canUseFixCredits || !report.entitlement.canViewFullReport ||
      !("findings" in report.scan) || report.scan.status !== "completed" ||
      report.scan.readinessScore === null || !report.scan.siteId) {
    throw new FixReviewNotAllowed();
  }
  const id = `decision_${proposalId}`;
  const newStatus = decision === "accepted_for_planning" ? "proposal_reviewed" : "changes_requested";
  const db = database();
  const [insert] = await db.batch([
    db.prepare(`
      INSERT INTO fix_proposal_decisions
        (id, proposal_id, fix_id, organization_id, actor_user_id, decision, comment)
      SELECT ?, p.id, f.id, f.organization_id, ?, ?, ?
      FROM fix_proposal_versions p
      JOIN fixes f ON f.id = p.fix_id AND f.organization_id = p.organization_id
      JOIN scans scan ON scan.id = f.scan_id AND scan.organization_id = f.organization_id
      JOIN organization_members m ON m.organization_id = f.organization_id
      JOIN scan_findings finding ON finding.id = f.finding_id AND finding.scan_id = scan.id
      WHERE p.id = ? AND scan.id = ? AND m.user_id = ?
        AND f.kind = 'finding_review' AND f.status = 'proposal_ready'
        AND finding.status != 'pass'
        AND p.version = (
          SELECT MAX(latest.version) FROM fix_proposal_versions latest WHERE latest.fix_id = f.id
        )
        AND EXISTS (
          SELECT 1 FROM subscriptions sub
          WHERE sub.organization_id = f.organization_id
            AND sub.plan IN ('essential', 'growth', 'pro')
            AND sub.status IN ('active', 'trialing')
            AND (sub.current_period_end IS NULL OR datetime(sub.current_period_end) > datetime('now'))
        )
      ON CONFLICT DO NOTHING
    `).bind(id, userId, decision, comment, proposalId, scanId, userId),
    db.prepare(`
      UPDATE fixes SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT fix_id FROM fix_proposal_decisions WHERE id = ?)
        AND status = 'proposal_ready' AND kind = 'finding_review'
        AND EXISTS (
          SELECT 1 FROM fix_proposal_versions p
          WHERE p.id = ? AND p.fix_id = fixes.id
            AND p.version = (SELECT MAX(v.version) FROM fix_proposal_versions v WHERE v.fix_id = fixes.id)
        )
    `).bind(newStatus, id, proposalId),
    db.prepare(`
      INSERT INTO audit_logs
        (id, organization_id, actor_user_id, action, target_type, target_id, metadata_json)
      SELECT ?, d.organization_id, ?, 'fix_proposal_decision', 'fix', d.fix_id, ?
      FROM fix_proposal_decisions d WHERE d.id = ?
      ON CONFLICT(id) DO NOTHING
    `).bind(
      `audit_${id}`, userId,
      JSON.stringify({ proposalId, decision, applied: false, creditsCharged: 0 }),
      id,
    ),
  ]);
  const record = await db.prepare(`
    SELECT d.id, d.proposal_id AS proposalId, d.decision, d.comment,
           d.actor_user_id AS actorUserId, d.created_at AS createdAt
    FROM fix_proposal_decisions d
    JOIN fixes f ON f.id = d.fix_id
    JOIN fix_proposal_versions p ON p.id = d.proposal_id
    JOIN organization_members m ON m.organization_id = f.organization_id
    WHERE d.id = ? AND d.proposal_id = ? AND f.scan_id = ?
      AND p.version = (SELECT MAX(v.version) FROM fix_proposal_versions v WHERE v.fix_id = f.id)
      AND m.user_id = ? LIMIT 1
  `).bind(id, proposalId, scanId, userId).first<{
    id: string;
    proposalId: string;
    decision: ProposalDecision;
    comment: string;
    actorUserId: string;
    createdAt: string;
  }>();
  if (!record || record.decision !== decision || record.actorUserId !== userId) {
    throw new FixProposalDecisionConflict();
  }
  return { decision: record, alreadyRecorded: insert.meta.changes === 0 };
}
