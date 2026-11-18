import { getAuthenticatedUser } from "@/app/auth";
import {
  FixProposalDecisionConflict,
  FixReviewNotAllowed,
  recordFixProposalDecision,
  type ProposalDecision,
} from "@/db/fix-review";

export const runtime = "edge";
const json = (data: unknown, status: number) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return json({ code: "sign_in" }, 401);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ code: "invalid_origin" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return json({ code: "invalid_request" }, 415);

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 1_500) return json({ code: "invalid_request" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ code: "invalid_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code: "invalid_request" }, 400);
  const data = body as Record<string, unknown>;
  const scanId = data.scanId;
  const proposalId = data.proposalId;
  const decision = data.decision;
  const comment = data.comment ?? "";
  if (typeof scanId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(scanId) ||
      typeof proposalId !== "string" || !/^proposal_[a-zA-Z0-9_-]{1,92}$/.test(proposalId) ||
      (decision !== "accepted_for_planning" && decision !== "changes_requested") ||
      typeof comment !== "string" || comment.length > 800 ||
      /[\u0000-\u0008\u000e-\u001f\u007f]/.test(comment) ||
      (decision === "changes_requested" && comment.trim().length < 10)) {
    return json({ code: "invalid_request" }, 400);
  }

  try {
    const result = await recordFixProposalDecision(
      user.userId, scanId, proposalId,
      decision as ProposalDecision, comment.trim(),
    );
    return json({
      ...result,
      applied: false,
      approvedForExecution: false,
      creditsCharged: 0,
    }, result.alreadyRecorded ? 200 : 201);
  } catch (error) {
    if (error instanceof FixReviewNotAllowed) return json({ code: "not_found" }, 404);
    if (error instanceof FixProposalDecisionConflict) return json({ code: "proposal_changed" }, 409);
    return json({ code: "temporarily_unavailable" }, 503);
  }
}
