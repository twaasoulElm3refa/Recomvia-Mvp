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


test("contact structured data uses the canonical URL of each language route", () => {
  const base = "https://recomvia.test";
  const element = (type, props) => ({ type, props });
  const PublicShell = () => null;
  const ContactForm = () => null;
  const icon = () => null;
  function load(path, dependencies) {
    const js = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", js)((name) => {
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
      if (name === "@/lib/articles" || name === "@/lib/site-config") return { SITE_URL: base };
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error("Unexpected dependency: " + name);
    }, mod, mod.exports);
    return mod.exports;
  }
  const { ContactContent } = load("app/contact/contact-content.tsx", {
    "lucide-react": { Bot: icon, Headphones: icon, MessagesSquare: icon, ShieldCheck: icon },
    "@/app/components/public-shell": { PublicShell },
    "./contact-form": { ContactForm },
  });
  for (const [locale, path, dependency, expectedPath] of [
    ["en", "app/contact/page.tsx", "./contact-content", "/contact"],
    ["ar", "app/ar/contact/page.tsx", "@/app/contact/contact-content", "/ar/contact"],
  ]) {
    const page = load(path, { [dependency]: { ContactContent } });
    const route = page.default();
    const shell = ContactContent(route.props);
    assert.equal(shell.type, PublicShell);
    assert.equal(shell.props.initialLocale, locale);
    const main = shell.props.children(locale);
    const script = main.props.children.find((child) => child.type === "script");
    assert.equal(script.props.type, "application/ld+json");
    const schema = JSON.parse(script.props.dangerouslySetInnerHTML.__html);
    assert.equal(schema["@type"], "ContactPage");
    assert.equal(schema.inLanguage, locale);
    assert.equal(schema.url, base + expectedPath);
    assert.equal(schema.url, page.metadata.alternates.canonical);
    assert.equal(schema.url, page.metadata.openGraph.url);
    assert.equal(schema.about["@id"], base + "/#organization");
  }
});


test("pricing public links preserve the route language without changing private destinations or payment gates", () => {
  const element = (type, props) => ({ type, props });
  const PublicShell = () => null;
  const Link = () => null;
  const Button = () => null;
  const icon = () => null;
  function load(path, dependencies = {}) {
    const js = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", js)((name) => {
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error("Unexpected dependency: " + name);
    }, mod, mod.exports);
    return mod.exports;
  }
  const { PricingContent } = load("app/pricing/pricing-content.tsx", {
    "lucide-react": { ArrowRight: icon, Check: icon, Coins: icon, Layers3: icon },
    "@/app/components/navigation-link": { NavigationLink: Link },
    "@/app/components/public-shell": { PublicShell },
    "@/components/ui/button": { Button },
    "@/lib/plans": load("lib/plans.ts"),
    "@/lib/site-locale": load("lib/site-locale.ts"),
  });
  function collect(node, type) {
    if (Array.isArray(node)) return node.flatMap((child) => collect(child, type));
    if (!node || typeof node !== "object" || !node.props) return [];
    return [...(node.type === type ? [node.props] : []), ...collect(node.props.children, type)];
  }
  for (const locale of ["en", "ar"]) {
    const prefix = locale === "ar" ? "/ar" : "";
    const publicLinks = [prefix || "/", prefix + "/contact?product=fix-credits", prefix + "/billing-policy"];
    for (const paymentsEnabled of [false, true]) {
      const shell = PricingContent({ initialLocale: locale, paymentsEnabled });
      assert.equal(shell.props.initialLocale, locale);
      const main = shell.props.children(locale);
      const links = collect(main, Link).map((props) => props.href);
      const privateLinks = paymentsEnabled ? ["/dashboard", "/subscriptions?plan=essential", "/subscriptions?plan=growth", "/subscriptions?plan=pro"] : [];
      assert.deepEqual(links.sort(), [...publicLinks, ...privateLinks].sort());
      assert.equal(collect(main, Button).filter((props) => props.disabled === true).length, paymentsEnabled ? 0 : 4);
    }
  }
});


test("methodology calls to action preserve public locale and identify the private report accurately", () => {
  const element = (type, props) => ({ type, props });
  const PublicShell = () => null;
  const Link = () => null;
  const stub = () => null;
  function load(path, dependencies = {}) {
    const js = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", js)((name) => {
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: Symbol.for("react.fragment") };
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error("Unexpected import: " + name);
    }, mod, mod.exports);
    return mod.exports;
  }
  const { MethodologyContent } = load("app/methodology/methodology-content.tsx", {
    "lucide-react": Object.fromEntries(["ArrowRight", "BarChart3", "Bot", "Check", "CircleAlert", "Clock3", "FileSearch", "Globe2", "Repeat2", "Scale", "ShieldCheck"].map((name) => [name, stub])),
    "@/app/components/navigation-link": { NavigationLink: Link },
    "@/app/components/public-shell": { PublicShell },
    "@/components/ui/button": { Button: stub },
    "@/components/ui/card": { Card: stub, CardContent: stub },
    "@/lib/site-locale": load("lib/site-locale.ts"),
  });
  function links(node) {
    if (Array.isArray(node)) return node.flatMap(links);
    if (!node || typeof node !== "object" || !node.props) return [];
    return [...(node.type === Link ? [node.props] : []), ...links(node.props.children)];
  }
  for (const [locale, home, runLabel, reportLabel] of [
    ["en", "/", "Run free score", "View my report"],
    ["ar", "/ar", "ابدأ الفحص المجاني", "اعرض تقريري"],
  ]) {
    const shell = MethodologyContent({ initialLocale: locale });
    assert.equal(shell.props.initialLocale, locale);
    const actions = links(shell.props.children(locale));
    assert.deepEqual(actions.map(({ href }) => href), [home, "/report"]);
    assert.equal(actions[0].children[0], runLabel);
    assert.equal(actions[1].children, reportLabel);
  }
});
