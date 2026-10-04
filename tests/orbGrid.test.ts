import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORB_GRID_SETTINGS,
  OG_FLYING,
  OG_SETTLED,
  OG_WAITING,
  ORB_CEILING,
  ORB_GRID_PRESETS,
  ORB_GRID_RANGES,
  RESOLVE_FIELD_SHARE,
  RESOLVE_MIN_MOVING,
  REST_FRACTION,
  SETTLE_HOLD_MS,
  TEMPO_JITTER,
  buildOrbLayout,
  defaultOrbGridFields,
  distributionValue,
  layoutRhoMax,
  orbFieldSize,
  orbGridNeverSettles,
  orbGridNominalRunSec,
  orbGridPresetFields,
  orbGridSettingsOf,
  orbGridSummary,
  orbsOnRing,
  planOrbGrid,
  releaseStep,
  resolveCoverage,
  resolveQuorum,
  resolveOrbGridFields,
  resolveOrbGridSettings,
  tuneTimeScale,
  landingTime,
  type OrbGridSettings,
} from "@/lib/physics/modes/orbGrid";
import { MAX_CHORD_NOTES, MAX_NOTES_PER_STEP, MAX_ORB_EVENTS_PER_FRAME, createOrbGroupScratch, groupOrbLandings, orbMusicNext, orbPitchHz, orbScaleIntervals, type OrbLandings, type OrbVoice } from "@/lib/audio/orbTones";
import {
  CAMERA_DISTANCE,
  DEFAULT_ORB_GRID_LABELS,
  ORB_BANNER_BACKDROP_ALPHA,
  ORB_BANNER_PAD_X,
  ORB_BANNER_PAD_Y,
  ORB_BANNER_SUB,
  ORB_BANNER_TITLE,
  OrbGridLayer,
  QUALITY_DISC_MAX,
  QUALITY_GLOSS_MAX,
  QUALITY_SHADOW_MAX,
  QUALITY_SPRITE_MAX,
  cameraAngleDeg,
  depthOrder,
  heightColor,
  orbBannerBox,
  orbBannerHeight,
  orbCamera,
  orbGridBanner,
  orbQuality,
  paletteColors,
  projectPoint,
  type OrbBannerBox,
  type OrbCamera,
  type ProjectedPoint,
} from "@/components/simulator/orbGridRenderer";
import { rulesForRange } from "@/components/simulator/unlimitedSlider";
import { createEngineForSettings, runNeverFinishes, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, outcomeFigure, outcomeMatches, outcomeMiss, outcomeSettled } from "@/lib/simulation/outcomes";
import { MODE_IDS, type PhysicsConfig } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { RANGES, defaultSettings, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import { SIGNED_KEYS, checkTypedNumber } from "@/lib/uncap";
import { resolveProjectSettings } from "@/lib/project";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
// --- orb-rhythm --- the rhythm model (ideal bouncers forever, polyrhythms, the metronome), its sound, drawing and finder answer
import {
  IN_PHASE_HOLD_MS,
  OG_RHYTHMS,
  PENDULUM_BASE,
  RHYTHM_BASE,
  RHYTHM_RATIOS,
  SQUASH_SEC,
  apexOf,
  beatClock,
  beatsUpTo,
  bounceHeight,
  bouncePhase,
  cycleSeconds,
  euclidOnsets,
  euclidPattern,
  gcd,
  groupIndex,
  inPhasePeriodSec,
  landingsUpTo,
  metronomeBpm,
  orbRenderTimeMs,
  planOrbRhythm,
  rhythmResolveAnswer,
  squashOf,
  type OgRhythm,
} from "@/lib/physics/modes/orbRhythm";
import { RHYTHM_RESOLVE_TOLERANCE_SEC, inPhaseBannerOn, orbRhythmFinderAnswer, orbRhythmSummary, sampleOrbHeights } from "@/lib/physics/modes/orbGrid";
import { CLICK_ACCENT_HZ, CLICK_BEAT_LEVEL, CLICK_HZ, clickFrequency, clickLevel, inPhaseDegrees } from "@/lib/audio/orbRhythmTones";
import { PITCH_DEGREES } from "@/lib/audio/orbTones";
import { MAX_BEAT_CELLS, ORB_HI_FPS_MAX_MS, OrbFrameCost, SWING_MAX, beatState, dotHopHeight, swingAngle, type BeatState } from "@/components/simulator/orbRhythmRenderer";
import { CaptionTracker } from "@/lib/captions";
import { findSimulation } from "@/lib/simulation/finder";
import type { SoundEvent } from "@/lib/physics/types";
// --- end orb-rhythm ---

const config: PhysicsConfig = { width: 800, height: 450, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
// --- orb-rhythm --- (the decay model: these tests pin it – the rhythm model, the default since the orb-rhythm rework, has its
// own tests at the end of this file – and the decay model replays exactly as it did before the rework)
const settingsOf = (patch: Partial<OrbGridSettings> = {}): OrbGridSettings => ({ ...DEFAULT_ORB_GRID_SETTINGS, model: "decay", ...patch });
/** A preset's settings in the decay model (--- orb-rhythm --- the presets play the rhythm model by default). */
const decayPreset = (id: string): OrbGridSettings => ({ ...orbGridSettingsOf(orbGridPresetFields(ORB_GRID_PRESETS.find((p) => p.id === id)!)), model: "decay" });
const engineOf = (patch: Partial<OrbGridSettings> = {}, seed = 1, cfg: Partial<PhysicsConfig> = {}) => createEngineForSettings({ ...config, ...cfg }, "orbGrid", { orbGrid: settingsOf(patch) } as unknown as ModeSettings, seed);
const step = 1000 / 60;

/** FNV-1a over a run's state: every orb's height (to 1e-6) and state, and the counters. */
function fingerprint(engine: ReturnType<typeof engineOf>): string {
  const v = engine.getOrbGridView();
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xffffffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let i = 0; i < v.count; i++) {
    mix(Math.round(v.height[i] * 1e6));
    mix(v.state[i]);
  }
  for (const n of [v.released, v.bounces, v.settled, v.moving, v.resolves, Math.round(v.resolveAtMs)]) mix(n);
  return h.toString(16);
}

/** Runs `engine` to `seconds` of simulation in frames of `frameMs` (the engine steps at 60 Hz inside), sounds consumed. */
function runTo(engine: ReturnType<typeof engineOf>, seconds: number, frameMs = step) {
  while (engine.getOrbGridView().timeMs < seconds * 1000 - 1e-6 && !engine.isSimulationFinished()) {
    engine.update(frameMs, 0);
    engine.consumeSoundEvents();
  }
}

describe("Bouncing Orbs: registration", () => {
  it("is a rhythm-family mode with a card next to the polyrhythms and its names in every language", () => {
    expect(MODE_IDS).toContain("orbGrid");
    expect(MODE_CATEGORIES.orbGrid).toBe("rhythm");
    expect(MODE_CARD_ORDER.indexOf("orbGrid")).toBe(MODE_CARD_ORDER.indexOf("polyrhythm") + 1);
    for (const m of [en, pl, es]) {
      expect(m.Modes.orbGrid.name.length).toBeGreaterThan(3);
      expect(m.Modes.orbGrid.description.length).toBeGreaterThan(80);
      expect(m.Editorial.modeOrbGrid.length).toBeGreaterThan(200);
    }
    expect(en.Modes.orbGrid.name).toBe("Bouncing Orbs");
  });

  it("has the same Bouncing Orbs keys in English, Polish and Spanish", () => {
    const keysOf = (m: typeof en) => [...Object.keys(m.Controls).filter((k) => k.startsWith("og") || k === "modeOrbGrid"), ...Object.keys(m.OrbGrid).map((k) => `OrbGrid.${k}`), ...Object.keys(m.Rigged).filter((k) => /Settles|Resolve/.test(k)).map((k) => `Rigged.${k}`)].sort();
    expect(keysOf(pl as unknown as typeof en)).toEqual(keysOf(en));
    expect(keysOf(es as unknown as typeof en)).toEqual(keysOf(en));
    expect(keysOf(en).length).toBeGreaterThan(100);
  });
});

describe("Bouncing Orbs: layout and distributions", () => {
  const grid = buildOrbLayout("grid", 9, 9);
  const rho = layoutRhoMax(grid);
  const at = (c: number, r: number) => r * 9 + c;
  const value = (kind: Parameters<typeof distributionValue>[0], i: number) => distributionValue(kind, grid, i, rho, 0.5);

  it("lays out columns × rows orbs inside a unit field, centred", () => {
    expect(grid.count).toBe(81);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < grid.count; i++) {
      sx += grid.x[i];
      sy += grid.y[i];
      expect(Math.abs(grid.x[i])).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(Math.abs(grid.y[i])).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    expect(Math.abs(sx)).toBeLessThan(1e-6);
    expect(Math.abs(sy)).toBeLessThan(1e-6);
    expect(buildOrbLayout("hex", 10, 6).count).toBe(60);
    // The ring arrangements: one orb in the centre, then round(2πk) (disc) or 8k (octagons) per ring.
    expect([orbsOnRing("octagons", 0), orbsOnRing("octagons", 1), orbsOnRing("octagons", 5), orbsOnRing("disc", 1), orbsOnRing("disc", 3)]).toEqual([1, 8, 40, 6, 19]);
    const oct = buildOrbLayout("octagons", 52, 26);
    expect(oct.count).toBe(1352);
    for (let i = 1; i < oct.count; i++) expect(oct.ring[i]).toBeGreaterThanOrEqual(oct.ring[i - 1]);
  });

  it("corner to corner: 0 in one corner, 1 in the opposite one, the same on both diagonals' mirror", () => {
    expect(value("corner", at(0, 0))).toBe(0);
    expect(value("corner", at(8, 8))).toBe(1);
    expect(value("corner", at(8, 0))).toBeCloseTo(0.5, 9);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) expect(value("corner", at(c, r))).toBeCloseTo(value("corner", at(r, c)), 9);
  });

  it("centre outwards: 0 in the centre, 1 in the corners, the same under a quarter turn", () => {
    expect(value("centre", at(4, 4))).toBe(0);
    for (const [c, r] of [[0, 0], [8, 0], [0, 8], [8, 8]]) expect(value("centre", at(c, r))).toBeCloseTo(1, 6);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) expect(value("centre", at(c, r))).toBeCloseTo(value("centre", at(8 - r, c)), 6);
  });

  it("rows and columns run 0 → 1 across the field and stay constant along a row (column)", () => {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      expect(value("rows", at(c, r))).toBeCloseTo(r / 8, 9);
      expect(value("columns", at(c, r))).toBeCloseTo(c / 8, 9);
    }
  });

  it("spiral, ripple and checker stay in 0–1; the spiral turns with the angle, the ripple is radial, the checker alternates", () => {
    for (let i = 0; i < grid.count; i++) {
      for (const kind of ["spiral", "ripple", "checker"] as const) {
        expect(value(kind, i)).toBeGreaterThanOrEqual(0);
        expect(value(kind, i)).toBeLessThanOrEqual(1);
      }
    }
    // Same radius, half a turn apart: half a revolution apart in the spiral.
    const a = value("spiral", at(6, 4));
    const b = value("spiral", at(2, 4));
    expect(Math.abs(Math.abs(a - b) - 0.5)).toBeLessThan(1e-6);
    expect(value("ripple", at(6, 4))).toBeCloseTo(value("ripple", at(2, 4)), 9);
    expect(value("ripple", at(4, 4))).toBe(0);
    expect(value("checker", at(0, 0))).toBe(0);
    expect(value("checker", at(1, 0))).toBe(1);
    expect(value("checker", at(1, 1))).toBe(0);
    // The varied distribution is the seed's draw.
    expect(distributionValue("varied", grid, 3, rho, 0.123)).toBe(0.123);
  });

  it("spreads the varied property between its bounds: corner bounciness rises from one corner to the other", () => {
    const plan = planOrbGrid(settingsOf({ columns: 9, rows: 9, distribution: "corner", spread: 1, resolve: false }), 300, 1, null);
    expect(plan.restitution[at(0, 0)]).toBeLessThan(plan.restitution[at(8, 8)]);
    expect(plan.restitution[at(0, 0)]).toBeCloseTo(DEFAULT_ORB_GRID_SETTINGS.bounciness - 0.1, 5);
    expect(plan.restitution[at(8, 8)]).toBeCloseTo(DEFAULT_ORB_GRID_SETTINGS.bounciness + 0.1, 5);
    // Spread 0: every orb alike.
    const flat = planOrbGrid(settingsOf({ columns: 9, rows: 9, distribution: "corner", spread: 0, resolve: false }), 300, 1, null);
    expect(new Set(flat.restitution).size).toBe(1);
    expect(new Set(flat.gravity).size).toBe(1);
  });
});

