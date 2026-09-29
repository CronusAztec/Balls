import type { PendulumView } from "@/lib/physics/modes/pendulum";
import type { Ball } from "@/lib/physics/types";

/**
 * Canvas drawing of the Pendulum Wave mode (lib/physics/modes/pendulum.ts): the rig of the chosen layout (the
 * bar and pivots of the row, the pivot ring of the arc, the radial guides and the circle / polygon outline of
 * the radial layouts, the rails, the floor), the strings, the bobs in their rainbow colours with a flash on
 * every note, a fading trail layer the bobs paint into (the spiral arms of the galaxy live there) and the
 * screen flash of a big chord. Called from Canvas.tsx inside the camera transform (trails, rig, bobs) and
 * outside it (the flash); nothing is allocated per frame beyond the fill strings, so sixty bobs at 1080×1920
 * stay inside the frame budget.
 */

export interface PendulumRenderOptions {
  /** The canvas' wall colour function (rainbow walls apply), with an optional alpha. */
  wallColor: (index: number, alpha?: number) => string;
  wallThickness: number;
  showGlow: boolean;
}

const TWO_PI = Math.PI * 2;
/** How long a bob stays brightened after its note (simulation ms). */
export const NOTE_FLASH_MS = 220;
/** How long the screen flash of a big chord lasts (simulation ms). */
export const CHORD_FLASH_MS = 420;
/** Chords smaller than this do not flash the screen. */
export const CHORD_FLASH_MIN_NOTES = 3;

/** Simulation ms since sub-step `tick` (Infinity before the first event). */
export function ticksAgoMs(view: PendulumView, tick: number): number {
  return tick === -Infinity ? Infinity : (view.tick - tick) * view.tickMs;
}

/** Time constant (seconds) of the trail fade for a `trails` setting of 0–1: a third of a second at the default 0.3, three seconds at 1. */
export function trailTimeConstant(trails: number): number {
  return 0.12 + 3 * trails * trails;
}

/** The fraction of the trail layer to erase after `dtMs` of simulation time (frame-rate independent, nothing while paused). */
export function trailFade(dtMs: number, trails: number): number {
  if (!(dtMs > 0)) return 0;
  return 1 - Math.exp(-dtMs / 1000 / trailTimeConstant(trails));
}

/** An offscreen layer the bobs paint their trails into; faded every frame by the simulation time that passed. */
export interface PendulumTrailLayer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Size in CSS pixels (the layer itself is `dpr` times bigger). */
  width: number;
  height: number;
  /** The run the layer belongs to (`PendulumView.generation`) and the tick it was last updated at. */
  generation: number;
  lastTick: number;
  /** Where every bob was at the last update, so each frame adds a segment instead of a dot. */
  prevX: Float64Array;
  prevY: Float64Array;
  count: number;
}

export function createPendulumTrailLayer(width: number, height: number, dpr: number): PendulumTrailLayer | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx, width, height, generation: -1, lastTick: -1, prevX: new Float64Array(64), prevY: new Float64Array(64), count: 0 };
}

/**
 * Fades the layer by the simulation time since the last update and draws a segment from each bob's previous
 * position to its current one (round caps, so a resting bob leaves a dot). A new run (generation) clears it.
 */
export function updatePendulumTrailLayer(layer: PendulumTrailLayer, view: PendulumView, balls: Ball[]) {
  const g = layer.ctx;
  if (layer.generation !== view.generation) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    g.restore();
    layer.generation = view.generation;
    layer.lastTick = -1;
    layer.count = 0;
  }
  if (balls.length > layer.prevX.length) {
    layer.prevX = new Float64Array(balls.length + 16);
    layer.prevY = new Float64Array(balls.length + 16);
    layer.count = 0;
  }
  const dtMs = layer.lastTick < 0 ? 0 : (view.tick - layer.lastTick) * view.tickMs;
  if (dtMs <= 0 && layer.count === balls.length) return; // paused: nothing moved, nothing fades
  layer.lastTick = view.tick;
  const fade = trailFade(dtMs, view.settings.trails);
  if (fade > 0) {
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = `rgba(0, 0, 0, ${fade.toFixed(4)})`;
    g.fillRect(0, 0, layer.width, layer.height);
    g.globalCompositeOperation = "source-over";
  }
  g.lineCap = "round";
  g.lineJoin = "round";
  const width = Math.max(1, 0.7 * (view.rig?.bobRadius ?? 4));
  g.lineWidth = width;
  for (let i = 0; i < balls.length; i++) {
    const ball = balls[i];
    const st = view.byId.get(ball.id);
    if (!st) continue;
    const px = i < layer.count ? layer.prevX[i] : ball.x;
    const py = i < layer.count ? layer.prevY[i] : ball.y;
    g.strokeStyle = `hsla(${Math.round(st.hue)}, 90%, 60%, 0.8)`;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(ball.x, ball.y);
    g.stroke();
    layer.prevX[i] = ball.x;
    layer.prevY[i] = ball.y;
  }
  layer.count = balls.length;
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
}

