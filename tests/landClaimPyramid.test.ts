import { describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import {
  DEFAULT_LC_PYRAMID_SETTINGS,
  LCP_BLOCK_CEILING,
  LCP_CLEAR_ROOT_HZ,
  LCP_LAYER_STOPS,
  LCP_NOTES_PER_STEP,
  LCP_PRESET_IDS,
  LCP_ROOT_MIDI,
  LCP_SIZE_CEILING,
  LCP_SOLO_COLOR,
  LCP_SUMMIT_CHORD,
  LC_PYRAMID_RANGES,
  LcpRandom,
  LcpStepNotes,
  createLcpContact,
  lcPyramidBallsAfter,
  lcPyramidChimeFrequency,
  lcPyramidClipSec,
  lcPyramidContact,
  lcPyramidDegree,
  lcPyramidField,
  lcPyramidHeights,
  lcPyramidKnockFrequency,
  lcPyramidLayerColor,
  lcPyramidLoops,
  lcPyramidNaturalTotal,
  lcPyramidPresetPatch,
  lcPyramidRebuildLevel,
  lcPyramidRing,
  lcPyramidRingCells,
  lcPyramidRings,
  lcPyramidShownBlocks,
  lcPyramidShownHeight,
  lcPyramidStepOf,
  lcPyramidSummitCells,
  lcPyramidSummitHeight, // --- low-findings-2 ---
  lcPyramidTotal,
  readLcPyramidParams,
  writeLcPyramidParams,
  type LcPyramidSettingFields,
} from "@/lib/physics/landClaimPyramid";
import { DEFAULT_LAND_CLAIM_SETTINGS, LAND_CLAIM_RANGES, LC_HUD_BAND, landClaimSettingFields, landClaimSettingsOf, resolveLandClaimSettings, type LandClaimSettings } from "@/lib/physics/modes/landClaim";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { RANGES, defaultSettings, inactiveEngineKeys, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, runNeverFinishes, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, outcomeClipSec, outcomeFigure, outcomeHorizonMs, outcomeMatches, outcomeMiss, type RunSummary } from "@/lib/simulation/outcomes";
import { effectiveBallCount } from "@/lib/teams";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { degreeToMidi, inLoopScale } from "@/lib/audio/loopPitch";
import { LOOP_NOTES_PER_TICK } from "@/lib/audio/loopTones";
import { loopPlayOptions } from "@/lib/audio/loopEvents";
import { midiToFrequency } from "@/lib/audio/scales";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { HUD_LINE_HALF, loopHudCount, loopHudFrame, loopHudLayout, loopHudStackShare, stackLoopHudBelow, subtitleLines } from "@/lib/loop/hud"; // (--- low-findings-2 --- the stacked HUD)
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { lcPyramidLayout } from "@/components/simulator/landClaimPyramidRenderer";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- land-claim-pyramid --- Land Claim's pyramid layout (lib/physics/landClaimPyramid.ts and the `--- land-claim-pyramid ---`
 * block of lib/physics/modes/landClaim.ts): the settings and their URL, the height map and its scaling, the floor's contacts,
 * the knock-down (heights never negative, the multiply rule, the summit last, a 1,144-block run ending with 146 balls), the
 * loop (the seam restores the first frame, the next cycle replays the first), exact replays at 30/60/120 fps, the sounds through
 * the loop library, Find Simulation's "the summit falls last", the HUD and the messages.
 */

const config: PhysicsConfig = {
  width: 720,
  height: 1280,
  gravity: 0,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 8,
  audioIntensity: 0,
};

const modeSettings: ModeSettings = {
  bouncierEnabled: false,
  countdownTotal: 10,
  countdownRandom: false,
  colorMatchColorCount: 7,
  accumulationTimerMax: 4000,
  spikesEnabled: false,
  spikeCount: 6,
  multiplySpawnCount: 3,
  shatterSegmentsPerWall: 18,
  shatterHpPerSegment: 1,
  growRate: 5,
  portalCount: 3,
  twoBalls: false,
  drop: {},
  box: {},
};

const STEP = 1000 / 60;
/** The clip's pyramid: 11 × 11, six steps scaled to 1,144 blocks, one competitor of three balls, a new ball every eighth block. */
const CLIP: Partial<LandClaimSettings> = { layout: "pyramid", pyramidSize: 11, steps: 6, blocks: 1144, teams: 1, balls: 3, every: 8, duration: 60 };

function pyramid(settings: Partial<LandClaimSettings> = {}, seed = 42, cfg: PhysicsConfig = config): PhysicsEngine {
  return createEngineForSettings(cfg, "landClaim", { ...modeSettings, landClaim: { ...CLIP, ...settings } }, seed);
}

/** Steps `engine` until `until` holds (or `maxSec` passed); the sound events on the way. */
function runUntil(engine: PhysicsEngine, until: (engine: PhysicsEngine) => boolean, maxSec = 90): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (let i = 0; i < (maxSec * 1000) / STEP && !until(engine); i++) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
  }
  return events;
}

/* ------------------------------------------------------------------ settings */

