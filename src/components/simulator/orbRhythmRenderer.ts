/**
 * --- orb-rhythm --- Bouncing Orbs' visual metronome (feature orb-rhythm; the mode is lib/physics/modes/orbGrid.ts, its
 * rhythm model lib/physics/modes/orbRhythm.ts, the field's drawing orbGridRenderer.ts, which calls these). Three styles,
 * every one timed by the frame's simulation time (so it swings as smoothly as the orbs bounce, and a fast export draws it
 * at the exact frame times):
 *
 * - **bar** – a pendulum hanging from the top of the exported square swings from side to side, reaching an end exactly on
 *   every beat (θ = −θmax · cos(π t / beat)); the end it reaches flashes – lime on the downbeat, white on the other beats –
 *   and a dot per beat of the bar under the scale shows where in the bar the beat is.
 * - **ring** – a ring on the floor around the field pulses on every beat (brighter and wider, lime on the downbeat).
 * - **dot** – a strip of beat cells at the bottom of the square: a dot hops from cell to cell, landing on every beat.
 *
 * Pure canvas drawing, no per-frame allocation: the boxes the styles cover are written into caller-owned objects (the
 * canvas mirrors them as data-og-metro-box for the smoke test).
 */

/** The swing's half angle (radians) and the pendulum's size (shares of the square's side). */
export const SWING_MAX = (32 * Math.PI) / 180;
export const BAR_PIVOT_Y = 0.02;
export const BAR_LENGTH = 0.11;
export const BAR_BOB = 0.017;
/** How fast a beat's flash or pulse dies away (per beat). */
export const PULSE_DECAY = 5;
/** The beat cells a strip draws at most (more beats a bar share the cells). */
export const MAX_BEAT_CELLS = 32;
/** The accent (the downbeat) and an ordinary beat's colour. */
export const METRO_ACCENT = "#a3e635";
export const METRO_BEAT = "#ffffff";

export interface MetroBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BeatState {
  /** Beats so far (the downbeat at 0 is beat 0). */
  index: number;
  /** The beat's place in its bar (0 = the downbeat). */
  inBar: number;
  /** Seconds since the beat and its share of the beat (0–1). */
  since: number;
  progress: number;
  /** 1 on the beat, dying away towards the next one. */
  pulse: number;
}

/** Where `tSec` falls in the metronome's beats (`beatSec` a beat, `beats` a bar), into `out`. */
export function beatState(tSec: number, beatSec: number, beats: number, out: BeatState): BeatState {
  const b = beatSec > 0 && tSec >= 0 ? Math.floor(tSec / beatSec + 1e-9) : 0;
  const since = beatSec > 0 ? Math.max(0, tSec - b * beatSec) : 0;
  out.index = b;
  out.inBar = b % Math.max(1, Math.round(beats));
  out.since = since;
  out.progress = beatSec > 0 ? Math.min(1, since / beatSec) : 0;
  out.pulse = Math.exp(-PULSE_DECAY * out.progress);
  return out;
}

/** The pendulum's angle at `tSec` (radians, 0 = straight down): an end (±SWING_MAX) exactly on every beat, alternating sides. */
export function swingAngle(tSec: number, beatSec: number): number {
  return beatSec > 0 ? -SWING_MAX * Math.cos((Math.PI * tSec) / beatSec) : 0;
}

/** The dot strip's hop at `progress` (the share of the beat gone, 0–1): its height (0–1), a parabola landing on every beat. */
export function dotHopHeight(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return 4 * p * (1 - p);
}

/** The colour of a beat: the accent on the downbeat. */
export function beatColor(inBar: number): string {
  return inBar === 0 ? METRO_ACCENT : METRO_BEAT;
}

const TWO_PI = Math.PI * 2;

/**
 * The bar: a pendulum hanging from the top centre of the square (`cx`, `top`, `side` in world px) – its scale arc, the two
 * ends (the one just reached flashing in the beat's colour), the rod and the bob – and a dot per beat of the bar under it.
 * Writes the box it covers into `out`.
 */
