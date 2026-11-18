import assert from "node:assert/strict";
import test from "node:test";
import { createFixture, state, userA, userB } from "./target-runtime-fixture";
import { POST as requestReview } from "../app/api/fix-reviews/route";
import { POST as saveProposal } from "../app/api/fix-proposals/route";
import { listFixReviewRequests, listPendingFixReviews } from "../db/fix-review";

type Fixture = ReturnType<typeof createFixture>;

function seed(db: Fixture, active = true) {
  db.exec(`
    INSERT INTO users (id, email, display_name)
      VALUES ('target-test-a', 'a@example.test', 'Tester A');
    INSERT INTO organizations (id, name, owner_user_id)
      VALUES ('review-org-a', 'Review Test', 'target-test-a');
    INSERT INTO organization_members (organization_id, user_id, role)
      VALUES ('review-org-a', 'target-test-a', 'owner');
    INSERT INTO sites (id, organization_id, host, normalized_url, display_name)
      VALUES ('review-site-a', 'review-org-a', 'example.test', 'https://example.test', 'Example');
    INSERT INTO scans (id, organization_id, site_id, requested_by_user_id, status,
                       scan_kind, methodology_version, language, country,
                       readiness_score, source_url, cache_key)
      VALUES ('review-scan-a', 'review-org-a', 'review-site-a', 'target-test-a', 'completed',
              'live_readiness', 'readiness-v0.1', 'en', 'Global',
              70, 'https://example.test', 'review-cache-a');
    INSERT INTO scan_findings (id, scan_id, code, category, severity, status,
                               title, explanation, evidence, source_url,
                               weight, awarded_points, sort_order)
      VALUES ('review-finding-a', 'review-scan-a', 'metadata', 'Technical AEO', 'high', 'fail',
              'Weak metadata', 'Explain the issue', 'Observed metadata', 'https://example.test', 10, 0, 1),
             ('review-finding-passed', 'review-scan-a', 'good-title', 'Technical AEO', 'low', 'pass',
              'Good title', 'No issue', 'Existing title', 'https://example.test', 10, 10, 2);
  `);
  if (active) db.exec(`
    INSERT INTO subscriptions (id, organization_id, plan, status, current_period_end)
    VALUES ('review-paid-a', 'review-org-a', 'essential', 'active', '2099-01-01T00:00:00Z');
  `);
  state.user = userA;
}

function request(body: unknown, origin = "https://recomvia.test") {
  return new Request("https://recomvia.test/api/fix-reviews", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

test("paid owner can request review exactly once, retaining zero charges and a single audit entry", async () => {
  const db = createFixture(false, false);
  seed(db);
  const payload = { scanId: "review-scan-a", findingId: "review-finding-a" };
  // The in-memory D1 fixture does not serialize overlapping transactions;
  // exercise repeat-request idempotency sequentially. The database primary key
  // enforces uniqueness independently of this test's scheduling.
  const responses = [
    await requestReview(request(payload)),
    await requestReview(request(payload)),
    await requestReview(request(payload)),
  ];
  const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{
    request: { id: string; status: string };
    alreadyRequested: boolean; approved: boolean; executionEnabled: boolean; creditsCharged: number;
  }>));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200, 201]);
  assert.ok(bodies.every((body) => body.request.status === "review_requested"));
  assert.ok(bodies.every((body) => body.approved === false && body.executionEnabled === false && body.creditsCharged === 0));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fixes").get()?.n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM credit_ledger").get()?.n, 0);
  const saved = db.prepare("SELECT status, kind, credits, approved_at FROM fixes").get();
  assert.deepEqual([saved?.status, saved?.kind, saved?.credits, saved?.approved_at], ["review_requested", "finding_review", 0, null]);
  const list = await listFixReviewRequests(userA.userId, payload.scanId);
  assert.equal(list.length, 1);
  assert.equal(list[0].findingId, payload.findingId);
  const staffQueue = await listPendingFixReviews();
  assert.equal(staffQueue.length, 1);
  assert.equal(staffQueue[0].findingTitle, "Weak metadata");
  assert.equal(staffQueue[0].website, "https://example.test");
  db.close();
});

