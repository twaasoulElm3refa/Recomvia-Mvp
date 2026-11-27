import { env } from "cloudflare:workers";
import { createId } from "@/lib/ids";

export type MonitoringScheduleSummary = {
  id: string;
  targetName: string;
  state: "active" | "paused";
  nextRunAt: string;
  lastStatus: string | null;
  lastScanId: string | null;
  leaseUntil: string | null;
};

type MonitoringRow = Omit<MonitoringScheduleSummary, "targetName"> & {
  targetJson: string;
};

function database() {
  if (!env.DB) throw new Error("Monitoring storage unavailable.");
  return env.DB;
}

function targetName(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const name = (parsed as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) return name.trim().slice(0, 160);
    }
  } catch {
    // A malformed legacy target must never break the workspace.
  }
  return "Saved project";
}

export async function listMonitoringSchedulesForUser(userId: string): Promise<MonitoringScheduleSummary[]> {
  const rows = await database().prepare(`
    SELECT m.id, m.target_json AS targetJson, m.state, m.next_run_at AS nextRunAt,
           m.last_status AS lastStatus, m.last_scan_id AS lastScanId, m.lease_until AS leaseUntil
    FROM monitoring_schedules m
    JOIN organization_members member ON member.organization_id = m.organization_id
    WHERE member.user_id = ?
    ORDER BY m.updated_at DESC, m.id
    LIMIT 50
  `).bind(userId).all<MonitoringRow>();
  return rows.results.map(({ targetJson, ...row }) => ({
    ...row, targetName: targetName(targetJson),
  }));
}

export class MonitoringControlError extends Error {
  constructor(readonly code: "not_found" | "subscription_required") {
    super(code);
  }
}

/** A pause/resume changes only the saved schedule; it never starts an AI run. */
export async function setMonitoringScheduleState(
  userId: string,
  scheduleId: string,
  action: "pause" | "resume",
  canMonitor: boolean,
): Promise<{ state: "active" | "paused"; nextRunAt: string; changed: boolean }> {
  const databaseRef = database();
  const existing = await databaseRef.prepare(`
    SELECT m.state, m.next_run_at AS nextRunAt
    FROM monitoring_schedules m
    JOIN organization_members member ON member.organization_id = m.organization_id
    WHERE m.id = ? AND member.user_id = ? LIMIT 1
  `).bind(scheduleId, userId).first<{ state: string; nextRunAt: string }>();
  if (!existing || !["active", "paused"].includes(existing.state)) throw new MonitoringControlError("not_found");
  const desired = action === "pause" ? "paused" : "active";
  if (desired === "active" && !canMonitor) throw new MonitoringControlError("subscription_required");
  if (existing.state === desired) return { state: desired, nextRunAt: existing.nextRunAt, changed: false };

  // Resume only after a future slot, never immediately from an overdue schedule.
  // An already-leased run may finish; pausing prevents *future* job claims.
  // In this transaction, changes() reflects the preceding guarded UPDATE.
  // A concurrent request that loses that update must not write an audit event.
  const [updated] = await databaseRef.batch([
    databaseRef.prepare(`
      UPDATE monitoring_schedules SET state = ?,
        next_run_at = CASE
          WHEN ? = 'active' AND next_run_at <= datetime('now')
          THEN datetime('now', '+1 day') ELSE next_run_at END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND state = ?
        AND EXISTS (
          SELECT 1 FROM organization_members member
          WHERE member.organization_id = monitoring_schedules.organization_id
            AND member.user_id = ?
        )
        AND (? = 'paused' OR EXISTS (
          SELECT 1 FROM subscriptions sub
          WHERE sub.organization_id = monitoring_schedules.organization_id
            AND sub.plan IN ('essential', 'growth', 'pro')
            AND sub.status IN ('active', 'trialing')
            AND (sub.current_period_end IS NULL OR datetime(sub.current_period_end) > datetime('now'))
        ))
    `).bind(desired, desired, scheduleId, existing.state, userId, desired),
    databaseRef.prepare(`
      INSERT INTO audit_logs
        (id, organization_id, actor_user_id, action, target_type, target_id, metadata_json)
      SELECT ?, m.organization_id, ?, ?, 'monitoring_schedule', m.id, ?
      FROM monitoring_schedules m
      JOIN organization_members member ON member.organization_id = m.organization_id
      WHERE m.id = ? AND member.user_id = ? AND m.state = ?
        AND changes() = 1
    `).bind(
      createId("audit"), userId, action === "pause" ? "monitoring_paused" : "monitoring_resumed",
      JSON.stringify({ executionTriggered: false, action }), scheduleId, userId, desired,
    ),
  ]);
  if (updated.meta.changes === 0) throw new MonitoringControlError("not_found");
  const row = await databaseRef.prepare(`
    SELECT m.state, m.next_run_at AS nextRunAt
    FROM monitoring_schedules m
    JOIN organization_members member ON member.organization_id = m.organization_id
    WHERE m.id = ? AND member.user_id = ? LIMIT 1
  `).bind(scheduleId, userId).first<{ state: "active" | "paused"; nextRunAt: string }>();
  if (!row) throw new MonitoringControlError("not_found");
  return { ...row, changed: true };
}
