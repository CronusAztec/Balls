import { routing } from "@/i18n/routing";
import { pageUrl } from "@/lib/site";

/**
 * Builds hreflang alternates for a path (used by every page's metadata). It lives here rather than in
 * app/[locale]/layout.tsx: a layout may only export Next's own fields, and the build's type guard for the
 * layout (generated whenever webpack keeps the layout in a page's chunk) rejects any other export.
 */
export function localeAlternates(path: string) {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = pageUrl(l, path);
  languages["x-default"] = pageUrl(routing.defaultLocale, path);
  return languages;
}
