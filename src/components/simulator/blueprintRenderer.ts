import { TilesLayer, isTileStyle, rgbOf, type TilesRenderOptions } from "./tilesRenderer";
import { noteTitleBlock, type HudSquare } from "./liveMarkHud";
import { defaultCanvasFactory, fillStrokeGlow, plainTransform, rgbOfHex, type CanvasFactory } from "./mergeRingGlow";
import type { LiveHud } from "@/lib/watermark/liveLayout";
import type { Ball } from "@/lib/physics/types";
import { ballLabel, bannerText, type BlueprintView } from "@/lib/blueprint/runtime/view";
import { WALL_HALF } from "@/lib/blueprint/runtime/world";

/**
 * Canvas drawing of Mode Lab (feature blueprint, lib/physics/modes/blueprint.ts): a Blueprint's arena and everything in it.
 * The canvas calls, per frame:
 *  - `drawWorld()` under the balls: the arena's floor (a soft glow of the rim's colour in the spec's background), the
 *    tiles (tilesRenderer.ts TilesLayer: glass, brick or neon, cracking as they lose hit points), the pegs, bumpers, bars and
 *    spinners (a peg lights up when hit), the rings with their turning gaps (a broken ring shatters outwards) and the rim with its
 *    exits – each opening marked by two white posts – or the box;
 *  - `drawTrail()` for each ball while the spec's look asks for trails: a tapering streak in the ball's own colour;
 *  - `drawEffects()` over the balls: a ring in its new colour round a ball a hit just converted to another team, each
 *    ball's label (its tier, or its hit points) and the spec's white flash;
 *  - `drawOverlay()` round the recorder's square: the title and the HUD counters (top left), the clock counting down to the
 *    timeout (top right), ARENA FULL when the ball ceiling refused a ball and, once the run is over, the end banner (the
 *    result line in the winner's colour on a dark band, popping in on the run's clock). --- review fix (blueprint) --- The
 *    title block and the clock sit in the frame's free band when it has one (above the square in a portrait frame, beside
 *    it in a landscape one), so they never cover the arena; in a square frame they sit in its top corners on a dark plate.
 *    The clock shows only when no HUD counter already shows the time, and only in the last CLOCK_LAST_SEC before the
 *    timeout: one clock on screen, never one counting up beside one counting down.
 * Nothing is blurred per frame (the Merge Ring lesson: a `shadowBlur` draw blurs the whole box of a big shape): what does
 * not move – the floor, a rim that does not turn, the box, the pegs and bars – is drawn once into an offscreen bitmap
 * (`LayerCache`, glow included) and blitted 1:1; the standing tiles are a second bitmap redrawn only when a tile is hit or
 * breaks (`TileView.version`), the flashes and break outlines live on top; a turning rim and the rings get their glow as a
 * gradient annulus (mergeRingGlow.ts `fillStrokeGlow()`), a lit peg a translucent halo, the HUD and the banner a dark outline.
 * A view the bitmaps cannot follow (a rotated camera, no offscreen canvas, a bitmap too big) is drawn live the same way.
 * Everything animates on the run's clock (simulated time), so a pause freezes it and a recording replays it; strings are
 * cached. Text the spec carries (its name, HUD labels, result lines, team names) is the author's; a catalog entry's comes
 * from the page's messages (`labels.catalog`), so the built-in games speak the visitor's language.
 */

