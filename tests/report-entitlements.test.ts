import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/scans/route";
import { getReportForUser } from "../db/product";
import { OpenRouterEngineAdapter } from "../lib/ai-engines/openrouter-engine-adapter";
import { PLAN_CATALOG } from "../lib/plans";
import { REPORT_PAYWALL_COPY } from "../lib/report-copy";
import {
  canViewFullReport,
  isSubscriptionActive,
} from "../lib/report-entitlements";
import { createFixture, state, userA, userB } from "./target-runtime-fixture";

type FixtureDb = ReturnType<typeof createFixture>;

function seedReport(db: FixtureDb) {
  db.exec(`
    INSERT INTO users (id,email) VALUES ('${userA.userId}','${userA.email}');
    INSERT INTO organizations (id,name,owner_user_id) VALUES ('org-a','A','${userA.userId}');
    INSERT INTO organization_members (organization_id,user_id,role) VALUES ('org-a','${userA.userId}','owner');
    INSERT INTO sites (id,organization_id,host,normalized_url,display_name)
      VALUES ('site-a','org-a','example.test','https://example.test','Example');
    INSERT INTO analysis_targets (id,organization_id,target_key,kind,input,display_name)
      VALUES ('target-a','org-a','target-key','brand','Example','Example');
    INSERT INTO scans
      (id,organization_id,site_id,target_id,requested_by_user_id,status,scan_kind,methodology_version,
       language,country,readiness_score,actual_visibility_status,actual_visibility_score,
       engine_run_count,issue_count,critical_count,source_url,cache_key,completed_at)
      VALUES
      ('scan-a','org-a','site-a','target-a','${userA.userId}','completed','entity_visibility','entity-visibility-v1',
       'en','Global',82,'measured',55,1,1,1,'https://example.test','cache-a',CURRENT_TIMESTAMP);
    INSERT INTO scan_contexts
      (scan_id,brand_name,business_description,category,evidence_json)
      VALUES ('scan-a','Secret identity','Secret description','Secret category','{"brand":["secret context evidence"]}');
    INSERT INTO scan_findings
      (id,scan_id,code,category,severity,status,title,explanation,evidence,source_url,weight,awarded_points,sort_order)
      VALUES ('finding-a','scan-a','secret-code','Technical AEO','high','fail','Secret finding','Secret explanation','secret technical evidence','https://secret.example',10,5,0);
    INSERT INTO engine_runs
      (id,scan_id,provider,model,surface_type,prompt_id,intent,prompt,language,country,response_text,
       sources_json,citations_json,brand_entity,brand_visible,mention_count,recommendation_status,
       competitors_json,run_timestamp)
      VALUES ('run-a','scan-a','Test','test-model','api_with_search','prompt-a','discovery','Secret prompt','en','Global',
       'Secret AI answer','[{"url":"https://secret.example"}]','[{"url":"https://secret.example"}]',
       'Example',1,1,'recommended','[]',CURRENT_TIMESTAMP);
    INSERT INTO visibility_evidence
      (id,scan_id,engine_run_id,evidence_type,excerpt,source_url)
      VALUES ('evidence-a','scan-a','run-a','brand_mention','Secret detailed evidence','https://secret.example');
  `);
}

function addSubscription(
  db: FixtureDb,
  input: {
    id?: string;
    organizationId?: string;
    plan?: string;
    status?: string;
    currentPeriodEnd?: string | null;
  } = {},
) {
  db.prepare(
    `INSERT INTO subscriptions
      (id,organization_id,plan,status,current_period_end)
      VALUES (?,?,?,?,?)`,
  ).run(
    input.id || crypto.randomUUID(),
    input.organizationId || "org-a",
    input.plan || "essential",
    input.status || "active",
    input.currentPeriodEnd === undefined
      ? "2099-01-01T00:00:00.000Z"
      : input.currentPeriodEnd,
  );
}

test("free report returns summary statistics without any detailed payload", async () => {
  const db = createFixture(false, false);
  seedReport(db);
  const report = await getReportForUser(userA.userId, "scan-a");
  assert.ok(report);
  assert.equal(report.entitlement.canViewFullReport, false);
  assert.ok("detailLevel" in report.scan);
  if ("detailLevel" in report.scan)
    assert.equal(report.scan.detailLevel, "summary");
  assert.equal(report.scan.actualVisibilityScore, 55);
  assert.equal(report.scan.readinessScore, 82);
  assert.equal(report.scan.categoryScores["Technical AEO"], 50);
  const payload = JSON.stringify(report);
  for (const forbidden of [
    "engineRuns",
    "findings",
    "discoveredContext",
    "Secret AI answer",
    "secret.example",
    "Secret detailed evidence",
    "Secret recommendation",
  ])
    assert.equal(payload.includes(forbidden), false, forbidden);
  db.close();
});

