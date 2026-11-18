"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, Eye, FileSearch, LockKeyhole, ShieldCheck } from "lucide-react";
import { AppShell, StatusPill } from "@/app/components/app-shell";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSiteLocale } from "@/hooks/use-site-locale";
import { safeSourceUrl } from "@/lib/analysis-target";
import type { StoredFinding } from "@/db/product";

type Finding = Pick<
  StoredFinding,
  "id" | "code" | "title" | "category" | "severity" | "status" |
  "explanation" | "evidence" | "sourceUrl"
>;
type Filter = "all" | "critical" | "high" | "other";
type ModelContext = {
  registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
};
type Props = {
  scanId: string | null;
  targetName: string | null;
  hasWebsiteAudit: boolean;
  findings: Finding[];
  requestedFindingIds: string[];
  reviewProposals: Array<{
    findingId: string;
    proposalVersion: number;
    scope: string;
    proposedText: string;
    rationale: string;
    rollbackPlan: string;
  }>;
};

const severityOrder: Record<Finding["severity"], number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};
const severityAr = { critical: "حرج", high: "مرتفع", medium: "متوسط", low: "منخفض" };
const copy = {
  en: {
    title: "Fix Center", description: "Review actual findings from your saved website audit before proposing any change.",
    locked: "Execution locked", beta: "Evidence review only", notice: "No website is modified, no credit balance is charged, and no change is automatically approved.",
    scope: "Saved website analysis", missing: "No completed website audit yet", missingText: "Analyze a website to see real technical and content findings. A person or topic analysis does not create a website audit.",
    clear: "No unresolved findings in this audit", clearText: "This does not guarantee visibility or recommend any website change.",
    start: "Analyze a website", report: "Open original report", issues: "Findings for review",
    all: "All", critical: "Critical", high: "High", other: "Other",
    view: "Inspect evidence", evidence: "Recorded evidence", explanation: "Why it matters", source: "Original source",
    noEvidence: "No evidence excerpt was stored for this finding.", noSource: "No public source URL was recorded.",
    status: "Observation", noCharge: "Pricing not yet available", noChargeNote: "Fix Credit prices and application workflows are not active. The report contains observations, not approved before-and-after edits.",
    contact: "Ask about Fix Credits", notFound: "No matching findings in this category.",
    reviewRequest: "Request human review", reviewRequested: "Review requested", reviewPending: "Sending request…",
    reviewError: "Could not save this review request. Please try again.",
    reviewNote: "A request only records this finding for human review; it does not authorize implementation or charge credits.",
    proposal: "Draft proposal", proposalScope: "Affected area", proposalReason: "Reason", proposalRollback: "Rollback plan",
    proposalNotice: "Proposed text has NOT been applied to your site. Viewing it does not approve a change or purchase Fix Credits.",
  },
  ar: {
    title: "مركز الإصلاح", description: "راجع الملاحظات الحقيقية من فحص موقعك المحفوظ قبل اقتراح أي تغيير.",
    locked: "التنفيذ مغلق", beta: "مراجعة الأدلة فقط", notice: "لن يُعدَّل أي موقع، ولن تُخصم نقاط، ولن تتم الموافقة تلقائيًا على أي تغيير.",
    scope: "فحص موقع محفوظ", missing: "لا يوجد فحص موقع مكتمل بعد", missingText: "ابدأ فحص موقع لعرض ملاحظاته التقنية والتحريرية الفعلية. تحليل الأشخاص والموضوعات لا ينشئ فحصًا تقنيًا للموقع.",
    clear: "لا توجد ملاحظات معلقة في هذا الفحص", clearText: "هذه النتيجة ليست ضمانًا للظهور ولا تفويضًا بإجراء تغييرات على الموقع.",
    start: "ابدأ فحص موقع", report: "افتح التقرير الأصلي", issues: "الملاحظات التي تحتاج مراجعة",
    all: "الكل", critical: "حرجة", high: "مرتفعة", other: "أخرى",
    view: "راجع الدليل", evidence: "الدليل المحفوظ", explanation: "أهمية الملاحظة", source: "المصدر الأصلي",
    noEvidence: "لم يُحفظ مقتطف دليل لهذه الملاحظة.", noSource: "لم يُحفظ رابط مصدر عام لهذه الملاحظة.",
    status: "الملاحظة", noCharge: "الأسعار غير مفعّلة", noChargeNote: "لم تُفتح أسعار نقاط الإصلاح أو آلية التنفيذ بعد. يعرض التقرير ملاحظات مرصودة لا تعديلات قبل وبعد معتمدة.",
    contact: "استفسر عن نقاط الإصلاح", notFound: "لا توجد ملاحظات مطابقة لهذا التصنيف.",
    reviewRequest: "اطلب مراجعة بشرية", reviewRequested: "طُلِبت المراجعة", reviewPending: "جارٍ إرسال الطلب…",
    reviewError: "تعذر حفظ طلب المراجعة، حاول مرة أخرى.",
    reviewNote: "يسجل الطلب الملاحظة للمراجعة البشرية فقط، ولا يسمح بتنفيذ التعديل أو خصم النقاط.",
    proposal: "مسودة التعديل المقترح", proposalScope: "النطاق المستهدف", proposalReason: "أسباب المقترح", proposalRollback: "خطة التراجع",
    proposalNotice: "لم يُنفذ هذا المقترح على موقعك. والاطلاع عليه لا يُعد موافقة على التغيير أو شراء نقاط الإصلاح.",
  },
} as const;

