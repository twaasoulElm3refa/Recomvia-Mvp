import { getAuthenticatedUser } from "@/app/auth";
import { createSupportTicket, SupportRateLimitError } from "@/db/support";

export const runtime = "edge";

const MAX_BODY_BYTES = 16_384;
const BODY_TIMEOUT_MS = 5_000;
const BODY_TIMED_OUT = Symbol("body timed out");
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStore });

function rejectUpload(request: Request, error: string, status: number): Response {
  // Reject unread uploads without waiting for upstream stream cleanup.
  void request.body?.cancel().catch(() => undefined);
  return json({ error }, status);
}

async function readBoundedBody(request: Request): Promise<string | null | typeof BODY_TIMED_OUT> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let result = "";
  let timedOut = false;
  // Bound the entire upload, including incomplete or slowly arriving chunks.
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
        void reader.cancel().catch(() => undefined);
        return null;
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } catch (error) {
    if (timedOut) return BODY_TIMED_OUT;
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
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
  // A syntactically plausible address must be deliverable as a single mailbox,
  // not a comma-separated header value or a malformed DNS name.
  if (value.length > 254 || /[\s,;<>()[\]:"\\]/u.test(value)) return false;
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, at);
  const labels = value.slice(at + 1).split(".");
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") ||
      local.includes("..") || labels.length < 2) return false;
  return labels.every((label) =>
    label.length <= 63 &&
    /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label),
  );
}

// Ticket text is untrusted and displayed to support staff. Reject invisible
// controls and bidi-formatting characters (including invisible Arabic/LTR/RTL marks)
// that can disguise text in the inbox.
// Preserve normal line breaks in multi-line questions.
const unsafeSingleLine = /[\u0000-\u001f\u007f\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/;
const unsafeQuestion = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/;

function safePageUrl(value: string, origin: string) {
  // Source links open from the staff inbox. Never persist off-site or
  // browser-normalized cross-origin paths as clickable support links.
  if (!value || value.length > 500 || /[\\\u0000-\u001f\u007f]/.test(value)) return "";
  if (!value.startsWith("/") && !/^https?:\/\//i.test(value)) return "";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return "";
    // A same-origin absolute URL can normalize to a network-path reference.
    // Reject it before stripping the origin so the stored href remains local.
    if (url.pathname.startsWith("//")) return "";
    // Query strings may carry private report parameters or authentication tokens.
    // Only the source pathname is needed by support staff.
    return url.pathname;
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
  // Browser-only support submissions must declare this origin before a ticket is created.
  // Missing or opaque origins are not proof of a first-party request.
  if (!origin || origin !== new URL(request.url).origin) {
    return rejectUpload(request, "Invalid request origin.", 403);
  }
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return rejectUpload(request, "JSON content type required.", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && !/^(0|[1-9]\d*)$/.test(declaredLength)) {
    return rejectUpload(request, "Invalid request size.", 400);
  }
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return rejectUpload(request, "Request body is too large.", 413);
  }

  let payload: TicketRequest;
  try {
    const body = await readBoundedBody(request);
    if (body === BODY_TIMED_OUT) return json({ error: "Request body timed out." }, 408);
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
  const pageUrl = safePageUrl(clean(payload.pageUrl), new URL(request.url).origin);

  if (name.length < 2 || name.length > 80 || unsafeSingleLine.test(name)) {
    return json({ error: "Please enter a valid name." }, 400);
  }
  if (!validEmail(email) || unsafeSingleLine.test(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }
  if (question.length < 10 || question.length > 2000 || unsafeQuestion.test(question)) {
    return json({ error: "Question must be between 10 and 2,000 characters." }, 400);
  }

  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    // An identity outage is not an anonymous submission. Avoid creating an
    // unowned ticket or exposing internal authentication diagnostics.
    return json({ error: "Support is temporarily unavailable. Please try again shortly." }, 503);
  }

  const accessKey = randomToken();
  const publicId = `RCV-${Date.now().toString(36).toUpperCase()}-${randomToken(3).toUpperCase()}`;

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
