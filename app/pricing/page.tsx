import type { Metadata } from "next";
import { SITE_URL } from "@/lib/articles";
import { PricingContent } from "./pricing-content";

export const metadata: Metadata = {
  title: { absolute: "Recomvia Plans" },
  description: "Choose full report access or preview upcoming Recomvia plans.",
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: { title: "Recomvia Plans", description: "Choose full report access or preview upcoming Recomvia plans.", url: `${SITE_URL}/pricing`, type: "website" },
};

export default function Pricing() {
  return <PricingContent />;
}
