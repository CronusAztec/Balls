import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { fakeCanvas } from "./fakeCanvas";
import {
  ALIGN_PROGRESS_THRESHOLDS,
  DEFAULT_PHASE_SPIRAL_SETTINGS,
  DEFAULT_TRAIL_SEC,
  DOT_CEILING,
  PHASE_SPIRAL_PRESET,
  PS_CHORD_HZ,
  PS_PLUCKS_PER_STEP,
  PS_ROOT_MIDI,
  PS_RISER_FROM,
  PS_SPAN,
  armAngle,
  effectiveArms,
  inLineOf,
  inLinePercent,
  pickPluckDegrees,
  phaseSpiralDegree,
  phaseSpiralPitch,
  polyLoopPeriod,
  progressCrossings,
  readPhaseSpiralParams,
  resolvePhaseSpiralSettings,
  seamsBefore,
  spiralColor,
  stepsToNextAlignment,
  tickPhaseModArms,
  writePhaseSpiralParams,
} from "@/lib/physics/phaseSpiral";
import { DEFAULT_POLYRHYTHM_SETTINGS, POLY_METER_OUTER_SHARE, POLY_OUTER_SHARE, buildTempoSeries, polyOuterShare, polyrhythmSettingsOf, resolvePolyrhythmSettings, tickPhaseMod2, type PolyrhythmSettings } from "@/lib/physics/modes/polyrhythm"; // (--- low-findings-2 --- polyOuterShare, polyrhythmSettingsOf)
import { TAIL_RAD_PER_SEC, drawInLineMeter, tailArc } from "@/components/simulator/phaseSpiralRenderer";
import { drawPolyrhythmStage, drawPolyrhythmVoices } from "@/components/simulator/polyrhythmRenderer";
import { PHASE_SPIRAL_KEYS } from "@/components/simulator/sections/PhaseSpiralSection";
import { POLYRHYTHM_KEYS } from "@/components/simulator/sections/PolyrhythmSection";
import { MODE_BLOCK_KEYS } from "@/components/simulator/panelKeys";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { inLoopScale } from "@/lib/audio/loopPitch";
import { frequencyToMidi } from "@/lib/audio/scales";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { MEMORY_CEILINGS, memoryCeiling } from "@/lib/uncap";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { LOOP_HUD_MODE_TEXT, drawLoopHud, isPhaseSpiralPage, loopHudCount, loopHudFrame, loopHudLayout, loopHudModeText } from "@/lib/loop/hud"; // (--- low-findings-2 --- isPhaseSpiralPage, loopHudModeText)
import { WholeLoopCut } from "@/lib/loop/loopContract";
import { loopCaption, loopCaptionContext } from "@/lib/publish/loopCaption";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- phase-spiral --- Phase Spiral (lib/physics/phaseSpiral.ts, the Metronomes & Polyrhythms extension): the arms (k dots a ring,
 * one spoke a tick), the in-line meter (the arms-fold resultant: 100 % at t = 0 and t = T, under 20 % at T / 2 for 20 rings),
 * its 50 / 75 / 90 % crossings and their risers, the loop sounds and their scheduling on the fake Web Audio graph, the loop
 * contract of an endless run, the fingerprints at 30, 60 and 120 frames a second, the live changes, the HUD counter and bar,
 * the canvas, the settings (URL, presets, the memory ceiling) and the translations.
 */

afterEach(() => vi.unstubAllGlobals());

const STEP = 1000 / 60;
const SPS = 60;
const config: PhysicsConfig = { width: 800, height: 800, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };

/** The preset's polyrhythm: 20 harmonic rings, 3 arms, a 20 s endless loop, the meter, tails, loop sounds, the spiral palette. */
const SPIRAL: Partial<PolyrhythmSettings> = { count: 20, arms: 3, layout: "rings", tempos: "harmonic", cycleSeconds: 20, cycles: 0, alignMeter: true, trail: 0.6, loopSound: true, palette: "spiral" };

function engineOf(polyrhythm: Partial<PolyrhythmSettings> = SPIRAL, seed = 7): PhysicsEngine {
  return createEngineForSettings(config, "polyrhythm", { ...base, polyrhythm }, seed);
}

interface TimedEvent {
  step: number;
  ev: SoundEvent;
}

/** Runs `steps` 60 Hz steps (in frames of `frameMs`), returning every sound event with the step count after it. */
function run(engine: PhysicsEngine, steps: number, frameMs = STEP): TimedEvent[] {
  const out: TimedEvent[] = [];
  const view = engine.getPolyrhythmView();
  const end = view.step + steps;
  while (view.step < end) {
    engine.update(frameMs, 0);
    for (const ev of engine.consumeSoundEvents()) out.push({ step: view.step, ev });
  }
  return out;
}

const ofKind = (events: TimedEvent[], kind: string) => events.filter((e) => e.ev.loop === kind);

