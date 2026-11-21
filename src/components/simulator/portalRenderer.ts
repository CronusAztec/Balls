import type { Portal, PortalJump } from "@/lib/physics/modes/portal";

/**
 * --- portal-charges --- Canvas drawing of the Portal mode (lib/physics/modes/portal.ts), moved out of Canvas.tsx and made to read
 * at phone size:
 *  - every portal's two mouths as a thick glowing arc on the rim with a pulsing swirl inside it in the pair's colour, so the twins
 *    read as a pair across the ring (a faint line ties them);
 *  - its charges: CHARGE pips inside each mouth, one going out with every jump (a white pop as it does), the spent ones hollow;
 *  - a jump: a short bright beam from the mouth the ball went into to its twin, and a ring bursting from the exit (the ball's
 *    trail is broken at the jump by the mode, so no streak crosses the ring);
 *  - a burn-out: the mouths crumble into shards that fall and fade where the exit opens;
 *  - after the escape: the ring ghosted with its open exits and its last portals, under the end card.
 * The mouths keep the size the mode tests (its half width); only the drawing is bigger. Everything from the run's own clock (the
 * engine's elapsed ms, the jump's and the burn-outs' times), so every export draws the same frame for the same moment.
 */

export interface PortalRenderOptions {
  cx: number;
  cy: number;
  /** The ring's radius. */
  radius: number;
  /** The engine's elapsed ms. */
  nowMs: number;
  wallThickness: number;
}

/** A mouth's swirl: its radius as a share of the ring radius, its pulse and spin. */
export const SWIRL_SHARE = 0.13;
const PULSE_HZ = 1.4;
const SPIN_PER_SEC = 2.6;
/** How long a jump's beam and a pip's pop last, and how long a burnt-out portal crumbles (ms). */
export const BEAM_MS = 280;
export const PIP_POP_MS = 320;
export const CRUMBLE_MS = 800;
/** Shards a crumbling mouth throws. */
const SHARDS = 9;
const TWO_PI = Math.PI * 2;

/** Where a mouth at `angle` has its swirl's centre (just inside the rim) and its radius. */
function swirlAt(o: PortalRenderOptions, angle: number) {
  const s = SWIRL_SHARE * o.radius;
  const r = o.radius - 1.15 * s;
  return { x: o.cx + r * Math.cos(angle), y: o.cy + r * Math.sin(angle), s };
}

