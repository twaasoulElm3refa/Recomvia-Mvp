import { analysisPolicy, configuredModels, policyFingerprint } from "@/lib/analysis-policy";
import { auditPlanPages, runPlanVisibility } from "@/lib/plan-analysis";
import { buildAnalysisInsights } from "@/lib/analysis-insights";
import { recordEngineCost, recordPageCrawl, saveInsights, scanCostGuard, scanPolicyForOwner, scheduleMonitoring } from "@/db/analysis";
import { env } from "cloudflare:workers";
import { getAuthenticatedUser, type AuthUser } from "@/app/auth";
import {
  attachAnalysisTarget,
  claimIdentityChoice,
  completeScan,
  createRunningScan,
  ensureWorkspace,
  failScan,
  findCachedScan,
  getOrCreateSite,
  getEntitlementForUser,
  getReportForUser,
  getScanForUser,
  storeDiscovery,
  type ScanCompletion,
} from "@/db/product";
import {
  businessContextForVisibility,
  type ActualVisibilityMeasurement,
} from "@/lib/ai-visibility";
import { OpenRouterEngineAdapter } from "@/lib/ai-engines/openrouter-engine-adapter";
import { runLiveReadinessScan, type LiveReadinessResult } from "@/lib/live-readiness";
import {
  contextForTarget,
  discoveryPrompt,
  generateTargetPrompts,
  parseTargetDiscovery,
  parseTargetInput,
  targetCacheKey,
  targetFromCandidate,
  TARGET_METHODOLOGY_VERSION,
  type AnalysisTarget,
  type IdentityCandidate,
  type TargetInput,
} from "@/lib/analysis-target";

export const runtime = "edge";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return json({ code: "sign_in" }, 401);
  const id = new URL(request.url).searchParams.get("scan");
  if (!id || id.length > 100) return json({ code: "invalid_input" }, 400);
  const report = await getReportForUser(user.userId, id);
  if (!report) return json({ code: "not_found" }, 404);
  return json({ scan: report.scan, entitlement: report.entitlement });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user)
    return json(
      { code: "sign_in", error: "Sign in before starting an analysis." },
      401,
    );
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  let payload: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > 4_000)
      return json(
        { code: "invalid_input", error: "Request is too large." },
        413,
      );
    payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error();
  } catch {
    return json({ code: "invalid_input", error: "Invalid request body." }, 400);
  }

  return runScanForUser(user, payload);
}

