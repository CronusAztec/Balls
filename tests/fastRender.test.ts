import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_CHUNK_FRAMES,
  DEFAULT_FAST_EXPORT_FPS,
  END_HOLD_FALLBACK_MS,
  END_STOP_DELAY_MS,
  EXPORT_SAMPLE_RATE,
  ExportEndTracker,
  SIM_FRAME_MS,
  audioChunks,
  audioFrameCount,
  audioTimestampUs,
  avcCodecStrings,
  avcLevel,
  exportDurationSec,
  exportFormatCandidates,
  exportFrameIndex,
  exportProgress,
  fnv1a,
  frameDurationUs,
  frameTimestampUs,
  isKeyFrame,
  maxSimFrames,
  offlineAudioSeconds,
  offlineCanvasLayout,
  realtimeFactor,
  resolveFastExportFps,
  seededRandom,
  selectExportFormat,
  simFrameTimeMs,
  simFramesPerExportFrame,
  videoBitrate,
  vp9CodecString,
  type EndHolds,
} from "@/lib/recording/fastRenderPlan";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { clockedAudioContext } from "@/lib/audio/offlineContext";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { HitSampler } from "@/lib/audio/sampler";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import type { SoundEvent } from "@/lib/physics/types";

describe("fast export: frames and time", () => {
  it("steps the simulation at 60 Hz and keeps every n-th frame for the export rate", () => {
    expect(simFramesPerExportFrame(60)).toBe(1);
    expect(simFramesPerExportFrame(30)).toBe(2);
    expect(simFrameTimeMs(60)).toBeCloseTo(1000, 9);
    expect(SIM_FRAME_MS).toBeCloseTo(16.6667, 3);
    expect([0, 1, 2, 3, 4].map((j) => exportFrameIndex(j, 30))).toEqual([0, -1, 1, -1, 2]);
    expect([0, 1, 2, 3].map((j) => exportFrameIndex(j, 60))).toEqual([0, 1, 2, 3]);
  });

  it("gives every frame a rounded timestamp and durations that add up to the clip exactly", () => {
    expect(frameTimestampUs(0, 60)).toBe(0);
    expect(frameTimestampUs(1, 60)).toBe(16667);
    expect(frameTimestampUs(60, 60)).toBe(1_000_000);
    expect(frameTimestampUs(3, 30)).toBe(100_000);
    let sum = 0;
    for (let i = 0; i < 60 * 90; i++) sum += frameDurationUs(i, 60);
    expect(sum).toBe(90_000_000);
    expect(exportDurationSec(1800, 60)).toBe(30);
    expect(exportDurationSec(450, 30)).toBe(15);
  });

  it("puts a key frame on the first frame and every two seconds", () => {
    expect(isKeyFrame(0, 60)).toBe(true);
    expect(isKeyFrame(119, 60)).toBe(false);
    expect(isKeyFrame(120, 60)).toBe(true);
    expect(isKeyFrame(59, 30)).toBe(false);
    expect(isKeyFrame(60, 30)).toBe(true);
    expect(isKeyFrame(30, 30, 1)).toBe(true);
  });

  it("bounds the frames of a clip by its length, the end-of-run hold fallback and the recorder's delay", () => {
    const frames = maxSimFrames(10);
    expect(frames * SIM_FRAME_MS).toBeGreaterThanOrEqual(10_000 + END_HOLD_FALLBACK_MS + END_STOP_DELAY_MS);
    expect(frames * SIM_FRAME_MS).toBeLessThan(10_000 + END_HOLD_FALLBACK_MS + END_STOP_DELAY_MS + 3 * SIM_FRAME_MS);
  });
});

