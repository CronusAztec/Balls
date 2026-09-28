import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Rendered at build time into out/robots.txt. Note: search engines only read robots.txt from
 * the domain root, so on a GitHub Pages *project* site (https://user.github.io/repo/) this file
 * is informational only; the sitemap URL is still useful when submitted manually.
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
