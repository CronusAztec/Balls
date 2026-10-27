import type { SoundEvent } from "@/lib/physics/types";
import { DARK_LUMA, MAX_MOTION_SAMPLES, MOTION_MIN, firstSoundSecOf, lumaDifference, lumaOf, meanSaturation } from "@/lib/videoAnalysis/features";

/*
 * --- insights --- The measured features of a fast export (ClipFeatures v1): what the clip looks and sounds like, as numbers,
 * measured while `renderFast()` (fastRender.ts) makes it, for the clip's genes (lib/insights/genes.ts) and, later, for a
 * comparison with reference videos measured by the agent toolbox's `analyse` (lib/videoAnalysis/features.ts).
 *
 * Nothing is drawn or read back for it. The collector reads:
 *  - the 16 × 16 thumbnail the export's digest already hashes, every DIGEST_EVERY-th exported frame (after the digest has
 *    read it, and never writing it: the digest stays byte for byte what it was). So `sampleHz` is the export's frame rate over
 *    DIGEST_EVERY: 4 Hz at 60 fps, 2 Hz at 30;
 *  - the engine's sound events, as the frame loop hands them to the offline mix;
 *  - the finished mix, as the file holds it (after the loudness normaliser), and the loudness the normaliser measured.
 *
 * The picture numbers follow lib/videoAnalysis/features.ts to the letter (the same functions on the same RGB, luma by
 * Rec. 601 on 0–1), so an own clip and a reference video measure alike:
 *  - motion[i]: the mean absolute luma difference between sample i and sample i − 1 (motion[0] = 0), the first
 *    MAX_MOTION_SAMPLES (600) samples; firstMotionSec: the first sample whose motion reaches MOTION_MIN; peakMotionPos: where
 *    the largest motion sits (0–1 of the samples) – both over every sample of the clip;
 *  - meanLuma, meanSat (HSV saturation), darkShare (pixels darker than DARK_LUMA) over every sample;
 *  - loopSeamDiff: the mean absolute luma difference between the first and the last sample (the last is at most
 *    DIGEST_EVERY − 1 frames before the clip's end: no frame is read for it); null with fewer than two samples.
 * The sound numbers: soundEventsPerSec and gapEvents count the engine's sound events in the clip ("gap": a wall broke, a gap
 * was passed); firstSoundSec is the analyser's rule on the export's own mix (the first 10 ms above SOUND_MIN_DB, so a music
 * bed or a chirp counts as it is heard); lufs is the mix's loudness before the normaliser (`FastRenderResult.loudnessLufs`).
 *
 * Pure and bounded: no Math.random, Date.now or clock of any kind (the export's own sandbox could not move a number), at most
 * 600 motion values and two thumbnails held whatever the clip's length. And it can never fail an export: every call catches
 * its own error, after which the collector measures nothing more and `finish()` gives null (the export simply has no features).
 */

// --- insights ---

export const CLIP_FEATURES_VERSION = 1;
/**
 * How close to the clip's end (s) a frame's time may come and still be past it: far below a frame (1/240 s at 240 fps), far
 * above the rounding of the export's clocks. The loop cut's stop frame lies exactly at the end, but its time (simFrameTimeMs()
 * / 1000) and the clip's length (exportDurationSec()) are two roundings of one number: at sim frame 13 the first is one ulp
 * below the second.
 */
export const CLIP_END_SLACK_SEC = 1e-6;

export interface ClipFeatures {
  v: typeof CLIP_FEATURES_VERSION;
  /** Samples a second: the export's frame rate over DIGEST_EVERY. */
  sampleHz: number;
  motion: number[];
  firstMotionSec: number | null;
  peakMotionPos: number | null;
  meanLuma: number | null;
  meanSat: number | null;
  darkShare: number | null;
  soundEventsPerSec: number | null;
  firstSoundSec: number | null;
  gapEvents: number;
  loopSeamDiff: number | null;
  lufs: number | null;
}

/** What the export knows once its mix is made: the clip's length, the normaliser's measurement and the mix the file holds. */
export interface ClipFeaturesEnd {
  durationSec: number;
  /** The mix's integrated loudness before the normaliser (LUFS; −Infinity for a silent mix: null). */
  lufs: number | null | undefined;
  /** The mix as encoded: its channels, rate and the samples the clip keeps. Absent: no first sound. */
  mix?: { channels: readonly ArrayLike<number>[]; sampleRate: number; frames: number };
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** The RGB of an RGBA picture (canvas pixels), as the analyser's rgb24 frames are. */
function rgbOf(rgba: ArrayLike<number>): Uint8Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[3 * i] = rgba[4 * i];
    out[3 * i + 1] = rgba[4 * i + 1];
    out[3 * i + 2] = rgba[4 * i + 2];
  }
  return out;
}

