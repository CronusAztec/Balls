import type { AudioLike, BeatAnalysis } from "@/lib/audio/beats";
import { isUsableGrid, type BeatClockConfig } from "./beatClock";
import { beatTimeSec, firstBeatAtOrAfter } from "./beatSchedule";

/**
 * --- video-beats --- The beat source: ONE small grid that every rhythm feature reads (the beat lock, Picture Paint, the
 * Beat Runner / Paddle Keep-Up, the On beat quantiser of the ring modes, the Beat Drop mode and the bot), whatever it was
 * made from. Keep this interface small – other features build on it:
 *
 *   interface BeatSourceGrid {
 *     kind: "bpm" | "song" | "media" | "manual";  // where it came from
 *     beats: number[];      // beat instants, seconds of the song (of the simulation for "bpm"), ascending
 *     downbeats: number[];  // the beats that open a bar (a subset of `beats`)
 *     bpm: number;          // tempo estimate (the median beat spacing for hand-placed markers)
 *     offset: number;       // song seconds already played at simulation time 0 (the music bed's start offset)
 *     energy: number[];     // 0–1 loudness of every beat (1 without audio), same length as `beats`
 *     duration: number;     // song length; the grid wraps here when `loop`
 *     loop: boolean;        // the song (and so the grid) starts over at its end
 *   }
 *
 * Sources:
 *  - "bpm":    the Sound section's BPM setting – beat k at k · 60 / BPM simulation seconds;
 *  - "song":   the beat detector (lib/audio/beats.ts) on the loaded music bed or song-slicer song;
 *  - "media":  the beat detector on the audio track of an imported video or audio file (which becomes the music bed);
 *  - "manual": markers placed by hand on the waveform, by tap tempo or from the detected beats (URL `bm`).
 *
 * `beatClockConfigOf()` turns any grid into the `BeatClockConfig` the existing clock (beatClock.ts) and schedule
 * (beatSchedule.ts) already understand, so "when is the next beat" has one answer everywhere: song time = offset +
 * simulation time. The marker helpers (serialisation, add / remove / move, nudge, snap to onsets, halve / double) and
 * tap tempo are pure too; the page-side import and editor live in components/simulator/useVideoBeats.ts.
 * Pure and deterministic (no wall clock, no Math.random).
 */

export const BEAT_SOURCE_KINDS = ["bpm", "song", "media", "manual"] as const;
export type BeatSourceKind = (typeof BEAT_SOURCE_KINDS)[number];

export function isBeatSourceKind(value: unknown): value is BeatSourceKind {
  return typeof value === "string" && (BEAT_SOURCE_KINDS as readonly string[]).includes(value);
}

export interface BeatSourceGrid {
  kind: BeatSourceKind;
  beats: readonly number[];
  downbeats: readonly number[];
  bpm: number;
  offset: number;
  energy: readonly number[];
  duration: number;
  loop: boolean;
}

/** Beats per bar the downbeats are counted in (4/4). */
export const BEATS_PER_BAR = 4;

/* ------------------------------------------------------------------ building grids */

/** The manual BPM as a grid of `durationSec` (beat 0 at 0 s). */
export function bpmBeatSource(bpm: number, durationSec: number): BeatSourceGrid {
  const period = bpm > 0 ? 60 / bpm : 0;
  const beats: number[] = [];
  if (period > 0) for (let k = 0; k * period <= durationSec + 1e-9 && k < 100000; k++) beats.push(k * period);
  return { kind: "bpm", beats, downbeats: beats.filter((_, i) => i % BEATS_PER_BAR === 0), bpm: period > 0 ? bpm : 0, offset: 0, energy: beats.map(() => 1), duration: Math.max(0, durationSec), loop: false };
}

export interface GridSourceOptions {
  offset: number;
  loop: boolean;
  /** Loudness of every beat (0–1); all 1 when left out. */
  energy?: readonly number[];
  /** Index (0 … BEATS_PER_BAR−1) of the first downbeat; <0 = the loudest phase (`downbeatPhase()`). */
  downbeat?: number;
}

