import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import vm from "vm";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { MODE_IDS, isModeId } from "@/lib/physics/types";
import { MODE_CARD_ORDER } from "@/lib/modes";
import sitemap from "@/app/sitemap";
import manifest from "@/app/manifest";
import { KNOWN_ROUTES, bestLocale, localeOfPath, unprefixedRedirectScript, unprefixedTarget } from "@/lib/localeRedirect"; // --- site-nav ---
import { handOverState, pageBefore, resetTrail, takeHandedState, visitPage } from "@/lib/siteTrail"; // --- site-nav ---
import { loadDotEnv } from "../scripts/dotenv.mjs";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * --- review fix (site-static) --- Site pages, metadata, static export and the scripts around it: the site's domain, the mode
 * count of the copy and the structured data, the localised mode previews and simulator heading, the sitemap, the 404 page's
 * messages, the .env loader of the scripts and the static server.
 */

const ROOT = path.resolve(__dirname, "..");
const CATALOGS = { en, pl, es } as Record<string, unknown>;

/** Every string of a catalog with its dotted key. */
function strings(node: unknown, prefix = "", out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") out.push([prefix, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => strings(v, `${prefix}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) strings(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

describe("site domain", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is derived from the deploy URL (no hard-coded domain nobody serves), and NEXT_PUBLIC_SITE_DOMAIN overrides it", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cronusaztec.github.io/Balls/");
    vi.stubEnv("NEXT_PUBLIC_SITE_DOMAIN", "");
    vi.resetModules();
    expect((await import("@/lib/site")).SITE_DOMAIN).toBe("cronusaztec.github.io/Balls");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.org");
    vi.resetModules();
    expect((await import("@/lib/site")).SITE_DOMAIN).toBe("example.org");
    vi.stubEnv("NEXT_PUBLIC_SITE_DOMAIN", "example.com/");
    vi.resetModules();
    expect((await import("@/lib/site")).SITE_DOMAIN).toBe("example.com");
  });

  it("the copy names no unregistered domain: the legal pages credit the operator, the footer shows the name", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, text] of strings(catalog)) expect(text.toLowerCase(), `${locale} ${key}`).not.toContain("jumpingballslive.com");
    }
    expect(en.Terms.intellectual.content).toContain("the operator of {siteName}");
    expect(pl.Terms.intellectual.content).toContain("operatora serwisu {siteName}");
    expect(es.Terms.intellectual.content).toContain("al operador de {siteName}");
    const footer = fs.readFileSync(path.join(ROOT, "src/components/site/Footer.tsx"), "utf8");
    expect(footer).toContain("{SITE_NAME}");
    expect(footer).not.toContain("SITE_DOMAIN");
  });
});

