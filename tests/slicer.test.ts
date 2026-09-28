import { describe, expect, it } from "vitest";
import { MIN_SLICE_SEC, formatSongTime, normalizeSliceOptions, planSlice, positionAt, sliceCount, sliceProgress, songEnded, type SliceOptions } from "@/lib/audio/slicer";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

const opts: SliceOptions = { sliceSec: 0.25, fadeSec: 0.008, loop: true };

/** Plays `n` bounces from cursor 0 and returns the plans (null entries mean "nothing to play"). */
function bounce(songDuration: number, options: SliceOptions, n: number) {
  const plans = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const plan = planSlice(cursor, songDuration, options);
    plans.push(plan);
    if (plan) cursor = plan.cursorAfter;
  }
  return plans;
}

describe("planSlice", () => {
  it("walks through the song one slice per bounce, continuing where the previous slice ended", () => {
    const [a, b, c] = bounce(10, opts, 3);
    expect(a).toEqual({ start: 0, duration: 0.25, fadeIn: 0.008, fadeOut: 0.008, cursorAfter: 0.25, wrapped: false });
    expect(b?.start).toBeCloseTo(0.25);
    expect(b?.cursorAfter).toBeCloseTo(0.5);
    expect(c?.start).toBeCloseTo(0.5);
    expect(c?.duration).toBeCloseTo(0.25);
  });

  it("shortens the last slice to the end of the song and then wraps to the start when looping", () => {
    const plans = bounce(0.6, opts, 4);
    expect(plans[2]?.start).toBeCloseTo(0.5);
    expect(plans[2]?.duration).toBeCloseTo(0.1);
    expect(plans[2]?.cursorAfter).toBeCloseTo(0.6);
    expect(plans[3]).toMatchObject({ start: 0, duration: 0.25, wrapped: true });
  });

  it("plays nothing after the end when looping is off", () => {
    const plans = bounce(0.6, { ...opts, loop: false }, 5);
    expect(plans[2]?.cursorAfter).toBeCloseTo(0.6);
    expect(plans[3]).toBeNull();
    expect(plans[4]).toBeNull();
  });

  it("treats a remainder shorter than MIN_SLICE_SEC as the end of the song", () => {
    const duration = 0.5 + MIN_SLICE_SEC / 2;
    expect(songEnded(0.5, duration)).toBe(true);
    expect(planSlice(0.5, duration, { ...opts, loop: false })).toBeNull();
    expect(planSlice(0.5, duration, opts)).toMatchObject({ start: 0, wrapped: true });
    expect(songEnded(0.5, 0.5 + 2 * MIN_SLICE_SEC)).toBe(false);
  });

  it("keeps the fades inside the slice (each at most half of it)", () => {
    const plan = planSlice(0, 10, { sliceSec: 0.1, fadeSec: 0.08, loop: true });
    expect(plan?.fadeIn).toBeCloseTo(0.05);
    expect(plan?.fadeOut).toBeCloseTo(0.05);
    const tail = planSlice(9.97, 10, { sliceSec: 0.25, fadeSec: 0.02, loop: true });
    expect(tail?.duration).toBeCloseTo(0.03);
    expect(tail?.fadeIn).toBeCloseTo(0.015);
    expect(planSlice(0, 10, { ...opts, fadeSec: 0 })?.fadeIn).toBe(0);
  });

  it("returns null without a song or with a non-positive slice length", () => {
    expect(planSlice(0, 0, opts)).toBeNull();
    expect(planSlice(0, NaN, opts)).toBeNull();
    expect(planSlice(0, 10, { ...opts, sliceSec: 0 })).toBeNull();
    expect(planSlice(0, 10, { ...opts, sliceSec: -1 })).toBeNull();
  });

  it("recovers from a negative or invalid cursor", () => {
    expect(planSlice(-1, 10, opts)?.start).toBe(0);
    expect(planSlice(NaN, 10, opts)?.start).toBe(0);
  });
});

