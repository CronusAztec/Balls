import type { Ball, GameMode, ModeContext } from "../types";
import { arenaRadius } from "../types";
import {
  COVERAGE_DONE,
  DEFAULT_PAINT_MODE_OPTIONS,
  PACE_INTERVAL_MS,
  SUMMARY_SIZE,
  largestUnrevealedCluster,
  paceBrushScale,
  paceStatus,
  steerAngle,
  summarizeCoverage,
  type CoverageTarget,
  type PaceStatus,
  type PaintModeOptions,
} from "../picturePaint";
import { BeatClock, freshBeatSample, type BeatClockConfig, type BeatSample } from "@/lib/simulation/beatClock";

export interface PaintPoint {
  x: number;
  y: number;
  color: string;
  /** Radius of the brush dab stamped here (the ball radius in classic Paint; brush × pace × beat with a picture). */
  r: number;
}

/** Live Picture Paint state for the renderer and the HUD (one object, mutated in place). */
export interface PicturePaintState {
  picture: boolean;
  coverage: number;
  /** Increments on every (re)start, so the renderer knows to clear its reveal mask. */
  generation: number;
  /** True while the ball moves to a beat (a picture, beat sync on and a tempo to follow). */
  beatActive: boolean;
  bpm: number;
  /** 1 on a beat, decaying to ~0 before the next. */
  pulse: number;
  /** The speed / brush / glow multiplier in effect: 1 + beatPulse × pulse. */
  envelope: number;
  /** Beats since the run started (−1 before the first). */
  beatIndex: number;
  /** Brush multiplier chosen by the pacing (1 without pacing). */
  paceScale: number;
  /** Schedule hint for the HUD; null while pacing is off. */
  pace: PaceStatus | null;
  targetSec: number;
  /** Centre of the least-revealed region the guided rebounds aim at (arena px), when known. */
  guideTarget: { x: number; y: number } | null;
}

/**
 * Paint: the ball leaves a rainbow trail; coverage of the circle is tracked on a grid.
 *
 * Picture Paint (see ../picturePaint.ts) extends it when a picture is loaded (`options.picture`):
 * every sub-step records a brush dab sized by the brush setting, the pacing and the beat envelope,
 * which the renderer stamps into a reveal mask over the picture; the coverage grid counts the same
 * dabs. With beat sync the ball's velocity is scaled by `1 + beatPulse × pulse(t)` from the beat
 * clock (the scale is undone before the next one is applied, so the underlying motion is untouched
 * and a wall hit starts from a fresh, unscaled rebound); guided rebounds are nudged toward the
 * largest unrevealed cluster of the coverage summary; pacing re-sizes the brush every second so the
 * reveal finishes with the song. Every one of these is skipped without a picture, so the classic
 * Paint run and its recorded fingerprint are untouched, and none of them draws a random number.
 */
export class PaintMode implements GameMode {
  readonly name = "paint";
  private paintPoints: PaintPoint[] = [];
  private paintGrid = new Uint8Array(0);
  private readonly gridSize = 100;
  private cellsInCircle = 0;
  private paintedCells = 0;
  private coverage = 0;
  private hue = 0;
  private options: PaintModeOptions = { ...DEFAULT_PAINT_MODE_OPTIONS };
  private readonly beat = new BeatClock();
  private readonly beatSample: BeatSample = freshBeatSample();
  /** Velocity scale currently applied to each ball (by id), undone before the next one is applied. */
  private speedScale = new Map<number, number>();
  private paceScale = 1;
  private lastPaceAt = 0;
  private readonly summary = new Float32Array(SUMMARY_SIZE * SUMMARY_SIZE);
  private guideTarget: CoverageTarget | null = null;
  private generation = 0;
  private readonly state: PicturePaintState = {
    picture: false,
    coverage: 0,
    generation: 0,
    beatActive: false,
    bpm: 0,
    pulse: 0,
    envelope: 1,
    beatIndex: -1,
    paceScale: 1,
    pace: null,
    targetSec: 0,
    guideTarget: null,
  };

  init(ctx: ModeContext) {
    this.paintPoints = [];
    this.coverage = 0;
    this.paintedCells = 0;
    this.hue = 0;
    this.speedScale.clear();
    this.paceScale = 1;
    this.lastPaceAt = 0;
    this.guideTarget = null;
    this.guidePx = null;
    this.generation++;
    this.resetBeatState();
    this.initGrid();
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
  }

  /* ------------------------------------------------------------ picture paint configuration */

  /** Brush, beat sync, guidance and pacing (see picturePaint.ts); applied from the next step on, also mid-run. */
  setOptions(patch: Partial<PaintModeOptions>) {
    this.options = { ...this.options, ...patch };
    if (!this.options.picture) this.paceScale = 1;
  }

