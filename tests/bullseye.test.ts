import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BULLSEYE_RANGES,
  DEFAULT_BULLSEYE_SETTINGS,
  FINAL_HOLD_MS,
  KIND_BUMPER,
  MAX_FLIGHT_MS,
  KIND_PEG,
  KIND_WALL,
  MOVING_TARGET_AT,
  SHOT_LANDED,
  SLOW_MO_FACTOR,
  SLOW_MO_MS,
  SLOW_MO_RAMP_IN_MS,
  SLOW_MO_RAMP_OUT_MS,
  TARGET_AT,
  TARGET_PERIOD_SEC,
  bullHalfWidth,
  bullseyeNominalRunSec,
  bullseyeScale,
  bullseyeSettingsOf,
  buildBullseyeLayout,
  defaultBullseyeFields,
  fanfareRoot,
  pegPitch,
  perfectShotIndex,
  resolveBullseyeFields,
  resolveBullseyeSettings,
  ringAt,
  ringScore,
  scoreAt,
  slowMoScale,
  steerVx,
  targetOffset,
  targetVelocity,
  thudPitch,
  timeToFloor,
  type BullseyeSettings,
} from "@/lib/physics/modes/bullseye";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { SCALE_INTERVALS, frequencyToMidi, quantizeFrequency } from "@/lib/audio/scales";
import { DEFAULT_THUD_FREQUENCY, THUD_TONE, scheduleThudTone, thudBend, thudLevel } from "@/lib/audio/thudTone";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import type { PhysicsEngine } from "@/lib/physics/engine";

/**
 * Bullseye (feature gerald-bullseye): the settings / URL / presets, the scoring geometry (rings, scores, the bull), the
 * layout (the field in the recorder's square, the chaos selection of the deflectors), the moving target (and the balls
 * riding it), sticking and stacking, the slow motion of a bullseye, the rigged perfect shot, the sounds (peg notes,
 * thuds, the fanfare) and the thud's synthesis and dispatch, determinism, resizes and the seed finder.
 */

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
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

function bullseyeEngine(bullseye: Partial<BullseyeSettings> = {}, seed = 7, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "bullseye", { ...modeSettings, bullseye }, seed);
}

interface Timed {
  t: number;
  ev: SoundEvent;
}

/** Runs until the run finishes (or `maxSec`), collecting every sound event with its simulation time. */
function run(engine: PhysicsEngine, maxSec = 120, onStep?: (engine: PhysicsEngine) => void): { events: Timed[]; finishedAt: number } {
  const events: Timed[] = [];
  for (let i = 1; i <= maxSec * 60; i++) {
    engine.update(STEP, 0);
    onStep?.(engine);
    const t = engine.getElapsedMs() / 1000;
    for (const ev of engine.consumeSoundEvents()) events.push({ t, ev });
    if (engine.isSimulationFinished()) return { events, finishedAt: t };
  }
  return { events, finishedAt: -1 };
}

function scoresOf(engine: PhysicsEngine) {
  const v = engine.getBullseyeView();
  return Array.from(v.shotScore.slice(0, v.shots));
}

/* ------------------------------------------------------------------ settings */

