import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { CHANGELOG, latestRelease } from "@/content/changelog";
import { LEGAL_LAST_UPDATED } from "@/lib/legalDates";
import { routing } from "@/i18n/routing";
import sitemap from "@/app/sitemap";
import { DESKTOP_VERSION } from "@/lib/desktop/release";
import { SITE_NAME, SITE_URL, pageUrl } from "@/lib/site";
import {
  DEFAULT_OG_PATH,
  OG_CARD_PAGES,
  OG_CARD_PATHS,
  OG_LOCALES,
  OG_SIZE,
  breadcrumbListJsonLd,
  cardPageForPath,
  itemListJsonLd,
  ogImage,
  organizationJsonLd,
  pageMetadata,
  productJsonLd,
  softwareApplicationJsonLd,
  webApplicationJsonLd,
  webSiteJsonLd,
} from "@/lib/seo";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * --- seo --- What search engines and link previews read. Every page's generateMetadata is called (the real ones, with the catalogs
 * behind next-intl's server half and the i18n navigation stubbed, as outside Next they cannot load): the head of each page x language
 * names its own address and its own card, the card exists and is a 1200x630 PNG, the title and description fit a search result,
 * and no two pages share a title. Then the social cards and their copy, the sitemap's dates, the icons and the JSON-LD builders.
 */

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const CATALOGS = { en, pl, es } as Record<string, unknown>;
const LOCALES = routing.locales as readonly string[];

vi.mock("next-intl/server", async () => {
  const { createTranslator: create } = await import("next-intl");
  const catalogs: Record<string, unknown> = { en: (await import("../messages/en.json")).default, pl: (await import("../messages/pl.json")).default, es: (await import("../messages/es.json")).default };
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) => create({ locale, messages: catalogs[locale] as never, namespace: namespace as never }),
    getMessages: async () => catalogs.en,
    setRequestLocale: () => {},
  };
});
vi.mock("@/app/fonts", () => ({ fontVariables: "" })); // next/font/local only works inside Next's compiler
vi.mock("@/i18n/navigation", () => ({ Link: () => null, redirect: () => {}, usePathname: () => "/", useRouter: () => ({}), getPathname: () => "/" })); // next-intl's ESM navigation cannot load next/navigation outside Next

type Head = (args: { params: Promise<{ locale: string }> }) => Promise<Metadata>;
/** The Open Graph object as pageMetadata builds it (Next's own type is a union of the object types). */
interface OpenGraphHead {
  type: string;
  siteName: string;
  locale: string;
  alternateLocale: string[];
  title: string;
  description: string;
  images: { url: string; width: number; height: number; alt: string; type: string }[];
}
interface Page {
  name: string;
  /** The route without the language: "" for the home page. */
  path: string;
  head: Head;
}

const PAGES_DIR = path.join(ROOT, "src", "app", "[locale]");
/** Every directory of src/app/[locale] that holds a page (a new page is covered the day it is added), and the home page, whose head is the layout's. */
const PAGE_NAMES = fs
  .readdirSync(PAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(PAGES_DIR, d.name, "page.tsx")))
  .map((d) => d.name)
  .sort();

const pages: Page[] = [];
beforeAll(async () => {
  const layout = (await import("@/app/[locale]/layout")) as unknown as { generateMetadata: Head };
  pages.push({ name: "home", path: "", head: layout.generateMetadata });
  for (const name of PAGE_NAMES) {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(PAGES_DIR, name, "page.tsx")).href)) as { generateMetadata?: Head };
    if (mod.generateMetadata) pages.push({ name, path: `/${name}`, head: mod.generateMetadata });
    else pages.push({ name, path: `/${name}`, head: async () => ({}) });
  }
}, 180_000);

const heads = new Map<string, Metadata>();
async function headOf(page: Page, locale: string): Promise<Metadata> {
  const key = `${locale}${page.path}`;
  let md = heads.get(key);
  if (!md) {
    md = await page.head({ params: Promise.resolve({ locale }) });
    heads.set(key, md);
  }
  return md;
}

const length = (text: string) => [...text].length;
/** The pages that are not for search results: they carry robots noindex (and are not in the sitemap). */
const NOINDEX = ["account", "feedback"];