  getOptions(): PaintModeOptions {
    return { ...this.options };
  }

  /** The beat source: a detected song grid with its offset / loop, or the manual BPM (see lib/simulation/beatClock.ts). */
  setBeat(patch: Partial<BeatClockConfig>) {
    this.beat.setConfig(patch);
  }

  getBeatConfig(): BeatClockConfig {
    return this.beat.getConfig();
  }

  /** Live state for the canvas and the HUD (the same object every call). */
  getPicturePaintState(): PicturePaintState {
    const s = this.state;
    const o = this.options;
    s.picture = o.picture;
    s.coverage = this.coverage;
    s.generation = this.generation;
    s.paceScale = this.paceScale;
    s.pace = o.picture && o.paceToSong && o.targetSec > 0 ? paceStatus(this.coverage, this.lastPaceAt / 1000, o.targetSec) : null;
    s.targetSec = o.picture && o.paceToSong ? o.targetSec : 0;
    s.guideTarget = this.guidePx;
    return s;
  }

  /** The guide target in arena px, refreshed at every guided hit (so reading the state allocates nothing). */
  private guidePx: { x: number; y: number } | null = null;

  private guideTargetPx(): { x: number; y: number } | null {
    const t = this.guideTarget;
    const a = this.arena;
    if (!t || !a) return null;
    return { x: a.cx - a.R + t.x * 2 * a.R, y: a.cy - a.R + t.y * 2 * a.R };
  }

  private arena: { cx: number; cy: number; R: number } | null = null;

  private resetBeatState() {
    const s = this.state;
    s.beatActive = false;
    s.bpm = 0;
    s.pulse = 0;
    s.envelope = 1;
    s.beatIndex = -1;
  }

  /* ------------------------------------------------------------ game mode hooks */

  onPreUpdate(ctx: ModeContext) {
    const o = this.options;
    if (!o.picture) {
      // Classic Paint: nothing below runs, so the recorded fingerprint holds. The one thing done here
      // is releasing a beat sync that was in effect when the picture was removed mid-run (undo the
      // speed scale, clear the beat state), and that is a no-op unless one was.
      this.releaseBeat(ctx);
      return;
    }
    this.applyBeatEnvelope(ctx);
    if (o.paceToSong && o.targetSec > 0) {
      const now = ctx.getElapsedMs();
      if (now - this.lastPaceAt >= PACE_INTERVAL_MS) {
        this.lastPaceAt = now;
        this.paceScale = paceBrushScale(this.paceScale, this.coverage, now / 1000, o.targetSec);
      }
    } else this.paceScale = 1;
  }

  /**
   * Beat sync: scales every ball's velocity to `1 + beatPulse × pulse(t)`, undoing the scale of the
   * previous step first, so the ball accelerates on each beat and glides back between beats while
   * gravity and the rebounds act on the unscaled motion underneath.
   */
  private applyBeatEnvelope(ctx: ModeContext) {
    const o = this.options;
    const s = this.state;
    const active = o.beatSync && o.beatPulse > 0 && this.beat.isActive();
    if (!active) {
      this.releaseBeat(ctx);
      return;
    }
    const sample = this.beat.sample(ctx.getElapsedMs() / 1000, this.beatSample);
    const scale = 1 + o.beatPulse * sample.pulse;
    for (const ball of ctx.getBalls()) {
      const prev = this.speedScale.get(ball.id) ?? 1;
      const k = scale / prev;
      if (k !== 1) {
        ball.vx *= k;
        ball.vy *= k;
      }
      this.speedScale.set(ball.id, scale);
    }
    s.beatActive = true;
    s.bpm = sample.bpm;
    s.pulse = sample.pulse;
    s.envelope = scale;
    s.beatIndex = sample.index;
  }

  /**
   * Ends a beat sync that is no longer wanted (switched off, no tempo to follow, or the picture
   * removed mid-run): undoes the velocity scale still applied to every ball and clears the beat
   * state, so the ball resumes its natural speed at once, the canvas stops drawing the pulse and
   * the next beat sync starts from an unscaled ball. A no-op while no beat sync is in effect.
   */
  private releaseBeat(ctx: ModeContext) {
    if (this.speedScale.size > 0) {
      for (const ball of ctx.getBalls()) {
        const prev = this.speedScale.get(ball.id);
        if (prev && prev !== 1) {
          ball.vx /= prev;
          ball.vy /= prev;
        }
      }
      this.speedScale.clear();
    }
    if (this.state.beatActive) this.resetBeatState();
  }

