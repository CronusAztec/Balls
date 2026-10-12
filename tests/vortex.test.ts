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
// --- funnel-spin --- the ring waves and the perspective view
import {
  DEFAULT_FUNNEL_SPIN_FIELDS,
  FS_DEFAULT_DESCENT_SEC,
  FS_ENTRY_AT,
  FS_PRESET_IDS,
  FS_SLIP_RATIO,
  FUNNEL_SPIN_RANGES,
  chimeDegree,
  chimeHz,
  defaultFunnelSpinFields,
  doublingWaves,
  formatWaves,
  funnelDepthKey,
  funnelDescentSteps,
  funnelDrawOrder,
  funnelFrame,
  funnelLapGain,
  funnelSpinPresetPatch,
  funnelStepTiming,
  hissLevel,
  lapRate,
  lipDepth,
  parseWaves,
  projectFunnel,
  pullExponent,
  pullStrength,
  releaseSpin,
  resolveFunnelSpinFields,
  slipRate,
  stepFunnel,
  wavesForRun,
  type FunnelState,
} from "@/lib/physics/funnelSpin";
import { FunnelLayer } from "@/components/simulator/funnelRenderer";
import { findFunnelSpinRun } from "@/lib/simulation/funnelSpinFinder";
import { availableOutcomes } from "@/lib/simulation/outcomes";
import { hudCounterText, loopHudCount } from "@/lib/loop/hud";
import { loopCaptionContext } from "@/lib/publish/loopCaption";
import { ENTITY_CEILING } from "@/lib/uncap";
import { fakeCanvas } from "./fakeCanvas";
import { fakeGraph as fakeAudioGraph } from "./fakeAudio";
// --- end funnel-spin ---

/**
 * Sound Vortex (feature gerald-vortex): the settings / URL / presets, the funnel geometry, the spiral integration (the
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
    expect(resolveVortexSettings({ balls: 99, stagger: -1, rings: 2, duration: 100, gravity: 0, depthScale: 7 })).toMatchObject({ balls: 99, stagger: 0, rings: 6, duration: 100, gravity: 0.2, depthScale: 7 }); // --- uncap-all --- (no maximum)
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
    expect(resolveVortexFields(bad)).toEqual({ ...defaultVortexFields(), vxBalls: 500, vxDuration: 3 }); // --- uncap-all --- (no maximum)
    const preset = presetToSettings({ mode: "vortex", vxBalls: 0, vxLoop: "no", vxGravity: 9 } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(resolveVortexFields(preset)).toMatchObject({ vxBalls: 1, vxLoop: false, vxGravity: 9 });
  });

  it("the mode is registered: a rhythm card with the Gerald family, before Glass Smash", () => {
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

/* ------------------------------------------------------------------ --- funnel-spin --- the ring waves and the perspective view */

/** A ring release engine (the defaults: waves of 6, 12 and 24 every 4.5 s, friction 0.02, a 5 s first lap, a hole of 25 %). */
function ringEngine(patch: Partial<VortexSettings> = {}, seed = 7, cfg: PhysicsConfig = config) {
  return vortexEngine({ release: "rings", ...patch }, seed, cfg);
}

/** The angle of every flying marble of wave `k`, measured from its position about the funnel's centre. */
function waveAngles(engine: PhysicsEngine, k: number): number[] {
  const v = engine.getVortexView();
  const f = v.funnel;
  const out: number[] = [];
  for (let i = 0; i < f.waveSize[k]; i++) {
    const slot = f.waveFirst[k] + i;
    if (v.slotState[slot] !== 1) continue;
    out.push(Math.atan2(v.slotY[slot] - v.field.cy, v.slotX[slot] - v.field.cx));
  }
  return out;
}

