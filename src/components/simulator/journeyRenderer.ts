import { JOURNEY_BANNER_MS, type JourneyView } from "@/lib/physics/modes/journey";
import { BULLSEYE_BANDS, type BullseyeStage } from "@/lib/physics/journey/bullseye";
import type { FunnelStage } from "@/lib/physics/journey/funnel";
import type { GatesStage } from "@/lib/physics/journey/gates";
import type { GlassStage } from "@/lib/physics/journey/glass";
import type { HomeStage } from "@/lib/physics/journey/home";
import type { PegsStage } from "@/lib/physics/journey/pegs";
import { CHUTE_SEC, type RingsStage } from "@/lib/physics/journey/rings";
import type { JourneyStageKind } from "@/lib/physics/journey/sequence";
import { STAGE_COLORS, type StagePainter } from "@/lib/physics/journey/stage";
import { ACCENT } from "@/lib/site";
import { drawGlassShards, drawGlassWorld, type GlassRenderOptions } from "./glassRenderer";
import { DEFAULT_MULTIPLIER_LABELS, type MultiplierLabels } from "./multiplierRenderer";

/**
 * Canvas drawing of the Journey mode (feature boris-journey, lib/physics/modes/journey.ts). The layer is the physics'
 * `StagePainter`: every stage in view describes itself (`stage.render(painter)`) and the layer draws it – the glass
 * panes, gate rows and the HOME doorway through the Glass Smash renderer (each of those stages keeps a Glass Smash view
 * of its own), the rings of a stage that is not live yet (a live stage's rings are the engine's, which the canvas draws
 * like Classic's) and the chute into their core, the funnel's hoppers, the bullseye's bands on the trapdoor and its score
 * pop-up; pegs, bars, funnel walls and platforms are engine obstacles the canvas draws for every mode. Per frame the canvas
 * calls `applyCamera()` (the journey's camera owns the view), `drawWorld()` under the ball, `drawEffects()` over it (glass
 * shards) and `drawOverlay()` in screen space: the "Stage 2/5: Glass" banner, the mini-map of the stages beside the column
 * with the ball's progress, and the clock and score. Everything animates on the simulation clock (`view.timeMs`), so a
 * pause freezes it and a recording replays it.
 */

export interface JourneyLabels {
  /** "Stage 2/5: Glass" */
  banner: (n: number, total: number, name: string) => string;
  /** The stage names (banner, stage markers). */
  names: Record<JourneyStageKind, string>;
  /** The sign over the door. */
  home: string;
  /** The finish banner and its line. */
  homeTitle: string;
  homeSub: (stages: number, seconds: string, score: number) => string;
  /** The score next to the clock. */
  score: (points: number) => string;
}

export const DEFAULT_JOURNEY_LABELS: JourneyLabels = {
  banner: (n, total, name) => `Stage ${n}/${total}: ${name}`,
  names: { rings: "Rings", glass: "Glass", pegs: "Pegs", multipliers: "Multipliers", funnel: "Funnel", bullseye: "Bullseye", home: "Home" },
  home: "HOME",
  homeTitle: "HOME!",
  homeSub: (stages, seconds, score) => `${stages} stages in ${seconds}s${score > 0 ? ` · ${score} pts` : ""}`,
  score: (points) => `${points} pts`,
};

export interface JourneyRenderOptions {
  /** The canvas' wall colour function (rainbow walls apply). */
  wallColor: (index: number, alpha?: number, angle?: number) => string;
  wallThickness: number;
  showGlow: boolean;
  showWallGlow: boolean;
  multLabels?: MultiplierLabels;
  /** The Gap Size setting and the ball's radius: a rings stage's outline before it goes live shows the gaps it will have. */
  gapSize: number;
  ballRadius: number;
}

