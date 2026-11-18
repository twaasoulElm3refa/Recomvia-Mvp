import type { Metadata } from "next";
import { PolicyPage } from "@/app/components/policy-page";
import { SITE_URL } from "@/lib/articles";
import { termsPolicyCopy } from "./policy-copy";

export const metadata: Metadata = { title: { absolute: "Recomvia Private Beta Terms" }, description: "Terms governing the Recomvia private beta.", alternates: { canonical: `${SITE_URL}/terms`, languages: { "en": `${SITE_URL}/terms`, "ar": `${SITE_URL}/ar/terms` } } };



export default function TermsPage() { return <PolicyPage copy={termsPolicyCopy} />; }
