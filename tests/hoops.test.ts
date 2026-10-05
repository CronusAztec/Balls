import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { fakeGraph } from "./fakeAudio";
import { fakeCanvas } from "./fakeCanvas";
import {
  DEFAULT_HOOPS_SETTINGS,
  HOOPS_LIFT_RAD,
  HOOPS_MIN_SUBSTEPS,
  HOOPS_RAMP_SHAPES,
  HOOPS_SETTLE_SEC,
  HOOPS_SOUND_KINDS,
  HOOPS_CHORD_HZ,
  HOOPS_CHIME_LEVELS,
  beadAccel,
  beadRest,
  beadRk4,
  criticalTurns,
  equilibriumAngle,
  hoopBarFrequency,
  hoopChimeFrequency,
  hoopHue,
  hoopRadii,
  hoopsSchedule,
  hoopsSubsteps,
  rampShare,
  rampShareIntegral,
  resolveHoopsSettings,
  schedulePhase,
  scheduleSpeed,
  scheduleTurns,
  speedShare,
  type HoopsRampShape,
  type HoopsSettings,
} from "@/lib/physics/modes/hoops";
import { DEFAULT_HOOPS_FIELDS, HOOPS_LOOK, HOOPS_PRESETS, HOOPS_URL_KEYS, hoopsClipSec, hoopsPresetFields, hoopsSettingsOf, readHoopsParams, resolveHoopsFields, writeHoopsParams, type HoopsFields } from "@/lib/physics/hoopsFields";
import { HOOPS_DATA_KEYS, HoopsLayer, hoopsBeadAngle, hoopsExtentPx, hoopsFrameAt, hoopsRenderTimeMs } from "@/components/simulator/hoopsRenderer";
import { HOOPS_KEYS, hoopsLiftRange } from "@/components/simulator/sections/HoopsSection";
import { MODE_BLOCK_KEYS } from "@/components/simulator/panelKeys";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS, TWO_PI, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { MEMORY_CEILINGS, memoryCeiling } from "@/lib/uncap";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, fixedRunDurationSec, runNeverFinishes, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, hoopsOutcomeSettled, outcomeFigure, outcomeMatches, outcomeMiss, type FinderOutcome, type RunSummary } from "@/lib/simulation/outcomes";
import { LOOP_HUD_MODE_TEXT, hudNumber, loopHudCount, loopHudFrame } from "@/lib/loop/hud";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { hasMentionOrCta, loopCaption, loopCaptionContext } from "@/lib/publish/loopCaption";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- bead-hoops --- Spinning Hoops (lib/physics/modes/hoops.ts, hoopsFields.ts, components/simulator/hoopsRenderer.ts): the
 * bead's equation (stable bottom below the critical spin, the balance point arccos(g / (R ω²)) above it), the lift order
 * (outermost first), the closed-form spin schedule (whole turns a cycle, the mirrored return), the RK4 sub-steps and the
 * fingerprints pinned at 30, 60 and 120 frames a second, the sound events and their scheduling on the fake Web Audio graph
 * (tests/fakeAudio.ts), the loop contract and the HUD counter, Find Simulation's outcomes, the settings (URL, presets, uncapped
 * numbers, the memory ceiling) and the translations.
 */

// The section's TSX is compiled with the classic JSX transform here: React must be global.
(globalThis as { React?: unknown }).React = React;

afterEach(() => vi.unstubAllGlobals());

const STEP = 1000 / 60;
const config: PhysicsConfig = { width: 800, height: 800, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };

function engineOf(hoops: Partial<HoopsSettings> = {}, seed = 7, size: Partial<PhysicsConfig> = {}): PhysicsEngine {
  return createEngineForSettings({ ...config, ...size }, "hoops", { ...base, hoops }, seed);
}

interface TimedEvent {
  t: number;
  ev: SoundEvent;
}

/** Runs `engine` for `seconds` in steps of `frameMs`, returning every sound event with the simulation time it came at (s). */
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

/* ------------------------------------------------------------------ the bead's equation */

