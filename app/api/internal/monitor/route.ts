import { env } from "cloudflare:workers";
import { monitoringScanStatus } from "@/lib/monitoring-scan-status";
import { claimMonitoringJob, releaseMonitoringJob } from "@/db/analysis";
import { ensureWorkspace } from "@/db/product";
import { runScanForUser } from "@/app/api/scans/route";
import type { AnalysisTarget, TargetInput } from "@/lib/analysis-target";
export const runtime = "edge";

const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const respond = (data: unknown, status = 200) => Response.json(data, { status, headers: privateHeaders });

export async function POST(request: Request) {
  const secret = env.MONITORING_SECRET;
  if (!secret || secret.length < 32) return respond({ code: "not_configured" }, 503);
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  // The scheduled worker sends a single Bearer credential. Bound untrusted input
  // before hashing, while preserving any intentionally longer configured secret.
  if (!supplied.startsWith("Bearer ") || supplied.length > Math.max(1_024, expected.length)) {
    return respond({ code: "unauthorized" }, 401);
  }
  // Digest first: compare fixed-length values without logging either credential.
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(supplied), digest(expected)]);
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference) return respond({ code: "unauthorized" }, 401);
  const job = await claimMonitoringJob();
  if (!job) return respond({ processed: 0 });
  let status = "monitor_failed", pause = false;
  try {
    const user = { userId: job.userId, email: job.email, displayName: job.displayName, fullName: job.displayName };
    if ((await ensureWorkspace(user)).organizationId !== job.organizationId) { status = "workspace_changed"; pause = true; }
    else {
      const input = JSON.parse(job.inputJson) as TargetInput;
      const target = JSON.parse(job.targetJson) as AnalysisTarget;
      const result = await runScanForUser(user, { input: input.input, kind: input.kind, context: input.context, language: input.language }, { monitoring: true, confirmedTarget: target });
      status = await monitoringScanStatus(result);
      pause = ["subscription_required", "project_limit", "needs_confirmation", "identity_unresolved", "plan_changed"].includes(status);
    }
  } catch { status = "monitor_failed"; }
  finally { await releaseMonitoringJob(job, status, pause); }
  return respond({ processed: 1, status });
}
