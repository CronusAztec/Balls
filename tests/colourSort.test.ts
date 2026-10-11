import { describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import {
  CS_ARC_GRIP,
  CS_BALL_CEILING,
  CS_CHORD_HZ,
  CS_COLOUR_CEILING,
  CS_GATE_CEILING,
  CS_HOLD_SEC,
  CS_PER_COLOUR_CEILING,
  CS_RULES,
  DEFAULT_COLOUR_SORT,
  colourSortColourNames,
  colourSortCounts,
  colourSortPalette,
  colourSortPitch,
  csRingOmega,
  csRingRadius,
  gatePasses,
  inGate,
  reflectInMovingFrame,
  remixOffset,
  resolveColourSortSettings,
  targetBand,
  type ColourSortSettings,
  type ColourSortView,
} from "@/lib/physics/modes/colourSort";
import {
  CS_LOOK,
  CS_PRESET_IDS,
  COLOUR_SORT_HUD_KEYS,
  COLOUR_SORT_RANGES,
  DEFAULT_COLOUR_SORT_FIELDS,
  colourSortCounterTemplate,
  colourSortModeDefaults,
  colourSortPastCeiling,
  colourSortPresetFields,
  colourSortSettingsOf,
  colourSortTotal,
  readColourSortParams,
  resolveColourSortFields,
  writeColourSortParams,
} from "@/lib/physics/colourSortSettings";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { RANGES, defaultSettings, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams, uncappedEngaged } from "@/lib/settings";
import { createEngineForSettings, runNeverFinishes, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, barSeconds, outcomeClipSec, outcomeFigure, outcomeHorizonMs, outcomeMatches, outcomeMiss, SORT_BAR_TOLERANCE_SEC, type FinderOutcome, type RunSummary } from "@/lib/simulation/outcomes";
import { loopHudCount, loopHudFrame } from "@/lib/loop/hud";
import { loopPlayOptions } from "@/lib/audio/loopEvents";
import { LOOP_CHORD, LOOP_NOTES_PER_TICK } from "@/lib/audio/loopTones";
import { degreeToMidi } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { loopCaptionContext } from "@/lib/publish/loopCaption";
import { MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";

/*
 * --- colour-sort --- Colour Sort (lib/physics/modes/colourSort.ts): the rule, the one-way sort, the census, the remix back
 * into frame 0 and the exact replay, the reflection in a turning ring's frame, the settings and their URL keys, the presets,
 * the sounds, the HUD, the finder's outcomes and the fingerprints at 30, 60 and 120 fps.
 */

// Whole runs of the engine (a sort is ~15 s of simulation): generous timeouts, so a busy machine does not fail them.
vi.setConfig({ testTimeout: 120_000 });

const config: PhysicsConfig = { width: 450, height: 800, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const STEP = 1000 / 60;

function engineOf(patch: Partial<ColourSortSettings> = {}, seed = 1, cfg: PhysicsConfig = config) {
  const engine = new PhysicsEngine(cfg);
  engine.setColourSortSettings(patch);
  engine.setSeed(seed);
  engine.initMode("colourSort");
  return engine;
}

/** Steps `engine` until `done` (or `maxSec` of simulation); returns the sound events heard on the way. */
function runUntil(engine: PhysicsEngine, done: (v: ColourSortView) => boolean, maxSec = 90, onStep?: (v: ColourSortView) => void): SoundEvent[] {
  const v = engine.getColourSortView();
  const events: SoundEvent[] = [];
  for (let i = 0; i < maxSec * 60 && !done(v); i++) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
    onStep?.(v);
  }
  return events;
}

/** Every ball's band, judged from its centre with a hair of slack on the ring lines (a ball may sit on its ring's line). */
function positionalBandOk(engine: PhysicsEngine): boolean {
  const v = engine.getColourSortView();
  for (const ball of engine.getBalls()) {
    const k = ball.id - v.firstId;
    const b = v.band[k];
    const r = Math.hypot(ball.x - v.cx, ball.y - v.cy);
    const lo = b > 0 ? v.ringRadius[b - 1] : 0;
    if (r < lo - 1e-6 || r > v.ringRadius[b] + 1e-6) return false;
  }
  return true;
}

describe("Colour Sort: the rule", () => {
  it("gate truth table: inward never passes, own colour never passes, other colours pass outward (the reference rule)", () => {
    for (let ring = 0; ring < 3; ring++) {
      for (let colour = 0; colour < 4; colour++) {
        expect(gatePasses("outwardNotOwn", false, colour, ring)).toBe(false);
        expect(gatePasses("outwardNotOwn", true, colour, ring)).toBe(colour !== ring);
        // the other two rules
        expect(gatePasses("outwardOwnOnly", true, colour, ring)).toBe(colour === ring);
        expect(gatePasses("outwardOwnOnly", false, colour, ring)).toBe(false);
        expect(gatePasses("bothWaysNotOwn", true, colour, ring)).toBe(colour !== ring);
        expect(gatePasses("bothWaysNotOwn", false, colour, ring)).toBe(colour !== ring);
      }
    }
    // where each colour ends: the reference sends colour c to band c; reversed, colour 0 to band 1 and the rest stay in the core
    expect([0, 1, 2, 3].map((c) => targetBand("outwardNotOwn", c, 4))).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((c) => targetBand("bothWaysNotOwn", c, 4))).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((c) => targetBand("outwardOwnOnly", c, 4))).toEqual([1, 0, 0, 0]);
    expect([...CS_RULES]).toEqual(["outwardNotOwn", "outwardOwnOnly", "bothWaysNotOwn"]);
  });

  it("finds the gates of a turning ring: centred at the phase plus the ring's angle, half a width either side", () => {
    const period = Math.PI / 2;
    const width = (35 * Math.PI) / 180;
    expect(inGate(0.2, 0, 0.2, period, width)).toBe(true);
    expect(inGate(0.2 + width / 2 - 1e-9, 0, 0.2, period, width)).toBe(true);
    expect(inGate(0.2 + width / 2 + 1e-6, 0, 0.2, period, width)).toBe(false);
    expect(inGate(0.2 + 3 * period, 0, 0.2, period, width)).toBe(true);
    // the ring turned by a quarter of a period moves its gates along
    expect(inGate(0.2 + period / 4, period / 4, 0.2, period, width)).toBe(true);
    expect(inGate(0.2, period / 2, 0.2, period, width)).toBe(false);
    // a gate as wide as its period: the ring is all gate; no width: no gate
    expect(inGate(1.234, 0, 0, period, period)).toBe(true);
    expect(inGate(0, 0, 0, period, 0)).toBe(false);
  });

  it("lays the rings out at (k + 1) / K of the outer radius, turning at spin × falloff^k, alternating", () => {
    expect([0, 1, 2, 3].map((k) => csRingRadius(k, 4, 304))).toEqual([76, 152, 228, 304]);
    const s = { spin: 31, falloff: 0.8, alternate: true };
    expect(csRingOmega(0, s)).toBeCloseTo((31 * Math.PI) / 180, 12);
    expect(csRingOmega(1, s)).toBeCloseTo((-31 * 0.8 * Math.PI) / 180, 12);
    expect(csRingOmega(2, s)).toBeCloseTo((31 * 0.64 * Math.PI) / 180, 12);
    expect(csRingOmega(1, { ...s, alternate: false })).toBeGreaterThan(0);
  });
});