describe("Spinning Hoops: the bead on a spinning hoop", () => {
  const g = 9.81;

  it("has the textbook critical spin √(g/R) and balance point arccos(g/(Rω²)), 0 at or below the critical spin", () => {
    expect(criticalTurns(g, 0.9)).toBeCloseTo(Math.sqrt(g / 0.9) / TWO_PI, 12);
    expect(criticalTurns(g, 0.9)).toBeCloseTo(0.5255, 3);
    expect(criticalTurns(g, 0.3)).toBeCloseTo(0.91, 2);
    // bigger hoops have the lower critical spin
    expect(criticalTurns(g, 0.9)).toBeLessThan(criticalTurns(g, 0.6));
    expect(criticalTurns(g, 0)).toBe(Infinity);
    const wc = Math.sqrt(g / 0.5);
    expect(equilibriumAngle(g, 0.5, 0.99 * wc)).toBe(0);
    expect(equilibriumAngle(g, 0.5, wc)).toBe(0);
    expect(equilibriumAngle(g, 0.5, 2 * wc)).toBeCloseTo(Math.acos(0.25), 12);
    // the balance point is a root of the equation without the tilt: ω² sin θ cos θ = (g/R) sin θ
    const w = 1.7 * wc;
    const theta = equilibriumAngle(g, 0.5, w);
    expect(beadAccel(theta, 0, w, g / 0.5, 0, 1)).toBeCloseTo(0, 12);
  });

  it("below the critical spin a nudged bead stays within 1e-6 of the bottom (above it the same nudge runs away)", () => {
    for (const R of [0.3, 0.6, 0.9]) {
      const k = g / R;
      const wc = Math.sqrt(k);
      const out = { theta: 0, dot: 0 };
      for (const [factor, damping] of [[0.95, 0], [0.5, 0], [0.95, 1]] as const) {
        const w = factor * wc;
        let theta = 1e-7;
        let dot = 0;
        let worst = 0;
        for (let i = 0; i < 60 * 480; i++) {
          beadRk4(theta, dot, 1 / 480, w, w, w, k, 0, damping, out);
          theta = out.theta;
          dot = out.dot;
          worst = Math.max(worst, Math.abs(theta));
        }
        expect(worst, `R ${R}, ω ${factor} ω_c, c ${damping}`).toBeLessThanOrEqual(1e-6);
      }
      // past the critical spin the bottom is unstable: the same nudge grows past 1e-6 within seconds
      let theta = 1e-7;
      let dot = 0;
      let grew = false;
      for (let i = 0; i < 20 * 480 && !grew; i++) {
        beadRk4(theta, dot, 1 / 480, 1.2 * wc, 1.2 * wc, 1.2 * wc, k, 0, 1, out);
        theta = out.theta;
        dot = out.dot;
        grew = Math.abs(theta) > 1e-6;
      }
      expect(grew, `R ${R}`).toBe(true);
    }
  });

  it("a whole run below every critical spin keeps the beads within 1e-6 of their bottoms (no tilt) and lifts none", () => {
    const engine = engineOf({ omegaEnd: 0.5, jitter: 0 });
    const v = engine.getHoopsView();
    let worst = 0;
    const events = run(engine, 30, STEP, () => {
      for (let i = 0; i < v.count; i++) worst = Math.max(worst, Math.abs(v.theta[i]));
    });
    expect(worst).toBeLessThanOrEqual(1e-6);
    expect(ofKind(events, "bar")).toHaveLength(0);
    expect([v.lifts, v.upCount]).toEqual([0, 0]);
  });

  it("above the critical spin a bead settles on arccos(g/(Rω²)) within 1e-3", () => {
    const out = { theta: 0, dot: 0 };
    for (const R of [0.3, 0.6, 0.9]) {
      const k = g / R;
      for (const factor of [1.2, 1.6, 3]) {
        const w = factor * Math.sqrt(k);
        let theta = 0.01;
        let dot = 0;
        for (let i = 0; i < 40 * 480; i++) {
          beadRk4(theta, dot, 1 / 480, w, w, w, k, 0, 1, out);
          theta = out.theta;
          dot = out.dot;
        }
        expect(Math.abs(theta - equilibriumAngle(g, R, w)), `R ${R}, ω ${factor} ω_c`).toBeLessThan(1e-3);
      }
    }
  });

  it("in a run held at the top spin every bead settles on its own balance point within 1e-3", () => {
    const engine = engineOf({ returnLoop: false, holdSec: 40, jitter: 1e-5, damping: 1 });
    const v = engine.getHoopsView();
    run(engine, 45);
    const radii = hoopRadii(8, 0.75, 0.25);
    const w = TWO_PI * DEFAULT_HOOPS_SETTINGS.omegaEnd;
    for (let i = 0; i < 8; i++) expect(Math.abs(Math.abs(v.theta[i]) - equilibriumAngle(g, radii[i], w)), `hoop ${i}`).toBeLessThan(1e-3);
    // a higher spin, a higher bead; the outer hoop's bead is the highest
    for (let i = 1; i < 8; i++) expect(Math.abs(v.theta[i])).toBeLessThan(Math.abs(v.theta[i - 1]));
    expect(v.upCount).toBe(8);
  });

  it("the tilt makes the bottom no fixed point: the rest sits on the tilt's side and solves the tilted equation", () => {
    const k = g / 0.6;
    for (const [w, tilt] of [[0.5 * Math.sqrt(k), 0.004], [1.5 * Math.sqrt(k), 0.004], [1.5 * Math.sqrt(k), -0.004], [2 * Math.sqrt(k), 0]] as const) {
      const rest = beadRest(k, w, tilt, 1);
      expect(Math.abs(beadAccel(rest, 0, w, k, tilt, 0))).toBeLessThan(1e-9);
      if (tilt !== 0) expect(Math.sign(rest)).toBe(Math.sign(tilt));
    }
    // below the critical spin: the small-angle lean α / (1 − ω²/(g/R)); above it: about the balance point
    expect(beadRest(k, 0.5 * Math.sqrt(k), 0.004, 1)).toBeCloseTo(0.004 / 0.75, 6);
    expect(beadRest(k, 2 * Math.sqrt(k), 0, -1)).toBeCloseTo(-Math.acos(0.25), 9);
  });

  it("lifts the beads outermost first: eight bars in strict size order on every seed, and the order survives the reset", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const engine = engineOf({}, seed);
      const v = engine.getHoopsView();
      const events = run(engine, 20);
      const bars = ofKind(events, "bar");
      expect(bars.map((b) => b.ev.wallIndex), `seed ${seed}`).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      for (let i = 1; i < bars.length; i++) expect(bars[i].t).toBeGreaterThan(bars[i - 1].t);
      expect([v.orderOk, v.orderDecided, v.firstLifts, [...v.liftOrder]]).toEqual([true, true, 8, [0, 1, 2, 3, 4, 5, 6, 7]]);
      // a lift needs the hoop past its critical spin (the bead 5° off its bottom)
      const sc = v.schedule;
      for (const bar of bars) expect(scheduleSpeed(sc, bar.t)).toBeGreaterThan(v.critical[bar.ev.wallIndex]);
    }
  });
});

/* ------------------------------------------------------------------ the spin's schedule */