/** |mean of e^{i·k·θ}| over the engine's balls, from their positions (the definition the meter stands for). */
function armsFoldFromBalls(engine: PhysicsEngine, arms: number): number {
  const g = engine.getPolyrhythmView().geometry!;
  let re = 0;
  let im = 0;
  const balls = engine.getBalls();
  for (const b of balls) {
    const theta = Math.atan2(b.y - g.cy, b.x - g.cx);
    re += Math.cos(arms * theta);
    im += Math.sin(arms * theta);
  }
  return Math.hypot(re, im) / balls.length;
}

/* ------------------------------------------------------------------ the meter */

describe("Phase Spiral: the in-line meter", () => {
  const series = buildTempoSeries(resolvePolyrhythmSettings({ count: 20, tempos: "harmonic", cycleSeconds: 20 }));
  const T = 20 * SPS;

  it("reads 100 % at t = 0 and t = T and under 20 % at T / 2 for 20 rings", () => {
    expect(inLineOf(series.a, series.D, 0, SPS)).toBe(1);
    expect(inLineOf(series.a, series.D, T, SPS)).toBeCloseTo(1, 12);
    expect(inLineOf(series.a, series.D, T / 2, SPS)).toBeLessThan(0.2);
    expect(inLineOf(series.a, series.D, 2 * T, SPS)).toBeCloseTo(1, 12);
    expect(inLinePercent(inLineOf(series.a, series.D, T, SPS))).toBe(100);
  });

  it("is 100 % only on the alignment: once a cycle, never at T / 3 (the arms do not straighten early)", () => {
    let full = 0;
    for (let s = 1; s <= T; s++) if (inLineOf(series.a, series.D, s, SPS) > 1 - 1e-9) full++;
    expect(full).toBe(1);
    expect(inLineOf(series.a, series.D, T / 3, SPS)).toBeLessThan(0.2);
    expect(inLineOf(series.a, series.D, (2 * T) / 3, SPS)).toBeLessThan(0.2);
  });

  it("is the arms-fold resultant of the dot angles (the spokes count as 100 %)", () => {
    for (const arms of [1, 3, 5]) {
      const engine = engineOf({ ...SPIRAL, arms, loopSound: false });
      for (const steps of [0, 97, 300, 600, 1150, 1199, 1200]) {
        run(engine, steps - engine.getPolyrhythmView().step);
        expect([arms, steps, armsFoldFromBalls(engine, arms)]).toEqual([arms, steps, expect.closeTo(engine.getPolyrhythmView().inLine, 9)]);
      }
    }
  });

  it("finds its upward crossings of 50, 75 and 90 %", () => {
    expect(ALIGN_PROGRESS_THRESHOLDS).toEqual([0.5, 0.75, 0.9]);
    const out: number[] = [];
    expect(progressCrossings(0.4, 0.8, out)).toEqual([0, 1]);
    expect(progressCrossings(0.89, 0.95, out)).toEqual([2]);
    expect(progressCrossings(0.95, 0.4, out)).toEqual([]);
    expect(progressCrossings(0.5, 0.5, out)).toEqual([]);
    expect(progressCrossings(0.2, 1, out)).toEqual([0, 1, 2]);
  });

  it("knows the step of the next alignment exactly", () => {
    // alignments every 1200 steps: from step 1100 the next one's step is 1200
    expect(stepsToNextAlignment(series.g, series.D, 1100, SPS)).toBe(100);
    expect(stepsToNextAlignment(series.g, series.D, 1199, SPS)).toBe(1);
    expect(stepsToNextAlignment(series.g, series.D, 1200, SPS)).toBe(1200);
    expect(stepsToNextAlignment(series.g, series.D, 0, SPS)).toBe(1200);
    // a cycle that is no whole number of steps: 3,4,5 per 2.5 s → every 2.5 s (150 steps), 7 voices per 0.7 s
    const odd = buildTempoSeries(resolvePolyrhythmSettings({ tempos: "custom", custom: "7,14", cycleSeconds: 1 }));
    expect(odd.alignSec).toBeCloseTo(1 / 7, 12);
    expect(stepsToNextAlignment(odd.g, odd.D, 0, SPS)).toBe(Math.floor(60 / 7));
  });
});

/* ------------------------------------------------------------------ the arms */

