import { describe, expect, it } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import pl from "../messages/pl.json"; // --- unlimited-sizes --- (the tooltips that state a slider's range, in every locale)
import es from "../messages/es.json";
import { Slider, SliderTrack, TrackEnds, type Translate } from "@/components/simulator/ControlPrimitives";
import { UnlimitedProvider, WIDE_KEY_NOTCH, WideTrack, rulesForRange, wideInputValue, wideTrackKeyValue, wideTrackValue } from "@/components/simulator/unlimitedSlider";
import { SPREAD_LOG_TRACK } from "@/components/simulator/sections/ChaosFanSection";
import { RANGES, defaultSettings, pastAnyMemoryCeiling, presetToLiveSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, unlimitedSettingKeys, type SimulatorSettings } from "@/lib/settings";
import { PROJECT_FORMAT, buildProject, parseProject, resolveProjectSettings, serializeProject } from "@/lib/project"; // --- review fix --- (a file saved before 1.16.0)
import { physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { MEMORY_CEILINGS, MEANINGFUL_FLOORS, checkNumber, floorOf, formatCompact, meetsFloor, stepNumber, uncapped } from "@/lib/uncap";
import { LINEAR_SPAN, SLIDER_SPAN, UNLIMITED_SLIDER_CEILING, WIDE_SLIDERS_SAVED_SINCE_KEY, hasWideTrack, isBoundedKey, parseUnlimitedValue, sliderCeiling, sliderPosition, sliderValue, wideSlidersOf } from "@/lib/unlimited";
import { CAMERA_RANGES, DIP_FACTOR_FLOOR, SLOW_LAG_CEILING_MS, SlowMotion, maxSlowLagMs, resolveCameraSettings, slowMoStretchOf, slowMoTimeScale } from "@/lib/simulation/camera";
import { MODE_IDS } from "@/lib/physics/types"; // --- review fix --- (every section rendered for every mode)
import { planBeatDrop } from "@/lib/simulation/beatDropPlan"; // --- unlimited-sizes --- (the one tooltip range a planner still holds)
import { MAX_PANE_HP, stageHp } from "@/lib/physics/modes/glass"; // --- unlimited-sizes --- (review fix) (the Hits per Pane tip)
import { resolveBattleSettings } from "@/lib/physics/modes/arenaGames"; // --- unlimited-sizes --- (review fix) (the Battle card)
import { chainCountCeiling, resolveDoublePendulumSettings } from "@/lib/physics/modes/doublePendulum"; // --- unlimited-sizes --- (review fix)
import fs from "node:fs";
import path from "node:path";

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
    expect(presetToSettings({ mode: "classic", unlimited: false, slowMotion: true }).unlimited).toBe(false); // (--- review fix --- a save since 1.16.0: it carries the Slow motion switch)
  });

  it("stays on for a preset, project file or batch job saved before 1.16.0, whose off was the old default; a later save keeps its off", () => {
    // (--- review fix --- every save stored `unlimited: false` while off was the default, without the visitor ever turning it
    // off; every save since carries the Slow motion switch, new in 1.16.0)
    expect(WIDE_SLIDERS_SAVED_SINCE_KEY).toBe("slowMotion");
    expect(Object.prototype.hasOwnProperty.call(defaultSettings("classic"), WIDE_SLIDERS_SAVED_SINCE_KEY)).toBe(true);
    const old: Record<string, unknown> = { ...defaultSettings("classic"), wallCount: 12, unlimited: false };
    delete old[WIDE_SLIDERS_SAVED_SINCE_KEY];
    const uploads = { hitSample: false, wallBreakSound: null };
    expect(wideSlidersOf(old)).toBe(true);
    expect(presetToSettings(old as Partial<SimulatorSettings>)).toMatchObject({ unlimited: true, slowMotion: true, wallCount: 12 }); // a saved preset
    expect(presetToLiveSettings(old as Partial<SimulatorSettings>, uploads)).toMatchObject({ unlimited: true, wallCount: 12 }); // a batch job's settings
    expect(resolveProjectSettings(old)).toMatchObject({ unlimited: true, wallCount: 12 });
    const file = parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: 1, name: "Old", settings: old }));
    expect(file.ok && file.project.settings.unlimited).toBe(true); // an Open project of a 1.15 file
    for (const slowMotion of [true, false]) {
      const since = { ...old, slowMotion };
      expect([slowMotion, wideSlidersOf(since)]).toEqual([slowMotion, false]);
      expect(presetToSettings(since as Partial<SimulatorSettings>)).toMatchObject({ unlimited: false, slowMotion, wallCount: 12 });
      expect(presetToLiveSettings(since as Partial<SimulatorSettings>, uploads)).toMatchObject({ unlimited: false, slowMotion });
      expect(resolveProjectSettings(since)).toMatchObject({ unlimited: false, slowMotion });
    }
    // what the page saves today round-trips: a preset ({ ...settings }) and a project file turned off stay off
    const saved = { ...defaultSettings("classic"), unlimited: false };
    expect(presetToSettings(JSON.parse(JSON.stringify(saved))).unlimited).toBe(false);
    const parsed = parseProject(serializeProject(buildProject({ name: "New", settings: saved })));
    expect(parsed.ok && parsed.project.settings.unlimited).toBe(false);
    expect(presetToSettings({ ...saved, unlimited: true }).unlimited).toBe(true);
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

  it("goes on linearly past a comfort range that ends at or below 0 (a clip's gain up to 0 dB), both ways (--- unlimited-sizes ---)", () => {
    const gain = { min: -30, max: 0, step: 0.5 };
    const top = 770;
    for (const v of [0.5, 3, 100, 700]) {
      const pos = sliderPosition("loopClipGain:bed", v, gain, top);
      expect([v, Number.isFinite(pos), pos > LINEAR_SPAN, pos <= SLIDER_SPAN]).toEqual([v, true, true, true]);
      expect(pos).toBeCloseTo(LINEAR_SPAN + ((SLIDER_SPAN - LINEAR_SPAN) * v) / top, 9);
      const input = wideInputValue("loopClipGain:bed", v, gain, top);
      expect(Number.isFinite(input)).toBe(true);
      expect(Math.abs(wideTrackValue("loopClipGain:bed", input, gain, top) - v)).toBeLessThan(Math.max(0.01, v * 0.01));
    }
    expect(sliderPosition("loopClipGain:bed", top, gain, top)).toBe(SLIDER_SPAN);
  });
});

