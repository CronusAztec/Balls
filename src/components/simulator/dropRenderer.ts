import { segmentEndpoints, type Obstacle } from "@/lib/physics/obstacles";
import type { Ball } from "@/lib/physics/types";
import { DROP_ARP_FLASH_MS, DROP_CYCLE_STEP_MS, dropArpAtMs, type DropView } from "@/lib/physics/modes/drop";

/** How long (ms of simulation time) a ball's ring shows once it clicked into place. */
export const DROP_LOCK_FLASH_MS = 320;

/**
 * --- drop-lights --- (Lane E, E6) Ball Drop's own drawing beside the canvas' generic obstacle pass (Canvas.tsx draws the pegs, the
 * bars and the walls in the wall colour; lib/physics/modes/drop.ts keeps what is drawn here):
 *  - `drawDropLit()` under the obstacles: every peg and bar a ball has hit keeps a soft halo in the colour of the ball that hit it
 *    last, so the board lights up over the run, brighter for a moment right after the hit;
 *  - `drawDropFinale()` over the balls: a ball that comes to rest clicks into place with a small ring; once every ball is in place
 *    the board plays their notes low to high round and round, then, at SETTLED!, once more fast, and each ball rings as its note
 *    sounds (a ring in its colour, growing and fading).
 * Both read the mode's state on the simulation clock (`view.timeMs`), so the live canvas, the fast export and the app's render
 * queue draw the same frame at the same time; nothing is allocated per frame beyond a few colour strings.
 */

/** How long (ms of simulation time) a peg glows bright after a hit before it settles to its lasting halo. */
export const DROP_LIT_FRESH_MS = 600;
/** The lasting halo's opacity, and the bright one's right after a hit. */
const LIT_ALPHA = 0.34;
const FRESH_ALPHA = 0.75;
const TWO_PI = Math.PI * 2;
/** A bar's ends (written per bar, never allocated per frame). */
const ENDS = { x1: 0, y1: 0, x2: 0, y2: 0 };

/** The halo's opacity `ageMs` after the last hit of a lit obstacle (never hit: 0). */
export function dropLitAlpha(ageMs: number): number {
  if (!(ageMs >= 0)) return 0;
  if (ageMs >= DROP_LIT_FRESH_MS) return LIT_ALPHA;
  const k = ageMs / DROP_LIT_FRESH_MS;
  return LIT_ALPHA + (FRESH_ALPHA - LIT_ALPHA) * (1 - k) * (1 - k);
}

/** The glow's layers, outermost first: how far past the peg it reaches (× its radius, + px) and its opacity at the lasting glow. */
const GLOW_LAYERS: readonly (readonly [number, number, number])[] = [
  [3.4, 2, 0.12],
  [2.3, 1, 0.22],
  [1.5, 0.5, 0.5],
];

/**
 * The lit pegs' and bars' glow (in the world, under the obstacles the canvas draws): light added in the colour of the ball that hit
 * each last ("lighter" compositing: it brightens the dark board instead of tinting it), three soft layers, brighter for a moment
 * after a hit.
 */
