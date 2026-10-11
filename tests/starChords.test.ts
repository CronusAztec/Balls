import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { SC_CHORD_CEILING, SC_EARLY_DING_LEVEL, SC_MIN_CUT_HOLD_SEC, SC_SOUNDS_PER_STEP } from "@/lib/physics/modes/starChords";
import { pluckVelocity } from "@/lib/audio/loopTones";
import {
  DEFAULT_STARS,
  SC_CHORD_HZ,
  SC_ENGINE_KEYS,
  SC_PRESET_IDS,
  SC_RANGES,
  ballPitches,
  ballSpeed,
  bouncesAt,
  chordLength,
  cleanStars,
  cycleForClip,
  defaultStarChordsFields,
  envelopeRadius,
  isProperStar,
  normalizeStar,
  parseStars,
  periodOf,
  phaseAt,
  positionAt,
  randomStarSet,
  resolveStarChordsFields,
  resolveStarChordsSettings,
  searchStarSets,
  seededRandom,
  serializeStars,
  starChordsModeDefaults,
  starChordsPresetPatch,
  starChordsSettingsOf,
  starLaps,
  starSetScore,
  starStepFor,
  starsForBalls,
  totalBouncesAt,
  vertexAngle,
  vertexIndex,
  type ScPhase,
  type StarChordsSettings,
  type StarSpec,
} from "@/lib/physics/starChords";
import { degreeToMidi } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { createEngineForSettings, findSimulation, runNeverFinishes, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { findStarChordsRun } from "@/lib/simulation/starChordsFinder";
import { availableOutcomes } from "@/lib/simulation/outcomes";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { ENTITY_CEILING } from "@/lib/uncap";
import { hudCounterText, loopHudCount, subtitleLines } from "@/lib/loop/hud";
import { loopCaptionContext, loopHashtags } from "@/lib/publish/loopCaption";
import { wallControlsOf, MODE_BLOCK_KEYS } from "@/components/simulator/panelKeys";
import { STAR_CHORDS_KEYS } from "@/components/simulator/sections/StarChordsSection";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- chord-stars --- Chord Stars (lib/physics/starChords.ts, modes/starChords.ts): the star polygons' geometry, the timing that
 * closes every star on the same frame, the run on the engine (the chords of every cycle, the loop contract, the frame rates),
 * the sounds it schedules, the settings, the finder's star sets and the HUD's words.
 */

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const baseModeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
const STEP_MS = 1000 / 60;

function starEngine(patch: Partial<StarChordsSettings> = {}, seed = 7): PhysicsEngine {
  return createEngineForSettings(config, "starChords", { ...baseModeSettings, starChords: patch }, seed);
}

/** Runs `frames` frames of `frameMs` (the page's loop: whole fixed steps), calling `onFrame` after every frame with its events. */
function frameLoop(engine: PhysicsEngine, frames: number, frameMs: number, onFrame: (k: number, events: SoundEvent[]) => void = () => {}) {
  for (let k = 1; k <= frames; k++) {
    engine.update(frameMs, 0);
    onFrame(k, engine.consumeSoundEvents());
  }
}

/** FNV-1a over numbers (rounded to 1e-6), for fingerprints. */
function hashNumbers(values: Iterable<number>, h = 0x811c9dc5): number {
  for (const v of values) {
    const s = Number.isFinite(v) ? (Math.round(v * 1e6) / 1e6).toFixed(6) : String(v);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ 0x7c, 0x01000193) >>> 0;
  }
  return h;
}

