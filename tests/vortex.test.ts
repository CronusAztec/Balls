import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VORTEX_SETTINGS,
  ENTRY_AT,
  HOLE_AT,
  MAX_RING_NOTES_PER_STEP,
  MAX_VORTEX_RINGS,
  RIM_AT,
  SWALLOW_HOLD_SEC,
  VORTEX_RANGES,
  buildVortexField,
  circularSpeed,
  crossRings,
  defaultVortexFields,
  depthRadiusScale,
  dragRate,
  pewPitch,
  resolveVortexFields,
  resolveVortexSettings,
  ringMidi,
  ringPitch,
  ringRadii,
  stepSpiral,
  vortexBaseMidi,
  vortexDepth,
  vortexNominalRunSec,
  vortexRunRangeSec,
  vortexSettingsOf,
  type SpiralState,
  type VortexSettings,
} from "@/lib/physics/modes/vortex";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { SCALE_INTERVALS, frequencyToMidi, quantizeFrequency } from "@/lib/audio/scales";
import { DEFAULT_PEW_FREQUENCY, PEW_TONE, pewSweep, pewWaveform, schedulePewTone } from "@/lib/audio/pewTone";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import type { PhysicsEngine } from "@/lib/physics/engine";

/**
 * Sound Vortex (feature boris-vortex): the settings / URL / presets, the funnel geometry, the spiral integration (the
 * matched spiral r = r₀·e^(−k·t), determinism), ring-crossing detection, the notes rising with depth, the pew (its
 * scheduling in the event stream, its synthesis and the ToneGenerator's dispatch), the end of the run, the loop and the
 * seed finder.
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

function vortexEngine(vortex: Partial<VortexSettings> = {}, seed = 7, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "vortex", { ...modeSettings, vortex }, seed);
}

interface Timed {
  t: number;
  ev: SoundEvent;
}

/** Runs until the vortex finishes (or `maxSec`), collecting every sound event with its simulation time. */
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

/* ------------------------------------------------------------------ settings */

describe("settings, URL and presets", () => {
  it("defaults and ranges", () => {
    expect(defaultVortexFields()).toEqual({ vxBalls: 12, vxStagger: 1.5, vxRings: 12, vxDuration: 12.5, vxGravity: 1, vxLoop: false, vxDepthScale: 0.5 });
    for (const key of Object.keys(VORTEX_RANGES) as (keyof typeof VORTEX_RANGES)[]) expect(RANGES[key]).toEqual(VORTEX_RANGES[key]);
    expect(VORTEX_RANGES.vxBalls).toMatchObject({ min: 1, max: 30 });
    expect(VORTEX_RANGES.vxRings).toMatchObject({ min: 6, max: 24 });
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolveVortexFields(d)).toEqual(defaultVortexFields());
      const params = settingsToSearchParams(d);
      for (const key of ["vxn", "vxs", "vxr", "vxd", "vxg", "vxl", "vxds"]) expect(params.has(key)).toBe(false);
    }
  });

  it("resolve clamps onto the sliders and drops bad values", () => {
    expect(resolveVortexSettings({ balls: 99, stagger: -1, rings: 2, duration: 100, gravity: 0, depthScale: 7 })).toMatchObject({ balls: 30, stagger: 0, rings: 6, duration: 30, gravity: 0.2, depthScale: 1 });
    expect(resolveVortexSettings({ balls: 4.6, stagger: 0.333, duration: 7.3, gravity: 1.337, depthScale: 0.42 })).toMatchObject({ balls: 5, stagger: 0.35, duration: 7.5, gravity: 1.35, depthScale: 0.4 });
    const junk = { balls: "many", loop: "yes", rings: null, scale: "klingon", rootNote: "x" } as unknown as Partial<VortexSettings>;
    expect(resolveVortexSettings(junk)).toEqual(DEFAULT_VORTEX_SETTINGS);
    expect(resolveVortexSettings({ rootNote: 14 }).rootNote).toBe(2);
    expect(vortexSettingsOf({ ...defaultVortexFields(), scale: "minor", rootNote: 3 })).toMatchObject({ scale: "minor", rootNote: 3 });
  });

  it("round-trip through vxn / vxs / vxr / vxd / vxg / vxl / vxds and presets", () => {
    const s = { ...defaultSettings("vortex"), vxBalls: 20, vxStagger: 0.75, vxRings: 18, vxDuration: 9, vxGravity: 2.5, vxLoop: true, vxDepthScale: 0.8 };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("vortex");
    expect(params.get("vxn")).toBe("20");
    expect(params.get("vxs")).toBe("0.75");
    expect(params.get("vxr")).toBe("18");
    expect(params.get("vxd")).toBe("9");
    expect(params.get("vxg")).toBe("2.5");
    expect(params.get("vxl")).toBe("1");
    expect(params.get("vxds")).toBe("0.8");
    const back = settingsFromSearchParams(params);
    expect(back.mode).toBe("vortex");
    expect(resolveVortexFields(back)).toEqual({ vxBalls: 20, vxStagger: 0.75, vxRings: 18, vxDuration: 9, vxGravity: 2.5, vxLoop: true, vxDepthScale: 0.8 });
    const bad = settingsFromSearchParams(new URLSearchParams("mode=vortex&vxn=500&vxr=abc&vxl=7&vxd=1"));
    expect(resolveVortexFields(bad)).toEqual({ ...defaultVortexFields(), vxBalls: 30, vxDuration: 3 });
    const preset = presetToSettings({ mode: "vortex", vxBalls: 0, vxLoop: "no", vxGravity: 9 } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(resolveVortexFields(preset)).toMatchObject({ vxBalls: 1, vxLoop: false, vxGravity: 3 });
  });

  it("the mode is registered: a rhythm card with the Boris family, before Glass Smash", () => {
    expect(MODE_IDS).toContain("vortex");
    expect(MODE_CATEGORIES.vortex).toBe("rhythm");
    expect(MODE_CARD_ORDER).toContain("vortex");
    const rhythm = modesInCategory("rhythm");
    expect(rhythm.indexOf("vortex")).toBe(rhythm.indexOf("glass") - 1);
    expect(rhythm.at(-1)).toBe("glass");
  });
});