describe("settings, URL and presets", () => {
  it("defaults and ranges", () => {
    expect(defaultBullseyeFields()).toEqual({ byShots: 12, byInterval: 2.2, byChaos: 0.5, byRings: 10, byTargetMoving: false, byPerfect: 0 });
    for (const key of Object.keys(BULLSEYE_RANGES) as (keyof typeof BULLSEYE_RANGES)[]) expect(RANGES[key]).toEqual(BULLSEYE_RANGES[key]);
    expect(BULLSEYE_RANGES.byShots).toMatchObject({ min: 1, max: 30 });
    expect(BULLSEYE_RANGES.byChaos).toMatchObject({ min: 0, max: 1 });
    expect(BULLSEYE_RANGES.byRings).toMatchObject({ min: 3, max: 10 });
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolveBullseyeFields(d)).toEqual(defaultBullseyeFields());
      const params = settingsToSearchParams(d);
      for (const key of ["bys", "byi", "byc", "byr", "bym", "byp"]) expect(params.has(key)).toBe(false);
    }
  });

  it("resolve clamps onto the sliders and drops bad values", () => {
    expect(resolveBullseyeSettings({ shots: 99, interval: 0.1, chaos: 1.7, rings: 2, perfect: -3 })).toMatchObject({ shots: 30, interval: 0.3, chaos: 1, rings: 3, perfect: 0 });
    expect(resolveBullseyeSettings({ shots: 4.6, interval: 1.234, chaos: 0.333, rings: 12, perfect: 7.6 })).toMatchObject({ shots: 5, interval: 1.2, chaos: 0.35, rings: 10, perfect: 8 });
    const junk = { shots: "many", moving: "yes", rings: null, scale: "klingon", rootNote: "x", perfect: "all" } as unknown as Partial<BullseyeSettings>;
    expect(resolveBullseyeSettings(junk)).toEqual(DEFAULT_BULLSEYE_SETTINGS);
    expect(resolveBullseyeSettings({ rootNote: 14 }).rootNote).toBe(2);
    expect(bullseyeSettingsOf({ ...defaultBullseyeFields(), scale: "minor", rootNote: 3 })).toMatchObject({ scale: "minor", rootNote: 3 });
  });

  it("round-trip through bys / byi / byc / byr / bym / byp and presets", () => {
    const s = { ...defaultSettings("bullseye"), byShots: 20, byInterval: 0.8, byChaos: 0.85, byRings: 6, byTargetMoving: true, byPerfect: 7 };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("bullseye");
    expect(params.get("bys")).toBe("20");
    expect(params.get("byi")).toBe("0.8");
    expect(params.get("byc")).toBe("0.85");
    expect(params.get("byr")).toBe("6");
    expect(params.get("bym")).toBe("1");
    expect(params.get("byp")).toBe("7");
    const back = settingsFromSearchParams(params);
    expect(back.mode).toBe("bullseye");
    expect(resolveBullseyeFields(back)).toEqual({ byShots: 20, byInterval: 0.8, byChaos: 0.85, byRings: 6, byTargetMoving: true, byPerfect: 7 });
    const bad = settingsFromSearchParams(new URLSearchParams("mode=bullseye&bys=500&byr=abc&bym=7&byi=0"));
    expect(resolveBullseyeFields(bad)).toEqual({ ...defaultBullseyeFields(), byShots: 30, byInterval: 0.3 });
    const preset = presetToSettings({ mode: "bullseye", byShots: 0, byTargetMoving: "no", byChaos: 9 } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(resolveBullseyeFields(preset)).toMatchObject({ byShots: 1, byTargetMoving: false, byChaos: 1 });
  });

  it("the mode is registered: a rhythm card of the Gerald family, right before the Sound Vortex", () => {
    expect(MODE_IDS).toContain("bullseye");
    expect(MODE_CATEGORIES.bullseye).toBe("rhythm");
    expect(MODE_CARD_ORDER).toContain("bullseye");
    const rhythm = modesInCategory("rhythm");
    expect(rhythm.indexOf("bullseye")).toBe(rhythm.indexOf("vortex") - 1);
    expect(rhythm.at(-1)).toBe("glass");
    expect(runNeverFinishes("bullseye", { drop: {}, box: {} })).toBe(false);
    expect(fixedRunDurationSec("bullseye", {})).toBeNull();
  });
});

/* ------------------------------------------------------------------ scoring geometry */

describe("scoring geometry", () => {
  it("scores 10 for the bull down to about 1 for the outermost ring, 0 off the target", () => {
    expect(Array.from({ length: 10 }, (_, i) => ringScore(i, 10))).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(Array.from({ length: 3 }, (_, i) => ringScore(i, 3))).toEqual([10, 7, 3]);
    expect(Array.from({ length: 5 }, (_, i) => ringScore(i, 5))).toEqual([10, 8, 6, 4, 2]);
    expect(ringScore(-1, 10)).toBe(0);
    expect(ringScore(10, 10)).toBe(0);
    for (let n = 3; n <= 10; n++) {
      for (let i = 1; i < n; i++) expect(ringScore(i, n)).toBeLessThan(ringScore(i - 1, n));
      expect(ringScore(n - 1, n)).toBeGreaterThanOrEqual(1);
    }
  });

  it("finds the ring of a landing by its distance from the centre, symmetric, the rim still on the target", () => {
    const R = 150;
    const w = bullHalfWidth(R, 10);
    expect(w).toBe(15);
    expect(ringAt(0, R, 10)).toBe(0);
    expect(ringAt(w - 1e-6, R, 10)).toBe(0);
    expect(ringAt(-(w - 1e-6), R, 10)).toBe(0);
    expect(ringAt(w, R, 10)).toBe(1);
    expect(ringAt(-R, R, 10)).toBe(9);
    expect(ringAt(R, R, 10)).toBe(9);
    expect(ringAt(R + 0.01, R, 10)).toBe(-1);
    expect(ringAt(Number.NaN, R, 10)).toBe(-1);
    expect(ringAt(10, 0, 10)).toBe(-1);
    for (let dx = -R; dx <= R; dx += 7.3) expect(ringAt(dx, R, 10)).toBe(ringAt(-dx, R, 10));
    expect(scoreAt(0.95 * R, R, 10)).toBe(1);
    expect(scoreAt(0.4 * R, R, 4)).toBe(8);
    expect(scoreAt(2 * R, R, 4)).toBe(0);
  });

  it("the flight maths: time to the floor and the director's steering", () => {
    expect(timeToFloor(0, 0, 200, 400)).toBeCloseTo(1, 12); // ½ · 400 · 1² = 200
    expect(timeToFloor(0, 100, 150, 0)).toBeCloseTo(1.5, 12);
    expect(timeToFloor(0, -10, 150, 0)).toBe(Infinity);
    expect(timeToFloor(300, 0, 200, 400)).toBe(0);
    expect(steerVx(0, 50, 100, 0.5, 10, true)).toBeCloseTo(200, 12);
    expect(steerVx(0, 50, 100, 0.5, 10, false)).toBeCloseTo(60, 12);
    expect(steerVx(0, 50, -100, 0.5, 10, false)).toBeCloseTo(40, 12);
    expect(steerVx(0, 50, 100, 0, 10, true)).toBe(50);
  });
});

