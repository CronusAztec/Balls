import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { MODE_IDS } from "@/lib/physics/types";
import { MODE_CARD_ORDER } from "@/lib/modes";
import { aspectRatioLabel, familyOf, modeFamilies, modesForFilter, paletteMatches, type PaletteEntry } from "@/lib/siteDesign";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/* --- site-redesign --- the pure parts of the new layout: mode families, the stage strip's format, the palette matcher,
   the messages of the redesign and the design rules the sweep established. */

type Tree = { [key: string]: string | Tree };
const flat = (tree: Tree, prefix = ""): string[] => Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flat(v, `${prefix}${k}.`)));

describe("mode families", () => {
  it("cover every mode exactly once, in card order, and only non-empty families", () => {
    const families = modeFamilies();
    const all = families.flatMap((f) => f.modes);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(MODE_CARD_ORDER.filter((m) => MODE_IDS.includes(m)).sort());
    for (const f of families) {
      expect(f.modes.length).toBeGreaterThan(0);
      for (const m of f.modes) expect(familyOf(m)).toBe(f.id);
      expect(f.modes).toEqual(MODE_CARD_ORDER.filter((m) => f.modes.includes(m)));
    }
  });

  it("filter to one family or show them all", () => {
    expect(modesForFilter("all")).toEqual(modeFamilies().flatMap((f) => f.modes));
    for (const f of modeFamilies()) expect(modesForFilter(f.id)).toEqual(f.modes);
  });

  it("have a translated chip label in every language", () => {
    for (const m of [en, pl, es]) for (const f of modeFamilies()) expect((m.SiteRedesign.families as Record<string, string>)[f.id]?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("aspectRatioLabel", () => {
  it("reduces an export resolution to its ratio", () => {
    expect(aspectRatioLabel("1080x1920")).toBe("9:16");
    expect(aspectRatioLabel("1920x1080")).toBe("16:9");
    expect(aspectRatioLabel("1280x720")).toBe("16:9");
    expect(aspectRatioLabel("500x500")).toBe("1:1");
    expect(aspectRatioLabel("1080 × 1350")).toBe("4:5");
  });
  it("gives nothing for an unreadable value", () => {
    expect(aspectRatioLabel("")).toBe("");
    expect(aspectRatioLabel("wide")).toBe("");
    expect(aspectRatioLabel("0x100")).toBe("");
  });
});

describe("paletteMatches", () => {
  const entries: PaletteEntry[] = [
    { kind: "section", section: "ball", key: "ball", label: "Ball & Physics", sectionLabel: "Ball & Physics" },
    { kind: "section", section: "sound", key: "sound", label: "Custom Sound", sectionLabel: "Custom Sound" },
    { kind: "control", section: "ball", key: "gravity", label: "Gravity", sectionLabel: "Ball & Physics" },
    { kind: "control", section: "ball", key: "ballSpeed", label: "Ball Speed", sectionLabel: "Ball & Physics" },
    { kind: "control", section: "wall", key: "rotatingGravity", label: "Rotating Gravity", sectionLabel: "Wall Settings" },
    { kind: "control", section: "sound", key: "wallBreakSound", label: "Dźwięk przebicia ściany", sectionLabel: "Własny dźwięk" },
  ];
  it("lists the sections for an empty query", () => {
    expect(paletteMatches(entries, "  ").map((e) => e.key)).toEqual(["ball", "sound"]);
  });
  it("ranks a label that starts with the query first", () => {
    expect(paletteMatches(entries, "grav").map((e) => e.key)).toEqual(["gravity", "rotatingGravity"]);
  });
  it("matches every word, in the label, the section name or the key", () => {
    expect(paletteMatches(entries, "ball speed").map((e) => e.key)[0]).toBe("ballSpeed");
    expect(paletteMatches(entries, "physics grav").map((e) => e.key)).toEqual(["gravity"]);
    expect(paletteMatches(entries, "zzz")).toEqual([]);
  });
  it("folds diacritics, so plain typing finds Polish and Spanish labels", () => {
    expect(paletteMatches(entries, "dzwiek sciany").map((e) => e.key)).toEqual(["wallBreakSound"]);
    expect(paletteMatches(entries, "wlasny").map((e) => e.key)).toContain("wallBreakSound");
  });
  it("stops at the limit", () => {
    expect(paletteMatches(entries, "a", 2)).toHaveLength(2);
  });
});

describe("SiteRedesign messages", () => {
  it("have the same keys in English, Polish and Spanish", () => {
    const keys = (m: { SiteRedesign: unknown }) => flat(m.SiteRedesign as Tree).sort();
    expect(keys(pl)).toEqual(keys(en));
    expect(keys(es)).toEqual(keys(en));
  });
  it("keep the hero headline at eight words or fewer", () => {
    for (const m of [en, pl, es]) expect(m.SiteRedesign.hero.title.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(8);
  });
});

describe("design rules", () => {
  it("load the fonts from src/fonts, with their OFL licences next to them", () => {
    const dir = path.join(__dirname, "..", "src", "fonts");
    const files = fs.readdirSync(dir);
    for (const family of ["space-grotesk", "hanken-grotesk", "jetbrains-mono"]) {
      expect(files).toContain(`${family}-latin.woff2`);
      expect(files).toContain(`${family}-latin-ext.woff2`);
    }
    expect(files.filter((f) => /^OFL-.*\.txt$/.test(f))).toHaveLength(3);
    for (const layout of ["app/[locale]/layout.tsx", "app/(static)/layout.tsx"]) expect(fs.readFileSync(path.join(__dirname, "..", "src", layout), "utf8")).not.toMatch(/fonts\.googleapis/);
  });
});
