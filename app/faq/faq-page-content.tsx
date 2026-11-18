import { NavigationLink as Link } from "@/app/components/navigation-link";
import { ArrowRight, BookOpen, Bot, Headphones, ShieldCheck } from "lucide-react";
import { PublicShell } from "@/app/components/public-shell";
import { Card, CardContent } from "@/components/ui/card";
import { faqEntries } from "@/lib/knowledge-base";
import { SITE_URL } from "@/lib/articles";
import { FaqExplorer } from "./faq-explorer";

export function FaqPageContent({ initialLocale = "en" }: { initialLocale?: "en" | "ar" }) {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}${initialLocale === "ar" ? "/ar/faq" : "/faq"}#faq-page`,
    name: initialLocale === "ar" ? "الأسئلة الشائعة عن Recomvia" : "Recomvia frequently asked questions",
    url: `${SITE_URL}${initialLocale === "ar" ? "/ar/faq" : "/faq"}`,
    inLanguage: initialLocale,
    mainEntity: faqEntries.map((entry) => ({
      "@type": "Question",
      inLanguage: initialLocale,
      name: initialLocale === "ar" ? entry.questionAr : entry.question,
      acceptedAnswer: {
        "@type": "Answer",
        inLanguage: initialLocale,
        text: initialLocale === "ar" ? entry.answerAr : entry.answer,
      },
    })),
  };
  const publicEntries = faqEntries.map(({ id, category, question, answer, questionAr, answerAr }) => ({ id, category, question, answer, questionAr, answerAr }));

  return (
    <PublicShell initialLocale={initialLocale}>
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, "\\u003c") }} />
        <section className="relative overflow-hidden border-b border-slate-200 bg-[#07111f] text-white">
          <div className="signal-grid absolute inset-0 opacity-20" />
          <div className="relative mx-auto grid max-w-[1240px] gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1fr_.72fr] lg:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[.16em] text-cyan-300">{initialLocale === "ar" ? "مركز مساعدة Recomvia" : "Recomvia Help Center"}</p>
              <h1 className="mt-4 max-w-3xl text-4xl font-extrabold tracking-[-.05em] sm:text-6xl">{initialLocale === "ar" ? "إجابات موثقة يمكن التحقق منها." : "Answers you can verify."}<br /><span className="text-cyan-300">{initialLocale === "ar" ? "ومساعدة بشرية عند الحاجة." : "A human when you need one."}</span></h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">{initialLocale === "ar" ? "ابحث بالعربية أو الإنجليزية في الأسئلة الموثقة عن القياس والتقارير والأسعار والتحسين، أو اسأل المساعد الموجود أسفل الصفحة." : "Search documented answers about measurement, reports, subscriptions and optimization, or ask the assistant below."}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {[
                [ShieldCheck, `${faqEntries.length} ${initialLocale === "ar" ? "إجابة موثقة" : "verified answers"}`, initialLocale === "ar" ? "دون ادعاءات غير موثقة" : "No unsupported claims"],
                [BookOpen, initialLocale === "ar" ? "12 دليلًا بحثيًا" : "12 research guides", initialLocale === "ar" ? "يبحث فيها المساعد أيضًا" : "Also searched by the assistant"],
                [Headphones, initialLocale === "ar" ? "تحويل إلى الدعم البشري" : "Human handoff", initialLocale === "ar" ? "تذكرة خاصة ورد قابل للمتابعة" : "Private ticket and tracked reply"],
              ].map(([Icon, title, text]) => (
                <div key={title as string} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.06] p-4 backdrop-blur-sm"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-cyan-300"><Icon className="size-5" /></span><div><p className="text-sm font-extrabold">{title as string}</p><p className="mt-1 text-xs text-slate-400">{text as string}</p></div></div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1000px] px-5 py-16 sm:px-8 sm:py-20">
          <div className="mb-8 text-center"><p className="text-sm font-bold uppercase tracking-[.14em] text-blue-600">{initialLocale === "ar" ? "الأسئلة الشائعة" : "Frequently asked questions"}</p><h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{initialLocale === "ar" ? "اعثر على إجابة موثقة." : "Find the documented answer."}</h2><p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-500">{initialLocale === "ar" ? "كل إجابة أدناه جزء من قاعدة المعرفة التي يستخدمها مساعد Recomvia." : "Every answer below is part of the knowledge source used by the Recomvia Assistant."}</p></div>
          <FaqExplorer entries={publicEntries} initialLocale={initialLocale} />
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-[1000px] gap-5 px-5 py-12 sm:px-8 md:grid-cols-2">
            <Card className="rounded-[24px] border-blue-200 bg-blue-50/50 py-0 shadow-none"><CardContent className="p-6"><Bot className="size-5 text-blue-600" /><h2 className="mt-5 text-xl font-extrabold">{initialLocale === "ar" ? "تحتاج إلى إجابة محددة؟" : "Need a specific answer?"}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{initialLocale === "ar" ? "افتح مساعد Recomvia أدناه للبحث في الأسئلة والأبحاث من دون اختلاق إجابات." : "Open “Ask Recomvia” below. It searches both this FAQ and the research library without inventing an answer."}</p></CardContent></Card>
            <Link href={initialLocale === "ar" ? "/ar/blog" : "/blog"} className="group rounded-[24px] border border-slate-200 p-6 transition hover:border-blue-300"><BookOpen className="size-5 text-violet-600" /><h2 className="mt-5 text-xl font-extrabold">{initialLocale === "ar" ? "استكشف مكتبة الأبحاث" : "Explore the research library"}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{initialLocale === "ar" ? "اقرأ أدلة تفصيلية قائمة على الأدلة عن الظهور في الذكاء الاصطناعي والاستشهادات والكيانات والاكتشاف التقني." : "Read detailed, evidence-led guides about AI visibility, AEO, GEO, citations, entities, and technical discovery."}</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-blue-700">{initialLocale === "ar" ? "عرض الأدلة" : "View all guides"} <ArrowRight className="size-4 transition group-hover:translate-x-1" /></span></Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
