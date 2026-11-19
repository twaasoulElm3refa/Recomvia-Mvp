import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/app/auth";
import { AppShell } from "@/app/components/app-shell";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { listPendingFixReviews, listFixProposalHistoryForStaff } from "@/db/fix-review";
import { FixProposalHistory } from "@/app/components/fix-proposal-history";
import { safeSourceUrl } from "@/lib/analysis-target";
import { FixProposalForm } from "./proposal-form";

export const dynamic = "force-dynamic";
export const runtime = "edge";
export const metadata: Metadata = {
  title: "Private Fix Review Queue",
  robots: { index: false, follow: false },
};

export default async function FixReviewInboxPage() {
  const user = await requireAuthenticatedUser();
  if (!env.RECOMVIA_ADMIN_USER_ID || env.RECOMVIA_ADMIN_USER_ID !== user.userId) notFound();
  const [requests, proposalHistory] = await Promise.all([
    listPendingFixReviews(),
    listFixProposalHistoryForStaff(user.userId),
  ]);

  return (
    <AppShell
      title="Fix Review Queue · طلبات مراجعة الإصلاح"
      description="Private staff review of customer-requested findings. No approved change, credit charge or external website modification is available on this screen."
    >
      <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
        <strong>Drafting only · إعداد المقترحات فقط.</strong> Staff can save a versioned proposal and rollback plan.
        No draft authorizes implementation, consumes credits or modifies a customer website.
      </div>
      <Link href="/support/inbox" className="mb-6 inline-flex text-sm font-bold text-blue-700 underline">
        Human Support Inbox · صندوق الدعم
      </Link>
      <h2 className="mb-4 text-xl font-extrabold">
        {requests.length} review request(s) · طلبات المراجعة
      </h2>
      {requests.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-7 text-slate-600">
          No review requests yet · لا توجد طلبات مراجعة حاليًا
        </p>
      ) : (
        <div className="space-y-4">
          {requests.map((item) => {
            const source = safeSourceUrl(item.sourceUrl);
            return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex flex-wrap justify-between gap-3">
                  <h3 className="text-lg font-extrabold" dir="auto">{item.findingTitle}</h3>
                  <span className="text-xs font-semibold text-slate-500">{item.severity} · {item.createdAt} UTC</span>
                </div>
                <p className="mt-3 text-sm font-bold text-slate-700" dir="auto">{item.organizationName}</p>
                <p className="mt-1 break-all text-xs text-slate-500" dir="ltr">{item.website}</p>
                <p className="mt-4 text-sm leading-7 text-slate-700" dir="auto">{item.explanation}</p>
                <h4 className="mt-4 text-sm font-extrabold">Recorded evidence · الدليل المحفوظ</h4>
                <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700" dir="auto">
                  {item.evidence || "No evidence excerpt"}
                </p>
                {source && (
                  <a href={source} target="_blank" rel="noopener noreferrer"
                    className="mt-3 inline-block break-all text-sm font-semibold text-blue-700 underline">
                    Original source · المصدر الأصلي
                  </a>
                )}
                <p className="mt-3 text-xs font-bold text-slate-500">{item.status} · Version {item.proposalVersion ?? 0}</p>
                {item.proposedText && (
                  <p className="mt-3 whitespace-pre-wrap rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-7 text-blue-900" dir="auto">
                    {item.proposedText}
                  </p>
                )}
                <FixProposalHistory
                  entries={proposalHistory.filter((entry) => entry.fixId === item.id)}
                  locale="en"
                />
                <FixProposalForm fixId={item.id} currentVersion={item.proposalVersion} />
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