export function drawMetronomeBar(ctx: CanvasRenderingContext2D, cx: number, top: number, side: number, tSec: number, beatSec: number, beats: number, beat: BeatState, out: MetroBox) {
  const pivotY = top + BAR_PIVOT_Y * side;
  const len = BAR_LENGTH * side;
  const bob = Math.max(2, BAR_BOB * side);
  const angle = swingAngle(tSec, beatSec);
  const reach = Math.sin(SWING_MAX) * len;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";
  // The scale: an arc under the swing with a tick at either end.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = Math.max(1, 0.004 * side);
  ctx.beginPath();
  ctx.arc(cx, pivotY, len, Math.PI / 2 - SWING_MAX, Math.PI / 2 + SWING_MAX);
  ctx.stroke();
  // The end the bob reached on this beat flashes (a beat lands left on even beats, right on odd ones).
  const flashSide = beat.index % 2 === 0 ? -1 : 1;
  for (let sideSign = -1; sideSign <= 1; sideSign += 2) {
    const ex = cx + sideSign * reach;
    const ey = pivotY + Math.cos(SWING_MAX) * len;
    const lit = sideSign === flashSide ? beat.pulse : 0;
    ctx.fillStyle = lit > 0.02 ? beatColor(beat.inBar) : "rgba(255, 255, 255, 0.35)";
    ctx.globalAlpha = lit > 0.02 ? 0.35 + 0.65 * lit : 1;
    ctx.beginPath();
    ctx.arc(ex, ey, (0.45 + 0.35 * lit) * bob, 0, TWO_PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // The rod and the bob.
  const bx = cx + Math.sin(angle) * len;
  const by = pivotY + Math.cos(angle) * len;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = Math.max(1.5, 0.006 * side);
  ctx.beginPath();
  ctx.moveTo(cx, pivotY);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, pivotY, 0.4 * bob, 0, TWO_PI);
  ctx.fill();
  ctx.shadowColor = beatColor(beat.inBar);
  ctx.shadowBlur = 10 * beat.pulse;
  ctx.fillStyle = beat.pulse > 0.4 ? beatColor(beat.inBar) : "#e5e7eb";
  ctx.beginPath();
  ctx.arc(bx, by, bob, 0, TWO_PI);
  ctx.fill();
  ctx.shadowBlur = 0;
  // The beats of the bar: a dot each, the current one lit.
  const cells = Math.max(1, Math.min(MAX_BEAT_CELLS, Math.round(beats)));
  const dotY = pivotY + len + 2.2 * bob;
  const gap = Math.min(3 * bob, (2 * reach) / Math.max(1, cells - 1));
  const x0 = cx - (gap * (cells - 1)) / 2;
  const current = Math.min(cells - 1, Math.floor((beat.inBar * cells) / Math.max(1, Math.round(beats))));
  for (let j = 0; j < cells; j++) {
    const on = j === current;
    ctx.fillStyle = on ? beatColor(beat.inBar) : "rgba(255, 255, 255, 0.3)";
    ctx.beginPath();
    ctx.arc(x0 + j * gap, dotY, (on ? 0.42 : 0.3) * bob, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
  out.x = cx - reach - bob;
  out.y = top;
  out.w = 2 * (reach + bob);
  out.h = dotY + bob - top;
}

/**
 * The dot strip at the bottom of the square (`left`, `bottom`, `side`): a cell per beat of the bar (the downbeat's in the
 * accent), the current one lit, and a dot hopping to the next cell – landing exactly on the beat. Writes its box into `out`.
 */
export function drawMetronomeDots(ctx: CanvasRenderingContext2D, left: number, bottom: number, side: number, beats: number, beat: BeatState, out: MetroBox) {
  const cells = Math.max(1, Math.min(MAX_BEAT_CELLS, Math.round(beats)));
  const width = 0.5 * side;
  const cell = width / cells;
  const cellW = Math.max(2, 0.7 * cell);
  const cellH = Math.max(2, Math.min(0.025 * side, 0.45 * cell + 0.012 * side));
  const x0 = left + side / 2 - width / 2;
  const y = bottom - 0.05 * side;
  const per = Math.max(1, Math.round(beats)) / cells;
  const current = Math.min(cells - 1, Math.floor(beat.inBar / per));
  const next = (current + 1) % cells;
  ctx.save();
  ctx.globalAlpha = 1;
  for (let j = 0; j < cells; j++) {
    const on = j === current;
    ctx.fillStyle = on ? (j === 0 ? METRO_ACCENT : "rgba(255, 255, 255, 0.85)") : j === 0 ? "rgba(163, 230, 53, 0.35)" : "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(x0 + j * cell + (cell - cellW) / 2, y - cellH / 2, cellW, cellH);
  }
  const along = Math.max(0, Math.min(1, beat.progress));
  const fromX = x0 + (current + 0.5) * cell;
  const toX = x0 + (next + 0.5) * cell;
  const r = Math.max(2, 0.016 * side);
  const dx = fromX + (toX - fromX) * along;
  const dy = y - cellH / 2 - r - dotHopHeight(beat.progress) * 0.06 * side;
  ctx.shadowColor = beatColor(beat.inBar);
  ctx.shadowBlur = 8 * beat.pulse;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(dx, dy, r, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
  out.x = x0;
  out.y = y - cellH / 2 - 2 * r - 0.06 * side;
  out.w = width;
  out.h = cellH + 2 * r + 0.06 * side;
}

/** A frame's cost (ms) under which a rhythm field draws at the display's refresh (a 120 Hz display: 120 frames a second). */
export const ORB_HI_FPS_MAX_MS = 5;

/**
 * Whether a rhythm field may draw at the display's refresh rather than the canvas' 60 fps budget: its heights are analytic,
 * so every refresh shows new ones – while a frame costs little enough (an average under `ORB_HI_FPS_MAX_MS`, with a margin
 * before it falls back). A big field stays on the 60 fps budget, which it holds steadily (no frame pacing between 60 and 120).
 */
export class OrbFrameCost {
  private ema = 16;
  fast = false;

  note(ms: number) {
    if (!(ms >= 0) || !Number.isFinite(ms)) return;
    this.ema = 0.85 * this.ema + 0.15 * ms;
    this.fast = this.fast ? this.ema < 1.4 * ORB_HI_FPS_MAX_MS : this.ema < ORB_HI_FPS_MAX_MS;
  }
}
