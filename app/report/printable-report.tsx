import { AnalysisInsightsView } from "./analysis-insights-view";
import type { StoredScan } from "@/db/product";
import { safeSourceUrl } from "@/lib/analysis-target";

/** The input has already been filtered by server-side report entitlement. */
export function PrintableReport({ scan, starter, ar, suggestions }: { scan: StoredScan; starter: boolean; ar: boolean; suggestions: string[] }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  return <article className="report-export hidden" dir={ar ? "rtl" : "ltr"}>
    <h1>recomvia · {t(starter ? "Starter report" : "Visibility report", starter ? "التقرير المبدئي" : "تقرير الظهور")}</h1>
    <h2>{scan.target?.name || scan.displayName}</h2>
    <p>{scan.language} · {scan.country} · {scan.completedAt || scan.createdAt} UTC</p>
    <p>{t("Methodology", "المنهجية")}: {scan.methodologyVersion}</p>
    <p>{t("Observed visibility", "الظهور المرصود")}: {scan.actualVisibilityScore ?? "—"}{scan.methodologyVersion.startsWith("entity-") && scan.actualVisibilityScore !== null ? "%" : ""} · {t("Website readiness", "جاهزية الموقع")}: {scan.readinessScore == null ? t("Not applicable", "غير منطبق") : `${scan.readinessScore}/100`}</p>
    <p>{t("API observations are a sample, not a consumer-app ranking or a guaranteed recommendation. Website readiness is measured separately.", "نتائج API عينة رصد وليست ترتيبًا في تطبيقات الجمهور أو ضمانًا للتوصية. تُقاس جاهزية الموقع بصورة مستقلة.")}</p>
    {starter && <p>{t("A limited view of the initial stored analysis; no recurring monitoring or fresh deep scan is included.", "عرض محدود للتحليل الأولي المحفوظ؛ لا يشمل متابعة دورية أو فحصًا عميقًا جديدًا.")}</p>}
    <h2>{t("Initial recommendations", "التوصيات")}</h2><ol>{suggestions.map((text) => <li key={text}>{text}</li>)}</ol>
    {!starter && scan.insights && <AnalysisInsightsView data={scan.insights} ar={ar} />}
    <h2>{t("Answers and sources", "الإجابات والمصادر")}</h2>
    {scan.engineRuns.map((run) => <section key={run.id}>
      <h3>{run.prompt}</h3><p>{run.provider} · {run.model} · {run.surfaceType} · {run.language} · {run.country} · {run.timestamp}</p>
      <p className="whitespace-pre-wrap" dir="auto">{run.error ? t("This run failed and is excluded from the score.", "تعذر هذا الاختبار واستُبعد من الدرجة.") : run.responseText}</p>
      <ul>{run.citations.filter((source) => safeSourceUrl(source.url)).map((source, index) => <li key={`${source.url}-${index}`}><a href={safeSourceUrl(source.url)!}>{source.title || source.url}</a><p dir="ltr">{safeSourceUrl(source.url)}</p></li>)}</ul>
    </section>)}
    <h2>{t("Technical findings", "الملاحظات التقنية")}</h2>
    {scan.readinessScore == null ? <p>{t("Not applicable: no website was audited.", "غير منطبق: لم يُفحص موقع.")}</p> : scan.findings.map((finding) => <section key={finding.id}><h3>{finding.title}</h3><p>{finding.explanation}</p><p>{finding.evidence}</p><p dir="ltr">{safeSourceUrl(finding.sourceUrl)}</p></section>)}
  </article>;
}
