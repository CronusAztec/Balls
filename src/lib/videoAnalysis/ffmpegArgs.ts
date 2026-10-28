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

/**
 * The frames of the last half second as RGB 16 × 16 samples on stdout (the last one is the clip's last frame: the loop seam).
 * With `pictureEndSec` (--- inspiration --- a sound that runs on past the picture: ffmpegParse.ts pictureEndSec) the seek is
 * from the start to half a second before the picture's end, as -sseof seeks from the file's end, which is then the sound's.
 */
export function lastFramesArgs(absolutePath: string, pictureEndSec?: number): string[] {
  const input = pictureEndSec !== undefined ? ["-ss", num(Math.max(0, pictureEndSec - 0.5)), ...inputArgs(absolutePath)] : inputArgs(absolutePath, undefined, 0.5);
  return [...QUIET, ...input, "-an", "-sn", "-dn", "-vf", `scale=${SAMPLE_SIDE}:${SAMPLE_SIDE}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"];
}

/**
 * --- inspiration --- Where the picture ends: the first video stream's packets copied to nothing (nothing is decoded), with
 * ffmpeg's progress on stdout, whose last out_time is where the picture ends (ffmpegParse.ts parseProgressSec). A sound
 * track may run on past the picture – a TikTok clip of a minute carries the whole song of its "original sound" – and the
 * container's duration in the banner is then the sound's.
 */
export function pictureEndArgs(absolutePath: string): string[] {
  return [...QUIET, ...inputArgs(absolutePath), "-map", "0:v:0", "-c", "copy", "-f", "null", "-progress", "pipe:1", "-"];
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

/*
 * --- inspiration --- The frames tool's work ceilings, in the spirit of lib/uncap.ts MEMORY_CEILINGS: no number is refused
 * for being large, it is cut to what can be made and the result says so (framePlan's `limited`). A frame is one ffmpeg pass
 * and a PNG on disk, and a video has no more frames than its length times its rate; a contact sheet's filter graph is one
 * argument, and Linux takes 128 KiB at most in one (MAX_ARG_STRLEN, reached at about 1,040 tiles).
 */
/** The most frames of each kind one call makes (the evenly spread ones, and the hook's). */
export const FRAMES_CEILING = 600;
/** The most pictures on one contact sheet; more frames than that: an even pick of them (sheetPick). */
export const SHEET_TILES_CEILING = 120;

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** `count` moments spread evenly over the video: the middle of each of `count` equal parts (seconds, to the millisecond), at most `max`. */
export function frameTimes(durationSec: number, count: number, max = FRAMES_CEILING): number[] {
  const n = Math.min(whole(count), whole(max));
  if (!(durationSec > 0) || n === 0) return [];
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * durationSec * 1000) / n) / 1000);
}

/**
 * The opening `hookSec` seconds every `stepSec` from 0 (the hook a viewer decides on), never past the video's end, and at
 * most `max` of them (a finer step is widened to spread `max` over the opening).
 */
export function hookTimes(durationSec: number, hookSec = HOOK_SEC, stepSec = HOOK_STEP_SEC, max = FRAMES_CEILING): number[] {
  if (!(durationSec > 0) || !(hookSec > 0) || !(stepSec > 0) || whole(max) === 0) return [];
  const end = Math.min(hookSec, durationSec - 0.05);
  const step = Math.max(stepSec, end / whole(max));
  const out: number[] = [];
  for (let i = 0; i * step < end - 1e-9 && out.length < whole(max); i++) out.push(Math.round(i * step * 1000) / 1000);
  return out;
}

export interface FramePlan {
  frames: number[];
  hook: number[];
  /** What the ceilings cut, null when nothing was: the frames asked for and made, the hook's step asked for and used. */
  limited: { count?: { asked: number; made: number }; hookStepSec?: { asked: number; used: number } } | null;
}

/**
 * --- inspiration --- The moments the frames tool takes (see the ceilings above): `count` spread over the video, never more
 * than FRAMES_CEILING or than the video has (its length × `fps`, when ffmpeg names the rate), and the opening `hookSec`
 * every `hookStepSec`, no finer than one frame and FRAMES_CEILING at most.
 */
export function framePlan(durationSec: number, fps: number | null, ask: { count: number; hookSec: number; hookStepSec: number }): FramePlan {
  const rate = fps !== null && Number.isFinite(fps) && fps > 0 ? fps : null;
  const inVideo = rate !== null && durationSec > 0 ? Math.max(1, Math.floor(durationSec * rate)) : FRAMES_CEILING;
  // (never past the last frame's start: a seek beyond it finds no frame, which the middle of the last part is when the
  // parts are about a frame long)
  const lastSec = rate !== null ? Math.max(0, Math.floor((durationSec - 1 / rate) * 1000) / 1000) : durationSec;
  const frames = frameTimes(durationSec, ask.count, Math.min(FRAMES_CEILING, inVideo)).map((t) => Math.min(t, lastSec));
  const end = Math.min(ask.hookSec, durationSec - 0.05);
  let step = ask.hookStepSec > 0 ? ask.hookStepSec : 0; // (no step: no hook)
  if (step > 0 && rate !== null) step = Math.max(step, 1 / rate);
  if (end > 0 && step > 0 && end / step > FRAMES_CEILING) step = end / FRAMES_CEILING;
  const hook = hookTimes(durationSec, ask.hookSec, step);
  const limited: NonNullable<FramePlan["limited"]> = {};
  if (durationSec > 0 && frames.length < whole(ask.count)) limited.count = { asked: ask.count, made: frames.length };
  if (hook.length && step > ask.hookStepSec) limited.hookStepSec = { asked: ask.hookStepSec, used: Math.round(step * 10000) / 10000 };
  return { frames, hook, limited: Object.keys(limited).length ? limited : null };
}

/** --- inspiration --- Which of `n` frames a contact sheet shows: all of them up to `max`, else `max` spread evenly (indexes). */
export function sheetPick(n: number, max = SHEET_TILES_CEILING): number[] {
  const total = whole(n);
  const keep = Math.min(total, Math.max(1, whole(max)));
  return Array.from({ length: keep }, (_, i) => (keep === total ? i : Math.floor(((i + 0.5) * total) / keep)));
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

// --- studio --- a sheet as one JPEG small enough for an MCP image block (scripts/agent/frames.mjs jpegUnder: the widths and
// qualities tried in turn until the file fits)
/** The widths (px) and the qualities (ffmpeg's -q:v, 2 best to 31) a sheet's JPEG is tried at, in order. */
export const JPEG_STEPS = { widths: [1280, 1024, 800, 640, 480, 360], qualities: [4, 7, 11, 16, 24] } as const;

/** A sheet already written (a bare PNG name in the working folder) as a JPEG at most `width` wide, at quality `q`. */
export function jpegArgs(inName: string, outName: string, width: number, q: number): string[] {
  bareName(inName, "The sheet's file");
  bareName(outName, "The picture's file");
  const w = Math.max(16, Math.round(width / 2) * 2);
  return [...QUIET, "-protocol_whitelist", "file", "-format_whitelist", IMAGE_DEMUXERS, "-i", `file:${inName}`, "-frames:v", "1", "-vf", `scale='min(${w},iw)':-2:flags=lanczos`, "-q:v", String(Math.max(2, Math.min(31, Math.round(q)))), "-f", "image2", "-c:v", "mjpeg", "-n", `file:${outName}`];
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
