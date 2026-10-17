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
  const result = await response.json() as { processed: number; status?: string };
  if (result.processed && result.status !== "completed")
    throw new Error(`Monitoring job did not complete: ${(result.status || "unknown").replace(/[^a-z_]/g, "").slice(0, 80)}`);
}

export default {
  async scheduled(_controller: ScheduledController, env: MonitorEnv) {
    await triggerMonitoring(env);
  },
};
