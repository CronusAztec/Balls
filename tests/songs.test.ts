import { describe, expect, it } from "vitest";
import { WALL_BREAK_SOUNDS, normalizeWallBreakSound } from "@/lib/audio/songs";
import { presetToSettings } from "@/lib/settings";

describe("normalizeWallBreakSound", () => {
  it("keeps null and current built-in URLs", () => {
    expect(normalizeWallBreakSound(null)).toBeNull();
    expect(normalizeWallBreakSound(undefined)).toBeNull();
    expect(normalizeWallBreakSound(WALL_BREAK_SOUNDS[0].url)).toBe(WALL_BREAK_SOUNDS[0].url);
  });

  it("maps a built-in sound saved under another base path to the current URL", () => {
    expect(normalizeWallBreakSound("/old-base/wallBreak/pop.wav")).toBe(WALL_BREAK_SOUNDS.find((s) => s.id === "pop")!.url);
    expect(normalizeWallBreakSound("/wallBreak/chime.wav")).toBe(WALL_BREAK_SOUNDS.find((s) => s.id === "chime")!.url);
  });

  // --- review fix (security-robustness) --- only the built-in clips: a stored preset must not make the page fetch some other address
  it("drops dead blob: URLs from custom uploads, unknown URLs and values that are not strings", () => {
    expect(normalizeWallBreakSound("blob:http://localhost/abc")).toBeNull();
    expect(normalizeWallBreakSound("https://example.com/boom.wav")).toBeNull();
    expect(normalizeWallBreakSound("https://attacker.example/wallBreak/x.wav")).toBeNull();
    expect(normalizeWallBreakSound("")).toBeNull();
    expect(normalizeWallBreakSound(5)).toBeNull();
    expect(normalizeWallBreakSound({ url: WALL_BREAK_SOUNDS[0].url })).toBeNull();
  });

  it("is applied when presets are loaded", () => {
    const settings = presetToSettings({ mode: "classic", wallBreakSound: "/somewhere/wallBreak/pop.wav" });
    expect(settings.wallBreakSound).toBe(WALL_BREAK_SOUNDS.find((s) => s.id === "pop")!.url);
  });
});
