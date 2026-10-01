import type { Ball } from "@/lib/physics/types";
import { MZ_E, MZ_N, MZ_S, MZ_W, mazeWallH, mazeWallV } from "@/lib/physics/mazeGrid";
import { MZ_PALETTE, mazeBallName, mazeProgress, type MazeView } from "@/lib/physics/modes/maze";
import type { TeamEntry } from "@/lib/teams";
import { inCaptionColumn } from "@/lib/captions";

/**
 * Canvas drawing of the Maze escape mode (feature odd-maze; lib/physics/modes/maze.ts), one `MazeLayer` per draw loop,
 * called at fixed points of the frame by Canvas.tsx:
 *
 *  - `drawStage()` (world space, under the balls): the near-black field, the painted trail ("blood": every cell and
 *    passage a ball went through, stamped incrementally into a layer of its own), the glowing walls (drawn once per maze
 *    into a cached layer: merged wall runs with a soft glow, the red entrance chute and slot, the exit chevron), the walls
 *    flaring where they were just hit, and the fog over the cells no ball has visited (a clear circle travels with every
 *    ball);
 *  - `drawBodies()` (world space, the ball pass): soft colour halos and glossy bodies, the names of a team roster;
 *  - `drawOverlay()` (screen space, inside the square the recorder exports): the "FLASHING LIGHTS – THE END GETS
 *    INTENSE" badge, the HUD – a distance-to-exit bar per ball – and the verdict banner with its deadpan caption (with a
 *    roster the teams banner takes over once the run is finished).
 *
 * Visual only: it reads the view and never writes to the engine. The cached layers are rebuilt only when the maze, the
 * canvas size or a colour changes; steady-state frames allocate nothing but the HUD's few number strings.
 */

export interface MazeLabels {
  /** The HUD title: "MAZE". */
  title: string;
  badgeTop: string;
  badgeBottom: string;
  /** The finishing place in the HUD, short: "#[place]". */
  out: (place: number) => string;
  /** "[name] ESCAPED" – the first ball through the exit. */
  wins: (name: string) => string;
  /** "in [seconds]s". */
  time: (seconds: string) => string;
  /** The clip limit came with nobody out: "TIME'S UP" and "[name] got closest". */
  timeUp: string;
  closest: (name: string) => string;
  /** The deadpan caption under the banner. */
  caption: string;
  /** Name of an unnamed roster team: "Team 3". */
  team: (n: number) => string;
}

export const DEFAULT_MAZE_LABELS: MazeLabels = {
  title: "MAZE",
  badgeTop: "FLASHING LIGHTS",
  badgeBottom: "THE END GETS INTENSE",
  out: (place) => `#${place}`,
  wins: (name) => `${name} ESCAPED`,
  time: (seconds) => `in ${seconds}s`,
  timeUp: "TIME'S UP",
  closest: (name) => `${name} got closest`,
  caption: "who else thought that was blood",
  team: (n) => `Team ${n}`,
};

export interface MazeRenderOptions {
  /** Device pixel ratio of the canvas. */
  dpr: number;
  /** The team roster (its colours and names play the first balls); empty = the palette. */
  roster: readonly TeamEntry[];
  /** Names above the balls (a roster's "ball names" switch). */
  showNames: boolean;
  /** The walls glow where they were just hit (the Visual section's Wall Glow). */
  showWallGlow: boolean;
  labels: MazeLabels;
  /** Simulation time now (ms). */
  nowMs: number;
  /** Canvas size in CSS px. */
  width: number;
  height: number;
}

const TWO_PI = Math.PI * 2;
/** The smallest font (CSS px) the badge and the HUD shrink to while they make room for the maze (a tiny canvas: the export scales it up). */
const MIN_OVERLAY_FONT = 4;
/** How long a wall flares after a hit (simulation ms). */
const HIT_GLOW_MS = 320;
/** The fog's clear circle around a ball, in cells. */
const FOG_RADIUS = 2.6;
const BANNER_DELAY_MS = 200;
const FIELD_FILL = "#050807";
const ENTRANCE_RED = "#ff2b3a";

function hexRgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

interface Look {
  color: string;
  name: string;
  /** rgba strings at alpha 0, 0.05 … 1. */
  alpha: string[];
}

interface Layer {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  key: string;
}