describe("mode count", () => {
  const HARD_CODED = /\b\d+\s+(unique |simulation |unikalnymi |únicos )?(modes|modos|trybów|trybami|tryby)\b/i;
  const SPELLED = /\b(eleven|twelve|thirteen|once|doce|trece|jedenaście|jedenastu|dwanaście|dwunastu|trzynaście|trzynastu)\s+(\S+\s+)?(modes|modos|trybów|trybami|tryby|tryb)\b/i;
  const COUNT = MODE_CARD_ORDER.length;

  it("every mode has a card, so the cards' count is the number of modes", () => {
    expect([...MODE_CARD_ORDER].sort()).toEqual([...MODE_IDS].sort());
    expect(COUNT).toBeGreaterThanOrEqual(27);
  });

  it("no string of any catalog hard-codes how many modes there are", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, text] of strings(catalog)) {
        expect(HARD_CODED.test(text), `${locale} ${key}: ${text.slice(0, 80)}`).toBe(false);
        expect(SPELLED.test(text), `${locale} ${key}: ${text.slice(0, 80)}`).toBe(false);
      }
    }
  });

  it("the three catalogs take the count as a placeholder in the same keys, the meta descriptions among them", () => {
    const keysWith = (catalog: unknown) => strings(catalog).filter(([, text]) => /\{count[,}]/.test(text)).map(([key]) => key).sort();
    const enKeys = keysWith(en);
    expect(keysWith(pl)).toEqual(enKeys);
    expect(keysWith(es)).toEqual(enKeys);
    expect(enKeys).toEqual(expect.arrayContaining(["Layout.metaDescription", "Layout.featuresModes", "SimulatorPage.metaDescription", "TikTokBallVideos.metaDescription", "SiteRedesign.hero.sub" /* --- site-redesign --- the hero's copy */, "HowItWorks.step1.description"]));
  });

  it("formats the count in every locale, and the JSON-LD feature list starts with it", () => {
    for (const [locale, messages] of Object.entries({ en, pl, es })) {
      const t = createTranslator({ locale, messages, namespace: "Layout" });
      expect(t("metaDescription", { count: COUNT })).toContain(String(COUNT));
      expect(t("featuresModes", { count: COUNT })).toMatch(new RegExp(`^${COUNT} `));
      expect((messages.Layout.features as string[]).some((f) => /\d/.test(f) && /mod|tryb/i.test(f))).toBe(false);
    }
    const page = fs.readFileSync(path.join(ROOT, "src/app/[locale]/page.tsx"), "utf8");
    expect(page).toContain('featureList: [layout("featuresModes", { count: MODE_CARD_ORDER.length }), ...(layout.raw("features") as string[])]');
  });

  it("the web app manifest's description carries the count, not the placeholder", () => {
    const m = manifest();
    expect(m.description).toContain(`${COUNT} modes`);
    expect(m.description).not.toContain("{");
  });
});

describe("localised page texts", () => {
  it("the mode preview alt text is localised; Modes holds only modes besides it", () => {
    expect(en.Modes.previewAlt).toBe("{name} mode preview");
    expect(pl.Modes.previewAlt).toBe("Podgląd trybu {name}");
    expect(es.Modes.previewAlt).toBe("Vista previa del modo {name}");
    for (const catalog of [en, pl, es]) {
      expect(Object.keys(catalog.Modes).filter((k) => k !== "previewAlt" && !isModeId(k))).toEqual([]);
      const t = createTranslator({ locale: "pl", messages: catalog, namespace: "Modes" });
      expect(t("previewAlt", { name: t("classic.name") })).toContain(t("classic.name"));
    }
  });

  it("the simulator page has a heading in every language", () => {
    for (const catalog of [en, pl, es]) expect(catalog.SimulatorPage.heading.length).toBeGreaterThan(5);
    const page = fs.readFileSync(path.join(ROOT, "src/app/[locale]/simulator/page.tsx"), "utf8");
    expect(page).toMatch(/<h1 className="sr-only">\{t\("SimulatorPage\.heading"\)\}<\/h1>/);
  });
});

describe("sitemap", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lists only indexable pages, with the same hreflang set as the pages (x-default included)", () => {
    const entries = sitemap();
    expect(entries.some((e) => e.url.includes("/feedback/"))).toBe(false);
    expect(entries.some((e) => e.url.endsWith("/en/simulator/"))).toBe(true);
    expect(entries.some((e) => e.url.endsWith("/es/gallery/"))).toBe(true);
    for (const e of entries) {
      const languages = e.alternates?.languages as Record<string, string>;
      expect(Object.keys(languages).sort()).toEqual(["en", "es", "pl", "x-default"]);
      expect(languages["x-default"]).toBe(languages.en);
    }
    expect(new Set(entries.map((e) => e.url)).size).toBe(entries.length);
  });

  it("stamps the deployed commit's date, never the build time (the pages that carry a date of their own keep it: tests/seo.test.ts)", () => {
    // --- seo --- the changelog, the download page and the legal pages state when they changed; every other page takes the deploy date
    const withoutOwnDate = () => sitemap().filter((e) => !/\/(changelog|download|privacy|terms|disclaimer)\/$/.test(e.url));
    expect(withoutOwnDate().length).toBeGreaterThan(20);
    vi.stubEnv("SITEMAP_LASTMOD", "");
    expect(withoutOwnDate().every((e) => e.lastModified === undefined)).toBe(true);
    vi.stubEnv("SITEMAP_LASTMOD", "2026-09-30T12:34:56+02:00");
    expect(withoutOwnDate().every((e) => e.lastModified === "2026-09-30T12:34:56+02:00")).toBe(true);
    vi.stubEnv("SITEMAP_LASTMOD", "not a date");
    expect(withoutOwnDate().every((e) => e.lastModified === undefined)).toBe(true);
  });
});