describe("fast export: the end of the clip (the page's recorder rule)", () => {
  /** Plays a run frame by frame until the tracker ends it; `at(t)` says what the run and the canvas report at t (ms). */
  const play = (clipMs: number, at: (t: number) => { finished: boolean; held?: boolean; holds?: EndHolds }) => {
    const tracker = new ExportEndTracker(clipMs);
    let frames = 0;
    for (let j = 0; j < 100_000; j++) {
      const t = simFrameTimeMs(j);
      if (j > 0 && t >= tracker.endMs) break;
      const s = at(t);
      tracker.frame(t, s.finished, s.held ?? false, s.holds);
      frames++;
    }
    return { tracker, frames, endMs: tracker.endMs };
  };

  it("runs the full clip length while the run goes on", () => {
    const { tracker, frames } = play(10_000, () => ({ finished: false }));
    expect(tracker.finishedAt).toBeNull();
    expect(frames).toBe(600);
  });

  it("stops half a second after a run that ends on its own", () => {
    const { tracker, endMs, frames } = play(30_000, (t) => ({ finished: t >= 5000 }));
    expect(tracker.finishedAt).toBeCloseTo(5000, 6);
    expect(endMs).toBeCloseTo(5500, 6);
    expect(frames).toBe(330);
  });

  it("holds a finished picture before the end screen, then waits for the escape replay, then the winner banner", () => {
    const paint = play(30_000, (t) => ({ finished: t >= 5000, holds: { preMs: 1500, postMs: 0 } }));
    expect(paint.tracker.finishedAt).toBeCloseTo(6500, 6);
    expect(paint.endMs).toBeCloseTo(7000, 6);
    const replay = play(30_000, (t) => ({ finished: t >= 5000, held: t < 8000 }));
    expect(replay.tracker.finishedAt).toBeCloseTo(8000, 6);
    // The winner's hold starts once the replay is over (as on the page), not when the run ended.
    const banner = play(30_000, (t) => ({ finished: t >= 5000, held: t < 8000, holds: { preMs: 0, postMs: 3000 } }));
    expect(banner.tracker.finishedAt).toBeCloseTo(11000, 6);
    expect(banner.endMs).toBeCloseTo(11500, 6);
  });

  it("keeps a run that is over but still holding when the clip length runs out, for at most the fallback", () => {
    const held = play(10_000, (t) => ({ finished: t >= 9000, held: t < 14000 }));
    expect(held.tracker.finishedAt).toBeCloseTo(14000, 6);
    expect(held.endMs).toBeCloseTo(14500, 6);
    const stuck = play(10_000, (t) => ({ finished: t >= 9000, held: true }));
    expect(stuck.tracker.finishedAt).toBeNull();
    expect(stuck.endMs).toBe(10_000 + END_HOLD_FALLBACK_MS);
    // A run still going when the clip length runs out is cut there, even if it finishes right after.
    const late = play(10_000, (t) => ({ finished: t >= 10_050 }));
    expect(late.endMs).toBe(10_000);
    expect(late.frames).toBe(600);
  });
});