export class MazeLayer {
  private looks: Look[] = [];
  private looksKey = "";
  private readonly halo = new Map<string, HTMLCanvasElement>();
  private readonly fonts = new Map<number, string>();
  private readonly drawn: (Ball | null)[] = [];
  private walls: Layer | null = null;
  private paint: Layer | null = null;
  private paintStamped = 0;
  private fog: Layer | null = null;
  private fogData: ImageData | null = null;
  /** The box (CSS px) the cached layers cover: the maze, the chute above it and a margin for the glow. */
  private readonly box = { x: 0, y: 0, w: 0, h: 0 };
  /** The widest place tag of the HUD ("#8"), for the labels it was made with. */
  private tagLabels: MazeLabels | null = null;
  private tagText = "";
  /** The widest palette name at the HUD's font size (the cap of the name column), for the size it was measured at. */
  private paletteWidth = 0;
  private paletteWidthKey = -1;
  /** Where the badge and the HUD were drawn this frame (CSS px), for the captions that start below them. */
  private badgeX = 0;
  private badgeW = 0;
  private badgeBottom = 0;
  private hudX = 0;
  private hudW = 0;
  private hudBottom = 0;
  // Mirrored onto the canvas as data-mz-* for tools and the smoke test.
  badgeDrawn = false;
  hudDrawn = false;
  /** The badge and the HUD stayed off the maze and its entrance chute this frame. */
  clear = true;
  bannerDrawn = false;
  fogDrawn = false;
  /** Paint strokes stamped into the trail layer this run, and wall flares drawn this frame. */
  stamped = 0;
  flares = 0;

  /* ------------------------------------------------------------------ looks */

  private refreshLooks(view: MazeView, o: MazeRenderOptions) {
    let key = `${view.count}|`;
    for (let i = 0; i < Math.min(o.roster.length, view.teamCount); i++) key += `${o.roster[i].color}:${o.roster[i].name};`;
    if (key === this.looksKey) return;
    this.looksKey = key;
    const looks: Look[] = [];
    for (let i = 0; i < view.count; i++) {
      const team = i < o.roster.length && i < view.teamCount ? o.roster[i] : null;
      const color = team ? team.color : MZ_PALETTE[i % MZ_PALETTE.length].color;
      const rgb = hexRgb(color);
      const alpha: string[] = [];
      for (let k = 0; k <= 20; k++) alpha.push(`rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(k / 20).toFixed(2)})`);
      looks.push({ color, alpha, name: team ? team.name || o.labels.team(i + 1) : mazeBallName(i) });
    }
    this.looks = looks;
  }

  /** The colour a ball is drawn in (the roster's or the palette's). */
  colorOf(slot: number): string {
    return this.looks[slot]?.color ?? MZ_PALETTE[((slot % MZ_PALETTE.length) + MZ_PALETTE.length) % MZ_PALETTE.length].color;
  }

  /** The name a ball goes by (the roster's or the palette's). */
  nameOf(slot: number): string {
    return this.looks[slot]?.name ?? mazeBallName(slot);
  }

  private rgba(slot: number, a: number): string {
    const look = this.looks[slot];
    if (!look) return `rgba(255, 255, 255, ${a})`;
    return look.alpha[Math.max(0, Math.min(20, Math.round(a * 20)))];
  }