/* ------------------------------------------------------------------ layout */

describe("the layout", () => {
  it("fits a portrait field in the recorder's square: launcher, deflector band, then the target at the bottom", () => {
    for (const [w, h] of [
      [800, 450],
      [800, 600],
      [1080, 1920],
      [500, 500],
    ]) {
      const L = buildBullseyeLayout(w, h, 8, 1, 1234);
      const square = Math.min(w, h);
      expect(L.fieldWidth).toBeLessThanOrEqual(0.82 * L.fieldHeight + 1e-9);
      expect(L.left).toBeGreaterThanOrEqual((w - square) / 2 - 1e-9);
      expect(L.right).toBeLessThanOrEqual((w + square) / 2 + 1e-9);
      expect(L.top).toBeLessThan(L.launchY);
      expect(L.launchY).toBeLessThan(L.bandTop);
      expect(L.bandBottom).toBeLessThan(L.floorY);
      expect(L.floorY + L.targetDepth).toBeLessThanOrEqual(L.bottom);
      expect(L.targetRadius).toBeCloseTo(TARGET_AT * L.fieldWidth, 9);
      expect(L.kinds[0]).toBe(KIND_WALL);
      expect(L.kinds[1]).toBe(KIND_WALL);
      expect(L.deflectors).toBe(L.candidates);
      expect(L.obstacles).toHaveLength(2 + L.deflectors);
      for (let i = 2; i < L.obstacles.length; i++) {
        const o = L.obstacles[i];
        expect([KIND_PEG, KIND_BUMPER]).toContain(L.kinds[i]);
        expect(o.y).toBeGreaterThanOrEqual(L.bandTop - 1e-9);
        expect(o.y).toBeLessThanOrEqual(L.bandBottom + 1e-9);
        expect(o.x).toBeGreaterThan(L.left);
        expect(o.x).toBeLessThan(L.right);
      }
    }
  });

  it("chaos keeps that share of the candidates – the seed's salt picks which, nested as chaos grows", () => {
    const at = (chaos: number, salt = 99) => buildBullseyeLayout(800, 600, 8, chaos, salt);
    const all = at(1);
    expect(at(0).obstacles).toHaveLength(2);
    expect(at(0.5).deflectors).toBe(Math.round(0.5 * all.candidates));
    const spots = (L: ReturnType<typeof at>) => new Set(L.obstacles.slice(2).map((o) => `${o.x.toFixed(3)},${o.y.toFixed(3)}`));
    const quarter = spots(at(0.25));
    const half = spots(at(0.5));
    for (const s of quarter) expect(half.has(s)).toBe(true);
    expect(spots(at(0.5, 99))).toEqual(half);
    expect(spots(at(0.5, 12345))).not.toEqual(half);
    expect(all.kinds.filter((k) => k === KIND_BUMPER).length).toBeGreaterThan(0);
  });

  it("a moving target is smaller, with room to slide", () => {
    const still = buildBullseyeLayout(800, 600, 8, 0.5, 1, false);
    const moving = buildBullseyeLayout(800, 600, 8, 0.5, 1, true);
    expect(moving.targetRadius).toBeCloseTo(MOVING_TARGET_AT * moving.fieldWidth, 9);
    expect(moving.amplitude).toBeGreaterThan(still.amplitude);
    expect(moving.cx + moving.amplitude + moving.targetRadius + 8).toBeLessThanOrEqual(moving.right);
  });
});

/* ------------------------------------------------------------------ the run */