describe("fast export: layout, bitrates and codecs", () => {
  it("draws the world so its centred square is exactly the export's shorter side", () => {
    const tall = offlineCanvasLayout({ width: 880, height: 495 }, { width: 1080, height: 1920 });
    expect(tall.scale).toBeCloseTo(1080 / 495, 5);
    expect(Math.min(tall.width, tall.height)).toBe(1080);
    expect(tall.width).toBe(1920);
    expect(offlineCanvasLayout({ width: 500, height: 500 }, { width: 500, height: 500 })).toMatchObject({ width: 500, height: 500 });
    expect(offlineCanvasLayout({ width: 500, height: 500 }, { width: 500, height: 500 }).scale).toBeCloseTo(1, 5);
    for (const w of [301.5, 640, 879.33, 1203.7]) {
      const l = offlineCanvasLayout({ width: w, height: w * 0.5625 }, { width: 1080, height: 1920 });
      expect(Math.min(l.width, l.height)).toBe(1080);
      expect(Math.min(Math.floor(w * l.scale), Math.floor(w * 0.5625 * l.scale))).toBe(1080);
    }
    expect(offlineCanvasLayout({ width: 400, height: 900 }, { width: 1280, height: 720 }).width).toBe(720);
  });

  it("sizes the video bitrate by pixels and frames, within 2–20 Mbit/s", () => {
    expect(videoBitrate(1080, 1920, 60)).toBe(12_400_000);
    expect(videoBitrate(1080, 1920, 30)).toBe(6_200_000);
    expect(videoBitrate(500, 500, 60)).toBe(2_000_000);
    expect(videoBitrate(4000, 4000, 60)).toBe(20_000_000);
  });

  it("picks the lowest H.264 level that fits the frame size and rate", () => {
    expect(avcLevel(1280, 720, 30)).toBe(0x1f);
    expect(avcLevel(1280, 720, 60)).toBe(0x20);
    expect(avcLevel(1920, 1080, 60)).toBe(0x2a);
    expect(avcLevel(1080, 1920, 30)).toBe(0x28);
    expect(avcLevel(500, 500, 30)).toBe(0x1e);
    expect(avcLevel(500, 500, 60)).toBe(0x1f);
    expect(avcCodecStrings(1280, 720, 30)).toEqual(["avc1.42001f", "avc1.4d001f", "avc1.64001f"]);
    expect(avcCodecStrings(1080, 1920, 60)[0]).toBe("avc1.42002a");
  });

  it("picks the VP9 level the same way", () => {
    expect(vp9CodecString(1080, 1920, 60)).toBe("vp09.00.41.08");
    expect(vp9CodecString(1080, 1920, 30)).toBe("vp09.00.40.08");
    expect(vp9CodecString(1280, 720, 30)).toBe("vp09.00.31.08");
    expect(vp9CodecString(500, 500, 30)).toBe("vp09.00.30.08");
  });

  it("tries MP4 with H.264 + AAC first, then WebM with VP9 / VP8 + Opus, then MP4 with H.264 + Opus", () => {
    const list = exportFormatCandidates(1280, 720, 30);
    expect(list.map((f) => `${f.container}:${f.videoCodec}:${f.audioCodec}`)).toEqual([
      "mp4:avc1.42001f:mp4a.40.2",
      "mp4:avc1.4d001f:mp4a.40.2",
      "mp4:avc1.64001f:mp4a.40.2",
      "webm:vp09.00.31.08:opus",
      "webm:vp8:opus",
      "mp4:avc1.42001f:opus",
      "mp4:avc1.4d001f:opus",
      "mp4:avc1.64001f:opus",
    ]);
    expect(list[0]).toMatchObject({ mimeType: "video/mp4", extension: "mp4", videoTrackCodec: "avc", audioTrackCodec: "aac" });
    expect(list[3]).toMatchObject({ mimeType: "video/webm", extension: "webm", videoTrackCodec: "V_VP9", audioTrackCodec: "A_OPUS" });
    expect(list[4].videoTrackCodec).toBe("V_VP8");
    expect(list[5].audioTrackCodec).toBe("opus");
  });

  const probeOf = (video: string[], audio: string[]) => {
    const calls: string[] = [];
    return {
      calls,
      probe: {
        video: async (codec: string) => {
          calls.push(codec);
          return video.some((prefix) => codec.startsWith(prefix));
        },
        audio: async (codec: string) => {
          calls.push(codec);
          return audio.includes(codec);
        },
      },
    };
  };

  it("selects the first format the browser can encode, probing every codec once", async () => {
    const everything = probeOf(["avc1", "vp09", "vp8"], ["mp4a.40.2", "opus"]);
    expect((await selectExportFormat(1080, 1920, 60, everything.probe))?.videoCodec).toBe("avc1.42002a");
    // Chromium on Linux: H.264 and Opus, no AAC encoder – WebM with VP9 beats MP4 with Opus.
    const noAac = probeOf(["avc1", "vp09", "vp8"], ["opus"]);
    const webm = await selectExportFormat(1080, 1920, 60, noAac.probe);
    expect(webm).toMatchObject({ container: "webm", videoCodec: "vp09.00.41.08", audioCodec: "opus" });
    expect(new Set(noAac.calls).size).toBe(noAac.calls.length);
    // Only a Main-profile H.264 encoder.
    const main = probeOf(["avc1.4d"], ["mp4a.40.2"]);
    expect((await selectExportFormat(1280, 720, 30, main.probe))?.videoCodec).toBe("avc1.4d001f");
    // H.264 + Opus only.
    const opusMp4 = probeOf(["avc1"], ["opus"]);
    expect(await selectExportFormat(1280, 720, 30, opusMp4.probe)).toMatchObject({ container: "mp4", audioTrackCodec: "opus" });
  });

  it("gives up (the page records in real time) without a usable video or audio encoder, and treats a failing probe as no", async () => {
    expect(await selectExportFormat(1280, 720, 30, probeOf(["avc1", "vp09", "vp8"], []).probe)).toBeNull();
    expect(await selectExportFormat(1280, 720, 30, probeOf([], ["mp4a.40.2", "opus"]).probe)).toBeNull();
    const throwing = { video: async () => Promise.reject(new TypeError("bad codec")), audio: async () => true };
    expect(await selectExportFormat(1280, 720, 30, throwing)).toBeNull();
  });
});

