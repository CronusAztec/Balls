import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  ACCENT_CHORD_FRACTION,
  CHORD_WINDOW_SEC,
  DEFAULT_PENDULUM_SETTINGS,
  MAX_CHORD_NOTES,
  PENDULUM_LAYOUTS,
  PENDULUM_MAX_DEGREES,
  PENDULUM_POLYGONS,
  PENDULUM_RANGES,
  bounceHeight,
  buildPendulumField,
  buildPendulumRig,
  crossingTimes,
  eventPhases,
  groupChords,
  pendulumAngle,
  pendulumFrequencies,
  pendulumFrequency,
  pendulumPitch,
  pendulumSettingFields,
  pendulumSettingsOf,
  placeBob,
  placeBobAt,
  polygonRadius,
  relativeLengths,
  resolvePendulumSettings,
  type BobPlacement,
  type PendulumNote,
  type PendulumSettings,
} from "@/lib/physics/modes/pendulum";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import {
  MAX_TRAIL_POINTS,
  TRAIL_ALPHA,
  TRAIL_BANDS,
  TRAIL_MIN_ALPHA,
  TRAIL_POINTS_PER_SWING,
  drawPendulumTrails,
  trailAlpha,
  trailPointCount,
  trailReach,
  trailStepSec,
  trailTimeConstant,
  trailWindowSec,
  type TrailReach,
} from "@/components/simulator/pendulumRenderer";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { midiToFrequency } from "@/lib/audio/scales";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";

/**
 * Pendulum Wave (lib/physics/modes/pendulum.ts): the tuning maths (harmonic and phasing series, lengths,
 * the analytic swing), the event detection (exact crossing times inside fixed steps, chord grouping,
 * pitches), the six layouts staying inside the field, the mode in the engine (analytic positions, notes
 * and chords, cycles and the finish, live changes, determinism), the finder (fixed run length, endless)
 * and the settings (URL, presets, ranges).
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

/** A short row for fast tests: 5 pendulums doing 4–8 swings in a 10 s cycle. */
const SHORT: Partial<PendulumSettings> = { count: 5, baseOscillations: 4, cycleSeconds: 10, cycles: 1 };
const STEP = 1000 / 60;

function pendulumEngine(pendulum: Partial<PendulumSettings>, seed = 7, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "pendulum", { ...modeSettings, pendulum }, seed);
}

/** Runs `frames` 60 Hz steps and collects every sound event. */
function run(engine: PhysicsEngine, frames: number): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
  }
  return events;
}

const settingsOf = (patch: Partial<PendulumSettings>) => resolvePendulumSettings({ ...DEFAULT_PENDULUM_SETTINGS, ...patch });

describe("tuning maths", () => {
  it("classic tuning: pendulum i completes K + i oscillations per cycle, so every bob is back in phase after T", () => {
    const s = settingsOf({ count: 15, baseOscillations: 51, cycleSeconds: 60 });
    const f = pendulumFrequencies(s);
    expect(f).toHaveLength(15);
    for (let i = 0; i < 15; i++) {
      expect(f[i]).toBeCloseTo((51 + i) / 60, 12);
      expect(f[i] * 60).toBeCloseTo(51 + i, 9);
      expect(pendulumAngle(60, f[i], 0.4)).toBeCloseTo(0.4, 9);
      expect(pendulumAngle(0, f[i], 0.4, -1)).toBeCloseTo(-0.4, 12);
    }
    // Frequencies spaced exactly 1 / T apart.
    for (let i = 1; i < 15; i++) expect(f[i] - f[i - 1]).toBeCloseTo(1 / 60, 12);
    // Half way through the cycle the odd and even bobs sit on opposite sides: two groups.
    for (let i = 0; i < 15; i++) expect(pendulumAngle(30, f[i], 1)).toBeCloseTo((51 + i) % 2 === 0 ? 1 : -1, 9);
  });

  it("phasing: the swing times form an arithmetic series over the same range of tempi, and the row does not realign after T", () => {
    const s = settingsOf({ count: 15, baseOscillations: 51, cycleSeconds: 60, phasing: true });
    const f = pendulumFrequencies(s);
    const periods = f.map((x) => 1 / x);
    expect(periods[0]).toBeCloseTo(60 / 51, 12);
    expect(periods[14]).toBeCloseTo(60 / 65, 12);
    const step = periods[1] - periods[0];
    for (let i = 2; i < 15; i++) expect(periods[i] - periods[i - 1]).toBeCloseTo(step, 12);
    // Not the harmonic series: the middle bob is off the (K + i) / T grid and completes a fractional number of swings per cycle.
    expect(f[7]).not.toBeCloseTo((51 + 7) / 60, 4);
    expect(Math.abs(f[7] * 60 - Math.round(f[7] * 60))).toBeGreaterThan(0.01);
    expect(pendulumFrequency(0, s)).toBeCloseTo(51 / 60, 12);
  });

  it("gives every pendulum a length ∝ 1 / f² relative to the slowest one", () => {
    const lengths = relativeLengths([1, 2, 4]);
    expect(lengths).toEqual([1, 0.25, 0.0625]);
    const s = settingsOf({ count: 15, baseOscillations: 51, cycleSeconds: 60 });
    const l = relativeLengths(pendulumFrequencies(s));
    expect(l[0]).toBe(1);
    expect(l[14]).toBeCloseTo((51 / 65) ** 2, 12);
  });

  it("bounces on a rectified free-fall arc: on the floor at both ends of the period and at the apex half way", () => {
    expect(bounceHeight(0, 100)).toBe(0);
    expect(bounceHeight(1, 100)).toBe(0);
    expect(bounceHeight(0.5, 100)).toBe(100);
    expect(bounceHeight(0.25, 100)).toBe(75);
  });

  it("maps a radius onto a rotating polygon: the circumradius at a vertex, the apothem at an edge's middle", () => {
    const R = 100;
    expect(polygonRadius(0, R, 0, 4)).toBeCloseTo(R, 9);
    expect(polygonRadius(Math.PI / 4, R, 0, 4)).toBeCloseTo(R * Math.cos(Math.PI / 4), 9);
    expect(polygonRadius(Math.PI / 2, R, 0, 4)).toBeCloseTo(R, 9);
    // Rotating the polygon by an eighth of a turn moves the vertex to that angle.
    expect(polygonRadius(Math.PI / 4, R, Math.PI / 4, 4)).toBeCloseTo(R, 9);
    expect(polygonRadius(0, R, Math.PI / 4, 4)).toBeCloseTo(R * Math.cos(Math.PI / 4), 9);
    for (const sides of [3, 5, 6, 7, 8]) {
      for (let a = -7; a < 7; a += 0.37) {
        const r = polygonRadius(a, R, 1.3, sides);
        expect(r).toBeLessThanOrEqual(R + 1e-9);
        expect(r).toBeGreaterThanOrEqual(R * Math.cos(Math.PI / sides) - 1e-9);
      }
    }
    expect(polygonRadius(1, R, 0, 0)).toBe(R);
  });
});

