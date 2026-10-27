// --- insights --- The fast export's measured features (src/lib/recording/clipFeatures.ts): the same numbers as the agent
// toolbox's video analyser on the same pixels, the digest untouched, bounded, pure, and never a failed export.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CLIP_END_SLACK_SEC, CLIP_FEATURES_VERSION, ClipFeaturesCollector, type ClipFeatures } from "@/lib/recording/clipFeatures";
import { sampleDigest } from "@/lib/recording/fastRender";
import { DIGEST_EVERY, SIM_FPS, exportDurationSec, exportFrameRange, fnv1a, simFrameTimeMs } from "@/lib/recording/fastRenderPlan";
import { MAX_MOTION_SAMPLES, MOTION_MIN, firstSoundSecOf, loopSeamDiff, pictureFeatures, soundFeatures } from "@/lib/videoAnalysis/features";
import { GENE_FEATURE_KEYS, featureGenes, genesFromSettings, genesOfCut, genesOfSavedFile, sanitizeGenes } from "@/lib/insights/genes";
import { defaultSettings } from "@/lib/settings";

const SIDE = 16;

/** A deterministic generator (the test's own: no Math.random). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A 16 × 16 RGBA thumbnail: a dark backdrop with a light square at `x`, a little noise and opaque alpha. */
function thumb(x: number, rand: () => number, tint: [number, number, number] = [240, 200, 40]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let y = 0; y < SIDE; y++) {
    for (let c = 0; c < SIDE; c++) {
      const i = 4 * (y * SIDE + c);
      const inside = c >= x && c < x + 4 && y >= 6 && y < 10;
      const noise = Math.floor(rand() * 6);
      px[i] = inside ? tint[0] : 12 + noise;
      px[i + 1] = inside ? tint[1] : 14 + noise;
      px[i + 2] = inside ? tint[2] : 30 + noise;
      px[i + 3] = 255;
    }
  }
  return px;
}

/** The analyser's frames: rgb24, as ffmpeg hands them in. */
const rgb24 = (rgba: Uint8ClampedArray) => Uint8Array.from({ length: (rgba.length / 4) * 3 }, (_, k) => rgba[Math.floor(k / 3) * 4 + (k % 3)]);

/** A clip: `still` samples with the square at rest, then it moves one pixel a sample (back and forth). */
function clip(samples: number, still: number, seed = 7): Uint8ClampedArray[] {
  const rand = lcg(seed);
  return Array.from({ length: samples }, (_, k) => {
    const step = Math.max(0, k - still);
    const x = 2 + (step % 20 < 10 ? step % 10 : 10 - (step % 10));
    return thumb(x, rand);
  });
}

function collect(frames: readonly Uint8ClampedArray[], sampleHz: number, end: Partial<Parameters<ClipFeaturesCollector["finish"]>[0]> = {}): ClipFeatures {
  const c = new ClipFeaturesCollector(sampleHz);
  for (const f of frames) c.frame(f);
  const features = c.finish({ durationSec: frames.length / sampleHz, lufs: -20.04, ...end });
  expect(features).not.toBeNull();
  return features as ClipFeatures;
}

