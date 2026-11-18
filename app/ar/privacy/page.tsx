import type { Metadata } from "next";
import { PolicyPage } from "@/app/components/policy-page";
import { privacyPolicyCopy } from "@/app/privacy/policy-copy";
import { SITE_URL } from "@/lib/site-config";

export const metadata: Metadata = {
  title: { absolute: privacyPolicyCopy.ar.metadata.title },
  description: privacyPolicyCopy.ar.metadata.description,
  alternates: { canonical: `${SITE_URL}/ar/privacy`, languages: { "ar": `${SITE_URL}/ar/privacy`, "en": `${SITE_URL}/privacy` } },
};

export default function ArabicPrivacyPage() {
  return <PolicyPage copy={privacyPolicyCopy} initialLocale="ar" />;
}