describe("crossing detection", () => {
  it("knows where the notes fall: centre crossings at ¼ and ¾ of a swing, extremes at 0 and ½, floor hits and apexes for bouncing", () => {
    expect(eventPhases("row", "center")).toEqual([0.25, 0.75]);
    expect(eventPhases("arc", "extremes")).toEqual([0, 0.5]);
    expect(eventPhases("circle", "both")).toEqual([0, 0.25, 0.5, 0.75]);
    expect(eventPhases("bouncing", "center")).toEqual([0]);
    expect(eventPhases("bouncing", "extremes")).toEqual([0.5]);
    expect(eventPhases("bouncing", "both")).toEqual([0, 0.5]);
  });

  it("solves the exact event times inside a window", () => {
    const out: number[] = [];
    crossingTimes(0.5, 0, 4, [0.25, 0.75], out); // period 2 s: centre crossings at 0.5, 1.5, 2.5, 3.5
    expect(out.sort((a, b) => a - b)).toEqual([0.5, 1.5, 2.5, 3.5]);
    out.length = 0;
    crossingTimes(0.5, 0, 4.1, [0], out); // extremes at 0, 2, 4 (the window start counts, the end does not)
    expect(out).toEqual([0, 2, 4]);
    out.length = 0;
    crossingTimes(0.5, 2, 4, [0], out);
    expect(out).toEqual([2]);
    out.length = 0;
    crossingTimes(0, 0, 1, [0], out);
    crossingTimes(1, 1, 1, [0], out);
    expect(out).toEqual([]);
  });

  it("finds every event exactly once across consecutive fixed steps, however the rounding falls", () => {
    // 60 Hz steps for a full 10 s cycle of the short row, boundaries computed the way the mode computes them.
    const s = settingsOf(SHORT);
    const stepSec = STEP / 1000;
    for (const f of pendulumFrequencies(s)) {
      const found: number[] = [];
      for (let k = 0; k < 600; k++) crossingTimes(f, k * stepSec, (k + 1) * stepSec, [0, 0.25, 0.5, 0.75], found);
      const expected: number[] = [];
      for (let q = 0; q * 0.25 < f * 600 * stepSec - 1e-9; q++) expected.push((q * 0.25) / f);
      expect(found.length).toBe(expected.length);
      found.forEach((t, i) => expect(t).toBeCloseTo(expected[i], 9));
    }
  });

  it("groups notes into chords within the 20 ms window, measured from the chord's first note, and leaves lone notes alone", () => {
    const notes: PendulumNote[] = [
      { time: 1.0, index: 0 },
      { time: 1.012, index: 1 },
      { time: 1.019, index: 2 },
      { time: 1.03, index: 3 }, // 30 ms after the first: a new chord
      { time: 1.045, index: 4 },
      { time: 2.0, index: 5 },
    ];
    const groups = groupChords(notes);
    expect(groups.map((g) => g.map((n) => n.index))).toEqual([[0, 1, 2], [3, 4], [5]]);
    expect(groupChords([])).toEqual([]);
    expect(CHORD_WINDOW_SEC).toBe(0.02);
  });

  it("pitches the bobs as major-scale degrees from C4, low to high or high to low, over at most three octaves", () => {
    expect(pendulumPitch(0, 15, "up")).toBeCloseTo(midiToFrequency(60), 9);
    expect(pendulumPitch(1, 15, "up")).toBeCloseTo(midiToFrequency(62), 9);
    expect(pendulumPitch(7, 15, "up")).toBeCloseTo(midiToFrequency(72), 9);
    expect(pendulumPitch(14, 15, "up")).toBeCloseTo(midiToFrequency(84), 9);
    expect(pendulumPitch(0, 15, "down")).toBeCloseTo(midiToFrequency(84), 9);
    expect(pendulumPitch(14, 15, "down")).toBeCloseTo(midiToFrequency(60), 9);
    expect(pendulumPitch(21, 22, "up")).toBeCloseTo(midiToFrequency(96), 9);
    // Sixty bobs share the same span: never above C7, never descending along the row.
    let last = 0;
    for (let i = 0; i < 60; i++) {
      const p = pendulumPitch(i, 60, "up");
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThanOrEqual(midiToFrequency(96) + 1e-9);
      last = p;
    }
    expect(pendulumPitch(59, 60, "up")).toBeCloseTo(midiToFrequency(96), 9);
    expect(PENDULUM_MAX_DEGREES).toBe(22);
  });
});

