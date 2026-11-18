import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function source(path) {
  return readFileSync(path, "utf8");
}

test("Arabic blog routes have server metadata and reciprocal canonical-language links", () => {
  const englishBlog = source("app/blog/page.tsx");
  const arabicBlog = source("app/ar/blog/page.tsx");
  const englishArticle = source("app/blog/[slug]/page.tsx");
  const arabicArticle = source("app/ar/blog/[slug]/page.tsx");
  assert.match(englishBlog, /languages:\s*\{\s*"en":/);
  assert.match(englishBlog, /"ar":/);
  assert.match(arabicBlog, /initialLocale="ar"/);
  assert.match(arabicBlog, /canonical:\s*`\$\{SITE_URL\}\/ar\/blog`/);
  assert.match(arabicBlog, /"en":\s*`\$\{SITE_URL\}\/blog`/);
  assert.match(englishArticle, /"ar":\s*`\$\{SITE_URL\}\/ar\/blog\/\$\{article.slug\}`/);
  assert.match(arabicArticle, /getLocalizedArticle\(slug, "ar"\)/);
  assert.match(arabicArticle, /initialLocale="ar"/);
  assert.match(arabicArticle, /generateStaticParams/);
});

test("blog language links follow the requested locale, not just localStorage", () => {
  const shell = source("app/components/public-shell.tsx");
  const blog = source("app/blog/blog-content.tsx");
  const article = source("app/blog/[slug]/article-content.tsx");
  const home = source("app/scan-experience.tsx");
  assert.match(shell, /routeLocale\(window.location.pathname\)/);
  assert.match(shell, /initialLocale/);
  assert.match(shell, /window.location.assign/);
  assert.match(blog, /const blogRoot = locale === "ar"/);
  assert.match(article, /const blogRoot = locale === "ar"/);
  assert.match(home, /const blogRoot = rtl \? "\/ar\/blog" : "\/blog"/);
});

test("sitemap includes a matching English and Arabic path for every blog article", () => {
  const script = ts.transpileModule(source("app/sitemap.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mockedArticles = [
    { slug: "guide-one", modified: "2026-09-13" },
    { slug: "guide-two", modified: "2026-09-14" },
  ];
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", script)((specifier) => {
    if (specifier === "@/lib/articles") return { SITE_URL: "https://recomvia.test", articles: mockedArticles };
    throw new Error("Unexpected dependency: " + specifier);
  }, loadedModule, loadedModule.exports);
  const urls = loadedModule.exports.default().map((entry) => entry.url);
  assert.ok(urls.includes("https://recomvia.test/blog"));
  assert.ok(urls.includes("https://recomvia.test/ar/blog"));
  for (const article of mockedArticles) {
    assert.ok(urls.includes(`https://recomvia.test/blog/${article.slug}`));
    assert.ok(urls.includes(`https://recomvia.test/ar/blog/${article.slug}`));
  }
  assert.equal(new Set(urls).size, urls.length);
});