describe("Bouncing Orbs: release orders", () => {
  const oct = buildOrbLayout("octagons", 10, 10);
  it("outside-in lets the outer ring go first, inside-out the centre, row by row the first row", () => {
    const outer = oct.count - 1;
    expect(releaseStep("outside-in", oct, outer, 0)).toBe(0);
    expect(releaseStep("outside-in", oct, 0, 0)).toBe(oct.ringCount - 1);
    expect(releaseStep("inside-out", oct, 0, 0)).toBe(0);
    expect(releaseStep("inside-out", oct, outer, 0)).toBe(oct.ring[outer]);
    expect(releaseStep("together", oct, 7, 0.9)).toBe(0);
    const grid = buildOrbLayout("grid", 4, 5);
    expect([0, 4, 8, 19].map((i) => releaseStep("row-by-row", grid, i, 0))).toEqual([0, 1, 2, 4]);
    expect(releaseStep("random", grid, 0, 0.99)).toBe(4);
  });

  it("releases octagon rings outside-in in the engine: the released orbs fill whole rings from the outside", () => {
    const engine = engineOf({ columns: 52, rows: 26, arrangement: "octagons", release: "outside-in", stagger: 0.12 }, 4);
    const v = engine.getOrbGridView();
    const L = v.layout!;
    let lastRings = 0;
    let lastReleased = 0;
    let checks = 0;
    for (let i = 0; i < 180; i++) {
      engine.update(step, 0);
      engine.consumeSoundEvents();
      expect(v.released).toBeGreaterThanOrEqual(lastReleased);
      expect(v.releasedRings).toBeGreaterThanOrEqual(lastRings);
      // Every released orb lies on a ring at least as far out as every waiting one.
      let minReleasedRing = Infinity;
      let maxWaitingRing = -1;
      for (let k = 0; k < v.count; k++) {
        if (v.state[k] === OG_WAITING) maxWaitingRing = Math.max(maxWaitingRing, L.ring[k]);
        else minReleasedRing = Math.min(minReleasedRing, L.ring[k]);
      }
      if (maxWaitingRing >= 0 && Number.isFinite(minReleasedRing)) {
        expect(minReleasedRing).toBeGreaterThan(maxWaitingRing);
        checks++;
      }
      lastRings = v.releasedRings;
      lastReleased = v.released;
    }
    expect(checks).toBeGreaterThan(60);
    expect(v.released).toBe(v.count);
    expect(v.releasedRings).toBe(L.ringCount);
  });
});

describe("Bouncing Orbs: the physics", () => {
  it("replays a seed exactly, at 60 and at 30 frames a second alike, and another seed differs", () => {
    const prints = new Map<number, string>();
    for (const seed of [1, 77, 4242]) {
      const a = engineOf({}, seed);
      const b = engineOf({}, seed);
      const c = engineOf({}, seed);
      runTo(a, 6, step);
      runTo(b, 6, 2 * step);
      runTo(c, 6, step);
      expect(a.getOrbGridView().timeMs).toBeCloseTo(b.getOrbGridView().timeMs, 6);
      expect(fingerprint(b), `seed ${seed} at 30 fps`).toBe(fingerprint(a));
      expect(fingerprint(c), `seed ${seed} again`).toBe(fingerprint(a));
      prints.set(seed, fingerprint(a));
    }
    expect(new Set(prints.values()).size).toBe(3);
  });

  it("draws every random number from the seed: the tempo within ±TEMPO_JITTER", () => {
    const tempos = [1, 2, 3, 4, 5, 6].map((seed) => engineOf({ columns: 5, rows: 5 }, seed).getOrbGridView().tempo);
    for (const t of tempos) expect(Math.abs(t - 1)).toBeLessThanOrEqual(TEMPO_JITTER + 1e-9);
    expect(new Set(tempos).size).toBe(6);
  });

  it("drops every orb from its drop height: the first landing comes at the fall time, the next apex at e² of it", () => {
    const engine = engineOf({ columns: 1, rows: 1, resolve: false, spread: 0 }, 9);
    const v = engine.getOrbGridView();
    const g = (2.4 / (v.tempo * v.tempo)) * (300 / 300);
    const t1 = Math.sqrt((2 * v.drop[0]) / g);
    expect(v.height[0]).toBeCloseTo(DEFAULT_ORB_GRID_SETTINGS.dropHeight, 6); // (Float32 heights)
    runTo(engine, t1 - 0.05);
    expect(v.bounces).toBe(0);
    runTo(engine, t1 + 0.05);
    expect(v.bounces).toBe(1);
    // The highest point after the first landing: e² of the drop.
    let apex = 0;
    while (v.timeMs < (t1 + 2 * DEFAULT_ORB_GRID_SETTINGS.bounciness * t1 - 0.02) * 1000) {
      engine.update(step, 0);
      apex = Math.max(apex, v.height[0]);
    }
    expect(apex / v.drop[0]).toBeCloseTo(DEFAULT_ORB_GRID_SETTINGS.bounciness ** 2, 2);
  });

  it("settles every orb, holds the still field, then finishes; the clip ends a run that is still bouncing", () => {
    const engine = engineOf({ columns: 6, rows: 6, bounciness: 0.6, resolve: false }, 3);
    const v = engine.getOrbGridView();
    runTo(engine, 30);
    expect(v.allSettled).toBe(true);
    expect(v.settled).toBe(36);
    expect(v.moving).toBe(0);
    for (let i = 0; i < v.count; i++) expect(v.state[i]).toBe(OG_SETTLED);
    expect(v.finished).toBe(true);
    expect(v.finishReason).toBe("settled");
    expect(v.finishedMs - v.settledAtMs).toBeGreaterThanOrEqual(SETTLE_HOLD_MS - step);
    expect(v.finishedMs - v.settledAtMs).toBeLessThan(SETTLE_HOLD_MS + step + 1e-6);
    expect(engine.isSimulationFinished()).toBe(true);
    // A clip of 4 s ends the default field while it bounces.
    const clipped = engineOf({ maxSec: 4 }, 3);
    runTo(clipped, 10);
    expect([clipped.getOrbGridView().finished, clipped.getOrbGridView().finishReason, Math.round(clipped.getOrbGridView().finishedMs)]).toEqual([true, "time", 4000]);
    expect(clipped.getOrbGridView().settled).toBeLessThan(clipped.getOrbGridView().count);
  });

  it("ends a field that came to rest in the clip's last SETTLE_HOLD_MS as settled: ALL SETTLED until the clip ends, never TIME!", () => {
    // Seed 8 of a 12 × 12 field: every orb at rest 23.55 s in; a 25 s clip ends 1.45 s later, inside the hold.
    const engine = engineOf({ columns: 12, rows: 12, maxSec: 25 }, 8);
    const v = engine.getOrbGridView();
    runTo(engine, 30);
    expect(v.allSettled).toBe(true);
    expect(v.settledAtMs).toBeGreaterThan(25000 - SETTLE_HOLD_MS);
    expect([v.finished, v.finishReason, Math.round(v.finishedMs), v.settled]).toEqual([true, "settled", 25000, 144]);
    expect(orbGridBanner(v, DEFAULT_ORB_GRID_LABELS)).toEqual({ title: "ALL SETTLED", sub: `144 orbs at rest after ${(v.settledAtMs / 1000).toFixed(1)}s` });
    // The same field clipped before its last orb settles: TIME!, the orbs at rest counted.
    const cut = engineOf({ columns: 12, rows: 12, maxSec: 23 }, 8);
    runTo(cut, 30);
    const c = cut.getOrbGridView();
    expect([c.finished, c.finishReason, Math.round(c.finishedMs), c.allSettled]).toEqual([true, "time", 23000, false]);
    expect(orbGridBanner(c, DEFAULT_ORB_GRID_LABELS)).toEqual({ title: "TIME!", sub: `${c.settled} of 144 orbs at rest` });
  });

  it("settles an orb when its next apex would be under REST_FRACTION of its drop (a Zeno run within a step settles too)", () => {
    const e = 0.5;
    const k = Math.ceil(Math.log(REST_FRACTION) / (2 * Math.log(e)));
    expect(e ** (2 * (k - 1))).toBeGreaterThanOrEqual(REST_FRACTION);
    expect(e ** (2 * k)).toBeLessThan(REST_FRACTION);
    const engine = engineOf({ columns: 1, rows: 1, bounciness: e, spread: 0, resolve: false }, 2);
    runTo(engine, 10);
    expect(engine.getOrbGridView().state[0]).toBe(OG_SETTLED);
    expect(engine.getOrbGridView().bounces).toBe(k);
    // Bounciness 0: the first landing settles it.
    const dead = engineOf({ columns: 2, rows: 2, bounciness: 0, spread: 0, resolve: false }, 2);
    runTo(dead, 3);
    expect(dead.getOrbGridView().bounces).toBe(4);
    expect(dead.getOrbGridView().settled).toBe(4);
  });

  it("never settles an elastic field: the period property or a bounciness of 1 or more (Find Simulation calls it endless)", () => {
    expect(orbGridNeverSettles(settingsOf({ property: "period" }))).toBe(true);
    expect(orbGridNeverSettles(settingsOf({ bounciness: 1 }))).toBe(true);
    expect(orbGridNeverSettles(settingsOf({ bounciness: 0.95, spread: 1 }))).toBe(true); // (the bounciest orb: 0.95 + 0.1)
    expect(orbGridNeverSettles(settingsOf())).toBe(false);
    expect(orbGridNeverSettles(settingsOf(), 0)).toBe(true);
    expect(runNeverFinishes("orbGrid", { orbGrid: settingsOf({ property: "period" }) } as unknown as Parameters<typeof runNeverFinishes>[1])).toBe(true);
    expect(runNeverFinishes("orbGrid", { orbGrid: settingsOf() } as unknown as Parameters<typeof runNeverFinishes>[1])).toBe(false);
    expect(Number.isFinite(orbGridNominalRunSec(settingsOf()))).toBe(true);
    expect(orbGridNominalRunSec(settingsOf({ property: "period" }))).toBe(Infinity);
    const engine = engineOf({ property: "period", columns: 8, rows: 8 }, 5);
    runTo(engine, 40);
    expect(engine.getOrbGridView().settled).toBe(0);
    expect(engine.isSimulationFinished()).toBe(false);
  });

  it("settles the default field within a 30 s clip for most seeds (about 27 s, the seed's tempo aside)", () => {
    const nominal = orbGridNominalRunSec(settingsOf());
    expect(nominal).toBeGreaterThan(24);
    expect(nominal).toBeLessThan(28.5);
    for (const preset of ORB_GRID_PRESETS) {
      const s = decayPreset(preset.id);
      expect(orbGridNominalRunSec(s), preset.id).toBeLessThan(28.5);
    }
  });
});

describe("Bouncing Orbs: the resolve moment", () => {
  it("measures the phase coverage: an in-phase field scores 1, a spread one a window's share", () => {
    const n = 400;
    const inPhase = new Float64Array(n).fill(0.25);
    expect(resolveCoverage(inPhase, null, n)).toBe(1);
    const spread = Float64Array.from({ length: n }, (_, i) => i / n);
    const share = resolveCoverage(spread, null, n);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.1);
    // Nine tenths in phase, the rest spread: 0.9 and a little.
    const most = Float64Array.from({ length: n }, (_, i) => (i < 360 ? 0.6 : i / n));
    expect(resolveCoverage(most, null, n)).toBeGreaterThanOrEqual(0.9);
    expect(resolveCoverage(most, null, n)).toBeLessThan(0.95);
    // Phases near 0 and near 1 are neighbours (the bounce is a cycle).
    const wrap = Float64Array.from({ length: n }, (_, i) => (i % 2 ? 0.005 : 0.995));
    expect(resolveCoverage(wrap, null, n)).toBe(1);
  });

  it("tunes every orb's time scale (never its bounciness) so a landing falls on the pattern clock", () => {
    const t1 = 0.5;
    const e = 0.9;
    for (const target of [2.3, 4.1, 5.0]) {
      const scale = tuneTimeScale(t1, e, target);
      expect(Number.isFinite(scale)).toBe(true);
      expect(Math.abs(scale - 1)).toBeLessThanOrEqual(0.2 + 1e-12);
      const k = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].find((kk) => Math.abs(landingTime(t1 * scale, e, kk) - target) < 1e-9);
      expect(k, `target ${target}`).toBeDefined();
    }
    const plan = planOrbGrid(settingsOf(), 300, 1, null);
    const untuned = planOrbGrid(settingsOf({ resolve: false }), 300, 1, null);
    expect(plan.tuned).toBe(plan.count);
    expect(Array.from(plan.restitution)).toEqual(Array.from(untuned.restitution));
    expect(plan.resolveSec).toBeGreaterThan(3);
  });

  it("fires the resolve moment in the engine on the planned pattern clock (the default field and the corner preset)", () => {
    for (const [label, s] of [["default", settingsOf()], ["corner", decayPreset("corner")]] as const) {
      const engine = engineOf(s, 11);
      const v = engine.getOrbGridView();
      runTo(engine, v.resolvePlanMs / 1000 + 1);
      expect(v.resolves, label).toBeGreaterThanOrEqual(1);
      expect(Math.abs(v.resolveAtMs - v.resolvePlanMs), label).toBeLessThan(200);
    }
    // Without the tuning a decaying field never lines up.
    const off = engineOf({ resolve: false }, 11);
    runTo(off, 12);
    expect(off.getOrbGridView().resolves).toBe(0);
  });

  it("reads a step only while half the field is in flight (resolveQuorum)", () => {
    expect(RESOLVE_FIELD_SHARE).toBe(0.5);
    expect([resolveQuorum(1), resolveQuorum(6), resolveQuorum(9), resolveQuorum(1089), resolveQuorum(4900)]).toEqual([RESOLVE_MIN_MOVING, 4, 5, 545, 2450]);
  });

  it("keeps every preset's planned resolve and reports no in-phase moment once most of the field has come to rest", () => {
    /** Plays a run to its end, noting every "in phase" moment and the share of the field moving then. */
    const moments = (s: OrbGridSettings, seed: number) => {
      const engine = engineOf(s, seed);
      const v = engine.getOrbGridView();
      const out: { ms: number; moving: number }[] = [];
      while (!engine.isSimulationFinished() && v.timeMs < 60000) {
        engine.update(step, 0);
        engine.consumeSoundEvents();
        if (v.resolves > out.length) out.push({ ms: v.lastResolveMs, moving: v.moving / v.count });
      }
      return { plan: v.resolvePlanMs, out };
    };
    const presetSettings = decayPreset;
    for (const preset of ORB_GRID_PRESETS) {
      for (const seed of [5, 11]) {
        const { plan, out } = moments(presetSettings(preset.id), seed);
        expect(out.length, `${preset.id} seed ${seed}`).toBeGreaterThanOrEqual(1);
        expect(Math.abs(out[0].ms - plan), `${preset.id} seed ${seed}`).toBeLessThan(200);
        for (const m of out) expect(m.moving, `${preset.id} seed ${seed} at ${m.ms} ms`).toBeGreaterThanOrEqual(RESOLVE_FIELD_SHARE);
      }
    }
    // Metallic 525 and Music 484 (seed 5) used to add moments with 4–27 % of their orbs in flight (24.3 s and 26.7 s; seven
    // between 13.8 s and 20.8 s): now the planned one only.
    for (const id of ["metallic", "music"]) expect(moments(presetSettings(id), 5).out.length, id).toBe(1);
    // An untuned rows field never lines up while most of it bounces: its last rows in step (14.2 s in, 198 of 1089 orbs
    // moving) are no resolve.
    for (const seed of [3, 7]) expect(moments(settingsOf({ distribution: "rows", resolve: false }), seed).out, `rows seed ${seed}`).toEqual([]);
  });
});