describe("layouts", () => {
  const field = buildPendulumField(1080, 1920);
  const inside = (p: BobPlacement, r: number) => p.x >= field.left + r - 1e-6 && p.x <= field.right - r + 1e-6 && p.y >= field.top + r - 1e-6 && p.y <= field.bottom - r + 1e-6;

  it("lays the rig out in the centred square the recorder crops to", () => {
    expect(field.side).toBeLessThanOrEqual(1080);
    expect(field.cx).toBe(540);
    expect(field.cy).toBe(960);
    expect(field.right - field.left).toBeCloseTo(field.side, 9);
    const wide = buildPendulumField(1600, 900);
    expect(wide.side).toBeLessThanOrEqual(900);
    expect(wide.top).toBeGreaterThanOrEqual(0);
  });

  it("keeps every bob of every layout, polygon, count, amplitude and ball size inside the field through a whole cycle", () => {
    const out: BobPlacement = { x: 0, y: 0, angle: 0 };
    const violations: string[] = [];
    let placed = 0;
    for (const layout of PENDULUM_LAYOUTS) {
      for (const polygon of layout === "circle" || layout === "galaxy" ? [0, 3, 8] : [0]) {
        for (const count of [5, 15, 60]) {
          for (const amplitude of [5, 25, 60]) {
            for (const ballRadius of [4, 8, 30]) {
              const s = settingsOf({ layout, polygon, count, amplitude, baseOscillations: 4, cycleSeconds: 10 });
              const f = pendulumFrequencies(s);
              const rig = buildPendulumRig(field, s, ballRadius, f);
              if (!(rig.bobRadius > 1 && rig.bobRadius <= (ballRadius * field.side) / 320 + 1e-9)) violations.push(`${layout} n${count} r${ballRadius}: bob radius ${rig.bobRadius}`);
              for (let t = 0; t <= 10; t += 0.05) {
                const turn = (Math.PI * 2 * t) / 10;
                for (let i = 0; i < count; i++) {
                  const phase = f[i] * t;
                  placeBob(rig, i, Math.cos(Math.PI * 2 * phase), phase - Math.floor(phase), layout === "galaxy" ? turn : 0, turn, polygon, out);
                  placed++;
                  if (!(Number.isFinite(out.x) && Number.isFinite(out.y) && inside(out, rig.bobRadius))) violations.push(`${layout} p${polygon} n${count} A${amplitude} r${ballRadius} t${t.toFixed(2)} i${i}: (${out.x.toFixed(1)}, ${out.y.toFixed(1)})`);
                }
              }
            }
          }
        }
      }
    }
    expect(placed).toBeGreaterThan(1_000_000);
    expect(violations.slice(0, 5)).toEqual([]);
  });

  it("hangs the row from a bar with visibly different string lengths and the bouncing balls on the floor with heights in the same ratio", () => {
    const s = settingsOf({ layout: "row", count: 15 });
    const f = pendulumFrequencies(s);
    const rig = buildPendulumRig(field, s, 8, f);
    expect(rig.anchorY.every((y) => y === rig.barY)).toBe(true);
    expect(rig.length[14] / rig.length[0]).toBeCloseTo((51 / 65) ** 2, 9);
    expect(rig.length[0]).toBeGreaterThan(0.5 * field.side);
    const bounce = buildPendulumRig(field, settingsOf({ layout: "bouncing", count: 15 }), 8, f);
    expect(bounce.length[14] / bounce.length[0]).toBeCloseTo((51 / 65) ** 2, 9);
    const out: BobPlacement = { x: 0, y: 0, angle: 0 };
    placeBob(bounce, 0, 1, 0, 0, 0, 0, out);
    expect(out.y).toBeCloseTo(bounce.floorY - bounce.bobRadius, 9);
    placeBob(bounce, 0, 1, 0.5, 0, 0, 0, out);
    expect(out.y).toBeCloseTo(bounce.floorY - bounce.bobRadius - bounce.length[0], 9);
  });

  it("shortens the row's strings as the amplitude grows so the outermost bob still fits, and the sliders travel further", () => {
    const narrow = buildPendulumRig(field, settingsOf({ layout: "row", amplitude: 10 }), 8, pendulumFrequencies(settingsOf({})));
    const wide = buildPendulumRig(field, settingsOf({ layout: "row", amplitude: 60 }), 8, pendulumFrequencies(settingsOf({})));
    expect(wide.length[0]).toBeLessThan(narrow.length[0]);
    const slow = buildPendulumRig(field, settingsOf({ layout: "sliding", amplitude: 10 }), 8, pendulumFrequencies(settingsOf({})));
    const fast = buildPendulumRig(field, settingsOf({ layout: "sliding", amplitude: 40 }), 8, pendulumFrequencies(settingsOf({})));
    expect(fast.swingX).toBeGreaterThan(slow.swingX);
  });

  it("puts the arc's pivots on a ring hanging toward the centre and the radial bobs on their own radius", () => {
    const arc = buildPendulumRig(field, settingsOf({ layout: "arc", count: 8 }), 8, pendulumFrequencies(settingsOf({ count: 8 })));
    for (let i = 0; i < 8; i++) {
      expect(Math.hypot(arc.anchorX[i] - field.cx, arc.anchorY[i] - field.cy)).toBeCloseTo(arc.ringRadius, 6);
      const toCentre = Math.atan2(field.cy - arc.anchorY[i], field.cx - arc.anchorX[i]);
      expect(Math.cos(arc.direction[i] - toCentre)).toBeCloseTo(1, 6);
    }
    const circle = buildPendulumRig(field, settingsOf({ layout: "circle", count: 8 }), 8, pendulumFrequencies(settingsOf({ count: 8 })));
    const out: BobPlacement = { x: 0, y: 0, angle: 0 };
    placeBob(circle, 2, 1, 0, 0, 0, 0, out);
    expect(Math.hypot(out.x - field.cx, out.y - field.cy)).toBeCloseTo(circle.rho0 + circle.rhoAmp, 6);
    placeBob(circle, 2, -1, 0, 0, 0, 0, out);
    expect(Math.hypot(out.x - field.cx, out.y - field.cy)).toBeCloseTo(circle.rho0 - circle.rhoAmp, 6);
    expect(Math.atan2(out.y - field.cy, out.x - field.cx)).toBeCloseTo(circle.direction[2], 6);
  });
});