describe("Spinning Hoops: the spin's schedule", () => {
  const settingsOf = (patch: Partial<HoopsSettings>) => resolveHoopsSettings({ ...DEFAULT_HOOPS_SETTINGS, ...patch });

  it("a cycle is the ramp, the top hold (stretched by less than a turn), the mirrored return and the rest: whole turns", () => {
    const sc = hoopsSchedule(DEFAULT_HOOPS_SETTINGS);
    expect([sc.up, sc.down, sc.settle, sc.loop]).toEqual([12, 6, HOOPS_SETTLE_SEC, true]);
    expect(sc.hold).toBeGreaterThanOrEqual(2);
    expect(sc.hold).toBeLessThan(2 + 1 / sc.b);
    expect(sc.cycle).toBeCloseTo(sc.up + sc.hold + sc.down + sc.settle, 12);
    expect(sc.cycle).toBeCloseTo(23.2, 9);
    expect(Number.isInteger(sc.turns)).toBe(true);
    expect(scheduleTurns(sc, sc.cycle)).toBeCloseTo(sc.turns, 9);
    for (const shape of HOOPS_RAMP_SHAPES) {
      for (const patch of [{}, { omegaStart: 0.4, omegaEnd: 2.1, rampSec: 7.3, returnSec: 3.1, holdSec: 0 }, { omegaStart: 1.5, omegaEnd: 0.6 }] as Partial<HoopsSettings>[]) {
        const s = hoopsSchedule(settingsOf({ ...patch, rampShape: shape }));
        expect(Math.abs(scheduleTurns(s, s.cycle) - Math.round(scheduleTurns(s, s.cycle))), `${shape} ${JSON.stringify(patch)}`).toBeLessThan(1e-9);
      }
    }
  });

  it("the turns are the integral of the spin, and the spin is continuous across the phases", () => {
    for (const shape of HOOPS_RAMP_SHAPES) {
      const sc = hoopsSchedule(settingsOf({ rampShape: shape }));
      const h = 1e-4;
      for (let t = 0.05; t < sc.cycle - 0.05; t += 0.137) {
        const numeric = (scheduleTurns(sc, t + h) - scheduleTurns(sc, t - h)) / (2 * h);
        expect(Math.abs(numeric - scheduleSpeed(sc, t)), `${shape} at ${t.toFixed(3)} s`).toBeLessThan(2e-3);
      }
      for (const edge of [sc.up, sc.up + sc.hold, sc.up + sc.hold + sc.down]) expect(Math.abs(scheduleSpeed(sc, edge - 1e-7) - scheduleSpeed(sc, edge + 1e-7)), `${shape} at ${edge}`).toBeLessThan(1e-4);
      expect(scheduleSpeed(sc, 0)).toBeCloseTo(sc.a, 12);
      expect(scheduleSpeed(sc, sc.up)).toBeCloseTo(sc.b, 9);
      expect(scheduleSpeed(sc, sc.cycle - 0.01)).toBeCloseTo(sc.a, 12);
      expect(rampShareIntegral(shape, 1, 8, 0.03)).toBeGreaterThan(0);
      // the closed-form integral against a Riemann sum
      let sum = 0;
      for (let i = 0; i < 20000; i++) sum += rampShare(shape, (i + 0.5) / 20000, 8, 0.03) / 20000;
      expect(rampShareIntegral(shape, 1, 8, 0.03)).toBeCloseTo(sum, 6);
    }
  });

  it("ramps in as many equal steps as there are hoops, and mirrors the ramp on the return", () => {
    const steps = hoopsSchedule(settingsOf({ rampShape: "steps", count: 4 }));
    const plateaus = [0, 1, 2, 3].map((k) => scheduleSpeed(steps, ((k + 0.5) / 4) * steps.up));
    expect(plateaus.map((p) => Math.round(p * 1e9) / 1e9)).toEqual([0, 1, 2, 3].map((k) => Math.round((steps.a + ((steps.b - steps.a) * k) / 4) * 1e9) / 1e9));
    const linear = hoopsSchedule(settingsOf({ rampSec: 10, returnSec: 5 }));
    const top = linear.up + linear.hold;
    for (const s of [0.5, 1.7, 3.2, 4.9]) expect(scheduleSpeed(linear, top + s)).toBeCloseTo(scheduleSpeed(linear, linear.up * (1 - s / linear.down)), 9);
    expect([schedulePhase(linear, 1), schedulePhase(linear, linear.up + 0.1), schedulePhase(linear, top + 0.1), schedulePhase(linear, linear.cycle - 0.1)]).toEqual(["up", "hold", "down", "settle"]);
    // without the return the run is the ramp and the hold, then it is done
    const once = hoopsSchedule(settingsOf({ returnLoop: false }));
    expect([once.loop, once.cycle, schedulePhase(once, once.cycle + 1)]).toEqual([false, 14, "done"]);
  });

  it("sub-steps by simulation time only: at least 8 a 60 Hz step, more for stiff hoops, never more than 256", () => {
    expect(hoopsSubsteps(1 / 60, 1)).toBe(HOOPS_MIN_SUBSTEPS);
    expect(hoopsSubsteps(2 / 60, 1)).toBe(2 * HOOPS_MIN_SUBSTEPS);
    expect(hoopsSubsteps(1 / 60, 300)).toBe(25);
    expect(hoopsSubsteps(1 / 60, 1e9)).toBe(256);
    expect(hoopsSubsteps(1 / 60, Infinity)).toBe(256);
    expect(hoopsSubsteps(0, 5)).toBe(1);
  });

  it("pins every run's fingerprint – the beads, the engine balls and the sounds – identical at 30, 60 and 120 frames a second", { timeout: 30_000 }, () => {
    function fnv(bytes: Uint8Array, h = 0x811c9dc5) {
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h;
    }
    function fingerprint(hoops: Partial<HoopsSettings>, frameMs: number, seconds: number, seed: number) {
      const engine = engineOf(hoops, seed);
      const kinds: string[] = [];
      for (const { ev } of run(engine, seconds, frameMs)) kinds.push(`${ev.loop}:${ev.wallIndex}`);
      const v = engine.getHoopsView();
      const state = new Float64Array([...Array.from(v.theta.subarray(0, v.count)), ...Array.from(v.thetaDot.subarray(0, v.count))]);
      const balls = new Float64Array(engine.getBalls().flatMap((b) => [b.x, b.y]));
      return { state: fnv(new Uint8Array(state.buffer)), balls: fnv(new Uint8Array(balls.buffer)), sounds: fnv(new TextEncoder().encode(kinds.join("|"))), counts: [v.lifts, v.settles, v.ticks, v.seams, v.upCount].join(","), order: v.liftOrder.join(",") };
    }
    const pinned: [Partial<HoopsSettings>, number, number, ReturnType<typeof fingerprint>][] = [
      [{}, 25, 7, { state: 352939752, balls: 1408551317, sounds: 1590370778, counts: "8,8,16,1,0", order: "" }],
      [{ count: 2, radiusMin: 0.4, rampShape: "steps" }, 25, 3, { state: 2416355523, balls: 1068521239, sounds: 804856254, counts: "2,2,12,1,0", order: "" }],
      [{ count: 1, radiusMax: 0.75, radiusMin: 0.75, rampSec: 20, rampShape: "ease", omegaEnd: 0.9, damping: 0.8 }, 12, 11, { state: 2606840233, balls: 1046182795, sounds: 1971007996, counts: "1,0,4,0,1", order: "0" }],
    ];
    for (const [hoops, seconds, seed, expected] of pinned) {
      expect(fingerprint(hoops, 1000 / 60, seconds, seed), `60 fps ${JSON.stringify(hoops)}`).toEqual(expected);
      expect(fingerprint(hoops, 1000 / 30, seconds, seed), `30 fps ${JSON.stringify(hoops)}`).toEqual(expected);
      expect(fingerprint(hoops, 1000 / 120, seconds, seed), `120 fps ${JSON.stringify(hoops)}`).toEqual(expected);
    }
  });

  it("degrades instead of blowing up: a stiff hoop past the sub-steps' reach rests on its balance point", () => {
    const engine = engineOf({ radiusMax: 1e-7, radiusMin: 1e-7, count: 3, gravity: 20, omegaEnd: 3 });
    const v = engine.getHoopsView();
    run(engine, 5);
    for (let i = 0; i < v.count; i++) expect(Number.isFinite(v.theta[i]) && Math.abs(v.theta[i]) < Math.PI).toBe(true);
    for (const ball of engine.getBalls()) expect(Number.isFinite(ball.x) && Number.isFinite(ball.y)).toBe(true);
  });
});

