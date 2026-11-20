import assert from "node:assert/strict";
import test from "node:test";
import { pageDisplayLocale, readStoredSiteLocale, SITE_LOCALE_EVENT, SITE_LOCALE_STORAGE_KEY, storeSiteLocale } from "../lib/site-locale";

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
