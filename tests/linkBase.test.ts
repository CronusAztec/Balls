import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto"; // (c) the link base's digests
import { MODE_IDS } from "@/lib/physics/types";
import { defaultSettings, presetToLiveSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { clipPacingDefaults, clipPacingFindSec, clipStartSettings } from "@/lib/clipPacing";
import { modePageLooks } from "@/lib/modePages";
import { cardLinkPatch, startQuery, startRunFields, startSettings } from "@/lib/studioLooks";
import { cardQuery } from "@/lib/thumbnails/heroMoments"; // (i) picker == wall
import { decodeShareCode, encodeShareCode, mergeShareParams } from "@/lib/shareCode"; // (e)
import { parseProject } from "@/lib/project"; // (f)
import { finderRequestOfSettings } from "@/lib/bot/finderRequest"; // (g)
import { simulateSeed } from "@/lib/simulation/finder"; // (g)
import { parseSeed } from "@/lib/recording/batch"; // (i)
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
 * (round two A3b) The link base is frozen: a link made before the paces plays the run it showed then. Pinned with literals of
 * 1.17.0 (2ebb8f32, the last release before the paces), never read from gallery.ts, heroMoments.ts or dailyCore.ts, so the site's
 * own cards, gallery and pictures can change without moving a pin:
 *  - (a) a bare `?mode=X`, a preset of the mode alone and the link base are one, and a bare link plays none of its mode's pace;
 *  - (b) the paced fields' link base, as 1.17.0 played it (a field added since: the value that plays 1.17.0's run);
 *  - (c) a digest of every mode's link base, over 1.17.0's fields and over the fields added since: it fails like a fingerprint
 *    when a default moves, while a field added later passes;
 *  - (d+) the start look holds the pace of every paced mode;
 *  - (e) share codes 1.17.0 wrote open on 1.17.0's settings, and the page writes the same codes for them again;
 *  - (f) a project file and a preset 1.17.0 saved play its run: the fields added since read 1.17.0's values;
 *  - (g) 1.17.0's `?mode=race&seed=1` finishes when it did, at 27.05 s;
 *  - (i) a card opened from the studio's picker plays the run its wall link plays, in every mode.
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

// --- (a)-(g) the frozen link base (round two A3b) ---
/** The modes with a pace (lib/clipPacing.ts clipPacingDefaults): the 16 whose page starts them in it. */
const PACED: readonly ModeId[] = MODE_IDS.filter((mode) => Object.keys(clipPacingDefaults(mode)).length > 0);

/**
 * (b) The link base of every field a pace sets, as 1.17.0 played it, with the field's link key. Six fields came after 1.17.0
 * (cms, shs, shh, shb, mzfo, pdg): theirs is the value that plays 1.17.0's run. A pace that gains a field names its link base here.
 */
const PACED_LINK_BASE: Readonly<Partial<Record<ModeId, Partial<SimulatorSettings>>>> = {
  target: { targetCount: 10, ballSpeed: 400, showGlow: false }, // tc, s, glow
  colorMatch: { colorMatchSegments: 12, colorMatchColorCount: 7, ballSpeed: 400, showGlow: false }, // cms (1.17.0's 12 segments), cmc, s, glow
  pendulum: { pwCycleSeconds: 60, pwBaseOscillations: 51 }, // pwt, pwk: IN LINE! at 60 s
  polyrhythm: { prCycleSeconds: 30 }, // prcs
  mergeRing: { mrInterval: 0.9, mrSpawnTiers: 2, mrGravity: 1 }, // mri, mrs, mrg
  spiralGlass: { sgGlassHp: 2 }, // sgh
  shatter: { wallCount: 10, shatterSegments: 18, shatterHits: 1, shatterEvenBricks: false }, // wc, shs, shh, shb (1.17.0's rings: 18 segments of one hit, uneven bricks)
  territory: { tyRadius: 3, tyPowerEvery: 3 }, // tyr, tye
  runner: { runnerObstacles: 24, runnerDensity: 0.6 }, // rrn, rrd
  vortex: { vxRelease: "stagger" }, // vxrl
  bullseye: { byShots: 12, byPerfect: 0 }, // bys, byp
  race: { rcTrackLength: 8 }, // rcl
  journey: { journeyStages: "rings,pegs,glass,multipliers,rings-s,funnel,bullseye,home" }, // js
  orbGrid: { ogCycle: 30 }, // ogCycle
  maze: { mzFirstOut: false, mzDuration: 60, mzCols: 12 }, // mzfo (every ball out), mzd, mzc
  paddle: { pdGoal: 0 }, // pdg (no goal: the game runs to GAME OVER)
};

