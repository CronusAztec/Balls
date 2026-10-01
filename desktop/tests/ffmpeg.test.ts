import { describe, expect, it } from "vitest";
import { KNOWN_ENCODERS, chooseEncoders, encoderInventory, parseEncoderList, parseFfmpegVersion, probeEncoders, type FfmpegRunner } from "../src/ffmpeg/encoders";
import { buildBenchmarkArgs, buildTestEncodeArgs, buildThumbnailArgs, buildTranscodeArgs, encoderArgs, parseDuration, parseProgress, parseVideoSize, videoFilter } from "../src/ffmpeg/args";
import { PLATFORM_PRESETS, transcodeSpecFor } from "@/lib/desktop/presets";
import type { EncoderInfo } from "@/lib/desktop/contract";

/* --- desktop-exe --- encoder selection from `ffmpeg -encoders` and the argument builders per preset */

const ENCODERS_OUTPUT = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_amf             AMD AMF H.264 Encoder (codec h264)
 V....D h264_mf              H264 via MediaFoundation (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration) (codec h264)
 V....D libx265              libx265 H.265 / HEVC (codec hevc)
 V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
 V....D hevc_amf             AMD AMF HEVC encoder (codec hevc)
 V....D av1_nvenc            NVIDIA NVENC av1 encoder (codec av1)
 V....D libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)
 A....D aac                  AAC (Advanced Audio Coding)
