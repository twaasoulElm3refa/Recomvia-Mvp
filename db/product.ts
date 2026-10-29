import { analysisPolicy, analysisProjectKey, type AnalysisPolicy } from "@/lib/analysis-policy";
import type { AnalysisInsights } from "@/lib/analysis-insights";
import type {
  AnalysisTarget,
  TargetDiscovery,
  TargetInput,
} from "@/lib/analysis-target";
import { env } from "cloudflare:workers";
import type { AuthUser } from "@/app/auth";
import { createId } from "@/lib/ids";
import type {
  LiveReadinessResult,
  ReadinessFinding,
} from "@/lib/live-readiness";
import type {
  ActualVisibilityMeasurement,
  DiscoveredSiteContext,
  VisibilityEngineRun,
  VisibilityEvidence,
} from "@/lib/ai-visibility";
import {
  resolveReportEntitlement,
  FREE_REPORT_ENTITLEMENT,
  type ReportEntitlement,
  type SubscriptionRecord,
} from "@/lib/report-entitlements";

export type Workspace = {
  organizationId: string;
  userId: string;
  email: string;
  displayName: string;
};

export type StoredFinding = ReadinessFinding & { id: string };

export type StoredEngineRun = VisibilityEngineRun;

export type StoredScan = {
  id: string;
  organizationId: string;
  siteId: string | null;
  host: string | null;
  target: AnalysisTarget | null;
  targetInput: TargetInput | null;
  discovery: TargetDiscovery | null;
  targetInputJson?: string;
  discoveryJson?: string;
  displayName: string;
  status: string;
  scanKind: string;
  methodologyVersion: string;
  language: string;
  country: string;
  readinessScore: number | null;
  actualVisibilityStatus: string;
  actualVisibilityScore: number | null;
  actualVisibilityConfidence: number | null;
  engineRunCount: number;
  contextConfidence: number | null;
  confidence: number | null;
  issueCount: number;
  criticalCount: number;
  sourceUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  bytesFetched: number;
  requestCount: number;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  insights?: AnalysisInsights | null;
  findings: StoredFinding[];
  categoryScores: Record<string, number>;
  discoveredContext: DiscoveredSiteContext | null;
  engineRuns: StoredEngineRun[];
};

export type ReportSummary = Pick<
  StoredScan,
  | "id"
  | "displayName"
  | "status"
  | "scanKind"
  | "methodologyVersion"
  | "language"
  | "country"
  | "readinessScore"
  | "actualVisibilityStatus"
  | "actualVisibilityScore"
  | "actualVisibilityConfidence"
  | "engineRunCount"
  | "contextConfidence"
  | "confidence"
  | "issueCount"
  | "criticalCount"
  | "completedAt"
  | "createdAt"
> & {
  detailLevel: "summary";
  target: Pick<AnalysisTarget, "kind" | "name"> | null;
  categoryScores: Record<string, number>;
};

export type ReportView = {
  scan: StoredScan | ReportSummary | StarterReport | PendingReport;
  entitlement: ReportEntitlement;
};

export type StarterReport = StoredScan & { detailLevel: "starter" };
type PendingReport = ReportSummary & {
  targetInput: TargetInput | null;
  discovery: Pick<TargetDiscovery, "status" | "candidates"> | null;
};

// This is a small view of the already stored scan, never a new provider run.
function toStarterReport(scan: StoredScan): StarterReport {
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const first = scan.engineRuns.find((run) => !run.error) || scan.engineRuns[0];
  const engineRuns = scan.engineRuns
    .filter((run) => first && run.provider === first.provider && run.model === first.model && run.surfaceType === first.surfaceType)
    .slice(0, 3);
  const competitor = engineRuns.flatMap((run) => run.analysis.competitorsMentioned)[0];
  const { targetInputJson: _input, discoveryJson: _discovery, ...safe } = scan;
  void _input; void _discovery;
  return {
    ...safe, insights: null, detailLevel: "starter", targetInput: null, discovery: null, discoveredContext: null,
    findings: scan.findings.filter((finding) => finding.status !== "pass")
      .sort((a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)).slice(0, 3),
    engineRuns: engineRuns.map((run) => ({
      ...run,
      analysis: { ...run.analysis, competitorsMentioned: competitor && run.analysis.competitorsMentioned.includes(competitor) ? [competitor] : [] },
    })),
  };
}

export function database() {
  if (!env.DB) throw new Error("Product storage is temporarily unavailable.");
  return env.DB;
}

function workspaceName(user: AuthUser) {
  const base = user.fullName?.trim() || user.email.split("@")[0] || "Recomvia";
  return `${base} workspace`.slice(0, 100);
}

export async function ensureWorkspace(user: AuthUser): Promise<Workspace> {
  const db = database();
  await db
    .prepare(
      `
    INSERT INTO users (id, email, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      updated_at = CURRENT_TIMESTAMP
  `,
    )
    .bind(
      user.userId,
      user.email.toLowerCase(),
      user.fullName || user.displayName,
    )
    .run();

  const existing = await db
    .prepare(
      `
    SELECT m.organization_id AS organizationId
    FROM organization_members m
    WHERE m.user_id = ?
    ORDER BY m.created_at ASC
    LIMIT 1
  `,
    )
    .bind(user.userId)
    .first<{ organizationId: string }>();

  const organizationId =
    existing?.organizationId ||
    `org_${user.userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 42)}`;
  if (!existing) {
    await db.batch([
      db
        .prepare(
          `
        INSERT INTO organizations (id, name, owner_user_id)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `,
        )
        .bind(organizationId, workspaceName(user), user.userId),
      db
        .prepare(
          `
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES (?, ?, 'owner')
        ON CONFLICT(organization_id, user_id) DO NOTHING
      `,
        )
        .bind(organizationId, user.userId),
    ]);
  }
  return {
    organizationId,
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
  };
}

