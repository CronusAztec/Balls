/*
 * --- agent-cli --- (video analysis) Parsers for what the analyser's ffmpeg runs print (ffmpegArgs.ts): the `-i` banner,
 * scdet's metadata file, ebur128's summary and silencedetect's lines. Pure text in, numbers out; what cannot be read is
 * null, never a guess. There is no ffprobe in the Windows app, so the banner is the source of the stream facts.
 */

export interface MediaInfo {
  durationSec: number | null;
  /** The video stream's frame rate (its "fps", else its "tbr"). */
  fps: number | null;
  /** The picture as shown (a rotation of ±90° swaps the stored width and height). */
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

const finite = (n: number) => (Number.isFinite(n) ? n : null);

/** "Duration: 00:01:02.50" → 62.5 (null for "N/A" or none). */
export function parseDurationSec(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  return m ? finite(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) : null;
}

/** The banner of `ffmpeg -i <file>`: duration, the first video stream's codec, size and rate, and whether there is sound. */
export function parseMediaInfo(stderr: string): MediaInfo {
  const video = /Stream #\d+:\d+[^\n]*?: Video: ([^\n]+)/.exec(stderr);
  const audio = /Stream #\d+:\d+[^\n]*?: Audio: /.test(stderr);
  let width: number | null = null;
  let height: number | null = null;
  let fps: number | null = null;
  let videoCodec: string | null = null;
  if (video) {
    const line = video[1];
    videoCodec = /^([A-Za-z0-9_]+)/.exec(line)?.[1] ?? null;
    const size = /(?:^|[\s,(])(\d{2,5})x(\d{2,5})(?=[\s,\[]|$)/.exec(line);
    if (size) {
      width = Number(size[1]);
      height = Number(size[2]);
    }
    const rate = /([\d.]+)\s+fps\b/.exec(line) ?? /([\d.]+)k?\s+tbr\b/.exec(line);
    if (rate) fps = finite(Number(rate[1]));
    // A phone clip stored landscape with a rotation of ±90° plays portrait.
    const rest = stderr.slice(video.index);
    const rotation = /rotation of (-?[\d.]+) degrees|rotate\s*:\s*(-?\d+)/.exec(rest.slice(0, 600));
    const deg = rotation ? Math.abs(Number(rotation[1] ?? rotation[2])) % 180 : 0;
    if (deg === 90 && width !== null && height !== null) [width, height] = [height, width];
  }
  return { durationSec: parseDurationSec(stderr), fps, width, height, videoCodec, hasVideo: !!video, hasAudio: audio };
}

/** --- inspiration --- The last out_time of ffmpeg's -progress output (`out_time_us=…`, microseconds) in seconds, null for none. */
export function parseProgressSec(stdout: string): number | null {
  let last: number | null = null;
  for (const m of stdout.matchAll(/^out_time_us=(\d+)\s*$/gm)) last = Number(m[1]) / 1e6;
  return last !== null && Number.isFinite(last) && last > 0 ? last : null;
}

/** --- inspiration --- A sound track that runs on past the picture by more than this (seconds) ends the video at the picture. */
export const SOUND_PAST_PICTURE_SEC = 1;

/**
 * --- inspiration --- The picture's end (seconds) when a longer sound track runs on past it – the banner's duration is the
 * longer of the two, and a viewer sees the picture's: the out_time of copying the video's packets (ffmpegArgs.ts
 * pictureEndArgs), the last packet's time and its length (a frame or two short of the end when frames are reordered, never
 * past it). Null when the picture runs about as long as the file (within SOUND_PAST_PICTURE_SEC), or either is unknown.
 */
export function pictureEndSec(info: Pick<MediaInfo, "durationSec">, pictureOutSec: number | null): number | null {
  if (info.durationSec === null || pictureOutSec === null) return null;
  return pictureOutSec < info.durationSec - SOUND_PAST_PICTURE_SEC ? Math.round(pictureOutSec * 10000) / 10000 : null;
}

/** The scene cuts in scdet's metadata file (one `lavfi.scd.time=` per frame that starts a scene), in seconds, ascending. */
export function parseCuts(metadata: string): number[] {
  const out: number[] = [];
  for (const m of metadata.matchAll(/lavfi\.scd\.time=(-?[\d.]+)/g)) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t > 0) out.push(t);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** ebur128's integrated loudness ("Integrated loudness: … I: -14.2 LUFS" after "Summary:"), null when absent or silent. */
export function parseIntegratedLufs(stderr: string): number | null {
  const at = stderr.lastIndexOf("Summary:");
  if (at < 0) return null;
  const m = /I:\s*(-?[\d.]+|-inf)\s*LUFS/.exec(stderr.slice(at));
  if (!m || m[1] === "-inf") return null;
  const lufs = Number(m[1]);
  return Number.isFinite(lufs) && lufs > -70 ? lufs : null;
}

export interface Silence {
  start: number;
  end: number;
}

/**
 * silencedetect's spans ("silence_start: 3.05" … "silence_end: 3.5 | silence_duration: 0.45"); a silence still open at the
 * end of the file ends at `durationSec` (when known).
 */
export function parseSilences(stderr: string, durationSec: number | null = null): Silence[] {
  const out: Silence[] = [];
  let open: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const t = Math.max(0, Number(m[2]));
    if (!Number.isFinite(t)) continue;
    if (m[1] === "start") open = t;
    else if (open !== null) {
      out.push({ start: open, end: Math.max(open, t) });
      open = null;
    }
  }
  if (open !== null && durationSec !== null && durationSec > open) out.push({ start: open, end: durationSec });
  return out;
}

/** Raw rgb24 samples on stdout, cut into whole pictures of `bytes` each (a cut-off last picture is dropped). */
export function splitFrames(raw: Uint8Array, bytes: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; at + bytes <= raw.length; at += bytes) out.push(raw.subarray(at, at + bytes));
  return out;
}

/** Little-endian 32-bit float PCM on stdout as samples (a cut-off last sample is dropped). */
export function pcmSamples(raw: Uint8Array): Float32Array {
  const n = Math.floor(raw.length / 4);
  const out = new Float32Array(n);
  const view = new DataView(raw.buffer, raw.byteOffset, n * 4);
  for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}
