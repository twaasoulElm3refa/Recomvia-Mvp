export type SiteLocale = "en" | "ar";

export const SITE_LOCALE_STORAGE_KEY = "recomvia-site-locale";
export const SITE_LOCALE_EVENT = "recomvia:locale-change";

export function readStoredSiteLocale(fallback: SiteLocale = "en"): SiteLocale {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(SITE_LOCALE_STORAGE_KEY);
    return value === "ar" || value === "en" ? value : fallback;
  } catch {
    return fallback;
  }
}

export function storeSiteLocale(locale: SiteLocale) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SITE_LOCALE_STORAGE_KEY, locale);
  } catch {
    // The interface still switches when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<SiteLocale>(SITE_LOCALE_EVENT, { detail: locale }));
}
