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
 * (D3 review: the arena was 93 % dark, a hairline ring round an empty middle) Also:
 *  - the ring itself drawn at RING_CORE_SHARE of its radius in its own colours with a soft glow, its exits open (`drawPortalRing()`);
 *  - a wash inside the ring in the colour of the pair used last, swelling at each jump from the mouth the ball came out of and
 *    settling over WASH_SWELL_MS (`drawPortalWash()`), so the middle is never an empty black disc;
 *  - the last pair still standing pulsing once the others have burnt out: the way out is through it.
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
  // --- portal-fill --- (D3 review)
  /** The ring's gaps (the exits of the burnt-out pairs, as the mode lays them out) and the style it is stroked in (the page's wall colours). */
  gaps?: readonly { startAngle: number; endAngle: number }[];
  ringStyle?: string | CanvasGradient;
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
// --- portal-fill --- (D3 review)
/** The ring's core line and its two glow layers, as shares of its radius, and the glow layers' opacity. */
export const RING_CORE_SHARE = 0.02;
const RING_GLOW = [
  { share: 0.11, alpha: 0.07 },
  { share: 0.055, alpha: 0.2 },
] as const;
/** The wash inside the ring: its opacity at the centre and at the rim, what a jump adds to them, and how long the swell lasts (ms). */
export const WASH_CENTRE = 0.06;
export const WASH_RIM = 0.17;
const WASH_SWELL_CENTRE = 0.1;
const WASH_SWELL_RIM = 0.2;
export const WASH_SWELL_MS = 1000;
/** The wash's colour before the first jump: the mode's own violet. */
const WASH_IDLE = "#6c5ce7";
/** The last pair's pulse (Hz) and its halo round each mouth (a share of the swirl). */
const LAST_PULSE_HZ = 2.4;
const LAST_HALO = 1.55;

