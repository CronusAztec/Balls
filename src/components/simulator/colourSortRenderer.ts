import { CS_FLASH_MS, type ColourSortView } from "@/lib/physics/modes/colourSort";

/*
 * --- colour-sort --- Canvas drawing of Colour Sort (lib/physics/modes/colourSort.ts runs it), inside the camera transform and
 * under the balls: every band's very dark tint of the colour it ends with (the bullseye reads even when empty), the gated
 * rings as neon arcs in their colours with a soft outer glow and a white pin at every arc end, the outer wall in the outermost
 * colour, and – with the flashes on – a short ring where a gate or an arc refused a ball. The balls themselves go through the
 * page's shared ball pass (every ball wears its colour). Cheap at any size: one path per ring and per band, the glow by a
 * shadow only while there are few rings (a wide translucent stroke past them), the pins in one path. Nothing random here.
 */

export interface ColourSortRenderOptions {
  /** The rings' soft glow (the page's Wall Glow switch). */
  showWallGlow: boolean;
  /** Simulation ms now (the refusal flashes fade on it). */
  nowMs: number;
}

/** The band tints' alpha (a very dark tint of the colour on the navy page). */
const TINT_ALPHA = 0.09;
/** The glow's blur (× the rings' stroke) and the most rings drawn with a blurred shadow (past them a wide translucent stroke). */
const GLOW_BLUR = 3;
const BLUR_RINGS_UP_TO = 16;
/** The pins' radius as a share of the rings' half stroke. */
const PIN_SHARE = 0.85;
const TWO_PI = Math.PI * 2;

/** The data-cs-* attributes the smoke test and tools read (Canvas.tsx writes them in Colour Sort). */
export const COLOUR_SORT_DATA_KEYS = ["csPhase", "csSorted", "csTotal", "csColours", "csGates", "csCompletions", "csSeams", "csCycle", "csFirstSort", "csLastColour", "csEscaped", "csPasses", "csRefusals", "csRemix", "csRule", "csEnd", "csFirstEnd", "csFirstEndSec"] as const;

export class ColourSortLayer {
  /** The colour each band is tinted with (its first target colour; −1: no colour ends there), per run. */
  private bandColour: Int32Array = new Int32Array(0);
  private generation = -1;

  private tintsOf(view: ColourSortView): Int32Array {
    if (this.generation !== view.generation || this.bandColour.length !== view.colours) {
      this.generation = view.generation;
      this.bandColour = new Int32Array(view.colours).fill(-1);
      for (let c = 0; c < view.colours; c++) {
        const band = view.target[c];
        if (band >= 0 && band < view.colours && this.bandColour[band] < 0) this.bandColour[band] = c;
      }
    }
    return this.bandColour;
  }