  onBallStep(ctx: ModeContext, ball: Ball) {
    this.addPaintPoint(ctx, ball);
  }
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball) {
    // The engine assigns a fresh, unscaled rebound velocity right after this hook.
    if (this.options.picture && this.speedScale.size > 0) this.speedScale.set(ball.id, 1);
  }
  /**
   * Guided coverage: after the engine (and the cinematic director) chose the rebound angle, turn it
   * by at most 18° toward the centroid of the largest unrevealed cluster of the coverage summary.
   */
  adjustRebound(ctx: ModeContext, ball: Ball, _wallIndex: number, outAngle: number): number {
    const o = this.options;
    if (!o.picture || !o.guided || !this.arena) return outAngle;
    summarizeCoverage(this.paintGrid, this.gridSize, SUMMARY_SIZE, this.summary);
    this.guideTarget = largestUnrevealedCluster(this.summary, SUMMARY_SIZE);
    this.guidePx = this.guideTargetPx();
    const target = this.guidePx;
    if (!target) return outAngle;
    return steerAngle(outAngle, ball.x, ball.y, target.x, target.y);
  }
  onGapPass() {
    return false;
  }
  onPostUpdate() {}
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      ctx.setCircularWalls([{ radius: arenaRadius(ctx.config), gaps: [] }]);
      ctx.setWallRotations([0]);
    }
    return true;
  }
  shouldSkipWallCollision() {
    return false;
  }
  isFinished() {
    return this.coverage >= COVERAGE_DONE;
  }
  getState() {
    return { paintPoints: this.paintPoints, paintCoverage: this.coverage };
  }
  getPaintPoints() {
    return this.paintPoints;
  }
  getPaintCoverage() {
    return this.coverage;
  }
  /** The 100×100 coverage grid (1 = painted), for tests and tools. */
  getPaintGrid() {
    return { grid: this.paintGrid, size: this.gridSize };
  }

  /* ------------------------------------------------------------ painting */

  private initGrid() {
    const n = this.gridSize;
    this.paintGrid = new Uint8Array(n * n);
    const c = n / 2;
    let count = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        if (dx * dx + dy * dy <= c * c) count++;
      }
    }
    this.cellsInCircle = count;
  }

  /** Radius of the dab the ball leaves right now: the ball itself in classic Paint, brush × pace × beat with a picture. */
  private dabRadius(ball: Ball) {
    const o = this.options;
    if (!o.picture) return ball.radius;
    return ball.radius * o.brush * this.paceScale * this.state.envelope;
  }

  private addPaintPoint(ctx: ModeContext, ball: Ball) {
    // --- review fix (performance) --- a finished picture takes no more dabs: the trail (drawn under the end screen) stops
    // growing instead of gathering ~100 points a second for as long as the page stays open (no random numbers drawn here)
    if (this.coverage >= COVERAGE_DONE) return;
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const wall = walls[0];
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    // The picture and the coverage grid follow the unpulsed arena (breathing walls pulse `wall.radius`).
    const base = ctx.getWallBaseRadii();
    const R = base.length > 0 ? base[0] : wall.radius;
    if (!this.arena || this.arena.cx !== cx || this.arena.cy !== cy || this.arena.R !== R) this.arena = { cx, cy, R };
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    if (dx * dx + dy * dy > R * R) return;
    const minStep = 0.4 * ball.radius;
    if (this.paintPoints.length > 0) {
      const last = this.paintPoints[this.paintPoints.length - 1];
      const ex = ball.x - last.x;
      const ey = ball.y - last.y;
      if (ex * ex + ey * ey < minStep * minStep) return;
    }
    this.hue = (this.hue + 0.3) % 360;
    const r = this.dabRadius(ball);
    this.paintPoints.push({ x: ball.x, y: ball.y, color: `hsl(${this.hue}, 85%, 55%)`, r });

    const n = this.gridSize;
    const gx = ((ball.x - cx) / R + 1) * 0.5 * n;
    const gy = ((ball.y - cy) / R + 1) * 0.5 * n;
    const gr = (r / R) * 0.5 * n;
    const x0 = Math.max(0, Math.floor(gx - gr));
    const x1 = Math.min(n - 1, Math.ceil(gx + gr));
    const y0 = Math.max(0, Math.floor(gy - gr));
    const y1 = Math.min(n - 1, Math.ceil(gy + gr));
    const c = n / 2;
    let painted = this.paintedCells;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ddx = x + 0.5 - gx;
        const ddy = y + 0.5 - gy;
        if (ddx * ddx + ddy * ddy > gr * gr) continue;
        const cdx = x + 0.5 - c;
        const cdy = y + 0.5 - c;
        if (cdx * cdx + cdy * cdy > c * c) continue;
        const i = y * n + x;
        if (this.paintGrid[i] === 0) {
          this.paintGrid[i] = 1;
          painted++;
        }
      }
    }
    this.paintedCells = painted;
    this.coverage = this.cellsInCircle > 0 ? painted / this.cellsInCircle : 0;
  }
}
