import type { Ball, GameMode, LoopSeams, ModeContext, SoundEvent } from "../types";
import { grooveProgression } from "@/lib/audio/loopTones";
import { midiToFrequency } from "@/lib/audio/scales";
import {
  EF_BALL_SCALE,
  EF_BEATS_PER_TRANSIT,
  EF_CHORD_HZ,
  EF_CONVERGE_EPS,
  EF_IMPACT_HZ,
  EF_KEY_ROOT_MIDI,
  EF_TIME_EPS,
  EF_VERTEX_CAP,
  ballColorOfHue,
  ballHue,
  bedBpm,
  bedChordIndex,
  bedKicks,
  efLoopSeconds,
  efLoopTransits,
  ellipseFrame,
  focalPass,
  hitDegree,
  isRefire,
  isSeam,
  ladderHz,
  launchAngles,
  launchFocusU,
  loopPassCount,
  resolveEllipseFociSettings,
  runEccentricity,
  thinningSeconds,
  toWorld,
  type EllipseFociSettings,
  type EllipseFrame,
  type FocalPass,
} from "../ellipseFoci";

/*
 * --- ellipse-foci --- Focus Shot (rhythm family; lib/physics/ellipseFoci.ts holds the maths and the settings): an elliptical
 * pool, a volley of balls fired at once from one focus, every way. A ball fired from a focus bounces off the wall straight
 * through the other focus and every such path is 2a long, so the whole volley arrives at the other focus together one transit
 * T later (the speed is 2a / T), then at the first one, and so on – while each pass narrows the swarm onto the long axis.
 *
 * The motion is analytic, like the Pendulum Wave's: the mode owns its playfield (the "none" ring layout) and pins ordinary
 * engine balls (no gravity, `ballsMayRest`, `ballsPassThrough`) to where the simulation clock puts them, every sub-step. A
 * ball's state is its transit: the focus it left, its direction, the wall hit (the ray–ellipse quadratic) and the direction
 * it leaves the wall with (the reflection about the ellipse's normal); at the end of a transit it starts the next one exactly
 * at the other focus (no drift) – or, at a refire, a fresh volley at the start focus. The arrival point the reflection gives is
 * checked against the focus (`convError`): a convergence is every ball within EF_CONVERGE_EPS of it, which exact arithmetic
 * gives at t = k · T. Nothing is integrated, so a seed replays bit for bit at any frame rate and in the fast export.
 *
 * The seeded choices, in this order (`ctx.random()`): the hue wheel's offset, then the groove bed's chord progression.
 *
 * Sound (lib/audio/loopTones.ts through `ToneGenerator.playLoop()`, `SoundEvent.loop`): every wall hit is a pentatonic pluck
 * running down the ladder in hit order within a transit (`hitDegree()`: the first hits of a volley high, the last low; the hits
 * of a step on one degree are one note at √(their share) of the level, at most 6 notes a step), 12 dB softer in the pre-drop
 * (the last min(0.4 s, T / 10) before a convergence); every convergence the impact – kick, noise crack and the tonic chord on
 * G3 – and at a loop's seam the completion chord on G2 too. The groove bed (pad, sub and a kick on every beat at 8 · 60 / T
 * BPM – two bars a transit, so a convergence always lands on a bar line) changes chord every transit; in a refire loop its kick
 * drops at the loop's first convergence. Every wall hit is also bounce math's "bounce" trigger.
 */

/** Notes a step plays at most (the largest groups of hits first). */
export const EF_NOTES_PER_STEP = 6;
/** Bounce math's bounce triggers a step reports at most. */
export const EF_BOUNCE_TRIGGERS_PER_STEP = 64;
/** The pluck's level, the kick's, the impact's and the completion chord's. */
export const EF_PLUCK_LEVEL = 0.85;
export const EF_KICK_LEVEL = 0.8;
export const EF_IMPACT_LEVEL = 1;
export const EF_SEAM_CHORD_LEVEL = 0.8;
/** The pre-drop's cut of the plucks (−12 dB). */
export const EF_THINNED = 0.25;
/** Spreads and per-convergence sound counts the view keeps (the first ones of a run). */
export const EF_LOG_CAP = 64;

