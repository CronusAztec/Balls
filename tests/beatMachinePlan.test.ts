import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { createEngineForSettings, findSimulation, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes } from "@/lib/simulation/outcomes";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import {
  BM_BASS_BEATS,
  BM_MARBLE_G,
  BM_TIME_EPS,
  BM_TUBE_CEILING,
  SEG_ARC,
  barFrequencies,
  buildPhrase,
  ladderFrequency,
  marblePosition,
  marbleState,
  maxActive,
  nearestBar,
  noteNameFrequency,
  originalMarblePhrase,
  parseNoteList,
  sampleSegment,
  stairsGravity,
  stairsPosition,
  tubeNeeds,
  type BeatMachinePlan,
} from "@/lib/simulation/beatMachinePlan";
import {
  BM_PRESET_IDS,
  BM_RANGES,
  BM_RESTART_FIELDS,
  DEFAULT_BEAT_MACHINE_FIELDS,
  beatMachinePresetPatch,
  beatMachineSettingsOf,
  beatMachineVariantPatch,
  readBeatMachineParams,
  resolveBeatMachineFields,
  resolveBeatMachineSettings,
  writeBeatMachineParams,
  type BeatMachineSettings,
} from "@/lib/physics/beatMachine";
import { beatMachinePlanOf, findBeatMachineRun } from "@/lib/simulation/beatMachineFinder";
import { BEAT_MACHINE_DATA_KEYS, BeatMachineLayer, beatMachineExtentPx, writeBeatMachineDataset } from "@/components/simulator/beatMachineRenderer";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { LOOP_HUD_MODE_TEXT, loopHudCount } from "@/lib/loop/hud";
import { loopCaptionContext } from "@/lib/publish/loopCaption";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { MAX_SOUNDS_PER_FRAME } from "@/lib/physics/limits";
import { fakeCanvas } from "./fakeCanvas";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- beat-machine --- Beat Machines (lib/simulation/beatMachinePlan.ts, lib/physics/beatMachine.ts, lib/physics/modes/
 * beatMachine.ts): the planner's promises – every strike on its note time, every release √(2h/g) before it, no marble needed
 * before it is back (or a spare), the staircase's beat-long flights and loop, continuous trajectories, a seed's plan replayed –
 * then the run in the engine (notes × loops, the seam equal to the start, the frame rate), the sounds through a real
 * ToneGenerator, the finder, the settings and the renderer.
 */

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
const STEP = 1000 / 60;

function bmEngine(patch: Partial<BeatMachineSettings> = {}, seed = 7, cfg: PhysicsConfig = config): PhysicsEngine {
  return createEngineForSettings(cfg, "beatMachine", { ...base, beatMachine: patch }, seed);
}

/** A plan straight from the planner (the original phrase drawn from a fixed generator). */
function plan(patch: Partial<BeatMachineSettings> = {}, seed = 3): BeatMachinePlan {
  return beatMachinePlanOf(resolveBeatMachineSettings(patch), rng(seed));
}

/** A small seeded generator. */
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

