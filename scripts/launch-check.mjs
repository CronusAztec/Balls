#!/usr/bin/env node
// --- launch-check --- `npm run launch:check`: is the LIVE site fit to send paid traffic and press to? It reads the public site from
// outside, the way an ad reviewer, a link preview and a visitor do, and prints what to fix before money is spent.
//
//   npm run launch:check                                   (https://jumpingballslive.com)
//   npm run launch:check -- --url https://jumpingballslive.com --json
//   npm run launch:check -- --browser                       (also opens the landing page and the studio in Chromium: campaign names survive)
//   npm run launch:check -- --analytics stats.example.com   (the site's code must name the statistics service you installed)
//   NODE_USE_ENV_PROXY=1 npm run launch:check               (behind an HTTPS proxy, Node 22.21 or newer)
//
// Every check prints `PASS|FAIL|WARN|SKIP  <id>  <title> – <detail>`; the last line is `LAUNCH CHECK: PASS`, `PASS (n warnings)` or
// `FAIL (n failed, m warnings)`, and the exit code is 1 on any FAIL. A WARN is something to decide on, not a blocker. The ids A1 to A12 are
// the ad-readiness list of docs/ADS.md (audit-ads, section 8), B1 and up are the checks the SEO, legal and performance audits asked for.
// docs/GO-LIVE.md section 14.2 and docs/ADS.md section 10 say what must be green before spending. Node only, no dependency
// (Playwright is loaded only with --browser). Nothing is written, nothing is sent but GET and HEAD requests.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseOptions } from "./lib/go-live-common.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

export const DEFAULT_SITE = "https://jumpingballslive.com";
export const DEFAULT_BILLING = "https://jumpingballslive-billing.jumpingballslive.workers.dev";
export const DEFAULT_RELAY = "https://relay.jumpingballslive.com";
export const LOCALES = ["en", "pl", "es"];
/** The public, indexable pages (the route after the language; "" is the landing page). The feedback form and the account page are noindex and left out. */
export const PAGES = ["", "/simulator", "/gallery", "/download", "/pricing", "/about", "/tiktok-ball-videos", "/changelog", "/press", "/privacy", "/terms", "/disclaimer"];
/** Pages whose visible text is also read for developer strings (the feedback form shows one when its endpoint is not set up). */
export const EXTRA_TEXT_PAGES = ["/feedback"];
export const OG_SIZE = { width: 1200, height: 630 };
export const TITLE_MAX = 60;
export const DESCRIPTION_RANGE = { min: 70, max: 160 };

// --- reading HTML ---------------------------------------------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", ndash: "–", mdash: "—", hellip: "…", times: "×", copy: "©" };

/** HTML entities (named: the common ones, and numeric) as text. */
export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function attribute(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

const tagsOf = (html, name) => String(html).match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];

/**
 * What a search engine and a link preview read from a page: the title, the description, the canonical address, the hreflang set
 * (React writes the attribute as `hrefLang`: matched without regard to case), the Open Graph and Twitter tags, the robots meta
 * and the raw JSON-LD blocks.
 */