describe("Land Claim pyramid: settings", () => {
  it("keeps the wall as the default layout (old runs replay) and the clip's pyramid as the pyramid's defaults", () => {
    expect(DEFAULT_LAND_CLAIM_SETTINGS.layout).toBe("wall");
    expect(DEFAULT_LC_PYRAMID_SETTINGS).toEqual({ layout: "wall", pyramidSize: 11, steps: 6, blocks: 1144, rebuild: false, rebuildSec: 2.5 });
    const d = defaultSettings("landClaim");
    expect([d.lcLayout, d.lcPyramidSize, d.lcSteps, d.lcBlocks, d.lcRebuild, d.lcRebuildSec]).toEqual(["wall", 11, 6, 1144, false, 2.5]);
    expect(landClaimSettingsOf(landClaimSettingFields(DEFAULT_LAND_CLAIM_SETTINGS))).toEqual(DEFAULT_LAND_CLAIM_SETTINGS);
    // the comfort ranges are the page's (and Land Claim's)
    for (const [key, range] of Object.entries(LC_PYRAMID_RANGES)) {
      expect([key, (RANGES as Record<string, unknown>)[key]]).toEqual([key, range]);
      expect([key, (LAND_CLAIM_RANGES as Record<string, unknown>)[key]]).toEqual([key, range]);
    }
    // the memory-safety ceilings are the uncap module's
    expect([MEMORY_CEILINGS.lcPyramidSize, MEMORY_CEILINGS.lcBlocks]).toEqual([LCP_SIZE_CEILING, LCP_BLOCK_CEILING]);
    // the defaults write nothing into a link
    const keys = ["lcl", "lcg", "lcs", "lcbk", "lcrb", "lcrs"];
    expect([...settingsToSearchParams(defaultSettings("landClaim")).keys()].filter((k) => keys.includes(k))).toEqual([]);
  });

  it("round-trips through links, presets and the resolver; invalid values fall back, small ones lift onto the minimum, no maximum", () => {
    const s = { ...defaultSettings("landClaim"), lcLayout: "pyramid" as const, lcPyramidSize: 25, lcSteps: 9, lcBlocks: 4321, lcRebuild: true, lcRebuildSec: 3.7, lcTeams: 1 };
    const params = settingsToSearchParams(s);
    expect(["lcl", "lcg", "lcs", "lcbk", "lcrb", "lcrs"].filter((key) => !params.has(key))).toEqual([]);
    const back = settingsFromSearchParams(params);
    expect([back.lcLayout, back.lcPyramidSize, back.lcSteps, back.lcBlocks, back.lcRebuild, back.lcRebuildSec, back.lcTeams]).toEqual(["pyramid", 25, 9, 4321, true, 3.7, 1]);
    expect(presetToSettings(JSON.parse(JSON.stringify(s)))).toMatchObject({ lcLayout: "pyramid", lcPyramidSize: 25, lcBlocks: 4321, lcRebuild: true, lcTeams: 1 });
    // invalid values fall back, a value below its slider is lifted onto it, a big one is kept (the memory ceilings aside)
    const bad = settingsFromSearchParams(new URLSearchParams("mode=landClaim&lcl=cube&lcg=1&lcs=-4&lcbk=abc&lcrb=maybe&lcrs=0"));
    expect([bad.lcLayout, bad.lcPyramidSize, bad.lcSteps, bad.lcBlocks, bad.lcRebuild, bad.lcRebuildSec]).toEqual(["wall", 3, 1, 1144, false, 0.1]);
    // far past every slider: the page and the link keep the typed values, the run builds at the memory-safety ceilings
    const far = settingsFromSearchParams(new URLSearchParams("mode=landClaim&lcl=pyramid&lcg=5000&lcs=1e6&lcbk=1e9"));
    expect([far.lcPyramidSize, far.lcSteps, far.lcBlocks]).toEqual([5000, 1e6, 1e9]);
    expect(landClaimSettingsOf(far)).toMatchObject({ pyramidSize: LCP_SIZE_CEILING, steps: 1e6, blocks: LCP_BLOCK_CEILING });
    expect(pastAnyMemoryCeiling(far)).toBe(true);
    expect(pastAnyMemoryCeiling({ ...far, lcLayout: "wall" })).toBe(false); // (a wall run builds no pyramid)
    // one competitor plays a pyramid; the wall's battles start at two
    expect(resolveLandClaimSettings({ layout: "pyramid", teams: 1 }).teams).toBe(1);
    expect(resolveLandClaimSettings({ layout: "pyramid", teams: 0 }).teams).toBe(1);
    expect(resolveLandClaimSettings({ layout: "wall", teams: 1 }).teams).toBe(2);
    // the writer and the reader on their own
    const base = landClaimSettingFields(DEFAULT_LAND_CLAIM_SETTINGS) as LcPyramidSettingFields;
    const p = new URLSearchParams();
    writeLcPyramidParams({ ...base, lcLayout: "pyramid", lcBlocks: 0 }, base, p);
    expect(p.toString()).toBe("lcl=pyramid&lcbk=0");
    const next: Partial<LcPyramidSettingFields> = {};
    readLcPyramidParams(new URLSearchParams("lcl=pyramid&lcg=7&lcrb=1"), next);
    expect(next).toEqual({ lcLayout: "pyramid", lcPyramidSize: 7, lcRebuild: true });
  });

  it("plays one competitor alone as one ball to name (no battle verdict to search), and reads only the built layout's numbers", () => {
    const solo = { ...defaultSettings("landClaim"), lcLayout: "pyramid" as const, lcTeams: 1 };
    expect(effectiveBallCount(solo)).toBe(1);
    expect(effectiveBallCount({ ...solo, lcTeams: 3 })).toBe(3);
    expect(effectiveBallCount({ ...solo, lcLayout: "wall" })).toBe(2);
    // a wall run reads none of the pyramid's numbers, a pyramid run none of the wall's columns and rows
    expect([...inactiveEngineKeys({ mode: "landClaim", dpFan: false, lcLayout: "wall" })].sort()).toEqual(Object.keys(LC_PYRAMID_RANGES).sort());
    expect([...inactiveEngineKeys({ mode: "landClaim", dpFan: false, lcLayout: "pyramid" })].sort()).toEqual(["lcCols", "lcRows"]);
  });

  it("has the clip's preset: an 11 × 11 pyramid of 1,144 blocks, played alone, looping, with the loop HUD on a navy page", () => {
    expect(LCP_PRESET_IDS).toEqual(["pyramid1144"]);
    const patch = lcPyramidPresetPatch("pyramid1144");
    expect(patch).toMatchObject({ lcLayout: "pyramid", lcPyramidSize: 11, lcSteps: 6, lcBlocks: 1144, lcRebuild: true, lcTeams: 1, lcBalls: 3, lcEvery: 8, lcHud: false, loopHud: true, cinematicEnabled: false, teams: [] });
    expect(patch.backgroundColors).toEqual(["#0b1020", "#0b1020"]);
    expect(patch.recordingDuration).toBe(lcPyramidClipSec(patch.lcDuration, patch.lcRebuildSec));
    const s = presetToSettings({ ...defaultSettings("landClaim"), ...patch }) as SimulatorSettings;
    expect([s.lcLayout, s.lcTeams, s.loopHud, s.lcRebuild]).toEqual(["pyramid", 1, true, true]);
    expect(lcPyramidLoops(landClaimSettingsOf(s))).toBe(true);
  });
});

/* ------------------------------------------------------------------ the height map */