/** The distance from the origin to the line through two points. */
function lineDistance(x0: number, y0: number, x1: number, y1: number): number {
  return Math.abs(x0 * y1 - x1 * y0) / Math.hypot(x1 - x0, y1 - y0);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Chord Stars: the star polygons", () => {
  it("brings the {5/2} ball back to its start vertex after exactly 5 bounces (0, 2, 4, 1, 3, 0)", () => {
    const star: StarSpec = { n: 5, k: 2 };
    expect([0, 1, 2, 3, 4, 5].map((j) => vertexIndex(j, star))).toEqual([0, 2, 4, 1, 3, 0]);
    for (let j = 1; j < 5; j++) expect(vertexIndex(j, star)).not.toBe(0);
    // every coprime star visits all n vertices once before it closes; a shared factor closes the reduced star sooner
    for (const s of [{ n: 7, k: 3 }, { n: 8, k: 3 }, { n: 9, k: 4 }, { n: 12, k: 5 }, { n: 101, k: 40 }]) {
      const seen = new Set<number>();
      for (let j = 0; j < s.n; j++) seen.add(vertexIndex(j, s));
      expect(seen.size, `${s.n}/${s.k}`).toBe(s.n);
      expect(vertexIndex(s.n, s)).toBe(0);
    }
    const twice = { n: 10, k: 4 };
    expect(starLaps(twice)).toBe(2);
    expect(vertexIndex(5, twice)).toBe(0);
    // a star too big for plain multiplication still gets its exact vertex (modular arithmetic by halves)
    const huge = { n: 2 ** 52 + 1, k: 2 ** 51 + 3 };
    const j = 987654321;
    expect(vertexIndex(j, huge)).toBe(Number((BigInt(j) * BigInt(huge.k)) % BigInt(huge.n)));
  });

  it("keeps every chord R·cos(πk/n) from the centre (within 1e-9) and 2R·sin(πk/n) long", () => {
    for (const R of [1, 100, 219.4, 5000]) {
      for (const s of [{ n: 5, k: 2 }, { n: 7, k: 3 }, { n: 8, k: 3 }, { n: 9, k: 4 }, { n: 12, k: 5 }, { n: 7, k: 2 }, { n: 31, k: 11 }, { n: 6, k: 1 }]) {
        const d = envelopeRadius(R, s);
        expect(d).toBeCloseTo(R * Math.cos((Math.PI * s.k) / s.n), 9);
        for (let j = 0; j < s.n; j++) {
          const a0 = vertexAngle(0.3, j, s);
          const a1 = vertexAngle(0.3, j + 1, s);
          const [x0, y0, x1, y1] = [R * Math.cos(a0), R * Math.sin(a0), R * Math.cos(a1), R * Math.sin(a1)];
          expect(Math.abs(lineDistance(x0, y0, x1, y1) - d), `${s.n}/${s.k} chord ${j} at R ${R}`).toBeLessThan(1e-9 * Math.max(1, R));
          expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(chordLength(R, s), 6);
        }
      }
    }
  });

  it("reads typed stars, extends them for more balls and names the step nearest 0.4·n", () => {
    expect(parseStars("5/2, 7/3 8/3;{9/4} 12 / 5 x/2 3/0 4/9")).toEqual([
      { n: 5, k: 2 },
      { n: 7, k: 3 },
      { n: 8, k: 3 },
      { n: 9, k: 4 },
      { n: 12, k: 5 },
      { n: 4, k: 1 },
    ]);
    expect(normalizeStar(5, -2)).toEqual({ n: 5, k: 3 });
    expect(normalizeStar(5, 5)).toBeNull();
    expect(normalizeStar(1, 1)).toBeNull();
    expect(cleanStars("nonsense")).toBe(DEFAULT_STARS);
    expect(serializeStars(parseStars(DEFAULT_STARS))).toBe(DEFAULT_STARS);
    expect([5, 6, 7, 8, 9, 10, 11, 12, 13].map(starStepFor)).toEqual([2, 0, 3, 3, 4, 3, 4, 5, 5]);
    const run = starsForBalls(parseStars("5/2,7/3"), 5);
    expect(serializeStars(run)).toBe("5/2,7/3,8/3,9/4,10/3");
    expect(new Set(starsForBalls([], 200).map((s) => s.n)).size).toBe(200);
    for (const s of starsForBalls([], 200)) expect(isProperStar(s)).toBe(true);
  });
});

