import type { Metadata } from "next";
import { SITE_URL } from "@/lib/articles";
import { BlogContent } from "./blog-content";

export const metadata: Metadata = {
  title: { absolute: "AI Visibility Research & Guides | Recomvia" },
  description: "Evidence-led guides to AI visibility optimization, AEO, GEO, technical discovery, content extractability, entity clarity, citations, and measurement.",
  alternates: { canonical: `${SITE_URL}/blog` },
  openGraph: { title: "AI Visibility Research & Guides | Recomvia", description: "Practical, evidence-led guidance for measuring and improving brand visibility in AI answers.", type: "website", url: `${SITE_URL}/blog` },
};

export default function BlogPage() { return <BlogContent />; }
