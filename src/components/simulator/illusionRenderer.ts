import type { Ball } from "@/lib/physics/types";
import { linePhase, rollingCircleCentre, type IllusionView } from "@/lib/physics/modes/illusion";
import type { IllusionPattern } from "@/lib/physics/illusionPatterns";
import type { WobbleLayer } from "./wobbleRenderer";

/**
 * Canvas drawing of the Circle Illusion mode (feature jdm-illusions; lib/physics/modes/illusion.ts): the stage of each
 * type under the bodies – the big circle with the diameters and the hidden rolling circle (lines), the ring walls,
 * bands and rails (rings), the fixed arena and the moving hollow circles (nested), the white arena with the paint of the
 * balls stroked into an offscreen layer and the picture's reveal (whitespace) – then the bodies (balls with their note
 * flash, the innermost nested circle, the painters) and, in screen space, the alignment / reveal flash and the paint
 * counter. Every circle a ball can hit is traced through the `WobbleLayer`, so it wobbles where it was hit. Called from
 * Canvas.tsx inside the camera transform (stage, bodies) and outside it (overlay). Positions come from the mode's view;
 * the paint layer is only ever extended (new path points since the last frame), never redrawn, except after a restart
 * or a canvas resize.
 */

export interface IllusionRenderOptions {
  /** The canvas' wall colour function (rainbow walls apply), with an optional alpha. */
  wallColor: (index: number, alpha?: number) => string;
  /** Rainbow walls are on: the ring walls take the colours of their rings. */
  rainbow: boolean;
  wallThickness: number;
  showGlow: boolean;
  showTrails: boolean;
  trailThickness: number;
  /** Device pixel ratio of the canvas (the paint layer is kept in device pixels). */
  dpr: number;
  /** Simulation time of the frame (ms): the flashes and the reveal are timed by it, so a pause freezes them. */
  nowMs: number;
}

/** Translated words of the overlay. */
export interface IllusionLabels {
  revealed: string;
  painted: (pct: number) => string;
}

const TWO_PI = Math.PI * 2;
/** How long a ball stays brightened after its note (simulation ms). */
export const NOTE_FLASH_MS = 220;
/** How long the screen flash of a ring alignment lasts (simulation ms). */
export const ALIGN_FLASH_MS = 520;
/** Length of the whitespace reveal: the last white specks fade, the picture lights up (simulation ms). */
export const REVEAL_MS = 1400;
/** The white the arena starts as. */
const PAPER = "#f4f4f5";

/** Simulation ms since the step count `step` was reached (Infinity for −1). */
export function stepAgeMs(view: IllusionView, step: number, nowMs: number): number {
  if (step < 0) return Infinity;
  return nowMs - step * (view.stepMs > 0 ? view.stepMs : 1000 / 60);
}

/** 1 right after body i's note, fading to 0 over `NOTE_FLASH_MS`. */
export function noteFlash(view: IllusionView, i: number, nowMs: number): number {
  const age = stepAgeMs(view, view.lastHitStep[i], nowMs);
  return age >= 0 && age < NOTE_FLASH_MS ? 1 - age / NOTE_FLASH_MS : 0;
}

/** Progress (0–1) of the whitespace reveal at `nowMs`; 0 before it. */
export function revealProgress(view: IllusionView, nowMs: number): number {
  if (view.revealAtMs < 0) return 0;
  return Math.max(0, Math.min(1, (nowMs - view.revealAtMs) / REVEAL_MS));
}

interface PaintLayer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: number;
  generation: number;
  pathVersion: number;
  radius: number;
  dpr: number;
  /** Floats of each painter's path already stroked into the layer. */
  stamped: Int32Array;
}