describe("Wide sliders: the keyboard on the wide track (--- unlimited-sizes ---)", () => {
  const ranges = RANGES as unknown as Record<string, { min: number; max: number; step: number } | undefined>;
  const wideKeys = unlimitedSettingKeys().filter((key) => {
    const r = ranges[key];
    return !!r && !isBoundedKey(key) && hasWideTrack(key, r);
  });
  const defaults = { ...defaultSettings("classic"), ...defaultSettings("paddle"), ...defaultSettings("collide") } as unknown as Record<string, unknown>;

  it("moves on every arrow press of every wide track: a step inside the comfort range, a log notch past it", () => {
    // step="any" made a native press move 1/100 of the input, which snapped back to the step: 14 of Classic's 32 tracks never moved
    expect(wideKeys.length).toBeGreaterThan(40);
    for (const key of ["ballCount", "wallCount", "wallThickness", "gapSize", "wallBounciness", "respawnEvery", "spinStrength", "cameraZoom", "fullBallLimit", "pdSkill", "pdMisses", "cpSizeSpread", "cpGravity"]) {
      expect(wideKeys, key).toContain(key);
    }
    for (const key of wideKeys) {
      const r = ranges[key]!;
      const top = sliderValue(key, SLIDER_SPAN, r);
      const own = typeof defaults[key] === "number" && Number.isFinite(defaults[key]) ? (defaults[key] as number) : r.min;
      for (const v of [own, r.min, r.max, (r.min + r.max) / 2]) {
        const right = wideTrackKeyValue(key, v, r, "ArrowRight")!;
        const left = wideTrackKeyValue(key, v, r, "ArrowLeft")!;
        if (v < top) expect(right, `${key} ${v} →`).toBeGreaterThan(v);
        if (v > r.min) expect(left, `${key} ${v} ←`).toBeLessThan(v);
        expect(wideTrackKeyValue(key, v, r, "ArrowUp"), key).toBe(right);
        expect(wideTrackKeyValue(key, v, r, "ArrowDown"), key).toBe(left);
        expect(wideTrackKeyValue(key, v, r, "PageUp")!, key).toBeGreaterThanOrEqual(right);
        expect(wideTrackKeyValue(key, v, r, "PageDown")!, key).toBeLessThanOrEqual(left);
        // inside the comfort range a press is one step, as on the plain track
        if (v >= r.min && v < r.max && Math.abs((v - r.min) / r.step - Math.round((v - r.min) / r.step)) < 1e-9) {
          if (v + r.step <= r.max + 1e-9) expect(right, `${key} ${v} → one step`).toBeCloseTo(v + r.step, 6);
          else expect(right, `${key} ${v} → on past an end off the grid`).toBeGreaterThan(r.max);
        }
      }
      // from the range's end a press up always leaves it, and a press down from there comes back into the range
      const past = wideTrackKeyValue(key, r.max, r, "ArrowRight")!;
      expect(past, `${key} past ${r.max}`).toBeGreaterThan(r.max);
      expect(wideTrackKeyValue(key, past, r, "ArrowLeft"), key).toBeLessThan(past);
      expect(wideTrackKeyValue(key, wideTrackKeyValue(key, past, r, "ArrowLeft")!, r, "ArrowLeft")!, key).toBeLessThanOrEqual(r.max);
      // the ends
      expect(wideTrackKeyValue(key, r.max * 3, r, "Home"), key).toBe(r.min);
      expect(wideTrackKeyValue(key, r.min, r, "End"), key).toBe(top);
      expect(wideTrackKeyValue(key, top, r, "ArrowRight"), key).toBe(top);
    }
  });

  it("walks the whole log track in notches, never rounds back, and leaves a value past either end of the track alone", () => {
    const r = RANGES.ballCount;
    let v: number = r.max;
    let presses = 0;
    while (v < sliderValue("ballCount", SLIDER_SPAN, r) && presses < 1000) {
      const next = wideTrackKeyValue("ballCount", v, r, "ArrowRight")!;
      expect(next).toBeGreaterThan(v);
      v = next;
      presses++;
    }
    expect(presses).toBeGreaterThan(10);
    expect(presses).toBeLessThanOrEqual((SLIDER_SPAN - LINEAR_SPAN) / WIDE_KEY_NOTCH);
    expect(v).toBe(MEMORY_CEILINGS.ballCount);
    // a value typed past the track's top or below the slider's start (a meaningful floor) stays on a press the wrong way
    expect(wideTrackKeyValue("ballSpeed", 5e12, RANGES.ballSpeed, "ArrowRight")).toBe(5e12);
    expect(wideTrackKeyValue("ballSpeed", 5e12, RANGES.ballSpeed, "ArrowLeft")!).toBeLessThan(5e12);
    expect(wideTrackKeyValue("rotationSpeed", 0, RANGES.rotationSpeed, "ArrowLeft")).toBe(0);
    expect(wideTrackKeyValue("rotationSpeed", 0, RANGES.rotationSpeed, "ArrowRight")).toBe(RANGES.rotationSpeed.min);
    // a value off the grid goes to the next grid point that way
    expect(wideTrackKeyValue("ballSpeed", 403, { min: 100, max: 1000, step: 50 }, "ArrowRight")).toBe(450);
    expect(wideTrackKeyValue("ballSpeed", 403, { min: 100, max: 1000, step: 50 }, "ArrowLeft")).toBe(400);
    expect(wideTrackKeyValue("ballCount", 4, r, "Tab")).toBeNull();
    // a track with its own top (the bots of a batch: 1–20, then up to 50)
    const bots = { min: 1, max: 20, step: 1 };
    expect(wideTrackKeyValue("botCount", 3, bots, "ArrowRight", 50)).toBe(4);
    expect(wideTrackKeyValue("botCount", 20, bots, "ArrowRight", 50)!).toBeGreaterThan(20);
    expect(wideTrackKeyValue("botCount", 50, bots, "ArrowRight", 50)).toBe(50);
    expect(wideTrackKeyValue("botCount", 3, bots, "End", 50)).toBe(50);
  });

  it("takes the keys on the track itself: the press is the track's, not the browser's", () => {
    const changes: number[] = [];
    const track = WideTrack({ settingKey: "wallCount", value: 7, range: RANGES.wallCount, onChange: (v) => changes.push(v) }) as React.ReactElement<{ onKeyDown: (e: unknown) => void; step: string }>;
    expect(track.props.step).toBe("any");
    let prevented = 0;
    const press = (key: string, mods: Record<string, boolean> = {}) => track.props.onKeyDown({ key, altKey: false, ctrlKey: false, metaKey: false, ...mods, preventDefault: () => prevented++ });
    press("ArrowRight");
    press("ArrowLeft");
    press("ArrowRight", { ctrlKey: true }); // (a browser shortcut stays the browser's)
    press("Tab");
    expect(changes).toEqual([8, 6]);
    expect(prevented).toBe(2);
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

// --- review fix (unlimited-sizes) --- every section's sliders, rendered: a Slider handed an inline range without its setting's
// name drew the comfort track and no memory-safety note (Land Claim's Teams stopped at 12, a typed 5,000 said nothing)
describe("Wide sliders in every section of the panel", () => {
  const SECTIONS_DIR = path.join(__dirname, "..", "src", "components", "simulator", "sections");
  const loaders: Record<string, () => Promise<{ default?: unknown }>> = Object.fromEntries(
    fs
      .readdirSync(SECTIONS_DIR)
      .filter((file) => file.endsWith(".tsx"))
      .sort()
      .map((file) => [file, () => import(/* @vite-ignore */ path.join(SECTIONS_DIR, file)) as Promise<{ default?: unknown }>]),
  );
  /** The sections that take more than the panel's settings: each one's own panel props, built here as the page has them at rest. */
  const EXTRA: Record<string, Record<string, unknown>> = {
    "PicturePaintSection.tsx": { showAdvanced: true, picture: null, onUpload: () => {}, onRemove: () => {}, beat: { bpm: null, analyzing: false, hasSong: false, source: null } },
  };
  /** Every rendered Slider (`data-uncap-slider`) of a setting with room past its comfort range draws the wide track or its log track. */
  const narrowSliders = (html: string): string[] => {
    const keys = new Set(unlimitedSettingKeys());
    const out: string[] = [];
    for (const block of html.split('data-uncap-slider="').slice(1)) {
      const key = block.slice(0, block.indexOf('"'));
      const range = (RANGES as unknown as Record<string, { min: number; max: number; step: number } | undefined>)[key];
      if (!keys.has(key) || !range || isBoundedKey(key) || !hasWideTrack(key, range)) continue; // (not a setting – a Blueprint slider –, or no room past its end)
      const own = block.slice(0, block.indexOf("data-uncap-slider=") >= 0 ? block.indexOf("data-uncap-slider=") : undefined);
      if (!own.includes(`data-unlimited-slider="${key}"`) && !own.includes("data-log-track=")) out.push(key);
    }
    return out;
  };

  it("draws the wide track on every slider of every section, for every mode's defaults and the other layouts", { timeout: 180_000 }, async () => {
    const render = (component: unknown, file: string, s: SimulatorSettings, search = "") => intl(createElement(component as React.FC<Record<string, unknown>>, { t, search, matches: () => true, settings: s, update: () => {}, ...(EXTRA[file] ?? {}) }));
    const unrendered = new Set<string>();
    const misses = new Set<string>();
    let rendered = 0;
    for (const [rel, load] of Object.entries(loaders)) {
      const file = path.basename(rel);
      let mod: { default?: unknown };
      try {
        mod = await load();
      } catch {
        unrendered.add(file); // (a section that imports the page's navigation: next/navigation is not there in Node)
        continue;
      }
      if (typeof mod.default !== "function") continue;
      const variants: SimulatorSettings[] = [...MODE_IDS.map((mode) => defaultSettings(mode)), { ...defaultSettings("landClaim"), lcLayout: "pyramid" }, { ...defaultSettings("collide"), cpRing: true }, { ...defaultSettings("doublePendulum"), dpFan: true }];
      for (const [i, s] of variants.entries()) {
        let html: string;
        try {
          html = render(mod.default, file, s, i >= MODE_IDS.length ? "a" : ""); // (the layouts with a search too: it shows what a setting hides)
        } catch {
          unrendered.add(file);
          break;
        }
        rendered++;
        for (const key of narrowSliders(html)) misses.add(`${file} ${key} (${s.mode})`);
      }
    }
    expect([...misses]).toEqual([]);
    expect(rendered).toBeGreaterThan(60 * MODE_IDS.length);
    // the sections left out need the page's own panel (a batch, the bot, a project, the loop clips, a video) or its navigation:
    // their sliders are the setting's own range, which names it (RANGES.<key>), and their hand-written tracks name it (SliderTrack)
    for (const file of unrendered) {
      const text = fs.readFileSync(path.join(SECTIONS_DIR, file), "utf8");
      for (const m of text.matchAll(/<Slider\b[^>]*?\brange=\{([^}]*)\}/g)) expect([file, /^RANGES\.\w+$/.test(m[1].trim()) || /settingKey=/.test(m[0])]).toEqual([file, true]);
    }
  });

  it("widens Land Claim's Teams by name in both layouts, and says a count past its memory-safety ceiling", async () => {
    const { default: LandClaimSection } = await import("@/components/simulator/sections/LandClaimSection");
    const props = (s: SimulatorSettings) => ({ t, search: "", matches: () => true, settings: s, update: () => {} });
    for (const lcLayout of ["wall", "pyramid"] as const) {
      const s = { ...defaultSettings("landClaim"), lcLayout };
      expect([lcLayout, intl(createElement(LandClaimSection, props(s)))]).toEqual([lcLayout, expect.stringContaining('data-unlimited-slider="lcTeams"')]);
      const far = intl(createElement(LandClaimSection, props({ ...s, lcTeams: 5000 })));
      expect([lcLayout, far]).toEqual([lcLayout, expect.stringContaining(`Memory-safety ceiling: the run builds at most ${formatCompact(MEMORY_CEILINGS.lcTeams)}`)]);
    }
    expect(intl(createElement(LandClaimSection, props(defaultSettings("landClaim"))), false)).not.toContain('data-unlimited-slider="lcTeams"'); // (the comfort track with the switch off)
  });

  // --- unlimited-sizes --- the Double Pendulum's Arms: the Double and Triple picks, and a track and a number field for 4 arms or more
  it("sets any number of Double Pendulum arms in the panel, keeps the Double and Triple picks, and says a chain past its memory-safety ceiling", async () => {
    const { default: DoublePendulumSection } = await import("@/components/simulator/sections/DoublePendulumSection");
    const props = (s: SimulatorSettings) => ({ t, search: "", matches: () => true, settings: s, update: () => {} });
    const link = (dpsg: number) => settingsFromSearchParams(new URLSearchParams(`mode=doublePendulum&dpsg=${dpsg}`));
    const arms = (html: string) => html.slice(html.indexOf('role="group" aria-label="Arms"'), html.indexOf("</div>", html.indexOf('role="group" aria-label="Arms"')));
    const pressed = (html: string) => [...arms(html).matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`);
    const field = (html: string) => /<input[^>]*data-number-field="dpSegments"[^>]*>/.exec(html)?.[0].match(/\svalue="([^"]*)"/)?.[1];
    const eight = intl(createElement(DoublePendulumSection, props(link(8))));
    expect(link(8).dpSegments).toBe(8);
    expect(eight).toContain('data-unlimited-slider="dpSegments"');
    expect(field(eight)).toBe("8");
    expect(pressed(eight)).toEqual(["Double:false", "Triple:false"]);
    expect(eight).toContain(`Type up to ${MEMORY_CEILINGS.dpSegments} arms in the field`);
    expect(eight).not.toContain("Memory-safety ceiling");
    expect(pressed(intl(createElement(DoublePendulumSection, props(link(3)))))).toEqual(["Double:false", "Triple:true"]);
    expect(pressed(intl(createElement(DoublePendulumSection, props(defaultSettings("doublePendulum")))))).toEqual(["Double:true", "Triple:false"]);
    const far = intl(createElement(DoublePendulumSection, props(link(100))));
    expect(link(100).dpSegments).toBe(100); // (the link keeps the number)
    expect(far).toContain(`Memory-safety ceiling: the run builds at most ${formatCompact(MEMORY_CEILINGS.dpSegments)}`);
    const off = intl(createElement(DoublePendulumSection, props(link(8))), false);
    expect(off).not.toContain('data-unlimited-slider="dpSegments"'); // (the comfort track with the switch off, pinned at its end)
    expect(off).toMatch(/<input[^>]*type="range"[^>]*min="2"[^>]*max="3"[^>]*aria-label="Arms"/);
    expect(field(off)).toBe("8");
  });

  // --- unlimited-sizes --- (review fix) the pendulums and their arms together stop at the chains' ceilings (chainCountCeiling():
  // 4 pendulums of 64 arms, 10 of 40): the panel says how many a run builds, as ARENA FULL does on the canvas
  it("says the Double Pendulum's pendulums a run builds when they and their arms pass the chains' ceilings, and nothing while all swing", async () => {
    const { default: DoublePendulumSection } = await import("@/components/simulator/sections/DoublePendulumSection");
    const props = (s: SimulatorSettings) => ({ t, search: "", matches: () => true, settings: s, update: () => {} });
    const link = (query: string) => settingsFromSearchParams(new URLSearchParams(`mode=doublePendulum&${query}`));
    /** The panel's warn lines (the arms' and the pendulums' notes), in order. */
    const notes = (s: SimulatorSettings) => [...intl(createElement(DoublePendulumSection, props(s))).matchAll(/<p class="text-xs text-warn">([^<]*)<\/p>/g)].map((m) => m[1]);
    const builds = (n: string) => `Memory-safety ceiling: the run builds at most ${n} of these (ARENA FULL); the link keeps your number.`;
    expect([chainCountCeiling(64), chainCountCeiling(40), chainCountCeiling(2)]).toEqual([4, 10, 1024]);
    for (const [query, want] of [
      ["dpsg=64&dpn=5", [builds("4")]],
      ["dpsg=40&dpn=11", [builds("10")]],
      ["dpsg=2&dpn=1025", [builds("1,024")]],
      ["dpsg=2&dpn=6000", [builds("1,024")]], // (one note, the chains' 1,024: never the pendulums' own 5,000 as well)
      ["dpsg=100&dpn=5", [builds(formatCompact(MEMORY_CEILINGS.dpSegments)), builds("4")]],
      ["dpsg=64&dpn=4", []],
      ["dpsg=40&dpn=10", []],
      ["dpsg=2&dpn=4", []],
    ] as const) {
      const s = link(query);
      expect([query, notes(s)]).toEqual([query, want]);
      // (the note and the canvas's ARENA FULL agree, and the number is the one the run builds)
      expect([query, pastAnyMemoryCeiling(s)]).toEqual([query, want.length > 0]);
      if (want.length) expect(want.at(-1)).toBe(builds(new Intl.NumberFormat("en").format(resolveDoublePendulumSettings({ count: s.dpCount, segments: s.dpSegments }).count)));
    }
    // sparring always swings two: nothing is cut, nothing said
    expect(notes({ ...link("dpsg=64&dpn=5"), dpSpar: true })).toEqual([]);
  });
});

// --- unlimited-sizes --- a tooltip that states its slider's range says it is the slider's usual range: past it the wide
// track and the number field go on, so "from 20 to 800" read as a limit the setting no longer has
describe("Tooltips: a slider's range is its usual range, not the setting's limit", () => {
  const CATALOGS = { en, pl, es } as const;
  type Locale = keyof typeof CATALOGS;
  /** The slider, as each locale names it: a tip that states a range and names the slider says the range is the slider's. */
  const SLIDER: Record<Locale, RegExp> = { en: /slider/i, pl: /suwak/i, es: /deslizador|el control/i };
  const number = (n: number, locale: Locale) => (locale === "en" ? String(n) : String(n).replace(".", ","));
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** Settings whose code still holds the slider's range, so the tip may state it as a limit (each one proven below). */
  const HELD_BY_CODE = new Set(["bdAnticipation"]);

  it("names the slider wherever the tip of an uncapped setting states the slider's own range, in en, pl and es", () => {
    const offenders: string[] = [];
    for (const locale of Object.keys(CATALOGS) as Locale[]) {
      const controls = CATALOGS[locale].Controls as Record<string, string>;
      for (const [key, range] of Object.entries(RANGES as unknown as Record<string, { min: number; max: number; step: number }>)) {
        const tip = controls[`${key}Tip`];
        if (typeof tip !== "string" || HELD_BY_CODE.has(key) || isBoundedKey(key) || !hasWideTrack(key, range)) continue;
        const ceiling = (MEMORY_CEILINGS as Record<string, number | undefined>)[key];
        if (ceiling !== undefined && ceiling <= range.max) continue; // (a true ceiling: the run stops where the slider does)
        const [lo, hi] = [escape(number(range.min, locale)), escape(number(range.max, locale))];
        const span = new RegExp(`(?<![\\d,.])${lo}\\s*×?\\s*(–|-|to|do|a|and|i|y)\\s*${hi}(?![\\d,])`);
        const upTo = new RegExp(`(up to|at most|do|najwyżej|hasta|como mucho)\\s+${hi}(?![\\d,])`, "i");
        if ((span.test(tip) || upTo.test(tip)) && !SLIDER[locale].test(tip)) offenders.push(`${locale} ${key}Tip: ${tip.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("states a held range only while its code holds it: the beat drop planner flies an obstruction in at most a beat early", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const plan = (anticipation: number) => {
      seed = 7;
      return [...planBeatDrop({ beats: Array.from({ length: 12 }, (_, i) => 1 + i * 0.5), period: 0.5, kinds: ["plank"], drift: 0.5, scroll: "endless", bounceHeight: 0.24, anticipation, random }).arriveStart];
    };
    expect(plan(3)).toEqual(plan(RANGES.bdAnticipation.max)); // (reword bdAnticipationTip when this cap goes)
    expect(plan(0.6)).not.toEqual(plan(RANGES.bdAnticipation.max));
  });

  it("says the Ball Count past its full-physics balls, a battle of any size and a clip of any length in every locale", () => {
    const tips = (key: string) => (Object.keys(CATALOGS) as Locale[]).map((locale) => (CATALOGS[locale].Controls as Record<string, string>)[key]);
    // a Ball Count past the team balls adds light crowd balls (uncapConfigOf in lib/physics/limits.ts), not a cap at six
    expect(tips("ballCountTip").map((tip) => /light crowd|lekkiego tłumu|multitud ligera/.test(tip))).toEqual([true, true, true]);
    const battle = (Object.keys(CATALOGS) as Locale[]).map((locale) => CATALOGS[locale].Modes.battle.description);
    expect(battle.filter((text) => /twenty|dwudziestu|veinte|\b20\b/i.test(text))).toEqual([]); // (btCount has no maximum)
    // a clip's length: 10 to 120 s on the slider, shorter (its meaningful floor) or longer when typed
    for (const text of (Object.keys(CATALOGS) as Locale[]).flatMap((locale) => [CATALOGS[locale].FAQ.q2.answer, CATALOGS[locale].Press.facts.exportValue])) expect([text, /(from|od|de) 10 (to|do|a) 120 (seconds|sekund|segundos)\./.test(text)]).toEqual([text, false]);
    expect(MEANINGFUL_FLOORS.recordingDuration).toEqual({ min: 0, above: true });
  });

  // --- unlimited-sizes --- (review fix) a typed Hits per Pane of 7 or more never thickens: stageHp() stops at 7 or the setting
  it("says the glass thickens every other stage only up to 7 or a higher typed number, as each stage's panes do", () => {
    expect([5, 6, 7, 10].map((hp) => [0, 2, 4, 8].map((stage) => stageHp(hp, stage)))).toEqual([
      [5, 6, 7, 7],
      [6, 7, 7, 7],
      [7, 7, 7, 7],
      [10, 10, 10, 10],
    ]);
    const qualifier: Record<Locale, string> = { en: `up to ${MAX_PANE_HP} or a higher typed number`, pl: `aż do ${MAX_PANE_HP} albo wyższej wpisanej liczby`, es: `hasta ${MAX_PANE_HP} o hasta un número escrito mayor` };
    for (const locale of Object.keys(CATALOGS) as Locale[]) {
      const tip = (CATALOGS[locale].Controls as Record<string, string>).glassHpTip;
      expect([locale, tip.includes(qualifier[locale])]).toEqual([locale, true]);
    }
  });

  // --- unlimited-sizes --- (review fix) the Battle card names the squares a run builds (256: ARENA FULL past it), on the squares
  it("names a true count of squares on the Battle card, the count on the squares in every locale, as the style guide shows it", () => {
    const n = MEMORY_CEILINGS.btCount;
    expect(resolveBattleSettings({ count: 1000 }).count).toBe(n);
    const cards = { en: `${n} squares`, pl: `${n} kwadratów`, es: `${n} cuadrados` } as const;
    for (const locale of Object.keys(CATALOGS) as Locale[]) {
      const card = CATALOGS[locale].Modes.battle.description;
      expect([locale, card.includes(cards[locale]), card.match(/\d+/g)?.map(Number)]).toEqual([locale, true, [n]]);
      expect([locale, /as many as you like|ile tylko zechcesz|tantos como quieras/i.test(card)]).toEqual([locale, false]);
    }
    expect(fs.readFileSync(path.join(__dirname, "..", "docs", "COPY-STYLE.md"), "utf8")).toContain(`| Modes.battle.description: ${en.Modes.battle.description} |`);
  });
});