/** The wrapped difference a − b in (−π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d <= -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

describe("funnel spin-up: settings, URL and presets", () => {
  it("defaults leave the Sound Vortex as it was: stagger, top view, nothing in the URL", () => {
    expect(defaultFunnelSpinFields()).toEqual(DEFAULT_FUNNEL_SPIN_FIELDS);
    expect(DEFAULT_FUNNEL_SPIN_FIELDS).toMatchObject({ vxRelease: "stagger", vxView: "top", vxWaves: "6, 12, 24", vxWaveInterval: 4.5, vxFunnelDepth: 1, vxElevation: 25, vxSpinFriction: 0.02, vxFirstLap: 5, vxHoleSize: 25, vxRefillGap: 1, vxLapReadout: false });
    for (const key of Object.keys(FUNNEL_SPIN_RANGES) as (keyof typeof FUNNEL_SPIN_RANGES)[]) expect(RANGES[key]).toEqual(FUNNEL_SPIN_RANGES[key]);
    expect(FUNNEL_SPIN_RANGES).toMatchObject({ vxWaveInterval: { min: 0, max: 120 }, vxFunnelDepth: { min: 0, max: 5 }, vxElevation: { min: 0, max: 90 }, vxSpinFriction: { min: 0, max: 1 }, vxFirstLap: { min: 0.1, max: 120 }, vxHoleSize: { min: 1, max: 50 }, vxRefillGap: { min: 0, max: 30 } });
    for (const mode of MODE_IDS) {
      const params = settingsToSearchParams(defaultSettings(mode));
      for (const key of ["vxrl", "vxv", "vxw", "vxwi", "vxfd", "vxe", "vxsf", "vxfl", "vxh", "vxrg", "vxlr"]) expect(params.has(key)).toBe(false);
    }
    expect(resolveVortexSettings({})).toMatchObject({ release: "stagger", view: "top", waves: [6, 12, 24], holeSize: 25, bpm: 120 });
  });

  it("round-trips through vxrl / vxv / vxw / vxwi / vxfd / vxe / vxsf / vxfl / vxh / vxrg / vxlr, uncapped from each minimum", () => {
    const s = { ...defaultSettings("vortex"), vxRelease: "rings" as const, vxView: "perspective" as const, vxWaves: "1, 2, 4, 8", vxWaveInterval: 3.25, vxFunnelDepth: 2.5, vxElevation: 40, vxSpinFriction: 0.0125, vxFirstLap: 7, vxHoleSize: 18, vxRefillGap: 2, vxLapReadout: true };
    const params = settingsToSearchParams(s);
    expect(Object.fromEntries(["vxrl", "vxv", "vxw", "vxwi", "vxfd", "vxe", "vxsf", "vxfl", "vxh", "vxrg", "vxlr"].map((k) => [k, params.get(k)]))).toEqual({ vxrl: "rings", vxv: "perspective", vxw: "1,2,4,8", vxwi: "3.25", vxfd: "2.5", vxe: "40", vxsf: "0.0125", vxfl: "7", vxh: "18", vxrg: "2", vxlr: "1" });
    const back = settingsFromSearchParams(params);
    expect(resolveFunnelSpinFields(back)).toEqual({ vxRelease: "rings", vxView: "perspective", vxWaves: "1, 2, 4, 8", vxWaveInterval: 3.25, vxFunnelDepth: 2.5, vxElevation: 40, vxSpinFriction: 0.0125, vxFirstLap: 7, vxHoleSize: 18, vxRefillGap: 2, vxLapReadout: true });
    // bad values fall back, values past a slider are kept (uncapped), values under a minimum are lifted onto it
    const bad = settingsFromSearchParams(new URLSearchParams("mode=vortex&vxrl=spiral&vxv=side&vxw=a,b&vxwi=500&vxe=-5&vxfl=0&vxsf=x&vxh=99"));
    expect(resolveFunnelSpinFields(bad)).toMatchObject({ vxRelease: "stagger", vxView: "top", vxWaves: "6, 12, 24", vxWaveInterval: 500, vxElevation: 0, vxFirstLap: 0.1, vxSpinFriction: 0.02, vxHoleSize: 99 });
    expect(parseWaves("6;12  24,,0, -3, 2.6")).toEqual([6, 12, 24, 1, 1, 3]);
    expect(formatWaves(doublingWaves(1, 9))).toBe("1, 2, 4, 8, 16, 32, 64, 128, 256");
  });

  it("the presets: Ring of 24, Galaxy, Coin funnel and Doubling, each looping on the navy page with the loop HUD", () => {
    expect([...FS_PRESET_IDS]).toEqual(["ring24", "galaxy", "coin", "doubling"]);
    const ring = funnelSpinPresetPatch("ring24");
    expect(ring).toMatchObject({ vxRelease: "rings", vxView: "perspective", vxWaves: "6, 12, 24", vxWaveInterval: 4.5, vxElevation: 25, vxLoop: true, loopHud: true, backgroundColors: ["#060914", "#060914"] });
    expect(funnelSpinPresetPatch("galaxy")).toMatchObject({ vxView: "top", vxWaves: "360" });
    expect(funnelSpinPresetPatch("coin")).toMatchObject({ vxWaves: "1", vxView: "perspective" });
    const coin = funnelSpinPresetPatch("coin");
    expect(funnelStepTiming(1, 0, coin.vxHoleSize, coin.vxSpinFriction, coin.vxFirstLap, 0, 1 / 60).descentSec).toBeGreaterThan(55);
    expect(funnelSpinPresetPatch("doubling")).toMatchObject({ vxWaves: "1, 2, 4, 8, 16, 32, 64, 128, 256", vxLapReadout: true });
    const applied = presetToSettings({ ...defaultSettings("vortex"), ...ring });
    expect(resolveFunnelSpinFields(applied)).toMatchObject({ vxRelease: "rings", vxView: "perspective" });
  });

  it("the waves stop at the engine's ball ceiling (the typed list is kept)", () => {
    expect(wavesForRun([3000, 3000, 10])).toEqual([3000, ENTITY_CEILING - 3000]);
    const engine = ringEngine({ waves: [4000, 4000], waveInterval: 0 });
    engine.update(STEP, 0);
    expect(engine.getVortexView().slotCount).toBe(ENTITY_CEILING);
    expect(resolveFunnelSpinFields({ vxWaves: "4000, 4000" }).vxWaves).toBe("4000, 4000");
  });
});

describe("funnel spin-up: the ring physics", () => {
  it("the defaults: a 5 s first lap, 12.5 s from the rim to the hole, about 11 times faster at the bottom", () => {
    expect(FS_SLIP_RATIO * 0.02 * FS_DEFAULT_DESCENT_SEC).toBeCloseTo(Math.log(FS_ENTRY_AT / 0.25), 12);
    expect(slipRate(0.02)).toBeCloseTo(Math.log(FS_ENTRY_AT / 0.25) / 12.5, 12);
    expect(slipRate(0)).toBe(0);
    const gain = funnelLapGain(FS_ENTRY_AT, 0.25, 0.02);
    expect(gain).toBeGreaterThan(10);
    expect(gain).toBeLessThan(13);
    expect(lapRate(releaseSpin(FS_ENTRY_AT, 5), FS_ENTRY_AT)).toBeCloseTo((2 * Math.PI) / 5, 12);
    expect(funnelDescentSteps(25, 0.02, 5, 1 / 60) / 60).toBeCloseTo(12.5, 1);
  });

  it("1. a ring of N released together stays evenly spaced to within 1e-9 rad", () => {
    for (const n of [6, 24, 360]) {
      const engine = ringEngine({ waves: [n], loop: false });
      let checks = 0;
      for (let i = 1; i <= 60 * 12; i++) {
        engine.update(STEP, 0);
        if (i % 30 !== 0) continue;
        const v = engine.getVortexView();
        if (v.funnel.waveState[0] !== 1) break;
        const a = waveAngles(engine, 0);
        expect(a).toHaveLength(n);
        for (let j = 0; j < n; j++) expect(Math.abs(angleDiff(a[(j + 1) % n], a[j]) - angleDiff((2 * Math.PI) / n, 0))).toBeLessThan(1e-9);
        // and every marble sits on the same circle
        const first = v.funnel.waveFirst[0];
        for (let j = 1; j < n; j++) expect(v.slotR[first + j]).toBe(v.slotR[first]);
        checks++;
      }
      expect(checks).toBeGreaterThan(10);
    }
  });

  it("2. the lap rate rises as r falls", () => {
    const engine = ringEngine({ waves: [12], loop: false });
    const f = engine.getVortexView().funnel;
    let lastR = Infinity;
    let lastOmega = 0;
    let samples = 0;
    for (let i = 1; i <= 60 * 13; i++) {
      engine.update(STEP, 0);
      if (f.waveState[0] !== 1) break;
      const r = f.waveR[0];
      const omega = lapRate(f.waveL[0], r);
      expect(r).toBeLessThan(lastR);
      expect(omega).toBeGreaterThan(lastOmega);
      lastR = r;
      lastOmega = omega;
      samples++;
    }
    expect(samples).toBeGreaterThan(700);
    // the matched spiral: about the lap gain by the hole, the swallow 12.5 s after the release (to a step or two)
    expect(lastOmega / f.omega0).toBeGreaterThan(0.9 * f.lapGain);
    expect(f.waveState[0]).toBe(2);
    expect(Math.abs(engine.getVortexView().lastSwallowMs / 1000 - 12.5)).toBeLessThan(0.05);
  });

  it("3. with spin friction 0, L is conserved to 1e-9 (and the ring orbits the rim for ever)", () => {
    const L0 = releaseSpin(FS_ENTRY_AT, 5);
    const p = pullExponent();
    const C = pullStrength(L0, FS_ENTRY_AT, p);
    const st: FunnelState = { r: FS_ENTRY_AT, vr: 0, turn: 0, L: L0 };
    for (let i = 0; i < 60 * 600; i++) stepFunnel(st, 1 / 60, C, p, slipRate(0), 0);
    expect(Math.abs(st.L - L0) / L0).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(st.r - FS_ENTRY_AT)).toBeLessThan(1e-9);
    expect(st.turn / (2 * Math.PI)).toBeCloseTo(600 / 5, 6);
    const engine = ringEngine({ spinFriction: 0, waves: [24] });
    const f = engine.getVortexView().funnel;
    for (let i = 0; i < 60 * 20; i++) engine.update(STEP, 0);
    expect(Math.abs(f.waveL[0] - L0) / L0).toBeLessThanOrEqual(1e-9);
    expect(f.waveState[0]).toBe(1);
    expect(engine.getCycleSeconds()).toBeNull();
    expect(runNeverFinishes("vortex", { ...modeSettings, vortex: { release: "rings", spinFriction: 0 } })).toBe(true);
    // with friction a ring loses L exactly at its rate: L(t) = L₀·e^(−k·t)
    const g: FunnelState = { r: FS_ENTRY_AT, vr: -slipRate(0.02) * FS_ENTRY_AT, turn: 0, L: L0 };
    for (let i = 0; i < 60 * 5; i++) stepFunnel(g, 1 / 60, C, p, slipRate(0.02), 0.02);
    expect(g.L / L0).toBeCloseTo(Math.exp(-0.02 * 5), 9);
    expect(g.r / FS_ENTRY_AT).toBeCloseTo(Math.exp(-slipRate(0.02) * 5), 3);
  });

  it("4. depth order holds at the lip: every marble lies behind the front lip, the back half before the front half", () => {
    for (const elevation of [5, 25, 45, 70, 90]) {
      for (const depth of [0, 1, 3]) {
        const frame = funnelFrame(400, 300, 276, 69, elevation, depth);
        const lip = lipDepth(frame);
        for (let r = 69; r <= 276; r += 23) {
          for (let k = 0; k < 36; k++) {
            const th = (k * 2 * Math.PI) / 36;
            expect(funnelDepthKey(frame, r, th)).toBeGreaterThanOrEqual(lip - 1e-9);
            // the back point (sin θ < 0) of a level is farther than its mirror image in front
            if (Math.sin(th) < -1e-9 && elevation < 90) expect(funnelDepthKey(frame, r, th)).toBeGreaterThan(funnelDepthKey(frame, r, -th));
          }
        }
        // the draw order: farthest first – the back half of a ring before its front half
        const n = 24;
        const keys = new Float64Array(n);
        const order = new Int32Array(n);
        for (let i = 0; i < n; i++) keys[i] = funnelDepthKey(frame, 200, (i * 2 * Math.PI) / n);
        expect(funnelDrawOrder(keys, n, order)).toBe(n);
        for (let i = 1; i < n; i++) expect(keys[order[i]]).toBeLessThanOrEqual(keys[order[i - 1]]);
        if (elevation < 90) {
          const backs = Array.from(order).map((i) => Math.sin((i * 2 * Math.PI) / n) < -1e-9);
          const lastBack = backs.lastIndexOf(true);
          const firstFront = Array.from(order).findIndex((i) => Math.sin((i * 2 * Math.PI) / n) > 1e-9);
          expect(lastBack).toBeLessThan(firstFront);
        }
      }
    }
    // the renderer strokes the front lip after the last marble
    const engine = ringEngine({ view: "perspective", waves: [24] });
    for (let i = 0; i < 60; i++) engine.update(STEP, 0);
    const canvas = fakeCanvas(800, 600);
    const ctx = canvas.ctx;
    ctx.ellipse = (...args: unknown[]) => ctx.calls.push({ name: "ellipse", args });
    const layer = new FunnelLayer();
    layer.drawWorld(ctx as unknown as CanvasRenderingContext2D, engine.getVortexView(), { ballRadius: 8, wallThickness: 2 });
    const worldCalls = ctx.calls.length;
    layer.drawBodies(ctx as unknown as CanvasRenderingContext2D, engine.getVortexView(), { ballRadius: 8, wallThickness: 2 });
    const body = ctx.calls.slice(worldCalls);
    const arcs = body.filter((c) => c.name === "arc").length;
    expect(arcs).toBe(3 * 24);
    const lastArc = body.map((c) => c.name).lastIndexOf("arc");
    const lip = body.map((c) => c.name).lastIndexOf("ellipse");
    expect(lip).toBeGreaterThan(lastArc);
    expect(body.at(-2)?.name).toBe("stroke");
  });

  it("5. with release stagger and view top the recorded fingerprint is unchanged (tests/extras.test.ts' baseline)", () => {
    const BASELINE = [[505441, 421447], [591932, 381653], [429348, 392412], [489357, 211878], [456871, 281023], [426114, 373116], [412905, 265698], [369240, 335581]];
    for (const patch of [{}, { release: "stagger", view: "top", spinFriction: 0.5, waves: [99], holeSize: 3, elevation: 10 } as Partial<VortexSettings>]) {
      const engine = vortexEngine(patch, 12345);
      const samples: number[][] = [];
      for (let i = 1; i <= 600; i++) {
        engine.update(1000 / 60, 0);
        if (i % 150 === 0) samples.push(...engine.getBalls().slice(0, 2).map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
      }
      expect(samples).toEqual(BASELINE);
    }
  });

  it("the perspective view places a stagger run's balls at their projection (90° is the top view exactly)", () => {
    const top = vortexEngine({ view: "top" }, 3);
    const flat = vortexEngine({ view: "perspective", elevation: 90 }, 3);
    const tilted = vortexEngine({ view: "perspective", elevation: 25 }, 3);
    for (let i = 0; i < 300; i++) [top, flat, tilted].forEach((e) => e.update(STEP, 0));
    const a = top.getBalls();
    const b = flat.getBalls();
    expect(b).toHaveLength(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].x).toBeCloseTo(a[i].x, 9);
      expect(b[i].y).toBeCloseTo(a[i].y, 9);
    }
    const v = tilted.getVortexView();
    const p = { x: 0, y: 0 };
    for (const ball of tilted.getBalls()) {
      const slot = v.slotX.indexOf(ball.x);
      expect(slot).toBeGreaterThanOrEqual(0);
      projectFunnel(v.funnel.frame, v.slotR[slot], v.slotTheta[slot], p);
      expect(ball.x).toBeCloseTo(p.x, 9);
      expect(ball.y).toBeCloseTo(p.y, 9);
    }
    // the same physics underneath: the radii and the notes match the top view's
    expect(v.notes).toBe(top.getVortexView().notes);
  });
});

describe("funnel spin-up: the loop, the sounds and the finder", () => {
  it("Ring of 24: 42 marbles swallowed in the first cycle, the refill at the loop point, every cycle replaying the first", () => {
    const engine = ringEngine({ loop: true, view: "perspective" });
    const v = engine.getVortexView();
    const f = v.funnel;
    expect(f.cycleSec).toBeCloseTo(9 + funnelDescentSteps(25, 0.02, 5, 1 / 60) / 60 + 1, 9);
    expect(engine.getCycleSeconds()).toBeCloseTo(f.cycleSec, 9);
    const releases: number[] = [];
    let entered = v.entered;
    const at = (sec: number) => {
      while (engine.getElapsedMs() < sec * 1000 - 1e-6) {
        engine.update(STEP, 0);
        if (v.entered > entered) releases.push(Math.round(engine.getElapsedMs()) / 1000);
        entered = v.entered;
      }
    };
    at(24);
    // the waves came at 4.5 s and 9 s (a step after their due time: they are released at the start of a step) and the refill at the seam
    expect(releases.slice(0, 2).map((t) => Math.round(t * 10) / 10)).toEqual([4.5, 9]);
    expect(f.firstCycleSwallowed).toBe(42);
    expect(f.seams).toBe(1);
    expect(f.refills).toBe(1);
    expect(f.lastRefillMs / 1000).toBeCloseTo(f.cycleSec, 6);
    expect(engine.getLoopSeams()).toMatchObject({ count: 1 });
    // the next cycle replays the first: the marbles' places a cycle apart are the same
    const snapshot = (e: PhysicsEngine) => e.getBalls().map((b) => [b.x, b.y]);
    const twin = ringEngine({ loop: true, view: "perspective" });
    while (twin.getElapsedMs() < 3000 - 1e-6) twin.update(STEP, 0);
    while (engine.getElapsedMs() < 1000 * f.cycleSec + 3000 - 1e-6) engine.update(STEP, 0);
    const a = snapshot(twin);
    const b = snapshot(engine);
    expect(b).toHaveLength(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i][0]).toBeCloseTo(a[i][0], 9);
      expect(b[i][1]).toBeCloseTo(a[i][1], 9);
    }
  });

  it("replays exactly at 30, 60 and 120 fps (pinned) and for a seed; the seed only turns the rings", () => {
    const at = (fps: number, seed = 7) => {
      const engine = ringEngine({ loop: true }, seed);
      let hash = 0x811c9dc5;
      for (let k = 1; k <= 10 * fps; k++) {
        engine.update(1000 / fps, 0);
        for (const ev of engine.consumeSoundEvents()) {
          const text = `${ev.loop}:${Math.round((ev.frequency ?? 0) * 100)}:${Math.round((ev.level ?? 1) * 1000)}`;
          for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
        }
      }
      const v = engine.getVortexView();
      return { balls: engine.getBalls().slice(0, 3).map((b) => [Math.round(b.x * 1e6), Math.round(b.y * 1e6)]), r: Array.from(v.funnel.waveR.slice(0, 3)).map((r) => Math.round(r * 1e9)), chimes: v.funnel.lapChimes, hash };
    };
    const base = at(60);
    expect(at(30)).toEqual(base);
    expect(at(120)).toEqual(base);
    expect(at(60)).toEqual(base);
    const other = at(60, 8);
    expect(other.r).toEqual(base.r);
    expect(other.balls).not.toEqual(base.balls);
  });

  it("the sounds: a chime a lap rising with the spin, the hiss following the speed, the bed's chords and kicks, the wash before the refill and the cut on it", () => {
    const engine = ringEngine({ loop: true, waves: [6, 12, 24] });
    const events: { t: number; ev: SoundEvent }[] = [];
    for (let i = 1; i <= 60 * 24; i++) {
      engine.update(STEP, 0);
      for (const ev of engine.consumeSoundEvents()) events.push({ t: engine.getElapsedMs() / 1000, ev });
    }
    const f = engine.getVortexView().funnel;
    const kinds = new Set(events.map((e) => e.ev.loop));
    for (const kind of ["chime", "hiss", "bed", "kick", "wash", "cut"]) expect(kinds.has(kind as never), kind).toBe(true);
    expect(events.every((e) => e.ev.melody === false && e.ev.loop !== undefined)).toBe(true);
    // the chimes: on C major pentatonic from C5, the first ring's rising while it spins up
    const ladder = Array.from({ length: 8 }, (_, d) => chimeHz(d));
    const chimes = events.filter((e) => e.ev.loop === "chime");
    expect(chimes.length).toBe(f.lapChimes);
    expect(chimes.every((e) => ladder.some((hz) => Math.abs(hz - (e.ev.frequency ?? 0)) < 1e-9))).toBe(true);
    const early = chimes.filter((e) => e.t < 4.5).map((e) => e.ev.frequency ?? 0);
    for (let i = 1; i < early.length; i++) expect(early[i]).toBeGreaterThanOrEqual(early[i - 1]);
    expect(chimeDegree(1, 1, 12)).toBe(0);
    expect(chimeDegree(12, 1, 12)).toBe(7);
    expect(chimeDegree(Math.sqrt(12), 1, 12)).toBe(4);
    // the hiss: 15 updates a second, 0–1, louder with more marbles in the funnel
    const hiss = events.filter((e) => e.ev.loop === "hiss");
    expect(hiss.length).toBeGreaterThan(15 * 22);
    expect(hiss.every((e) => (e.ev.level ?? -1) >= 0 && (e.ev.level ?? 2) < 1)).toBe(true);
    const level = (t: number) => hiss.reduce((best, e) => (Math.abs(e.t - t) < Math.abs(best.t - t) ? e : best)).ev.level ?? 0;
    expect(level(10)).toBeGreaterThan(level(1));
    expect(hissLevel(0, 1)).toBe(0);
    expect(hissLevel(2, 1)).toBeCloseTo(0.5, 12);
    // the bed: a chord every bar of 2 s at 120 BPM, a kick every beat from the second bar on
    const bed = events.filter((e) => e.ev.loop === "bed");
    expect(bed[0].t).toBeCloseTo(1 / 60, 9);
    const kicks = events.filter((e) => e.ev.loop === "kick" && e.t < f.cycleSec);
    expect(kicks[0].t).toBeGreaterThanOrEqual(2);
    expect(Math.abs(kicks.length - 2 * (f.cycleSec - 2))).toBeLessThanOrEqual(1);
    // the wash a second before the refill, the cut on it
    const wash = events.find((e) => e.ev.loop === "wash")!;
    expect(wash.t).toBeCloseTo(f.cycleSec - 1, 1);
    expect(wash.ev.loopSec).toBe(1);
    const cut = events.find((e) => e.ev.loop === "cut")!;
    expect(cut.t).toBeCloseTo(f.cycleSec, 6);
  });

  it("a ring run without the loop ends at its refill time, stopping the bed and the hiss; the stagger release keeps its pews", () => {
    const engine = ringEngine({ loop: false, waves: [8] });
    const kinds: string[] = [];
    let end = -1;
    for (let i = 1; i <= 60 * 20; i++) {
      engine.update(STEP, 0);
      for (const ev of engine.consumeSoundEvents()) if (ev.loop) kinds.push(ev.loop);
      if (engine.isSimulationFinished()) {
        end = engine.getElapsedMs() / 1000;
        break;
      }
    }
    const timing = funnelStepTiming(1, 4.5, 25, 0.02, 5, 1, 1 / 60);
    expect(end).toBeCloseTo(timing.cycleSec, 6);
    expect(kinds.slice(-2)).toEqual(["bedStop", "hissStop"]);
    expect(engine.getVortexView().allSwallowed).toBe(false);
    expect(fixedRunDurationSec("vortex", { ...modeSettings, vortex: { release: "rings", loop: false, waves: [8] } } as ModeSettings)).toBeCloseTo(timing.cycleSec, 9);
    expect(fixedRunDurationSec("vortex", { ...modeSettings, vortex: {} } as ModeSettings)).toBeNull();
  });

  it("plays its loop voices on a ToneGenerator at the context's time (fakeAudio): the chimes, the hiss on its band-pass, the hiss stopped with the loop", async () => {
    const graph = fakeAudioGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    try {
      const tone = new ToneGenerator();
      await tone.start();
      tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
      const engine = ringEngine({ loop: true });
      for (let k = 0; k < 60 * 6; k++) {
        engine.update(STEP, 0);
        graph.ctx.currentTime = engine.getElapsedMs() / 1000;
        for (const ev of engine.consumeSoundEvents()) playSoundEvent(tone, ev, () => undefined);
      }
      const ladder = Array.from({ length: 8 }, (_, d) => chimeHz(d));
      expect(graph.oscillators.some((o) => ladder.some((hz) => Math.abs(o.frequency - hz) < 1e-6))).toBe(true);
      expect(graph.filters.some((filter) => filter.type === "bandpass" && filter.frequency.value === 1200)).toBe(true);
      const hissTargets = graph.ramps.filter((r) => r.kind === "target" && r.param === "gain");
      expect(hissTargets.length).toBeGreaterThan(10);
      const before = graph.ramps.length;
      tone.resetLoop();
      expect(graph.ramps.slice(before).some((r) => r.kind === "target" && r.value === 0)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Find Simulation: the last ring's vanish on a bar line, by the wave interval (or the friction for one ring), the run found landing there", () => {
    const vortex = vortexSettingsOf({ ...defaultSettings("vortex"), vxRelease: "rings", vxLoop: true });
    expect(availableOutcomes("vortex", { endless: true, neverEscape: false, ballCount: 1, vortexRings: true })).toEqual(["ring-on-bar"]);
    expect(availableOutcomes("vortex", { endless: false, neverEscape: false, ballCount: 1 })).not.toContain("ring-on-bar");
    for (const [bpm, waves] of [[120, [6, 12, 24]], [97, [6, 12, 24]], [120, [24]], [100, [1, 2, 4, 8]]] as [number, number[]][]) {
      const bar = 240 / bpm;
      const result = findFunnelSpinRun({ targetDurationSec: 30, modeSettings: { ...modeSettings, vortex: { ...vortex, waves } }, outcome: { kind: "ring-on-bar", clipSec: 30, atSec: bar } }, 5);
      expect(result.found, `${bpm} ${waves}`).toBe(true);
      const fs = result.funnelSpin!;
      expect(Math.abs(fs.vanishSec - fs.bars * bar)).toBeLessThanOrEqual(0.02 + 1e-9);
      if (waves.length > 1) expect(fs.friction).toBe(0.02);
      expect(result.duration).toBeCloseTo(fs.loops * fs.cycleSec, 9);
      // the run with the found settings: its last ring vanishes when the search said
      const engine = ringEngine({ waves, waveInterval: fs.interval, spinFriction: fs.friction, loop: true });
      const v = engine.getVortexView();
      while (v.funnel.firstCycleSwallowed < 0 && engine.getElapsedMs() < 120_000) {
        engine.update(STEP, 0);
        if (v.funnel.cycleSwallowed === v.slotCount && v.funnel.seams === 0) break;
      }
      expect(v.lastSwallowMs / 1000).toBeCloseTo(fs.vanishSec, 6);
    }
    // a frictionless ring is given the friction that brings it down on a bar line; a hole as wide as the rim has nothing to time
    const frictionless = findFunnelSpinRun({ targetDurationSec: 30, modeSettings: { ...modeSettings, vortex: { ...vortex, spinFriction: 0, waves: [6] } }, outcome: { kind: "ring-on-bar", clipSec: 30, atSec: 2 } }, 5);
    expect(frictionless.found).toBe(true);
    expect(frictionless.funnelSpin!.friction).toBeGreaterThan(0);
    const none = findFunnelSpinRun({ targetDurationSec: 30, modeSettings: { ...modeSettings, vortex: { ...vortex, holeSize: 99, waves: [6] } }, outcome: { kind: "ring-on-bar", clipSec: 30, atSec: 2 } }, 5);
    expect(none.found).toBe(false);
    expect(none.outcome).toBe("ring-on-bar");
  });

  it("the loop HUD's lap readout, the canvas words and the loop-style caption", () => {
    const engine = ringEngine({ loop: true, lapReadout: true });
    for (let i = 0; i < 60; i++) engine.update(STEP, 0);
    const count = loopHudCount(engine);
    expect(count).toMatchObject({ values: { lap: expect.any(Number) } });
    const lap = (count as unknown as { values: { lap: number } }).values.lap;
    expect(lap).toBeGreaterThan(4);
    expect(lap).toBeLessThanOrEqual(5);
    const counter = count as unknown as { count: number; values: Record<string, number> };
    expect(hudCounterText("lap {lap} s", counter.count, undefined, counter.values)).toBe(`lap ${lap.toFixed(2)} s`);
    expect(loopHudCount(ringEngine({ loop: true, lapReadout: false }))).toBeNull();
    expect(loopHudCount(vortexEngine())).toBeNull();
    const ctxFor = loopCaptionContext({ ...defaultSettings("vortex"), vxRelease: "rings", vxWaves: "6, 12, 24" } as never);
    expect(ctxFor).toMatchObject({ mode: "vortex", hookKey: "funnelSpin", factKey: "funnelSpinFact", count: 24 });
    expect(loopCaptionContext({ ...defaultSettings("vortex") } as never).hookKey).not.toBe("funnelSpin");
  });
});
