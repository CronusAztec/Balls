import { describe, expect, it } from "vitest";
import { av1CodecString, desktopFormatCandidates, formatVideoCodec, hevcCodecString, pickDesktopFormat, resolveVideoConfig } from "@/lib/desktop/gpuEncode";
import { PLATFORM_PRESETS, customVideoKbps, renderFormatFor, transcodeSpecFor } from "@/lib/desktop/presets";
import { BRIDGE_METHODS, EVENT_CHANNELS, IPC, SEND_CHANNELS, checkIpcArgs } from "@/lib/desktop/contract";

/* --- desktop-exe --- GPU encoding for the fast export, output presets and the IPC contract's argument checks */

describe("prefer-hardware video configs", () => {
  const base = { codec: "avc1.42002a", width: 1080, height: 1920, framerate: 60, bitrate: 12_000_000 };
  it("asks for the GPU first in the app and falls back to the plain config", async () => {
    const seen: unknown[] = [];
    const gpu = await resolveVideoConfig(base, async (c) => (seen.push(c), { supported: true }), true);
    expect(gpu).toEqual({ ...base, hardwareAcceleration: "prefer-hardware" });
    const noGpu = await resolveVideoConfig(base, async (c) => ({ supported: !("hardwareAcceleration" in c) }), true);
    expect(noGpu).toEqual(base);
    expect(await resolveVideoConfig(base, async () => ({ supported: false }), true)).toBeNull();
    expect(await resolveVideoConfig(base, async () => Promise.reject(new Error("x")), true)).toBeNull();
  });
  it("leaves the website's configs untouched", async () => {
    const seen: unknown[] = [];
    expect(await resolveVideoConfig(base, async (c) => (seen.push(c), { supported: true }), false)).toEqual(base);
    expect(seen).toEqual([base]);
  });
});

describe("HEVC and AV1 formats", () => {
  it("picks the lowest level that fits", () => {
    expect(hevcCodecString(1080, 1920, 60)).toBe("hvc1.1.6.L123.B0");
    expect(hevcCodecString(1280, 720, 30)).toBe("hvc1.1.6.L93.B0");
    expect(hevcCodecString(2160, 3840, 60)).toBe("hvc1.1.6.L153.B0");
    expect(av1CodecString(1080, 1920, 60)).toBe("av01.0.09M.08");
    expect(av1CodecString(1080, 1920, 30)).toBe("av01.0.08M.08");
  });
  it("offers MP4 formats for HEVC / AV1 only, and falls back when WebCodecs lacks them", async () => {
    expect(desktopFormatCandidates("h264", 1080, 1920, 60)).toEqual([]);
    const hevc = desktopFormatCandidates("hevc", 1080, 1920, 60);
    expect(hevc.map((f) => [f.container, f.videoTrackCodec, f.audioTrackCodec])).toEqual([
      ["mp4", "hevc", "aac"],
      ["mp4", "hevc", "opus"],
    ]);
    const yes = { video: async () => true, audio: async (c: string) => c === "opus" };
    expect((await pickDesktopFormat(1080, 1920, 60, yes, "av1"))?.audioTrackCodec).toBe("opus");
    expect(await pickDesktopFormat(1080, 1920, 60, { video: async () => false, audio: async () => true }, "hevc")).toBeNull();
    expect(await pickDesktopFormat(1080, 1920, 60, yes, "h264")).toBeNull();
    expect(formatVideoCodec({ videoTrackCodec: "avc" })).toBe("h264");
    expect(formatVideoCodec({ videoTrackCodec: "V_VP9" })).toBeNull();
  });
});

