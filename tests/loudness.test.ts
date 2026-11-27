import { describe, expect, it } from "vitest";
import { LIMITER_CODEC_MARGIN_DB, LIMITER_LOOKAHEAD_SEC, LIMITER_MAX_COST_LU, LIMITER_MAX_REDUCTION_DB, LIMITER_MIN_BENEFIT_LU, LIMITER_RELEASE_SEC, LIMITER_TOLERANCE_LU, LOUDNESS_TARGET_LUFS, TRUE_PEAK_CEILING_DBTP, filterSeries, integratedLoudness, kWeightingFilters, limiterGainCurve, normalisationGainDb, normaliseExportMix, normaliseLoudness, truePeak, truePeakEnvelope } from "@/lib/audio/loudness";

/*
 * --- loop-foundation --- The offline loudness normaliser of the exported mix (lib/audio/loudness.ts): BS.1770 K-weighting and
 * gating, a 4× true peak, and the −14 LUFS / −1 dBTP normalisation the fast export applies.
 * --- export-limiter --- and the look-ahead limiter normaliseExportMix runs when the true-peak ceiling holds that gain short.
 */

const RATE = 48000;

function sine(freq: number, amp: number, seconds: number, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

describe("loudness (BS.1770)", () => {
  it("has the standard's K-weighting coefficients at 48 kHz", () => {
    const [shelf, hp] = kWeightingFilters(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 9);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 9);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 9);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 9);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 9);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 9);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 9);
  });

  it("reads the standard's calibration: a full-scale 997 Hz sine in one channel is −3.01 LUFS", () => {
    expect(integratedLoudness([sine(997, 1, 4)], RATE)).toBeCloseTo(-3.01, 1);
    // 3 dB less in level is 3 dB less loud; the same signal in both channels adds their powers (+3.01 dB)
    const x = sine(997, Math.pow(10, -3.01 / 20), 4);
    expect(integratedLoudness([x], RATE)).toBeCloseTo(-6.02, 1);
    expect(integratedLoudness([x, x], RATE)).toBeCloseTo(-3.01, 1);
  });

  it("gates silence and quiet passages out", () => {
    expect(integratedLoudness([new Float32Array(RATE * 2)], RATE)).toBe(-Infinity);
    expect(integratedLoudness([new Float32Array(100)], RATE)).toBe(-Infinity);
    const loud = sine(1000, 0.5, 2);
    const withSilence = new Float32Array(loud.length * 2);
    withSilence.set(loud, 0);
    // silence is below the absolute gate: the loudness is the loud part's
    expect(integratedLoudness([withSilence], RATE)).toBeCloseTo(integratedLoudness([loud], RATE), 0);
  });

  it("finds the inter-sample peak of a sine sampled off its crest", () => {
    // fs/4 with a 45° phase: every sample sits at 0.707 of the crest, the true peak is the crest
    const n = 4800;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.8 * Math.sin((Math.PI / 2) * i + Math.PI / 4);
    let sample = 0;
    for (const v of x) sample = Math.max(sample, Math.abs(v));
    expect(sample).toBeCloseTo(0.8 * Math.SQRT1_2, 3);
    expect(truePeak([x])).toBeGreaterThan(0.77);
  });

  it("normalises to −14 LUFS, and holds the true peak at −1 dBTP when the mix is too peaky", () => {
    const quiet = sine(440, 0.05, 3);
    const r = normaliseLoudness([quiet], RATE);
    expect(r.outputLufs).toBeCloseTo(LOUDNESS_TARGET_LUFS, 1);
    expect(integratedLoudness([quiet], RATE)).toBeCloseTo(LOUDNESS_TARGET_LUFS, 1);
    // a sparse click track: the loudness target would push the peaks past −1 dBTP, so the gain stops there
    const clicks = new Float32Array(RATE * 3);
    for (let k = 0; k < 6; k++) for (let i = 0; i < 48; i++) clicks[k * 24000 + i] = 0.2 * Math.sin((2 * Math.PI * 2000 * i) / RATE) * Math.exp(-i / 10);
    const c = normaliseLoudness([clicks], RATE);
    expect(20 * Math.log10(truePeak([clicks]))).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 0.05);
    expect(c.outputLufs).toBeLessThan(LOUDNESS_TARGET_LUFS);
    // silence is left alone
    const silent = new Float32Array(RATE);
    expect(normaliseLoudness([silent], RATE).gainDb).toBe(0);
    expect(normalisationGainDb(-30, -20)).toBe(16);
    expect(normalisationGainDb(-30, -10)).toBe(9);
    expect(normalisationGainDb(-Infinity, -10)).toBe(0);
  });
});

// --- export-limiter ---

