import { env } from "cloudflare:workers";
import { getAuthenticatedUser } from "@/app/auth";
import { replyToSupportTicket } from "@/db/support";

export const runtime = "edge";

const MAX_BODY_BYTES = 16_384;
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStore });

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
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
  if (reply.length < 5 || reply.length > 4000) {
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
