/*
 * --- loop-foundation --- The offline loudness normaliser of the exported mix (ITU-R BS.1770-4 / EBU R128), pure and
 * unit-tested (tests/loudness.test.ts). Every reel the loop families are modelled on sits at −14 LUFS integrated – the
 * streaming platforms' target – so the fast export (and through it the batch render and the bot) measures its rendered mix
 * and applies one static gain that brings it to −14 LUFS without letting the true peak pass −1 dBTP (a mix whose crest
 * factor would push it past that ends a little quieter instead – no limiter, no pumping). The live preview keeps the master
 * bus' limiter only (masterBus.ts): a page cannot measure a mix before it plays.
 *
 * Measurement: K-weighting (the shelving pre-filter and the RLB high-pass, coefficients for any sample rate – they equal the
 * standard's 48 kHz table there), mean squares over 400 ms blocks every 100 ms, an absolute gate at −70 LUFS and a relative gate
 * 10 LU under the absolutely-gated mean; channels weighted 1 (mono and stereo). True peak: 4× oversampling with a windowed-sinc
 * interpolator (BS.1770-4 Annex 2's method).
 */

/** The streaming target (LUFS) and the true-peak ceiling (dBTP). */
export const LOUDNESS_TARGET_LUFS = -14;
export const TRUE_PEAK_CEILING_DBTP = -1;
/** Below this integrated loudness (a silent mix) nothing is changed. */
export const SILENCE_LUFS = -70;

/** A biquad's coefficients (a0 normalised to 1). */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The K-weighting filters at `sampleRate`: the high-shelf pre-filter (stage 1) and the RLB high-pass (stage 2). */
export function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: high shelf (libebur128's analog prototype through the bilinear transform; 48 kHz gives the BS.1770 table).
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2: the RLB high-pass.
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

/** Runs `x` through the biquads in series (direct form I), into a new array. */
export function filterSeries(x: Float32Array, filters: readonly Biquad[]): Float64Array {
  const out = Float64Array.from(x);
  for (const f of filters) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const xi = out[i];
      const y = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
  }
  return out;
}

