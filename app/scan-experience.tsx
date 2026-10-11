"use client";

import {
  readStoredSiteLocale,
  storeSiteLocale,
  SITE_LOCALE_EVENT,
} from "@/lib/site-locale";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Globe2,
  Languages,
  Layers3,
  LockKeyhole,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { KnowledgeAssistant } from "@/app/components/knowledge-assistant";
import {
  MobileSiteMenu,
  type SiteNavItem,
} from "@/app/components/mobile-site-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

import type {
  AnalysisTarget,
  IdentityCandidate,
  TargetInput,
} from "@/lib/analysis-target";
import { faqEntries } from "@/lib/knowledge-base";
import { normalizeDisplayText } from "@/lib/answer-text";

type Locale = "en" | "ar";
type ModelContext = {
  registerTool: (
    tool: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};
type LiveScan = {
  id: string;
  readinessScore: number | null;
  target: AnalysisTarget | null;
  confidence: number;
  issueCount: number;
  criticalCount: number;
  actualVisibilityStatus: string;
  actualVisibilityScore: number | null;
  engineRunCount: number;
  categoryScores: Record<string, number>;
  findings: Array<{
    code: string;
    title: string;
    status: string;
    severity: string;
  }>;
};

const text = {
  en: {
    product: "Platform",
    subscriptions: "Subscriptions",
    blog: "Blog",
    methodology: "Methodology",
    faq: "FAQ",
    contact: "Contact",
    signin: "Sign in",
    menu: "Open main menu",
    eyebrow: "AI Visibility Optimization Platform",
    title1: "See how AI",
    title2: "sees you.",
    description:
      "Explore how AI sees your website, business, or personal brand. Discover the names and sources appearing around any topic.",
    placeholder: "Website, person, brand, or topic",
    scan: "Run live visibility scan",
    scanning: "Measuring readiness and visibility",
    scanningSignals:
      "Discovering context, then running evidence-backed engine prompts",
    proof: "Start with a URL or name · Sign in before analysis · No card",
    autoContext:
      "We discover the context and ask you to confirm if a name is ambiguous",
    result: "Live AI Readiness Score",
    issues: "issues detected",
    unlock: "Open evidence report",
    preview:
      "AEO/GEO Readiness and Actual AI Visibility remain separate measurements",
    previewBadge: "Live measurement",
    answer: "Not measured in this scan",
    needsAttention: "Needs attention",
    awaiting: "Awaiting a live scan",
    critical: "critical",
    engineSnapshot: "Actual AI visibility",
    recommendationQuestion: "Was this brand tested inside live AI answers?",
    evidence: "Evidence before advice",
    evidenceText:
      "Every score links to a prompt, engine surface, market, timestamp, and source.",
    safe: "Safe by design",
    safeText:
      "Preview every material change, approve explicitly, and roll back in one step.",
    global: "Built for real markets",
    globalText:
      "Language and country are measured separately — never as translations of one result.",
    action: "From score to action",
    actionText:
      "Subscriptions find problems. Credits fix them. Experts handle what automation cannot.",
    explore: "Explore the platform",
    learnMore: "Learn more",
    statsEyebrow: "Verified product foundation",
    statsTitle: "What is live and inspectable today.",
    statsNote:
      "Only verifiable product facts are shown — no provisional customer or usage claims.",
    stats: [
      "Research guides",
      "Grounded FAQ answers",
      "Methodology dimensions",
      "Interface languages",
    ],
    researchEyebrow: "Recomvia Blog",
    researchTitle: "Practical AI visibility guides.",
    researchIntro:
      "Evidence-led articles designed for discoverability, clear answers, and useful implementation.",
    viewGuides: "View all 12 guides",
    readGuide: "Read guide",
    contactEyebrow: "Talk to Recomvia",
    contactTitle: "Need a product, sales, or expert-services answer?",
    contactText:
      "Ask the grounded assistant first, or send a tracked message directly to our human support team.",
    contactCta: "Contact our team",
    footerIntro:
      "Measure how AI systems find, understand, cite, and recommend your brand, then turn evidence into prioritized improvements.",
    platformGroup: "Platform",
    overview: "Overview",
    sampleReport: "Sample report",
    fixCenter: "Fix Center",
    resourcesGroup: "Resources",
    companyGroup: "Company",
    freeScore: "Free score",
    privacy: "Privacy",
    terms: "Terms",
    billing: "Billing policy",
    copyright: "© 2026 Recomvia. No guaranteed AI recommendation or citation.",
    domainError: "Enter a public website, name, brand or topic.",
    scanError: "Unable to complete the live website scan.",
    axes: [
      "Actual visibility",
      "Authority & entity",
      "Content readiness",
      "Technical AEO",
    ],
    steps: ["Measure", "Explain", "Fix", "Monitor", "Improve"],
  },
  ar: {
    product: "المنصة",
    subscriptions: "الاشتراكات",
    blog: "المدونة",
    methodology: "المنهجية",
    faq: "الأسئلة الشائعة",
    contact: "اتصل بنا",
    signin: "تسجيل الدخول",
    menu: "فتح القائمة الرئيسية",
    eyebrow: "منصة تحسين الظهور في الذكاء الاصطناعي",
    title1: "اعرف كيف يراك",
    title2: "الذكاء الاصطناعي",
    description:
      "اكتشف كيف يرى الذكاء الاصطناعي موقعك أو شركتك أو علامتك الشخصية، وتعرّف إلى الأسماء والمصادر التي تظهر حول أي موضوع.",
    placeholder: "رابط موقع، اسم شخص، علامة، أو موضوع",
    scan: "ابدأ فحص الظهور الحي",
    scanning: "نقيس الجاهزية والظهور",
    scanningSignals: "نكتشف السياق ثم نشغّل أسئلة المحرك المدعومة بالأدلة",
    proof: "ابدأ برابط أو اسم · تسجيل الدخول قبل التحليل · دون بطاقة دفع",
    autoContext: "نكتشف السياق ونطلب التأكيد عند تشابه الأسماء",
    result: "درجة الجاهزية الحية للذكاء الاصطناعي",
    issues: "مشكلة مكتشفة",
    unlock: "افتح تقرير الأدلة",
    preview:
      "تبقى جاهزية AEO/GEO والظهور الفعلي داخل الذكاء الاصطناعي قياسين منفصلين",
    previewBadge: "قياس حي",
    answer: "لم يُقَس في هذا الفحص",
    needsAttention: "يحتاج إلى تحسين",
    awaiting: "بانتظار فحص حي",
    critical: "حرجة",
    engineSnapshot: "الظهور الفعلي داخل الذكاء الاصطناعي",
    recommendationQuestion:
      "هل اختُبرت العلامة داخل إجابات حية لمحركات الذكاء الاصطناعي؟",
    evidence: "الدليل قبل التوصية",
    evidenceText:
      "ترتبط كل درجة بسؤال ومحرك وسوق وتوقيت ومصدر، حتى يفهم العميل سبب النتيجة وما الذي ينبغي تحسينه.",
    safe: "تحسينات آمنة",
    safeText:
      "عاين كل تغيير جوهري، ووافق عليه بوضوح، واستعد النسخة السابقة بخطوة واحدة.",
    global: "مصممة للأسواق الحقيقية",
    globalText:
      "تقاس اللغة والدولة كلٌ على حدة، ولا تعاملان بوصفهما ترجمة لنتيجة واحدة.",
    action: "من الدرجة إلى التنفيذ",
    actionText:
      "الاشتراك يكتشف المشكلات، والنقاط تصلحها، والخبراء يعالجون ما لا تستطيع الأتمتة تنفيذه.",
    explore: "استكشف المنصة",
    learnMore: "اعرف المزيد",
    statsEyebrow: "أساس المنتج الموثق",
    statsTitle: "ما يعمل ويمكن التحقق منه اليوم.",
    statsNote:
      "نعرض حقائق قابلة للتحقق فقط، ولا نستخدم أرقام عملاء أو استخدام افتراضية.",
    stats: ["دليلًا بحثيًا", "إجابة موثقة", "محاور للمنهجية", "لغتان للواجهة"],
    researchEyebrow: "مدونة Recomvia",
    researchTitle: "أدلة عملية لفهم الظهور في الذكاء الاصطناعي.",
    researchIntro:
      "مقالات قائمة على الأدلة، ومهيأة للاكتشاف والإجابات المباشرة والتطبيق العملي.",
    viewGuides: "عرض الأدلة الـ12",
    readGuide: "اقرأ الدليل",
    contactEyebrow: "تواصل مع Recomvia",
    contactTitle: "هل تحتاج إلى إجابة عن المنتج أو الاشتراك أو خدمات الخبراء؟",
    contactText:
      "ابدأ بالمساعد الموثق، أو أرسل رسالة قابلة للمتابعة مباشرة إلى فريق خدمة العملاء.",
    contactCta: "اتصل بفريقنا",
    footerIntro:
      "قِس كيف تكتشف أنظمة الذكاء الاصطناعي علامتك وتفهمها وتستشهد بها وتوصي بها، ثم حوّل الأدلة إلى تحسينات ذات أولوية.",
    platformGroup: "المنصة",
    overview: "نظرة عامة",
    sampleReport: "نموذج التقرير",
    fixCenter: "مركز الإصلاح",
    resourcesGroup: "المصادر",
    companyGroup: "الشركة",
    freeScore: "الفحص المجاني",
    privacy: "الخصوصية",
    terms: "الشروط",
    billing: "سياسة الدفع",
    copyright:
      "© 2026 Recomvia. لا نضمن توصية أو استشهادًا تتحكم فيه أنظمة خارجية.",
    domainError: "أدخل رابط موقع عام أو اسمًا أو علامة أو موضوعًا.",
    scanError: "تعذر إكمال الفحص الحي للموقع.",
    axes: [
      "الظهور الفعلي",
      "السلطة والكيان",
      "جاهزية المحتوى",
      "الجاهزية التقنية",
    ],
    steps: ["نقيس", "نشرح", "نصلح", "نراقب", "نحسن"],
  },
} as const;

const featuredArticles = {
  en: [
    {
      slug: "ai-visibility-optimization-guide",
      title: "AI Visibility Optimization: A Practical Guide for Brands",
      tag: "Strategy",
    },
    {
      slug: "why-ai-does-not-recommend-your-brand",
      title: "Why AI Does Not Recommend Your Brand",
      tag: "Diagnosis",
    },
    {
      slug: "technical-ai-crawlability-checklist",
      title: "Technical AI Crawlability Checklist",
      tag: "Technical",
    },
  ],
  ar: [
    {
      slug: "ai-visibility-optimization-guide",
      title: "تحسين الظهور في الذكاء الاصطناعي: دليل عملي للعلامات التجارية",
      tag: "استراتيجية",
    },
    {
      slug: "why-ai-does-not-recommend-your-brand",
      title: "لماذا لا يوصي الذكاء الاصطناعي بعلامتك التجارية؟",
      tag: "تشخيص",
    },
    {
      slug: "technical-ai-crawlability-checklist",
      title: "قائمة التحقق من قابلية زحف محركات الذكاء الاصطناعي",
      tag: "تقني",
    },
  ],
} as const;

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" aria-label="Recomvia">
      <span className="relative grid size-9 place-items-center overflow-hidden rounded-xl bg-[#07111f] shadow-[0_6px_22px_rgba(37,99,235,.24)]">
        <span className="absolute left-2 top-[9px] size-2 rounded-full bg-[#22d3ee]" />
        <span className="absolute bottom-[9px] left-2 size-2 rounded-full bg-[#6d5dfb]" />
        <span className="absolute left-[15px] top-[11px] h-[15px] w-[10px] rounded-r-full border-r-2 border-t-2 border-white" />
        <span className="absolute left-[17px] top-[18px] h-3 w-0.5 -rotate-45 bg-white" />
      </span>
      {!compact && (
        <span className="text-[1.18rem] font-bold tracking-[-.04em]">
          recomvia
        </span>
      )}
    </div>
  );
}

