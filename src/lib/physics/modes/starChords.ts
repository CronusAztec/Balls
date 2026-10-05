import type { Ball, GameMode, LoopSeams, ModeContext, SoundEvent } from "../types";
import { arenaRadius } from "../types";
import { pluckVelocity } from "@/lib/audio/loopTones";
import {
  SC_CHORD_HZ,
  SC_EPS,
  ballColorOf,
  ballPitches,
  ballSpeed,
  bouncesAt,
  closingsAt,
  fadeStartsAt,
  periodOf,
  phaseAt,
  positionAt,
  resolveStarChordsSettings,
  serializeStars,
  starLaps,
  starsForBalls,
  startAngles,
  totalBouncesAt,
  type ScEnvelope,
  type ScPalette,
  type ScPhase,
  type ScPhaseName,
  type StarChordsSettings,
  type StarSpec,
} from "../starChords";

/*
 * --- chord-stars --- Chord Stars (rhythm family, lib/physics/starChords.ts holds the maths and the settings): balls ride inside
 * one circle, each drawing a star polygon {n/k} – every bounce keeps its angle, so the contact point moves k of n points round
 * the circle and every chord touches the same inner circle – at the speed that closes every star on the same frame, T seconds
 * in. The drawing then holds, fades and starts again: a seamless loop of T + hold + fade (`cycleSeconds()`, `loopSeams()`).
 *
 * The motion is analytic like the Pendulum Wave's: the mode owns its playfield (the "none" ring layout) and pins ordinary engine
 * balls to the positions the simulation clock gives (`positionAt()`, every sub-step), so a run is exact at any frame rate and the
 * fast export replays it bit for bit. The bounces of a step are counted, not detected: a ball's bounces so far are a function of
 * the clock (`totalBouncesAt()`), so none is missed or counted twice however long a step is – a star of a billion points costs
 * what a pentagram costs. Nothing is random: the run is the same for every seed (Find Simulation searches star sets instead).
 *
 * Sound (lib/audio/loopTones.ts through `ToneGenerator.playLoop()`, `SoundEvent.loop`): a ball's bounce is a pentatonic pluck
 * (or the chime or the tuned bar) on the ball's own pitch – its speed's rank in the A major pentatonic – at the narrow velocity
 * 0.8 + 0.2 × its speed, 1/√n when n balls bounce in one step, its 3f partial for the fast ones; at most one note a ball a step
 * and SC_SOUNDS_PER_STEP a step. A star that closes before the others (a step sharing a factor with n closes its reduced star
 * early) rings a soft ding an octave over its ball's note; when the stars close together, the completion chord on A2 (with its
 * ding and sub); when the fade starts, every loop voice cut (after a hold of SC_MIN_CUT_HOLD_SEC or more) and a reset glide from
 * the chord's root to an octave under the next cycle's first note, silent exactly at the seam. Every bounce is also bounce
 * math's "bounce" trigger.
 */

/** Notes a step plays at most (one a ball, the balls taken round-robin past it); the chord, cut and glide come on top. */
export const SC_SOUNDS_PER_STEP = 20;
/** Bounce math's bounce triggers a step reports at most. */
export const SC_BOUNCE_TRIGGERS_PER_STEP = 64;
/** The fade's hard cut of the ringing voices only after a hold this long (s): a shorter one lets the chord ring under the glide. */
export const SC_MIN_CUT_HOLD_SEC = 0.3;
/** A ball's radius as a share of the page's Ball Size (small balls on the rim, like the clip's). */
export const SC_BALL_SCALE = 0.7;
/** The chords of a cycle past which the canvas fades the oldest (the drawing's work ceiling; nothing is stored per chord). */
export const SC_CHORD_CEILING = 200_000;
/** The level of the ding a star rings when it closes before the others (× its ball's pluck level). */
export const SC_EARLY_DING_LEVEL = 0.5;

