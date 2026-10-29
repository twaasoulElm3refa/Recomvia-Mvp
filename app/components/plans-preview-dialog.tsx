"use client";

import { ArrowRight, Check, X } from "lucide-react";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PLAN_CATALOG } from "@/lib/plans";
import type { SiteLocale } from "@/lib/site-locale";

const copy = {
  en: {
    trigger: "View plans",
    title: "Find the right plan",
    description: "Compare what each plan includes without leaving your scan.",
    included: "What you get",
    fullPlan: "See full plan",
    close: "Close plans",
    free: "Free access",
    oneTime: "One-time payment",
    monthly: "Monthly subscription",
  },
  ar: {
    trigger: "عرض الباقات",
    title: "اختر الباقة المناسبة",
    description: "تعرّف بسرعة على ما تتضمنه كل باقة دون مغادرة الفحص.",
    included: "ما الذي تحصل عليه",
    fullPlan: "عرض تفاصيل الباقة",
    close: "إغلاق الباقات",
    free: "مجاني",
    oneTime: "دفعة واحدة",
    monthly: "اشتراك شهري",
  },
} as const;

export function PlansPreviewDialog({ locale }: { locale: SiteLocale }) {
  const t = copy[locale];
  const billingLabel = {
    free: t.free,
    one_time: t.oneTime,
    monthly: t.monthly,
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-14 w-full rounded-2xl border-blue-200 bg-white px-6 text-base font-bold text-blue-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800 sm:w-auto"
        >
          {t.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent
        dir={locale === "ar" ? "rtl" : "ltr"}
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto rounded-[24px] border-slate-200 bg-white p-5 shadow-[0_32px_90px_rgba(7,17,31,.24)] sm:max-w-2xl sm:p-7"
      >
        <DialogClose className="absolute end-4 top-4 grid size-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={t.close}>
          <X className="size-5" aria-hidden="true" />
        </DialogClose>
        <DialogHeader className="pe-10 text-start">
          <DialogTitle className="text-2xl font-extrabold tracking-tight text-[#07111f]">{t.title}</DialogTitle>
          <DialogDescription className="leading-6 text-slate-600">{t.description}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="free" className="mt-2 gap-5">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
            {PLAN_CATALOG.map((plan) => (
              <TabsTrigger
                key={plan.id}
                value={plan.id}
                className="min-h-10 min-w-[5.5rem] shrink-0 rounded-lg px-3 font-bold data-[state=active]:text-blue-700"
              >
                {plan.name[locale]}
              </TabsTrigger>
            ))}
          </TabsList>
          {PLAN_CATALOG.map((plan) => (
            <TabsContent key={plan.id} value={plan.id} className="mt-0">
              <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-white p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-xl font-extrabold text-[#07111f]">{plan.name[locale]}</h3>
                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">{plan.description[locale]}</p>
                  </div>
                  <div className="shrink-0 sm:text-end">
                    <strong className="text-3xl font-extrabold tracking-tight text-[#07111f]" dir="ltr">{plan.price.amount}</strong>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{billingLabel[plan.billing]}</p>
                  </div>
                </div>
                <div className="mt-5 border-t border-blue-100 pt-5">
                  <p className="text-xs font-extrabold uppercase tracking-wider text-blue-700">{t.included}</p>
                  <ul className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
                    {plan.features.map((feature) => (
                      <li key={feature.en} className="flex gap-2 text-sm leading-6 text-slate-700">
                        <Check className="mt-1 size-4 shrink-0 text-blue-600" aria-hidden="true" />
                        <span>{feature[locale]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <Button asChild className="mt-5 h-12 w-full rounded-xl bg-blue-600 font-bold hover:bg-blue-700">
                <Link href="/subscriptions">
                  {t.fullPlan}
                  <ArrowRight className={`size-4 ${locale === "ar" ? "rotate-180" : ""}`} aria-hidden="true" />
                </Link>
              </Button>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
