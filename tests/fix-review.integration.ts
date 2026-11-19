import assert from "node:assert/strict";
import test from "node:test";
import { createFixture, state, userA, userB } from "./target-runtime-fixture";
import { POST as requestReview } from "../app/api/fix-reviews/route";
import { GET as exportReviewEvidence } from "../app/api/fix-reviews/export/route";
import { POST as saveProposal } from "../app/api/fix-proposals/route";
import { POST as decideOnProposal } from "../app/api/fix-proposals/decision/route";
import {
  listFixReviewRequests, listPendingFixReviews,
  listFixProposalHistoryForScan, listFixProposalHistoryForStaff,
} from "../db/fix-review";

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
    const history = await listFixProposalHistoryForScan(userA.userId, "review-scan-a");
    assert.deepEqual(history.map((entry) => entry.version), [2, 1]);
    assert.match(history[0].proposedText, /Revised draft/);
    assert.match(history[1].proposedText, /accurate, concise/);
    assert.equal(history[0].decision, null);
    assert.deepEqual(await listFixProposalHistoryForScan(userB.userId, "review-scan-a"), []);
    assert.deepEqual(await listFixProposalHistoryForStaff("unauthorized"), []);
    const staffHistory = await listFixProposalHistoryForStaff(staff.userId);
    assert.equal(staffHistory.length, 2);
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

function decisionRequest(body: unknown, origin = "https://recomvia.test") {
  return new Request("https://recomvia.test/api/fix-proposals/decision", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

test("customer decision is version-bound, idempotent and never authorizes execution or credits", async () => {
  const db = createFixture(false, false);
  seed(db);
  const staff = {
    userId: "staff-proposal-decision",
    email: "decision-staff@example.test", displayName: "Staff", fullName: "Review Staff",
  };
  const template = {
    fixId: "review_review-finding-a",
    scope: "Meta description of the submitted service page",
    proposedText: "A precise description based on the website evidence.",
    rationale: "The stored finding shows an unclear service description.",
    rollbackPlan: "Restore the verified original text from the saved revision.",
  };
  try {
    assert.equal((await requestReview(request({ scanId: "review-scan-a", findingId: "review-finding-a" }))).status, 201);
    state.env.RECOMVIA_ADMIN_USER_ID = staff.userId;
    state.user = staff;
    const drafted = await saveProposal(proposalRequest(template));
    assert.equal(drafted.status, 201);
    const first = await drafted.json() as { proposal: { id: string; version: number } };
    state.user = userA;
    const payload = { scanId: "review-scan-a", proposalId: first.proposal.id, decision: "accepted_for_planning" };
    const accepted = await decideOnProposal(decisionRequest(payload));
    assert.equal(accepted.status, 201);
    const answer = await accepted.json() as {
      applied: boolean; approvedForExecution: boolean; creditsCharged: number;
      decision: { proposalId: string; decision: string };
    };
    assert.equal(answer.decision.proposalId, first.proposal.id);
    assert.deepEqual([answer.decision.decision, answer.applied, answer.approvedForExecution, answer.creditsCharged],
      ["accepted_for_planning", false, false, 0]);
    assert.equal((await decideOnProposal(decisionRequest(payload))).status, 200);
    assert.equal((await decideOnProposal(decisionRequest({ ...payload, decision: "changes_requested", comment: "Please revise." }))).status, 409);
    assert.equal(db.prepare("SELECT status FROM fixes WHERE id = ?").get(template.fixId)?.status, "proposal_reviewed");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fix_proposal_decisions").get()?.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM credit_ledger").get()?.n, 0);
    assert.equal(db.prepare("SELECT approved_at FROM fixes WHERE id = ?").get(template.fixId)?.approved_at, null);

    state.user = staff;
    const revision = await saveProposal(proposalRequest({ ...template, proposedText: "An updated and separately reviewed suggestion." }));
    assert.equal(revision.status, 201);
    const second = await revision.json() as { proposal: { id: string; version: number } };
    assert.equal(second.proposal.version, 2);
    state.user = userA;
    assert.equal((await decideOnProposal(decisionRequest(payload))).status, 409);
    assert.equal(db.prepare("SELECT status FROM fixes WHERE id = ?").get(template.fixId)?.status, "proposal_ready");
    assert.equal((await decideOnProposal(decisionRequest({
      scanId: "review-scan-a", proposalId: second.proposal.id,
      decision: "changes_requested", comment: "Please clarify the intended audience and include source evidence.",
    }))).status, 201);
    assert.equal(db.prepare("SELECT status FROM fixes WHERE id = ?").get(template.fixId)?.status, "changes_requested");
    const latest = await listFixReviewRequests(userA.userId, "review-scan-a");
    assert.equal(latest[0].proposalVersion, 2);
    assert.equal(latest[0].decision, "changes_requested");
    const versionHistory = await listFixProposalHistoryForScan(userA.userId, "review-scan-a");
    assert.deepEqual(versionHistory.map((entry) => entry.version), [2, 1]);
    assert.deepEqual(versionHistory.map((entry) => entry.decision), [
      "changes_requested", "accepted_for_planning",
    ]);
    assert.match(versionHistory[0].decisionComment || "", /clarify/);
    assert.equal(versionHistory[1].decisionComment, "");
    assert.match(latest[0].decisionComment || "", /clarify/);
    assert.equal((await listFixReviewRequests(userB.userId, "review-scan-a")).length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fix_proposal_decisions").get()?.n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM credit_ledger").get()?.n, 0);
  } finally {
    delete state.env.RECOMVIA_ADMIN_USER_ID;
    db.close();
  }
});

