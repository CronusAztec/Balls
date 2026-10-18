/*
 * --- clip-editor --- Encodes the cut (spec.ts) of a finished video into a new file, in the browser: the source plays in a
 * <video> element stepped frame by frame, each frame is composed by draw.ts into a 1080 × 1920 canvas and encoded with
 * WebCodecs into the container the fast export uses (lib/recording/fastRender.ts picks the format and makes the muxer), and
 * the source's sound – decoded whole, cut, faded and padded under the end card – follows it. The website and the Windows
 * app, which runs the same page, share this renderer: the app only saves the bytes it is handed, as it does with every
 * export. --- free-watermark --- The run seals once and draw.ts stamps every frame with that seal: a cut of a watermarked
 * export comes out watermarked again, at the output's size, and never clean without a verified Pro licence.
 */
import { FastRenderUnsupportedError, createMuxer, drainQueue, pickExportFormat, yieldTask } from "@/lib/recording/fastRender";
import { AUDIO_BITRATE, EXPORT_CHANNELS, EXPORT_SAMPLE_RATE, audioChunks, audioTimestampUs, frameDurationUs, frameTimestampUs, isKeyFrame, videoBitrate, type ExportFormat } from "@/lib/recording/fastRenderPlan";
import { sealVerdict, sealWatermark } from "@/lib/watermark/seal";
import { drawEditFrame, type EditCardText } from "./draw";
import { CLIP_EDIT_OUTPUT, audioGainAt, clipTimeline, fitClipEdit, sourceTimeAt, type ClipEditSpec, type ClipTimeline } from "./spec";

export type ClipEditPhase = "prepare" | "frames" | "audio" | "finish";

export interface ClipEditProgress {
  phase: ClipEditPhase;
  /** 0..1 over the whole render. */
  progress: number;
  frame: number;
  frames: number;
}

export interface ClipEditOptions {
  source: Blob;
  spec: ClipEditSpec;
  card: EditCardText;
  signal?: AbortSignal;
  onProgress?: (p: ClipEditProgress) => void;
}

export interface ClipEditResult {
  blob: Blob;
  format: ExportFormat;
  durationSec: number;
  frames: number;
  /** The spec as rendered (fitted to the source's length). */
  spec: ClipEditSpec;
  watermarked: boolean;
}

/** A seek that does not land within this long means the file cannot be stepped through (a recording without an index). */
const SEEK_TIMEOUT_MS = 8000;
/** A frame already within half a frame of its time is not sought again (a seek to the same time never fires `seeked`). */
const SEEK_SLACK_SEC = 0.5 / CLIP_EDIT_OUTPUT.fps;

function progressOf(phase: ClipEditPhase, fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  if (phase === "prepare") return 0.05 * f;
  if (phase === "frames") return 0.05 + 0.8 * f;
  if (phase === "audio") return 0.85 + 0.12 * f;
  return 0.97 + 0.03 * f;
}

/** Loads the source into a <video> ready to seek; resolves with it and its length. */
export function openSourceVideo(source: Blob, signal?: AbortSignal): Promise<{ video: HTMLVideoElement; durationSec: number; release: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const release = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    let settled = false;
    const onAbort = () => fail("cancelled");
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      release();
      reject(new Error(why));
    };
    video.onerror = () => fail("This video cannot be opened in the browser");
    video.onloadedmetadata = () => {
      const settle = (durationSec: number) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve({ video, durationSec, release });
      };
      // A recording from MediaRecorder reports Infinity until it is sought to the end once.
      if (Number.isFinite(video.duration) && video.duration > 0) settle(video.duration);
      else {
        video.onseeked = () => {
          video.onseeked = null;
          settle(Number.isFinite(video.duration) ? video.duration : video.currentTime);
          video.currentTime = 0;
        };
        video.currentTime = 1e6;
      }
    };
    if (signal?.aborted) return fail("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    video.src = url;
  });
}

/** Shows `timeSec` in the video (resolves once the frame is there). */
export function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const target = Math.max(0, Math.min(timeSec, Number.isFinite(video.duration) ? video.duration : timeSec));
  if (Math.abs(video.currentTime - target) < SEEK_SLACK_SEC && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.onseeked = null;
      reject(new Error("This video cannot be stepped through frame by frame: export it again from the studio and cut that file"));
    }, SEEK_TIMEOUT_MS);
    video.onseeked = () => {
      clearTimeout(timer);
      video.onseeked = null;
      // The frame is painted on the next tick, not at `seeked`: one callback later it is safe to draw.
      if (typeof video.requestVideoFrameCallback === "function") {
        let done = false;
        video.requestVideoFrameCallback(() => {
          done = true;
          resolve();
        });
        setTimeout(() => !done && resolve(), 50);
      } else resolve();
    };
    video.currentTime = target;
  });
}

/** The source's sound as stereo float planes at the export rate, or null when it has none. */
async function decodeSourceAudio(source: Blob): Promise<AudioBuffer | null> {
  try {
    const bytes = await source.arrayBuffer();
    const ctx = new OfflineAudioContext({ numberOfChannels: EXPORT_CHANNELS, length: 1, sampleRate: EXPORT_SAMPLE_RATE });
    return await ctx.decodeAudioData(bytes);
  } catch {
    return null;
  }
}

