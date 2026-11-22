import { getAuthenticatedUser } from "@/app/auth";
import {
  FixProposalDecisionConflict,
  FixReviewNotAllowed,
  recordFixProposalDecision,
  type ProposalDecision,
} from "@/db/fix-review";

export const runtime = "edge";
const json = (data: unknown, status: number) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return json({ code: "sign_in" }, 401);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ code: "invalid_origin" }, 403);
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? ""))
    return json({ code: "invalid_request" }, 415);

  // Bound approval/comment submissions before parsing or any database writes.
  // 4 KiB accommodates permitted Unicode comments and identifiers.
  const maxBodyBytes = 4_096;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(declaredLength)) return json({ code: "invalid_request" }, 400);
    if (Number(declaredLength) > maxBodyBytes) return json({ code: "invalid_request" }, 413);
  }

  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ code: "invalid_request" }, 400);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let payload = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBodyBytes) {
          await reader.cancel().catch(() => undefined);
          return json({ code: "invalid_request" }, 413);
        }
        payload += decoder.decode(value, { stream: true });
      }
      payload += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    body = JSON.parse(payload);
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
      // Keep ordinary Arabic multiline comments, but reject hidden controls and bidi overrides.
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/.test(comment) ||
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
