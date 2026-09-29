import { COUNT_BEAT_MS, CALLOUT_MS, currentCallout, type RaceView } from "@/lib/physics/modes/race";
import { TRACK_X0, TRACK_X1, firstRowFrom, type RaceRow, type RaceTrack } from "@/lib/physics/raceTrack";
import { segmentEndpoints, type SegmentEnds } from "@/lib/physics/obstacles";
import type { Ball } from "@/lib/physics/types";
import { addRaceToCup, racePoints, rankCup, type RaceCup, type RaceResult } from "@/lib/raceCup";
import { ACCENT } from "@/lib/site";

/**
 * Canvas drawing of the Square Racing Grand Prix (lib/physics/modes/race.ts). Canvas.tsx scrolls the world by the
 * race's own camera (`applyCamera()`, like Glass Smash) and calls, in world space, `drawWorld()` (the corridor, the
 * start gate, the rows in view – pegs, funnel arms, spinners, pinball bumpers, turbo pads with running chevrons, swap
 * zones – the lap lines and the checkered finish) and `drawRacers()` (trails, glow, rolling squares or circles in
 * their colours with emoji or position numbers, boost / swap flashes, the leader's crown and name tags); then, in
 * screen space inside the square the recorder crops to, `drawOverlay()`: the live standings (position, colour, name,
 * gap – the rows slide when a racer overtakes), the mini-map (the whole track, the view window, a dot per racer), the
 * "passing" callouts, the 3-2-1-GO countdown, the podium and the cup table. Only what is in view is drawn, colours and
 * sprites are cached, and no per-frame arrays are made, so 16 racers stay cheap at 1080×1920.
 */

export interface RaceLabels {
  go: string;
  standings: string;
  leader: string;
  lap: (n: number, total: number) => string;
  finalLap: string;
  finish: string;
  swap: string;
  passes: (a: string, b: string) => string;
  takesLead: (a: string) => string;
  swapped: (a: string, b: string) => string;
  wins: (a: string) => string;
  dnf: string;
  podium: string;
  place: (n: number) => string;
  race: (n: number) => string;
  points: string;
}

/** What the page tells the canvas about the race (names and looks from the Teams roster, overlays, the cup). */
export interface CanvasRaceOptions {
  /** Per racer (16 entries): name, "#rrggbb" colour and emoji ("" = none). */
  names: readonly string[];
  colors: readonly string[];
  emoji: readonly string[];
  showStandings: boolean;
  showMiniMap: boolean;
  /** The cup is on: the stored cup (null before its first race) is shown with this race scored once. */
  cupEnabled: boolean;
  cup: RaceCup | null;
  cupTitle: string;
  /** Prefix of this page's run keys (`runKey()`), so a race is scored once however often the table is drawn. */
  runKeyPrefix: string;
  /**
   * --- fast-render --- The run key to score this race under instead of `runKey(runKeyPrefix, view)`. The fast export draws
   * the page's run on a fresh engine, whose run serial starts again at 1: it passes the page's key, so a race the page has
   * already scored is not added a second time (and one it has not scored yet is added under the key the page will use).
   */
  runKey?: string;
  labels: RaceLabels;
}

export interface RaceRenderOptions {
  wallColor: (index: number, alpha?: number, angle?: number) => string;
  wallThickness: number;
  showGlow: boolean;
  showTrails: boolean;
  trailThickness: number;
}

export const DEFAULT_RACE_LABELS: RaceLabels = {
  go: "GO!",
  standings: "STANDINGS",
  leader: "LEADER",
  lap: (n, total) => `LAP ${n}/${total}`,
  finalLap: "FINAL LAP!",
  finish: "FINISH",
  swap: "SWAP",
  passes: (a, b) => `${a} passes ${b}`,
  takesLead: (a) => `${a} takes the lead!`,
  swapped: (a, b) => `SWAP! ${a} ⇄ ${b}`,
  wins: (a) => `${a} wins!`,
  dnf: "DNF",
  podium: "PODIUM",
  place: (n) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`,
  race: (n) => `Race ${n}`,
  points: "pts",
};

/** The key a finished run is scored under in the cup (see lib/raceCup.ts). */
export function runKey(prefix: string, view: Pick<RaceView, "runSerial">): string {
  return `${prefix}:${view.runSerial}`;
}

/** The key the cup table scores this race under: the page's override (`CanvasRaceOptions.runKey`), else this run's key. */
export function cupRunKey(race: Pick<CanvasRaceOptions, "runKey" | "runKeyPrefix">, view: Pick<RaceView, "runSerial">): string {
  return race.runKey ?? runKey(race.runKeyPrefix, view);
}

/**
 * --- fast-render --- The race options of the export's canvas: the page's, scored under the page's run key (`pageRunKey`,
 * the key of the run being exported on the page's engine) so the exported cup table matches the page's.
 */
export function exportRaceOptions(race: CanvasRaceOptions | null | undefined, pageRunKey: string | undefined): CanvasRaceOptions | null | undefined {
  return race && pageRunKey ? { ...race, runKey: pageRunKey } : race;
}

/** The finished race as a cup result (finishers in order; DNFs score nothing). */
export function raceResultOf(view: Pick<RaceView, "racers" | "finishOrder">): RaceResult {
  return { racers: view.racers, order: view.finishOrder };
}

const TWO_PI = Math.PI * 2;
const SWAP_A = "#e879f9";
const SWAP_B = "#22d3ee";
const PAD = "#f59e0b";
const PAD_LIGHT = "#fde047";
const BUMPER = "#f43f5e";
/** How long a pad, a bumper and a racer flash after use (simulation ms). */
export const FLASH_MS = 350;

const darkCache = new Map<string, string>();
/** A darker shade of a "#rrggbb" colour (the racer's outline). */
function darker(color: string): string {
  let out = darkCache.get(color);
  if (out) return out;
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) out = "rgba(0,0,0,0.6)";
  else {
    const n = parseInt(m[1], 16);
    const f = (c: number) => Math.round(0.45 * c);
    out = `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
  }
  darkCache.set(color, out);
  return out;
}