/** The output's sound: the source's cut at `spec.startSec`, faded under the action's end, silence under the card. */
export function cutAudio(decoded: AudioBuffer | null, spec: ClipEditSpec, timeline: ClipTimeline, sampleRate = EXPORT_SAMPLE_RATE): Float32Array[] {
  const total = Math.round(timeline.totalSec * sampleRate);
  const out = Array.from({ length: EXPORT_CHANNELS }, () => new Float32Array(total));
  if (!decoded) return out;
  const from = Math.round(spec.startSec * sampleRate);
  const actionFrames = Math.min(total, Math.round(timeline.actionSec * sampleRate));
  for (let c = 0; c < EXPORT_CHANNELS; c++) {
    const src = decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1));
    const dst = out[c];
    for (let i = 0; i < actionFrames; i++) {
      const j = from + i;
      if (j >= src.length) break;
      dst[i] = src[j] * audioGainAt(timeline, i / sampleRate);
    }
  }
  return out;
}

/**
 * Renders the cut. Resolves with the file, or null when `signal` aborted it; throws `FastRenderUnsupportedError` when the
 * browser cannot encode any supported format.
 */
export async function renderClipEdit(options: ClipEditOptions): Promise<ClipEditResult | null> {
  // --- free-watermark --- the stored licence, verified again now, decides whether this cut's frames get the mark
  const seal = await sealWatermark();
  const { width, height, fps } = CLIP_EDIT_OUTPUT;
  const { signal } = options;
  const report = (phase: ClipEditPhase, fraction: number, frame: number, frames: number) => options.onProgress?.({ phase, progress: progressOf(phase, fraction), frame, frames });
  report("prepare", 0, 0, 0);

  const format = await pickExportFormat(width, height, fps);
  if (!format) throw new FastRenderUnsupportedError();
  if (signal?.aborted) return null;

  const opened = await openSourceVideo(options.source, signal);
  const { video } = opened;
  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;
  try {
    const spec = fitClipEdit(options.spec, opened.durationSec);
    const timeline = clipTimeline(spec, fps);
    const sourceSize = { width: video.videoWidth || width, height: video.videoHeight || height };
    const decodedAudio = decodeSourceAudio(options.source);
    report("prepare", 1, 0, timeline.frames);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");

    const muxer = await createMuxer(format, width, height, fps);
    let failure: unknown = null;
    videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
    videoEncoder.configure({ codec: format.videoCodec, width, height, bitrate: videoBitrate(width, height, fps), framerate: fps, latencyMode: "quality", ...(format.videoTrackCodec === "avc" ? { avc: { format: "avc" as const } } : {}) });

    let lastYield = performance.now();
    for (let index = 0; index < timeline.frames; index++) {
      if (signal?.aborted) return null;
      const t = index / fps;
      // The card holds the action's last frame: no seeking past it.
      if (t <= timeline.actionSec) await seekVideo(video, sourceTimeAt(spec, t));
      drawEditFrame(ctx, { image: video, ...sourceSize }, width, height, spec, timeline, t, options.card, { seal, clipMs: t * 1000 });
      const frame = new VideoFrame(canvas, { timestamp: frameTimestampUs(index, fps), duration: frameDurationUs(index, fps) });
      videoEncoder.encode(frame, { keyFrame: isKeyFrame(index, fps) });
      frame.close();
      if (failure) throw failure;
      await drainQueue(videoEncoder, 6);
      if (performance.now() - lastYield > 80) {
        report("frames", (index + 1) / timeline.frames, index + 1, timeline.frames);
        await yieldTask();
        lastYield = performance.now();
      }
    }
    await videoEncoder.flush();
    if (failure) throw failure;
    videoEncoder.close();
    videoEncoder = null;
    if (signal?.aborted) return null;

    report("audio", 0, timeline.frames, timeline.frames);
    const channels = cutAudio(await decodedAudio, spec, timeline);
    audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
    audioEncoder.configure({ codec: format.audioCodec, sampleRate: EXPORT_SAMPLE_RATE, numberOfChannels: EXPORT_CHANNELS, bitrate: AUDIO_BITRATE });
    const chunks = audioChunks(channels[0].length);
    for (let i = 0; i < chunks.length; i++) {
      const { offset, frames } = chunks[i];
      const planar = new Float32Array(frames * EXPORT_CHANNELS);
      for (let c = 0; c < EXPORT_CHANNELS; c++) planar.set(channels[c].subarray(offset, offset + frames), c * frames);
      const data = new AudioData({ format: "f32-planar", sampleRate: EXPORT_SAMPLE_RATE, numberOfFrames: frames, numberOfChannels: EXPORT_CHANNELS, timestamp: audioTimestampUs(offset), data: planar });
      audioEncoder.encode(data);
      data.close();
      if (failure) throw failure;
      if (i % 64 === 0) {
        await drainQueue(audioEncoder, 32);
        report("audio", i / chunks.length, timeline.frames, timeline.frames);
        await yieldTask();
        if (signal?.aborted) return null;
      }
    }
    await audioEncoder.flush();
    if (failure) throw failure;
    audioEncoder.close();
    audioEncoder = null;

    report("finish", 0, timeline.frames, timeline.frames);
    const blob = new Blob([muxer.finalize()], { type: format.mimeType });
    report("finish", 1, timeline.frames, timeline.frames);
    return { blob, format, durationSec: timeline.totalSec, frames: timeline.frames, spec, watermarked: sealVerdict(seal) === "marked" };
  } finally {
    try {
      if (videoEncoder && videoEncoder.state !== "closed") videoEncoder.close();
      if (audioEncoder && audioEncoder.state !== "closed") audioEncoder.close();
    } catch {
      /* already closed */
    }
    opened.release();
  }
}
