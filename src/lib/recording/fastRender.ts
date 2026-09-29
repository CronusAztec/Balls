import type { PhysicsEngine } from "@/lib/physics/engine";
import type { SoundEvent } from "@/lib/physics/types";
import type { ChirpKind } from "@/lib/audio/characterVoice";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { drawRecordingFrame, recordingTextLayout, type RecordingCrop, type RecordingTextOverlay } from "./recorder";
import {
  AUDIO_BITRATE,
  DIGEST_EVERY,
  EXPORT_CHANNELS,
  EXPORT_EPOCH_MS,
  EXPORT_SAMPLE_RATE,
  ExportEndTracker,
  NO_END_HOLDS,
  SIM_FRAME_MS,
  audioChunks,
  audioFrameCount,
  audioTimestampUs,
  exportDurationSec,
  exportFrameIndex,
  exportProgress,
  fnv1a,
  frameDurationUs,
  frameTimestampUs,
  isKeyFrame,
  maxSimFrames,
  offlineAudioSeconds,
  offlineCanvasLayout,
  seededRandom,
  selectExportFormat,
  simFrameTimeMs,
  videoBitrate,
  type EndHolds,
  type ExportFormat,
  type FastExportPhase,
} from "./fastRenderPlan";

/**
 * Faster-than-realtime export ("Fast export"): renders a clip offline instead of recording the screen.
 *
 * A fresh engine (set up like the page's, for the run's seed) is stepped in fixed 60 Hz frames by a second, hidden
 * instance of the page's canvas (`Canvas.tsx` in offline mode, mounted through `FastRenderHost` by
 * `components/simulator/fastRenderCanvas.tsx`), which draws every frame with the very same draw routine into a canvas
 * sized for the export and reads this export's clock instead of the wall clock. Each frame is composed into the export
 * frame like the real-time recorder composes it (`drawRecordingFrame()`: letterbox background, Top / Bottom Text) and
 * encoded with WebCodecs – H.264 into MP4 (mp4-muxer) where the browser can, else VP9 / VP8 into WebM (webm-muxer); see
 * `selectExportFormat()`. The frame's sound events are scheduled into an OfflineAudioContext through a copy of the page's
 * ToneGenerator (`createOfflineTwin()`: tones, melody, hit samples, song slices, the ducked music bed, the characters'
 * chirps), which is rendered once the frames are done, encoded with AudioEncoder (AAC or Opus) and muxed in.
 *
 * Reproducible: while a frame renders, `Math.random` is a generator seeded from the run's seed and `Date.now()` the export
 * clock, so the confetti, shakes and hit glows – everything the engine and the renderers do outside the physics' own
 * seeded generator – replay identically: the same seed and settings give the same frames (`digest`) every time.
 * The run's end follows the page's recorder exactly (`ExportEndTracker`). The page falls back to the real-time recorder
 * where WebCodecs is missing (`fastRenderSupported()`).
 */

/** What the offline canvas hands the export once it is mounted (Canvas.tsx, `offline` prop). */
export interface OfflineFrameRenderer {
  /** The canvas the frames are drawn into: the world at the driver's scale (device px). */
  readonly canvas: HTMLCanvasElement;
  /** Draws the next frame at the driver's clock: advances the engine exactly as the page's loop does, then draws it. */
  renderFrame(): void;
  /** A wall broke (a "gap" sound event): the ball characters look shocked, as on the page. */
  noteWallBreak(): void;
  /** Song slicer position (0–1) for the progress bar along the bottom edge; null hides it. */
  setSongProgress(progress: number | null): void;
  /** True while the canvas holds the end screen back (the escape replay, a caption's answer). */
  holdsEndScreen(): boolean;
  /** Paints the export frame's background (theme gradient / picture, so the letterbox bars continue it). */
  paintBackground(ctx: CanvasRenderingContext2D, width: number, height: number, crop: RecordingCrop): void;
  /** True once the pictures a frame needs (ball image, background picture, Picture Paint picture) are decoded. */
  ready(): boolean;
}