export interface BlueprintRenderOptions {
  /** The wall colour with an alpha (the rim and the rings when the spec's rim colour is the wall's). */
  wallAlpha: (alpha: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
}

/** A catalog entry's texts in the page's language (every field optional: a missing one falls back to the spec's). */
export interface BlueprintCatalogLabels {
  name?: string;
  /** The HUD labels, in the spec's order. */
  hud?: string[];
  /** The result lines of the finish conditions, in order ("[winner] WINS"; the placeholders are the spec's, in brackets). */
  says?: string[];
  timeoutSay?: string;
}

export interface BlueprintLabels {
  /** The badge when the arena refused a ball at the ceiling. */
  arenaFull: string;
  /** The clock: seconds left until the timeout. */
  timeLeft: (seconds: number) => string;
  /** The banner's subline: when the run ended. */
  endedAt: (seconds: string) => string;
  /** The teams' names (palette order) for a catalog entry's {winner}. */
  teamNames: string[];
  /** "Nobody", the {winner} of a run without one. */
  nobody: string;
  /** --- review fix (blueprint) --- The marker under the title of a game from a link (its name and lines are its author's). */
  fromLink?: string;
  /** Each catalog entry's texts, by its id. */
  catalog: Record<string, BlueprintCatalogLabels>;
}

export const DEFAULT_BLUEPRINT_LABELS: BlueprintLabels = {
  arenaFull: "ARENA FULL",
  timeLeft: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
  endedAt: (s) => `${s} s`,
  teamNames: ["RED", "BLUE", "GREEN", "GOLD", "PURPLE", "CYAN"],
  nobody: "NOBODY",
  fromLink: "FROM A LINK",
  catalog: {},
};

/** How long ARENA FULL stays up after the last refused ball, a broken ring shatters and a peg glows (s of the run). */
export const ARENA_FULL_SEC = 1.5;
/** --- review fix (blueprint) --- The countdown shows only in the last this many seconds before the timeout (s of the run). */
export const CLOCK_LAST_SEC = 10;

/** A box of the overlay (world px). */
export interface OverlayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * --- review fix (blueprint) --- Where the overlay's title block (left) and clock (right) go in a frame of `width` × `height`
 * world px round its recorder square: in the free band above the square (portrait) or beside it (landscape) when the block
 * fits there, else in the square's top corners on a dark plate. `blockH` is the title block's height, `inset` the page's
 * buttons at the top of a live portrait or square frame.
 */
export function overlayPlacement(width: number, height: number, sq: HudSquare, blockH: number, inset: number): { left: number; right: number; top: number; maxWidth: number; plate: boolean } {
  const pad = 0.04 * sq.side;
  // portrait: the band above the square, the block's bottom just over the square's top edge
  if (sq.y0 >= blockH + inset + 0.02 * sq.side) return { left: sq.x0 + pad, right: sq.x0 + sq.side - pad, top: sq.y0 - 0.02 * sq.side - blockH, maxWidth: 0.6 * sq.side, plate: false };
  // landscape: the bands beside the square (the block in the left one, the clock in the right one), level with its top
  if (height <= width && sq.x0 >= 0.3 * sq.side) return { left: pad, right: width - pad, top: sq.y0 + 0.03 * sq.side + inset, maxWidth: sq.x0 - 1.5 * pad, plate: false };
  return { left: sq.x0 + pad, right: sq.x0 + sq.side - pad, top: sq.y0 + 0.03 * sq.side + inset, maxWidth: 0.6 * sq.side, plate: true };
}
export const RING_BREAK_SEC = 0.55;
/** A broken ring's pieces, and how far out they fly (× its radius). */
export const RING_SHARDS = 14;
export const RING_SHARD_SPREAD = 0.2;
export const PEG_GLOW_SEC = 0.25;
/** A trail is as wide as a ball of at most this radius (px) makes it. */
export const TRAIL_MAX_RADIUS = 9;
/** How long a ball that changed team rings out in its new colour (s of the run), and how many rings a frame keeps. */
export const TEAM_PULSE_SEC = 0.4;
export const TEAM_PULSE_MAX = 48;
/** The end banner's pop-in (s of the run after the finish). */
export const BANNER_POP_SEC = 0.3;
/** The glow of the rim and the rings (a `shadowBlur` in device px, drawn as a gradient or once into the bitmap). */
export const RIM_GLOW = 10;
/** Largest side of an offscreen bitmap (device px): beyond it the layer is drawn live. */
export const LAYER_CACHE_MAX_SIDE = 4096;
const TWO_PI = Math.PI * 2;

/** "#rrggbb" with an alpha, as rgba(). */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = rgbOf(color);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Two "#rrggbb" colours mixed (`t` of the second), as "#rrggbb". */
export function mixHex(a: string, b: string, t: number): string {
  const ca = rgbOf(a);
  const cb = rgbOf(b);
  const k = Math.max(0, Math.min(1, t));
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

/** How strong the live glow of a turning rim or a ring is (the gradient's alpha: the rings sit close, their glows add up). */
export const ARC_GLOW_ALPHA = 0.6;

/**
 * The glow of an arc of a circle drawn without a blur: the gradient annulus of `fillStrokeGlow()` under `ARC_GLOW_ALPHA`,
 * and – where the arc ends, at a gap – a soft round cap, as a blurred stroke spreads past its ends (the annulus alone would
 * end in a hard radial edge). False when the gradient could not stand for the blur (the caller draws no glow).
 */
export function arcGlow(ctx: CanvasRenderingContext2D, k: number, x: number, y: number, r: number, lw: number, rgb: string, a0: number, a1: number): boolean {
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * ARC_GLOW_ALPHA;
  const drawn = fillStrokeGlow(ctx, k, x, y, r, lw, RIM_GLOW, rgb, a0, a1);
  if (drawn && a1 - a0 < TWO_PI - 1e-6) {
    const reach = lw / 2 + (1.6 * RIM_GLOW) / k;
    for (const a of [a0, a1]) {
      const cx = x + r * Math.cos(a);
      const cy = y + r * Math.sin(a);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
      g.addColorStop(0, `rgba(${rgb}, 0.35)`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, reach, 0, TWO_PI);
      ctx.fill();
    }
  }
  ctx.globalAlpha = alpha;
  return drawn;
}

/** The square the recorder crops (world px): the shorter side, centred. */
export function recorderSquare(width: number, height: number, out: HudSquare = { x0: 0, y0: 0, side: 0 }): HudSquare {
  const side = Math.min(width, height);
  out.x0 = (width - side) / 2;
  out.y0 = (height - side) / 2;
  out.side = side;
  return out;
}

/**
 * A result line with its bracketed (a catalog's message) or braced (a spec's own) placeholders filled from the run: the
 * winner's name, the time, the counts and the spec's variables.
 */
export function fillResultLine(template: string, view: BlueprintView, labels: BlueprintLabels): string {
  const bp = view.bp;
  const world = view.world;
  if (!bp || !world) return template;
  const r = view.result;
  const own = view.catalogId === "";
  const names = own ? bp.look.teamNames : labels.teamNames;
  const value = (key: string): string | null => {
    switch (key) {
      case "winner":
        return r.winner >= 0 ? (names[r.winner] ?? bp.look.teamNames[r.winner] ?? `${r.winner + 1}`) : labels.nobody;
      case "time":
        return `${r.timeSec.toFixed(1)} s`;
      case "balls":
        return String(view.balls);
      case "escaped":
        return String(view.escaped);
      case "tiles":
        return String(view.tiles);
      case "rings":
        return String(view.rings);
      case "tier": {
        let t = 0;
        for (const b of world.balls) if (b.alive && b.tier > t) t = b.tier;
        return String(t);
      }
      default: {
        const hud = view.hud.find((h) => h.show === key);
        return hud ? hud.value : null;
      }
    }
  };
  return template.replace(/[[{]([a-z][a-z0-9]{0,7})[\]}]/g, (whole, key: string) => value(key) ?? whole);
}

/** The end banner's title: the result line, in the page's language for a catalog entry. */
export function endTitle(view: BlueprintView, labels: BlueprintLabels): string {
  const r = view.result;
  if (!r.finished || !view.bp) return "";
  const cat = view.catalogId ? labels.catalog[view.catalogId] : undefined;
  if (cat) {
    const template = r.reason === "condition" ? cat.says?.[r.condition] : r.reason === "timeout" ? cat.timeoutSay : undefined;
    if (template) return fillResultLine(template, view, labels).toUpperCase();
  }
  return bannerText(view);
}

/** The banner's subline: when the run ended. */
export function endSub(view: BlueprintView, labels: BlueprintLabels): string {
  return labels.endedAt(view.result.timeSec.toFixed(1));
}

/** The banner's colour: the winner's palette colour, else white (a timeout: a soft red). */
export function endColor(view: BlueprintView): string {
  const r = view.result;
  if (r.reason === "timeout" || r.reason === "fault") return "#fb7185";
  if (view.bp && r.winner >= 0) return view.bp.look.palette[r.winner % view.bp.look.palette.length] ?? "#f8fafc";
  return "#f8fafc";
}

/** The banner's pop-in at `age` s after the finish: its scale (0.7 → a little over 1 → 1) and its opacity. */
export function bannerPop(age: number): { scale: number; alpha: number } {
  if (!(age >= 0)) return { scale: 0.7, alpha: 0 };
  if (age >= BANNER_POP_SEC) return { scale: 1, alpha: 1 };
  const u = age / BANNER_POP_SEC;
  // ease-out-back: overshoots a little and settles
  const c = 1.7;
  const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
  return { scale: 0.7 + 0.3 * e, alpha: Math.min(1, 0.15 + 1.6 * u) };
}

/**
 * A layer drawn once into an offscreen bitmap in device px and blitted 1:1 (the canvas' transform must only scale evenly
 * and translate). The bitmap holds a square of half side `extent` (world px) round a centre; it is rebuilt when its content
 * key changes (at once) or its geometry does – the scale, the extent, the world – once that change has held for a frame (a
 * zoom or a resize in progress draws live). A camera that slides the layer blits it at the nearest pixel. `draw()` returns
 * false where it cannot help: the caller draws the layer live.
 */
export class LayerCache {
  /** Bitmaps built and blits so far (for the tests). */
  builds = 0;
  blits = 0;
  private canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private unavailable = false;
  private builtGeom = "";
  private builtContent = "";
  private lastGeom = "";
  private half = 0;
  private fx = 0;
  private fy = 0;

  constructor(private readonly createCanvas: CanvasFactory = defaultCanvasFactory) {}

  /** Blits the layer (building it first with `paint`, in world px, when its keys changed); false when the caller must draw it live. */
  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, extent: number, geom: string, content: string, paint: (g: CanvasRenderingContext2D) => void): boolean {
    const m = plainTransform(ctx);
    if (!m || this.unavailable) return false;
    const half = Math.ceil(m.k * extent) + 2;
    if (2 * half + 2 > LAYER_CACHE_MAX_SIDE) return false;
    const geomKey = `${geom}|${m.k}|${half}`;
    const devCx = m.k * cx + m.e;
    const devCy = m.k * cy + m.f;
    const held = geomKey === this.lastGeom;
    this.lastGeom = geomKey;
    if (geomKey !== this.builtGeom || content !== this.builtContent) {
      if (geomKey !== this.builtGeom && !held) return false;
      if (!this.build(m.k, cx, cy, devCx, devCy, half, paint)) return false;
      this.builtGeom = geomKey;
      this.builtContent = content;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.canvas!, Math.round(devCx - this.fx) - this.half, Math.round(devCy - this.fy) - this.half);
    ctx.restore();
    this.blits++;
    return true;
  }

  private build(k: number, cx: number, cy: number, devCx: number, devCy: number, half: number, paint: (g: CanvasRenderingContext2D) => void): boolean {
    const size = 2 * half + 2;
    if (!this.canvas) {
      this.canvas = this.createCanvas(size, size);
      this.g = this.canvas?.getContext("2d") ?? null;
      if (!this.canvas || !this.g) {
        this.unavailable = true;
        return false;
      }
    }
    const canvas = this.canvas;
    const g = this.g!;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    this.half = half;
    this.fx = devCx - Math.floor(devCx);
    this.fy = devCy - Math.floor(devCy);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.shadowBlur = 0;
    // world px → the bitmap: the centre at (half + fx, half + fy)
    g.setTransform(k, 0, 0, k, half + this.fx - k * cx, half + this.fy - k * cy);
    g.save();
    paint(g);
    g.restore();
    this.builds++;
    return true;
  }
}

export class BlueprintLayer {
  private readonly tiles = new TilesLayer();
  /** The floor, a rim that does not turn (with its glow), the box, the pegs and the bars. */
  readonly staticLayer: LayerCache;
  /** The standing tiles (redrawn when a tile is hit or breaks). */
  readonly tileLayer: LayerCache;
  private readonly sq: HudSquare = { x0: 0, y0: 0, side: 0 };
  private clockKey = -1;
  private clockText = "";
  private readonly hudKeys: string[] = [];
  private readonly hudTexts: string[] = [];
  /** HUD lines drawn this frame (the watermark's title block). */
  private lines = 0;
  private arenaFullOn = false;
  /** --- review fix (blueprint) --- The title block and the clock as drawn this frame (world px; w 0: not drawn), for the watermark. */
  readonly hudRect: OverlayRect = { x: 0, y: 0, w: 0, h: 0 };
  readonly clockRect: OverlayRect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly exitOrder = new Int8Array(4);
  /** The spec the static bitmap was drawn for (a new run of another spec rebuilds it). */
  private staticSpec: object | null = null;
  private staticSerial = 0;
  private readonly tileOpts: TilesRenderOptions = { style: "glass", palette: [], colorBy: "row" };
  /** Trail strokes by colour (three alphas each), cached. */
  private readonly trailColors = new Map<string, string[]>();
  /** Each ball's team as last drawn, and the rings of the balls that changed team (a conquest reads at a glance). */
  private readonly teamOf = new Map<number, number>();
  private teamRun: object | null = null;
  private teamClock = -1;
  private readonly pulses: { x: number; y: number; r: number; color: string; at: number }[] = [];

