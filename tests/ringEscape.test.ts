import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import {
  DEFAULT_RING_ESCAPE_FIELDS,
  GAP_LAYOUTS,
  RING_CHORD_HZ,
  RING_ESCAPE_PRESET,
  RING_GAP_THETA0,
  RingTimer,
  readRingEscapeParams,
  resolveRingEscapeFields,
  ringEscapeActive,
  ringEscapeConfigIfSet,
  ringEscapeConfigOf,
  ringGapPlanOf,
  ringGapStart,
  ringPluckHz,
  ringPluckLevel,
  ringRainbowHue,
  ringRunOut,
  ringStepHz,
  timeInRingSec,
  wrapAngle,
  writeRingEscapeParams,
  type RingEscapeFields,
} from "@/lib/physics/ringEscape";
import { ringGapDegrees, ringRainbowColor, ringTimerText } from "@/components/simulator/ringEscapeRenderer";
import { RING_ESCAPE_KEYS } from "@/components/simulator/sections/RingEscapeSection";
import { MODE_BLOCK_KEY_SET, sectionKeyShown, type PanelShown } from "@/components/simulator/panelKeys";
import { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { inLoopScale } from "@/lib/audio/loopPitch";
import { frequencyToMidi } from "@/lib/audio/scales";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { RANGES, defaultSettings, engineSettingKeys, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, findSimulation, simulateOutcomeRun, type FinderRequest } from "@/lib/simulation/finder";
import { ESCAPE_AT_TOLERANCE_SEC, availableOutcomes, outcomeClipSec, outcomeFigure, outcomeMatches, outcomeMiss, ringOutcomeSettled, type FinderOutcome, type RunSummary } from "@/lib/simulation/outcomes";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { arenaPhysicsConfig } from "@/lib/simulation/multi";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- ring-escape --- Classic's Ring Escape (lib/physics/ringEscape.ts): the gap layouts (the spiral puts gap k at θ0 + k · step),
 * the rings turning together, the time in the ring, the ring sounds and their scheduling on the fake Web Audio graph, Find
 * Simulation's ring-at (the first ring at a target second, matched within the tolerance on a seed it returns, replayed by a fresh
 * engine), the classic rings untouched by default, fingerprints at 30, 60 and 120 frames a second, the canvas' rainbow and line,
 * the settings (links, presets) and the translations.
 */

const WORLD = { width: 800, height: 450 };
const TWO_PI = Math.PI * 2;
const SPS = 60;

afterEach(() => {
  vi.unstubAllGlobals();
});

function settingsOf(patch: Partial<SimulatorSettings> = {}): SimulatorSettings {
  return { ...defaultSettings("classic"), ...RING_ESCAPE_PRESET, backgroundColors: [...RING_ESCAPE_PRESET.backgroundColors], ...patch } as SimulatorSettings;
}

function engineOf(s: SimulatorSettings, seed = 7): PhysicsEngine {
  return createEngineForSettings(physicsConfigOfSettings(s, WORLD), "classic", modeSettingsOfSettings(s), seed);
}

/** Runs `steps` fixed steps, collecting the sound events with the step that made them. */
function run(engine: PhysicsEngine, steps: number, frameMs = 1000 / SPS): { step: number; ev: SoundEvent }[] {
  const out: { step: number; ev: SoundEvent }[] = [];
  const frames = Math.round((steps * (1000 / SPS)) / frameMs);
  for (let i = 0; i < frames; i++) {
    engine.update(frameMs, 0);
    const step = Math.round(engine.getElapsedMs() / (1000 / SPS));
    for (const ev of engine.consumeSoundEvents()) out.push({ step, ev });
  }
  return out;
}

/* ------------------------------------------------------------------ the gaps */

