/*
 * --- social-publish --- A clip's thumbnail and length, read in the browser: the file plays muted in a detached <video>, a
 * frame near the start is drawn into a small canvas (a JPEG data URL). MediaRecorder's WebM files carry no duration
 * (Infinity), so the video seeks far past its end once – the browser then knows the real length – before the frame seek.
 * Resolves with nulls when the browser cannot decode the file; never rejects.
 */

export interface VideoInfo {
  thumb: string | null;
  durationSec: number | null;
}

export function readVideoInfo(blob: Blob, doc: Document, width = 160, timeoutMs = 8000): Promise<VideoInfo> {
  return new Promise<VideoInfo>((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(blob);
    } catch {
      resolve({ thumb: null, durationSec: null });
      return;
    }
    const video = doc.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let settled = false;
    let duration: number | null = null;
    const finish = (thumb: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = video.onseeked = video.onerror = video.ondurationchange = null;
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url);
      resolve({ thumb, durationSec: duration });
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const grab = () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return finish(null);
        const canvas = doc.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.max(1, Math.round((width * h) / w));
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        finish(null);
      }
    };
    const seekToFrame = () => {
      const target = duration ? Math.min(1.5, duration * 0.3) : 0.3;
      video.onseeked = grab;
      video.currentTime = target;
    };
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        duration = video.duration;
        seekToFrame();
        return;
      }
      // WebM without a duration: seek to the end once to learn it.
      video.ondurationchange = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          duration = video.duration;
          video.ondurationchange = null;
          seekToFrame();
        }
      };
      video.onseeked = () => {
        if (Number.isFinite(video.duration) && video.duration > 0 && duration === null) {
          duration = video.duration;
          video.ondurationchange = null;
          seekToFrame();
        }
      };
      video.currentTime = 1e101;
    };
    video.src = url;
  });
}
