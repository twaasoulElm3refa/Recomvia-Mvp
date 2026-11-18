import type { Metadata } from "next";
import { ContactContent } from "@/app/contact/contact-content";
import { SITE_URL } from "@/lib/site-config";

export const metadata: Metadata = {
  title: { absolute: "تواصل مع Recomvia — الدعم والشراكات" },
  description: "تواصل مع فريق Recomvia بشأن تقارير الظهور والباقات والدعم والخدمات والشراكات.",
  alternates: { canonical: `${SITE_URL}/ar/contact`, languages: { "ar": `${SITE_URL}/ar/contact`, "en": `${SITE_URL}/contact` } },
  openGraph: { title: "تواصل مع Recomvia", locale: "ar_SA", url: `${SITE_URL}/ar/contact`, type: "website" },
};

export default function ArabicContactPage() {
  return <ContactContent initialLocale="ar" />;
}
