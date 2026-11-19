import type { FixProposalHistoryEntry } from "@/db/fix-review";

/** Pure, read-only record of immutable drafts and their decisions. */
export function FixProposalHistory({
  entries, locale,
}: {
  entries: readonly FixProposalHistoryEntry[];
  locale: "ar" | "en";
}) {
  if (!entries.length) return null;
  const ar = locale === "ar";
  return (
    <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-extrabold text-slate-800">
        {ar ? "سجل نسخ المقترح وقراراتها" : "Proposal version and decision history"} ({entries.length})
      </summary>
      <p className="mt-3 text-xs leading-6 text-slate-500">
        {ar
          ? "هذا السجل للقراءة فقط. قبول المقترح للتخطيط لا يسمح بالتنفيذ أو خصم النقاط."
          : "This history is read-only. Accepting a proposal for planning does not authorize execution or charge credits."}
      </p>
      <ol className="mt-4 space-y-4">
        {entries.map((entry) => (
          <li key={entry.proposalId} className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-600">
              <span>{ar ? "النسخة" : "Version"} {entry.version}</span>
              <time dateTime={entry.createdAt}>{entry.createdAt} UTC</time>
            </div>
            <p className="text-xs font-bold text-slate-500">{ar ? "نطاق التعديل" : "Scope"}</p>
            <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-slate-700">{entry.scope}</p>
            <p className="text-xs font-bold text-slate-500">{ar ? "المقترح" : "Proposed change"}</p>
            <p dir="auto" className="whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-sm leading-6 text-slate-700">{entry.proposedText}</p>
            <p className="text-xs font-bold text-slate-500">{ar ? "الأسباب" : "Rationale"}</p>
            <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{entry.rationale}</p>
            <p className="text-xs font-bold text-slate-500">{ar ? "خطة التراجع" : "Rollback plan"}</p>
            <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{entry.rollbackPlan}</p>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-extrabold text-slate-700">
                {entry.decision === "accepted_for_planning"
                  ? ar ? "مقبول لأغراض التخطيط فقط" : "Accepted for planning only"
                  : entry.decision === "changes_requested"
                    ? ar ? "طُلِبت تعديلات" : "Changes requested"
                    : ar ? "بانتظار قرار العميل" : "Awaiting customer decision"}
              </p>
              {entry.decisionAt && <time dateTime={entry.decisionAt} className="mt-1 block text-xs text-slate-500">{entry.decisionAt} UTC</time>}
              {entry.decisionComment && (
                <p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{entry.decisionComment}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
