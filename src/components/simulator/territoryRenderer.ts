import type { Ball } from "@/lib/physics/types";
import { wobbleEnvelope } from "@/lib/physics/wobble";
import {
  TY_FLIP_LOG,
  TY_PALETTE,
  TY_PEG_RADIUS,
  TY_PEG_STEP,
  TY_POP_MS,
  TY_SHOCK_MS,
  TY_WHIRL_MS,
  TY_WHIRL_ARMS,
  pegLast,
  tilePercentages,
  whirlPoint,
  whirlReach,
  whirlSwept,
  type TerritoryView,
  type TyPower,
  type WhirlReach,
} from "@/lib/physics/modes/territory";
import type { TeamEntry } from "@/lib/teams";
import { inCaptionColumn } from "@/lib/captions";
import { SHAKE_DECAY_MS, shakeAmplitude, shakeOffset } from "@/lib/simulation/camera";
import { visualValue } from "@/lib/unlimited"; // uncap-all: a blast's reach drawn no wider than any canvas

/**
 * Canvas drawing of Territory (feature odd-territory; lib/physics/modes/territory.ts), one `TerritoryLayer` per draw
 * loop, called at fixed points of the frame by Canvas.tsx:
 *
 *  - `drawStage()` (world space, under the balls): the tile map – kept in an offscreen canvas in device pixels that is
 *    repainted only where a tile changed owner (the mode's typed tile array is diffed against the copy last painted, at
 *    most cols × rows byte compares a frame) and drawn with one `drawImage` –, the springy pops of the tiles that just
 *    flipped (the wobble field's envelope, `wobbleEnvelope()`), the faint dotted grid of the pegs, the thin grey frame
 *    (flashing at the verdict), the bombers' shock rings and debris and the vortices' whirls;
 *  - `drawBodies()` (world space, the ball pass): short trails, soft colour halos and glossy bodies per team (a ghost
 *    translucent, a painter's dash bright, a charge ring, an armed bomber's flickering one), and the names of a team roster;
 *  - `drawOverlay()` (screen space, the HUD band at the top of the square the recorder exports): the "FLASHING LIGHTS –
 *    THE END GETS INTENSE" badge, PICK A SIDE, the countdown, "VORTEX 52% VS BOMBER 48%", the live percentage bar (its
 *    segments ease toward the counts) and – without a team roster (the teams banner takes over with one) – the winner
 *    banner (or DRAW) with its confetti.
 *
 * `blastJolt()` gives the world offset of a bomber's blast: the board jolts like the cinematic camera's screen shake (its
 * envelope and wobble, `TY_BLAST_SHAKE` strong) on the simulation clock – Canvas.tsx applies it while the camera's own
 * Screen Shake is off (with it on, the camera shakes the view on the blast's wall-break sound instead).
 *
 * Visual only: it reads the view and never writes to the engine. The pops, rings and debris run on the simulation clock
 * (a pause freezes them, a recording replays them); the confetti and the bar's easing are decoration. Steady-state frames
 * allocate nothing but the few strings of the HUD: colours, sprites and fonts are cached.
 */

export interface TerritoryLabels {
  vs: string;
  pickSide: string;
  badgeTop: string;
  badgeBottom: string;
  /** The HUD name of a team with a power ("VORTEX"…); a team without one goes by its name. */
  powers: Record<Exclude<TyPower, "none">, string>;
  /** "[name] WINS". */
  wins: (name: string) => string;
  draw: string;
  /** The banner's second line: "[pct]% OF THE BOARD". */
  share: (pct: number) => string;
  /** Name of an unnamed roster team: "Team 3". */
  team: (n: number) => string;
}

export const DEFAULT_TERRITORY_LABELS: TerritoryLabels = {
  vs: "VS",
  pickSide: "PICK A SIDE",
  badgeTop: "FLASHING LIGHTS",
  badgeBottom: "THE END GETS INTENSE",
  powers: { vortex: "VORTEX", bomber: "BOMBER", painter: "PAINTER", ghost: "GHOST" },
  wins: (name) => `${name} WINS`,
  draw: "DRAW",
  share: (pct) => `${pct}% OF THE BOARD`,
  team: (n) => `Team ${n}`,
};

export interface TerritoryRenderOptions {
  /** Device pixel ratio of the canvas. */
  dpr: number;
  /** The team roster (its colours and names play the first teams); empty = the palette. */
  roster: readonly TeamEntry[];
  /** Names above the balls (a roster's "ball names" switch). */
  showNames: boolean;
  showTrails: boolean;
  trailThickness: number;
  wallThickness: number;
  labels: TerritoryLabels;
  /** Simulation time now (ms). */
  nowMs: number;
}