/** Glyph of each stage kind on the mini-map. */
export const STAGE_GLYPHS: Record<JourneyStageKind, string> = { rings: "◎", glass: "▭", pegs: "⁘", multipliers: "×", funnel: "▽", bullseye: "◉", home: "⌂" };
/** How long a bullseye score floats up (simulation ms). */
export const SCORE_POP_MS = 1300;
/** Colours of the bullseye bands from the bull outward, then the rest of the platform. */
const BAND_COLORS = ["#ef4444", "#f8fafc", "#ef4444"];
const MISS_COLOR = "rgba(148, 163, 184, 0.55)";
const DASH = [4, 6];
const NO_DASH: number[] = [];
const TWO_PI = Math.PI * 2;

/** The data-journey-* attributes the canvas mirrors onto its element (removed when another mode runs). */
export const JOURNEY_DATA_KEYS = ["journeyStage", "journeyStages", "journeyKind", "journeySequence", "journeySwooshes", "journeyScore", "journeyHome", "journeyHomeMs", "journeyFinished", "journeyFinishedMs", "journeyCamera", "journeyNotes", "journeyNudges", "journeyProgress"] as const;

export function writeJourneyDataset(view: JourneyView, set: (key: string, value: string) => void) {
  const stage = view.stages[view.active];
  set("journeyStage", String(view.active + 1));
  set("journeyStages", String(view.stages.length));
  set("journeyKind", stage ? stage.kind : "");
  set("journeySequence", view.sequence);
  set("journeySwooshes", String(view.swooshes));
  set("journeyScore", String(view.score));
  set("journeyHome", view.homeReached ? "1" : "0");
  set("journeyHomeMs", view.homeReached ? String(Math.round(view.homeAtMs)) : "");
  set("journeyFinished", view.finished ? "1" : "0");
  set("journeyFinishedMs", String(Math.round(view.finishedAtMs)));
  set("journeyCamera", String(Math.round(view.cameraY)));
  set("journeyNotes", String(view.notes));
  set("journeyNudges", String(view.nudges));
  set("journeyProgress", view.progress.toFixed(3));
}

export class JourneyLayer implements StagePainter {
  private ctx: CanvasRenderingContext2D | null = null;
  private view: JourneyView | null = null;
  private opts: JourneyRenderOptions | null = null;
  private labels: JourneyLabels = DEFAULT_JOURNEY_LABELS;
  private top = 0;
  private bottom = 0;
  private readonly glassOpts: GlassRenderOptions = { wallColor: () => "#fff", wallThickness: 2, showGlow: false, stageLabel: () => "", homeLabel: "HOME" };

  /** Scrolls the world by the journey's camera (inside the canvas' camera transform, before the world is drawn). */
  applyCamera(ctx: CanvasRenderingContext2D, view: JourneyView) {
    if (view.cameraY !== 0) ctx.translate(0, -view.cameraY);
  }

  /** The stages in view, their markers and everything a stage draws under the ball. */
  drawWorld(ctx: CanvasRenderingContext2D, view: JourneyView, opts: JourneyRenderOptions, labels: JourneyLabels, height: number) {
    const f = view.field;
    if (!f) return;
    this.ctx = ctx;
    this.view = view;
    this.opts = opts;
    this.labels = labels;
    this.top = view.cameraY - 40;
    this.bottom = view.cameraY + height + 40;
    const g = this.glassOpts;
    g.wallColor = opts.wallColor;
    g.wallThickness = opts.wallThickness;
    g.showGlow = opts.showGlow;
    g.homeLabel = labels.home;
    g.multLabels = opts.multLabels ?? DEFAULT_MULTIPLIER_LABELS;
    ctx.save();
    // Stage markers: a faint dashed line where each stage begins and its number and name at the wall.
    const fs = Math.max(9, 0.022 * f.height);
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.lineWidth = 1;
    for (let i = 0; i < view.stages.length; i++) {
      const b = view.stages[i].bounds;
      if (b.bottom < this.top || b.top > this.bottom) continue;
      if (i > 0) {
        ctx.setLineDash(DASH);
        ctx.globalAlpha = 0.24;
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(f.left, b.top);
        ctx.lineTo(f.right, b.top);
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
      }
      ctx.globalAlpha = i === view.active ? 0.6 : 0.34;
      ctx.fillStyle = STAGE_COLORS[view.stages[i].kind];
      ctx.fillText(`${i + 1} · ${labels.names[view.stages[i].kind].toUpperCase()}`, f.left + 6, b.top + 4);
    }
    ctx.restore();
    for (const stage of view.stages) {
      const b = stage.bounds;
      if (b.bottom < this.top || b.top > this.bottom) continue;
      stage.render(this);
    }
    this.ctx = null;
  }

