import assert from "node:assert/strict";
import test from "node:test";
import { readStoredSiteLocale, SITE_LOCALE_EVENT, SITE_LOCALE_STORAGE_KEY, storeSiteLocale } from "../lib/site-locale";

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
