import { planById } from "./plans";
const starter = planById("starter")!;
export const REPORT_PAYWALL_COPY = {
  en: {
    title: "Unlock your initial report",
    description: `Get the initial results, sources, evidence and priority recommendations for ${starter.price.amount} once. Monthly plans add deeper analysis and recurring monitoring.`,
    cta: `Request Starter — ${starter.price.amount}`,
    compare: "Compare monthly plans",
    notice: "Paid activation is not open yet. This request does not charge you.",
  },
  ar: {
    title: "افتح تقريرك المبدئي",
    description: `احصل على النتائج الأولية والمصادر والأدلة وأبرز التوصيات مقابل ${starter.price.amount} مرة واحدة. تضيف الباقات الشهرية تحليلًا أعمق ومتابعة دورية.`,
    cta: `طلب التقرير المبدئي — ${starter.price.amount}`,
    compare: "مقارنة الباقات الشهرية",
    notice: "لم يُفتح التفعيل المدفوع بعد. هذا الطلب لا يخصم أي مبلغ.",
  },
} as const;