/** One mouth: its arc on the rim, its swirl and its charge pips. */
function drawMouth(ctx: CanvasRenderingContext2D, p: Portal, angle: number, phase: number, jump: PortalJump, o: PortalRenderOptions) {
  const t = o.nowMs / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(TWO_PI * PULSE_HZ * t + phase);
  const { x, y, s } = swirlAt(o, angle);
  // the swirl: a soft disc in the pair's colour and three arms turning
  ctx.save();
  ctx.globalAlpha = 0.28 + 0.14 * pulse;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(x, y, s * (0.92 + 0.1 * pulse), 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(1.5, 0.12 * s);
  ctx.lineCap = "round";
  const spin = SPIN_PER_SEC * t + phase;
  for (let k = 0; k < 3; k++) {
    const a0 = spin + (k * TWO_PI) / 3;
    ctx.beginPath();
    ctx.arc(x, y, 0.62 * s, a0, a0 + 1.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x, y, 0.16 * s, 0, TWO_PI);
  ctx.fill();
  // the mouth on the rim: a thick glowing arc
  const a0 = angle - p.halfWidth;
  const a1 = angle + p.halfWidth;
  ctx.globalAlpha = 0.35 + 0.25 * pulse;
  ctx.lineWidth = Math.max(10, 0.09 * o.radius);
  ctx.beginPath();
  ctx.arc(o.cx, o.cy, o.radius, a0, a1);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(5, 0.045 * o.radius);
  ctx.beginPath();
  ctx.arc(o.cx, o.cy, o.radius, a0, a1);
  ctx.stroke();
  // the charges: pips in a row across the mouth, inside the swirl
  const left = Math.max(0, p.maxUses - p.uses);
  const pr = Math.max(2.5, 0.024 * o.radius);
  const rr = o.radius - 2.55 * s;
  const popAge = jump.portal === p.id ? o.nowMs - jump.ms : Infinity;
  for (let i = 0; i < p.maxUses; i++) {
    const pa = angle + (i - (p.maxUses - 1) / 2) * ((1.35 * pr * 2) / rr);
    const px = o.cx + rr * Math.cos(pa);
    const py = o.cy + rr * Math.sin(pa);
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TWO_PI);
    if (i < left) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = p.color;
      ctx.stroke();
      // the pip that just went out pops white
      if (i === left && popAge >= 0 && popAge < PIP_POP_MS) {
        const k = 1 - popAge / PIP_POP_MS;
        ctx.globalAlpha = k;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px, py, pr * (1 + 1.2 * (1 - k)), 0, TWO_PI);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** A burnt-out mouth crumbling: its arc fading and shards falling inward, by the burn-out's age. */
function drawCrumble(ctx: CanvasRenderingContext2D, p: Portal, angle: number, age: number, o: PortalRenderOptions) {
  const k = age / CRUMBLE_MS;
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(5, 0.045 * o.radius) * (1 - 0.6 * k);
  ctx.beginPath();
  ctx.arc(o.cx, o.cy, o.radius, angle - p.halfWidth, angle + p.halfWidth);
  ctx.stroke();
  ctx.fillStyle = p.color;
  const size = Math.max(2.5, 0.03 * o.radius);
  for (let i = 0; i < SHARDS; i++) {
    // each shard from its own place along the mouth, falling inward and turning (fixed by its index: the same every replay)
    const along = angle + (i / (SHARDS - 1) - 0.5) * 2 * p.halfWidth;
    const fall = (0.04 + 0.03 * ((i * 7) % 5)) * o.radius * (k + 1.5 * k * k);
    const r = o.radius - fall;
    const x = o.cx + r * Math.cos(along) + 0.02 * o.radius * Math.sin(i * 2.3) * k;
    const y = o.cy + r * Math.sin(along);
    const spin = (i % 2 === 0 ? 1 : -1) * 6 * k + i;
    ctx.beginPath();
    ctx.moveTo(x + size * Math.cos(spin), y + size * Math.sin(spin));
    ctx.lineTo(x + size * Math.cos(spin + 2.3), y + size * Math.sin(spin + 2.3));
    ctx.lineTo(x + 0.6 * size * Math.cos(spin + 4.2), y + 0.6 * size * Math.sin(spin + 4.2));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The portals of a ring still standing: the live pairs, a jump's beam, the burnt-out ones crumbling. Inside the camera transform. */
export function drawPortals(ctx: CanvasRenderingContext2D, portals: readonly Portal[], jump: PortalJump, o: PortalRenderOptions) {
  for (const p of portals) {
    if (p.exhausted) {
      const age = o.nowMs - p.burnMs;
      if (age >= 0 && age < CRUMBLE_MS) {
        drawCrumble(ctx, p, p.angleA, age, o);
        drawCrumble(ctx, p, p.angleB, age, o);
      }
      continue;
    }
    // the twins' tie: a faint line between the swirls
    const a = swirlAt(o, p.angleA);
    const b = swirlAt(o, p.angleB);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    drawMouth(ctx, p, p.angleA, p.id * 1.7, jump, o);
    drawMouth(ctx, p, p.angleB, p.id * 1.7 + Math.PI, jump, o);
  }
  // the jump: a bright beam from the mouth the ball went into to its twin, and a ring bursting at the exit
  const age = o.nowMs - jump.ms;
  if (jump.portal >= 0 && age >= 0 && age < BEAM_MS) {
    const p = portals[jump.portal];
    const k = 1 - age / BEAM_MS;
    const from = swirlAt(o, jump.fromAngle);
    const to = swirlAt(o, jump.toAngle);
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.5 * k;
    ctx.strokeStyle = p ? p.color : "#ffffff";
    ctx.lineWidth = 3 + 9 * k;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalAlpha = k;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1 + 2.5 * k;
    ctx.stroke();
    ctx.globalAlpha = k;
    ctx.strokeStyle = p ? p.color : "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(to.x, to.y, to.s * (0.8 + 1.4 * (1 - k)), 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }
}

/** After the escape: the ring ghosted with the exits the burnt-out portals left open, and the portals still standing, faint. */
export function drawPortalGhost(ctx: CanvasRenderingContext2D, portals: readonly Portal[], o: PortalRenderOptions, wallColor: string) {
  const gaps: [number, number][] = [];
  for (const p of portals) {
    if (!p.exhausted) continue;
    gaps.push([p.angleA - p.halfWidth, p.angleA + p.halfWidth], [p.angleB - p.halfWidth, p.angleB + p.halfWidth]);
  }
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = wallColor;
  ctx.lineWidth = Math.max(2, o.wallThickness);
  // the ring as arcs between the open exits (sorted round the circle)
  const norm = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
  const sorted = gaps.map(([a, b]) => [norm(a), norm(a) + (b - a)] as [number, number]).sort((x, y) => x[0] - y[0]);
  if (sorted.length === 0) {
    ctx.beginPath();
    ctx.arc(o.cx, o.cy, o.radius, 0, TWO_PI);
    ctx.stroke();
  } else {
    for (let i = 0; i < sorted.length; i++) {
      const end = sorted[i][1];
      const next = i + 1 < sorted.length ? sorted[i + 1][0] : sorted[0][0] + TWO_PI;
      if (next <= end) continue;
      ctx.beginPath();
      ctx.arc(o.cx, o.cy, o.radius, end, next);
      ctx.stroke();
    }
  }
  for (const p of portals) {
    if (p.exhausted) continue;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(5, 0.045 * o.radius);
    for (const a of [p.angleA, p.angleB]) {
      ctx.beginPath();
      ctx.arc(o.cx, o.cy, o.radius, a - p.halfWidth, a + p.halfWidth);
      ctx.stroke();
    }
  }
  ctx.restore();
}
