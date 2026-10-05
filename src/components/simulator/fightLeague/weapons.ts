import { punchExtension, whipExtension, type FightLeagueView, type FlFighter, type FlWeaponState } from "@/lib/physics/modes/fightLeague";
import type { FlShape } from "@/lib/physics/modes/fightLeagueRoster";
import type { FlFrame } from "./frame";
import { INK, luminance, shade } from "./palette";
import { DEG, TWO_PI, hash, makeSprite, roundRectPath, starPath, type Box, type Sprite } from "./sprites";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's weapons: every kind's vector silhouette (canvas paths in a local frame, +x
 * forward – no image assets), built once per fighter, weapon, look and size into a sprite, and their motion drawn live
 * from the weapon's state – the sword's crescent smear and its looks (katana, greatsword, scrolling chainsaw teeth,
 * trident, rapier, double, saber bloom), the hammer's three ghost heads and its looks (block, pan, mallet), speed lines at
 * a fist's full extension and a boot's smear, three slash marks after a claw swipe, a chain's sagging links and its taut
 * yank, a bow drawn back before it looses, a gun's muzzle star, recoil and flying casing (a minigun's spinning barrel), a
 * wand's sparkle, a staff's orb growing toward its shot, a book's pages, the cards' orbit ring, the breath's three cached
 * flame frames and embers, a beam's glint and aim line, a spark's forked bolt, a shield's refilling guard, a tail's swing
 * smear, a whip's tapered lash and its snap.
 */

/** The colours a fighter's sprites use. */
export interface FlPaint {
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

/** A sword's look: blade, saber (a lightsaber), double, katana, greatsword, chainsaw, trident, rapier. */
export type FlSwordLook = "blade" | "saber" | "double" | "katana" | "greatsword" | "chainsaw" | "trident" | "rapier";

function grip(g: CanvasRenderingContext2D, r: number, p: FlPaint, x0: number, len: number, half: number) {
  g.fillStyle = shade(p.body, -0.45);
  g.beginPath();
  g.rect(x0, -half, len, 2 * half);
  g.fill();
  g.stroke();
  g.fillStyle = p.accent;
  g.beginPath();
  g.arc(x0, 0, 1.25 * half, 0, TWO_PI);
  g.fill();
  g.stroke();
}

/** A sword from the grip inside the ball to the tip `reach` radii past the rim (`frame`: the chainsaw's teeth phase). */
export function drawSword(g: CanvasRenderingContext2D, r: number, reach: number, size: number, look: FlSwordLook, p: FlPaint, frame = 0) {
  const tip = r + reach * r;
  const width = look === "greatsword" ? 1.3 : look === "rapier" ? 0.5 : 1;
  const hw = Math.max(0.6, 0.5 * size * r * width);
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.lineJoin = "round";
  if (look === "saber") {
    // The emitter hilt, then the blade: a colour glow around a white core (the glow baked here, on the sprite's own canvas).
    g.fillStyle = "#9ca3af";
    g.beginPath();
    g.rect(0.55 * r, -0.13 * r, 0.5 * r, 0.26 * r);
    g.fill();
    g.stroke();
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
    g.shadowColor = "rgba(0, 0, 0, 0)";
    g.strokeStyle = "#ffffff";
    g.lineWidth = 1.1 * hw;
    g.stroke();
    return;
  }
  if (look === "chainsaw") {
    // A motor block, a bar with a rounded nose and teeth along both edges (shifted by `frame`: they run with the clock).
    g.fillStyle = p.accent;
    roundRectPath(g, 0.5 * r, -0.32 * r, 0.62 * r, 0.64 * r, 0.12 * r);
    g.fill();
    g.stroke();
    const bh = Math.max(1.2, 0.2 * r);
    g.fillStyle = "#9ca3af";
    roundRectPath(g, 1.08 * r, -bh, tip - 1.08 * r, 2 * bh, bh);
    g.fill();
    g.stroke();
    const step = Math.max(2, 0.26 * r);
    const shift = (frame / 3) * step;
    g.fillStyle = INK;
    for (let x = 1.12 * r + shift; x < tip - bh; x += step) {
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(x, sgn * bh);
        g.lineTo(x + 0.5 * step, sgn * bh);
        g.lineTo(x + 0.25 * step, sgn * (bh + 0.45 * step));
        g.closePath();
        g.fill();
      }
    }
    return;
  }
  if (look === "trident") {
    // A shaft and three tines.
    g.lineCap = "round";
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1.6, 0.2 * r);
    g.beginPath();
    g.moveTo(0.4 * r, 0);
    g.lineTo(tip - 0.6 * r, 0);
    g.stroke();
    g.strokeStyle = shade(p.accent, -0.2);
    g.lineWidth = Math.max(1, 0.12 * r);
    g.stroke();
    const bx = tip - 0.75 * r;
    g.fillStyle = p.color;
    g.strokeStyle = INK;
    g.lineWidth = Math.max(0.8, 0.05 * r);
    g.beginPath();
    g.moveTo(bx, -0.42 * r);
    g.lineTo(bx + 0.18 * r, -0.42 * r);
    g.lineTo(bx + 0.18 * r, 0.42 * r);
    g.lineTo(bx, 0.42 * r);
    g.closePath();
    g.fill();
    g.stroke();
    for (const y of [-0.34, 0, 0.34]) {
      const len = y === 0 ? 0.75 * r : 0.55 * r;
      g.beginPath();
      g.moveTo(bx + 0.18 * r, y * r - 0.07 * r);
      g.lineTo(bx + 0.18 * r + len, y * r);
      g.lineTo(bx + 0.18 * r, y * r + 0.07 * r);
      g.closePath();
      g.fill();
      g.stroke();
    }
    return;
  }
  if (look === "katana") {
    // A long thin curved blade, a round guard and a wrapped grip.
    grip(g, r, p, 0.5 * r, 0.48 * r, 0.075 * r);
    g.fillStyle = INK;
    g.beginPath();
    g.ellipse(1.0 * r, 0, 0.06 * r, 0.22 * r, 0, 0, TWO_PI);
    g.fill();
    g.fillStyle = p.color;
    g.strokeStyle = INK;
    g.lineWidth = Math.max(0.8, 0.05 * r);
    g.beginPath();
    g.moveTo(1.06 * r, -hw);
    g.quadraticCurveTo(0.5 * (1.06 * r + tip), -hw - 0.18 * r, tip, -0.12 * r);
    g.quadraticCurveTo(0.5 * (1.06 * r + tip), hw - 0.1 * r, 1.06 * r, hw);
    g.closePath();
    g.fill();
    g.stroke();
    return;
  }
  if (look === "rapier") {
    // A slim blade behind a cup guard.
    grip(g, r, p, 0.5 * r, 0.42 * r, 0.07 * r);
    g.fillStyle = p.accent;
    g.beginPath();
    g.arc(0.98 * r, 0, 0.3 * r, -Math.PI / 2, Math.PI / 2);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = p.color;
    bladePath(g, 1.0 * r, tip, Math.max(0.6, 0.6 * hw));
    g.fill();
    g.stroke();
    return;
  }
  // blade, double, greatsword: grip and pommel, the crossguard in the accent colour (a double blade's round binding – the
  // painter draws the half twice, back to back), then the blade with its fuller.
  grip(g, r, p, 0.55 * r, 0.42 * r, 0.08 * r);
  const guard = Math.max(hw * 2.4, (look === "greatsword" ? 0.55 : 0.42) * r);
  g.fillStyle = p.accent;
  g.beginPath();
  if (look === "double") g.arc(1.0 * r, 0, Math.max(1.6 * hw, 0.2 * r), 0, TWO_PI);
  else g.rect(0.95 * r, -guard, 0.13 * r, 2 * guard);
  g.fill();
  g.stroke();
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

function swordBox(r: number, reach: number, size: number, look: FlSwordLook): Box {
  const width = look === "greatsword" ? 1.3 : 1;
  const hw = Math.max(0.6, 0.5 * size * r * width);
  const pad = look === "saber" ? 1.1 * r : look === "trident" ? 0.5 * r : look === "chainsaw" ? 0.45 * r : Math.max(hw * 2.4, 0.55 * r) + 2;
  return { x0: 0.3 * r, y0: -pad, x1: r + reach * r + (look === "saber" ? 1.1 * r : look === "trident" ? 0.3 * r : 2), y1: pad };
}

