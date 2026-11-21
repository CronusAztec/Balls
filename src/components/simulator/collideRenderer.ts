import { HUE_BUCKETS, SQUASH_MS, squashAt, squashScaleAcross, squashScaleAlong, type CollideView } from "@/lib/physics/modes/collide";
import type { Ball } from "@/lib/physics/types";
import type { WobbleLayer } from "./wobbleRenderer";

/**
 * Canvas drawing of the Collision Playground mode (lib/physics/modes/collide.ts): the container (a circle or a
 * square, glowing for a moment after a hit), the orbs – or, on the ring, the lollipops (a stick from the centre
 * to each disc) around a faint track – with short motion streaks, an optional glow, a sparkle on every impact,
 * the squash-and-stretch of squishy orbs and, after the anti-collision switch, the colour change (complementary
 * hues, translucent and additive, so orbs passing through each other light up) with a flash and a caption.
 *
 * Hundreds of orbs at 60 fps: the orbs are coloured by size, so they fall into `HUE_BUCKETS` colours and each
 * colour is one path filled once (arcs appended with moveTo, no per-orb state change); only squashing orbs are
 * drawn one by one as ellipses. The fill strings are cached per bucket, and nothing else is allocated per frame.
 * Called from Canvas.tsx inside the camera transform (arena, bodies) and outside it (the overlay).
 */