/** Steps `engine` `frames` times by `frameMs`, collecting every sound event. */
function run(engine: PhysicsEngine, frames: number, frameMs = STEP): SoundEvent[] {
  const out: SoundEvent[] = [];
  for (let k = 0; k < frames; k++) {
    engine.update(frameMs, 0);
    out.push(...engine.consumeSoundEvents());
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Beat Machines planner: the marble xylophone", () => {
  const variants: Partial<BeatMachineSettings>[] = [{}, { bpm: 60 }, { bpm: 180, bars: 6 }, { bars: 24, loopBeats: 64 }, { dropPct: 60, rebound: 1.2 }, { dropPct: 5, rebound: 0 }, { source: "scale" }, { bpm: 400, loopBeats: 8 }];

  it("1. strikes every bar exactly on its note time (within 1e-9 s): the fall lands on the bar's top then", () => {
    for (const patch of variants) {
      const p = plan(patch);
      const m = p.marbles!;
      expect(p.notes.length).toBeGreaterThan(0);
      for (const jr of m.journeys) {
        const note = p.notes[jr.note];
        expect(Math.abs(jr.strike - note.beat * p.beatSec)).toBeLessThan(1e-9);
        const fall = jr.segments[0];
        expect(fall.kind).toBe(SEG_ARC);
        expect(Math.abs(fall.t1 - jr.strike)).toBeLessThan(1e-9);
        const at = sampleSegment(fall, jr.strike, { x: 0, y: 0 });
        expect(Math.abs(at.y - m.strikeY)).toBeLessThan(1e-9);
        expect(at.x).toBeCloseTo(m.bars[jr.tube].x, 12);
      }
      // the note events are the notes' times, one each
      const noteEvents = p.events.filter((e) => e.kind === "note");
      expect(noteEvents.length).toBe(p.notes.length);
      for (const ev of noteEvents) expect(Math.abs(ev.t - p.notes[ev.note].beat * p.beatSec)).toBeLessThan(1e-9);
    }
  });

  it("2. releases every marble √(2h/g) before its note", () => {
    for (const patch of variants) {
      const p = plan(patch);
      const s = resolveBeatMachineSettings(patch);
      const drop = Math.sqrt((2 * (s.dropPct / 100)) / BM_MARBLE_G);
      expect(p.marbles!.dropSec).toBeCloseTo(drop, 12);
      for (const jr of p.marbles!.journeys) expect(Math.abs(jr.release - (jr.strike - drop))).toBeLessThan(1e-9);
    }
  });

  it("3. never needs a marble before it is back: each tube holds what its tune needs, or starts with a spare", () => {
    const state = marbleState();
    for (const patch of [...variants, { perTube: 1 }, { perTube: 3 }, { bars: 3, loopBeats: 32 }]) {
      const p = plan(patch);
      const m = p.marbles!;
      const limit = (patch.perTube ?? 0) > 0 ? patch.perTube! : 1;
      let spares = 0;
      for (const tube of m.tubes) {
        expect(tube.count).toBe(Math.max(limit, tube.needed));
        spares += Math.max(0, tube.needed - limit);
      }
      expect(p.spares).toBe(spares);
      // over three loops, just before every release the marble it takes is idle at the bottom of its tube
      for (let b = 0; b < m.tubes.length; b++) {
        const tube = m.tubes[b];
        const n = tube.journeys.length;
        for (let L = 0; L < 3; L++) {
          for (let i = 0; i < n; i++) {
            const g = L * n + i;
            const r = m.journeys[tube.journeys[i]].release + L * p.loopSec;
            const k = ((g % tube.count) + tube.count) % tube.count;
            marblePosition(p, b, k, r - 1e-7, state);
            expect([b, g, state.idle, state.slot]).toEqual([b, g, true, 0]);
          }
        }
      }
    }
  });

  it("3b. counts the marbles out at once on the periodic schedule (tubeNeeds, maxActive)", () => {
    // two notes 1 s apart on one bar, a trip of 1.5 s, a 4 s loop: the second needs a second marble
    expect(tubeNeeds(1, [0, 0], [0, 1], [1.5, 2.5], 4)).toEqual([2]);
    // a trip of 3.5 s in a 4 s loop: one marble is enough for one note a loop
    expect(tubeNeeds(1, [0], [0], [3.5], 4)).toEqual([1]);
    // a trip longer than the loop: the note of the loop before is still out
    expect(tubeNeeds(1, [0], [0], [9], 4)).toEqual([3]);
    // back exactly at the next release: in time
    expect(tubeNeeds(1, [0, 0], [0, 2], [2, 4], 4)).toEqual([1]);
    expect(maxActive([0, 1], [1.5, 2.5], 4)).toBe(2);
    expect(maxActive([0], [9], 4)).toBe(3);
    // the count is the loop-by-loop enumeration's (every loop a trip spans, the earlier releases of the same instant)
    const brute = (tubes: number, tubeOf: number[], release: number[], back: number[], period: number) => {
      const out = new Array<number>(tubes).fill(1);
      for (let i = 0; i < release.length; i++) {
        let n = 0;
        for (let j = 0; j < release.length; j++) {
          if (tubeOf[j] !== tubeOf[i]) continue;
          for (let L = 0; L < 200; L++) {
            const r = release[j] - L * period;
            if (L === 0 && (r > release[i] || (r === release[i] && j >= i))) continue;
            if (r <= release[i] && back[j] - L * period > release[i] + BM_TIME_EPS) n++;
          }
        }
        out[tubeOf[i]] = Math.max(out[tubeOf[i]], n + 1);
      }
      return out;
    };
    const random = rng(11);
    for (let trial = 0; trial < 60; trial++) {
      const n = 1 + Math.floor(random() * 12);
      const period = [1, 2.5, 4][trial % 3];
      const tubeOf = Array.from({ length: n }, () => Math.floor(random() * 3));
      const release = Array.from({ length: n }, () => Math.round(random() * 8) * 0.25 * period - 0.3);
      const back = release.map((r, j) => r + (j % 4 === 0 ? Math.round(random() * 4) * period : random() * 9 * period));
      expect(tubeNeeds(3, tubeOf, release, back, period), `trial ${trial}`).toEqual(brute(3, tubeOf, release, back, period));
    }
    // a trip a hundred million billion loops long is counted, not walked
    expect(tubeNeeds(1, [0], [0], [4e17], 4)[0]).toBeGreaterThan(1e16);
  });

  it("5. keeps every marble's trajectory continuous (segment joins, releases, the stack's settle, the drop into the tube)", () => {
    const state = marbleState();
    const p = plan({}, 9);
    const m = p.marbles!;
    for (const jr of m.journeys)
      for (let k = 1; k < jr.segments.length; k++) {
        const a = sampleSegment(jr.segments[k - 1], jr.segments[k - 1].t1, { x: 0, y: 0 });
        const b = sampleSegment(jr.segments[k], jr.segments[k].t0, { x: 0, y: 0 });
        expect(Math.abs(jr.segments[k - 1].t1 - jr.segments[k].t0)).toBeLessThan(1e-12);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
      }
    // sampled densely over two loops, no marble jumps more than its fastest speed allows (~3 units/s) in 1 ms
    const dt = 0.001;
    let worst = 0;
    for (let b = 0; b < m.tubes.length; b++)
      for (let k = 0; k < m.tubes[b].count; k++) {
        marblePosition(p, b, k, 0, state);
        let x = state.x;
        let y = state.y;
        for (let t = dt; t < 2 * p.loopSec; t += dt) {
          marblePosition(p, b, k, t, state);
          worst = Math.max(worst, Math.hypot(state.x - x, state.y - y));
          x = state.x;
          y = state.y;
        }
      }
    expect(worst).toBeLessThan(0.006);
  });

  it("puts the machine back exactly as it started at the loop point (each tube's marbles as a set)", () => {
    const state = marbleState();
    for (const patch of [{}, { bars: 6, bpm: 140 }, { perTube: 4 }]) {
      const p = plan(patch);
      const m = p.marbles!;
      for (let b = 0; b < m.tubes.length; b++) {
        const at = (t: number) =>
          Array.from({ length: m.tubes[b].count }, (_, k) => {
            marblePosition(p, b, k, t, state);
            return [Math.round(state.x * 1e9), Math.round(state.y * 1e9)];
          }).sort((u, v) => u[1] - v[1] || u[0] - v[0]);
        expect(at(p.loopSec)).toEqual(at(0));
        expect(at(3 * p.loopSec)).toEqual(at(0));
      }
    }
  });

  it("lays the bars out low to high in the Sound section's scale (the free scale plays the major pentatonic), rainbow left to right", () => {
    const c = barFrequencies(10, "chromatic", 0);
    expect(c[0]).toBeCloseTo(261.63, 1); // C4
    expect(c[5]).toBeCloseTo(523.25, 1); // C5
    expect(c[9]).toBeCloseTo(880, 1); // A5
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
    const a = barFrequencies(7, "minor", 9);
    expect(a[0]).toBeCloseTo(220, 1); // A3
    const p = plan();
    expect(p.marbles!.bars.map((b) => b.color)).toEqual(["#c0473f", "#c08a3f", "#a6b33f", "#5bb33f", "#3fb36a", "#3fc8d0", "#3f8ec8", "#3f55c8", "#6a3fc8", "#b33fc8"]);
  });

  it("plays the phrase bass every two bars, on the window's lowest note in the bass register", () => {
    const p = plan({ loopBeats: 32 });
    const bass = p.events.filter((e) => e.kind === "bass");
    expect(bass.length).toBe(32 / BM_BASS_BEATS);
    for (const ev of bass) {
      expect(ev.frequency).toBeGreaterThanOrEqual(55);
      expect(ev.frequency).toBeLessThan(110);
      expect(Math.abs(ev.t / p.beatSec - Math.round(ev.t / p.beatSec))).toBeLessThan(1e-9);
    }
    expect(plan({ bass: false }).events.some((e) => e.kind === "bass")).toBe(false);
  });
});

