/**
 * Records the simulation canvas to a video file using MediaRecorder.
 *
 * The visible canvas is cropped to a centred square and drawn into an off-screen canvas of
 * the requested export resolution (e.g. 1080×1920) on every animation frame; text overlays
 * are re-drawn at export scale so they stay crisp. The stream is muxed with the tone
 * generator's audio track.
 *
 * MP4 is written only with H.264 and AAC (Safari, Chrome builds with an H.264 encoder) – the same order the fast export
 * picks its formats in; otherwise WebM (VP9/VP8 with Opus) is produced and the download gets a .webm extension. Only MIME
 * types that name their codecs are tried: a bare "video/mp4" lets the browser choose them, and Chromium without an
 * H.264 encoder then writes VP9 + Opus into an .mp4 that QuickTime, iOS Photos and many editors cannot play.
 *
 * --- free-watermark --- Everyone may record; a recording without a verified Pro licence carries the watermark. The decision
 * is sealed when the recording starts (lib/watermark/seal.ts: the stored licence verified again – no option of this class
 * can change it) and the mark is drawn by the compositor (`drawRecordingFrame()`) into the recorder's own off-screen canvas –
 * the canvas the stream is captured from, which never enters the document – so nothing on the page can take it off.
 */
import { SITE_SLUG } from "@/lib/site";
import { prepareStamp, sealWatermark, stampFrame, type FrameMark } from "@/lib/watermark/seal"; // --- free-watermark ---
import { liveMarkCovers } from "@/lib/watermark/live"; // --- watermark-everywhere --- (the page's canvas carries the mark itself)

/** --- review fix (docs-consistency) --- The stem of a downloaded clip (`jumpingballslive-export.mp4`), from the site's name. */
export const EXPORT_BASE_NAME = `${SITE_SLUG}-export`;

export interface RecordingTextOverlay {
  topText?: string;
  bottomText?: string;
  textSize?: number;
  watermarkText?: string;
}

export interface RecordingOptions {
  resolution?: { width: number; height: number };
  mimeType?: string;
  audioStream?: MediaStream | null;
  duration?: number;
  textOverlay?: RecordingTextOverlay;
  videoBitsPerSecond?: number;
  backgroundColor?: string;
  // --- themes: paints the frame's background (gradient / picture) before the cropped canvas, so the letterbox bars continue it
  drawBackground?: (ctx: CanvasRenderingContext2D, width: number, height: number, crop: RecordingCrop) => void;
  // --- end themes
  /**
   * --- review fix (performance) --- The number of frames the source canvas has drawn so far. With it the recorder copies
   * each drawn frame exactly once (checked on every animation frame) and hands it to the stream itself (`requestFrame()`),
   * so a clip recorded on a 75 / 144 Hz display holds no repeated or skipped frames; without it every animation frame is
   * copied into a 60 fps stream, as before.
   */
  sourceFrames?: () => number;
}

// --- themes
/** Where the cropped square of the source canvas (device pixels) lands in the exported frame. */
export interface RecordingCrop {
  sx: number;
  sy: number;
  side: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  sourceWidth: number;
  sourceHeight: number;
}
// --- end themes

/** Where the recorder draws the Top / Bottom Text in an export frame (px): the font size and the centres of the two lines. */
export interface RecordingTextLayout {
  fontSize: number;
  topY: number;
  bottomY: number;
}

/**
 * The Top / Bottom Text of a `width` × `height` export frame: 4 % of the exported square (the centred square the canvas
 * is cropped to) × `textSize`, 0.6 font sizes outside the arena ring (85 % of the half square), kept inside the frame.
 * The canvas keeps its bottom and top captions clear of these lines while it records (captions.ts `exportEdgeTextLines()`).
 */
export function recordingTextLayout(width: number, height: number, textSize = 1, out: RecordingTextLayout = { fontSize: 0, topY: 0, bottomY: 0 }): RecordingTextLayout {
  const square = Math.min(width, height);
  const fontSize = Math.max(16, 0.04 * square) * textSize;
  const centerY = (height - square) / 2 + square / 2;
  const arena = (square / 2) * 0.85;
  const pad = 0.6 * fontSize;
  out.fontSize = fontSize;
  out.topY = Math.max(0.6 * fontSize, centerY - arena - pad);
  out.bottomY = Math.min(height - 0.6 * fontSize, centerY + arena + pad);
  return out;
}

