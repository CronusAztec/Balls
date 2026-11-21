import { locales, routing, type Locale } from "@/i18n/routing";

/*
 * --- site-nav --- An address typed without its language ("/pricing/", "/simulator/?mode=fightLeague") has no page: the
 * static export serves every page under /en/, /pl/ or /es/, and its host answers anything else with the 404 page. This
 * module says where such an address belongs, so the 404 page can send the visitor on: to the same page in the language
 * their browser asks for first (the negotiation src/app/(static)/page.tsx does for "/"), with the query and the hash kept.
 * Pure, no React. `unprefixedRedirectScript` is the same rule as an inline script: it runs before the 404 page is drawn.
 */

/**
 * The first segment of every page under src/app/[locale] (tests/siteStatic.test.ts compares the list with the folders).
 * Only these are sent on: any other address without a language stays a 404.
 */
export const KNOWN_ROUTES = ["about", "account", "changelog", "disclaimer", "download", "feedback", "gallery", "licences", "press", "pricing", "privacy", "simulator", "terms", "tiktok-ball-videos"] as const;

/** The site's language a browser asks for first ("pl-PL" → "pl"), the default when it asks for none of them. */
export function bestLocale(languages: readonly string[] | undefined | null): Locale {
  for (const language of languages ?? []) {
    const wanted = String(language).toLowerCase();
    const match = locales.find((locale) => wanted === locale || wanted.startsWith(`${locale}-`));
    if (match) return match;
  }
  return routing.defaultLocale;
}

/** The segments of a path under the site's base path ("/Balls/pricing/" with base "/Balls" → ["pricing"]). */
function segmentsOf(pathname: string, basePath: string): string[] {
  const path = basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
  return path.split("/").filter(Boolean);
}

/** The language an address names as its first segment, or null when it names none. */
export function localeOfPath(pathname: string, basePath = ""): Locale | null {
  const first = segmentsOf(pathname, basePath)[0];
  return (locales as readonly string[]).includes(first) ? (first as Locale) : null;
}

/**
 * Where an address without a language belongs: "/<base>/<language>/<route>/" with the query and the hash, when its first
 * segment is a known route and nothing follows it. Anything else gives null: an address with a language (a real 404), an
 * unknown first segment, a deeper path.
 */
export function unprefixedTarget(at: { pathname: string; search?: string; hash?: string }, languages: readonly string[] | undefined | null, basePath = ""): string | null {
  const segments = segmentsOf(at.pathname, basePath);
  if (segments.length !== 1 || !(KNOWN_ROUTES as readonly string[]).includes(segments[0])) return null;
  return `${basePath}/${bestLocale(languages)}/${segments[0]}/${at.search ?? ""}${at.hash ?? ""}`;
}

/**
 * The same rule as a script for the 404 page's HTML (plain ES5, no module: it runs while the page is parsed, before any
 * of it is drawn). tests/siteStatic.test.ts runs it against `unprefixedTarget` on the same addresses.
 */
export function unprefixedRedirectScript(basePath = ""): string {
  return `(function () {
  var locales = ${JSON.stringify(locales)};
  var routes = ${JSON.stringify(KNOWN_ROUTES)};
  var base = ${JSON.stringify(basePath)};
  var path = location.pathname;
  if (base && path.indexOf(base + "/") === 0) path = path.slice(base.length);
  var segments = path.split("/").filter(Boolean);
  if (segments.length !== 1 || routes.indexOf(segments[0]) < 0) return;
  var pick = ${JSON.stringify(routing.defaultLocale)};
  var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
  outer: for (var i = 0; i < langs.length; i++) {
    var l = String(langs[i]).toLowerCase();
    for (var j = 0; j < locales.length; j++) {
      if (l === locales[j] || l.indexOf(locales[j] + "-") === 0) { pick = locales[j]; break outer; }
    }
  }
  location.replace(base + "/" + pick + "/" + segments[0] + "/" + location.search + location.hash);
})();`;
}
