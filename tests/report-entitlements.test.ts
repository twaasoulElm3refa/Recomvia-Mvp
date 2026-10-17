import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/scans/route";
import { createRunningScan, getReportForUser } from "../db/product";
import { OpenRouterEngineAdapter } from "../lib/ai-engines/openrouter-engine-adapter";
import { PLAN_CATALOG, planById } from "../lib/plans";
import { REPORT_PAYWALL_COPY } from "../lib/report-copy";
import {
  canViewFullReport,
  isSubscriptionActive,
  resolveReportEntitlement,
} from "../lib/report-entitlements";
import { parseTargetInput } from "../lib/analysis-target";
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

test("incomplete scans never expose partially stored report details, including on identity resume", async () => {
  const db = createFixture(false, false);
  seedReport(db);
  const targetInput = parseTargetInput({ input: "Example", kind: "brand" });
  const candidates = [{ id: "candidate-a", kind: "brand", name: "Example", description: "Choose this identity", category: "Software", aliases: [], country: "Global", websiteUrl: null, sources: ["https://example.test"] }];
  db.prepare("UPDATE scans SET target_input_json=?, discovery_json=? WHERE id='scan-a'")
    .run(JSON.stringify({ request: targetInput }), JSON.stringify({ status: "ambiguous", candidates, response: { text: "Private discovery response" } }));
  state.user = userA;
  for (const status of ["running", "failed", "needs_clarification", "awaiting_identity"]) {
    db.prepare("UPDATE scans SET status=? WHERE id='scan-a'").run(status);
    const response = await GET(new Request("https://recomvia.test/api/scans?scan=scan-a"));
    assert.equal(response.status, 200);
    const payload = await response.text();
    for (const forbidden of ["engineRuns", "findings", "Secret AI answer", "secret.example", "Private discovery response"])
      assert.equal(payload.includes(forbidden), false, `${status}: ${forbidden}`);
    const { scan } = JSON.parse(payload);
    if (status === "awaiting_identity") {
      assert.deepEqual(scan.targetInput, targetInput);
      assert.deepEqual(scan.discovery, { status: "ambiguous", candidates });
    } else {
      assert.equal("discovery" in scan, false);
      assert.equal("targetInput" in scan, false);
    }
  }
  db.close();
});

