import type { StoredScan } from "@/db/product";
import { SafeMarkdown } from "@/app/components/safe-markdown";
import { safeSourceUrl } from "@/lib/analysis-target";

function SourceLink({ url, title }: { url: string; title?: string | null }) {
  const safe = safeSourceUrl(url);
  if (!safe) return null;
  return <a className="print-source" href={safe} dir="ltr" title={safe}>{title || new URL(safe).hostname.replace(/^www\./, "")}</a>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="print-metric"><span>{label}</span><strong dir="auto">{value}</strong></div>;
}

export function PrintableReport({ scan, starter, ar, plan }: { scan: StoredScan; starter: boolean; ar: boolean; plan: string }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const runs = scan.engineRuns;
  const excludedIntents = ["identity", "entity_resolution", "topic"];
  const observed = runs.filter((run) => !excludedIntents.includes(run.intent) && !run.error && run.responseText && run.surfaceType === "api_with_search");
  const mentions = observed.filter((run) => run.analysis.brandVisible).length;
  const models = [...new Set(runs.map((run) => run.model))];
  const sourceUrl = safeSourceUrl(scan.finalUrl || scan.sourceUrl || scan.target?.websiteUrl);
  const score = scan.actualVisibilityScore === null ? "—" : scan.methodologyVersion.startsWith("entity-") ? `${scan.actualVisibilityScore}%` : `${scan.actualVisibilityScore}/100`;
  const readiness = scan.readinessScore === null ? t("N/A", "غير منطبق") : `${scan.readinessScore}/100`;
  const categories = ["Technical AEO", "Content readiness", "Authority & entity"] as const;
  const categoryAr = ["الجاهزية التقنية", "جاهزية المحتوى", "السلطة والكيان"];
  const actions = scan.insights?.actionPlan || [];
  const priorityFindings = scan.findings.filter((finding) => finding.status !== "pass");
  const targetName = scan.target?.name || scan.displayName;
  const analysisPlan = scan.insights?.level === "initial" ? starter ? "Free · Starter access" : "Free"
    : scan.insights?.level === "detailed" ? "Essential"
    : scan.insights?.level === "advanced" ? "Growth / Pro" : plan;
  return <article className="print-report" dir={ar ? "rtl" : "ltr"} lang={ar ? "ar" : "en"}>
    <header className="print-cover">
      <div className="print-brand" dir="ltr"><img src="/favicon.svg" alt="Recomvia" width="38" height="38" /><span>recomvia</span></div>
      <p className="print-eyebrow">{t("Private visibility report", "تقرير ظهور خاص")}</p>
      <h1>{t("AI Visibility Report", "تقرير الظهور في الذكاء الاصطناعي")}</h1>
      <p className="print-target" dir="auto">{targetName}</p>
      {sourceUrl && <p className="print-target-url"><SourceLink url={sourceUrl} /></p>}
      <dl className="print-cover-meta">
        <div><dt>{t("Analysis date", "تاريخ التحليل")}</dt><dd dir="ltr">{scan.completedAt || scan.createdAt} UTC</dd></div>
        <div><dt>{t("Language / market", "اللغة / السوق")}</dt><dd><bdi>{scan.language}</bdi> / <bdi>{scan.country}</bdi></dd></div>
        <div><dt>{t("Analysis plan", "خطة التحليل")}</dt><dd>{analysisPlan}</dd></div>
        <div><dt>{t("Methodology version", "إصدار المنهجية")}</dt><dd dir="ltr">{scan.methodologyVersion}</dd></div>
      </dl>
    </header>

    <section className="print-section" aria-labelledby="print-summary-heading">
      <h2 id="print-summary-heading">{t("Main summary", "الملخص الرئيسي")}</h2>
      <p>{scan.target?.kind === "topic"
        ? t("This report records answers about a general topic; no personal or brand visibility score applies.", "يسجل هذا التقرير إجابات عن موضوع عام؛ ولا تُحتسب له درجة ظهور لشخص أو علامة تجارية.")
        : t(`${mentions} of ${observed.length} completed unbranded answers mentioned the analyzed name. Visibility and website readiness are measured separately.`, `ذُكر الاسم محل التحليل في ${mentions} من ${observed.length} إجابات مكتملة دون تلقين الاسم. يُقاس الظهور وجاهزية الموقع بصورة مستقلة.`)}</p>
      {starter && <p className="print-note">{t("Starter includes the entitled initial sample of this stored analysis.", "يتضمن Starter العينة الأولية المتاحة من هذا التحليل المحفوظ.")}</p>}
      <div className="print-metrics">
        <Metric label={t("Actual visibility / mention rate", "الظهور الفعلي / نسبة الذكر")} value={score} />
        <Metric label={t("AI Readiness Score", "درجة الجاهزية للذكاء الاصطناعي")} value={readiness} />
        {categories.map((category, index) => <Metric key={category} label={ar ? categoryAr[index] : category} value={scan.categoryScores[category] === undefined ? t("N/A", "غير منطبق") : `${scan.categoryScores[category]}/100`} />)}
        <Metric label={t("Findings", "الملاحظات")} value={scan.issueCount} />
        <Metric label={t("Critical findings", "الملاحظات الحرجة")} value={scan.criticalCount} />
        <Metric label={t("AI runs", "اختبارات الذكاء الاصطناعي")} value={runs.length} />
      </div>
      <h3>{t("Recommended next steps", "الخطوات التالية المقترحة")}</h3>
      {actions.length ? <ol className="print-list">{actions.slice(0, 5).map((action, index) => <li key={index}>{action.title[ar ? "ar" : "en"]}</li>)}</ol>
        : priorityFindings.length ? <ol className="print-list">{priorityFindings.slice(0, 5).map((finding) => <li key={finding.id}>{finding.title}: {finding.explanation}</li>)}</ol>
        : <p>{t("No specific next step was recorded in this report.", "لم تُسجّل خطوة تالية محددة في هذا التقرير.")}</p>}
    </section>

    <section className="print-section" aria-labelledby="print-identity-heading">
      <h2 id="print-identity-heading">{t("Identity", "الهوية")}</h2>
      <p className="print-identity-name" dir="auto">{targetName}</p>
      {scan.target?.category && <p dir="auto">{scan.target.category}</p>}
      {scan.discoveredContext?.description?.value && <p dir="auto">{scan.discoveredContext.description.value}</p>}
      <p className="print-note">{t("Named identity answers appear once in the observations below and are excluded from the visibility score.", "تظهر إجابات التعريف بالاسم مرة واحدة ضمن الملاحظات أدناه وتُستبعد من درجة الظهور.")}</p>
    </section>

    <section className="print-section print-observations" aria-labelledby="print-answers-heading">
      <h2 id="print-answers-heading">{t("Questions, answers & sources", "الأسئلة والإجابات والمصادر")}</h2>
      <p className="print-note">{runs.length} {t("stored observations across", "ملاحظة محفوظة عبر")} {models.length} {t("models", "نماذج")}</p>
      <div className="print-model-list">{models.map((model) => <span className="print-badge print-model" dir="ltr" key={model}>{model}</span>)}</div>
      {runs.map((run, index) => {
        const excluded = excludedIntents.includes(run.intent);
        const sources = [...new Map([...run.citations, ...run.sources].filter((source) => safeSourceUrl(source.url)).map((source) => [source.url, source])).values()];
        return <section className="print-observation" key={run.id}>
          <div className="print-observation-head">
            <p className="print-eyebrow">{t("Run", "اختبار")} {index + 1} · {run.intent === "identity" || run.intent === "entity_resolution" ? t("Named identity question", "سؤال تعريف بالاسم") : run.intent === "topic" ? t("Topic question", "سؤال موضوع") : t("Unbranded question", "سؤال دون ذكر الاسم")}</p>
            <div className="print-badges"><span className="print-badge print-model" dir="ltr">{run.model}</span><span className="print-badge">{run.surfaceType === "api_with_search" ? t("Search evidenced", "البحث مثبت") : t("Search not evidenced", "البحث غير مثبت")}</span></div>
            <h3 dir="auto">{run.prompt}</h3>
          </div>
          <div className="print-answer"><strong>{t("Answer", "الإجابة")}</strong>{run.error || !run.responseText ? <p>{t("Observation unavailable.", "الملاحظة غير متاحة.")}</p> : <SafeMarkdown text={run.responseText} />}</div>
          <p className="print-measurement"><strong>{t("Name match", "تطابق الاسم")}:</strong> {run.error || excluded ? t("Excluded from visibility score", "مستبعد من درجة الظهور") : run.analysis.brandVisible ? t("Detected", "مكتشف") : t("Not detected", "غير مكتشف")}</p>
          <div className="print-sources"><strong>{t("Sources", "المصادر")}</strong>{sources.length ? <ol>{sources.map((citation) => <li key={citation.url}><SourceLink url={citation.url} title={citation.title} /></li>)}</ol> : <p>{t("No source stored for this observation.", "لم يُحفظ مصدر لهذه الملاحظة.")}</p>}</div>
        </section>;
      })}
    </section>

    <section className="print-section" aria-labelledby="print-plan-heading">
      <h2 id="print-plan-heading">{t("Analysis & action plan", "التحليل وخطة العمل")}</h2>
      {scan.insights ? <>
        <p>{t("Measurement coverage", "تغطية القياس")}: {scan.insights.scope.questions} {t("questions", "أسئلة")} · {scan.insights.byEngine.length} {t("models", "نماذج")}</p>
        {scan.insights.byEngine.length > 0 && <div className="print-engine-summary">{scan.insights.byEngine.map((item) => <div key={item.model}><strong dir="ltr">{item.model}</strong><span>{item.observed}/{item.attempted} {t("valid observations", "ملاحظات صالحة")}</span><span>{item.mentionRate === null ? "—" : `${item.mentionRate}%`} {t("mention rate", "نسبة الذكر")}</span></div>)}</div>}
        {actions.length ? <ol className="print-action-list">{actions.map((action, index) => <li key={index}><h3>{action.title[ar ? "ar" : "en"]}</h3><p>{action.instruction[ar ? "ar" : "en"]}</p><div className="print-action-sources">{action.evidenceUrls.map((url) => <SourceLink key={url} url={url} />)}</div></li>)}</ol> : <p>{t("No additional action was established from this sample.", "لم تُثبت العينة إجراءً إضافيًا محددًا.")}</p>}
      </> : <p>{t("No separate action plan was stored for this report.", "لم تُحفظ خطة عمل منفصلة لهذا التقرير.")}</p>}
    </section>

    <section className="print-section" aria-labelledby="print-technical-heading">
      <h2 id="print-technical-heading">{t("Technical evidence", "الأدلة التقنية")}</h2>
      {scan.readinessScore === null ? <p>{t("No website audit was run for this analysis.", "لم يُجرَ فحص موقع لهذا التحليل.")}</p> : scan.findings.length ? scan.findings.map((finding) => <div className="print-finding" key={finding.id}><h3 dir="auto">{finding.title}</h3><p className="print-note">{finding.category} · {finding.status}</p><p dir="auto">{finding.explanation}</p><p dir="auto">{finding.evidence}</p><SourceLink url={finding.sourceUrl} /></div>) : <p>{t("No technical findings were stored.", "لم تُحفظ ملاحظات تقنية.")}</p>}
    </section>

    <footer className="print-disclaimer"><h2>{t("Methodology & disclaimer", "المنهجية وإخلاء المسؤولية")}</h2><p>{t("These are stored API observations from a defined sample. They are not a consumer application ranking, a statistical confidence estimate, or a guaranteed recommendation or citation. Identity questions do not contribute to the unbranded mention rate. Website readiness is measured separately.", "هذه ملاحظات API محفوظة من عينة محددة. وهي ليست ترتيبًا في تطبيقات الجمهور، ولا تقديرًا للثقة الإحصائية، ولا ضمانًا للتوصية أو الاستشهاد. لا تدخل أسئلة التعريف بالاسم في نسبة الذكر دون تلقين الاسم. وتُقاس جاهزية الموقع بصورة مستقلة.")}</p><p>{t("Methodology version", "إصدار المنهجية")}: <bdi dir="ltr">{scan.methodologyVersion}</bdi></p></footer>
  </article>;
}