describe("Land Claim pyramid: the height map", () => {
  it("stands each column at steps minus its Chebyshev distance to the centre (the block count matches the formula)", () => {
    expect(lcPyramidRing(5, 5, 11)).toBe(0);
    expect([lcPyramidRing(0, 0, 11), lcPyramidRing(10, 5, 11), lcPyramidRing(4, 6, 11)]).toEqual([5, 5, 1]);
    expect([lcPyramidRings(11), lcPyramidRings(10), lcPyramidRings(3)]).toEqual([6, 5, 2]);
    expect([0, 1, 2, 5].map((r) => lcPyramidRingCells(11, r))).toEqual([1, 8, 16, 40]);
    expect([0, 1, 4].map((r) => lcPyramidRingCells(10, r))).toEqual([4, 12, 36]);
    for (const [g, s] of [[11, 6], [13, 7], [10, 5], [7, 9], [3, 1], [40, 12]] as const) {
      const natural = lcPyramidHeights(g, s, 0);
      let formula = 0;
      for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) formula += Math.max(0, s - lcPyramidRing(i, j, g));
      expect([g, s, lcPyramidTotal(natural)]).toEqual([g, s, formula]);
      expect(lcPyramidNaturalTotal(g, s)).toBe(formula);
      // every ring's columns stand alike; the summit stands tallest
      for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) expect(natural[j * g + i]).toBe(Math.max(0, s - lcPyramidRing(i, j, g)));
    }
    // the ring sizes add up to the grid
    for (const g of [3, 4, 10, 11, 40]) {
      let cells = 0;
      for (let r = 0; r < lcPyramidRings(g); r++) cells += lcPyramidRingCells(g, r);
      expect([g, cells]).toEqual([g, g * g]);
    }
  });

  it("scales the steps to exactly the blocks asked for, an inner ring never lower than an outer one", () => {
    // the clip: 286 natural blocks × 4 = 1,144 – six steps of four blocks, the summit 24 high
    const clip = lcPyramidHeights(11, 6, 1144);
    expect(lcPyramidTotal(clip)).toBe(1144);
    expect(lcPyramidNaturalTotal(11, 6)).toBe(286);
    expect(Math.max(...clip)).toBe(24);
    expect(clip[5 * 11 + 5]).toBe(24);
    expect(clip[0]).toBe(4);
    for (const [g, s, b] of [[11, 6, 1144], [11, 6, 1000], [13, 7, 1144], [10, 5, 999], [7, 3, 10], [9, 9, 1], [40, 20, 20_000], [12, 4, 777], [5, 2, 100_000]] as const) {
      const h = lcPyramidHeights(g, s, b);
      expect([g, s, b, lcPyramidTotal(h)]).toEqual([g, s, b, b]);
      for (let j = 0; j < g; j++) {
        for (let i = 0; i < g; i++) {
          const r = lcPyramidRing(i, j, g);
          // never below a column further out
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= g || jj >= g || lcPyramidRing(ii, jj, g) <= r) continue;
            expect(h[j * g + i]).toBeGreaterThanOrEqual(h[jj * g + ii]);
          }
          expect(h[j * g + i]).toBeGreaterThanOrEqual(0);
        }
      }
    }
    // a natural pyramid past the block ceiling is scaled down to it
    expect(lcPyramidTotal(lcPyramidHeights(1000, 1000, 0))).toBe(LCP_BLOCK_CEILING);
    expect(lcPyramidSummitCells(11)).toEqual(Int32Array.from([60]));
    expect(Array.from(lcPyramidSummitCells(10))).toEqual([44, 45, 54, 55]);
  });

  it("counts the balls the multiply rule adds: the start plus one every eighth block", () => {
    expect(lcPyramidBallsAfter(3, 1144, 8)).toBe(146);
    expect(lcPyramidBallsAfter(3, 7, 8)).toBe(3);
    expect(lcPyramidBallsAfter(3, 8, 8)).toBe(4);
    expect(lcPyramidBallsAfter(4, 1000, 0)).toBe(4);
  });
});

/* ------------------------------------------------------------------ the floor */

describe("Land Claim pyramid: the floor and its columns", () => {
  it("lays the floor and the grid out in the centred square, the same on any canvas", () => {
    const f = lcPyramidField(720, 1280, 11);
    expect([f.side, f.cx, f.cy, f.floor, f.half]).toEqual([720, 360, 640, 360, 180]);
    expect(f.cell * 11).toBeCloseTo(0.62 * 360, 9);
    expect(f.gx0).toBeCloseTo((-0.62 * 360) / 2, 9);
  });

  it("finds the deepest contact with the walls and the standing columns – a ball inside a column leaves by its nearest face", () => {
    const f = lcPyramidField(800, 800, 11);
    const heights = lcPyramidHeights(11, 6, 0);
    const c = createLcpContact();
    // the open floor: nothing
    expect(lcPyramidContact(f, heights, -f.half + 20, 0, 5, c)).toBe(false);
    // the left wall
    expect(lcPyramidContact(f, heights, -f.half + 3, 0, 5, c)).toBe(true);
    expect([c.nx, c.ny, c.cell, c.depth]).toEqual([1, 0, -1, 2]);
    // the left face of the left-middle column (i = 0, j = 5)
    const x = f.gx0 - 4;
    const y = f.gx0 + 5.5 * f.cell;
    expect(lcPyramidContact(f, heights, x, y, 5, c)).toBe(true);
    expect([c.nx, c.ny, c.cell]).toEqual([-1, 0, 5 * 11]);
    expect(c.depth).toBeCloseTo(1, 9);
    // a corner: the normal points away from it
    expect(lcPyramidContact(f, heights, f.gx0 - 3, f.gx0 - 3, 5, c)).toBe(true);
    expect(c.cell).toBe(0);
    expect(c.nx).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(c.ny).toBeCloseTo(-Math.SQRT1_2, 9);
    // inside a column: out through its nearest face
    expect(lcPyramidContact(f, heights, f.gx0 + 1, f.gx0 + 0.5 * f.cell, 2, c)).toBe(true);
    expect([c.nx, c.ny, c.cell]).toEqual([-1, 0, 0]);
    expect(c.depth).toBeCloseTo(3, 9);
    // a column knocked bare is floor
    const bare = Int32Array.from(heights);
    bare[0] = 0;
    expect(lcPyramidContact(f, bare, f.gx0 + 1, f.gx0 + 0.5 * f.cell, 2, c)).toBe(false);
  });
});

/* ------------------------------------------------------------------ the run */