describe("clip features: the picture (--- insights ---)", () => {
  it("measures the digest's thumbnails exactly as the video analyser measures the same frames", () => {
    for (const [samples, still, sampleHz] of [
      [40, 6, 4],
      [25, 0, 2],
      [3, 1, 4],
      [MAX_MOTION_SAMPLES, 30, 4],
    ] as const) {
      const frames = clip(samples, still);
      const features = collect(frames, sampleHz);
      const reference = pictureFeatures(frames.map(rgb24), sampleHz);
      expect(features).toMatchObject(reference);
      expect(features.motion).toEqual(reference.motion);
      expect(features.loopSeamDiff).toBe(loopSeamDiff(rgb24(frames[0]), rgb24(frames[frames.length - 1])));
      expect(features.sampleHz).toBe(sampleHz);
      expect(features.v).toBe(CLIP_FEATURES_VERSION);
    }
  });

  it("finds the first motion and the peak, and says the picture is dark", () => {
    const frames = clip(40, 6);
    const f = collect(frames, 4);
    expect(f.motion[0]).toBe(0);
    expect(f.motion.length).toBe(40);
    expect(f.firstMotionSec).toBe(7 / 4); // the square first moves between samples 6 and 7
    expect(f.motion.slice(1, 7).every((m) => m < MOTION_MIN)).toBe(true);
    expect(f.peakMotionPos).toBeGreaterThan(0);
    expect(f.peakMotionPos).toBeLessThanOrEqual(1);
    expect(f.darkShare).toBeGreaterThan(0.9); // 16 of 256 pixels are the square
    expect(f.meanLuma).toBeLessThan(0.2);
    expect(f.meanSat).toBeGreaterThan(0.4);
    // a still picture: no first motion, no peak, a seamless loop
    const frame = thumb(2, () => 0);
    const still = collect(Array.from({ length: 12 }, () => frame), 4);
    expect(still).toMatchObject({ firstMotionSec: null, peakMotionPos: null, loopSeamDiff: 0 });
    expect(still.motion.every((m) => m === 0)).toBe(true);
    // noise alone stays under MOTION_MIN
    expect(collect(clip(12, 99), 4).firstMotionSec).toBeNull();
  });

  it("keeps the first 600 motion values of a long clip, and its first motion, peak and means over every sample", () => {
    const sampleHz = 4;
    const long = clip(MAX_MOTION_SAMPLES + 300, MAX_MOTION_SAMPLES + 100); // still through the kept curve, moving after it
    const f = collect(long, sampleHz);
    expect(f.motion.length).toBe(MAX_MOTION_SAMPLES);
    expect(f.firstMotionSec).toBe((MAX_MOTION_SAMPLES + 101) / sampleHz);
    expect(f.peakMotionPos).toBeGreaterThan(MAX_MOTION_SAMPLES / (long.length - 1));
    const all = pictureFeatures(long.map(rgb24), sampleHz);
    expect({ meanLuma: f.meanLuma, meanSat: f.meanSat, darkShare: f.darkShare }).toEqual({ meanLuma: all.meanLuma, meanSat: all.meanSat, darkShare: all.darkShare });
  });

  it("gives no picture numbers without a sample, and no loop seam with one", () => {
    const none = new ClipFeaturesCollector(4).finish({ durationSec: 0, lufs: null });
    expect(none).toMatchObject({ motion: [], firstMotionSec: null, peakMotionPos: null, meanLuma: null, meanSat: null, darkShare: null, loopSeamDiff: null, soundEventsPerSec: null, gapEvents: 0 });
    const one = collect(clip(1, 0), 4);
    expect(one.motion).toEqual([0]);
    expect(one.loopSeamDiff).toBeNull();
    expect(one.meanLuma).not.toBeNull();
  });
});

describe("clip features: the digest stays what it was (--- insights ---)", () => {
  it("never writes the pixels it reads", () => {
    const frames = clip(30, 3);
    const copies = frames.map((f) => Uint8ClampedArray.from(f));
    collect(frames, 4);
    frames.forEach((f, i) => expect(Array.from(f)).toEqual(Array.from(copies[i])));
  });

  it("samples the digest through sampleDigest: the FNV-1a chain of the pixels, with features or without, even a failed collector", () => {
    const frames = clip(30, 3);
    let plain = 0x811c9dc5;
    for (const f of frames) plain = fnv1a(f, plain);
    let withFeatures = 0x811c9dc5;
    const collector = new ClipFeaturesCollector(4);
    for (const f of frames) withFeatures = sampleDigest(f, withFeatures, collector);
    let without = 0x811c9dc5;
    for (const f of frames) without = sampleDigest(f, without, null);
    const broken = new ClipFeaturesCollector(4);
    broken.frame(null as unknown as Uint8ClampedArray); // fails: measures nothing more
    expect(broken.failed).toBe(true);
    let afterFailure = 0x811c9dc5;
    for (const f of frames) afterFailure = sampleDigest(f, afterFailure, broken);
    expect(withFeatures).toBe(plain);
    expect(without).toBe(plain);
    expect(afterFailure).toBe(plain);
    expect(collector.finish({ durationSec: 30 / 4, lufs: -18 })?.motion.length).toBe(30);
  });

  it("is fed inside the export's digest branch, from the very pixels the digest hashes (no draw or readback of its own)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/recording/fastRender.ts"), "utf8");
    const branch = /if \(index % DIGEST_EVERY === 0\) \{([\s\S]*?)\n\s*\}/.exec(src)?.[1] ?? "";
    expect(branch).toContain("thumbCtx.drawImage(frameCanvas, 0, 0, 16, 16);");
    expect(branch).toContain("digest = sampleDigest(thumbCtx.getImageData(0, 0, 16, 16).data, digest, features);");
    expect(src.match(/getImageData\(/g)?.length).toBe(1);
    expect(src.match(/thumbCtx\.drawImage\(/g)?.length).toBe(1);
    expect(src).toContain(`new ClipFeaturesCollector(fps / DIGEST_EVERY)`);
    expect(DIGEST_EVERY).toBe(15); // 4 samples a second at 60 fps, 2 at 30
  });
});

