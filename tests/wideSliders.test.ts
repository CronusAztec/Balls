import { describe, expect, it } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import { Slider, SliderTrack, TrackEnds, type Translate } from "@/components/simulator/ControlPrimitives";
import { UnlimitedProvider, rulesForRange, wideInputValue, wideTrackValue } from "@/components/simulator/unlimitedSlider";
import { SPREAD_LOG_TRACK } from "@/components/simulator/sections/ChaosFanSection";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { MEMORY_CEILINGS, MEANINGFUL_FLOORS, checkNumber, floorOf, meetsFloor, stepNumber, uncapped } from "@/lib/uncap";
import { LINEAR_SPAN, SLIDER_SPAN, UNLIMITED_SLIDER_CEILING, hasWideTrack, parseUnlimitedValue, sliderCeiling, sliderPosition, sliderValue } from "@/lib/unlimited";
import { CAMERA_RANGES, DIP_FACTOR_FLOOR, SLOW_LAG_CEILING_MS, SlowMotion, maxSlowLagMs, resolveCameraSettings, slowMoStretchOf, slowMoTimeScale } from "@/lib/simulation/camera";

/*
 * --- unlimited-sizes --- (plan step 15) Sliders, fields and meaningful floors: Wide sliders is on by default (`inf=0` gives the
 * comfort tracks back) and changes no run; every slider of the panel draws the wide track, named by its setting; an
 * allocating count's track ends at its memory-safety ceiling, a scalar's at 1T; the wide track's input holds the setting's
 * own value across the comfort range; and a value below a slider's start is kept from its meaningful floor up.
 */

// The components are compiled with the classic JSX transform here (tsconfig keeps JSX for Next): React must be global.
(globalThis as { React?: unknown }).React = React;

const controls = en.Controls as Record<string, string>;
const t = ((key: string, values?: Record<string, unknown>) => String(new IntlMessageFormat(controls[key] ?? key, "en").format(values as Record<string, string>))) as unknown as Translate;
const intl = (child: React.ReactElement, wide?: boolean) => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, wide === undefined ? child : createElement(UnlimitedProvider as unknown as React.FC<{ on: boolean }>, { on: wide }, child)));
const slider = (labelKey: string, value: number, range: { min: number; max: number; step: number }, extra: Record<string, unknown> = {}) => createElement(Slider, { t, search: "", matches: () => true, labelKey, value, range, onChange: () => {}, ...extra });

describe("Wide sliders: on by default, the panel's only", () => {
  it("is on in every mode's defaults, travels only as inf=0, still reads an old inf=1 and changes no run", () => {
    for (const mode of ["classic", "multiply", "fightLeague", "paddle", "collide"] as const) {
      const d = defaultSettings(mode);
      expect(d.unlimited).toBe(true);
      expect(settingsToSearchParams(d).get("inf")).toBeNull();
      const off = { ...d, unlimited: false };
      expect(settingsToSearchParams(off).get("inf")).toBe("0");
      expect(settingsFromSearchParams(settingsToSearchParams(off)).unlimited).toBe(false);
      expect(physicsConfigOfSettings(off)).toEqual(physicsConfigOfSettings(d));
    }
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&inf=1")).unlimited).toBe(true);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic")).unlimited).toBe(true);
    expect(presetToSettings({ mode: "classic" }).unlimited).toBe(true);
    expect(presetToSettings({ mode: "classic", unlimited: false }).unlimited).toBe(false);
  });

  it("draws every panel slider's wide track by default, named by its setting, and the comfort track with the switch off", () => {
    const html = intl(slider("ballSpeed", 400, RANGES.ballSpeed));
    expect(html).toContain('data-unlimited-slider="ballSpeed"');
    // (the input holds the value itself inside the comfort range: a tool reads "400", as on a plain track)
    expect(html).toMatch(/type="range"[^>]*value="400"/);
    const off = intl(slider("ballSpeed", 400, RANGES.ballSpeed), false);
    expect(off).not.toContain("data-unlimited-slider");
    expect(off).toMatch(new RegExp(`type="range" min="${RANGES.ballSpeed.min}" max="${RANGES.ballSpeed.max}"`));
    // An inline range widens by its setting's name (the Teams ball count in Grow: 1–2, then the crowd).
    const inline = intl(slider("ballCount", 2, { ...RANGES.ballCount, max: 2 }, { settingKey: "ballCount" }));
    expect(inline).toContain('data-unlimited-slider="ballCount"');
    // A hand-written track too, and its end label becomes a comfort mark.
    const track = intl(createElement(SliderTrack, { settingKey: "recordingDuration", label: "Duration", value: 30, range: RANGES.recordingDuration, onChange: () => {} }));
    expect(track).toContain('data-unlimited-slider="recordingDuration"');
    const ends = intl(createElement(TrackEnds, { settingKey: "recordingDuration", range: RANGES.recordingDuration, min: "10s", max: "120s", tip: "tip" }));
    expect(ends).toContain('data-comfort-mark="recordingDuration"');
    expect(intl(createElement(TrackEnds, { settingKey: "recordingDuration", range: RANGES.recordingDuration, min: "10s", max: "120s", tip: "tip" }), false)).not.toContain("data-comfort-mark");
    // A count whose ceiling is its slider's end has no wide part (Territory's teams), nor a clip count at its ceiling.
    expect(intl(slider("tyTeams", 2, RANGES.tyTeams))).not.toContain("data-unlimited-slider");
    expect(intl(createElement(SliderTrack, { settingKey: "batchCount", label: "Clips", value: 5, range: { min: 1, max: 50, step: 1 }, onChange: () => {}, top: 50 }))).not.toContain("data-unlimited-slider");
  });

  it("continues a log track past its comfort range with the switch on (every decade the same length)", () => {
    const wide = intl(slider("dpSpreadDeg", 0.001, RANGES.dpSpreadDeg, { log: SPREAD_LOG_TRACK }));
    const narrow = intl(slider("dpSpreadDeg", 0.001, RANGES.dpSpreadDeg, { log: SPREAD_LOG_TRACK }), false);
    const end = (html: string) => Number(/data-log-track="(\d+)"/.exec(html)?.[1]);
    expect(end(wide)).toBeGreaterThan(end(narrow));
    // (the comfort part keeps its positions: a thousandth sits where it always did)
    expect(/value="(\d+)"[^>]*data-log-track/.exec(wide)?.[1]).toBe(/value="(\d+)"[^>]*data-log-track/.exec(narrow)?.[1]);
  });
});