/* ------------------------------------------------------------------ geometry */

describe("the funnel", () => {
  it("fits the centred square: rim, entry, hole and geometric rings in between", () => {
    const f = buildVortexField(800, 600, 12);
    expect(f.cx).toBe(400);
    expect(f.cy).toBe(300);
    expect(f.rim).toBeCloseTo(RIM_AT * 600, 9);
    expect(f.entry).toBeCloseTo(ENTRY_AT * f.rim, 9);
    expect(f.hole).toBeCloseTo(HOLE_AT * f.rim, 9);
    expect(f.ringCount).toBe(12);
    const ratio = f.rings[1] / f.rings[0];
    for (let i = 0; i < 12; i++) {
      expect(f.rings[i]).toBeLessThan(i === 0 ? f.entry : f.rings[i - 1]);
      expect(f.rings[i]).toBeGreaterThan(f.hole);
      if (i > 0) expect(f.rings[i] / f.rings[i - 1]).toBeCloseTo(ratio, 9);
    }
    // entry → ring 0 → … → ring 11 → hole: 13 equal ratios
    expect(f.rings[0] / f.entry).toBeCloseTo(ratio, 9);
    expect(f.hole / f.rings[11]).toBeCloseTo(ratio, 9);
    expect(Array.from(ringRadii(100, 10, 3))).toEqual([100 * Math.pow(0.1, 0.25), 100 * Math.pow(0.1, 0.5), 100 * Math.pow(0.1, 0.75)]);
    expect(buildVortexField(10, 10, 99).ringCount).toBe(MAX_VORTEX_RINGS);
  });

  it("depth runs from 0 at the entry to 1 at the hole, and the depth cue shrinks the balls with it", () => {
    const f = buildVortexField(1000, 1000, 12);
    expect(vortexDepth(f, f.entry)).toBe(0);
    expect(vortexDepth(f, f.hole)).toBeCloseTo(1, 12);
    expect(vortexDepth(f, 2 * f.rim)).toBe(0);
    expect(vortexDepth(f, Math.sqrt(f.entry * f.hole))).toBeCloseTo(0.5, 12);
    expect(depthRadiusScale(1, 0)).toBe(1);
    expect(depthRadiusScale(0, 1)).toBe(1);
    expect(depthRadiusScale(1, 1)).toBeCloseTo(0.4, 12);
    expect(depthRadiusScale(0.5, 0.5)).toBeCloseTo(0.85, 12);
  });
});

