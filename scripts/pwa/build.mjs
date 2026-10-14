/**
 * Installable offline app (feature pwa) – the build side, run by scripts/postexport.mjs after `next build`:
 *  - writes out/offline.html, the page the service worker shows for a page that was never cached while
 *    offline (the strings are the `Pwa` namespace of messages/*.json; it picks the language from the URL);
 *  - writes out/sw.js from scripts/pwa/sw.template.js with the precache list (the app shell: the landing and
 *    simulator pages of every language with their RSC payloads, the offline page, the manifest, every
 *    /_next/static file and the public assets) and a version hash of every exported file, so each deploy
 *    is a new worker whose caches replace the old ones.
 * --- precache-split --- The list is split in two (splitPrecache): the CRITICAL files (the landing of every language, the
 * offline page, manifest, icons, CSS, fonts: about half a megabyte) are fetched by the worker's install; the DEFERRED rest
 * (the studio, the mode pictures, the sounds, the other chunks: several megabytes) only when the page asks for it after it has
 * settled, and never on a Save-Data, cellular or slow connection (src/lib/pwa.ts shouldPrecacheRest). What is not cached up
 * front is cached the first time it is used, like every other page.
 * The site name, colours and base path come from out/manifest.webmanifest (src/app/manifest.ts).
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const SW_FILE = "sw.js";
export const OFFLINE_FILE = "offline.html";
export const MANIFEST_FILE = "manifest.webmanifest";
/** Pages of every language that work offline from the first visit on. */
export const SHELL_PAGES = ["", "simulator"];
/**
 * Public files that are not part of the app itself: the social preview, crawler files, the host's 404 page, and the files the host
 * reads or the build stamps (a `_headers` or `_redirects` file is never served, so a worker that listed it would get a 404 for it, and a
 * failed fetch fails the whole install; version.json / build.txt change with every build and say nothing the app needs offline).
 */
export const NOT_PRECACHED = new Set(["og.png", "robots.txt", "sitemap.xml", "404.html", SW_FILE, "version.json", "build.txt", "_headers", "_redirects"]);
/** Folders of the same kind: the per-page social cards (og/…) and the press kit's downloads (press/…). */
export const NOT_PRECACHED_PREFIXES = ["og/", "press/"];
/** Files larger than this are cached when first used instead of on install. */
export const MAX_PRECACHE_FILE_BYTES = 4 * 1024 * 1024;
/** --- precache-split --- The critical files (what the worker's install downloads, 0.8 MB unpacked today, about a fifth of that on the wire) may not grow beyond this: the build stops instead. */
export const MAX_CRITICAL_PRECACHE_BYTES = 1.5 * 1024 * 1024;

/** True for a file the worker must never list: an exact name or a folder of NOT_PRECACHED. */
export function isNotPrecached(file) {
  return NOT_PRECACHED.has(file) || NOT_PRECACHED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

/** Every file under `dir` as a sorted list of posix paths relative to it (dot files skipped). */
export function listFiles(dir) {
  const files = [];
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk("");
  return files.sort();
}

/** The URL (relative to the site root) a file is served at: folders for index.html, the path otherwise. */
export function fileToUrlPath(file) {
  if (file === "index.html") return "";
  if (file.endsWith("/index.html")) return file.slice(0, -"index.html".length);
  return file;
}

const PAGE_EXT = /\.(html?|txt|xml|map)$/i;

/**
 * The precache list, as URLs relative to the scope: the root redirect, the offline page, the shell pages of
 * every locale (HTML + the RSC payload Next fetches on client-side navigation), then every asset – the
 * content-hashed /_next/static files and the public files the app loads (icons, previews, melodies, sounds…).
 * Other pages are cached the first time they are opened.
 */
export function selectPrecache(files, { locales, shellPages = SHELL_PAGES, sizes = {}, maxFileBytes = MAX_PRECACHE_FILE_BYTES }) {
  const present = new Set(files);
  const urls = [];
  const add = (file) => {
    if (present.has(file)) urls.push(fileToUrlPath(file));
  };
  add("index.html");
  add(OFFLINE_FILE);
  for (const locale of locales) {
    for (const page of shellPages) {
      const folder = page ? `${locale}/${page}/` : `${locale}/`;
      add(`${folder}index.html`);
      add(`${folder}index.txt`);
    }
  }
  for (const file of files) {
    if (isNotPrecached(file) || file === OFFLINE_FILE) continue;
    if (!file.startsWith("_next/static/") && PAGE_EXT.test(file)) continue;
    if (file.endsWith(".map")) continue;
    if ((sizes[file] ?? 0) > maxFileBytes) continue;
    add(file);
  }
  return [...new Set(urls)];
}

/**
 * --- precache-split --- Splits a precache list (selectPrecache) into the files the worker's install downloads and the rest.
 * critical: the root redirect, the offline page, the manifest and the icons, the stylesheets and fonts, and the landing page of
 * every locale (HTML + RSC payload) – what a first visitor on a bad connection needs for the app to be installable and to show its
 * offline page; deferred: everything else (the studio shells and chunks, mode pictures, sounds), cached when the page asks for it
 * on a good connection, or on first use. Every url lands in exactly one of the two, in the list's order.
 */
export function splitPrecache(urls, { locales }) {
  const landing = new Set(locales.flatMap((locale) => [`${locale}/`, `${locale}/index.txt`]));
  const isCritical = (url) =>
    url === "" ||
    url === OFFLINE_FILE ||
    url === MANIFEST_FILE ||
    url === "icon.svg" ||
    landing.has(url) ||
    url.startsWith("icons/") ||
    url.startsWith("_next/static/css/") ||
    url.startsWith("_next/static/media/");
  const critical = [];
  const deferred = [];
  for (const url of urls) (isCritical(url) ? critical : deferred).push(url);
  return { critical, deferred };
}

/** Version of an export: a hash over every file's path and content (and the worker's template), 16 hex digits. */
export function hashExport(dir, files, extra = "") {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    if (file === SW_FILE) continue;
    hash.update(file);
    hash.update("\0");
    hash.update(crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest());
  }
  hash.update(extra);
  return hash.digest("hex").slice(0, 16);
}

