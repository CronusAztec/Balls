import type { PolyrhythmView } from "@/lib/physics/modes/polyrhythm";
import { SPIRAL_DISC, inLinePercent } from "@/lib/physics/phaseSpiral";
import { LOOP_HUD_AMBER } from "@/lib/loop/hud";

/*
 * --- phase-spiral --- The Phase Spiral's drawing (lib/physics/phaseSpiral.ts), called by polyrhythmRenderer.ts: the dark disc
 * of the spiral palette, the k spokes the arms tick on, the comet tails of every dot (in bands of falling opacity and width,
 * as long as the dot travels in `trail` seconds) and – while the loop HUD does not show it – the "in line N %" meter with its
 * thin amber bar under the disc, inside the square the recorder crops to (so a clip carries it). Reads the positions the mode
 * computed for the step and allocates nothing per frame.
 */

const TWO_PI = Math.PI * 2;
/** Up to this many voices, and this many dots in all, the dots draw comet tails (the classic limit is the voices'). */
export const TAIL_VOICES_MAX = 160;
export const TAIL_DOTS_MAX = 480;
/** Bands a tail is drawn in (fewer past `TAIL_FULL_BANDS_MAX` dots), the head band's opacity and how far a tail may reach. */
export const TAIL_BANDS = 4;
export const TAIL_FULL_BANDS_MAX = 160;
export const TAIL_ALPHA = 0.6;
/** A tail's longest arc for its length in seconds (the classic 70° at 0.18 s) and at most this share of the gap to the next arm. */
export const TAIL_RAD_PER_SEC = 1.2 / 0.18;
export const TAIL_MAX_SHARE = 0.9;
/** The meter's line under the disc: its centre and the bar's, as shares of the field's side below the centre; the font and the bar. */
export const METER_TEXT_Y = 0.44;
export const METER_BAR_Y = 0.474;
export const METER_FONT = 0.04;
export const METER_BAR_WIDTH = 0.36;
export const METER_BAR_HEIGHT = 0.008;

/** The arc (radians) a dot's tail covers: what the dot travels in `trail` seconds, at most 1.2 rad per 0.18 s and 90 % of the way back to the previous arm. */
export function tailArc(ticksPerSecond: number, arms: number, trail: number): number {
  if (!(trail > 0) || !(ticksPerSecond > 0)) return 0;
  const k = Math.max(1, arms);
  return Math.min((TWO_PI * ticksPerSecond * trail) / k, TAIL_RAD_PER_SEC * trail, (TAIL_MAX_SHARE * TWO_PI) / k);
}

/** The spiral palette's dark disc under the rings (and a faint rim). */
export function drawSpiralDisc(ctx: CanvasRenderingContext2D, view: PolyrhythmView) {
  const g = view.geometry;
  if (!g) return;
  const r = g.outerRadius + 2.5 * g.dotRadius;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = SPIRAL_DISC;
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, r, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** The k spokes the arms tick on (12 o'clock and every 2π / k from it), glowing with the latest tick (`pulse` 0–1). */
export function drawSpokes(ctx: CanvasRenderingContext2D, view: PolyrhythmView, pulse: number) {
  const g = view.geometry;
  if (!g) return;
  const inner = Math.max(0, g.innerRadius - 2 * g.dotRadius);
  const outer = g.outerRadius + 2 * g.dotRadius;
  ctx.globalAlpha = 0.22 + 0.45 * pulse;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.25 + pulse;
  ctx.beginPath();
  for (let m = 0; m < view.arms; m++) {
    const a = -Math.PI / 2 + (TWO_PI * m) / view.arms;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(g.cx + inner * c, g.cy + inner * s);
    ctx.lineTo(g.cx + outer * c, g.cy + outer * s);
  }
  ctx.stroke();
}

/** Comet tails on the orbiting dots (rings, spiral): an arc behind every dot in bands that fade and thin towards the end. */
export function drawCometTails(ctx: CanvasRenderingContext2D, view: PolyrhythmView, dotRadius: number) {
  const g = view.geometry;
  const series = view.series;
  if (!g || !series) return;
  const n = view.count;
  const arms = view.arms;
  if (n > TAIL_VOICES_MAX || view.dotCount > TAIL_DOTS_MAX) return;
  const trail = view.settings.trail;
  if (!(trail > 0)) return;
  const bands = view.dotCount <= TAIL_FULL_BANDS_MAX ? TAIL_BANDS : 2;
  const dir = view.direction;
  const width = Math.max(1, 0.9 * dotRadius);
  ctx.save();
  ctx.lineCap = "butt";
  for (let i = 0; i < n; i++) {
    const tail = tailArc(series.a[i] / series.D, arms, trail);
    if (tail < 0.02) continue;
    ctx.strokeStyle = view.colors[i];
    for (let j = 0; j < arms; j++) {
      const a = view.dotParam[i * arms + j];
      for (let b = 0; b < bands; b++) {
        ctx.globalAlpha = TAIL_ALPHA * (1 - b / bands);
        ctx.lineWidth = width * (1 - (0.5 * b) / bands);
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.radius[i], a - (dir * tail * (b + 1)) / bands, a - (dir * tail * b) / bands, dir < 0);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** The "in line N %" meter under the disc: the amber line and a thin bar filled to the meter (`label` gives the words). */
export function drawInLineMeter(ctx: CanvasRenderingContext2D, view: PolyrhythmView, label?: (pct: number) => string) {
  const g = view.geometry;
  if (!g) return;
  const S = g.field.side;
  const pct = inLinePercent(view.inLine);
  const text = label ? label(pct) : `in line ${pct}%`;
  const fs = Math.max(10, METER_FONT * S);
  const ty = g.cy + METER_TEXT_Y * S;
  const by = g.cy + METER_BAR_Y * S;
  const bw = METER_BAR_WIDTH * S;
  const bh = Math.max(2, METER_BAR_HEIGHT * S);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fs.toFixed(1)}px sans-serif`;
  ctx.fillStyle = LOOP_HUD_AMBER;
  ctx.fillText(text, g.cx, ty);
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  ctx.fillRect(g.cx - bw / 2, by - bh / 2, bw, bh);
  ctx.fillStyle = LOOP_HUD_AMBER;
  ctx.fillRect(g.cx - bw / 2, by - bh / 2, bw * Math.max(0, Math.min(1, view.inLine)), bh);
  ctx.restore();
}
