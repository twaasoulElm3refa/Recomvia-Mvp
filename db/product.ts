import { env } from "cloudflare:workers";
import type { AuthUser } from "@/app/auth";
import { createId } from "@/lib/ids";
import type { LiveReadinessResult, ReadinessFinding } from "@/lib/live-readiness";
import type { ActualVisibilityMeasurement, DiscoveredSiteContext, VisibilityEngineRun, VisibilityEvidence } from "@/lib/ai-visibility";

type Workspace = { organizationId: string; userId: string; email: string; displayName: string };

export type StoredFinding = ReadinessFinding & { id: string };

export type StoredEngineRun = VisibilityEngineRun;

export type StoredScan = {
  id: string;
  organizationId: string;
  siteId: string;
  host: string;
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
  findings: StoredFinding[];
  categoryScores: Record<string, number>;
  discoveredContext: DiscoveredSiteContext | null;
  engineRuns: StoredEngineRun[];
};

function database() {
  if (!env.DB) throw new Error("Product storage is temporarily unavailable.");
  return env.DB;
}

function workspaceName(user: AuthUser) {
  const base = user.fullName?.trim() || user.email.split("@")[0] || "Recomvia";
  return `${base} workspace`.slice(0, 100);
}

export async function ensureWorkspace(user: AuthUser): Promise<Workspace> {
  const db = database();
  await db.prepare(`
    INSERT INTO users (id, email, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      updated_at = CURRENT_TIMESTAMP
  `).bind(user.userId, user.email.toLowerCase(), user.fullName || user.displayName).run();

  const existing = await db.prepare(`
    SELECT m.organization_id AS organizationId
    FROM organization_members m
    WHERE m.user_id = ?
    ORDER BY m.created_at ASC
    LIMIT 1
  `).bind(user.userId).first<{ organizationId: string }>();

  const organizationId = existing?.organizationId || `org_${user.userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 42)}`;
  if (!existing) {
    await db.batch([
      db.prepare(`
        INSERT INTO organizations (id, name, owner_user_id)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(organizationId, workspaceName(user), user.userId),
      db.prepare(`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES (?, ?, 'owner')
        ON CONFLICT(organization_id, user_id) DO NOTHING
      `).bind(organizationId, user.userId),
    ]);
  }
  return { organizationId, userId: user.userId, email: user.email, displayName: user.displayName };
}

export async function getOrCreateSite(workspace: Workspace, input: { host: string; normalizedUrl: string; language: string; country: string }) {
  const db = database();
  const existing = await db.prepare(`
    SELECT id, organization_id AS organizationId, host, normalized_url AS normalizedUrl,
      display_name AS displayName, default_language AS defaultLanguage, default_country AS defaultCountry
    FROM sites WHERE organization_id = ? AND host = ? LIMIT 1
  `).bind(workspace.organizationId, input.host).first<{
    id: string; organizationId: string; host: string; normalizedUrl: string; displayName: string; defaultLanguage: string; defaultCountry: string;
  }>();
  if (existing) {
    await db.prepare(`
      UPDATE sites SET normalized_url = ?, default_language = ?, default_country = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `).bind(input.normalizedUrl, input.language, input.country, existing.id, workspace.organizationId).run();
    return { ...existing, normalizedUrl: input.normalizedUrl, defaultLanguage: input.language, defaultCountry: input.country };
  }
  const id = createId("site");
  await db.prepare(`
    INSERT INTO sites (id, organization_id, host, normalized_url, display_name, default_language, default_country)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, workspace.organizationId, input.host, input.normalizedUrl, input.host, input.language, input.country).run();
  return { id, organizationId: workspace.organizationId, host: input.host, normalizedUrl: input.normalizedUrl, displayName: input.host, defaultLanguage: input.language, defaultCountry: input.country };
}

function scanSelect() {
  return `
    SELECT s.id, s.organization_id AS organizationId, s.site_id AS siteId,
      w.host, w.display_name AS displayName, s.status, s.scan_kind AS scanKind,
      s.methodology_version AS methodologyVersion, s.language, s.country,
      s.readiness_score AS readinessScore, s.actual_visibility_status AS actualVisibilityStatus,
      s.actual_visibility_score AS actualVisibilityScore, s.actual_visibility_confidence AS actualVisibilityConfidence,
      s.engine_run_count AS engineRunCount, s.context_confidence AS contextConfidence,
      s.confidence, s.issue_count AS issueCount, s.critical_count AS criticalCount,
      s.source_url AS sourceUrl, s.final_url AS finalUrl, s.http_status AS httpStatus,
      s.bytes_fetched AS bytesFetched, s.request_count AS requestCount,
      s.error_message AS errorMessage, s.completed_at AS completedAt, s.created_at AS createdAt
    FROM scans s
    JOIN sites w ON w.id = s.site_id
  `;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function contextForScan(scanId: string): Promise<DiscoveredSiteContext | null> {
  const row = await database().prepare(`
    SELECT brand_name AS brandName, business_description AS businessDescription, category,
      offerings_json AS offeringsJson, languages_json AS languagesJson, markets_json AS marketsJson,
      intents_json AS intentsJson, competitors_json AS competitorsJson,
      confidence_json AS confidenceJson, evidence_json AS evidenceJson
    FROM scan_contexts WHERE scan_id = ? LIMIT 1
  `).bind(scanId).first<{
    brandName: string; businessDescription: string; category: string; offeringsJson: string; languagesJson: string;
    marketsJson: string; intentsJson: string; competitorsJson: string; confidenceJson: string; evidenceJson: string;
  }>();
  if (!row) return null;
  const confidence = parseJson<Record<string, number>>(row.confidenceJson, {});
  const evidence = parseJson<Record<string, string[]>>(row.evidenceJson, {});
  return {
    brand: { value: row.brandName, confidence: confidence.brand ?? 0, evidence: evidence.brand ?? [] },
    description: { value: row.businessDescription, confidence: confidence.description ?? 0, evidence: evidence.description ?? [] },
    category: { value: row.category, confidence: confidence.category ?? 0, evidence: evidence.category ?? [] },
    offerings: { value: parseJson(row.offeringsJson, []), confidence: confidence.offerings ?? 0, evidence: evidence.offerings ?? [] },
    languages: { value: parseJson(row.languagesJson, []), confidence: confidence.languages ?? 0, evidence: evidence.languages ?? [] },
    markets: { value: parseJson(row.marketsJson, []), confidence: confidence.markets ?? 0, evidence: evidence.markets ?? [] },
    intents: { value: parseJson(row.intentsJson, []), confidence: confidence.intents ?? 0, evidence: evidence.intents ?? [] },
    competitors: { value: parseJson(row.competitorsJson, []), confidence: confidence.competitors ?? 0, evidence: evidence.competitors ?? [] },
    sourceUrl: "",
  };
}

async function engineRunsForScan(scanId: string): Promise<StoredEngineRun[]> {
  const rows = await database().prepare(`
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
  `).bind(scanId).all<Record<string, unknown>>();
  const evidenceRows = await database().prepare(`
    SELECT id, engine_run_id AS engineRunId, evidence_type AS type, entity_name AS entityName,
      excerpt, position, source_url AS sourceUrl, metadata_json AS metadataJson
    FROM visibility_evidence WHERE scan_id = ? ORDER BY created_at ASC
  `).bind(scanId).all<Record<string, unknown>>();
  const evidenceByRun = new Map<string, VisibilityEvidence[]>();
  for (const row of evidenceRows.results) {
    const runId = String(row.engineRunId);
    const bucket = evidenceByRun.get(runId) || [];
    bucket.push({ id: String(row.id), type: row.type as VisibilityEvidence["type"], entityName: row.entityName === null ? null : String(row.entityName), excerpt: String(row.excerpt), position: row.position === null ? null : Number(row.position), sourceUrl: row.sourceUrl === null ? null : String(row.sourceUrl), metadata: parseJson(String(row.metadataJson || "{}"), {}) });
    evidenceByRun.set(runId, bucket);
  }
  return rows.results.map(row => ({
    id: String(row.id), providerRunId: row.providerRunId === null ? null : String(row.providerRunId), provider: String(row.provider), model: String(row.model), surfaceType: row.surfaceType as VisibilityEngineRun["surfaceType"],
    promptId: String(row.promptId), intent: row.intent as VisibilityEngineRun["intent"], prompt: String(row.prompt), language: String(row.language), country: String(row.country), responseText: row.responseText === null ? null : String(row.responseText),
    sources: parseJson(String(row.sourcesJson || "[]"), []), citations: parseJson(String(row.citationsJson || "[]"), []),
    analysis: { brandDetected: String(row.brandEntity), brandVisible: Boolean(row.brandVisible), mentionCount: Number(row.mentionCount || 0), recommendationStatus: row.recommendationStatus as VisibilityEngineRun["analysis"]["recommendationStatus"], recommendationPosition: row.recommendationPosition === null ? null : Number(row.recommendationPosition), competitorsMentioned: parseJson(String(row.competitorsJson || "[]"), []), evidence: evidenceByRun.get(String(row.id)) || [] },
    usage: { inputTokens: row.inputTokens === null ? null : Number(row.inputTokens), cachedInputTokens: row.cachedInputTokens === null ? null : Number(row.cachedInputTokens), outputTokens: row.outputTokens === null ? null : Number(row.outputTokens), totalTokens: row.totalTokens === null ? null : Number(row.totalTokens) },
    estimatedCostMicros: row.estimatedCostMicros === null ? null : Number(row.estimatedCostMicros), durationMs: Number(row.durationMs || 0), retryCount: Number(row.retryCount || 0), timestamp: String(row.timestamp),
    error: row.errorCode === null ? null : { code: String(row.errorCode), message: String(row.errorMessage || "Provider error"), status: null, retryable: false },
  }));
}

async function findingsForScan(scanId: string) {
  const result = await database().prepare(`
    SELECT id, code, category, severity, status, title, explanation, evidence,
      source_url AS sourceUrl, weight, awarded_points AS awardedPoints, sort_order AS sortOrder
    FROM scan_findings
    WHERE scan_id = ?
    ORDER BY sort_order ASC
  `).bind(scanId).all<StoredFinding>();
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
    const awarded = rows.reduce((sum, finding) => sum + finding.awardedPoints, 0);
    output[category] = possible ? Math.round((awarded / possible) * 100) : 0;
  }
  return output;
}

async function hydrateScan(row: Omit<StoredScan, "findings" | "categoryScores" | "discoveredContext" | "engineRuns"> | null): Promise<StoredScan | null> {
  if (!row) return null;
  const [findings, discoveredContext, engineRuns] = await Promise.all([findingsForScan(row.id), contextForScan(row.id), engineRunsForScan(row.id)]);
  if (discoveredContext) discoveredContext.sourceUrl = row.sourceUrl;
  return { ...row, findings, categoryScores: computeCategoryScores(findings), discoveredContext, engineRuns };
}

export async function findCachedScan(workspace: Workspace, cacheKey: string) {
  const row = await database().prepare(`${scanSelect()}
    WHERE s.organization_id = ? AND s.cache_key = ? AND s.status = 'completed'
      AND s.actual_visibility_status <> 'failed'
      AND s.created_at >= datetime('now', '-24 hours')
    ORDER BY s.created_at DESC LIMIT 1
  `).bind(workspace.organizationId, cacheKey).first<Omit<StoredScan, "findings" | "categoryScores" | "discoveredContext" | "engineRuns">>();
  return hydrateScan(row);
}

export async function countRecentScans(workspace: Workspace) {
  const row = await database().prepare(`
    SELECT COUNT(*) AS count FROM scans
    WHERE organization_id = ? AND created_at >= datetime('now', '-24 hours')
  `).bind(workspace.organizationId).first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function createRunningScan(input: {
  workspace: Workspace; siteId: string; sourceUrl: string; language: string; country: string; cacheKey: string; methodologyVersion: string; scanKind: string;
}) {
  const id = createId("scan");
  await database().prepare(`
    INSERT INTO scans
      (id, organization_id, site_id, requested_by_user_id, scan_kind, methodology_version, language, country, source_url, cache_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, input.workspace.organizationId, input.siteId, input.workspace.userId, input.scanKind,
    input.methodologyVersion, input.language, input.country, input.sourceUrl, input.cacheKey).run();
  return id;
}

function contextConfidence(context: DiscoveredSiteContext) {
  const values = [context.brand.confidence, context.description.confidence, context.category.confidence, context.offerings.confidence, context.languages.confidence, context.markets.confidence, context.competitors.confidence];
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export async function completeScan(workspace: Workspace, scanId: string, result: LiveReadinessResult, visibility: ActualVisibilityMeasurement) {
  const db = database();
  const context = result.discoveredContext;
  const confidenceJson = JSON.stringify(Object.fromEntries(Object.entries(context).filter(([key]) => key !== "sourceUrl").map(([key, value]) => [key, (value as { confidence: number }).confidence])));
  const evidenceJson = JSON.stringify(Object.fromEntries(Object.entries(context).filter(([key]) => key !== "sourceUrl").map(([key, value]) => [key, (value as { evidence: string[] }).evidence])));
  const statements = [
    db.prepare(`
      UPDATE scans SET status = 'completed', readiness_score = ?, actual_visibility_status = ?,
        actual_visibility_score = ?, actual_visibility_confidence = ?, engine_run_count = ?, context_confidence = ?, confidence = ?,
        issue_count = ?, critical_count = ?, final_url = ?, http_status = ?, bytes_fetched = ?, request_count = ?, language = ?, country = ?,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `).bind(result.readinessScore, visibility.status, visibility.score, visibility.confidence, visibility.engineRuns.length,
      contextConfidence(context), result.confidence, result.issueCount, result.criticalCount, result.finalUrl,
      result.httpStatus, result.bytesFetched, result.requestCount, context.languages.value[0] || "Unknown", context.markets.value[0] || "Unknown",
      scanId, workspace.organizationId),
    db.prepare(`
      INSERT INTO scan_contexts
        (scan_id, brand_name, business_description, category, offerings_json, languages_json, markets_json, intents_json, competitors_json, confidence_json, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(scanId, context.brand.value, context.description.value, context.category.value, JSON.stringify(context.offerings.value),
      JSON.stringify(context.languages.value), JSON.stringify(context.markets.value), JSON.stringify(context.intents.value),
      JSON.stringify(context.competitors.value), confidenceJson, evidenceJson),
    db.prepare(`
      UPDATE sites SET display_name = ?, default_language = ?, default_country = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT site_id FROM scans WHERE id = ?)
    `).bind(context.brand.value, context.languages.value[0] || "Unknown", context.markets.value[0] || "Unknown", scanId),
    ...result.findings.map((finding) => db.prepare(`
      INSERT INTO scan_findings
        (id, scan_id, code, category, severity, status, title, explanation, evidence, source_url, weight, awarded_points, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(createId("finding"), scanId, finding.code, finding.category, finding.severity, finding.status,
      finding.title, finding.explanation, finding.evidence, finding.sourceUrl, finding.weight,
      finding.awardedPoints, finding.sortOrder)),
    db.prepare(`
      INSERT INTO cost_ledger
        (id, organization_id, scan_id, category, provider, units, cost_micros, metadata_json)
      VALUES (?, ?, ?, 'crawl', 'direct_fetch', ?, 0, ?)
    `).bind(createId("cost"), workspace.organizationId, scanId, result.requestCount,
      JSON.stringify({ bytesFetched: result.bytesFetched, methodologyVersion: result.methodologyVersion })),
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, actor_user_id, action, target_type, target_id, metadata_json)
      VALUES (?, ?, ?, 'scan.completed', 'scan', ?, ?)
    `).bind(createId("audit"), workspace.organizationId, workspace.userId, scanId,
      JSON.stringify({ readinessScore: result.readinessScore, issueCount: result.issueCount })),
    ...visibility.engineRuns.map((run) => db.prepare(`
      INSERT INTO engine_runs
        (id, scan_id, provider_run_id, provider, model, surface_type, prompt_id, intent, prompt, language, country,
         response_text, sources_json, citations_json, brand_entity, brand_visible, mention_count, recommendation_status,
         recommendation_position, competitors_json, input_tokens, cached_input_tokens, output_tokens, total_tokens,
         estimated_cost_micros, duration_ms, error_code, error_message, retry_count, run_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(run.id, scanId, run.providerRunId, run.provider, run.model, run.surfaceType, run.promptId, run.intent, run.prompt,
      run.language, run.country, run.responseText, JSON.stringify(run.sources), JSON.stringify(run.citations),
      run.analysis.brandDetected, run.analysis.brandVisible, run.analysis.mentionCount, run.analysis.recommendationStatus,
      run.analysis.recommendationPosition, JSON.stringify(run.analysis.competitorsMentioned), run.usage.inputTokens,
      run.usage.cachedInputTokens, run.usage.outputTokens, run.usage.totalTokens, run.estimatedCostMicros,
      run.durationMs, run.error?.code || null, run.error?.message || null, run.retryCount, run.timestamp)),
    ...visibility.engineRuns.flatMap((run) => run.analysis.evidence.map((evidence) => db.prepare(`
      INSERT INTO visibility_evidence
        (id, scan_id, engine_run_id, evidence_type, entity_name, excerpt, position, source_url, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(evidence.id, scanId, run.id, evidence.type, evidence.entityName, evidence.excerpt, evidence.position,
      evidence.sourceUrl, JSON.stringify(evidence.metadata)))),
    ...visibility.engineRuns.filter((run) => run.estimatedCostMicros !== null).map((run) => db.prepare(`
      INSERT INTO cost_ledger
        (id, organization_id, scan_id, category, provider, units, cost_micros, metadata_json)
      VALUES (?, ?, ?, 'ai_engine', ?, ?, ?, ?)
    `).bind(createId("cost"), workspace.organizationId, scanId, run.provider, run.usage.totalTokens || 0,
      run.estimatedCostMicros, JSON.stringify({ engineRunId: run.id, model: run.model, surfaceType: run.surfaceType,
        inputTokens: run.usage.inputTokens, cachedInputTokens: run.usage.cachedInputTokens,
        outputTokens: run.usage.outputTokens, retryCount: run.retryCount }))),
  ];
  await db.batch(statements);
  return getScanForUser(workspace.userId, scanId);
}

export async function failScan(workspace: Workspace, scanId: string, message: string) {
  await database().prepare(`
    UPDATE scans SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND organization_id = ?
  `).bind(message.slice(0, 500), scanId, workspace.organizationId).run();
}

export async function getScanForUser(userId: string, scanId: string) {
  const row = await database().prepare(`${scanSelect()}
    JOIN organization_members m ON m.organization_id = s.organization_id
    WHERE s.id = ? AND m.user_id = ? LIMIT 1
  `).bind(scanId, userId).first<Omit<StoredScan, "findings" | "categoryScores" | "discoveredContext" | "engineRuns">>();
  return hydrateScan(row);
}

export async function getLatestScanForUser(userId: string) {
  const row = await database().prepare(`${scanSelect()}
    JOIN organization_members m ON m.organization_id = s.organization_id
    WHERE m.user_id = ? AND s.status = 'completed'
    ORDER BY s.created_at DESC LIMIT 1
  `).bind(userId).first<Omit<StoredScan, "findings" | "categoryScores" | "discoveredContext" | "engineRuns">>();
  return hydrateScan(row);
}

export async function listScansForUser(userId: string, limit = 20) {
  const result = await database().prepare(`${scanSelect()}
    JOIN organization_members m ON m.organization_id = s.organization_id
    WHERE m.user_id = ?
    ORDER BY s.created_at DESC LIMIT ?
  `).bind(userId, Math.max(1, Math.min(50, limit))).all<Omit<StoredScan, "findings" | "categoryScores" | "discoveredContext" | "engineRuns">>();
  return result.results;
}
