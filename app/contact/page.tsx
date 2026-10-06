import type { Metadata } from "next";
import { SITE_URL } from "@/lib/articles";
import { ContactContent } from "./contact-content";

export const metadata: Metadata = {
  title: { absolute: "Contact Recomvia — Product, Support & Partnerships" },
  description: "Contact Recomvia about AI visibility analysis, subscriptions, Fix Credits, expert services, technical support, partnerships, or media enquiries.",
  alternates: { canonical: `${SITE_URL}/contact` },
  openGraph: { title: "Contact Recomvia", description: "Reach the Recomvia team about product, support, expert services, partnerships, or media.", type: "website", url: `${SITE_URL}/contact` },
};

export default function ContactPage() {
  return <ContactContent />;
}