describe("a run", () => {
  it("launches every shot on schedule; each lands, sticks, thuds once and scores by its ring", () => {
    const engine = bullseyeEngine({ shots: 8, interval: 0.6 }, 3);
    const launchedAt: number[] = [];
    const { events, finishedAt } = run(engine, 60, (e) => {
      const v = e.getBullseyeView();
      while (launchedAt.length < v.launched) launchedAt.push(e.getElapsedMs());
    });
    const v = engine.getBullseyeView();
    const L = v.layout!;
    expect(finishedAt).toBeGreaterThan(0);
    expect(v.landed).toBe(8);
    // Shot k leaves at k × interval of the world clock (the first at once; a bullseye's slow motion only delays the rest).
    expect(launchedAt[0]).toBeLessThanOrEqual(STEP + 1e-9);
    for (let k = 1; k < 8; k++) expect(launchedAt[k]).toBeGreaterThanOrEqual(k * 600 - 1e-6);
    const thuds = events.filter((e) => e.ev.thud);
    expect(thuds).toHaveLength(8);
    let total = 0;
    for (let k = 0; k < 8; k++) {
      expect(v.shotState[k]).toBe(SHOT_LANDED);
      const score = v.shotScore[k];
      total += score;
      expect(score).toBe(ringScore(v.shotRing[k], 10));
      expect(v.shotY[k]).toBeLessThanOrEqual(L.floorY - 8 + 1e-6);
    }
    expect(v.total).toBe(total);
    // One thud per landing, pitched by its score.
    const expected = Array.from({ length: 8 }, (_, k) => thudPitch(v.shotScore[k], "chromatic", 0)).sort((a, b) => a - b);
    expect(thuds.map((e) => e.ev.frequency!).sort((a, b) => a - b)).toEqual(expected);
    // The best shot is the highest score.
    expect(v.best).toBe(Math.max(...scoresOf(engine)));
    expect(v.shotScore[v.bestShot]).toBe(v.best);
    // Stuck balls stay put.
    const before = engine.getBalls().map((b) => [b.x, b.y]);
    for (let i = 0; i < 30; i++) engine.update(STEP, 0);
    expect(engine.getBalls().map((b) => [b.x, b.y])).toEqual(before);
    for (const b of engine.getBalls()) expect(b.gravityScale).toBe(0);
  });

  it("thuds are pitched by the ring, pegs play a keyboard of the scale, bullseyes a fanfare", () => {
    const engine = bullseyeEngine({ shots: 12, chaos: 1 }, 11);
    const { events } = run(engine, 90);
    const v = engine.getBullseyeView();
    const thuds = events.filter((e) => e.ev.thud);
    const scores = thuds.map((e) => thudPitchInverse(e.ev.frequency!));
    expect(scores.sort((a, b) => a - b)).toEqual(scoresOf(engine).sort((a, b) => a - b));
    for (let s = 1; s <= 10; s++) expect(thudPitch(s, "chromatic", 0)).toBeGreaterThan(thudPitch(s - 1, "chromatic", 0));
    const keyboard = new Set(Array.from({ length: 40 }, (_, slot) => pegPitch(slot, "chromatic", 0).toFixed(6)));
    const pegNotes = events.filter((e) => !e.ev.thud && !e.ev.race && e.ev.wallIndex !== 2);
    expect(pegNotes.length).toBeGreaterThan(0);
    for (const e of pegNotes) expect(keyboard.has(e.ev.frequency!.toFixed(6))).toBe(true);
    expect(pegNotes.some((e) => e.ev.accent)).toBe(true); // a bumper
    const fanfares = events.filter((e) => e.ev.race === "fanfare");
    expect(fanfares).toHaveLength(v.bullseyes);
    for (const f of fanfares) expect(f.ev.frequency).toBeCloseTo(fanfareRoot(0), 9);
    // Peg notes follow the Sound section's scale (a diatonic major while chromatic).
    const steps = bullseyeScale("chromatic");
    expect(steps).toEqual(SCALE_INTERVALS.major);
    expect(Math.round(frequencyToMidi(pegPitch(0, "chromatic", 0)))).toBe(60);
    expect(Math.round(frequencyToMidi(pegPitch(2, "minor", 2)))).toBe(62 + SCALE_INTERVALS.minor[2]);
  });

  it("later shots bounce off the stuck ones, and a ball dropping onto them sticks on top", () => {
    let stuckNotes = 0;
    let stacked = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const engine = bullseyeEngine({ shots: 30, chaos: 0, interval: 0.5 }, seed);
      const { events } = run(engine, 90);
      stuckNotes += events.filter((e) => e.ev.wallIndex === 2 && !e.ev.thud && !e.ev.race).length;
      const v = engine.getBullseyeView();
      for (let k = 0; k < v.shots; k++) if (v.layout!.floorY - 8 - v.shotY[k] > 1) stacked++;
      expect(v.landed).toBe(30);
    }
    expect(stuckNotes).toBeGreaterThan(10);
    expect(stacked).toBeGreaterThan(5);
  });

  it("no ball sticks in mid-air: one perched on a peg is nudged off, a long rally tires, weak gravity is topped up", () => {
    const worstLift = (engine: PhysicsEngine) => {
      const v = engine.getBullseyeView();
      const r = engine.config.ballRadius;
      let worst = 0;
      for (let k = 0; k < v.shots; k++) worst = Math.max(worst, (v.layout!.floorY - r - v.shotY[k]) / (2 * r));
      return worst;
    };
    // The perfect shot falls straight onto the peg under the launcher in many seeds: it must never balance there.
    const page = { ...config, width: 790, height: 445 };
    for (let seed = 1; seed <= 40; seed++) {
      const engine = bullseyeEngine({ interval: 0.9, perfect: 3 }, seed * 7919, page);
      expect(run(engine, 90).finishedAt).toBeGreaterThan(0);
      expect(worstLift(engine), `seed ${seed * 7919}`).toBeLessThan(4);
      expect(engine.getBullseyeView().shotScore[2]).toBe(10);
    }
    // A tall field full of bumpers: rallies come down well before the flight limit.
    for (let seed = 1; seed <= 4; seed++) {
      const engine = bullseyeEngine({ chaos: 1, shots: 6, interval: 1 }, seed * 104729, { ...config, width: 1080, height: 1920 });
      run(engine, 120);
      const v = engine.getBullseyeView();
      expect(v.landed).toBe(6);
      expect(worstLift(engine)).toBeLessThan(4);
      for (let k = 0; k < 6; k++) expect(v.shotLandMs[k] - v.shotLaunchMs[k]).toBeLessThan(MAX_FLIGHT_MS);
    }
    // No gravity at all: the flights still come down onto the target.
    const weightless = bullseyeEngine({ shots: 4, interval: 0.5, perfect: 2 }, 5, { ...config, gravity: 0 });
    expect(run(weightless, 90).finishedAt).toBeGreaterThan(0);
    expect(worstLift(weightless)).toBeLessThan(4);
    expect(weightless.getBullseyeView().shotScore[1]).toBe(10);
  });

  it("the moving target slides within its amplitude and carries the balls stuck in it", () => {
    expect(targetOffset(50, 1.3, 0.4, false)).toBe(0);
    expect(targetVelocity(50, 1.3, 0.4, false)).toBe(0);
    for (let t = 0; t < 7; t += 0.37) {
      expect(Math.abs(targetOffset(50, t, 0.4, true))).toBeLessThanOrEqual(50 + 1e-9);
      expect(targetOffset(50, t + TARGET_PERIOD_SEC, 0.4, true)).toBeCloseTo(targetOffset(50, t, 0.4, true), 9);
      const h = 1e-5;
      expect(targetVelocity(50, t, 0.4, true)).toBeCloseTo((targetOffset(50, t + h, 0.4, true) - targetOffset(50, t - h, 0.4, true)) / (2 * h), 4);
    }
    const engine = bullseyeEngine({ shots: 10, interval: 0.8, moving: true }, 5);
    const xs: number[] = [];
    const offsets = new Map<number, number>();
    let riding = 0;
    run(engine, 60, (e) => {
      const v = e.getBullseyeView();
      xs.push(v.targetX);
      for (let k = 0; k < v.shots; k++) {
        if (v.shotState[k] !== SHOT_LANDED || v.shotRing[k] < 0) continue;
        const off = v.shotX[k] - v.targetX;
        if (!offsets.has(k)) offsets.set(k, off);
        else {
          expect(off).toBeCloseTo(offsets.get(k)!, 6);
          riding++;
        }
      }
    });
    const L = engine.getBullseyeView().layout!;
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.5 * L.amplitude);
    for (const x of xs) expect(Math.abs(x - L.cx)).toBeLessThanOrEqual(L.amplitude + 1e-6);
    expect(riding).toBeGreaterThan(0);
    // The engine balls are drawn where the target carries them.
    const v = engine.getBullseyeView();
    for (const b of engine.getBalls()) {
      const k = b.id;
      expect(b.x).toBeCloseTo(v.shotX[k], 6);
    }
  });
});