/** What the canvas, the HUD, the finder, the smoke test and the tests read of a run (the same object every call). */
export interface EllipseFociView {
  /** Bumped by every init (the canvas starts its trails over). */
  generation: number;
  /** Balls in the run. */
  count: number;
  /** The run's settings (the look – skin, trail, paths – and the bed follow live). */
  settings: EllipseFociSettings;
  /** The eccentricity the run uses, the minor semi-axis (unit major semi-axis), the launch focus (u, ±e). */
  e: number;
  b: number;
  focusU: number;
  /** Where the ellipse lies in the world (px). */
  frame: EllipseFrame;
  /** The balls' radius (world px). */
  ballRadius: number;
  /** The seeded hue offset and the launch angles, hues and colours of the balls. */
  hueOffset: number;
  angles: Float64Array;
  hues: Float32Array;
  colors: string[];
  /** Simulation time (s) of the last step and the transit it is in (0 = the first). */
  timeSec: number;
  transit: number;
  /** The balls where the clock puts them (world px). */
  x: Float64Array;
  y: Float64Array;
  /** Every ball's corners (unit coordinates and simulation s): the launch and its wall hits since, newest at `vtHead`, `vtLen` of them. */
  vertexCap: number;
  vtT: Float64Array;
  vtU: Float64Array;
  vtW: Float64Array;
  vtHead: Int32Array;
  vtLen: Int32Array;
  /** Wall hits, convergences (arrivals: the run's start is not one), volleys fired (the start included), seams, sound events. */
  hits: number;
  convergences: number;
  volleys: number;
  seams: number;
  sounds: number;
  /** The sound events emitted up to and including each convergence's step (the first EF_LOG_CAP; index k − 1 for convergence k). */
  convSounds: number[];
  /** The lateral spread (world px) of every finished transit (the first EF_LOG_CAP), and of the last one. */
  spreads: number[];
  lastSpread: number;
  /** How far (unit major axis) the worst ball of the last transit landed from its focus, and the worst of the run. */
  convError: number;
  maxConvError: number;
  /** Balls whose position was not finite at the last step (always 0). */
  nonFinite: number;
  /** The last convergence (s; −1 before the first) and its focus (u); the focus the latest volley was fired from. */
  lastConvergenceSec: number;
  lastConvergenceU: number;
  lastVolleyU: number;
  /** The groove bed: playing, its tempo, its chord now (index into the progression). */
  bedOn: boolean;
  bpm: number;
  chord: number;
  /** The loop's length (s; null: the swarm keeps collapsing) and the transits in it. */
  loopSec: number | null;
  loopTransits: number;
}

const PASS: FocalPass = { dist: 0, qu: 0, qw: 0, du: 0, dw: 0, arrivalU: 0, arrivalW: 0 };
const POINT = { x: 0, y: 0 };