describe("Chord Stars: every star closes on the same frame", () => {
  it("has every ball bounce n times in exactly T, whatever T, and none before", () => {
    const stars = parseStars(DEFAULT_STARS);
    for (const T of [1, 1.37, 4, 7.5, 12, 29.9, 1000]) {
      for (const s of stars) {
        expect(bouncesAt(T, s.n, T)).toBe(s.n);
        expect(bouncesAt(T * (1 - 1e-6), s.n, T)).toBe(s.n - 1);
        // bounce j comes at j·T/n exactly
        for (let j = 1; j < s.n; j++) {
          expect(bouncesAt((j * T) / s.n, s.n, T), `${s.n} at T ${T}`).toBe(j);
          expect(bouncesAt((j * T) / s.n - T * 1e-7, s.n, T)).toBe(j - 1);
        }
      }
    }
  });

  it("closes every star of the run in the same engine step, for any drawing time", () => {
    for (const cycleSec of [1, 2.25, 7.3, 12]) {
      const engine = starEngine({ cycleSec, holdSec: 0.5, fadeSec: 0.5 });
      const v = engine.getStarChordsView();
      const closedStep = new Array(v.count).fill(-1);
      let step = 0;
      while (closedStep.some((s) => s < 0) && step < 60 * (cycleSec + 2)) {
        engine.update(STEP_MS, 0);
        engine.consumeSoundEvents();
        step++;
        for (let i = 0; i < v.count; i++) if (closedStep[i] < 0 && v.bounces[i] >= v.stars[i].n) closedStep[i] = step;
      }
      expect(new Set(closedStep).size, `T ${cycleSec}`).toBe(1);
      const at = closedStep[0];
      // the step that crosses T: its end at or past T, the one before short of it
      expect((at * STEP_MS) / 1000).toBeGreaterThanOrEqual(cycleSec - 1e-9);
      expect(((at - 1) * STEP_MS) / 1000).toBeLessThan(cycleSec);
      expect(v.closed).toBe(v.count);
      expect(v.closings).toBe(1);
      expect(v.lastAllClosedSec).toBeCloseTo(cycleSec, 9);
    }
  });

  it("moves along the chords at n·chord/T and stands at its start vertex once the star has closed", () => {
    const s = { n: 9, k: 4 };
    const T = 12;
    const r = 200;
    const out = { x: 0, y: 0, vx: 0, vy: 0 };
    for (let j = 0; j < s.n; j++) {
      positionAt(0, 0, r, -Math.PI / 2, s, T, (j * T) / s.n, out);
      const a = vertexAngle(-Math.PI / 2, j, s);
      expect(out.x).toBeCloseTo(r * Math.cos(a), 9);
      expect(out.y).toBeCloseTo(r * Math.sin(a), 9);
      expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(ballSpeed(r, s, T), 9);
    }
    positionAt(0, 0, r, -Math.PI / 2, s, T, T + 0.5, out);
    expect([out.x, out.y, out.vx, out.vy].map((x) => Math.round(x * 1e9) / 1e9)).toEqual([0, -r, 0, 0]);
  });

  it("splits the loop into draw, hold and fade, and counts every bounce from the clock however long a step is", () => {
    const p: ScPhase = { index: 0, cycleTime: 0, phase: "draw", progress: 0 };
    expect(periodOf(12, 1.2, 1.8)).toBe(15);
    expect(phaseAt(6, 12, 1.2, 1.8, p)).toMatchObject({ index: 0, phase: "draw", progress: 0.5 });
    expect(phaseAt(12.6, 12, 1.2, 1.8, p).phase).toBe("hold");
    expect(phaseAt(14.1, 12, 1.2, 1.8, p)).toMatchObject({ index: 0, phase: "fade" });
    expect(phaseAt(15, 12, 1.2, 1.8, p)).toMatchObject({ index: 1, phase: "draw", cycleTime: 0 });
    // the running count is monotonic and n a cycle, sampled at any step length
    for (const dt of [0.001, 0.37, 3.3, 14.9]) {
      let last = 0;
      for (let t = 0; t <= 61; t += dt) {
        const total = totalBouncesAt(t, 12, 12, 1.2, 1.8, p);
        expect(total).toBeGreaterThanOrEqual(last);
        last = total;
      }
      expect(totalBouncesAt(60, 12, 12, 1.2, 1.8, p)).toBe(4 * 12);
    }
  });
});