describe("Ring Escape: the gap layouts", () => {
  it("puts gap k of the spiral at θ0 + k · step (modulo 2π), every aligned gap at θ0 and the even gaps at 2πk / n", () => {
    const step = (25 * Math.PI) / 180;
    for (let k = 0; k < 40; k++) {
      expect(ringGapStart("spiral", k, 40, step, () => 0)).toBeCloseTo(wrapAngle(RING_GAP_THETA0 + k * step), 12);
      expect(ringGapStart("aligned", k, 40, step, () => 0)).toBe(wrapAngle(RING_GAP_THETA0));
      expect(ringGapStart("even", k, 40, step, () => 0)).toBe((TWO_PI * k) / 40);
    }
    // every start in [0, 2π), whatever the step (a 720° step is a step of 0, 370° one of 10°)
    for (const deg of [0, 10, 90, 370, 720, 1e6]) {
      for (let k = 0; k < 20; k++) {
        const a = ringGapStart("spiral", k, 20, (deg * Math.PI) / 180, () => 0);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(TWO_PI);
      }
    }
    expect(ringGapStart("spiral", 3, 11, ((370 * Math.PI) / 180), () => 0)).toBeCloseTo(wrapAngle((3 * 10 * Math.PI) / 180), 9);
    // random: one draw a ring, 2π × the draw
    const draws = [0.25, 0.5, 0.999];
    let i = 0;
    expect([0, 1, 2].map((k) => ringGapStart("random", k, 3, 0, () => draws[i++]))).toEqual(draws.map((d) => TWO_PI * d));
  });

  it("builds Classic's rings with the spiral: gap k of the engine's rings starts at k · step, the gaps keep their size", () => {
    const s = settingsOf({ gapSpiralStep: 30 });
    const engine = engineOf(s);
    const walls = engine.getCircularWalls();
    expect(walls).toHaveLength(11);
    walls.forEach((w, k) => {
      expect(w.gaps).toHaveLength(1);
      expect(w.gaps[0].startAngle).toBeCloseTo(wrapAngle(RING_GAP_THETA0 + (k * 30 * Math.PI) / 180), 9);
      expect(w.gaps[0].endAngle - w.gaps[0].startAngle).toBeCloseTo(0.8, 9);
    });
    expect(ringGapDegrees(walls)).toBe("0,30,60,90,120,150,180,210,240,270,300");
    const aligned = engineOf(settingsOf({ gapLayout: "aligned" }));
    expect(new Set(aligned.getCircularWalls().map((w) => w.gaps[0].startAngle))).toEqual(new Set([RING_GAP_THETA0]));
  });

  it("leaves the classic rings exactly as they were by default (even gaps, no draws: every old run replays)", () => {
    const plain = defaultSettings("classic");
    const config: PhysicsConfig = physicsConfigOfSettings(plain, WORLD);
    expect("gapLayout" in config).toBe(false);
    const a = createEngineForSettings(config, "classic", modeSettingsOfSettings(plain), 11);
    const b = createEngineForSettings({ ...config, gapLayout: "even", gapSpiralStep: 77, ringSpin: "alternate", ringSound: false }, "classic", modeSettingsOfSettings(plain), 11);
    a.getCircularWalls().forEach((w, k) => expect(w.gaps[0].startAngle).toBe((TWO_PI * k) / 7));
    run(a, 600);
    run(b, 600);
    expect(b.getBalls().map((x) => [x.x, x.y, x.vx, x.vy])).toEqual(a.getBalls().map((x) => [x.x, x.y, x.vx, x.vy]));
    expect([...b.getBrokenWalls()]).toEqual([...a.getBrokenWalls()]);
  });

  it("draws the random layout from the run's seed: the same seed, the same gaps; another seed, others", () => {
    const s = settingsOf({ gapLayout: "random" });
    const gaps = (seed: number) => engineOf(s, seed).getCircularWalls().map((w) => w.gaps[0].startAngle);
    expect(gaps(5)).toEqual(gaps(5));
    expect(gaps(5)).not.toEqual(gaps(6));
    for (const a of gaps(9)) expect(a >= 0 && a < TWO_PI).toBe(true);
  });

  it("only lays out Classic's rings (Shatter's and the other ring modes' stay theirs)", () => {
    const s = settingsOf({ gapLayout: "aligned" });
    const shatter = createEngineForSettings(physicsConfigOfSettings({ ...s, mode: "shatter" }, WORLD), "shatter", modeSettingsOfSettings({ ...s, mode: "shatter" }), 3);
    const plain = createEngineForSettings(physicsConfigOfSettings({ ...defaultSettings("shatter"), wallCount: 11, gapSize: 0.8 }, WORLD), "shatter", modeSettingsOfSettings(defaultSettings("shatter")), 3);
    expect(shatter.getCircularWalls().map((w) => w.gaps.map((g) => g.startAngle))).toEqual(plain.getCircularWalls().map((w) => w.gaps.map((g) => g.startAngle)));
    expect(ringGapPlanOf({})).toBeNull();
    expect(ringGapPlanOf({ gapLayout: "spiral", gapSpiralStep: 45 })).toEqual({ layout: "spiral", stepRad: Math.PI / 4 });
  });

  it("lays the rings out anew live on a new layout or step (the broken rings stay broken)", () => {
    const engine = engineOf(settingsOf({ gapLayout: "even" }));
    engine.getBrokenWalls().add(0);
    engine.setConfig({ gapLayout: "spiral", gapSpiralStep: 20 });
    expect(engine.getCircularWalls().map((w) => Math.round((w.gaps[0].startAngle * 180) / Math.PI))).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200]);
    expect(engine.getWallRotations().every((r) => r === 0)).toBe(true);
    expect([...engine.getBrokenWalls()]).toEqual([0]);
    engine.setConfig({ gapSpiralStep: 10 });
    expect(Math.round((engine.getCircularWalls()[3].gaps[0].startAngle * 180) / Math.PI)).toBe(30);
  });
});

