import { env } from "cloudflare:workers";
import { getAuthenticatedUser } from "@/app/auth";
import { ensureWorkspace } from "@/db/product";
import { createFixProposalVersion, FixProposalNotAllowed } from "@/db/fix-review";

export const runtime = "edge";
const headers = { "Cache-Control": "no-store" };
const json = (data: unknown, status: number) => Response.json(data, { status, headers });

function bounded(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= min && text.length <= max && !/[\u0000-\u0008\u000e-\u001f\u007f]/.test(text) ? text : null;
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return json({ code: "sign_in" }, 401);
  if (!env.RECOMVIA_ADMIN_USER_ID || user.userId !== env.RECOMVIA_ADMIN_USER_ID) {
    return json({ code: "not_found" }, 404);
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ code: "invalid_origin" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ code: "invalid_request" }, 415);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 7_000) return json({ code: "invalid_request" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ code: "invalid_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code: "invalid_request" }, 400);
  const input = body as Record<string, unknown>;
  const fixId = bounded(input.fixId, 3, 100);
  const scope = bounded(input.scope, 4, 200);
  const proposedText = bounded(input.proposedText, 10, 3_000);
  const rationale = bounded(input.rationale, 10, 1_200);
  const rollbackPlan = bounded(input.rollbackPlan, 10, 1_200);
  if (!fixId || !/^review_[a-zA-Z0-9_-]{1,92}$/.test(fixId) ||
      !scope || !proposedText || !rationale || !rollbackPlan) {
    return json({ code: "invalid_request" }, 400);
  }
  try {
    // Register a stable FK-backed staff identity before saving the author.
    await ensureWorkspace(user);
    const proposal = await createFixProposalVersion(user.userId, fixId, {
      scope, proposedText, rationale, rollbackPlan,
    });
    return json({ proposal, applied: false, approved: false, creditsCharged: 0 }, 201);
  } catch (error) {
    if (error instanceof FixProposalNotAllowed) return json({ code: "not_found" }, 404);
    return json({ code: "temporarily_unavailable" }, 503);
  }
}
