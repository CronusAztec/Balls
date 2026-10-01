import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";

/**
 * Rendered at build time into out/sitemap.xml. Add new static routes here – only indexable ones: a page whose metadata says
 * `robots: { index: false }` (the feedback form) stays out (--- review fix (site-static) ---).
 */
const STATIC_PATHS: readonly string[] = ["", "/simulator", "/about", "/tiktok-ball-videos", "/privacy", "/terms", "/disclaimer", "/gallery" /* --- daily-gallery --- the preset gallery */];

export const dynamic = "force-static";

/**
 * --- review fix (site-static) --- The date of the deployed commit (the workflow sets SITEMAP_LASTMOD from `git log -1 --format=%cI`),
 * not the build time: a rebuild of the same content does not mark every URL as modified. Without it, no lastmod is written.
 */
function lastModified(): string | undefined {
  const value = process.env.SITEMAP_LASTMOD?.trim();
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  const lastmod = lastModified();
  for (const p of [...STATIC_PATHS, "/download" /* --- desktop-exe --- the Windows app */]) {
    // The same hreflang set as every page's <head> (localeAlternates), x-default included.
    const languages = localeAlternates(p);
    for (const l of routing.locales) {
      entries.push({
        url: pageUrl(l, p),
        ...(lastmod ? { lastModified: lastmod } : {}),
        changeFrequency: p === "" || p === "/simulator" ? "weekly" : "monthly",
        priority: p === "" ? 1 : p === "/simulator" ? 0.9 : 0.6,
        alternates: { languages },
      });
    }
  }
  return entries;
}
