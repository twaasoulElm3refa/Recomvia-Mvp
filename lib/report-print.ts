export function printReportHref(scanId: string, locale: "en" | "ar") {
  return `/report/print?scan=${encodeURIComponent(scanId)}&lang=${locale}`;
}
