import { describe, expect, it } from "vitest";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

describe("settings serialisation", () => {
  it("round-trips through URL parameters", () => {
    const s = { ...defaultSettings("shatter"), gravity: 800, showGlow: true, wallBreakStyle: "all" as const, topText: "Will it escape?" };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("shatter");
    expect(params.get("g")).toBe("800");
    const back = settingsFromSearchParams(params);
    expect(back).toEqual(s);
  });

  it("falls back to defaults for unknown modes and bad values", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=nope&g=abc&wbreak=explode"));
    expect(s.mode).toBe("classic");
    expect(s.gravity).toBe(300);
    expect(s.wallBreakStyle).toBe("confetti");
  });

  it("round-trips the music settings through their short URL keys", () => {
    const s = { ...defaultSettings("classic"), instrument: "marimba" as const, scale: "minor" as const, rootNote: 9, quantizeToBeat: true, bpm: 140, quantizeGrid: "1/16" as const };
    const params = settingsToSearchParams(s);
    expect(params.get("inst")).toBe("marimba");
    expect(params.get("scale")).toBe("minor");
    expect(params.get("root")).toBe("9");
    expect(params.get("qz")).toBe("1");
    expect(params.get("bpm")).toBe("140");
    expect(params.get("grid")).toBe("1/16");
    expect(settingsFromSearchParams(params)).toEqual(s);
    // Defaults are not written to the URL, so old links stay short
    const defaults = settingsToSearchParams(defaultSettings("classic"));
    for (const key of ["inst", "scale", "root", "qz", "bpm", "grid"]) expect(defaults.has(key)).toBe(false);
  });

  it("rejects unknown instruments, scales, grids and out-of-range root/BPM", () => {
    const s = settingsFromSearchParams(new URLSearchParams("inst=organ&scale=dorian&grid=1%2F3&root=14&bpm=999&qz=1"));
    expect(s.instrument).toBe("triangle");
    expect(s.scale).toBe("chromatic");
    expect(s.quantizeGrid).toBe("1/8");
    expect(s.rootNote).toBe(0);
    expect(s.bpm).toBe(120);
    expect(s.quantizeToBeat).toBe(true);
  });

  it("keeps the default sound identical to the classic tone", () => {
    const d = defaultSettings("shatter");
    expect(d.instrument).toBe("triangle");
    expect(d.scale).toBe("chromatic");
    expect(d.quantizeToBeat).toBe(false);
  });

  it("merges old presets over current defaults", () => {
    const s = presetToSettings({ mode: "grow", gravity: 50 });
    expect(s.mode).toBe("grow");
    expect(s.gravity).toBe(50);
    expect(s.cinematicEnabled).toBe(true);
    expect(s.instrument).toBe("triangle");
    expect(s.bpm).toBe(120);
  });
});
