import type { AnalysisPolicy } from "./analysis-policy";
import type { AnalysisTarget } from "./analysis-target";
import type { IntentPrompt, VisibilityEngineRun } from "./ai-visibility";
import type { PageEvidence } from "./plan-analysis";

export type ActionItem = { priority: "high" | "medium"; title: { en: string; ar: string }; instruction: { en: string; ar: string }; evidenceUrls: string[]; runIds: string[] };
export type RateSummary = { observed: number; attempted: number; mentions: number | null; recommendations: number | null; mentionRate: number | null; citationRate: number | null };
export type AnalysisInsights = {
  version: string; level: "initial" | "detailed" | "advanced"; basisKey: string;
  scope: { models: string[]; questions: number; requestedPages: number; auditedPages: number; coverageComplete: boolean; missingCostRuns: number; recordedProviderCostMicros: number };
  byEngine: Array<RateSummary & { model: string; surfaces: string[] }>;
  competitors: Array<{ name: string; observedRuns: number; runIds: string[] }>;
  sources: Array<{ domain: string; urls: string[]; observedRuns: number; runIds: string[]; owned: boolean }>;
  pages: Array<Omit<PageEvidence, "pageText">>;
  actionPlan: ActionItem[];
  advanced: null | {
    byIntent: Array<RateSummary & { intent: string }>;
    agreement: Array<{ promptId: string; question: string; mentionedBy: string[]; absentFrom: string[]; unavailable: string[] }>;
    citationOpportunities: Array<{ promptId: string; question: string; urls: string[]; runIds: string[] }>;
    contentGaps: Array<{ code: string; question: string; evidenceUrls: string[]; runIds: string[] }>;
  };
  history: Array<{ scanId: string; at: string; score: number | null; comparable: boolean }>;
  change: { previousScanId: string; percentagePoints: number } | null;
};
const unique = <T>(items: T[]) => [...new Set(items)];
const observed = (run: VisibilityEngineRun) => !run.error && Boolean(run.responseText) && run.surfaceType === "api_with_search";
const eligible = (run: VisibilityEngineRun) => !["identity", "topic", "entity_resolution"].includes(run.intent);
function rates(runs: VisibilityEngineRun[], topic: boolean): RateSummary {
  const sample = runs.filter((run) => observed(run) && (topic || eligible(run)));
  return { observed: sample.length, attempted: runs.filter((run) => topic || eligible(run)).length,
    mentions: topic ? null : sample.filter((run) => run.analysis.brandVisible).length,
    recommendations: topic ? null : sample.filter((run) => run.analysis.recommendationStatus === "recommended").length,
    mentionRate: topic || !sample.length ? null : Math.round(100 * sample.filter((run) => run.analysis.brandVisible).length / sample.length),
    citationRate: sample.length ? Math.round(100 * sample.filter((run) => run.citations.length > 0).length / sample.length) : null };
}
function domain(url: string) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }
const fixes: Record<string, [string, string]> = {
  page_access: ["Restore a successful HTML response and verify access without a login.", "استعد استجابة HTML ناجحة وتحقق من إتاحتها دون تسجيل دخول."],
  title: ["Write a specific page title that describes its actual subject.", "اكتب عنوانًا محددًا يصف موضوع الصفحة الفعلي."],
  meta_description: ["Add an accurate summary of the page and its offering.", "أضف وصفًا دقيقًا للصفحة وما تقدمه."],
  canonical: ["Declare the preferred canonical URL after reviewing duplicates.", "حدد الرابط الأساسي للصفحة بعد مراجعة النسخ المكررة."],
  organization_entity: ["Add accurate entity markup that matches visible facts; use a suitable entity type.", "أضف بيانات كيان صحيحة توافق المعلومات الظاهرة مع اختيار نوع الكيان المناسب."],
  answer_structure: ["Add visible questions with concise, factual answers where relevant; structured data must match the content.", "أضف أسئلة ظاهرة بإجابات مختصرة وموثقة عند ملاءمتها؛ يجب أن توافق البيانات المنظمة المحتوى."],
  content_depth: ["Add verifiable details, examples and service scope that directly answer buyer questions.", "أضف تفاصيل قابلة للتحقق وأمثلة ونطاق الخدمة بما يجيب مباشرة عن أسئلة العميل."],
};