describe("Bouncing Orbs: the projection", () => {
  const cam: OrbCamera = { cosA: 1, sinA: 0, cosE: 1, sinE: 0, distance: CAMERA_DISTANCE, focal: 1, cx: 0, cy: 0 };
  const pt = (): ProjectedPoint => ({ x: 0, y: 0, depth: 0, scale: 0 });

  it("draws far before near: the counting sort orders the depths back to front", () => {
    const depth = Float32Array.from([2.1, 3.5, 2.9, 1.2, 3.5, 2.0]);
    const order = new Uint32Array(6);
    depthOrder(depth, 6, order, new Uint32Array(257), new Uint32Array(6), 256);
    const sorted = Array.from(order).map((i) => depth[i]);
    for (let k = 1; k < 6; k++) expect(sorted[k]).toBeLessThanOrEqual(sorted[k - 1]);
    // A point behind the centre is deeper than one in front.
    orbCamera(30, 0, 800, 450, 0.7, 0.3, cam);
    expect(projectPoint(cam, 0, 0.4, 0, pt()).depth).toBeGreaterThan(projectPoint(cam, 0, -0.4, 0, pt()).depth);
  });

  it("draws a higher orb higher on the screen, and a farther one smaller", () => {
    orbCamera(30, 35, 800, 450, 0.7, 0.3, cam);
    const low = projectPoint(cam, 0.1, 0.2, 0, pt());
    const high = projectPoint(cam, 0.1, 0.2, 0.2, pt());
    expect(high.y).toBeLessThan(low.y);
    expect(Math.abs(high.x - low.x)).toBeLessThan(Math.abs(high.y - low.y));
    const near = projectPoint(cam, 0, -0.4, 0, pt());
    const far = projectPoint(cam, 0, 0.4, 0, pt());
    expect(far.scale).toBeLessThan(near.scale);
  });

  it("keeps the field's centre and its framing fixed while the camera turns (rotation and auto-orbit)", () => {
    const centres = new Set<string>();
    const focals = new Set<string>();
    for (const angle of [0, 35, 90, 180, 271.5, cameraAngleDeg(35, true, 12.5)]) {
      orbCamera(30, angle, 800, 450, 0.7, 0.3, cam);
      const c = projectPoint(cam, 0, 0, 0, pt());
      centres.add(`${c.x.toFixed(6)},${c.y.toFixed(6)}`);
      focals.add(cam.focal.toFixed(6));
    }
    expect(centres.size).toBe(1);
    expect(focals.size).toBe(1);
    expect(cameraAngleDeg(35, false, 100)).toBe(35);
    expect(cameraAngleDeg(35, true, 10)).toBeGreaterThan(35);
    // The field stays inside the square the recorder crops (450 × 450 in the middle of 800 × 450).
    orbCamera(30, 45, 800, 450, 0.75, 0.33, cam);
    for (let a = 0; a < 360; a += 15) {
      const p = projectPoint(cam, 0.75 * Math.cos((a * Math.PI) / 180), 0.75 * Math.sin((a * Math.PI) / 180), 0, pt());
      expect(p.x).toBeGreaterThan(175);
      expect(p.x).toBeLessThan(625);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(450);
    }
  });

  it("picks the quality ladder by orb count: gloss, then shadows, then sprites, then discs", () => {
    expect([orbQuality(1089), orbQuality(QUALITY_GLOSS_MAX), orbQuality(QUALITY_GLOSS_MAX + 1), orbQuality(1936), orbQuality(QUALITY_SHADOW_MAX + 1), orbQuality(4900), orbQuality(QUALITY_SPRITE_MAX + 1), orbQuality(QUALITY_DISC_MAX + 1)]).toEqual([0, 0, 1, 1, 2, 2, 3, 4]);
    const lowColour = heightColor(0);
    const highColour = heightColor(1);
    expect(lowColour[1]).toBeGreaterThan(lowColour[0]); // green low
    expect(highColour[2]).toBeGreaterThan(highColour[1]); // purple high
  });
});