/* ------------------------------------------------------------------ spiral integration */

describe("spiral integration", () => {
  const rim = 300;
  const entry = ENTRY_AT * rim;
  const hole = HOLE_AT * rim;

  it("a ball entering on the circular speed with r′ = −k·r follows r₀·e^(−k·t) to the hole", () => {
    const vc = circularSpeed(rim, 1);
    const k = dragRate(entry, hole, 10);
    const s: SpiralState = { r: entry, vr: -k * entry, theta: 0, L: entry * vc };
    const dt = 1 / 240;
    let laps = 0;
    for (let i = 1; i <= 10 * 240; i++) {
      const before = s.theta;
      stepSpiral(s, dt, vc, k, 1);
      laps += (s.theta - before) / (2 * Math.PI);
      if (i % 240 === 0) expect(Math.abs(s.r / (entry * Math.exp(-k * i * dt)) - 1)).toBeLessThan(0.01);
    }
    expect(s.r).toBeCloseTo(hole, 0);
    // The drag on the angular momentum is exact.
    expect(s.L).toBeCloseTo(entry * vc * Math.exp(-k * 10), 6);
    // The whirl: θ = (v_c / (k·r₀)) (e^(k·t) − 1) on the matched spiral.
    expect(laps).toBeCloseTo(((vc / (k * entry)) * (Math.exp(k * 10) - 1)) / (2 * Math.PI), 0);
  });

  it("is deterministic, turns either way and stays accurate with one big step", () => {
    const vc = circularSpeed(rim, 2);
    const k = dragRate(entry, hole, 6);
    const a: SpiralState = { r: entry, vr: -k * entry, theta: 1, L: 0.97 * entry * vc };
    const b: SpiralState = { ...a };
    const c: SpiralState = { ...a };
    for (let i = 0; i < 1000; i++) {
      stepSpiral(a, 1 / 240, vc, k, 1);
      stepSpiral(b, 1 / 240, vc, k, 1);
      stepSpiral(c, 1 / 240, vc, k, -1);
    }
    expect(b).toEqual(a);
    expect(c.r).toBe(a.r);
    expect(c.theta - 1).toBeCloseTo(-(a.theta - 1), 9);
    // A whole 60 Hz step at once is cut into small turns: the same place as four sub-steps, within a hair.
    const big: SpiralState = { r: 60, vr: -k * 60, theta: 0, L: 60 * vc };
    const small: SpiralState = { ...big };
    stepSpiral(big, 1 / 60, vc, k, 1);
    for (let i = 0; i < 4; i++) stepSpiral(small, 1 / 240, vc, k, 1);
    expect(big.r).toBeCloseTo(small.r, 2);
    expect(big.theta).toBeCloseTo(small.theta, 2);
  });

  it("the central pull sets the whirl, not the time", () => {
    const slow = vortexEngine({ balls: 1, gravity: 0.5 }, 3);
    const fast = vortexEngine({ balls: 1, gravity: 3 }, 3);
    expect(fast.getVortexView().circularSpeed / slow.getVortexView().circularSpeed).toBeCloseTo(Math.sqrt(6), 9);
    const a = run(slow);
    const b = run(fast);
    expect(Math.abs(a.finishedAt - b.finishedAt)).toBeLessThan(0.35);
  });
});

/* ------------------------------------------------------------------ rings and notes */

