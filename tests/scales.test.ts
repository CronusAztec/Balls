import { describe, expect, it } from "vitest";
import {
  BPM_MAX,
  BPM_MIN,
  NOTE_NAMES,
  QUANTIZE_GRIDS,
  SCALE_IDS,
  SCALE_INTERVALS,
  frequencyToMidi,
  gridStepSeconds,
  isQuantizeGrid,
  isScaleId,
  midiToFrequency,
  nextGridTime,
  normalizeRootNote,
  quantizeFrequency,
  quantizeMidi,
} from "@/lib/audio/scales";

describe("pitch helpers", () => {
  it("converts between MIDI notes and frequencies (A4 = 440 Hz)", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 2);
    expect(frequencyToMidi(880)).toBeCloseTo(81, 6);
    expect(frequencyToMidi(midiToFrequency(73.4))).toBeCloseTo(73.4, 6);
  });

  it("names 12 pitch classes and lists every scale", () => {
    expect(NOTE_NAMES).toHaveLength(12);
    expect(SCALE_IDS).toEqual(["chromatic", "major", "minor", "pentatonic", "blues", "wholeTone"]);
    for (const id of SCALE_IDS) {
      const intervals = SCALE_INTERVALS[id];
      expect(intervals[0]).toBe(0);
      expect(intervals.every((n, i) => n >= 0 && n < 12 && (i === 0 || n > intervals[i - 1]))).toBe(true);
    }
    expect(isScaleId("blues")).toBe(true);
    expect(isScaleId("dorian")).toBe(false);
  });

  it("normalises root notes into 0–11", () => {
    expect(normalizeRootNote(9)).toBe(9);
    expect(normalizeRootNote(12)).toBe(0);
    expect(normalizeRootNote(-1)).toBe(11);
    expect(normalizeRootNote(2.6)).toBe(3);
    expect(normalizeRootNote("nope")).toBe(0);
  });
});

describe("quantizeMidi", () => {
  it("leaves chromatic pitches untouched (free pitch keeps the default tones as they are)", () => {
    expect(quantizeMidi(69.37, "chromatic")).toBe(69.37);
    expect(quantizeFrequency(800, "chromatic")).toBe(800);
    expect(quantizeFrequency(800, "chromatic", 7)).toBe(800);
  });

  it("returns notes that belong to the scale and moves to the nearest one", () => {
    // C major: C# (61) sits between C and D; 61.4 is closer to D (62)
    expect(quantizeMidi(61.4, "major", 0)).toBe(62);
    expect(quantizeMidi(60.6, "major", 0)).toBe(60);
    // Exact tie goes to the lower note
    expect(quantizeMidi(61, "major", 0)).toBe(60);
    // Notes already in the scale stay
    for (const n of [60, 62, 64, 65, 67, 69, 71, 72]) expect(quantizeMidi(n, "major", 0)).toBe(n);
    // Pentatonic on C has no F: 65 → E (64) on the tie, 65.6 → G (67)
    expect(quantizeMidi(65, "pentatonic", 0)).toBe(64);
    expect(quantizeMidi(65.6, "pentatonic", 0)).toBe(67);
  });

  it("respects the root note", () => {
    // A minor (root 9) contains G (67) but not G# (68); E major (root 4) contains G# but not G
    expect(quantizeMidi(67.9, "minor", 9)).toBe(67);
    expect(quantizeMidi(68, "major", 4)).toBe(68);
    expect(quantizeMidi(67, "major", 4)).toBe(66);
    // The root itself is always a scale degree, in any octave
    for (const root of [0, 3, 7, 11]) {
      for (const octave of [36, 48, 60, 84]) expect(quantizeMidi(octave + root + 0.4, "wholeTone", root)).toBe(octave + root);
    }
  });

  it("only ever returns scale degrees, for every scale and root", () => {
    for (const scale of SCALE_IDS) {
      if (scale === "chromatic") continue;
      for (let root = 0; root < 12; root++) {
        for (let midi = 40; midi < 100; midi += 0.37) {
          const q = quantizeMidi(midi, scale, root);
          expect(Number.isInteger(q)).toBe(true);
          expect(SCALE_INTERVALS[scale]).toContain((((q - root) % 12) + 12) % 12);
          expect(Math.abs(q - midi)).toBeLessThanOrEqual(3); // no scale has a gap wider than a minor third
        }
      }
    }
  });
});

