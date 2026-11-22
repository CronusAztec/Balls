import { describe, expect, it } from "vitest";
import { LINES_KEYS, LINES_KEY_BASE_MIDI, LINES_MAX_BOUNCE_POINTS, linesKey, linesKeyFrequency, resolveLinesStrings } from "@/lib/physics/modes/lines";
import { midiToFrequency } from "@/lib/audio/scales";
import type { SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings, runNeverFinishes } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { drawLinesArt, stringBucket, STRING_HUE_CYCLE } from "@/components/simulator/linesRenderer";
import { ringVoiceEvent } from "@/lib/audio/loopEvents";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- string-art --- Lines as string art (lib/physics/modes/lines.ts, components/simulator/linesRenderer.ts): the ring as a circular
 * keyboard (a bounce plays the pentatonic note of the key under it), Strings to Finish (the run ends after N strings with the
 * completion chord), the page's start look, and the link base untouched.
 */

const WORLD = { width: 450, height: 450 } as const;
function engineOf(patch: Partial<SimulatorSettings>, seed: number) {
  const s = { ...defaultSettings("lines"), ...patch } as SimulatorSettings;
  return createEngineForSettings(physicsConfigOfSettings(s, WORLD as never), "lines", modeSettingsOfSettings(s), seed);
}

