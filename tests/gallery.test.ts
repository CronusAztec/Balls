import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { GALLERY, HOME_GALLERY_IDS, galleryHref, homeGallery } from "@/content/gallery";
import { routing } from "@/i18n/routing";
import { MODE_IDS } from "@/lib/physics/types";
import { shelfOf } from "@/lib/siteDesign"; // --- gallery-every-mode ---
import { parseSeed } from "@/lib/recording/batch";
import { settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/** The query without its seed – what settingsToSearchParams() writes. */
function settingsPart(query: string): URLSearchParams {
  const params = new URLSearchParams(query);
  params.delete("seed");
  return params;
}

describe("preset gallery (src/content/gallery.ts)", () => {
  it("holds at least a dozen presets with unique kebab-case ids", () => {
    expect(GALLERY.length).toBeGreaterThanOrEqual(12);
    const ids = GALLERY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("spans many modes", () => {
    const modes = new Set(GALLERY.map((p) => p.mode));
    expect(modes.size).toBeGreaterThanOrEqual(12);
    for (const mode of modes) expect(MODE_IDS).toContain(mode);
  });

  it("stores every preset as the simulator's own canonical share query plus a pinned seed", () => {
    for (const preset of GALLERY) {
      const params = new URLSearchParams(preset.query);
      expect(params.get("mode"), preset.id).toBe(preset.mode);
      expect(parseSeed(params.get("seed")), preset.id).not.toBeNull();
      const settings = settingsPart(preset.query);
      // canonical: every parameter is one the simulator reads, in range and not a default (else it would be dropped here)
      expect(settingsToSearchParams(settingsFromSearchParams(settings)).toString(), preset.id).toBe(settings.toString());
    }
  });

  // --- gallery-every-mode --- (Lane E, E2) a finished look for every mode, Mode Lab's games included
  it("holds a preset for every mode, and two of Mode Lab's games", () => {
    for (const mode of MODE_IDS) expect(GALLERY.some((p) => p.mode === mode), mode).toBe(true);
    const lab = GALLERY.filter((p) => p.mode === "blueprint").map((p) => new URLSearchParams(p.query).get("blp"));
    expect(lab).toEqual(expect.arrayContaining(["thinIce", "hotPotato"]));
  });

  // --- home-looks --- the landing page's row under the hero
  it("puts four to six presets of different shelves on the landing page, each a preset of the gallery", () => {
    const home = homeGallery();
    expect(home.map((p) => p.id)).toEqual([...HOME_GALLERY_IDS]);
    expect(home.length).toBeGreaterThanOrEqual(4);
    expect(home.length).toBeLessThanOrEqual(6);
    expect(new Set(home.map((p) => shelfOf(p.mode))).size).toBe(home.length);
  });

  it("links to the simulator with the preset applied", () => {
    const preset = GALLERY[0];
    expect(galleryHref(preset)).toBe(`/simulator?${preset.query}`);
    const url = new URL(galleryHref(preset), "https://example.com/en/");
    expect(settingsFromSearchParams(url.searchParams).mode).toBe(preset.mode);
  });

  it("names and describes every preset in every language", () => {
    for (const preset of GALLERY) {
      for (const locale of routing.locales) {
        expect(preset.name[locale]?.trim().length, `${preset.id} ${locale}`).toBeGreaterThan(2);
        expect(preset.description[locale]?.trim().length, `${preset.id} ${locale}`).toBeGreaterThan(40);
      }
      expect(preset.description.pl).not.toBe(preset.description.en);
      expect(preset.description.es).not.toBe(preset.description.en);
    }
  });

  it("has a preview image for every preset, taken inside the run", () => {
    for (const preset of GALLERY) {
      const file = path.join(process.cwd(), "public", "gallery", `${preset.id}.webp`);
      expect(fs.existsSync(file), `public/gallery/${preset.id}.webp – run GALLERY=${preset.id} npm run previews`).toBe(true);
      const bytes = fs.readFileSync(file);
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(preset.previewAt).toBeGreaterThan(0);
      expect(preset.previewAt).toBeLessThanOrEqual(60);
    }
  });
});

describe("daily challenge and gallery copy", () => {
  const keysOf = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`])) : [];

  it("has the same Daily and Gallery keys in English, Polish and Spanish", () => {
    for (const ns of ["Daily", "Gallery"] as const) {
      const base = keysOf(en[ns]).sort();
      expect(base.length).toBeGreaterThan(5);
      expect(keysOf(pl[ns]).sort()).toEqual(base);
      expect(keysOf(es[ns]).sort()).toEqual(base);
    }
  });
});
