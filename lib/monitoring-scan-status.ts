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
  try {
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return "monitor_failed";
    const { code, status } = data as { code?: unknown; status?: unknown };
    const reason = code ?? status;
    // Never allow arbitrary response strings to become persistent schedule status,
    // especially "completed" on a failed or incompatible scan response.
    return typeof reason === "string" && failureCodes.has(reason) ? reason : "monitor_failed";
  } catch {
    return "monitor_failed";
  }
}
