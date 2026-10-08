import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { articles, getArticle, SITE_URL } from "@/lib/articles";
import { ArticleContent } from "./article-content";

export function generateStaticParams() { return articles.map(article => ({ slug: article.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return {};
  const url = `${SITE_URL}/blog/${article.slug}`;
  return { title: article.seoTitle, description: article.description, keywords: article.keywords, authors: [{ name: "Recomvia Research", url: SITE_URL }], alternates: { canonical: url }, openGraph: { title: article.seoTitle, description: article.description, type: "article", url, publishedTime: article.published, modifiedTime: article.modified, authors: [SITE_URL], tags: article.keywords }, twitter: { card: "summary", title: article.seoTitle, description: article.description } };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getArticle(slug)) notFound();
  return <ArticleContent slug={slug} />;
}
