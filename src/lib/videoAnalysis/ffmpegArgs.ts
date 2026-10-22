/*
 * --- agent-cli --- (video analysis) The ffmpeg command lines of the video analyser, as argument arrays: no shell, no
 * interpolation, built here and nowhere else so they are unit-tested (tests/videoAnalysis.test.ts). The P1 agent CLI
 * (`npm run agent -- analyse`) runs them with the Windows app's bundled ffmpeg or the system one; the app's reference shelf
 * reuses them later. Every input is opened locally and only as a video container:
 *  - `file:<absolute path>` (never a protocol such as http:, concat: or pipe: that a name could spell);
 *  - `-protocol_whitelist file`: nothing a file names (an HLS or concat list) can reach the network;
 *  - `-format_whitelist`: only video containers – a playlist dressed as .mp4 is refused, never followed;
 *  - `-t <maxSec>`: at most that much of the file is read.
 * Picture features come from 16 × 16 RGB samples (the size the fast export's digest reads, so a reference file and an own
 * clip are measured alike); scene cuts from scdet on a 64 px wide copy; loudness from ebur128; tempo from mono PCM.
 */

/** The demuxers an analysed file may be opened with (MP4 / MOV / M4V, MKV / WebM, AVI, GIF, MPEG-TS). */
export const VIDEO_DEMUXERS = "mov,matroska,webm,avi,gif,mpegts";
/** The side of the picture samples (px). */
export const SAMPLE_SIDE = 16;
/** Bytes of one RGB picture sample. */
export const SAMPLE_BYTES = SAMPLE_SIDE * SAMPLE_SIDE * 3;
/** The PCM rate the tempo is measured at (mono, 32-bit float). */
export const PCM_RATE = 22050;
/** scdet's threshold (0–100): a change of picture this large between two frames is a cut. */
export const CUT_THRESHOLD = 10;
/** Silence: below this level for at least this long. */
export const SILENCE_DB = -50;
export const SILENCE_MIN_SEC = 0.3;

export interface AnalyseWindow {
  /** Seconds read from the start of the file at most. */
  maxSec: number;
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** The input options and the input itself: a local file, opened only as a video container, for at most `maxSec`. */
export function inputArgs(absolutePath: string, window?: AnalyseWindow, seekFromEnd?: number): string[] {
  if (!absolutePath || /[\0\n\r]/.test(absolutePath)) throw new Error("The file path is empty or has a control character");
  return [
    "-protocol_whitelist",
    "file",
    "-format_whitelist",
    VIDEO_DEMUXERS,
    ...(window ? ["-t", num(window.maxSec)] : []),
    ...(seekFromEnd !== undefined ? ["-sseof", num(-Math.abs(seekFromEnd))] : []),
    "-i",
    `file:${absolutePath}`,
  ];
}

const QUIET = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error"];

/** `ffmpeg -i <file>`: the banner on stderr (duration, streams); ffmpeg exits 1 without an output, which is expected. */
export function infoArgs(absolutePath: string): string[] {
  return ["-hide_banner", "-nostdin", ...inputArgs(absolutePath)];
}

/** `sampleHz` RGB 16 × 16 picture samples a second, raw on stdout (SAMPLE_BYTES each). */
export function sampleFramesArgs(absolutePath: string, sampleHz: number, window: AnalyseWindow): string[] {
  return [...QUIET, ...inputArgs(absolutePath, window), "-an", "-sn", "-dn", "-vf", `fps=${num(sampleHz)},scale=${SAMPLE_SIDE}:${SAMPLE_SIDE}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"];
}

/** The frames of the last half second as RGB 16 × 16 samples on stdout (the last one is the clip's last frame: the loop seam). */
export function lastFramesArgs(absolutePath: string): string[] {
  return [...QUIET, ...inputArgs(absolutePath, undefined, 0.5), "-an", "-sn", "-dn", "-vf", `scale=${SAMPLE_SIDE}:${SAMPLE_SIDE}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"];
}

/**
 * Scene cuts: scdet on a 64 px wide copy passes only the frames that start a new scene, and their metadata is printed to
 * `metadataFile` – a bare file name, written in the runner's working directory (the analyser's temp folder), so the
 * filter graph never holds a path to escape.
 */
export function cutsArgs(absolutePath: string, metadataFile: string, window: AnalyseWindow): string[] {
  if (!/^[A-Za-z0-9._-]+$/.test(metadataFile)) throw new Error("The metadata file must be a bare file name");
  return [...QUIET, ...inputArgs(absolutePath, window), "-an", "-sn", "-dn", "-vf", `scale=64:-2,scdet=threshold=${CUT_THRESHOLD}:sc_pass=1,metadata=print:file=${metadataFile}`, "-f", "null", "-"];
}

/** Loudness (ebur128's summary) and silences (silencedetect's lines), both on stderr – hence log level info. */
export function audioStatsArgs(absolutePath: string, window: AnalyseWindow): string[] {
  return ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", ...inputArgs(absolutePath, window), "-vn", "-sn", "-dn", "-af", `silencedetect=noise=${SILENCE_DB}dB:duration=${SILENCE_MIN_SEC},ebur128=framelog=quiet`, "-f", "null", "-"];
}

/** The sound as mono 32-bit float PCM at PCM_RATE on stdout (for the tempo and the onsets). */
export function pcmArgs(absolutePath: string, window: AnalyseWindow): string[] {
  return [...QUIET, ...inputArgs(absolutePath, window), "-vn", "-sn", "-dn", "-ac", "1", "-ar", String(PCM_RATE), "-f", "f32le", "pipe:1"];
}
