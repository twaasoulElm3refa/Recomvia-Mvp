import assert from "node:assert/strict";
import test from "node:test";
import { createFixture, state, userA, userB } from "./target-runtime-fixture";
import { listProjectSlotsForUser } from "../db/project-slots";
import { POST as rename } from "../app/api/projects/rename/route";

function request(body: unknown, origin = "https://recomvia.test") {
  return new Request("https://recomvia.test/api/projects/rename", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}
function seedProjects(db: ReturnType<typeof createFixture>) {
  db.exec(`
    INSERT INTO subscription_projects (id, organization_id, project_key, display_name, created_at)
    VALUES
      ('project-one','org-target-test-a','topic:first-topic','First topic','2026-11-01 12:00:00'),
      ('project-two','org-target-test-a','entity:second-topic','Second project','2026-11-02 12:00:00'),
      ('project-three','org-target-test-a','website:third.example','Third project','2026-11-03 12:00:00');
    INSERT INTO scans
      (id,organization_id,requested_by_user_id,scan_kind,methodology_version,
       language,country,source_url,cache_key,project_key,status)
    VALUES ('slot-scan-one','org-target-test-a','target-test-a','entity_visibility',
      'entity-visibility-v1','en','Global','','project-cache','topic:first-topic','completed');
  `);
}

test("slot summaries respect original allocation order and plan downgrade limits", async () => {
  const db = createFixture();
  try {
    seedProjects(db);
    const essential = await listProjectSlotsForUser(userA, 1, true);
    assert.deepEqual(essential.map((slot) => slot.withinPlanLimit), [true, false, false]);
    assert.deepEqual(essential.map((slot) => slot.canRename), [true, true, true]);
    assert.equal(essential[0].latestScanId, "slot-scan-one");
    assert.equal(essential[0].completedScans, 1);
    const pro = await listProjectSlotsForUser(userA, 3, true);
    assert.deepEqual(pro.map((slot) => slot.withinPlanLimit), [true, true, true]);
    const expired = await listProjectSlotsForUser(userA, 3, false);
    assert.deepEqual(expired.map((slot) => slot.withinPlanLimit), [false, false, false]);
  } finally {
    db.close();
  }
});

test("owner can rename project display label without changing project identity or quota", async () => {
  const db = createFixture();
  try {
    seedProjects(db);
    const body = { projectId: "project-one", expectedName: "First topic", displayName: "Customer's market research" };
    const response = await rename(request(body));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      projectId: "project-one", displayName: "Customer's market research",
      changed: true, projectKeyUnchanged: true, quotasReset: false,
    });
    const record = db.prepare("SELECT project_key,display_name FROM subscription_projects WHERE id='project-one'").get();
    assert.equal(record?.project_key, "topic:first-topic");
    assert.equal(record?.display_name, "Customer's market research");
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM subscription_projects").get()?.total, 3);
    assert.equal(db.prepare("SELECT project_key FROM scans WHERE id='slot-scan-one'").get()?.project_key, "topic:first-topic");
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='project_label_renamed'").get()?.total, 1);

    const conflict = await rename(request({ ...body, displayName: "Overwrite from stale window" }));
    assert.equal(conflict.status, 409);
    assert.equal(db.prepare("SELECT display_name FROM subscription_projects WHERE id='project-one'").get()?.display_name, "Customer's market research");
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM audit_logs").get()?.total, 1);
    const noop = await rename(request({ projectId: "project-one", expectedName: "Customer's market research", displayName: "Customer's market research" }));
    assert.equal(noop.status, 200);
    const noopBody = await noop.json() as { changed: boolean };
    assert.equal(noopBody.changed, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM audit_logs").get()?.total, 1);
  } finally {
    db.close();
  }
});

test("viewer may see authorized organization slots but cannot rename them", async () => {
  const db = createFixture();
  try {
    seedProjects(db);
    db.exec(`
      INSERT INTO users (id,email,display_name) VALUES ('target-test-b','b@example.test','B');
      INSERT INTO organization_members (organization_id,user_id,role)
        VALUES ('org-target-test-a','target-test-b','viewer');
    `);
    state.user = userB;
    const slots = await listProjectSlotsForUser(userB, 1, true);
    assert.equal(slots.length, 3);
    assert.ok(slots.every((row) => !row.canRename));
    const response = await rename(request({ projectId: "project-one", expectedName: "First topic", displayName: "Forbidden" }));
    assert.equal(response.status, 403);
    assert.equal(db.prepare("SELECT display_name FROM subscription_projects WHERE id='project-one'").get()?.display_name, "First topic");
  } finally {
    db.close();
  }
});

test("foreign project and malformed or cross-origin requests never alter any label", async () => {
  const db = createFixture();
  try {
    seedProjects(db);
    const original = { projectId: "project-one", expectedName: "First topic", displayName: "Unauthorized edit" };
    assert.equal((await rename(request(original, "https://evil.example"))).status, 403);
    assert.equal((await rename(request(null))).status, 400);
    assert.equal((await rename(request({ ...original, displayName: "X" }))).status, 400);
    state.user = userB;
    assert.equal((await rename(request(original))).status, 404);
    state.user = null;
    assert.equal((await rename(request(original))).status, 401);
    assert.equal(db.prepare("SELECT display_name FROM subscription_projects WHERE id='project-one'").get()?.display_name, "First topic");
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM audit_logs").get()?.total, 0);
  } finally {
    db.close();
  }
});
