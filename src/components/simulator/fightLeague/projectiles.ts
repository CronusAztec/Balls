import { PK_BOMB, PK_HAMMER, PK_SHIELD, PK_SPEAR, flBombHeight, type FightLeagueView, type FlFighter, type FlProjectile } from "@/lib/physics/modes/fightLeague";
import { FL_SHAPES, FL_SUMMON_SHAPES, type FlShape } from "@/lib/physics/modes/fightLeagueRoster";
import type { FlFrame } from "./frame";
import { INK, luminance, shade } from "./palette";
import { TWO_PI, hash, makeSprite, roundRectPath, starPath, type Box, type Sprite } from "./sprites";
import { drawFist, drawFuseSparks, drawHammerHead, drawShieldFace, spinsShape, type FlPaint } from "./weapons";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's projectiles, summons, traps, decoys, walls, beams, fire rings and scheduled
 * strikes: every FL_SHAPES value has its own vector silhouette (canvas paths, centred on the origin, +x = the flight – no
 * image assets), cached per shape, size bucket, colour and owner (SHAPE_INDEX: 128 slots), drawn with their trails (a
 * bullet's tracer, an ice shard's trail, a thrown hammer's whoosh), a bomb's arc over its shrinking shadow and its dashed
 * landing reticle, a trap's jaws opening once armed, a decoy's scanline shimmer, a wall rising over 150 ms.
 */

/** Every shape's slot in the sprite keys (the roster's order; 128 slots – room for the next stages' shapes). */
export const SHAPE_SLOTS = 128;
export const SHAPE_INDEX: ReadonlyMap<FlShape, number> = new Map(FL_SHAPES.map((s, i) => [s, i]));

/** The bounds of projectile `shape` of radius `pr` (CSS px). */
export function shotBox(shape: FlShape, pr: number): Box {
  switch (shape) {
    case "arrow":
    case "icespear":
    case "spear":
    case "spearbolt":
      return { x0: -6 * pr, y0: -1.8 * pr, x1: 2.6 * pr, y1: 1.8 * pr };
    case "bullet":
    case "pellet":
      return { x0: -4.5 * pr, y0: -1.4 * pr, x1: 1.6 * pr, y1: 1.4 * pr };
    case "rocket":
      return { x0: -4.8 * pr, y0: -1.6 * pr, x1: 2 * pr, y1: 1.6 * pr };
    case "saber":
      return { x0: -3.4 * pr, y0: -3.4 * pr, x1: 3.4 * pr, y1: 3.4 * pr };
    case "hammer":
    case "pan":
    case "mallet":
      return { x0: -3.4 * pr, y0: -2.8 * pr, x1: 3 * pr, y1: 2.8 * pr };
    case "dagger":
    case "blades":
      return { x0: -2.4 * pr, y0: -1.6 * pr, x1: 2.6 * pr, y1: 1.6 * pr };
    case "car":
      return { x0: -2.4 * pr, y0: -1.8 * pr, x1: 2.4 * pr, y1: 1.6 * pr };
    case "balloon":
      return { x0: -1.6 * pr, y0: -1.6 * pr, x1: 1.6 * pr, y1: 3.2 * pr };
    case "dynamite":
      return { x0: -1.4 * pr, y0: -2.4 * pr, x1: 1.4 * pr, y1: 2.2 * pr };
    case "megaorb":
    case "aura":
    case "portal":
      return { x0: -2.4 * pr, y0: -2.4 * pr, x1: 2.4 * pr, y1: 2.4 * pr };
    case "windwall":
    case "brickwall":
      return { x0: -2 * pr, y0: -1.2 * pr, x1: 2 * pr, y1: 1.2 * pr };
    default:
      return { x0: -2.6 * pr, y0: -2.2 * pr, x1: 2.2 * pr, y1: 2.2 * pr };
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
  // the glow is baked here, on the sprite's own canvas
  g.shadowColor = color;
  g.shadowBlur = 0.9 * pr;
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, pr, 0, TWO_PI);
  g.fill();
  g.shadowBlur = 0;
  g.shadowColor = "rgba(0, 0, 0, 0)";
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

/** Projectile `shape` of radius `pr` in colour `color` (owner palette `p`), centred on the origin, +x = the flight. */
export function drawShot(g: CanvasRenderingContext2D, shape: FlShape, pr: number, color: string, p: FlPaint) {
  const lw = Math.max(0.6, 0.18 * pr);
  g.lineJoin = "round";
  g.lineCap = "round";
  switch (shape) {
    case "arrow":
    case "icespear":
    case "spear":
    case "spearbolt": {
      const ice = shape === "icespear";
      const bolt = shape === "spearbolt";
      if (bolt) {
        g.shadowColor = color;
        g.shadowBlur = 0.9 * pr;
      }
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1, (ice ? 0.7 : bolt ? 0.6 : 0.38) * pr);
      g.beginPath();
      g.moveTo(-5.4 * pr, 0);
      g.lineTo(1.2 * pr, 0);
      g.stroke();
      g.strokeStyle = ice ? color : bolt ? color : "#a16207";
      g.lineWidth = Math.max(0.6, (ice ? 0.45 : bolt ? 0.4 : 0.2) * pr);
      g.stroke();
      g.shadowBlur = 0;
      g.shadowColor = "rgba(0, 0, 0, 0)";
      g.fillStyle = ice ? "#e0f2fe" : bolt ? "#ffffff" : color;
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo((bolt ? 2.5 : 2.3) * pr, 0);
      g.lineTo(0.6 * pr, -1.1 * pr);
      g.lineTo(0.9 * pr, 0);
      g.lineTo(0.6 * pr, 1.1 * pr);
      g.closePath();
      g.fill();
      g.stroke();
      if (!ice && !bolt) {
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
      g.beginPath();
      g.rect(-0.6 * pr, -1.2 * pr, 0.35 * pr, 2.4 * pr);
      g.fill();
      g.stroke();
      g.fillStyle = shade(p.body, -0.4);
      g.beginPath();
      g.rect(-2.2 * pr, -0.32 * pr, 1.6 * pr, 0.64 * pr);
      g.fill();
      g.stroke();
      return;
    }
    case "card": {
      g.fillStyle = "#fafafa";
      g.strokeStyle = INK;
      g.lineWidth = lw;
      roundRectPath(g, -1.2 * pr, -1.7 * pr, 2.4 * pr, 3.4 * pr, 0.35 * pr);
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
      starPath(g, 0, 0, 1.9 * pr, 0.55 * pr, 4, 0);
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
      g.beginPath();
      g.rect(-1.1 * pr, -1.4 * pr, 2.2 * pr, 2.8 * pr);
      g.fill();
      g.stroke();
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
      g.shadowColor = color;
      g.shadowBlur = 0.9 * pr;
      g.strokeStyle = color;
      g.lineWidth = 0.95 * pr;
      g.beginPath();
      g.moveTo(-3 * pr, 0);
      g.lineTo(3 * pr, 0);
      g.stroke();
      g.shadowBlur = 0;
      g.shadowColor = "rgba(0, 0, 0, 0)";
      g.strokeStyle = "#ffffff";
      g.lineWidth = 0.4 * pr;
      g.stroke();
      g.fillStyle = "#4b5563";
      g.fillRect(-0.7 * pr, -0.35 * pr, 1.4 * pr, 0.7 * pr);
      return;
    }
    case "hammer":
    case "pan":
    case "mallet":
      g.save();
      drawHammerHead(g, pr / 0.5, 0.5, p, 1.6 * pr, shape === "pan" ? "pan" : shape === "mallet" ? "mallet" : "block");
      g.restore();
      return;
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
    case "megaorb": {
      // a big orb with two swirl rings round it
      glowBall(g, pr, color, "#ffffff", false);
      g.strokeStyle = "rgba(255, 255, 255, 0.85)";
      g.lineWidth = Math.max(0.8, 0.14 * pr);
      g.beginPath();
      g.ellipse(0, 0, 1.6 * pr, 0.55 * pr, 0.5, 0, TWO_PI);
      g.stroke();
      g.strokeStyle = color;
      g.beginPath();
      g.ellipse(0, 0, 1.6 * pr, 0.55 * pr, -0.6, 0, TWO_PI);
      g.stroke();
      return;
    }
    case "aura": {
      // a translucent ring of energy
      g.globalAlpha = 0.35;
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, 0, 1.8 * pr, 0, TWO_PI);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, 0.3 * pr);
      g.beginPath();
      g.arc(0, 0, 1.6 * pr, 0, TWO_PI);
      g.stroke();
      g.strokeStyle = "rgba(255, 255, 255, 0.8)";
      g.lineWidth = Math.max(0.6, 0.1 * pr);
      g.stroke();
      return;
    }
    case "portal": {
      // a ring seen at an angle: its rim in the shot's colour, a dark inside
      g.fillStyle = "rgba(15, 23, 42, 0.85)";
      g.beginPath();
      g.ellipse(0, 0, 0.9 * pr, 1.9 * pr, 0, 0, TWO_PI);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, 0.4 * pr);
      g.stroke();
      g.strokeStyle = "rgba(255, 255, 255, 0.75)";
      g.lineWidth = Math.max(0.6, 0.12 * pr);
      g.stroke();
      return;
    }
    case "air": {
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
    case "kicks":
      g.save();
      drawFist(g, pr / 0.36, 0.36, p, true);
      g.restore();
      return;
    case "flask": {
      // a round flask with a neck and a cork, its potion in the shot's colour
      g.fillStyle = color;
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(0, 0.3 * pr, 1.1 * pr, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.fillStyle = "rgba(255, 255, 255, 0.85)";
      g.beginPath();
      g.rect(-0.35 * pr, -1.5 * pr, 0.7 * pr, 0.8 * pr);
      g.fill();
      g.stroke();
      g.fillStyle = "#a16207";
      g.fillRect(-0.3 * pr, -1.85 * pr, 0.6 * pr, 0.4 * pr);
      g.fillStyle = "rgba(255, 255, 255, 0.6)";
      g.beginPath();
      g.arc(-0.4 * pr, 0, 0.3 * pr, 0, TWO_PI);
      g.fill();
      return;
    }
    case "grenade": {
      g.fillStyle = "#3f6212";
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.ellipse(0, 0.2 * pr, 1.0 * pr, 1.25 * pr, 0, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.strokeStyle = "rgba(0, 0, 0, 0.35)";
      g.beginPath();
      g.moveTo(-1.0 * pr, 0.2 * pr);
      g.lineTo(1.0 * pr, 0.2 * pr);
      g.moveTo(0, -1.05 * pr);
      g.lineTo(0, 1.45 * pr);
      g.stroke();
      g.fillStyle = "#9ca3af";
      g.strokeStyle = INK;
      g.beginPath();
      g.rect(-0.35 * pr, -1.5 * pr, 0.7 * pr, 0.5 * pr);
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(0.6 * pr, -1.4 * pr, 0.32 * pr, 0, TWO_PI);
      g.stroke();
      return;
    }
    case "dynamite": {
      g.fillStyle = "#dc2626";
      g.strokeStyle = INK;
      g.lineWidth = lw;
      roundRectPath(g, -0.55 * pr, -1.5 * pr, 1.1 * pr, 3.2 * pr, 0.3 * pr);
      g.fill();
      g.stroke();
      g.fillStyle = "#fef3c7";
      g.fillRect(-0.55 * pr, -0.2 * pr, 1.1 * pr, 0.5 * pr);
      g.strokeStyle = "#78350f";
      g.lineWidth = Math.max(0.6, 0.14 * pr);
      g.beginPath();
      g.moveTo(0, -1.5 * pr);
      g.quadraticCurveTo(0.6 * pr, -1.9 * pr, 0.5 * pr, -2.2 * pr);
      g.stroke();
      return;
    }
    case "balloon": {
      // a round balloon, its knot and a string
      g.fillStyle = color;
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.ellipse(0, -0.1 * pr, 1.25 * pr, 1.45 * pr, 0, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(-0.2 * pr, 1.35 * pr);
      g.lineTo(0.2 * pr, 1.35 * pr);
      g.lineTo(0, 1.6 * pr);
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = Math.max(0.5, 0.06 * pr);
      g.beginPath();
      g.moveTo(0, 1.6 * pr);
      g.quadraticCurveTo(0.5 * pr, 2.3 * pr, 0, 3.0 * pr);
      g.stroke();
      g.fillStyle = "rgba(255, 255, 255, 0.55)";
      g.beginPath();
      g.ellipse(-0.45 * pr, -0.6 * pr, 0.25 * pr, 0.42 * pr, -0.4, 0, TWO_PI);
      g.fill();
      return;
    }
    case "bubble": {
      g.globalAlpha = 0.35;
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, 0, 1.4 * pr, 0, TWO_PI);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = "rgba(255, 255, 255, 0.9)";
      g.lineWidth = Math.max(0.6, 0.12 * pr);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = Math.max(0.5, 0.08 * pr);
      g.beginPath();
      g.arc(0, 0, 1.25 * pr, 0, TWO_PI);
      g.stroke();
      g.fillStyle = "rgba(255, 255, 255, 0.85)";
      g.beginPath();
      g.arc(-0.5 * pr, -0.55 * pr, 0.28 * pr, 0, TWO_PI);
      g.fill();
      return;
    }
    case "boulder": {
      // an irregular rock (its corners hashed: the same rock every time)
      g.fillStyle = "#78716c";
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k * TWO_PI) / 9;
        const rr = (1.25 + 0.35 * hash(k, 11)) * pr;
        if (k === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = "rgba(0, 0, 0, 0.3)";
      g.beginPath();
      g.moveTo(-0.6 * pr, -0.3 * pr);
      g.lineTo(0.1 * pr, 0.2 * pr);
      g.lineTo(0.5 * pr, -0.1 * pr);
      g.stroke();
      return;
    }
    case "cannonball": {
      g.fillStyle = "#1f2937";
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(0, 0, 1.3 * pr, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.fillStyle = "rgba(255, 255, 255, 0.4)";
      g.beginPath();
      g.arc(-0.45 * pr, -0.45 * pr, 0.35 * pr, 0, TWO_PI);
      g.fill();
      return;
    }
    case "car": {
      // a toy car from the side: a rounded body, a cabin, two wheels
      g.fillStyle = color;
      g.strokeStyle = INK;
      g.lineWidth = lw;
      roundRectPath(g, -2.0 * pr, -0.4 * pr, 4.0 * pr, 1.1 * pr, 0.45 * pr);
      g.fill();
      g.stroke();
      g.fillStyle = shade(color.startsWith("#") ? color : p.accent, -0.25);
      roundRectPath(g, -1.0 * pr, -1.25 * pr, 2.0 * pr, 0.95 * pr, 0.35 * pr);
      g.fill();
      g.stroke();
      g.fillStyle = "rgba(224, 242, 254, 0.9)";
      g.fillRect(-0.75 * pr, -1.05 * pr, 0.6 * pr, 0.55 * pr);
      g.fillRect(0.15 * pr, -1.05 * pr, 0.6 * pr, 0.55 * pr);
      g.fillStyle = INK;
      for (const x of [-1.25, 1.25]) {
        g.beginPath();
        g.arc(x * pr, 0.75 * pr, 0.5 * pr, 0, TWO_PI);
        g.fill();
      }
      g.fillStyle = "#9ca3af";
      for (const x of [-1.25, 1.25]) {
        g.beginPath();
        g.arc(x * pr, 0.75 * pr, 0.2 * pr, 0, TWO_PI);
        g.fill();
      }
      return;
    }
    case "lash":
    case "lasso": {
      // a coil of rope (the lasso: an open loop)
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1.2, 0.42 * pr);
      g.beginPath();
      g.arc(0, 0, 1.2 * pr, 0, shape === "lasso" ? TWO_PI : 1.6 * Math.PI);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = Math.max(0.7, 0.24 * pr);
      g.stroke();
      if (shape === "lash") {
        g.beginPath();
        g.arc(0, 0, 0.6 * pr, 0.4, 1.6 * Math.PI);
        g.stroke();
      }
      return;
    }
    case "jaws": {
      // a trap's jaws seen from above: two toothed half rings
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1.2, 0.36 * pr);
      g.beginPath();
      g.arc(0, 0, 1.3 * pr, 0, TWO_PI);
      g.stroke();
      g.strokeStyle = "#9ca3af";
      g.lineWidth = Math.max(0.8, 0.2 * pr);
      g.stroke();
      g.fillStyle = "#e5e7eb";
      for (let k = 0; k < 8; k++) {
        const a = (k * TWO_PI) / 8;
        g.beginPath();
        g.moveTo(Math.cos(a - 0.2) * 1.15 * pr, Math.sin(a - 0.2) * 1.15 * pr);
        g.lineTo(Math.cos(a) * 0.65 * pr, Math.sin(a) * 0.65 * pr);
        g.lineTo(Math.cos(a + 0.2) * 1.15 * pr, Math.sin(a + 0.2) * 1.15 * pr);
        g.closePath();
        g.fill();
      }
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, 0, 0.3 * pr, 0, TWO_PI);
      g.fill();
      return;
    }
    case "windwall":
    case "brickwall": {
      if (shape === "brickwall") {
        g.fillStyle = "#b45309";
        g.strokeStyle = INK;
        g.lineWidth = lw;
        g.beginPath();
        g.rect(-1.8 * pr, -1.0 * pr, 3.6 * pr, 2.0 * pr);
        g.fill();
        g.stroke();
        g.strokeStyle = "#fde68a";
        g.lineWidth = Math.max(0.5, 0.1 * pr);
        g.beginPath();
        g.moveTo(-1.8 * pr, 0);
        g.lineTo(1.8 * pr, 0);
        for (const x of [-0.9, 0.9]) {
          g.moveTo(x * pr, -1.0 * pr);
          g.lineTo(x * pr, 0);
        }
        g.moveTo(0, 0);
        g.lineTo(0, 1.0 * pr);
        g.stroke();
        return;
      }
      g.strokeStyle = color;
      g.lineWidth = Math.max(0.8, 0.22 * pr);
      for (let k = -1; k <= 1; k++) {
        g.beginPath();
        g.moveTo(-1.8 * pr, k * 0.6 * pr);
        g.quadraticCurveTo(-0.6 * pr, k * 0.6 * pr - 0.5 * pr, 0, k * 0.6 * pr);
        g.quadraticCurveTo(0.6 * pr, k * 0.6 * pr + 0.5 * pr, 1.8 * pr, k * 0.6 * pr);
        g.stroke();
      }
      return;
    }
    default: {
      if (FL_SUMMON_SHAPES.includes(shape)) {
        drawSummon(g, 1.2 * pr, shape, color);
        return;
      }
      // bolt (and anything else): a short bright streak with a white core
      g.shadowColor = color;
      g.shadowBlur = 0.8 * pr;
      g.strokeStyle = color;
      g.lineWidth = 1.5 * pr;
      g.beginPath();
      g.moveTo(-2 * pr, 0);
      g.lineTo(1.2 * pr, 0);
      g.stroke();
      g.shadowBlur = 0;
      g.shadowColor = "rgba(0, 0, 0, 0)";
      g.strokeStyle = "#ffffff";
      g.lineWidth = 0.6 * pr;
      g.stroke();
    }
  }
}

