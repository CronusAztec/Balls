import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import {
  LOOP_CHORD,
  LOOP_GLIDE,
  LOOP_MAX_CONCURRENT,
  LOOP_NOTES_PER_TICK,
  LOOP_PLUCK,
  LoopVoiceBudget,
  completionChordVoices,
  grooveProgression,
  loopChordGain,
  padVoicing,
  pluckT60,
  pluckVelocity,
  raisedCosine,
  scanBellFrequencies,
  scanGain,
  scheduleBarStrike,
  scheduleCompletionChord,
  scheduleImpactAccent,
  scheduleNoiseWash,
  schedulePentaPluck,
  scheduleProgressStep,
  scheduleRatchet,
  scheduleResetGlide,
  scheduleScanStrike,
  startDrone,
  startGrooveBed,
  subMidi,
} from "@/lib/audio/loopTones";
import { LADDER_WRAP, LOOP_BASE_MIDI, LoopLadder, MINOR_PENTATONIC, degreeFromScalar, degreeToMidi, frequencyFromScalar, inLoopScale, scalarDegree } from "@/lib/audio/loopPitch";
import { midiToFrequency, SCALE_INTERVALS } from "@/lib/audio/scales";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { NoiseCache } from "@/lib/audio/stringBattleTones";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { playArenaSound, type ArenaSoundSink } from "@/lib/simulation/multi";

/*
 * --- loop-foundation --- The loop sound library (lib/audio/loopTones.ts, loopPitch.ts) against the fake Web Audio graph
 * (tests/fakeAudio.ts logs every oscillator, gain value and automation event): the pluck's partials, the pitch rules, the
 * ladder, the voice budget, the chord, the glide's ramp, the other families' graphs and the ToneGenerator's playLoop().
 */

const ctxOf = (graph: ReturnType<typeof fakeGraph>) => graph.ctx as unknown as BaseAudioContext;
const outOf = (graph: ReturnType<typeof fakeGraph>) => graph.ctx.destination as unknown as AudioNode;

afterEach(() => vi.unstubAllGlobals());

describe("loop pitch rules (pure)", () => {
  it("maps a scalar to a pentatonic degree: monotonic, bigger = lower with invert, every note in the scale", () => {
    let prev = Infinity;
    for (let r = 16; r <= 320; r += 0.5) {
      const midi = degreeFromScalar(Math.log(r), Math.log(16), Math.log(320), 14, true);
      expect(midi).toBeLessThanOrEqual(prev); // larger size → lower or equal pitch
      expect(inLoopScale(midi)).toBe(true);
      expect(midiToFrequency(midi)).toBeGreaterThanOrEqual(130);
      expect(midiToFrequency(midi)).toBeLessThanOrEqual(1050);
      prev = midi;
    }
    // the ends of the range: the smallest plays the top degree, the biggest the root
    expect(degreeFromScalar(16, 16, 320, 14, true)).toBe(degreeToMidi(14));
    expect(degreeFromScalar(320, 16, 320, 14, true)).toBe(LOOP_BASE_MIDI);
    expect(scalarDegree(5, 0, 10, 14, false)).toBe(7);
    expect(scalarDegree(-3, 0, 10, 14, false)).toBe(0);
    expect(scalarDegree(99, 0, 10, 14, false)).toBe(14);
    expect(scalarDegree(Number.NaN, 0, 10, 14, true)).toBe(14);
    expect(scalarDegree(4, 10, 10, 14, false)).toBe(0); // no range: the low end
  });

  it("counts degrees up the scale's octaves (and down below the root), in major and minor pentatonic", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => degreeToMidi(d, 60))).toEqual([60, 62, 64, 67, 69, 72, 74]);
    expect(degreeToMidi(-1, 60)).toBe(57);
    expect([0, 1, 2, 3, 4, 5].map((d) => degreeToMidi(d, 57, "minorPentatonic"))).toEqual([57, 60, 62, 64, 67, 69]);
    expect(MINOR_PENTATONIC).toEqual([0, 3, 5, 7, 10]);
    expect(SCALE_INTERVALS.pentatonic).toEqual([0, 2, 4, 7, 9]);
    expect(frequencyFromScalar(0, 0, 1, 14, false)).toBeCloseTo(midiToFrequency(LOOP_BASE_MIDI), 9);
  });

  it("the progress ladder rises one degree per step, wraps after its span and resets on completion", () => {
    const ladder = new LoopLadder(2);
    expect([ladder.step(), ladder.step(), ladder.step()]).toEqual([2, 3, 4]);
    ladder.reset();
    expect(ladder.step()).toBe(2);
    const wrap = new LoopLadder(0, LADDER_WRAP);
    const steps = Array.from({ length: LADDER_WRAP + 2 }, () => wrap.step());
    expect(steps.slice(0, LADDER_WRAP)).toEqual(Array.from({ length: LADDER_WRAP }, (_, i) => i));
    expect(steps.slice(LADDER_WRAP)).toEqual([0, 1]);
    const down = new LoopLadder(10, LADDER_WRAP, -1);
    expect([down.step(), down.step(), down.step()]).toEqual([10, 9, 8]);
  });
});