describe("Colour Sort: the reflection off a turning arc", () => {
  it("conserves the speed in the arc's frame (with the arc's grip or without), reversing the approach", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
    const out = { vx: 0, vy: 0 };
    for (let i = 0; i < 2000; i++) {
      const a = Math.PI * rnd();
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      const ux = 300 * rnd();
      const uy = 300 * rnd();
      const vx = 400 * rnd();
      const vy = 400 * rnd();
      for (const grip of [0, CS_ARC_GRIP, 1]) {
        const into = (vx - ux) * nx + (vy - uy) * ny < 0;
        const hit = reflectInMovingFrame(vx, vy, nx, ny, ux, uy, out, grip);
        expect(hit).toBe(into);
        const before = Math.hypot(vx - ux, vy - uy);
        const after = Math.hypot(out.vx - ux, out.vy - uy);
        expect(after).toBeCloseTo(before, 8);
        if (into) {
          // leaving the surface, and – without grip – the mirror image of the approach in the surface's frame
          expect((out.vx - ux) * nx + (out.vy - uy) * ny).toBeGreaterThanOrEqual(-1e-9);
          if (grip === 0) expect((out.vx - ux) * nx + (out.vy - uy) * ny).toBeCloseTo(-((vx - ux) * nx + (vy - uy) * ny), 8);
        } else expect([out.vx, out.vy]).toEqual([vx, vy]);
      }
    }
    // a still surface without grip is the plain mirror
    reflectInMovingFrame(3, -4, 0, 1, 0, 0, out);
    expect([out.vx, out.vy]).toEqual([3, 4]);
  });

  it("keeps the balls' speed in a run (the gas runs at the set speed, every arc's grip included)", () => {
    const engine = engineOf({}, 3);
    const v = engine.getColourSortView();
    runUntil(engine, () => false, 6);
    const target = v.settings.speed * v.scale;
    const speeds = engine.getBalls().map((b) => Math.hypot(b.vx, b.vy));
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(Math.abs(mean - target) / target).toBeLessThan(0.05);
  });
});

