import { describe, expect, it } from "vitest";
import { LOUDNESS_TARGET_LUFS, TRUE_PEAK_CEILING_DBTP, integratedLoudness, kWeightingFilters, normalisationGainDb, normaliseLoudness, truePeak } from "@/lib/audio/loudness";

/*
 * --- loop-foundation --- The offline loudness normaliser of the exported mix (lib/audio/loudness.ts): BS.1770 K-weighting and
 * gating, a 4× true peak, and the −14 LUFS / −1 dBTP normalisation the fast export applies.
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