describe("pentaPluck", () => {
  it("starts two sines at f and 2f at the event time, the octave at 0.22, with an exponential ring", () => {
    const graph = fakeGraph();
    const voice = schedulePentaPluck(ctxOf(graph), outOf(graph), 440, 1.25, { t60: 0.75 });
    expect(voice).not.toBeNull();
    expect(graph.oscillators).toEqual([
      { type: "sine", frequency: 440, startAt: 1.25 },
      { type: "sine", frequency: 880, startAt: 1.25 },
    ]);
    expect(graph.gains).toContain(LOOP_PLUCK.partials[1]);
    expect(LOOP_PLUCK.partials[1]).toBeCloseTo(0.22, 9);
    // 5 ms linear attack to the peak, then an exponential ring to −60 dB over the T60
    const env = graph.ramps.filter((r) => r.param === "gain" && r.kind !== "set");
    expect(env[0]).toMatchObject({ kind: "linear", value: LOOP_PLUCK.gain, time: 1.25 + LOOP_PLUCK.attack });
    expect(env[1].kind).toBe("exp");
    expect(env[1].value).toBeCloseTo(LOOP_PLUCK.gain * 0.001, 9);
    expect(env[1].time).toBeCloseTo(1.25 + LOOP_PLUCK.attack + 0.75, 9);
    expect(voice!.end).toBeGreaterThanOrEqual(1.25 + LOOP_PLUCK.attack + 0.75 + LOOP_PLUCK.tail - 1e-9);
  });

  it("adds the 3f partial for a small object and plays nothing at level 0", () => {
    const graph = fakeGraph();
    schedulePentaPluck(ctxOf(graph), outOf(graph), 300, 0, { bright: true });
    expect(graph.oscillators.map((o) => o.frequency)).toEqual([300, 600, 900]);
    expect(graph.gains).toContain(0.06);
    expect(schedulePentaPluck(ctxOf(graph), outOf(graph), 300, 0, { level: 0 })).toBeNull();
    expect(graph.oscillators).toHaveLength(3);
  });

  it("follows the narrow velocity rule and rings short when the texture is busy", () => {
    expect(pluckVelocity(0)).toBeCloseTo(0.8, 9);
    expect(pluckVelocity(1)).toBeCloseTo(1, 9);
    expect(pluckVelocity(7)).toBeCloseTo(1, 9);
    expect(pluckT60(3, false)).toBe(LOOP_PLUCK.t60Sparse);
    expect(pluckT60(3, true)).toBe(LOOP_PLUCK.t60Dense);
    expect(pluckT60(11, false)).toBe(LOOP_PLUCK.t60Busy);
  });
});

