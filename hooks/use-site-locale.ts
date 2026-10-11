"use client";
import { useSyncExternalStore } from "react";
import { readStoredSiteLocale, SITE_LOCALE_EVENT } from "@/lib/site-locale";
function subscribe(notify: () => void) {
  window.addEventListener(SITE_LOCALE_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(SITE_LOCALE_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}
export function useSiteLocale() {
  return useSyncExternalStore(
    subscribe,
    readStoredSiteLocale,
    () => "en" as const,
  );
}