describe("static 404 page", () => {
  it("bundles only the namespaces its components render", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/components/site/NotFoundStatic.tsx"), "utf8");
    expect(src).not.toMatch(/\{ en, pl, es \}/);
    const used = new Set<string>();
    for (const file of ["NotFoundContent.tsx", "Navbar.tsx", "Footer.tsx", "InstallAppButton.tsx", "LanguageSwitcher.tsx"]) {
      const code = fs.readFileSync(path.join(ROOT, "src/components/site", file), "utf8");
      for (const m of code.matchAll(/useTranslations\("(\w+)"\)/g)) used.add(m[1]);
    }
    for (const locale of ["en", "pl", "es"]) {
      const line = src.split("\n").find((l) => l.trimStart().startsWith(`${locale}: {`)) ?? "";
      for (const ns of used) expect(line, `${locale} ${ns}`).toContain(`${ns}:`);
    }
  });

  it("--- review fix (site-redesign) --- reads every message by static member access: a catalog handed to a function or spread is shipped whole (all three were in the /404 chunk)", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/components/site/NotFoundStatic.tsx"), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/^import .*$/gm, "")
      .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
      .replace(/\btypeof (en|pl|es)\b/g, "");
    expect(code).not.toMatch(/\((en|pl|es)\)/);
    expect(code).not.toMatch(/\.\.\.(en|pl|es)\b/);
    // what is left is member access (en.NotFound, pl.SiteRedesign.nav …) and the locales' keys of MESSAGES
    const bare = [...code.matchAll(/\b(en|pl|es)\b(?!\s*[.:])/g)].map((m) => code.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 30));
    expect(bare).toEqual([]);
    expect(code).toContain("studio: { search: es.SiteRedesign.studio.search }");
  });

  it("the (static) layout sets no title (a metadata <title> would overwrite the localised one); the root page sets its own", () => {
    const layout = fs.readFileSync(path.join(ROOT, "src/app/(static)/layout.tsx"), "utf8");
    const metadata = layout.slice(layout.indexOf("export const metadata"), layout.indexOf("};", layout.indexOf("export const metadata")));
    expect(metadata).not.toMatch(/^\s*title:/m);
    expect(metadata).toMatch(/icons: \{ icon: assetPath\("\/icon\.svg"\)/);
    // --- site-nav --- the root page's head is the English home page's, title included (tests/seo.test.ts reads what it holds)
    const root = fs.readFileSync(path.join(ROOT, "src/app/(static)/page.tsx"), "utf8");
    expect(root).toContain("export async function generateMetadata(): Promise<Metadata> {");
    expect(root).toMatch(/return pageMetadata\(\{ locale, path: "", title: t\("metaTitle", \{ siteName: SITE_NAME \}\)/);
  });
});

/* --- site-nav --- an address typed without its language is sent on to the page it names, by the 404 page */
describe("an address without a language (lib/localeRedirect.ts)", () => {
  /** What the 404 page's inline script does at an address: the address it replaces the location with, or null. */
  const scripted = (at: { pathname: string; search?: string; hash?: string }, languages: string[] | undefined, basePath = "", language = "") => {
    let replaced: string | null = null;
    const location = { pathname: at.pathname, search: at.search ?? "", hash: at.hash ?? "", replace: (to: string) => void (replaced = to) };
    vm.runInNewContext(unprefixedRedirectScript(basePath), { location, navigator: { languages, language } });
    return replaced;
  };

  it("knows every page under src/app/[locale], and nothing else", () => {
    const dir = path.join(ROOT, "src/app/[locale]");
    const pages = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "page.tsx"))).map((d) => d.name).sort();
    expect([...KNOWN_ROUTES].sort()).toEqual(pages);
    expect(pages).toEqual(expect.arrayContaining(["simulator", "gallery", "pricing", "download", "changelog"]));
    // (a route named like a language would never reach the 404 page)
    for (const route of KNOWN_ROUTES) expect(["en", "pl", "es"], route).not.toContain(route);
  });

  it("picks the language the browser asks for first, as the root page does, and the default when it asks for none of ours", () => {
    expect(bestLocale(["pl-PL", "pl", "en-US"])).toBe("pl");
    expect(bestLocale(["de-DE", "es-419", "en"])).toBe("es");
    expect(bestLocale(["EN-gb"])).toBe("en");
    expect(bestLocale(["de", "fr"])).toBe("en");
    expect(bestLocale([])).toBe("en");
    expect(bestLocale(undefined)).toBe("en");
    // "plt" and "english" are not Polish and English
    expect(bestLocale(["plt", "english", "es"])).toBe("es");
  });

  it("sends a known page on to its address with the language, the query and the hash kept", () => {
    expect(unprefixedTarget({ pathname: "/pricing/" }, ["pl-PL"])).toBe("/pl/pricing/");
    expect(unprefixedTarget({ pathname: "/pricing" }, ["pl-PL"])).toBe("/pl/pricing/");
    expect(unprefixedTarget({ pathname: "/simulator/", search: "?mode=fightLeague&seed=7", hash: "#x" }, ["es-ES", "en"])).toBe("/es/simulator/?mode=fightLeague&seed=7#x");
    expect(unprefixedTarget({ pathname: "/changelog/", hash: "#app-1-7-0" }, ["de"])).toBe("/en/changelog/#app-1-7-0");
    expect(unprefixedTarget({ pathname: "/Balls/gallery/" }, ["pl"], "/Balls")).toBe("/Balls/pl/gallery/");
    for (const route of KNOWN_ROUTES) expect(unprefixedTarget({ pathname: `/${route}/` }, ["en"]), route).toBe(`/en/${route}/`);
  });

  it("leaves a real 404 alone: an address with a language, an unknown page, a deeper path, another site's folder", () => {
    for (const pathname of ["/pl/this-page-does-not-exist/", "/en/nothing-here/", "/en/pricing/", "/nope/", "/", "/pricing/extra/", "/de/pricing/", "/404/", "/Pricing/", "/simulator.html"]) {
      expect(unprefixedTarget({ pathname }, ["pl"]), pathname).toBeNull();
    }
    // under a base path only that folder's pages are ours
    expect(unprefixedTarget({ pathname: "/Balls/nope/" }, ["pl"], "/Balls")).toBeNull();
    expect(unprefixedTarget({ pathname: "/Balls/pl/pricing/" }, ["pl"], "/Balls")).toBeNull();
  });

  it("reads the language an address names, or none", () => {
    expect(localeOfPath("/pl/this-page-does-not-exist/")).toBe("pl");
    expect(localeOfPath("/Balls/es/x/", "/Balls")).toBe("es");
    expect(localeOfPath("/pricing/")).toBeNull();
    expect(localeOfPath("/plain/")).toBeNull();
    expect(localeOfPath("/")).toBeNull();
  });

  it("the 404 page's inline script decides exactly as the function does", () => {
    const places = [
      { pathname: "/pricing/" },
      { pathname: "/pricing" },
      { pathname: "/simulator/", search: "?mode=fightLeague", hash: "#modes" },
      { pathname: "/pl/this-page-does-not-exist/" },
      { pathname: "/nope/" },
      { pathname: "/pricing/extra/" },
      { pathname: "/" },
      { pathname: "/Balls/gallery/", search: "?a=1" },
      { pathname: "/Balls/nope/" },
    ];
    for (const languages of [["pl-PL", "en"], ["es"], ["de", "fr"], [], undefined]) {
      for (const base of ["", "/Balls"]) {
        for (const at of places) expect(scripted(at, languages, base), `${JSON.stringify(at)} ${JSON.stringify(languages)} ${base}`).toBe(unprefixedTarget(at, languages, base));
      }
    }
    // a browser that only has navigator.language
    expect(scripted({ pathname: "/pricing/" }, undefined, "", "pl-PL")).toBe("/pl/pricing/");
    expect(scripted({ pathname: "/pricing/" }, [], "", "es")).toBe("/es/pricing/");
    // it is in the 404 page's HTML, before the page itself, and it is plain ES5 (no arrow, no let or const)
    const page = fs.readFileSync(path.join(ROOT, "src/components/site/NotFoundStatic.tsx"), "utf8");
    expect(page.indexOf("unprefixedRedirectScript(BASE_PATH)")).toBeGreaterThan(0);
    expect(page.indexOf("unprefixedRedirectScript(BASE_PATH)")).toBeLessThan(page.indexOf("<NotFoundContent />"));
    expect(unprefixedRedirectScript("")).not.toMatch(/=>|\b(let|const)\b/);
  });

  it("the 404 page speaks the browser's language at an address without one, and offers the wall as a third way back", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/components/site/NotFoundStatic.tsx"), "utf8");
    expect(page).toContain("localeOfPath(window.location.pathname, BASE_PATH) ?? bestLocale(");
    const content = fs.readFileSync(path.join(ROOT, "src/components/site/NotFoundContent.tsx"), "utf8");
    expect((content.match(/<Link href="[^"]+"/g) ?? []).sort()).toEqual(['<Link href="/"', '<Link href="/#modes"', '<Link href="/simulator"']);
    for (const m of [en, pl, es]) expect(m.SiteRedesign.hero.seeModes.length).toBeGreaterThan(5);
  });
});