describe("the voice budget", () => {
  it("lets at most 6 new notes start in a tick: 50 simultaneous hits make at most 12 oscillators", () => {
    const graph = fakeGraph();
    const budget = new LoopVoiceBudget();
    for (let i = 0; i < 50; i++) {
      const f = midiToFrequency(degreeToMidi(i % 15));
      const v = budget.note(2, f, 3);
      if (v.action === "start") schedulePentaPluck(ctxOf(graph), outOf(graph), f, 2);
    }
    expect(graph.oscillators.length).toBeLessThanOrEqual(12);
    expect(graph.oscillators.length).toBe(2 * LOOP_NOTES_PER_TICK);
  });

  it("merges a same-pitch hit within 30 ms (n hits = √n × one), and starts again in the next tick", () => {
    const budget = new LoopVoiceBudget();
    expect(budget.note(1, 440, 2).action).toBe("start");
    const merged = budget.note(1, 440, 2);
    expect([merged.action, merged.count, merged.sameTick]).toEqual(["merge", 2, true]);
    const later = budget.note(1.02, 440, 2);
    expect([later.action, later.count, later.sameTick]).toEqual(["merge", 3, false]);
    expect(budget.note(1.05, 440, 2).action).toBe("start"); // past 30 ms: a new note
    expect(loopChordGain(4)).toBeCloseTo(0.5, 9);
  });

  it("caps the ringing notes at 24 and the thumps and noise bursts at one a tick", () => {
    const budget = new LoopVoiceBudget();
    let started = 0;
    for (let tick = 0; tick < 10; tick++) for (let i = 0; i < 6; i++) if (budget.note(tick / 60, 100 + 10 * (6 * tick + i), 99).action === "start") started++;
    expect(started).toBe(LOOP_MAX_CONCURRENT);
    expect(budget.live(10 / 60)).toBe(LOOP_MAX_CONCURRENT);
    expect([budget.thump(5), budget.thump(5), budget.thump(5 + 1 / 60)]).toEqual([true, false, true]);
    expect([budget.noise(6), budget.noise(6)]).toEqual([true, false]);
    budget.reset();
    expect(budget.live(10 / 60)).toBe(0);
  });
});

describe("completionChord", () => {
  it("voices 4–5 notes of the open chord shared out with chordGain, a ding and a sub", () => {
    const voices = completionChordVoices(98);
    expect(voices.map((v) => v.frequency)).toEqual([98, 147, 196, 294, 98 * LOOP_CHORD.tenthMajor]);
    expect(voices.length).toBeGreaterThanOrEqual(4);
    expect(voices.length).toBeLessThanOrEqual(5);
    const graph = fakeGraph();
    scheduleCompletionChord(ctxOf(graph), outOf(graph), 98, 3, { level: 1 });
    const freqs = graph.oscillators.map((o) => o.frequency);
    for (const v of voices) expect(freqs.some((f) => Math.abs(f - v.frequency) < 1e-6)).toBe(true);
    // each voice's peak is the chord's gain × chordGain(5) (the 10th at −18 dB of that)
    const peak = LOOP_CHORD.gain * loopChordGain(voices.length);
    const peaks = graph.ramps.filter((r) => r.kind === "linear" && r.param === "gain" && r.value > 0).map((r) => r.value);
    expect(peaks.some((p) => Math.abs(p - peak) < 1e-9)).toBe(true);
    expect(peaks.some((p) => Math.abs(p - peak * LOOP_CHORD.tenthGain) < 1e-9)).toBe(true);
    // the ding (≈ 932 Hz) and the sub thump (55 Hz end, a sweep from 110)
    expect(freqs.some((f) => Math.abs(f - LOOP_CHORD.dingHz) < 1e-6)).toBe(true);
    expect(freqs).toContain(2 * LOOP_CHORD.subHz);
  });

  it("the tremolo variant holds the chord with an LFO at 1.7 Hz", () => {
    const graph = fakeGraph();
    scheduleCompletionChord(ctxOf(graph), outOf(graph), 110, 0, { tremolo: true, ding: false, sub: false });
    expect(graph.oscillators.map((o) => o.frequency)).toContain(LOOP_CHORD.tremoloHz);
  });
});

describe("resetTransition", () => {
  it("the glide ramps exponentially from root to the loop's note and its bell is silent at the loop point", () => {
    const graph = fakeGraph();
    const end = scheduleResetGlide(ctxOf(graph), outOf(graph), 98, 440, 10, 1);
    expect(end).toBe(11);
    const freq = graph.ramps.filter((r) => r.param === "frequency");
    expect(freq.filter((r) => r.kind === "exp")).toEqual([
      { kind: "exp", value: 440, time: 11, param: "frequency" },
      { kind: "exp", value: 880, time: 11, param: "frequency" },
    ]);
    const bell = graph.ramps.filter((r) => r.param === "gain" && r.kind === "linear");
    expect(bell.at(-1)).toMatchObject({ value: 0, time: 11 });
    expect(Math.max(...bell.map((r) => r.value))).toBeCloseTo(LOOP_GLIDE.gain, 9);
    expect(raisedCosine(0)).toBe(0);
    expect(raisedCosine(0.5)).toBeCloseTo(1, 9);
    expect(raisedCosine(1)).toBeCloseTo(0, 9);
  });

  it("the wash and the ratchet are noise through band-passes, the wash as long as asked", () => {
    const graph = fakeGraph();
    const noise = new NoiseCache().get(ctxOf(graph));
    expect(scheduleNoiseWash(ctxOf(graph), outOf(graph), 2, noise, 2)).toBe(4);
    expect(graph.filters.filter((f) => f.type === "bandpass").length).toBe(3); // the sweep and two high bands
    expect(graph.sources.some((s) => s.startArgs[2] >= 2)).toBe(true); // the noise plays (looping) for the whole wash
    const ticks = graph.ramps.length;
    scheduleRatchet(ctxOf(graph), outOf(graph), 0, 1, noise);
    expect(graph.ramps.length - ticks).toBeGreaterThanOrEqual(6 * 3);
  });
});

