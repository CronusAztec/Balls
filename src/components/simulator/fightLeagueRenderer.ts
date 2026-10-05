import {
  EV_BLINK,
  EV_BLOCK,
  EV_CAST,
  EV_CLASH,
  EV_CUT,
  EV_DAMAGE,
  EV_FREEZE,
  EV_GRAZE,
  EV_HEAL,
  EV_HIT,
  EV_KO,
  EV_LIGHTNING,
  EV_POP,
  EV_SHOCK,
  FL_ARENA_FRAC,
  FL_ARENA_TOP,
  FL_EVENT_CAP,
  PK_HAMMER,
  PK_SHIELD,
  PK_SPEAR,
  punchExtension,
  type FightLeagueView,
  type FlFighter,
  type FlWeaponState,
} from "@/lib/physics/modes/fightLeague";
import type { FlShape } from "@/lib/physics/modes/fightLeagueRoster";

/**
 * Canvas drawing of Fight League (feature fight-league, see lib/physics/modes/fightLeague.ts). Created once with the canvas
 * loop:
 *
 * - `drawStage()` (inside the camera transform, under everything): the light square (or circle) arena with its dark rim,
 *   the bullet-time tint;
 * - `drawBodies()` (in place of the balls, clipped to the arena): fire rings, the telegraphs of arena cuts and fused
 *   shockwaves, beams, decoys and summons, every fighter's weapon as a vector sprite (canvas paths, cached per fighter,
 *   weapon and size – no image assets), the bodies with their status looks (hit flash, invulnerability, freeze, holds,
 *   webs, confusion, buffs, the ability's telegraph), the HP number inside and the HP bar under the ball, the projectiles,
 *   then the effects of the event ring – floating damage numbers, hit sparks, blocks, lightning, shockwaves, cuts, blinks,
 *   heals, pops, freezes and the KO blasts;
 * - `drawOverlay()` (screen space, after the HUD, part of the recording): the names top left / top right in the fighters'
 *   colours (stacked for three or four), the time left, the "VS" card of the first 1.5 s and "FIGHT!", the ability boxes
 *   along the bottom (the meter, the ability's name flashing through its telegraph, two stat lines per fighter), the "KO"
 *   flash and the winner banner ("Thor wins!", DRAW, DOUBLE KO) with confetti – in 2v2 with a Teams roster the teams
 *   layer's banner takes over.
 *
 * Everything is timed by the simulation clock of the view, so effects freeze with a pause and replay in recordings; the
 * shards and the confetti are analytic (hashed from their index). A steady frame allocates nothing but a few strings: the
 * sprites are built once per fighter, weapon and size, the fonts once per size.
 */

export interface FightLeagueLabels {
  /** The intro card's "VS". */
  vs: string;
  /** Flashed when the fighters launch. */
  fight: string;
  /** The callout over a knocked-out fighter and the KO flash. */
  ko: string;
  doubleKo: string;
  /** "[name] wins!" (a fighter) and "[names] win!" (a 2v2 team). */
  wins: (name: string) => string;
  winTeam: (names: string) => string;
  draw: string;
  /** The time cap decided it. */
  time: string;
  /** Under the banner: the winner's HP left and hits landed. */
  winSub: (hp: number, hits: number) => string;
  /** The stat lines' words: speed, damage, attack speed, cast speed. */
  speed: string;
  damage: string;
  attack: string;
  cast: string;
  /** The meter is full (waiting for a target). */
  ready: string;
  /** --- fl-overhaul --- The time cap with two sides standing: sudden death in a shrinking arena. */
  sudden: string;
}

export const DEFAULT_FIGHT_LEAGUE_LABELS: FightLeagueLabels = {
  vs: "VS",
  fight: "FIGHT!",
  ko: "KO!",
  doubleKo: "DOUBLE KO!",
  wins: (name) => `${name} wins!`,
  winTeam: (names) => `${names} win!`,
  draw: "DRAW!",
  time: "TIME!",
  winSub: (hp, hits) => `${hp} HP left · ${hits} hit${hits === 1 ? "" : "s"}`,
  speed: "SPD",
  damage: "DMG",
  attack: "ATK",
  cast: "CAST",
  ready: "READY",
  sudden: "SUDDEN DEATH!",
};

export interface FightLeagueRenderOptions {
  /** Device pixels per CSS pixel: the sprites are rasterised at it. */
  dpr: number;
  /** The HP number inside the balls (off while ball faces cover them). */
  numbers: boolean;
  /** 2v2: the two teams' colours (the Teams roster's), drawn as a ring around their fighters; null: the built-in pair. */
  teamColors: readonly string[] | null;
  /** The teams layer draws the winner banner (2v2 with a roster): this layer leaves it out. */
  teamBanner: boolean;
  labels: FightLeagueLabels;
}

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
const GOLD = "#facc15";
const INK = "#0b0b0f";
const FLOOR = "#f1f5f9";
const FLOOR_LINE = "#e2e8f0";
const RIM = "#0f172a";
const TEAM_COLORS = ["#f43f5e", "#38bdf8"];
const NUMBER_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
/** Simulation ms the effects last. */
const HIT_FLASH_MS = 130;
const DAMAGE_MS = 750;
const SPARK_MS = 200;
const KO_MS = 1200;
const KO_FLASH_MS = 700;
const LIGHTNING_MS = 380;
const SHOCK_MS = 420;
const CUT_MS = 320;
const BLINK_MS = 320;
const CAST_MS = 900;
const HEAL_MS = 800;
const POP_MS = 320;
const FREEZE_MS = 420;
const FIGHT_FLASH_MS = 650;
const SHARDS = 12;
const CONFETTI = 90;
/** Sprites kept at most (a run needs a few per fighter; a resize builds new ones). */
const SPRITE_CAP = 400;
/** The HP numbers and damage numbers as strings, built once ("0"…"999", "-0"…"-999"). */
const HP_TEXT: readonly string[] = Array.from({ length: 1000 }, (_, i) => String(i));
const DMG_TEXT: readonly string[] = Array.from({ length: 1000 }, (_, i) => `-${i}`);

