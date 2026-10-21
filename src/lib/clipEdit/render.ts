/*
 * --- clip-editor --- Encodes the cut (spec.ts) of a finished video into a new file, in the browser: the source plays in a
 * <video> element stepped frame by frame, each frame is composed by draw.ts into a 1080 × 1920 canvas and encoded with
 * WebCodecs into the container the fast export uses (lib/recording/fastRender.ts picks the format and makes the muxer), and
 * the source's sound – decoded whole, cut, faded and padded under the end card – follows it. The website and the Windows
 * app, which runs the same page, share this renderer: the app only saves the bytes it is handed, as it does with every
 * export. --- free-watermark --- The run seals once and draw.ts stamps every frame with that seal: a cut of a watermarked
 * export comes out watermarked again, at the output's size, and never clean without a verified Pro licence. --- legal-audit ---
 * So does a Fight League source's fan-made badge (`fanMade`) wherever the crop-in cuts the source's own away or the card covers it.
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
  /** --- legal-audit --- The fan-made badge every frame carries again (fanMadeLine(): a Fight League source's), or null. */
  fanMade: string | null;
  /** --- cut-reedit --- The source is a cut file (draw.ts burnedBadgeShows: its own badge is whole only with no crop-in). */
  cutFile?: boolean;
  /** --- badge-safe --- The source's frames are known to carry the fan-made badge (draw.ts EditFrameMark.fanMadeBurned); absent, it is drawn on every frame. */
  fanMadeBurned?: boolean;
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

/** --- clip-locale --- The browser cannot decode the source (a format or codec it lacks): the page says ClipEditor.cannotOpen. */
export class ClipEditOpenError extends Error {
  constructor() {
    super("This video cannot be opened in the browser");
    this.name = "ClipEditOpenError";
  }
}

/** --- clip-locale --- A seek never landed (a recording without an index): the page says ClipEditor.cannotSeek. */
export class ClipEditSeekError extends Error {
  constructor() {
    super("This video cannot be stepped through frame by frame: export it again from the studio and cut that file");
    this.name = "ClipEditSeekError";
  }
}

/** --- clip-locale --- The ClipEditor key that words a failure the editor expects (the browser, the file), null for any other. */
export function clipEditErrorKey(err: unknown): "unsupported" | "cannotOpen" | "cannotSeek" | null {
  if (err instanceof FastRenderUnsupportedError) return "unsupported";
  if (err instanceof ClipEditOpenError) return "cannotOpen";
  if (err instanceof ClipEditSeekError) return "cannotSeek";
  return null;
}

/** A frame already within half a frame of its time is not sought again (a seek to the same time never fires `seeked`). */
const SEEK_SLACK_SEC = 0.5 / CLIP_EDIT_OUTPUT.fps;

/**
 * --- clip-a11y --- What the dialog's live region says of a render: its phase, with the whole render's progress in quarters,
 * so a screen reader hears a handful of updates and not one every few frames (the bar and its line show every step).
 */
export function liveProgress(p: Pick<ClipEditProgress, "phase" | "progress">): { phase: ClipEditPhase; percent: number } {
  return { phase: p.phase, percent: Math.min(3, Math.floor(Math.min(1, Math.max(0, p.progress)) * 4)) * 25 };
}

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
    const onAbort = () => fail(new Error("cancelled"));
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      release();
      reject(err);
    };
    video.onerror = () => fail(new ClipEditOpenError());
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
    if (signal?.aborted) return fail(new Error("cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });
    video.src = url;
  });
}

/**
 * --- seek-supersede --- The seek under way on each video. A newer seek settles it at once (its caller's frame is stale by
 * then) and stops its timer, so a seek's timeout never clears the handler of a seek that came after it.
 */
const pendingSeeks = new WeakMap<HTMLVideoElement, () => void>();

/** --- hidden-render --- Whether the page is on screen: a hidden one runs no rendering steps and throttles its timers. */
const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/**
 * Shows `timeSec` in the video (resolves once the frame is there). A seek superseded by a newer one on the same video
 * resolves at once, without its frame.
 */
export function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const target = Math.max(0, Math.min(timeSec, Number.isFinite(video.duration) ? video.duration : timeSec));
  pendingSeeks.get(video)?.();
  if (!video.seeking && Math.abs(video.currentTime - target) < SEEK_SLACK_SEC && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (video.onseeked === onSeeked) video.onseeked = null; // only its own handler: a newer seek's stays
      if (pendingSeeks.get(video) === supersede) pendingSeeks.delete(video);
      if (err) reject(err);
      else resolve();
    };
    const supersede = () => settle();
    const onSeeked = () => {
      if (video.seeking) return; // a newer position is being sought: its own `seeked` comes next
      clearTimeout(timer);
      if (video.onseeked === onSeeked) video.onseeked = null;
      // The frame is painted on the next tick, not at `seeked`: one callback later it is safe to draw. --- hidden-render --- A
      // hidden page gets no video frame callbacks and its timers wake about once a second, so it waits one task instead, the
      // way the fast export yields (a 375-frame cut would otherwise take minutes in a background tab).
      if (typeof video.requestVideoFrameCallback === "function" && pageVisible()) {
        video.requestVideoFrameCallback(() => settle());
        setTimeout(() => settle(), 50);
      } else void yieldTask().then(() => settle());
    };
    const timer = setTimeout(() => settle(new ClipEditSeekError()), SEEK_TIMEOUT_MS);
    pendingSeeks.set(video, supersede);
    video.onseeked = onSeeked;
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
 * browser cannot encode any supported format, `ClipEditOpenError` or `ClipEditSeekError` when it cannot read the source.
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

  let opened: Awaited<ReturnType<typeof openSourceVideo>>;
  try {
    opened = await openSourceVideo(options.source, signal);
  } catch (err) {
    if (signal?.aborted) return null; // cancelled while the source was loading: not a failure
    throw err;
  }
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
      drawEditFrame(ctx, { image: video, ...sourceSize }, width, height, spec, timeline, t, options.card, { seal, clipMs: t * 1000, fanMade: options.fanMade, cutFile: options.cutFile === true, fanMadeBurned: options.fanMadeBurned === true });
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
    if (signal?.aborted) return null; // --- cut-cancel --- cancelled while the sound was flushed: no file

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