describe("Phase Spiral: arms", () => {
  it("arms = 3 triples the dots, one ball each, on the three spokes at the start", () => {
    const one = engineOf({ ...SPIRAL, arms: 1 });
    const three = engineOf();
    expect(one.getBalls()).toHaveLength(20);
    expect(three.getBalls()).toHaveLength(60);
    const v = three.getPolyrhythmView();
    expect([v.arms, v.dotCount, v.count]).toEqual([3, 60, 20]);
    const g = v.geometry!;
    for (let d = 0; d < 60; d++) {
      const a = Math.atan2(v.dotY[d] - g.cy, v.dotX[d] - g.cx);
      const spoke = (((a + Math.PI / 2) / ((2 * Math.PI) / 3)) % 1 + 1) % 1;
      expect(Math.min(spoke, 1 - spoke)).toBeLessThan(1e-9);
    }
  });

  it("steps one spoke a tick, so every dot is back on a spoke after a whole number of its ticks", () => {
    const series = buildTempoSeries(resolvePolyrhythmSettings({ count: 4, cycleSeconds: 2 }));
    // voice 1 ticks twice in 2 s: after 1 s it has ticked once and stands one spoke (a third of a turn) on
    expect(tickPhaseModArms(series.a[1], series.D, 60, SPS, 3)).toBeCloseTo(1, 12);
    expect(tickPhaseModArms(series.a[1], series.D, 180, SPS, 3)).toBeCloseTo(0, 12);
    expect(armAngle(-Math.PI / 2, 1, 0, 3, 1)).toBeCloseTo(-Math.PI / 2 + (2 * Math.PI) / 3, 12);
    expect(armAngle(-Math.PI / 2, 0, 2, 3, -1)).toBeCloseTo(-Math.PI / 2 - (4 * Math.PI) / 3, 12);
    // one arm: the classic placement's phase (ticks modulo 1)
    for (const steps of [0, 17, 61, 599]) expect(tickPhaseModArms(series.a[3], series.D, steps, SPS, 1)).toBeCloseTo(tickPhaseMod2(series.a[3], series.D, steps, SPS) % 1, 12);
  });

  it("applies to the orbit layouts only, within the dot ceiling", () => {
    expect(effectiveArms("rings", 3, 20)).toBe(3);
    expect(effectiveArms("spiral", 4, 20)).toBe(4);
    expect(effectiveArms("arcs", 3, 20)).toBe(1);
    expect(effectiveArms("metronomes", 3, 20)).toBe(1);
    expect(effectiveArms("rings", 1000, 20)).toBe(DOT_CEILING / 20);
    expect(effectiveArms("rings", 7, 10000)).toBe(1);
    const engine = engineOf({ ...SPIRAL, arms: 4, layout: "arcs" });
    expect(engine.getBalls()).toHaveLength(20);
  });

  it("keeps the rhythm of the classic rings: the same ticks, alignments and chords with any arms", () => {
    const classic = { ...SPIRAL, arms: 1, loopSound: false };
    const a = engineOf(classic, 3);
    const b = engineOf({ ...classic, arms: 3 }, 3);
    const ea = run(a, 1300);
    const eb = run(b, 1300);
    expect(eb).toEqual(ea);
    const va = a.getPolyrhythmView();
    const vb = b.getPolyrhythmView();
    expect([vb.tickCount, vb.alignCount, vb.cyclesDone]).toEqual([va.tickCount, va.alignCount, va.cyclesDone]);
  });

  it("changes the arms, the palette and the meter live: the dots are built again, the rhythm carries on", () => {
    const engine = engineOf();
    run(engine, 200);
    const v = engine.getPolyrhythmView();
    const ticks = v.tickCount;
    engine.setPolyrhythmSettings({ arms: 5, palette: "rainbow", alignMeter: false });
    expect(v.dotCount).toBe(100);
    run(engine, 1);
    expect(engine.getBalls()).toHaveLength(100);
    expect(v.step).toBe(201);
    expect(v.tickCount).toBeGreaterThanOrEqual(ticks);
    const g = v.geometry!;
    for (const ball of engine.getBalls()) expect(Math.hypot(ball.x - g.cx, ball.y - g.cy)).toBeGreaterThan(0);
    expect(engine.getBalls()[0].color).toBe("hsl(0, 90%, 62%)");
    engine.setPolyrhythmSettings({ layout: "metronomes" });
    run(engine, 1);
    expect(engine.getBalls()).toHaveLength(20);
    engine.setPolyrhythmSettings({ layout: "rings", arms: 2 });
    run(engine, 1);
    expect(engine.getBalls()).toHaveLength(40);
  });

  it("leaves the meter its room under the disc", () => {
    const meter = engineOf();
    const plain = engineOf({ ...SPIRAL, alignMeter: false });
    const S = meter.getPolyrhythmView().geometry!.field.side;
    expect(meter.getPolyrhythmView().geometry!.outerRadius).toBeLessThanOrEqual(POLY_METER_OUTER_SHARE * S);
    expect(plain.getPolyrhythmView().geometry!.outerRadius).toBeGreaterThan(POLY_METER_OUTER_SHARE * S);
  });
});

