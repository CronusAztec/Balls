import { describe, expect, it, vi } from "vitest";
import { fakeCanvas } from "./fakeCanvas";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { BM_TUNES, BM_TUNE_CODA_BEATS, BM_TUNE_VERSES, tuneBarMidis, tuneLoop } from "@/lib/simulation/beatMachineTunes";
import { BM_BASS_BEATS } from "@/lib/simulation/beatMachinePlan";
import { SONG_RING_TUNES } from "@/lib/physics/modes/songRing";
import { beatMachineSettingsOf, beatMachineTunePatch, resolveBeatMachineSettings, type BeatMachineSettings } from "@/lib/physics/beatMachine";
import { beatMachinePlanOf } from "@/lib/simulation/beatMachineFinder";
import { isPhraseStart } from "@/lib/physics/modes/beatMachine";
import { BeatMachineLayer, beatMachineBannerShows, nextNoteAfter } from "@/components/simulator/beatMachineRenderer";
import { clipStartSettings } from "@/lib/clipPacing";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { frequencyToMidi, midiToFrequency } from "@/lib/audio/scales";

/*
 * --- beat-machine-tunes --- Beat Machines' known tunes (lib/simulation/beatMachineTunes.ts and the "tune" source of
 * lib/simulation/beatMachinePlan.ts, lib/physics/modes/beatMachine.ts, components/simulator/beatMachineRenderer.ts): each
 * verse opens with Song Ring's own phrase and comes home, its bars are its pitches, every note sounds at its exact pitch, a
 * phrase's first beat is accented, the loop ends on the chord over the tune's bass with the tune's name up, and the start look
 * plays Ode to Joy inside one clip – while the link base (the seeded original phrase) and its fingerprint stay as they were.
 */

vi.setConfig({ testTimeout: 120_000 });

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
const STEP = 1000 / 60;

function bmEngine(patch: Partial<BeatMachineSettings> = {}, seed = 7): PhysicsEngine {
  return createEngineForSettings(config, "beatMachine", { ...base, beatMachine: patch }, seed);
}

/** The engine settings of the page's start look. */
function startLook(): BeatMachineSettings {
  return beatMachineSettingsOf({ ...defaultSettings("beatMachine"), ...clipStartSettings("beatMachine") } as SimulatorSettings);
}

function run(engine: PhysicsEngine, frames: number): { t: number; e: SoundEvent }[] {
  const out: { t: number; e: SoundEvent }[] = [];
  for (let k = 0; k < frames; k++) {
    engine.update(STEP, 0);
    for (const e of engine.consumeSoundEvents()) out.push({ t: engine.getElapsedMs() / 1000, e });
  }
  return out;
}

const never = () => {
  throw new Error("a known tune draws no random number");
};

describe("the known tunes (beatMachineTunes.ts)", () => {
  it("opens every verse with Song Ring's phrase, note for note, and lays it out on whole beats", () => {
    for (const id of BM_TUNES) {
      const loop = tuneLoop(id);
      const head = SONG_RING_TUNES[id].notes;
      const k = BM_TUNE_VERSES[id].slotBeats;
      expect(loop.notes.slice(0, head.length).map((n) => [n.midi, n.beats / k]), id).toEqual(head.map(([m, s]) => [m, s]));
      // the notes follow each other without a gap or an overlap, and the loop is the verse and its coda
      for (let i = 1; i < loop.notes.length; i++) expect(loop.notes[i].beat, `${id} ${i}`).toBeCloseTo(loop.notes[i - 1].beat + loop.notes[i - 1].beats, 9);
      expect(loop.verseBeats, id).toBeCloseTo(loop.notes[loop.notes.length - 1].beat + loop.notes[loop.notes.length - 1].beats, 9);
      expect(loop.loopBeats, id).toBe(Math.ceil(loop.verseBeats - 1e-9) + BM_TUNE_CODA_BEATS);
      expect(loop.lastBeat, id).toBeLessThan(loop.loopBeats);
      expect(loop.bass.every((b) => b.beat >= 0 && b.beat < loop.verseBeats), id).toBe(true);
    }
  });

  it("comes home: Ode to Joy, Twinkle, Frère Jacques end on C and Für Elise on A, each with its own chord", () => {
    const last = (id: (typeof BM_TUNES)[number]) => tuneLoop(id).notes[tuneLoop(id).notes.length - 1].midi % 12;
    expect([last("ode"), last("twinkle"), last("jacques"), last("elise")]).toEqual([0, 0, 0, 9]);
    expect([tuneLoop("ode").chordRoot % 12, tuneLoop("ode").minor, tuneLoop("elise").chordRoot % 12, tuneLoop("elise").minor]).toEqual([0, false, 9, true]);
    // Ode to Joy's first period: 32 beats, its last C on beat 30, a loop of 34
    expect([tuneLoop("ode").verseBeats, tuneLoop("ode").lastBeat, tuneLoop("ode").loopBeats]).toEqual([32, 30, 34]);
    expect(tuneBarMidis(tuneLoop("ode"))).toEqual([72, 74, 76, 77, 79]);
  });
});