/** (f) A project file the studio of 1.17.0 saved: tests/fixtures/link-base-1.17.0, each mode at its link base, written by 2ebb8f32's own buildProject and serializeProject. */
function projectOf1170(mode: "paddle" | "maze" | "shatter" | "colorMatch"): string {
  return fs.readFileSync(path.join(ROOT, "tests/fixtures/link-base-1.17.0", `${mode}.jumpingballslive.json`), "utf8");
}

/** (c) The fields of 1.17.0's settings, in its order: the keys a 1.17.0 project file holds (all 663 of them, the same in every mode). */
const FIELDS_1_17_0: readonly string[] = Object.keys(JSON.parse(projectOf1170("paddle")).settings);
/** (c) The fields added since 1.17.0. A field added later is in neither list: it passes, and a link that leaves it out plays its default. */
const FIELDS_SINCE_1_17_0: readonly string[] = [
  "bmTune", "colorMatchSegments", "cpPourAt", "cpPulse", "glassLead", "ilStage", "lnStrings", "multiplyRace", "mzFirstOut",
  "paintGuide", "pdGoal", "ptCount", "ptUses", "shatterEvenBricks", "shatterHits", "shatterSegments", "spGrains", "spLoop",
  "spNoteSec", "spNotes", "spShake", "srBalls", "srHelp", "srLapSec", "srLive", "srSong", "srSpeed",
];

/** (c) The first 16 hex digits of the sha256 of `settings`' [field, value] pairs over `fields` (a missing field as null). */
function linkBaseDigest(settings: SimulatorSettings, fields: readonly string[]): string {
  const own = settings as unknown as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(fields.map((key) => [key, own[key] ?? null]))).digest("hex").slice(0, 16);
}

/**
 * (c) Each mode's link base over 1.17.0's fields. The 48 modes of 1.17.0 have the digests 1.17.0's own defaultSettings gives (the
 * same function run on 2ebb8f32), so every field 1.17.0 had is what it was in every mode it had; songRing and sandPlate came
 * later, and their rows record their first link base. A moved digest is a link that now plays another run: find out why, as
 * for a moved fingerprint. A mode added later adds its row.
 */
const LINK_BASE_DIGESTS: Readonly<Record<ModeId, string>> = {
  classic: "f452c3b911871f52", accumulation: "1de5dc4947c0565a", multiply: "9e4bcb21c6b804da", lines: "03a9beda9bfe6842",
  paint: "34be0d4eb963f2a6", target: "ce9666d93e5d4d86", portal: "8e8b470d2f67fbad", shatter: "b8bc826b2743adac",
  colorMatch: "e5c9fe841d45947d", grow: "e19ca68f0d5d9851", drop: "b405a6a36b7bacbc", box: "1c9389302512e19d",
  pendulum: "9fc1fdad5703c580", polyrhythm: "37e00e154435dd55", collide: "80448348a034571b", glass: "9a7f71b0c80a8fa2",
  multipliers: "acfd7b52282401d3", doublePendulum: "7082c9451d6b0305", illusion: "3e89409e7d97e292",
  stringBattle: "1ec986e1194d5725", powerLayers: "b9a3a4fff437a18d", race: "3389648c1e6483fa", battle: "d3eb378cabb61b00",
  ctf: "6883ff6d3d385756", runner: "316ec6f2d7b5fe1d", paddle: "c94d8fc25a34ae71", vortex: "5bcbadde6ac6cd2d",
  journey: "32aaee7e3833f76b", bullseye: "649b8d44fe581620", beatDrop: "ad56efd3f51b27d3", territory: "6dd2c770ae7a52da",
  maze: "c0e792f8e66fdda9", conveyor: "5f3db45977661084", orbGrid: "f0ae4cf09fb532d9", fightLeague: "add58fb5dcd597f1",
  landClaim: "14978b658b2aea70", colourSort: "38b3c98990439fb1", starChords: "6abe7611cc81aa38", hoops: "42029e3b552f6f21",
  ellipseFoci: "7bba645e7929391c", beatMachine: "853572cce1d6195c", waveTank: "a808fb56f6a2ad72",
  brickRebuild: "22d6476ed4a0ed53", drawingMachine: "33c4fae5cbd4e9ae", perfectFit: "283da25c55f82ddb",
  mergeRing: "95081102d7492c70", spiralGlass: "edc9b8dc2d34b46b", songRing: "ddae96f473f6164b", sandPlate: "bbc4f95d453f8f3f",
  blueprint: "bc7b77b06d2a2377",
};
/** (c) The link base over the fields added since 1.17.0: the same values in every mode. */
const SINCE_1_17_0_DIGEST = "fb4aa688b86f8071";