  /** Over the ball: the shards of the glass stages. */
  drawEffects(ctx: CanvasRenderingContext2D, view: JourneyView, height: number) {
    const top = view.cameraY - 40;
    const bottom = view.cameraY + height + 40;
    for (const stage of view.stages) if (stage.kind === "glass") drawGlassShards(ctx, (stage as GlassStage).view, top, bottom);
  }

  /* -------------------------------------------------------------- the painter */

  rings(stage: RingsStage) {
    const ctx = this.ctx;
    const opts = this.opts;
    const view = this.view;
    if (!ctx || !opts || !view) return;
    ctx.save();
    // Rings not live yet: their outline with the gaps where they will start (the live ones are the engine's).
    if (!stage.live && stage.phase === "waiting") {
      ctx.lineWidth = Math.max(1.5, opts.wallThickness);
      for (let i = 0; i < stage.radii.length; i++) {
        const gap = stage.gapWidth(i, opts.ballRadius, opts.gapSize);
        const a0 = stage.startAngles[i] + gap;
        ctx.strokeStyle = opts.wallColor(i, 0.45);
        ctx.beginPath();
        ctx.arc(stage.cx, stage.cy, stage.radii[i], a0, a0 + TWO_PI - gap);
        ctx.stroke();
      }
    }
    // The chute to the core: bright while the ball drops through it, fading once it is inside.
    const inner = stage.radii[0] ?? 0;
    let alpha = 0;
    if (stage.phase === "waiting") alpha = 0.3;
    else if (stage.phase === "chute") alpha = 0.75;
    else if (stage.phase === "inside") alpha = 0.75 * Math.max(0, 1 - (view.timeMs - stage.insideAtMs) / (1000 * CHUTE_SEC));
    if (alpha > 0.01) {
      const w = Math.max(10, 0.03 * stage.bounds.viewH);
      const y0 = stage.bounds.top;
      const y1 = stage.cy - 0.4 * inner;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = STAGE_COLORS.rings;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(stage.cx - w, y0);
      ctx.lineTo(stage.cx - w, y1);
      ctx.moveTo(stage.cx + w, y0);
      ctx.lineTo(stage.cx + w, y1);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.12;
      ctx.fillStyle = STAGE_COLORS.rings;
      ctx.fillRect(stage.cx - w, y0, 2 * w, y1 - y0);
    }
    ctx.restore();
  }

  glass(stage: GlassStage) {
    if (this.ctx) drawGlassWorld(this.ctx, stage.view, this.glassOpts, this.top, this.bottom);
  }

  pegs(stage: PegsStage) {
    // The pegs and bars are engine obstacles (drawn by the canvas); a faint wash marks the field.
    const ctx = this.ctx;
    if (!ctx) return;
    const b = stage.bounds;
    ctx.save();
    ctx.globalAlpha = 0.035;
    ctx.fillStyle = STAGE_COLORS.pegs;
    ctx.fillRect(b.left, b.top + 0.12 * b.height, b.width, 0.84 * b.height);
    ctx.restore();
  }

  gates(stage: GatesStage) {
    if (this.ctx) drawGlassWorld(this.ctx, stage.view, this.glassOpts, this.top, this.bottom);
  }