/** Two dot eyes of a summon (at most two, no other face). */
function dotEyes(g: CanvasRenderingContext2D, x: number, y: number, gap: number, r: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x - gap, y, r, 0, TWO_PI);
  g.arc(x + gap, y, r, 0, TWO_PI);
  g.fill();
}

/**
 * A summon's body (radius `R`): a wolf (ears), a wight (hollow eyes), a clone (the owner's colours), and – side
 * silhouettes – a shark, a hyena, a jellyfish, a ghost (a wavy translucent bottom) and a horse. Two dot eyes at most.
 */
export function drawSummon(g: CanvasRenderingContext2D, R: number, shape: FlShape, color: string) {
  g.lineWidth = Math.max(0.8, 0.1 * R);
  g.strokeStyle = INK;
  g.lineJoin = "round";
  switch (shape) {
    case "wolf": {
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
      dotEyes(g, 0, -0.15 * R, 0.35 * R, 0.13 * R, "#dc2626");
      g.fillStyle = INK;
      g.beginPath();
      g.arc(0, 0.3 * R, 0.16 * R, 0, TWO_PI);
      g.fill();
      return;
    }
    case "wight": {
      g.fillStyle = "#cbd5e1";
      g.beginPath();
      g.arc(0, 0, R, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.shadowColor = "#38bdf8";
      g.shadowBlur = 0.4 * R;
      dotEyes(g, 0, -0.12 * R, 0.33 * R, 0.16 * R, "#38bdf8");
      g.shadowBlur = 0;
      g.shadowColor = "rgba(0, 0, 0, 0)";
      return;
    }
    case "shark": {
      // a side view: a torpedo body, a dorsal fin, a tail fin
      g.fillStyle = "#64748b";
      g.beginPath();
      g.moveTo(1.4 * R, 0);
      g.quadraticCurveTo(0.6 * R, -0.8 * R, -0.9 * R, -0.25 * R);
      g.lineTo(-1.5 * R, -0.75 * R);
      g.lineTo(-1.3 * R, 0);
      g.lineTo(-1.5 * R, 0.75 * R);
      g.lineTo(-0.9 * R, 0.25 * R);
      g.quadraticCurveTo(0.6 * R, 0.75 * R, 1.4 * R, 0);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(-0.1 * R, -0.5 * R);
      g.lineTo(-0.45 * R, -1.15 * R);
      g.lineTo(-0.55 * R, -0.42 * R);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = "#e2e8f0";
      g.beginPath();
      g.moveTo(1.2 * R, 0.1 * R);
      g.quadraticCurveTo(0.4 * R, 0.55 * R, -0.6 * R, 0.25 * R);
      g.lineTo(1.2 * R, 0.1 * R);
      g.fill();
      dotEyes(g, 0.85 * R, -0.18 * R, 0, 0.09 * R, INK);
      return;
    }
    case "hyena": {
      // a side view: a sloped body, legs, a big head with round ears, spots
      g.fillStyle = "#d6a35c";
      g.beginPath();
      g.ellipse(-0.1 * R, 0.05 * R, 1.05 * R, 0.6 * R, -0.15, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(0.95 * R, -0.35 * R, 0.45 * R, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(0.85 * R, -0.85 * R, 0.17 * R, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.fillStyle = "#7c5a3c";
      for (const x of [-0.6, -0.2, 0.3]) {
        g.beginPath();
        g.arc(x * R, -0.05 * R, 0.1 * R, 0, TWO_PI);
        g.fill();
      }
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1, 0.16 * R);
      g.beginPath();
      for (const x of [-0.75, -0.35, 0.25, 0.6]) {
        g.moveTo(x * R, 0.5 * R);
        g.lineTo(x * R, 1.0 * R);
      }
      g.stroke();
      dotEyes(g, 1.1 * R, -0.45 * R, 0, 0.08 * R, INK);
      return;
    }
    case "jellyfish": {
      // a translucent bell and wavy tentacles
      g.globalAlpha = 0.8;
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, -0.1 * R, R, Math.PI, 0);
      g.quadraticCurveTo(0.5 * R, 0.15 * R, 0, -0.05 * R);
      g.quadraticCurveTo(-0.5 * R, 0.15 * R, -R, -0.1 * R);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = Math.max(0.8, 0.1 * R);
      g.beginPath();
      for (const x of [-0.6, -0.2, 0.2, 0.6]) {
        g.moveTo(x * R, 0.05 * R);
        g.quadraticCurveTo((x + 0.25) * R, 0.55 * R, x * R, 1.0 * R);
        g.quadraticCurveTo((x - 0.2) * R, 1.25 * R, x * R, 1.45 * R);
      }
      g.stroke();
      dotEyes(g, 0, -0.45 * R, 0.3 * R, 0.09 * R, INK);
      return;
    }
    case "ghost": {
      // a round head on a wavy translucent bottom
      g.globalAlpha = 0.72;
      g.fillStyle = "#f8fafc";
      g.beginPath();
      g.arc(0, -0.2 * R, R, Math.PI, 0);
      g.lineTo(R, 0.9 * R);
      for (let k = 0; k < 4; k++) {
        const x0 = R - (k + 0.5) * 0.5 * R;
        const x1 = R - (k + 1) * 0.5 * R;
        g.quadraticCurveTo(x0, (k % 2 === 0 ? 0.55 : 1.15) * R, x1, 0.9 * R);
      }
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      g.stroke();
      dotEyes(g, 0, -0.3 * R, 0.33 * R, 0.14 * R, INK);
      return;
    }
    case "horse": {
      // a side view: a body, a neck, a head, four legs, a mane in the summon's colour
      g.fillStyle = "#a16207";
      g.beginPath();
      g.ellipse(-0.15 * R, 0.1 * R, 1.0 * R, 0.5 * R, 0, 0, TWO_PI);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(0.55 * R, -0.1 * R);
      g.lineTo(0.95 * R, -0.95 * R);
      g.lineTo(1.4 * R, -0.75 * R);
      g.lineTo(1.25 * R, -0.5 * R);
      g.lineTo(0.85 * R, 0.25 * R);
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, 0.2 * R);
      g.beginPath();
      g.moveTo(0.55 * R, -0.15 * R);
      g.lineTo(0.9 * R, -0.95 * R);
      g.stroke();
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1, 0.16 * R);
      g.beginPath();
      for (const x of [-0.85, -0.55, 0.25, 0.55]) {
        g.moveTo(x * R, 0.5 * R);
        g.lineTo(x * R, 1.1 * R);
      }
      g.stroke();
      dotEyes(g, 1.12 * R, -0.75 * R, 0, 0.07 * R, INK);
      return;
    }
    default: {
      // a clone: the owner's colours with a highlight
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
  }
}

/** The painter of the arena's moving things other than the fighters and their held weapons. */
export class FlProjectilesPainter {
  private readonly sprites = new Map<number, Sprite | null>();
  private readonly colorIds = new Map<string, number>();
  private generation = -1;
  private px = 0;

  begin(view: FightLeagueView, px: number) {
    if (Math.abs(px - this.px) > 1e-6) {
      this.px = px;
      this.sprites.clear();
    }
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      if (this.sprites.size > 600) this.sprites.clear();
    }
  }

  private colorId(color: string): number {
    let id = this.colorIds.get(color);
    if (id === undefined) {
      id = this.colorIds.size & 1023;
      this.colorIds.set(color, id);
    }
    return id;
  }

  /** A shape's sprite at radius `pr` (its size bucket: 0.5 device px), colour and owner palette. */
  shotSprite(shape: FlShape, pr: number, color: string, owner: FlFighter): Sprite | null {
    const px = this.px || 1;
    const bucket = Math.max(1, Math.min(4095, Math.round(pr * px * 2)));
    const key = ((bucket * SHAPE_SLOTS + (SHAPE_INDEX.get(shape) ?? 10)) * 1024 + this.colorId(color)) * 16 + (owner.slot & 15);
    if (this.sprites.has(key)) return this.sprites.get(key) ?? null;
    if (this.sprites.size > 800) this.sprites.clear();
    const r = bucket / (2 * px);
    const p: FlPaint = { body: owner.row.body, accent: owner.row.accent, color };
    const s = FL_SUMMON_SHAPES.includes(shape)
      ? makeSprite({ x0: -1.8 * r, y0: -1.8 * r, x1: 1.8 * r, y1: 1.8 * r }, px, (g) => drawSummon(g, r, shape, color))
      : makeSprite(shotBox(shape, r), px, (g) => drawShot(g, shape, r, color, p));
    this.sprites.set(key, s);
    return s;
  }

  /** Draws a shape at (x, y) along `angle` (the frame's `shot` hook). */
  readonly drawShape = (ctx: CanvasRenderingContext2D, shape: FlShape, pr: number, color: string, owner: FlFighter, x: number, y: number, angle: number, alpha: number) => {
    const s = this.shotSprite(shape, pr, color, owner);
    if (!s) return;
    const px = this.px || 1;
    const k = pr / (Math.max(1, Math.min(4095, Math.round(pr * px * 2))) / (2 * px));
    ctx.save();
    ctx.translate(x, y);
    if (angle !== 0) ctx.rotate(angle);
    if (alpha < 1) ctx.globalAlpha *= alpha;
    ctx.drawImage(s.canvas, s.x0 * k, s.y0 * k, s.w * k, s.h * k);
    ctx.restore();
  };

  /** The projectiles in flight (their trails under them). Returns how many were drawn. */
  drawProjectiles(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView): number {
    const now = fr.now;
    let n = 0;
    // the trails first, one stroke each (tracers, shard trails, a thrown weapon's whoosh)
    if (!fr.lite) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const p of view.projectiles) {
        if (!p.active || now < p.born || p.kind === PK_BOMB || p.trailCount < 2) continue;
        const shape = shapeOf(p, view);
        const tracer = shape === "bullet" || shape === "pellet";
        const whoosh = p.kind === PK_HAMMER || p.kind === PK_SHIELD || shape === "saber" || shape === "blades" || shape === "batarang" || shape === "shuriken";
        ctx.strokeStyle = tracer ? "#fde047" : whoosh ? "#ffffff" : p.color;
        ctx.globalAlpha = tracer ? 0.55 : whoosh ? 0.5 : 0.3;
        ctx.lineWidth = Math.max(1, (tracer ? 0.5 : whoosh ? 1.4 : 0.9) * p.r);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        const len = p.trail.length >> 1;
        const count = Math.min(p.trailCount, tracer ? 3 : len);
        let maxD = tracer ? 1.5 * (view.fighters[p.owner]?.r ?? 10) : Infinity;
        let lx = p.x;
        let ly = p.y;
        for (let k = 0; k < count; k++) {
          const i = (((p.trailHead - 1 - k) % len) + len) % len;
          const tx = p.trail[2 * i];
          const ty = p.trail[2 * i + 1];
          const d = Math.hypot(tx - lx, ty - ly);
          if (d > maxD) {
            const u = maxD / d;
            ctx.lineTo(lx + (tx - lx) * u, ly + (ty - ly) * u);
            break;
          }
          maxD -= d;
          ctx.lineTo(tx, ty);
          lx = tx;
          ly = ty;
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const p of view.projectiles) {
      if (!p.active) continue;
      const owner = view.fighters[p.owner];
      if (!owner || now < p.born) continue;
      const shape = shapeOf(p, view);
      if (p.kind === PK_BOMB) {
        this.drawBomb(ctx, fr, p, owner, shape, now);
        n++;
        continue;
      }
      const angle = spinsShape(shape) || p.kind === PK_HAMMER || p.kind === PK_SHIELD ? p.spin : Math.atan2(p.vy, p.vx);
      if (p.giant > 0) fr.glow.draw(ctx, owner.row.accent, p.x, p.y, 3 * p.r, 0.5 + 0.25 * Math.sin(now / 50));
      this.drawShape(ctx, shape, p.r, p.color, owner, p.x, p.y, angle, 1);
      n++;
    }
    return n;
  }

  /** A lobbed bomb: its dashed landing reticle (the splash), its shrinking shadow, the bomb lifted along its arc, a lit fuse. */
  private drawBomb(ctx: CanvasRenderingContext2D, fr: FlFrame, p: FlProjectile, owner: FlFighter, shape: FlShape, now: number) {
    const h = flBombHeight(p, now);
    const flying = now < p.flyUntil;
    if (flying && p.splash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = Math.max(1, 0.08 * owner.r);
      ctx.setLineDash([0.35 * owner.r, 0.25 * owner.r]);
      ctx.lineDashOffset = now / 30;
      ctx.beginPath();
      ctx.arc(p.x1, p.y1, p.splash, 0, TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p.x1 - 0.3 * owner.r, p.y1);
      ctx.lineTo(p.x1 + 0.3 * owner.r, p.y1);
      ctx.moveTo(p.x1, p.y1 - 0.3 * owner.r);
      ctx.lineTo(p.x1, p.y1 + 0.3 * owner.r);
      ctx.stroke();
      ctx.restore();
    }
    const lift = Math.max(1, p.lift);
    const k = 1 - 0.45 * Math.min(1, h / lift);
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, Math.max(1, 1.1 * p.r * k), Math.max(0.6, 0.55 * p.r * k), 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
    const by = p.y - 0.6 * h;
    this.drawShape(ctx, shape, p.r, p.color, owner, p.x, by, p.spin, 1);
    if (p.fuseUntil >= 0 && now < p.fuseUntil) drawFuseSparks(ctx, p.x + 0.5 * p.r, by - 1.7 * p.r, p.r, now, 1);
    void fr;
  }

  /** Fire rings: a ring of flames, blades or boots spinning round their fighter. */
  drawFireRings(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const now = fr.now;
    for (const f of view.fighters) {
      if (!f.alive || now >= f.fireRingUntil) continue;
      const x = fr.x(f);
      const y = fr.y(f);
      const R = f.fireRingRadius;
      const blades = f.fireRingShape !== "flames";
      const kicks = f.fireRingShape === "kicks";
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = blades ? f.row.accent : "#f97316";
      ctx.beginPath();
      ctx.arc(x, y, R, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      const n = blades ? 8 : 14;
      const spin = fr.fxNow / (blades ? 90 : 260);
      for (let k = 0; k < n; k++) {
        const a = spin + (k * TWO_PI) / n;
        const flick = 0.75 + 0.25 * Math.sin(fr.fxNow / 55 + k * 1.7);
        if (blades) this.drawShape(ctx, kicks ? "kicks" : "dagger", (kicks ? 0.3 : 0.22) * f.r, "#e5e7eb", f, x + Math.cos(a) * 0.8 * R, y + Math.sin(a) * 0.8 * R, a + Math.PI / 2, 1);
        else {
          ctx.fillStyle = k % 2 === 0 ? "#f97316" : "#facc15";
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * 0.85 * R, y + Math.sin(a) * 0.85 * R, 0.16 * R * flick, 0, TWO_PI);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  /** Beams: a glow, the ray, a white core and an end splash. */
  drawBeams(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const now = fr.now;
    for (const b of view.beams) {
      if (!b.active) continue;
      const life = Math.max(1, b.until - b.born);
      const t = (now - b.born) / life;
      const fade = t < 0.12 ? t / 0.12 : t > 0.85 ? Math.max(0, (1 - t) / 0.15) : 1;
      const wob = 1 + 0.12 * Math.sin(fr.fxNow / 25);
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
      fr.glow.draw(ctx, b.color, b.x1, b.y1, 1.6 * b.width * wob, 0.8 * fade);
      ctx.save();
      ctx.globalAlpha = 0.9 * fade;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(b.x1, b.y1, 0.45 * b.width * wob, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Decoys (see-through, a scanline shimmer), summons, and traps (jaws open once armed, dim before). */
  drawMinions(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const now = fr.now;
    for (const m of view.minions) {
      if (!m.active) continue;
      const owner = view.fighters[m.owner];
      if (!owner) continue;
      const born = Math.min(1, (now - m.born) / 200);
      const left = m.until - now;
      const fade = left < 400 ? 0.4 + 0.6 * Math.abs(Math.sin(now / 60)) : 1;
      if (m.summon) {
        // scaling out of its portal
        const k = 0.4 + 0.6 * born;
        this.drawShape(ctx, m.shape, m.r * k, m.color, owner, m.x, m.y, 0, born * fade);
        continue;
      }
      if (m.trap) {
        const armed = now >= m.armedAt;
        const open = armed ? 1 : 0.35;
        ctx.save();
        ctx.globalAlpha = (armed ? 1 : 0.5) * born * fade;
        ctx.translate(m.x, m.y);
        // two jaws, opened by `open`
        for (const sgn of [-1, 1]) {
          ctx.save();
          ctx.rotate(sgn * 0.5 * open);
          ctx.strokeStyle = INK;
          ctx.lineWidth = Math.max(2, 0.36 * m.r);
          ctx.beginPath();
          ctx.arc(0, 0, m.r, sgn < 0 ? Math.PI : 0, sgn < 0 ? TWO_PI : Math.PI);
          ctx.stroke();
          ctx.strokeStyle = m.color;
          ctx.lineWidth = Math.max(1.2, 0.2 * m.r);
          ctx.stroke();
          ctx.fillStyle = "#e5e7eb";
          for (let k = 0; k < 4; k++) {
            const a = (sgn < 0 ? Math.PI : 0) + ((k + 0.5) * Math.PI) / 4;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a - 0.18) * 0.92 * m.r, Math.sin(a - 0.18) * 0.92 * m.r);
            ctx.lineTo(Math.cos(a) * 0.55 * m.r, Math.sin(a) * 0.55 * m.r);
            ctx.lineTo(Math.cos(a + 0.18) * 0.92 * m.r, Math.sin(a + 0.18) * 0.92 * m.r);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        }
        ctx.restore();
        continue;
      }
      // a decoy: the owner's body at 60 %, a shimmer of scanlines, the outline dashed (icy for a freeze decoy)
      ctx.save();
      ctx.globalAlpha = 0.6 * born * fade;
      ctx.fillStyle = owner.row.body;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TWO_PI);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.25 * born * fade;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, 0.08 * m.r);
      const off = ((fr.fxNow / 40) % 1) * 0.3 * m.r;
      ctx.beginPath();
      for (let yy = -m.r + off; yy < m.r; yy += 0.3 * m.r) {
        ctx.moveTo(m.x - m.r, m.y + yy);
        ctx.lineTo(m.x + m.r, m.y + yy);
      }
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 0.6 * born * fade;
      ctx.lineWidth = Math.max(1.5, 0.12 * m.r);
      ctx.strokeStyle = m.freezeOnTouch > 0 ? "#7dd3fc" : owner.row.accent;
      ctx.setLineDash([0.5 * m.r, 0.35 * m.r]);
      ctx.lineDashOffset = now / 30;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  /** The barriers of the wall primitive: rising over 150 ms, a brick or a wind band (a solid one opaque and outlined). */
  drawWalls(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const now = fr.now;
    for (const w of view.walls) {
      if (!w.active) continue;
      const owner = view.fighters[w.owner];
      const r = owner ? owner.r : 10;
      const rise = Math.min(1, Math.max(0, (now - w.born) / 150));
      const left = w.until - now;
      const fade = left < 400 ? 0.4 + 0.6 * Math.abs(Math.sin(now / 60)) : 1;
      const mx = 0.5 * (w.x1 + w.x2);
      const my = 0.5 * (w.y1 + w.y2);
      // rising: the band grows out of its middle
      const ax = mx + (w.x1 - mx) * rise;
      const ay = my + (w.y1 - my) * rise;
      const bx = mx + (w.x2 - mx) * rise;
      const by = my + (w.y2 - my) * rise;
      const thick = Math.max(2, (w.solid ? 0.46 : 0.34) * r);
      ctx.save();
      ctx.globalAlpha = (w.solid ? 0.95 : 0.65) * fade;
      ctx.lineCap = "round";
      ctx.strokeStyle = INK;
      ctx.lineWidth = thick + Math.max(1.5, 0.1 * r);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.strokeStyle = w.shape === "brickwall" ? "#b45309" : w.color;
      ctx.lineWidth = thick;
      ctx.stroke();
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      ctx.lineWidth = Math.max(1, 0.06 * r);
      ctx.strokeStyle = w.shape === "brickwall" ? "#fde68a" : "rgba(255, 255, 255, 0.8)";
      ctx.beginPath();
      const step = Math.max(4, 0.6 * r);
      const phase = w.shape === "brickwall" ? 0 : ((fr.fxNow / 120) % 1) * step;
      for (let d = phase; d < len; d += step) {
        const px = ax + ux * d;
        const py = ay + uy * d;
        if (w.shape === "brickwall") {
          ctx.moveTo(px - uy * 0.5 * thick, py + ux * 0.5 * thick);
          ctx.lineTo(px + uy * 0.5 * thick, py - ux * 0.5 * thick);
        } else {
          ctx.moveTo(px - ux * 0.25 * step, py - uy * 0.25 * step);
          ctx.lineTo(px + ux * 0.25 * step, py + uy * 0.25 * step);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Arena cuts about to land (dashed lines glinting) and fused shockwaves (a blinking ring round the block). */
  drawTasks(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const now = fr.now;
    for (const t of view.tasks) {
      if (!t.active || now >= t.at) continue;
      const k = Math.max(0, Math.min(1, (now - t.born) / Math.max(1, t.at - t.born)));
      if (t.kind === "cut") {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.5 * k;
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -now / 25;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x2, t.y2);
        ctx.stroke();
        ctx.setLineDash([]);
        // a glint running along it
        const u = (now / 400) % 1;
        fr.glow.draw(ctx, "#ffffff", t.x + (t.x2 - t.x) * u, t.y + (t.y2 - t.y) * u, 8, 0.8 * k);
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
        const s = Math.max(4, 0.16 * t.radius);
        ctx.fillStyle = "#dc2626";
        ctx.fillRect(t.x - s, t.y - s, 2 * s, 2 * s);
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(t.x - s, t.y - 0.3 * s, 2 * s, 0.6 * s);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(t.x - s, t.y - s, 2 * s, 2 * s);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

/** The shape a projectile is drawn as (a thrown hammer, shield or spear flies as itself). */
export function shapeOf(p: FlProjectile, view: FightLeagueView): FlShape {
  if (p.kind === PK_HAMMER) {
    const owner = view.fighters[p.owner];
    const look = owner?.row.weapons[p.weapon]?.look;
    return look === "pan" ? "pan" : look === "mallet" ? "mallet" : "hammer";
  }
  if (p.kind === PK_SHIELD) return "shield";
  if (p.kind === PK_SPEAR) return view.fighters[p.owner]?.row.weapons[p.weapon]?.shape === "blades" ? "blades" : "spear";
  return p.shape;
}