describe("PendulumMode in the engine", () => {
  it("is registered as a mode of the rhythm family", () => {
    expect(MODE_IDS).toContain("pendulum");
    expect(MODE_CARD_ORDER).toContain("pendulum");
    expect(MODE_CATEGORIES.pendulum).toBe("rhythm");
    // The rhythm family starts with these three in card order (later project.jdm modes are appended after them).
    expect(modesInCategory("rhythm").slice(0, 3)).toEqual(["drop", "box", "pendulum"]);
    expect(modesInCategory("escape")).toHaveLength(10);
  });

  it("starts every bob in line on the seeded side, no rings, no obstacles, pass-through, and moves them analytically", () => {
    const engine = pendulumEngine(SHORT);
    expect(engine.isPendulumMode()).toBe(true);
    expect(engine.getCircularWalls()).toEqual([]);
    expect(engine.getObstacles()).toEqual([]);
    expect(engine.getCurrentMode()?.ballsPassThrough).toBe(true);
    const balls = engine.getBalls();
    expect(balls).toHaveLength(5);
    const view = engine.getPendulumView();
    const rig = view.rig!;
    expect([-1, 1]).toContain(view.startSign);
    // At t = 0 every bob hangs at +A on the start side: the row is in line.
    for (let i = 0; i < 5; i++) {
      expect(balls[i].x).toBeCloseTo(rig.anchorX[i] + rig.length[i] * Math.sin(view.startSign * rig.amplitude), 9);
      expect(balls[i].radius).toBe(rig.bobRadius);
      expect(balls[i].vx).toBe(0);
      expect(balls[i].gravityScale).toBe(0);
    }
    // After 90 steps (1.5 s) the positions are the analytic swing at that time.
    run(engine, 90);
    const t = 90 * (STEP / 1000);
    expect(view.timeSec).toBeCloseTo(t, 9);
    const out: BobPlacement = { x: 0, y: 0, angle: 0 };
    for (let i = 0; i < 5; i++) {
      const phase = view.bobs[i].frequency * t;
      placeBob(rig, i, view.startSign * Math.cos(2 * Math.PI * phase), phase - Math.floor(phase), 0, 0, 0, out);
      expect(balls[i].x).toBeCloseTo(out.x, 6);
      expect(balls[i].y).toBeCloseTo(out.y, 6);
    }
    // Both start sides occur across seeds.
    const signs = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) signs.add(pendulumEngine(SHORT, seed).getPendulumView().startSign);
    expect(signs).toEqual(new Set([-1, 1]));
  });

  it("plays one note per centre crossing, pitched by index, and counts 2(K + i) crossings per bob over a cycle", () => {
    const engine = pendulumEngine({ ...SHORT, waveChord: false, cycles: 0 });
    const events = run(engine, 600);
    const view = engine.getPendulumView();
    // 4 + 5 + 6 + 7 + 8 swings, two crossings each.
    expect(view.noteCount).toBe(60);
    expect(events).toHaveLength(60);
    const pitches = new Set(events.map((e) => e.frequency));
    expect(pitches.size).toBe(5);
    for (let i = 0; i < 5; i++) expect(pitches.has(pendulumPitch(i, 5, "up"))).toBe(true);
    expect(events.every((e) => e.type === "hit" && e.chord === undefined)).toBe(true);
    expect(events.filter((e) => e.frequency === pendulumPitch(0, 5, "up"))).toHaveLength(8);
    expect(events.filter((e) => e.frequency === pendulumPitch(4, 5, "up"))).toHaveLength(16);
    // "down" reverses the pitches; "extremes" gives the same count from the other phases; "both" doubles it.
    const down = run(pendulumEngine({ ...SHORT, waveChord: false, pitchDirection: "down" }), 600);
    expect(down.filter((e) => e.frequency === pendulumPitch(0, 5, "up"))).toHaveLength(16);
    expect(pendulumEngine({ ...SHORT, waveChord: false, soundOn: "extremes", cycles: 0 }) && run(pendulumEngine({ ...SHORT, waveChord: false, soundOn: "extremes", cycles: 0 }), 600)).toHaveLength(60);
    expect(run(pendulumEngine({ ...SHORT, waveChord: false, soundOn: "both", cycles: 0 }), 600)).toHaveLength(120);
  });

  it("queues bobs that cross together as one chord event with the pitches sorted, accents a big one, and keeps the note count", () => {
    const engine = pendulumEngine({ ...SHORT, waveChord: true, cycles: 0 });
    const events = run(engine, 600);
    // Bobs 1 (5 swings) and 3 (7 swings) cross the centre together at T / 4 and 3T / 4; nobody else does.
    const chords = events.filter((e) => e.chord);
    expect(chords).toHaveLength(2);
    for (const c of chords) {
      expect(c.chord).toEqual([pendulumPitch(1, 5, "up"), pendulumPitch(3, 5, "up")]);
      expect(c.frequency).toBe(pendulumPitch(1, 5, "up"));
      expect(c.accent).toBeUndefined();
    }
    expect(engine.getPendulumView().noteCount).toBe(60);
    expect(engine.getPendulumView().chordCount).toBe(2);
    expect(events).toHaveLength(58);
    // With the extremes on, the whole row lines up at T / 2 and T: five-note chords, accented.
    const all = pendulumEngine({ ...SHORT, soundOn: "extremes" });
    const extremes = run(all, 600);
    const big = extremes.filter((e) => e.chord && e.chord.length === 5);
    expect(big.length).toBeGreaterThanOrEqual(3); // t = 0, T / 2 and T
    expect(big.every((e) => e.accent === true)).toBe(true);
    expect(all.getPendulumView().noteCount).toBe(5 + 2 * 30);
    expect(ACCENT_CHORD_FRACTION).toBeLessThanOrEqual(0.5);
    expect(MAX_CHORD_NOTES).toBeGreaterThanOrEqual(12);
  });

  it("groups a chord that straddles two steps and never doubles or drops a note because of it", () => {
    // Two bobs 4 ms apart around a step boundary: frequencies chosen so bob A crosses at 0.9990 s and bob B at 1.0030 s.
    const fa = 0.25 / 0.999;
    const fb = 0.25 / 1.003;
    const stepSec = STEP / 1000;
    const pending: PendulumNote[] = [];
    for (let k = 55; k < 65; k++) {
      const from = k * stepSec;
      const to = (k + 1) * stepSec;
      const times: number[] = [];
      crossingTimes(fa, from, to, [0.25], times);
      for (const t of times) pending.push({ time: t, index: 0 });
      times.length = 0;
      crossingTimes(fb, from, to, [0.25], times);
      for (const t of times) pending.push({ time: t, index: 1 });
    }
    pending.sort((a, b) => a.time - b.time);
    expect(pending).toHaveLength(2);
    expect(pending[0].time).toBeCloseTo(0.999, 9);
    expect(pending[1].time).toBeCloseTo(1.003, 9);
    expect(groupChords(pending).map((g) => g.length)).toEqual([2]);
  });

  it("bounces: every ball hits the floor at its own frequency, all of them together at the start and at the end of the cycle", () => {
    const engine = pendulumEngine({ ...SHORT, layout: "bouncing" });
    const view = engine.getPendulumView();
    const rig = view.rig!;
    for (const ball of engine.getBalls()) expect(ball.y).toBeCloseTo(rig.floorY - rig.bobRadius, 9);
    const events = run(engine, 600);
    // K + i + 1 floor hits per ball (t = 0 and t = T included).
    expect(view.noteCount).toBe(4 + 5 + 6 + 7 + 8 + 5);
    const first = events[0];
    expect(first.chord).toHaveLength(5);
    expect(first.accent).toBe(true);
    const last = events[events.length - 1];
    expect(last.chord).toHaveLength(5);
    expect(view.finished).toBe(true);
    // In between the slow ball is the highest bouncer.
    const heights = engine.getBalls().map((b) => rig.floorY - rig.bobRadius - b.y);
    expect(Math.max(...heights)).toBeLessThan(1e-6);
    expect(rig.length[0]).toBeGreaterThan(rig.length[4]);
  });

  it("finishes exactly at the end of the last cycle, with every bob back in line, and never with the cycles set to 0", () => {
    const engine = pendulumEngine({ ...SHORT, cycles: 2 });
    run(engine, 1199);
    expect(engine.isSimulationFinished()).toBe(false);
    expect(engine.getPendulumView().cyclesDone).toBe(1);
    run(engine, 1);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(engine.getPendulumProgress()).toMatchObject({ cycles: 2, total: 2, count: 5, finished: true });
    const view = engine.getPendulumView();
    const rig = view.rig!;
    for (let i = 0; i < 5; i++) expect(engine.getBalls()[i].x).toBeCloseTo(rig.anchorX[i] + rig.length[i] * Math.sin(view.startSign * rig.amplitude), 6);
    const endless = pendulumEngine({ ...SHORT, cycles: 0 });
    run(endless, 1500);
    expect(endless.isSimulationFinished()).toBe(false);
    expect(endless.getPendulumView().cyclesDone).toBe(2);
  });

  it("holds the final alignment once the last cycle is done: no more notes and no movement, even with wind and spin on", () => {
    const engine = pendulumEngine({ ...SHORT, layout: "galaxy", polygon: 5, soundOn: "both" });
    const events = run(engine, 600);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    const view = engine.getPendulumView();
    const notes = view.noteCount;
    const pose = engine.getBalls().map((b) => [b.x, b.y]);
    const turn = view.polygonAngle;
    engine.setConfig({ windX: 0.3, windY: -0.2, spinStrength: 1 });
    // Five more seconds under the end screen: silence, and the row stays exactly where the last cycle left it.
    expect(run(engine, 300)).toEqual([]);
    expect(view.noteCount).toBe(notes);
    expect(view.timeSec).toBeCloseTo(10, 9);
    expect(view.cyclesDone).toBe(1);
    expect(view.polygonAngle).toBe(turn);
    expect(view.frameAngle).toBe(turn);
    expect(engine.getPendulumSecondsToAlignment()).toBe(0);
    const rig = view.rig!;
    const out: BobPlacement = { x: 0, y: 0, angle: 0 };
    engine.getBalls().forEach((b, i) => {
      expect(b.x).toBeCloseTo(pose[i][0], 9);
      expect(b.y).toBeCloseTo(pose[i][1], 9);
      // In line: every bob at the extreme of its start side (c = startSign), on the frame of the end of the cycle.
      placeBob(rig, i, view.startSign, 0, turn, turn, 5, out);
      expect(b.x).toBeCloseTo(out.x, 6);
      expect(b.y).toBeCloseTo(out.y, 6);
    });
    // The sub-step clock goes on, so the note flashes still fade.
    expect(view.tick).toBe(900 * 4);
  });

  it("takes a trails change live without restarting the run; every other change waits for the next init", () => {
    const engine = pendulumEngine({ ...SHORT, cycles: 0 });
    run(engine, 300);
    const view = engine.getPendulumView();
    const before = [view.timeSec, view.noteCount, view.generation, view.tick];
    engine.setPendulumSettings({ trails: 0.9 });
    expect(view.settings.trails).toBe(0.9);
    expect([view.timeSec, view.noteCount, view.generation, view.tick]).toEqual(before);
    engine.setPendulumSettings({ count: 9, cycleSeconds: 20, layout: "sliding" });
    run(engine, 60);
    expect(view.settings).toMatchObject({ count: 5, cycleSeconds: 10, layout: "row", trails: 0.9 });
    expect(engine.getBalls()).toHaveLength(5);
    expect(engine.getPendulumProgress().count).toBe(5);
    engine.initPendulum();
    expect(view.settings).toMatchObject({ count: 9, cycleSeconds: 20, layout: "sliding", trails: 0.9 });
    expect(engine.getBalls()).toHaveLength(9);
  });

  it("counts down to the next alignment, forever with phasing on", () => {
    const engine = pendulumEngine(SHORT);
    expect(engine.getPendulumSecondsToAlignment()).toBeCloseTo(10, 9);
    run(engine, 150);
    expect(engine.getPendulumSecondsToAlignment()).toBeCloseTo(7.5, 6);
    const phasing = pendulumEngine({ ...SHORT, phasing: true });
    run(phasing, 150);
    expect(phasing.getPendulumSecondsToAlignment()).toBe(Infinity);
    // Phasing keeps the notes coming but the row is not in line at the end of the cycle.
    const events = run(phasing, 450);
    expect(events.length).toBeGreaterThan(20);
    const view = phasing.getPendulumView();
    const angles = view.bobs.map((b) => b.angle);
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(0.1);
  });

  it("runs every layout and polygon with the default tuning, keeps the bobs inside the field and the rotations turning", () => {
    for (const layout of PENDULUM_LAYOUTS) {
      for (const polygon of layout === "circle" || layout === "galaxy" ? PENDULUM_POLYGONS : [0]) {
        const engine = pendulumEngine({ layout, polygon, count: 24 }, 3, { width: 1080, height: 1920 });
        const events = run(engine, 240);
        const view = engine.getPendulumView();
        const field = view.field!;
        const r = view.rig!.bobRadius;
        for (const ball of engine.getBalls()) {
          expect(ball.x).toBeGreaterThanOrEqual(field.left + r - 1e-6);
          expect(ball.x).toBeLessThanOrEqual(field.right - r + 1e-6);
          expect(ball.y).toBeGreaterThanOrEqual(field.top + r - 1e-6);
          expect(ball.y).toBeLessThanOrEqual(field.bottom - r + 1e-6);
        }
        expect(events.length).toBeGreaterThan(0);
        expect(Math.abs(view.polygonAngle)).toBeCloseTo((2 * Math.PI * 4) / 60, 6);
        expect(view.frameAngle).toBe(layout === "galaxy" ? view.polygonAngle : 0);
      }
    }
  });

  it("follows a live ball size change and a canvas resize", () => {
    const engine = pendulumEngine(SHORT);
    const before = engine.getBalls()[0].radius;
    engine.setConfig({ ballRadius: 16 });
    run(engine, 1);
    const view = engine.getPendulumView();
    expect(engine.getBalls()[0].radius).toBeCloseTo(view.rig!.bobRadius, 9);
    expect(engine.getBalls()[0].radius).toBeGreaterThan(before);
    engine.setConfig({ width: 1080, height: 1920 });
    expect(view.field!.cx).toBe(540);
    const rig = view.rig!;
    for (let i = 0; i < 5; i++) {
      const b = engine.getBalls()[i];
      expect(b.x).toBeGreaterThanOrEqual(view.field!.left + rig.bobRadius - 1e-6);
      expect(b.x).toBeLessThanOrEqual(view.field!.right - rig.bobRadius + 1e-6);
    }
  });

  it("is deterministic for a seed, sound events included", () => {
    const a = pendulumEngine({ layout: "galaxy", polygon: 5, count: 30 }, 99);
    const b = pendulumEngine({ layout: "galaxy", polygon: 5, count: 30 }, 99);
    const ea = run(a, 400);
    const eb = run(b, 400);
    expect(ea).toEqual(eb);
    expect(a.getBalls().map((x) => [x.x, x.y])).toEqual(b.getBalls().map((x) => [x.x, x.y]));
    expect(a.getPendulumView().startSign).toBe(b.getPendulumView().startSign);
  });

  it("caps the sound events of one step while still counting every note", () => {
    const engine = pendulumEngine({ count: 60, baseOscillations: 4, cycleSeconds: 10, soundOn: "both", waveChord: false, cycles: 0 });
    const events = run(engine, 1);
    expect(events.length).toBeLessThanOrEqual(24);
    expect(engine.getPendulumView().noteCount).toBe(60);
  });
});

