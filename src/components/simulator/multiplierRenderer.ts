import { MULTIPLIER_COLORS, formatDilation, formatMultiplier, type MultiplierView, type PickupKind } from "@/lib/physics/multipliers";
import { OB_BLOCKER, OB_BUMPER, OB_DIVIDER, OB_DOOR, OB_FLOOR, OB_FUNNEL, type GateKind, type MultipliersView } from "@/lib/physics/modes/multipliers";
import { segmentEndpoints, type SegmentEnds } from "@/lib/physics/obstacles";
import type { Ball } from "@/lib/physics/types";

/**
 * Canvas drawing of the stat multipliers (lib/physics/multipliers.ts) and of the multipliers board
 * (lib/physics/modes/multipliers.ts):
 *  - the board, in world space under the camera: side walls, gate rows (a coloured band per slot with its label –
 *    x2, x1.5 SPEED, x1.25 SIZE, x2 DMG, ÷2, RELEASE with the door's countdown – flashing when a ball passes),
 *    dividers, splitter pegs, bumpers, funnels, blockers with their hit points, the HOME zone with its counter;
 *  - hundreds of balls batched: one path per colour, one stroke for all speed streaks and one for the damage rims;
 *  - the pickup orbs of the ring modes (a glowing orb with "x2" and the stat, popping in and fading out);
 *  - the HUD in screen space, inside the square the recorder crops to (so exports have it): stat badges in the top
 *    left – SPEED x16 · SIZE x4 · DMG x8 · BALLS 512 – that pop and glow when they change, a SLOW-MO tag while the
 *    clock is dilated, and the live HOME counter of the board.
 * Nothing is allocated per frame beyond what fillText needs; badge widths are measured once per text change.
 */

export interface MultiplierLabels {
  speed: string;
  size: string;
  damage: string;
  bounce: string;
  gravity: string;
  balls: string;
  release: string;
  home: string;
  slowMo: (factor: string) => string;
}

export const DEFAULT_MULTIPLIER_LABELS: MultiplierLabels = {
  speed: "SPEED",
  size: "SIZE",
  damage: "DMG",
  bounce: "BOUNCE",
  gravity: "GRAV",
  balls: "BALLS",
  release: "RELEASE",
  home: "HOME",
  slowMo: (f) => `SLOW-MO ${f}`,
};

export interface MultiplierRenderOptions {
  /** The canvas' wall colour function (rainbow walls apply), with an optional alpha and angle. */
  wallColor: (index: number, alpha?: number, angle?: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
  showGlow: boolean;
  showTrails: boolean;
  rainbowBall: boolean;
  /** Canvas time (ms) for rainbow hues and pulses. */
  time: number;
}

const TWO_PI = Math.PI * 2;
/** A gate flashes this long after a ball passed (simulation ms), an obstacle glows this long after a hit. */
export const GATE_FLASH_MS = 260;
export const HIT_GLOW_MS = 400;
/** A badge pops (scale) and glows this long after its value changed (simulation ms). */
export const BADGE_POP_MS = 380;
export const BADGE_GLOW_MS = 900;
/** An orb pops in and fades out over these (simulation ms). */
export const ORB_IN_MS = 260;
export const ORB_OUT_MS = 1000;

const GATE_COLORS: Record<GateKind, string> = {
  count: MULTIPLIER_COLORS.balls,
  speed: MULTIPLIER_COLORS.speed,
  size: MULTIPLIER_COLORS.size,
  damage: MULTIPLIER_COLORS.damage,
  reverse: MULTIPLIER_COLORS.reverse,
  release: MULTIPLIER_COLORS.release,
};

/** Text of a gate: x3, x1.5 SPEED, x1.25 SIZE, x2 DMG, ÷2, RELEASE. */
export function gateLabel(kind: GateKind, factor: number, labels: MultiplierLabels): string {
  switch (kind) {
    case "count":
      return `x${factor}`;
    case "speed":
      return `x${factor} ${labels.speed}`;
    case "size":
      return `x${factor} ${labels.size}`;
    case "damage":
      return `x${factor} ${labels.damage}`;
    case "reverse":
      return `÷${factor}`;
    case "release":
      return labels.release;
  }
}

/** Text of an orb's stat word (x2 BALLS, x1.5 SIZE …). */
export function pickupWord(kind: PickupKind, labels: MultiplierLabels): string {
  return labels[kind];
}

const ends: SegmentEnds = { x1: 0, y1: 0, x2: 0, y2: 0 };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, h / 2, w / 2);
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/** Simulation ms since sub-step `tick` of the board (Infinity before the event). */
function agoMs(view: MultipliersView, tick: number): number {
  return tick === -Infinity ? Infinity : (view.tick - tick) * (view.tickMs || 1000 / 240);
}

