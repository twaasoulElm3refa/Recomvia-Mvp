import type { Metadata } from "next";
import { SITE_URL } from "@/lib/articles";
import { MethodologyContent } from "./methodology-content";

export const metadata: Metadata = {
  title: { absolute: "Recomvia Measurement Methodology" },
  description: "How Recomvia separates live website readiness from actual AI answer visibility, records evidence, versions scores, and states measurement limits.",
  alternates: { canonical: `${SITE_URL}/methodology` },
  openGraph: { title: "Recomvia Measurement Methodology", description: "A transparent methodology for readiness and AI visibility evidence.", url: `${SITE_URL}/methodology`, type: "website" },
};

export default function Methodology() {
  return <MethodologyContent />;
}
