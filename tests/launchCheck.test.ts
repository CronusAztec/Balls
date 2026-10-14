import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  DEFAULT_BILLING,
  DEFAULT_RELAY,
  DEFAULT_SITE,
  EXTRA_TEXT_PAGES,
  LOCALES,
  PAGES,
  adCopyFacts,
  campaignKept,
  chunkUrls,
  decodeEntities,
  developerStrings,
  extractHead,
  formatReport,
  headProblems,
  judgeBuildIdentity,
  main,
  missingSecurityHeaders,
  modeCountOf,
  pageAddress,
  parseLatestYml,
  pngSize,
  providersNamed,
  readDesktopRelease,
  runChecks,
  sellsPublish,
  sitemapUrls,
  unsupportedProviders,
  visibleText,
} from "../scripts/launch-check.mjs";
import { DESKTOP_VERSION } from "@/lib/desktop/release";

/**
 * --- launch-check --- scripts/launch-check.mjs (npm run launch:check) against fixtures: pure helpers on fixture HTML, and the whole
 * run against a fake site that answers from memory. No test here touches the network: every run is handed its `fetchImpl`.
 */

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://jumpingballslive.com";
const SHA = "8fa8dbb".padEnd(40, "0");
const BUILD = `1.10.0+${SHA.slice(0, 7)}`;

// ---- fixtures -------------------------------------------------------------------------------------------------------------

/** The number of modes the ad copy names (docs/ads/copy.json): the fixture's landing page says the same, as the live site should. */
const COPY_MODES = adCopyFacts(JSON.parse(fs.readFileSync(path.join(ROOT, "docs/ads/copy.json"), "utf8"))).modes[0];
const DESCRIPTION = `Ball physics simulator in your browser. ${COPY_MODES} modes, free, no sign-up. Export MP4 videos for TikTok, Reels and Shorts.`;

const DISCLAIMER_BODY = '<h1>Disclaimer</h1><p>Fight League is a fan-made simulation. Character names belong to their owners. <a href="mailto:support@example.com">Write to us</a>.</p>';

/** A description of its own for every page of every language (two pages that share one are a warning of A2g). */
const descriptionOf = (locale: string, route: string) => `${DESCRIPTION} [${locale}${route || "/"}]`;

interface PageOptions {
  locale: string;
  route: string;
  title?: string;
  description?: string;
  canonical?: string;
  alternates?: Record<string, string>;
  ogImage?: string | null;
  robots?: string;
  body?: string;
  jsonLd?: string[];
  build?: string | null;
  noLocale?: boolean;
}

/** A page's HTML as Next writes it: React's `hrefLang` spelling, the Open Graph tags, the JSON-LD blocks, a script that holds an RSC payload. */
function pageHtml(o: PageOptions): string {
  const url = pageAddress(SITE, o.locale, o.route);
  const alternates = o.alternates ?? { ...Object.fromEntries(LOCALES.map((l: string) => [l, pageAddress(SITE, l, o.route)])), "x-default": pageAddress(SITE, "en", o.route) };
  const image = o.ogImage === undefined ? `${SITE}/og/${o.locale}/${o.route.replace(/\//g, "") || "home"}.png` : o.ogImage;
  const build = o.build === undefined ? BUILD : o.build;
  return `<!DOCTYPE html><html lang="${o.locale}"><head><meta charSet="utf-8"/><title>${o.title ?? `Page ${o.route || "home"} &amp; more – JumpingBallsLive`}</title>
<meta name="description" content="${o.description ?? descriptionOf(o.locale, o.route)}"/>${build ? `<meta name="jbl-build" content="${build}"/>` : ""}
${o.robots ? `<meta name="robots" content="${o.robots}"/>` : ""}
<link rel="canonical" href="${o.canonical ?? url}"/>
${Object.entries(alternates)
  .map(([lang, href]) => `<link rel="alternate" hrefLang="${lang}" href="${href}"/>`)
  .join("\n")}
<meta property="og:title" content="Title"/><meta property="og:description" content="Description"/><meta property="og:url" content="${url}"/>
${o.noLocale ? "" : `<meta property="og:locale" content="en_US"/>`}<meta property="og:type" content="website"/>
${image ? `<meta property="og:image" content="${image}"/>` : ""}
<meta name="twitter:card" content="summary_large_image"/>
${(o.jsonLd ?? [`{"@context":"https://schema.org","@type":"BreadcrumbList"}`]).map((j) => `<script type="application/ld+json">${j}</script>`).join("\n")}
<style>.x{color:red}</style><script>self.__next_f.push([1,"undefined NEXT_PUBLIC_BILLING_API {count}"])</script></head>
<body><main>${o.body ?? (o.route === "/disclaimer" ? DISCLAIMER_BODY : '<h1>Welcome</h1><p>Make a ball clip. <a href="mailto:support@example.com">Write to us</a>.</p>')}</main></body></html>`;
}

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

