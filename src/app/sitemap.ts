import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";
import { CHANGELOG, latestRelease } from "@/content/changelog"; // --- seo --- the dates of the changelog and the download page
import { LEGAL_LAST_UPDATED } from "@/lib/legalDates"; // --- seo --- the legal pages' "last updated"

/**
 * Rendered at build time into out/sitemap.xml. Add new static routes here – only indexable ones: a page whose metadata says
 * `robots: { index: false }` (the feedback form, the account page) stays out (--- review fix (site-static) ---).
 */
const STATIC_PATHS: readonly string[] = ["", "/simulator", "/about", "/tiktok-ball-videos", "/privacy", "/terms", "/disclaimer", "/gallery" /* --- daily-gallery --- the preset gallery */, "/download" /* --- desktop-exe --- the Windows app */, "/pricing" /* --- paywall-gate --- Free and Pro */, "/changelog" /* --- changelog --- what changed, newest first */, "/press" /* --- press --- the press page */];

export const dynamic = "force-static";

/**
 * --- review fix (site-static) --- The date of the deployed commit (the workflow sets SITEMAP_LASTMOD from `git log -1 --format=%cI`),
 * not the build time: a rebuild of the same content does not mark every URL as modified. Without it, no lastmod is written.
 */
function lastModified(): string | undefined {
  const value = process.env.SITEMAP_LASTMOD?.trim();
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

/**
 * --- seo --- When a page last changed, as it is known: the changelog's is the newest release (either product), the download page's
 * the newest Windows app release, a legal page's its "Last updated" date. Every other page has no date of its own and takes the
 * deploy date: a commit that touches one page then does not re-date the three that carry a real date. `changeFrequency` and
 * `priority` are left out: Google ignores both.
 */
function lastModifiedOf(path: string, deployed: string | undefined): string | undefined {
  switch (path) {
    case "/changelog":
      return CHANGELOG[0]?.date;
    case "/download":
      return latestRelease("app")?.date;
    case "/privacy":
    case "/terms":
    case "/disclaimer":
      return LEGAL_LAST_UPDATED;
    default:
      return deployed;
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  const deployed = lastModified();
  for (const p of STATIC_PATHS) {
    // The same hreflang set as every page's <head> (localeAlternates), x-default included.
    const languages = localeAlternates(p);
    const lastmod = lastModifiedOf(p, deployed);
    for (const l of routing.locales) {
      entries.push({
        url: pageUrl(l, p),
        ...(lastmod ? { lastModified: lastmod } : {}),
        alternates: { languages },
      });
    }
  }
  return entries;
}
