import { getAuthenticatedUser } from "@/app/auth";
import { FixReviewNotAllowed, requestFindingReview } from "@/db/fix-review";

export const runtime = "edge";

const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStore });

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    // An identity outage must not read the request body or create a review.
    return json({ code: "temporarily_unavailable" }, 503);
  }
  if (!user) return json({ code: "sign_in", error: "Sign in is required." }, 401);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ code: "invalid_origin", error: "Invalid request origin." }, 403);
  }
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ code: "invalid_request", error: "JSON is required." }, 415);
  }
  const maxBodyBytes = 500;
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
    // One deadline for the complete upload before requesting a human review.
    // Never delay rejection while waiting for the upstream stream to cancel.
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ code: "invalid_request" }, 400);
  }
  const { scanId, findingId } = body as { scanId?: unknown; findingId?: unknown };
  if (typeof scanId !== "string" || !/^[\w-]{1,100}$/.test(scanId) ||
      typeof findingId !== "string" || !/^[\w-]{1,100}$/.test(findingId)) {
    return json({ code: "invalid_request" }, 400);
  }

  try {
    const result = await requestFindingReview(user.userId, scanId, findingId);
    return json({
      ...result,
      executionEnabled: false,
      approved: false,
      creditsCharged: 0,
    }, result.alreadyRequested ? 200 : 201);
  } catch (error) {
    if (error instanceof FixReviewNotAllowed) return json({ code: "not_found" }, 404);
    return json({ code: "temporarily_unavailable" }, 503);
  }
}