  constructor(createCanvas: CanvasFactory = defaultCanvasFactory) {
    this.staticLayer = new LayerCache(createCanvas);
    this.tileLayer = new LayerCache(createCanvas);
  }

  /** Under the balls: the floor, the tiles, the obstacles, the rings and the rim. */
  drawWorld(ctx: CanvasRenderingContext2D, view: BlueprintView, opts: BlueprintRenderOptions) {
    const bp = view.bp;
    const w = view.world;
    if (!bp || !w) return;
    const palette = bp.look.palette;
    const rim = palette[bp.look.rim] ?? palette[0] ?? "#ffffff";
    const lw = Math.max(2, Math.min(6, opts.wallThickness));
    // a rim that turns (exits on a spinning rim) and the rings are drawn every frame; everything else is still
    const rimTurns = w.shape === "circle" && w.exitAt.length > 0 && bp.arena.spinDegPerSec !== 0;
    if (bp !== this.staticSpec) {
      this.staticSpec = bp;
      this.staticSerial++;
    }
    ctx.save();
    ctx.globalAlpha = 1;
    // the still layer: from its bitmap, or live
    const extent = w.R + WALL_HALF + 3 * lw + 2 * RIM_GLOW;
    const geom = `${this.staticSerial}|${w.width}x${w.height}|${w.cx},${w.cy},${w.R}|${lw}|${opts.showWallGlow}`;
    const m = opts.showWallGlow ? plainTransform(ctx) : null;
    // (into the bitmap the glow is blurred once; drawn live, it is a gradient – or nothing on a rotated view)
    if (!this.staticLayer.draw(ctx, w.cx, w.cy, extent, geom, "", (g) => this.paintStatic(g, view, rim, lw, opts.showWallGlow ? -1 : 0, !rimTurns))) this.paintStatic(ctx, view, rim, lw, m ? m.k : 0, !rimTurns);
    // the tiles: the standing ones from their bitmap (redrawn when one is hit), the flashes and breaks live
    if (bp.tiles && w.tileCount > 0) {
      const o = this.tileOpts;
      o.style = isTileStyle(bp.tiles.style) ? bp.tiles.style : "glass";
      o.palette = palette;
      o.colorBy = bp.tiles.pitchBy === "col" ? "col" : "row";
      o.lineWidth = undefined;
      const paintTiles = (g: CanvasRenderingContext2D) => this.tiles.drawStanding(g, w.tiles, o);
      if (!this.tileLayer.draw(ctx, w.cx, w.cy, w.R + 4, geom, String(w.tiles.version), paintTiles)) paintTiles(ctx);
      this.tiles.drawTransients(ctx, w.tiles, o);
    }
    this.drawLitPegs(ctx, view, rim);
    this.drawSpinners(ctx, view, rim);
    if (w.shape === "rings") this.drawRings(ctx, view, rim, lw, m ? m.k : 0);
    else if (rimTurns) this.drawRim(ctx, view, rim, lw, m ? m.k : 0);
    ctx.restore();
  }