const SECURE_HEADERS = {
  "strict-transport-security": "max-age=15552000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
  "permissions-policy": "camera=()",
  "x-build": BUILD,
};

interface Site {
  pages?: (o: PageOptions) => Partial<PageOptions> | null | "missing";
  headers?: Record<string, string>;
  buildTxt?: string | null;
  version?: unknown;
  config?: unknown;
  health?: unknown;
  httpRedirect?: string | null;
  wwwRedirect?: string | null;
  cardSize?: [number, number];
  latestYml?: string | null;
  assets?: boolean;
  sitemap?: string[] | null;
  security?: boolean;
  calls?: string[];
}

/** A fake site: the fetch function a check run is handed. Everything not listed answers 404. */
function fakeSite(s: Site = {}) {
  const calls: string[] = [];
  const release = readDesktopRelease(fs.readFileSync(path.join(ROOT, "src/lib/desktop/release.ts"), "utf8"));
  const respond = (body: string | Uint8Array | null, init: { status?: number; headers?: Record<string, string> } = {}) => new Response(body as BodyInit | null, { status: init.status ?? 200, headers: init.headers });
  const fetchImpl = async (url: string, init: { method?: string } = {}) => {
    calls.push(`${init.method ?? "GET"} ${url}`);
    const u = new URL(url);
    if (u.protocol === "http:") return s.httpRedirect === null ? respond("<html></html>") : respond(null, { status: 301, headers: { location: s.httpRedirect ?? `https://${u.host}${u.pathname}` } });
    if (u.host === `www.${new URL(SITE).host}`) return s.wwwRedirect === null ? respond("<html></html>") : respond(null, { status: 301, headers: { location: s.wwwRedirect ?? `${SITE}${u.pathname}` } });
    if (u.host === new URL(DEFAULT_BILLING).host) return u.pathname === "/config" ? respond(JSON.stringify(s.config ?? { plans: { monthly: { usd: 6.99 }, yearly: { usd: 49 } }, providers: { stripe: true, paypal: false, crypto: true }, testMode: false })) : respond("", { status: 404 });
    if (u.host === new URL(DEFAULT_RELAY).host) return respond(JSON.stringify(s.health ?? { ok: true, platforms: { tiktok: false, instagram: false, youtube: false } }));
    if (u.host === "github.com") {
      const name = u.pathname.split("/").pop();
      if (init.method === "HEAD") return s.assets === false ? respond(null, { status: 404 }) : respond(null, { status: 302, headers: { location: `https://objects.example.com/${name}` } });
      if (name === "latest.yml") return s.latestYml === null ? respond("", { status: 404 }) : respond(s.latestYml ?? `version: ${release.version}\nfiles:\n  - url: x\n`);
    }
    if (u.host !== new URL(SITE).host) return respond("", { status: 404 });
    const p = u.pathname;
    if (p === "/build.txt") return s.buildTxt === null ? respond("", { status: 404 }) : respond(`${s.buildTxt ?? SHA}\n`);
    if (p === "/version.json") return s.version === null ? respond("", { status: 404 }) : respond(JSON.stringify(s.version ?? { siteVersion: "1.10.0", build: BUILD, commit: SHA, commitDate: "2026-10-14T01:57:35Z" }));
    if (p === "/sitemap.xml") {
      const listed = s.sitemap === undefined ? LOCALES.flatMap((l: string) => PAGES.map((r: string) => pageAddress(SITE, l, r))) : s.sitemap;
      return listed === null ? respond("", { status: 404 }) : respond(`<urlset>${listed.map((x) => `<url><loc>${x}</loc></url>`).join("")}</urlset>`);
    }
    if (p === "/robots.txt") return respond(`User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
    if (p === "/.well-known/security.txt") return s.security === false ? respond("", { status: 404 }) : respond("Contact: mailto:support@example.com\n");
    if (p.startsWith("/og/")) return respond(png(...(s.cardSize ?? [1200, 630])), { headers: { "content-type": "image/png" } });
    const m = /^\/(en|pl|es)(\/.*?)?\/$/.exec(p);
    if (m) {
      const locale = m[1];
      const route = m[2] === undefined ? "" : m[2];
      if (![...PAGES, ...EXTRA_TEXT_PAGES].includes(route)) return respond("", { status: 404 });
      const custom = s.pages?.({ locale, route }) ?? {};
      if (custom === "missing") return respond("<html><body>404</body></html>", { status: 404 });
      return respond(pageHtml({ locale, route, ...custom }), { headers: { "content-type": "text/html", ...(s.headers ?? SECURE_HEADERS) } });
    }
    return respond("", { status: 404 });
  };
  return { fetchImpl: fetchImpl as unknown as (u: string, i?: unknown) => Promise<Response>, calls };
}

const run = (s: Site = {}, extra: Record<string, unknown> = {}) => runChecks({ site: SITE, root: ROOT, fetchImpl: fakeSite(s).fetchImpl, ...extra });
const byId = (results: { id: string; status: string; detail: string }[], id: string) => results.find((r) => r.id === id)!;

// ---- the helpers --------------------------------------------------------------------------------------------------------------

describe("launch-check: reading HTML", () => {
  it("decodes the entities a page uses and leaves an unknown one alone", () => {
    expect(decodeEntities("Fish &amp; chips &lt;b&gt; &#39;hi&#39; &#x2013; &nbsp;&unknown;")).toBe("Fish & chips <b> 'hi' –  &unknown;");
  });

  it("extracts the head: title, description, canonical, hreflang (React's hrefLang), Open Graph, Twitter, robots, build and JSON-LD", () => {
    const head = extractHead(pageHtml({ locale: "pl", route: "/gallery", title: "Galeria &amp; presety – JumpingBallsLive", robots: "noindex" }));
    expect(head.title).toBe("Galeria & presety – JumpingBallsLive");
    expect(head.description).toBe(descriptionOf("pl", "/gallery"));
    expect(head.canonical).toBe(`${SITE}/pl/gallery/`);
    expect(head.alternates).toEqual({ en: `${SITE}/en/gallery/`, pl: `${SITE}/pl/gallery/`, es: `${SITE}/es/gallery/`, "x-default": `${SITE}/en/gallery/` });
    expect(head.og).toMatchObject({ image: `${SITE}/og/pl/gallery.png`, url: `${SITE}/pl/gallery/`, locale: "en_US", type: "website" });
    expect(head.twitter.card).toBe("summary_large_image");
    expect(head.robots).toBe("noindex");
    expect(head.build).toBe(BUILD);
    expect(head.jsonLd).toHaveLength(1);
    expect(extractHead("<html></html>")).toMatchObject({ title: "", description: null, canonical: null, alternates: {}, jsonLd: [] });
  });

  it("reads attributes in any order, with single quotes and without quotes", () => {
    const head = extractHead(`<meta content='A description that is long enough to count' name='description'><link href=https://x.test/en/ rel=canonical><link hreflang=en rel=alternate href=https://x.test/en/>`);
    expect(head.description).toBe("A description that is long enough to count");
    expect(head.canonical).toBe("https://x.test/en/");
    expect(head.alternates).toEqual({ en: "https://x.test/en/" });
  });

  it("reads only what a visitor reads: no scripts, styles, templates or comments, entities decoded", () => {
    const text = visibleText(pageHtml({ locale: "en", route: "", body: "<h1>Free &amp; fast</h1><!-- hidden --><template><p>NEXT_PUBLIC_X</p></template><p>Pro  removes\nthe watermark.</p>" }));
    expect(text).toBe("Free & fast Pro removes the watermark.");
    expect(text).not.toMatch(/undefined|NEXT_PUBLIC|\{count\}/);
  });

  it("finds developer strings and nothing else", () => {
    const hits = developerStrings("Set NEXT_PUBLIC_FEEDBACK_ENDPOINT before building. Hello {siteName}. The value is undefined. http://localhost:3000 and [object Object], NaN.");
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(developerStrings("Free, no account. Export a vertical clip. Nothing to configure here. Undefined behaviour is not a thing we ship. Nan is a name.")).toEqual([]);
    expect(developerStrings("Payments are not configured.")).toHaveLength(1);
  });

  it("reads the size of a PNG from its header, and refuses everything else", () => {
    expect(pngSize(png(1200, 630))).toEqual({ width: 1200, height: 630 });
    expect(pngSize(png(640, 360))).toEqual({ width: 640, height: 360 });
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(pngSize(new TextEncoder().encode("RIFF....WEBPVP8 ......................"))).toBeNull();
    const broken = png(1200, 630);
    broken[12] = 0;
    expect(pngSize(broken)).toBeNull();
  });

  it("lists the addresses of a sitemap and the chunks of a page", () => {
    expect(sitemapUrls(`<urlset><url><loc>${SITE}/en/</loc></url><url><loc> ${SITE}/pl/?a=1&amp;b=2 </loc></url></urlset>`)).toEqual([`${SITE}/en/`, `${SITE}/pl/?a=1&b=2`]);
    const html = `<script src="/_next/static/chunks/main-abc.js?v=1" defer></script><link href="/_next/static/chunks/a.js" rel="preload"/><script src="/_next/static/chunks/main-abc.js"></script>`;
    expect(chunkUrls(html, `${SITE}/en/`)).toEqual([`${SITE}/_next/static/chunks/main-abc.js`, `${SITE}/_next/static/chunks/a.js`]);
  });
});

