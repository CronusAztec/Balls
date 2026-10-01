import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { MODE_IDS, isModeId } from "@/lib/physics/types";
import { MODE_CARD_ORDER } from "@/lib/modes";
import sitemap from "@/app/sitemap";
import manifest from "@/app/manifest";
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
    expect(m.description).toContain(`${COUNT} unique modes`);
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

  it("stamps the deployed commit's date, never the build time", () => {
    vi.stubEnv("SITEMAP_LASTMOD", "");
    expect(sitemap().every((e) => e.lastModified === undefined)).toBe(true);
    vi.stubEnv("SITEMAP_LASTMOD", "2026-09-30T12:34:56+02:00");
    expect(sitemap().every((e) => e.lastModified === "2026-09-30T12:34:56+02:00")).toBe(true);
    vi.stubEnv("SITEMAP_LASTMOD", "not a date");
    expect(sitemap().every((e) => e.lastModified === undefined)).toBe(true);
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
    expect(fs.readFileSync(path.join(ROOT, "src/app/(static)/page.tsx"), "utf8")).toContain("export const metadata: Metadata = { title: SITE_NAME };");
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
