import { describe, expect, it } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { LOOP_CLIP_RULES, LOOP_CLIP_SLOTS, LoopClipSlots, clipPlaybackRate, clipWindow, defaultClipOptions, resolveClipOptions } from "@/lib/audio/loopClips";

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

  it("validates the options: gain in range, trims from 0, pitch-follow only where allowed", () => {
    expect(resolveClipOptions("bounce", { gainDb: 40, trimStart: -2, pitchFollow: true })).toMatchObject({ gainDb: 6, trimStart: 0, pitchFollow: true });
    expect(resolveClipOptions("impact", { gainDb: -99, pitchFollow: true })).toMatchObject({ gainDb: -24, pitchFollow: false });
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
