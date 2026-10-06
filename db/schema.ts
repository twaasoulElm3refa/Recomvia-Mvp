import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_organizations_owner").on(table.ownerUserId)]);

export const organizationMembers = sqliteTable("organization_members", {
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role").notNull().default("owner"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.userId] }),
  index("idx_organization_members_user").on(table.userId),
]);

export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  host: text("host").notNull(),
  normalizedUrl: text("normalized_url").notNull(),
  displayName: text("display_name").notNull(),
  defaultLanguage: text("default_language").notNull().default("English"),
  defaultCountry: text("default_country").notNull().default("United States"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_sites_organization_host").on(table.organizationId, table.host),
  index("idx_sites_organization_updated").on(table.organizationId, table.updatedAt),
]);

export const scans = sqliteTable("scans", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  siteId: text("site_id").notNull().references(() => sites.id),
  requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("running"),
  scanKind: text("scan_kind").notNull().default("live_readiness"),
  methodologyVersion: text("methodology_version").notNull(),
  language: text("language").notNull(),
  country: text("country").notNull(),
  readinessScore: integer("readiness_score"),
  actualVisibilityStatus: text("actual_visibility_status").notNull().default("not_measured"),
  actualVisibilityScore: integer("actual_visibility_score"),
  actualVisibilityConfidence: integer("actual_visibility_confidence"),
  engineRunCount: integer("engine_run_count").notNull().default(0),
  contextConfidence: integer("context_confidence"),
  confidence: integer("confidence"),
  issueCount: integer("issue_count").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  sourceUrl: text("source_url").notNull(),
  finalUrl: text("final_url"),
  httpStatus: integer("http_status"),
  cacheKey: text("cache_key").notNull(),
  bytesFetched: integer("bytes_fetched").notNull().default(0),
  requestCount: integer("request_count").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_scans_organization_created").on(table.organizationId, table.createdAt),
  index("idx_scans_site_created").on(table.siteId, table.createdAt),
  index("idx_scans_cache_status_created").on(table.cacheKey, table.status, table.createdAt),
]);

export const scanContexts = sqliteTable("scan_contexts", {
  scanId: text("scan_id").primaryKey().references(() => scans.id),
  brandName: text("brand_name").notNull(),
  businessDescription: text("business_description").notNull(),
  category: text("category").notNull(),
  offeringsJson: text("offerings_json").notNull().default("[]"),
  languagesJson: text("languages_json").notNull().default("[]"),
  marketsJson: text("markets_json").notNull().default("[]"),
  intentsJson: text("intents_json").notNull().default("[]"),
  competitorsJson: text("competitors_json").notNull().default("[]"),
  confidenceJson: text("confidence_json").notNull().default("{}"),
  evidenceJson: text("evidence_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const engineRuns = sqliteTable("engine_runs", {
  id: text("id").primaryKey(),
  scanId: text("scan_id").notNull().references(() => scans.id),
  providerRunId: text("provider_run_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  surfaceType: text("surface_type").notNull(),
  promptId: text("prompt_id").notNull(),
  intent: text("intent").notNull(),
  prompt: text("prompt").notNull(),
  language: text("language").notNull(),
  country: text("country").notNull(),
  responseText: text("response_text"),
  sourcesJson: text("sources_json").notNull().default("[]"),
  citationsJson: text("citations_json").notNull().default("[]"),
  brandEntity: text("brand_entity").notNull(),
  brandVisible: integer("brand_visible", { mode: "boolean" }),
  mentionCount: integer("mention_count"),
  recommendationStatus: text("recommendation_status").notNull().default("unavailable"),
  recommendationPosition: integer("recommendation_position"),
  competitorsJson: text("competitors_json").notNull().default("[]"),
  inputTokens: integer("input_tokens"),
  cachedInputTokens: integer("cached_input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCostMicros: integer("estimated_cost_micros"),
  durationMs: integer("duration_ms").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  runTimestamp: text("run_timestamp").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_engine_runs_scan_created").on(table.scanId, table.createdAt),
  index("idx_engine_runs_provider_model").on(table.provider, table.model),
]);

export const visibilityEvidence = sqliteTable("visibility_evidence", {
  id: text("id").primaryKey(),
  scanId: text("scan_id").notNull().references(() => scans.id),
  engineRunId: text("engine_run_id").notNull().references(() => engineRuns.id),
  evidenceType: text("evidence_type").notNull(),
  entityName: text("entity_name"),
  excerpt: text("excerpt").notNull(),
  position: integer("position"),
  sourceUrl: text("source_url"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_visibility_evidence_scan").on(table.scanId),
  index("idx_visibility_evidence_run").on(table.engineRunId),
]);

export const scanFindings = sqliteTable("scan_findings", {
  id: text("id").primaryKey(),
  scanId: text("scan_id").notNull().references(() => scans.id),
  code: text("code").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  explanation: text("explanation").notNull(),
  evidence: text("evidence").notNull(),
  sourceUrl: text("source_url").notNull(),
  weight: integer("weight").notNull(),
  awardedPoints: integer("awarded_points").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_scan_findings_scan_order").on(table.scanId, table.sortOrder),
  uniqueIndex("idx_scan_findings_scan_code").on(table.scanId, table.code),
]);

export const costLedger = sqliteTable("cost_ledger", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  scanId: text("scan_id").references(() => scans.id),
  category: text("category").notNull(),
  provider: text("provider").notNull(),
  units: integer("units").notNull().default(0),
  costMicros: integer("cost_micros").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_cost_ledger_scan").on(table.scanId),
  index("idx_cost_ledger_organization_created").on(table.organizationId, table.createdAt),
]);

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  plan: text("plan").notNull(),
  status: text("status").notNull().default("inactive"),
  provider: text("provider"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  currentPeriodEnd: text("current_period_end"),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_subscriptions_organization_status").on(table.organizationId, table.status),
  uniqueIndex("idx_subscriptions_provider_id").on(table.provider, table.providerSubscriptionId),
]);

export const fixes = sqliteTable("fixes", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  siteId: text("site_id").notNull().references(() => sites.id),
  scanId: text("scan_id").references(() => scans.id),
  findingId: text("finding_id").references(() => scanFindings.id),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("draft"),
  credits: integer("credits").notNull().default(0),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  approvedByUserId: text("approved_by_user_id").references(() => users.id),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_fixes_organization_status").on(table.organizationId, table.status)]);

export const creditLedger = sqliteTable("credit_ledger", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  fixId: text("fix_id").references(() => fixes.id),
  delta: integer("delta").notNull(),
  kind: text("kind").notNull(),
  referenceType: text("reference_type").notNull(),
  referenceId: text("reference_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_credit_ledger_idempotency").on(table.idempotencyKey),
  index("idx_credit_ledger_organization_created").on(table.organizationId, table.createdAt),
]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  actorUserId: text("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_audit_logs_organization_created").on(table.organizationId, table.createdAt)]);

export const supportTickets = sqliteTable("support_tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull(),
  accessKeyHash: text("access_key_hash").notNull(),
  requesterName: text("requester_name").notNull(),
  requesterEmail: text("requester_email").notNull(),
  authenticatedUserId: text("authenticated_user_id"),
  question: text("question").notNull(),
  pageUrl: text("page_url").notNull().default(""),
  status: text("status").notNull().default("open"),
  humanReply: text("human_reply"),
  answeredBy: text("answered_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  answeredAt: text("answered_at"),
}, (table) => [
  uniqueIndex("idx_support_tickets_public_id").on(table.publicId),
  index("idx_support_tickets_status_created").on(table.status, table.createdAt),
]);
