import { analyzeBeatsAsync, type BeatAnalysis } from "./beats";
import { beatEnergies, downbeatPhase, waveformPeaks } from "@/lib/simulation/beatSource";

/**
 * --- video-beats --- Importing a video or audio file for its beat (browser side; the maths is in beatSource.ts / beats.ts).
 *
 * 1. Decode: `AudioContext.decodeAudioData()` on the file's bytes. Chromium, Firefox and Safari demux the audio track of
 *    MP4 / MOV (AAC) and WebM (Opus / Vorbis) files this way, so a video usually decodes like a song.
 * 2. Fallback capture, for a container the decoder refuses: the file plays through a hidden <video> element into a
 *    `MediaElementAudioSourceNode` of a private AudioContext and a ScriptProcessor copies the samples out. Where the
 *    element can switch pitch correction off (`preservesPitch = false`) it plays at `CAPTURE_FAST_RATE`× and the samples
 *    are read back at the context rate ÷ that factor – faster than real time, at the price of the top octave (a 48 kHz
 *    context captures a 24 kHz track: fine for beats and a background bed). Otherwise it runs in real time. Either way
 *    the caller gets progress and can cancel. Limits: a file the browser cannot play at all (an unsupported codec, DRM)
 *    fails with `MediaImportError("unsupported")`; a file with no audio track captures silence and yields no beat.
 * 3. Analyse: the beat detector (beats.ts) in idle slices, then the beat energies (downbeat guess) and the waveform peaks.
 *
 * The decoded buffer becomes the music bed (so an export carries the song) and the file stays in the session and in
 * project files (never in links); `MAX_MEDIA_BYTES` is the project files' cap.
 */

/** Largest file imported (the project files' cap, so a project can always carry it). */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
/** Playback rate of the fallback capture where pitch correction can be switched off. */
export const CAPTURE_FAST_RATE = 2;
/** The fallback capture gives up when the element has not advanced for this long (ms). */
const CAPTURE_STALL_MS = 12000;
/** Peaks computed for the waveform strip (the strip scales them to its width). */
export const WAVEFORM_BUCKETS = 4000;

export const MEDIA_ACCEPT = "video/*,audio/*,.mp4,.m4v,.mov,.webm,.mkv,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac";

export type MediaImportPhase = "reading" | "decoding" | "capturing" | "analysing";
export type MediaImportFailure = "too-large" | "not-media" | "unsupported" | "no-audio";

export class MediaImportError extends Error {
  constructor(readonly reason: MediaImportFailure) {
    super(`Media import failed: ${reason}`);
    this.name = "MediaImportError";
  }
}

export interface MediaImportProgress {
  phase: MediaImportPhase;
  /** 0–1 within the phase. */
  progress: number;
}

export interface MediaAnalysis {
  beats: BeatAnalysis;
  /** Loudness of every beat, 0–1. */
  energy: number[];
  /** Index (0–3) of the loudest beat of the bar. */
  downbeat: number;
  /** Waveform peaks for the strip, 0–1. */
  peaks: Float32Array;
}

export interface DecodedMedia {
  buffer: AudioBuffer;
  /** decodeAudioData read the file, or the element capture had to play it. */
  method: "decode" | "capture";
  /** The file is a video (its picture can be drawn behind the arena). */
  isVideo: boolean;
}

const EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv)$/i;

/** Looks like a video or audio file (by MIME type or extension). */
export function looksLikeMedia(file: { name: string; type: string }): boolean {
  return file.type.startsWith("video/") || file.type.startsWith("audio/") || EXTENSIONS.test(file.name);
}

/** A video container (by MIME type or extension); an audio-only MP4 / WebM still counts – the picture check decides later. */
export function looksLikeVideo(file: { name: string; type: string }): boolean {
  return file.type.startsWith("video/") || (!file.type.startsWith("audio/") && VIDEO_EXTENSIONS.test(file.name));
}

function abortError() {
  return new DOMException("Media import cancelled", "AbortError");
}

/**
 * Decodes the audio of `file`: `decode` (the page's `ToneGenerator.decodeAudio`) on its bytes first, the element capture
 * when that fails. Rejects with a `MediaImportError`, or an AbortError when `signal` fires.
 */
export async function decodeMediaFile(file: File, decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>, options: { signal?: AbortSignal; onProgress?: (p: MediaImportProgress) => void } = {}): Promise<DecodedMedia> {
  const { signal, onProgress } = options;
  if (file.size > MAX_MEDIA_BYTES) throw new MediaImportError("too-large");
  if (!looksLikeMedia(file)) throw new MediaImportError("not-media");
  const isVideo = looksLikeVideo(file);
  onProgress?.({ phase: "reading", progress: 0 });
  const bytes = await file.arrayBuffer();
  if (signal?.aborted) throw abortError();
  onProgress?.({ phase: "decoding", progress: 0 });
  try {
    const buffer = await decode(bytes);
    if (signal?.aborted) throw abortError();
    return { buffer, method: "decode", isVideo };
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw abortError();
  }
  const buffer = await captureThroughElement(file, isVideo, { signal, onProgress });
  return { buffer, method: "capture", isVideo };
}

