import { afterEach, describe, expect, it, vi } from "vitest";
import { MIME_CANDIDATES, VideoRecorder, recordingExtension } from "@/lib/recording/recorder";

// --- free-watermark --- (was paywall-gate: the guard was mocked to grant) Record Video no longer asks the paywall's guard: it
// seals the watermark decision itself (lib/watermark/seal.ts) and starts for everyone – without a licence (Node has no
// localStorage) its frames carry the watermark, which tests/freeWatermark.test.ts checks.

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

// --- review fix (security-robustness) --- a recording that cannot start resolves false and leaves nothing running
describe("Record Video's start (review fix: security-robustness)", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame, MediaStream: g.MediaStream };
  afterEach(() => {
    Object.assign(g, saved);
    vi.restoreAllMocks();
  });

  /** A fake DOM: `canvas()` is what createElement("canvas") returns; the animation frames requested and still pending. */
  const stubDom = (canvas: () => object) => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // the recorder logs why it could not start
    const pending = new Set<number>();
    let next = 1;
    g.document = { createElement: (tag: string) => (tag === "canvas" ? canvas() : {}) };
    g.requestAnimationFrame = () => {
      const id = next++;
      pending.add(id);
      return id;
    };
    g.cancelAnimationFrame = (id: number) => void pending.delete(id);
    g.MediaStream = class {};
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = Object.assign(
      class {
        state = "recording";
        mimeType = "video/webm";
        ondataavailable: unknown = null;
        start() {}
        stop() {}
      },
      { isTypeSupported: () => true },
    );
    return pending;
  };
  const source = { width: 1080, height: 1920 } as unknown as HTMLCanvasElement;

  it("resolves false (no throw, no draw loop left running) when the browser refuses to capture the frame (30000×30000)", async () => {
    const pending = stubDom(() => ({
      getContext: () => ({}),
      captureStream: () => {
        throw new Error("Current canvas size is not supported by CanvasCaptureMediaStreamTrack");
      },
    }));
    const recorder = new VideoRecorder(source);
    await expect(recorder.startRecording({ resolution: { width: 30000, height: 30000 } })).resolves.toBe(false);
    expect(pending.size).toBe(0);
    expect(recorder.isRecording()).toBe(false);
    await expect(recorder.stopRecording()).resolves.toBeNull();
  });

  it("resolves false when the recording canvas has no 2D context, or there is no source canvas", async () => {
    const pending = stubDom(() => ({ getContext: () => null, captureStream: () => ({ getVideoTracks: () => [] }) }));
    await expect(new VideoRecorder(source).startRecording()).resolves.toBe(false);
    expect(pending.size).toBe(0);
    await expect(new VideoRecorder(null as unknown as HTMLCanvasElement).startRecording()).resolves.toBe(false);
  });

  it("starts the draw loop once the capture works", async () => {
    // A 2D context whose every method is a no-op (the first frame is drawn right away). --- free-watermark --- Deep: what a
    // method returns (a gradient, a pattern) answers every call too, and getImageData() reads ink – the watermark's layers are
    // built on such canvases and checked for not being blank.
    const ctx2d: unknown = new Proxy(function () {}, {
      get: (_target, prop) => (prop === "data" ? new Uint8ClampedArray([0, 0, 0, 255]) : prop === "width" ? 0 : ctx2d),
      apply: () => ctx2d,
      set: () => true,
    });
    const pending = stubDom(() => ({ getContext: () => ctx2d, captureStream: () => ({ getVideoTracks: () => [] }) }));
    const recorder = new VideoRecorder(source);
    await expect(recorder.startRecording({ resolution: { width: 1080, height: 1920 } })).resolves.toBe(true);
    expect(pending.size).toBe(1);
  });
});
