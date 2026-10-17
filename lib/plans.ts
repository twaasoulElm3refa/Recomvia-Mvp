export const FULL_REPORT_CAPABILITY = "report.full" as const;
export const STARTER_REPORT_CAPABILITY = "report.starter" as const;
export const ADVANCED_REPORT_CAPABILITY = "report.advanced" as const;
export const FIX_CREDITS_CAPABILITY = "fix.credits" as const;
export const MONITORING_CAPABILITY = "monitoring" as const;

export type PlanId = "free" | "starter" | "essential" | "growth" | "pro";
export type SubscriptionPlanId = "essential" | "growth" | "pro";
export type ReportLevel = "summary" | "starter" | "detailed" | "advanced";
export type LocalizedPlanText = { en: string; ar: string };
export type PlanCapability = typeof FULL_REPORT_CAPABILITY | typeof STARTER_REPORT_CAPABILITY | typeof ADVANCED_REPORT_CAPABILITY | typeof FIX_CREDITS_CAPABILITY | typeof MONITORING_CAPABILITY;
export type PlanDefinition = {
  id: PlanId;
  name: LocalizedPlanText;
  price: { amount: string; amountCents: number; currency: "USD"; cadence: LocalizedPlanText };
  billing: "free" | "one_time" | "monthly";
  projectLimit: number;
  reportLevel: ReportLevel;
  description: LocalizedPlanText;
  features: readonly LocalizedPlanText[];
  capabilities: readonly PlanCapability[];
};
const monthlyCapabilities: readonly PlanCapability[] = [STARTER_REPORT_CAPABILITY, FULL_REPORT_CAPABILITY, MONITORING_CAPABILITY, FIX_CREDITS_CAPABILITY];
const advancedFeatures: readonly LocalizedPlanText[] = [
  { en: "Everything in Essential", ar: "جميع مزايا الباقة الأساسية" },
  { en: "Broader coverage of questions, AI engines and competitors", ar: "نطاق أوسع من الأسئلة والمحركات والمنافسين" },
  { en: "Cross-engine and search-intent comparisons", ar: "مقارنة الأداء بين المحركات ونوايا البحث" },
  { en: "Deeper citation, source and content-gap analysis", ar: "تحليل أعمق للاستشهادات والمصادر وفجوات المحتوى" },
  { en: "Detailed implementation priorities and progress monitoring", ar: "أولويات تنفيذ مفصلة ومتابعة نتائج التحسين" },
];

/** Approved product catalog. Quotas and payment-provider IDs are separate
 * configuration; selecting a plan never creates a paid entitlement. */
