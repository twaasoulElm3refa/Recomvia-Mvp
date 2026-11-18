import type { Metadata } from "next";
import { FaqPageContent } from "@/app/faq/faq-page-content";
import { SITE_URL } from "@/lib/site-config";

export const metadata: Metadata = {
  title: { absolute: "الأسئلة الشائعة عن Recomvia — القياس والتقارير والاشتراكات" },
  description: "إجابات موثقة باللغة العربية عن قياس الظهور في الذكاء الاصطناعي، والتقارير والاشتراكات والنقاط والدعم.",
  alternates: { canonical: `${SITE_URL}/ar/faq`, languages: { "ar": `${SITE_URL}/ar/faq`, "en": `${SITE_URL}/faq` } },
  openGraph: { title: "الأسئلة الشائعة عن Recomvia", description: "إجابات موثقة عن المنصة وقياس الظهور", locale: "ar_SA", url: `${SITE_URL}/ar/faq`, type: "website" },
};

export default function ArabicFaqPage() {
  return <FaqPageContent initialLocale="ar" />;
}