export function drawDropLit(ctx: CanvasRenderingContext2D, view: DropView, obstacles: readonly Obstacle[], wallThickness: number): void {
  const n = Math.min(obstacles.length, view.litMs.length);
  if (n <= view.wallCount) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = view.wallCount; i < n; i++) {
    const hitAt = view.litMs[i];
    if (!(hitAt >= 0)) continue;
    const boost = dropLitAlpha(view.timeMs - hitAt) / LIT_ALPHA;
    const color = view.litColor[i] || "#ffffff";
    const o = obstacles[i];
    if (o.kind === "circle") {
      ctx.fillStyle = color;
      for (const [mul, add, alpha] of GLOW_LAYERS) {
        ctx.globalAlpha = Math.min(1, alpha * boost);
        ctx.beginPath();
        ctx.arc(o.x, o.y, mul * o.radius + add, 0, TWO_PI);
        ctx.fill();
      }
    } else {
      const width = Math.max(o.thickness, wallThickness);
      segmentEndpoints(o, ENDS);
      ctx.strokeStyle = color;
      for (const [mul, add, alpha] of GLOW_LAYERS) {
        ctx.globalAlpha = Math.min(1, alpha * boost);
        ctx.lineWidth = width + 2 * (mul + add);
        ctx.beginPath();
        ctx.moveTo(ENDS.x1, ENDS.y1);
        ctx.lineTo(ENDS.x2, ENDS.y2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** A ring around `ball` `f` (0–1) of the way through its flash: growing by `grow` of its radius and fading. */
function ring(ctx: CanvasRenderingContext2D, ball: Ball, f: number, grow: number, alpha: number) {
  ctx.globalAlpha = alpha * (1 - f);
  ctx.strokeStyle = ball.color;
  ctx.lineWidth = Math.max(2, 0.35 * ball.radius) * (1 - 0.5 * f);
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius * (1.2 + grow * f), 0, TWO_PI);
  ctx.stroke();
}

/** The rings over the balls: a ball's click into place, then the finale's notes (each ball rings as its note sounds). */
export function drawDropFinale(ctx: CanvasRenderingContext2D, view: DropView, balls: readonly Ball[]): void {
  if (view.lockMs.size > 0) {
    ctx.save();
    for (const ball of balls) {
      const at = view.lockMs.get(ball.id);
      if (at === undefined) continue;
      const age = view.timeMs - at;
      if (age < 0 || age > DROP_LOCK_FLASH_MS) continue;
      ring(ctx, ball, age / DROP_LOCK_FLASH_MS, 0.8, 0.7);
    }
    ctx.restore();
  }
  const n = view.arpIds.length;
  if (view.cycleFromMs >= 0 && n > 0) {
    // the cycle's last note of each ball (played while the board had not settled yet)
    const until = view.settledMs >= 0 ? Math.min(view.timeMs, view.settledMs - 1e-6) : view.timeMs;
    const idx = Math.floor((until - view.cycleFromMs) / DROP_CYCLE_STEP_MS + 1e-9);
    if (idx >= 0) {
      ctx.save();
      for (const ball of balls) {
        const k = view.arpIds.indexOf(ball.id);
        if (k < 0 || k > idx) continue;
        const j = k + n * Math.floor((idx - k) / n);
        const age = view.timeMs - (view.cycleFromMs + j * DROP_CYCLE_STEP_MS);
        if (age < 0 || age > DROP_ARP_FLASH_MS) continue;
        ring(ctx, ball, age / DROP_ARP_FLASH_MS, 1.0, 0.6);
      }
      ctx.restore();
    }
  }
  if (view.settledMs < 0 || n === 0) return;
  const t = view.timeMs - view.settledMs;
  if (t < 0 || t > dropArpAtMs(view.arpIds.length - 1) + DROP_ARP_FLASH_MS) return;
  ctx.save();
  for (const ball of balls) {
    const k = view.arpIds.indexOf(ball.id);
    if (k < 0) continue;
    const age = t - dropArpAtMs(k);
    if (age < 0 || age > DROP_ARP_FLASH_MS) continue;
    const f = age / DROP_ARP_FLASH_MS;
    ring(ctx, ball, f, 1.6, 0.9);
    ctx.globalAlpha = 0.55 * (1 - f);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius * 0.9, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Where Ball Drop's SETTLED! sits (the share of the square its plate's centre is at): in the strip above the board's first row
 * of pegs, between the square's top margin (the 2 % every banner keeps) and the top of that row, so the board, its lit pegs and
 * the pile stay in view. `layout`: the board in the world of `width` × `height` (the canvas, whose centred square a clip shows).
 */
export function dropBannerAt(layout: { obstacles: readonly Obstacle[] } | null, wallCount: number, width: number, height: number): number | undefined {
  if (!layout) return undefined;
  const side = Math.max(1, Math.min(width, height));
  const top = (height - side) / 2;
  let rowTop = Infinity;
  for (let i = wallCount; i < layout.obstacles.length; i++) {
    const o = layout.obstacles[i];
    rowTop = Math.min(rowTop, o.kind === "circle" ? o.y - o.radius : o.y - o.thickness / 2);
  }
  if (!Number.isFinite(rowTop)) return undefined;
  return ((top + 0.02 * side + rowTop) / 2 - top) / side;
}
