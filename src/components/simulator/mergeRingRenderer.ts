import { FINAL_HOLD_MS, TIER_EMBLEMS, inChute, tierColor, tierEmblem, type MergeRingView, type TierEmblem } from "@/lib/physics/modes/mergeRing";
import type { Ball } from "@/lib/physics/types";

/**
 * Canvas drawing of Merge Ring (feature merge-ring, lib/physics/modes/mergeRing.ts). The canvas calls, per frame:
 * `drawWorld()` under the balls (the ring's rim: a thin rainbow stroke whose hues turn slowly, open where the chute meets
 * it, flashing white at the final form; the chute walls are the engine's obstacles, drawn by the generic pass),
 * `drawBodies()` over the balls the canvas drew (a dark body with a thin rim and a bright emblem in the tier's colour –
 * the emblems are original vector marks, `drawEmblem()`; the final form pulses), `drawEffects()` over them (the halos
 * expanding out of every merge) and `drawOverlay()` in screen space (the tier ladder along the right side with the
 * reached tiers lit, the caption under the ring, the merge counter and the top tier). Everything animates on the mode's
 * clock (`view.timeMs`), so a pause freezes it and a recording replays it; nothing is allocated per frame (strings cached).
 */

export interface MergeRingRenderOptions {
  /** The wall colour with an alpha (the rim without the rainbow). */
  wallAlpha: (alpha: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
  /** Paint the dark bodies over the canvas' balls (off while a face, an emoji or an image wears the ball). */
  darkBodies: boolean;
}

export interface MergeRingLabels {
  /** The HUD's title. */
  title: string;
  /** The caption under the ring. */
  caption: string;
  /** "MERGES 7" */
  merges: (n: number) => string;
  /** The top tier's caption. */
  top: string;
  /** The tier's name (1 … 10). */
  tier: (k: number) => string;
  /** The end banners. */
  finalTitle: string;
  finalSub: (merges: number, seconds: string) => string;
  overflowTitle: string;
  overflowSub: (top: string, merges: number) => string;
}

export const DEFAULT_MERGE_RING_LABELS: MergeRingLabels = {
  title: "MERGE RING",
  caption: "Will it merge into its final form?",
  merges: (n) => `MERGES ${n}`,
  top: "TOP",
  tier: (k) => TIER_NAMES[Math.max(0, Math.min(TIER_NAMES.length - 1, k - 1))],
  finalTitle: "FINAL FORM",
  finalSub: (merges, seconds) => `${merges} merges in ${seconds}s`,
  overflowTitle: "OVERFLOW",
  overflowSub: (top, merges) => `Top tier ${top} after ${merges} merges`,
};

/** The English tier names (the page's labels translate them). */
export const TIER_NAMES = ["Dot", "Ring", "Triangle", "Diamond", "Star", "Hexagon", "Crown", "Gem", "Sun", "Infinity"] as const;

/** Degrees the rainbow turns per second, how long a halo shows and how far it grows (× the pair's radius), the rim's flash and the pulse. */
export const RAINBOW_DEG_PER_SEC = 24;
export const HALO_MS = 700;
export const HALO_GROWTH = 2.4;
export const FLASH_MS = 700;
export const PULSE_MS = 900;
export const RIM_SEGMENTS = 90;
const TWO_PI = Math.PI * 2;

/** The hue (degrees) of the rim at `angle` (radians) at time `timeMs`: the colours run once around and turn slowly. */
export function rimHue(angle: number, timeMs: number): number {
  const deg = (angle / TWO_PI) * 360 + (timeMs / 1000) * RAINBOW_DEG_PER_SEC;
  return ((deg % 360) + 360) % 360;
}

/** A halo `ageMs` after its merge: its radius as a multiple of the pair's radius and its alpha; null once it is gone. */
export function haloAt(ageMs: number): { scale: number; alpha: number } | null {
  if (!(ageMs >= 0) || ageMs >= HALO_MS) return null;
  const u = ageMs / HALO_MS;
  const ease = 1 - (1 - u) * (1 - u);
  return { scale: 1 + (HALO_GROWTH - 1) * ease, alpha: 0.9 * (1 - u) };
}

/** The final form's pulse `ageMs` after it appeared: the body's scale (1 at rest). */
export function pulseScale(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= FINAL_HOLD_MS) return 1;
  return 1 + 0.08 * Math.abs(Math.sin((ageMs / PULSE_MS) * Math.PI));
}