describe("ring crossings and notes", () => {
  it("crossRings advances past every ring the ball is inside, inward and only once", () => {
    const radii = [100, 80, 60, 40];
    const crossed: number[] = [];
    expect(crossRings(120, radii, 4, 0, (r) => crossed.push(r))).toBe(0);
    expect(crossRings(90, radii, 4, 0, (r) => crossed.push(r))).toBe(1);
    // Back out past ring 0 and in again: nothing new.
    expect(crossRings(105, radii, 4, 1, (r) => crossed.push(r))).toBe(1);
    expect(crossRings(95, radii, 4, 1, (r) => crossed.push(r))).toBe(1);
    // Two rings in one move.
    expect(crossRings(55, radii, 4, 1, (r) => crossed.push(r))).toBe(3);
    expect(crossRings(10, radii, 4, 3, (r) => crossed.push(r))).toBe(4);
    expect(crossRings(1, radii, 4, 4, (r) => crossed.push(r))).toBe(4);
    expect(crossed).toEqual([0, 1, 2, 3]);
  });

  it("ring i plays degree i of the scale: the notes rise with depth, lower octaves for many rings", () => {
    const major = SCALE_INTERVALS.major;
    for (let i = 0; i < 12; i++) expect(ringMidi(i, 12, "chromatic", 0)).toBe(60 + 12 * Math.floor(i / 7) + major[i % 7]);
    for (let i = 1; i < 24; i++) expect(ringPitch(i, 24, "pentatonic", 5)).toBeGreaterThan(ringPitch(i - 1, 24, "pentatonic", 5));
    expect(vortexBaseMidi(12, "major")).toBe(60);
    expect(vortexBaseMidi(24, "major")).toBe(48);
    expect(vortexBaseMidi(24, "pentatonic")).toBe(36);
    for (const scale of ["major", "minor", "pentatonic", "blues", "wholeTone"] as const) {
      for (let i = 0; i < 24; i++) {
        const f = ringPitch(i, 24, scale, 2);
        expect(quantizeFrequency(f, scale, 2)).toBeCloseTo(f, 6); // already on the scale
        expect(frequencyToMidi(f)).toBeLessThanOrEqual(98);
      }
    }
    expect(pewPitch(12, "chromatic", 0)).toBeCloseTo(2 * ringPitch(11, 12, "chromatic", 0), 9);
    expect(pewPitch(6, "chromatic", 0)).toBeGreaterThanOrEqual(600);
    expect(pewPitch(24, "blues", 11)).toBeLessThanOrEqual(2400);
  });

  it("one ball crosses every ring once, in order, at a steady tempo, then pews – and the run ends after the hold", () => {
    const engine = vortexEngine({ balls: 1, rings: 12, duration: 10 }, 11);
    const view = engine.getVortexView();
    const { events, finishedAt } = run(engine);
    const notes = events.filter((e) => !e.ev.pew);
    const pews = events.filter((e) => e.ev.pew);
    expect(notes.map((e) => e.ev.wallIndex)).toEqual([...Array(12).keys()]);
    for (const e of notes) expect(e.ev.type).toBe("hit");
    const midis = notes.map((e) => Math.round(frequencyToMidi(e.ev.frequency!)));
    expect(midis).toEqual([...Array(12).keys()].map((i) => ringMidi(i, 12, "chromatic", 0)));
    const gaps = notes.slice(1).map((e, i) => e.t - notes[i].t);
    const period = view.spiralSec / 13;
    for (const g of gaps) expect(Math.abs(g - period)).toBeLessThan(0.25 * period);
    // The pew comes last, after the innermost ring, from an octave above it.
    expect(pews).toHaveLength(1);
    expect(events.at(-1)!.ev.pew).toBe(true);
    expect(pews[0].t).toBeGreaterThan(notes.at(-1)!.t);
    expect(pews[0].ev.frequency).toBeCloseTo(pewPitch(12, "chromatic", 0), 9);
    expect(pews[0].t).toBeGreaterThan(0.9 * view.spiralSec);
    expect(pews[0].t).toBeLessThan(1.02 * view.spiralSec);
    expect(finishedAt).toBeCloseTo(pews[0].t + SWALLOW_HOLD_SEC, 1);
    expect(view.swallowed).toBe(1);
    expect(view.notes).toBe(12);
    expect(view.deepestRing).toBe(11);
    expect(engine.getBalls()).toHaveLength(0);
    expect(engine.getVortexProgress()).toMatchObject({ balls: 1, entered: 1, swallowed: 1, inFlight: 0, notes: 12, finished: true });
  });

  it("the default run: 12 staggered balls, every ring for each, one pew each, chords only for rings crossed together", () => {
    const engine = vortexEngine({}, 5);
    let maxBalls = 0;
    const { events, finishedAt } = run(engine, 120, (e) => {
      maxBalls = Math.max(maxBalls, e.getBalls().length);
    });
    const view = engine.getVortexView();
    expect(finishedAt).toBeGreaterThan(0);
    expect(view.notes).toBe(12 * 12);
    expect(events.filter((e) => e.ev.pew)).toHaveLength(12);
    const voiced = events.filter((e) => !e.ev.pew).reduce((n, e) => n + (e.ev.chord ? e.ev.chord.length : 1), 0);
    expect(voiced).toBeLessThanOrEqual(144);
    for (const e of events) {
      if (!e.ev.chord) continue;
      expect(e.ev.chord.length).toBeGreaterThan(1);
      expect(e.ev.chord.length).toBeLessThanOrEqual(MAX_RING_NOTES_PER_STEP);
      expect(e.ev.frequency).toBe(e.ev.chord[0]);
      for (let i = 1; i < e.ev.chord.length; i++) expect(e.ev.chord[i]).toBeGreaterThan(e.ev.chord[i - 1]);
    }
    // Staggered 1.5 s apart, about 8 balls weave in the funnel at once.
    expect(maxBalls).toBeGreaterThanOrEqual(7);
    expect(maxBalls).toBeLessThanOrEqual(10);
    const range = vortexRunRangeSec(DEFAULT_VORTEX_SETTINGS)!;
    expect(finishedAt).toBeGreaterThanOrEqual(range.min - 0.1);
    expect(finishedAt).toBeLessThanOrEqual(range.max + 0.1);
  });

  it("the last swallow raises the banner flag and the run finishes SWALLOW_HOLD_SEC later; never with the loop", () => {
    const engine = vortexEngine({ balls: 2, stagger: 0.5, duration: 4 }, 6);
    const view = engine.getVortexView();
    let flaggedAt = -1;
    let lastPewAt = -1;
    const { finishedAt, events } = run(engine, 30, (e) => {
      const t = e.getElapsedMs() / 1000;
      if (flaggedAt < 0 && e.getVortexView().allSwallowed) flaggedAt = t;
      // The flag goes up only once every ball is gone.
      if (!e.getVortexView().allSwallowed) expect(e.getVortexView().swallowed).toBeLessThan(2);
    });
    for (const e of events) if (e.ev.pew) lastPewAt = e.t;
    expect(view.swallowed).toBe(2);
    expect(flaggedAt).toBeCloseTo(lastPewAt, 9);
    expect(finishedAt - flaggedAt).toBeGreaterThanOrEqual(SWALLOW_HOLD_SEC - 1e-6);
    expect(finishedAt - flaggedAt).toBeLessThan(SWALLOW_HOLD_SEC + 0.02);
    expect(engine.getVortexProgress()).toMatchObject({ allSwallowed: true, finished: true });
    const looping = vortexEngine({ balls: 2, stagger: 0.5, duration: 4, loop: true }, 6);
    run(looping, 12);
    expect(looping.getVortexView().swallowed).toBeGreaterThanOrEqual(4);
    expect(looping.getVortexView().allSwallowed).toBe(false);
    // A restart lowers it again.
    engine.initMode("vortex");
    expect(view.allSwallowed).toBe(false);
  });

  it("the depth cue shrinks a ball as it sinks; at 0 it keeps the Ball Size", () => {
    for (const depthScale of [0, 1]) {
      const engine = vortexEngine({ balls: 1, depthScale }, 2);
      const sizes: number[] = [];
      run(engine, 30, (e) => {
        const b = e.getBalls()[0];
        if (b) sizes.push(b.radius);
      });
      if (depthScale === 0) expect(new Set(sizes)).toEqual(new Set([8]));
      else {
        expect(sizes[0]).toBeGreaterThan(7.5);
        expect(sizes.at(-1)!).toBeLessThan(3.6);
        for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1] + 0.2);
      }
    }
  });

  it("the Ball Colour dresses the first ball, the others wear the palette – even after a colour change", () => {
    const engine = vortexEngine({ balls: 3, stagger: 0 }, 1, { ...config, ballColor: "#123456" });
    engine.update(STEP, 0);
    const colors = engine.getBalls().map((b) => b.color);
    expect(colors[0]).toBe("#123456");
    expect(new Set(colors).size).toBe(3);
    engine.setConfig({ ballColor: "#abcdef" });
    engine.update(STEP, 0);
    expect(engine.getBalls().map((b) => b.color)).toEqual(["#abcdef", colors[1], colors[2]]);
  });
});

