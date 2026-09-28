import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import path from "path";
import {
  CUSTOM_HIT_SAMPLE_ID,
  DEFAULT_HIT_SAMPLE_ID,
  HIT_SAMPLES,
  builtInHitSampleUrl,
  hitSamplePlaybackRate,
  isHitSoundMode,
  normalizeHitSampleId,
  resolveHitSoundSource,
  wallHitFrequency,
} from "@/lib/audio/sampler";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

describe("hit sample playback-rate mapping", () => {
  it("follows the bounce-tone curve: native pitch on the innermost wall, lower outside", () => {
    expect(wallHitFrequency(0)).toBe(800);
    expect(wallHitFrequency(1)).toBe(720);
    expect(wallHitFrequency(6)).toBe(320);
    expect(wallHitFrequency(7)).toBe(300);
    expect(wallHitFrequency(40)).toBe(300);
    expect(hitSamplePlaybackRate(0, true)).toBe(1);
    expect(hitSamplePlaybackRate(1, true)).toBeCloseTo(0.9);
    expect(hitSamplePlaybackRate(5, true)).toBeCloseTo(0.5);
    expect(hitSamplePlaybackRate(20, true)).toBeCloseTo(0.375);
  });

  it("is monotonically non-increasing across walls and never leaves (0, 1]", () => {
    let prev = Infinity;
    for (let i = 0; i < 25; i++) {
      const rate = hitSamplePlaybackRate(i, true);
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(1);
      expect(rate).toBeLessThanOrEqual(prev);
      prev = rate;
    }
  });

  it("plays every wall at the recorded pitch when pitch-by-wall is off", () => {
    for (const i of [0, 3, 9, 19]) expect(hitSamplePlaybackRate(i, false)).toBe(1);
  });

  it("tolerates odd wall indices", () => {
    expect(hitSamplePlaybackRate(-3, true)).toBe(1);
    expect(hitSamplePlaybackRate(2.7, true)).toBe(hitSamplePlaybackRate(2, true));
  });
});

describe("hit sound dispatch", () => {
  it("uses the sample only in sample mode once the clip is decoded", () => {
    expect(resolveHitSoundSource("sample", true)).toBe("sample");
    expect(resolveHitSoundSource("sample", false)).toBe("tones");
    expect(resolveHitSoundSource("tones", true)).toBe("tones");
    expect(resolveHitSoundSource("tones", false)).toBe("tones");
  });

  it("recognises the two modes and nothing else", () => {
    expect(isHitSoundMode("tones")).toBe(true);
    expect(isHitSoundMode("sample")).toBe(true);
    expect(isHitSoundMode("melody")).toBe(false);
    expect(isHitSoundMode(null)).toBe(false);
    expect(isHitSoundMode(1)).toBe(false);
  });
});

describe("built-in hit samples", () => {
  it("ships three generated clips under public/hitSounds", () => {
    expect(HIT_SAMPLES.map((s) => s.id)).toEqual(["click", "pluck", "kick"]);
    for (const sample of HIT_SAMPLES) {
      expect(sample.url.endsWith(`/hitSounds/${sample.id}.wav`)).toBe(true);
      expect(existsSync(path.join(process.cwd(), "public", "hitSounds", `${sample.id}.wav`)), sample.id).toBe(true);
    }
  });

  it("normalises ids: built-ins pass, custom only when allowed, unknown falls back", () => {
    expect(normalizeHitSampleId("kick")).toBe("kick");
    expect(normalizeHitSampleId(CUSTOM_HIT_SAMPLE_ID)).toBe(DEFAULT_HIT_SAMPLE_ID);
    expect(normalizeHitSampleId(CUSTOM_HIT_SAMPLE_ID, true)).toBe(CUSTOM_HIT_SAMPLE_ID);
    expect(normalizeHitSampleId("nope")).toBe(DEFAULT_HIT_SAMPLE_ID);
    expect(normalizeHitSampleId(undefined)).toBe(DEFAULT_HIT_SAMPLE_ID);
    expect(builtInHitSampleUrl("pluck")).toBe(HIT_SAMPLES[1].url);
    expect(builtInHitSampleUrl(CUSTOM_HIT_SAMPLE_ID)).toBeNull();
  });
});

describe("hit sample settings", () => {
  it("default to synthesised tones with the first built-in clip ready", () => {
    const d = defaultSettings("classic");
    expect(d.hitSoundMode).toBe("tones");
    expect(d.hitSampleId).toBe(DEFAULT_HIT_SAMPLE_ID);
    expect(d.hitSamplePitchByWall).toBe(true);
    expect(d.hitSampleVolume).toBeGreaterThan(0);
    expect(d.hitSampleVolume).toBeLessThanOrEqual(1);
  });

  it("round-trip through the URL with short keys", () => {
    const s = { ...defaultSettings("portal"), hitSoundMode: "sample" as const, hitSampleId: "kick", hitSamplePitchByWall: false, hitSampleVolume: 0.45 };
    const params = settingsToSearchParams(s);
    expect(params.get("hsm")).toBe("sample");
    expect(params.get("hs")).toBe("kick");
    expect(params.get("hspw")).toBe("0");
    expect(params.get("hsv")).toBe("0.45");
    expect(settingsFromSearchParams(params)).toEqual(s);
  });

  it("never put an in-memory upload into a share link and reject bad URL values", () => {
    const params = settingsToSearchParams({ ...defaultSettings("classic"), hitSoundMode: "sample", hitSampleId: CUSTOM_HIT_SAMPLE_ID });
    expect(params.get("hsm")).toBe("sample");
    expect(params.has("hs")).toBe(false);
    const back = settingsFromSearchParams(new URLSearchParams("mode=classic&hsm=loud&hs=custom&hsv=7"));
    expect(back.hitSoundMode).toBe("tones");
    expect(back.hitSampleId).toBe(DEFAULT_HIT_SAMPLE_ID);
    expect(back.hitSampleVolume).toBe(1);
  });

  it("fall back to the default clip when a preset refers to an upload that is gone", () => {
    const s = presetToSettings({ mode: "classic", hitSoundMode: "sample", hitSampleId: CUSTOM_HIT_SAMPLE_ID, hitSampleVolume: 2 });
    expect(s.hitSoundMode).toBe("sample");
    expect(s.hitSampleId).toBe(DEFAULT_HIT_SAMPLE_ID);
    expect(s.hitSampleVolume).toBe(1);
    const old = presetToSettings({ mode: "grow", gravity: 50 });
    expect(old.hitSoundMode).toBe("tones");
    expect(old.hitSampleId).toBe(DEFAULT_HIT_SAMPLE_ID);
  });
});
