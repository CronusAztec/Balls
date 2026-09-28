import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS_EXTRAS, physicsExtrasOf } from "@/lib/physics/extras";
import { MODE_IDS } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";

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
    const s = { ...defaultSettings("classic"), instrument: "marimba" as const, melodyInstrument: "pluck" as const, scale: "minor" as const, rootNote: 9, quantizeToBeat: true, bpm: 140, quantizeGrid: "1/16" as const };
    const params = settingsToSearchParams(s);
    expect(params.get("inst")).toBe("marimba");
    expect(params.get("minst")).toBe("pluck");
    expect(params.get("scale")).toBe("minor");
    expect(params.get("root")).toBe("9");
    expect(params.get("qz")).toBe("1");
    expect(params.get("bpm")).toBe("140");
    expect(params.get("grid")).toBe("1/16");
    expect(settingsFromSearchParams(params)).toEqual(s);
    // Defaults are not written to the URL, so old links stay short
    const defaults = settingsToSearchParams(defaultSettings("classic"));
    for (const key of ["inst", "minst", "scale", "root", "qz", "bpm", "grid"]) expect(defaults.has(key)).toBe(false);
  });

  it("rejects unknown instruments, scales, grids and out-of-range root/BPM", () => {
    const s = settingsFromSearchParams(new URLSearchParams("inst=organ&minst=kazoo&scale=dorian&grid=1%2F3&root=14&bpm=999&qz=1"));
    expect(s.instrument).toBe("triangle");
    expect(s.melodyInstrument).toBe("sine");
    expect(s.scale).toBe("chromatic");
    expect(s.quantizeGrid).toBe("1/8");
    expect(s.rootNote).toBe(0);
    expect(s.bpm).toBe(120);
    expect(s.quantizeToBeat).toBe(true);
  });

  it("keeps the default sound identical to the classic tone", () => {
    const d = defaultSettings("shatter");
    expect(d.instrument).toBe("triangle");
    expect(d.melodyInstrument).toBe("sine");
    expect(d.scale).toBe("chromatic");
    expect(d.quantizeToBeat).toBe(false);
    expect(d.hitSoundMode).toBe("tones");
    expect(d.sliceSong).toBe(false);
  });

  it("validates the sound fields of a preset: unknown values fall back, numbers are clamped", () => {
    const bad = {
      mode: "classic",
      instrument: "organ",
      melodyInstrument: "kazoo",
      scale: "dorian",
      quantizeGrid: "1/3",
      quantizeToBeat: "yes",
      rootNote: 14,
      bpm: 999,
      sliceMs: 5,
      sliceFadeMs: 999,
      hitSoundMode: "loud",
    } as unknown as Partial<SimulatorSettings>;
    const s = presetToSettings(bad);
    expect(s.instrument).toBe("triangle");
    expect(s.melodyInstrument).toBe("sine");
    expect(s.scale).toBe("chromatic");
    expect(s.quantizeGrid).toBe("1/8");
    expect(s.quantizeToBeat).toBe(false);
    expect(s.rootNote).toBe(0);
    expect(s.bpm).toBe(200);
    expect(s.sliceMs).toBe(80);
    expect(s.sliceFadeMs).toBe(50);
    expect(s.hitSoundMode).toBe("tones");
    const good = presetToSettings({ mode: "portal", instrument: "chip", melodyInstrument: "marimba", scale: "blues", quantizeGrid: "1/16", quantizeToBeat: true, rootNote: 7, bpm: 90 });
    expect(good).toMatchObject({ instrument: "chip", melodyInstrument: "marimba", scale: "blues", quantizeGrid: "1/16", quantizeToBeat: true, rootNote: 7, bpm: 90 });
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

describe("physics extras settings", () => {
  const EXTRA_URL_KEYS = ["drag", "wx", "wy", "spin", "wb", "bw", "bws", "rg"];

  it("are off by default in every mode", () => {
    for (const mode of MODE_IDS) expect(physicsExtrasOf(defaultSettings(mode))).toEqual(DEFAULT_PHYSICS_EXTRAS);
    const params = settingsToSearchParams(defaultSettings("classic"));
    for (const key of EXTRA_URL_KEYS) expect(params.has(key)).toBe(false);
  });

  it("round-trip through their short URL keys, including three-decimal drag values", () => {
    const s = { ...defaultSettings("shatter"), airDrag: 0.005, windX: -0.25, windY: 0.1, spinStrength: 0.75, wallBounciness: 1.15, breathingAmplitude: 0.12, breathingSpeed: 2.5, rotatingGravity: 45 };
    const params = settingsToSearchParams(s);
    expect(params.get("drag")).toBe("0.005");
    expect(params.get("wx")).toBe("-0.25");
    expect(params.get("wy")).toBe("0.1");
    expect(params.get("spin")).toBe("0.75");
    expect(params.get("wb")).toBe("1.15");
    expect(params.get("bw")).toBe("0.12");
    expect(params.get("bws")).toBe("2.5");
    expect(params.get("rg")).toBe("45");
    expect(settingsFromSearchParams(params)).toEqual(s);
    // Existing two-decimal values still serialise the same way
    expect(settingsToSearchParams({ ...defaultSettings("classic"), gapSize: 0.35, trailThickness: 1.2 }).toString()).toBe("mode=classic&gap=0.35&tt=1.2");
  });

  it("are clamped to their ranges from URLs and presets, falling back to off", () => {
    const s = settingsFromSearchParams(new URLSearchParams("drag=9&wx=-3&spin=abc&wb=0.1&bw=1&bws=0&rg=720"));
    expect(s.airDrag).toBe(0.05);
    expect(s.windX).toBe(-0.5);
    expect(s.spinStrength).toBe(0);
    expect(s.wallBounciness).toBe(0.5);
    expect(s.breathingAmplitude).toBe(0.3);
    expect(s.breathingSpeed).toBe(0.1);
    expect(s.rotatingGravity).toBe(180);
    const p = presetToSettings({ mode: "classic", airDrag: -1, windY: 2, rotatingGravity: "sideways" } as unknown as Partial<SimulatorSettings>);
    expect(p.airDrag).toBe(0);
    expect(p.windY).toBe(0.5);
    expect(p.rotatingGravity).toBe(0);
    expect(p.wallBounciness).toBe(1);
    expect(presetToSettings({ mode: "portal", spinStrength: 0.4, breathingAmplitude: 0.2 })).toMatchObject({ spinStrength: 0.4, breathingAmplitude: 0.2, breathingSpeed: 1 });
  });
});