/* ------------------------------------------------------------------ determinism, loop, finder */

describe("runs, the loop and the finder", () => {
  it("replays exactly for a seed and differs across seeds", () => {
    const trace = (seed: number) => {
      const engine = vortexEngine({ balls: 5, stagger: 0.5 }, seed);
      const out: number[] = [];
      const { events } = run(engine, 20, (e) => {
        for (const b of e.getBalls()) out.push(b.x, b.y);
      });
      return { out, events: events.map((e) => [e.t, e.ev.wallIndex, e.ev.frequency, !!e.ev.pew, e.ev.chord?.length ?? 0]) };
    };
    expect(trace(42)).toEqual(trace(42));
    expect(trace(42).out).not.toEqual(trace(43).out);
  });

  it("a resize before the first step places the balls exactly as an engine built at that size", () => {
    const direct = vortexEngine({ balls: 4, stagger: 0 }, 9, { ...config, width: 1000, height: 900 });
    const resized = vortexEngine({ balls: 4, stagger: 0 }, 9);
    resized.setConfig({ width: 1000, height: 900 });
    const a = run(direct, 40);
    const b = run(resized, 40);
    expect(b.finishedAt).toBe(a.finishedAt);
    expect(b.events.map((e) => [e.t, e.ev.wallIndex])).toEqual(a.events.map((e) => [e.t, e.ev.wallIndex]));
  });

  it("a resize mid-run keeps every ball in its place in the funnel", () => {
    const engine = vortexEngine({ balls: 1 }, 4);
    for (let i = 0; i < 120; i++) engine.update(STEP, 0);
    const v = engine.getVortexView();
    const depth = vortexDepth(v.field, v.slotR[0]);
    engine.setConfig({ width: 1600, height: 1200 });
    expect(vortexDepth(v.field, v.slotR[0])).toBeCloseTo(depth, 9);
    const b = engine.getBalls()[0];
    expect(Math.hypot(b.x - 800, b.y - 600)).toBeCloseTo(v.slotR[0], 6);
    expect(run(engine).finishedAt).toBeGreaterThan(0);
  });

  it("the loop brings every swallowed ball back at the rim and never ends", () => {
    const engine = vortexEngine({ balls: 3, stagger: 0.5, duration: 4, loop: true }, 8);
    const { finishedAt, events } = run(engine, 20);
    const v = engine.getVortexView();
    expect(finishedAt).toBe(-1);
    expect(v.swallowed).toBeGreaterThanOrEqual(9);
    expect(v.entered).toBeGreaterThan(v.swallowed);
    expect(events.filter((e) => e.ev.pew)).toHaveLength(v.swallowed);
    expect(engine.getBalls().length).toBeLessThanOrEqual(3);
    expect(runNeverFinishes("vortex", { drop: {}, box: {}, vortex: { loop: true } })).toBe(true);
    expect(runNeverFinishes("vortex", { drop: {}, box: {}, vortex: {} })).toBe(false);
  });

  it("the run length is a continuous function of the seed inside the tempo band, so the finder can land a target", async () => {
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 200, maxSimTimeSec: 60, physicsConfig: config, mode: "vortex", modeSettings: { ...modeSettings, vortex: {} } };
    expect(fixedRunDurationSec("vortex", request.modeSettings)).toBeNull();
    expect(vortexNominalRunSec(DEFAULT_VORTEX_SETTINGS)).toBeCloseTo(16.5 + 12.5 + SWALLOW_HOLD_SEC, 9);
    const range = vortexRunRangeSec(DEFAULT_VORTEX_SETTINGS)!;
    const lengths = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const ms = simulateSeed(seed, request, 60_000);
      expect(ms / 1000).toBeGreaterThanOrEqual(range.min - 0.1);
      expect(ms / 1000).toBeLessThanOrEqual(range.max + 0.1);
      lengths.add(Math.round(ms));
    }
    expect(lengths.size).toBeGreaterThan(8);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    let result;
    try {
      result = await findSimulation(request, () => undefined);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(result.found).toBe(true);
    expect(Math.abs(result.duration - 30)).toBeLessThanOrEqual(0.5);
    const replay = run(vortexEngine({}, result.seed));
    expect(Math.abs(replay.finishedAt - result.duration)).toBeLessThan(0.02);
    const endless = await findSimulation({ ...request, modeSettings: { ...modeSettings, vortex: { loop: true } } }, () => undefined);
    expect(endless).toMatchObject({ found: false, endless: true, seedsTested: 0 });
  });
});

