"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Globe2 } from "lucide-react";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { BrandMark } from "@/app/scan-experience";
import { KnowledgeAssistant } from "@/app/components/knowledge-assistant";
import { MobileSiteMenu, type SiteNavItem } from "@/app/components/mobile-site-menu";
import { Button } from "@/components/ui/button";
import { readStoredSiteLocale, SITE_LOCALE_EVENT, storeSiteLocale, type SiteLocale } from "@/lib/site-locale";

const copy = {
  en: {
    menu: "Main navigation",
    navigation: ["Platform", "Subscriptions", "Blog", "Methodology", "FAQ", "Contact"],
    score: "Run free score",
    intro: "Recomvia measures how AI systems find, understand, cite, and recommend brands, then turns evidence into prioritized improvements.",
    platform: "Platform",
    overview: "Overview",
    report: "Sample report",
    fixes: "Fix Center",
    resources: "Resources",
    faq: "FAQ & help",
    company: "Company",
    privacy: "Privacy",
    terms: "Terms",
    billing: "Billing policy",
    copyright: "© 2026 Recomvia. No guaranteed AI recommendation or citation.",
  },
  ar: {
    menu: "القائمة الرئيسية",
    navigation: ["المنصة", "الاشتراكات", "المدونة", "المنهجية", "الأسئلة الشائعة", "اتصل بنا"],
    score: "ابدأ الفحص المجاني",
    intro: "تقيس Recomvia كيف تكتشف أنظمة الذكاء الاصطناعي العلامة وتفهمها وتستشهد بها وتوصي بها، ثم تحوّل الأدلة إلى تحسينات مرتبة حسب الأولوية.",
    platform: "المنصة",
    overview: "نظرة عامة",
    report: "نموذج التقرير",
    fixes: "مركز الإصلاح",
    resources: "المصادر",
    faq: "الأسئلة الشائعة والمساعدة",
    company: "الشركة",
    privacy: "الخصوصية",
    terms: "الشروط",
    billing: "سياسة الدفع",
    copyright: "© 2026 Recomvia. لا نضمن توصية أو استشهادًا تتحكم فيه أنظمة خارجية.",
  },
} as const;

const navigationHrefs = ["/#product", "/pricing", "/blog", "/methodology", "/faq", "/contact"] as const;

export type LocalizedMetadata = Record<SiteLocale, { title: string; description: string }>;

export function PublicShell({ children, pageMetadata }: { children: ReactNode | ((locale: SiteLocale) => ReactNode); pageMetadata?: LocalizedMetadata }) {
  const [locale, setLocale] = useState<SiteLocale>("en");

  useEffect(() => {
    const syncLocale = () => setLocale(readStoredSiteLocale("en"));
    const timer = window.setTimeout(syncLocale, 0);
    window.addEventListener(SITE_LOCALE_EVENT, syncLocale);
    window.addEventListener("storage", syncLocale);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(SITE_LOCALE_EVENT, syncLocale);
      window.removeEventListener("storage", syncLocale);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    if (!pageMetadata) return;
    const localized = pageMetadata[locale];
    document.title = localized.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    description?.setAttribute("content", localized.description);
    const openGraphTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    openGraphTitle?.setAttribute("content", localized.title);
    const openGraphDescription = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    openGraphDescription?.setAttribute("content", localized.description);
    const twitterTitle = document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]');
    twitterTitle?.setAttribute("content", localized.title);
    const twitterDescription = document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]');
    twitterDescription?.setAttribute("content", localized.description);
  }, [locale, pageMetadata]);

  const t = copy[locale];
  const rtl = locale === "ar";
  const navigation: SiteNavItem[] = navigationHrefs.map((href, index) => ({ href, label: t.navigation[index] }));

  function toggleLocale() {
    const nextLocale = rtl ? "en" : "ar";
    setLocale(nextLocale);
    storeSiteLocale(nextLocale);
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#07111f]">
      <header lang={locale} dir={rtl ? "rtl" : "ltr"} className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="shrink-0"><BrandMark /></Link>
          <nav className="hidden items-center gap-5 text-sm font-semibold text-slate-600 lg:flex" aria-label={t.menu}>
            {navigation.map((item) => <Link key={item.href} href={item.href} className="transition hover:text-blue-700">{item.label}</Link>)}
          </nav>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={toggleLocale}><Globe2 className="size-4" />{rtl ? "EN" : "العربية"}</Button>
            <Button asChild className="hidden rounded-xl bg-[#07111f] font-bold sm:inline-flex"><Link href="/">{t.score}</Link></Button>
            <MobileSiteMenu items={navigation} menuLabel={t.menu} ctaLabel={t.score} direction={rtl ? "rtl" : "ltr"} />
          </div>
        </div>
      </header>
      <div lang={locale} dir={rtl ? "rtl" : "ltr"}>{typeof children === "function" ? children(locale) : children}</div>
      <footer lang={locale} dir={rtl ? "rtl" : "ltr"} className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_repeat(3,.65fr)]">
          <div><BrandMark /><p className="mt-4 max-w-md text-sm leading-6 text-slate-500">{t.intro}</p></div>
          <div><p className="text-sm font-extrabold text-slate-900">{t.platform}</p><nav className="mt-4 flex flex-col gap-3 text-sm font-semibold text-slate-500"><Link href="/dashboard">{t.overview}</Link><Link href="/report">{t.report}</Link><Link href="/fix-center">{t.fixes}</Link></nav></div>
          <div><p className="text-sm font-extrabold text-slate-900">{t.resources}</p><nav className="mt-4 flex flex-col gap-3 text-sm font-semibold text-slate-500"><Link href="/blog">{t.navigation[2]}</Link><Link href="/methodology">{t.navigation[3]}</Link><Link href="/faq">{t.faq}</Link></nav></div>
          <div><p className="text-sm font-extrabold text-slate-900">{t.company}</p><nav className="mt-4 flex flex-col gap-3 text-sm font-semibold text-slate-500"><Link href="/pricing">{t.navigation[1]}</Link><Link href="/contact">{t.navigation[5]}</Link><Link href="/privacy">{t.privacy}</Link><Link href="/terms">{t.terms}</Link><Link href="/billing-policy">{t.billing}</Link></nav></div>
        </div>
        <div className="border-t border-slate-100"><div className="mx-auto max-w-[1240px] px-5 py-5 text-xs text-slate-400 sm:px-8">{t.copyright}</div></div>
      </footer>
      <KnowledgeAssistant />
    </div>
  );
}