describe("Land Claim pyramid: the knock-down", () => {
  it("starts the balls at the floor's corners heading for the pyramid, in the clip's yellow when played alone", () => {
    const engine = pyramid();
    const v = engine.getLandClaimView();
    const p = v.pyramid!;
    const f = p.field;
    const balls = engine.getBalls();
    expect(balls).toHaveLength(3);
    expect([v.teams, v.total, v.remaining, p.total, p.maxRows, p.startBalls, v.cols, v.rows]).toEqual([1, 1144, 1144, 1144, 24, 3, 121, 24]);
    for (const b of balls) {
      const x = b.x - f.cx;
      const y = b.y - f.cy;
      expect(Math.min(f.half - Math.abs(x), f.half - Math.abs(y))).toBeLessThan(3 * b.radius); // near a corner
      expect(Math.min(Math.abs(x), Math.abs(y))).toBeGreaterThan(-f.gx0); // off the pyramid
      expect(x * b.vx + y * b.vy).toBeLessThan(0); // heading inwards
      expect(b.color).toBe(LCP_SOLO_COLOR);
    }
  });

  it("never lets a column's height go negative; the blocks left are the heights' sum; the multiply count after B blocks is start + floor(B / 8)", { timeout: 30_000 }, () => {
    const engine = pyramid({}, 3);
    const v = engine.getLandClaimView();
    let checked = 0;
    runUntil(engine, (e) => {
      const view = e.getLandClaimView();
      let sum = 0;
      for (let k = 0; k < view.heights.length; k++) {
        expect(view.heights[k]).toBeGreaterThanOrEqual(0);
        sum += view.heights[k];
      }
      expect(sum).toBe(view.remaining);
      expect(e.getBalls().length).toBe(lcPyramidBallsAfter(3, view.knocks, 8));
      checked++;
      return view.finished;
    });
    expect(checked).toBeGreaterThan(100);
    expect([v.finished, v.remaining, v.knocks, v.spawns, engine.getBalls().length]).toEqual([true, 0, 1144, 143, 146]);
  });

  it("ends a 1,144-block run with 0 blocks and 146 balls, the summit last – its impact, then the clear's chord, the plucks in budget", { timeout: 30_000 }, () => {
    const engine = pyramid({}, 11);
    const v = engine.getLandClaimView();
    const p = v.pyramid!;
    let perStep = 0;
    const events: SoundEvent[] = [];
    for (let i = 0; i < 90 * 60 && !v.finished; i++) {
      engine.update(STEP, 0);
      const step = engine.consumeSoundEvents();
      perStep = Math.max(perStep, step.filter((e) => e.loop === "pluck").length);
      events.push(...step);
    }
    expect([v.finished, v.remaining, engine.getBalls().length, p.firstEndBalls, p.end]).toEqual([true, 0, 146, 146, "cleared"]);
    expect(p.firstSummitLeft).toBe(0);
    expect(p.firstSummitSec).toBeCloseTo(p.firstClearSec, 9);
    expect(p.firstClearSec).toBeGreaterThan(10);
    expect(p.firstClearSec).toBeLessThan(45);
    expect(perStep).toBeLessThanOrEqual(LCP_NOTES_PER_STEP);
    const plucks = events.filter((e) => e.loop === "pluck");
    expect(plucks.length).toBeGreaterThan(400);
    expect(plucks.every((e) => e.melody === false && inLoopScale(69 + 12 * Math.log2(e.frequency! / 440), LCP_ROOT_MIDI) && (e.level ?? 0) >= 0.8)).toBe(true);
    expect(events.filter((e) => e.loop === "chime").length).toBeGreaterThan(30);
    expect(events.filter((e) => e.loop === "impact")).toHaveLength(1);
    expect(events.find((e) => e.loop === "impact")?.chord).toEqual([...LCP_SUMMIT_CHORD]);
    const chords = events.filter((e) => e.loop === "chord");
    expect(chords).toHaveLength(1);
    expect([chords[0].frequency, chords[0].loopMinor]).toEqual([LCP_CLEAR_ROOT_HZ, false]);
    expect(events.findIndex((e) => e.loop === "impact")).toBeLessThan(events.findIndex((e) => e.loop === "chord"));
    // no wall sound of the battles, no glide without the loop
    expect(events.some((e) => e.lcSound !== undefined || e.loop === "glide" || e.loop === "cut")).toBe(false);
  });

  it("knocks the outer steps first and the summit last in most runs (the stated payoff)", { timeout: 60_000 }, () => {
    let last = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const engine = pyramid({}, seed);
      runUntil(engine, (e) => e.getLandClaimView().finished);
      if (engine.getLandClaimView().pyramid!.firstSummitLeft === 0) last++;
    }
    expect(last).toBeGreaterThanOrEqual(4);
  });

  // --- review fix (land-claim-pyramid) --- the smoke suite plays the "Pyramid, 1,144 blocks" preset's link on this seed
  // (scripts/smoke-test.mjs, the land-claim-pyramid block): the summit falls last in most runs, not all – 11 of the seeds 1-300 of
  // this test's world knock it down with blocks still standing –, so its check of the summit last needs a seed that has it, which a
  // fresh draw need not. The page plays it in its own world, where that check proves it.
  it("knocks the summit down last on the smoke suite's seed, which a fresh draw need not", { timeout: 30_000 }, () => {
    const SMOKE_LCP_SEED = 12345;
    const summitLeft = (seed: number) => {
      const engine = pyramid({}, seed);
      runUntil(engine, (e) => e.getLandClaimView().finished);
      return engine.getLandClaimView().pyramid!.firstSummitLeft;
    };
    expect(summitLeft(SMOKE_LCP_SEED)).toBe(0);
    // a draw whose summit falls with five blocks still standing
    expect(summitLeft(56)).toBe(5);
  });

  it("replays a seed exactly – the same knock-down at 30, 60 and 120 frames a second (a pinned fingerprint)", { timeout: 30_000 }, () => {
    function fnv(bytes: Uint8Array, h = 0x811c9dc5) {
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h;
    }
    function fingerprint(patch: Partial<SimulatorSettings>, frameMs: number) {
      const s = { ...defaultSettings("landClaim"), lcLayout: "pyramid", lcTeams: 1, lcBalls: 3, ...patch } as SimulatorSettings;
      const engine = createEngineForSettings(physicsConfigOfSettings(s, { width: 800, height: 800 }), "landClaim", modeSettingsOfSettings(s), 7);
      let sounds = 0;
      for (let i = 0; i < Math.round(6000 / frameMs); i++) {
        engine.update(frameMs, 0);
        sounds += engine.consumeSoundEvents().length;
      }
      const v = engine.getLandClaimView();
      const state = new Float64Array(engine.getBalls().flatMap((b) => [b.id, b.x, b.y, b.vx, b.vy, b.radius]));
      return { heights: fnv(new Uint8Array(v.heights.buffer.slice(0))), balls: fnv(new Uint8Array(state.buffer)), land: Array.from(v.land).join(","), events: [v.knocks, v.spawns, v.kos, v.bounces, v.collisions, v.notes, sounds].join(",") };
    }
    const pinned: [Partial<SimulatorSettings>, ReturnType<typeof fingerprint>][] = [
      [{}, PINNED_SOLO],
      [{ lcTeams: 3, lcBalls: 2, lcPyramidSize: 9, lcSteps: 5, lcBlocks: 0 }, PINNED_TRIO],
    ];
    for (const [patch, expected] of pinned) {
      expect(fingerprint(patch, 1000 / 60)).toEqual(expected);
      expect(fingerprint(patch, 1000 / 30)).toEqual(expected);
      expect(fingerprint(patch, 1000 / 120)).toEqual(expected);
    }
  });

  it("follows a resize: the floor stays in the centred square and every ball on it", () => {
    const engine = pyramid({}, 8);
    for (let i = 0; i < 120; i++) engine.update(STEP, 0);
    engine.setConfig({ ...config, width: 400, height: 700 });
    for (let i = 0; i < 60; i++) engine.update(STEP, 0);
    const p = engine.getLandClaimView().pyramid!;
    expect([p.field.side, p.field.cx, p.field.cy]).toEqual([400, 200, 350]);
    for (const b of engine.getBalls()) {
      expect(Math.abs(b.x - p.field.cx) + b.radius).toBeLessThanOrEqual(p.field.half + 0.5);
      expect(Math.abs(b.y - p.field.cy) + b.radius).toBeLessThanOrEqual(p.field.half + 0.5);
    }
  });
});

