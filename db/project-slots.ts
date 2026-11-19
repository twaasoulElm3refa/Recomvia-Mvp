import type { AuthUser } from "@/app/auth";
import { database, ensureWorkspace } from "@/db/product";
import { createId } from "@/lib/ids";

export type ProjectSlotSummary = {
  id: string;
  projectKey: string;
  displayName: string;
  createdAt: string;
  completedScans: number;
  latestScanId: string | null;
  monitoringState: string | null;
  withinPlanLimit: boolean;
  canRename: boolean;
};

type ProjectSlotRow = Omit<ProjectSlotSummary, "withinPlanLimit" | "canRename"> & {
  memberRole: string;
};

/**
 * Read the earliest workspace, matching the organization used by entitlement
 * and scan reservations. A label is not a new project or a released slot.
 */
export async function listProjectSlotsForUser(
  user: AuthUser,
  projectLimit: number,
  canMonitor: boolean,
): Promise<ProjectSlotSummary[]> {
  const workspace = await ensureWorkspace(user);
  const rows = await database().prepare(`
    SELECT p.id, p.project_key AS projectKey, p.display_name AS displayName,
           p.created_at AS createdAt, member.role AS memberRole,
           (SELECT COUNT(*) FROM scans s
              WHERE s.organization_id=p.organization_id AND s.project_key=p.project_key
                AND s.status='completed') AS completedScans,
           (SELECT s.id FROM scans s
              WHERE s.organization_id=p.organization_id AND s.project_key=p.project_key
              ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1) AS latestScanId,
           (SELECT m.state FROM monitoring_schedules m
              WHERE m.organization_id=p.organization_id AND m.project_key=p.project_key
              ORDER BY m.updated_at DESC LIMIT 1) AS monitoringState
    FROM subscription_projects p
    JOIN organization_members member ON member.organization_id = p.organization_id
    WHERE p.organization_id=? AND member.user_id=?
    ORDER BY p.created_at ASC, p.rowid ASC
    LIMIT 100
  `).bind(workspace.organizationId, user.userId).all<ProjectSlotRow>();
  return rows.results.map(({ memberRole, ...row }, index) => ({
    ...row,
    completedScans: Number(row.completedScans || 0),
    withinPlanLimit: canMonitor && index < projectLimit,
    canRename: memberRole === "owner",
  }));
}

export class ProjectSlotError extends Error {
  constructor(readonly code: "not_found" | "forbidden" | "conflict") {
    super(code);
  }
}

/**
 * Optimistic, owner-only label change. Never change project_key, scan history,
 * monitoring state or subscription/project quotas.
 */
export async function renameProjectSlot(
  user: AuthUser,
  projectId: string,
  expectedName: string,
  displayName: string,
): Promise<{ projectId: string; displayName: string; changed: boolean }> {
  const workspace = await ensureWorkspace(user);
  const db = database();
  const row = await db.prepare(`
    SELECT p.display_name AS displayName, member.role
    FROM subscription_projects p
    JOIN organization_members member ON member.organization_id=p.organization_id
    WHERE p.id=? AND p.organization_id=? AND member.user_id=? LIMIT 1
  `).bind(projectId, workspace.organizationId, user.userId).first<{
    displayName: string; role: string;
  }>();
  if (!row) throw new ProjectSlotError("not_found");
  if (row.role !== "owner") throw new ProjectSlotError("forbidden");
  if (row.displayName !== expectedName) throw new ProjectSlotError("conflict");
  if (displayName === expectedName) return { projectId, displayName, changed: false };

  const result = await db.prepare(`
    UPDATE subscription_projects SET display_name=?
    WHERE id=? AND organization_id=? AND display_name=?
      AND EXISTS (SELECT 1 FROM organization_members member
        WHERE member.organization_id=subscription_projects.organization_id
          AND member.user_id=? AND member.role='owner')
  `).bind(displayName, projectId, workspace.organizationId, expectedName, user.userId).run();
  if (result.meta.changes !== 1) throw new ProjectSlotError("conflict");

  await db.prepare(`
    INSERT INTO audit_logs
      (id, organization_id, actor_user_id, action, target_type, target_id, metadata_json)
    VALUES (?, ?, ?, 'project_label_renamed', 'subscription_project', ?, ?)
  `).bind(
    createId("audit"), workspace.organizationId, user.userId, projectId,
    JSON.stringify({ oldName: expectedName, newName: displayName, projectKeyUnchanged: true, quotasReset: false }),
  ).run();
  return { projectId, displayName, changed: true };
}
