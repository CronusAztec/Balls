import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { fakeCanvas } from "./fakeCanvas";
import {
  CHAOS_FAN_PRESETS,
  CHAOS_FAN_RANGES,
  CHAOS_FAN_SOUND_KINDS,
  DEFAULT_CHAOS_FAN_SETTINGS,
  DP_FAN_URL_KEYS,
  FAN_CHORD_HZ,
  FAN_MIN_SUBSTEPS,
  FAN_MAX_SWINGS_PER_STEP,
  FAN_REF_PX_PER_UNIT,
  FAN_STEP_BUDGET,
  FAN_SWING_BASE_DEGREE,
  FAN_TAIL_SEC,
  FanBatch,
  FanTape,
  chaosFanClipSec,
  chaosFanCycleSec,
  chaosFanPresetFields,
  fanAccel,
  fanEnergy,
  fanForwardSteps,
  fanHue,
  fanOffset,
  fanSubsteps,
  fanSwingDegree,
  fanSwingFrequency,
  fanSwingLevel,
  fanTapePlan,
  type FanParams,
} from "@/lib/physics/chaosFan";
import { DEFAULT_DOUBLE_PENDULUM_SETTINGS, DOUBLE_PENDULUM_RANGES, chaosFanBobPx, chaosFanField, doublePendulumSettingsOf, resolveDoublePendulumSettings, type DoublePendulumSettings } from "@/lib/physics/modes/doublePendulum";
import { CHAOS_FAN_DATA_KEYS, bucketFan, drawChaosFan, fanLineAlpha, hslRgb, writeChaosFanData } from "@/components/simulator/chaosFanRenderer";
import { CHAOS_FAN_KEYS, SPREAD_PICKS, formatSpreadDeg } from "@/components/simulator/sections/ChaosFanSection";
import { DOUBLE_PENDULUM_KEYS } from "@/components/simulator/sections/DoublePendulumSection";
import { MODE_BLOCK_KEYS } from "@/components/simulator/panelKeys";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { MEMORY_CEILINGS, ENTITY_CEILING } from "@/lib/uncap";
import { RANGES, defaultSettings, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, fixedRunDurationSec, runNeverFinishes, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, fanOutcomeSettled, outcomeFigure, outcomeHorizonMs, outcomeMatches, outcomeMiss, type FinderOutcome, type RunSummary } from "@/lib/simulation/outcomes";
import { LOOP_HUD_AMBER, LOOP_HUD_GREY, drawLoopHud, loopHudCount, loopHudFrame, loopHudLayout } from "@/lib/loop/hud";
import { inLoopScale, LOOP_ROOTS } from "@/lib/audio/loopPitch";
import { frequencyToMidi } from "@/lib/audio/scales";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { loopCaption, loopCaptionContext } from "@/lib/publish/loopCaption";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- chaos-fan --- The Double Pendulum's chaos fan (lib/physics/chaosFan.ts, the fan path of modes/doublePendulum.ts,
 * components/simulator/chaosFanRenderer.ts): the batch integrator (energy, determinism, identical pendulums at a spread of 0,
 * the step budget), the start spread and the split (sooner the bigger the spread), the palindrome (the tape, the seam that
 * restores the exact start, a second cycle replaying the first, its last frame flowing into its first), the sounds and their
 * scheduling on the fake Web Audio graph, the loop contract and the grey state label of the HUD, Find Simulation's "splits
 * at", the settings (URL, presets, uncapped numbers, the memory ceiling), the renderer, the caption and the translations.
 */

afterEach(() => vi.unstubAllGlobals());

const STEP = 1000 / 60;
const config: PhysicsConfig = { width: 800, height: 800, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };

/** The 200-pendulum preset's Double Pendulum settings with `patch` on top. */
function fanSettings(patch: Partial<DoublePendulumSettings> = {}): Partial<DoublePendulumSettings> {
  const s = { ...defaultSettings("doublePendulum"), ...chaosFanPresetFields("hairApart"), dpLength1: 1, dpLength2: 1, dpMass1: 1, dpMass2: 1, dpGravity: 1, dpDamping: 0, dpRandomStart: true };
  return { ...doublePendulumSettingsOf(s), ...patch };
}

function engineOf(patch: Partial<DoublePendulumSettings> = {}, seed = 12345, size: Partial<PhysicsConfig> = {}): PhysicsEngine {
  return createEngineForSettings({ ...config, ...size }, "doublePendulum", { ...base, doublePendulum: fanSettings(patch) }, seed);
}

interface TimedEvent {
  t: number;
  ev: SoundEvent;
}

/** Runs `engine` for `seconds` in frames of `frameMs`, returning every sound event with the simulation time it came at (s). */
function run(engine: PhysicsEngine, seconds: number, frameMs = STEP, each?: (t: number) => void): TimedEvent[] {
  const out: TimedEvent[] = [];
  const frames = Math.round((seconds * 1000) / frameMs);
  for (let i = 0; i < frames; i++) {
    engine.update(frameMs, 0);
    const t = engine.getElapsedMs() / 1000;
    for (const ev of engine.consumeSoundEvents()) out.push({ t, ev });
    each?.(t);
  }
  return out;
}