describe("Wide sliders: the track's ends and its input", () => {
  it("ends an allocating count at its memory-safety ceiling, a scalar at 1T, and never rounds past the top", () => {
    expect(UNLIMITED_SLIDER_CEILING).toBe(1e12);
    expect(sliderCeiling("ballSpeed", RANGES.ballSpeed)).toBe(1e12);
    expect(sliderCeiling("wallCount", RANGES.wallCount)).toBe(MEMORY_CEILINGS.wallCount);
    expect(sliderCeiling("ballCount", RANGES.ballCount)).toBe(MEMORY_CEILINGS.ballCount);
    expect(sliderValue("wallCount", SLIDER_SPAN, RANGES.wallCount)).toBe(MEMORY_CEILINGS.wallCount);
    expect(sliderValue("wtRidges", SLIDER_SPAN, RANGES.wtRidges)).toBeLessThanOrEqual(MEMORY_CEILINGS.wtRidges); // (4,096 is not rounded to 4,100)
    expect(hasWideTrack("tyTeams", RANGES.tyTeams)).toBe(false);
    expect(hasWideTrack("botCount", { min: 1, max: 20, step: 1 }, 50)).toBe(true);
    expect(sliderValue("botCount", SLIDER_SPAN, { min: 1, max: 20, step: 1 }, 50)).toBe(50);
  });

  it("holds the setting's own value inside the comfort range and an encoded position past it, both ways", () => {
    const r = RANGES.ballSpeed;
    for (const v of [r.min, 400, r.max]) {
      expect(wideInputValue("ballSpeed", v, r)).toBe(v);
      expect(wideTrackValue("ballSpeed", v, r)).toBe(v);
    }
    expect(wideInputValue("ballSpeed", 1e12, r)).toBeCloseTo(r.max + (r.max - r.min), 9);
    for (const v of [5_000, 3e6, 7e9]) {
      const back = wideTrackValue("ballSpeed", wideInputValue("ballSpeed", v, r), r);
      expect(Math.abs(back - v) / v).toBeLessThan(0.06);
    }
    // The thumb sits where sliderPosition() puts it, and a value below the track pins at its start.
    const at = wideInputValue("ballSpeed", 3e6, r);
    expect(LINEAR_SPAN + ((SLIDER_SPAN - LINEAR_SPAN) * (at - r.max)) / (r.max - r.min)).toBeCloseTo(sliderPosition("ballSpeed", 3e6, r), 9);
    expect(wideInputValue("rotationSpeed", 0, RANGES.rotationSpeed)).toBe(RANGES.rotationSpeed.min);
    expect(wideTrackValue("ballSpeed", Number.NaN, r)).toBe(r.min);
  });
});

