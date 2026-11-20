import { getAuthenticatedUser } from "@/app/auth";
import { createSupportTicket, SupportRateLimitError } from "@/db/support";

export const runtime = "edge";

const MAX_BODY_BYTES = 16_384;
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStore });

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
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

type TicketRequest = {
  name?: unknown;
  email?: unknown;
  question?: unknown;
  pageUrl?: unknown;
  companyWebsite?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safePageUrl(value: string) {
  if (!value || value.length > 500) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.pathname + url.search;
  } catch {
    return "";
  }
}

function randomToken(bytes = 18) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large." }, 413);
  }

  let payload: TicketRequest;
  try {
    const body = await readBoundedBody(request);
    if (body === null) return json({ error: "Request body is too large." }, 413);
    const value: unknown = JSON.parse(body);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return json({ error: "Invalid request body." }, 400);
    }
    payload = value as TicketRequest;
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  if (clean(payload.companyWebsite)) {
    return json({ error: "Request rejected." }, 400);
  }

  const name = clean(payload.name);
  const email = clean(payload.email).toLowerCase();
  const question = clean(payload.question);
  const pageUrl = safePageUrl(clean(payload.pageUrl));

  if (name.length < 2 || name.length > 80) {
    return json({ error: "Please enter a valid name." }, 400);
  }
  if (!validEmail(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }
  if (question.length < 10 || question.length > 2000) {
    return json({ error: "Question must be between 10 and 2,000 characters." }, 400);
  }

  const accessKey = randomToken();
  const publicId = `RCV-${Date.now().toString(36).toUpperCase()}-${randomToken(3).toUpperCase()}`;
  const user = await getAuthenticatedUser();

  try {
    await createSupportTicket({
      publicId,
      accessKeyHash: await hash(accessKey),
      requesterName: name,
      requesterEmail: email,
      authenticatedUserId: user?.userId ?? null,
      question,
      pageUrl,
    });
  } catch (error) {
    if (error instanceof SupportRateLimitError) {
      return Response.json(
        { error: "Too many requests. Please try again later.", code: "rate_limited" },
        { status: 429, headers: { ...noStore, "Retry-After": "3600" } },
      );
    }
    return json({ error: "Support is temporarily unavailable. Please try again shortly." }, 503);
  }

  return Response.json(
    {
      reference: publicId,
      accessKey,
      status: "open",
      message: "Your question is in the human support queue.",
    },
    { status: 201, headers: noStore },
  );
}
