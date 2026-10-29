"use client";

import { ArrowRight, Check, Coins, Layers3 } from "lucide-react";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { PublicShell, type LocalizedMetadata } from "@/app/components/public-shell";
import { Button } from "@/components/ui/button";
import { PLAN_CATALOG } from "@/lib/plans";

const pageMetadata: LocalizedMetadata = {
  en: { title: "Recomvia Pricing — Reports, Monitoring & Fix Credits", description: "One free score, a $4.99 initial report, and monthly plans at $24, $49 and $99. Compare detailed and advanced analysis for one or three projects." },
  ar: { title: "باقات Recomvia — التقارير والمتابعة ونقاط الإصلاح", description: "فحص مجاني، وتقرير مبدئي بسعر 4.99 دولار، واشتراكات شهرية بسعر 24 و49 و99 دولارًا لمشروع واحد أو ثلاثة مشروعات." },
};
const copy = {
  en: {
    eyebrow: "Plans & pricing", title: "Understand your visibility. Choose your next step.",
    intro: "Start with one free analysis. Unlock an initial report, or choose deeper analysis and recurring monitoring for your projects.",
    recommended: "Advanced insight", start: "Get my free score", unlockStarter: "Unlock a report — $4.99",
    subscribeEssential: "Subscribe — $24/month", subscribeGrowth: "Subscribe — $49/month", subscribePro: "Subscribe — $99/month",
    compare: "Compare the plans", feature: "Included scope", projects: "Projects", depth: "Report depth",
    depths: { summary: "Headline numbers", starter: "Initial report", detailed: "Detailed", advanced: "Very advanced" },
    monitoring: "Recurring monitoring & history", credits: "Fix Center & credit eligibility", yes: "Included", no: "Not included", separate: "Credits sold separately",
    projectNote: "A project can be a website, brand, personal brand or topic. Indicators adapt to the subject; a missing website audit is marked not applicable.",
    creditsTitle: "Fix Credits", creditsText: "An active Essential, Growth or Pro subscription makes you eligible to purchase and use Fix Credits. Every fix shows its scope and credit cost before approval. Credits are not included in the subscription; human expert services are priced separately.",
    creditRequest: "Ask about Fix Credits", creditNotice: "Credit purchasing will open when the credit catalog and execution workflows are ready. Purchased balances remain subject to the published validity policy when a subscription ends; use resumes with an active subscription.",
    differenceTitle: "Choose depth, then project count", difference: "Essential provides detailed diagnosis and monitoring. Growth adds deeper comparisons, citation analysis and content gaps for one project. Pro gives each of three projects the full Growth experience, with consolidated management.",
    saved: "Opening a saved report does not run a new analysis. Starter unlocks the initial scan; it does not include a fresh deep scan or recurring monitoring.",
    billing: "Billing and credit policy", allUsd: "All prices in USD. Monthly prices are for one month, without an annual commitment.",
  },
  ar: {
    eyebrow: "الباقات والأسعار", title: "افهم ظهورك. واختر خطوتك التالية.",
    intro: "ابدأ بتحليل مجاني واحد. افتح التقرير المبدئي، أو اختر تحليلًا أعمق ومتابعة دورية لمشروعاتك.",
    recommended: "تحليل متقدم", start: "ابدأ الفحص المجاني", unlockStarter: "افتح تقريرًا — 4.99$",
    subscribeEssential: "اشترك — 24$/شهريًا", subscribeGrowth: "اشترك — 49$/شهريًا", subscribePro: "اشترك — 99$/شهريًا",
    compare: "قارن الباقات", feature: "نطاق الباقة", projects: "المشروعات", depth: "عمق التقرير",
    depths: { summary: "الأرقام الرئيسية", starter: "تقرير مبدئي", detailed: "تفصيلي", advanced: "متقدم جدًا" },
    monitoring: "المتابعة الدورية وسجل النتائج", credits: "مركز الإصلاح وأهلية شراء النقاط", yes: "مشمول", no: "غير مشمول", separate: "تُشترى النقاط منفصلة",
    projectNote: "المشروع يمكن أن يكون موقعًا أو علامة تجارية أو علامة شخصية أو موضوعًا. تتكيف المؤشرات مع نوعه؛ الفحص التقني غير المنطبق يظهر «غير منطبق».",
    creditsTitle: "نقاط الإصلاح — Fix Credits", creditsText: "يتيح اشتراك Essential أو Growth أو Pro النشط شراء واستخدام نقاط الإصلاح. يظهر نطاق كل إصلاح وتكلفته قبل موافقتك. النقاط غير مشمولة في سعر الاشتراك، والخدمات البشرية تُسعّر منفصلة.",
    creditRequest: "الاستفسار عن نقاط الإصلاح", creditNotice: "يُفتح شراء النقاط عند جاهزية كتالوج الإصلاحات ومسار تنفيذها. يبقى الرصيد المشترى وفق سياسة الصلاحية المعلنة عند انتهاء الاشتراك، ويُستأنف استخدامه مع اشتراك نشط.",
    differenceTitle: "اختر عمق التحليل ثم عدد المشروعات", difference: "تقدم Essential تشخيصًا تفصيليًا ومتابعة. تضيف Growth مقارنة أعمق وتحليل الاستشهادات وفجوات المحتوى لمشروع واحد. وتمنح Pro كل مشروع من المشروعات الثلاثة كامل تجربة Growth، مع إدارة موحدة.",
    saved: "فتح تقرير محفوظ لا يشغّل تحليلًا جديدًا. تفتح Starter بيانات الفحص الأولي، ولا تشمل فحصًا عميقًا جديدًا أو متابعة دورية.",
    billing: "سياسة الفوترة والنقاط", allUsd: "جميع الأسعار بالدولار الأميركي. الأسعار الشهرية لشهر واحد دون التزام سنوي.",
  },
} as const;

