"use client";
import { useState, type ReactNode } from "react";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { AppShell, StatusPill } from "@/app/components/app-shell";
import { SafeMarkdown } from "@/app/components/safe-markdown";
import { Button } from "@/components/ui/button";
import { useSiteLocale } from "@/hooks/use-site-locale";
import { safeSourceUrl } from "@/lib/analysis-target";
import { normalizeDisplayText } from "@/lib/answer-text";
import type { StoredScan } from "@/db/product";

function Panel({
  children,
  dark = false,
}: {
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <section
      className={`rounded-3xl border p-6 sm:p-7 ${dark ? "border-[#07111f] bg-[#07111f] text-white" : "border-slate-200 bg-white"}`}
    >
      {children}
    </section>
  );
}
function Source({ url, label }: { url: string; label?: string }) {
  const safe = safeSourceUrl(url);
  return safe ? (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block max-w-full break-all rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:underline"
    >
      {normalizeDisplayText(label || safe)}
    </a>
  ) : null;
}

export function ReportContent({
  scan,
  displayName,
}: {
  scan: StoredScan | null;
  displayName: string;
}) {
  const locale = useSiteLocale();
  const ar = locale === "ar";
  const t = (en: string, arabic: string) => (ar ? arabic : en);
  const [tab, setTab] = useState("summary");
  const kind = scan?.target?.kind || "website";
  const topic = kind === "topic";
  const runs = scan?.engineRuns || [];
  const eligible = runs.filter(
    (run) => !["identity", "topic", "entity_resolution"].includes(run.intent),
  );
  const observed = eligible.filter(
    (run) =>
      !run.error && run.responseText && run.surfaceType === "api_with_search",
  );
  const mentions = observed.filter((run) => run.analysis.brandVisible).length;
  const identity = runs.filter((run) => run.intent === "identity");
  const sources = [
    ...new Map(
      runs
        .filter((run) => !run.error)
        .flatMap((run) => run.citations)
        .map((c) => [c.url, c]),
    ).values(),
  ];
  const names = [
    ...new Set(
      runs
        .filter((run) => run.intent === "topic")
        .flatMap((run) => run.analysis.competitorsMentioned),
    ),
  ];
  const hasReadiness = scan?.readinessScore != null;
  const suggestions: string[] = [];
  if (topic)
    suggestions.push(
      t(
        "Review the cited sources and the context of each listed name. This is a sample of responses, not a market ranking.",
        "راجع المصادر وسياق ورود كل اسم. هذه عينة إجابات وليست ترتيبًا للسوق.",
      ),
    );
  else {
    if (identity.length)
      suggestions.push(
        t(
          "Check the identity answer against your official biography or company information. Flag namesake confusion and unsupported claims before updating your public profiles.",
          "قارن إجابة التعريف بسيرتك أو بيانات شركتك الرسمية. راجع تشابه الأسماء والمعلومات غير المسندة قبل تحديث صفحاتك العامة.",
        ),
      );
    if (observed.length && !mentions)
      suggestions.push(
        t(
          "Your name did not appear in the completed unbranded sample. Publish clear evidence of your specialty, consistent profile information and useful answers to the tested questions, then repeat the same prompts.",
          "لم يظهر الاسم في العينة المكتملة من الأسئلة التي لم تذكره مسبقًا. انشر أدلة واضحة على تخصصك ومعلومات تعريف متسقة وإجابات مفيدة عن الأسئلة المختبرة، ثم أعد قياس الأسئلة نفسها.",
        ),
      );
    if (!observed.length)
      suggestions.push(
        t(
          "Unbranded visibility is not measurable in this report yet. Check whether a generic specialty was established and web search completed; do not interpret the missing score as zero visibility.",
          "لم يكتمل قياس الظهور التلقائي في هذا التقرير. راجع تحديد التخصص العام واكتمال البحث؛ غياب الدرجة لا يعني انعدام الظهور.",
        ),
      );
    if (kind === "person" || kind === "brand")
      suggestions.push(
        t(
          "Use one consistent public name and a concise sourced profile. A website audit can be run separately by entering your own URL; third-party profiles require their owner's changes.",
          "استخدم اسمًا عامًا متسقًا وتعريفًا مختصرًا موثقًا. يمكن فحص موقعك بشكل مستقل بإدخال رابطه؛ تعديل الصفحات الخارجية يبقى لدى أصحابها.",
        ),
      );
    if (hasReadiness && scan!.issueCount)
      suggestions.push(
        t(
          "Start with the failed website checks under Technical evidence. Review each source and the proposed change before implementation.",
          "ابدأ بفحوص الموقع غير المجتازة في «الأدلة التقنية». راجع المصدر والتغيير المقترح قبل التنفيذ.",
        ),
      );
  }
  const action = (
    <Button asChild className="rounded-xl bg-blue-600">
      <Link href="/">{t("New analysis", "تحليل جديد")}</Link>
    </Button>
  );
  return (
    <AppShell
      title={
        topic
          ? t("Topic exploration report", "تقرير استكشاف الموضوع")
          : t("Identity and visibility report", "تقرير الهوية والظهور")
      }
      description={t(
        "Inspect the questions, answers and sources behind each observation.",
        "راجع الأسئلة والإجابات والمصادر التي تستند إليها كل نتيجة.",
      )}
      workspaceLabel={displayName}
      userInitial={displayName}
      siteLabel={
        scan?.target?.name ||
        scan?.displayName ||
        t("No analysis yet", "لا يوجد تحليل بعد")
      }
      action={action}
    >
      {!scan ? (
        <Panel>
          <p>
            {t(
              "Start an analysis with a public URL, person, brand or topic.",
              "ابدأ تحليلًا برابط موقع عام أو اسم شخص أو علامة أو موضوع.",
            )}
          </p>
        </Panel>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
            <strong>{scan.target?.name || scan.displayName}</strong>
            <span>
              {t("Language / market", "اللغة / السوق")}: {scan.language} /{" "}
              {scan.country}
            </span>
            <span>{scan.completedAt || scan.createdAt} UTC</span>
            <code>{scan.methodologyVersion}</code>
          </div>
          {scan.status !== "completed" && (
            <Panel>
              <p>
                {t("This analysis is incomplete.", "هذا التحليل لم يكتمل.")}{" "}
                {scan.status === "awaiting_identity"
                  ? t(
                      "An identity selection is required. Select the intended result within one hour.",
                      "يحتاج إلى تأكيد الهوية. اختر النتيجة المقصودة خلال ساعة.",
                    )
                  : t(
                      "Start a new analysis when ready.",
                      "ابدأ تحليلًا جديدًا عندما تكون مستعدًا.",
                    )}
              </p>
              {scan.status === "awaiting_identity" && (
                <Button asChild className="mt-4 rounded-xl bg-blue-600">
                  <Link href={`/?resume=${encodeURIComponent(scan.id)}`}>
                    {t("Confirm identity", "تأكيد الهوية")}
                  </Link>
                </Button>
              )}
            </Panel>
          )}
          <div
            role="tablist"
            aria-label={t("Report sections", "أقسام التقرير")}
            className="flex flex-wrap gap-2"
          >
            {[
              ["summary", t("Summary & next steps", "الخلاصة والتوصيات")],
              ["identity", t("Identity", "الهوية")],
              ["answers", t("Answers & sources", "الإجابات والمصادر")],
              ["technical", t("Technical evidence", "الأدلة التقنية")],
            ]
              .filter(([id]) => !topic || id !== "identity")
              .map(([id, label]) => (
                <button
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-controls={`panel-${id}`}
                  aria-selected={tab === id}
                  key={id}
                  onClick={() => setTab(id)}
                  className={`rounded-xl px-4 py-3 text-sm font-bold ${tab === id ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
                >
                  {label}
                </button>
              ))}
          </div>
          <div
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
            className="space-y-5"
          >
            {tab === "summary" && (
              <>
                <div className="grid gap-5 md:grid-cols-2">
                  <Panel dark>
                    <p className="text-sm text-cyan-200">
                      {topic
                        ? t("Topic exploration", "استكشاف الموضوع")
                        : scan.methodologyVersion.startsWith("entity-")
                          ? t(
                              "Unbranded sample mention rate",
                              "نسبة ذكر الاسم في العينة دون تلقين",
                            )
                          : t("Legacy visibility index", "مؤشر الظهور السابق")}
                    </p>
                    <p className="mt-5 text-6xl font-extrabold">
                      {topic
                        ? "—"
                        : scan.actualVisibilityScore == null
                          ? "—"
                          : `${scan.actualVisibilityScore}${scan.methodologyVersion.startsWith("entity-") ? "%" : "/100"}`}
                    </p>
                    <p className="mt-4 text-sm leading-7 text-slate-300">
                      {topic
                        ? t(
                            "A general topic has no personal or brand score. Read the returned sources and names.",
                            "الموضوع العام لا يُمنح درجة شخص أو علامة. راجع المصادر والأسماء في الإجابات.",
                          )
                        : scan.methodologyVersion.startsWith("entity-")
                          ? t(
                              `${mentions} of ${observed.length} completed search-enabled, unbranded answers mentioned the selected name. ${eligible.length} unbranded tests were requested.`,
                              `ورد الاسم المختار في ${mentions} من ${observed.length} إجابات مكتملة بالبحث دون ذكر الاسم مسبقًا. عدد الاختبارات المطلوبة لهذا القياس: ${eligible.length}.`,
                            )
                          : t(
                              "Legacy visibility index. Its original score is preserved; this report does not recalculate it.",
                              "مؤشر ظهور من المنهجية السابقة. حُفظت درجته الأصلية ولم يُعَد حسابها.",
                            )}
                    </p>
                    <p className="mt-4 text-xs leading-6 text-slate-400">
                      {t(
                        "A small API sample, not a consumer-app ranking or statistical confidence estimate. Identity questions never contribute to the mention rate.",
                        "عينة صغيرة من API وليست ترتيبًا في تطبيقات الجمهور أو تقديرًا للثقة الإحصائية. أسئلة التعريف لا تدخل في نسبة الذكر.",
                      )}
                    </p>
                  </Panel>
                  <Panel>
                    <p className="text-sm font-bold text-slate-500">
                      {t("Website readiness", "جاهزية الموقع")}
                    </p>
                    <p className="mt-5 text-5xl font-extrabold">
                      {hasReadiness
                        ? `${scan.readinessScore}/100`
                        : t("N/A", "غير منطبق")}
                    </p>
                    <p className="mt-4 text-sm leading-7 text-slate-500">
                      {hasReadiness
                        ? t(
                            `${scan.findings.length} website checks, ${scan.issueCount} findings to review. Readiness is independent of visibility.`,
                            `${scan.findings.length} فحصًا للموقع، و${scan.issueCount} ملاحظة للمراجعة. الجاهزية مستقلة عن الظهور.`,
                          )
                        : t(
                            "No website audit was run. A missing website is not scored as zero.",
                            "لم يُنفذ فحص تقني لموقع. غياب الموقع لا يُسجل بدرجة صفر.",
                          )}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <StatusPill tone="info">
                        {runs.length} {t("stored answers", "إجابات محفوظة")}
                      </StatusPill>
                      <StatusPill tone="info">
                        {sources.length}{" "}
                        {t("returned source URLs", "روابط مصادر معادة")}
                      </StatusPill>
                    </div>
                  </Panel>
                </div>
                {topic && names.length > 0 && (
                  <Panel>
                    <h2 className="font-extrabold">
                      {t(
                        "Names extracted from the sample",
                        "أسماء مستخرجة من العينة",
                      )}
                    </h2>
                    <p className="mt-2 text-sm text-slate-500">
                      {t(
                        "Automatic list extraction; verify names and context in the original answers. No global ranking is implied.",
                        "استخراج آلي من القوائم؛ تحقق من الأسماء وسياقها في الإجابات الأصلية. لا يعني ترتيبًا عالميًا.",
                      )}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {names.map((name) => (
                        <StatusPill key={name} tone="info">
                          {name}
                        </StatusPill>
                      ))}
                    </div>
                  </Panel>
                )}
                <Panel>
                  <h2 className="text-lg font-extrabold">
                    {t("Recommended next steps", "الخطوات المقترحة")}
                  </h2>
                  <ol className="mt-4 list-decimal space-y-3 ps-5 text-sm leading-7 text-slate-600">
                    {suggestions.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <p className="mt-4 border-t pt-4 text-xs text-slate-500">
                    {t(
                      "These are reviewable recommendations. No website or external profile has been changed.",
                      "هذه توصيات قابلة للمراجعة. لم يُعدَّل موقع أو ملف خارجي.",
                    )}
                  </p>
                </Panel>
              </>
            )}
            {tab === "identity" && (
              <>
                <Panel>
                  <h2 className="text-lg font-extrabold">
                    {scan.target?.name || scan.displayName}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    {scan.target?.category ||
                      scan.discoveredContext?.category.value}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-500">
                    {t(
                      "This is the selected identity and the API's description. Sources still need factual review; matching a name is not proof of identity or accuracy.",
                      "هذه الهوية المختارة ووصف API لها. تحتاج المعلومات إلى مراجعة مصادرها؛ تطابق الاسم وحده ليس إثباتًا للهوية أو صحة الوصف.",
                    )}
                  </p>
                  {scan.target?.identityConfirmed && (
                    <p className="mt-3 text-sm font-bold text-blue-700">
                      {t(
                        "Identity selected by the account owner.",
                        "أكد صاحب الحساب الهوية المقصودة.",
                      )}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {[
                      ...new Set(
                        scan.discovery?.candidates
                          .filter((c) => c.name === scan.target?.name)
                          .flatMap((c) => c.sources) || [],
                      ),
                    ].map((url) => (
                      <Source key={url} url={url} />
                    ))}
                  </div>
                </Panel>
                {identity.map((run) => (
                  <Panel key={run.id}>
                    <h3 className="font-bold">{run.prompt}</h3>
                    <p
                      dir="auto"
                      className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-600"
                    >
                      {run.responseText ||
                        t(
                          "No completed identity answer.",
                          "لم تكتمل إجابة التعريف.",
                        )}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {run.citations.map((c) => (
                        <Source
                          key={c.url}
                          url={c.url}
                          label={c.title || undefined}
                        />
                      ))}
                    </div>
                  </Panel>
                ))}
                {!identity.length && (
                  <Panel>
                    <p className="text-sm">
                      {t(
                        "No separate identity question was completed in this scan.",
                        "لم يكتمل سؤال مستقل للتعريف في هذا الفحص.",
                      )}
                    </p>
                  </Panel>
                )}
              </>
            )}
            {tab === "answers" && (
              <>
                {!runs.length && (
                  <Panel>
                    <p>
                      {t(
                        "No AI answers are available. Engine activation or a successful run is required.",
                        "لا تتوفر إجابات ذكاء اصطناعي. يلزم تفعيل المحرك وإكمال تشغيل ناجح.",
                      )}
                    </p>
                  </Panel>
                )}
                {runs.map((run, index) => (
                  <Panel key={run.id}>
                    <p className="text-xs font-bold text-blue-600">
                      {t("Run", "اختبار")} {index + 1} ·{" "}
                      {run.intent === "identity"
                        ? t(
                            "Named identity question — excluded from score",
                            "سؤال تعريف بالاسم — مستبعد من الدرجة",
                          )
                        : run.intent === "topic"
                          ? t(
                              "Topic exploration — no brand score",
                              "استكشاف موضوع — دون درجة علامة",
                            )
                          : t("Unbranded question", "سؤال دون ذكر الاسم")}
                    </p>
                    <h2 dir="auto" className="mt-3 text-lg font-extrabold">
                      {normalizeDisplayText(run.prompt)}
                    </h2>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <StatusPill tone="info">
                        {run.provider} · {run.model}
                      </StatusPill>
                      <StatusPill
                        tone={
                          run.surfaceType === "api_with_search"
                            ? "good"
                            : "warn"
                        }
                      >
                        {run.surfaceType === "api_with_search"
                          ? t("API: search evidenced", "API: توجد أدلة بحث")
                          : t(
                              "API: search not evidenced",
                              "API: البحث غير مثبت",
                            )}
                      </StatusPill>
                      <StatusPill tone={run.error ? "bad" : "info"}>
                        {run.error
                          ? t("Failed", "تعذر الإكمال")
                          : t("Response stored", "إجابة محفوظة")}
                      </StatusPill>
                    </div>
                    <div
                      dir="auto"
                      className="mt-5 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-700"
                    >
                      {run.error
                        ? t(
                            "The provider did not complete this request. This run is excluded from the score.",
                            "لم يكمل المزود الطلب. استُبعد هذا التشغيل من الدرجة.",
                          )
                        : <SafeMarkdown text={run.responseText} />}
                    </div>
                    {!["identity", "topic"].includes(run.intent) && (
                      <p className="mt-3 text-xs text-slate-500">
                        {t("Name match", "تطابق الاسم")}:{" "}
                        {run.analysis.brandVisible
                          ? t("Detected", "مكتشف")
                          : t("Not detected", "غير مكتشف")}{" "}
                        ·{" "}
                        {t(
                          "Possible recommendation signal",
                          "إشارة توصية محتملة",
                        )}
                        :{" "}
                        {run.analysis.recommendationStatus === "recommended"
                          ? t("Detected; review context", "مكتشفة؛ راجع السياق")
                          : "—"}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {run.citations.map((c) => (
                        <Source
                          key={c.url}
                          url={c.url}
                          label={c.title || undefined}
                        />
                      ))}
                    </div>
                    <details className="mt-4 text-xs text-slate-500">
                      <summary className="cursor-pointer font-bold">
                        {t("Measurement record", "سجل القياس")}
                      </summary>
                      <p className="mt-2 break-all leading-6">
                        {run.language} · {run.country} · {run.timestamp} ·{" "}
                        {run.providerRunId || run.id}
                      </p>
                      <p className="mt-2">
                        {t(
                          "Tokens / provider-reported cost",
                          "الرموز / التكلفة المعادة من المزود",
                        )}
                        : {run.usage.totalTokens ?? "—"} /{" "}
                        {run.estimatedCostMicros == null
                          ? t("Unavailable", "غير متاحة")
                          : `$${(run.estimatedCostMicros / 1_000_000).toFixed(5)}`}
                      </p>
                    </details>
                  </Panel>
                ))}
              </>
            )}
            {tab === "technical" &&
              (hasReadiness ? (
                scan.findings.map((f) => (
                  <Panel key={f.id}>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-extrabold">{f.title}</h2>
                      <StatusPill tone={f.status === "pass" ? "good" : "warn"}>
                        {f.status === "pass"
                          ? t("Pass", "مجتاز")
                          : f.status === "partial"
                            ? t("Partial", "جزئي")
                            : t("Needs work", "يحتاج تحسينًا")}
                      </StatusPill>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {f.explanation}
                    </p>
                    <p
                      dir="auto"
                      className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"
                    >
                      {f.evidence}
                    </p>
                    <div className="mt-4">
                      <Source
                        url={f.sourceUrl}
                        label={t("Open source", "فتح المصدر")}
                      />
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      {f.awardedPoints}/{f.weight}{" "}
                      {t("readiness points", "نقاط جاهزية")}
                    </p>
                  </Panel>
                ))
              ) : (
                <Panel>
                  <p>
                    {t(
                      "Not applicable: this analysis did not crawl a website. Enter your own website URL to run a technical audit.",
                      "غير منطبق: لم يتضمن هذا التحليل زحفًا لموقع. أدخل رابط موقعك لإجراء الفحص التقني.",
                    )}
                  </p>
                </Panel>
              ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}