/** A 2D context stand-in that records every stroke of the trails: its points and its opacity. */
function recordingContext() {
  const strokes: { alpha: number; style: string; points: [number, number][] }[] = [];
  let points: [number, number][] = [];
  const ctx = {
    globalAlpha: 1,
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    save() {},
    restore() {},
    beginPath() {
      points = [];
    },
    moveTo(x: number, y: number) {
      points.push([x, y]);
    },
    lineTo(x: number, y: number) {
      points.push([x, y]);
    },
    stroke() {
      strokes.push({ alpha: ctx.globalAlpha, style: ctx.strokeStyle, points });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

describe("trails", () => {
  it("reach back until they have faded to 2 % and no further, longer with the setting", () => {
    expect(trailWindowSec(0)).toBe(0);
    let last = 0;
    for (const trails of [0.05, 0.3, 0.6, 1]) {
      const window = trailWindowSec(trails);
      const tc = trailTimeConstant(trails);
      expect(window).toBeGreaterThan(last);
      last = window;
      expect(trailAlpha(0, tc)).toBe(TRAIL_ALPHA);
      expect(trailAlpha(window, tc)).toBeCloseTo(TRAIL_MIN_ALPHA, 12);
      expect(trailAlpha(window / 2, tc)).toBeLessThan(TRAIL_ALPHA);
    }
  });

  it("trace every bob swing by swing within one budget of points, shortening only the trails the budget cannot cover", () => {
    const reach: TrailReach = { windowSec: 0, timeConstant: 0 };
    expect(trailPointCount(0, 1)).toBe(0);
    expect(trailPointCount(1e-4, 1)).toBe(2);
    expect(trailStepSec(10)).toBeCloseTo(1 / (10 * TRAIL_POINTS_PER_SWING), 12);
    expect(trailStepSec(0.5)).toBeCloseTo(1 / 30, 12);
    // The default row keeps the full window and fade of the setting for every bob.
    for (const f of pendulumFrequencies(DEFAULT_PENDULUM_SETTINGS)) {
      trailReach(DEFAULT_PENDULUM_SETTINGS.trails, f, 15, reach);
      expect(reach.windowSec).toBe(trailWindowSec(DEFAULT_PENDULUM_SETTINGS.trails));
      expect(reach.timeConstant).toBe(trailTimeConstant(DEFAULT_PENDULUM_SETTINGS.trails));
    }
    // Sixty fast bobs with the longest trails: every trail within its share, the fast ones shorter – still fading to 2 %.
    const fast = pendulumFrequencies({ count: 60, baseOscillations: 80, cycleSeconds: 10, phasing: false });
    let total = 0;
    for (const f of fast) {
      trailReach(1, f, 60, reach);
      expect(reach.windowSec).toBeLessThan(trailWindowSec(1));
      expect(trailAlpha(reach.windowSec, reach.timeConstant)).toBeCloseTo(TRAIL_MIN_ALPHA, 12);
      // At least TRAIL_POINTS_PER_SWING points per swing: no aliased chords across the swing.
      const points = trailPointCount(reach.windowSec, f);
      expect(points - 1).toBeGreaterThanOrEqual(reach.windowSec * f * TRAIL_POINTS_PER_SWING - 1e-6);
      total += points;
    }
    expect(total).toBeLessThanOrEqual(MAX_TRAIL_POINTS);
  });

  it("trace exactly the path every bob took, fading out completely, without any state between frames", () => {
    const engine = pendulumEngine({ ...SHORT, layout: "galaxy", polygon: 5, count: 8, trails: 0.3, cycles: 0 });
    const view = engine.getPendulumView();
    const scratch: BobPlacement = { x: 0, y: 0, angle: 0 };
    // Before the first step there is nothing to draw, and nothing is drawn with the trails off.
    const empty = recordingContext();
    drawPendulumTrails(empty.ctx, view, scratch);
    expect(empty.strokes).toHaveLength(0);
    // Where every bob was at the end of each of the last 90 steps.
    const history: { t: number; pos: [number, number][] }[] = [];
    for (let k = 0; k < 600; k++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      if (k >= 510) history.push({ t: view.timeSec, pos: engine.getBalls().map((b) => [b.x, b.y]) });
    }
    const rig = view.rig!;
    // The trail function puts every bob exactly where the engine had it at that time.
    for (const { t, pos } of history) {
      view.bobs.forEach((st, i) => {
        placeBobAt(rig, view, st.index, st.frequency, t, scratch);
        expect(scratch.x).toBeCloseTo(pos[i][0], 6);
        expect(scratch.y).toBeCloseTo(pos[i][1], 6);
      });
    }
    const { ctx, strokes } = recordingContext();
    drawPendulumTrails(ctx, view, scratch);
    const window = trailWindowSec(0.3);
    const balls = engine.getBalls();
    let bob = -1;
    let previousAlpha = Infinity;
    for (const stroke of strokes) {
      expect(stroke.alpha).toBeGreaterThanOrEqual(TRAIL_MIN_ALPHA);
      expect(stroke.alpha).toBeLessThanOrEqual(TRAIL_ALPHA);
      if (stroke.alpha > previousAlpha) {
        bob++;
        previousAlpha = Infinity;
      }
      if (previousAlpha === Infinity) {
        if (bob < 0) bob = 0;
        // Every trail starts at its bob.
        expect(stroke.points[0][0]).toBeCloseTo(balls[bob].x, 9);
        expect(stroke.points[0][1]).toBeCloseTo(balls[bob].y, 9);
      }
      previousAlpha = stroke.alpha;
    }
    expect(bob).toBe(7);
    expect(strokes.length).toBeLessThanOrEqual(8 * TRAIL_BANDS);
    // Its far end is where the bob was one window ago – and nothing older is drawn.
    const tail = strokes[strokes.length - 1].points.at(-1)!;
    placeBobAt(rig, view, 7, view.bobs[7].frequency, view.timeSec - window, scratch);
    expect(tail[0]).toBeCloseTo(scratch.x, 6);
    expect(tail[1]).toBeCloseTo(scratch.y, 6);
    // Drawing again gives the same picture: nothing accumulates from frame to frame.
    const again = recordingContext();
    drawPendulumTrails(again.ctx, view, scratch);
    expect(again.strokes).toEqual(strokes);
    // A restart starts with no trail at all.
    engine.initPendulum();
    const fresh = recordingContext();
    drawPendulumTrails(fresh.ctx, view, scratch);
    expect(fresh.strokes).toHaveLength(0);
    engine.setPendulumSettings({ trails: 0 });
    run(engine, 60);
    drawPendulumTrails(fresh.ctx, view, scratch);
    expect(fresh.strokes).toHaveLength(0);
  });
});

describe("finder", () => {
  it("knows a Pendulum Wave lasts cycles × cycle length whatever the seed, and never with the cycles at 0", () => {
    expect(fixedRunDurationSec("pendulum", { pendulum: { cycles: 2, cycleSeconds: 45 } })).toBe(90);
    expect(fixedRunDurationSec("pendulum", { pendulum: { cycles: 0 } })).toBeNull();
    expect(fixedRunDurationSec("pendulum", {})).toBe(60);
    expect(fixedRunDurationSec("box", {})).toBeNull();
    expect(runNeverFinishes("pendulum", { drop: {}, box: {}, pendulum: { cycles: 0 } })).toBe(true);
    expect(runNeverFinishes("pendulum", { drop: {}, box: {}, pendulum: { cycles: 1 } })).toBe(false);
    expect(runNeverFinishes("pendulum", { drop: {}, box: {} })).toBe(false);
    const request: FinderRequest = { targetDurationSec: 10, toleranceSec: 0.5, maxSeeds: 5, maxSimTimeSec: 40, physicsConfig: config, mode: "pendulum", modeSettings: { ...modeSettings, pendulum: SHORT } };
    expect(simulateSeed(5, request, 40_000)).toBeCloseTo(10_000, 3);
  });

  it("says so instead of searching when the fixed length misses the target, and finds the first seed when it matches", async () => {
    let progress = 0;
    const miss = await findSimulation({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1000, maxSimTimeSec: 60, physicsConfig: config, mode: "pendulum", modeSettings: { ...modeSettings, pendulum: SHORT } }, () => progress++);
    expect(miss).toEqual({ found: false, seed: 0, duration: 10, seedsTested: 0, fixedDuration: true });
    expect(progress).toBe(0);
    const endless = await findSimulation({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1000, maxSimTimeSec: 60, physicsConfig: config, mode: "pendulum", modeSettings: { ...modeSettings, pendulum: { ...SHORT, cycles: 0 } } }, () => progress++);
    expect(endless).toEqual({ found: false, seed: 0, duration: 0, seedsTested: 0, endless: true });
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
    try {
      const hit = await findSimulation({ targetDurationSec: 10, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 40, physicsConfig: config, mode: "pendulum", modeSettings: { ...modeSettings, pendulum: SHORT } }, () => progress++);
      expect(hit.found).toBe(true);
      expect(hit.seedsTested).toBe(1);
      expect(hit.duration).toBeCloseTo(10, 2);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});

describe("Pendulum Wave settings", () => {
  it("resolve to the defaults, clamp the numbers, turn a 1–2 sided polygon into the circle and reject unknown options", () => {
    expect(resolvePendulumSettings(undefined)).toEqual(DEFAULT_PENDULUM_SETTINGS);
    const r = resolvePendulumSettings({ count: 99, baseOscillations: 1, cycleSeconds: 999, amplitude: 90, layout: "spiral" as PendulumSettings["layout"], polygon: 2, phasing: true, trails: 3, soundOn: "never" as PendulumSettings["soundOn"], pitchDirection: "sideways" as PendulumSettings["pitchDirection"], waveChord: false, cycles: 12.4 });
    expect(r).toEqual({ count: 60, baseOscillations: 4, cycleSeconds: 180, amplitude: 60, layout: "row", polygon: 0, phasing: true, trails: 1, soundOn: "center", pitchDirection: "up", waveChord: false, cycles: 10 });
    expect(resolvePendulumSettings({ polygon: 9 }).polygon).toBe(8);
    expect(resolvePendulumSettings({ polygon: 5.4 }).polygon).toBe(5);
    expect(resolvePendulumSettings({ count: Number.NaN }).count).toBe(DEFAULT_PENDULUM_SETTINGS.count);
    for (const key of Object.keys(PENDULUM_RANGES) as (keyof typeof PENDULUM_RANGES)[]) expect(RANGES[key]).toEqual(PENDULUM_RANGES[key]);
  });

  it("map to and from the SimulatorSettings fields, with the defaults in every mode", () => {
    for (const mode of MODE_IDS) expect(pendulumSettingsOf(defaultSettings(mode))).toEqual(DEFAULT_PENDULUM_SETTINGS);
    expect(pendulumSettingFields(DEFAULT_PENDULUM_SETTINGS)).toEqual({ pwCount: 15, pwBaseOscillations: 51, pwCycleSeconds: 60, pwAmplitude: 25, pwLayout: "row", pwPolygon: 0, pwPhasing: false, pwTrails: 0.3, pwSoundOn: "center", pwPitchDirection: "up", pwWaveChord: true, pwCycles: 1 });
  });

  it("round-trip through the URL keys, skipping the defaults", () => {
    const s: SimulatorSettings = { ...defaultSettings("pendulum"), pwCount: 24, pwBaseOscillations: 30, pwCycleSeconds: 45, pwAmplitude: 40, pwLayout: "galaxy", pwPolygon: 6, pwPhasing: true, pwTrails: 0.75, pwSoundOn: "both", pwPitchDirection: "down", pwWaveChord: false, pwCycles: 3 };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("pendulum");
    expect(params.get("pwn")).toBe("24");
    expect(params.get("pwk")).toBe("30");
    expect(params.get("pwt")).toBe("45");
    expect(params.get("pwa")).toBe("40");
    expect(params.get("pwl")).toBe("galaxy");
    expect(params.get("pwp")).toBe("6");
    expect(params.get("pwph")).toBe("1");
    expect(params.get("pwtr")).toBe("0.75");
    expect(params.get("pws")).toBe("both");
    expect(params.get("pwpd")).toBe("down");
    expect(params.get("pwch")).toBe("0");
    expect(params.get("pwc")).toBe("3");
    expect(settingsFromSearchParams(params)).toEqual(s);
    const defaults = settingsToSearchParams(defaultSettings("pendulum"));
    for (const key of ["pwn", "pwk", "pwt", "pwa", "pwl", "pwp", "pwph", "pwtr", "pws", "pwpd", "pwch", "pwc"]) expect(defaults.has(key)).toBe(false);
  });

  it("fall back for bad URL values and presets", () => {
    const fromUrl = settingsFromSearchParams(new URLSearchParams("mode=pendulum&pwn=500&pwk=abc&pwt=1&pwl=zigzag&pwp=1&pws=loud&pwpd=up&pwc=-4&pwtr=2"));
    expect(pendulumSettingsOf(fromUrl)).toEqual({ ...DEFAULT_PENDULUM_SETTINGS, count: 60, cycleSeconds: 10, polygon: 0, cycles: 0, trails: 1 });
    const preset = presetToSettings({ mode: "pendulum", pwCount: 0, pwLayout: "sliding", pwSoundOn: "extremes", pwPolygon: 4, pwWaveChord: "yes", pwCycles: 99 } as unknown as Partial<SimulatorSettings>);
    expect(pendulumSettingsOf(preset)).toEqual({ ...DEFAULT_PENDULUM_SETTINGS, count: 5, layout: "sliding", soundOn: "extremes", polygon: 4, cycles: 10 });
  });
});
