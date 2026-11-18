import type { Metadata } from "next";
import { SITE_URL } from "@/lib/articles";
import { FaqPageContent } from "./faq-page-content";

export const metadata: Metadata = {
  title: { absolute: "Recomvia FAQ — AI Visibility, Reports & Fixes" },
  description: "Clear answers about Recomvia AI visibility measurement, report access, subscriptions, Fix Credits, optimization, methodology, privacy, and human support.",
  alternates: { canonical: `${SITE_URL}/faq`, languages: { "en": `${SITE_URL}/faq`, "ar": `${SITE_URL}/ar/faq` } },
  openGraph: { title: "Recomvia FAQ — AI Visibility, Reports & Fixes", description: "Documented answers about measuring and improving visibility in AI-powered search and answer systems.", type: "website", url: `${SITE_URL}/faq` },
};

export default function FaqPage() {
  return <FaqPageContent />;
}