describe("Chord Stars: the run on the engine", () => {
  it("draws Σn chords every cycle, three cycles in a row, and reports the loop to the loop contract", () => {
    const engine = starEngine();
    const v = engine.getStarChordsView();
    const perCycle = v.stars.reduce((sum, s) => sum + s.n, 0);
    expect(perCycle).toBe(41);
    expect(v.chordsPerCycle).toBe(41);
    expect(engine.getCycleSeconds()).toBeCloseTo(15, 9);
    const finished: number[] = [];
    let cycles = 0;
    frameLoop(engine, 60 * 46, STEP_MS, () => {
      if (v.cycles !== cycles) {
        cycles = v.cycles;
        finished.push(v.lastCycleChords);
      }
    });
    expect(finished).toEqual([41, 41, 41]);
    expect(v.totalChords).toBeGreaterThanOrEqual(3 * 41);
    expect(v.closings).toBe(3);
    const seams = engine.getLoopSeams();
    expect(seams).toMatchObject({ count: 3, lastMs: 45000, nextMs: 60000 });
    expect(engine.isSimulationFinished()).toBe(false);
  });

  it("plays the same run and the same sounds at 30, 60 and 120 frames a second (and for every seed)", () => {
    const runs = new Map<number, { state: number; sound: number }>();
    for (const fps of [30, 60, 120]) {
      const engine = starEngine({}, 99);
      const v = engine.getStarChordsView();
      let state = 0x811c9dc5;
      let sound = 0x811c9dc5;
      frameLoop(engine, 32 * fps, 1000 / fps, (k, events) => {
        for (const ev of events) sound = hashNumbers([ev.frequency ?? 0, ev.level ?? 1, ev.loop ? ev.loop.length : 0, ev.loopTo ?? 0, ev.loopSec ?? 0], sound);
        if (k % (fps / 30) !== 0) return; // (the frames all three rates draw: every 1/30 s)
        state = hashNumbers([...v.x, ...v.y, ...v.bounces, v.closed, v.cycleIndex, v.totalChords], state);
      });
      runs.set(fps, { state, sound });
    }
    const ref = runs.get(60)!;
    expect(runs.get(30)).toEqual(ref);
    expect(runs.get(120)).toEqual(ref);
    // pinned: a change of the run or its sounds shows here
    expect(ref.state.toString(16)).toBe(STAR_CHORDS_STATE_PRINT);
    expect(ref.sound.toString(16)).toBe(STAR_CHORDS_SOUND_PRINT);
    // nothing is random: another seed plays the same run
    const other = starEngine({}, 12345);
    let state = 0x811c9dc5;
    const v = other.getStarChordsView();
    frameLoop(other, 32 * 30, 1000 / 30, () => {
      state = hashNumbers([...v.x, ...v.y, ...v.bounces, v.closed, v.cycleIndex, v.totalChords], state);
    });
    expect(state).toBe(ref.state);
  });

  it("keeps up with stars of a million points in one step, and flags a cycle past the chord ceiling", () => {
    const engine = starEngine({ balls: 2, stars: [{ n: 1_000_003, k: 400_001 }, { n: 5, k: 2 }], cycleSec: 2, holdSec: 0, fadeSec: 0 });
    const v = engine.getStarChordsView();
    expect(v.pastCeiling).toBe(true);
    expect(v.chordsPerCycle).toBeGreaterThan(SC_CHORD_CEILING);
    frameLoop(engine, 3 * 60, STEP_MS);
    expect(v.cycles).toBe(1);
    expect(v.lastCycleChords).toBe(1_000_008);
    expect(v.totalChords).toBe(1_000_008 + v.chordsThisCycle);
  });

  it("follows a resize: the circle re-lays out and every ball goes back where the clock puts it", () => {
    const engine = starEngine();
    frameLoop(engine, 200, STEP_MS);
    const v = engine.getStarChordsView();
    engine.setConfig({ width: 600, height: 1000 });
    expect(v.field.radius).toBeCloseTo(225, 9);
    for (const ball of engine.getBalls()) expect(Math.hypot(ball.x - 300, ball.y - 500)).toBeLessThanOrEqual(v.field.chordRadius + 1e-6);
  });
});