/** The run's geometry (world px): the circle's centre and radius, the radius the chords' vertices lie on, the balls' radius. */
export interface StarChordsField {
  cx: number;
  cy: number;
  radius: number;
  chordRadius: number;
  ballRadius: number;
}

/** What the canvas, the HUD, the finder and the smoke test read of a run (the same object every call). */
export interface StarChordsView {
  /** Bumped by every init (the canvas starts its chord layer over). */
  generation: number;
  count: number;
  stars: StarSpec[];
  /** The stars as stored ("5/2,7/3,…"; the run's, extended past the typed list). */
  starsText: string;
  /** Per ball: how often a cycle traces its reduced star (gcd(n, k)), its start angle, pitch (Hz) and speed (world px/s). */
  laps: Int32Array;
  theta0: Float64Array;
  pitch: Float64Array;
  speed: Float64Array;
  colors: string[];
  /** Bumped whenever the colours change (the canvas repaints its chords in the new ones). */
  colorVersion: number;
  /** Per ball: its bounces (chords drawn) in this cycle, its place now, the cycle time its star first closed (−1: not yet). */
  bounces: Float64Array;
  x: Float64Array;
  y: Float64Array;
  closedAt: Float64Array;
  field: StarChordsField;
  cycleSec: number;
  holdSec: number;
  fadeSec: number;
  periodSec: number;
  /** Simulation time (s) of the last step, the cycle it is in (0 = the first), the time into it, its phase and how far through. */
  timeSec: number;
  cycleIndex: number;
  cycleTime: number;
  phase: ScPhaseName;
  phaseProgress: number;
  /** Stars closed in this cycle (the HUD's "stars closed 3/5"). */
  closed: number;
  /** Chords drawn in this cycle, a cycle's chords (Σn), every chord of the run, and the last finished cycle's count (−1 before). */
  chordsThisCycle: number;
  chordsPerCycle: number;
  totalChords: number;
  lastCycleChords: number;
  /** Finished cycles (the loop's seams) and the times every star closed together; the last of them (simulation s, −1 before). */
  cycles: number;
  closings: number;
  lastAllClosedSec: number;
  /** The look the canvas draws with. */
  lineWidth: number;
  envelope: ScEnvelope;
  palette: ScPalette;
  /** A cycle has more chords than SC_CHORD_CEILING: the canvas fades the oldest. */
  pastCeiling: boolean;
}

export class StarChordsMode implements GameMode {
  readonly name = "starChords";
  /** The balls are placed analytically: no slow-ball boost and no pair collisions may touch them. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: StarChordsSettings = resolveStarChordsSettings(null);
  private readonly view: StarChordsView = {
    generation: 0,
    count: 0,
    stars: [],
    starsText: "",
    laps: new Int32Array(0),
    theta0: new Float64Array(0),
    pitch: new Float64Array(0),
    speed: new Float64Array(0),
    colors: [],
    colorVersion: 0,
    bounces: new Float64Array(0),
    x: new Float64Array(0),
    y: new Float64Array(0),
    closedAt: new Float64Array(0),
    field: { cx: 0, cy: 0, radius: 0, chordRadius: 0, ballRadius: 0 },
    cycleSec: 12,
    holdSec: 1.2,
    fadeSec: 1.8,
    periodSec: 15,
    timeSec: 0,
    cycleIndex: 0,
    cycleTime: 0,
    phase: "draw",
    phaseProgress: 0,
    closed: 0,
    chordsThisCycle: 0,
    chordsPerCycle: 0,
    totalChords: 0,
    lastCycleChords: -1,
    cycles: 0,
    closings: 0,
    lastAllClosedSec: -1,
    lineWidth: 1.5,
    envelope: "closed",
    palette: "pastel",
    pastCeiling: false,
  };
  /** Per ball: every bounce so far (a running count over the cycles) at the end of the last step. */
  private totals = new Float64Array(0);
  private readonly byId = new Map<number, number>();
  private level = new Float64Array(0);
  private bright = new Uint8Array(0);
  /** The step being run: its start (s) and the sub-steps done. */
  private stepStart = 0;
  private sub = 0;
  private steps = 0;
  private lastBallRadius = 0;
  /** What the balls' colours were made of (a change repaints them). */
  private colorPalette: ScPalette | "" = "";
  private colorBall = "";
  private colorCount = 0;
  /** The closings and fade starts counted so far (each a running count of the clock, like the bounces). */
  private closingsSeen = 0;
  private fadesSeen = 0;
  private readonly scratch: ScPhase = { index: 0, cycleTime: 0, phase: "draw", progress: 0 };
  private readonly place = { x: 0, y: 0, vx: 0, vy: 0 };
  /** Balls that bounced in the step (indexes), for the notes, and the step each ball last bounced in (the bounce triggers). */
  private bounced = new Int32Array(0);
  private bouncedStep = new Float64Array(0);
  /** Balls whose star closed in the step before the others' (indexes), for their dings. */
  private closedEarly = new Int32Array(0);