/** A detected grid (the beat detector's `bpm`, `beatTimes`, `duration`) as a beat source of `kind` ("song" or "media"). */
export function analysisBeatSource(kind: "song" | "media", analysis: Pick<BeatAnalysis, "bpm" | "beatTimes" | "duration">, options: GridSourceOptions): BeatSourceGrid {
  const beats = analysis.beatTimes.slice();
  const energy = beats.map((_, i) => clamp01(options.energy?.[i] ?? 1));
  const phase = options.downbeat !== undefined && options.downbeat >= 0 ? Math.floor(options.downbeat) % BEATS_PER_BAR : downbeatPhase(energy);
  return { kind, beats, downbeats: beats.filter((_, i) => i % BEATS_PER_BAR === phase), bpm: analysis.bpm, offset: Math.max(0, options.offset), energy, duration: Math.max(analysis.duration, beats.length ? beats[beats.length - 1] : 0), loop: options.loop };
}

/**
 * Hand-placed markers (milliseconds of the song, see `parseMarkers()`) as the "manual" source. The tempo is the median
 * marker spacing; the song length is `duration` (the media's) or, without a song, one period past the last marker.
 */
export function manualBeatSource(markersMs: readonly number[], options: GridSourceOptions & { duration: number }): BeatSourceGrid {
  const beats = normalizeMarkers(markersMs).map((ms) => ms / 1000);
  const bpm = markersBpm(markersMs);
  const period = bpm > 0 ? 60 / bpm : 0;
  const energy = beats.map((_, i) => clamp01(options.energy?.[i] ?? 1));
  const phase = options.downbeat !== undefined && options.downbeat >= 0 ? Math.floor(options.downbeat) % BEATS_PER_BAR : 0;
  const last = beats.length ? beats[beats.length - 1] : 0;
  const duration = options.duration > 0 ? Math.max(options.duration, last) : last + period;
  return { kind: "manual", beats, downbeats: beats.filter((_, i) => i % BEATS_PER_BAR === phase), bpm, offset: Math.max(0, options.offset), energy, duration, loop: options.loop && options.duration > 0 };
}

/** Median spacing of the markers as a tempo (0 with fewer than two markers). */
export function markersBpm(markersMs: readonly number[]): number {
  const m = normalizeMarkers(markersMs);
  if (m.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < m.length; i++) gaps.push(m[i] - m[i - 1]);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return median > 0 ? 60000 / median : 0;
}

/** Index (0 … perBar−1) of the bar phase whose beats are loudest on average: the downbeat of a detected grid. */
export function downbeatPhase(energy: readonly number[], perBar = BEATS_PER_BAR): number {
  if (energy.length < perBar) return 0;
  let best = 0;
  let bestMean = -Infinity;
  for (let phase = 0; phase < perBar; phase++) {
    let sum = 0;
    let n = 0;
    for (let i = phase; i < energy.length; i += perBar) {
      sum += energy[i];
      n++;
    }
    const mean = n > 0 ? sum / n : 0;
    if (mean > bestMean + 1e-9) {
      bestMean = mean;
      best = phase;
    }
  }
  return best;
}

/**
 * The loudness of every beat: RMS of the mono mix over `windowSec` from the beat, normalised to the loudest beat (0–1).
 * Used for the downbeat guess and handed to consumers that accent strong beats.
 */
export function beatEnergies(audio: AudioLike, beats: readonly number[], windowSec = 0.06): number[] {
  const rate = audio.sampleRate > 0 ? audio.sampleRate : 44100;
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
  const n = Math.max(1, Math.round(windowSec * rate));
  const out = beats.map((t) => {
    const start = Math.max(0, Math.round(t * rate));
    const end = Math.min(audio.length, start + n);
    let sum = 0;
    for (let i = start; i < end; i++) {
      let s = 0;
      for (const ch of channels) s += ch[i];
      s /= channels.length || 1;
      sum += s * s;
    }
    return end > start ? Math.sqrt(sum / (end - start)) : 0;
  });
  const max = out.reduce((m, v) => (v > m ? v : m), 0);
  return out.map((v) => (max > 0 ? v / max : 1));
}

/** The grid as the clock / schedule configuration (a "bpm" grid follows the manual tempo; every other one its beats). */
export function beatClockConfigOf(grid: BeatSourceGrid | null, fallbackBpm: number): BeatClockConfig {
  if (!grid || grid.kind === "bpm" || grid.beats.length < 2 || !(grid.bpm > 0)) {
    const bpm = grid && grid.kind === "bpm" && grid.bpm > 0 ? grid.bpm : fallbackBpm;
    return { source: "bpm", grid: null, manualBpm: bpm, offset: 0, loop: false, decay: 3 };
  }
  return { source: "song", grid: { bpm: grid.bpm, beatTimes: grid.beats, duration: grid.duration }, manualBpm: fallbackBpm, offset: grid.offset, loop: grid.loop, decay: 3 };
}