describe("Bouncing Orbs: the end banner", () => {
  /** WCAG 2 relative luminance and contrast of sRGB colours (0–255 a channel). */
  const luminance = (c: readonly number[]) => {
    const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  };
  const contrast = (a: readonly number[], b: readonly number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const over = (top: readonly number[], alpha: number, under: readonly number[]) => under.map((c, i) => alpha * top[i] + (1 - alpha) * c);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  it("stays legible over any field: the lime title and the white subline on the dark backdrop, over every palette colour", () => {
    const fields = [...paletteColors("height", "#ffffff"), ...paletteColors("rainbow-field", "#ffffff"), ...paletteColors("rings", "#ffffff"), [255, 255, 255]];
    for (const field of fields) {
      const behind = over([0, 0, 0], ORB_BANNER_BACKDROP_ALPHA, field);
      expect(contrast(rgb(ORB_BANNER_TITLE), behind), `title over ${field}`).toBeGreaterThanOrEqual(3); // (WCAG AA, large text)
      expect(contrast(rgb(ORB_BANNER_SUB), behind), `subline over ${field}`).toBeGreaterThanOrEqual(4.5); // (WCAG AA, any text)
    }
    // The old banner – the lime title and a #aaa subline at the frame's 0.6, no backdrop – over the resting orbs' green: ~1.2:1.
    const resting = heightColor(0);
    expect(contrast(over(rgb("#a3e635"), 0.6, resting), resting)).toBeLessThan(1.5);
    expect(contrast(over(rgb("#aaaaaa"), 0.6, resting), resting)).toBeLessThan(1.5);
  });

  it("sizes the backdrop around both lines: the wider line plus the padding, the block's height", () => {
    const box = orbBannerBox(450, 100, 400, 300, 72, 28.8);
    expect(box.w).toBeCloseTo(400 + 2 * ORB_BANNER_PAD_X * 72, 9);
    expect(box.x).toBeCloseTo(450 - box.w / 2, 9);
    expect([box.y, box.h]).toEqual([100, orbBannerHeight(72, 28.8)]);
    expect(orbBannerHeight(72, 28.8)).toBeCloseTo(72 + 1.2 * 28.8 + 2 * ORB_BANNER_PAD_Y * 72, 9);
    expect(orbBannerBox(450, 100, 200, 500, 72, 28.8).w).toBeCloseTo(500 + 2 * ORB_BANNER_PAD_X * 72, 9); // (a wider subline)
    expect(box.r).toBeLessThanOrEqual(box.h / 2);
  });

  it("draws the backdrop first, then the title and the subline – opaque whatever alpha the frame is at – and reports the box once", () => {
    const calls: { op: string; args: unknown[]; fillStyle: unknown; globalAlpha: unknown }[] = [];
    const keys = ["fillStyle", "globalAlpha", "font", "shadowBlur", "shadowColor", "textAlign", "textBaseline"];
    const stack: Record<string, unknown>[] = [];
    const ctx: Record<string, unknown> = { fillStyle: "#000000", globalAlpha: 0.6, font: "10px sans-serif", shadowBlur: 0, shadowColor: "", textAlign: "start", textBaseline: "alphabetic" };
    const record = (op: string) => (...args: unknown[]) => void calls.push({ op, args, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha });
    const fontPx = () => Number(/([\d.]+)px/.exec(String(ctx.font))?.[1]);
    Object.assign(ctx, {
      save: () => void stack.push(Object.fromEntries(keys.map((k) => [k, ctx[k]]))),
      restore: () => void Object.assign(ctx, stack.pop()),
      measureText: (text: string) => ({ width: 0.55 * fontPx() * text.length }),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arcTo: () => {},
      closePath: () => {},
      fill: record("fill"),
      fillText: record("fillText"),
    });
    const layer = new OrbGridLayer();
    const title = "ALL SETTLED";
    const sub = "144 orbs at rest after 23.6s";
    layer.drawBanner(ctx as unknown as CanvasRenderingContext2D, title, sub, 450, 200, 72, 28.8);
    expect(calls.map((c) => [c.op, c.fillStyle, c.globalAlpha])).toEqual([
      ["fill", `rgba(0, 0, 0, ${ORB_BANNER_BACKDROP_ALPHA})`, 1],
      ["fillText", ORB_BANNER_TITLE, 1],
      ["fillText", ORB_BANNER_SUB, 1],
    ]);
    expect([calls[1].args[0], calls[2].args[0]]).toEqual([title, sub]);
    expect(ctx.globalAlpha).toBe(0.6); // (the frame's alpha restored)
    const box: OrbBannerBox = layer.takeBanner({ x: 0, y: 0, w: 0, h: 0, r: 0 });
    expect(box).toEqual(orbBannerBox(450, 200, 0.55 * 72 * title.length, 0.55 * 28.8 * sub.length, 72, 28.8));
    for (const c of calls.slice(1)) {
      const y = Number(c.args[2]);
      expect(y).toBeGreaterThan(box.y);
      expect(y).toBeLessThan(box.y + box.h);
    }
    expect(layer.takeBanner({ x: 0, y: 0, w: 0, h: 0, r: 0 }).w).toBe(0); // (not drawn again: no banner)
  });
});

describe("Bouncing Orbs: the sound", () => {
  const landingsOf = (rows: number[], cols: number[], loud: number[] = []): OrbLandings => ({
    count: rows.length,
    group: Int32Array.from(rows),
    pitchKey: Int32Array.from(cols),
    loud: Float32Array.from(rows.map((_, i) => loud[i] ?? 1)),
    time: Float64Array.from(rows.map((_, i) => 1 + i * 1e-4)),
  });

  it("makes one chord of a row's simultaneous landings, its pitches spread when more landed than a chord holds", () => {
    const out: OrbVoice[] = [];
    const scratch = createOrbGroupScratch(64);
    const one = groupOrbLandings(landingsOf([3, 3, 3], [2, 5, 9]), MAX_NOTES_PER_STEP, MAX_CHORD_NOTES, scratch, out);
    expect(one).toBe(1);
    expect(out[0].group).toBe(3);
    expect(out[0].keys).toEqual([2, 5, 9]);
    const many = groupOrbLandings(landingsOf([1, 1, 1, 1, 1, 1], [0, 4, 8, 12, 16, 20]), MAX_NOTES_PER_STEP, MAX_CHORD_NOTES, scratch, out);
    expect(many).toBe(1);
    expect(out[0].keys).toEqual([0, 10, 20]);
    expect(out[0].landings).toBe(6);
  });

  it("queues at most the cap of voices a step – the loudest rows first", () => {
    const out: OrbVoice[] = [];
    const scratch = createOrbGroupScratch(64);
    const rows = [0, 1, 1, 2, 2, 2, 3, 4];
    const made = groupOrbLandings(landingsOf(rows, rows.map((_, i) => i), rows.map((r) => (r === 4 ? 9 : 1))), MAX_NOTES_PER_STEP, MAX_CHORD_NOTES, scratch, out);
    expect(made).toBe(MAX_NOTES_PER_STEP);
    expect(out.slice(0, made).map((v) => v.group)).toEqual([4, 2]);
    // The scratch is clean for the next step.
    expect(groupOrbLandings(landingsOf([7], [1]), 2, 3, scratch, out)).toBe(1);
    expect(out[0].group).toBe(7);
  });

  it("plays the scale: a major pentatonic for the chromatic default, the Sound section's scale otherwise; the melody walks it", () => {
    expect(orbScaleIntervals("chromatic")).toEqual(orbScaleIntervals("pentatonic"));
    expect(orbPitchHz(0, 10, "chromatic", 0, 0)).toBeCloseTo(130.81, 1); // C3
    expect(orbPitchHz(0, 10, "chromatic", 0, 1)).toBeCloseTo(261.63, 1);
    expect(orbPitchHz(10, 10, "major", 2, 0)).toBeGreaterThan(orbPitchHz(0, 10, "major", 2, 0));
    let degree = 7;
    for (let i = 0; i < 200; i++) {
      degree = orbMusicNext(degree, i * 7);
      expect(degree).toBeGreaterThanOrEqual(0);
      expect(degree).toBeLessThanOrEqual(14);
    }
  });

  it("passes on at most MAX_ORB_EVENTS_PER_FRAME voices a frame, chords for rows, the sleep sound a few voices a second", () => {
    for (const sound of ["notes", "sleep", "music", "metal"] as const) {
      const engine = engineOf({ sound, columns: 22, rows: 22 }, 6);
      let voices = 0;
      let chords = 0;
      let maxFrame = 0;
      for (let i = 0; i < 6 * 60; i++) {
        engine.update(4 * step, 0); // (4× playback: four steps a frame)
        const events = engine.consumeSoundEvents();
        maxFrame = Math.max(maxFrame, events.length);
        voices += events.length;
        for (const ev of events) {
          if (ev.chord && ev.chord.length > 1) chords++;
          if (sound === "sleep" || sound === "metal") expect(ev.orb, sound).toBe(sound);
          else expect(ev.orb, sound).toBeUndefined();
          expect(ev.melody === false, sound).toBe(sound === "sleep" || sound === "metal");
        }
      }
      expect(maxFrame, sound).toBeLessThanOrEqual(MAX_ORB_EVENTS_PER_FRAME);
      expect(voices, sound).toBeGreaterThan(0);
      if (sound === "notes") expect(chords).toBeGreaterThan(0);
      // 24 simulated seconds: the sleep sound at most one voice every 0.32 s.
      if (sound === "sleep") expect(voices).toBeLessThanOrEqual(Math.ceil(24 / 0.32) + 1);
      if (sound === "music") for (const f of engine.getOrbGridView().lastPitches) expect(f).toBeGreaterThan(100);
    }
    const silent = engineOf({ sound: "silent" }, 6);
    let any = 0;
    for (let i = 0; i < 240; i++) {
      silent.update(step, 0);
      any += silent.consumeSoundEvents().length;
    }
    expect(any).toBe(0);
  });
});

describe("Bouncing Orbs: settings, links and presets", () => {
  it("round-trips every field through a link, a preset and the bot's finder request", () => {
    const s = { ...defaultSettings("orbGrid"), ogColumns: 44, ogRows: 43, ogArrangement: "hex" as const, ogVaried: "height" as const, ogDistribution: "spiral" as const, ogSpread: 0.35, ogRelease: "row-by-row" as const, ogStagger: 0.2, ogDropHeight: 0.42, ogOrbSize: 0.6, ogBounciness: 0.88, ogResolve: false, ogElevation: 55, ogRotation: 120, ogOrbit: true, ogFloor: "plate" as const, ogMaterial: "metallic" as const, ogPalette: "rainbow-field" as const, ogHud: false, ogSound: "music" as const };
    const params = settingsToSearchParams(s);
    for (const key of ["ogC", "ogR", "ogA", "ogV", "ogD", "ogS", "ogL", "ogT", "ogH", "ogZ", "ogB", "ogRes", "ogE", "ogRot", "ogO", "ogF", "ogM", "ogP", "ogHud", "ogSnd"]) expect(params.has(key), key).toBe(true);
    const back = settingsFromSearchParams(params);
    for (const key of Object.keys(defaultOrbGridFields()) as (keyof ReturnType<typeof defaultOrbGridFields>)[]) expect(back[key], key).toEqual(s[key]);
    const preset = presetToSettings(JSON.parse(JSON.stringify(s)));
    for (const key of Object.keys(defaultOrbGridFields()) as (keyof ReturnType<typeof defaultOrbGridFields>)[]) expect(preset[key], key).toEqual(s[key]);
    // The defaults write nothing.
    const plain = settingsToSearchParams(defaultSettings("orbGrid"));
    expect([...plain.keys()].filter((k) => k.startsWith("og"))).toEqual([]);
    // Unknown options fall back, invalid numbers too.
    const bad = settingsFromSearchParams(new URLSearchParams("mode=orbGrid&ogA=star&ogV=mass&ogC=abc&ogS=-2&ogSnd=loud"));
    expect([bad.ogArrangement, bad.ogVaried, bad.ogColumns, bad.ogSpread, bad.ogSound]).toEqual(["grid", "bounciness", 33, 0, "notes"]);
    // The finder plays the run to its own end (no clip).
    expect(modeSettingsOfSettings(s).orbGrid?.maxSec).toBe(0);
    expect(modeSettingsOfSettings(s).orbGrid?.columns).toBe(44);
  });

  it("keeps a negative camera rotation – the resolver, a link, a preset, a project file and the number field (a signed setting)", () => {
    expect(resolveOrbGridSettings({ rotation: -45 }).rotation).toBe(-45);
    expect(resolveOrbGridSettings({ rotation: "-45" as unknown as number }).rotation).toBe(-45);
    expect(resolveOrbGridSettings({ rotation: -1e6 }).rotation).toBe(-1e6);
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, "", "left", true]) expect(resolveOrbGridSettings({ rotation: bad as unknown as number }).rotation, String(bad)).toBe(DEFAULT_ORB_GRID_SETTINGS.rotation);
    expect(SIGNED_KEYS.has("ogRotation")).toBe(true);
    const fromLink = settingsFromSearchParams(new URLSearchParams("mode=orbGrid&ogRot=-45"));
    expect(fromLink.ogRotation).toBe(-45);
    expect(settingsToSearchParams(fromLink).get("ogRot")).toBe("-45");
    expect(settingsFromSearchParams(settingsToSearchParams({ ...fromLink, ogRotation: -720 })).ogRotation).toBe(-720); // (whole degrees, as the slider steps)
    expect(presetToSettings(JSON.parse(JSON.stringify({ ...defaultSettings("orbGrid"), ogRotation: -45 }))).ogRotation).toBe(-45);
    expect(resolveProjectSettings({ ...defaultSettings("orbGrid"), ogRotation: -45 }).ogRotation).toBe(-45);
    const rules = rulesForRange(RANGES.ogRotation);
    expect(rules.min).toBeUndefined();
    expect(checkTypedNumber("-45", rules)).toEqual({ ok: true, value: -45 });
    // The engine's field turns the other way: the view carries the angle as given.
    expect(engineOf({ rotation: -45 }, 1).getOrbGridView().settings.rotation).toBe(-45);
    expect(cameraAngleDeg(-45, false, 3)).toBe(-45);
  });

  it("loads every preset as the mode's defaults plus its fields – the account's counts", () => {
    const counts: Record<string, number> = {};
    for (const preset of ORB_GRID_PRESETS) {
      const fields = orbGridPresetFields(preset);
      expect(resolveOrbGridFields(fields)).toEqual(fields);
      const s = { ...defaultSettings("orbGrid"), ...fields };
      const back = settingsFromSearchParams(settingsToSearchParams(s));
      for (const key of Object.keys(fields) as (keyof typeof fields)[]) expect(back[key], `${preset.id} ${key}`).toEqual(fields[key]);
      counts[preset.id] = orbGridSummary(orbGridSettingsOf(fields)).count;
      expect(typeof (en.Controls as Record<string, string>)[preset.labelKey]).toBe("string");
    }
    expect(counts).toEqual({ varied: 1089, corner: 1892, centre: 440, octagons: 1352, metallic: 525, sleep: 484, music: 484, grid70: 4900, metronome: 576 /* --- orb-rhythm --- */ });
  });

  it("caps no number: 70 × 70, 500 × 500 and huge heights travel and run; past the memory ceiling the field keeps its shape", () => {
    const big = { ...defaultSettings("orbGrid"), ogColumns: 500, ogRows: 500, ogDropHeight: 5, ogBounciness: 1.5, ogElevation: 120, ogRotation: 1000, ogSpread: 12, ogStagger: 9, ogOrbSize: 3 };
    const back = settingsFromSearchParams(settingsToSearchParams(big));
    for (const key of ["ogColumns", "ogRows", "ogDropHeight", "ogBounciness", "ogElevation", "ogRotation", "ogSpread", "ogStagger", "ogOrbSize"] as const) expect(back[key], key).toBe(big[key]);
    expect(resolveOrbGridSettings({ columns: 1e6, rows: 3 }).columns).toBe(1e6);
    expect(resolveOrbGridSettings({ bounciness: -1 }).bounciness).toBe(ORB_GRID_RANGES.ogBounciness.min);
    expect(resolveOrbGridSettings({ dropHeight: Number.NaN }).dropHeight).toBe(DEFAULT_ORB_GRID_SETTINGS.dropHeight);
    expect(resolveOrbGridSettings({ spread: Number.POSITIVE_INFINITY }).spread).toBe(DEFAULT_ORB_GRID_SETTINGS.spread);
    // 500 × 500 = 250,000: right at the ceiling; 600 × 600 is past it – the field keeps its aspect.
    expect(orbFieldSize(500, 500)).toEqual({ columns: 500, rows: 500, count: ORB_CEILING, full: false });
    const past = orbFieldSize(600, 600);
    expect(past.full).toBe(true);
    expect(past.count).toBeLessThanOrEqual(ORB_CEILING);
    expect(past.columns).toBe(past.rows);
    expect(pastAnyMemoryCeiling({ ...defaultSettings("orbGrid"), ogColumns: 600, ogRows: 600 })).toBe(true);
    expect(pastAnyMemoryCeiling({ ...defaultSettings("orbGrid"), ogColumns: 70, ogRows: 70 })).toBe(false);
    // A 4900-orb field runs (and a 250,000-orb plan builds).
    const engine = engineOf({ columns: 70, rows: 70, distribution: "corner" }, 2);
    runTo(engine, 2);
    expect(engine.getOrbGridView().count).toBe(4900);
    expect(engine.getOrbGridView().bounces).toBeGreaterThan(0);
    expect(planOrbGrid(settingsOf({ columns: 500, rows: 500 }), 300, 1, null).count).toBe(ORB_CEILING);
    for (const key of Object.keys(ORB_GRID_RANGES)) expect(RANGES[key as keyof typeof RANGES], key).toBeDefined();
  });
});