export function extractHead(html) {
  const source = String(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  const metas = tagsOf(source, "meta");
  const meta = (key, value) => {
    const tag = metas.find((t) => (attribute(t, key) ?? "").toLowerCase() === value);
    return tag ? attribute(tag, "content") : null;
  };
  const links = tagsOf(source, "link");
  const canonical = links.find((t) => (attribute(t, "rel") ?? "").toLowerCase() === "canonical");
  const alternates = {};
  for (const t of links) {
    if ((attribute(t, "rel") ?? "").toLowerCase() !== "alternate") continue;
    const lang = attribute(t, "hreflang");
    if (lang) alternates[lang] = attribute(t, "href");
  }
  const jsonLd = [...source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  return {
    title: title ? decodeEntities(title[1]).trim() : "",
    description: meta("name", "description"),
    canonical: canonical ? attribute(canonical, "href") : null,
    alternates,
    og: { image: meta("property", "og:image"), title: meta("property", "og:title"), description: meta("property", "og:description"), url: meta("property", "og:url"), locale: meta("property", "og:locale"), type: meta("property", "og:type") },
    twitter: { card: meta("name", "twitter:card"), image: meta("name", "twitter:image") },
    robots: meta("name", "robots"),
    build: meta("name", "jbl-build"),
    jsonLd,
  };
}

/** The text a visitor reads on the page: the head, scripts, styles, templates and comments dropped, tags to spaces, entities decoded, whitespace collapsed. */
export function visibleText(html) {
  return decodeEntities(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
      .replace(/<(script|style|template|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Strings no visitor should read: a build variable, "not configured", an unfilled placeholder, an internal address (matched without regard to case). */
const DEVELOPER_STRINGS = /NEXT_PUBLIC_|set NEXT_PUBLIC|not configured|before building|\[object Object\]|\{(?:siteName|siteDomain|count|monthly|yearly|percent|version|label|name|email)\}|localhost:\d+/gi;
/** Programming leftovers, matched exactly as written: `undefined` and `NaN` (a capitalised "Undefined" or a name is prose). */
const DEVELOPER_WORDS = /\bundefined\b|\bNaN\b/g;

/** The developer strings in a text (empty when there are none), each with a little of what surrounds it. */
export function developerStrings(text) {
  const source = String(text);
  const found = [];
  for (const re of [DEVELOPER_STRINGS, DEVELOPER_WORDS]) {
    re.lastIndex = 0;
    for (const m of source.matchAll(re)) found.push(source.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).trim());
  }
  return found;
}

/** The width and height of a PNG from its first 24 bytes, or null when the bytes are not a PNG. */
export function pngSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || signature.some((v, i) => b[i] !== v)) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null; // "IHDR"
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The addresses in a sitemap, in order. */
export function sitemapUrls(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
}

// --- judging a page ------------------------------------------------------------------------------------------------------

/** The address a page must have as its canonical one: `https://site/<locale><path>/`. */
export const pageAddress = (site, locale, route) => `${String(site).replace(/\/+$/, "")}/${locale}${route}/`;

/**
 * What is wrong with a page's head, by kind (empty arrays when it is right): the title (at most 60 characters), the description
 * (70 to 160), the canonical address (this page's own), the hreflang set (en, pl, es and x-default, each the same page in its
 * language, x-default the English one) and the Open Graph and Twitter tags (a card, an absolute https address, og:url equal to the canonical).
 */
export function headProblems(head, { site, locale, route }) {
  const url = pageAddress(site, locale, route);
  const problems = { title: [], description: [], canonical: [], hreflang: [], og: [], robots: [] };
  const len = (s) => [...String(s)].length;
  if (!head.title) problems.title.push("no <title>");
  else if (len(head.title) > TITLE_MAX) problems.title.push(`${len(head.title)} characters (at most ${TITLE_MAX})`);
  if (!head.description) problems.description.push("no description");
  else if (len(head.description) < DESCRIPTION_RANGE.min || len(head.description) > DESCRIPTION_RANGE.max) problems.description.push(`${len(head.description)} characters (${DESCRIPTION_RANGE.min} to ${DESCRIPTION_RANGE.max})`);
  if (head.canonical !== url) problems.canonical.push(`canonical is ${head.canonical ?? "missing"}, expected ${url}`);
  const want = Object.fromEntries([...LOCALES.map((l) => [l, pageAddress(site, l, route)]), ["x-default", pageAddress(site, "en", route)]]);
  for (const [lang, href] of Object.entries(want)) if (head.alternates[lang] !== href) problems.hreflang.push(`${lang}: ${head.alternates[lang] ?? "missing"}`);
  for (const lang of Object.keys(head.alternates)) if (!(lang in want)) problems.hreflang.push(`unexpected ${lang}`);
  const scheme = String(site).startsWith("https://") ? "https" : "https?"; // a site served over http (a local build) names its card over http
  if (!head.og.image || !new RegExp(`^${scheme}://`).test(head.og.image)) problems.og.push(`og:image is ${head.og.image ?? "missing"} (an absolute ${scheme === "https" ? "https " : ""}address)`);
  if (!head.og.title) problems.og.push("no og:title");
  if (!head.og.description) problems.og.push("no og:description");
  if (head.og.url !== url) problems.og.push(`og:url is ${head.og.url ?? "missing"}`);
  if (!head.og.locale) problems.og.push("no og:locale");
  if (head.twitter.card !== "summary_large_image") problems.og.push(`twitter:card is ${head.twitter.card ?? "missing"}`);
  if (route !== "" && /noindex/i.test(head.robots ?? "")) problems.robots.push("noindex");
  return problems;
}

/** The inner HTML of the `<section id="…">` of a page, or null when the page has none (an older build). */
export function sectionHtml(html, id) {
  const m = new RegExp(`<section[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</section>`, "i").exec(String(html));
  return m ? m[1] : null;
}

/**
 * --- legal-audit --- What is missing of the operator's identity on the English legal pages (empty when nothing is): the privacy
 * page's "Who is responsible" paragraph must hold a postal address (the heuristic: a digit and a comma after the name, which
 * "Site is run by A. Person." has not and "Site is run by A. Person, 1 High Street, Town." has), and the terms' "Who you are buying
 * from" section must name someone rather than fall back to "the operator of <domain>". EU and UK law require a trader's name and
 * geographic address on a site that sells.
 */
export function operatorIdentity({ privacyHtml, termsHtml }) {
  const problems = [];
  const controller = sectionHtml(privacyHtml, "controller");
  if (controller === null) problems.push("the privacy page has no \"Who is responsible\" section (an older build)");
  else {
    const first = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(controller);
    const text = visibleText(first ? first[1] : controller);
    if (!/\d/.test(text) || !text.includes(",")) problems.push(`the privacy page names no postal address ("${text.slice(0, 90)}")`);
  }
  const operator = sectionHtml(termsHtml, "operator");
  if (operator === null) problems.push("the terms have no \"Who you are buying from\" section (an older build)");
  else if (/\bthe operator of\b/i.test(visibleText(operator))) problems.push("the terms name \"the operator of\" the domain instead of a person or company");
  return problems;
}

/** Which payment words a text names: `paypal`, `crypto` and `card` (in English, Polish and Spanish). */
export function providersNamed(text) {
  const t = String(text).toLowerCase();
  return { paypal: /paypal/.test(t), crypto: /crypto|krypto|cripto/.test(t), card: /\bcards?\b|\bkart|tarjeta/.test(t) };
}

/** The payment words a text names that the billing Worker's `providers` do not have on (`stripe` stands for the card). */
export function unsupportedProviders(text, providers) {
  const named = providersNamed(text);
  const out = [];
  if (named.paypal && !providers?.paypal) out.push("PayPal");
  if (named.crypto && !providers?.crypto) out.push("crypto");
  if (named.card && !providers?.stripe) out.push("card");
  return out;
}

/** Whether a text sells "Publish" (to TikTok, Instagram, YouTube) as a feature. "Quick share", "post" and "export" do not count. */
export function sellsPublish(text) {
  return /\bpublish(?:ing)?\b|\bpublikuj|\bpublicar\b/i.test(String(text));
}

/** The security headers a page should carry and the response lacks, by name. */
export function missingSecurityHeaders(headers) {
  const get = (name) => (typeof headers?.get === "function" ? headers.get(name) : (headers?.[name] ?? null));
  const missing = [];
  if (!/max-age=\d+/i.test(get("strict-transport-security") ?? "")) missing.push("Strict-Transport-Security");
  if (!/nosniff/i.test(get("x-content-type-options") ?? "")) missing.push("X-Content-Type-Options");
  if (!get("referrer-policy")) missing.push("Referrer-Policy");
  if (!get("x-frame-options") && !/frame-ancestors/i.test(get("content-security-policy") ?? "")) missing.push("X-Frame-Options (or frame-ancestors)");
  if (!get("permissions-policy")) missing.push("Permissions-Policy");
  return missing;
}

/** The `version:` of an electron-updater feed (latest.yml), or null. */
export function parseLatestYml(text) {
  const m = /^version:\s*['"]?([0-9][0-9A-Za-z.+-]*)['"]?\s*$/m.exec(String(text));
  return m ? m[1] : null;
}

/** The Windows app's release facts from src/lib/desktop/release.ts: the version, the downloads repository, the two fixed asset names. */
export function readDesktopRelease(source) {
  const text = String(source);
  const pick = (re) => re.exec(text)?.[1] ?? null;
  return {
    version: pick(/DESKTOP_VERSION\s*=\s*"([^"]+)"/),
    repo: pick(/DOWNLOADS_REPO\s*=\s*"([^"]+)"/),
    setup: pick(/SETUP_ASSET\s*=\s*"([^"]+)"/),
    portable: pick(/PORTABLE_ASSET\s*=\s*"([^"]+)"/),
  };
}

/** The facts the ad copy states: the Pro prices (USD, as numbers) and the numbers of modes it names. */
export function adCopyFacts(copy) {
  const entries = Array.isArray(copy?.entries) ? copy.entries : [];
  const prices = new Set();
  const modes = new Set();
  for (const e of entries) {
    const text = String(e.text);
    for (const m of text.matchAll(/\$\s?(\d+(?:\.\d+)?)|(\d+(?:,\d+)?)\s?(?:USD|US\$)/g)) prices.add(Number((m[1] ?? m[2]).replace(",", ".")));
    for (const m of text.matchAll(/\b(\d{2,3})\b(?= (?:Ball Physics )?(?:modes|trybów|modos))/gi)) modes.add(Number(m[1]));
  }
  return { prices: [...prices].sort((a, b) => a - b), modes: [...modes].sort((a, b) => a - b) };
}

/** The number of modes a landing page's description names ("45 modes"), or null. */
export function modeCountOf(description) {
  const m = /\b(\d{2,3}) modes\b/i.exec(String(description ?? ""));
  return m ? Number(m[1]) : null;
}

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * A1: does the live site say which build it is, and say it the same way everywhere? `/build.txt` is the bare 40-character commit,
 * `/version.json` names the same commit and the matching compact id (`1.10.0+8fa8dbb`), the landing page's `jbl-build` meta and the
 * `X-Build` header carry that id too. Returns { status, detail }.
 *
 * @param {{ buildTxt?: unknown, versionJson?: any, buildMeta?: string | null, buildHeader?: string | null, expected?: { sha: string, explicit: boolean } | null }} input
 * @returns {{ status: string, detail: string }}
 */
export function judgeBuildIdentity({ buildTxt, versionJson, buildMeta, buildHeader, expected }) {
  const sha = String(buildTxt ?? "").trim();
  if (!SHA_RE.test(sha)) return { status: "FAIL", detail: `/build.txt is not a 40-character commit (${sha ? `"${sha.slice(0, 40)}"` : "missing"}): the live site is not a build that names itself, deploy the current commit` };
  if (!versionJson || typeof versionJson !== "object") return { status: "FAIL", detail: `/build.txt names ${sha.slice(0, 7)}, but /version.json is missing: the live site is an older build than this repository, deploy the current commit (docs/GO-LIVE.md section 3)` };
  const problems = [];
  if (versionJson.commit !== sha) problems.push(`/version.json says ${String(versionJson.commit ?? "no commit").slice(0, 7)}, /build.txt says ${sha.slice(0, 7)}`);
  const id = `${versionJson.siteVersion}+${sha.slice(0, 7)}`;
  if (versionJson.build !== id) problems.push(`/version.json "build" is ${versionJson.build ?? "missing"}, expected ${id}`);
  if (problems.length) return { status: "FAIL", detail: problems.join("; ") };
  const notes = [];
  if (expected && sha !== expected.sha) {
    return { status: expected.explicit ? "FAIL" : "WARN", detail: `the live build is ${sha.slice(0, 7)} (${versionJson.build}) but ${expected.explicit ? "you asked for" : "this checkout is at"} ${String(expected.sha).slice(0, 7)}: ${expected.explicit ? "deploy it first" : "fine while the newest commit is not meant to be live yet"}` };
  }
  if (buildMeta === null || buildMeta === undefined) notes.push("the pages carry no jbl-build meta");
  else if (buildMeta !== versionJson.build) notes.push(`the pages carry jbl-build ${buildMeta}, not ${versionJson.build} (a cached page?)`);
  if (buildHeader === null || buildHeader === undefined) notes.push("no X-Build header");
  else if (buildHeader !== versionJson.build) notes.push(`X-Build is ${buildHeader}, not ${versionJson.build}`);
  if (notes.length) return { status: "WARN", detail: `${versionJson.build} is live, /build.txt and /version.json agree, but ${notes.join(" and ")}` };
  return { status: "PASS", detail: `${versionJson.build} (${sha.slice(0, 7)}, ${versionJson.commitDate ?? "no date"}): /build.txt, /version.json, the page meta and X-Build agree` };
}

const listed = (items, max = 6) => (items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", "));