  /**
   * What does not move, in world px (into the bitmap or live): the floor, the pegs at rest, the bumpers and bars, and – when
   * `withRim` – the rim or the box. `glow`: −1 blurred (the bitmap: once), > 0 a gradient (live: device px per world px), 0 none.
   */
  private paintStatic(g: CanvasRenderingContext2D, view: BlueprintView, rim: string, lw: number, glow: number, withRim: boolean) {
    const bp = view.bp!;
    const w = view.world!;
    // the floor: the spec's background, a soft glow of the rim's colour towards the centre
    const bg = bp.look.background;
    const floor = g.createRadialGradient(w.cx, w.cy, 0, w.cx, w.cy, w.R);
    floor.addColorStop(0, withAlpha(mixHex(bg, rim, 0.12), 0.94));
    floor.addColorStop(0.7, withAlpha(mixHex(bg, rim, 0.04), 0.92));
    floor.addColorStop(1, withAlpha(bg, 0.9));
    g.fillStyle = floor;
    g.beginPath();
    if (w.shape === "box") g.rect(w.cx - w.R, w.cy - w.R, 2 * w.R, 2 * w.R);
    else g.arc(w.cx, w.cy, w.R, 0, TWO_PI);
    g.fill();
    // pegs at rest (one path), bumpers (one path, a white ring) – a peg's light is drawn live over it
    const pegFill = withAlpha(mixHex("#e2e8f0", rim, 0.3), 0.92);
    g.beginPath();
    let pegs = false;
    for (let i = 0; i < w.pegX.length; i++) {
      if (w.pegKick[i] !== 0) continue;
      g.moveTo(w.pegX[i] + w.pegR[i], w.pegY[i]);
      g.arc(w.pegX[i], w.pegY[i], w.pegR[i], 0, TWO_PI);
      pegs = true;
    }
    if (pegs) {
      g.fillStyle = pegFill;
      g.fill();
    }
    for (let i = 0; i < w.pegX.length; i++) {
      if (w.pegKick[i] === 0) continue;
      g.beginPath();
      g.arc(w.pegX[i], w.pegY[i], w.pegR[i], 0, TWO_PI);
      g.fillStyle = withAlpha(rim, 0.85);
      g.fill();
      g.lineWidth = Math.max(1.5, 0.25 * w.pegR[i]);
      g.strokeStyle = "rgba(255, 255, 255, 0.85)";
      g.stroke();
    }
    // bars: capsules
    g.lineCap = "round";
    g.strokeStyle = "rgba(226, 232, 240, 0.85)";
    for (let i = 0; i < w.barAx.length; i++) {
      g.lineWidth = Math.max(1, 2 * w.barHalf[i]);
      g.beginPath();
      g.moveTo(w.barAx[i], w.barAy[i]);
      g.lineTo(w.barBx[i], w.barBy[i]);
      g.stroke();
    }
    if (!withRim || (w.shape === "rings" && !w.ringRim)) return; // (--- review fix (blueprint) --- rings inside a solid rim draw it)
    if (w.shape === "box") {
      const x = w.cx - w.R - WALL_HALF;
      const y = w.cy - w.R - WALL_HALF;
      const side = 2 * (w.R + WALL_HALF);
      if (glow > 0) {
        // live: a wide faint line under the wall stands for the glow
        g.lineWidth = 3 * lw;
        g.strokeStyle = withAlpha(rim, 0.22);
        g.strokeRect(x, y, side, side);
      }
      g.lineWidth = lw;
      g.strokeStyle = rim;
      if (glow < 0) {
        g.shadowColor = rim;
        g.shadowBlur = RIM_GLOW;
      }
      g.strokeRect(x, y, side, side);
      g.shadowBlur = 0;
      return;
    }
    this.drawRim(g, view, rim, lw, glow);
  }