/* --- site-nav --- the studio's back arrow asks which page came before */
describe("the page before this one (lib/siteTrail.ts)", () => {
  it("is none on the first page, then the page the visitor left, and a page reported twice counts once", () => {
    resetTrail();
    expect(pageBefore()).toBeNull();
    visitPage("/");
    expect(pageBefore()).toBeNull();
    visitPage("/simulator");
    expect(pageBefore()).toBe("/");
    visitPage("/simulator");
    expect(pageBefore()).toBe("/");
    visitPage("/gallery");
    expect(pageBefore()).toBe("/simulator");
    visitPage("/simulator");
    expect(pageBefore()).toBe("/gallery");
    resetTrail();
    expect(pageBefore()).toBeNull();
  });

  it("hands a history state over to the same page once, for a moment: a language switch keeps the wall's search and place", () => {
    resetTrail();
    expect(takeHandedState("/")).toBeNull();
    const state = { jblWall: { q: "fight" } };
    handOverState("/", state, 1000);
    expect(takeHandedState("/", 1500)).toBe(state);
    expect(takeHandedState("/", 1600)).toBeNull(); // taken once
    handOverState("/pricing", state, 1000);
    expect(takeHandedState("/", 1500)).toBeNull(); // another page's
    expect(takeHandedState("/pricing", 1600)).toBeNull(); // and that ask used it up
    handOverState("/", state, 1000);
    expect(takeHandedState("/", 11_000)).toBeNull(); // too late: the switch never arrived
    handOverState("/", state, 1000);
    expect(takeHandedState("/", 10_999)).toBe(state);
    const hook = fs.readFileSync(path.join(ROOT, "src/components/site/useSwitchLocale.ts"), "utf8");
    expect(hook).toContain("handOverState(pathname, window.history.state);");
    expect(hook).toContain("{ locale: code, scroll: false }");
    expect(hook).toContain("pathname + search + hash");
    const wall = fs.readFileSync(path.join(ROOT, "src/components/site/ModesOverview.tsx"), "utf8");
    expect(wall).toContain('wallHistoryOf(takeHandedState("/"))');
  });

  it("the header reports every page, and the studio's back arrow goes back in history only to the landing page", () => {
    const navbar = fs.readFileSync(path.join(ROOT, "src/components/site/Navbar.tsx"), "utf8");
    expect(navbar).toContain("useEffect(() => visitPage(pathname), [pathname]);");
    expect(navbar).toMatch(/pageBefore\(\) !== "\/"\) return;\s+e\.preventDefault\(\);\s+window\.history\.back\(\);/);
    expect(navbar).toContain('<Link href="/#modes" onClick={goBack}');
  });
});

