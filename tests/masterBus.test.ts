import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { LIMITER_RATIO, LIMITER_THRESHOLD_DB, SOFT_CLIP_KNEE, SameTimeVoices, compressorMakeupGain, softClip, softClipCurve } from "@/lib/audio/masterBus";

/**
 * --- review fix (audio) --- The master bus (masterBus.ts): the limiter's makeup-gain maths, the soft clip, the same-time
 * voice table – and, rendered for real in Chromium's OfflineAudioContext (src/lib/audio bundled with esbuild), that a pile-up
 * of hits no longer clips while a single bounce keeps its level, that a stolen hit-sample voice fades out from its own level
 * in a fast export, and that soft notes decay like loud ones. The rendered checks are skipped when Chromium cannot start.
 */

const ROOT = path.resolve(__dirname, "..");

describe("master bus maths", () => {
  it("undoes the compressor's makeup gain with the trim (Web Audio spec: (1 / curve(1))^0.6)", () => {
    const threshold = Math.pow(10, LIMITER_THRESHOLD_DB / 20);
    const curveAtFullScale = threshold * Math.pow(1 / threshold, 1 / LIMITER_RATIO);
    expect(compressorMakeupGain()).toBeCloseTo(Math.pow(1 / curveAtFullScale, 0.6), 12);
    expect(compressorMakeupGain()).toBeGreaterThan(1.2); // +1.7 dB on everything without the trim
    expect(compressorMakeupGain(0, 20)).toBe(1); // a threshold at full scale compresses nothing
  });

  it("soft-clips only above the knee, never reaching full scale, and symmetrically", () => {
    for (const x of [0, 0.1, 0.5, SOFT_CLIP_KNEE, -0.3, -SOFT_CLIP_KNEE]) expect(softClip(x)).toBe(x);
    for (const x of [0.95, 1, 1.5]) {
      expect(softClip(x)).toBeGreaterThan(SOFT_CLIP_KNEE);
      expect(softClip(x)).toBeLessThan(1); // the WaveShaper clamps its input to ±1: its ceiling is softClip(1) ≈ 0.976
      expect(softClip(-x)).toBe(-softClip(x));
    }
    expect(softClip(10)).toBeLessThanOrEqual(1);
    expect(softClip(0.95)).toBeLessThan(softClip(1.5));
    const curve = softClipCurve(5);
    expect(Array.from(curve).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-softClip(1), -0.5, 0, 0.5, softClip(1)].map((v) => Math.round(v * 1e6) / 1e6));
  });

  it("gives the k-th identical same-time voice √k − √(k−1), starts over at a new time and caps the voices of one time", () => {
    const table = new SameTimeVoices(12);
    let sum = 0;
    for (let k = 1; k <= 9; k++) sum += table.add(1, "triangle", 800);
    expect(sum).toBeCloseTo(3, 12); // nine identical voices: three times one
    expect(table.add(1, "triangle", 720)).toBe(1); // another pitch
    expect(table.add(1, "sine", 800)).toBe(1); // another voice
    expect(table.add(1, "triangle", 640)).toBe(1); // the 12th voice of this time
    expect(table.add(1, "triangle", 560)).toBe(0); // the 13th is left out
    expect(table.add(1.0166, "triangle", 800)).toBe(1); // the next frame starts over
  });
});

/** src/lib/audio bundled for the browser, exposed as window.audioLib. */
async function bundleAudioLib(): Promise<string> {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    stdin: {
      contents: `
        import { ToneGenerator } from "@/lib/audio/toneGenerator";
        import { HitSampler } from "@/lib/audio/sampler";
        import { clockedAudioContext } from "@/lib/audio/offlineContext";
        import { playVoice } from "@/lib/audio/instruments";
        window.audioLib = { ToneGenerator, HitSampler, clockedAudioContext, playVoice };
      `,
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    alias: { "@": path.join(ROOT, "src") },
    define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""', "process.env.NEXT_PUBLIC_SITE_URL": '""', "process.env.NEXT_PUBLIC_SITE_DOMAIN": '""' /* --- review fix (site-static) --- read by lib/site.ts */ },
    logLevel: "error",
  });
  return result.outputFiles[0].text;
}