const TWO_PI = Math.PI * 2;
const CONFETTI_MAX = 150;
const BANNER_DELAY_MS = 250;
const DEBRIS = 14;
/** The trail behind a ball: its last this many positions (60 Hz steps). */
const TRAIL_POINTS = 7;
const GAP_COLOR = "#050508";
/** How hard a bomber's blast jolts the board, on the camera's Screen Shake scale (0–1). */
export const TY_BLAST_SHAKE = 0.5;
/** White at alpha 0.55 … 1 in eleven steps (an armed bomber's flicker), built once. */
const ARMED_WHITE: readonly string[] = Array.from({ length: 11 }, (_, k) => `rgba(255, 255, 255, ${(0.55 + 0.045 * k).toFixed(3)})`);

function hexRgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A hash of two integers to [0, 1) (the debris' directions). */
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

/** The look of one team: colour, the tile fill, rgba steps, name. */
interface TeamLook {
  color: string;
  /** The tile's colour: the team colour dimmed toward black (neon on black). */
  tile: string;
  /** rgba strings at alpha 0, 0.05 … 1. */
  alpha: string[];
  name: string;
}

/** The HUD name of `team`: its power's, or its name without one. */
function hudName(view: TerritoryView, team: number, name: string, labels: TerritoryLabels): string {
  const power = view.settings.powers[team] ?? "none";
  return power === "none" ? name : labels.powers[power];
}

export class TerritoryLayer {
  private looks: TeamLook[] = [];
  private looksKey = "";
  private lookRoster: readonly TeamEntry[] | null = null;
  private lookTeams = -1;
  private lookLabels: TerritoryLabels | null = null;
  /** The offscreen tile map (device pixels), the copy of the tiles it shows and what it was built for. */
  private tileCanvas: HTMLCanvasElement | null = null;
  private tileCtx: CanvasRenderingContext2D | null = null;
  private drawnTiles = new Uint8Array(0);
  private tileKey = "";
  private readonly halo = new Map<string, HTMLCanvasElement>();
  private readonly body = new Map<string, HTMLCanvasElement>();
  private readonly fonts = new Map<number, string>();
  private readonly pct: number[] = [];
  private readonly shown = new Float64Array(4);
  private shownGeneration = -1;
  private readonly point = { x: 0, y: 0 };
  private readonly whirl: WhirlReach = { reach: 0, span: 1, samples: 8 };
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
  private bannerGeneration = -1;
  /** For tools and the smoke test: tiles repainted in the offscreen map this run, pops drawn last frame, what the overlay drew. */
  repaints = 0;
  /** Blasts that jolted the board (`blastJolt()`), and the last one's seed. */
  jolts = 0;
  private joltSeed = Number.NaN;
  pops = 0;
  badgeDrawn = false;
  /** The badge sits in the top-right corner (the teams scoreboard has the top-left one). */
  badgeRight = false;
  hudDrawn = false;
  bannerDrawn = false;
  private repaintGeneration = -1;
  // The last badge drawn (screen px): what the top captions keep clear of.
  private badgeX = 0;
  private badgeW = 0;
  private badgeBottom = 0;

  /** The colour of team `team` this frame (the roster's, else the palette's). */
  colorOf(team: number): string {
    return this.looks[team]?.color ?? TY_PALETTE[((team % TY_PALETTE.length) + TY_PALETTE.length) % TY_PALETTE.length].color;
  }

  /** The name of team `team` (the roster's, "Team 3" for an unnamed roster team, else the palette's). */
  nameOf(team: number): string {
    return this.looks[team]?.name ?? TY_PALETTE[((team % TY_PALETTE.length) + TY_PALETTE.length) % TY_PALETTE.length].name;
  }

  private font(size: number, weight: number): string {
    const px = Math.max(6, Math.round(size));
    const key = px * 1000 + weight;
    let f = this.fonts.get(key);
    if (!f) {
      f = `${weight} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      this.fonts.set(key, f);
    }
    return f;
  }

  private rgba(team: number, a: number): string {
    const look = this.looks[team];
    if (!look) return `rgba(255, 255, 255, ${a})`;
    return look.alpha[Math.max(0, Math.min(20, Math.round(a * 20)))];
  }

  /** Rebuilds the team looks when the roster or the team count changed (the same roster object and count: nothing to do). */
  private refreshLooks(view: TerritoryView, o: TerritoryRenderOptions) {
    if (o.roster === this.lookRoster && view.teams === this.lookTeams && o.labels === this.lookLabels) return;
    this.lookRoster = o.roster;
    this.lookTeams = view.teams;
    this.lookLabels = o.labels;
    let key = `${view.teams}`;
    for (let i = 0; i < Math.min(o.roster.length, view.teams); i++) key += `|${o.roster[i].color}|${o.roster[i].name}`;
    if (key === this.looksKey) return;
    this.looksKey = key;
    this.looks = [];
    for (let t = 0; t < view.teams; t++) {
      const entry = o.roster[t];
      const color = entry ? entry.color : TY_PALETTE[t % TY_PALETTE.length].color;
      const name = entry ? entry.name || o.labels.team(t + 1) : TY_PALETTE[t % TY_PALETTE.length].name;
      const [r, g, b] = hexRgb(color);
      const alpha: string[] = [];
      for (let k = 0; k <= 20; k++) alpha.push(`rgba(${r}, ${g}, ${b}, ${(k / 20).toFixed(2)})`);
      const dim = (c: number) => Math.round(12 + 0.36 * c);
      this.looks.push({ color, tile: `rgb(${dim(r)}, ${dim(g)}, ${dim(b)})`, alpha, name });
    }
    this.tileKey = "";
  }

  /* ------------------------------------------------------------------ world space */

  /** World space, under the balls: the tile map, the pops, the pegs, the frame, the blasts and the whirls. */
  drawStage(ctx: CanvasRenderingContext2D, view: TerritoryView, balls: readonly Ball[], o: TerritoryRenderOptions) {
    this.refreshLooks(view, o);
    const f = view.field;
    const now = o.nowMs;
    this.paintTiles(view, o.dpr);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (this.tileCanvas) ctx.drawImage(this.tileCanvas, f.gx, f.gy, f.gridW, f.gridH);
    this.drawPops(ctx, view, now);
    if (view.settings.pegs) {
      ctx.fillStyle = "rgba(235, 235, 245, 0.32)";
      const L = TY_PEG_STEP * f.tile;
      const r = Math.max(0.8, TY_PEG_RADIUS * f.tile);
      ctx.beginPath();
      for (let j = 1; j <= pegLast(view.rows); j++) {
        for (let i = 1; i <= pegLast(view.cols); i++) {
          const x = f.gx + i * L;
          const y = f.gy + j * L;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TWO_PI);
        }
      }
      ctx.fill();
    }
    // The frame: thin grey, flashing white at the verdict; pulsing in the finale.
    const since = view.finished ? now - view.finishedMs : Infinity;
    const flash = since < 1200 ? Math.max(0, 1 - since / 1200) * (0.6 + 0.4 * Math.cos(since * 0.012)) : 0;
    const pulse = view.finale ? 0.5 + 0.5 * Math.sin(now * 0.02) : 0;
    ctx.strokeStyle = `rgba(200, 200, 205, ${Math.min(1, 0.55 + 0.25 * pulse + flash).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.5, 0.8 * o.wallThickness) + 4 * flash;
    if (flash > 0.02) {
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 22 * flash;
    }
    const pad = 0.5 * ctx.lineWidth;
    ctx.strokeRect(f.gx - pad, f.gy - pad, f.gridW + 2 * pad, f.gridH + 2 * pad);
    ctx.shadowBlur = 0;
    this.drawShocks(ctx, view, now);
    this.drawWhirls(ctx, view, balls, now);
    ctx.restore();
  }

  /** Keeps the offscreen tile map in step with the view: rebuilt when the board, its size or the colours changed, else only the tiles that flipped. */
  private paintTiles(view: TerritoryView, dpr: number) {
    const f = view.field;
    const W = Math.max(1, Math.ceil(f.gridW * dpr));
    const H = Math.max(1, Math.ceil(f.gridH * dpr));
    const key = `${view.generation}|${view.cols}|${view.rows}|${W}|${H}|${this.looksKey}`;
    if (typeof document === "undefined") return;
    if (view.generation !== this.repaintGeneration) {
      this.repaintGeneration = view.generation;
      this.repaints = 0;
    }
    let full = false;
    if (key !== this.tileKey || !this.tileCanvas || !this.tileCtx) {
      if (!this.tileCanvas) this.tileCanvas = document.createElement("canvas");
      if (this.tileCanvas.width !== W) this.tileCanvas.width = W;
      if (this.tileCanvas.height !== H) this.tileCanvas.height = H;
      this.tileCtx = this.tileCanvas.getContext("2d");
      if (this.drawnTiles.length < view.total) this.drawnTiles = new Uint8Array(view.total);
      this.tileKey = key;
      full = true;
    }
    const g = this.tileCtx;
    if (!g) return;
    const tiles = view.tiles;
    const drawn = this.drawnTiles;
    const cols = view.cols;
    const sx = W / cols;
    const sy = H / view.rows;
    const gap = Math.max(1, Math.round(0.07 * sx));
    if (full) {
      g.fillStyle = GAP_COLOR;
      g.fillRect(0, 0, W, H);
    }
    for (let i = 0; i < view.total; i++) {
      const owner = tiles[i];
      if (!full && drawn[i] === owner) continue;
      drawn[i] = owner;
      const col = i % cols;
      const row = (i - col) / cols;
      const x0 = Math.round(col * sx);
      const y0 = Math.round(row * sy);
      const x1 = Math.round((col + 1) * sx);
      const y1 = Math.round((row + 1) * sy);
      if (!full) {
        g.fillStyle = GAP_COLOR;
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      g.fillStyle = this.looks[owner]?.tile ?? "#222";
      g.fillRect(x0 + gap / 2, y0 + gap / 2, x1 - x0 - gap, y1 - y0 - gap);
      this.repaints++;
    }
  }

  /** The tiles that just flipped pop in their new colour: a springy scale from the wobble field's envelope, fading out. */
  private drawPops(ctx: CanvasRenderingContext2D, view: TerritoryView, now: number) {
    const f = view.field;
    this.pops = 0;
    const count = view.flipCount;
    if (count === 0) return;
    const half = f.tile / 2;
    for (let team = 0; team < view.teams; team++) {
      let any = false;
      for (let n = 1; n <= count; n++) {
        const k = (view.flipHead - n + TY_FLIP_LOG) % TY_FLIP_LOG;
        const age = now - view.flipMs[k];
        if (age >= TY_POP_MS) break;
        if (age < 0 || view.flipTeam[k] !== team) continue;
        const t = age / TY_POP_MS;
        if (!any) {
          ctx.beginPath();
          any = true;
        }
        const idx = view.flipTile[k];
        const col = idx % view.cols;
        const row = (idx - col) / view.cols;
        const s = half * (1 + 0.4 * (1 - t) * wobbleEnvelope(age / 1000));
        const x = f.gx + (col + 0.5) * f.tile;
        const y = f.gy + (row + 0.5) * f.tile;
        ctx.rect(x - s, y - s, 2 * s, 2 * s);
        this.pops++;
      }
      if (!any) continue;
      ctx.fillStyle = this.rgba(team, 0.55);
      ctx.fill();
    }
  }

  /** The bombers' blasts: a white flash, a shock ring in the team colour and debris flying out (seeded, on the simulation clock). */
  private drawShocks(ctx: CanvasRenderingContext2D, view: TerritoryView, now: number) {
    const f = view.field;
    for (const s of view.shocks) {
      const age = now - s.t0;
      if (age < 0 || age >= TY_SHOCK_MS) continue;
      const t = age / TY_SHOCK_MS;
      const x = f.gx + s.u * f.tile;
      const y = f.gy + s.v * f.tile;
      const R = visualValue(s.radius * f.tile); // (a reach past any canvas draws the same picture at DRAW_EXTENT_PX)
      if (age < 140) {
        const k = 1 - age / 140;
        ctx.globalAlpha = 0.75 * k;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, R * (0.35 + 0.65 * (1 - k)), 0, TWO_PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1 - t;
      const ringR = R * (0.3 + 0.9 * (1 - (1 - t) * (1 - t)));
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, TWO_PI);
      ctx.strokeStyle = this.rgba(s.team, 0.3);
      ctx.lineWidth = 4 + 10 * (1 - t);
      ctx.stroke();
      ctx.strokeStyle = this.rgba(s.team, 1);
      ctx.lineWidth = 1 + 4 * (1 - t);
      ctx.stroke();
      const sec = age / 1000;
      for (let k = 0; k < DEBRIS; k++) {
        const u = hash01(s.seed, k);
        const w = hash01(s.seed, k + 101);
        const a = TWO_PI * u;
        const d = R * (0.4 + (1.6 + 1.4 * w) * (1 - (1 - t) * (1 - t)));
        const size = Math.max(1.2, f.tile * (0.12 + 0.18 * hash01(s.seed, k + 202)));
        ctx.fillStyle = k % 3 === 0 ? "rgba(255, 255, 255, 0.9)" : this.rgba(s.team, 0.9);
        ctx.fillRect(x + Math.cos(a) * d - size / 2, y + Math.sin(a) * d - size / 2 + 40 * sec * sec, size, size);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** The vortices' running whirls: both spiral arms out to where the sweep has got, glowing in the team colour. */
  private drawWhirls(ctx: CanvasRenderingContext2D, view: TerritoryView, balls: readonly Ball[], now: number) {
    const f = view.field;
    const q = this.point;
    for (const tb of view.balls) {
      if (!(tb.whirlMs > -Infinity)) continue;
      const age = now - tb.whirlMs;
      if (age < 0 || age >= TY_WHIRL_MS) continue;
      // (the arms' part on the board: `whirlReach()` – any reach draws at most the board's diagonal; a big ball's reaches past it)
      const w = whirlReach(tb.reach, view.cols, view.rows, this.whirl);
      const R = w.reach * f.tile;
      const p = age / TY_WHIRL_MS;
      const B = this.ballById(balls, tb.id);
      const x = B ? B.x : f.gx + tb.u * f.tile;
      const y = B ? B.y : f.gy + tb.v * f.tile;
      const upTo = Math.max(1, whirlSwept(p, w.samples, w.span));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // Both arms in one path: a wide soft glow, then the bright line (no shadow blur – cheap at 32 balls).
      ctx.beginPath();
      for (let arm = 0; arm < TY_WHIRL_ARMS; arm++) {
        ctx.moveTo(x, y);
        for (let k = 1; k <= upTo; k++) {
          whirlPoint(k, w.samples, arm, tb.whirlAngle, tb.curve, R, q, w.span);
          ctx.lineTo(x + q.x, y + q.y);
        }
      }
      ctx.strokeStyle = this.rgba(tb.team, 0.25 * (1 - 0.5 * p));
      ctx.lineWidth = Math.max(4, 0.7 * f.tile);
      ctx.stroke();
      ctx.strokeStyle = this.rgba(tb.team, 0.9 * (1 - 0.5 * p));
      ctx.lineWidth = Math.max(1.5, 0.2 * f.tile);
      ctx.stroke();
    }
  }

  private ballById(balls: readonly Ball[], id: number): Ball | null {
    for (let i = 0; i < balls.length; i++) if (balls[i].id === id) return balls[i];
    return null;
  }

  private haloSprite(color: string): HTMLCanvasElement {
    let c = this.halo.get(color);
    if (!c) {
      c = document.createElement("canvas");
      c.width = c.height = 96;
      const g = c.getContext("2d")!;
      const [r, gg, b] = hexRgb(color);
      const grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
      grad.addColorStop(0, `rgba(${r}, ${gg}, ${b}, 0.55)`);
      grad.addColorStop(0.35, `rgba(${r}, ${gg}, ${b}, 0.22)`);
      grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 96, 96);
      this.halo.set(color, c);
    }
    return c;
  }

  private bodySprite(color: string): HTMLCanvasElement {
    let c = this.body.get(color);
    if (!c) {
      c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      const [r, gg, b] = hexRgb(color);
      const grad = g.createRadialGradient(24, 22, 2, 32, 32, 32);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.3, `rgb(${Math.min(255, r + 90)}, ${Math.min(255, gg + 90)}, ${Math.min(255, b + 90)})`);
      grad.addColorStop(1, color);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(32, 32, 31, 0, TWO_PI);
      g.fill();
      g.strokeStyle = "rgba(255, 255, 255, 0.85)";
      g.lineWidth = 2.5;
      g.stroke();
      this.body.set(color, c);
    }
    return c;
  }

  /** World space, the ball pass: trails, halos, bodies (by power), charge rings and the roster's names. */
  drawBodies(ctx: CanvasRenderingContext2D, view: TerritoryView, balls: readonly Ball[], o: TerritoryRenderOptions) {
    this.refreshLooks(view, o);
    const now = o.nowMs;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let labelled = 0;
    for (let i = 0; i < balls.length; i++) {
      const B = balls[i];
      const team = B.team !== undefined && B.team >= 0 && B.team < view.teams ? B.team : 0;
      const tb = this.teamBall(view, B);
      const power = tb ? tb.power : "none";
      const r = B.radius;
      const color = this.colorOf(team);
      const dashing = !!tb && power === "painter" && now < tb.dashUntilMs;
      // A short trail – its last TRAIL_POINTS positions (a painter's dash: a bright, wide streak).
      if ((o.showTrails || dashing) && B.trail.length > 1) {
        const len = B.trail.length;
        const from = Math.max(0, len - TRAIL_POINTS);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = this.rgba(team, dashing ? 0.8 : 0.3);
        ctx.lineWidth = Math.max(1, (dashing ? 1.5 : 0.8) * r * (o.trailThickness || 0.8));
        ctx.beginPath();
        for (let k = from; k < len; k++) {
          const p = B.trail[(B.trailIndex + k) % len];
          if (k === from) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }
      const haloR = (dashing ? 4.2 : 3.2) * r;
      ctx.globalAlpha = power === "ghost" ? 0.5 : 0.95;
      ctx.drawImage(this.haloSprite(color), B.x - haloR, B.y - haloR, 2 * haloR, 2 * haloR);
      ctx.globalAlpha = power === "ghost" ? 0.55 : 1;
      ctx.drawImage(this.bodySprite(color), B.x - r, B.y - r, 2 * r, 2 * r);
      ctx.globalAlpha = 1;
      if (power === "ghost") {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
        ctx.lineWidth = Math.max(1, 0.12 * r);
        ctx.setLineDash([0.35 * r, 0.3 * r]);
        ctx.beginPath();
        ctx.arc(B.x, B.y, 1.35 * r, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (tb && tb.armedMs > -Infinity && !view.finished && !view.ate) {
        // An armed bomber: a full ring flickering white – it blows on its next bounce off an enemy tile.
        const flicker = 0.5 + 0.5 * Math.sin((now - tb.armedMs) * 0.06);
        ctx.strokeStyle = ARMED_WHITE[Math.round(10 * flicker)];
        ctx.lineWidth = Math.max(1.2, (0.18 + 0.1 * flicker) * r);
        ctx.beginPath();
        ctx.arc(B.x, B.y, (1.45 + 0.15 * flicker) * r, 0, TWO_PI);
        ctx.stroke();
      } else if (tb && (power === "bomber" || power === "vortex" || power === "painter") && !view.finished && !view.ate) {
        // The charge ring: how far the next trigger is (white when it is about to fire).
        const every = 1000 * view.settings.powerEvery;
        const since = tb.lastPowerMs > -Infinity ? now - tb.lastPowerMs : now + every - tb.nextPowerMs;
        const charge = Math.max(0, Math.min(1, since / every));
        ctx.strokeStyle = charge > 0.85 ? "rgba(255, 255, 255, 0.95)" : this.rgba(team, 0.9);
        ctx.lineWidth = Math.max(1, 0.16 * r);
        ctx.beginPath();
        ctx.arc(B.x, B.y, 1.45 * r, -Math.PI / 2, -Math.PI / 2 + TWO_PI * charge);
        ctx.stroke();
      }
      const bit = 1 << team;
      if (o.showNames && o.roster.length > 0 && !(labelled & bit)) {
        labelled |= bit;
        const fs = Math.max(9, 0.95 * r);
        ctx.font = this.font(fs, 800);
        ctx.lineWidth = Math.max(2, 0.22 * fs);
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
        const name = this.nameOf(team);
        ctx.strokeText(name, B.x, B.y - 1.6 * r - 0.5 * fs);
        ctx.fillStyle = color;
        ctx.fillText(name, B.x, B.y - 1.6 * r - 0.5 * fs);
      }
    }
    ctx.restore();
  }

  private teamBall(view: TerritoryView, B: Ball) {
    const balls = view.balls;
    if (balls.length === 0) return null;
    const k = B.id - balls[0].id;
    return k >= 0 && k < balls.length && balls[k].id === B.id ? balls[k] : null;
  }

  /**
   * The world offset (px) of the latest bomber blast's jolt at simulation time `nowMs` on a canvas whose shorter side is
   * `minDim`, written into `out` – false (and `out` zeroed) when no blast is shaking the board. Counts the jolts in `jolts`.
   */
  blastJolt(view: TerritoryView, nowMs: number, minDim: number, out: { x: number; y: number }): boolean {
    out.x = 0;
    out.y = 0;
    const shocks = view.shocks;
    if (shocks.length === 0) return false;
    const s = shocks[shocks.length - 1];
    const age = nowMs - s.t0;
    if (!(age >= 0) || age >= SHAKE_DECAY_MS) return false;
    if (s.seed !== this.joltSeed) {
      this.joltSeed = s.seed;
      this.jolts++;
    }
    shakeOffset(age, shakeAmplitude(TY_BLAST_SHAKE, minDim), s.seed, out);
    return true;
  }

  /* ------------------------------------------------------------------ screen space */

  /**
   * Screen space, the HUD band at the top of the square the recorder exports: the badge, PICK A SIDE, the countdown, the
   * VS line and the percentage bar – and, without a team roster (`teamBanner` false), the winner banner and its confetti.
   * `inset` moves the band below the page's overlay buttons (live, on a nearly square canvas); `dtMs` eases the bar and
   * advances the confetti (0 while paused); `badgeRight` – the teams scoreboard takes the top-left corner (the HUD is off
   * then) – moves the badge to the top-right one. Returns the screen y the top captions start below: the band's bottom
   * with the HUD, the badge's when it reaches into the captions' centred column, else 0.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: TerritoryView, o: TerritoryRenderOptions, frame: { inset: number; dtMs: number; teamBanner: boolean; badgeRight?: boolean }): number {
    this.refreshLooks(view, o);
    const f = view.field;
    const S = f.side;
    const L = o.labels;
    const top = f.sqTop + frame.inset;
    const margin = 0.03 * S;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    tilePercentages(view.counts, view.teams, this.pct);
    // The bar eases toward the counts (at once when a run starts).
    if (view.generation !== this.shownGeneration) {
      this.shownGeneration = view.generation;
      for (let t = 0; t < view.teams; t++) this.shown[t] = view.total > 0 ? view.counts[t] / view.total : 0;
    } else {
      const k = 1 - Math.exp(-Math.max(0, frame.dtMs) / 160);
      for (let t = 0; t < view.teams; t++) this.shown[t] += ((view.total > 0 ? view.counts[t] / view.total : 0) - this.shown[t]) * k;
    }
    if (frame.inset > 0) {
      // Live, below the page's buttons: a dark backing so the HUD reads over the top rows of the board.
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(f.sqLeft, top, S, f.hudHeight);
    }
    this.badgeDrawn = view.settings.badge;
    this.badgeRight = !!frame.badgeRight;
    if (view.settings.badge) this.drawBadge(ctx, this.badgeRight ? f.sqLeft + S - margin : f.sqLeft + margin, top + 0.35 * margin, S, L, this.badgeRight);
    this.hudDrawn = view.settings.hud;
    if (view.settings.hud) this.drawHud(ctx, view, top, S, o);
    let topBottom = this.hudDrawn ? top + f.hudHeight : 0;
    if (this.badgeDrawn && inCaptionColumn(this.badgeX, this.badgeW, f.sqLeft + S / 2, S)) topBottom = Math.max(topBottom, this.badgeBottom);
    this.bannerDrawn = false;
    if (view.finished && !frame.teamBanner && o.nowMs - view.finishedMs >= BANNER_DELAY_MS) {
      if (this.bannerGeneration !== view.generation) {
        this.bannerGeneration = view.generation;
        this.spawnConfetti(f.sqLeft, f.sqTop, S, view.winner);
      }
      this.drawBanner(ctx, view, f.sqLeft + S / 2, f.gy + 0.5 * f.gridH, S, o);
      this.bannerDrawn = true;
    } else if (!view.finished) this.bannerGeneration = -1;
    this.stepConfetti(ctx, frame.dtMs / 1000, S);
    ctx.restore();
    return topBottom;
  }

  /** The warning badge with its top-left corner at (x, y) – or, `right`, its top-right corner. */
  private drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, L: TerritoryLabels, right = false) {
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

  /** PICK A SIDE, the countdown, "VORTEX 52% VS BOMBER 48%" and the percentage bar. */
  private drawHud(ctx: CanvasRenderingContext2D, view: TerritoryView, top: number, S: number, o: TerritoryRenderOptions) {
    const f = view.field;
    const L = o.labels;
    const cx = f.sqLeft + S / 2;
    const margin = 0.03 * S;
    // Row 1: PICK A SIDE (centre) and the countdown (right; red and pulsing in the finale).
    const fs1 = Math.max(8, 0.022 * S);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.font = this.font(fs1, 800);
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    const row1 = top + 0.35 * margin + 0.9 * fs1;
    ctx.fillText(L.pickSide, cx, row1);
    const leftMs = Math.max(0, view.durationMs - o.nowMs);
    const secs = view.finished ? 0 : Math.ceil(leftMs / 1000 - 1e-9);
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    const pulse = view.finale && !view.finished ? 0.5 + 0.5 * Math.sin(o.nowMs * 0.012) : 0;
    const fsClock = fs1 * (1.25 + 0.15 * pulse);
    ctx.textAlign = "right";
    ctx.font = this.font(fsClock, 900);
    ctx.fillStyle = view.finale && !view.finished ? `rgba(255, ${Math.round(80 + 60 * (1 - pulse))}, ${Math.round(80 + 60 * (1 - pulse))}, 1)` : "#ffffff";
    ctx.fillText(clock, f.sqLeft + S - margin, row1);
    // Row 2: the VS line, each team in its colour, shrunk to fit the field's width.
    const fs2 = Math.max(10, 0.04 * S);
    const vs = ` ${L.vs} `;
    ctx.font = this.font(fs2, 900);
    let width = 0;
    for (let t = 0; t < view.teams; t++) {
      width += ctx.measureText(`${hudName(view, t, this.nameOf(t), L)} ${this.pct[t]}%`).width;
      if (t > 0) width += ctx.measureText(vs).width;
    }
    const scale = width > f.gridW ? f.gridW / width : 1;
    const row2 = top + 0.09 * S;
    ctx.save();
    ctx.translate(cx - (width * scale) / 2, row2);
    ctx.scale(scale, scale);
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 0.12 * fs2);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    let x = 0;
    for (let t = 0; t < view.teams; t++) {
      if (t > 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.strokeText(vs, x, 0);
        ctx.fillText(vs, x, 0);
        x += ctx.measureText(vs).width;
      }
      const text = `${hudName(view, t, this.nameOf(t), L)} ${this.pct[t]}%`;
      // The leader glows: its text over a soft, wider stroke in its colour (no shadow blur).
      if (view.leader === t && !view.finished) {
        ctx.save();
        ctx.lineWidth = Math.max(4, 0.32 * fs2);
        ctx.strokeStyle = this.rgba(t, 0.35);
        ctx.strokeText(text, x, 0);
        ctx.restore();
      } else ctx.strokeText(text, x, 0);
      ctx.fillStyle = this.colorOf(t);
      ctx.fillText(text, x, 0);
      x += ctx.measureText(text).width;
    }
    ctx.restore();
    // Row 3: the bar, a segment per team (eased), a white notch between them.
    const barH = Math.max(4, 0.022 * S);
    const barY = top + 0.133 * S - barH / 2;
    const barX = f.gx;
    const barW = f.gridW;
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    roundRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fill();
    ctx.save();
    roundRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.clip();
    let sum = 0;
    for (let t = 0; t < view.teams; t++) sum += Math.max(0, this.shown[t]);
    let bx = barX;
    for (let t = 0; t < view.teams; t++) {
      const w = sum > 0 ? (barW * Math.max(0, this.shown[t])) / sum : barW / view.teams;
      ctx.fillStyle = this.colorOf(t);
      ctx.fillRect(bx, barY, w + 0.5, barH);
      if (t > 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillRect(bx - 1, barY, 2, barH);
      }
      bx += w;
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    ctx.fillRect(barX, barY, barW, barH * 0.4);
    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D, view: TerritoryView, cx: number, cy: number, side: number, o: TerritoryRenderOptions) {
    const L = o.labels;
    const k = Math.min(1, Math.max(0, o.nowMs - view.finishedMs - BANNER_DELAY_MS) / 280);
    const pop = k >= 1 ? 1 : 0.6 + 0.4 * k + 0.15 * Math.sin(k * Math.PI);
    const winner = view.winner;
    const title = winner >= 0 ? `🏆 ${L.wins(this.nameOf(winner))}` : L.draw;
    const color = winner >= 0 ? this.colorOf(winner) : "#ffffff";
    const sub = winner >= 0 ? L.share(this.pct[winner] ?? 0) : "";
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
    const n = CONFETTI_MAX;
    for (let i = 0; i < n; i++) {
      this.cx[i] = sx + side * (0.2 + 0.6 * Math.random());
      this.cy[i] = sy + side * (0.45 + 0.1 * Math.random());
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = side * (0.5 + 0.9 * Math.random());
      this.cvx[i] = Math.cos(a) * v;
      this.cvy[i] = Math.sin(a) * v;
      this.crot[i] = Math.random() * TWO_PI;
      this.cspin[i] = (Math.random() - 0.5) * 14;
      this.clife[i] = 1.8 + 1.2 * Math.random();
      this.ccolor[i] = i % 3 === 0 ? 255 : winner >= 0 && Math.random() < 0.6 ? winner : Math.floor(Math.random() * Math.max(1, this.looks.length));
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
}

/* ------------------------------------------------------------------ data attributes (tools and the smoke test) */

export const TERRITORY_DATA_KEYS = [
  "tyTeams",
  "tyCols",
  "tyRows",
  "tyBalls",
  "tyCounts",
  "tyPct",
  "tyConversions",
  "tyTileBounces",
  "tyWallBounces",
  "tyPegHits",
  "tyWhirls",
  "tyBlasts",
  "tyDashes",
  "tyGhostBlocks",
  "tyNotes",
  "tyLeader",
  "tyLeadChanges",
  "tyFinale",
  "tyFinished",
  "tyWinner",
  "tyWinnerName",
  "tyTie",
  "tyRig",
  "tyShields",
  "tyPowers",
  "tyRepaints",
  "tyPops",
  "tyBadge",
  "tyBadgeRight",
  "tyHud",
  "tyBanner",
  "tyInField",
  "tyJolts",
  "tyBallTiles",
] as const;

const pctScratch: number[] = [];

/** Mirrors the battle onto the canvas element (data-ty-*): the board, the counts and percentages, the powers' work, the verdict, the rig and what was drawn. */
export function writeTerritoryDataset(view: TerritoryView, layer: TerritoryLayer, balls: readonly Ball[], set: (key: string, value: string) => void) {
  const f = view.field;
  set("tyTeams", String(view.teams));
  set("tyCols", String(view.cols));
  set("tyRows", String(view.rows));
  set("tyBalls", String(view.balls.length));
  set("tyCounts", Array.from(view.counts.subarray(0, view.teams)).join(","));
  set("tyPct", tilePercentages(view.counts, view.teams, pctScratch).join(","));
  set("tyConversions", String(view.conversions));
  set("tyTileBounces", String(view.tileBounces));
  set("tyWallBounces", String(view.wallBounces));
  set("tyPegHits", String(view.pegHits));
  set("tyWhirls", String(view.whirls));
  set("tyBlasts", String(view.blasts));
  set("tyDashes", String(view.dashes));
  set("tyGhostBlocks", String(view.ghostBlocks));
  set("tyNotes", String(view.notes));
  set("tyLeader", String(view.leader));
  set("tyLeadChanges", String(view.leadChanges));
  set("tyFinale", view.finale ? "1" : "0");
  set("tyFinished", view.finished ? "1" : "0");
  set("tyWinner", String(view.winner));
  set("tyWinnerName", view.finished && view.winner >= 0 ? layer.nameOf(view.winner) : "");
  set("tyTie", view.tie ? "1" : "0");
  set("tyRig", String(view.forcedWinner));
  set("tyShields", String(view.shields));
  set("tyPowers", view.settings.powers.slice(0, view.teams).join(","));
  set("tyRepaints", String(layer.repaints));
  set("tyPops", String(layer.pops));
  set("tyBadge", layer.badgeDrawn ? "1" : "0");
  set("tyBadgeRight", layer.badgeDrawn && layer.badgeRight ? "1" : "0");
  set("tyHud", layer.hudDrawn ? "1" : "0");
  set("tyBanner", layer.bannerDrawn ? "1" : "0");
  // Every ball's whole disc on the board (±0.5 px), and the biggest ball's radius in tiles (uncap-all: the Ball Size however big).
  let inField = true;
  let biggest = 0;
  for (const b of balls) {
    const r = b.radius;
    if (b.x - r < f.gx - 0.5 || b.x + r > f.gx + f.gridW + 0.5 || b.y - r < f.gy - 0.5 || b.y + r > f.gy + f.gridH + 0.5) inField = false;
    if (r > biggest) biggest = r;
  }
  set("tyInField", inField ? "1" : "0");
  set("tyJolts", String(layer.jolts));
  set("tyBallTiles", f.tile > 0 ? (biggest / f.tile).toFixed(2) : "0");
}