/** (e) Share codes 1.17.0 wrote, what each holds, and what it reads: Pendulum Wave with 30 pendulums, a race of 10 racers. */
const CODES_1_17_0 = [
  { code: "q1bKzU9JVbJSKkjNSynNKc1V0lEqKM9TsjI2qAUA", holds: "mode=pendulum&pwn=30", reads: { mode: "pendulum", pwCount: 30, pwCycleSeconds: 60, pwBaseOscillations: 51 } },
  { code: "q1bKzU9JVbJSKkpMTlXSUSpKzlOyMjSoBQA", holds: "mode=race&rcn=10", reads: { mode: "race", rcRacers: 10, rcTrackLength: 8 } },
] as const;

/** (f) What 1.17.0 played for the fields it did not have yet, in the four modes whose pace added one. */
const ADDED_FIELDS_AS_1_17_0: Readonly<Record<"paddle" | "maze" | "shatter" | "colorMatch", Partial<SimulatorSettings>>> = {
  paddle: { pdGoal: 0 }, // no goal: a run to GAME OVER
  maze: { mzFirstOut: false }, // the run ends when every ball is out
  shatter: { shatterHits: 1, shatterSegments: 18, shatterEvenBricks: false }, // one hit, 18 segments a ring, uneven bricks
  colorMatch: { colorMatchSegments: 12 },
};

