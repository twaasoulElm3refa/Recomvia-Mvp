import type { Metadata } from "next";
import { ScanExperience } from "@/app/scan-experience";
import { isPayPalPaymentsEnabled } from "@/lib/paypal/availability";
import { SITE_URL } from "@/lib/site-config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "Recomvia — منصة قياس وتحسين الظهور في الذكاء الاصطناعي" },
  description: "اكتشف كيف يرى الذكاء الاصطناعي موقعك أو علامتك التجارية أو اسمك، مع تقارير مرتبطة بالأدلة وخطة للتحسين.",
  alternates: { canonical: `${SITE_URL}/ar`, languages: { "ar": `${SITE_URL}/ar`, "en": SITE_URL } },
  openGraph: { title: "Recomvia — قياس الظهور في الذكاء الاصطناعي", description: "قياس مدعوم بالأدلة لظهور العلامات في إجابات الذكاء الاصطناعي.", url: `${SITE_URL}/ar`, type: "website", locale: "ar_SA" },
};

export default function ArabicHome() {
  return <ScanExperience paymentsEnabled={isPayPalPaymentsEnabled()} initialLocale="ar" />;
}