describe("Colour Sort: the sort", () => {
  it("over 10,000 random steps never moves a ball to an inner band while it sorts (the reference rule), the census agreeing throughout", () => {
    const engine = engineOf({}, 7);
    const v = engine.getColourSortView();
    const n = v.total;
    const prev = Int32Array.from(v.band);
    let prevPhase = v.phase;
    let prevSeams = v.seams;
    let inward = 0;
    let censusOff = 0;
    let bandOff = 0;
    let checked = 0;
    for (let i = 0; i < 10_000; i++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      // (the remix pulls every ball back into the core on purpose; a seam starts the next cycle from frame 0)
      const sorting = v.phase !== "remix" && prevPhase !== "remix" && v.seams === prevSeams;
      if (sorting) {
        for (let k = 0; k < n; k++) if (v.band[k] < prev[k]) inward++;
        checked++;
      }
      let sorted = 0;
      for (let k = 0; k < n; k++) if (v.band[k] === v.target[v.colourOf[k]]) sorted++;
      if (sorted !== v.sorted) censusOff++;
      if (i % 25 === 0 && v.phase !== "remix" && !positionalBandOk(engine)) bandOff++;
      prev.set(v.band);
      prevPhase = v.phase;
      prevSeams = v.seams;
    }
    expect(checked).toBeGreaterThan(5000);
    expect(v.seams).toBeGreaterThanOrEqual(5); // several whole cycles in 167 s
    expect([inward, censusOff, bandOff, v.escaped]).toEqual([0, 0, 0, 0]);
  });

  it("sends a single ball of every colour to its own band, the counter its band census", () => {
    for (const seed of [1, 2, 3]) {
      for (const colours of [3, 4, 6]) {
        const engine = engineOf({ colours, perColour: 1 }, seed);
        const v = engine.getColourSortView();
        runUntil(engine, (view) => view.completions > 0, 300);
        expect([seed, colours, v.completions, v.completeOk]).toEqual([seed, colours, 1, true]);
        for (const ball of engine.getBalls()) {
          const k = ball.id - v.firstId;
          expect(v.band[k]).toBe(v.colourOf[k]);
        }
        expect(v.sorted).toBe(colours);
        expect(positionalBandOk(engine)).toBe(true);
      }
    }
  });

  it("sorts the reference 360 within the time limit, the counter climbing with a long tail (no ball ever leaves the outer wall)", () => {
    const engine = engineOf({}, 1);
    const v = engine.getColourSortView();
    expect([v.total, v.colours, v.perColour, v.gates]).toEqual([360, 4, 90, 4]);
    // the reds start sorted: they are packed in the core, their own band
    expect(v.sortedAtStart).toBe(90);
    const marks: number[] = [];
    let step = 0;
    runUntil(engine, (view) => view.completions > 0, 60, (view) => {
      step++;
      if (step % 180 === 0) marks.push(view.sorted);
    });
    expect(v.completeOk).toBe(true);
    expect(v.firstSortSec).toBeGreaterThan(5);
    expect(v.firstSortSec).toBeLessThan(30);
    // fast at first, then a long tail: more than half sorted within 3 s, the last 2 % taking a good share of the run
    expect(marks[0]).toBeGreaterThan(180);
    expect(v.escaped).toBe(0);
    expect(v.firstLastColour).toBeGreaterThanOrEqual(1);
  });

  it("ends the sort at the time limit with a minor chord when not every ball made it", () => {
    const engine = engineOf({ limit: 2 }, 1);
    const v = engine.getColourSortView();
    const events = runUntil(engine, (view) => view.completions > 0, 5);
    expect([v.completions, v.completeOk, v.firstSortSec, v.firstLastColour]).toEqual([1, false, -1, -1]);
    expect(v.completeMs).toBeCloseTo(2000, 6);
    const chord = events.find((e) => e.loop === "chord");
    expect(chord).toMatchObject({ loopMinor: true, loopTremolo: true, frequency: CS_CHORD_HZ });
  });

  it("sorts the reverse rule (own colour only) – colour 0 one ring out, the others in the core – and every colour of the rainbow preset", () => {
    for (const [patch, done] of [
      [{ rule: "outwardOwnOnly" as const }, (v: ColourSortView) => Array.from(v.target).join() === "1,0,0,0"],
      [{ colours: 7, perColour: 50 }, (v: ColourSortView) => v.total === 350],
    ] as const) {
      const engine = engineOf(patch, 2);
      const v = engine.getColourSortView();
      expect(done(v)).toBe(true);
      runUntil(engine, (view) => view.completions > 0, 120);
      expect([patch, v.completeOk, v.escaped]).toEqual([patch, true, 0]);
    }
  });

  it("keeps every ball in its colour when the page's Ball Color changes (the colours are the sort)", () => {
    const engine = engineOf({}, 1);
    const v = engine.getColourSortView();
    const colours = () => engine.getBalls().map((b) => b.color);
    const before = colours();
    expect(new Set(before)).toEqual(new Set(colourSortPalette(4)));
    engine.setConfig({ ballColor: "#123456" });
    expect(colours()).toEqual(before);
    expect(engine.getBalls().every((b) => b.color === v.palette[v.colourOf[b.id - v.firstId]])).toBe(true);
  });

  it("runs elastic contacts (no ball lost, contacts counted) and a ghost gas of ten thousand", () => {
    const contacts = engineOf({ collisions: true }, 4);
    runUntil(contacts, () => false, 3);
    const cv = contacts.getColourSortView();
    expect(cv.contacts).toBeGreaterThan(50);
    expect(cv.escaped).toBe(0);
    expect(positionalBandOk(contacts)).toBe(true);
    const crowd = engineOf(colourSortSettingsOf(colourSortPresetFields("tenThousand")), 1);
    const v = crowd.getColourSortView();
    expect(crowd.getBalls().length).toBe(10_000);
    runUntil(crowd, () => false, 1);
    expect(v.sorted).toBeGreaterThan(2500);
    expect(v.escaped).toBe(0);
  });
});

