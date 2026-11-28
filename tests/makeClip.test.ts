import { afterEach, describe, expect, it, vi } from "vitest";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { clipPacingFindSec, DEFAULT_FIND_SEC } from "@/lib/clipPacing";
import { startSettings } from "@/lib/studioLooks";
import { MAKE_CLIP_AS_IS, MAKE_CLIP_ENDING, MAKE_CLIP_TOLERANCE_SEC, makeClipAsIs, makeClipFind, makeClipKind, makeClipPick, makeClipTemplates, type MakeClipFind } from "@/lib/bot/makeClip";
import { readyTemplates, templatePlayOf } from "@/lib/bot/templates";
import { BOT_PLATFORMS } from "@/lib/bot/playbook";
import { physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { findSimulation } from "@/lib/simulation/finder";
import { PF_FINDER_TRIES } from "@/lib/simulation/perfectFitFinder"; // --- make-clip-start --- (A-g4 review)
import { onBeatConfigOfSettings } from "@/lib/simulation/videoBeatsSettings";
import { pageFinderRequest } from "@/lib/simulation/pageFinderRequest";
import type { SimulatorSettings } from "@/lib/settings";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- make-clip --- --- make-clip-start --- (round two A7, R6 and R8) "Make me a clip" stays on the page's mode on every
 * platform: one of the mode's own templates that ends resolved, or the mode's start look on a run the page's own Find finds
 * (lib/bot/makeClip.ts). Before, 14 modes without a template got another mode's clip (Lines, Paint, Race …) and 7 whose
 * templates all cut before the payoff (Target, Portal, Shatter …) got a clip that never showed their finale. The templates
 * themselves (templates.ts, the crew's corpus and the bot's digests) are untouched: tests/botTemplates.test.ts pins them.
 */

/** The modes that get a start clip on this tree: no template of their own, or only templates that cut before the payoff. */
const START_MODES: readonly ModeId[] = [
  // no template of their own (R8)
  "lines", "paint", "drop", "box", "illusion", "race", "runner", "paddle", "vortex", "beatDrop", "beatMachine", "waveTank", "perfectFit", "mergeRing",
  // their templates all end on a cliffhanger, before the payoff (R6)
  "accumulation", "target", "portal", "shatter", "colorMatch", "territory", "landClaim",
];

const WORLDS = [
  { width: 800, height: 450 },
  { width: 450, height: 450 },
] as const;

/** The page's Find on `s`, as Simulator.tsx runs it for a start clip (`find`'s target and search): nothing of the page's own loaded. */
function pageFind(s: SimulatorSettings, world: { width: number; height: number }, find: MakeClipFind) {
  return findSimulation(
    pageFinderRequest(s, {
      physicsConfig: physicsConfigOfSettings(s, world),
      targetSec: find.targetSec,
      toleranceSec: find.toleranceSec,
      maxSeeds: 300,
      depthBudgetMs: 0,
      panelTargetSec: DEFAULT_FIND_SEC,
      panelToleranceSec: 0.5,
      rhythmBeat: null,
      melody: [],
      onBeat: onBeatConfigOfSettings(s),
      paintPicture: false,
      ...(find.outcome ? { outcome: { kind: find.outcome, clipSec: find.targetSec } } : {}),
      ...(find.seedBase !== undefined ? { solutionSeedBase: find.seedBase } : {}), // (A-g4 review) as Simulator.tsx runFinderWith
    }),
    () => {},
  );
}

describe("Make me a clip keeps the page's mode (make-clip-start)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals(); // (A-g4 review) the requestAnimationFrame stub below
  });

  it("plays a template for a mode whose own templates end resolved, else the mode's start look, on every platform", () => {
    for (const platform of BOT_PLATFORMS) {
      const starts: ModeId[] = [];
      for (const mode of MODE_IDS) {
        const own = readyTemplates("all").filter((t) => t.mode === mode && templatePlayOf(t.id)?.platforms.includes(platform));
        const resolved = own.some((t) => templatePlayOf(t.id)!.endings.includes(MAKE_CLIP_ENDING));
        const kind = makeClipKind(mode, platform);
        expect(kind, `${platform} ${mode}`).toBe(resolved ? "template" : "start");
        if (kind === "start") starts.push(mode);
        for (let turn = 0; turn < 3; turn++) {
          const pick = makeClipPick(mode, platform, turn, "salt")!;
          expect(pick, `${platform} ${mode} ${turn}`).not.toBeNull();
          expect(pick.kind, `${platform} ${mode} ${turn}`).toBe(kind);
          expect(pick.mode, `${platform} ${mode} ${turn}`).toBe(mode);
          expect(makeClipPick(mode, platform, turn, "salt"), `${platform} ${mode} ${turn}`).toEqual(pick);
          if (pick.kind === "template") {
            const ids = makeClipTemplates(mode, platform).ids;
            expect(pick.template, `${platform} ${mode} ${turn}`).toBe(ids[turn % ids.length]);
            expect(own.map((t) => t.id), `${platform} ${mode} ${turn}`).toContain(pick.template);
            expect(templatePlayOf(ids[0])!.endings, `${platform} ${mode}`).toContain(MAKE_CLIP_ENDING);
          } else {
            expect(pick.settings, `${platform} ${mode} ${turn}`).toEqual(startSettings(mode));
            expect(pick.find, `${platform} ${mode} ${turn}`).toEqual(makeClipFind(pick.settings, turn)); // (A-g4 review: the press's turn, Perfect Fit's next tilings)
            expect(Number.isInteger(pick.seed) && pick.seed > 0, `${platform} ${mode} ${turn}`).toBe(true);
          }
        }
      }
      expect([...starts].sort(), platform).toEqual([...START_MODES].sort());
    }
  });

  it("searches a start look at its own target, the page's own unless that is the page's 30 and no run comes near it", () => {
    for (const mode of START_MODES) {
      const s = startSettings(mode);
      const find = makeClipFind(s);
      if (MAKE_CLIP_AS_IS.has(mode)) {
        expect(find, mode).toBeNull();
        continue;
      }
      expect(find!.toleranceSec, mode).toBe(MAKE_CLIP_TOLERANCE_SEC);
      // (the run's length, but Perfect Fit's loop: the Find panel's own search on it, the most pieces on the floor)
      expect(find!.outcome, mode).toBe(mode === "perfectFit" ? "most-on-floor" : undefined);
      const own = clipPacingFindSec(s);
      if (mode === "drop" || mode === "landClaim") {
        expect(own, mode).toBe(DEFAULT_FIND_SEC);
        expect(find!.targetSec, mode).toBeLessThan(DEFAULT_FIND_SEC);
      } else expect(find!.targetSec, mode).toBe(own);
    }
  });

  it("finds a run of every start look it searches in the page's two worlds, and the fixed loops are what Find cannot search", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    vi.spyOn(Date, "now").mockReturnValue(20_261_128); // (the finder's seed base: one search, the same on every run of the test)
    for (const mode of START_MODES) {
      const s = startSettings(mode);
      const find = makeClipFind(s);
      for (const world of WORLDS) {
        if (!find) {
          // the Wave Tank's water reads as endless; Beat Machines' tune is one 20.4 s loop on every seed, not the page's 30
          const asIs = await pageFind(s, world, { targetSec: DEFAULT_FIND_SEC, toleranceSec: MAKE_CLIP_TOLERANCE_SEC });
          expect(asIs.found, `${mode} ${world.width}`).toBe(false);
          expect(asIs.endless === true || asIs.duration < s.recordingDuration, `${mode} ${world.width} ${JSON.stringify(asIs)}`).toBe(true);
          continue;
        }
        const result = await pageFind(s, world, find);
        expect(result.found, `${mode} ${world.width} ${JSON.stringify(result)}`).toBe(true);
        // (Perfect Fit's search picks the solution and fits whole loops of it to the clip; every other run lands within the tolerance)
        if (mode === "perfectFit") expect([result.outcome, result.duration <= find.targetSec], `${mode} ${world.width}`).toEqual(["most-on-floor", true]);
        else expect(Math.abs(result.duration - find.targetSec), `${mode} ${world.width}`).toBeLessThanOrEqual(find.toleranceSec + 1e-9);
      }
    }
  }, 60_000);

  // --- make-clip-start --- (A-g4 review) "Another clip" only where another clip can differ
  it("plays a fixed loop as it is on every press, and gives Perfect Fit's next presses the next solution seeds", async () => {
    for (const platform of BOT_PLATFORMS) {
      expect(MODE_IDS.filter((mode) => makeClipAsIs(mode, platform)), platform).toEqual(MODE_IDS.filter((mode) => MAKE_CLIP_AS_IS.has(mode)));
      for (const mode of START_MODES) {
        const bases = [0, 1, 2].map((turn) => {
          const pick = makeClipPick(mode, platform, turn, "salt")!;
          return pick.kind === "start" ? pick.find?.seedBase : pick.kind;
        });
        // (every other search draws its own seeds: the finder's base is the clock)
        expect(bases, `${platform} ${mode}`).toEqual(mode === "perfectFit" ? [undefined, 1 + PF_FINDER_TRIES, 1 + 2 * PF_FINDER_TRIES] : [undefined, undefined, undefined]);
      }
    }
    // the first press is the Find button's own search (seed 1 up), each next one another tiling
    const s = startSettings("perfectFit");
    const seeds: number[] = [];
    for (let turn = 0; turn < 3; turn++) {
      const find = makeClipFind(s, turn)!;
      const result = await pageFind(s, WORLDS[0], find);
      expect([turn, result.found, result.outcome], `${turn}`).toEqual([turn, true, "most-on-floor"]);
      expect(result.perfectFit!.seed, `${turn}`).toBeGreaterThanOrEqual(find.seedBase ?? 1);
      expect(result.perfectFit!.seed, `${turn}`).toBeLessThan((find.seedBase ?? 1) + PF_FINDER_TRIES);
      seeds.push(result.perfectFit!.seed);
    }
    expect(new Set(seeds).size, seeds.join()).toBe(3);
    expect(seeds[0]).toBe((await pageFind(s, WORLDS[0], { targetSec: makeClipFind(s)!.targetSec, toleranceSec: MAKE_CLIP_TOLERANCE_SEC, outcome: "most-on-floor" })).perfectFit!.seed);
  });

  it("leaves the templates as they are: a start clip plans none", () => {
    const before = JSON.stringify(readyTemplates("all").map((t) => [t.id, templatePlayOf(t.id)]));
    for (const platform of BOT_PLATFORMS) for (const mode of START_MODES) makeClipPick(mode, platform, 0, "salt");
    expect(JSON.stringify(readyTemplates("all").map((t) => [t.id, templatePlayOf(t.id)]))).toBe(before);
  });

  it("says what the press does in every locale: a start clip's own note, a fixed loop's, and no 'another mode' note left", () => {
    for (const messages of [en, pl, es]) {
      const studio = messages.SiteRedesign.studio as Record<string, string>;
      expect(studio.makeClipStartNote.length).toBeGreaterThan(20);
      expect(studio.makeClipStartNote).not.toBe(studio.makeClipNote);
      // (A-g4 review) a fixed loop's own note: it finds nothing, so it never says it does
      expect(studio.makeClipLoopNote.length).toBeGreaterThan(20);
      expect(new Set([studio.makeClipLoopNote, studio.makeClipStartNote, studio.makeClipNote]).size).toBe(3);
      expect(studio.makeClipOther).toBeUndefined();
      expect(studio.makeClipOtherShort).toBeUndefined();
    }
  });
});