/* ------------------------------------------------------------------ the loop */

describe("Land Claim pyramid: rebuild and loop", () => {
  it("holds, rebuilds and starts over from its first frame at the seam; the next cycle replays the first", { timeout: 60_000 }, () => {
    const engine = pyramid({ rebuild: true, rebuildSec: 2 }, 5);
    const v = engine.getLandClaimView();
    const p = v.pyramid!;
    const state = (e: PhysicsEngine) => e.getBalls().map((b) => [b.id, b.x, b.y, b.vx, b.vy, b.radius]);
    expect(engine.getLoopSeams()).toEqual({ count: 0, lastMs: -1, nextMs: -1 });
    expect(engine.getCycleSeconds()).toBeNull();
    // the first frame's first step, then the cycle's first 5 s, recorded
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
    const firstStep = state(engine);
    const probe = (e: PhysicsEngine) => e.getBalls().map((b) => [b.x, b.y, b.vx, b.vy]);
    for (let i = 1; i < 300; i++) engine.update(STEP, 0);
    const at5 = probe(engine);
    const knocks5 = v.knocks;
    const events = runUntil(engine, () => p.phase === "hold", 90);
    expect(p.end).toBe("cleared");
    const seams = engine.getLoopSeams()!;
    expect(seams.count).toBe(0);
    expect(seams.nextMs).toBeCloseTo(p.clearMs + 1000 * (0.9 + 2), 0);
    expect(v.finished).toBe(false);
    events.push(...runUntil(engine, () => p.phase === "rebuild", 5));
    // the rebuild: the columns rise again, the HUD counts back up, the added balls melt away
    events.push(...runUntil(engine, () => p.progress > 0.5, 5));
    expect(p.shown).toBeGreaterThan(0);
    expect(p.shown).toBeLessThan(1144);
    events.push(...runUntil(engine, () => p.seams > 0, 5));
    expect(p.seams).toBe(1);
    expect(p.cycleSec).toBeCloseTo((seams.nextMs - 0) / 1000, 6);
    expect(engine.getCycleSeconds()).toBeCloseTo(p.cycleSec, 9);
    // the seam is the first frame again: the step that crossed it moved the balls exactly as the run's first step did
    const seamStep = state(engine);
    expect(seamStep.length).toBe(firstStep.length);
    for (let i = 0; i < seamStep.length; i++) for (let k = 0; k < 6; k++) expect(seamStep[i][k]).toBeCloseTo(firstStep[i][k], 9);
    expect([v.remaining, v.knocks, v.spawns, p.phase, p.shown]).toEqual([1144, 0, 0, "knock", 1144]);
    expect(Array.from(v.heights)).toEqual(Array.from(lcPyramidHeights(11, 6, 1144)));
    // the reset's sounds: the glide and the wash at the rebuild, the hard cut at the seam
    const at = (kind: string) => events.findIndex((e) => e.loop === kind);
    expect(at("chord")).toBeLessThan(at("glide"));
    expect(at("glide")).toBeLessThan(at("cut"));
    expect(events.find((e) => e.loop === "glide")).toMatchObject({ loopSec: 2, loopTo: lcPyramidKnockFrequency(0, 24) });
    expect(events.find((e) => e.loop === "wash")?.loopSec).toBe(2);
    // the next cycle replays the first (the seam's step was its first step)
    const seamMs = p.lastSeamMs;
    for (let i = 1; i < 300; i++) engine.update(STEP, 0);
    expect(engine.getElapsedMs() - seamMs).toBeCloseTo(5000, 6);
    expect(v.knocks).toBe(knocks5);
    const again = probe(engine);
    expect(again.length).toBe(at5.length);
    for (let i = 0; i < again.length; i++) for (let k = 0; k < 4; k++) expect(again[i][k]).toBeCloseTo(at5[i][k], 6);
  });

  it("is a run that never ends: no length to search, the first cycle's summit to find", () => {
    const loop = resolveLandClaimSettings({ layout: "pyramid", rebuild: true });
    expect(lcPyramidLoops(loop)).toBe(true);
    expect(runNeverFinishes("landClaim", { ...modeSettings, landClaim: loop } as never)).toBe(true);
    expect(runNeverFinishes("landClaim", { ...modeSettings, landClaim: { layout: "pyramid" } } as never)).toBe(false);
    expect(runNeverFinishes("landClaim", { ...modeSettings, landClaim: {} } as never)).toBe(false);
  });
});

/* ------------------------------------------------------------------ Find Simulation */