describe("Colour Sort: the loop", () => {
  it("ends the remix exactly at the seeded frame-0 packing, and the next cycle replays the first", () => {
    const engine = engineOf({}, 1);
    const v = engine.getColourSortView();
    const snap = () => engine.getBalls().map((b) => [b.x, b.y]);
    const frame0 = snap();
    expect(engine.getLoopSeams()).toEqual({ count: 0, lastMs: -1, nextMs: -1 });
    expect(engine.getCycleSeconds()).toBeNull();
    const cycle1: number[][][] = [];
    const cycle2: number[][][] = [];
    let last = frame0;
    let beforeSeam: number[][] | null = null;
    let sawRemix = false;
    for (let i = 0; i < 60 * 80 && v.seams < 2; i++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      if (v.phase === "remix") sawRemix = true;
      const s = snap();
      if (v.seams === 0) cycle1.push(s);
      else if (v.seams === 1) {
        if (cycle2.length === 0) beforeSeam = last;
        cycle2.push(s);
      }
      last = s;
    }
    expect(sawRemix).toBe(true);
    expect(v.seams).toBe(2);
    // the remix's last frame is the packing (to a hair: the spring is exact at its end) and the seam puts every ball on it
    const offBy = Math.max(...beforeSeam!.map((p, j) => Math.hypot(p[0] - frame0[j][0], p[1] - frame0[j][1])));
    expect(offBy).toBeLessThan(1e-6);
    // the second cycle replays the first, frame by frame
    expect(cycle2.length).toBe(cycle1.length);
    let worst = 0;
    for (let i = 0; i < cycle1.length; i++) for (let j = 0; j < cycle1[i].length; j++) worst = Math.max(worst, Math.abs(cycle1[i][j][0] - cycle2[i][j][0]), Math.abs(cycle1[i][j][1] - cycle2[i][j][1]));
    expect(worst).toBeLessThan(1e-6);
    // the loop contract: the cycle, the seams
    const cycle = engine.getCycleSeconds()!;
    expect(cycle).toBeCloseTo(cycle1.length / 60, 6);
    expect(cycle).toBeCloseTo(v.firstSortSec + CS_HOLD_SEC + DEFAULT_COLOUR_SORT.remix, 1);
    expect(engine.getLoopSeams()).toMatchObject({ count: 2, nextMs: -1 });
  });

  it("springs a remix from any displacement and speed exactly onto zero (critically damped, no overshoot past the wall)", () => {
    const out: [number, number] = [0, 0];
    for (const [a, vel] of [[100, 0], [-40, 300], [5, -200], [0, 0]]) {
      expect(remixOffset(a, vel, 0, 2.8, out)[0]).toBeCloseTo(a, 9);
      expect(out[1]).toBeCloseTo(vel, 6);
      remixOffset(a, vel, 2.8, 2.8, out);
      expect([Math.abs(out[0]), Math.abs(out[1])]).toEqual([0, 0]);
      remixOffset(a, vel, 2.8 - 1e-9, 2.8, out);
      expect(Math.abs(out[0])).toBeLessThan(1e-6);
    }
    remixOffset(50, 10, 1, 0, out);
    expect([Math.abs(out[0]), Math.abs(out[1])]).toEqual([0, 0]);
  });
});

