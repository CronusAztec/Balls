import type { PolyrhythmView } from "@/lib/physics/modes/polyrhythm";
import { SPIRAL_TURNS } from "@/lib/physics/modes/polyrhythm";
// --- phase-spiral --- arms (k dots a ring on k spokes), comet tails, the spiral palette's disc and the in-line meter
import { dotVoice, polyPolygonsOn } from "@/lib/physics/modes/polyrhythm";
import { orbitLayout } from "@/lib/physics/phaseSpiral";
import { drawCometTails, drawInLineMeter, drawSpiralDisc, drawSpokes } from "./phaseSpiralRenderer";
import { endBannerPlateHeight } from "./endBanner"; // --- poly-banner ---

/**
 * Canvas drawing of the Metronomes & Polyrhythms mode (lib/physics/modes/polyrhythm.ts): the stage of the layout
 * (the rings or rotating polygons with the 12 o'clock tick line, the big circle and its chords, the semicircles and
 * their baseline, the metronome bodies, the spiral the tick points lie on), the voices (comet tails on the orbits,
 * the metronome arms, the dots in their rainbow colours with a flash on every tick and a ring on accents, optional
 * ratio numbers) and the full-screen flash of an alignment. Called from Canvas.tsx inside the camera transform
 * (stage, voices) and outside it (the flash). Everything reads the positions the mode computed for the step, draws
 * batched paths where the colour is shared and allocates nothing per frame, so 400 voices at 1080×1920 stay inside
 * the frame budget; above `COLOURED_GUIDES_MAX` voices the guides share one path in the wall colour.
 */

export interface PolyrhythmRenderOptions {
  /** The canvas' wall colour function (rainbow walls apply), with an optional alpha. */
  wallColor: (index: number, alpha?: number) => string;
  wallThickness: number;
  showGlow: boolean;
  // --- phase-spiral ---
  /** The meter's words ("in line 87%"; English without it). */
  inLineLabel?: (pct: number) => string;
  /** The loop HUD shows the meter (its counter and bar): the canvas leaves it out under the disc. */
  meterInHud?: boolean;
  // --- poly-hold ---
  /** Frame time a finished run has been held on screen (`PolyrhythmHoldClock`): every flash keeps fading through it. */
  heldMs?: number;
}

const TWO_PI = Math.PI * 2;
/** How long a dot (and its ring) stays brightened after a tick (simulation ms). */
export const TICK_FLASH_MS = 220;
/** How long the screen flash of an alignment lasts (simulation ms). */
export const ALIGN_FLASH_MS = 480;
/** Up to this many voices get a guide (ring, chord, arc) in their own colour; more share one path. */
export const COLOURED_GUIDES_MAX = 64;
/** Up to this many voices the orbiting dots draw comet tails. */
export const TAILS_MAX = 160;
/** Up to this many voices the numbers are drawn (when switched on). */
export const NUMBERS_MAX = 120;

/**
 * Simulation ms since the step count `step` was reached (Infinity for −1, "never"), plus `heldMs`: the frame time a finished
 * run has been held since its last step (--- poly-hold ---).
 */
export function stepsAgoMs(view: PolyrhythmView, step: number, heldMs = 0): number {
  return step < 0 ? Infinity : (view.step - step) * view.stepMs + heldMs;
}

/** 1 right after a tick, fading to 0 over `TICK_FLASH_MS` (of steps, then of a finished run's held frames). */
export function tickFlash(view: PolyrhythmView, i: number, heldMs = 0): number {
  const age = stepsAgoMs(view, view.lastTickStep[i], heldMs);
  return age < TICK_FLASH_MS ? 1 - age / TICK_FLASH_MS : 0;
}

// --- poly-hold --- (round two, B1) a finished run's flashes fade on the frames' own time
/**
 * The frame time a finished run has been on screen since its last step. The mode stops its steps at the finish, so an age
 * counted in steps stands still there: the alignment of the last step kept the frame washed 38 % white, and its ticks kept
 * every dot and guide lit, through the end hold and every later redraw of the run (a still past the finish, a recording's
 * tail). The canvas keeps one clock and adds its ms to every age, so they fade as if the steps went on. It counts the frames'
 * own time (the caller's `dtMs`, as the end banner's entrance does: the frame time live, the export's frame time offline, 0
 * while paused), never the wall clock, so the same frames draw the same fade everywhere. A run that still plays reads 0: its
 * flashes age by its steps alone, as they always did.
 */
