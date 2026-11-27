/*
 * --- loop-foundation --- The offline loudness normaliser of the exported mix (ITU-R BS.1770-4 / EBU R128), pure and
 * unit-tested (tests/loudness.test.ts). Every reel the loop families are modelled on sits at −14 LUFS integrated – the
 * streaming platforms' target – so the fast export (and through it the batch render, the bot and the Windows app's render
 * queue) measures its rendered mix and applies one static gain that brings it to −14 LUFS without letting the true peak
 * pass −1 dBTP. The live preview keeps the master bus' limiter only (masterBus.ts): a page cannot measure a mix before it
 * plays.
 *
 * --- export-limiter --- A sparse mix – a few hits over a quiet bed, one accent at the finale – has a crest factor the static
 * gain cannot carry: one peak at the ceiling held 14 of 16 first-visit clips under −15 LUFS (Polyrhythm at −24). For such a
 * mix only, normaliseExportMix runs a look-ahead peak limiter on the true-peak envelope before the gain (a 5 ms linear attack
 * that ends on the peak, a 50 ms release, the true peak held 1 dB under the ceiling to leave the encoder room) and searches
 * the gain that lands the limited mix on the target, within two bounds that keep the hits from being flattened: at most
 * 12 dB off any peak, and at most 3 LU off the mix's loudness (what the limiter takes off the loud parts; a mix whose every
 * hit is a peak stops there, quieter than the target but louder than before). A mix the static gain already brings to the
 * target is not touched by it, sample for sample.
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
  return filterInPlace(Float64Array.from(x), filters);
}

/** Runs `out` through the biquads in series (direct form I), in place. */
function filterInPlace(out: Float64Array, filters: readonly Biquad[]): Float64Array {
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
  return loudnessOf(channels, sampleRate);
}

/**
 * integratedLoudness() of `channels` × `gain` × `curve` (one factor per sample, shared by the channels) – the loudness the mix
 * would have once scaled, measured without writing it. Without a curve and at gain 1 it is integratedLoudness() itself.
 */
function loudnessOf(channels: readonly Float32Array[], sampleRate: number, curve?: Float32Array, gain = 1): number {
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
    const y = curve || gain !== 1 ? filterInPlace(scaledCopy(ch, length, gain, curve), filters) : filterSeries(ch.subarray(0, length), filters);
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
  /** The gain applied (dB; 0 for a silent mix) – after the export limiter, the gain on top of its curve. */
  gainDb: number;
  /** The loudness after (LUFS): the target, or less when the true-peak ceiling (or the export limiter's bounds) held it back. */
  outputLufs: number;
  /** --- export-limiter --- The deepest gain reduction the export limiter applied (dB; 0 when it did not run). */
  limitDb?: number;
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
  // --- export-limiter --- the true-peak ceiling holds the static gain short of the target: limit the peaks instead
  if (Number.isFinite(inputLufs) && inputLufs > SILENCE_LUFS && peak > 0 && target - inputLufs - gainDb > LIMITER_TOLERANCE_LU) {
    return limitExportMix(channels, views, sampleRate, n, { inputLufs, inputTruePeakDb, gainDb, outputLufs: inputLufs + gainDb }, target, ceiling);
  }
  if (gainDb !== 0) {
    const g = Math.pow(10, gainDb / 20);
    for (const ch of new Set(channels)) {
      const end = Math.min(n, ch.length);
      for (let i = 0; i < end; i++) ch[i] *= g;
    }
  }
  return { inputLufs, inputTruePeakDb, gainDb, outputLufs: Number.isFinite(inputLufs) ? inputLufs + gainDb : inputLufs };
}

// --- export-limiter ---

/** The limiter's look-ahead (s): its gain falls along a linear ramp this long and is all the way down when the peak plays. */
export const LIMITER_LOOKAHEAD_SEC = 0.005;
/** Its release (s): once the peaks have passed, the reduction (in dB) decays by 1/e in this time. */
export const LIMITER_RELEASE_SEC = 0.05;
/**
 * The deepest reduction (dB) it may apply to a peak. A mix that would need more – one click over a near-silent bed – keeps
 * this much and ends quieter than the target, as it did before the limiter, rather than having its hit flattened.
 */
export const LIMITER_MAX_REDUCTION_DB = 12;
/**
 * The most loudness (LU) the limiter may take off the mix: the gain it adds over the static one minus the loudness that gain
 * gains. A lone accent costs next to nothing; a mix whose loud parts are all peaks – a click track, a lone hit in silence,
 * Paddle's and Fight League's hits – pays for every dB, and stops here.
 */
export const LIMITER_MAX_COST_LU = 3;
/**
 * How far under the ceiling (dB) the limiter holds the true peak. A limited mix has many peaks at its limit, and the export's
 * encoder lifts some of them: Chromium's Opus at 128 kb/s put the String Circle card's verdict 1.4 dB over the mix's true
 * peak (+0.4 dBTP in the file) where a static gain's lone accent rose 0.3 dB at most. With this room the measured clips' files
 * keep −1 dBTP but for bright glass and impacts (Shatter −0.4, Fight League −0.7: under full scale).
 */
