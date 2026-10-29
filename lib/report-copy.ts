import { planById } from "./plans";

const starter = planById("starter")!;

export const REPORT_PAYWALL_COPY = {
  en: {
    title: "Unlock your initial report",
    description: `Get the initial results, sources, evidence and priority recommendations for ${starter.price.amount} once. Monthly plans add deeper analysis and recurring monitoring.`,
    cta: `Buy report — ${starter.price.amount}`,
    compare: "Compare monthly plans",
    notice: "One-time purchase for this specific stored report only.",
  },
  ar: {
    title: "افتح تقريرك المبدئي",
    description: `احصل على النتائج الأولية والمصادر والأدلة وأبرز التوصيات مقابل ${starter.price.amount} مرة واحدة. تضيف الباقات الشهرية تحليلًا أعمق ومتابعة دورية.`,
    cta: `شراء التقرير — ${starter.price.amount}`,
    compare: "مقارنة الباقات الشهرية",
    notice: "دفعة واحدة لفتح هذا التقرير المحفوظ تحديدًا.",
  },
} as const;
