const DEFAULT_SITE_URL = "https://recomvia.recomvia.workers.dev";

export function normalizedOrigin(value: string | undefined) {
  if (!value) return DEFAULT_SITE_URL;
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
      return DEFAULT_SITE_URL;
    }
    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** Public canonical origin used in metadata, structured data, robots and sitemaps. */
export const SITE_URL = normalizedOrigin(
  process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || process.env.APP_URL,
);

export const SITE_NAME = "Recomvia";
