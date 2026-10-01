import type { TranscodeSpec, VideoCodec } from "./contract";

/*
 * --- desktop-exe --- Output presets of the desktop render queue: what a clip becomes after the fast export. Pure; the page
 * picks them, the app's ffmpeg layer (desktop/src/ffmpeg/args.ts) turns a `TranscodeSpec` into encoder arguments.
 *
 * The platform presets follow the platforms' upload recommendations for vertical video (1080×1920, H.264 High + AAC,
 * faststart MP4): TikTok 60 fps / 10 Mbit/s, Instagram Reels 30 fps / 8 Mbit/s (Reels re-encodes to 30 fps anyway),
 * YouTube Shorts 60 fps / 12 Mbit/s with 384 kbit/s audio (YouTube's recommendation for 1080p60). "4K 60" upscales the
 * render to 2160×3840 at 60 fps (Lanczos) for platforms that keep a 4K master.
 */

export const OUTPUT_PRESETS = ["native", "tiktok", "reels", "shorts", "uhd60"] as const;
export type OutputPreset = (typeof OUTPUT_PRESETS)[number];

export interface PlatformPreset {
  width: number;
  height: number;
  fps: number;
  videoKbps: number;
  maxKbps: number;
  audioKbps: number;
  sampleRate: number;
}

export const PLATFORM_PRESETS: Record<Exclude<OutputPreset, "native">, PlatformPreset> = {
  tiktok: { width: 1080, height: 1920, fps: 60, videoKbps: 10_000, maxKbps: 12_000, audioKbps: 192, sampleRate: 44_100 },
  reels: { width: 1080, height: 1920, fps: 30, videoKbps: 8_000, maxKbps: 10_000, audioKbps: 128, sampleRate: 48_000 },
  shorts: { width: 1080, height: 1920, fps: 60, videoKbps: 12_000, maxKbps: 16_000, audioKbps: 384, sampleRate: 48_000 },
  uhd60: { width: 2160, height: 3840, fps: 60, videoKbps: 45_000, maxKbps: 60_000, audioKbps: 384, sampleRate: 48_000 },
};

/** The fast export's own resolutions the queue can render at (settings.ts RESOLUTIONS) and the frame rates. */
export const QUEUE_RESOLUTIONS = ["1080x1920", "1920x1080", "1280x720", "500x500"] as const;
export const QUEUE_FPS = [30, 60] as const;

/** Bitrate (kbit/s) of a custom transcode: ~0.08 bit per pixel and frame, 2–80 Mbit/s; HEVC and AV1 need ~35 % less. */
export function customVideoKbps(width: number, height: number, fps: number, codec: VideoCodec): number {
  const bits = (0.08 * width * height * fps) / 1000;
  const factor = codec === "h264" ? 1 : 0.65;
  return Math.round(Math.max(2_000, Math.min(80_000, bits * factor)) / 100) * 100;
}

/**
 * What ffmpeg does to a rendered clip, or null when it is kept as rendered. "native" keeps the fast export's file when it
 * already is an MP4 in the codec asked for (H.264 + AAC normally; HEVC / AV1 when WebCodecs encoded them on the GPU) and
 * otherwise re-encodes it at its own size and frame rate – a WebM from a Chromium without an H.264 encoder, or a codec the
 * GPU's WebCodecs encoder lacks. A platform preset always re-encodes to its size, frame rate, bitrates and audio.
 */
export function transcodeSpecFor(preset: OutputPreset, codec: VideoCodec, render: { width: number; height: number; fps: number }, rendered: { extension: string; codec: VideoCodec | null }): TranscodeSpec | null {
  if (preset === "native") {
    if (rendered.extension === "mp4" && rendered.codec === codec) return null;
    const kbps = customVideoKbps(render.width, render.height, render.fps, codec);
    return { codec, width: render.width, height: render.height, fps: render.fps, videoKbps: kbps, maxKbps: Math.round(kbps * 1.25), audioKbps: 192, sampleRate: 48_000 };
  }
  const p = PLATFORM_PRESETS[preset];
  const scale = codec === "h264" ? 1 : 0.65;
  return { codec, width: p.width, height: p.height, fps: p.fps, videoKbps: Math.round(p.videoKbps * scale), maxKbps: Math.round(p.maxKbps * scale), audioKbps: p.audioKbps, sampleRate: p.sampleRate };
}

/** The render size and frame rate a preset renders at before ffmpeg: a platform preset renders vertical at its frame rate (4K upscales a 1080×1920 render). */
export function renderFormatFor(preset: OutputPreset, resolution: string, fps: number): { resolution: string; fps: number } {
  if (preset === "native") return { resolution, fps: Number.isFinite(fps) && fps >= 30 ? fps : 60 }; // --- uncap-all --- (any rate from 30 up, as the fast export takes it)
  return { resolution: "1080x1920", fps: PLATFORM_PRESETS[preset].fps === 30 ? 30 : 60 };
}