// --- fast-render ---
/**
 * One export frame, as the real-time recorder and the fast export (fastRender.ts) both draw it: the background (`bg`, then
 * the theme's `drawBackground` so the letterbox bars continue a gradient or picture), the centred square of `source`
 * scaled to fill the frame's shorter side, and the Top / Bottom Text at export resolution (`textLayout`).
 * --- free-watermark --- Last, over everything: the watermark of a run whose seal (`mark.seal`, from `sealWatermark()` when
 * the run started) is not a verified Pro licence's – a missing or look-alike seal counts as none.
 */
export function drawRecordingFrame(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  width: number,
  height: number,
  bg: string,
  options: Pick<RecordingOptions, "drawBackground" | "textOverlay">,
  textLayout: RecordingTextLayout,
  mark: FrameMark, // --- free-watermark ---
) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const sw = source.width;
  const sh = source.height;
  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2;
  const sy = (sh - side) / 2;
  const scale = Math.min(width / side, height / side);
  const dw = side * scale;
  const dh = side * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  options.drawBackground?.(ctx, width, height, { sx, sy, side, dx, dy, dw, dh, sourceWidth: sw, sourceHeight: sh }); // --- themes
  ctx.drawImage(source, sx, sy, side, side, dx, dy, dw, dh);

  const overlay = options.textOverlay;
  if (overlay && (overlay.topText || overlay.bottomText)) {
    ctx.save();
    ctx.font = `bold ${textLayout.fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.95;
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = 8;
    const centerX = width / 2;
    if (overlay.topText) ctx.fillText(overlay.topText, centerX, textLayout.topY);
    if (overlay.bottomText) ctx.fillText(overlay.bottomText, centerX, textLayout.bottomY);
    ctx.restore();
  }
  // --- free-watermark --- the frame's pixels get the mark here, in the compositor's own canvas
  // --- watermark-everywhere --- unless the copied source is the page's live canvas and its frame already carries the live
  // mark (lib/watermark/live.ts places it where the video layout does while it is recorded): one badge per frame, never two.
  // The fast export's canvas never does (the canvas skips the live pass offline), so its frames are stamped here as before.
  if (!liveMarkCovers(source)) stampFrame(ctx, mark?.seal ?? null, { width, height, clipMs: mark?.clipMs ?? 0, square: { x: dx, y: dy, width: dw, height: dh } });
}
// --- end fast-render ---

/** --- review fix (recording-export) --- every type names its codecs; H.264 + AAC first, then WebM, H.264 + Opus last (like the fast export). */
export const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,opus",
  "video/mp4;codecs=avc1.42E01E",
];

/** The file extension of a recording: "mp4" only for an MP4 that holds H.264 (avc1 / avc3), "webm" otherwise. */
export function recordingExtension(mimeType: string): "mp4" | "webm" {
  const type = mimeType.toLowerCase();
  if (!type.includes("mp4")) return "webm";
  // A bare "video/mp4" from a browser that names no codecs is taken at its word; one that names others (VP9 in MP4) is not an .mp4 to play.
  return !type.includes("codecs=") || type.includes("avc1") || type.includes("avc3") ? "mp4" : "webm";
}

export class VideoRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private sourceCanvas: HTMLCanvasElement | null;
  private recordingCanvas: HTMLCanvasElement | null = null;
  private animationFrameId: number | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(sourceCanvas: HTMLCanvasElement) {
    this.sourceCanvas = sourceCanvas;
  }

  static isSupported() {
    return typeof window !== "undefined" && typeof MediaRecorder !== "undefined";
  }

  /** --- review fix (performance) --- Whether a canvas stream's frames can be captured on request (captureStream(0) + requestFrame()). */
  static supportsRequestFrame() {
    const Track = (globalThis as { CanvasCaptureMediaStreamTrack?: { prototype: { requestFrame?: unknown } } }).CanvasCaptureMediaStreamTrack;
    return typeof Track?.prototype?.requestFrame === "function";
  }

  /**
   * Starts recording; resolves false (never throws) when it cannot start – no canvas, an oversized frame the browser refuses
   * to capture, no 2D context, no MediaRecorder for the stream – after undoing what it had set up (the draw loop, the timer).
   */
  async startRecording(options: RecordingOptions = {}): Promise<boolean> {
    if (!this.sourceCanvas) return false; // --- review fix (security-robustness) --- (was a throw the page did not catch)
    // --- free-watermark --- everyone records; the stored licence, verified again now, decides whether the frames get the mark
    const seal = await sealWatermark();
    if (!this.sourceCanvas) return false;
    this.chunks = [];
    const width = options.resolution?.width || this.sourceCanvas.width;
    const height = options.resolution?.height || this.sourceCanvas.height;
    // --- review fix (security-robustness) --- the canvas, its context and the capture are set up inside the try (a 30000×30000
    // frame makes captureStream() throw), and the draw loop starts only once the capture works
    try {
      this.recordingCanvas = document.createElement("canvas");
      this.recordingCanvas.width = width;
      this.recordingCanvas.height = height;
      const ctx = this.recordingCanvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get recording canvas context");
      const bg = options.backgroundColor ?? "#0a0a0a";
      const textLayout = recordingTextLayout(width, height, options.textOverlay?.textSize ?? 1);
      prepareStamp(seal, { width, height }); // --- free-watermark --- (a mark that cannot be drawn stops the start here)

      // --- review fix (performance) --- with the source's frame count, a frame is captured on request, once per drawn frame
      const sourceFrames = options.sourceFrames;
      const manual = !!sourceFrames && VideoRecorder.supportsRequestFrame();
      const videoStream = this.recordingCanvas.captureStream(manual ? 0 : 60);
      const track = videoStream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
      const stream =
        options.audioStream && options.audioStream.getAudioTracks().length > 0
          ? new MediaStream([...videoStream.getVideoTracks(), ...options.audioStream.getAudioTracks()])
          : videoStream;
      const mimeType = VideoRecorder.getBestMimeType(options.mimeType);

      let copied = Number.NaN;
      const startedAt = performance.now(); // --- free-watermark --- the clip's clock (the badge changes corner every 6 s of it)
      const drawFrame = () => {
        if (!this.sourceCanvas || !this.recordingCanvas) return;
        const drawn = sourceFrames ? sourceFrames() : Number.NaN;
        if (!sourceFrames || drawn !== copied) {
          copied = drawn;
          if (manual) track?.requestFrame?.();
          drawRecordingFrame(ctx, this.sourceCanvas, width, height, bg, options, textLayout, { seal, clipMs: performance.now() - startedAt }); // --- fast-render --- (shared with the fast export) --- free-watermark --- (the seal of this recording)
        }
        this.animationFrameId = requestAnimationFrame(drawFrame);
      };
      drawFrame(); // the stream's first frame now (the source already shows the run)

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: options.videoBitsPerSecond ?? 8_000_000,
        audioBitsPerSecond: 128_000,
      });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.mediaRecorder.start(1000);
      if (options.duration) {
        this.stopTimer = setTimeout(() => void this.stopRecording(), options.duration);
      }
      return true;
    } catch (err) {
      console.error("Failed to start recording:", err);
      this.cleanupRecording();
      return false;
    }
  }

  private cleanupRecording() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    this.recordingCanvas = null;
  }

  async stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        this.cleanupRecording();
        resolve(null);
        return;
      }
      const recorder = this.mediaRecorder;
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        this.cleanupRecording();
        resolve(blob);
      };
      recorder.stop();
    });
  }

  isRecording() {
    return this.mediaRecorder?.state === "recording";
  }

  getMimeType() {
    return this.mediaRecorder?.mimeType ?? "";
  }

  /** Triggers a download; the extension is picked from the blob's container type. */
  downloadBlob(blob: Blob, baseName = EXPORT_BASE_NAME) {
    const ext = recordingExtension(blob.type); // --- review fix (recording-export) --- (never .mp4 for VP9 in MP4)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** The first supported type of `MIME_CANDIDATES`; `preferred` goes first only when it names its codecs. */
  static getBestMimeType(preferred?: string): string {
    if (typeof MediaRecorder === "undefined") return "video/webm";
    const candidates = preferred && /codecs=/i.test(preferred) ? [preferred, ...MIME_CANDIDATES] : MIME_CANDIDATES; // --- review fix (recording-export) ---
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return "video/webm";
  }
}
