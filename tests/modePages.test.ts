import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import sitemap from "@/app/sitemap";
import { MODE_IDS } from "@/lib/physics/types";
import { SITE_URL, pageUrl } from "@/lib/site";
import { modesOnShelf, shelfOf } from "@/lib/siteDesign";
import { GALLERY } from "@/content/gallery";
import { MODE_BLOCK_KEYS } from "@/components/simulator/panelKeys";
import { RING_ESCAPE_KEYS } from "@/components/simulator/sections/RingEscapeSection";
import { META_DESCRIPTION_MAX, MODE_FIRST_SETTINGS, MODE_INTROS, MODE_PAGES_PATH, modeMetaDescription, modeOfSlug, modeOgImagePath, modePageLooks, modePageModes, modePagePath, modeSlug, relatedModes, starterSettings } from "@/lib/modePages";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- mode-pages --- (Lane E, E3) The page of every mode (src/app/[locale]/modes/[mode]/page.tsx, lib/modePages.ts): an address
 * for every mode of the wall, a head of its own in every language (title, snippet, canonical, hreflang, its own social card),
 * the sitemap, and copy that exists: the intros, the settings' names and tips, the looks.
 */

const ROOT = path.resolve(__dirname, "..");
const LOCALES = routing.locales as readonly string[];
const CATALOGS: Record<string, Record<string, Record<string, unknown>>> = { en, pl, es } as never;

vi.mock("next-intl/server", async () => {
  const { createTranslator: create } = await import("next-intl");
  const catalogs: Record<string, unknown> = { en: (await import("../messages/en.json")).default, pl: (await import("../messages/pl.json")).default, es: (await import("../messages/es.json")).default };
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) => create({ locale, messages: catalogs[locale] as never, namespace: namespace as never }),
    getMessages: async () => catalogs.en,
    setRequestLocale: () => {},
  };
});
vi.mock("@/app/fonts", () => ({ fontVariables: "" }));
vi.mock("@/i18n/navigation", () => ({ Link: () => null, redirect: () => {}, usePathname: () => "/", useRouter: () => ({}), getPathname: () => "/" }));

type Head = (args: { params: Promise<{ locale: string; mode: string }> }) => Promise<Metadata>;
let head: Head;
let staticParams: () => { mode: string }[];
beforeAll(async () => {
  const mod = (await import("@/app/[locale]/modes/[mode]/page")) as unknown as { generateMetadata: Head; generateStaticParams: () => { mode: string }[] };
  head = mod.generateMetadata;
  staticParams = mod.generateStaticParams;
}, 180_000);

/** A JPEG's size from its first start-of-frame marker (SOF0 to SOF15, but not DHT, JPG or DAC). */
function jpegSize(file: string): { width: number; height: number; bytes: number } {
  const b = fs.readFileSync(file);
  expect(b.readUInt16BE(0), `${file} is not a JPEG`).toBe(0xffd8);
  let at = 2;
  while (at < b.length) {
    const marker = b.readUInt16BE(at);
    const size = b.readUInt16BE(at + 2);
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) return { height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7), bytes: b.length };
    at += 2 + size;
  }
  throw new Error(`${file}: no frame header`);
}

describe("mode pages: the addresses", () => {
  it("give every mode of the wall a page, at a kebab-case word that leads back to it", () => {
    expect(modePageModes()).toEqual(modesOnShelf("all"));
    expect(modePageModes().length).toBeGreaterThanOrEqual(50);
    for (const mode of modePageModes()) {
      expect(MODE_IDS).toContain(mode);
      expect(modeSlug(mode), mode).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(modeOfSlug(modeSlug(mode)), mode).toBe(mode);
      expect(modePagePath(mode)).toBe(`${MODE_PAGES_PATH}/${modeSlug(mode)}`);
    }
    expect(new Set(modePageModes().map(modeSlug)).size).toBe(modePageModes().length);
    expect(modeSlug("doublePendulum")).toBe("double-pendulum");
    expect(modeOfSlug("doublePendulum")).toBeNull();
    expect(modeOfSlug("nope")).toBeNull();
    expect(staticParams()).toEqual(modePageModes().map((mode) => ({ mode: modeSlug(mode) })));
  });

  it("are in the sitemap in every language, each with the whole hreflang set", () => {
    const entries = sitemap();
    for (const mode of modePageModes()) {
      for (const locale of LOCALES) {
        const entry = entries.find((e) => e.url === pageUrl(locale, modePagePath(mode)));
        expect(entry, `${locale} ${mode}`).toBeTruthy();
        expect(entry?.alternates?.languages, `${locale} ${mode}`).toEqual({ ...Object.fromEntries(LOCALES.map((l) => [l, pageUrl(l, modePagePath(mode))])), "x-default": pageUrl("en", modePagePath(mode)) });
      }
    }
  });
});

