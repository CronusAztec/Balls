/**
 * --- video-beats --- The imported video as a dimmed layer behind the arena. One hidden, muted <video> element holds the
 * file; the canvas calls `draw()` every frame with the simulation clock, and the layer keeps the element on the song time
 * the music bed plays (song time = start offset + simulation seconds, wrapped at the end when the bed loops): while the
 * run goes the element plays along and is re-seeked when it drifts more than `DRIFT_SEC`, while it is paused (or not
 * started) the element rests on the exact frame. The picture is cover-fitted into the whole canvas at `opacity`.
 *
 * The fast export draws the same layer from the hidden offline canvas: before every frame the export awaits
 * `seekForExport(t)` (a seek to that frame's song time, one per video frame at most), so the exported picture follows the
 * simulation clock exactly. A browser that seeks this file slower than `SLOW_SEEK_MS` per seek would take minutes, so
 * `prepareExport()` measures a few seeks first and the export then leaves the layer out (`exportSkipped`) and says so.
 */

/** The element is re-seeked when it drifts further than this from the song time (s). */
const DRIFT_SEC = 0.2;
/** A seek slower than this (ms, averaged over a few) makes the fast export leave the video layer out. */
export const SLOW_SEEK_MS = 150;
/** The export seeks at most once per this much song time (s): the frame rate of most videos. */
const EXPORT_SEEK_STEP = 1 / 30;
/** A seek that takes longer than this (ms) is abandoned (the frame keeps the previous picture). */
const SEEK_TIMEOUT_MS = 1500;

export interface VideoLayerOptions {
  /** Draw the layer at all (the setting, and a video with a picture loaded). */
  enabled: boolean;
  opacity: number;
  /** Song seconds at simulation time 0 (the music bed's start offset). */
  offset: number;
  loop: boolean;
}

export class VideoBackgroundLayer {
  private video: HTMLVideoElement | null = null;
  private url: string | null = null;
  private options: VideoLayerOptions = { enabled: false, opacity: 0.35, offset: 0, loop: true };
  private exporting = false;
  private lastExportSeek = NaN;
  /** The last fast export left the layer out (seeking was too slow). */
  exportSkipped = false;

  /** The object URL of the video (null removes it). */
  setSource(url: string | null) {
    if (url === this.url) return;
    this.url = url;
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      this.video = null;
    }
    if (!url || typeof document === "undefined") return;
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.loop = false;
    v.src = url;
    this.video = v;
  }

  setOptions(options: VideoLayerOptions) {
    this.options = { ...options };
    if (!options.enabled) this.video?.pause();
  }

  /** The layer will draw something (enabled and a video with a picture). */
  isActive(): boolean {
    return this.options.enabled && !!this.video;
  }

  private songTime(simSec: number): number {
    const v = this.video;
    const duration = v && Number.isFinite(v.duration) ? v.duration : 0;
    let t = this.options.offset + Math.max(0, simSec);
    if (duration > 0) {
      if (this.options.loop) t %= duration;
      else t = Math.min(t, Math.max(0, duration - 0.04));
    }
    return t;
  }

  /**
   * Draws the current video frame, cover-fitted, into a `width` × `height` (CSS px) canvas. `running`: the simulation
   * advances in real time (the element plays along); `offline`: the fast export positions the element itself.
   */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, simSec: number, running: boolean, offline: boolean) {
    const v = this.video;
    if (!v || !this.options.enabled) return;
    if (offline) {
      if (this.exportSkipped) return;
    } else if (!this.exporting) {
      const target = this.songTime(simSec);
      if (running) {
        if (v.paused && v.readyState >= 2) void v.play().catch(() => {});
        if (Math.abs(v.currentTime - target) > DRIFT_SEC) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.03 && !v.seeking) v.currentTime = target;
      }
    }
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!(vw > 0 && vh > 0) || v.readyState < 2) return;
    const fit = Math.max(width / vw, height / vh);
    const dw = vw * fit;
    const dh = vh * fit;
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = Math.max(0, Math.min(1, this.options.opacity));
    ctx.drawImage(v, (width - dw) / 2, (height - dh) / 2, dw, dh);
    ctx.globalAlpha = alpha;
  }

  private seekTo(t: number): Promise<number> {
    const v = this.video;
    if (!v) return Promise.resolve(0);
    const started = performance.now();
    return new Promise((resolve) => {
      const timer = setTimeout(finish, SEEK_TIMEOUT_MS);
      function finish() {
        clearTimeout(timer);
        v!.removeEventListener("seeked", finish);
        resolve(performance.now() - started);
      }
      v.addEventListener("seeked", finish);
      v.currentTime = t;
    });
  }

  /**
   * Before a fast export: pauses the element, waits until it can show frames and times a few seeks. Returns false (and
   * marks the layer skipped for the export) when there is nothing to draw or seeking is too slow.
   */
  async prepareExport(): Promise<boolean> {
    this.exportSkipped = false;
    this.lastExportSeek = NaN;
    const v = this.video;
    if (!v || !this.options.enabled) return false;
    this.exporting = true;
    v.pause();
    if (v.readyState < 2) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        v.addEventListener(
          "loadeddata",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    if (!(duration > 0) || !(v.videoWidth > 0)) {
      this.exportSkipped = true;
      return false;
    }
    let total = 0;
    const probes = [0.37, 0.61, 0.13, 0.83].map((f) => f * duration);
    for (const t of probes) total += await this.seekTo(t);
    if (total / probes.length > SLOW_SEEK_MS) {
      this.exportSkipped = true;
      return false;
    }
    return true;
  }

  /** Before an export frame at simulation time `simSec`: moves the element onto that frame's song time. */
  async seekForExport(simSec: number): Promise<void> {
    if (!this.exporting || this.exportSkipped || !this.video) return;
    const t = this.songTime(simSec);
    if (Number.isFinite(this.lastExportSeek) && Math.abs(t - this.lastExportSeek) < EXPORT_SEEK_STEP - 1e-6) return;
    this.lastExportSeek = t;
    await this.seekTo(t);
  }

  /** After the export: the page's run takes the element over again. */
  finishExport() {
    this.exporting = false;
    this.lastExportSeek = NaN;
  }

  dispose() {
    this.setSource(null);
  }
}