describe("scripts/dotenv.mjs", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it("reads .env files like next build: inline comments and export prefixes handled, the shell never overridden", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotenv-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, ".env.local"), "SITE_STATIC_PROBE_BASE=/Balls # sub-folder of the Pages site\nexport SITE_STATIC_PROBE_QUOTED=\"a # b\"\nSITE_STATIC_PROBE_SHELL=from-file\n");
    fs.writeFileSync(path.join(dir, ".env.production"), "SITE_STATIC_PROBE_PROD=yes\n");
    vi.stubEnv("SITE_STATIC_PROBE_SHELL", "from-shell");
    // vitest runs with NODE_ENV=test, where Next skips .env.local (and reads .env.test*); the scripts run as a build does
    vi.stubEnv("NODE_ENV", "production");
    try {
      loadDotEnv(dir);
      expect(process.env.SITE_STATIC_PROBE_BASE).toBe("/Balls");
      expect(process.env.SITE_STATIC_PROBE_QUOTED).toBe("a # b");
      expect(process.env.SITE_STATIC_PROBE_PROD).toBe("yes");
      expect(process.env.SITE_STATIC_PROBE_SHELL).toBe("from-shell");
      expect(process.env.__NEXT_PROCESSED_ENV).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      for (const k of ["SITE_STATIC_PROBE_BASE", "SITE_STATIC_PROBE_QUOTED", "SITE_STATIC_PROBE_PROD"]) delete process.env[k];
    }
  });
});

