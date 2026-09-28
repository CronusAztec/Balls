import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getAllSlugs } from "@/content/blog";
import { SITE_URL } from "@/lib/site";

const STATIC_PATHS = ["", "/simulator", "/blog", "/about", "/tiktok-ball-videos", "/feedback", "/privacy", "/terms", "/disclaimer"];

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  const paths = [...STATIC_PATHS, ...getAllSlugs().map((slug) => `/blog/${slug}`)];
  for (const p of paths) {
    const languages: Record<string, string> = {};
    for (const l of routing.locales) languages[l] = `${SITE_URL}/${l}${p}`;
    for (const l of routing.locales) {
      entries.push({
        url: `${SITE_URL}/${l}${p}`,
        lastModified: new Date(),
        changeFrequency: p === "" || p === "/simulator" ? "weekly" : "monthly",
        priority: p === "" ? 1 : p === "/simulator" ? 0.9 : 0.6,
        alternates: { languages },
      });
    }
  }
  return entries;
}