describe("the tune in the plan and the engine", () => {
  it("plans a bar for each pitch at its exact frequency, every note on its own bar, the tune's bass and the chord on the last note", () => {
    for (const id of BM_TUNES) {
      const settings = resolveBeatMachineSettings({ source: "tune", tune: id, bpm: BM_TUNE_VERSES[id].bpm });
      const plan = beatMachinePlanOf(settings, never);
      const loop = tuneLoop(id);
      const bars = plan.marbles!.bars;
      expect(bars.map((b) => Math.round(frequencyToMidi(b.frequency))), id).toEqual(tuneBarMidis(loop));
      expect(plan.notes.length, id).toBe(loop.notes.length);
      for (const n of plan.notes) expect(bars[n.slot].frequency, id).toBeCloseTo(n.frequency, 9);
      expect(plan.loopBeats, id).toBe(loop.loopBeats);
      expect(plan.tune?.tune, id).toBe(id);
      const chords = plan.events.filter((e) => e.kind === "chord");
      expect(chords.map((e) => e.t), id).toEqual([loop.lastBeat * plan.beatSec]);
      expect(chords[0].frequency, id).toBeCloseTo(midiToFrequency(loop.chordRoot), 9);
      expect(plan.events.filter((e) => e.kind === "bass").length, id).toBe(loop.bass.length);
      expect(plan.conflicts >= 0 && plan.ballCount > 0, id).toBe(true);
    }
  });

  it("sounds every note at its pitch, accents a phrase's first beat and closes the loop with the chord", () => {
    const engine = bmEngine(startLook(), 3);
    const v = engine.getBeatMachineView();
    const P = v.plan.loopSec;
    expect(P).toBeCloseTo(20.4, 9);
    // one loop, up to the frame before the next loop's first strike
    const events = run(engine, Math.round(P * 60) - 1);
    const bars = events.filter((x) => x.e.loop === "bar");
    expect(bars.length).toBe(v.plan.notes.length);
    expect(bars.every((x) => x.e.loopExact === true)).toBe(true);
    // the accents: the strikes on beats 0, 8, 16 and 24, each with a chime an octave over it that no contact stands behind
    const chimes = events.filter((x) => x.e.loop === "chime");
    const accented = v.plan.notes.filter((n) => isPhraseStart(n.beat)).length;
    expect(accented).toBe(4);
    expect([chimes.length, v.accents]).toEqual([accented, accented]);
    expect(chimes.every((x) => x.e.ringVoice === "extra")).toBe(true);
    expect(bars.filter((x) => x.e.level === 1).length).toBe(accented);
    // the chord on the last note (18 s at 100 BPM), exact, in its own colour, once a loop
    const chords = events.filter((x) => x.e.loop === "chord");
    expect(chords.length).toBe(1);
    expect(chords[0].t).toBeCloseTo(18, 1);
    expect(chords[0].e.loopExact).toBe(true);
    expect(chords[0].e.loopMinor).toBeUndefined();
    expect([v.chords, v.chordSec]).toEqual([1, 18]);
    expect(isPhraseStart(BM_BASS_BEATS)).toBe(true);
    expect(isPhraseStart(1)).toBe(false);
  });

  it("ends a whole-loop clip of the start look inside 30 s, its banner up from the chord to the seam", () => {
    const engine = bmEngine(startLook(), 3);
    const v = engine.getBeatMachineView();
    const P = v.plan.loopSec;
    expect(Math.floor(30 / P)).toBe(1);
    const chordSec = v.plan.tune!.lastBeat * v.plan.beatSec;
    expect(P - chordSec).toBeGreaterThanOrEqual(2);
    expect([beatMachineBannerShows(v, chordSec - 0.05), beatMachineBannerShows(v, chordSec + 0.01), beatMachineBannerShows(v, P - 0.01), beatMachineBannerShows(v, P + 0.5)]).toEqual([false, true, true, false]);
    // the link base: no tune, no banner, no chord
    const plain = bmEngine({}, 3);
    expect(plain.getBeatMachineView().plan.tune).toBeNull();
    expect(beatMachineBannerShows(plain.getBeatMachineView(), 19)).toBe(false);
    expect(run(plain, 20 * 60).some((x) => x.e.loop === "chord")).toBe(false);
  });

  it("draws the stage, the keys with their names, the next key lit, the strike rings and the trails, the same frame twice", () => {
    // just after the second note (beat 1, 0.6 s): its ring spreads, its marble bounces off the key
    const engine = bmEngine(startLook(), 3);
    run(engine, 40);
    const view = engine.getBeatMachineView();
    const draw = () => {
      const canvas = fakeCanvas(800, 600);
      const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
      const layer = new BeatMachineLayer();
      layer.drawStage(ctx, view, view.timeSec, { dpr: 1, showGlow: false });
      layer.drawBodies(ctx, view, view.timeSec, { dpr: 1, showGlow: false });
      return { layer, calls: ctx.calls };
    };
    const a = draw();
    expect(a.calls.filter((c) => c.name === "fillText").map((c) => c.args[0])).toEqual(["C", "D", "E", "F", "G"]);
    expect(a.layer.rings).toBeGreaterThan(0);
    expect(a.layer.trails).toBeGreaterThan(0);
    const next = nextNoteAfter(view.plan, view.timeSec);
    expect(next).not.toBeNull();
    expect(a.layer.nextKey).toBe(next!.wait <= view.plan.beatSec ? next!.slot : -1);
    expect(draw().calls.map((c) => c.name)).toEqual(a.calls.map((c) => c.name));
    // --- review fix (D1) --- the stage's lights are clipped to the square: a wide stage showed the keys' light past its left edge
    const names = a.calls.map((c) => c.name);
    const firstEllipse = names.indexOf("ellipse");
    const clip = names.lastIndexOf("clip", firstEllipse);
    expect(clip).toBeGreaterThan(0);
    const square = a.calls.slice(0, clip).reverse().find((c) => c.name === "rect")!.args as number[];
    const { cx, cy, side } = view.frame;
    expect(square).toEqual([cx - side / 2, cy - side / 2, side, side]);
    expect(names.slice(clip, firstEllipse)).not.toContain("restore");
  });
});

