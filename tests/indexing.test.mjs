import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const subscriptions = readFileSync("app/subscriptions/page.tsx", "utf8");
const pricing = readFileSync("app/pricing/page.tsx", "utf8");
const source = readFileSync("app/robots.ts", "utf8");

test("checkout return page is noindex while public pricing remains indexable", () => {
  assert.match(subscriptions, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  assert.match(subscriptions, /canonical:\s*`\$\{SITE_URL\}\/pricing`/);
  assert.doesNotMatch(pricing, /robots:\s*\{\s*index:\s*false/);
});
test("robots keeps account and authentication routes private but allows public pricing", () => {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)((name) => {
    if (name === "@/lib/articles") return { SITE_URL: "https://recomvia.test" };
    throw new Error("Unexpected import: " + name);
  }, mod, mod.exports);
  const doc = mod.exports.default();
  assert.equal(doc.host, "https://recomvia.test");
  assert.equal(doc.sitemap, "https://recomvia.test/sitemap.xml");
  const denied = doc.rules[0].disallow;
  for (const path of ["/api/", "/auth/", "/signin-with-chatgpt", "/signout-with-chatgpt", "/dashboard", "/report", "/fix-center", "/support/inbox", "/support/fix-reviews"]) {
    assert.ok(denied.includes(path), path);
  }
  assert.ok(!denied.includes("/pricing"));
  assert.ok(!denied.includes("/subscriptions")); // crawler must see the noindex directive
});

test("sitemap pairs every public English and Arabic URL with reciprocal hreflang links", () => {
  const js = ts.transpileModule(readFileSync("app/sitemap.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const articles = [
    { slug: "first-article", modified: "2026-11-10" },
    { slug: "second-article", modified: "2026-11-11" },
  ];
  new Function("require", "module", "exports", js)((name) => {
    if (name === "@/lib/articles") return { SITE_URL: "https://recomvia.test", articles };
    throw new Error("Unexpected import: " + name);
  }, mod, mod.exports);

  const rows = mod.exports.default();
  const base = "https://recomvia.test";
  const byUrl = new Map(rows.map((row) => [row.url, row]));
  const paths = ["", "/blog", "/contact", "/faq", "/methodology", "/pricing", "/privacy", "/terms", "/billing-policy", ...articles.map((article) => `/blog/${article.slug}`)];
  assert.equal(rows.length, paths.length * 2);
  assert.equal(byUrl.size, rows.length, "duplicate sitemap URLs");
  for (const path of paths) {
    const english = `${base}${path}`;
    const arabic = `${base}/ar${path}`;
    for (const url of [english, arabic]) {
      const row = byUrl.get(url);
      assert.ok(row, `missing public URL: ${url}`);
      assert.deepEqual(row.alternates?.languages, { en: english, ar: arabic }, `wrong hreflang pair: ${url}`);
      const article = articles.find((item) => path === `/blog/${item.slug}`);
      if (article) {
        assert.equal(row.lastModified?.toISOString(), `${article.modified}T00:00:00.000Z`,
          `article must publish its verified modified date: ${url}`);
      } else {
        assert.equal(Object.hasOwn(row, "lastModified"), false,
          `static page must not advertise an invented modification date: ${url}`);
      }
    }
  }
  for (const row of rows) {
    assert.ok(!/\/(api|dashboard|report|fix-center|auth|subscriptions)(\/|$)/.test(new URL(row.url).pathname), `private route in sitemap: ${row.url}`);
  }
});