/** The points of a regular polygon (or a star, with `inner` < 1) of `n` points and radius `r`, the first point straight up. */
export function polygonPoints(n: number, r: number, inner = 1): number[] {
  const out: number[] = [];
  const steps = inner < 1 ? 2 * n : n;
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI / 2 + (i * TWO_PI) / steps;
    const k = inner < 1 && i % 2 === 1 ? inner : 1;
    out.push(k * r * Math.cos(a), k * r * Math.sin(a));
  }
  return out;
}

function path(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(pts[0], pts[1]);
    else ctx.lineTo(pts[i], pts[i + 1]);
  }
  ctx.closePath();
}

/** Draws the emblem `kind` centred on (x, y), `size` px across (its half-size is the mark's reach), in `color`. */
export function drawEmblem(ctx: CanvasRenderingContext2D, kind: TierEmblem, x: number, y: number, size: number, color: string) {
  const r = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, 0.18 * r);
  switch (kind) {
    case "dot":
      ctx.beginPath();
      ctx.arc(0, 0, 0.55 * r, 0, TWO_PI);
      ctx.fill();
      break;
    case "ring":
      ctx.lineWidth = Math.max(1.2, 0.3 * r);
      ctx.beginPath();
      ctx.arc(0, 0, 0.7 * r, 0, TWO_PI);
      ctx.stroke();
      break;
    case "triangle":
      path(ctx, polygonPoints(3, r));
      ctx.fill();
      break;
    case "diamond": {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0.7 * r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-0.7 * r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = Math.max(1, 0.08 * r);
      ctx.beginPath();
      ctx.moveTo(-0.7 * r, 0);
      ctx.lineTo(0.7 * r, 0);
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.stroke();
      break;
    }
    case "star":
      path(ctx, polygonPoints(5, r, 0.45));
      ctx.fill();
      break;
    case "hexagon":
      path(ctx, polygonPoints(6, r));
      ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      path(ctx, polygonPoints(6, 0.45 * r));
      ctx.fill();
      break;
    case "crown": {
      ctx.beginPath();
      ctx.moveTo(-r, 0.7 * r);
      ctx.lineTo(-r, -0.5 * r);
      ctx.lineTo(-0.5 * r, 0.1 * r);
      ctx.lineTo(0, -r);
      ctx.lineTo(0.5 * r, 0.1 * r);
      ctx.lineTo(r, -0.5 * r);
      ctx.lineTo(r, 0.7 * r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.beginPath();
      ctx.arc(0, 0.35 * r, 0.14 * r, 0, TWO_PI);
      ctx.fill();
      break;
    }
    case "gem": {
      // A cut stone: a flat top, a wide girdle and a point.
      ctx.beginPath();
      ctx.moveTo(-0.55 * r, -0.8 * r);
      ctx.lineTo(0.55 * r, -0.8 * r);
      ctx.lineTo(r, -0.2 * r);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, -0.2 * r);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = Math.max(1, 0.08 * r);
      ctx.beginPath();
      ctx.moveTo(-r, -0.2 * r);
      ctx.lineTo(r, -0.2 * r);
      ctx.moveTo(-0.55 * r, -0.8 * r);
      ctx.lineTo(-0.35 * r, -0.2 * r);
      ctx.lineTo(0, r);
      ctx.moveTo(0.55 * r, -0.8 * r);
      ctx.lineTo(0.35 * r, -0.2 * r);
      ctx.lineTo(0, r);
      ctx.stroke();
      break;
    }
    case "sun": {
      ctx.beginPath();
      ctx.arc(0, 0, 0.42 * r, 0, TWO_PI);
      ctx.fill();
      ctx.lineWidth = Math.max(1, 0.14 * r);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * TWO_PI) / 8;
        ctx.moveTo(0.62 * r * Math.cos(a), 0.62 * r * Math.sin(a));
        ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
      }
      ctx.stroke();
      break;
    }
    case "infinity": {
      // A lemniscate: two loops joined in the middle.
      ctx.lineWidth = Math.max(1.2, 0.22 * r);
      ctx.beginPath();
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * TWO_PI;
        const d = 1 + Math.sin(t) * Math.sin(t);
        const px = (r * Math.cos(t)) / d;
        const py = (0.6 * r * Math.sin(t) * Math.cos(t)) / d;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

export class MergeRingLayer {
  /** "MERGES 7" by count, so a frame builds none. */
  private mergesKey = -1;
  private mergesText = "";
  private topKey = -1;
  private topText = "";
  private readonly tierText: string[] = [];

  /** The rim (under the balls): the rainbow (or the wall colour), open at the chute, flashing white at the final form. */
  drawWorld(ctx: CanvasRenderingContext2D, view: MergeRingView, opts: MergeRingRenderOptions) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    const R = L.radius;
    // The opening: the arc between the chute walls (around straight up).
    const half = Math.asin(Math.min(1, L.chuteHalf / R));
    const start = -Math.PI / 2 + half;
    const end = -Math.PI / 2 - half + TWO_PI;
    const width = Math.max(1.5, opts.wallThickness);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    ctx.lineWidth = width;
    if (opts.showWallGlow) {
      ctx.shadowBlur = 3 * width + 6;
    }
    if (view.settings.rainbow) {
      const step = (end - start) / RIM_SEGMENTS;
      for (let i = 0; i < RIM_SEGMENTS; i++) {
        const a0 = start + i * step;
        const a1 = a0 + step;
        const color = `hsl(${rimHue(a0 + step / 2, now).toFixed(1)}, 100%, 62%)`;
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.beginPath();
        ctx.arc(L.cx, L.cy, R, a0 - 0.004, a1 + 0.004);
        ctx.stroke();
      }
    } else {
      const color = opts.wallAlpha(0.9);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, R, start, end);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // The final form: the rim flashes white and fades back.
    const fAge = now - view.finalMs;
    if (view.finalMs >= 0 && fAge >= 0 && fAge < FLASH_MS) {
      const f = 1 - fAge / FLASH_MS;
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.95 * f).toFixed(3)})`;
      ctx.lineWidth = width + 6 * f;
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = opts.showWallGlow ? 24 * f : 0;
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, R, start, end);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  /** Over the balls the canvas drew: the dark bodies, their rims and their emblems (the final form pulsing). */
  drawBodies(ctx: CanvasRenderingContext2D, view: MergeRingView, balls: readonly Ball[], opts: MergeRingRenderOptions) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    ctx.save();
    ctx.globalAlpha = 1;
    for (const ball of balls) {
      const tier = view.tierOf.get(ball.id);
      if (tier === undefined) continue;
      const color = tierColor(tier);
      const pulse = ball.id === view.finalId ? pulseScale(now - view.finalMs) : 1;
      const r = ball.radius * pulse;
      if (opts.darkBodies) {
        ctx.fillStyle = "#0b0b10";
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, Math.max(0.5, r - 0.5), 0, TWO_PI);
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, 0.09 * r);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, Math.max(0.5, r - 0.6 * ctx.lineWidth), 0, TWO_PI);
      ctx.stroke();
      if (opts.darkBodies) drawEmblem(ctx, tierEmblem(tier), ball.x, ball.y, 1.1 * r, color);
      else drawEmblem(ctx, tierEmblem(tier), ball.x, ball.y - 0.35 * r, 0.6 * r, "#ffffff");
    }
    ctx.restore();
  }

  /** Over the balls: the halos of the merges. */
  drawEffects(ctx: CanvasRenderingContext2D, view: MergeRingView) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    ctx.save();
    ctx.lineWidth = Math.max(1.5, 0.004 * L.side);
    for (let i = 0; i < view.haloMs.length; i++) {
      const h = haloAt(now - view.haloMs[i]);
      if (!h) continue;
      const color = tierColor(view.haloTier[i]);
      ctx.globalAlpha = h.alpha;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(view.haloX[i], view.haloY[i], view.haloR[i] * h.scale, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Screen space: the title and the merge counter in the top-left corner of the square, the top tier in the top-right one,
   * the tier ladder along the right side of the ring and the caption under it; `inset` moves the corners below the page's buttons.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: MergeRingView, labels: MergeRingLabels, inset = 0) {
    const L = view.layout;
    if (!L) return;
    const side = L.side;
    const fs = Math.max(11, 0.03 * side);
    const top = L.top + 0.02 * side + inset;
    const pad = 0.04 * side;
    const right = L.left + side;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    // The corners.
    ctx.textAlign = "left";
    ctx.font = `800 ${(0.8 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillText(labels.title, L.left + pad, top + 0.5 * fs);
    if (view.merges !== this.mergesKey) {
      this.mergesKey = view.merges;
      this.mergesText = labels.merges(view.merges);
    }
    ctx.font = `700 ${(0.75 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "#f472b6";
    ctx.fillText(this.mergesText, L.left + pad, top + 1.6 * fs);
    ctx.textAlign = "right";
    ctx.font = `800 ${(0.7 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillText(labels.top, right - pad, top + 0.5 * fs);
    const topTier = Math.max(1, view.topTier);
    if (topTier !== this.topKey) {
      this.topKey = topTier;
      this.topText = labels.tier(topTier);
    }
    ctx.font = `900 ${(1.05 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = tierColor(topTier);
    ctx.fillText(this.topText, right - pad, top + 1.7 * fs);
    // The ladder: tier 1 at the bottom, the final form at the top, the reached ones lit.
    const tiers = Math.max(1, Math.min(TIER_EMBLEMS.length, view.settings.tiers));
    const size = Math.max(6, Math.min(0.032 * side, (1.6 * L.radius) / (tiers * 1.5)));
    const x = L.cx + L.radius + 0.5 * (right - (L.cx + L.radius));
    const y1 = L.cy + 0.8 * L.radius;
    const y0 = L.cy - 0.8 * L.radius;
    for (let k = 1; k <= tiers; k++) {
      const y = tiers > 1 ? y1 + ((y0 - y1) * (k - 1)) / (tiers - 1) : (y0 + y1) / 2;
      const lit = k <= view.topTier;
      ctx.globalAlpha = lit ? 1 : 0.28;
      const color = lit ? tierColor(k) : "#9ca3af";
      if (lit) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 0.95 * size, 0, TWO_PI);
      ctx.stroke();
      drawEmblem(ctx, tierEmblem(k), x, y, 1.1 * size, color);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    // The caption under the ring.
    const cfs = Math.max(11, 0.034 * side);
    ctx.textAlign = "center";
    ctx.font = `600 ${cfs.toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(labels.caption, L.cx, Math.min(L.top + side - 0.6 * cfs, L.cy + L.radius + 0.045 * side + 0.5 * cfs));
    ctx.restore();
  }

  /** The names of the tiers as the labels give them, cached. */
  tierName(labels: MergeRingLabels, k: number): string {
    return (this.tierText[k] ??= labels.tier(k));
  }
}

/** True when `ball` sits in the chute column above the ring's opening (the smoke test and the HUD read it from the view). */
export function ballInChute(view: MergeRingView, ball: Pick<Ball, "x" | "y">): boolean {
  return !!view.layout && inChute(view.layout, ball.x, ball.y) && ball.y < view.layout.openY;
}

/** The data-merge-* attributes the canvas mirrors for tools and the smoke test. */
export const MERGE_RING_DATA_KEYS = ["mergeTiers", "mergeSpawned", "mergeBalls", "mergeMerges", "mergeTop", "mergeNotes", "mergeThuds", "mergeFinal", "mergeOverflow", "mergeFinished", "mergeFinishedMs"];

/** Writes the view's state into the data-merge-* attributes (`set` only writes a changed value). */
export class MergeRingDataset {
  write(view: MergeRingView, set: (key: string, value: string) => void) {
    set("mergeTiers", String(view.settings.tiers));
    set("mergeSpawned", String(view.spawned));
    set("mergeBalls", String(view.balls));
    set("mergeMerges", String(view.merges));
    set("mergeTop", String(view.topTier));
    set("mergeNotes", String(view.notes));
    set("mergeThuds", String(view.thuds));
    set("mergeFinal", view.finalMs >= 0 ? "1" : "0");
    set("mergeOverflow", view.overflowMs >= 0 ? "1" : "0");
    set("mergeFinished", view.finished ? "1" : "0");
    set("mergeFinishedMs", String(Math.round(view.finishedMs)));
  }
}
