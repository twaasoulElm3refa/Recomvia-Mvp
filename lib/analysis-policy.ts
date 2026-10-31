import type { PlanId } from "./plans";
import type { TargetInput } from "./analysis-target";

export const ANALYSIS_POLICY_VERSION = "plan-analysis-v2";
export type AnalysisPolicy = {
  version: string; plan: "free" | "essential" | "growth" | "pro";
  promptLimit: number; modelCount: number; pageLimit: number; competitorLimit: number;
  measurementsPer30Days: number; monitoringDays: number | null;
  budgetMicros: number; unknownCallReserveMicros: number; maxOutputTokens: number;
  searchResults: number; searchUses: number;
};
// Conservative operating defaults for validation. These are not published sales quotas.
export function analysisPolicy(plan: PlanId | null): AnalysisPolicy {
  // Keep visibility observations brief; identity discovery has its own cap.
  const common = { version: ANALYSIS_POLICY_VERSION, unknownCallReserveMicros: 40_000, maxOutputTokens: 280, searchResults: 1, searchUses: 1 };
  if (plan === "essential") return { ...common, plan, promptLimit: 6, modelCount: 2, pageLimit: 3, competitorLimit: 3, measurementsPer30Days: 4, monitoringDays: 8, budgetMicros: 1_000_000 };
  if (plan === "growth" || plan === "pro") return { ...common, plan, promptLimit: 12, modelCount: 3, pageLimit: 8, competitorLimit: 8, measurementsPer30Days: 8, monitoringDays: 4, budgetMicros: 3_000_000 };
  return { ...common, plan: "free", promptLimit: 3, modelCount: 1, pageLimit: 1, competitorLimit: 1, measurementsPer30Days: 1, monitoringDays: null, budgetMicros: 200_000, maxOutputTokens: 180 };
}

export function configuredModels(policy: AnalysisPolicy, env: { OPENROUTER_MODEL?: string; OPENROUTER_MODELS_JSON?: string; OPENROUTER_API_KEY?: string }): string[] {
  if (!env.OPENROUTER_API_KEY?.trim()) return [];
  let extra: unknown = [];
  if (env.OPENROUTER_MODELS_JSON?.trim()) {
    try { extra = JSON.parse(env.OPENROUTER_MODELS_JSON); } catch { throw new Error("analysis_configuration"); }
    if (!Array.isArray(extra) || extra.length > 8 || extra.some((value) => typeof value !== "string" || !/^[\w.-]+\/[\w.:-]+$/.test(value))) throw new Error("analysis_configuration");
  }
  const models = [...new Set([env.OPENROUTER_MODEL?.trim(), ...(extra as string[])].filter((value): value is string => Boolean(value)))];
  if (models.length < policy.modelCount || models.some((value) => !/^[\w.-]+\/[\w.:-]+$/.test(value))) throw new Error("analysis_configuration");
  return models.slice(0, policy.modelCount);
}

export function analysisProjectKey(input: TargetInput) {
  return input.websiteUrl ? `website:${new URL(input.websiteUrl).hostname.toLowerCase()}`
    : `${input.kind === "topic" ? "topic" : "entity"}:${input.input.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase()}`;
}

export function policyFingerprint(policy: AnalysisPolicy, models: string[]) {
  // Pro has the same per-project measurements as Growth. Price/project count do not alter the sample.
  const { plan: _plan, ...scope } = policy;
  void _plan;
  return JSON.stringify({ ...scope, models, searchMode: "web_plugin_once", reasoning: "disabled" });
}