describe("mode pages: what each shows", () => {
  it("links four related modes, its own shelf's first, never itself", () => {
    for (const mode of modePageModes()) {
      const related = relatedModes(mode);
      expect(related, mode).toHaveLength(4);
      expect(new Set(related).size, mode).toBe(4);
      expect(related, mode).not.toContain(mode);
      const mates = modesOnShelf(shelfOf(mode)).filter((m) => m !== mode);
      expect(related.slice(0, Math.min(4, mates.length)).every((m) => shelfOf(m) === shelfOf(mode)), mode).toBe(true);
    }
  });

  it("offers every look of the studio's Looks row, each opening the studio on the mode, the gallery's with their seed", () => {
    for (const mode of modePageModes()) {
      const looks = modePageLooks(mode);
      expect(looks.some((look) => look.preset), `${mode} has no gallery preset`).toBe(true);
      for (const look of looks) {
        const url = new URL(look.href, "https://example.com/en/");
        expect(url.pathname, `${mode} ${look.id}`).toBe("/simulator");
        expect(url.searchParams.get("mode"), `${mode} ${look.id}`).toBe(mode);
        if (look.preset) expect(url.searchParams.get("seed"), `${mode} ${look.id}`).toBe(new URLSearchParams(look.preset.query).get("seed"));
      }
    }
    expect(GALLERY.every((preset) => modePageLooks(preset.mode).some((look) => look.id === preset.id))).toBe(true);
  });

  it("reads intros, settings and their tips that exist in every language, from the mode's own block", () => {
    const has = (locale: string, full: string) => {
      const [ns, key] = full.split(".");
      return typeof CATALOGS[locale][ns]?.[key] === "string";
    };
    for (const [mode, intro] of Object.entries(MODE_INTROS)) for (const locale of LOCALES) expect(has(locale, intro!), `${locale} ${mode} ${intro}`).toBe(true);
    for (const [mode, keys] of Object.entries(MODE_FIRST_SETTINGS)) {
      expect(keys!.length, mode).toBeGreaterThan(0);
      expect(keys!.length, mode).toBeLessThanOrEqual(3);
      for (const key of keys!) {
        // (Classic's block is the Ring Escape section's, which panelKeys.ts offers in Classic alone)
        expect([...(MODE_BLOCK_KEYS[mode as keyof typeof MODE_BLOCK_KEYS] ?? []), ...(mode === "classic" ? RING_ESCAPE_KEYS : [])], `${mode} ${key}`).toContain(key.split(".")[1]);
        for (const locale of LOCALES) {
          expect(has(locale, key), `${locale} ${mode} ${key}`).toBe(true);
          expect(has(locale, `${key}Tip`), `${locale} ${mode} ${key}Tip`).toBe(true);
        }
      }
    }
    // every page says how the mode plays or what to change first (Portal has no block of its own in the studio: its page has
    // neither), forty say how it plays, and every page lists the basics
    expect(Object.keys(MODE_INTROS).length).toBeGreaterThanOrEqual(40);
    for (const mode of modePageModes()) {
      if (mode !== "portal") expect(!!MODE_INTROS[mode] || !!MODE_FIRST_SETTINGS[mode], mode).toBe(true);
      for (const key of starterSettings(mode)) for (const locale of LOCALES) expect(has(locale, `Controls.${key}`), `${locale} ${key}`).toBe(true);
    }
    expect(starterSettings("colourSort")).not.toContain("ballColor");
  });

  it("writes a snippet from the one-liner and the longest closing line that fits", () => {
    expect(modeMetaDescription("a".repeat(100), ["b".repeat(50), "c".repeat(20)])).toBe(`${"a".repeat(100)} ${"b".repeat(50)}`);
    expect(modeMetaDescription("a".repeat(130), ["b".repeat(50), "c".repeat(20)])).toBe(`${"a".repeat(130)} ${"c".repeat(20)}`);
    expect(modeMetaDescription("a".repeat(150), ["b".repeat(50), "c".repeat(20)])).toBe("a".repeat(150));
    expect([...modeMetaDescription("a".repeat(100), ["b".repeat(59)])].length).toBe(META_DESCRIPTION_MAX);
  });
});

