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
  for (const path of ["/api/", "/auth/", "/signin-with-chatgpt", "/signout-with-chatgpt", "/dashboard", "/report", "/fix-center", "/support/inbox"]) {
    assert.ok(denied.includes(path), path);
  }
  assert.ok(!denied.includes("/pricing"));
  assert.ok(!denied.includes("/subscriptions")); // crawler must see the noindex directive
});
