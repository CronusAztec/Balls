import type { CodecProbe, ExportFormat } from "@/lib/recording/fastRenderPlan";
import type { VideoCodec } from "./contract";

/*
 * --- desktop-exe --- GPU video encoding for the fast export inside the desktop app.
 *
 * In the app, the fast export asks WebCodecs for the GPU encoder first: every video config it probes and configures carries
 * `hardwareAcceleration: "prefer-hardware"` (H.264, HEVC and AV1 go through Chromium's Media Foundation encoders on
 * Windows – NVENC, AMF or Quick Sync behind them). When the GPU cannot take a config, the same config without the hint (the
 * browser's own choice, software included) is used, so an export never fails for want of a GPU. On the website nothing
 * changes: `hardwarePreferred()` is false and every config goes through untouched.
 *
 * The render queue may also ask for an HEVC or AV1 MP4 (`setDesktopExportCodec()`): `desktopFormatCandidates()` puts those
 * formats (MP4, AAC) first; when WebCodecs cannot encode them the queue renders H.264 and ffmpeg transcodes.
 */

interface DesktopEncodeState {
  preferHardware: boolean;
  codec: VideoCodec;
  /** How the last configured export encoded its video. */
  last: { codec: string; acceleration: "prefer-hardware" | "no-preference" } | null;
}

const state: DesktopEncodeState = { preferHardware: false, codec: "h264", last: null };

/** Set by the desktop panel from the app's preferences (off on the website). */
export function setHardwarePreferred(on: boolean): void {
  state.preferHardware = on;
}

export function hardwarePreferred(): boolean {
  return state.preferHardware;
}

/** The codec the next fast export should write (the render queue sets it per job; h264 = the fast export's usual formats). */
export function setDesktopExportCodec(codec: VideoCodec): void {
  state.codec = codec;
}

export function desktopExportCodec(): VideoCodec {
  return state.codec;
}

/** How the last export's video encoder was configured (the GPU panel shows it), null before one. */
export function lastVideoAcceleration(): DesktopEncodeState["last"] {
  return state.last;
}

type Accelerated<T> = T & { hardwareAcceleration?: "prefer-hardware" | "no-preference" | "prefer-software" };

/**
 * The config to use for `base`: with the GPU hint when that is preferred and supported, else `base` itself when supported,
 * else null. `isSupported` is `VideoEncoder.isConfigSupported` (injectable for tests).
 */
export async function resolveVideoConfig<T extends object>(base: T, isSupported: (config: Accelerated<T>) => Promise<{ supported?: boolean }>, preferHardware = state.preferHardware): Promise<Accelerated<T> | null> {
  if (preferHardware) {
    const hw: Accelerated<T> = { ...base, hardwareAcceleration: "prefer-hardware" };
    const answer = await isSupported(hw).catch(() => ({ supported: false }));
    if (answer.supported === true) return hw;
  }
  const answer = await isSupported(base).catch(() => ({ supported: false }));
  return answer.supported === true ? base : null;
}

/** Remembers the acceleration of the export being configured. */
export function noteVideoAcceleration(codec: string, config: { hardwareAcceleration?: string }): void {
  state.last = { codec, acceleration: config.hardwareAcceleration === "prefer-hardware" ? "prefer-hardware" : "no-preference" };
}

/* ------------------------------------------------------------------ HEVC and AV1 formats */

/** HEVC Main levels: [general_level_idc, max luma picture size, max luma samples per second]. */
const HEVC_LEVELS: readonly [number, number, number][] = [
  [90, 552_960, 16_588_800], // 3.0
  [93, 983_040, 33_177_600], // 3.1
  [120, 2_228_224, 66_846_720], // 4.0
  [123, 2_228_224, 133_693_440], // 4.1
  [150, 8_912_896, 267_386_880], // 5.0
  [153, 8_912_896, 534_773_760], // 5.1
  [156, 8_912_896, 1_069_547_520], // 5.2
  [183, 35_651_584, 2_139_095_040], // 6.1
];

/** The HEVC Main codec string at the lowest level that fits, e.g. `hvc1.1.6.L123.B0` for 1080×1920 at 60 fps. */
export function hevcCodecString(width: number, height: number, fps: number): string {
  const size = width * height;
  const rate = size * fps;
  const level = HEVC_LEVELS.find(([, maxSize, maxRate]) => size <= maxSize && rate <= maxRate)?.[0] ?? HEVC_LEVELS[HEVC_LEVELS.length - 1][0];
  return `hvc1.1.6.L${level}.B0`;
}

/** AV1 levels: [seq_level_idx, max picture size, max display rate (luma samples per second)]. */
const AV1_LEVELS: readonly [number, number, number][] = [
  [4, 665_856, 24_969_600], // 3.0
  [5, 1_065_024, 39_938_400], // 3.1
  [8, 2_359_296, 77_856_768], // 4.0
  [9, 2_359_296, 155_713_536], // 4.1
  [12, 8_912_896, 273_715_200], // 5.0
  [13, 8_912_896, 547_430_400], // 5.1
  [14, 8_912_896, 1_094_860_800], // 5.2
];

/** The AV1 Main 8-bit codec string at the lowest level that fits, e.g. `av01.0.09M.08` for 1080×1920 at 60 fps. */
export function av1CodecString(width: number, height: number, fps: number): string {
  const size = width * height;
  const rate = size * fps;
  const level = AV1_LEVELS.find(([, maxSize, maxRate]) => size <= maxSize && rate <= maxRate)?.[0] ?? AV1_LEVELS[AV1_LEVELS.length - 1][0];
  return `av01.0.${String(level).padStart(2, "0")}M.08`;
}

/** The MP4 formats of `codec` (AAC, else Opus audio); none for H.264, which the fast export's own candidates cover. */
export function desktopFormatCandidates(codec: VideoCodec, width: number, height: number, fps: number): ExportFormat[] {
  if (codec === "h264") return [];
  const videoCodec = codec === "hevc" ? hevcCodecString(width, height, fps) : av1CodecString(width, height, fps);
  const track = codec === "hevc" ? "hevc" : "av1";
  return (["aac", "opus"] as const).map((audio) => ({
    container: "mp4",
    mimeType: "video/mp4",
    extension: "mp4",
    videoCodec,
    videoTrackCodec: track,
    audioCodec: audio === "aac" ? "mp4a.40.2" : "opus",
    audioTrackCodec: audio,
  }));
}

/** The first HEVC / AV1 format the browser encodes when the queue asks for one (null: fall back to the usual formats). */
export async function pickDesktopFormat(width: number, height: number, fps: number, probe: CodecProbe, codec: VideoCodec = state.codec): Promise<ExportFormat | null> {
  for (const format of desktopFormatCandidates(codec, width, height, fps)) {
    if (!(await probe.video(format.videoCodec).catch(() => false))) return null;
    if (await probe.audio(format.audioCodec).catch(() => false)) return format;
  }
  return null;
}

/** The video codec an export format wrote. */
export function formatVideoCodec(format: Pick<ExportFormat, "videoTrackCodec">): VideoCodec | null {
  if (format.videoTrackCodec === "avc") return "h264";
  if (format.videoTrackCodec === "hevc") return "hevc";
  if (format.videoTrackCodec === "av1") return "av1";
  return null;
}