describe("launch-check: judging a page", () => {
  const ok = (o: Partial<PageOptions> = {}) => headProblems(extractHead(pageHtml({ locale: "es", route: "/pricing", ...o })), { site: SITE, locale: "es", route: "/pricing" });
  const none = { title: [], description: [], canonical: [], hreflang: [], og: [], robots: [] };

  it("passes a page with a right head", () => {
    expect(ok()).toEqual(none);
  });

  it("holds a title to 60 characters and a description to 70 to 160, counted as characters", () => {
    expect(ok({ title: "x".repeat(60) }).title).toEqual([]);
    expect(ok({ title: "x".repeat(61) }).title).toEqual(["61 characters (at most 60)"]);
    expect(ok({ title: "ł".repeat(60) }).title).toEqual([]);
    expect(ok({ description: "x".repeat(69) }).description).toHaveLength(1);
    expect(ok({ description: "x".repeat(70) }).description).toEqual([]);
    expect(ok({ description: "x".repeat(160) }).description).toEqual([]);
    expect(ok({ description: "x".repeat(161) }).description).toHaveLength(1);
  });

  it("wants its own canonical address and the full hreflang set with the English page as x-default", () => {
    expect(ok({ canonical: `${SITE}/en/pricing/` }).canonical).toHaveLength(1);
    expect(ok({ alternates: { en: `${SITE}/en/pricing/`, pl: `${SITE}/pl/pricing/`, es: `${SITE}/es/pricing/` } }).hreflang).toEqual(["x-default: missing"]);
    expect(ok({ alternates: { en: `${SITE}/en/pricing/`, pl: `${SITE}/pl/pricing/`, es: `${SITE}/es/pricing/`, "x-default": `${SITE}/es/pricing/`, de: "x" } }).hreflang).toEqual([`x-default: ${SITE}/es/pricing/`, "unexpected de"]);
  });

  it("wants a card: an absolute https og:image, og:locale and a large Twitter card", () => {
    expect(ok({ ogImage: null }).og[0]).toContain("og:image is missing");
    expect(ok({ ogImage: "/og.png" }).og[0]).toContain("/og.png");
    expect(ok({ noLocale: true }).og).toEqual(["no og:locale"]);
    expect(ok({ ogImage: "http://jumpingballslive.com/og/es/pricing.png" }).og[0]).toContain("absolute https address");
    // a site served over http (a local build) names its card over http
    const local = "http://localhost:3108";
    const html = pageHtml({ locale: "es", route: "/pricing" }).replaceAll(SITE, local);
    expect(headProblems(extractHead(html), { site: local, locale: "es", route: "/pricing" }).og).toEqual([]);
  });

  it("flags noindex on a public page but not on the redirect stub at the root", () => {
    expect(ok({ robots: "noindex" }).robots).toEqual(["noindex"]);
    expect(headProblems(extractHead(pageHtml({ locale: "en", route: "", robots: "noindex" })), { site: SITE, locale: "en", route: "" }).robots).toEqual([]);
  });

  it("names the payment words of a text, in three languages, and the ones the Worker does not have", () => {
    expect(providersNamed("by card, PayPal or crypto")).toEqual({ paypal: true, crypto: true, card: true });
    expect(providersNamed("kartą, PayPal lub kryptowalutami")).toEqual({ paypal: true, crypto: true, card: true });
    expect(providersNamed("con tarjeta o criptomonedas")).toEqual({ paypal: false, crypto: true, card: true });
    expect(providersNamed("a card in the mode wall")).toMatchObject({ card: true });
    expect(unsupportedProviders("by card, PayPal or crypto", { stripe: true, paypal: false, crypto: true })).toEqual(["PayPal"]);
    expect(unsupportedProviders("by card or crypto", { stripe: true, paypal: false, crypto: true })).toEqual([]);
    expect(unsupportedProviders("by card or crypto", { stripe: false, paypal: false, crypto: false })).toEqual(["crypto", "card"]);
  });

  it("tells selling Publish from quick share", () => {
    expect(sellsPublish("Publish to TikTok, Instagram and YouTube")).toBe(true);
    expect(sellsPublish("Pro exports them clean and adds quick share to TikTok, Instagram and YouTube.")).toBe(false);
    expect(sellsPublish("Publikuj na TikToku")).toBe(true);
    expect(sellsPublish("Puedes publicar en TikTok")).toBe(true);
    expect(sellsPublish("Wyślij na TikToka")).toBe(false);
  });

  it("lists the security headers a response lacks", () => {
    expect(missingSecurityHeaders(new Headers(SECURE_HEADERS))).toEqual([]);
    expect(missingSecurityHeaders(new Headers())).toHaveLength(5);
    expect(missingSecurityHeaders(new Headers({ ...SECURE_HEADERS, "x-frame-options": "", "content-security-policy": "frame-ancestors 'self'" }))).toEqual([]);
    expect(missingSecurityHeaders(new Headers({ ...SECURE_HEADERS, "strict-transport-security": "includeSubDomains" }))).toEqual(["Strict-Transport-Security"]);
    expect(missingSecurityHeaders({ "x-content-type-options": "nosniff" })).toHaveLength(4);
  });

  it("reads the update feed's version and the app's release facts from the code", () => {
    expect(parseLatestYml("version: 1.2.0\nfiles:\n  - url: a")).toBe("1.2.0");
    expect(parseLatestYml("version: '1.3.0-beta.1'\n")).toBe("1.3.0-beta.1");
    expect(parseLatestYml("path: x")).toBeNull();
    const release = readDesktopRelease(fs.readFileSync(path.join(ROOT, "src/lib/desktop/release.ts"), "utf8"));
    expect(release).toEqual({ version: DESKTOP_VERSION, repo: "CronusAztec/jumpingballslive-windows", setup: "JumpingBallsLive-Setup.exe", portable: "JumpingBallsLive-portable.exe" });
  });

  it("reads the prices and the mode counts the ad copy states, and the count a landing page's description states", () => {
    const real = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/ads/copy.json"), "utf8"));
    const facts = adCopyFacts(real);
    expect(facts.prices).toEqual([6.99]);
    expect(facts.modes).toHaveLength(1);
    expect(adCopyFacts({ entries: [{ text: "Pro od 6,99 USD miesięcznie" }, { text: "Pro desde 6,99 US$ al mes" }, { text: "$49 a year, 45 Ball Physics Modes, 45 trybów, 46 modos" }] })).toEqual({ prices: [6.99, 49], modes: [45, 46] });
    expect(adCopyFacts(null)).toEqual({ prices: [], modes: [] });
    expect(modeCountOf(DESCRIPTION)).toBe(COPY_MODES);
    expect(modeCountOf("No count here")).toBeNull();
    expect(modeCountOf(null)).toBeNull();
  });

  it("keeps the campaign only when both names are still in the address", () => {
    expect(campaignKept("?utm_source=launchcheck&gclid=launchcheck&mode=classic")).toBe(true);
    expect(campaignKept("?mode=classic")).toBe(false);
    expect(campaignKept("?utm_source=launchcheck")).toBe(false);
    expect(campaignKept("")).toBe(false);
    expect(campaignKept(undefined)).toBe(false);
  });
});

