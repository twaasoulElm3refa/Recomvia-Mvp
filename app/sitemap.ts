import type { MetadataRoute } from "next";
import { articles, SITE_URL } from "@/lib/articles";

const staticPages = ["", "/blog", "/contact", "/faq", "/methodology", "/pricing", "/privacy", "/terms", "/billing-policy"];

/** Keep language alternatives reciprocal for each English/Arabic route pair. */
function languageAlternates(englishPath: string) {
  return {
    languages: {
      en: `${SITE_URL}${englishPath}`,
      ar: `${SITE_URL}/ar${englishPath}`,
    },
  };
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...staticPages.map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: path === "/blog" || path === "/faq" ? "weekly" as const : "monthly" as const,
      priority: path === "" ? 1 : path === "/blog" ? 0.9 : path === "/faq" ? 0.85 : 0.7,
      alternates: languageAlternates(path),
    })),
    ...articles.map((article) => ({
      url: `${SITE_URL}/blog/${article.slug}`,
      lastModified: new Date(article.modified),
      changeFrequency: "monthly" as const,
      priority: 0.8,
      alternates: languageAlternates(`/blog/${article.slug}`),
    })),
    ...staticPages.map((path) => ({
      url: `${SITE_URL}/ar${path}`,
      changeFrequency: path === "/blog" ? "weekly" as const : "monthly" as const,
      priority: path === "" ? 1 : path === "/blog" ? 0.85 : 0.7,
      alternates: languageAlternates(path),
    })),
    ...articles.map((article) => ({
      url: `${SITE_URL}/ar/blog/${article.slug}`,
      lastModified: new Date(article.modified),
      changeFrequency: "monthly" as const,
      priority: 0.8,
      alternates: languageAlternates(`/blog/${article.slug}`),
    })),
  ];
}
