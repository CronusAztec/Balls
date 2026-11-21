import type { ShatterSegment, ShatterView } from "@/lib/physics/modes/shatter";

/*
 * --- shatter-demolition --- Shatter's demolition as a stranger reads it (lib/physics/modes/shatter.ts): a chipped segment
 * flashes white and stays cracked from every hit it took, a segment that breaks bursts into shards of its colour, and once the
 * ball is out every segment still standing falls apart, ring by ring from the inside out, before the banner. Draw only: read
 * from the mode's state and the simulation clock (a segment's hitMs and brokenMs, the escape's time), every random-looking
 * choice hashed from the segment's place – the live canvas, the fast export and the Windows app's render queue draw the same
 * frame for the same moment. Canvas.tsx draws the standing segments themselves (its batching, colours and wobble) and calls
 * these over them.
 */

const TWO_PI = Math.PI * 2;
/** How long a chip's white flash lasts (simulation ms). */
export const CHIP_FLASH_MS = 160;
/** How long a broken segment's shards fly (simulation ms). */
export const SHARD_MS = 700;
/** Shards a breaking segment throws, and a collapsing one. */
export const SHARDS_PER_BREAK = 6;
export const SHARDS_PER_FALL = 4;
/** Detail (cracks, flashes, shards) only while the run has at most this many rings: past it the plain segments. */
export const DETAIL_RINGS = 48;
/** At most this many segments' shards a frame (the newest first is not needed: a run breaks a few a second). */
export const SHARD_SEGMENT_CAP = 64;

/** The share of a segment's angle left open between it and the next, drawn (the physics' segments touch): bricks, not dashes. */
export const SHATTER_INSET = 0.12;

/**
 * The band a ring's segments are drawn in (px): at least the walls' own thickness + 4 (6 at least), and up to 0.42 of the
 * spacing between two rings, so six rings read as a thick wall of bricks; a thousand rings stay thin.
 */
export function shatterBand(walls: readonly { radius: number }[], wallThickness: number): number {
  const spacing = walls.length > 1 ? walls[1].radius - walls[0].radius : 0;
  return Math.max(6, wallThickness + 4, 0.42 * spacing);
}

/** A number in [0, 1) from three integers: the same segment and hit always crack, burst and fall the same way. */
export function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263) ^ Math.imul(c + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** When ring `ring` starts to fall (simulation ms), or Infinity while the ball is inside. */
export function ringFallStartMs(view: Readonly<ShatterView>, ring: number): number {
  return view.escapedMs >= 0 ? view.escapedMs + ring * view.staggerMs : Infinity;
}

/** True once every ring has fallen: the banner's moment – the mode's own word, so the banner comes with the run's last step. */
export function collapseDone(view: Readonly<ShatterView>): boolean {
  return view.escapedMs >= 0 && view.collapsed;
}

/** The sector of a segment: its angles inset as Canvas.tsx draws it, and its band. */
function sector(seg: ShatterSegment, rotation: number, radius: number, thickness: number) {
  const inset = (seg.endAngle - seg.startAngle) * SHATTER_INSET;
  const a0 = seg.startAngle + rotation + inset / 2;
  const a1 = seg.endAngle + rotation - inset / 2;
  return { a0, a1, rIn: radius - thickness / 2, rOut: radius + thickness / 2 };
}

function sectorPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number): void {
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a0) * rOut, cy + Math.sin(a0) * rOut);
  ctx.arc(cx, cy, rOut, a0, a1);
  ctx.lineTo(cx + Math.cos(a1) * rIn, cy + Math.sin(a1) * rIn);
  ctx.arc(cx, cy, Math.max(0, rIn), a1, a0, true);
  ctx.closePath();
}

/**
 * The damage on the standing segments, over Canvas.tsx's fill: a chipped one darker for every hit it took and cracked from
 * each hit's point – a jagged line across the band with a branch, dark with a light edge – and a white flash for
 * CHIP_FLASH_MS after its last chip. Nothing for an undamaged segment (most of them: one pass over the segments, no path).
 */