// --- low-findings-2 --- the meter in the loop HUD: the rings keep the field; the phase spiral's words on the phase spiral only
describe("Phase Spiral: the meter's place and the loop HUD's words", () => {
  it("keeps the rings on the whole field when the loop HUD shows the meter (the canvas leaves it out under the disc)", () => {
    const S = engineOf().getPolyrhythmView().geometry!.field.side;
    const inHud = engineOf({ ...SPIRAL, meterInHud: true });
    const plain = engineOf({ ...SPIRAL, alignMeter: false });
    expect(inHud.getPolyrhythmView().geometry!.outerRadius).toBeCloseTo(plain.getPolyrhythmView().geometry!.outerRadius, 9);
    expect(inHud.getPolyrhythmView().geometry!.outerRadius).toBeGreaterThan(POLY_METER_OUTER_SHARE * S);
    expect([polyOuterShare({ alignMeter: true }), polyOuterShare({ alignMeter: true, meterInHud: true }), polyOuterShare({ alignMeter: false, meterInHud: false })]).toEqual([POLY_METER_OUTER_SHARE, POLY_OUTER_SHARE, POLY_OUTER_SHARE]);
    // the page's loop HUD decides it (only when on: the settings of a page without it are as before), live too
    expect(polyrhythmSettingsOf({ ...defaultSettings("polyrhythm"), loopHud: true }).meterInHud).toBe(true);
    expect("meterInHud" in polyrhythmSettingsOf(defaultSettings("polyrhythm"))).toBe(false);
    const live = engineOf();
    const before = live.getPolyrhythmView().geometry!.outerRadius;
    live.setPolyrhythmSettings({ meterInHud: true });
    run(live, 1);
    expect(live.getPolyrhythmView().geometry!.outerRadius).toBeGreaterThan(before);
    live.setPolyrhythmSettings({ meterInHud: false });
    run(live, 1);
    expect(live.getPolyrhythmView().geometry!.outerRadius).toBeCloseTo(before, 9);
  });

  it("puts the phase spiral's words on the phase spiral only: harmonic rings; any other layout or tempo series keeps the meter's counter", () => {
    expect(loopHudModeText("polyrhythm", { prLayout: "rings", prTempos: "harmonic" })).toEqual(LOOP_HUD_MODE_TEXT.polyrhythm);
    for (const [prLayout, prTempos] of [["arcs", "harmonic"], ["metronomes", "harmonic"], ["spiral", "harmonic"], ["rings", "arithmetic"], ["rings", "custom"]]) {
      expect(isPhaseSpiralPage({ prLayout, prTempos }), `${prLayout} ${prTempos}`).toBe(false);
      expect(loopHudModeText("polyrhythm", { prLayout, prTempos }), `${prLayout} ${prTempos}`).toEqual({ counter: LOOP_HUD_MODE_TEXT.polyrhythm!.counter });
    }
    // the page's defaults are the phase spiral; the other modes' words do not depend on the polyrhythm fields
    expect(isPhaseSpiralPage(defaultSettings("polyrhythm"))).toBe(true);
    expect(loopHudModeText("hoops", { prLayout: "arcs", prTempos: "custom" })).toEqual(LOOP_HUD_MODE_TEXT.hoops);
    expect(loopHudModeText("classic", { prLayout: "arcs" })).toBeUndefined();
    // the caption follows the same test
    expect(loopCaptionContext({ mode: "polyrhythm", recordingDuration: 20, prLayout: "arcs", prTempos: "harmonic", prCount: 20 } as never).hookKey).not.toBe("phaseSpiral");
    expect(loopCaptionContext({ mode: "polyrhythm", recordingDuration: 20, prLayout: "rings", prTempos: "harmonic", prCount: 20 } as never).hookKey).toBe("phaseSpiral");
  });
});

/* ------------------------------------------------------------------ one cycle */

