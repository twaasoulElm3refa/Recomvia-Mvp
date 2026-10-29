"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Coins,
  Layers3,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { PublicShell, type LocalizedMetadata } from "@/app/components/public-shell";
import { Button } from "@/components/ui/button";
import { PLAN_CATALOG } from "@/lib/plans";

const pageMetadata: LocalizedMetadata = {
  en: {
    title: "Recomvia Subscriptions & Billing — Reports, Monitoring & Fix Credits",
    description:
      "One free score, a $4.99 initial report, and monthly plans at $24, $49 and $99. Compare detailed and advanced analysis for one or three projects.",
  },
  ar: {
    title: "اشتراكات وباقات Recomvia — التقارير والمتابعة ونقاط الإصلاح",
    description:
      "فحص مجاني، وتقرير مبدئي بسعر 4.99 دولار، واشتراكات شهرية بسعر 24 و49 و99 دولارًا لمشروع واحد أو ثلاثة مشروعات.",
  },
};

const copy = {
  en: {
    eyebrow: "Plans & subscriptions",
    title: "Understand your visibility. Choose your next step.",
    intro:
      "Start with one free analysis. Unlock an initial report, or choose deeper analysis and recurring monitoring for your projects.",
    recommended: "Advanced insight",
    start: "Get my free score",
    selectedPlan: "Selected plan",
    buyStarter: "Buy report — $4.99",
    starterNeedsScan: "Select a stored report to unlock ($4.99)",
    subscribeEssential: "Subscribe — $24/month",
    subscribeGrowth: "Subscribe — $49/month",
    subscribePro: "Subscribe — $99/month",
    processingCheckout: "Connecting to PayPal...",
    compare: "Compare the plans",
    feature: "Included scope",
    projects: "Projects",
    depth: "Report depth",
    depths: {
      summary: "Headline numbers",
      starter: "Initial report",
      detailed: "Detailed",
      advanced: "Very advanced",
    },
    monitoring: "Recurring monitoring & history",
    credits: "Fix Center & credit eligibility",
    yes: "Included",
    no: "Not included",
    separate: "Credits sold separately",
    projectNote:
      "A project can be a website, brand, personal brand or topic. Indicators adapt to the subject; a missing website audit is marked not applicable.",
    creditsTitle: "Fix Credits",
    creditsText:
      "An active Essential, Growth or Pro subscription makes you eligible to purchase and use Fix Credits. Every fix shows its scope and credit cost before approval. Credits are not included in the subscription; human expert services are priced separately.",
    creditRequest: "Ask about Fix Credits",
    creditNotice:
      "Credit purchasing will open when the credit catalog and execution workflows are ready. Purchased balances remain subject to the published validity policy when a subscription ends; use resumes with an active subscription.",
    differenceTitle: "Choose depth, then project count",
    difference:
      "Essential provides detailed diagnosis and monitoring. Growth adds deeper comparisons, citation analysis and content gaps for one project. Pro gives each of three projects the full Growth experience, with consolidated management.",
    saved:
      "Opening a saved report does not run a new analysis. Starter unlocks the initial scan; it does not include a fresh deep scan or recurring monitoring.",
    billing: "Billing and credit policy",
    allUsd: "All prices in USD. Monthly prices are for one month, without an annual commitment.",
    statusTitle: {
      processing: "Processing payment...",
      active: "Payment verified & active",
      failed: "Payment failed",
      cancelled: "Payment cancelled",
    },
    statusDesc: {
      processingStarter: "Verifying order capture with PayPal. Unlocking your report...",
      processingSub: "Confirming subscription activation with PayPal...",
      activeSub: "Your subscription is now active! Paid features and monitoring are enabled.",
      activeStarter: "Your report is unlocked! Redirecting...",
      failed: "The transaction could not be completed. No changes were made.",
      cancelled: "Checkout was cancelled on PayPal. You have not been charged.",
    },
    goToDashboard: "Go to Dashboard",
    goToReport: "View purchased report",
  },
  ar: {
    eyebrow: "الباقات والاشتراكات",
    title: "افهم ظهورك. واختر خطوتك التالية.",
    intro:
      "ابدأ بتحليل مجاني واحد. افتح التقرير المبدئي، أو اختر تحليلًا أعمق ومتابعة دورية لمشروعاتك.",
    recommended: "تحليل متقدم",
    start: "ابدأ الفحص المجاني",
    selectedPlan: "الباقة المختارة",
    buyStarter: "شراء التقرير — $4.99",
    starterNeedsScan: "اختر تقريرًا محفوظًا لفتحه (4.99$)",
    subscribeEssential: "اشتراك — 24$/شهريًا",
    subscribeGrowth: "اشتراك — 49$/شهريًا",
    subscribePro: "اشتراك — 99$/شهريًا",
    processingCheckout: "جارٍ الاتصال بـ PayPal...",
    compare: "قارن الباقات",
    feature: "نطاق الباقة",
    projects: "المشروعات",
    depth: "عمق التقرير",
    depths: {
      summary: "الأرقام الرئيسية",
      starter: "تقرير مبدئي",
      detailed: "تفصيلي",
      advanced: "متقدم جدًا",
    },
    monitoring: "المتابعة الدورية وسجل النتائج",
    credits: "مركز الإصلاح وأهلية شراء النقاط",
    yes: "مشمول",
    no: "غير مشمول",
    separate: "تُشترى النقاط منفصلة",
    projectNote:
      "المشروع يمكن أن يكون موقعًا أو علامة تجارية أو علامة شخصية أو موضوعًا. تتكيف المؤشرات مع نوعه؛ الفحص التقني غير المنطبق يظهر «غير منطبق».",
    creditsTitle: "نقاط الإصلاح — Fix Credits",
    creditsText:
      "يتيح اشتراك Essential أو Growth أو Pro النشط شراء واستخدام نقاط الإصلاح. يظهر نطاق كل إصلاح وتكلفته قبل موافقتك. النقاط غير مشمولة في سعر الاشتراك، والخدمات البشرية تُسعّر منفصلة.",
    creditRequest: "الاستفسار عن نقاط الإصلاح",
    creditNotice:
      "يُفتح شراء النقاط عند جاهزية كتالوج الإصلاحات ومسار تنفيذها. يبقى الرصيد المشترى وفق سياسة الصلاحية المعلنة عند انتهاء الاشتراك، ويُستأنف استخدامه مع اشتراك نشط.",
    differenceTitle: "اختر عمق التحليل ثم عدد المشروعات",
    difference:
      "تقدم Essential تشخيصًا تفصيليًا ومتابعة. تضيف Growth مقارنة أعمق وتحليل الاستشهادات وفجوات المحتوى لمشروع واحد. وتمنح Pro كل مشروع من المشروعات الثلاثة كامل تجربة Growth، مع إدارة موحدة.",
    saved:
      "فتح تقرير محفوظ لا يشغّل تحليلًا جديدًا. تفتح Starter بيانات الفحص الأولي، ولا تشمل فحصًا عميقًا جديدًا أو متابعة دورية.",
    billing: "سياسة الفوترة والنقاط",
    allUsd: "جميع الأسعار بالدولار الأميركي. الأسعار الشهرية لشهر واحد دون التزام سنوي.",
    statusTitle: {
      processing: "جارٍ معالجة الدفع...",
      active: "تم التحقق وتفعيل الاشتراك",
      failed: "فشلت عملية الدفع",
      cancelled: "تم إلغاء عملية الدفع",
    },
    statusDesc: {
      processingStarter: "جارٍ التحقق من قيد الدفع عبر PayPal وفتح تقريرك...",
      processingSub: "جارٍ تأكيد تفعيل الاشتراك عبر خوادم PayPal...",
      activeSub: "اشتراكك نشط الآن! تم تفعيل ميزات الباقة والمتابعة لمشروعك.",
      activeStarter: "تم فتح تقريرك بنجاح! جارٍ التحويل...",
      failed: "تعذر إتمام العملية. لم يتم خصم أي مبالغ إضافية.",
      cancelled: "تم إلغاء العملية عبر PayPal ولم يتم خصم أي مبالغ.",
    },
    goToDashboard: "الانتقال للوحة التحكم",
    goToReport: "عرض التقرير المشترى",
  },
} as const;