export class PolyrhythmHoldClock {
  private generation = -1;
  private step = -1;
  ms = 0;

  /** The frame's held ms for `view`, `dtMs` of frame time after the frame before: once per frame, before it is drawn. */
  frame(view: PolyrhythmView, dtMs: number): number {
    if (!view.finished || view.generation !== this.generation || view.step !== this.step) {
      // a run that plays, a new run, or the frame of the finishing step itself: nothing held yet
      this.generation = view.generation;
      this.step = view.step;
      this.ms = 0;
    } else if (dtMs > 0) this.ms += dtMs;
    return this.ms;
  }
}
// --- end poly-hold ---

// --- poly-banner --- (round two, B1) IN PHASE! clear of the voices it is about
/** Canvas.tsx keeps a banner with a place of its own between 2 % and 98 % of the square. */
const BANNER_EDGE = 0.02;
/** The narrowest the chords' plate gets (a share of the square): the title shrinks no further than to about three quarters. */
const BANNER_MIN_WIDTH = 0.4;

/** How far a dot's glow reaches around its centre (drawPolyrhythmVoices()): what a plate keeps clear of. */
function dotReach(view: PolyrhythmView): number {
  return 1.7 * (view.geometry?.dotRadius ?? 0) + 2;
}

/**
 * Where the centre of IN PHASE!'s plate goes on the arcs, as a share of the square (`side` px, centred on the stage as the
 * canvas' square is) for a plate `height` px tall; undefined for the other layouts (the canvas keeps the rings' lower half
 * and the middle for the rest). At the payoff every dot has just ended its path – the semicircles' on the baseline, the
 * chords' on the big circle's rim (the last step carries each a little on) – so:
 *  - semicircles: in the band under the baseline, below the voices; with no room there (a big ball, a short square, words
 *    on two lines) over the arcs, above the highest dot;
 *  - chords: in the middle of the circle, its words narrowed by `polyrhythmBannerWidth()` to the room between the dots on
 *    the rim. The circle fills the square from 6 % to 94 %, so there is no room under it, and at its full width the plate hid
 *    the middle voices on both sides.
 * It reads where the finished run's dots are (they stand still from the finish).
 */
export function polyrhythmBannerAt(view: PolyrhythmView, side: number, height: number): number | undefined {
  const g = view.geometry;
  if (!g || g.layout !== "arcs") return undefined;
  const S = Math.max(1, side);
  if (g.arcStyle === "chords") return 0.5; // (the circle's centre is the square's)
  const glow = dotReach(view);
  const gap = 0.01 * S;
  let highest = g.baselineY - 2 * g.dotRadius;
  let lowest = g.baselineY + 2 * g.dotRadius; // (the baseline is drawn a dot's radius under the dots on it)
  for (let d = 0; d < view.dotCount; d++) {
    highest = Math.min(highest, view.dotY[d] - glow);
    lowest = Math.max(lowest, view.dotY[d] + glow);
  }
  const below = lowest + gap;
  const bottom = g.cy + (0.5 - BANNER_EDGE) * S;
  const y = bottom - below >= height ? (below + bottom) / 2 : highest - gap - height / 2;
  return 0.5 + (y - g.cy) / S;
}

/**
 * The widest IN PHASE!'s plate may be (px) on the chords, so it keeps inside the finished run's dots on the rim: no dot (nor
 * its glow) in the rows the plate can cover (at its tallest: a title and two lines under it) is within its width; never
 * narrower than BANNER_MIN_WIDTH of the square. Undefined for the other layouts and arc styles, and when no dot is in those
 * rows (the words keep their 84 %).
 */