describe("Land Claim pyramid: Find Simulation", () => {
  it("offers the summit falling last – with the length when the run ends, alone when it loops, besides the battle's outcomes", () => {
    expect(availableOutcomes("landClaim", { endless: false, neverEscape: false, ballCount: 1, lcPyramid: true })).toEqual(["duration", "summit-last"]);
    expect(availableOutcomes("landClaim", { endless: true, neverEscape: false, ballCount: 1, lcPyramid: true, lcPyramidLoop: true })).toEqual(["summit-last"]);
    expect(availableOutcomes("landClaim", { endless: false, neverEscape: false, ballCount: 3, lcPyramid: true })).toEqual(["duration", "winner", "close", "summit-last"]);
    expect(availableOutcomes("landClaim", { endless: true, neverEscape: false, ballCount: 3, lcPyramid: true, lcPyramidLoop: true })).toEqual(["summit-last"]);
    // the wall keeps its own
    expect(availableOutcomes("landClaim", { endless: false, neverEscape: false, ballCount: 4 })).toEqual(["duration", "winner", "close"]);
  });

  it("judges a run by the blocks still standing when the summit fell (0: it fell last)", () => {
    const run: RunSummary = { mode: "landClaim", durationMs: 25_000, finished: true, firstEscapeMs: -1, teams: [], summitLeft: 0, summitMs: 24_900 };
    const outcome = { kind: "summit-last" as const, clipSec: 30 };
    expect(outcomeMatches(outcome, run)).toBe(true);
    expect(outcomeMiss(outcome, run)).toBe(0);
    expect(outcomeMatches(outcome, { ...run, summitLeft: 12 })).toBe(false);
    expect(outcomeMiss(outcome, { ...run, summitLeft: 12 })).toBe(12);
    expect(outcomeFigure(outcome, { ...run, summitLeft: 12 })).toBe(12);
    expect(outcomeMiss(outcome, { ...run, summitLeft: -1, summitMs: -1 })).toBe(Infinity);
    expect(outcomeFigure(outcome, { ...run, summitLeft: -1 })).toBe(-1);
    expect(outcomeClipSec(outcome, run)).toBe(25);
    expect(outcomeClipSec(outcome, { ...run, finished: false, cycleMs: 27_400 })).toBeCloseTo(27.4, 9);
    expect(outcomeHorizonMs(outcome, 60_000)).toBe(60_000);
  });

  it("follows a seed's first cycle to the summit's fall: its time, the blocks left and – looping – the whole cycle", { timeout: 60_000 }, () => {
    const request = (rebuild: boolean): FinderRequest => ({ targetDurationSec: 30, toleranceSec: 1, maxSeeds: 1, maxSimTimeSec: 30, physicsConfig: config, mode: "landClaim", modeSettings: { ...modeSettings, landClaim: { ...CLIP, rebuild } } });
    const outcome = { kind: "summit-last" as const, clipSec: 30 };
    const ends = simulateOutcomeRun(9, request(false), outcome);
    expect(ends.finished).toBe(true);
    expect(ends.summitLeft).toBe(0);
    expect(ends.summitMs! / 1000).toBeCloseTo(ends.durationMs / 1000, 1);
    const loops = simulateOutcomeRun(9, request(true), outcome);
    expect(loops.finished).toBe(false);
    expect(loops.summitLeft).toBe(0);
    expect(loops.summitMs).toBeCloseTo(ends.summitMs!, 6);
    expect(loops.cycleMs! / 1000).toBeCloseTo(loops.summitMs! / 1000 + 0.9 + DEFAULT_LC_PYRAMID_SETTINGS.rebuildSec, 1);
    expect(outcomeClipSec(outcome, loops)).toBeCloseTo(loops.cycleMs! / 1000, 9);
  });
});

/* ------------------------------------------------------------------ sound */

describe("Land Claim pyramid: sound", () => {
  it("pitches a knock by its block's layer on C-major pentatonic from C3 (lower layers lower) and the chimes rising with the balls", () => {
    expect(LCP_NOTES_PER_STEP).toBe(LOOP_NOTES_PER_TICK);
    expect(lcPyramidKnockFrequency(0, 24)).toBeCloseTo(midiToFrequency(48), 9);
    expect(lcPyramidKnockFrequency(23, 24)).toBeCloseTo(midiToFrequency(degreeToMidi(12, 48)), 9);
    let previous = 0;
    for (let row = 0; row < 24; row++) {
      const f = lcPyramidKnockFrequency(row, 24);
      expect(f).toBeGreaterThanOrEqual(previous);
      expect(inLoopScale(69 + 12 * Math.log2(f / 440), 48)).toBe(true);
      previous = f;
    }
    expect(lcPyramidDegree(23, 24)).toBe(12);
    expect(lcPyramidChimeFrequency(3, 3, 146)).toBeCloseTo(midiToFrequency(degreeToMidi(5, 48)), 9);
    expect(lcPyramidChimeFrequency(146, 3, 146)).toBeGreaterThan(lcPyramidChimeFrequency(50, 3, 146));
  });

  it("merges a step's knocks into one note a degree (√n louder, at most twice), the lowest six degrees", () => {
    const notes = new LcpStepNotes();
    const out: [number, number][] = [];
    for (let k = 0; k < 4; k++) notes.add(0, 24, 1);
    for (let row = 0; row < 24; row += 2) notes.add(row, 24, 0);
    expect(notes.flush(LCP_NOTES_PER_STEP, (row, level) => out.push([row, level]))).toBe(6);
    expect(out[0]).toEqual([0, 2]);
    expect(out.slice(1).every(([, level]) => level === 0.8)).toBe(true);
    expect(notes.flush(6, () => out.push([-1, -1]))).toBe(0);
  });

  it("plays the pyramid's voices through the loop library (playLoop): the pluck, the chime, the summit's impact, the clear's chord, the reset", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    try {
      const tone = new ToneGenerator();
      await tone.start();
      tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
      graph.ctx.currentTime = 1;
      const pluck = lcPyramidKnockFrequency(8, 24);
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "pluck", frequency: pluck, level: 0.9, loopBright: true, melody: false }, () => undefined);
      expect(graph.oscillators.filter((o) => o.startAt === 1).map((o) => o.frequency)).toEqual(expect.arrayContaining([pluck, 2 * pluck]));
      graph.ctx.currentTime = 2;
      const before = graph.oscillators.length;
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "chime", frequency: lcPyramidChimeFrequency(40, 3, 146), level: 0.7, melody: false }, () => undefined);
      expect(graph.oscillators.length).toBeGreaterThan(before);
      graph.ctx.currentTime = 3;
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "impact", frequency: LCP_CLEAR_ROOT_HZ, chord: [...LCP_SUMMIT_CHORD], level: 1, melody: false }, () => undefined);
      const impact = graph.oscillators.filter((o) => o.startAt >= 3 && o.startAt < 4).map((o) => o.frequency);
      for (const f of LCP_SUMMIT_CHORD) expect(impact).toContain(f);
      graph.ctx.currentTime = 4;
      const chord: SoundEvent = { type: "hit", wallIndex: 0, loop: "chord", frequency: LCP_CLEAR_ROOT_HZ, level: 1, loopMinor: false, melody: false };
      playSoundEvent(tone, chord, () => undefined);
      expect(graph.oscillators.filter((o) => o.startAt >= 4 && o.startAt < 5).map((o) => o.frequency)).toContain(LCP_CLEAR_ROOT_HZ);
      expect(loopPlayOptions(chord)).toMatchObject({ minor: false });
      graph.ctx.currentTime = 5;
      const ramps = graph.ramps.length + graph.sources.length;
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "glide", frequency: 65.41, loopTo: 130.81, loopSec: 2.5, level: 0.8, melody: false }, () => undefined);
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "wash", loopSec: 2.5, level: 0.6, melody: false }, () => undefined);
      expect(graph.ramps.length + graph.sources.length).toBeGreaterThan(ramps);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ------------------------------------------------------------------ the picture, the HUD, the words */