describe("Phase Spiral: one cycle", () => {
  it("straightens once a cycle: one alignment (with its chord) after the start's, three crossings and their risers on the way up", () => {
    const engine = engineOf();
    const v = engine.getPolyrhythmView();
    // the frame after 1200 steps shows the spokes exactly (t = T); the step from T sounds the alignment, as the first step did
    let events = run(engine, 1200);
    expect(v.inLine).toBeCloseTo(1, 12);
    expect(v.alignCount).toBe(1);
    events = events.concat(run(engine, 1));
    expect(v.alignCount).toBe(2); // the start and the end of the cycle
    expect(v.progressCrossings).toBe(3);
    expect(v.inLine).toBeCloseTo(1, 3);
    const chords = ofKind(events, "chord");
    expect(chords.map((e) => e.step)).toEqual([1, 1201]);
    for (const c of chords) expect(c.ev.frequency).toBe(PS_CHORD_HZ);
    const risers = ofKind(events, "riser");
    expect(risers).toHaveLength(3);
    // each riser stops exactly as the alignment's chord starts (the step from T), and they rise from the root's harmonics
    for (const r of risers) expect(r.step - 1 + Math.round(r.ev.loopSec! * SPS)).toBe(1200);
    expect(risers.map((r) => r.ev.frequency)).toEqual(PS_RISER_FROM.map((f) => PS_CHORD_HZ * f));
    expect(risers.every((r) => r.ev.loopSec! > 0 && r.ev.loopSec! < 3)).toBe(true);
  });

  it("plucks every tick in A major pentatonic inside C3–C6, at most six a step at 1/√n, the inner rings low", () => {
    const engine = engineOf();
    const events = run(engine, 1200);
    const plucks = ofKind(events, "pluck");
    expect(plucks.length).toBeGreaterThan(100);
    const perStep = new Map<number, number>();
    for (const { step, ev } of plucks) {
      perStep.set(step, (perStep.get(step) ?? 0) + 1);
      const midi = Math.round(frequencyToMidi(ev.frequency!));
      expect(inLoopScale(midi, PS_ROOT_MIDI, "majorPentatonic")).toBe(true);
      expect(ev.frequency!).toBeGreaterThanOrEqual(130);
      expect(ev.frequency!).toBeLessThanOrEqual(1050);
      expect(ev.level!).toBeLessThanOrEqual(1);
      expect(ev.melody).toBe(false);
      expect(ev.type).toBe("hit");
    }
    for (const n of perStep.values()) expect(n).toBeLessThanOrEqual(PS_PLUCKS_PER_STEP);
    // the downbeat: every ring at once → six plucks spread over the span, each at 1/√6 of its velocity
    const first = plucks.filter((p) => p.step === 1);
    expect(first).toHaveLength(6);
    expect(first[0].ev.frequency).toBeCloseTo(phaseSpiralPitch(0, 20), 9);
    expect(first[5].ev.frequency).toBeCloseTo(phaseSpiralPitch(19, 20), 9);
    expect(first[5].ev.level).toBeCloseTo(1 / Math.sqrt(6), 9);
    expect(phaseSpiralPitch(0, 20)).toBeLessThan(phaseSpiralPitch(19, 20));
    expect(phaseSpiralDegree(19, 20)).toBe(PS_SPAN);
    // no instrument note: every event is a loop voice
    expect(events.every((e) => !!e.ev.loop)).toBe(true);
  });

  it("picks at most six plucks evenly, keeping the lowest and the highest", () => {
    const level = new Float64Array(12).fill(1);
    expect(pickPluckDegrees(level, [])).toEqual([0, 2, 4, 7, 9, 11]);
    level.fill(0);
    level[3] = 0.9;
    level[8] = 1;
    expect(pickPluckDegrees(level, [])).toEqual([3, 8]);
  });

  it("keeps the instrument's notes without the loop sounds (the classic events, no loop voices)", () => {
    const events = run(engineOf({ ...SPIRAL, loopSound: false }), 1200);
    expect(events.every((e) => !e.ev.loop && e.ev.type === "hit")).toBe(true);
    expect(events[0].ev.accent).toBe(true);
  });

  it("schedules the loop sounds on the context's clock through ToneGenerator.playLoop (the fake Web Audio graph)", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    const events = run(engineOf(), 1201);
    let last = -1;
    for (const { step, ev } of events) {
      if (step !== last) {
        graph.ctx.currentTime = step / SPS;
        last = step;
      }
      playSoundEvent(tone, ev, () => undefined);
    }
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    // the closing chord's root with the alignment's step (heard with the step from T, as the downbeat with the first step)
    expect(graph.oscillators.some((o) => near(o.startAt, 1201 / SPS) && Math.abs(o.frequency - PS_CHORD_HZ) < 0.01)).toBe(true);
    // every riser's glide lands two octaves up exactly when the chord starts
    for (const { ev } of ofKind(events, "riser")) {
      const ramp = graph.ramps.find((r) => r.kind === "exp" && r.param === "frequency" && Math.abs(r.value - 4 * ev.frequency!) < 1e-6);
      expect(ramp?.time).toBeCloseTo(1201 / SPS, 9);
    }
    // the plucks of the downbeat sound at their step's time
    for (const { step, ev } of ofKind(events, "pluck").filter((p) => p.step === 1)) expect(graph.oscillators.some((o) => near(o.startAt, step / SPS) && Math.abs(o.frequency - ev.frequency!) < 1e-6)).toBe(true);
  });
});

/* ------------------------------------------------------------------ the loop, fingerprints, determinism */