/** The score a thud frequency was pitched for (chromatic scale, root C). */
function thudPitchInverse(frequency: number): number {
  for (let s = 0; s <= 10; s++) if (Math.abs(thudPitch(s, "chromatic", 0) - frequency) < 1e-6) return s;
  return -1;
}

/* ------------------------------------------------------------------ slow motion */

describe("a bullseye", () => {
  it("the slow-motion profile: ramps down, holds, ramps back up within half a second", () => {
    expect(slowMoScale(0)).toBe(1);
    expect(slowMoScale(-5)).toBe(1);
    expect(slowMoScale(Number.NEGATIVE_INFINITY)).toBe(1);
    expect(slowMoScale(SLOW_MO_RAMP_IN_MS / 2)).toBeCloseTo((1 + SLOW_MO_FACTOR) / 2, 9);
    expect(slowMoScale(SLOW_MO_RAMP_IN_MS)).toBeCloseTo(SLOW_MO_FACTOR, 9);
    expect(slowMoScale(250)).toBe(SLOW_MO_FACTOR);
    expect(slowMoScale(SLOW_MO_MS - SLOW_MO_RAMP_OUT_MS / 2)).toBeCloseTo((1 + SLOW_MO_FACTOR) / 2, 9);
    expect(slowMoScale(SLOW_MO_MS)).toBe(1);
    expect(SLOW_MO_MS).toBe(500);
  });

  it("the rigged perfect shot always hits the bull – through a full field, on a moving target – with confetti, a fanfare and slow motion", () => {
    expect(perfectShotIndex({ perfect: 0, shots: 12 })).toBe(-1);
    expect(perfectShotIndex({ perfect: 5, shots: 12 })).toBe(4);
    expect(perfectShotIndex({ perfect: 13, shots: 12 })).toBe(-1);
    for (const moving of [false, true]) {
      for (let seed = 1; seed <= 10; seed++) {
        const engine = bullseyeEngine({ shots: 6, interval: 0.7, chaos: 1, perfect: 4, moving }, seed);
        const { events } = run(engine, 60);
        const v = engine.getBullseyeView();
        expect(v.perfectShot).toBe(3);
        expect(v.shotRing[3], `seed ${seed} moving ${moving}`).toBe(0);
        expect(v.shotScore[3]).toBe(10);
        expect(v.bullseyes).toBeGreaterThanOrEqual(1);
        expect(v.slowMos).toBeGreaterThanOrEqual(1);
        expect(events.filter((e) => e.ev.race === "fanfare").length).toBe(v.bullseyes);
      }
    }
  });

  it("slows the world clock for half a second: flying balls keep their path, just slower", () => {
    // The first shot is rigged into the bull; the second is in the air when it lands.
    const engine = bullseyeEngine({ shots: 2, interval: 0.5, chaos: 0, perfect: 1 }, 21);
    const v = engine.getBullseyeView();
    let landedAt = -1;
    let minScale = 1;
    let worldAtEnd = 0;
    let checkedScale = false;
    for (let i = 0; i < 60 * 20 && !engine.isSimulationFinished(); i++) {
      const before = engine.getBalls().map((b) => ({ id: b.id, vx: b.vx, vy: b.vy }));
      const scaleBefore = v.timeScale;
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      if (landedAt < 0 && v.shotState[0] === SHOT_LANDED) landedAt = engine.getElapsedMs();
      minScale = Math.min(minScale, v.timeScale);
      // At a change of scale the flying ball keeps its direction (its speed scales, its gravity by the square).
      if (!checkedScale && v.timeScale !== scaleBefore && v.shotState[1] !== SHOT_LANDED) {
        const ball = engine.getBalls().find((b) => b.id === 1)!;
        expect(ball.gravityScale).toBeCloseTo(v.timeScale * v.timeScale, 12);
        const prev = before.find((b) => b.id === 1)!;
        expect(Math.atan2(ball.vy, ball.vx)).toBeCloseTo(Math.atan2(prev.vy, prev.vx), 1);
        checkedScale = true;
      }
      if (landedAt >= 0 && engine.getElapsedMs() - landedAt >= SLOW_MO_MS + 50 && worldAtEnd === 0) worldAtEnd = v.timeMs;
    }
    expect(landedAt).toBeGreaterThan(0);
    expect(v.shotScore[0]).toBe(10);
    expect(checkedScale).toBe(true);
    expect(minScale).toBeCloseTo(SLOW_MO_FACTOR, 9);
    expect(v.timeScale).toBe(1);
    // The world clock lost (1 − factor) × the window without its ramps, give or take a step.
    const lost = (1 - SLOW_MO_FACTOR) * (SLOW_MO_MS - SLOW_MO_RAMP_IN_MS / 2 - SLOW_MO_RAMP_OUT_MS / 2);
    expect(v.simMs - v.timeMs).toBeGreaterThan(lost - 2 * STEP);
    expect(v.simMs - v.timeMs).toBeLessThan(lost + 2 * STEP);
    expect(worldAtEnd).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ determinism, resizes, the end, the finder */

describe("determinism and the end of the run", () => {
  it("a seed replays exactly; other seeds play differently", () => {
    const a = bullseyeEngine({}, 42);
    const b = bullseyeEngine({}, 42);
    const ra = run(a);
    const rb = run(b);
    expect(ra.finishedAt).toBe(rb.finishedAt);
    expect(scoresOf(a)).toEqual(scoresOf(b));
    expect(ra.events.map((e) => [e.t, e.ev.frequency, !!e.ev.thud])).toEqual(rb.events.map((e) => [e.t, e.ev.frequency, !!e.ev.thud]));
    const others = new Set<string>();
    for (let seed = 1; seed <= 4; seed++) {
      const e = bullseyeEngine({}, seed);
      run(e);
      others.add(scoresOf(e).join(","));
    }
    expect(others.size).toBe(4);
  });

  it("a resize before the first step plays the run an init at that size plays (the finder's engine)", () => {
    const direct = bullseyeEngine({ shots: 5, interval: 0.8 }, 17, { ...config, width: 1000, height: 562 });
    const resized = bullseyeEngine({ shots: 5, interval: 0.8 }, 17);
    resized.setConfig({ width: 1000, height: 562 });
    const a = run(direct);
    const b = run(resized);
    expect(b.finishedAt).toBe(a.finishedAt);
    expect(scoresOf(resized)).toEqual(scoresOf(direct));
    // A resize mid-run keeps the balls in the field and the run going.
    const mid = bullseyeEngine({ shots: 5, interval: 0.8 }, 17);
    for (let i = 0; i < 90; i++) mid.update(STEP, 0);
    mid.setConfig({ width: 600, height: 900 });
    const L = mid.getBullseyeView().layout!;
    for (const ball of mid.getBalls()) {
      expect(ball.x).toBeGreaterThanOrEqual(L.left);
      expect(ball.x).toBeLessThanOrEqual(L.right);
    }
    expect(run(mid).finishedAt).toBeGreaterThan(0);
    expect(mid.getBullseyeView().landed).toBe(5);
  });

  it("the final banner shows from the last landing, the run finishes FINAL_HOLD_MS later", () => {
    const engine = bullseyeEngine({ shots: 3, interval: 0.5 }, 9);
    let lastLanding = -1;
    let flaggedAt = -1;
    const { finishedAt } = run(engine, 60, (e) => {
      const v = e.getBullseyeView();
      if (v.landed === 3 && lastLanding < 0) lastLanding = e.getElapsedMs();
      if (v.allLanded && flaggedAt < 0) flaggedAt = e.getElapsedMs();
    });
    expect(flaggedAt).toBe(lastLanding);
    const v = engine.getBullseyeView();
    expect(finishedAt * 1000).toBeCloseTo(v.finishedMs, 6);
    expect(v.finishedMs - lastLanding).toBeGreaterThanOrEqual(FINAL_HOLD_MS - STEP);
    expect(v.finishedMs - lastLanding).toBeLessThan(FINAL_HOLD_MS + SLOW_MO_MS + STEP);
    expect(v.bestShot).toBeGreaterThanOrEqual(0);
  });

  it("the run length moves with the seed around the nominal length, so the finder lands 30 s", async () => {
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 200, maxSimTimeSec: 60, physicsConfig: config, mode: "bullseye", modeSettings: { ...modeSettings, bullseye: {} } };
    const nominal = bullseyeNominalRunSec(DEFAULT_BULLSEYE_SETTINGS);
    expect(nominal).toBeGreaterThan(28);
    expect(nominal).toBeLessThan(32);
    const lengths = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const ms = simulateSeed(seed, request, 60_000);
      expect(ms / 1000).toBeGreaterThan(nominal - 4);
      expect(ms / 1000).toBeLessThan(nominal + 6);
      lengths.add(Math.round(ms));
    }
    expect(lengths.size).toBeGreaterThan(5);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    let result;
    try {
      result = await findSimulation(request, () => undefined);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(result.found).toBe(true);
    expect(Math.abs(result.duration - 30)).toBeLessThanOrEqual(0.5);
    const replay = run(bullseyeEngine({}, result.seed));
    expect(Math.abs(replay.finishedAt - result.duration)).toBeLessThan(0.02);
  }, 60_000);
});

/* ------------------------------------------------------------------ the thud */

interface OscLog {
  type: string;
  frequency: number;
  startAt: number;
  ramps: number[];
}

function fakeGraph() {
  const oscillators: OscLog[] = [];
  const sources: { when: number; rate: number }[] = [];
  const param = (log?: number[]) => {
    const p = {
      value: 0,
      setValueAtTime: (v: number) => {
        p.value = v;
      },
      linearRampToValueAtTime: () => undefined,
      exponentialRampToValueAtTime: (v: number) => void log?.push(v),
      cancelScheduledValues: () => undefined,
    };
    return p;
  };
  const ctx = {
    state: "running",
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    resume: async () => undefined,
    close: async () => undefined,
    decodeAudioData: async () => ({ duration: 0.3 }),
    createGain: () => ({ gain: param(), connect: () => undefined, disconnect: () => undefined }),
    createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128, connect: () => undefined, disconnect: () => undefined }),
    createMediaStreamDestination: () => ({ stream: {}, connect: () => undefined }),
    createOscillator: () => {
      const ramps: number[] = [];
      const osc = {
        type: "sine",
        frequency: param(ramps),
        connect: () => undefined,
        disconnect: () => undefined,
        onended: null as (() => void) | null,
        start: (when = 0) => {
          if (osc.frequency.value !== 1) oscillators.push({ type: osc.type, frequency: osc.frequency.value, startAt: when, ramps });
        },
        stop: () => undefined,
      };
      return osc;
    },
    createBufferSource: () => {
      const source = {
        buffer: null as unknown,
        playbackRate: param(),
        connect: () => undefined,
        disconnect: () => undefined,
        addEventListener: () => undefined,
        onended: null as (() => void) | null,
        start: (when = 0) => void sources.push({ when, rate: source.playbackRate.value }),
        stop: () => undefined,
      };
      return source;
    },
    createBuffer: (channels: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, copyToChannel: () => undefined }),
  };
  return { ctx, oscillators, sources };
}