describe("master bus rendered in Chromium", () => {
  let browser: Browser | null = null;
  let page: Page | null = null;

  beforeAll(async () => {
    try {
      const code = await bundleAudioLib();
      const { chromium } = await import("playwright");
      browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
      page = await browser.newPage();
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({ content: code });
    } catch (err) {
      console.warn("Chromium is not available – the rendered master-bus checks are skipped:", err);
      await browser?.close().catch(() => undefined);
      browser = null;
      page = null;
    }
  }, 120000);
  afterAll(async () => {
    await browser?.close();
  });

  it("keeps a pile-up of same-frame hits under full scale and a single bounce at its classic level", async (ctx) => {
    if (!page) return ctx.skip();
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lib = (window as any).audioLib;
      const peakOf = (buffer: AudioBuffer) => {
        let peak = 0;
        for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
        return peak;
      };
      /** Plays into a fast-export twin with the clock at `at` seconds and returns the peak of the rendered clip. */
      const render = async (at: number, play: (twin: InstanceType<typeof lib.ToneGenerator>, off: OfflineAudioContext) => void) => {
        const off = new OfflineAudioContext(2, 48000, 48000);
        let clock = 0;
        const twin = await new lib.ToneGenerator().createOfflineTwin(off, () => clock);
        clock = at;
        play(twin, off);
        return peakOf(await off.startRendering());
      };
      // Today's classic bounce straight into the destination (no bus) is the reference level.
      const refCtx = new OfflineAudioContext(1, 48000, 48000);
      lib.playVoice(refCtx, refCtx.destination, "triangle", { frequency: 800, time: 0, duration: 0.15, gain: 0.25 });
      const reference = peakOf(await refCtx.startRendering());
      const pileUp = (twin: InstanceType<typeof lib.ToneGenerator>) => {
        for (let i = 0; i < 10; i++) twin.playWallHit(0);
        for (let w = 1; w <= 6; w++) twin.playWallHit(w);
      };
      // The bus on its own: six in-phase voices at the hit level (1.5 × full scale summed) go straight into the master gain.
      const raw = (at: number) => (twin: InstanceType<typeof lib.ToneGenerator>, off: OfflineAudioContext) => {
        for (let i = 0; i < 6; i++) lib.playVoice(off, twin.masterGain, "triangle", { frequency: 800, time: at, duration: 0.15, gain: 0.25 });
      };
      return {
        reference,
        // At the very start of the clip (the limiter still settling) and later on.
        single: [await render(0, (twin) => twin.playWallHit(0)), await render(0.5, (twin) => twin.playWallHit(0))],
        pileUp: [await render(0, pileUp), await render(0.5, pileUp)],
        raw: [await render(0, raw(0)), await render(0.5, raw(0.5))],
      };
    });
    expect(r.reference).toBeGreaterThan(0.2);
    for (const single of r.single) expect(Math.abs(20 * Math.log10(single / r.reference))).toBeLessThan(0.5);
    for (const peak of [...r.pileUp, ...r.raw]) {
      expect(peak).toBeLessThanOrEqual(1);
      expect(peak).toBeGreaterThan(0.6); // limited, not muted
    }
    expect(r.raw[1]).toBeLessThan(0.9); // once settled the limiter itself holds it (the soft clip's knee starts at 0.9)
  }, 60000);

  it("fades a stolen hit-sample voice out from its own level in a fast export (no jump to 1)", async (ctx) => {
    if (!page) return ctx.skip();
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lib = (window as any).audioLib;
      const off = new OfflineAudioContext(1, 48000, 48000);
      let clock = 0;
      const ctx = lib.clockedAudioContext(off, () => clock);
      const sampler = new lib.HitSampler(ctx, off.destination);
      sampler.setVolume(0.8);
      const sine = off.createBuffer(1, 48000, 48000);
      const data = sine.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
      sampler.buffer = sine; // the decoded clip (load() would fetch and decode it)
      sampler.play(1, 0, 1 / Math.sqrt(8)); // one note of an 8-note chord: level 0.283
      clock = 0.3;
      for (let i = 0; i < 8; i++) sampler.play(1, 0.3, 0); // a full pool steals the first voice on its plateau
      const out = (await off.startRendering()).getChannelData(0);
      const peak = (from: number, to: number) => {
        let p = 0;
        for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++) p = Math.max(p, Math.abs(out[i]));
        return p;
      };
      return { before: peak(0.05, 0.29), steal: peak(0.3, 0.325) };
    });
    expect(r.before).toBeCloseTo(0.8 / Math.sqrt(8), 2);
    expect(r.steal).toBeLessThanOrEqual(r.before + 1e-3); // was 0.97: a jump to 1 for the 20 ms fade
  }, 60000);

  it("decays soft notes by as much as loud ones (square and chip no longer grow before they stop)", async (ctx) => {
    if (!page) return ctx.skip();
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lib = (window as any).audioLib;
      const decayDb = async (instrument: string, gain: number) => {
        const off = new OfflineAudioContext(1, 24000, 48000);
        lib.playVoice(off, off.destination, instrument, { frequency: 400, time: 0, duration: 0.15, gain });
        const out = (await off.startRendering()).getChannelData(0);
        const peak = (from: number, to: number) => {
          let p = 0;
          for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++) p = Math.max(p, Math.abs(out[i]));
          return p;
        };
        return { decay: 20 * Math.log10(peak(0.14, 0.15) / peak(0, 0.01)), tail: peak(0.16, 0.5) };
      };
      return { loud: await decayDb("triangle", 0.25), soft: await decayDb("triangle", 0.0175), square: await decayDb("square", 0.0175), chip: await decayDb("chip", 0.0175) };
    });
    for (const v of [r.loud, r.soft, r.square, r.chip]) {
      expect(v.decay).toBeLessThan(-20);
      expect(v.tail).toBe(0);
    }
    expect(Math.abs(r.soft.decay - r.loud.decay)).toBeLessThan(3);
  }, 60000);
});