  getSettings(): StarChordsSettings {
    return this.settings;
  }
  /** The run (balls, stars, timing, spread) applies on the next init; the look and the sound follow at once. */
  setSettings(patch: Partial<StarChordsSettings>) {
    this.settings = resolveStarChordsSettings({ ...this.settings, ...patch });
    const v = this.view;
    v.lineWidth = this.settings.lineWidth;
    v.envelope = this.settings.envelope;
    v.palette = this.settings.palette;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): StarChordsView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { cycles: v.cycles, closed: v.closed, count: v.count, chords: v.chordsThisCycle, chordsPerCycle: v.chordsPerCycle, totalChords: v.totalChords };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    const count = Math.max(1, s.balls);
    v.generation++;
    v.count = count;
    v.stars = starsForBalls(s.stars, count);
    v.starsText = serializeStars(v.stars);
    v.cycleSec = s.cycleSec;
    v.holdSec = s.holdSec;
    v.fadeSec = s.fadeSec;
    v.periodSec = periodOf(s.cycleSec, s.holdSec, s.fadeSec);
    v.lineWidth = s.lineWidth;
    v.envelope = s.envelope;
    v.palette = s.palette;
    if (v.theta0.length !== count) {
      v.laps = new Int32Array(count);
      v.theta0 = new Float64Array(count);
      v.pitch = new Float64Array(count);
      v.speed = new Float64Array(count);
      v.bounces = new Float64Array(count);
      v.x = new Float64Array(count);
      v.y = new Float64Array(count);
      v.closedAt = new Float64Array(count);
      this.totals = new Float64Array(count);
      this.level = new Float64Array(count);
      this.bright = new Uint8Array(count);
      this.bounced = new Int32Array(count);
      this.bouncedStep = new Float64Array(count);
      this.closedEarly = new Int32Array(count);
    }
    startAngles(count, s.spread, v.theta0);
    let perCycle = 0;
    for (let i = 0; i < count; i++) {
      v.laps[i] = starLaps(v.stars[i]);
      perCycle += v.stars[i].n;
    }
    v.chordsPerCycle = perCycle;
    v.pastCeiling = perCycle > SC_CHORD_CEILING;
    v.bounces.fill(0);
    v.closedAt.fill(-1);
    this.totals.fill(0);
    v.timeSec = 0;
    v.cycleIndex = 0;
    v.cycleTime = 0;
    v.phase = "draw";
    v.phaseProgress = 0;
    v.closed = 0;
    v.chordsThisCycle = 0;
    v.totalChords = 0;
    v.lastCycleChords = -1;
    v.cycles = 0;
    v.closings = 0;
    v.lastAllClosedSec = -1;
    this.stepStart = 0;
    this.sub = 0;
    this.steps = 0;
    this.closingsSeen = 0;
    this.fadesSeen = 0;
    this.bouncedStep.fill(-1);
    this.lastBallRadius = ctx.config.ballRadius || 8;
    this.layOut(ctx);
    this.colorPalette = "";
    this.refreshColors(ctx);
    this.byId.clear();
    for (let i = 0; i < count; i++) {
      this.placeBall(i, 0);
      ctx.addBall({ x: v.x[i], y: v.y[i], vx: 0, vy: 0, radius: v.field.ballRadius, color: v.colors[i], gravityScale: 0, radiusScale: SC_BALL_SCALE });
      this.byId.set(ctx.getNextId() - 1, i);
    }
  }

  /** The circle (the arena's radius, as the ring modes have it), the vertices' radius (the balls touch the wall) and the balls' size. */
  private layOut(ctx: ModeContext) {
    const v = this.view;
    const f = v.field;
    f.cx = ctx.config.width / 2;
    f.cy = ctx.config.height / 2;
    f.radius = arenaRadius(ctx.config);
    f.ballRadius = Math.max(0.5, (ctx.config.ballRadius || 8) * SC_BALL_SCALE);
    f.chordRadius = Math.max(1, f.radius - f.ballRadius);
    let fastest = 0;
    for (let i = 0; i < v.count; i++) {
      v.speed[i] = ballSpeed(f.chordRadius, v.stars[i], v.cycleSec);
      if (v.speed[i] > fastest) fastest = v.speed[i];
    }
    ballPitches(v.speed, v.pitch);
    for (let i = 0; i < v.count; i++) {
      const norm = fastest > 0 ? v.speed[i] / fastest : 1;
      this.level[i] = pluckVelocity(norm);
      this.bright[i] = norm >= 0.66 ? 1 : 0;
    }
  }

  /** The balls' colours (the palette, or the page's Ball Color) – recomputed only when one of them changed. */
  private refreshColors(ctx: ModeContext) {
    const v = this.view;
    const ballColor = ctx.config.ballColor || "#ffffff";
    if (v.palette === this.colorPalette && ballColor === this.colorBall && v.count === this.colorCount) return;
    this.colorPalette = v.palette;
    this.colorBall = ballColor;
    this.colorCount = v.count;
    v.colors.length = v.count;
    for (let i = 0; i < v.count; i++) v.colors[i] = ballColorOf(i, v.count, v.palette, ballColor);
    v.colorVersion++;
    for (const ball of ctx.getBalls()) {
      const i = this.byId.get(ball.id);
      if (i !== undefined) ball.color = v.colors[i];
    }
  }

  /** Ball `i` where the clock puts it at simulation time `t` (s), in the view's arrays (and `this.place`). */
  private placeBall(i: number, t: number) {
    const v = this.view;
    const p = phaseAt(t, v.cycleSec, v.holdSec, v.fadeSec, this.scratch);
    const f = v.field;
    positionAt(f.cx, f.cy, f.chordRadius, v.theta0[i], v.stars[i], v.cycleSec, p.cycleTime, this.place);
    v.x[i] = this.place.x;
    v.y[i] = this.place.y;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.stepStart = (ctx.getElapsedMs() - dtMs) / 1000;
    this.sub = 0;
    // A live change of the Ball Size moves the vertices' radius with the balls (the canvas redraws its chords for it).
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.lastBallRadius) {
      this.lastBallRadius = radius;
      this.layOut(ctx);
    }
    this.refreshColors(ctx);
  }

  /**
   * The engine moved the ball by its velocity (plus any wind or spin); put it where the clock says it is at this sub-step's
   * time, moving along its chord (its velocity is the chord's, so a face looks along the flight).
   */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const i = this.byId.get(ball.id);
    if (i === undefined) return;
    const v = this.view;
    const t = this.stepStart + (this.sub + 1) * dtSec;
    const p = phaseAt(t, v.cycleSec, v.holdSec, v.fadeSec, this.scratch);
    const f = v.field;
    positionAt(f.cx, f.cy, f.chordRadius, v.theta0[i], v.stars[i], v.cycleSec, p.cycleTime, this.place);
    ball.x = this.place.x;
    ball.y = this.place.y;
    ball.vx = this.place.vx;
    ball.vy = this.place.vy;
    ball.radius = f.ballRadius;
    v.x[i] = ball.x;
    v.y[i] = ball.y;
  }

  onPostSubStep() {
    this.sub++;
  }

  /**
   * Counts the step's bounces from the clock (each ball's running count now against the step's start), keeps the cycle's
   * counters and queues the sounds: the bounces' notes, the chord when the stars close, the cut and the glide when the fade starts.
   */
  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const t1 = ctx.getElapsedMs() / 1000;
    const T = v.cycleSec;
    const hold = v.holdSec;
    const fade = v.fadeSec;
    const p = phaseAt(t1, T, hold, fade, this.scratch);
    const index = p.index;
    const tc = p.cycleTime;
    const phase = p.phase;
    const progress = p.progress;
    // A new cycle: the last one's chords are counted (Σn when every bounce was), the closings start over.
    if (index !== v.cycleIndex) {
      let last = 0;
      const finished = index - 1;
      for (let i = 0; i < v.count; i++) last += Math.min(v.stars[i].n, Math.max(0, this.totalsAt(i, t1) - finished * v.stars[i].n));
      v.lastCycleChords = last;
      v.closedAt.fill(-1);
    }
    v.timeSec = t1;
    v.cycleIndex = index;
    v.cycleTime = tc;
    v.phase = phase;
    v.phaseProgress = progress;
    v.cycles = index;
    let bouncedCount = 0;
    let earlyCount = 0;
    let chords = 0;
    let closed = 0;
    for (let i = 0; i < v.count; i++) {
      const n = v.stars[i].n;
      const total = this.totalsAt(i, t1);
      const added = total - this.totals[i];
      if (added > 0) {
        this.totals[i] = total;
        v.totalChords += added;
        this.bounced[bouncedCount++] = i;
        this.bouncedStep[i] = this.steps;
      }
      const b = bouncesAt(tc, n, T);
      v.bounces[i] = b;
      chords += b;
      // the reduced star closes every n / laps bounces: the first time this cycle is when its inner circle may appear
      if (b >= n / v.laps[i]) {
        closed++;
        if (v.closedAt[i] < 0) {
          v.closedAt[i] = Math.min(tc, T / v.laps[i]);
          // closed before the others (its reduced star, early): its own ding – the stars closing together get the chord
          if (tc < T - SC_EPS) this.closedEarly[earlyCount++] = i;
        }
      }
    }
    v.chordsThisCycle = chords;
    v.closed = closed;
    // The stars closed together in this step: the chord (once, however many cycles a long step crossed). Counted from the clock
    // against the count at the last step, like the bounces, so a closing on a step's boundary is counted exactly once.
    const closingsNow = closingsAt(t1, T, hold, fade, this.scratch);
    const closings = closingsNow - this.closingsSeen;
    if (closings > 0) {
      this.closingsSeen = closingsNow;
      v.closings += closings;
      v.lastAllClosedSec = (closingsNow - 1) * v.periodSec + T;
    }
    const fadesNow = fade > 0 ? fadeStartsAt(t1, T, hold, fade, this.scratch) : 0;
    const fades = fadesNow - this.fadesSeen;
    if (fades > 0) this.fadesSeen = fadesNow;
    this.queueSounds(ctx, bouncedCount, earlyCount, closings > 0, fades > 0);
    this.steps++;
  }

  /** Ball `i`'s running bounce count at `t` (s). */
  private totalsAt(i: number, t: number): number {
    const v = this.view;
    return totalBouncesAt(t, v.stars[i].n, v.cycleSec, v.holdSec, v.fadeSec, this.scratch);
  }

  /** The step's sounds: a note per ball that bounced (round-robin past the cap), an early star's ding, the chord, the cut and the reset glide. */
  private queueSounds(ctx: ModeContext, bouncedCount: number, earlyCount: number, allClosed: boolean, fadeStarts: boolean) {
    const s = this.settings;
    const v = this.view;
    // bounce math's "bounce" trigger, a ball at a time
    if (ctx.noteBounce && bouncedCount > 0) {
      let reported = 0;
      for (const ball of ctx.getBalls()) {
        if (reported >= SC_BOUNCE_TRIGGERS_PER_STEP) break;
        const i = this.byId.get(ball.id);
        if (i === undefined || this.bouncedStep[i] !== this.steps) continue;
        ctx.noteBounce(ball);
        reported++;
      }
    }
    if (s.voice !== "silent" && bouncedCount > 0) {
      const playing = Math.min(bouncedCount, SC_SOUNDS_PER_STEP);
      const share = 1 / Math.sqrt(playing);
      const start = bouncedCount > SC_SOUNDS_PER_STEP ? this.steps % bouncedCount : 0;
      for (let j = 0; j < playing; j++) {
        const i = this.bounced[(start + j) % bouncedCount];
        const event: SoundEvent = { type: "hit", wallIndex: 0, loop: s.voice, frequency: v.pitch[i], level: this.level[i] * share, melody: false };
        if (s.voice === "pluck" && this.bright[i]) event.loopBright = true;
        ctx.addPendingSoundEvent(event);
      }
    }
    if (!s.chord) return;
    for (let j = 0; j < earlyCount && j < SC_SOUNDS_PER_STEP; j++) {
      const i = this.closedEarly[j];
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "ding", frequency: 2 * v.pitch[i], level: SC_EARLY_DING_LEVEL * this.level[i], melody: false });
    }
    if (allClosed) ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: SC_CHORD_HZ, level: 1, melody: false });
    if (fadeStarts) {
      if (v.holdSec >= SC_MIN_CUT_HOLD_SEC) ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "cut", melody: false });
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "glide", frequency: SC_CHORD_HZ, loopTo: this.firstPitch() / 2, loopSec: v.fadeSec, melody: false });
    }
  }

  /** The pitch of the next cycle's first note: the ball that bounces first (the most points), the first of them on a tie. */
  private firstPitch(): number {
    const v = this.view;
    let best = 0;
    for (let i = 1; i < v.count; i++) if (v.stars[i].n > v.stars[best].n) best = i;
    return v.pitch[best] || 2 * SC_CHORD_HZ;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize re-lays the circle out and puts every ball back where the clock says. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.layOut(ctx);
      const t = ctx.getElapsedMs() / 1000;
      for (const ball of ctx.getBalls()) {
        const i = this.byId.get(ball.id);
        if (i === undefined) continue;
        this.placeBall(i, t);
        ball.x = this.view.x[i];
        ball.y = this.view.y[i];
        ball.radius = this.view.field.ballRadius;
      }
    }
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  /** The loop goes on forever: the recording's length (in whole loops) ends a clip. */
  isFinished() {
    return false;
  }
  // --- the loop contract (lib/loop/loopContract.ts): the cycle is known from the start, every seam a cycle apart
  cycleSeconds(): number | null {
    return this.view.periodSec;
  }
  loopSeams(): LoopSeams {
    const v = this.view;
    const period = 1000 * v.periodSec;
    return { count: v.cycles, lastMs: v.cycles > 0 ? v.cycles * period : -1, nextMs: (v.cycles + 1) * period };
  }
  getState() {
    const v = this.view;
    return { cycles: v.cycles, closed: v.closed, chords: v.chordsThisCycle, totalChords: v.totalChords, closings: v.closings, timeSec: v.timeSec };
  }
}
