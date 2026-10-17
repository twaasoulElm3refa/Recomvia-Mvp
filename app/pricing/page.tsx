import type { Metadata } from "next";
import { SITE_URL } from "@/lib/articles";
import { PricingContent } from "./pricing-content";

export const metadata: Metadata = {
  title: { absolute: "Recomvia Pricing — Reports, Monitoring & Fix Credits" },
  description: "One free score, a $4.99 initial report, and $24, $49 and $99 monthly plans for one or three projects.",
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: { title: "Recomvia Pricing — Reports, Monitoring & Fix Credits", description: "One free score, a $4.99 initial report, and $24, $49 and $99 monthly plans for one or three projects.", url: `${SITE_URL}/pricing`, type: "website" },
};

export default function Pricing() {
  return <PricingContent />;
}