describe("clip features: the sound (--- insights ---)", () => {
  it("counts the clip's sound events and gaps, not those of a last frame past its end", () => {
    const c = new ClipFeaturesCollector(4);
    for (const f of clip(8, 0)) c.frame(f);
    const at = (sec: number, type: "hit" | "gap" | "merge", n = 1) => {
      for (let i = 0; i < n; i++) c.sound(sec, { type });
    };
    at(0.25, "hit", 2);
    at(0.5, "gap");
    at(1, "hit");
    at(1.5, "merge");
    at(1.75, "gap", 2);
    at(2, "hit", 3); // the frame the loop cut stopped on: past the clip
    const f = c.finish({ durationSec: 2, lufs: -16.26 });
    expect(f).toMatchObject({ soundEventsPerSec: 7 / 2, gapEvents: 3, lufs: -16.3 });
    const inside = new ClipFeaturesCollector(4);
    inside.sound(1.9, { type: "gap" });
    expect(inside.finish({ durationSec: 2, lufs: null })).toMatchObject({ soundEventsPerSec: 0.5, gapEvents: 1, lufs: null });
    expect(new ClipFeaturesCollector(4).finish({ durationSec: 2, lufs: -Infinity })).toMatchObject({ soundEventsPerSec: 0, gapEvents: 0, lufs: null });
  });

  // --- insights --- the loop cut's stop frame lies at the clip's very end; its time and the clip's length are two roundings
  it("never counts the events of the loop cut's stop frame, whichever way the clocks round its time", () => {
    // the frame loop's clock (simFrameTimeMs / 1000) against the clip's length (exportDurationSec of the frames exported)
    const stopAt = (k: number, fps: number) => {
      const c = new ClipFeaturesCollector(fps / DIGEST_EVERY);
      c.sound(simFrameTimeMs(k - 1) / 1000, { type: "hit" }); // the clip's last frame: inside it
      for (let i = 0; i < 5; i++) c.sound(simFrameTimeMs(k) / 1000, { type: "gap" }); // the stop frame, drawn nowhere
      return c.finish({ durationSec: exportDurationSec(exportFrameRange(k, fps)[0], fps), lufs: null })!;
    };
    expect(simFrameTimeMs(13) / 1000).toBeLessThan(exportDurationSec(13, 60)); // (one ulp below: the case that counted them)
    for (const [k, fps] of [[13, 60], [23, 60], [601, 60], [12, 60], [600, 60], [26, 30], [24, 30], [631, 60], [646, 60]] as const) {
      const f = stopAt(k, fps);
      expect([k, fps, f.gapEvents, f.soundEventsPerSec]).toEqual([k, fps, 0, Math.round((1 / exportDurationSec(exportFrameRange(k, fps)[0], fps)) * 10000) / 10000]); // (the last frame's one hit)
    }
    // every stop frame of the first minute at 60 and 30 fps
    for (const fps of [60, 30]) for (let k = 2; k <= 60 * SIM_FPS; k += fps === 30 ? 2 : 1) expect([fps, k, stopAt(k, fps).gapEvents]).toEqual([fps, k, 0]);
    // the slack is far below a frame: the last frame before the end still counts, at any rate up to 240 fps
    expect(CLIP_END_SLACK_SEC).toBeLessThan(1 / 240 / 100);
    const last = new ClipFeaturesCollector(60);
    last.sound(2 - 1 / 240, { type: "gap" });
    expect(last.finish({ durationSec: 2, lufs: null })?.gapEvents).toBe(1);
  });

  it("finds the first sound in the export's mix with the analyser's rule (a stereo mix as its mono mean)", () => {
    const rate = 48_000;
    const tone = (startSec: number, lengthSec: number, amp: number) => Float32Array.from({ length: rate * lengthSec }, (_, i) => (i >= startSec * rate ? amp * Math.sin((2 * Math.PI * 440 * i) / rate) : 0));
    const left = tone(0.5, 2, 0.2);
    const right = tone(0.5, 2, 0.2);
    const c = new ClipFeaturesCollector(4);
    const f = c.finish({ durationSec: 2, lufs: -30, mix: { channels: [left, right], sampleRate: rate, frames: left.length } });
    expect(f?.firstSoundSec).toBe(0.5);
    expect(firstSoundSecOf([left, right], rate)).toBe(soundFeatures(left, rate).firstSoundSec);
    // left and right in opposite phase cancel in the mono mix, as in ffmpeg's -ac 1
    const inverted = Float32Array.from(right, (v) => -v);
    expect(firstSoundSecOf([left, inverted], rate)).toBeNull();
    // the clip's own length: a sound after it is not heard in the file
    expect(firstSoundSecOf([left, right], rate, 0.4 * rate)).toBeNull();
    expect(new ClipFeaturesCollector(4).finish({ durationSec: 2, lufs: -30 })?.firstSoundSec).toBeNull();
  });
});

