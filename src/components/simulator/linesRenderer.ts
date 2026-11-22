import { LINES_KEYS, type LinesView } from "@/lib/physics/modes/lines";

/**
 * --- string-art --- Canvas drawing of the Lines mode (lib/physics/modes/lines.ts) as string art, in place of the plain white fan
 * (renderBudget.ts `drawStringArt()`, which Grow keeps):
 *  - the finished art: a string from every bounce point to the next (the ball's own path), in rainbow order with Rainbow Lines
 *    (a full rainbow every STRING_HUE_CYCLE strings, so the colours stay put as the oldest points drop out) or the Line Colour,
 *    added up where they cross, so the figure glows where it is dense;
 *  - the fan the mode is named for: every bounce point tied to the ball, faint, the newest FAN_RECENT brighter, and the newest
 *    string thick, bright and glowing;
 *  - the ring as a circular keyboard: LINES_KEYS key ticks round the rim and the key under the last bounce lit in its colour,
 *    a ring spreading from the newest bounce point;
 *  - the end (Strings to Finish): every string flashes at full brightness, then the finished art stays lit without the fan.
 * Everything from the run's own clock (the bounce times and the engine's elapsed ms), so the live canvas, the fast export and the
 * Windows app's render queue draw the same frame for the same moment. One path per colour bucket and alpha step; nothing allocated
 * per frame but the cached colour strings.
 */

export interface LinesRenderOptions {
  rainbow: boolean;
  lineColor: string;
  /** The engine's elapsed ms (the run's clock the bounce times are on). */
  nowMs: number;
  /** The ring: its centre and radius. */
  cx: number;
  cy: number;
  radius: number;
  showGlow: boolean;
}

/** Strings per full rainbow, the colour buckets, and the finished art's and the fan's alphas. */
export const STRING_HUE_CYCLE = 48;
const BUCKETS = 24;
export const ART_ALPHA = 0.5;
export const ART_DONE_ALPHA = 0.62;
export const FAN_ALPHA = 0.07;
/** The newest bounce points tied to the ball brighter, fading with age. */
export const FAN_RECENT = 14;
/** How long the key under a bounce stays lit and the ring spreads from the newest point, and the end's flash (ms). */
export const KEY_LIT_MS = 420;
export const BOUNCE_RING_MS = 360;
export const FINISH_FLASH_MS = 700;

const TWO_PI = Math.PI * 2;
const fills: string[] = [];
for (let b = 0; b < BUCKETS; b++) fills.push(`hsl(${Math.round((b + 0.5) * (360 / BUCKETS))}, 92%, 62%)`);

/** The hue bucket of string number `index` (0 for the run's first string). */
export function stringBucket(index: number): number {
  const turn = (((index % STRING_HUE_CYCLE) + STRING_HUE_CYCLE) % STRING_HUE_CYCLE) / STRING_HUE_CYCLE;
  return Math.min(BUCKETS - 1, Math.floor(turn * BUCKETS));
}

function colourOf(index: number, o: LinesRenderOptions): string {
  return o.rainbow ? fills[stringBucket(index)] : o.lineColor;
}