/**
 * The board, in world space (the caller translated the canvas by −cameraY). Only the rows on screen are drawn.
 * `viewTop` / `viewBottom` are the world y range the canvas shows.
 */
export function drawMultipliersBoard(ctx: CanvasRenderingContext2D, view: MultipliersView, o: MultiplierRenderOptions, labels: MultiplierLabels, viewTop: number, viewBottom: number) {
  const board = view.board;
  if (!board) return;
  const { left, right } = board;
  const bw = right - left;
  const thickness = Math.max(1.5, o.wallThickness);
  ctx.save();
  // Side walls.
  ctx.lineCap = "round";
  ctx.strokeStyle = o.wallColor(0, undefined, 0);
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = thickness + 1;
  ctx.beginPath();
  ctx.moveTo(left, Math.max(viewTop, board.originY - board.side));
  ctx.lineTo(left, Math.min(viewBottom, board.floorY));
  ctx.moveTo(right, Math.max(viewTop, board.originY - board.side));
  ctx.lineTo(right, Math.min(viewBottom, board.floorY));
  ctx.stroke();
  // Gate bands and labels.
  const fs = Math.max(10, 0.036 * board.side);
  const bandH = 0.16 * board.rowGap;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let g = 0; g < board.gates.length; g++) {
    const gate = board.gates[g];
    if (gate.y + bandH < viewTop || gate.y - board.rowGap > viewBottom) continue;
    const color = GATE_COLORS[gate.kind];
    const flash = Math.max(0, 1 - agoMs(view, gate.lastPassTick) / GATE_FLASH_MS);
    const x0 = gate.x0 + 3;
    const w = gate.x1 - gate.x0 - 6;
    ctx.globalAlpha = 0.18 + 0.45 * flash;
    ctx.fillStyle = color;
    ctx.beginPath();
    roundRect(ctx, x0, gate.y - 0.35 * bandH, w, bandH, 5);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, gate.y);
    ctx.lineTo(x0 + w, gate.y);
    ctx.stroke();
    // The label sits inside the band, just under the gate line; a release gate shows its door's next opening.
    let text = gateLabel(gate.kind, gate.factor, labels);
    if (gate.kind === "release" && !gate.open && view.tickMs > 0) {
      const t = (view.tick * view.tickMs) / 1000;
      const left = gate.period - ((((t + gate.phase) % gate.period) + gate.period) % gate.period);
      text = `${text} ${Math.max(0, left).toFixed(1)}s`;
    }
    // Shrunk to fit its slot; an outline instead of a blur keeps it readable and cheap (a blur only while it flashes).
    let size = gate.kind === "count" ? 1.35 * fs : fs;
    ctx.font = `900 ${size.toFixed(1)}px sans-serif`;
    const tw = ctx.measureText(text).width;
    if (tw > w - 6) {
      size *= (w - 6) / tw;
      ctx.font = `900 ${size.toFixed(1)}px sans-serif`;
    }
    const lx = gate.x0 + (gate.x1 - gate.x0) / 2;
    const ly = gate.y + 0.15 * bandH + 0.5 * size;
    ctx.globalAlpha = 1;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 0.18 * size);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.strokeText(text, lx, ly);
    if (flash > 0.05) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 16 * flash;
    }
    ctx.fillStyle = flash > 0.5 ? "#ffffff" : color;
    ctx.fillText(text, lx, ly);
    ctx.shadowBlur = 0;
  }
  // Obstacles.
  for (let i = 0; i < board.obstacles.length; i++) {
    const ob = board.obstacles[i];
    const kind = board.kind[i];
    const reach = ob.kind === "circle" ? ob.radius : ob.halfLength + ob.thickness;
    if (ob.y + reach < viewTop || ob.y - reach > viewBottom) continue;
    const enabled = board.enabled[i] === 1;
    const glow = o.showWallGlow ? Math.max(0, 1 - agoMs(view, board.hitTick[i]) / HIT_GLOW_MS) : 0;
    const angle = (((ob.x - left) / Math.max(1, bw)) * TWO_PI) % TWO_PI;
    if (ob.kind === "circle") {
      const bumper = kind === OB_BUMPER;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = bumper ? MULTIPLIER_COLORS.bounce : o.wallColor(i, undefined, angle);
      if (glow > 0.02) {
        ctx.shadowColor = bumper ? MULTIPLIER_COLORS.bounce : o.wallColor(i, undefined, angle);
        ctx.shadowBlur = 18 * glow;
      }
      ctx.beginPath();
      ctx.arc(ob.x, ob.y, ob.radius * (1 + 0.25 * glow), 0, TWO_PI);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (bumper) {
        ctx.strokeStyle = "#ffffff";
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ob.x, ob.y, 0.55 * ob.radius, 0, TWO_PI);
        ctx.stroke();
      }
      continue;
    }
    segmentEndpoints(ob, ends);
    if (kind === OB_DOOR) {
      const gate = board.gates[board.ref[i]];
      ctx.globalAlpha = enabled ? 0.95 : 0.2;
      ctx.strokeStyle = MULTIPLIER_COLORS.release;
      ctx.lineWidth = Math.max(3, ob.thickness);
      ctx.setLineDash(enabled ? [] : [4, 6]);
      ctx.beginPath();
      ctx.moveTo(ends.x1, ends.y1);
      ctx.lineTo(ends.x2, ends.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (gate && gate.open) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = MULTIPLIER_COLORS.release;
        ctx.fillRect(gate.x0, gate.y - board.dividerHeight, gate.x1 - gate.x0, board.dividerHeight);
      }
      continue;
    }
    if (kind === OB_BLOCKER) {
      const blocker = board.blockers[board.ref[i]];
      if (!blocker || blocker.broken) continue;
      const hit = Math.max(0, 1 - agoMs(view, blocker.lastHitTick) / HIT_GLOW_MS);
      const frac = blocker.maxHp > 0 ? blocker.hp / blocker.maxHp : 0;
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = hit > 0.05 ? "#ffffff" : `hsl(${Math.round(10 + 40 * frac)}, 85%, 58%)`;
      ctx.lineWidth = ob.thickness + 2 * hit;
      ctx.shadowColor = "#f87171";
      ctx.shadowBlur = hit > 0.05 ? 16 * hit : 0;
      ctx.beginPath();
      ctx.moveTo(ends.x1, ends.y1);
      ctx.lineTo(ends.x2, ends.y2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Cracks as it wears down, and the hit points.
      if (frac < 1) {
        ctx.strokeStyle = "rgba(10, 10, 10, 0.8)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const cracks = Math.ceil(4 * (1 - frac));
        for (let c = 1; c <= cracks; c++) {
          const t = c / (cracks + 1);
          const x = ends.x1 + (ends.x2 - ends.x1) * t;
          const y = ends.y1 + (ends.y2 - ends.y1) * t;
          ctx.moveTo(x - 2, y - 3);
          ctx.lineTo(x + 1, y);
          ctx.lineTo(x - 1, y + 3);
        }
        ctx.stroke();
      }
      ctx.font = `900 ${Math.max(9, 0.03 * board.side).toFixed(1)}px sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 1;
      ctx.fillText(`${Math.ceil(blocker.hp)}`, ob.x, ob.y - ob.thickness - 0.018 * board.side);
      continue;
    }
    const width = kind === OB_FLOOR ? thickness + 1 : Math.max(ob.thickness, kind === OB_DIVIDER ? 2 : thickness);
    ctx.globalAlpha = kind === OB_FUNNEL ? 0.85 : 0.9;
    ctx.strokeStyle = o.wallColor(i, undefined, angle);
    ctx.lineWidth = width + 3 * glow;
    if (glow > 0.02) {
      ctx.shadowColor = o.wallColor(i, undefined, angle);
      ctx.shadowBlur = 16 * glow;
    }
    ctx.beginPath();
    ctx.moveTo(ends.x1, ends.y1);
    ctx.lineTo(ends.x2, ends.y2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  // HOME zone.
  if (board.homeY < viewBottom) {
    const flash = Math.max(0, 1 - agoMs(view, view.homeTick) / 300);
    const h = board.floorY - board.homeY;
    const grad = ctx.createLinearGradient(0, board.homeY, 0, board.floorY);
    grad.addColorStop(0, `rgba(147, 209, 25, ${(0.08 + 0.25 * flash).toFixed(3)})`);
    grad.addColorStop(1, "rgba(147, 209, 25, 0.35)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.fillRect(left, board.homeY, bw, h);
    ctx.strokeStyle = MULTIPLIER_COLORS.balls;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(left, board.homeY);
    ctx.lineTo(right, board.homeY);
    ctx.stroke();
    ctx.setLineDash([]);
    const hf = Math.max(14, 0.09 * board.side);
    ctx.font = `900 ${hf.toFixed(1)}px sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = MULTIPLIER_COLORS.balls;
    ctx.shadowBlur = 12 + 20 * flash;
    ctx.fillText(`🏠 ${labels.home} ${view.home}`, left + bw / 2, board.homeY + h / 2);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

const colorScratch: string[] = [];
/** Above this many balls the highlights are skipped. */
export const HIGHLIGHT_MAX_BALLS = 150;
/** Most distinct ball colours drawn as separate paths. */
const MAX_COLOR_PATHS = 24;
const RAINBOW_FILLS: string[] = [];
for (let b = 0; b < 12; b++) RAINBOW_FILLS.push(`hsl(${b * 30}, 100%, 60%)`);

/**
 * Every ball of the board in a few paths: bodies by colour (one fill per colour), a highlight, speed streaks for balls
 * with a speed multiplier and a red rim for balls with a damage multiplier (one stroke each), the trails of the first
 * few and a glow while there are not too many.
 */
export function drawMultipliersBalls(ctx: CanvasRenderingContext2D, balls: readonly Ball[], o: MultiplierRenderOptions, viewTop: number, viewBottom: number) {
  const n = balls.length;
  if (n === 0) return;
  ctx.save();
  // Trails of the first few balls.
  if (o.showTrails) {
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < Math.min(n, 24); i++) {
      const b = balls[i];
      const len = b.trail.length;
      if (len < 2) continue;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = Math.min(10, 0.5 * b.radius);
      ctx.beginPath();
      for (let k = 0; k < len; k++) {
        const p = b.trail[(b.trailIndex + k) % len];
        if (k === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }
  // Speed streaks (one stroke for all).
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = MULTIPLIER_COLORS.speed;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let streaks = 0;
  for (let i = 0; i < n; i++) {
    const b = balls[i];
    if (!b.mult || !(b.mult.speed > 1) || b.y + b.radius < viewTop || b.y - b.radius > viewBottom) continue;
    const v = Math.hypot(b.vx, b.vy);
    if (v < 1) continue;
    const len = Math.min(6 * b.radius, b.radius * (1 + Math.log2(b.mult.speed)));
    ctx.moveTo(b.x - (b.vx / v) * b.radius, b.y - (b.vy / v) * b.radius);
    ctx.lineTo(b.x - (b.vx / v) * (b.radius + len), b.y - (b.vy / v) * (b.radius + len));
    streaks++;
  }
  if (streaks > 0) ctx.stroke();
  // Bodies, one path per colour (rainbow balls: twelve hue buckets by index; otherwise the balls' own colours).
  const glow = o.showGlow && n <= 80;
  colorScratch.length = 0;
  if (!o.rainbowBall) {
    for (let i = 0; i < n && colorScratch.length < MAX_COLOR_PATHS; i++) if (!colorScratch.includes(balls[i].color)) colorScratch.push(balls[i].color);
  }
  const paths = o.rainbowBall ? RAINBOW_FILLS.length : colorScratch.length;
  const hueBase = o.time * 0.08;
  ctx.globalAlpha = 1;
  for (let c = 0; c < paths; c++) {
    const fill = o.rainbowBall ? RAINBOW_FILLS[c] : colorScratch[c];
    ctx.fillStyle = fill;
    if (glow) {
      ctx.shadowColor = fill;
      ctx.shadowBlur = 12;
    }
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      if (b.y + b.radius < viewTop || b.y - b.radius > viewBottom) continue;
      if (o.rainbowBall) {
        if (Math.floor((((hueBase + (i * 360) / n) % 360) + 360) % 360 / 30) % 12 !== c) continue;
      } else if (b.color !== fill) {
        // A colour beyond the first MAX_COLOR_PATHS is drawn with the last path.
        if (c !== paths - 1 || colorScratch.includes(b.color)) continue;
      }
      ctx.moveTo(b.x + b.radius, b.y);
      ctx.arc(b.x, b.y, b.radius, 0, TWO_PI);
      any = true;
    }
    if (any) ctx.fill();
  }
  ctx.shadowBlur = 0;
  // Highlights (one path; a crowd skips them – at that size they are specks and would double the fill work).
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.beginPath();
  for (let i = 0; i < (n > HIGHLIGHT_MAX_BALLS ? 0 : n); i++) {
    const b = balls[i];
    if (b.y + b.radius < viewTop || b.y - b.radius > viewBottom) continue;
    const r = 0.35 * b.radius;
    ctx.moveTo(b.x - 0.3 * b.radius + r, b.y - 0.3 * b.radius);
    ctx.arc(b.x - 0.3 * b.radius, b.y - 0.3 * b.radius, r, 0, TWO_PI);
  }
  ctx.fill();
  // Damage rims (one stroke).
  ctx.strokeStyle = MULTIPLIER_COLORS.damage;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  let rims = 0;
  for (let i = 0; i < n; i++) {
    const b = balls[i];
    if (!b.mult || !(b.mult.damage > 1) || b.y + b.radius < viewTop || b.y - b.radius > viewBottom) continue;
    ctx.moveTo(b.x + b.radius + 1.5, b.y);
    ctx.arc(b.x, b.y, b.radius + 1.5, 0, TWO_PI);
    rims++;
  }
  if (rims > 0) ctx.stroke();
  ctx.restore();
}

/** The pickup orbs of a ring mode (world space): a glowing orb in the kind's colour with its factor and stat word. */
export function drawPickupOrbs(ctx: CanvasRenderingContext2D, mv: MultiplierView, nowMs: number, labels: MultiplierLabels, time: number) {
  const orbs = mv.orbs;
  if (orbs.length === 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const orb of orbs) {
    const age = nowMs - orb.bornMs;
    const left = orb.lifeMs - age;
    const pop = age < ORB_IN_MS ? Math.sin((Math.PI / 2) * Math.max(0, age / ORB_IN_MS)) : 1;
    const fade = left < ORB_OUT_MS ? Math.max(0, left / ORB_OUT_MS) : 1;
    const pulse = 1 + 0.07 * Math.sin(time * 0.008 + orb.id);
    const r = orb.radius * pop * pulse;
    if (r <= 0.5) continue;
    const color = MULTIPLIER_COLORS[orb.kind];
    ctx.globalAlpha = 0.9 * fade;
    const grad = ctx.createRadialGradient(orb.x, orb.y, 0.2 * r, orb.x, orb.y, 1.8 * r);
    grad.addColorStop(0, color);
    grad.addColorStop(0.55, `${color}55`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, 1.8 * r, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(10, 10, 12, 0.72)";
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, r, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${(0.62 * r).toFixed(1)}px sans-serif`;
    ctx.fillText(`x${orb.factor}`, orb.x, orb.y - 0.12 * r);
    ctx.fillStyle = color;
    ctx.font = `800 ${(0.3 * r).toFixed(1)}px sans-serif`;
    ctx.fillText(pickupWord(orb.kind, labels), orb.x, orb.y + 0.42 * r);
  }
  ctx.restore();
}

/** The badges of the HUD, in the order they are shown. */
const BADGES = [
  ["speed", MULTIPLIER_COLORS.speed],
  ["size", MULTIPLIER_COLORS.size],
  ["damage", MULTIPLIER_COLORS.damage],
  ["bounce", MULTIPLIER_COLORS.bounce],
  ["gravity", MULTIPLIER_COLORS.gravity],
  ["balls", MULTIPLIER_COLORS.balls],
] as const;

/** A screen rectangle the HUD keeps clear of (the teams' scoreboard). */
export interface HudRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(x: number, y: number, w: number, h: number, r: HudRect | null | undefined): boolean {
  return !!r && x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;
}

/**
 * The HUD (screen space) inside the square `x0, y0, side` the recorder crops to: the stat badges in its top left,
 * SLOW-MO in its top right, and – on the multipliers board – the live HOME counter at its bottom. `nowMs` is the
 * simulation time the badge pops are measured on (a pause freezes them); `board` says the multipliers board is up.
 * `avoid` is the teams' scoreboard in a top corner of the same square: in the badges' corner (top left) the badges start
 * below it, in the other one a badge that would run into it wraps to the next row and SLOW-MO moves below it. Returns
 * the screen y of the first badge row (−1 while no badge shows), which the canvas mirrors for the smoke test.
 */
export function drawMultiplierHud(ctx: CanvasRenderingContext2D, mv: MultiplierView, labels: MultiplierLabels, x0: number, y0: number, side: number, nowMs: number, board: MultipliersView | null, avoid?: HudRect | null): number {
  if (!mv.active) return -1;
  ctx.save();
  const fs = Math.max(11, 0.034 * side);
  const pad = 0.025 * side;
  const h = 1.6 * fs;
  const gap = 0.4 * fs;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let x = x0 + pad;
  let y = y0 + pad;
  // The teams' scoreboard in the badges' own corner: they start below it (in the export as live).
  if (avoid && avoid.x < x0 + side / 2) y = Math.max(y, avoid.y + avoid.h + gap);
  let firstY = -1;
  for (const [key, color] of BADGES) {
    const value = key === "balls" ? mv.balls : mv[key];
    const changed = mv.changedAt[key];
    const shown = key === "balls" ? mv.balls > 1 || changed > -Infinity || board !== null : value !== 1 || changed > -Infinity;
    if (!shown) continue;
    const text = key === "balls" ? `${labels.balls} ${value}` : `${labels[key]} ${formatMultiplier(value)}`;
    const age = nowMs - changed;
    const pop = age >= 0 && age < BADGE_POP_MS ? 1 + 0.2 * (1 - age / BADGE_POP_MS) * (1 - age / BADGE_POP_MS) : 1;
    const glow = age >= 0 && age < BADGE_GLOW_MS ? 1 - age / BADGE_GLOW_MS : 0;
    ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    const w = ctx.measureText(text).width + 1.2 * fs;
    if (x + w > x0 + side - pad && x > x0 + pad) {
      x = x0 + pad;
      y += h + gap;
    }
    // Clear of the scoreboard in the other corner: wrap before it (or, at the start of a row, go below it).
    for (let guard = 0; guard < 8 && overlaps(x, y, w, h, avoid); guard++) {
      if (x > x0 + pad) {
        x = x0 + pad;
        y += h + gap;
      } else y = avoid!.y + avoid!.h + gap;
    }
    if (firstY < 0) firstY = y;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(pop, pop);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(8, 8, 10, 0.7)";
    ctx.beginPath();
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (glow > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 22 * glow;
    }
    ctx.stroke();
    ctx.fillStyle = glow > 0.4 ? "#ffffff" : color;
    ctx.fillText(text, -w / 2 + 0.6 * fs, 0);
    ctx.restore();
    x += w + gap;
  }
  // SLOW-MO while the clock is dilated (below the scoreboard when that takes the top right).
  if (mv.dilation < 1) {
    const text = labels.slowMo(formatDilation(mv.dilation));
    ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    const w = ctx.measureText(text).width + 1.2 * fs;
    const sx = x0 + side - pad - w;
    const sy = overlaps(sx, y0 + pad, w, h, avoid) ? avoid!.y + avoid!.h + gap : y0 + pad;
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(nowMs * 0.01);
    ctx.fillStyle = "rgba(8, 8, 10, 0.7)";
    ctx.beginPath();
    roundRect(ctx, sx, sy, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = MULTIPLIER_COLORS.release;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = MULTIPLIER_COLORS.release;
    ctx.fillText(text, sx + 0.6 * fs, sy + h / 2);
  }
  // The live HOME counter of the board, in the bottom-left corner – until the HOME zone itself (which shows the count) is on screen.
  if (board && board.board && board.board.homeY - board.cameraY > y0 + side - 0.12 * side) {
    const big = Math.max(16, 0.06 * side);
    const flash = Math.max(0, 1 - agoMs(board, board.homeTick) / 300);
    const text = `🏠 ${board.home}`;
    ctx.globalAlpha = 1;
    ctx.font = `900 ${big.toFixed(1)}px sans-serif`;
    const w = ctx.measureText(text).width + big;
    const hh = 1.5 * big;
    const bx = x0 + pad;
    const by = y0 + side - pad - hh;
    ctx.save();
    ctx.translate(bx + w / 2, by + hh / 2);
    ctx.scale(1 + 0.12 * flash, 1 + 0.12 * flash);
    ctx.fillStyle = "rgba(8, 8, 10, 0.72)";
    ctx.beginPath();
    roundRect(ctx, -w / 2, -hh / 2, w, hh, hh / 2);
    ctx.fill();
    ctx.strokeStyle = MULTIPLIER_COLORS.balls;
    ctx.lineWidth = 2;
    if (flash > 0) {
      ctx.shadowColor = MULTIPLIER_COLORS.balls;
      ctx.shadowBlur = 18 * flash;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return firstY;
}

/** Mirrors the multiplier state onto the canvas element (data-mult-*) through `set` (which only writes changes) for tools and the smoke test. */
export function writeMultiplierDataset(mv: MultiplierView, board: MultipliersView | null, set: (key: string, value: string) => void) {
  set("multSpeed", String(mv.speed));
  set("multSize", String(mv.size));
  set("multDamage", String(mv.damage));
  set("multBounce", String(mv.bounce));
  set("multGravity", String(mv.gravity));
  set("multBalls", String(mv.balls));
  set("multPickups", String(mv.pickupsTaken));
  set("multOrbs", String(mv.orbs.length));
  set("multSmashes", String(mv.smashes + mv.bursts));
  set("multSlowmo", String(mv.dilation));
  set("multOutgrew", mv.outgrown ? "1" : "0");
  if (board) {
    set("multHome", String(board.home));
    set("multActive", String(board.active));
    set("multClones", String(board.clones));
    set("multGates", String(board.gatePasses));
    set("multDone", board.done ? "1" : "0");
  }
}

/** Every data-mult-* key `writeMultiplierDataset()` – and the canvas, for the HUD's first badge row (multHudTop) – may write (to clear them when multipliers are off). */
export const MULTIPLIER_DATA_KEYS = ["multSpeed", "multSize", "multDamage", "multBounce", "multGravity", "multBalls", "multPickups", "multOrbs", "multSmashes", "multSlowmo", "multOutgrew", "multHome", "multActive", "multClones", "multGates", "multDone", "multHudTop"];