describe("Colour Sort: sound", () => {
  it("plucks every gate pass at its colour's degree of A major pentatonic (at most six a tick), then the chord, the wash and the cut", () => {
    // A3, E4, C#5, A5 for the outer colour inward
    expect([3, 2, 1, 0].map((c) => colourSortPitch(c, 4))).toEqual([57, 64, 73, 81].map((m) => midiToFrequency(m)));
    expect(colourSortPitch(0, 4)).toBe(midiToFrequency(degreeToMidi(15, 45, "majorPentatonic")));
    const engine = engineOf({}, 1);
    const v = engine.getColourSortView();
    let perStep = 0;
    const events: SoundEvent[] = [];
    for (let i = 0; i < 60 * 40 && v.seams < 1; i++) {
      engine.update(STEP, 0);
      const step = engine.consumeSoundEvents();
      perStep = Math.max(perStep, step.filter((e) => e.loop === "pluck").length);
      events.push(...step);
    }
    const plucks = events.filter((e) => e.loop === "pluck");
    expect(plucks.length).toBeGreaterThan(50);
    expect(perStep).toBeLessThanOrEqual(LOOP_NOTES_PER_TICK);
    const pitches = new Set([0, 1, 2, 3].map((c) => colourSortPitch(c, 4)));
    expect(plucks.every((e) => pitches.has(e.frequency!) && e.melody === false && (e.level ?? 0) > 0)).toBe(true);
    // the red core never passes a gate: no pluck at its pitch under the reference rule
    expect(plucks.some((e) => e.frequency === colourSortPitch(0, 4))).toBe(false);
    const chord = events.filter((e) => e.loop === "chord");
    expect(chord).toHaveLength(1);
    expect(loopPlayOptions(chord[0])).toMatchObject({ tremolo: true, minor: false });
    const wash = events.find((e) => e.loop === "wash");
    expect(wash?.loopSec).toBeCloseTo(DEFAULT_COLOUR_SORT.remix, 6);
    expect(events.filter((e) => e.loop === "cut")).toHaveLength(1);
    // order: the last pluck before the chord, the wash after it, the cut last
    const at = (kind: string) => events.findIndex((e) => e.loop === kind);
    expect(at("chord")).toBeLessThan(at("wash"));
    expect(at("wash")).toBeLessThan(at("cut"));
  });

  it("plays its events through the loop library (playLoop): the plucks, the chord held with its tremolo, the wash", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    try {
      const tone = new ToneGenerator();
      await tone.start();
      tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
      graph.ctx.currentTime = 1;
      playSoundEvent(tone, { type: "hit", wallIndex: 1, loop: "pluck", frequency: colourSortPitch(1, 4), level: 0.9, loopBright: true, melody: false }, () => undefined);
      expect(graph.oscillators.filter((o) => o.startAt === 1).map((o) => o.frequency)).toEqual(expect.arrayContaining([colourSortPitch(1, 4), 2 * colourSortPitch(1, 4)]));
      graph.ctx.currentTime = 2;
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "chord", frequency: CS_CHORD_HZ, level: 1, loopTremolo: true, loopMinor: false, melody: false }, () => undefined);
      const chord = graph.oscillators.filter((o) => o.startAt >= 2 && o.startAt < 3).map((o) => o.frequency);
      expect(chord).toContain(CS_CHORD_HZ);
      expect(chord).toContain(LOOP_CHORD.tremoloHz);
      graph.ctx.currentTime = 4;
      const before = graph.sources.length + graph.ramps.length;
      playSoundEvent(tone, { type: "hit", wallIndex: 0, loop: "wash", loopSec: 2.8, level: 1, melody: false }, () => undefined);
      expect(graph.sources.length + graph.ramps.length).toBeGreaterThan(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Colour Sort: settings", () => {
  it("defaults to the reference: 4 × 90, four 35° gates, 31°/s with ×0.8 alternating, 220 px/s, 4.5 px, a ghost gas, a 2.8 s remix", () => {
    expect(DEFAULT_COLOUR_SORT).toEqual({ colours: 4, perColour: 90, gates: 4, gateWidth: 35, spin: 31, falloff: 0.8, alternate: true, speed: 220, size: 4.5, collisions: false, remix: 2.8, rule: "outwardNotOwn", limit: 60, flashes: false });
    expect(colourSortSettingsOf(DEFAULT_COLOUR_SORT_FIELDS)).toEqual(DEFAULT_COLOUR_SORT);
    const d = defaultSettings("colourSort");
    expect(colourSortSettingsOf(d)).toEqual(DEFAULT_COLOUR_SORT);
    // the mode's own look: the loop HUD on, glowing dots, no trails; every other mode keeps the page's defaults
    expect(colourSortModeDefaults("colourSort")).toEqual({ loopHud: true, showGlow: true, showTrails: false, colorTrail: false, cinematicEnabled: false });
    expect([d.loopHud, d.showGlow, d.showTrails, d.colorTrail, d.cinematicEnabled]).toEqual([true, true, false, false, false]);
    // the other modes keep the page's defaults (the drama layer on, rainbow trails)
    expect([defaultSettings("classic").cinematicEnabled, defaultSettings("classic").colorTrail]).toEqual([true, true]);
    expect(defaultSettings("classic").loopHud).toBe(false);
    for (const mode of MODE_IDS) if (mode !== "colourSort") expect([mode, colourSortModeDefaults(mode)]).toEqual([mode, {}]);
    // the comfort ranges are the page's
    for (const [key, range] of Object.entries(COLOUR_SORT_RANGES)) expect((RANGES as Record<string, unknown>)[key]).toEqual(range);
    expect(MODE_CATEGORIES.colourSort).toBe("escape");
    expect(modesInCategory("escape")).toContain("colourSort");
    expect(HERO_MOMENTS.colourSort.tint).toBe("#5b8cff");
  });

  it("round-trips every setting through links, presets and the resolver; invalid values fall back, small ones lift onto the minimum, no maximum", () => {
    const s = { ...defaultSettings("colourSort"), csColours: 6, csPerColour: 1234, csGates: 9, csGateWidth: 12.5, csSpin: 400, csFalloff: 1.25, csAlternate: false, csSpeed: 5000, csSize: 2.5, csContacts: true, csRemix: 0.4, csRule: "bothWaysNotOwn" as const, csLimit: 999, csFlash: true };
    const params = settingsToSearchParams(s);
    expect(["csc", "csn", "csg", "csw", "css", "csf", "csa", "csv", "csr", "csx", "csm", "csu", "csl", "csh"].filter((key) => !params.has(key))).toEqual([]);
    const back = settingsFromSearchParams(params);
    for (const key of Object.keys(DEFAULT_COLOUR_SORT_FIELDS) as (keyof typeof DEFAULT_COLOUR_SORT_FIELDS)[]) expect([key, back[key]]).toEqual([key, s[key]]);
    expect(presetToSettings(JSON.parse(JSON.stringify(s)))).toMatchObject({ csPerColour: 1234, csRule: "bothWaysNotOwn", csFlash: true });
    // the defaults write nothing
    const ownKeys = ["csc", "csn", "csg", "csw", "css", "csf", "csa", "csv", "csr", "csx", "csm", "csu", "csl", "csh"];
    expect([...settingsToSearchParams(defaultSettings("colourSort")).keys()].filter((key) => ownKeys.includes(key))).toEqual([]);
    // invalid values fall back, a number below its minimum is lifted onto it, a big one is kept
    const bad = settingsFromSearchParams(new URLSearchParams("mode=colourSort&csc=abc&csn=-5&csg=1e9&csw=NaN&csu=sideways&csa=maybe&csl=0"));
    expect([bad.csColours, bad.csPerColour, bad.csGates, bad.csGateWidth, bad.csRule, bad.csAlternate, bad.csLimit]).toEqual([4, 1, 1e9, 35, "outwardNotOwn", true, 1]);
    expect(resolveColourSortFields({ csColours: 2.6, csSpeed: "300", csContacts: "yes" })).toMatchObject({ csColours: 3, csSpeed: 300, csContacts: false });
    expect(resolveColourSortSettings({ colours: 1, perColour: 0, gateWidth: 1, size: -2 })).toMatchObject({ colours: 2, perColour: 1, gateWidth: 5, size: 1 });
    // the writer and the reader on their own
    const p = new URLSearchParams();
    writeColourSortParams({ ...DEFAULT_COLOUR_SORT_FIELDS, csGates: 2, csFlash: true }, DEFAULT_COLOUR_SORT_FIELDS, p);
    expect(p.toString()).toBe("csg=2&csh=1");
    const fields = { ...DEFAULT_COLOUR_SORT_FIELDS };
    readColourSortParams(new URLSearchParams("csg=3&csh=1&csu=outwardOwnOnly"), fields);
    expect(fields).toMatchObject({ csGates: 3, csFlash: true, csRule: "outwardOwnOnly" });
  });

  it("builds at most its memory-safety ceilings – the colours, the gates, 10,000 balls a colour and 20,000 a run – and says ARENA FULL past them", () => {
    expect([MEMORY_CEILINGS.csColours, MEMORY_CEILINGS.csPerColour, MEMORY_CEILINGS.csGates]).toEqual([CS_COLOUR_CEILING, CS_PER_COLOUR_CEILING, CS_GATE_CEILING]);
    expect(CS_PER_COLOUR_CEILING * 2).toBe(CS_BALL_CEILING);
    expect(colourSortCounts({ colours: 4, perColour: 90 })).toEqual({ colours: 4, perColour: 90, total: 360 });
    expect(colourSortCounts({ colours: 1e9, perColour: 1e9 })).toEqual({ colours: CS_COLOUR_CEILING, perColour: CS_BALL_CEILING / CS_COLOUR_CEILING, total: CS_BALL_CEILING });
    expect(colourSortCounts({ colours: 4, perColour: 2500 }).total).toBe(10_000);
    expect(colourSortTotal({ csColours: 8, csPerColour: 5000 })).toBe(CS_BALL_CEILING);
    expect(colourSortPastCeiling({ csColours: 4, csPerColour: 2500 })).toBe(false);
    expect(colourSortPastCeiling({ csColours: 8, csPerColour: 5000 })).toBe(true);
    const ten = { ...defaultSettings("colourSort"), ...colourSortPresetFields("tenThousand") };
    expect([uncappedEngaged(ten), pastAnyMemoryCeiling(ten)]).toEqual([true, false]);
    expect(pastAnyMemoryCeiling({ ...defaultSettings("colourSort"), csColours: 8, csPerColour: 5000 })).toBe(true);
    // another mode's count says nothing
    expect(pastAnyMemoryCeiling({ ...defaultSettings("classic"), csColours: 8, csPerColour: 5000 })).toBe(false);
  });

  it("offers the five presets, each with the navy page, glowing dots and the loop HUD", () => {
    expect([...CS_PRESET_IDS]).toEqual(["bullseye", "rainbow7", "torture", "tenThousand", "reverse"]);
    expect(colourSortPresetFields("bullseye")).toEqual(DEFAULT_COLOUR_SORT_FIELDS);
    expect(colourSortPresetFields("rainbow7")).toMatchObject({ csColours: 7, csPerColour: 50 });
    expect(colourSortPresetFields("torture")).toMatchObject({ csGates: 1, csGateWidth: 10 });
    expect(colourSortPresetFields("tenThousand")).toMatchObject({ csColours: 4, csPerColour: 2500, csContacts: false });
    expect(colourSortPresetFields("reverse")).toMatchObject({ csRule: "outwardOwnOnly" });
    expect(CS_LOOK).toMatchObject({ backgroundType: "solid", backgroundColors: ["#050812", "#050812"], showGlow: true, loopHud: true });
    // the palette and the colours' names: the reference four, then the rainbow, hues past eight
    expect(colourSortPalette(4)).toEqual(["#ff5a5a", "#f7b23b", "#57e07a", "#5b8cff"]);
    expect(colourSortColourNames(4)).toEqual(["RED", "AMBER", "GREEN", "BLUE"]);
    expect(colourSortPalette(12)).toHaveLength(12);
    expect(colourSortColourNames(9)[8]).toBe("#9");
  });
});

describe("Colour Sort: the HUD", () => {
  it("counts the sorted balls and says the remix's words while it runs", () => {
    const template = colourSortCounterTemplate("[count] / [total] sorted", 360);
    expect(template).toBe("{count} / 360 sorted");
    const spec = { title: "Each ring stops only its own colour", subtitle: "", counter: template, alt: "Mixing again", light: false };
    const engine = engineOf({}, 1);
    const v = engine.getColourSortView();
    expect(loopHudCount(engine)).toBe(v.sorted);
    expect(loopHudFrame(spec, loopHudCount(engine), "en")).toMatchObject({ title: "each ring stops only its own colour", counter: `${v.sorted} / 360 sorted` });
    runUntil(engine, (view) => view.phase === "remix", 60);
    expect(loopHudCount(engine)).toBeNull();
    expect(loopHudFrame(spec, loopHudCount(engine), "en").counter).toBe("mixing again");
    // the rule's words
    expect(COLOUR_SORT_HUD_KEYS.outwardNotOwn).toEqual({ title: "canvasTitle", subtitle: "canvasSubtitle" });
    expect(COLOUR_SORT_HUD_KEYS.outwardOwnOnly.title).toBe("canvasTitleOwnOnly");
    // the loop-style caption leads with the balls in all
    expect(loopCaptionContext({ ...defaultSettings("colourSort") })).toEqual({ mode: "colourSort", hookKey: "colourSort", factKey: "colourSortFact", count: 360 });
  });
});

describe("Colour Sort: Find Simulation", () => {
  const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
  const request = (outcome: FinderOutcome, colourSort: Partial<ColourSortSettings> = {}): FinderRequest => ({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 3, maxSimTimeSec: 60, physicsConfig: config, mode: "colourSort", modeSettings: { ...modeSettings, colourSort }, outcome });

  it("searches the first sort: all sorted within a limit, the colour sorted last, the final ball on a bar line", () => {
    expect(runNeverFinishes("colourSort", {} as Parameters<typeof runNeverFinishes>[1])).toBe(true);
    expect(availableOutcomes("colourSort", { endless: true, neverEscape: false, ballCount: 1 })).toEqual(["sorted-by", "last-colour", "sorted-on-bar"]);
    expect(availableOutcomes("classic", { endless: false, neverEscape: false, ballCount: 1 })).not.toContain("sorted-by");
    const run: RunSummary = { mode: "colourSort", durationMs: 14_000, finished: false, firstEscapeMs: -1, teams: [], sortedMs: 13_990, lastColour: 3, cycleMs: 17_300 };
    expect(outcomeMatches({ kind: "sorted-by", clipSec: 30, atSec: 14 }, run)).toBe(true);
    expect(outcomeMatches({ kind: "sorted-by", clipSec: 30, atSec: 13.9 }, run)).toBe(false);
    expect(outcomeMiss({ kind: "sorted-by", clipSec: 30, atSec: 13.9 }, run)).toBeCloseTo(0.09, 9);
    expect(outcomeMatches({ kind: "last-colour", clipSec: 30, team: 3 }, run)).toBe(true);
    expect(outcomeMatches({ kind: "last-colour", clipSec: 30, team: 2 }, run)).toBe(false);
    // a bar of four beats at 120 BPM is 2 s: 13.99 s is 10 ms off the bar at 14 s – within ±20 ms
    expect(barSeconds(120)).toBe(2);
    expect(SORT_BAR_TOLERANCE_SEC).toBe(0.02);
    expect(outcomeMatches({ kind: "sorted-on-bar", clipSec: 30, atSec: 2 }, run)).toBe(true);
    expect(outcomeMatches({ kind: "sorted-on-bar", clipSec: 30, atSec: 2 }, { ...run, sortedMs: 13_975 })).toBe(false);
    expect(outcomeMiss({ kind: "sorted-on-bar", clipSec: 30, atSec: 2 }, { ...run, sortedMs: 13_975 })).toBeCloseTo(0.025, 9);
    // a time-out sorts nothing; the clip of a found run is its whole first cycle
    const timedOut = { ...run, sortedMs: -1, lastColour: -1 };
    expect(["sorted-by", "last-colour", "sorted-on-bar"].map((kind) => outcomeMatches({ kind, clipSec: 30, atSec: 60, team: 3 } as FinderOutcome, timedOut))).toEqual([false, false, false]);
    expect(outcomeMiss({ kind: "last-colour", clipSec: 30, team: 3 }, timedOut)).toBe(Infinity);
    expect(outcomeClipSec({ kind: "sorted-by", clipSec: 30, atSec: 14 }, run)).toBeCloseTo(17.3, 9);
    expect(outcomeFigure({ kind: "last-colour", clipSec: 30, team: 3 }, run)).toBeCloseTo(13.99, 9);
    expect(outcomeHorizonMs({ kind: "sorted-by", clipSec: 30, atSec: 14 }, 60_000, "colourSort")).toBeCloseTo(14_000 + 1000 / 60, 6);
  });

  it("simulates a seed's first sort as the page plays it: its time, its last colour and the cycle it closes", () => {
    const outcome: FinderOutcome = { kind: "last-colour", clipSec: 30, team: 3 };
    const run = simulateOutcomeRun(5, request(outcome), outcome);
    const engine = createEngineForSettings(config, "colourSort", { ...modeSettings, colourSort: {} }, 5);
    const v = engine.getColourSortView();
    runUntil(engine, (view) => view.completions > 0, 90);
    expect(run.sortedMs).toBeCloseTo(1000 * v.firstSortSec, 6);
    expect(run.lastColour).toBe(v.firstLastColour);
    expect(run.cycleMs).toBeCloseTo(1000 * (v.firstSortSec + CS_HOLD_SEC + DEFAULT_COLOUR_SORT.remix), -1);
    // the time limit ends a sort the outcome cannot use: followed to the limit, no further
    const short = simulateOutcomeRun(5, request(outcome, { limit: 3 }), outcome);
    expect([short.sortedMs, short.lastColour]).toEqual([-1, -1]);
    expect(short.durationMs).toBeLessThan(3500);
    // all sorted within a limit too short: given up right after it
    const tight: FinderOutcome = { kind: "sorted-by", clipSec: 30, atSec: 2 };
    expect(simulateOutcomeRun(5, request(tight), tight).durationMs).toBeLessThan(2100);
  });
});

describe("Colour Sort: determinism", () => {
  /** Recorded when the mode was added: balls 0 and 1 (x, y × 1000) every second of a 5 s run, seed 42, an 800 × 600 world. */
  const FINGERPRINT = [[319677, 289676], [315508, 317325], [169717, 248118], [246351, 339992], [188750, 232018], [261527, 327081], [211366, 208137], [221068, 320772], [205367, 153622], [166608, 311655]];

  it("plays the same run at 30, 60 and 120 fps (pinned), and a seed replays exactly", () => {
    const wide: PhysicsConfig = { ...config, width: 800, height: 600 };
    for (const fps of [30, 60, 120]) {
      const engine = engineOf({}, 42, wide);
      const out: number[][] = [];
      for (let f = 1; f <= 5 * fps; f++) {
        engine.update(1000 / fps, 0);
        engine.consumeSoundEvents();
        if (f % fps === 0) out.push(...engine.getBalls().slice(0, 2).map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
      }
      expect([fps, out]).toEqual([fps, FINGERPRINT]);
    }
    const a = engineOf({}, 9);
    const b = engineOf({}, 9);
    const c = engineOf({}, 10);
    runUntil(a, () => false, 3);
    runUntil(b, () => false, 3);
    runUntil(c, () => false, 3);
    const pos = (e: PhysicsEngine) => e.getBalls().map((ball) => [ball.x, ball.y]);
    expect(pos(a)).toEqual(pos(b));
    expect(pos(a)).not.toEqual(pos(c));
  });
});