describe("Bouncing Orbs: Find Simulation", () => {
  const request = (s: OrbGridSettings): FinderRequest => ({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 60, physicsConfig: config, mode: "orbGrid", modeSettings: { orbGrid: { ...s, maxSec: 0 } } as unknown as ModeSettings });

  it("offers the run length, never-settles and the first resolve moment", () => {
    const outcomes = availableOutcomes("orbGrid", { endless: false, neverEscape: false, ballCount: 1 });
    expect(outcomes).toEqual(["duration", "never-settles", "resolves-at"]);
    expect(availableOutcomes("orbGrid", { endless: true, neverEscape: false, ballCount: 1 })).toEqual(["never-settles", "resolves-at"]);
    expect(availableOutcomes("classic", { endless: false, neverEscape: false, ballCount: 1 })).not.toContain("resolves-at");
  });

  it("judges never-settles by the clip and resolves-at by the first resolve (±0.5 s)", () => {
    const base = { durationMs: 20000, finished: false, firstEscapeMs: -1, teams: [] };
    expect(outcomeMatches({ kind: "never-settles", clipSec: 20 }, base)).toBe(true);
    expect(outcomeMatches({ kind: "never-settles", clipSec: 20 }, { ...base, settledMs: -1 })).toBe(true);
    expect(outcomeMatches({ kind: "never-settles", clipSec: 20 }, { ...base, durationMs: 15000, finished: true })).toBe(false);
    expect(outcomeMiss({ kind: "never-settles", clipSec: 20 }, { ...base, durationMs: 15000, finished: true })).toBe(5);
    // At rest before the clip is over, its end (a hold later) still to come: no match – it bounced 19.2 s of the 20.
    const atRest = { ...base, durationMs: 19200, settledMs: 19200 };
    expect(outcomeMatches({ kind: "never-settles", clipSec: 20 }, atRest)).toBe(false);
    expect(outcomeMatches({ kind: "never-settles", clipSec: 20 }, { ...base, settledMs: 19200 })).toBe(false);
    expect(outcomeMiss({ kind: "never-settles", clipSec: 20 }, atRest)).toBeCloseTo(0.8, 9);
    expect(outcomeMiss({ kind: "never-settles", clipSec: 20 }, { ...base, settledMs: 19200 })).toBeCloseTo(0.8, 9);
    expect(outcomeFigure({ kind: "never-settles", clipSec: 20 }, atRest)).toBeCloseTo(19.2, 9);
    expect(outcomeFigure({ kind: "never-settles", clipSec: 20 }, base)).toBe(20);
    expect(outcomeMatches({ kind: "resolves-at", clipSec: 30, atSec: 5 }, { ...base, firstResolveMs: 5400 })).toBe(true);
    expect(outcomeMatches({ kind: "resolves-at", clipSec: 30, atSec: 5 }, { ...base, firstResolveMs: 5600 })).toBe(false);
    expect(outcomeMatches({ kind: "resolves-at", clipSec: 30, atSec: 5 }, base)).toBe(false);
    expect(outcomeMiss({ kind: "resolves-at", clipSec: 30, atSec: 5 }, { ...base, firstResolveMs: 6000 })).toBeCloseTo(1, 9);
    expect(outcomeSettled({ kind: "resolves-at", clipSec: 30, atSec: 5 }, 3000, -1, false, "orbGrid", -1)).toBe(false);
    expect(outcomeSettled({ kind: "resolves-at", clipSec: 30, atSec: 5 }, 3000, -1, false, "orbGrid", 2900)).toBe(true);
    expect(outcomeSettled({ kind: "never-settles", clipSec: 10 }, 9000, -1, false, "orbGrid")).toBe(false);
    expect(outcomeSettled({ kind: "never-settles", clipSec: 10 }, 9000, -1, false, "orbGrid", -1, -1)).toBe(false);
    expect(outcomeSettled({ kind: "never-settles", clipSec: 10 }, 9000, -1, false, "orbGrid", -1, 9000)).toBe(true); // at rest: decided
    expect(outcomeSettled({ kind: "never-settles", clipSec: 10 }, 10000, -1, false, "orbGrid")).toBe(true);
  });

  it("does not call a field still bouncing that came to rest in the clip's last SETTLE_HOLD_MS (its end falls past the clip)", () => {
    // Seed 8 of a 12 × 12 field: every orb at rest 23.55 s in – within the 25 s clip – but the run's own end comes a hold
    // later, past the clip: the page shows ALL SETTLED from 23.55 s until the clip ends it (as settled).
    const s = settingsOf({ columns: 12, rows: 12 });
    const outcome = { kind: "never-settles", clipSec: 25 } as const;
    const page = engineOf({ ...s, maxSec: outcome.clipSec }, 8);
    runTo(page, outcome.clipSec + 5);
    const v = page.getOrbGridView();
    expect(v.allSettled).toBe(true);
    expect(v.settledAtMs).toBeGreaterThan(1000 * outcome.clipSec - SETTLE_HOLD_MS);
    expect(v.settledAtMs).toBeLessThan(1000 * outcome.clipSec);
    expect([v.finished, v.finishReason, Math.round(v.finishedMs), v.settled]).toEqual([true, "settled", 25000, v.count]);
    const run = simulateOutcomeRun(8, request(s), outcome);
    expect(run.settledMs).toBeCloseTo(v.settledAtMs, 6);
    expect([run.finished, run.durationMs]).toEqual([false, run.settledMs]); // followed to the moment it came to rest
    expect(outcomeMatches(outcome, run)).toBe(false);
    expect(outcomeMiss(outcome, run)).toBeCloseTo(outcome.clipSec - v.settledAtMs / 1000, 6);
    expect(outcomeFigure(outcome, run)).toBeCloseTo(v.settledAtMs / 1000, 6);
  });

  it("finds never-settles exactly where the page's clip ends on a field still bouncing (seeds 1–60, a 25 s clip)", () => {
    const s = settingsOf({ columns: 12, rows: 12 });
    const outcome = { kind: "never-settles", clipSec: 25 } as const;
    let matched = 0;
    let restInHold = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const run = simulateOutcomeRun(seed, request(s), outcome);
      // The page plays a found run for the clip (its maxSec): still bouncing when it ends, or every orb at rest?
      const page = engineOf({ ...s, maxSec: outcome.clipSec }, seed);
      runTo(page, outcome.clipSec + 5);
      const v = page.getOrbGridView();
      const stillBouncing = !v.allSettled;
      expect(v.finishReason, `seed ${seed}`).toBe(stillBouncing ? "time" : "settled"); // (TIME! only over orbs still bouncing)
      expect(outcomeMatches(outcome, run), `seed ${seed}`).toBe(stillBouncing);
      expect((run.settledMs ?? -1) >= 0, `seed ${seed}`).toBe(v.allSettled);
      if (stillBouncing) matched++;
      // at rest within the clip's last 1.5 s: the clip cut its hold short
      if (v.allSettled && Math.abs(v.finishedMs - 1000 * outcome.clipSec) < 1 && v.finishedMs - v.settledAtMs < SETTLE_HOLD_MS - 1) restInHold++;
    }
    expect(matched).toBeGreaterThan(10);
    expect(restInHold).toBeGreaterThan(5);
  });

  it("finds no 'In phase at' moment where most of the field is at rest (the untuned rows field's last rows in step, 14.2 s in)", () => {
    const s = settingsOf({ distribution: "rows", resolve: false });
    const outcome = { kind: "resolves-at", clipSec: 30, atSec: 14.2 } as const;
    const run = simulateOutcomeRun(7, request(s), outcome);
    expect(run.firstResolveMs).toBe(-1);
    expect(outcomeMatches(outcome, run)).toBe(false);
  });

  it("simulates a seed's first resolve and its end like the page plays it", () => {
    const s = settingsOf();
    const resolve = simulateOutcomeRun(5, request(s), { kind: "resolves-at", clipSec: 30, atSec: 5 });
    const engine = engineOf(s, 5);
    runTo(engine, 8);
    const planned = engine.getOrbGridView().resolveAtMs;
    expect(resolve.firstResolveMs).toBeGreaterThan(0);
    expect(Math.abs((resolve.firstResolveMs ?? 0) - planned)).toBeLessThanOrEqual(step + 1e-6);
    const still = simulateOutcomeRun(5, request(s), { kind: "never-settles", clipSec: 12 });
    expect([still.finished, Math.round(still.durationMs)]).toEqual([false, 12000]);
    expect(outcomeMatches({ kind: "never-settles", clipSec: 12 }, still)).toBe(true);
  });
});

describe("Bouncing Orbs: the orb states", () => {
  it("starts waiting at the drop height, flies, and comes to rest on the slab", () => {
    const engine = engineOf({ columns: 3, rows: 3, release: "row-by-row", stagger: 0.5, bounciness: 0.5, resolve: false }, 1);
    const v = engine.getOrbGridView();
    expect(Array.from(v.state).every((st) => st === OG_WAITING)).toBe(true);
    runTo(engine, 0.6);
    expect(v.state[0]).toBe(OG_FLYING);
    expect(v.state[8]).toBe(OG_WAITING);
    expect(v.height[8]).toBeCloseTo(v.drop[8], 9);
    runTo(engine, 20);
    expect(Array.from(v.state).every((st) => st === OG_SETTLED)).toBe(true);
    expect(Array.from(v.height).every((h) => h === 0)).toBe(true);
  });
});

describe("Bouncing Orbs: the page", () => {
  it("drops a found seed's promise with the seed when the field or the variation changes (Simulator.tsx)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/components/simulator/Simulator.tsx"), "utf8");
    const effects = [...src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[([^\]]*)\]\);/g)].filter((m) => m[2].includes("s.ogColumns"));
    const unpinning = effects.filter((m) => m[1].includes("setSeed(null)"));
    expect(unpinning.length).toBeGreaterThanOrEqual(1);
    // (the found result's "Found! … / Ready to start simulation for …" and the do-not-change warning go with the seed)
    for (const m of unpinning) expect(m[1]).toContain("setSearchResult((r) => (r?.found ? null : r))");
  });
});

// --- orb-rhythm ---
/* ================================================================== the rhythm model (feature orb-rhythm) */

/** A rhythm field's settings (the default model since the orb-rhythm rework) and its engine. */
const rhythmOf = (patch: Partial<OrbGridSettings> = {}): OrbGridSettings => ({ ...DEFAULT_ORB_GRID_SETTINGS, ...patch });
const rhythmEngine = (patch: Partial<OrbGridSettings> = {}, seed = 1) => createEngineForSettings(config, "orbGrid", { orbGrid: rhythmOf(patch) } as unknown as ModeSettings, seed);
/** A rhythm plan of these settings on their layout (`random` null: the varied preset's fixed sequence). */
const rhythmPlan = (patch: Partial<OrbGridSettings> = {}, gravityScale = 1, random: (() => number) | null = null) => {
  const s = rhythmOf(patch);
  return planOrbRhythm(s, buildOrbLayout(s.arrangement, s.columns, s.rows), gravityScale, random);
};
/** The highest orb of a plan at `t` (seconds): 0 when every orb is on the slab. */
const fieldTop = (plan: ReturnType<typeof planOrbRhythm>, t: number) => {
  let top = 0;
  for (let i = 0; i < plan.count; i++) top = Math.max(top, bounceHeight(t, plan.apex[i], plan.freq[i], plan.phase[i]));
  return top;
};
/** A Park–Miller generator (the tests' own seeded draws). */
const seeded = (seed: number) => {
  let x = seed;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
};
const fnv = (h: number, n: number) => Math.imul(h ^ (n & 0xffffffff), 0x01000193) >>> 0;
/** FNV-1a over sound events: pitches, levels, chords, the orb sound and the accent (the decay baseline's hash). */
function soundHash(events: readonly SoundEvent[], h: number): number {
  const mix = (n: number) => {
    h ^= n & 0xffffffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const ev of events) {
    mix(Math.round((ev.frequency ?? 0) * 1000));
    mix(Math.round((ev.level ?? 0) * 1e6));
    for (const f of ev.chord ?? []) mix(Math.round(f * 1000));
    mix(ev.orb === "sleep" ? 1 : ev.orb === "metal" ? 2 : 0);
    mix(ev.accent ? 1 : 0);
  }
  return h;
}
/** Runs `engine` to `seconds` in frames of `frameMs`, hashing every sound it makes. */
function runWithSound(engine: ReturnType<typeof engineOf>, seconds: number, frameMs = step): string {
  let h = 0x811c9dc5;
  while (engine.getOrbGridView().timeMs < seconds * 1000 - 1e-6 && !engine.isSimulationFinished()) {
    engine.update(frameMs, 0);
    h = soundHash(engine.consumeSoundEvents(), h);
  }
  return h.toString(16);
}
/** FNV-1a over a rhythm run: the heights at its step and its counters. */
function rhythmPrint(engine: ReturnType<typeof engineOf>): string {
  const v = engine.getOrbGridView();
  let h = 0x811c9dc5;
  for (let i = 0; i < v.count; i++) h = fnv(h, Math.round(v.height[i] * 1e6));
  for (const n of [v.bounces, v.resolves, Math.round(v.lastResolveMs), v.beatsSoFar, v.clicks, v.voices, v.notes, v.melodyNotes, Math.round(v.timeMs * 1000)]) h = fnv(h, n);
  return h.toString(16);
}
/**
 * The page's loop (Canvas.tsx) – the fast export's too, which calls it once per frame on its own clock: each frame adds its
 * time to the page's accumulator, the engine is fed in 16.666 ms updates (its fixed 60 Hz steps inside) and the frame is drawn
 * at its own simulation time (`orbRenderTimeMs()`). `onFrame` gets the frame number (from 1), that time (ms) and its sounds.
 */
function pageLoop(engine: ReturnType<typeof engineOf>, frames: number, frameMs: number, onFrame: (k: number, timeMs: number, events: SoundEvent[]) => void) {
  let acc = 0;
  for (let k = 1; k <= frames; k++) {
    acc += frameMs;
    if (acc > 250) acc = 250;
    while (acc >= 16.666) {
      engine.update(16.666, 0);
      acc -= 16.666;
    }
    const v = engine.getOrbGridView();
    onFrame(k, orbRenderTimeMs(engine.getElapsedMs(), engine.getStepRemainderMs(), acc, v.stepMs, v.finished ? v.finishedMs : -1), engine.consumeSoundEvents());
  }
}
const rhythmRequest = (s: OrbGridSettings): FinderRequest => ({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 60, physicsConfig: config, mode: "orbGrid", modeSettings: { orbGrid: { ...s, maxSec: 0 } } as unknown as ModeSettings });

describe("Bouncing Orbs rhythm: the ideal bouncer", () => {
  it("bounces on the parabola h(t) = A · 4u(1 − u): on the slab at every landing, the apex half a bounce later, A = g T² / 8", () => {
    const f = 53 / 30;
    const T = 1 / f;
    const A = 0.27;
    for (let k = 0; k <= 53; k++) {
      expect(bounceHeight(k * T, A, f, 0)).toBeLessThan(1e-9);
      expect(bounceHeight((k + 0.5) * T, A, f, 0)).toBeCloseTo(A, 9);
      expect(bounceHeight((k + 0.2) * T, A, f, 0)).toBeCloseTo(bounceHeight((k + 0.8) * T, A, f, 0), 9); // (symmetric about the apex)
      expect(landingsUpTo(k * T, f, 0)).toBe(k);
      expect(landingsUpTo((k + 0.999) * T, f, 0)).toBe(k);
    }
    // A free flight: its curvature is −g with g = 8A / T², so the apex of a bounce of period T under g is g T² / 8 – the
    // height a launch at g T / 2 (up for T / 2, down for T / 2) climbs to.
    const g = (8 * A) / (T * T);
    const e = 1e-4;
    const t0 = 7.3 * T;
    const curvature = (bounceHeight(t0 + e, A, f, 0) - 2 * bounceHeight(t0, A, f, 0) + bounceHeight(t0 - e, A, f, 0)) / (e * e);
    expect(curvature / -g).toBeCloseTo(1, 4);
    expect(apexOf(g, T)).toBeCloseTo(A, 12);
    expect(apexOf(g, T)).toBeCloseTo((g * T) ** 2 / 4 / (2 * g), 12);
    // The phase (in bounces) shifts the whole bounce.
    for (const t of [0.1, 1.7, 12.25]) expect(bounceHeight(t, A, f, 0.35)).toBeCloseTo(bounceHeight(t - 0.35 * T, A, f, 0), 9);
    for (const t of [0, 0.3, 5.5, 29.99]) {
      expect(bouncePhase(t, f, 0.2)).toBeGreaterThanOrEqual(0);
      expect(bouncePhase(t, f, 0.2)).toBeLessThan(1);
    }
  });

  it("eases the landing squash out over SQUASH_SEC: full at the landing, gone 60 ms later", () => {
    const f = 1.7;
    expect(SQUASH_SEC).toBeCloseTo(0.06, 9);
    expect(squashOf(0, f)).toBe(1);
    expect(squashOf(0.5 * SQUASH_SEC * f, f)).toBeCloseTo(0.25, 9);
    expect(squashOf(SQUASH_SEC * f, f)).toBeCloseTo(0, 9);
    expect(squashOf(0.5, f)).toBe(0);
    let last = 2;
    for (let k = 0; k <= 20; k++) {
      const q = squashOf((k / 20) * SQUASH_SEC * f, f);
      expect(q).toBeLessThanOrEqual(last);
      last = q;
    }
  });

  it("plans every orb an ideal bouncer: f = n / L, the slowest at the drop height, every other apex g T² / 8 (faster ones lower); equal heights alike", () => {
    const L = 30;
    const H = DEFAULT_ORB_GRID_SETTINGS.dropHeight;
    const patch = { columns: 9, rows: 9, rhythm: "pendulum" as const, group: "rows" as const };
    const plan = rhythmPlan(patch);
    const grid = buildOrbLayout("grid", 9, 9);
    expect(plan.groups).toBe(9);
    expect(Array.from(plan.groupCount)).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(plan.clock.cycleSec).toBe(L);
    expect(plan.gravity).toBeCloseTo((8 * H) / (L / 51) ** 2, 9);
    for (let i = 0; i < plan.count; i++) {
      const n = 51 + grid.row[i];
      expect(plan.group[i]).toBe(grid.row[i]);
      expect(plan.freq[i] * L).toBeCloseTo(n, 9);
      expect(plan.phase[i]).toBe(0);
      expect(plan.apex[i]).toBeCloseTo(apexOf(plan.gravity, L / n), 6);
      expect(plan.apex[i]).toBeCloseTo(H * (51 / n) ** 2, 6);
    }
    expect(plan.maxApex).toBeCloseTo(H, 6);
    // The Gravity slider scales every apex (the periods are the cycle's); equal heights put every apex at the drop height.
    const heavy = rhythmPlan(patch, 2);
    const equal = rhythmPlan({ ...patch, equalHeights: true });
    for (let i = 0; i < plan.count; i++) {
      expect(heavy.apex[i]).toBeCloseTo(2 * plan.apex[i], 6);
      expect(heavy.freq[i]).toBe(plan.freq[i]);
      expect(equal.apex[i]).toBeCloseTo(H, 6);
      expect(equal.freq[i]).toBe(plan.freq[i]);
    }
    // The engine plays the plan: its heights at every step are the formula's, its bounces the landings so far.
    const engine = rhythmEngine(patch, 3);
    runTo(engine, 2.345);
    const v = engine.getOrbGridView();
    expect(v.model).toBe("rhythm");
    for (let i = 0; i < v.count; i++) {
      expect(v.freq[i]).toBe(plan.freq[i]);
      expect(v.height[i]).toBeCloseTo(bounceHeight(v.timeMs / 1000, plan.apex[i], plan.freq[i], 0), 5);
    }
    expect(v.bounces).toBe(Array.from(v.freq).reduce((sum, fi) => sum + landingsUpTo(v.timeMs / 1000, fi, 0), 0));
    expect([v.released, v.settled, v.moving]).toEqual([81, 0, 81]);
  });
});