describe("the thud", () => {
  it("a sine body dropping onto the pitch and a triangle knock above it, as loud as its level", () => {
    expect(thudBend(200)).toEqual({ start: 200 * THUD_TONE.bend, end: 200, time: THUD_TONE.bendTime });
    expect(thudBend(Number.NaN).end).toBe(DEFAULT_THUD_FREQUENCY);
    expect(thudLevel(undefined)).toBe(1);
    expect(thudLevel(2)).toBe(1);
    expect(thudLevel(0.4)).toBe(0.4);
    const graph = fakeGraph();
    scheduleThudTone(graph.ctx as unknown as BaseAudioContext, {} as AudioNode, 100, 3, (f) => f * 1.5, 0.5);
    expect(graph.oscillators).toHaveLength(2);
    const [body, knock] = graph.oscillators;
    expect(body).toMatchObject({ type: "sine", frequency: 150 * THUD_TONE.bend, startAt: 3 });
    expect(body.ramps).toEqual([150]);
    expect(knock.type).toBe("triangle");
    expect(knock.frequency).toBeCloseTo(150 * THUD_TONE.knockRatio, 9);
  });

  describe("through the ToneGenerator", () => {
    let graph: ReturnType<typeof fakeGraph>;
    let tone: ToneGenerator;
    beforeEach(async () => {
      graph = fakeGraph();
      vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
      vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
      tone = new ToneGenerator();
      await tone.start();
    });
    afterEach(() => vi.unstubAllGlobals());

    it("snaps the pitch to the scale and lands on the beat grid without taking a bounce's slot", () => {
      tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, scale: "major", rootNote: 0, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4" });
      graph.ctx.currentTime = 0.1;
      tone.playThud(140, 0.8);
      expect(graph.oscillators).toHaveLength(2);
      expect(graph.oscillators[0].ramps[0]).toBeCloseTo(quantizeFrequency(140, "major", 0), 6);
      expect(graph.oscillators[0].startAt).toBeCloseTo(0.5, 9);
      tone.playWallHit(0, 440);
      expect(graph.oscillators).toHaveLength(3);
      expect(graph.oscillators[2].startAt).toBeCloseTo(0.5, 9);
    });

    it("plays the hit sample two octaves above the thud in sample mode", async () => {
      tone.setHitSoundMode("sample");
      tone.setHitSample("/hitSounds/click.wav");
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
      expect(tone.isHitSampleReady()).toBe(true);
      tone.playThud(100);
      expect(graph.oscillators).toHaveLength(0);
      expect(graph.sources).toHaveLength(1);
      expect(graph.sources[0].rate).toBeCloseTo(400 / 800, 9);
    });
  });

  it("the page / fast-export dispatch routes a thud to playThud() and a bullseye's fanfare to the race arpeggio", () => {
    const calls: string[] = [];
    const audio = {
      playThud: (f?: number, level?: number) => calls.push(`thud ${f} ${level}`),
      playRaceArpeggio: (kind: string, f?: number) => calls.push(`${kind} ${f}`),
      playWallHit: (w: number, f?: number) => calls.push(`hit ${w} ${f}`),
      playGapPass: () => calls.push("gap"),
    } as unknown as ToneGenerator;
    playSoundEvent(audio, { type: "hit", wallIndex: 0, frequency: 98, thud: true, level: 0.7 }, () => calls.push("break"));
    playSoundEvent(audio, { type: "hit", wallIndex: 0, frequency: 523, race: "fanfare" }, () => calls.push("break"));
    playSoundEvent(audio, { type: "hit", wallIndex: 0, frequency: 330 }, () => calls.push("break"));
    expect(calls).toEqual(["thud 98 0.7", "fanfare 523", "hit 0 330"]);
  });
});
