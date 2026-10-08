"use client";

import { NavigationLink as Link } from "@/app/components/navigation-link";
import { ArrowRight, Check, CircleAlert, Coins, Sparkles, UsersRound } from "lucide-react";
import { PublicShell, type LocalizedMetadata } from "@/app/components/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const pageMetadata: LocalizedMetadata = {
  en: { title: "Recomvia Private Beta Pricing", description: "Reserved validation pricing for Recomvia. Checkout is not active during the private beta." },
  ar: { title: "أسعار الإصدار التجريبي الخاص من Recomvia", description: "أسعار تحقق محجوزة لخدمة Recomvia. الدفع غير مفعّل خلال الإصدار التجريبي الخاص." },
};

const copy = {
  en: {
    eyebrow: "Private beta · reserved pricing",
    title: <>Pay for measurement.<br /><span className="gradient-text">Choose what gets fixed.</span></>,
    intro: "Subscription finds the problems. Credits fix them. Experts handle what automation cannot. These prices remain validation hypotheses until live operating costs are measured.",
    featured: "Optimization starts here",
    notice: <><strong>No payment is collected during the private beta.</strong> Starter and Essential open only after live AI-surface evidence, billing safeguards, exact plan limits, and legal terms pass validation.</>,
    creditsTitle: "Fix Credits",
    creditsIntro: "Credits price automated and assisted fixes only. Every action shows its exact cost before execution.",
    creditsRequirement: "An active Essential plan or higher is required to buy or use credits.",
    connectBilling: "Connect billing first",
    expertEyebrow: "Expert services",
    expertTitle: "For work automation should not pretend to do.",
    expertIntro: "Human services are scoped separately and never hidden inside an undefined credit charge.",
    plans: [
      { name: "Starter Report", price: "$4.99", cadence: "reserved price", desc: "Unlock the initial evidence after paid validation opens.", features: ["Full initial findings", "Limited prompt evidence", "1 competitor", "Technical mini audit", "Saved report"], cta: "Join private beta", featured: false },
      { name: "Essential", price: "$19", cadence: "reserved monthly", desc: "The planned minimum active plan required to use optimization.", features: ["1 website", "Full visibility report", "High-intent prompt set", "Issue and recommendation tracking", "Fix Center access", "Post-fix rechecks"], cta: "Join private beta", featured: true },
      { name: "Growth", price: "$39", cadence: "planned", desc: "Waitlisted until real prompt and engine costs establish safe limits.", features: ["Everything in Essential", "Larger prompt set", "More engine surfaces", "2–3 competitors", "Scheduled alerts", "Deeper history"], cta: "Join waitlist", featured: false },
      { name: "Pro", price: "$79", cadence: "planned", desc: "Waitlisted until multilingual and multi-market costs are validated.", features: ["Everything in Growth", "Multiple languages", "Multiple markets", "Advanced analysis", "More competitors", "Exports and history"], cta: "Join waitlist", featured: false },
    ],
    expert: [["Technical AEO/GEO Sprint", "from $99"], ["Content Optimization Sprint", "from $149"], ["Entity Foundation", "from $149"], ["GEO Launch Sprint", "from $299"], ["Managed Growth", "from $199/mo"], ["Managed Authority", "from $499/mo"]],
  },
  ar: {
    eyebrow: "إصدار تجريبي خاص · أسعار محجوزة",
    title: <>ادفع مقابل القياس.<br /><span className="gradient-text">واختر ما تريد إصلاحه.</span></>,
    intro: "يكشف الاشتراك المشكلات. وتعالجها Fix Credits. ويتولى الخبراء ما لا تستطيع الأتمتة إنجازه. تظل هذه الأسعار فرضيات للتحقق إلى أن تُقاس تكاليف التشغيل الفعلية.",
    featured: "يبدأ التحسين من هنا",
    notice: <><strong>لا تُحصّل أي مدفوعات خلال الإصدار التجريبي الخاص.</strong> لن تتاح خطتا Starter وEssential إلا بعد التحقق من أدلة أسطح الذكاء الاصطناعي الفعلية، وضمانات الفوترة، وحدود الخطط الدقيقة، والشروط القانونية.</>,
    creditsTitle: "Fix Credits",
    creditsIntro: "تُستخدم النقاط لتسعير الإصلاحات الآلية والمدعومة فقط. تعرض كل عملية تكلفتها الدقيقة قبل التنفيذ.",
    creditsRequirement: "يلزم اشتراك Essential نشط أو خطة أعلى لشراء النقاط أو استخدامها.",
    connectBilling: "اربط نظام الفوترة أولًا",
    expertEyebrow: "خدمات الخبراء",
    expertTitle: "للأعمال التي لا ينبغي للأتمتة أن تدّعي إنجازها.",
    expertIntro: "تُحدد الخدمات البشرية بنطاق مستقل، ولا تُخفى أبدًا داخل تكلفة نقاط غير محددة.",
    plans: [
      { name: "تقرير Starter", price: "$4.99", cadence: "سعر محجوز", desc: "افتح الأدلة الأولية بعد بدء التحقق المدفوع.", features: ["النتائج الأولية كاملة", "أدلة محدودة للأسئلة", "منافس واحد", "تدقيق تقني مصغّر", "تقرير محفوظ"], cta: "انضم إلى الإصدار التجريبي الخاص", featured: false },
      { name: "Essential", price: "$19", cadence: "شهري محجوز", desc: "الحد الأدنى المخطط للاشتراك النشط اللازم لاستخدام التحسين.", features: ["موقع واحد", "تقرير ظهور كامل", "مجموعة أسئلة عالية النية", "تتبّع المشكلات والتوصيات", "الوصول إلى مركز الإصلاح", "إعادة الفحص بعد الإصلاح"], cta: "انضم إلى الإصدار التجريبي الخاص", featured: true },
      { name: "Growth", price: "$39", cadence: "مخطط", desc: "على قائمة الانتظار حتى تحدد تكاليف الأسئلة والمحركات الفعلية حدودًا آمنة.", features: ["كل ما في Essential", "مجموعة أسئلة أكبر", "أسطح محركات أكثر", "منافسان إلى 3 منافسين", "تنبيهات مجدولة", "سجل أعمق"], cta: "انضم إلى قائمة الانتظار", featured: false },
      { name: "Pro", price: "$79", cadence: "مخطط", desc: "على قائمة الانتظار حتى يجري التحقق من تكاليف تعدد اللغات والأسواق.", features: ["كل ما في Growth", "لغات متعددة", "أسواق متعددة", "تحليل متقدم", "منافسون أكثر", "التصدير والسجل"], cta: "انضم إلى قائمة الانتظار", featured: false },
    ],
    expert: [["حزمة AEO/GEO التقنية", "بدءًا من $99"], ["حزمة تحسين المحتوى", "بدءًا من $149"], ["تأسيس الكيان", "بدءًا من $149"], ["حزمة إطلاق GEO", "بدءًا من $299"], ["نمو مُدار", "بدءًا من $199/شهريًا"], ["سلطة مُدارة", "بدءًا من $499/شهريًا"]],
  },
} as const;