export const LIMITER_CODEC_MARGIN_DB = 1;
/** How near the target (or the cost bound, LU) the gain search stops; a static gain this close to the target needs no limiter. */
export const LIMITER_TOLERANCE_LU = 0.05;
/** At most this many gain searches (each a gain curve and a loudness measurement); three or four usually land within tolerance. */
const LIMITER_ROUNDS = 8;

const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** A Float64 copy of `x`'s first `length` samples, each × `gain` × `curve[i]` (no curve: × `gain`). */
function scaledCopy(x: Float32Array, length: number, gain: number, curve?: Float32Array): Float64Array {
  const out = new Float64Array(length);
  if (curve) for (let i = 0; i < length; i++) out[i] = x[i] * gain * curve[i];
  else for (let i = 0; i < length; i++) out[i] = x[i] * gain;
  return out;
}

/**
 * The true-peak envelope of `channels`: per sample, the largest |value| over the channels of the sample itself and of the 4×
 * interpolated points on either side of it (truePeak()'s interpolator), so a limiter that keeps the envelope under a level
 * keeps the true peak there too. A point between two samples both under `floor` is not interpolated (as in truePeak(), only
 * the neighbourhoods of loud samples can hide an inter-sample peak that matters).
 */
export function truePeakEnvelope(channels: readonly Float32Array[], floor = 0): Float32Array {
  const length = channels.length > 0 ? Math.min(...channels.map((c) => c.length)) : 0;
  const env = new Float32Array(length);
  const kernel = truePeakKernel();
  const half = TP_TAPS / 2;
  for (const ch of new Set(channels)) {
    for (let i = 0; i < length; i++) {
      const a = Math.abs(ch[i]);
      if (a > env[i]) env[i] = a;
    }
    for (let i = half - 1; i < length - half; i++) {
      if (Math.abs(ch[i]) < floor && Math.abs(ch[i + 1]) < floor) continue;
      for (const k of kernel) {
        let v = 0;
        for (let j = 0; j < TP_TAPS; j++) v += k[j] * ch[i + j - half + 1];
        const a = Math.abs(v);
        if (a > env[i]) env[i] = a;
        if (a > env[i + 1]) env[i + 1] = a;
      }
    }
  }
  return env;
}

/**
 * The look-ahead limiter's gain curve (0–1 per sample, into `out`) that keeps `envelope` × curve at or under `limit`, and the
 * deepest reduction it applies (dB). Sample i needs min(1, limit / envelope[i]); the curve holds the smallest need of the
 * next look-ahead's samples, releases from it exponentially (in dB) and is then averaged over the look-ahead – a linear
 * ramp into every peak. Every sample of that average is at most the need of sample i (each held value in its window had
 * sample i in its own look-ahead), so the limit holds exactly, with no overshoot. O(length), one pass each.
 */
export function limiterGainCurve(envelope: Float32Array, sampleRate: number, limit: number, out: Float32Array = new Float32Array(envelope.length)): number {
  const n = Math.min(envelope.length, out.length);
  const look = Math.max(1, Math.round(LIMITER_LOOKAHEAD_SEC * sampleRate));
  // Hold: the smallest need over [i, i + look) – a monotonic queue of the samples that need any reduction at all.
  const cap = look + 1;
  const at = new Int32Array(cap);
  const need = new Float64Array(cap);
  let head = 0;
  let size = 0;
  let deepest = 1;
  for (let j = 0; j < n + look - 1; j++) {
    if (j < n && envelope[j] > limit) {
      const v = limit / envelope[j];
      if (v < deepest) deepest = v;
      while (size > 0 && need[(head + size - 1) % cap] >= v) size--;
      const slot = (head + size) % cap;
      at[slot] = j;
      need[slot] = v;
      size++;
    }
    const i = j - look + 1;
    if (i < 0) continue;
    while (size > 0 && at[head] < i) {
      head = (head + 1) % cap;
      size--;
    }
    out[i] = size > 0 ? need[head] : 1;
  }
  // Release: the reduction in dB decays by 1/e every LIMITER_RELEASE_SEC, never faster than the held need allows, and ends
  // at unity once under a thousandth of a dB (the attack's average below smooths that last step).
  const decay = Math.exp(-1 / (Math.max(1e-6, LIMITER_RELEASE_SEC) * sampleRate));
  const unity = (-0.001 * Math.LN10) / 20;
  let logGain = 0;
  for (let i = 0; i < n; i++) {
    const held = out[i];
    logGain = Math.min(held < 1 ? Math.log(held) : 0, logGain * decay);
    if (logGain > unity) logGain = 0;
    out[i] = logGain < 0 ? Math.exp(logGain) : 1;
  }
  // Attack: the mean of the last `look` samples (fewer at the start), so the gain ramps down into each peak.
  const ring = new Float64Array(look);
  let sum = 0;
  let count = 0;
  let reduced = 0;
  for (let i = 0; i < n; i++) {
    const v = out[i];
    const slot = i % look;
    if (count === look) {
      sum -= ring[slot];
      if (ring[slot] < 1) reduced--;
    } else count++;
    ring[slot] = v;
    sum += v;
    if (v < 1) reduced++;
    if (reduced === 0) {
      sum = count; // a window of unity gains: exactly 1, with no rounding carried on
      out[i] = 1;
    } else out[i] = Math.min(1, sum / count);
  }
  return deepest < 1 ? -20 * Math.log10(deepest) : 0;
}