describe("Phase Spiral: the loop", () => {
  it("is a seamless loop when endless: the cycle, its seams, and a whole-loop cut of a recording", () => {
    const engine = engineOf();
    expect(engine.getCycleSeconds()).toBeCloseTo(20, 12);
    expect(engine.getLoopSeams()).toEqual({ count: 0, lastMs: -1, nextMs: 20000 });
    run(engine, 1200);
    expect(engine.getLoopSeams()).toEqual({ count: 0, lastMs: -1, nextMs: 20000 }); // this frame shows the seam
    run(engine, 1);
    expect(engine.getLoopSeams()).toEqual({ count: 1, lastMs: 20000, nextMs: 40000 });
    // a 45 s recording at 30 fps keeps two whole loops (40 s)
    const rec = engineOf();
    const cut = new WholeLoopCut(45, 1 / 30);
    let frames = 0;
    for (;;) {
      if (cut.frame(frames / 30, rec.getElapsedMs(), rec.getLoopSeams()) === "stop") break;
      frames++;
      rec.update(1000 / 30, 0);
      rec.consumeSoundEvents();
    }
    expect(cut.cutOnSeam).toBe(true);
    expect(frames / 30).toBeCloseTo(40, 6);
    // a run with cycles ends instead of looping
    expect(engineOf({ ...SPIRAL, cycles: 1 }).getLoopSeams()).toBeNull();
    expect(engineOf({ ...SPIRAL, cycles: 1 }).getCycleSeconds()).toBeNull();
  });

  it("loops on the visible period of every layout", () => {
    const series = buildTempoSeries(resolvePolyrhythmSettings({ count: 6, cycleSeconds: 4 }));
    expect(polyLoopPeriod(series, "rings", false, 0).sec).toBeCloseTo(4, 12);
    expect(polyLoopPeriod(series, "spiral", false, 0).sec).toBeCloseTo(4, 12);
    expect(polyLoopPeriod(series, "arcs", false, 0).sec).toBeCloseTo(8, 12);
    expect(polyLoopPeriod(series, "metronomes", false, 0).sec).toBeCloseTo(8, 12);
    expect(polyLoopPeriod(series, "rings", false, 4).sec).toBeCloseTo(16, 12);
    const custom = buildTempoSeries(resolvePolyrhythmSettings({ tempos: "custom", custom: "2,4,6", cycleSeconds: 4 }));
    expect(polyLoopPeriod(custom, "rings", false, 0).sec).toBeCloseTo(2, 12);
    expect(polyLoopPeriod(custom, "rings", true, 0).sec).toBeCloseTo(4, 12);
    const p = polyLoopPeriod(series, "rings", false, 0);
    expect([seamsBefore(p, series.D, 0, SPS), seamsBefore(p, series.D, 240, SPS), seamsBefore(p, series.D, 241, SPS), seamsBefore(p, series.D, 480, SPS)]).toEqual([0, 0, 1, 1]);
  });

  it("replays the first cycle exactly: the state at a seam is the start's", () => {
    const engine = engineOf();
    const v = engine.getPolyrhythmView();
    const start = { x: Array.from(v.dotX), y: Array.from(v.dotY), inLine: v.inLine };
    run(engine, 1200);
    // the dots of a ring are interchangeable: the same set of positions (each ring's dots stepped whole spokes)
    const sorted = (xs: number[], ys: number[]) => xs.map((x, i) => `${x.toFixed(6)},${ys[i].toFixed(6)}`).sort();
    expect(sorted(Array.from(v.dotX), Array.from(v.dotY))).toEqual(sorted(start.x, start.y));
    expect(v.inLine).toBeCloseTo(start.inLine, 9);
  });

  it("is pinned at 30, 60 and 120 frames a second and deterministic for a seed (the seed picks the turning direction)", () => {
    const fingerprint = (frameMs: number, seed = 7) => {
      const engine = engineOf(SPIRAL, seed);
      const events = run(engine, 900, frameMs);
      const v = engine.getPolyrhythmView();
      return { step: v.step, ticks: v.tickCount, crossings: v.progressCrossings, inLine: v.inLine.toFixed(12), x: Array.from(v.dotX.slice(0, 9), (n) => n.toFixed(9)), events: events.length, direction: v.direction };
    };
    const at60 = fingerprint(STEP);
    expect(fingerprint(1000 / 30)).toEqual(at60);
    expect(fingerprint(1000 / 120)).toEqual(at60);
    expect(fingerprint(STEP)).toEqual(at60);
    const directions = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => fingerprint(STEP, seed).direction));
    expect(directions).toEqual(new Set([-1, 1]));
  });

  it("allocates no new dot arrays while it runs", () => {
    const engine = engineOf();
    const v = engine.getPolyrhythmView();
    const arrays = [v.dotX, v.dotY, v.dotParam];
    run(engine, 300);
    expect([v.dotX, v.dotY, v.dotParam]).toEqual(arrays);
    expect(v.dotX).toBe(arrays[0]);
  });
});

/* ------------------------------------------------------------------ the picture, the HUD, the caption */

