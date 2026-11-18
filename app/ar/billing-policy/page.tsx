import type { Metadata } from "next";
import { PolicyPage } from "@/app/components/policy-page";
import { billingPolicyCopy } from "@/app/billing-policy/policy-copy";
import { SITE_URL } from "@/lib/site-config";

export const metadata: Metadata = {
  title: { absolute: billingPolicyCopy.ar.metadata.title },
  description: billingPolicyCopy.ar.metadata.description,
  alternates: { canonical: `${SITE_URL}/ar/billing-policy`, languages: { "ar": `${SITE_URL}/ar/billing-policy`, "en": `${SITE_URL}/billing-policy` } },
};

export default function ArabicBillingPolicyPage() {
  return <PolicyPage copy={billingPolicyCopy} initialLocale="ar" />;
}
