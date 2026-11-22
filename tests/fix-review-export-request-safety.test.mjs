import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the deployed route with stubbed owner-scoped database boundaries.
// Do not require live D1, customer accounts or paid integrations.
const compiled = ts.transpileModule(
  readFileSync("app/api/fix-reviews/export/route.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

let user = { userId: "owner-1" };
let entitled = true;
const reportReads = [];
const reviewReads = [];
const historyReads = [];
const ownedFinding = { id: "finding_1", title: "Missing description" };
const secondOwnedFinding = { id: "finding_2", title: "Missing heading" };
const additionalReviews = [];
const additionalProposals = [];
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "@/app/auth") return { getAuthenticatedUser: async () => user };
  if (name === "@/db/product") return {
    getReportForUser: async (userId, scanId) => {
      reportReads.push([userId, scanId]);
      if (scanId !== "scan_1") return null;
      return {
        entitlement: { canViewFullReport: entitled, canUseFixCredits: entitled },
        scan: {
          id: scanId, status: "completed", readinessScore: 80, siteId: "site_1",
          findings: [ownedFinding, secondOwnedFinding], target: { websiteUrl: "https://example.org" },
        },
      };
    },
  };
  if (name === "@/db/fix-review") return {
    listFixReviewRequests: async (...args) => {
      reviewReads.push(args);
      return [
        { id: "review_owned", findingId: "finding_1", status: "review_requested", createdAt: "2026-11-21" },
        { id: "review_other", findingId: "finding_other", status: "review_requested", createdAt: "2026-11-21" },
        ...additionalReviews,
      ];
    },
    listFixProposalHistoryForScan: async (...args) => {
      historyReads.push(args);
      return [
        {
          fixId: "review_owned", findingId: "finding_1", proposalId: "proposal_1",
          version: 1, proposedText: "Suggested text", decision: null,
        },
        {
          // Both findings belong to this scan, but this proposal claims a
          // different finding than the review it references: never export it.
          fixId: "review_owned", findingId: "finding_2", proposalId: "proposal_cross",
          version: 2, proposedText: "Unrelated owned finding evidence",
        },
        {
          fixId: "review_other", findingId: "finding_other", proposalId: "proposal_other",
          version: 1, proposedText: "Other finding",
        },
        ...additionalProposals,
      ];
    },
  };
  throw new Error("Unexpected import: " + name);
}, loaded, loaded.exports);

const { GET } = loaded.exports;
const request = (query = "") => new Request("https://recomvia.test/api/fix-reviews/export" + query);
function privateResponse(response) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
}

test("private evidence export requires authentication before customer data reads", async () => {
  user = null;
  const response = await GET(request("?scan=scan_1"));
  user = { userId: "owner-1" };
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: "sign_in" });
  privateResponse(response);
  assert.equal(reportReads.length, 0);
  assert.equal(reviewReads.length, 0);
  assert.equal(historyReads.length, 0);
});

test("private evidence export rejects repeated and malformed selectors before database work", async () => {
  const invalid = [
    "", "?scan", "?scan=", "?scan=scan_1&scan=scan_1",
    "?scan=scan_1&scan=scan_2", "?scan=scan_1&scan=",
    "?scan=../other", "?scan=%00", "?scan=%20scan_1",
    "?scan=scan%2F1", "?scan=" + "a".repeat(101),
  ];
  for (const query of invalid) {
    const response = await GET(request(query));
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { code: "invalid_scan" });
    privateResponse(response);
  }
  assert.deepEqual(reportReads, [], "invalid selectors must not read private reports");
  assert.deepEqual(reviewReads, [], "invalid selectors must not read reviews");
  assert.deepEqual(historyReads, [], "invalid selectors must not read proposal history");
});

test("private evidence export does not expose missing or plan-ineligible scans", async () => {
  const missing = await GET(request("?scan=scan_missing"));
  assert.equal(missing.status, 404);
  privateResponse(missing);
  entitled = false;
  const notEntitled = await GET(request("?scan=scan_1"));
  entitled = true;
  assert.equal(notEntitled.status, 404);
  privateResponse(notEntitled);
  assert.deepEqual(reviewReads, []);
  assert.deepEqual(historyReads, []);
  assert.deepEqual(reportReads, [
    ["owner-1", "scan_missing"],
    ["owner-1", "scan_1"],
  ]);
});

test("one valid owned scan exports only its matching review evidence, without permitting execution", async () => {
  const response = await GET(request("?scan=scan_1"));
  assert.equal(response.status, 200);
  privateResponse(response);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Content-Disposition"),
    'attachment; filename="recomvia-fix-review-scan_1.json"');
  const payload = await response.json();
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.scanId, "scan_1");
  assert.equal(payload.website, "https://example.org");
  assert.equal(payload.executionEnabled, false);
  assert.equal(payload.siteBackupIncluded, false);
  assert.equal(payload.creditsCharged, 0);
  assert.equal(payload.reviews.length, 1);
  assert.equal(payload.reviews[0].reviewId, "review_owned");
  assert.equal(payload.reviews[0].finding.id, "finding_1");
  assert.deepEqual(payload.reviews[0].proposals.map((item) => item.proposalId), ["proposal_1"]);
  assert.deepEqual(reviewReads, [["owner-1", "scan_1"]]);
  assert.deepEqual(historyReads, [["owner-1", "scan_1"]]);
});

test("evidence export excludes mismatched proposals even when both findings are owned", async () => {
  const response = await GET(request("?scan=scan_1"));
  assert.equal(response.status, 200);
  privateResponse(response);
  const payload = await response.json();
  const review = payload.reviews.find((item) => item.reviewId === "review_owned");
  assert.ok(review);
  assert.deepEqual(review.proposals.map((item) => item.proposalId), ["proposal_1"]);
  assert.ok(!JSON.stringify(payload).includes("Unrelated owned finding evidence"));
  assert.ok(!JSON.stringify(payload).includes("proposal_cross"));
});

test("evidence export groups many owned reviews without repeated full-history scans", async () => {
  // One access to each proposal's review key per export is sufficient; the
  // previous per-review filter read every proposal key for every review.
  let reviewKeyReads = 0;
  for (let index = 0; index < 40; index++) {
    const reviewId = `review_large_${index}`;
    additionalReviews.push({
      id: reviewId, findingId: "finding_1", status: "review_requested", createdAt: "2026-11-21",
    });
    const proposal = {
      findingId: "finding_1", proposalId: `proposal_large_${index}`,
      version: 1, proposedText: `Evidence ${index}`,
    };
    Object.defineProperty(proposal, "fixId", {
      enumerable: true,
      get() { reviewKeyReads++; return reviewId; },
    });
    additionalProposals.push(proposal);
  }
  try {
    const response = await GET(request("?scan=scan_1"));
    assert.equal(response.status, 200);
    privateResponse(response);
    const payload = await response.json();
    assert.equal(payload.reviews.length, 41);
    for (let index = 0; index < 40; index++) {
      const review = payload.reviews.find((entry) => entry.reviewId === `review_large_${index}`);
      assert.ok(review, `missing review ${index}`);
      assert.deepEqual(review.proposals.map((entry) => entry.proposalId), [`proposal_large_${index}`]);
    }
    assert.equal(reviewKeyReads, 40, "each proposal key must be read once, not once per review");
  } finally {
    additionalReviews.length = 0;
    additionalProposals.length = 0;
  }
});
