import { describe, expect, it } from "vitest";
import { BEAT_PULSE_DECAY, BeatClock, DEFAULT_BEAT_CLOCK, beatIndexBefore, isUsableGrid, pulseValue, type BeatGrid } from "@/lib/simulation/beatClock";

/** A 120 BPM grid whose first beat sits 0.4 s into a 10 s song. */
function grid(bpm = 120, first = 0.4, duration = 10): BeatGrid {
  const period = 60 / bpm;
  const beatTimes: number[] = [];
  for (let t = first; t < duration; t += period) beatTimes.push(t);
  return { bpm, beatTimes, duration };
}

describe("pulse and lookup helpers", () => {
  it("pulseValue is 1 on the beat, decays exponentially in beat units and is 0 without a period", () => {
    expect(pulseValue(0, 0.5, BEAT_PULSE_DECAY)).toBe(1);
    expect(pulseValue(0.25, 0.5, 3)).toBeCloseTo(Math.exp(-1.5));
    expect(pulseValue(0.5, 0.5, 3)).toBeCloseTo(Math.exp(-3));
    expect(pulseValue(0.1, 0, 3)).toBe(0);
    expect(pulseValue(-0.1, 0.5, 3)).toBe(0);
    expect(pulseValue(Infinity, 0.5, 3)).toBe(0);
  });

  it("beatIndexBefore finds the last beat at or before a time", () => {
    const beats = [0.4, 0.9, 1.4, 1.9];
    expect(beatIndexBefore(beats, 0.1)).toBe(-1);
    expect(beatIndexBefore(beats, 0.4)).toBe(0);
    expect(beatIndexBefore(beats, 1.0)).toBe(1);
    expect(beatIndexBefore(beats, 1.9)).toBe(3);
    expect(beatIndexBefore(beats, 50)).toBe(3);
    expect(beatIndexBefore([], 1)).toBe(-1);
  });

  it("isUsableGrid needs a tempo, two beats and a song length", () => {
    expect(isUsableGrid(null)).toBe(false);
    expect(isUsableGrid({ bpm: 0, beatTimes: [0, 1], duration: 10 })).toBe(false);
    expect(isUsableGrid({ bpm: 120, beatTimes: [0], duration: 10 })).toBe(false);
    expect(isUsableGrid({ bpm: 120, beatTimes: [0, 0.5], duration: 0 })).toBe(false);
    expect(isUsableGrid(grid())).toBe(true);
  });
});

describe("BeatClock with the manual BPM", () => {
  it("beats every 60 / BPM seconds from simulation time 0", () => {
    const clock = new BeatClock();
    clock.setConfig({ source: "bpm", manualBpm: 120 });
    expect(clock.isActive()).toBe(true);
    expect(clock.getBpm()).toBe(120);
    const start = clock.sample(0);
    expect(start).toMatchObject({ active: true, bpm: 120, period: 0.5, index: 0, sinceBeat: 0, pulse: 1 });
    const mid = clock.sample(0.25);
    expect(mid.index).toBe(0);
    expect(mid.pulse).toBeCloseTo(Math.exp(-1.5));
    const next = clock.sample(0.5);
    expect(next.index).toBe(1);
    expect(next.pulse).toBeCloseTo(1);
    expect(clock.sample(10.1).index).toBe(20);
    expect(clock.pulse(0.49)).toBeLessThan(0.06);
  });

  it("decays monotonically between beats and is deterministic", () => {
    const clock = new BeatClock();
    clock.setConfig({ source: "bpm", manualBpm: 100 });
    let prev = 2;
    for (let t = 0; t < 0.6; t += 0.01) {
      const p = clock.pulse(t);
      expect(p).toBeLessThan(prev);
      prev = p;
    }
    expect(clock.pulse(1.234)).toBe(clock.pulse(1.234));
  });

  it("is inactive without a positive BPM", () => {
    const clock = new BeatClock();
    clock.setConfig({ source: "bpm", manualBpm: 0 });
    expect(clock.isActive()).toBe(false);
    expect(clock.sample(1).pulse).toBe(0);
    expect(clock.getBpm()).toBe(0);
  });
});

describe("BeatClock with a song grid", () => {
  it("is inactive in song mode until a usable grid arrives", () => {
    const clock = new BeatClock();
    expect(clock.getConfig()).toEqual(DEFAULT_BEAT_CLOCK);
    expect(clock.isActive()).toBe(false);
    expect(clock.sample(3).active).toBe(false);
    clock.setConfig({ grid: grid() });
    expect(clock.isActive()).toBe(true);
    expect(clock.getBpm()).toBe(120);
  });

  it("maps simulation time to song time through the start offset", () => {
    const clock = new BeatClock();
    clock.setConfig({ grid: grid(), offset: 0.4, loop: false });
    // Simulation time 0 is song time 0.4: exactly the first beat.
    expect(clock.sample(0)).toMatchObject({ active: true, index: 0, sinceBeat: 0, pulse: 1, songTime: 0.4 });
    const later = clock.sample(1.3); // song time 1.7: beat 2 (1.4) was 0.3 s ago
    expect(later.index).toBe(2);
    expect(later.sinceBeat).toBeCloseTo(0.3);
    expect(later.pulse).toBeCloseTo(Math.exp(-3 * 0.3 / 0.5));
  });

  it("has no pulse before the very first beat", () => {
    const clock = new BeatClock();
    clock.setConfig({ grid: grid(), offset: 0, loop: true });
    const before = clock.sample(0.2);
    expect(before.active).toBe(true);
    expect(before.index).toBe(-1);
    expect(before.pulse).toBe(0);
    expect(clock.sample(0.4).pulse).toBe(1);
  });

  it("wraps with a looping song and counts beats on across passes", () => {
    const g = grid(); // beats 0.4 … 9.9 in a 10 s song (20 beats)
    const clock = new BeatClock();
    clock.setConfig({ grid: g, offset: 0, loop: true });
    const secondPass = clock.sample(10.4); // song time 0.4 of the second pass
    expect(secondPass.songTime).toBeCloseTo(0.4);
    expect(secondPass.index).toBe(g.beatTimes.length);
    expect(secondPass.pulse).toBeCloseTo(1);
    // Just after the wrap the last beat of the previous pass (9.9) is still ringing.
    const justWrapped = clock.sample(10.1);
    expect(justWrapped.index).toBe(g.beatTimes.length - 1);
    expect(justWrapped.sinceBeat).toBeCloseTo(0.2);
    expect(justWrapped.pulse).toBeCloseTo(Math.exp(-3 * 0.2 / 0.5));
  });

  it("stops producing beats after a non-looping song ends", () => {
    const g = grid();
    const clock = new BeatClock();
    clock.setConfig({ grid: g, offset: 0, loop: false });
    const after = clock.sample(15);
    expect(after.index).toBe(g.beatTimes.length - 1);
    expect(after.sinceBeat).toBeCloseTo(15 - 9.9);
    expect(after.pulse).toBeLessThan(1e-6);
  });

  it("follows the tempo of the grid rather than the manual BPM", () => {
    const clock = new BeatClock();
    clock.setConfig({ grid: grid(90, 0, 10), manualBpm: 160 });
    expect(clock.getBpm()).toBe(90);
    expect(clock.sample(60 / 90).index).toBe(1);
    clock.setConfig({ source: "bpm" });
    expect(clock.getBpm()).toBe(160);
  });
});