test("active Essential entitlement opens the full stored report", async () => {
  const db = createFixture(false, false);
  seedReport(db);
  addSubscription(db);
  const report = await getReportForUser(userA.userId, "scan-a");
  assert.ok(report);
  assert.equal(report.entitlement.canViewFullReport, true);
  assert.equal(report.entitlement.planId, "essential");
  assert.equal(report.entitlement.canUseFixCredits, true);
  assert.equal(report.entitlement.reportLevel, "detailed");
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

test("approved catalog separates one-time reports, monthly depth and project count", () => {
  assert.deepEqual(PLAN_CATALOG.map((plan) => [plan.id, plan.price.amountCents, plan.billing, plan.projectLimit]), [
    ["free", 0, "free", 1], ["starter", 499, "one_time", 1],
    ["essential", 2400, "monthly", 1], ["growth", 4900, "monthly", 1], ["pro", 9900, "monthly", 3],
  ]);
  assert.deepEqual(planById("growth")!.capabilities, planById("pro")!.capabilities);
  assert.equal(planById("growth")!.reportLevel, "advanced");
  assert.equal(planById("essential")!.reportLevel, "detailed");
});

test("paywall offers one initial report at the catalog price in both languages", () => {
  for (const locale of ["en", "ar"] as const)
    assert.ok(REPORT_PAYWALL_COPY[locale].cta.includes(planById("starter")!.price.amount));
  assert.match(REPORT_PAYWALL_COPY.en.description, /sources, evidence/);
  assert.match(REPORT_PAYWALL_COPY.ar.description, /المصادر والأدلة/);
});

test("entitlements reject unknown/free/starter subscriptions and invalid periods", () => {
  for (const plan of ["free", "starter", "unknown"])
    assert.equal(canViewFullReport([{ plan, status: "active", currentPeriodEnd: null }]), false);
  assert.equal(isSubscriptionActive({ plan: "essential", status: "active", currentPeriodEnd: "not-a-date" }), false);
  assert.equal(isSubscriptionActive({ plan: "essential", status: "active", currentPeriodEnd: "2026-10-15 12:00:00" }, new Date("2026-10-15T12:00:00Z")), false);
});

test("all monthly tiers allow credits; Pro has three projects at the same advanced depth as Growth", () => {
  for (const plan of ["essential", "growth", "pro"] as const) {
    const access = resolveReportEntitlement([{ plan, status: "active", currentPeriodEnd: null }]);
    assert.equal(access.canViewFullReport, true);
    assert.equal(access.canUseFixCredits, true);
    assert.equal(access.canMonitor, true);
    assert.equal(access.projectLimit, plan === "pro" ? 3 : 1);
    assert.equal(access.canViewAdvancedReport, plan !== "essential");
  }
  const starter = resolveReportEntitlement([], new Date(), true);
  assert.equal(starter.canViewStarterReport, true);
  assert.equal(starter.canViewFullReport, false);
  assert.equal(starter.canUseFixCredits, false);
  assert.equal(starter.canMonitor, false);
  assert.equal(resolveReportEntitlement([
    { plan: "essential", status: "active", currentPeriodEnd: null },
    { plan: "pro", status: "active", currentPeriodEnd: null },
  ]).planId, "pro");
});

function addPurchase(db: FixtureDb, status = "paid") {
  db.prepare(`INSERT INTO report_purchases
    (id,organization_id,scan_id,plan,status,provider,provider_payment_id,amount_cents,currency,paid_at)
    VALUES ('purchase-a','org-a','scan-a','starter',?,'test','payment-a',499,'USD',CURRENT_TIMESTAMP)`)
    .run(status);
}

test("Starter unlocks only the purchased scan and never exposes full-report privileges", async () => {
  const db = createFixture(false, false); seedReport(db); addPurchase(db);
  db.exec(`INSERT INTO scans (id,organization_id,site_id,requested_by_user_id,status,source_url,cache_key,methodology_version,language,country)
    VALUES ('scan-other','org-a','site-a','${userA.userId}','completed','https://example.test','other','test','en','Global')`);
  const report = await getReportForUser(userA.userId, "scan-a");
  assert.ok(report && "engineRuns" in report.scan);
  assert.equal(report.entitlement.reportLevel, "starter");
  assert.equal(report.entitlement.canViewFullReport, false);
  assert.equal(report.entitlement.canUseFixCredits, false);
  assert.equal(report.scan.discoveredContext, null);
  assert.equal(report.scan.discovery, null);
  assert.equal("targetInputJson" in report.scan, false);
  assert.equal(report.scan.engineRuns[0].responseText, "Secret AI answer");
  assert.equal((await getReportForUser(userA.userId, "scan-other"))?.entitlement.reportLevel, "summary");
  assert.equal(await getReportForUser(userB.userId, "scan-a"), null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM scans").get()?.n, 2);
  db.close();
});

test("pending/refunded purchases and forged URL parameters cannot unlock reports", async () => {
  const db = createFixture(false, false); seedReport(db); addPurchase(db, "pending");
  for (const status of ["pending", "refunded", "failed"]) {
    db.prepare("UPDATE report_purchases SET status=?").run(status);
    assert.equal((await getReportForUser(userA.userId, "scan-a"))?.entitlement.reportLevel, "summary");
  }
  state.user = userA;
  const response = await GET(new Request("https://recomvia.test/api/scans?scan=scan-a&plan=pro&paid=true"));
  const payload = await response.json() as { entitlement: { reportLevel: string } };
  assert.equal(payload.entitlement.reportLevel, "summary");
  db.close();
});

test("Starter purchase survives subscription expiry and cannot be recorded twice for one payment", async () => {
  const db = createFixture(false, false); seedReport(db); addPurchase(db);
  addSubscription(db, { plan: "pro", currentPeriodEnd: "2020-01-01T00:00:00Z" });
  const report = await getReportForUser(userA.userId, "scan-a");
  assert.equal(report?.entitlement.reportLevel, "starter");
  assert.equal(report?.entitlement.canUseFixCredits, false);
  assert.throws(() => db.exec(`INSERT INTO report_purchases
    (id,organization_id,scan_id,provider,provider_payment_id,amount_cents)
    VALUES ('duplicate','org-a','scan-a','test','payment-a',499)`), /UNIQUE/);
  db.close();
});

function reserve(topic: string, suffix = "") {
  return createRunningScan({
    workspace: { organizationId: "org-a", userId: userA.userId, email: userA.email, displayName: "A" },
    siteId: null, sourceUrl: "", language: "en", country: "Global", cacheKey: topic + suffix,
    methodologyVersion: "test", scanKind: "entity_visibility",
    targetInput: parseTargetInput({ input: topic, kind: "topic", language: "en" }),
  });
}

test("the free allowance is one analysis; paid plans enforce one or three project slots atomically", async () => {
  const free = createFixture(false, false); seedReport(free);
  await assert.rejects(reserve("New topic"), /free_scan_limit/);
  free.close();
  for (const [plan, limit] of [["essential", 1], ["growth", 1], ["pro", 3]] as const) {
    const db = createFixture(false, false); seedReport(db); addSubscription(db, { plan });
    const results = await Promise.allSettled([reserve("Topic A"), reserve("Topic B"), reserve("Topic C"), reserve("Topic D")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, limit);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM subscription_projects").get()?.n, limit);
    for (const result of results.filter((result) => result.status === "rejected"))
      assert.match(String(result.reason), /project_limit/);
    db.close();
  }
});

test("Starter limits the stored view to one engine, initial findings and one structured competitor", async () => {
  const db = createFixture(false, false); seedReport(db); addPurchase(db);
  db.exec(`UPDATE engine_runs SET competitors_json='["Competitor A","Competitor B"]';
    INSERT INTO engine_runs (id,scan_id,provider,model,surface_type,prompt_id,intent,prompt,language,country,response_text,brand_entity,run_timestamp)
    VALUES ('advanced-run','scan-a','Second provider','second-model','api_with_search','prompt-2','discovery','Advanced prompt','en','Global','Advanced engine secret','Example',CURRENT_TIMESTAMP)`);
  for (let i = 1; i < 5; i++) db.exec(`INSERT INTO scan_findings
    (id,scan_id,code,category,severity,status,title,explanation,evidence,source_url,weight,awarded_points,sort_order)
    VALUES ('finding-${i}','scan-a','code-${i}','Technical AEO','high','fail','Finding','Explanation','Evidence','https://example.test',10,5,${i})`);
  db.exec("UPDATE scan_findings SET severity='critical' WHERE id='finding-4'");
  const report = await getReportForUser(userA.userId, "scan-a");
  assert.ok(report && "engineRuns" in report.scan);
  assert.equal(report.scan.findings.length, 3);
  assert.equal(report.scan.findings[0].id, "finding-4");
  assert.equal(report.scan.engineRuns.length, 1);
  assert.deepEqual(report.scan.engineRuns[0].analysis.competitorsMentioned, ["Competitor A"]);
  assert.equal(JSON.stringify(report).includes("Advanced engine secret"), false);
  db.close();
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
