import type { Ball } from "@/lib/physics/types";
import { SB_BURST_MS, SB_INVULN_MS, ghostLifeMs, type StringBattleView } from "@/lib/physics/modes/stringBattle";
import { SC_RIM_BINS, circleLineup, coverageText, fanText, rimAt, wallOverlap, type ScLook } from "@/lib/physics/modes/stringCircle";
import type { TeamEntry } from "@/lib/teams";
import { flagGlyphsSupported } from "./landClaimRenderer";

/**
 * --- string-circle --- Canvas drawing of the String Battle's circle style (lib/physics/modes/stringCircle.ts), one
 * `StringCircleLayer` per draw loop, called by Canvas.tsx at the points where the web and neon styles call the battle's own
 * layer:
 *
 *  - `drawStage()` (world space, under the balls): the thin white wall – a circle or the inscribed hexagon, flashing in the
 *    winner's colour at the end –, the strings leaving the battle (snapped at the cut, fading, dissolving with their ball),
 *    every fan batched into one path per team (one stroke per team however many strings: thousands hold the frame rate)
 *    and, just outside the wall, the rim arcs – the bins of the rim each fan holds, the live score;
 *  - `drawBodies()` (world space, the ball pass): a glow in the team colour, the flag inside a ring of the ball's lives (the
 *    current life drains as its strings are cut; the flag's two-letter code on a disc where the fonts have no flag glyphs –
 *    `flagGlyphsSupported()`, measured once), the shield's blink, the roster's names and the shatter bursts;
 *  - `drawOverlay()` (screen space, the square the recorder exports): the title line at the top ("STRING CIRCLE", or the
 *    settings' own), the standings strip at the bottom (the HUD switch: every team's flag and share of the rim, the leader
 *    first) and – without a roster to crown the winner (the teams banner does it with one) – the winner banner with confetti.
 *
 * Visual only: it reads the view and never writes to the engine. The bursts fly on the simulation clock from a seed; the
 * confetti is decoration. Steady-state frames allocate nothing but the strip's few strings: looks, sprites and fonts are cached.
 */

export interface StringCircleLabels {
  /** The title line when the settings have none: "STRING CIRCLE". */
  title: string;
  /** "[name] WINS". */
  wins: (name: string) => string;
  /** The banner's second line and the strip: "[pct]% OF THE RIM". */
  rim: (pct: number) => string;
  draw: string;
  /** The strip past its chips: "+[n]". */
  more: (n: number) => string;
  /** Name of an unnamed roster team: "Team 3". */
  team: (n: number) => string;
}

export const DEFAULT_STRING_CIRCLE_LABELS: StringCircleLabels = {
  title: "STRING CIRCLE",
  wins: (name) => `${name} WINS`,
  rim: (pct) => `${pct}% OF THE RIM`,
  draw: "DRAW",
  more: (n) => `+${n}`,
  team: (n) => `Team ${n}`,
};

export interface StringCircleRenderOptions {
  /** Device pixel ratio of the canvas. */
  dpr: number;
  /** The team roster (its names, colours and flags play the first balls); empty = the line-up of countries. */
  roster: readonly TeamEntry[];
  /** Names above the balls (a roster's "ball names" switch). */
  showNames: boolean;
  wallThickness: number;
  labels: StringCircleLabels;
  /** Simulation time now (ms). */
  nowMs: number;
  /** Canvas size in CSS px. */
  width: number;
  height: number;
}

/** What a ball's badge is: a flag glyph, its code on a disc (no flag glyphs), another emoji, or a plain disc. */
export type ScBadgeKind = "f" | "c" | "e" | "d";

