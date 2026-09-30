import { describe, expect, it } from "vitest";
import { analyzeBeats, type AudioLike } from "@/lib/audio/beats";
import {
  BEATS_PER_BAR,
  MAX_MARKERS,
  addMarker,
  analysisBeatSource,
  beatClockConfigOf,
  beatEnergies,
  bpmBeatSource,
  currentTapRun,
  doubleMarkers,
  downbeatPhase,
  estimateTapTempo,
  gridErrorSec,
  halveMarkers,
  manualBeatSource,
  markerIndexNear,
  markersBpm,
  moveMarker,
  nearestBeatIndex,
  nextGridPointSec,
  normalizeMarkers,
  nudgeMarkers,
  parseMarkers,
  previousGridPointSec,
  removeMarker,
  serializeMarkers,
  snapMarkersToOnsets,
  steadyMarkers,
  waveformPeaks,
} from "@/lib/simulation/beatSource";
import { beatTimeSec, firstBeatAtOrAfter } from "@/lib/simulation/beatSchedule";
import { BeatClock } from "@/lib/simulation/beatClock";
import { defaultVideoBeatsFields, onBeatConfigOfSettings, resolveVideoBeatsFields } from "@/lib/simulation/videoBeatsSettings";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

/* ------------------------------------------------------------------ a click track as a WAV file */

/** A 16-bit mono PCM WAV: 12 ms decaying 1 kHz clicks at every beat from `offset`, every `accentEvery`-th one louder. */
function clickWav(bpm: number, offset: number, seconds: number, { sampleRate = 44100, accentEvery = 4, accentPhase = 0 } = {}): Uint8Array {
  const frames = Math.round(seconds * sampleRate);
  const samples = new Int16Array(frames);
  const period = 60 / bpm;
  for (let k = 0, t = offset; t < seconds; k++, t = offset + k * period) {
    const start = Math.round(t * sampleRate);
    const amp = k % accentEvery === accentPhase ? 30000 : 12000;
    for (let j = 0; j < Math.round(0.012 * sampleRate) && start + j < frames; j++) {
      const tau = j / sampleRate;
      samples[start + j] = Math.round(amp * Math.sin(2 * Math.PI * 1000 * tau) * Math.exp(-tau / 0.004));
    }
  }
  const bytes = new Uint8Array(44 + 2 * frames);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + 2 * frames, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, 2 * sampleRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, 2 * frames, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + 2 * i, samples[i], true);
  return bytes;
}

/** Reads a 16-bit PCM WAV into the analyser's AudioLike (what decodeAudioData would give the page). */
function decodePcmWav(bytes: Uint8Array): AudioLike {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const dataBytes = view.getUint32(40, true);
  const length = dataBytes / 2 / channels;
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
  for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) data[c][i] = view.getInt16(44 + 2 * (i * channels + c), true) / 32768;
  return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
}

describe("a media grid from a click-track WAV", () => {
  for (const [bpm, offset] of [
    [120, 0.25],
    [96, 0.61],
    [140, 0.1],
  ] as const) {
    it(`puts every beat of a ${bpm} BPM click track within 5 ms of its click and finds the accented downbeat`, () => {
      const audio = decodePcmWav(clickWav(bpm, offset, 16, { accentPhase: 1 }));
      const analysis = analyzeBeats(audio);
      const energy = beatEnergies(audio, analysis.beatTimes);
      const grid = analysisBeatSource("media", analysis, { offset: 0, loop: true, energy });
      const period = 60 / bpm;
      expect(Math.abs(grid.bpm - bpm)).toBeLessThan(0.1);
      expect(grid.kind).toBe("media");
      expect(grid.beats.length).toBeGreaterThan(20);
      for (const b of grid.beats) {
        const k = Math.round((b - offset) / period);
        expect(Math.abs(b - (offset + k * period))).toBeLessThan(0.005);
      }
      // The accented click is every 4th one from click 1: the downbeats are those.
      expect(grid.energy.length).toBe(grid.beats.length);
      const firstDown = grid.downbeats[0];
      const k = Math.round((firstDown - offset) / period);
      expect(k % BEATS_PER_BAR).toBe(1);
      expect(grid.downbeats.length).toBe(grid.beats.filter((_, i) => i % BEATS_PER_BAR === grid.beats.indexOf(firstDown) % BEATS_PER_BAR).length);
    });
  }

  it("draws the waveform peaks once, normalised, with the clicks standing out", () => {
    const audio = decodePcmWav(clickWav(120, 0.25, 4));
    const peaks = waveformPeaks(audio, 400);
    expect(peaks.length).toBe(400);
    expect(Math.max(...peaks)).toBeCloseTo(1, 5);
    // Bucket of the first click (0.25 s of 4 s → bucket 25) is loud, the silence before it is not.
    expect(peaks[25]).toBeGreaterThan(0.3);
    expect(peaks[10]).toBe(0);
  });
});

