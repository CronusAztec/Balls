/**
 * Faster-than-realtime export ("Fast export") – the pure bookkeeping, free of the DOM and of WebCodecs so it is unit-tested
 * (tests/fastRender.test.ts): the frame / time arithmetic, the export layout, the codec strings and the order they are
 * tried in, the bitrates, the audio chunks, the end-of-run rule the page's real-time recorder follows, and the seeded
 * generator and frame digest that make the export reproducible. fastRender.ts renders and encodes with these.
 *
 * Time model: the simulation and the renderer always advance in 60 Hz frames (`SIM_FPS`). Simulation frame `j` is drawn
 * at `j · 16.67 ms` on the export clock, shows the run after `j` physics steps and is where the sounds of its step are
 * scheduled (audio time `j / 60` s). An export at 30 fps keeps every second frame, so its sounds stay on the 60 Hz grid.
 */

/** The rate the engine steps and the canvas draws at, whatever the export frame rate. */
export const SIM_FPS = 60;
/** One simulation frame on the export clock (ms). */
export const SIM_FRAME_MS = 1000 / SIM_FPS;

/** Frame rates the fast export offers (setting `fastExportFps`, URL `xfps`). */
export const FAST_EXPORT_FPS = [30, 60] as const;
export type FastExportFps = (typeof FAST_EXPORT_FPS)[number];
export const DEFAULT_FAST_EXPORT_FPS: FastExportFps = 60;
/** Slider-style range of the setting (the panel offers the two values; links and presets are snapped onto them). */
export const FAST_EXPORT_RANGES = { fastExportFps: { min: 30, max: 60, step: 30 } } as const;
export const DEFAULT_FAST_EXPORT_SETTINGS: { fastExportFps: number } = { fastExportFps: DEFAULT_FAST_EXPORT_FPS };

/**
 * The export's frame rate: --- uncap-all --- any finite rate from 30 up, as typed (the panel's 30 and 60 are its buttons,
 * the number field takes any other); anything that is not a number is the default. Past 60 the simulation's frames are
 * held for several export frames (the simulation runs at 60 Hz), between 30 and 60 some are dropped.
 */
export function resolveFastExportFps(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_FAST_EXPORT_FPS;
  return n < FAST_EXPORT_RANGES.fastExportFps.min ? FAST_EXPORT_RANGES.fastExportFps.min : n;
}

/** The fast-export settings of a settings object, validated (links and presets). */
export function resolveFastExportSettings(settings: { fastExportFps?: unknown }): { fastExportFps: number } {
  return { fastExportFps: resolveFastExportFps(settings.fastExportFps) };
}

/* ------------------------------------------------------------------ frames and time */

/** Simulation frames per exported frame: 1 at 60 fps, 2 at 30 fps. */
export function simFramesPerExportFrame(fps: number): number {
  return Math.max(1, Math.round(SIM_FPS / Math.max(1, fps)));
}

/** The export clock (ms) of simulation frame `j` (exact on every whole 1/60 s: 60 frames are 1000 ms, not 999.99…). */
export function simFrameTimeMs(simFrame: number): number {
  return (simFrame * 1000) / SIM_FPS;
}

/** Index of the exported frame simulation frame `j` becomes, or −1 when it is skipped (30 fps keeps every second one). */
export function exportFrameIndex(simFrame: number, fps: number): number {
  const [first, end] = exportFrameRange(simFrame, fps);
  return end > first ? first : -1;
}

/**
 * --- uncap-all --- The exported frames simulation frame `j` becomes, `[first, end)`: frame i shows the simulation frame of
 * its own time (⌊i · 60 / fps⌋), so at 60 fps every simulation frame is one export frame, at 30 every second one, at 45
 * three of every four and at 240 each is held for four – any rate, the simulation's 60 Hz untouched.
 */