describe("Phase Spiral: the picture and the HUD", () => {
  it("draws comet tails as long as the trail, the classic 0.18 s by default", () => {
    expect(DEFAULT_TRAIL_SEC).toBe(0.18);
    // the classic tail: what the dot travels in 0.18 s, at most 70°
    expect(tailArc(0.5, 1, 0.18)).toBeCloseTo(2 * Math.PI * 0.5 * 0.18, 12);
    expect(tailArc(5, 1, 0.18)).toBeCloseTo(1.2, 12);
    expect(TAIL_RAD_PER_SEC * 0.18).toBeCloseTo(1.2, 12);
    // k arms: the dot moves a k-th as far, and never reaches the previous arm
    expect(tailArc(0.5, 3, 0.6)).toBeCloseTo((2 * Math.PI * 0.5 * 0.6) / 3, 12);
    expect(tailArc(50, 3, 1)).toBeCloseTo((0.9 * 2 * Math.PI) / 3, 12);
    expect(tailArc(1, 1, 0)).toBe(0);
  });

  it("paints the disc, the spokes, the tails, every dot and the meter (on the fake canvas)", () => {
    const engine = engineOf();
    run(engine, 400);
    const view = engine.getPolyrhythmView();
    const canvas = fakeCanvas(800, 800);
    const ctx = canvas.ctx as unknown as CanvasRenderingContext2D;
    const options = { wallColor: () => "#ffffff", wallThickness: 2, showGlow: true, inLineLabel: (pct: number) => `in line ${pct}%` };
    drawPolyrhythmStage(ctx, view, options);
    drawPolyrhythmVoices(ctx, view, options);
    const texts = canvas.ctx.calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    expect(texts).toContain(`in line ${inLinePercent(view.inLine)}%`);
    const arcs = canvas.ctx.calls.filter((c) => c.name === "arc").length;
    // 60 bodies + 60 glows + 60 × 4 tail bands + 20 rings + the disc at least
    expect(arcs).toBeGreaterThanOrEqual(60 + 60 + 240 + 20 + 1);
    // the meter moves into the loop HUD while it is on
    const hud = fakeCanvas(800, 800);
    drawPolyrhythmVoices(hud.ctx as unknown as CanvasRenderingContext2D, view, { ...options, meterInHud: true });
    expect(hud.ctx.calls.filter((c) => c.name === "fillText")).toHaveLength(0);
    const meter = fakeCanvas(800, 800);
    drawInLineMeter(meter.ctx as unknown as CanvasRenderingContext2D, view);
    expect(meter.ctx.calls.filter((c) => c.name === "fillRect")).toHaveLength(2);
  });

  it("counts \"in line N%\" in the loop HUD with a bar under it, none with the meter off", () => {
    const engine = engineOf();
    run(engine, 600);
    const v = engine.getPolyrhythmView();
    const count = loopHudCount(engine);
    expect(count).toMatchObject({ count: inLinePercent(v.inLine), bar: v.inLine });
    const keys = LOOP_HUD_MODE_TEXT.polyrhythm!;
    const frame = loopHudFrame({ title: en.LoopHud[keys.title as keyof typeof en.LoopHud], subtitle: en.LoopHud[keys.subtitle as keyof typeof en.LoopHud], counter: String(en.LoopHud[keys.counter as keyof typeof en.LoopHud]), light: false }, count);
    expect(frame.title).toBe("each ring gains one lap on the next");
    expect(frame.counter).toBe(`in line ${inLinePercent(v.inLine)}%`);
    expect(frame.bar).toBeCloseTo(v.inLine, 12);
    const canvas = fakeCanvas(1080, 1920);
    drawLoopHud(canvas.ctx as unknown as CanvasRenderingContext2D, 1080, frame, loopHudLayout(1080, 1920));
    expect(canvas.ctx.calls.filter((c) => c.name === "fillRect")).toHaveLength(2);
    engine.setPolyrhythmSettings({ alignMeter: false });
    expect(loopHudCount(engine)).toBeNull();
    // the other modes' counters are untouched
    expect(loopHudCount({ getCurrentModeName: () => "classic", getGrowView: () => ({ bounces: 3 }) })).toBeNull();
  });

  it("captions the rings in the loop style: a number-led hook, the fact, the topic tags", () => {
    const s = { ...defaultSettings("polyrhythm"), ...PHASE_SPIRAL_PRESET };
    const ctx = loopCaptionContext(s);
    expect(ctx).toEqual({ mode: "polyrhythm", hookKey: "phaseSpiral", factKey: "phaseSpiralFact", count: 20 });
    const post = loopCaption({ mode: "polyrhythm", hook: en.LoopCaption.phaseSpiral, count: ctx.count, fact: en.LoopCaption.phaseSpiralFact });
    expect(post.caption.startsWith("20 rings, each gaining one lap on the next: watch the spiral straighten into one line 🔊")).toBe(true);
    expect(post.hashtags).toBe("#satisfying #oddlysatisfying #math #polyrhythm #creativecoding");
    const arcs: SimulatorSettings = { ...s, prLayout: "arcs" };
    expect(loopCaptionContext(arcs).hookKey).toBe("seconds");
  });

  it("colours the spiral palette cool inside and warm outside", () => {
    expect(spiralColor(0, 20)).toBe("hsl(215, 92%, 60%)");
    expect(spiralColor(19, 20)).toBe("hsl(350, 92%, 60%)");
    const engine = engineOf();
    expect(engine.getBalls()[0].color).toBe("hsl(215, 92%, 60%)");
  });
});

/* ------------------------------------------------------------------ settings and translations */