/** The export's side of the offline canvas: its size, its clock and the slot the canvas registers its renderer in. */
export interface OfflineCanvasDriver {
  /** The engine's world (the page canvas in CSS px). */
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** Device pixels per CSS px the frames are drawn at (`offlineCanvasLayout()`). */
  readonly scale: number;
  /** The export frame, which the canvas' captions keep clear of the Top / Bottom Text in. */
  readonly exportWidth: number;
  readonly exportHeight: number;
  /** One frame on the export clock (ms). */
  readonly frameMs: number;
  /** The export clock (ms since the clip started), which the canvas reads instead of `performance.now()`. */
  now(): number;
  attach(renderer: OfflineFrameRenderer | null): void;
}

/** One fast export in progress, as the page's canvas wrapper renders it (a hidden canvas instance on `engine`). */
export interface FastRenderJob {
  id: number;
  engine: PhysicsEngine;
  driver: OfflineCanvasDriver;
  /** A cat face chirped on the offline canvas: the chirp goes into the export's mix. */
  onChirp: (kind: ChirpKind) => void;
  /** The page's run key of the race being exported (race mode only): the export's cup table scores the race under it. */
  raceKey?: string;
}

/** Hands the job in progress to the canvas wrapper (a tiny store for `useSyncExternalStore`). */
export class FastRenderHost {
  private job: FastRenderJob | null = null;
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getJob = (): FastRenderJob | null => this.job;
  start(job: FastRenderJob) {
    this.job = job;
    for (const l of this.listeners) l();
  }
  stop() {
    if (!this.job) return;
    this.job = null;
    for (const l of this.listeners) l();
  }
}

export interface FastRenderProgress {
  phase: FastExportPhase;
  /** Overall progress 0–1 (`exportProgress()`). */
  progress: number;
  /** Frames encoded so far and the frames of the full clip length. */
  frame: number;
  frames: number;
  /** Seconds of the clip rendered so far. */
  clipSec: number;
  /** Wall-clock ms since the export started. */
  elapsedMs: number;
}

export interface FastRenderOptions {
  host: FastRenderHost;
  /** A fresh engine set up like the page's for `seed` (its run starts at the first step). Called inside the seeded sandbox. */
  createEngine: () => PhysicsEngine;
  seed: number;
  /** The page canvas in CSS px – the engine's width and height. */
  world: { width: number; height: number };
  resolution: { width: number; height: number };
  /** The clip length (s): the export ends there, or earlier when the run finishes (see `ExportEndTracker`). */
  durationSec: number;
  fps: number;
  /** The page's tone generator: its sound settings, melody, samples, song and music bed are copied into the offline mix. */
  audio: ToneGenerator | null;
  /** The page's holds between the run's end and its end screen (winner banner, finished picture…); called once the run is over. */
  endHolds?: (engine: PhysicsEngine) => EndHolds;
  /** Race mode: the page's run key of the exported race (`runKey()`), so the export's cup table matches the page's. */
  raceKey?: string;
  textOverlay: RecordingTextOverlay;
  backgroundColor: string;
  onProgress?: (progress: FastRenderProgress) => void;
  signal?: AbortSignal;
}

export interface FastRenderResult {
  blob: Blob;
  format: ExportFormat;
  /** Length of the exported clip (s). */
  durationSec: number;
  frames: number;
  /** Wall-clock time the export took (ms). */
  wallMs: number;
  /** Hash of sampled, downscaled frames: equal for two exports of the same seed and settings. */
  digest: string;
}

/** Thrown when the browser has WebCodecs but no codec pair the export can write. */
export class FastRenderUnsupportedError extends Error {
  constructor() {
    super("No supported video / audio encoder for the fast export");
    this.name = "FastRenderUnsupportedError";
  }
}

/** True when the browser has everything the fast export needs (WebCodecs video + audio, OfflineAudioContext). */
export function fastRenderSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof AudioData !== "undefined" &&
    typeof OfflineAudioContext !== "undefined"
  );
}