describe("Beat Machines planner: the staircase", () => {
  it("4. flies every hop in exactly 60 / BPM, landing on each step's top, and loops in (steps + return beats) · 60 / BPM", () => {
    for (const [steps, bpm, ret] of [
      [8, 80, 4],
      [16, 80, 4],
      [1, 120, 3],
      [5, 200, 1],
      [6, 90, 0],
      [3, 60, 9],
    ]) {
      const p = plan({ variant: "stairs", steps, bpm, returnBeats: ret });
      const T = 60 / bpm;
      const s = p.stairs!;
      expect(p.beatSec).toBeCloseTo(T, 12);
      expect(p.loopSec).toBeCloseTo((steps + ret) * T, 12);
      for (let k = 0; k + 1 < steps; k++) {
        const seg = s.segments[k];
        expect(seg.t1 - seg.t0).toBeCloseTo(T, 12);
        const end = sampleSegment(seg, seg.t1, { x: 0, y: 0 });
        expect(end.x).toBeCloseTo(s.steps[k + 1].landX, 9);
        expect(end.y).toBeCloseTo(s.steps[k + 1].landY, 9);
      }
      // every landing is a note on its beat
      const notes = p.events.filter((e) => e.kind === "note");
      expect(notes.map((e) => Math.round(e.t / T))).toEqual(Array.from({ length: steps }, (_, k) => k));
      for (let k = 0; k < steps; k++) {
        const at = stairsPosition(p, k * T, { x: 0, y: 0 });
        expect(Math.hypot(at.x - s.steps[k].landX, at.y - s.steps[k].landY)).toBeLessThan(1e-9);
      }
      // the segments cover the loop end to end
      expect(s.segments[0].t0).toBe(0);
      expect(s.segments[s.segments.length - 1].t1).toBeCloseTo(p.loopSec, 12);
      // the reset glide ends exactly at the loop point
      const glide = p.events.find((e) => e.kind === "glide");
      if (ret > 0) expect(glide!.t + glide!.seconds).toBeCloseTo(p.loopSec, 9);
      else expect(glide).toBeUndefined();
    }
  });

  it("solves the gravity from the beat, the step's drop and the apex (the take-off goes up, the landing comes down)", () => {
    const T = 0.75;
    const g = stairsGravity(T, 0.079, 0.095);
    const vy = (0.079 - 0.5 * g * T * T) / T;
    expect(vy).toBeLessThan(0);
    expect((vy * vy) / (2 * g)).toBeCloseTo(0.095, 9);
    expect(vy + g * T).toBeGreaterThan(0);
  });

  it("5. keeps the ball's path continuous at every join (hops, the hook, the track, the tip) and repeats it every loop", () => {
    for (const patch of [{ variant: "stairs" as const }, { variant: "stairs" as const, returnBeats: 1 }, { variant: "stairs" as const, returnBeats: 0, steps: 4 }, { variant: "stairs" as const, steps: 16, stepDx: 4.6, stepDy: 4.4 }]) {
      const p = plan(patch);
      const segs = p.stairs!.segments;
      for (let k = 1; k < segs.length; k++) {
        const a = sampleSegment(segs[k - 1], segs[k - 1].t1, { x: 0, y: 0 });
        const b = sampleSegment(segs[k], segs[k].t0, { x: 0, y: 0 });
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
      }
      const end = sampleSegment(segs[segs.length - 1], segs[segs.length - 1].t1, { x: 0, y: 0 });
      const start = sampleSegment(segs[0], 0, { x: 0, y: 0 });
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(1e-9);
      const a = stairsPosition(p, 0.3, { x: 0, y: 0 });
      const b = stairsPosition(p, 0.3 + 5 * p.loopSec, { x: 0, y: 0 });
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
    }
  });

  it("plays the ladder (step k on degree k) for a scale run, the melody's notes when it supplies them", () => {
    const ladder = buildPhrase({ variant: "stairs", source: "scale", slots: 8, loopBeats: 32, melody: [], custom: "", scale: "chromatic", root: 0 }, rng(1));
    expect(ladder.notes.map((n) => Math.round(n.frequency))).toEqual([262, 294, 330, 392, 440, 523, 587, 659]);
    const melody = buildPhrase({ variant: "stairs", source: "melody", slots: 3, loopBeats: 32, melody: [100, 200], custom: "", scale: "chromatic", root: 0 }, rng(1));
    expect(melody.notes.map((n) => n.frequency)).toEqual([100, 200, 100]);
    expect(ladderFrequency(0, 8, "pentatonic", 9)).toBeCloseTo(220, 1);
  });
});