describe("Land Claim pyramid: the picture and the words", () => {
  it("colours the layers teal at the base through green and yellow to the summit's orange", () => {
    expect(lcPyramidLayerColor(0, 6)).toBe(LCP_LAYER_STOPS[0]);
    expect(lcPyramidLayerColor(5, 6)).toBe(LCP_LAYER_STOPS[3]);
    expect(lcPyramidLayerColor(0, 1)).toBe(LCP_LAYER_STOPS[3]);
    expect([0, 3, 4, 23].map((row) => lcPyramidStepOf(row, 24, 6))).toEqual([0, 0, 1, 5]);
  });

  it("raises the columns in the rebuild from what they kept to their own heights, the HUD counting back up to the whole pyramid", () => {
    expect(lcPyramidRebuildLevel(0, 24)).toBe(0);
    expect(lcPyramidRebuildLevel(1, 24)).toBe(24);
    expect(lcPyramidRebuildLevel(0.85, 24)).toBe(24);
    expect(lcPyramidShownHeight(20, 0, 8)).toBe(8);
    expect(lcPyramidShownHeight(4, 0, 8)).toBe(4);
    expect(lcPyramidShownHeight(20, 12, 8)).toBe(12);
    const full = lcPyramidHeights(11, 6, 1144);
    const kept = new Int32Array(full.length);
    expect(lcPyramidShownBlocks(full, kept, 0)).toBe(0);
    expect(lcPyramidShownBlocks(full, kept, 24)).toBe(1144);
    expect(lcPyramidShownBlocks(full, kept, 4)).toBe(4 * 121);
  });

  it("fits the slab and the full pyramid into the exported square (90 % of its width, under the HUD band or within ±40 % of its middle)", () => {
    const engine = pyramid();
    const p = engine.getLandClaimView().pyramid!;
    for (const hud of [false, true]) {
      const L = lcPyramidLayout(p, hud);
      const side = p.field.side;
      expect(2 * Math.cos(Math.PI / 6) * p.field.floor * L.k).toBeLessThanOrEqual(0.9 * side + 1e-6);
      if (hud) expect(L.top).toBeGreaterThanOrEqual(p.field.cy - side / 2 + 0.2 * side - 1e-6);
      else {
        expect(L.top).toBeGreaterThanOrEqual(p.field.cy - 0.4 * side - 1e-6);
        expect(L.bottom).toBeLessThanOrEqual(p.field.cy + 0.4 * side + 1e-6);
      }
      expect(L.block).toBeGreaterThan(0);
    }
  });

  it("counts the blocks standing in the loop HUD, in grey", () => {
    const engine = pyramid();
    expect(loopHudCount(engine)).toBe(1144);
    const frame = loopHudFrame({ title: "a pyramid, one block at a time", subtitle: "", counter: String(en.LandClaim.pyramidCounter), counterGrey: true, light: false, locale: "en" }, 1144, "en");
    expect([frame.counter, frame.counterGrey]).toEqual(["1144 blocks", true]);
    expect(loopHudFrame({ title: "", subtitle: "", counter: String(pl.LandClaim.pyramidCounter), light: false, locale: "pl" }, 1144, "pl").counter).toBe("1144 bloki");
    expect(loopHudFrame({ title: "", subtitle: "", counter: String(es.LandClaim.pyramidCounter), light: false, locale: "es" }, 1, "es").counter).toBe("1 bloque");
  });

  it("has every word in English, Polish and Spanish", () => {
    const keys = {
      Controls: ["lcLayout", "lcLayoutTip", "lcLayoutWall", "lcLayoutPyramid", "lcpDesc", "lcPyramidSize", "lcPyramidSizeTip", "lcpGrid", "lcSteps", "lcStepsTip", "lcBlocks", "lcBlocksTip", "lcpBlocksN", "lcpBlocksNatural", "lcpSummary", "lcRebuild", "lcRebuildTip", "lcRebuildSec", "lcRebuildSecTip", "lcpLoopNote", "lcpEndNote", "lcPresetPyramid1144"],
      LandClaim: ["pyramidTitle", "pyramidSubtitle", "pyramidCounter"],
      Rigged: ["outcomeSummitLast", "hintSummitLast", "findSummitLast", "foundSummitLast", "missSummitLast", "missNoSummit", "overlaySummitLast", "overlayNoSummit"],
    } as const;
    for (const messages of [en, pl, es] as unknown as Record<string, Record<string, string>>[]) {
      for (const [ns, list] of Object.entries(keys)) for (const key of list) expect([ns, key, typeof messages[ns][key]]).toEqual([ns, key, "string"]);
    }
    expect(en.LandClaim.pyramidTitle).toBe("a pyramid, one block at a time");
    expect(JSON.stringify([en, pl, es]).toLowerCase()).not.toContain("bor" + "is");
  });

  it("draws from its own seeded generator: the same seed, the same stream", () => {
    const a = new LcpRandom(12345);
    const b = new LcpRandom(12345);
    const xs = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    b.state = 12345;
    expect(b.next()).toBe(xs[0]);
  });
});