interface PngInfo {
  width: number;
  height: number;
  bytes: number;
}
/** Reads a PNG's size from its header: the signature, then the IHDR chunk with width and height as big-endian 32-bit numbers at bytes 16 and 20. */
function pngInfo(file: string): PngInfo {
  const bytes = fs.readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex"), `${file} is not a PNG`).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
}
const publicFile = (url: string) => path.join(PUBLIC, decodeURIComponent(new URL(url).pathname));

describe("every page's head", () => {
  it("covers the pages the site has", () => {
    expect(PAGE_NAMES).toEqual(expect.arrayContaining(["about", "account", "changelog", "disclaimer", "download", "feedback", "gallery", "pricing", "privacy", "simulator", "terms", "tiktok-ball-videos"]));
    expect(pages.map((p) => p.name)).toContain("home");
    for (const page of pages) expect(typeof page.head, page.name).toBe("function");
    // a page without generateMetadata would show the home page's address and title
    for (const name of PAGE_NAMES) expect(fs.readFileSync(path.join(PAGES_DIR, name, "page.tsx"), "utf8"), `${name} has no generateMetadata`).toContain("export async function generateMetadata");
  });

  it("names its own address as the canonical one and as og:url, with the whole hreflang set", async () => {
    for (const page of pages) {
      for (const locale of LOCALES) {
        const md = await headOf(page, locale);
        const canonical = pageUrl(locale, page.path);
        const label = `${locale} ${page.name}`;
        expect(md.alternates?.canonical, label).toBe(canonical);
        expect(md.openGraph?.url, label).toBe(canonical);
        const languages = md.alternates?.languages as Record<string, string>;
        expect(Object.keys(languages).sort(), label).toEqual(["en", "es", "pl", "x-default"]);
        for (const l of LOCALES) expect(languages[l], label).toBe(pageUrl(l, page.path));
        expect(languages["x-default"], label).toBe(pageUrl("en", page.path));
      }
    }
  });

  it("has a complete Open Graph card with an absolute picture that exists as a 1200x630 PNG", async () => {
    for (const page of pages) {
      for (const locale of LOCALES) {
        const md = await headOf(page, locale);
        const label = `${locale} ${page.name}`;
        const og = md.openGraph as unknown as OpenGraphHead;
        expect(og.type, label).toBe("website");
        expect(og.siteName, label).toBe(SITE_NAME);
        expect(og.locale, label).toBe(OG_LOCALES[locale]);
        expect([...(og.alternateLocale ?? [])].sort(), label).toEqual(Object.values(OG_LOCALES).filter((l) => l !== OG_LOCALES[locale]).sort());
        expect(String(og.title).length, label).toBeGreaterThan(5);
        expect(String(og.description).length, label).toBeGreaterThan(20);
        expect(og.images, label).toHaveLength(1);
        const image = og.images[0];
        expect(image.url, label).toMatch(/^https?:\/\//);
        expect([image.width, image.height], label).toEqual([OG_SIZE.width, OG_SIZE.height]);
        expect(image.type, label).toBe("image/png");
        expect(image.alt.length, label).toBeGreaterThan(15);
        const file = publicFile(image.url);
        expect(fs.existsSync(file), `${label}: ${image.url} is not in public/`).toBe(true);
        const png = pngInfo(file);
        expect([png.width, png.height], `${label}: ${image.url}`).toEqual([1200, 630]);
      }
    }
  });

  it("has the Twitter card with the same picture, its alt text and no other page's title", async () => {
    for (const page of pages) {
      for (const locale of LOCALES) {
        const md = await headOf(page, locale);
        const label = `${locale} ${page.name}`;
        const twitter = md.twitter as { card: string; title: string; description: string; images: { url: string; alt: string }[] };
        const og = md.openGraph as { title: string; description: string; images: { url: string; alt: string }[] };
        expect(twitter.card, label).toBe("summary_large_image");
        expect(twitter.title, label).toBe(og.title);
        expect(twitter.description, label).toBe(og.description);
        expect(twitter.images, label).toEqual([{ url: og.images[0].url, alt: og.images[0].alt }]);
      }
    }
  });

  it("shows the page's own card where it has one, the default screenshot where not", async () => {
    for (const page of pages) {
      for (const locale of LOCALES) {
        const md = await headOf(page, locale);
        const own = cardPageForPath(page.path);
        const url = (md.openGraph as { images: { url: string }[] }).images[0].url;
        expect(url, `${locale} ${page.name}`).toBe(`${SITE_URL}${own ? `/og/${locale}/${own}.png` : DEFAULT_OG_PATH}`);
      }
    }
    // every card page is a page of the site (the press page may be missing from a checkout that lacks it)
    for (const card of OG_CARD_PAGES) if (card !== "press" && card !== "home") expect(PAGE_NAMES, card).toContain(card);
  });

  it("fits a search result: a title of at most 60 characters and a description of 70 to 160, as rendered", async () => {
    for (const page of pages) {
      for (const locale of LOCALES) {
        const md = await headOf(page, locale);
        const label = `${locale} ${page.name}`;
        expect(typeof md.title, label).toBe("string");
        expect(length(md.title as string), `${label}: ${md.title}`).toBeLessThanOrEqual(60);
        expect(length(md.title as string), label).toBeGreaterThanOrEqual(10);
        expect(length(md.description as string), `${label}: ${md.description}`).toBeGreaterThanOrEqual(70);
        expect(length(md.description as string), `${label}: ${md.description}`).toBeLessThanOrEqual(160);
        expect(md.title as string, label).not.toMatch(/[{}]/);
        expect(md.description as string, label).not.toMatch(/[{}]/);
      }
    }
  });

  it("gives no two pages the same title or description in a language", async () => {
    for (const locale of LOCALES) {
      const titles = new Map<string, string>();
      const descriptions = new Map<string, string>();
      for (const page of pages) {
        const md = await headOf(page, locale);
        expect(titles.get(md.title as string), `${locale}: ${page.name} and ${titles.get(md.title as string)} share the title "${md.title}"`).toBeUndefined();
        expect(descriptions.get(md.description as string), `${locale}: ${page.name} and ${descriptions.get(md.description as string)} share a description`).toBeUndefined();
        titles.set(md.title as string, page.name);
        descriptions.set(md.description as string, page.name);
      }
    }
  });

  it("keeps the feedback form and the account page out of search results, and nothing else", async () => {
    for (const page of pages) {
      const md = await headOf(page, "en");
      const robots = md.robots as { index?: boolean } | undefined;
      if (NOINDEX.includes(page.name)) expect(robots?.index, page.name).toBe(false);
      else expect(robots?.index, page.name).not.toBe(false);
    }
  });

  it("leaves no placeholder unfilled anywhere in a head", async () => {
    // a title that still holds {siteName} or {count} was not filled in
    for (const page of pages) for (const locale of LOCALES) expect(JSON.stringify(await headOf(page, locale)), `${locale} ${page.name}`).not.toMatch(/\{(siteName|count|siteDomain|monthly|yearly)/);
  });

  it("sets the layout's icons (the .ico, the SVG, 48 and 192 pixels) with their type and sizes", async () => {
    const md = await headOf(pages.find((p) => p.name === "home")!, "en");
    const icons = (md.icons as { icon: { url: string; type: string; sizes: string }[] }).icon;
    expect(icons.map((i) => new URL(i.url).pathname)).toEqual(["/favicon.ico", "/icon.svg", "/icons/icon-48.png", "/icons/icon-192.png"]);
    for (const icon of icons) {
      expect(icon.type).toMatch(/^image\//);
      expect(icon.sizes).toBeTruthy();
      expect(fs.existsSync(publicFile(icon.url)), icon.url).toBe(true);
    }
  });
});

describe("pageMetadata", () => {
  it("takes the card from the path, a card page's key or a ready picture, and falls back to the default card", async () => {
    const base = { locale: "pl", description: "d".repeat(80) };
    const card = async (extra: object) => ((await pageMetadata({ ...base, title: "T", path: "/gallery", ...extra })).openGraph as { images: { url: string; alt: string }[] }).images[0];
    expect((await card({})).url).toBe(`${SITE_URL}/og/pl/gallery.png`);
    expect((await card({ image: "pricing" })).url).toBe(`${SITE_URL}/og/pl/pricing.png`);
    expect((await card({ path: "/privacy" })).url).toBe(`${SITE_URL}/og.png`);
    expect((await card({ path: "/does-not-exist" })).url).toBe(`${SITE_URL}/og.png`);
    expect((await card({ fallbackImageUrl: "https://example.org/x.png", path: "/privacy" })).url).toBe("https://example.org/x.png");
    const ready = { url: "https://example.org/own.png", width: 1200, height: 630, alt: "An own picture", type: "image/png" as const };
    expect((await card({ image: ready }))).toEqual(ready);
    // the alt text of a drawn card is what the card says
    expect((await card({})).alt).toContain(pl.Seo.card.gallery.title);
    expect((await card({})).alt).toContain(pl.Seo.card.gallery.sub);
    // a headline without a full stop of its own gets one, so the alt text reads as sentences
    expect((await card({ image: "pricing" })).alt).toContain(`${pl.Seo.card.pricing.title}. ${pl.Seo.card.pricing.sub}`);
  });

  it("lets a page give a shorter social title and line, and marks noindex", async () => {
    const md = await pageMetadata({ locale: "en", path: "/about", title: "Long search title", description: "x".repeat(100), social: { title: "Short", description: "Short line" }, noindex: true });
    expect(md.title).toBe("Long search title");
    expect(md.openGraph?.title).toBe("Short");
    expect(md.twitter?.title).toBe("Short");
    expect(md.twitter?.description).toBe("Short line");
    expect(md.robots).toEqual({ index: false });
  });

  it("ogImage names the card of a page and language, 1200x630, else the default", () => {
    expect(ogImage("es", "download", "alt")).toEqual({ url: `${SITE_URL}/og/es/download.png`, width: 1200, height: 630, alt: "alt", type: "image/png" });
    expect(ogImage("es", "privacy", "alt").url).toBe(`${SITE_URL}/og.png`);
    expect(ogImage("fr", "home", "alt").url).toBe(`${SITE_URL}/og.png`);
    expect(ogImage("en", undefined, "alt").url).toBe(`${SITE_URL}/og.png`);
  });
});

describe("social cards", () => {
  it("are drawn for the pages scripts/generate-og-cards.mjs lists, in the languages of the site", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "generate-og-cards.mjs"), "utf8");
    const listed = (name: string) => [...(new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(script)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(listed("PAGES")).toEqual([...OG_CARD_PAGES]);
    expect(listed("LOCALES")).toEqual([...LOCALES]);
    expect(Object.keys(OG_CARD_PATHS)).toEqual([...OG_CARD_PAGES]);
    expect(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts["og:cards"]).toBe("node scripts/generate-og-cards.mjs");
  });

  it("exist as public/og/<locale>/<page>.png: 27 files, 1200x630, each at most 150 KB", () => {
    let count = 0;
    for (const locale of LOCALES) {
      for (const card of OG_CARD_PAGES) {
        const file = path.join(PUBLIC, "og", locale, `${card}.png`);
        expect(fs.existsSync(file), file).toBe(true);
        const png = pngInfo(file);
        expect([png.width, png.height], file).toEqual([1200, 630]);
        expect(png.bytes, file).toBeLessThanOrEqual(150 * 1024);
        count++;
      }
      expect(fs.readdirSync(path.join(PUBLIC, "og", locale)).sort(), locale).toEqual(OG_CARD_PAGES.map((c) => `${c}.png`).sort());
    }
    expect(count).toBe(27);
    expect(fs.readdirSync(path.join(PUBLIC, "og")).sort()).toEqual([...LOCALES].sort());
  });

  it("keep the default screenshot, public/og.png, as the card of the pages without one", () => {
    const png = pngInfo(path.join(PUBLIC, "og.png"));
    expect([png.width, png.height]).toEqual([1200, 630]);
  });

  it("have a headline of at most 42 characters and a line of at most 80 in every language, written for each language", () => {
    for (const locale of LOCALES) {
      const t = createTranslator({ locale, messages: CATALOGS[locale] as never, namespace: "Seo.card" as never }) as unknown as (key: string, values?: Record<string, string>) => string;
      for (const card of OG_CARD_PAGES) {
        const title = t(`${card}.title`, { siteName: SITE_NAME });
        const sub = t(`${card}.sub`, { siteName: SITE_NAME });
        expect(length(title), `${locale} ${card}: ${title}`).toBeLessThanOrEqual(42);
        expect(length(title), `${locale} ${card}`).toBeGreaterThanOrEqual(8);
        expect(length(sub), `${locale} ${card}: ${sub}`).toBeLessThanOrEqual(80);
        expect(length(sub), `${locale} ${card}`).toBeGreaterThanOrEqual(20);
        // a picture cannot take the number of modes or a version: they would go stale
        expect(`${title} ${sub}`, `${locale} ${card}`).not.toMatch(/\{count|\d+\s*(modes|modos|tryb)|v?\d+\.\d+\.\d+/i);
        if (locale !== "en") {
          const english = createTranslator({ locale: "en", messages: en as never, namespace: "Seo.card" as never }) as unknown as (key: string, values?: Record<string, string>) => string;
          expect(title, `${locale} ${card}`).not.toBe(english(`${card}.title`, { siteName: SITE_NAME }));
        }
      }
    }
  });
});

describe("icons", () => {
  it("has public/favicon.ico with a 32 and a 48 pixel PNG image, and public/icons/icon-48.png", () => {
    const ico = fs.readFileSync(path.join(PUBLIC, "favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 2]); // reserved, icon, two images
    const sizes: number[] = [];
    for (let i = 0; i < 2; i++) {
      const entry = 6 + 16 * i;
      const size = ico[entry];
      const bytes = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(ico[entry + 1]).toBe(size);
      expect(ico.subarray(offset, offset + 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect([ico.readUInt32BE(offset + 16), ico.readUInt32BE(offset + 20)]).toEqual([size, size]);
      expect(offset + bytes).toBeLessThanOrEqual(ico.length);
      sizes.push(size);
    }
    expect(sizes).toEqual([32, 48]);
    const png = pngInfo(path.join(PUBLIC, "icons", "icon-48.png"));
    expect([png.width, png.height]).toEqual([48, 48]);
  });

  it("is written by scripts/generate-icons.mjs", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "generate-icons.mjs"), "utf8");
    expect(script).toContain("favicon.ico");
    expect(script).toContain('"icon-48.png"');
  });
});

describe("sitemap", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lists the changelog and the press page, and every indexable page of the site, in every language, and no page that is not there", async () => {
    const listed = new Set(sitemap().map((e) => e.url));
    for (const locale of LOCALES) expect(listed.has(pageUrl(locale, "/changelog")), `${locale} /changelog`).toBe(true);
    const indexable = pages.filter((p) => !NOINDEX.includes(p.name)).map((p) => p.path);
    const want = new Set(indexable.flatMap((p) => LOCALES.map((l) => pageUrl(l, p))));
    expect([...listed].sort()).toEqual([...want].sort());
    // the press page is in the sitemap exactly when it exists
    for (const locale of LOCALES) expect(listed.has(pageUrl(locale, "/press")), `${locale} /press`).toBe(PAGE_NAMES.includes("press"));
  });

  it("dates the changelog by its newest release, the download page by the newest Windows app release and the legal pages by their update date", () => {
    vi.stubEnv("SITEMAP_LASTMOD", "2026-09-30T12:34:56+02:00");
    const dateOf = (locale: string, p: string) => sitemap().find((e) => e.url === pageUrl(locale, p))?.lastModified;
    const newest = [...CHANGELOG].map((r) => r.date).sort().at(-1);
    for (const locale of LOCALES) {
      expect(dateOf(locale, "/changelog"), locale).toBe(newest);
      expect(dateOf(locale, "/changelog"), locale).toBe(CHANGELOG[0].date);
      expect(dateOf(locale, "/download"), locale).toBe(latestRelease("app")?.date);
      for (const legal of ["/privacy", "/terms", "/disclaimer"]) expect(dateOf(locale, legal), `${locale} ${legal}`).toBe(LEGAL_LAST_UPDATED);
      for (const other of ["", "/simulator", "/gallery", "/pricing", "/about"]) expect(dateOf(locale, other), `${locale} ${other}`).toBe("2026-09-30T12:34:56+02:00");
    }
    expect(latestRelease("app")?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LEGAL_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("leaves out the change frequency and the priority, which Google ignores", () => {
    for (const entry of sitemap()) {
      expect(entry).not.toHaveProperty("changeFrequency");
      expect(entry).not.toHaveProperty("priority");
    }
  });
});

describe("JSON-LD", () => {
  const blocks = (locale: string): Record<string, unknown>[] => [
    organizationJsonLd(),
    webSiteJsonLd(locale),
    webApplicationJsonLd({ locale, description: "The simulator as a web application.", browserRequirements: "A current browser", featureList: ["Modes", "Export"] }),
    softwareApplicationJsonLd({ locale, description: "The Windows app.", downloadUrl: "https://example.org/Setup.exe", version: DESKTOP_VERSION }),
    productJsonLd({ locale, description: "Pro.", offers: [{ name: "Monthly", usd: 6.99, duration: "P1M" }, { name: "Yearly", usd: 49, duration: "P1Y" }] }),
    breadcrumbListJsonLd(locale, "Home", [{ name: "Gallery", path: "/gallery" }]),
    itemListJsonLd({ name: "Presets", items: [{ name: "One", url: "https://example.org/1" }, { name: "Two", url: "https://example.org/2" }] }),
  ];
  const typeOf = (block: Record<string, unknown>) => block["@type"] as string;
  const isUrl = (value: unknown) => typeof value === "string" && /^https?:\/\/\S+$/.test(value);

  it("parses as JSON and has its context, its type and the keys the type needs, in every language", () => {
    const required: Record<string, string[]> = {
      Organization: ["@id", "name", "url", "logo"],
      WebSite: ["name", "url", "inLanguage", "publisher"],
      WebApplication: ["name", "url", "inLanguage", "image", "description", "applicationCategory", "operatingSystem", "offers", "featureList"],
      SoftwareApplication: ["name", "operatingSystem", "applicationCategory", "downloadUrl", "softwareVersion", "releaseNotes", "dateModified", "url", "inLanguage", "image", "offers"],
      Product: ["name", "description", "url", "image", "brand", "offers"],
      BreadcrumbList: ["itemListElement"],
      ItemList: ["name", "itemListElement"],
    };
    for (const locale of LOCALES) {
      const types = new Set<string>();
      for (const block of blocks(locale)) {
        const parsed = JSON.parse(JSON.stringify(block)) as Record<string, unknown>;
        expect(parsed, `${locale} ${typeOf(block)}`).toEqual(block);
        expect(parsed["@context"]).toBe("https://schema.org");
        types.add(typeOf(parsed));
        for (const key of required[typeOf(parsed)]) expect(parsed, `${locale} ${typeOf(parsed)}.${key}`).toHaveProperty(key);
      }
      expect([...types].sort()).toEqual(Object.keys(required).sort());
    }
  });

  it("carries no ratings or reviews, there being no real data for them", () => {
    for (const locale of LOCALES) expect(JSON.stringify(blocks(locale))).not.toMatch(/aggregateRating|"review"|ratingValue/i);
  });

  it("points the site at the language's own entry page, with its language", () => {
    for (const locale of LOCALES) {
      const site = webSiteJsonLd(locale);
      expect(site.url).toBe(pageUrl(locale));
      expect(site.inLanguage).toBe(locale);
      expect(String(site.url)).not.toBe(`${SITE_URL}/`);
      const app = webApplicationJsonLd({ locale, description: "d", browserRequirements: "b", featureList: [] });
      expect(app.url).toBe(pageUrl(locale));
      expect(app.inLanguage).toBe(locale);
      expect(app.image).toBe(`${SITE_URL}/og/${locale}/home.png`);
    }
  });

  it("names the release notes (the changelog) and the date of the newest release on the Windows app", () => {
    for (const locale of LOCALES) {
      const app = softwareApplicationJsonLd({ locale, description: "d", downloadUrl: "https://example.org/Setup.exe", version: DESKTOP_VERSION });
      expect(app.releaseNotes).toBe(pageUrl(locale, "/changelog"));
      expect(app.dateModified).toBe(latestRelease("app")?.date);
      expect(app.softwareVersion).toBe(DESKTOP_VERSION);
      expect(app.url).toBe(pageUrl(locale, "/download"));
    }
  });

  it("lists the trail from the home page, in order, with absolute addresses", () => {
    const crumbs = breadcrumbListJsonLd("pl", "Strona główna", [{ name: "Cennik", path: "/pricing" }]) as { itemListElement: { position: number; name: string; item: string }[] };
    expect(crumbs.itemListElement.map((c) => [c.position, c.name, c.item])).toEqual([
      [1, "Strona główna", pageUrl("pl")],
      [2, "Cennik", pageUrl("pl", "/pricing")],
    ]);
    for (const c of crumbs.itemListElement) expect(isUrl(c.item)).toBe(true);
  });

  it("gives Pro one offer per plan, in stock, in dollars", () => {
    const product = productJsonLd({ locale: "en", description: "d", offers: [{ name: "Monthly", usd: 6.99, duration: "P1M" }, { name: "Yearly", usd: 49, duration: "P1Y" }] }) as { offers: { price: string; priceCurrency: string; availability: string; priceSpecification: { billingDuration: string } }[] };
    expect(product.offers.map((o) => [o.price, o.priceCurrency, o.availability, o.priceSpecification.billingDuration])).toEqual([
      ["6.99", "USD", "https://schema.org/InStock", "P1M"],
      ["49.00", "USD", "https://schema.org/InStock", "P1Y"],
    ]);
  });

  describe("the organisation", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it("names no contact point and no legal name while the operator has set none", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "");
      vi.stubEnv("NEXT_PUBLIC_LEGAL_NAME", "");
      vi.resetModules();
      const org = (await import("@/lib/seo")).organizationJsonLd();
      expect(org).not.toHaveProperty("contactPoint");
      expect(org).not.toHaveProperty("legalName");
      expect(org).not.toHaveProperty("sameAs"); // no profiles exist yet
      expect(org.name).toBe(SITE_NAME);
      expect(isUrl(org.logo)).toBe(true);
      expect(fs.existsSync(publicFile(String(org.logo)))).toBe(true);
    });

    it("names the contact point and the legal name when the operator has set them", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "help@example.org");
      vi.stubEnv("NEXT_PUBLIC_LEGAL_NAME", "Example Studio Ltd");
      vi.resetModules();
      const org = (await import("@/lib/seo")).organizationJsonLd() as { contactPoint: { "@type": string; email: string; contactType: string }; legalName: string };
      expect(org.contactPoint).toMatchObject({ "@type": "ContactPoint", email: "help@example.org", contactType: "customer support" });
      expect(org.legalName).toBe("Example Studio Ltd");
    });
  });

  it("is built by lib/seo.ts: no page writes a schema.org block of its own (the changelog's CollectionPage excepted)", () => {
    for (const name of PAGE_NAMES) {
      const source = fs.readFileSync(path.join(PAGES_DIR, name, "page.tsx"), "utf8");
      const own = [...source.matchAll(/"@type":\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
      expect(own.filter((type) => !["CollectionPage", "WebSite", "ItemList", "ListItem", "Question", "Answer", "FAQPage"].includes(type)), name).toEqual([]);
    }
  });

  it("cannot be closed early by a value: `<` is escaped, so a name with </script> opens no markup", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const React = await import("react");
    (globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)
    const { createElement } = React;
    const { default: JsonLd } = await import("@/components/site/JsonLd");
    const html = renderToStaticMarkup(createElement(JsonLd, { data: { "@context": "https://schema.org", name: "Evil </script><script>alert(1)</script> Ltd" } }));
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain("\\u003c/script>");
    // the escaped text is the same JSON: it parses back to the original value
    const body = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)![1].replace(/&quot;/g, '"');
    expect(JSON.parse(body).name).toBe("Evil </script><script>alert(1)</script> Ltd");
  });
});