describe("scripts/serve-static.mjs", () => {
  let server: ChildProcess | null = null;
  let dir = "";
  afterAll(() => {
    server?.kill();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A raw GET (the path is sent as is, percent-escapes and all). */
  const get = (port: number, rawPath: string) =>
    new Promise<{ status: number; location?: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET" }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }));
      });
      req.on("error", reject);
      req.end();
    });

  it("survives a crafted URL whose decoded path has a newline, and redirects directories with the encoded URL", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "serve-static-"));
    fs.mkdirSync(path.join(dir, "en", "a b"), { recursive: true });
    fs.writeFileSync(path.join(dir, "en", "index.html"), "<p>en</p>");
    fs.writeFileSync(path.join(dir, "en", "a b", "index.html"), "<p>space</p>");
    fs.writeFileSync(path.join(dir, "404.html"), "<p>404</p>");
    const port = 20000 + Math.floor(Math.random() * 20000);
    server = spawn(process.execPath, [path.join(ROOT, "scripts/serve-static.mjs"), "--dir", dir, "--port", String(port), "--base", "/Balls", "--host", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      server!.stdout!.on("data", (d) => String(d).includes("Serving") && resolve());
      server!.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
    expect((await get(port, "/Balls/%0a%2f..%2fen")).status).toBe(404);
    expect((await get(port, "/Balls/en%00")).status).toBe(404);
    expect(await get(port, "/Balls/en")).toEqual({ status: 301, location: "/Balls/en/" });
    expect((await get(port, "/Balls/en/a%20b")).location).toBe("/Balls/en/a%20b/");
    expect((await get(port, "/Balls//en")).location).toBe("/Balls//en/");
    expect((await get(port, "/Balls/en/")).status).toBe(200);
    expect(server.exitCode).toBeNull();
  });
});