/** out/sw.js: the template with its configuration (version, precache list, offline page, cache prefix). */
export function renderServiceWorker(template, config) {
  const marker = "__PWA_CONFIG__";
  const at = template.indexOf(marker);
  if (at < 0 || template.indexOf(marker, at + marker.length) >= 0) throw new Error("sw template: expected exactly one __PWA_CONFIG__");
  const json = JSON.stringify(config, null, 2).replace(/</g, "\\u003c");
  return `${template.slice(0, at)}${json}${template.slice(at + marker.length)}`;
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const OFFLINE_KEYS = ["offlinePageTitle", "offlineTitle", "offlineBody", "offlineRetry", "offlineSimulator"];

/**
 * out/offline.html – a self-contained page (inline styles, inline icon, no Next.js runtime) in every language:
 * rendered in the default one, it switches to the language of the URL it answers for (/<base>/<locale>/…),
 * else the browser's, and reloads itself when the connection comes back.
 */
export function renderOfflinePage({ basePath, siteName, defaultLocale, messages, iconSvg, backgroundColor, accent, accentLight }) {
  const strings = {};
  for (const [locale, all] of Object.entries(messages)) {
    const pwa = all?.Pwa;
    if (!pwa) throw new Error(`offline page: messages/${locale}.json has no Pwa namespace`);
    strings[locale] = {};
    for (const key of OFFLINE_KEYS) {
      if (typeof pwa[key] !== "string") throw new Error(`offline page: Pwa.${key} missing in messages/${locale}.json`);
      strings[locale][key] = pwa[key].replace(/\{siteName\}/g, siteName);
    }
  }
  const t = strings[defaultLocale] ?? Object.values(strings)[0];
  const lang = strings[defaultLocale] ? defaultLocale : Object.keys(strings)[0];
  const icon = iconSvg.replace(/<\?xml[^>]*>\s*/, "").replace("<svg ", '<svg aria-hidden="true" class="icon" ');
  const script = `(function () {
  var T = ${JSON.stringify(strings).replace(/</g, "\\u003c")};
  var base = ${JSON.stringify(basePath)};
  var fallback = ${JSON.stringify(lang)};
  var p = location.pathname;
  if (base && p.indexOf(base + "/") === 0) p = p.slice(base.length);
  var lang = p.split("/")[1] || "";
  if (!T[lang]) {
    lang = fallback;
    var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    outer: for (var i = 0; i < prefs.length; i++) {
      var l = String(prefs[i]).toLowerCase();
      for (var code in T) if (l === code || l.indexOf(code + "-") === 0) { lang = code; break outer; }
    }
  }
  var t = T[lang];
  document.documentElement.lang = lang;
  document.title = t.offlinePageTitle;
  var nodes = document.querySelectorAll("[data-i18n]");
  for (var j = 0; j < nodes.length; j++) nodes[j].textContent = t[nodes[j].getAttribute("data-i18n")];
  document.getElementById("pwa-offline-simulator").href = base + "/" + lang + "/simulator/";
  document.getElementById("pwa-offline-retry").addEventListener("click", function () { location.reload(); });
  window.addEventListener("online", function () { location.reload(); });
})();`;
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" style="color-scheme: dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${escapeHtml(backgroundColor)}">
<title>${escapeHtml(t.offlinePageTitle)}</title>
<style>
  html, body { margin: 0; background: ${backgroundColor}; color: #f7f7f2; font-family: "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  main { box-sizing: border-box; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 16px; text-align: center; }
  .icon { width: 96px; height: 96px; margin-bottom: 24px; }
  h1 { margin: 0 0 12px; font-size: 28px; font-weight: 800; letter-spacing: -0.01em; }
  p { max-width: 34rem; margin: 0 0 28px; color: #9a9aa2; line-height: 1.55; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
  .btn { font: inherit; font-size: 15px; font-weight: 700; border-radius: 12px; padding: 12px 20px; cursor: pointer; text-decoration: none; }
  .primary { border: 0; background: ${accent}; color: ${backgroundColor}; }
  .primary:hover { background: ${accentLight}; }
  .secondary { border: 1px solid #2f2f34; background: #141417; color: ${accentLight}; }
  .brand { margin-top: 40px; font-size: 13px; color: #6e6e76; }
</style>
</head>
<body data-pwa-offline>
<main>
${icon.trim()}
<h1 data-i18n="offlineTitle">${escapeHtml(t.offlineTitle)}</h1>
<p data-i18n="offlineBody">${escapeHtml(t.offlineBody)}</p>
<div class="actions">
<button type="button" id="pwa-offline-retry" class="btn primary" data-i18n="offlineRetry">${escapeHtml(t.offlineRetry)}</button>
<a id="pwa-offline-simulator" class="btn secondary" href="${escapeHtml(`${basePath}/${lang}/simulator/`)}" data-i18n="offlineSimulator">${escapeHtml(t.offlineSimulator)}</a>
</div>
<div class="brand">${escapeHtml(siteName)}</div>
</main>
<script>
${script}
</script>
</body>
</html>
`;
}

/** Reads the accent colours from src/lib/site.ts (the rebranding file), falling back to the lime defaults. */
export function readAccent(siteTs) {
  const pick = (name, fallback) => siteTs.match(new RegExp(`export const ${name} = "(#[0-9a-fA-F]{3,8})"`))?.[1] ?? fallback;
  return { accent: pick("ACCENT", "#93d119"), accentLight: pick("ACCENT_LIGHT", "#b0f02a") };
}

/**
 * Writes out/offline.html and out/sw.js. `root` is the project folder (messages/, public/icon.svg,
 * src/lib/site.ts, package.json and the template are read from there).
 */
export function buildPwa(outDir, { root = process.cwd() } = {}) {
  const manifestPath = path.join(outDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) throw new Error(`pwa: ${MANIFEST_FILE} missing in ${outDir} – src/app/manifest.ts should have produced it`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const basePath = String(manifest.scope || "/").replace(/\/+$/, "");
  const defaultLocale = String(manifest.start_url || "").slice(basePath.length).split("/")[1] || "en";

  const messagesDir = path.join(root, "messages");
  const messages = {};
  for (const file of fs.readdirSync(messagesDir).filter((f) => f.endsWith(".json")).sort()) {
    const locale = file.slice(0, -".json".length);
    if (fs.existsSync(path.join(outDir, locale, "index.html"))) messages[locale] = JSON.parse(fs.readFileSync(path.join(messagesDir, file), "utf8"));
  }
  const locales = Object.keys(messages);
  const siteTsPath = path.join(root, "src", "lib", "site.ts");
  const { accent, accentLight } = readAccent(fs.existsSync(siteTsPath) ? fs.readFileSync(siteTsPath, "utf8") : "");
  const iconSvg = fs.readFileSync(path.join(root, "public", "icon.svg"), "utf8");
  fs.writeFileSync(
    path.join(outDir, OFFLINE_FILE),
    renderOfflinePage({ basePath, siteName: manifest.name, defaultLocale, messages, iconSvg, backgroundColor: manifest.background_color || "#0b0b0d", accent, accentLight }),
  );

  const template = fs.readFileSync(path.join(root, "scripts", "pwa", "sw.template.js"), "utf8");
  const files = listFiles(outDir).filter((f) => f !== SW_FILE);
  const sizes = Object.fromEntries(files.map((f) => [f, fs.statSync(path.join(outDir, f)).size]));
  const precache = selectPrecache(files, { locales, sizes });
  const { critical, deferred } = splitPrecache(precache, { locales });
  const version = hashExport(outDir, files, template);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const cachePrefix = String(pkg.name || "site").replace(/[^a-z0-9-]/gi, "-");

  const urlToFile = new Map(files.map((f) => [fileToUrlPath(f), f]));
  const sum = (urls) => urls.reduce((total, url) => total + (sizes[urlToFile.get(url)] ?? 0), 0);
  const criticalBytes = sum(critical);
  const deferredBytes = sum(deferred);
  if (criticalBytes > MAX_CRITICAL_PRECACHE_BYTES) {
    throw new Error(
      `pwa: the worker's install would download ${(criticalBytes / 1048576).toFixed(2)} MB unpacked (limit ${(MAX_CRITICAL_PRECACHE_BYTES / 1048576).toFixed(1)} MB): ` +
        `a first visitor on a phone pays for it. Largest critical files: ${critical.map((u) => [u, sum([u])]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([u, n]) => `${u} (${(n / 1024).toFixed(0)} KB)`).join(", ")}. ` +
        `Move the file out of the critical set (splitPrecache) or out of the precache (NOT_PRECACHED).`,
    );
  }
  fs.writeFileSync(
    path.join(outDir, SW_FILE),
    renderServiceWorker(template, { version, cachePrefix, offlinePage: OFFLINE_FILE, concurrency: 6, restConcurrency: 3, critical, deferred }),
  );
  return { version, precache, critical, deferred, bytes: criticalBytes + deferredBytes, criticalBytes, deferredBytes, locales, basePath };
}