`;

function inventory(works: Record<string, boolean>): EncoderInfo[] {
  return encoderInventory(parseEncoderList(ENCODERS_OUTPUT)).map((e) => ({ ...e, works: e.listed ? (works[e.id] ?? e.kind === "software") : null }));
}

describe("encoder selection", () => {
  it("reads the encoder names of ffmpeg -encoders", () => {
    const names = parseEncoderList(ENCODERS_OUTPUT);
    expect([...names]).toEqual(["libx264", "h264_amf", "h264_mf", "h264_nvenc", "h264_qsv", "libx265", "hevc_nvenc", "hevc_amf", "av1_nvenc", "libsvtav1", "aac"]);
    expect(names.has("V.....")).toBe(false);
    expect(parseFfmpegVersion("ffmpeg version 6.1.1-static https://johnvansickle.com Copyright")).toBe("6.1.1-static");
  });
  it("prefers the running GPU's encoder: NVENC on NVIDIA, AMF on AMD, QSV on Intel", () => {
    const all = inventory({ h264_nvenc: true, h264_amf: true, h264_qsv: true, h264_mf: true, hevc_nvenc: true, hevc_amf: true, av1_nvenc: true });
    expect(chooseEncoders(all, "nvidia")).toEqual({ h264: "h264_nvenc", hevc: "hevc_nvenc", av1: "av1_nvenc" });
    expect(chooseEncoders(all, "amd")).toEqual({ h264: "h264_amf", hevc: "hevc_amf", av1: "av1_nvenc" });
    expect(chooseEncoders(all, "intel").h264).toBe("h264_qsv");
  });
  it("uses only hardware encoders whose test encode worked, else software", () => {
    // Listed but no NVIDIA GPU: the test encode fails, AMF works.
    const amdOnly = inventory({ h264_nvenc: false, hevc_nvenc: false, av1_nvenc: false, h264_amf: true, hevc_amf: true, h264_qsv: false, h264_mf: false });
    expect(chooseEncoders(amdOnly, "nvidia")).toEqual({ h264: "h264_amf", hevc: "hevc_amf", av1: "libsvtav1" });
    const none = inventory({});
    expect(chooseEncoders(none, "intel")).toEqual({ h264: "libx264", hevc: "libx265", av1: "libsvtav1" });
    // Untested hardware (works: null) never counts.
    const untested = encoderInventory(parseEncoderList(ENCODERS_OUTPUT));
    expect(chooseEncoders(untested, "nvidia").h264).toBe("libx264");
    expect(chooseEncoders(encoderInventory(new Set()), null)).toEqual({ h264: null, hevc: null, av1: null });
  });
  it("honours an override that works", () => {
    const all = inventory({ h264_nvenc: true, h264_mf: true });
    expect(chooseEncoders(all, "nvidia", "h264_mf").h264).toBe("h264_mf");
    expect(chooseEncoders(all, "nvidia", "h264_qsv").h264).toBe("h264_nvenc"); // listed but broken: ignored
  });
  it("probes with a runner: lists, test-encodes and chooses", async () => {
    const calls: string[][] = [];
    const runner: FfmpegRunner = {
      run: async (args) => {
        calls.push(args);
        if (args.includes("-version")) return { code: 0, stdout: "ffmpeg version 7.1 Copyright", stderr: "" };
        if (args.includes("-encoders")) return { code: 0, stdout: ENCODERS_OUTPUT, stderr: "" };
        const enc = args[args.indexOf("-c:v") + 1];
        return { code: ["h264_nvenc", "hevc_nvenc", "libx264", "libx265", "libsvtav1"].includes(enc) ? 0 : 1, stdout: "", stderr: "" };
      },
    };
    const probe = await probeEncoders(runner, { path: "ffmpeg", bundled: true }, "nvidia");
    expect(probe.error).toBeNull();
    expect(probe.ffmpeg).toEqual({ path: "ffmpeg", version: "7.1", bundled: true });
    expect(probe.chosen).toEqual({ h264: "h264_nvenc", hevc: "hevc_nvenc", av1: "libsvtav1" });
    expect(probe.encoders.find((e) => e.id === "av1_nvenc")?.works).toBe(false);
    expect(probe.encoders.find((e) => e.id === "h264_videotoolbox")).toMatchObject({ listed: false, works: null });
    // Every listed known encoder got a one-second test encode.
    const tested = calls.filter((c) => c.includes("lavfi")).map((c) => c[c.indexOf("-c:v") + 1]);
    expect(tested.sort()).toEqual(KNOWN_ENCODERS.filter((e) => parseEncoderList(ENCODERS_OUTPUT).has(e.id)).map((e) => e.id).sort());
    const broken = await probeEncoders({ run: async () => ({ code: 1, stdout: "", stderr: "" }) }, { path: "x", bundled: false }, null);
    expect(broken.error).toMatch(/exited with 1/);
  });
});

describe("ffmpeg arguments", () => {
  const render = { width: 1080, height: 1920, fps: 60 };
  it("builds a TikTok transcode on NVENC", () => {
    const spec = transcodeSpecFor("tiktok", "h264", render, { extension: "webm", codec: null })!;
    const args = buildTranscodeArgs("in.webm", "out.mp4", spec, "h264_nvenc");
    const joined = args.join(" ");
    expect(joined).toContain("-i in.webm");
    expect(joined).toContain("-vf scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=60");
    expect(joined).toContain("-c:v h264_nvenc -preset p5 -tune hq -rc vbr -b:v 10000k -maxrate 12000k -bufsize 24000k -profile:v high -pix_fmt yuv420p");
    expect(joined).toContain(`-c:a aac -b:a 192k -ar ${PLATFORM_PRESETS.tiktok.sampleRate} -ac 2 -movflags +faststart -progress pipe:1`);
    expect(args[args.length - 1]).toBe("out.mp4");
    expect(args).toContain("0:a:0?"); // a clip without sound still converts
  });
  it("builds Reels on AMF, Shorts on QSV, 4K HEVC on libx265 with the hvc1 tag", () => {
    const reels = buildTranscodeArgs("a", "b", transcodeSpecFor("reels", "h264", render, { extension: "mp4", codec: "h264" })!, "h264_amf").join(" ");
    expect(reels).toContain("fps=30");
    expect(reels).toContain("-c:v h264_amf -quality quality -rc vbr_peak -b:v 8000k");
    expect(reels).toContain("-b:a 128k -ar 48000");
    const shorts = buildTranscodeArgs("a", "b", transcodeSpecFor("shorts", "h264", render, { extension: "mp4", codec: "h264" })!, "h264_qsv").join(" ");
    expect(shorts).toContain("-c:v h264_qsv -preset slower -b:v 12000k -maxrate 16000k");
    expect(shorts).toContain("-pix_fmt nv12");
    expect(shorts).toContain("-b:a 384k");
    const uhd = buildTranscodeArgs("a", "b", transcodeSpecFor("uhd60", "hevc", render, { extension: "mp4", codec: "h264" })!, "libx265").join(" ");
    expect(uhd).toContain("scale=2160:3840");
    expect(uhd).toContain("-c:v libx265 -preset medium -crf 22");
    expect(uhd).toContain("-tag:v hvc1");
  });
  it("covers every known encoder with sensible options", () => {
    for (const e of KNOWN_ENCODERS) {
      const args = encoderArgs(e.id, { codec: e.codec, videoKbps: 5000, maxKbps: 6000 });
      expect(args.slice(0, 4).join(" ")).toContain(e.id);
    }
    expect(encoderArgs("libx264", { codec: "h264", videoKbps: 5000, maxKbps: 6000 })).toContain("-crf");
    expect(videoFilter({ width: 720, height: 1280, fps: 30 }, "h264_vaapi")).toMatch(/format=nv12,hwupload$/);
  });
  it("builds the test encode, benchmark and thumbnail commands", () => {
    expect(buildTestEncodeArgs("hevc_amf").join(" ")).toContain("-f lavfi -i testsrc2=size=1280x720:rate=30 -t 1 -c:v hevc_amf");
    expect(buildTestEncodeArgs("hevc_amf").slice(-3)).toEqual(["-f", "null", "-"]);
    expect(buildBenchmarkArgs("h264_nvenc", "h264", 5).join(" ")).toContain("testsrc2=size=1080x1920:rate=60 -t 5");
    expect(buildThumbnailArgs("in.mp4", "t.jpg", 1.5)).toEqual(["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-ss", "1.5", "-i", "in.mp4", "-frames:v", "1", "-vf", "scale=270:-2", "-q:v", "5", "t.jpg"]);
  });
  it("reads durations, sizes and progress", () => {
    const banner = "Input #0, mov,mp4, from 'x.mp4':\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 8000 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1080x1920 [SAR 1:1 DAR 9:16], 7900 kb/s, 60 fps";
    expect(parseDuration(banner)).toBeCloseTo(62.5);
    expect(parseVideoSize(banner)).toEqual({ width: 1080, height: 1920 });
    expect(parseDuration("nothing")).toBeNull();
    expect(parseProgress("frame=10\nout_time_us=1500000\nprogress=continue\n")).toEqual({ outTimeUs: 1500000, done: false });
    expect(parseProgress("out_time_us=N/A\nprogress=end\n")).toEqual({ outTimeUs: null, done: true });
  });
});
