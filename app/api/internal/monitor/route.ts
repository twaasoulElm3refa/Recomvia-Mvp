import { env } from "cloudflare:workers";
import { claimMonitoringJob, releaseMonitoringJob } from "@/db/analysis";
import { ensureWorkspace } from "@/db/product";
import { runScanForUser } from "@/app/api/scans/route";
import type { AnalysisTarget, TargetInput } from "@/lib/analysis-target";
export const runtime = "edge";

export async function POST(request: Request) {
  const secret = env.MONITORING_SECRET;
  if (!secret || secret.length < 32) return Response.json({ code: "not_configured" }, { status: 503 });
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  // Digest first: compare fixed-length values without logging either credential.
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(supplied), digest(expected)]);
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference) return Response.json({ code: "unauthorized" }, { status: 401 });
  const job = await claimMonitoringJob();
  if (!job) return Response.json({ processed: 0 }, { headers: { "Cache-Control": "no-store" } });
  let status = "monitor_failed", pause = false;
  try {
    const user = { userId: job.userId, email: job.email, displayName: job.displayName, fullName: job.displayName };
    if ((await ensureWorkspace(user)).organizationId !== job.organizationId) { status = "workspace_changed"; pause = true; }
    else {
      const input = JSON.parse(job.inputJson) as TargetInput;
      const target = JSON.parse(job.targetJson) as AnalysisTarget;
      const result = await runScanForUser(user, { input: input.input, kind: input.kind, context: input.context, language: input.language }, { monitoring: true, confirmedTarget: target });
      const body = await result.json() as { code?: string; status?: string };
      status = result.status === 201 ? "completed" : body.code || body.status || "monitor_failed";
      pause = ["subscription_required", "project_limit", "needs_confirmation", "identity_unresolved", "plan_changed"].includes(status);
    }
  } catch { status = "monitor_failed"; }
  finally { await releaseMonitoringJob(job, status, pause); }
  return Response.json({ processed: 1, status }, { headers: { "Cache-Control": "no-store" } });
}
