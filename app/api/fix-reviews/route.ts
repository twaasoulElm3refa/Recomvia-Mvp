import { getAuthenticatedUser } from "@/app/auth";
import { FixReviewNotAllowed, requestFindingReview } from "@/db/fix-review";

export const runtime = "edge";

const noStore = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStore });

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return json({ code: "sign_in", error: "Sign in is required." }, 401);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ code: "invalid_origin", error: "Invalid request origin." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ code: "invalid_request", error: "JSON is required." }, 415);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 500) return json({ code: "invalid_request" }, 413);
    body = JSON.parse(text);
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