/** −0.691 + 10·log10(mean square): the loudness of a K-weighted block's summed channel power. */
function blockLoudness(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

/**
 * Integrated loudness (LUFS) of `channels` at `sampleRate` (BS.1770-4): −Infinity for a mix shorter than one 400 ms block or
 * with every block under the −70 LUFS absolute gate.
 */
export function integratedLoudness(channels: readonly Float32Array[], sampleRate: number): number {
  if (channels.length === 0 || !(sampleRate > 0)) return -Infinity;
  const length = Math.min(...channels.map((c) => c.length));
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  if (length < block) return -Infinity;
  const filters = kWeightingFilters(sampleRate);
  // Running sums of squared K-weighted samples per channel, in 100 ms hops; a block is 4 hops.
  const hops = Math.floor(length / hop);
  const hopPower = new Float64Array(hops);
  for (const ch of channels) {
    const y = filterSeries(ch.subarray(0, length), filters);
    for (let h = 0; h < hops; h++) {
      let sum = 0;
      const start = h * hop;
      for (let i = start; i < start + hop; i++) sum += y[i] * y[i];
      hopPower[h] += sum; // channel weight 1 (L, R, mono)
    }
  }
  const per = block / hop;
  const powers: number[] = [];
  for (let h = 0; h + per <= hops; h++) {
    let sum = 0;
    for (let k = 0; k < per; k++) sum += hopPower[h + k];
    powers.push(sum / block);
  }
  const gated = powers.filter((p) => blockLoudness(p) > SILENCE_LUFS);
  if (gated.length === 0) return -Infinity;
  const absMean = gated.reduce((a, b) => a + b, 0) / gated.length;
  const relGate = blockLoudness(absMean) - 10;
  const relative = gated.filter((p) => blockLoudness(p) > relGate);
  if (relative.length === 0) return -Infinity;
  return blockLoudness(relative.reduce((a, b) => a + b, 0) / relative.length);
}

/** Taps of the 4× true-peak interpolator per phase. */
const TP_TAPS = 12;
let tpKernel: Float64Array[] | null = null;

/** The polyphase windowed-sinc kernel of the 4× interpolator (phases 1–3; phase 0 is the sample itself). */
function truePeakKernel(): Float64Array[] {
  if (tpKernel) return tpKernel;
  const phases: Float64Array[] = [];
  for (let p = 1; p < 4; p++) {
    const k = new Float64Array(TP_TAPS);
    const frac = p / 4;
    let sum = 0;
    for (let j = 0; j < TP_TAPS; j++) {
      const n = j - TP_TAPS / 2 + 1; // taps around the interpolated point
      const x = n - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 * (1 + Math.cos((Math.PI * x) / (TP_TAPS / 2 + 1))); // Hann window
      k[j] = sinc * w;
      sum += k[j];
    }
    for (let j = 0; j < TP_TAPS; j++) k[j] /= sum;
    phases.push(k);
  }
  tpKernel = phases;
  return phases;
}

/** The true peak (linear) of `channels`: the largest |sample| of the 4× oversampled signal. */
export function truePeak(channels: readonly Float32Array[]): number {
  const kernel = truePeakKernel();
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    // Only the neighbourhoods of loud samples can hide an inter-sample peak above the running maximum: skip the quiet ones.
    const threshold = 0.35 * peak;
    for (let i = TP_TAPS / 2 - 1; i < ch.length - TP_TAPS / 2; i++) {
      if (Math.abs(ch[i]) < threshold && Math.abs(ch[i + 1]) < threshold) continue;
      for (const k of kernel) {
        let v = 0;
        for (let j = 0; j < TP_TAPS; j++) v += k[j] * ch[i + j - TP_TAPS / 2 + 1];
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
    }
  }
  return peak;
}

export interface LoudnessResult {
  /** The mix's integrated loudness before (LUFS; −Infinity when silent). */
  inputLufs: number;
  /** Its true peak before (dBTP). */
  inputTruePeakDb: number;
  /** The gain applied (dB; 0 for a silent mix). */
  gainDb: number;
  /** The loudness after (LUFS): the target, or less when the true-peak ceiling held the gain back. */
  outputLufs: number;
}

/** The gain (dB) that takes a mix of `lufs` / `truePeakDb` to `target` without its true peak passing `ceiling`. */
export function normalisationGainDb(lufs: number, truePeakDb: number, target = LOUDNESS_TARGET_LUFS, ceiling = TRUE_PEAK_CEILING_DBTP): number {
  if (!Number.isFinite(lufs) || lufs <= SILENCE_LUFS) return 0;
  const toTarget = target - lufs;
  const headroom = Number.isFinite(truePeakDb) ? ceiling - truePeakDb : toTarget;
  return Math.min(toTarget, headroom);
}

/**
 * Normalises `channels` in place to `target` LUFS with the true peak at most `ceiling` dBTP (one static gain), and says what
 * it measured and did. A silent mix is left alone.
 */
export function normaliseLoudness(channels: Float32Array[], sampleRate: number, target = LOUDNESS_TARGET_LUFS, ceiling = TRUE_PEAK_CEILING_DBTP): LoudnessResult {
  const inputLufs = integratedLoudness(channels, sampleRate);
  const peak = truePeak(channels);
  const inputTruePeakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const gainDb = normalisationGainDb(inputLufs, inputTruePeakDb, target, ceiling);
  if (gainDb !== 0) {
    const g = Math.pow(10, gainDb / 20);
    for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }
  return { inputLufs, inputTruePeakDb, gainDb, outputLufs: Number.isFinite(inputLufs) ? inputLufs + gainDb : inputLufs };
}

/**
 * --- loop-foundation --- `normaliseLoudness()` for an export's channels, the first `length` samples (the part the clip
 * keeps): measured as they play – two channels that share one array (a mono mix sent to both sides) count twice, as two
 * speakers do – and the gain applied once per array.
 */
export function normaliseExportMix(channels: readonly Float32Array[], sampleRate: number, length: number, target = LOUDNESS_TARGET_LUFS, ceiling = TRUE_PEAK_CEILING_DBTP): LoudnessResult {
  const n = Math.max(0, Math.floor(length));
  const views = channels.map((ch) => ch.subarray(0, Math.min(n, ch.length)));
  const inputLufs = integratedLoudness(views, sampleRate);
  const peak = truePeak(views);
  const inputTruePeakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const gainDb = normalisationGainDb(inputLufs, inputTruePeakDb, target, ceiling);
  if (gainDb !== 0) {
    const g = Math.pow(10, gainDb / 20);
    for (const ch of new Set(channels)) {
      const end = Math.min(n, ch.length);
      for (let i = 0; i < end; i++) ch[i] *= g;
    }
  }
  return { inputLufs, inputTruePeakDb, gainDb, outputLufs: Number.isFinite(inputLufs) ? inputLufs + gainDb : inputLufs };
}
