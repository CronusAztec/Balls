import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getAllSlugs } from "@/content/blog";
import { pageUrl } from "@/lib/site";

/** Rendered at build time into out/sitemap.xml. Add new static routes here. */
const STATIC_PATHS = ["", "/simulator", "/blog", "/about", "/tiktok-ball-videos", "/feedback", "/privacy", "/terms", "/disclaimer"];

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  const paths = [...STATIC_PATHS, ...getAllSlugs().map((slug) => `/blog/${slug}`)];
  for (const p of paths) {
    const languages: Record<string, string> = {};
    for (const l of routing.locales) languages[l] = pageUrl(l, p);
    for (const l of routing.locales) {
      entries.push({
        url: pageUrl(l, p),
        lastModified: new Date(),
        changeFrequency: p === "" || p === "/simulator" ? "weekly" : "monthly",
        priority: p === "" ? 1 : p === "/simulator" ? 0.9 : 0.6,
        alternates: { languages },
      });
    }
  }
  return entries;
}