test("free users and failed findings are never eligible", async () => {
  const db = createFixture(false, false);
  seed(db, false);
  const noSubscription = await requestReview(request({ scanId: "review-scan-a", findingId: "review-finding-a" }));
  assert.equal(noSubscription.status, 404);
  db.exec("INSERT INTO subscriptions (id, organization_id, plan, status, current_period_end) VALUES ('paid','review-org-a','growth','active','2099-01-01T00:00:00Z')");
  const alreadyPassed = await requestReview(request({ scanId: "review-scan-a", findingId: "review-finding-passed" }));
  assert.equal(alreadyPassed.status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fixes").get()?.n, 0);
  db.close();
});

test("foreign organization cannot request another account's findings or retrieve their requests", async () => {
  const db = createFixture(false, false);
  seed(db);
  db.exec(`
    INSERT INTO users (id, email, display_name) VALUES ('target-test-b','b@example.test','Tester B');
    INSERT INTO organizations (id, name, owner_user_id) VALUES ('review-org-b','Other Organization','target-test-b');
    INSERT INTO organization_members (organization_id, user_id, role) VALUES ('review-org-b','target-test-b','owner');
    INSERT INTO subscriptions (id, organization_id, plan, status, current_period_end)
      VALUES ('review-paid-b','review-org-b','pro','active','2099-01-01T00:00:00Z');
  `);
  state.user = userB;
  const response = await requestReview(request({ scanId: "review-scan-a", findingId: "review-finding-a" }));
  assert.equal(response.status, 404);
  assert.deepEqual(await listFixReviewRequests(userB.userId, "review-scan-a"), []);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fixes").get()?.n, 0);
  db.close();
});

test("review endpoint rejects cross-origin, malformed or anonymous submissions", async () => {
  const db = createFixture(false, false);
  seed(db);
  const payload = { scanId: "review-scan-a", findingId: "review-finding-a" };
  assert.equal((await requestReview(request(payload, "https://attacker.example"))).status, 403);
  assert.equal((await requestReview(request(null))).status, 400);
  assert.equal((await requestReview(request({ scanId: 5, findingId: "review-finding-a" }))).status, 400);
  state.user = null;
  assert.equal((await requestReview(request(payload))).status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fixes").get()?.n, 0);
  db.close();
});

function proposalRequest(body: unknown, origin = "https://recomvia.test") {
  return new Request("https://recomvia.test/api/fix-proposals", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

test("staff proposal versions are immutable, account-scoped and never apply changes or credits", async () => {
  const db = createFixture(false, false);
  seed(db);
  const reviewResponse = await requestReview(request({
    scanId: "review-scan-a", findingId: "review-finding-a",
  }));
  assert.equal(reviewResponse.status, 201);
  const staff = {
    userId: "staff-recomvia-review",
    email: "staff@example.test", displayName: "Staff", fullName: "Review Staff",
  };
  state.env.RECOMVIA_ADMIN_USER_ID = staff.userId;
  state.user = staff;
  try {
    const firstDraft = {
      fixId: "review_review-finding-a",
      scope: "Meta description on the submitted public page",
      proposedText: "Draft an accurate, concise description for the existing service page.",
      rationale: "The stored finding indicates the current description lacks useful detail.",
      rollbackPlan: "Restore the confirmed original metadata from the verified backup.",
    };
    const firstResponse = await saveProposal(proposalRequest(firstDraft));
    assert.equal(firstResponse.status, 201);
    const firstBody = await firstResponse.json() as { proposal: { id: string; version: number }; applied: boolean; approved: boolean; creditsCharged: number };
    assert.deepEqual([firstBody.proposal.version, firstBody.applied, firstBody.approved, firstBody.creditsCharged], [1, false, false, 0]);

    const secondResponse = await saveProposal(proposalRequest({
      ...firstDraft, proposedText: "Revised draft that remains only a suggestion until reviewed.",
    }));
    assert.equal(secondResponse.status, 201);
    const secondBody = await secondResponse.json() as { proposal: { version: number } };
    assert.equal(secondBody.proposal.version, 2);

    state.user = userA;
    const visible = await listFixReviewRequests(userA.userId, "review-scan-a");
    assert.equal(visible.length, 1);
    assert.equal(visible[0].proposalVersion, 2);
    assert.match(visible[0].proposedText || "", /Revised draft/);
    assert.match(visible[0].rollbackPlan || "", /Restore the confirmed original/);
    const otherUser = await listFixReviewRequests(userB.userId, "review-scan-a");
    assert.equal(otherUser.length, 0);

    const versions = db.prepare(
      "SELECT version, proposed_text FROM fix_proposal_versions ORDER BY version"
    ).all() as Array<{ version: number; proposed_text: string }>;
    assert.deepEqual(versions.map((item) => item.version), [1, 2]);
    assert.match(versions[0].proposed_text, /accurate, concise/);
    assert.match(versions[1].proposed_text, /Revised draft/);
    assert.equal(db.prepare("SELECT status FROM fixes WHERE id = ?").get(firstDraft.fixId)?.status, "proposal_ready");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM credit_ledger").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 3);
    assert.equal(db.prepare("SELECT approved_at FROM fixes WHERE id = ?").get(firstDraft.fixId)?.approved_at, null);
  } finally {
    delete state.env.RECOMVIA_ADMIN_USER_ID;
    db.close();
  }
});

test("staff proposal endpoint enforces admin identity, same-origin and input bounds", async () => {
  const db = createFixture(false, false);
  seed(db);
  const data = {
    fixId: "review_review-finding-a",
    scope: "Meta description on public page",
    proposedText: "A non-executable draft for improvement.",
    rationale: "The real finding is incomplete.",
    rollbackPlan: "Restore the saved original page revision.",
  };
  state.env.RECOMVIA_ADMIN_USER_ID = "staff-recomvia-review";
  try {
    assert.equal((await saveProposal(proposalRequest(data))).status, 404);
    state.user = { userId: "staff-recomvia-review", email: "staff@example.test", displayName: "Staff", fullName: "Staff" };
    assert.equal((await saveProposal(proposalRequest(data, "https://foreign.example"))).status, 403);
    assert.equal((await saveProposal(proposalRequest({ ...data, rollbackPlan: "no" }))).status, 400);
    assert.equal((await saveProposal(proposalRequest({ ...data, fixId: "review_does-not-exist" }))).status, 404);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fix_proposal_versions").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM credit_ledger").get()?.n, 0);
  } finally {
    delete state.env.RECOMVIA_ADMIN_USER_ID;
    db.close();
  }
});