describe("the other families", () => {
  it("a bar strike is three partials and a click; a scanned bell skips under −40 dB", () => {
    const graph = fakeGraph();
    const noise = new NoiseCache().get(ctxOf(graph));
    scheduleBarStrike(ctxOf(graph), outOf(graph), 392, 0, noise);
    expect(graph.oscillators.map((o) => o.frequency)).toEqual([392, 4 * 392, 10 * 392]);
    expect(graph.sources).toHaveLength(1);
    expect(scanGain(0.5, 1)).toBeCloseTo(Math.pow(0.5, 1.5), 9);
    expect(scheduleScanStrike(ctxOf(graph), outOf(graph), 440, 0, 0.01, noise)).toBe(false);
    expect(scheduleScanStrike(ctxOf(graph), outOf(graph), 440, 0, 0.9, noise)).toBe(true);
    const bells = scanBellFrequencies(14);
    expect(bells).toHaveLength(14);
    expect(bells[13] / bells[0]).toBeCloseTo(4, 6); // two octaves
  });

  it("a ladder step is a sine with its 3f (or the chip), louder on the last step", () => {
    const graph = fakeGraph();
    scheduleProgressStep(ctxOf(graph), outOf(graph), 1046.5, 0);
    expect(graph.oscillators.map((o) => o.frequency)).toEqual([1046.5, 3 * 1046.5]);
    scheduleProgressStep(ctxOf(graph), outOf(graph), 1046.5, 1, { chip: true });
    expect(graph.oscillators.at(-1)!.type).toBe("square");
  });

  it("the groove bed holds at most 10 nodes, re-voices its pad and picks an original progression by seed", () => {
    const graph = fakeGraph();
    const bed = startGrooveBed(ctxOf(graph), outOf(graph), 0, 48);
    expect(bed.nodes).toBeLessThanOrEqual(10);
    expect(graph.oscillators.filter((o) => o.type === "triangle")).toHaveLength(4);
    bed.setChord(55, false, 2);
    bed.kick(2);
    bed.stop(4);
    for (const m of padVoicing(48)) expect(midiToFrequency(m)).toBeGreaterThanOrEqual(110 - 1e-6);
    expect(midiToFrequency(padVoicing(48).at(-1)!)).toBeLessThanOrEqual(440 + 1e-6);
    expect(midiToFrequency(subMidi(48))).toBeGreaterThanOrEqual(55 - 1e-6);
    let i = 0;
    const seq = [0.1, 0.5, 0.9];
    const chords = grooveProgression(() => seq[i++ % 3], 48);
    expect(chords).toHaveLength(4);
    expect(grooveProgression(() => 0.1, 48)).toEqual(grooveProgression(() => 0.1, 48)); // seeded: the same pick
  });

  it("the impact is a kick, a crack and a chord stab; the drone updates without new nodes", () => {
    const graph = fakeGraph();
    const noise = new NoiseCache().get(ctxOf(graph));
    scheduleImpactAccent(ctxOf(graph), outOf(graph), 0, noise, [98, 147, 196, 247]);
    expect(graph.filters.some((f) => f.type === "highpass")).toBe(true);
    expect(graph.oscillators.filter((o) => o.type === "sine").length).toBeGreaterThanOrEqual(5);
    const drone = startDrone(ctxOf(graph), outOf(graph), 98, 0, noise);
    expect(drone.nodes).toBeLessThanOrEqual(16);
    const before = graph.oscillators.length + graph.sources.length + graph.filters.length;
    drone.setEnergy(0.5, 0.1);
    drone.setEnergy(0.4, 0.11); // within 1/30 s: throttled
    drone.setSpeed(1, 0.2);
    expect(graph.oscillators.length + graph.sources.length + graph.filters.length).toBe(before);
    expect(graph.ramps.filter((r) => r.kind === "target").length).toBeGreaterThanOrEqual(3);
    drone.stop(1);
  });

  it("never makes a StereoPanner (the mix is dual-mono)", () => {
    const graph = fakeGraph();
    expect("createStereoPanner" in graph.ctx).toBe(false);
    const noise = new NoiseCache().get(ctxOf(graph));
    expect(() => {
      schedulePentaPluck(ctxOf(graph), outOf(graph), 440, 0, { bright: true });
      scheduleBarStrike(ctxOf(graph), outOf(graph), 440, 0, noise);
      scheduleCompletionChord(ctxOf(graph), outOf(graph), 98, 0, { tremolo: true });
      scheduleResetGlide(ctxOf(graph), outOf(graph), 98, 440, 0, 1);
      scheduleNoiseWash(ctxOf(graph), outOf(graph), 0, noise, 2);
      scheduleImpactAccent(ctxOf(graph), outOf(graph), 0, noise, [98, 147]);
      startGrooveBed(ctxOf(graph), outOf(graph), 0, 48).stop(1);
      startDrone(ctxOf(graph), outOf(graph), 98, 0, noise).stop(1);
    }).not.toThrow();
  });
});

