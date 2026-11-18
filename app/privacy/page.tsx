import type { Metadata } from "next";
import { PolicyPage } from "@/app/components/policy-page";
import { SITE_URL } from "@/lib/articles";
import { privacyPolicyCopy } from "./policy-copy";

export const metadata: Metadata = {
  title: { absolute: "Recomvia Privacy & Beta Data Notice" },
  description: "What Recomvia collects and why during the private beta.",
  alternates: { canonical: `${SITE_URL}/privacy`, languages: { "en": `${SITE_URL}/privacy`, "ar": `${SITE_URL}/ar/privacy` } },
};



export default function PrivacyPage() {
  return <PolicyPage copy={privacyPolicyCopy} />;
}
