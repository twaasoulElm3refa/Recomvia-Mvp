import type { MetadataRoute } from "next";
import { articles, SITE_URL } from "@/lib/articles";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages=["","/blog","/contact","/faq","/methodology","/pricing","/privacy","/terms","/billing-policy"];
  const arabicPages=["/ar","/ar/blog","/ar/contact","/ar/faq","/ar/methodology","/ar/pricing","/ar/privacy","/ar/terms","/ar/billing-policy"];
  return [
    ...staticPages.map(path=>({url:`${SITE_URL}${path}`,lastModified:new Date("2026-09-21"),changeFrequency:path==="/blog"||path==="/faq"?"weekly" as const:"monthly" as const,priority:path===""?1:path==="/blog"?.9:path==="/faq"?.85:.7})),
    ...articles.map(article=>({url:`${SITE_URL}/blog/${article.slug}`,lastModified:new Date(article.modified),changeFrequency:"monthly" as const,priority:.8})),
    ...arabicPages.map(path=>({url:`${SITE_URL}${path}`,lastModified:new Date("2026-09-21"),changeFrequency:path==="/ar/blog"?"weekly" as const:"monthly" as const,priority:path==="/ar"?1:path==="/ar/blog"?.85:.7})),
    ...articles.map(article=>({url:`${SITE_URL}/ar/blog/${article.slug}`,lastModified:new Date(article.modified),changeFrequency:"monthly" as const,priority:.8})),
  ];
}