// --- fetching ----------------------------------------------------------------------------------------------------------

const result = (id, title, status, detail) => ({ id, title, status, detail });

async function request(fetchImpl, url, init = {}) {
  const { binary = false, ...rest } = init;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url, { ...rest, signal: AbortSignal.timeout(TIMEOUT_MS) });
      let text = "";
      let bytes = null;
      if (binary) bytes = new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
      else if (rest.method !== "HEAD") text = await res.text().catch(() => "");
      let json = null;
      if (!binary && text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return { ok: true, url, status: res.status, headers: res.headers, text, bytes, json };
    } catch (err) {
      const cause = err && typeof err === "object" && "cause" in err && err.cause ? `: ${err.cause.code ?? err.cause.message ?? err.cause}` : "";
      lastError = `${err instanceof Error ? err.message : String(err)}${cause}`;
    }
  }
  return { ok: false, url, status: 0, headers: new Headers(), text: "", bytes: null, json: null, error: lastError };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const reachable = (r) => r.ok && r.status >= 200 && r.status < 300;
const why = (r) => (r.ok ? `answered ${r.status}` : `cannot be reached (${r.error})`);

/** The chunk files a page references (its script tags and the chunk paths in its payload), as absolute addresses. */
export function chunkUrls(html, pageUrl) {
  const out = [];
  for (const m of String(html).matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/chunks\/[^"']+?\.js)(?:\?[^"']*)?["']/g)) {
    try {
      const abs = new URL(m[1].replace(/&amp;/g, "&"), pageUrl).toString();
      if (!out.includes(abs)) out.push(abs);
    } catch {
      // not an address
    }
  }
  return out;
}

