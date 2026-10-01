import type { Ball } from "@/lib/physics/types";
import type { WallContactLog } from "@/lib/physics/wobble";
import { SB_INVULN_MS, SB_BURST_MS, SB_PALETTE, ghostLifeMs, lineThroughRect, sbHudShown, stringBattleBallName, type SbStyle, type StringBattleView } from "@/lib/physics/modes/stringBattle";
import type { TeamEntry } from "@/lib/teams";
import { WobbleLayer } from "./wobbleRenderer";
import { inCaptionColumn } from "@/lib/captions";

/**
 * Canvas drawing of the String Battle (feature odd-string-battle; lib/physics/modes/stringBattle.ts), one
 * `StringBattleLayer` per draw loop, called at fixed points of the frame by Canvas.tsx:
 *
 *  - `drawStage()` (world space, under the balls): the thin ring – in the neon style wobbling like jelly through its own
 *    wobble field with 2–4 coloured outline rings shivering behind it –, the threads (web: glowing segments anchor → ball
 *    in the ball's colour; neon: infinite lines through anchor and ball, drawn additively into a layer that is never
 *    cleared, so they paint moiré art across the whole canvas), the threads leaving the battle (fading, snapping at the
 *    cut, dissolving) and the dashed ring around a ball one cut from elimination;
 *  - `drawBodies()` (world space, the ball pass): soft colour halos (strobing in the finale), the glossy bodies with
 *    their lives (web), the shield blink, the names of a team roster and the glass-like shatter bursts;
 *  - `drawOverlay()` (screen space, inside the square the recorder exports): the "FLASHING LIGHTS – THE END GETS
 *    INTENSE" badge, the WEB DOMINION HUD and – without a team roster (the teams banner takes over with one) – the winner
 *    banner with its confetti;
 *  - `applyGlitch()` (last, device pixels): the neon style's glitch bars – horizontally displaced slices of the frame for
 *    3–6 frames – whenever a life is lost.
 *
 * Visual only: it reads the view and never writes to the engine. The shatter shards fly on the simulation clock from a
 * seed (a recording shows the same burst every time); the confetti and the glitch offsets are decoration. The flashing
 * effects (strobe, glitch, ring flash) are toned down under `prefers-reduced-motion`. Steady-state frames allocate
 * nothing but the few strings of the HUD numbers: colours, sprites and fonts are cached.
 */

export interface StringBattleLabels {
  /** "WEB DOMINION". */
  title: string;
  /** "WEB [n]": the threads alive. */
  web: (n: number) => string;
  badgeTop: string;
  badgeBottom: string;
  /** "[name] WINS". */
  wins: (name: string) => string;
  /** The banner's second line: "[n] kills". */
  kills: (n: number) => string;
  draw: string;
  /** Name of an unnamed roster team: "Team 3". */
  team: (n: number) => string;
}

export const DEFAULT_STRING_BATTLE_LABELS: StringBattleLabels = {
  title: "WEB DOMINION",
  web: (n) => `WEB ${n}`,
  badgeTop: "FLASHING LIGHTS",
  badgeBottom: "THE END GETS INTENSE",
  wins: (name) => `${name} WINS`,
  kills: (n) => `${n} kill${n !== 1 ? "s" : ""}`,
  draw: "DRAW",
  team: (n) => `Team ${n}`,
};

export interface StringBattleRenderOptions {
  /** Device pixel ratio of the canvas. */
  dpr: number;
  /** The team roster (its colours and names play the first balls); empty = the palette. */
  roster: readonly TeamEntry[];
  /** Names above the balls (a roster's "ball names" switch). */
  showNames: boolean;
  wallThickness: number;
  labels: StringBattleLabels;
  /** Simulation time now (ms) and how much of it this frame advanced (0 while paused). */
  nowMs: number;
  simDtMs: number;
  /** The engine's wall contacts (the neon ring's wobble). */
  contacts: WallContactLog | null;
  /** Canvas size in CSS px. */
  width: number;
  height: number;
}

/**
 * --- review fix (modes-boris-odd) --- How the ball characters' faces sit on the fighters (`FaceLayer.drawOverlays()`): in the web
 * style two eyes above the lives the body shows (the compact face of a countdown), in the neon style – no number – the whole face.
 */
const SB_FACE_LAYOUT = { shape: "circle", countdown: true } as const;
export function sbFaceLayout(style: SbStyle): typeof SB_FACE_LAYOUT | null {
  return style === "neon" ? null : SB_FACE_LAYOUT;
}

const TWO_PI = Math.PI * 2;
const GLITCH_MAX_BARS = 6;
const CONFETTI_MAX = 140;
const SHARDS = 18;
const BANNER_DELAY_MS = 250;

function hexRgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** A hash of two integers to [0, 1) (the shards' directions and the glitch bars). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
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

/** The look of one slot: colour, rgba steps, name, text colour on the body. */
interface SlotLook {
  color: string;
  rgb: [number, number, number];
  /** rgba strings at alpha 0, 0.05 … 1. */
  alpha: string[];
  name: string;
  ink: string;
}

export class StringBattleLayer {
  private readonly wobble = new WobbleLayer();
  private looks: SlotLook[] = [];
  private looksKey = "";
  private readonly drawn: (Ball | null)[] = [null, null, null, null, null, null];
  private readonly halo = new Map<string, HTMLCanvasElement>();
  private readonly body = new Map<string, HTMLCanvasElement>();
  private readonly fonts = new Map<number, string>();
  private readonly seg = { x1: 0, y1: 0, x2: 0, y2: 0 };
  // The neon style's paint layer (device pixels), cleared by a new run or a resize.
  private accum: HTMLCanvasElement | null = null;
  private accumCtx: CanvasRenderingContext2D | null = null;
  private accumGeneration = -1;
  // Run bookkeeping.
  private generation = -1;
  private seenLivesLost = 0;
  private glitchFrames = 0;
  private glitchSerial = 0;
  private bannerStarted = false;
  // Confetti (screen space).
  private readonly cx = new Float32Array(CONFETTI_MAX);
  private readonly cy = new Float32Array(CONFETTI_MAX);
  private readonly cvx = new Float32Array(CONFETTI_MAX);
  private readonly cvy = new Float32Array(CONFETTI_MAX);
  private readonly crot = new Float32Array(CONFETTI_MAX);
  private readonly cspin = new Float32Array(CONFETTI_MAX);
  private readonly clife = new Float32Array(CONFETTI_MAX);
  private readonly ccolor = new Uint8Array(CONFETTI_MAX);
  private confetti = 0;
  private reduced = false;
  private motionQuery: MediaQueryList | null = null;
  // Mirrored onto the canvas as data-sb-* for tools and the smoke test.
  /** Glitch bursts started this run, frames that strobed, and what the overlay drew this frame. */
  glitches = 0;
  strobeFrames = 0;
  badgeDrawn = false;
  hudDrawn = false;
  bannerDrawn = false;
  /** --- review fix (modes-boris-odd) --- the warning badge sits in the top-right corner this frame (the teams scoreboard has the left one). */
  badgeRight = false;
  // The last badge / HUD rectangle drawn (screen px): what the top captions keep clear of.
  private badgeX = 0;
  private badgeW = 0;
  private badgeBottom = 0;
  private hudX = 0;
  private hudW = 0;
  private hudBottom = 0;
  /** Lines painted into the neon layer this run. */
  painted = 0;
  /** Walls wobbling this frame (neon). */
  wobbling = 0;

  constructor() {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reduced = this.motionQuery.matches;
      const onChange = (e: MediaQueryListEvent) => {
        this.reduced = e.matches;
      };
      this.motionQuery.addEventListener?.("change", onChange);
    }
  }

  /** True while flashing effects are toned down (prefers-reduced-motion). */
  get reducedMotion() {
    return this.reduced;
  }

  /* ------------------------------------------------------------------ looks */

  private refreshLooks(view: StringBattleView, o: StringBattleRenderOptions) {
    let key = `${view.count}|`;
    for (let i = 0; i < Math.min(o.roster.length, view.count); i++) key += `${o.roster[i].color}:${o.roster[i].name};`;
    if (key === this.looksKey) return;
    this.looksKey = key;
    const looks: SlotLook[] = [];
    for (let i = 0; i < view.count; i++) {
      const team = i < o.roster.length ? o.roster[i] : null;
      const color = team ? team.color : SB_PALETTE[i % SB_PALETTE.length].color;
      const rgb = hexRgb(color);
      const alpha: string[] = [];
      for (let k = 0; k <= 20; k++) alpha.push(`rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(k / 20).toFixed(2)})`);
      const name = team ? team.name || o.labels.team(i + 1) : stringBattleBallName(i);
      looks.push({ color, rgb, alpha, name, ink: luminance(rgb) > 0.35 ? "#0b0b0f" : "#ffffff" });
    }
    this.looks = looks;
  }

  /** The colour a slot is drawn in (the roster's or the palette's). */
  colorOf(slot: number): string {
    return this.looks[slot]?.color ?? "#ffffff";
  }

  /** The name a slot goes by (the roster's or the palette's). */
  nameOf(slot: number): string {
    return this.looks[slot]?.name ?? stringBattleBallName(slot);
  }

  private rgba(slot: number, a: number): string {
    const look = this.looks[slot];
    if (!look) return `rgba(255, 255, 255, ${a})`;
    return look.alpha[Math.max(0, Math.min(20, Math.round(a * 20)))];
  }

  private font(px: number, weight = 800): string {
    const size = Math.max(6, Math.round(px));
    const key = size * 1000 + weight;
    let f = this.fonts.get(key);
    if (!f) {
      f = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      this.fonts.set(key, f);
    }
    return f;
  }

  private haloSprite(color: string): HTMLCanvasElement {
    let s = this.halo.get(color);
    if (!s) {
      s = document.createElement("canvas");
      s.width = 128;
      s.height = 128;
      const g = s.getContext("2d");
      if (g) {
        const [r, gg, b] = hexRgb(color);
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, `rgba(${r}, ${gg}, ${b}, 0.55)`);
        grad.addColorStop(0.35, `rgba(${r}, ${gg}, ${b}, 0.22)`);
        grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
      }
      if (this.halo.size > 32) this.halo.clear();
      this.halo.set(color, s);
    }
    return s;
  }

  private bodySprite(color: string, neon: boolean): HTMLCanvasElement {
    const key = `${color}|${neon ? 1 : 0}`;
    let s = this.body.get(key);
    if (!s) {
      s = document.createElement("canvas");
      s.width = 96;
      s.height = 96;
      const g = s.getContext("2d");
      if (g) {
        const [r, gg, b] = hexRgb(color);
        const grad = g.createRadialGradient(36, 34, 4, 48, 48, 48);
        if (neon) {
          grad.addColorStop(0, "rgba(255, 255, 255, 1)");
          grad.addColorStop(0.45, `rgba(${Math.min(255, r + 90)}, ${Math.min(255, gg + 90)}, ${Math.min(255, b + 90)}, 1)`);
          grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 1)`);
        } else {
          grad.addColorStop(0, `rgba(${Math.min(255, r + 70)}, ${Math.min(255, gg + 70)}, ${Math.min(255, b + 70)}, 1)`);
          grad.addColorStop(0.7, `rgba(${r}, ${gg}, ${b}, 1)`);
          grad.addColorStop(1, `rgba(${Math.round(r * 0.7)}, ${Math.round(gg * 0.7)}, ${Math.round(b * 0.7)}, 1)`);
        }
        g.fillStyle = grad;
        g.beginPath();
        g.arc(48, 48, 47, 0, TWO_PI);
        g.fill();
      }
      if (this.body.size > 32) this.body.clear();
      this.body.set(key, s);
    }
    return s;
  }

  /* ------------------------------------------------------------------ frame */

  private beginFrame(view: StringBattleView, balls: readonly Ball[], o: StringBattleRenderOptions) {
    this.refreshLooks(view, o);
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.seenLivesLost = view.livesLost;
      this.glitchFrames = 0;
      this.glitches = 0;
      this.strobeFrames = 0;
      this.painted = 0;
      this.bannerStarted = false;
      this.confetti = 0;
    }
    // The ball each slot is drawn at (the camera's slow motion may hand over balls between two steps).
    for (let i = 0; i < this.drawn.length; i++) this.drawn[i] = null;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const t = b.team;
      if (t === undefined || t < 0 || t >= view.fighters.length) continue;
      const f = view.fighters[t];
      if (f.alive && f.id === b.id) this.drawn[t] = b;
    }
    // A lost life starts a glitch (3–6 frames) in the neon style.
    if (view.livesLost > this.seenLivesLost) {
      this.seenLivesLost = view.livesLost;
      if (view.settings.style === "neon" && !this.reduced) {
        this.glitchSerial++;
        this.glitches++;
        this.glitchFrames = 3 + Math.floor(4 * hash01(this.glitchSerial, view.generation));
      }
    } else if (view.livesLost < this.seenLivesLost) this.seenLivesLost = view.livesLost;
  }

  /** The drawn position of slot `slot`'s ball (null once it is gone). */
  private at(slot: number): Ball | null {
    return this.drawn[slot] ?? null;
  }

  private shielded(view: StringBattleView, slot: number, nowMs: number): boolean {
    const f = view.fighters[slot];
    return !!f && f.alive && nowMs - f.hurtMs < SB_INVULN_MS[view.settings.rule];
  }

  /** World space, before the balls: ring, threads and the threads leaving. */
  drawStage(ctx: CanvasRenderingContext2D, view: StringBattleView, balls: readonly Ball[], o: StringBattleRenderOptions) {
    this.beginFrame(view, balls, o);
    const neon = view.settings.style === "neon";
    const now = o.nowMs;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.lineCap = "round";
    if (neon) this.paintNeon(ctx, view, o);
    this.drawRing(ctx, view, o);
    this.drawGhosts(ctx, view, now, neon);
    // The live threads.
    for (const f of view.fighters) {
      if (!f.alive || f.strings.length === 0) continue;
      const B = this.at(f.slot);
      if (!B) continue;
      const shield = this.shielded(view, f.slot, now);
      const flicker = shield ? (this.reduced ? 0.45 : 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(now * 0.04))) : 1;
      if (neon) {
        ctx.globalCompositeOperation = "lighter";
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = this.rgba(f.slot, 0.4 * flicker);
        ctx.beginPath();
        for (const s of f.strings) {
          if (!lineThroughRect(s.ax, s.ay, B.x, B.y, -20, -20, o.width + 20, o.height + 20, this.seg)) continue;
          ctx.moveTo(this.seg.x1, this.seg.y1);
          ctx.lineTo(this.seg.x2, this.seg.y2);
        }
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      } else {
        // The whole thread cuts and burns (SB_CUT_SPAN), so all of it glows – up to its ball, whose body hides the stub
        // next to it that is spared.
        ctx.beginPath();
        for (const s of f.strings) {
          ctx.moveTo(s.ax, s.ay);
          ctx.lineTo(B.x, B.y);
        }
        ctx.strokeStyle = this.rgba(f.slot, 0.22 * flicker);
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = this.rgba(f.slot, 0.95 * flicker);
        ctx.lineWidth = 1.8;
        ctx.stroke();
        // The anchors: small bright knots on the ring.
        ctx.fillStyle = this.rgba(f.slot, 0.95 * flicker);
        ctx.beginPath();
        for (const s of f.strings) {
          ctx.moveTo(s.ax + 2.2, s.ay);
          ctx.arc(s.ax, s.ay, 2.2, 0, TWO_PI);
        }
        ctx.fill();
      }
    }
    // One cut from elimination: a dashed ring turning around the ball (with the HUD).
    if (sbHudShown(view.settings) && !view.finished) {
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 2;
      for (const f of view.fighters) {
        if (!f.alive || f.lives !== 1) continue;
        const B = this.at(f.slot);
        if (!B) continue;
        ctx.lineDashOffset = this.reduced ? 0 : -now * 0.03;
        ctx.strokeStyle = this.rgba(f.slot, 0.9);
        ctx.beginPath();
        ctx.arc(B.x, B.y, B.radius + 7, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    ctx.restore();
  }

  /** The neon style's paint layer: every thread's infinite line added in, never cleared (the moiré), then the layer itself. */
  private paintNeon(ctx: CanvasRenderingContext2D, view: StringBattleView, o: StringBattleRenderOptions) {
    const w = Math.max(1, Math.round(o.width * o.dpr));
    const h = Math.max(1, Math.round(o.height * o.dpr));
    if (!this.accum || this.accum.width !== w || this.accum.height !== h || this.accumGeneration !== view.generation) {
      if (!this.accum) this.accum = document.createElement("canvas");
      this.accum.width = w;
      this.accum.height = h;
      this.accumCtx = this.accum.getContext("2d");
      this.accumGeneration = view.generation;
      this.painted = 0;
    }
    const a = this.accumCtx;
    if (!a) return;
    if (o.simDtMs > 0 && !view.finished) {
      // Alpha per frame scaled by the simulation time it covers, so the art builds at the same pace at any frame rate.
      const alpha = Math.min(0.25, 0.018 * (o.simDtMs / (1000 / 60)));
      a.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
      a.globalCompositeOperation = "lighter";
      a.lineWidth = 1;
      for (const f of view.fighters) {
        if (!f.alive || f.strings.length === 0) continue;
        const B = this.at(f.slot);
        if (!B) continue;
        a.strokeStyle = this.rgba(f.slot, alpha);
        a.beginPath();
        for (const s of f.strings) {
          if (!lineThroughRect(s.ax, s.ay, B.x, B.y, 0, 0, o.width, o.height, this.seg)) continue;
          a.moveTo(this.seg.x1, this.seg.y1);
          a.lineTo(this.seg.x2, this.seg.y2);
          this.painted++;
        }
        a.stroke();
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(this.accum, 0, 0, o.width, o.height);
    ctx.restore();
  }

  private drawRing(ctx: CanvasRenderingContext2D, view: StringBattleView, o: StringBattleRenderOptions) {
    const now = o.nowMs;
    const neon = view.settings.style === "neon";
    const { cx, cy, radius: R } = view;
    this.wobble.beginFrame(o.contacts, now, neon ? view.settings.wobble : 0);
    this.wobbling = 0;
    // The finish: the ring flashes white (twice; once, softly, with reduced motion).
    const since = view.finished ? now - view.finishedMs : Infinity;
    const flash = since < 1200 ? (this.reduced ? 0.5 * (1 - since / 1200) : Math.max(0, 1 - since / 1200) * (0.6 + 0.4 * Math.cos(since * 0.012))) : 0;
    // The finale: the ring breathes brighter with the strobe.
    const pulse = view.finale && !view.finished && !this.reduced ? 0.5 + 0.5 * Math.sin(now * 0.045) : 0;
    if (neon) {
      // 2–4 outline rings shivering behind the ring in the balls' colours.
      const rings = Math.min(4, Math.max(2, view.count - 1));
      for (let k = 1; k <= rings; k++) {
        const slot = (k - 1) % Math.max(1, view.count);
        const shiver = this.reduced ? 0 : 1.6 * Math.sin(now * 0.021 + k * 1.7);
        const r = R + 5 * k + shiver;
        ctx.strokeStyle = this.rgba(slot, Math.max(0.08, 0.34 - 0.06 * k) + 0.15 * pulse);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        if (!this.wobble.traceArc(ctx, 0, cx, cy, r, 0, TWO_PI, false, R * (1 + 0.35 * k))) ctx.arc(cx, cy, r, 0, TWO_PI);
        else this.wobbling = 1;
        ctx.closePath();
        ctx.stroke();
      }
    }
    const base = neon ? 0.75 : 0.6;
    ctx.strokeStyle = `rgba(200, 200, 205, ${Math.min(1, base + 0.3 * pulse + flash).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.5, 0.8 * o.wallThickness) + 5 * flash;
    if (flash > 0.02 || pulse > 0.02) {
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 24 * Math.max(flash, 0.5 * pulse);
    }
    ctx.beginPath();
    this.wobble.traceCircle(ctx, 0, cx, cy, R);
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (this.wobble.active(0)) this.wobbling = 1;
  }

  private drawGhosts(ctx: CanvasRenderingContext2D, view: StringBattleView, now: number, neon: boolean) {
    for (let i = 0; i < view.ghostCount; i++) {
      const g = view.ghosts[i];
      const age = now - g.t0;
      const life = ghostLifeMs(g.kind);
      if (age < 0 || age >= life) continue;
      const t = age / life;
      if (g.kind === "snap") {
        // Both halves recoil from the cut: the anchor half toward the ring, the ball half toward the ball; a flash at the cut.
        const k = 1 - t;
        ctx.strokeStyle = this.rgba(g.slot, 0.9 * k);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(g.ax, g.ay);
        ctx.lineTo(g.ax + (g.qx - g.ax) * k * k, g.ay + (g.qy - g.ay) * k * k);
        ctx.moveTo(g.bx, g.by);
        ctx.lineTo(g.bx + (g.qx - g.bx) * k * k, g.by + (g.qy - g.by) * k * k);
        ctx.stroke();
        if (t < 0.45) {
          const f = 1 - t / 0.45;
          ctx.fillStyle = `rgba(255, 255, 255, ${(0.9 * f).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(g.qx, g.qy, 2 + 9 * (1 - f), 0, TWO_PI);
          ctx.fill();
        }
      } else if (!neon || g.kind === "dissolve") {
        const a = g.kind === "fade" ? 0.7 * (1 - t) : 0.8 * (1 - t) * (1 - t);
        ctx.strokeStyle = this.rgba(g.slot, a);
        ctx.lineWidth = g.kind === "dissolve" ? 1 + 2 * t : 1.2;
        if (g.kind === "dissolve") ctx.setLineDash([2 + 6 * t, 3 + 9 * t]);
        ctx.beginPath();
        ctx.moveTo(g.ax, g.ay);
        ctx.lineTo(g.bx, g.by);
        ctx.stroke();
        if (g.kind === "dissolve") ctx.setLineDash([]);
      }
    }
  }

  /** World space, the ball pass: halos, bodies, lives, names and the shatter bursts. */
  drawBodies(ctx: CanvasRenderingContext2D, view: StringBattleView, o: StringBattleRenderOptions) {
    const now = o.nowMs;
    const neon = view.settings.style === "neon";
    const strobe = view.finale && !view.finished && !this.reduced;
    if (strobe && o.simDtMs > 0) this.strobeFrames++;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of view.fighters) {
      if (!f.alive) continue;
      const B = this.at(f.slot);
      if (!B) continue;
      const look = this.looks[f.slot];
      if (!look) continue;
      const r = B.radius;
      // Halo: a soft glow in the ball's colour; in the finale it strobes (a steadier glow with reduced motion).
      let haloA = neon ? 1 : 0.85;
      let haloR = 3.1 * r;
      if (strobe) {
        const on = Math.sin(now * 0.075 + f.slot * 1.3) > 0;
        haloA = on ? 1 : 0.25;
        haloR *= on ? 1.35 : 1;
      } else if (view.finale && this.reduced) haloR *= 1.15;
      ctx.globalAlpha = haloA;
      ctx.drawImage(this.haloSprite(look.color), B.x - haloR, B.y - haloR, 2 * haloR, 2 * haloR);
      // Body (blinking while shielded).
      const shield = this.shielded(view, f.slot, now);
      ctx.globalAlpha = shield ? (this.reduced ? 0.55 : Math.sin(now * 0.05) > 0 ? 1 : 0.35) : 1;
      ctx.drawImage(this.bodySprite(look.color, neon), B.x - r, B.y - r, 2 * r, 2 * r);
      if (!neon) {
        // The lives on the ball.
        ctx.font = this.font(1.15 * r, 900);
        ctx.fillStyle = look.ink;
        ctx.fillText(String(f.lives), B.x, B.y + 0.06 * r);
      }
      ctx.globalAlpha = 1;
      if (o.showNames && o.roster.length > 0) {
        const fs = Math.max(9, 0.75 * r);
        ctx.font = this.font(fs, 800);
        ctx.lineWidth = Math.max(2, 0.22 * fs);
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
        ctx.strokeText(look.name, B.x, B.y - r - 0.8 * fs);
        ctx.fillStyle = look.color;
        ctx.fillText(look.name, B.x, B.y - r - 0.8 * fs);
      }
    }
    // Shatter bursts: glass shards flying out from where the ball was, and a white flash.
    for (const burst of view.bursts) {
      const age = now - burst.t0;
      if (age < 0 || age >= SB_BURST_MS) continue;
      const t = age / SB_BURST_MS;
      const sec = age / 1000;
      if (age < 180) {
        const k = 1 - age / 180;
        ctx.globalAlpha = (this.reduced ? 0.4 : 0.85) * k;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(burst.x, burst.y, burst.radius * (1 + 2.5 * (1 - k)), 0, TWO_PI);
        ctx.fill();
      }
      ctx.globalAlpha = Math.max(0, 1 - t);
      for (let k = 0; k < SHARDS; k++) {
        const u = hash01(burst.seed, k);
        const w = hash01(burst.seed, k + 101);
        const angle = TWO_PI * u;
        const speed = burst.radius * (5 + 9 * w);
        const d = speed * sec * (1 - 0.45 * t);
        const x = burst.x + Math.cos(angle) * d;
        const y = burst.y + Math.sin(angle) * d + 60 * sec * sec;
        const size = burst.radius * (0.25 + 0.45 * hash01(burst.seed, k + 202));
        const rot = angle + sec * (4 + 8 * w);
        ctx.fillStyle = k % 3 === 0 ? "rgba(255, 255, 255, 0.9)" : this.rgba(burst.slot, 0.9);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(rot) * size, y + Math.sin(rot) * size);
        ctx.lineTo(x + Math.cos(rot + 2.4) * size * 0.6, y + Math.sin(rot + 2.4) * size * 0.6);
        ctx.lineTo(x + Math.cos(rot + 4.1) * size * 0.8, y + Math.sin(rot + 4.1) * size * 0.8);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ screen space */

  /**
   * Screen space, inside the square the recorder exports: the warning badge (top left), the HUD (top right; the web
   * style) and, without a team roster, the winner banner and its confetti. `inset` moves the corner items below the
   * page's overlay buttons; `dtMs` advances the confetti (0 while paused); `teamBanner` – a roster is on and the teams
   * banner announces the winner – leaves the banner to it; `badgeRight` – the teams scoreboard takes the top-left corner (the HUD
   * is off then) – moves the badge to the top-right one. Returns the screen y of the lowest top item that reaches into the
   * captions' centred column (0: none), which the top captions start below.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: StringBattleView, o: StringBattleRenderOptions, frame: { inset: number; dtMs: number; teamBanner: boolean; badgeRight?: boolean }): number {
    const side = Math.min(o.width, o.height);
    const sx = (o.width - side) / 2;
    const sy = (o.height - side) / 2;
    const margin = Math.max(6, 0.018 * side);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    this.badgeDrawn = view.settings.badge;
    this.badgeRight = !!frame.badgeRight;
    if (view.settings.badge) this.drawBadge(ctx, this.badgeRight ? sx + side - margin : sx + margin, sy + frame.inset + margin, side, o.labels, this.badgeRight);
    this.hudDrawn = sbHudShown(view.settings);
    if (this.hudDrawn) this.drawHud(ctx, view, sx + side - margin, sy + frame.inset + margin, side, o.labels);
    // --- review fix (modes-boris-odd) --- the corner items the top captions have to start below
    let topBottom = 0;
    if (this.badgeDrawn && inCaptionColumn(this.badgeX, this.badgeW, sx + side / 2, side)) topBottom = this.badgeBottom;
    if (this.hudDrawn && inCaptionColumn(this.hudX, this.hudW, sx + side / 2, side)) topBottom = Math.max(topBottom, this.hudBottom);
    this.bannerDrawn = false;
    if (view.finished && !frame.teamBanner && o.nowMs - view.finishedMs >= BANNER_DELAY_MS) {
      if (!this.bannerStarted) {
        this.bannerStarted = true;
        if (view.winner >= 0) this.spawnConfetti(sx, sy, side, view.winner);
      }
      this.drawBanner(ctx, view, sx + side / 2, sy + side * 0.5, side, o);
      this.bannerDrawn = true;
    }
    this.stepConfetti(ctx, frame.dtMs / 1000, side);
    ctx.restore();
    return topBottom;
  }

  /** The warning badge with its top-left corner at (x, y) – or, `right`, its top-right corner. */
  private drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, L: StringBattleLabels, right = false) {
    const fs = Math.max(7, 0.016 * side);
    const small = 0.78 * fs;
    ctx.font = this.font(fs, 900);
    const w1 = ctx.measureText(L.badgeTop).width;
    ctx.font = this.font(small, 700);
    const w2 = ctx.measureText(L.badgeBottom).width;
    const icon = 1.9 * fs;
    const pad = 0.55 * fs;
    const w = pad * 3 + icon + Math.max(w1, w2);
    const h = pad * 2 + fs + 1.15 * small;
    if (right) x -= w;
    this.badgeX = x;
    this.badgeW = w;
    this.badgeBottom = y + h;
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    roundRect(ctx, x, y, w, h, 0.35 * fs);
    ctx.fill();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.85)";
    ctx.lineWidth = Math.max(1, 0.09 * fs);
    ctx.stroke();
    // The warning triangle.
    const tx = x + pad;
    const ty = y + (h - icon) / 2;
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(tx + icon / 2, ty);
    ctx.lineTo(tx + icon, ty + icon * 0.9);
    ctx.lineTo(tx, ty + icon * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0b0b0f";
    ctx.font = this.font(0.8 * icon, 900);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", tx + icon / 2, ty + icon * 0.58);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#facc15";
    ctx.font = this.font(fs, 900);
    ctx.fillText(L.badgeTop, tx + icon + pad, y + pad);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.font = this.font(small, 700);
    ctx.fillText(L.badgeBottom, tx + icon + pad, y + pad + 1.1 * fs);
  }

  private drawHud(ctx: CanvasRenderingContext2D, view: StringBattleView, right: number, top: number, side: number, L: StringBattleLabels) {
    const fs = Math.max(8, 0.018 * side);
    const rowH = 1.4 * fs;
    const pad = 0.55 * fs;
    const pip = 0.26 * fs;
    ctx.font = this.font(fs, 800);
    let nameW = 0;
    for (let i = 0; i < view.count; i++) nameW = Math.max(nameW, ctx.measureText(this.nameOf(i)).width);
    nameW = Math.min(nameW, 6.5 * fs);
    const countW = ctx.measureText("x00").width;
    const titleFs = 1.05 * fs;
    ctx.font = this.font(titleFs, 900);
    const titleW = ctx.measureText(L.title).width;
    const rowW = 1.1 * fs + nameW + 0.6 * fs + 3 * 2.8 * pip + 0.5 * fs + countW;
    const w = pad * 2 + Math.max(rowW, titleW);
    const h = pad * 2 + 1.5 * titleFs + view.count * rowH + 1.4 * fs;
    const x = right - w;
    this.hudX = x;
    this.hudW = w;
    this.hudBottom = top + h;
    ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    roundRect(ctx, x, top, w, h, 0.45 * fs);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = this.font(titleFs, 900);
    ctx.fillText(L.title, x + pad, top + pad + 0.6 * titleFs);
    let y = top + pad + 1.5 * titleFs + rowH / 2;
    for (let i = 0; i < view.count; i++) {
      const f = view.fighters[i];
      const look = this.looks[i];
      if (!f || !look) continue;
      const alive = f.alive;
      ctx.globalAlpha = alive ? 1 : 0.38;
      let cx = x + pad + 0.4 * fs;
      ctx.fillStyle = look.color;
      ctx.beginPath();
      ctx.arc(cx, y, 0.4 * fs, 0, TWO_PI);
      ctx.fill();
      cx += 0.7 * fs;
      ctx.font = this.font(fs, 800);
      ctx.fillStyle = alive ? "#f4f4f5" : "#a1a1aa";
      const name = look.name;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, y - rowH / 2, nameW, rowH);
      ctx.clip();
      ctx.fillText(name, cx, y);
      ctx.restore();
      if (!alive) {
        ctx.strokeStyle = "#a1a1aa";
        ctx.lineWidth = Math.max(1, 0.08 * fs);
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(cx + Math.min(nameW, ctx.measureText(name).width), y);
        ctx.stroke();
      }
      cx += nameW + 0.6 * fs + pip;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(cx, y, pip, 0, TWO_PI);
        if (f.kills > k) {
          ctx.fillStyle = look.color;
          ctx.fill();
        } else {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
          ctx.lineWidth = Math.max(1, 0.07 * fs);
          ctx.stroke();
        }
        cx += 2.8 * pip;
      }
      ctx.textAlign = "right";
      ctx.fillStyle = f.kills > 0 ? "#ffffff" : "rgba(255, 255, 255, 0.55)";
      ctx.fillText(`x${f.kills}`, x + w - pad, y);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
      y += rowH;
    }
    ctx.font = this.font(0.9 * fs, 800);
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillText(L.web(view.liveStrings), x + pad, y - rowH / 2 + 0.95 * fs);
  }

  private drawBanner(ctx: CanvasRenderingContext2D, view: StringBattleView, cx: number, cy: number, side: number, o: StringBattleRenderOptions) {
    const L = o.labels;
    // Pops in over 280 ms (a small overshoot), then holds.
    const k = Math.min(1, Math.max(0, o.nowMs - view.finishedMs - BANNER_DELAY_MS) / 280);
    const pop = k >= 1 ? 1 : 0.6 + 0.4 * k + 0.15 * Math.sin(k * Math.PI);
    const winner = view.winner;
    const title = winner >= 0 ? `🏆 ${L.wins(this.nameOf(winner))}` : L.draw;
    const color = winner >= 0 ? this.colorOf(winner) : "#ffffff";
    const sub = winner >= 0 ? L.kills(view.fighters[winner]?.kills ?? 0) : "";
    let fs = Math.max(20, 0.075 * side);
    ctx.font = this.font(fs, 900);
    const tw = ctx.measureText(title).width;
    if (tw > 0.86 * side) fs *= (0.86 * side) / tw;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = this.font(fs, 900);
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, 0.14 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(title, 0, 0);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillText(title, 0, 0);
    ctx.shadowBlur = 0;
    if (sub) {
      const sfs = 0.42 * fs;
      ctx.font = this.font(sfs, 700);
      ctx.lineWidth = Math.max(2, 0.16 * sfs);
      ctx.strokeText(sub, 0, 0.95 * fs);
      ctx.fillStyle = "#e4e4e7";
      ctx.fillText(sub, 0, 0.95 * fs);
    }
    ctx.restore();
  }

  private spawnConfetti(sx: number, sy: number, side: number, winner: number) {
    const n = this.reduced ? 40 : CONFETTI_MAX;
    for (let i = 0; i < n; i++) {
      this.cx[i] = sx + side * (0.2 + 0.6 * Math.random());
      this.cy[i] = sy + side * (0.42 + 0.1 * Math.random());
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = side * (0.5 + 0.9 * Math.random());
      this.cvx[i] = Math.cos(a) * v;
      this.cvy[i] = Math.sin(a) * v;
      this.crot[i] = Math.random() * TWO_PI;
      this.cspin[i] = (Math.random() - 0.5) * 14;
      this.clife[i] = 1.8 + 1.2 * Math.random();
      this.ccolor[i] = i % 3 === 0 ? 255 : Math.random() < 0.6 ? winner : Math.floor(Math.random() * Math.max(1, this.looks.length));
    }
    this.confetti = n;
  }

  private stepConfetti(ctx: CanvasRenderingContext2D, dt: number, side: number) {
    if (this.confetti === 0) return;
    const g = 1.4 * side;
    const s = Math.max(3, 0.011 * side);
    let live = 0;
    for (let i = 0; i < this.confetti; i++) {
      if (this.clife[i] <= 0) continue;
      this.clife[i] -= dt;
      this.cvy[i] += g * dt;
      this.cvx[i] *= 1 - 0.8 * dt;
      this.cx[i] += this.cvx[i] * dt;
      this.cy[i] += this.cvy[i] * dt;
      this.crot[i] += this.cspin[i] * dt;
      if (this.clife[i] <= 0) continue;
      live++;
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.clife[i]);
      ctx.translate(this.cx[i], this.cy[i]);
      ctx.rotate(this.crot[i]);
      ctx.fillStyle = this.ccolor[i] === 255 ? "#ffffff" : this.colorOf(this.ccolor[i]);
      ctx.fillRect(-s / 2, -s / 4, s, s / 2);
      ctx.restore();
    }
    if (live === 0) this.confetti = 0;
  }

  /**
   * Last, over the finished frame (device pixels): the neon style's glitch bars – 2–6 horizontal slices of the frame
   * shifted sideways – for the 3–6 frames after a lost life. Nothing otherwise (or with reduced motion).
   */
  applyGlitch(ctx: CanvasRenderingContext2D) {
    if (this.glitchFrames <= 0) return;
    this.glitchFrames--;
    const canvas = ctx.canvas;
    const W = canvas.width;
    const H = canvas.height;
    if (!(W > 0 && H > 0)) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const bars = 2 + Math.floor(5 * hash01(this.glitchSerial * 31 + this.glitchFrames, 7));
    for (let i = 0; i < Math.min(GLITCH_MAX_BARS, bars); i++) {
      const u = hash01(this.glitchSerial * 131 + this.glitchFrames * 17, i);
      const v = hash01(this.glitchSerial * 71 + i, this.glitchFrames + 3);
      const h = Math.max(2, Math.round(H * (0.012 + 0.05 * v)));
      const y = Math.round((H - h) * u);
      const dx = Math.round(W * (0.02 + 0.06 * hash01(i + 5, this.glitchSerial + this.glitchFrames)) * (v < 0.5 ? -1 : 1));
      ctx.drawImage(canvas, 0, y, W, h, dx, y, W, h);
      if (i === 0) {
        ctx.fillStyle = "rgba(255, 45, 149, 0.12)";
        ctx.fillRect(0, y, W, h);
      }
    }
    ctx.restore();
  }
}
