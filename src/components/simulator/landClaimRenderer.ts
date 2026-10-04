import type { Ball } from "@/lib/physics/types";
import { wobbleEnvelope } from "@/lib/physics/wobble";
import { flagCodeOf } from "@/lib/countries";
import { LC_FLY_LOG, LC_FLY_MS, LC_POP_LOG, LC_POP_MS, blockCentre, blockCorners, lcPaletteColor, lcPaletteName, type LandClaimField, type LandClaimView } from "@/lib/physics/modes/landClaim";
import type { TeamEntry } from "@/lib/teams";

/**
 * Canvas drawing of Land Claim (feature land-claim; lib/physics/modes/landClaim.ts), one `LandClaimLayer` per draw loop,
 * called at fixed points of the frame by Canvas.tsx:
 *
 *  - `drawStage()` (world space, under the balls): the arena – its dark floor and every block of its columns, kept in an
 *    offscreen canvas in device pixels that is repainted only where a column changed (the mode counts the changes of every
 *    column, `colVersion`), the blocks batched into one path per colour; a block smaller than a few device pixels is drawn
 *    without its gaps and a column too fine for its rows as runs of one colour (no limit on the wall: a million blocks draw
 *    as a few thousand runs) –, the wall's outline (flashing in the winner's colour at the verdict), the blocks a claim or
 *    a steal just recoloured (a springy pop) and the knocked blocks flying off in the hitter's colour;
 *  - `drawBodies()` (world space, the ball pass): short trails, a glow and a badge per ball – a roster flag drawn as its
 *    emoji inside a ring in the competitor's colour (its two-letter code on a disc where the fonts have no flag glyphs,
 *    `flagGlyphsSupported()`), another roster emoji the same way, else a glossy disc –, the names of a roster; a crowd of
 *    hundreds draws without the glow and past a thousand as plain discs, one path per colour;
 *  - `drawOverlay()` (screen space, the HUD band at the top of the square the recorder exports): the title line, the
 *    counters (blocks left or steals, balls, the clock) and a live bar per competitor – its badge, its name, its land and
 *    its balls in play (past eight competitors the leaders and "+N MORE") – and, at the verdict, the banner: DOMINATION,
 *    SUCH A CLOSE BATTLE or "[name] CLAIMS THE MOST" with the winner's share; without a roster to name the winner (the teams
 *    banner does it with one) it names the winner too and throws the confetti.
 *
 * Visual only: it reads the view and never writes to the engine. The pops and the flying blocks run on the simulation clock
 * (a pause freezes them, a recording replays them); the bars' easing and the confetti are decoration. Steady-state frames
 * allocate nothing but the few strings of the HUD: colours, sprites and fonts are cached.
 */

export interface LandClaimLabels {
  /** The title line when the settings have none: "LAND CLAIM". */
  title: string;
  domination: string;
  close: string;
  /** "[name] CLAIMS THE MOST". */
  claims: (name: string) => string;
  /** "[name] WINS" (the banner's second line without a roster). */
  wins: (name: string) => string;
  /** "[pct]% OF THE LAND". */
  share: (pct: number) => string;
  /** The banner when nobody took a block. */
  noLand: string;
  /** Counters: "[n] BLOCKS LEFT", "[n] STEALS", "[n] BALLS". */
  left: (n: number) => string;
  steals: (n: number) => string;
  balls: (n: number) => string;
  /** The HUD's last row past eight competitors: "+[n] MORE". */
  more: (n: number) => string;
  /** Name of an unnamed roster team or a competitor past the palette: "Team 13". */
  team: (n: number) => string;
}

export const DEFAULT_LAND_CLAIM_LABELS: LandClaimLabels = {
  title: "LAND CLAIM",
  domination: "DOMINATION",
  close: "SUCH A CLOSE BATTLE",
  claims: (name) => `${name} CLAIMS THE MOST`,
  wins: (name) => `${name} WINS`,
  share: (pct) => `${pct}% OF THE LAND`,
  noLand: "NO LAND CLAIMED",
  left: (n) => `${n} BLOCKS LEFT`,
  steals: (n) => `${n} STEALS`,
  balls: (n) => `${n} BALLS`,
  more: (n) => `+${n} MORE`,
  team: (n) => `Team ${n}`,
};

export interface LandClaimRenderOptions {
  /** Device pixels per world pixel. */
  dpr: number;
  /** The team roster (its colours, names and flags play the first competitors); empty = the palette. */
  roster: readonly TeamEntry[];
  /** Names above the balls (a roster's "ball names" switch). */
  showNames: boolean;
  showTrails: boolean;
  wallThickness: number;
  labels: LandClaimLabels;
  /** Simulation time now (ms). */
  nowMs: number;
}

