import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MODE_IDS } from "@/lib/physics/types";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { clipPacingFindSec, clipStartSettings } from "@/lib/clipPacing";
import { modePageLooks } from "@/lib/modePages";
import { startQuery, startRunFields, startSettings } from "@/lib/studioLooks";
import { sectionDefaults, type ControlSection } from "@/components/simulator/Controls"; // (j) Reset Category
import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";

/*
 * --- pace-as-look --- The link base and the start look (lib/studioLooks.ts startSettings, startQuery). A link reads a mode on
 * its link base (`defaultSettings`): what `?mode=X` plays, and what every shared link, preset, project file and share code is
 * written against. The page itself starts a mode in its start look (`clipStartSettings` on top), and so does every link the
 * site writes into a mode: the start query names the start look's fields, so it plays the page's own first run.
 *  - (d) the start query of every mode reads back to its start look;
 *  - (h) no simulator link in the site's code is built by hand from `mode=${…}`: a bare mode link plays the link base, not the
 *    run the page starts in. The links that may name a mode are the start query, the card's and the picture's (cardQuery,
 *    heroQuery: their own settings and seed), a gallery preset's (galleryHref: its literal query) and a mode page's Challenge
 *    look (the daily deal's settings);
 *  - (j) (A-g1 review) Reset Category puts a section back without making a third run: a page on the link base stays on the
 *    link's run or lands on the start look's, a page on the start look stays on it.
 */

const ROOT = path.resolve(__dirname, "..");

describe("(d) the start look as a link", () => {
  it("is the link base with the start look on top, for every mode", () => {
    for (const mode of MODE_IDS) expect(startSettings(mode), mode).toEqual({ ...defaultSettings(mode), ...clipStartSettings(mode) });
  });

  it("reads back to the start look for every mode, and names nothing for a mode without one", () => {
    for (const mode of MODE_IDS) {
      const params = new URLSearchParams(startQuery(mode));
      expect([mode, params.get("mode"), params.has("seed")]).toEqual([mode, mode, false]);
      expect(settingsFromSearchParams(params), mode).toEqual(startSettings(mode));
      expect(startQuery(mode)).toBe(settingsToSearchParams(startSettings(mode)).toString());
      if (Object.keys(clipStartSettings(mode)).length === 0) expect(startQuery(mode)).toBe(settingsToSearchParams(defaultSettings(mode)).toString());
    }
    // Classic's start look, the page's first run: the Ring Ladder pace with the ring sounds (its link base: gap 0.4 at 400, silent rings)
    expect(startQuery("classic")).toBe("mode=classic&s=500&gap=1&shake=0.3&glow=1&wbreak=all&resn=1");
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic"))).toMatchObject({ gapSize: 0.4, ballSpeed: 400, ringSound: false });
  });

  it("is what a mode page's Plain look opens", () => {
    for (const mode of MODE_IDS) {
      const plain = modePageLooks(mode).find((look) => look.kind === "plain");
      expect([mode, plain?.href]).toEqual([mode, `/simulator?${startQuery(mode)}`]);
    }
  });
});

// --- (h) the site's own links into a mode ---
/** A place that may build a mode's link from `mode=${…}`: the file and the function around it. */
const LINK_BUILDERS: readonly { file: string; fn: string; why: string }[] = [
  { file: "src/lib/thumbnails/heroMoments.ts", fn: "cardQuery", why: "a card's link: its own settings and its picture's seed" },
  { file: "src/lib/thumbnails/heroMoments.ts", fn: "heroQuery", why: "a picture's link: its own settings and seed" },
  { file: "src/lib/modePages.ts", fn: "dailyLookHref", why: "a mode page's Challenge look: the daily deal's settings (Plain is the start query)" },
  { file: "src/lib/studioLooks.ts", fn: "lookSettings", why: "reads a look's settings on the link base into settings: no link" },
];

/**
 * The function a position of `text` sits in: the last top-level declaration before it (a line that starts, unindented, with
 * `function name(`, `const name =`, `let`, `var` or `class`, `export` and `default` allowed in front). (A-g1 review) Any
 * top-level declaration ends the one before it, so an arrow helper declared after an allowed builder is not taken for it.
 */
function functionAt(text: string, at: number): string {
  let name = "";
  for (const m of text.slice(0, at).matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z0-9_$]+)/gm)) name = m[1];
  return name;
}

