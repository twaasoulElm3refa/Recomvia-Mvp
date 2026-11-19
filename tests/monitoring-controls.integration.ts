import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/monitoring/control/route";
import { ensureWorkspace } from "../db/product";
import { claimMonitoringJob, scheduleMonitoring } from "../db/analysis";
import { listMonitoringSchedulesForUser } from "../db/monitoring-controls";
import { analysisPolicy, analysisProjectKey } from "../lib/analysis-policy";
import { createFixture, state, userA, userB } from "./target-runtime-fixture";

const input = {
  kind: "brand" as const,
  input: "Example Brand",
  language: "en" as const,
  context: "",
  websiteUrl: null,
};
const target = {
  kind: "brand" as const, name: "Example Brand", input: "Example Brand",
  websiteUrl: null, aliases: [], category: "Business services",
  language: "en", country: "Global", identityConfirmed: true,
};
const id = "monitor-safe-test";

function request(action: string, scheduleId: string = id, origin = "https://recomvia.test") {
  return new Request("https://recomvia.test/api/monitoring/control", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ action, scheduleId }),
  });
}

async function seed(paid = true) {
  const sqlite = createFixture(false, false);
  state.user = userA;
  const workspace = await ensureWorkspace(userA);
  if (paid) {
    sqlite.prepare(`
      INSERT INTO subscriptions (id,organization_id,plan,status,current_period_end)
      VALUES ('monitor-sub',?,'essential','active','2099-01-01T00:00:00.000Z')
    `).run(workspace.organizationId);
  }
  sqlite.prepare(`
    INSERT INTO monitoring_schedules
      (id,organization_id,user_id,project_key,input_json,target_json,next_run_at,state)
    VALUES (?,?,?,?,?,?,datetime('now','-2 days'),'active')
  `).run(id, workspace.organizationId, userA.userId,
    analysisProjectKey(input), JSON.stringify(input), JSON.stringify(target));
  return { sqlite, workspace };
}

test("customer pause and resume are isolated, audited and never trigger an AI scan", async () => {
  const { sqlite } = await seed();
  try {
    const schedules = await listMonitoringSchedulesForUser(userA.userId);
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].targetName, "Example Brand");
    assert.equal(schedules[0].state, "active");
    assert.deepEqual(await listMonitoringSchedulesForUser(userB.userId), []);

    const paused = await POST(request("pause"));
    assert.equal(paused.status, 200);
    const pausedBody = await paused.json() as { state: string; scanStarted: boolean; changed: boolean };
    assert.deepEqual([pausedBody.state, pausedBody.scanStarted, pausedBody.changed], ["paused", false, true]);
    assert.equal((await claimMonitoringJob()), null);
    assert.equal((await POST(request("pause"))).status, 200);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 1);

    const resumed = await POST(request("resume"));
    assert.equal(resumed.status, 200);
    const resumedBody = await resumed.json() as { state: string; nextRunAt: string; scanStarted: boolean };
    assert.equal(resumedBody.state, "active");
    assert.equal(resumedBody.scanStarted, false);
    assert.ok(Date.parse(resumedBody.nextRunAt.replace(" ", "T") + "Z") > Date.now());
    assert.equal((await claimMonitoringJob()), null);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM scans").get()?.n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cost_ledger").get()?.n, 0);
  } finally {
    sqlite.close();
  }
});

test("manual analysis refresh does not override a customer's paused schedule", async () => {
  const { sqlite, workspace } = await seed();
  try {
    assert.equal((await POST(request("pause"))).status, 200);
    sqlite.prepare(`
      INSERT INTO scans
        (id,organization_id,site_id,requested_by_user_id,status,scan_kind,
         methodology_version,language,country,source_url,cache_key)
      VALUES ('monitor-manual-scan',?,NULL,?,'completed','entity_visibility',
              'entity-visibility-v1','en','Global','','monitor-cache')
    `).run(workspace.organizationId, userA.userId);
    await scheduleMonitoring(workspace, "monitor-manual-scan", input, target, analysisPolicy("essential"));
    const row = sqlite.prepare("SELECT state, last_scan_id AS lastScanId FROM monitoring_schedules WHERE id = ?").get(id);
    assert.equal(row?.state, "paused");
    assert.equal(row?.lastScanId, "monitor-manual-scan");
    assert.equal((await claimMonitoringJob()), null);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cost_ledger").get()?.n, 0);
  } finally {
    sqlite.close();
  }
});

test("an expired account can pause but not resume and cannot edit another account", async () => {
  const { sqlite } = await seed(false);
  try {
    assert.equal((await POST(request("pause", id, "https://evil.example"))).status, 403);
    assert.equal((await POST(request("remove"))).status, 400);
    assert.equal((await POST(request("pause"))).status, 200);
    const denied = await POST(request("resume"));
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as { code: string }).code, "subscription_required");
    assert.equal(sqlite.prepare("SELECT state FROM monitoring_schedules WHERE id = ?").get(id)?.state, "paused");
    state.user = userB;
    assert.equal((await POST(request("pause"))).status, 404);
    state.user = null;
    assert.equal((await POST(request("pause"))).status, 401);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 1);
  } finally {
    sqlite.close();
  }
});