describe("(a)-(g) the link base is 1.17.0's: a link made before the paces plays the run it showed then", () => {
  it("(a) reads a bare link, a preset of the mode alone and the link base alike, writes the link base as a bare link, and plays no pace from it", () => {
    for (const mode of MODE_IDS) {
      const base = defaultSettings(mode);
      expect(settingsFromSearchParams(new URLSearchParams(`mode=${mode}`)), mode).toEqual(base);
      expect(presetToSettings({ mode }), mode).toEqual(base);
      expect(settingsToSearchParams(base).toString()).toBe(`mode=${mode}`);
    }
    expect(PACED.length).toBeGreaterThanOrEqual(16);
    for (const mode of PACED) {
      const bare = settingsFromSearchParams(new URLSearchParams(`mode=${mode}`)) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(clipPacingDefaults(mode))) expect([mode, key, bare[key]], "a bare link plays the pace").not.toEqual([mode, key, value]);
    }
  });

  it("(b) keeps every field of a pace at 1.17.0's value on the link base", () => {
    expect([...PACED].sort()).toEqual(Object.keys(PACED_LINK_BASE).sort());
    for (const mode of PACED) {
      const base = PACED_LINK_BASE[mode] ?? {};
      expect([mode, Object.keys(base).sort()]).toEqual([mode, Object.keys(clipPacingDefaults(mode)).sort()]);
      expect(defaultSettings(mode), mode).toMatchObject(base);
    }
    // the examples a reader checks first: Race's 8 screens, Pendulum Wave's 60 s cycle, Countdown's 10 numbers at 400
    expect(settingsFromSearchParams(new URLSearchParams("mode=race"))).toMatchObject({ rcTrackLength: 8 });
    expect(settingsFromSearchParams(new URLSearchParams("mode=pendulum"))).toMatchObject({ pwCycleSeconds: 60, pwBaseOscillations: 51 });
    expect(settingsFromSearchParams(new URLSearchParams("mode=target"))).toMatchObject({ targetCount: 10, ballSpeed: 400 });
  });

  it("(c) keeps every mode's link base: the fields 1.17.0 had as it had them, the fields added since as they are", () => {
    expect([FIELDS_1_17_0.length, FIELDS_SINCE_1_17_0.length]).toEqual([663, 27]);
    expect(FIELDS_SINCE_1_17_0.filter((key) => FIELDS_1_17_0.includes(key))).toEqual([]);
    // no field of either list is gone (a link that names it would lose it)
    const fields = Object.keys(defaultSettings("classic"));
    expect([...FIELDS_1_17_0, ...FIELDS_SINCE_1_17_0].filter((key) => !fields.includes(key))).toEqual([]);
    expect(Object.keys(LINK_BASE_DIGESTS).sort()).toEqual([...MODE_IDS].sort());
    const moved = MODE_IDS.filter((mode) => linkBaseDigest(defaultSettings(mode), FIELDS_1_17_0) !== LINK_BASE_DIGESTS[mode]);
    expect(moved, "the link base of these modes moved").toEqual([]);
    const movedSince = MODE_IDS.filter((mode) => linkBaseDigest(defaultSettings(mode), FIELDS_SINCE_1_17_0) !== SINCE_1_17_0_DIGEST);
    expect(movedSince, "the link base of these modes moved in a field added since 1.17.0").toEqual([]);
  });

  it("(c) would notice: a moved default moves the digest, a field added later does not", () => {
    const base = defaultSettings("race");
    const digests = (settings: SimulatorSettings) => [linkBaseDigest(settings, FIELDS_1_17_0), linkBaseDigest(settings, FIELDS_SINCE_1_17_0)];
    expect(digests({ ...base, rcTrackLength: base.rcTrackLength - 2 })[0]).not.toBe(digests(base)[0]);
    expect(digests({ ...base, pdGoal: base.pdGoal + 20 })[1]).not.toBe(digests(base)[1]);
    expect(digests({ ...base, aFieldAddedLater: 1 } as unknown as SimulatorSettings)).toEqual(digests(base));
  });

  it("(d+) starts every paced mode in its pace: the start look holds it", () => {
    for (const mode of PACED) {
      expect(clipStartSettings(mode), mode).toMatchObject(clipPacingDefaults(mode));
      expect(startSettings(mode), mode).toMatchObject(clipPacingDefaults(mode));
    }
  });

  it("(e) opens 1.17.0's share codes on 1.17.0's settings, and writes the same codes for them again", async () => {
    for (const { code, holds, reads } of CODES_1_17_0) {
      const decoded = await decodeShareCode(code);
      expect([code, decoded.ok]).toEqual([code, true]);
      if (!decoded.ok) continue;
      expect(decoded.params.toString()).toBe(holds);
      // what the page opens for ?c=<code> (components/simulator/shareLinks.tsx): the code's pairs, then the link's
      const settings = settingsFromSearchParams(mergeShareParams(decoded.params, new URLSearchParams(`c=${code}`)));
      expect(settings, code).toEqual({ ...defaultSettings(reads.mode), ...reads });
      expect(settingsToSearchParams(settings).toString()).toBe(holds);
      expect(await encodeShareCode(settingsToSearchParams(settings))).toBe(code);
    }
  });

  it("(f) plays a project file and a preset 1.17.0 saved as 1.17.0 did: the fields added since read 1.17.0's values", () => {
    for (const [mode, added] of Object.entries(ADDED_FIELDS_AS_1_17_0) as [keyof typeof ADDED_FIELDS_AS_1_17_0, Partial<SimulatorSettings>][]) {
      const text = projectOf1170(mode);
      const saved = JSON.parse(text).settings as Partial<SimulatorSettings>;
      // a 1.17.0 file: the mode, 1.17.0's fields and none added since
      expect([mode, saved.mode, Object.keys(saved)]).toEqual([mode, mode, FIELDS_1_17_0]);
      const parsed = parseProject(text);
      expect([mode, parsed.ok]).toEqual([mode, true]);
      if (!parsed.ok) continue;
      expect(parsed.project.settings, mode).toMatchObject(added);
      expect(parsed.project.settings, mode).toEqual({ ...defaultSettings(mode), ...added });
      // 1.17.0's Save preset stored the same object ({ ...settings }); the page loads a preset as presetToLiveSettings does
      expect(presetToLiveSettings(saved, { hitSample: false, wallBreakSound: null }), mode).toEqual(parsed.project.settings);
    }
  });

  it("(g) finishes 1.17.0's ?mode=race&seed=1 when 1.17.0 did: 27.05 s (1,623 steps), in the finder's world and the phone's", () => {
    const settings = settingsFromSearchParams(new URLSearchParams("mode=race&seed=1"));
    for (const world of [{ width: 800, height: 600 }, { width: 450, height: 450 }]) {
      const ms = simulateSeed(1, finderRequestOfSettings(settings, world, 150), 150_000);
      expect([world, Math.round((ms * 60) / 1000)]).toEqual([world, 1623]);
    }
  });
});
// --- end (a)-(g) ---

// --- (i) picker == wall (round two A3b) ---
describe("(i) a card opens on the same run from the wall and from the studio's picker", () => {
  it("puts the card's patch on the start look the picker lands on, and gets the wall link's settings and seed, in every mode", () => {
    // the picker switches the page to the mode (its start look) and puts cardLinkPatch on top; the wall, the landing and the
    // mode pages link to /simulator?<cardQuery>, which the page reads as written (tests/studioLooks.test.ts checks the patch's keys)
    for (const mode of MODE_IDS) {
      const link = cardQuery(mode);
      const { patch, seed } = cardLinkPatch(mode, link);
      expect({ ...startSettings(mode), ...patch }, mode).toEqual(settingsFromSearchParams(new URLSearchParams(link)));
      expect([mode, seed]).toEqual([mode, parseSeed(new URLSearchParams(link).get("seed"))]);
    }
  });
});
// --- end (i) ---

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