const creditPacks = [["100", "$9.99"], ["300", "$24.99"], ["750", "$49.99"], ["1,600", "$89.99"]];

export function PricingContent() {
  return <PublicShell pageMetadata={pageMetadata}>{locale => {
    const t = copy[locale];
    return <main>
      <section className="relative overflow-hidden border-b border-slate-200"><div className="signal-grid absolute inset-0" /><div className="relative mx-auto max-w-[900px] px-5 py-20 text-center sm:px-8 sm:py-28"><p className="text-sm font-bold uppercase tracking-[.16em] text-blue-600">{t.eyebrow}</p><h1 className="mt-4 text-4xl font-extrabold tracking-[-.05em] sm:text-6xl">{t.title}</h1><p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">{t.intro}</p></div></section>
      <section className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8"><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">{t.plans.map(plan => <Card key={plan.name} className={`relative rounded-[24px] py-0 shadow-none ${plan.featured ? "border-blue-600 bg-[#07111f] text-white ring-4 ring-blue-100" : "border-slate-200 bg-white"}`}>{plan.featured && <span className="absolute -top-3 start-5 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-bold text-white">{t.featured}</span>}<CardHeader className="px-6 pb-0 pt-7"><CardTitle className="text-lg">{plan.name}</CardTitle><div className="pt-4"><strong className="text-4xl tracking-[-.05em]" dir="ltr">{plan.price}</strong><span className={`ms-2 text-xs ${plan.featured ? "text-slate-400" : "text-slate-500"}`}>{plan.cadence}</span></div><p className={`pt-2 text-sm leading-6 ${plan.featured ? "text-slate-400" : "text-slate-600"}`}>{plan.desc}</p></CardHeader><CardContent className="flex flex-1 flex-col p-6"><ul className="flex-1 space-y-3">{plan.features.map(feature => <li key={feature} className="flex items-start gap-2 text-sm"><Check className={`mt-0.5 size-4 shrink-0 ${plan.featured ? "text-cyan-300" : "text-emerald-600"}`} /><span className={plan.featured ? "text-slate-300" : "text-slate-600"}>{feature}</span></li>)}</ul><Button asChild variant={plan.featured ? "default" : "outline"} className={`mt-7 h-11 w-full rounded-xl font-bold ${plan.featured ? "bg-white text-[#07111f] hover:bg-slate-100" : ""}`}><Link href="/contact">{plan.cta}<ArrowRight className="size-4 rtl:rotate-180" /></Link></Button></CardContent></Card>)}</div><div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><CircleAlert className="mt-0.5 size-4 shrink-0" /><p>{t.notice}</p></div></section>
      <section className="border-y border-slate-200 bg-white"><div className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8"><div className="grid gap-10 lg:grid-cols-[.7fr_1.3fr] lg:items-end"><div><span className="grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600"><Coins className="size-6" /></span><h2 className="mt-6 text-3xl font-extrabold tracking-tight">{t.creditsTitle}</h2><p className="mt-3 leading-7 text-slate-600">{t.creditsIntro}</p><div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">{t.creditsRequirement}</div></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{creditPacks.map(([credits, price], i) => <Card key={credits} className={`rounded-[22px] py-0 shadow-none ${i === 2 ? "border-blue-300 bg-blue-50/50" : "border-slate-200"}`}><CardContent className="p-5"><p className="text-3xl font-extrabold" dir="ltr">{credits}</p><p className="mt-1 text-xs text-slate-500">Fix Credits</p><p className="mt-6 text-lg font-bold" dir="ltr">{price}</p><Button variant="outline" className="mt-4 w-full rounded-xl" disabled>{t.connectBilling}</Button></CardContent></Card>)}</div></div></div></section>
      <section className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8"><div className="mb-10 max-w-2xl"><p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[.14em] text-violet-600"><UsersRound className="size-4" />{t.expertEyebrow}</p><h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{t.expertTitle}</h2><p className="mt-4 leading-7 text-slate-600">{t.expertIntro}</p></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{t.expert.map(([name, price]) => <Card key={name} className="rounded-[20px] border-slate-200 py-0 shadow-none"><CardContent className="flex items-center justify-between gap-4 p-5"><div><p className="font-extrabold">{name}</p><p className="mt-1 text-sm text-slate-500">{price}</p></div><Sparkles className="size-5 text-violet-500" /></CardContent></Card>)}</div></section>
    </main>;
  }}</PublicShell>;
}