/** The hand-built mode links of a source file: `mode=${…}` (not `data-mode=${…}`) and a literal `/simulator?mode=`, outside comments. */
function handBuiltModeLinks(text: string): { line: number; fn: string; code: string }[] {
  const found: { line: number; fn: string; code: string }[] = [];
  let offset = 0;
  text.split("\n").forEach((code, i) => {
    const trimmed = code.trim();
    const comment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    if (!comment) for (const m of code.matchAll(/(?<![\w-])mode=\$\{|\/simulator\?mode=/g)) found.push({ line: i + 1, fn: functionAt(text, offset + (m.index ?? 0)), code: trimmed });
    offset += code.length + 1;
  });
  return found;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("(h) the site's own links into a mode open its start look", () => {
  it("builds no simulator link by hand from a mode in src/app, src/lib or src/components", () => {
    const stray: string[] = [];
    const used = new Set<string>();
    for (const dir of ["src/app", "src/lib", "src/components"]) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        for (const hit of handBuiltModeLinks(fs.readFileSync(file, "utf8"))) {
          const builder = LINK_BUILDERS.find((b) => b.file === rel && b.fn === hit.fn);
          if (builder) used.add(`${builder.file} ${builder.fn}`);
          else stray.push(`${rel}:${hit.line} (${hit.fn || "top level"}): ${hit.code}`);
        }
      }
    }
    expect(stray).toEqual([]);
    // every place the list names still builds one (a builder that moved or went is taken off the list, never left behind)
    expect([...used].sort()).toEqual(LINK_BUILDERS.map((b) => `${b.file} ${b.fn}`).sort());
  });

  it("would notice: a hand-built studio link, a bare literal one and a link built in a component", () => {
    const sample = [
      "export default function Page() {",
      "  return <Link href={`/simulator?mode=${mode}`} />;",
      "}",
      "function cta() {",
      '  return "/simulator?mode=classic";',
      "}",
      "// a comment about /simulator?mode=race is no link",
      "const css = `[data-mode=${mode}]{display:none}`;",
    ].join("\n");
    expect(handBuiltModeLinks(sample).map((hit) => [hit.line, hit.fn])).toEqual([
      [2, "Page"],
      [5, "cta"],
    ]);
    expect(handBuiltModeLinks("const q = [`mode=${mode}`, look].join(\"&\");").length).toBe(1);
    // (A-g1 review) an arrow helper after an allowed builder is its own, and an indented declaration inside a function is not
    const after = [
      "export function cardQuery(mode) {",
      "  const base = (mode);",
      "  return `mode=${mode}`;",
      "}",
      "export const stray = (mode) => `/simulator?mode=${mode}`;",
    ].join("\n");
    expect(handBuiltModeLinks(after).map((hit) => [hit.line, hit.fn])).toEqual([
      [3, "cardQuery"],
      [5, "stray"],
    ]);
  });

  it("opens the start look from the site's entry points: the TikTok page's button and the changelog's Try links", () => {
    const tiktok = fs.readFileSync(path.join(ROOT, "src/app/[locale]/tiktok-ball-videos/page.tsx"), "utf8");
    expect(tiktok).toContain('href={`/simulator?${startQuery("classic")}`}');
    expect(tiktok).toContain('data-track-id="tiktok_cta"');
    const changelog = fs.readFileSync(path.join(ROOT, "src/app/[locale]/changelog/page.tsx"), "utf8");
    expect(changelog).toContain("href={`/simulator?${startQuery(mode)}`}");
  });
});
// --- end (h) ---

// --- (j) Reset Category (A-g1 review) ---
describe("(j) Reset Category lands on the link base or the start look, never between", () => {
  const SECTIONS: readonly ControlSection[] = ["ball", "wall", "visual", "sound", "recording", "teams", "obstacles", "captions", "timeline", "arenas"];
  /** The run of `settings` as far as the start look sets it: the start look's run fields (studioLooks.ts startRunFields) and Find's target. */
  const runOf = (mode: ModeId, settings: SimulatorSettings) => {
    const own = settings as unknown as Record<string, unknown>;
    return JSON.stringify({ fields: startRunFields(mode).map((key) => [key, own[key]]), find: clipPacingFindSec(settings) });
  };
  const reset = (settings: SimulatorSettings, section: ControlSection): SimulatorSettings => ({ ...settings, ...sectionDefaults(section, settings.mode, settings) });

  it("leaves a link base page on the link's run or the start look's, and a start look page on the start look's, in every mode and section", () => {
    const withRun = MODE_IDS.filter((mode) => startRunFields(mode).length > 0);
    expect(withRun.length).toBeGreaterThanOrEqual(15);
    for (const mode of withRun) {
      const base = defaultSettings(mode);
      const start = startSettings(mode);
      const [linkRun, startRun] = [runOf(mode, base), runOf(mode, start)];
      expect(linkRun, mode).not.toBe(startRun);
      for (const section of SECTIONS) {
        const fromBase = runOf(mode, reset(base, section));
        expect([mode, section, [linkRun, startRun].includes(fromBase)]).toEqual([mode, section, true]);
        // a link base page lands on the start look only through a section that holds every run field of it (Glass Smash's gravity)
        if (fromBase === startRun) expect([mode, section, startRunFields(mode).every((key) => key in sectionDefaults(section, mode))]).toEqual([mode, section, true]);
        expect([mode, section, runOf(mode, reset(start, section))]).toEqual([mode, section, startRun]);
      }
    }
  });

  it("keeps the link's run through the sections the reviewer played (Paint, Bouncing Shapes, Lines, Classic), and puts back the start look's look", () => {
    // before: a Ball & Physics reset on ?mode=paint gave r=12&s=600 without Guide to the Gaps (full at 37-52 s, neither run)
    for (const mode of ["paint", "box", "lines", "classic"] as const) {
      const base = defaultSettings(mode);
      const after = reset(base, "ball");
      expect([mode, after.ballSpeed, after.ballRadius]).toEqual([mode, base.ballSpeed, base.ballRadius]);
    }
    // the look goes back to the start look's on any page, as the theme's Default does: Classic's glow, shake, breaks and ring sounds
    const classic = defaultSettings("classic");
    const look = reset(reset(classic, "visual"), "wall");
    expect([look.showGlow, look.screenShake, look.wallBreakStyle, look.ringSound, look.gapSize, look.ballSpeed]).toEqual([true, 0.3, "all", true, 0.4, 400]);
    // on the start look a section's reset is the start look's (the page's own first run), and the page's settings decide it:
    // a start look page whose gap the visitor changed is no longer on the start look's run, so Ball & Physics goes to the link base
    const start = startSettings("classic");
    expect(reset({ ...start, ballSpeed: 250 }, "ball").ballSpeed).toBe(500);
    expect(reset({ ...start, ballSpeed: 250, gapSize: 0.6 }, "ball").ballSpeed).toBe(400);
    // without the page's settings: the start look's (what the Ring Escape and Slow motion tests read)
    expect(sectionDefaults("ball", "classic").ballSpeed).toBe(500);
  });
});
// --- end (j) ---
