import type { Ball } from "@/lib/physics/types";
import type { GrowView } from "@/lib/physics/modes/grow";
import { DEFAULT_GROW_RAMP, parseRamp, rampColor } from "@/lib/physics/growFill";

/*
 * --- loop-foundation --- Grow's fill-and-loop look (lib/physics/modes/grow.ts runs it): the ball's colour by its size along
 * the ramp's colour stops (r / cap), the contact markers – a small ring where the ball hit, fading (and widening) over their
 * lifetime, at most the mode's ring buffer of 64 – and the hold and the shrink drawn as a solid disc. The classic Grow (no
 * colour by size, no loop) keeps the page's own ball drawing.
 */

export interface GrowLook {
  /** Colour by size along `ramp`. */
  hue: boolean;
  ramp: readonly string[];
  /** Contact markers and their lifetime (s). */
  markers: boolean;
  markerLife: number;
}

export const DEFAULT_GROW_LOOK: GrowLook = { hue: false, ramp: DEFAULT_GROW_RAMP.split(","), markers: false, markerLife: 0.3 };

/** The look of the page's settings. */
export function growLookOf(s: { growHue: boolean; growRamp: string; growMarkers: boolean; growMarkerLife: number }): GrowLook {
  return { hue: s.growHue, ramp: parseRamp(s.growRamp), markers: s.growMarkers, markerLife: Number.isFinite(s.growMarkerLife) && s.growMarkerLife >= 0 ? s.growMarkerLife : 0.3 };
}

/** The widest a marker ring grows (px, at the end of its life) and its start radius. */
const MARKER_START_R = 3;
const MARKER_GROW_R = 9;
/** The marker ring's line (world px). */
const MARKER_LINE = 2;

/** The data-grow-* attributes the smoke test and tools read (Canvas.tsx writes them in Grow). */
export const GROW_DATA_KEYS = ["growLaw", "growFill", "growPhase", "growFills", "growFirstFill", "growSeams", "growCycle", "growBounces", "growTotalBounces", "growRadius", "growCap", "growStart", "growMarkers"] as const;

export class GrowLayer {
  /** True when Grow draws the balls itself: colour by size, or the loop's hold / shrink (a solid disc). */
  drawsBodies(look: GrowLook | null, view: GrowView): boolean {
    return (!!look && look.hue) || (view.onFill !== "stay" && (view.phase === "hold" || view.phase === "shrink" || view.phase === "done"));
  }

  /** A ball's colour: along the ramp by r / cap with colour by size, else its own. */
  colorOf(ball: Ball, view: GrowView, look: GrowLook | null): string {
    if (!look || !look.hue || !(view.cap > 0)) return ball.color;
    return rampColor(look.ramp, ball.radius / view.cap);
  }

  /** The contact markers alive at `nowMs` (simulation ms): rings fading out over the lifetime, under the balls. */
  drawMarkers(ctx: CanvasRenderingContext2D, view: GrowView, look: GrowLook, nowMs: number, color: string) {
    const life = 1000 * look.markerLife;
    if (!look.markers || !(life > 0)) return;
    const m = view.markers;
    ctx.save();
    ctx.lineWidth = MARKER_LINE;
    ctx.strokeStyle = color;
    for (let i = 0; i < m.count; i++) {
      const age = nowMs - m.ts[i];
      if (age < 0 || age >= life) continue;
      const f = age / life;
      ctx.globalAlpha = 0.9 * (1 - f);
      ctx.beginPath();
      ctx.arc(m.xs[i], m.ys[i], MARKER_START_R + MARKER_GROW_R * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The balls as flat discs in their colours (the hold and the shrink always flat: the loop's solid disc). */
  drawBodies(ctx: CanvasRenderingContext2D, balls: readonly Ball[], view: GrowView, look: GrowLook | null) {
    for (const ball of balls) {
      if (!(ball.radius > 0)) continue;
      ctx.fillStyle = this.colorOf(ball, view, look);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Mirrors the run onto the canvas element (data-grow-*): the law, the phase, the fills, the seams, the cycle, the bounces. */
export function writeGrowDataset(view: GrowView, balls: readonly Ball[], set: (key: string, value: string) => void) {
  set("growLaw", view.law);
  set("growFill", view.onFill);
  set("growPhase", view.phase);
  set("growFills", String(view.fills));
  set("growFirstFill", view.firstFillMs >= 0 ? (view.firstFillMs / 1000).toFixed(3) : "");
  set("growSeams", String(view.seams));
  set("growCycle", view.cycleSec > 0 ? view.cycleSec.toFixed(3) : "");
  set("growBounces", String(view.bounces));
  set("growTotalBounces", String(view.totalBounces));
  set("growRadius", balls.length > 0 ? balls[0].radius.toFixed(2) : "");
  set("growCap", view.cap.toFixed(2));
  set("growStart", view.startRadius.toFixed(2));
  set("growMarkers", String(view.markers.count));
}