export async function getOrCreateSite(
  workspace: Workspace,
  input: {
    host: string;
    normalizedUrl: string;
    language: string;
    country: string;
  },
) {
  const db = database();
  const existing = await db
    .prepare(
      `
    SELECT id, organization_id AS organizationId, host, normalized_url AS normalizedUrl,
      display_name AS displayName, default_language AS defaultLanguage, default_country AS defaultCountry
    FROM sites WHERE organization_id = ? AND host = ? LIMIT 1
  `,
    )
    .bind(workspace.organizationId, input.host)
    .first<{
      id: string;
      organizationId: string;
      host: string;
      normalizedUrl: string;
      displayName: string;
      defaultLanguage: string;
      defaultCountry: string;
    }>();
  if (existing) {
    await db
      .prepare(
        `
      UPDATE sites SET normalized_url = ?, default_language = ?, default_country = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `,
      )
      .bind(
        input.normalizedUrl,
        input.language,
        input.country,
        existing.id,
        workspace.organizationId,
      )
      .run();
    return {
      ...existing,
      normalizedUrl: input.normalizedUrl,
      defaultLanguage: input.language,
      defaultCountry: input.country,
    };
  }
  const id = createId("site");
  await db
    .prepare(
      `
    INSERT INTO sites (id, organization_id, host, normalized_url, display_name, default_language, default_country)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .bind(
      id,
      workspace.organizationId,
      input.host,
      input.normalizedUrl,
      input.host,
      input.language,
      input.country,
    )
    .run();
  return {
    id,
    organizationId: workspace.organizationId,
    host: input.host,
    normalizedUrl: input.normalizedUrl,
    displayName: input.host,
    defaultLanguage: input.language,
    defaultCountry: input.country,
  };
}

function scanSelect() {
  return `
    SELECT s.id, s.organization_id AS organizationId, s.site_id AS siteId,
      w.host, COALESCE(t.display_name, w.display_name, '') AS displayName, s.status, s.scan_kind AS scanKind,
      s.target_input_json AS targetInputJson, s.discovery_json AS discoveryJson,
      s.methodology_version AS methodologyVersion, s.language, s.country,
      s.readiness_score AS readinessScore, s.actual_visibility_status AS actualVisibilityStatus,
      s.actual_visibility_score AS actualVisibilityScore, s.actual_visibility_confidence AS actualVisibilityConfidence,
      s.engine_run_count AS engineRunCount, s.context_confidence AS contextConfidence,
      s.confidence, s.issue_count AS issueCount, s.critical_count AS criticalCount,
      s.source_url AS sourceUrl, s.final_url AS finalUrl, s.http_status AS httpStatus,
      s.bytes_fetched AS bytesFetched, s.request_count AS requestCount,
      s.error_message AS errorMessage, s.completed_at AS completedAt, s.created_at AS createdAt
    FROM scans s
    LEFT JOIN sites w ON w.id = s.site_id
    LEFT JOIN analysis_targets t ON t.id = s.target_id
  `;
}

function reportSummarySelect() {
  return `
    SELECT s.id, s.organization_id AS organizationId,
      COALESCE(t.display_name, w.display_name, '') AS displayName,
      t.kind AS targetKind, t.display_name AS targetName,
      s.status, s.scan_kind AS scanKind, s.methodology_version AS methodologyVersion,
      s.language, s.country, s.readiness_score AS readinessScore,
      s.actual_visibility_status AS actualVisibilityStatus,
      s.actual_visibility_score AS actualVisibilityScore,
      s.actual_visibility_confidence AS actualVisibilityConfidence,
      s.engine_run_count AS engineRunCount, s.context_confidence AS contextConfidence,
      s.confidence, s.issue_count AS issueCount, s.critical_count AS criticalCount,
      s.completed_at AS completedAt, s.created_at AS createdAt
    FROM scans s
    LEFT JOIN sites w ON w.id = s.site_id
    LEFT JOIN analysis_targets t ON t.id = s.target_id
  `;
}

type ReportSummaryRow = Omit<ReportSummary, "detailLevel" | "target" | "categoryScores"> & {
  organizationId: string;
  targetKind: AnalysisTarget["kind"] | null;
  targetName: string | null;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function contextForScan(
  scanId: string,
): Promise<DiscoveredSiteContext | null> {
  const row = await database()
    .prepare(
      `
    SELECT brand_name AS brandName, business_description AS businessDescription, category,
      offerings_json AS offeringsJson, languages_json AS languagesJson, markets_json AS marketsJson,
      intents_json AS intentsJson, competitors_json AS competitorsJson,
      confidence_json AS confidenceJson, evidence_json AS evidenceJson
    FROM scan_contexts WHERE scan_id = ? LIMIT 1
  `,
    )
    .bind(scanId)
    .first<{
      brandName: string;
      businessDescription: string;
      category: string;
      offeringsJson: string;
      languagesJson: string;
      marketsJson: string;
      intentsJson: string;
      competitorsJson: string;
      confidenceJson: string;
      evidenceJson: string;
    }>();
  if (!row) return null;
  const confidence = parseJson<Record<string, number>>(row.confidenceJson, {});
  const evidence = parseJson<Record<string, string[]>>(row.evidenceJson, {});
  return {
    brand: {
      value: row.brandName,
      confidence: confidence.brand ?? 0,
      evidence: evidence.brand ?? [],
    },
    description: {
      value: row.businessDescription,
      confidence: confidence.description ?? 0,
      evidence: evidence.description ?? [],
    },
    category: {
      value: row.category,
      confidence: confidence.category ?? 0,
      evidence: evidence.category ?? [],
    },
    offerings: {
      value: parseJson(row.offeringsJson, []),
      confidence: confidence.offerings ?? 0,
      evidence: evidence.offerings ?? [],
    },
    languages: {
      value: parseJson(row.languagesJson, []),
      confidence: confidence.languages ?? 0,
      evidence: evidence.languages ?? [],
    },
    markets: {
      value: parseJson(row.marketsJson, []),
      confidence: confidence.markets ?? 0,
      evidence: evidence.markets ?? [],
    },
    intents: {
      value: parseJson(row.intentsJson, []),
      confidence: confidence.intents ?? 0,
      evidence: evidence.intents ?? [],
    },
    competitors: {
      value: parseJson(row.competitorsJson, []),
      confidence: confidence.competitors ?? 0,
      evidence: evidence.competitors ?? [],
    },
    sourceUrl: "",
  };
}

async function engineRunsForScan(scanId: string): Promise<StoredEngineRun[]> {
  const rows = await database()
    .prepare(
      `
    SELECT id, provider_run_id AS providerRunId, provider, model, surface_type AS surfaceType,
      prompt_id AS promptId, intent, prompt, language, country, response_text AS responseText,
      sources_json AS sourcesJson, citations_json AS citationsJson, brand_entity AS brandEntity,
      brand_visible AS brandVisible, mention_count AS mentionCount,
      recommendation_status AS recommendationStatus, recommendation_position AS recommendationPosition,
      competitors_json AS competitorsJson, input_tokens AS inputTokens, cached_input_tokens AS cachedInputTokens,
      output_tokens AS outputTokens, total_tokens AS totalTokens, estimated_cost_micros AS estimatedCostMicros,
      duration_ms AS durationMs, error_code AS errorCode, error_message AS errorMessage,
      retry_count AS retryCount, run_timestamp AS timestamp
    FROM engine_runs WHERE scan_id = ? ORDER BY created_at ASC
  `,
    )
    .bind(scanId)
    .all<Record<string, unknown>>();
  const evidenceRows = await database()
    .prepare(
      `
    SELECT id, engine_run_id AS engineRunId, evidence_type AS type, entity_name AS entityName,
      excerpt, position, source_url AS sourceUrl, metadata_json AS metadataJson
    FROM visibility_evidence WHERE scan_id = ? ORDER BY created_at ASC
  `,
    )
    .bind(scanId)
    .all<Record<string, unknown>>();
  const evidenceByRun = new Map<string, VisibilityEvidence[]>();
  for (const row of evidenceRows.results) {
    const runId = String(row.engineRunId);
    const bucket = evidenceByRun.get(runId) || [];
    bucket.push({
      id: String(row.id),
      type: row.type as VisibilityEvidence["type"],
      entityName: row.entityName === null ? null : String(row.entityName),
      excerpt: String(row.excerpt),
      position: row.position === null ? null : Number(row.position),
      sourceUrl: row.sourceUrl === null ? null : String(row.sourceUrl),
      metadata: parseJson(String(row.metadataJson || "{}"), {}),
    });
    evidenceByRun.set(runId, bucket);
  }
  return rows.results.map((row) => ({
    id: String(row.id),
    providerRunId:
      row.providerRunId === null ? null : String(row.providerRunId),
    provider: String(row.provider),
    model: String(row.model),
    surfaceType: row.surfaceType as VisibilityEngineRun["surfaceType"],
    promptId: String(row.promptId),
    intent: row.intent as VisibilityEngineRun["intent"],
    prompt: String(row.prompt),
    language: String(row.language),
    country: String(row.country),
    responseText: row.responseText === null ? null : String(row.responseText),
    sources: parseJson(String(row.sourcesJson || "[]"), []),
    citations: parseJson(String(row.citationsJson || "[]"), []),
    analysis: {
      brandDetected: String(row.brandEntity),
      brandVisible: Boolean(row.brandVisible),
      mentionCount: Number(row.mentionCount || 0),
      recommendationStatus:
        row.recommendationStatus as VisibilityEngineRun["analysis"]["recommendationStatus"],
      recommendationPosition:
        row.recommendationPosition === null
          ? null
          : Number(row.recommendationPosition),
      competitorsMentioned: parseJson(String(row.competitorsJson || "[]"), []),
      evidence: evidenceByRun.get(String(row.id)) || [],
    },
    usage: {
      inputTokens: row.inputTokens === null ? null : Number(row.inputTokens),
      cachedInputTokens:
        row.cachedInputTokens === null ? null : Number(row.cachedInputTokens),
      outputTokens: row.outputTokens === null ? null : Number(row.outputTokens),
      totalTokens: row.totalTokens === null ? null : Number(row.totalTokens),
    },
    estimatedCostMicros:
      row.estimatedCostMicros === null ? null : Number(row.estimatedCostMicros),
    durationMs: Number(row.durationMs || 0),
    retryCount: Number(row.retryCount || 0),
    timestamp: String(row.timestamp),
    error:
      row.errorCode === null
        ? null
        : {
            code: String(row.errorCode),
            message: String(row.errorMessage || "Provider error"),
            status: null,
            retryable: false,
          },
  }));
}

async function findingsForScan(scanId: string) {
  const result = await database()
    .prepare(
      `
    SELECT id, code, category, severity, status, title, explanation, evidence,
      source_url AS sourceUrl, weight, awarded_points AS awardedPoints, sort_order AS sortOrder
    FROM scan_findings
    WHERE scan_id = ?
    ORDER BY sort_order ASC
  `,
    )
    .bind(scanId)
    .all<StoredFinding>();
  return result.results;
}

function computeCategoryScores(findings: StoredFinding[]) {
  const output: Record<string, number> = {};
  for (const finding of findings) {
    const bucket = output[finding.category] || 0;
    output[finding.category] = bucket + finding.weight;
  }
  for (const category of Object.keys(output)) {
    const rows = findings.filter((finding) => finding.category === category);
    const possible = rows.reduce((sum, finding) => sum + finding.weight, 0);
    const awarded = rows.reduce(
      (sum, finding) => sum + finding.awardedPoints,
      0,
    );
    output[category] = possible ? Math.round((awarded / possible) * 100) : 0;
  }
  return output;
}

async function categoryScoresForScan(scanId: string) {
  const result = await database()
    .prepare(
      `
      SELECT category, SUM(weight) AS possible, SUM(awarded_points) AS awarded
      FROM scan_findings WHERE scan_id = ? GROUP BY category
    `,
    )
    .bind(scanId)
    .all<{ category: string; possible: number; awarded: number }>();
  return Object.fromEntries(
    result.results.map((row) => [
      row.category,
      Number(row.possible)
        ? Math.round((Number(row.awarded) / Number(row.possible)) * 100)
        : 0,
    ]),
  );
}

async function toReportSummary(row: ReportSummaryRow): Promise<ReportSummary> {
  const { organizationId: _organizationId, targetKind, targetName, ...safe } = row;
  void _organizationId;
  return {
    ...safe,
    detailLevel: "summary",
    target:
      targetKind && targetName ? { kind: targetKind, name: targetName } : null,
    categoryScores: await categoryScoresForScan(row.id),
  };
}

async function reportEntitlementForOrganization(organizationId: string, scanId?: string) {
  const result = await database()
    .prepare(
      `
      SELECT id, plan, status, current_period_end AS currentPeriodEnd, updated_at AS updatedAt
      FROM subscriptions
      WHERE organization_id = ?
      ORDER BY updated_at DESC, id DESC
    `,
    )
    .bind(organizationId)
    .all<SubscriptionRecord>();
  const purchase = scanId ? await database().prepare(`
    SELECT p.id FROM report_purchases p
    JOIN scans s ON s.id = p.scan_id AND s.organization_id = p.organization_id
    WHERE p.organization_id = ? AND p.scan_id = ? AND p.plan = 'starter'
      AND p.status = 'paid' AND p.paid_at IS NOT NULL AND s.status = 'completed'
    LIMIT 1
  `).bind(organizationId, scanId).first() : null;
  return resolveReportEntitlement(result.results, new Date(), Boolean(purchase));
}

export async function getEntitlementForUser(user: AuthUser) {
  const workspace = await ensureWorkspace(user);
  return reportEntitlementForOrganization(workspace.organizationId);
}

async function hydrateScan(
  row: Omit<
    StoredScan,
    "findings" | "categoryScores" | "discoveredContext" | "engineRuns"
  > | null,
): Promise<StoredScan | null> {
  if (!row) return null;
  const [findings, discoveredContext, engineRuns] = await Promise.all([
    findingsForScan(row.id),
    contextForScan(row.id),
    engineRunsForScan(row.id),
  ]);
  if (discoveredContext) discoveredContext.sourceUrl = row.sourceUrl;
  return {
    ...row,
    ...targetFields(row),
    findings,
    categoryScores: computeCategoryScores(findings),
    discoveredContext,
    engineRuns,
    insights: parseJson<AnalysisInsights | null>((await database().prepare("SELECT details_json AS details FROM scan_insights WHERE scan_id=?").bind(row.id).first<{ details: string }>())?.details, null),
  };
}

export async function findCachedScan(workspace: Workspace, cacheKey: string) {
  const row = await database()
    .prepare(
      `${scanSelect()}
    WHERE s.organization_id = ? AND s.cache_key = ? AND s.status = 'completed'
      AND s.actual_visibility_status NOT IN ('failed', 'partial')
      AND s.created_at >= datetime('now', '-24 hours')
    ORDER BY s.created_at DESC LIMIT 1
  `,
    )
    .bind(workspace.organizationId, cacheKey)
    .first<
      Omit<
        StoredScan,
        "findings" | "categoryScores" | "discoveredContext" | "engineRuns"
      >
    >();
  return hydrateScan(row);
}

export async function countRecentScans(workspace: Workspace) {
  const row = await database()
    .prepare(
      `
    SELECT COUNT(*) AS count FROM scans
    WHERE organization_id = ? AND created_at >= datetime('now', '-24 hours')
  `,
    )
    .bind(workspace.organizationId)
    .first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function createRunningScan(input: {
  workspace: Workspace;
  siteId: string | null;
  sourceUrl: string;
  language: string;
  country: string;
  cacheKey: string;
  methodologyVersion: string;
  scanKind: string;
  targetInput?: TargetInput;
  executionPolicy?: AnalysisPolicy;
}) {
  const id = createId("scan");
  const entitlement = await reportEntitlementForOrganization(input.workspace.organizationId);
  const policy = analysisPolicy(entitlement.planId);
  const projectKey = input.targetInput ? analysisProjectKey(input.targetInput) : `website:${input.siteId || input.sourceUrl}`;
  if (input.executionPolicy && input.executionPolicy.plan !== policy.plan) throw new Error("plan_changed");
  if (entitlement.canMonitor) {
    const target = input.targetInput;
    await database().prepare(`
      INSERT INTO subscription_projects (id, organization_id, project_key, display_name)
      SELECT ?, ?, ?, ? WHERE
        (SELECT COUNT(*) FROM subscription_projects WHERE organization_id = ?) < ?
      ON CONFLICT(organization_id, project_key) DO NOTHING
    `).bind(createId("project"), input.workspace.organizationId, projectKey,
      target?.input || input.sourceUrl, input.workspace.organizationId, entitlement.projectLimit).run();
    // On downgrade only the oldest N slots remain active; stored reports survive.
    const project = await database().prepare(`
      SELECT project_key FROM (
        SELECT project_key FROM subscription_projects WHERE organization_id = ?
        ORDER BY created_at ASC, rowid ASC LIMIT ?
      ) WHERE project_key = ?
    `).bind(input.workspace.organizationId, entitlement.projectLimit, projectKey).first();
    if (!project) throw new Error("project_limit");
  }
  // One SQL statement reserves quota before any paid call; parallel requests cannot overrun it.
  const result = await database()
    .prepare(
      `
    INSERT INTO scans
      (id, organization_id, site_id, requested_by_user_id, scan_kind, methodology_version, language, country, source_url, cache_key, target_input_json, analysis_plan, project_key, analysis_policy_json)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM scans WHERE organization_id = ? AND created_at >= datetime('now', '-24 hours')) < ?
      AND (? = 1 OR (SELECT COUNT(*) FROM scans WHERE organization_id = ?
        AND (status = 'completed' OR (status IN ('running', 'awaiting_identity') AND created_at >= datetime('now', '-1 hour')))) < 1)
      AND (? = 0 OR (SELECT COUNT(*) FROM scans WHERE organization_id=? AND project_key=? AND analysis_plan<>'free' AND created_at > datetime('now', '-30 days') AND (status='completed' OR (status IN ('running','awaiting_identity') AND created_at >= datetime('now', '-1 hour')))) < ?)
      AND NOT EXISTS (SELECT 1 FROM scans WHERE organization_id=? AND project_key=? AND status IN ('running','awaiting_identity') AND created_at >= datetime('now', '-1 hour'))
  `,
    )
    .bind(
      id,
      input.workspace.organizationId,
      input.siteId,
      input.workspace.userId,
      input.scanKind,
      input.methodologyVersion,
      input.language,
      input.country,
      input.sourceUrl,
      input.cacheKey,
      JSON.stringify({ request: input.targetInput || null }),
      policy.plan, projectKey, JSON.stringify(policy),
      input.workspace.organizationId,
      entitlement.canMonitor ? 5 : 3,
      entitlement.canMonitor ? 1 : 0,
      input.workspace.organizationId,
      entitlement.canMonitor ? 1 : 0, input.workspace.organizationId, projectKey, policy.measurementsPer30Days,
      input.workspace.organizationId, projectKey,
    )
    .run();
  if (!result.meta.changes) throw new Error(entitlement.canMonitor ? "scan_limit" : "free_scan_limit");
  return id;
}

function targetFields(row: {
  targetInputJson?: string;
  discoveryJson?: string;
  displayName?: string;
}) {
  const data = parseJson<{ request?: TargetInput; target?: AnalysisTarget }>(
    row.targetInputJson,
    {},
  );
  return {
    targetInput: data.request || null,
    target: data.target || null,
    discovery: parseJson<TargetDiscovery | null>(row.discoveryJson, null),
    displayName:
      row.displayName || data.target?.name || data.request?.input || "",
  };
}

export async function attachAnalysisTarget(
  workspace: Workspace,
  scanId: string,
  target: AnalysisTarget,
  request: TargetInput,
  key: string,
) {
  const db = database();
  const id = createId("target");
  await db.batch([
    db
      .prepare(
        `INSERT INTO analysis_targets (id, organization_id, target_key, kind, input, display_name, website_url)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, target_key) DO NOTHING`,
      )
      .bind(
        id,
        workspace.organizationId,
        key,
        target.kind,
        target.input,
        target.name,
        target.websiteUrl,
      ),
    db
      .prepare(
        `UPDATE scans SET target_id = (SELECT id FROM analysis_targets WHERE organization_id = ? AND target_key = ?),
      target_input_json = ? WHERE id = ? AND organization_id = ?`,
      )
      .bind(
        workspace.organizationId,
        key,
        JSON.stringify({ request, target }),
        scanId,
        workspace.organizationId,
      ),
  ]);
}

export async function storeDiscovery(
  workspace: Workspace,
  scanId: string,
  discovery: TargetDiscovery,
) {
  const run = discovery.response;
  const status =
    discovery.status === "ambiguous"
      ? "awaiting_identity"
      : discovery.status === "unresolved"
        ? "needs_clarification"
        : "running";
  await database().batch([
    database()
      .prepare(
        `UPDATE scans SET discovery_json = ?, status = ? WHERE id = ? AND organization_id = ?`,
      )
      .bind(
        JSON.stringify(discovery),
        status,
        scanId,
        workspace.organizationId,
      ),
    ...(run
      ? [
          database()
            .prepare(
              `INSERT INTO cost_ledger
      (id, organization_id, scan_id, category, provider, units, cost_micros, metadata_json)
      VALUES (?, ?, ?, 'entity_discovery', ?, ?, ?, ?)`,
            )
            .bind(
              createId("cost"),
              workspace.organizationId,
              scanId,
              run.provider,
              run.usage.totalTokens || 0,
              run.estimatedCostMicros ?? 0,
              JSON.stringify({
                costKnown: run.estimatedCostMicros !== null,
                providerRunId: run.providerRunId,
                model: run.model,
                status: discovery.status,
                promptTokens: run.usage.inputTokens,
                completionTokens: run.usage.outputTokens,
                reasoningTokens: run.usage.reasoningTokens ?? null,
                visibleOutputTokens: run.usage.visibleOutputTokens ?? null,
                finishReason: run.finishReason ?? null,
                retryCount: run.retryCount,
                errorCode: run.error?.code ?? null,
                latencyMs: run.durationMs,
              }),
            ),
        ]
      : []),
  ]);
}

export async function claimIdentityChoice(
  workspace: Workspace,
  scanId: string,
) {
  const result = await database()
    .prepare(
      `UPDATE scans SET status = 'running', cache_key = cache_key || '|confirmed:' || id
    WHERE id = ? AND organization_id = ? AND status = 'awaiting_identity' AND created_at >= datetime('now', '-1 hour')`,
    )
    .bind(scanId, workspace.organizationId)
    .run();
  return Boolean(result.meta.changes);
}

export type ScanCompletion = Omit<
  LiveReadinessResult,
  "readinessScore" | "finalUrl" | "httpStatus" | "identityCandidates" | "internalLinks" | "pageText"
> & {
  readinessScore: number | null;
  finalUrl: string | null;
  httpStatus: number | null;
};

function contextConfidence(context: DiscoveredSiteContext) {
  const values = [
    context.brand.confidence,
    context.description.confidence,
    context.category.confidence,
    context.offerings.confidence,
    context.languages.confidence,
    context.markets.confidence,
    context.competitors.confidence,
  ];
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

export async function completeScan(
  workspace: Workspace,
  scanId: string,
  result: ScanCompletion,
  visibility: ActualVisibilityMeasurement,
) {
  const db = database();
  const context = result.discoveredContext;
  const confidenceJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(context)
        .filter(([key]) => key !== "sourceUrl")
        .map(([key, value]) => [
          key,
          (value as { confidence: number }).confidence,
        ]),
    ),
  );
  const evidenceJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(context)
        .filter(([key]) => key !== "sourceUrl")
        .map(([key, value]) => [
          key,
          (value as { evidence: string[] }).evidence,
        ]),
    ),
  );
  const statements = [
    db
      .prepare(
        `
      UPDATE scans SET status = 'completed', readiness_score = ?, actual_visibility_status = ?,
        actual_visibility_score = ?, actual_visibility_confidence = ?, engine_run_count = ?, context_confidence = ?, confidence = ?,
        issue_count = ?, critical_count = ?, final_url = ?, http_status = ?, bytes_fetched = ?, request_count = ?, language = ?, country = ?,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `,
      )
      .bind(
        result.readinessScore,
        visibility.status,
        visibility.score,
        visibility.confidence,
        visibility.engineRuns.length,
        contextConfidence(context),
        result.confidence,
        result.issueCount,
        result.criticalCount,
        result.finalUrl,
        result.httpStatus,
        result.bytesFetched,
        result.requestCount,
        context.languages.value[0] || "Unknown",
        context.markets.value[0] || "Unknown",
        scanId,
        workspace.organizationId,
      ),
    db
      .prepare(
        `
      INSERT INTO scan_contexts
        (scan_id, brand_name, business_description, category, offerings_json, languages_json, markets_json, intents_json, competitors_json, confidence_json, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        scanId,
        context.brand.value,
        context.description.value,
        context.category.value,
        JSON.stringify(context.offerings.value),
        JSON.stringify(context.languages.value),
        JSON.stringify(context.markets.value),
        JSON.stringify(context.intents.value),
        JSON.stringify(context.competitors.value),
        confidenceJson,
        evidenceJson,
      ),
    db
      .prepare(
        `
      UPDATE sites SET display_name = ?, default_language = ?, default_country = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT site_id FROM scans WHERE id = ?)
    `,
      )
      .bind(
        context.brand.value,
        context.languages.value[0] || "Unknown",
        context.markets.value[0] || "Unknown",
        scanId,
      ),
    ...result.findings.map((finding) =>
      db
        .prepare(
          `
      INSERT INTO scan_findings
        (id, scan_id, code, category, severity, status, title, explanation, evidence, source_url, weight, awarded_points, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .bind(
          createId("finding"),
          scanId,
          finding.code,
          finding.category,
          finding.severity,
          finding.status,
          finding.title,
          finding.explanation,
          finding.evidence,
          finding.sourceUrl,
          finding.weight,
          finding.awardedPoints,
          finding.sortOrder,
        ),
    ),
    db
      .prepare(
        `
      INSERT INTO cost_ledger
        (id, organization_id, scan_id, category, provider, units, cost_micros, metadata_json)
      VALUES (?, ?, ?, 'crawl', 'direct_fetch', ?, 0, ?)
    `,
      )
      .bind(
        createId("cost"),
        workspace.organizationId,
        scanId,
        result.requestCount,
        JSON.stringify({
          bytesFetched: result.bytesFetched,
          costKnown: false,
          methodologyVersion: result.methodologyVersion,
        }),
      ),
    db
      .prepare(
        `
      INSERT INTO audit_logs (id, organization_id, actor_user_id, action, target_type, target_id, metadata_json)
      VALUES (?, ?, ?, 'scan.completed', 'scan', ?, ?)
    `,
      )
      .bind(
        createId("audit"),
        workspace.organizationId,
        workspace.userId,
        scanId,
        JSON.stringify({
          readinessScore: result.readinessScore,
          issueCount: result.issueCount,
        }),
      ),
    ...visibility.engineRuns.map((run) =>
      db
        .prepare(
          `
      INSERT INTO engine_runs
        (id, scan_id, provider_run_id, provider, model, surface_type, prompt_id, intent, prompt, language, country,
         response_text, sources_json, citations_json, brand_entity, brand_visible, mention_count, recommendation_status,
         recommendation_position, competitors_json, input_tokens, cached_input_tokens, output_tokens, total_tokens,
         estimated_cost_micros, duration_ms, error_code, error_message, retry_count, run_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .bind(
          run.id,
          scanId,
          run.providerRunId,
          run.provider,
          run.model,
          run.surfaceType,
          run.promptId,
          run.intent,
          run.prompt,
          run.language,
          run.country,
          run.responseText,
          JSON.stringify(run.sources),
          JSON.stringify(run.citations),
          run.analysis.brandDetected,
          Number(run.analysis.brandVisible),
          run.analysis.mentionCount,
          run.analysis.recommendationStatus,
          run.analysis.recommendationPosition,
          JSON.stringify(run.analysis.competitorsMentioned),
          run.usage.inputTokens,
          run.usage.cachedInputTokens,
          run.usage.outputTokens,
          run.usage.totalTokens,
          run.estimatedCostMicros,
          run.durationMs,
          run.error?.code || null,
          run.error?.message || null,
          run.retryCount,
          run.timestamp,
        ),
    ),
    ...visibility.engineRuns.flatMap((run) =>
      run.analysis.evidence.map((evidence) =>
        db
          .prepare(
            `
      INSERT INTO visibility_evidence
        (id, scan_id, engine_run_id, evidence_type, entity_name, excerpt, position, source_url, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
          )
          .bind(
            evidence.id,
            scanId,
            run.id,
            evidence.type,
            evidence.entityName,
            evidence.excerpt,
            evidence.position,
            evidence.sourceUrl,
            JSON.stringify(evidence.metadata),
          ),
      ),
    ),
    ...visibility.engineRuns
      .filter((run) => run.estimatedCostMicros !== null)
      .map((run) =>
        db
          .prepare(
            `
      INSERT OR IGNORE INTO cost_ledger
        (id, organization_id, scan_id, category, provider, units, cost_micros, metadata_json)
      VALUES (?, ?, ?, 'ai_engine', ?, ?, ?, ?)
    `,
          )
          .bind(
            `engine_${run.id}`,
            workspace.organizationId,
            scanId,
            run.provider,
            run.usage.totalTokens || 0,
            run.estimatedCostMicros,
            JSON.stringify({
              engineRunId: run.id,
              model: run.model,
              surfaceType: run.surfaceType,
              inputTokens: run.usage.inputTokens,
              cachedInputTokens: run.usage.cachedInputTokens,
              outputTokens: run.usage.outputTokens,
              reasoningTokens: run.usage.reasoningTokens ?? null,
              visibleOutputTokens: run.usage.visibleOutputTokens ?? null,
              finishReason: run.finishReason ?? null,
              providerRunId: run.providerRunId,
              errorCode: run.error?.code ?? null,
              latencyMs: run.durationMs,
              retryCount: run.retryCount,
            }),
          ),
      ),
  ];
  await db.batch(statements);
  return getScanForUser(workspace.userId, scanId);
}

export async function failScan(
  workspace: Workspace,
  scanId: string,
  message: string,
) {
  await database()
    .prepare(
      `
    UPDATE scans SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND organization_id = ?
  `,
    )
    .bind(message.slice(0, 500), scanId, workspace.organizationId)
    .run();
}

export async function getScanForUser(userId: string, scanId: string) {
  const row = await database()
    .prepare(
      `${scanSelect()}
    JOIN organization_members m ON m.organization_id = s.organization_id
    WHERE s.id = ? AND m.user_id = ? LIMIT 1
  `,
    )
    .bind(scanId, userId)
    .first<
      Omit<
        StoredScan,
        "findings" | "categoryScores" | "discoveredContext" | "engineRuns"
      >
    >();
  return hydrateScan(row);
}

export async function getLatestScanForUser(userId: string) {
  const row = await database()
    .prepare(
      `${scanSelect()}
    JOIN organization_members m ON m.organization_id = s.organization_id
    WHERE m.user_id = ? AND s.status = 'completed'
    ORDER BY s.created_at DESC LIMIT 1
  `,
    )
    .bind(userId)
    .first<
      Omit<
        StoredScan,
        "findings" | "categoryScores" | "discoveredContext" | "engineRuns"
      >
    >();
  return hydrateScan(row);
}

async function getReportSummaryRowForUser(userId: string, scanId: string) {
  return database()
    .prepare(
      `${reportSummarySelect()}
      JOIN organization_members m ON m.organization_id = s.organization_id
      WHERE s.id = ? AND m.user_id = ? LIMIT 1
    `,
    )
    .bind(scanId, userId)
    .first<ReportSummaryRow>();
}

export async function getReportForUser(
  userId: string,
  scanId: string,
): Promise<ReportView | null> {
  const row = await getReportSummaryRowForUser(userId, scanId);
  if (!row) return null;

  // Only the identity-choice fields are needed to resume an incomplete scan.
  // Never serialize partially written paid findings/answers through this path.
  if (row.status !== "completed") {
    const summary = await toReportSummary(row);
    if (row.status !== "awaiting_identity")
      return { scan: summary, entitlement: { ...FREE_REPORT_ENTITLEMENT } };
    const scan = await getScanForUser(userId, scanId);
    if (!scan) return null;
    return {
      scan: { ...summary, targetInput: scan.targetInput,
        discovery: scan.discovery ? { status: scan.discovery.status, candidates: scan.discovery.candidates } : null },
      entitlement: { ...FREE_REPORT_ENTITLEMENT },
    };
  }

  const entitlement = await reportEntitlementForOrganization(row.organizationId, row.id);
  if (!entitlement.canViewStarterReport) {
    return { scan: await toReportSummary(row), entitlement };
  }
  const scan = await getScanForUser(userId, scanId);
  if (!scan) return null;
  if (scan.insights && !entitlement.canViewAdvancedReport) scan.insights = { ...scan.insights, advanced: null };
  return { scan: entitlement.canViewFullReport ? scan : toStarterReport(scan), entitlement };
}

export async function getLatestReportForUser(
  userId: string,
): Promise<ReportView | null> {
  const row = await database()
    .prepare(
      `${reportSummarySelect()}
      JOIN organization_members m ON m.organization_id = s.organization_id
      WHERE m.user_id = ? AND s.status = 'completed'
      ORDER BY s.created_at DESC LIMIT 1
    `,
    )
    .bind(userId)
    .first<ReportSummaryRow>();
  if (!row) return null;
  return getReportForUser(userId, row.id);
}

export async function getLatestScanSummaryForUser(userId: string) {
  const row = await database()
    .prepare(
      `${reportSummarySelect()}
      JOIN organization_members m ON m.organization_id = s.organization_id
      WHERE m.user_id = ? AND s.status = 'completed'
      ORDER BY s.created_at DESC LIMIT 1
    `,
    )
    .bind(userId)
    .first<ReportSummaryRow>();
  return row ? toReportSummary(row) : null;
}

export async function listScansForUser(userId: string, limit = 20) {
  const result = await database()
    .prepare(
      `${reportSummarySelect()}
    JOIN organization_members m ON m.organization_id = s.organization_id
    WHERE m.user_id = ?
    ORDER BY s.created_at DESC LIMIT ?
  `,
    )
    .bind(userId, Math.max(1, Math.min(50, limit)))
    .all<ReportSummaryRow>();
  return Promise.all(result.results.map(toReportSummary));
}

export async function getReportPurchaseForScan(organizationId: string, scanId: string) {
  return database().prepare(`
    SELECT id, organization_id AS organizationId, scan_id AS scanId, plan, status,
      provider, provider_payment_id AS providerPaymentId, amount_cents AS amountCents,
      currency, paid_at AS paidAt, created_at AS createdAt
    FROM report_purchases
    WHERE organization_id = ? AND scan_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(organizationId, scanId).first<{
    id: string;
    organizationId: string;
    scanId: string;
    plan: string;
    status: string;
    provider: string;
    providerPaymentId: string;
    amountCents: number;
    currency: string;
    paidAt: string | null;
    createdAt: string;
  }>();
}

export async function recordStarterPurchase(input: {
  organizationId: string;
  scanId: string;
  providerPaymentId: string;
  amountCents: number;
  currency?: string;
  status?: string;
}) {
  const db = database();
  const id = createId("pur");
  const currency = input.currency || "USD";
  const status = input.status || "paid";
  const paidAt = status === "paid" ? new Date().toISOString() : null;

  await db.prepare(`
    INSERT INTO report_purchases
      (id, organization_id, scan_id, plan, status, provider, provider_payment_id, amount_cents, currency, paid_at)
    VALUES (?, ?, ?, 'starter', ?, 'paypal', ?, ?, ?, ?)
    ON CONFLICT(provider, provider_payment_id) DO UPDATE SET
      status = excluded.status,
      paid_at = COALESCE(excluded.paid_at, report_purchases.paid_at),
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    id,
    input.organizationId,
    input.scanId,
    status,
    input.providerPaymentId,
    input.amountCents,
    currency,
    paidAt,
  ).run();

  return { id, organizationId: input.organizationId, scanId: input.scanId, status };
}

export async function upsertPayPalSubscription(input: {
  organizationId: string;
  plan: "essential" | "growth" | "pro";
  status: string;
  providerSubscriptionId: string;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}) {
  const db = database();
  const id = createId("sub");
  const result = await db.prepare(`
    INSERT INTO subscriptions
      (id, organization_id, plan, status, provider, provider_subscription_id, current_period_end, cancel_at_period_end)
    SELECT ?, ?, ?, ?, 'paypal', ?, ?, ?
    WHERE ? <> 'active' OR NOT EXISTS (
      SELECT 1 FROM subscriptions other
      WHERE other.organization_id = ? AND other.status IN ('active', 'suspended', 'payment_failed')
        AND other.plan IN ('essential', 'growth', 'pro')
        AND (other.provider IS NOT 'paypal' OR other.provider_subscription_id IS NOT ?)
    )
    ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
      plan = excluded.plan,
      status = excluded.status,
      current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = CURRENT_TIMESTAMP
    WHERE subscriptions.organization_id = excluded.organization_id
  `).bind(
    id,
    input.organizationId,
    input.plan,
    input.status,
    input.providerSubscriptionId,
    input.currentPeriodEnd || null,
    input.cancelAtPeriodEnd ? 1 : 0,
    input.status,
    input.organizationId,
    input.providerSubscriptionId,
  ).run();

  return { accepted: Boolean(result.meta.changes), id, organizationId: input.organizationId, plan: input.plan, status: input.status };
}

export type ActivePaidSubscription = {
  id: string;
  plan: "essential" | "growth" | "pro";
  provider: string | null;
  providerSubscriptionId: string | null;
  status: string;
  updatedAt: string;
};

/** Includes historical conflicts so callers never mistake a second active
 * PayPal billing agreement for a safe new checkout. The most recently updated
 * row wins for display and entitlement; other agreements need PayPal review. */
export async function activePaidSubscriptions(organizationId: string): Promise<ActivePaidSubscription[]> {
  const rows = await database().prepare(`
    SELECT id, plan, status, provider, provider_subscription_id AS providerSubscriptionId, updated_at AS updatedAt
    FROM subscriptions
    WHERE organization_id = ? AND status IN ('active', 'suspended', 'payment_failed')
      AND plan IN ('essential', 'growth', 'pro')
    ORDER BY updated_at DESC, id DESC
  `).bind(organizationId).all<ActivePaidSubscription>();
  return rows.results;
}

export async function paypalSubscriptionOwner(providerSubscriptionId: string) {
  return database().prepare(`
    SELECT organization_id AS organizationId, plan, status
    FROM subscriptions WHERE provider = 'paypal' AND provider_subscription_id = ?
  `).bind(providerSubscriptionId).first<{ organizationId: string; plan: string; status: string }>();
}

/** A short-lived organization claim closes the race before the PayPal create
 * or revise request. Abandoned claims expire; inactive subscription rows do
 * not block a fresh checkout. */
export async function claimSubscriptionCheckout(organizationId: string, targetPlan: string, kind: "create" | "revise", providerSubscriptionId: string | null = null) {
  const db = database();
  await db.prepare(`DELETE FROM subscription_checkout_claims WHERE organization_id = ? AND created_at <= datetime('now', '-15 minutes')`).bind(organizationId).run();
  const result = await db.prepare(`
    INSERT OR IGNORE INTO subscription_checkout_claims (organization_id, target_plan, kind, provider_subscription_id)
    VALUES (?, ?, ?, ?)
  `).bind(organizationId, targetPlan, kind, providerSubscriptionId).run();
  return Boolean(result.meta.changes);
}

export async function attachSubscriptionCheckout(organizationId: string, providerSubscriptionId: string) {
  await database().prepare(`UPDATE subscription_checkout_claims SET provider_subscription_id = ? WHERE organization_id = ?`).bind(providerSubscriptionId, organizationId).run();
}

export async function releaseSubscriptionCheckout(organizationId: string, providerSubscriptionId?: string) {
  await database().prepare(`
    DELETE FROM subscription_checkout_claims
    WHERE organization_id = ? AND (? IS NULL OR provider_subscription_id = ?)
  `).bind(organizationId, providerSubscriptionId ?? null, providerSubscriptionId ?? null).run();
}

