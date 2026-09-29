/** Central place for branding. Change these two values to rebrand the whole site. */
export const SITE_NAME = "JumpingBallsLive";
export const SITE_DOMAIN = "jumpingballslive.com";

/**
 * Sub-folder the site is served from ("" for the domain root, "/Balls" for a GitHub Pages
 * project site). Mirrors `basePath` in next.config.ts. `next/link` and `next/image` add it
 * automatically; plain `<img>`, `fetch()` and `<audio>` URLs must go through assetPath().
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

/** Absolute public URL of the site, including the base path (no trailing slash). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:3000${BASE_PATH}`).replace(/\/+$/, "");

/** Prefixes a `/public` asset path with the base path: assetPath("/notes/x.mid"). */
export function assetPath(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Absolute URL of a public asset (Open Graph images, icons, JSON-LD). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Canonical URL of a localised page, with the trailing slash the static export uses:
 * pageUrl("en") → https://example.com/en/, pageUrl("pl", "/about") → https://example.com/pl/about/
 */
export function pageUrl(locale: string, path = ""): string {
  const clean = path.replace(/\/+$/, "");
  return `${SITE_URL}/${locale}${clean}/`;
}

/** Accent colour used across the UI (buttons, sliders, active states). */
export const ACCENT = "#93d119";
export const ACCENT_LIGHT = "#b0f02a";
