import type { EncoderInfo, EncoderKind, EncoderProbe, GpuVendor, VideoCodec } from "@/lib/desktop/contract";
import { buildTestEncodeArgs } from "./args";

/*
 * --- desktop-exe --- Which ffmpeg encoder the app uses per codec. `ffmpeg -encoders` lists what the build contains (a
 * build can list NVENC on a PC without an NVIDIA GPU), so every hardware encoder listed also gets a one-second test
 * encode; only one that works is used. The GPU the app runs on goes first (NVENC on NVIDIA, AMF on AMD, Quick Sync on
 * Intel), then any other working hardware encoder (Media Foundation, VA-API…), then software (libx264, libx265, SVT-AV1).
 */

export const KNOWN_ENCODERS: readonly { id: string; codec: VideoCodec; kind: EncoderKind }[] = [
  { id: "h264_nvenc", codec: "h264", kind: "nvenc" },
  { id: "h264_amf", codec: "h264", kind: "amf" },
  { id: "h264_qsv", codec: "h264", kind: "qsv" },
  { id: "h264_mf", codec: "h264", kind: "mf" },
  { id: "h264_vaapi", codec: "h264", kind: "vaapi" },
  { id: "h264_videotoolbox", codec: "h264", kind: "videotoolbox" },
  { id: "libx264", codec: "h264", kind: "software" },
  { id: "libopenh264", codec: "h264", kind: "software" },
  { id: "hevc_nvenc", codec: "hevc", kind: "nvenc" },
  { id: "hevc_amf", codec: "hevc", kind: "amf" },
  { id: "hevc_qsv", codec: "hevc", kind: "qsv" },
  { id: "hevc_mf", codec: "hevc", kind: "mf" },
  { id: "hevc_vaapi", codec: "hevc", kind: "vaapi" },
  { id: "hevc_videotoolbox", codec: "hevc", kind: "videotoolbox" },
  { id: "libx265", codec: "hevc", kind: "software" },
  { id: "av1_nvenc", codec: "av1", kind: "nvenc" },
  { id: "av1_amf", codec: "av1", kind: "amf" },
  { id: "av1_qsv", codec: "av1", kind: "qsv" },
  { id: "av1_mf", codec: "av1", kind: "mf" },
  { id: "av1_vaapi", codec: "av1", kind: "vaapi" },
  { id: "libsvtav1", codec: "av1", kind: "software" },
  { id: "libaom-av1", codec: "av1", kind: "software" },
  { id: "librav1e", codec: "av1", kind: "software" },
];

const VENDOR_KIND: Partial<Record<GpuVendor, EncoderKind>> = { nvidia: "nvenc", amd: "amf", intel: "qsv", apple: "videotoolbox" };
const HARDWARE_ORDER: readonly EncoderKind[] = ["nvenc", "amf", "qsv", "videotoolbox", "mf", "vaapi"];

/** The encoder names in `ffmpeg -encoders` output (video, audio and subtitle lines alike). */
export function parseEncoderList(stdout: string): Set<string> {
  const names = new Set<string>();
  let body = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (/^\s*-{3,}\s*$/.test(line)) {
      body = true;
      continue;
    }
    if (!body) continue;
    const m = /^\s*[VAS][F.][S.][X.][B.][D.]\s+(\S+)\s/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

/** The known encoders with whether this build lists them (not yet tested). */
export function encoderInventory(listed: ReadonlySet<string>): EncoderInfo[] {
  return KNOWN_ENCODERS.map((e) => ({ ...e, listed: listed.has(e.id), works: null }));
}

/**
 * The encoder per codec: an override (when listed and not known broken), else the running GPU's hardware encoder, other
 * working hardware encoders, then software. A hardware encoder counts only once its test encode worked.
 */
export function chooseEncoders(encoders: readonly EncoderInfo[], vendor: GpuVendor | null, override = ""): Record<VideoCodec, string | null> {
  const usable = (e: EncoderInfo) => e.listed && (e.kind === "software" ? e.works !== false : e.works === true);
  const pick = (codec: VideoCodec): string | null => {
    const mine = encoders.filter((e) => e.codec === codec && usable(e));
    const forced = mine.find((e) => e.id === override);
    if (forced) return forced.id;
    const preferred = vendor ? VENDOR_KIND[vendor] : undefined;
    const order = [...(preferred ? [preferred] : []), ...HARDWARE_ORDER.filter((k) => k !== preferred), "software" as const];
    for (const kind of order) {
      const hit = mine.find((e) => e.kind === kind);
      if (hit) return hit.id;
    }
    return null;
  };
  return { h264: pick("h264"), hevc: pick("hevc"), av1: pick("av1") };
}

export interface FfmpegRunner {
  run(args: string[], options?: { timeoutMs?: number }): Promise<{ code: number | null; stdout: string; stderr: string }>;
}

/** `ffmpeg -version`'s first line ("ffmpeg version 6.1.1 …" → "6.1.1"). */
export function parseFfmpegVersion(stdout: string): string {
  const m = /ffmpeg version (\S+)/.exec(stdout);
  return m ? m[1] : "unknown";
}

/** Lists the encoders, test-encodes each listed hardware encoder (and the software fallbacks) and chooses per codec. */
export async function probeEncoders(runner: FfmpegRunner, ffmpeg: { path: string; bundled: boolean }, vendor: GpuVendor | null, override = ""): Promise<EncoderProbe> {
  try {
    const version = parseFfmpegVersion((await runner.run(["-hide_banner", "-version"], { timeoutMs: 15000 })).stdout);
    const listing = await runner.run(["-hide_banner", "-encoders"], { timeoutMs: 15000 });
    if (listing.code !== 0) throw new Error(`ffmpeg -encoders exited with ${listing.code}`);
    const encoders = encoderInventory(parseEncoderList(listing.stdout));
    for (const e of encoders) {
      if (!e.listed) continue;
      const test = await runner.run(buildTestEncodeArgs(e.id), { timeoutMs: 20000 }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
      e.works = test.code === 0;
    }
    return { ffmpeg: { path: ffmpeg.path, version, bundled: ffmpeg.bundled }, encoders, chosen: chooseEncoders(encoders, vendor, override), error: null };
  } catch (err) {
    return { ffmpeg: null, encoders: encoderInventory(new Set()), chosen: { h264: null, hevc: null, av1: null }, error: err instanceof Error ? err.message : String(err) };
  }
}
