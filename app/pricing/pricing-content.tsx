"use client";

import { ArrowRight, Check, Clock3 } from "lucide-react";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import {
  PublicShell,
  type LocalizedMetadata,
} from "@/app/components/public-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLAN_CATALOG } from "@/lib/plans";

const pageMetadata: LocalizedMetadata = {
  en: {
    title: "Recomvia Plans",
    description: "Choose full report access or preview upcoming Recomvia plans.",
  },
  ar: {
    title: "خطط Recomvia",
    description: "اختر الوصول إلى التقرير الكامل أو استعرض خطط Recomvia القادمة.",
  },
};

const copy = {
  en: {
    eyebrow: "Plans",
    title: "Unlock the complete evidence report",
    intro:
      "Your scores and summary statistics remain available without a paid entitlement. An active Essential plan opens the full stored report.",
    available: "Available",
    comingSoon: "Coming soon",
    choose: "Select Essential",
    notice:
      "Checkout is not connected yet. Selecting Essential opens the current contact flow and does not collect payment.",
  },
  ar: {
    eyebrow: "الخطط",
    title: "افتح تقرير الأدلة الكامل",
    intro:
      "تبقى الدرجات والإحصاءات الملخصة متاحة دون اشتراك مدفوع. تفتح خطة Essential النشطة التقرير الكامل المحفوظ.",
    available: "متاحة",
    comingSoon: "قريبًا",
    choose: "اختر Essential",
    notice:
      "الدفع غير مربوط حاليًا. يفتح اختيار Essential نموذج التواصل الحالي ولا يتم تحصيل أي مبلغ.",
  },
} as const;

export function PricingContent() {
  return (
    <PublicShell pageMetadata={pageMetadata}>
      {(locale) => {
        const t = copy[locale];
        return (
          <main>
            <section className="relative overflow-hidden border-b border-slate-200">
              <div className="signal-grid absolute inset-0" />
              <div className="relative mx-auto max-w-[900px] px-5 py-20 text-center sm:px-8 sm:py-28">
                <p className="text-sm font-bold uppercase tracking-[.16em] text-blue-600">
                  {t.eyebrow}
                </p>
                <h1 className="mt-4 text-4xl font-extrabold tracking-[-.05em] sm:text-6xl">
                  {t.title}
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                  {t.intro}
                </p>
              </div>
            </section>
            <section className="mx-auto max-w-[1120px] px-5 py-16 sm:px-8 sm:py-20">
              <div className="grid gap-5 md:grid-cols-3">
                {PLAN_CATALOG.map((plan) => {
                  const available = plan.availability === "available";
                  return (
                    <Card
                      key={plan.id}
                      className={`relative rounded-[24px] py-0 shadow-none ${
                        available
                          ? "border-blue-600 bg-[#07111f] text-white ring-4 ring-blue-100"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <span
                        className={`absolute -top-3 start-5 rounded-full px-3 py-1 text-[11px] font-bold ${
                          available
                            ? "bg-blue-600 text-white"
                            : "border border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        {available ? t.available : t.comingSoon}
                      </span>
                      <CardHeader className="px-6 pb-0 pt-9">
                        <CardTitle className="text-xl">
                          {plan.name[locale]}
                        </CardTitle>
                        <div className="min-h-14 pt-4">
                          {plan.price ? (
                            <>
                              <strong className="text-4xl tracking-[-.05em]" dir="ltr">
                                {plan.price.amount}
                              </strong>
                              <span
                                className={`ms-2 text-xs ${available ? "text-slate-400" : "text-slate-500"}`}
                              >
                                {plan.price.cadence[locale]}
                              </span>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-500">
                              <Clock3 className="size-4" aria-hidden="true" />
                              {t.comingSoon}
                            </span>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-1 flex-col p-6">
                        <p
                          className={`min-h-14 text-sm leading-7 ${available ? "text-slate-300" : "text-slate-600"}`}
                        >
                          {plan.description[locale]}
                        </p>
                        {available && (
                          <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-200">
                            <Check className="size-4 text-cyan-300" aria-hidden="true" />
                            {plan.description[locale]}
                          </div>
                        )}
                        {available ? (
                          <Button
                            asChild
                            className="mt-8 h-11 w-full rounded-xl bg-white font-bold text-[#07111f] hover:bg-slate-100"
                          >
                            <Link href="/contact">
                              {t.choose}
                              <ArrowRight className="size-4 rtl:rotate-180" />
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            className="mt-8 h-11 w-full rounded-xl"
                            variant="outline"
                            disabled
                          >
                            {t.comingSoon}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">
                {t.notice}
              </p>
            </section>
          </main>
        );
      }}
    </PublicShell>
  );
}
