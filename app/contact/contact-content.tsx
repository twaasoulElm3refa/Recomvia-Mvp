"use client";

import { Bot, Headphones, MessagesSquare, ShieldCheck } from "lucide-react";
import { PublicShell, type LocalizedMetadata } from "@/app/components/public-shell";
import { ContactForm } from "./contact-form";
import { SITE_URL } from "@/lib/articles";

const pageMetadata: LocalizedMetadata = {
  en: { title: "Contact Recomvia — Product, Support & Partnerships", description: "Contact Recomvia about AI visibility analysis, subscriptions, Fix Credits, expert services, technical support, partnerships, or media enquiries." },
  ar: { title: "اتصل بـ Recomvia — المنتج والدعم والشراكات", description: "تواصل مع Recomvia بشأن تحليل AI Visibility والاشتراكات وFix Credits وخدمات الخبراء والدعم التقني والشراكات أو الاستفسارات الإعلامية." },
};

const copy = {
  en: {
    eyebrow: "Contact Recomvia", title: "A direct path to the right answer.", intro: "Contact us about the product, subscriptions, expert services, or technical support, and your message will go directly to the customer service team with a private tracking reference.",
    support: "Human support", need: "Tell us what you need.", supportIntro: "Start with the assistant for an immediate, source-backed answer. If your question needs judgment or account support, use this form and a human will answer through the same secure ticket flow.",
    items: [[Bot, "Knowledge first", "The assistant checks approved FAQs and research."], [Headphones, "Human when needed", "Unsupported questions enter the support inbox."], [ShieldCheck, "Private tracking", "Every request receives a private reference."], [MessagesSquare, "One continuous thread", "The reply appears inside the assistant on this browser."]] as const,
  },
  ar: {
    eyebrow: "اتصل بـ Recomvia", title: "طريق مباشر إلى الإجابة المناسبة.", intro: "تواصل معنا بشأن المنتج أو الاشتراكات أو خدمات الخبراء أو الدعم التقني، وستصل رسالتك مباشرة إلى فريق خدمة العملاء مع رقم متابعة خاص.",
    support: "دعم بشري", need: "أخبرنا بما تحتاج إليه.", supportIntro: "ابدأ بالمساعد لتحصل على إجابة فورية مدعومة بالمصادر. وإذا كان سؤالك يحتاج إلى تقدير بشري أو دعم للحساب، فاستخدم هذا النموذج وسيجيبك أحد أعضاء الفريق عبر مسار التذاكر الآمن نفسه.",
    items: [[Bot, "المعرفة أولًا", "يفحص المساعد الأسئلة الشائعة والأبحاث المعتمدة."], [Headphones, "تدخل بشري عند الحاجة", "تصل الأسئلة غير المدعومة إلى صندوق الدعم."], [ShieldCheck, "متابعة خاصة", "يحصل كل طلب على رقم مرجعي خاص."], [MessagesSquare, "محادثة واحدة متصلة", "يظهر الرد داخل المساعد في هذا المتصفح."]] as const,
  },
} as const;

export function ContactContent() {
  return <PublicShell pageMetadata={pageMetadata}>{locale => {
    const t = copy[locale];
    const schema = { "@context": "https://schema.org", "@type": "ContactPage", name: locale === "ar" ? "اتصل بـ Recomvia" : "Contact Recomvia", url: `${SITE_URL}/contact`, about: { "@id": `${SITE_URL}/#organization` }, inLanguage: locale };
    return <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
      <section className="relative overflow-hidden border-b border-slate-200 bg-[#07111f] text-white"><div className="signal-grid absolute inset-0 opacity-20" /><div className="relative mx-auto max-w-[1000px] px-5 py-16 sm:px-8 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.16em] text-cyan-300">{t.eyebrow}</p><h1 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-.05em] sm:text-6xl">{t.title}</h1><p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">{t.intro}</p></div></section>
      <section className="mx-auto grid max-w-[1080px] gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[.7fr_1.3fr]">
        <div><p className="text-sm font-bold uppercase tracking-[.14em] text-blue-600">{t.support}</p><h2 className="mt-3 text-3xl font-extrabold tracking-tight">{t.need}</h2><p className="mt-4 text-base leading-7 text-slate-600">{t.supportIntro}</p><div className="mt-8 space-y-3">{t.items.map(([Icon, title, description]) => <div key={title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon className="size-4" /></span><div><p className="text-sm font-extrabold text-slate-900">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div></div>)}</div></div>
        <ContactForm locale={locale} />
      </section>
    </main>;
  }}</PublicShell>;
}
