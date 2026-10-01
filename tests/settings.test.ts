import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS_EXTRAS, physicsExtrasOf } from "@/lib/physics/extras";
import { DEFAULT_BALL_INTERACTION, ballInteractionOf } from "@/lib/physics/interactions";
import { MODE_IDS } from "@/lib/physics/types";
import { RANGES, defaultSettings, presetToSettings, resolutionToSize, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { SIGNED_KEYS } from "@/lib/uncap"; // --- uncap-all ---

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

  it("rejects unknown instruments, scales and grids, and keeps a root / BPM past the slider (--- uncap-all ---)", () => {
    const s = settingsFromSearchParams(new URLSearchParams("inst=organ&minst=kazoo&scale=dorian&grid=1%2F3&root=14&bpm=999&qz=1"));
    expect(s.instrument).toBe("triangle");
    expect(s.melodyInstrument).toBe("sine");
    expect(s.scale).toBe("chromatic");
    expect(s.quantizeGrid).toBe("1/8");
    expect(s.rootNote).toBe(14);
    expect(s.bpm).toBe(999);
    expect(settingsFromSearchParams(new URLSearchParams("root=-3&bpm=abc"))).toMatchObject({ rootNote: 0, bpm: 120 });
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
    // --- uncap-all --- numbers past their sliders are kept; below the minimum they are lifted onto it
    expect(s.rootNote).toBe(14);
    expect(s.bpm).toBe(999);
    expect(s.sliceMs).toBe(80);
    expect(s.sliceFadeMs).toBe(999);
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

  it("are kept past their sliders (--- uncap-all ---), lifted onto the minimum below it and fall back to off when invalid", () => {
    const s = settingsFromSearchParams(new URLSearchParams("drag=9&wx=-3&spin=abc&wb=0.1&bw=1&bws=0&rg=720"));
    expect(s.airDrag).toBe(9);
    expect(s.windX).toBe(-3);
    expect(s.spinStrength).toBe(0);
    expect(s.wallBounciness).toBe(0.5);
    expect(s.breathingAmplitude).toBe(1);
    expect(s.breathingSpeed).toBe(0.1);
    expect(s.rotatingGravity).toBe(720);
    const p = presetToSettings({ mode: "classic", airDrag: -1, windY: 2, rotatingGravity: "sideways" } as unknown as Partial<SimulatorSettings>);
    expect(p.airDrag).toBe(0);
    expect(p.windY).toBe(2);
    expect(p.rotatingGravity).toBe(0);
    expect(p.wallBounciness).toBe(1);
    expect(presetToSettings({ mode: "portal", spinStrength: 0.4, breathingAmplitude: 0.2 })).toMatchObject({ spinStrength: 0.4, breathingAmplitude: 0.2, breathingSpeed: 1 });
  });
});

describe("ball interaction settings", () => {
  it("default to bounce in every mode and stay out of the URL", () => {
    for (const mode of MODE_IDS) expect(ballInteractionOf(defaultSettings(mode))).toEqual(DEFAULT_BALL_INTERACTION);
    const params = settingsToSearchParams(defaultSettings("multiply"));
    for (const key of ["bi", "smr", "mb"]) expect(params.has(key)).toBe(false);
  });

  it("round-trip through bi / smr / mb", () => {
    const s = { ...defaultSettings("classic"), ballInteraction: "split" as const, splitMinRadius: 6, maxBalls: 12 };
    const params = settingsToSearchParams(s);
    expect(params.get("bi")).toBe("split");
    expect(params.get("smr")).toBe("6");
    expect(params.get("mb")).toBe("12");
    expect(settingsFromSearchParams(params)).toEqual(s);
    expect(settingsToSearchParams({ ...defaultSettings("classic"), ballInteraction: "merge" }).toString()).toBe("mode=classic&bi=merge");
  });

  it("reject unknown interactions and keep the split limits whole numbers from their minimum up (--- uncap-all --- no maximum), from URLs and presets", () => {
    const s = settingsFromSearchParams(new URLSearchParams("bi=explode&smr=99&mb=0"));
    expect(s.ballInteraction).toBe("bounce");
    expect(s.splitMinRadius).toBe(99);
    expect(s.maxBalls).toBe(2);
    expect(settingsFromSearchParams(new URLSearchParams("bi=pass&smr=abc&mb=7.6"))).toMatchObject({ ballInteraction: "pass", splitMinRadius: 4, maxBalls: 8 });
    const p = presetToSettings({ mode: "multiply", ballInteraction: "merge", maxBalls: 100, splitMinRadius: -3 } as unknown as Partial<SimulatorSettings>);
    expect(p).toMatchObject({ ballInteraction: "merge", maxBalls: 100, splitMinRadius: 4 });
    expect(presetToSettings({ mode: "classic", ballInteraction: 3 } as unknown as Partial<SimulatorSettings>).ballInteraction).toBe("bounce");
    expect(presetToSettings({ mode: "grow" })).toMatchObject(DEFAULT_BALL_INTERACTION);
  });
});

// --- review fix (recording-export) --- numbers, enumerations and texts from links, share codes, batch lists, presets and project files
describe("link and preset validation (review fix: recording-export)", () => {
  const CORE: Record<string, keyof SimulatorSettings> = { g: "gravity", s: "ballSpeed", r: "ballRadius", wc: "wallCount", wt: "wallThickness", gap: "gapSize", rs: "rotationSpeed", tt: "trailThickness", at: "accumulationTime", sc: "spikeCount", msc: "multiplySpawnCount", tc: "targetCount", cmc: "colorMatchColorCount", gr: "growRate", ts: "textSize", slms: "sliceMs", slfade: "sliceFadeMs" };
  const rangeOf = (field: string) => (RANGES as unknown as Record<string, { min: number; max: number; step: number } | undefined>)[field];

  it("lifts a number below its slider's minimum onto it and keeps a big one (no crash on r=-5, no cap on wc)", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=classic&r=-5&wc=5000"));
    expect(s.ballRadius).toBe(4);
    expect(s.wallCount).toBe(5000);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&wc=0")).wallCount).toBe(1);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&g=-900")).gravity).toBe(0);
  });

  it("falls back to the default for a value that is not a number, rounds counts", () => {
    const d = defaultSettings("classic");
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&r=abc")).ballRadius).toBe(d.ballRadius);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&r=")).ballRadius).toBe(d.ballRadius);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&wc=Infinity")).wallCount).toBe(d.wallCount);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&wc=3.7")).wallCount).toBe(4);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&gap=0.37")).gapSize).toBeCloseTo(0.37);
  });

  it("keeps every core number at or above its minimum and never caps it (--- uncap-all --- the gap, colours, text size and slicer too)", () => {
    for (const [key, field] of Object.entries(CORE)) {
      const range = rangeOf(field)!;
      expect(range, field).toBeDefined();
      const low = settingsFromSearchParams(new URLSearchParams(`mode=classic&${key}=${range.min - 1e6}`))[field] as number;
      expect(low, `${key}=min-1e6`).toBe(range.min);
      const high = settingsFromSearchParams(new URLSearchParams(`mode=classic&${key}=${range.max + 1e6}`))[field] as number;
      expect(Number.isFinite(high), `${key}=max+1e6`).toBe(true);
      expect(high, `${key}=max+1e6`).toBe(range.max + 1e6);
    }
  });

  it("presetToSettings treats every core number like a link does (min-1e6 lifted, max+1e6 kept: --- uncap-all --- no maximum)", () => {
    for (const field of Object.values(CORE)) {
      const range = rangeOf(field)!;
      const low = presetToSettings({ mode: "classic", [field]: range.min - 1e6 } as Partial<SimulatorSettings>);
      expect(low[field], `preset ${field}=min-1e6`).toBe(range.min);
      const high = presetToSettings({ mode: "classic", [field]: range.max + 1e6 } as Partial<SimulatorSettings>);
      expect(high[field], `preset ${field}=max+1e6`).toBe(range.max + 1e6);
    }
  });

  it("no numeric link key with a slider range comes back below its minimum (the features' own checks included; --- uncap-all --- signed settings go past both ends)", () => {
    // Every numeric key the writer emits: each numeric field of the defaults nudged off its default and written out.
    const base = defaultSettings("classic");
    const numeric = Object.keys(base).filter((k) => typeof (base as unknown as Record<string, unknown>)[k] === "number" && rangeOf(k));
    const keyOf = new Map<string, string>();
    for (const field of numeric) {
      const probe = { ...base, [field]: (base as unknown as Record<string, number>)[field] + rangeOf(field)!.step } as SimulatorSettings;
      const before = new Set(settingsToSearchParams(base).keys());
      const added = [...settingsToSearchParams(probe).keys()].filter((k) => !before.has(k));
      if (added.length === 1) keyOf.set(field, added[0]);
    }
    for (const field of Object.values(CORE)) expect(keyOf.get(field), field).toBeDefined();
    for (const [field, key] of keyOf) {
      if (SIGNED_KEYS.has(field)) continue; // --- uncap-all --- (wind the other way, a pendulum started past half a turn, any seed)
      const range = rangeOf(field)!;
      const value = (settingsFromSearchParams(new URLSearchParams(`mode=classic&${key}=${range.min - 1e6}`)) as unknown as Record<string, number>)[field];
      expect(Number.isFinite(value) && value >= range.min, `${key} (${field}) = ${value}`).toBe(true);
    }
  });

  it("presetToSettings checks the core numbers too", () => {
    const d = defaultSettings("classic");
    const p = presetToSettings({ mode: "classic", ballRadius: -5, wallCount: 5000, gapSize: NaN } as Partial<SimulatorSettings>);
    expect(p.ballRadius).toBe(4);
    expect(p.wallCount).toBe(5000);
    expect(p.gapSize).toBe(d.gapSize);
    expect(presetToSettings({ mode: "classic", gravity: "700" } as unknown as Partial<SimulatorSettings>).gravity).toBe(d.gravity);
    expect(presetToSettings({ mode: "classic", wallCount: 3.7 }).wallCount).toBe(4);
  });

  it("presetToSettings rejects an unknown resolution, wall-break style and rainbow mode and caps the texts at a link's 60 characters", () => {
    const p = presetToSettings({ mode: "classic", recordingResolution: "20000x20000", wallBreakStyle: "bogus", rainbowWallMode: "bogus", topText: "x".repeat(300), bottomText: "y".repeat(70), watermarkText: "z".repeat(61) } as unknown as Partial<SimulatorSettings>);
    expect(p.recordingResolution).toBe("1080x1920");
    expect(p.wallBreakStyle).toBe("confetti");
    expect(p.rainbowWallMode).toBe("gradient");
    expect(p.topText).toHaveLength(60);
    expect(p.bottomText).toHaveLength(60);
    expect(p.watermarkText).toHaveLength(60);
    const ok = presetToSettings({ mode: "classic", recordingResolution: "500x500", wallBreakStyle: "all", rainbowWallMode: "pulse", topText: "Will it escape?" });
    expect(ok).toMatchObject({ recordingResolution: "500x500", wallBreakStyle: "all", rainbowWallMode: "pulse", topText: "Will it escape?" });
    // A share link made from the loaded settings carries the texts whole.
    const back = settingsFromSearchParams(settingsToSearchParams(p));
    expect(back.topText).toBe(p.topText);
    expect(back.watermarkText).toBe(p.watermarkText);
  });

  it("resolutionToSize gives 1080x1920 for anything but a known resolution", () => {
    expect(resolutionToSize("20000x20000")).toEqual({ width: 1080, height: 1920 });
    expect(resolutionToSize("bogus")).toEqual({ width: 1080, height: 1920 });
    expect(resolutionToSize("500x500")).toEqual({ width: 500, height: 500 });
    expect(resolutionToSize("1920x1080")).toEqual({ width: 1920, height: 1080 });
  });

  it("a pre-rename preset's default watermark (viralballs.com) becomes today's default; a custom one stays", () => {
    const p = presetToSettings({ mode: "shatter", gravity: 700, watermarkText: "viralballs.com" });
    expect(p.watermarkText).toBe(defaultSettings("shatter").watermarkText);
    expect(settingsToSearchParams(p).has("wm")).toBe(false);
    expect(settingsToSearchParams(p).get("g")).toBe("700");
    expect(presetToSettings({ mode: "shatter", watermarkText: " ViralBalls.com " }).watermarkText).toBe("");
    expect(presetToSettings({ mode: "shatter", watermarkText: "@me" }).watermarkText).toBe("@me");
    expect(presetToSettings({ mode: "shatter", watermarkText: "" }).watermarkText).toBe("");
    expect(presetToSettings({ mode: "shatter", watermarkText: 42 } as unknown as Partial<SimulatorSettings>).watermarkText).toBe("");
    // A link keeps what it says (links never carried the old default).
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&wm=viralballs.com")).watermarkText).toBe("viralballs.com");
  });

  // --- review fix (site-static) --- no domain is burned into the clips by default (jumpingballslive.com does not resolve)
  it("clips carry no watermark by default, and a preset saved with the post-rename default (jumpingballslive.com) loads without it", () => {
    for (const mode of ["classic", "shatter", "drop"] as const) expect(defaultSettings(mode).watermarkText).toBe("");
    expect(settingsToSearchParams(defaultSettings("classic")).has("wm")).toBe(false);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic")).watermarkText).toBe("");
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&wm=%40me")).watermarkText).toBe("@me");
    const p = presetToSettings({ mode: "classic", watermarkText: "JumpingBallsLive.com" });
    expect(p.watermarkText).toBe("");
    expect(settingsToSearchParams(p).has("wm")).toBe(false);
    const custom = { ...defaultSettings("classic"), watermarkText: "@me" };
    expect(settingsToSearchParams(custom).get("wm")).toBe("@me");
  });
});