/* ------------------------------------------------------------------ grid queries (simulation seconds) */

/**
 * The first grid point at or after `t` (simulation seconds) on the beats subdivided `subdivisions` times (1 = beats,
 * 2 = eighths, 4 = sixteenths), with a 1e-6 s tolerance; NaN without a tempo. Beats before the song's first beat are
 * never subdivided (the grid starts at the first beat).
 */
export function nextGridPointSec(config: BeatClockConfig, t: number, subdivisions = 1): number {
  const sub = Math.max(1, Math.floor(subdivisions));
  const time = Math.max(0, t);
  const i = firstBeatAtOrAfter(config, time);
  if (i < 0) return NaN;
  const beat = beatTimeSec(config, i);
  if (sub === 1 || i === 0) return beat;
  const prev = beatTimeSec(config, i - 1);
  if (!(beat > prev)) return beat;
  const step = (beat - prev) / sub;
  const k = Math.ceil((time - prev - 1e-6) / step);
  return k >= sub ? beat : prev + Math.max(0, k) * step;
}

/** Signed distance (s) from `t` to the nearest grid point (subdivided like `nextGridPointSec()`); NaN without a tempo. */
export function gridErrorSec(config: BeatClockConfig, t: number, subdivisions = 1): number {
  const next = nextGridPointSec(config, t, subdivisions);
  if (!Number.isFinite(next)) return NaN;
  const prev = previousGridPointSec(config, t, subdivisions);
  const after = next - t;
  if (!Number.isFinite(prev)) return -after;
  const before = t - prev;
  return before <= after ? before : -after;
}

/** The last grid point at or before `t` (simulation seconds); NaN before the first one or without a tempo. */
export function previousGridPointSec(config: BeatClockConfig, t: number, subdivisions = 1): number {
  const sub = Math.max(1, Math.floor(subdivisions));
  const i = firstBeatAtOrAfter(config, Math.max(0, t));
  if (i < 0) return NaN;
  const beat = beatTimeSec(config, i);
  if (Math.abs(beat - t) <= 1e-6) return beat;
  if (i === 0) return NaN;
  const prev = beatTimeSec(config, i - 1);
  if (prev > t + 1e-6) return NaN;
  if (sub === 1) return prev;
  const step = (beat - prev) / sub;
  return prev + Math.min(sub - 1, Math.floor((t - prev + 1e-6) / step)) * step;
}

/** The beat index (numbered like `BeatClock.sample().index`) of the beat nearest `t`; −1 without a tempo. */
export function nearestBeatIndex(config: BeatClockConfig, t: number): number {
  const i = firstBeatAtOrAfter(config, Math.max(0, t));
  if (i < 0) return -1;
  if (i === 0) return 0;
  return Math.abs(beatTimeSec(config, i) - t) <= Math.abs(t - beatTimeSec(config, i - 1)) ? i : i - 1;
}

/** True when the configuration has a tempo to follow (a usable song grid, or a positive manual BPM). */
export function clockHasTempo(config: BeatClockConfig | null | undefined): config is BeatClockConfig {
  if (!config) return false;
  return config.source === "song" && isUsableGrid(config.grid) ? true : config.manualBpm > 0;
}

/* ------------------------------------------------------------------ markers */

/** Most markers a grid keeps (a 3-minute song at 200 BPM has 600 beats; doubled twice 2 400). */
export const MAX_MARKERS = 4000;
/** Latest marker (ms): an hour. */
export const MAX_MARKER_MS = 3_600_000;
/** Two markers closer than this (ms) are one. */
export const MIN_MARKER_GAP_MS = 20;
/** Longest `bm` value read from a link or preset. */
export const MAX_MARKER_TEXT = 24000;

/** Whole milliseconds, sorted, within 0 … an hour, at least `MIN_MARKER_GAP_MS` apart, at most `MAX_MARKERS`. */
export function normalizeMarkers(markersMs: readonly number[]): number[] {
  const sorted = markersMs.filter((v) => Number.isFinite(v)).map((v) => Math.round(Math.max(0, Math.min(MAX_MARKER_MS, v)))).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length && v - out[out.length - 1] < MIN_MARKER_GAP_MS) continue;
    out.push(v);
    if (out.length >= MAX_MARKERS) break;
  }
  return out;
}