describe("launch-check: the build names itself", () => {
  const version = { siteVersion: "1.10.0", build: BUILD, commit: SHA, commitDate: "2026-10-14T01:57:35Z" };

  it("passes when /build.txt, /version.json, the page meta and X-Build agree", () => {
    const j = judgeBuildIdentity({ buildTxt: `${SHA}\n`, versionJson: version, buildMeta: BUILD, buildHeader: BUILD });
    expect(j.status).toBe("PASS");
    expect(j.detail).toContain(BUILD);
  });

  it("fails an older build: no version.json, a build.txt that is not a commit, a commit that differs, a wrong id", () => {
    expect(judgeBuildIdentity({ buildTxt: "not a sha", versionJson: version }).status).toBe("FAIL");
    expect(judgeBuildIdentity({ buildTxt: SHA, versionJson: null }).detail).toContain("older build");
    expect(judgeBuildIdentity({ buildTxt: "b".repeat(40), versionJson: version }).detail).toMatch(/\/version\.json says 8fa8dbb, \/build\.txt says bbbbbbb/);
    expect(judgeBuildIdentity({ buildTxt: SHA, versionJson: { ...version, build: "1.10.0+dev" } }).detail).toContain("expected");
  });

  it("warns on a page or header that carries another id, and on a commit that is not the one expected (a fail when it was asked for)", () => {
    expect(judgeBuildIdentity({ buildTxt: SHA, versionJson: version, buildMeta: "1.9.0+abc1234", buildHeader: BUILD }).status).toBe("WARN");
    expect(judgeBuildIdentity({ buildTxt: SHA, versionJson: version, buildMeta: BUILD, buildHeader: null }).status).toBe("WARN");
    expect(judgeBuildIdentity({ buildTxt: SHA, versionJson: version, buildMeta: BUILD, buildHeader: BUILD, expected: { sha: "c".repeat(40), explicit: false } as never }).status).toBe("WARN");
    expect(judgeBuildIdentity({ buildTxt: SHA, versionJson: version, buildMeta: BUILD, buildHeader: BUILD, expected: { sha: "c".repeat(40), explicit: true } as never }).status).toBe("FAIL");
    expect(judgeBuildIdentity({ buildTxt: SHA, versionJson: version, buildMeta: BUILD, buildHeader: BUILD, expected: { sha: SHA, explicit: true } as never }).status).toBe("PASS");
  });
});

