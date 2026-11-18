import type { Metadata } from "next";
import { SITE_URL } from "@/lib/articles";
import { BlogContent } from "@/app/blog/blog-content";

export const metadata: Metadata = {
  title: { absolute: "أبحاث وأدلة الظهور في الذكاء الاصطناعي | Recomvia" },
  description: "أدلة عربية لفهم وتحسين ظهور العلامات في إجابات الذكاء الاصطناعي، والاستشهادات، وAEO وGEO، ومراجعة الأدلة.",
  alternates: {
    canonical: `${SITE_URL}/ar/blog`,
    languages: { "ar": `${SITE_URL}/ar/blog`, "en": `${SITE_URL}/blog` },
  },
  openGraph: {
    title: "أبحاث وأدلة AI Visibility | Recomvia",
    description: "مقالات وأدلة عربية عملية لفهم الظهور في إجابات الذكاء الاصطناعي.",
    type: "website",
    locale: "ar_SA",
    url: `${SITE_URL}/ar/blog`,
  },
};

export default function ArabicBlogPage() {
  return <BlogContent initialLocale="ar" />;
}
