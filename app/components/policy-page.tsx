"use client";

import { NavigationLink as Link } from "@/app/components/navigation-link";
import { PublicShell, type LocalizedMetadata } from "@/app/components/public-shell";
import type { SiteLocale } from "@/lib/site-locale";

type PolicyParagraph = string | { before: string; link: string; after: string };

export type PolicyCopy = {
  metadata: { title: string; description: string };
  eyebrow: string;
  title: string;
  intro: string;
  effective: string;
  sections: { title: string; paragraphs: PolicyParagraph[] }[];
};

export function PolicyPage({ copy }: { copy: Record<SiteLocale, PolicyCopy> }) {
  const pageMetadata: LocalizedMetadata = { en: copy.en.metadata, ar: copy.ar.metadata };
  return <PublicShell pageMetadata={pageMetadata}>{locale => {
    const t = copy[locale];
    return <main>
      <section className="border-b border-slate-200 bg-[#07111f] text-white"><div className="mx-auto max-w-[920px] px-5 py-16 sm:px-8 sm:py-20"><p className="text-sm font-bold uppercase tracking-[.15em] text-cyan-300">{t.eyebrow}</p><h1 className="mt-4 text-4xl font-extrabold tracking-[-.045em] sm:text-5xl">{t.title}</h1><p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">{t.intro}</p><p className="mt-6 text-xs font-semibold text-slate-500">{t.effective}</p></div></section>
      <article className="mx-auto max-w-[920px] space-y-10 px-5 py-16 text-base leading-8 text-slate-700 sm:px-8">{t.sections.map(section => <section key={section.title}><h2 className="text-2xl font-extrabold tracking-[-.025em] text-[#07111f]">{section.title}</h2><div className="mt-4 space-y-4">{section.paragraphs.map((paragraph, index) => <p key={index}>{typeof paragraph === "string" ? paragraph : <>{paragraph.before}<Link href="/contact" className="font-bold text-blue-700">{paragraph.link}</Link>{paragraph.after}</>}</p>)}</div></section>)}</article>
    </main>;
  }}</PublicShell>;
}
