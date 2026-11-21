import type { FrozenBall } from "@/lib/physics/modes/accumulation";
import type { ColorMatchSegment } from "@/lib/physics/modes/colorMatch";
import { COUNTDOWN_FLASH_MS, type WrongFlash } from "@/lib/physics/modes/target";

/*
 * --- ring-looks --- The picture of the single-ring escape modes – Countdown, Color Match, Accumulation – and Classic's
 * rings-left read-out. They shared one look (a white ball in a thin ring on a black square, a small grey counter the ball
 * flew through) and their 1080 × 1920 exports were 93–99 % dark pixels. Here each mode's ring says its rule:
 *
 *  - Countdown: every number a bright tile with its number on it, the one to hit next in yellow, thicker, pulsing, with a
 *    pointer; a hit tile pops and turns green; a wrong one flashes red and shakes; the number to hit stands huge and faint
 *    in the middle, behind the ball, and punches when it changes.
 *  - Color Match: the segments of the ball's colour of the moment light up and the others dim, so the eye sees where the
 *    ball has to land; a matched segment bursts outwards; a halo of that colour follows the ball; in the middle, behind the
 *    ball, the segments left and the rule as a picture (a dot, an arrow, a cracked tile – all in the ball's colour).
 *  - Accumulation: frozen balls are ice (pale blue, a white rim, a glint) with a frost burst as they freeze; the timer is a
 *    ring round the live ball that runs out and turns red, and big faint digits in the middle.
 *  - Classic: a row of pips in the square's top-left corner, one per ring in its ring's colour, emptied as rings break,
 *    with the number left – the progress a stranger reads in a second.
 *  - and under each single ring a floor (`drawRingFloor()`): the arena as a tinted disc instead of a black hole – Countdown's
 *    indigo, Accumulation's ice blue, Color Match's in the ball's colour of the moment, so the whole arena turns with every
 *    bounce and the segments that match it are the ones lit. A tint, not a fill: a theme's background shows through.
 *
 * Draw-only: everything is read from the modes' state and the simulation clock (`nowMs`: the engine's elapsed time), so the
 * same step draws the same frame live, in the fast export and in the app's render queue. Nothing is allocated per frame
 * beyond the strings fillText needs; the detailed passes are capped (DETAIL_CAP) so a visitor's thousand tiles or frozen
 * balls stay cheap.
 */

const TWO_PI = Math.PI * 2;
/** Tiles, segments or frozen balls drawn with their detail (numbers, glints, bursts); the rest keep the plain shape. */
export const DETAIL_CAP = 240;
/** A matched Color Match segment bursts for this long (simulation ms). */
export const SEGMENT_BURST_MS = 450;
/** A frozen ball's frost burst lasts this long (simulation ms). */
export const FROST_BURST_MS = 520;
/** The faint read-out in the middle: its opacity and its size as a share of the ring's radius. */
const BACKDROP_ALPHA = 0.34;

/** A Color Match segment that does not match the ball: dim, its colour still plain to see. */
export const DIM_ALPHA = 0.5;

/** The floors' tints: Countdown's and Accumulation's own colours, and how strong a floor is (Color Match's takes the ball's colour). */
export const FLOOR_COLORS = { countdown: "#5a64ff", accumulation: "#3c78ff" } as const;
export const FLOOR_ALPHA = 0.34;

/**
 * The arena's floor: a disc of `color` inside a ring of `radius`, FLOOR_ALPHA strong, drawn first (under the ring, the
 * read-out and the balls). One fill a frame.
 */
