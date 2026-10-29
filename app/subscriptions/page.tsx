import type { Metadata } from "next";
import { Suspense } from "react";
import { SITE_URL } from "@/lib/articles";
import { SubscriptionsContent } from "./subscriptions-content";

export const metadata: Metadata = {
  title: { absolute: "Recomvia Subscriptions & Billing — Reports, Monitoring & Fix Credits" },
  description:
    "One free score, a $4.99 initial report, and $24, $49 and $99 monthly plans for one or three projects.",
  alternates: { canonical: `${SITE_URL}/subscriptions` },
  openGraph: {
    title: "Recomvia Subscriptions & Billing — Reports, Monitoring & Fix Credits",
    description:
      "One free score, a $4.99 initial report, and $24, $49 and $99 monthly plans for one or three projects.",
    url: `${SITE_URL}/subscriptions`,
    type: "website",
  },
};

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionsContent />
    </Suspense>
  );
}