// The caller supplies authenticated identity. Options are internal-only, never copied from payload.
export async function runScanForUser(user: AuthUser, payload: Record<string, unknown>, options: { monitoring?: boolean; confirmedTarget?: AnalysisTarget } = {}) {
  const workspace = await ensureWorkspace(user);
  const entitlement = await getEntitlementForUser(user);
  if (options.monitoring && !entitlement.canMonitor) return json({ code: "subscription_required" }, 403);
  const policy = analysisPolicy(entitlement.planId);
  let models: string[];
  try { models = configuredModels(policy, env); }
  catch { return json({ code: "analysis_configuration", error: "The models required for this plan have not been configured." }, 503); }
  if (policy.plan !== "free" && !models.length) return json({ code: "engine_unavailable" }, 503);
  const key = env.OPENROUTER_API_KEY?.trim();
  const mockAi = env.AI_TEST_MODE?.trim().toLowerCase() === "mock";
  const configuredTimeout = Number(env.OPENROUTER_SEARCH_TIMEOUT_MS);
  const searchTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 10_000 && configuredTimeout <= 120_000
    ? configuredTimeout : 60_000;
  let remainingRateLimitRetries = 4;
  const adapters = key ? models.map((model) => new OpenRouterEngineAdapter({
          apiKey: key, model,
          maxRetries: 2,
          retryPermit: () => { if (remainingRateLimitRetries <= 0) return false; remainingRateLimitRetries--; return true; },
          timeoutMs: searchTimeoutMs,
          ...(mockAi ? { fetchImpl: fetch, testMode: "mock" as const } : {}),
        })) : [];
  const adapter = adapters[0] || null;
  const fingerprint = policyFingerprint(policy, models);
  let scanId: string | null = null;

  async function finish(
    input: TargetInput,
    target: AnalysisTarget,
    cacheKey: string,
    result?: LiveReadinessResult,
    candidate?: IdentityCandidate,
  ) {
    await attachAnalysisTarget(workspace, scanId!, target, input, cacheKey);
    const baseContext =
      result?.discoveredContext || contextForTarget(target, candidate);
    const context =
      target.kind === "website" && baseContext.brand.value !== target.name
        ? {
            ...baseContext,
            brand: {
              value: target.name,
              confidence: target.identityConfirmed
                ? 100
                : baseContext.brand.confidence,
              evidence: target.identityConfirmed
                ? ["User-confirmed candidate anchored to submitted URL"]
                : baseContext.brand.evidence,
            },
          }
        : baseContext;
    const prompts = generateTargetPrompts(target, policy.promptLimit);
    const pages = result ? await auditPlanPages(result, policy, (url, usage, failed) => recordPageCrawl(workspace, scanId!, url, usage, failed)) : [];
    const visibility: ActualVisibilityMeasurement = await runPlanVisibility({ adapters, context, target, prompts, policy,
      initialCostMicros: await scanCostGuard(workspace, scanId!, policy.unknownCallReserveMicros),
      onRun: (run) => recordEngineCost(workspace, scanId!, run) });
    if (visibility.engineRuns.length && visibility.engineRuns.every((run) => run.error)) {
      await failScan(workspace, scanId!, "All provider observations failed; no visibility score was assigned.");
      return json({ code: "engine_failed", scanId }, 502);
    }
    const insights = await buildAnalysisInsights({ target, policy, models, prompts, runs: visibility.engineRuns, pages });
    await saveInsights(workspace, scanId!, input, insights, visibility.score);
    const completion: ScanCompletion = result || {
      sourceUrl: "",
      finalUrl: null,
      httpStatus: null,
      readinessScore: null,
      confidence: 0,
      issueCount: 0,
      criticalCount: 0,
      bytesFetched: 0,
      requestCount: 0,
      methodologyVersion: TARGET_METHODOLOGY_VERSION,
      actualVisibilityStatus: "not_measured",
      discoveredContext: context,
      categoryScores: {
        "Technical AEO": 0,
        "Content readiness": 0,
        "Authority & entity": 0,
      },
      findings: [],
    };
    await completeScan(workspace, scanId!, completion, visibility);
    await scheduleMonitoring(workspace, scanId!, input, target, policy);
    const report = await getReportForUser(workspace.userId, scanId!);
    if (!report) throw new Error("Stored report could not be loaded.");
    return json(
      {
        scan: report.scan,
        entitlement: report.entitlement,
        cached: false,
      },
      201,
    );
  }

  try {
    if (payload.scanId !== undefined) {
      if (
        typeof payload.scanId !== "string" ||
        typeof payload.candidateId !== "string"
      )
        return json({ code: "invalid_choice" }, 400);
      if (!adapter)
        return json(
          {
            code: "engine_unavailable",
            error: "AI analysis is not configured.",
          },
          503,
        );
      const pending = await getScanForUser(user.userId, payload.scanId);
      // Never accept a client-supplied biography or candidate. Read the stored, owner-scoped discovery.
      const candidate = pending?.discovery?.candidates.find(
        (item) => item.id === payload.candidateId,
      );
      if (
        !pending ||
        pending.organizationId !== workspace.organizationId ||
        !pending.targetInput ||
        !candidate ||
        pending.status !== "awaiting_identity"
      )
        return json({ code: "invalid_choice" }, 409);
      const reservedPolicy = await scanPolicyForOwner(workspace, pending.id);
      if (reservedPolicy && reservedPolicy.plan !== policy.plan && !(["growth", "pro"].includes(reservedPolicy.plan) && ["growth", "pro"].includes(policy.plan))) {
        await failScan(workspace, pending.id, "Plan changed while awaiting identity. Start a new analysis.");
        return json({ code: "plan_changed" }, 409);
      }
      if (!(await claimIdentityChoice(workspace, pending.id)))
        return json({ code: "expired_choice" }, 409);
      scanId = pending.id;
      const target = targetFromCandidate(pending.targetInput, candidate, true);
      const cacheKey = await targetCacheKey(
        {
          ...pending.targetInput,
          context: `${pending.targetInput.context}|${candidate.name}|${candidate.sources.join("|")}`,
        },
        fingerprint,
        true,
      );
      if (pending.targetInput.websiteUrl) {
        const result = await runLiveReadinessScan(
          pending.targetInput.websiteUrl,
        );
        return await finish(
          pending.targetInput,
          {
            ...target,
            kind: "website",
            websiteUrl: pending.targetInput.websiteUrl,
            category: businessContextForVisibility(result.discoveredContext),
          },
          cacheKey,
          result,
          candidate,
        );
      }
      return await finish(pending.targetInput, target, cacheKey, undefined, candidate);
    }

    let input: TargetInput;
    try {
      input = parseTargetInput(payload);
    } catch {
      return json(
        {
          code: "invalid_input",
          error: "Enter a public URL, name, brand or topic.",
        },
        400,
      );
    }
    if (input.kind !== "website" && !adapter)
      return json(
        {
          code: "engine_unavailable",
          error: "Name and topic analysis requires the configured AI engine.",
        },
        503,
      );
    const cacheKey = await targetCacheKey(
      input,
      fingerprint,
      Boolean(adapter),
    );
    const cached = options.monitoring ? null : await findCachedScan(workspace, cacheKey);
    if (cached) {
      const report = await getReportForUser(workspace.userId, cached.id);
      if (!report) throw new Error("Cached report could not be loaded.");
      return json({
        scan: report.scan,
        entitlement: report.entitlement,
        cached: true,
      });
    }
    const site = input.websiteUrl
      ? await getOrCreateSite(workspace, {
          host: new URL(input.websiteUrl).hostname.toLowerCase(),
          normalizedUrl: input.websiteUrl,
          language: input.language,
          country: "Auto-detected",
        })
      : null;
    scanId = await createRunningScan({
      workspace,
      siteId: site?.id || null,
      sourceUrl: input.websiteUrl || "",
      language: input.language,
      country: "Auto-detected",
      cacheKey,
      methodologyVersion: TARGET_METHODOLOGY_VERSION,
      scanKind:
        input.kind === "website"
          ? "readiness_and_actual_visibility"
          : "entity_visibility",
      targetInput: input,
      executionPolicy: policy,
    });

    if (input.websiteUrl) {
      const result = await runLiveReadinessScan(input.websiteUrl);
      const context = result.discoveredContext;
      if (result.identityCandidates.length > 1) {
        const discovery = {
          status: "ambiguous" as const,
          candidates: result.identityCandidates.slice(0, 4).map((item, index) => ({
            id: `candidate_${index + 1}`,
            kind: "brand" as const,
            name: item.name,
            description: item.evidence.join("; "),
            category: businessContextForVisibility(context),
            aliases: [],
            country: context.markets.value[0] || "Global",
            websiteUrl: input.websiteUrl,
            sources: [result.finalUrl],
          })),
          response: null,
        };
        await storeDiscovery(workspace, scanId, discovery);
        return json(
          {
            status: "needs_confirmation",
            scanId,
            candidates: discovery.candidates,
          },
          202,
        );
      }
      const target: AnalysisTarget = {
        kind: "website",
        input: input.input,
        name: context.brand.value,
        websiteUrl: input.websiteUrl,
        aliases: [],
        category: businessContextForVisibility(context),
        language: context.languages.value[0] || input.language,
        country: context.markets.value[0] || "Global",
        identityConfirmed: false,
      };
      return await finish(input, target, cacheKey, result);
    }
    if (input.kind === "topic")
      return await finish(
        input,
        {
          kind: "topic",
          input: input.input,
          name: input.input,
          websiteUrl: null,
          aliases: [],
          category: input.input,
          language: input.language,
          country: "Global",
          identityConfirmed: false,
        },
        cacheKey,
      );

    if (options.confirmedTarget && options.confirmedTarget.input === input.input && options.confirmedTarget.kind !== "website")
      return await finish(input, options.confirmedTarget, cacheKey);

    const response = await adapter!.run({
      prompt: discoveryPrompt(input),
      language: input.language,
      country: "Global",
      useSearch: true,
      maxOutputTokens: 2_400,
      expectedFormat: "discovery_json",
      searchResults: policy.searchResults, searchUses: policy.searchUses,
    });
    const discovery = parseTargetDiscovery(response, input);
    await storeDiscovery(workspace, scanId, discovery);
    if (response.error) {
      await failScan(
        workspace,
        scanId,
        "The discovery provider could not complete this request.",
      );
      return json(
        {
          code: "engine_failed",
          scanId,
          error: "AI discovery is temporarily unavailable.",
        },
        502,
      );
    }
    if (discovery.status === "ambiguous")
      return json(
        {
          status: "needs_confirmation",
          scanId,
          candidates: discovery.candidates,
        },
        202,
      );
    if (discovery.status === "unresolved")
      return json(
        { status: "needs_clarification", scanId, code: "identity_unresolved" },
        202,
      );
    if (discovery.status === "topic")
      return await finish(
        input,
        {
          kind: "topic",
          input: input.input,
          name: input.input,
          websiteUrl: null,
          aliases: [],
          category: input.input,
          language: input.language,
          country: "Global",
          identityConfirmed: false,
        },
        cacheKey,
      );
    const candidate = discovery.candidates[0];
    return await finish(
      input,
      targetFromCandidate(input, candidate, false),
      cacheKey,
      undefined,
      candidate,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "plan_changed") return json({ code: "plan_changed" }, 409);
    if (error instanceof Error && error.message === "project_limit")
      return json({ code: "project_limit", error: "Your active plan's project limit has been reached." }, 403);
    if (error instanceof Error && error.message === "free_scan_limit")
      return json({ code: "free_scan_limit", error: "The free analysis allowance or retry limit has been reached." }, 429);
    if (error instanceof Error && error.message === "scan_limit")
      return json(
        {
          code: "scan_limit",
          error: "A project analysis is already running or the daily/monthly analysis allowance has been reached.",
        },
        429,
      );
    if (scanId)
      await failScan(
        workspace,
        scanId,
        "Analysis did not complete. Please retry later.",
      );
    return json(
      {
        code: "scan_failed",
        error: "Analysis could not be completed.",
        scanId,
      },
      422,
    );
  }
}
