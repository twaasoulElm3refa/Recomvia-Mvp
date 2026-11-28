// Only the internal scan's HTTP 201 means a new measurement was stored.
// Do not deserialize a full private report merely to acknowledge completion.
const failureCodes = new Set([
  "subscription_required", "project_limit", "needs_confirmation", "identity_unresolved",
  "plan_changed", "analysis_configuration", "engine_unavailable", "engine_failed",
  "invalid_input", "invalid_choice", "expired_choice", "free_scan_limit",
  "scan_limit", "scan_failed", "needs_clarification",
]);

export async function monitoringScanStatus(response: Response): Promise<string> {
  if (response.status === 201) {
    void response.body?.cancel().catch(() => {});
    return "completed";
  }
  // Only small outcome documents are needed. Never buffer a report from an
  // unexpected success status or an arbitrarily large error response.
  const maxBytes = 65_536;
  const length = response.headers.get("content-length");
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!response.body || (response.ok && response.status !== 202) ||
      mime !== "application/json" ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes))) {
    void response.body?.cancel().catch(() => {});
    return "monitor_failed";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Oversized monitoring outcome");
      text += decoder.decode(value, { stream: true });
    }
    const data: unknown = JSON.parse(text + decoder.decode());
    if (!data || typeof data !== "object" || Array.isArray(data)) return "monitor_failed";
    const { code, status } = data as { code?: unknown; status?: unknown };
    const reason = code ?? status;
    // Never allow arbitrary response strings to become persistent schedule status,
    // especially "completed" on a failed or incompatible scan response.
    return typeof reason === "string" && failureCodes.has(reason) ? reason : "monitor_failed";
  } catch {
    void reader.cancel().catch(() => {});
    return "monitor_failed";
  } finally {
    reader.releaseLock();
  }
}