/* ------------------------------------------------------------------ sounds */

describe("Spinning Hoops: the sounds", () => {
  it("a cycle: a chime every turn, a bar per lift pitched by its hoop (bigger is lower), the chord when all are up, a pluck per settle, the cut and the glide that ends on the seam", () => {
    const engine = engineOf({ bed: true });
    const v = engine.getHoopsView();
    const sc = v.schedule;
    const events = run(engine, sc.cycle + 0.5);
    for (const { ev } of events) {
      expect(HOOPS_SOUND_KINDS).toContain(ev.loop);
      expect(ev.melody).toBe(false);
    }
    // the chime: once a turn – the cycle's start included, its end being the next cycle's start – pitched by the spin
    const chimes = ofKind(events, "chime").filter((e) => e.t <= sc.cycle + 1e-9);
    expect(chimes).toHaveLength(sc.turns);
    expect(chimes[0].t).toBeCloseTo(STEP / 1000, 12);
    expect(ofKind(events, "chime").filter((e) => e.t > sc.cycle)[0].t).toBeCloseTo(sc.cycle + STEP / 1000, 9);
    expect(chimes[0].ev.frequency).toBeLessThan(chimes[Math.floor(chimes.length / 2)].ev.frequency!);
    expect(hoopChimeFrequency(0)).toBeLessThan(hoopChimeFrequency(1));
    // the bars: one per hoop, outer (lowest) first, rising
    const bars = ofKind(events, "bar");
    expect(bars.map((b) => b.ev.wallIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const radii = hoopRadii(8, 0.75, 0.25);
    bars.forEach((b, i) => expect(b.ev.frequency).toBeCloseTo(hoopBarFrequency(radii[i], 0.25, 0.75, 8), 9));
    for (let i = 1; i < bars.length; i++) expect(bars[i].ev.frequency!).toBeGreaterThan(bars[i - 1].ev.frequency!);
    // the chord comes with the last lift, on G2
    const chords = ofKind(events, "chord");
    expect(chords).toHaveLength(1);
    expect(chords[0].t).toBe(bars[7].t);
    expect(chords[0].t).toBeCloseTo(v.firstAllUpMs / 1000, 9);
    expect(chords[0].ev.frequency).toBeCloseTo(HOOPS_CHORD_HZ, 9);
    // the bed enters with the first lift and stops with the cut
    expect(ofKind(events, "bed").map((e) => e.t)).toEqual([bars[0].t]);
    // the return: every bead settles, an octave under its bar, inner first
    const plucks = ofKind(events, "pluck");
    expect(plucks.map((p) => p.ev.wallIndex)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    plucks.forEach((p) => expect(p.ev.frequency).toBeCloseTo(hoopBarFrequency(radii[p.ev.wallIndex], 0.25, 0.75, 8) / 2, 9));
    for (const p of plucks) expect(p.t).toBeGreaterThan(sc.up + sc.hold);
    // the reset: the cut, the bed's stop and the glide from G2 to the outer bar, ending on the seam
    const [cut] = ofKind(events, "cut");
    const [stop] = ofKind(events, "bedStop");
    const [glide] = ofKind(events, "glide");
    expect(cut.t).toBe(glide.t);
    expect(stop.t).toBe(glide.t);
    expect(glide.ev.frequency).toBeCloseTo(HOOPS_CHORD_HZ, 9);
    expect(glide.ev.loopTo).toBeCloseTo(bars[0].ev.frequency!, 9);
    expect(glide.t + glide.ev.loopSec!).toBeCloseTo(sc.cycle, 9);
    for (const p of plucks) expect(p.t).toBeLessThan(sc.cycle);
    expect([v.seams, v.lastSeamMs / 1000]).toEqual([1, expect.closeTo(sc.cycle, 9)]);
  });

  it("schedules them on the context's clock through ToneGenerator.playLoop (the fake Web Audio graph)", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    const engine = engineOf();
    const sc = engine.getHoopsView().schedule;
    const events = run(engine, sc.cycle);
    let last = -1;
    for (const { t, ev } of events) {
      if (t !== last) {
        graph.ctx.currentTime = t;
        last = t;
      }
      playSoundEvent(tone, ev, () => undefined);
    }
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    // every bar sounds its fundamental at its lift's time, every chime at its turn's
    for (const { t, ev } of [...ofKind(events, "bar"), ...ofKind(events, "chime")]) expect(graph.oscillators.some((o) => near(o.startAt, t) && Math.abs(o.frequency - ev.frequency!) < 1e-6), `${ev.loop} at ${t}`).toBe(true);
    // the chord's root at the all-up moment
    const [chord] = ofKind(events, "chord");
    expect(graph.oscillators.some((o) => near(o.startAt, chord.t) && Math.abs(o.frequency - HOOPS_CHORD_HZ) < 0.01)).toBe(true);
    // the glide's exponential ramp lands on the outer hoop's bar exactly at the seam
    const [glide] = ofKind(events, "glide");
    const ramp = graph.ramps.find((r) => r.kind === "exp" && r.param === "frequency" && Math.abs(r.value - glide.ev.loopTo!) < 1e-6);
    expect(ramp?.time).toBeCloseTo(sc.cycle, 9);
  });

  it("the switches: no chime with the tick off, no bed by default", () => {
    const quiet = run(engineOf({ tick: false }), 15);
    expect(ofKind(quiet, "chime")).toHaveLength(0);
    expect(ofKind(quiet, "bar")).toHaveLength(8);
    expect(ofKind(run(engineOf(), 15), "bed")).toHaveLength(0);
    // the switches follow live (the rest waits for the next run)
    const engine = engineOf();
    run(engine, 2);
    engine.setHoopsSettings({ tick: false });
    expect(ofKind(run(engine, 4), "chime")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ loop contract, HUD, renderer */

describe("Spinning Hoops: the loop, the HUD and the picture", () => {
  it("reports its cycle and seams, and every cycle replays the first exactly (the seam is the run's start)", () => {
    const engine = engineOf();
    const v = engine.getHoopsView();
    const sc = v.schedule;
    expect(engine.getCycleSeconds()).toBeCloseTo(sc.cycle, 12);
    const start = Array.from(v.theta.subarray(0, v.count));
    const events = run(engine, 2 * sc.cycle + 0.1);
    const seams = engine.getLoopSeams();
    expect(seams?.count).toBe(2);
    expect(seams?.lastMs).toBeCloseTo(2000 * sc.cycle, 6);
    const first = events.filter((e) => e.t < sc.cycle - 1e-9).map((e) => `${e.ev.loop}:${e.ev.wallIndex}:${Math.round(e.t * 60)}`);
    const second = events.filter((e) => e.t >= sc.cycle - 1e-9 && e.t < 2 * sc.cycle - 1e-9).map((e) => `${e.ev.loop}:${e.ev.wallIndex}:${Math.round((e.t - sc.cycle) * 60)}`);
    expect(second).toEqual(first);
    // right after a seam the beads are back on their rest (the brake put them there)
    const fresh = engineOf();
    const fv = fresh.getHoopsView();
    let atSeam: number[] = [];
    run(fresh, sc.cycle + 0.05, STEP, () => {
      if (fv.seams === 1 && atSeam.length === 0) atSeam = Array.from(fv.thetaPrev.subarray(0, fv.count));
    });
    atSeam.forEach((theta, i) => expect(Math.abs(theta - start[i]), `hoop ${i}`).toBeLessThan(1e-9));
    // without the return it never loops and finishes after the hold
    const once = engineOf({ returnLoop: false });
    expect(once.getCycleSeconds()).toBeNull();
    run(once, 15);
    expect([once.getLoopSeams(), once.isSimulationFinished(), once.getHoopsView().phase]).toEqual([null, true, "done"]);
  });

  it("the HUD counter reads the spin in turns a second and the beads up, in the page's language", () => {
    const keys = LOOP_HUD_MODE_TEXT.hoops!;
    expect(keys).toEqual({ title: "hoopsTitle", subtitle: "hoopsSubtitle", counter: "hoopsCounter", counterOne: "hoopsCounterOne" });
    const spec = (counter: string) => ({ title: en.LoopHud.hoopsTitle, subtitle: en.LoopHud.hoopsSubtitle, counter, light: false });
    const engine = engineOf();
    engine.update(STEP, 0);
    expect(loopHudFrame(spec(en.LoopHud.hoopsCounter), loopHudCount(engine)).counter).toBe("0.13 turns a second · 0 of 8 beads up");
    expect(loopHudFrame({ ...spec(pl.LoopHud.hoopsCounter), locale: "pl" }, loopHudCount(engine)).counter).toBe("0,13 obr./s · w górze: 0 z 8 koralików");
    run(engine, 13);
    expect(loopHudFrame(spec(en.LoopHud.hoopsCounter), loopHudCount(engine), "en").counter).toBe("1.20 turns a second · 8 of 8 beads up");
    expect(loopHudFrame(spec(es.LoopHud.hoopsCounter), loopHudCount(engine), "es").counter).toBe("1,20 vueltas por segundo · 8 de 8 cuentas arriba");
    expect(hudNumber(3, "pl")).toBe("3");
    expect(hudNumber(0.125)).toBe("0.13");
    // every title is lowercase (the account's convention), every counter carries the three values
    for (const m of [en, pl, es]) {
      expect(m.LoopHud.hoopsTitle).toBe(m.LoopHud.hoopsTitle.toLowerCase());
      for (const key of ["{rate}", "{count}"]) expect(m.LoopHud.hoopsCounter).toContain(key);
      expect(m.LoopHud.hoopsCounter).toContain("{total}");
    }
  });

  it("draws every hoop and bead at the frame's own time: φ from the schedule, the angle between the last two steps", () => {
    const engine = engineOf();
    const v = engine.getHoopsView();
    run(engine, 11);
    const frame = hoopsFrameAt(v, v.timeMs - v.stepMs / 2);
    const turns = scheduleTurns(v.schedule, (v.timeMs - v.stepMs / 2) / 1000);
    expect(frame.phi).toBeCloseTo(TWO_PI * (turns - Math.floor(turns)), 9);
    expect(frame.alpha).toBeCloseTo(0.5, 9);
    expect(hoopsBeadAngle(v, 0, frame)).toBeCloseTo((v.thetaPrev[0] + v.theta[0]) / 2, 12);
    const ahead = hoopsFrameAt(v, v.timeMs + 5);
    expect(hoopsBeadAngle(v, 0, ahead)).toBeCloseTo(v.theta[0] + v.thetaDot[0] * 0.005, 12);
    // the render time stays within a step of the engine's and never below 0
    expect(hoopsRenderTimeMs(1000, 0, 0)).toBeCloseTo(1000 - STEP, 9);
    expect(hoopsRenderTimeMs(1000, 50, 50)).toBeCloseTo(1000 + STEP, 9);
    expect(hoopsRenderTimeMs(0, 0, 0)).toBe(0);
    expect(hoopsExtentPx(v)).toBeCloseTo(v.radiusPx[0] + 0.09 * v.half, 9);
    const canvas = fakeCanvas(800, 800);
    // (the fake context has no ellipse or radial gradient of its own: logged here like its other calls)
    canvas.ctx.ellipse = (...args: unknown[]) => void canvas.ctx.calls.push({ name: "ellipse", args });
    canvas.ctx.createRadialGradient = (...args: unknown[]) => {
      canvas.ctx.calls.push({ name: "createRadialGradient", args });
      return { addColorStop: () => undefined };
    };
    const layer = new HoopsLayer();
    layer.draw(canvas.ctx as unknown as CanvasRenderingContext2D, v, v.timeMs, { wallThickness: 2, rainbow: true, wallColor: "#ffffff", wallGlow: true });
    const ellipses = canvas.ctx.calls.filter((c) => c.name === "ellipse");
    expect(ellipses.length).toBeGreaterThanOrEqual(8);
    const data: Record<string, string> = {};
    layer.writeData((k, value) => (data[k] = value), v);
    expect(Object.keys(data).sort()).toEqual([...HOOPS_DATA_KEYS].sort());
    expect([data.hoopsCount, data.hoopsUp, data.hoopsOrder, data.hoopsOrdered, data.hoopsCycle]).toEqual(["8", "8", "0,1,2,3,4,5,6,7", "1", "0"]);
    expect(hoopHue(0, 8)).toBe(0);
    expect(hoopHue(7, 8)).toBe(275);
  });

  it("places the engine's balls on the beads and resizes the hoops with the canvas (the physics is in metres)", () => {
    const engine = engineOf({}, 7, { width: 600, height: 1000 });
    const v = engine.getHoopsView();
    expect([v.cx, v.cy, v.half]).toEqual([300, 500, 300]);
    run(engine, 11);
    const ball = engine.getBalls()[0];
    const phi = TWO_PI * scheduleTurns(v.schedule, v.timeMs / 1000);
    expect(ball.x).toBeCloseTo(v.cx + v.radiusPx[0] * Math.sin(v.theta[0]) * Math.cos(phi), 6);
    expect(ball.y).toBeCloseTo(v.cy + v.radiusPx[0] * Math.cos(v.theta[0]), 6);
    const theta = v.theta[0];
    engine.setConfig({ width: 1000, height: 1000 });
    expect([v.cx, v.half, v.radiusPx[0]]).toEqual([500, 500, 375]);
    expect(v.theta[0]).toBe(theta);
  });
});

/* ------------------------------------------------------------------ finder */

describe("Spinning Hoops: Find Simulation", () => {
  const request = (hoops: Partial<HoopsSettings>, outcome: FinderOutcome): FinderRequest => ({ targetDurationSec: 20, toleranceSec: 0.5, maxSeeds: 40, maxSimTimeSec: 60, physicsConfig: config, mode: "hoops", modeSettings: { ...base, hoops }, outcome });

  it("a looping run never ends (no length to find), a run without the return lasts its ramp and hold whatever the seed", () => {
    expect(runNeverFinishes("hoops", { hoops: {} } as ModeSettings)).toBe(true);
    expect(runNeverFinishes("hoops", { hoops: { returnLoop: false } } as ModeSettings)).toBe(false);
    const once: ModeSettings = { ...base, hoops: { returnLoop: false } };
    const looping: ModeSettings = { ...base, hoops: {} };
    expect(fixedRunDurationSec("hoops", once)).toBe(14);
    expect(fixedRunDurationSec("hoops", looping)).toBeNull();
    expect(availableOutcomes("hoops", { endless: true, neverEscape: false, ballCount: 1 })).toEqual(["lift-order", "all-up-by"]);
    expect(availableOutcomes("hoops", { endless: false, neverEscape: false, ballCount: 1 })).toEqual(["duration", "lift-order", "all-up-by"]);
    expect(availableOutcomes("pendulum", { endless: false, neverEscape: false, ballCount: 1 })).not.toContain("lift-order");
  });

  it("strict size order: true by physics at the defaults; close twin hoops on a steep tilt split the seeds", () => {
    const outcome: FinderOutcome = { kind: "lift-order", clipSec: 20 };
    const fine = simulateOutcomeRun(1, request({}, outcome), outcome);
    expect([fine.liftOrderOk, outcomeMatches(outcome, fine), outcomeMiss(outcome, fine)]).toEqual([true, true, 0]);
    // the order is decided once every bead is up: the run stops there
    expect(fine.durationMs / 1000).toBeLessThan(12);
    const twins = { count: 2, radiusMax: 0.9, radiusMin: 0.895, jitter: 0.01 };
    const verdicts = [1, 2, 3, 4, 5, 6].map((seed) => simulateOutcomeRun(seed, request(twins, outcome), outcome).liftOrderOk);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
    expect(outcomeMiss(outcome, { mode: "hoops", durationMs: 1, finished: false, firstEscapeMs: -1, teams: [], liftOrderOk: false })).toBe(1);
  });

  it("all up within a time: met before the limit, missed by the seconds past it", () => {
    const by12: FinderOutcome = { kind: "all-up-by", clipSec: 20, atSec: 12 };
    const run12 = simulateOutcomeRun(7, request({}, by12), by12);
    expect(run12.allUpMs).toBeGreaterThan(5000);
    expect(run12.allUpMs).toBeLessThan(12000);
    expect([outcomeMatches(by12, run12), outcomeFigure(by12, run12)]).toEqual([true, run12.allUpMs! / 1000]);
    const by6: FinderOutcome = { kind: "all-up-by", clipSec: 20, atSec: 6 };
    const run6 = simulateOutcomeRun(7, request({}, by6), by6);
    expect([run6.allUpMs, outcomeMatches(by6, run6), outcomeMiss(by6, run6)]).toEqual([-1, false, Infinity]);
    const late: RunSummary = { mode: "hoops", durationMs: 9000, finished: false, firstEscapeMs: -1, teams: [], allUpMs: 9300 };
    expect(outcomeMiss(by6, late)).toBeCloseTo(3.3, 9);
    expect(hoopsOutcomeSettled(by6, 1000, 9300, false)).toBe(true);
    expect(hoopsOutcomeSettled(by6, 1000, -1, false)).toBe(false);
    expect(hoopsOutcomeSettled({ kind: "lift-order", clipSec: 20 }, 1000, -1, true)).toBe(true);
  });

  it("the bot's finder request carries the page's hoops (presets, the batch render and the desktop queue alike)", () => {
    const s = { ...defaultSettings("hoops"), hpCount: 3, hpOmegaEnd: 2 } as SimulatorSettings;
    expect(modeSettingsOfSettings(s).hoops).toMatchObject({ count: 3, omegaEnd: 2 });
    const engine = createEngineForSettings(physicsConfigOfSettings(s, { width: 720, height: 1280 }), "hoops", modeSettingsOfSettings(s), 5);
    expect(engine.getHoopsView().count).toBe(3);
  });
});

/* ------------------------------------------------------------------ settings */

describe("Spinning Hoops: settings, presets and the mode's registration", () => {
  it("registers the mode: an id, a rhythm-family card right after Pendulum Wave, the panel's keys, a name in every language", () => {
    expect(MODE_IDS).toContain("hoops");
    expect(MODE_CATEGORIES.hoops).toBe("rhythm");
    expect(MODE_CARD_ORDER.indexOf("hoops")).toBe(MODE_CARD_ORDER.indexOf("pendulum") + 1);
    expect(MODE_BLOCK_KEYS.hoops).toEqual(HOOPS_KEYS);
    for (const [locale, m] of Object.entries({ en, pl, es })) {
      const controls = m.Controls as Record<string, string>;
      for (const key of [...HOOPS_KEYS, "modeHoops", "hpCritical", "hpCriticalOne", "hpNeverLifts", "hpTurnsUnit", "hpShapeLinear", "hpShapeEase", "hpShapeSteps", ...HOOPS_PRESETS.map((p) => p.labelKey)]) expect(controls[key], `${locale} Controls.${key}`).toBeTruthy();
      expect((m.Modes as unknown as Record<string, { name: string; description: string }>).hoops.name).toBeTruthy();
      expect((m.Editorial as Record<string, string>).modeHoops.length).toBeGreaterThan(200);
    }
    expect(en.Modes.hoops.name).toBe("Spinning Hoops");
  });

  it("starts from the defaults, the loop HUD off as in every mode (the presets turn it on)", () => {
    const s = defaultSettings("hoops");
    expect([s.hpCount, s.hpRadiusMax, s.hpRadiusMin, s.hpGravity, s.hpOmegaStart, s.hpOmegaEnd, s.hpRamp, s.hpRampShape, s.hpHold, s.hpReturn, s.hpReturnSec, s.hpDamping, s.hpJitter, s.hpTick, s.hpBed]).toEqual([8, 0.75, 0.25, 9.81, 0.13, 1.2, 12, "linear", 2, true, 6, 1, 0.004, true, false]);
    expect(s.loopHud).toBe(false);
    expect(HOOPS_LOOK.loopHud).toBe(true);
    expect(hoopsSettingsOf(DEFAULT_HOOPS_FIELDS)).toEqual(DEFAULT_HOOPS_SETTINGS);
  });

  it("round-trips the URL keys (only what differs from the defaults), uncapped past the sliders, invalid values falling back", () => {
    const s = { ...defaultSettings("hoops"), hpCount: 40, hpRadiusMax: 0.95, hpRadiusMin: 0.2, hpGravity: 3.7, hpOmegaStart: 0, hpOmegaEnd: 5.5, hpRamp: 90, hpRampShape: "steps", hpHold: 0, hpReturn: false, hpReturnSec: 2.5, hpDamping: 0, hpJitter: 0.0005, hpTick: false, hpBed: true } as SimulatorSettings;
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("hoops");
    for (const key of [...Object.keys(HOOPS_URL_KEYS), "hps", "hprt", "hpt", "hpb"]) expect(params.has(key), key).toBe(true);
    const back = settingsFromSearchParams(params);
    for (const key of Object.keys(DEFAULT_HOOPS_FIELDS) as (keyof HoopsFields)[]) expect(back[key], key).toEqual(s[key]);
    expect(settingsToSearchParams(defaultSettings("hoops")).has("hpn")).toBe(false);
    // invalid and below-minimum values: the defaults, or the minimum (never a maximum)
    const fields: HoopsFields = { ...DEFAULT_HOOPS_FIELDS };
    readHoopsParams(new URLSearchParams("hpn=abc&hpw1=0.1&hps=zigzag&hprt=maybe&hpg=-3&hpr=1e6&hpj=0.5"), fields);
    expect([fields.hpCount, fields.hpOmegaEnd, fields.hpRampShape, fields.hpReturn, fields.hpGravity, fields.hpRamp, fields.hpJitter]).toEqual([8, RANGES.hpOmegaEnd.min, "linear", true, RANGES.hpGravity.min, 1e6, 0.5]);
    const written = new URLSearchParams();
    writeHoopsParams({ ...DEFAULT_HOOPS_FIELDS, hpJitter: 0.0035 }, DEFAULT_HOOPS_FIELDS, written);
    expect(written.toString()).toBe("hpj=0.0035");
    expect(resolveHoopsFields({ hpCount: 2.6, hpTick: "yes" })).toMatchObject({ hpCount: 3, hpTick: true });
  });

  it("presets: 8 rainbow hoops (the defaults), One hoop slow, Twin hoops in steps – with the clip's look and a clip of one cycle", () => {
    expect(HOOPS_PRESETS.map((p) => p.id)).toEqual(["rainbow8", "oneSlow", "twin"]);
    expect(hoopsPresetFields("rainbow8")).toEqual(DEFAULT_HOOPS_FIELDS);
    expect(hoopsPresetFields("oneSlow")).toMatchObject({ hpCount: 1, hpRadiusMax: 0.75, hpRampShape: "ease", hpRamp: 20 });
    expect(hoopsPresetFields("twin")).toMatchObject({ hpCount: 2, hpRadiusMax: 0.75, hpRadiusMin: 0.4, hpRampShape: "steps" });
    expect(HOOPS_LOOK).toMatchObject({ backgroundColors: ["#0b1020", "#0b1020"], rainbowWalls: true, loopHud: true });
    expect(hoopsClipSec(DEFAULT_HOOPS_FIELDS)).toBe(24);
    for (const preset of HOOPS_PRESETS) {
      const fields = hoopsPresetFields(preset.id);
      expect(hoopsClipSec(fields)).toBe(Math.ceil(hoopsSchedule(hoopsSettingsOf(fields)).cycle - 1e-9));
      // a twin's two beads lift on two different steps; one hoop lifts once
      const bars = ofKind(run(createEngineForSettings(config, "hoops", { ...base, hoops: hoopsSettingsOf(fields) }, 4), hoopsClipSec(fields)), "bar");
      expect(bars.map((b) => b.ev.wallIndex), preset.id).toEqual([...Array(fields.hpCount).keys()]);
    }
    expect(presetToSettings({ mode: "hoops", hpCount: 3, hpRampShape: "nope" } as unknown as Partial<SimulatorSettings>)).toMatchObject({ hpCount: 3, hpRampShape: "linear" });
  });

  it("builds any count of hoops up to the memory ceiling, and names the spins the beads lift at", () => {
    expect(MEMORY_CEILINGS.hpCount).toBeGreaterThan(1000);
    const engine = engineOf({ count: 1e9 });
    expect(engine.getHoopsView().count).toBe(memoryCeiling("hpCount", 1e9));
    const s = defaultSettings("hoops");
    const range = hoopsLiftRange(s);
    expect(range.outer).toBeCloseTo(criticalTurns(9.81, 0.75), 12);
    expect(range.inner).toBeCloseTo(criticalTurns(9.81, 0.25), 12);
    expect([range.never, range.count]).toEqual([0, 8]);
    expect(hoopsLiftRange({ ...s, hpOmegaEnd: 0.7 }).never).toBe(hoopRadii(8, 0.75, 0.25).filter((r) => criticalTurns(9.81, r) >= 0.7).length);
    expect(hoopsLiftRange({ ...s, hpOmegaEnd: 0.7 }).never).toBeGreaterThan(0);
    expect(speedShare({ a: 1.5, b: 0.5 }, 1)).toBeCloseTo(0.5, 12);
    expect(HOOPS_LIFT_RAD).toBeCloseTo((5 * Math.PI) / 180, 15);
  });
});

/* ------------------------------------------------------------------ review fixes */

describe("Spinning Hoops: the chime's register, the bed's switch and the loop-style caption", () => {
  it("chimes in the glock register, A5 up to A6, one pentatonic degree a sixth of the spin's range", () => {
    expect(HOOPS_CHIME_LEVELS).toBe(6);
    expect(hoopChimeFrequency(0)).toBeCloseTo(880, 6);
    expect(hoopChimeFrequency(1)).toBeCloseTo(1760, 6);
    const heard = new Set<number>();
    let last = 0;
    for (let s = -0.5; s <= 1.5; s += 0.01) {
      const f = hoopChimeFrequency(s);
      expect(f).toBeGreaterThanOrEqual(880 - 1e-6);
      expect(f).toBeLessThanOrEqual(1760 + 1e-6);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
      heard.add(Math.round(f));
    }
    // A5, B5, D6, E6, G6, A6: the G major pentatonic, so every chime sits in the bars' key
    expect([...heard]).toEqual([880, 988, 1175, 1319, 1568, 1760]);
    expect(hoopChimeFrequency(Number.NaN)).toBeCloseTo(880, 6);
    // a cycle's chimes stay in the register too
    const chimes = ofKind(run(engineOf(), hoopsSchedule(DEFAULT_HOOPS_SETTINGS).cycle), "chime");
    expect(chimes.length).toBeGreaterThan(0);
    for (const c of chimes) expect(c.ev.frequency! >= 880 - 1e-6 && c.ev.frequency! <= 1760 + 1e-6).toBe(true);
  });

  it("stops the groove bed at once when its switch goes off mid-run, and when a run without the return ends", () => {
    const engine = engineOf({ bed: true });
    const before = run(engine, 9);
    expect(ofKind(before, "bed")).toHaveLength(1);
    engine.setHoopsSettings({ bed: false });
    const after = run(engine, 1);
    const stops = ofKind(after, "bedStop");
    expect(stops).toHaveLength(1);
    expect(stops[0].t).toBeCloseTo(9 + STEP / 1000, 9);
    // nothing restarts it, and the reset has no bed left to stop
    const rest = run(engine, 20);
    expect(ofKind(rest, "bed")).toHaveLength(0);
    expect(ofKind(rest, "bedStop")).toHaveLength(0);
    // switched off before it ever started: no stop at all
    const quiet = engineOf({ bed: true });
    run(quiet, 1);
    quiet.setHoopsSettings({ bed: false });
    expect(ofKind(run(quiet, 2), "bedStop")).toHaveLength(0);
    // without the return the run ends after the top hold, and the bed with it
    const once = engineOf({ bed: true, returnLoop: false });
    const events = run(once, 16);
    const [stop] = ofKind(events, "bedStop");
    expect(once.isSimulationFinished()).toBe(true);
    expect(stop?.t).toBeCloseTo(hoopsSchedule(resolveHoopsSettings({ returnLoop: false })).cycle, 1);
  });

  it("writes the loop-style caption: the hoop count leads the hook, the critical-spin fact under it, the physics and maths tags", () => {
    const s = { ...defaultSettings("hoops"), recordingDuration: 24 };
    expect(loopCaptionContext(s)).toEqual({ mode: "hoops", hookKey: "hoops", factKey: "hoopsFact", count: 8 });
    const oneHoop: SimulatorSettings = { ...s, hpCount: 1 };
    expect(loopCaptionContext(oneHoop)).toMatchObject({ hookKey: "hoopsOne", count: 1 });
    const words = en.LoopCaption as Record<string, string>;
    const draft = loopCaption({ mode: "hoops", hook: words.hoops, count: 8, fact: words.hoopsFact, locale: "en" });
    expect(draft.caption.split("\n")[0]).toBe("8 hoops spinning faster and faster: the beads climb in order, the biggest hoop first 🔊");
    expect(draft.caption).toContain("0.58 turns a second");
    expect(draft.hashtags).toBe("#satisfying #oddlysatisfying #physics #math #creativecoding");
    // every language: the count in the hook, lowercase, one speaker, no mention or call to action, a fact with its numbers
    for (const [locale, m] of Object.entries({ en, pl, es })) {
      const w = m.LoopCaption as Record<string, string>;
      for (const key of ["hoops", "hoopsOne"]) {
        expect(w[key], `${locale} ${key}`).toContain("{count}");
        const hook = loopCaption({ mode: "hoops", hook: w[key], count: key === "hoops" ? 8 : 1, fact: w.hoopsFact, locale });
        expect(hook.title, `${locale} ${key}`).toBe(hook.title.toLocaleLowerCase(locale));
        expect(hook.caption.match(/🔊/gu), `${locale} ${key}`).toHaveLength(1);
        expect(hasMentionOrCta(hook.caption), `${locale} ${key}`).toBe(false);
      }
      expect(w.hoopsFact, locale).toMatch(/0[.,]58/);
      expect(w.hoopsFact, locale).toContain("√(g/R)");
    }
  });
});

// (the shapes are a closed list the URL and the section share)
const _shapes: readonly HoopsRampShape[] = HOOPS_RAMP_SHAPES;
void _shapes;
