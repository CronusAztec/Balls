/**
 * --- uncap-all --- The canvas side of Uncapped everything: the speed readout and the overflow badge.
 *
 *  - **The speed readout** (bottom left of the square the recorder crops to, so exports have it): the fastest ball's
 *    speed in px/s, shown short (12.3K, 4.5M, 1e21) while a Bounciness grows the rebounds or any value is past its
 *    slider – the number the owner wants to watch climb "so fast it can break the web app".
 *  - **NUMBERS OVERFLOWED ×n**: a ball's numbers ran past the float range (±1.8e308) and it was put back at the centre –
 *    the run did break, and says so.
 *  - `data-uncap-*` attributes mirror them for tools and the smoke test: `uncapSpeed` (px/s, the fastest ball),
 *    `uncapBounce` (the Bounciness rebound multiplier), `uncapRescued` (overflowed balls put back).
 */
import type { Ball } from "@/lib/physics/types";
import { formatCompact } from "@/lib/uncap";

export interface UncapLabels {
  /** "⚡ {speed} px/s": the fastest ball. */
  speed: (speed: string) => string;
  /** "NUMBERS OVERFLOWED ×{count}". */
  overflow: (count: string) => string;
}

export const DEFAULT_UNCAP_LABELS: UncapLabels = {
  speed: (speed) => `⚡ ${speed} PX/S`,
  overflow: (count) => `NUMBERS OVERFLOWED ×${count}`,
};

/** What the canvas reads of a run for the readouts. */
export interface UncapInfo {
  /** The fastest ball (px/s). */
  speed: number;
  /** The Bounciness rebound multiplier (1 = none). */
  bounce: number;
  /** Balls put back after their numbers overflowed. */
  rescued: number;
  /** Whether the readouts show (a Bounciness is on or any value is past its slider). */
  show: boolean;
}

/**
 * Rings drawn at most per frame: past it every k-th ring is drawn (and the outermost) – thousands of rings packed tighter
 * than a pixel look the same, and the frame stays cheap. A render cap, not a simulation cap: the engine keeps them all.
 */
export const RING_DRAW_LIMIT = 1_500;

/** The stride of the ring pass: 1 up to `RING_DRAW_LIMIT` rings, then every k-th. */
export function ringDrawStride(rings: number): number {
  return rings > RING_DRAW_LIMIT ? Math.ceil(rings / RING_DRAW_LIMIT) : 1;
}

/** The fastest of the balls (px/s); 0 without balls. Allocation-free. */
export function fastestSpeed(balls: readonly Pick<Ball, "vx" | "vy">[]): number {
  let best = 0;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    const v = Math.hypot(b.vx, b.vy);
    if (v > best) best = v;
  }
  return best;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
}

/** The readouts, bottom left of the square (`x0`, `y0`, `side`); `bottomInset` lifts them above the live page's buttons. */
export function drawUncapHud(ctx: CanvasRenderingContext2D, info: UncapInfo, labels: UncapLabels, x0: number, y0: number, side: number, bottomInset = 0) {
  if (!info.show) return;
  const badges: { text: string; color: string }[] = [];
  if (info.rescued > 0) badges.push({ text: labels.overflow(formatCompact(info.rescued)), color: "#f43f5e" });
  badges.push({ text: labels.speed(formatCompact(Math.round(info.speed))), color: "#22d3ee" });
  ctx.save();
  const fs = Math.max(11, 0.032 * side);
  const pad = 0.025 * side;
  const h = 1.6 * fs;
  const gap = 0.4 * fs;
  ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let y = y0 + side - pad - h - bottomInset;
  for (const badge of badges) {
    const w = ctx.measureText(badge.text).width + 1.2 * fs;
    const x = x0 + pad;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(8, 8, 10, 0.72)";
    pill(ctx, x, y, w, h);
    ctx.fill();
    ctx.strokeStyle = badge.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = badge.color;
    ctx.fillText(badge.text, x + 0.6 * fs, y + h / 2);
    y -= h + gap;
  }
  ctx.restore();
}

/** Mirrors the readouts into `data-uncap-*` attributes (written every frame through the canvas' change-only setter). */
export function writeUncapDataset(info: UncapInfo, set: (key: string, value: string) => void) {
  set("uncapSpeed", Number.isFinite(info.speed) ? String(Math.round(info.speed)) : String(info.speed));
  set("uncapBounce", String(Math.round(info.bounce * 1000) / 1000));
  set("uncapRescued", String(info.rescued));
  set("uncapShow", info.show ? "1" : "0");
}