/** A hammer's look: a banded block, a frying pan, a wooden mallet. */
export type FlHammerLook = "block" | "pan" | "mallet";

/** A hammer's head centred on the origin (`size` radii), its handle along −x. */
export function drawHammerHead(g: CanvasRenderingContext2D, r: number, size: number, p: FlPaint, handle: number, look: FlHammerLook = "block") {
  const hs = size * r;
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.lineJoin = "round";
  if (handle > 0) {
    g.fillStyle = look === "pan" ? INK : "#7c5a3c";
    g.beginPath();
    g.rect(-handle, -0.07 * r, handle, 0.14 * r);
    g.fill();
    g.stroke();
  }
  if (look === "pan") {
    // A frying pan seen from above: the rim, the dark cooking face, a glint.
    g.fillStyle = "#3f3f46";
    g.beginPath();
    g.arc(0.25 * hs, 0, 1.05 * hs, 0, TWO_PI);
    g.fill();
    g.stroke();
    g.fillStyle = "#18181b";
    g.beginPath();
    g.arc(0.25 * hs, 0, 0.82 * hs, 0, TWO_PI);
    g.fill();
    g.strokeStyle = "rgba(255, 255, 255, 0.35)";
    g.lineWidth = Math.max(0.8, 0.08 * hs);
    g.beginPath();
    g.arc(0.25 * hs, 0, 0.6 * hs, -2.4, -1.5);
    g.stroke();
    return;
  }
  if (look === "mallet") {
    // A wooden mallet: a barrel head with its end grain and two iron bands.
    g.fillStyle = "#b07a4a";
    roundRectPath(g, -0.62 * hs, -1.1 * hs, 1.24 * hs, 2.2 * hs, 0.5 * hs);
    g.fill();
    g.stroke();
    g.fillStyle = "#6b7280";
    g.fillRect(-0.62 * hs, -0.78 * hs, 1.24 * hs, 0.16 * hs);
    g.fillRect(-0.62 * hs, 0.62 * hs, 1.24 * hs, 0.16 * hs);
    g.strokeStyle = "rgba(0, 0, 0, 0.25)";
    g.lineWidth = Math.max(0.6, 0.05 * hs);
    g.beginPath();
    g.moveTo(-0.3 * hs, -0.5 * hs);
    g.lineTo(-0.3 * hs, 0.5 * hs);
    g.moveTo(0.2 * hs, -0.45 * hs);
    g.lineTo(0.2 * hs, 0.45 * hs);
    g.stroke();
    return;
  }
  g.fillStyle = "#9ca3af";
  roundRectPath(g, -0.7 * hs, -1.05 * hs, 1.4 * hs, 2.1 * hs, 0.18 * hs);
  g.fill();
  g.stroke();
  g.fillStyle = "#d1d5db";
  g.fillRect(-0.7 * hs + 1, -1.05 * hs + 1, 0.45 * hs, 2.1 * hs - 2);
  g.fillStyle = p.accent;
  g.fillRect(-0.7 * hs, -0.42 * hs, 1.4 * hs, 0.18 * hs);
  g.fillRect(-0.7 * hs, 0.24 * hs, 1.4 * hs, 0.18 * hs);
}

