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

// --- inspiration --- still frames of a video for a vision-capable AI (the frames tool): evenly spaced frames, the opening
// (the hook) in finer steps, and a contact sheet of each. Every output is a bare file name in the runner's working folder
// (the frames folder under .agent-out/), written with -n (never over a file that is there); every input is opened as above.

/** The width of an extracted frame (px; the height keeps the picture's shape). */
export const FRAME_WIDTH = 540;
/** The opening seconds a hook sheet covers, and its step. */
export const HOOK_SEC = 3;
export const HOOK_STEP_SEC = 0.25;
/** The width of one picture on a contact sheet (px). */
export const SHEET_TILE_WIDTH = 240;
/** The demuxers a contact sheet may open its frames with (the PNG files the frames pass wrote). */
export const IMAGE_DEMUXERS = "image2,png_pipe";

/** A bare file name (a fresh one may start with a dot), never a path or a protocol. */
const bareName = (name: string, what: string) => {
  if (!/^\.?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) throw new Error(`${what} must be a bare file name`);
  return name;
};

/** `count` moments spread evenly over the video: the middle of each of `count` equal parts (seconds, to the millisecond). */
export function frameTimes(durationSec: number, count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  if (!(durationSec > 0) || n === 0) return [];
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * durationSec * 1000) / n) / 1000);
}

/** The opening `hookSec` seconds every `stepSec` from 0 (the hook a viewer decides on), never past the video's end. */
export function hookTimes(durationSec: number, hookSec = HOOK_SEC, stepSec = HOOK_STEP_SEC): number[] {
  if (!(durationSec > 0) || !(hookSec > 0) || !(stepSec > 0)) return [];
  const end = Math.min(hookSec, durationSec - 0.05);
  const out: number[] = [];
  for (let i = 0; i * stepSec < end - 1e-9; i++) out.push(Math.round(i * stepSec * 1000) / 1000);
  return out;
}

/** A contact sheet's grid: up to 6 columns for a portrait video, 4 for a landscape one. */
export function sheetGrid(count: number, portrait: boolean): { cols: number; rows: number } {
  const n = Math.max(1, Math.floor(count));
  const cols = Math.min(n, portrait ? 6 : 4);
  return { cols, rows: Math.ceil(n / cols) };
}

/** One frame at `atSec` as a PNG `width` px wide (an accurate seek: -ss before the input decodes up to that moment). */
export function frameArgs(absolutePath: string, atSec: number, outName: string, width = FRAME_WIDTH): string[] {
  bareName(outName, "The frame's file");
  return [...QUIET, "-ss", num(Math.max(0, atSec)), ...inputArgs(absolutePath), "-an", "-sn", "-dn", "-frames:v", "1", "-vf", `scale=${Math.max(16, Math.round(width))}:-2:flags=lanczos`, "-f", "image2", "-c:v", "png", "-n", `file:${outName}`];
}

/**
 * A contact sheet of frames already written (bare PNG names in the working folder): each scaled into a tileWidth ×
 * tileHeight cell (letterboxed), laid out `cols` × `rows`, a partly filled last row padded with the background.
 */
export function sheetArgs(inputNames: readonly string[], outName: string, grid: { cols: number; rows: number }, tileWidth: number, tileHeight: number): string[] {
  if (inputNames.length === 0) throw new Error("A contact sheet needs at least one frame");
  bareName(outName, "The sheet's file");
  const w = Math.max(16, Math.round(tileWidth / 2) * 2);
  const h = Math.max(16, Math.round(tileHeight / 2) * 2);
  const inputs = inputNames.flatMap((name) => ["-protocol_whitelist", "file", "-format_whitelist", IMAGE_DEMUXERS, "-i", `file:${bareName(name, "A frame's file")}`]);
  const cells = inputNames.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x101014,setsar=1[c${i}]`);
  const joined = `${inputNames.map((_, i) => `[c${i}]`).join("")}concat=n=${inputNames.length}:v=1:a=0,tile=${grid.cols}x${grid.rows}:padding=6:margin=6:color=0x101014[sheet]`;
  return [...QUIET, ...inputs, "-filter_complex", [...cells, joined].join(";"), "-map", "[sheet]", "-frames:v", "1", "-f", "image2", "-c:v", "png", "-n", `file:${outName}`];
}

// --- inspiration --- a video's public stills (inspire's fallback when a download is refused: lib/agentKit/videoSources.ts
// videoStills), opened like the frames above: a bare name in the working folder, the file protocol only, image demuxers only.

/** The demuxers a saved still may be opened with (the JPEG files read from the image host, the PNG files written from them). */
export const STILL_DEMUXERS = "image2,jpeg_pipe,png_pipe";
/** The width of a still once cropped (px). */
export const STILL_WIDTH = 270;

/**
 * A saved still cropped, centred, to the video's shape (`aspect`: width ÷ height; the 4:3 stills letterbox a Short between
 * black bars, which would read as a dark picture) and scaled `width` px wide, written as a PNG.
 */
export function stillArgs(inName: string, outName: string, aspect: number, width = STILL_WIDTH): string[] {
  bareName(inName, "The still's file");
  bareName(outName, "The frame's file");
  const a = (Number.isFinite(aspect) && aspect > 0 ? Math.min(10, Math.max(0.1, aspect)) : 9 / 16).toFixed(4);
  const crop = `crop='min(iw,ih*${a})':'min(ih,iw/${a})'`;
  return [...QUIET, "-protocol_whitelist", "file", "-format_whitelist", STILL_DEMUXERS, "-i", `file:${inName}`, "-frames:v", "1", "-vf", `${crop},scale=${Math.max(16, Math.round(width / 2) * 2)}:-2:flags=lanczos`, "-f", "image2", "-c:v", "png", "-n", `file:${outName}`];
}

/** A cropped still (a bare PNG name) as one SAMPLE_SIDE × SAMPLE_SIDE RGB sample on stdout: its colours, measured as a video's are. */
export function stillSampleArgs(inName: string): string[] {
  bareName(inName, "The still's file");
  return [...QUIET, "-protocol_whitelist", "file", "-format_whitelist", STILL_DEMUXERS, "-i", `file:${inName}`, "-frames:v", "1", "-vf", `scale=${SAMPLE_SIDE}:${SAMPLE_SIDE}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"];
}