export async function buildAnalysisInsights(input: {
  target: AnalysisTarget; policy: AnalysisPolicy; models: string[]; prompts: IntentPrompt[];
  runs: VisibilityEngineRun[]; pages: PageEvidence[];
}): Promise<AnalysisInsights> {
  const { target, policy, models, prompts, runs, pages } = input;
  const topic = target.kind === "topic", ownDomain = domain(target.websiteUrl || "");
  const successful = runs.filter(observed);
  const measured = successful.filter((run) => topic || eligible(run));
  const sourceMap = new Map<string, { urls: string[]; runIds: string[] }>();
  for (const run of successful) for (const source of run.citations) {
    const host = domain(source.url); if (!host) continue;
    const entry = sourceMap.get(host) || { urls: [], runIds: [] };
    entry.urls.push(source.url); entry.runIds.push(run.id); sourceMap.set(host, entry);
  }
  const competitorMap = new Map<string, { name: string; runIds: string[] }>();
  for (const run of measured) for (const name of run.analysis.competitorsMentioned) {
    const key = name.normalize("NFKC").toLowerCase();
    const entry = competitorMap.get(key) || { name, runIds: [] };
    entry.runIds.push(run.id); competitorMap.set(key, entry);
  }
  const severity = { critical: 0, high: 1, medium: 2, low: 3 };
  const findings = pages.flatMap((page) => page.findings).filter((finding) => finding.status !== "pass")
    .sort((a, b) => severity[a.severity] - severity[b.severity]);
  const grouped = new Map<string, typeof findings>();
  for (const finding of findings) grouped.set(finding.code, [...(grouped.get(finding.code) || []), finding]);
  const actionPlan: ActionItem[] = [...grouped.values()].map((items) => {
    const finding = items[0], advice = fixes[finding.code];
    return { priority: severity[finding.severity] <= 1 ? "high" : "medium", title: { en: finding.title, ar: advice ? advice[1] : "مراجعة ملاحظة فنية موثقة" },
      instruction: { en: advice?.[0] || `Review the evidence for ${finding.code} and validate the change on the affected pages.`, ar: advice?.[1] || `راجع دليل الفحص ${finding.code} وتحقق من التعديل في الصفحات المتأثرة.` },
      evidenceUrls: unique(items.map((item) => item.sourceUrl)), runIds: [] };
  });
  const citationOpportunities = prompts.filter((prompt) => topic || !["identity", "entity_resolution"].includes(prompt.intent)).flatMap((prompt) => {
    const sample = measured.filter((run) => run.promptId === prompt.id);
    const urls = unique(sample.flatMap((run) => run.citations.map((source) => source.url)));
    return ownDomain && urls.length && !urls.some((url) => domain(url) === ownDomain || domain(url).endsWith(`.${ownDomain}`))
      ? [{ promptId: prompt.id, question: prompt.question, urls: urls.slice(0, 12), runIds: sample.map((run) => run.id) }] : [];
  });
  if (citationOpportunities.length) actionPlan.push({ priority: "medium", title: { en: "Review cited sources for missing first-party evidence", ar: "راجع المصادر المستشهد بها وفرص إضافة أدلة أصلية" }, instruction: { en: "Compare the cited answers with your audited pages. Add relevant verifiable information where it is missing; this observation does not prove that content is absent from the whole site or guarantee a citation.", ar: "قارن الإجابات والمصادر بصفحاتك المفحوصة وأضف المعلومات الموثقة المناسبة عند نقصها؛ غياب الاستشهاد في العينة لا يثبت نقص الموقع كاملًا ولا يضمن الاستشهاد بعد التعديل." }, evidenceUrls: unique(citationOpportunities.flatMap((item) => item.urls)).slice(0, 12), runIds: unique(citationOpportunities.flatMap((item) => item.runIds)) });
  const unmentioned = measured.filter((run) => !run.analysis.brandVisible);
  if (!topic && unmentioned.length) actionPlan.push({ priority: "medium", title: { en: "Review questions where the brand was absent", ar: "راجع الأسئلة التي لم تظهر فيها العلامة" }, instruction: { en: "Review the actual answers and named alternatives, then compare your positioning and supporting evidence. Absence in this sample is not proof of a ranking penalty.", ar: "راجع الإجابات الفعلية والبدائل المذكورة ثم قارن تعريفك وأدلتك الداعمة. الغياب في هذه العينة لا يثبت وجود عقوبة ترتيب." }, evidenceUrls: unique(unmentioned.flatMap((run) => run.citations.map((source) => source.url))).slice(0, 12), runIds: unmentioned.map((run) => run.id) });
  const basis = JSON.stringify([policy.version, models, target.kind, target.name, target.language, target.country, prompts.map((prompt) => [prompt.id, prompt.question])]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  const basisKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const advanced = policy.plan === "growth" || policy.plan === "pro";
  return {
    version: "evidence-insights-v1", level: advanced ? "advanced" : policy.plan === "free" ? "initial" : "detailed", basisKey,
    scope: { models, questions: prompts.length, requestedPages: target.websiteUrl ? policy.pageLimit : 0, auditedPages: pages.filter((page) => !page.error).length,
      coverageComplete: runs.length === models.length * prompts.length && runs.every(observed) && unique(runs.map((run) => run.model)).length >= models.length,
      missingCostRuns: runs.filter((run) => run.estimatedCostMicros === null && run.error?.code !== "budget_exhausted").length,
      recordedProviderCostMicros: runs.reduce((total, run) => total + (run.estimatedCostMicros ?? 0), 0) },
    byEngine: unique(runs.map((run) => run.model)).map((model) => ({ model, surfaces: unique(runs.filter((run) => run.model === model).map((run) => run.surfaceType)), ...rates(runs.filter((run) => run.model === model), topic) })),
    competitors: [...competitorMap.values()].map((entry) => ({ name: entry.name, observedRuns: unique(entry.runIds).length, runIds: unique(entry.runIds) })).sort((a, b) => b.observedRuns - a.observedRuns).slice(0, policy.competitorLimit),
    sources: [...sourceMap.entries()].map(([host, value]) => ({ domain: host, urls: unique(value.urls).slice(0, 12), runIds: unique(value.runIds), observedRuns: unique(value.runIds).length, owned: Boolean(ownDomain && (host === ownDomain || host.endsWith(`.${ownDomain}`))) })).sort((a, b) => b.observedRuns - a.observedRuns).slice(0, advanced ? 30 : 10),
    pages: pages.map(({ pageText: _text, ...page }) => { void _text; return page; }),
    actionPlan: actionPlan.slice(0, advanced ? 16 : policy.plan === "free" ? 3 : 8),
    advanced: advanced ? { byIntent: unique(runs.map((run) => run.intent)).map((intent) => ({ intent, ...rates(runs.filter((run) => run.intent === intent), topic || intent === "identity") })),
      agreement: topic ? [] : prompts.filter((prompt) => !["identity", "entity_resolution"].includes(prompt.intent)).map((prompt) => ({ promptId: prompt.id, question: prompt.question,
        mentionedBy: runs.filter((run) => run.promptId === prompt.id && observed(run) && run.analysis.brandVisible).map((run) => run.model),
        absentFrom: runs.filter((run) => run.promptId === prompt.id && observed(run) && !run.analysis.brandVisible).map((run) => run.model),
        unavailable: runs.filter((run) => run.promptId === prompt.id && !observed(run)).map((run) => run.model) })), citationOpportunities,
      contentGaps: pages.flatMap((page) => page.findings.filter((finding) => ["answer_structure", "content_depth"].includes(finding.code) && finding.status !== "pass").map((finding) => ({ code: finding.code, question: finding.evidence, evidenceUrls: [finding.sourceUrl], runIds: [] }))),
    } : null,
    history: [], change: null,
  };
}