/** The rig of the layout in the wall colour: bar and pivots, pivot ring, radial guides and outline, rails or floor. */
export function drawPendulumRig(ctx: CanvasRenderingContext2D, view: PendulumView, o: PendulumRenderOptions) {
  const rig = view.rig;
  const f = view.field;
  if (!rig || !f) return;
  const n = rig.anchorX.length;
  if (n === 0) return;
  const thick = Math.max(1.5, o.wallThickness);
  const r = rig.bobRadius;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (rig.layout) {
    case "row": {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = thick + 2;
      line(ctx, rig.anchorX[0] - 3 * r, rig.barY, rig.anchorX[n - 1] + 3 * r, rig.barY);
      ctx.fillStyle = o.wallColor(0);
      const pr = Math.max(1.5, 0.3 * r);
      for (let i = 0; i < n; i++) dot(ctx, rig.anchorX[i], rig.barY, pr);
      break;
    }
    case "arc": {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = thick;
      ctx.beginPath();
      ctx.arc(f.cx, f.cy, rig.ringRadius, 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = o.wallColor(0);
      const pr = Math.max(1.5, 0.3 * r);
      for (let i = 0; i < n; i++) dot(ctx, rig.anchorX[i], rig.anchorY[i], pr);
      break;
    }
    case "circle":
    case "galaxy": {
      const outer = rig.rho0 + rig.rhoAmp;
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const a = rig.direction[i] + view.frameAngle;
        line(ctx, f.cx, f.cy, f.cx + outer * Math.cos(a), f.cy + outer * Math.sin(a));
      }
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = thick;
      ctx.beginPath();
      const sides = view.settings.polygon;
      if (sides >= 3) {
        for (let k = 0; k <= sides; k++) {
          const a = view.polygonAngle + (TWO_PI * k) / sides;
          const x = f.cx + outer * Math.cos(a);
          const y = f.cy + outer * Math.sin(a);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else ctx.arc(f.cx, f.cy, outer, 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = o.wallColor(0);
      dot(ctx, f.cx, f.cy, Math.max(2, 0.4 * r));
      break;
    }
    case "sliding": {
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = Math.max(1, 0.6 * thick);
      const x0 = f.cx - rig.swingX - r;
      const x1 = f.cx + rig.swingX + r;
      for (let i = 0; i < n; i++) {
        const y = rig.anchorY[i];
        line(ctx, x0, y, x1, y);
        line(ctx, x0, y - 0.6 * r, x0, y + 0.6 * r);
        line(ctx, x1, y - 0.6 * r, x1, y + 0.6 * r);
      }
      break;
    }
    case "bouncing": {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = thick + 2;
      line(ctx, f.left, rig.floorY, f.right, rig.floorY);
      break;
    }
  }
  ctx.restore();
}

/** The bobs (with their strings, radius lines or floor shadows): rainbow by index, brightened for a moment after each note, glowing on request. */
export function drawPendulumBobs(ctx: CanvasRenderingContext2D, balls: Ball[], view: PendulumView, o: PendulumRenderOptions) {
  const rig = view.rig;
  if (!rig) return;
  const layout = rig.layout;
  ctx.save();
  ctx.lineCap = "round";
  for (const ball of balls) {
    const st = view.byId.get(ball.id);
    if (!st) continue;
    const r = ball.radius;
    const hue = Math.round(st.hue);
    const age = ticksAgoMs(view, st.lastNoteTick);
    const flash = age < NOTE_FLASH_MS ? 1 - age / NOTE_FLASH_MS : 0;
    const i = st.index;
    // The string (row, arc), the radius line (circle, galaxy) or the floor shadow (bouncing).
    if (layout === "row" || layout === "arc") {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `hsla(${hue}, 70%, 78%, ${(0.5 + 0.4 * flash).toFixed(2)})`;
      ctx.lineWidth = flash > 0 ? 1.6 : 1;
      line(ctx, rig.anchorX[i], rig.anchorY[i], ball.x, ball.y);
    } else if (layout === "circle" || layout === "galaxy") {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `hsla(${hue}, 70%, 70%, ${(0.25 + 0.4 * flash).toFixed(2)})`;
      ctx.lineWidth = 1;
      line(ctx, rig.anchorX[i], rig.anchorY[i], ball.x, ball.y);
    } else if (layout === "bouncing") {
      const height = rig.anchorY[i] - r - ball.y;
      const k = 1 - Math.min(1, height / Math.max(1, rig.length[i]));
      ctx.globalAlpha = 0.12 + 0.3 * k;
      ctx.fillStyle = `hsl(${hue}, 60%, 45%)`;
      ctx.beginPath();
      ctx.ellipse(ball.x, rig.anchorY[i], r * (0.5 + 0.6 * k), Math.max(1, 0.22 * r), 0, 0, TWO_PI);
      ctx.fill();
    }
    // Glow: two enlarged translucent discs (cheaper than a shadow blur).
    const glow = (o.showGlow ? 0.5 : 0) + 0.6 * flash;
    if (glow > 0.01) {
      ctx.fillStyle = `hsl(${hue}, 90%, 62%)`;
      ctx.globalAlpha = glow * 0.22;
      dot(ctx, ball.x, ball.y, r * 1.35 + 2);
      ctx.globalAlpha = glow * 0.1;
      dot(ctx, ball.x, ball.y, r * 1.8 + 4);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = `hsl(${hue}, 90%, ${Math.round(62 + 28 * flash)}%)`;
    dot(ctx, ball.x, ball.y, r);
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.3 + 0.5 * flash).toFixed(2)})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (r >= 3) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      dot(ctx, ball.x - 0.3 * r, ball.y - 0.3 * r, 0.33 * r);
    }
  }
  ctx.restore();
}

/** The white full-screen flash of a big chord – most of the row in line (screen space, outside the camera transform). */
export function drawPendulumChordFlash(ctx: CanvasRenderingContext2D, width: number, height: number, view: PendulumView) {
  if (view.lastChordSize < CHORD_FLASH_MIN_NOTES) return;
  const age = ticksAgoMs(view, view.lastChordTick);
  if (age >= CHORD_FLASH_MS) return;
  const strength = Math.min(1, view.lastChordSize / Math.max(1, view.bobs.length));
  const a = 0.4 * strength * (1 - age / CHORD_FLASH_MS);
  if (a < 0.005) return;
  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