export function drawShatterDamage(
  ctx: CanvasRenderingContext2D,
  segments: readonly (readonly ShatterSegment[])[],
  walls: readonly { radius: number }[],
  rotations: readonly number[],
  thickness: number,
  cx: number,
  cy: number,
  nowMs: number,
  view: Readonly<ShatterView>,
): void {
  if (segments.length > DETAIL_RINGS) return;
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let w = 0; w < segments.length; w++) {
    const radius = walls[w]?.radius ?? 0;
    if (!(radius > 0) || nowMs >= ringFallStartMs(view, w)) continue;
    const rot = rotations[w] || 0;
    for (const seg of segments[w]) {
      if (seg.hp <= 0 || seg.hitAngles.length === 0) continue;
      const { a0, a1, rIn, rOut } = sector(seg, rot, radius, thickness);
      const damage = Math.min(1, (seg.maxHp - seg.hp) / Math.max(1, seg.maxHp));
      // darker for the hits it took
      ctx.globalAlpha = 0.18 + 0.3 * damage;
      ctx.fillStyle = "#000000";
      sectorPath(ctx, cx, cy, rIn, rOut, a0, a1);
      ctx.fill();
      // a crack from every hit's point
      const n = Math.min(seg.hitAngles.length, 5);
      for (let k = 0; k < n; k++) {
        const a = Math.min(a1, Math.max(a0, seg.hitAngles[k] + rot));
        const span = a1 - a0;
        const jag = (j: number) => (hash01(w, seg.segmentIndex, 10 * k + j) - 0.5) * span * 0.5;
        const x = (r: number, ang: number) => cx + Math.cos(ang) * r;
        const y = (r: number, ang: number) => cy + Math.sin(ang) * r;
        const rMid = (rIn + rOut) / 2;
        ctx.beginPath();
        ctx.moveTo(x(rIn, a + jag(0)), y(rIn, a + jag(0)));
        ctx.lineTo(x(rMid, a + jag(1)), y(rMid, a + jag(1)));
        ctx.lineTo(x(rOut, a + jag(2)), y(rOut, a + jag(2)));
        ctx.moveTo(x(rMid, a + jag(1)), y(rMid, a + jag(1)));
        ctx.lineTo(x(rMid + (rOut - rMid) * 0.4, a + jag(3) * 1.6), y(rMid + (rOut - rMid) * 0.4, a + jag(3) * 1.6));
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
        ctx.lineWidth = Math.max(1.5, 0.22 * thickness);
        ctx.stroke();
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(0.75, 0.08 * thickness);
        ctx.stroke();
      }
      // the chip's flash
      const age = nowMs - seg.hitMs;
      if (seg.hitMs >= 0 && age >= 0 && age < CHIP_FLASH_MS) {
        ctx.globalAlpha = 0.75 * (1 - age / CHIP_FLASH_MS);
        ctx.fillStyle = "#ffffff";
        sectorPath(ctx, cx, cy, rIn - 1, rOut + 1, a0, a1);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** One shard: a small triangle of `color` at (x, y), turned by `spin`, `size` px, `alpha` strong. */
function shard(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, spin: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(spin) * size, y + Math.sin(spin) * size);
  ctx.lineTo(x + Math.cos(spin + 2.3) * size * 0.6, y + Math.sin(spin + 2.3) * size * 0.6);
  ctx.lineTo(x + Math.cos(spin + 4.1) * size * 0.8, y + Math.sin(spin + 4.1) * size * 0.8);
  ctx.closePath();
  ctx.fill();
}

/**
 * The shards and the collapse, over the rings: a segment that broke less than SHARD_MS ago bursts into SHARDS_PER_BREAK shards
 * of its colour flying out from where it stood, slowing and fading; and once the ball is out, every segment still standing
 * falls apart when its ring's turn comes (inside out): it slides outwards, thins and fades over the fall, throwing
 * SHARDS_PER_FALL shards. `colorOf(ring, angle)` is the wall's colour there (the canvas' own, rainbow or plain).
 */
export function drawShatterShards(
  ctx: CanvasRenderingContext2D,
  segments: readonly (readonly ShatterSegment[])[],
  walls: readonly { radius: number }[],
  rotations: readonly number[],
  thickness: number,
  cx: number,
  cy: number,
  nowMs: number,
  view: Readonly<ShatterView>,
  colorOf: (ring: number, angle: number) => string,
): void {
  if (segments.length > DETAIL_RINGS) return;
  const size = Math.max(3, 0.9 * thickness);
  let bursts = 0;
  ctx.save();
  ctx.shadowBlur = 0;
  for (let w = 0; w < segments.length; w++) {
    const radius = walls[w]?.radius ?? 0;
    if (!(radius > 0)) continue;
    const rot = rotations[w] || 0;
    const fallAge = nowMs - ringFallStartMs(view, w);
    for (const seg of segments[w]) {
      const mid = (seg.startAngle + seg.endAngle) / 2 + rot;
      const color = colorOf(w, mid);
      if (seg.hp <= 0) {
        // the burst of a break
        const age = nowMs - seg.brokenMs;
        if (seg.brokenMs < 0 || age < 0 || age >= SHARD_MS || bursts >= SHARD_SEGMENT_CAP) continue;
        bursts++;
        const k = age / SHARD_MS;
        const travel = (1 - (1 - k) * (1 - k)) * 0.22 * radius + 0.04 * radius;
        for (let i = 0; i < SHARDS_PER_BREAK; i++) {
          const dir = mid + (hash01(w, seg.segmentIndex, i) - 0.5) * 1.3;
          const out = hash01(w, seg.segmentIndex, 50 + i) < 0.7 ? 1 : -0.6; // most fly out, some fall inwards
          const r = radius + out * travel * (0.6 + 0.8 * hash01(w, seg.segmentIndex, 100 + i));
          shard(ctx, cx + Math.cos(dir) * r, cy + Math.sin(dir) * r, size * (0.6 + 0.6 * hash01(w, seg.segmentIndex, 150 + i)), 7 * k + 6 * hash01(w, seg.segmentIndex, 200 + i), color, 0.95 * (1 - k));
        }
        continue;
      }
      if (!(fallAge >= 0)) continue;
      // the collapse: the segment slides out, thins and fades, throwing shards
      const k = Math.min(1, fallAge / Math.max(1, view.fallMs));
      if (k >= 1) continue;
      const slide = (0.05 + 0.3 * k * k) * radius;
      const band = thickness * (1 - 0.7 * k);
      const { a0, a1 } = sector(seg, rot + 0.25 * k * (hash01(w, seg.segmentIndex, 300) - 0.5), radius, thickness);
      ctx.globalAlpha = 0.9 * (1 - k);
      ctx.fillStyle = color;
      sectorPath(ctx, cx, cy, radius + slide - band / 2, radius + slide + band / 2, a0, a1);
      ctx.fill();
      for (let i = 0; i < SHARDS_PER_FALL; i++) {
        const dir = mid + (hash01(w, seg.segmentIndex, 400 + i) - 0.5) * (a1 - a0) * 1.4;
        const r = radius + slide * (1.2 + 1.6 * hash01(w, seg.segmentIndex, 450 + i));
        shard(ctx, cx + Math.cos(dir) * r, cy + Math.sin(dir) * r, size * 0.8, 9 * k + 6 * hash01(w, seg.segmentIndex, 500 + i), color, 0.9 * (1 - k));
      }
    }
    // the ring's flash as it gives way
    if (fallAge >= 0 && fallAge < 0.5 * view.fallMs) {
      const k = fallAge / (0.5 * view.fallMs);
      ctx.globalAlpha = 0.55 * (1 - k);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(2, thickness * (1 - k));
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (1 + 0.12 * k), 0, TWO_PI);
      ctx.stroke();
    }
  }
  ctx.restore();
}