/** A stable pseudo-random number in [0, 1) for index `i` and salt `s` (analytic shards, sparks and confetti). */
function hash(i: number, s: number): number {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function hexRgb(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (0–1) of "#rrggbb"; anything else counts as light. */
function luminance(color: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return 1;
  const c = hexRgb(color).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** "#rrggbb" lightened (k > 0) or darkened (k < 0) by |k| toward white / black. */
function shade(color: string, k: number): string {
  const [r, g, b] = hexRgb(color);
  const t = k >= 0 ? 255 : 0;
  const a = Math.abs(k);
  const mix = (v: number) => Math.round(v + (t - v) * a);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** The colour a fighter's name is written in on the dark HUD: its body colour, its accent when the body is too dark, else white. */
export function flNameColor(body: string, accent: string): string {
  if (luminance(body) >= 0.06) return body;
  if (luminance(accent) >= 0.06) return accent;
  return "#f4f4f5";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
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

/** A sprite: a raster of a vector drawing in a local frame (+x = the weapon's direction), and that frame's bounds (CSS px). */
interface Sprite {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** Bounds of a drawing in its local frame (CSS px). */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The colours a fighter's sprites use. */
interface Paint {
  body: string;
  accent: string;
  /** The weapon's own colour (a blade, a glow, a projectile), else the accent. */
  color: string;
}

/* ------------------------------------------------------------------ vector drawings (local frame, +x forward) */

function bladePath(g: CanvasRenderingContext2D, x0: number, x1: number, hw: number) {
  g.beginPath();
  g.moveTo(x0, -hw);
  g.lineTo(x1 - 2.2 * hw, -hw);
  g.lineTo(x1, 0);
  g.lineTo(x1 - 2.2 * hw, hw);
  g.lineTo(x0, hw);
  g.closePath();
}

/** A sword from the grip inside the ball to the tip `reach` radii past the rim (glow: a lightsaber). */
function drawSword(g: CanvasRenderingContext2D, r: number, reach: number, size: number, glow: boolean, p: Paint) {
  const tip = r + reach * r;
  const hw = Math.max(0.6, 0.5 * size * r);
  if (glow) {
    // The emitter hilt, then the blade: a colour glow around a white core.
    g.fillStyle = "#9ca3af";
    g.strokeStyle = INK;
    g.lineWidth = Math.max(0.8, 0.05 * r);
    g.fillRect(0.55 * r, -0.13 * r, 0.5 * r, 0.26 * r);
    g.strokeRect(0.55 * r, -0.13 * r, 0.5 * r, 0.26 * r);
    g.fillStyle = INK;
    g.fillRect(0.68 * r, -0.13 * r, 0.06 * r, 0.26 * r);
    g.fillRect(0.84 * r, -0.13 * r, 0.06 * r, 0.26 * r);
    g.lineCap = "round";
    g.shadowColor = p.color;
    g.shadowBlur = 0.9 * r;
    g.strokeStyle = p.color;
    g.lineWidth = 2.4 * hw;
    g.beginPath();
    g.moveTo(1.08 * r, 0);
    g.lineTo(tip - hw, 0);
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = "#ffffff";
    g.lineWidth = 1.1 * hw;
    g.stroke();
    return;
  }
  // Grip and pommel, the crossguard in the accent colour, then the blade with its fuller.
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.fillStyle = shade(p.body, -0.45);
  g.fillRect(0.55 * r, -0.08 * r, 0.42 * r, 0.16 * r);
  g.strokeRect(0.55 * r, -0.08 * r, 0.42 * r, 0.16 * r);
  g.fillStyle = p.accent;
  g.beginPath();
  g.arc(0.55 * r, 0, 0.1 * r, 0, TWO_PI);
  g.fill();
  g.stroke();
  const guard = Math.max(hw * 2.4, 0.42 * r);
  g.fillRect(0.95 * r, -guard, 0.13 * r, 2 * guard);
  g.strokeRect(0.95 * r, -guard, 0.13 * r, 2 * guard);
  g.fillStyle = p.color;
  bladePath(g, 1.08 * r, tip, hw);
  g.fill();
  g.stroke();
  g.strokeStyle = "rgba(255, 255, 255, 0.65)";
  g.lineWidth = Math.max(0.6, 0.25 * hw);
  g.beginPath();
  g.moveTo(1.15 * r, 0);
  g.lineTo(tip - 2.6 * hw, 0);
  g.stroke();
}

function swordBox(r: number, reach: number, size: number, glow: boolean): Box {
  const hw = Math.max(0.6, 0.5 * size * r);
  const pad = glow ? 1.1 * r : Math.max(hw * 2.4, 0.42 * r) + 2;
  return { x0: 0.4 * r, y0: -pad, x1: r + reach * r + (glow ? 1.1 * r : 2), y1: pad };
}

/** A hammer's head: a block centred on the origin (`size` radii), banded in the accent colour, its handle along −x. */
function drawHammerHead(g: CanvasRenderingContext2D, r: number, size: number, p: Paint, handle: number) {
  const hs = size * r;
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  if (handle > 0) {
    g.fillStyle = "#7c5a3c";
    g.fillRect(-handle, -0.07 * r, handle, 0.14 * r);
    g.strokeRect(-handle, -0.07 * r, handle, 0.14 * r);
  }
  g.fillStyle = "#9ca3af";
  roundRect(g, -0.7 * hs, -1.05 * hs, 1.4 * hs, 2.1 * hs, 0.18 * hs);
  g.fill();
  g.stroke();
  g.fillStyle = "#d1d5db";
  g.fillRect(-0.7 * hs + 1, -1.05 * hs + 1, 0.45 * hs, 2.1 * hs - 2);
  g.fillStyle = p.accent;
  g.fillRect(-0.7 * hs, -0.42 * hs, 1.4 * hs, 0.18 * hs);
  g.fillRect(-0.7 * hs, 0.24 * hs, 1.4 * hs, 0.18 * hs);
}

/** A spiked ball / kunai / blade head on a chain (the chain itself is drawn live). */
function drawChainHead(g: CanvasRenderingContext2D, r: number, size: number, shape: FlShape, p: Paint) {
  const hs = size * r;
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  if (shape === "blades") {
    // A curved blade (the blades on chains).
    g.fillStyle = p.color;
    g.beginPath();
    g.moveTo(-0.9 * hs, -0.25 * hs);
    g.quadraticCurveTo(0.6 * hs, -1.1 * hs, 1.5 * hs, 0);
    g.quadraticCurveTo(0.6 * hs, -0.3 * hs, -0.9 * hs, 0.35 * hs);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#7f1d1d";
    g.fillRect(-1.3 * hs, -0.18 * hs, 0.5 * hs, 0.36 * hs);
    g.strokeRect(-1.3 * hs, -0.18 * hs, 0.5 * hs, 0.36 * hs);
    return;
  }
  // A kunai: a leaf blade and a ring.
  g.fillStyle = "#cbd5e1";
  g.beginPath();
  g.moveTo(1.5 * hs, 0);
  g.lineTo(0.1 * hs, -0.55 * hs);
  g.lineTo(-0.3 * hs, 0);
  g.lineTo(0.1 * hs, 0.55 * hs);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = p.accent === "#111827" ? "#27272a" : INK;
  g.fillRect(-0.95 * hs, -0.14 * hs, 0.7 * hs, 0.28 * hs);
  g.beginPath();
  g.arc(-1.15 * hs, 0, 0.22 * hs, 0, TWO_PI);
  g.strokeStyle = "#e5e7eb";
  g.lineWidth = Math.max(0.8, 0.09 * hs);
  g.stroke();
}

/** A fist (a glove in the accent colour with knuckle lines), a boot, or nothing for an air blast (drawn live). */
function drawFist(g: CanvasRenderingContext2D, r: number, size: number, p: Paint, kick: boolean) {
  const s = size * r;
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.fillStyle = p.accent;
  if (kick) {
    // A boot: the sole forward.
    g.beginPath();
    g.moveTo(-0.9 * s, -0.55 * s);
    g.lineTo(0.35 * s, -0.55 * s);
    g.quadraticCurveTo(1.05 * s, -0.5 * s, 1.05 * s, 0.1 * s);
    g.lineTo(1.05 * s, 0.6 * s);
    g.lineTo(-0.9 * s, 0.6 * s);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#f8fafc";
    g.fillRect(-0.9 * s, 0.32 * s, 1.95 * s, 0.28 * s);
    return;
  }
  g.beginPath();
  g.arc(0, 0, s, 0, TWO_PI);
  g.fill();
  g.stroke();
  g.strokeStyle = "rgba(0, 0, 0, 0.45)";
  g.lineWidth = Math.max(0.6, 0.08 * s);
  for (let k = -1; k <= 1; k++) {
    g.beginPath();
    g.moveTo(0.35 * s, k * 0.38 * s);
    g.lineTo(0.85 * s, k * 0.38 * s);
    g.stroke();
  }
  g.fillStyle = "rgba(255, 255, 255, 0.45)";
  g.beginPath();
  g.arc(-0.3 * s, -0.35 * s, 0.28 * s, 0, TWO_PI);
  g.fill();
}

/**
 * --- fl-overhaul --- A curl of air at rest (the air fists: Gerald, Aang): a spiral in the fighter's colour – its accent, its
 * body when the accent is too light for the white floor – with an ink outline, so the weapon shows on the near-white floor.
 */
function drawAirCurl(g: CanvasRenderingContext2D, s: number, p: Paint) {
  const color = luminance(p.accent) > 0.7 ? p.body : p.accent;
  g.lineCap = "round";
  g.beginPath();
  for (let k = 0; k <= 18; k++) {
    const a = (k / 18) * 1.75 * TWO_PI;
    const rr = s * (0.15 + 0.85 * (k / 18));
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1.4, 0.42 * s);
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = Math.max(0.8, 0.24 * s);
  g.stroke();
}

/** Three talons fanning forward from the origin. */
function drawClaws(g: CanvasRenderingContext2D, r: number, size: number, p: Paint) {
  const s = size * r;
  g.lineWidth = Math.max(0.6, 0.05 * r);
  g.strokeStyle = INK;
  g.fillStyle = p.color === p.accent ? "#e5e7eb" : p.color;
  for (let k = -1; k <= 1; k++) {
    const off = k * 0.55 * s;
    g.beginPath();
    g.moveTo(-0.3 * s, off - 0.16 * s);
    g.quadraticCurveTo(0.9 * s, off - 0.3 * s + k * 0.2 * s, 1.6 * s, off + k * 0.35 * s);
    g.quadraticCurveTo(0.8 * s, off + 0.05 * s, -0.3 * s, off + 0.16 * s);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

/** A bow at the rim with its string (an arrow nocked when `nocked`). */
function drawBow(g: CanvasRenderingContext2D, r: number, p: Paint, nocked: boolean) {
  const R = 0.95 * r;
  const cx = 0.38 * r;
  g.lineCap = "round";
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1.6, 0.17 * r);
  g.beginPath();
  g.arc(cx, 0, R, -1.05, 1.05);
  g.stroke();
  g.strokeStyle = "#8b5a2b";
  g.lineWidth = Math.max(1, 0.1 * r);
  g.stroke();
  const ex = cx + Math.cos(1.05) * R;
  const ey = Math.sin(1.05) * R;
  g.strokeStyle = "#e5e7eb";
  g.lineWidth = Math.max(0.6, 0.035 * r);
  g.beginPath();
  g.moveTo(ex, -ey);
  g.lineTo(nocked ? 0.62 * r : ex, 0);
  g.lineTo(ex, ey);
  g.stroke();
  if (nocked) {
    g.strokeStyle = INK;
    g.lineWidth = Math.max(0.8, 0.06 * r);
    g.beginPath();
    g.moveTo(0.62 * r, 0);
    g.lineTo(1.55 * r, 0);
    g.stroke();
    g.fillStyle = p.color;
    g.beginPath();
    g.moveTo(1.72 * r, 0);
    g.lineTo(1.48 * r, -0.12 * r);
    g.lineTo(1.48 * r, 0.12 * r);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

/** A gun at the rim by its projectile: a pistol, a rifle (burst), an arm cannon (plasma), a launcher (rocket). */
function drawGun(g: CanvasRenderingContext2D, r: number, shape: FlShape, burst: boolean, shotgun: boolean, p: Paint) {
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  if (shape === "plasma" || shape === "charge") {
    // An arm cannon: a fat barrel with a glowing muzzle.
    g.fillStyle = p.accent;
    roundRect(g, 0.55 * r, -0.3 * r, 1.05 * r, 0.6 * r, 0.22 * r);
    g.fill();
    g.stroke();
    g.fillStyle = shade(p.accent, -0.35);
    g.fillRect(0.75 * r, -0.3 * r, 0.12 * r, 0.6 * r);
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(1.6 * r, 0, 0.2 * r, 0, TWO_PI);
    g.fill();
    g.stroke();
    return;
  }
  const len = shotgun ? 1.25 * r : burst ? 1.15 * r : 0.72 * r;
  const x0 = 0.85 * r;
  g.fillStyle = "#374151";
  // Grip (below the barrel) and the barrel(s).
  g.beginPath();
  g.moveTo(x0, 0.05 * r);
  g.lineTo(x0 + 0.24 * r, 0.05 * r);
  g.lineTo(x0 + 0.14 * r, 0.42 * r);
  g.lineTo(x0 - 0.06 * r, 0.42 * r);
  g.closePath();
  g.fill();
  g.stroke();
  const bh = shotgun ? 0.24 * r : 0.17 * r;
  g.fillStyle = "#1f2937";
  g.fillRect(x0 - 0.05 * r, -bh, len, 1.6 * bh);
  g.strokeRect(x0 - 0.05 * r, -bh, len, 1.6 * bh);
  g.fillStyle = p.accent;
  g.fillRect(x0 + 0.1 * r, -bh + 1, 0.16 * r, 1.6 * bh - 2);
  if (shotgun) {
    g.strokeStyle = "#6b7280";
    g.beginPath();
    g.moveTo(x0, -0.2 * bh);
    g.lineTo(x0 + len - 0.05 * r, -0.2 * bh);
    g.stroke();
  }
  if (burst) {
    // A magazine.
    g.fillStyle = "#111827";
    g.strokeStyle = INK;
    g.fillRect(x0 + 0.45 * r, 0.6 * bh, 0.16 * r, 0.32 * r);
    g.strokeRect(x0 + 0.45 * r, 0.6 * bh, 0.16 * r, 0.32 * r);
  }
}

function gunBox(r: number, shotgun: boolean, burst: boolean): Box {
  const len = shotgun ? 1.25 * r : burst ? 1.15 * r : 0.72 * r;
  return { x0: 0.5 * r, y0: -0.5 * r, x1: Math.max(1.85 * r, 0.85 * r + len + 2), y1: 0.6 * r };
}

/** An energy hand: a glowing orb at the rim (repulsors, ki, hadouken, fireballs, beams, sparks). */
function drawEnergyHand(g: CanvasRenderingContext2D, r: number, p: Paint) {
  g.shadowColor = p.color;
  g.shadowBlur = 0.45 * r;
  g.fillStyle = p.color;
  g.beginPath();
  g.arc(1.1 * r, 0, 0.24 * r, 0, TWO_PI);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(1.1 * r, 0, 0.11 * r, 0, TWO_PI);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = Math.max(0.6, 0.04 * r);
  g.beginPath();
  g.arc(1.1 * r, 0, 0.24 * r, 0, TWO_PI);
  g.stroke();
}

/** A wand (thin, a glowing tip), a staff (long, an orb on top) or a spell book (open pages). */
function drawCaster(g: CanvasRenderingContext2D, r: number, kind: "wand" | "staff" | "book", p: Paint) {
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.lineCap = "round";
  if (kind === "book") {
    const w = 0.42 * r;
    const h = 0.55 * r;
    g.fillStyle = p.accent;
    roundRect(g, 0.85 * r, -h - 0.05 * r, 2 * w * 0.98, 2 * h + 0.1 * r, 0.06 * r);
    g.fill();
    g.stroke();
    g.fillStyle = "#fefce8";
    g.fillRect(0.9 * r, -h, w - 0.03 * r, 2 * h);
    g.fillRect(0.9 * r + w + 0.03 * r, -h, w - 0.08 * r, 2 * h);
    g.strokeStyle = "rgba(0, 0, 0, 0.35)";
    g.lineWidth = Math.max(0.5, 0.03 * r);
    for (let k = 0; k < 4; k++) {
      const y = -h + (k + 1) * (2 * h) / 5;
      g.beginPath();
      g.moveTo(0.95 * r, y);
      g.lineTo(0.9 * r + w - 0.08 * r, y);
      g.moveTo(0.9 * r + w + 0.08 * r, y);
      g.lineTo(0.9 * r + 2 * w - 0.12 * r, y);
      g.stroke();
    }
    g.strokeStyle = INK;
    g.beginPath();
    g.moveTo(0.9 * r + w, -h);
    g.lineTo(0.9 * r + w, h);
    g.stroke();
    return;
  }
  const x1 = kind === "wand" ? 1.65 * r : 1.85 * r;
  const x0 = kind === "wand" ? 0.75 * r : 0.25 * r;
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1.6, (kind === "wand" ? 0.13 : 0.19) * r);
  g.beginPath();
  g.moveTo(x0, 0);
  g.lineTo(x1, 0);
  g.stroke();
  g.strokeStyle = kind === "wand" ? "#5b3a29" : "#8b6b4a";
  g.lineWidth = Math.max(1, (kind === "wand" ? 0.07 : 0.12) * r);
  g.stroke();
  g.shadowColor = p.color;
  g.shadowBlur = 0.5 * r;
  g.fillStyle = p.color;
  g.beginPath();
  g.arc(x1 + (kind === "wand" ? 0.04 : 0.16) * r, 0, (kind === "wand" ? 0.1 : 0.24) * r, 0, TWO_PI);
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = Math.max(0.6, 0.04 * r);
  g.stroke();
}

/** A round shield facing +x at the rim (held, or thrown when drawn at a projectile), or a pair of bracers (block). */
function drawShield(g: CanvasRenderingContext2D, r: number, size: number, bracers: boolean, p: Paint) {
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  if (bracers) {
    g.fillStyle = p.accent;
    for (const a of [-0.75, 0.75]) {
      const x = Math.cos(a) * 1.0 * r;
      const y = Math.sin(a) * 1.0 * r;
      roundRect(g, x - 0.16 * r, y - 0.22 * r, 0.32 * r, 0.44 * r, 0.07 * r);
      g.fill();
      g.stroke();
    }
    return;
  }
  const R = size * r;
  const cx = 1.0 * r;
  // Seen edge-on from above: a flattened disc with its rings.
  g.save();
  g.translate(cx, 0);
  g.scale(0.42, 1);
  const rings = [p.accent, "#f8fafc", p.accent, p.body];
  for (let k = 0; k < rings.length; k++) {
    g.fillStyle = rings[k];
    g.beginPath();
    g.arc(0, 0, R * (1 - 0.22 * k), 0, TWO_PI);
    g.fill();
  }
  g.restore();
  g.beginPath();
  g.ellipse(cx, 0, 0.42 * R, R, 0, 0, TWO_PI);
  g.stroke();
}

/** A thrown shield, face on (spinning). */
function drawShieldFace(g: CanvasRenderingContext2D, R: number, p: Paint) {
  const rings = [p.accent, "#f8fafc", p.accent, p.body];
  for (let k = 0; k < rings.length; k++) {
    g.fillStyle = rings[k];
    g.beginPath();
    g.arc(0, 0, R * (1 - 0.22 * k), 0, TWO_PI);
    g.fill();
  }
  // A plain boss in the middle (no emblem: an own, generic round shield).
  g.fillStyle = "#e5e7eb";
  g.beginPath();
  g.arc(0, 0, 0.16 * R, 0, TWO_PI);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = Math.max(0.8, 0.07 * R);
  g.beginPath();
  g.arc(0, 0, R, 0, TWO_PI);
  g.stroke();
}

/** A tail from the rim along +x: tapering segments, plates (spikes) or a blade at the tip. */
function drawTail(g: CanvasRenderingContext2D, r: number, reach: number, size: number, bladeTip: boolean, p: Paint) {
  const x0 = 0.7 * r;
  const x1 = r + reach * r;
  const w0 = Math.max(1.2, size * r * 1.2);
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.fillStyle = shade(p.body, 0.08);
  g.beginPath();
  g.moveTo(x0, -w0);
  g.quadraticCurveTo(0.5 * (x0 + x1), -0.7 * w0, x1, -0.12 * w0);
  g.lineTo(x1, 0.12 * w0);
  g.quadraticCurveTo(0.5 * (x0 + x1), 0.7 * w0, x0, w0);
  g.closePath();
  g.fill();
  g.stroke();
  const n = 5;
  g.fillStyle = p.accent;
  for (let k = 0; k < n; k++) {
    const x = x0 + ((k + 0.5) / n) * (x1 - x0) * 0.9;
    const w = w0 * (1 - (0.75 * (k + 0.5)) / n);
    if (bladeTip) {
      g.fillRect(x - 0.04 * r, -w * 0.9, 0.08 * r, 1.8 * w * 0.9);
    } else {
      g.beginPath();
      g.moveTo(x - 0.12 * r, -w * 0.8);
      g.lineTo(x, -w * 0.8 - 0.32 * r * (1 - k / n));
      g.lineTo(x + 0.12 * r, -w * 0.8);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
  if (bladeTip) {
    g.fillStyle = "#cbd5e1";
    g.beginPath();
    g.moveTo(x1 - 0.1 * r, -0.28 * r);
    g.lineTo(x1 + 0.55 * r, 0);
    g.lineTo(x1 - 0.1 * r, 0.28 * r);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

/** A small web emblem at the rim (the shooter). */
function drawWebShooter(g: CanvasRenderingContext2D, r: number) {
  const cx = 1.05 * r;
  const R = 0.26 * r;
  g.fillStyle = "#f8fafc";
  g.strokeStyle = INK;
  g.lineWidth = Math.max(0.6, 0.04 * r);
  g.beginPath();
  g.arc(cx, 0, R, 0, TWO_PI);
  g.fill();
  g.stroke();
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    g.moveTo(cx, 0);
    g.lineTo(cx + Math.cos(a) * R, Math.sin(a) * R);
  }
  g.stroke();
  g.beginPath();
  g.arc(cx, 0, 0.55 * R, 0, TWO_PI);
  g.stroke();
}

/** An ice shard at the rim (the freezer's focus). */
function drawIceFocus(g: CanvasRenderingContext2D, r: number, p: Paint) {
  g.fillStyle = p.color;
  g.strokeStyle = "#0c4a6e";
  g.lineWidth = Math.max(0.6, 0.05 * r);
  g.beginPath();
  g.moveTo(0.85 * r, 0);
  g.lineTo(1.12 * r, -0.26 * r);
  g.lineTo(1.6 * r, 0);
  g.lineTo(1.12 * r, 0.26 * r);
  g.closePath();
  g.fill();
  g.stroke();
  g.strokeStyle = "rgba(255, 255, 255, 0.85)";
  g.beginPath();
  g.moveTo(0.95 * r, 0);
  g.lineTo(1.45 * r, 0);
  g.stroke();
}

/** A flame at the rim (the breath's source while it rests). */
function drawFlameFocus(g: CanvasRenderingContext2D, r: number) {
  g.fillStyle = "#f97316";
  g.strokeStyle = "#7c2d12";
  g.lineWidth = Math.max(0.6, 0.04 * r);
  g.beginPath();
  g.moveTo(0.85 * r, -0.2 * r);
  g.quadraticCurveTo(1.35 * r, -0.3 * r, 1.55 * r, 0);
  g.quadraticCurveTo(1.35 * r, 0.3 * r, 0.85 * r, 0.2 * r);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = "#fde047";
  g.beginPath();
  g.moveTo(0.9 * r, -0.09 * r);
  g.quadraticCurveTo(1.25 * r, -0.12 * r, 1.35 * r, 0);
  g.quadraticCurveTo(1.25 * r, 0.12 * r, 0.9 * r, 0.09 * r);
  g.closePath();
  g.fill();
}

/* ------------------------------------------------------------------ projectiles (centred on the origin, +x = the flight) */

/** Whether a projectile shape spins (drawn at its spin angle, not along its flight). */
function spins(shape: FlShape): boolean {
  return shape === "shuriken" || shape === "card" || shape === "batarang" || shape === "saber" || shape === "hammer" || shape === "shield" || shape === "blades";
}

/** The bounds of projectile `shape` of radius `pr` (CSS px). */
function shotBox(shape: FlShape, pr: number): Box {
  switch (shape) {
    case "arrow":
    case "icespear":
    case "spear":
      return { x0: -6 * pr, y0: -1.6 * pr, x1: 2.4 * pr, y1: 1.6 * pr };
    case "bullet":
    case "pellet":
      return { x0: -4.5 * pr, y0: -1.4 * pr, x1: 1.6 * pr, y1: 1.4 * pr };
    case "rocket":
      return { x0: -4.8 * pr, y0: -1.6 * pr, x1: 2 * pr, y1: 1.6 * pr };
    case "saber":
      return { x0: -3.4 * pr, y0: -3.4 * pr, x1: 3.4 * pr, y1: 3.4 * pr };
    case "hammer":
      return { x0: -2.6 * pr, y0: -2.6 * pr, x1: 2.6 * pr, y1: 2.6 * pr };
    case "dagger":
    case "blades":
      return { x0: -2.4 * pr, y0: -1.6 * pr, x1: 2.6 * pr, y1: 1.6 * pr };
    default:
      return { x0: -2.6 * pr, y0: -2 * pr, x1: 2 * pr, y1: 2 * pr };
  }
}

function glowBall(g: CanvasRenderingContext2D, pr: number, color: string, core: string, tail: boolean) {
  if (tail) {
    const grad = g.createLinearGradient(-2.5 * pr, 0, 0, 0);
    grad.addColorStop(0, "rgba(255, 255, 255, 0)");
    grad.addColorStop(1, color);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-2.5 * pr, 0);
    g.lineTo(0, -0.85 * pr);
    g.lineTo(0, 0.85 * pr);
    g.closePath();
    g.fill();
  }
  g.shadowColor = color;
  g.shadowBlur = 0.9 * pr;
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, pr, 0, TWO_PI);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = core;
  g.beginPath();
  g.arc(0.1 * pr, 0, 0.5 * pr, 0, TWO_PI);
  g.fill();
  g.strokeStyle = "rgba(15, 23, 42, 0.55)";
  g.lineWidth = Math.max(0.5, 0.12 * pr);
  g.beginPath();
  g.arc(0, 0, pr, 0, TWO_PI);
  g.stroke();
}

/** Projectile `shape` of radius `pr` in colour `color` (owner palette `p`). */
function drawShot(g: CanvasRenderingContext2D, shape: FlShape, pr: number, color: string, p: Paint) {
  const lw = Math.max(0.6, 0.18 * pr);
  g.lineJoin = "round";
  g.lineCap = "round";
  switch (shape) {
    case "arrow":
    case "icespear":
    case "spear": {
      const ice = shape === "icespear";
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1, (ice ? 0.7 : 0.38) * pr);
      g.beginPath();
      g.moveTo(-5.4 * pr, 0);
      g.lineTo(1.2 * pr, 0);
      g.stroke();
      g.strokeStyle = ice ? color : "#a16207";
      g.lineWidth = Math.max(0.6, (ice ? 0.45 : 0.2) * pr);
      g.stroke();
      g.fillStyle = ice ? "#e0f2fe" : color;
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(2.3 * pr, 0);
      g.lineTo(0.6 * pr, -1.1 * pr);
      g.lineTo(0.9 * pr, 0);
      g.lineTo(0.6 * pr, 1.1 * pr);
      g.closePath();
      g.fill();
      g.stroke();
      if (!ice) {
        g.fillStyle = p.accent;
        g.beginPath();
        g.moveTo(-5.4 * pr, 0);
        g.lineTo(-4.4 * pr, -1.1 * pr);
        g.lineTo(-3.9 * pr, -1.1 * pr);
        g.lineTo(-4.6 * pr, 0);
        g.lineTo(-3.9 * pr, 1.1 * pr);
        g.lineTo(-4.4 * pr, 1.1 * pr);
        g.closePath();
        g.fill();
      }
      return;
    }
    case "bullet":
    case "pellet": {
      const grad = g.createLinearGradient(-4.4 * pr, 0, 0, 0);
      grad.addColorStop(0, "rgba(255, 255, 255, 0)");
      grad.addColorStop(1, shape === "pellet" ? "rgba(251, 146, 60, 0.85)" : "rgba(253, 224, 71, 0.85)");
      g.fillStyle = grad;
      g.fillRect(-4.4 * pr, -0.55 * pr, 4.4 * pr, 1.1 * pr);
      g.fillStyle = shape === "pellet" ? "#78350f" : color === p.accent ? "#d4a017" : color;
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(-0.9 * pr, -0.75 * pr);
      g.lineTo(0.5 * pr, -0.75 * pr);
      g.quadraticCurveTo(1.5 * pr, -0.6 * pr, 1.5 * pr, 0);
      g.quadraticCurveTo(1.5 * pr, 0.6 * pr, 0.5 * pr, 0.75 * pr);
      g.lineTo(-0.9 * pr, 0.75 * pr);
      g.closePath();
      g.fill();
      g.stroke();
      return;
    }
    case "rocket": {
      g.fillStyle = "#fb923c";
      g.beginPath();
      g.moveTo(-2.4 * pr, -0.5 * pr);
      g.lineTo(-4.6 * pr, 0);
      g.lineTo(-2.4 * pr, 0.5 * pr);
      g.closePath();
      g.fill();
      g.fillStyle = color;
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(-2.4 * pr, -0.75 * pr);
      g.lineTo(0.6 * pr, -0.75 * pr);
      g.quadraticCurveTo(1.9 * pr, 0, 0.6 * pr, 0.75 * pr);
      g.lineTo(-2.4 * pr, 0.75 * pr);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = p.accent;
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(-2.4 * pr, sgn * 0.75 * pr);
        g.lineTo(-2.9 * pr, sgn * 1.5 * pr);
        g.lineTo(-1.5 * pr, sgn * 0.75 * pr);
        g.closePath();
        g.fill();
        g.stroke();
      }
      return;
    }
    case "dagger":
    case "blades": {
      g.fillStyle = shape === "blades" ? color : "#e5e7eb";
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(2.5 * pr, 0);
      g.lineTo(-0.4 * pr, -0.6 * pr);
      g.lineTo(-0.4 * pr, 0.6 * pr);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = p.accent;
      g.fillRect(-0.6 * pr, -1.2 * pr, 0.35 * pr, 2.4 * pr);
      g.strokeRect(-0.6 * pr, -1.2 * pr, 0.35 * pr, 2.4 * pr);
      g.fillStyle = shade(p.body, -0.4);
      g.fillRect(-2.2 * pr, -0.32 * pr, 1.6 * pr, 0.64 * pr);
      g.strokeRect(-2.2 * pr, -0.32 * pr, 1.6 * pr, 0.64 * pr);
      return;
    }
    case "card": {
      g.fillStyle = "#fafafa";
      g.strokeStyle = INK;
      g.lineWidth = lw;
      roundRect(g, -1.2 * pr, -1.7 * pr, 2.4 * pr, 3.4 * pr, 0.35 * pr);
      g.fill();
      g.stroke();
      g.fillStyle = color === "#fafafa" ? "#dc2626" : color;
      g.beginPath();
      g.moveTo(0, -0.8 * pr);
      g.lineTo(0.6 * pr, 0);
      g.lineTo(0, 0.8 * pr);
      g.lineTo(-0.6 * pr, 0);
      g.closePath();
      g.fill();
      return;
    }
    case "batarang": {
      // A generic three-point boomerang.
      g.fillStyle = "#27272a";
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(0, -0.5 * pr);
      g.quadraticCurveTo(1.2 * pr, -1.4 * pr, 2 * pr, -0.6 * pr);
      g.quadraticCurveTo(1.2 * pr, -0.4 * pr, 1.4 * pr, 0.5 * pr);
      g.quadraticCurveTo(0.6 * pr, 0.1 * pr, 0, 0.9 * pr);
      g.quadraticCurveTo(-0.6 * pr, 0.1 * pr, -1.4 * pr, 0.5 * pr);
      g.quadraticCurveTo(-1.2 * pr, -0.4 * pr, -2 * pr, -0.6 * pr);
      g.quadraticCurveTo(-1.2 * pr, -1.4 * pr, 0, -0.5 * pr);
      g.closePath();
      g.fill();
      g.stroke();
      return;
    }
    case "shuriken": {
      g.fillStyle = "#94a3b8";
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const rr = (k % 2 === 0 ? 1.9 : 0.55) * pr;
        if (k === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = INK;
      g.beginPath();
      g.arc(0, 0, 0.3 * pr, 0, TWO_PI);
      g.fill();
      return;
    }
    case "web": {
      g.fillStyle = "rgba(248, 250, 252, 0.95)";
      g.strokeStyle = "#475569";
      g.lineWidth = Math.max(0.5, 0.12 * pr);
      g.beginPath();
      g.arc(0, 0, 1.4 * pr, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * 1.4 * pr, Math.sin(a) * 1.4 * pr);
      }
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 0.75 * pr, 0, TWO_PI);
      g.stroke();
      return;
    }
    case "ice": {
      g.fillStyle = color;
      g.strokeStyle = "#0c4a6e";
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(1.9 * pr, 0);
      g.lineTo(0, -1.1 * pr);
      g.lineTo(-1.6 * pr, 0);
      g.lineTo(0, 1.1 * pr);
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = "rgba(255, 255, 255, 0.9)";
      g.beginPath();
      g.moveTo(-1.1 * pr, 0);
      g.lineTo(1.4 * pr, 0);
      g.stroke();
      return;
    }
    case "page": {
      g.fillStyle = "#fefce8";
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.save();
      g.rotate(0.3);
      g.fillRect(-1.1 * pr, -1.4 * pr, 2.2 * pr, 2.8 * pr);
      g.strokeRect(-1.1 * pr, -1.4 * pr, 2.2 * pr, 2.8 * pr);
      g.strokeStyle = color;
      g.lineWidth = Math.max(0.5, 0.15 * pr);
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(-0.7 * pr, (-0.7 + 0.7 * k) * pr);
        g.lineTo(0.7 * pr, (-0.7 + 0.7 * k) * pr);
        g.stroke();
      }
      g.restore();
      return;
    }
    case "saber": {
      // A spinning double blade.
      g.lineCap = "round";
      g.shadowColor = color;
      g.shadowBlur = 0.9 * pr;
      g.strokeStyle = color;
      g.lineWidth = 0.95 * pr;
      g.beginPath();
      g.moveTo(-3 * pr, 0);
      g.lineTo(3 * pr, 0);
      g.stroke();
      g.shadowBlur = 0;
      g.strokeStyle = "#ffffff";
      g.lineWidth = 0.4 * pr;
      g.stroke();
      g.fillStyle = "#4b5563";
      g.fillRect(-0.7 * pr, -0.35 * pr, 1.4 * pr, 0.7 * pr);
      return;
    }
    case "hammer": {
      g.save();
      drawHammerHead(g, pr / 0.5, 0.5, p, 1.6 * pr);
      g.restore();
      return;
    }
    case "shield":
      drawShieldFace(g, pr, p);
      return;
    case "flames":
    case "fireball":
    case "flamewave":
      glowBall(g, pr, shape === "flamewave" ? "#fb923c" : color, "#fef08a", true);
      return;
    case "hadouken":
    case "ki":
    case "repulsor":
    case "plasma":
    case "charge":
    case "orb":
      glowBall(g, pr, color, "#ffffff", shape !== "orb");
      return;
    case "air": {
      // --- fl-overhaul --- the blast's arcs: an ink outline under the fighter's tint (white strokes vanished on the floor)
      const tint = luminance(p.accent) > 0.7 ? p.body : p.accent;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.arc(-k * 0.7 * pr, 0, (1.4 - 0.25 * k) * pr, -1, 1);
        g.strokeStyle = INK;
        g.lineWidth = Math.max(1.4, 0.42 * pr);
        g.stroke();
        g.strokeStyle = k === 0 ? tint : "rgba(255, 255, 255, 0.95)";
        g.lineWidth = Math.max(0.8, 0.26 * pr);
        g.stroke();
      }
      return;
    }
    case "kicks": {
      // --- fl-overhaul --- a boot (the ring of a spinning kick): the sole forward
      g.save();
      drawFist(g, pr / 0.36, 0.36, p, true);
      g.restore();
      return;
    }
    default: {
      // bolt (and anything else): a short bright streak with a white core.
      g.lineCap = "round";
      g.shadowColor = color;
      g.shadowBlur = 0.8 * pr;
      g.strokeStyle = color;
      g.lineWidth = 1.5 * pr;
      g.beginPath();
      g.moveTo(-2 * pr, 0);
      g.lineTo(1.2 * pr, 0);
      g.stroke();
      g.shadowBlur = 0;
      g.strokeStyle = "#ffffff";
      g.lineWidth = 0.6 * pr;
      g.stroke();
    }
  }
}

/** A summon's body: a wolf (ears), a wight (hollow eyes), a clone (the owner's colours). */
function drawSummon(g: CanvasRenderingContext2D, R: number, shape: FlShape, color: string) {
  g.lineWidth = Math.max(0.8, 0.1 * R);
  g.strokeStyle = INK;
  if (shape === "wolf") {
    g.fillStyle = "#f8fafc";
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.moveTo(sgn * 0.25 * R, -0.85 * R);
      g.lineTo(sgn * 0.75 * R, -1.35 * R);
      g.lineTo(sgn * 0.85 * R, -0.5 * R);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.arc(0, 0, R, 0, TWO_PI);
    g.fill();
    g.stroke();
    g.fillStyle = "#dc2626";
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.arc(sgn * 0.35 * R, -0.15 * R, 0.13 * R, 0, TWO_PI);
      g.fill();
    }
    g.fillStyle = INK;
    g.beginPath();
    g.arc(0, 0.3 * R, 0.16 * R, 0, TWO_PI);
    g.fill();
    return;
  }
  if (shape === "wight") {
    g.fillStyle = "#cbd5e1";
    g.beginPath();
    g.arc(0, 0, R, 0, TWO_PI);
    g.fill();
    g.stroke();
    g.fillStyle = "#38bdf8";
    g.shadowColor = "#38bdf8";
    g.shadowBlur = 0.4 * R;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.arc(sgn * 0.33 * R, -0.12 * R, 0.16 * R, 0, TWO_PI);
      g.fill();
    }
    g.shadowBlur = 0;
    return;
  }
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, R, 0, TWO_PI);
  g.fill();
  g.stroke();
  g.fillStyle = "rgba(255, 255, 255, 0.35)";
  g.beginPath();
  g.arc(-0.3 * R, -0.35 * R, 0.3 * R, 0, TWO_PI);
  g.fill();
}

/* ------------------------------------------------------------------ the layer */

/** A weapon's held look this run (rebuilt when the fighter's size in device px changes). */
interface HeldSprite {
  bucket: number;
  sprite: Sprite | null;
}

/** Cached HUD strings of a fighter's stat lines (rebuilt when a shown value changes). */
interface StatText {
  key: number;
  dmg: string;
  spd: string;
  atk: string;
  cast: string;
  dmgUp: number;
  spdUp: number;
  atkUp: number;
  castUp: number;
}

const SHAPE_INDEX = new Map<FlShape, number>();
/** Live-drawn weapon parts (`partSprite()`). */
const PART_FIST = 0;
const PART_HEAD = 1;
const PART_CLAWS = 2;
const PART_KICK = 3;
/** --- fl-overhaul --- An air fist's resting curl. */
const PART_AIR = 4;

export class FightLeagueLayer {
  private generation = -1;
  private dpr = 1;
  /** Held weapon sprites per fighter slot and weapon. */
  private held: HeldSprite[][] = [];
  /** Projectile and part sprites by a numeric key (size bucket, shape, colour). */
  private readonly shots = new Map<number, Sprite>();
  private readonly colorIds = new Map<string, number>();
  private readonly paints: Paint[] = [];
  private readonly fonts = new Map<number, string>();
  /** The HP bars' white "just lost" segment: the shown value per slot and the clock it follows. */
  private readonly ghost = new Float64Array(4);
  private lastMs = 0;
  private readonly stats: StatText[] = [];
  private timerSec = -1;
  private timerText = "";
  /** What the last frame drew (the data attributes and the smoke test): names, ability boxes, the VS card, sprites in use. */
  namesDrawn = 0;
  boxesDrawn = 0;
  vsShown = false;
  bannerShown = false;
  fightersDrawn = 0;
  projectilesDrawn = 0;
  weaponsDrawn = 0;
  /** The body colour of a fighter ball (the ball faces). */
  readonly bodyColor = (ball: { id: number }): string => {
    const v = this.view;
    if (v) for (const f of v.fighters) if (f.ballId === ball.id) return f.row.body;
    return "#ffffff";
  };
  private view: FightLeagueView | null = null;

  constructor() {
    if (SHAPE_INDEX.size === 0) {
      const shapes: FlShape[] = ["arrow", "bullet", "repulsor", "fireball", "plasma", "charge", "ki", "hadouken", "flamewave", "rocket", "bolt", "orb", "page", "dagger", "batarang", "card", "shuriken", "web", "ice", "icespear", "hammer", "shield", "spear", "saber", "pellet", "blades", "kicks", "flames", "air", "wolf", "wight", "clone"];
      shapes.forEach((s, i) => SHAPE_INDEX.set(s, i));
    }
  }

  private font(px: number, weight = 800, mono = false): string {
    const size = Math.max(6, Math.round(px));
    const key = size * 10000 + weight * 2 + (mono ? 1 : 0);
    let f = this.fonts.get(key);
    if (!f) {
      f = `${weight} ${size}px ${mono ? NUMBER_FONT : SANS}`;
      this.fonts.set(key, f);
    }
    return f;
  }

  /** Once per frame: a new run drops the per-run caches; a new device pixel ratio the sprites. */
  private begin(view: FightLeagueView, o: FightLeagueRenderOptions) {
    this.view = view;
    const dpr = Math.max(0.25, o.dpr || 1);
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.held = [];
      this.shots.clear();
    }
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.held = [];
      this.paints.length = 0;
      this.stats.length = 0;
      for (let i = 0; i < 4; i++) this.ghost[i] = view.fighters[i]?.maxHp ?? 0;
      this.lastMs = view.timeMs;
      if (this.shots.size > SPRITE_CAP) this.shots.clear();
    }
    for (let i = this.paints.length; i < view.fighters.length; i++) {
      const row = view.fighters[i].row;
      this.paints.push({ body: row.body, accent: row.accent, color: row.accent });
    }
  }

  private paintOf(f: FlFighter, w: FlWeaponState | null): Paint {
    const p = this.paints[f.slot];
    p.color = (w ? f.row.weapons[w.index]?.color : undefined) ?? f.row.accent;
    return p;
  }

  /** A raster of `draw` over `box` at the current device pixel ratio. */
  private makeSprite(box: Box, draw: (g: CanvasRenderingContext2D) => void): Sprite | null {
    if (typeof document === "undefined") return null;
    const w = Math.max(1, box.x1 - box.x0);
    const h = Math.max(1, box.y1 - box.y0);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(w * this.dpr));
    canvas.height = Math.max(1, Math.ceil(h * this.dpr));
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.setTransform(this.dpr, 0, 0, this.dpr, -box.x0 * this.dpr, -box.y0 * this.dpr);
    draw(g);
    return { canvas, x0: box.x0, y0: box.y0, w, h };
  }

  private colorId(color: string): number {
    let id = this.colorIds.get(color);
    if (id === undefined) {
      id = this.colorIds.size & 4095;
      this.colorIds.set(color, id);
    }
    return id;
  }

  /** A projectile (or orbiting blade, thrown weapon, minion) sprite: shape, radius, colour, the owner's palette. */
  private shotSprite(shape: FlShape, pr: number, color: string, p: Paint, owner: number): Sprite | null {
    const bucket = Math.max(1, Math.round(pr * this.dpr * 2));
    const key = ((bucket * 64 + (SHAPE_INDEX.get(shape) ?? 10)) * 4096 + this.colorId(color)) * 8 + (owner & 7);
    let s = this.shots.get(key);
    if (!s) {
      const r = bucket / (2 * this.dpr);
      if (shape === "wolf" || shape === "wight" || shape === "clone") s = this.makeSprite({ x0: -1.6 * r, y0: -1.6 * r, x1: 1.6 * r, y1: 1.6 * r }, (g) => drawSummon(g, r, shape, color)) ?? undefined;
      else s = this.makeSprite(shotBox(shape, r), (g) => drawShot(g, shape, r, color, p)) ?? undefined;
      if (!s) return null;
      if (this.shots.size > SPRITE_CAP) this.shots.clear();
      this.shots.set(key, s);
    }
    return s;
  }

  /** The held look of weapon `w` of `f` (null: drawn live or not at all). */
  private heldSprite(f: FlFighter, w: FlWeaponState): Sprite | null {
    let list = this.held[f.slot];
    if (!list) {
      list = [];
      this.held[f.slot] = list;
    }
    const bucket = Math.max(1, Math.round(f.r * this.dpr));
    let h = list[w.index];
    if (h && h.bucket === bucket) return h.sprite;
    const r = bucket / this.dpr;
    const s = w.spec;
    const raw = f.row.weapons[w.index];
    const p = { ...this.paintOf(f, w) };
    let sprite: Sprite | null = null;
    switch (s.kind) {
      case "sword":
        sprite = this.makeSprite(swordBox(r, s.reach, s.size, s.style === "glow"), (g) => drawSword(g, r, s.reach, s.size, s.style === "glow", { ...p, color: raw?.color ?? "#e5e7eb" }));
        break;
      case "hammer": {
        const d = r + s.reach * r;
        const hs = s.size * r;
        sprite = this.makeSprite({ x0: 0.6 * r, y0: -1.1 * hs - 2, x1: d + 0.75 * hs + 2, y1: 1.1 * hs + 2 }, (g) => {
          g.translate(d, 0);
          drawHammerHead(g, r, s.size, p, d - 0.7 * r);
        });
        break;
      }
      case "tail": {
        const blade = f.row.weapons[w.index]?.shape === "blades" || f.row.id === "alien";
        sprite = this.makeSprite({ x0: 0.6 * r, y0: -0.8 * r, x1: r + s.reach * r + 0.7 * r, y1: 0.8 * r }, (g) => drawTail(g, r, s.reach, s.size, blade, p));
        break;
      }
      case "bow":
        sprite = this.makeSprite({ x0: 0.4 * r, y0: -0.95 * r, x1: 1.85 * r, y1: 0.95 * r }, (g) => drawBow(g, r, p, false));
        break;
      case "gun":
      case "shotgun": {
        const shape = s.shape;
        if (shape === "repulsor" || shape === "ki" || shape === "hadouken" || shape === "flamewave" || shape === "fireball" || shape === "bolt") {
          sprite = this.makeSprite({ x0: 0.7 * r, y0: -0.6 * r, x1: 1.6 * r, y1: 0.6 * r }, (g) => drawEnergyHand(g, r, p));
        } else {
          sprite = this.makeSprite(gunBox(r, s.kind === "shotgun", s.style === "burst"), (g) => drawGun(g, r, shape, s.style === "burst", s.kind === "shotgun", p));
        }
        break;
      }
      case "wand":
      case "staff":
      case "book":
        sprite = this.makeSprite({ x0: 0.1 * r, y0: -0.75 * r, x1: 2.3 * r, y1: 0.75 * r }, (g) => drawCaster(g, r, s.kind as "wand" | "staff" | "book", p));
        break;
      case "beam":
      case "spark":
        sprite = this.makeSprite({ x0: 0.7 * r, y0: -0.6 * r, x1: 1.6 * r, y1: 0.6 * r }, (g) => drawEnergyHand(g, r, p));
        break;
      case "web":
        sprite = this.makeSprite({ x0: 0.7 * r, y0: -0.4 * r, x1: 1.4 * r, y1: 0.4 * r }, (g) => drawWebShooter(g, r));
        break;
      case "ice":
        sprite = this.makeSprite({ x0: 0.7 * r, y0: -0.4 * r, x1: 1.75 * r, y1: 0.4 * r }, (g) => drawIceFocus(g, r, p));
        break;
      case "fire":
        sprite = this.makeSprite({ x0: 0.7 * r, y0: -0.4 * r, x1: 1.7 * r, y1: 0.4 * r }, (g) => drawFlameFocus(g, r));
        break;
      case "shield": {
        const bracers = s.style === "block";
        const R = s.size * r;
        sprite = this.makeSprite(bracers ? { x0: 0.5 * r, y0: -1.25 * r, x1: 1.35 * r, y1: 1.25 * r } : { x0: 0.5 * r, y0: -R - 2, x1: 1.0 * r + 0.45 * R + 2, y1: R + 2 }, (g) => drawShield(g, r, s.size, bracers, p));
        break;
      }
      default:
        // fists, claws, chains and cards are drawn live from their parts.
        sprite = null;
    }
    h = { bucket, sprite };
    list[w.index] = h;
    return sprite;
  }

  private drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, angle: number, alpha = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (alpha < 1) ctx.globalAlpha *= alpha;
    ctx.drawImage(s.canvas, s.x0, s.y0, s.w, s.h);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ the stage */

  drawStage(ctx: CanvasRenderingContext2D, view: FightLeagueView, o: FightLeagueRenderOptions) {
    const field = view.field;
    if (!field) return;
    this.begin(view, o);
    ctx.save();
    ctx.globalAlpha = 1;
    // The floor, a faint grid, the rim.
    const rim = Math.max(2, 0.012 * field.side);
    ctx.fillStyle = FLOOR;
    ctx.beginPath();
    if (field.kind === "circle") ctx.arc(field.cx, field.cy, field.half, 0, TWO_PI);
    else ctx.rect(field.cx - field.half, field.cy - field.half, 2 * field.half, 2 * field.half);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = FLOOR_LINE;
    ctx.lineWidth = Math.max(1, 0.003 * field.side);
    const cells = 8;
    const step = (2 * field.half) / cells;
    ctx.beginPath();
    for (let k = 1; k < cells; k++) {
      const x = field.cx - field.half + k * step;
      const y = field.cy - field.half + k * step;
      ctx.moveTo(x, field.cy - field.half);
      ctx.lineTo(x, field.cy + field.half);
      ctx.moveTo(field.cx - field.half, y);
      ctx.lineTo(field.cx + field.half, y);
    }
    ctx.stroke();
    // Bullet time: the arena tinted while it lasts.
    if (view.timeMs < view.slowTimeUntil) {
      ctx.globalAlpha = 0.12 + 0.04 * Math.sin(view.timeMs / 120);
      ctx.fillStyle = "#16a34a";
      ctx.fillRect(field.cx - field.half, field.cy - field.half, 2 * field.half, 2 * field.half);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.lineWidth = rim;
    ctx.strokeStyle = RIM;
    ctx.beginPath();
    if (field.kind === "circle") ctx.arc(field.cx, field.cy, field.half + rim / 2, 0, TWO_PI);
    else ctx.rect(field.cx - field.half - rim / 2, field.cy - field.half - rim / 2, 2 * field.half + rim, 2 * field.half + rim);
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ fighters, weapons, projectiles, effects */

  drawBodies(ctx: CanvasRenderingContext2D, view: FightLeagueView, o: FightLeagueRenderOptions) {
    const field = view.field;
    if (!field) return;
    this.begin(view, o);
    const now = view.timeMs;
    const dt = Math.max(0, Math.min(250, now - this.lastMs)) / 1000;
    this.lastMs = now;
    ctx.save();
    // Everything in play is clipped to the arena (a weapon past the rim is cut by it).
    ctx.beginPath();
    if (field.kind === "circle") ctx.arc(field.cx, field.cy, field.half, 0, TWO_PI);
    else ctx.rect(field.cx - field.half, field.cy - field.half, 2 * field.half, 2 * field.half);
    ctx.clip();
    this.drawFireRings(ctx, view, now);
    this.drawTasks(ctx, view, now);
    this.drawBeams(ctx, view, now);
    this.drawMinions(ctx, view, now);
    let weapons = 0;
    let drawn = 0;
    for (const f of view.fighters) {
      if (!f.alive) continue;
      weapons += this.drawWeapons(ctx, view, f, now);
    }
    for (const f of view.fighters) {
      if (!f.alive) continue;
      this.drawBody(ctx, view, f, now, o);
      drawn++;
    }
    // Held shields go in front of their fighter (--- fl-overhaul --- counted with the weapons drawn).
    for (const f of view.fighters) if (f.alive) weapons += this.drawShields(ctx, f, now);
    this.projectilesDrawn = this.drawProjectiles(ctx, view, now);
    ctx.restore();
    // Bars, numbers and effects over the rim.
    ctx.save();
    for (const f of view.fighters) if (f.alive) this.drawHp(ctx, f, now, dt, o);
    this.drawEvents(ctx, view, now, o);
    ctx.restore();
    this.fightersDrawn = drawn;
    this.weaponsDrawn = weapons;
  }

  private drawFireRings(ctx: CanvasRenderingContext2D, view: FightLeagueView, now: number) {
    for (const f of view.fighters) {
      if (!f.alive || now >= f.fireRingUntil) continue;
      const R = f.fireRingRadius;
      const blades = f.fireRingShape !== "flames";
      const kicks = f.fireRingShape === "kicks"; // --- fl-overhaul --- a spinning kick is a ring of boots
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = blades ? f.row.accent : "#f97316";
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      const n = blades ? 8 : 14;
      const spin = now / (blades ? 90 : 260);
      for (let k = 0; k < n; k++) {
        const a = spin + (k * TWO_PI) / n;
        const flick = 0.75 + 0.25 * Math.sin(now / 55 + k * 1.7);
        if (blades) {
          const s = this.shotSprite(kicks ? "kicks" : "dagger", (kicks ? 0.3 : 0.22) * f.r, "#e5e7eb", this.paintOf(f, null), f.slot);
          if (s) this.drawSprite(ctx, s, Math.cos(a) * 0.8 * R, Math.sin(a) * 0.8 * R, a + Math.PI / 2);
        } else {
          ctx.fillStyle = k % 2 === 0 ? "#f97316" : "#facc15";
          ctx.beginPath();
          const x = Math.cos(a) * 0.85 * R;
          const y = Math.sin(a) * 0.85 * R;
          ctx.arc(x, y, 0.16 * R * flick, 0, TWO_PI);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  /** Arena cuts about to land (dashed lines) and fused shockwaves (a blinking ring). */
  private drawTasks(ctx: CanvasRenderingContext2D, view: FightLeagueView, now: number) {
    for (const t of view.tasks) {
      if (!t.active || now >= t.at) continue;
      const k = Math.max(0, Math.min(1, (now - t.born) / Math.max(1, t.at - t.born)));
      if (t.kind === "cut") {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.5 * k;
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x2, t.y2);
        ctx.stroke();
        ctx.restore();
      } else if (t.kind === "shock") {
        const blink = Math.sin(now / (60 + 140 * (1 - k))) > 0;
        ctx.save();
        ctx.globalAlpha = blink ? 0.85 : 0.35;
        ctx.strokeStyle = "#dc2626";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        // The fused block itself.
        const s = Math.max(4, 0.16 * t.radius);
        ctx.fillStyle = "#dc2626";
        ctx.fillRect(t.x - s, t.y - s, 2 * s, 2 * s);
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(t.x - s, t.y - 0.3 * s, 2 * s, 0.6 * s);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.strokeRect(t.x - s, t.y - s, 2 * s, 2 * s);
        ctx.restore();
      }
    }
  }

  private drawBeams(ctx: CanvasRenderingContext2D, view: FightLeagueView, now: number) {
    for (const b of view.beams) {
      if (!b.active) continue;
      const life = Math.max(1, b.until - b.born);
      const t = (now - b.born) / life;
      const fade = t < 0.12 ? t / 0.12 : t > 0.85 ? Math.max(0, (1 - t) / 0.15) : 1;
      const wob = 1 + 0.12 * Math.sin(now / 25);
      ctx.save();
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.45 * fade;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2.2 * b.width * wob;
      ctx.beginPath();
      ctx.moveTo(b.x0, b.y0);
      ctx.lineTo(b.x1, b.y1);
      ctx.stroke();
      ctx.globalAlpha = 0.95 * fade;
      ctx.lineWidth = b.width;
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.4 * b.width;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawMinions(ctx: CanvasRenderingContext2D, view: FightLeagueView, now: number) {
    for (const m of view.minions) {
      if (!m.active) continue;
      const owner = view.fighters[m.owner];
      if (!owner) continue;
      const born = Math.min(1, (now - m.born) / 200);
      const left = m.until - now;
      const fade = left < 400 ? 0.4 + 0.6 * Math.abs(Math.sin(now / 60)) : 1;
      if (m.summon) {
        const s = this.shotSprite(m.shape, m.r, m.color, this.paintOf(owner, null), owner.slot);
        if (s) this.drawSprite(ctx, s, m.x, m.y, 0, born * fade);
        continue;
      }
      // A decoy: the owner's body, see-through, shimmering (icy for a freeze decoy).
      ctx.save();
      ctx.globalAlpha = 0.55 * born * fade;
      ctx.fillStyle = owner.row.body;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TWO_PI);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, 0.12 * m.r);
      ctx.strokeStyle = m.freezeOnTouch > 0 ? "#7dd3fc" : owner.row.accent;
      ctx.setLineDash([0.5 * m.r, 0.35 * m.r]);
      ctx.lineDashOffset = now / 30;
      ctx.stroke();
      ctx.restore();
    }
  }

  /** The weapons of `f` (shields go in front, later): returns how many were drawn. */
  private drawWeapons(ctx: CanvasRenderingContext2D, view: FightLeagueView, f: FlFighter, now: number): number {
    const disarmed = now < f.disarmedUntil;
    const alpha = (now < f.untargetableUntil ? 0.35 : 1) * (disarmed ? 0.35 : 1);
    let n = 0;
    for (const w of f.weapons) {
      const s = w.spec;
      if (s.kind === "shield") continue;
      switch (s.kind) {
        case "fists":
        case "claws":
          n += this.drawFists(ctx, f, w, alpha);
          continue;
        case "chain":
          n += this.drawChain(ctx, view, f, w, alpha);
          continue;
        case "cards":
          n += this.drawCards(ctx, f, w, alpha);
          continue;
        case "hammer":
          if (w.thrown >= 0) continue;
          break;
        case "fire":
          // (--- fl-overhaul --- after the breath's inhale)
          if (now >= w.inhaleUntil && now < w.onUntil) this.drawFlameCone(ctx, f, w, now);
          break;
        case "spark": {
          // --- fl-overhaul --- the arc leaves the hand (where it aimed), and jumps on in a free-for-all
          const color = f.row.weapons[w.index]?.color ?? f.row.accent;
          if (now - w.zapMs < 140) this.drawZap(ctx, f.x + Math.cos(w.zapAngle) * 1.1 * f.r, f.y + Math.sin(w.zapAngle) * 1.1 * f.r, w.zapX, w.zapY, color, now, w.zapMs);
          if (now - w.zap2Ms < 140) this.drawZap(ctx, w.zapX, w.zapY, w.zap2X, w.zap2Y, color, now, w.zap2Ms);
          break;
        }
        case "beam":
          // --- fl-overhaul --- the glint before the ray: a white-hot point in the hand
          if (w.glintUntil >= 0 && now < w.glintUntil) {
            ctx.save();
            ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 20);
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = f.row.weapons[w.index]?.color ?? f.row.accent;
            ctx.lineWidth = Math.max(1.5, 0.08 * f.r);
            ctx.beginPath();
            ctx.arc(f.x + Math.cos(w.angle) * 1.1 * f.r, f.y + Math.sin(w.angle) * 1.1 * f.r, 0.28 * f.r, 0, TWO_PI);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
          break;
        default:
          break;
      }
      const sprite = this.heldSprite(f, w);
      if (!sprite) continue;
      const giant = f.giantLeft > 0 ? 0.55 + 0.45 * Math.sin(now / 70) : 0;
      if (giant > 0) {
        ctx.save();
        ctx.shadowColor = f.row.accent;
        ctx.shadowBlur = 12 * giant;
      }
      this.drawSprite(ctx, sprite, f.x, f.y, w.angle, alpha);
      if (s.kind === "sword" && s.style === "double") this.drawSprite(ctx, sprite, f.x, f.y, w.angle + Math.PI, alpha);
      if (giant > 0) ctx.restore();
      // A shot just left: the muzzle flashes.
      if ((s.kind === "gun" || s.kind === "shotgun") && s.cooldown - w.cd < 0.06 && w.cd > 0) {
        ctx.save();
        ctx.globalAlpha = 0.9 * alpha;
        ctx.fillStyle = "#fde047";
        const mx = f.x + Math.cos(w.angle) * 1.95 * f.r;
        const my = f.y + Math.sin(w.angle) * 1.95 * f.r;
        ctx.beginPath();
        ctx.arc(mx, my, 0.22 * f.r, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }
      n++;
    }
    return n;
  }

  /** Held shields in front of their fighter (a block flashes them): returns how many were drawn. */
  private drawShields(ctx: CanvasRenderingContext2D, f: FlFighter, now: number): number {
    let n = 0;
    for (const w of f.weapons) {
      if (w.spec.kind !== "shield" || w.thrown >= 0) continue;
      const sprite = this.heldSprite(f, w);
      if (!sprite) continue;
      // (--- fl-overhaul --- dimmed while its guard recovers from a block)
      this.drawSprite(ctx, sprite, f.x, f.y, w.angle, (now < f.disarmedUntil ? 0.35 : 1) * (now < w.guardUntil ? 0.55 : 1));
      n++;
    }
    return n;
  }

  /**
   * Fists / claws: at rest beside the facing, one thrown out along a punch (kicks: boots; --- fl-overhaul --- air: a curl of
   * air at rest and an outlined blast while punching; contact: gloves – the body's run is the hit).
   */
  private drawFists(ctx: CanvasRenderingContext2D, f: FlFighter, w: FlWeaponState, alpha: number): number {
    const s = w.spec;
    const raw = f.row.weapons[w.index];
    const claws = s.kind === "claws";
    const air = raw?.shape === "air";
    const kick = raw?.shape === "kicks";
    const count = Math.max(1, Math.min(2, s.count));
    const fistR = s.size * f.r;
    const sprite = this.partSprite(f, w, air ? PART_AIR : claws ? PART_CLAWS : kick ? PART_KICK : PART_FIST, air ? 0.75 * fistR : fistR);
    const punching = w.punchT >= 0;
    const ext = punching ? (claws ? Math.min(1, w.punchT / 0.06) : punchExtension(w.punchT)) : 0;
    let drawn = 0;
    for (let k = 0; k < count; k++) {
      const active = punching && (count === 1 || k === w.punchSide);
      let a: number;
      let e: number;
      if (active) {
        a = w.punchAngle;
        e = ext;
      } else {
        a = w.angle + (count === 1 ? 0 : (k === 0 ? -1 : 1) * 0.62);
        e = 0;
      }
      const d = f.r + 0.6 * fistR + e * s.reach * f.r;
      const x = f.x + Math.cos(a) * d;
      const y = f.y + Math.sin(a) * d;
      if (air && active) {
        const blast = this.shotSprite("air", 0.9 * fistR, "#ffffff", this.paintOf(f, w), f.slot);
        if (blast) this.drawSprite(ctx, blast, x, y, a, alpha * Math.min(1, 0.3 + ext));
        drawn++;
        continue;
      }
      if (sprite) this.drawSprite(ctx, sprite, x, y, a, alpha);
      drawn++;
    }
    return drawn;
  }

  /** A part sprite of a fighter's weapon (a fist, a boot, claws, a chain head), built for its size (`size`: its radius, px). */
  private partSprite(f: FlFighter, w: FlWeaponState, part: number, size: number): Sprite | null {
    let list = this.held[f.slot];
    if (!list) {
      list = [];
      this.held[f.slot] = list;
    }
    const slot = 8 + w.index * 5 + part;
    const bucket = Math.max(1, Math.round(size * this.dpr * 2));
    const h = list[slot];
    if (h && h.bucket === bucket) return h.sprite;
    const rr = bucket / (2 * this.dpr);
    const s = w.spec;
    const p = { ...this.paintOf(f, w) };
    const R = rr / Math.max(1e-6, s.size);
    const raw = f.row.weapons[w.index];
    const sprite = this.makeSprite({ x0: -1.9 * rr, y0: -1.9 * rr, x1: 2.2 * rr, y1: 1.9 * rr }, (g) => {
      if (part === PART_AIR) drawAirCurl(g, rr, p);
      else if (part === PART_CLAWS) drawClaws(g, R, s.size, p);
      else if (part === PART_HEAD) drawChainHead(g, R, s.size, raw?.shape === "blades" ? "blades" : "spear", p);
      else drawFist(g, R, s.size, p, part === PART_KICK);
    });
    list[slot] = { bucket, sprite };
    return sprite;
  }

  /** A chain: its links from the rim to the head (orbiting, or flying with a throw) and the head. */
  private drawChain(ctx: CanvasRenderingContext2D, view: FightLeagueView, f: FlFighter, w: FlWeaponState, alpha: number): number {
    const s = w.spec;
    let hx: number;
    let hy: number;
    let a: number;
    const thrown = w.thrown >= 0 ? view.projectiles[w.thrown] : null;
    if (thrown && thrown.active) {
      hx = thrown.x;
      hy = thrown.y;
      a = Math.atan2(hy - f.y, hx - f.x);
    } else {
      a = w.angle;
      const d = f.r + s.reach * f.r;
      hx = f.x + Math.cos(a) * d;
      hy = f.y + Math.sin(a) * d;
    }
    const sx = f.x + Math.cos(a) * 0.9 * f.r;
    const sy = f.y + Math.sin(a) * 0.9 * f.r;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(2, 0.16 * f.r);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = Math.max(1.2, 0.1 * f.r);
    ctx.setLineDash([0.22 * f.r, 0.12 * f.r]);
    ctx.stroke();
    ctx.restore();
    if (thrown && thrown.active) return 1; // the head is the projectile
    const head = this.partSprite(f, w, PART_HEAD, s.size * f.r);
    if (head) this.drawSprite(ctx, head, hx, hy, a, alpha);
    return 1;
  }

  /** Cards: the loaded blades orbiting the fighter. */
  private drawCards(ctx: CanvasRenderingContext2D, f: FlFighter, w: FlWeaponState, alpha: number): number {
    const s = w.spec;
    const p = this.paintOf(f, w);
    const pr = s.size * f.r;
    const color = f.row.weapons[w.index]?.color ?? f.row.accent;
    const sprite = this.shotSprite(s.shape, pr, color, p, f.slot);
    if (!sprite) return 0;
    const n = Math.min(w.loaded, s.count);
    const d = s.reach * f.r;
    for (let k = 0; k < n; k++) {
      const a = w.orbit + (TWO_PI * k) / s.count;
      const spin = spins(s.shape) ? w.orbit * 3 : a + Math.PI / 2;
      this.drawSprite(ctx, sprite, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, spin, alpha);
    }
    return n > 0 ? 1 : 0;
  }

  /** A breath: a flickering cone of fire along the weapon's facing. */
  private drawFlameCone(ctx: CanvasRenderingContext2D, f: FlFighter, w: FlWeaponState, now: number) {
    const s = w.spec;
    const range = f.r + s.reach * f.r;
    const half = 0.5 * s.spread * DEG;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(w.angle);
    const grad = ctx.createRadialGradient(0, 0, 0.6 * f.r, 0, 0, range);
    grad.addColorStop(0, "rgba(254, 240, 138, 0.95)");
    grad.addColorStop(0.45, "rgba(249, 115, 22, 0.8)");
    grad.addColorStop(1, "rgba(220, 38, 38, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0.8 * f.r, 0);
    const steps = 9;
    for (let k = 0; k <= steps; k++) {
      const a = -half + (2 * half * k) / steps;
      const flick = 0.82 + 0.18 * Math.sin(now / 45 + k * 2.1);
      ctx.lineTo(Math.cos(a) * range * flick, Math.sin(a) * range * flick);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** A crackling arc between two points (the spark's zap). */
  private drawZap(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, now: number, born: number) {
    const t = Math.max(0, Math.min(1, (now - born) / 140));
    const seg = 7;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let k = 1; k < seg; k++) {
      const off = (hash(k, Math.floor(born)) - 0.5) * 0.18 * len;
      ctx.lineTo(x0 + (dx * k) / seg + nx * off, y0 + (dy * k) / seg + ny * off);
    }
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /** A fighter's body and its status looks. */
  private drawBody(ctx: CanvasRenderingContext2D, view: FightLeagueView, f: FlFighter, now: number, o: FightLeagueRenderOptions) {
    const r = f.r;
    const x = f.x;
    const y = f.y;
    const row = f.row;
    const ghost = now < f.untargetableUntil;
    ctx.save();
    ctx.globalAlpha = ghost ? 0.35 : 1;
    // Buff auras under the body: damage (red), attack speed (gold), heal (green), speed (streaks behind).
    if (now < f.speedMulUntil && f.speedMul > 1) {
      const sp = Math.hypot(f.vx, f.vy);
      if (sp > 1) {
        const ux = f.vx / sp;
        const uy = f.vy / sp;
        for (let k = 1; k <= 3; k++) {
          ctx.globalAlpha = (ghost ? 0.12 : 0.22) * (1 - k / 4);
          ctx.fillStyle = row.body;
          ctx.beginPath();
          ctx.arc(x - ux * k * 0.7 * r, y - uy * k * 0.7 * r, r * (1 - 0.1 * k), 0, TWO_PI);
          ctx.fill();
        }
        ctx.globalAlpha = ghost ? 0.35 : 1;
      }
    }
    const aura = now < f.dmgMulUntil ? "#ef4444" : now < f.atkMulUntil ? GOLD : now < f.healUntil ? "#22c55e" : null;
    if (aura) {
      ctx.globalAlpha = (ghost ? 0.15 : 0.32) * (0.75 + 0.25 * Math.sin(now / 90));
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(x, y, 1.45 * r, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = ghost ? 0.35 : 1;
    }
    // 2v2: the team ring.
    if (view.match === "2v2") {
      const colors = o.teamColors && o.teamColors.length >= 2 ? o.teamColors : TEAM_COLORS;
      ctx.strokeStyle = colors[f.team] ?? TEAM_COLORS[f.team & 1];
      ctx.lineWidth = Math.max(2, 0.16 * r);
      ctx.beginPath();
      ctx.arc(x, y, 1.2 * r, 0, TWO_PI);
      ctx.stroke();
    }
    // The ability's telegraph: a ring closing in on the body.
    if (f.telegraphUntil >= 0) {
      const k = Math.max(0, Math.min(1, 1 - (f.telegraphUntil - now) / Math.max(1, f.telegraphUntil - f.telegraphStart)));
      ctx.strokeStyle = row.accent;
      ctx.lineWidth = Math.max(2, 0.14 * r);
      ctx.globalAlpha = 0.5 + 0.5 * k;
      ctx.beginPath();
      ctx.arc(x, y, r * (2.4 - 1.2 * k), 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = ghost ? 0.35 : 1;
    }
    // The body: its colour, the accent ring, a highlight, the outline.
    const hitAge = now - f.hitMs;
    const flash = hitAge >= 0 && hitAge < HIT_FLASH_MS ? 1 - hitAge / HIT_FLASH_MS : 0;
    const squash = 1 + 0.1 * flash;
    ctx.fillStyle = row.body;
    ctx.beginPath();
    ctx.ellipse(x, y, r * squash, r / squash, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = row.accent;
    ctx.lineWidth = Math.max(1.5, 0.13 * r);
    ctx.beginPath();
    ctx.arc(x, y, 0.74 * r, 0, TWO_PI);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.beginPath();
    ctx.arc(x - 0.32 * r, y - 0.36 * r, 0.3 * r, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, 0.09 * r);
    ctx.beginPath();
    ctx.ellipse(x, y, r * squash, r / squash, 0, 0, TWO_PI);
    ctx.stroke();
    if (flash > 0) {
      ctx.globalAlpha = 0.85 * flash;
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.globalAlpha = ghost ? 0.35 : 1;
    }
    // Statuses on top: invulnerability (Super Star: rainbow), freeze, held, webbed, reflect.
    if (now < f.invulnUntil) {
      const star = now < f.contactUntil;
      ctx.strokeStyle = star ? `hsl(${Math.floor((now / 3) % 360)}, 100%, 60%)` : GOLD;
      ctx.lineWidth = Math.max(2, 0.16 * r);
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 70);
      ctx.beginPath();
      ctx.arc(x, y, 1.28 * r, 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = ghost ? 0.35 : 1;
    }
    if (now < f.frozenUntil) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#bae6fd";
      ctx.beginPath();
      ctx.arc(x, y, 1.08 * r, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = Math.max(1, 0.07 * r);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3 + 0.3;
        ctx.moveTo(x + Math.cos(a) * 0.3 * r, y + Math.sin(a) * 0.3 * r);
        ctx.lineTo(x + Math.cos(a) * 1.0 * r, y + Math.sin(a) * 1.0 * r);
      }
      ctx.stroke();
      ctx.globalAlpha = ghost ? 0.35 : 1;
    }
    if (f.heldBy >= 0) {
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = Math.max(2, 0.18 * r);
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 60);
      ctx.beginPath();
      ctx.arc(x, y, 1.18 * r, 0, TWO_PI);
      ctx.stroke();
      const by = view.fighters[f.heldBy];
      if (by && by.alive) {
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(by.x, by.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = ghost ? 0.35 : 1;
    }
    if (now < f.slowUntil) {
      ctx.strokeStyle = "rgba(248, 250, 252, 0.95)";
      ctx.lineWidth = Math.max(0.8, 0.05 * r);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4;
        ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.moveTo(x + 0.55 * r, y);
      ctx.arc(x, y, 0.55 * r, 0, TWO_PI);
      ctx.stroke();
    }
    if (now < f.reflectUntil) {
      ctx.strokeStyle = row.accent;
      ctx.lineWidth = Math.max(1.5, 0.1 * r);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const a = (k * Math.PI) / 3 + now / 400;
        const px = x + Math.cos(a) * 1.25 * r;
        const py = y + Math.sin(a) * 1.25 * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = ghost ? 0.35 : 1;
    }
    // Confused: stars circling over the head.
    if (now < f.confusedUntil) {
      ctx.fillStyle = GOLD;
      for (let k = 0; k < 3; k++) {
        const a = now / 180 + (k * TWO_PI) / 3;
        const sx = x + Math.cos(a) * 0.7 * r;
        const sy = y - 1.25 * r + Math.sin(a) * 0.22 * r;
        ctx.beginPath();
        for (let q = 0; q < 8; q++) {
          const aa = (q * Math.PI) / 4;
          const rr = (q % 2 === 0 ? 0.22 : 0.09) * r;
          if (q === 0) ctx.moveTo(sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr);
          else ctx.lineTo(sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    // Pulled: a line to the puller.
    if (now < f.pullUntil && f.pullBy >= 0) {
      const by = view.fighters[f.pullBy];
      if (by && by.alive) {
        ctx.strokeStyle = by.row.accent;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = Math.max(1.5, 0.08 * r);
        ctx.beginPath();
        ctx.moveTo(by.x, by.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Projectiles, by shape (spinning ones at their spin); thrown hammers and shields fly as themselves. */
  private drawProjectiles(ctx: CanvasRenderingContext2D, view: FightLeagueView, now: number): number {
    let n = 0;
    for (const p of view.projectiles) {
      if (!p.active) continue;
      const owner = view.fighters[p.owner];
      if (!owner) continue;
      if (now < p.born) continue;
      const paint = this.paintOf(owner, p.weapon >= 0 ? (owner.weapons[p.weapon] ?? null) : null);
      const shape = p.kind === PK_HAMMER ? "hammer" : p.kind === PK_SHIELD ? "shield" : p.kind === PK_SPEAR ? (owner.row.weapons[p.weapon]?.shape === "blades" ? "blades" : "spear") : p.shape;
      const sprite = this.shotSprite(shape, p.r, p.color, paint, owner.slot);
      if (!sprite) continue;
      const angle = spins(shape) ? p.spin : Math.atan2(p.vy, p.vx);
      if (p.giant > 0) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now / 50);
        ctx.fillStyle = owner.row.accent;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2 * p.r, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }
      this.drawSprite(ctx, sprite, p.x, p.y, angle);
      n++;
    }
    return n;
  }

  /** The HP bar under the ball (a white "just lost" segment) and the HP number inside. */
  private drawHp(ctx: CanvasRenderingContext2D, f: FlFighter, now: number, dt: number, o: FightLeagueRenderOptions) {
    const slot = f.slot & 3;
    const frac = Math.max(0, Math.min(1, f.hp / Math.max(1e-9, f.maxHp)));
    // The ghost holds a moment after a hit, then drains toward the HP.
    if (f.hp > this.ghost[slot]) this.ghost[slot] = f.hp;
    else if (f.hp < this.ghost[slot] && now - f.hitMs >= 280) this.ghost[slot] = Math.max(f.hp, this.ghost[slot] - f.maxHp * 0.9 * dt);
    const ghostFrac = Math.max(frac, Math.min(1, this.ghost[slot] / Math.max(1e-9, f.maxHp)));
    const r = f.r;
    const w = 2.2 * r;
    const h = Math.max(3, 0.24 * r);
    const top = f.y + 1.22 * r;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(f.x - w / 2 - 1.5, top - 1.5, w + 3, h + 3);
    if (ghostFrac > frac) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(f.x - w / 2 + w * frac, top, w * (ghostFrac - frac), h);
    }
    ctx.fillStyle = frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#eab308" : "#ef4444";
    ctx.fillRect(f.x - w / 2, top, w * frac, h);
    if (!o.numbers) return;
    const hp = Math.max(0, Math.ceil(f.hp - 1e-6));
    const fs = Math.max(9, (hp >= 100 ? 0.72 : 0.86) * r);
    ctx.font = this.font(fs, 900);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2.5, 0.2 * fs);
    ctx.strokeStyle = "rgba(11, 11, 15, 0.85)";
    const text = HP_TEXT[Math.min(HP_TEXT.length - 1, hp)] ?? String(hp);
    ctx.strokeText(text, f.x, f.y + 0.06 * fs);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, f.x, f.y + 0.06 * fs);
  }

  /** The effects of the event ring (simulation-timed). */
  private drawEvents(ctx: CanvasRenderingContext2D, view: FightLeagueView, now: number, o: FightLeagueRenderOptions) {
    const field = view.field!;
    const n = Math.min(view.eventSerial, FL_EVENT_CAP);
    const unit = Math.max(6, field.side * 0.065);
    for (let k = 0; k < n; k++) {
      const e = view.events[k];
      const age = now - e.t;
      if (!(age >= 0)) continue;
      switch (e.kind) {
        case EV_DAMAGE: {
          if (age >= DAMAGE_MS) break;
          const t = age / DAMAGE_MS;
          const big = Math.min(1, e.value / 25);
          const fs = Math.max(10, (0.42 + 0.35 * big) * unit) * (t < 0.12 ? 0.6 + (0.4 * t) / 0.12 : 1);
          const text = e.value >= 1 ? DMG_TEXT[Math.min(DMG_TEXT.length - 1, Math.round(e.value))] ?? `-${Math.round(e.value)}` : `-${e.value.toFixed(1)}`;
          const xo = (hash(k, e.t) - 0.5) * 0.6 * unit;
          ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.font = this.font(fs, 900);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineJoin = "round";
          ctx.lineWidth = Math.max(2.5, 0.2 * fs);
          ctx.strokeStyle = INK;
          const ty = e.y - 0.4 * unit - 0.9 * unit * t;
          ctx.strokeText(text, e.x + xo, ty);
          ctx.fillStyle = big > 0.6 ? "#fde047" : "#ffffff";
          ctx.fillText(text, e.x + xo, ty);
          break;
        }
        case EV_HIT: {
          if (age >= SPARK_MS) break;
          const t = age / SPARK_MS;
          const R = (0.25 + 0.6 * t) * unit * (0.7 + Math.min(0.8, e.value / 20));
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(1.5, 0.08 * unit * (1 - t));
          ctx.beginPath();
          for (let q = 0; q < 8; q++) {
            const a = (q * TWO_PI) / 8 + hash(q, e.t) * 0.4;
            ctx.moveTo(e.x + Math.cos(a) * 0.35 * R, e.y + Math.sin(a) * 0.35 * R);
            ctx.lineTo(e.x + Math.cos(a) * R, e.y + Math.sin(a) * R);
          }
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(e.x, e.y, 0.22 * unit * (1 - t), 0, TWO_PI);
          ctx.fill();
          break;
        }
        case EV_BLOCK: {
          if (age >= SPARK_MS * 1.3) break;
          const t = age / (SPARK_MS * 1.3);
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(2, 0.12 * unit);
          ctx.beginPath();
          ctx.arc(e.x, e.y, (0.2 + 0.5 * t) * unit, 0, TWO_PI);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(e.x, e.y, 0.18 * unit * (1 - t), 0, TWO_PI);
          ctx.fill();
          break;
        }
        case EV_CLASH: {
          // --- fl-overhaul --- two weapons met: a white star where they did
          if (age >= SPARK_MS * 1.4) break;
          const t = age / (SPARK_MS * 1.4);
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = Math.max(2, 0.12 * unit * (1 - t));
          ctx.beginPath();
          for (let q = 0; q < 6; q++) {
            const a = (q * TWO_PI) / 6 + 0.3;
            ctx.moveTo(e.x + Math.cos(a) * 0.2 * unit, e.y + Math.sin(a) * 0.2 * unit);
            ctx.lineTo(e.x + Math.cos(a) * (0.5 + 0.6 * t) * unit, e.y + Math.sin(a) * (0.5 + 0.6 * t) * unit);
          }
          ctx.stroke();
          ctx.strokeStyle = INK;
          ctx.lineWidth = Math.max(1, 0.04 * unit);
          ctx.beginPath();
          ctx.arc(e.x, e.y, (0.25 + 0.5 * t) * unit, 0, TWO_PI);
          ctx.stroke();
          break;
        }
        case EV_GRAZE: {
          // --- fl-overhaul --- a shot that grazed (refused by its window): a faint puff
          if (age >= POP_MS) break;
          const t = age / POP_MS;
          ctx.globalAlpha = 0.6 * (1 - t);
          ctx.strokeStyle = "#94a3b8";
          ctx.lineWidth = Math.max(1, 0.05 * unit);
          ctx.beginPath();
          ctx.arc(e.x, e.y, (0.15 + 0.35 * t) * unit, 0, TWO_PI);
          ctx.stroke();
          break;
        }
        case EV_LIGHTNING: {
          if (age >= LIGHTNING_MS) break;
          const t = age / LIGHTNING_MS;
          const topY = field.cy - field.half;
          ctx.globalAlpha = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
          ctx.lineJoin = "round";
          ctx.beginPath();
          const segs = 8;
          ctx.moveTo(e.x + (hash(0, e.t) - 0.5) * unit, topY);
          for (let q = 1; q < segs; q++) {
            const yy = topY + ((e.y - topY) * q) / segs;
            ctx.lineTo(e.x + (hash(q, e.t + k) - 0.5) * 1.2 * unit, yy);
          }
          ctx.lineTo(e.x, e.y);
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(3, 0.22 * unit);
          ctx.stroke();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = Math.max(1.2, 0.08 * unit);
          ctx.stroke();
          ctx.globalAlpha *= 0.5;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(e.x, e.y, 0.9 * unit * (1 - t), 0, TWO_PI);
          ctx.fill();
          break;
        }
        case EV_SHOCK: {
          if (age >= SHOCK_MS) break;
          const t = age / SHOCK_MS;
          ctx.globalAlpha = 0.85 * (1 - t);
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(2, 0.2 * unit * (1 - t));
          ctx.beginPath();
          ctx.arc(e.x, e.y, Math.max(1, e.value * (0.25 + 0.75 * Math.sqrt(t))), 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 0.15 * (1 - t);
          ctx.fillStyle = e.color;
          ctx.fill();
          break;
        }
        case EV_CUT: {
          if (age >= CUT_MS) break;
          const t = age / CUT_MS;
          ctx.globalAlpha = 1 - t;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = Math.max(2, 0.18 * unit * (1 - 0.6 * t));
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x2, e.y2);
          ctx.stroke();
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = Math.max(1, 0.06 * unit);
          ctx.stroke();
          break;
        }
        case EV_BLINK: {
          if (age >= BLINK_MS) break;
          const t = age / BLINK_MS;
          const f = view.fighters[e.slot];
          ctx.globalAlpha = 0.5 * (1 - t);
          ctx.fillStyle = f ? f.row.body : e.color;
          ctx.beginPath();
          ctx.arc(e.x, e.y, (f ? f.r : 0.6 * unit) * (1 + 0.3 * t), 0, TWO_PI);
          ctx.fill();
          ctx.strokeStyle = e.color;
          ctx.setLineDash([4, 5]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x2, e.y2);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case EV_CAST: {
          if (age >= CAST_MS) break;
          const t = age / CAST_MS;
          const f = view.fighters[e.slot];
          if (t < 0.5) {
            ctx.globalAlpha = 0.8 * (1 - 2 * t);
            ctx.strokeStyle = e.color;
            ctx.lineWidth = Math.max(2, 0.14 * unit);
            ctx.beginPath();
            ctx.arc(e.x, e.y, (0.8 + 2.2 * t) * unit, 0, TWO_PI);
            ctx.stroke();
          }
          if (f) {
            // The ability's name rises over the caster.
            const fs = Math.max(9, 0.36 * unit) * (t < 0.1 ? 0.7 + (3 * t) : 1);
            ctx.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
            ctx.font = this.font(fs, 900);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round";
            ctx.lineWidth = Math.max(2.5, 0.22 * fs);
            ctx.strokeStyle = INK;
            const ty = e.y - 1.9 * unit - 0.5 * unit * t;
            const name = f.row.ability.name;
            ctx.strokeText(name, e.x, ty);
            ctx.fillStyle = flNameColor(f.row.accent, f.row.body);
            ctx.fillText(name, e.x, ty);
          }
          break;
        }
        case EV_HEAL: {
          if (age >= HEAL_MS) break;
          const t = age / HEAL_MS;
          const fs = Math.max(10, 0.5 * unit);
          ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.font = this.font(fs, 900);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = Math.max(2.5, 0.2 * fs);
          ctx.strokeStyle = INK;
          const text = `+${Math.round(e.value)}`;
          const ty = e.y - 0.5 * unit - 0.8 * unit * t;
          ctx.strokeText(text, e.x, ty);
          ctx.fillStyle = "#4ade80";
          ctx.fillText(text, e.x, ty);
          break;
        }
        case EV_POP: {
          if (age >= POP_MS) break;
          const t = age / POP_MS;
          ctx.globalAlpha = 0.8 * (1 - t);
          ctx.fillStyle = e.color;
          for (let q = 0; q < 6; q++) {
            const a = (q * TWO_PI) / 6 + hash(q, e.t);
            const d = (0.3 + 0.9 * t) * unit;
            ctx.beginPath();
            ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 0.18 * unit * (1 - t), 0, TWO_PI);
            ctx.fill();
          }
          break;
        }
        case EV_FREEZE: {
          if (age >= FREEZE_MS) break;
          const t = age / FREEZE_MS;
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = "#7dd3fc";
          ctx.lineWidth = Math.max(1.5, 0.08 * unit);
          ctx.beginPath();
          for (let q = 0; q < 6; q++) {
            const a = (q * Math.PI) / 3;
            const d = (0.6 + 1.2 * t) * unit;
            ctx.moveTo(e.x + Math.cos(a) * 0.4 * unit, e.y + Math.sin(a) * 0.4 * unit);
            ctx.lineTo(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d);
          }
          ctx.stroke();
          break;
        }
        case EV_KO: {
          if (age >= KO_MS) break;
          this.drawKo(ctx, view, e.x, e.y, e.slot, e.color, age, o);
          break;
        }
        default:
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** A KO blast: shards of the body flying out, a shock ring and the "KO!" callout rising. */
  private drawKo(ctx: CanvasRenderingContext2D, view: FightLeagueView, x: number, y: number, slot: number, color: string, age: number, o: FightLeagueRenderOptions) {
    const f = view.fighters[slot];
    const R = f ? f.r : 10;
    const t = age / KO_MS;
    ctx.globalAlpha = 0.7 * (1 - t);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(x, y, R * (1 + 4 * t), 0, TWO_PI);
    ctx.stroke();
    const sec = age / 1000;
    for (let s = 0; s < SHARDS; s++) {
      const a = TWO_PI * (s / SHARDS + 0.3 * hash(s, slot));
      const speed = R * (3 + 5 * hash(s, slot + 7));
      const d = speed * sec * (1 - 0.35 * sec);
      const size = R * (0.16 + 0.22 * hash(s, slot + 3)) * (1 - 0.6 * t);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = s % 3 === 0 ? "#ffffff" : color;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d + 40 * sec * sec, size, 0, TWO_PI);
      ctx.fill();
    }
    const pop = t < 0.15 ? t / 0.15 : 1;
    const fs = Math.max(14, 1.1 * R) * (0.6 + 0.6 * pop);
    ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.font = this.font(fs, 900);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, 0.14 * fs);
    ctx.strokeStyle = INK;
    const ty = y - R - 0.4 * fs - 30 * t;
    ctx.strokeText(o.labels.ko, x, ty);
    ctx.fillStyle = "#fde047";
    ctx.fillText(o.labels.ko, x, ty);
  }

  /* ------------------------------------------------------------------ screen space */

  /**
   * The HUD inside the exported square: names, the time left, the VS card, the ability boxes, the KO flash and the winner
   * banner. `inset` moves the names below the page's buttons (live, a nearly square canvas). Returns the bottom of the names'
   * band (screen y; 0 without the HUD) – the top captions start below it; `boxesTop` is where the ability boxes start.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: FightLeagueView, o: FightLeagueRenderOptions, frame: { width: number; height: number; inset: number }): number {
    this.namesDrawn = 0;
    this.boxesDrawn = 0;
    this.vsShown = false;
    this.bannerShown = false;
    this.boxesTop = Infinity;
    const field = view.field;
    if (!field) return 0;
    this.begin(view, o);
    const side = Math.min(frame.width, frame.height);
    const left = (frame.width - side) / 2;
    const top = (frame.height - side) / 2;
    const now = view.timeMs;
    const L = o.labels;
    let hudBottom = 0;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (view.settings.hud) {
      hudBottom = this.drawNames(ctx, view, left, top + frame.inset, side, now);
      this.drawTimer(ctx, view, left, top + frame.inset, side, now);
      this.boxesTop = this.drawBoxes(ctx, view, left, top, side, now, L);
      if (now < view.introMs) this.drawVs(ctx, view, left, top, side, now, L);
    }
    // "FIGHT!" as the fighters launch.
    const fightAge = now - view.introMs;
    if (fightAge >= 0 && fightAge < FIGHT_FLASH_MS && !view.finished) {
      const t = fightAge / FIGHT_FLASH_MS;
      const fs = 0.11 * side * (t < 0.2 ? 0.7 + (1.5 * t) : 1);
      ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      this.bannerText(ctx, L.fight, left + side / 2, top + (FL_ARENA_TOP + FL_ARENA_FRAC / 2) * side, fs, "#a3e635");
      ctx.globalAlpha = 1;
    }
    // --- fl-overhaul --- sudden death: the banner as the arena starts to shrink
    const suddenAge = view.suddenMs >= 0 ? now - view.suddenMs : -1;
    if (suddenAge >= 0 && suddenAge < 1600 && !view.finished) {
      const t = suddenAge / 1600;
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      this.bannerText(ctx, L.sudden, left + side / 2, top + (FL_ARENA_TOP + 0.25 * FL_ARENA_FRAC) * side, 0.085 * side * (t < 0.15 ? 0.7 + 2 * t : 1), "#f87171", 0.84 * side);
      ctx.globalAlpha = 1;
    }
    this.drawKoFlash(ctx, view, left, top, side, now, L);
    if (view.finished && !o.teamBanner) this.drawWinner(ctx, view, left, top, side, now, L);
    ctx.restore();
    return hudBottom;
  }

  /** Where the ability boxes started last frame (screen y; Infinity without them): the bottom captions keep above it. */
  boxesTop = Infinity;

  private bannerText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number, color: string, maxWidth?: number) {
    ctx.font = this.font(fs, 900);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, 0.13 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    if (maxWidth) ctx.strokeText(text, x, y, maxWidth);
    else ctx.strokeText(text, x, y);
    ctx.shadowColor = color;
    ctx.shadowBlur = 0.25 * fs;
    ctx.fillStyle = color;
    if (maxWidth) ctx.fillText(text, x, y, maxWidth);
    else ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  /** The names in the band above the arena: left and right (stacked, two a side, with three or four fighters). */
  private drawNames(ctx: CanvasRenderingContext2D, view: FightLeagueView, left: number, top: number, side: number, now: number): number {
    const fighters = view.fighters;
    const n = fighters.length;
    if (n === 0) return 0;
    const band = FL_ARENA_TOP * side;
    const margin = 0.035 * side;
    const stacked = n > 2;
    const fs = stacked ? 0.034 * side : 0.054 * side;
    const sub = stacked ? 0 : 0.022 * side;
    const maxW = 0.42 * side;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const f of fighters) {
      // Left: the first of a pair (A, C; a 2v2's team A+B); right: the other (B, D; team C+D).
      const right = view.match === "2v2" ? f.team === 1 : f.slot % 2 === 1;
      const row = view.match === "2v2" ? f.slot % 2 : Math.floor(f.slot / 2);
      const y = stacked ? top + 0.3 * band + row * 1.25 * fs : top + 0.4 * band;
      const x = right ? left + side - margin : left + margin;
      const color = flNameColor(f.row.body, f.row.accent);
      ctx.globalAlpha = f.alive ? 1 : 0.4;
      ctx.textAlign = right ? "right" : "left";
      // A dot in the fighter's colours before (after) the name.
      const dot = 0.32 * fs;
      const dx = right ? x - dot : x + dot;
      ctx.fillStyle = f.row.body;
      ctx.beginPath();
      ctx.arc(dx, y, dot, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = f.row.accent;
      ctx.lineWidth = Math.max(1.5, 0.3 * dot);
      ctx.stroke();
      const tx = right ? x - 2.6 * dot : x + 2.6 * dot;
      ctx.font = this.font(fs, 900);
      ctx.lineWidth = Math.max(2.5, 0.16 * fs);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.strokeText(f.row.name, tx, y, maxW);
      ctx.fillStyle = color;
      ctx.fillText(f.row.name, tx, y, maxW);
      if (!f.alive) {
        // Struck through once knocked out.
        ctx.font = this.font(fs, 900);
        const w = Math.min(maxW, ctx.measureText(f.row.name).width);
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = Math.max(2, 0.1 * fs);
        ctx.beginPath();
        ctx.moveTo(right ? tx - w : tx, y);
        ctx.lineTo(right ? tx : tx + w, y);
        ctx.stroke();
      }
      if (sub > 0) {
        ctx.font = this.font(sub, 600);
        ctx.fillStyle = "#a1a1aa";
        ctx.fillText(f.row.source, tx, y + 0.95 * fs, maxW);
      }
      this.namesDrawn++;
    }
    ctx.globalAlpha = 1;
    // A small "VS" between the two names of a duel.
    if (n === 2 && now >= view.introMs) {
      ctx.textAlign = "center";
      ctx.font = this.font(0.03 * side, 900);
      ctx.fillStyle = "#71717a";
      ctx.fillText(VS_SMALL, left + side / 2, top + 0.4 * band);
    }
    return top + band;
  }

  /**
   * The time left to the cap (red in its last five seconds), centred under the band's VS – --- fl-overhaul --- counted from
   * FIGHT! (the VS card is not fighting time), frozen at the end.
   */
  private drawTimer(ctx: CanvasRenderingContext2D, view: FightLeagueView, left: number, top: number, side: number, now: number) {
    const cap = view.settings.timeCap;
    if (!(cap > 0)) return;
    const at = view.finished ? Math.min(now, view.finishMs) : now;
    const remaining = Math.max(0, Math.min(cap, cap - (at - view.introMs) / 1000));
    const secs = Math.ceil(remaining - 1e-6);
    if (secs !== this.timerSec) {
      this.timerSec = secs;
      this.timerText = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    }
    const band = FL_ARENA_TOP * side;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = this.font(0.026 * side, 700, true);
    ctx.fillStyle = secs <= 5 && !view.finished ? "#f87171" : "#a1a1aa";
    ctx.fillText(this.timerText, left + side / 2, top + (view.fighters.length === 2 ? 0.75 : 0.5) * band);
  }

  /** The ability boxes along the bottom: the name (flashing through its telegraph), the meter and two stat lines. Returns their top. */
  private drawBoxes(ctx: CanvasRenderingContext2D, view: FightLeagueView, left: number, top: number, side: number, now: number, L: FightLeagueLabels): number {
    const n = view.fighters.length;
    if (n === 0) return Infinity;
    const y0 = top + (FL_ARENA_TOP + FL_ARENA_FRAC) * side + 0.022 * side;
    const h = (1 - FL_ARENA_TOP - FL_ARENA_FRAC) * side - 0.04 * side;
    const gap = 0.02 * side;
    const x0 = left + 0.035 * side;
    const total = side - 0.07 * side;
    const w = (total - (n - 1) * gap) / n;
    const pad = 0.1 * h;
    const nameFs = Math.min(0.2 * h, (n > 2 ? 0.07 : 0.085) * w);
    const statFs = Math.min(0.15 * h, (n > 2 ? 0.065 : 0.055) * w);
    for (const f of view.fighters) {
      const x = x0 + f.slot * (w + gap);
      const telegraph = f.telegraphUntil >= 0;
      const blink = telegraph && Math.floor(now / 70) % 2 === 0;
      const castAge = this.castAge(view, f.slot, now);
      ctx.globalAlpha = f.alive ? 1 : 0.45;
      // The box: dark, rimmed in the fighter's accent (white while it flashes).
      ctx.fillStyle = "rgba(15, 15, 20, 0.88)";
      roundRect(ctx, x, y0, w, h, 0.14 * h);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, (telegraph ? 0.05 : 0.025) * h);
      ctx.strokeStyle = blink ? "#ffffff" : f.row.accent;
      if (telegraph || castAge < 300) {
        ctx.shadowColor = f.row.accent;
        ctx.shadowBlur = 0.35 * h;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // The ability's name (the fighter's own dot before it).
      const dot = 0.32 * nameFs;
      ctx.fillStyle = f.row.body;
      ctx.beginPath();
      ctx.arc(x + pad + dot, y0 + pad + 0.55 * nameFs, dot, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = f.row.accent;
      ctx.lineWidth = Math.max(1, 0.3 * dot);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = this.font(nameFs, 900);
      ctx.fillStyle = blink ? f.row.accent : telegraph ? "#ffffff" : "#f4f4f5";
      ctx.fillText(f.row.ability.name, x + pad + 2.6 * dot, y0 + pad + 0.55 * nameFs, w - 2 * pad - 2.6 * dot);
      // The meter.
      const my = y0 + pad + 1.25 * nameFs;
      const mh = Math.max(3, 0.13 * h);
      const mw = w - 2 * pad;
      ctx.fillStyle = "#27272a";
      roundRect(ctx, x + pad, my, mw, mh, 0.5 * mh);
      ctx.fill();
      const meter = telegraph ? 1 : Math.max(0, Math.min(1, f.meter));
      if (meter > 0) {
        ctx.fillStyle = meter >= 1 ? (blink || Math.floor(now / 140) % 2 === 0 ? "#ffffff" : f.row.accent) : f.row.accent;
        roundRect(ctx, x + pad, my, Math.max(mh, mw * meter), mh, 0.5 * mh);
        ctx.fill();
      }
      // --- fl-overhaul --- a full meter waiting for its moment (a foe in range, a foe at all) says READY on it
      if (!telegraph && f.alive && meter >= 1 && !view.finished) {
        const rf = Math.max(7, Math.min(1.5 * mh, 0.9 * statFs));
        ctx.font = this.font(rf, 900);
        ctx.textAlign = "center";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(2, 0.22 * rf);
        ctx.strokeStyle = INK;
        ctx.strokeText(L.ready, x + pad + mw / 2, my + mh / 2, mw);
        ctx.fillStyle = "#fde047";
        ctx.fillText(L.ready, x + pad + mw / 2, my + mh / 2, mw);
        ctx.textAlign = "left";
      }
      // Two stat lines: damage and speed, attack speed and cast speed (buffs in lime, debuffs in red).
      const st = this.statText(view, f, now, L);
      const ly1 = my + mh + 0.75 * statFs + 0.04 * h;
      const ly2 = ly1 + 1.2 * statFs;
      const colW = mw / 2;
      ctx.font = this.font(statFs, 700);
      ctx.textAlign = "left";
      const statColor = (up: number) => (up > 0 ? "#a3e635" : up < 0 ? "#f87171" : "#d4d4d8");
      ctx.fillStyle = statColor(st.dmgUp);
      ctx.fillText(st.dmg, x + pad, ly1, colW - 2);
      ctx.fillStyle = statColor(st.spdUp);
      ctx.fillText(st.spd, x + pad + colW, ly1, colW - 2);
      ctx.fillStyle = statColor(st.atkUp);
      ctx.fillText(st.atk, x + pad, ly2, colW - 2);
      ctx.fillStyle = statColor(st.castUp);
      ctx.fillText(st.cast, x + pad + colW, ly2, colW - 2);
      if (!f.alive) {
        ctx.globalAlpha = 0.9;
        ctx.textAlign = "center";
        ctx.font = this.font(0.42 * h, 900);
        ctx.fillStyle = "#ef4444";
        ctx.fillText(L.ko, x + w / 2, y0 + h / 2);
      }
      this.boxesDrawn++;
    }
    ctx.globalAlpha = 1;
    return y0;
  }

  /** Simulation ms since `slot` last cast its ability (Infinity when it has not; --- fl-overhaul --- no scan of the event ring). */
  private castAge(view: FightLeagueView, slot: number, now: number): number {
    const f = view.fighters[slot];
    const age = f ? now - f.lastCastMs : Infinity;
    return age >= 0 ? age : Infinity;
  }

  /** The stat lines' texts of `f` (rebuilt only when a shown value changes). */
  private statText(view: FightLeagueView, f: FlFighter, now: number, L: FightLeagueLabels): StatText {
    const ts = now < view.slowTimeUntil && f.team !== view.slowTimeTeam ? view.slowTimeFactor : 1;
    const dmg = f.damage * (now < f.dmgMulUntil ? f.dmgMul : 1);
    let spd = f.speed * ts;
    if (now < f.speedMulUntil) spd *= f.speedMul;
    if (now < f.slowUntil) spd *= f.slowFactor;
    if (now < f.confusedUntil) spd *= 0.6;
    if (now < f.frozenUntil || f.heldBy >= 0) spd = 0;
    const atk = f.attack * ts * (now < f.atkMulUntil ? f.atkMul : 1);
    const cast = f.cast * ts;
    const q = (v: number) => Math.round(v * 100);
    const key = ((q(dmg) * 7919 + q(spd)) * 7919 + q(atk)) * 7919 + q(cast);
    let st = this.stats[f.slot];
    if (st && st.key === key) return st;
    const fmt = (v: number) => `×${(Math.round(v * 100) / 100).toFixed(2)}`;
    const cmp = (v: number, base: number) => (q(v) > q(base) ? 1 : q(v) < q(base) ? -1 : 0);
    st = {
      key,
      dmg: `${L.damage} ${fmt(dmg)}`,
      spd: `${L.speed} ${fmt(spd)}`,
      atk: `${L.attack} ${fmt(atk)}`,
      cast: `${L.cast} ${fmt(cast)}`,
      dmgUp: cmp(dmg, f.damage),
      spdUp: cmp(spd, f.speed),
      atkUp: cmp(atk, f.attack),
      castUp: cmp(cast, f.cast),
    };
    this.stats[f.slot] = st;
    return st;
  }

  /** The intro card: the fighters' names flying in around a big "VS" (2v2: the teams; a free-for-all: every name). */
  private drawVs(ctx: CanvasRenderingContext2D, view: FightLeagueView, left: number, top: number, side: number, now: number, L: FightLeagueLabels) {
    const t = Math.max(0, now / Math.max(1, view.introMs));
    const fade = t > 0.82 ? Math.max(0, 1 - (t - 0.82) / 0.18) : 1;
    const slide = Math.min(1, t / 0.22);
    const ease = 1 - (1 - slide) ** 3;
    const cx = left + side / 2;
    const cy = top + (FL_ARENA_TOP + FL_ARENA_FRAC / 2) * side;
    ctx.globalAlpha = 0.55 * fade;
    ctx.fillStyle = "#09090b";
    ctx.fillRect(left + (0.5 - FL_ARENA_FRAC / 2) * side, top + FL_ARENA_TOP * side, FL_ARENA_FRAC * side, FL_ARENA_FRAC * side);
    ctx.globalAlpha = fade;
    const fighters = view.fighters;
    const vsPop = t < 0.15 ? 0.4 : t < 0.3 ? 0.4 + (0.6 * (t - 0.15)) / 0.15 : 1;
    if (view.match === "1v1" || fighters.length === 2) {
      const fs = 0.075 * side;
      const a = fighters[0];
      const b = fighters[1];
      if (a) this.bannerText(ctx, a.row.name, cx - (0.18 + 0.5 * (1 - ease)) * side, cy - 0.13 * side, fs, flNameColor(a.row.body, a.row.accent), 0.6 * side);
      if (b) this.bannerText(ctx, b.row.name, cx + (0.18 + 0.5 * (1 - ease)) * side, cy + 0.13 * side, fs, flNameColor(b.row.body, b.row.accent), 0.6 * side);
    } else if (view.match === "2v2") {
      const fs = 0.05 * side;
      for (const f of fighters) {
        const dir = f.team === 0 ? -1 : 1;
        const y = cy + (f.team === 0 ? -0.2 : 0.11) * side + (f.slot % 2) * 1.15 * fs;
        this.bannerText(ctx, f.row.name, cx + dir * (0.12 + 0.5 * (1 - ease)) * side, y, fs, flNameColor(f.row.body, f.row.accent), 0.5 * side);
      }
    } else {
      const fs = 0.048 * side;
      for (const f of fighters) {
        const dx = (f.slot % 2 === 0 ? -1 : 1) * (0.17 + 0.5 * (1 - ease)) * side;
        const dy = (f.slot < 2 ? -1 : 1) * 0.13 * side;
        this.bannerText(ctx, f.row.name, cx + dx, cy + dy, fs, flNameColor(f.row.body, f.row.accent), 0.34 * side);
      }
    }
    this.bannerText(ctx, L.vs, cx, cy, 0.14 * side * vsPop, "#a3e635");
    ctx.globalAlpha = 1;
    this.vsShown = true;
  }

  /** "KO!" over the arena and a white flash for a moment after each knockout. */
  private drawKoFlash(ctx: CanvasRenderingContext2D, view: FightLeagueView, left: number, top: number, side: number, now: number, L: FightLeagueLabels) {
    const newest = now - view.lastKoMs; // (--- fl-overhaul --- the view keeps the last KO: no scan of the event ring)
    if (!(newest >= 0 && newest < KO_FLASH_MS)) return;
    const t = newest / KO_FLASH_MS;
    const ax = left + (0.5 - FL_ARENA_FRAC / 2) * side;
    const ay = top + FL_ARENA_TOP * side;
    ctx.globalAlpha = 0.3 * (1 - t) * (1 - t);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ax, ay, FL_ARENA_FRAC * side, FL_ARENA_FRAC * side);
    if (view.finished && view.doubleKo) return; // the banner says it
    const pop = t < 0.15 ? 0.6 + (0.4 * t) / 0.15 : 1;
    ctx.globalAlpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
    this.bannerText(ctx, L.ko, left + side / 2, ay + 0.3 * FL_ARENA_FRAC * side, 0.16 * side * pop, "#fde047");
    ctx.globalAlpha = 1;
  }

  /** The winner banner with confetti (analytic: it replays with the clock and freezes with a pause). */
  private drawWinner(ctx: CanvasRenderingContext2D, view: FightLeagueView, left: number, top: number, side: number, now: number, L: FightLeagueLabels) {
    const age = Math.max(0, now - view.finishMs) / 1000;
    const winners = view.fighters.filter((f) => view.winnerTeam >= 0 && f.team === view.winnerTeam);
    const lead = winners.find((f) => f.alive) ?? winners[0] ?? null;
    const color = lead ? flNameColor(lead.row.body, lead.row.accent) : "#e4e4e7";
    if (lead) {
      for (let i = 0; i < CONFETTI; i++) {
        const start = 0.4 * hash(i, 1);
        const t = age - start;
        if (t < 0) continue;
        const fall = side * (0.25 + 0.2 * hash(i, 2));
        const yy = (-0.05 * side + fall * t) % (1.1 * side);
        const x = left + side * hash(i, 3) + 0.03 * side * Math.sin(3 * t + 6 * hash(i, 4));
        const y = top + yy;
        const size = 0.008 * side * (0.6 + hash(i, 5));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * (2 + 4 * hash(i, 6)));
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = i % 3 === 0 ? GOLD : i % 3 === 1 ? color : "#ffffff";
        ctx.fillRect(-size, -0.5 * size, 2 * size, size);
        ctx.restore();
      }
    }
    let title: string;
    let sub = "";
    if (view.doubleKo) title = L.doubleKo;
    else if (!lead) title = L.draw;
    else if (winners.length > 1) title = L.winTeam(winners.map((f) => f.row.name).join(" + "));
    else title = L.wins(lead.row.name);
    if (lead) {
      let hp = 0;
      let hits = 0;
      for (const f of winners) {
        hp += Math.max(0, f.alive ? f.hp : 0);
        hits += f.hits;
      }
      sub = L.winSub(Math.ceil(hp - 1e-6), hits);
    }
    if (view.byTime) sub = sub ? `${L.time} · ${sub}` : L.time;
    const pop = Math.min(1, age / 0.25);
    const fs = 0.095 * side * (0.6 + 0.4 * pop);
    const cy = top + (FL_ARENA_TOP + FL_ARENA_FRAC / 2) * side;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(9, 9, 11, 0.72)";
    roundRect(ctx, left + 0.06 * side, cy - 0.65 * fs, 0.88 * side, 1.3 * fs + (sub ? 0.55 * fs : 0), 0.25 * fs);
    ctx.fill();
    this.bannerText(ctx, title, left + side / 2, cy, fs, color, 0.84 * side);
    if (sub) {
      const sfs = 0.34 * fs;
      ctx.font = this.font(sfs, 700);
      ctx.lineWidth = Math.max(2, 0.14 * sfs);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.strokeText(sub, left + side / 2, cy + 0.85 * fs, 0.84 * side);
      ctx.fillStyle = "#f4f4f5";
      ctx.fillText(sub, left + side / 2, cy + 0.85 * fs, 0.84 * side);
    }
    this.bannerShown = true;
  }
}

const VS_SMALL = "VS";

/** The data attributes of a Fight League run (data-fl-*), for tools and the smoke test. */
export const FIGHT_LEAGUE_DATA_KEYS = [
  "flMatch",
  "flArena",
  "flNames",
  "flIds",
  "flHp",
  "flMaxHp",
  "flHits",
  "flCasts",
  "flAbilities",
  "flAlive",
  "flKos",
  "flShots",
  "flBlocks",
  "flClashes",
  "flSounds",
  "flWinner",
  "flWinnerTeam",
  "flFinished",
  "flFinishSec",
  "flDoubleKo",
  "flByTime",
  "flForced",
  "flHud",
  "flHudNames",
  "flBoxes",
  "flBoxesTop", // where the ability boxes start (canvas px; "" without them): the bottom captions keep above it
  "flVs", // the VS card was drawn this run
  "flBanner",
  "flFighters",
  "flWeapons",
  "flProjectiles",
  "flTime",
  // --- fl-overhaul --- the fair hit pipeline's counters and sudden death
  "flGrazes",
  "flClashes2",
  "flImmunes",
  "flInterrupts",
  "flDodges",
  "flSudden",
];

/** Writes the data-fl-* attributes (the strings are rebuilt only when their values change). */
export class FightLeagueDataset {
  private generation = -1;
  private names = "";
  private ids = "";
  private abilities = "";
  private maxHp = "";
  private hpKey = "";
  /** The VS card was drawn this run. */
  private vsSeen = false;

  write(view: FightLeagueView, layer: FightLeagueLayer, set: (key: string, value: string) => void) {
    if (view.generation !== this.generation || this.names === "") {
      this.generation = view.generation;
      this.names = view.fighters.map((f) => f.row.name).join(",");
      this.ids = view.fighters.map((f) => f.row.id).join(",");
      this.abilities = view.fighters.map((f) => f.row.ability.name).join(",");
      this.maxHp = view.fighters.map((f) => String(Math.round(f.maxHp * 10) / 10)).join(",");
      this.hpKey = "";
      this.vsSeen = false;
    }
    let key = "";
    for (const f of view.fighters) key += `${Math.round(Math.max(0, f.hp) * 10)}/${f.hits}/${f.casts}/${f.alive ? 1 : 0};`;
    if (key !== this.hpKey) {
      this.hpKey = key;
      set("flHp", view.fighters.map((f) => String(Math.round(Math.max(0, f.hp) * 10) / 10)).join(","));
      set("flHits", view.fighters.map((f) => String(f.hits)).join(","));
      set("flCasts", view.fighters.map((f) => String(f.casts)).join(","));
      set("flAlive", view.fighters.map((f) => (f.alive ? "1" : "0")).join(","));
    }
    set("flMatch", view.match);
    set("flArena", view.field?.kind ?? "");
    set("flNames", this.names);
    set("flIds", this.ids);
    set("flAbilities", this.abilities);
    set("flMaxHp", this.maxHp);
    set("flKos", String(view.kos));
    set("flShots", String(view.shots));
    set("flBlocks", String(view.blocks));
    set("flClashes", String(view.clashes));
    set("flSounds", String(view.sounds));
    let winner = "";
    if (view.finished) {
      if (view.doubleKo) winner = "double-ko";
      else if (view.winnerTeam < 0) winner = "draw";
      else winner = view.fighters.filter((f) => f.team === view.winnerTeam).map((f) => f.row.name).join(" + ");
    }
    set("flWinner", winner);
    set("flWinnerTeam", view.finished ? String(view.winnerTeam) : "");
    set("flFinished", view.finished ? "1" : "0");
    set("flFinishSec", view.finished ? (view.finishMs / 1000).toFixed(3) : "");
    set("flDoubleKo", view.doubleKo ? "1" : "0");
    set("flByTime", view.byTime ? "1" : "0");
    set("flForced", String(view.forcedWinner));
    set("flHud", view.settings.hud ? "1" : "0");
    set("flHudNames", String(layer.namesDrawn));
    set("flBoxes", String(layer.boxesDrawn));
    set("flBoxesTop", layer.boxesTop < Infinity ? layer.boxesTop.toFixed(1) : "");
    if (layer.vsShown) this.vsSeen = true;
    set("flVs", this.vsSeen ? "1" : "0");
    set("flBanner", layer.bannerShown ? "1" : "0");
    set("flFighters", String(layer.fightersDrawn));
    set("flWeapons", String(layer.weaponsDrawn));
    set("flProjectiles", String(layer.projectilesDrawn));
    set("flTime", (view.timeMs / 1000).toFixed(1));
    set("flGrazes", String(view.grazes)); // --- fl-overhaul ---
    set("flClashes2", String(view.clashes2));
    set("flImmunes", String(view.immunes));
    set("flInterrupts", String(view.interrupts));
    set("flDodges", String(view.dodges));
    set("flSudden", view.suddenMs >= 0 ? "1" : "0");
  }
}
