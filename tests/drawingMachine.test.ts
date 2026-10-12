import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings, runNeverFinishes, type ModeSettings } from "@/lib/simulation/finder";
import {
  DEFAULT_DRAWING_MACHINE_SETTINGS,
  DM_ORBIT_START,
  DM_RANGES,
  DM_TRACE_CEILING,
  DmTrace,
  chordsBy,
  chordsPerCycle,
  conjunctionPeriod,
  conjunctionsPerCycle,
  conjunctionsUpTo,
  dmStride,
  dmTimeline,
  harmonographPendulums,
  orbitAngle,
  orbitPeriods,
  orbitsYearAt,
  penAt,
  penEnergy,
  penEnvelope,
  resolveDrawingMachineSettings,
  traceRateHz,
  yearShown,
  type DrawingMachineSettings,
} from "@/lib/physics/drawingMachine";
import {
  DEFAULT_DRAWING_MACHINE_FIELDS,
  DM_PRESET_IDS,
  DM_RESTART_FIELDS,
  DM_URL_KEYS,
  dmOrbitsTitle,
  dmTitleBodies,
  dmYearTemplate,
  drawingMachinePresetPatch,
  drawingMachineSettingsOf,
  drawingMachineSwitchPatch,
  readDrawingMachineParams,
  resolveDrawingMachineFields,
  writeDrawingMachineParams,
} from "@/lib/physics/drawingMachineFields";
import { dmPluckFrequency } from "@/lib/physics/modes/drawingMachine";
import { defaultSettings, engineSettingKeys, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { hudCounterText, loopHudCount, loopHudFrame } from "@/lib/loop/hud";
import { loopCaptionContext } from "@/lib/publish/loopCaption";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { startDrone } from "@/lib/audio/loopTones";
import { NoiseCache } from "@/lib/audio/stringBattleTones";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";
import { DrawingMachineLayer, drawingMachineExtentPx, rampPalette, rampStep, writeDrawingMachineDataset, DRAWING_MACHINE_DATA_KEYS } from "@/components/simulator/drawingMachineRenderer";
import { fakeGraph } from "./fakeAudio";
import { fakeCanvas, type FakeCanvas } from "./fakeCanvas";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- drawing-machine --- Drawing Machines (lib/physics/drawingMachine.ts, drawingMachineFields.ts, modes/drawingMachine.ts,
 * components/simulator/drawingMachineRenderer.ts): the spec's six promises – the pen's closed form and its decay, a figure
 * that closes without detune, the 13 : 8 orbits back at the start after 8 years, five conjunctions 144° apart, the rewind
 * un-drawing newest first down to none, the trace's ceiling – then the cycle and the loop contract, the frame rate, the sounds
 * through a real ToneGenerator, the settings and links, the HUD, the captions and the renderer.
 */

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
const STEP = 1000 / 60;
const TAU = 2 * Math.PI;

function dmEngine(patch: Partial<DrawingMachineSettings> = {}, seed = 7, cfg: PhysicsConfig = config): PhysicsEngine {
  return createEngineForSettings(cfg, "drawingMachine", { ...base, drawingMachine: patch }, seed);
}

/** Steps `engine` `frames` times by `frameMs`, collecting every sound event (and calling `each` after every frame). */
function run(engine: PhysicsEngine, frames: number, frameMs = STEP, each?: () => void): SoundEvent[] {
  const out: SoundEvent[] = [];
  for (let k = 0; k < frames; k++) {
    engine.update(frameMs, 0);
    out.push(...engine.consumeSoundEvents());
    each?.();
  }
  return out;
}

/** An angle folded into (−π, π]. */
function wrap(a: number): number {
  let x = a % TAU;
  if (x <= -Math.PI) x += TAU;
  if (x > Math.PI) x -= TAU;
  return x;
}

/** A small seeded generator (the tests' own sample times). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Drawing Machines: the harmonograph", () => {
  it("1. puts the pen where the closed form says at random times, and the swings decay as e^(−t/τ)", () => {
    const s = { ...DEFAULT_DRAWING_MACHINE_SETTINGS };
    const p = harmonographPendulums(s);
    const A1 = s.ampX / 100;
    const A2 = s.ampY / 100;
    const A3 = s.ampR / 100;
    const f1 = s.freq;
    const f2 = 1.02 * f1; // the caption's 2 % detune
    const f3 = 2 * f1;
    const tau = s.damping;
    const [p1, p2, p3] = [s.phaseX, s.phaseY, s.phaseR].map((d) => (d * Math.PI) / 180);
    const rand = rng(11);
    for (let i = 0; i < 200; i++) {
      const t = 30 * rand();
      const env = Math.exp(-t / tau);
      const x = A1 * env * Math.sin(TAU * f1 * t + p1) + A3 * env * Math.sin(TAU * f3 * t + p3);
      const y = A2 * env * Math.sin(TAU * f2 * t + p2) + A3 * env * Math.cos(TAU * f3 * t + p3);
      const pen = penAt(p, t);
      expect(pen.x).toBeCloseTo(x, 12);
      expect(pen.y).toBeCloseTo(y, 12);
      // the velocity is the closed form's derivative (a central difference agrees)
      const h = 1e-6;
      const a = penAt(p, t - h);
      const b = penAt(p, t + h);
      expect(pen.vx).toBeCloseTo((b.x - a.x) / (2 * h), 5);
      expect(pen.vy).toBeCloseTo((b.y - a.y) / (2 * h), 5);
      // the envelope and the energy decay as e^(−t/τ) and e^(−2t/τ)
      expect(penEnvelope(tau, t)).toBeCloseTo(env, 14);
      expect(penEnergy(p, t)).toBeCloseTo(env * env, 12);
      expect(Math.hypot(pen.x, pen.y)).toBeLessThanOrEqual((A1 + A2 + 2 * A3) * env + 1e-12);
    }
    // friction leaves about 30 % of the drawing after 22 s (τ ≈ 18 s)
    expect(penEnvelope(18, 22)).toBeGreaterThan(0.28);
    expect(penEnvelope(18, 22)).toBeLessThan(0.32);
  });

  it("2. closes on itself with 0 % detune (and stays self-similar under friction); 2 % keeps it twisting", () => {
    const s = { ...DEFAULT_DRAWING_MACHINE_SETTINGS, detune: 0 };
    const free = harmonographPendulums({ ...s, damping: Infinity });
    const T = 1 / s.freq;
    const rand = rng(5);
    for (let i = 0; i < 50; i++) {
      const t = 20 * rand();
      const a = penAt(free, t);
      const b = penAt(free, t + T);
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-9);
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-9);
      // with friction one period later is the same figure shrunk by e^(−T/τ)
      const damped = harmonographPendulums(s);
      const k = Math.exp(-T / s.damping);
      expect(penAt(damped, t + T).x).toBeCloseTo(k * penAt(damped, t).x, 12);
      expect(penAt(damped, t + T).y).toBeCloseTo(k * penAt(damped, t).y, 12);
    }
    const twisted = harmonographPendulums({ ...s, detune: 2, damping: Infinity });
    let drift = 0;
    for (let i = 0; i < 50; i++) drift = Math.max(drift, Math.abs(penAt(twisted, i * 0.37 + 10 * T).y - penAt(twisted, i * 0.37).y));
    expect(drift).toBeGreaterThan(0.05);
  });

  it("samples the trace at 240 Hz or more of simulation time, each point on the closed form, whatever the frame rate", () => {
    expect(traceRateHz(harmonographPendulums(DEFAULT_DRAWING_MACHINE_SETTINGS))).toBe(240);
    expect(traceRateHz(harmonographPendulums({ ...DEFAULT_DRAWING_MACHINE_SETTINGS, freq: 20, rotary: 8 }))).toBe(64 * 160);
    const at = (fps: number) => {
      const engine = dmEngine({}, 3);
      const events = run(engine, 5 * fps, 1000 / fps);
      const v = engine.getDrawingMachineView();
      const points: number[] = [];
      for (let i = v.trace.first; i < v.trace.total; i += 97) points.push(Math.round(v.trace.xs[v.trace.slot(i)] * 1e6), Math.round(v.trace.ys[v.trace.slot(i)] * 1e6));
      return { total: v.trace.total, points, pen: [Math.round(v.penX * 1000), Math.round(v.penY * 1000)], drones: events.filter((e) => e.loop === "drone").length };
    };
    const ref = at(60);
    expect(ref.total).toBe(Math.floor(5 * 240 + 1e-9) + 1);
    expect(at(30)).toEqual(ref);
    expect(at(120)).toEqual(ref);
    const engine = dmEngine({}, 3);
    run(engine, 300);
    const v = engine.getDrawingMachineView();
    for (let i = 0; i < v.trace.total; i += 37) {
      const slot = v.trace.slot(i);
      const p = penAt(v.pendulums, i / v.rate);
      expect(v.trace.ts[slot]).toBeCloseTo(i / v.rate, 4);
      expect(v.trace.xs[slot]).toBeCloseTo(p.x, 6);
      expect(v.trace.ys[slot]).toBeCloseTo(p.y, 6);
    }
  });

  it("6. keeps the trace within its memory-safety ceiling, dropping the oldest points", () => {
    const trace = new DmTrace(5);
    for (let i = 0; i < 12; i++) trace.push(i, -i, i / 10);
    expect(trace.capacity).toBe(5);
    expect(trace.total).toBe(12);
    expect(trace.count).toBe(5);
    expect(trace.first).toBe(7);
    expect(trace.has(6)).toBe(false);
    expect(trace.has(7)).toBe(true);
    expect(trace.xs[trace.slot(11)]).toBe(11);
    expect(trace.xs[trace.slot(7)]).toBe(7);
    trace.reset();
    expect(trace.count + trace.total).toBe(0);
    // a fast machine drawing for a minute samples more than the ceiling: the buffer holds the newest, never more
    const engine = dmEngine({ freq: 20, rotary: 8, drawSec: 60 }, 1);
    run(engine, 61 * 60);
    const v = engine.getDrawingMachineView();
    expect(v.rate * 60).toBeGreaterThan(DM_TRACE_CEILING);
    expect(v.trace.capacity).toBe(DM_TRACE_CEILING);
    expect(v.trace.count).toBe(DM_TRACE_CEILING);
    expect(v.trace.total).toBeGreaterThan(DM_TRACE_CEILING);
    const last = v.trace.slot(v.trace.total - 1);
    expect(v.trace.ts[last]).toBeCloseTo(60, 3);
    // an engine of the default sheet allocates what the sheet holds, not the ceiling
    expect(dmEngine({}).getDrawingMachineView().trace.capacity).toBe(Math.ceil(22.5 * 240) + 2);
  });

  it("draws for 22.5 s, scrolls the paper once in 1.5 s and starts again exactly like the first sheet (the loop contract)", () => {
    const engine = dmEngine({}, 2);
    expect(engine.getCycleSeconds()).toBeCloseTo(24, 12);
    expect(engine.getLoopSeams()).toMatchObject({ count: 0, lastMs: -1, nextMs: 24000 });
    const v = engine.getDrawingMachineView();
    const first = { x: v.penX, y: v.penY, total: v.trace.total };
    let maxScroll = 0;
    let scrolledAt = -1;
    const events = run(engine, 22.5 * 60, STEP, () => {
      if (v.scrolls > 0 && scrolledAt < 0) scrolledAt = v.timeSec;
    });
    expect(v.phase).toBe("scroll");
    expect(scrolledAt).toBeCloseTo(22.5, 6);
    expect(events.filter((e) => e.loop === "ratchet")).toHaveLength(1);
    expect(events.find((e) => e.loop === "ratchet")?.loopSec).toBeCloseTo(1.5, 12);
    run(engine, 1.5 * 60 - 1, STEP, () => (maxScroll = Math.max(maxScroll, v.scroll)));
    expect(maxScroll).toBeGreaterThan(0.99);
    expect(v.cycleIndex).toBe(0);
    run(engine, 1);
    // the seam: a fresh sheet, the pen back on its first point, the trace as at the start
    expect(v.cycleIndex).toBe(1);
    expect(v.sheets).toBe(2);
    expect(v.scrolls).toBe(1);
    expect(v.scroll).toBe(0);
    expect(v.penX).toBeCloseTo(first.x, 6);
    expect(v.penY).toBeCloseTo(first.y, 6);
    expect(v.trace.total).toBe(first.total);
    expect(engine.getLoopSeams()).toMatchObject({ count: 1, lastMs: 24000, nextMs: 48000 });
    // a second cycle scrolls once more
    const more = run(engine, 24 * 60);
    expect(more.filter((e) => e.loop === "ratchet")).toHaveLength(1);
    expect(v.scrolls).toBe(2);
    expect(runNeverFinishes("drawingMachine", { drop: {}, box: {}, pendulum: {}, polyrhythm: {}, doublePendulum: {}, illusion: {}, runner: {}, paddle: {}, vortex: {}, paintPicture: false, orbGrid: {} } as never)).toBe(true);
    expect(engine.isSimulationFinished()).toBe(false);
  });
});

describe("Drawing Machines: the orbits", () => {
  const orbits: Partial<DrawingMachineSettings> = { machine: "orbits" };

  it("3. at exactly 13 : 8 both planets are back at the start after 8 years (to 1e-9)", () => {
    const s = resolveDrawingMachineSettings(orbits);
    const P = orbitPeriods(s);
    expect(P.inner).toBeCloseTo(8 / 13, 15);
    expect(P.outer).toBeCloseTo(1, 15);
    expect(Math.abs(wrap(orbitAngle(P.inner, 8) - DM_ORBIT_START))).toBeLessThan(1e-9);
    expect(Math.abs(wrap(orbitAngle(P.outer, 8) - DM_ORBIT_START))).toBeLessThan(1e-9);
    // and not before: the configuration first repeats at year 8
    for (const y of [1.6, 3.2, 4, 6.4]) expect(Math.abs(wrap(orbitAngle(P.inner, y) - DM_ORBIT_START)) + Math.abs(wrap(orbitAngle(P.outer, y) - DM_ORBIT_START))).toBeGreaterThan(1e-3);
    // the engine's planets at the end of the drawing
    const engine = dmEngine(orbits, 1);
    const v = engine.getDrawingMachineView();
    const start = { ix: v.innerX, iy: v.innerY, ox: v.outerX, oy: v.outerY };
    run(engine, Math.round(14.4 * 60) + 2);
    expect(v.phase).toBe("hold");
    expect(v.year).toBe(8);
    expect(Math.hypot(v.innerX - start.ix, v.innerY - start.iy)).toBeLessThan(1e-6);
    expect(Math.hypot(v.outerX - start.ox, v.outerY - start.oy)).toBeLessThan(1e-6);
    // the real periods do not close: Venus is off by ~2.5 days' worth of angle after 8 years
    const real = orbitPeriods({ ...s, exact: false });
    expect(Math.abs(wrap(orbitAngle(real.inner, 8 * (365.256 / 365.256)) - DM_ORBIT_START))).toBeGreaterThan(1e-3);
  });

  it("4. has exactly 5 conjunctions in 8 years, each 144° further round", () => {
    const s = resolveDrawingMachineSettings(orbits);
    const P = orbitPeriods(s);
    const S = conjunctionPeriod(P.inner, P.outer);
    expect(S).toBeCloseTo(1.6, 12);
    expect(conjunctionsPerCycle(8, S)).toBe(5);
    expect(conjunctionsUpTo(8, S)).toBe(6); // (the closing one at year 8 is the next cycle's first)
    // the relative angle crosses 0 exactly there (a scan of its sign agrees with the closed form)
    let crossings = 0;
    const dt = 1e-3;
    let prev = Math.sin(orbitAngle(P.inner, dt / 2) - orbitAngle(P.outer, dt / 2));
    for (let t = dt * 1.5; t < 8 - dt; t += dt) {
      const d = Math.sin(orbitAngle(P.inner, t) - orbitAngle(P.outer, t));
      const c = Math.cos(orbitAngle(P.inner, t) - orbitAngle(P.outer, t));
      if (Math.sign(d) !== Math.sign(prev) && c > 0) crossings++;
      prev = d;
    }
    expect(crossings + 1).toBe(5); // + the start's
    for (let j = 0; j < 5; j++) {
      const a = orbitAngle(P.outer, j * S);
      const b = orbitAngle(P.outer, (j + 1) * S);
      expect(Math.abs(wrap(orbitAngle(P.inner, j * S) - a))).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(wrap(b - a)) - (144 * Math.PI) / 180)).toBeLessThan(1e-9);
    }
    // the engine marks them as it goes and plucks one degree higher each time
    const engine = dmEngine(orbits, 1);
    const v = engine.getDrawingMachineView();
    const events = run(engine, Math.round(14.4 * 60) + 1);
    expect(v.conjPerCycle).toBe(5);
    expect(v.marksVisible).toBe(6);
    const plucks = events.filter((e) => e.loop === "pluck").map((e) => e.frequency ?? 0);
    // the start's conjunction, the four between and the one that closes the flower at year 8
    expect(plucks).toHaveLength(6);
    for (let j = 1; j < plucks.length; j++) expect(plucks[j]).toBeGreaterThan(plucks[j - 1]);
    for (let j = 0; j < plucks.length; j++) expect(plucks[j]).toBeCloseTo(dmPluckFrequency(j), 9);
    expect(dmPluckFrequency(0)).toBeCloseTo(440, 9);
  });

  it("5. rewinds the chords newest first while the year counts back, ending with none (the counter at 0.0)", () => {
    const engine = dmEngine(orbits, 1);
    const v = engine.getDrawingMachineView();
    const tl = dmTimeline(v.settings);
    expect(tl.cycle).toBeCloseTo(14.4 + 1.5 + 3, 12);
    expect(engine.getCycleSeconds()).toBeCloseTo(18.9, 12);
    expect(v.chordsPerCycle).toBe(chordsPerCycle(8, 8 / 365.256));
    expect(v.chordsPerCycle).toBe(365);
    const counts: number[] = [];
    const years: number[] = [];
    let peak = 0;
    const events = run(engine, Math.round(18.9 * 60) - 1, STEP, () => {
      peak = Math.max(peak, v.yearShown);
      if (v.phase === "rewind") {
        counts.push(v.chordsVisible);
        years.push(v.yearShown);
      }
    });
    expect(peak).toBe(8);
    expect(v.peakYear).toBe(8);
    expect(counts.length).toBeGreaterThan(150);
    expect(counts[0]).toBeLessThanOrEqual(365);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
      expect(years[i]).toBeLessThanOrEqual(years[i - 1]);
    }
    // the visible chords are always the first n (by year): the ones removed are the newest
    expect(counts[counts.length - 1]).toBeLessThanOrEqual(1);
    expect(events.filter((e) => e.loop === "wash")).toHaveLength(1);
    expect(v.rewinds).toBe(1);
    run(engine, 1);
    expect(v.cycleIndex).toBe(1);
    expect(v.chordsVisible).toBe(0);
    expect(v.yearShown).toBe(0);
    expect(v.lastPeakYear).toBe(8);
    expect(v.rewoundTo).toBe(0);
    // the year shown: one decimal, 8.0 only once year 8 is reached, 0.0 at the end of the rewind
    expect(yearShown(7.99999)).toBe(7.9);
    expect(yearShown(8)).toBe(8);
    expect(yearShown(0.04)).toBe(0);
    expect(orbitsYearAt(tl, 8, 1.8, tl.draw + tl.hold + tl.rewind - 1e-9)).toBeLessThan(1e-6);
    expect(chordsBy(8, 8 / 365.256, 365)).toBe(365);
    expect(chordsBy(0, 8 / 365.256, 365)).toBe(0);
  });

  it("draws every n-th chord past the frame's ceiling (a dense flower stays cheap)", () => {
    expect(dmStride(365, 20_000)).toBe(1);
    expect(dmStride(3_650_000, 20_000)).toBe(183);
    const engine = dmEngine({ machine: "orbits", lineDays: 0.1, years: 1000 }, 1);
    expect(engine.getDrawingMachineView().chordStride).toBe(Math.ceil(engine.getDrawingMachineView().chordsPerCycle / 20_000));
  });

  it("plays the groove bed's chord on every bar line of whole bars a cycle (the seed picks the progression)", () => {
    const engine = dmEngine(orbits, 4);
    const v = engine.getDrawingMachineView();
    expect(v.bars % 4).toBe(0);
    expect(v.bars * v.barSec).toBeCloseTo(18.9, 9);
    const events = run(engine, Math.round(18.9 * 60) + 1);
    expect(events.filter((e) => e.loop === "bed")).toHaveLength(v.bars + 1); // (the next cycle's first chord at the seam)
    expect(events.every((e) => e.melody === false && e.loop !== undefined)).toBe(true);
    // the same seed, the same progression; the pluck and wash levels are fixed
    const again = run(dmEngine(orbits, 4), Math.round(18.9 * 60) + 1).filter((e) => e.loop === "bed").map((e) => e.frequency);
    expect(again).toEqual(events.filter((e) => e.loop === "bed").map((e) => e.frequency));
  });
});

describe("Drawing Machines: sounds", () => {
  it("drives the drone at 30 Hz of simulation time with the energy and the pen speed, and plays on a real ToneGenerator (fakeAudio)", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
    const playLoop = vi.spyOn(tone, "playLoop");
    const engine = dmEngine({}, 3);
    const drones: SoundEvent[] = [];
    let sent = 0;
    for (let k = 0; k < 24 * 60 + 30; k++) {
      engine.update(STEP, 0);
      graph.ctx.currentTime = engine.getElapsedMs() / 1000;
      for (const ev of engine.consumeSoundEvents()) {
        if (ev.loop === "drone") drones.push(ev);
        playSoundEvent(tone, ev, () => undefined);
        sent++;
      }
    }
    expect(playLoop).toHaveBeenCalledTimes(sent);
    // ~30 updates a second, energy falling from 1 while drawing (and back up during the scroll), speed in 0–1
    expect(drones.length).toBeGreaterThan(24 * 30 - 5);
    expect(drones.length).toBeLessThan(24 * 30 + 40);
    expect(drones.every((e) => e.frequency === drones[0].frequency && (e.level ?? -1) >= 0 && (e.level ?? 2) <= 1 + 1e-12 && (e.loopSpeed ?? -1) >= 0 && (e.loopSpeed ?? 2) <= 1)).toBe(true);
    const at = (sec: number) => drones.reduce((best, e, i) => (Math.abs(i / 30 - sec) < Math.abs(best.i / 30 - sec) ? { e, i } : best), { e: drones[0], i: 0 }).e;
    expect(at(20).level!).toBeLessThan(at(2).level!);
    expect(at(20).level!).toBeCloseTo(Math.exp((-2 * 20) / 18), 1);
    expect(drones[drones.length - 1].level!).toBeGreaterThan(0.9); // (the swell back during the scroll: no jump at the seam)
    // the drone's sines at the root and its octaves, a ratchet during the scroll
    expect(graph.oscillators.some((o) => Math.abs(o.frequency - drones[0].frequency!) < 1e-6)).toBe(true);
    expect(playLoop.mock.calls.some((c) => c[0] === "ratchet")).toBe(true);
    // switching the sound off stops the held drone; back on, it is sent again
    engine.setDrawingMachineSettings({ sound: false });
    expect(run(engine, 1).map((e) => e.loop)).toEqual(["droneStop"]);
    expect(run(engine, 60).length).toBe(0);
    engine.setDrawingMachineSettings({ sound: true });
    expect(run(engine, 1).some((e) => e.loop === "drone")).toBe(true);
  });

  it("the pen's scratch follows its speed even when the drone's energy is updated at the same time", () => {
    const graph = fakeGraph();
    const ctx = graph.ctx as unknown as BaseAudioContext;
    const drone = startDrone(ctx, graph.ctx.destination as unknown as AudioNode, 98, 0, new NoiseCache().get(ctx));
    const before = graph.ramps.filter((r) => r.kind === "target").length;
    drone.setEnergy(0.5, 0.1);
    drone.setSpeed(0.8, 0.1);
    const after = graph.ramps.filter((r) => r.kind === "target");
    // the master's target and the scratch's (0.06 × speed) – it used to be swallowed by the master's 30 Hz throttle
    expect(after.length - before).toBe(2);
    expect(after.some((r) => r.time === 0.1 && r.value > 0 && r.value < 0.06)).toBe(true);
    drone.setSpeed(0.2, 0.11); // within 1/30 s: throttled
    expect(graph.ramps.filter((r) => r.kind === "target").length).toBe(before + 2);
    drone.stop(1);
  });

  it("a resumed run sends its held voice again (the drone, or the bed's chord where the run is)", () => {
    const engine = dmEngine({ machine: "orbits" }, 2);
    run(engine, 300);
    engine.refreshDrawingMachineSound();
    const events = run(engine, 1);
    const bed = events.filter((e) => e.loop === "bed");
    expect(bed.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Drawing Machines: settings, links, presets, the page", () => {
  it("round-trips its fields through the link (dm… keys) and keeps values past the sliders (uncapped from the minimum)", () => {
    const s = { ...defaultSettings("drawingMachine"), dmMachine: "orbits" as const, dmFreq: 55.5, dmDetune: 77, dmDamping: 4000, dmAmpR: 300, dmInner: "mars" as const, dmOuter: "neptune" as const, dmRatioP: 2000, dmRatioQ: 3, dmExact: false, dmLineDays: 1000, dmYears: 5000, dmPentagram: false, dmInk: "ember" as const, dmSound: false };
    const back = settingsFromSearchParams(settingsToSearchParams(s));
    for (const key of Object.keys(DEFAULT_DRAWING_MACHINE_FIELDS) as (keyof typeof DEFAULT_DRAWING_MACHINE_FIELDS)[]) expect([key, back[key]]).toEqual([key, s[key]]);
    const params = new URLSearchParams();
    writeDrawingMachineParams({ ...DEFAULT_DRAWING_MACHINE_FIELDS, dmYears: 12 }, DEFAULT_DRAWING_MACHINE_FIELDS, params);
    expect(params.toString()).toBe("dmy=12");
    // invalid values fall back, small values lift to the minimum, whole ratios round
    const fields = { ...DEFAULT_DRAWING_MACHINE_FIELDS };
    readDrawingMachineParams(new URLSearchParams("dmm=spiro&dmf=-5&dmp=7.6&dmbi=pluto&dmi=neon&dmx=2&dms=0"), fields);
    expect(fields).toMatchObject({ dmMachine: "harmonograph", dmFreq: DM_RANGES.dmFreq.min, dmRatioP: 8, dmInner: "venus", dmInk: "auto", dmExact: true, dmSound: false });
    expect(resolveDrawingMachineFields({ dmDetune: 500, dmRotary: 99 })).toMatchObject({ dmDetune: 500, dmRotary: 99 });
    expect(resolveDrawingMachineFields({ dmFreq: Number.NaN, dmYears: "x" as never })).toMatchObject({ dmFreq: 1.5, dmYears: 8 });
    // every numeric key is a dm… key, none taken twice
    expect(new Set(Object.keys(DM_URL_KEYS)).size).toBe(Object.keys(DM_RANGES).length);
    for (const key of Object.keys(DM_URL_KEYS)) expect(key.startsWith("dm")).toBe(true);
    // the engine reads every number (a value past a slider engages the uncapped machinery), not the ink or the sound
    const keys = engineSettingKeys("drawingMachine");
    for (const key of Object.keys(DM_RANGES)) expect(keys).toContain(key);
    expect(keys).not.toContain("dmInk");
    expect(DM_RESTART_FIELDS).toContain("dmMachine");
    expect(DM_RESTART_FIELDS).not.toContain("dmInk");
  });

  it("has the six presets, each a valid whole-cycle clip on its machine's page; the machine switch moves the page", () => {
    expect([...DM_PRESET_IDS]).toEqual(["threePendulums", "lissajous", "decayRose", "earthVenus", "earthMars", "jupiterSaturn"]);
    for (const id of DM_PRESET_IDS) {
      const patch = drawingMachinePresetPatch(id);
      const merged = presetToSettings({ ...defaultSettings("drawingMachine"), ...patch });
      const s = drawingMachineSettingsOf(merged);
      const cycle = dmTimeline(s).cycle;
      expect(patch.recordingDuration).toBeGreaterThanOrEqual(cycle);
      expect(patch.recordingDuration).toBeLessThan(cycle + 1);
      expect(merged.backgroundColors[0]).toBe(patch.dmMachine === "orbits" ? "#05060c" : "#2a1c15");
      expect(patch.loopHud).toBe(true);
      // every preset runs a cycle and a bit without a NaN
      const engine = dmEngine(s, 1);
      run(engine, Math.ceil(Math.min(cycle, 70) * 60) + 2);
      const v = engine.getDrawingMachineView();
      expect(Number.isFinite(v.penX) && Number.isFinite(v.innerX) && Number.isFinite(v.outerY)).toBe(true);
    }
    expect(drawingMachinePresetPatch("earthMars").dmExact).toBe(false);
    expect(drawingMachinePresetPatch("jupiterSaturn")).toMatchObject({ dmRatioP: 5, dmRatioQ: 2, dmInner: "jupiter", dmOuter: "saturn" });
    const js = resolveDrawingMachineSettings(drawingMachineSettingsOf({ ...defaultSettings("drawingMachine"), ...drawingMachinePresetPatch("jupiterSaturn") }));
    const P = orbitPeriods(js);
    expect(conjunctionsPerCycle(js.years, conjunctionPeriod(P.inner, P.outer))).toBe(3);
    // the default page is the harmonograph's dark wood with the loop HUD; the switch moves an untouched page only
    const d = defaultSettings("drawingMachine");
    expect(d.backgroundColors[0]).toBe("#2a1c15");
    expect(d.loopHud).toBe(true);
    expect(drawingMachineSwitchPatch(d, "orbits")).toMatchObject({ dmMachine: "orbits", backgroundColors: ["#05060c", "#05060c"] });
    expect(drawingMachineSwitchPatch({ ...d, backgroundColors: ["#123456", "#123456"] }, "orbits")).toEqual({ dmMachine: "orbits" });
    expect(defaultSettings("classic").loopHud).toBe(false);
  });

  it("joins the rhythm family with a card, a hero moment and its words in en, pl and es", () => {
    expect(MODE_CATEGORIES.drawingMachine).toBe("rhythm");
    expect(MODE_CARD_ORDER.indexOf("drawingMachine")).toBe(MODE_CARD_ORDER.indexOf("beatMachine") + 1);
    expect(HERO_MOMENTS.drawingMachine.query).toContain("dmm=orbits");
    const keys = (o: unknown): string[] => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k])) : []);
    const catalogs = [en, pl, es] as unknown as Record<string, Record<string, unknown>>[];
    const ns = (m: Record<string, Record<string, unknown>>) => keys(m.DrawingMachine).sort();
    expect(ns(catalogs[1])).toEqual(ns(catalogs[0]));
    expect(ns(catalogs[2])).toEqual(ns(catalogs[0]));
    for (const m of catalogs) {
      expect(typeof m.Controls.modeDrawingMachine).toBe("string");
      expect(Object.keys(m.Modes.drawingMachine as object).sort()).toEqual(["description", "name"]);
      for (const key of ["drawingMachineHarmonograph", "drawingMachineHarmonographFact", "drawingMachineEarthVenus", "drawingMachineEarthVenusFact", "drawingMachineOrbits", "drawingMachineOrbitsFact"]) expect(typeof m.LoopCaption[key]).toBe("string");
      const dm = m.DrawingMachine as Record<string, string>;
      expect(dm.canvasTitleOrbits).toContain("[a]");
      expect(dm.canvasTitleOrbits).toContain("[b]");
      expect(dm.canvasYear).toContain("[value]");
    }
    const enDm = (en as unknown as Record<string, Record<string, string>>).DrawingMachine;
    expect(enDm.canvasTitleHarmonograph).toBe("three pendulums, one pen");
    expect(enDm.canvasTitleOrbits).toBe("[a] and [b] draw a flower");
    expect(enDm.canvasYear).toBe("year [value]");
  });

  it("fills the HUD: the orbits' bodies in the title (the Earth first) and \"year 8.0\" with one decimal; the harmonograph has no counter", () => {
    expect(dmTitleBodies("venus", "earth")).toEqual(["earth", "venus"]);
    expect(dmTitleBodies("jupiter", "saturn")).toEqual(["jupiter", "saturn"]);
    const name = (b: string) => (en as unknown as Record<string, Record<string, string>>).DrawingMachine[`body${b[0].toUpperCase()}${b.slice(1)}`];
    expect(dmOrbitsTitle("[a] and [b] draw a flower", "venus", "earth", name)).toBe("Earth and Venus draw a flower");
    const template = dmYearTemplate("year [value]");
    expect(template).toBe("year {value}");
    expect(hudCounterText(template, 8, undefined, { value: 8 }, 1)).toBe("year 8.0");
    expect(hudCounterText(dmYearTemplate("rok [value]"), 7.4, "pl", { value: 7.4 }, 1)).toBe("rok 7,4");
    // the engine's counter through the loop HUD
    const engine = dmEngine({ machine: "orbits" }, 1);
    run(engine, Math.round(14.4 * 60) + 2);
    const count = loopHudCount(engine);
    expect(count).toMatchObject({ count: 8, values: { value: 8 }, decimals: 1 });
    const frame = loopHudFrame({ title: "earth and venus draw a flower", subtitle: "", counter: template, light: false }, count);
    expect(frame.counter).toBe("year 8.0");
    expect(loopHudCount(dmEngine({}, 1))).toBeNull();
    expect(loopHudFrame({ title: "Three pendulums, one pen", subtitle: "a / b", counter: "", light: false, serif: true }, null)).toMatchObject({ title: "three pendulums, one pen", serif: true });
  });

  it("writes the loop-style captions: the pendulums, Earth and Venus's 8 years, any other pair's years", () => {
    expect(loopCaptionContext({ ...defaultSettings("drawingMachine"), recordingDuration: 24 } as never)).toMatchObject({ hookKey: "drawingMachineHarmonograph", count: 3 });
    expect(loopCaptionContext({ ...defaultSettings("drawingMachine"), dmAmpR: 0, recordingDuration: 24 } as never)).toMatchObject({ count: 2 });
    expect(loopCaptionContext({ ...defaultSettings("drawingMachine"), dmMachine: "orbits", recordingDuration: 19 } as never)).toMatchObject({ hookKey: "drawingMachineEarthVenus", factKey: "drawingMachineEarthVenusFact", count: 8 });
    expect(loopCaptionContext({ ...defaultSettings("drawingMachine"), dmMachine: "orbits", dmInner: "jupiter", dmOuter: "saturn", dmYears: 59.6, recordingDuration: 19 } as never)).toMatchObject({ hookKey: "drawingMachineOrbits", count: 59.6 });
  });
});

describe("Drawing Machines: the renderer", () => {
  /** A layer whose offscreen canvases are fakes (kept in `made`). */
  function fakeLayer() {
    const made: FakeCanvas[] = [];
    const layer = new DrawingMachineLayer((w, h) => {
      const c = fakeCanvas(w, h);
      made.push(c);
      return c as unknown as HTMLCanvasElement;
    });
    return { layer, made };
  }
  const opts = { dpr: 2, showGlow: true };

  it("strokes only the new trace segments into its layer, starts over with a new sheet, and draws the paper, rollers, rod and pen", () => {
    const engine = dmEngine({}, 1);
    const v = engine.getDrawingMachineView();
    const { layer, made } = fakeLayer();
    const frame = fakeCanvas(800, 600);
    const ctx = frame.ctx as unknown as CanvasRenderingContext2D;
    let strokedPoints = 0;
    for (let f = 0; f < 120; f++) {
      run(engine, 1);
      layer.drawStage(ctx, v, opts);
      layer.drawBodies(ctx, v, opts);
      strokedPoints += layer.segmentsLastFrame;
    }
    expect(made).toHaveLength(1);
    expect(made[0].width).toBe(Math.ceil(v.paperW * 2));
    // every point after the first was stroked exactly once (a segment each)
    expect(strokedPoints).toBe(v.trace.total - 1);
    expect(layer.pointsOnLayer).toBe(v.trace.total);
    expect(frame.ctx.calls.filter((c) => c.name === "drawImage" && c.args[0] === made[0]).length).toBe(120);
    // the frame: the paper (cream), the brass rod, the ink dot
    expect(frame.ctx.calls.some((c) => c.name === "fillRect")).toBe(true);
    expect(frame.ctx.calls.filter((c) => c.name === "arc").length).toBeGreaterThan(4 * 120);
    // a new sheet clears the layer
    const redraws = layer.redraws;
    run(engine, 24 * 60);
    layer.drawStage(ctx, v, opts);
    expect(v.cycleIndex).toBe(1);
    expect(layer.redraws).toBe(redraws + 1);
    expect(made[0].ctx.calls.some((c) => c.name === "clearRect")).toBe(true);
    expect(drawingMachineExtentPx(v)).toBeGreaterThan(v.paperH / 2);
  });

  it("replays the visible chords on the rewind (the newest gone first) and draws the marks and the pentagram", () => {
    const engine = dmEngine({ machine: "orbits" }, 1);
    const v = engine.getDrawingMachineView();
    const { layer } = fakeLayer();
    const frame = fakeCanvas(800, 600);
    const ctx = frame.ctx as unknown as CanvasRenderingContext2D;
    let rewindFrames = 0;
    let replays = 0;
    for (let f = 0; f < Math.round(18.9 * 60) - 2; f++) {
      run(engine, 1);
      const before = layer.redraws;
      layer.drawStage(ctx, v, opts);
      layer.drawBodies(ctx, v, opts);
      expect(layer.chordsOnLayer).toBe(v.chordsVisible);
      if (v.phase === "rewind") {
        rewindFrames++;
        if (layer.redraws > before) replays++;
      }
    }
    expect(rewindFrames).toBeGreaterThan(100);
    expect(replays).toBeGreaterThan(50);
    expect(layer.marksDrawn).toBe(v.marksVisible);
    const data: Record<string, string> = {};
    writeDrawingMachineDataset(v, layer, (k, val) => (data[k] = val));
    expect(Object.keys(data).sort()).toEqual([...DRAWING_MACHINE_DATA_KEYS].sort());
    expect(data.dmMachine).toBe("orbits");
    expect(data.dmNan).toBe("0");
    expect(data.dmLastPeakYear).toBe("-1.0");
    // without a DOM the layer draws straight onto the frame
    const direct = new DrawingMachineLayer(() => null);
    direct.drawStage(ctx, v, opts);
    expect(direct.chordsOnLayer).toBe(v.chordsVisible);
  });

  it("makes its ramp palette once (64 rgba steps from the first stop to the last)", () => {
    const p = rampPalette(["#5b55c9", "#c93a5c"], 0.7);
    expect(p).toHaveLength(64);
    expect(p[0]).toBe("rgba(91, 85, 201, 0.7)");
    expect(p[63]).toBe("rgba(201, 58, 92, 0.7)");
    expect(rampStep(0)).toBe(0);
    expect(rampStep(1)).toBe(63);
    expect(rampStep(Number.NaN)).toBe(0);
  });
});
