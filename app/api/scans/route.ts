import { env } from "cloudflare:workers";
import { getAuthenticatedUser } from "@/app/auth";
import { completeScan, countRecentScans, createRunningScan, ensureWorkspace, failScan, findCachedScan, getOrCreateSite } from "@/db/product";
import { generateIntentPrompts, runActualVisibility, type ActualVisibilityMeasurement } from "@/lib/ai-visibility";
import { OpenRouterEngineAdapter } from "@/lib/ai-engines/openrouter-engine-adapter";
import { normalizeWebsiteInput, READINESS_METHODOLOGY_VERSION, runLiveReadinessScan } from "@/lib/live-readiness";

export const runtime = "edge";

type ScanRequest = { url?: unknown };

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return Response.json({ error: "Sign in is required before a live scan." }, { status: 401 });
  let payload: ScanRequest;
  try { payload = await request.json() as ScanRequest; }
  catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }
  if (typeof payload.url !== "string") return Response.json({ error: "A website address is required." }, { status: 400 });

  let normalized: URL;
  try { normalized = normalizeWebsiteInput(payload.url); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid website address." }, { status: 400 }); }

  const language = "Auto-detected";
  const country = "Auto-detected";
  const workspace = await ensureWorkspace(user);
  const openRouterApiKey = env.OPENROUTER_API_KEY?.trim();
  const visibilityModel = env.OPENROUTER_MODEL?.trim() || "unconfigured";
  const openRouterConfigured = Boolean(openRouterApiKey && visibilityModel !== "unconfigured");
  const engineAvailability = openRouterConfigured ? "configured" : "not_configured";
  const cacheKey = `${normalized.toString().toLowerCase()}|auto-context|${READINESS_METHODOLOGY_VERSION}|visibility-v2|openrouter|${visibilityModel}|api_with_search|${engineAvailability}`;
  const cached = await findCachedScan(workspace, cacheKey);
  if (cached) return Response.json({ scan: cached, cached: true }, { headers: { "Cache-Control": "no-store" } });
  if (await countRecentScans(workspace) >= 5) {
    return Response.json({ error: "Private beta limit reached: five live scans per 24 hours." }, { status: 429 });
  }

  const site = await getOrCreateSite(workspace, {
    host: normalized.hostname.toLowerCase(), normalizedUrl: normalized.toString(), language, country,
  });
  const scanId = await createRunningScan({
    workspace, siteId: site.id, sourceUrl: normalized.toString(), language, country,
    cacheKey, methodologyVersion: READINESS_METHODOLOGY_VERSION, scanKind: "readiness_and_actual_visibility",
  });
  try {
    const result = await runLiveReadinessScan(normalized.toString());
    let visibility: ActualVisibilityMeasurement;
    if (openRouterConfigured) {
      visibility = await runActualVisibility({
        adapter: new OpenRouterEngineAdapter({ apiKey: openRouterApiKey!, model: visibilityModel }),
        context: result.discoveredContext,
      });
    } else {
      visibility = {
        status: "not_configured",
        score: null,
        confidence: 0,
        engineRuns: [],
        prompts: generateIntentPrompts(result.discoveredContext),
      };
    }
    const scan = await completeScan(workspace, scanId, result, visibility);
    return Response.json({ scan, cached: false }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The live scan could not be completed.";
    await failScan(workspace, scanId, message);
    return Response.json({ error: message, scanId }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
