import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/articles";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/auth/",
        "/signin-with-chatgpt",
        "/signout-with-chatgpt",
        "/dashboard",
        "/report",
        "/fix-center",
        "/support/inbox",
      ],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