describe("Lines: the ring as a circular keyboard (string-art)", () => {
  it("names the key under a bounce from the top, clockwise, and pitches it on C major pentatonic from C4", () => {
    expect(linesKey(-Math.PI / 2)).toBe(0);
    expect(linesKey(0)).toBe(3);
    expect(linesKey(Math.PI / 2)).toBe(6);
    expect(linesKey(Math.PI)).toBe(9);
    expect(linesKey(-Math.PI / 2 - 1e-6)).toBe(LINES_KEYS - 1);
    const midis = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26].map((d) => LINES_KEY_BASE_MIDI + d);
    for (let k = 0; k < LINES_KEYS; k++) expect(linesKeyFrequency(k)).toBeCloseTo(midiToFrequency(midis[k]), 9);
  });

  it("plays every wall bounce as the note of its key, never the plain hit, and keeps the run's trajectory", () => {
    const e = engineOf({}, 3);
    const plain = engineOf({}, 3);
    const v = e.getLinesView();
    let checked = 0;
    for (let k = 0; k < 20 * 60; k++) {
      e.update(1000 / 60, 0);
      plain.update(1000 / 60, 0);
      plain.consumeSoundEvents();
      const evs = e.consumeSoundEvents();
      // no plain hit: every bounce is a pluck of the last bounce's key, marked as a contact (a visitor's own sound plays the plain hit instead)
      expect(evs.filter((x) => x.type === "hit" && !x.loop)).toHaveLength(0);
      for (const h of evs.filter((x) => x.loop === "pluck")) {
        expect([h.frequency, h.ringVoice, ringVoiceEvent(h, true)]).toEqual([linesKeyFrequency(v.lastKey), "contact", { type: "hit", wallIndex: 0 }]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect([v.strings, v.points.length, v.times.length]).toEqual([v.points.length, v.points.length, v.points.length]);
    expect(v.points.length).toBeLessThanOrEqual(LINES_MAX_BOUNCE_POINTS);
    // the endless link base: no goal, never finished
    expect([v.target, v.finished, e.isSimulationFinished()]).toEqual([0, false, false]);
  });

  it("ends after Strings to Finish with the completion chord and the finished art, inside the start look's clip on every seed", () => {
    const ends: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = { ...defaultSettings("lines"), ...clipStartSettings("lines") } as SimulatorSettings;
      const e = createEngineForSettings(physicsConfigOfSettings(s, WORLD as never), "lines", modeSettingsOfSettings(s), seed);
      const log: { t: number; e: SoundEvent }[] = [];
      let quiet = 0;
      let longest = 0;
      for (let k = 0; k < 40 * 60 && !e.isSimulationFinished(); k++) {
        e.update(1000 / 60, 0);
        const evs = e.consumeSoundEvents();
        if (evs.length === 0) longest = Math.max(longest, ++quiet);
        else quiet = 0;
        for (const ev of evs) log.push({ t: e.getElapsedMs() / 1000, e: ev });
      }
      const v = e.getLinesView();
      expect([v.finished, v.strings, v.target, e.isSimulationFinished()]).toEqual([true, 64, 64, true]);
      const chords = log.filter((x) => x.e.loop === "chord");
      expect(chords).toHaveLength(1);
      expect([chords[0].e.ringVoice, chords[0].e.melody]).toEqual(["extra", false]);
      expect(chords[0].t).toBeCloseTo(e.getElapsedMs() / 1000, 6);
      // a note at least every second
      expect(longest / 60).toBeLessThan(1);
      ends.push(e.getElapsedMs() / 1000);
    }
    expect(Math.max(...ends)).toBeLessThan(27);
    expect(Math.min(...ends)).toBeGreaterThan(15);
  });

  it("is the page's start look, a setting a link carries only when set, and a run the finder searches", () => {
    expect(clipStartSettings("lines")).toEqual({ rainbowLines: true, ballSpeed: 700, lnStrings: 64 });
    expect(defaultSettings("lines")).toMatchObject({ lnStrings: 0, rainbowLines: false });
    expect(settingsToSearchParams(defaultSettings("lines")).has("lns")).toBe(false);
    const link = settingsToSearchParams({ ...defaultSettings("lines"), lnStrings: 64 });
    expect(link.get("lns")).toBe("64");
    expect(settingsFromSearchParams(link).lnStrings).toBe(64);
    // a whole number from 0, uncapped; junk falls back to endless
    expect(settingsFromSearchParams(new URLSearchParams("mode=lines&lns=12.6")).lnStrings).toBe(13);
    expect(settingsFromSearchParams(new URLSearchParams("mode=lines&lns=-5")).lnStrings).toBe(0);
    expect(settingsFromSearchParams(new URLSearchParams("mode=lines&lns=5000")).lnStrings).toBe(5000);
    expect(presetToSettings({ mode: "lines", lnStrings: "x" } as never).lnStrings).toBe(0);
    expect(resolveLinesStrings(Number.NaN)).toBe(0);
    expect(runNeverFinishes("lines", { lines: { strings: 64 } } as never)).toBe(false);
    expect(runNeverFinishes("lines", { lines: { strings: 0 } } as never)).toBe(true);
    expect(runNeverFinishes("lines", {} as never)).toBe(true);
    // the link base's request is what it was: no lines block
    expect("lines" in modeSettingsOfSettings(defaultSettings("lines"))).toBe(false);
  });
});

describe("Lines: the string art drawn (string-art)", () => {
  it("draws the finished art in rainbow buckets, the fan and the newest string while it runs, and no fan once finished", () => {
    expect([stringBucket(0), stringBucket(STRING_HUE_CYCLE)]).toEqual([0, 0]);
    expect(stringBucket(STRING_HUE_CYCLE / 2)).toBeGreaterThan(stringBucket(STRING_HUE_CYCLE / 4));
    const e = engineOf({ lnStrings: 30 }, 2);
    for (let k = 0; k < 6 * 60; k++) {
      e.update(1000 / 60, 0);
      e.consumeSoundEvents();
    }
    const v = e.getLinesView();
    const ball = e.getBalls()[0];
    const draw = (nowMs: number) => {
      const ctx = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
      drawLinesArt(ctx, v, ball, { rainbow: true, lineColor: "#ffffff", nowMs, cx: 225, cy: 225, radius: e.getCircularWalls()[0].radius, showGlow: true });
      return ctx.calls;
    };
    const running = draw(e.getElapsedMs());
    const toBall = running.filter((c) => c.name === "lineTo" && c.args[0] === ball.x && c.args[1] === ball.y).length;
    expect(toBall).toBeGreaterThanOrEqual(v.points.length);
    // bounded: one stroke a colour bucket for the art, at most FAN_RECENT for the brightest fan, a few for the rest
    expect(running.filter((c) => c.name === "stroke").length).toBeLessThan(80);
    for (let k = 0; k < 40 * 60 && !e.isSimulationFinished(); k++) {
      e.update(1000 / 60, 0);
      e.consumeSoundEvents();
    }
    expect(v.finished).toBe(true);
    const done = draw(v.finishMs + 2000);
    expect(done.filter((c) => c.name === "lineTo" && c.args[0] === ball.x && c.args[1] === ball.y).length).toBe(0);
  });
});
