import { BOX_CORNER_BL, BOX_CORNER_BR, BOX_CORNER_TL, BOX_CORNER_TR, BOX_PULSES, BOX_WALL_BOTTOM, BOX_WALL_LEFT, BOX_WALL_RIGHT, BOX_WALL_TOP, shapeHalfHeight, shapeHalfWidth, type BoxShape, type BoxView } from "@/lib/physics/modes/box";
import type { Ball } from "@/lib/physics/types";

/**
 * Canvas drawing of the Bouncing Shapes mode (lib/physics/modes/box.ts): the box with a glow on the wall
 * that was hit last, the shapes – axis-aligned squares, circles or a stylised DVD-style plate (a rounded
 * rectangle with a disc motif; no trademark artwork) – with their countdown numbers, hit flash, growth and
 * cycling colours, and the full-screen flash of a corner accent. Called from Canvas.tsx inside the camera
 * transform (arena, shapes) and outside it (the flash); it allocates nothing per frame beyond the fill
 * strings, so twelve shapes at 1080×1920 stay well inside the frame budget.
 *
 * --- box-finale --- (Lane E, E4) What a stranger reads on a phone: the countdown digits half as big again, a pulse of the
 * shape's colour at the very spot of the wall it hit (`BoxView.pulse*`), the corner a shape on its way to its final corner is
 * aimed at lighting up as its last counts run out, and a shape that reaches 0 popping into confetti of its colour instead of
 * staying on as a dim ghost. All of it from the simulation's own ticks and the shape's id (`burstHash()`), so a frame is the
 * same live, in the fast export and in the Windows app's render queue.
 */

