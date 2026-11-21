import type { Ball } from "@/lib/physics/types";
import type { MultiplyView } from "@/lib/physics/modes/multiply";

/*
 * --- multiply-race --- Multiply's look (lib/physics/modes/multiply.ts keeps the view; draw only, every run): the swarm in
 * colours by generation – the start ball in its own colour, its children cyan, theirs lime, then yellow, orange, pink … –
 * the ring's inside washed in the newest generation's colour as the swarm grows, a meter round the ring on a doubling scale
 * (every doubling the same step, a tick at 2, 4, 8 … up to the Swarm Limit) with a halo round the ring as the swarm doubles,
 * the count in big digits in the middle that pops
 * with a "×2" at every doubling, a flash where a ball leaves the ring, and – a race that reached its limit – the ring's white
 * flash and a shockwave under the end banner (Canvas.tsx draws the banner). Everything comes from the view and the
 * simulation clock: a frame is the same live, in the fast export and in the Windows app's render queue. No list grows here:
 * the doubling ticks are at most log2 of the limit (a 1,000,000-ball limit: 20).
 */

/** The generations' colours after the start ball's own (cycled past the eighth). */
export const SWARM_PALETTE: readonly string[] = ["#22d3ee", "#a3e635", "#facc15", "#fb923c", "#f472b6", "#a78bfa", "#60a5fa", "#34d399"];
/** How long a doubling's pop, an escape's flash and a full swarm's burst last (simulation ms). */
export const DOUBLE_POP_MS = 650;
export const ESCAPE_FLASH_MS = 450;
export const FULL_BURST_MS = 1300;
/** The ring's wash: the newest generation's colour at this alpha with one ball and at the top one at the limit. */
export const SWARM_WASH_MIN = 0.1;
export const SWARM_WASH_MAX = 0.3;
/** The halo round the ring at the limit (none with one ball). */
export const SWARM_HALO_MAX = 0.28;
/** The meter's line width as a share of the ring's radius. */
const METER_WIDTH = 0.035;
/** The most doubling ticks drawn (a limit past 2^24 draws the first 24). */
const MAX_TICKS = 24;

/** The colour of generation `gen`: the start ball's own (`base`), then the palette. */
export function generationColor(gen: number, base: string): string {
  if (!(gen >= 1)) return base;
  return SWARM_PALETTE[(Math.floor(gen) - 1) % SWARM_PALETTE.length];
}

/** The meter's share, 0–1: log2(count) / log2(limit) – every doubling the same step (0 without a finite limit above 1). */
export function swarmShare(count: number, limit: number): number {
  if (!(limit > 1) || !Number.isFinite(limit) || !(count >= 1)) return 0;
  return Math.min(1, Math.log2(count) / Math.log2(limit));
}

/** A doubling's pop `ageMs` after it: the count's scale (1.35 → 1). */
export function doublePopScale(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= DOUBLE_POP_MS) return 1;
  const k = 1 - ageMs / DOUBLE_POP_MS;
  return 1 + 0.35 * k * k;
}

export class SwarmLayer {
  /** A ball's colour: its generation's (the canvas asks only when no team colour applies: a roster's teams keep theirs). */
  colorOf(ball: Ball, view: MultiplyView): string {
    return generationColor(view.genOf.get(ball.id) ?? 0, ball.color);
  }

