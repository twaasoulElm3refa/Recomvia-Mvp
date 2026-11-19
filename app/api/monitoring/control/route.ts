import { getAuthenticatedUser } from "@/app/auth";
import { getEntitlementForUser } from "@/db/product";
import { MonitoringControlError, setMonitoringScheduleState } from "@/db/monitoring-controls";

export const runtime = "edge";
const respond = (data: unknown, status: number) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return respond({ code: "sign_in" }, 401);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return respond({ code: "invalid_origin" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return respond({ code: "invalid_request" }, 415);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 300) return respond({ code: "invalid_request" }, 413);
    body = JSON.parse(text);
  } catch {
    return respond({ code: "invalid_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ code: "invalid_request" }, 400);
  const { scheduleId, action } = body as { scheduleId?: unknown; action?: unknown };
  if (typeof scheduleId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(scheduleId) ||
      (action !== "pause" && action !== "resume")) {
    return respond({ code: "invalid_request" }, 400);
  }

  try {
    const entitlement = action === "resume" ? await getEntitlementForUser(user) : null;
    const result = await setMonitoringScheduleState(
      user.userId, scheduleId, action, entitlement?.canMonitor ?? false,
    );
    return respond({ ...result, scanStarted: false }, 200);
  } catch (error) {
    if (error instanceof MonitoringControlError) {
      return respond({ code: error.code }, error.code === "subscription_required" ? 403 : 404);
    }
    return respond({ code: "temporarily_unavailable" }, 503);
  }
}