test("proposal decision endpoint rejects foreign accounts, forged origin and missing reasons", async () => {
  const db = createFixture(false, false);
  seed(db);
  try {
    const valid = {
      scanId: "review-scan-a",
      proposalId: "proposal_known-only-to-owner",
      decision: "changes_requested",
      comment: "This proposal needs clarification.",
    };
    assert.equal((await decideOnProposal(decisionRequest(valid, "https://evil.example"))).status, 403);
    assert.equal((await decideOnProposal(decisionRequest({ ...valid, comment: "no" }))).status, 400);
    assert.equal((await decideOnProposal(decisionRequest(null))).status, 400);
    state.user = userB;
    assert.equal((await decideOnProposal(decisionRequest(valid))).status, 404);
    state.user = null;
    assert.equal((await decideOnProposal(decisionRequest(valid))).status, 401);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fix_proposal_decisions").get()?.n, 0);
  } finally {
    db.close();
  }
});

test("Fix Center export is account-scoped, no-store and includes only saved proposal evidence", async () => {
  const db = createFixture(false, false);
  seed(db);
  const staff = {
    userId: "staff-export-review",
    email: "export-staff@example.test", displayName: "Staff", fullName: "Review Staff",
  };
  try {
    const query = new Request("https://recomvia.test/api/fix-reviews/export?scan=review-scan-a");
    assert.equal((await exportReviewEvidence(query)).status, 200);
    assert.equal((await requestReview(request({ scanId: "review-scan-a", findingId: "review-finding-a" }))).status, 201);
    state.env.RECOMVIA_ADMIN_USER_ID = staff.userId;
    state.user = staff;
    const draft = await saveProposal(proposalRequest({
      fixId: "review_review-finding-a",
      scope: "Public page metadata field",
      proposedText: "Document the intended metadata revision for a service page.",
      rationale: "The finding contains observed evidence of weak metadata.",
      rollbackPlan: "Restore the verified original metadata from the saved revision.",
    }));
    assert.equal(draft.status, 201);
    state.user = userA;
    const response = await exportReviewEvidence(query);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type") || "", /application\/json/);
    assert.match(response.headers.get("Cache-Control") || "", /no-store/);
    assert.match(response.headers.get("Content-Disposition") || "", /attachment/);
    const data = await response.json() as {
      scanId: string; executionEnabled: boolean; siteBackupIncluded: boolean; creditsCharged: number;
      reviews: Array<{ reviewId: string; finding: { id: string }; proposals: Array<{ version: number; rollbackPlan: string }> }>;
    };
    assert.equal(data.scanId, "review-scan-a");
    assert.deepEqual([data.executionEnabled, data.siteBackupIncluded, data.creditsCharged], [false, false, 0]);
    assert.equal(data.reviews.length, 1);
    assert.equal(data.reviews[0].finding.id, "review-finding-a");
    assert.equal(data.reviews[0].proposals.length, 1);
    assert.match(data.reviews[0].proposals[0].rollbackPlan, /Restore the verified original/);
    state.user = userB;
    const foreign = await exportReviewEvidence(query);
    assert.equal(foreign.status, 404);
    assert.match(foreign.headers.get("Cache-Control") || "", /no-store/);
    state.user = null;
    assert.equal((await exportReviewEvidence(query)).status, 401);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM credit_ledger").get()?.n, 0);
  } finally {
    delete state.env.RECOMVIA_ADMIN_USER_ID;
    db.close();
  }
});