export function PricingContent() {
  return <PublicShell pageMetadata={pageMetadata}>{(locale) => {
    const t = copy[locale];
    return <main>
      <section className="relative overflow-hidden border-b border-slate-200">
        <div className="signal-grid absolute inset-0" />
        <div className="relative mx-auto max-w-4xl px-5 py-16 text-center sm:px-8 sm:py-24">
          <p className="text-sm font-bold uppercase tracking-[.16em] text-blue-600">{t.eyebrow}</p>
          <h1 className="mt-4 text-4xl font-extrabold tracking-[-.045em] sm:text-6xl">{t.title}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">{t.intro}</p>
          <p className="mt-4 text-xs leading-6 text-slate-500">{t.allUsd}</p>
        </div>
      </section>
      <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
        <div className="grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-5">
          {PLAN_CATALOG.map((plan) => {
            const highlighted = plan.id === "growth";
            const action = plan.id === "free" ? { href: "/", label: t.start }
              : plan.id === "starter" ? { href: "/dashboard", label: t.unlockStarter }
              : { href: `/subscriptions?plan=${plan.id}`, label: plan.id === "essential" ? t.subscribeEssential : plan.id === "growth" ? t.subscribeGrowth : t.subscribePro };
            return <article id={plan.id} key={plan.id} className={`relative flex scroll-mt-24 flex-col rounded-3xl border p-6 ${highlighted ? "border-blue-600 bg-[#07111f] text-white ring-4 ring-blue-100" : "border-slate-200 bg-white"}`}>
              {highlighted && <span className="absolute -top-3 start-5 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">{t.recommended}</span>}
              <h2 className="text-xl font-extrabold">{plan.name[locale]}</h2>
              {locale === "ar" && <p className={`mt-1 text-xs ${highlighted ? "text-slate-400" : "text-slate-500"}`} lang="en">{plan.name.en}</p>}
              <div className="mt-5"><strong className="inline-block text-4xl font-extrabold tracking-tight" dir="ltr">{plan.price.amount}</strong><p className={`mt-2 text-xs ${highlighted ? "text-slate-400" : "text-slate-500"}`}>{plan.price.cadence[locale]}</p></div>
              <p className={`mt-5 min-h-16 text-sm leading-7 ${highlighted ? "text-slate-300" : "text-slate-600"}`}>{plan.description[locale]}</p>
              <ul className="my-6 flex-1 space-y-4">{plan.features.map((feature) => <li key={feature.en} className="flex gap-2 text-sm leading-6"><Check className={`mt-1 size-4 shrink-0 ${highlighted ? "text-cyan-300" : "text-blue-600"}`} aria-hidden="true" /><span>{feature[locale]}</span></li>)}</ul>
              <Button asChild className={`h-auto min-h-11 w-full whitespace-normal rounded-xl px-3 py-3 font-bold ${highlighted ? "bg-white text-[#07111f] hover:bg-slate-100" : "bg-blue-600 text-white hover:bg-blue-700"}`}><Link href={action.href}>{action.label}<ArrowRight className="size-4 shrink-0 rtl:rotate-180" /></Link></Button>
            </article>;
          })}
        </div>
        <p className="mt-6 text-sm leading-7 text-slate-500">{t.projectNote}</p>
        <div className="mt-12 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
          <h2 className="text-2xl font-extrabold">{t.compare}</h2>
          <div className="mt-6 overflow-x-auto rounded-xl" role="region" tabIndex={0} aria-label={t.compare}>
            <table className="w-full min-w-[720px] text-start text-sm">
              <caption className="sr-only">{t.compare}</caption>
              <thead><tr className="bg-slate-50"><th scope="col" className="p-4 text-start">{t.feature}</th>{PLAN_CATALOG.map((plan) => <th scope="col" key={plan.id} className="p-4 text-start">{plan.name[locale]}<span dir="ltr" className="mt-1 block font-normal text-slate-500">{plan.price.amount}</span></th>)}</tr></thead>
              <tbody>{[
                { label: t.projects, values: PLAN_CATALOG.map((plan) => String(plan.projectLimit)) },
                { label: t.depth, values: PLAN_CATALOG.map((plan) => t.depths[plan.reportLevel]) },
                { label: t.monitoring, values: PLAN_CATALOG.map((plan) => plan.billing === "monthly" ? t.yes : t.no) },
                { label: t.credits, values: PLAN_CATALOG.map((plan) => plan.billing === "monthly" ? t.separate : t.no) },
              ].map((row) => <tr key={row.label} className="border-t border-slate-100"><th scope="row" className="p-4 text-start font-semibold">{row.label}</th>{row.values.map((value, i) => <td key={PLAN_CATALOG[i].id} className="p-4 leading-6 text-slate-600">{value}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <p className="mt-5 text-sm leading-7 text-slate-500">{t.saved}</p>
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl bg-[#07111f] p-7 text-white"><Coins className="size-7 text-cyan-300" aria-hidden="true" /><h2 className="mt-4 text-2xl font-extrabold">{t.creditsTitle}</h2><p className="mt-4 text-sm leading-7 text-slate-300">{t.creditsText}</p><p className="mt-4 text-xs leading-6 text-slate-400">{t.creditNotice}</p><Button asChild className="mt-6 rounded-xl bg-white text-[#07111f] hover:bg-slate-100"><Link href="/contact?product=fix-credits">{t.creditRequest}</Link></Button></section>
          <section className="rounded-3xl border border-slate-200 p-7"><Layers3 className="size-7 text-blue-600" aria-hidden="true" /><h2 className="mt-4 text-2xl font-extrabold">{t.differenceTitle}</h2><p className="mt-4 text-sm leading-8 text-slate-600">{t.difference}</p><Link href="/billing-policy" className="mt-6 inline-flex text-sm font-bold text-blue-700 underline underline-offset-4">{t.billing}</Link></section>
        </div>
      </section>
    </main>;
  }}</PublicShell>;
}
