import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";

/**
 * Drives the ToneGenerator through a minimal fake Web Audio graph to check how a wall hit is
 * dispatched once the three sound features are merged: song slicer first, then the hit sample
 * in "sample" mode, otherwise a synthesised voice (melody notes keep their own instrument),
 * and the beat lock placing voices and samples alike on the grid.
 */

interface OscLog {
  type: string;
  frequency: number;
  startAt: number;
}
interface SourceLog {
  startArgs: number[];
  playbackRate: number;
}

function fakeGraph() {
  const oscillators: OscLog[] = [];
  const sources: SourceLog[] = [];
  const param = (value = 0) => ({
    value,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
    cancelScheduledValues: () => undefined,
  });
  const ctx = {
    state: "running",
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    resume: async () => undefined,
    close: async () => undefined,
    decodeAudioData: async () => ({ duration: 0.3 }),
    createGain: () => ({ gain: param(1), connect: () => undefined, disconnect: () => undefined }),
    createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128, connect: () => undefined, disconnect: () => undefined }),
    createMediaStreamDestination: () => ({ stream: {}, connect: () => undefined }),
    createOscillator: () => {
      const osc = {
        type: "sine",
        frequency: param(0),
        connect: () => undefined,
        disconnect: () => undefined,
        onended: null as (() => void) | null,
        start: (when = 0) => {
          // The near-silent keep-alive oscillator runs at 1 Hz and is never a bounce sound.
          if (osc.frequency.value !== 1) oscillators.push({ type: osc.type, frequency: osc.frequency.value, startAt: when });
        },
        stop: () => undefined,
      };
      return osc;
    },
    createBufferSource: () => {
      const source = {
        buffer: null as unknown,
        context: ctx,
        playbackRate: param(1),
        connect: () => undefined,
        disconnect: () => undefined,
        onended: null as (() => void) | null,
        start: (...args: number[]) => sources.push({ startArgs: args, playbackRate: source.playbackRate.value }),
        stop: () => undefined,
      };
      return source;
    },
    createBuffer: (channels: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, copyToChannel: () => undefined }),
  };
  return { ctx, oscillators, sources };
}

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
});
