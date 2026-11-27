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
import { MESSAGE_VALUES, META_DESCRIPTION_MAX, MODE_CARD_WORDS, MODE_FIRST_SETTINGS, MODE_INTROS, MODE_PAGE_INTROS, MODE_PAGES_PATH, modeMetaDescription, modeOfSlug, modeOgImagePath, modeOgImagePathIn, modePageLooks, modePageModes, modePagePath, modeSlug, relatedModes, starterSettings } from "@/lib/modePages";
import { createTranslator } from "next-intl";
import { DAILY_EPOCH, DAILY_POOL, addDays, dailyChallenge, dailySettings, type DailyChallenge } from "@/lib/daily"; // --- pace-as-look --- (round two A3b) the Challenge look
import { defaultSettings, settingsFromSearchParams } from "@/lib/settings";
import { lookPatch, lookRow, startSettings } from "@/lib/studioLooks";
import type { ModeId } from "@/lib/physics/types";
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

  // --- pace-as-look --- (round two A3b) The Challenge look is the daily deal's look: the mode page's link and the studio's chip
  // open the run a day of that mode plays (its seed aside), on the link base like every daily deal. Race, runner and paddle keep
  // 1.17.0's deals, so every past day replays as it was played; their start look's pace is not the deal's (lead decision 2).
  it("opens the Challenge look on the daily deal's run, and race, runner and paddle on 1.17.0's deals", () => {
    const deals = new Map<ModeId, DailyChallenge>();
    for (let day = 0; deals.size < DAILY_POOL.length && day < 1000; day++) {
      const challenge = dailyChallenge(addDays(DAILY_EPOCH, day));
      if (!deals.has(challenge.mode)) deals.set(challenge.mode, challenge);
    }
    expect(deals.size).toBe(DAILY_POOL.length);
    for (const mode of modePageModes()) {
      const look = modePageLooks(mode).find((candidate) => candidate.kind === "daily");
      const deal = deals.get(mode);
      expect([mode, !!look]).toEqual([mode, !!deal]);
      if (!look || !deal) continue;
      const url = new URL(look.href, "https://example.com/en/");
      expect([mode, url.searchParams.has("seed")]).toEqual([mode, false]);
      const run = dailySettings(deal);
      expect(settingsFromSearchParams(url.searchParams), mode).toEqual(run);
      // the studio's Looks row: the chip of that look (or of an earlier look it comes out like) put on a page in the start look
      const row = lookRow(mode);
      const chip = row.looks.find((candidate) => row.keys.every((key) => JSON.stringify(candidate.settings[key]) === JSON.stringify(run[key])));
      expect([mode, !!chip]).toEqual([mode, true]);
      if (chip) expect({ ...startSettings(mode), ...lookPatch(row, chip, startSettings(mode)) }, mode).toEqual(run);
    }
    // 1.17.0's deals, as 1.17.0 wrote the day's query: their run fields on the link base, 1.17.0's (8 screens; 24 obstacles at
    // 0.6; no goal), not the start look's pace (6 screens; 18 at 0.85; 20 catches)
    const DEALS_1_17_0 = {
      race: { query: "mode=race&glow=1", run: { rcTrackLength: 8 } },
      runner: { query: "mode=runner&glow=1&face=cute", run: { runnerObstacles: 24, runnerDensity: 0.6 } },
      paddle: { query: "mode=paddle&glow=1&pdsp=1", run: { pdGoal: 0 } },
    } as const;
    for (const [mode, { query, run }] of Object.entries(DEALS_1_17_0) as [ModeId, (typeof DEALS_1_17_0)[keyof typeof DEALS_1_17_0]][]) {
      const deal = deals.get(mode);
      expect([mode, deal?.query]).toEqual([mode, query]);
      if (!deal) continue;
      expect(dailySettings(deal), mode).toMatchObject(run);
      expect(defaultSettings(mode), mode).toMatchObject(run);
      expect(startSettings(mode), mode).not.toMatchObject(run);
    }
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

  // (E3 review) the page formats each message with the values the studio gives it: no "{max}" left in any language
  it("formats every intro, setting name and tip it shows in every language, with no argument left unfilled", () => {
    for (const locale of LOCALES) {
      const errors: string[] = [];
      const shown: [string, string][] = [];
      for (const full of [...Object.values(MODE_INTROS), ...Object.values(MODE_FIRST_SETTINGS).flatMap((keys) => keys!.flatMap((key) => [key, `${key}Tip`]))] as string[]) {
        const [namespace, key] = full.split(".");
        const t = createTranslator({ locale, messages: CATALOGS[locale] as never, namespace: namespace as never, onError: (e) => errors.push(`${full}: ${e.code}`) });
        shown.push([full, t(key as never, MESSAGE_VALUES[full] as never) as string]);
      }
      for (const mode of MODE_PAGE_INTROS) {
        const t = createTranslator({ locale, messages: CATALOGS[locale] as never, namespace: "ModePage" as never, onError: (e) => errors.push(`ModePage.intro.${mode}: ${e.code}`) });
        shown.push([`ModePage.intro.${mode}`, t(`intro.${mode}` as never) as string]);
      }
      expect(errors, locale).toEqual([]);
      for (const [full, text] of shown) expect(text, `${locale} ${full}`).not.toMatch(/\{\w+\}|ModePage\.|Controls\./);
    }
    expect(MESSAGE_VALUES["Controls.dpSegmentsTip"]?.max).toBe(64);
  });

  // (E3 review) every page says how its mode plays: the studio block's intro, or the page's own within a section intro's budget
  it("says how every mode plays, in the block's intro or the page's own, within a section intro's budget", () => {
    for (const mode of modePageModes()) expect(!!MODE_INTROS[mode] !== MODE_PAGE_INTROS.includes(mode), mode).toBe(true);
    for (const mode of MODE_PAGE_INTROS) {
      for (const locale of LOCALES) {
        const text = (CATALOGS[locale].ModePage.intro as Record<string, string>)[mode];
        expect(typeof text, `${locale} ${mode}`).toBe("string");
        expect([...text].length, `${locale} ${mode}`).toBeLessThanOrEqual(locale === "en" ? 220 : 280);
        expect(text.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length, `${locale} ${mode}`).toBeLessThanOrEqual(3);
      }
    }
    expect(Object.keys(CATALOGS.en.ModePage.intro as object).sort()).toEqual([...MODE_PAGE_INTROS].sort());
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
        // (E3 review) a picture with words has its own card in Polish and Spanish
        expect(image.url, label).toBe(`${SITE_URL}${locale !== "en" && MODE_CARD_WORDS.includes(mode) ? `/og/modes/${locale}/${modeSlug(mode)}.jpg` : modeOgImagePath(mode)}`);
        expect(image.url, label).toBe(`${SITE_URL}${modeOgImagePathIn(mode, locale)}`);
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
      // (E3 review: and the Polish and Spanish card of a mode whose picture carries words)
      for (const card of new Set(LOCALES.map((locale) => modeOgImagePathIn(mode, locale)))) {
        const file = path.join(ROOT, "public", card);
        expect(fs.existsSync(file), `${file} – run npm run og:cards -- --modes`).toBe(true);
        const jpeg = jpegSize(file);
        expect([jpeg.width, jpeg.height], file).toEqual([1200, 630]);
        expect(jpeg.bytes, file).toBeLessThanOrEqual(150 * 1024);
      }
    }
    // (E3 review) beside the cards, one folder per language other than English, each with exactly the cards of the modes with words
    expect(fs.readdirSync(dir).sort()).toEqual([...modePageModes().map((mode) => `${modeSlug(mode)}.jpg`), "es", "pl"].sort());
    for (const locale of ["es", "pl"]) expect(fs.readdirSync(path.join(dir, locale)).sort(), locale).toEqual(MODE_CARD_WORDS.map((mode) => `${modeSlug(mode)}.jpg`).sort());
    expect(MODE_CARD_WORDS.every((mode) => modePageModes().includes(mode))).toBe(true);
  });
});