/* ------------------------------------------------------------------ the spin */

describe("Ring Escape: the rings turning together", () => {
  it("turns every ring the same way at the same speed (alternate: neighbours opposite ways)", () => {
    const together = engineOf(settingsOf({ ringSpin: "together" }));
    run(together, 60);
    const rot = together.getWallRotations();
    expect(rot[0]).toBeGreaterThan(0);
    for (const r of rot) expect(r).toBeCloseTo(rot[0], 12);
    const alternate = engineOf(settingsOf({ ringSpin: "alternate" }));
    run(alternate, 60);
    const alt = alternate.getWallRotations();
    expect(alt[0]).toBeCloseTo(-alt[1], 12);
    // a spiral turning together stays a spiral: neighbouring gaps keep their step
    const step = (30 * Math.PI) / 180;
    const walls = together.getCircularWalls();
    for (let k = 1; k < walls.length; k++) expect(wrapAngle(walls[k].gaps[0].startAngle + rot[k] - walls[k - 1].gaps[0].startAngle - rot[k - 1])).toBeCloseTo(step, 9);
  });

  it("keeps never escape's promise with the rings turning together (the rig predicts their turn)", { timeout: 60_000 }, () => {
    for (const seed of [1, 2, 3]) {
      const s = settingsOf({ neverEscape: true });
      const engine = createEngineForSettings(physicsConfigOfSettings(s, WORLD), "classic", modeSettingsOfSettings(s), seed);
      run(engine, 30 * SPS);
      expect(engine.getFirstEscapeMs()).toBe(-1);
      expect(engine.isSimulationFinished()).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ the time in the ring */

describe("Ring Escape: the time in the ring", () => {
  it("counts the rings escaped, when, and the way out (a pure timer)", () => {
    const timer = new RingTimer();
    timer.reset(3);
    expect(timer.step(0, 3, 1000)).toBe(0);
    expect(timer.getView()).toMatchObject({ rings: 3, escaped: 0, ring: 1, enteredMs: 0, firstMs: -1, outMs: -1 });
    expect(timeInRingSec(timer.getView(), 2500)).toBe(2.5);
    expect(timer.step(1, 3, 3000)).toBe(1);
    expect(timer.getView()).toMatchObject({ escaped: 1, ring: 2, enteredMs: 3000, firstMs: 3000, outMs: -1 });
    expect(timeInRingSec(timer.getView(), 4200)).toBeCloseTo(1.2, 12);
    expect(timer.step(3, 3, 5000)).toBe(2); // two rings in one step
    expect(timer.escapes).toEqual([3000, 5000, 5000]);
    expect(ringRunOut(timer.getView())).toBe(true);
    expect(timeInRingSec(timer.getView(), 9000)).toBe(5); // frozen at the way out
    // rings built anew (a new wall count clears the broken ones): the count starts over from now
    expect(timer.step(0, 5, 6000)).toBe(0);
    expect(timer.getView()).toMatchObject({ rings: 5, escaped: 0, ring: 1, enteredMs: 6000, outMs: -1 });
    expect(timer.escapes).toEqual([]);
  });

  it("follows Classic's broken rings: every ring escaped once, in time order, the first one first, out when the last one breaks", { timeout: 60_000 }, () => {
    const engine = engineOf(settingsOf(), 3);
    for (let i = 0; i < 120 * SPS && !engine.isSimulationFinished(); i++) {
      engine.update(1000 / SPS, 0);
      engine.consumeSoundEvents();
      const view = engine.getRingEscapeView()!;
      expect(view.escaped).toBe(engine.getBrokenWalls().size);
      expect(view.ring).toBe(view.escaped + 1);
    }
    const view = engine.getRingEscapeView()!;
    expect(view.rings).toBe(11);
    expect(view.escaped).toBe(11);
    expect(view.outMs).toBeGreaterThan(view.firstMs);
    const times = engine.getRingEscapeTimes();
    expect(times).toHaveLength(11);
    expect(times[0]).toBe(view.firstMs);
    for (let k = 1; k < times.length; k++) expect(times[k]).toBeGreaterThanOrEqual(times[k - 1]);
    expect(times[10]).toBe(view.outMs);
    // outside Classic there is no ring view
    const shatter = createEngineForSettings(physicsConfigOfSettings(defaultSettings("shatter"), WORLD), "shatter", modeSettingsOfSettings(defaultSettings("shatter")), 3);
    expect(shatter.getRingEscapeView()).toBeNull();
  });

  it("counts the rings standing now when the wall count changes before the run (the preset's eleven, not the old seven)", () => {
    const engine = engineOf(settingsOf({ wallCount: 7 }));
    expect(engine.getRingEscapeView()!.rings).toBe(7);
    engine.setConfig({ wallCount: 11 });
    expect(engine.getCircularWalls()).toHaveLength(11);
    expect(engine.getRingEscapeView()!.rings).toBe(11);
    expect(engine.getRingEscapeView()!.ring).toBe(1);
  });

  it("writes the line as the account would: \"ring k: t s\", one decimal, lowercase, the page's separator; \"out in t s\"", () => {
    const timer = new RingTimer();
    timer.reset(11);
    timer.step(2, 11, 4000);
    const look = { ringText: en.RingEscape.hudRing, outText: en.RingEscape.hudOut, locale: "en" };
    expect(ringTimerText(timer.getView(), 5470, look)).toBe("ring 3: 1.4 s");
    expect(ringTimerText(timer.getView(), 5470, { ringText: pl.RingEscape.hudRing, outText: pl.RingEscape.hudOut, locale: "pl" })).toBe("pierścień 3: 1,4 s");
    expect(ringTimerText(timer.getView(), 5470, { ringText: es.RingEscape.hudRing, outText: es.RingEscape.hudOut, locale: "es" })).toBe("anillo 3: 1,4 s");
    timer.step(11, 11, 23_456);
    expect(ringTimerText(timer.getView(), 30_000, look)).toBe("out in 23.4 s");
  });
});

/* ------------------------------------------------------------------ the sounds */

describe("Ring Escape: the ring sounds", () => {
  it("pitches a ring's pluck on its own degree of C major pentatonic (outer rings low, inner high, inside C3–C6)", () => {
    for (const n of [2, 7, 11, 40]) {
      let last = Infinity;
      for (let i = 0; i < n; i++) {
        const f = ringPluckHz(i, n);
        const midi = Math.round(frequencyToMidi(f));
        expect(inLoopScale(midi, 48, "majorPentatonic")).toBe(true);
        expect(f).toBeGreaterThanOrEqual(130);
        expect(f).toBeLessThanOrEqual(1050);
        expect(f).toBeLessThanOrEqual(last);
        last = f;
      }
      expect(ringPluckHz(0, n)).toBeGreaterThan(ringPluckHz(n - 1, n));
    }
    // the ladder climbs one degree a ring escaped, in the steps' 0.7–3.5 kHz, and wraps in register
    const steps = Array.from({ length: 11 }, (_, k) => ringStepHz(k));
    for (let k = 1; k < steps.length; k++) expect(steps[k]).toBeGreaterThan(steps[k - 1]);
    for (const f of steps) expect(f > 700 && f < 3500).toBe(true);
    expect(ringStepHz(13)).toBe(ringStepHz(0));
    expect(ringPluckLevel(0, 400)).toBe(0.8);
    expect(ringPluckLevel(-800, 400)).toBe(1);
  });

  it("plays a pluck for every wall bounce instead of the classic tone, a step for every ring escaped, the chord once at the way out", { timeout: 60_000 }, () => {
    const engine = engineOf(settingsOf(), 3);
    const events = run(engine, 120 * SPS);
    const walls = engine.getCircularWalls().length;
    const plucks = events.filter((e) => e.ev.loop === "pluck");
    expect(plucks.length).toBeGreaterThan(20);
    for (const { ev } of plucks) {
      expect(ev.frequency).toBeCloseTo(ringPluckHz(ev.wallIndex, walls), 9);
      expect(ev.melody).toBe(false);
      expect(ev.level).toBeGreaterThanOrEqual(0.8);
      expect(ev.level).toBeLessThanOrEqual(1);
    }
    // no plain wall tones left (the gap passes keep their sound)
    expect(events.filter((e) => e.ev.type === "hit" && !e.ev.loop)).toEqual([]);
    const steps = events.filter((e) => e.ev.loop === "step");
    expect(steps).toHaveLength(11);
    steps.forEach(({ ev }, k) => {
      expect(ev.frequency).toBeCloseTo(ringStepHz(k), 9);
      expect(!!ev.accent).toBe(k === 10);
    });
    const chords = events.filter((e) => e.ev.loop === "chord");
    expect(chords).toHaveLength(1);
    expect(chords[0].ev.frequency).toBe(RING_CHORD_HZ);
    expect(chords[0].step).toBe(steps[10].step);
    // the first step at the step the first ring broke
    expect(steps[0].step).toBe(Math.round(engine.getRingEscapeView()!.firstMs / (1000 / SPS)));
  });

  it("keeps the classic tones with the ring sounds off", () => {
    const events = run(engineOf(settingsOf({ ringSound: false }), 3), 20 * SPS);
    expect(events.some((e) => e.ev.type === "hit")).toBe(true);
    expect(events.every((e) => !e.ev.loop)).toBe(true);
  });

  it("schedules the plucks, the steps and the chord on the context's clock through ToneGenerator.playLoop (the fake Web Audio graph)", { timeout: 60_000 }, async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    const events = run(engineOf(settingsOf(), 3), 120 * SPS);
    let last = -1;
    for (const { step, ev } of events) {
      if (step !== last) {
        graph.ctx.currentTime = step / SPS;
        last = step;
      }
      playSoundEvent(tone, ev, () => undefined);
    }
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const sounded = (step: number, f: number) => graph.oscillators.some((o) => near(o.startAt, step / SPS) && Math.abs(o.frequency - f) < 0.01);
    const steps = events.filter((e) => e.ev.loop === "step");
    for (const { step, ev } of steps) expect(sounded(step, ev.frequency!)).toBe(true);
    const chord = events.find((e) => e.ev.loop === "chord")!;
    expect(sounded(chord.step, RING_CHORD_HZ)).toBe(true);
    const first = events.find((e) => e.ev.loop === "pluck")!;
    expect(sounded(first.step, first.ev.frequency!)).toBe(true);
  });
});

/* ------------------------------------------------------------------ Find Simulation: the first ring at a target second */

describe("Ring Escape: Find Simulation's ring-at", () => {
  function withFrames<T>(fn: () => Promise<T>): Promise<T> {
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
    return fn().finally(() => {
      globalThis.requestAnimationFrame = raf;
    });
  }
  const s = settingsOf();
  const request = (outcome: FinderOutcome): FinderRequest => ({
    targetDurationSec: 30,
    toleranceSec: 0.5,
    maxSeeds: 400,
    maxSimTimeSec: 120,
    physicsConfig: physicsConfigOfSettings(s, WORLD),
    mode: "classic",
    modeSettings: modeSettingsOfSettings(s),
    outcome,
  });
  const summary = (patch: Partial<RunSummary>): RunSummary => ({ mode: "classic", durationMs: 30_000, finished: false, firstEscapeMs: -1, teams: [], ...patch });

  it("is offered in Classic while a Ring Escape option is on (never otherwise: the classic list stays as it was)", () => {
    const ctx = { endless: false, neverEscape: false, ballCount: 1 };
    expect(availableOutcomes("classic", ctx)).toEqual(["duration", "never-escapes", "escapes-at"]);
    expect(availableOutcomes("classic", { ...ctx, ringEscape: true })).toEqual(["duration", "never-escapes", "escapes-at", "ring-at"]);
    expect(availableOutcomes("shatter", { ...ctx, ringEscape: true })).not.toContain("ring-at");
    expect(ringEscapeActive(DEFAULT_RING_ESCAPE_FIELDS)).toBe(false);
    for (const patch of [{ gapLayout: "spiral" }, { ringSpin: "together" }, { ringRainbow: true }, { ringTimer: true }, { ringSound: true }] as Partial<RingEscapeFields>[]) expect(ringEscapeActive({ ...DEFAULT_RING_ESCAPE_FIELDS, ...patch })).toBe(true);
  });

  it("judges a run by its first ring: within ±0.5 s of the target, the miss in seconds, the figure, the clip of a finished run", () => {
    const o: FinderOutcome = { kind: "ring-at", clipSec: 30, atSec: 3 };
    expect(outcomeMatches(o, summary({ firstRingMs: 3400 }))).toBe(true);
    expect(outcomeMatches(o, summary({ firstRingMs: 2500 }))).toBe(true);
    expect(outcomeMatches(o, summary({ firstRingMs: 3600 }))).toBe(false);
    expect(outcomeMatches(o, summary({ firstRingMs: -1 }))).toBe(false);
    expect(outcomeMatches({ ...o, toleranceSec: 0.1 }, summary({ firstRingMs: 3200 }))).toBe(false);
    expect(outcomeMiss(o, summary({ firstRingMs: 4500 }))).toBeCloseTo(1.5, 9);
    expect(outcomeMiss(o, summary({}))).toBe(Infinity);
    expect(outcomeFigure(o, summary({ firstRingMs: 2900 }))).toBeCloseTo(2.9, 9);
    expect(outcomeClipSec(o, summary({ firstRingMs: 2900, finished: true, durationMs: 27_000 }))).toBe(27);
    // a miss stops a run's simulation at once, a match plays on (to the run's end), no ring yet waits for the window to pass
    expect(ringOutcomeSettled(o, 1000, 1000)).toBe(true);
    expect(ringOutcomeSettled(o, 3100, 3100)).toBe(false);
    expect(ringOutcomeSettled(o, 3000, -1)).toBe(false);
    expect(ringOutcomeSettled(o, 3600, -1)).toBe(true);
    expect(ESCAPE_AT_TOLERANCE_SEC).toBe(0.5);
  });

  it("finds a seed whose first ring comes at 3 s ± 0.5 s, and a fresh engine replays that seed's first ring there", { timeout: 120_000 }, async () => {
    const outcome: FinderOutcome = { kind: "ring-at", clipSec: 30, atSec: 3 };
    const found = await withFrames(() => findSimulation(request(outcome), () => undefined));
    expect(found.found).toBe(true);
    expect(found.outcome).toBe("ring-at");
    expect(Math.abs((found.ringAt ?? -1) - 3)).toBeLessThanOrEqual(ESCAPE_AT_TOLERANCE_SEC + 1e-9);
    // the summary of the seed it returns says the same, every time
    const again = simulateOutcomeRun(found.seed, request(outcome), outcome);
    expect(again).toEqual(simulateOutcomeRun(found.seed, request(outcome), outcome));
    expect(Math.abs((again.firstRingMs ?? -1) / 1000 - 3)).toBeLessThanOrEqual(ESCAPE_AT_TOLERANCE_SEC + 1e-9);
    // the page's replay: a fresh engine of the same settings and seed gets through the first ring within the window
    const replay = engineOf(s, found.seed);
    while (replay.getRingEscapeView()!.firstMs < 0 && replay.getElapsedMs() < 10_000) {
      replay.update(1000 / SPS, 0);
      replay.consumeSoundEvents();
    }
    expect(Math.abs(replay.getRingEscapeView()!.firstMs / 1000 - 3)).toBeLessThanOrEqual(ESCAPE_AT_TOLERANCE_SEC + 1e-9);
    // the clip is the whole run when it finished within the search's horizon
    expect(found.duration).toBeGreaterThan(3);
  });
});

/* ------------------------------------------------------------------ determinism */

describe("Ring Escape: determinism", () => {
  /** The run's state after `seconds` at `fps` frames a second (the engine runs fixed 60 Hz steps whatever the frame rate). */
  function fingerprint(fps: number, seconds: number, patch: Partial<SimulatorSettings> = {}) {
    const engine = engineOf(settingsOf(patch), 21);
    const events = run(engine, seconds * SPS, 1000 / fps);
    const b = engine.getBalls()[0];
    return { x: Math.round(b.x * 1e6), y: Math.round(b.y * 1e6), escaped: engine.getRingEscapeView()!.escaped, firstMs: Math.round(engine.getRingEscapeView()!.firstMs), sounds: events.length, plucks: events.filter((e) => e.ev.loop === "pluck").length };
  }

  it("runs the same at 30, 60 and 120 frames a second (the preset and the random layout)", { timeout: 60_000 }, () => {
    for (const patch of [{}, { gapLayout: "random" as const }, { ringSpin: "alternate" as const, gapSpiralStep: 45 }]) {
      const at60 = fingerprint(60, 12, patch);
      expect(fingerprint(30, 12, patch)).toEqual(at60);
      expect(fingerprint(120, 12, patch)).toEqual(at60);
    }
  });

  it("pins the preset's run of seed 21 (a change to the layout, the spin, the sounds or the draws shows up here)", () => {
    const at60 = fingerprint(60, 12);
    expect({ x: Math.round(at60.x / 1e3), y: Math.round(at60.y / 1e3) }).toEqual({ x: 429763, y: 129218 });
    expect(at60).toMatchObject({ escaped: 4, firstMs: 2867, sounds: 46, plucks: 38 });
    const engine = engineOf(settingsOf(), 21);
    run(engine, 12 * SPS);
    expect(engine.getRingEscapeTimes().map(Math.round)).toEqual([2867, 4267, 7650, 9883]);
  });
});

/* ------------------------------------------------------------------ the canvas */

describe("Ring Escape: the rainbow by ring", () => {
  it("runs red outside to cyan inside", () => {
    expect(ringRainbowHue(0, 11)).toBe(180);
    expect(ringRainbowHue(10, 11)).toBe(0);
    expect(ringRainbowHue(5, 11)).toBe(90);
    for (let i = 1; i < 11; i++) expect(ringRainbowHue(i, 11)).toBeLessThan(ringRainbowHue(i - 1, 11));
    expect(ringRainbowHue(0, 1)).toBe(0);
    expect(ringRainbowColor(10, 11)).toBe("hsl(0, 100%, 60%)");
    expect(ringRainbowColor(0, 11)).toBe("hsl(180, 100%, 60%)");
    expect(ringRainbowColor(0, 11)).toBe(ringRainbowColor(0, 11)); // cached
    expect(ringRainbowColor(10, 11, 0.5)).toBe("hsla(0, 100%, 60%, 0.5)");
  });
});

/* ------------------------------------------------------------------ settings */

describe("Ring Escape: settings, links and presets", () => {
  it("defaults to the classic rings (even gaps, alternating spin, no rainbow, no timer, the classic tones)", () => {
    const d = defaultSettings("classic");
    expect({ gapLayout: d.gapLayout, gapSpiralStep: d.gapSpiralStep, ringSpin: d.ringSpin, ringRainbow: d.ringRainbow, ringTimer: d.ringTimer, ringSound: d.ringSound }).toEqual(DEFAULT_RING_ESCAPE_FIELDS);
    expect(settingsToSearchParams(d).toString()).not.toMatch(/regl|ress|resp|rerb|retm|resn/);
    expect(RANGES.gapSpiralStep).toEqual({ min: 0, max: 90, step: 0.5 });
    // the step is an angle: it engages no extreme-values runtime, whatever its value
    expect(engineSettingKeys("classic")).not.toContain("gapSpiralStep");
    expect(ringEscapeConfigIfSet(d)).toEqual({});
  });

  it("round-trips through a link and a preset, the step past its slider kept exactly", () => {
    const s = settingsOf({ gapSpiralStep: 137.5, ringTimer: true, gapLayout: "spiral" });
    const params = settingsToSearchParams(s);
    for (const key of ["regl", "ress", "resp", "rerb", "retm", "resn"]) expect(params.has(key)).toBe(true);
    const back = settingsFromSearchParams(params);
    for (const key of Object.keys(DEFAULT_RING_ESCAPE_FIELDS) as (keyof RingEscapeFields)[]) expect(back[key]).toEqual(s[key]);
    expect(back.wallCount).toBe(11);
    const preset = presetToSettings(JSON.parse(JSON.stringify(s)));
    for (const key of Object.keys(DEFAULT_RING_ESCAPE_FIELDS) as (keyof RingEscapeFields)[]) expect(preset[key]).toEqual(s[key]);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&ress=1e9")).gapSpiralStep).toBe(1e9);
  });

  it("refuses what is no setting: unknown layouts and spins, a negative or non-numeric step, non-boolean switches", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=classic&regl=zigzag&ress=-5&resp=sideways&rerb=yes&retm=2&resn=1"));
    expect(s.gapLayout).toBe("even");
    expect(s.gapSpiralStep).toBe(0); // (lifted onto the minimum)
    expect(s.ringSpin).toBe("alternate");
    expect(s.ringRainbow).toBe(false);
    expect(s.ringTimer).toBe(false);
    expect(s.ringSound).toBe(true);
    expect(resolveRingEscapeFields({ gapLayout: 3, gapSpiralStep: Number.NaN, ringSpin: null, ringRainbow: "1" })).toEqual(DEFAULT_RING_ESCAPE_FIELDS);
    const fields = { ...DEFAULT_RING_ESCAPE_FIELDS };
    readRingEscapeParams(new URLSearchParams("ress=abc"), fields);
    expect(fields.gapSpiralStep).toBe(DEFAULT_RING_ESCAPE_FIELDS.gapSpiralStep);
    const params = new URLSearchParams();
    writeRingEscapeParams({ ...DEFAULT_RING_ESCAPE_FIELDS, gapSpiralStep: 12.25 }, DEFAULT_RING_ESCAPE_FIELDS, params);
    expect(params.toString()).toBe("ress=12.25");
    for (const layout of GAP_LAYOUTS) expect(settingsFromSearchParams(new URLSearchParams(`regl=${layout}`)).gapLayout).toBe(layout);
  });

  it("is the poster's look: eleven rainbow rings on black, the spiral turning together, a white ball, no title and no counter", () => {
    expect(RING_ESCAPE_PRESET).toMatchObject({ wallCount: 11, gapLayout: "spiral", ringSpin: "together", ringRainbow: true, ringTimer: false, ringSound: true, ballColor: "#FFFFFF", showTrails: true, colorTrail: false, loopHud: false, rainbowWalls: false });
    expect(RING_ESCAPE_PRESET.backgroundColors).toEqual(["#000000", "#000000"]);
    const s = settingsOf();
    expect(settingsFromSearchParams(settingsToSearchParams(s)).backgroundColors[0]).toBe("#000000");
  });

  it("travels in every engine config of a run: the page's, the bot's (only when set), the split-screen arenas'", () => {
    const s = settingsOf({ gapLayout: "random", gapSpiralStep: 12 });
    expect(ringEscapeConfigOf(s)).toEqual({ gapLayout: "random", gapSpiralStep: 12, ringSpin: "together", ringSound: true });
    expect(physicsConfigOfSettings(s)).toMatchObject({ gapLayout: "random", ringSpin: "together", ringSound: true });
    expect(physicsConfigOfSettings(s).gapSpiralStep).toBeUndefined(); // (only the spiral reads it)
    expect(arenaPhysicsConfig(s)).toMatchObject(ringEscapeConfigOf(s));
  });
});

/* ------------------------------------------------------------------ the panel and the translations */

describe("Ring Escape: the panel and the translations", () => {
  it("lists its controls in the Wall section, in Classic only (Classic keeps no block of the Mode group)", () => {
    const panel: Omit<PanelShown, "mode"> = { ballPicture: false, showTrails: true, glassGates: false, wobblyWalls: false, simulationFound: false, bannerText: false, arenas: false, teams: false, captions: false, videoBackground: false, videoBeats: true, batch: true, bot: true };
    for (const key of RING_ESCAPE_KEYS) {
      expect(MODE_BLOCK_KEY_SET.has(key), key).toBe(false);
      expect(sectionKeyShown(key, { ...panel, mode: "classic" }, false), key).toBe(true);
      for (const mode of ["shatter", "multiply", "colourSort", "hoops"] as const) expect(sectionKeyShown(key, { ...panel, mode }, false), `${mode} ${key}`).toBe(false);
    }
  });

  it("has every word in English, Polish and Spanish", () => {
    const controls = ["reDesc", "reSpiralPreset", "reSpiralPresetTip", "reSpiralPresetButton", "gapLayout", "gapLayoutTip", "gapLayoutEven", "gapLayoutRandom", "gapLayoutAligned", "gapLayoutSpiral", "gapSpiralStep", "gapSpiralStepTip", "ringSpin", "ringSpinTip", "ringSpinAlternate", "ringSpinTogether", "ringRainbow", "ringRainbowTip", "ringTimer", "ringTimerTip", "ringSound", "ringSoundTip"];
    const rigged = ["outcomeRingAt", "hintRingAt", "findRingAt", "foundRingAt", "missRingAt", "missNoRing", "overlayRingAt", "overlayNoRing", "progressRingAt", "ringAt"];
    for (const messages of [en, pl, es] as unknown as Record<string, Record<string, string>>[]) {
      for (const key of controls) expect(messages.Controls[key], key).toBeTruthy();
      for (const key of rigged) expect(messages.Rigged[key], key).toBeTruthy();
      expect(Object.keys(messages.RingEscape)).toEqual(["hudRing", "hudOut"]);
      expect(messages.RingEscape.hudRing).toContain("{ring}");
      expect(messages.RingEscape.hudRing).toContain("{time}");
      expect(messages.RingEscape.hudOut).toContain("{time}");
    }
    for (const key of RING_ESCAPE_KEYS) expect((en as unknown as Record<string, Record<string, string>>).Controls[key], key).toBeTruthy();
  });
});
