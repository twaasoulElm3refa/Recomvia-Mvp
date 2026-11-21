import { findTicketForRequester } from "@/db/support";

export const runtime = "edge";

const MAX_BODY_BYTES = 512;
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStore });

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_BODY_BYTES) {
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

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ error: "Invalid request origin." }, 403);
  }
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return json({ error: "JSON content type required." }, 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && !/^(0|[1-9]\d*)$/.test(declaredLength)) {
    return json({ error: "Invalid request body." }, 400);
  }
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return json({ error: "Request too large." }, 413);
  }

  let payload: { reference?: unknown; accessKey?: unknown };
  try {
    const body = await readBoundedBody(request);
    if (body === null) return json({ error: "Request too large." }, 413);
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return json({ error: "Invalid request body." }, 400);
    }
    payload = value;
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const reference = typeof payload.reference === "string" ? payload.reference.trim().toUpperCase() : "";
  const accessKey = typeof payload.accessKey === "string" ? payload.accessKey.trim() : "";
  if (!/^RCV-[A-Z0-9]+-[A-F0-9]{6}$/.test(reference) || !/^[a-f0-9]{36}$/.test(accessKey)) {
    return json({ error: "Ticket not found." }, 404);
  }

  try {
    const ticket = await findTicketForRequester(reference, await hash(accessKey));
    if (!ticket) return json({ error: "Ticket not found." }, 404);
    return json(ticket, 200);
  } catch {
    return json({ error: "Support status is temporarily unavailable." }, 503);
  }
}