describe("Beat Machines planner: phrases", () => {
  it("6. writes the same original phrase for the same seed, another for another seed (and never a copied tune: a seeded walk)", () => {
    const a = originalMarblePhrase(10, 32, rng(5));
    const b = originalMarblePhrase(10, 32, rng(5));
    const c = originalMarblePhrase(10, 32, rng(6));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a[0].beat).toBe(0);
    for (const n of a) {
      expect(n.beat).toBeGreaterThanOrEqual(0);
      expect(n.beat).toBeLessThan(32);
      expect(n.slot).toBeGreaterThanOrEqual(0);
      expect(n.slot).toBeLessThan(10);
    }
    // the last note comes home to a tonic bar (0, 5 in the pentatonic)
    expect([0, 5]).toContain(a[a.length - 1].slot);
  });

  it("6. replays a seed's plan in the engine (and the finder's plans are the engine's)", () => {
    const one = bmEngine({}, 11).getBeatMachineView().plan;
    const two = bmEngine({}, 11).getBeatMachineView().plan;
    const other = bmEngine({}, 12).getBeatMachineView().plan;
    expect(two.notes).toEqual(one.notes);
    expect(two.events).toEqual(one.events);
    expect(other.notes).not.toEqual(one.notes);
  });

  it("reads typed lists and note names, maps a melody onto the nearest bars and falls back to the original phrase when empty", () => {
    expect(parseNoteList("1 3 - 5, C4 x")).toEqual([{ slot: 0 }, { slot: 2 }, null, { slot: 4 }, { frequency: noteNameFrequency("C4") }, null]);
    expect(noteNameFrequency("A4")).toBeCloseTo(440, 6);
    expect(noteNameFrequency("Bb3")).toBeCloseTo(233.08, 1);
    const bars = barFrequencies(10, "chromatic", 0);
    expect(nearestBar(440, bars)).toBe(4);
    expect(nearestBar(110, bars)).toBe(4); // folded up two octaves
    expect(nearestBar(3520, bars)).toBe(9); // folded down: A7 → A5
    const custom = buildPhrase({ variant: "marbles", source: "custom", slots: 10, loopBeats: 8, melody: [], custom: "1 - 3", scale: "chromatic", root: 0 }, rng(1));
    expect(custom.source).toBe("custom");
    expect(custom.notes.map((n) => [n.beat, n.slot])).toEqual([
      [0, 0],
      [2, 2],
      [3, 0],
      [5, 2],
      [6, 0],
    ]);
    expect(buildPhrase({ variant: "marbles", source: "custom", slots: 10, loopBeats: 8, melody: [], custom: " - ", scale: "chromatic", root: 0 }, rng(1)).source).toBe("original");
    expect(buildPhrase({ variant: "marbles", source: "melody", slots: 10, loopBeats: 8, melody: [], custom: "", scale: "chromatic", root: 0 }, rng(1)).source).toBe("original");
    const melody = buildPhrase({ variant: "marbles", source: "melody", slots: 10, loopBeats: 4, melody: [261.63, 440], custom: "", scale: "chromatic", root: 0 }, rng(1));
    expect(melody.notes.map((n) => n.slot)).toEqual([0, 4, 0, 4]);
  });
});