describe("Bouncing Orbs rhythm: polyrhythms", () => {
  it("gives every rhythm preset its bounce counts a cycle (T_k = L / n_k) and its in-phase period", () => {
    const L = 30;
    const bars = 15; // (the metronome off: the cycle in bars of 120 BPM 4/4 – the ratio voices' unit)
    const covered = new Set<OgRhythm>();
    const ratioCounts = (voices: readonly number[]) => Array.from({ length: 12 }, (_, k) => voices[k % voices.length] * bars);
    const expected: [OgRhythm, number[]][] = [
      ["pendulum", Array.from({ length: 12 }, (_, k) => PENDULUM_BASE + k)],
      ["3-2", ratioCounts([3, 2])],
      ["4-3", ratioCounts([4, 3])],
      ["5-4", ratioCounts([5, 4])],
      ["7-5", ratioCounts([7, 5])],
      ["3-4-5", ratioCounts([3, 4, 5])],
      ["euclid", euclidOnsets(12, 16).map((o) => RHYTHM_BASE + o)],
    ];
    for (const [rhythm, counts] of expected) {
      const plan = rhythmPlan({ columns: 12, rows: 12, rhythm, group: "rows" });
      expect(Array.from(plan.groupCount), rhythm).toEqual(counts);
      for (let i = 0; i < plan.count; i++) expect(plan.freq[i] * L, rhythm).toBeCloseTo(counts[plan.group[i]], 9);
      const ratio = (RHYTHM_RATIOS as Record<string, readonly number[] | undefined>)[rhythm];
      // the ratio voices meet on every downbeat (a bar), the others once a cycle
      expect(plan.periodSec, rhythm).toBeCloseTo(ratio ? L / bars : L, 9);
      covered.add(rhythm);
    }
    expect(euclidOnsets(12, 16)).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]);
    expect(euclidPattern(5, 8)).toEqual([1, 1, 0, 1, 1, 0, 1, 0]); // (the cinquillo, rotated)
    expect(euclidPattern(3, 8)).toEqual([1, 0, 1, 0, 0, 1, 0, 0]); // (the tresillo, rotated)
    // Corner to corner: the diagonals, 51 · (1 + spread · x) – one corner slowest, the opposite one fastest.
    const spread = DEFAULT_ORB_GRID_SETTINGS.spread;
    const corner = rhythmPlan({ columns: 12, rows: 12, rhythm: "corner" });
    expect(corner.groups).toBe(23);
    for (let k = 0; k < 23; k++) expect(corner.groupCount[k]).toBe(Math.round(51 * (1 + (spread * k) / 22)));
    expect(corner.periodSec).toBeCloseTo(L, 9);
    covered.add("corner");
    // Centre outwards: rings from the centre orb out.
    const centre = rhythmPlan({ columns: 11, rows: 11, rhythm: "centre" });
    const grid = buildOrbLayout("grid", 11, 11);
    expect(centre.group[60]).toBe(0); // (the centre orb)
    for (let i = 0; i < centre.count; i++) {
      expect(centre.group[i]).toBe(groupIndex(grid, "rings", i));
      expect(centre.freq[i] * L).toBeCloseTo(Math.round(51 * (1 + (spread * centre.group[i]) / (centre.groups - 1))), 9);
    }
    expect(centre.periodSec).toBeCloseTo(L, 9);
    covered.add("centre");
    // Varied: every orb its own whole count, 51 … 51 + round(51 · spread), drawn from the seed.
    const a = rhythmPlan({ columns: 12, rows: 12, rhythm: "varied" }, 1, seeded(7));
    const b = rhythmPlan({ columns: 12, rows: 12, rhythm: "varied" }, 1, seeded(7));
    const c = rhythmPlan({ columns: 12, rows: 12, rhythm: "varied" }, 1, seeded(8));
    for (let i = 0; i < a.count; i++) {
      const n = a.freq[i] * L;
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
      expect(n).toBeGreaterThanOrEqual(51);
      expect(n).toBeLessThanOrEqual(51 + Math.round(51 * spread));
    }
    expect(Array.from(a.freq)).toEqual(Array.from(b.freq));
    expect(Array.from(a.freq)).not.toEqual(Array.from(c.freq));
    expect(a.tempos).toBe(a.groups);
    expect(a.tempos).toBeGreaterThan(20);
    expect(a.periodSec).toBeCloseTo(L, 9);
    covered.add("varied");
    expect([...covered].sort()).toEqual([...OG_RHYTHMS].sort());
    expect([gcd(45, 30), gcd(51, 52), gcd(0, 7)]).toEqual([15, 1, 7]);
    expect(inPhasePeriodSec([45, 30], L, true)).toBe(2);
    expect(inPhasePeriodSec([51, 52], L, false)).toBe(Infinity);
  });

  it("lands every orb together at t = 0 and at every multiple of L – never between (the ratio voices: on every downbeat)", () => {
    const L = 4;
    for (const rhythm of ["pendulum", "euclid", "corner", "centre", "varied"] as const) {
      const plan = rhythmPlan({ columns: 7, rows: 7, rhythm, group: "rows", cycle: L }, 1, seeded(3));
      expect(plan.periodSec, rhythm).toBeCloseTo(L, 9);
      for (let k = 0; k <= 3; k++) expect(fieldTop(plan, k * L), `${rhythm} at ${k}L`).toBeLessThan(1e-9 * plan.maxApex);
      // between: on a 4 ms grid over two cycles some orb is always in the air
      let lowest = Infinity;
      for (let j = 1; j < 2000; j++) if (j !== 1000) lowest = Math.min(lowest, fieldTop(plan, (j * 2 * L) / 2000));
      expect(lowest / plan.maxApex, rhythm).toBeGreaterThan(0.01);
    }
    for (const rhythm of ["3-2", "4-3", "5-4", "7-5", "3-4-5"] as const) {
      const plan = rhythmPlan({ columns: 6, rows: 6, rhythm, group: "rows", cycle: 8 });
      const bar = plan.clock.barSec;
      expect(plan.periodSec, rhythm).toBeCloseTo(bar, 9);
      for (let m = 0; m <= 4; m++) expect(fieldTop(plan, m * bar), `${rhythm} on downbeat ${m}`).toBeLessThan(1e-9 * plan.maxApex);
      let lowest = Infinity;
      for (let j = 1; j < 500; j++) lowest = Math.min(lowest, fieldTop(plan, (j * bar) / 500));
      expect(lowest / plan.maxApex, rhythm).toBeGreaterThan(0.005);
    }
  });

  it("counts IN PHASE in the engine at exactly every multiple of L – the counter, the banner, the chord; never with the polyrhythm off", () => {
    const engine = rhythmEngine({ columns: 6, rows: 6, cycle: 4, rhythm: "pendulum", group: "rows" }, 2);
    const v = engine.getOrbGridView();
    const moments: number[] = [];
    let chords = 0;
    while (v.timeMs < 9000) {
      engine.update(step, 0);
      for (const ev of engine.consumeSoundEvents()) if (ev.accent && ev.chord?.length === 4) chords++;
      if (v.resolves > moments.length) moments.push(v.timeMs);
    }
    expect([v.resolves, v.resolveAtMs, v.lastResolveMs, v.resolvePlanMs, v.periodMs, v.cycleMs]).toEqual([2, 4000, 8000, 4000, 4000, 4000]);
    expect(moments.length).toBe(2);
    moments.forEach((ms, k) => {
      expect(ms).toBeGreaterThanOrEqual(4000 * (k + 1) - 1e-6);
      expect(ms).toBeLessThan(4000 * (k + 1) + step);
    });
    expect(chords).toBe(2);
    expect(inPhaseBannerOn(v, 8000)).toBe(true);
    expect(inPhaseBannerOn(v, 8000 + IN_PHASE_HOLD_MS - 1)).toBe(true);
    expect(inPhaseBannerOn(v, 8000 + IN_PHASE_HOLD_MS)).toBe(false);
    expect(inPhaseBannerOn(v, 7999)).toBe(false);
    expect(orbGridBanner(v, DEFAULT_ORB_GRID_LABELS)).toEqual({ title: "IN PHASE", sub: "36 orbs land together at 8.0s" });
    // The polyrhythm off: one tempo, the phase shifting across the field – a travelling wave that never resolves.
    const off = rhythmEngine({ columns: 6, rows: 6, cycle: 4, poly: false }, 2);
    runTo(off, 9);
    const o = off.getOrbGridView();
    expect([o.resolves, o.resolveAtMs, o.periodMs, o.resolvePlanMs, o.tempos]).toEqual([0, -1, Infinity, 0, 1]);
    expect(new Set(Array.from(o.freq)).size).toBe(1);
    expect(new Set(Array.from(o.phase)).size).toBeGreaterThan(5);
    expect(inPhaseBannerOn(o, 8000)).toBe(false);
  });

  it("ends a clip on an IN PHASE moment as IN PHASE and between two as TIME! with the cycle; without a clip it never ends", () => {
    const at = rhythmEngine({ columns: 6, rows: 6, cycle: 4, maxSec: 8 }, 2);
    runTo(at, 10);
    const a = at.getOrbGridView();
    expect([a.finished, a.finishReason, Math.round(a.finishedMs), a.resolves]).toEqual([true, "phase", 8000, 2]);
    expect(orbGridBanner(a, DEFAULT_ORB_GRID_LABELS)).toEqual({ title: "IN PHASE", sub: "36 orbs land together at 8.0s" });
    const between = rhythmEngine({ columns: 6, rows: 6, cycle: 4, maxSec: 6 }, 2);
    runTo(between, 10);
    const b = between.getOrbGridView();
    expect([b.finished, b.finishReason, Math.round(b.finishedMs), b.resolves]).toEqual([true, "time", 6000, 1]);
    expect(orbGridBanner(b, DEFAULT_ORB_GRID_LABELS)).toEqual({ title: "TIME!", sub: "in phase every 4.0s" });
    const endless = rhythmEngine({ columns: 6, rows: 6, cycle: 4 }, 2);
    runTo(endless, 20);
    expect(endless.isSimulationFinished()).toBe(false);
    expect(endless.getOrbGridView().resolves).toBe(5);
    expect(endless.getOrbGridView().settled).toBe(0);
  });
});