export interface CollideRenderOptions {
  /** The canvas' wall colour function (rainbow walls apply), with an optional alpha. */
  wallColor: (index: number, alpha?: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
  showGlow: boolean;
  showTrails: boolean;
  trailThickness: number;
}

const TWO_PI = Math.PI * 2;
/** How long the container glows after a hit (simulation ms). */
export const WALL_GLOW_MS = 300;
/** How long an orb sparkles after an impact (simulation ms). */
export const IMPACT_FLASH_MS = 110;
/** The colour change of the anti-collision switch takes this long (simulation ms). */
export const ANTI_FADE_MS = 450;
/** The screen flash of the switch (simulation ms). */
export const ANTI_FLASH_MS = 380;
/** How long the caption of the switch stays up (simulation ms). */
export const ANTI_LABEL_MS = 2200;
/** Steps back the motion streak of an orb reaches (the engine keeps the last 20 positions). */
const TRAIL_POINTS = 5;
/** Above this many orbs the streaks are skipped (they would cost more than they show). */
export const TRAIL_MAX_BODIES = 600;
// --- collide-pour ---
/** A spark on an impact at least this fast (× the Ball Speed), for this long (simulation ms), at most this many a frame. */
export const SPARK_SPEED = 0.9;
export const SPARK_MS = 160;
export const SPARK_MAX = 48;
/** An orb faster than this (× the Ball Speed) glows white-hot at its core. */
export const HOT_SPEED = 1.15;
/** The opening's edges (warm light) and the orbs-left count behind the orbs (its alpha, its size as a share of the square). */
const POUR_EDGE = "#ffd166";
export const POUR_COUNT_ALPHA = 0.32;
/** The open jar's light: its alpha full and empty. */
export const POUR_GLOW_FROM = 0.04;
export const POUR_GLOW_TO = 0.2;
/** (D2 review) The count's size as a share of the jar's radius (it was 0.3 of the square: the whole picture of an empty jar). */
export const POUR_COUNT_SIZE = 0.62;
/** (D2 review) Once the jar opens, the ghosts turn back into their solid size colours over this long (simulation ms): the pour reads as a sweep from the small hues to the big ones. */
export const POUR_SOLID_MS = 500;
// --- end collide-pour ---

/**
 * How far the orbs are turned into ghosts (0 = their size colours drawn solid, 1 = the complementary ghosts drawn additive): up
 * over ANTI_FADE_MS after the anti-collision switch – --- collide-pour --- (D2 review) and back down over POUR_SOLID_MS once the jar
 * opens: an additive pile at its bottom was one white band, and the pour reads as a sweep from the small hues to the big ones.
 */
export function ghostBlend(view: CollideView): number {
  let blend = view.antiActive ? Math.min(1, ticksAgoMs(view, view.antiTick) / ANTI_FADE_MS) : 0;
  if (blend > 0 && view.pourActive) blend *= Math.max(0, 1 - ticksAgoMs(view, view.pourTick) / POUR_SOLID_MS);
  return blend;
}

/** Simulation ms since sub-step `tick` (Infinity before the event). */
export function ticksAgoMs(view: CollideView, tick: number): number {
  return tick === -Infinity ? Infinity : (view.tick - tick) * view.tickMs;
}

/** Centre hue of a bucket (degrees). */
export function bucketHue(bucket: number): number {
  return (bucket + 0.5) * (360 / HUE_BUCKETS);
}

const solidFills: string[] = [];
const ghostFills: string[] = [];
for (let b = 0; b < HUE_BUCKETS; b++) {
  const h = bucketHue(b);
  solidFills.push(`hsl(${Math.round(h)}, 85%, 60%)`);
  ghostFills.push(`hsla(${Math.round((h + 180) % 360)}, 95%, 68%, 0.6)`);
}

/**
 * Fill of bucket `b` at anti-collision blend `blend` (0 = the normal colours, 1 = the complementary ghosts; the
 * hue sweeps through the wheel in between). Only the fade builds strings; the end states are cached.
 */
export function bucketFill(bucket: number, blend: number): string {
  if (blend <= 0) return solidFills[bucket];
  if (blend >= 1) return ghostFills[bucket];
  const h = (bucketHue(bucket) + 180 * blend) % 360;
  return `hsla(${Math.round(h)}, ${Math.round(85 + 10 * blend)}%, ${Math.round(60 + 8 * blend)}%, ${(1 - 0.4 * blend).toFixed(2)})`;
}

/** The container (or, for the ring, the track and the hub), glowing briefly after a hit. */
export function drawCollideArena(ctx: CanvasRenderingContext2D, view: CollideView, o: CollideRenderOptions, wobble?: WobbleLayer) {
  const f = view.field;
  if (!f) return;
  const thickness = Math.max(1.5, o.wallThickness);
  ctx.save();
  if (view.settings.ring) {
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, 0.75 * thickness);
    ctx.strokeStyle = o.wallColor(0, 0.3);
    ctx.beginPath();
    ctx.arc(f.cx, f.cy, view.ringRadius, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const path = () => {
    ctx.beginPath();
    // The circle container is wall 0 of the Wobbly Walls: it bulges where an orb hits it (a plain circle while still).
    if (f.kind === "circle") {
      if (wobble) wobble.traceCircle(ctx, 0, f.cx, f.cy, f.radius);
      else ctx.arc(f.cx, f.cy, f.radius, 0, TWO_PI);
    } else {
      const r = Math.min(10, 0.03 * f.side);
      const x = f.left;
      const y = f.top;
      const w = f.right - f.left;
      const h = f.bottom - f.top;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  };
  // --- collide-pour --- the open jar: the orbs left, big and faint behind them, and the rim with its opening, edges lit
  if (view.pourActive) {
    drawPourCount(ctx, view, o);
    drawOpenJar(ctx, view, o, thickness);
    ctx.restore();
    return;
  }
  const age = ticksAgoMs(view, view.lastWallHitTick);
  if (o.showWallGlow && age < WALL_GLOW_MS) {
    const strength = 1 - age / WALL_GLOW_MS;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = o.wallColor(0, 0.25 * strength);
    ctx.lineWidth = thickness + 10 * strength;
    path();
    ctx.stroke();
  }
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = thickness;
  ctx.strokeStyle = o.wallColor(0);
  path();
  ctx.stroke();
  ctx.restore();
}

// --- collide-pour ---
/** The orbs still in the jar, a big faint number in its middle (behind the orbs). */
function drawPourCount(ctx: CanvasRenderingContext2D, view: CollideView, o: CollideRenderOptions) {
  const f = view.field;
  if (!f) return;
  ctx.save();
  // the jar lights up in its colour as it empties
  const poured = view.count > 0 ? 1 - Math.max(0, view.left) / view.count : 1;
  ctx.globalAlpha = POUR_GLOW_FROM + (POUR_GLOW_TO - POUR_GLOW_FROM) * poured;
  ctx.fillStyle = o.wallColor(0);
  ctx.beginPath();
  if (f.kind === "circle") ctx.arc(f.cx, f.cy, f.radius, 0, TWO_PI);
  else ctx.rect(f.left, f.top, f.right - f.left, f.bottom - f.top);
  ctx.fill();
  // (D2 review) the empty jar shows no 0 above the EMPTY! banner: its light alone
  if (!view.empty && view.left > 0) {
    ctx.globalAlpha = POUR_COUNT_ALPHA;
    ctx.fillStyle = o.wallColor(0);
    ctx.font = `900 ${Math.round(POUR_COUNT_SIZE * f.radius)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(view.left), f.cx, f.cy);
  }
  ctx.restore();
}

/** The jar with its opening at the bottom (a circle's arc or a box with a slot in its floor) and the opening's lit edges. */
function drawOpenJar(ctx: CanvasRenderingContext2D, view: CollideView, o: CollideRenderOptions, thickness: number) {
  const f = view.field;
  if (!f) return;
  const half = Math.max(0, view.gapHalf);
  let lx: number;
  let rx: number;
  let ey: number;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = thickness;
  ctx.strokeStyle = o.wallColor(0);
  ctx.beginPath();
  if (f.kind === "circle") {
    const phi = Math.asin(Math.min(1, half / Math.max(1e-6, f.radius)));
    ctx.arc(f.cx, f.cy, f.radius, Math.PI / 2 + phi, Math.PI / 2 - phi + TWO_PI);
    lx = f.cx - f.radius * Math.sin(phi);
    rx = f.cx + f.radius * Math.sin(phi);
    ey = f.cy + f.radius * Math.cos(phi);
  } else {
    lx = Math.max(f.left, f.cx - half);
    rx = Math.min(f.right, f.cx + half);
    ey = f.bottom;
    ctx.moveTo(lx, f.bottom);
    ctx.lineTo(f.left, f.bottom);
    ctx.lineTo(f.left, f.top);
    ctx.lineTo(f.right, f.top);
    ctx.lineTo(f.right, f.bottom);
    ctx.lineTo(rx, f.bottom);
  }
  ctx.stroke();
  // (D2 review) the opening's lit edges big enough to read at phone size, with a halo
  const cap = Math.max(4, 2.4 * thickness);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = POUR_EDGE;
  ctx.beginPath();
  ctx.moveTo(lx + 2 * cap, ey);
  ctx.arc(lx, ey, 2 * cap, 0, TWO_PI);
  ctx.moveTo(rx + 2 * cap, ey);
  ctx.arc(rx, ey, 2 * cap, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(lx + cap, ey);
  ctx.arc(lx, ey, cap, 0, TWO_PI);
  ctx.moveTo(rx + cap, ey);
  ctx.arc(rx, ey, cap, 0, TWO_PI);
  ctx.fill();
}
// --- end collide-pour ---

/** The orbs (or lollipops): streaks, sticks, glow, bodies by colour, squashed orbs, impact sparkles. */
export function drawCollideBodies(ctx: CanvasRenderingContext2D, balls: Ball[], view: CollideView, o: CollideRenderOptions) {
  const n = view.count;
  const f = view.field;
  if (n === 0 || !f) return;
  const first = view.firstId;
  const order = view.bucketOrder;
  const start = view.bucketStart;
  const ring = view.settings.ring;
  const squishy = view.settings.squishy;
  const blend = ghostBlend(view);
  const tick = view.tick;
  const tickMs = view.tickMs;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Motion streaks: a line from a few steps back to every orb, one stroke per colour.
  if (o.showTrails && !ring && n <= TRAIL_MAX_BODIES) {
    ctx.globalAlpha = 0.26;
    for (let b = 0; b < HUE_BUCKETS; b++) {
      let width = 0;
      let count = 0;
      ctx.beginPath();
      for (let p = start[b]; p < start[b + 1]; p++) {
        const k = order[p];
        const ball = balls[k];
        if (!ball || ball.id !== first + k) continue;
        const trail = ball.trail;
        const len = trail.length;
        if (len < 2) continue;
        // One straight streak from where the orb was a few steps ago: a motion blur that costs a single segment.
        const pt = trail[(ball.trailIndex + Math.max(0, len - TRAIL_POINTS)) % len];
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(ball.x, ball.y);
        width += ball.radius;
        count++;
      }
      if (count === 0) continue;
      ctx.lineWidth = Math.max(1, (width / count) * o.trailThickness);
      ctx.strokeStyle = bucketFill(b, blend);
      ctx.stroke();
    }
  }

  // Lollipop sticks from the centre to every disc.
  if (ring) {
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, 0.35 * o.wallThickness + 0.6);
    for (let b = 0; b < HUE_BUCKETS; b++) {
      if (start[b] === start[b + 1]) continue;
      ctx.beginPath();
      for (let p = start[b]; p < start[b + 1]; p++) {
        const k = order[p];
        const ball = balls[k];
        if (!ball || ball.id !== first + k) continue;
        ctx.moveTo(f.cx, f.cy);
        ctx.lineTo(ball.x, ball.y);
      }
      ctx.strokeStyle = bucketFill(b, blend);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = o.wallColor(0);
    ctx.beginPath();
    ctx.arc(f.cx, f.cy, Math.max(3, 0.018 * f.side), 0, TWO_PI);
    ctx.fill();
  }

  // Glow: a soft, wider disc behind every orb.
  if (o.showGlow) {
    ctx.globalAlpha = 0.18;
    for (let b = 0; b < HUE_BUCKETS; b++) {
      if (start[b] === start[b + 1]) continue;
      ctx.beginPath();
      for (let p = start[b]; p < start[b + 1]; p++) {
        const k = order[p];
        const ball = balls[k];
        if (!ball || ball.id !== first + k) continue;
        const r = 1.9 * ball.radius;
        ctx.moveTo(ball.x + r, ball.y);
        ctx.arc(ball.x, ball.y, r, 0, TWO_PI);
      }
      ctx.fillStyle = bucketFill(b, blend);
      ctx.fill();
    }
  }

  // Bodies: one path per colour; after the anti-collision switch they add up where they overlap.
  ctx.globalAlpha = 1;
  if (blend > 0) ctx.globalCompositeOperation = "lighter";
  for (let b = 0; b < HUE_BUCKETS; b++) {
    if (start[b] === start[b + 1]) continue;
    ctx.beginPath();
    let squashing = false;
    for (let p = start[b]; p < start[b + 1]; p++) {
      const k = order[p];
      const ball = balls[k];
      if (!ball || ball.id !== first + k) continue;
      if (squishy && (tick - view.impactTick[k]) * tickMs < SQUASH_MS) {
        squashing = true;
        continue;
      }
      ctx.moveTo(ball.x + ball.radius, ball.y);
      ctx.arc(ball.x, ball.y, ball.radius, 0, TWO_PI);
    }
    const fill = bucketFill(b, blend);
    ctx.fillStyle = fill;
    ctx.fill();
    if (!squashing) continue;
    // Squishy orbs caught in an impact: flattened along the contact normal, bulging across it.
    for (let p = start[b]; p < start[b + 1]; p++) {
      const k = order[p];
      const ball = balls[k];
      if (!ball || ball.id !== first + k) continue;
      const age = (tick - view.impactTick[k]) * tickMs;
      if (!(age < SQUASH_MS)) continue;
      const squash = squashAt(view.impactAmount[k], age);
      ctx.beginPath();
      if (squash > 0.004) ctx.ellipse(ball.x, ball.y, ball.radius * squashScaleAlong(squash), ball.radius * squashScaleAcross(squash), Math.atan2(view.impactNy[k], view.impactNx[k]), 0, TWO_PI);
      else ctx.arc(ball.x, ball.y, ball.radius, 0, TWO_PI);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = "source-over";

  // Impact sparkles: a bright core on every orb that was just hit, one path for all of them.
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  let sparkles = 0;
  for (let k = 0; k < n; k++) {
    const age = (tick - view.impactTick[k]) * tickMs;
    if (!(age < IMPACT_FLASH_MS)) continue;
    const ball = balls[k];
    if (!ball || ball.id !== first + k) continue;
    const r = ball.radius * 0.55 * (1 - age / IMPACT_FLASH_MS);
    if (r < 0.3) continue;
    ctx.moveTo(ball.x + r, ball.y);
    ctx.arc(ball.x, ball.y, r, 0, TWO_PI);
    sparkles++;
  }
  if (sparkles > 0) ctx.fill();
  // --- collide-pour --- white-hot cores on the fastest orbs, and sparks on the hardest contacts (a few dozen a frame at most)
  const hot2 = (HOT_SPEED * view.ballSpeed) ** 2;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  let hot = 0;
  for (let k = 0; k < n; k++) {
    const ball = balls[k];
    if (!ball || ball.id !== first + k) continue;
    if (ball.vx * ball.vx + ball.vy * ball.vy < hot2) continue;
    const r = 0.45 * ball.radius;
    ctx.moveTo(ball.x + r, ball.y);
    ctx.arc(ball.x, ball.y, r, 0, TWO_PI);
    hot++;
  }
  if (hot > 0) ctx.fill();
  const sparkSpeed = SPARK_SPEED * view.ballSpeed;
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = "#fff6d5";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let sparks = 0;
  for (let k = 0; k < n && sparks < SPARK_MAX; k++) {
    const age = (tick - view.impactTick[k]) * tickMs;
    if (!(age < SPARK_MS) || !(view.impactSpeed[k] >= sparkSpeed)) continue;
    const ball = balls[k];
    if (!ball || ball.id !== first + k) continue;
    const a = Math.atan2(view.impactNy[k], view.impactNx[k]);
    const r0 = 1.15 * ball.radius;
    const r1 = r0 + (0.4 + 0.9 * (1 - age / SPARK_MS)) * ball.radius;
    for (let q = 0; q < 4; q++) {
      const c = Math.cos(a + (q * Math.PI) / 2);
      const s = Math.sin(a + (q * Math.PI) / 2);
      ctx.moveTo(ball.x + c * r0, ball.y + s * r0);
      ctx.lineTo(ball.x + c * r1, ball.y + s * r1);
    }
    sparks++;
  }
  if (sparks > 0) ctx.stroke();
  ctx.restore();
}

/** Screen space, after the camera: the flash and the caption of the anti-collision switch. */
export function drawCollideOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, view: CollideView, caption: string) {
  if (!view.antiActive) return;
  const age = ticksAgoMs(view, view.antiTick);
  if (!(age >= 0)) return;
  ctx.save();
  if (age < ANTI_FLASH_MS) {
    ctx.fillStyle = `rgba(147, 209, 25, ${(0.28 * (1 - age / ANTI_FLASH_MS)).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (caption && age < ANTI_LABEL_MS) {
    const alpha = age < 200 ? age / 200 : age > ANTI_LABEL_MS - 600 ? (ANTI_LABEL_MS - age) / 600 : 1;
    const fs = Math.max(18, 0.07 * Math.min(width, height));
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `900 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#93d119";
    ctx.shadowBlur = 18;
    ctx.fillText(caption, width / 2, height / 2);
  }
  ctx.restore();
}