// ---- the whole run ----------------------------------------------------------------------------------------------------------------

describe("launch-check: a run against a site that is ready", () => {
  it("passes every check it can make without a browser, and skips the two that need an option", async () => {
    const { ok, results } = await run();
    expect(results.filter((r: { status: string }) => r.status === "FAIL").map((r: { id: string; detail: string }) => `${r.id} ${r.detail}`)).toEqual([]);
    expect(ok).toBe(true);
    const ids = results.map((r: { id: string }) => r.id);
    expect(ids).toEqual(["A1", "A2", "A2b", "A2c", "A2d", "A2e", "A2f", "A2g", "A3", "A4", "A5", "A5b", "A6", "A7", "A8", "A9", "A10", "A11", "B1", "B2", "B3", "B4", "B5", "B6"]);
    expect(byId(results, "A8").status).toBe("SKIP");
    expect(byId(results, "A9").status).toBe("SKIP");
    expect(results.filter((r: { status: string }) => r.status === "WARN").map((r: { id: string; detail: string }) => `${r.id} ${r.detail}`)).toEqual([]);
    expect(byId(results, "A2").detail).toContain(`${PAGES.length * LOCALES.length} pages`);
    expect(byId(results, "A2d").detail).toContain("1200×630");
    expect(byId(results, "A7").detail).toContain(DESKTOP_VERSION);
  });

  it("asks for every page of every language once, the extra text pages too, and only reads (GET and HEAD)", async () => {
    const site = fakeSite();
    await runChecks({ site: SITE, root: ROOT, fetchImpl: site.fetchImpl });
    for (const l of LOCALES) for (const r of [...PAGES, ...EXTRA_TEXT_PAGES]) expect(site.calls.filter((c) => c === `GET ${pageAddress(SITE, l, r)}`)).toHaveLength(1);
    expect(site.calls.every((c) => /^(GET|HEAD) /.test(c))).toBe(true);
    expect(site.calls.some((c) => c.startsWith("GET http://") || c.startsWith("GET https://www."))).toBe(true);
  });

  it("checks the statistics service when told which host to look for, and finds it in the landing page or in its scripts", async () => {
    const found = await run({ pages: ({ locale, route }) => (locale === "en" && route === "" ? { body: '<h1>Hi</h1><a href="https://stats.example.com/script.js">x</a>' } : {}) }, { analytics: "https://stats.example.com/script.js" });
    expect(byId(found.results, "A8").status).toBe("PASS");
    const missing = await run({}, { analytics: "stats.example.com" });
    expect(byId(missing.results, "A8").status).toBe("FAIL");
  });

  it("takes the browser step's verdict as A9", async () => {
    const { results } = await run({}, { browser: async () => ({ status: "PASS", detail: "kept" }) });
    expect(byId(results, "A9")).toMatchObject({ status: "PASS", detail: "kept" });
    const failed = await run({}, { browser: async () => Promise.reject(new Error("no chromium")) });
    expect(byId(failed.results, "A9")).toMatchObject({ status: "FAIL" });
    expect(byId(failed.results, "A9").detail).toContain("no chromium");
  });

  it("holds the live build to the commit it was asked for", async () => {
    expect(byId((await run({}, { expected: { sha: SHA, explicit: true } })).results, "A1").status).toBe("PASS");
    const other = await run({}, { expected: { sha: "c".repeat(40), explicit: true } });
    expect(byId(other.results, "A1").status).toBe("FAIL");
    expect(other.ok).toBe(false);
    expect(byId((await run({}, { expected: { sha: "c".repeat(40), explicit: false } })).results, "A1").status).toBe("WARN");
  });
});