export function exportFrameRange(simFrame: number, fps: number): [number, number] {
  if (!(fps > 0)) return [0, 0];
  if (fps === SIM_FPS) return [simFrame, simFrame + 1];
  if (fps === SIM_FPS / 2) return simFrame % 2 === 0 ? [simFrame / 2, simFrame / 2 + 1] : [0, 0];
  return [Math.ceil((simFrame * fps) / SIM_FPS - 1e-9), Math.ceil(((simFrame + 1) * fps) / SIM_FPS - 1e-9)];
}

/** Presentation time of exported frame `i` in µs (rounded per frame, so a long clip never drifts). */
export function frameTimestampUs(index: number, fps: number): number {
  return Math.round((index * 1_000_000) / fps);
}

/** Duration of exported frame `i` in µs: up to the next frame's timestamp (the durations add up to the clip exactly). */
export function frameDurationUs(index: number, fps: number): number {
  return frameTimestampUs(index + 1, fps) - frameTimestampUs(index, fps);
}

/** Seconds between two key frames (players can seek, and WebM clusters stay short). */
export const KEYFRAME_INTERVAL_SEC = 2;

/** Whether exported frame `i` is a key frame: the first one and then every `intervalSec`. */
export function isKeyFrame(index: number, fps: number, intervalSec = KEYFRAME_INTERVAL_SEC): boolean {
  return index % Math.max(1, Math.round(fps * intervalSec)) === 0;
}

/** Length of a clip of `frames` exported frames (s). */
export function exportDurationSec(frames: number, fps: number): number {
  return frames / fps;
}

/* ------------------------------------------------------------------ the end of the clip (the page's recorder rule) */

/** The page's recorder stops this long after the end screen appears (Simulator: "stop the recording shortly after the run finishes"). */
export const END_STOP_DELAY_MS = 500;
/** When the clip length runs out after the run finished, the recorder waits this long at most for the end-of-run hold. */
export const END_HOLD_FALLBACK_MS = 12000;

/** The page's holds between the end of a run and its end screen (Simulator's finish detection). */
export interface EndHolds {
  /** Held from the first finished frame, before the camera's replay is looked at: a finished picture (Paint), a revealed whitespace picture (Circle Illusion). */
  preMs: number;
  /** Held once nothing else holds the end screen back: the winner banner (teams), a multipliers finish. */
  postMs: number;
}

export const NO_END_HOLDS: EndHolds = { preMs: 0, postMs: 0 };

/**
 * The frame-by-frame end of a fast export, following the page exactly: the run's own finish, the page's holds (a finished
 * picture, the escape replay the canvas plays, the winner banner) – the moment the end screen would appear is `finishedAt`
 * –, then the recorder's 0.5 s, or the clip length; a run that is already over when the clip length runs out but still
 * holding (the replay, the banner) gets up to `END_HOLD_FALLBACK_MS` more, as on the page.
 */
export class ExportEndTracker {
  /** Export clock (ms) of the first frame whose run counted as finished, i.e. when the page shows its end screen (null: not yet). */
  finishedAt: number | null = null;
  private firstDoneAt: number | null = null;
  private holdStart: number | null = null;
  private finishedBeforeClipEnd = false;

  constructor(
    readonly clipMs: number,
    private readonly stopDelayMs = END_STOP_DELAY_MS,
    private readonly fallbackMs = END_HOLD_FALLBACK_MS,
  ) {}

  /**
   * Feeds the frame drawn at `tMs`: `runFinished` is `engine.isSimulationFinished()`, `endScreenHeld` the canvas' own hold
   * (the escape replay, a caption's answer) and `holds` the page's holds for this run.
   */
  frame(tMs: number, runFinished: boolean, endScreenHeld: boolean, holds: EndHolds = NO_END_HOLDS): void {
    if (tMs < this.clipMs) this.finishedBeforeClipEnd = runFinished;
    if (this.finishedAt !== null) return;
    let done = runFinished;
    if (done && holds.preMs > 0) {
      if (this.firstDoneAt === null) this.firstDoneAt = tMs;
      if (tMs - this.firstDoneAt < holds.preMs) done = false;
    } else this.firstDoneAt = null;
    if (done && endScreenHeld) done = false;
    const post = done ? holds.postMs : 0;
    if (post > 0) {
      if (this.holdStart === null) this.holdStart = tMs;
      if (tMs - this.holdStart < post) done = false;
    } else if (!done) this.holdStart = null;
    if (done) this.finishedAt = tMs;
  }

