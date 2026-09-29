/**
 * Records the simulation canvas to a video file using MediaRecorder.
 *
 * The visible canvas is cropped to a centred square and drawn into an off-screen canvas of
 * the requested export resolution (e.g. 1080×1920) on every animation frame; text overlays
 * are re-drawn at export scale so they stay crisp. The stream is muxed with the tone
 * generator's audio track.
 *
 * MP4 (H.264) is used when the browser supports it in MediaRecorder (Chrome 126+, Safari);
 * otherwise WebM (VP9/VP8) is produced and the download gets a .webm extension.
 */

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

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

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

  async startRecording(options: RecordingOptions = {}): Promise<boolean> {
    if (!this.sourceCanvas) throw new Error("Canvas not available");
    this.chunks = [];
    const width = options.resolution?.width || this.sourceCanvas.width;
    const height = options.resolution?.height || this.sourceCanvas.height;
    this.recordingCanvas = document.createElement("canvas");
    this.recordingCanvas.width = width;
    this.recordingCanvas.height = height;
    const ctx = this.recordingCanvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get recording canvas context");
    const bg = options.backgroundColor ?? "#0a0a0a";
    const textLayout = recordingTextLayout(width, height, options.textOverlay?.textSize ?? 1);

    const drawFrame = () => {
      if (!this.sourceCanvas || !this.recordingCanvas || !ctx) return;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      const sw = this.sourceCanvas.width;
      const sh = this.sourceCanvas.height;
      const side = Math.min(sw, sh);
      const sx = (sw - side) / 2;
      const sy = (sh - side) / 2;
      const scale = Math.min(width / side, height / side);
      const dw = side * scale;
      const dh = side * scale;
      const dx = (width - dw) / 2;
      const dy = (height - dh) / 2;
      options.drawBackground?.(ctx, width, height, { sx, sy, side, dx, dy, dw, dh, sourceWidth: sw, sourceHeight: sh }); // --- themes
      ctx.drawImage(this.sourceCanvas, sx, sy, side, side, dx, dy, dw, dh);

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
      this.animationFrameId = requestAnimationFrame(drawFrame);
    };
    this.animationFrameId = requestAnimationFrame(drawFrame);

    const videoStream = this.recordingCanvas.captureStream(60);
    const stream =
      options.audioStream && options.audioStream.getAudioTracks().length > 0
        ? new MediaStream([...videoStream.getVideoTracks(), ...options.audioStream.getAudioTracks()])
        : videoStream;
    const mimeType = VideoRecorder.getBestMimeType(options.mimeType);
    try {
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
  downloadBlob(blob: Blob, baseName = "viralballs-export") {
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  static getBestMimeType(preferred?: string): string {
    if (typeof MediaRecorder === "undefined") return "video/webm";
    const candidates = preferred ? [preferred, ...MIME_CANDIDATES] : MIME_CANDIDATES;
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return "video/webm";
  }
}