export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    id: "free", name: { en: "Free", ar: "المجاني" },
    price: { amount: "$0", amountCents: 0, currency: "USD", cadence: { en: "one analysis", ar: "تحليل واحد" } },
    billing: "free", projectLimit: 1, reportLevel: "summary",
    description: { en: "See your headline numbers.", ar: "تعرّف على أرقامك الرئيسية." },
    features: [
      { en: "One analysis after sign-in", ar: "تحليل واحد بعد تسجيل الدخول" },
      { en: "Headline scores and summary statistics", ar: "الدرجات الرئيسية والإحصاءات الملخصة" },
      { en: "Detailed findings, sources and recommendations stay locked", ar: "تفاصيل التقرير والمصادر والتوصيات مقفلة" },
    ], capabilities: [],
  },
  {
    id: "starter", name: { en: "Starter", ar: "التقرير المبدئي" },
    price: { amount: "$4.99", amountCents: 499, currency: "USD", cadence: { en: "one-time payment", ar: "مرة واحدة" } },
    billing: "one_time", projectLimit: 1, reportLevel: "starter",
    description: { en: "Unlock one initial report. No subscription.", ar: "افتح تقريرًا أوليًا واحدًا دون اشتراك." },
    features: [
      { en: "Results and score explanations from the initial analysis", ar: "نتائج الفحص الأولي وشرح الدرجات" },
      { en: "Initial AI answers and available sources", ar: "إجابات الاختبار الأولي والمصادر المتاحة" },
      { en: "Priority issues, a mini audit and initial recommendations", ar: "أبرز المشكلات وفحص مصغر وتوصيات أولية" },
      { en: "A limited competitor comparison when evidenced", ar: "مقارنة محدودة بمنافس عند توفر الأدلة" },
      { en: "Saved report and printable PDF; no recurring monitoring", ar: "تقرير محفوظ وإمكانية حفظه PDF؛ دون متابعة دورية" },
    ], capabilities: [STARTER_REPORT_CAPABILITY],
  },
  {
    id: "essential", name: { en: "Essential", ar: "الأساسية" },
    price: { amount: "$24", amountCents: 2400, currency: "USD", cadence: { en: "per month", ar: "شهريًا" } },
    billing: "monthly", projectLimit: 1, reportLevel: "detailed",
    description: { en: "A detailed report and ongoing monitoring for one project.", ar: "تقرير تفصيلي ومتابعة مستمرة لمشروع واحد." },
    features: [
      { en: "One website, brand, personal brand or topic", ar: "موقع أو علامة أو اسم شخصي أو موضوع واحد" },
      { en: "Detailed findings by question and topic", ar: "نتائج تفصيلية حسب الأسئلة والموضوعات" },
      { en: "Competitor and source analysis; key-page review", ar: "تحليل المنافسين والمصادر ومراجعة الصفحات المهمة" },
      { en: "A prioritized improvement plan", ar: "خطة تحسين مرتبة حسب الأولوية" },
      { en: "Periodic measurements, history and issue tracking", ar: "قياسات دورية وسجل نتائج ومتابعة المشكلات" },
      { en: "Fix Center access; Fix Credits purchased separately", ar: "فتح مركز الإصلاح؛ تُشترى النقاط منفصلة" },
    ], capabilities: monthlyCapabilities,
  },
  {
    id: "growth", name: { en: "Growth", ar: "المتقدمة" },
    price: { amount: "$49", amountCents: 4900, currency: "USD", cadence: { en: "per month", ar: "شهريًا" } },
    billing: "monthly", projectLimit: 1, reportLevel: "advanced",
    description: { en: "Very advanced analysis for one project.", ar: "تحليل متقدم جدًا لمشروع واحد." },
    features: advancedFeatures, capabilities: [...monthlyCapabilities, ADVANCED_REPORT_CAPABILITY],
  },
  {
    id: "pro", name: { en: "Pro", ar: "الاحترافية" },
    price: { amount: "$99", amountCents: 9900, currency: "USD", cadence: { en: "per month", ar: "شهريًا" } },
    billing: "monthly", projectLimit: 3, reportLevel: "advanced",
    description: { en: "The full depth of Growth for each of three projects.", ar: "كامل عمق باقة Growth لكل مشروع من ثلاثة مشروعات." },
    features: [
      { en: "Three websites or projects", ar: "ثلاثة مواقع أو مشروعات" },
      { en: "All Growth features for every project", ar: "كامل مزايا Growth لكل مشروع" },
      { en: "Independent reports, improvement plans and histories", ar: "تقارير وخطط تحسين وسجل مستقل لكل مشروع" },
      { en: "One dashboard to manage all three projects", ar: "لوحة موحدة لإدارة المشروعات الثلاثة" },
      { en: "Fix Credits purchased separately", ar: "تُشترى نقاط الإصلاح منفصلة" },
    ], capabilities: [...monthlyCapabilities, ADVANCED_REPORT_CAPABILITY],
  },
];
export function planById(plan: string | null | undefined) {
  const normalized = plan?.trim().toLowerCase();
  return PLAN_CATALOG.find((item) => item.id === normalized) ?? null;
}
export function isSubscriptionPlan(plan: PlanDefinition | null): plan is PlanDefinition & { id: SubscriptionPlanId } {
  return plan?.billing === "monthly";
}
export function planRequestHref(plan: PlanId, scanId?: string) {
  const query = new URLSearchParams({ plan });
  if (scanId && /^[a-zA-Z0-9_-]{1,100}$/.test(scanId)) query.set("scan", scanId);
  return `/contact?${query.toString()}`;
}