/* ------------------------------------------------------------------ tap tempo */

describe("tap tempo", () => {
  it("estimates the tempo and the phase from jittery taps", () => {
    let seed = 7;
    const jitter = () => (((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1) * 0.015;
    const taps = Array.from({ length: 12 }, (_, i) => 3.2 + i * 0.5 + jitter());
    const est = estimateTapTempo(taps)!;
    expect(est).not.toBeNull();
    expect(Math.abs(est.bpm - 120)).toBeLessThan(1);
    expect(est.taps).toBe(12);
    // The phase is a beat of the tapped grid: a multiple of the period from 3.2 s.
    const k = (est.phase - 3.2) / 0.5;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(0.03);
  });

  it("counts a skipped beat as two and starts over after a long pause", () => {
    const skipped = [1, 1.5, 2, 3, 3.5, 4];
    expect(estimateTapTempo(skipped)!.bpm).toBeCloseTo(120, 0);
    const twoRuns = [1, 1.6, 2.2, 2.8, 9, 9.4, 9.8, 10.2];
    expect(currentTapRun(twoRuns)).toEqual([9, 9.4, 9.8, 10.2]);
    expect(estimateTapTempo(twoRuns)!.bpm).toBeCloseTo(150, 0);
  });

  it("needs three taps in the current run", () => {
    expect(estimateTapTempo([])).toBeNull();
    expect(estimateTapTempo([1, 1.5])).toBeNull();
    expect(estimateTapTempo([1, 1.5, 9, 9.5])).toBeNull();
  });

  it("turns the estimate into a steady marker grid over the song", () => {
    const markers = steadyMarkers(120, 3.25, 6);
    expect(markers[0]).toBe(250);
    expect(markers.length).toBe(12);
    expect(markersBpm(markers)).toBeCloseTo(120, 5);
  });
});

/* ------------------------------------------------------------------ markers */

describe("beat markers", () => {
  it("round-trips through the compact delta text, runs written as delta*count", () => {
    const steady = steadyMarkers(120, 0.25, 32);
    const text = serializeMarkers(steady);
    expect(text).toBe(`250.500*${steady.length - 1}`);
    expect(parseMarkers(text)).toEqual(steady);
    const irregular = [12, 530, 1044, 1561, 2090, 2601, 3105, 3105 + 480];
    expect(parseMarkers(serializeMarkers(irregular))).toEqual(irregular);
    expect(serializeMarkers([100, 200])).toBe("100.100");
    expect(parseMarkers("100.100")).toEqual([100, 200]);
    expect(serializeMarkers([])).toBe("");
  });

  it("drops malformed text instead of throwing", () => {
    for (const bad of ["abc", "1..2", "5*3", "1.-2", "1.2*0", "1,2,3", "9".repeat(30000)]) expect(parseMarkers(bad)).toEqual([]);
    expect(parseMarkers(null)).toEqual([]);
  });

  it("keeps markers sorted, whole, apart and capped", () => {
    expect(normalizeMarkers([500.4, 100, 110, -5, 300])).toEqual([0, 100, 300, 500]);
    expect(normalizeMarkers(Array.from({ length: MAX_MARKERS + 50 }, (_, i) => i * 30)).length).toBe(MAX_MARKERS);
  });

  it("adds, removes, moves, nudges, halves, doubles and snaps", () => {
    const m = [500, 1000, 1500, 2000];
    expect(addMarker(m, 1250)).toEqual([500, 1000, 1250, 1500, 2000]);
    expect(removeMarker(m, 1)).toEqual([500, 1500, 2000]);
    expect(moveMarker(m, 0, 1700)).toEqual([1000, 1500, 1700, 2000]);
    expect(nudgeMarkers(m, 10)).toEqual([510, 1010, 1510, 2010]);
    expect(nudgeMarkers([5, 500], -10)).toEqual([490]);
    expect(halveMarkers([0, 500, 1000, 1500, 2000])).toEqual([0, 1000, 2000]);
    expect(doubleMarkers(m)).toEqual([500, 750, 1000, 1250, 1500, 1750, 2000]);
    expect(markersBpm(doubleMarkers(m))).toBeCloseTo(2 * markersBpm(m), 6);
    expect(markersBpm(halveMarkers(doubleMarkers(m)))).toBeCloseTo(markersBpm(m), 6);
    expect(snapMarkersToOnsets([495, 1030, 1800], [0.5, 1.0, 1.5], 40)).toEqual([500, 1000, 1800]);
    expect(markerIndexNear(m, 1004, 6)).toBe(1);
    expect(markerIndexNear(m, 1200, 6)).toBe(-1);
  });
});

/* ------------------------------------------------------------------ sources and the clock */

describe("beat sources", () => {
  const detected = { bpm: 120, beatTimes: Array.from({ length: 40 }, (_, i) => 0.25 + 0.5 * i), duration: 20.2 };

  it("gives the same schedule whether the grid comes from the detector or from markers placed on its beats", () => {
    const media = beatClockConfigOf(analysisBeatSource("media", detected, { offset: 1.5, loop: true }), 90);
    const manual = beatClockConfigOf(manualBeatSource(detected.beatTimes.map((t) => t * 1000), { duration: detected.duration, offset: 1.5, loop: true }), 90);
    for (const t of [0, 0.3, 4.9, 18.4, 19.9, 25, 61.3]) {
      const a = firstBeatAtOrAfter(media, t);
      const b = firstBeatAtOrAfter(manual, t);
      expect(b).toBe(a);
      expect(beatTimeSec(manual, b)).toBeCloseTo(beatTimeSec(media, a), 6);
    }
    // And the clock samples them alike.
    const ca = new BeatClock();
    ca.setConfig(media);
    const cb = new BeatClock();
    cb.setConfig(manual);
    for (const t of [0.1, 3.33, 12.9, 40]) expect(cb.sample(t).index).toBe(ca.sample(t).index);
  });

  it("switching to the BPM source follows the tempo from 0 s; a source without input falls back to the BPM", () => {
    const bpm = beatClockConfigOf(bpmBeatSource(150, 30), 120);
    expect(bpm.source).toBe("bpm");
    expect(bpm.manualBpm).toBe(150);
    expect(beatTimeSec(bpm, 3)).toBeCloseTo(1.2, 9);
    const none = beatClockConfigOf(null, 110);
    expect(none.source).toBe("bpm");
    expect(none.manualBpm).toBe(110);
    const oneMarker = beatClockConfigOf(manualBeatSource([400], { duration: 0, offset: 0, loop: false }), 100);
    expect(oneMarker.source).toBe("bpm");
    expect(oneMarker.manualBpm).toBe(100);
  });

  it("finds the next grid point with subdivisions and measures the error to the nearest one", () => {
    const clock = beatClockConfigOf(analysisBeatSource("song", detected, { offset: 0, loop: false }), 120);
    expect(nextGridPointSec(clock, 0.1)).toBeCloseTo(0.25, 9);
    expect(nextGridPointSec(clock, 0.3)).toBeCloseTo(0.75, 9);
    expect(nextGridPointSec(clock, 0.3, 2)).toBeCloseTo(0.5, 9);
    expect(nextGridPointSec(clock, 0.51, 4)).toBeCloseTo(0.625, 9);
    expect(previousGridPointSec(clock, 0.7, 2)).toBeCloseTo(0.5, 9);
    expect(previousGridPointSec(clock, 0.1)).toBeNaN();
    expect(gridErrorSec(clock, 0.76)).toBeCloseTo(0.01, 9);
    expect(gridErrorSec(clock, 0.74)).toBeCloseTo(-0.01, 9);
    expect(nearestBeatIndex(clock, 0.99)).toBe(1);
    // Past the end of a song that does not loop the grid goes on at its tempo.
    expect(nextGridPointSec(clock, 20.1)).toBeCloseTo(20.25, 6);
  });

  it("puts the downbeats on the loudest bar phase, or where the setting says", () => {
    expect(downbeatPhase([0.4, 1, 0.4, 0.4, 0.4, 1, 0.4, 0.4])).toBe(1);
    const grid = analysisBeatSource("media", detected, { offset: 0, loop: true, downbeat: 2 });
    expect(grid.downbeats[0]).toBeCloseTo(detected.beatTimes[2], 9);
    expect(grid.downbeats.length).toBe(10);
  });
});

/* ------------------------------------------------------------------ settings */

describe("video-beats settings", () => {
  it("round-trip through the URL (bsrc, bm, bdb, onbeat, obr, vbg, vbgo) and are left out at their defaults", () => {
    const markers = serializeMarkers(steadyMarkers(128, 0.3, 20));
    const s = { ...defaultSettings("classic"), beatSource: "manual" as const, beatMarkers: markers, beatDownbeat: 2, onBeat: true, onBeatRange: 0.35, videoBackground: true, videoBgOpacity: 0.5 };
    const params = settingsToSearchParams(s);
    expect(params.get("bsrc")).toBe("manual");
    expect(params.get("bm")).toBe(markers);
    expect(params.get("onbeat")).toBe("1");
    expect(settingsFromSearchParams(params)).toEqual(s);
    const plain = settingsToSearchParams(defaultSettings("classic"));
    for (const key of ["bsrc", "bm", "bdb", "onbeat", "obr", "vbg", "vbgo"]) expect(plain.has(key)).toBe(false);
  });

  it("validates links and presets: unknown source, bad markers and out-of-range numbers fall back or clamp", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=classic&bsrc=tiktok&bm=1,2,3&bdb=9&obr=5&vbgo=-1&onbeat=yes"));
    expect(s.beatSource).toBe("song");
    expect(s.beatMarkers).toBe("");
    expect(s.beatDownbeat).toBe(3);
    expect(s.onBeatRange).toBe(0.8);
    expect(s.videoBgOpacity).toBe(0.05);
    expect(s.onBeat).toBe(false);
    const preset = presetToSettings({ mode: "classic", beatSource: "media", beatMarkers: "250.500*3", onBeat: true });
    expect(preset.beatSource).toBe("media");
    expect(parseMarkers(preset.beatMarkers)).toEqual([250, 750, 1250, 1750]);
    expect(preset.onBeat).toBe(true);
    expect(resolveVideoBeatsFields({})).toEqual(defaultVideoBeatsFields());
  });

  it("gives headless planners an On beat grid: the markers with the Manual source, the BPM otherwise", () => {
    const base = { ...defaultSettings("classic"), onBeat: true, bpm: 100, quantizeGrid: "1/16" as const };
    const bpm = onBeatConfigOfSettings(base);
    expect(bpm.enabled).toBe(true);
    expect(bpm.subdivisions).toBe(4);
    expect(bpm.clock?.source).toBe("bpm");
    expect(bpm.clock?.manualBpm).toBe(100);
    const manual = onBeatConfigOfSettings({ ...base, beatSource: "manual", beatMarkers: "300.600*9" });
    expect(manual.clock?.source).toBe("song");
    expect(manual.clock?.grid?.beatTimes[0]).toBeCloseTo(0.3, 9);
    expect(manual.clock?.grid?.bpm).toBeCloseTo(100, 6);
    expect(onBeatConfigOfSettings(defaultSettings("classic")).enabled).toBe(false);
  });

  it("keeps the old defaults: the song's beat, no markers, On beat and the video background off", () => {
    const d = defaultSettings("classic");
    expect(d.beatSource).toBe("song");
    expect(d.beatMarkers).toBe("");
    expect(d.onBeat).toBe(false);
    expect(d.videoBackground).toBe(false);
  });
});