const TWO_PI = Math.PI * 2;
const EMOJI_FONT = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif`;
const TEXT_FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
const SPRITE_CACHE_MAX = 96;
const CONFETTI_MAX = 140;
const SHARDS = 16;
const BANNER_DELAY_MS = 250;
/** Chips of the standings strip at most (past it "+N"). */
const STRIP_CHIPS = 6;
/** A fan's strings are stroked at this alpha (thin lines that add up to a dense sector) and width (device px). */
const FAN_ALPHA = 0.42;
const FAN_WIDTH = 1;
/**
 * Past this many strings in all a frame strokes every k-th one of each fan (by the string's serial, so the same strings stay
 * drawn from frame to frame – no shimmer), a little stronger: the fans keep their look. Measured in Chromium: the strings'
 * rasterisation is what a dense frame costs (12 fans of ~430 strings: ~10 ms of the frame's ~15 ms raster, halved by every
 * other string), and a recording at 1080×1920 needs that headroom; the presets' battles stay far below it.
 */
const FAN_LOD_STRINGS = 3000;
/** Snapped and fading strings are drawn in this many alpha tiers (batched per team and tier), the sparks in as many. */
const GHOST_TIERS = 4;
/** The sparks' white at each tier: 0.85 fading to nothing over a cut's first 35 %. */
const SPARK_FILLS = Array.from({ length: GHOST_TIERS }, (_, k) => `rgba(255, 255, 255, ${(0.85 * (1 - (k + 0.5) / GHOST_TIERS)).toFixed(3)})`);
/** The rim arcs: how far outside the wall (px) and how thick. */
const ARC_GAP = 5;
const ARC_WIDTH = 3.5;

function hexRgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * A team colour as the fans wear it on the dark stage: a colour darker than a mid luminance is mixed toward white until it
 * reaches it (navy reads as blue, a flag's dark green as green); light colours stay as they are.
 */
export function fanColor(color: string): [number, number, number] {
  const [r, g, b] = hexRgb(color);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const floor = 0.32;
  if (lum >= floor) return [r, g, b];
  const t = (floor - lum) / (1 - lum);
  return [Math.round(r + (255 - r) * t), Math.round(g + (255 - g) * t), Math.round(b + (255 - b) * t)];
}

/** A hash of two integers to [0, 1) (the shards' directions). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
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

/** One ball's look: the line-up's (name, colour, flag), the fan's colour on the stage and its rgba ladder. */
interface Look extends ScLook {
  rgb: [number, number, number];
  /** rgba strings of the fan colour at alpha 0, 0.05 … 1. */
  alpha: string[];
  /** The fan colour as "#rrggbb". */
  fan: string;
}

export class StringCircleLayer {
  private looks: Look[] = [];
  private looksKey = "";
  private readonly drawn: (Ball | null)[] = [];
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly glows = new Map<string, HTMLCanvasElement>();
  private readonly fonts = new Map<number, string>();
  private readonly point = { x: 0, y: 0 };
  private readonly normal = { x: 0, y: 0 };
  private order: number[] = [];
  /** Scratch of the batched ghosts: each one's batch key (kind, team, tier) and the draw order sorted by it. */
  private ghostKeys = new Float64Array(64);
  private readonly ghostOrder: number[] = [];
  private readonly byGhostKey = (a: number, b: number) => this.ghostKeys[a] - this.ghostKeys[b] || a - b;
  /** The title line's sprite, what it was drawn for and its size (px). */
  private titleCanvas: HTMLCanvasElement | null = null;
  private titleKey = "";
  private titleW = 0;
  private titleH = 0;
  // Run bookkeeping and the confetti (screen space).
  private generation = -1;
  private bannerStarted = false;
  private readonly cx = new Float32Array(CONFETTI_MAX);
  private readonly cy = new Float32Array(CONFETTI_MAX);
  private readonly cvx = new Float32Array(CONFETTI_MAX);
  private readonly cvy = new Float32Array(CONFETTI_MAX);
  private readonly crot = new Float32Array(CONFETTI_MAX);
  private readonly cspin = new Float32Array(CONFETTI_MAX);
  private readonly clife = new Float32Array(CONFETTI_MAX);
  private readonly ccolor = new Int32Array(CONFETTI_MAX);
  private confetti = 0;
  private reduced = false;
  // Mirrored onto the canvas as data-sb-* for tools and the smoke test.
  /** Fan strings stroked last frame, and the stride they were thinned to (1: every one). */
  segments = 0;
  stride = 1;
  /** Rim arcs drawn last frame (runs of one team's bins). */
  arcs = 0;
  /** What the overlay drew this frame, and the title it drew. */
  titleDrawn = false;
  hudDrawn = false;
  bannerDrawn = false;
  title = "";
  /** The screen y the standings strip starts at (Infinity: none) – what the bottom captions stay above. */
  stripTop = Infinity;

  constructor() {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const q = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reduced = q.matches;
      q.addEventListener?.("change", (e) => {
        this.reduced = e.matches;
      });
    }
  }

  /* ------------------------------------------------------------------ looks */

  private refreshLooks(view: StringBattleView, o: StringCircleRenderOptions) {
    let key = `${view.count}|`;
    for (let i = 0; i < Math.min(o.roster.length, view.count); i++) key += `${o.roster[i].color}:${o.roster[i].name}:${o.roster[i].emoji};`;
    if (key === this.looksKey) return;
    this.looksKey = key;
    const roster = o.roster.slice(0, view.count).map((t, i) => ({ name: t.name || o.labels.team(i + 1), color: t.color, emoji: t.emoji }));
    this.looks = circleLineup(roster, view.count).map((l) => {
      const rgb = fanColor(l.color);
      const alpha: string[] = [];
      for (let k = 0; k <= 20; k++) alpha.push(`rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(k / 20).toFixed(2)})`);
      const fan = `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
      return { ...l, rgb, alpha, fan };
    });
  }

  /** The colour slot `slot` wears (the roster's, else the line-up's). */
  colorOf(slot: number): string {
    return this.looks[slot]?.color ?? "#ffffff";
  }

  /** The name slot `slot` goes by (the roster's, else its country's code). */
  nameOf(slot: number): string {
    return this.looks[slot]?.name ?? "";
  }

  /** The badge slot `slot` wears. */
  badgeOf(slot: number): ScBadgeKind {
    const look = this.looks[slot];
    if (!look || !look.emoji) return "d";
    if (look.code) return flagGlyphsSupported() ? "f" : "c";
    return "e";
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
      f = `${weight} ${size}px ${TEXT_FONT}`;
      this.fonts.set(key, f);
    }
    return f;
  }

  /** A soft glow in a colour (128 px). */
  private glowSprite(color: string): HTMLCanvasElement {
    let c = this.glows.get(color);
    if (c) return c;
    if (this.glows.size >= SPRITE_CACHE_MAX) this.glows.clear();
    c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    if (g) {
      const [r, gg, b] = hexRgb(color);
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, `rgba(${r}, ${gg}, ${b}, 0.6)`);
      grad.addColorStop(0.4, `rgba(${r}, ${gg}, ${b}, 0.22)`);
      grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    this.glows.set(color, c);
    return c;
  }

  /**
   * The badge of a look (128 px, the disc's radius 56 px): the flag (or another emoji) clipped to a dark disc, the flag's
   * two-letter code on a disc of the team colour where the fonts have no flag glyphs, else a glossy disc.
   */
  private badgeSprite(look: Look): HTMLCanvasElement {
    const kind: ScBadgeKind = !look.emoji ? "d" : look.code ? (flagGlyphsSupported() ? "f" : "c") : "e";
    const key = `${kind}|${kind === "c" ? look.code : look.emoji}|${look.color}`;
    let c = this.sprites.get(key);
    if (c) return c;
    if (this.sprites.size >= SPRITE_CACHE_MAX) this.sprites.clear();
    c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    if (g) {
      const [r, gg, b] = look.rgb;
      const light = `rgb(${Math.min(255, r + 80)}, ${Math.min(255, gg + 80)}, ${Math.min(255, b + 80)})`;
      if (kind === "d" || kind === "c") {
        const grad = g.createRadialGradient(48, 44, 4, 64, 64, 58);
        grad.addColorStop(0, kind === "d" ? "#ffffff" : light);
        grad.addColorStop(kind === "d" ? 0.3 : 0.45, light);
        grad.addColorStop(1, look.fan);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(64, 64, 56, 0, TWO_PI);
        g.fill();
        if (kind === "c") {
          g.font = `900 50px ${TEXT_FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.lineJoin = "round";
          g.lineWidth = 8;
          g.strokeStyle = "rgba(0, 0, 0, 0.55)";
          g.strokeText(look.code, 64, 67);
          g.fillStyle = "#ffffff";
          g.fillText(look.code, 64, 67);
        }
      } else {
        g.fillStyle = "#11141c";
        g.beginPath();
        g.arc(64, 64, 56, 0, TWO_PI);
        g.fill();
        g.save();
        g.beginPath();
        g.arc(64, 64, 55, 0, TWO_PI);
        g.clip();
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `${kind === "f" ? 122 : 92}px ${EMOJI_FONT}`;
        g.fillText(look.emoji, 64, kind === "f" ? 70 : 72);
        g.restore();
      }
    }
    this.sprites.set(key, c);
    return c;
  }

  /* ------------------------------------------------------------------ frame */

  private beginFrame(view: StringBattleView, balls: readonly Ball[], o: StringCircleRenderOptions) {
    this.refreshLooks(view, o);
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.bannerStarted = false;
      this.confetti = 0;
    }
    // The ball each slot is drawn at (the camera's slow motion may hand over balls between two steps).
    this.drawn.length = view.fighters.length;
    for (let i = 0; i < this.drawn.length; i++) this.drawn[i] = null;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const t = b.team;
      if (t === undefined || t < 0 || t >= view.fighters.length) continue;
      const f = view.fighters[t];
      if (f.alive && f.id === b.id) this.drawn[t] = b;
    }
  }

  private shielded(view: StringBattleView, slot: number, nowMs: number): boolean {
    const f = view.fighters[slot];
    return !!f && f.alive && nowMs - f.hurtMs < SB_INVULN_MS.cut;
  }

  /** Traces the arena's wall at `scale` × its radius (the circle, or the hexagon's six corners). */
  private wallPath(ctx: CanvasRenderingContext2D, view: StringBattleView, scale: number) {
    const R = view.radius * scale;
    ctx.beginPath();
    if (view.circle && view.circle.sides === 6) {
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        if (k === 0) ctx.moveTo(view.cx + R * Math.cos(a), view.cy + R * Math.sin(a));
        else ctx.lineTo(view.cx + R * Math.cos(a), view.cy + R * Math.sin(a));
      }
      ctx.closePath();
    } else ctx.arc(view.cx, view.cy, R, 0, TWO_PI);
  }

  /** World space, before the balls: the wall, the strings leaving, the fans and the rim arcs. */
  drawStage(ctx: CanvasRenderingContext2D, view: StringBattleView, balls: readonly Ball[], o: StringCircleRenderOptions) {
    this.beginFrame(view, balls, o);
    const now = o.nowMs;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // The wall: thin and white, flashing in the winner's colour (twice; once, softly, with reduced motion).
    const since = view.finished ? now - view.finishedMs : Infinity;
    const flash = since < 1400 ? (this.reduced ? 0.5 * (1 - since / 1400) : Math.max(0, 1 - since / 1400) * (0.6 + 0.4 * Math.cos(since * 0.012))) : 0;
    const winnerColor = view.winner >= 0 ? (this.looks[view.winner]?.fan ?? "#ffffff") : "#ffffff";
    ctx.strokeStyle = flash > 0.05 ? winnerColor : "rgba(228, 228, 234, 0.9)";
    ctx.lineWidth = Math.max(1.5, 0.8 * o.wallThickness) + 4 * flash;
    if (flash > 0.05) {
      ctx.shadowColor = winnerColor;
      ctx.shadowBlur = 22 * flash;
    }
    this.wallPath(ctx, view, 1);
    ctx.stroke();
    ctx.shadowBlur = 0;
    this.drawGhosts(ctx, view, now);
    this.drawFans(ctx, view, now, o.dpr);
    this.drawRimArcs(ctx, view);
    ctx.restore();
  }

  private drawFans(ctx: CanvasRenderingContext2D, view: StringBattleView, now: number, dpr: number) {
    let total = 0;
    for (const f of view.fighters) if (f.alive) total += f.strings.length;
    // The stride for this many strings – up at once, down only 10 % below the step (no flip-flop at a step's edge)
    const want = total > FAN_LOD_STRINGS ? Math.ceil(total / FAN_LOD_STRINGS) : 1;
    if (want > this.stride || (want < this.stride && total < 0.9 * FAN_LOD_STRINGS * (this.stride - 1))) this.stride = want;
    const stride = this.stride;
    const boost = Math.sqrt(stride); // a thinned fan's strings a little stronger, so it keeps its weight
    this.segments = 0;
    ctx.lineWidth = FAN_WIDTH / Math.max(0.5, dpr);
    for (const f of view.fighters) {
      if (!f.alive || f.strings.length === 0) continue;
      const B = this.drawn[f.slot];
      if (!B) continue;
      const shield = this.shielded(view, f.slot, now);
      const a = (shield ? (this.reduced ? 0.22 : 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(now * 0.03))) : FAN_ALPHA) * boost; // (dim and pulsing while shielded)
      ctx.strokeStyle = this.rgba(f.slot, Math.min(1, a));
      ctx.beginPath();
      const list = f.strings;
      for (let k = list.length - 1; k >= 0; k--) {
        const s = list[k];
        if (stride > 1 && (s.serial ?? k) % stride !== 0) continue;
        ctx.moveTo(s.ax, s.ay);
        ctx.lineTo(B.x, B.y);
        this.segments++;
      }
      ctx.stroke();
    }
  }

  /** The rim arcs: every run of bins one team holds, just outside the wall in its colour. */
  private drawRimArcs(ctx: CanvasRenderingContext2D, view: StringBattleView) {
    this.arcs = 0;
    const c = view.circle;
    if (!c) return;
    const owner = c.coverage.owner;
    const n = SC_RIM_BINS;
    // Start the walk at a change of owner, so no run is split at bin 0.
    let start = 0;
    for (let b = 1; b < n; b++) {
      if (owner[b] !== owner[b - 1]) {
        start = b;
        break;
      }
    }
    const bin = TWO_PI / n;
    const R = view.radius + ARC_GAP;
    ctx.lineWidth = ARC_WIDTH;
    ctx.lineCap = "butt";
    let runStart = start;
    for (let k = 1; k <= n; k++) {
      const b = (start + k) % n;
      const prev = (start + k - 1) % n;
      if (k < n && owner[b] === owner[prev]) continue;
      const team = owner[prev];
      if (team >= 0) {
        const a0 = runStart * bin;
        const span = (((prev - runStart + n) % n) + 1) * bin;
        ctx.strokeStyle = this.rgba(team, 0.95);
        ctx.beginPath();
        this.arcPath(ctx, view, R, a0, a0 + span, c.sides);
        ctx.stroke();
        this.arcs++;
      }
      runStart = b;
    }
    ctx.lineCap = "round";
  }

  /** Traces the wall's outline at radius `R` from bearing a0 to a1 (the circle's arc, or the hexagon's sides between them). */
  private arcPath(ctx: CanvasRenderingContext2D, view: StringBattleView, R: number, a0: number, a1: number, sides: number) {
    if (sides !== 6) {
      ctx.arc(view.cx, view.cy, R, a0, a1);
      return;
    }
    const p = this.point;
    rimAt(view.cx, view.cy, R, 6, a0, p);
    ctx.moveTo(p.x, p.y);
    // The corners in between (at multiples of 60°, where the circumradius R lies).
    let k = Math.ceil(a0 / (Math.PI / 3) + 1e-9);
    for (let a = k * (Math.PI / 3); a < a1; a = ++k * (Math.PI / 3)) ctx.lineTo(view.cx + R * Math.cos(a), view.cy + R * Math.sin(a));
    rimAt(view.cx, view.cy, R, 6, a1, p);
    ctx.lineTo(p.x, p.y);
  }

  /**
   * The strings leaving the battle. A dense battle keeps the battle's whole pool of them (`SB_MAX_GHOSTS`) on the canvas, so
   * the snapped and fading ones are batched – one path per team and alpha tier (`GHOST_TIERS` steps down as a string's
   * life runs out), the white sparks of fresh cuts one path per tier –, not a stroke each (measured: two hundred strokes
   * cost a dense frame more raster time than its thousands of fan strings). The rarer dissolving ones (a KO) keep their own
   * dash pattern each.
   */
  private drawGhosts(ctx: CanvasRenderingContext2D, view: StringBattleView, now: number) {
    ctx.lineWidth = 1.4;
    const n = view.ghostCount;
    if (this.ghostKeys.length < n) this.ghostKeys = new Float64Array(Math.max(n, 2 * this.ghostKeys.length));
    const keys = this.ghostKeys;
    const order = this.ghostOrder;
    order.length = 0;
    for (let i = 0; i < n; i++) {
      const g = view.ghosts[i];
      const age = now - g.t0;
      const life = ghostLifeMs(g.kind);
      if (age < 0 || age >= life) continue;
      const t = age / life;
      if (g.kind === "dissolve") {
        ctx.strokeStyle = this.rgba(g.slot, 0.7 * (1 - t) * (1 - t));
        ctx.setLineDash([2 + 6 * t, 3 + 9 * t]);
        ctx.beginPath();
        ctx.moveTo(g.ax, g.ay);
        ctx.lineTo(g.bx, g.by);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const tier = Math.min(GHOST_TIERS - 1, Math.floor(t * GHOST_TIERS)); // 0 fresh … GHOST_TIERS − 1 nearly gone
      keys[i] = ((g.kind === "snap" ? 0 : 1) * 4096 + g.slot) * GHOST_TIERS + tier;
      order.push(i);
    }
    order.sort(this.byGhostKey);
    // Both halves of a snapped string recoil from the cut; a fading string fades where it was.
    let current = -1;
    for (const i of order) {
      const g = view.ghosts[i];
      if (keys[i] !== current) {
        if (current >= 0) ctx.stroke();
        current = keys[i];
        const k = 1 - ((current % GHOST_TIERS) + 0.5) / GHOST_TIERS;
        ctx.strokeStyle = this.rgba(g.slot, g.kind === "snap" ? 0.85 * k : 0.35 * k);
        ctx.beginPath();
      }
      if (g.kind === "snap") {
        const k = 1 - Math.min(1, (now - g.t0) / ghostLifeMs("snap"));
        const kk = k * k;
        ctx.moveTo(g.ax, g.ay);
        ctx.lineTo(g.ax + (g.qx - g.ax) * kk, g.ay + (g.qy - g.ay) * kk);
        ctx.moveTo(g.bx, g.by);
        ctx.lineTo(g.bx + (g.qx - g.bx) * kk, g.by + (g.qy - g.by) * kk);
      } else {
        ctx.moveTo(g.ax, g.ay);
        ctx.lineTo(g.bx, g.by);
      }
    }
    if (current >= 0) ctx.stroke();
    // The white sparks at fresh cuts (their first 35 %), growing as they fade.
    order.length = 0;
    for (let i = 0; i < n; i++) {
      const g = view.ghosts[i];
      if (g.kind !== "snap") continue;
      const t = (now - g.t0) / ghostLifeMs("snap");
      if (t < 0 || t >= 0.35) continue;
      keys[i] = Math.min(GHOST_TIERS - 1, Math.floor((t / 0.35) * GHOST_TIERS));
      order.push(i);
    }
    order.sort(this.byGhostKey);
    current = -1;
    for (const i of order) {
      const g = view.ghosts[i];
      if (keys[i] !== current) {
        if (current >= 0) ctx.fill();
        current = keys[i];
        ctx.fillStyle = SPARK_FILLS[current];
        ctx.beginPath();
      }
      const r = 1.5 + 5 * ((now - g.t0) / ghostLifeMs("snap"));
      ctx.moveTo(g.qx + r, g.qy);
      ctx.arc(g.qx, g.qy, r, 0, TWO_PI);
    }
    if (current >= 0) ctx.fill();
  }

  /** World space, the ball pass: glows, flag badges in their rings of lives, names and the shatter bursts. */
  drawBodies(ctx: CanvasRenderingContext2D, view: StringBattleView, o: StringCircleRenderOptions) {
    const now = o.nowMs;
    const c = view.circle;
    const startLives = Math.max(1, view.settings.lives);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of view.fighters) {
      if (!f.alive) continue;
      const B = this.drawn[f.slot];
      const look = this.looks[f.slot];
      if (!B || !look) continue;
      const r = B.radius;
      const pulse = view.finale && !view.finished && !this.reduced ? 1 + 0.25 * Math.sin(now * 0.02 + f.slot) : 1;
      const glowR = 2.6 * r * pulse;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.glowSprite(look.fan), B.x - glowR, B.y - glowR, 2 * glowR, 2 * glowR);
      const shield = this.shielded(view, f.slot, now);
      ctx.globalAlpha = shield ? (this.reduced ? 0.6 : Math.sin(now * 0.05) > 0 ? 1 : 0.4) : 1;
      const s = (2 * r * 128) / 112;
      ctx.drawImage(this.badgeSprite(look), B.x - s / 2, B.y - s / 2, s, s);
      // The ring of lives: a segment per life the ball started with – the ones left bright, the current one draining as its
      // strings are cut toward the next lost life; one ring and the number past a dozen lives.
      const ringR = r + Math.max(1.5, 0.16 * r);
      ctx.lineWidth = Math.max(2, 0.24 * r);
      ctx.lineCap = "butt";
      if (startLives <= 12) {
        const seg = TWO_PI / startLives;
        const gap = startLives > 1 ? Math.min(0.25, 0.3 * seg) : 0;
        const drain = c && c.cut > 0 ? Math.min(1, (c.toward[f.slot] ?? 0) / c.cut) : 0;
        for (let k = 0; k < startLives; k++) {
          const a0 = -Math.PI / 2 + k * seg + gap / 2;
          const a1 = a0 + seg - gap;
          ctx.strokeStyle = k < f.lives ? this.rgba(f.slot, 1) : "rgba(255, 255, 255, 0.16)";
          ctx.beginPath();
          if (k === f.lives - 1 && drain > 0) {
            ctx.arc(B.x, B.y, ringR, a0, a0 + (a1 - a0) * (1 - drain));
            ctx.stroke();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
            ctx.beginPath();
            ctx.arc(B.x, B.y, ringR, a0 + (a1 - a0) * (1 - drain), a1);
          } else ctx.arc(B.x, B.y, ringR, a0, a1);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = this.rgba(f.slot, 1);
        ctx.beginPath();
        ctx.arc(B.x, B.y, ringR, 0, TWO_PI);
        ctx.stroke();
        const fs = Math.max(8, 0.6 * r);
        ctx.font = this.font(fs, 900);
        ctx.lineWidth = Math.max(2, 0.2 * fs);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
        ctx.strokeText(String(f.lives), B.x, B.y + r + 0.9 * fs);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(f.lives), B.x, B.y + r + 0.9 * fs);
      }
      ctx.lineCap = "round";
      ctx.globalAlpha = 1;
      if (o.showNames && o.roster.length > 0) {
        const fs = Math.max(9, 0.72 * r);
        ctx.font = this.font(fs, 800);
        ctx.lineWidth = Math.max(2, 0.22 * fs);
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
        ctx.strokeText(look.name, B.x, B.y - ringR - 0.9 * fs);
        ctx.fillStyle = look.fan;
        ctx.fillText(look.name, B.x, B.y - ringR - 0.9 * fs);
      }
    }
    this.drawBursts(ctx, view, now);
    ctx.restore();
  }

  /** A shattered ball: a flash and shards in its colour flying out from where it was (from a seed, on the simulation clock). */
  private drawBursts(ctx: CanvasRenderingContext2D, view: StringBattleView, now: number) {
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
        const d = burst.radius * (5 + 9 * w) * sec * (1 - 0.45 * t);
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
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ screen space */

  /**
   * Screen space, inside the square the recorder exports: the title line at the top, the standings strip at the bottom (the
   * HUD switch) and, unless the teams banner crowns the winner (`teamBanner`), the winner banner and its confetti. `inset`
   * moves the title below the page's overlay buttons; `dtMs` advances the confetti (0 while paused). Returns the screen y of
   * the title's bottom, which the top captions start below (the strip's top is `stripTop`, which the bottom ones stay above).
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: StringBattleView, o: StringCircleRenderOptions, frame: { inset: number; dtMs: number; teamBanner: boolean }): number {
    const side = Math.min(o.width, o.height);
    const sx = (o.width - side) / 2;
    const sy = (o.height - side) / 2;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    // The title line: the settings' own, else the translated STRING CIRCLE – as big as fits above the arena.
    const title = (view.settings.title || "").trim() || o.labels.title;
    this.title = title;
    let fs = 0.062 * side;
    ctx.font = this.font(fs, 900);
    const tw = ctx.measureText(title).width;
    if (tw > 0.86 * side) fs *= (0.86 * side) / tw;
    const ty = sy + frame.inset + 0.058 * side;
    const sprite = this.titleSprite(title, fs, o.dpr);
    if (sprite) ctx.drawImage(sprite, sx + side / 2 - this.titleW / 2, ty - this.titleH / 2, this.titleW, this.titleH);
    else this.drawTitle(ctx, title, fs, sx + side / 2, ty);
    this.titleDrawn = true;
    const titleBottom = ty + 0.6 * fs;
    this.hudDrawn = view.settings.hud;
    this.stripTop = this.hudDrawn ? this.drawStrip(ctx, view, sx, sy, side, o.labels) : Infinity;
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
    return titleBottom;
  }

  /** The title line: a dark outline, white letters with a soft white glow. */
  private drawTitle(ctx: CanvasRenderingContext2D, title: string, fs: number, x: number, y: number) {
    ctx.font = this.font(fs, 900);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 0.12 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(title, x, y);
    ctx.shadowColor = "rgba(255, 255, 255, 0.55)";
    ctx.shadowBlur = 0.35 * fs;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(title, x, y);
    ctx.shadowBlur = 0;
  }

  /**
   * The title line drawn once into a sprite at the canvas' raster scale (`dpr`: device px per px) and kept while the title,
   * its size and the scale stay – its glow is a blur, which the canvas would otherwise redo every frame. Null without a DOM.
   */
  private titleSprite(title: string, fs: number, dpr: number): HTMLCanvasElement | null {
    const key = `${title}|${fs.toFixed(2)}|${dpr.toFixed(3)}`;
    if (key === this.titleKey) return this.titleCanvas;
    this.titleKey = key;
    this.titleCanvas = null;
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    if (!g) return null;
    g.font = this.font(fs, 900);
    const pad = Math.max(2, 0.12 * fs) + 0.8 * fs; // the outline and the glow's reach
    this.titleW = g.measureText(title).width + 2 * pad;
    this.titleH = 1.3 * fs + 2 * pad;
    const k = Math.max(0.5, dpr);
    c.width = Math.max(1, Math.ceil(this.titleW * k));
    c.height = Math.max(1, Math.ceil(this.titleH * k));
    g.scale(c.width / this.titleW, c.height / this.titleH);
    this.drawTitle(g, title, fs, this.titleW / 2, this.titleH / 2);
    this.titleCanvas = c;
    return c;
  }

  /** The standings strip at the bottom of the square: a chip per team still in – its flag and share of the rim – the leader first. Returns its top. */
  private drawStrip(ctx: CanvasRenderingContext2D, view: StringBattleView, sx: number, sy: number, side: number, L: StringCircleLabels): number {
    const c = view.circle;
    const order = this.order;
    order.length = 0;
    for (const f of view.fighters) if (f.alive) order.push(f.slot);
    const share = c ? c.coverage.share : null;
    order.sort((a, b) => (share ? (share[b] ?? 0) - (share[a] ?? 0) : 0) || a - b);
    const fs = Math.max(8, 0.026 * side);
    const chipH = 1.7 * fs;
    const badge = 1.25 * fs;
    const pad = 0.45 * fs;
    const shown = Math.min(order.length, STRIP_CHIPS);
    ctx.font = this.font(fs, 800);
    const widths: number[] = [];
    let total = 0;
    for (let i = 0; i < shown; i++) {
      const pct = share ? Math.round(100 * (share[order[i]] ?? 0)) : 0;
      const w = pad + badge + 0.35 * fs + ctx.measureText(`${pct}%`).width + pad;
      widths.push(w);
      total += w + 0.4 * fs;
    }
    const more = order.length - shown;
    const moreText = more > 0 ? L.more(more) : "";
    if (more > 0) total += ctx.measureText(moreText).width + 0.4 * fs;
    total -= 0.4 * fs;
    const top = sy + side - 0.025 * side - chipH;
    let x = sx + (side - total) / 2;
    ctx.textBaseline = "middle";
    for (let i = 0; i < shown; i++) {
      const slot = order[i];
      const look = this.looks[slot];
      if (!look) continue;
      const w = widths[i];
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      roundRect(ctx, x, top, w, chipH, chipH / 2);
      ctx.fill();
      ctx.strokeStyle = this.rgba(slot, i === 0 ? 0.95 : 0.5);
      ctx.lineWidth = i === 0 ? 2 : 1;
      ctx.stroke();
      const s = (badge * 128) / 112;
      ctx.drawImage(this.badgeSprite(look), x + pad + badge / 2 - s / 2, top + chipH / 2 - s / 2, s, s);
      const pct = share ? Math.round(100 * (share[slot] ?? 0)) : 0;
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.font = this.font(fs, 800);
      ctx.fillText(`${pct}%`, x + pad + badge + 0.35 * fs, top + chipH / 2 + 0.05 * fs);
      x += w + 0.4 * fs;
    }
    if (more > 0) {
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.fillText(moreText, x, top + chipH / 2);
    }
    return top;
  }

  private drawBanner(ctx: CanvasRenderingContext2D, view: StringBattleView, cx: number, cy: number, side: number, o: StringCircleRenderOptions) {
    const L = o.labels;
    const k = Math.min(1, Math.max(0, o.nowMs - view.finishedMs - BANNER_DELAY_MS) / 280);
    const pop = k >= 1 ? 1 : 0.6 + 0.4 * k + 0.15 * Math.sin(k * Math.PI);
    const winner = view.winner;
    const look = winner >= 0 ? this.looks[winner] : undefined;
    const flag = look && look.emoji && (!look.code || flagGlyphsSupported()) ? `${look.emoji} ` : "";
    const title = winner >= 0 ? `🏆 ${flag}${L.wins(this.nameOf(winner))}` : L.draw;
    const color = look ? look.fan : "#ffffff";
    const pct = winner >= 0 && view.circle ? Math.round(100 * (view.circle.coverage.share[winner] ?? 0)) : -1;
    const sub = pct >= 0 ? L.rim(pct) : "";
    let fs = Math.max(20, 0.072 * side);
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
      this.ccolor[i] = i % 3 === 0 ? -1 : Math.random() < 0.6 ? winner : Math.floor(Math.random() * Math.max(1, this.looks.length));
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
      ctx.fillStyle = this.ccolor[i] < 0 ? "#ffffff" : (this.looks[this.ccolor[i]]?.fan ?? "#ffffff");
      ctx.fillRect(-s / 2, -s / 4, s, s / 2);
      ctx.restore();
    }
    if (live === 0) this.confetti = 0;
  }
}

/* ------------------------------------------------------------------ data-sb-* of the circle style */

/** The canvas data keys the circle style adds (data-sb-*); Canvas.tsx clears them in the other styles. */
export const STRING_CIRCLE_DATA_KEYS = ["sbArena", "sbCoverage", "sbFans", "sbAnchors", "sbTwangs", "sbSnaps", "sbCircleLives", "sbTitle", "sbFlagGlyphs", "sbBadges", "sbNames", "sbSegments", "sbStride", "sbRimArcs", "sbInArena", "sbStripDrawn"];

/**
 * Mirrors the circle style onto the canvas (data-sb-*): the arena, every team's share of the rim in percent (`sbCoverage`)
 * and live strings (`sbFans`), the strings anchored, the twang and snap events, the lives the cuts took, the title drawn,
 * the badges (f: a flag glyph, c: its code, e: another emoji, d: a disc) and names, the strings stroked last frame and their
 * stride, the rim arcs, whether every ball is inside the wall and whether the standings strip was drawn.
 */
export function writeStringCircleDataset(view: StringBattleView, layer: StringCircleLayer, balls: readonly Ball[], set: (key: string, value: string) => void) {
  const c = view.circle;
  if (!c) return;
  set("sbArena", c.sides === 6 ? "hexagon" : "circle");
  set("sbCoverage", coverageText(c, view.count));
  set("sbFans", fanText(view.fighters));
  set("sbAnchors", String(c.anchors));
  set("sbTwangs", String(c.twangs));
  set("sbSnaps", String(c.snaps));
  set("sbCircleLives", String(c.lives));
  set("sbTitle", layer.title);
  set("sbFlagGlyphs", flagGlyphsSupported() ? "1" : "0");
  let badges = "";
  let names = "";
  for (let i = 0; i < view.count; i++) {
    badges += layer.badgeOf(i);
    names += `${i > 0 ? "|" : ""}${layer.nameOf(i)}`;
  }
  set("sbBadges", badges);
  set("sbNames", names);
  set("sbSegments", String(layer.segments));
  set("sbStride", String(layer.stride));
  set("sbRimArcs", String(layer.arcs));
  const n = { x: 0, y: 0 };
  let inside = true;
  for (const b of balls) {
    const t = b.team;
    if (t === undefined || t < 0 || t >= view.fighters.length) continue;
    const f = view.fighters[t];
    if (!f.alive || f.id !== b.id) continue;
    if (wallOverlap(view.cx, view.cy, view.radius, c.sides, b.x, b.y, b.radius, n) > 1) inside = false;
  }
  set("sbInArena", inside ? "1" : "0");
  set("sbStripDrawn", layer.hudDrawn ? "1" : "0");
}