describe("Chord Stars: sound", () => {
  it("gives every ball its own pitch: A major pentatonic, two degrees apart, the slowest ball lowest", () => {
    const pitches = ballPitches([9.5, 13.6, 14.8, 17.7, 23.2]);
    expect([...pitches].map((f) => Math.round(f * 100) / 100)).toEqual([0, 2, 4, 6, 8].map((d) => Math.round(midiToFrequency(degreeToMidi(d, 57, "majorPentatonic")) * 100) / 100));
    expect(pitches[0]).toBeCloseTo(220, 6);
    // equal speeds keep their order; 12 and 30 balls still fit the 11-degree span, inside the pluck register C3–C6 (B5 on top)
    const many = ballPitches(new Array(30).fill(1).map((_, i) => i));
    expect(many[29]).toBeLessThanOrEqual(midiToFrequency(degreeToMidi(11, 57, "majorPentatonic")) + 1e-9);
    const twelve = ballPitches(new Array(12).fill(1).map((_, i) => i));
    expect(new Set([...twelve].map((f) => Math.round(f * 100))).size).toBe(12);
    for (const f of [...many, ...twelve]) {
      expect(f).toBeGreaterThanOrEqual(130);
      expect(f).toBeLessThanOrEqual(1050);
    }
  });

  it("queues a pluck per bounce, the chord when the stars close, the cut and the glide when the fade starts", () => {
    const engine = starEngine();
    const v = engine.getStarChordsView();
    const plucks: { t: number; f: number; level: number }[] = [];
    const others: { t: number; ev: SoundEvent }[] = [];
    let maxPerStep = 0;
    frameLoop(engine, 15 * 60, STEP_MS, (k, events) => {
      maxPerStep = Math.max(maxPerStep, events.filter((e) => e.loop === "pluck").length);
      for (const ev of events) {
        if (ev.loop === "pluck") plucks.push({ t: (k * STEP_MS) / 1000, f: ev.frequency ?? 0, level: ev.level ?? 1 });
        else others.push({ t: (k * STEP_MS) / 1000, ev });
      }
    });
    // every bounce of the cycle (41) is one note on its ball's pitch, at the narrow velocity 0.8–1
    expect(plucks.length).toBe(41);
    expect(new Set(plucks.map((p) => Math.round(p.f * 100))).size).toBe(5);
    for (const p of plucks) expect([...v.pitch].some((f) => Math.abs(f - p.f) < 1e-9)).toBe(true);
    for (const p of plucks) {
      expect(p.level).toBeGreaterThanOrEqual(0.8 / Math.sqrt(5) - 1e-9);
      expect(p.level).toBeLessThanOrEqual(1);
    }
    expect(maxPerStep).toBeLessThanOrEqual(SC_SOUNDS_PER_STEP);
    const kinds = others.map((o) => `${o.ev.loop}@${o.t.toFixed(2)}`);
    expect(kinds).toEqual(["chord@12.00", "cut@13.20", "glide@13.20"]);
    const chord = others[0].ev;
    expect(chord.frequency).toBe(SC_CHORD_HZ);
    const glide = others[2].ev;
    expect(glide.frequency).toBe(SC_CHORD_HZ);
    expect(glide.loopSec).toBeCloseTo(1.8, 9);
    // the glide lands an octave under the next cycle's first note: the 12-point star's (the most points bounces first)
    expect(glide.loopTo).toBeCloseTo(v.pitch[4] / 2, 9);
  });

  it("rings a ding an octave over its note when a star closes before the others (a step sharing a factor with n)", () => {
    const engine = starEngine({ balls: 2, stars: [{ n: 10, k: 4 }, { n: 5, k: 2 }] });
    const v = engine.getStarChordsView();
    expect([...v.laps]).toEqual([2, 1]);
    const heard: string[] = [];
    let ding: SoundEvent | null = null;
    frameLoop(engine, 15 * 60, STEP_MS, (k, events) => {
      for (const ev of events) {
        if (ev.loop === "pluck") continue;
        heard.push(`${ev.loop}@${((k * STEP_MS) / 1000).toFixed(2)}`);
        if (ev.loop === "ding") ding = ev;
      }
    });
    // the 10/4 ball traces its reduced 5/2 twice: closed (and its inner circle due) at T/2, the chord when both close at T
    expect(heard).toEqual(["ding@6.00", "chord@12.00", "cut@13.20", "glide@13.20"]);
    expect(ding!.frequency).toBeCloseTo(2 * v.pitch[0], 9);
    expect(ding!.level).toBeCloseTo(SC_EARLY_DING_LEVEL * pluckVelocity(1), 9);
  });

  it("caps a crowd's notes a step, keeps the chord without the plucks (silent) and drops it all with the chord off", () => {
    const crowd = starEngine({ balls: 200, cycleSec: 2 });
    let max = 0;
    frameLoop(crowd, 120, STEP_MS, (k, events) => {
      max = Math.max(max, events.filter((e) => e.loop === "chime" || e.loop === "pluck").length);
    });
    expect(max).toBe(SC_SOUNDS_PER_STEP);
    const silent = starEngine({ voice: "silent", holdSec: SC_MIN_CUT_HOLD_SEC - 0.1 });
    const heard: string[] = [];
    frameLoop(silent, 15 * 60, STEP_MS, (k, events) => heard.push(...events.map((e) => String(e.loop))));
    expect(heard).toEqual(["chord", "glide"]); // (a hold under 0.3 s lets the chord ring under the glide: no cut)
    const off = starEngine({ chord: false });
    const offHeard: string[] = [];
    frameLoop(off, 15 * 60, STEP_MS, (k, events) => offHeard.push(...events.map((e) => String(e.loop))));
    expect(offHeard.filter((k) => k !== "pluck")).toEqual([]);
    expect(offHeard.length).toBe(41);
  });

  it("schedules the plucks, the chord and the glide on the audio clock through the export's dispatcher (fake Web Audio)", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    const engine = starEngine();
    const v = engine.getStarChordsView();
    frameLoop(engine, 14 * 60, STEP_MS, (k, events) => {
      graph.ctx.currentTime = (k * STEP_MS) / 1000;
      for (const ev of events) playSoundEvent(tone, ev, () => {});
    });
    // the first bounce of every ball: its pitch started at the bounce's frame
    for (let i = 0; i < v.count; i++) {
      const first = 12 / v.stars[i].n;
      const frame = Math.ceil((first * 1000) / STEP_MS - 1e-6);
      const at = (frame * STEP_MS) / 1000;
      expect(graph.oscillators.some((o) => Math.abs(o.frequency - v.pitch[i]) < 1e-6 && Math.abs(o.startAt - at) < 1e-9), `ball ${i}`).toBe(true);
    }
    // the completion chord at 12 s: the open voicing on A2 (110, 165, 220, 330 Hz)
    const chordAt = (720 * STEP_MS) / 1000;
    const atChord = graph.oscillators.filter((o) => Math.abs(o.startAt - chordAt) < 0.07).map((o) => Math.round(o.frequency));
    for (const f of [110, 165, 220, 330]) expect(atChord).toContain(f);
    // the reset glide: an exponential ramp to an octave under the first note, ending with the fade
    const glideEnd = (792 * STEP_MS) / 1000 + 1.8;
    expect(graph.ramps.some((r) => r.kind === "exp" && r.param === "frequency" && Math.abs(r.value - v.pitch[4] / 2) < 1e-6 && Math.abs(r.time - glideEnd) < 1e-6)).toBe(true);
  });
});