/** A spiked ball / kunai / blade head on a chain (the chain itself is drawn live). */
export function drawChainHead(g: CanvasRenderingContext2D, r: number, size: number, shape: FlShape, p: FlPaint) {
  const hs = size * r;
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.lineJoin = "round";
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
    g.beginPath();
    g.rect(-1.3 * hs, -0.18 * hs, 0.5 * hs, 0.36 * hs);
    g.fill();
    g.stroke();
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

/** A fist (a glove in the accent colour with knuckle lines) or a boot (`kick`). */
export function drawFist(g: CanvasRenderingContext2D, r: number, size: number, p: FlPaint, kick: boolean) {
  const s = size * r;
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.fillStyle = p.accent;
  g.lineJoin = "round";
  if (kick) {
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

/** A curl of air at rest (the air fists): a spiral in the fighter's colour with an ink outline. */
export function drawAirCurl(g: CanvasRenderingContext2D, s: number, p: FlPaint) {
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
export function drawClaws(g: CanvasRenderingContext2D, r: number, size: number, p: FlPaint) {
  const s = size * r;
  g.lineWidth = Math.max(0.6, 0.05 * r);
  g.strokeStyle = INK;
  g.lineJoin = "round";
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

/** A bow at the rim with its string (drawn back with an arrow nocked when `nocked`). */
export function drawBow(g: CanvasRenderingContext2D, r: number, p: FlPaint, nocked: boolean) {
  const R = 0.95 * r;
  const cx = 0.38 * r;
  g.lineCap = "round";
  g.lineJoin = "round";
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
  const pull = nocked ? 0.42 * r : ex;
  g.strokeStyle = "#e5e7eb";
  g.lineWidth = Math.max(0.6, 0.035 * r);
  g.beginPath();
  g.moveTo(ex, -ey);
  g.lineTo(pull, 0);
  g.lineTo(ex, ey);
  g.stroke();
  if (nocked) {
    g.strokeStyle = INK;
    g.lineWidth = Math.max(0.8, 0.06 * r);
    g.beginPath();
    g.moveTo(pull, 0);
    g.lineTo(1.45 * r, 0);
    g.stroke();
    g.fillStyle = p.color;
    g.beginPath();
    g.moveTo(1.62 * r, 0);
    g.lineTo(1.38 * r, -0.12 * r);
    g.lineTo(1.38 * r, 0.12 * r);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

/** A gun's look: pistol, rifle, minigun, cannon, launcher, blaster, portal (and the arm cannon of plasma shots). */
export type FlGunLook = "pistol" | "rifle" | "minigun" | "cannon" | "launcher" | "blaster" | "portal";

/** The gun look of a weapon: its own look, else by its shot and style (a rocket: launcher, plasma: cannon, a burst: rifle). */
export function gunLookOf(look: string | undefined, shape: FlShape, burst: boolean, shotgun: boolean): FlGunLook {
  if (look === "pistol" || look === "rifle" || look === "minigun" || look === "cannon" || look === "launcher" || look === "blaster" || look === "portal") return look;
  if (shape === "rocket") return "launcher";
  if (shape === "plasma" || shape === "charge") return "cannon";
  if (shotgun || burst) return "rifle";
  return "pistol";
}

/** A gun at the rim (`frame`: the minigun barrel's turn, 0–2). */
export function drawGun(g: CanvasRenderingContext2D, r: number, look: FlGunLook, shotgun: boolean, p: FlPaint, frame = 0) {
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.lineJoin = "round";
  if (look === "cannon" || look === "blaster" || look === "portal") {
    // An arm cannon (a fat barrel with a glowing muzzle), a blaster (finned), a portal gun (a white body and a glowing tip).
    const body = look === "portal" ? "#f8fafc" : look === "blaster" ? "#374151" : p.accent;
    g.fillStyle = body;
    roundRectPath(g, 0.55 * r, -0.3 * r, (look === "blaster" ? 0.9 : 1.05) * r, 0.6 * r, 0.22 * r);
    g.fill();
    g.stroke();
    g.fillStyle = look === "portal" ? "#9ca3af" : shade(p.accent, -0.35);
    g.fillRect(0.75 * r, -0.3 * r, 0.12 * r, 0.6 * r);
    if (look === "blaster") {
      g.fillStyle = p.accent;
      g.beginPath();
      g.moveTo(0.9 * r, -0.3 * r);
      g.lineTo(1.15 * r, -0.5 * r);
      g.lineTo(1.3 * r, -0.3 * r);
      g.closePath();
      g.fill();
      g.stroke();
    }
    if (look === "portal") {
      // two prongs reaching round the glowing tip
      g.fillStyle = "#e5e7eb";
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(1.48 * r, sgn * 0.12 * r);
        g.lineTo(1.84 * r, sgn * 0.32 * r);
        g.lineTo(1.74 * r, sgn * 0.08 * r);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    g.fillStyle = look === "portal" ? "#38bdf8" : p.color;
    g.beginPath();
    g.arc((look === "blaster" ? 1.45 : 1.6) * r, 0, 0.2 * r, 0, TWO_PI);
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255, 255, 255, 0.85)";
    g.beginPath();
    g.arc((look === "blaster" ? 1.45 : 1.6) * r, 0, 0.08 * r, 0, TWO_PI);
    g.fill();
    return;
  }
  if (look === "launcher") {
    // A tube on the shoulder: a long barrel, a sight and a grip.
    g.fillStyle = "#4b5563";
    roundRectPath(g, 0.45 * r, -0.26 * r, 1.45 * r, 0.52 * r, 0.1 * r);
    g.fill();
    g.stroke();
    g.fillStyle = p.accent;
    g.fillRect(0.6 * r, -0.26 * r, 0.14 * r, 0.52 * r);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(1.9 * r, 0, 0.17 * r, 0, TWO_PI);
    g.fill();
    g.fillStyle = "#1f2937";
    g.beginPath();
    g.rect(0.95 * r, 0.26 * r, 0.16 * r, 0.24 * r);
    g.fill();
    g.stroke();
    return;
  }
  if (look === "minigun") {
    // Six barrels in a bundle seen from above: three show, their highlight walking with `frame` (the spin).
    g.fillStyle = "#374151";
    roundRectPath(g, 0.5 * r, -0.36 * r, 0.55 * r, 0.72 * r, 0.12 * r);
    g.fill();
    g.stroke();
    for (let k = 0; k < 3; k++) {
      const y = (-0.22 + 0.22 * k) * r;
      g.fillStyle = (k + frame) % 3 === 0 ? "#9ca3af" : "#1f2937";
      g.beginPath();
      g.rect(1.02 * r, y - 0.07 * r, 0.95 * r, 0.14 * r);
      g.fill();
      g.stroke();
    }
    g.fillStyle = p.accent;
    g.fillRect(1.05 * r, -0.3 * r, 0.12 * r, 0.6 * r);
    return;
  }
  // pistol and rifle (a shotgun is a rifle with a wide barrel and a pump line)
  const rifle = look === "rifle";
  const len = shotgun ? 1.25 * r : rifle ? 1.15 * r : 0.72 * r;
  const x0 = 0.85 * r;
  g.fillStyle = "#374151";
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
  g.beginPath();
  g.rect(x0 - 0.05 * r, -bh, len, 1.6 * bh);
  g.fill();
  g.stroke();
  g.fillStyle = p.accent;
  g.fillRect(x0 + 0.1 * r, -bh + 1, 0.16 * r, 1.6 * bh - 2);
  if (shotgun) {
    g.strokeStyle = "#6b7280";
    g.beginPath();
    g.moveTo(x0, -0.2 * bh);
    g.lineTo(x0 + len - 0.05 * r, -0.2 * bh);
    g.stroke();
  }
  if (rifle) {
    g.fillStyle = "#111827";
    g.strokeStyle = INK;
    g.beginPath();
    g.rect(x0 + 0.45 * r, 0.6 * bh, 0.16 * r, 0.32 * r);
    g.fill();
    g.stroke();
  }
}

function gunBox(r: number, look: FlGunLook, shotgun: boolean): Box {
  if (look === "cannon" || look === "blaster" || look === "portal") return { x0: 0.5 * r, y0: -0.6 * r, x1: 1.9 * r, y1: 0.6 * r };
  if (look === "launcher") return { x0: 0.4 * r, y0: -0.45 * r, x1: 2.15 * r, y1: 0.6 * r };
  if (look === "minigun") return { x0: 0.45 * r, y0: -0.45 * r, x1: 2.05 * r, y1: 0.45 * r };
  const len = shotgun ? 1.25 * r : look === "rifle" ? 1.15 * r : 0.72 * r;
  return { x0: 0.5 * r, y0: -0.5 * r, x1: Math.max(1.85 * r, 0.85 * r + len + 2), y1: 0.6 * r };
}

/** An energy hand: a glowing orb at the rim (repulsors, ki, hadouken, fireballs, beams, sparks). */
export function drawEnergyHand(g: CanvasRenderingContext2D, r: number, p: FlPaint) {
  g.shadowColor = p.color;
  g.shadowBlur = 0.45 * r;
  g.fillStyle = p.color;
  g.beginPath();
  g.arc(1.1 * r, 0, 0.24 * r, 0, TWO_PI);
  g.fill();
  g.shadowBlur = 0;
  g.shadowColor = "rgba(0, 0, 0, 0)";
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

/** A wand (a glowing tip), a staff (its orb drawn live: it grows toward the shot) or a spell book (`open`: pages up). */
export function drawCaster(g: CanvasRenderingContext2D, r: number, kind: "wand" | "staff" | "book", p: FlPaint, open = false) {
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.lineCap = "round";
  g.lineJoin = "round";
  if (kind === "book") {
    const w = 0.42 * r;
    const h = 0.55 * r;
    g.fillStyle = p.accent;
    roundRectPath(g, 0.85 * r, -h - 0.05 * r, 2 * w * 0.98, 2 * h + 0.1 * r, 0.06 * r);
    g.fill();
    g.stroke();
    g.fillStyle = "#fefce8";
    g.fillRect(0.9 * r, -h, w - 0.03 * r, 2 * h);
    g.fillRect(0.9 * r + w + 0.03 * r, -h, w - 0.08 * r, 2 * h);
    g.strokeStyle = "rgba(0, 0, 0, 0.35)";
    g.lineWidth = Math.max(0.5, 0.03 * r);
    for (let k = 0; k < 4; k++) {
      const y = -h + ((k + 1) * (2 * h)) / 5;
      g.beginPath();
      g.moveTo(0.95 * r, y);
      g.lineTo(0.9 * r + w - 0.08 * r, y);
      g.moveTo(0.9 * r + w + 0.08 * r, y);
      g.lineTo(0.9 * r + 2 * w - 0.12 * r, y);
      g.stroke();
    }
    g.strokeStyle = INK;
    g.lineWidth = Math.max(0.8, 0.05 * r);
    g.beginPath();
    g.moveTo(0.9 * r + w, -h);
    g.lineTo(0.9 * r + w, h);
    g.stroke();
    if (open) {
      // a page turning: a lifted leaf over the right page
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.moveTo(0.9 * r + w, -h);
      g.quadraticCurveTo(0.9 * r + 1.6 * w, -1.25 * h, 0.9 * r + 1.75 * w, -0.2 * h);
      g.lineTo(0.9 * r + 1.6 * w, h);
      g.lineTo(0.9 * r + w, h);
      g.closePath();
      g.fill();
      g.stroke();
    }
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
  if (kind === "wand") {
    g.shadowColor = p.color;
    g.shadowBlur = 0.5 * r;
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(x1 + 0.04 * r, 0, 0.1 * r, 0, TWO_PI);
    g.fill();
    g.shadowBlur = 0;
    g.shadowColor = "rgba(0, 0, 0, 0)";
    g.lineWidth = Math.max(0.6, 0.04 * r);
    g.strokeStyle = INK;
    g.stroke();
  } else {
    // the staff's head: a fork that holds the orb
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1, 0.08 * r);
    g.beginPath();
    g.moveTo(x1 - 0.05 * r, -0.2 * r);
    g.quadraticCurveTo(x1 + 0.2 * r, -0.3 * r, x1 + 0.25 * r, -0.05 * r);
    g.moveTo(x1 - 0.05 * r, 0.2 * r);
    g.quadraticCurveTo(x1 + 0.2 * r, 0.3 * r, x1 + 0.25 * r, 0.05 * r);
    g.stroke();
  }
}

/** A round shield facing +x at the rim, or a pair of bracers (block). */
export function drawShield(g: CanvasRenderingContext2D, r: number, size: number, bracers: boolean, p: FlPaint) {
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  if (bracers) {
    g.fillStyle = p.accent;
    for (const a of [-0.75, 0.75]) {
      const x = Math.cos(a) * 1.0 * r;
      const y = Math.sin(a) * 1.0 * r;
      roundRectPath(g, x - 0.16 * r, y - 0.22 * r, 0.32 * r, 0.44 * r, 0.07 * r);
      g.fill();
      g.stroke();
    }
    return;
  }
  const R = size * r;
  const cx = 1.0 * r;
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
export function drawShieldFace(g: CanvasRenderingContext2D, R: number, p: FlPaint) {
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
export function drawTail(g: CanvasRenderingContext2D, r: number, reach: number, size: number, bladeTip: boolean, p: FlPaint) {
  const x0 = 0.7 * r;
  const x1 = r + reach * r;
  const w0 = Math.max(1.2, size * r * 1.2);
  g.lineWidth = Math.max(0.8, 0.05 * r);
  g.strokeStyle = INK;
  g.lineJoin = "round";
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
function drawIceFocus(g: CanvasRenderingContext2D, r: number, p: FlPaint) {
  g.fillStyle = p.color;
  g.strokeStyle = "#0c4a6e";
  g.lineWidth = Math.max(0.6, 0.05 * r);
  g.lineJoin = "round";
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

/** One of a breath's three flame frames: the cone's flicker (`frame`) over a radial gradient – built once per fighter. */
function drawFlameFrame(g: CanvasRenderingContext2D, r: number, range: number, half: number, frame: number) {
  const grad = g.createRadialGradient(0, 0, 0.6 * r, 0, 0, range);
  grad.addColorStop(0, "rgba(254, 240, 138, 0.95)");
  grad.addColorStop(0.45, "rgba(249, 115, 22, 0.8)");
  grad.addColorStop(1, "rgba(220, 38, 38, 0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0.8 * r, 0);
  const steps = 9;
  for (let k = 0; k <= steps; k++) {
    const a = -half + (2 * half * k) / steps;
    const flick = 0.82 + 0.18 * Math.sin(frame * 2.1 + k * 2.1);
    g.lineTo(Math.cos(a) * range * flick, Math.sin(a) * range * flick);
  }
  g.closePath();
  g.fill();
}

/** A sword's look from its style and its own look. */
export function swordLookOf(w: FlWeaponState): FlSwordLook {
  const look = w.spec.look;
  if (look === "saber" || look === "double" || look === "katana" || look === "greatsword" || look === "chainsaw" || look === "trident" || look === "rapier" || look === "blade") return look;
  if (w.spec.style === "glow") return "saber";
  return "blade";
}

/** A hammer's look (its own, else the banded block). */
export function hammerLookOf(w: { spec: { look?: string } }): FlHammerLook {
  const look = w.spec.look;
  return look === "pan" || look === "mallet" ? look : "block";
}

/* ------------------------------------------------------------------ the painter */

/** Live-drawn weapon parts. */
const PART_FIST = 0;
const PART_HEAD = 1;
const PART_CLAWS = 2;
const PART_KICK = 3;
const PART_AIR = 4;
const PART_STAR = 5;

/** Sprite size buckets: 2^(1/8) steps of device px (a growing transform builds a few, not one a frame). */
function bucketOf(devR: number): number {
  return Math.max(0, Math.round(8 * Math.log2(Math.max(1, devR))));
}
function bucketR(bucket: number, px: number): number {
  return 2 ** (bucket / 8) / px;
}

/** Every weapon kind's sprites and live motion for one layer. */
export class FlWeaponsPainter {
  private readonly held = new Map<number, Sprite | null>();
  private readonly parts = new Map<number, Sprite | null>();
  private readonly flames = new Map<number, Sprite | null>();
  private generation = -1;
  private px = 0;

  /** Once per frame: a new run or a new scale drops the sprites. */
  begin(view: FightLeagueView, px: number) {
    if (view.generation !== this.generation || Math.abs(px - this.px) > 1e-6) {
      this.generation = view.generation;
      this.px = px;
      this.held.clear();
      this.parts.clear();
      this.flames.clear();
    }
  }

  private paintOf(f: FlFighter, w: FlWeaponState | null): FlPaint {
    return { body: f.row.body, accent: f.row.accent, color: (w ? f.row.weapons[w.index]?.color : undefined) ?? f.row.accent };
  }

  /** The held look of weapon `w` of `f` (`variant`: a frame or a pose; null: drawn live or not at all). */
  heldSprite(f: FlFighter, w: FlWeaponState, variant = 0): Sprite | null {
    const px = this.px || 1;
    const b = bucketOf(f.r * px);
    const key = (((f.slot & 15) * 8 + (w.index & 7)) * 8 + (variant & 7)) * 256 + b;
    if (this.held.has(key)) return this.held.get(key) ?? null;
    if (this.held.size > 512) this.held.clear();
    const r = bucketR(b, px);
    const s = w.spec;
    const p = this.paintOf(f, w);
    let sprite: Sprite | null = null;
    switch (s.kind) {
      case "sword": {
        const look = swordLookOf(w);
        sprite = makeSprite(swordBox(r, s.reach, s.size, look), px, (g) => drawSword(g, r, s.reach, s.size, look, { ...p, color: f.row.weapons[w.index]?.color ?? (look === "saber" ? p.accent : "#e5e7eb") }, variant));
        break;
      }
      case "hammer": {
        const d = r + s.reach * r;
        const hs = s.size * r;
        const look = hammerLookOf(w);
        sprite = makeSprite({ x0: 0.6 * r, y0: -1.15 * hs - 2, x1: d + 1.35 * hs + 2, y1: 1.15 * hs + 2 }, px, (g) => {
          g.translate(d, 0);
          drawHammerHead(g, r, s.size, p, d - 0.7 * r, look);
        });
        break;
      }
      case "tail": {
        const blade = f.row.weapons[w.index]?.shape === "blades" || f.row.id === "alien";
        sprite = makeSprite({ x0: 0.6 * r, y0: -0.8 * r, x1: r + s.reach * r + 0.7 * r, y1: 0.8 * r }, px, (g) => drawTail(g, r, s.reach, s.size, blade, p));
        break;
      }
      case "bow":
        sprite = makeSprite({ x0: 0.3 * r, y0: -0.95 * r, x1: 1.85 * r, y1: 0.95 * r }, px, (g) => drawBow(g, r, p, variant === 1));
        break;
      case "gun":
      case "shotgun": {
        const shape = s.shape;
        if (!s.look && (shape === "repulsor" || shape === "ki" || shape === "hadouken" || shape === "flamewave" || shape === "fireball" || shape === "bolt")) {
          sprite = makeSprite({ x0: 0.7 * r, y0: -0.6 * r, x1: 1.6 * r, y1: 0.6 * r }, px, (g) => drawEnergyHand(g, r, p));
        } else {
          const look = gunLookOf(s.look, shape, s.style === "burst", s.kind === "shotgun");
          sprite = makeSprite(gunBox(r, look, s.kind === "shotgun"), px, (g) => drawGun(g, r, look, s.kind === "shotgun", p, variant));
        }
        break;
      }
      case "wand":
      case "staff":
      case "book":
        sprite = makeSprite({ x0: 0.1 * r, y0: -0.75 * r, x1: 2.3 * r, y1: 0.75 * r }, px, (g) => drawCaster(g, r, s.kind as "wand" | "staff" | "book", p, variant === 1));
        break;
      case "beam":
      case "spark":
        sprite = makeSprite({ x0: 0.7 * r, y0: -0.6 * r, x1: 1.6 * r, y1: 0.6 * r }, px, (g) => drawEnergyHand(g, r, p));
        break;
      case "web":
        sprite = makeSprite({ x0: 0.7 * r, y0: -0.4 * r, x1: 1.4 * r, y1: 0.4 * r }, px, (g) => drawWebShooter(g, r));
        break;
      case "ice":
        sprite = makeSprite({ x0: 0.7 * r, y0: -0.4 * r, x1: 1.75 * r, y1: 0.4 * r }, px, (g) => drawIceFocus(g, r, p));
        break;
      case "fire":
        sprite = makeSprite({ x0: 0.7 * r, y0: -0.4 * r, x1: 1.7 * r, y1: 0.4 * r }, px, (g) => drawFlameFocus(g, r));
        break;
      case "shield": {
        const bracers = s.style === "block";
        const R = s.size * r;
        sprite = makeSprite(bracers ? { x0: 0.5 * r, y0: -1.25 * r, x1: 1.35 * r, y1: 1.25 * r } : { x0: 0.5 * r, y0: -R - 2, x1: 1.0 * r + 0.45 * R + 2, y1: R + 2 }, px, (g) => drawShield(g, r, s.size, bracers, p));
        break;
      }
      default:
        // fists, claws, chains, cards, whips and bombs are drawn live from their parts
        sprite = null;
    }
    this.held.set(key, sprite);
    return sprite;
  }

  /** A part sprite of a fighter's weapon (a fist, a boot, claws, a chain head, an air curl), `size` its radius (px). */
  private partSprite(f: FlFighter, w: FlWeaponState, part: number, size: number): Sprite | null {
    const px = this.px || 1;
    const b = bucketOf(size * px * 2);
    const key = (((f.slot & 15) * 8 + (w.index & 7)) * 8 + part) * 256 + b;
    if (this.parts.has(key)) return this.parts.get(key) ?? null;
    if (this.parts.size > 512) this.parts.clear();
    const rr = bucketR(b, px) / 2;
    const s = w.spec;
    const p = this.paintOf(f, w);
    const R = rr / Math.max(1e-6, s.size);
    const raw = f.row.weapons[w.index];
    const sprite = makeSprite({ x0: -1.9 * rr, y0: -1.9 * rr, x1: 2.2 * rr, y1: 1.9 * rr }, px, (g) => {
      if (part === PART_AIR) drawAirCurl(g, rr, p);
      else if (part === PART_CLAWS) drawClaws(g, R, s.size, p);
      else if (part === PART_HEAD) drawChainHead(g, R, s.size, raw?.shape === "blades" ? "blades" : "spear", p);
      else if (part === PART_STAR) {
        // a muzzle star: eight points, yellow-white
        g.fillStyle = "#fde047";
        starPath(g, 0, 0, 1.6 * rr, 0.55 * rr, 8, 0);
        g.fill();
        g.fillStyle = "#ffffff";
        starPath(g, 0, 0, 0.9 * rr, 0.35 * rr, 8, 0.2);
        g.fill();
      } else drawFist(g, R, s.size, p, part === PART_KICK);
    });
    this.parts.set(key, sprite);
    return sprite;
  }

  /** One of the three flame frames of a fighter's breath (built once per fighter, frame and size). */
  private flameSprite(f: FlFighter, w: FlWeaponState, frame: number): Sprite | null {
    const px = this.px || 1;
    const b = bucketOf(f.r * px);
    const key = (((f.slot & 15) * 8 + (w.index & 7)) * 4 + frame) * 256 + b;
    if (this.flames.has(key)) return this.flames.get(key) ?? null;
    const r = bucketR(b, px);
    const range = r + w.spec.reach * r;
    const half = 0.5 * w.spec.spread * DEG;
    const ext = range * Math.max(Math.sin(half), 0.2) + 2;
    const sprite = makeSprite({ x0: 0, y0: -ext, x1: range + 2, y1: ext }, px, (g) => drawFlameFrame(g, r, range, half, frame));
    this.flames.set(key, sprite);
    return sprite;
  }

  /** Draws `s` at the fighter's origin (x, y) along `angle`, scaled from its bucket to the fighter's radius. */
  private put(ctx: CanvasRenderingContext2D, s: Sprite, f: FlFighter, x: number, y: number, angle: number, alpha: number) {
    const k = f.r / bucketR(bucketOf(f.r * (this.px || 1)), this.px || 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (alpha < 1) ctx.globalAlpha *= alpha;
    ctx.drawImage(s.canvas, s.x0 * k, s.y0 * k, s.w * k, s.h * k);
    ctx.restore();
  }

  /** The weapons of `f` drawn at (x, y) – shields go in front later. Returns how many were drawn. */
  drawWeapons(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, f: FlFighter, x: number, y: number): number {
    const now = fr.now;
    const disarmed = now < f.disarmedUntil;
    const alpha = (now < f.untargetableUntil ? 0.35 : 1) * (disarmed ? 0.35 : 1);
    const finale = view.finale.from >= 0 && now >= view.finale.from;
    let n = 0;
    for (const w of f.weapons) {
      const s = w.spec;
      if (s.kind === "shield") continue;
      switch (s.kind) {
        case "fists":
        case "claws":
          n += this.drawFists(ctx, fr, f, w, x, y, alpha);
          continue;
        case "chain":
          n += this.drawChain(ctx, view, f, w, x, y, alpha, finale);
          continue;
        case "cards":
          n += this.drawCards(ctx, fr, f, w, x, y, alpha, finale);
          continue;
        case "whip":
          n += this.drawWhip(ctx, f, w, x, y, alpha);
          continue;
        case "bomb":
          n += this.drawHeldBomb(ctx, fr, f, w, x, y, alpha);
          continue;
        case "hammer":
          if (w.thrown >= 0) continue; // the hand is empty while the hammer flies
          break;
        case "fire":
          if (now >= w.inhaleUntil && now < w.onUntil) this.drawFlameCone(ctx, fr, f, w, x, y);
          break;
        case "spark": {
          const color = f.row.weapons[w.index]?.color ?? f.row.accent;
          if (now - w.zapMs < 140) drawZap(ctx, x + Math.cos(w.zapAngle) * 1.1 * f.r, y + Math.sin(w.zapAngle) * 1.1 * f.r, w.zapX, w.zapY, color, now, w.zapMs);
          if (now - w.zap2Ms < 140) drawZap(ctx, w.zapX, w.zapY, w.zap2X, w.zap2Y, color, now, w.zap2Ms);
          break;
        }
        case "beam":
          if (w.glintUntil >= 0 && now < w.glintUntil) this.drawGlint(ctx, fr, f, w, x, y, now);
          break;
        default:
          break;
      }
      const angle = finale && s.kind === "hammer" ? w.angle + f.finSpin : w.angle;
      const variant = this.variantOf(f, w, now);
      const sprite = this.heldSprite(f, w, variant);
      if (!sprite) continue;
      if (f.giantLeft > 0) {
        const pulse = 0.55 + 0.45 * Math.sin(now / 70);
        const d = (1 + 0.6 * Math.max(0.6, s.reach)) * f.r;
        fr.glow.draw(ctx, f.row.accent, x + Math.cos(angle) * d, y + Math.sin(angle) * d, (1.2 + 0.5 * s.reach) * f.r, 0.55 * pulse * alpha);
      }
      // the motion under the weapon
      if (s.kind === "sword" && w.sweepT > 0) this.drawSweep(ctx, f, w, x, y, alpha);
      else if (s.kind === "tail" && w.swingT >= 0) this.drawSwing(ctx, f, w, x, y, alpha);
      else if (s.kind === "hammer" && !finale && now >= view.introMs && !view.finished) this.drawGhostHeads(ctx, f, w, x, y, sprite, alpha);
      // recoil: a gun kicks back 0.15 R for 80 ms after a shot
      let rx = x;
      let ry = y;
      const since = this.sinceShot(f, w);
      if ((s.kind === "gun" || s.kind === "shotgun") && since >= 0 && since < 0.08) {
        const back = 0.15 * f.r * (1 - since / 0.08);
        rx -= Math.cos(angle) * back;
        ry -= Math.sin(angle) * back;
      }
      this.put(ctx, sprite, f, rx, ry, angle, alpha);
      if (s.kind === "sword" && (s.style === "double" || swordLookOf(w) === "double")) this.put(ctx, sprite, f, rx, ry, angle + Math.PI, alpha);
      if (s.kind === "staff") this.drawStaffOrb(ctx, fr, f, w, rx, ry, angle, alpha);
      if (s.kind === "wand") this.drawSparkle(ctx, f, w, rx, ry, angle, now, alpha);
      if ((s.kind === "gun" || s.kind === "shotgun") && since >= 0 && since < 0.3) this.drawShotFx(ctx, fr, f, w, rx, ry, angle, since, alpha);
      if (f.meter >= 0.85 && f.telegraphUntil < 0 && !view.finished) this.drawWeaponGlint(ctx, fr, f, w, rx, ry, angle, now, alpha);
      n++;
    }
    return n;
  }

  /** Seconds since `w` last fired (−1: unknown or long ago), from its cooldown and the fighter's attack speed. */
  private sinceShot(f: FlFighter, w: FlWeaponState): number {
    const period = w.spec.cooldown / Math.max(0.05, f.attack * (f.atkMulUntil > 0 ? Math.max(1, f.atkMul) : 1));
    if (!(w.cd > 0) || !(period > 0)) return -1;
    const since = period - w.cd;
    return since >= 0 ? since : -1;
  }

  /** The sprite variant a weapon shows now: the bow drawn back, the book's turning page, the chainsaw's and the minigun's frames. */
  private variantOf(f: FlFighter, w: FlWeaponState, now: number): number {
    const s = w.spec;
    switch (s.kind) {
      case "bow":
        return w.cd > 0 && w.cd < 0.2 ? 1 : 0;
      case "book":
        return f.targetSlot >= 0 && Math.floor(now / 250) % 2 === 0 ? 1 : 0;
      case "sword":
        return swordLookOf(w) === "chainsaw" ? Math.floor(now / 50) % 3 : 0;
      case "gun": {
        const look = gunLookOf(s.look, s.shape, s.style === "burst", false);
        if (look !== "minigun") return 0;
        const period = s.cooldown / Math.max(0.05, f.attack);
        return period <= 0.25 ? Math.floor(now / 40) % 3 : 0;
      }
      default:
        return 0;
    }
  }

  /** A sword's crescent smear: from where its sweep started to the blade, fading back (0.35 → 0). */
  private drawSweep(ctx: CanvasRenderingContext2D, f: FlFighter, w: FlWeaponState, x: number, y: number, alpha: number) {
    const s = w.spec;
    const tip = f.r + s.reach * f.r;
    const inner = 1.05 * f.r;
    const from = w.sweepFrom;
    const to = w.angle;
    const span = to - from;
    if (Math.abs(span) < 0.05) return;
    const saber = swordLookOf(w) === "saber";
    const color = f.row.weapons[w.index]?.color ?? (saber ? f.row.accent : "#ffffff");
    ctx.save();
    ctx.fillStyle = color;
    for (let k = 0; k < 3; k++) {
      const a0 = to - span * ((k + 1) / 3);
      const a1 = to - span * (k / 3);
      ctx.globalAlpha = alpha * (0.35 - 0.11 * k);
      ctx.beginPath();
      ctx.arc(x, y, tip, Math.min(a0, a1), Math.max(a0, a1));
      ctx.arc(x, y, inner, Math.max(a0, a1), Math.min(a0, a1), true);
      ctx.closePath();
      ctx.fill();
    }
    if (saber) {
      // the bloom: a white core arc along the tip
      ctx.globalAlpha = 0.6 * alpha;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, 0.12 * f.r);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(x, y, 0.92 * tip, Math.min(from, to), Math.max(from, to));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A tail's swing smear (from where the swing began to the tail). */
  private drawSwing(ctx: CanvasRenderingContext2D, f: FlFighter, w: FlWeaponState, x: number, y: number, alpha: number) {
    const tip = f.r + w.spec.reach * f.r;
    const from = w.swingFrom;
    const to = w.angle;
    if (Math.abs(to - from) < 0.05) return;
    ctx.save();
    ctx.globalAlpha = 0.22 * alpha;
    ctx.fillStyle = f.row.body;
    ctx.beginPath();
    ctx.arc(x, y, tip, Math.min(from, to), Math.max(from, to));
    ctx.arc(x, y, 0.8 * f.r, Math.max(from, to), Math.min(from, to), true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Three ghost heads trailing an orbiting hammer (60 / 35 / 15 %). */
  private drawGhostHeads(ctx: CanvasRenderingContext2D, f: FlFighter, w: FlWeaponState, x: number, y: number, sprite: Sprite, alpha: number) {
    const period = Math.max(0.1, w.spec.cooldown / Math.max(0.05, f.attack));
    const step = (TWO_PI / period) * 0.028;
    const alphas = [0.6, 0.35, 0.15];
    for (let k = 0; k < 3; k++) this.put(ctx, sprite, f, x, y, w.angle - (k + 1) * step, alpha * alphas[k] * 0.5);
  }

  /** A staff's orb on its head, growing over the last 0.3 s of its cooldown. */
  private drawStaffOrb(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, w: FlWeaponState, x: number, y: number, angle: number, alpha: number) {
    const color = f.row.weapons[w.index]?.color ?? f.row.accent;
    const grow = w.cd > 0 && w.cd < 0.3 ? 1 - w.cd / 0.3 : 0;
    const R = 0.24 * f.r * (1 + 0.6 * grow);
    const ox = x + Math.cos(angle) * 2.05 * f.r;
    const oy = y + Math.sin(angle) * 2.05 * f.r;
    fr.glow.draw(ctx, color, ox, oy, 2.4 * R, 0.6 * alpha);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.6, 0.04 * f.r);
    ctx.beginPath();
    ctx.arc(ox, oy, R, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(ox - 0.3 * R, oy - 0.3 * R, 0.35 * R, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  /** A wand tip's twinkle. */
  private drawSparkle(ctx: CanvasRenderingContext2D, f: FlFighter, w: FlWeaponState, x: number, y: number, angle: number, now: number, alpha: number) {
    const tw = 0.5 + 0.5 * Math.sin(now / 90 + f.slot);
    const sx = x + Math.cos(angle) * 1.72 * f.r;
    const sy = y + Math.sin(angle) * 1.72 * f.r;
    ctx.save();
    ctx.globalAlpha *= alpha * (0.4 + 0.6 * tw);
    ctx.fillStyle = "#ffffff";
    starPath(ctx, sx, sy, (0.12 + 0.1 * tw) * f.r, 0.04 * f.r, 4, now / 300);
    ctx.fill();
    ctx.restore();
  }

  /** A gun's muzzle star (50 ms), its casing flying out on an arc (300 ms). */
  private drawShotFx(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, w: FlWeaponState, x: number, y: number, angle: number, since: number, alpha: number) {
    const s = w.spec;
    const look = gunLookOf(s.look, s.shape, s.style === "burst", s.kind === "shotgun");
    const muzzle = look === "launcher" ? 2.1 : look === "minigun" ? 2.0 : s.kind === "shotgun" ? 2.15 : 1.95;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    if (since < 0.05) {
      const star = this.partSprite(f, w, PART_STAR, 0.22 * f.r);
      if (star) {
        const k = since / 0.05;
        ctx.save();
        ctx.globalAlpha *= alpha * (1 - 0.6 * k);
        ctx.translate(x + ux * muzzle * f.r, y + uy * muzzle * f.r);
        ctx.rotate(angle);
        const sc = 1 + 0.5 * k;
        ctx.drawImage(star.canvas, star.x0 * sc, star.y0 * sc, star.w * sc, star.h * sc);
        ctx.restore();
      }
    }
    if (look === "pistol" || look === "rifle" || look === "minigun") {
      // the casing: out of the side, up and back, falling (analytic)
      const t = since / 0.3;
      const nx = -uy;
      const ny = ux;
      const cx = x + ux * (1.2 - 0.6 * t) * f.r + nx * (0.3 + 1.6 * t) * f.r;
      const cy = y + uy * (1.2 - 0.6 * t) * f.r + ny * (0.3 + 1.6 * t) * f.r + 2.2 * f.r * t * t;
      ctx.save();
      ctx.globalAlpha *= alpha * (1 - t);
      ctx.translate(cx, cy);
      ctx.rotate(angle + 9 * t);
      ctx.fillStyle = "#d4a017";
      ctx.fillRect(-0.09 * f.r, -0.04 * f.r, 0.18 * f.r, 0.08 * f.r);
      ctx.restore();
    }
    void fr;
  }

  /** The meter past 0.85: a glint running along the weapon (its ability is near). */
  private drawWeaponGlint(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, w: FlWeaponState, x: number, y: number, angle: number, now: number, alpha: number) {
    const u = ((now / 700 + 0.37 * f.slot) % 1 + 1) % 1;
    const reach = w.spec.kind === "sword" || w.spec.kind === "tail" ? w.spec.reach : 0.7;
    const d = (0.9 + u * (0.2 + reach)) * f.r;
    fr.glow.draw(ctx, "#ffffff", x + Math.cos(angle) * d, y + Math.sin(angle) * d, 0.35 * f.r, 0.8 * alpha * Math.sin(Math.PI * u));
  }

  /** A beam's glint: a white-hot dot in the hand and the dashed aim line to the point it locked. */
  private drawGlint(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, w: FlWeaponState, x: number, y: number, now: number) {
    const color = f.row.weapons[w.index]?.color ?? f.row.accent;
    const hx = x + Math.cos(w.angle) * 1.1 * f.r;
    const hy = y + Math.sin(w.angle) * 1.1 * f.r;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 0.06 * f.r);
    ctx.setLineDash([0.3 * f.r, 0.25 * f.r]);
    ctx.lineDashOffset = -now / 20;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(w.glintX, w.glintY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    fr.glow.draw(ctx, color, hx, hy, 0.8 * f.r, 0.7);
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 20);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, 0.08 * f.r);
    ctx.beginPath();
    ctx.arc(hx, hy, 0.28 * f.r, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Held shields in front of their fighter (dimmed while the guard recovers, its ring refilling). Returns how many were drawn. */
  drawShields(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, x: number, y: number): number {
    let n = 0;
    const now = fr.now;
    for (const w of f.weapons) {
      if (w.spec.kind !== "shield" || w.thrown >= 0) continue;
      const sprite = this.heldSprite(f, w);
      if (!sprite) continue;
      const recovering = now < w.guardUntil;
      this.put(ctx, sprite, f, x, y, w.angle, (now < f.disarmedUntil ? 0.35 : 1) * (recovering ? 0.55 : 1));
      if (recovering) {
        const len = w.spec.style === "block" ? 2400 : 1800;
        const k = Math.max(0, Math.min(1, 1 - (w.guardUntil - now) / len));
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = f.row.accent;
        ctx.lineWidth = Math.max(1.5, 0.1 * f.r);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(x, y, 1.42 * f.r, w.angle - 0.9 * k, w.angle + 0.9 * k);
        ctx.stroke();
        ctx.restore();
      }
      n++;
    }
    return n;
  }

  /** Fists and claws: at rest beside the facing, one thrown out along a punch; speed lines at full extension, slash marks after a swipe. */
  private drawFists(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, w: FlWeaponState, x: number, y: number, alpha: number): number {
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
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      if (active && e > 0.85 && !claws) this.drawSpeedLines(ctx, f, px, py, a, fistR, kick, alpha);
      if (air && active) {
        drawAirBlast(ctx, f, px, py, a, 0.9 * fistR, alpha * Math.min(1, 0.3 + ext));
        drawn++;
        continue;
      }
      if (sprite) {
        const kk = 1;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        if (alpha < 1) ctx.globalAlpha *= alpha;
        ctx.drawImage(sprite.canvas, sprite.x0 * kk, sprite.y0 * kk, sprite.w * kk, sprite.h * kk);
        ctx.restore();
      }
      if (claws && active && w.punchT < 0.15) this.drawSlashMarks(ctx, f, x, y, a, s.reach, w.punchT, alpha);
      drawn++;
    }
    void fr;
    return drawn;
  }

  /** Three speed lines behind a fist at full extension (a boot: an arc smear). */
  private drawSpeedLines(ctx: CanvasRenderingContext2D, f: FlFighter, px: number, py: number, a: number, fistR: number, kick: boolean, alpha: number) {
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    ctx.save();
    ctx.globalAlpha *= 0.55 * alpha;
    ctx.strokeStyle = INK;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, 0.06 * f.r);
    ctx.beginPath();
    if (kick) {
      ctx.arc(px - ux * 0.6 * fistR, py - uy * 0.6 * fistR, 1.4 * fistR, a + Math.PI - 0.8, a + Math.PI + 0.8);
    } else {
      for (let k = -1; k <= 1; k++) {
        const ox = -uy * k * 0.55 * fistR;
        const oy = ux * k * 0.55 * fistR;
        ctx.moveTo(px - ux * 1.3 * fistR + ox, py - uy * 1.3 * fistR + oy);
        ctx.lineTo(px - ux * (1.3 + 1.6) * fistR + ox, py - uy * (1.3 + 1.6) * fistR + oy);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Three slash marks where a claw swipe lands (150 ms). */
  private drawSlashMarks(ctx: CanvasRenderingContext2D, f: FlFighter, x: number, y: number, a: number, reach: number, t: number, alpha: number) {
    const k = 1 - t / 0.15;
    const d = f.r * (1.4 + reach);
    const cx = x + Math.cos(a) * d;
    const cy = y + Math.sin(a) * d;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    ctx.save();
    ctx.globalAlpha *= alpha * k;
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, 0.07 * f.r);
    ctx.beginPath();
    for (let q = -1; q <= 1; q++) {
      const ox = nx * q * 0.28 * f.r;
      const oy = ny * q * 0.28 * f.r;
      ctx.moveTo(cx + ox - Math.cos(a + 0.6) * 0.45 * f.r, cy + oy - Math.sin(a + 0.6) * 0.45 * f.r);
      ctx.lineTo(cx + ox + Math.cos(a + 0.6) * 0.45 * f.r, cy + oy + Math.sin(a + 0.6) * 0.45 * f.r);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** A chain: its links on a sagging curve from the rim to the head (taut, with yank ticks, while a thrown head pulls). */
  private drawChain(ctx: CanvasRenderingContext2D, view: FightLeagueView, f: FlFighter, w: FlWeaponState, x: number, y: number, alpha: number, finale: boolean): number {
    const s = w.spec;
    let hx: number;
    let hy: number;
    let a: number;
    const thrown = w.thrown >= 0 ? view.projectiles[w.thrown] : null;
    const flying = !!thrown && thrown.active;
    if (flying && thrown) {
      hx = thrown.x;
      hy = thrown.y;
      a = Math.atan2(hy - y, hx - x);
    } else {
      a = finale ? w.angle + f.finSpin : w.angle;
      const d = f.r + s.reach * f.r;
      hx = x + Math.cos(a) * d;
      hy = y + Math.sin(a) * d;
    }
    const sx = x + Math.cos(a) * 0.9 * f.r;
    const sy = y + Math.sin(a) * 0.9 * f.r;
    const len = Math.hypot(hx - sx, hy - sy) || 1;
    const taut = flying && s.style === "pull" && thrown !== null && thrown.ret === 2;
    const sag = taut ? 0 : 0.16 * len;
    const nx = -(hy - sy) / len;
    const ny = (hx - sx) / len;
    const cx = 0.5 * (sx + hx) + nx * sag;
    const cy = 0.5 * (sy + hy) + ny * sag;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(2, 0.16 * f.r);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, hx, hy);
    ctx.stroke();
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = Math.max(1.2, 0.1 * f.r);
    ctx.setLineDash([0.22 * f.r, 0.12 * f.r]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (taut) {
      // yank ticks across the taut line
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, 0.06 * f.r);
      ctx.beginPath();
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        const px = sx + (hx - sx) * t;
        const py = sy + (hy - sy) * t;
        ctx.moveTo(px + nx * 0.25 * f.r, py + ny * 0.25 * f.r);
        ctx.lineTo(px - nx * 0.25 * f.r, py - ny * 0.25 * f.r);
      }
      ctx.stroke();
    }
    ctx.restore();
    if (flying) return 1; // the head is the projectile
    const head = this.partSprite(f, w, PART_HEAD, s.size * f.r);
    if (head) {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(a);
      if (alpha < 1) ctx.globalAlpha *= alpha;
      ctx.drawImage(head.canvas, head.x0, head.y0, head.w, head.h);
      ctx.restore();
    }
    return 1;
  }

  /** Cards: the loaded blades orbiting the fighter on a faint ring. */
  private drawCards(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, w: FlWeaponState, x: number, y: number, alpha: number, finale: boolean): number {
    const s = w.spec;
    const pr = s.size * f.r;
    const d = s.reach * f.r;
    const n = Math.min(w.loaded, s.count);
    if (n <= 0) return 0;
    ctx.save();
    ctx.globalAlpha *= 0.14 * alpha;
    ctx.strokeStyle = f.row.accent;
    ctx.lineWidth = Math.max(1, 0.05 * f.r);
    ctx.beginPath();
    ctx.arc(x, y, d, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
    const orbit = finale ? w.orbit + f.finSpin : w.orbit;
    const color = f.row.weapons[w.index]?.color ?? f.row.accent;
    for (let k = 0; k < n; k++) {
      const a = orbit + (TWO_PI * k) / s.count;
      fr.shot(ctx, s.shape, pr, color, f, x + Math.cos(a) * d, y + Math.sin(a) * d, spinsShape(s.shape) ? orbit * 3 : a + Math.PI / 2, alpha);
    }
    return 1;
  }

  /** A whip: a tapered lash on a lagging curve (0.14 R → 0.03 R), a white snap at full extension; a lasso's loop cinches. */
  private drawWhip(ctx: CanvasRenderingContext2D, f: FlFighter, w: FlWeaponState, x: number, y: number, alpha: number): number {
    const s = w.spec;
    const color = f.row.weapons[w.index]?.color ?? f.row.accent;
    const cracking = w.punchT >= 0;
    const e = cracking ? whipExtension(w.punchT) : 0;
    const a = cracking ? w.punchAngle : w.angle;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const x0 = x + ux * 0.9 * f.r;
    const y0 = y + uy * 0.9 * f.r;
    const len = (0.6 + e * s.reach) * f.r;
    const x1 = x + ux * (f.r + len);
    const y1 = y + uy * (f.r + len);
    const side = (1 - e) * 0.6 * f.r;
    const cx = 0.5 * (x0 + x1) - uy * side;
    const cy = 0.5 * (y0 + y1) + ux * side;
    ctx.save();
    ctx.globalAlpha *= alpha;
    // the lash as a filled taper along the curve, outlined in ink
    const N = 8;
    const w0 = 0.14 * f.r;
    const w1 = 0.03 * f.r;
    for (let pass = 0; pass < 2; pass++) {
      const extra = pass === 0 ? Math.max(1, 0.05 * f.r) : 0;
      ctx.beginPath();
      for (let side2 = 0; side2 < 2; side2++) {
        for (let q = 0; q <= N; q++) {
          const t = side2 === 0 ? q / N : 1 - q / N;
          const mt = 1 - t;
          const px = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
          const py = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
          const tx = 2 * mt * (cx - x0) + 2 * t * (x1 - cx);
          const ty = 2 * mt * (cy - y0) + 2 * t * (y1 - cy);
          const tl = Math.hypot(tx, ty) || 1;
          const hw = (w0 + (w1 - w0) * t) / 2 + extra;
          const sgn = side2 === 0 ? 1 : -1;
          const qx = px + (-ty / tl) * hw * sgn;
          const qy = py + (tx / tl) * hw * sgn;
          if (side2 === 0 && q === 0) ctx.moveTo(qx, qy);
          else ctx.lineTo(qx, qy);
        }
      }
      ctx.closePath();
      ctx.fillStyle = pass === 0 ? INK : color;
      ctx.fill();
    }
    if (s.style === "lasso") {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, 0.08 * f.r);
      ctx.beginPath();
      ctx.arc(x1, y1, Math.max(2, 0.3 * f.r * (1 - 0.45 * e)), 0, TWO_PI);
      ctx.stroke();
    } else if (cracking && e > 0.94) {
      ctx.fillStyle = "#ffffff";
      starPath(ctx, x1, y1, 0.42 * f.r, 0.12 * f.r, 6, a);
      ctx.fill();
    }
    ctx.restore();
    return 1;
  }

  /** A bomb in the hand (its own shape; a fuse's sparks on a stick of dynamite). */
  private drawHeldBomb(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, w: FlWeaponState, x: number, y: number, alpha: number): number {
    const s = w.spec;
    const bx = x + Math.cos(w.angle) * 1.25 * f.r;
    const by = y + Math.sin(w.angle) * 1.25 * f.r;
    fr.shot(ctx, s.shape, Math.max(1.5, s.size * f.r), f.row.weapons[w.index]?.color ?? f.row.accent, f, bx, by, 0, alpha);
    if (s.shape === "dynamite") drawFuseSparks(ctx, bx + 0.5 * s.size * f.r, by - 1.6 * s.size * f.r, s.size * f.r, fr.now, alpha);
    return 1;
  }

  /** A breath: one of three cached flame frames (cycled at 20 Hz of simulation time) and eight embers. */
  private drawFlameCone(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, w: FlWeaponState, x: number, y: number) {
    const frame = Math.floor(fr.now / 50) % 3;
    const sprite = this.flameSprite(f, w, frame);
    if (sprite) this.put(ctx, sprite, f, x, y, w.angle, 1);
    const range = f.r + w.spec.reach * f.r;
    const half = 0.5 * w.spec.spread * DEG;
    const count = fr.lite ? 4 : 8;
    ctx.save();
    for (let k = 0; k < count; k++) {
      const u = ((fr.now / 1000) * 2.2 + hash(k, f.slot)) % 1;
      const a = w.angle + (hash(k, f.slot + 9) - 0.5) * 1.6 * half;
      const d = 0.8 * f.r + u * range;
      ctx.globalAlpha = 0.9 * (1 - u);
      ctx.fillStyle = k % 2 === 0 ? "#fde047" : "#fb923c";
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.8, 0.07 * f.r * (1 - 0.5 * u)), 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A fighter's first weapon at rest, scaled `k` around (x, y) (the VS card's and the boxes' portraits). */
  drawPortraitWeapon(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, x: number, y: number, k: number, angle: number) {
    const w = f.weapons[0];
    if (!w) return;
    const sprite = this.heldSprite(f, w);
    if (sprite) {
      const kk = (f.r / bucketR(bucketOf(f.r * (this.px || 1)), this.px || 1)) * k;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.drawImage(sprite.canvas, sprite.x0 * kk, sprite.y0 * kk, sprite.w * kk, sprite.h * kk);
      ctx.restore();
      return;
    }
    const s = w.spec;
    const raw = f.row.weapons[w.index];
    const part = s.kind === "claws" ? PART_CLAWS : s.kind === "chain" ? PART_HEAD : raw?.shape === "air" ? PART_AIR : raw?.shape === "kicks" ? PART_KICK : s.kind === "fists" ? PART_FIST : -1;
    if (part >= 0) {
      const ps = this.partSprite(f, w, part, (part === PART_HEAD ? s.size : s.size) * f.r);
      if (!ps) return;
      const d = (1.2 + (part === PART_HEAD ? 0.4 : 0)) * f.r * k;
      ctx.save();
      ctx.translate(x + Math.cos(angle) * d, y + Math.sin(angle) * d);
      ctx.rotate(angle);
      ctx.drawImage(ps.canvas, ps.x0 * k, ps.y0 * k, ps.w * k, ps.h * k);
      ctx.restore();
      return;
    }
    const color = raw?.color ?? f.row.accent;
    fr.shot(ctx, s.shape, Math.max(1.5, s.size * f.r) * k, color, f, x + Math.cos(angle) * 1.3 * f.r * k, y + Math.sin(angle) * 1.3 * f.r * k, angle, 1);
  }
}

/** Whether a projectile shape spins (drawn at its spin angle, not along its flight). */
export function spinsShape(shape: FlShape): boolean {
  return shape === "shuriken" || shape === "card" || shape === "batarang" || shape === "saber" || shape === "hammer" || shape === "shield" || shape === "blades" || shape === "pan" || shape === "mallet" || shape === "boulder" || shape === "cannonball";
}

/** An air blast's arcs (an ink outline under the fighter's tint). */
function drawAirBlast(ctx: CanvasRenderingContext2D, f: FlFighter, x: number, y: number, a: number, pr: number, alpha: number) {
  const tint = luminance(f.row.accent) > 0.7 ? f.row.body : f.row.accent;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.globalAlpha *= alpha;
  ctx.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(-k * 0.7 * pr, 0, (1.4 - 0.25 * k) * pr, -1, 1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.4, 0.42 * pr);
    ctx.stroke();
    ctx.strokeStyle = k === 0 ? tint : "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = Math.max(0.8, 0.26 * pr);
    ctx.stroke();
  }
  ctx.restore();
}

/** A fuse's sparks (a stick of dynamite in the hand or lit on the floor). */
export function drawFuseSparks(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, now: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = "#fde047";
  for (let k = 0; k < 4; k++) {
    const a = (now / 60 + k * 1.7) % TWO_PI;
    const d = (0.3 + 0.5 * hash(k, Math.floor(now / 60))) * s;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.6, 0.12 * s), 0, TWO_PI);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.8, 0.18 * s), 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** A crackling arc between two points (a spark's zap): the main bolt, two forks and a flash where it strikes. */
export function drawZap(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, now: number, born: number) {
  const t = Math.max(0, Math.min(1, (now - born) / 140));
  const seg = 7;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const seed = Math.floor(born);
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  let fx1 = x0;
  let fy1 = y0;
  let fx2 = x0;
  let fy2 = y0;
  for (let k = 1; k < seg; k++) {
    const off = (hash(k, seed) - 0.5) * 0.18 * len;
    const px = x0 + (dx * k) / seg + nx * off;
    const py = y0 + (dy * k) / seg + ny * off;
    ctx.lineTo(px, py);
    if (k === 2) {
      fx1 = px;
      fy1 = py;
    } else if (k === 4) {
      fx2 = px;
      fy2 = py;
    }
  }
  ctx.lineTo(x1, y1);
  // two forks off the bolt
  ctx.moveTo(fx1, fy1);
  ctx.lineTo(fx1 + nx * 0.16 * len + dx * 0.08, fy1 + ny * 0.16 * len + dy * 0.08);
  ctx.moveTo(fx2, fy2);
  ctx.lineTo(fx2 - nx * 0.14 * len + dx * 0.07, fy2 - ny * 0.14 * len + dy * 0.07);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 0.7 * (1 - t);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x1, y1, Math.max(2, 0.06 * len) * (1 - t), 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}
