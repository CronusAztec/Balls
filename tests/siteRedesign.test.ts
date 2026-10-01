import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { MODE_CARD_ORDER } from "@/lib/modes";
import { aspectRatioLabel, familyOf, modeFamilies, modesForFilter, paletteControlEntries, paletteMatches, type PaletteEntry, type PaletteGroup } from "@/lib/siteDesign";
import { paletteKeyGroups, type ControlSection } from "@/components/simulator/Controls";
import { MODE_BLOCK_KEYS, MODE_BLOCK_KEY_SET, sectionKeyShown, wallControlsOf, type PanelShown } from "@/components/simulator/panelKeys";
import { supportsObstacles } from "@/lib/physics/obstacleEditor";
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

describe("paletteControlEntries", () => {
  const groups: PaletteGroup[] = [
    { section: "mode", label: "Mode", keys: ["boxGravity"] },
    { section: "ball", label: "Ball & Physics", keys: ["gravity", "gravity", "noLabel", "gravityAlias", "ballPhysics", "ballSpeed"] },
    { section: "wall", label: "Wall Settings", keys: ["gravity", "wallCount"] },
  ];
  const labels: Record<string, string> = { boxGravity: "Gravity", gravity: "Gravity", gravityAlias: "gravity ", ballPhysics: "Ball & Physics", ballSpeed: "Ball Speed", wallCount: "Wall Count" };
  const entries = paletteControlEntries(groups, (key) => labels[key] ?? null);
  it("keep a key once, skip keys without a label and one of two labels alike in a group", () => {
    expect(entries.map((e) => `${e.section}:${e.key}`)).toEqual(["mode:boxGravity", "ball:gravity", "ball:ballSpeed", "wall:wallCount"]);
  });
  it("leave out a control named like its own group (the group's entry covers it)", () => {
    expect(entries.some((e) => e.key === "ballPhysics")).toBe(false);
  });
  it("carry the group's name as the section label", () => {
    expect(entries.find((e) => e.key === "ballSpeed")).toEqual({ kind: "control", section: "ball", key: "ballSpeed", label: "Ball Speed", sectionLabel: "Ball & Physics" });
  });
});

