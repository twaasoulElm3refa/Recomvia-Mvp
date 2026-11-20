import { searchKnowledge } from "@/lib/knowledge-base";

export const runtime = "edge";

const MAX_BODY_BYTES = 3_000;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
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
  if (declaredLength !== null && !/^\d+$/.test(declaredLength)) {
    return json({ error: "Invalid request size." }, 400);
  }
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large." }, 413);
  }
  let payload: unknown;
  try {
    const raw = await readBoundedBody(request);
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