/* ------------------------------------------------------------------ the pew */

interface OscLog {
  type: string;
  frequency: number;
  startAt: number;
  ramps: number[];
}

function fakeGraph() {
  const oscillators: OscLog[] = [];
  const sources: number[] = [];
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
    createBufferSource: () => ({
      buffer: null as unknown,
      playbackRate: param(),
      connect: () => undefined,
      disconnect: () => undefined,
      start: (when = 0) => void sources.push(when),
      stop: () => undefined,
    }),
    createBuffer: (channels: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, copyToChannel: () => undefined }),
  };
  return { ctx, oscillators, sources };
}

describe("the pew", () => {
  it("sweeps down `drop` times from the start pitch, with a sub an octave below", () => {
    expect(pewSweep(1600)).toEqual({ start: 1600, end: 1600 / PEW_TONE.drop, duration: PEW_TONE.duration });
    expect(pewSweep(Number.NaN).start).toBe(DEFAULT_PEW_FREQUENCY);
    const graph = fakeGraph();
    schedulePewTone(graph.ctx as unknown as BaseAudioContext, {} as AudioNode, 1200, 2, (f) => f * 1.5, "square");
    expect(graph.oscillators).toHaveLength(2);
    const [main, sub] = graph.oscillators;
    expect(main).toMatchObject({ type: "square", frequency: 1800, startAt: 2 });
    expect(main.ramps).toEqual([1800 / PEW_TONE.drop]);
    expect(sub.type).toBe("sine");
    expect(sub.frequency).toBeCloseTo(1800 * PEW_TONE.subRatio, 9);
    expect(sub.ramps[0]).toBeCloseTo((1800 / PEW_TONE.drop) * PEW_TONE.subRatio, 9);
    expect(pewWaveform("sine")).toBe("sine");
    expect(pewWaveform("chip")).toBe("square");
    expect(pewWaveform("saw")).toBe("sawtooth");
    expect(pewWaveform("marimba")).toBe("triangle");
    expect(pewWaveform(undefined)).toBe("triangle");
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

    it("snaps the start to the scale and takes the bounce instrument's waveform", () => {
      tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, instrument: "saw", scale: "major", rootNote: 0 });
      graph.ctx.currentTime = 1;
      tone.playPew(1250);
      expect(graph.oscillators[0].type).toBe("sawtooth");
      expect(graph.oscillators[0].frequency).toBeCloseTo(quantizeFrequency(1250, "major", 0), 6);
      expect(graph.oscillators[0].startAt).toBe(1);
    });

    it("lands on the beat grid with the beat lock and never takes a bounce's slot", () => {
      tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4" });
      graph.ctx.currentTime = 0.1;
      tone.playPew(1000);
      const pewAt = graph.oscillators[0].startAt;
      expect(pewAt).toBeCloseTo(0.5, 9);
      tone.playWallHit(0, 440);
      expect(graph.oscillators).toHaveLength(3);
      expect(graph.oscillators[2].startAt).toBeCloseTo(0.5, 9);
    });

    it("plays the chosen wall-break clip instead when there is one", async () => {
      tone.setWallBreakSound("/wallBreak/glass.wav");
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      tone.playPew(1000);
      expect(graph.oscillators).toHaveLength(0);
      expect(graph.sources).toHaveLength(1);
    });
  });

  it("the page / fast-export dispatch routes a pew event to playPew()", () => {
    const calls: string[] = [];
    const audio = {
      playPew: (f?: number) => calls.push(`pew ${f}`),
      playWallHit: (w: number, f?: number) => calls.push(`hit ${w} ${f}`),
      playGapPass: () => calls.push("gap"),
    } as unknown as ToneGenerator;
    playSoundEvent(audio, { type: "hit", wallIndex: 12, frequency: 1567, pew: true }, () => calls.push("break"));
    playSoundEvent(audio, { type: "hit", wallIndex: 3, frequency: 330 }, () => calls.push("break"));
    expect(calls).toEqual(["pew 1567", "hit 3 330"]);
  });
});
