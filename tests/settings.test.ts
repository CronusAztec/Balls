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

  it("merges old presets over current defaults", () => {
    const s = presetToSettings({ mode: "grow", gravity: 50 });
    expect(s.mode).toBe("grow");
    expect(s.gravity).toBe(50);
    expect(s.cinematicEnabled).toBe(true);
  });
});