describe("ToneGenerator.playLoop", () => {
  it("plays every kind at the context's time, snaps plucks to the scale and keeps the budget", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    graph.ctx.currentTime = 1;
    tone.playLoop("pluck", 440, 1);
    expect(graph.oscillators.filter((o) => o.startAt === 1).map((o) => o.frequency)).toEqual([440, 880]);
    // the scale snaps it (the Sound section's choice); the default chromatic leaves it
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, scale: "major", rootNote: 0 });
    graph.ctx.currentTime = 2;
    tone.playLoop("pluck", 450, 1);
    expect(graph.oscillators.find((o) => o.startAt === 2)!.frequency).toBeCloseTo(440, 6);
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
    // 50 hits in one tick: at most 12 oscillators
    graph.ctx.currentTime = 3;
    for (let i = 0; i < 50; i++) tone.playLoop("pluck", midiToFrequency(degreeToMidi(i % 15)), 1);
    expect(graph.oscillators.filter((o) => o.startAt === 3).length).toBeLessThanOrEqual(12);
    for (const kind of ["bar", "chime", "step", "land", "chord", "glide", "wash", "ratchet", "impact", "riser", "kick", "scan", "cut", "ding"] as const) {
      const before = graph.oscillators.length + graph.sources.length + graph.ramps.length;
      graph.ctx.currentTime += 0.5;
      tone.playLoop(kind, 220, 1, { durationSec: 1, toFrequency: 440, chord: [98, 147, 196] });
      expect([kind, graph.oscillators.length + graph.sources.length + graph.ramps.length > before]).toEqual([kind, true]);
    }
  });

  it("every dispatch routes a loop event to playLoop (the page, the fast export, the other arenas)", () => {
    const audio = { playLoop: vi.fn(), playWallHit: vi.fn() } as unknown as ToneGenerator;
    playSoundEvent(audio, { type: "hit", wallIndex: 0, frequency: 330, level: 0.9, loop: "pluck", melody: false }, () => undefined);
    playSoundEvent(audio, { type: "hit", wallIndex: 0, frequency: 98, loop: "glide", loopTo: 440, loopSec: 1, melody: false }, () => undefined);
    const calls = (audio as unknown as { playLoop: ReturnType<typeof vi.fn> }).playLoop.mock.calls;
    expect(calls[0]).toEqual(["pluck", 330, 0.9, expect.objectContaining({})]);
    expect(calls[1][3]).toMatchObject({ toFrequency: 440, durationSec: 1 });
    expect((audio as unknown as { playWallHit: ReturnType<typeof vi.fn> }).playWallHit).not.toHaveBeenCalled();
    const sink = { playLoop: vi.fn(), playWallHit: vi.fn() } as unknown as ArenaSoundSink;
    playArenaSound(sink, { type: "hit", wallIndex: 0, frequency: 330, loop: "pluck", melody: false });
    expect((sink as unknown as { playLoop: ReturnType<typeof vi.fn> }).playLoop).toHaveBeenCalledTimes(1);
  });
});
