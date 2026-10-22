import { analyzeBeats } from "@/lib/audio/beats";
import type { MediaInfo, Silence } from "./ffmpegParse";

/*
 * --- agent-cli --- (video analysis) VideoFeatures: the numbers kept of a video file – pace, motion, colour, cuts, loudness,
 * tempo, the loop seam – and nothing expressive (no frame, no sound, no caption is kept). Pure: the runner (the agent CLI's
 * scripts/agent/analyse.mjs today, the app's reference shelf later) hands in what ffmpeg printed (ffmpegArgs.ts,
 * ffmpegParse.ts) and gets the same JSON for the same file on any machine.
 *
 * The picture numbers are measured on 16 × 16 RGB samples taken `sampleHz` times a second (2 by default: the rate an own clip's
 * features are compared at), luma by Rec. 601 on 0–1:
 *  - motion[i]: the mean absolute luma difference between sample i and sample i − 1 (motion[0] = 0), at most MAX_MOTION_SAMPLES;
 *  - firstMotionSec: the first sample whose motion reaches MOTION_MIN; peakMotionPos: where the largest motion sits (0–1);
 *  - meanLuma, meanSat (HSV saturation), darkShare (pixels darker than DARK_LUMA) over every sample;
 *  - loopSeamDiff: the mean absolute luma difference between the first and the last frame (0: a seamless loop).
 * Sound: the tempo, its confidence and the onsets come from the app's own beat detector (lib/audio/beats.ts) on mono PCM;
 * firstSoundSec is the first 10 ms above SOUND_MIN_DB; LUFS is ffmpeg's ebur128 (BS.1770, as the export's normaliser).
 */

export const FEATURES_VERSION = 1;
export const MAX_MOTION_SAMPLES = 600;
/** Motion at or above this (mean absolute luma difference, 0–1) counts as the picture moving. */
export const MOTION_MIN = 0.02;
/** A pixel darker than this luma (0–1) counts as dark. */
export const DARK_LUMA = 0.12;
/** The first sound: a 10 ms window louder than this (dBFS, RMS). */
export const SOUND_MIN_DB = -45;

export interface VideoFeatures {
  v: typeof FEATURES_VERSION;
  durationSec: number | null;
  /** Seconds of the file measured (the window read: at most the analyser's maxSec). */
  analysedSec: number;
  fps: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  sampleHz: number;
  motion: number[];
  firstMotionSec: number | null;
  peakMotionPos: number | null;
  meanLuma: number | null;
  meanSat: number | null;
  darkShare: number | null;
  loopSeamDiff: number | null;
  cuts: number[];
  cutsPerMin: number | null;
  lufs: number | null;
  bpm: number | null;
  bpmConfidence: number | null;
  onsetsPerSec: number | null;
  firstSoundSec: number | null;
  silenceSec: number | null;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** The luma (0–1, Rec. 601) of every pixel of an rgb24 picture. */
export function lumaOf(rgb: Uint8Array): Float32Array {
  const n = Math.floor(rgb.length / 3);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (0.299 * rgb[3 * i] + 0.587 * rgb[3 * i + 1] + 0.114 * rgb[3 * i + 2]) / 255;
  return out;
}

/** The mean HSV saturation (0–1) of an rgb24 picture. */
export function meanSaturation(rgb: Uint8Array): number {
  const n = Math.floor(rgb.length / 3);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[3 * i];
    const g = rgb[3 * i + 1];
    const b = rgb[3 * i + 2];
    const max = Math.max(r, g, b);
    if (max > 0) sum += (max - Math.min(r, g, b)) / max;
  }
  return sum / n;
}