describe("fast export: audio", () => {
  it("renders the mix for the longest possible clip and encodes it in chunks with exact timestamps", () => {
    expect(offlineAudioSeconds(30)).toBeCloseTo(30 + (END_HOLD_FALLBACK_MS + END_STOP_DELAY_MS) / 1000 + 1, 9);
    expect(audioFrameCount(1.5)).toBe(72_000);
    expect(audioFrameCount(-1)).toBe(0);
    expect(audioChunks(2500, 1024)).toEqual([
      { offset: 0, frames: 1024 },
      { offset: 1024, frames: 1024 },
      { offset: 2048, frames: 452 },
    ]);
    expect(audioChunks(0)).toEqual([]);
    const chunks = audioChunks(audioFrameCount(12.34));
    expect(chunks.reduce((n, c) => n + c.frames, 0)).toBe(audioFrameCount(12.34));
    expect(chunks.every((c, i) => c.offset === i * AUDIO_CHUNK_FRAMES)).toBe(true);
    expect(audioTimestampUs(EXPORT_SAMPLE_RATE)).toBe(1_000_000);
    expect(audioTimestampUs(1024)).toBe(21333);
  });
});

describe("fast export: progress, speed and reproducibility", () => {
  it("reports progress that only moves forward across the phases", () => {
    const steps = [exportProgress("prepare", 0), exportProgress("prepare", 1), exportProgress("frames", 0), exportProgress("frames", 0.5), exportProgress("frames", 1), exportProgress("audio", 0), exportProgress("audio", 1), exportProgress("finish", 0), exportProgress("finish", 1)];
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(steps[0]).toBe(0);
    expect(steps.at(-1)).toBe(1);
    expect(exportProgress("frames", 7)).toBe(exportProgress("frames", 1));
    expect(exportProgress("frames", Number.NaN)).toBe(exportProgress("frames", 0));
    expect(realtimeFactor(30, 10_000)).toBe(3);
    expect(realtimeFactor(30, 0)).toBe(0);
  });

  it("seeds the visual randomness from the run's seed", () => {
    const a = seededRandom(1234);
    const b = seededRandom(1234);
    const c = seededRandom(1235);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    const seqC = Array.from({ length: 50 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("hashes frames with FNV-1a", () => {
    expect(fnv1a([])).toBe(0x811c9dc5);
    expect(fnv1a([97])).toBe(0xe40c292c);
    expect(fnv1a([98], fnv1a([97]))).toBe(fnv1a([97, 98]));
  });
});

describe("fast export: settings", () => {
  it("defaults to 60 fps, snaps anything else to 30 or 60 and travels in links (xfps) and presets", () => {
    expect(defaultSettings().fastExportFps).toBe(DEFAULT_FAST_EXPORT_FPS);
    expect(DEFAULT_FAST_EXPORT_FPS).toBe(60);
    expect([30, 60, "30", 44, 45, 120, Number.NaN, undefined, "x"].map(resolveFastExportFps)).toEqual([30, 60, 30, 30, 60, 60, 60, 60, 60]);
    const s = { ...defaultSettings("classic"), fastExportFps: 30 };
    const params = settingsToSearchParams(s);
    expect(params.get("xfps")).toBe("30");
    expect(settingsFromSearchParams(params).fastExportFps).toBe(30);
    expect(settingsToSearchParams(defaultSettings("classic")).has("xfps")).toBe(false);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&xfps=25")).fastExportFps).toBe(30);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&xfps=abc")).fastExportFps).toBe(60);
    expect(presetToSettings({ mode: "box", fastExportFps: 59 }).fastExportFps).toBe(60);
    expect(presetToSettings({ mode: "box" }).fastExportFps).toBe(60);
  });
});

describe("fast export: sound", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dispatches engine sound events like the page's sound loop", () => {
    const calls: string[] = [];
    const audio = {
      playBumper: (f?: number) => calls.push(`bumper ${f}`),
      playWallHit: (w: number, f?: number, accent?: boolean, chord?: readonly number[], level?: number) => calls.push(`hit ${w} ${f} ${accent} ${chord?.join("/")} ${level}`),
      playGapPass: () => calls.push("gap"),
      playMultiplier: (n: number) => calls.push(`multiplier ${n}`),
      playInteraction: (kind: string) => calls.push(`interaction ${kind}`),
      playRaceArpeggio: (kind: string, root?: number) => calls.push(`race ${kind} ${root}`), // --- jdm-race ---
    } as unknown as ToneGenerator;
    let breaks = 0;
    const events: SoundEvent[] = [
      { type: "hit", wallIndex: 2, frequency: 440, accent: true, chord: [440, 550], level: 0.5 },
      { type: "hit", wallIndex: 0, frequency: 700, bumper: true },
      { type: "gap", wallIndex: 1 },
      { type: "multiplier", wallIndex: 0 },
      { type: "multiplier", wallIndex: 0, multiplier: 8 },
      { type: "merge", wallIndex: 0 },
      { type: "split", wallIndex: 0 },
      { type: "hit", wallIndex: 0, frequency: 330, race: "chime" }, // --- jdm-race --- a pass
      { type: "hit", wallIndex: 0, frequency: 262, race: "fanfare" }, // --- jdm-race --- the winner
    ];
    for (const ev of events) playSoundEvent(audio, ev, () => breaks++);
    expect(calls).toEqual(["hit 2 440 true 440/550 0.5", "bumper 700", "gap", "multiplier 2", "multiplier 8", "interaction merge", "interaction split", "race chime 330", "race fanfare 262"]);
    expect(breaks).toBe(1);
  });

  /** A context that never advances and stays "suspended", like an OfflineAudioContext before it renders. */
  function fakeOfflineContext() {
    const started: { kind: string; type?: string; frequency?: number; args: number[] }[] = [];
    const cancelled: number[] = [];
    const param = (value = 0) => ({
      value,
      setValueAtTime: () => undefined,
      linearRampToValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
      setTargetAtTime: () => undefined,
      cancelScheduledValues: (t: number) => void cancelled.push(t),
      cancelAndHoldAtTime: () => undefined,
    });
    class FakeOfflineContext {
      readonly sampleRate = 48000;
      readonly destination = { connect: () => undefined };
      get state() {
        return "suspended";
      }
      get currentTime() {
        return 0;
      }
      resume(): Promise<void> {
        throw new Error("an offline context cannot be resumed before it renders");
      }
      private check() {
        if (!(this instanceof FakeOfflineContext)) throw new TypeError("Illegal invocation");
      }
      createGain() {
        this.check();
        return { gain: param(1), connect: () => undefined, disconnect: () => undefined };
      }
      createOscillator() {
        this.check();
        const osc = { type: "sine", frequency: param(0), connect: () => undefined, disconnect: () => undefined, onended: null, start: (when = 0) => void started.push({ kind: "osc", type: osc.type, frequency: osc.frequency.value, args: [when] }), stop: () => undefined };
        return osc;
      }
      createBufferSource() {
        this.check();
        const source = { buffer: null, loop: false, playbackRate: param(1), connect: () => undefined, disconnect: () => undefined, onended: null, start: (...args: number[]) => void started.push({ kind: "source", args }), stop: () => undefined };
        return source;
      }
      createBuffer(channels: number, length: number, sampleRate: number) {
        this.check();
        return { duration: length / sampleRate, copyToChannel: () => undefined };
      }
      async decodeAudioData() {
        this.check();
        return { duration: 0.3 };
      }
    }
    return { ctx: new FakeOfflineContext(), started, cancelled };
  }

  it("reads the export clock through the clocked context and binds the real context's methods", async () => {
    const { ctx } = fakeOfflineContext();
    let clock = 1.5;
    const view = clockedAudioContext(ctx as unknown as BaseAudioContext, () => clock);
    expect(view.currentTime).toBe(1.5);
    clock = 2.25;
    expect(view.currentTime).toBe(2.25);
    expect(view.state).toBe("running");
    await expect(view.resume()).resolves.toBeUndefined();
    expect(view.sampleRate).toBe(48000);
    expect(() => view.createGain()).not.toThrow();
  });

  it("schedules the page's sounds into the offline context on the export clock (tones, gap arpeggio, beat lock, music bed, song slices)", async () => {
    const page = new ToneGenerator();
    page.setMusicSettings({ instrument: "square", melodyInstrument: "sine", scale: "chromatic", rootNote: 0, quantizeToBeat: false, bpm: 120, quantizeGrid: "1/4" });
    const bed = { duration: 30, numberOfChannels: 2 } as unknown as AudioBuffer;
    page.getMusicBed().setBuffer(bed);
    const { ctx, started } = fakeOfflineContext();
    let clock = 0;
    const twin = await page.createOfflineTwin(ctx as unknown as BaseAudioContext, () => clock);
    // The bed starts with the clip, from its start offset.
    expect(started).toEqual([{ kind: "source", args: [0, 0] }]);
    clock = 1.25;
    twin.playWallHit(0);
    expect(started.at(-1)).toMatchObject({ kind: "osc", type: "square", frequency: 800, args: [1.25] });
    clock = 2;
    twin.playGapPass();
    expect(started.slice(-4).map((s) => s.args[0])).toEqual([2, 2.06, 2.12, 2.18].map((t) => expect.closeTo(t, 9)));
    // The beat grid starts with the clip: a hit at 0.6 s lands on the next quarter note (1.0 s at 120 BPM).
    page.setMusicSettings({ ...page.getMusicSettings(), quantizeToBeat: true });
    const { ctx: ctx2, started: started2 } = fakeOfflineContext();
    const lockedTwin = await page.createOfflineTwin(ctx2 as unknown as BaseAudioContext, () => clock);
    clock = 0.6;
    lockedTwin.playWallHit(0);
    expect(started2.filter((s) => s.kind === "osc").at(-1)?.args[0]).toBeCloseTo(1, 9);
    // The song slicer takes the bounce over: the first slice starts at the clock, from the start of the song.
    const song = { duration: 10, numberOfChannels: 2 } as unknown as AudioBuffer;
    page.setMusicSettings({ ...page.getMusicSettings(), quantizeToBeat: false });
    page.getMusicBed().setBuffer(null);
    page.getSlicer().setBuffer(song);
    page.getSlicer().setEnabled(true);
    const { ctx: ctx3, started: started3 } = fakeOfflineContext();
    const slicing = await page.createOfflineTwin(ctx3 as unknown as BaseAudioContext, () => clock);
    clock = 3;
    slicing.playWallHit(0);
    expect(started3).toEqual([{ kind: "source", args: [3, 0, 0.25] }]);
    clock = 3.5;
    expect(slicing.getSliceProgress()).toBeCloseTo(0.025, 9);
    // The page's own generator never started (no AudioContext of its own was needed).
    expect(page.isActive()).toBe(false);
  });

  it("keeps hit-sample voices that have played out from stealing later ones when the whole clip is scheduled up front", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const { ctx, started, cancelled } = fakeOfflineContext();
    const sampler = new HitSampler(ctx as unknown as AudioContext, { connect: () => undefined } as unknown as AudioNode);
    await sampler.load("/hitSounds/click.wav");
    for (let i = 0; i < 12; i++) sampler.play(1, i * 0.5);
    expect(started.filter((s) => s.kind === "source")).toHaveLength(12);
    expect(cancelled).toEqual([]);
    // Nine voices that really overlap still steal the oldest one.
    for (let i = 0; i < 9; i++) sampler.play(1, 20 + i * 0.01);
    expect(cancelled.length).toBeGreaterThan(0);
  });
});