  /** The stage: band tints, gated rings with their glow and pins, the outer wall, the refusal flashes. */
  drawStage(ctx: CanvasRenderingContext2D, view: ColourSortView, o: ColourSortRenderOptions) {
    const K = view.colours;
    if (K < 1 || !(view.outer > 0)) return;
    const { cx, cy } = view;
    const half = view.ringHalf;
    ctx.save();
    // the bands' tints, the core outward (an annulus between two rings' strokes)
    const tints = this.tintsOf(view);
    ctx.globalAlpha = TINT_ALPHA;
    for (let k = 0; k < K; k++) {
      const c = tints[k];
      if (c < 0) continue;
      const inner = k === 0 ? 0 : view.ringRadius[k - 1] + half;
      const outer = view.ringRadius[k] - half;
      if (!(outer > inner)) continue;
      ctx.fillStyle = view.palette[c];
      ctx.beginPath();
      ctx.arc(cx, cy, outer, 0, TWO_PI);
      if (inner > 0) {
        ctx.moveTo(cx + inner, cy);
        ctx.arc(cx, cy, inner, 0, TWO_PI, true);
      }
      ctx.fill("evenodd");
    }
    ctx.globalAlpha = 1;
    // the rings: arcs between the gates (ring k in colour k), the outer wall whole
    ctx.lineCap = "butt";
    ctx.lineWidth = 2 * half;
    const blur = o.showWallGlow && K <= BLUR_RINGS_UP_TO;
    const period = view.gatePeriod;
    const width = view.gateWidth;
    const allGate = width >= period;
    const noGate = !(width > 0);
    for (let k = 0; k < K; k++) {
      const R = view.ringRadius[k];
      const outerWall = k === K - 1;
      if (!outerWall && allGate) continue; // a ring that is all gate: nothing to draw
      const colour = view.palette[k] ?? "#ffffff";
      const trace = () => {
        ctx.beginPath();
        if (outerWall || noGate) {
          ctx.arc(cx, cy, R, 0, TWO_PI);
          return;
        }
        const base = view.ringAngle[k] + view.gatePhase[k];
        for (let j = 0; j < view.gates; j++) {
          const a0 = base + j * period + width / 2;
          const a1 = base + (j + 1) * period - width / 2;
          ctx.moveTo(cx + R * Math.cos(a0), cy + R * Math.sin(a0));
          ctx.arc(cx, cy, R, a0, a1);
        }
      };
      if (o.showWallGlow && !blur) {
        // many rings: the glow as a wide translucent stroke (a blurred shadow per ring would cost too much)
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 4 * half;
        ctx.strokeStyle = colour;
        trace();
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2 * half;
      }
      if (blur) {
        ctx.shadowColor = colour;
        ctx.shadowBlur = GLOW_BLUR * 2 * half;
      }
      ctx.strokeStyle = colour;
      trace();
      ctx.stroke();
      if (blur) {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }
    }
    // the white pins at every arc end, in one path
    if (!allGate && !noGate && K > 1) {
      const pin = Math.max(0.75, PIN_SHARE * half);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      for (let k = 0; k < K - 1; k++) {
        const R = view.ringRadius[k];
        const base = view.ringAngle[k] + view.gatePhase[k];
        for (let j = 0; j < 2 * view.gates; j++) {
          // an arc's two ends: the end of gate j / 2 (even j) and the start of the next gate (odd j)
          const g = j >> 1;
          const a = j % 2 === 0 ? base + g * period + width / 2 : base + (g + 1) * period - width / 2;
          const x = cx + R * Math.cos(a);
          const y = cy + R * Math.sin(a);
          ctx.moveTo(x + pin, y);
          ctx.arc(x, y, pin, 0, TWO_PI);
        }
      }
      ctx.fill();
    }
    // the refusal flashes: a ring widening and fading where a ring turned a ball back
    if (view.settings.flashes && view.flashCount > 0) {
      ctx.lineWidth = Math.max(1, half);
      for (let i = 0; i < view.flashCount; i++) {
        const age = o.nowMs - view.flashT[i];
        if (!(age >= 0 && age < CS_FLASH_MS)) continue;
        const f = age / CS_FLASH_MS;
        ctx.globalAlpha = 0.85 * (1 - f);
        ctx.strokeStyle = view.palette[view.flashRing[i]] ?? "#ffffff";
        ctx.beginPath();
        ctx.arc(view.flashX[i], view.flashY[i], view.glowRadius * (1 + 2.5 * f), 0, TWO_PI);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

/** Mirrors the run onto the canvas element (data-cs-*): the phase, the census, the loop's counts and the checks. */
export function writeColourSortDataset(view: ColourSortView, set: (key: string, value: string) => void) {
  set("csPhase", view.phase);
  set("csSorted", String(view.sorted));
  set("csTotal", String(view.total));
  set("csColours", String(view.colours));
  set("csGates", String(view.gates));
  set("csCompletions", String(view.completions));
  set("csSeams", String(view.seams));
  set("csCycle", view.cycleSec > 0 ? view.cycleSec.toFixed(3) : "");
  set("csFirstSort", view.firstSortSec >= 0 ? view.firstSortSec.toFixed(3) : "");
  set("csLastColour", String(view.firstLastColour));
  set("csEscaped", String(view.escaped));
  set("csPasses", String(view.passes));
  set("csRefusals", String(view.refusals));
  set("csRemix", view.remixProgress.toFixed(2));
  set("csRule", view.settings.rule);
  // how this cycle's sort ended (sorted / settled / limit; "" while it runs), and the first cycle's (kept: when, s into it)
  set("csEnd", view.endReason);
  set("csFirstEnd", view.firstEnd);
  set("csFirstEndSec", view.firstEndSec >= 0 ? view.firstEndSec.toFixed(3) : "");
}