test("free report API serializes only the summary payload", async () => {
  const db = createFixture(false, false);
  seedReport(db);
  state.user = userA;
  const response = await GET(
    new Request("https://recomvia.test/api/scans?scan=scan-a"),
  );
  assert.equal(response.status, 200);
  const payload = await response.text();
  assert.match(payload, /"detailLevel":"summary"/);
  assert.match(payload, /"actualVisibilityScore":55/);
  for (const forbidden of [
    "engineRuns",
    "citations",
    "findings",
    "Secret AI answer",
    "secret.example",
    "Secret detailed evidence",
  ])
    assert.equal(payload.includes(forbidden), false, forbidden);
  db.close();
});

test("active Essential entitlement opens the full stored report", async () => {
  const db = createFixture(false, false);
  seedReport(db);
  addSubscription(db);
  const report = await getReportForUser(userA.userId, "scan-a");
  assert.ok(report);
  assert.deepEqual(report.entitlement, {
    canViewFullReport: true,
    planId: "essential",
  });
  assert.ok("engineRuns" in report.scan);
  if ("engineRuns" in report.scan) {
    assert.equal(report.scan.engineRuns[0].responseText, "Secret AI answer");
    assert.equal(report.scan.engineRuns[0].citations.length, 1);
    assert.equal(report.scan.engineRuns[0].analysis.evidence.length, 1);
    assert.equal(report.scan.findings[0].evidence, "secret technical evidence");
  }
  db.close();
});

test("cancelled and expired subscriptions do not unlock reports", async (t) => {
  await t.test("cancelled", async () => {
    const db = createFixture(false, false);
    seedReport(db);
    addSubscription(db, { status: "cancelled" });
    assert.equal(
      (await getReportForUser(userA.userId, "scan-a"))?.entitlement
        .canViewFullReport,
      false,
    );
    db.close();
  });
  await t.test("expired", async () => {
    const db = createFixture(false, false);
    seedReport(db);
    addSubscription(db, { currentPeriodEnd: "2020-01-01T00:00:00.000Z" });
    assert.equal(
      (await getReportForUser(userA.userId, "scan-a"))?.entitlement
        .canViewFullReport,
      false,
    );
    db.close();
  });
});

test("a subscribed user in another organization cannot access the report", async () => {
  const db = createFixture(false, false);
  seedReport(db);
  db.exec(`
    INSERT INTO users (id,email) VALUES ('${userB.userId}','${userB.email}');
    INSERT INTO organizations (id,name,owner_user_id) VALUES ('org-b','B','${userB.userId}');
    INSERT INTO organization_members (organization_id,user_id,role) VALUES ('org-b','${userB.userId}','owner');
  `);
  addSubscription(db, { organizationId: "org-b" });
  assert.equal(await getReportForUser(userB.userId, "scan-a"), null);
  db.close();
});

test("legacy reports use the same entitlement without regeneration", async () => {
  const db = createFixture(true, false);
  db.exec(
    "INSERT INTO organization_members (organization_id,user_id,role) VALUES ('legacy-org','legacy-user','owner')",
  );
  const limited = await getReportForUser("legacy-user", "legacy-scan");
  assert.ok(limited && "detailLevel" in limited.scan);
  if (limited && "detailLevel" in limited.scan)
    assert.equal(limited.scan.detailLevel, "summary");
  addSubscription(db, {
    organizationId: "legacy-org",
    id: "legacy-subscription",
  });
  const full = await getReportForUser("legacy-user", "legacy-scan");
  assert.ok(full && "engineRuns" in full.scan);
  if (full && "engineRuns" in full.scan)
    assert.equal(full.scan.engineRuns[0].model, "legacy-model");
  db.close();
});

test("plan catalog exposes one report plan and two coming-soon placeholders", () => {
  assert.equal(PLAN_CATALOG.length, 3);
  assert.equal(PLAN_CATALOG[0].id, "essential");
  assert.equal(PLAN_CATALOG[0].description.en, "Full Report Access");
  assert.equal(PLAN_CATALOG[1].availability, "coming_soon");
  assert.equal(PLAN_CATALOG[2].availability, "coming_soon");
  assert.deepEqual(PLAN_CATALOG[1].capabilities, []);
  assert.deepEqual(PLAN_CATALOG[2].capabilities, []);
});

test("English and Arabic locked-report copy is present", () => {
  assert.equal(REPORT_PAYWALL_COPY.en.title, "Unlock the full report");
  assert.equal(REPORT_PAYWALL_COPY.ar.title, "افتح التقرير الكامل");
  assert.match(REPORT_PAYWALL_COPY.en.description, /sources, evidence/);
  assert.match(REPORT_PAYWALL_COPY.ar.description, /المصادر والأدلة/);
});

test("entitlement helpers reject unknown plans and invalid periods", () => {
  assert.equal(
    canViewFullReport([
      { plan: "growth", status: "active", currentPeriodEnd: null },
      { plan: "essential", status: "expired", currentPeriodEnd: null },
    ]),
    false,
  );
  assert.equal(
    isSubscriptionActive({
      plan: "essential",
      status: "active",
      currentPeriodEnd: "not-a-date",
    }),
    false,
  );
});

test("AI test mode refuses the native OpenRouter transport", () => {
  assert.throws(
    () =>
      new OpenRouterEngineAdapter({
        apiKey: "test-only-key",
        model: "test/model",
        testMode: "mock",
      }),
    /blocks the native OpenRouter transport/,
  );
});
