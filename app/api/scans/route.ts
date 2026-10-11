import { env } from "cloudflare:workers";
import { getAuthenticatedUser } from "@/app/auth";
import {
  attachAnalysisTarget,
  claimIdentityChoice,
  completeScan,
  createRunningScan,
  ensureWorkspace,
  failScan,
  findCachedScan,
  getOrCreateSite,
  getScanForUser,
  storeDiscovery,
  type ScanCompletion,
} from "@/db/product";
import {
  runActualVisibility,
  type ActualVisibilityMeasurement,
} from "@/lib/ai-visibility";
import { OpenRouterEngineAdapter } from "@/lib/ai-engines/openrouter-engine-adapter";
import { runLiveReadinessScan } from "@/lib/live-readiness";
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
  const scan = await getScanForUser(user.userId, id);
  if (!scan) return json({ code: "not_found" }, 404);
  return json({ scan });
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

  const workspace = await ensureWorkspace(user);
  const key = env.OPENROUTER_API_KEY?.trim();
  const model = env.OPENROUTER_MODEL?.trim();
  const adapter =
    key && model
      ? new OpenRouterEngineAdapter({
          apiKey: key,
          model,
          maxRetries: 0,
          timeoutMs: 25_000,
        })
      : null;
  let scanId: string | null = null;

  async function finish(
    input: TargetInput,
    target: AnalysisTarget,
    cacheKey: string,
    result?: ScanCompletion,
    candidate?: IdentityCandidate,
  ) {
    await attachAnalysisTarget(workspace, scanId!, target, input, cacheKey);
    const context =
      result?.discoveredContext || contextForTarget(target, candidate);
    const prompts = generateTargetPrompts(target);
    const visibility: ActualVisibilityMeasurement = adapter
      ? await runActualVisibility({
          adapter,
          context,
          prompts,
          aliases: target.aliases,
          useDomainAlias: target.kind === "website",
        })
      : {
          status: "not_configured",
          score: null,
          confidence: 0,
          engineRuns: [],
          prompts,
        };
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
    return json(
      {
        scan: await completeScan(workspace, scanId!, completion, visibility),
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
      if (!(await claimIdentityChoice(workspace, pending.id)))
        return json({ code: "expired_choice" }, 409);
      scanId = pending.id;
      const target = targetFromCandidate(pending.targetInput, candidate, true);
      const cacheKey = await targetCacheKey(
        {
          ...pending.targetInput,
          context: `${pending.targetInput.context}|${candidate.name}|${candidate.sources.join("|")}`,
        },
        model!,
        true,
      );
      return await finish(
        pending.targetInput,
        target,
        cacheKey,
        undefined,
        candidate,
      );
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
      model || "unconfigured",
      Boolean(adapter),
    );
    const cached = await findCachedScan(workspace, cacheKey);
    if (cached) return json({ scan: cached, cached: true });
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
    });

    if (input.websiteUrl) {
      const result = await runLiveReadinessScan(input.websiteUrl);
      const context = result.discoveredContext;
      const target: AnalysisTarget = {
        kind: "website",
        input: input.input,
        name: context.brand.value,
        websiteUrl: input.websiteUrl,
        aliases: [],
        category: context.offerings.value[0] || context.category.value,
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

    const response = await adapter!.run({
      prompt: discoveryPrompt(input),
      language: input.language,
      country: "Global",
      useSearch: true,
      maxOutputTokens: 2_400,
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
    if (error instanceof Error && error.message === "scan_limit")
      return json(
        {
          code: "scan_limit",
          error: "Private beta limit: five analyses per 24 hours.",
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