describe("Chord Stars: settings, presets and links", () => {
  it("has the clip's defaults, floors every number at its minimum (no maximum) and keeps the run's numbers engine-side", () => {
    const d = defaultStarChordsFields();
    expect(d).toMatchObject({ scBalls: 5, scStars: DEFAULT_STARS, scCycle: 12, scHold: 1.2, scFade: 1.8, scSpread: 1, scLineWidth: 1.5, scEnvelope: "closed", scPalette: "pastel", scVoice: "pluck", scChord: true });
    const r = resolveStarChordsFields({ scBalls: 7.6, scCycle: -3, scHold: "2.5", scFade: 1e9, scSpread: "x", scLineWidth: 0, scEnvelope: "nope", scStars: "", scChord: "yes" });
    expect(r).toMatchObject({ scBalls: 8, scCycle: SC_RANGES.scCycle.min, scHold: 2.5, scFade: 1e9, scSpread: 1, scLineWidth: SC_RANGES.scLineWidth.min, scEnvelope: "closed", scStars: DEFAULT_STARS, scChord: true });
    expect(resolveStarChordsSettings({ balls: 1e9 }).balls).toBe(ENTITY_CEILING);
    expect(SC_ENGINE_KEYS).toEqual(["scBalls", "scCycle", "scHold", "scFade", "scSpread"]);
    expect(starChordsSettingsOf({ ...d, scStars: "7/2,7/3" }).stars).toEqual([{ n: 7, k: 2 }, { n: 7, k: 3 }]);
  });

  it("round-trips every field through the URL and presets; the look starts navy only in Chord Stars", () => {
    const s = { ...defaultSettings("starChords"), scBalls: 9, scStars: "5/2,11/4,13/5", scCycle: 7.333, scHold: 0.4, scFade: 2.2, scSpread: 1 / 7, scLineWidth: 2.5, scEnvelope: "on" as const, scPalette: "rainbow" as const, scVoice: "bar" as const, scChord: false };
    const params = settingsToSearchParams(s);
    for (const key of ["scn", "scs", "sct", "sch", "scf", "scsp", "scw", "sce", "scp", "scv", "scc"]) expect(params.has(key), key).toBe(true);
    const back = settingsFromSearchParams(params);
    for (const key of ["scBalls", "scStars", "scCycle", "scHold", "scFade", "scLineWidth", "scEnvelope", "scPalette", "scVoice", "scChord"] as const) expect(back[key], key).toEqual(s[key]);
    expect(back.scSpread).toBeCloseTo(1 / 7, 6);
    expect(settingsToSearchParams(defaultSettings("starChords")).has("scn")).toBe(false);
    expect(presetToSettings({ mode: "starChords", scBalls: 3, scStars: "garbage" } as never)).toMatchObject({ scBalls: 3, scStars: DEFAULT_STARS });
    expect(defaultSettings("starChords")).toMatchObject({ backgroundColors: ["#0b1020", "#0b1020"], circleColor: "#b9a8ff", loopHud: true });
    expect(starChordsModeDefaults("classic")).toEqual({});
    expect(defaultSettings("classic").loopHud).toBe(false);
  });

  it("names three presets: Five stars, Seven-point bloom and Heptagram duel", () => {
    expect([...SC_PRESET_IDS]).toEqual(["fiveStars", "sevenBloom", "heptagramDuel"]);
    expect(starChordsPresetPatch("fiveStars")).toMatchObject({ scBalls: 5, scStars: DEFAULT_STARS, loopHud: true });
    const bloom = starChordsPresetPatch("sevenBloom");
    expect(bloom).toMatchObject({ scBalls: 7, scEnvelope: "on" });
    expect(parseStars(bloom.scStars)).toHaveLength(7);
    expect(bloom.scSpread).toBeCloseTo(1 / 7, 12);
    expect(starChordsPresetPatch("heptagramDuel")).toMatchObject({ scBalls: 2, scStars: "7/2,7/3" });
    for (const locale of [en, pl, es]) for (const id of SC_PRESET_IDS) expect((locale.Controls as Record<string, string>)[`scPreset${id[0].toUpperCase()}${id.slice(1)}`]).toBeTruthy();
  });

  it("puts its block in the Mode group, with every control translated in every locale", () => {
    expect(MODE_BLOCK_KEYS.starChords).toEqual(STAR_CHORDS_KEYS);
    expect(wallControlsOf("starChords")).toEqual({ wallCount: false, thickness: true, gapControls: false, gapSize: false });
    for (const locale of [en, pl, es]) {
      const c = locale.Controls as Record<string, string>;
      for (const key of STAR_CHORDS_KEYS) expect(c[key], key).toBeTruthy();
      for (const key of ["modeStarChords", "scStarDesc", "scLoopNote", "scStarsRandom", "scEnvelopeClosed", "scVoiceSilent", "scPaletteBall"]) expect(c[key], key).toBeTruthy();
      expect(locale.Modes.starChords.name).toBeTruthy();
    }
  });
});