describe("Beat Machines in the engine", () => {
  it("plays notes × loops sound events and comes back to its start at every seam (marbles and stairs, 2 loops at 2×)", () => {
    for (const patch of [{}, { variant: "stairs" as const, bpm: 80 }, { variant: "stairs" as const, steps: 16, source: "scale" as const }]) {
      const engine = bmEngine(patch, 3);
      const v = engine.getBeatMachineView();
      const loop = v.plan.loopSec;
      const frames = Math.ceil((2 * loop * 1000) / (2 * STEP)) + 2;
      const events = run(engine, frames, 2 * STEP);
      const noteKind = v.plan.variant === "stairs" ? "pluck" : "bar";
      expect(v.seams).toBeGreaterThanOrEqual(2);
      expect(v.seamNotes.slice(0, 2)).toEqual([v.plan.notes.length, 2 * v.plan.notes.length]);
      expect(v.seamError).toBeLessThan(1e-6);
      expect(v.nonFinite).toBe(0);
      const played = events.filter((e) => e.loop === noteKind).length;
      expect(played).toBe(v.notes);
      expect(events.every((e) => e.melody === false && e.loop !== undefined)).toBe(true);
      if (v.plan.variant === "stairs") expect(events.filter((e) => e.loop === "glide").length).toBeGreaterThanOrEqual(2);
      else expect(events.filter((e) => e.loop === "bass").length).toBeGreaterThanOrEqual(2 * (v.plan.loopBeats / BM_BASS_BEATS));
    }
  });

  it("replays the same run at 30, 60 and 120 frames a second (the notes and the balls at 5 s)", () => {
    const at = (fps: number) => {
      const engine = bmEngine({}, 4);
      const events = run(engine, 5 * fps, 1000 / fps);
      const balls = engine.getBalls().map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]);
      return { notes: events.filter((e) => e.loop === "bar").map((e) => Math.round((e.frequency ?? 0) * 100)), balls };
    };
    const ref = at(60);
    expect(ref.notes.length).toBeGreaterThan(5);
    expect(at(30)).toEqual(ref);
    expect(at(120)).toEqual(ref);
  });

  it("reports its loop (the loop contract) and counts the loop's notes for the HUD", () => {
    const engine = bmEngine({ counter: true }, 3);
    const loop = engine.getBeatMachineView().plan.loopSec;
    expect(loop).toBeCloseTo(19.2, 9);
    expect(engine.getCycleSeconds?.() ?? engine.getBeatMachineView().plan.loopSec).toBeCloseTo(19.2, 9);
    expect(engine.getLoopSeams()).toMatchObject({ count: 0, lastMs: -1 });
    run(engine, 120);
    const count = loopHudCount(engine);
    expect(count).toMatchObject({ total: engine.getBeatMachineView().plan.notes.length });
    expect((count as { count: number }).count).toBe(engine.getBeatMachineView().loopNotes);
    expect(bmEngine({ counter: false }).getBeatMachineHudCount()).toBeNull();
  });

  it("schedules its sounds on a ToneGenerator at the context's time (fakeAudio): the bars' pitches, the bass, the glide", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
    const playLoop = vi.spyOn(tone, "playLoop");
    const engine = bmEngine({}, 3);
    let sent = 0;
    for (let k = 0; k < 600; k++) {
      engine.update(STEP, 0);
      graph.ctx.currentTime = engine.getElapsedMs() / 1000;
      for (const ev of engine.consumeSoundEvents()) {
        playSoundEvent(tone, ev, () => undefined);
        sent++;
      }
    }
    expect(playLoop).toHaveBeenCalledTimes(sent);
    expect(sent).toBe(engine.getBeatMachineView().sounds);
    const bars = engine.getBeatMachineView().plan.marbles!.bars.map((b) => b.frequency);
    expect(graph.oscillators.some((o) => bars.some((f) => Math.abs(o.frequency - f) < 1e-6))).toBe(true);
    // the bass: a triangle in the bass register
    expect(graph.oscillators.some((o) => o.type === "triangle" && o.frequency >= 55 && o.frequency <= 220)).toBe(true);
    expect(playLoop.mock.calls.some((c) => c[0] === "bass")).toBe(true);
    // the staircase's landings are plucks, its return a glide
    const stairs = bmEngine({ variant: "stairs", bpm: 80 }, 3);
    const events = run(stairs, 9 * 60 - 5); // (the loop is 9 s: its 9th note is the next loop's first)
    expect(events.filter((e) => e.loop === "pluck").length).toBe(8);
    expect(events.filter((e) => e.loop === "glide").length).toBe(1);
  });

  it("finds a seeded phrase with no tube conflict, and the busiest one (no seed simulated: a plan a seed)", async () => {
    const request = { targetDurationSec: 30, toleranceSec: 1, maxSeeds: 40, maxSimTimeSec: 60, physicsConfig: config, mode: "beatMachine" as const, modeSettings: { ...base, beatMachine: { perTube: 3 } } };
    const none = await findSimulation({ ...request, outcome: { kind: "no-tube-conflict", clipSec: 30 } }, () => undefined);
    expect(none.outcome).toBe("no-tube-conflict");
    if (none.found) expect(none.beatMachine!.spares).toBe(0);
    expect(none.duration).toBeCloseTo(none.beatMachine!.loops * none.beatMachine!.loopSec, 9);
    const busy = await findSimulation({ ...request, outcome: { kind: "most-in-flight", clipSec: 30 } }, () => undefined);
    expect(busy.found).toBe(true);
    expect(busy.seedsTested).toBe(40);
    // the busiest seed's plan is the engine's for that seed
    expect(bmEngine({ perTube: 3 }, busy.seed).getBeatMachineView().plan.inFlightMax).toBe(busy.beatMachine!.inFlightMax);
    for (let s = 1; s <= 40; s++) expect(bmEngine({ perTube: 3 }, s).getBeatMachineView().plan.inFlightMax).toBeLessThanOrEqual(busy.beatMachine!.inFlightMax);
    // a phrase that is not seeded is one plan
    const scale = findBeatMachineRun({ targetDurationSec: 30, maxSeeds: 40, modeSettings: { ...base, beatMachine: { source: "scale" } }, outcome: { kind: "most-in-flight", clipSec: 30 } }, (seed) => bmEngine({ source: "scale" }, seed).getBeatMachineView().plan);
    expect(scale.seedsTested).toBe(1);
    // the outcomes are the marble machine's
    expect(availableOutcomes("beatMachine", { endless: true, neverEscape: false, ballCount: 1, bmMarbles: true })).toEqual(["no-tube-conflict", "most-in-flight"]);
    expect(availableOutcomes("beatMachine", { endless: true, neverEscape: false, ballCount: 1, bmMarbles: false })).toEqual([]);
  });
});