export function drawRingFloor(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string): void {
  ctx.save();
  ctx.globalAlpha = FLOOR_ALPHA;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

export const COUNTDOWN_COLORS = { idle: "#6d7cff", target: "#facc15", hit: "#22c55e", wrong: "#ef4444" } as const;

/** What draws an arc of a ring that may wobble (the canvas' WobbleLayer): a path only, the caller strokes it. */
export interface RingArcPath {
  pathArc(ctx: CanvasRenderingContext2D, wallIndex: number, cx: number, cy: number, radius: number, start: number, end: number): void;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The newest flash of a kind among `flashes` as 0–1 of its life left (0: none), optionally for one segment's number. */
export function flashLeft(flashes: readonly WrongFlash[], right: boolean, segment?: number): number {
  let best = 0;
  for (const f of flashes) {
    if (!!f.right !== right || (segment !== undefined && f.segment !== segment)) continue;
    const k = clamp01(f.time / COUNTDOWN_FLASH_MS);
    if (k > best) best = k;
  }
  return best;
}

/* ------------------------------------------------------------------ Countdown */

export interface CountdownRingView {
  total: number;
  target: number;
  hit: ReadonlySet<number>;
  flashes: readonly WrongFlash[];
  map: readonly number[];
  complete: boolean;
}

/** The tile ring's thickness for a ring of `radius` (the engine's wall is its middle line). */
export function countdownTileThickness(radius: number): number {
  return Math.max(12, 0.1 * radius);
}

/** The number on a tile: as big as the tile's arc allows, at most 7.5 % of the ring's diameter; 0 when it would be unreadable. */
export function countdownNumberSize(radius: number, total: number): number {
  const arc = (TWO_PI * radius) / Math.max(1, total);
  const fs = Math.min(0.15 * radius, 0.55 * arc);
  return fs >= 9 ? fs : 0;
}

/**
 * Countdown's ring and its faint centre number, in the world pass (under the balls): `nowMs` is the simulation clock, which
 * the target's pulse runs on.
 */
export function drawCountdownRing(ctx: CanvasRenderingContext2D, view: CountdownRingView, cx: number, cy: number, radius: number, nowMs: number, arcs: RingArcPath): void {
  const total = Math.max(1, view.total);
  const step = TWO_PI / total;
  const thickness = countdownTileThickness(radius);
  const start = -Math.PI / 2;
  const gap = Math.min(0.035, 0.18 * step);
  const pulse = 0.5 + 0.5 * Math.sin(0.009 * nowMs);
  const numberFs = countdownNumberSize(radius, total);
  const detail = total <= DETAIL_CAP;
  drawRingFloor(ctx, cx, cy, radius, FLOOR_COLORS.countdown);
  ctx.save();
  ctx.lineCap = "butt";
  // The number to hit next, huge and faint behind everything; it punches when a hit moves it on.
  if (!view.complete) {
    const punch = flashLeft(view.flashes, true);
    const fs = 0.78 * radius * (1 + 0.22 * punch);
    ctx.globalAlpha = BACKDROP_ALPHA + 0.3 * punch;
    ctx.fillStyle = COUNTDOWN_COLORS.target;
    ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(view.target), cx, cy + 0.04 * fs);
  }
  for (let s = 0; s < total; s++) {
    const number = view.map[s] ?? total - s;
    const a0 = start + s * step;
    const a1 = a0 + step;
    const isHit = view.hit.has(number);
    const isTarget = !view.complete && number === view.target;
    const wrong = detail && !isHit && !isTarget ? flashLeft(view.flashes, false, number) : 0;
    const pop = detail && isHit ? flashLeft(view.flashes, true, number) : 0;
    let color: string = COUNTDOWN_COLORS.idle;
    let alpha = 0.62;
    let width = thickness;
    let r = radius;
    if (isHit) {
      color = COUNTDOWN_COLORS.hit;
      alpha = 0.55 + 0.45 * pop;
      width = thickness * (1 + 0.9 * pop);
    } else if (isTarget) {
      color = COUNTDOWN_COLORS.target;
      alpha = 0.82 + 0.18 * pulse;
      width = thickness * (1.3 + 0.14 * pulse);
    } else if (wrong > 0) {
      color = COUNTDOWN_COLORS.wrong;
      alpha = 0.6 + 0.4 * wrong;
      r = radius + 0.02 * radius * wrong * Math.sin(0.09 * nowMs); // the tile shakes
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (isTarget) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 + 10 * pulse;
    }
    ctx.beginPath();
    arcs.pathArc(ctx, 0, cx, cy, r, a0 + gap, a1 - gap);
    ctx.stroke();
    if (isTarget) ctx.shadowBlur = 0;
    if (!detail && !isTarget) continue;
    const mid = (a0 + a1) / 2;
    const cos = Math.cos(mid);
    const sin = Math.sin(mid);
    if (numberFs > 0 || isTarget) {
      // the number inside the ring, by its tile: white on the idle tiles, the tile's own colour on the others
      const fs = (numberFs > 0 ? numberFs : 12) * (isTarget ? 1.25 + 0.08 * pulse : 1) * (1 + 0.35 * pop);
      const lr = radius - thickness / 2 - 0.75 * fs - (isTarget ? 0.03 * radius : 0);
      ctx.globalAlpha = isHit ? 0.75 : isTarget ? 1 : 0.92;
      ctx.fillStyle = isHit ? COUNTDOWN_COLORS.hit : isTarget ? COUNTDOWN_COLORS.target : wrong > 0 ? COUNTDOWN_COLORS.wrong : "#e6e9ff";
      ctx.font = `800 ${fs.toFixed(1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(number), cx + lr * cos, cy + lr * sin);
    }
    if (isTarget) {
      // a pointer outside the ring, aimed at the tile
      const tip = radius + width / 2 + 0.015 * radius;
      const base = tip + 0.07 * radius + 0.012 * radius * pulse;
      const half = 0.045 * radius;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = COUNTDOWN_COLORS.target;
      ctx.beginPath();
      ctx.moveTo(cx + tip * cos, cy + tip * sin);
      ctx.lineTo(cx + base * cos - half * sin, cy + base * sin + half * cos);
      ctx.lineTo(cx + base * cos + half * sin, cy + base * sin - half * cos);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ Color Match */

/**
 * Color Match's segments, in the world pass: the ones of the ball's colour (`ballColor`) lit and thicker, the others dim, a
 * matched one bursting outwards for SEGMENT_BURST_MS; and behind the balls the segments left with the rule as a picture.
 */
export function drawColorMatchRing(
  ctx: CanvasRenderingContext2D,
  segments: readonly ColorMatchSegment[],
  ballColor: string,
  open: boolean,
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  wallThickness: number,
  nowMs: number,
  arcs: RingArcPath,
): void {
  const base = Math.max(12, wallThickness + 10);
  const detail = segments.length <= DETAIL_CAP;
  let left = 0;
  if (!open) drawRingFloor(ctx, cx, cy, radius, ballColor);
  ctx.save();
  ctx.lineCap = "butt";
  for (const seg of segments) {
    if (seg.broken) {
      const age = nowMs - seg.brokenMs;
      if (!detail || seg.brokenMs < 0 || age < 0 || age >= SEGMENT_BURST_MS) continue;
      const k = age / SEGMENT_BURST_MS;
      ctx.globalAlpha = 0.85 * (1 - k);
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = base * (1.4 - 1.1 * k);
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 0.16 * radius * k, seg.startAngle + rotation, seg.endAngle + rotation);
      ctx.stroke();
      continue;
    }
    left++;
    if (open) continue;
    const lit = seg.color === ballColor;
    ctx.globalAlpha = lit ? 1 : DIM_ALPHA;
    ctx.strokeStyle = seg.color;
    ctx.lineWidth = lit ? 1.4 * base : base;
    if (lit && detail) {
      ctx.shadowColor = seg.color;
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    arcs.pathArc(ctx, 0, cx, cy, radius, seg.startAngle + rotation + 0.012, seg.endAngle + rotation - 0.012);
    ctx.stroke();
    if (lit && detail) ctx.shadowBlur = 0;
  }
  if (!open && left > 0) drawColorMatchBackdrop(ctx, left, ballColor, cx, cy, radius);
  ctx.restore();
}

/** The middle of Color Match's ring, behind the balls: the segments left, and under the number a dot, an arrow and a cracked tile – all in the ball's colour. */
function drawColorMatchBackdrop(ctx: CanvasRenderingContext2D, left: number, ballColor: string, cx: number, cy: number, radius: number): void {
  const fs = 0.62 * radius;
  // (in the ball's colour of the moment, like the rule under it: the middle turns with every bounce)
  ctx.globalAlpha = BACKDROP_ALPHA + 0.08;
  ctx.fillStyle = ballColor;
  ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(left), cx, cy - 0.1 * radius);
  // the rule: ball of this colour → a tile of this colour breaks
  const y = cy + 0.36 * radius;
  const u = 0.065 * radius;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = ballColor;
  ctx.strokeStyle = ballColor;
  ctx.beginPath();
  ctx.arc(cx - 3.2 * u, y, u, 0, TWO_PI);
  ctx.fill();
  ctx.lineWidth = Math.max(2, 0.3 * u);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 1.3 * u, y);
  ctx.lineTo(cx + 0.9 * u, y);
  ctx.moveTo(cx + 0.2 * u, y - 0.6 * u);
  ctx.lineTo(cx + 0.9 * u, y);
  ctx.lineTo(cx + 0.2 * u, y + 0.6 * u);
  ctx.stroke();
  // the tile, split by a crack
  ctx.fillRect(cx + 2 * u, y - 0.7 * u, 1.25 * u, 1.4 * u);
  ctx.fillRect(cx + 3.55 * u, y - 0.7 * u, 1.25 * u, 1.4 * u);
  ctx.lineCap = "butt";
}

/** A halo in the ball's colour of the moment round a Color Match ball (after the ball is drawn). */
export function drawColorMatchHalo(ctx: CanvasRenderingContext2D, x: number, y: number, ballRadius: number, color: string): void {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, 0.3 * ballRadius);
  ctx.beginPath();
  ctx.arc(x, y, ballRadius * 1.9, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ Accumulation */

/** The timer's colour with `ratio` of it left: green with a full timer, yellow at half, red at the end. */
export function timerColor(ratio: number): string {
  const r = clamp01(ratio);
  const red = Math.round(255 * clamp01(2 * (1 - r)));
  const green = Math.round(235 * clamp01(2 * r));
  return `rgb(${red}, ${green}, 90)`;
}

/**
 * Accumulation in the world pass, under the live ball: the timer's digits huge and faint in the middle with the frozen
 * count's line under them, and the frozen balls as ice – a frost burst for FROST_BURST_MS after each froze.
 */
export function drawAccumulationField(
  ctx: CanvasRenderingContext2D,
  frozen: readonly FrozenBall[],
  timerMs: number,
  timerMaxMs: number,
  escaped: boolean,
  frozenLine: string,
  cx: number,
  cy: number,
  radius: number,
  nowMs: number,
): void {
  if (!escaped) drawRingFloor(ctx, cx, cy, radius, FLOOR_COLORS.accumulation);
  ctx.save();
  if (!escaped) {
    const ratio = timerMaxMs > 0 ? clamp01(timerMs / timerMaxMs) : 0;
    const urgent = timerMs < 1000 ? 1 - clamp01(timerMs / 1000) : 0;
    const fs = 0.6 * radius * (1 + 0.1 * urgent * (0.5 + 0.5 * Math.sin(0.03 * nowMs)));
    ctx.globalAlpha = BACKDROP_ALPHA + 0.2 * urgent;
    ctx.fillStyle = timerColor(ratio);
    ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((Math.max(0, timerMs) / 1000).toFixed(1), cx, cy - 0.06 * radius);
    if (frozen.length > 0 && frozenLine) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#bfe6ff";
      ctx.font = `700 ${(0.11 * radius).toFixed(1)}px sans-serif`;
      ctx.fillText(frozenLine, cx, cy + 0.36 * radius);
    }
  }
  const n = frozen.length;
  for (let i = 0; i < n; i++) {
    const f = frozen[i];
    const detail = n - i <= DETAIL_CAP; // the newest ones
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#bfe6ff";
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, 0.18 * f.radius);
    ctx.stroke();
    if (!detail) continue;
    // a glint, top left
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(f.x - 0.32 * f.radius, f.y - 0.32 * f.radius, 0.24 * f.radius, 0, TWO_PI);
    ctx.fill();
    const age = nowMs - f.atMs;
    if (!(age >= 0 && age < FROST_BURST_MS)) continue;
    // the frost burst: a ring and six spikes running outwards
    const k = age / FROST_BURST_MS;
    ctx.globalAlpha = 0.9 * (1 - k);
    ctx.strokeStyle = "#dff3ff";
    ctx.lineWidth = Math.max(1.5, 0.22 * f.radius * (1 - k));
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius * (1.2 + 2.4 * k), 0, TWO_PI);
    ctx.stroke();
    ctx.beginPath();
    for (let j = 0; j < 6; j++) {
      const a = (j * TWO_PI) / 6 + 0.4;
      const r0 = f.radius * (1.1 + 1.2 * k);
      const r1 = f.radius * (1.7 + 2.6 * k);
      ctx.moveTo(f.x + r0 * Math.cos(a), f.y + r0 * Math.sin(a));
      ctx.lineTo(f.x + r1 * Math.cos(a), f.y + r1 * Math.sin(a));
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The timer as a ring round the live ball (after the ball is drawn): what is left of it, clockwise from the top, turning red; it throbs in the last second. */
export function drawAccumulationTimerRing(ctx: CanvasRenderingContext2D, x: number, y: number, ballRadius: number, timerMs: number, timerMaxMs: number, nowMs: number): void {
  const ratio = timerMaxMs > 0 ? clamp01(timerMs / timerMaxMs) : 0;
  if (!(ratio > 0)) return;
  const urgent = timerMs < 1000 ? 0.5 + 0.5 * Math.sin(0.03 * nowMs) : 0;
  const r = ballRadius + Math.max(5, 0.7 * ballRadius);
  ctx.save();
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(2, 0.3 * ballRadius);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = timerColor(ratio);
  ctx.lineWidth = Math.max(3, 0.42 * ballRadius) * (1 + 0.35 * urgent);
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TWO_PI * ratio);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ Classic */

/** Where the rings-left pips go in a square of `side` px from (`sx`, `sy`): the row's origin, a pip's size, the step and the number's size. */
export function ringPipLayout(sx: number, sy: number, side: number, rings: number, inset: number): { x: number; y: number; w: number; h: number; step: number; fs: number } {
  const fs = Math.max(13, 0.05 * side);
  const h = 0.62 * fs;
  // the row never runs past 30 % of the side: more rings, thinner pips
  const room = 0.3 * side - 1.5 * fs;
  const step = Math.min(0.55 * fs, room / Math.max(1, rings));
  return { x: sx + 0.035 * side, y: sy + 0.035 * side + inset, w: Math.max(1.5, 0.62 * step), h, step, fs };
}

/**
 * Classic's rings left, in the HUD pass at full opacity: the number, then one pip per ring (the innermost first) in the
 * ring's own colour – a broken ring's pip is a faint outline. More than PIP_CAP rings: the number alone. Returns the bottom
 * edge of what it drew (the top captions start below it).
 */
export const PIP_CAP = 24;
export function drawRingPips(ctx: CanvasRenderingContext2D, rings: number, escaped: number, colorOf: (index: number) => string, sx: number, sy: number, side: number, inset: number): number {
  if (!(rings > 0)) return 0;
  const lay = ringPipLayout(sx, sy, side, Math.min(rings, PIP_CAP), inset);
  const left = Math.max(0, rings - escaped);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.font = `900 ${lay.fs.toFixed(1)}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, 0.16 * lay.fs);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  const text = String(left);
  const cy = lay.y + lay.fs / 2;
  ctx.strokeText(text, lay.x, cy);
  ctx.fillStyle = left > 0 ? "#ffffff" : "#a3e635";
  ctx.fillText(text, lay.x, cy);
  if (rings <= PIP_CAP) {
    const x0 = lay.x + ctx.measureText(text).width + 0.45 * lay.fs;
    for (let i = 0; i < rings; i++) {
      const x = x0 + i * lay.step;
      const y = cy - lay.h / 2;
      if (i < escaped) {
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, lay.w - 1, lay.h - 1);
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = colorOf(i);
        ctx.fillRect(x, y, lay.w, lay.h);
      }
    }
  }
  ctx.restore();
  return lay.y + lay.fs;
}