/** Plays one engine sound event through `audio` – the page's dispatch (the sound loop in Simulator.tsx); keep the two in step. */
export function playSoundEvent(audio: ToneGenerator, ev: SoundEvent, onWallBreak: () => void) {
  // --- jdm-race --- a pass plays the rising chime, the winner the fanfare
  if (ev.race) {
    audio.playRaceArpeggio(ev.race, ev.frequency);
    return;
  }
  if (ev.bumper) {
    audio.playBumper(ev.frequency);
    return;
  }
  // --- odd-string-battle --- a cut thread's pluck, a ball's shatter
  if (ev.sbSound) {
    audio.playStringBattle(ev.sbSound, ev.frequency);
    return;
  }
  // --- boris-vortex --- a ball swallowed by the Sound Vortex pews
  if (ev.pew) {
    audio.playPew(ev.frequency);
    return;
  }
  if (ev.type === "gap") onWallBreak();
  if (ev.type === "hit") audio.playWallHit(ev.wallIndex, ev.frequency, ev.accent, ev.chord, ev.level, ev.melody !== false);
  else if (ev.type === "gap") audio.playGapPass();
  else if (ev.type === "multiplier") audio.playMultiplier(ev.multiplier ?? 2, ev.melody !== false);
  else audio.playInteraction(ev.type);
}

/** Asks the browser's encoders (the probe `selectExportFormat()` uses). */
async function browserSupportsVideo(codec: string, width: number, height: number, fps: number): Promise<boolean> {
  const support = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps, bitrate: videoBitrate(width, height, fps) });
  return support.supported === true;
}
async function browserSupportsAudio(codec: string): Promise<boolean> {
  const support = await AudioEncoder.isConfigSupported({ codec, sampleRate: EXPORT_SAMPLE_RATE, numberOfChannels: EXPORT_CHANNELS, bitrate: AUDIO_BITRATE });
  return support.supported === true;
}

/** The format the browser can write for this export size, or null. */
export function pickExportFormat(width: number, height: number, fps: number): Promise<ExportFormat | null> {
  if (!fastRenderSupported()) return Promise.resolve(null);
  return selectExportFormat(width, height, fps, { video: (codec) => browserSupportsVideo(codec, width, height, fps), audio: browserSupportsAudio });
}

/** Lets the page breathe (progress bar, Cancel) without the clamping and background throttling of timers. */
function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/** Waits until an encoder has at most `max` frames queued (backpressure, so memory stays flat). */
function drainQueue(encoder: VideoEncoder | AudioEncoder, max: number): Promise<void> {
  if (encoder.encodeQueueSize <= max || encoder.state !== "configured") return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (encoder.encodeQueueSize > max && encoder.state === "configured") return;
      encoder.removeEventListener("dequeue", check);
      clearInterval(poll);
      resolve();
    };
    encoder.addEventListener("dequeue", check);
    const poll = setInterval(check, 20);
  });
}

function abortError(): DOMException {
  return new DOMException("Fast export cancelled", "AbortError");
}

/** The muxer of the chosen container, loaded on demand (the page does not carry it until an export starts). */
interface ExportMuxer {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  /** Writes the file and returns its bytes. */
  finalize(): ArrayBuffer;
}

async function createMuxer(format: ExportFormat, width: number, height: number, fps: number): Promise<ExportMuxer> {
  const audio = { numberOfChannels: EXPORT_CHANNELS, sampleRate: EXPORT_SAMPLE_RATE };
  if (format.container === "mp4") {
    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: "avc", width, height, frameRate: fps }, audio: { codec: format.audioTrackCodec === "aac" ? "aac" : "opus", ...audio }, fastStart: "in-memory" });
    return {
      addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      addAudioChunk: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      finalize: () => {
        muxer.finalize();
        return target.buffer;
      },
    };
  }
  const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: format.videoTrackCodec, width, height, frameRate: fps }, audio: { codec: format.audioTrackCodec, ...audio } });
  return {
    addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    addAudioChunk: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    finalize: () => {
      muxer.finalize();
      return target.buffer;
    },
  };
}

