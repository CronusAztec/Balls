import path from "path";

/*
 * --- desktop-exe --- The app:// protocol: the site's static export served the way GitHub Pages serves it (the same rules
 * as scripts/serve-static.mjs) – a folder redirects to its trailing-slash URL and serves its index.html, /foo serves
 * foo.html, anything else is 404.html with status 404, and nothing outside the export is ever read. The site is built with
 * an empty base path for the app, so app://jumpingballslive/en/simulator/ is out/en/simulator/index.html.
 */

export const APP_SCHEME = "app";
export const APP_HOST = "jumpingballslive";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export type SiteResolution = { kind: "file"; file: string; status: 200 | 404 } | { kind: "redirect"; location: string } | { kind: "missing" };

export interface StatLike {
  /** "file", "dir" or null when nothing is there. */
  kind(p: string): "file" | "dir" | null;
}

/** What a request path of the app:// origin serves (`pathname` is the URL's, still percent-encoded). */
export function resolveSiteRequest(root: string, pathname: string, search: string, fs: StatLike): SiteResolution {
  const base = path.resolve(root);
  const notFound = (): SiteResolution => (fs.kind(path.join(base, "404.html")) === "file" ? { kind: "file", file: path.join(base, "404.html"), status: 404 } : { kind: "missing" });
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname || "/");
  } catch {
    return notFound();
  }
  if (decoded.includes("\0")) return notFound();
  const resolved = path.resolve(base, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return notFound();
  const kind = fs.kind(resolved);
  if (kind === "dir") {
    if (!decoded.endsWith("/")) return { kind: "redirect", location: `${APP_ORIGIN}${pathname}/${search}` };
    const index = path.join(resolved, "index.html");
    return fs.kind(index) === "file" ? { kind: "file", file: index, status: 200 } : notFound();
  }
  if (kind === "file") return { kind: "file", file: resolved, status: 200 };
  if (!decoded.endsWith("/") && fs.kind(`${resolved}.html`) === "file") return { kind: "file", file: `${resolved}.html`, status: 200 };
  return notFound();
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** The start page for a system locale ("pl-PL" → /pl/simulator/). */
export function startUrl(locale: string, page = "simulator"): string {
  const lang = locale.toLowerCase().slice(0, 2);
  const supported = ["en", "pl", "es"].includes(lang) ? lang : "en";
  return `${APP_ORIGIN}/${supported}/${page ? `${page}/` : ""}`;
}

/** Whether a navigation stays inside the app (anything else opens in the system browser). */
export function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST;
  } catch {
    return false;
  }
}

/** Only web links go to the system browser (no file:, javascript:, custom schemes). */
export function isExternalWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}
