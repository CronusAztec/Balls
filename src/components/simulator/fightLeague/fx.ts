import {
  EV_BLINK,
  EV_BLOCK,
  EV_CAST,
  EV_CLASH,
  EV_CUT,
  EV_DAMAGE,
  EV_DODGE,
  EV_FREEZE,
  EV_GRAZE,
  EV_HEAL,
  EV_HIT,
  EV_IMMUNE,
  EV_IMPACT,
  EV_INTERRUPT,
  EV_KO,
  EV_LIGHTNING,
  EV_POP,
  EV_SHOCK,
  EV_SLAM,
  EV_TRANSFORM,
  EV_TRAP,
  FL_EVENT_CAP,
  FL_WALL_AHEAD,
  FL_WALL_LENGTH,
  type FightLeagueView,
  type FlEvent,
  type FlFighter,
} from "@/lib/physics/modes/fightLeague";
import {
  FL_COMBO_MIN,
  FL_COMBO_MS,
  FL_GIANT_COLOR,
  FL_HEAL_COLOR,
  FL_NUMBER_MS,
  FL_NUMBER_RISE,
  FL_REFLECT_COLOR,
  flDamageColor,
  flEffectNow,
  flFinaleZoom,
  flNumberPop,
  flTelegraphProgress,
  flVolleyTicks,
} from "@/lib/physics/modes/fightLeagueFx";
import type { FlEffect, FlPrimitive } from "@/lib/physics/modes/fightLeagueRoster";
import type { FlBodiesPainter } from "./bodies";
import type { FlFrame, FightLeagueLabels } from "./frame";
import { GOLD, INK, withAlpha } from "./palette";
import { TWO_PI, hash, makeSprite, polygonPath, starPath, type Sprite } from "./sprites";
import { HEAL_TEXT, MULT_TEXT, damageText, type FlTextStyle } from "./text";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's effects: the event ring's sparks (batched, one path a colour), damage numbers
 * (from the digit atlas: colour tiers, a giant's gold '×N', heals and drains green, reflected damage violet; each pops
 * 1.35 → 1 and rises 0.9 unit, clamped inside the arena), the crit burst, blocks, clashes, grazes, lightning, shockwaves and
 * bursts, cuts, blinks, freezes, pops, slams, traps snapping, transforms, the impact flash, the KO's ghost (it flies on
 * along its last velocity with four afterimages) and its shards, the side callouts (combos, BLOCK, DODGE!, IMMUNE,
 * INTERRUPTED!, CLASH!, the ability's name rising), every primitive's telegraph preview (`FL_PRIM_FX`), the KO finale's
 * speed lines and spotlight, and the ultimates' super flash. Every age runs on the effects' clock (the finale's warp).
 */

/** Simulation ms the effects last. */
const SPARK_MS = 200;
const KO_MS = 1200;
const LIGHTNING_MS = 380;
const SHOCK_MS = 420;
const BURST_FLASH_MS = 80;
const BURST_RING_MS = 300;
const CUT_MS = 320;
const BLINK_MS = 320;
const CAST_MS = 900;
const HEAL_MS = 800;
const POP_MS = 320;
const FREEZE_MS = 420;
const CALLOUT_MS = 650;
const DODGE_MS = 600;
const SLAM_MS = 360;
const TRAP_MS = 420;
const IMPACT_FLASH_MS = 90;
const SHARDS = 12;
/** The ultimates' super flash (ms). */
export const FL_SUPER_FLASH_MS = 450;

/** What a primitive's telegraph preview looks like (the table the renderer and the tests share). */
export interface FlPrimFx {
  /** The preview drawn while the cast telegraphs. */
  preview: "ring" | "aim" | "fan" | "markers" | "frost" | "tether" | "cuts" | "swirl" | "puff" | "motes" | "badge" | "cloud" | "reticle" | "portal" | "mirror" | "lock" | "clock" | "drops" | "ghostWall" | "grow" | "drain" | "aura";
  /** Its colour (null: the caster's accent). */
  color: string | null;
}

/** Every primitive's telegraph look (fire / sustain / end are the events', the statuses' and the beams' own). */
export const FL_PRIM_FX: Readonly<Record<FlPrimitive, FlPrimFx>> = {
  speedBurst: { preview: "aura", color: "#38bdf8" },
  damageBurst: { preview: "aura", color: "#ef4444" },
  attackSpeedBurst: { preview: "aura", color: GOLD },
  invulnerable: { preview: "aura", color: GOLD },
  freezeAll: { preview: "frost", color: "#7dd3fc" },
  choke: { preview: "tether", color: "#a855f7" },
  arenaCuts: { preview: "cuts", color: "#ef4444" },
  beam: { preview: "aim", color: null },
  volley: { preview: "fan", color: null },
  shockwave: { preview: "ring", color: null },
  pull: { preview: "swirl", color: null },
  decoys: { preview: "puff", color: null },
  heal: { preview: "motes", color: FL_HEAL_COLOR },
  fireRing: { preview: "ring", color: "#f97316" },
  giantHit: { preview: "badge", color: FL_GIANT_COLOR },
  lightning: { preview: "markers", color: null },
  confuse: { preview: "cloud", color: "#86efac" },
  blinkStrike: { preview: "reticle", color: null },
  summon: { preview: "portal", color: null },
  reflect: { preview: "mirror", color: null },
  disarm: { preview: "lock", color: "#9ca3af" },
  slowTime: { preview: "clock", color: "#14b8a6" },
  trap: { preview: "drops", color: null },
  wall: { preview: "ghostWall", color: null },
  transform: { preview: "grow", color: null },
  drain: { preview: "drain", color: "#ef4444" },
};

/** The colours the batched sparks group by this frame (reused). */
const SPARK_COLORS: string[] = [];
const FAN: number[] = [];

/** The effects painter of one layer. */
export class FlFxPainter {
  /** Callouts and telegraphs seen this run (data-fl-callouts, data-fl-telegraphs). */
  readonly callouts = new Set<string>();
  telegraphs = 0;
  private readonly seenTelegraph = new Float64Array(8).fill(-1);
  private generation = -1;
  private vignette: Sprite | null = null;

  begin(view: FightLeagueView) {
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.callouts.clear();
      this.telegraphs = 0;
      this.seenTelegraph.fill(-1);
    }
  }

  /** The effects' age of an event `t` at the frame (the finale's warp applied to both). */
  private age(fr: FlFrame, view: FightLeagueView, t: number): number {
    return fr.fxNow - flEffectNow(view, t);
  }

  /** A text callout clamped inside the arena (the display face, upper case, an ink stroke). */
  private callout(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, name: string, text: string, x: number, y: number, size: number, color: string, alpha: number, pop = 1) {
    const field = view.field;
    if (!field || !(alpha > 0)) return;
    const style: FlTextStyle = { role: "display", color, stroke: INK, strokeK: 0.14 };
    const up = fr.text.upperOf(text);
    const w = fr.text.width(up, size, style) * pop;
    const half = field.half;
    const cx = Math.max(field.cx - half + w / 2 + 2, Math.min(field.cx + half - w / 2 - 2, x));
    const cy = Math.max(field.cy - half + 0.7 * size, Math.min(field.cy + half - 0.7 * size, y));
    fr.text.draw(ctx, up, cx, cy, size, style, "center", 2 * half - 4, alpha, pop);
    this.callouts.add(name);
  }

  /** The telegraph previews of every casting fighter (under the bodies). */
  drawTelegraphs(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const now = fr.now;
    for (const f of view.fighters) {
      if (!f.alive || f.telegraphUntil < 0) continue;
      if (f.slot < this.seenTelegraph.length && this.seenTelegraph[f.slot] !== f.telegraphStart) {
        this.seenTelegraph[f.slot] = f.telegraphStart;
        this.telegraphs++;
      }
      const k = flTelegraphProgress(f.telegraphStart, f.telegraphUntil, now);
      for (const e of f.row.ability.effects) this.preview(ctx, fr, view, f, e, k, now);
    }
  }

  private preview(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, f: FlFighter, e: FlEffect, k: number, now: number) {
    const fx = FL_PRIM_FX[e.p];
    const color = fx.color ?? f.row.accent;
    const x = fr.x(f);
    const y = fr.y(f);
    const r = f.r;
    const field = view.field!;
    ctx.save();
    ctx.lineCap = "round";
    switch (fx.preview) {
      case "ring": {
        // a dashed radius ring filling in, then the flash (the event)
        const R = "radius" in e && typeof e.radius === "number" ? e.radius * r : f.telegraphArea > 0 ? f.telegraphArea : 3 * r;
        ctx.globalAlpha = 0.12 * k;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 0.55 + 0.35 * k;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 0.08 * r);
        ctx.setLineDash([0.4 * r, 0.3 * r]);
        ctx.beginPath();
        ctx.arc(x, y, R, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = Math.max(2, 0.14 * r);
        ctx.beginPath();
        ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + k * TWO_PI);
        ctx.stroke();
        break;
      }
      case "aim": {
        // the aim line to the edge and a charging orb in the hand
        const a = Math.atan2(f.castY - y, f.castX - x);
        const len = 2 * field.side;
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, 0.06 * r);
        ctx.setLineDash([0.3 * r, 0.25 * r]);
        ctx.lineDashOffset = -now / 25;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 1.2 * r, y + Math.sin(a) * 1.2 * r);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
        ctx.setLineDash([]);
        fr.glow.draw(ctx, color, x + Math.cos(a) * 1.25 * r, y + Math.sin(a) * 1.25 * r, (0.5 + 0.7 * k) * r, 0.85);
        break;
      }
      case "fan": {
        const n = "n" in e && typeof e.n === "number" ? e.n : 3;
        const spread = "spread" in e && typeof e.spread === "number" ? e.spread : 30;
        flVolleyTicks(Math.min(12, n), spread, Math.atan2(f.castY - y, f.castX - x), FAN);
        ctx.globalAlpha = 0.5 + 0.4 * k;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 0.08 * r);
        ctx.beginPath();
        for (const a of FAN) {
          ctx.moveTo(x + Math.cos(a) * 1.5 * r, y + Math.sin(a) * 1.5 * r);
          ctx.lineTo(x + Math.cos(a) * (1.5 + 0.9 * k) * r, y + Math.sin(a) * (1.5 + 0.9 * k) * r);
        }
        ctx.stroke();
        break;
      }
      case "markers":
        // a dark marker over every foe (the bolt lands there)
        for (const o of view.fighters) {
          if (!o.alive || o.team === f.team) continue;
          const ox = fr.x(o);
          const oy = fr.y(o);
          ctx.globalAlpha = 0.25 + 0.3 * k;
          ctx.fillStyle = INK;
          ctx.beginPath();
          ctx.ellipse(ox, oy, 1.3 * o.r, 0.65 * o.r, 0, 0, TWO_PI);
          ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.5, 0.08 * o.r);
          ctx.beginPath();
          ctx.arc(ox, oy - (2.4 - 1.0 * k) * o.r, 0.35 * o.r, 0, TWO_PI);
          ctx.stroke();
        }
        break;
      case "frost": {
        // frost creeping in from the rim
        const band = (0.05 + 0.18 * k) * field.side;
        ctx.globalAlpha = 0.18 + 0.2 * k;
        ctx.strokeStyle = color;
        ctx.lineWidth = band;
        ctx.beginPath();
        if (field.kind === "circle") ctx.arc(field.cx, field.cy, field.half - band / 2, 0, TWO_PI);
        else ctx.rect(field.cx - field.half + band / 2, field.cy - field.half + band / 2, 2 * field.half - band, 2 * field.half - band);
        ctx.stroke();
        break;
      }
      case "tether": {
        const o = nearestFoe(view, f, fr);
        if (!o) break;
        const ox = fr.x(o);
        const oy = fr.y(o);
        ctx.globalAlpha = 0.5 + 0.4 * k;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, (0.06 + 0.1 * k) * r);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ox, oy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ox, oy, o.r * (2 - 0.85 * k), 0, TWO_PI);
        ctx.stroke();
        break;
      }
      case "swirl": {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 0.08 * r);
        for (let q = 0; q < 3; q++) {
          const a0 = now / 200 + (q * TWO_PI) / 3;
          ctx.beginPath();
          ctx.arc(x, y, (1.6 + 0.4 * q) * r, a0, a0 + 1.6);
          ctx.stroke();
        }
        for (const o of view.fighters) {
          if (!o.alive || o.team === f.team) continue;
          ctx.globalAlpha = 0.25 * k;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(fr.x(o), fr.y(o));
          ctx.stroke();
        }
        break;
      }
      case "puff":
      case "cloud": {
        ctx.globalAlpha = 0.3 + 0.3 * k;
        ctx.fillStyle = color;
        for (let q = 0; q < 4; q++) {
          const a = (q * TWO_PI) / 4 + now / 300;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * 0.8 * r, y - (fx.preview === "cloud" ? 1.3 * r : 0) + Math.sin(a) * 0.5 * r, (0.35 + 0.25 * k) * r, 0, TWO_PI);
          ctx.fill();
        }
        break;
      }
      case "motes":
        ctx.fillStyle = color;
        for (let q = 0; q < 6; q++) {
          const u = ((now / 900 + hash(q, f.slot)) % 1 + 1) % 1;
          ctx.globalAlpha = 0.8 * (1 - u);
          ctx.beginPath();
          ctx.arc(x + (hash(q, f.slot + 3) - 0.5) * 1.8 * r, y + r - u * 2.4 * r, 0.12 * r, 0, TWO_PI);
          ctx.fill();
        }
        break;
      case "badge": {
        const mult = "mult" in e && typeof e.mult === "number" ? Math.round(e.mult) : 2;
        fr.glow.draw(ctx, color, x, y, 1.9 * r, 0.35 + 0.3 * k);
        fr.text.number(ctx, MULT_TEXT[Math.max(0, Math.min(99, mult))], x, y - 1.7 * r, 0.7 * r, color, INK, "center", 0.6 + 0.4 * k);
        break;
      }
      case "reticle": {
        const o = nearestFoe(view, f, fr);
        if (!o) break;
        const ox = fr.x(o);
        const oy = fr.y(o);
        const R = o.r * (2.2 - 0.9 * k);
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 0.08 * o.r);
        ctx.beginPath();
        ctx.arc(ox, oy, R, 0, TWO_PI);
        for (let q = 0; q < 4; q++) {
          const a = (q * Math.PI) / 2 + now / 400;
          ctx.moveTo(ox + Math.cos(a) * 0.6 * R, oy + Math.sin(a) * 0.6 * R);
          ctx.lineTo(ox + Math.cos(a) * 1.25 * R, oy + Math.sin(a) * 1.25 * R);
        }
        ctx.stroke();
        break;
      }
      case "portal": {
        const a = Math.atan2(f.castY - y, f.castX - x);
        const px = x + Math.cos(a) * 1.9 * r;
        const py = y + Math.sin(a) * 1.9 * r;
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 0.12 * r);
        ctx.beginPath();
        ctx.ellipse(px, py, (0.3 + 0.9 * k) * r, (0.15 + 0.4 * k) * r, a + Math.PI / 2, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case "mirror":
        ctx.globalAlpha = 0.25 + 0.6 * k;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 0.1 * r);
        polygonPath(ctx, x, y, (1.8 - 0.5 * k) * r, 6, now / 300);
        ctx.stroke();
        break;
      case "lock": {
        const o = nearestFoe(view, f, fr);
        if (!o) break;
        const ox = fr.x(o) + 1.1 * o.r;
        const oy = fr.y(o) - 1.1 * o.r;
        ctx.globalAlpha = 0.5 + 0.5 * k;
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = Math.max(1.5, 0.12 * o.r);
        ctx.beginPath();
        ctx.moveTo(ox - 0.3 * o.r, oy - 0.3 * o.r);
        ctx.lineTo(ox + 0.3 * o.r, oy + 0.3 * o.r);
        ctx.moveTo(ox + 0.3 * o.r, oy - 0.3 * o.r);
        ctx.lineTo(ox - 0.3 * o.r, oy + 0.3 * o.r);
        ctx.stroke();
        break;
      }
      case "clock": {
        // a radial clock wipe round the caster
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, 2.4 * r, -Math.PI / 2, -Math.PI / 2 + k * TWO_PI);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, 0.06 * r);
        ctx.beginPath();
        for (let q = 0; q < 12; q++) {
          const a = (q * TWO_PI) / 12;
          ctx.moveTo(x + Math.cos(a) * 2.2 * r, y + Math.sin(a) * 2.2 * r);
          ctx.lineTo(x + Math.cos(a) * 2.5 * r, y + Math.sin(a) * 2.5 * r);
        }
        ctx.stroke();
        break;
      }
      case "drops": {
        // where the traps fall: small rings behind the caster
        ctx.globalAlpha = 0.5 * k;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, 0.06 * r);
        const back = Math.atan2(-(f.vy || 0), -(f.vx || 1));
        for (let q = 1; q <= 3; q++) {
          ctx.beginPath();
          ctx.arc(x + Math.cos(back) * 1.4 * q * r, y + Math.sin(back) * 1.4 * q * r, 0.35 * r, 0, TWO_PI);
          ctx.stroke();
        }
        break;
      }
      case "ghostWall": {
        // the wall's ghost outline where it rises (2 R ahead, across the line to the nearest foe)
        const o = nearestFoe(view, f, fr);
        const a = o ? Math.atan2(fr.y(o) - y, fr.x(o) - x) : f.aim;
        const cx = x + Math.cos(a) * FL_WALL_AHEAD * r;
        const cy = y + Math.sin(a) * FL_WALL_AHEAD * r;
        const len = "length" in e && typeof e.length === "number" ? e.length : FL_WALL_LENGTH;
        const half = 0.5 * len * r;
        const px = -Math.sin(a);
        const py = Math.cos(a);
        ctx.globalAlpha = 0.35 + 0.35 * k;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, 0.3 * r);
        ctx.setLineDash([0.35 * r, 0.25 * r]);
        ctx.beginPath();
        ctx.moveTo(cx + px * half, cy + py * half);
        ctx.lineTo(cx - px * half, cy - py * half);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "grow": {
        const size = "size" in e && typeof e.size === "number" ? e.size : 1.4;
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 0.08 * r);
        ctx.setLineDash([0.3 * r, 0.2 * r]);
        ctx.beginPath();
        ctx.arc(x, y, r * (1 + (size - 1) * k), 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "drain": {
        const o = nearestFoe(view, f, fr);
        if (!o) break;
        ctx.globalAlpha = 0.3 + 0.3 * k;
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = Math.max(1, 0.08 * r);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(fr.x(o), fr.y(o));
        ctx.stroke();
        ctx.strokeStyle = FL_HEAL_COLOR;
        ctx.setLineDash([0.3 * r, 0.3 * r]);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "cuts":
        // the cuts' dashed lines are the scheduled tasks' (drawn with them); a glint on the caster
        fr.glow.draw(ctx, color, x, y, 1.6 * r, 0.3 + 0.3 * k);
        break;
      default:
        fr.glow.draw(ctx, color, x, y, 1.8 * r, 0.3 + 0.35 * k);
        break;
    }
    ctx.restore();
  }

  /** The KO finale inside the arena: the speed lines converging on the KO point (0–600 ms) and the spotlight vignette. */
  drawFinale(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const fin = view.finale;
    const field = view.field;
    if (!field || !(fin.from >= 0)) return;
    const ms = fr.now - fin.from;
    const total = fin.until - fin.from;
    if (!(ms >= 0) || ms >= total) return;
    // the spotlight: the rest darkened by 30 % (a cached sprite – its gradient built once)
    const v = this.vignetteSprite();
    const fade = ms < 150 ? ms / 150 : ms > total - 250 ? Math.max(0, (total - ms) / 250) : 1;
    if (v) {
      const R = 1.6 * field.side;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.drawImage(v.canvas, fin.x - R, fin.y - R, 2 * R, 2 * R);
      ctx.restore();
    }
    if (ms < 600) {
      const t = ms / 600;
      ctx.save();
      ctx.globalAlpha = 0.55 * (1 - t);
      ctx.strokeStyle = INK;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1.5, 0.006 * field.side);
      ctx.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TWO_PI + 0.2 * hash(k, 41);
        const r0 = (1.1 - 0.5 * t) * field.side;
        const r1 = r0 - (0.25 + 0.2 * hash(k, 42)) * field.side * (1 - 0.5 * t);
        ctx.moveTo(fin.x + Math.cos(a) * r0, fin.y + Math.sin(a) * r0);
        ctx.lineTo(fin.x + Math.cos(a) * r1, fin.y + Math.sin(a) * r1);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /** The finale's push-in scale at `now` (1 outside it). */
  zoomAt(view: FightLeagueView, now: number): number {
    const fin = view.finale;
    if (!(fin.from >= 0)) return 1;
    return flFinaleZoom(now - fin.from, fin.until - fin.from);
  }

  private vignetteSprite(): Sprite | null {
    if (this.vignette) return this.vignette;
    this.vignette = makeSprite({ x0: -1, y0: -1, x1: 1, y1: 1 }, 256, (g) => {
      const grad = g.createRadialGradient(0, 0, 0.08, 0, 0, 1);
      grad.addColorStop(0, "rgba(11, 11, 15, 0)");
      grad.addColorStop(0.22, "rgba(11, 11, 15, 0)");
      grad.addColorStop(0.55, "rgba(11, 11, 15, 0.3)");
      grad.addColorStop(1, "rgba(11, 11, 15, 0.3)");
      g.fillStyle = grad;
      g.fillRect(-1, -1, 2, 2);
    });
    return this.vignette;
  }

  /** The KO'd fighters' ghosts: flying on along their last velocity with four afterimages (inside the arena's clip). */
  drawKoGhosts(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, bodies: FlBodiesPainter) {
    const n = Math.min(view.eventSerial, FL_EVENT_CAP);
    for (let k = 0; k < n; k++) {
      const e = view.events[k];
      if (e.kind !== EV_KO) continue;
      const age = this.age(fr, view, e.t);
      if (!(age >= 0) || age >= KO_MS) continue;
      const f = view.fighters[e.slot];
      if (!f) continue;
      const t = age / KO_MS;
      const ghosts = fr.lite ? 1 : 5;
      for (let q = ghosts - 1; q >= 0; q--) {
        const s = Math.max(0, age - 45 * q) / 1000;
        const d = s * (1 - s / 2.6);
        const gx = e.x + e.x2 * d;
        const gy = e.y + e.y2 * d;
        bodies.drawBodyAt(ctx, fr, f.row, gx, gy, f.r * (1 - 0.15 * t), fr.px, q === 0 ? 0 : 2, (q === 0 ? 0.75 : 0.22 - 0.04 * q) * (1 - t));
      }
    }
  }

  /** The effects of the event ring, over the rim (numbers, sparks, callouts), on the effects' clock. */
  drawEvents(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, labels: FightLeagueLabels) {
    const field = view.field!;
    const n = Math.min(view.eventSerial, FL_EVENT_CAP);
    const unit = Math.max(6, field.side * 0.065);
    const numbers = view.settings.dmgNumbers !== false;
    const smallFs = Math.max(8, 0.36 * unit);
    // the sparks of the hits: one path a colour
    SPARK_COLORS.length = 0;
    for (let k = 0; k < n; k++) {
      const e = view.events[k];
      if (e.kind !== EV_HIT) continue;
      const age = this.age(fr, view, e.t);
      if (!(age >= 0) || age >= SPARK_MS) continue;
      if (!SPARK_COLORS.includes(e.color)) SPARK_COLORS.push(e.color);
    }
    if (SPARK_COLORS.length > 0) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.9;
      for (const color of SPARK_COLORS) {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 0.07 * unit);
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const e = view.events[k];
          if (e.kind !== EV_HIT || e.color !== color) continue;
          const age = this.age(fr, view, e.t);
          if (!(age >= 0) || age >= SPARK_MS) continue;
          const t = age / SPARK_MS;
          const R = (0.25 + 0.6 * t) * unit * (0.7 + Math.min(0.8, e.value / 20));
          const inner = (0.35 + 0.5 * t) * R;
          const base = Math.atan2(e.y2, e.x2);
          for (let q = 0; q < 8; q++) {
            // sparks fly mostly along the hit (its direction in x2, y2)
            const a = base + ((q - 3.5) / 3.5) * 1.3 + hash(q, e.t) * 0.3;
            ctx.moveTo(e.x + Math.cos(a) * inner, e.y + Math.sin(a) * inner);
            ctx.lineTo(e.x + Math.cos(a) * R, e.y + Math.sin(a) * R);
          }
        }
        ctx.stroke();
      }
      // the white cores of every hit, one path
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const e = view.events[k];
        if (e.kind !== EV_HIT) continue;
        const age = this.age(fr, view, e.t);
        if (!(age >= 0) || age >= SPARK_MS) continue;
        const rr = 0.22 * unit * (1 - age / SPARK_MS);
        ctx.moveTo(e.x + rr, e.y);
        ctx.arc(e.x, e.y, rr, 0, TWO_PI);
      }
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    for (let k = 0; k < n; k++) {
      const e = view.events[k];
      const age = this.age(fr, view, e.t);
      if (!(age >= 0)) continue;
      switch (e.kind) {
        case EV_DAMAGE: {
          if (age >= FL_NUMBER_MS || !numbers) break;
          this.drawNumber(ctx, fr, view, e, k, age, unit);
          // a giant hit's crit burst: an 8-point starburst and a ring at 1.6 ×
          if (e.aux === 1 && age < 260) {
            const t = age / 260;
            const f = view.fighters[e.slot];
            const R = (f ? f.r : unit) * (1 + 0.6 * t) * 1.6;
            ctx.globalAlpha = 1 - t;
            ctx.fillStyle = FL_GIANT_COLOR;
            starPath(ctx, e.x, e.y + (f ? f.r : 0), 0.9 * R, 0.35 * R, 8, hash(k, e.t));
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = Math.max(2, 0.1 * unit);
            ctx.beginPath();
            ctx.arc(e.x, e.y + (f ? f.r : 0), R, 0, TWO_PI);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          break;
        }
        case EV_HEAL: {
          if (age >= HEAL_MS || !numbers) break;
          const t = age / HEAL_MS;
          const fs = Math.max(10, 0.55 * unit);
          const text = HEAL_TEXT[Math.min(HEAL_TEXT.length - 1, Math.max(0, Math.round(e.value)))] ?? `+${Math.round(e.value)}`;
          const y = Math.max(field.cy - field.half + 0.6 * fs, e.y - 0.5 * unit - 0.8 * unit * t);
          fr.text.number(ctx, text, clampX(field, e.x, fs * 1.6), y, fs, FL_HEAL_COLOR, INK, "center", t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3, flNumberPop(age));
          break;
        }
        case EV_BLOCK: {
          if (age >= SPARK_MS * 1.6) break;
          const t = age / (SPARK_MS * 1.6);
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(2, 0.12 * unit);
          polygonPath(ctx, e.x, e.y, (0.25 + 0.5 * t) * unit, 6, 0);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(e.x, e.y, 0.18 * unit * (1 - t), 0, TWO_PI);
          ctx.fill();
          ctx.globalAlpha = 1;
          if (age < CALLOUT_MS) this.callout(ctx, fr, view, "block", labels.blocked, e.x, e.y - 0.7 * unit - 0.3 * unit * t, smallFs, "#fef9c3", 1 - t);
          break;
        }
        case EV_CLASH: {
          if (age < SPARK_MS * 1.4) {
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
            ctx.globalAlpha = 1;
          }
          if (age < CALLOUT_MS) this.callout(ctx, fr, view, "clash", labels.clash, e.x, e.y - 0.8 * unit, smallFs * 1.1, "#ffffff", 1 - age / CALLOUT_MS, age < 90 ? 1.35 - (0.35 * age) / 90 : 1);
          break;
        }
        case EV_GRAZE: {
          if (age >= POP_MS) break;
          const t = age / POP_MS;
          ctx.globalAlpha = 0.6 * (1 - t);
          ctx.strokeStyle = "#94a3b8";
          ctx.lineWidth = Math.max(1, 0.05 * unit);
          ctx.beginPath();
          ctx.arc(e.x, e.y, (0.15 + 0.35 * t) * unit, 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case EV_IMMUNE:
          if (age < CALLOUT_MS) this.callout(ctx, fr, view, "immune", labels.immune, e.x, e.y - 0.6 * unit - 0.4 * unit * (age / CALLOUT_MS), smallFs, GOLD, 1 - age / CALLOUT_MS);
          break;
        case EV_INTERRUPT: {
          if (age >= CALLOUT_MS) break;
          const t = age / CALLOUT_MS;
          const f = view.fighters[e.slot];
          if (f) {
            // the broken telegraph ring
            ctx.globalAlpha = 1 - t;
            ctx.strokeStyle = f.row.accent;
            ctx.lineWidth = Math.max(2, 0.12 * f.r);
            for (let q = 0; q < 4; q++) {
              const a = (q * TWO_PI) / 4 + 0.3;
              ctx.beginPath();
              ctx.arc(fr.x(f), fr.y(f), f.r * (1.6 + 0.8 * t), a, a + 0.9);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
          this.callout(ctx, fr, view, "interrupted", labels.interrupted, e.x, e.y - 0.7 * unit, smallFs, "#f87171", 1 - t);
          break;
        }
        case EV_DODGE:
          if (age < DODGE_MS) this.callout(ctx, fr, view, "dodge", labels.dodge, e.x, e.y - 0.6 * unit - 0.5 * unit * (age / DODGE_MS), 0.85 * smallFs, "#a5f3fc", 1 - age / DODGE_MS);
          break;
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
          ctx.globalAlpha = 1;
          break;
        }
        case EV_SHOCK: {
          if (e.aux === 1) {
            // a burst: a flash disc (80 ms), a shock ring (300 ms), ten debris dots
            if (age < BURST_FLASH_MS) {
              ctx.globalAlpha = 0.85 * (1 - age / BURST_FLASH_MS);
              ctx.fillStyle = "#fff7ed";
              ctx.beginPath();
              ctx.arc(e.x, e.y, Math.max(2, 0.8 * e.value), 0, TWO_PI);
              ctx.fill();
            }
            if (age < BURST_RING_MS) {
              const t = age / BURST_RING_MS;
              ctx.globalAlpha = 0.9 * (1 - t);
              ctx.strokeStyle = e.color;
              ctx.lineWidth = Math.max(2, 0.18 * unit * (1 - t));
              ctx.beginPath();
              ctx.arc(e.x, e.y, Math.max(1, e.value * (0.3 + 0.7 * Math.sqrt(t))), 0, TWO_PI);
              ctx.stroke();
              ctx.fillStyle = INK;
              for (let q = 0; q < 10; q++) {
                const a = (q / 10) * TWO_PI + hash(q, e.t);
                const d = e.value * (0.3 + 0.9 * t) * (0.6 + 0.4 * hash(q + 3, e.t));
                ctx.beginPath();
                ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, Math.max(0.8, 0.07 * unit * (1 - t)), 0, TWO_PI);
                ctx.fill();
              }
            }
            ctx.globalAlpha = 1;
            break;
          }
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
          ctx.globalAlpha = 1;
          break;
        }
        case EV_CUT: {
          if (age >= CUT_MS) break;
          const t = age / CUT_MS;
          if (age < 40) {
            // the cut's 40 ms flash over the arena
            ctx.globalAlpha = 0.35 * (1 - age / 40);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(field.cx - field.half, field.cy - field.half, 2 * field.half, 2 * field.half);
          }
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
          ctx.globalAlpha = 1;
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
          ctx.globalAlpha = 1;
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
            ctx.globalAlpha = 1;
          }
          if (f) {
            // the ability's name rises over the caster (clamped inside the arena: never over the names' band)
            const fs = Math.max(9, 0.36 * unit);
            const pop = t < 0.1 ? 0.7 + 3 * t : 1;
            this.callout(ctx, fr, view, "cast", f.row.ability.name, e.x, e.y - 1.9 * unit - 0.5 * unit * t, fs, withAlpha(f.row.accent, 1), t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25, pop);
          }
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
          ctx.globalAlpha = 1;
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
          ctx.globalAlpha = 1;
          break;
        }
        case EV_SLAM: {
          if (age >= SLAM_MS) break;
          const t = age / SLAM_MS;
          // dust puffs off the wall
          const d = Math.hypot(e.x2, e.y2) || 1;
          const ux = e.x2 / d;
          const uy = e.y2 / d;
          ctx.globalAlpha = 0.45 * (1 - t);
          ctx.fillStyle = "#d6d3d1";
          for (let q = 0; q < 5; q++) {
            const a = Math.atan2(-uy, -ux) + (q - 2) * 0.5;
            const dd = (0.4 + 1.1 * t) * unit;
            ctx.beginPath();
            ctx.arc(e.x + Math.cos(a) * dd, e.y + Math.sin(a) * dd, (0.2 + 0.25 * t) * unit, 0, TWO_PI);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case EV_TRAP: {
          if (age >= TRAP_MS) break;
          const t = age / TRAP_MS;
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = "#ffffff";
          starPath(ctx, e.x, e.y, (0.5 + 0.4 * t) * unit, 0.18 * unit, 6, hash(k, e.t));
          ctx.fill();
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(2, 0.1 * unit);
          ctx.beginPath();
          ctx.arc(e.x, e.y, (0.6 + 0.3 * t) * unit, 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case EV_TRANSFORM: {
          if (age >= 300) break;
          const t = age / 300;
          ctx.globalAlpha = 0.8 * (1 - t);
          if (e.value === 1) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = Math.max(2, 0.15 * unit);
            ctx.beginPath();
            ctx.arc(e.x, e.y, (0.6 + 1.6 * t) * unit, 0, TWO_PI);
            ctx.stroke();
          } else {
            ctx.fillStyle = "#e5e7eb";
            for (let q = 0; q < 5; q++) {
              const a = (q / 5) * TWO_PI;
              ctx.beginPath();
              ctx.arc(e.x + Math.cos(a) * (0.5 + 0.8 * t) * unit, e.y + Math.sin(a) * (0.5 + 0.8 * t) * unit, 0.3 * unit * (1 - t), 0, TWO_PI);
              ctx.fill();
            }
          }
          ctx.globalAlpha = 1;
          break;
        }
        case EV_IMPACT: {
          if (age >= IMPACT_FLASH_MS || view.settings.impact === false) break;
          const t = age / IMPACT_FLASH_MS;
          ctx.globalAlpha = 0.9 * (1 - t);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = Math.max(2, 0.16 * unit * (1 - t));
          ctx.beginPath();
          ctx.arc(e.x, e.y, (0.9 + 0.8 * t) * unit, 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case EV_KO: {
          if (age >= KO_MS) break;
          this.drawKoBlast(ctx, view, e, age);
          break;
        }
        default:
          break;
      }
    }
    ctx.restore();
    this.drawCombos(ctx, fr, view, labels, unit);
  }

  /** A damage number: colour tier, pop and rise, clamped inside the arena (a giant's gold '×N' beside it). */
  private drawNumber(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, e: FlEvent, k: number, age: number, unit: number) {
    const field = view.field!;
    const t = age / FL_NUMBER_MS;
    const big = Math.min(1, e.value / 25);
    const fs = Math.max(10, Math.max(0.6 * unit, (0.028 * field.sqSide) / Math.max(1e-6, field.dk || 1)) * (0.85 + 0.35 * big));
    const text = damageText(e.value);
    const color = e.aux === 1 ? FL_GIANT_COLOR : e.aux === 2 ? FL_REFLECT_COLOR : flDamageColor(e.value);
    const xo = (hash(k, e.t) - 0.5) * 0.6 * unit;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const pop = flNumberPop(age);
    const w = fr.text.numberWidth(text, fs, color, INK) * pop;
    const half = field.half;
    let y = e.y - 0.4 * unit - FL_NUMBER_RISE * unit * t;
    y = Math.max(field.cy - half + 0.6 * fs * pop, Math.min(field.cy + half - 0.6 * fs * pop, y));
    const x = Math.max(field.cx - half + w / 2 + 2, Math.min(field.cx + half - w / 2 - 2, e.x + xo));
    fr.text.number(ctx, text, x, y, fs, color, INK, "center", alpha, pop);
    if (e.aux === 1 && e.x2 >= 1.5) {
      const m = MULT_TEXT[Math.max(0, Math.min(99, Math.round(e.x2)))];
      fr.text.number(ctx, m, Math.min(field.cx + half - 2, x + w / 2 + 0.15 * fs), y - 0.35 * fs, 0.6 * fs, FL_GIANT_COLOR, INK, "left", alpha, pop);
    }
  }

  /** A KO blast: a shock ring and the body's shards flying out (analytic). */
  private drawKoBlast(ctx: CanvasRenderingContext2D, view: FightLeagueView, e: FlEvent, age: number) {
    const f = view.fighters[e.slot];
    const R = f ? f.r : 10;
    const t = age / KO_MS;
    ctx.globalAlpha = 0.7 * (1 - t);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 3 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(e.x, e.y, R * (1 + 4 * t), 0, TWO_PI);
    ctx.stroke();
    const sec = age / 1000;
    for (let s = 0; s < SHARDS; s++) {
      const a = TWO_PI * (s / SHARDS + 0.3 * hash(s, e.slot));
      const speed = R * (3 + 5 * hash(s, e.slot + 7));
      const d = speed * sec * (1 - 0.35 * sec);
      const size = R * (0.16 + 0.22 * hash(s, e.slot + 3)) * (1 - 0.6 * t);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = s % 3 === 0 ? "#ffffff" : e.color;
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d + 40 * sec * sec, size, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** The combo callouts: "N HITS" beside an attacker on a streak (3+ hits on the same foe, each within 1.2 s). */
  private drawCombos(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, labels: FightLeagueLabels, unit: number) {
    for (const f of view.fighters) {
      if (!f.alive || f.comboCount < FL_COMBO_MIN) continue;
      const age = fr.now - f.comboMs;
      if (!(age >= 0) || age > FL_COMBO_MS) continue;
      const alpha = age < 700 ? 1 : 1 - (age - 700) / (FL_COMBO_MS - 700);
      const pop = age < 90 ? 1.35 - (0.35 * age) / 90 : 1;
      this.callout(ctx, fr, view, "combo", labels.combo(f.comboCount), fr.x(f) + 1.6 * f.r, fr.y(f) - 1.4 * f.r, Math.max(9, 0.38 * unit), withAlpha(f.row.accent, 1), alpha, pop);
    }
  }

  /**
   * The ultimates' super flash (screen space, inside the arena's rect): a 35 % veil, a diagonal ribbon in the caster's
   * colours carrying the ability's name, the square's edges tinted – 450 ms from the cast.
   */
  drawSuperFlash(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, ax: number, ay: number, aw: number, ah: number, sx: number, sy: number, side: number) {
    let best: FlFighter | null = null;
    for (const f of view.fighters) {
      const ult = f.row.ability.ultimate || f.row.ability.charge >= 13;
      if (!ult) continue;
      const age = fr.now - f.lastCastMs;
      if (age >= 0 && age < FL_SUPER_FLASH_MS && (!best || f.lastCastMs > best.lastCastMs)) best = f;
    }
    if (!best) return;
    const age = fr.now - best.lastCastMs;
    const t = age / FL_SUPER_FLASH_MS;
    const fade = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ax, ay, aw, ah);
    ctx.clip();
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = INK;
    ctx.fillRect(ax, ay, aw, ah);
    // the ribbon slides across on a diagonal
    const cx = ax + aw / 2 + (0.5 - Math.min(1, t * 2.2)) * 0.5 * aw;
    const cy = ay + ah / 2;
    const bandH = 0.16 * ah;
    ctx.translate(cx, cy);
    ctx.rotate(-0.22);
    ctx.globalAlpha = 0.95 * fade;
    ctx.fillStyle = best.row.body;
    ctx.fillRect(-aw, -bandH / 2, 2 * aw, bandH);
    ctx.fillStyle = best.row.accent;
    ctx.fillRect(-aw, -bandH / 2 - 0.12 * bandH, 2 * aw, 0.12 * bandH);
    ctx.fillRect(-aw, bandH / 2, 2 * aw, 0.12 * bandH);
    const name = fr.text.upperOf(best.row.ability.name);
    fr.text.draw(ctx, name, 0, 0, 0.62 * bandH, { role: "display", color: "#ffffff", stroke: INK, strokeK: 0.12 }, "center", 0.9 * aw, fade);
    ctx.restore();
    // the square's edges tinted in the caster's accent
    ctx.save();
    ctx.globalAlpha = 0.45 * fade;
    ctx.strokeStyle = best.row.accent;
    ctx.lineWidth = 0.02 * side;
    ctx.beginPath();
    ctx.rect(sx + 0.01 * side, sy + 0.01 * side, 0.98 * side, 0.98 * side);
    ctx.stroke();
    ctx.restore();
    this.callouts.add("ultimate");
  }
}

/** The nearest living foe of `f` (where it is drawn), or null. */
function nearestFoe(view: FightLeagueView, f: FlFighter, fr: FlFrame): FlFighter | null {
  let best: FlFighter | null = null;
  let bd = Infinity;
  for (const o of view.fighters) {
    if (!o.alive || o.team === f.team) continue;
    const d = Math.hypot(fr.x(o) - fr.x(f), fr.y(o) - fr.y(f));
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** `x` clamped so a label `w` wide stays inside the arena. */
function clampX(field: { cx: number; half: number }, x: number, w: number): number {
  return Math.max(field.cx - field.half + w / 2 + 2, Math.min(field.cx + field.half - w / 2 - 2, x));
}