describe("quantizeFrequency", () => {
  it("snaps the classic wall tones into the key", () => {
    // 800 Hz ≈ G5 + 35 cents → G5 (783.99 Hz) in C major; blues on C has no G#/A, so 880 Hz (A5) → A#5 or G5
    expect(quantizeFrequency(800, "major", 0)).toBeCloseTo(783.99, 1);
    expect(quantizeFrequency(440, "major", 0)).toBeCloseTo(440, 6);
    const blues = quantizeFrequency(880, "blues", 0);
    expect([783.99, 932.33].some((f) => Math.abs(f - blues) < 0.05)).toBe(true);
  });

  it("ignores invalid input", () => {
    expect(quantizeFrequency(0, "major")).toBe(0);
    expect(quantizeFrequency(-5, "minor")).toBe(-5);
  });
});

describe("beat grid", () => {
  it("derives the step length from BPM and grid", () => {
    expect(gridStepSeconds(120, "1/4")).toBeCloseTo(0.5, 9);
    expect(gridStepSeconds(120, "1/8")).toBeCloseTo(0.25, 9);
    expect(gridStepSeconds(120, "1/16")).toBeCloseTo(0.125, 9);
    expect(gridStepSeconds(60, "1/4")).toBeCloseTo(1, 9);
    // --- review fix (uncap-all) --- a tempo past the slider's BPM_MAX runs as typed (it stopped there before); below
    // BPM_MIN – and a non-finite one – the grid stays at BPM_MIN
    expect(gridStepSeconds(BPM_MAX + 500, "1/4")).toBeCloseTo(60 / (BPM_MAX + 500), 9);
    expect(gridStepSeconds(6000, "1/16")).toBeCloseTo(60 / 6000 / 4, 12);
    expect(gridStepSeconds(0, "1/4")).toBeCloseTo(60 / BPM_MIN, 9);
    expect(gridStepSeconds(Number.NaN, "1/4")).toBeCloseTo(60 / BPM_MIN, 9);
    expect(QUANTIZE_GRIDS).toEqual(["1/4", "1/8", "1/16"]);
    expect(isQuantizeGrid("1/8")).toBe(true);
    expect(isQuantizeGrid("1/32")).toBe(false);
  });

  it("returns the next grid point, never more than one step away", () => {
    expect(nextGridTime(0, 120, "1/4")).toBeCloseTo(0, 9);
    expect(nextGridTime(0.1, 120, "1/4")).toBeCloseTo(0.5, 9);
    expect(nextGridTime(0.5, 120, "1/4")).toBeCloseTo(0.5, 9);
    expect(nextGridTime(0.51, 120, "1/8")).toBeCloseTo(0.75, 9);
    expect(nextGridTime(3.01, 120, "1/16")).toBeCloseTo(3.125, 9);
    for (let now = 0; now < 10; now += 0.0731) {
      const t = nextGridTime(now, 97, "1/8");
      expect(t).toBeGreaterThanOrEqual(now - 0.001);
      expect(t - now).toBeLessThan(gridStepSeconds(97, "1/8"));
    }
  });

  it("anchors the grid at an origin and tolerates floating-point noise", () => {
    expect(nextGridTime(10.3, 120, "1/4", 10.1)).toBeCloseTo(10.6, 9);
    expect(nextGridTime(10.1, 120, "1/4", 10.1)).toBeCloseTo(10.1, 9);
    // A point 0.3 ms in the past still counts as "now" instead of a full-step delay
    expect(nextGridTime(0.5003, 120, "1/4")).toBeCloseTo(0.5, 9);
    expect(nextGridTime(0.502, 120, "1/4")).toBeCloseTo(1, 9);
  });
});