describe("Bouncing Orbs rhythm: the metronome", () => {
  it("snaps the cycle to whole bars while it is on (L = bars · beats · 60 / BPM): every IN PHASE moment lands on a downbeat", () => {
    const off = beatClock(rhythmOf());
    expect([off.on, off.cycleSec, off.bpm, off.beatSec, off.beats, off.barSec, off.bars]).toEqual([false, 30, 120, 0.5, 4, 2, 15]);
    const bar = beatClock(rhythmOf({ metro: "bar" }));
    expect([bar.on, bar.cycleSec, bar.bars]).toEqual([true, 32, 16]);
    expect(beatClock(rhythmOf({ click: 0.4 })).cycleSec).toBe(32); // (the click alone turns it on)
    expect(cycleSeconds(rhythmOf({ metro: "dot", bpm: 90, beats: 3, bars: 8 }))).toBeCloseTo(16, 9);
    // The beat lock's tempo leads while the lock is on.
    expect(metronomeBpm({ bpm: 120, syncBpm: 100 })).toBe(100);
    expect(metronomeBpm({ bpm: 120, syncBpm: 0 })).toBe(120);
    expect(cycleSeconds(rhythmOf({ metro: "ring", syncBpm: 100 }))).toBeCloseTo(38.4, 9);
    expect(orbGridSettingsOf({ ...defaultSettings("orbGrid"), quantizeToBeat: true, bpm: 100 }).syncBpm).toBe(100);
    expect(orbGridSettingsOf({ ...defaultSettings("orbGrid"), quantizeToBeat: false, bpm: 100 }).syncBpm).toBe(0);
    // Every IN PHASE moment k · L is a downbeat.
    for (const s of [rhythmOf({ metro: "bar" }), rhythmOf({ metro: "dot", bpm: 90, beats: 3, bars: 8 }), rhythmOf({ click: 0.3, bpm: 137, beats: 7, bars: 5 })]) {
      const c = beatClock(s);
      for (let k = 1; k <= 3; k++) {
        const beats = (k * c.cycleSec) / c.beatSec;
        expect(Math.abs(beats - Math.round(beats))).toBeLessThan(1e-9);
        expect(Math.round(beats) % c.beats).toBe(0);
      }
    }
    // The ratio voices land on their bar's subdivisions (3 and 2 a bar) and all meet on every downbeat.
    const plan = rhythmPlan({ columns: 4, rows: 4, rhythm: "3-2", group: "checker", metro: "bar" });
    expect(Array.from(plan.groupCount)).toEqual([48, 32]);
    for (let i = 0; i < plan.count; i++) {
      const perBar = plan.freq[i] * plan.clock.barSec;
      expect([2, 3]).toContain(Math.round(perBar));
      expect(Math.abs(perBar - Math.round(perBar))).toBeLessThan(1e-9);
    }
    for (let m = 0; m <= 16; m++) expect(fieldTop(plan, m * plan.clock.barSec)).toBeLessThan(1e-9 * plan.maxApex);
  });

  it("clicks on every beat – the downbeat accented and louder, never dropped by the frame cap – and counts the beats", () => {
    const engine = rhythmEngine({ columns: 6, rows: 6, metro: "bar", click: 0.6 }, 4);
    const v = engine.getOrbGridView();
    const clicks: SoundEvent[] = [];
    while (v.timeMs < 5000 - 1e-6) {
      engine.update(4 * step, 0); // (4× playback: four steps a frame)
      for (const ev of engine.consumeSoundEvents()) if (ev.orb === "click") clicks.push(ev);
    }
    expect(beatsUpTo(v.timeMs / 1000, 0.5)).toBe(11);
    expect([v.metroOn, v.beatsSoFar, v.clicks, clicks.length]).toEqual([true, 11, 11, 11]);
    clicks.forEach((ev, b) => {
      const down = b % 4 === 0;
      expect(ev.frequency, `beat ${b}`).toBe(down ? CLICK_ACCENT_HZ : CLICK_HZ);
      expect(ev.level, `beat ${b}`).toBeCloseTo(down ? 0.6 : 0.6 * CLICK_BEAT_LEVEL, 9);
      expect(!!ev.accent, `beat ${b}`).toBe(down);
      expect(ev.melody).toBe(false);
    });
    expect([clickFrequency(0), clickFrequency(3)]).toEqual([CLICK_ACCENT_HZ, CLICK_HZ]);
    expect(clickLevel(1, 0.6)).toBeCloseTo(0.42, 9);
    expect(clickLevel(0, 0)).toBe(0);
    // The visual metronome alone keeps time without a sound; off, no beats at all.
    const quiet = rhythmEngine({ columns: 6, rows: 6, metro: "ring" }, 4);
    runTo(quiet, 5);
    expect([quiet.getOrbGridView().beatsSoFar, quiet.getOrbGridView().clicks]).toEqual([11, 0]);
    const none = rhythmEngine({ columns: 6, rows: 6 }, 4);
    runTo(none, 5);
    expect([none.getOrbGridView().metroOn, none.getOrbGridView().beatsSoFar, none.getOrbGridView().clicks]).toEqual([false, 0, 0]);
  });

  it("follows the beat lock: the Sound section's tempo while the lock is on", () => {
    const engine = createEngineForSettings(config, "orbGrid", { orbGrid: orbGridSettingsOf({ ...defaultSettings("orbGrid"), ogColumns: 4, ogRows: 4, ogMetro: "bar", quantizeToBeat: true, bpm: 150 }) } as unknown as ModeSettings, 1);
    const v = engine.getOrbGridView();
    expect(v.bpm).toBe(150);
    expect(v.beatMs).toBeCloseTo(400, 9);
    expect(v.cycleMs).toBeCloseTo(16 * 4 * 400, 6);
  });
});

describe("Bouncing Orbs rhythm: the melody", () => {
  it("gives every group its own pitch of the scale – the slowest tempo lowest – so the polyrhythm plays a tune", () => {
    const pendulum = rhythmPlan({ columns: 6, rows: 6, rhythm: "pendulum", group: "rows" });
    expect(PITCH_DEGREES).toBe(14);
    expect(Array.from(pendulum.groupDegree)).toEqual([0, 3, 6, 8, 11, 14]);
    expect(Array.from(rhythmPlan({ columns: 4, rows: 4, rhythm: "3-2", group: "checker" }).groupDegree)).toEqual([14, 0]); // (3 a bar above 2)
    // The run sings exactly those pitches (the IN PHASE chord aside) and counts the melody's notes.
    for (const sound of ["notes", "music"] as const) {
      const engine = rhythmEngine({ columns: 6, rows: 6, rhythm: "pendulum", group: "rows", melody: true, cycle: 4, sound }, 3);
      const v = engine.getOrbGridView();
      const { scale, rootNote } = v.settings;
      const pitches = new Set(Array.from(pendulum.groupDegree).map((d) => orbPitchHz(d, -1, scale, rootNote, 0).toFixed(3)));
      const chord = inPhaseDegrees(orbScaleIntervals(scale).length).map((d) => orbPitchHz(d, -1, scale, rootNote, 1).toFixed(3));
      expect(inPhaseDegrees(5)).toEqual([0, 2, 4, 5]);
      const heard = new Set<string>();
      let landingNotes = 0;
      let inPhase = 0;
      while (v.timeMs < 9000) {
        engine.update(step, 0);
        for (const ev of engine.consumeSoundEvents()) {
          const notes = ev.chord ?? [ev.frequency ?? 0];
          if (ev.accent && ev.chord?.length === 4) {
            expect(notes.map((f) => f.toFixed(3))).toEqual(chord);
            inPhase++;
            continue;
          }
          expect(notes.length, sound).toBe(1); // (a group sings one pitch, however many of its orbs land)
          for (const f of notes) {
            expect(pitches.has(f.toFixed(3)), `${sound}: ${f}`).toBe(true);
            heard.add(f.toFixed(3));
          }
          landingNotes += notes.length;
        }
      }
      expect(inPhase, sound).toBe(2);
      // every group sings its notes (the music variant sings one note at a time – the loudest landing's – so most of them)
      expect(heard.size, sound).toBeGreaterThanOrEqual(sound === "notes" ? 6 : 4);
      expect(v.melodyNotes, sound).toBe(landingNotes);
      expect(landingNotes, sound).toBeGreaterThan(20);
    }
    // Without the melody a row's landings sing a chord of its columns, as before (no melody notes counted).
    const plain = rhythmEngine({ columns: 6, rows: 6, rhythm: "pendulum", group: "rows", cycle: 4 }, 3);
    let chords = 0;
    for (let k = 0; k < 300; k++) {
      plain.update(step, 0);
      for (const ev of plain.consumeSoundEvents()) if (!ev.accent && ev.chord?.length === MAX_CHORD_NOTES) chords++;
    }
    expect(chords).toBeGreaterThan(10);
    expect(plain.getOrbGridView().melodyNotes).toBe(0);
  });
});

describe("Bouncing Orbs rhythm: frame rates, replays and the fast export", () => {
  it("replays a seed identically at 30, 60 and 120 frames a second: the run, its sounds and the heights drawn", () => {
    const patch = { columns: 12, rows: 12, rhythm: "varied" as const, metro: "dot" as const, click: 0.5, bpm: 150, bars: 2, melody: true };
    // (2 bars of 4 at 150 BPM: a 3.2 s cycle – two IN PHASE moments in the 8 s)
    const runs = new Map<number, { print: string; sound: string; drawn: number[] }>();
    for (const fps of [30, 60, 120]) {
      const engine = rhythmEngine(patch, 21);
      const v = engine.getOrbGridView();
      const out = new Float32Array(v.count);
      let sound = 0x811c9dc5;
      const drawn: number[] = [];
      pageLoop(engine, 8 * fps, 1000 / fps, (k, t, events) => {
        sound = soundHash(events, sound);
        if (k % (fps / 30) !== 0) return; // (the frames all three rates draw: every 1/30 s)
        sampleOrbHeights(v, t / 1000, out);
        let sum = 0;
        for (let i = 0; i < v.count; i++) sum += out[i] * (1 + (i % 7));
        drawn.push(sum);
      });
      expect(v.resolves, `${fps} fps`).toBe(2);
      expect(v.clicks, `${fps} fps`).toBeGreaterThan(15);
      runs.set(fps, { print: rhythmPrint(engine), sound: sound.toString(16), drawn });
    }
    const ref = runs.get(60)!;
    for (const fps of [30, 120]) {
      const r = runs.get(fps)!;
      expect(r.print, `${fps} fps`).toBe(ref.print);
      expect(r.sound, `${fps} fps`).toBe(ref.sound);
      expect(r.drawn.length).toBe(ref.drawn.length);
      r.drawn.forEach((d, k) => expect(d, `${fps} fps, frame ${k}`).toBeCloseTo(ref.drawn[k], 5));
    }
    // another seed: another varied field
    const other = rhythmEngine(patch, 22);
    pageLoop(other, 8 * 60, 1000 / 60, () => {});
    expect(rhythmPrint(other)).not.toBe(ref.print);
  });

  it("draws the fast export's frames at their exact times – t = k / fps, one engine step behind – a new height every frame", () => {
    for (const fps of [24, 30, 50, 60, 120]) {
      const engine = rhythmEngine({ columns: 5, rows: 5, cycle: 4, maxSec: 3 }, 1);
      const v = engine.getOrbGridView();
      const frameMs = 1000 / fps;
      const out = new Float32Array(v.count);
      let last = -1;
      pageLoop(engine, 4 * fps, frameMs, (k, t) => {
        const exact = Math.min(Math.max(0, k * frameMs - 1000 / 60), v.finished ? v.finishedMs : Infinity);
        expect(t, `${fps} fps, frame ${k}`).toBeCloseTo(exact, 6);
        if (last > 0 && exact < 3000 - 1e-6) expect(t, `${fps} fps, frame ${k}`).toBeGreaterThan(last);
        last = t;
        sampleOrbHeights(v, t / 1000, out);
        for (let i = 0; i < v.count; i++) expect(out[i]).toBeCloseTo(bounceHeight(exact / 1000, v.apex[i], v.freq[i], v.phase[i]), 5);
      });
      expect(v.finished).toBe(true);
      expect(last).toBeCloseTo(3000, 6);
    }
    // a frame is never more than a step from the engine's time, never before 0, never past a finished run's end; a stretched
    // step (bounce math's timeScale rule) stretches the frame's share of it
    const F = 1000 / 60;
    expect(orbRenderTimeMs(1000, 10, 5, F)).toBeCloseTo(1000 + 15 - F, 9);
    expect(orbRenderTimeMs(1000, 30, 30, F)).toBeCloseTo(1000 + F, 9);
    expect(orbRenderTimeMs(0, 0, 5, F)).toBe(0);
    expect(orbRenderTimeMs(3000, 10, 10, F, 3000)).toBe(3000);
    expect(orbRenderTimeMs(1000, 10, 5, 2 * F)).toBeCloseTo(1000 + 2 * (15 - F), 9);
  });

  it("moves smoothly: the heights drawn at 120 fps never step (second differences under 2 % of the apex between landings)", () => {
    const engine = rhythmEngine({ columns: 12, rows: 12 }, 5);
    const v = engine.getOrbGridView();
    const picks = [0, 37, 71, 143];
    const drawn = picks.map(() => [] as number[]);
    const stepped = picks.map(() => [] as number[]);
    const times: number[] = [];
    const out = new Float32Array(v.count);
    pageLoop(engine, 3 * 120, 1000 / 120, (k, t) => {
      sampleOrbHeights(v, t / 1000, out);
      times.push(t);
      picks.forEach((i, j) => {
        drawn[j].push(out[i]);
        stepped[j].push(v.height[i]);
      });
    });
    let worstDrawn = 0;
    let worstStepped = 0;
    picks.forEach((i, j) => {
      const A = v.apex[i];
      for (let k = 1; k + 1 < times.length; k++) {
        if (times[k - 1] <= 0) continue;
        // a landing between the neighbours turns the motion round: that is the bounce, not a step
        if (landingsUpTo(times[k + 1] / 1000, v.freq[i], v.phase[i]) !== landingsUpTo(times[k - 1] / 1000, v.freq[i], v.phase[i])) continue;
        worstDrawn = Math.max(worstDrawn, Math.abs(drawn[j][k + 1] - 2 * drawn[j][k] + drawn[j][k - 1]) / A);
        worstStepped = Math.max(worstStepped, Math.abs(stepped[j][k + 1] - 2 * stepped[j][k] + stepped[j][k - 1]) / A);
      }
    });
    expect(worstDrawn).toBeLessThan(0.02);
    // the engine's own 60 Hz heights shown at 120 fps repeat every other frame: steps the check catches
    expect(worstStepped).toBeGreaterThan(0.02);
  });

  it("draws a decaying field between its steps too: the engine's heights at a step, the closed-form flight between", () => {
    const engine = engineOf({ columns: 8, rows: 8 }, 4);
    const v = engine.getOrbGridView();
    const out = new Float32Array(v.count);
    const mid = new Float32Array(v.count);
    let moved = 0;
    for (let k = 0; k < 240; k++) {
      engine.update(step, 0);
      engine.consumeSoundEvents();
      sampleOrbHeights(v, v.timeMs / 1000, out);
      for (let i = 0; i < v.count; i++) expect(out[i], `step ${k}, orb ${i}`).toBeCloseTo(v.height[i], 5);
      sampleOrbHeights(v, (v.timeMs + step / 2) / 1000, mid);
      for (let i = 0; i < v.count; i++) {
        expect(mid[i]).toBeGreaterThanOrEqual(0);
        if (Math.abs(mid[i] - out[i]) > 1e-6) moved++;
      }
    }
    expect(moved).toBeGreaterThan(1000);
  });
});