describe("Chord Stars: Find Simulation searches star sets", () => {
  it("draws random coprime sets with distinct point counts, and scores an even spread of inner circles higher", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const set = randomStarSet(5, seededRandom(seed));
      expect(new Set(set.map((s) => s.n)).size).toBe(5);
      for (const s of set) expect(isProperStar(s), `${s.n}/${s.k}`).toBe(true);
    }
    expect(serializeStars(randomStarSet(5, seededRandom(42)))).toBe(serializeStars(randomStarSet(5, seededRandom(42))));
    expect(starSetScore(parseStars(DEFAULT_STARS))).toBeGreaterThan(starSetScore(parseStars("5/2,7/2,9/2,11/2,13/2")));
    expect(starSetScore(parseStars("5/2,5/2"))).toBe(-Infinity);
    expect(starSetScore(parseStars("10/4"))).toBe(-Infinity);
    // the search keeps the best of its draws: better than the clip's own set, and never worse with more draws (the same seeds first)
    const best = searchStarSets(5, 300, (i) => 1000 + i);
    expect(best.tested).toBe(300);
    expect(best.score).toBeGreaterThan(starSetScore(parseStars(DEFAULT_STARS)));
    expect(searchStarSets(5, 1000, (i) => 1000 + i).score).toBeGreaterThanOrEqual(best.score);
  });

  it("fits the drawing time to the clip in whole loops of drawing + hold + fade", () => {
    expect(cycleForClip(30, 1.2, 1.8, 12, 1)).toEqual({ cycleSec: 12, loops: 2 });
    expect(cycleForClip(19, 1.2, 1.8, 12, 1)).toEqual({ cycleSec: 16, loops: 1 });
    const fit = cycleForClip(31, 1.2, 1.8, 7, 1)!;
    expect(fit.loops * periodOf(fit.cycleSec, 1.2, 1.8)).toBeCloseTo(31, 9);
    expect(cycleForClip(3.5, 1.2, 1.8, 12, 1)).toBeNull();
  });

  it("answers the page's search at once: the best set, the loop fitted to the clip, an outcome of its own", async () => {
    const modeSettings = { ...baseModeSettings, starChords: resolveStarChordsSettings(null) };
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 200, maxSimTimeSec: 60, physicsConfig: config, mode: "starChords", modeSettings, outcome: { kind: "star-set", clipSec: 30 } };
    const a = findStarChordsRun(request, 77);
    const b = findStarChordsRun(request, 77);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ found: true, outcome: "star-set", duration: 30, seedsTested: 200 });
    const found = a.starChords!;
    expect(found.loops).toBe(2);
    expect(found.cycleSec).toBeCloseTo(12, 9);
    const stars = parseStars(found.stars);
    expect(new Set(stars.map((s) => s.n)).size).toBe(5);
    for (const s of stars) expect(isProperStar(s)).toBe(true);
    const viaPage = await findSimulation(request, () => {});
    expect(viaPage).toMatchObject({ found: true, outcome: "star-set" });
    expect(findStarChordsRun({ ...request, targetDurationSec: 3 }, 77)).toMatchObject({ found: false, outcome: "star-set" });
    expect(runNeverFinishes("starChords", { drop: {}, box: {} })).toBe(true);
    expect(availableOutcomes("starChords", { endless: true, neverEscape: false, ballCount: 1 })).toEqual(["star-set"]);
  });
});