// The pinned fingerprints of the replay test (6 s of a seed-7 run on an 800 × 800 canvas).
const PINNED_SOLO = { heights: 861028709, balls: 632650526, land: "82", events: "82,10,7,210,29,84,84" };
const PINNED_TRIO = { heights: 49887922, balls: 4130995091, land: "40,35,33", events: "108,13,61,292,67,115,115" };

/* ------------------------------------------------------------------ --- low-findings-2 --- */

describe("Land Claim pyramid: the summit of any size, the stacked HUDs, the competitors' words", () => {
  it("works the summit's height out for any Pyramid Size, the same as the built grid's tallest column", () => {
    const tallest = (g: number, s: number, b: number) => {
      const h = lcPyramidHeights(g, s, b);
      let top = 0;
      for (let k = 0; k < h.length; k++) top = Math.max(top, h[k]);
      return top;
    };
    for (const g of [1, 2, 3, 4, 7, 10, 11, 12, 25, 40]) {
      for (const st of [1, 2, 3, 6, 9, 30]) {
        for (const b of [0, 1, 3, 5, 17, 100, 1144, 5000, 40_000]) expect([g, st, b, lcPyramidSummitHeight(g, st, b)]).toEqual([g, st, b, tallest(g, st, b)]);
      }
    }
    // past the panel's 400 (which it does not build): the same as a built grid, never 0
    for (const [g, st, b] of [[401, 6, 0], [450, 200, 0], [420, 12, 1144], [401, 400, 0]] as const) expect([g, st, b, lcPyramidSummitHeight(g, st, b)]).toEqual([g, st, b, tallest(g, st, b)]);
    expect(lcPyramidSummitHeight(1000, 6, 0)).toBe(6);
    expect(lcPyramidSummitHeight(5000, 5000, 0)).toBeGreaterThan(0);
    expect(lcPyramidSummitHeight(1e9, 1e9, 0)).toBeGreaterThan(0);
    expect(lcPyramidSummitHeight(1e9, 13, 1144)).toBeGreaterThan(0);
    // the panel's line reads it (the summary's words take any count)
    for (const m of [en, pl, es]) expect((m.Controls as Record<string, string>).lcpSummary).toContain("{tallest");
  });

  it("stacks the loop HUD's title block under Land Claim's band in a square frame (a portrait frame's title stays above the square), and the pyramid under both", () => {
    const words = { title: en.LandClaim.pyramidTitle, subtitle: en.LandClaim.pyramidSubtitle };
    for (const [w, h] of [[1080, 1080], [1280, 720], [720, 720]]) {
      const plain = loopHudLayout(w, h);
      const stacked = loopHudLayout(w, h, LC_HUD_BAND);
      const side = Math.min(w, h);
      const sqTop = (h - side) / 2;
      const bandBottom = sqTop + LC_HUD_BAND * side;
      expect(plain.titleY - HUD_LINE_HALF * plain.titleSize).toBeLessThan(bandBottom); // (the overlap it fixes)
      expect(stacked.titleY - HUD_LINE_HALF * stacked.titleSize).toBeGreaterThanOrEqual(bandBottom - 1e-6);
      expect(stacked.subtitleY - stacked.ruleY).toBeCloseTo(plain.subtitleY - plain.ruleY, 9);
      expect([stacked.counterY, stacked.titleSize]).toEqual([plain.counterY, plain.titleSize]);
      // the block's bottom stays inside the room the pyramid leaves it (the share of the side under the band)
      const lines = subtitleLines(words.subtitle).length;
      const blockBottom = stacked.subtitleY + (lines - 1) * 1.2 * stacked.subtitleSize + HUD_LINE_HALF * stacked.subtitleSize;
      expect(blockBottom).toBeLessThanOrEqual(bandBottom + loopHudStackShare(words) * side + 1e-6 + 2);
    }
    // portrait (the clips' 9:16): the title sits in the bar above the square, untouched
    expect(loopHudLayout(1080, 1920, LC_HUD_BAND)).toEqual(loopHudLayout(1080, 1920));
    // stacking moves only a title that would cover the band, and never one left out
    const lower = { ...loopHudLayout(1080, 1080), titleY: 600 };
    expect(stackLoopHudBelow({ ...lower }, 216)).toEqual(lower);
    const out = { ...loopHudLayout(1080, 1080), titleY: -1, ruleY: -1, subtitleY: -1 };
    expect(stackLoopHudBelow({ ...out }, 216)).toEqual(out);
    expect(loopHudStackShare({ title: "", subtitle: "" })).toBe(0);
    expect(loopHudFrame({ title: "t", subtitle: "", counter: "", light: false, topBand: LC_HUD_BAND }, null).topBand).toBe(LC_HUD_BAND);
    // the pyramid under the band and the stacked block, still fitted to the square
    const p = pyramid().getLandClaimView().pyramid!;
    const share = loopHudStackShare(words);
    const alone = lcPyramidLayout(p, true);
    const both = lcPyramidLayout(p, true, undefined, share);
    const side = p.field.side;
    const sqTop = p.field.cy - side / 2;
    expect(both.top).toBeGreaterThanOrEqual(sqTop + (LC_HUD_BAND + share) * side - 1e-6);
    expect(both.top).toBeGreaterThan(alone.top);
    expect(both.bottom).toBeLessThanOrEqual(sqTop + side + 1e-6);
    expect(both.k).toBeGreaterThan(0);
    expect(lcPyramidLayout(p, true, undefined, 0)).toEqual(alone);
  });

  it("words the Competitors for the pyramid: from one, alone in yellow, in every language", () => {
    for (const m of [en, pl, es]) {
      const c = m.Controls as Record<string, string>;
      expect(c.lcTeamsTipPyramid).toMatch(/\b1\b/);
      expect(c.lcTeamsTipPyramid).toMatch(/12/);
      expect(c.lcpSoloNote).toContain("{name}");
      for (const text of [c.lcTeamsTipPyramid, c.lcpSoloNote]) expect(text).not.toMatch(/ – | — |;/);
    }
    expect(en.Controls.lcTeamsTip).toMatch(/2 to 12/);
    expect(en.Controls.lcTeamsTipPyramid).toMatch(/1 to 12/);
    expect(en.Controls.lcTeamsTipPyramid).toMatch(/yellow/);
  });
});