  /**
   * The rim: whole, or its arcs between the exits with two white posts at each opening. `k` > 0: the glow as a gradient
   * under the arcs (device px per world px); −1: blurred (into the bitmap); 0: none.
   */
  private drawRim(ctx: CanvasRenderingContext2D, view: BlueprintView, rim: string, lw: number, k: number) {
    const w = view.world!;
    const r = w.R + WALL_HALF;
    const n = w.exitAt.length;
    const rgb = rgbOfHex(rim);
    ctx.lineWidth = lw;
    ctx.strokeStyle = rim;
    ctx.lineCap = "butt";
    const arc = (a0: number, a1: number) => {
      if (k > 0 && rgb) arcGlow(ctx, k, w.cx, w.cy, r, lw, rgb, a0, a1);
      if (k < 0) {
        ctx.shadowColor = rim;
        ctx.shadowBlur = RIM_GLOW;
      }
      ctx.beginPath();
      ctx.arc(w.cx, w.cy, r, a0, a1);
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    if (n === 0) {
      arc(0, TWO_PI);
      return;
    }
    // the openings in angle order, so the arcs between them are drawn in turn (an insertion sort of at most 4 exits)
    const order = this.exitOrder;
    const start = (i: number) => (((w.exitAt[i] + w.rimAngle - w.exitHalf[i]) % TWO_PI) + TWO_PI) % TWO_PI;
    for (let q = 0; q < n; q++) {
      let p = q;
      order[p] = q;
      while (p > 0 && start(order[p - 1]) > start(order[p])) {
        const tmp = order[p - 1];
        order[p - 1] = order[p];
        order[p] = tmp;
        p--;
      }
    }
    for (let q = 0; q < n; q++) {
      const i = order[q];
      const j = order[(q + 1) % n];
      const from = start(i) + 2 * w.exitHalf[i];
      let to = start(j);
      if (to <= from) to += TWO_PI;
      if (to - from > 1e-3) arc(from, to);
    }
    // the posts: a short white bar across the rim at both edges of every opening, so the way out reads at a glance
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = Math.max(2, 0.9 * lw);
    ctx.lineCap = "round";
    const post = 2.2 * lw + 3;
    ctx.beginPath();
    for (let q = 0; q < n; q++) {
      for (const a of [start(q), start(q) + 2 * w.exitHalf[q]]) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.moveTo(w.cx + (r - post) * c, w.cy + (r - post) * s);
        ctx.lineTo(w.cx + (r + post) * c, w.cy + (r + post) * s);
      }
    }
    ctx.stroke();
  }

  /** The rings with their gaps (each in its palette colour, its glow as a gradient when `k` > 0) and a broken ring shattering. */
  private drawRings(ctx: CanvasRenderingContext2D, view: BlueprintView, rim: string, lw: number, k: number) {
    const w = view.world!;
    const palette = view.bp!.look.palette;
    const t = view.clockSec; // (the run's clock: it keeps going through the hold, so an effect never freezes at the finish)
    ctx.lineCap = "butt";
    for (let i = 0; i < w.ringR.length; i++) {
      const r = w.ringR[i];
      if (w.ringAlive[i]) {
        const hue = palette[i % palette.length] ?? rim;
        const gap = w.ringGapAt[i];
        const a0 = gap + w.ringGapHalf;
        const a1 = gap - w.ringGapHalf + TWO_PI;
        const rgb = k > 0 ? rgbOfHex(hue) : null;
        if (rgb) arcGlow(ctx, k, w.cx, w.cy, r, lw, rgb, a0, a1);
        ctx.strokeStyle = hue;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(w.cx, w.cy, r, a0, a1);
        ctx.stroke();
      } else {
        const age = t - w.ringBrokeAt[i];
        if (w.ringBrokeAt[i] >= 0 && age >= 0 && age < RING_BREAK_SEC) {
          // the ring shatters: its pieces fly outwards, turning a little, from white-hot to its colour, and fade
          const u = age / RING_BREAK_SEC;
          const out = r * (1 + RING_SHARD_SPREAD * (1 - (1 - u) * (1 - u)));
          const hue = palette[i % palette.length] ?? rim;
          const step = TWO_PI / RING_SHARDS;
          const base = w.ringGapAt[i];
          ctx.strokeStyle = withAlpha(mixHex(hue, "#ffffff", 0.6 * (1 - u)), 1 - u);
          ctx.lineWidth = Math.max(1, lw * (1.3 - 0.8 * u));
          ctx.lineCap = "round";
          ctx.beginPath();
          for (let k = 0; k < RING_SHARDS; k++) {
            const a = base + k * step + (k % 2 === 0 ? 0.18 : -0.18) * u;
            const a0 = a + 0.14 * step;
            ctx.moveTo(w.cx + out * Math.cos(a0), w.cy + out * Math.sin(a0));
            ctx.arc(w.cx, w.cy, out, a0, a + 0.86 * step);
          }
          ctx.stroke();
          ctx.lineCap = "butt";
        }
      }
    }
  }