/** Adds the white-space shapes of `pattern` (discs, closed outlines, thick strokes) to the current path / draws them. */
function fillPattern(ctx: CanvasRenderingContext2D, pattern: IllusionPattern, style: string) {
  ctx.fillStyle = style;
  ctx.strokeStyle = style;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const d of pattern.discs) {
    ctx.moveTo(d.x + d.r, d.y);
    ctx.arc(d.x, d.y, d.r, 0, TWO_PI);
  }
  for (const p of pattern.polygons) {
    ctx.moveTo(p.points[0], p.points[1]);
    for (let i = 2; i < p.points.length; i += 2) ctx.lineTo(p.points[i], p.points[i + 1]);
    ctx.closePath();
  }
  ctx.fill();
  for (const p of pattern.polygons) {
    ctx.lineWidth = p.thickness;
    ctx.beginPath();
    ctx.moveTo(p.points[0], p.points[1]);
    for (let i = 2; i < p.points.length; i += 2) ctx.lineTo(p.points[i], p.points[i + 1]);
    ctx.closePath();
    ctx.stroke();
  }
  for (const s of pattern.strokes) {
    ctx.lineWidth = s.thickness;
    ctx.beginPath();
    ctx.moveTo(s.points[0], s.points[1]);
    for (let i = 2; i < s.points.length; i += 2) ctx.lineTo(s.points[i], s.points[i + 1]);
    ctx.stroke();
  }
}

/** One per draw loop: the whitespace paint layer and the scratch lists live here. */
export class IllusionLayer {
  private paint: PaintLayer | null = null;
  private readonly faceList: Ball[] = [];
  private readonly point = { x: 0, y: 0 };

