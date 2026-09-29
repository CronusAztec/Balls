import type { PolyrhythmView } from "@/lib/physics/modes/polyrhythm";
import { SPIRAL_TURNS } from "@/lib/physics/modes/polyrhythm";

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

/** Simulation ms since the step count `step` was reached (Infinity for −1, "never"). */
export function stepsAgoMs(view: PolyrhythmView, step: number): number {
  return step < 0 ? Infinity : (view.step - step) * view.stepMs;
}

/** 1 right after a tick, fading to 0 over `TICK_FLASH_MS`. */
export function tickFlash(view: PolyrhythmView, i: number): number {
  const age = stepsAgoMs(view, view.lastTickStep[i]);
  return age < TICK_FLASH_MS ? 1 - age / TICK_FLASH_MS : 0;
}

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
  const polygons = view.settings.polygon && g.layout === "rings";
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (g.layout === "rings" || g.layout === "arcs") {
    // Guides: thin enough that 400 of them do not merge into a disc.
    const spacing = g.layout === "arcs" && g.arcStyle === "chords" ? (n > 1 ? (1.84 * g.outerRadius) / (n - 1) : g.outerRadius) : n > 1 ? (g.outerRadius - g.innerRadius) / (n - 1) : g.outerRadius;
    const width = Math.max(0.5, Math.min(thick, 0.4 * spacing));
    ctx.lineWidth = width;
    if (n <= COLOURED_GUIDES_MAX) {
      for (let i = 0; i < n; i++) {
        const flash = tickFlash(view, i);
        ctx.globalAlpha = 0.24 + 0.6 * flash;
        ctx.strokeStyle = view.colors[i];
        ctx.lineWidth = width * (1 + 0.8 * flash);
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
        const flash = tickFlash(view, i);
        if (flash <= 0.02) continue;
        ctx.globalAlpha = 0.6 * flash;
        ctx.strokeStyle = view.colors[i];
        ctx.beginPath();
        guidePath(ctx, view, i, polygons);
        ctx.stroke();
      }
    }
    ctx.lineWidth = thick;
    if (g.layout === "rings") {
      // The 12 o'clock line every dot ticks on, glowing with the latest tick.
      const age = stepsAgoMs(view, view.lastAnyTickStep);
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
    const align = stepsAgoMs(view, view.lastAlignStep);
    const pulse = align < ALIGN_FLASH_MS ? 1 - align / ALIGN_FLASH_MS : 0;
    ctx.globalAlpha = 0.35 + 0.5 * pulse;
    ctx.strokeStyle = o.wallColor(0);
    ctx.lineWidth = thick;
    ctx.beginPath();
    const samples = 120;
    for (let k = 0; k <= samples; k++) {
      const f = k / samples;
      const r = g.innerRadius + (g.outerRadius - g.innerRadius) * f;
      const a = -Math.PI / 2 + view.direction * TWO_PI * SPIRAL_TURNS * f;
      const x = g.cx + r * Math.cos(a);
      const y = g.cy + r * Math.sin(a);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
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
  const dir = view.direction;
  ctx.save();
  ctx.lineCap = "round";
  if ((g.layout === "rings" && !view.settings.polygon) || g.layout === "spiral") {
    if (n <= TAILS_MAX) {
      ctx.lineWidth = Math.max(1, 0.9 * r);
      for (let i = 0; i < n; i++) {
        // A tail as long as the dot travels in 0.18 s, at most 70°.
        const perSecond = series.a[i] / series.D;
        const tail = Math.min(1.2, TWO_PI * perSecond * 0.18);
        if (tail < 0.02) continue;
        const a = view.param[i];
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = view.colors[i];
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.radius[i], a - dir * tail, a, dir < 0);
        ctx.stroke();
      }
    }
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
  // Glow: an enlarged translucent disc (cheaper than a shadow blur), brighter right after a tick.
  for (let i = 0; i < n; i++) {
    const flash = tickFlash(view, i);
    const glow = (o.showGlow ? 0.45 : 0) + 0.7 * flash;
    if (glow <= 0.01) continue;
    ctx.globalAlpha = 0.25 * glow;
    ctx.fillStyle = view.colors[i];
    ctx.beginPath();
    ctx.arc(view.x[i], view.y[i], r * (1.7 + 0.6 * flash) + 2, 0, TWO_PI);
    ctx.fill();
  }
  // Bodies, a white core flash and an accent ring.
  for (let i = 0; i < n; i++) {
    const flash = tickFlash(view, i);
    const rr = r * (1 + 0.35 * flash);
    ctx.globalAlpha = 1;
    ctx.fillStyle = view.colors[i];
    ctx.beginPath();
    ctx.arc(view.x[i], view.y[i], rr, 0, TWO_PI);
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
        ctx.arc(view.x[i], view.y[i], rr + 0.9 * r * (1 - flash) + 2, 0, TWO_PI);
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
}

/** The white full-screen flash of an alignment – every voice ticking at once (screen space, outside the camera transform). */
export function drawPolyrhythmAlignFlash(ctx: CanvasRenderingContext2D, width: number, height: number, view: PolyrhythmView) {
  const age = stepsAgoMs(view, view.lastAlignStep);
  if (age >= ALIGN_FLASH_MS) return;
  const a = 0.38 * (1 - age / ALIGN_FLASH_MS);
  if (a < 0.005) return;
  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
