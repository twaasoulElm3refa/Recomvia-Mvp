import { env } from "cloudflare:workers";
import { createId } from "@/lib/ids";
import { analysisProjectKey, type AnalysisPolicy } from "@/lib/analysis-policy";
import type { AnalysisInsights } from "@/lib/analysis-insights";
import type { AnalysisTarget, TargetInput } from "@/lib/analysis-target";
import type { VisibilityEngineRun } from "@/lib/ai-visibility";
import type { Workspace } from "./product";
import type { CrawlUsage } from "@/lib/live-readiness";
const db = () => { if (!env.DB) throw new Error("Storage unavailable"); return env.DB; };

export async function recordPageCrawl(workspace: Workspace, scanId: string, url: string, usage: CrawlUsage, failed: boolean) {
  await db().prepare(`INSERT INTO cost_ledger (id,organization_id,scan_id,category,provider,units,cost_micros,metadata_json)
    VALUES (?,?,?,'crawl','direct_fetch',?,0,?)`).bind(createId("crawl"), workspace.organizationId, scanId, usage.requestCount,
      JSON.stringify({ url, ...usage, failed, costKnown: false, purpose: "additional_page_audit" })).run();
}

export async function recordEngineCost(workspace: Workspace, scanId: string, run: VisibilityEngineRun) {
  if (run.error?.code === "budget_exhausted") return;
  await db().prepare(`INSERT OR IGNORE INTO cost_ledger
    (id, organization_id, scan_id, category, provider, units, cost_micros, metadata_json)
    VALUES (?, ?, ?, 'ai_engine', ?, ?, ?, ?)`).bind(`engine_${run.id}`, workspace.organizationId, scanId, run.provider, run.usage.totalTokens || 0, run.estimatedCostMicros ?? 0,
      JSON.stringify({ engineRunId: run.id, model: run.model, providerRunId: run.providerRunId, costKnown: run.estimatedCostMicros !== null, inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, retryCount: run.retryCount, errorCode: run.error?.code || null })).run();
}
export async function scanCostGuard(workspace: Workspace, scanId: string, reserve: number) {
  const result = await db().prepare("SELECT cost_micros AS cost, metadata_json AS metadata FROM cost_ledger WHERE scan_id=? AND organization_id=? AND category='entity_discovery'").bind(scanId, workspace.organizationId).all<{ cost: number; metadata: string }>();
  return result.results.reduce((sum, row) => sum + (JSON.parse(row.metadata).costKnown === false ? reserve : row.cost), 0);
}
export async function scanPolicyForOwner(workspace: Workspace, scanId: string) {
  return db().prepare("SELECT analysis_plan AS plan, analysis_policy_json AS policy FROM scans WHERE id=? AND organization_id=?").bind(scanId, workspace.organizationId).first<{ plan: string; policy: string }>();
}
export async function saveInsights(workspace: Workspace, scanId: string, input: TargetInput, insights: AnalysisInsights, score: number | null) {
  const previous = await db().prepare(`SELECT s.id, s.completed_at AS at, s.actual_visibility_score AS score, i.details_json AS details
    FROM scans s JOIN scan_insights i ON i.scan_id=s.id WHERE s.organization_id=? AND s.project_key=? AND s.id<>? AND s.status='completed'
    ORDER BY s.completed_at DESC, s.rowid DESC LIMIT 8`).bind(workspace.organizationId, analysisProjectKey(input), scanId).all<{ id: string; at: string; score: number | null; details: string }>();
  insights.history = previous.results.map((row) => {
    const old = JSON.parse(row.details) as AnalysisInsights;
    return { scanId: row.id, at: row.at, score: row.score, comparable: old.basisKey === insights.basisKey && old.scope.coverageComplete && insights.scope.coverageComplete };
  });
  const prior = insights.history.find((item) => item.comparable && item.score !== null);
  insights.change = prior && score !== null ? { previousScanId: prior.scanId, percentagePoints: score - prior.score! } : null;
  await db().prepare("INSERT INTO scan_insights (scan_id,details_json) VALUES (?,?) ON CONFLICT(scan_id) DO UPDATE SET details_json=excluded.details_json")
    .bind(scanId, JSON.stringify(insights)).run();
}

export async function scheduleMonitoring(workspace: Workspace, scanId: string, input: TargetInput, target: AnalysisTarget, policy: AnalysisPolicy) {
  if (!policy.monitoringDays) return;
  await db().prepare(`INSERT INTO monitoring_schedules
    (id,organization_id,user_id,project_key,input_json,target_json,last_scan_id,next_run_at)
    VALUES (?,?,?,?,?,?,?,datetime('now',?))
    ON CONFLICT(organization_id,project_key) DO UPDATE SET input_json=excluded.input_json, target_json=excluded.target_json,
      last_scan_id=excluded.last_scan_id, next_run_at=excluded.next_run_at, state='active', last_status='completed', updated_at=CURRENT_TIMESTAMP`)
    .bind(createId("monitor"), workspace.organizationId, workspace.userId, analysisProjectKey(input), JSON.stringify(input), JSON.stringify(target), scanId, `+${policy.monitoringDays} days`).run();
}
export type MonitoringJob = { id: string; organizationId: string; userId: string; email: string; displayName: string; inputJson: string; targetJson: string; projectKey: string; leaseToken: string };
export async function claimMonitoringJob(): Promise<MonitoringJob | null> {
  const job = await db().prepare(`SELECT m.id, m.organization_id AS organizationId, m.user_id AS userId, u.email, COALESCE(u.display_name,u.email) AS displayName,
      m.input_json AS inputJson, m.target_json AS targetJson, m.project_key AS projectKey
    FROM monitoring_schedules m JOIN users u ON u.id=m.user_id
    JOIN organization_members om ON om.organization_id=m.organization_id AND om.user_id=m.user_id
    WHERE m.state='active' AND m.next_run_at<=datetime('now') AND (m.lease_until IS NULL OR m.lease_until<datetime('now'))
    ORDER BY m.next_run_at, m.rowid LIMIT 1`).first<Omit<MonitoringJob, "leaseToken">>();
  if (!job) return null;
  const token = createId("lease");
  const result = await db().prepare(`UPDATE monitoring_schedules SET lease_token=?, lease_until=datetime('now','+15 minutes')
    WHERE id=? AND state='active' AND next_run_at<=datetime('now') AND (lease_until IS NULL OR lease_until<datetime('now'))`).bind(token, job.id).run();
  return result.meta.changes ? { ...job, leaseToken: token } : null;
}
export async function releaseMonitoringJob(job: MonitoringJob, status: string, pause = false) {
  // Successful analysis already set next_run_at. Failures retry on a later day, never in a hot loop.
  await db().prepare(`UPDATE monitoring_schedules SET lease_token=NULL, lease_until=NULL, last_status=?,
    state=CASE WHEN ?=1 THEN 'paused' ELSE state END,
    next_run_at=CASE WHEN ?='completed' THEN next_run_at ELSE datetime('now','+1 day') END, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND lease_token=?`).bind(status.slice(0,80), Number(pause), status, job.id, job.leaseToken).run();
}
