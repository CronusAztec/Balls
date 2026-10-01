import type { TranscodeSpec } from "@/lib/desktop/contract";

/*
 * --- desktop-exe --- ffmpeg command lines (pure; tests/ffmpegArgs.test.ts). Every transcode: the clip scaled to the
 * preset's frame with its aspect kept (Lanczos, black bars where it does not fit), the preset's frame rate, the chosen
 * encoder with a target and a capped bitrate in its own vocabulary, yuv420p (NV12 for Quick Sync), AAC stereo at the
 * preset's bitrate and sample rate, `+faststart` MP4 (hvc1-tagged HEVC for Apple players) and machine-readable progress on
 * stdout.
 */

/** Encoder options for a target / capped bitrate (kbit/s). */
export function encoderArgs(encoder: string, spec: Pick<TranscodeSpec, "codec" | "videoKbps" | "maxKbps">): string[] {
  const b = `${spec.videoKbps}k`;
  const max = `${spec.maxKbps}k`;
  const buf = `${spec.maxKbps * 2}k`;
  const rate = ["-b:v", b, "-maxrate", max, "-bufsize", buf];
  const profile = spec.codec === "h264" ? ["-profile:v", "high"] : spec.codec === "hevc" ? ["-profile:v", "main"] : [];
  if (encoder.endsWith("_nvenc")) return ["-c:v", encoder, "-preset", "p5", "-tune", "hq", "-rc", "vbr", ...rate, ...profile, "-pix_fmt", "yuv420p"];
  if (encoder.endsWith("_amf")) return ["-c:v", encoder, "-quality", "quality", "-rc", "vbr_peak", ...rate, ...(spec.codec === "av1" ? [] : profile), "-pix_fmt", "yuv420p"];
  if (encoder.endsWith("_qsv")) return ["-c:v", encoder, "-preset", "slower", ...rate, ...profile, "-pix_fmt", "nv12"];
  if (encoder.endsWith("_mf")) return ["-c:v", encoder, "-hw_encoding", "1", "-rate_control", "u_vbr", ...rate, "-pix_fmt", "nv12"];
  if (encoder.endsWith("_vaapi")) return ["-vaapi_device", "/dev/dri/renderD128", "-c:v", encoder, ...rate];
  if (encoder.endsWith("_videotoolbox")) return ["-c:v", encoder, ...rate, ...profile, "-pix_fmt", "yuv420p"];
  if (encoder === "libx264") return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-maxrate", max, "-bufsize", buf, ...profile, "-pix_fmt", "yuv420p"];
  if (encoder === "libopenh264") return ["-c:v", "libopenh264", "-b:v", b, "-maxrate", max, "-pix_fmt", "yuv420p"];
  if (encoder === "libx265") return ["-c:v", "libx265", "-preset", "medium", "-crf", "22", "-x265-params", `vbv-maxrate=${spec.maxKbps}:vbv-bufsize=${spec.maxKbps * 2}:log-level=error`, "-pix_fmt", "yuv420p"];
  if (encoder === "libsvtav1") return ["-c:v", "libsvtav1", "-preset", "8", "-crf", "30", "-svtav1-params", `mbr=${spec.maxKbps}`, "-pix_fmt", "yuv420p"];
  if (encoder === "libaom-av1") return ["-c:v", "libaom-av1", "-cpu-used", "6", "-row-mt", "1", "-crf", "30", "-b:v", "0", "-pix_fmt", "yuv420p"];
  return ["-c:v", encoder, ...rate, "-pix_fmt", "yuv420p"];
}

/** The filter chain: fit into the frame (aspect kept, padded), square pixels, the frame rate. VA-API uploads to the GPU last. */
export function videoFilter(spec: Pick<TranscodeSpec, "width" | "height" | "fps">, encoder = ""): string {
  const w = spec.width;
  const h = spec.height;
  const chain = [`scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`, "setsar=1", `fps=${spec.fps}`];
  if (encoder.endsWith("_vaapi")) chain.push("format=nv12", "hwupload");
  return chain.join(",");
}

/** The full transcode of `input` into the MP4 `output`. */
export function buildTranscodeArgs(input: string, output: string, spec: TranscodeSpec, encoder: string): string[] {
  const tag = spec.codec === "hevc" ? ["-tag:v", "hvc1"] : [];
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    videoFilter(spec, encoder),
    "-r",
    String(spec.fps),
    ...encoderArgs(encoder, spec),
    ...tag,
    "-c:a",
    "aac",
    "-b:a",
    `${spec.audioKbps}k`,
    "-ar",
    String(spec.sampleRate),
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    output,
  ];
}

/** A one-second encode of a test pattern to nowhere: does this encoder work on this PC? */
export function buildTestEncodeArgs(encoder: string): string[] {
  const codec = encoder.startsWith("hevc") || encoder === "libx265" ? "hevc" : encoder.startsWith("av1") || encoder.includes("av1") || encoder === "librav1e" ? "av1" : "h264";
  return ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "1", ...encoderArgs(encoder, { codec, videoKbps: 4000, maxKbps: 5000 }), "-f", "null", "-"];
}

/** The benchmark: `seconds` of a 1080×1920 test pattern at 60 fps through the encoder (the page's GPU panel times it). */
export function buildBenchmarkArgs(encoder: string, codec: TranscodeSpec["codec"], seconds = 5): string[] {
  return ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=60", "-t", String(seconds), ...encoderArgs(encoder, { codec, videoKbps: 12000, maxKbps: 16000 }), "-f", "null", "-"];
}

/** A 270 px wide JPEG of the frame at `atSec` for the library. */
export function buildThumbnailArgs(input: string, output: string, atSec: number): string[] {
  return ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-ss", String(Math.max(0, atSec)), "-i", input, "-frames:v", "1", "-vf", "scale=270:-2", "-q:v", "5", output];
}

/** `ffmpeg -i <file>` (no output): its banner on stderr carries the duration and the video size. */
export function buildInfoArgs(input: string): string[] {
  return ["-hide_banner", "-nostdin", "-i", input];
}

/** "Duration: 00:00:12.34" → 12.34, null when absent. */
export function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** The first video stream's size in ffmpeg's banner ("Video: h264 …, 1080x1920 …"). */
export function parseVideoSize(stderr: string): { width: number; height: number } | null {
  const line = stderr.split(/\r?\n/).find((l) => /Stream #.*Video:/.test(l));
  const m = line ? /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(line) : null;
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** Folds `-progress pipe:1` output into the latest position (µs) and whether ffmpeg reported the end. */
export function parseProgress(text: string): { outTimeUs: number | null; done: boolean } {
  let outTimeUs: number | null = null;
  let done = false;
  for (const line of text.split(/\r?\n/)) {
    const [key, value] = line.split("=", 2);
    if ((key === "out_time_us" || key === "out_time_ms") && value && /^\d+$/.test(value.trim())) outTimeUs = Number(value.trim());
    if (key === "progress" && value?.trim() === "end") done = true;
  }
  return { outTimeUs, done };
}
