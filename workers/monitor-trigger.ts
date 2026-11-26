type MonitorEnv = { RECOMVIA_ORIGIN: string; MONITORING_SECRET: string };

// One leased project per tick. No public HTTP handler and no customer data in logs.
export async function triggerMonitoring(env: MonitorEnv, transport: typeof fetch = fetch) {
  const origin = new URL(env.RECOMVIA_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !env.MONITORING_SECRET || env.MONITORING_SECRET.length < 32)
    throw new Error("Monitoring configuration is incomplete");
  const response = await transport(new URL("/api/internal/monitor", origin), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MONITORING_SECRET}` },
    redirect: "error",
    signal: AbortSignal.timeout(600_000),
  });
  if (!response.ok) throw new Error(`Monitoring endpoint returned HTTP ${response.status}`);
  // The endpoint leases at most one job. A malformed success response must
  // not hide an incompatible deployment or mark a failed tick as healthy.
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Invalid monitoring response");
  const { processed, status } = result as { processed?: unknown; status?: unknown };
  if (processed === 0 && status === undefined) return;
  if (processed !== 1 || typeof status !== "string")
    throw new Error("Invalid monitoring response");
  if (status !== "completed")
    // Never copy arbitrary remote response content into scheduled worker logs.
    throw new Error("Monitoring job did not complete");
}

const scheduledWorker = {
  async scheduled(_controller: ScheduledController, env: MonitorEnv) {
    await triggerMonitoring(env);
  },
};

export default scheduledWorker;
