import type { Metadata } from "next";
import { PolicyPage } from "@/app/components/policy-page";
import { termsPolicyCopy } from "@/app/terms/page";
import { SITE_URL } from "@/lib/site-config";

export const metadata: Metadata = {
  title: { absolute: termsPolicyCopy.ar.metadata.title },
  description: termsPolicyCopy.ar.metadata.description,
  alternates: { canonical: `${SITE_URL}/ar/terms`, languages: { "ar": `${SITE_URL}/ar/terms`, "en": `${SITE_URL}/terms` } },
};

export default function ArabicTermsPage() {
  return <PolicyPage copy={termsPolicyCopy} initialLocale="ar" />;
}