describe("positionAt", () => {
  it("advances with the audio clock while the slice plays and holds at its end", () => {
    expect(positionAt(2, 0.25, 100, 100)).toBe(2);
    expect(positionAt(2, 0.25, 100, 100.1)).toBeCloseTo(2.1);
    expect(positionAt(2, 0.25, 100, 101)).toBeCloseTo(2.25);
    expect(positionAt(2, 0.25, 100, 99)).toBe(2);
  });

  it("lets a slice cut short by the next bounce continue from where it stopped", () => {
    const first = planSlice(0, 10, opts)!;
    const cutAt = positionAt(first.start, first.duration, 50, 50.1);
    const second = planSlice(cutAt, 10, opts)!;
    expect(second.start).toBeCloseTo(0.1);
    expect(second.cursorAfter).toBeCloseTo(0.35);
  });
});

describe("progress helpers", () => {
  it("maps the position to a clamped 0–1 fraction", () => {
    expect(sliceProgress(0, 10)).toBe(0);
    expect(sliceProgress(2.5, 10)).toBeCloseTo(0.25);
    expect(sliceProgress(12, 10)).toBe(1);
    expect(sliceProgress(-1, 10)).toBe(0);
    expect(sliceProgress(1, 0)).toBe(0);
  });

  it("counts the bounces needed to play the song once", () => {
    expect(sliceCount(10, 0.25)).toBe(40);
    expect(sliceCount(10.1, 0.25)).toBe(41);
    expect(sliceCount(0.6, 0.25)).toBe(3);
    expect(sliceCount(0, 0.25)).toBe(0);
    expect(sliceCount(10, 0)).toBe(0);
  });

  it("formats durations as m:ss", () => {
    expect(formatSongTime(0)).toBe("0:00");
    expect(formatSongTime(7.4)).toBe("0:07");
    expect(formatSongTime(92)).toBe("1:32");
    expect(formatSongTime(3600)).toBe("60:00");
    expect(formatSongTime(NaN)).toBe("0:00");
  });
});

describe("normalizeSliceOptions", () => {
  it("clamps out-of-range values and falls back to the base for invalid ones", () => {
    const base = opts;
    expect(normalizeSliceOptions({ sliceSec: 0, fadeSec: 5 }, base)).toEqual({ sliceSec: 0.01, fadeSec: 1, loop: true });
    expect(normalizeSliceOptions({ sliceSec: NaN, loop: false }, base)).toEqual({ sliceSec: 0.25, fadeSec: 0.008, loop: false });
    expect(normalizeSliceOptions({}, base)).toEqual(base);
  });
});

describe("song slicer settings", () => {
  it("has sensible defaults and slider ranges", () => {
    const d = defaultSettings();
    expect(d.sliceSong).toBe(false);
    expect(d.sliceMs).toBe(250);
    expect(d.sliceLoop).toBe(true);
    expect(d.sliceFadeMs).toBeGreaterThan(0);
    expect(RANGES.sliceMs).toEqual({ min: 80, max: 1000, step: 10 });
    expect(d.sliceMs).toBeGreaterThanOrEqual(RANGES.sliceMs.min);
    expect(d.sliceFadeMs).toBeLessThanOrEqual(RANGES.sliceFadeMs.max);
  });

  it("round-trips through the URL with short keys", () => {
    const s = { ...defaultSettings("classic"), sliceSong: true, sliceMs: 120, sliceLoop: false, sliceFadeMs: 20 };
    const params = settingsToSearchParams(s);
    expect(params.get("slice")).toBe("1");
    expect(params.get("slms")).toBe("120");
    expect(params.get("sloop")).toBe("0");
    expect(params.get("slfade")).toBe("20");
    expect(settingsFromSearchParams(params)).toEqual(s);
    expect(settingsToSearchParams(defaultSettings("classic")).has("slice")).toBe(false);
  });

  it("survives presets saved before the slicer existed", () => {
    const s = presetToSettings({ mode: "classic", gravity: 100 });
    expect(s.sliceSong).toBe(false);
    expect(s.sliceMs).toBe(250);
  });
});