/**
 * The compact text of the `bm` setting: delta-encoded milliseconds separated by dots, with a run of equal deltas written
 * as `delta*count` – a steady 120 BPM grid from 250 ms over 64 beats is `250.500*63`.
 */
export function serializeMarkers(markersMs: readonly number[]): string {
  const m = normalizeMarkers(markersMs);
  if (m.length === 0) return "";
  const parts: string[] = [String(m[0])];
  let i = 1;
  while (i < m.length) {
    const d = m[i] - m[i - 1];
    let run = 1;
    while (i + run < m.length && m[i + run] - m[i + run - 1] === d) run++;
    parts.push(run > 2 ? `${d}*${run}` : run === 2 ? `${d}.${d}` : String(d));
    i += run;
  }
  return parts.join(".");
}

/** Reads `serializeMarkers()` text back; anything malformed yields no markers (never throws). */
export function parseMarkers(text: string | null | undefined): number[] {
  if (typeof text !== "string" || !text || text.length > MAX_MARKER_TEXT) return [];
  if (!/^\d+(\*\d+)?(\.\d+(\*\d+)?)*$/.test(text)) return [];
  const out: number[] = [];
  let at = 0;
  const parts = text.split(".");
  for (let p = 0; p < parts.length; p++) {
    const [dRaw, nRaw] = parts[p].split("*");
    const d = Number(dRaw);
    const n = nRaw === undefined ? 1 : Number(nRaw);
    if (!Number.isFinite(d) || !Number.isInteger(n) || n < 1) return [];
    if (p === 0 && n !== 1) return [];
    for (let k = 0; k < n; k++) {
      at = p === 0 ? d : at + d;
      if (at > MAX_MARKER_MS) return normalizeMarkers(out);
      out.push(at);
      if (out.length > MAX_MARKERS) return normalizeMarkers(out);
    }
  }
  return normalizeMarkers(out);
}