  /** Export clock (ms) the clip ends at: no frame at or after it is rendered. */
  get endMs(): number {
    const clipEnd = this.finishedBeforeClipEnd ? this.clipMs + this.fallbackMs : this.clipMs;
    return this.finishedAt !== null ? Math.min(clipEnd, this.finishedAt + this.stopDelayMs) : clipEnd;
  }
}

/** The most simulation frames a clip of `clipSec` can take (the clip, the end-of-run hold fallback and the recorder's delay). */
export function maxSimFrames(clipSec: number): number {
  return Math.ceil((clipSec * 1000 + END_HOLD_FALLBACK_MS + END_STOP_DELAY_MS) / SIM_FRAME_MS) + 1;
}

/* ------------------------------------------------------------------ layout */

/**
 * How the offline canvas is sized: the world (the page canvas in CSS px, which is the engine's width and height) drawn at
 * `scale` device pixels per CSS px, so its centred square – the part every export shows – is exactly as many pixels as
 * the export's shorter side and the frame is copied 1:1 (sharper than the real-time recorder, which scales the page's canvas).
 */
export function offlineCanvasLayout(world: { width: number; height: number }, exportSize: { width: number; height: number }): { scale: number; width: number; height: number } {
  const side = Math.max(1, Math.min(world.width, world.height));
  // A hair over the exact ratio, so the canvas' pixel sizes (truncated like `canvas.width = w * scale`) never fall one short.
  const scale = (Math.min(exportSize.width, exportSize.height) + 1e-3) / side;
  return { scale, width: Math.floor(world.width * scale), height: Math.floor(world.height * scale) };
}

/* ------------------------------------------------------------------ bitrates and codecs */

/** Audio bitrate of the export (AAC or Opus, stereo). */
export const AUDIO_BITRATE = 128_000;
/** The export's audio: 48 kHz stereo (Opus needs 48 kHz, AAC takes it). */
export const EXPORT_SAMPLE_RATE = 48_000;
export const EXPORT_CHANNELS = 2;

/** Video bitrate: 0.1 bit per pixel and frame (confetti and trails need it), 2–20 Mbit/s, in 100 kbit/s steps. */
export function videoBitrate(width: number, height: number, fps: number): number {
  const bits = 0.1 * width * height * fps;
  return Math.round(Math.max(2_000_000, Math.min(20_000_000, bits)) / 100_000) * 100_000;
}

/** H.264 levels: [level_idc, max macroblocks per frame, max macroblocks per second]. */
const AVC_LEVELS: readonly [number, number, number][] = [
  [0x1e, 1620, 40500], // 3.0
  [0x1f, 3600, 108000], // 3.1
  [0x20, 5120, 216000], // 3.2
  [0x28, 8192, 245760], // 4.0
  [0x2a, 8704, 522240], // 4.2
  [0x32, 22080, 589824], // 5.0
  [0x33, 36864, 983040], // 5.1
  [0x34, 36864, 2073600], // 5.2
];