export function FixCenterExperience({ scanId, targetName, hasWebsiteAudit, findings, requestedFindingIds, reviewProposals }: Props) {
  const ar = useSiteLocale() === "ar";
  const t = copy[ar ? "ar" : "en"];
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Finding | null>(null);
  const [requested, setRequested] = useState<string[]>(requestedFindingIds);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const unresolved = useMemo(
    () => findings.filter((finding) => finding.status !== "pass")
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]),
    [findings],
  );
  const groups = useMemo(() => ({
    all: unresolved,
    critical: unresolved.filter((item) => item.severity === "critical"),
    high: unresolved.filter((item) => item.severity === "high"),
    other: unresolved.filter((item) => item.severity === "medium" || item.severity === "low"),
  }), [unresolved]);
  const openEvidence = useCallback((issueId: string) => {
    const finding = unresolved.find((item) => item.id === issueId);
    if (!finding) throw new Error("Finding not present in this account's report.");
    setSelected(finding);
    return {
      issueId: finding.id,
      scanId,
      title: finding.title,
      status: "evidence_opened",
      applicationEnabled: false,
      creditsCharged: 0,
    };
  }, [unresolved, scanId]);

  useEffect(() => {
    if (!unresolved.length) return;
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool({
      name: "stage_fix_preview",
      title: "Review evidence for a real Recomvia finding",
      description: "Show saved evidence for an existing website finding; do not generate, approve or apply a change, and do not charge Fix Credits.",
      inputSchema: {
        type: "object",
        properties: { issueId: { type: "string", enum: unresolved.map((item) => item.id) } },
        required: ["issueId"], additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input: unknown) => {
        if (!input || typeof input !== "object" || typeof (input as { issueId?: unknown }).issueId !== "string")
          throw new Error("issueId is required.");
        return openEvidence((input as { issueId: string }).issueId);
      },
    }, { signal: lifecycle.signal });
    Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, [openEvidence, unresolved]);

  async function sendReviewRequest() {
    if (!scanId || !selected || requesting || requested.includes(selected.id)) return;
    setRequesting(true);
    setRequestError("");
    try {
      const response = await fetch("/api/fix-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, findingId: selected.id }),
      });
      if (!response.ok) throw new Error("Review request failed");
      const result: { request?: { findingId?: string }; executionEnabled?: boolean; creditsCharged?: number } =
        await response.json();
      if (result.request?.findingId !== selected.id || result.executionEnabled !== false ||
          result.creditsCharged !== 0) throw new Error("Invalid review confirmation");
      setRequested((current) => current.includes(selected.id) ? current : [...current, selected.id]);
    } catch {
      setRequestError(t.reviewError);
    } finally {
      setRequesting(false);
    }
  }

  const reportHref = scanId ? `/report?scan=${encodeURIComponent(scanId)}` : "/dashboard";
  const source = selected ? safeSourceUrl(selected.sourceUrl) : null;
  const selectedProposal = selected ? reviewProposals.find((proposal) => proposal.findingId === selected.id) : null;
  const severity = (item: Finding) => ar ? severityAr[item.severity] : item.severity;
  const tone = (item: Finding) => item.severity === "critical" || item.severity === "high" ? "bad" as const : "warn" as const;

  return (
    <AppShell
      title={t.title}
      description={t.description}
      siteLabel={targetName || t.scope}
      action={<span className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"><LockKeyhole className="size-4" />{t.locked}</span>}
    >
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
        <ShieldCheck className="mt-1 size-5 shrink-0 text-blue-600" />
        <p><strong>{t.beta}.</strong> {t.notice}</p>
      </div>
      {!hasWebsiteAudit ? (
        <Card className="rounded-3xl border-slate-200 bg-white">
          <CardContent className="p-8 text-center">
            <FileSearch className="mx-auto size-10 text-blue-600" />
            <h2 className="mt-5 text-xl font-extrabold">{t.missing}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-600">{t.missingText}</p>
            <Button asChild className="mt-6 rounded-xl bg-blue-600"><Link href="/">{t.start}<ArrowRight className="size-4" /></Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t.scope}</p>
              <h2 className="mt-1 text-lg font-extrabold" dir="auto">{targetName || t.scope}</h2>
            </div>
            <Button asChild variant="outline" className="rounded-xl"><Link href={reportHref}>{t.report}<ArrowRight className="size-4" /></Link></Button>
          </div>
          {unresolved.length === 0 ? (
            <Card className="rounded-3xl border-slate-200 bg-white">
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
                <h2 className="mt-4 text-xl font-extrabold">{t.clear}</h2>
                <p className="mt-3 text-sm text-slate-500">{t.clearText}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <h2 className="text-xl font-extrabold">{t.issues} ({unresolved.length})</h2>
              <div className="my-5 flex flex-wrap gap-2" role="group" aria-label={t.issues}>
                {(["all", "critical", "high", "other"] as const).map((key) => (
                  <Button key={key} type="button" variant={filter === key ? "default" : "outline"}
                    aria-pressed={filter === key} onClick={() => setFilter(key)} className="rounded-xl">
                    {t[key]} ({groups[key].length})
                  </Button>
                ))}
              </div>
              {groups[filter].length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{t.notFound}</p>
              ) : (
                <div className="space-y-3">
                  {groups[filter].map((item) => (
                    <Card key={item.id} className="rounded-2xl border-slate-200 bg-white py-0 shadow-none">
                      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-extrabold" dir="auto">{item.title}</h3>
                            <StatusPill tone={tone(item)}>{severity(item)}</StatusPill>
                            {requested.includes(item.id) && <StatusPill tone="good">{t.reviewRequested}</StatusPill>}
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600" dir="auto">{item.explanation}</p>
                          <p className="mt-3 text-xs font-semibold text-slate-500">{item.category}</p>
                        </div>
                        <Button variant="outline" className="shrink-0 rounded-xl" onClick={() => openEvidence(item.id)}>
                          <Eye className="size-4" />{t.view}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-[#07111f] p-6 text-white">
        <h2 className="font-extrabold">{t.noCharge}</h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">{t.noChargeNote}</p>
        <Button asChild className="mt-5 rounded-xl bg-white text-[#07111f] hover:bg-slate-100">
          <Link href="/contact?product=fix-credits">{t.contact}<ArrowRight className="size-4" /></Link>
        </Button>
      </section>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <StatusPill tone={tone(selected)}>{severity(selected)}</StatusPill>
                <DialogTitle dir="auto" className="mt-3 text-xl font-extrabold">{selected.title}</DialogTitle>
                <DialogDescription>{t.status}: {selected.status} · {selected.category}</DialogDescription>
              </DialogHeader>
              <section>
                <h3 className="text-sm font-extrabold">{t.explanation}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700" dir="auto">{selected.explanation}</p>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-extrabold">{t.evidence}</h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700" dir="auto">{selected.evidence || t.noEvidence}</p>
              </section>
              <section>
                <h3 className="text-sm font-extrabold">{t.source}</h3>
                {source ? <a href={source} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex max-w-full items-center gap-2 break-all text-sm font-semibold text-blue-700 underline">{source}<ExternalLink className="size-4 shrink-0" /></a> : <p className="mt-2 text-sm text-slate-500">{t.noSource}</p>}
              </section>
              {selectedProposal && (
                <section className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
                  <h3 className="font-extrabold">{t.proposal} · v{selectedProposal.proposalVersion}</h3>
                  <p className="text-xs font-semibold leading-6 text-blue-900">{t.proposalNotice}</p>
                  <div><h4 className="text-xs font-bold">{t.proposalScope}</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm" dir="auto">{selectedProposal.scope}</p></div>
                  <p className="whitespace-pre-wrap break-words rounded-xl bg-white p-3 text-sm leading-7" dir="auto">{selectedProposal.proposedText}</p>
                  <div><h4 className="text-xs font-bold">{t.proposalReason}</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm" dir="auto">{selectedProposal.rationale}</p></div>
                  <div><h4 className="text-xs font-bold">{t.proposalRollback}</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm" dir="auto">{selectedProposal.rollbackPlan}</p></div>
                </section>
              )}
              <p className="text-xs leading-6 text-slate-500">{t.reviewNote}</p>
              {requestError && <p role="alert" className="text-sm font-semibold text-red-700">{requestError}</p>}
              <DialogFooter>
                <Button type="button" disabled={requesting || requested.includes(selected.id)}
                  className="rounded-xl bg-blue-600" onClick={() => void sendReviewRequest()}>
                  {requested.includes(selected.id) ? t.reviewRequested : requesting ? t.reviewPending : t.reviewRequest}
                </Button>
                <Button asChild variant="outline" className="rounded-xl"><Link href={reportHref}>{t.report}<ArrowRight className="size-4" /></Link></Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