/** Index of the marker nearest `atMs` within `toleranceMs`, or −1. */
export function markerIndexNear(markersMs: readonly number[], atMs: number, toleranceMs: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < markersMs.length; i++) {
    const d = Math.abs(markersMs[i] - atMs);
    if (d <= toleranceMs && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function addMarker(markersMs: readonly number[], atMs: number): number[] {
  return normalizeMarkers([...markersMs, atMs]);
}

export function removeMarker(markersMs: readonly number[], index: number): number[] {
  return normalizeMarkers(markersMs.filter((_, i) => i !== index));
}

/** Moves marker `index` to `toMs` (it keeps its place in time order after the move). */
export function moveMarker(markersMs: readonly number[], index: number, toMs: number): number[] {
  if (index < 0 || index >= markersMs.length) return normalizeMarkers(markersMs);
  const next = markersMs.slice();
  next[index] = toMs;
  return normalizeMarkers(next);
}

/** Every marker `deltaMs` later (earlier when negative); markers pushed below 0 ms are dropped. */
export function nudgeMarkers(markersMs: readonly number[], deltaMs: number): number[] {
  return normalizeMarkers(markersMs.map((v) => v + deltaMs).filter((v) => v >= 0));
}

/** Every marker moved onto the nearest detected onset (seconds) within `maxDistMs`; markers without one stay. */
export function snapMarkersToOnsets(markersMs: readonly number[], onsetsSec: readonly number[], maxDistMs = 70): number[] {
  if (onsetsSec.length === 0) return normalizeMarkers(markersMs);
  const onsets = onsetsSec.map((s) => s * 1000).sort((a, b) => a - b);
  return normalizeMarkers(
    markersMs.map((v) => {
      let lo = 0;
      let hi = onsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (onsets[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      let best = onsets[lo];
      if (lo > 0 && Math.abs(onsets[lo - 1] - v) < Math.abs(best - v)) best = onsets[lo - 1];
      return Math.abs(best - v) <= maxDistMs ? best : v;
    }),
  );
}

/** Half the tempo: every other marker (the first stays). */
export function halveMarkers(markersMs: readonly number[]): number[] {
  return normalizeMarkers(normalizeMarkers(markersMs).filter((_, i) => i % 2 === 0));
}

/** Double the tempo: a marker halfway between every two neighbours. */
export function doubleMarkers(markersMs: readonly number[]): number[] {
  const m = normalizeMarkers(markersMs);
  const out: number[] = [];
  for (let i = 0; i < m.length; i++) {
    out.push(m[i]);
    if (i + 1 < m.length) out.push((m[i] + m[i + 1]) / 2);
  }
  return normalizeMarkers(out);
}

/** A steady grid (ms) from `phaseSec` at `bpm` over `durationSec` (earlier beats back to 0 included). */
export function steadyMarkers(bpm: number, phaseSec: number, durationSec: number): number[] {
  if (!(bpm > 0) || !(durationSec > 0)) return [];
  const period = 60 / bpm;
  let first = phaseSec - Math.floor(phaseSec / period) * period;
  if (first < 0) first += period;
  const out: number[] = [];
  for (let t = first; t <= durationSec + 1e-9 && out.length < MAX_MARKERS; t += period) out.push(t * 1000);
  return normalizeMarkers(out);
}

/* ------------------------------------------------------------------ tap tempo */

/** Taps further apart than this (s) start a new tap run. */
export const TAP_RESET_SEC = 2.5;
/** Taps kept for the estimate. */
export const MAX_TAPS = 32;

export interface TapEstimate {
  bpm: number;
  /** Time (s, in the tapped timeline) of a beat: the fitted grid's beat nearest the last tap. */
  phase: number;
  /** Taps the estimate used. */
  taps: number;
}

/** The taps that belong to the current run: the latest ones back to the first gap longer than `TAP_RESET_SEC`. */
export function currentTapRun(taps: readonly number[]): number[] {
  const sorted = taps.filter((t) => Number.isFinite(t)).slice().sort((a, b) => a - b);
  let start = sorted.length - 1;
  while (start > 0 && sorted[start] - sorted[start - 1] <= TAP_RESET_SEC) start--;
  return sorted.slice(Math.max(start, sorted.length - MAX_TAPS));
}

/**
 * Tempo and phase from taps (seconds): the median interval gives the period (a skipped beat counts as two), then a
 * least-squares fit of tap i = phase + k_i · period refines both. Null with fewer than three taps in the current run.
 */
export function estimateTapTempo(taps: readonly number[]): TapEstimate | null {
  const run = currentTapRun(taps);
  if (run.length < 3) return null;
  const intervals: number[] = [];
  for (let i = 1; i < run.length; i++) intervals.push(run[i] - run[i - 1]);
  const sorted = intervals.slice().sort((a, b) => a - b);
  let period = sorted[sorted.length >> 1];
  if (!(period > 0.2 && period < 2)) period = Math.min(2, Math.max(0.2, period || 0.5));
  let phase = run[0];
  for (let iteration = 0; iteration < 3; iteration++) {
    let n = 0;
    let sk = 0;
    let st = 0;
    let skk = 0;
    let skt = 0;
    for (const t of run) {
      const k = Math.round((t - phase) / period);
      n++;
      sk += k;
      st += t;
      skk += k * k;
      skt += k * t;
    }
    const denom = n * skk - sk * sk;
    if (!(denom > 0)) break;
    const slope = (n * skt - sk * st) / denom;
    const intercept = (st - slope * sk) / n;
    if (!(slope > 0.15 && slope < 2.5)) break;
    period = slope;
    phase = intercept;
  }
  const last = run[run.length - 1];
  const k = Math.round((last - phase) / period);
  return { bpm: 60 / period, phase: phase + k * period, taps: run.length };
}

/* ------------------------------------------------------------------ waveform */

/**
 * Peak envelope for the waveform strip: `buckets` values in 0–1, the loudest |sample| of the mono mix in every bucket,
 * normalised to the loudest one. Computed once per imported file (the strip caches its drawing too).
 */
export function waveformPeaks(audio: AudioLike, buckets: number): Float32Array {
  const n = Math.max(1, Math.floor(buckets));
  const out = new Float32Array(n);
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
  if (audio.length === 0 || channels.length === 0) return out;
  const per = audio.length / n;
  // A stride keeps a long file cheap: at most ~2 000 reads per bucket.
  const stride = Math.max(1, Math.floor(per / 2000));
  let max = 0;
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(audio.length, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = start; i < end; i += stride) {
      let s = 0;
      for (const ch of channels) s += ch[i];
      s = Math.abs(s / channels.length);
      if (s > peak) peak = s;
    }
    out[b] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) for (let b = 0; b < n; b++) out[b] /= max;
  return out;
}

/* ------------------------------------------------------------------ helpers */

function clamp01(v: number) {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}