const db = (x: number) => 20 * Math.log10(x);
/** Where the limiter holds a limited mix's true peak: under the ceiling by the encoder's margin. */
const LIMITED_DBTP = TRUE_PEAK_CEILING_DBTP - LIMITER_CODEC_MARGIN_DB;

/** A quiet 220 Hz bed with short 880 Hz accents (150 ms, decaying) at `accents` seconds: a sparse mix with a high crest factor. */
function bedWithAccents(bedAmp: number, accentAmp: number, accents: readonly number[], seconds = 6): Float32Array {
  const out = sine(220, bedAmp, seconds);
  for (const at of accents) {
    const start = Math.round(at * RATE);
    for (let i = 0; i < Math.round(0.15 * RATE) && start + i < out.length; i++) out[start + i] += accentAmp * Math.sin((2 * Math.PI * 880 * i) / RATE) * Math.exp(-i / (0.04 * RATE));
  }
  return out;
}

/** The existing test's click track: six 1 ms clicks in 3 s of silence – every bit of its loudness is a peak. */
function clickTrack(): Float32Array {
  const clicks = new Float32Array(RATE * 3);
  for (let k = 0; k < 6; k++) for (let i = 0; i < 48; i++) clicks[k * 24000 + i] = 0.2 * Math.sin((2 * Math.PI * 2000 * i) / RATE) * Math.exp(-i / 10);
  return clicks;
}

/**
 * `freq` Hz hits (amplitude 0.5, decaying with a `decay` s time constant) every `every` s over a 220 Hz bed of `bedAmp`
 * (0: in silence), 6 s long – a pluck at 10 ms, a click at 2 ms.
 */
function hitsOverBed(bedAmp: number, every: number, decay: number, freq = 880): Float32Array {
  const out = sine(220, bedAmp, 6);
  for (let at = every / 2; at < 6; at += every) {
    const start = Math.round(at * RATE);
    for (let i = 0; i < Math.round(0.3 * RATE) && start + i < out.length; i++) out[start + i] += 0.5 * Math.sin((2 * Math.PI * freq * i) / RATE) * Math.exp(-i / (decay * RATE));
  }
  return out;
}

/** How many samples of `a` and `b` differ (their lengths too). */
function mismatches(a: Float32Array, b: Float32Array): number {
  let n = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
}

/** normaliseExportMix() on two copies of `make()` (a stereo export), with what the result holds. */
function exportOf(make: () => Float32Array) {
  const channels = [make(), make()];
  const r = normaliseExportMix(channels, RATE, channels[0].length);
  let sampleMax = 0;
  for (const ch of channels) for (const v of ch) sampleMax = Math.max(sampleMax, Math.abs(v));
  // the cost: what the limiter took off the loudness, its makeup gain minus the level change (gainDb, once it ran)
  return { r, channels, measured: integratedLoudness(channels, RATE), truePeakDb: db(truePeak(channels)), sampleMax, cost: r.inputLufs + (r.makeupGainDb ?? r.gainDb) - r.outputLufs };
}

/** What normaliseLoudness() – the one static gain – makes of two copies of `make()`: its samples, result and loudness. */
function staticOf(make: () => Float32Array) {
  const channels = [make(), make()];
  const r = normaliseLoudness(channels, RATE);
  return { r, channels, measured: integratedLoudness(channels, RATE) };
}

