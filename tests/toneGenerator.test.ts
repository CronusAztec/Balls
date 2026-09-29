import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCENT_GAIN, DEFAULT_MUSIC_SETTINGS, MAX_CHORD_VOICES, ToneGenerator, chordGain, hitPitches } from "@/lib/audio/toneGenerator";
import { arpeggioNotes } from "@/lib/audio/multiplierTones";
import { fakeGraph } from "./fakeAudio";

/**
 * Drives the ToneGenerator through a minimal fake Web Audio graph to check how a wall hit is
 * dispatched once the three sound features are merged: song slicer first, then the hit sample
 * in "sample" mode, otherwise a synthesised voice (melody notes keep their own instrument),
 * and the beat lock placing voices and samples alike on the grid.
 */

describe("ToneGenerator wall-hit dispatch", () => {
  let graph: ReturnType<typeof fakeGraph>;
  let tone: ToneGenerator;

  beforeEach(async () => {
    graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    tone = new ToneGenerator();
    await tone.start();
  });
  afterEach(() => vi.unstubAllGlobals());

  const hitAt = (time: number, wall = 0) => {
    graph.ctx.currentTime = time;
    tone.playWallHit(wall);
  };

  it("plays the classic triangle wall tone and keeps the sine voice for melody notes at default settings", () => {
    hitAt(0, 0);
    expect(graph.oscillators).toEqual([{ type: "triangle", frequency: 800, startAt: 0 }]);
    tone.setCustomNotes([440, 660]);
    hitAt(1, 3);
    hitAt(2, 3);
    expect(graph.oscillators.slice(1)).toEqual([
      { type: "sine", frequency: 440, startAt: 1 },
      { type: "sine", frequency: 660, startAt: 2 },
    ]);
  });

  it("uses the bounce instrument for wall tones and the melody instrument for melody notes", () => {
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, instrument: "square" });
    hitAt(0);
    expect(graph.oscillators.at(-1)?.type).toBe("square");
    tone.setCustomNotes([523.25]);
    hitAt(1);
    expect(graph.oscillators.at(-1)?.type).toBe("sine");
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, instrument: "square", melodyInstrument: "saw" });
    hitAt(2);
    expect(graph.oscillators.at(-1)?.type).toBe("sawtooth");
  });

  it("snaps wall tones to the chosen scale", () => {
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, scale: "major", rootNote: 0 });
    hitAt(0, 0); // 800 Hz sits between G5 (784) and G#5 (831): the major scale picks G5
    expect(graph.oscillators.at(-1)?.frequency).toBeCloseTo(783.99, 1);
  });

  it("plays an accented hit (a DVD logo in a corner) louder than a plain one, voice and sample alike", async () => {
    const heard = (level: number) => graph.gains.some((g) => Math.abs(g - level) < 1e-9);
    hitAt(0, 3);
    expect(heard(0.25)).toBe(true); // the plain triangle envelope peak
    expect(heard(0.25 * ACCENT_GAIN)).toBe(false);
    graph.gains.length = 0;
    graph.ctx.currentTime = 1;
    tone.playWallHit(3, 523.25, true);
    expect(graph.oscillators.at(-1)).toEqual({ type: "triangle", frequency: 523.25, startAt: 1 });
    expect(heard(0.25 * ACCENT_GAIN)).toBe(true);
    // A melody note is accented too.
    tone.setCustomNotes([440]);
    graph.gains.length = 0;
    graph.ctx.currentTime = 2;
    tone.playWallHit(0, 523.25, true);
    expect(graph.oscillators.at(-1)).toEqual({ type: "sine", frequency: 440, startAt: 2 });
    expect(heard(0.35 * ACCENT_GAIN)).toBe(true);
    tone.clearCustomNotes();
    // Sample mode: the clip's level is scaled by the accent gain (within the 0–1 range).
    tone.setHitSoundMode("sample");
    tone.setHitSample("/hitSounds/click.wav");
    tone.setHitSampleVolume(0.5);
    await vi.waitFor(() => expect(tone.isHitSampleReady()).toBe(true));
    graph.gains.length = 0;
    graph.ctx.currentTime = 3;
    tone.playWallHit(0, 800);
    expect(heard(0.5)).toBe(true);
    expect(heard(0.5 * ACCENT_GAIN)).toBe(false);
    graph.gains.length = 0;
    graph.ctx.currentTime = 4;
    tone.playWallHit(0, 800, true);
    expect(heard(0.5 * ACCENT_GAIN)).toBe(true);
    tone.setHitSoundMode("tones");
  });

  it("plays a chord (Pendulum Wave bobs in line) as one sound: every pitch at once, the level shared out, one beat-grid slot, one melody note, one clip per pitch", async () => {
    expect(hitPitches(0, 440, undefined)).toEqual([440]);
    expect(hitPitches(2, undefined, undefined)).toEqual([640]);
    expect(hitPitches(0, 440, [440])).toEqual([440]);
    expect(hitPitches(0, 261.63, [261.63, 329.63, 261.63, 392, 0])).toEqual([261.63, 329.63, 392]);
    expect(hitPitches(0, 1, Array.from({ length: 40 }, (_, i) => 100 + i))).toHaveLength(MAX_CHORD_VOICES);
    expect(chordGain(1)).toBe(1);
    expect(chordGain(4)).toBe(0.5);
    const heard = (level: number) => graph.gains.some((g) => Math.abs(g - level) < 1e-9);
    graph.ctx.currentTime = 1;
    tone.playWallHit(0, 261.63, false, [261.63, 329.63, 392]);
    const chord = graph.oscillators.filter((o) => o.startAt === 1);
    expect(chord.map((o) => o.frequency)).toEqual([261.63, 329.63, 392]);
    expect(chord.every((o) => o.type === "triangle")).toBe(true);
    expect(heard(0.25 * chordGain(3))).toBe(true);
    expect(heard(0.25)).toBe(false);
    // An accented chord (the whole row in line) is louder still.
    graph.gains.length = 0;
    graph.ctx.currentTime = 1.5;
    tone.playWallHit(0, 261.63, true, [261.63, 329.63, 392, 523.25]);
    expect(heard(0.25 * chordGain(4) * ACCENT_GAIN)).toBe(true);
    // Beat lock: the whole chord sits in one grid slot and a later hit in that slot is dropped.
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4" });
    graph.oscillators.length = 0;
    graph.ctx.currentTime = 2.1;
    tone.playWallHit(0, 261.63, false, [261.63, 329.63]);
    expect(graph.oscillators.map((o) => o.startAt)).toEqual([2.5, 2.5]);
    graph.ctx.currentTime = 2.2;
    tone.playWallHit(0, 440);
    expect(graph.oscillators).toHaveLength(2);
    tone.setMusicSettings(DEFAULT_MUSIC_SETTINGS);
    // A loaded melody plays its next note once for the whole chord.
    tone.setCustomNotes([523.25, 659.25]);
    graph.oscillators.length = 0;
    graph.ctx.currentTime = 5;
    tone.playWallHit(0, 261.63, false, [261.63, 329.63, 392]);
    expect(graph.oscillators).toEqual([{ type: "sine", frequency: 523.25, startAt: 5 }]);
    tone.clearCustomNotes();
    // Sample mode: the clip plays once per pitch, transposed to it, at the shared level.
    tone.setHitSoundMode("sample");
    tone.setHitSample("/hitSounds/click.wav");
    tone.setHitSampleVolume(1);
    await vi.waitFor(() => expect(tone.isHitSampleReady()).toBe(true));
    graph.sources.length = 0;
    graph.gains.length = 0;
    graph.ctx.currentTime = 6;
    tone.playWallHit(0, 400, false, [400, 800]);
    expect(graph.sources.map((s) => s.playbackRate)).toEqual([0.5, 1]);
    expect(heard(chordGain(2))).toBe(true);
    // Not pitched by wall, every copy would sound the same (and n identical copies only add up √n times louder,
    // taking every voice): the clip plays once for the whole chord, at the level of one hit (an accent still counts).
    tone.setHitSamplePitchByWall(false);
    tone.setHitSampleVolume(0.5);
    graph.sources.length = 0;
    graph.gains.length = 0;
    graph.ctx.currentTime = 7;
    tone.playWallHit(0, 261.63, false, [261.63, 329.63, 392, 523.25]);
    expect(graph.sources.map((s) => s.playbackRate)).toEqual([1]);
    expect(heard(0.5)).toBe(true);
    graph.sources.length = 0;
    graph.gains.length = 0;
    graph.ctx.currentTime = 8;
    tone.playWallHit(0, 261.63, true, [261.63, 329.63, 392]);
    expect(graph.sources).toHaveLength(1);
    expect(heard(0.5 * ACCENT_GAIN)).toBe(true);
    tone.setHitSamplePitchByWall(true);
    tone.setHitSampleVolume(1);
    tone.setHitSoundMode("tones");
  });

  it("plays a hit at the pitch the mode chose (Ball Drop), snapped to the scale, transposes a hit sample to it and lets a melody keep its notes", async () => {
    hitAt(0, 3);
    expect(graph.oscillators.at(-1)?.frequency).toBe(560); // the wall tone
    graph.ctx.currentTime = 1;
    tone.playWallHit(3, 330);
    expect(graph.oscillators.at(-1)).toEqual({ type: "triangle", frequency: 330, startAt: 1 });
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, scale: "major", rootNote: 0 });
    graph.ctx.currentTime = 2;
    tone.playWallHit(0, 335); // just above E4 (329.63 Hz): C major keeps E4
    expect(graph.oscillators.at(-1)?.frequency).toBeCloseTo(329.63, 1);
    tone.setMusicSettings(DEFAULT_MUSIC_SETTINGS);
    tone.setHitSoundMode("sample");
    tone.setHitSample("/hitSounds/click.wav");
    await vi.waitFor(() => expect(tone.isHitSampleReady()).toBe(true));
    graph.ctx.currentTime = 3;
    tone.playWallHit(0, 400);
    expect(graph.sources.at(-1)?.playbackRate).toBeCloseTo(0.5); // 400 Hz relative to the 800 Hz innermost-wall tone
    tone.setHitSamplePitchByWall(false);
    tone.playWallHit(0, 400);
    expect(graph.sources.at(-1)?.playbackRate).toBe(1);
    tone.setHitSoundMode("tones");
    tone.setCustomNotes([440]);
    graph.ctx.currentTime = 4;
    tone.playWallHit(0, 330);
    expect(graph.oscillators.at(-1)).toEqual({ type: "sine", frequency: 440, startAt: 4 }); // a loaded melody wins
  });

  it("plays the hit sample instead of a voice in sample mode once the clip is decoded, pitched per wall", async () => {
    tone.setHitSoundMode("sample");
    tone.setHitSample("/hitSounds/click.wav");
    await vi.waitFor(() => expect(tone.isHitSampleReady()).toBe(true));
    expect(tone.getHitSampleStatus()).toBe("ready");
    hitAt(0, 0);
    hitAt(1, 5);
    expect(graph.oscillators).toHaveLength(0);
    expect(graph.sources.map((s) => s.playbackRate)).toEqual([1, 0.5]);
    tone.setHitSamplePitchByWall(false);
    hitAt(2, 5);
    expect(graph.sources.at(-1)?.playbackRate).toBe(1);
    tone.setHitSoundMode("tones");
    hitAt(3, 0);
    expect(graph.oscillators).toHaveLength(1);
  });

  it("falls back to the voice while no clip is decoded and reports the decode state", async () => {
    const seen: string[] = [];
    tone.setHitSampleStatusListener((status) => seen.push(status));
    tone.setHitSoundMode("sample");
    hitAt(0);
    expect(graph.oscillators).toHaveLength(1); // no clip selected yet: the tone plays
    graph.ctx.decodeAudioData = async () => {
      throw new Error("EncodingError");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    tone.setHitSample("blob:broken");
    await vi.waitFor(() => expect(tone.getHitSampleStatus()).toBe("error"));
    warn.mockRestore();
    expect(seen).toEqual(["loading", "error"]);
    hitAt(1);
    expect(graph.oscillators).toHaveLength(2); // still audible, and the panel is told why
  });

  it("lets the song slicer take over before samples and voices", async () => {
    tone.setHitSoundMode("sample");
    tone.setHitSample("/hitSounds/click.wav");
    await vi.waitFor(() => expect(tone.isHitSampleReady()).toBe(true));
    tone.getSlicer().setBuffer({ duration: 2 } as AudioBuffer);
    tone.getSlicer().setEnabled(true);
    hitAt(0);
    expect(graph.sources).toHaveLength(1);
    expect(graph.sources[0].startArgs).toEqual([0, 0, 0.25]); // a slice: (when, offset, duration)
    expect(graph.oscillators).toHaveLength(0);
    tone.getSlicer().setEnabled(false);
    hitAt(1);
    expect(graph.sources.at(-1)?.startArgs).toEqual([1]); // the sample again
  });

  it("plays a low sine for a merge and a high triangle for a split, placed on the beat grid like every other sound", () => {
    graph.ctx.currentTime = 0;
    tone.playInteraction("merge");
    tone.playInteraction("split");
    expect(graph.oscillators).toEqual([
      { type: "sine", frequency: 130.81, startAt: 0 },
      { type: "triangle", frequency: 1046.5, startAt: 0 },
    ]);
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4" }); // 0.5 s steps from the run start
    graph.ctx.currentTime = 0.1;
    tone.playInteraction("split");
    expect(graph.oscillators.at(-1)?.startAt).toBe(0.5);
    // A scale snaps the tones like the wall tones: 130.81 Hz is C3, which the D major scale does not contain
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, scale: "major", rootNote: 2 });
    tone.playInteraction("merge");
    expect(graph.oscillators.at(-1)?.frequency).not.toBeCloseTo(130.81, 1);
  });

  it("puts voices and samples on the beat grid and drops extra hits in an occupied slot", async () => {
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4" }); // 0.5 s steps from the run start
    hitAt(0.1);
    hitAt(0.2);
    hitAt(0.6);
    expect(graph.oscillators.map((o) => o.startAt)).toEqual([0.5, 1]);
    tone.setHitSoundMode("sample");
    tone.setHitSample("/hitSounds/click.wav");
    await vi.waitFor(() => expect(tone.isHitSampleReady()).toBe(true));
    hitAt(1.1);
    hitAt(1.2);
    expect(graph.sources.map((s) => s.startArgs)).toEqual([[1.5]]);
  });

  // --- jdm-rhythm-runner ---
  it("plays an accompaniment hit (melody false: a paddle's wall, a runner's crash) under a melody without using up a note, the cooldown, a slice or a beat-lock slot", async () => {
    const at = (t: number) => graph.oscillators.filter((o) => Math.abs(o.startAt - t) < 1e-9);
    /** The oscillators `play` starts. */
    const started = (play: () => void) => {
      const from = graph.oscillators.length;
      play();
      return graph.oscillators.slice(from).map((o) => ({ type: o.type, frequency: o.frequency }));
    };
    tone.setCustomNotes([440, 660, 880]);
    graph.ctx.currentTime = 1;
    expect(started(() => tone.playWallHit(0))).toEqual([{ type: "sine", frequency: 440 }]); // a note of the tune
    // Inside the melody's cooldown an accompaniment hit still sounds, with its own pitch and the bounce instrument.
    graph.ctx.currentTime = 1.05;
    expect(started(() => tone.playWallHit(0, 523.25, false, undefined, 0.3, false))).toEqual([{ type: "triangle", frequency: 523.25 }]);
    graph.ctx.currentTime = 1.3;
    expect(started(() => tone.playWallHit(0, 587.33, false, undefined, 1, false))).toEqual([{ type: "triangle", frequency: 587.33 }]);
    // The streak chime: unrooted, with the bounce instrument.
    expect(started(() => tone.playMultiplier(10, false))).toEqual(arpeggioNotes(10).map((n) => ({ type: "triangle", frequency: n.frequency })));
    // Right after them the tune goes on with its NEXT note.
    graph.ctx.currentTime = 1.34;
    expect(started(() => tone.playWallHit(0))).toEqual([{ type: "sine", frequency: 660 }]);
    // The game over: its whole chord.
    graph.ctx.currentTime = 1.6;
    expect(started(() => tone.playWallHit(0, 261.63, true, [261.63, 329.63, 392], 1, false)).map((o) => o.frequency)).toEqual([261.63, 329.63, 392]);
    // A multiplier of the tune is rooted on the melody's next note (880) and uses it up, so the melody wraps round.
    const rooted = started(() => tone.playMultiplier(10));
    expect(rooted.every((o) => o.type === "sine")).toBe(true);
    expect(rooted[0].frequency).toBeCloseTo(880, 6);
    graph.ctx.currentTime = 1.9;
    expect(started(() => tone.playWallHit(0))).toEqual([{ type: "sine", frequency: 440 }]);
    expect(at(1.05)).toHaveLength(1);
    // The song slicer: an accompaniment hit plays its tone and leaves the song where it is.
    tone.clearCustomNotes();
    tone.getSlicer().setBuffer({ duration: 2 } as AudioBuffer);
    tone.getSlicer().setEnabled(true);
    graph.ctx.currentTime = 2;
    tone.playWallHit(0, 523.25, false, undefined, 1, false);
    tone.playMultiplier(20, false);
    expect(graph.sources).toHaveLength(0);
    expect(at(2)[0]).toEqual({ type: "triangle", frequency: 523.25, startAt: 2 });
    graph.ctx.currentTime = 2.5;
    tone.playWallHit(0);
    expect(graph.sources.map((s) => s.startArgs)).toEqual([[2.5, 0, 0.25]]); // the first slice, from the start of the song
    tone.getSlicer().setEnabled(false);
    // The beat lock: it fills a free slot but leaves it to the tune, and it is dropped from a slot the tune holds.
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4" }); // 0.5 s steps from the run start
    tone.setCustomNotes([440, 660]);
    graph.oscillators.length = 0;
    graph.ctx.currentTime = 3.1;
    tone.playWallHit(0, 523.25, false, undefined, 1, false);
    graph.ctx.currentTime = 3.2;
    tone.playWallHit(0);
    graph.ctx.currentTime = 3.3;
    tone.playWallHit(0, 523.25, false, undefined, 1, false);
    expect(graph.oscillators).toEqual([
      { type: "triangle", frequency: 523.25, startAt: 3.5 },
      { type: "sine", frequency: 440, startAt: 3.5 },
    ]);
    // A hit sample alike.
    tone.clearCustomNotes();
    tone.setHitSoundMode("sample");
    tone.setHitSample("/hitSounds/click.wav");
    await vi.waitFor(() => expect(tone.isHitSampleReady()).toBe(true));
    graph.ctx.currentTime = 4.1;
    tone.playWallHit(0, 400, false, undefined, 1, false);
    graph.ctx.currentTime = 4.2;
    tone.playWallHit(0, 400);
    graph.ctx.currentTime = 4.3;
    tone.playWallHit(0, 400, false, undefined, 1, false);
    expect(graph.sources.slice(1).map((s) => s.startArgs)).toEqual([[4.5], [4.5]]);
  });
});