describe("Meaningful floors: a value below a slider's start, from where it still means something", () => {
  it("keeps a still ring, one target, a 3 s clip and a factor-0 slow motion through links, presets and the number field", () => {
    const link = settingsFromSearchParams(new URLSearchParams("mode=classic&rs=0&tc=1&msc=1&gr=1&gap=0.05&dur=3&slowf=0&slowms=50"));
    expect([link.rotationSpeed, link.targetCount, link.multiplySpawnCount, link.growRate, link.gapSize, link.recordingDuration, link.slowMoFactor, link.slowMoMs]).toEqual([0, 1, 1, 1, 0.05, 3, 0, 50]);
    const back = settingsFromSearchParams(settingsToSearchParams(link));
    expect([back.rotationSpeed, back.targetCount, back.recordingDuration, back.slowMoFactor, back.slowMoMs]).toEqual([0, 1, 3, 0, 50]);
    const preset = presetToSettings({ mode: "classic", rotationSpeed: 0, targetCount: 1, recordingDuration: 3, slowMoFactor: 0 });
    expect([preset.rotationSpeed, preset.targetCount, preset.recordingDuration, preset.slowMoFactor]).toEqual([0, 1, 3, 0]);
    // Below the floor (or at a "more than" floor) the value is as invalid as ever: lifted onto the slider's start.
    const bad = settingsFromSearchParams(new URLSearchParams("mode=classic&rs=-1&gap=0&tc=0&dur=0"));
    expect([bad.rotationSpeed, bad.gapSize, bad.targetCount, bad.recordingDuration]).toEqual([RANGES.rotationSpeed.min, RANGES.gapSize.min, RANGES.targetCount.min, defaultSettings("classic").recordingDuration]);
    // The defaults are unchanged and no default run moves.
    expect(physicsConfigOfSettings(defaultSettings("classic"))).toEqual(physicsConfigOfSettings(presetToSettings(defaultSettings("classic"))));
  });

  it("is the number field's minimum (≥ or >) and the parsers' bound, and every floor lies below its slider's start", () => {
    for (const [key, floor] of Object.entries(MEANINGFUL_FLOORS)) {
      const range = (RANGES as unknown as Record<string, { min: number; max: number; step: number }>)[key];
      expect(range, key).toBeDefined();
      expect(floor.min, key).toBeLessThan(range.min);
      expect(floorOf(key, range)).toEqual({ min: floor.min, above: floor.above === true });
    }
    expect(rulesForRange(RANGES.rotationSpeed, "rotationSpeed")).toEqual({ min: 0, integer: false });
    expect(rulesForRange(RANGES.gapSize, "gapSize")).toEqual({ min: 0, above: true, integer: false });
    expect(rulesForRange(RANGES.ballSpeed, "ballSpeed")).toEqual({ min: RANGES.ballSpeed.min, integer: false });
    expect(rulesForRange(RANGES.windX, "windX").min).toBeUndefined();
    expect(checkNumber(0, { min: 0, above: true })).toEqual({ ok: false, reason: "notAbove", min: 0 });
    expect(checkNumber(-1, { min: 0, above: true })).toEqual({ ok: false, reason: "notAbove", min: 0 });
    expect(checkNumber(0.001, { min: 0, above: true })).toEqual({ ok: true, value: 0.001 });
    expect(stepNumber(1, -1, RANGES.recordingDuration, { min: 0, above: true })).toBe(1); // (a step onto a "more than" floor is not taken)
    expect(stepNumber(5, -1, RANGES.recordingDuration, { min: 0, above: true })).toBe(4);
    expect(parseUnlimitedValue("gapSize", 0, RANGES.gapSize)).toBeNull();
    expect(parseUnlimitedValue("gapSize", 0.01, RANGES.gapSize)).toBe(0.01);
    expect(meetsFloor("targetCount", 1, RANGES.targetCount)).toBe(true);
    expect(uncapped(0, RANGES.rotationSpeed, 1, "rotationSpeed")).toBe(0);
    expect(uncapped(0, RANGES.rotationSpeed, 1)).toBe(RANGES.rotationSpeed.min); // (without its key: the slider's start, as before)
  });
});

describe("Camera floors: the near miss's factor down to 0, its lag bounded", () => {
  it("freezes a window at a factor of 0 and keeps a dip's own floor", () => {
    const slow = new SlowMotion();
    expect(slow.trigger(700)).toBe(true);
    slow.advance(300, 700);
    expect(slow.timeScale(700, 0)).toBe(0); // (past its ease-in a window at a factor of 0 holds the run still: no 0.05 floor)
    expect(resolveCameraSettings({ slowMoFactor: 0 }).slowMoFactor).toBe(0);
    expect(slowMoTimeScale(400, 700, 0, undefined, 0)).toBe(0);
    expect(slowMoTimeScale(400, 700, 0)).toBeCloseTo(DIP_FACTOR_FLOOR, 12);
    expect(slowMoTimeScale(400, 700, 0.001, undefined, 0)).toBeCloseTo(0.001, 12);
  });

  it("bounds the clip's lag and the export's stretch by the actual factor, exactly as before from the slider's minimum up", () => {
    const min = CAMERA_RANGES.slowMoFactor.min;
    for (const clip of [10_000, 30_000, 120_000]) {
      expect(maxSlowLagMs(clip)).toBe(clip * (1 / min - 1));
      for (const f of [min, 0.4, 0.8, 3]) {
        expect(maxSlowLagMs(clip, f)).toBe(maxSlowLagMs(clip));
        expect(slowMoStretchOf(f, clip)).toBe(1 / Math.max(min, f));
      }
      expect(maxSlowLagMs(clip, 0.1)).toBe(clip * 9);
      expect(maxSlowLagMs(clip, 0)).toBe(SLOW_LAG_CEILING_MS);
      expect(Number.isFinite(slowMoStretchOf(0, clip))).toBe(true);
      expect(slowMoStretchOf(0.1, clip)).toBeCloseTo(10, 9);
    }
    expect(SLOW_LAG_CEILING_MS).toBe(3_600_000);
  });
});