describe("Beat Machines: settings, links, presets, the page", () => {
  it("round-trips its fields through the link (bm… keys) and keeps values past the sliders (uncapped from the minimum)", () => {
    const s = { ...defaultSettings("beatMachine"), bmVariant: "stairs" as const, bmBpm: 1234, bmSteps: 99, bmStepDx: 3.25, bmReturn: 70, bmSource: "custom" as const, bmNotes: "1 3 5 C4", bmPerTube: 7, bmLoopBeats: 2000, bmBass: false, bmCounter: true };
    const back = settingsFromSearchParams(settingsToSearchParams(s));
    for (const key of Object.keys(DEFAULT_BEAT_MACHINE_FIELDS) as (keyof typeof DEFAULT_BEAT_MACHINE_FIELDS)[]) expect([key, back[key]]).toEqual([key, s[key]]);
    const params = new URLSearchParams();
    writeBeatMachineParams({ ...DEFAULT_BEAT_MACHINE_FIELDS, bmBars: 12 }, DEFAULT_BEAT_MACHINE_FIELDS, params);
    expect(params.toString()).toBe("bmB=12");
    // invalid values fall back, small values lift to the minimum, whole counts round
    const fields = { ...DEFAULT_BEAT_MACHINE_FIELDS };
    readBeatMachineParams(new URLSearchParams("bmV=organ&bmBpm=-5&bmB=7.6&bmSrc=nope&bmBs=2"), fields);
    expect(fields).toMatchObject({ bmVariant: "marbles", bmBpm: BM_RANGES.bmBpm.min, bmBars: 8, bmSource: "original", bmBass: true });
    expect(resolveBeatMachineFields({ bmDrop: 500, bmRebound: 9 })).toMatchObject({ bmDrop: 500, bmRebound: 9 });
    // bounce math's bmr / bmh and the beat markers' bm are other keys
    expect(settingsFromSearchParams(new URLSearchParams("mode=beatMachine&bm=1,2")).bmVariant).toBe("marbles");
  });

  it("runs past its memory-safety ceilings at the ceiling, keeping the typed value", () => {
    const s = resolveBeatMachineSettings({ bars: 1e9, perTube: 1e6, steps: 1e9, loopBeats: 1e9 });
    expect([s.bars, s.perTube, s.steps, s.loopBeats]).toEqual([MEMORY_CEILINGS.bmBars, MEMORY_CEILINGS.bmPerTube, MEMORY_CEILINGS.bmSteps, MEMORY_CEILINGS.bmLoopBeats]);
    const engine = bmEngine({ bars: 60, perTube: 50 });
    expect(engine.getBeatMachineView().balls).toBeLessThanOrEqual(2000);
  });

  it("plans and plays settings far past every slider without stalling: trips billions of loops long, loops far shorter than a step", () => {
    expect(BM_TUBE_CEILING).toBe(MEMORY_CEILINGS.bmPerTube);
    const started = Date.now();
    const p = plan({ bpm: 1e9, dropPct: 1e9, rebound: 1e9, bars: 2, loopBeats: 64, perTube: 1e9 });
    expect(p.marbles!.tubes.every((tube) => tube.count <= BM_TUBE_CEILING && tube.needed <= BM_TUBE_CEILING)).toBe(true);
    expect(p.inFlightMax).toBeLessThanOrEqual(p.ballCount);
    for (const patch of [
      { bpm: 1e9, dropPct: 1e9, rebound: 1e9, bars: 2, loopBeats: 64 },
      { bpm: 1e300, loopBeats: 4096, bars: 1000, perTube: 200 },
      { variant: "stairs" as const, bpm: 1e9, steps: 5000, returnBeats: 1e9, stepDx: 1e9, stepDy: 1e9 },
      { variant: "stairs" as const, bpm: 1e300, steps: 3, returnBeats: 0 },
    ]) {
      const engine = bmEngine(patch, 3);
      for (let k = 0; k < 8; k++) {
        engine.update(STEP, 0);
        expect(engine.consumeSoundEvents().length).toBeLessThanOrEqual(MAX_SOUNDS_PER_FRAME);
      }
      const v = engine.getBeatMachineView();
      expect(v.nonFinite).toBe(0);
      expect(engine.getBalls().every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true);
      if (v.plan.loopSec < STEP / 1000) {
        // loops by the million a step: counted, the step's few notes sounding
        expect(v.seams).toBeGreaterThan(8);
        expect(v.notes).toBeGreaterThan(v.sounds);
      }
    }
    expect(Date.now() - started).toBeLessThan(60_000);
  });

  it("starts with the marble xylophone's look, switches the tempo and the page with the variant, and loads its presets", () => {
    const d = defaultSettings("beatMachine");
    expect(d).toMatchObject({ bmVariant: "marbles", bmBpm: 100, backgroundType: "gradient", backgroundColors: ["#18120e", "#241a13"], loopHud: true });
    expect(defaultSettings("classic").loopHud).toBe(false);
    const patch = beatMachineVariantPatch(d, "stairs");
    expect(patch).toMatchObject({ bmVariant: "stairs", bmBpm: 80, backgroundType: "solid", backgroundColors: ["#07101a", "#07101a"] });
    expect(beatMachineVariantPatch({ ...d, bmBpm: 123 }, "stairs").bmBpm).toBeUndefined();
    for (const id of BM_PRESET_IDS) {
      const preset = presetToSettings({ mode: "beatMachine", ...beatMachinePresetPatch(id) });
      expect(preset.mode).toBe("beatMachine");
      const engine = bmEngine(beatMachineSettingsOf(preset), 2);
      expect(engine.getBeatMachineView().plan.notes.length).toBeGreaterThan(0);
    }
    expect(beatMachinePresetPatch("eightSteps")).toMatchObject({ bmVariant: "stairs", bmSteps: 8, bmBpm: 80 });
    expect(beatMachinePresetPatch("scaleStairs")).toMatchObject({ bmVariant: "stairs", bmSteps: 16, bmSource: "scale" });
    expect(beatMachinePresetPatch("xylophone")).toMatchObject({ bmVariant: "marbles", bmBars: 10, bmBpm: 100, bmSource: "original" });
    expect(beatMachinePresetPatch("yourMelody")).toMatchObject({ bmVariant: "marbles", bmSource: "melody" });
    expect(BM_RESTART_FIELDS).not.toContain("bmCounter");
  });

  // --- review fix (beat-machine) --- the scale, the root and the loaded melody are every mode's: in another mode a change of
  // them must not drop a found result (a found Classic seed lost its "Found!" line to a scale change)
  it("restarts its run and drops a found result for a change of its key only while Beat Machines is the mode (Simulator.tsx)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/components/simulator/Simulator.tsx"), "utf8");
    expect(src).toMatch(/const bmRunKey = \[\.\.\.BM_RESTART_FIELDS\.map\([^\n]*s\.scale, s\.rootNote/);
    const effects = [...src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[([^\]]*)\]\);/g)].filter((m) => m[2].includes("bmRunKey"));
    expect(effects).toHaveLength(1);
    const body = effects[0][1];
    const moved = body.indexOf("bmRunKeyRef.current = bmRunKey;");
    const guard = body.indexOf('if (s.mode !== "beatMachine") return;');
    const drop = body.indexOf("setSearchResult(");
    const restart = body.indexOf('engine.initMode("beatMachine")');
    // the key is remembered in every mode (a later switch to Beat Machines does not restart twice), then the mode decides
    expect(moved).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(moved);
    expect(drop).toBeGreaterThan(guard);
    expect(restart).toBeGreaterThan(guard);
    expect(body.indexOf("setSearchResult(", drop + 1)).toBe(-1);
  });

  it("joins the rhythm family after Beat Drop, with its HUD words, its caption and every message in en / pl / es", () => {
    expect(MODE_CATEGORIES.beatMachine).toBe("rhythm");
    expect(MODE_CARD_ORDER.indexOf("beatMachine")).toBe(MODE_CARD_ORDER.indexOf("beatDrop") + 1);
    expect(LOOP_HUD_MODE_TEXT.beatMachine?.title).toBe("BeatMachine.canvasTitleMarbles");
    expect(loopCaptionContext({ mode: "beatMachine", recordingDuration: 20, bmVariant: "stairs", bmSteps: 8 } as never)).toMatchObject({ hookKey: "beatMachineStairs", count: 8 });
    expect(loopCaptionContext({ mode: "beatMachine", recordingDuration: 20, bmBars: 10 } as never)).toMatchObject({ hookKey: "beatMachineMarbles", count: 10 });
    const keys = (o: unknown): string[] => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k])) : []);
    const ns = (m: Record<string, unknown>) => keys(m.BeatMachine).sort();
    expect(ns(pl as Record<string, unknown>)).toEqual(ns(en as Record<string, unknown>));
    expect(ns(es as Record<string, unknown>)).toEqual(ns(en as Record<string, unknown>));
    const bm = (en as unknown as Record<string, Record<string, string>>).BeatMachine;
    expect(bm.canvasTitleStairs).toBe("each step / plays a note");
    expect(bm.canvasTitleMarbles).toBe("every note is a marble");
    for (const key of ["bmVariant", "bmBpm", "bmSteps", "bmBars", "bmDrop", "bmRebound", "bmReturn", "bmPerTube", "bmSource", "bmLoopBeats"]) expect(typeof bm[key]).toBe("string");
  });

  it("draws both machines without throwing and mirrors the run on the canvas (data-bm-*)", () => {
    for (const patch of [{}, { variant: "stairs" as const }]) {
      const engine = bmEngine(patch, 3);
      run(engine, 200);
      const view = engine.getBeatMachineView();
      const ctx = fakeCanvas(800, 600).getContext("2d") as unknown as CanvasRenderingContext2D;
      const layer = new BeatMachineLayer();
      layer.drawStage(ctx, view, view.timeSec, { dpr: 1, showGlow: true });
      layer.drawBodies(ctx, view, view.timeSec, { dpr: 1, showGlow: true });
      const data: Record<string, string> = {};
      writeBeatMachineDataset(view, layer, (k, v) => (data[k] = v));
      expect(Object.keys(data).sort()).toEqual([...BEAT_MACHINE_DATA_KEYS].sort());
      expect(data.bmVariant).toBe(view.plan.variant);
      expect(beatMachineExtentPx(view)).toBeGreaterThan(50);
      expect(beatMachineExtentPx(view)).toBeLessThan(300);
      if (view.plan.marbles) expect(layer.marblesDrawn).toBe(view.plan.ballCount);
    }
  });

  it("fits the machine inside the page's centred square at any size", () => {
    for (const cfg of [config, { ...config, width: 1080, height: 1920 }, { ...config, width: 400, height: 400 }]) {
      for (const patch of [{}, { variant: "stairs" as const }, { bars: 30 }, { variant: "stairs" as const, steps: 40 }, { dropPct: 80 }]) {
        const v = bmEngine(patch, 2, cfg).getBeatMachineView();
        const side = Math.min(cfg.width, cfg.height);
        const b = v.plan.bbox;
        const f = v.frame;
        const x0 = f.cx + (b.x0 - f.ux) * f.scale;
        const x1 = f.cx + (b.x1 - f.ux) * f.scale;
        expect(x1 - x0).toBeLessThanOrEqual(side + 1e-6);
        expect(x0).toBeGreaterThanOrEqual((cfg.width - side) / 2 - 1e-6);
        expect(beatMachineExtentPx(v) * 2).toBeLessThanOrEqual(side + 1e-6);
      }
    }
  });
});
