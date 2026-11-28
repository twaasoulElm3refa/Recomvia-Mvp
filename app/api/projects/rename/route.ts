import { getAuthenticatedUser, type AuthUser } from "@/app/auth";
import { ProjectSlotError, renameProjectSlot } from "@/db/project-slots";

export const runtime = "edge";
const respond = (data: unknown, status: number) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

function rejectUpload(request: Request, code: string, status: number): Response {
  // Reject before parsing without waiting for upstream transport cleanup.
  void request.body?.cancel().catch(() => undefined);
  return respond({ code }, status);
}

export async function POST(request: Request) {
  let user: AuthUser | null;
  try {
    user = await getAuthenticatedUser();
  } catch {
    // Fail closed without exposing private identity diagnostics or reading the upload.
    return respond({ code: "temporarily_unavailable" }, 503);
  }
  if (!user) return respond({ code: "sign_in" }, 401);

  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return rejectUpload(request, "invalid_origin", 403);
  }
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? "")) {
    return rejectUpload(request, "invalid_request", 415);
  }
  // Bounded UTF-8 intake avoids buffering arbitrary request bodies and permits valid Unicode names.
  const maxBodyBytes = 2_048;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(declaredLength)) return rejectUpload(request, "invalid_request", 400);
    if (Number(declaredLength) > maxBodyBytes) return rejectUpload(request, "invalid_request", 413);
  }

  let input: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return respond({ code: "invalid_request" }, 400);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bodyBytes = 0;
    let payload = "";
    let timedOut = false;
    // Apply a single deadline to the entire upload before any project mutation.
    const timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
    }, 5_000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (timedOut) return respond({ code: "invalid_request" }, 408);
        if (done) break;
        bodyBytes += value.byteLength;
        if (bodyBytes > maxBodyBytes) {
          void reader.cancel().catch(() => undefined);
          return respond({ code: "invalid_request" }, 413);
        }
        payload += decoder.decode(value, { stream: true });
      }
      payload += decoder.decode();
    } catch (error) {
      if (timedOut) return respond({ code: "invalid_request" }, 408);
      void reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
    input = JSON.parse(payload);
  } catch {
    return respond({ code: "invalid_request" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return respond({ code: "invalid_request" }, 400);
  }
  const data = input as Record<string, unknown>;
  const projectId = data.projectId;
  const expectedName = data.expectedName;
  const name = typeof data.displayName === "string" ? data.displayName.trim().normalize("NFC") : null;
  // Reject direction controls that can disguise a label in the project dashboard/audit log.
  // Keep ordinary RTL Arabic letters and valid Unicode display labels intact.
  if (typeof projectId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(projectId) ||
      typeof expectedName !== "string" || expectedName.length > 160 ||
      !name || name.length < 2 || name.length > 80 ||
      /[\u0000-\u001f\u007f\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/.test(name)) {
    return respond({ code: "invalid_request" }, 400);
  }

  try {
    const updated = await renameProjectSlot(user, projectId, expectedName, name);
    return respond({ ...updated, projectKeyUnchanged: true, quotasReset: false }, 200);
  } catch (error) {
    if (error instanceof ProjectSlotError) {
      return respond({ code: error.code }, error.code === "forbidden" ? 403 : error.code === "conflict" ? 409 : 404);
    }
    return respond({ code: "temporarily_unavailable" }, 503);
  }
}