/** Whether a colour is light (dark text on it reads better). */
const lightCache = new Map<string, boolean>();
function isLight(color: string): boolean {
  let out = lightCache.get(color);
  if (out !== undefined) return out;
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) out = false;
  else {
    const n = parseInt(m[1], 16);
    out = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
  }
  lightCache.set(color, out);
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function formatGap(ms: number): string {
  return `+${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/** A gap in the standings: seconds with one decimal, no unit (the column is narrow). */
function formatInterval(ms: number): string {
  return `+${(Math.max(0, ms) / 1000).toFixed(1)}`;
}

function formatTime(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

export class RaceLayer {
  private readonly ends: SegmentEnds = { x1: 0, y1: 0, x2: 0, y2: 0 };
  private readonly emojiSprites = new Map<string, HTMLCanvasElement>();
  private readonly glowSprites = new Map<string, HTMLCanvasElement>();
  private readonly fitCache = new Map<string, string>();
  private readonly widthCache = new Map<string, number>();
  /** Where each racer's standings row is drawn (eased toward its place, so overtakes slide). */
  private readonly rowY = new Float64Array(16).fill(NaN);
  private lastRun = -1;
  private readonly cupOrder: number[] = [];
  private cupTable: RaceCup | null = null;
  private cupFor = "";
  private cupSource: RaceCup | null = null;

  /** Scrolls the world by the race camera (inside the canvas' camera transform, before the world is drawn). */
  applyCamera(ctx: CanvasRenderingContext2D, view: RaceView) {
    if (view.cameraY !== 0) ctx.translate(0, -view.cameraY);
  }

  private lastView: RaceView | null = null;
  private lastRace: CanvasRaceOptions | null = null;
  /** The body colour of a racer's ball, for the faces the canvas draws on the racers after `drawRacers()`. */
  readonly bodyColor = (ball: Ball): string => {
    const v = this.lastView;
    if (!v) return ball.color;
    return this.lastRace?.colors[ball.id - v.ballIds[0]] ?? ball.color;
  };

  /* ------------------------------------------------------------------ world */

  drawWorld(ctx: CanvasRenderingContext2D, view: RaceView, opts: RaceRenderOptions, race: CanvasRaceOptions | null, viewTop: number, viewBottom: number) {
    const track = view.track;
    if (!track) return;
    const labels = race?.labels ?? DEFAULT_RACE_LABELS;
    const S = track.field.size;
    const t = view.timeMs;
    const top = Math.max(track.ceilingY, viewTop);
    const bottom = Math.min(track.floorY, viewBottom);
    ctx.save();
    // The corridor: a faint surface, distance ticks every half screen, the walls.
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    if (bottom > top) ctx.fillRect(track.left, top, track.width, bottom - top);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    const tick = 0.5 * S;
    ctx.beginPath();
    for (let y = track.yStart + Math.ceil((top - track.yStart) / tick) * tick; y <= bottom; y += tick) {
      ctx.moveTo(track.left, y);
      ctx.lineTo(track.left + 0.03 * S, y);
      ctx.moveTo(track.right - 0.03 * S, y);
      ctx.lineTo(track.right, y);
    }
    ctx.stroke();
    ctx.lineCap = "round";
    ctx.strokeStyle = opts.wallColor(0);
    ctx.lineWidth = Math.max(2, opts.wallThickness + 1);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(track.left, track.ceilingY);
    ctx.lineTo(track.left, track.floorY);
    ctx.moveTo(track.right, track.ceilingY);
    ctx.lineTo(track.right, track.floorY);
    ctx.moveTo(track.left, track.ceilingY);
    ctx.lineTo(track.right, track.ceilingY);
    ctx.moveTo(track.left, track.floorY);
    ctx.lineTo(track.right, track.floorY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.drawGate(ctx, view, track, t);
    // Lap lines and the finish.
    for (let lap = 1; lap < track.laps; lap++) {
      const y = track.yStart + lap * track.lapLength;
      if (y < viewTop - 20 || y > viewBottom + 20) continue;
      ctx.setLineDash([0.02 * S, 0.015 * S]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = Math.max(2, 0.006 * S);
      ctx.beginPath();
      ctx.moveTo(track.left, y);
      ctx.lineTo(track.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      this.label(ctx, labels.lap(lap + 1, track.laps), track.left + 0.5 * track.width, y - 0.022 * S, 0.026 * S, "#ffffff");
    }
    if (track.finishY >= viewTop - 0.05 * S && track.finishY <= viewBottom + 0.05 * S) this.drawFinish(ctx, track, labels.finish);
    // The rows in view.
    const rows = track.rows;
    for (let k = firstRowFrom(rows, viewTop - 0.05 * S); k < rows.length && rows[k].top <= viewBottom + 0.05 * S; k++) this.drawRow(ctx, rows[k], view, opts, race, labels, t);
    ctx.restore();
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string) {
    ctx.font = `bold ${Math.max(8, size)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 0.18 * size);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** The start gate: a bar with three lights while the countdown runs, sliding open into the walls at GO. */
  private drawGate(ctx: CanvasRenderingContext2D, view: RaceView, track: RaceTrack, t: number) {
    const S = track.field.size;
    const open = Math.max(0, Math.min(1, (t - view.goAtMs) / 300));
    const y = track.yStart;
    const h = Math.max(3, 0.012 * S);
    const half = track.width / 2;
    const w = half * (1 - open);
    if (w > 0.5) {
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(track.left, y - h / 2, w, h);
      ctx.fillRect(track.right - w, y - h / 2, w, h);
    }
    if (view.phase === "countdown" || t - view.goAtMs < 800) {
      // One more light per beat of the countdown (red, red, amber), all green at GO.
      const go = view.phase !== "countdown";
      const beat = Math.min(2, Math.floor(t / COUNT_BEAT_MS));
      const r = 0.012 * S;
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = go ? "#22c55e" : k <= beat ? (k === 2 ? "#facc15" : "#ef4444") : "rgba(255, 255, 255, 0.15)";
        ctx.beginPath();
        ctx.arc(track.left + half + (k - 1) * 3 * r, y - 3.2 * r, r, 0, TWO_PI);
        ctx.fill();
      }
    }
  }

  /** The checkered finish band with its label. */
  private drawFinish(ctx: CanvasRenderingContext2D, track: RaceTrack, text: string) {
    const S = track.field.size;
    const cells = 16;
    const cw = track.width / cells;
    const ch = Math.max(3, 0.012 * S);
    for (let row = 0; row < 2; row++) {
      for (let c = 0; c < cells; c++) {
        ctx.fillStyle = (c + row) % 2 === 0 ? "#f8fafc" : "#0f172a";
        ctx.fillRect(track.left + c * cw, track.finishY - ch + row * ch, cw + 0.5, ch);
      }
    }
    this.label(ctx, `🏁 ${text}`, track.left + track.width / 2, track.finishY + 0.035 * S, 0.03 * S, "#ffffff");
  }

  private drawRow(ctx: CanvasRenderingContext2D, row: RaceRow, view: RaceView, opts: RaceRenderOptions, race: CanvasRaceOptions | null, labels: RaceLabels, t: number) {
    const track = view.track!;
    const S = track.field.size;
    if (row.zone) {
      const z = row.zone;
      const h = z.y1 - z.y0;
      const used = z.used && z.a >= 0;
      const since = t - z.atMs;
      const flash = used && since >= 0 && since < 2 * FLASH_MS ? 1 - since / (2 * FLASH_MS) : 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(track.left, z.y0, track.width, h);
      ctx.clip();
      ctx.globalAlpha = used ? 0.28 : 0.5;
      ctx.fillStyle = "#3b0764";
      ctx.fillRect(track.left, z.y0, track.width, h);
      const stripe = 0.03 * S;
      const shift = ((t / 1000) * 0.08 * S) % (2 * stripe);
      ctx.globalAlpha = used ? 0.35 : 0.8;
      for (let x = track.left - h - 2 * stripe + shift; x < track.right + h; x += 2 * stripe) {
        ctx.fillStyle = Math.floor((x - track.left) / (2 * stripe)) % 2 === 0 ? SWAP_A : SWAP_B;
        ctx.beginPath();
        ctx.moveTo(x, z.y1);
        ctx.lineTo(x + stripe, z.y1);
        ctx.lineTo(x + stripe + h, z.y0);
        ctx.lineTo(x + h, z.y0);
        ctx.closePath();
        ctx.fill();
      }
      if (flash > 0) {
        ctx.globalAlpha = 0.7 * flash;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(track.left, z.y0, track.width, h);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      this.label(ctx, `⇅ ${labels.swap}`, track.left + track.width / 2, z.y, 0.6 * h, used ? "rgba(255,255,255,0.55)" : "#ffffff");
      if (z.first >= 0 && !z.used && race) {
        // The armed zone shows who is waiting to be swapped.
        ctx.fillStyle = race.colors[z.first] ?? "#fff";
        ctx.fillRect(track.right - 0.9 * h, z.y0 + 0.2 * h, 0.6 * h, 0.6 * h);
      }
    }
    for (const pad of row.pads) {
      const w = pad.x1 - pad.x0;
      const h = pad.y1 - pad.y0;
      const since = t - pad.lastAtMs;
      const flash = since >= 0 && since < FLASH_MS ? 1 - since / FLASH_MS : 0;
      ctx.save();
      roundRect(ctx, pad.x0, pad.y0, w, h, 0.25 * h);
      ctx.globalAlpha = 0.35 + 0.4 * flash;
      ctx.fillStyle = PAD;
      ctx.fill();
      ctx.clip();
      // Chevrons running down the pad.
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = flash > 0 ? "#ffffff" : PAD_LIGHT;
      ctx.lineWidth = Math.max(1.5, 0.18 * h);
      const step = 0.9 * h;
      const shift = ((t / 1000) * 2.5 * h) % step;
      ctx.beginPath();
      for (let y = pad.y0 - step + shift; y < pad.y1 + step; y += step) {
        for (let x = pad.x0 + 0.5 * h; x < pad.x1; x += 1.6 * h) {
          ctx.moveTo(x - 0.35 * h, y - 0.25 * h);
          ctx.lineTo(x, y + 0.1 * h);
          ctx.lineTo(x + 0.35 * h, y - 0.25 * h);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    for (const o of row.obstacles) {
      const since = t - o.lastHitMs;
      const flash = since >= 0 && since < FLASH_MS ? 1 - since / FLASH_MS : 0;
      const shape = o.shape;
      if (shape.kind === "circle") {
        if (o.role === "bumper") {
          const r = shape.radius * (1 + 0.18 * flash);
          if (opts.showGlow || flash > 0) {
            ctx.globalAlpha = 0.25 + 0.4 * flash;
            ctx.fillStyle = BUMPER;
            ctx.beginPath();
            ctx.arc(shape.x, shape.y, 1.5 * r, 0, TWO_PI);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = flash > 0.5 ? "#ffffff" : BUMPER;
          ctx.beginPath();
          ctx.arc(shape.x, shape.y, r, 0, TWO_PI);
          ctx.fill();
          ctx.strokeStyle = "#ffe4e6";
          ctx.lineWidth = Math.max(1.5, 0.18 * r);
          ctx.beginPath();
          ctx.arc(shape.x, shape.y, 0.62 * r, 0, TWO_PI);
          ctx.stroke();
        } else {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = flash > 0 && race && o.lastRacer >= 0 ? (race.colors[o.lastRacer] ?? "#fff") : opts.wallColor(row.index);
          ctx.beginPath();
          ctx.arc(shape.x, shape.y, shape.radius * (1 + 0.25 * flash), 0, TWO_PI);
          ctx.fill();
        }
      } else {
        segmentEndpoints(shape, this.ends);
        const spinner = o.role === "spinner";
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = spinner ? (flash > 0 ? "#ffffff" : ACCENT) : flash > 0 && race && o.lastRacer >= 0 ? (race.colors[o.lastRacer] ?? "#fff") : opts.wallColor(row.index);
        ctx.lineWidth = Math.max(shape.thickness, opts.wallThickness);
        ctx.beginPath();
        ctx.moveTo(this.ends.x1, this.ends.y1);
        ctx.lineTo(this.ends.x2, this.ends.y2);
        ctx.stroke();
        if (spinner) {
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(shape.x, shape.y, 0.8 * shape.thickness, 0, TWO_PI);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ racers */

  private emojiSprite(emoji: string): HTMLCanvasElement | null {
    if (!emoji || typeof document === "undefined") return null;
    let sprite = this.emojiSprites.get(emoji);
    if (!sprite) {
      sprite = document.createElement("canvas");
      sprite.width = 64;
      sprite.height = 64;
      const g = sprite.getContext("2d");
      if (!g) return null;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "52px serif";
      g.fillText(emoji, 32, 36);
      if (this.emojiSprites.size > 64) this.emojiSprites.clear();
      this.emojiSprites.set(emoji, sprite);
    }
    return sprite;
  }

  private glowSprite(colorIn: string): HTMLCanvasElement | null {
    if (typeof document === "undefined") return null;
    const color = /^#[0-9a-f]{6}$/i.test(colorIn) ? colorIn : "#ffffff"; // the stops below append a hex alpha
    let sprite = this.glowSprites.get(color);
    if (!sprite) {
      sprite = document.createElement("canvas");
      sprite.width = 64;
      sprite.height = 64;
      const g = sprite.getContext("2d");
      if (!g) return null;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, color);
      grad.addColorStop(0.45, `${color}55`);
      grad.addColorStop(1, `${color}00`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      if (this.glowSprites.size > 64) this.glowSprites.clear();
      this.glowSprites.set(color, sprite);
    }
    return sprite;
  }

  drawRacers(ctx: CanvasRenderingContext2D, balls: readonly Ball[], view: RaceView, opts: RaceRenderOptions, race: CanvasRaceOptions | null) {
    const track = view.track;
    if (!track) return;
    this.lastView = view;
    this.lastRace = race;
    const base = view.ballIds[0];
    const t = view.timeMs;
    const square = view.settings.shape === "square";
    const S = track.field.size;
    ctx.save();
    // Back to front: the last of the standings first, so the leader is drawn on top.
    for (let k = view.order.length - 1; k >= 0; k--) {
      const i = view.order[k];
      let ball: Ball | undefined = balls[i];
      if (!ball || ball.id - base !== i) {
        ball = undefined;
        for (const b of balls) if (b.id - base === i) ball = b;
        if (!ball) continue;
      }
      const color = race?.colors[i] ?? ball.color;
      const r = ball.radius;
      if (opts.showTrails && ball.trail.length > 1) {
        const len = ball.trail.length;
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, 0.8 * r * opts.trailThickness);
        ctx.lineJoin = "round";
        ctx.beginPath();
        const first = ball.trail[ball.trailIndex % len];
        ctx.moveTo(first.x, first.y);
        for (let j = 1; j < len; j++) {
          const p = ball.trail[(ball.trailIndex + j) % len];
          ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(ball.x, ball.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (opts.showGlow) {
        const glow = this.glowSprite(color);
        if (glow) ctx.drawImage(glow, ball.x - 2.4 * r, ball.y - 2.4 * r, 4.8 * r, 4.8 * r);
      }
      const boost = t - view.boostAtMs[i];
      const swap = t - view.swapAtMs[i];
      ctx.save();
      ctx.translate(ball.x, ball.y);
      if (square) ctx.rotate(view.roll[i]);
      const h = square ? 0.9 * r : r;
      ctx.fillStyle = color;
      ctx.strokeStyle = boost >= 0 && boost < FLASH_MS ? PAD_LIGHT : darker(color);
      ctx.lineWidth = Math.max(1, 0.22 * r);
      if (square) roundRect(ctx, -h, -h, 2 * h, 2 * h, 0.3 * h);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, h, 0, TWO_PI);
      }
      ctx.fill();
      ctx.stroke();
      const sprite = this.emojiSprite(race?.emoji[i] ?? "");
      if (sprite) ctx.drawImage(sprite, -0.85 * h, -0.85 * h, 1.7 * h, 1.7 * h);
      else if (h >= 5) {
        // The racer's place in the standings.
        const place = k + 1;
        ctx.rotate(square ? -view.roll[i] : 0);
        ctx.font = `bold ${Math.max(6, 1.05 * h)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isLight(color) ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.92)";
        ctx.fillText(String(place), 0, 0.08 * h);
      }
      ctx.restore();
      if (swap >= 0 && swap < 2 * FLASH_MS) {
        ctx.globalAlpha = 1 - swap / (2 * FLASH_MS);
        ctx.strokeStyle = SWAP_A;
        ctx.lineWidth = Math.max(1.5, 0.25 * r);
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, r * (1.4 + 1.2 * (swap / (2 * FLASH_MS))), 0, TWO_PI);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // The leader's crown, and the names of the front runners.
      if (k === 0 && view.place[i] === 0 && view.phase === "racing") this.crown(ctx, ball.x, ball.y - r - 0.35 * r, 0.9 * r);
      if (race && view.phase !== "countdown" && (k < 3 || view.racers <= 6) && view.place[i] >= 0) {
        const fs = Math.max(8, 0.022 * S);
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(2, 0.2 * fs);
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        const name = this.fit(ctx, race.names[i] ?? "", 0.2 * S, fs);
        const y = ball.y - r - (k === 0 && view.place[i] === 0 ? 1.1 * r : 0.3 * r);
        ctx.strokeText(name, ball.x, y);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(name, ball.x, y);
      }
    }
    ctx.restore();
  }

  private crown(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x - w, y - 0.7 * w);
    ctx.lineTo(x - 0.5 * w, y - 0.3 * w);
    ctx.lineTo(x, y - 0.9 * w);
    ctx.lineTo(x + 0.5 * w, y - 0.3 * w);
    ctx.lineTo(x + w, y - 0.7 * w);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
  }

  /** Width of `text` at the current font (cached per text and font). */
  private textWidth(ctx: CanvasRenderingContext2D, text: string): number {
    const key = `${ctx.font}|${text}`;
    let w = this.widthCache.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      if (this.widthCache.size > 200) this.widthCache.clear();
      this.widthCache.set(key, w);
    }
    return w;
  }

  /** `text` cut (with an ellipsis) to fit `maxWidth` at the current font (cached per text, width and font size). */
  private fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, fontSize: number): string {
    const key = `${text}|${Math.round(maxWidth)}|${Math.round(fontSize * 10)}`;
    const cached = this.fitCache.get(key);
    if (cached !== undefined) return cached;
    let out = text;
    if (ctx.measureText(text).width > maxWidth) {
      const chars = Array.from(text);
      while (chars.length > 1 && ctx.measureText(`${chars.join("")}…`).width > maxWidth) chars.pop();
      out = `${chars.join("")}…`;
    }
    if (this.fitCache.size > 400) this.fitCache.clear();
    this.fitCache.set(key, out);
    return out;
  }

  /* ------------------------------------------------------------------ overlays (screen space) */

  /**
   * Standings, mini-map, callouts, the countdown, the podium and the cup table, inside the square the recorder crops to.
   * `insetTop` keeps the standings clear of the page's buttons over a live, nearly square canvas; `dtMs` eases the rows.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: RaceView, race: CanvasRaceOptions | null, insetTop: number, dtMs: number) {
    const track = view.track;
    if (!track) return;
    if (view.runSerial !== this.lastRun) {
      this.lastRun = view.runSerial;
      this.rowY.fill(NaN);
    }
    const labels = race?.labels ?? DEFAULT_RACE_LABELS;
    const t = view.timeMs;
    ctx.save();
    const endScreen = view.phase === "podium" || view.phase === "cup" || view.phase === "done";
    if (!endScreen) {
      if (race?.showStandings !== false) this.drawStandings(ctx, view, race, labels, insetTop, dtMs);
      if (race?.showMiniMap !== false) this.drawMiniMap(ctx, view, race);
      this.drawCallout(ctx, view, race, labels, t, insetTop);
      this.drawCountdown(ctx, view, labels, t);
    } else if (view.phase === "podium" || !race?.cupEnabled) this.drawPodium(ctx, view, race, labels, t);
    else this.drawCup(ctx, view, race, labels, t);
    ctx.restore();
  }

  private drawStandings(ctx: CanvasRenderingContext2D, view: RaceView, race: CanvasRaceOptions | null, labels: RaceLabels, insetTop: number, dtMs: number) {
    const track = view.track!;
    const f = track.field;
    const S = f.size;
    const n = view.racers;
    const x0 = f.left + 0.01 * S;
    const w = (TRACK_X0 - 0.022) * S;
    const y0 = f.top + 0.012 * S + insetTop;
    const avail = f.bottom - 0.02 * S - y0;
    const rh = Math.max(9, Math.min(0.05 * S, avail / (n + 1.3)));
    const fs = 0.6 * rh;
    const header = 1.2 * rh;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    roundRect(ctx, x0, y0, w, header + n * rh + 0.3 * rh, 0.25 * rh);
    ctx.fill();
    ctx.textBaseline = "middle";
    ctx.font = `bold ${0.95 * fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillStyle = ACCENT;
    const lead = view.order[0] ?? 0;
    const title = track.laps > 1 ? labels.lap(Math.max(1, view.lap[lead]), track.laps) : labels.standings;
    ctx.fillText(this.fit(ctx, title, w - 0.4 * rh, 0.95 * fs), x0 + 0.3 * rh, y0 + 0.6 * rh);
    const ease = dtMs > 0 ? 1 - Math.exp(-dtMs / 110) : 0;
    const numW = 1.05 * rh;
    ctx.font = `${0.8 * fs}px sans-serif`;
    const gapW = Math.max(this.textWidth(ctx, "+88.8"), this.textWidth(ctx, labels.leader), this.textWidth(ctx, labels.dnf));
    for (let k = 0; k < n; k++) {
      const i = view.order[k];
      const target = y0 + header + k * rh;
      let y = this.rowY[i];
      if (!Number.isFinite(y) || dtMs === 0) y = Number.isFinite(y) ? y : target;
      y += (target - y) * ease;
      if (Math.abs(target - y) < 0.2) y = target;
      this.rowY[i] = y;
      const color = race?.colors[i] ?? "#ffffff";
      const mid = y + 0.5 * rh;
      if (k === 0) {
        ctx.fillStyle = "rgba(147, 209, 25, 0.16)";
        ctx.fillRect(x0 + 0.1 * rh, y + 0.05 * rh, w - 0.2 * rh, 0.9 * rh);
      }
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = "right";
      ctx.fillStyle = k < 3 ? "#facc15" : "#d4d4d8";
      ctx.fillText(String(k + 1), x0 + numW - 0.1 * rh, mid);
      // The racer's colour chip (its shape).
      const cs = 0.24 * rh;
      const cx = x0 + numW + 0.38 * rh;
      ctx.fillStyle = color;
      if (view.settings.shape === "square") ctx.fillRect(cx - cs, mid - cs, 2 * cs, 2 * cs);
      else {
        ctx.beginPath();
        ctx.arc(cx, mid, cs, 0, TWO_PI);
        ctx.fill();
      }
      const place = view.place[i];
      const gap = place < 0 ? labels.dnf : k === 0 ? (place > 0 ? "🏁" : labels.leader) : formatInterval(view.gapMs[i]);
      ctx.font = `${0.8 * fs}px sans-serif`;
      ctx.textAlign = "right";
      ctx.fillStyle = place < 0 ? "#f87171" : place > 0 ? "#a3e635" : "#a1a1aa";
      ctx.fillText(gap, x0 + w - 0.25 * rh, mid);
      ctx.font = `${place > 0 ? "bold " : ""}${fs}px sans-serif`;
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      const nameX = cx + cs + 0.25 * rh;
      ctx.fillText(this.fit(ctx, race?.names[i] ?? `#${i + 1}`, Math.max(10, x0 + w - 0.45 * rh - gapW - nameX), fs), nameX, mid);
    }
  }

  private drawMiniMap(ctx: CanvasRenderingContext2D, view: RaceView, race: CanvasRaceOptions | null) {
    const track = view.track!;
    const f = track.field;
    const S = f.size;
    const cx = f.left + (TRACK_X1 + (1 - TRACK_X1) / 2) * S;
    const w = 0.022 * S;
    const y0 = f.top + 0.09 * S;
    const y1 = f.bottom - 0.09 * S;
    const H = y1 - y0;
    const span = Math.max(1, track.finishY - track.yStart);
    const at = (u: number) => y0 + Math.max(0, Math.min(1, u / span)) * H;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    roundRect(ctx, cx - w / 2, y0 - 0.01 * S, w, H + 0.02 * S, w / 2);
    ctx.fill();
    // Swap zones and turbo pads as ticks, lap lines as bars, the finish flag.
    ctx.lineWidth = Math.max(1, 0.003 * S);
    for (const z of track.zones) {
      ctx.strokeStyle = z.used ? "rgba(232, 121, 249, 0.35)" : SWAP_A;
      const y = at(z.y - track.yStart);
      ctx.beginPath();
      ctx.moveTo(cx - 0.45 * w, y);
      ctx.lineTo(cx + 0.45 * w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(245, 158, 11, 0.7)";
    ctx.beginPath();
    for (const p of track.pads) {
      const y = at(p.y0 - track.yStart);
      ctx.moveTo(cx - 0.3 * w, y);
      ctx.lineTo(cx + 0.3 * w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    for (let lap = 1; lap < track.laps; lap++) {
      const y = at(lap * track.lapLength);
      ctx.beginPath();
      ctx.moveTo(cx - 0.8 * w, y);
      ctx.lineTo(cx + 0.8 * w, y);
      ctx.stroke();
    }
    const fy = y1 + 0.004 * S;
    const q = 0.25 * w;
    for (let c = 0; c < 4; c++) {
      for (let rr = 0; rr < 2; rr++) {
        ctx.fillStyle = (c + rr) % 2 === 0 ? "#ffffff" : "#111827";
        ctx.fillRect(cx - 2 * q + c * q, fy + rr * q, q, q);
      }
    }
    // The part of the track in view.
    const vt = at(view.cameraY + f.top - track.yStart);
    const vb = at(view.cameraY + f.bottom - track.yStart);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(1, 0.003 * S);
    ctx.strokeRect(cx - 0.75 * w, vt, 1.5 * w, Math.max(2, vb - vt));
    // A dot per racer, the leader on top.
    const dr = Math.max(2, 0.009 * S);
    for (let k = view.order.length - 1; k >= 0; k--) {
      const i = view.order[k];
      const y = at(view.progress[i]);
      const x = cx + (k % 2 === 0 ? -0.18 : 0.18) * w;
      ctx.fillStyle = race?.colors[i] ?? "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, k === 0 ? 1.35 * dr : dr, 0, TWO_PI);
      ctx.fill();
      if (k === 0) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, 0.25 * dr);
        ctx.stroke();
      }
    }
  }

  private drawCallout(ctx: CanvasRenderingContext2D, view: RaceView, race: CanvasRaceOptions | null, labels: RaceLabels, t: number, insetTop: number) {
    const c = currentCallout(view, t);
    if (!c) return;
    const track = view.track!;
    const f = track.field;
    const S = f.size;
    const name = (i: number) => (i >= 0 ? (race?.names[i] ?? `#${i + 1}`) : "");
    let text: string;
    switch (c.kind) {
      case "lead":
        text = labels.takesLead(name(c.a));
        break;
      case "swap":
        text = labels.swapped(name(c.a), name(c.b));
        break;
      case "finalLap":
        text = labels.finalLap;
        break;
      case "winner":
        text = labels.wins(name(c.a));
        break;
      default:
        text = labels.passes(name(c.a), name(c.b));
    }
    const age = t - c.atMs;
    const pop = Math.min(1, age / 150);
    const fade = age > CALLOUT_MS - 300 ? Math.max(0, (CALLOUT_MS - age) / 300) : 1;
    const color = c.kind === "finalLap" ? ACCENT : (race?.colors[c.a] ?? ACCENT);
    const fs = 0.034 * S * (0.85 + 0.15 * pop);
    ctx.font = `bold ${fs}px sans-serif`;
    const maxW = (TRACK_X1 - TRACK_X0) * S;
    const shown = this.fit(ctx, text, maxW - 1.6 * fs, fs);
    const tw = ctx.measureText(shown).width;
    const w = tw + 1.8 * fs;
    const h = 1.5 * fs;
    const x = (track.left + track.right) / 2;
    const y = f.top + 0.06 * S + insetTop + 0.5 * h;
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, 0.08 * fs);
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2 + 0.45 * fs, y - 0.22 * fs, 0.44 * fs, 0.44 * fs);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(shown, x + 0.25 * fs, y + 0.04 * fs);
    ctx.globalAlpha = 1;
  }

  private drawCountdown(ctx: CanvasRenderingContext2D, view: RaceView, labels: RaceLabels, t: number) {
    const track = view.track!;
    const S = track.field.size;
    let text = "";
    let color = "#ffffff";
    let age = 0;
    if (view.phase === "countdown") {
      const beat = Math.min(2, Math.floor(t / COUNT_BEAT_MS));
      text = String(3 - beat);
      color = beat === 0 ? "#ef4444" : beat === 1 ? "#f59e0b" : "#facc15";
      age = t - beat * COUNT_BEAT_MS;
    } else if (t - view.goAtMs < 700) {
      text = labels.go;
      color = ACCENT;
      age = t - view.goAtMs;
    }
    if (!text) return;
    const scale = 1.25 - 0.25 * Math.min(1, age / 200);
    const fs = 0.2 * S * scale;
    const x = (track.left + track.right) / 2;
    const y = track.field.cy;
    ctx.font = `900 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, 0.08 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.globalAlpha = view.phase === "countdown" ? 1 : Math.max(0, 1 - (t - view.goAtMs) / 700);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  private shapeAt(ctx: CanvasRenderingContext2D, view: RaceView, race: CanvasRaceOptions | null, i: number, x: number, y: number, h: number) {
    const color = race?.colors[i] ?? "#ffffff";
    ctx.fillStyle = color;
    ctx.strokeStyle = darker(color);
    ctx.lineWidth = Math.max(1.5, 0.12 * h);
    if (view.settings.shape === "square") roundRect(ctx, x - h, y - h, 2 * h, 2 * h, 0.3 * h);
    else {
      ctx.beginPath();
      ctx.arc(x, y, h, 0, TWO_PI);
    }
    ctx.fill();
    ctx.stroke();
    const sprite = this.emojiSprite(race?.emoji[i] ?? "");
    if (sprite) ctx.drawImage(sprite, x - 0.85 * h, y - 0.85 * h, 1.7 * h, 1.7 * h);
  }

  private dim(ctx: CanvasRenderingContext2D, view: RaceView, alpha: number) {
    const f = view.track!.field;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#020617";
    ctx.fillRect(f.left, f.top, f.size, f.size);
    ctx.globalAlpha = 1;
  }

  /** 1st / 2nd / 3rd on their steps (rising in), the rest of the order below. */
  private drawPodium(ctx: CanvasRenderingContext2D, view: RaceView, race: CanvasRaceOptions | null, labels: RaceLabels, t: number) {
    const track = view.track!;
    const f = track.field;
    const S = f.size;
    const age = Math.max(0, t - view.completeAtMs);
    this.dim(ctx, view, Math.min(0.62, age / 400));
    const rise = Math.min(1, age / 600);
    const ease = 1 - (1 - rise) * (1 - rise);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${0.075 * S}px sans-serif`;
    ctx.fillStyle = "#facc15";
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = 18;
    ctx.fillText(labels.podium, f.cx, f.top + 0.11 * S);
    ctx.shadowBlur = 0;
    const order = view.finishOrder;
    const steps: { slot: number; height: number; color: string }[] = [
      { slot: 1, height: 0.2, color: "#cbd5e1" },
      { slot: 0, height: 0.28, color: "#facc15" },
      { slot: 2, height: 0.14, color: "#d97706" },
    ];
    const bw = 0.2 * S;
    const baseY = f.top + 0.72 * S;
    steps.forEach((step, col) => {
      const i = order[step.slot];
      if (i === undefined) return;
      const x = f.cx + (col - 1) * (bw + 0.02 * S);
      const h = step.height * S * ease;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = step.color;
      roundRect(ctx, x - bw / 2, baseY - h, bw, h, 0.01 * S);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#0f172a";
      ctx.font = `900 ${0.05 * S}px sans-serif`;
      if (h > 0.06 * S) ctx.fillText(labels.place(step.slot + 1), x, baseY - h + 0.045 * S);
      const sy = baseY - h - 0.06 * S;
      this.shapeAt(ctx, view, race, i, x, sy, 0.04 * S);
      if (step.slot === 0) this.crown(ctx, x, sy - 0.055 * S, 0.035 * S);
      ctx.font = `bold ${0.032 * S}px sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      const name = this.fit(ctx, race?.names[i] ?? `#${i + 1}`, bw, 0.032 * S);
      ctx.fillText(name, x, baseY + 0.035 * S);
      ctx.font = `${0.025 * S}px sans-serif`;
      ctx.fillStyle = "#a1a1aa";
      const time = step.slot === 0 ? formatTime(view.finishMs[i]) : formatGap(view.finishMs[i] - view.finishMs[order[0]]);
      ctx.fillText(time, x, baseY + 0.07 * S);
    });
    // The rest of the order, two columns.
    const rest = view.order.slice(3, 11);
    if (rest.length > 0) {
      ctx.font = `${0.022 * S}px sans-serif`;
      ctx.textAlign = "left";
      rest.forEach((i, k) => {
        const col = k % 2;
        const row = Math.floor(k / 2);
        const x = f.left + (0.12 + 0.42 * col) * S;
        const y = f.top + (0.86 + 0.032 * row) * S;
        const place = view.place[i];
        ctx.fillStyle = race?.colors[i] ?? "#fff";
        ctx.fillRect(x, y - 0.008 * S, 0.016 * S, 0.016 * S);
        ctx.fillStyle = "#e4e4e7";
        const text = `${4 + k}. ${race?.names[i] ?? `#${i + 1}`}  ${place < 0 ? labels.dnf : formatGap(view.finishMs[i] - view.finishMs[order[0]])}`;
        ctx.fillText(this.fit(ctx, text, 0.36 * S, 0.022 * S), x + 0.025 * S, y);
      });
    }
  }

  /** The cup table: the title, the race number, every racer's points with what this race gave. */
  private drawCup(ctx: CanvasRenderingContext2D, view: RaceView, race: CanvasRaceOptions, labels: RaceLabels, t: number) {
    const track = view.track!;
    const f = track.field;
    const S = f.size;
    const key = cupRunKey(race, view);
    if (this.cupFor !== key || this.cupSource !== race.cup) {
      this.cupFor = key;
      this.cupSource = race.cup;
      this.cupTable = addRaceToCup(race.cup, raceResultOf(view), key);
      rankCup(this.cupTable, this.cupOrder);
    }
    const cup = this.cupTable!;
    this.dim(ctx, view, 0.8);
    const age = Math.max(0, t - view.cupAtMs);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${0.06 * S}px sans-serif`;
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 16;
    ctx.fillText(this.fit(ctx, `🏆 ${race.cupTitle}`.toUpperCase(), 0.92 * S, 0.06 * S), f.cx, f.top + 0.08 * S);
    ctx.shadowBlur = 0;
    ctx.font = `bold ${0.03 * S}px sans-serif`;
    ctx.fillStyle = "#d4d4d8";
    ctx.fillText(labels.race(cup.races), f.cx, f.top + 0.14 * S);
    const n = cup.racers;
    const rh = Math.min(0.05 * S, (0.78 * S) / Math.max(1, n));
    const fs = 0.62 * rh;
    const x0 = f.left + 0.14 * S;
    const x1 = f.right - 0.14 * S;
    const result = raceResultOf(view);
    for (let k = 0; k < this.cupOrder.length; k++) {
      const i = this.cupOrder[k];
      const y = f.top + 0.19 * S + k * rh + 0.5 * rh;
      const show = Math.max(0, Math.min(1, (age - 60 * k) / 250));
      if (show <= 0) continue;
      ctx.globalAlpha = show;
      if (k % 2 === 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        ctx.fillRect(x0 - 0.02 * S, y - 0.5 * rh, x1 - x0 + 0.04 * S, rh);
      }
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = "right";
      ctx.fillStyle = k < 3 ? "#facc15" : "#d4d4d8";
      ctx.fillText(String(k + 1), x0 + 1.2 * fs, y);
      ctx.fillStyle = race.colors[i] ?? "#fff";
      ctx.fillRect(x0 + 1.6 * fs, y - 0.35 * fs, 0.7 * fs, 0.7 * fs);
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.font = `${fs}px sans-serif`;
      ctx.fillText(this.fit(ctx, race.names[i] ?? `#${i + 1}`, x1 - x0 - 8 * fs, fs), x0 + 2.7 * fs, y);
      const gained = racePoints(result, i);
      ctx.textAlign = "right";
      ctx.font = `bold ${0.85 * fs}px sans-serif`;
      ctx.fillStyle = gained > 0 ? "#a3e635" : "#52525b";
      ctx.fillText(gained > 0 ? `+${gained}` : "·", x1 - 3.2 * fs, y);
      ctx.font = `900 ${fs}px sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`${cup.points[i]} ${labels.points}`, x1, y);
    }
    ctx.globalAlpha = 1;
  }
}

/** The data-race-* attributes the canvas mirrors for tools and the smoke test. */
export const RACE_DATA_KEYS = ["raceRacers", "racePhase", "raceLeader", "raceWinner", "raceFinished", "racePasses", "raceSwaps", "raceBoosts", "raceHits", "raceLap", "raceCamera", "raceOrder", "raceCallouts"];

export function writeRaceDataset(view: RaceView, set: (key: string, value: string) => void) {
  let finished = 0;
  for (let i = 0; i < view.racers; i++) if (view.place[i] > 0) finished++;
  set("raceRacers", String(view.racers));
  set("racePhase", view.phase);
  set("raceLeader", String(view.leader));
  set("raceWinner", String(view.winner));
  set("raceFinished", String(finished));
  set("racePasses", String(view.passes));
  set("raceSwaps", String(view.swaps));
  set("raceBoosts", String(view.boosts));
  set("raceHits", String(view.hits));
  set("raceLap", String(view.racers > 0 ? view.lap[view.leader] : 1));
  set("raceCamera", String(Math.round(view.cameraY)));
  set("raceOrder", view.order.join(","));
  set("raceCallouts", String(view.calloutCount));
}