const TWO_PI = Math.PI * 2;
const CONFETTI_MAX = 160;
const BANNER_DELAY_MS = 250;
/** The arena's floor, the neutral blocks (two shades, alternate rows) and their colour drawn as runs. */
const FLOOR = "#0a0c12";
const NEUTRAL_A = "#d8dce5";
const NEUTRAL_B = "#c3c9d4";
/** HUD rows at most (past it the leaders and "+N MORE"). */
const HUD_ROWS = 8;
/** Sprites kept per kind (badges, glows); past it the cache starts over. */
const SPRITE_CACHE_MAX = 96;
/** Past this many balls no glow; past CROWD_BALLS plain discs, one path per colour. */
const MANY_BALLS = 400;
const CROWD_BALLS = 1200;
/** Trails only up to this many balls, their last TRAIL_POINTS positions. */
const TRAIL_BALLS = 200;
const TRAIL_POINTS = 6;
const EMOJI_FONT = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif`;
const TEXT_FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

function hexRgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

/** The arena's wall: a polygon's corners lie at `field.start + k·2π/n` at the circumradius, the circle is its apothem. */
function circumradius(f: LandClaimField): number {
  return f.sides > 0 ? f.apothem / Math.cos(Math.PI / f.sides) : f.apothem;
}

/** Appends the wall's outline scaled to `apothem` around (ox, oy) to the current path of `g`. */
function wallPath(g: CanvasRenderingContext2D | Path2D, f: LandClaimField, ox: number, oy: number, apothem: number) {
  if (f.sides > 0) {
    const rc = apothem / Math.cos(Math.PI / f.sides);
    for (let k = 0; k < f.sides; k++) {
      const a = f.start + (k * TWO_PI) / f.sides;
      if (k === 0) g.moveTo(ox + rc * Math.cos(a), oy + rc * Math.sin(a));
      else g.lineTo(ox + rc * Math.cos(a), oy + rc * Math.sin(a));
    }
    g.closePath();
  } else {
    g.moveTo(ox + apothem, oy);
    g.arc(ox, oy, apothem, 0, TWO_PI);
    g.closePath();
  }
}

/* ------------------------------------------------------------------ flag glyphs */

let flagGlyphState: boolean | null = null;

/**
 * Whether this browser's fonts draw a flag emoji as a flag – measured once: a flag glyph drawn in black paints saturated
 * colours and is about one glyph wide, where a font without flag glyphs draws its two regional-indicator letters in the
 * fill colour (as wide as two letters). Without a DOM (or a 2D context that can be read) the badges fall back to the
 * two-letter code.
 */
export function flagGlyphsSupported(): boolean {
  if (flagGlyphState !== null) return flagGlyphState;
  let supported = false;
  try {
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 48;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (g) {
        g.font = `32px ${EMOJI_FONT}`;
        g.textAlign = "left";
        g.textBaseline = "middle";
        const flag = "\u{1F1EB}\u{1F1F7}";
        const flagWidth = g.measureText(flag).width;
        const letterWidth = g.measureText("F").width;
        g.fillStyle = "#000000";
        g.fillText(flag, 4, 24);
        const data = g.getImageData(0, 0, c.width, c.height).data;
        let coloured = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 120) continue;
          const hi = Math.max(data[i], data[i + 1], data[i + 2]);
          const lo = Math.min(data[i], data[i + 1], data[i + 2]);
          if (hi - lo > 70) coloured++;
        }
        supported = coloured >= 24 && flagWidth < 2.6 * Math.max(1, letterWidth);
      }
    }
  } catch {
    supported = false;
  }
  flagGlyphState = supported;
  return supported;
}

/* ------------------------------------------------------------------ the layer */

/** The look of one competitor: colour, the shade of its alternate rows, name, badge. */
interface Look {
  color: string;
  shade: string;
  name: string;
  /** The roster emoji ("" none) and, when it is a flag, its two-letter code. */
  emoji: string;
  code: string;
  /** rgba strings at alpha 0, 0.05 … 1. */
  alpha: string[];
}

/** What a competitor's badge is: a flag glyph, its code on a disc (no flag glyphs), another emoji, or a plain disc. */
export type LcBadgeKind = "f" | "c" | "e" | "d";

export class LandClaimLayer {
  private looks: Look[] = [];
  private looksKey = "";
  private lookRoster: readonly TeamEntry[] | null = null;
  private lookTeams = -1;
  private lookLabels: LandClaimLabels | null = null;
  /** The offscreen arena (device pixels): its floor and blocks, what it was built for, and the column versions it shows. */
  private layer: HTMLCanvasElement | null = null;
  private layerCtx: CanvasRenderingContext2D | null = null;
  private layerKey = "";
  private layerR = 0;
  private layerW = 0;
  private drawnVersion = new Uint32Array(0);
  private repaintGeneration = -1;
  private paths: (Path2D | null)[] = [];
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly glows = new Map<string, HTMLCanvasElement>();
  private readonly fonts = new Map<number, string>();
  private readonly corners = new Float64Array(8);
  private readonly mid = { x: 0, y: 0 };
  /** The bars' eased lengths (0–1) and the run they belong to; the HUD's order past HUD_ROWS competitors. */
  private shown = new Float64Array(0);
  private shownGeneration = -1;
  private order = new Int32Array(HUD_ROWS);
  private labelled = new Uint8Array(0);
  /** A crowd's balls per competitor (plain discs): the first ball of each and the next of each ball. */
  private crowdHead = new Int32Array(0);
  private crowdNext = new Int32Array(0);
  // Confetti (screen space).
  private readonly cx = new Float32Array(CONFETTI_MAX);
  private readonly cy = new Float32Array(CONFETTI_MAX);
  private readonly cvx = new Float32Array(CONFETTI_MAX);
  private readonly cvy = new Float32Array(CONFETTI_MAX);
  private readonly crot = new Float32Array(CONFETTI_MAX);
  private readonly cspin = new Float32Array(CONFETTI_MAX);
  private readonly clife = new Float32Array(CONFETTI_MAX);
  private readonly cteam = new Int32Array(CONFETTI_MAX);
  private confetti = 0;
  private bannerGeneration = -1;
  /** For tools and the smoke test: columns repainted this run, blocks in flight and pops drawn last frame, what the overlay drew. */
  repaints = 0;
  flying = 0;
  pops = 0;
  hudDrawn = false;
  bannerDrawn = false;
  title = "";
  /** How the balls were drawn last frame: 0 sprites with glows, 1 sprites, 2 plain discs. */
  lod = 0;
  /** The blocks were drawn as runs (too small for their gaps) when the arena was last painted. */
  runs = false;

  /** The colour of competitor `team` this frame (the roster's, else the palette's). */
  colorOf(team: number): string {
    return this.looks[team]?.color ?? lcPaletteColor(team);
  }

  /** The name of competitor `team` (the roster's, "Team 3" for an unnamed roster team, else the palette's). */
  nameOf(team: number): string {
    return this.looks[team]?.name ?? (lcPaletteName(team) || DEFAULT_LAND_CLAIM_LABELS.team(team + 1));
  }

  /** The badge competitor `team` wears. */
  badgeOf(team: number): LcBadgeKind {
    const look = this.looks[team];
    if (!look || !look.emoji) return "d";
    if (look.code) return flagGlyphsSupported() ? "f" : "c";
    return "e";
  }

  private font(size: number, weight: number): string {
    const px = Math.max(6, Math.round(size));
    const key = px * 1000 + weight;
    let f = this.fonts.get(key);
    if (!f) {
      f = `${weight} ${px}px ${TEXT_FONT}`;
      this.fonts.set(key, f);
    }
    return f;
  }

  private rgba(team: number, a: number): string {
    const look = this.looks[team];
    if (!look) return `rgba(255, 255, 255, ${a})`;
    return look.alpha[Math.max(0, Math.min(20, Math.round(a * 20)))];
  }

  /** Rebuilds the competitors' looks when the roster, the competitor count or the labels changed. */
  private refreshLooks(view: LandClaimView, o: LandClaimRenderOptions) {
    if (o.roster === this.lookRoster && view.teams === this.lookTeams && o.labels === this.lookLabels) return;
    this.lookRoster = o.roster;
    this.lookTeams = view.teams;
    this.lookLabels = o.labels;
    let key = `${view.teams}`;
    for (let i = 0; i < Math.min(o.roster.length, view.teams); i++) key += `|${o.roster[i].color}|${o.roster[i].name}|${o.roster[i].emoji}`;
    if (key === this.looksKey) return;
    this.looksKey = key;
    this.looks = [];
    for (let t = 0; t < view.teams; t++) {
      const entry = t < o.roster.length ? o.roster[t] : null;
      const color = entry ? entry.color : lcPaletteColor(t);
      const name = entry ? entry.name || o.labels.team(t + 1) : lcPaletteName(t) || o.labels.team(t + 1);
      const emoji = entry ? entry.emoji : "";
      const [r, g, b] = hexRgb(color);
      const alpha: string[] = [];
      for (let k = 0; k <= 20; k++) alpha.push(`rgba(${r}, ${g}, ${b}, ${(k / 20).toFixed(2)})`);
      const dim = (c: number) => Math.round(0.78 * c);
      this.looks.push({ color, shade: `rgb(${dim(r)}, ${dim(g)}, ${dim(b)})`, name, emoji, code: flagCodeOf(emoji), alpha });
    }
    if (this.shown.length < view.teams) this.shown = new Float64Array(view.teams);
    if (this.labelled.length < view.teams) this.labelled = new Uint8Array(view.teams);
    this.layerKey = "";
  }

  /* ------------------------------------------------------------------ world space */

  /** World space, under the balls: the arena (floor and blocks), the wall, the pops and the flying blocks. */
  drawStage(ctx: CanvasRenderingContext2D, view: LandClaimView, o: LandClaimRenderOptions) {
    this.refreshLooks(view, o);
    const f = view.field;
    const now = o.nowMs;
    this.paintArena(view, o.dpr);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (this.layer && this.layerW > 0) {
      const R = this.layerR;
      const pad = 1 / o.dpr;
      ctx.drawImage(this.layer, f.cx - R - pad, f.cy - R - pad, this.layerW / o.dpr, this.layerW / o.dpr);
    } else {
      ctx.fillStyle = FLOOR;
      ctx.beginPath();
      wallPath(ctx, f, f.cx, f.cy, f.apothem);
      ctx.fill();
    }
    // The wall: light grey, flashing in the winner's colour at the verdict.
    const since = view.finished ? now - view.finishedMs : Infinity;
    const flash = since >= 0 && since < 1400 ? (1 - since / 1400) * (0.6 + 0.4 * Math.cos(since * 0.012)) : 0;
    const winner = view.verdict.winner;
    ctx.beginPath();
    wallPath(ctx, f, f.cx, f.cy, f.apothem + 0.5 * Math.max(1.5, 0.8 * o.wallThickness));
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, 0.8 * o.wallThickness) + 4 * flash;
    ctx.strokeStyle = flash > 0.02 && winner >= 0 ? this.colorOf(winner) : "rgba(225, 228, 236, 0.85)";
    if (flash > 0.02) {
      ctx.shadowColor = winner >= 0 ? this.colorOf(winner) : "#ffffff";
      ctx.shadowBlur = 24 * flash;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    // The pops and the flying blocks stay inside the wall.
    if ((view.rule !== "knock" && view.popCount > 0) || view.flyCount > 0) {
      ctx.save();
      ctx.beginPath();
      wallPath(ctx, f, f.cx, f.cy, f.apothem);
      ctx.clip();
      this.drawPops(ctx, view, now);
      this.drawFlying(ctx, view, now);
      ctx.restore();
    } else {
      this.pops = 0;
      this.flying = 0;
    }
    ctx.restore();
  }

  /** Keeps the offscreen arena in step with the view: rebuilt when the run, the arena, its size or the colours changed, else only the columns that changed. */
  private paintArena(view: LandClaimView, dpr: number) {
    if (typeof document === "undefined") return;
    const f = view.field;
    const R = circumradius(f);
    const W = Math.max(1, Math.ceil(2 * R * dpr) + 2);
    if (view.generation !== this.repaintGeneration) {
      this.repaintGeneration = view.generation;
      this.repaints = 0;
    }
    const key = `${view.generation}|${f.arena}|${f.cols}|${f.rows}|${W}|${f.apothem.toFixed(3)}|${view.rule}|${this.looksKey}`;
    let full = false;
    if (key !== this.layerKey || !this.layer || !this.layerCtx) {
      if (!this.layer) this.layer = document.createElement("canvas");
      if (this.layer.width !== W) this.layer.width = W;
      if (this.layer.height !== W) this.layer.height = W;
      this.layerCtx = this.layer.getContext("2d");
      this.layerKey = key;
      this.layerR = R;
      this.layerW = W;
      if (this.drawnVersion.length !== f.cols) this.drawnVersion = new Uint32Array(f.cols);
      full = true;
    }
    const g = this.layerCtx;
    if (!g) return;
    const ready = view.heights.length === view.cols && view.colVersion.length === view.cols && (view.rule === "knock" || view.owner.length >= view.total);
    // Centre-relative world coordinates onto the layer's device pixels (a pixel of margin all round).
    g.setTransform(dpr, 0, 0, dpr, R * dpr + 1, R * dpr + 1);
    if (full) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, W);
      g.restore();
      g.fillStyle = FLOOR;
      g.beginPath();
      wallPath(g, f, 0, 0, f.apothem);
      g.fill();
      if (!ready) return;
      this.paintColumns(g, view, dpr, null);
      this.drawnVersion.set(view.colVersion);
      this.repaints += view.cols;
      return;
    }
    if (!ready) return;
    // Only the columns whose blocks changed: their cells back to the floor, then their blocks.
    let dirty = 0;
    const versions = view.colVersion;
    const drawn = this.drawnVersion;
    for (let c = 0; c < view.cols; c++) if (drawn[c] !== versions[c]) dirty++;
    if (dirty === 0) return;
    this.paintColumns(g, view, dpr, drawn);
    for (let c = 0; c < view.cols; c++) drawn[c] = versions[c];
    this.repaints += dirty;
  }

  /**
   * Paints the columns into the layer – every column (`drawn` null: the floor is fresh) or those whose version moved from
   * `drawn` (their cells first back to the floor) –, the blocks batched into one path per colour (a neutral or a
   * competitor's, a shade for alternate rows). Blocks a few device pixels deep keep a gap between them; finer ones draw as
   * runs of one colour, sampled about once a device pixel down the column.
   */
  private paintColumns(g: CanvasRenderingContext2D, view: LandClaimView, dpr: number, drawn: Uint32Array | null) {
    const f = view.field;
    const rows = view.rows;
    const knock = view.rule === "knock";
    const blockPx = f.block * dpr;
    const runs = blockPx < 3;
    this.runs = runs;
    const insetR = blockPx >= 4 ? Math.max(1, 0.12 * blockPx) / (2 * dpr) : 0;
    const stride = runs && blockPx < 1 ? Math.max(1, Math.floor(1 / Math.max(1e-6, blockPx))) : 1;
    const buckets = 2 + 2 * view.teams;
    if (this.paths.length < buckets) this.paths.length = buckets;
    for (let b = 0; b < buckets; b++) this.paths[b] = null;
    const versions = view.colVersion;
    let clear: Path2D | null = null;
    for (let c = 0; c < view.cols; c++) {
      if (drawn && drawn[c] === versions[c]) continue;
      if (drawn) {
        clear = clear ?? new Path2D();
        this.appendCell(clear, f, c, 0, rows, 0, 0);
      }
      const colPx = this.columnWidth(f, c) * dpr;
      const insetC = colPx >= 4 ? Math.max(1, 0.1 * colPx) / (2 * dpr) : 0;
      const height = knock ? view.heights[c] : rows;
      if (height <= 0) continue;
      const base = c * rows;
      if (knock) {
        // Knock: the column's blocks are all neutral – one run, or a block a row.
        if (runs) this.appendCell(this.bucketPath(0), f, c, 0, height, insetC, 0);
        else for (let r = 0; r < height; r++) this.appendCell(this.bucketPath(r & 1), f, c, r, r + 1, insetC, insetR);
        continue;
      }
      if (!runs) {
        for (let r = 0; r < height; r++) {
          const owner = view.owner[base + r];
          this.appendCell(this.bucketPath(owner < 0 || owner >= view.teams ? r & 1 : 2 + 2 * owner + (r & 1)), f, c, r, r + 1, insetC, insetR);
        }
        continue;
      }
      // Runs of one owner, the column sampled every `stride` rows.
      let start = 0;
      let cur = view.owner[base];
      for (let r = stride; r < height; r += stride) {
        const owner = view.owner[base + r];
        if (owner === cur) continue;
        this.appendCell(this.bucketPath(cur < 0 || cur >= view.teams ? 0 : 2 + 2 * cur), f, c, start, r, insetC, 0);
        start = r;
        cur = owner;
      }
      this.appendCell(this.bucketPath(cur < 0 || cur >= view.teams ? 0 : 2 + 2 * cur), f, c, start, height, insetC, 0);
    }
    if (clear) {
      g.fillStyle = FLOOR;
      g.fill(clear);
    }
    for (let b = 0; b < buckets; b++) {
      const path = this.paths[b];
      if (!path) continue;
      g.fillStyle = b === 0 ? NEUTRAL_A : b === 1 ? NEUTRAL_B : (b & 1) === 0 ? this.colorOf((b - 2) >> 1) : (this.looks[(b - 2) >> 1]?.shade ?? this.colorOf((b - 2) >> 1));
      g.fill(path);
      this.paths[b] = null;
    }
  }

  private bucketPath(b: number): Path2D {
    let p = this.paths[b];
    if (!p) {
      p = new Path2D();
      this.paths[b] = p;
    }
    return p;
  }

  /** A column's width (world px) along the wall. */
  private columnWidth(f: LandClaimField, c: number): number {
    return f.sides > 0 ? Math.hypot(f.colX1[c] - f.colX0[c], f.colY1[c] - f.colY0[c]) : (f.colA1[c] - f.colA0[c]) * f.apothem;
  }

  /**
   * Appends rows `r0` … `r1` (exclusive; row 0 at the wall) of column `c` to `path`, centre-relative: a polygon's slice of
   * its side (the side's wall scaled about the centre), the circle's ring sector; inset by `insetC` along the wall and
   * `insetR` towards the centre (world px) for the gaps.
   */
  private appendCell(path: Path2D, f: LandClaimField, c: number, r0: number, r1: number, insetC: number, insetR: number) {
    const a = f.apothem;
    const ro = a - r0 * f.block - insetR;
    const ri = a - r1 * f.block + insetR;
    if (!(ro > ri) || !(ri >= 0)) return;
    if (f.sides > 0) {
      const ko = ro / a;
      const ki = ri / a;
      const x0 = f.colX0[c];
      const y0 = f.colY0[c];
      const ex = f.colX1[c] - x0;
      const ey = f.colY1[c] - y0;
      const len = Math.hypot(ex, ey);
      if (!(len > 0)) return;
      const to = Math.min(0.45, insetC / (len * ko));
      const ti = Math.min(0.45, insetC / Math.max(1e-9, len * ki));
      path.moveTo((x0 + ex * to) * ko, (y0 + ey * to) * ko);
      path.lineTo((x0 + ex * (1 - to)) * ko, (y0 + ey * (1 - to)) * ko);
      path.lineTo((x0 + ex * (1 - ti)) * ki, (y0 + ey * (1 - ti)) * ki);
      path.lineTo((x0 + ex * ti) * ki, (y0 + ey * ti) * ki);
      path.closePath();
    } else {
      const span = f.colA1[c] - f.colA0[c];
      const d = Math.min(0.45 * span, insetC / Math.max(1e-9, 0.5 * (ro + ri)));
      const a0 = f.colA0[c] + d;
      const a1 = f.colA1[c] - d;
      path.moveTo(ro * Math.cos(a0), ro * Math.sin(a0));
      path.arc(0, 0, ro, a0, a1);
      path.lineTo(ri * Math.cos(a1), ri * Math.sin(a1));
      path.arc(0, 0, ri, a1, a0, true);
      path.closePath();
    }
  }

  /** Claim / steal: the blocks just recoloured pop – a springy swell in the new colour, white at first. */
  private drawPops(ctx: CanvasRenderingContext2D, view: LandClaimView, now: number) {
    this.pops = 0;
    if (view.rule === "knock" || view.popCount === 0 || view.rows <= 0) return;
    const f = view.field;
    const q = this.corners;
    for (let n = 1; n <= view.popCount; n++) {
      const k = (view.popHead - n + LC_POP_LOG) % LC_POP_LOG;
      const age = now - view.popMs[k];
      if (age >= LC_POP_MS) break;
      if (age < 0) continue;
      const idx = view.popIdx[k];
      const col = Math.floor(idx / view.rows);
      const row = idx - col * view.rows;
      if (col < 0 || col >= view.cols) continue;
      const team = view.popTeam[k];
      const u = age / LC_POP_MS;
      blockCorners(f, col, row, q);
      const mx = 0.25 * (q[0] + q[2] + q[4] + q[6]);
      const my = 0.25 * (q[1] + q[3] + q[5] + q[7]);
      const grow = 1 + 0.16 * (1 - u) + 0.06 * wobbleEnvelope(age / 1000);
      ctx.beginPath();
      for (let j = 0; j < 4; j++) {
        const x = f.cx + mx + (q[2 * j] - mx) * grow;
        const y = f.cy + my + (q[2 * j + 1] - my) * grow;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = this.rgba(team, 0.75 * (1 - u));
      ctx.fill();
      if (u < 0.25) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 * (1 - u / 0.25)).toFixed(2)})`;
        ctx.fill();
      }
      this.pops++;
    }
  }

  /** Knock: the knocked blocks fly off towards the middle in the hitter's colour, spinning, falling a little and fading. */
  private drawFlying(ctx: CanvasRenderingContext2D, view: LandClaimView, now: number) {
    this.flying = 0;
    if (view.flyCount === 0) return;
    const f = view.field;
    const m = this.mid;
    const T = LC_FLY_MS / 1000;
    for (let n = 1; n <= view.flyCount; n++) {
      const k = (view.flyHead - n + LC_FLY_LOG) % LC_FLY_LOG;
      const age = now - view.flyMs[k];
      if (age >= LC_FLY_MS) break;
      if (age < 0) continue;
      const col = view.flyCol[k];
      const row = view.flyRow[k];
      if (col < 0 || col >= f.cols) continue;
      const u = age / LC_FLY_MS;
      const sec = age / 1000;
      blockCentre(f, col, row, m);
      // A brick of the block's area, at most twice as long as it is deep (a long thin slice reads as a stick, not a block).
      const kk = Math.max(0, (f.apothem - (row + 0.5) * f.block) / f.apothem);
      const area = Math.max(1, this.columnWidth(f, col) * kk * f.block);
      const ratio = Math.min(2, Math.max(1, (this.columnWidth(f, col) * kk) / Math.max(1e-6, f.block)));
      const h = Math.max(1, Math.sqrt(area / ratio));
      const w = Math.max(1, ratio * h);
      const dist = 0.9 * f.apothem * (sec - (0.5 * sec * sec) / T);
      const x = f.cx + m.x + view.flyVx[k] * dist;
      const y = f.cy + m.y + view.flyVy[k] * dist + 0.3 * f.apothem * sec * sec;
      const angle = Math.atan2(f.colY1[col] - f.colY0[col], f.colX1[col] - f.colX0[col]) + view.flySpin[k] * sec;
      const s = 1 - 0.45 * u;
      const hw = 0.5 * w * s;
      const hh = 0.5 * h * s;
      const cs = Math.cos(angle);
      const sn = Math.sin(angle);
      ctx.globalAlpha = Math.pow(1 - u, 1.4);
      ctx.beginPath();
      ctx.moveTo(x - hw * cs + hh * sn, y - hw * sn - hh * cs);
      ctx.lineTo(x + hw * cs + hh * sn, y + hw * sn - hh * cs);
      ctx.lineTo(x + hw * cs - hh * sn, y + hw * sn + hh * cs);
      ctx.lineTo(x - hw * cs - hh * sn, y - hw * sn + hh * cs);
      ctx.closePath();
      ctx.fillStyle = this.colorOf(view.flyTeam[k]);
      ctx.fill();
      if (u < 0.35 && hw > 2) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = Math.max(0.6, 0.12 * Math.min(hw, hh));
        ctx.stroke();
      }
      this.flying++;
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ balls */

  private glowSprite(color: string): HTMLCanvasElement {
    let c = this.glows.get(color);
    if (!c) {
      if (this.glows.size >= SPRITE_CACHE_MAX) this.glows.clear();
      c = document.createElement("canvas");
      c.width = c.height = 96;
      const g = c.getContext("2d")!;
      const [r, gg, b] = hexRgb(color);
      const grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
      grad.addColorStop(0, `rgba(${r}, ${gg}, ${b}, 0.6)`);
      grad.addColorStop(0.4, `rgba(${r}, ${gg}, ${b}, 0.22)`);
      grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 96, 96);
      this.glows.set(color, c);
    }
    return c;
  }

  /**
   * The badge of a look (128 px, the disc's radius 58 px): a flag or another emoji inside a ring in the competitor's colour,
   * the flag's two-letter code on a disc of its colour where the fonts have no flag glyphs, else a glossy disc.
   */
  private badgeSprite(look: Look): HTMLCanvasElement {
    const kind: LcBadgeKind = !look.emoji ? "d" : look.code ? (flagGlyphsSupported() ? "f" : "c") : "e";
    const key = `${kind}|${kind === "d" ? "" : kind === "c" ? look.code : look.emoji}|${look.color}`;
    let c = this.sprites.get(key);
    if (c) return c;
    if (this.sprites.size >= SPRITE_CACHE_MAX) this.sprites.clear();
    c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const [r, gg, b] = hexRgb(look.color);
    const light = `rgb(${Math.min(255, r + 90)}, ${Math.min(255, gg + 90)}, ${Math.min(255, b + 90)})`;
    if (kind === "d" || kind === "c") {
      const grad = g.createRadialGradient(48, 44, 4, 64, 64, 60);
      grad.addColorStop(0, kind === "d" ? "#ffffff" : light);
      grad.addColorStop(kind === "d" ? 0.3 : 0.45, light);
      grad.addColorStop(1, look.color);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(64, 64, 58, 0, TWO_PI);
      g.fill();
      g.strokeStyle = "rgba(255, 255, 255, 0.9)";
      g.lineWidth = 6;
      g.stroke();
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
      g.arc(64, 64, 58, 0, TWO_PI);
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
      g.strokeStyle = look.color;
      g.lineWidth = 9;
      g.beginPath();
      g.arc(64, 64, 58, 0, TWO_PI);
      g.stroke();
    }
    this.sprites.set(key, c);
    return c;
  }

  /** World space, the ball pass: trails, glows, badges and the roster's names (a crowd as plain discs, one path per colour). */
  drawBodies(ctx: CanvasRenderingContext2D, view: LandClaimView, balls: readonly Ball[], o: LandClaimRenderOptions) {
    this.refreshLooks(view, o);
    const n = balls.length;
    const teams = Math.max(1, view.teams);
    this.lod = n > CROWD_BALLS ? 2 : n > MANY_BALLS ? 1 : 0;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (this.lod === 2) {
      // A crowd: plain discs, one path per competitor (a list per competitor through the balls, no allocation).
      if (this.crowdHead.length < teams) this.crowdHead = new Int32Array(teams);
      if (this.crowdNext.length < n) this.crowdNext = new Int32Array(Math.max(n, 2 * this.crowdNext.length));
      this.crowdHead.fill(-1, 0, teams);
      for (let i = n - 1; i >= 0; i--) {
        const bt = balls[i].team;
        const t = bt !== undefined && bt >= 0 && bt < teams ? bt : 0;
        this.crowdNext[i] = this.crowdHead[t];
        this.crowdHead[t] = i;
      }
      for (let t = 0; t < teams; t++) {
        let i = this.crowdHead[t];
        if (i < 0) continue;
        ctx.beginPath();
        for (; i >= 0; i = this.crowdNext[i]) {
          const B = balls[i];
          ctx.moveTo(B.x + B.radius, B.y);
          ctx.arc(B.x, B.y, B.radius, 0, TWO_PI);
        }
        ctx.fillStyle = this.colorOf(t);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    const trails = o.showTrails && n <= TRAIL_BALLS;
    if (o.showNames && o.roster.length > 0) this.labelled.fill(0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      const B = balls[i];
      const team = B.team !== undefined && B.team >= 0 && B.team < teams ? B.team : 0;
      const r = B.radius;
      const look = this.looks[team];
      const color = this.colorOf(team);
      if (trails && B.trail.length > 1) {
        const len = B.trail.length;
        const from = Math.max(0, len - TRAIL_POINTS);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = this.rgba(team, 0.3);
        ctx.lineWidth = Math.max(1, 0.8 * r);
        ctx.beginPath();
        for (let k = from; k < len; k++) {
          const p = B.trail[(B.trailIndex + k) % len];
          if (k === from) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }
      if (this.lod === 0) {
        const glowR = 3 * r;
        ctx.drawImage(this.glowSprite(color), B.x - glowR, B.y - glowR, 2 * glowR, 2 * glowR);
      }
      // The badge's disc (radius 58 of 128) is the ball.
      const s = (r * 128) / 58;
      if (look) ctx.drawImage(this.badgeSprite(look), B.x - s / 2, B.y - s / 2, s, s);
      else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(B.x, B.y, r, 0, TWO_PI);
        ctx.fill();
      }
      if (o.showNames && o.roster.length > 0 && team < this.labelled.length && !this.labelled[team]) {
        this.labelled[team] = 1;
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

  /* ------------------------------------------------------------------ screen space */

  /**
   * Screen space, the HUD band at the top of the square the recorder exports: the title, the counters and a bar per
   * competitor – and, at the verdict, the banner (with the winner's name and the confetti unless `teamBanner`: the teams
   * layer names the roster's winner below it and throws its own). `inset` moves the band below the page's overlay buttons
   * (live, on a nearly square canvas); `dtMs` eases the bars and advances the confetti (0 while paused). Returns the screen y
   * the top captions start below: the band's bottom with the HUD, else 0.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: LandClaimView, balls: number, o: LandClaimRenderOptions, frame: { inset: number; dtMs: number; teamBanner: boolean }): number {
    this.refreshLooks(view, o);
    const f = view.field;
    const S = f.side;
    const top = f.sqTop + frame.inset;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    this.easeBars(view, frame.dtMs);
    this.title = (view.settings.title || o.labels.title).toUpperCase();
    this.hudDrawn = view.settings.hud;
    if (this.hudDrawn) {
      if (frame.inset > 0) {
        // Live, below the page's buttons: a dark backing so the HUD reads over the top of the arena.
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.fillRect(f.sqLeft, top, S, f.hudHeight);
      }
      this.drawHud(ctx, view, balls, top, S, o);
    }
    this.bannerDrawn = false;
    if (view.finished && !view.ate && o.nowMs - view.finishedMs >= BANNER_DELAY_MS) {
      if (this.bannerGeneration !== view.generation) {
        this.bannerGeneration = view.generation;
        if (!frame.teamBanner) this.spawnConfetti(f.sqLeft, f.sqTop, S, view.verdict.winner, view.teams);
      }
      // (above the teams banner when it names the winner – it sits low in the square)
      this.drawBanner(ctx, view, f.sqLeft + S / 2, frame.teamBanner ? Math.min(f.cy, f.sqTop + 0.42 * S) : f.cy, S, o, frame.teamBanner);
      this.bannerDrawn = true;
    } else if (!view.finished) this.bannerGeneration = -1;
    this.stepConfetti(ctx, frame.dtMs / 1000, S);
    ctx.restore();
    return this.hudDrawn ? top + f.hudHeight : 0;
  }

  /** The bars ease toward the land (at once when a run starts): the leader's bar full once it holds a quarter of a fair share. */
  private easeBars(view: LandClaimView, dtMs: number) {
    const teams = view.teams;
    if (this.shown.length < teams) this.shown = new Float64Array(teams);
    let most = 0;
    for (let t = 0; t < teams; t++) if (view.land[t] > most) most = view.land[t];
    const scale = Math.max(most, (0.25 * view.total) / Math.max(1, teams), 1);
    if (view.generation !== this.shownGeneration) {
      this.shownGeneration = view.generation;
      for (let t = 0; t < teams; t++) this.shown[t] = Math.max(0, view.land[t]) / scale;
      return;
    }
    const k = 1 - Math.exp(-Math.max(0, dtMs) / 140);
    for (let t = 0; t < teams; t++) this.shown[t] += (Math.max(0, view.land[t]) / scale - this.shown[t]) * k;
  }

  /** The title, the counters and the bars. */
  private drawHud(ctx: CanvasRenderingContext2D, view: LandClaimView, balls: number, top: number, S: number, o: LandClaimRenderOptions) {
    const f = view.field;
    const L = o.labels;
    const cx = f.sqLeft + S / 2;
    const margin = 0.03 * S;
    // The title line: big, white, glowing in the leader's colour.
    let fsT = Math.max(12, 0.052 * S);
    ctx.font = this.font(fsT, 900);
    const tw = ctx.measureText(this.title).width;
    if (tw > 0.9 * S) fsT *= (0.9 * S) / tw;
    ctx.font = this.font(fsT, 900);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const titleY = top + 0.036 * S;
    ctx.lineWidth = Math.max(2, 0.12 * fsT);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.strokeText(this.title, cx, titleY);
    const lead = view.finished ? view.verdict.winner : view.leader;
    if (lead >= 0) {
      ctx.shadowColor = this.colorOf(lead);
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(this.title, cx, titleY);
    ctx.shadowBlur = 0;
    // The counters: blocks left (a steal battle: its steals), balls, the clock.
    const leftMs = view.finished ? Math.max(0, view.durationMs - view.finishedMs) : Math.max(0, view.durationMs - o.nowMs);
    const secs = Math.ceil(leftMs / 1000 - 1e-9);
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    const counters = `${view.rule === "steal" ? L.steals(view.steals) : L.left(view.remaining)}  ·  ${L.balls(balls)}  ·  ${clock}`;
    const fsC = Math.max(8, 0.021 * S);
    ctx.font = this.font(fsC, 700);
    ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
    ctx.fillText(counters, cx, top + 0.073 * S);
    // The bars: one row per competitor (past HUD_ROWS the leaders and "+N MORE"), in one or two columns.
    const teams = view.teams;
    const more = teams > HUD_ROWS ? teams - (HUD_ROWS - 1) : 0;
    const listed = more > 0 ? HUD_ROWS - 1 : teams;
    if (this.order.length < HUD_ROWS) this.order = new Int32Array(HUD_ROWS);
    if (more > 0) this.leaders(view, listed);
    else for (let i = 0; i < listed; i++) this.order[i] = i;
    const items = listed + (more > 0 ? 1 : 0);
    const columns = items > 4 ? 2 : 1;
    const perColumn = Math.ceil(items / columns);
    const areaTop = top + 0.092 * S;
    const areaH = 0.1 * S;
    const rowH = Math.min(0.034 * S, areaH / perColumn);
    const gapX = 0.03 * S;
    const colW = (S - 2 * margin - (columns - 1) * gapX) / columns;
    const nameW = 0.27 * colW;
    const fsN = Math.max(7, 0.5 * rowH);
    const numW = this.numbersWidth(ctx, fsN);
    for (let i = 0; i < items; i++) {
      const column = Math.floor(i / perColumn);
      const row = i - column * perColumn;
      const x0 = f.sqLeft + margin + column * (colW + gapX);
      const y = areaTop + (row + 0.5) * rowH;
      if (i === listed) {
        ctx.font = this.font(fsN, 800);
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.fillText(L.more(more), x0 + 0.1 * rowH, y);
        continue;
      }
      const t = this.order[i];
      this.drawBarRow(ctx, view, t, x0, y, colW, rowH, nameW, numW, fsN, lead === t);
    }
  }

  /** The `count` competitors with the most land (ties: the earlier slot) into `order`. */
  private leaders(view: LandClaimView, count: number) {
    let filled = 0;
    for (let t = 0; t < view.teams; t++) {
      const v = view.land[t];
      let j = filled;
      while (j > 0 && view.land[this.order[j - 1]] < v) j--;
      if (j >= count) continue;
      const end = Math.min(filled, count - 1);
      for (let k = end; k > j; k--) this.order[k] = this.order[k - 1];
      this.order[j] = t;
      if (filled < count) filled++;
    }
  }

  private numbersWidth(ctx: CanvasRenderingContext2D, fs: number): number {
    ctx.font = this.font(fs, 800);
    return ctx.measureText("00000  ●000").width;
  }

  /** One HUD row: the badge, the name, the bar and "land  ●balls". */
  private drawBarRow(ctx: CanvasRenderingContext2D, view: LandClaimView, t: number, x0: number, y: number, colW: number, rowH: number, nameW: number, numW: number, fs: number, leading: boolean) {
    const look = this.looks[t];
    const color = this.colorOf(t);
    const badge = 0.8 * rowH;
    if (leading) {
      ctx.fillStyle = this.rgba(t, 0.16);
      roundRect(ctx, x0 - 0.15 * rowH, y - 0.48 * rowH, colW + 0.3 * rowH, 0.96 * rowH, 0.3 * rowH);
      ctx.fill();
    }
    if (look) {
      const s = (badge * 128) / 116;
      ctx.drawImage(this.badgeSprite(look), x0 + 0.5 * badge - s / 2, y - s / 2, s, s);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x0 + 0.5 * badge, y, 0.5 * badge, 0, TWO_PI);
      ctx.fill();
    }
    // The name, cut to its column.
    ctx.font = this.font(fs, 800);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const nx = x0 + badge + 0.3 * rowH;
    const name = this.fit(ctx, this.nameOf(t), nameW);
    ctx.lineWidth = Math.max(2, 0.18 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.strokeText(name, nx, y);
    ctx.fillStyle = color;
    ctx.fillText(name, nx, y);
    // The bar.
    const bx = nx + nameW + 0.25 * rowH;
    const bw = Math.max(4, x0 + colW - numW - 0.25 * rowH - bx);
    const bh = Math.max(3, 0.42 * rowH);
    ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
    roundRect(ctx, bx, y - bh / 2, bw, bh, bh / 2);
    ctx.fill();
    const frac = Math.max(0, Math.min(1, this.shown[t] ?? 0));
    if (frac > 0.002) {
      ctx.fillStyle = color;
      roundRect(ctx, bx, y - bh / 2, Math.max(bh, bw * frac), bh, bh / 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      ctx.fillRect(bx + bh / 2, y - bh / 2, Math.max(0, bw * frac - bh), 0.35 * bh);
    }
    // The land and the balls in play.
    const land = String(Math.max(0, view.land[t]));
    const ballsText = `  ●${view.alive[t] ?? 0}`;
    ctx.textAlign = "right";
    const right = x0 + colW;
    ctx.font = this.font(fs, 800);
    const bwText = ctx.measureText(ballsText).width;
    ctx.fillStyle = color;
    ctx.fillText(ballsText, right, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(land, right - bwText, y);
  }

  /** `text` cut with an ellipsis to `width` px in the current font. */
  private fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
    if (ctx.measureText(text).width <= width) return text;
    const chars = Array.from(text);
    while (chars.length > 1 && ctx.measureText(`${chars.join("")}…`).width > width) chars.pop();
    return `${chars.join("")}…`;
  }

  /** The verdict: DOMINATION / SUCH A CLOSE BATTLE / "[name] CLAIMS THE MOST", then the winner's share (and name). */
  private drawBanner(ctx: CanvasRenderingContext2D, view: LandClaimView, cx: number, cy: number, S: number, o: LandClaimRenderOptions, teamBanner: boolean) {
    const L = o.labels;
    const v = view.verdict;
    const k = Math.min(1, Math.max(0, o.nowMs - view.finishedMs - BANNER_DELAY_MS) / 280);
    const pop = k >= 1 ? 1 : 0.6 + 0.4 * k + 0.15 * Math.sin(k * Math.PI);
    const winner = v.winner;
    const name = winner >= 0 ? this.nameOf(winner).toUpperCase() : "";
    const total = Math.max(1, view.total);
    const pct = (t: number) => Math.round((100 * Math.max(0, view.land[t] ?? 0)) / total);
    let head: string;
    let sub = "";
    let color = "#ffffff";
    if (winner < 0) head = L.noLand;
    else if (v.kind === "domination") {
      head = L.domination;
      color = this.colorOf(winner);
      sub = teamBanner ? L.share(pct(winner)) : `${L.wins(name)} · ${L.share(pct(winner))}`;
    } else if (v.kind === "close") {
      head = L.close;
      color = "#facc15";
      sub = v.second >= 0 ? `${name} ${pct(winner)}% · ${this.nameOf(v.second).toUpperCase()} ${pct(v.second)}%` : L.share(pct(winner));
    } else {
      head = L.claims(name);
      color = this.colorOf(winner);
      sub = L.share(pct(winner));
    }
    let fs = Math.max(18, 0.085 * S);
    ctx.font = this.font(fs, 900);
    const tw = ctx.measureText(head).width;
    if (tw > 0.88 * S) fs *= (0.88 * S) / tw;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = this.font(fs, 900);
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, 0.14 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(head, 0, 0);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillText(head, 0, 0);
    ctx.shadowBlur = 0;
    if (sub) {
      let sfs = 0.42 * fs;
      ctx.font = this.font(sfs, 800);
      const sw = ctx.measureText(sub).width;
      if (sw > 0.86 * S) sfs *= (0.86 * S) / sw;
      ctx.font = this.font(sfs, 800);
      ctx.lineWidth = Math.max(2, 0.16 * sfs);
      ctx.strokeText(sub, 0, 0.95 * fs);
      ctx.fillStyle = "#f4f4f5";
      ctx.fillText(sub, 0, 0.95 * fs);
    }
    ctx.restore();
  }

  private spawnConfetti(sx: number, sy: number, side: number, winner: number, teams: number) {
    for (let i = 0; i < CONFETTI_MAX; i++) {
      this.cx[i] = sx + side * (0.2 + 0.6 * Math.random());
      this.cy[i] = sy + side * (0.5 + 0.1 * Math.random());
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = side * (0.5 + 0.9 * Math.random());
      this.cvx[i] = Math.cos(a) * v;
      this.cvy[i] = Math.sin(a) * v;
      this.crot[i] = Math.random() * TWO_PI;
      this.cspin[i] = (Math.random() - 0.5) * 14;
      this.clife[i] = 1.8 + 1.2 * Math.random();
      this.cteam[i] = i % 3 === 0 ? -1 : winner >= 0 && Math.random() < 0.65 ? winner : Math.floor(Math.random() * Math.max(1, teams));
    }
    this.confetti = CONFETTI_MAX;
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
      ctx.fillStyle = this.cteam[i] < 0 ? "#ffffff" : this.colorOf(this.cteam[i]);
      ctx.fillRect(-s / 2, -s / 4, s, s / 2);
      ctx.restore();
    }
    if (live === 0) this.confetti = 0;
  }
}

/* ------------------------------------------------------------------ data attributes (tools and the smoke test) */

export const LAND_CLAIM_DATA_KEYS = [
  "lcTeams",
  "lcCols",
  "lcRows",
  "lcTotal",
  "lcArena",
  "lcRule",
  "lcEvery",
  "lcBlocks",
  "lcBalls",
  "lcBallCount",
  "lcKnocked",
  "lcRemaining",
  "lcSpawned",
  "lcSpawnedBy",
  "lcRefused",
  "lcSteals",
  "lcStolen",
  "lcLost",
  "lcKos",
  "lcMaxHeight",
  "lcLeader",
  "lcLeadChanges",
  "lcClose",
  "lcFinished",
  "lcEndMs",
  "lcWinner",
  "lcWinnerName",
  "lcVerdict",
  "lcShare",
  "lcMargin",
  "lcRig",
  "lcSteers",
  "lcBounces",
  "lcCollisions",
  "lcNotes",
  "lcRepaints",
  "lcRuns",
  "lcFlying",
  "lcPops",
  "lcLod",
  "lcFlagGlyphs",
  "lcBadges",
  "lcNames",
  "lcHud",
  "lcTitle",
  "lcBanner",
  "lcInArena",
  "lcAte",
] as const;

/** Per-competitor lists are written for the first this many competitors. */
const DATA_LIST_MAX = 64;

function listOf(values: ArrayLike<number>, count: number): string {
  let out = "";
  const n = Math.min(count, DATA_LIST_MAX, values.length);
  for (let i = 0; i < n; i++) out += `${i > 0 ? "," : ""}${values[i]}`;
  return out;
}

/** Whether every ball's whole disc is inside the arena's wall (±0.5 px). */
function ballsInArena(f: LandClaimField, balls: readonly Ball[]): boolean {
  for (const b of balls) {
    const px = b.x - f.cx;
    const py = b.y - f.cy;
    if (f.sides > 0) {
      for (let k = 0; k < f.sides; k++) if (px * f.sideNx[k] + py * f.sideNy[k] + b.radius > f.apothem + 0.5) return false;
    } else if (Math.hypot(px, py) + b.radius > f.apothem + 0.5) return false;
  }
  return true;
}

/** Mirrors the battle onto the canvas element (data-lc-*): the wall, the land and the balls per competitor, the knocks, spawns and steals, the verdict, the rig and what was drawn. */
export function writeLandClaimDataset(view: LandClaimView, layer: LandClaimLayer, balls: readonly Ball[], set: (key: string, value: string) => void) {
  set("lcTeams", String(view.teams));
  set("lcCols", String(view.cols));
  set("lcRows", String(view.rows));
  set("lcTotal", String(view.total));
  set("lcArena", view.field.arena);
  set("lcRule", view.rule);
  set("lcEvery", String(view.settings.every));
  set("lcBlocks", listOf(view.land, view.teams));
  set("lcBalls", listOf(view.alive, view.teams));
  set("lcBallCount", String(balls.length));
  set("lcKnocked", String(view.knocks));
  set("lcRemaining", String(view.remaining));
  set("lcSpawned", String(view.spawns));
  set("lcSpawnedBy", listOf(view.spawned, view.teams));
  set("lcRefused", String(view.spawnsRefused));
  set("lcSteals", String(view.steals));
  set("lcStolen", listOf(view.stolen, view.teams));
  set("lcLost", listOf(view.lost, view.teams));
  set("lcKos", String(view.kos));
  set("lcMaxHeight", String(view.maxHeight));
  set("lcLeader", String(view.leader));
  set("lcLeadChanges", String(view.leadChanges));
  set("lcClose", view.close ? "1" : "0");
  set("lcFinished", view.finished ? "1" : "0");
  set("lcEndMs", view.finished ? String(Math.round(view.finishedMs)) : "");
  set("lcWinner", String(view.finished ? view.verdict.winner : -1));
  set("lcWinnerName", view.finished && view.verdict.winner >= 0 ? layer.nameOf(view.verdict.winner) : "");
  set("lcVerdict", view.finished && !view.ate ? (view.verdict.winner >= 0 ? view.verdict.kind : "none") : "");
  set("lcShare", view.finished ? view.verdict.share.toFixed(3) : "0");
  set("lcMargin", view.finished ? view.verdict.margin.toFixed(3) : "0");
  set("lcRig", String(view.forcedWinner));
  set("lcSteers", String(view.steers));
  set("lcBounces", String(view.bounces));
  set("lcCollisions", String(view.collisions));
  set("lcNotes", String(view.notes));
  set("lcRepaints", String(layer.repaints));
  set("lcRuns", layer.runs ? "1" : "0");
  set("lcFlying", String(layer.flying));
  set("lcPops", String(layer.pops));
  set("lcLod", String(layer.lod));
  set("lcFlagGlyphs", flagGlyphsSupported() ? "1" : "0");
  let badges = "";
  let names = "";
  const n = Math.min(view.teams, DATA_LIST_MAX);
  for (let t = 0; t < n; t++) {
    badges += layer.badgeOf(t);
    names += `${t > 0 ? "|" : ""}${layer.nameOf(t)}`;
  }
  set("lcBadges", badges);
  set("lcNames", names);
  set("lcHud", layer.hudDrawn ? "1" : "0");
  set("lcTitle", layer.title);
  set("lcBanner", layer.bannerDrawn ? "1" : "0");
  set("lcInArena", ballsInArena(view.field, balls) ? "1" : "0");
  set("lcAte", view.ate ? "1" : "0");
}