  /** The pegs hit in the last `PEG_GLOW_SEC`: a halo in the rim's colour and a white core (no blur). */
  private drawLitPegs(ctx: CanvasRenderingContext2D, view: BlueprintView, rim: string) {
    const w = view.world!;
    const t = view.clockSec; // (the run's clock: it keeps going through the hold, so an effect never freezes at the finish)
    for (let i = 0; i < w.pegX.length; i++) {
      const glow = 1 - (t - w.pegHitAt[i]) / PEG_GLOW_SEC;
      if (!(glow > 0) || glow > 1) continue;
      ctx.beginPath();
      ctx.arc(w.pegX[i], w.pegY[i], w.pegR[i] * (1.6 + 0.9 * glow), 0, TWO_PI);
      ctx.fillStyle = withAlpha(rim, 0.38 * glow);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w.pegX[i], w.pegY[i], w.pegR[i], 0, TWO_PI);
      ctx.fillStyle = withAlpha("#ffffff", 0.55 + 0.45 * glow);
      ctx.fill();
    }
  }

  /** The spinners: capsules in the rim's colour turning round a white hub. */
  private drawSpinners(ctx: CanvasRenderingContext2D, view: BlueprintView, rim: string) {
    const w = view.world!;
    if (!w.spinX.length) return;
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(rim, 0.95);
    for (let i = 0; i < w.spinX.length; i++) {
      const c = Math.cos(w.spinAngle[i]) * w.spinLen[i];
      const s = Math.sin(w.spinAngle[i]) * w.spinLen[i];
      ctx.lineWidth = Math.max(1, 2 * w.spinHalf[i]);
      ctx.beginPath();
      ctx.moveTo(w.spinX[i] - c, w.spinY[i] - s);
      ctx.lineTo(w.spinX[i] + c, w.spinY[i] + s);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(w.spinX[i], w.spinY[i], Math.max(1.5, w.spinHalf[i]), 0, TWO_PI);
      ctx.fill();
    }
  }

