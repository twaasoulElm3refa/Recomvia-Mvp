import { env } from "cloudflare:workers";
import { getAuthenticatedUser, type AuthUser } from "@/app/auth";
import { replyToSupportTicket } from "@/db/support";

export const runtime = "edge";

const MAX_BODY_BYTES = 16_384;
const BODY_TIMEOUT = Symbol("body_timeout");
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStore });

async function readBoundedBody(request: Request): Promise<string | null | typeof BODY_TIMEOUT> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let result = "";
  let timedOut = false;
  // One deadline for the entire upload, not renewed by individual chunks.
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 5_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) return BODY_TIMEOUT;
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } catch (error) {
    if (timedOut) return BODY_TIMEOUT;
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let user: AuthUser | null;
  try {
    user = await getAuthenticatedUser();
  } catch {
    // Never read or publish a reply when staff identity cannot be verified.
    return json({ error: "Support is temporarily unavailable." }, 503);
  }
  if (!user || !env.RECOMVIA_ADMIN_USER_ID || user.userId !== env.RECOMVIA_ADMIN_USER_ID) {
    return json({ error: "Not found." }, 404);
  }

  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ error: "Invalid request origin." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "JSON content type required." }, 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(declaredLength)) {
      return json({ error: "Invalid request size." }, 400);
    }
    if (Number(declaredLength) > MAX_BODY_BYTES) {
      return json({ error: "Request body is too large." }, 413);
    }
  }

  const { id: rawId } = await context.params;
  if (!/^[1-9][0-9]*$/.test(rawId) || rawId.length > 15) {
    return json({ error: "Invalid ticket." }, 400);
  }
  const id = Number(rawId);
  if (!Number.isSafeInteger(id)) {
    return json({ error: "Invalid ticket." }, 400);
  }

  let reply = "";
  try {
    const text = await readBoundedBody(request);
    if (text === BODY_TIMEOUT) return json({ error: "Request body timed out." }, 408);
    if (text === null) return json({ error: "Request body is too large." }, 413);
    const payload: unknown = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ error: "Invalid request body." }, 400);
    }
    const value = (payload as Record<string, unknown>).reply;
    reply = typeof value === "string" ? value.trim() : "";
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  // Reject invisible control codes, direction marks and bidi overrides in replies shown to customers.
  // Keep normal tabs and line breaks for readable Arabic and English responses.
  const unsafeReply = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/;
  if (reply.length < 5 || reply.length > 4000 || unsafeReply.test(reply)) {
    return json({ error: "Reply must be between 5 and 4,000 characters." }, 400);
  }

  try {
    const updated = await replyToSupportTicket(id, reply, user.userId);
    if (!updated) return json({ error: "Ticket not found." }, 404);
    return json({ ok: true, status: "answered" }, 200);
  } catch {
    return json({ error: "Reply could not be saved." }, 503);
  }
}