export function SubscriptionsContent() {
  const searchParams = useSearchParams();
  const requestedPlan = searchParams?.get("plan");
  const selectedPlan = requestedPlan === "essential" || requestedPlan === "growth" || requestedPlan === "pro" ? requestedPlan : null;
  const returnFlow = searchParams?.get("flow");
  const [paymentStatus, setPaymentStatus] = useState<
    "idle" | "processing" | "active" | "failed" | "cancelled"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<string | null>(null);
  const [targetScanId, setTargetScanId] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPlan || returnFlow) return;
    document.getElementById(selectedPlan)?.scrollIntoView({ block: "center" });
  }, [selectedPlan, returnFlow]);

  // Handle post-payment returns
  useEffect(() => {
    if (!searchParams) return;
    const flow = searchParams.get("flow");
    const scan = searchParams.get("scan");
    const token = searchParams.get("token") || searchParams.get("order_id");
    const subscriptionId = searchParams.get("subscription_id");

    if (scan) {
      setTargetScanId(scan);
    }

    if (flow === "cancelled") {
      setPaymentStatus("cancelled");
      return;
    }

    if (flow === "starter" && token) {
      setPaymentStatus("processing");
      fetch("/api/payments/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: token, scanId: scan }),
      })
        .then(async (res) => {
          const data = (await res.json()) as { error?: string; scanId?: string };
          if (!res.ok) {
            throw new Error(data.error || "Capture failed");
          }
          setPaymentStatus("active");
          const target = data.scanId || scan;
          if (target) {
            setTargetScanId(target);
            setTimeout(() => {
              window.location.href = `/report?scan=${encodeURIComponent(target)}`;
            }, 1500);
          }
        })
        .catch((err: any) => {
          setPaymentStatus("failed");
          setStatusMessage(err.message);
        });
      return;
    }

    if (flow === "subscription" && subscriptionId) {
      setPaymentStatus("processing");
      fetch("/api/payments/paypal/sync-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            error?: string;
            isActive?: boolean;
            plan?: string;
            paypalStatus?: string;
          };
          if (!res.ok) {
            throw new Error(data.error || "Verification failed");
          }
          if (data.isActive) {
            setPaymentStatus("active");
            setActivePlan(data.plan || null);
          } else {
            setPaymentStatus("processing");
            setStatusMessage(
              data.paypalStatus === "APPROVAL_PENDING"
                ? "PayPal subscription is awaiting final activation confirmation."
                : `Current status: ${data.paypalStatus}`,
            );
          }
        })
        .catch((err: any) => {
          setPaymentStatus("failed");
          setStatusMessage(err.message);
        });
      return;
    }
  }, [searchParams]);

  const handleStarterCheckout = async (scanId: string) => {
    try {
      setLoadingPlan("starter");
      const res = await fetch("/api/payments/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId }),
      });
      const data = (await res.json()) as { error?: string; approveUrl?: string };
      if (res.status === 401) {
        window.location.href = "/auth/google";
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Failed to start checkout");
      }
      if (data.approveUrl) {
        window.location.href = data.approveUrl;
      }
    } catch (err: any) {
      alert(err.message || "Failed to initiate payment");
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleSubscriptionCheckout = async (plan: "essential" | "growth" | "pro") => {
    try {
      setLoadingPlan(plan);
      const res = await fetch("/api/payments/paypal/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as { error?: string; approveUrl?: string };
      if (res.status === 401) {
        window.location.href = "/auth/google";
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Failed to start subscription");
      }
      if (data.approveUrl) {
        window.location.href = data.approveUrl;
      }
    } catch (err: any) {
      alert(err.message || "Failed to initiate subscription");
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <PublicShell pageMetadata={pageMetadata}>
      {(locale) => {
        const t = copy[locale];

        return (
          <main>
            <section className="relative overflow-hidden border-b border-slate-200">
              <div className="signal-grid absolute inset-0" />
              <div className="relative mx-auto max-w-4xl px-5 py-16 text-center sm:px-8 sm:py-24">
                <p className="text-sm font-bold uppercase tracking-[.16em] text-blue-600">
                  {t.eyebrow}
                </p>
                <h1 className="mt-4 text-4xl font-extrabold tracking-[-.045em] sm:text-6xl">
                  {t.title}
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                  {t.intro}
                </p>
                <p className="mt-4 text-xs leading-6 text-slate-500">{t.allUsd}</p>
              </div>
            </section>

            <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
              {/* Payment Status Alerts */}
              {paymentStatus === "processing" && (
                <div
                  role="status"
                  className="mb-8 flex items-center gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950"
                >
                  <Loader2 className="size-6 shrink-0 animate-spin text-blue-600" />
                  <div>
                    <h2 className="font-extrabold text-blue-900">{t.statusTitle.processing}</h2>
                    <p className="mt-1 text-sm text-blue-800">
                      {statusMessage || (targetScanId ? t.statusDesc.processingStarter : t.statusDesc.processingSub)}
                    </p>
                  </div>
                </div>
              )}

              {paymentStatus === "active" && (
                <div
                  role="status"
                  className="mb-8 flex items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
                >
                  <div className="flex items-center gap-4">
                    <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />
                    <div>
                      <h2 className="font-extrabold text-emerald-900">{t.statusTitle.active}</h2>
                      <p className="mt-1 text-sm text-emerald-800">
                        {targetScanId ? t.statusDesc.activeStarter : t.statusDesc.activeSub}
                      </p>
                    </div>
                  </div>
                  {targetScanId ? (
                    <Button asChild className="rounded-xl bg-emerald-700 hover:bg-emerald-800">
                      <Link href={`/report?scan=${encodeURIComponent(targetScanId)}`}>
                        {t.goToReport}
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild className="rounded-xl bg-emerald-700 hover:bg-emerald-800">
                      <Link href="/dashboard">{t.goToDashboard}</Link>
                    </Button>
                  )}
                </div>
              )}

              {paymentStatus === "failed" && (
                <div
                  role="alert"
                  className="mb-8 flex items-center gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-950"
                >
                  <AlertCircle className="size-6 shrink-0 text-rose-600" />
                  <div>
                    <h2 className="font-extrabold text-rose-900">{t.statusTitle.failed}</h2>
                    <p className="mt-1 text-sm text-rose-800">
                      {statusMessage || t.statusDesc.failed}
                    </p>
                  </div>
                </div>
              )}

              {paymentStatus === "cancelled" && (
                <div
                  role="status"
                  className="mb-8 flex items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950"
                >
                  <XCircle className="size-6 shrink-0 text-amber-600" />
                  <div>
                    <h2 className="font-extrabold text-amber-900">{t.statusTitle.cancelled}</h2>
                    <p className="mt-1 text-sm text-amber-800">{t.statusDesc.cancelled}</p>
                  </div>
                </div>
              )}

              {/* Plans Grid */}
              <div className="grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-5">
                {PLAN_CATALOG.map((plan) => {
                   const highlighted = plan.id === "growth";
                   const selected = plan.id === selectedPlan;
                  const isLoading = loadingPlan === plan.id;

                  return (
                    <article
                      id={plan.id}
                      key={plan.id}
                      className={`relative flex scroll-mt-24 flex-col rounded-3xl border p-6 ${
                         highlighted
                           ? `border-blue-600 bg-[#07111f] text-white ring-4 ${selected ? "ring-cyan-300" : "ring-blue-100"}`
                           : selected ? "border-blue-600 bg-white ring-4 ring-blue-200" : "border-slate-200 bg-white"
                      }`}
                    >
                       {(highlighted || selected) && (
                        <span className="absolute -top-3 start-5 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                           {selected ? t.selectedPlan : t.recommended}
                        </span>
                      )}
                      <h2 className="text-xl font-extrabold">{plan.name[locale]}</h2>
                      {locale === "ar" && (
                        <p
                          className={`mt-1 text-xs ${
                            highlighted ? "text-slate-400" : "text-slate-500"
                          }`}
                          lang="en"
                        >
                          {plan.name.en}
                        </p>
                      )}
                      <div className="mt-5">
                        <strong
                          className="inline-block text-4xl font-extrabold tracking-tight"
                          dir="ltr"
                        >
                          {plan.price.amount}
                        </strong>
                        <p
                          className={`mt-2 text-xs ${
                            highlighted ? "text-slate-400" : "text-slate-500"
                          }`}
                        >
                          {plan.price.cadence[locale]}
                        </p>
                      </div>
                      <p
                        className={`mt-5 min-h-16 text-sm leading-7 ${
                          highlighted ? "text-slate-300" : "text-slate-600"
                        }`}
                      >
                        {plan.description[locale]}
                      </p>
                      <ul className="my-6 flex-1 space-y-4">
                        {plan.features.map((feature) => (
                          <li key={feature.en} className="flex gap-2 text-sm leading-6">
                            <Check
                              className={`mt-1 size-4 shrink-0 ${
                                highlighted ? "text-cyan-300" : "text-blue-600"
                              }`}
                              aria-hidden="true"
                            />
                            <span>{feature[locale]}</span>
                          </li>
                        ))}
                      </ul>

                      {/* Action Buttons */}
                      {plan.id === "free" && (
                        <Button
                          asChild
                          className="h-auto min-h-11 w-full rounded-xl bg-blue-600 px-3 py-3 font-bold text-white hover:bg-blue-700"
                        >
                          <Link href="/">
                            {t.start}
                            <ArrowRight className="size-4 shrink-0 rtl:rotate-180" />
                          </Link>
                        </Button>
                      )}

                      {plan.id === "starter" && (
                        <>
                          {targetScanId ? (
                            <Button
                              type="button"
                              disabled={isLoading}
                              onClick={() => handleStarterCheckout(targetScanId)}
                              className="h-auto min-h-11 w-full rounded-xl bg-blue-600 px-3 py-3 font-bold text-white hover:bg-blue-700"
                            >
                              {isLoading ? (
                                <>
                                  <Loader2 className="size-4 animate-spin" />
                                  <span>{t.processingCheckout}</span>
                                </>
                              ) : (
                                <>
                                  <span>{t.buyStarter}</span>
                                  <ArrowRight className="size-4 shrink-0 rtl:rotate-180" />
                                </>
                              )}
                            </Button>
                          ) : (
                            <Button
                              asChild
                              variant="outline"
                              className="h-auto min-h-11 w-full whitespace-normal rounded-xl border-slate-300 px-3 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <Link href="/dashboard">
                                <span>{t.starterNeedsScan}</span>
                              </Link>
                            </Button>
                          )}
                        </>
                      )}

                      {plan.id === "essential" && (
                        <Button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleSubscriptionCheckout("essential")}
                          className="h-auto min-h-11 w-full rounded-xl bg-blue-600 px-3 py-3 font-bold text-white hover:bg-blue-700"
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              <span>{t.processingCheckout}</span>
                            </>
                          ) : (
                            <>
                              <span>{t.subscribeEssential}</span>
                              <ArrowRight className="size-4 shrink-0 rtl:rotate-180" />
                            </>
                          )}
                        </Button>
                      )}

                      {plan.id === "growth" && (
                        <Button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleSubscriptionCheckout("growth")}
                          className="h-auto min-h-11 w-full rounded-xl bg-white px-3 py-3 font-bold text-[#07111f] hover:bg-slate-100"
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="size-4 animate-spin text-[#07111f]" />
                              <span>{t.processingCheckout}</span>
                            </>
                          ) : (
                            <>
                              <span>{t.subscribeGrowth}</span>
                              <ArrowRight className="size-4 shrink-0 rtl:rotate-180" />
                            </>
                          )}
                        </Button>
                      )}

                      {plan.id === "pro" && (
                        <Button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleSubscriptionCheckout("pro")}
                          className="h-auto min-h-11 w-full rounded-xl bg-blue-600 px-3 py-3 font-bold text-white hover:bg-blue-700"
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              <span>{t.processingCheckout}</span>
                            </>
                          ) : (
                            <>
                              <span>{t.subscribePro}</span>
                              <ArrowRight className="size-4 shrink-0 rtl:rotate-180" />
                            </>
                          )}
                        </Button>
                      )}
                    </article>
                  );
                })}
              </div>

              <p className="mt-6 text-sm leading-7 text-slate-500">{t.projectNote}</p>

              {/* Comparison Table */}
              <div className="mt-12 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
                <h2 className="text-2xl font-extrabold">{t.compare}</h2>
                <div
                  className="mt-6 overflow-x-auto rounded-xl"
                  role="region"
                  tabIndex={0}
                  aria-label={t.compare}
                >
                  <table className="w-full min-w-[720px] text-start text-sm">
                    <caption className="sr-only">{t.compare}</caption>
                    <thead>
                      <tr className="bg-slate-50">
                        <th scope="col" className="p-4 text-start">
                          {t.feature}
                        </th>
                        {PLAN_CATALOG.map((plan) => (
                          <th scope="col" key={plan.id} className="p-4 text-start">
                            {plan.name[locale]}
                            <span dir="ltr" className="mt-1 block font-normal text-slate-500">
                              {plan.price.amount}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          label: t.projects,
                          values: PLAN_CATALOG.map((plan) => String(plan.projectLimit)),
                        },
                        {
                          label: t.depth,
                          values: PLAN_CATALOG.map((plan) => t.depths[plan.reportLevel]),
                        },
                        {
                          label: t.monitoring,
                          values: PLAN_CATALOG.map((plan) =>
                            plan.billing === "monthly" ? t.yes : t.no,
                          ),
                        },
                        {
                          label: t.credits,
                          values: PLAN_CATALOG.map((plan) =>
                            plan.billing === "monthly" ? t.separate : t.no,
                          ),
                        },
                      ].map((row) => (
                        <tr key={row.label} className="border-t border-slate-100">
                          <th scope="row" className="p-4 text-start font-semibold">
                            {row.label}
                          </th>
                          {row.values.map((value, i) => (
                            <td key={PLAN_CATALOG[i].id} className="p-4 leading-6 text-slate-600">
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-5 text-sm leading-7 text-slate-500">{t.saved}</p>
              </div>

              {/* Extra Info Cards */}
              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <section className="rounded-3xl bg-[#07111f] p-7 text-white">
                  <Coins className="size-7 text-cyan-300" aria-hidden="true" />
                  <h2 className="mt-4 text-2xl font-extrabold">{t.creditsTitle}</h2>
                  <p className="mt-4 text-sm leading-7 text-slate-300">{t.creditsText}</p>
                  <p className="mt-4 text-xs leading-6 text-slate-400">{t.creditNotice}</p>
                  <Button
                    asChild
                    className="mt-6 rounded-xl bg-white text-[#07111f] hover:bg-slate-100"
                  >
                    <Link href="/contact?product=fix-credits">{t.creditRequest}</Link>
                  </Button>
                </section>
                <section className="rounded-3xl border border-slate-200 p-7">
                  <Layers3 className="size-7 text-blue-600" aria-hidden="true" />
                  <h2 className="mt-4 text-2xl font-extrabold">{t.differenceTitle}</h2>
                  <p className="mt-4 text-sm leading-8 text-slate-600">{t.difference}</p>
                  <Link
                    href="/billing-policy"
                    className="mt-6 inline-flex text-sm font-bold text-blue-700 underline underline-offset-4"
                  >
                    {t.billing}
                  </Link>
                </section>
              </div>
            </section>
          </main>
        );
      }}
    </PublicShell>
  );
}
