import type { Metadata } from "next";
import { PolicyPage } from "@/app/components/policy-page";
import { SITE_URL } from "@/lib/articles";
import { billingPolicyCopy } from "./policy-copy";

export const metadata: Metadata = { title: { absolute: "Recomvia Beta Billing Policy" }, description: "Current payment, subscription, cancellation, refund, and Fix Credit status for the Recomvia private beta.", alternates: { canonical: `${SITE_URL}/billing-policy`, languages: { "en": `${SITE_URL}/billing-policy`, "ar": `${SITE_URL}/ar/billing-policy` } } };



export default function BillingPolicyPage() { return <PolicyPage copy={billingPolicyCopy} />; }