export class EllipseFociMode implements GameMode {
  readonly name = "ellipseFoci";
  /** The balls are placed analytically: no slow-ball boost and no pair collisions may touch them. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: EllipseFociSettings = resolveEllipseFociSettings(null);
  private readonly view: EllipseFociView = {
    generation: 0,
    count: 0,
    settings: resolveEllipseFociSettings(null),
    e: 0.65,
    b: Math.sqrt(1 - 0.65 * 0.65),
    focusU: -0.65,
    frame: { cx: 400, cy: 225, scale: 190, vertical: true },
    ballRadius: 2.8,
    hueOffset: 0,
    angles: new Float64Array(0),
    hues: new Float32Array(0),
    colors: [],
    timeSec: 0,
    transit: 0,
    x: new Float64Array(0),
    y: new Float64Array(0),
    vertexCap: EF_VERTEX_CAP,
    vtT: new Float64Array(0),
    vtU: new Float64Array(0),
    vtW: new Float64Array(0),
    vtHead: new Int32Array(0),
    vtLen: new Int32Array(0),
    hits: 0,
    convergences: 0,
    volleys: 0,
    seams: 0,
    sounds: 0,
    convSounds: [],
    spreads: [],
    lastSpread: 0,
    convError: 0,
    maxConvError: 0,
    nonFinite: 0,
    lastConvergenceSec: -1,
    lastConvergenceU: 0,
    lastVolleyU: -0.65,
    bedOn: false,
    bpm: 120,
    chord: 0,
    loopSec: 16,
    loopTransits: 4,
  };
  /** Per ball: the transit its state is in, the focus it left (u), its direction, the wall hit, the direction off the wall. */
  private kBall = new Int32Array(0);
  private fu = new Float64Array(0);
  private du = new Float64Array(0);
  private dw = new Float64Array(0);
  private dist = new Float64Array(0);
  private qu = new Float64Array(0);
  private qw = new Float64Array(0);
  private ru = new Float64Array(0);
  private rw = new Float64Array(0);
  private hitDone = new Uint8Array(0);
  /** The step each ball last hit the wall in (bounce math's triggers). */
  private hitStep = new Float64Array(0);
  /** The id of ball 0 (the balls' ids run on from it, in index order). */
  private firstId = 0;
  /** The step's wall hits: ball, distance from the focus (unit) and time (s). */
  private stepHits = 0;
  private hitBall = new Int32Array(0);
  private hitDist = new Float64Array(0);
  private hitTime = new Float64Array(0);
  /** The worst arrival error and the lateral spread of the last transits, by transit (a ring of 4). */
  private readonly errAcc = new Float64Array(4);
  private readonly spreadAcc = new Float64Array(4);
  private progression: { root: number; minor: boolean }[] = [];
  private transitSec = 4;
  /** Unit major semi-axes a second (2 / T). */
  private speed = 0.5;
  private stepStart = 0;
  private sub = 0;
  private steps = 0;
  private lastBallRadius = 0;
  /** The groove bed's state the sound events last set (playing or not), and a request to re-send its chord (a resume). */
  private bedPlaying = false;
  private bedDirty = false;
  /** Scratch of the step's notes: hits and thinned hits per ladder degree. */
  private readonly degreeHits = new Float64Array(16);
  private readonly degreeLevel = new Float64Array(16);