  /** Under the balls: the ring's wash and the doubling meter round it. `base` is the start ball's colour. */
  drawWorld(ctx: CanvasRenderingContext2D, view: MultiplyView, cx: number, cy: number, R: number, base: string) {
    if (!(R > 0)) return;
    const color = generationColor(view.topGen, base);
    const share = swarmShare(view.count, view.limit);
    ctx.save();
    // the halo round the ring, stronger as the swarm doubles (one gradient a frame: the colour moves with the generations)
    if (share > 0.02 && typeof ctx.createRadialGradient === "function") {
      const halo = ctx.createRadialGradient(cx, cy, R, cx, cy, 1.45 * R);
      halo.addColorStop(0, color);
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalAlpha = SWARM_HALO_MAX * share;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.45 * R, 0, Math.PI * 2);
      ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
      ctx.fill();
    }
    ctx.globalAlpha = SWARM_WASH_MIN + (SWARM_WASH_MAX - SWARM_WASH_MIN) * share;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    if (Number.isFinite(view.limit) && view.limit > 1) {
      const lw = Math.max(2, METER_WIDTH * R);
      const mr = R + 1.1 * lw;
      ctx.lineCap = "round";
      ctx.lineWidth = lw;
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, mr, 0, Math.PI * 2);
      ctx.stroke();
      if (share > 0) {
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.arc(cx, cy, mr, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * share);
        ctx.stroke();
      }
      // a tick at every doubling (2, 4, 8 …), bright once the swarm passed it
      const steps = Math.log2(view.limit);
      const ticks = Math.min(MAX_TICKS, Math.floor(steps));
      ctx.lineCap = "butt";
      ctx.lineWidth = Math.max(1.5, 0.35 * lw);
      for (let k = 1; k <= ticks; k++) {
        const a = -Math.PI / 2 + (2 * Math.PI * k) / steps;
        const reached = view.count >= Math.pow(2, k);
        ctx.globalAlpha = reached ? 0.95 : 0.35;
        ctx.strokeStyle = reached ? "#ffffff" : color;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (mr - 0.9 * lw), cy + Math.sin(a) * (mr - 0.9 * lw));
        ctx.lineTo(cx + Math.cos(a) * (mr + 0.9 * lw), cy + Math.sin(a) * (mr + 0.9 * lw));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Over the balls: an escape's flash where it left the ring, the count in the middle with its "×2" pop (hidden under a race's
   * end banner; at least `ballsNow`, the balls on the field), and a full swarm's burst – the ring flashing white and a shockwave.
   */
  drawEffects(ctx: CanvasRenderingContext2D, view: MultiplyView, cx: number, cy: number, R: number, base: string, ballsNow = 0) {
    if (!(R > 0)) return;
    const now = view.timeMs;
    const color = generationColor(view.topGen, base);
    ctx.save();
    // the escape's flash: a ring opening where the ball left, in the new generation's colour
    const ea = now - view.escapeMs;
    if (view.escapeMs >= 0 && ea >= 0 && ea < ESCAPE_FLASH_MS) {
      const p = ea / ESCAPE_FLASH_MS;
      ctx.globalAlpha = 0.9 * (1 - p);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, 0.02 * R * (1 - p) + 1);
      ctx.beginPath();
      ctx.arc(view.escapeX, view.escapeY, 0.06 * R + 0.22 * R * p, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the count: big digits in the middle, popping at every doubling
    if (view.fullMs < 0) {
      const pop = view.doubledMs >= 0 ? doublePopScale(now - view.doubledMs) : 1;
      const fs = Math.max(16, 0.34 * R) * pop;
      ctx.font = `bold ${Math.round(fs)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, 0.1 * fs);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.globalAlpha = 0.92;
      const text = String(Math.floor(Math.max(view.count, ballsNow))); // (before the first step the view has not counted the start ball yet)
      ctx.strokeText(text, cx, cy);
      ctx.fillStyle = pop > 1.01 ? "#ffffff" : color;
      ctx.fillText(text, cx, cy);
      const da = now - view.doubledMs;
      if (view.doubledMs >= 0 && da >= 0 && da < DOUBLE_POP_MS && view.doubled >= 2) {
        const k = da / DOUBLE_POP_MS;
        const small = Math.max(12, 0.13 * R);
        ctx.font = `bold ${Math.round(small)}px sans-serif`;
        ctx.globalAlpha = 0.95 * (1 - k);
        ctx.lineWidth = Math.max(2, 0.12 * small);
        const y = cy - 0.62 * fs - 0.25 * R * k;
        ctx.strokeText("×2", cx, y);
        ctx.fillStyle = color;
        ctx.fillText("×2", cx, y);
      }
    }
    // a race's full swarm: the ring flashes white and a shockwave leaves it
    const fa = now - view.fullMs;
    if (view.fullMs >= 0 && fa >= 0 && fa < FULL_BURST_MS) {
      const p = fa / FULL_BURST_MS;
      if (p < 0.3) {
        ctx.globalAlpha = 0.5 * (1 - p / 0.3);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const lag of [0, 0.2]) {
        const q = (p - lag) / (1 - lag);
        if (q <= 0) continue;
        const e = 1 - (1 - q) * (1 - q) * (1 - q);
        ctx.globalAlpha = 0.85 * (1 - q);
        ctx.strokeStyle = lag === 0 ? "#ffffff" : color;
        ctx.lineWidth = Math.max(2, (0.06 - 0.04 * e) * R);
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1 + 0.6 * e), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/** The data-swarm-* attributes (Canvas.tsx writes them in Multiply and removes them in every other mode). */
export const SWARM_DATA_KEYS = ["swarmCount", "swarmLimit", "swarmEscapes", "swarmTopGen", "swarmRace", "swarmFull"] as const;

/** The data-swarm-* attributes the smoke test and tools read (Canvas.tsx writes them in Multiply). */
export function writeSwarmDataset(view: MultiplyView, set: (key: string, value: string) => void) {
  set("swarmCount", String(view.count));
  set("swarmLimit", Number.isFinite(view.limit) ? String(view.limit) : "");
  set("swarmEscapes", String(view.escapes));
  set("swarmTopGen", String(view.topGen));
  set("swarmRace", view.race ? "1" : "0");
  set("swarmFull", view.fullMs >= 0 ? (view.fullMs / 1000).toFixed(3) : "");
}
