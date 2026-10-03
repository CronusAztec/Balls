import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORB_GRID_SETTINGS,
  OG_FLYING,
  OG_SETTLED,
  OG_WAITING,
  ORB_CEILING,
  ORB_GRID_PRESETS,
  ORB_GRID_RANGES,
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
  resolveOrbGridFields,
  resolveOrbGridSettings,
  tuneTimeScale,
  landingTime,
  type OrbGridSettings,
} from "@/lib/physics/modes/orbGrid";
import { MAX_CHORD_NOTES, MAX_NOTES_PER_STEP, MAX_ORB_EVENTS_PER_FRAME, createOrbGroupScratch, groupOrbLandings, orbMusicNext, orbPitchHz, orbScaleIntervals, type OrbLandings, type OrbVoice } from "@/lib/audio/orbTones";
import { CAMERA_DISTANCE, QUALITY_DISC_MAX, QUALITY_GLOSS_MAX, QUALITY_SHADOW_MAX, QUALITY_SPRITE_MAX, cameraAngleDeg, depthOrder, heightColor, orbCamera, orbQuality, projectPoint, type OrbCamera, type ProjectedPoint } from "@/components/simulator/orbGridRenderer";
import { createEngineForSettings, runNeverFinishes, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, outcomeMatches, outcomeMiss, outcomeSettled } from "@/lib/simulation/outcomes";
import { MODE_IDS, type PhysicsConfig } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { RANGES, defaultSettings, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

const config: PhysicsConfig = { width: 800, height: 450, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const settingsOf = (patch: Partial<OrbGridSettings> = {}): OrbGridSettings => ({ ...DEFAULT_ORB_GRID_SETTINGS, ...patch });
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
      const s = orbGridSettingsOf(orbGridPresetFields(preset));
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
    for (const [label, s] of [["default", settingsOf()], ["corner", orbGridSettingsOf(orbGridPresetFields(ORB_GRID_PRESETS.find((p) => p.id === "corner")!))]] as const) {
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
    expect(counts).toEqual({ varied: 1089, corner: 1892, centre: 440, octagons: 1352, metallic: 525, sleep: 484, music: 484, grid70: 4900 });
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
    expect(outcomeMatches({ kind: "never-settles", clipSec: 20 }, { ...base, durationMs: 15000, finished: true })).toBe(false);
    expect(outcomeMiss({ kind: "never-settles", clipSec: 20 }, { ...base, durationMs: 15000, finished: true })).toBe(5);
    expect(outcomeMatches({ kind: "resolves-at", clipSec: 30, atSec: 5 }, { ...base, firstResolveMs: 5400 })).toBe(true);
    expect(outcomeMatches({ kind: "resolves-at", clipSec: 30, atSec: 5 }, { ...base, firstResolveMs: 5600 })).toBe(false);
    expect(outcomeMatches({ kind: "resolves-at", clipSec: 30, atSec: 5 }, base)).toBe(false);
    expect(outcomeMiss({ kind: "resolves-at", clipSec: 30, atSec: 5 }, { ...base, firstResolveMs: 6000 })).toBeCloseTo(1, 9);
    expect(outcomeSettled({ kind: "resolves-at", clipSec: 30, atSec: 5 }, 3000, -1, false, "orbGrid", -1)).toBe(false);
    expect(outcomeSettled({ kind: "resolves-at", clipSec: 30, atSec: 5 }, 3000, -1, false, "orbGrid", 2900)).toBe(true);
    expect(outcomeSettled({ kind: "never-settles", clipSec: 10 }, 9000, -1, false, "orbGrid")).toBe(false);
    expect(outcomeSettled({ kind: "never-settles", clipSec: 10 }, 10000, -1, false, "orbGrid")).toBe(true);
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