export interface BoxRenderOptions {
  /** Colour of wall `index` (BOX_WALL_*), optionally with alpha – the canvas' wall colour function, so rainbow walls apply. */
  wallColor: (index: number, alpha?: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
  showGlow: boolean;
  showTrails: boolean;
  trailThickness: number;
}

const TWO_PI = Math.PI * 2;
/** How long a shape stays brightened after a hit (simulation ms). */
export const HIT_FLASH_MS = 260;
/** How long a wall glows after a hit (simulation ms). */
export const WALL_GLOW_MS = 600;
/** How long the screen flash of a corner accent lasts (simulation ms). */
export const CORNER_FLASH_MS = 380;
// --- box-finale ---
/** How long the pulse at a hit spot of the wall lasts (simulation ms). */
export const HIT_PULSE_MS = 480;
/** A shape that reaches 0 pops (this long) and throws BURST_PIECES pieces of confetti that fly for BURST_MS (simulation ms). */
export const POP_MS = 220;
export const BURST_MS = 1400;
export const BURST_PIECES = 28;
/** The corner a shape is aimed at lights up over its last FINALE_GLOW_COUNT counts. */
export const FINALE_GLOW_COUNT = 6;
/** The countdown digits' size against the shape (1.5× the size they had: readable on a phone). */
export const DIGIT_SCALE = 1.5;

/** A fixed pseudo-random number in [0, 1) for a shape's burst piece (no random draw: the same frame everywhere). */
export function burstHash(id: number, piece: number, k: number): number {
  let h = Math.imul(id + 1, 0x9e3779b1) ^ Math.imul(piece + 1, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const GLOW_LAYERS = [
  { widthMult: 5, alphaMult: 0.06 },
  { widthMult: 2.5, alphaMult: 0.18 },
  { widthMult: 1, alphaMult: 0.65 },
];

/** Simulation ms since sub-step `tick` (Infinity before the first hit). */
export function ticksAgoMs(view: BoxView, tick: number): number {
  return tick === -Infinity ? Infinity : (view.tick - tick) * view.tickMs;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** Traces the outline of a shape centred on the origin (a new path). */
function shapePath(ctx: CanvasRenderingContext2D, shape: BoxShape, hw: number, hh: number) {
  if (shape === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, hw, 0, TWO_PI);
    ctx.closePath();
  } else if (shape === "dvd") roundedRect(ctx, -hw, -hh, 2 * hw, 2 * hh, 0.45 * hh);
  else roundedRect(ctx, -hw, -hh, 2 * hw, 2 * hh, 0.16 * Math.min(hw, hh));
}

/** The box: a rounded frame in the wall colour, each wall glowing for a moment after it was hit. */
export function drawBoxArena(ctx: CanvasRenderingContext2D, view: BoxView, o: BoxRenderOptions) {
  const f = view.field;
  if (!f) return;
  const thickness = Math.max(1.5, o.wallThickness);
  ctx.save();
  ctx.lineCap = "round";
  if (o.showWallGlow) {
    for (let wall = 0; wall < 4; wall++) {
      const age = ticksAgoMs(view, view.wallLastHitTick[wall]);
      if (age >= WALL_GLOW_MS) continue;
      const t = age / WALL_GLOW_MS;
      const strength = 1 - t * t;
      if (strength < 0.01) continue;
      for (const layer of GLOW_LAYERS) {
        ctx.globalAlpha = layer.alphaMult > 0.2 ? 0.85 : 0.5;
        ctx.strokeStyle = o.wallColor(wall, strength * layer.alphaMult);
        ctx.lineWidth = thickness + (4 + 4 * strength) * layer.widthMult;
        ctx.beginPath();
        if (wall === BOX_WALL_TOP) {
          ctx.moveTo(f.left, f.top);
          ctx.lineTo(f.right, f.top);
        } else if (wall === BOX_WALL_RIGHT) {
          ctx.moveTo(f.right, f.top);
          ctx.lineTo(f.right, f.bottom);
        } else if (wall === BOX_WALL_BOTTOM) {
          ctx.moveTo(f.left, f.bottom);
          ctx.lineTo(f.right, f.bottom);
        } else if (wall === BOX_WALL_LEFT) {
          ctx.moveTo(f.left, f.top);
          ctx.lineTo(f.left, f.bottom);
        }
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = thickness;
  ctx.strokeStyle = o.wallColor(0);
  roundedRect(ctx, f.left, f.top, f.width, f.height, Math.min(10, 0.03 * Math.min(f.width, f.height)));
  ctx.stroke();
  // --- box-finale --- a pulse of the shape's colour at the spot it hit: a bright stretch of the wall that spreads, and a ring
  const side = Math.min(f.width, f.height);
  for (let k = 0; k < BOX_PULSES; k++) {
    const age = ticksAgoMs(view, view.pulseTick[k]);
    if (!(age < HIT_PULSE_MS) || age < 0) continue;
    const t = age / HIT_PULSE_MS;
    const fade = (1 - t) * (1 - t);
    const x = view.pulseX[k];
    const y = view.pulseY[k];
    const hue = Math.round(view.pulseHue[k]);
    const along = (0.05 + 0.13 * Math.sqrt(t)) * side;
    const vertical = x <= f.left + 0.5 || x >= f.right - 0.5;
    ctx.globalAlpha = 0.95 * fade;
    ctx.strokeStyle = `hsl(${hue}, 95%, 70%)`;
    ctx.lineWidth = thickness + 3 + 5 * fade;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(x, Math.max(f.top, y - along));
      ctx.lineTo(x, Math.min(f.bottom, y + along));
    } else {
      ctx.moveTo(Math.max(f.left, x - along), y);
      ctx.lineTo(Math.min(f.right, x + along), y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.5 * fade;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, (0.02 + 0.09 * t) * side, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.restore();
}

/** --- box-finale --- An L of light in corner `corner` (BOX_CORNER_*) of the box, `strength` 0–1, in the shape's hue. */
function drawCornerGlow(ctx: CanvasRenderingContext2D, view: BoxView, corner: number, hue: number, strength: number) {
  const f = view.field;
  if (!f || strength <= 0) return;
  const x = corner === BOX_CORNER_TL || corner === BOX_CORNER_BL ? f.left : f.right;
  const y = corner === BOX_CORNER_TL || corner === BOX_CORNER_TR ? f.top : f.bottom;
  const sx = x === f.left ? 1 : -1;
  const sy = corner === BOX_CORNER_BR || corner === BOX_CORNER_BL ? -1 : 1;
  const arm = (0.1 + 0.14 * strength) * Math.min(f.width, f.height);
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = `hsl(${Math.round(hue)}, 95%, 70%)`;
  for (const [width, alpha] of [
    [20, 0.18],
    [10, 0.42],
    [4, 1],
  ] as const) {
    ctx.globalAlpha = alpha * strength;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x + sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * arm);
    ctx.stroke();
  }
  ctx.restore();
}

/** --- box-finale --- A shape that reached 0: it pops (POP_MS) and its colour flies off as confetti (BURST_MS); nothing after. */
function drawBurst(ctx: CanvasRenderingContext2D, view: BoxView, ball: Ball, hw: number, hh: number, hue: number, age: number, id: number) {
  const f = view.field;
  if (!f || !(age >= 0) || age >= BURST_MS) return;
  const shape = view.shape;
  ctx.save();
  if (age < POP_MS) {
    const t = age / POP_MS;
    ctx.translate(ball.x, ball.y);
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = `hsl(${hue}, 90%, ${Math.round(85 - 20 * t)}%)`;
    shapePath(ctx, shape, hw * (1 + 0.35 * t), hh * (1 + 0.35 * t));
    ctx.fill();
    ctx.globalAlpha = 0.8 * (1 - t);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(hw, hh) * (1.2 + 1.4 * t), 0, TWO_PI);
    ctx.stroke();
    ctx.translate(-ball.x, -ball.y);
  }
  const side = Math.min(f.width, f.height);
  const s = age / 1000;
  const fade = 1 - (age / BURST_MS) * (age / BURST_MS);
  for (let i = 0; i < BURST_PIECES; i++) {
    const angle = TWO_PI * ((i + burstHash(id, i, 0)) / BURST_PIECES);
    const speed = (0.28 + 0.42 * burstHash(id, i, 1)) * side;
    const px = ball.x + Math.cos(angle) * speed * s;
    const py = ball.y + Math.sin(angle) * speed * s + 0.45 * side * s * s;
    const size = (0.011 + 0.012 * burstHash(id, i, 2)) * side;
    const turn = burstHash(id, i, 3) * TWO_PI + (burstHash(id, i, 4) - 0.5) * 14 * s;
    ctx.globalAlpha = Math.max(0, fade);
    ctx.fillStyle = `hsl(${Math.round(hue + (burstHash(id, i, 5) - 0.5) * 70)}, 92%, ${Math.round(58 + 22 * burstHash(id, i, 6))}%)`;
    ctx.translate(px, py);
    ctx.rotate(turn);
    ctx.fillRect(-size / 2, -size / 4, size, size / 2);
    ctx.rotate(-turn);
    ctx.translate(-px, -py);
  }
  ctx.restore();
}

/** The shapes: trail, glow, body, DVD motif and countdown number, in the order of the balls. */
export function drawBoxShapes(ctx: CanvasRenderingContext2D, balls: Ball[], view: BoxView, o: BoxRenderOptions) {
  const shape = view.shape;
  for (const ball of balls) {
    const st = view.shapes.get(ball.id);
    if (!st) continue;
    const hw = shapeHalfWidth(shape, ball.radius);
    const hh = shapeHalfHeight(shape, ball.radius);
    const age = ticksAgoMs(view, st.lastHitTick);
    const flash = age < HIT_FLASH_MS ? 1 - age / HIT_FLASH_MS : 0;
    const hue = Math.round(st.hue);
    // --- box-finale --- a shape at 0 pops into confetti of its colour (from its final hit), then is gone
    if (st.done) {
      drawBurst(ctx, view, ball, hw, hh, hue, age, st.id);
      continue;
    }
    // --- box-finale --- the corner it is aimed at lights up over its last counts
    if (st.finaleCorner >= 0 && view.countdown > 0 && st.count <= FINALE_GLOW_COUNT) {
      const strength = (FINALE_GLOW_COUNT + 1 - st.count) / FINALE_GLOW_COUNT;
      drawCornerGlow(ctx, view, st.finaleCorner, st.hue, Math.min(1, strength) * (0.75 + 0.25 * Math.cos((view.tick * view.tickMs) / 90)));
    }
    const fill = `hsl(${hue}, 88%, ${Math.round(60 + 25 * flash)}%)`;
    const alpha = 1;
    if (o.showTrails && ball.trail.length > 1) {
      const len = ball.trail.length;
      ctx.strokeStyle = `hsla(${hue}, 88%, 60%, 0.35)`;
      ctx.lineWidth = Math.max(1, 0.35 * ball.radius * o.trailThickness);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const first = ball.trail[ball.trailIndex % len];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < len; i++) {
        const pt = ball.trail[(ball.trailIndex + i) % len];
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(ball.x, ball.y);
    // Glow: two enlarged translucent copies of the shape (cheaper than a shadow blur, and it follows the outline).
    const glow = (o.showGlow ? 0.5 : 0) + 0.6 * flash;
    if (glow > 0.01) {
      ctx.fillStyle = fill;
      for (let k = 1; k <= 2; k++) {
        ctx.globalAlpha = alpha * glow * (k === 1 ? 0.22 : 0.1);
        shapePath(ctx, shape, hw * (1 + 0.18 * k) + 2 * k, hh * (1 + 0.18 * k) + 2 * k);
        ctx.fill();
      }
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    shapePath(ctx, shape, hw, hh);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.3 + 0.5 * flash).toFixed(2)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (shape === "dvd") {
      // The disc motif of the plate: a dark ellipse ring low on the plate with a small hub.
      ctx.strokeStyle = "rgba(10, 10, 15, 0.75)";
      ctx.lineWidth = Math.max(1, 0.14 * hh);
      ctx.beginPath();
      ctx.ellipse(0, 0.5 * hh, 0.6 * hw, 0.2 * hh, 0, 0, TWO_PI);
      ctx.stroke();
      ctx.fillStyle = "rgba(10, 10, 15, 0.75)";
      ctx.beginPath();
      ctx.ellipse(0, 0.5 * hh, 0.14 * hw, 0.06 * hh, 0, 0, TWO_PI);
      ctx.fill();
    }
    if (view.countdown > 0 && Math.min(hw, hh) >= 7) {
      const digits = st.count >= 10 ? 2 : 1;
      // (--- box-finale --- DIGIT_SCALE: half as big again, still inside a square or circle's body)
      const fs = DIGIT_SCALE * (shape === "dvd" ? Math.min(1.05 * hh, (1.5 * hw) / digits) : Math.min(1.25 * hh, (1.6 * hw) / digits));
      ctx.font = `bold ${fs.toFixed(1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(10, 10, 15, 0.9)";
      ctx.fillText(String(st.count), 0, shape === "dvd" ? -0.28 * hh : 0.04 * fs);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** The white full-screen flash of a corner accent (drawn in screen space, outside the camera transform). */
export function drawBoxCornerFlash(ctx: CanvasRenderingContext2D, width: number, height: number, view: BoxView) {
  const age = ticksAgoMs(view, view.lastCornerTick);
  if (age >= CORNER_FLASH_MS) return;
  const a = 0.45 * (1 - age / CORNER_FLASH_MS);
  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
