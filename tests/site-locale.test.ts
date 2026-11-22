import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pageDisplayLocale, publicHrefForLocale, readStoredSiteLocale, SITE_LOCALE_EVENT, SITE_LOCALE_STORAGE_KEY, storeSiteLocale } from "../lib/site-locale";

test("keeps explicit English and Arabic choices across page reads and notifies listeners", () => {
  const data = new Map<string, string>();
  const events: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) },
    dispatchEvent: (event: Event) => { events.push(event.type); return true; },
  } });
  try {
    storeSiteLocale("ar");
    assert.equal(readStoredSiteLocale("en"), "ar");
    storeSiteLocale("en");
    assert.equal(readStoredSiteLocale("ar"), "en");
    assert.equal(data.get(SITE_LOCALE_STORAGE_KEY), "en");
    assert.deepEqual(events, [SITE_LOCALE_EVENT, SITE_LOCALE_EVENT]);
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("assistant language follows canonical public routes and workspace preference", () => {
  assert.equal(pageDisplayLocale("/", "ar"), "en");
  assert.equal(pageDisplayLocale("/ar", "en"), "ar");
  assert.equal(pageDisplayLocale("/ar/blog/ai-visibility", "en"), "ar");
  assert.equal(pageDisplayLocale("/blog/ai-visibility", "ar"), "en");
  assert.equal(pageDisplayLocale("/ar/pricing", "en"), "ar");
  assert.equal(pageDisplayLocale("/pricing", "ar"), "en");
  assert.equal(pageDisplayLocale("/faq", "ar"), "en");
  assert.equal(pageDisplayLocale("/ar/faq", "en"), "ar");
  assert.equal(pageDisplayLocale("/dashboard", "ar"), "ar");
  assert.equal(pageDisplayLocale("/dashboard", "en"), "en");
  assert.equal(pageDisplayLocale("/report?scan=example", "ar"), "ar");
  assert.equal(pageDisplayLocale("/fix-center", "ar"), "ar");
  assert.equal(pageDisplayLocale("/subscriptions", "ar"), "ar");
});

test("public navigation keeps Arabic readers on canonical Arabic routes without rewriting private links", () => {
  for (const [href, arabic] of [
    ["/", "/ar"],
    ["/#product", "/ar#product"],
    ["/pricing", "/ar/pricing"],
    ["/blog/ai-visibility-guide", "/ar/blog/ai-visibility-guide"],
    ["/faq?source=blog#guarantee", "/ar/faq?source=blog#guarantee"],
  ]) {
    assert.equal(publicHrefForLocale(href, "ar"), arabic, href);
    assert.equal(publicHrefForLocale(href, "en"), href, href);
  }
  for (const href of [
    "/dashboard", "/auth/start", "/report", "/fix-center", "/subscriptions",
    "/ar", "/ar/blog", "/ar#product", "/pricing-preview",
    "//untrusted.example/path", "https://untrusted.example/path",
  ]) {
    assert.equal(publicHrefForLocale(href, "ar"), href, href);
  }

  const shell = readFileSync("app/components/public-shell.tsx", "utf8");
  assert.match(shell, /href: localizedHref\(href\)/, "main navigation must localize links");
  assert.equal((shell.match(/href=\{localizedHref\("\/"\)\}/g) ?? []).length, 2,
    "brand logo and scan CTA must preserve Arabic homepage routing");
});


test("public shell preserves canonical homepage language and switches by URL", () => {
  const shell = readFileSync("app/components/public-shell.tsx", "utf8");
  // This is the actual client hydration/storage-event path, not just the helper.
  assert.match(shell, /pageDisplayLocale\(window\.location\.pathname,\s*readStoredSiteLocale\("en"\)\)/);
  // Both homepages must participate in the same route-based language switch as blog pages.
  assert.match(shell, /pathname === "\/" \|\| pathname === "\/ar"/);
  assert.match(shell, /englishPath === "\/" \? "\/ar"/);
  for (const [pathname, preference, expected] of [
    ["/", "ar", "en"], ["/ar", "en", "ar"], ["/ar/", "en", "ar"],
    ["/blog/example", "ar", "en"], ["/ar/blog/example", "en", "ar"],
    ["/dashboard", "ar", "ar"], ["/dashboard", "en", "en"],
  ] as const) {
    assert.equal(pageDisplayLocale(pathname, preference), expected, pathname);
  }
});