export function polyrhythmBannerWidth(view: PolyrhythmView, side: number): number | undefined {
  const g = view.geometry;
  if (!g || g.layout !== "arcs" || g.arcStyle !== "chords") return undefined;
  const glow = dotReach(view);
  const reach = endBannerPlateHeight(side, 2) / 2 + glow;
  let half = Infinity;
  for (let d = 0; d < view.dotCount; d++) if (Math.abs(view.dotY[d] - g.cy) < reach) half = Math.min(half, Math.abs(view.dotX[d] - g.cx) - glow);
  return Number.isFinite(half) ? Math.max(2 * half, BANNER_MIN_WIDTH * Math.max(1, side)) : undefined;
}
// --- end poly-banner ---

function polygonPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, sides: number, rotation: number) {
  for (let k = 0; k <= sides; k++) {
    const a = rotation + (TWO_PI * k) / sides;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Adds voice `i`'s guide (ring / polygon, chord or semicircle) to the current path. */
function guidePath(ctx: CanvasRenderingContext2D, view: PolyrhythmView, i: number, polygons: boolean) {
  const g = view.geometry!;
  const r = g.radius[i];
  if (g.layout === "rings") {
    const sides = polygons ? view.sides[i] : 0;
    if (sides >= 3) polygonPath(ctx, g.cx, g.cy, r, sides, view.polygonAngle);
    else {
      ctx.moveTo(g.cx + r, g.cy);
      ctx.arc(g.cx, g.cy, r, 0, TWO_PI);
    }
    // Closed, so a ring has no line caps (hundreds of them would line up into a seam at 3 o'clock).
    ctx.closePath();
  } else if (g.layout === "arcs") {
    if (g.arcStyle === "chords") {
      ctx.moveTo(g.anchorX[i] - r, g.anchorY[i]);
      ctx.lineTo(g.anchorX[i] + r, g.anchorY[i]);
    } else {
      ctx.moveTo(g.cx - r, g.baselineY);
      ctx.arc(g.cx, g.baselineY, r, Math.PI, TWO_PI);
    }
  }
}

/** The stage of the layout: guides in the voices' colours (brightened on a tick), tick line, circle, baseline, metronome bodies or spiral. */
export function drawPolyrhythmStage(ctx: CanvasRenderingContext2D, view: PolyrhythmView, o: PolyrhythmRenderOptions) {
  const g = view.geometry;
  if (!g || view.count === 0) return;
  const n = view.count;
  const thick = Math.max(1, o.wallThickness);
  const polygons = polyPolygonsOn(view.settings, view.arms); // --- phase-spiral --- (k arms ride plain circles)
  const faint = view.settings.palette === "spiral" && orbitLayout(g.layout); // --- phase-spiral --- (faint guides on a dark disc)
  const held = o.heldMs ?? 0; // --- poly-hold ---
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (faint) drawSpiralDisc(ctx, view); // --- phase-spiral ---
  if (g.layout === "rings" || g.layout === "arcs") {
    // Guides: thin enough that 400 of them do not merge into a disc.
    const spacing = g.layout === "arcs" && g.arcStyle === "chords" ? (n > 1 ? (1.84 * g.outerRadius) / (n - 1) : g.outerRadius) : n > 1 ? (g.outerRadius - g.innerRadius) / (n - 1) : g.outerRadius;
    const width = Math.max(0.5, Math.min(thick, 0.4 * spacing));
    ctx.lineWidth = width;
    if (n <= COLOURED_GUIDES_MAX) {
      for (let i = 0; i < n; i++) {
        const flash = tickFlash(view, i, held);
        ctx.globalAlpha = faint ? 0.1 + 0.15 * flash : 0.24 + 0.6 * flash; // --- phase-spiral --- (faint on the dark disc, so the comet tails stand out)
        ctx.strokeStyle = view.colors[i];
        ctx.lineWidth = width * (1 + (faint ? 0.3 : 0.8) * flash);
        ctx.beginPath();
        guidePath(ctx, view, i, polygons);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = o.wallColor(0);
      ctx.beginPath();
      for (let i = 0; i < n; i++) guidePath(ctx, view, i, polygons);
      ctx.stroke();
      // Only the guides that just ticked are drawn again, in their colour.
      for (let i = 0; i < n; i++) {
        const flash = tickFlash(view, i, held);
        if (flash <= 0.02) continue;
        ctx.globalAlpha = 0.6 * flash;
        ctx.strokeStyle = view.colors[i];
        ctx.beginPath();
        guidePath(ctx, view, i, polygons);
        ctx.stroke();
      }
    }
    ctx.lineWidth = thick;
    if (g.layout === "rings" && view.arms > 1) {
      // --- phase-spiral --- the k spokes the arms tick on, glowing with the latest tick
      const age = stepsAgoMs(view, view.lastAnyTickStep, held);
      drawSpokes(ctx, view, age < TICK_FLASH_MS ? 1 - age / TICK_FLASH_MS : 0);
    } else if (g.layout === "rings") {
      // The 12 o'clock line every dot ticks on, glowing with the latest tick.
      const age = stepsAgoMs(view, view.lastAnyTickStep, held);
      const pulse = age < TICK_FLASH_MS ? 1 - age / TICK_FLASH_MS : 0;
      ctx.globalAlpha = 0.3 + 0.5 * pulse;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 + pulse;
      ctx.beginPath();
      ctx.moveTo(g.cx, g.cy - Math.max(0, g.innerRadius - 2 * g.dotRadius));
      ctx.lineTo(g.cx, g.cy - g.outerRadius - 2 * g.dotRadius);
      ctx.stroke();
    } else if (g.arcStyle === "chords") {
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = thick + 1;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.outerRadius, 0, TWO_PI);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = thick + 1;
      ctx.beginPath();
      ctx.moveTo(g.cx - g.outerRadius - 2 * g.dotRadius, g.baselineY + g.dotRadius);
      ctx.lineTo(g.cx + g.outerRadius + 2 * g.dotRadius, g.baselineY + g.dotRadius);
      ctx.stroke();
    }
  } else if (g.layout === "spiral") {
    // The spiral the tick points lie on: the dots redraw it at every alignment.
    const align = stepsAgoMs(view, view.lastAlignStep, held);
    const pulse = align < ALIGN_FLASH_MS ? 1 - align / ALIGN_FLASH_MS : 0;
    ctx.globalAlpha = 0.35 + 0.5 * pulse;
    ctx.strokeStyle = o.wallColor(0);
    ctx.lineWidth = thick;
    ctx.beginPath();
    const samples = 120;
    // --- phase-spiral --- one spiral per arm, 2π / k apart (the dots of every arm tick on their own)
    for (let m = 0; m < view.arms; m++) {
      const offset = (TWO_PI * m) / view.arms;
      for (let k = 0; k <= samples; k++) {
        const f = k / samples;
        const r = g.innerRadius + (g.outerRadius - g.innerRadius) * f;
        const a = -Math.PI / 2 + view.direction * TWO_PI * SPIRAL_TURNS * f + offset;
        const x = g.cx + r * Math.cos(a);
        const y = g.cy + r * Math.sin(a);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = o.wallColor(0);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, Math.max(2, 0.5 * g.dotRadius), 0, TWO_PI);
    ctx.fill();
  } else {
    // Metronome bodies: one path for all of them (a tall trapezoid behind every arm).
    const c = g.cell;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = g.anchorX[i];
      const py = g.anchorY[i];
      ctx.moveTo(px - 0.27 * c, py + 0.1 * c);
      ctx.lineTo(px + 0.27 * c, py + 0.1 * c);
      ctx.lineTo(px + 0.09 * c, py - 0.7 * c);
      ctx.lineTo(px - 0.09 * c, py - 0.7 * c);
      ctx.closePath();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = o.wallColor(0, 0.07);
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = o.wallColor(0);
    ctx.lineWidth = Math.max(0.75, Math.min(thick, 0.02 * c));
    ctx.stroke();
  }
  ctx.restore();
}

/** The voices: comet tails (rings, spiral), metronome arms, the dots with tick flashes, accent rings and numbers. */
export function drawPolyrhythmVoices(ctx: CanvasRenderingContext2D, view: PolyrhythmView, o: PolyrhythmRenderOptions) {
  const g = view.geometry;
  const series = view.series;
  if (!g || !series || view.count === 0) return;
  const n = view.count;
  const r = g.dotRadius;
  const held = o.heldMs ?? 0; // --- poly-hold ---
  ctx.save();
  ctx.lineCap = "round";
  if ((g.layout === "rings" && !polyPolygonsOn(view.settings, view.arms)) || g.layout === "spiral") {
    // --- phase-spiral --- comet tails as long as the dot travels in the Trail's seconds (the classic 0.18 s, at most 70°), in
    // fading bands, on every dot of every arm (phaseSpiralRenderer.ts; up to TAILS_MAX voices and TAIL_DOTS_MAX dots)
    if (n <= TAILS_MAX) drawCometTails(ctx, view, r);
  } else if (g.layout === "metronomes") {
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = Math.max(1, 0.035 * g.cell);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const theta = view.param[i];
      ctx.moveTo(g.anchorX[i], g.anchorY[i]);
      ctx.lineTo(g.anchorX[i] + g.armLength * Math.sin(theta), g.anchorY[i] - g.armLength * Math.cos(theta));
    }
    ctx.stroke();
  }
  // --- phase-spiral --- every dot (dot d of voice ⌊d / arms⌋; with one arm the voices themselves)
  const dots = view.dotCount;
  const arms = view.arms;
  // Glow: an enlarged translucent disc (cheaper than a shadow blur), brighter right after a tick.
  for (let d = 0; d < dots; d++) {
    const i = dotVoice(d, arms);
    const flash = tickFlash(view, i, held);
    const glow = (o.showGlow ? 0.45 : 0) + 0.7 * flash;
    if (glow <= 0.01) continue;
    ctx.globalAlpha = 0.25 * glow;
    ctx.fillStyle = view.colors[i];
    ctx.beginPath();
    ctx.arc(view.dotX[d], view.dotY[d], r * (1.7 + 0.6 * flash) + 2, 0, TWO_PI);
    ctx.fill();
  }
  // Bodies, a white core flash and an accent ring.
  for (let d = 0; d < dots; d++) {
    const i = dotVoice(d, arms);
    const flash = tickFlash(view, i, held);
    const rr = r * (1 + 0.35 * flash);
    ctx.globalAlpha = 1;
    ctx.fillStyle = view.colors[i];
    ctx.beginPath();
    ctx.arc(view.dotX[d], view.dotY[d], rr, 0, TWO_PI);
    ctx.fill();
    if (flash > 0.02) {
      ctx.globalAlpha = 0.6 * flash;
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      if (view.lastTickAccent[i]) {
        ctx.globalAlpha = flash;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, 0.25 * r);
        ctx.beginPath();
        ctx.arc(view.dotX[d], view.dotY[d], rr + 0.9 * r * (1 - flash) + 2, 0, TWO_PI);
        ctx.stroke();
      }
    }
  }
  if (view.settings.numbers && n <= NUMBERS_MAX) {
    const inside = r >= 6;
    const fs = inside ? Math.max(7, 1.05 * r) : 9;
    ctx.globalAlpha = inside ? 0.9 : 0.8;
    ctx.fillStyle = inside ? "#0a0a0a" : "#ffffff";
    ctx.font = `bold ${fs.toFixed(1)}px sans-serif`;
    ctx.textAlign = inside ? "center" : "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) ctx.fillText(view.labels[i], inside ? view.x[i] : view.x[i] + r + 2, view.y[i] + (inside ? 0.05 * fs : 0));
  }
  ctx.restore();
  // --- phase-spiral --- "in line N %" under the disc, unless the loop HUD shows it
  if (view.settings.alignMeter && !o.meterInHud) drawInLineMeter(ctx, view, o.inLineLabel);
}

/**
 * The white full-screen flash of an alignment – every voice ticking at once (screen space, outside the camera transform).
 * `heldMs` (--- poly-hold ---): the frame time a finished run has been held, so the last alignment's flash fades in the hold.
 */
export function drawPolyrhythmAlignFlash(ctx: CanvasRenderingContext2D, width: number, height: number, view: PolyrhythmView, heldMs = 0) {
  const age = stepsAgoMs(view, view.lastAlignStep, heldMs);
  if (age >= ALIGN_FLASH_MS) return;
  const a = 0.38 * (1 - age / ALIGN_FLASH_MS);
  if (a < 0.005) return;
  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