const ofKind = (events: TimedEvent[], kind: string) => events.filter((e) => e.ev.loop === kind);
const fanOf = (engine: PhysicsEngine) => engine.getDoublePendulumView().fan!;

const P: FanParams = { l1: 0.5, l2: 0.5, m1: 1, m2: 1, g: 9.81, k: 0 };

/* ------------------------------------------------------------------ the batch integrator */

describe("Chaos fan: the batch integrator", () => {
  it("matches the textbook small-angle normal modes (ω² = (2 ± √2) g / l for equal rods and bobs)", () => {
    // In the slow mode the lower bob swings √2 times as far as the upper one, in phase; a small start in that shape keeps it.
    const l = 0.5;
    const omega = Math.sqrt(((2 - Math.SQRT2) * 9.81) / l);
    const batch = new FanBatch(1, { ...P, l1: l, l2: l });
    batch.th1[0] = 0.001;
    batch.th2[0] = 0.001 * Math.SQRT2;
    const period = (2 * Math.PI) / omega;
    const steps = Math.round(period * 60);
    for (let i = 0; i < steps; i++) batch.step(1 / 60);
    // back where it started after one period (within the rounding of the step count)
    const phase = (2 * Math.PI * (steps / 60 - period)) / period;
    expect(batch.th1[0]).toBeCloseTo(0.001 * Math.cos(phase), 6);
    expect(batch.th2[0] / batch.th1[0]).toBeCloseTo(Math.SQRT2, 3);
  });

  it("keeps the energy of a frictionless chaotic swing (a drift under 1e-6 of m·g·l over 30 s)", () => {
    const batch = new FanBatch(3, P);
    const starts = [
      [2.5, -1],
      [Math.PI - 0.1, 0.3],
      [1.2, 2.9],
    ];
    starts.forEach(([a, b], i) => {
      batch.th1[i] = a;
      batch.th2[i] = b;
    });
    const e0 = starts.map(([a, b]) => fanEnergy(P, a, b, 0, 0));
    for (let i = 0; i < 30 * 60; i++) batch.step(1 / 60);
    for (let i = 0; i < 3; i++) expect(Math.abs(fanEnergy(P, batch.th1[i], batch.th2[i], batch.w1[i], batch.w2[i]) - e0[i]) / (2 * 9.81)).toBeLessThan(1e-6);
  });

  it("loses energy with friction, never gains it", () => {
    const batch = new FanBatch(1, { ...P, k: 0.5 });
    batch.th1[0] = 2;
    batch.th2[0] = 1;
    let last = batch.energy();
    for (let i = 0; i < 600; i++) {
      batch.step(1 / 60);
      const e = batch.energy();
      expect(e).toBeLessThanOrEqual(last + 1e-12);
      last = e;
    }
  });

  it("computes the closed-form accelerations of the Lagrangian (against finite differences of the energy's equations)", () => {
    // At rest the accelerations are the gravity terms alone: the lower rod horizontal, the upper one hanging
    const out = new Float64Array(2);
    fanAccel(P, 0, Math.PI / 2, 0, 0, out);
    // δ = −π/2: D = 2(m1 + m2) = 4; θ1″ = (−m2 g sin(−π)) / (l1 D) − … = 0 + 0, θ2″ = 2 sin δ (g (m1+m2) cos 0) / (l2 D)
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo((2 * -1 * (9.81 * 2)) / (0.5 * 4), 12);
  });

  it("plans its sub-steps from the fastest rod and never spends more than the step budget", () => {
    expect(fanSubsteps(0, 1 / 60, 200)).toBe(FAN_MIN_SUBSTEPS);
    expect(fanSubsteps(60, 1 / 60, 200)).toBe(Math.ceil(1 / 0.02));
    for (const count of [1, 200, 500, 1000, 5000]) for (const omega of [0, 10, 100, 1e6, Infinity]) expect(4 * count * fanSubsteps(omega, 1 / 60, count) <= Math.max(FAN_STEP_BUDGET, 4 * count * FAN_MIN_SUBSTEPS)).toBe(true);
    // the memory-safety ceiling is what the budget holds at the fewest sub-steps
    expect(MEMORY_CEILINGS.dpFanCount).toBe(ENTITY_CEILING);
    expect(FAN_STEP_BUDGET / (4 * FAN_MIN_SUBSTEPS)).toBe(ENTITY_CEILING);
  });

  it("puts a pendulum whose numbers overflow back where it was, at rest", () => {
    const batch = new FanBatch(1, { ...P, g: 1e308 });
    batch.th1[0] = 1;
    batch.th2[0] = 2;
    batch.step(1 / 60);
    expect([batch.th1[0], batch.th2[0], batch.w1[0], batch.w2[0]]).toEqual([1, 2, 0, 0]);
  });
});

/* ------------------------------------------------------------------ the fan */