  /** Under the bodies: the circles, rings, tracks, reveal lines and the paint of the type. */
  drawStage(ctx: CanvasRenderingContext2D, view: IllusionView, o: IllusionRenderOptions, wobble: WobbleLayer) {
    if (view.count === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (view.type === "lines") this.stageLines(ctx, view, o, wobble);
    else if (view.type === "rings") this.stageRings(ctx, view, o, wobble);
    else if (view.type === "nested") this.stageNested(ctx, view, o, wobble);
    else this.stageWhitespace(ctx, view, o, wobble);
    ctx.restore();
  }

  /** The bodies: balls with their note flash (lines, rings), the innermost circle (nested), the painters (whitespace). */
  drawBodies(ctx: CanvasRenderingContext2D, balls: readonly Ball[], view: IllusionView, o: IllusionRenderOptions, wobble: WobbleLayer) {
    if (view.count === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (view.type === "nested") {
      const i = view.count - 1;
      if (o.showTrails && balls[i]) this.trail(ctx, balls[i], view.colors[i], view.r[i], o);
      this.body(ctx, view, i, o, wobble, i + 1);
    } else {
      const fade = view.type === "whitespace" ? 1 - revealProgress(view, o.nowMs) : 1;
      if (fade > 0.01) {
        ctx.globalAlpha = fade;
        // (A lines ball's trail would only retrace its diameter: the rings' zig-zags are worth a tail.)
        if (o.showTrails && view.type === "rings") for (let i = 0; i < view.count && i < balls.length; i++) this.trail(ctx, balls[i], view.colors[i], view.r[i], o);
        for (let i = 0; i < view.count; i++) this.body(ctx, view, i, o, null, -1);
      }
    }
    ctx.restore();
  }

  /** Screen space: the flash of a ring alignment and of the whitespace reveal, the paint counter and "REVEALED!". */
  drawOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, view: IllusionView, nowMs: number, labels: IllusionLabels) {
    if (view.count === 0) return;
    let flash = 0;
    if (view.type === "rings") {
      const age = stepAgeMs(view, view.lastAlignStep, nowMs);
      if (age >= 0 && age < ALIGN_FLASH_MS) flash = 0.22 * (1 - age / ALIGN_FLASH_MS);
    } else if (view.type === "whitespace" && view.revealAtMs >= 0) {
      const age = nowMs - view.revealAtMs;
      if (age >= 0 && age < ALIGN_FLASH_MS) flash = 0.28 * (1 - age / ALIGN_FLASH_MS);
    }
    if (flash > 0.005) {
      ctx.save();
      ctx.globalAlpha = flash;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    if (view.type !== "whitespace") return;
    const f = view.field;
    const fs = Math.max(13, 0.034 * f.side);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (view.revealAtMs < 0) {
      // The paint counter at the bottom of the square, clear of the picture in the middle.
      const text = labels.painted(Math.min(99, Math.floor(100 * view.coverage)));
      ctx.font = `bold ${fs}px sans-serif`;
      const w = ctx.measureText(text).width + 1.2 * fs;
      const h = 1.5 * fs;
      // Inside the arena near the bottom, clear of the picture (every picture stays within 0.62 of the radius).
      const y = view.cy + 0.84 * view.radius;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#000000";
      roundRect(ctx, f.cx - w / 2, y - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, f.cx, y);
    } else {
      const p = Math.min(1, (nowMs - view.revealAtMs) / 400);
      const big = 1.6 * fs * (0.8 + 0.2 * p);
      ctx.globalAlpha = Math.max(0, p);
      ctx.font = `900 ${big}px sans-serif`;
      ctx.lineWidth = Math.max(3, 0.12 * big);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
      const y = view.cy - 0.82 * view.radius;
      ctx.strokeText(labels.revealed, f.cx, y);
      ctx.fillStyle = "#a3e635";
      ctx.shadowColor = "#a3e635";
      ctx.shadowBlur = 18;
      ctx.fillText(labels.revealed, f.cx, y);
    }
    ctx.restore();
  }

  /** The balls the ball characters are drawn on: the innermost circle of the nested type, every ball otherwise (a reused list). */
  faceBalls(balls: readonly Ball[], view: IllusionView): readonly Ball[] {
    if (view.type !== "nested") return balls;
    this.faceList.length = 0;
    const inner = balls[view.count - 1];
    if (inner) this.faceList.push(inner);
    return this.faceList;
  }

  /* ------------------------------------------------------------ the types */

  private rim(ctx: CanvasRenderingContext2D, view: IllusionView, o: IllusionRenderOptions, wobble: WobbleLayer, index: number, x: number, y: number, r: number, color: string, width: number) {
    if (o.showGlow) {
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * 4;
      ctx.beginPath();
      wobble.traceCircle(ctx, index, x, y, r);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    wobble.traceCircle(ctx, index, x, y, r);
    ctx.stroke();
  }

  private stageLines(ctx: CanvasRenderingContext2D, view: IllusionView, o: IllusionRenderOptions, wobble: WobbleLayer) {
    const n = view.count;
    const A = view.amplitude;
    // A faint disc so the illusion reads as "inside the circle".
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = o.wallColor(0);
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.radius, 0, TWO_PI);
    ctx.fill();
    if (view.settings.tracks) {
      ctx.lineWidth = Math.max(1, 0.4 * o.wallThickness + 0.8);
      for (let i = 0; i < n; i++) {
        const a = linePhase(i, n) + view.rotation;
        const dx = A * Math.cos(a);
        const dy = A * Math.sin(a);
        ctx.globalAlpha = 0.22 + 0.3 * noteFlash(view, i, o.nowMs);
        ctx.strokeStyle = view.colors[i];
        ctx.beginPath();
        ctx.moveTo(view.cx - dx, view.cy - dy);
        ctx.lineTo(view.cx + dx, view.cy + dy);
        ctx.stroke();
      }
    }
    this.rim(ctx, view, o, wobble, 0, view.cx, view.cy, view.radius, o.wallColor(0), Math.max(2, o.wallThickness + 1));
    if (view.settings.reveal) {
      // The hidden circle: radius A/2, rolling inside the big one; its centre and the spoke to it show the roll.
      rollingCircleCentre(view.theta, A, view.rotation, this.point);
      const x = view.cx + this.point.x;
      const y = view.cy + this.point.y;
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      ctx.arc(x, y, A / 2, 0, TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(view.cx, view.cy);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, 0.012 * view.radius), 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private stageRings(ctx: CanvasRenderingContext2D, view: IllusionView, o: IllusionRenderOptions, wobble: WobbleLayer) {
    const K = view.count;
    const b = view.boundaries;
    // Bands in the ring colours, brightened on a note.
    for (let k = 0; k < K; k++) {
      const flash = noteFlash(view, k, o.nowMs);
      ctx.globalAlpha = 0.07 + 0.12 * flash;
      ctx.strokeStyle = view.colors[k];
      ctx.lineWidth = 0.96 * (b[k + 1] - b[k]);
      ctx.beginPath();
      ctx.arc(view.cx, view.cy, (b[k] + b[k + 1]) / 2, 0, TWO_PI);
      ctx.stroke();
    }
    const width = Math.max(1, o.wallThickness);
    // With rainbow walls every wall takes the colour of the ring outside it (the outermost the last ring's).
    for (let j = 0; j <= K; j++) this.rim(ctx, view, o, wobble, j, view.cx, view.cy, b[j], o.rainbow ? view.colors[Math.min(j, K - 1)] : o.wallColor(j), width);
    if (view.settings.tracks) {
      ctx.lineWidth = Math.max(2, 0.6 * width + 1);
      for (let k = 0; k < K; k++) {
        const a = view.ringAngle[k];
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = view.colors[k];
        ctx.beginPath();
        ctx.moveTo(view.cx + b[k] * Math.cos(a), view.cy + b[k] * Math.sin(a));
        ctx.lineTo(view.cx + b[k + 1] * Math.cos(a), view.cy + b[k + 1] * Math.sin(a));
        ctx.stroke();
      }
    }
    if (view.settings.reveal) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < K; k++) {
        if (k === 0) ctx.moveTo(view.x[k], view.y[k]);
        else ctx.lineTo(view.x[k], view.y[k]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private stageNested(ctx: CanvasRenderingContext2D, view: IllusionView, o: IllusionRenderOptions, wobble: WobbleLayer) {
    const width = Math.max(2, o.wallThickness + 1);
    this.rim(ctx, view, o, wobble, 0, view.layerX[0], view.layerY[0], view.layerR[0], o.wallColor(0), width);
    // The hollow circles in between (the innermost is drawn with the bodies).
    for (let i = 1; i < view.layerCount - 1; i++) {
      const body = i - 1;
      const flash = noteFlash(view, body, o.nowMs);
      ctx.globalAlpha = 0.07 + 0.08 * flash;
      ctx.fillStyle = view.colors[body];
      ctx.beginPath();
      wobble.traceCircle(ctx, i, view.layerX[i], view.layerY[i], view.layerR[i]);
      ctx.fill();
      this.rim(ctx, view, o, wobble, i, view.layerX[i], view.layerY[i], view.layerR[i], view.colors[body], width * (1 + 0.6 * flash));
    }
    ctx.globalAlpha = 1;
  }

  private stageWhitespace(ctx: CanvasRenderingContext2D, view: IllusionView, o: IllusionRenderOptions, wobble: WobbleLayer) {
    const layer = this.ensurePaint(view, o.dpr);
    const R = view.radius;
    const p = revealProgress(view, o.nowMs);
    if (layer) {
      this.stampPaths(layer, view);
      // The white that is left (the picture, and any speck the balls missed – it fades away during the reveal).
      ctx.globalAlpha = 1 - p;
      if (ctx.globalAlpha > 0.004) ctx.drawImage(layer.canvas, view.cx - R - 1, view.cy - R - 1, layer.size / layer.dpr, layer.size / layer.dpr);
    }
    const pattern = view.pattern;
    if (pattern && p > 0) {
      // The reveal: the picture stays white while the specks fade, then glows in the accent colour.
      ctx.globalAlpha = p;
      fillPattern(ctx, pattern, PAPER);
      const pulse = 0.5 + 0.5 * Math.sin((o.nowMs - view.revealAtMs) / 180);
      ctx.globalAlpha = p * (0.35 + 0.25 * pulse);
      ctx.shadowColor = "#a3e635";
      ctx.shadowBlur = 24;
      fillPattern(ctx, pattern, "#a3e635");
      ctx.shadowBlur = 0;
    }
    this.rim(ctx, view, o, wobble, 0, view.cx, view.cy, R, o.wallColor(0), Math.max(2, o.wallThickness + 1));
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------ the paint layer */

  /** The paint layer for the current run and size: a white disc in device pixels, rebuilt after a restart, a resize or a new dpr. */
  private ensurePaint(view: IllusionView, dpr: number): PaintLayer | null {
    const R = view.radius;
    const size = Math.max(4, Math.ceil((2 * R + 2) * dpr));
    let layer = this.paint;
    if (!layer || layer.size !== size || layer.dpr !== dpr) {
      if (typeof document === "undefined") return null;
      const canvas = layer?.canvas ?? document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const c = canvas.getContext("2d");
      if (!c) return null;
      layer = { canvas, ctx: c, size, generation: -1, pathVersion: -1, radius: R, dpr, stamped: new Int32Array(0) };
      this.paint = layer;
    }
    if (layer.generation !== view.generation || layer.pathVersion !== view.pathVersion || layer.radius !== R) {
      const c = layer.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "source-over";
      c.clearRect(0, 0, size, size);
      c.fillStyle = PAPER;
      c.beginPath();
      c.arc(size / 2, size / 2, R * dpr, 0, TWO_PI);
      c.fill();
      layer.generation = view.generation;
      layer.pathVersion = view.pathVersion;
      layer.radius = R;
      layer.stamped = new Int32Array(view.count).fill(-1);
    }
    return layer;
  }

  /** Strokes every painter's path points added since the last frame out of the white (one path per painter, round joins). */
  private stampPaths(layer: PaintLayer, view: IllusionView) {
    const c = layer.ctx;
    const ox = view.cx - view.radius - 1;
    const oy = view.cy - view.radius - 1;
    const s = layer.dpr;
    c.globalCompositeOperation = "destination-out";
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = 2 * view.painterRadius * s;
    c.strokeStyle = "#000000";
    c.fillStyle = "#000000";
    for (let j = 0; j < view.count && j < view.paths.length; j++) {
      const path = view.paths[j];
      const len = view.pathLen[j];
      if (len < 2) continue;
      // `stamped` is the float index of the last point already stroked (−1: none yet).
      let from = layer.stamped[j];
      if (from < 0) {
        // The first point: a dab where the painter started.
        c.beginPath();
        c.arc((path[0] - ox) * s, (path[1] - oy) * s, view.painterRadius * s, 0, TWO_PI);
        c.fill();
        from = 0;
      }
      if (len - 2 > from) {
        c.beginPath();
        c.moveTo((path[from] - ox) * s, (path[from + 1] - oy) * s);
        for (let p = from + 2; p < len; p += 2) c.lineTo((path[p] - ox) * s, (path[p + 1] - oy) * s);
        c.stroke();
      }
      // Keep the last point: the next frame's stroke starts from it.
      layer.stamped[j] = len - 2;
    }
    c.globalCompositeOperation = "source-over";
  }

  /* ------------------------------------------------------------ bodies */

  private trail(ctx: CanvasRenderingContext2D, ball: Ball, color: string, radius: number, o: IllusionRenderOptions) {
    const len = ball.trail.length;
    if (len < 2) return;
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * 0.3;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, radius * o.trailThickness * 0.8);
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const pt = ball.trail[(ball.trailIndex + i) % len];
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  /** Body i: glow, disc (wobbling when `wall` ≥ 0 – the innermost nested circle), highlight and the note flash ring. */
  private body(ctx: CanvasRenderingContext2D, view: IllusionView, i: number, o: IllusionRenderOptions, wobble: WobbleLayer | null, wall: number) {
    const x = view.x[i];
    const y = view.y[i];
    const r = view.r[i];
    const color = view.colors[i];
    const flash = noteFlash(view, i, o.nowMs);
    const alpha = ctx.globalAlpha;
    if (o.showGlow || flash > 0) {
      const glow = ctx.createRadialGradient(x, y, 0.5 * r, x, y, r * (2 + flash));
      glow.addColorStop(0, color);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalAlpha = alpha * (o.showGlow ? 0.35 + 0.4 * flash : 0.45 * flash);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * (2 + flash), 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (wobble && wall >= 0) wobble.traceCircle(ctx, wall, x, y, r);
    else ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
    const hl = ctx.createRadialGradient(x - 0.3 * r, y - 0.3 * r, 0, x - 0.3 * r, y - 0.3 * r, r);
    hl.addColorStop(0, "rgba(255, 255, 255, 0.5)");
    hl.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
    hl.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = hl;
    ctx.fill();
    if (flash > 0.02) {
      ctx.globalAlpha = alpha * 0.85 * flash;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1.5, 0.18 * r);
      ctx.beginPath();
      ctx.arc(x, y, r * (1.15 + 0.35 * (1 - flash)), 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