describe("launch-check: a run against an older build", () => {
  const OLD: Site = {
    version: null,
    headers: {},
    config: { plans: { monthly: { usd: 6.99 }, yearly: { usd: 49 } }, providers: { stripe: true, paypal: false, crypto: true } },
    httpRedirect: null,
    wwwRedirect: null,
    security: false,
    pages: ({ route }) => {
      if (route === "/press" || route === "/changelog") return "missing";
      const base: Partial<PageOptions> = { build: null, noLocale: true };
      if (route === "") return { ...base, title: "Satisfying Ball Physics Simulator for TikTok and Reels – JumpingBallsLive", ogImage: `${SITE}/og.png` };
      if (route === "/pricing") return { ...base, description: "Play with every mode and export videos for free, with a small watermark. Pro removes it for $6.99 a month or $49 a year, by card, PayPal or crypto.", body: "<h1>Pricing</h1><p>Publish to TikTok, Instagram and YouTube. Paid by card, PayPal or crypto.</p>" };
      if (route === "/privacy") return { ...base, description: "Privacy.", body: "<h1>Privacy</h1><p>Stripe, PayPal and NOWPayments.</p>" };
      if (route === "/feedback") return { body: "<h1>Feedback</h1><p>Set NEXT_PUBLIC_FEEDBACK_ENDPOINT before building.</p>" };
      return base;
    },
    sitemap: LOCALES.flatMap((l: string) => PAGES.filter((r: string) => r !== "/press" && r !== "/changelog").map((r: string) => pageAddress(SITE, l, r))),
  };

  it("fails the build identity, the missing pages, the head, the PayPal line and the developer string, and warns on the rest", async () => {
    const { ok, results } = await run(OLD);
    expect(ok).toBe(false);
    expect(byId(results, "A1").status).toBe("FAIL");
    expect(byId(results, "A1").detail).toContain("/version.json is missing");
    expect(byId(results, "A2").status).toBe("FAIL");
    expect(byId(results, "A2").detail).toContain("/en/press/ 404");
    expect(byId(results, "A2c").status).toBe("FAIL");
    expect(byId(results, "A2c").detail).toContain("no og:locale");
    expect(byId(results, "A2e").status).toBe("FAIL");
    expect(byId(results, "A2e").detail).toContain("73 characters");
    expect(byId(results, "A2f").status).toBe("FAIL");
    expect(byId(results, "A4").status).toBe("FAIL");
    expect(byId(results, "A4").detail).toContain("NEXT_PUBLIC_FEEDBACK_ENDPOINT");
    expect(byId(results, "A5").status).toBe("FAIL");
    expect(byId(results, "A5").detail).toContain("PayPal");
    for (const id of ["A5b", "A6", "A10", "A11", "B1", "B6"]) expect(byId(results, id).status, id).toBe("WARN");
    expect(byId(results, "A3").status).toBe("WARN"); // the old privacy page has no mailto
  });

  it("warns that nobody can reach the operator, with the steps, when the privacy page has no mailto", async () => {
    const { results } = await run({ pages: ({ route }) => (route === "/privacy" ? { body: "<h1>Privacy</h1><p>No address.</p>" } : {}) });
    expect(byId(results, "A3").status).toBe("WARN");
    expect(byId(results, "A3").detail).toContain("JBL_SUPPORT_EMAIL");
  });

  it("gives the exact Cloudflare step for http and www, and notes a proxy", async () => {
    const { results } = await run(OLD);
    const detail = byId(results, "A10").detail;
    expect(detail).toContain("Always Use HTTPS");
    expect(detail).toContain("Redirect Rules");
    expect(detail).toContain("http.request.uri.path");
    expect(detail).toContain("direct connection");
    const good = await run({});
    expect(byId(good.results, "A10")).toMatchObject({ status: "PASS" });
    expect(byId(good.results, "A10").detail).toContain("redirects to https");
    expect(byId(good.results, "A10").detail).toContain("www redirects to the bare domain");
  });

  it("fails a card that is the wrong size or not a PNG, and a sitemap that lists a page that does not answer", async () => {
    expect(byId((await run({ cardSize: [640, 360] })).results, "A2d").status).toBe("FAIL");
    expect(byId((await run({ cardSize: [1200, 630] })).results, "A2d").status).toBe("PASS");
    const dead = await run({ pages: ({ route }) => (route === "/press" ? "missing" : {}) });
    expect(byId(dead.results, "B1").status).toBe("FAIL");
    expect(byId(dead.results, "B1").detail).toContain("/en/press/");
  });

  it("fails an ad copy that names a price the Worker does not have, and warns when the live mode count differs", async () => {
    expect(byId((await run({ config: { plans: { monthly: { usd: 9.99 }, yearly: { usd: 49 } }, providers: { stripe: true, paypal: false, crypto: true } } })).results, "B5").status).toBe("FAIL");
    const modes = await run({ pages: ({ route }) => (route === "" ? { description: DESCRIPTION.replace(`${COPY_MODES} modes`, "152 modes") } : {}) });
    expect(byId(modes.results, "B5").status).toBe("WARN");
    expect(byId(modes.results, "B5").detail).toContain("152");
  });

  it("fails an app version the download does not serve, and a download that is not there", async () => {
    expect(byId((await run({ latestYml: "version: 0.0.1\n" })).results, "A7").status).toBe("FAIL");
    expect(byId((await run({ assets: false })).results, "A7").status).toBe("FAIL");
    expect(byId((await run({ latestYml: null })).results, "A7").status).toBe("WARN");
  });

  it("warns that Publish is sold when no platform can be connected, and not when it says share", async () => {
    const sells = await run({ pages: ({ locale, route }) => (locale === "en" && route === "/pricing" ? { body: "<h1>Pricing</h1><p>Publish to TikTok.</p>" } : {}) });
    expect(byId(sells.results, "A6").status).toBe("WARN");
    const on = await run({ health: { ok: true, platforms: { tiktok: true } }, pages: ({ locale, route }) => (locale === "en" && route === "/pricing" ? { body: "<h1>Pricing</h1><p>Publish to TikTok.</p>" } : {}) });
    expect(byId(on.results, "A6").status).toBe("PASS");
    expect(byId((await run()).results, "A6").detail).toContain("share is the honest word");
  });

  it("warns when the disclaimer has no Fight League notice, and when the site is unreachable it fails instead of throwing", async () => {
    const none = await run({ pages: ({ locale, route }) => (locale === "en" && route === "/disclaimer" ? { body: "<h1>Disclaimer</h1><p>General.</p>" } : {}) });
    expect(byId(none.results, "B4").status).toBe("WARN");
    const down = await runChecks({ site: SITE, root: ROOT, fetchImpl: (async () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }))) as never });
    expect(down.ok).toBe(false);
    expect(byId(down.results, "A1").detail).toContain("ENOTFOUND");
    expect(byId(down.results, "A2").status).toBe("FAIL");
  });
});

