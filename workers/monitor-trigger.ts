type MonitorEnv = { RECOMVIA_ORIGIN: string; MONITORING_SECRET: string };

// A monitoring tick returns only a count and a short status. Bound the actual
// decoded body, even if the upstream omits or misstates Content-Length.
const MAX_RESPONSE_BYTES = 4096;
async function readMonitorResponse(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!response.body || mime !== "application/json" ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES))) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Invalid monitoring response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Oversized response");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    // JSON parsing and stream errors can contain arbitrary upstream data.
    void reader.cancel().catch(() => {});
    throw new Error("Invalid monitoring response");
  } finally {
    reader.releaseLock();
  }
}

// One leased project per tick. No public HTTP handler and no customer data in logs.
export async function triggerMonitoring(env: MonitorEnv, transport: typeof fetch = fetch) {
  let origin: URL;
  try {
    origin = new URL(env.RECOMVIA_ORIGIN);
  } catch {
    // URL parser errors can contain the supplied configuration.
    throw new Error("Monitoring configuration is incomplete");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !env.MONITORING_SECRET || env.MONITORING_SECRET.length < 32)
    throw new Error("Monitoring configuration is incomplete");
  let response: Response;
  try {
    response = await transport(new URL("/api/internal/monitor", origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.MONITORING_SECRET}` },
      redirect: "error",
      signal: AbortSignal.timeout(600_000),
    });
  } catch {
    // Transport errors can include private URLs or credentials. Do not log
    // upstream messages or retry a request that may already have leased a job.
    throw new Error("Monitoring endpoint request failed");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`Monitoring endpoint returned HTTP ${response.status}`);
  }
  // The endpoint leases at most one job. A malformed success response must
  // not hide an incompatible deployment or mark a failed tick as healthy.
  const result = await readMonitorResponse(response);
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
