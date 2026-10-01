import { afterEach, describe, expect, it } from "vitest";
import { MIME_CANDIDATES, VideoRecorder, recordingExtension } from "@/lib/recording/recorder";

/*
 * --- review fix (recording-export) --- Record Video's container and codecs: MP4 only with H.264 (+ AAC), WebM otherwise –
 * never VP9 + Opus inside an .mp4, which Chromium without an H.264 encoder writes when it is handed a bare "video/mp4".
 */

const original = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
afterEach(() => {
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = original;
});
const stubSupport = (supported: (type: string) => boolean) => {
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = { isTypeSupported: supported };
};

/** Chromium without an H.264 MediaRecorder encoder (headless Chromium 141, Linux builds): bare MP4 "works" – as VP9 + Opus. */
const chromiumNoH264 = (type: string) => {
  const t = type.toLowerCase();
  if (t.includes("avc1") || t.includes("avc3")) return false;
  if (t === "video/mp4" || t === "video/mp4;codecs=vp9,opus") return true;
  return t.startsWith("video/webm");
};
/** Safari: MP4 with H.264 and AAC, no WebM recording. */
const safari = (type: string) => {
  const t = type.toLowerCase();
  if (t.startsWith("video/webm")) return false;
  return t === "video/mp4" || t === "video/mp4;codecs=avc1.42e01e,mp4a.40.2" || t === "video/mp4;codecs=avc1.42e01e";
};

describe("Record Video's format", () => {
  it("lists no MP4 type without its codecs (a bare WebM is the last WebM resort: that container holds only VP8 / VP9 / AV1)", () => {
    for (const type of MIME_CANDIDATES) if (type.includes("mp4")) expect(type, type).toMatch(/codecs=avc1/);
    expect(MIME_CANDIDATES).not.toContain("video/mp4");
    expect(MIME_CANDIDATES[0]).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2");
  });

  it("picks WebM VP9 + Opus in a Chromium without H.264 – also when asked for a bare video/mp4", () => {
    stubSupport(chromiumNoH264);
    expect(VideoRecorder.getBestMimeType()).toBe("video/webm;codecs=vp9,opus");
    expect(VideoRecorder.getBestMimeType("video/mp4")).toBe("video/webm;codecs=vp9,opus");
  });

  it("picks MP4 with H.264 and AAC in Safari", () => {
    stubSupport(safari);
    expect(VideoRecorder.getBestMimeType()).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2");
    expect(VideoRecorder.getBestMimeType("video/mp4")).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2");
  });

  it("honours a preferred type only when it names its codecs and is supported", () => {
    stubSupport(chromiumNoH264);
    expect(VideoRecorder.getBestMimeType("video/webm;codecs=vp8,opus")).toBe("video/webm;codecs=vp8,opus");
    expect(VideoRecorder.getBestMimeType("video/mp4;codecs=avc1.42E01E")).toBe("video/webm;codecs=vp9,opus");
  });

  it("names the download .mp4 only for H.264 in MP4", () => {
    expect(recordingExtension("video/mp4;codecs=avc1.42E01E,mp4a.40.2")).toBe("mp4");
    expect(recordingExtension("video/mp4; codecs=avc3.640028")).toBe("mp4");
    expect(recordingExtension("video/mp4")).toBe("mp4");
    expect(recordingExtension("video/mp4;codecs=vp9,opus")).toBe("webm");
    expect(recordingExtension("video/webm;codecs=vp9,opus")).toBe("webm");
    expect(recordingExtension("")).toBe("webm");
  });
});