describe("launch-check: the report and the command", () => {
  it("prints one line per check and a verdict that counts the failures and the warnings", () => {
    const lines = formatReport([
      { id: "A1", title: "build-identity", status: "PASS", detail: "fine" },
      { id: "A2b", title: "canonical-hreflang", status: "WARN", detail: "hm" },
      { id: "A10", title: "redirects", status: "FAIL", detail: "no" },
    ]);
    expect(lines[0]).toBe("PASS  A1   build-identity     – fine");
    expect(lines[2]).toBe("FAIL  A10  redirects          – no");
    expect(lines.at(-1)).toBe("LAUNCH CHECK: FAIL (1 failed, 1 warning)");
    expect(formatReport([{ id: "A1", title: "x", status: "WARN", detail: "" }, { id: "A2", title: "y", status: "WARN", detail: "" }]).at(-1)).toBe("LAUNCH CHECK: PASS (2 warnings)");
    expect(formatReport([{ id: "A1", title: "x", status: "PASS", detail: "" }, { id: "A8", title: "y", status: "SKIP", detail: "" }]).at(-1)).toBe("LAUNCH CHECK: PASS");
  });

  it("explains itself with --help and refuses a bad address, a bad commit and an unknown option", async () => {
    expect(await main(["--help"])).toBe(0);
    await expect(main(["--url", "not-a-url"])).rejects.toThrow(/--url/);
    await expect(main(["--commit", "xyz"])).rejects.toThrow(/--commit/);
    await expect(main(["--nope"])).rejects.toThrow(/Unknown option/);
    await expect(main(["--url"])).rejects.toThrow(/needs a value/);
  });

  it("is wired up: the npm script, the feature marker, the live site as the default", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["launch:check"]).toBe("node scripts/launch-check.mjs");
    const source = fs.readFileSync(path.join(ROOT, "scripts/launch-check.mjs"), "utf8");
    expect(source.split("\n")[0]).toBe("#!/usr/bin/env node");
    expect(source).toContain("// --- launch-check ---");
    expect(DEFAULT_SITE).toBe("https://jumpingballslive.com");
    expect(DEFAULT_BILLING).toBe("https://jumpingballslive-billing.jumpingballslive.workers.dev");
    expect(DEFAULT_RELAY).toBe("https://relay.jumpingballslive.com");
    // the defaults are the ones the deployer builds the live site with
    const deploy = fs.readFileSync(path.join(ROOT, "deploy/vps/jbl-deploy.sh"), "utf8");
    expect(deploy).toContain(DEFAULT_BILLING);
    expect(deploy).toContain(DEFAULT_RELAY);
  });

  it("covers the public pages of the site map and the three languages", () => {
    expect(LOCALES).toEqual(["en", "pl", "es"]);
    const sitemap = fs.readFileSync(path.join(ROOT, "src/app/sitemap.ts"), "utf8");
    const listed = [...(/STATIC_PATHS: readonly string\[\] = \[([^\]]*)\]/.exec(sitemap)?.[1] ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    expect([...PAGES].sort()).toEqual([...listed].sort());
    expect(EXTRA_TEXT_PAGES).toEqual(["/feedback"]);
  });
});
