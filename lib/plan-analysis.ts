import { aggregateActualVisibility, runActualVisibility, type DiscoveredSiteContext, type IntentPrompt, type VisibilityEngineRun, type ActualVisibilityMeasurement } from "./ai-visibility";
import type { EngineAdapter, EngineResponse } from "./ai-engines/engine-adapter";
import type { AnalysisPolicy } from "./analysis-policy";
import { runLiveReadinessScan, type LiveReadinessResult, type ReadinessFinding, type CrawlUsage } from "./live-readiness";
import type { AnalysisTarget } from "./analysis-target";

export type PageEvidence = { url: string; score: number | null; findings: ReadinessFinding[]; error: string | null; pageText: string };
export async function auditPlanPages(root: LiveReadinessResult, policy: AnalysisPolicy, onCrawl?: (url: string, usage: CrawlUsage, failed: boolean) => Promise<void>): Promise<PageEvidence[]> {
  const pages: PageEvidence[] = [{ url: root.finalUrl, score: root.readinessScore, findings: root.findings, pageText: root.pageText, error: null }];
  const origin = new URL(root.finalUrl).origin;
  const links = root.internalLinks.slice().sort((a, b) => Number(/about|service|product|faq|pricing|عن|خدمات/i.test(b)) - Number(/about|service|product|faq|pricing|عن|خدمات/i.test(a)));
  for (const url of links.slice(0, policy.pageLimit - 1)) {
    const usage = { requestCount: 0, bytesFetched: 0 };
    let failed = false;
    try {
      const page = await runLiveReadinessScan(url, origin, usage);
      pages.push({ url: page.finalUrl, score: page.readinessScore, findings: page.findings, pageText: page.pageText, error: null });
    } catch { failed = true; pages.push({ url, score: null, findings: [], pageText: "", error: "page_unavailable" }); }
    finally { await onCrawl?.(url, usage, failed); }
  }
  return pages;
}

function stopped(adapter: EngineAdapter): EngineResponse {
  return { provider: adapter.provider, model: adapter.model, surfaceType: "api_without_search", responseText: null, sources: [], citations: [], usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null }, estimatedCostMicros: null, durationMs: 0, retryCount: 0, providerRunId: null, timestamp: new Date().toISOString(), error: { code: "budget_exhausted", message: "Analysis spending guard reached; this observation was not executed.", status: null, retryable: false } };
}

export async function runPlanVisibility(input: {
  adapters: EngineAdapter[]; context: DiscoveredSiteContext; target: AnalysisTarget;
  prompts: IntentPrompt[]; policy: AnalysisPolicy; initialCostMicros?: number;
  onRun?: (run: VisibilityEngineRun) => Promise<void>;
}): Promise<ActualVisibilityMeasurement> {
  if (!input.adapters.length) return { status: "not_configured", score: null, confidence: 0, engineRuns: [], prompts: input.prompts };
  const jobs = input.adapters.flatMap((adapter) => input.prompts.map((prompt) => ({ adapter, prompt })));
  const runs = new Array<VisibilityEngineRun>(jobs.length);
  let next = 0, spent = input.initialCostMicros || 0, reserved = 0;
  async function worker() {
    while (next < jobs.length) {
      const index = next++, { adapter, prompt } = jobs[index];
      const wrapped: EngineAdapter = { provider: adapter.provider, model: adapter.model, async run(request) {
        const allowance = input.policy.unknownCallReserveMicros;
        if (spent + reserved + allowance > input.policy.budgetMicros) return stopped(adapter);
        reserved += allowance;
        try {
          const result = await adapter.run({ ...request, maxOutputTokens: input.policy.maxOutputTokens, searchResults: input.policy.searchResults, searchUses: input.policy.searchUses });
          spent += result.estimatedCostMicros ?? allowance;
          return result;
        } catch (error) { spent += allowance; throw error; }
        finally { reserved -= allowance; }
      } };
      const measurement = await runActualVisibility({ adapter: wrapped, context: input.context, prompts: [prompt], aliases: input.target.aliases, useDomainAlias: input.target.kind === "website" });
      runs[index] = measurement.engineRuns[0];
      try { await input.onRun?.(runs[index]); }
      catch (error) { next = jobs.length; throw error; }
    }
  }
  // Bound total concurrent provider calls across all models, not per model.
  const workers = await Promise.allSettled(Array.from({ length: Math.min(3, jobs.length) }, () => worker()));
  const failed = workers.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  const aggregate = aggregateActualVisibility(runs, jobs.length);
  if (input.prompts.every((prompt) => prompt.intent === "topic")) {
    const successful = runs.filter((run) => !run.error && run.responseText && run.surfaceType === "api_with_search").length;
    aggregate.status = successful === jobs.length ? "measured" : successful ? "partial" : "failed";
    aggregate.score = null; aggregate.confidence = 0;
  }
  if (new Set(runs.filter((run) => !run.error).map((run) => run.model)).size < input.adapters.length && aggregate.status === "measured") aggregate.status = "partial";
  return { ...aggregate, engineRuns: runs, prompts: input.prompts };
}
