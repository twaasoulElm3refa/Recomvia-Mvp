import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { articles, SITE_URL } from "@/lib/articles";
import { getLocalizedArticle } from "@/lib/articles-ar";
import { ArticleContent } from "@/app/blog/[slug]/article-content";

export function generateStaticParams() {
  return articles.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = getLocalizedArticle(slug, "ar");
  if (!article) return {};
  const url = `${SITE_URL}/ar/blog/${article.slug}`;
  return {
    title: article.seoTitle,
    description: article.description,
    keywords: article.keywords,
    authors: [{ name: "أبحاث Recomvia", url: SITE_URL }],
    alternates: {
      canonical: url,
      languages: {
        "ar": url,
        "en": `${SITE_URL}/blog/${article.slug}`,
      },
    },
    openGraph: {
      title: article.seoTitle,
      description: article.description,
      type: "article",
      locale: "ar_SA",
      url,
      publishedTime: article.published,
      modifiedTime: article.modified,
    },
    twitter: { card: "summary", title: article.seoTitle, description: article.description },
  };
}

export default async function ArabicArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLocalizedArticle(slug, "ar")) notFound();
  return <ArticleContent slug={slug} initialLocale="ar" />;
}