/** Triggers the download of an export (`viralballs-export.mp4` / `.webm`). */
export function downloadExport(blob: Blob, extension: string, baseName = "viralballs-export") {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Renders and encodes the clip. Resolves with the file, or null when `signal` aborted it; throws
 * `FastRenderUnsupportedError` when the browser cannot encode any supported format.
 */
export async function renderFast(options: FastRenderOptions): Promise<FastRenderResult | null> {
  const { host, resolution, fps, signal } = options;
  const width = resolution.width;
  const height = resolution.height;
  const startedAt = performance.now();
  const clipMs = options.durationSec * 1000;
  const expectedFrames = Math.round(options.durationSec * fps);
  const report = (phase: FastExportPhase, fraction: number, frame: number, clipSec: number) =>
    options.onProgress?.({ phase, progress: exportProgress(phase, fraction), frame, frames: expectedFrames, clipSec, elapsedMs: performance.now() - startedAt });
  report("prepare", 0, 0, 0);

  const format = await pickExportFormat(width, height, fps);
  if (!format) throw new FastRenderUnsupportedError();
  if (signal?.aborted) return null;

  // The export clock and the sandbox every frame renders in (seeded Math.random, Date.now on the export clock).
  const clock = { ms: 0 };
  const random = seededRandom(options.seed);
  const exportNow = () => EXPORT_EPOCH_MS + clock.ms;
  const sandbox = <T>(fn: () => T): T => {
    const realRandom = Math.random;
    const realNow = Date.now;
    Math.random = random;
    Date.now = exportNow;
    try {
      return fn();
    } finally {
      Math.random = realRandom;
      Date.now = realNow;
    }
  };

  const layout = offlineCanvasLayout(options.world, resolution);
  const slot: { renderer: OfflineFrameRenderer | null; attached: () => void } = { renderer: null, attached: () => {} };
  const whenAttached = new Promise<void>((resolve) => (slot.attached = resolve));
  const driver: OfflineCanvasDriver = {
    worldWidth: options.world.width,
    worldHeight: options.world.height,
    scale: layout.scale,
    exportWidth: width,
    exportHeight: height,
    frameMs: SIM_FRAME_MS,
    now: () => clock.ms,
    attach: (r) => {
      slot.renderer = r;
      if (r) slot.attached();
    },
  };

  // The offline mix: a copy of the page's sound set-up scheduling into an OfflineAudioContext on the export clock.
  const audioContext = new OfflineAudioContext({ numberOfChannels: EXPORT_CHANNELS, length: audioFrameCount(offlineAudioSeconds(options.durationSec)), sampleRate: EXPORT_SAMPLE_RATE });
  const mix = await (options.audio ?? new ToneGenerator()).createOfflineTwin(audioContext, () => clock.ms / 1000);
  if (signal?.aborted) return null;

  const engine = sandbox(() => options.createEngine());
  host.start({ id: Math.floor(startedAt), engine, driver, onChirp: (kind) => mix.playCharacterChirp(kind), raceKey: options.raceKey });

  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;
  try {
    // The hidden canvas mounts on the next React render; its pictures (ball image, background, paint picture) decode first.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([whenAttached, new Promise<void>((resolve) => (timer = setTimeout(resolve, 10000)))]);
    clearTimeout(timer);
    for (let waited = 0; slot.renderer && !slot.renderer.ready() && waited < 3000; waited += 20) await new Promise((r) => setTimeout(r, 20));
    const frameRenderer = slot.renderer;
    if (!frameRenderer) throw new Error("The offline canvas did not start");
    if (signal?.aborted) return null;

    const muxer = await createMuxer(format, width, height, fps);
    let failure: unknown = null;
    videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
    videoEncoder.configure({
      codec: format.videoCodec,
      width,
      height,
      bitrate: videoBitrate(width, height, fps),
      framerate: fps,
      latencyMode: "quality",
      ...(format.container === "mp4" ? { avc: { format: "avc" as const } } : {}),
    });

    // The export frame (letterbox background, the square of the world, Top / Bottom Text) and the digest's thumbnail.
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = width;
    frameCanvas.height = height;
    const frameCtx = frameCanvas.getContext("2d");
    const thumb = document.createElement("canvas");
    thumb.width = thumb.height = 16;
    const thumbCtx = thumb.getContext("2d", { willReadFrequently: true });
    if (!frameCtx || !thumbCtx) throw new Error("Canvas 2D is not available");
    const textLayout = recordingTextLayout(width, height, options.textOverlay.textSize ?? 1);
    const composeOptions = { textOverlay: options.textOverlay, drawBackground: (c: CanvasRenderingContext2D, w: number, h: number, crop: RecordingCrop) => frameRenderer.paintBackground(c, w, h, crop) };
    let digest = 0x811c9dc5;

    const tracker = new ExportEndTracker(clipMs);
    const lastFrame = maxSimFrames(options.durationSec);
    let bedStopped = false;
    let exported = 0;
    let lastYield = performance.now();
    for (let simFrame = 0; simFrame < lastFrame; simFrame++) {
      const t = simFrameTimeMs(simFrame);
      if (simFrame > 0 && t >= tracker.endMs) break;
      if (signal?.aborted) throw abortError();
      if (failure) throw failure;
      clock.ms = t;
      sandbox(() => {
        frameRenderer.renderFrame();
        for (const ev of engine.consumeSoundEvents()) playSoundEvent(mix, ev, () => frameRenderer.noteWallBreak());
        frameRenderer.setSongProgress(mix.getSliceProgress());
        const finished = engine.isSimulationFinished();
        tracker.frame(t, finished, frameRenderer.holdsEndScreen(), finished && options.endHolds ? options.endHolds(engine) : NO_END_HOLDS);
        // The page stops the music bed when its end screen appears; the recorder keeps rolling for another half second.
        if (tracker.finishedAt !== null && !bedStopped) {
          mix.getMusicBed().stop();
          bedStopped = true;
        }
      });
      const index = exportFrameIndex(simFrame, fps);
      if (index < 0) continue;
      drawRecordingFrame(frameCtx, frameRenderer.canvas, width, height, options.backgroundColor, composeOptions, textLayout);
      const frame = new VideoFrame(frameCanvas, { timestamp: frameTimestampUs(index, fps), duration: frameDurationUs(index, fps) });
      videoEncoder.encode(frame, { keyFrame: isKeyFrame(index, fps) });
      frame.close();
      if (index % DIGEST_EVERY === 0) {
        thumbCtx.drawImage(frameCanvas, 0, 0, 16, 16);
        digest = fnv1a(thumbCtx.getImageData(0, 0, 16, 16).data, digest);
      }
      exported = index + 1;
      await drainQueue(videoEncoder, 6);
      if (performance.now() - lastYield > 32) {
        report("frames", expectedFrames > 0 ? exported / expectedFrames : 1, exported, t / 1000);
        await yieldTask();
        lastYield = performance.now();
      }
    }
    host.stop();
    await videoEncoder.flush();
    if (failure) throw failure;
    videoEncoder.close();
    videoEncoder = null;
    if (signal?.aborted) return null;

    // The mix, cut to the length of the video, encoded in chunks after the frames.
    const durationSec = exportDurationSec(exported, fps);
    report("audio", 0, exported, durationSec);
    const rendered = await audioContext.startRendering();
    if (signal?.aborted) return null;
    audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
    audioEncoder.configure({ codec: format.audioCodec, sampleRate: EXPORT_SAMPLE_RATE, numberOfChannels: EXPORT_CHANNELS, bitrate: AUDIO_BITRATE });
    const total = Math.min(rendered.length, audioFrameCount(durationSec));
    const channels = Array.from({ length: EXPORT_CHANNELS }, (_, c) => rendered.getChannelData(Math.min(c, rendered.numberOfChannels - 1)));
    const chunks = audioChunks(total);
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
        report("audio", i / chunks.length, exported, durationSec);
        await yieldTask();
        if (signal?.aborted) return null;
      }
    }
    await audioEncoder.flush();
    if (failure) throw failure;
    audioEncoder.close();
    audioEncoder = null;

    report("finish", 0, exported, durationSec);
    const blob = new Blob([muxer.finalize()], { type: format.mimeType });
    report("finish", 1, exported, durationSec);
    return { blob, format, durationSec, frames: exported, wallMs: performance.now() - startedAt, digest: digest.toString(16).padStart(8, "0") };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  } finally {
    host.stop();
    for (const encoder of [videoEncoder, audioEncoder]) {
      if (encoder && encoder.state !== "closed") {
        try {
          encoder.close();
        } catch {
          /* already closed */
        }
      }
    }
  }
}