describe("clip features: never a failed export (--- insights ---)", () => {
  it("swallows its own errors: a failed call stops the measuring, and finish() gives null", () => {
    const hostile = new Proxy(new Uint8ClampedArray(1024), {
      get(target, key) {
        if (key === "length") throw new Error("boom");
        return Reflect.get(target, key);
      },
    });
    const a = new ClipFeaturesCollector(4);
    expect(() => a.frame(hostile)).not.toThrow();
    expect(a.failed).toBe(true);
    expect(a.finish({ durationSec: 1, lufs: -14 })).toBeNull();
    const b = new ClipFeaturesCollector(4);
    expect(() => b.sound(0.5, null as unknown as { type: "hit" })).not.toThrow();
    expect(b.failed).toBe(true);
    expect(b.finish({ durationSec: 1, lufs: -14 })).toBeNull();
    const c = new ClipFeaturesCollector(4);
    const end = { lufs: -14, mix: { channels: [], sampleRate: 48_000, frames: 0 } } as unknown as Parameters<ClipFeaturesCollector["finish"]>[0];
    Object.defineProperty(end, "durationSec", {
      get() {
        throw new Error("boom");
      },
    });
    expect(() => c.finish(end)).not.toThrow();
    expect(c.finish({ durationSec: 1, lufs: -14 })).toBeNull();
  });

  it("is pure: no randomness, no clock", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/recording/clipFeatures.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date|setTimeout|eval\(/);
    const twice = [collect(clip(50, 5), 4), collect(clip(50, 5), 4)];
    expect(twice[1]).toEqual(twice[0]);
  });
});

describe("clip features: into the clip's genes (--- insights ---)", () => {
  const measured = (): ClipFeatures => ({ ...collect(clip(40, 6), 4, { lufs: -21.37 }), soundEventsPerSec: 3.25, gapEvents: 4, firstSoundSec: 0.3 });

  it("measures every feature key of the genes, plus the motion curve", () => {
    expect(Object.keys(measured()).sort()).toEqual(["v", "motion", ...GENE_FEATURE_KEYS].sort());
  });

  it("keeps the scalars in the genes of the saved file and leaves the curve out", () => {
    const f = measured();
    const gene = featureGenes(f);
    expect(gene).toEqual({ v: 1, ...Object.fromEntries(GENE_FEATURE_KEYS.map((k) => [k, f[k]])) });
    expect(gene).not.toHaveProperty("motion");
    const settings = { ...defaultSettings(), mode: "classic" as const, recordingDuration: 10 };
    const saved = genesOfSavedFile(genesFromSettings(settings, { hook: "Which ball escapes?" }, "link"), { durationSec: 10, cut: "master", features: f });
    expect(saved.features).toEqual(gene);
    expect(sanitizeGenes(JSON.parse(JSON.stringify(saved)))).toEqual(saved); // the main process stores it as it is
    // a re-render measures its own file; an export that measured nothing leaves none; no measurement passed keeps the genes'
    expect(genesOfSavedFile(saved, { durationSec: 10, cut: "master", features: null }).features).toBeNull();
    expect(genesOfSavedFile(saved, { durationSec: 10, cut: "master" }).features).toEqual(gene);
    // a cut is not the frames that were measured
    expect(genesOfCut(saved, { durationSec: 6, hook: "Which ball escapes?", sameHook: true }).features).toBeNull();
  });
});
