import { describe, expect, it } from "vitest";
import { DECAY_FLOOR, INSTRUMENT_IDS, PLUCK_DURATION, RELEASE_SEC, isInstrumentId, playVoice, renderPluck, type InstrumentId } from "@/lib/audio/instruments";

const SAMPLE_RATE = 44100;

function energy(samples: Float32Array, from: number, to: number) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return sum / (to - from);
}

/**
 * The pitch of a rendered note in Hz: the peak of the Hann-windowed DFT magnitude over 50–250 ms, searched in 1-cent steps
 * within ±80 cents of `expected` (Goertzel per step) and refined by a parabola through the best step and its neighbours.
 */
function measuredPitch(samples: Float32Array, sampleRate: number, expected: number): number {
  const from = Math.round(sampleRate * 0.05);
  const to = Math.round(sampleRate * 0.25);
  const n = to - from;
  const windowed = new Float64Array(n);
  for (let i = 0; i < n; i++) windowed[i] = samples[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const power = (f: number) => {
    const coeff = 2 * Math.cos((2 * Math.PI * f) / sampleRate);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const s0 = windowed[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
  };
  const at = (cents: number) => expected * Math.pow(2, cents / 1200);
  let best = -80;
  let bestPower = -Infinity;
  const powers = new Map<number, number>();
  for (let cents = -80; cents <= 80; cents++) {
    const p = power(at(cents));
    powers.set(cents, p);
    if (p > bestPower) {
      bestPower = p;
      best = cents;
    }
  }
  const a = Math.log(powers.get(best - 1) ?? bestPower);
  const b = Math.log(bestPower);
  const c = Math.log(powers.get(best + 1) ?? bestPower);
  const offset = a - 2 * b + c < 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return at(best + offset);
}

const cents = (f: number, reference: number) => 1200 * Math.log2(f / reference);

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

  // --- review fix (audio) --- the loop is tuned to the fractional period, so the string plays in tune (it rounded the period
  // and averaged forward: up to ~48 cents sharp at 2 kHz, which undid the scale snapping for this voice).
  it("plays in tune: within 3 cents of the requested pitch at 44.1 and 48 kHz", () => {
    const off: string[] = [];
    for (const sampleRate of [44100, 48000]) {
      for (const frequency of [220, 440, 800, 1046.5, 1568, 2093]) {
        const error = cents(measuredPitch(renderPluck(sampleRate, frequency), sampleRate, frequency), frequency);
        if (!(Math.abs(error) < 3)) off.push(`${frequency} Hz @ ${sampleRate}: ${error.toFixed(2)} ct`);
      }
    }
    expect(off).toEqual([]);
  });

  it("stays within ±1 at every pitch", () => {
    for (const sampleRate of [44100, 48000]) {
      for (const frequency of [20, 30, 55, 70, 110, 220, 440, 800, 1046.5, 1568, 2093, 4186, 10000]) {
        let peak = 0;
        for (const v of renderPluck(sampleRate, frequency)) peak = Math.max(peak, Math.abs(v));
        expect(peak, `${frequency} Hz @ ${sampleRate}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("repeats with the period of the requested pitch", () => {
    for (const frequency of [220, 440, 800]) {
      const s = renderPluck(SAMPLE_RATE, frequency);
      const period = Math.round(SAMPLE_RATE / frequency); // the nearest whole-sample lag to the (fractional) period
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

// --- review fix (audio) ---
describe("voice envelopes", () => {
  /** Plays one note on a stand-in context and returns the gain envelope's automation ([method, value, time]) and the stop time. */
  function envelopeOf(instrument: InstrumentId, gain: number, time = 1, duration = 0.15) {
    const calls: [string, number, number][] = [];
    let stopAt = NaN;
    const param = () => ({ value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined });
    const ctx = {
      createOscillator: () => ({ type: "sine", frequency: param(), connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: (t: number) => void (stopAt = t), onended: null }),
      createGain: () => ({
        gain: {
          value: 1,
          setValueAtTime: (v: number, t: number) => void calls.push(["set", v, t]),
          exponentialRampToValueAtTime: (v: number, t: number) => void calls.push(["exp", v, t]),
          linearRampToValueAtTime: (v: number, t: number) => void calls.push(["linear", v, t]),
        },
        connect: () => undefined,
        disconnect: () => undefined,
      }),
    };
    playVoice(ctx as unknown as BaseAudioContext, {} as AudioNode, instrument, { frequency: 400, time, duration, gain });
    return { calls, stopAt };
  }

  it("keeps the classic bounce decay (0.25 → 0.01 over the note) and fades it to silence before the oscillator stops", () => {
    const { calls, stopAt } = envelopeOf("triangle", 0.25);
    expect(calls).toEqual([
      ["set", 0.25, 1],
      ["exp", 0.01, 1.15],
      ["linear", 0, 1.15 + RELEASE_SEC],
    ]);
    expect(stopAt).toBeCloseTo(1.15 + RELEASE_SEC, 12);
  });

  it("decays every level by the same ratio – a soft note decays too instead of stopping at full level or growing", () => {
    for (const instrument of ["triangle", "square", "saw", "chip"] as const) {
      for (const gain of [0.25, 0.0175, 0.001]) {
        const { calls } = envelopeOf(instrument, gain);
        const [set, exp, release] = calls;
        expect(set[0]).toBe("set");
        expect(exp[0]).toBe("exp");
        expect(exp[1] / set[1]).toBeCloseTo(DECAY_FLOOR, 9);
        expect(exp[1]).toBeLessThan(set[1]);
        expect(release).toEqual(["linear", 0, 1.15 + RELEASE_SEC]);
      }
    }
  });
});
