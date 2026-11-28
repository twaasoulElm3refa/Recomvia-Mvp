import { env } from "cloudflare:workers";
import { getAuthenticatedUser } from "@/app/auth";
import { ensureWorkspace } from "@/db/product";
import { createFixProposalVersion, FixProposalNotAllowed } from "@/db/fix-review";

export const runtime = "edge";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (data: unknown, status: number) => Response.json(data, { status, headers });

function bounded(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // Permit ordinary Arabic multiline drafting, but reject invisible controls and
  // bidi overrides that can disguise the approved scope, rationale or rollback plan.
  return text.length >= min && text.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/.test(text) ? text : null;
}

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    // Identity outages must not read drafts or register staff workspace records.
    return json({ code: "temporarily_unavailable" }, 503);
  }
  if (!user) return json({ code: "sign_in" }, 401);
  if (!env.RECOMVIA_ADMIN_USER_ID || user.userId !== env.RECOMVIA_ADMIN_USER_ID) {
    return json({ code: "not_found" }, 404);
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ code: "invalid_origin" }, 403);
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ code: "invalid_request" }, 415);
  }
  // A full-length Unicode draft can exceed 7,000 UTF-8 bytes while each
  // individual field still satisfies the form's character limits.
  const maxBodyBytes = 24 * 1_024;
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
    let timedOut = false;
    // Bound the complete draft upload before performing any workspace or proposal writes.
    const timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
    }, 5_000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (timedOut) return json({ code: "invalid_request" }, 408);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBodyBytes) {
          void reader.cancel().catch(() => undefined);
          return json({ code: "invalid_request" }, 413);
        }
        payload += decoder.decode(value, { stream: true });
      }
      payload += decoder.decode();
    } catch (error) {
      if (timedOut) return json({ code: "invalid_request" }, 408);
      void reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
    body = JSON.parse(payload);
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