describe("export limiter (normaliseExportMix)", () => {
  it("lifts a sparse mix – one accent over a quiet bed – to the target, its true peak under the ceiling by the codec margin", () => {
    for (const bed of [0.1, 0.07]) {
      const e = exportOf(() => bedWithAccents(bed, 0.9, [3]));
      // the static gain alone would end it more than 5 LU short: the accent's peak holds it back
      expect(e.r.inputLufs + Math.min(LOUDNESS_TARGET_LUFS - e.r.inputLufs, TRUE_PEAK_CEILING_DBTP - e.r.inputTruePeakDb)).toBeLessThan(LOUDNESS_TARGET_LUFS - 5);
      expect(Math.abs(e.r.outputLufs - LOUDNESS_TARGET_LUFS)).toBeLessThanOrEqual(1);
      expect(Math.abs(e.measured - LOUDNESS_TARGET_LUFS)).toBeLessThanOrEqual(1);
      expect(Math.abs(e.measured - e.r.outputLufs)).toBeLessThan(0.1);
      expect(e.truePeakDb).toBeLessThanOrEqual(LIMITED_DBTP + 0.01);
      expect(e.sampleMax).toBeLessThan(1);
      expect(e.r.limitDb).toBeGreaterThan(5);
      expect(e.r.limitDb).toBeLessThanOrEqual(LIMITER_MAX_REDUCTION_DB);
      // the result names the level change – what the done line says – with the makeup gain on top of the curve beside it
      expect(e.r.gainDb).toBeCloseTo(e.r.outputLufs - e.r.inputLufs, 9);
      expect(Math.abs(e.r.gainDb - (e.measured - e.r.inputLufs))).toBeLessThan(0.1);
      expect(e.r.makeupGainDb).toBeGreaterThan(e.r.gainDb);
    }
  });

  it("leaves a mix the static gain lands alone, sample for sample, and brings dense hits within 0.5 LU", () => {
    // a steady tone, and a bed with accents that never meet the ceiling: exactly the static normaliser's samples
    for (const make of [() => sine(1000, 0.25, 4), () => bedWithAccents(0.3, 0.5, [1, 2, 3, 4, 5])]) {
      const e = exportOf(make);
      const reference = make();
      normaliseLoudness([reference, make()], RATE);
      expect(e.r.limitDb ?? 0).toBe(0);
      expect(mismatches(e.channels[0], reference)).toBe(0);
      expect(Math.abs(e.r.outputLufs - LOUDNESS_TARGET_LUFS)).toBeLessThanOrEqual(0.5);
      expect(e.r.makeupGainDb).toBeUndefined();
    }
    // an accent every half second: the ceiling held it 0.7 LU short, the limiter lands it
    const dense = exportOf(() => bedWithAccents(0.1, 0.9, [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.25, 4.75, 5.25, 5.75]));
    expect(Math.abs(dense.measured - LOUDNESS_TARGET_LUFS)).toBeLessThanOrEqual(0.5);
    expect(dense.truePeakDb).toBeLessThanOrEqual(LIMITED_DBTP + 0.01);
    expect(dense.cost).toBeLessThanOrEqual(LIMITER_MAX_COST_LU + LIMITER_TOLERANCE_LU);
  });

  it("keeps its bounds: at most LIMITER_MAX_REDUCTION_DB off a peak and LIMITER_MAX_COST_LU off the loudness", () => {
    // a lone click over a bed that needs 16 dB: the depth bound stops it, short of the target
    const deep = exportOf(() => {
      const x = sine(220, 0.03, 6);
      for (let i = 0; i < 96; i++) x[3 * RATE + i] += 0.95 * Math.sin((2 * Math.PI * 2000 * i) / RATE) * Math.exp(-i / 20);
      return x;
    });
    expect(deep.r.limitDb).toBeLessThanOrEqual(LIMITER_MAX_REDUCTION_DB + 1e-4);
    expect(deep.r.limitDb).toBeGreaterThan(LIMITER_MAX_REDUCTION_DB - 0.1);
    expect(deep.r.outputLufs).toBeLessThan(LOUDNESS_TARGET_LUFS - 3);
    expect(deep.truePeakDb).toBeLessThanOrEqual(LIMITED_DBTP + 0.01);
    // clicks over a faint bed: past the bed's share every dB of reduction costs a dB of loudness, so the cost bound stops it,
    // short of the target and of the depth bound, yet louder than the static gain makes it; its clicks keep their shape
    const clicksOverBed = () => hitsOverBed(0.02, 0.5, 0.002);
    const clicks = exportOf(clicksOverBed);
    expect(clicks.cost).toBeLessThanOrEqual(LIMITER_MAX_COST_LU + LIMITER_TOLERANCE_LU);
    expect(clicks.cost).toBeGreaterThan(LIMITER_MAX_COST_LU - 0.1);
    expect(clicks.r.limitDb).toBeLessThan(LIMITER_MAX_REDUCTION_DB - 3);
    expect(clicks.r.outputLufs).toBeLessThan(LOUDNESS_TARGET_LUFS);
    expect(clicks.measured).toBeGreaterThanOrEqual(staticOf(clicksOverBed).measured + LIMITER_MIN_BENEFIT_LU);
    expect(clicks.truePeakDb).toBeLessThanOrEqual(LIMITED_DBTP + 0.01);
    expect(clicks.sampleMax).toBeLessThan(1);
    // silence is left alone
    const silent = [new Float32Array(RATE), new Float32Array(RATE)];
    expect(normaliseExportMix(silent, RATE, RATE).gainDb).toBe(0);
    expect(silent[0].every((v) => v === 0)).toBe(true);
  });

  it("keeps the static gain where limiting would not pay: a mix of nothing but hits ends as loud as before, its hits untouched", () => {
    // the click track, a plucked hit every 1.2 s in silence and a click every half second in silence: the ceiling holds each
    // more than LIMITER_MIN_BENEFIT_LU short, but every dB of limiting costs a dB, and the codec margin alone about 1 LU
    for (const make of [clickTrack, () => hitsOverBed(0, 1.2, 0.01), () => hitsOverBed(0, 0.5, 0.002, 2000)]) {
      const e = exportOf(make);
      const fixed = staticOf(make);
      expect(fixed.r.outputLufs).toBeLessThan(LOUDNESS_TARGET_LUFS - LIMITER_MIN_BENEFIT_LU);
      expect(e.r.limitDb ?? 0).toBe(0);
      expect(e.r.makeupGainDb).toBeUndefined();
      expect(e.measured).toBeGreaterThanOrEqual(fixed.measured - 0.01);
      expect(e.r.gainDb).toBeCloseTo(fixed.r.gainDb, 9);
      expect(mismatches(e.channels[0], fixed.channels[0])).toBe(0);
      expect(mismatches(e.channels[1], fixed.channels[1])).toBe(0);
      expect(e.truePeakDb).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 0.05);
    }
  });

  it("applies its curve once to a channel both sides share (a mono mix), as two copies would get it", () => {
    const make = () => bedWithAccents(0.08, 0.9, [2, 4]);
    const shared = make();
    const a = normaliseExportMix([shared, shared], RATE, shared.length);
    const pair = [make(), make()];
    const b = normaliseExportMix(pair, RATE, pair[0].length);
    expect(a.gainDb).toBeCloseTo(b.gainDb, 9);
    expect(mismatches(shared, pair[0])).toBe(0);
  });

  it("builds a gain curve that keeps the envelope under the limit, ramps into the peak and releases after it", () => {
    const look = Math.round(LIMITER_LOOKAHEAD_SEC * RATE);
    const env = new Float32Array(RATE);
    env[RATE / 2] = 2; // one peak at twice the limit: it needs half the gain
    const curve = new Float32Array(env.length);
    expect(limiterGainCurve(env, RATE, 1, curve)).toBeCloseTo(6.0206, 3);
    const p = RATE / 2;
    expect(curve[p]).toBeCloseTo(0.5, 6);
    expect(curve[p - look]).toBe(1); // nothing before the look-ahead
    expect(curve[p - look / 2]).toBeCloseTo(0.75, 2); // a linear ramp that ends on the peak
    // one release time after the peak, the reduction (dB) has decayed by about 1/e
    const after = -db(curve[p + Math.round(LIMITER_RELEASE_SEC * RATE)]);
    expect(after).toBeGreaterThan(6.0206 / Math.E - 0.5);
    expect(after).toBeLessThan(6.0206 / Math.E + 0.5);
    expect(curve[curve.length - 1]).toBe(1);
    // a busy envelope (a fixed pseudo-random sequence): every sample stays under the limit, every gain in (0, 1]
    let state = 12345;
    const busy = new Float32Array(RATE);
    for (let i = 0; i < busy.length; i++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      busy[i] = (state / 2147483648) * (i % 4800 < 200 ? 4 : 0.9);
    }
    const busyCurve = new Float32Array(busy.length);
    limiterGainCurve(busy, RATE, 1, busyCurve);
    let loudest = 0;
    let lowest = 1;
    let highest = 0;
    for (let i = 0; i < busy.length; i++) {
      loudest = Math.max(loudest, busy[i] * busyCurve[i]);
      lowest = Math.min(lowest, busyCurve[i]);
      highest = Math.max(highest, busyCurve[i]);
    }
    expect(loudest).toBeLessThanOrEqual(1 + 1e-6);
    expect(lowest).toBeGreaterThan(0);
    expect(highest).toBeLessThanOrEqual(1);
  });

  it("flushes a K-weighted tail decaying through silence to zero, so a quiet mix measures fast and the same", () => {
    // one pluck, then 20 s of silence: the filters' ringing would sink toward the subnormal range, 10–20× slower to compute
    const pluck = (silence: number) => {
      const x = new Float32Array(Math.round((0.5 + silence) * RATE));
      for (let i = 0; i < 0.3 * RATE; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 880 * i) / RATE) * Math.exp(-i / (0.01 * RATE));
      return x;
    };
    const y = filterSeries(pluck(20), kWeightingFilters(RATE));
    let tiny = 0;
    for (const v of y) if (v !== 0 && Math.abs(v) < 1e-150) tiny++;
    expect(tiny).toBe(0);
    expect(y[y.length - 1]).toBe(0);
    // the silence after it is gated out either way: the same loudness after 1 s of it and after 20 s
    expect(integratedLoudness([pluck(20)], RATE)).toBeCloseTo(integratedLoudness([pluck(1)], RATE), 9);
  });

  it("measures each sample's true-peak envelope: never under the sample, and its largest value is the true peak", () => {
    const n = 4800;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.8 * Math.sin((Math.PI / 2) * i + Math.PI / 4);
    const env = truePeakEnvelope([x, x]);
    let top = 0;
    let under = 0;
    for (let i = 0; i < n; i++) {
      if (env[i] < Math.abs(x[i])) under++;
      top = Math.max(top, env[i]);
    }
    expect(under).toBe(0);
    expect(top).toBeCloseTo(truePeak([x]), 6);
    expect(top).toBeGreaterThan(0.77);
  });
});