  private font(px: number, weight = 800): string {
    const size = Math.max(3, Math.round(px)); // (3 px: the corner items' smallest lines on a tiny canvas)
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
      s.width = 96;
      s.height = 96;
      const g = s.getContext("2d");
      if (g) {
        const [r, gg, b] = hexRgb(color);
        const grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
        grad.addColorStop(0, `rgba(${r}, ${gg}, ${b}, 0.6)`);
        grad.addColorStop(0.35, `rgba(${r}, ${gg}, ${b}, 0.22)`);
        grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 96, 96);
      }
      if (this.halo.size > 32) this.halo.clear();
      this.halo.set(color, s);
    }
    return s;
  }

  /** The id → ball map of this frame (the camera's slow motion may hand over balls drawn between two steps). */
  private mapBalls(view: MazeView, balls: readonly Ball[]) {
    this.drawn.length = view.count;
    for (let i = 0; i < view.count; i++) this.drawn[i] = null;
    const first = view.runners[0]?.id ?? 0;
    for (let i = 0; i < balls.length; i++) {
      const slot = balls[i].id - first;
      if (slot >= 0 && slot < view.count && view.runners[slot].id === balls[i].id) this.drawn[slot] = balls[i];
    }
  }

  /* ------------------------------------------------------------------ cached layers */

  private layer(prev: Layer | null, w: number, h: number): Layer | null {
    if (typeof document === "undefined") return null;
    const canvas = prev?.canvas ?? document.createElement("canvas");
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const g = prev?.g ?? canvas.getContext("2d");
    if (!g) return null;
    return { canvas, g, key: prev?.key ?? "" };
  }

  /** The cached layers' box for the current field (CSS px): the maze, the chute above, a margin for the glow. */
  private updateBox(view: MazeView) {
    const f = view.field;
    const pad = Math.max(6, 3 * f.wall);
    this.box.x = f.left - pad;
    this.box.y = f.top - f.cell - pad;
    this.box.w = f.width + 2 * pad;
    this.box.h = f.height + f.cell + 2 * pad;
  }

  private ensureWalls(view: MazeView, o: MazeRenderOptions) {
    const f = view.field;
    const key = `${view.generation}|${f.left.toFixed(2)}|${f.top.toFixed(2)}|${f.cell.toFixed(3)}|${o.dpr}|${view.settings.wallColor}`;
    if (this.walls && this.walls.key === key) return;
    const W = Math.max(1, Math.ceil(this.box.w * o.dpr));
    const H = Math.max(1, Math.ceil(this.box.h * o.dpr));
    const layer = this.layer(this.walls, W, H);
    if (!layer) return;
    layer.key = key;
    this.walls = layer;
    const g = layer.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.setTransform(o.dpr, 0, 0, o.dpr, -this.box.x * o.dpr, -this.box.y * o.dpr);
    const grid = view.grid;
    const s = f.cell;
    const color = view.settings.wallColor;
    const strokeWalls = () => {
      g.beginPath();
      for (let j = 0; j <= grid.rows; j++) {
        let start = -1;
        for (let c = 0; c <= grid.cols; c++) {
          const on = c < grid.cols && mazeWallH(grid, c, j);
          if (on && start < 0) start = c;
          else if (!on && start >= 0) {
            g.moveTo(f.left + start * s, f.top + j * s);
            g.lineTo(f.left + c * s, f.top + j * s);
            start = -1;
          }
        }
      }
      for (let i = 0; i <= grid.cols; i++) {
        let start = -1;
        for (let r = 0; r <= grid.rows; r++) {
          const on = r < grid.rows && mazeWallV(grid, i, r);
          if (on && start < 0) start = r;
          else if (!on && start >= 0) {
            g.moveTo(f.left + i * s, f.top + start * s);
            g.lineTo(f.left + i * s, f.top + r * s);
            start = -1;
          }
        }
      }
      g.stroke();
    };
    g.lineCap = "round";
    g.lineJoin = "round";
    // The glow: a wide soft pass under the crisp lines.
    g.strokeStyle = color;
    g.globalAlpha = 0.35;
    g.lineWidth = f.wall * 1.6;
    g.shadowColor = color;
    g.shadowBlur = Math.max(4, 1.6 * f.wall) * o.dpr;
    strokeWalls();
    g.shadowBlur = 0;
    g.globalAlpha = 1;
    g.lineWidth = f.wall;
    strokeWalls();
    // The entrance: a red chute above the slot in the top wall, glowing.
    const ex0 = f.left + grid.entranceCol * s;
    const ex1 = ex0 + s;
    g.fillStyle = "rgba(255, 43, 58, 0.1)";
    g.fillRect(ex0, f.top - s, s, s);
    g.strokeStyle = ENTRANCE_RED;
    g.shadowColor = ENTRANCE_RED;
    g.shadowBlur = Math.max(4, 2 * f.wall) * o.dpr;
    g.lineWidth = f.wall;
    g.beginPath();
    g.moveTo(ex0, f.top);
    g.lineTo(ex0, f.top - s);
    g.lineTo(ex1, f.top - s);
    g.lineTo(ex1, f.top);
    g.stroke();
    g.setLineDash([Math.max(1, 0.12 * s), Math.max(1, 0.1 * s)]);
    g.globalAlpha = 0.7;
    g.beginPath();
    g.moveTo(ex0 + f.wall, f.top);
    g.lineTo(ex1 - f.wall, f.top);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    // The exit: a chevron under the gap in the bottom wall.
    const cx = f.left + (grid.exitCol + 0.5) * s;
    const by = f.top + f.height;
    const k = Math.min(0.28 * s, 0.9 * (this.box.y + this.box.h - by));
    if (k > 1) {
      g.strokeStyle = color;
      g.globalAlpha = 0.8;
      g.lineWidth = Math.max(1, 0.6 * f.wall);
      g.beginPath();
      g.moveTo(cx - k, by + 0.25 * k);
      g.lineTo(cx, by + 0.85 * k);
      g.lineTo(cx + k, by + 0.25 * k);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  private trailColor(view: MazeView, slot: number): string {
    return view.settings.trailOwn ? this.colorOf(slot) : view.settings.trailColor;
  }

  private ensurePaint(view: MazeView, o: MazeRenderOptions) {
    const f = view.field;
    const key = `${view.generation}|${f.left.toFixed(2)}|${f.top.toFixed(2)}|${f.cell.toFixed(3)}|${o.dpr}|${view.settings.trailOwn ? this.looksKey : view.settings.trailColor}`;
    const W = Math.max(1, Math.ceil(this.box.w * o.dpr));
    const H = Math.max(1, Math.ceil(this.box.h * o.dpr));
    if (!this.paint || this.paint.key !== key) {
      const layer = this.layer(this.paint, W, H);
      if (!layer) return;
      layer.key = key;
      this.paint = layer;
      layer.g.setTransform(1, 0, 0, 1, 0, 0);
      layer.g.clearRect(0, 0, W, H);
      this.paintStamped = 0;
    }
    if (this.paintStamped > view.paintCount) {
      // A new run in the same maze size (the count went back): start over.
      this.paint.g.setTransform(1, 0, 0, 1, 0, 0);
      this.paint.g.clearRect(0, 0, W, H);
      this.paintStamped = 0;
    }
    if (this.paintStamped === view.paintCount) return;
    const g = this.paint.g;
    g.setTransform(o.dpr, 0, 0, o.dpr, -this.box.x * o.dpr, -this.box.y * o.dpr);
    const grid = view.grid;
    const s = f.cell;
    const m = f.wall / 2 + 0.14 * s; // the paint keeps clear of the walls: a band down the corridors
    const e = 1 / o.dpr; // the connectors overlap the cells by a device pixel: no seams where the rectangles meet
    for (let i = this.paintStamped; i < view.paintCount; i++) {
      const cell = view.paint[3 * i];
      const from = view.paint[3 * i + 1];
      const slot = view.paint[3 * i + 2];
      const col = cell % grid.cols;
      const row = (cell - col) / grid.cols;
      const x0 = f.left + col * s;
      const y0 = f.top + row * s;
      g.fillStyle = this.trailColor(view, slot);
      g.fillRect(x0 + m, y0 + m, s - 2 * m, s - 2 * m);
      if (from < 0) {
        g.fillRect(x0 + m, y0 - m, s - 2 * m, 2 * m + e); // from the chute, through the slot
        continue;
      }
      const fc = from % grid.cols;
      const fr = (from - fc) / grid.cols;
      if (fr === row) {
        const xe = f.left + Math.max(col, fc) * s; // the shared edge
        g.fillRect(xe - m - e, y0 + m, 2 * m + 2 * e, s - 2 * m);
      } else {
        const ye = f.top + Math.max(row, fr) * s;
        g.fillRect(x0 + m, ye - m - e, s - 2 * m, 2 * m + 2 * e);
      }
    }
    this.paintStamped = view.paintCount;
    this.stamped = view.paintCount;
  }

  /** The fog: one pixel per cell, alpha over the cells no ball has visited, cleared around every ball; scaled up smoothly. */
  private drawFog(ctx: CanvasRenderingContext2D, view: MazeView) {
    const grid = view.grid;
    const f = view.field;
    const W = grid.cols;
    const H = grid.rows;
    if (!this.fog || this.fog.canvas.width !== W || this.fog.canvas.height !== H || !this.fogData || this.fogData.width !== W || this.fogData.height !== H) {
      const layer = this.layer(this.fog, W, H);
      if (!layer) return;
      this.fog = layer;
      this.fogData = layer.g.createImageData(W, H);
    }
    const data = this.fogData!.data;
    const full = Math.round(255 * Math.max(0, Math.min(1, view.settings.fog)));
    for (let i = 0; i < grid.cells; i++) {
      const p = 4 * i;
      data[p] = 3;
      data[p + 1] = 6;
      data[p + 2] = 5;
      data[p + 3] = view.visitedAny[i] ? 0 : full;
    }
    const R = FOG_RADIUS;
    const reach = Math.ceil(R);
    for (let k = 0; k < view.count; k++) {
      const b = this.drawn[k];
      const r = view.runners[k];
      if (!b || !r || r.exited) continue;
      const bc = (b.x - f.left) / f.cell;
      const br = (b.y - f.top) / f.cell;
      const c0 = Math.max(0, Math.floor(bc) - reach);
      const c1 = Math.min(W - 1, Math.floor(bc) + reach);
      const r0 = Math.max(0, Math.floor(br) - reach);
      const r1 = Math.min(H - 1, Math.floor(br) + reach);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const d = Math.hypot(col + 0.5 - bc, row + 0.5 - br) / R;
          if (d >= 1) continue;
          const p = 4 * (row * W + col) + 3;
          const keep = d * d; // clear at the ball, fog again at the circle's edge
          const a = Math.round(full * keep);
          if (a < data[p]) data[p] = a;
        }
      }
    }
    this.fog!.g.putImageData(this.fogData!, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fog!.canvas, f.left, f.top, f.width, f.height);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ world space */

  /** World space, under the balls: the field, the trail, the walls (and their flares) and the fog. */
  drawStage(ctx: CanvasRenderingContext2D, view: MazeView, balls: readonly Ball[], o: MazeRenderOptions) {
    this.refreshLooks(view, o);
    this.mapBalls(view, balls);
    this.updateBox(view);
    const f = view.field;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = FIELD_FILL;
    ctx.fillRect(f.left - f.wall, f.top - f.wall, f.width + 2 * f.wall, f.height + 2 * f.wall);
    // The trail.
    if (view.settings.trail > 0) {
      this.ensurePaint(view, o);
      if (this.paint) {
        ctx.globalAlpha = Math.min(1, view.settings.trail); // (uncap-all: a trail past 1 is fully opaque – the canvas ignores an alpha past 1)
        ctx.drawImage(this.paint.canvas, this.box.x, this.box.y, this.box.w, this.box.h);
        ctx.globalAlpha = 1;
      }
    } else this.stamped = view.paintCount;
    // The walls.
    this.ensureWalls(view, o);
    if (this.walls) ctx.drawImage(this.walls.canvas, this.box.x, this.box.y, this.box.w, this.box.h);
    // Flares where the walls were just hit.
    this.flares = 0;
    if (o.showWallGlow) this.drawFlares(ctx, view, o.nowMs);
    // The fog over the unvisited cells.
    this.fogDrawn = view.settings.fog > 0;
    if (this.fogDrawn) this.drawFog(ctx, view);
    ctx.restore();
  }

  private drawFlares(ctx: CanvasRenderingContext2D, view: MazeView, nowMs: number) {
    const f = view.field;
    const s = f.cell;
    ctx.lineCap = "round";
    ctx.strokeStyle = view.settings.wallColor;
    ctx.fillStyle = view.settings.wallColor;
    const n = Math.min(view.hits.length, view.hitCount);
    for (let i = 0; i < n; i++) {
      const h = view.hits[i];
      const age = nowMs - h.t;
      if (age < 0 || age >= HIT_GLOW_MS) continue;
      const k = 1 - age / HIT_GLOW_MS;
      this.flares++;
      const x0 = f.left + h.col * s;
      const y0 = f.top + h.row * s;
      ctx.globalAlpha = 0.9 * k * k;
      if (h.dir === 4) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, (0.4 + 0.3 * k) * s * 0.35, 0, TWO_PI);
        ctx.fill();
        continue;
      }
      ctx.lineWidth = f.wall * (1.8 + 1.6 * k);
      ctx.beginPath();
      if (h.dir === MZ_N || h.dir === MZ_S) {
        const y = h.dir === MZ_N ? y0 : y0 + s;
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + s, y);
      } else if (h.dir === MZ_W || h.dir === MZ_E) {
        const x = h.dir === MZ_W ? x0 : x0 + s;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + s);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** World space, the ball pass: halos, glossy bodies and – with a roster's ball names – the names. */
  drawBodies(ctx: CanvasRenderingContext2D, view: MazeView, o: MazeRenderOptions) {
    ctx.save();
    for (let k = 0; k < view.count; k++) {
      const b = this.drawn[k];
      if (!b) continue;
      const color = this.colorOf(k);
      const r = b.radius;
      const halo = this.haloSprite(color);
      const hs = r * 6;
      ctx.globalAlpha = 1;
      ctx.drawImage(halo, b.x - hs / 2, b.y - hs / 2, hs, hs);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.beginPath();
      ctx.arc(b.x - 0.3 * r, b.y - 0.3 * r, 0.35 * r, 0, TWO_PI);
      ctx.fill();
      if (o.showNames && k < o.roster.length && k < view.teamCount) {
        const fs = Math.max(9, 1.6 * r);
        ctx.font = this.font(fs, 800);
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = Math.max(2, 0.18 * fs);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
        ctx.strokeText(this.nameOf(k), b.x, b.y - 1.6 * r);
        ctx.fillStyle = this.rgba(k, 1);
        ctx.fillText(this.nameOf(k), b.x, b.y - 1.6 * r);
      }
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ screen space */

  /**
   * Screen space, inside the square the recorder exports: the warning badge (top left), the HUD (top right) and the verdict
   * banner – until the run is over when a roster is on (`teamBanner`: the teams banner announces the winner then). `inset`
   * moves the corner items below the page's overlay buttons; `badgeRight` – the teams scoreboard takes the top-left corner
   * (the HUD is off then) – moves the badge to the top-right one. Returns the screen y of the lowest top item that reaches
   * into the captions' centred column (0: none), which the top captions start below.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: MazeView, o: MazeRenderOptions, frame: { inset: number; teamBanner: boolean; badgeRight?: boolean }): number {
    const side = Math.min(o.width, o.height);
    const sx = (o.width - side) / 2;
    const sy = (o.height - side) / 2;
    const margin = Math.max(6, 0.018 * side);
    // The maze and its entrance chute, with the walls' glow and a little air: the corner items never cover them (they
    // shrink into the bands beside the maze column; the camera's zoom may still bring the maze under them).
    const f = view.field;
    const air = Math.max(4, 2 * f.wall) + Math.max(2, 0.006 * side);
    const mazeLeft = f.left - air;
    const mazeRight = f.left + f.width + air;
    const chuteLeft = f.left + view.grid.entranceCol * f.cell - air;
    const chuteRight = chuteLeft + f.cell + 2 * air;
    const chuteTop = f.top - f.cell - air;
    const top = sy + frame.inset + margin;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    this.badgeDrawn = view.settings.badge;
    const badgeRight = !!frame.badgeRight;
    if (view.settings.badge) {
      // Room beside the maze (the band) or, above the maze, beside the chute when the badge reaches down to it.
      const room = (bottom: number) =>
        badgeRight
          ? sx + side - margin - (bottom > f.top - air ? mazeRight : bottom > chuteTop ? chuteRight : -Infinity)
          : (bottom > f.top - air ? mazeLeft : bottom > chuteTop ? chuteLeft : Infinity) - (sx + margin);
      this.drawBadge(ctx, badgeRight ? sx + side - margin : sx + margin, top, side, o.labels, badgeRight, room);
    }
    this.hudDrawn = view.settings.hud;
    if (view.settings.hud) this.drawHud(ctx, view, sx + side - margin, top, side, o.labels, sx + side - margin - mazeRight);
    // Whether they stayed off the maze and its chute (data-mz-clear; only a canvas too small for their smallest font fails).
    const covers = (x: number, w: number, bottom: number) =>
      (x < f.left + f.width && x + w > f.left && bottom > f.top && top < f.top + f.height) ||
      (x < chuteLeft + f.cell + air && x + w > chuteLeft + air && bottom > f.top - f.cell && top < f.top);
    this.clear = !(this.badgeDrawn && covers(this.badgeX, this.badgeW, this.badgeBottom)) && !(this.hudDrawn && covers(this.hudX, this.hudW, this.hudBottom));
    // The corner items the top captions have to start below.
    let topBottom = 0;
    if (this.badgeDrawn && inCaptionColumn(this.badgeX, this.badgeW, sx + side / 2, side)) topBottom = this.badgeBottom;
    if (this.hudDrawn && inCaptionColumn(this.hudX, this.hudW, sx + side / 2, side)) topBottom = Math.max(topBottom, this.hudBottom);
    this.bannerDrawn = false;
    // (with a roster the teams banner announces a team's win once the run is over; a ball past the six teams keeps this one)
    if (view.verdict !== "" && !(frame.teamBanner && view.finished && view.winner < view.teamCount) && o.nowMs - view.verdictMs >= BANNER_DELAY_MS) {
      this.drawBanner(ctx, view, sx + side / 2, sy + side * 0.46, side, o);
      this.bannerDrawn = true;
    }
    ctx.restore();
    return topBottom;
  }

  /**
   * The warning badge with its top-left corner at (x, y) – or, `right`, its top-right corner. `room(bottom)` is the width it
   * may take when it reaches down to `bottom` (the band beside the maze, or beside the entrance chute): a wider badge shrinks.
   */
  private drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, L: MazeLabels, right: boolean, room: (bottom: number) => number) {
    let fs = Math.max(7, 0.016 * side);
    let small = 0;
    let w1 = 0;
    let w2 = 0;
    let icon = 0;
    let pad = 0;
    let w = 0;
    let h = 0;
    for (let pass = 0; pass < 3; pass++) {
      small = 0.78 * fs;
      ctx.font = this.font(fs, 900);
      w1 = ctx.measureText(L.badgeTop).width;
      ctx.font = this.font(small, 700);
      w2 = ctx.measureText(L.badgeBottom).width;
      icon = 1.9 * fs;
      pad = 0.55 * fs;
      w = pad * 3 + icon + Math.max(w1, w2);
      h = pad * 2 + fs + 1.15 * small;
      const max = room(y + h);
      if (pass === 2 || w <= max || fs <= MIN_OVERLAY_FONT) break;
      fs = Math.max(MIN_OVERLAY_FONT, 0.97 * fs * (max / w)); // every width scales with the font (rounded: a pass more)
    }
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

  /** Width of the widest palette name at the HUD's font size `fs` (the font must be set), cached per size. */
  private paletteNameWidth(ctx: CanvasRenderingContext2D, fs: number): number {
    const key = Math.round(fs * 100);
    if (this.paletteWidthKey !== key) {
      let w = 0;
      for (const p of MZ_PALETTE) w = Math.max(w, ctx.measureText(p.name).width);
      this.paletteWidthKey = key;
      this.paletteWidth = w;
    }
    return this.paletteWidth;
  }

  /** The HUD with its top-right corner at (right, top), at most `maxW` wide (the band beside the maze: a wider HUD shrinks). */
  private drawHud(ctx: CanvasRenderingContext2D, view: MazeView, right: number, top: number, side: number, L: MazeLabels, maxW: number) {
    // Narrow enough for the band beside the maze column (about a fifth of the square) with eight balls – and made to fit it.
    let fs = Math.max(7, 0.0145 * side);
    if (this.tagLabels !== L) {
      this.tagLabels = L;
      this.tagText = L.out(8);
    }
    let nameW = 0;
    let tagW = 0;
    let titleFs = 0;
    let w = 0;
    for (let pass = 0; pass < 3; pass++) {
      ctx.font = this.font(fs, 800);
      nameW = 0;
      for (let i = 0; i < view.count; i++) nameW = Math.max(nameW, ctx.measureText(this.nameOf(i)).width);
      nameW = Math.min(nameW, this.paletteNameWidth(ctx, fs)); // every palette name (HOTPINK…) fits; a longer roster name is clipped
      ctx.font = this.font(0.85 * fs, 800);
      tagW = Math.max(ctx.measureText(this.tagText).width, ctx.measureText("000").width);
      titleFs = 1.05 * fs;
      ctx.font = this.font(titleFs, 900);
      const titleW = ctx.measureText(L.title).width;
      const rowW = 1.1 * fs + nameW + 0.5 * fs + 2.4 * fs + 0.5 * fs + tagW;
      w = 1.1 * fs + Math.max(rowW, titleW);
      if (pass === 2 || w <= maxW || fs <= MIN_OVERLAY_FONT) break;
      fs = Math.max(MIN_OVERLAY_FONT, 0.97 * fs * (Math.max(0, maxW) / w)); // every width scales with the font (rounded: a pass more)
    }
    const rowH = 1.45 * fs;
    const pad = 0.55 * fs;
    const barW = 2.4 * fs;
    const barH = 0.42 * fs;
    const h = pad * 2 + 1.5 * titleFs + view.count * rowH;
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
      const r = view.runners[i];
      if (!r) continue;
      const winner = view.winner === i;
      let cx = x + pad + 0.4 * fs;
      ctx.fillStyle = this.colorOf(i);
      ctx.beginPath();
      ctx.arc(cx, y, 0.4 * fs, 0, TWO_PI);
      ctx.fill();
      cx += 0.7 * fs;
      ctx.font = this.font(fs, 800);
      ctx.fillStyle = winner ? "#facc15" : "#f4f4f5";
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, y - rowH / 2, nameW, rowH);
      ctx.clip();
      ctx.fillText(this.nameOf(i), cx, y);
      ctx.restore();
      cx += nameW + 0.5 * fs;
      // The distance-to-exit bar: full at the exit.
      const p = r.exited ? 1 : mazeProgress(r.dist, view.entranceDist);
      ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
      roundRect(ctx, cx, y - barH / 2, barW, barH, barH / 2);
      ctx.fill();
      if (p > 0) {
        ctx.fillStyle = this.rgba(i, 0.95);
        roundRect(ctx, cx, y - barH / 2, Math.max(barH, barW * p), barH, barH / 2);
        ctx.fill();
      }
      cx += barW + 0.6 * fs;
      ctx.textAlign = "right";
      ctx.font = this.font(0.85 * fs, 800);
      ctx.fillStyle = r.exited ? "#facc15" : "rgba(255, 255, 255, 0.7)";
      ctx.fillText(r.exited ? L.out(r.place) : String(Math.max(0, r.dist)), x + w - pad, y);
      ctx.textAlign = "left";
      y += rowH;
    }
  }

  private drawBanner(ctx: CanvasRenderingContext2D, view: MazeView, cx: number, cy: number, side: number, o: MazeRenderOptions) {
    const L = o.labels;
    const k = Math.min(1, Math.max(0, o.nowMs - view.verdictMs - BANNER_DELAY_MS) / 260);
    const pop = k >= 1 ? 1 : 0.6 + 0.4 * k + 0.15 * Math.sin(k * Math.PI);
    const winner = view.winner;
    const name = winner >= 0 ? this.nameOf(winner) : "";
    const title = view.verdict === "time" ? L.timeUp : L.wins(name);
    const sub = view.verdict === "time" ? L.closest(name) : L.time((view.verdictMs / 1000).toFixed(1));
    const color = winner >= 0 ? this.colorOf(winner) : "#ffffff";
    let fs = Math.max(18, 0.07 * side);
    ctx.font = this.font(fs, 900);
    const tw = ctx.measureText(title).width;
    if (tw > 0.86 * side) fs *= (0.86 * side) / tw;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.font = this.font(fs, 900);
    ctx.lineWidth = Math.max(3, 0.14 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(title, 0, 0);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.fillText(title, 0, 0);
    ctx.shadowBlur = 0;
    const sfs = 0.42 * fs;
    ctx.font = this.font(sfs, 700);
    ctx.lineWidth = Math.max(2, 0.16 * sfs);
    ctx.strokeText(sub, 0, 0.95 * fs);
    ctx.fillStyle = "#e4e4e7";
    ctx.fillText(sub, 0, 0.95 * fs);
    // The deadpan caption.
    const cfs = 0.36 * fs;
    ctx.font = `italic ${this.font(cfs, 600)}`;
    ctx.lineWidth = Math.max(2, 0.16 * cfs);
    ctx.strokeText(L.caption, 0, 1.75 * fs);
    ctx.fillStyle = "rgba(228, 228, 231, 0.75)";
    ctx.fillText(L.caption, 0, 1.75 * fs);
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ data-mz-* (tools and the smoke test) */

export const MAZE_DATA_KEYS = [
  "mzBalls",
  "mzCols",
  "mzRows",
  "mzEntrance",
  "mzExit",
  "mzBrain",
  "mzVisited",
  "mzPaint",
  "mzStamped",
  "mzExited",
  "mzWinner",
  "mzWinnerName",
  "mzVerdict",
  "mzVerdictMs",
  "mzFinished",
  "mzDist",
  "mzPlaces",
  "mzNotes",
  "mzContacts",
  "mzLeaks",
  "mzRig",
  "mzSealed",
  "mzSlowMos",
  "mzFog",
  "mzBadge",
  "mzHud",
  "mzBanner",
  "mzClear",
  "mzGeneration",
];

export function writeMazeDataset(view: MazeView, layer: MazeLayer, set: (key: string, value: string) => void) {
  let dist = "";
  let places = "";
  for (let i = 0; i < view.runners.length; i++) {
    dist += `${i > 0 ? "," : ""}${view.runners[i].dist}`;
    places += `${i > 0 ? "," : ""}${view.runners[i].place}`;
  }
  set("mzBalls", String(view.count));
  set("mzCols", String(view.grid.cols));
  set("mzRows", String(view.grid.rows));
  set("mzEntrance", String(view.grid.entranceCol));
  set("mzExit", String(view.grid.exitCol));
  set("mzBrain", view.settings.brain);
  set("mzVisited", String(view.visitedCells));
  set("mzPaint", String(view.paintCount));
  set("mzStamped", String(layer.stamped));
  set("mzExited", String(view.exited));
  set("mzWinner", String(view.winner));
  set("mzWinnerName", view.winner >= 0 ? layer.nameOf(view.winner) : "");
  set("mzVerdict", view.verdict);
  set("mzVerdictMs", String(Math.round(view.verdictMs)));
  set("mzFinished", view.finished ? "1" : "0");
  set("mzDist", dist);
  set("mzPlaces", places);
  set("mzNotes", String(view.notes));
  set("mzContacts", String(view.contacts));
  set("mzLeaks", String(view.leaks));
  set("mzRig", String(view.forcedWinner));
  set("mzSealed", String(view.sealed));
  set("mzSlowMos", String(view.slowMos));
  set("mzFog", layer.fogDrawn ? "1" : "0");
  set("mzBadge", layer.badgeDrawn ? "1" : "0");
  set("mzHud", layer.hudDrawn ? "1" : "0");
  set("mzBanner", layer.bannerDrawn ? "1" : "0");
  set("mzClear", layer.clear ? "1" : "0");
  set("mzGeneration", String(view.generation));
}
