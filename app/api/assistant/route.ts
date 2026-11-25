import { searchKnowledge } from "@/lib/knowledge-base";

export const runtime = "edge";

const MAX_BODY_BYTES = 3_000;
const BODY_TIMEOUT_MS = 5_000;
const BODY_TIMED_OUT = Symbol("body timed out");
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function readBoundedBody(request: Request): Promise<string | null | typeof BODY_TIMED_OUT> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  let timedOut = false;
  // One absolute deadline for the entire upload, not a fresh timer per chunk.
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, BODY_TIMEOUT_MS);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) return BODY_TIMED_OUT;
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_BODY_BYTES) {
        // Do not wait for upstream cancellation before returning the rejection.
        void reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (timedOut) return BODY_TIMED_OUT;
    // Invalid UTF-8 or a read failure must not leave an unread body active.
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Invalid request origin." }, 403);
  }
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return json({ error: "JSON content type required." }, 415);
  }

  const declaredLength = request.headers.get("content-length");
  // Accept only canonical unsigned decimal lengths, as on the authenticated JSON APIs.
  // Ambiguous representations can be interpreted differently by intermediaries.
  if (declaredLength !== null && !/^(0|[1-9]\d*)$/.test(declaredLength)) {
    return json({ error: "Invalid request size." }, 400);
  }
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large." }, 413);
  }
  let payload: unknown;
  try {
    const raw = await readBoundedBody(request);
    if (raw === BODY_TIMED_OUT) return json({ error: "Request body timed out." }, 408);
    if (raw === null) return json({ error: "Request body is too large or missing." }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "Invalid request body." }, 400);
  }
  const question = typeof (payload as { question?: unknown }).question === "string"
    ? (payload as { question: string }).question.trim() : "";
  if (question.length < 2 || question.length > 600) {
    return json({ error: "Question must be between 2 and 600 characters." }, 400);
  }
  return json(searchKnowledge(question));
}