describe("Chaos fan: the spread and the split", () => {
  it("spreads the start over the last rod: pendulum i of n starts i/(n − 1) of the total further", () => {
    expect(fanOffset(0, 200, 1)).toBe(0);
    expect(fanOffset(199, 200, 1)).toBe(1);
    expect(fanOffset(0, 1, 1)).toBe(0);
    const engine = engineOf({ fanCount: 5, spreadDeg: 0.004 });
    const start = engine.doublePendulumMode.getFanRun().startAngles();
    for (let i = 1; i < 5; i++) {
      expect(start[2 * i]).toBe(start[0]);
      expect(start[2 * i + 1] - start[1]).toBeCloseTo((0.001 * i * Math.PI) / 180, 15);
    }
  });

  it("with a spread of 0 every pendulum stays identical – to the last bit – through the forward run and back", () => {
    const engine = engineOf({ fanCount: 50, spreadDeg: 0, forwardSec: 6 });
    const fan = fanOf(engine);
    run(engine, 13, STEP, () => {
      for (let i = 1; i < fan.count; i++) {
        if (fan.x2[i] !== fan.x2[0] || fan.y2[i] !== fan.y2[0] || fan.x1[i] !== fan.x1[0]) throw new Error(`pendulum ${i} left the leader`);
      }
    });
    expect(fan.spreadPx).toBe(0);
    expect(fan.splits).toBe(0);
  });

  it("splits later the smaller the spread (the differences double at a steady rate)", () => {
    const splitAt = (spreadDeg: number) => {
      const engine = engineOf({ fanCount: 2, spreadDeg, palindrome: false }, 4242);
      const fan = fanOf(engine);
      let at = -1;
      run(engine, 40, STEP, (t) => {
        if (at < 0 && fan.splitSec >= 0) at = t;
      });
      return at;
    };
    const times = [1e-1, 1e-3, 1e-5, 1e-7].map(splitAt);
    for (const t of times) expect(t).toBeGreaterThan(0);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it("is deterministic for its seed and replays the same run at 30, 60 and 120 fps (the fingerprint)", () => {
    const fingerprint = (frameMs: number, seed = 12345) => {
      const engine = engineOf({ forwardSec: 8 }, seed);
      const events = run(engine, 10, frameMs);
      const fan = fanOf(engine);
      let sum = 0;
      for (let i = 0; i < fan.count; i++) sum += fan.x2[i] * (i + 1) + fan.y2[i];
      return { sum, split: fan.splitSec, swings: fan.swings, events: events.length, step: fan.cycleStep };
    };
    const f60 = fingerprint(STEP);
    expect(fingerprint(1000 / 30)).toEqual(f60);
    expect(fingerprint(1000 / 120)).toEqual(f60);
    expect(fingerprint(STEP)).toEqual(f60);
    expect(fingerprint(STEP, 777).sum).not.toBe(f60.sum);
    // pinned: the 200-pendulum preset, seed 12345, 10 s with an 8 s forward run (a change of the physics shows here)
    expect(f60.step).toBe(600);
    expect(f60.split).toBeCloseTo(6.35, 9);
    expect([f60.swings, f60.events]).toEqual([97, 100]);
    expect(f60.sum).toBeCloseTo(-14948.594659904824, 6);
  });

  it("keeps a 500-pendulum step under the runtime step budget (and 5,000 at it)", () => {
    for (const count of [500, 5000]) {
      const engine = engineOf({ fanCount: count, forwardSec: 2 });
      run(engine, 1);
      const fan = fanOf(engine);
      expect(fan.count).toBe(count);
      expect(fan.evals).toBeGreaterThan(0);
      expect(fan.evals).toBeLessThanOrEqual(FAN_STEP_BUDGET);
    }
  });

  it("builds at most the memory-safety ceiling of pendulums (the link keeps the typed count, the canvas says ARENA FULL)", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=doublePendulum&dpf=1&dpfn=1000000"));
    expect(s.dpFanCount).toBe(1_000_000);
    expect(pastAnyMemoryCeiling(s)).toBe(true);
    const engine = createEngineForSettings(physicsConfigOfSettings(s), "doublePendulum", modeSettingsOfSettings(s), 3);
    expect(fanOf(engine).count).toBe(ENTITY_CEILING);
  });
});

/* ------------------------------------------------------------------ the palindrome */

describe("Chaos fan: the palindrome", () => {
  it("records the forward run and plays it backwards; the seam restores the exact start, so the last frame flows into the first", () => {
    const engine = engineOf({ fanCount: 40, forwardSec: 5 });
    const fan = fanOf(engine);
    const F = fanForwardSteps(5);
    const at = (k: number) => Array.from(fan.x2).concat(Array.from(fan.y2)).map((v) => v + 0 * k);
    const start = at(0);
    const forward: number[][] = [start];
    for (let k = 1; k <= F; k++) {
      engine.update(STEP, 0);
      forward.push(at(k));
      expect(fan.running).toBe(k < F ? "forwards" : "backwards");
    }
    // backwards: step F + j shows the forward run's step F − j (Float32 tape: within float error)
    for (let j = 1; j < F; j++) {
      engine.update(STEP, 0);
      expect(fan.running).toBe("backwards");
      const now = at(F + j);
      const want = forward[F - j];
      for (let i = 0; i < now.length; i += 7) expect(Math.abs(now[i] - want[i])).toBeLessThan(1e-6);
    }
    // the last frame before the seam is the forward run's first step, within float error …
    const last = at(2 * F - 1);
    for (let i = 0; i < last.length; i++) expect(Math.abs(last[i] - forward[1][i])).toBeLessThan(1e-6);
    // … and the seam is the start itself, bit for bit
    engine.update(STEP, 0);
    expect(at(2 * F)).toEqual(start);
    expect([fan.cycles, fan.cycleStep, fan.running]).toEqual([1, 0, "forwards"]);
    expect(engine.getCycleSeconds()).toBeCloseTo(chaosFanCycleSec(5), 12);
    const seams = engine.getLoopSeams();
    expect(seams?.count).toBe(1);
    expect(seams?.lastMs).toBeCloseTo((2 * F * 1000) / 60, 6);
    expect(seams?.nextMs).toBeCloseTo((4 * F * 1000) / 60, 6);
  });

  it("replays the first cycle exactly in the second (the picture and every sound on the same step)", () => {
    const engine = engineOf({ forwardSec: 6 });
    const cycle = chaosFanCycleSec(6);
    const events = run(engine, 2 * cycle + 0.05);
    const key = (e: TimedEvent, offset: number) => `${e.ev.loop}:${e.ev.frequency?.toFixed(6)}:${e.ev.level?.toFixed(6)}:${Math.round((e.t - offset) * 60)}`;
    const first = events.filter((e) => e.t < cycle - 1e-9).map((e) => key(e, 0));
    const second = events.filter((e) => e.t >= cycle - 1e-9 && e.t < 2 * cycle - 1e-9).map((e) => key(e, cycle));
    expect(first.length).toBeGreaterThan(10);
    expect(second).toEqual(first);
    expect(fanOf(engine).cycles).toBe(2);
    expect(engine.isSimulationFinished()).toBe(false);
  });

  it("keeps the tape inside its memory budget: past it, every k-th step, interpolated between", () => {
    expect(fanTapePlan(200, 600)).toEqual({ stride: 1, frames: 601 });
    const big = fanTapePlan(5000, 1800);
    expect(big.stride).toBeGreaterThan(1);
    expect(big.frames * 2 * 5000).toBeLessThanOrEqual(8_000_000 + 2 * 5000 * big.stride);
    // stride 3: the steps between two frames are interpolated, the last step is always a frame
    const tape = new FanTape(1, 10, 2 * 4 + 1);
    expect(tape.stride).toBeGreaterThan(1);
    const th1 = new Float64Array(1);
    const th2 = new Float64Array(1);
    for (let k = 0; k <= 10; k++) {
      th1[0] = k;
      th2[0] = -k;
      tape.write(k, th1, th2);
    }
    for (let k = 0; k <= 10; k++) {
      tape.read(k, th1, th2);
      expect(th1[0]).toBeCloseTo(k, 5);
      expect(th2[0]).toBeCloseTo(-k, 5);
    }
  });

  it("without the palindrome runs forwards to the clip's end with the finale, and reports no cycle", () => {
    const engine = engineOf({ palindrome: false, clipSeconds: 6 });
    run(engine, 6.1);
    expect(engine.getCycleSeconds()).toBeNull();
    expect(engine.getLoopSeams()).toBeNull();
    expect(engine.isSimulationFinished()).toBe(true);
    expect(engine.getDoublePendulumProgress().finale).toBe(true);
  });

  it("leaves the harp rig as it was: no fan, no cycle, no seams by default", () => {
    const engine = createEngineForSettings(config, "doublePendulum", { ...base, doublePendulum: doublePendulumSettingsOf(defaultSettings("doublePendulum")) }, 5);
    expect(engine.getDoublePendulumView().fan).toBeNull();
    expect(engine.getDoublePendulumView().pendulums).toHaveLength(1);
    expect(engine.getCycleSeconds()).toBeNull();
    expect(engine.getLoopSeams()).toBeNull();
    // and a fan run switched back to the harp clears the fan
    const fanEngine = engineOf();
    fanEngine.setDoublePendulumSettings({ fan: false });
    fanEngine.initDoublePendulum();
    expect(fanEngine.getDoublePendulumView().fan).toBeNull();
    expect(fanEngine.getDoublePendulumView().strings.length).toBe(DEFAULT_DOUBLE_PENDULUM_SETTINGS.strings);
  });
});

/* ------------------------------------------------------------------ the sounds */

describe("Chaos fan: the sounds", () => {
  it("plays one voice while together, a widening cloud once split, the cues in order and the glide onto the seam", () => {
    const engine = engineOf({ forwardSec: 10 });
    const fan = fanOf(engine);
    const cycle = chaosFanCycleSec(10);
    const events = run(engine, cycle);
    for (const e of events) expect(CHAOS_FAN_SOUND_KINDS).toContain(e.ev.loop);
    for (const e of events) expect(e.ev.melody).toBe(false);
    const [ding] = ofKind(events, "ding");
    const [wash] = ofKind(events, "wash");
    const [chord] = ofKind(events, "chord");
    const [glide] = ofKind(events, "glide");
    expect([ofKind(events, "ding").length, ofKind(events, "wash").length, ofKind(events, "chord").length, ofKind(events, "glide").length]).toEqual([1, 1, 1, 1]);
    // the split on the way out, the reversal at the turn, home on the way back (its mirror), the glide last
    expect(ding.t).toBeGreaterThan(1);
    expect(ding.t).toBeLessThan(10);
    expect(wash.t).toBeCloseTo(10, 6);
    expect(chord.t).toBeGreaterThan(10);
    expect(chord.t + ding.t).toBeCloseTo(cycle, 1);
    expect(chord.ev.frequency).toBeCloseTo(FAN_CHORD_HZ, 9);
    expect(glide.t + glide.ev.loopSec!).toBeCloseTo(cycle, 9);
    expect(glide.ev.loopTo).toBeCloseTo(fanSwingFrequency(FAN_SWING_BASE_DEGREE) / 2, 9);
    // before the split every swing is the single voice (A3); after it, more than one pitch
    const plucks = ofKind(events, "pluck");
    const single = fanSwingFrequency(FAN_SWING_BASE_DEGREE);
    const before = plucks.filter((p) => p.t < ding.t - 1);
    expect(before.length).toBeGreaterThan(0);
    for (const p of before) expect(p.ev.frequency).toBeCloseTo(single, 9);
    const cloud = new Set(plucks.filter((p) => p.t > ding.t && p.t < wash.t).map((p) => p.ev.frequency!.toFixed(3)));
    expect(cloud.size).toBeGreaterThan(3);
    // every pluck in the A major pentatonic, in the C3–C6 register; at most six a step; none in the tail before the seam
    for (const p of plucks) {
      const midi = frequencyToMidi(p.ev.frequency!);
      expect(inLoopScale(midi, LOOP_ROOTS.A)).toBe(true);
      expect(p.ev.frequency!).toBeGreaterThanOrEqual(130.8);
      expect(p.ev.frequency!).toBeLessThanOrEqual(1046.5);
      expect(p.ev.level!).toBeLessThanOrEqual(1);
      expect(p.t).toBeLessThanOrEqual(cycle - FAN_TAIL_SEC + 1e-9);
    }
    const perStep = new Map<string, number>();
    for (const p of plucks) perStep.set(p.t.toFixed(6), (perStep.get(p.t.toFixed(6)) ?? 0) + 1);
    expect(Math.max(...perStep.values())).toBeLessThanOrEqual(FAN_MAX_SWINGS_PER_STEP);
    expect(fan.swings).toBe(plucks.length);
    expect([fan.splits, fan.reverses, fan.homes]).toEqual([1, 1, 1]);
  });

  it("maps the deviation from the leader to the degree (one voice under a quarter of the split, up nine degrees at 400 px)", () => {
    expect(fanSwingDegree(0, 30)).toBe(FAN_SWING_BASE_DEGREE);
    expect(fanSwingDegree(7, 30)).toBe(FAN_SWING_BASE_DEGREE);
    expect(fanSwingDegree(400, 30)).toBe(FAN_SWING_BASE_DEGREE + 9);
    expect(fanSwingDegree(1000, 30)).toBe(FAN_SWING_BASE_DEGREE + 9);
    let last = -1;
    for (let px = 8; px < 500; px *= 1.3) {
      const d = fanSwingDegree(px, 30);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    expect(fanSwingLevel(0, 1)).toBeCloseTo(0.8, 12);
    expect(fanSwingLevel(100, 1)).toBeCloseTo(1, 12);
    expect(fanSwingLevel(100, 4)).toBeCloseTo(0.5, 12);
  });

  it("schedules them on the context's clock through ToneGenerator.playLoop (the fake Web Audio graph)", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    const cycle = chaosFanCycleSec(10);
    const events = run(engineOf({ forwardSec: 10 }), cycle);
    let last = -1;
    for (const { t, ev } of events) {
      if (t !== last) {
        graph.ctx.currentTime = t;
        last = t;
      }
      playSoundEvent(tone, ev, () => undefined);
    }
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const [ding] = ofKind(events, "ding");
    expect(graph.oscillators.some((o) => near(o.startAt, ding.t) && Math.abs(o.frequency - ding.ev.frequency!) < 1e-6)).toBe(true);
    const [chord] = ofKind(events, "chord");
    expect(graph.oscillators.some((o) => near(o.startAt, chord.t) && Math.abs(o.frequency - FAN_CHORD_HZ) < 0.01)).toBe(true);
    const [first] = ofKind(events, "pluck");
    expect(graph.oscillators.some((o) => near(o.startAt, first.t) && Math.abs(o.frequency - first.ev.frequency!) < 1e-6)).toBe(true);
    const [glide] = ofKind(events, "glide");
    const ramp = graph.ramps.find((r) => r.kind === "exp" && r.param === "frequency" && Math.abs(r.value - glide.ev.loopTo!) < 1e-6);
    expect(ramp?.time).toBeCloseTo(cycle, 9);
  });

  it("reports the leader's swing through the bottom as bounce math's bounce", () => {
    const engine = engineOf();
    const bounces: number[] = [];
    const ctx = engine.ctx as unknown as { noteBounce?: (b: unknown) => void };
    const original = ctx.noteBounce;
    ctx.noteBounce = (ball) => {
      bounces.push(1);
      original?.(ball);
    };
    run(engine, 4);
    expect(bounces.length).toBeGreaterThan(1);
  });
});

/* ------------------------------------------------------------------ the HUD, the finder */

describe("Chaos fan: the HUD and Find Simulation", () => {
  it("shows a grey state label – running forwards, then backwards – instead of the amber counter", () => {
    const engine = engineOf({ forwardSec: 2 });
    const spec = { title: "200 pendulums, a hair apart", subtitle: "tiny differences keep doubling / until no two swing alike", counter: "", states: { forwards: "running forwards", backwards: "running backwards" }, light: false };
    expect(loopHudCount(engine)).toEqual({ state: "forwards" });
    expect(loopHudFrame(spec, loopHudCount(engine))).toMatchObject({ counter: "running forwards", counterGrey: true });
    run(engine, 2.5);
    expect(loopHudFrame(spec, loopHudCount(engine)).counter).toBe("running backwards");
    const canvas = fakeCanvas(1080, 1920);
    drawLoopHud(canvas.ctx as unknown as CanvasRenderingContext2D, 1080, loopHudFrame(spec, loopHudCount(engine)), loopHudLayout(1080, 1920));
    const fills = canvas.ctx.calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    expect(fills).toContain("running backwards");
    expect(canvas.ctx.fillStyle).toBe(LOOP_HUD_GREY);
    expect(LOOP_HUD_GREY).not.toBe(LOOP_HUD_AMBER);
    // the harp rig has no state (its HUD counter is the classic null)
    const harp = createEngineForSettings(config, "doublePendulum", { ...base, doublePendulum: {} }, 5);
    expect(loopHudCount(harp)).toBeNull();
  });

  it("offers Splits at with the fan (a looping fan has no length to find) and judges the window", () => {
    const loops = fanSettings();
    expect(runNeverFinishes("doublePendulum", { doublePendulum: loops } as ModeSettings)).toBe(true);
    expect(fixedRunDurationSec("doublePendulum", { doublePendulum: loops } as ModeSettings)).toBeNull();
    expect(fixedRunDurationSec("doublePendulum", { doublePendulum: { ...loops, palindrome: false, clipSeconds: 20 } } as ModeSettings)).toBe(20);
    expect(availableOutcomes("doublePendulum", { endless: true, neverEscape: false, ballCount: 1, dpFan: true })).toEqual(["diverges-at"]);
    expect(availableOutcomes("doublePendulum", { endless: false, neverEscape: false, ballCount: 1, dpFan: true })).toEqual(["duration", "diverges-at"]);
    expect(availableOutcomes("doublePendulum", { endless: false, neverEscape: false, ballCount: 1 })).toEqual(["duration"]);
    const outcome: FinderOutcome = { kind: "diverges-at", clipSec: 20, atSec: 6 };
    const at = (ms: number): RunSummary => ({ durationMs: ms, finished: false, firstEscapeMs: -1, teams: [], divergeMs: ms });
    expect(outcomeMatches(outcome, at(6400))).toBe(true);
    expect(outcomeMatches(outcome, at(5600))).toBe(true);
    expect(outcomeMatches(outcome, at(6600))).toBe(false);
    expect(outcomeMatches(outcome, { ...at(9000), divergeMs: -1 })).toBe(false);
    expect(outcomeMiss(outcome, at(7000))).toBeCloseTo(1, 9);
    expect(outcomeMiss(outcome, { ...at(9000), divergeMs: -1 })).toBe(Infinity);
    expect(outcomeFigure(outcome, at(6400))).toBeCloseTo(6.4, 9);
    expect(outcomeHorizonMs(outcome, 60_000)).toBeCloseTo(6500 + 1000 / 60, 6);
    expect(fanOutcomeSettled(outcome, 3000, -1)).toBe(false);
    expect(fanOutcomeSettled(outcome, 3000, 2000)).toBe(true);
    expect(fanOutcomeSettled(outcome, 6600, -1)).toBe(true);
  });

  it("finds the split of a seed headlessly, and the seeds split at different seconds", () => {
    const request = (atSec: number): FinderRequest => ({ physicsConfig: config, mode: "doublePendulum", modeSettings: { ...base, doublePendulum: fanSettings({ fanCount: 20 }) }, targetDurationSec: 20, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 60, outcome: { kind: "diverges-at", clipSec: 20, atSec } });
    const splits = [1, 2, 3, 4, 5].map((seed) => simulateOutcomeRun(seed, request(30), request(30).outcome!).divergeMs ?? -1);
    for (const s of splits) expect(s).toBeGreaterThan(0);
    expect(new Set(splits.map((s) => Math.round(s))).size).toBeGreaterThan(1);
    // a target on a seed's own split matches it
    const target = splits[2] / 1000;
    const hit = simulateOutcomeRun(3, request(target), request(target).outcome!);
    expect(outcomeMatches(request(target).outcome!, hit)).toBe(true);
  });
});

/* ------------------------------------------------------------------ settings, presets, URL */

describe("Chaos fan: settings, presets and links", () => {
  it("are off by default in every mode, with comfort ranges and an exact URL round trip (a millionth of a degree included)", () => {
    for (const key of Object.keys(CHAOS_FAN_RANGES) as (keyof typeof CHAOS_FAN_RANGES)[]) {
      expect(RANGES[key]).toBe(DOUBLE_PENDULUM_RANGES[key]);
      expect(RANGES[key]).toEqual(CHAOS_FAN_RANGES[key]);
    }
    for (const mode of ["classic", "doublePendulum", "hoops"] as const) expect(defaultSettings(mode)).toMatchObject({ dpFan: false, dpFanCount: 200, dpSpreadDeg: 0.001, dpColourBy: "index", dpPalindrome: true, dpForwardSec: 10, dpDivergePx: 30 });
    const base = defaultSettings("doublePendulum");
    expect([...settingsToSearchParams(base).keys()].filter((k) => k.startsWith("dpf"))).toEqual([]);
    const s: SimulatorSettings = { ...base, dpFan: true, dpFanCount: 1000, dpSpreadDeg: 0.000001, dpColourBy: "single", dpPalindrome: false, dpForwardSec: 12.5, dpDivergePx: 42.5 };
    const params = settingsToSearchParams(s);
    for (const key of [...Object.keys(DP_FAN_URL_KEYS), "dpfc"]) expect(params.has(key), key).toBe(true);
    expect(params.get("dpfs")).toBe("0.000001");
    const back = settingsFromSearchParams(new URLSearchParams(params.toString()));
    expect(back).toMatchObject({ dpFan: true, dpFanCount: 1000, dpSpreadDeg: 0.000001, dpColourBy: "single", dpPalindrome: false, dpForwardSec: 12.5, dpDivergePx: 42.5 });
    // values past their sliders round-trip exactly too, and bad ones fall back
    const far = settingsFromSearchParams(new URLSearchParams("mode=doublePendulum&dpf=1&dpfs=7.5&dpff=120&dpfd=900&dpfn=2500"));
    expect(far).toMatchObject({ dpSpreadDeg: 7.5, dpForwardSec: 120, dpDivergePx: 900, dpFanCount: 2500 });
    const bad = settingsFromSearchParams(new URLSearchParams("mode=doublePendulum&dpf=maybe&dpfs=-1&dpff=abc&dpfc=plaid&dpfn=0"));
    expect(bad).toMatchObject({ dpFan: false, dpSpreadDeg: 0, dpForwardSec: 10, dpColourBy: "index", dpFanCount: 1 });
  });

  it("resolve every value from its minimum up (never a maximum) and keep junk out", () => {
    const r = resolveDoublePendulumSettings({ fanCount: 12.4, spreadDeg: 1e9, forwardSec: 0.2, divergePx: -5, colourBy: "plaid" as never, fan: "yes" as never, palindrome: 1 as never });
    expect(r).toMatchObject({ fanCount: 12, spreadDeg: 1e9, forwardSec: 1, divergePx: 1, colourBy: "index", fan: false, palindrome: true });
    expect(resolveDoublePendulumSettings({ fanCount: 1e9 }).fanCount).toBe(ENTITY_CEILING);
    expect(DEFAULT_DOUBLE_PENDULUM_SETTINGS).toMatchObject(DEFAULT_CHAOS_FAN_SETTINGS);
  });

  it("presets: 200 pendulums a hair apart, 1,000 threads, two that drift apart – each a clip of one whole loop", () => {
    expect(CHAOS_FAN_PRESETS.map((p) => p.id)).toEqual(["hairApart", "threads", "twoApart"]);
    expect(chaosFanPresetFields("hairApart")).toMatchObject({ dpFan: true, dpFanCount: 200, dpSpreadDeg: 0.001, dpPalindrome: true, dpForwardSec: 10 });
    expect(chaosFanPresetFields("threads")).toMatchObject({ dpFanCount: 1000, dpSpreadDeg: 0.0001 });
    expect(chaosFanPresetFields("twoApart")).toMatchObject({ dpFanCount: 2, dpSpreadDeg: 0.01 });
    expect(chaosFanClipSec(chaosFanPresetFields("hairApart"))).toBe(20);
    expect(chaosFanClipSec(chaosFanPresetFields("threads"))).toBe(24);
    expect(chaosFanClipSec({ dpForwardSec: 7.3 })).toBe(15);
    // a preset survives presetToSettings as typed
    const p = presetToSettings({ mode: "doublePendulum", ...chaosFanPresetFields("threads") });
    expect(p).toMatchObject({ dpFan: true, dpFanCount: 1000, dpSpreadDeg: 0.0001 });
  });

  it("the panel's keys reach the search box and the command palette, the spread reads naturally", () => {
    for (const key of CHAOS_FAN_KEYS) {
      expect(DOUBLE_PENDULUM_KEYS).toContain(key);
      expect(MODE_BLOCK_KEYS.doublePendulum).toContain(key);
      for (const messages of [en, pl, es]) expect((messages.Controls as Record<string, string>)[key], key).toBeTruthy();
    }
    expect(SPREAD_PICKS.map(formatSpreadDeg)).toEqual(["0.000001°", "0.0001°", "0.001°", "0.01°", "0.1°"]);
    expect([formatSpreadDeg(0), formatSpreadDeg(1), formatSpreadDeg(12.5), formatSpreadDeg(100), formatSpreadDeg(1e-9)]).toEqual(["0°", "1°", "12.5°", "100°", "1.0e-9°"]);
  });
});

/* ------------------------------------------------------------------ the picture, the caption, the words */

describe("Chaos fan: the picture, the caption and the words", () => {
  it("lays the fan out in the recorded square (its reach a fixed share, whatever the canvas) with small bobs", () => {
    const f = chaosFanField(800, 600);
    expect(f.side).toBeCloseTo(0.96 * 600, 9);
    expect(f.scale).toBeCloseTo(0.42 * f.side, 9);
    expect(FAN_REF_PX_PER_UNIT).toBeCloseTo(0.96 * 1080 * 0.42, 9);
    expect(chaosFanBobPx(1036.8, 8)).toBeCloseTo(6.48, 9);
    expect(chaosFanBobPx(100, 0)).toBe(1.5);
  });

  it("batches the pendulums by hue and separation: one stroke per bucket, everyone drawn once", () => {
    const engine = engineOf({ fanCount: 300 });
    run(engine, 8);
    const fan = fanOf(engine);
    const buckets = bucketFan(fan);
    expect(buckets).toBe(36 * 5);
    const canvas = fakeCanvas(800, 800);
    drawChaosFan(canvas.ctx as unknown as CanvasRenderingContext2D, fan, engine.getDoublePendulumView().field!, { showGlow: true, wallThickness: 2 });
    const strokes = canvas.ctx.calls.filter((c) => c.name === "stroke").length;
    const moves = canvas.ctx.calls.filter((c) => c.name === "moveTo").length;
    expect(strokes).toBeLessThanOrEqual(buckets + 1);
    expect(moves).toBeGreaterThanOrEqual(fan.count); // every pendulum's line (and the bobs' arcs)
    // the single-colour fan: five buckets at most
    engine.setDoublePendulumSettings({ colourBy: "single" });
    expect(bucketFan(fan)).toBe(5);
    expect(fanLineAlpha(1)).toBe(0.95);
    expect(fanLineAlpha(1000)).toBeLessThan(fanLineAlpha(200));
    expect(hslRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(fanHue(0, 200)).toBe(330);
  });

  it("mirrors the run into the canvas' data-dp-fan-* attributes and removes them without a fan", () => {
    const engine = engineOf({ forwardSec: 2 });
    run(engine, 2.5);
    const data: Record<string, string> = {};
    writeChaosFanData(fanOf(engine), (k, v) => (data[k] = v), data as DOMStringMap);
    expect(Object.keys(data).sort()).toEqual([...CHAOS_FAN_DATA_KEYS].sort());
    expect(data).toMatchObject({ dpFan: "1", dpFanCount: "200", dpFanRunning: "backwards", dpFanBudget: String(FAN_STEP_BUDGET), dpFanTape: "1", dpFanColours: "index" });
    writeChaosFanData(null, (k, v) => (data[k] = v), data as DOMStringMap);
    expect(Object.keys(data)).toEqual([]);
  });

  it("writes a loop-style caption led by the pendulum count, with the butterfly fact and pendulum hashtags", () => {
    const ctx = loopCaptionContext({ ...defaultSettings("doublePendulum"), dpFan: true, dpFanCount: 200 } as Parameters<typeof loopCaptionContext>[0]);
    expect(ctx).toMatchObject({ hookKey: "chaosFan", factKey: "chaosFanFact", count: 200 });
    const words = en.LoopCaption as Record<string, string>;
    const cap = loopCaption({ mode: "doublePendulum", hook: words[ctx.hookKey], count: ctx.count, fact: words[ctx.factKey] });
    expect(cap.caption.startsWith("200 pendulums start a hair apart")).toBe(true);
    expect(cap.caption).toContain(" 🔊");
    expect(cap.hashtags).toBe("#satisfying #oddlysatisfying #physics #pendulum #creativecoding");
    expect(loopCaptionContext({ ...defaultSettings("doublePendulum") } as Parameters<typeof loopCaptionContext>[0]).hookKey).toBe("seconds");
  });

  it("has every word in English, Polish and Spanish (plural titles included) and no forbidden name", () => {
    for (const messages of [en, pl, es]) {
      const hud = messages.LoopHud as Record<string, string>;
      for (const key of ["chaosFanTitle", "chaosFanSubtitle", "chaosFanForwards", "chaosFanBackwards"]) expect(hud[key], key).toBeTruthy();
      expect(hud.chaosFanTitle).toContain("{count, plural");
      const rigged = messages.Rigged as Record<string, string>;
      for (const key of ["outcomeDivergesAt", "hintDivergesAt", "divergeAt", "findDivergesAt", "foundDivergesAt", "missDivergesAt", "missNoDiverge", "overlayDivergesAt", "overlayNoDiverge", "progressDivergesAt"]) expect(rigged[key], key).toBeTruthy();
      const controls = messages.Controls as Record<string, string>;
      for (const key of ["dpFanGroup", "dpFanTip", "dpFanDesc", "dpFanPresetsTip", "dpFanPresetHairApart", "dpFanPresetThreads", "dpFanPresetTwoApart", "dpFanCountTip", "dpSpreadDegTip", "dpSpreadPicks", "dpColourByTip", "dpColourByIndex", "dpColourBySingle", "dpPalindromeTip", "dpFanLoopLine", "dpFanForwardOnly", "dpForwardSecTip", "dpDivergePxTip"]) expect(controls[key], key).toBeTruthy();
      expect(JSON.stringify(messages).toLowerCase().includes("bor" + "is")).toBe(false);
    }
  });
});
