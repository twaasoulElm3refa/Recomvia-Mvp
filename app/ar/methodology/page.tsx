import type { Metadata } from "next";
import { MethodologyContent } from "@/app/methodology/methodology-content";
import { SITE_URL } from "@/lib/site-config";

export const metadata: Metadata = {
  title: { absolute: "منهجية قياس الظهور في الذكاء الاصطناعي | Recomvia" },
  description: "شرح منهجية Recomvia للفصل بين ظهور العلامة الفعلي وجاهزية الموقع وربط النتائج بالأدلة.",
  alternates: { canonical: `${SITE_URL}/ar/methodology`, languages: { "ar": `${SITE_URL}/ar/methodology`, "en": `${SITE_URL}/methodology` } },
  openGraph: { title: "منهجية القياس في Recomvia", locale: "ar_SA", url: `${SITE_URL}/ar/methodology`, type: "website" },
};

export default function ArabicMethodologyPage() {
  return <MethodologyContent initialLocale="ar" />;
}