describe("command palette: what each mode offers (review fix)", () => {
  const PANEL: Omit<PanelShown, "mode"> = { ballPicture: false, showTrails: true, glassGates: false, wobblyWalls: false, simulationFound: false, bannerText: false, arenas: false, teams: false, captions: false, videoBackground: false, videoBeats: true, batch: true, bot: true };
  const railOf = (mode: ModeId): ControlSection[] => ["ball", "wall", "visual", "sound", "teams", ...(supportsObstacles(mode) ? (["obstacles"] as const) : []), "captions", "timeline", "arenas", "recording"];
  const entriesOf = (mode: ModeId, extra: Partial<PanelShown> = {}, catalog: { Controls: unknown } = en) => {
    const controls = catalog.Controls as Record<string, unknown>;
    const groups = paletteKeyGroups({ ...PANEL, ...extra, mode }, railOf(mode), true).map((g) => ({ ...g, label: g.section }));
    return paletteControlEntries(groups, (key) => (typeof controls[key] === "string" ? (controls[key] as string) : null));
  };
  const where = (entries: PaletteEntry[], label: string) => entries.filter((e) => e.label === label).map((e) => `${e.section}:${e.key}`);

  it("offer one Gravity in Classic and no other mode's gravity (Bouncing Shapes', Ball Drop's, the orbs', the pendulum's, the vortex's)", () => {
    const classic = entriesOf("classic");
    expect(where(classic, "Gravity")).toEqual(["ball:gravity"]);
    for (const key of ["boxGravity", "dropGravityVariation", "cpGravity", "dpGravity", "vxGravity"]) expect(classic.some((e) => e.key === key), key).toBe(false);
    expect(paletteMatches(classic, "grav").map((e) => e.label)).toEqual(["Gravity", "Rotating Gravity"]);
  });

  it("offer a mode's own block under the Mode group, in that mode only", () => {
    expect(where(entriesOf("box"), "Gravity")).toEqual(["mode:boxGravity", "ball:gravity"]);
    expect(where(entriesOf("drop"), "Gravity Variation")).toEqual(["mode:dropGravityVariation"]);
    expect(where(entriesOf("accumulation"), "Spikes")).toEqual(["mode:spikes"]);
    expect(entriesOf("classic").some((e) => e.section === "mode")).toBe(false);
    for (const mode of MODE_IDS) {
      const entries = entriesOf(mode);
      const own = new Set(MODE_BLOCK_KEYS[mode] ?? []);
      for (const e of entries) {
        if (MODE_BLOCK_KEY_SET.has(e.key)) expect(own.has(e.key) && e.section === "mode", `${mode} ${e.section}:${e.key}`).toBe(true);
      }
      // one entry per label in a group
      const seen = new Set<string>();
      for (const e of entries) {
        const id = `${e.section}:${e.label.toLowerCase()}`;
        expect(seen.has(id), `${mode} ${id}`).toBe(false);
        seen.add(id);
      }
    }
  });

  it("leave out what the mode or a setting hides: Wall Count, Ball Count, the arena editor, the caption form, Add Team", () => {
    expect(entriesOf("classic").some((e) => e.key === "wallCount")).toBe(true);
    for (const mode of ["accumulation", "box", "drop"] as const) expect(entriesOf(mode).some((e) => e.key === "wallCount"), mode).toBe(false);
    expect(wallControlsOf("grow")).toEqual({ wallCount: false, thickness: true, gapControls: true, gapSize: false });
    expect(entriesOf("classic").some((e) => e.key === "ballCount")).toBe(true);
    expect(entriesOf("box").some((e) => e.key === "ballCount")).toBe(false);
    expect(entriesOf("classic").some((e) => e.key === "twoBalls")).toBe(false); // (a search alias of the Ball Count)
    expect(entriesOf("classic").some((e) => e.key === "splitArenaGravity")).toBe(false);
    expect(entriesOf("classic", { arenas: true }).some((e) => e.key === "splitArenaGravity")).toBe(true);
    expect(entriesOf("classic").some((e) => e.key === "captionStart")).toBe(false);
    expect(entriesOf("classic", { captions: true }).some((e) => e.key === "captionStart")).toBe(true);
    expect(entriesOf("classic").some((e) => e.key === "teamAdd")).toBe(false);
    expect(entriesOf("classic", { teams: true }).some((e) => e.key === "teamAdd")).toBe(true);
    expect(entriesOf("classic").some((e) => e.key === "vbVideoOpacity")).toBe(false);
    expect(entriesOf("classic", { videoBackground: true }).some((e) => e.key === "vbVideoOpacity")).toBe(true);
    expect(entriesOf("classic").some((e) => e.key === "timeline")).toBe(false); // (the Timeline group's own word)
    expect(sectionKeyShown("ballColor", { ...PANEL, mode: "classic", ballPicture: true }, false)).toBe(false);
    expect(sectionKeyShown("multiplierPickups", { ...PANEL, mode: "drop" }, false)).toBe(false);
  });

  it("keep the Project file's entries under Saved Presets", () => {
    expect(where(entriesOf("classic"), "Export project")).toEqual(["presets:exportProject"]);
  });

  it("name every entry in Polish and Spanish too", () => {
    for (const mode of MODE_IDS) {
      for (const e of entriesOf(mode)) {
        for (const [lang, catalog] of [["pl", pl], ["es", es]] as const) expect(typeof (catalog.Controls as Record<string, unknown>)[e.key], `${lang} ${mode} ${e.key}`).toBe("string");
      }
    }
  });

  it("know the block of every mode that has one in the Mode group (Controls.tsx modeSpecific())", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "Controls.tsx"), "utf8");
    const body = src.slice(src.indexOf("const modeSpecific = () => {"), src.indexOf("default:", src.indexOf("const modeSpecific = () => {")));
    const modes = [...body.matchAll(/case "(\w+)":/g)].map((m) => m[1]);
    expect(modes.length).toBeGreaterThan(20);
    for (const mode of modes) expect(MODE_BLOCK_KEYS[mode as ModeId]?.length ?? 0, mode).toBeGreaterThan(0);
    expect(src).toContain("const walls = wallControlsOf(s.mode);");
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