describe("Chord Stars: the loop HUD and the caption", () => {
  it("counts the stars closed of all, in a two-line subtitle", () => {
    const engine = starEngine();
    expect(loopHudCount(engine)).toEqual({ count: 0, total: 5 });
    frameLoop(engine, 12 * 60, STEP_MS);
    expect(loopHudCount(engine)).toEqual({ count: 5, total: 5 });
    // through the hold (12–13.2 s) and the first half of the fade (13.2–14.1 s) it reads 5/5; then back at 0/5 – the clip's
    // last frames read like its first (the run itself still counts its five closed stars until the seam)
    frameLoop(engine, 2 * 60 - 6, STEP_MS); // 13.9 s
    expect(engine.getStarChordsView().phase).toBe("fade");
    expect(loopHudCount(engine)).toEqual({ count: 5, total: 5 });
    frameLoop(engine, 30, STEP_MS); // 14.4 s
    expect(loopHudCount(engine)).toEqual({ count: 0, total: 5 });
    expect(engine.getStarChordsView().closed).toBe(5);
    frameLoop(engine, 36, STEP_MS); // 15.0 s: the seam, the next cycle's first frame
    expect(engine.getStarChordsView()).toMatchObject({ cycles: 1, phase: "draw", closed: 0 });
    expect(loopHudCount(engine)).toEqual({ count: 0, total: 5 });
    // with no hold the payoff still shows: 5/5 at the closing, 0/5 halfway through the fade
    const noHold = starEngine({ holdSec: 0 });
    frameLoop(noHold, 12 * 60, STEP_MS);
    expect(loopHudCount(noHold)).toEqual({ count: 5, total: 5 });
    expect(hudCounterText(String(en.LoopHud.starChordsCounter), { count: 3, total: 5 })).toBe("stars closed 3/5");
    for (const locale of [en, pl, es]) expect(subtitleLines(String(locale.LoopHud.starChordsSubtitle))).toHaveLength(2);
    expect(subtitleLines("one line")).toEqual(["one line"]);
  });

  it("writes the loop-style caption from the balls: math and geometry tags after #satisfying #oddlysatisfying", () => {
    expect(loopCaptionContext({ mode: "starChords", recordingDuration: 30, scBalls: 5 })).toEqual({ mode: "starChords", hookKey: "starChords", factKey: "starChordsFact", count: 5 });
    expect(loopHashtags("starChords")).toEqual(["#satisfying", "#oddlysatisfying", "#math", "#geometry", "#creativecoding"]);
  });
});

describe("Chord Stars: determinism of the code", () => {
  it("draws no random number and reads no clock in the mode, its maths or its renderer", () => {
    for (const file of ["src/lib/physics/modes/starChords.ts", "src/lib/physics/starChords.ts", "src/components/simulator/starChordsRenderer.ts"]) {
      const code = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    }
  });
});

/** The pinned fingerprints of the default run at 99 (any seed): 32 s of positions, bounces and counters, and its sounds. */
const STAR_CHORDS_STATE_PRINT = "41be2668";
const STAR_CHORDS_SOUND_PRINT = "1930c9a2";