describe("the tune on the page (start look, link, chips)", () => {
  it("starts a bare visit on Ode to Joy with the counter on, and writes it into its link", () => {
    expect(clipStartSettings("beatMachine")).toEqual({ bmSource: "tune", bmTune: "ode", bmCounter: true, bmDrop: 20 });
    const page = { ...defaultSettings("beatMachine"), ...clipStartSettings("beatMachine") } as SimulatorSettings;
    const link = settingsToSearchParams(page);
    expect([link.get("bmSrc"), link.get("bmC"), link.get("bmT"), link.get("bmDh")]).toEqual(["tune", "1", null, "20"]);
    expect(settingsFromSearchParams(link)).toMatchObject({ bmSource: "tune", bmTune: "ode", bmCounter: true, bmDrop: 20 });
    // the shorter drop makes the machine bigger in its square than the link base's ten bars
    const big = bmEngine(startLook(), 1).getBeatMachineView();
    const small = bmEngine({}, 1).getBeatMachineView();
    expect(big.plan.marbles!.radius * big.frame.scale).toBeGreaterThan(1.4 * small.plan.marbles!.radius * small.frame.scale);
    // the link base is what it was: the seeded original phrase, the counter off
    expect(defaultSettings("beatMachine")).toMatchObject({ bmSource: "original", bmTune: "ode", bmCounter: false });
  });

  it("reads and writes the tune (bmT), refuses an unknown one, and picks a tune with its tempo and the counter", () => {
    const s = { ...defaultSettings("beatMachine"), bmSource: "tune" as const, bmTune: "elise" as const };
    const link = settingsToSearchParams(s);
    expect(link.get("bmT")).toBe("elise");
    expect(settingsFromSearchParams(link).bmTune).toBe("elise");
    expect(settingsFromSearchParams(new URLSearchParams("mode=beatMachine&bmSrc=tune&bmT=nope")).bmTune).toBe("ode");
    expect(presetToSettings(JSON.parse(JSON.stringify(s))).bmTune).toBe("elise");
    for (const id of BM_TUNES) expect(beatMachineTunePatch(id)).toEqual({ bmVariant: "marbles", bmSource: "tune", bmTune: id, bmBpm: BM_TUNE_VERSES[id].bpm, bmCounter: true, loopHud: true });
    // at its own tempo every tune's loop fits a 30 s clip at least once
    for (const id of BM_TUNES) {
      const plan = beatMachinePlanOf(resolveBeatMachineSettings({ source: "tune", tune: id, bpm: BM_TUNE_VERSES[id].bpm }), never);
      expect([id, plan.loopSec <= 30 - 2]).toEqual([id, true]);
    }
  });
});
