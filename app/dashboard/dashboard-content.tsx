"use client";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { AppShell, StatusPill } from "@/app/components/app-shell";
import { Button } from "@/components/ui/button";
import { useSiteLocale } from "@/hooks/use-site-locale";
import type { StoredScan } from "@/db/product";

type ScanRow = Pick<
  StoredScan,
  | "id"
  | "status"
  | "target"
  | "displayName"
  | "createdAt"
  | "readinessScore"
  | "actualVisibilityScore"
>;
export function DashboardContent({
  displayName,
  latest,
  scans,
}: {
  displayName: string;
  latest: StoredScan | null;
  scans: ScanRow[];
}) {
  const ar = useSiteLocale() === "ar";
  const t = (en: string, arabic: string) => (ar ? arabic : en);
  const kinds = {
    website: t("Website", "موقع"),
    person: t("Personal brand", "علامة شخصية"),
    brand: t("Brand", "علامة"),
    topic: t("Topic", "موضوع"),
  };
  return (
    <AppShell
      title={t("Visibility workspace", "مساحة الظهور")}
      description={t(
        "Your websites, personal brands and topic explorations in one place.",
        "مواقعك وعلاماتك الشخصية واستكشاف الموضوعات في مكان واحد.",
      )}
      workspaceLabel={displayName}
      userInitial={displayName}
      siteLabel={
        latest?.target?.name ||
        latest?.displayName ||
        t("Start an analysis", "ابدأ تحليلًا")
      }
      action={
        <Button asChild className="rounded-xl bg-blue-600">
          <Link href="/">{t("New analysis", "تحليل جديد")}</Link>
        </Button>
      }
    >
      {latest ? (
        <div className="grid gap-5 md:grid-cols-3">
          {[
            [
              t("Latest target", "آخر تحليل"),
              latest.target?.name || latest.displayName,
              kinds[latest.target?.kind || "website"],
            ],
            [
              latest.methodologyVersion.startsWith("entity-")
                ? t("Sample mention rate", "نسبة الذكر في العينة")
                : t("Legacy visibility index", "مؤشر الظهور السابق"),
              latest.target?.kind === "topic"
                ? "—"
                : latest.actualVisibilityScore == null
                  ? "—"
                  : `${latest.actualVisibilityScore}${latest.methodologyVersion.startsWith("entity-") ? "%" : "/100"}`,
              latest.target?.kind === "topic"
                ? t(
                    "Topic exploration has no brand score",
                    "استكشاف الموضوع دون درجة علامة",
                  )
                : t(
                    "Open the report for sample size and evidence",
                    "افتح التقرير لحجم العينة والأدلة",
                  ),
            ],
            [
              t("Website readiness", "جاهزية الموقع"),
              latest.readinessScore == null
                ? t("N/A", "غير منطبق")
                : `${latest.readinessScore}/100`,
              t(
                "Separate from observed visibility",
                "مستقلة عن الظهور المرصود",
              ),
            ],
          ].map(([label, value, note]) => (
            <div
              key={label}
              className="rounded-3xl border border-slate-200 bg-white p-6"
            >
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-5 break-words text-3xl font-extrabold">
                {value}
              </p>
              <p className="mt-3 text-xs leading-6 text-slate-500">{note}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <h2 className="text-xl font-extrabold">
            {t(
              "Start with a URL, name, brand or topic",
              "ابدأ برابط أو اسم أو علامة أو موضوع",
            )}
          </h2>
          <p className="mt-3 text-sm text-slate-500">
            {t(
              "Your completed analyses and evidence will appear here.",
              "ستظهر تحليلاتك المكتملة وأدلتها هنا.",
            )}
          </p>
        </div>
      )}
      {latest && (
        <Button asChild className="mt-5 rounded-xl bg-[#07111f]">
          <Link href={`/report?scan=${encodeURIComponent(latest.id)}`}>
            {t(
              "Open the latest report & recommendations",
              "افتح أحدث تقرير وتوصياته",
            )}
          </Link>
        </Button>
      )}
      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-extrabold">
          {t("Recent analyses", "التحليلات الأخيرة")}
        </h2>
        <div className="mt-5 space-y-3">
          {scans.map((scan) => (
            <Link
              key={scan.id}
              href={
                scan.status === "awaiting_identity"
                  ? `/?resume=${encodeURIComponent(scan.id)}`
                  : `/report?scan=${encodeURIComponent(scan.id)}`
              }
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 hover:border-blue-300"
            >
              <div>
                <p className="font-bold">
                  {scan.target?.name || scan.displayName}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {scan.createdAt} UTC · {kinds[scan.target?.kind || "website"]}
                </p>
              </div>
              <StatusPill tone={scan.status === "completed" ? "good" : "warn"}>
                {scan.status === "completed"
                  ? t("Completed", "مكتمل")
                  : scan.status === "awaiting_identity"
                    ? t("Confirm identity", "تأكيد الهوية")
                    : scan.status === "needs_clarification"
                      ? t("Clarification needed", "يحتاج توضيحًا")
                      : scan.status === "failed"
                        ? t("Incomplete", "غير مكتمل")
                        : t("Running", "قيد التنفيذ")}
              </StatusPill>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