describe("mode pages: the head", () => {
  it("names its own address, the hreflang set, a title and a snippet that fit a search result, and its own social card", async () => {
    for (const locale of LOCALES) {
      const titles = new Set<string>();
      const descriptions = new Set<string>();
      for (const mode of modePageModes()) {
        const md = await head({ params: Promise.resolve({ locale, mode: modeSlug(mode) }) });
        const label = `${locale} ${mode}`;
        const url = pageUrl(locale, modePagePath(mode));
        expect(md.alternates?.canonical, label).toBe(url);
        expect(md.openGraph?.url, label).toBe(url);
        const languages = md.alternates?.languages as Record<string, string>;
        expect(Object.keys(languages).sort(), label).toEqual(["en", "es", "pl", "x-default"]);
        const title = md.title as string;
        const description = md.description as string;
        expect([...title].length, `${label}: ${title}`).toBeLessThanOrEqual(60);
        expect([...description].length, `${label}: ${description}`).toBeGreaterThanOrEqual(70);
        expect([...description].length, `${label}: ${description}`).toBeLessThanOrEqual(160);
        expect(title, label).toContain((CATALOGS[locale].Modes[mode] as { name: string }).name);
        expect(description.startsWith((CATALOGS[locale].Modes[mode] as { description: string }).description), label).toBe(true);
        expect(`${title}${description}`, label).not.toMatch(/[{}]/);
        expect(titles.has(title), `${label}: the title "${title}" again`).toBe(false);
        expect(descriptions.has(description), `${label}: its snippet again`).toBe(false);
        titles.add(title);
        descriptions.add(description);
        const og = md.openGraph as unknown as { images: { url: string; width: number; height: number; alt: string; type: string }[] };
        const image = og.images[0];
        expect(image.url, label).toBe(`${SITE_URL}${modeOgImagePath(mode)}`);
        expect([image.width, image.height, image.type], label).toEqual([1200, 630, "image/jpeg"]);
        expect(image.alt, label).toContain((CATALOGS[locale].Modes[mode] as { name: string }).name);
        const twitter = md.twitter as { card: string; images: { url: string; alt: string }[] };
        expect(twitter.card, label).toBe("summary_large_image");
        expect(twitter.images, label).toEqual([{ url: image.url, alt: image.alt }]);
      }
    }
  });

  it("has a social card for every mode page: public/og/modes/<slug>.jpg, 1200x630, at most 150 KB, and no other file there", () => {
    const dir = path.join(ROOT, "public", "og", "modes");
    for (const mode of modePageModes()) {
      const file = path.join(ROOT, "public", modeOgImagePath(mode));
      expect(fs.existsSync(file), `${file} – run npm run og:cards -- --modes`).toBe(true);
      const jpeg = jpegSize(file);
      expect([jpeg.width, jpeg.height], file).toEqual([1200, 630]);
      expect(jpeg.bytes, file).toBeLessThanOrEqual(150 * 1024);
    }
    expect(fs.readdirSync(dir).sort()).toEqual(modePageModes().map((mode) => `${modeSlug(mode)}.jpg`).sort());
  });
});