describe("Bouncing Orbs rhythm: outcomes, Find Simulation and captions", () => {
  it("never settles – only the clip ends a rhythm run: In phase at instead of never-settles (the decay keeps both)", () => {
    expect(orbGridNeverSettles(rhythmOf())).toBe(true);
    expect(orbGridNominalRunSec(rhythmOf())).toBe(Infinity);
    expect(runNeverFinishes("orbGrid", { orbGrid: rhythmOf() } as unknown as Parameters<typeof runNeverFinishes>[1])).toBe(true);
    expect(availableOutcomes("orbGrid", { endless: true, neverEscape: false, ballCount: 1, orbRhythm: true })).toEqual(["resolves-at"]);
    expect(availableOutcomes("orbGrid", { endless: false, neverEscape: false, ballCount: 1, orbRhythm: false })).toEqual(["duration", "never-settles", "resolves-at"]);
    const summary = orbGridSummary(rhythmOf());
    expect([summary.count, summary.settleSec, summary.resolveSec]).toEqual([1089, Infinity, 30]);
    expect(orbGridSummary(rhythmOf({ poly: false })).resolveSec).toBe(0);
    const r = orbRhythmSummary(rhythmOf());
    expect([r.count, r.groups, r.tempos, r.minCount, r.maxCount, r.cycleSec, r.periodSec, r.metroOn]).toEqual([1089, 65, 65, 51, 115, 30, 30, false]);
  });

  it("answers 'In phase at' at once by the cycle maths – any seed, no search – and the seed keeps the promise", async () => {
    const outcome = (atSec: number) => ({ kind: "resolves-at" as const, clipSec: 35, atSec });
    expect(orbRhythmFinderAnswer(rhythmOf(), outcome(30))).toMatchObject({ found: true, resolveAt: 30, orbCycle: 30, seedsTested: 0, outcome: "resolves-at", duration: 35 });
    expect(orbRhythmFinderAnswer(rhythmOf(), outcome(60.4))).toMatchObject({ found: true, resolveAt: 60 });
    expect(orbRhythmFinderAnswer(rhythmOf(), outcome(25))).toMatchObject({ found: false, resolveAt: 30, duration: 30, orbCycle: 30 });
    // the metronome's whole bars move the moments: 16 bars of 4 at 120 BPM – every 32 s
    expect(orbRhythmFinderAnswer(rhythmOf({ metro: "bar" }), outcome(30))).toMatchObject({ found: false, resolveAt: 32, orbCycle: 32 });
    // the polyrhythm off: never in phase
    const never = orbRhythmFinderAnswer(rhythmOf({ poly: false }), outcome(30))!;
    expect(never.found).toBe(false);
    expect(Number.isNaN(never.orbCycle)).toBe(true);
    expect(never.resolveAt).toBeUndefined();
    // the decay model searches its seeds as before
    expect(orbRhythmFinderAnswer(settingsOf(), outcome(30))).toBeNull();
    expect(rhythmResolveAnswer(4, true, 0, 0.5)).toEqual({ found: false, atSec: 4, cycleSec: 4 });
    expect(RHYTHM_RESOLVE_TOLERANCE_SEC).toBe(0.5);
    // Find Simulation resolves without simulating a frame…
    let frames = 0;
    const result = await findSimulation({ ...rhythmRequest(rhythmOf({ columns: 8, rows: 8 })), outcome: outcome(30) }, () => {}, undefined, () => 0, () => {
      frames++;
    });
    expect(result).toMatchObject({ found: true, resolveAt: 30, seedsTested: 0, orbCycle: 30 });
    expect(frames).toBe(0);
    // …and the run of its seed is in phase at 30 s
    const engine = rhythmEngine({ columns: 8, rows: 8, maxSec: 35 }, result.seed);
    runTo(engine, 31);
    expect(engine.getOrbGridView().resolveAtMs).toBeCloseTo(30000, 6);
  });

  it("answers a caption's question at the first IN PHASE moment (the decay model at its end, as before)", () => {
    const engine = rhythmEngine({ columns: 6, rows: 6, cycle: 4 }, 2);
    const tracker = new CaptionTracker();
    const until = (ms: number) => {
      while (engine.getOrbGridView().timeMs < ms) {
        engine.update(step, 0);
        engine.consumeSoundEvents();
        tracker.update(engine);
      }
    };
    until(3970);
    expect(tracker.state.revealAtSec).toBe(-1);
    until(4100);
    expect(tracker.state.revealAtSec).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(tracker.state.revealAtSec).toBeLessThan(4 + step / 1000 + 1e-6);
    expect(tracker.state.finished).toBe(false);
    const decay = engineOf({ columns: 6, rows: 6 }, 2);
    const decayTracker = new CaptionTracker();
    runTo(decay, 5);
    decayTracker.update(decay);
    expect(decayTracker.state.revealAtSec).toBe(-1);
  });
});

describe("Bouncing Orbs rhythm: the decay model unchanged", () => {
  it("replays the decay runs exactly as before the rework: fingerprints, sounds, resolves and voices", () => {
    const baseline: Record<number, [string, string]> = { 1: ["f2f3c874", "2763e2e4"], 77: ["3ed7bbfa", "225acd0b"], 4242: ["aabe2045", "9bb1fdd3"] };
    for (const seed of [1, 77, 4242]) {
      const e = engineOf({}, seed);
      const sound = runWithSound(e, 6);
      expect([fingerprint(e), sound], `seed ${seed}`).toEqual(baseline[seed]);
      expect(e.getOrbGridView().model).toBe("decay");
    }
    const presets: Record<string, [string, string, number, number, number]> = {
      varied: ["be2e70c5", "b33897b6", 5133.333333333338, 1088, 2931],
      metallic: ["3a48a7b", "5ed59c71", 5166.6666666666715, 281, 673],
      music: ["fff2b428", "53f47ca3", 5150.000000000005, 64, 64],
    };
    for (const [id, [print, sound, resolveAt, voices, notes]] of Object.entries(presets)) {
      const e = engineOf(decayPreset(id), 5);
      const hash = runWithSound(e, 12);
      const v = e.getOrbGridView();
      expect([fingerprint(e), hash, v.voices, v.notes], id).toEqual([print, sound, voices, notes]);
      expect(v.resolveAtMs, id).toBeCloseTo(resolveAt, 6);
    }
    const sleep = engineOf({ sound: "sleep", columns: 22, rows: 22 }, 6);
    const sleepHash = runWithSound(sleep, 6, 4 * step); // (4× playback: four steps a frame)
    expect([fingerprint(sleep), sleepHash, sleep.getOrbGridView().voices, sleep.getOrbGridView().notes]).toEqual(["85594abc", "426b149f", 14, 23]);
  });
});

describe("Bouncing Orbs rhythm: settings, links and presets", () => {
  it("round-trips the rhythm keys through a link and a preset (the keys are the field names); the defaults write none", () => {
    const s = { ...defaultSettings("orbGrid"), ogModel: "decay" as const, ogEq: true, ogSquash: false, ogPoly: false, ogGroup: "rings" as const, ogCycle: 12.5, ogRhythm: "euclid" as const, ogSteps: 7, ogBpm: 96, ogBeats: 3, ogMetro: "dot" as const, ogClick: 0.35, ogBars: 6, ogMelody: true };
    const keys = ["ogModel", "ogEq", "ogSquash", "ogPoly", "ogGroup", "ogCycle", "ogRhythm", "ogSteps", "ogBpm", "ogBeats", "ogMetro", "ogClick", "ogBars", "ogMelody"] as const;
    const params = settingsToSearchParams(s);
    for (const key of keys) expect(params.has(key), key).toBe(true);
    const back = settingsFromSearchParams(params);
    for (const key of keys) expect(back[key], key).toEqual(s[key]);
    const preset = presetToSettings(JSON.parse(JSON.stringify(s)));
    for (const key of keys) expect(preset[key], key).toEqual(s[key]);
    expect(defaultSettings("orbGrid").ogModel).toBe("rhythm");
    expect([...settingsToSearchParams(defaultSettings("orbGrid")).keys()].filter((k) => k.startsWith("og"))).toEqual([]);
    // no maximum on any number; invalid values fall back
    const big = { ...defaultSettings("orbGrid"), ogCycle: 600, ogBpm: 1000, ogBars: 500, ogBeats: 64, ogSteps: 100, ogClick: 3 };
    const bigBack = settingsFromSearchParams(settingsToSearchParams(big));
    for (const key of ["ogCycle", "ogBpm", "ogBars", "ogBeats", "ogSteps", "ogClick"] as const) expect(bigBack[key], key).toBe(big[key]);
    const bad = settingsFromSearchParams(new URLSearchParams("mode=orbGrid&ogModel=gravity&ogRhythm=waltz&ogGroup=spiral&ogMetro=gong&ogCycle=-4&ogBpm=abc"));
    expect([bad.ogModel, bad.ogRhythm, bad.ogGroup, bad.ogMetro, bad.ogCycle, bad.ogBpm]).toEqual(["rhythm", "pendulum", "diagonals", "off", 0.5, 120]);
  });

  it("gives every preset the rhythm of its clip; the metronome preset plays 3 against 2 on the swinging bar with the click", () => {
    const rhythms = Object.fromEntries(ORB_GRID_PRESETS.map((p) => [p.id, orbGridPresetFields(p).ogRhythm]));
    expect(rhythms).toEqual({ varied: "varied", corner: "corner", centre: "centre", octagons: "pendulum", metallic: "3-4-5", sleep: "centre", music: "pendulum", grid70: "corner", metronome: "3-2" });
    const metro = orbRhythmSummary(orbGridSettingsOf(orbGridPresetFields(ORB_GRID_PRESETS.find((p) => p.id === "metronome")!)));
    expect([metro.count, metro.groups, metro.tempos, metro.cycleSec, metro.periodSec, metro.metroOn, metro.bpm, metro.bars]).toEqual([576, 2, 2, 32, 2, true, 120, 16]);
    for (const preset of ORB_GRID_PRESETS) {
      const s = orbGridSettingsOf(orbGridPresetFields(preset));
      expect(s.model, preset.id).toBe("rhythm");
      const sum = orbRhythmSummary(s);
      const per = sum.cycleSec / sum.periodSec;
      expect(Math.abs(per - Math.round(per)), preset.id).toBeLessThan(1e-9); // (in phase at every cycle's end, at least)
    }
  });
});

describe("Bouncing Orbs rhythm: the visual metronome", () => {
  it("swings the bar to an end exactly on every beat, hops the dot onto every beat and pulses on it", () => {
    const beat = 0.5;
    for (let b = 0; b < 8; b++) {
      expect(Math.abs(swingAngle(b * beat, beat))).toBeCloseTo(SWING_MAX, 9);
      expect(Math.sign(swingAngle(b * beat, beat))).toBe(b % 2 === 0 ? -1 : 1);
      expect(swingAngle((b + 0.5) * beat, beat)).toBeCloseTo(0, 9);
    }
    const st: BeatState = { index: 0, inBar: 0, since: 0, progress: 0, pulse: 0 };
    expect(beatState(2.0, beat, 4, st)).toMatchObject({ index: 4, inBar: 0, progress: 0, pulse: 1 });
    const later = beatState(2.25, beat, 4, st);
    expect([later.index, later.inBar]).toEqual([4, 0]);
    expect(later.progress).toBeCloseTo(0.5, 9);
    expect(later.pulse).toBeLessThan(0.2);
    expect(beatState(3.75, beat, 3, st).inBar).toBe(1);
    expect([dotHopHeight(0), dotHopHeight(0.5), dotHopHeight(1)]).toEqual([0, 1, 0]);
    expect(MAX_BEAT_CELLS).toBeGreaterThanOrEqual(12);
    // A rhythm field that draws cheaply takes every refresh (a 120 Hz display: 120 frames), a heavy one keeps the 60 fps budget.
    const cost = new OrbFrameCost();
    expect(cost.fast).toBe(false);
    for (let i = 0; i < 60; i++) cost.note(2);
    expect(cost.fast).toBe(true);
    for (let i = 0; i < 60; i++) cost.note(12);
    expect(cost.fast).toBe(false);
    expect(ORB_HI_FPS_MAX_MS).toBe(5);
  });
});
// --- end orb-rhythm ---
