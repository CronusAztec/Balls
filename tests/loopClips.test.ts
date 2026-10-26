import { describe, expect, it } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import { fakeGraph } from "./fakeAudio";
import { CLIP_GAIN_PARAM_MAX, CLIP_GAIN_TOP_DB, LOOP_CLIP_RULES, LOOP_CLIP_SLOTS, LoopClipSlots, clipLevel, clipPlaybackRate, clipWindow, defaultClipOptions, resolveClipOptions } from "@/lib/audio/loopClips";
import LoopClipsSection, { type LoopClipsPanelProps } from "@/components/simulator/sections/LoopClipsSection";
import { UnlimitedProvider } from "@/components/simulator/unlimitedSlider";
import type { Translate } from "@/components/simulator/ControlPrimitives";

/*
 * --- loop-foundation --- The owner's custom clip slots of the loop families (lib/audio/loopClips.ts): the rules of every slot
 * (trims, fades, the longest a clip plays, gain ranges, pitch-follow), and a clip playing in place of the synthesis.
 */

describe("loop clip slots", () => {
  it("has a slot for every family's events with the recipes' rules", () => {
    expect([...LOOP_CLIP_SLOTS]).toEqual(["bounce", "barStrike", "chime", "progressStep", "land", "bed", "impact", "completion", "reset", "drone"]);
    expect(LOOP_CLIP_RULES.bounce).toMatchObject({ maxSec: 1.5, fadeIn: 0.005, fadeOut: 0.02, gainMinDb: -24, gainMaxDb: 6, gainDefaultDb: -6, pitch: "optional" });
    expect(LOOP_CLIP_RULES.barStrike.pitch).toBe("default");
    expect(LOOP_CLIP_RULES.bed).toMatchObject({ loop: true, gainMinDb: -30, gainMaxDb: 0, gainDefaultDb: -12 });
    expect(LOOP_CLIP_RULES.completion.preRoll).toBe(true);
    expect(LOOP_CLIP_RULES.reset).toMatchObject({ fit: true, fadeIn: 0.03, fadeOut: 0.03 });
    expect(defaultClipOptions("barStrike").pitchFollow).toBe(true);
    expect(defaultClipOptions("bounce").pitchFollow).toBe(false);
  });

  it("validates the options: any finite gain (--- unlimited-sizes ---), trims from 0, pitch-follow only where allowed", () => {
    // --- unlimited-sizes --- (review fix) the slot's gain range is its slider's comfort range: +40 dB and −99 dB are kept
    expect(resolveClipOptions("bounce", { gainDb: 40, trimStart: -2, pitchFollow: true })).toMatchObject({ gainDb: 40, trimStart: 0, pitchFollow: true });
    expect(resolveClipOptions("impact", { gainDb: -99, pitchFollow: true })).toMatchObject({ gainDb: -99, pitchFollow: false });
    expect(resolveClipOptions("bed", { gainDb: 12 }).gainDb).toBe(12);
    for (const bad of [Number.NaN, Infinity, -Infinity, "6", null]) expect(resolveClipOptions("drone", { gainDb: bad }).gainDb).toBe(LOOP_CLIP_RULES.drone.gainDefaultDb);
    expect(resolveClipOptions("completion", { preRoll: 0.08 }).preRoll).toBe(0.08);
    expect(resolveClipOptions("bounce", { preRoll: 0.08 }).preRoll).toBe(0);
  });

  it("plays the trimmed window, at most the slot's longest, fitted to a reset", () => {
    const opts = { ...defaultClipOptions("bounce"), trimStart: 0.2, trimEnd: 3 };
    expect(clipWindow("bounce", 4, opts)).toEqual({ offset: 0.2, duration: 1.5, fadeIn: 0.005, fadeOut: 0.02, startShift: 0 });
    expect(clipWindow("reset", 4, defaultClipOptions("reset"), 1)).toMatchObject({ duration: 1, fadeIn: 0.03, fadeOut: 0.03 });
    expect(clipWindow("bounce", 0, opts)).toBeNull();
    expect(clipPlaybackRate(880, 440, true)).toBe(2);
    expect(clipPlaybackRate(880, 440, false)).toBe(1);
    expect(clipPlaybackRate(100000, 440, true)).toBe(8);
  });

  it("plays any gain at its level, held at the gain's float ceiling so the browser never refuses it (--- unlimited-sizes ---)", () => {
    expect(clipLevel(-6)).toBe(Math.pow(10, -6 / 20));
    expect(clipLevel(40, 0.5)).toBe(100 * 0.5);
    expect(clipLevel(-400)).toBeGreaterThan(0);
    expect([clipLevel(1000), clipLevel(7000), clipLevel(20, Infinity)]).toEqual([CLIP_GAIN_PARAM_MAX, CLIP_GAIN_PARAM_MAX, CLIP_GAIN_PARAM_MAX]);
    expect([clipLevel(6, 0), clipLevel(6, -1), clipLevel(6, Number.NaN), clipLevel(Number.NaN)]).toEqual([0, 0, 0, 0]);
    // the ceiling is a float an AudioParam holds, and the panel's wide track ends at its gain (about +770 dB)
    expect(Math.fround(CLIP_GAIN_PARAM_MAX)).toBe(CLIP_GAIN_PARAM_MAX);
    expect(CLIP_GAIN_TOP_DB).toBe(770);
    expect(clipLevel(CLIP_GAIN_TOP_DB)).toBeLessThan(CLIP_GAIN_PARAM_MAX);
    const graph = fakeGraph();
    const slots = new LoopClipSlots();
    const ctx = graph.ctx as unknown as BaseAudioContext;
    const out = graph.ctx.destination as unknown as AudioNode;
    const buffer = graph.ctx.createBuffer(1, 48000, 48000) as unknown as AudioBuffer;
    slots.set("bounce", buffer, "loud.wav", { gainDb: 40 });
    expect(slots.get("bounce")?.options.gainDb).toBe(40);
    expect(slots.play(ctx, out, "bounce", 1)).toBe(true);
    expect(graph.ramps.some((r) => r.kind === "linear" && r.value === 100)).toBe(true);
    slots.setOptions("bounce", { gainDb: 9000 });
    expect(slots.play(ctx, out, "bounce", 2)).toBe(true);
    expect(graph.ramps.some((r) => r.kind === "linear" && r.value === CLIP_GAIN_PARAM_MAX)).toBe(true);
    expect(graph.ramps.every((r) => r.kind === "cancel" || Number.isFinite(r.value))).toBe(true);
  });

  it("starts the clip in place of the synthesis, with its gain and pitch", () => {
    const graph = fakeGraph();
    const slots = new LoopClipSlots();
    const ctx = graph.ctx as unknown as BaseAudioContext;
    const out = graph.ctx.destination as unknown as AudioNode;
    expect(slots.play(ctx, out, "bounce", 1)).toBe(false);
    const buffer = graph.ctx.createBuffer(1, 48000, 48000) as unknown as AudioBuffer;
    slots.set("bounce", buffer, "boing.wav", { pitchFollow: true });
    expect(slots.play(ctx, out, "bounce", 1, { frequency: 880 })).toBe(true);
    expect(graph.sources).toHaveLength(1);
    expect(graph.sources[0].playbackRate).toBe(2);
    expect(graph.sources[0].startArgs[0]).toBe(1);
    expect(graph.ramps.some((r) => r.kind === "linear" && Math.abs(r.value - Math.pow(10, -6 / 20)) < 1e-9)).toBe(true);
    const twin = slots.copy();
    expect(twin.get("bounce")?.name).toBe("boing.wav");
    slots.clear("bounce");
    expect(slots.has("bounce")).toBe(false);
    expect(twin.has("bounce")).toBe(true);
  });
});