/** The lowest H.264 level that fits the frame size and rate (encoders refuse a level too low for the frame). */
export function avcLevel(width: number, height: number, fps: number): number {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = mbs * fps;
  for (const [idc, maxFs, maxMbps] of AVC_LEVELS) if (mbs <= maxFs && mbps <= maxMbps) return idc;
  return AVC_LEVELS[AVC_LEVELS.length - 1][0];
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** The H.264 codec strings to try, most compatible first: Baseline, Main, High – e.g. `avc1.42001f` for 720p30. */
export function avcCodecStrings(width: number, height: number, fps: number): string[] {
  const level = hex2(avcLevel(width, height, fps));
  return [`avc1.4200${level}`, `avc1.4d00${level}`, `avc1.6400${level}`];
}

/** VP9 levels: [level, max picture size, max luma samples per second]. */
const VP9_LEVELS: readonly [number, number, number][] = [
  [10, 36864, 829440],
  [11, 73728, 2764800],
  [20, 122880, 4608000],
  [21, 245760, 9216000],
  [30, 552960, 20736000],
  [31, 983040, 36864000],
  [40, 2228224, 83558400],
  [41, 2228224, 160432128],
  [50, 8912896, 311951360],
  [51, 8912896, 588251136],
];

/** The VP9 codec string (profile 0, 8 bit) at the lowest level that fits, e.g. `vp09.00.41.08` for 1080p60. */
export function vp9CodecString(width: number, height: number, fps: number): string {
  const size = width * height;
  const rate = size * fps;
  let level = VP9_LEVELS[VP9_LEVELS.length - 1][0];
  for (const [l, maxSize, maxRate] of VP9_LEVELS) {
    if (size <= maxSize && rate <= maxRate) {
      level = l;
      break;
    }
  }
  return `vp09.00.${level}.08`;
}

/** One way of writing the export: container, WebCodecs codec strings and the muxers' track codecs. */
export interface ExportFormat {
  container: "mp4" | "webm";
  mimeType: "video/mp4" | "video/webm";
  extension: "mp4" | "webm";
  /** WebCodecs codec of the video (`VideoEncoder.configure`). */
  videoCodec: string;
  /** The muxer's video codec: mp4-muxer `avc`, webm-muxer `V_VP9` / `V_VP8`. */
  videoTrackCodec: "avc" | "V_VP9" | "V_VP8";
  /** WebCodecs codec of the audio (`AudioEncoder.configure`). */
  audioCodec: "mp4a.40.2" | "opus";
  /** The muxer's audio codec: mp4-muxer `aac` / `opus`, webm-muxer `A_OPUS`. */
  audioTrackCodec: "aac" | "opus" | "A_OPUS";
}

/**
 * Every format in the order it is tried: MP4 with H.264 and AAC (what TikTok, Reels and Shorts like best), WebM with VP9 or
 * VP8 and Opus (browsers without an H.264 or AAC encoder, e.g. Firefox and Chromium on Linux), and last MP4 with H.264 and
 * Opus (an H.264 encoder without AAC).
 */
export function exportFormatCandidates(width: number, height: number, fps: number): ExportFormat[] {
  const mp4 = (videoCodec: string, audio: "aac" | "opus"): ExportFormat => ({
    container: "mp4",
    mimeType: "video/mp4",
    extension: "mp4",
    videoCodec,
    videoTrackCodec: "avc",
    audioCodec: audio === "aac" ? "mp4a.40.2" : "opus",
    audioTrackCodec: audio,
  });
  const webm = (videoCodec: string, track: "V_VP9" | "V_VP8"): ExportFormat => ({
    container: "webm",
    mimeType: "video/webm",
    extension: "webm",
    videoCodec,
    videoTrackCodec: track,
    audioCodec: "opus",
    audioTrackCodec: "A_OPUS",
  });
  const avc = avcCodecStrings(width, height, fps);
  return [...avc.map((c) => mp4(c, "aac")), webm(vp9CodecString(width, height, fps), "V_VP9"), webm("vp8", "V_VP8"), ...avc.map((c) => mp4(c, "opus"))];
}

/** Asks the browser whether it can encode a codec (`VideoEncoder.isConfigSupported` / `AudioEncoder.isConfigSupported` in fastRender.ts). */
export interface CodecProbe {
  video: (codec: string) => Promise<boolean>;
  audio: (codec: string) => Promise<boolean>;
}

/**
 * The first format of `exportFormatCandidates()` whose video and audio codecs the browser can encode, or null (the page then
 * records in real time instead). Every codec is probed at most once.
 */
export async function selectExportFormat(width: number, height: number, fps: number, probe: CodecProbe): Promise<ExportFormat | null> {
  const video = new Map<string, Promise<boolean>>();
  const audio = new Map<string, Promise<boolean>>();
  const ask = (cache: Map<string, Promise<boolean>>, ask: (codec: string) => Promise<boolean>, codec: string) => {
    let answer = cache.get(codec);
    if (!answer) {
      answer = ask(codec).catch(() => false);
      cache.set(codec, answer);
    }
    return answer;
  };
  for (const format of exportFormatCandidates(width, height, fps)) {
    if (!(await ask(video, probe.video, format.videoCodec))) continue;
    if (!(await ask(audio, probe.audio, format.audioCodec))) continue;
    return format;
  }
  return null;
}

/* ------------------------------------------------------------------ audio */

/** Audio frames handed to the encoder at a time (one AAC frame; Opus re-frames internally). */
export const AUDIO_CHUNK_FRAMES = 1024;
/** Seconds rendered past the longest possible clip, so the offline mix is never shorter than the video. */
export const AUDIO_TAIL_SEC = 1;

/** Length (s) of the offline mix for a clip of `clipSec`: the longest the export can run, and a little more. */
export function offlineAudioSeconds(clipSec: number): number {
  return clipSec + (END_HOLD_FALLBACK_MS + END_STOP_DELAY_MS) / 1000 + AUDIO_TAIL_SEC;
}

/** Sample frames of `seconds` of audio. */
export function audioFrameCount(seconds: number, sampleRate = EXPORT_SAMPLE_RATE): number {
  return Math.max(0, Math.round(seconds * sampleRate));
}

/** The chunks `totalFrames` sample frames are encoded in: offsets and lengths, the last one shorter. */
export function audioChunks(totalFrames: number, chunkFrames = AUDIO_CHUNK_FRAMES): { offset: number; frames: number }[] {
  const out: { offset: number; frames: number }[] = [];
  const size = Math.max(1, Math.floor(chunkFrames));
  for (let offset = 0; offset < totalFrames; offset += size) out.push({ offset, frames: Math.min(size, totalFrames - offset) });
  return out;
}

/** Timestamp (µs) of the audio chunk starting at sample frame `offset`. */
export function audioTimestampUs(offset: number, sampleRate = EXPORT_SAMPLE_RATE): number {
  return Math.round((offset * 1_000_000) / sampleRate);
}

/* ------------------------------------------------------------------ progress */

export type FastExportPhase = "prepare" | "frames" | "audio" | "finish";

/** Overall progress 0–1: the frames are most of the work, then the audio mix and its encoding, then the muxing. */
export function exportProgress(phase: FastExportPhase, fraction: number): number {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  switch (phase) {
    case "prepare":
      return 0.02 * f;
    case "frames":
      return 0.02 + 0.86 * f;
    case "audio":
      return 0.88 + 0.1 * f;
    default:
      return 0.98 + 0.02 * f;
  }
}

/** How many times faster than real time a clip of `clipSec` was made in `wallMs` (0 when unknown). */
export function realtimeFactor(clipSec: number, wallMs: number): number {
  return wallMs > 0 ? (clipSec * 1000) / wallMs : 0;
}

/* ------------------------------------------------------------------ reproducibility */

/**
 * Mulberry32, the engine's generator: while a frame is rendered, `Math.random` is this generator seeded from the run's
 * seed, so the purely visual randomness (confetti, shake, banners) replays identically in every export of a seed.
 */
export function seededRandom(seed: number): () => number {
  let state = (seed ^ 0x5bd1e995) | 0;
  return () => {
    let t = (state = (state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** The wall clock the export's frames read (`Date.now()` while a frame renders): a fixed epoch plus the export clock. */
export const EXPORT_EPOCH_MS = 1_700_000_000_000;

/** FNV-1a over `data`, continuing from `hash` – the frame digest of an export (sampled frames, downscaled). */
export function fnv1a(data: ArrayLike<number>, hash = 0x811c9dc5): number {
  let h = hash >>> 0;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Every how many exported frames the digest samples one. */
export const DIGEST_EVERY = 15;