export function ScanExperience() {
  const [locale, setLocale] = useState<Locale>("en");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "scanning" | "done">("idle");
  const [scanResult, setScanResult] = useState<LiveScan | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<TargetInput["kind"]>("auto");
  const [clarification, setClarification] = useState("");
  const [pending, setPending] = useState<{
    scanId: string;
    candidates: IdentityCandidate[];
  } | null>(null);
  const [needsClarification, setNeedsClarification] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const t = text[locale];
  const rtl = locale === "ar";
  const domain = useMemo(
    () =>
      url
        ? url.replace(/^https?:\/\//, "").replace(/\/$/, "")
        : "yourcompany.com",
    [url],
  );

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
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    return () => {
      document.documentElement.lang = "en";
      document.documentElement.dir = "ltr";
    };
  }, [locale, rtl]);

  const startLiveScan = useCallback(
    async (
      target: string,
      choice?: { scanId: string; candidateId: string },
    ) => {
      const clean = target.trim();
      if (clean.length < 2) throw new Error(text[locale].domainError);
      setError("");
      setNeedsSignIn(false);
      setUrl(clean);
      setStatus("scanning");
      setScanResult(null);
      try {
        const response = await fetch("/api/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            choice || {
              input: clean,
              kind,
              context: clarification,
              language: locale,
            },
          ),
        });
        const data = (await response.json()) as {
          scan?: LiveScan;
          cached?: boolean;
          error?: string;
          code?: string;
          status?: string;
          scanId?: string;
          candidates?: IdentityCandidate[];
        };
        if (response.status === 401) {
          setNeedsSignIn(true);
          try {
            sessionStorage.setItem(
              "recomvia-pending-input",
              JSON.stringify({ input: clean, kind, clarification }),
            );
          } catch {
            /* Optional convenience storage. */
          }
        }
        if (!response.ok) {
          const errors: Record<string, [string, string]> = {
            sign_in: [
              "Sign in to start your analysis.",
              "سجل الدخول لبدء التحليل.",
            ],
            invalid_input: [
              "Enter a public URL, name, brand or topic.",
              "أدخل رابطًا عامًا أو اسمًا أو علامة أو موضوعًا.",
            ],
            scan_limit: [
              "Private beta limit: five analyses per 24 hours.",
              "حد النسخة التجريبية: خمسة تحليلات كل 24 ساعة.",
            ],
            engine_unavailable: [
              "Name and topic analysis is awaiting engine activation. Please try later.",
              "تحليل الأسماء والموضوعات ينتظر تفعيل المحرك. يرجى المحاولة لاحقًا.",
            ],
            engine_failed: [
              "The AI engine is temporarily unavailable. Please try later.",
              "محرك التحليل غير متاح مؤقتًا. يرجى المحاولة لاحقًا.",
            ],
            expired_choice: [
              "This selection expired or is already running. Start a new analysis if needed.",
              "انتهت صلاحية الاختيار أو بدأ تحليله بالفعل. ابدأ تحليلًا جديدًا عند الحاجة.",
            ],
            invalid_choice: [
              "This selection is no longer available.",
              "هذا الاختيار لم يعد متاحًا.",
            ],
          };
          throw new Error(
            errors[data.code || ""]?.[locale === "ar" ? 1 : 0] ||
              text[locale].scanError,
          );
        }
        if (data.status === "needs_confirmation" && data.scanId) {
          setPending({
            scanId: data.scanId,
            candidates: data.candidates || [],
          });
          setNeedsClarification(false);
          setStatus("idle");
          return {
            status: data.status,
            scanId: data.scanId,
            candidates: data.candidates,
          };
        }
        if (data.status === "needs_clarification") {
          setPending(null);
          setNeedsClarification(true);
          setStatus("idle");
          return { status: data.status, scanId: data.scanId };
        }
        if (!data.scan) throw new Error(text[locale].scanError);
        setPending(null);
        setNeedsClarification(false);
        setScanResult(data.scan);
        setStatus("done");
        return {
          status: "completed",
          scanId: data.scan.id,
          readinessScore: data.scan.readinessScore,
          actualVisibilityScore: data.scan.actualVisibilityScore,
          target: data.scan.target,
          cached: Boolean(data.cached),
        };
      } catch (cause) {
        setStatus("idle");
        throw cause;
      }
    },
    [locale, kind, clarification],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(
          sessionStorage.getItem("recomvia-pending-input") || "null",
        );
        if (saved?.input) {
          setUrl(saved.input);
          setKind(saved.kind || "auto");
          setClarification(saved.clarification || "");
          sessionStorage.removeItem("recomvia-pending-input");
        }
      } catch {
        /* Input restoration is optional. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    startLiveScan(url).catch((cause) =>
      setError(cause instanceof Error ? cause.message : t.scanError),
    );
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: "run_live_visibility_scan",
        title: "Analyze a website, name, brand or topic",
        description:
          "Analyze a public URL, person, brand or topic. Ambiguous names require a user choice in the interface. API observations are separate from website readiness.",
        inputSchema: {
          type: "object",
          properties: {
            input: {
              type: "string",
              description: "A public URL, person, brand or topic",
            },
          },
          required: ["input"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => {
          if (!input || typeof input !== "object")
            throw new Error("Input must be an object.");
          const value = input as { input?: unknown };
          if (typeof value.input !== "string")
            throw new Error("input is required.");
          return startLiveScan(value.input);
        },
      },
      { signal: lifecycle.signal },
    );
    Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, [startLiveScan]);

  useEffect(() => {
    const scanId = new URLSearchParams(window.location.search).get("resume");
    if (!scanId) return;
    let cancelled = false;
    fetch(`/api/scans?scan=${encodeURIComponent(scanId)}`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as {
          scan?: {
            status: string;
            id: string;
            targetInput?: TargetInput;
            discovery?: { candidates: IdentityCandidate[] };
          };
        };
        if (
          cancelled ||
          data.scan?.status !== "awaiting_identity" ||
          !data.scan.targetInput
        )
          return;
        setUrl(data.scan.targetInput.input);
        setKind(data.scan.targetInput.kind);
        setClarification(data.scan.targetInput.context);
        setPending({
          scanId: data.scan.id,
          candidates: data.scan.discovery?.candidates || [],
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const navigation: SiteNavItem[] = [
    { href: "/#product", label: t.product },
    { href: "/pricing", label: t.subscriptions },
    { href: "/blog", label: t.blog },
    { href: "/methodology", label: t.methodology },
    { href: "/faq", label: t.faq },
    { href: "/contact", label: t.contact },
  ];
  const stats = [
    { value: "12", label: t.stats[0], icon: BookOpen },
    { value: String(faqEntries.length), label: t.stats[1], icon: CircleHelp },
    { value: "5", label: t.stats[2], icon: Layers3 },
    { value: "2", label: t.stats[3], icon: Languages },
  ];
  const isTopic = scanResult?.target?.kind === "topic";
  const hasReadiness = scanResult?.readinessScore != null;
  const score = hasReadiness
    ? scanResult?.readinessScore
    : scanResult?.actualVisibilityScore;
  const scoreLabel =
    scanResult && !hasReadiness && !isTopic && score != null
      ? rtl
        ? "نتيجة العينة المرصودة"
        : "Observed sample result"
      : score == null
        ? scanResult
          ? isTopic
            ? rtl
              ? "نتائج الموضوع جاهزة"
              : "Topic results ready"
            : rtl
              ? "افتح التقرير لعرض الأدلة"
              : "Open the report for evidence"
          : t.awaiting
        : score >= 80
          ? rtl
            ? "أساس قوي"
            : "Strong foundation"
          : score >= 60
            ? rtl
              ? "يحتاج إلى تحسينات محددة"
              : "Focused improvements needed"
            : t.needsAttention;
  const axesValues: Array<number | null> = scanResult
    ? [
        scanResult.actualVisibilityScore,
        hasReadiness
          ? (scanResult.categoryScores["Authority & entity"] ?? null)
          : null,
        hasReadiness
          ? (scanResult.categoryScores["Content readiness"] ?? null)
          : null,
        hasReadiness
          ? (scanResult.categoryScores["Technical AEO"] ?? null)
          : null,
      ]
    : [null, null, null, null];

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="min-h-screen overflow-x-hidden bg-[#f8fafc] text-[#07111f]"
    >
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-[#f8fafc]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="shrink-0 rounded-xl">
            <BrandMark />
          </Link>
          <nav
            className="hidden items-center gap-5 text-sm font-semibold text-slate-600 lg:flex"
            aria-label={t.menu}
          >
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition hover:text-blue-700"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl"
              onClick={() => {
                const nextLocale = rtl ? "en" : "ar";
                setLocale(nextLocale);
                storeSiteLocale(nextLocale);
              }}
            >
              <Globe2 className="size-4" />
              {rtl ? "EN" : "العربية"}
            </Button>
            <a
              href="/auth/google"
              className="hidden text-sm font-bold text-slate-700 xl:block"
            >
              {t.signin}
            </a>
            <MobileSiteMenu
              items={navigation}
              menuLabel={t.menu}
              ctaLabel={t.signin}
              ctaHref="/auth/google"
              direction={rtl ? "rtl" : "ltr"}
            />
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden border-b border-slate-200">
          <div className="signal-grid absolute inset-0 -z-20" />
          <div className="absolute -left-32 top-24 -z-10 size-96 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute -right-32 top-10 -z-10 size-[28rem] rounded-full bg-violet-500/10 blur-3xl" />
          <div className="mx-auto grid min-h-[calc(100vh-72px)] max-w-[1240px] items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.03fr_.97fr]">
            <div className="max-w-2xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-3.5 py-2 text-xs font-bold uppercase tracking-[.12em] text-blue-700">
                <Radar className="size-3.5 text-cyan-500" />
                {t.eyebrow}
              </div>
              <h1 className="text-[clamp(3rem,7vw,6.2rem)] font-extrabold leading-[.92] tracking-[-.065em]">
                {t.title1}
                <br />
                <span className="gradient-text">{t.title2}</span>
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-8 text-slate-600 sm:text-xl">
                {t.description}
              </p>
              <form
                onSubmit={submit}
                className="mt-9 rounded-[24px] border border-slate-200 bg-white p-2.5 shadow-[0_28px_70px_rgba(7,17,31,.11)]"
              >
                <div className="flex flex-col gap-2 md:flex-row">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-slate-50 px-4">
                    <Globe2 className="size-4 shrink-0 text-slate-400" />
                    <Input
                      dir="auto"
                      value={url}
                      onChange={(event) => {
                        setUrl(event.target.value);
                        setPending(null);
                        setNeedsClarification(false);
                      }}
                      placeholder={t.placeholder}
                      className="h-14 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
                      aria-label={
                        rtl
                          ? "موقع أو اسم أو علامة أو موضوع"
                          : "Website, name, brand or topic"
                      }
                    />
                  </div>
                  <Button
                    disabled={status === "scanning"}
                    className="h-14 rounded-2xl bg-blue-600 px-6 text-base font-bold hover:bg-blue-700"
                  >
                    {status === "scanning" && (
                      <Sparkles className="size-4 animate-pulse" />
                    )}
                    {status === "scanning" ? t.scanning : t.scan}
                    {status !== "scanning" && (
                      <ArrowRight
                        className={`size-4 ${rtl ? "rotate-180" : ""}`}
                      />
                    )}
                  </Button>
                </div>
                <p className="px-3 pb-1 pt-3 text-center text-xs font-semibold text-slate-500">
                  {t.autoContext}
                </p>
              </form>
              <details
                open={needsClarification || undefined}
                className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm"
              >
                <summary className="cursor-pointer font-semibold text-slate-600">
                  {rtl
                    ? "تحديد النوع أو توضيح الاسم (اختياري)"
                    : "Type or name clarification (optional)"}
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label>
                    {rtl ? "نوع التحليل" : "Analysis type"}
                    <select
                      value={kind}
                      onChange={(event) => {
                        setKind(event.target.value as TargetInput["kind"]);
                        setPending(null);
                      }}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                    >
                      {[
                        ["auto", "Automatic", "تلقائي"],
                        ["website", "Website", "موقع"],
                        ["person", "Person", "شخص"],
                        ["brand", "Brand", "علامة"],
                        ["topic", "Topic", "موضوع"],
                      ].map(([value, en, ar]) => (
                        <option key={value} value={value}>
                          {rtl ? ar : en}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {rtl
                      ? "تخصص أو معلومة تمييز"
                      : "Specialty or identifying context"}
                    <Input
                      value={clarification}
                      maxLength={200}
                      onChange={(event) => {
                        setClarification(event.target.value);
                        setPending(null);
                      }}
                      placeholder={
                        rtl
                          ? "مثل: كاتب في صناعة المحتوى"
                          : "e.g. a writer on content creation"
                      }
                      className="mt-1 h-11 rounded-xl"
                    />
                  </label>
                </div>
              </details>
              {needsClarification && (
                <p
                  role="status"
                  className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
                >
                  {rtl
                    ? "لم نجد هوية مدعومة بمصادر كافية. وضّح الاسم بمعلومة قصيرة ثم أعد التحليل، أو اختر «موضوع» إذا كنت تقصد مصطلحًا عامًا."
                    : "We could not establish a sourced identity. Add a brief clarification and analyze again, or choose Topic for a general subject."}
                </p>
              )}
              {pending && (
                <section
                  aria-label={rtl ? "تأكيد الهوية" : "Confirm identity"}
                  className="mt-4 space-y-3 rounded-2xl border border-blue-200 bg-white p-4"
                >
                  <h2 className="font-bold">
                    {rtl ? "أي نتيجة تقصد؟" : "Which result do you mean?"}
                  </h2>
                  {pending.candidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-xl border border-slate-200 p-4"
                    >
                      <p dir="auto" className="font-bold">
                        {normalizeDisplayText(candidate.name)}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {normalizeDisplayText(candidate.description)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {normalizeDisplayText(candidate.category)} ·{" "}
                        {normalizeDisplayText(candidate.country)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {candidate.sources.map((source, index) => (
                          <a
                            key={source}
                            href={source}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-bold text-blue-700"
                          >
                            {rtl ? "مصدر" : "Source"} {index + 1}
                          </a>
                        ))}
                      </div>
                      <Button
                        type="button"
                        disabled={status === "scanning"}
                        className="mt-3 rounded-xl bg-blue-600"
                        onClick={() =>
                          startLiveScan(url, {
                            scanId: pending.scanId,
                            candidateId: candidate.id,
                          }).catch((cause) =>
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : t.scanError,
                            ),
                          )
                        }
                      >
                        {rtl
                          ? "هذا هو المقصود — تابع"
                          : "This is the one — continue"}
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPending(null);
                      setNeedsClarification(true);
                    }}
                  >
                    {rtl ? "لا شيء من هذه النتائج" : "None of these"}
                  </Button>
                </section>
              )}
              {error && (
                <p
                  role="alert"
                  className="mt-3 text-sm font-semibold text-red-600"
                >
                  {error}
                </p>
              )}
              {needsSignIn && (
                <Button asChild className="mt-3 rounded-xl bg-[#07111f]">
                  <a href="/auth/google">{t.signin}</a>
                </Button>
              )}
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                <LockKeyhole className="size-4 text-blue-600" />
                {t.proof}
              </p>
            </div>

            <div className="mx-auto w-full max-w-[560px]">
              <section
                className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_32px_90px_rgba(7,17,31,.14)]"
                aria-live="polite"
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <BrandMark compact />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{domain}</p>
                      <p className="truncate text-xs text-slate-400">
                        {rtl
                          ? "اكتشاف تلقائي للسياق"
                          : "Automatic context discovery"}
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                    {t.previewBadge}
                  </span>
                </div>
                {status === "scanning" ? (
                  <div className="grid min-h-[500px] place-items-center p-8 text-center">
                    <div>
                      <div className="mx-auto mb-7 grid size-24 place-items-center rounded-full bg-blue-50">
                        <Radar className="size-10 animate-pulse text-blue-600" />
                      </div>
                      <h2 className="text-xl font-bold">{t.scanning}</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        {t.scanningSignals}
                      </p>
                      <Progress value={45} className="mt-7 h-2" />
                    </div>
                  </div>
                ) : (
                  <div className="p-6 sm:p-7">
                    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                      <div className="score-ring">
                        <div>
                          <strong>{score ?? "—"}</strong>
                          {score != null && <span>/100</span>}
                        </div>
                      </div>
                      <div className="pt-2 text-center sm:text-start">
                        <p className="text-sm font-semibold text-slate-500">
                          {hasReadiness || !scanResult
                            ? t.result
                            : isTopic
                              ? rtl
                                ? "استكشاف الموضوع"
                                : "Topic exploration"
                              : rtl
                                ? "نسبة الذكر في العينة"
                                : "Sample mention rate"}
                        </p>
                        <h2 className="mt-1 text-2xl font-extrabold">
                          {scoreLabel}
                        </h2>
                        {scanResult && hasReadiness ? (
                          <div className="mt-4 flex gap-2">
                            <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700">
                              {scanResult.criticalCount} {t.critical}
                            </span>
                            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                              {scanResult.issueCount} {t.issues}
                            </span>
                          </div>
                        ) : (
                          <p className="mt-3 max-w-xs text-sm leading-6 text-slate-500">
                            {rtl
                              ? "ابدأ برابط أو اسم. فحص الموقع التقني ينطبق على المواقع فقط؛ استكشاف الموضوع لا يمنح درجة لعلامة."
                              : "Start with a URL or name. Technical readiness applies to websites only; a topic has no brand score."}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-7 space-y-4">
                      {t.axes.map((axis, index) => (
                        <div key={axis}>
                          <div className="mb-1.5 flex justify-between text-sm">
                            <span className="font-semibold text-slate-600">
                              {axis}
                            </span>
                            <strong>
                              {axesValues[index] ??
                                (scanResult && index > 0 && !hasReadiness
                                  ? rtl
                                    ? "غير منطبق"
                                    : "N/A"
                                  : "—")}
                            </strong>
                          </div>
                          {axesValues[index] != null && (
                            <Progress
                              value={axesValues[index]}
                              className="h-2"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-7 rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-[.1em] text-slate-400">
                        {t.engineSnapshot}
                      </p>
                      <p className="mt-3 text-sm font-semibold">
                        {t.recommendationQuestion}
                      </p>
                      <p
                        className={`mt-1 flex items-center gap-2 text-sm font-bold ${scanResult?.actualVisibilityScore != null ? "text-blue-700" : "text-red-600"}`}
                      >
                        <span
                          className={`size-2 rounded-full ${scanResult?.actualVisibilityScore != null ? "bg-blue-500" : "bg-red-500"}`}
                        />
                        {scanResult?.actualVisibilityScore != null
                          ? `${scanResult.actualVisibilityScore}% · ${scanResult.engineRunCount} ${rtl ? "اختبارات محفوظة" : "stored runs"}`
                          : isTopic
                            ? rtl
                              ? "نتائج ومصادر دون درجة علامة"
                              : "Findings and sources, without a brand score"
                            : t.answer}
                      </p>
                    </div>
                    {scanResult ? (
                      <Button
                        asChild
                        className="mt-5 h-12 w-full rounded-xl bg-[#07111f] font-bold"
                      >
                        <Link
                          href={`/report?scan=${encodeURIComponent(scanResult.id)}`}
                        >
                          {t.unlock}
                          <ChevronRight
                            className={`size-4 ${rtl ? "rotate-180" : ""}`}
                          />
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        disabled
                        className="mt-5 h-12 w-full rounded-xl bg-[#07111f] font-bold"
                      >
                        {t.unlock}
                      </Button>
                    )}
                    <p className="mt-3 text-center text-xs text-slate-400">
                      {t.preview}
                    </p>
                  </div>
                )}
              </section>
            </div>
          </div>
        </section>

        <section className="bg-[#07111f] py-6 text-white">
          <div className="mx-auto flex max-w-[1240px] flex-wrap justify-center gap-4 px-5 text-sm font-semibold">
            {t.steps.map((step, index) => (
              <div key={step} className="flex items-center gap-4">
                <span
                  className={index === 2 ? "text-cyan-300" : "text-white/70"}
                >
                  {step}
                </span>
                {index < 4 && (
                  <ChevronRight
                    className={`size-4 text-white/25 ${rtl ? "rotate-180" : ""}`}
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        <section
          id="platform-statistics"
          className="relative overflow-hidden border-b border-slate-200 bg-white"
        >
          <div className="absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,.08),transparent_48%)]" />
          <div className="relative mx-auto max-w-[1240px] px-5 py-16 sm:px-8 sm:py-20">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-bold uppercase tracking-[.14em] text-blue-600">
                  {t.statsEyebrow}
                </p>
                <h2 className="mt-2 text-3xl font-extrabold tracking-[-.04em] sm:text-4xl">
                  {t.statsTitle}
                </h2>
              </div>
              <span className="max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold leading-5 text-amber-800">
                {t.statsNote}
              </span>
            </div>
            <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {stats.map(({ value, label, icon: Icon }) => (
                <div
                  key={label}
                  className="group rounded-[22px] border border-slate-200 bg-slate-50 p-6 transition hover:border-blue-200 hover:bg-white hover:shadow-xl"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="size-5 text-blue-600" />
                    <span className="size-2 rounded-full bg-cyan-400" />
                  </div>
                  <p className="mt-8 text-4xl font-extrabold tracking-[-.05em] text-[#07111f]">
                    {value}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="product"
          className="mx-auto max-w-[1240px] scroll-mt-24 px-5 py-24 sm:px-8"
        >
          <p className="text-sm font-bold uppercase tracking-[.14em] text-blue-600">
            {t.explore}
          </p>
          <h2 className="mt-3 max-w-2xl text-4xl font-extrabold tracking-[-.04em]">
            {t.evidence}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            {t.evidenceText}
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: ShieldCheck,
                title: t.safe,
                description: t.safeText,
                href: "/fix-center",
              },
              {
                icon: Globe2,
                title: t.global,
                description: t.globalText,
                href: "/methodology",
              },
              {
                icon: Sparkles,
                title: t.action,
                description: t.actionText,
                href: "/pricing",
              },
            ].map(({ icon: Icon, title, description, href }) => (
              <Link
                key={title}
                href={href}
                className="group rounded-[24px] border border-slate-200 bg-white p-7 transition hover:-translate-y-1 hover:shadow-xl"
              >
                <span className="grid size-11 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-8 text-xl font-extrabold">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{description}</p>
                <span className="mt-7 flex items-center gap-2 text-sm font-bold text-blue-700">
                  {t.learnMore}
                  <ArrowRight className={`size-4 ${rtl ? "rotate-180" : ""}`} />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section
          id="research"
          className="scroll-mt-24 border-t border-slate-200 bg-white"
        >
          <div className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-bold uppercase tracking-[.14em] text-blue-600">
                  {t.researchEyebrow}
                </p>
                <h2 className="mt-3 text-3xl font-extrabold tracking-[-.035em] sm:text-4xl">
                  {t.researchTitle}
                </h2>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                  {t.researchIntro}
                </p>
              </div>
              <Link
                href="/blog"
                className="flex shrink-0 items-center gap-2 text-sm font-bold text-blue-700"
              >
                {t.viewGuides}
                <ArrowRight className={`size-4 ${rtl ? "rotate-180" : ""}`} />
              </Link>
            </div>
            <div className="mt-9 grid gap-4 md:grid-cols-3">
              {featuredArticles[locale].map((article) => (
                <Link
                  key={article.slug}
                  href={`/blog/${article.slug}`}
                  className="group rounded-[22px] border border-slate-200 bg-slate-50 p-6 transition hover:border-blue-300 hover:bg-white hover:shadow-xl"
                >
                  <span className="text-xs font-bold uppercase tracking-[.12em] text-blue-600">
                    {article.tag}
                  </span>
                  <h3 className="mt-4 text-xl font-extrabold leading-8">
                    {article.title}
                  </h3>
                  <span className="mt-7 flex items-center gap-2 text-sm font-bold text-slate-600 group-hover:text-blue-700">
                    {t.readGuide}
                    <ArrowRight
                      className={`size-4 ${rtl ? "rotate-180" : ""}`}
                    />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-blue-500/20 bg-[#07111f] text-white">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-5 py-14 sm:px-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[.14em] text-cyan-300">
                {t.contactEyebrow}
              </p>
              <h2 className="mt-3 max-w-3xl text-3xl font-extrabold tracking-[-.04em]">
                {t.contactTitle}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                {t.contactText}
              </p>
            </div>
            <Button
              asChild
              className="h-12 shrink-0 rounded-xl bg-white px-6 font-bold text-[#07111f] hover:bg-cyan-50"
            >
              <Link href="/contact">
                {t.contactCta}
                <ArrowRight className={`size-4 ${rtl ? "rotate-180" : ""}`} />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_repeat(3,.65fr)]">
          <div>
            <BrandMark />
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-500">
              {t.footerIntro}
            </p>
          </div>
          <div>
            <p className="text-sm font-extrabold text-slate-900">
              {t.platformGroup}
            </p>
            <nav className="mt-4 flex flex-col gap-3 text-sm font-semibold text-slate-500">
              <Link href="/dashboard">{t.overview}</Link>
              <Link href="/report">{t.sampleReport}</Link>
              <Link href="/fix-center">{t.fixCenter}</Link>
            </nav>
          </div>
          <div>
            <p className="text-sm font-extrabold text-slate-900">
              {t.resourcesGroup}
            </p>
            <nav className="mt-4 flex flex-col gap-3 text-sm font-semibold text-slate-500">
              <Link href="/blog">{t.blog}</Link>
              <Link href="/methodology">{t.methodology}</Link>
              <Link href="/faq">{t.faq}</Link>
            </nav>
          </div>
          <div>
            <p className="text-sm font-extrabold text-slate-900">
              {t.companyGroup}
            </p>
            <nav className="mt-4 flex flex-col gap-3 text-sm font-semibold text-slate-500">
              <Link href="/pricing">{t.subscriptions}</Link>
              <Link href="/contact">{t.contact}</Link>
              <Link href="/privacy">{t.privacy}</Link>
              <Link href="/terms">{t.terms}</Link>
              <Link href="/billing-policy">{t.billing}</Link>
            </nav>
          </div>
        </div>
        <div className="border-t border-slate-100">
          <div className="mx-auto max-w-[1240px] px-5 py-5 text-xs text-slate-400 sm:px-8">
            {t.copyright}
          </div>
        </div>
      </footer>
      <KnowledgeAssistant />
    </div>
  );
}