describe("output presets", () => {
  it("keeps a native H.264 MP4 and re-encodes everything else", () => {
    const render = { width: 1080, height: 1920, fps: 60 };
    expect(transcodeSpecFor("native", "h264", render, { extension: "mp4", codec: "h264" })).toBeNull();
    expect(transcodeSpecFor("native", "hevc", render, { extension: "mp4", codec: "hevc" })).toBeNull();
    const webm = transcodeSpecFor("native", "h264", render, { extension: "webm", codec: null });
    expect(webm).toMatchObject({ codec: "h264", width: 1080, height: 1920, fps: 60 });
    const toHevc = transcodeSpecFor("native", "hevc", render, { extension: "mp4", codec: "h264" });
    expect(toHevc!.videoKbps).toBeLessThan(webm!.videoKbps);
  });
  it("follows the platform presets and upscales to 4K", () => {
    const render = { width: 1080, height: 1920, fps: 60 };
    expect(transcodeSpecFor("reels", "h264", render, { extension: "mp4", codec: "h264" })).toEqual({ codec: "h264", ...PLATFORM_PRESETS.reels });
    expect(transcodeSpecFor("uhd60", "h264", render, { extension: "mp4", codec: "h264" })).toMatchObject({ width: 2160, height: 3840, fps: 60 });
    expect(renderFormatFor("reels", "1920x1080", 60)).toEqual({ resolution: "1080x1920", fps: 30 });
    expect(renderFormatFor("native", "1920x1080", 30)).toEqual({ resolution: "1920x1080", fps: 30 });
    expect(customVideoKbps(1080, 1920, 60, "h264")).toBe(10000);
    expect(customVideoKbps(500, 500, 30, "h264")).toBe(2000);
  });
});

describe("IPC contract", () => {
  it("maps every bridge method to a distinct known channel", () => {
    const channels = Object.values(BRIDGE_METHODS);
    expect(new Set(channels).size).toBe(channels.length);
    const known = new Set<string>(Object.values(IPC));
    for (const c of channels) expect(known.has(c)).toBe(true);
    // Every request channel is reachable from the bridge (log is the one fire-and-forget channel).
    for (const c of Object.values(IPC)) expect(channels.includes(c as never) || SEND_CHANNELS.includes(c)).toBe(true);
    expect(Object.keys(EVENT_CHANNELS).sort()).toEqual(["aiToken", "menu", "modelProgress", "openFile", "renderProgress", "update"]);
  });
  it("checks what the page sends", () => {
    expect(checkIpcArgs(IPC.log, ["info", "hello"])).toBeNull();
    expect(checkIpcArgs(IPC.log, ["debug", "hello"])).not.toBeNull();
    expect(checkIpcArgs(IPC.pickMedia, ["song"])).toBeNull();
    expect(checkIpcArgs(IPC.pickMedia, ["exe"])).not.toBeNull();
    const save = { jobId: "j", folder: "", name: "a", extension: "mp4", data: new Uint8Array(3), transcode: null, meta: {} };
    expect(checkIpcArgs(IPC.renderSave, [save])).toBeNull();
    expect(checkIpcArgs(IPC.renderSave, [{ ...save, extension: "../exe" }])).not.toBeNull();
    expect(checkIpcArgs(IPC.renderSave, [{ ...save, data: "bytes" }])).not.toBeNull();
    expect(checkIpcArgs(IPC.aiChat, [{ requestId: "r", messages: [{ role: "user", content: "hi" }] }])).toBeNull();
    expect(checkIpcArgs(IPC.aiChat, [{ requestId: "r", messages: [{ role: "root", content: "hi" }] }])).not.toBeNull();
    expect(checkIpcArgs(IPC.aiSetCloud, [{ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt", use: true }])).toBeNull();
    expect(checkIpcArgs(IPC.aiSetCloud, [{ provider: "openai", baseUrl: "http://evil.example", model: "gpt", use: true }])).not.toBeNull();
    expect(checkIpcArgs(IPC.aiSetCloud, [{ provider: "openai", baseUrl: "http://localhost:11434/v1", model: "llama", use: true }])).toBeNull();
    expect(checkIpcArgs(IPC.libraryRemove, ["id", true])).toBeNull();
    expect(checkIpcArgs(IPC.libraryRemove, ["id"])).not.toBeNull();
  });
});