/** Collects one fast export's features (see the header). Feed `frame()` the digest's pixels and `sound()` the frame's events. */
export class ClipFeaturesCollector {
  private broken = false;
  private samples = 0;
  private readonly motion: number[] = [];
  private first: Float32Array | null = null;
  private previous: Float32Array | null = null;
  private lumaSum = 0;
  private satSum = 0;
  private dark = 0;
  private pixels = 0;
  private firstMotion = -1;
  private peak = -1;
  private peakMotion = 0;
  // the sound events: those of the latest time apart, since the export's very last frame may lie past the clip's end
  private events = 0;
  private gaps = 0;
  private pendingSec = -Infinity;
  private pendingEvents = 0;
  private pendingGaps = 0;

  /** `sampleHz`: the export's frame rate over DIGEST_EVERY (the rate `frame()` is called at). */
  constructor(readonly sampleHz: number) {}

  /** True once a call failed: the collector measures nothing more and `finish()` gives null. */
  get failed(): boolean {
    return this.broken;
  }

  /** One digest sample: the thumbnail's RGBA pixels (read, never written). */
  frame(rgba: ArrayLike<number>): void {
    if (this.broken) return;
    try {
      const rgb = rgbOf(rgba);
      const luma = lumaOf(rgb);
      for (let p = 0; p < luma.length; p++) {
        this.lumaSum += luma[p];
        if (luma[p] < DARK_LUMA) this.dark++;
      }
      this.pixels += luma.length;
      this.satSum += meanSaturation(rgb);
      const i = this.samples;
      const m = i === 0 || !this.previous ? 0 : r4(lumaDifference(luma, this.previous));
      if (this.motion.length < MAX_MOTION_SAMPLES) this.motion.push(m);
      if (i > 0) {
        if (this.firstMotion < 0 && m >= MOTION_MIN) this.firstMotion = i;
        if (m > 0 && (this.peak < 0 || m > this.peakMotion)) {
          this.peak = i;
          this.peakMotion = m;
        }
      }
      if (i === 0) this.first = luma;
      this.previous = luma;
      this.samples = i + 1;
    } catch {
      this.broken = true;
    }
  }

  /** One engine sound event of the frame at `timeSec` of the clip (in time order, as the frame loop passes them on). */
  sound(timeSec: number, ev: Pick<SoundEvent, "type">): void {
    if (this.broken) return;
    try {
      if (!Number.isFinite(timeSec)) return;
      if (timeSec > this.pendingSec) {
        this.events += this.pendingEvents;
        this.gaps += this.pendingGaps;
        this.pendingSec = timeSec;
        this.pendingEvents = 0;
        this.pendingGaps = 0;
      }
      this.pendingEvents++;
      if (ev.type === "gap") this.pendingGaps++;
    } catch {
      this.broken = true;
    }
  }

  /** The clip's features, or null when a call failed (or this one does). */
  finish(end: ClipFeaturesEnd): ClipFeatures | null {
    if (this.broken) return null;
    try {
      const durationSec = end.durationSec;
      const timed = Number.isFinite(durationSec) && durationSec > 0;
      // the latest time's events count when that frame is inside the clip (a frame at its very end is not: CLIP_END_SLACK_SEC)
      const inClip = timed && this.pendingSec < durationSec - CLIP_END_SLACK_SEC;
      const events = this.events + (inClip ? this.pendingEvents : 0);
      const gaps = this.gaps + (inClip ? this.pendingGaps : 0);
      const n = this.samples;
      const lufs = typeof end.lufs === "number" && Number.isFinite(end.lufs) ? Math.round(end.lufs * 10) / 10 : null;
      const mix = end.mix;
      return {
        v: CLIP_FEATURES_VERSION,
        sampleHz: this.sampleHz,
        motion: this.motion.slice(),
        firstMotionSec: this.firstMotion < 0 ? null : r4(this.firstMotion / this.sampleHz),
        peakMotionPos: this.peak < 0 ? null : r4(n > 1 ? this.peak / (n - 1) : 0),
        meanLuma: n === 0 ? null : r4(this.lumaSum / Math.max(1, this.pixels)),
        meanSat: n === 0 ? null : r4(this.satSum / n),
        darkShare: n === 0 ? null : r4(this.dark / Math.max(1, this.pixels)),
        soundEventsPerSec: timed ? r4(events / durationSec) : null,
        firstSoundSec: mix ? firstSoundSecOf(mix.channels, mix.sampleRate, mix.frames) : null,
        gapEvents: gaps,
        loopSeamDiff: n >= 2 && this.first && this.previous ? r4(lumaDifference(this.first, this.previous)) : null,
        lufs,
      };
    } catch {
      this.broken = true;
      return null;
    }
  }
}

// --- end insights ---
