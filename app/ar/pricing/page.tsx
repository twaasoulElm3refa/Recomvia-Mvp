import type { Metadata } from "next";
import { PricingContent } from "@/app/pricing/pricing-content";
import { isPayPalPaymentsEnabled } from "@/lib/paypal/availability";
import { SITE_URL } from "@/lib/site-config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "أسعار وباقات Recomvia — تقارير الظهور والمتابعة" },
  description: "الباقات المعتمدة: فحص مجاني، وتقرير مبدئي 4.99 دولار، وباقات شهرية 24 و49 و99 دولارًا.",
  alternates: { canonical: `${SITE_URL}/ar/pricing`, languages: { "ar": `${SITE_URL}/ar/pricing`, "en": `${SITE_URL}/pricing` } },
  openGraph: { title: "باقات وأسعار Recomvia", description: "مقارنة باقات Recomvia وأسعارها المعتمدة", locale: "ar_SA", url: `${SITE_URL}/ar/pricing`, type: "website" },
};

export default function ArabicPricingPage() {
  return <PricingContent paymentsEnabled={isPayPalPaymentsEnabled()} initialLocale="ar" />;
}