  /**
   * A ball's trail while the spec's look asks for one: a streak in the ball's own colour, thinner and fainter towards its
   * end – three strokes (the oldest third, the middle, the newest), so a swarm costs three paths a ball.
   */
  drawTrail(ctx: CanvasRenderingContext2D, ball: Ball, color: string, thickness: number) {
    const len = ball.trail.length;
    if (len < 2) return;
    let shades = this.trailColors.get(color);
    if (!shades) {
      shades = [withAlpha(color, 0.1), withAlpha(color, 0.22), withAlpha(color, 0.4)];
      if (this.trailColors.size > 64) this.trailColors.clear();
      this.trailColors.set(color, shades);
    }
    const at = (i: number) => ball.trail[(ball.trailIndex + i) % len];
    // (a streak, not a stick: a big ball's trail stays as thin as a 9 px ball's)
    const width = Math.min(ball.radius, TRAIL_MAX_RADIUS) * Math.max(0.2, thickness);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let part = 0; part < 3; part++) {
      const from = Math.floor((part * (len - 1)) / 3);
      const to = part === 2 ? len - 1 : Math.floor(((part + 1) * (len - 1)) / 3);
      if (to <= from) continue;
      ctx.strokeStyle = shades[part];
      ctx.lineWidth = width * (0.35 + 0.25 * part);
      ctx.beginPath();
      const a = at(from);
      ctx.moveTo(a.x, a.y);
      for (let i = from + 1; i <= to; i++) {
        const b = at(i);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Over the balls: the rings of the balls that just changed team, their labels (tier or hit points) and the spec's white flash. */
  drawEffects(ctx: CanvasRenderingContext2D, view: BlueprintView) {
    const w = view.world;
    if (!w) return;
    ctx.save();
    this.drawTeamPulses(ctx, view);
    if (view.showTiers || view.showHp) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
      ctx.lineJoin = "round";
      for (const b of w.balls) {
        if (!b.alive || b.r < 6) continue;
        const text = ballLabel(view, b);
        if (!text) continue;
        const fs = Math.max(8, Math.min(28, 0.95 * b.r));
        ctx.font = `800 ${fs.toFixed(1)}px sans-serif`;
        ctx.lineWidth = Math.max(1.5, 0.18 * fs);
        ctx.strokeText(text, b.x, b.y + 0.04 * fs);
        ctx.fillText(text, b.x, b.y + 0.04 * fs);
      }
    }
    const flash = 1 - (view.clockSec - view.flashAtSec) / 0.3;
    if (flash > 0) {
      ctx.fillStyle = withAlpha("#ffffff", 0.35 * flash);
      ctx.beginPath();
      if (w.shape === "box") ctx.rect(w.cx - w.R, w.cy - w.R, 2 * w.R, 2 * w.R);
      else ctx.arc(w.cx, w.cy, w.R, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * A ball that changed team since the last frame (a hit converted it) rings out in its new colour: a ring that grows and
   * fades over `TEAM_PULSE_SEC` of the run. The teams are compared frame to frame, so a new run, a restart or a run that went
   * back in time starts over; a paused frame adds nothing.
   */
  private drawTeamPulses(ctx: CanvasRenderingContext2D, view: BlueprintView) {
    const w = view.world!;
    const t = view.clockSec; // (the run's clock: it keeps going through the hold, so an effect never freezes at the finish)
    if (w !== this.teamRun || t < this.teamClock) {
      this.teamRun = w;
      this.teamOf.clear();
      this.pulses.length = 0;
    }
    if (t > this.teamClock) {
      for (const b of w.balls) {
        if (!b.alive) continue;
        const was = this.teamOf.get(b.id);
        if (was !== undefined && was !== b.team && this.pulses.length < TEAM_PULSE_MAX) this.pulses.push({ x: b.x, y: b.y, r: b.r, color: b.ball.color, at: t });
        this.teamOf.set(b.id, b.team);
      }
      if (this.teamOf.size > 4 * w.balls.length + 64) {
        // (the balls that left: forgotten now and then)
        const alive = new Set(w.balls.map((b) => b.id));
        for (const id of this.teamOf.keys()) if (!alive.has(id)) this.teamOf.delete(id);
      }
    }
    this.teamClock = t;
    let keep = 0;
    for (const p of this.pulses) {
      const u = (t - p.at) / TEAM_PULSE_SEC;
      if (u >= 1) continue;
      this.pulses[keep++] = p;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.2 + 1.8 * u), 0, TWO_PI);
      ctx.strokeStyle = withAlpha(p.color, 0.85 * (1 - u));
      ctx.lineWidth = Math.max(1.5, 0.35 * p.r * (1 - u));
      ctx.stroke();
    }
    this.pulses.length = keep;
  }

  /**
   * The recorder's square: the title and up to two HUD counters at its top left, the clock at its top right, ARENA FULL under
   * it and, once the run is over, the end banner in the middle – the corners in the frame's free band when it has one
   * (overlayPlacement()); `inset` moves them below the page's buttons.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: BlueprintView, labels: BlueprintLabels, inset = 0) {
    const bp = view.bp;
    const w = view.world;
    if (!bp || !w) return;
    const sq = recorderSquare(w.width, w.height, this.sq);
    const fs = Math.max(11, 0.03 * sq.side);
    const cat = view.catalogId ? labels.catalog[view.catalogId] : undefined;
    const accent = bp.look.palette[bp.look.rim] ?? "#22d3ee";
    // (a game from a link says so under its title: its name and lines are its author's, not the site's)
    const marker = view.catalogId === "" && labels.fromLink ? labels.fromLink : "";
    const lines = 1 + (marker ? 1 : 0) + view.hud.length;
    const blockH = (lines + 0.5) * 1.1 * fs;
    const place = overlayPlacement(w.width, w.height, sq, blockH, inset);
    const top = place.top;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    // (an outline, not a blur: the text reads on any floor)
    const text = (s: string, x: number, y: number, size: number) => {
      ctx.lineWidth = Math.max(2, 0.22 * size);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.strokeText(s, x, y, place.maxWidth);
      ctx.fillText(s, x, y, place.maxWidth);
    };
    const title = (cat?.name ?? bp.meta.name).toUpperCase();
    for (let i = 0; i < view.hud.length; i++) {
      const h = view.hud[i];
      const label = cat?.hud?.[i] ?? h.label ?? h.show;
      const key = `${label}|${h.value}`;
      if (this.hudKeys[i] !== key) {
        this.hudKeys[i] = key;
        this.hudTexts[i] = label ? `${label.toUpperCase()} ${h.value}` : h.value;
      }
    }
    // the block's width, for its plate and the watermark (the widest line, at most maxWidth)
    ctx.font = `800 ${(0.9 * fs).toFixed(1)}px sans-serif`;
    let width = ctx.measureText(title).width;
    ctx.font = `700 ${(0.78 * fs).toFixed(1)}px sans-serif`;
    for (let i = 0; i < view.hud.length; i++) width = Math.max(width, ctx.measureText(this.hudTexts[i]).width);
    if (marker) {
      ctx.font = `700 ${(0.62 * fs).toFixed(1)}px sans-serif`;
      width = Math.max(width, ctx.measureText(marker).width);
    }
    width = Math.min(width, place.maxWidth);
    const r = this.hudRect;
    r.x = place.left - 0.35 * fs;
    r.y = top - 0.2 * fs;
    r.w = width + 0.7 * fs;
    r.h = blockH;
    if (place.plate) plate(ctx, r, 0.4 * fs);
    ctx.font = `800 ${(0.9 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    text(title, place.left, top + 0.5 * fs, 0.9 * fs);
    this.lines = 1;
    if (marker) {
      ctx.font = `700 ${(0.62 * fs).toFixed(1)}px sans-serif`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      text(marker, place.left, top + 1.5 * fs, 0.62 * fs);
      this.lines++;
    }
    for (let i = 0; i < view.hud.length; i++) {
      ctx.font = `700 ${(0.78 * fs).toFixed(1)}px sans-serif`;
      ctx.fillStyle = i === 0 ? accent : "rgba(255, 255, 255, 0.82)";
      text(this.hudTexts[i], place.left, top + (0.5 + 1.1 * (i + 1 + (marker ? 1 : 0))) * fs, 0.78 * fs);
      this.lines++;
    }
    // the clock: seconds left until the timeout – one clock on screen (none when a HUD counter shows the time), and only
    // near the end, so a long timeout never promises a long game; ARENA FULL under it
    const left = Math.max(0, Math.ceil(view.timeoutSec - view.timeSec));
    const showClock = !view.result.finished && left <= CLOCK_LAST_SEC && !view.hud.some((h) => h.show === "time");
    this.arenaFullOn = view.clockSec - view.arenaFullAtSec < ARENA_FULL_SEC;
    if (showClock && left !== this.clockKey) {
      this.clockKey = left;
      this.clockText = labels.timeLeft(left);
    }
    const clockFont = `700 ${(0.85 * fs).toFixed(1)}px sans-serif`;
    const fullFont = `800 ${(0.75 * fs).toFixed(1)}px sans-serif`;
    let rightW = 0;
    if (showClock) {
      ctx.font = clockFont;
      rightW = ctx.measureText(this.clockText).width;
    }
    if (this.arenaFullOn) {
      ctx.font = fullFont;
      rightW = Math.max(rightW, ctx.measureText(labels.arenaFull).width);
    }
    const rows = (showClock ? 1 : 0) + (this.arenaFullOn ? 1 : 0);
    const c = this.clockRect;
    c.w = 0;
    if (rows > 0) {
      c.w = Math.min(rightW, place.maxWidth) + 0.7 * fs;
      c.x = place.right + 0.35 * fs - c.w;
      c.y = top - 0.2 * fs;
      c.h = (rows * 1.1 + 0.3) * fs;
      if (place.plate) plate(ctx, c, 0.4 * fs);
    }
    ctx.textAlign = "right";
    if (showClock) {
      ctx.font = clockFont;
      ctx.fillStyle = left <= 5 ? "#fb7185" : "rgba(255, 255, 255, 0.82)";
      text(this.clockText, place.right, top + 0.5 * fs, 0.85 * fs);
    }
    if (this.arenaFullOn) {
      ctx.font = fullFont;
      ctx.fillStyle = "#fbbf24";
      text(labels.arenaFull, place.right, top + (showClock ? 1.6 : 0.5) * fs, 0.75 * fs);
    }
    ctx.restore();
    if (view.result.finished) this.drawBanner(ctx, view, labels, sq);
  }

  /**
   * The end banner in the middle of the square: the result line (fitted to the square) in the winner's colour over a dark
   * band, and when the run ended under it, popping in on the run's clock. Drawn opaque, whatever alpha the frame left.
   */
  private drawBanner(ctx: CanvasRenderingContext2D, view: BlueprintView, labels: BlueprintLabels, sq: HudSquare) {
    const title = endTitle(view, labels);
    if (!title) return;
    const sub = endSub(view, labels);
    const color = endColor(view);
    const { scale, alpha } = bannerPop(view.clockSec - view.result.timeSec);
    if (alpha <= 0) return;
    const cx = sq.x0 + sq.side / 2;
    const cy = sq.y0 + sq.side / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let fs = Math.max(20, 0.075 * sq.side);
    ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    const width = ctx.measureText(title).width;
    const room = 0.84 * sq.side;
    if (width > room) {
      fs = Math.max(12, (fs * room) / width);
      ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    }
    const tw = Math.min(room, ctx.measureText(title).width);
    const sfs = Math.max(10, 0.4 * fs);
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    // the band: dark, rounded, a hairline of the winner's colour
    const bw = tw + 1.4 * fs;
    const bh = 1.55 * fs + 1.3 * sfs;
    const r = Math.min(0.35 * fs, bh / 2);
    ctx.beginPath();
    ctx.moveTo(-bw / 2 + r, -bh / 2);
    ctx.arcTo(bw / 2, -bh / 2, bw / 2, bh / 2, r);
    ctx.arcTo(bw / 2, bh / 2, -bw / 2, bh / 2, r);
    ctx.arcTo(-bw / 2, bh / 2, -bw / 2, -bh / 2, r);
    ctx.arcTo(-bw / 2, -bh / 2, bw / 2, -bh / 2, r);
    ctx.closePath();
    ctx.fillStyle = "rgba(6, 8, 16, 0.72)";
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, 0.06 * fs);
    ctx.strokeStyle = withAlpha(color, 0.75);
    ctx.stroke();
    const ty = -bh / 2 + 0.95 * fs;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 0.14 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.strokeText(title, 0, ty, room);
    ctx.fillStyle = color;
    ctx.fillText(title, 0, ty, room);
    ctx.font = `600 ${sfs.toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
    ctx.fillText(sub, 0, ty + 0.62 * fs + 0.55 * sfs);
    ctx.restore();
  }

  /** The HUD this frame drew, so the live watermark badge keeps clear of it: the title block and the clock where they were drawn. */
  noteHud(hud: LiveHud, sq: HudSquare, inset: number) {
    if (this.hudRect.w <= 0) {
      noteTitleBlock(hud, sq, inset, Math.max(this.lines, this.arenaFullOn ? 2 : 1), "both");
      return;
    }
    hud.block(this.hudRect.x, this.hudRect.y, this.hudRect.w, this.hudRect.h);
    if (this.clockRect.w > 0) hud.block(this.clockRect.x, this.clockRect.y, this.clockRect.w, this.clockRect.h);
  }
}

/** The data-blueprint-* attributes the canvas mirrors for tools and the smoke test. */
export const BLUEPRINT_DATA_KEYS = ["blueprintName", "blueprintCatalog", "blueprintFinished", "blueprintReason", "blueprintResult", "blueprintBanner", "blueprintHud", "blueprintBalls", "blueprintTiles", "blueprintTime", "blueprintSteps", "blueprintDropped", "blueprintFault", "blueprintEscaped"];

/** Writes the view's state into the data-blueprint-* attributes (`set` only writes a changed value). */
export class BlueprintDataset {
  write(view: BlueprintView, set: (key: string, value: string) => void, labels: BlueprintLabels = DEFAULT_BLUEPRINT_LABELS) {
    set("blueprintName", view.bp?.meta.name ?? "");
    set("blueprintCatalog", view.catalogId);
    set("blueprintFinished", view.result.finished ? "1" : "0");
    set("blueprintReason", view.result.reason ?? "");
    set("blueprintResult", view.result.result);
    // the banner as drawn (a catalog game's line in the page's language) and the HUD's counters ("label value|…")
    set("blueprintBanner", view.result.finished ? endTitle(view, labels) : "");
    const cat = view.catalogId ? labels.catalog[view.catalogId] : undefined;
    let hud = "";
    for (let i = 0; i < view.hud.length; i++) hud += `${i ? "|" : ""}${cat?.hud?.[i] ?? view.hud[i].label ?? view.hud[i].show} ${view.hud[i].value}`;
    set("blueprintHud", hud);
    set("blueprintBalls", String(view.balls));
    set("blueprintTiles", String(view.tiles));
    set("blueprintTime", view.timeSec.toFixed(1));
    set("blueprintSteps", String(view.steps));
    set("blueprintDropped", String(view.dropped));
    set("blueprintFault", view.faults > 0 ? "1" : "0");
    set("blueprintEscaped", String(view.escaped));
  }
}

/** --- review fix (blueprint) --- A dark rounded plate behind overlay text that sits over the arena (a square frame). */
function plate(ctx: CanvasRenderingContext2D, r: OverlayRect, radius: number) {
  const rr = Math.min(radius, r.h / 2, r.w / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  ctx.closePath();
  ctx.fillStyle = "rgba(6, 8, 16, 0.62)";
  ctx.fill();
}
