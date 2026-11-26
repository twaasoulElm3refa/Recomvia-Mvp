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


test("FAQ search announces results and language controls preserve canonical deep links", () => {
  const element = (type, props) => ({ type, props });
  const Button = () => null;
  const Input = () => null;
  const stub = () => null;
  const entries = [
    { id: "measurement", category: "Measurement", question: "What is visibility?", answer: "Evidence", questionAr: "ما الظهور؟", answerAr: "الأدلة" },
    { id: "billing", category: "Billing", question: "What is the price?", answer: "Plans", questionAr: "ما السعر؟", answerAr: "الباقات" },
  ];
  let cursor = 0;
  let effect;
  const state = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = value; }];
    },
    useMemo: (compute) => compute(),
    useEffect: (callback) => { effect = callback; },
  };
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
  const stored = [];
  const locale = load("lib/site-locale.ts");
  const { FaqExplorer } = load("app/faq/faq-explorer.tsx", {
    react,
    "lucide-react": { Search: stub, SlidersHorizontal: stub },
    "@/components/ui/accordion": { Accordion: stub, AccordionContent: stub, AccordionItem: stub, AccordionTrigger: stub },
    "@/components/ui/button": { Button },
    "@/components/ui/input": { Input },
    "@/lib/site-locale": { ...locale, readStoredSiteLocale: () => "en", storeSiteLocale: (value) => stored.push(value) },
  });
  const assigned = [];
  const listeners = new Map();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = { pathname: "/ar/faq/", search: "?source=blog", hash: "#billing", assign: (href) => assigned.push(href) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location, setTimeout: (callback) => { callback(); return 1; }, clearTimeout: () => {},
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  } });
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== "object" || !node.props) return [];
    return [node, ...nodes(node.props.children)];
  }
  function render(initialLocale = "ar") {
    cursor = 0;
    return FaqExplorer({ entries, initialLocale });
  }
  try {
    const first = render();
    assert.equal(first.props.dir, "rtl");
    const cleanup = effect();
    const tree = nodes(render());
    assert.equal(state[0], "ar", "trailing slash must not let stored English override Arabic route");
    const search = tree.find((node) => node.type === Input).props;
    assert.equal(search["aria-label"], "ابحث في الأسئلة والإجابات");
    assert.match(search.className, /ps-10/);
    const languageButtons = tree.filter((node) => node.type === Button);
    assert.deepEqual(languageButtons.map((node) => node.props["aria-pressed"]), [true, false]);
    languageButtons[0].props.onClick();
    assert.deepEqual(assigned, [], "clicking current language must not reload or clear search");
    assert.deepEqual(stored, []);
    const filters = tree.filter((node) => node.type === "button");
    assert.deepEqual(filters.map((node) => node.props["aria-pressed"]), [true, false, false]);
    filters[2].props.onClick();
    const filtered = nodes(render());
    assert.deepEqual(filtered.filter((node) => node.type === "button").map((node) => node.props["aria-pressed"]), [false, false, true]);
    const result = filtered.find((node) => node.props.role === "status");
    assert.equal(result.props["aria-live"], "polite");
    assert.equal(result.props.children[0], 1);
    search.onChange({ target: { value: "no matching phrase" } });
    assert.equal(nodes(render()).find((node) => node.props.role === "status").props.children[0], 0);
    languageButtons[1].props.onClick();
    assert.deepEqual(stored, ["en"]);
    assert.deepEqual(assigned, ["/faq?source=blog#billing"]);
    location.pathname = "/faq/";
    listeners.get(locale.SITE_LOCALE_EVENT)();
    const english = render("en");
    assert.equal(english.props.dir, "ltr");
    const englishNodes = nodes(english);
    assert.equal(englishNodes.find((node) => node.type === Input).props["aria-label"], "Search questions and answers");
    assert.deepEqual(englishNodes.filter((node) => node.type === Button).map((node) => node.props["aria-pressed"]), [false, true]);
    cleanup();
    assert.equal(listeners.size, 0);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});


test("privacy, terms and billing policy contact links retain the canonical public language", () => {
  const element = (type, props) => ({ type, props });
  const PublicShell = () => null;
  const Link = () => null;
  const base = "https://recomvia.test";
  function load(path, dependencies = {}) {
    const js = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", js)((name) => {
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: Symbol.for("react.fragment") };
      if (name === "@/lib/articles" || name === "@/lib/site-config") return { SITE_URL: base };
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error("Unexpected dependency: " + name);
    }, mod, mod.exports);
    return mod.exports;
  }
  const { PolicyPage } = load("app/components/policy-page.tsx", {
    "@/app/components/navigation-link": { NavigationLink: Link },
    "@/app/components/public-shell": { PublicShell },
    "@/lib/site-locale": load("lib/site-locale.ts"),
  });
  function collect(node) {
    if (Array.isArray(node)) return node.flatMap(collect);
    if (!node || typeof node !== "object" || !node.props) return [];
    return [...(node.type === Link ? [node.props] : []), ...collect(node.props.children)];
  }
  for (const policy of ["privacy", "terms", "billing-policy"]) {
    const copy = load("app/" + policy + "/policy-copy.ts");
    for (const locale of ["en", "ar"]) {
      const prefix = locale === "ar" ? "/ar" : "";
      const page = load("app" + prefix + "/" + policy + "/page.tsx", {
        "@/app/components/policy-page": { PolicyPage },
        [locale === "ar" ? "@/app/" + policy + "/policy-copy" : "./policy-copy"]: copy,
      });
      const route = page.default();
      const shell = PolicyPage(route.props);
      assert.equal(shell.props.initialLocale, locale);
      assert.equal(page.metadata.alternates.canonical, base + prefix + "/" + policy);
      const links = collect(shell.props.children(locale));
      assert.ok(links.length > 0, policy + " must offer a support contact");
      for (const link of links) {
        assert.equal(link.href, prefix + "/contact", policy + " " + locale);
        assert.ok(link.children.trim().length > 0);
      }
    }
  }
});