// --- the checks ----------------------------------------------------------------------------------------------------------

/**
 * Runs every check against the live site and resolves with { ok, results }; ok is false when any check FAILs. Every address and
 * the way to fetch are options, so a test serves fixtures: `fetchImpl(url, init) → Response`, `root` (the repository, for the Windows
 * app's version and the ad copy), `expected` (the commit the site should be at: { sha, explicit }), `browser` (a function that runs
 * the campaign check, or null).
 *
 * @param {{ site?: string, billing?: string, relay?: string, downloads?: string, analytics?: string, fetchImpl?: (url: string, init?: any) => Promise<Response>, root?: string, expected?: { sha: string, explicit: boolean } | null, browser?: ((site: string) => Promise<{ status: string, detail: string }>) | null }} options
 */
export async function runChecks({ site = DEFAULT_SITE, billing = DEFAULT_BILLING, relay = DEFAULT_RELAY, downloads, analytics = "", fetchImpl = (u, i) => fetch(u, i), root = ROOT, expected = null, browser = null } = {}) {
  const siteUrl = String(site).replace(/\/+$/, "");
  const results = [];
  const push = (...a) => results.push(result(...a));
  const release = (() => {
    try {
      return readDesktopRelease(fs.readFileSync(path.join(root, "src", "lib", "desktop", "release.ts"), "utf8"));
    } catch {
      return { version: null, repo: null, setup: null, portable: null };
    }
  })();
  const downloadsUrl = String(downloads ?? (release.repo ? `https://github.com/${release.repo}/releases/latest/download` : "")).replace(/\/+$/, "");
  const adCopy = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, "docs", "ads", "copy.json"), "utf8"));
    } catch {
      return null;
    }
  })();

  // ---- fetch the pages once
  const wanted = [];
  for (const l of LOCALES) for (const route of [...PAGES, ...EXTRA_TEXT_PAGES]) wanted.push({ locale: l, route, extra: EXTRA_TEXT_PAGES.includes(route) });
  const fetched = await mapLimit(wanted, CONCURRENCY, async (p) => ({ ...p, url: pageAddress(siteUrl, p.locale, p.route), res: await request(fetchImpl, pageAddress(siteUrl, p.locale, p.route)) }));
  const pages = fetched.filter((p) => !p.extra);
  const htmlOf = (p) => (reachable(p.res) ? p.res.text : "");
  for (const p of fetched) p.head = extractHead(htmlOf(p));

  // A1 – the build names itself
  {
    const [buildRes, versionRes] = await Promise.all([request(fetchImpl, `${siteUrl}/build.txt`), request(fetchImpl, `${siteUrl}/version.json`)]);
    const home = pages.find((p) => p.locale === "en" && p.route === "" && reachable(p.res));
    if (!reachable(buildRes)) push("A1", "build-identity", "FAIL", `${siteUrl}/build.txt ${why(buildRes)}`);
    else {
      const judged = judgeBuildIdentity({
        buildTxt: buildRes.text,
        versionJson: reachable(versionRes) && versionRes.json && typeof versionRes.json === "object" ? versionRes.json : null,
        buildMeta: home ? home.head.build : undefined,
        buildHeader: home ? home.res.headers.get("x-build") : undefined,
        expected: expected ? { ...expected } : null,
      });
      push("A1", "build-identity", judged.status, judged.detail);
    }
  }

  // A2 – every public page in every language answers, with a head that search engines and link previews can use
  {
    const down = pages.filter((p) => !reachable(p.res));
    if (down.length === 0) push("A2", "pages-answer", "PASS", `${pages.length} pages (${PAGES.length} pages × ${LOCALES.length} languages) answer 200`);
    else push("A2", "pages-answer", "FAIL", `${down.length} of ${pages.length} do not answer 200: ${listed(down.map((p) => `/${p.locale}${p.route}/ ${p.res.ok ? p.res.status : "unreachable"}`))}. An older build than this repository is live (a page added since is a 404): deploy the current commit`);
  }
  const live = pages.filter((p) => reachable(p.res));
  const judgedHeads = live.map((p) => ({ p, problems: headProblems(p.head, { site: siteUrl, locale: p.locale, route: p.route }) }));
  const gather = (kind) => judgedHeads.flatMap(({ p, problems }) => problems[kind].map((m) => `/${p.locale}${p.route}/ ${m}`));
  {
    const bad = gather("canonical").concat(gather("hreflang"));
    push("A2b", "canonical-hreflang", live.length === 0 ? "SKIP" : bad.length ? "FAIL" : "PASS", live.length === 0 ? "needs the pages (A2)" : bad.length ? `${bad.length} problems: ${listed(bad)}` : `${live.length} pages: one canonical address each (its own) and the hreflang set en, pl, es and x-default`);
  }
  {
    const bad = gather("og");
    push("A2c", "social-tags", live.length === 0 ? "SKIP" : bad.length ? "FAIL" : "PASS", live.length === 0 ? "needs the pages (A2)" : bad.length ? `${bad.length} problems: ${listed(bad)}` : `${live.length} pages: og:image, og:title, og:description, og:url, og:locale and a large Twitter card`);
  }
  // the card pictures: reachable, a PNG, 1200 × 630
  {
    const images = [...new Set(live.map((p) => p.head.og.image).filter((u) => u && /^https?:\/\//.test(u)))];
    if (images.length === 0) push("A2d", "og-image-png", "SKIP", "no page names an og:image (A2c)");
    else {
      const checked = await mapLimit(images, CONCURRENCY, async (url) => ({ url, res: await request(fetchImpl, url, { binary: true }) }));
      const bad = [];
      for (const { url, res } of checked) {
        if (!reachable(res)) bad.push(`${new URL(url).pathname} ${res.ok ? res.status : "unreachable"}`);
        else {
          const size = pngSize(res.bytes);
          if (!size) bad.push(`${new URL(url).pathname} is not a PNG (${res.headers.get("content-type") ?? "no type"})`);
          else if (size.width !== OG_SIZE.width || size.height !== OG_SIZE.height) bad.push(`${new URL(url).pathname} is ${size.width}×${size.height}`);
        }
      }
      push("A2d", "og-image-png", bad.length ? "FAIL" : "PASS", bad.length ? `${bad.length} of ${images.length} cards: ${listed(bad)}. Every page shows a ${OG_SIZE.width}×${OG_SIZE.height} PNG when its link is shared (npm run og:cards)` : `${images.length} different cards, each reachable and a ${OG_SIZE.width}×${OG_SIZE.height} PNG`);
    }
  }
  {
    const bad = gather("title");
    push("A2e", "titles", live.length === 0 ? "SKIP" : bad.length ? "FAIL" : "PASS", live.length === 0 ? "needs the pages (A2)" : bad.length ? `${bad.length}: ${listed(bad)}` : `${live.length} titles of at most ${TITLE_MAX} characters`);
  }
  {
    const bad = gather("description");
    push("A2f", "descriptions", live.length === 0 ? "SKIP" : bad.length ? "FAIL" : "PASS", live.length === 0 ? "needs the pages (A2)" : bad.length ? `${bad.length}: ${listed(bad)}` : `${live.length} descriptions of ${DESCRIPTION_RANGE.min} to ${DESCRIPTION_RANGE.max} characters`);
  }
  {
    const dupes = [];
    for (const l of LOCALES) {
      for (const key of ["title", "description"]) {
        const seen = new Map();
        for (const p of live.filter((x) => x.locale === l && x.route !== "")) {
          const v = key === "title" ? p.head.title : p.head.description;
          if (!v) continue;
          if (seen.has(v)) dupes.push(`/${l}${p.route}/ and /${l}${seen.get(v)}/ share a ${key}`);
          else seen.set(v, p.route);
        }
      }
    }
    push("A2g", "unique-snippets", live.length === 0 ? "SKIP" : dupes.length ? "WARN" : "PASS", live.length === 0 ? "needs the pages (A2)" : dupes.length ? `${listed(dupes)}: search engines fold pages that look the same` : "no two pages of a language share a title or a description");
  }

  // A3 – a visitor can reach the operator
  {
    const privacy = pages.filter((p) => p.route === "/privacy");
    if (!privacy.some((p) => reachable(p.res))) push("A3", "privacy-contact", "SKIP", "needs the privacy pages (A2)");
    else {
      const without = privacy.filter((p) => reachable(p.res) && !/href=["']mailto:/i.test(p.res.text));
      if (without.length === 0) push("A3", "privacy-contact", "PASS", "the privacy page of every language has a mailto link");
      else push("A3", "privacy-contact", "FAIL", `no mailto link on the privacy page (${without.map((p) => p.locale).join(", ")}): nobody can reach the operator, and ad platforms and card networks expect that. Set JBL_SUPPORT_EMAIL, JBL_LEGAL_NAME and JBL_LEGAL_ADDRESS in /etc/jbl-deploy/env and rebuild (docs/ADS.md section 12, step 1)`);
    }
  }

  // A4 – no developer string is visible on any page
  {
    const hits = [];
    for (const p of fetched.filter((x) => reachable(x.res))) {
      const shown = [visibleText(p.res.text), p.head.title, p.head.description ?? "", p.head.og.title ?? "", p.head.og.description ?? ""].join(" ");
      for (const h of developerStrings(shown)) hits.push(`/${p.locale}${p.route}/ "${h}"`);
    }
    const readable = fetched.filter((x) => reachable(x.res)).length;
    push("A4", "no-developer-strings", readable === 0 ? "SKIP" : hits.length ? "FAIL" : "PASS", readable === 0 ? "needs the pages (A2)" : hits.length ? `${hits.length} found: ${listed(hits, 4)}. A visitor must not read a build variable or an unfilled placeholder` : `${readable} pages read: no NEXT_PUBLIC_, "not configured", unfilled placeholder or undefined`);
  }

  // A5 – the pricing page names only the payment methods that work
  const config = await request(fetchImpl, `${String(billing).replace(/\/+$/, "")}/config`, { headers: { Accept: "application/json" } });
  {
    const pricing = pages.filter((p) => p.route === "/pricing" && reachable(p.res));
    if (!config.ok || config.status !== 200 || !config.json?.providers) push("A5", "pricing-providers", "WARN", `the billing Worker's /config ${why(config)}: cannot compare the pricing page with what works`);
    else if (pricing.length === 0) push("A5", "pricing-providers", "SKIP", "needs the pricing pages (A2)");
    else {
      const providers = config.json.providers;
      const bad = pricing.flatMap((p) => unsupportedProviders(`${p.head.description ?? ""} ${p.head.og.description ?? ""}`, providers).map((name) => `/${p.locale}/pricing/ names ${name}`));
      const on = Object.entries(providers).filter(([, v]) => v).map(([k]) => k);
      push("A5", "pricing-providers", bad.length ? "FAIL" : "PASS", bad.length ? `${listed(bad)} in its description, but the Worker has only ${on.join(" and ") || "nothing"} on: say "card or crypto" until the other works, or turn it on (docs/GO-LIVE.md section 12)` : `the pricing descriptions name only what the Worker has on (${on.join(", ")})`);
      const legal = fetched.filter((p) => ["/terms", "/privacy"].includes(p.route) && reachable(p.res)).flatMap((p) => unsupportedProviders(visibleText(p.res.text), providers).map((name) => `/${p.locale}${p.route}/ names ${name}`));
      push("A5b", "legal-providers", legal.length ? "WARN" : "PASS", legal.length ? `${listed(legal)} while the Worker has it off (a legal page that names a payment method that does not work misleads)` : "the terms and the privacy policy name only the payment methods that work");
    }
  }

  // A6 – "Publish" is sold only when a platform can be connected
  {
    const health = await request(fetchImpl, `${String(relay).replace(/\/+$/, "")}/api/health`, { headers: { Accept: "application/json" } });
    const pricing = pages.find((p) => p.locale === "en" && p.route === "/pricing" && reachable(p.res));
    if (!pricing) push("A6", "publish-claim", "SKIP", "needs the English pricing page (A2)");
    else if (!health.ok || health.status !== 200 || !health.json?.platforms) push("A6", "publish-claim", "WARN", `the relay's /api/health ${why(health)}: cannot tell whether a channel can be connected`);
    else {
      const platforms = health.json.platforms;
      const anyOn = Object.values(platforms).some(Boolean);
      const publish = sellsPublish(visibleText(pricing.res.text));
      if (publish && !anyOn) push("A6", "publish-claim", "WARN", `the pricing page sells Publish, but the relay has every platform off (${Object.keys(platforms).join(", ")}): nobody can connect a channel. Reword it as quick share (messages Billing) or register the apps (docs/ADS.md section 12, step 4)`);
      else push("A6", "publish-claim", "PASS", publish ? "the pricing page says Publish and the relay has a platform on" : `the pricing page does not sell Publish${anyOn ? "" : " (the relay has every platform off, so share is the honest word)"}`);
    }
  }

  // A7 – the Windows app's downloads exist and are the version the site names
  {
    if (!downloadsUrl || !release.version) push("A7", "download-assets", "SKIP", "src/lib/desktop/release.ts cannot be read here");
    else {
      const names = [release.setup, release.portable, "SHA256SUMS.txt"].filter(Boolean);
      const heads = await mapLimit(names, 3, async (name) => ({ name, res: await request(fetchImpl, `${downloadsUrl}/${name}`, { method: "HEAD", redirect: "manual" }) }));
      const ok = (r) => r.ok && ((r.status >= 200 && r.status < 300) || (r.status >= 300 && r.status < 400 && !!r.headers.get("location")));
      const bad = heads.filter((h) => !ok(h.res)).map((h) => `${h.name} ${h.res.ok ? h.res.status : "unreachable"}`);
      const feed = await request(fetchImpl, `${downloadsUrl}/latest.yml`);
      const version = reachable(feed) ? parseLatestYml(feed.text) : null;
      if (bad.length) push("A7", "download-assets", "FAIL", `${listed(bad)} at ${downloadsUrl}: the download page links them`);
      else if (!reachable(feed)) push("A7", "download-assets", "WARN", `the installer, the portable EXE and the checksums answer, but latest.yml ${why(feed)}: the app's version cannot be compared with the site's ${release.version}`);
      else if (version !== release.version) push("A7", "download-assets", "FAIL", `latest.yml says ${version ?? "no version"} but the website names ${release.version} (DESKTOP_VERSION): publish the Windows app release (docs/RELEASING.md) or the download page names a version nobody can get`);
      else push("A7", "download-assets", "PASS", `${names.join(", ")} answer and latest.yml is ${version}, the version the website names`);
    }
  }

  // A8 – the statistics service the owner installed is in the site's code
  {
    if (!analytics) push("A8", "analytics-script", "SKIP", "pass --analytics <host of the script> once JBL_ANALYTICS_SCRIPT_URL is set (docs/ADS.md section 12, step 3)");
    else {
      const host = analytics.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const home = pages.find((p) => p.locale === "en" && p.route === "" && reachable(p.res));
      if (!home) push("A8", "analytics-script", "SKIP", "needs the English landing page (A2)");
      else {
        let found = home.res.text.includes(host);
        const chunks = chunkUrls(home.res.text, home.url).slice(0, 60);
        if (!found) {
          const texts = await mapLimit(chunks, CONCURRENCY, async (u) => request(fetchImpl, u));
          found = texts.some((r) => reachable(r) && r.text.includes(host));
        }
        push("A8", "analytics-script", found ? "PASS" : "FAIL", found ? `the site's code names ${host}` : `neither the landing page nor its ${chunks.length} scripts name ${host}: the build was made without JBL_ANALYTICS_SCRIPT_URL`);
      }
    }
  }

  // A9 – the campaign names survive the page (needs a browser)
  if (!browser) push("A9", "campaign-survives", "SKIP", "run with --browser: opens /en/ and /en/simulator/ with utm_source and a click id and looks at the address after 4 seconds");
  else {
    const judged = await browser(siteUrl).catch((err) => ({ status: "FAIL", detail: `the browser step failed: ${err instanceof Error ? err.message : String(err)}` }));
    push("A9", "campaign-survives", judged.status, judged.detail);
  }

  // A10 – http goes to https, www goes to the bare domain
  {
    const u = new URL(siteUrl);
    const problems = [];
    const notes = [];
    if (u.protocol === "https:") {
      const http = await request(fetchImpl, `http://${u.host}/${LOCALES[0]}/`, { redirect: "manual" });
      const to = http.ok ? (http.headers.get("location") ?? "") : "";
      if (!http.ok) notes.push(`http:// ${why(http)} (test it from a direct connection: a proxy hides this)`);
      else if (http.status >= 300 && http.status < 400 && /^https:\/\//i.test(to)) notes.push("http:// redirects to https");
      else problems.push(`http://${u.host}/en/ answered ${http.status}${http.status >= 300 && http.status < 400 ? ` to ${to || "nowhere"}` : " and did not redirect"}: the site's Worker makes this redirect since website 1.11.1 (worker/redirects.mjs), so deploy a current build; or Cloudflare dashboard → SSL/TLS → Edge Certificates → turn on "Always Use HTTPS" (behind a proxy this reads the proxy's answer: confirm from a direct connection)`);
      if (!u.host.startsWith("www.")) {
        const www = await request(fetchImpl, `https://www.${u.host}/${LOCALES[0]}/?x=1`, { redirect: "manual" });
        const wto = www.ok ? (www.headers.get("location") ?? "") : "";
        if (!www.ok) notes.push(`www ${why(www)} (a visitor who types www gets an error: add a proxied DNS record for www and the rule below)`);
        else if (www.status >= 300 && www.status < 400 && new RegExp(`^https://${u.host.replace(/\./g, "\\.")}/`, "i").test(wto)) notes.push("www redirects to the bare domain");
        else problems.push(`https://www.${u.host}/en/ answered ${www.status}${www.status >= 300 && www.status < 400 ? ` to ${wto || "nowhere"}` : ", it serves a second copy of the site"}: the site's Worker makes this redirect since website 1.11.1 (worker/redirects.mjs), so deploy a current build; or Cloudflare dashboard → Rules → Redirect Rules → Create rule: hostname equals www.${u.host}, dynamic redirect to concat("https://${u.host}", http.request.uri.path), status 301, preserve the query string (the www DNS record must exist and be proxied)`);
      }
    }
    push("A10", "redirects", problems.length || notes.some((n) => /cannot be reached/.test(n)) ? "WARN" : "PASS", [...problems, ...notes].join("; ") || "not applicable (the site is served over http)");
  }

  // A11 – security headers
  {
    const home = pages.find((p) => p.locale === "en" && p.route === "" && p.res.ok);
    if (!home) push("A11", "security-headers", "SKIP", "needs the English landing page (A2)");
    else {
      const missing = missingSecurityHeaders(home.res.headers);
      push("A11", "security-headers", missing.length ? "WARN" : "PASS", missing.length ? `/en/ lacks ${missing.join(", ")}: public/_headers in this repository sets them, so the live site is an older build, or the host does not apply the file` : "Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, X-Frame-Options and Permissions-Policy are sent");
    }
  }

  // A12 – the operator's name and postal address are on the legal pages (--- legal-audit ---)
  {
    const privacy = pages.find((p) => p.locale === "en" && p.route === "/privacy" && reachable(p.res));
    const terms = pages.find((p) => p.locale === "en" && p.route === "/terms" && reachable(p.res));
    if (!privacy || !terms) push("A12", "operator-identity", "SKIP", "needs the English privacy and terms pages (A2)");
    else {
      const problems = operatorIdentity({ privacyHtml: privacy.res.text, termsHtml: terms.res.text });
      push("A12", "operator-identity", problems.length ? "FAIL" : "PASS", problems.length ? `${listed(problems)}. EU and UK law require the trader's name and geographic address on a site that sells. Set JBL_LEGAL_NAME, JBL_LEGAL_ADDRESS and JBL_SUPPORT_EMAIL in /etc/jbl-deploy/env and rebuild (deploy/vps/README.md, "Say who runs the site")` : "the privacy page names the operator with a postal address and the terms say who you are buying from");
    }
  }

  // B1 – the sitemap and robots.txt
  {
    const [sitemap, robots] = await Promise.all([request(fetchImpl, `${siteUrl}/sitemap.xml`), request(fetchImpl, `${siteUrl}/robots.txt`)]);
    const problems = [];
    const warnings = [];
    if (!reachable(sitemap)) problems.push(`/sitemap.xml ${why(sitemap)}`);
    else {
      const listedUrls = new Set(sitemapUrls(sitemap.text));
      const expectedUrls = pages.map((p) => p.url);
      const missing = expectedUrls.filter((u) => !listedUrls.has(u));
      if (missing.length) warnings.push(`the sitemap does not list ${listed(missing.map((u) => u.replace(siteUrl, "")))}`);
      const dead = pages.filter((p) => listedUrls.has(p.url) && !reachable(p.res)).map((p) => p.url.replace(siteUrl, ""));
      if (dead.length) problems.push(`the sitemap lists pages that do not answer: ${listed(dead)}`);
    }
    if (!reachable(robots)) warnings.push(`/robots.txt ${why(robots)}`);
    else {
      if (/^\s*Disallow:\s*\/\s*$/im.test(robots.text)) problems.push("robots.txt disallows everything");
      if (!/^\s*Sitemap:\s*\S+/im.test(robots.text)) warnings.push("robots.txt does not point at the sitemap");
    }
    push("B1", "sitemap-robots", problems.length ? "FAIL" : warnings.length ? "WARN" : "PASS", [...problems, ...warnings].join("; ") || "the sitemap lists every page in every language, all answering, and robots.txt allows crawling and names the sitemap");
  }

  // B2 – no page is kept out of search by mistake
  {
    const blocked = judgedHeads.flatMap(({ p, problems }) => problems.robots.map(() => `/${p.locale}${p.route}/`));
    push("B2", "indexable", live.length === 0 ? "SKIP" : blocked.length ? "FAIL" : "PASS", live.length === 0 ? "needs the pages (A2)" : blocked.length ? `noindex on ${listed(blocked)}` : "no public page says noindex");
  }

  // B3 – structured data parses
  {
    const bad = [];
    let blocks = 0;
    for (const p of live) {
      for (const raw of p.head.jsonLd) {
        blocks++;
        try {
          JSON.parse(raw);
        } catch {
          bad.push(`/${p.locale}${p.route}/`);
        }
      }
    }
    push("B3", "structured-data", live.length === 0 ? "SKIP" : bad.length ? "FAIL" : "PASS", live.length === 0 ? "needs the pages (A2)" : bad.length ? `JSON-LD that does not parse on ${listed(bad)}` : `${blocks} JSON-LD blocks, all valid JSON`);
  }

  // B4 – the Fight League notice (legal audit B3): fan-made, unaffiliated, names belong to their owners
  {
    const disclaimer = pages.find((p) => p.locale === "en" && p.route === "/disclaimer" && reachable(p.res));
    if (!disclaimer) push("B4", "fan-made-notice", "SKIP", "needs the English disclaimer page (A2)");
    else {
      const text = visibleText(disclaimer.res.text);
      const ok = /Fight League/i.test(text) && /fan-made/i.test(text) && /belong to their (?:respective )?owners/i.test(text);
      push("B4", "fan-made-notice", ok ? "PASS" : "WARN", ok ? "the disclaimer says Fight League is a fan-made simulation whose names belong to their owners" : "the disclaimer has no Fight League notice (fan-made, not affiliated, names belong to their owners): add it before any ad, the roster names third-party characters");
    }
  }

  // B5 – the ad copy states what is true on the live site
  {
    if (!adCopy) push("B5", "ad-copy-facts", "SKIP", "docs/ads/copy.json cannot be read here");
    else {
      const facts = adCopyFacts(adCopy);
      const home = pages.find((p) => p.locale === "en" && p.route === "" && reachable(p.res));
      const problems = [];
      const warnings = [];
      if (config.ok && config.json?.plans) {
        const live = [config.json.plans.monthly?.usd, config.json.plans.yearly?.usd].filter((n) => typeof n === "number");
        const wrong = facts.prices.filter((n) => !live.includes(n));
        if (wrong.length) problems.push(`the ad copy names the price ${wrong.map((n) => `$${n}`).join(", ")} but the Worker's plans are ${live.map((n) => `$${n}`).join(" and ")}`);
      } else warnings.push("the billing Worker's plans cannot be read");
      const count = home ? modeCountOf(home.head.description) : null;
      if (count === null) warnings.push("the landing page's description names no number of modes");
      else if (facts.modes.some((n) => n !== count)) warnings.push(`the ad copy says ${facts.modes.join(", ")} modes and the live site says ${count}: update docs/ads/copy.json and docs/ADS.md`);
      push("B5", "ad-copy-facts", problems.length ? "FAIL" : warnings.length ? "WARN" : "PASS", [...problems, ...warnings].join("; ") || `the ad copy's price (${facts.prices.map((n) => `$${n}`).join(", ")}) and mode count (${facts.modes.join(", ")}) are the live site's`);
    }
  }

  // B6 – security.txt (legal audit N2)
  {
    const sec = await request(fetchImpl, `${siteUrl}/.well-known/security.txt`);
    push("B6", "security-txt", reachable(sec) && /^Contact:/im.test(sec.text) ? "PASS" : "WARN", reachable(sec) && /^Contact:/im.test(sec.text) ? "/.well-known/security.txt names a contact" : "no /.well-known/security.txt with a Contact line: advertiser and security reviewers look for one (low priority)");
  }

  return { ok: !results.some((r) => r.status === "FAIL"), results };
}

// --- the browser step (A9) ---------------------------------------------------------------------------------------------

/** What the address bar must still carry after a landing: the two campaign names an ad click arrives with. */
export function campaignKept(search) {
  const q = new URLSearchParams(String(search ?? ""));
  return q.get("utm_source") === "launchcheck" && q.get("gclid") === "launchcheck";
}

/** Opens the landing page, the studio and the bare domain with a campaign and a click id, and judges what is left of them after 4 seconds. */
export async function browserCampaignCheck(site, { launch } = {}) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { status: "FAIL", detail: "Playwright is not installed: run npm install and npx playwright install chromium" };
  }
  const args = typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : [];
  const browser = await (launch ?? ((o) => chromium.launch(o)))({ args, executablePath: process.env.CHROME_PATH || undefined });
  try {
    // Global Privacy Control on: the site's own gate then keeps these visits out of the owner's real statistics (the check only reads the address)
    const context = typeof browser.newContext === "function" ? await browser.newContext() : null;
    if (context) await context.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
    const page = await (context ?? browser).newPage();
    const query = "utm_source=launchcheck&utm_medium=paid_social&utm_campaign=2610_launch_creators&gclid=launchcheck";
    const tried = [];
    for (const target of [`${site}/en/?${query}`, `${site}/en/simulator/?${query}`, `${site}/?${query}`]) {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(4000);
      const search = await page.evaluate(() => location.search);
      tried.push({ target: new URL(target).pathname, ok: campaignKept(search), now: `${new URL(page.url()).pathname}${search ? "?…" : ""}` });
    }
    const lost = tried.filter((t) => !t.ok);
    if (lost.length === 0) return { status: "PASS", detail: `utm_source and gclid are still in the address after 4 seconds on ${tried.map((t) => t.target).join(", ")}` };
    return { status: "FAIL", detail: `the campaign names are gone from the address on ${lost.map((t) => `${t.target} (ends at ${t.now})`).join(", ")}: the studio rewrites its address and a statistics script that reads it later never sees the campaign. src/lib/analytics/attribution.ts keeps them in this repository, so deploy the current commit; until then send paid traffic to the landing page, never to the studio` };
  } finally {
    await browser.close();
  }
}

// --- the report and the command --------------------------------------------------------------------------------------

/** The report: one line per check, then the verdict. */
export function formatReport(results) {
  const width = Math.max(...results.map((r) => r.title.length), 10);
  const lines = results.map((r) => `${r.status.padEnd(4)}  ${r.id.padEnd(3)}  ${r.title.padEnd(width)} – ${r.detail}`);
  const failed = results.filter((r) => r.status === "FAIL").length;
  const warned = results.filter((r) => r.status === "WARN").length;
  const warnings = `${warned} warning${warned === 1 ? "" : "s"}`;
  lines.push("", failed ? `LAUNCH CHECK: FAIL (${failed} failed, ${warnings})` : warned ? `LAUNCH CHECK: PASS (${warnings})` : "LAUNCH CHECK: PASS");
  return lines;
}

function headCommit(cwd = ROOT) {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  const sha = r.status === 0 ? r.stdout.trim() : "";
  return SHA_RE.test(sha) ? sha : null;
}

const USAGE = "Usage: npm run launch:check [-- --url <site> --json --browser --analytics <script host> --commit <sha|HEAD> --billing <url> --relay <url> --downloads <url>]";

export async function main(argv = process.argv.slice(2)) {
  const opts = parseOptions(argv, { booleans: ["json", "browser", "help"], strings: ["url", "analytics", "commit", "billing", "relay", "downloads"] });
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const site = (opts.url ?? DEFAULT_SITE).replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(site)) throw new Error("--url must be the site's address, e.g. https://jumpingballslive.com");
  let expected = null;
  if (opts.commit) {
    const sha = opts.commit === "HEAD" ? headCommit() : opts.commit.toLowerCase();
    if (!sha || !SHA_RE.test(sha)) throw new Error("--commit is a 40-character commit hash, or HEAD");
    expected = { sha, explicit: true };
  } else {
    const sha = headCommit();
    if (sha) expected = { sha, explicit: false };
  }
  const { ok, results } = await runChecks({
    site,
    billing: opts.billing ?? DEFAULT_BILLING,
    relay: opts.relay ?? DEFAULT_RELAY,
    downloads: opts.downloads,
    analytics: opts.analytics ?? "",
    expected,
    browser: opts.browser ? (s) => browserCampaignCheck(s) : null,
  });
  if (opts.json) console.log(JSON.stringify(results, null, 2));
  else {
    console.log(`Checking ${site} (a read of the public site: GET and HEAD only)\n`);
    for (const line of formatReport(results)) console.log(line);
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`launch:check: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
