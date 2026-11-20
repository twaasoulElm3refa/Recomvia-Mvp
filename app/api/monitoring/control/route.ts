import { getAuthenticatedUser } from "@/app/auth";
import { getEntitlementForUser } from "@/db/product";
import { MonitoringControlError, setMonitoringScheduleState } from "@/db/monitoring-controls";

export const runtime = "edge";
const respond = (data: unknown, status: number) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return respond({ code: "sign_in" }, 401);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return respond({ code: "invalid_origin" }, 403);
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? "")) {
    return respond({ code: "invalid_request" }, 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(0|[1-9]\\d*)$/.test(declaredLength)) return respond({ code: "invalid_request" }, 400);
    if (Number(declaredLength) > 300) return respond({ code: "invalid_request" }, 413);
  }
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return respond({ code: "invalid_request" }, 400);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 300) {
          await reader.cancel();
          return respond({ code: "invalid_request" }, 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
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