describe("loop clip slots in the Sound section (--- unlimited-sizes ---)", () => {
  // The components are compiled with the classic JSX transform here (tsconfig keeps JSX for Next): React must be global.
  (globalThis as { React?: unknown }).React = React;
  const controls = en.Controls as Record<string, string>;
  const t = ((key: string, values?: Record<string, unknown>) => String(new IntlMessageFormat(controls[key] ?? key, "en").format(values as Record<string, string>))) as unknown as Translate;
  const panel = (gainDb: number): LoopClipsPanelProps => ({ clips: [{ slot: "bounce", name: "boing.wav", gainDb }, { slot: "bed", name: "groove.wav", gainDb: 3 }], onLoad: () => {}, onClear: () => {}, onGain: () => {}, failed: null });
  const render = (gainDb: number, wide?: boolean) => {
    const section = createElement(LoopClipsSection, { t, search: "", matches: () => true, panel: panel(gainDb) });
    const child = wide === undefined ? section : createElement(UnlimitedProvider as unknown as React.FC<{ on: boolean }>, { on: wide }, section);
    return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, child));
  };

  it("gives a loaded clip's level a wide track and a number field that hold a gain past the slot's range", () => {
    const html = render(40);
    // the wide track (Wide sliders on by default), ending at the gain's float ceiling, and the number field with the typed gain
    expect(html).toContain('data-unlimited-slider="loopClipGain:bounce"');
    expect(html).toMatch(/data-number-field="loopClipGain:bounce" data-testid="loop-clip-gain-value"/);
    expect(html).toMatch(/data-number-field="loopClipGain:bounce"[^>]*value="40"/);
    // the bed's +3 dB, past its 0 dB comfort end, is shown as typed too, and its track (a range ending at 0 dB) has a real position
    expect(html).toMatch(/data-number-field="loopClipGain:bed"[^>]*value="3"/);
    expect(html.match(/data-testid="loop-clip-gain"/g)).toHaveLength(2);
    expect(html).not.toContain("NaN");
    // with Wide sliders off, the comfort track of the slot's range, the number field all the same
    const off = render(-6, false);
    expect(off).not.toContain("data-unlimited-slider");
    expect(off).toMatch(new RegExp(`type="range" min="${LOOP_CLIP_RULES.bounce.gainMinDb}" max="${LOOP_CLIP_RULES.bounce.gainMaxDb}" step="0.5"[^>]*value="-6"`));
    expect(off).toContain('data-number-field="loopClipGain:bounce"');
  });
});