  getSettings(): EllipseFociSettings {
    return this.settings;
  }
  /** The volley, the geometry and the timing apply on the next init; the look (skin, trail, paths) and the bed follow at once. */
  setSettings(patch: Partial<EllipseFociSettings>) {
    this.settings = resolveEllipseFociSettings({ ...this.settings, ...patch });
    const s = this.settings;
    const v = this.view.settings;
    v.skin = s.skin;
    v.trailSec = s.trailSec;
    v.paths = s.paths;
    v.bed = s.bed;
    v.counter = s.counter;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): EllipseFociView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { convergences: v.convergences, volleys: v.volleys, seams: v.seams, hits: v.hits, sounds: v.sounds, transit: v.transit, lastSpread: v.lastSpread, convError: v.maxConvError };
  }
  /** The loop HUD's counter: the passes done in the current loop (null with the counter off). */
  hudCount(): number | null {
    const v = this.view;
    return v.settings.counter ? loopPassCount(v.settings.reset, v.settings.passes, v.transit) : null;
  }
  /** The page resumed a paused run (or the bed came back on): the next step sends the bed's chord again. */
  refreshBed() {
    this.bedDirty = true;
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    // the seeded choices, in their documented order: the hue offset, then the bed's progression
    const hueOffset = 360 * ctx.random();
    this.progression = grooveProgression(() => ctx.random(), EF_KEY_ROOT_MIDI);
    const count = Math.max(1, s.count);
    v.generation++;
    v.settings = { ...s };
    v.count = count;
    v.hueOffset = hueOffset;
    v.e = runEccentricity(s.eccentricity);
    v.b = Math.sqrt(1 - v.e * v.e);
    v.focusU = launchFocusU(s.launch, v.e);
    this.transitSec = s.transitSec;
    this.speed = 2 / s.transitSec;
    v.loopSec = efLoopSeconds(s.reset, s.passes, s.transitSec);
    v.loopTransits = efLoopTransits(s.reset, s.passes);
    v.bpm = bedBpm(s.transitSec);
    if (v.angles.length !== count) this.allocate(count);
    launchAngles(count, s.spreadDeg, s.aimDeg, v.angles);
    v.colors.length = count;
    for (let i = 0; i < count; i++) {
      v.hues[i] = ballHue(i, count, hueOffset);
      v.colors[i] = ballColorOfHue(v.hues[i]);
    }
    v.timeSec = 0;
    v.transit = 0;
    v.hits = 0;
    v.convergences = 0;
    v.volleys = 1;
    v.seams = 0;
    v.sounds = 0;
    v.convSounds.length = 0;
    v.spreads.length = 0;
    v.lastSpread = 0;
    v.convError = 0;
    v.maxConvError = 0;
    v.nonFinite = 0;
    v.lastConvergenceSec = -1;
    v.lastConvergenceU = v.focusU;
    v.lastVolleyU = v.focusU;
    v.bedOn = false;
    v.chord = 0;
    this.errAcc.fill(0);
    this.spreadAcc.fill(0);
    this.stepHits = 0;
    this.stepStart = 0;
    this.sub = 0;
    this.steps = 0;
    this.bedPlaying = false;
    this.bedDirty = false;
    this.hitStep.fill(-1);
    this.lastBallRadius = ctx.config.ballRadius || 8;
    this.layOut(ctx);
    this.firstId = ctx.getNextId();
    for (let i = 0; i < count; i++) {
      this.launch(i, 0, v.focusU);
      this.place(i, 0);
      const speed = this.speed * v.frame.scale;
      ctx.addBall({ x: v.x[i], y: v.y[i], vx: this.worldDx(this.du[i], this.dw[i]) * speed, vy: this.worldDy(this.du[i], this.dw[i]) * speed, radius: v.ballRadius, color: v.colors[i], gravityScale: 0, radiusScale: EF_BALL_SCALE });
    }
  }

  private allocate(count: number) {
    const v = this.view;
    v.angles = new Float64Array(count);
    v.hues = new Float32Array(count);
    v.x = new Float64Array(count);
    v.y = new Float64Array(count);
    v.vtT = new Float64Array(count * EF_VERTEX_CAP);
    v.vtU = new Float64Array(count * EF_VERTEX_CAP);
    v.vtW = new Float64Array(count * EF_VERTEX_CAP);
    v.vtHead = new Int32Array(count);
    v.vtLen = new Int32Array(count);
    this.kBall = new Int32Array(count);
    this.fu = new Float64Array(count);
    this.du = new Float64Array(count);
    this.dw = new Float64Array(count);
    this.dist = new Float64Array(count);
    this.qu = new Float64Array(count);
    this.qw = new Float64Array(count);
    this.ru = new Float64Array(count);
    this.rw = new Float64Array(count);
    this.hitDone = new Uint8Array(count);
    this.hitStep = new Float64Array(count);
    // a step's hits: every ball at most a few times (a step covers at most a few transits even when time runs fast)
    this.hitBall = new Int32Array(4 * count);
    this.hitDist = new Float64Array(4 * count);
    this.hitTime = new Float64Array(4 * count);
  }

  /** The world frame (the page's size and the Size setting) and the balls' radius. */
  private layOut(ctx: ModeContext) {
    const v = this.view;
    ellipseFrame(ctx.config.width, ctx.config.height, this.settings.sizePct, this.settings.orientation, v.frame);
    v.ballRadius = Math.max(0.5, (ctx.config.ballRadius || 8) * EF_BALL_SCALE);
  }

  private worldDx(du: number, dw: number) {
    return this.view.frame.vertical ? dw : du;
  }
  private worldDy(du: number, dw: number) {
    return this.view.frame.vertical ? du : dw;
  }

  /** The index of the ball with `id`, or −1 for a ball that is not one of the volley's. */
  private indexOf(id: number): number {
    const i = id - this.firstId;
    return i >= 0 && i < this.view.count ? i : -1;
  }

  /** Ball `i` fired at simulation time `t` from the focus `focusU` at its launch angle (from the direction of the other focus). */
  private launch(i: number, t: number, focusU: number) {
    const v = this.view;
    const toward = focusU > 0 ? -1 : 1;
    const theta = v.angles[i];
    this.kBall[i] = Math.round(t / this.transitSec);
    this.fu[i] = focusU;
    this.du[i] = toward * Math.cos(theta);
    this.dw[i] = Math.sin(theta);
    this.solve(i);
    v.vtLen[i] = 0;
    this.pushVertex(i, t, focusU, 0);
  }

  /** Ball `i`'s wall hit and the direction off the wall for the transit its state is in. */
  private solve(i: number) {
    focalPass(this.view.b, this.fu[i], this.du[i], this.dw[i], PASS);
    this.dist[i] = PASS.dist;
    this.qu[i] = PASS.qu;
    this.qw[i] = PASS.qw;
    this.ru[i] = PASS.du;
    this.rw[i] = PASS.dw;
    this.hitDone[i] = 0;
  }

  private pushVertex(i: number, t: number, u: number, w: number) {
    const v = this.view;
    const cap = v.vertexCap;
    const head = v.vtLen[i] === 0 ? 0 : (v.vtHead[i] + 1) % cap;
    const at = i * cap + head;
    v.vtT[at] = t;
    v.vtU[at] = u;
    v.vtW[at] = w;
    v.vtHead[i] = head;
    if (v.vtLen[i] < cap) v.vtLen[i]++;
  }

  /** The transit the clock is in at `t` (s): a convergence at exactly k · T opens transit k. */
  private transitAt(t: number): number {
    return Math.floor((t + EF_TIME_EPS) / this.transitSec);
  }

  /**
   * Brings ball `i`'s state up to simulation time `t`: its wall hit when it comes (reported to the step), the end of every
   * transit on the way – the next one starts exactly at the other focus, or a fresh volley at a refire.
   */
  private advance(i: number, t: number) {
    const s = this.settings;
    const T = this.transitSec;
    const target = this.transitAt(t);
    for (;;) {
      const k = this.kBall[i];
      if (!this.hitDone[i]) {
        const tHit = k * T + this.dist[i] / this.speed;
        if (tHit <= t + EF_TIME_EPS || k < target) this.reportHit(i, tHit, k);
      }
      if (k >= target) return;
      // the end of transit k: where the reflection lands (the other focus, to rounding) and the next transit's start
      const rest = 2 - this.dist[i];
      const arrivalU = this.qu[i] + this.ru[i] * rest;
      const arrivalW = this.qw[i] + this.rw[i] * rest;
      const err = Math.hypot(arrivalU + this.fu[i], arrivalW);
      const slot = k & 3;
      if (err > this.errAcc[slot]) this.errAcc[slot] = err;
      const next = k + 1;
      if (isRefire(s.reset, s.passes, next)) {
        // a fresh volley: from the start focus (refire), or from the focus the swarm converged on (every pass)
        this.launch(i, next * T, s.reset === "every" ? -this.fu[i] : this.view.focusU);
      } else {
        this.kBall[i] = next;
        this.fu[i] = -this.fu[i];
        this.du[i] = this.ru[i];
        this.dw[i] = this.rw[i];
        this.solve(i);
      }
    }
  }

  private reportHit(i: number, tHit: number, k: number) {
    this.hitDone[i] = 1;
    this.pushVertex(i, tHit, this.qu[i], this.qw[i]);
    const lat = Math.abs(this.qw[i]);
    const slot = k & 3;
    if (lat > this.spreadAcc[slot]) this.spreadAcc[slot] = lat;
    const n = this.stepHits;
    if (n < this.hitBall.length) {
      this.hitBall[n] = i;
      this.hitDist[n] = this.dist[i];
      this.hitTime[n] = tHit;
      this.stepHits = n + 1;
    }
    this.hitStep[i] = this.steps;
  }

  /** Ball `i` where its state puts it at simulation time `t` (its transit's time), into the view's arrays. */
  private place(i: number, t: number) {
    const v = this.view;
    const tau = t - this.kBall[i] * this.transitSec;
    const s = this.speed * (tau < 0 ? 0 : tau);
    let u: number;
    let w: number;
    if (s <= this.dist[i]) {
      u = this.fu[i] + this.du[i] * s;
      w = this.dw[i] * s;
    } else {
      const over = s - this.dist[i];
      u = this.qu[i] + this.ru[i] * over;
      w = this.qw[i] + this.rw[i] * over;
    }
    toWorld(v.frame, u, w, POINT);
    v.x[i] = POINT.x;
    v.y[i] = POINT.y;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.stepStart = (ctx.getElapsedMs() - dtMs) / 1000;
    this.sub = 0;
    this.stepHits = 0;
    // a live change of the Ball Size (the canvas draws the balls at their size)
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.lastBallRadius) {
      this.lastBallRadius = radius;
      this.layOut(ctx);
    }
  }

  /** The engine moved the ball by its velocity; put it where the clock says it is at this sub-step's time. */
  onBallStep(_ctx: ModeContext, ball: Ball, dtSec: number) {
    const i = this.indexOf(ball.id);
    if (i < 0) return;
    const t = this.stepStart + (this.sub + 1) * dtSec;
    this.advance(i, t);
    this.place(i, t);
    const v = this.view;
    ball.x = v.x[i];
    ball.y = v.y[i];
    const beyond = this.speed * (t - this.kBall[i] * this.transitSec) > this.dist[i];
    const du = beyond ? this.ru[i] : this.du[i];
    const dw = beyond ? this.rw[i] : this.dw[i];
    const speed = this.speed * v.frame.scale;
    ball.vx = this.worldDx(du, dw) * speed;
    ball.vy = this.worldDy(du, dw) * speed;
    ball.radius = v.ballRadius;
  }

  onPostSubStep() {
    this.sub++;
  }

  /**
   * The step's global events, in time order: the start (the first volley), every convergence it crossed – the impact, the
   * seam's chord, the bed's next chord – and the bed's kicks; then the step's wall hits as notes and bounce triggers.
   */
  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const s = this.settings;
    const t1 = ctx.getElapsedMs() / 1000;
    const t0 = this.stepStart;
    const T = this.transitSec;
    // every ball up to the end of the step (a ball the engine did not step this time catches up here)
    let nonFinite = 0;
    for (let i = 0; i < v.count; i++) {
      this.advance(i, t1);
      this.place(i, t1);
      if (!Number.isFinite(v.x[i]) || !Number.isFinite(v.y[i])) nonFinite++;
    }
    v.nonFinite = nonFinite;
    v.timeSec = t1;
    v.transit = this.transitAt(t1);
    const start = this.steps === 0;
    if (start) this.startVolley(ctx, s.bed);
    // the bed switched on or off mid-run, or the page resumed a paused run
    if (!start && s.bed && (!this.bedPlaying || this.bedDirty)) this.sendBed(ctx, this.chordOf(this.transitAt(t1)));
    if (!s.bed && this.bedPlaying) {
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "bedStop", melody: false });
      this.bedPlaying = false;
    }
    this.bedDirty = false;
    v.bedOn = this.bedPlaying;
    this.queueHits(ctx);
    const k0 = this.transitAt(t0);
    const k1 = this.transitAt(t1);
    const first = start ? 1 : k0 + 1;
    for (let k = first; k <= k1; k++) this.convergence(ctx, k);
    // the bed's kicks on the beats between (the convergence's own beat is the impact's kick)
    if (s.bed && this.bedPlaying) {
      const beat = T / EF_BEATS_PER_TRANSIT;
      const b0 = start ? 0 : Math.floor((t0 + EF_TIME_EPS) / beat);
      const b1 = Math.floor((t1 + EF_TIME_EPS) / beat);
      for (let j = b0 + 1; j <= b1; j++) {
        if (j % EF_BEATS_PER_TRANSIT === 0) continue;
        if (!bedKicks(s.reset, s.passes, Math.floor(j / EF_BEATS_PER_TRANSIT))) continue;
        this.emit(ctx, { type: "hit", wallIndex: 0, loop: "kick", level: EF_KICK_LEVEL, melody: false });
      }
    }
    // the sound events up to the end of this step, for every convergence it held (the fast export's parity check)
    for (let k = first; k <= k1; k++) if (v.convSounds.length < EF_LOG_CAP) v.convSounds.push(v.sounds);
    this.steps++;
  }

  /** The run's first step: the volley fired from the start focus – the impact, the seam's chord and the bed's first chord. */
  private startVolley(ctx: ModeContext, bed: boolean) {
    this.emit(ctx, { type: "hit", wallIndex: 0, loop: "impact", frequency: EF_IMPACT_HZ, level: EF_IMPACT_LEVEL, melody: false });
    this.emit(ctx, { type: "hit", wallIndex: 0, loop: "chord", frequency: EF_CHORD_HZ, level: EF_SEAM_CHORD_LEVEL, melody: false });
    if (bed) this.sendBed(ctx, this.chordOf(0));
  }

  /** Convergence `k` (k transits in): the arrival checked and counted, the volley refired at a refire, the sounds queued. */
  private convergence(ctx: ModeContext, k: number) {
    const v = this.view;
    const s = this.settings;
    const slot = (k - 1) & 3;
    const err = this.errAcc[slot];
    const spread = this.spreadAcc[slot] * v.frame.scale;
    this.errAcc[slot] = 0;
    this.spreadAcc[slot] = 0;
    v.convError = err;
    if (err > v.maxConvError) v.maxConvError = err;
    v.lastSpread = spread;
    if (v.spreads.length < EF_LOG_CAP) v.spreads.push(spread);
    // the arrival focus: the other one than the transit started from (the volley started at lastVolleyU)
    const sinceVolley = k - this.lastVolleyTransit(k);
    const arrivalU = sinceVolley % 2 === 1 ? -v.lastVolleyU : v.lastVolleyU;
    if (err <= EF_CONVERGE_EPS) {
      v.convergences++;
      v.lastConvergenceSec = k * this.transitSec;
      v.lastConvergenceU = arrivalU;
    }
    if (isRefire(s.reset, s.passes, k)) {
      v.volleys++;
      v.lastVolleyU = s.reset === "every" ? arrivalU : v.focusU;
    }
    const seam = isSeam(s.reset, s.passes, k);
    if (seam && s.reset !== "collapse") v.seams++;
    this.emit(ctx, { type: "hit", wallIndex: 0, loop: "impact", frequency: EF_IMPACT_HZ, level: EF_IMPACT_LEVEL, melody: false });
    if (seam) this.emit(ctx, { type: "hit", wallIndex: 0, loop: "chord", frequency: EF_CHORD_HZ, level: EF_SEAM_CHORD_LEVEL, melody: false });
    if (s.bed && this.bedPlaying) this.sendBed(ctx, this.chordOf(k));
  }

  /** The transit the volley under way at transit `k` was fired at. */
  private lastVolleyTransit(k: number): number {
    const s = this.settings;
    if (s.reset === "collapse") return 0;
    if (s.reset === "every") return k - 1;
    const p = Math.max(1, Math.round(s.passes));
    return Math.floor((k - 1) / p) * p;
  }

  private chordOf(k: number): number {
    return bedChordIndex(this.settings.reset, this.settings.passes, k);
  }

  private sendBed(ctx: ModeContext, chord: number) {
    const c = this.progression[chord] ?? { root: EF_KEY_ROOT_MIDI, minor: false };
    this.view.chord = chord;
    this.emit(ctx, { type: "hit", wallIndex: 0, loop: "bed", frequency: midiToFrequency(c.root), loopMinor: c.minor, melody: false });
    this.bedPlaying = true;
    this.view.bedOn = true;
  }

  /**
   * The step's wall hits: bounce math's triggers (a ball at a time), then the notes – the hits on each ladder degree are one
   * pluck at √(their share of the step's hits) of the level (n hits at 1/√n each), thinned in the pre-drop, the largest
   * groups first and at most EF_NOTES_PER_STEP of them.
   */
  private queueHits(ctx: ModeContext) {
    const n = this.stepHits;
    if (n === 0) return;
    const v = this.view;
    v.hits += n;
    if (ctx.noteBounce) {
      let reported = 0;
      for (const ball of ctx.getBalls()) {
        if (reported >= EF_BOUNCE_TRIGGERS_PER_STEP) break;
        const i = this.indexOf(ball.id);
        if (i < 0 || this.hitStep[i] !== this.steps) continue;
        ctx.noteBounce(ball);
        reported++;
      }
    }
    const counts = this.degreeHits;
    const levels = this.degreeLevel;
    counts.fill(0);
    levels.fill(0);
    const T = this.transitSec;
    const thin = thinningSeconds(T);
    for (let h = 0; h < n; h++) {
      const d = hitDegree(this.hitDist[h], v.e);
      const t = this.hitTime[h];
      const nextConvergence = (Math.floor((t + EF_TIME_EPS) / T) + 1) * T;
      const factor = nextConvergence - t < thin ? EF_THINNED : 1;
      counts[d] += 1;
      if (factor > levels[d]) levels[d] = factor;
    }
    // the largest groups first (a step rarely has more than a few degrees)
    for (let played = 0; played < EF_NOTES_PER_STEP; played++) {
      let best = -1;
      for (let d = 0; d < counts.length; d++) if (counts[d] > 0 && (best < 0 || counts[d] > counts[best])) best = d;
      if (best < 0) break;
      const level = EF_PLUCK_LEVEL * Math.sqrt(counts[best] / n) * levels[best];
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "pluck", frequency: ladderHz(best), level, loopBright: true, melody: false });
      counts[best] = 0;
    }
    this.stepHits = 0;
  }

  private emit(ctx: ModeContext, event: SoundEvent) {
    ctx.addPendingSoundEvent(event);
    this.view.sounds++;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize lays the ellipse out again and puts every ball back where the clock says (the run itself is unit-sized). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.layOut(ctx);
      const t = ctx.getElapsedMs() / 1000;
      for (const ball of ctx.getBalls()) {
        const i = this.indexOf(ball.id);
        if (i < 0) continue;
        this.place(i, t);
        ball.x = this.view.x[i];
        ball.y = this.view.y[i];
        ball.radius = this.view.ballRadius;
      }
    }
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  /** The loop goes on forever (the recording's length, in whole loops, ends a clip). */
  isFinished() {
    return false;
  }
  // --- the loop contract (lib/loop/loopContract.ts): refire every `passes` transits, every pass two volleys, collapse none
  cycleSeconds(): number | null {
    return this.view.loopSec;
  }
  loopSeams(ctx: ModeContext): LoopSeams | null {
    const period = this.view.loopSec;
    if (period === null) return null;
    const t = ctx.getElapsedMs() / 1000;
    const count = Math.floor((t + EF_TIME_EPS) / period);
    return { count, lastMs: count > 0 ? 1000 * count * period : -1, nextMs: 1000 * (count + 1) * period };
  }
  getState() {
    const v = this.view;
    return { timeSec: v.timeSec, transit: v.transit, convergences: v.convergences, volleys: v.volleys, hits: v.hits, sounds: v.sounds, lastSpread: v.lastSpread };
  }
}