  funnel(stage: FunnelStage) {
    // The dead space under each arm, tinted so the funnel reads as a solid hopper (its walls are engine obstacles).
    const ctx = this.ctx;
    if (!ctx) return;
    const b = stage.bounds;
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = STAGE_COLORS.funnel;
    for (const f of stage.funnels) {
      ctx.beginPath();
      ctx.moveTo(b.left, f.top);
      ctx.lineTo(f.mouthX - f.mouth / 2, f.bottom);
      ctx.lineTo(b.left, f.bottom);
      ctx.closePath();
      ctx.moveTo(b.right, f.top);
      ctx.lineTo(f.mouthX + f.mouth / 2, f.bottom);
      ctx.lineTo(b.right, f.bottom);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  bullseye(stage: BullseyeStage) {
    const ctx = this.ctx;
    const view = this.view;
    if (!ctx || !view) return;
    const b = stage.bounds;
    const w = b.width;
    const thick = Math.max(4, 0.012 * b.viewH);
    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineWidth = thick;
    // The bands along each half of the trapdoor (they swing down with it), from the target's centre outward.
    for (let half = 0; half < 2; half++) {
      const hx = half === 0 ? b.left : b.right;
      const len = half === 0 ? stage.targetX - b.left : b.right - stage.targetX;
      const bar = half === 0 ? stage.left : stage.right;
      const angle = bar ? bar.angle : half === 0 ? 0 : Math.PI;
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      const lift = (thick / 2) * Math.abs(c);
      let from = 0;
      for (let i = 0; i <= BULLSEYE_BANDS.length && from < len; i++) {
        const to = Math.min(len, i < BULLSEYE_BANDS.length ? BULLSEYE_BANDS[i][0] * w : len);
        if (to > from) {
          // Distance d from the centre is (len − d) from the hinge along the half.
          const u0 = len - from;
          const u1 = len - to;
          ctx.strokeStyle = i < BAND_COLORS.length ? BAND_COLORS[i] : MISS_COLOR;
          ctx.globalAlpha = 0.95;
          ctx.beginPath();
          ctx.moveTo(hx + c * u0, stage.platformY + sn * u0 - lift);
          ctx.lineTo(hx + c * u1, stage.platformY + sn * u1 - lift);
          ctx.stroke();
        }
        from = to;
      }
    }
    // The score of the landing floats up.
    const age = view.timeMs - stage.landedAtMs;
    if (stage.landed && age >= 0 && age < SCORE_POP_MS) {
      const t = age / SCORE_POP_MS;
      const fs = Math.max(14, 0.05 * b.viewH) * (stage.score >= 100 ? 1.35 : 1);
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.font = `900 ${fs}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, 0.14 * fs);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
      const y = stage.platformY - 0.06 * b.viewH - t * 0.12 * b.viewH;
      const x = Math.max(b.left + fs, Math.min(b.right - fs, stage.landX));
      ctx.strokeText(`+${stage.score}`, x, y);
      ctx.fillStyle = stage.score >= 100 ? ACCENT : STAGE_COLORS.bullseye;
      ctx.fillText(`+${stage.score}`, x, y);
    }
    ctx.restore();
  }

  home(stage: HomeStage) {
    if (this.ctx) drawGlassWorld(this.ctx, stage.view, this.glassOpts, this.top, this.bottom);
  }

  /* -------------------------------------------------------------- screen space */

  /**
   * The banner of the stage just entered, the mini-map beside the column (a segment per stage in its colour and glyph,
   * the ball's progress as a glowing dot) and the clock and score on the other side – all inside the square the recorder
   * crops to, so a vertical export has them.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: JourneyView, labels: JourneyLabels) {
    const f = view.field;
    if (!f) return;
    const side = f.height;
    ctx.save();
    // Mini-map.
    const total = view.heights.reduce((a, h) => a + h, 0);
    // At the square's right edge, clear of a rings chamber (at most 0.41 view heights out from the centre).
    const mx = f.cx + 0.47 * side;
    const my0 = f.top + 0.1 * side;
    const my1 = f.bottom - 0.1 * side;
    const mw = Math.max(5, 0.016 * side);
    if (total > 0 && view.stages.length > 0) {
      const span = my1 - my0;
      const gap = Math.min(3, 0.004 * side);
      let y = my0;
      const gfs = Math.max(9, 0.024 * side);
      ctx.font = `700 ${gfs}px sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i < view.stages.length; i++) {
        const h = (view.heights[i] / total) * span;
        const kind = view.stages[i].kind;
        const color = STAGE_COLORS[kind];
        ctx.globalAlpha = i < view.active ? 0.85 : i === view.active ? 1 : 0.28;
        ctx.fillStyle = color;
        // The active stage is wider (no shadow blur: the overlay stays cheap at 1080×1920).
        const w = i === view.active ? 1.6 * mw : mw;
        ctx.fillRect(mx - w / 2, y + gap / 2, w, Math.max(1, h - gap));
        ctx.globalAlpha = i <= view.active ? 0.9 : 0.4;
        ctx.fillText(STAGE_GLYPHS[kind], mx - mw, y + h / 2);
        y += h;
      }
      // The ball: a white dot with a soft halo.
      const by = my0 + view.progress * span;
      const br = Math.max(4, 0.9 * mw);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(mx, by, 1.8 * br, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(mx, by, br, 0, TWO_PI);
      ctx.fill();
    }
    // Clock and score in the bottom-left corner of the square (the multiplier badges live in the top one).
    const cx = f.cx - 0.44 * side;
    const cfs = Math.max(12, 0.036 * side);
    const clockY = f.bottom - 0.05 * side;
    const seconds = (view.homeReached ? view.homeAtMs : view.timeMs) / 1000;
    ctx.globalAlpha = 0.92;
    ctx.font = `800 ${cfs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 0.12 * cfs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    const clock = `${Math.max(0, seconds).toFixed(1)}s`;
    ctx.strokeText(clock, cx, clockY);
    ctx.fillStyle = view.homeReached ? ACCENT : "#ffffff";
    ctx.fillText(clock, cx, clockY);
    if (view.stages.some((s) => s.kind === "bullseye")) {
      const text = labels.score(view.score);
      ctx.font = `700 ${0.6 * cfs}px sans-serif`;
      ctx.strokeText(text, cx, clockY - 1.05 * cfs);
      ctx.fillStyle = STAGE_COLORS.bullseye;
      ctx.fillText(text, cx, clockY - 1.05 * cfs);
    }
    // The banner of the stage just entered.
    const age = view.timeMs - view.bannerAtMs;
    const stage = view.stages[view.bannerStage];
    if (stage && !view.homeReached && age >= 0 && age < JOURNEY_BANNER_MS) {
      const alpha = age < 180 ? age / 180 : age > JOURNEY_BANNER_MS - 400 ? (JOURNEY_BANNER_MS - age) / 400 : 1;
      const pop = 1 + 0.2 * Math.max(0, 1 - age / 180);
      const text = labels.banner(view.bannerStage + 1, view.stages.length, labels.names[stage.kind]);
      let fs = Math.max(18, 0.06 * side) * pop;
      ctx.font = `900 ${fs}px sans-serif`;
      const tw = ctx.measureText(text).width;
      const maxW = 0.9 * side;
      if (tw > maxW) {
        fs *= maxW / tw;
        ctx.font = `900 ${fs}px sans-serif`;
      }
      const y = f.top + 0.2 * side;
      const color = STAGE_COLORS[stage.kind];
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(3, 0.12 * fs);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.strokeText(text, f.cx, y);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.fillText(text, f.cx, y);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
}