/** The mean absolute difference of two luma pictures of the same size (0–1). */
export function lumaDifference(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

export interface PictureFeatures {
  motion: number[];
  firstMotionSec: number | null;
  peakMotionPos: number | null;
  meanLuma: number | null;
  meanSat: number | null;
  darkShare: number | null;
}

/** The picture numbers of rgb24 samples taken `sampleHz` times a second (see the header). */
export function pictureFeatures(frames: readonly Uint8Array[], sampleHz: number): PictureFeatures {
  if (frames.length === 0) return { motion: [], firstMotionSec: null, peakMotionPos: null, meanLuma: null, meanSat: null, darkShare: null };
  const lumas = frames.map(lumaOf);
  const motion: number[] = [];
  let lumaSum = 0;
  let satSum = 0;
  let dark = 0;
  let pixels = 0;
  for (let i = 0; i < frames.length; i++) {
    const l = lumas[i];
    for (let p = 0; p < l.length; p++) {
      lumaSum += l[p];
      if (l[p] < DARK_LUMA) dark++;
    }
    pixels += l.length;
    satSum += meanSaturation(frames[i]);
    if (motion.length < MAX_MOTION_SAMPLES) motion.push(i === 0 ? 0 : r4(lumaDifference(l, lumas[i - 1])));
  }
  const first = motion.findIndex((m, i) => i > 0 && m >= MOTION_MIN);
  let peak = -1;
  for (let i = 1; i < motion.length; i++) if (motion[i] > 0 && (peak < 0 || motion[i] > motion[peak])) peak = i;
  return {
    motion,
    firstMotionSec: first < 0 ? null : r4(first / sampleHz),
    peakMotionPos: peak < 0 ? null : r4(motion.length > 1 ? peak / (motion.length - 1) : 0),
    meanLuma: r4(lumaSum / Math.max(1, pixels)),
    meanSat: r4(satSum / frames.length),
    darkShare: r4(dark / Math.max(1, pixels)),
  };
}

/** How far the last frame is from the first (mean absolute luma difference, 0–1), null without both. */
export function loopSeamDiff(first: Uint8Array | undefined, last: Uint8Array | undefined): number | null {
  if (!first || !last || first.length === 0 || first.length !== last.length) return null;
  return r4(lumaDifference(lumaOf(first), lumaOf(last)));
}

export interface SoundFeatures {
  bpm: number | null;
  bpmConfidence: number | null;
  onsetsPerSec: number | null;
  firstSoundSec: number | null;
}

/** Tempo, onsets and the first sound of mono PCM (the app's beat detector; 0 bpm – no usable beat – is null). */
export function soundFeatures(samples: Float32Array, sampleRate: number): SoundFeatures {
  const seconds = samples.length / sampleRate;
  if (samples.length === 0 || seconds < 0.5) return { bpm: null, bpmConfidence: null, onsetsPerSec: null, firstSoundSec: null };
  const window = Math.max(1, Math.round(sampleRate / 100));
  const floor = Math.pow(10, SOUND_MIN_DB / 20);
  let firstSoundSec: number | null = null;
  for (let at = 0; at + window <= samples.length; at += window) {
    let sq = 0;
    for (let i = at; i < at + window; i++) sq += samples[i] * samples[i];
    if (Math.sqrt(sq / window) > floor) {
      firstSoundSec = r4(at / sampleRate);
      break;
    }
  }
  const beats = analyzeBeats({ numberOfChannels: 1, length: samples.length, sampleRate, getChannelData: () => samples });
  return {
    bpm: beats.bpm > 0 ? Math.round(beats.bpm * 10) / 10 : null,
    bpmConfidence: beats.bpm > 0 ? r4(beats.confidence) : null,
    onsetsPerSec: r4(beats.onsets.length / seconds),
    firstSoundSec,
  };
}

export interface FeatureParts {
  info: MediaInfo;
  sampleHz: number;
  maxSec: number;
  frames: readonly Uint8Array[];
  lastFrame?: Uint8Array;
  cuts: readonly number[];
  lufs: number | null;
  silences: readonly Silence[];
  sound: SoundFeatures | null;
}

/** The whole VideoFeatures record of one file from its measured parts. */
export function buildVideoFeatures(p: FeatureParts): VideoFeatures {
  const picture = pictureFeatures(p.frames, p.sampleHz);
  const duration = p.info.durationSec;
  const analysedSec = r4(duration === null ? p.frames.length / p.sampleHz : Math.min(duration, p.maxSec));
  const cuts = p.cuts.filter((t) => t <= analysedSec).map(r4);
  const audio = p.info.hasAudio;
  return {
    v: FEATURES_VERSION,
    durationSec: duration === null ? null : r4(duration),
    analysedSec,
    fps: p.info.fps,
    width: p.info.width,
    height: p.info.height,
    hasAudio: audio,
    sampleHz: p.sampleHz,
    ...picture,
    loopSeamDiff: loopSeamDiff(p.frames[0], p.lastFrame),
    cuts,
    cutsPerMin: analysedSec > 0 ? r4((cuts.length * 60) / analysedSec) : null,
    lufs: audio && p.lufs !== null ? Math.round(p.lufs * 10) / 10 : null,
    bpm: audio ? (p.sound?.bpm ?? null) : null,
    bpmConfidence: audio ? (p.sound?.bpmConfidence ?? null) : null,
    onsetsPerSec: audio ? (p.sound?.onsetsPerSec ?? null) : null,
    firstSoundSec: audio ? (p.sound?.firstSoundSec ?? null) : null,
    silenceSec: audio ? r4(p.silences.reduce((s, x) => s + Math.max(0, Math.min(x.end, analysedSec) - x.start), 0)) : null,
  };
}
