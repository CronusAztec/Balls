import { describe, expect, it } from "vitest";
import { BeatAnalyzer, DEFAULT_BEAT_OPTIONS, analyzeBeats, analyzeBeatsAsync, magnitudeSpectrum, type AudioLike } from "@/lib/audio/beats";

/**
 * A synthetic click track: 12 ms decaying 1 kHz bursts at every beat of `bpm`, the first at `offset`
 * seconds, over a −54 dB noise floor (deterministic LCG). `accent` scales every other click.
 */
function clickTrack(bpm: number, offset: number, seconds: number, { sampleRate = 22050, channels = 1, accent = 1 } = {}): AudioLike {
  const length = Math.round(seconds * sampleRate);
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
  let seed = 12345;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) data[c][i] = 0.002 * noise();
  const period = 60 / bpm;
  for (let k = 0, t = offset; t < seconds; k++, t = offset + k * period) {
    const start = Math.round(t * sampleRate);
    const amp = 0.9 * (k % 2 === 0 ? 1 : accent);
    for (let j = 0; j < Math.round(0.012 * sampleRate) && start + j < length; j++) {
      const tau = j / sampleRate;
      const v = amp * Math.sin(2 * Math.PI * 1000 * tau) * Math.exp(-tau / 0.004);
      for (let c = 0; c < channels; c++) data[c][start + j] += v;
    }
  }
  return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
}

function silence(seconds: number, sampleRate = 22050): AudioLike {
  const length = Math.round(seconds * sampleRate);
  return { numberOfChannels: 1, length, sampleRate, getChannelData: () => new Float32Array(length) };
}

const HOP_SEC = DEFAULT_BEAT_OPTIONS.hopSize / 22050;

describe("FFT", () => {
  it("puts a pure tone into its bin", () => {
    const n = 1024;
    const frame = new Float32Array(n);
    for (let i = 0; i < n; i++) frame[i] = Math.sin((2 * Math.PI * 37 * i) / n);
    const mag = magnitudeSpectrum(frame);
    let best = 0;
    for (let k = 1; k < mag.length; k++) if (mag[k] > mag[best]) best = k;
    expect(best).toBe(37);
    expect(mag[37]).toBeCloseTo(n / 2, 0);
    expect(mag[100]).toBeLessThan(1e-3);
  });
});

describe("beat detection on click tracks", () => {
  for (const bpm of [90, 120, 150]) {
    it(`finds ${bpm} BPM and the beat phase of a track that starts 0.37 s in`, () => {
      const result = analyzeBeats(clickTrack(bpm, 0.37, 20));
      expect(Math.abs(result.bpm - bpm)).toBeLessThan(0.5);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.duration).toBeCloseTo(20, 3);
      // The grid is regular and lands on the clicks (well within one hop of the true instants).
      const period = 60 / bpm;
      expect(result.beatTimes[0]).toBeGreaterThanOrEqual(0);
      expect(result.beatTimes[0]).toBeLessThan(period);
      for (let i = 1; i < result.beatTimes.length; i++) expect(result.beatTimes[i] - result.beatTimes[i - 1]).toBeCloseTo(period, 3);
      const nearestClick = (t: number) => Math.abs(t - 0.37 - Math.round((t - 0.37) / period) * period);
      for (const t of result.beatTimes) expect(nearestClick(t)).toBeLessThan(1.5 * HOP_SEC);
      expect(result.beatTimes[result.beatTimes.length - 1]).toBeLessThan(20);
      expect(result.beatTimes.length).toBeGreaterThanOrEqual(Math.floor(20 / period) - 1);
    });
  }

  it("detects the individual clicks as onsets", () => {
    const result = analyzeBeats(clickTrack(120, 0.37, 20));
    const clicks = Math.ceil((20 - 0.37) / 0.5);
    expect(Math.abs(result.onsets.length - clicks)).toBeLessThanOrEqual(1);
    for (const t of result.onsets) {
      const nearest = Math.abs(t - 0.37 - Math.round((t - 0.37) / 0.5) * 0.5);
      expect(nearest).toBeLessThan(1.5 * HOP_SEC);
    }
  });

  it("mixes stereo down and gives the same tempo", () => {
    const mono = analyzeBeats(clickTrack(150, 0.2, 16));
    const stereo = analyzeBeats(clickTrack(150, 0.2, 16, { channels: 2 }));
    expect(stereo.bpm).toBeCloseTo(mono.bpm, 1);
    expect(stereo.beatTimes[0]).toBeCloseTo(mono.beatTimes[0], 2);
  });

  it("does not halve the tempo of a march with accents on every other beat", () => {
    const result = analyzeBeats(clickTrack(120, 0.2, 20, { accent: 0.5 }));
    expect(Math.abs(result.bpm - 120)).toBeLessThan(0.5);
  });

  it("does not report the half-tempo alias at the top of the range", () => {
    const result = analyzeBeats(clickTrack(172, 0.1, 20));
    expect(Math.abs(result.bpm - 172)).toBeLessThan(0.5);
  });

  it("reports no tempo for silence or a buffer too short to hold a beat", () => {
    const quiet = analyzeBeats(silence(4));
    expect(quiet).toMatchObject({ bpm: 0, beatTimes: [], onsets: [], confidence: 0 });
    expect(quiet.duration).toBeCloseTo(4, 3);
    const tiny = analyzeBeats(clickTrack(120, 0, 0.1));
    expect(tiny.bpm).toBe(0);
    expect(tiny.beatTimes).toEqual([]);
  });

  it("is deterministic", () => {
    const a = analyzeBeats(clickTrack(96, 0.3, 12));
    const b = analyzeBeats(clickTrack(96, 0.3, 12));
    expect(a).toEqual(b);
  });
});

describe("incremental and asynchronous analysis", () => {
  it("computes the envelope in steps and reports progress", () => {
    const analyzer = new BeatAnalyzer(clickTrack(120, 0.37, 10));
    expect(analyzer.progress).toBe(0);
    let steps = 0;
    while (!analyzer.step(40)) steps++;
    expect(steps).toBeGreaterThan(5);
    expect(analyzer.progress).toBe(1);
    expect(Math.abs(analyzer.finish().bpm - 120)).toBeLessThan(0.5);
    expect(analyzer.finish()).toBe(analyzer.finish()); // cached
  });

  it("gives the same result as the synchronous analysis, in slices, with progress up to 1", async () => {
    const track = clickTrack(90, 0.37, 15);
    const progress: number[] = [];
    const async = await analyzeBeatsAsync(track, {}, { onProgress: (p) => progress.push(p), sliceMs: 1 });
    expect(async).toEqual(analyzeBeats(track));
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
  });

  it("rejects with an AbortError when cancelled", async () => {
    const controller = new AbortController();
    const promise = analyzeBeatsAsync(clickTrack(120, 0.37, 30), {}, { signal: controller.signal, sliceMs: 1 });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