describe("Phase Spiral: settings", () => {
  it("defaults to the classic rings (one arm, no meter, the classic tails, the instrument, the rainbow) in every mode", () => {
    expect(DEFAULT_PHASE_SPIRAL_SETTINGS).toEqual({ arms: 1, alignMeter: false, trail: 0.18, loopSound: false, palette: "rainbow" });
    expect(DEFAULT_POLYRHYTHM_SETTINGS).toMatchObject(DEFAULT_PHASE_SPIRAL_SETTINGS);
    for (const mode of ["classic", "polyrhythm", "hoops"] as const) expect(defaultSettings(mode)).toMatchObject({ prArms: 1, prAlignMeter: false, prTrail: 0.18, prLoopSound: false, prPalette: "rainbow" });
    expect(RANGES.prArms).toEqual({ min: 1, max: 8, step: 1 });
    expect(RANGES.prTrail).toEqual({ min: 0, max: 1, step: 0.02 });
  });

  it("resolves whole arms from 1 up (no maximum but the memory ceiling), a trail from 0 up, real booleans and a known palette", () => {
    expect(resolvePhaseSpiralSettings({ arms: 2.6, trail: -1, alignMeter: "yes" as unknown as boolean, palette: "neon" as unknown as "spiral" })).toEqual({ ...DEFAULT_PHASE_SPIRAL_SETTINGS, arms: 3, trail: 0 });
    expect(resolvePhaseSpiralSettings({ arms: 0 }).arms).toBe(1);
    expect(resolvePhaseSpiralSettings({ arms: 64, trail: 7.5 })).toMatchObject({ arms: 64, trail: 7.5 });
    expect(resolvePhaseSpiralSettings({ arms: 1e9 }).arms).toBe(MEMORY_CEILINGS.prArms);
    expect(memoryCeiling("prArms", 1e9)).toBe(MEMORY_CEILINGS.prArms);
    expect(resolvePhaseSpiralSettings({ arms: Number.NaN }).arms).toBe(1);
    expect(resolvePolyrhythmSettings({ arms: 3, palette: "spiral" })).toMatchObject({ arms: 3, palette: "spiral", count: 16 });
  });

  it("round-trips through the URL keys (prar, prm, prtl, prls, prco), skipping the defaults", () => {
    const s: SimulatorSettings = { ...defaultSettings("polyrhythm"), prArms: 3, prAlignMeter: true, prTrail: 0.6, prLoopSound: true, prPalette: "spiral", prCycles: 0, prCount: 20 };
    const params = settingsToSearchParams(s);
    expect([params.get("prar"), params.get("prm"), params.get("prtl"), params.get("prls"), params.get("prco")]).toEqual(["3", "1", "0.6", "1", "spiral"]);
    expect(settingsFromSearchParams(params)).toEqual(s);
    const defaults = settingsToSearchParams(defaultSettings("polyrhythm"));
    for (const key of ["prar", "prm", "prtl", "prls", "prco"]) expect(defaults.has(key)).toBe(false);
    // past the slider: kept exactly
    const big = settingsFromSearchParams(new URLSearchParams("mode=polyrhythm&prar=24&prtl=3.5"));
    expect([big.prArms, big.prTrail]).toEqual([24, 3.5]);
    // invalid: back to the defaults
    const bad = settingsFromSearchParams(new URLSearchParams("mode=polyrhythm&prar=-3&prtl=x&prm=maybe&prls=2&prco=neon"));
    expect([bad.prArms, bad.prTrail, bad.prAlignMeter, bad.prLoopSound, bad.prPalette]).toEqual([1, 0.18, false, false, "rainbow"]);
    const fields = { prArms: 1, prAlignMeter: false, prTrail: 0.18, prLoopSound: false, prPalette: "rainbow" as const };
    const p = new URLSearchParams();
    writePhaseSpiralParams({ ...fields, prArms: 5 }, fields, p);
    const back = { ...fields };
    readPhaseSpiralParams(p, back);
    expect(back.prArms).toBe(5);
  });

  it("restores from presets (validated) and the preset is the account's clip", () => {
    const preset = presetToSettings({ mode: "polyrhythm", ...PHASE_SPIRAL_PRESET } as Partial<SimulatorSettings>);
    expect(preset).toMatchObject({ prCount: 20, prArms: 3, prCycleSeconds: 20, prCycles: 0, prAlignMeter: true, prLoopSound: true, prPalette: "spiral", loopHud: true });
    const broken = presetToSettings({ mode: "polyrhythm", prArms: "many", prPalette: 7, prTrail: -2 } as unknown as Partial<SimulatorSettings>);
    expect([broken.prArms, broken.prPalette, broken.prTrail]).toEqual([1, "rainbow", 0]);
  });

  it("lists its controls for the search box and the command palette", () => {
    for (const key of PHASE_SPIRAL_KEYS) {
      expect(POLYRHYTHM_KEYS).toContain(key);
      expect(MODE_BLOCK_KEYS.polyrhythm).toContain(key);
    }
  });

  it("has every word in English, Polish and Spanish", () => {
    const keys = ["prSpiralDesc", "prSpiralPreset", "prSpiralPresetTip", "prSpiralPresetButton", "prArms", "prArmsTip", "prAlignMeter", "prAlignMeterTip", "prTrail", "prTrailTip", "prLoopSound", "prLoopSoundTip", "prPalette", "prPaletteTip", "prPaletteRainbow", "prPaletteSpiral"];
    for (const catalog of [en, pl, es] as unknown as Record<string, Record<string, string>>[]) {
      for (const key of keys) expect(typeof catalog.Controls[key], key).toBe("string");
      expect(catalog.Simulator.canvasPolyrhythmInLine).toContain("[count]");
      expect(catalog.LoopHud.polyrhythmCounter).toContain("{count}");
      expect(catalog.LoopCaption.phaseSpiral).toContain("{count}");
      expect(typeof catalog.LoopCaption.phaseSpiralFact).toBe("string");
    }
    expect(Object.keys(pl.Controls).sort()).toEqual(Object.keys(en.Controls).sort());
    expect(Object.keys(es.Controls).sort()).toEqual(Object.keys(en.Controls).sort());
  });
});
