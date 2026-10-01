import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import path from "path";
import {
  CUSTOM_HIT_SAMPLE_ID,
  DEFAULT_HIT_SAMPLE_ID,
  HIT_SAMPLES,
  HitSampler,
  type HitSampleStatus,
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

  it("transposes the clip to a pitch supplied by the mode (Ball Drop) relative to the innermost-wall tone", () => {
    expect(hitSamplePlaybackRate(0, true, 400)).toBeCloseTo(0.5);
    expect(hitSamplePlaybackRate(5, true, 1600)).toBeCloseTo(2);
    expect(hitSamplePlaybackRate(5, false, 1600)).toBe(1);
    expect(hitSamplePlaybackRate(5, true, 0)).toBe(hitSamplePlaybackRate(5, true));
    expect(hitSamplePlaybackRate(5, true, undefined)).toBe(hitSamplePlaybackRate(5, true));
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
    expect(back.hitSampleVolume).toBe(7); // --- uncap-all --- (hsv=7 kept)
  });

  it("fall back to the default clip when a preset refers to an upload that is gone", () => {
    const s = presetToSettings({ mode: "classic", hitSoundMode: "sample", hitSampleId: CUSTOM_HIT_SAMPLE_ID, hitSampleVolume: 2 });
    expect(s.hitSoundMode).toBe("sample");
    expect(s.hitSampleId).toBe(DEFAULT_HIT_SAMPLE_ID);
    expect(s.hitSampleVolume).toBe(2); // --- uncap-all --- (kept)
    const old = presetToSettings({ mode: "grow", gravity: 50 });
    expect(old.hitSoundMode).toBe("tones");
    expect(old.hitSampleId).toBe(DEFAULT_HIT_SAMPLE_ID);
  });
});

/** Just enough of an AudioContext for HitSampler.load(): decoding is the only thing it touches. */
function fakeContext(decode: (data: ArrayBuffer) => Promise<unknown>) {
  return { currentTime: 0, decodeAudioData: decode } as unknown as AudioContext;
}
const okFetch = (bytes = 8) => async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(bytes) });

describe("HitSampler decode status", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports loading then ready for a clip that decodes", async () => {
    vi.stubGlobal("fetch", okFetch());
    const sampler = new HitSampler(fakeContext(async () => ({ duration: 0.5 })), {} as AudioNode);
    const seen: HitSampleStatus[] = [];
    sampler.setStatusListener((s) => seen.push(s));
    expect(sampler.getStatus()).toBe("idle");
    await sampler.load("/hitSounds/click.wav");
    expect(seen).toEqual(["loading", "ready"]);
    expect(sampler.isReady()).toBe(true);
    expect(sampler.getLoadedUrl()).toBe("/hitSounds/click.wav");
  });

  it("reports an error (never a silent fallback) when the clip cannot be decoded or fetched", async () => {
    vi.stubGlobal("fetch", okFetch());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = new HitSampler(
      fakeContext(async () => {
        throw new Error("EncodingError");
      }),
      {} as AudioNode,
    );
    const seen: HitSampleStatus[] = [];
    broken.setStatusListener((s) => seen.push(s));
    await broken.load("blob:bogus");
    expect(seen).toEqual(["loading", "error"]);
    expect(broken.getStatus()).toBe("error");
    expect(broken.isReady()).toBe(false);
    expect(broken.getLoadedUrl()).toBeNull();

    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    const missing = new HitSampler(fakeContext(async () => ({ duration: 1 })), {} as AudioNode);
    await missing.load("/hitSounds/missing.wav");
    expect(missing.getStatus()).toBe("error");
    warn.mockRestore();
  });

  it("only reports the clip that was asked for last and serves repeats from the cache", async () => {
    let resolveSlow!: (buffer: unknown) => void;
    const slow = new Promise<unknown>((resolve) => (resolveSlow = resolve));
    vi.stubGlobal("fetch", async (url: string) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(url === "slow" ? 1 : 2) }));
    const sampler = new HitSampler(
      fakeContext((data) => (data.byteLength === 1 ? slow : Promise.resolve({ duration: 1 }))),
      {} as AudioNode,
    );
    const seen: HitSampleStatus[] = [];
    sampler.setStatusListener((s) => seen.push(s));
    const first = sampler.load("slow");
    const second = sampler.load("fast");
    await second;
    expect(sampler.getLoadedUrl()).toBe("fast");
    resolveSlow({ duration: 2 });
    await first;
    expect(sampler.getLoadedUrl()).toBe("fast"); // the stale decode did not override the newer clip
    expect(seen).toEqual(["loading", "ready"]);
    await sampler.load(null);
    expect(sampler.getStatus()).toBe("idle");
    expect(sampler.isReady()).toBe(false);
    await sampler.load("fast");
    expect(seen.at(-1)).toBe("ready"); // straight from the cache, no "loading" in between
    expect(seen.filter((s) => s === "loading")).toHaveLength(1);
  });
});
