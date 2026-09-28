import { describe, expect, it } from "vitest";
import { INSTRUMENT_IDS, PLUCK_DURATION, isInstrumentId, renderPluck } from "@/lib/audio/instruments";

const SAMPLE_RATE = 44100;

function energy(samples: Float32Array, from: number, to: number) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return sum / (to - from);
}

describe("instrument ids", () => {
  it("lists the seven voices and validates ids", () => {
    expect(INSTRUMENT_IDS).toEqual(["sine", "triangle", "square", "saw", "pluck", "marimba", "chip"]);
    expect(isInstrumentId("marimba")).toBe(true);
    expect(isInstrumentId("organ")).toBe(false);
    expect(isInstrumentId(3)).toBe(false);
  });
});

describe("renderPluck (Karplus–Strong)", () => {
  it("renders the requested length within ±1 range and is deterministic", () => {
    const a = renderPluck(SAMPLE_RATE, 440);
    const b = renderPluck(SAMPLE_RATE, 440);
    expect(a.length).toBe(Math.round(SAMPLE_RATE * PLUCK_DURATION));
    expect(a).toEqual(b);
    expect(renderPluck(SAMPLE_RATE, 440, 0.1).length).toBe(Math.round(SAMPLE_RATE * 0.1));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeGreaterThanOrEqual(-1);
      expect(a[i]).toBeLessThanOrEqual(1);
    }
  });

  it("starts loud, decays and ends silent (no click)", () => {
    const s = renderPluck(SAMPLE_RATE, 330);
    const tenth = Math.floor(s.length / 10);
    const head = energy(s, 0, tenth);
    const middle = energy(s, 4 * tenth, 5 * tenth);
    const tail = energy(s, s.length - tenth, s.length);
    expect(head).toBeGreaterThan(0.05);
    expect(middle).toBeLessThan(head);
    expect(tail).toBeLessThan(middle);
    expect(Math.abs(s[s.length - 1])).toBeLessThan(1e-6);
  });

  it("repeats with the period of the requested pitch", () => {
    for (const frequency of [220, 440, 800]) {
      const s = renderPluck(SAMPLE_RATE, frequency);
      const period = Math.round(SAMPLE_RATE / frequency);
      const start = Math.round(SAMPLE_RATE * 0.05);
      const window = period * 8;
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = start; i < start + window; i++) {
        dot += s[i] * s[i + period];
        normA += s[i] * s[i];
        normB += s[i + period] * s[i + period];
      }
      const correlation = dot / Math.sqrt(normA * normB);
      expect(correlation).toBeGreaterThan(0.9);
    }
  });

  it("rings shorter for higher notes, like a real string", () => {
    const low = renderPluck(SAMPLE_RATE, 200);
    const high = renderPluck(SAMPLE_RATE, 1600);
    const from = Math.round(SAMPLE_RATE * 0.2);
    const to = Math.round(SAMPLE_RATE * 0.25);
    expect(energy(high, from, to)).toBeLessThan(energy(low, from, to));
  });

  it("clamps absurd pitches instead of throwing", () => {
    expect(() => renderPluck(SAMPLE_RATE, 0)).not.toThrow();
    expect(() => renderPluck(SAMPLE_RATE, 1e9)).not.toThrow();
    expect(renderPluck(SAMPLE_RATE, 1e9).length).toBeGreaterThan(0);
  });
});