/** "#rrggbb" (or "#rgb") at `alpha` as rgba(); anything else as it is. */
export function portalRgba(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${a.toFixed(3)})`;
}

/** How far a jump's swell still is (1 at the jump, 0 from WASH_SWELL_MS on), eased out. */
export function washSwell(jump: PortalJump, nowMs: number): number {
  const age = nowMs - jump.ms;
  if (jump.portal < 0 || !(age >= 0) || age >= WASH_SWELL_MS) return 0;
  const k = 1 - age / WASH_SWELL_MS;
  return k * k;
}

/** The pair still standing when every other pair has burnt out (−1 while two or more stand, or with a single pair from the start). */
export function lastLivePair(portals: readonly Portal[]): number {
  if (portals.length < 2) return -1;
  let live = -1;
  for (const p of portals) {
    if (p.exhausted) continue;
    if (live >= 0) return -1;
    live = p.id;
  }
  return live;
}

/**
 * The wash inside the ring: a radial gradient in the colour of the pair used last, faint at the centre and brighter at the rim,
 * and at a jump a swell of that colour spreading from the mouth the ball came out of over WASH_SWELL_MS. Under the portals and the
 * ball; two gradients a frame.
 */
export function drawPortalWash(ctx: CanvasRenderingContext2D, portals: readonly Portal[], jump: PortalJump, o: PortalRenderOptions) {
  const used = jump.portal >= 0 ? portals[jump.portal] : undefined;
  const color = used ? used.color : WASH_IDLE;
  const swell = washSwell(jump, o.nowMs);
  ctx.save();
  const g = ctx.createRadialGradient(o.cx, o.cy, 0, o.cx, o.cy, o.radius);
  g.addColorStop(0, portalRgba(color, WASH_CENTRE + WASH_SWELL_CENTRE * swell));
  g.addColorStop(1, portalRgba(color, WASH_RIM + WASH_SWELL_RIM * swell));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(o.cx, o.cy, o.radius, 0, TWO_PI);
  ctx.fill();
  if (swell > 0) {
    // the swell: a bright front spreading across the ring from the exit
    const exit = swirlAt(o, jump.toAngle);
    const reach = o.radius * (0.35 + 1.75 * (1 - Math.sqrt(swell)));
    const b = ctx.createRadialGradient(exit.x, exit.y, 0, exit.x, exit.y, reach);
    b.addColorStop(0, portalRgba(color, 0.32 * swell));
    b.addColorStop(0.7, portalRgba(color, 0.14 * swell));
    b.addColorStop(1, portalRgba(color, 0));
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.arc(o.cx, o.cy, o.radius, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** Adds the ring's standing arcs (between its gaps) to the current path; a ring without gaps as one whole circle. */
function traceRing(ctx: CanvasRenderingContext2D, o: PortalRenderOptions, radius: number) {
  const gaps = o.gaps ?? [];
  if (gaps.length === 0) {
    // from 0 to 2π exactly: an arc from a turned start to a turned start + 2π can stroke nothing in Chromium (ringArc.ts)
    ctx.moveTo(o.cx + radius, o.cy);
    ctx.arc(o.cx, o.cy, radius, 0, TWO_PI);
    return;
  }
  // the mode's gaps start in [0, 2π), sorted; a last one across 0 ends above 2π
  const wrap = Math.max(0, gaps[gaps.length - 1].endAngle - TWO_PI);
  let cursor = wrap;
  for (const gap of gaps) {
    if (gap.startAngle > cursor) {
      ctx.moveTo(o.cx + radius * Math.cos(cursor), o.cy + radius * Math.sin(cursor));
      ctx.arc(o.cx, o.cy, radius, cursor, gap.startAngle);
    }
    cursor = Math.max(cursor, gap.endAngle);
  }
  if (cursor < TWO_PI + wrap) {
    ctx.moveTo(o.cx + radius * Math.cos(cursor), o.cy + radius * Math.sin(cursor));
    ctx.arc(o.cx, o.cy, radius, cursor, TWO_PI + wrap);
  }
}

/** The ring: a core line of RING_CORE_SHARE of its radius in its own colours under two soft glow layers, its exits open. */
export function drawPortalRing(ctx: CanvasRenderingContext2D, o: PortalRenderOptions) {
  ctx.save();
  ctx.strokeStyle = o.ringStyle ?? "#ffffff";
  ctx.lineCap = "butt";
  ctx.beginPath();
  traceRing(ctx, o, o.radius);
  for (const layer of RING_GLOW) {
    ctx.globalAlpha = layer.alpha;
    ctx.lineWidth = Math.max(4, layer.share * o.radius);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(o.wallThickness, RING_CORE_SHARE * o.radius);
  ctx.stroke();
  ctx.restore();
}

/** The last pair standing: a halo pulsing round both mouths and their tie drawn bright, so the eye knows where the way out is. */
function drawLastPair(ctx: CanvasRenderingContext2D, p: Portal, o: PortalRenderOptions) {
  const pulse = 0.5 + 0.5 * Math.sin(TWO_PI * LAST_PULSE_HZ * (o.nowMs / 1000));
  const a = swirlAt(o, p.angleA);
  const b = swirlAt(o, p.angleB);
  ctx.save();
  ctx.strokeStyle = p.color;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.25 + 0.3 * pulse;
  ctx.lineWidth = 2 + 2 * pulse;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  for (const m of [a, b]) {
    ctx.globalAlpha = 0.18 + 0.22 * pulse;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.s * (LAST_HALO + 0.35 * pulse), 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 0.5 + 0.4 * pulse;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.s * (LAST_HALO + 0.35 * pulse), 0, TWO_PI);
    ctx.stroke();
  }
  ctx.restore();
}
// --- end portal-fill ---

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

/**
 * The portals of a ring still standing: the wash and the glowing ring under them (--- portal-fill ---), the live pairs (the last
 * one pulsing), a jump's beam, the burnt-out ones crumbling. Inside the camera transform.
 */
export function drawPortals(ctx: CanvasRenderingContext2D, portals: readonly Portal[], jump: PortalJump, o: PortalRenderOptions) {
  drawPortalWash(ctx, portals, jump, o); // --- portal-fill ---
  drawPortalRing(ctx, o);
  const last = lastLivePair(portals);
  if (last >= 0) drawLastPair(ctx, portals[last], o);
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
export function drawPortalGhost(ctx: CanvasRenderingContext2D, portals: readonly Portal[], o: PortalRenderOptions, wallColor: string, jump?: PortalJump) {
  if (jump) drawPortalWash(ctx, portals, jump, o); // --- portal-fill --- (the colour of the last jump stays under the end card)
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