/**
 * normaliseExportMix() for a mix the true-peak ceiling holds short of the target. The gain is the largest at most the static
 * gain plus LIMITER_MAX_REDUCTION_DB whose limited mix is neither louder than the target nor LIMITER_MAX_COST_LU quieter than
 * the gain alone would make it. Both margins fall as the gain rises, at rates set by one slope (the loudness each dB of gain
 * still gains), so each round steps to the nearer bound along the slope measured between the last two rounds, kept inside
 * the bracket the rounds so far have found; three or four rounds land within tolerance. Applied with the limiter's curve once
 * per array. `measured` is what the static path measured.
 */
function limitExportMix(channels: readonly Float32Array[], views: readonly Float32Array[], sampleRate: number, n: number, measured: LoudnessResult, target: number, ceiling: number): LoudnessResult {
  const { inputLufs } = measured;
  const limiterDbtp = ceiling - LIMITER_CODEC_MARGIN_DB;
  const limit = dbToGain(limiterDbtp);
  const highDb = limiterDbtp - measured.inputTruePeakDb + LIMITER_MAX_REDUCTION_DB;
  // No sample under this level can reach the limit at the largest gain tried (truePeak()'s 0.35 rule, scaled).
  const env = truePeakEnvelope(views, (0.35 * limit) / dbToGain(highDb));
  const curve = new Float32Array(env.length);
  // What the limiter took off the mix's loudness at a gain, and the smaller margin (≥ 0: the gain is allowed).
  const costOf = (gainDb: number, lufs: number) => inputLufs + gainDb - lufs;
  const marginOf = (gainDb: number, lufs: number) => Math.min(target - lufs, LIMITER_MAX_COST_LU - costOf(gainDb, lufs));
  const tryGain = (gainDb: number) => {
    const g = dbToGain(gainDb);
    const limitDb = limiterGainCurve(env, sampleRate, limit / g, curve);
    const lufs = loudnessOf(views, sampleRate, curve, g);
    return { gainDb, lufs, limitDb, margin: marginOf(gainDb, lufs) };
  };
  // The static gain is the first round: the limiter does nothing there, and the mix ends short of the target.
  let best = { gainDb: measured.gainDb, lufs: measured.outputLufs, limitDb: 0, margin: marginOf(measured.gainDb, measured.outputLufs) };
  let current = best;
  let prev = best;
  let slope = 1; // dLUFS / dGain: 1 while nothing is limited
  let over = Infinity; // the smallest gain found not allowed
  for (let round = 0; round < LIMITER_ROUNDS; round++) {
    const toTarget = slope > 1e-3 ? (target - prev.lufs) / slope : Infinity;
    const toCost = slope < 1 - 1e-3 ? (LIMITER_MAX_COST_LU - costOf(prev.gainDb, prev.lufs)) / (1 - slope) : Infinity;
    let next = Math.min(highDb, prev.gainDb + Math.min(toTarget, toCost));
    if (!(next > best.gainDb && next < over)) next = (best.gainDb + Math.min(over, highDb)) / 2;
    if (Math.abs(next - prev.gainDb) < 1e-3) break;
    current = tryGain(next);
    if (current.margin >= -LIMITER_TOLERANCE_LU) {
      if (current.gainDb > best.gainDb) best = current;
    } else over = Math.min(over, current.gainDb);
    if (Math.abs(current.margin) <= LIMITER_TOLERANCE_LU || (current.margin > 0 && current.gainDb >= highDb)) break;
    slope = Math.min(1, Math.max(0, (current.lufs - prev.lufs) / (current.gainDb - prev.gainDb)));
    prev = current;
  }
  if (best !== current) {
    if (best.limitDb > 0) limiterGainCurve(env, sampleRate, limit / dbToGain(best.gainDb), curve);
    else curve.fill(1);
  }
  let { gainDb, lufs: outputLufs } = best;
  const g = dbToGain(gainDb);
  for (const ch of new Set(channels)) {
    const end = Math.min(n, ch.length, curve.length);
    for (let i = 0; i < end; i++) ch[i] *= g * curve[i];
  }
  // A safety net for rounding (the curve keeps the envelope under the limit exactly): trim what still passes the ceiling –
  // and the limit, once the limiter ran (the static gain alone keeps the ceiling, as before).
  const peak = truePeak(views);
  const allowed = best.limitDb > 0 ? limit : dbToGain(ceiling);
  if (peak > allowed) {
    const trim = allowed / peak;
    for (const ch of new Set(channels)) {
      const end = Math.min(n, ch.length);
      for (let i = 0; i < end; i++) ch[i] *= trim;
    }
    gainDb += 20 * Math.log10(trim);
    outputLufs += 20 * Math.log10(trim);
  }
  return { inputLufs, inputTruePeakDb: measured.inputTruePeakDb, gainDb, outputLufs, limitDb: best.limitDb };
}