/** Draws the string art of `view`, the fan tied to `ball` (null: none), the keyboard and the end's flash. Inside the camera transform. */
export function drawLinesArt(ctx: CanvasRenderingContext2D, view: LinesView, ball: { x: number; y: number } | null, o: LinesRenderOptions) {
  const pts = view.points;
  const n = pts.length;
  if (n === 0 && !ball) return;
  // the global number of point i: the strings struck before the kept ones were dropped
  const first = view.strings - n;
  const sinceFinish = view.finished ? o.nowMs - view.finishMs : -1;
  const flash = view.finished && sinceFinish < FINISH_FLASH_MS ? 1 - Math.max(0, sinceFinish) / FINISH_FLASH_MS : 0;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // the keyboard: a tick at every key's edge, and the key of the last bounce lit
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = o.rainbow ? "#ffffff" : o.lineColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = 0; k < LINES_KEYS; k++) {
    const a = -Math.PI / 2 + (k * TWO_PI) / LINES_KEYS;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(o.cx + c * (o.radius - 7), o.cy + s * (o.radius - 7));
    ctx.lineTo(o.cx + c * (o.radius - 1), o.cy + s * (o.radius - 1));
  }
  ctx.stroke();
  const keyAge = o.nowMs - view.lastKeyMs;
  if (view.lastKey >= 0 && keyAge >= 0 && keyAge < KEY_LIT_MS) {
    const k = 1 - keyAge / KEY_LIT_MS;
    const a0 = -Math.PI / 2 + (view.lastKey * TWO_PI) / LINES_KEYS;
    ctx.globalAlpha = 0.85 * k;
    ctx.strokeStyle = colourOf(view.strings - 1, o);
    ctx.lineWidth = 4 + 6 * k;
    ctx.beginPath();
    ctx.arc(o.cx, o.cy, o.radius, a0 + 0.02, a0 + TWO_PI / LINES_KEYS - 0.02);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = "lighter";
  // the finished art: each bounce point to the next, by colour (one path a bucket; one in all without Rainbow Lines)
  const artAlpha = view.finished ? ART_DONE_ALPHA + (1 - ART_DONE_ALPHA) * flash : ART_ALPHA;
  ctx.lineWidth = view.finished ? 2.4 + 1.4 * flash : 2.1;
  ctx.globalAlpha = artAlpha;
  if (n > 1) {
    if (o.rainbow) {
      for (let b = 0; b < BUCKETS; b++) {
        let any = false;
        ctx.beginPath();
        for (let i = 1; i < n; i++) {
          if (stringBucket(first + i) !== b) continue;
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          any = true;
        }
        if (!any) continue;
        ctx.strokeStyle = fills[b];
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.strokeStyle = o.lineColor;
      ctx.stroke();
    }
  }

  // the fan: every point tied to the ball, faint; the newest brighter as they are younger; the newest string thick and glowing
  if (ball && !view.finished && n > 0) {
    ctx.lineWidth = 1;
    ctx.globalAlpha = FAN_ALPHA;
    ctx.strokeStyle = o.rainbow ? "#ffffff" : o.lineColor;
    ctx.beginPath();
    for (let i = 0; i < n - FAN_RECENT; i++) {
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(ball.x, ball.y);
    }
    ctx.stroke();
    ctx.lineWidth = 1.3;
    for (let i = Math.max(0, n - FAN_RECENT); i < n - 1; i++) {
      const age = n - 1 - i;
      ctx.globalAlpha = 0.6 * (1 - age / FAN_RECENT);
      ctx.strokeStyle = colourOf(first + i, o);
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(ball.x, ball.y);
      ctx.stroke();
    }
    const last = pts[n - 1];
    const colour = colourOf(view.strings - 1, o);
    if (o.showGlow) {
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 8;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(ball.x, ball.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(ball.x, ball.y);
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";

  // the bounce points, a dot each in its string's colour, and a ring spreading from the newest
  ctx.globalAlpha = 0.9;
  if (o.rainbow) {
    for (let b = 0; b < BUCKETS; b++) {
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (stringBucket(first + i) !== b) continue;
        ctx.moveTo(pts[i].x + 2.5, pts[i].y);
        ctx.arc(pts[i].x, pts[i].y, 2.5, 0, TWO_PI);
        any = true;
      }
      if (!any) continue;
      ctx.fillStyle = fills[b];
      ctx.fill();
    }
  } else if (n > 0) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(pts[i].x + 2.5, pts[i].y);
      ctx.arc(pts[i].x, pts[i].y, 2.5, 0, TWO_PI);
    }
    ctx.fillStyle = o.lineColor;
    ctx.fill();
  }
  if (n > 0) {
    const age = o.nowMs - view.times[n - 1];
    if (age >= 0 && age < BOUNCE_RING_MS) {
      const k = age / BOUNCE_RING_MS;
      ctx.globalAlpha = 0.9 * (1 - k);
      ctx.strokeStyle = colourOf(view.strings - 1, o);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(pts[n - 1].x, pts[n - 1].y, 4 + 14 * k, 0, TWO_PI);
      ctx.stroke();
    }
  }
  // the end's flash: a soft light over the finished art
  if (flash > 0) {
    ctx.globalAlpha = 0.22 * flash;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(o.cx, o.cy, o.radius, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}
