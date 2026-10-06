import type { Metadata } from "next";
import { SITE_URL } from "@/lib/articles";
import { PricingContent } from "./pricing-content";

export const metadata: Metadata = {
  title: { absolute: "Recomvia Private Beta Pricing" },
  description: "Reserved validation pricing for Recomvia. Checkout is not active during the private beta.",
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: { title: "Recomvia Private Beta Pricing", description: "See reserved validation pricing and join the private beta. No payment is collected yet.", url: `${SITE_URL}/pricing`, type: "website" },
};

export default function Pricing() {
  return <PricingContent />;
}