/** The fallback: play the file through a hidden media element and record what reaches the audio graph. */
async function captureThroughElement(file: File, isVideo: boolean, options: { signal?: AbortSignal; onProgress?: (p: MediaImportProgress) => void }): Promise<AudioBuffer> {
  const { signal, onProgress } = options;
  if (typeof document === "undefined" || typeof AudioContext === "undefined") throw new MediaImportError("unsupported");
  const url = URL.createObjectURL(file);
  const el = document.createElement(isVideo ? "video" : "audio") as HTMLMediaElement;
  el.preload = "auto";
  el.src = url;
  if (el instanceof HTMLVideoElement) el.playsInline = true;
  let ctx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  const cleanup = () => {
    el.pause();
    el.removeAttribute("src");
    el.load();
    processor?.disconnect();
    void ctx?.close().catch(() => {});
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new MediaImportError("unsupported"));
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    });
    const duration = el.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new MediaImportError("unsupported");
    const pitch = el as HTMLMediaElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
    const canResample = "preservesPitch" in pitch || "mozPreservesPitch" in pitch || "webkitPreservesPitch" in pitch;
    const rate = canResample ? CAPTURE_FAST_RATE : 1;
    if (canResample) {
      pitch.preservesPitch = false;
      pitch.mozPreservesPitch = false;
      pitch.webkitPreservesPitch = false;
    }
    ctx = new AudioContext();
    const source = ctx.createMediaElementSource(el);
    processor = ctx.createScriptProcessor(4096, 2, 2);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    const left: Float32Array[] = [];
    const right: Float32Array[] = [];
    let frames = 0;
    processor.onaudioprocess = (e) => {
      if (el.paused || el.ended) return;
      const input = e.inputBuffer;
      left.push(input.getChannelData(0).slice());
      right.push((input.numberOfChannels > 1 ? input.getChannelData(1) : input.getChannelData(0)).slice());
      frames += input.length;
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();
    el.playbackRate = rate;
    onProgress?.({ phase: "capturing", progress: 0 });
    await new Promise<void>((resolve, reject) => {
      let lastTime = -1;
      let lastMove = performance.now();
      const timer = setInterval(() => {
        if (signal?.aborted) {
          clearInterval(timer);
          reject(abortError());
          return;
        }
        const t = el.currentTime;
        if (t !== lastTime) {
          lastTime = t;
          lastMove = performance.now();
        } else if (performance.now() - lastMove > CAPTURE_STALL_MS) {
          clearInterval(timer);
          reject(new MediaImportError("unsupported"));
          return;
        }
        onProgress?.({ phase: "capturing", progress: Math.min(1, t / duration) });
        if (el.ended) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
      el.onended = () => {
        clearInterval(timer);
        resolve();
      };
      el.play().catch(() => {
        clearInterval(timer);
        reject(new MediaImportError("unsupported"));
      });
    });
    if (frames === 0) throw new MediaImportError("no-audio");
    const sampleRate = Math.max(3000, Math.min(768000, ctx.sampleRate / rate));
    const out = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate });
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    let at = 0;
    for (let i = 0; i < left.length; i++) {
      l.set(left[i], at);
      r.set(right[i], at);
      at += left[i].length;
    }
    return out;
  } finally {
    cleanup();
  }
}

/** Beat grid, beat energies, downbeat and waveform of a decoded track (the detector runs in idle slices). */
export async function analyzeMedia(buffer: AudioBuffer, options: { signal?: AbortSignal; onProgress?: (p: MediaImportProgress) => void } = {}): Promise<MediaAnalysis> {
  const { signal, onProgress } = options;
  onProgress?.({ phase: "analysing", progress: 0 });
  const beats = await analyzeBeatsAsync(buffer, {}, { signal, onProgress: (p) => onProgress?.({ phase: "analysing", progress: p }) });
  if (signal?.aborted) throw abortError();
  const energy = beatEnergies(buffer, beats.beatTimes);
  return { beats, energy, downbeat: downbeatPhase(energy), peaks: waveformPeaks(buffer, WAVEFORM_BUCKETS) };
}

/** Width and height of the picture of a video file (0 × 0 for audio, or when the browser cannot show it). */
export function probeVideoSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve({ width: 0, height: 0 });
      return;
    }
    const el = document.createElement("video");
    el.preload = "metadata";
    el.muted = true;
    const done = (width: number, height: number) => {
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute("src");
      el.load();
      resolve({ width, height });
    };
    el.onloadedmetadata = () => done(el.videoWidth || 0, el.videoHeight || 0);
    el.onerror = () => done(0, 0);
    setTimeout(() => done(el.videoWidth || 0, el.videoHeight || 0), 8000);
    el.src = url;
  });
}
