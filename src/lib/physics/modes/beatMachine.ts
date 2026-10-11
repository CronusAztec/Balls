import type { Ball, GameMode, LoopSeams, ModeContext, SoundEvent } from "../types";
import { BOARD_BALL_CEILING } from "@/lib/uncap";
import { resolveBeatMachineSettings, type BeatMachineSettings } from "../beatMachine";
import {
  BM_EVENT_KINDS,
  BM_TIME_EPS,
  buildPhrase,
  marblePosition,
  marbleState,
  marblesInFlight,
  planBeatMachine,
  stairsPosition,
  type BeatMachinePlan,
  type BmEvent,
  type BmSource,
} from "@/lib/simulation/beatMachinePlan";

/*
 * --- beat-machine --- Beat Machines (rhythm family; lib/simulation/beatMachinePlan.ts plans them, lib/physics/beatMachine.ts
 * holds the settings): the marble xylophone – marbles dropped from their tubes so each strikes its tuned bar exactly on the beat,
 * then back by the floor, the ladder lift and the top rail – and the musical staircase – one ball hopping a step a beat, then
 * round the return track to the top.
 *
 * Like Beat Drop and Focus Shot, the mode owns its playfield (the "none" ring layout) and pins ordinary engine balls (no
 * gravity, `ballsMayRest`, `ballsPassThrough`) to where the plan puts them at every sub-step's time; nothing is integrated,
 * so a seed replays bit for bit at any frame rate, in the fast export, the batch render and the finder. The run loops for
 * ever (the loop contract: `cycleSeconds()` is the plan's loop, every seam a whole number of beats).
 *
 * The seeded choices (`ctx.random()`), in this order: the original phrase's draws (`originalMarblePhrase()` /
 * `originalStairsDegrees()`; none for the other sources – a loaded melody or a typed list that is empty falls back to the
 * original phrase and draws then).
 *
 * Sound (lib/audio/loopTones.ts through `ToneGenerator.playLoop()`, `SoundEvent.loop`), scheduled from the plan in the step
 * that holds its time – the live page and the fast export's offline twin play the same events: the marbles' strikes are tuned
 * bars ("bar") with the phrase bass every two bars ("bass"); the staircase's landings are pentatonic plucks ("pluck") and its
 * return trip a reset glide ("glide") that ends at the loop point. Every note is also bounce math's "bounce" trigger.
 */

/** A note's level (the bar strike and the pluck), the bass's and the glide's. */
export const BM_NOTE_LEVEL = 0.9;
export const BM_BASS_LEVEL = 0.8;
export const BM_GLIDE_LEVEL = 1;
/** Notes a step emits at most (the voice budget merges and drops past 6 a tick anyway). */
export const BM_NOTES_PER_STEP = 6;
/** Seams the view keeps the note count of (the smoke test's notes × loops), and checks against t = 0 (`seamError`). */
export const BM_LOG_CAP = 64;
/**
 * A loop far shorter than a step (a tempo far past its slider): a step plays at most this many loops' events, and crosses at
 * most this many seams one by one – the loops and seams before them are counted, not played or checked. Other sound events
 * (the glide, the bass) a step emits at most BM_EXTRA_SOUNDS_PER_STEP of.
 */
export const BM_LOOPS_PER_STEP = 4;
export const BM_EXTRA_SOUNDS_PER_STEP = 4;
/**
 * Marbles past this many: no marble-by-marble scan each step – the marbles in flight count the trips under way, and the seams
 * are not checked against t = 0.
 */
export const BM_SCAN_MAX = 4096;
/** The share of the page's shorter side the machine's box fills. */
export const BM_FIT = 0.88;

/** Where the plan's units lie in the world: world = (cx + (u − ux) · scale, cy + (w − uy) · scale). */
export interface BeatMachineFrame {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  scale: number;
}

/** What the canvas, the HUD, the smoke test and the tests read of a run (the same object every call). */
export interface BeatMachineView {
  /** Bumped by every init (the canvas starts its trail over). */
  generation: number;
  settings: BeatMachineSettings;
  plan: BeatMachinePlan;
  /** The source the phrase really came from (an empty melody or list plays the original phrase). */
  source: BmSource;
  frame: BeatMachineFrame;
  /** Simulation time (s) of the last step, the loop it is in (0 = the first) and the seams crossed. */
  timeSec: number;
  loop: number;
  seams: number;
  /** Notes played (strikes or landings), sound events of any kind, releases, rung pick-ups, glides, basses. */
  notes: number;
  sounds: number;
  releases: number;
  lifts: number;
  glides: number;
  basses: number;
  /** Notes played in the current loop (the HUD's counter). */
  loopNotes: number;
  /** The notes played up to each seam (the first BM_LOG_CAP), and their sound events. */
  seamNotes: number[];
  seamSounds: number[];
  /** The simulation time of the last note on each bar / step (−1: none yet), and the last note's slot. */
  lastNoteSec: Float64Array;
  lastSlot: number;
  /** Marbles out of their tubes now (the stairs: 1). */
  inFlight: number;
  /** The worst distance (world px) between the machine's state at a seam and at t = 0 (each tube's marbles as a set). */
  seamError: number;
  /** Engine balls whose position was not finite at the last step (always 0). */
  nonFinite: number;
  /** Engine balls placed (the stairs' ball, or the marbles up to the board's ceiling). */
  balls: number;
}

const POINT = { x: 0, y: 0 };
const MARBLE = marbleState();

/** A zero count for every event kind. */
function emptyCounts(): Record<BmEvent["kind"], number> {
  return Object.fromEntries(BM_EVENT_KINDS.map((kind) => [kind, 0])) as Record<BmEvent["kind"], number>;
}

export class BeatMachineMode implements GameMode {
  readonly name = "beatMachine";
  /** The balls are placed from the plan: no slow-ball boost and no pair collisions may touch them. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: BeatMachineSettings = resolveBeatMachineSettings(null);
  private readonly view: BeatMachineView;
  /** Per engine ball: its tube (−1: the stairs' ball) and its marble in the tube. */
  private ballTube = new Int32Array(0);
  private ballK = new Int32Array(0);
  /** The first engine ball of each tube (marbles beyond the board's ceiling get none). */
  private tubeFirst = new Int32Array(0);
  /** Each note's place in its tube's journeys (the marble that plays it). */
  private notePlace = new Int32Array(0);
  /** The id of ball 0 (the balls' ids run on from it, in index order). */
  private firstId = 0;
  private stepStart = 0;
  private sub = 0;
  private steps = 0;
  /** Events are emitted over (lastEmit, now]: contiguous whatever the steps' rounding. */
  private lastEmit = -1;
  private nextSeam = 0;
  private lastBallRadius = 0;
  private prevX = new Float64Array(0);
  private prevY = new Float64Array(0);
  /** Each tube's marbles at t = 0, sorted (the seam check). */
  private startState: number[][] = [];
  /** The events of each kind in one loop (the loops a step counts without playing them). */
  private perLoop: Record<BmEvent["kind"], number> = emptyCounts();

  constructor() {
    const plan = planBeatMachine({ variant: "stairs", bpm: 80, steps: 1, stepDxPct: 7.5, stepDyPct: 7.9, bars: 2, dropPct: 28, rebound: 0.3, perTube: 0, returnBeats: 0, loopBeats: 1, bass: false, phrase: { notes: [{ beat: 0, slot: 0, frequency: 262 }], source: "scale", slotHz: [262] } });
    this.view = {
      generation: 0,
      settings: resolveBeatMachineSettings(null),
      plan,
      source: "original",
      frame: { cx: 400, cy: 225, ux: 0, uy: 0, scale: 400 },
      timeSec: 0,
      loop: 0,
      seams: 0,
      notes: 0,
      sounds: 0,
      releases: 0,
      lifts: 0,
      glides: 0,
      basses: 0,
      loopNotes: 0,
      seamNotes: [],
      seamSounds: [],
      lastNoteSec: new Float64Array(1).fill(-1),
      lastSlot: -1,
      inFlight: 0,
      seamError: 0,
      nonFinite: 0,
      balls: 0,
    };
  }

  getSettings(): BeatMachineSettings {
    return this.settings;
  }
  /** The plan's settings apply on the next init; the counter follows at once. */
  setSettings(patch: Partial<BeatMachineSettings>) {
    this.settings = resolveBeatMachineSettings({ ...this.settings, ...patch });
    this.view.settings.counter = this.settings.counter;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): BeatMachineView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { notes: v.notes, sounds: v.sounds, seams: v.seams, loop: v.loop, inFlight: v.inFlight, spares: v.plan.spares, conflicts: v.plan.conflicts };
  }
  /** The loop HUD's counter: the notes of the current loop out of the loop's (null with the counter off). */
  hudCount(): { count: number; total: number } | null {
    const v = this.view;
    return v.settings.counter ? { count: v.loopNotes, total: v.plan.notes.length } : null;
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    // the seeded choices, in their documented order: the original phrase's draws
    const phrase = buildPhrase({ variant: s.variant, source: s.source, slots: s.variant === "stairs" ? s.steps : s.bars, loopBeats: s.loopBeats, melody: s.melody, custom: s.notes, scale: s.scale, root: s.root }, () => ctx.random());
    const plan = planBeatMachine({ variant: s.variant, bpm: s.bpm, steps: s.steps, stepDxPct: s.stepDx, stepDyPct: s.stepDy, bars: s.bars, dropPct: s.dropPct, rebound: s.rebound, perTube: s.perTube, returnBeats: s.returnBeats, loopBeats: s.loopBeats, bass: s.bass, phrase });
    v.generation++;
    v.settings = { ...s };
    v.plan = plan;
    v.source = phrase.source;
    v.timeSec = 0;
    v.loop = 0;
    v.seams = 0;
    v.notes = 0;
    v.sounds = 0;
    v.releases = 0;
    v.lifts = 0;
    v.glides = 0;
    v.basses = 0;
    v.loopNotes = 0;
    v.seamNotes.length = 0;
    v.seamSounds.length = 0;
    const slots = plan.variant === "stairs" ? plan.stairs!.steps.length : plan.marbles!.tubes.length;
    v.lastNoteSec = new Float64Array(slots).fill(-1);
    v.lastSlot = -1;
    v.inFlight = 0;
    v.seamError = 0;
    v.nonFinite = 0;
    this.stepStart = 0;
    this.sub = 0;
    this.steps = 0;
    this.lastEmit = -1;
    this.nextSeam = plan.loopSec;
    this.perLoop = emptyCounts();
    for (const e of plan.events) this.perLoop[e.kind]++;
    this.lastBallRadius = ctx.config.ballRadius || 8;
    this.layOut(ctx);
    // the engine balls: the stairs' ball, or every marble (tube by tube) up to the board's ceiling
    const count = Math.min(plan.ballCount, BOARD_BALL_CEILING);
    this.ballTube = new Int32Array(count);
    this.ballK = new Int32Array(count);
    this.prevX = new Float64Array(count);
    this.prevY = new Float64Array(count);
    if (plan.marbles) {
      const tubes = plan.marbles.tubes;
      this.tubeFirst = new Int32Array(tubes.length).fill(-1);
      let i = 0;
      for (let b = 0; b < tubes.length && i < count; b++) {
        this.tubeFirst[b] = i;
        for (let k = 0; k < tubes[b].count && i < count; k++, i++) {
          this.ballTube[i] = b;
          this.ballK[i] = k;
        }
      }
      this.notePlace = new Int32Array(plan.marbles.journeys.length);
      for (const tube of tubes) tube.journeys.forEach((j, place) => (this.notePlace[j] = place));
    } else {
      this.ballTube.fill(-1);
      this.tubeFirst = new Int32Array(0);
      this.notePlace = new Int32Array(0);
    }
    v.balls = count;
    this.firstId = ctx.getNextId();
    const radius = this.worldRadius();
    for (let i = 0; i < count; i++) {
      this.unitAt(i, 0);
      const x = this.wx(POINT.x);
      const y = this.wy(POINT.y);
      this.prevX[i] = x;
      this.prevY[i] = y;
      const color = plan.marbles ? plan.marbles.bars[this.ballTube[i]].color : "#ffe7a8";
      ctx.addBall({ x, y, vx: 0, vy: 0, radius, color, gravityScale: 0 });
    }
    this.startState = plan.ballCount <= BM_SCAN_MAX ? this.stateAt(0) : [];
    v.inFlight = this.inFlightAt(0);
  }

  /** Marbles out of their tubes at `t` (the stairs: 1); past BM_SCAN_MAX marbles, the trips under way at `t`. */
  private inFlightAt(t: number): number {
    const plan = this.view.plan;
    if (!plan.marbles) return 1;
    if (plan.ballCount <= BM_SCAN_MAX) return marblesInFlight(plan, t, MARBLE);
    const P = plan.loopSec;
    let n = 0;
    for (const jr of plan.marbles.journeys) {
      const k = Math.floor((t - jr.release) / P) - Math.floor((t - jr.back) / P);
      if (k > 0) n += k;
    }
    return Math.min(plan.ballCount, n);
  }

  /** The world frame: the plan's box (the stairs' panel and dots included) fitted into the page's centred square. */
  private layOut(ctx: ModeContext) {
    const v = this.view;
    const b = v.plan.bbox;
    const stairs = v.plan.variant === "stairs";
    const pad = stairs ? 0.05 : 0.02;
    const below = stairs ? 0.09 : 0; // the progress dots under the stairs' panel
    const w = b.x1 - b.x0 + 2 * pad;
    const h = b.y1 - b.y0 + 2 * pad + below;
    const side = Math.min(ctx.config.width || 800, ctx.config.height || 450);
    const scale = (BM_FIT * side) / Math.max(1e-6, w, h);
    v.frame.cx = (ctx.config.width || 800) / 2;
    v.frame.cy = (ctx.config.height || 450) / 2;
    v.frame.ux = (b.x0 + b.x1) / 2;
    v.frame.uy = (b.y0 + b.y1) / 2 + below / 2;
    v.frame.scale = scale;
  }

  private wx(u: number) {
    const f = this.view.frame;
    return f.cx + (u - f.ux) * f.scale;
  }
  private wy(w: number) {
    const f = this.view.frame;
    return f.cy + (w - f.uy) * f.scale;
  }
  private worldRadius() {
    const p = this.view.plan;
    const r = p.stairs ? p.stairs.radius : p.marbles ? p.marbles.radius : 0.01;
    return Math.max(0.5, r * this.view.frame.scale);
  }

  /** Ball `i`'s place in plan units at simulation time `t`, into POINT. */
  private unitAt(i: number, t: number) {
    const plan = this.view.plan;
    if (plan.marbles) {
      marblePosition(plan, this.ballTube[i], this.ballK[i], t, MARBLE);
      POINT.x = MARBLE.x;
      POINT.y = MARBLE.y;
    } else stairsPosition(plan, t, POINT);
  }

  /** Every tube's marbles (or the stairs' ball) at `t`, in world px, each tube's sorted – a state to compare across seams. */
  private stateAt(t: number): number[][] {
    const plan = this.view.plan;
    const out: number[][] = [];
    if (plan.marbles) {
      for (let b = 0; b < plan.marbles.tubes.length; b++) {
        const pts: number[] = [];
        for (let k = 0; k < plan.marbles.tubes[b].count; k++) {
          marblePosition(plan, b, k, t, MARBLE);
          pts.push(this.wx(MARBLE.x), this.wy(MARBLE.y));
        }
        const pairs: [number, number][] = [];
        for (let k = 0; k < pts.length; k += 2) pairs.push([pts[k], pts[k + 1]]);
        pairs.sort((a, c) => a[1] - c[1] || a[0] - c[0]);
        out.push(pairs.flat());
      }
    } else {
      stairsPosition(plan, t, POINT);
      out.push([this.wx(POINT.x), this.wy(POINT.y)]);
    }
    return out;
  }

  /** The index of the ball with `id`, or −1 for a ball that is not one of the machine's. */
  private indexOf(id: number): number {
    const i = id - this.firstId;
    return i >= 0 && i < this.ballTube.length ? i : -1;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.stepStart = (ctx.getElapsedMs() - dtMs) / 1000;
    this.sub = 0;
    // a live change of the Ball Size or of the page's size is laid out by onConfigChange(); the radius follows the frame
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.lastBallRadius) this.lastBallRadius = radius;
  }

  /** The engine moved the ball by its velocity; put it where the plan says it is at this sub-step's time. */
  onBallStep(_ctx: ModeContext, ball: Ball, dtSec: number) {
    const i = this.indexOf(ball.id);
    if (i < 0) return;
    const t = this.stepStart + (this.sub + 1) * dtSec;
    this.unitAt(i, t);
    ball.x = this.wx(POINT.x);
    ball.y = this.wy(POINT.y);
  }

  onPostSubStep() {
    this.sub++;
  }

  /** Every ball at the step's end (with its velocity over the step), then the plan's events of (last step, now] in time order. */
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const plan = v.plan;
    const t1 = ctx.getElapsedMs() / 1000;
    const dt = Math.max(1e-6, dtMs / 1000);
    const radius = this.worldRadius();
    let nonFinite = 0;
    for (const ball of ctx.getBalls()) {
      const i = this.indexOf(ball.id);
      if (i < 0) continue;
      this.unitAt(i, t1);
      const x = this.wx(POINT.x);
      const y = this.wy(POINT.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) nonFinite++;
      ball.vx = (x - this.prevX[i]) / dt;
      ball.vy = (y - this.prevY[i]) / dt;
      ball.x = x;
      ball.y = y;
      ball.radius = radius;
      this.prevX[i] = x;
      this.prevY[i] = y;
    }
    v.nonFinite = nonFinite;
    v.timeSec = t1;
    const P = plan.loopSec;
    v.loop = Math.floor((t1 + BM_TIME_EPS) / P);
    this.emitEvents(ctx, this.lastEmit, t1);
    this.lastEmit = t1;
    v.inFlight = this.inFlightAt(t1);
    this.steps++;
  }

  /** The events of (t0, t1], in time order, with the seams between them. */
  private emitEvents(ctx: ModeContext, t0: number, t1: number) {
    const plan = this.view.plan;
    const events = plan.events;
    const P = plan.loopSec;
    if (!(P > 0)) return;
    let notesThisStep = 0;
    let extrasThisStep = 0;
    const L0 = Math.floor(Math.max(0, t0) / P);
    const L1 = Math.floor((t1 + BM_TIME_EPS) / P);
    let first = L0;
    let loops = L1 - L0 + 1;
    if (!(loops <= BM_LOOPS_PER_STEP)) {
      // a loop far shorter than the step: the loops but the last few are counted (their seams too), not played
      first = L1 - (BM_LOOPS_PER_STEP - 1);
      this.skipLoops(first - L0, first * P - P / 2);
      loops = BM_LOOPS_PER_STEP;
    }
    for (let i = 0; i < loops; i++) {
      const L = first + i;
      const base = L * P;
      // the first event after t0 in this loop
      let lo = 0;
      let hi = events.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].t + base <= t0 + BM_TIME_EPS) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < events.length; k++) {
        const at = events[k].t + base;
        if (at > t1 + BM_TIME_EPS) break;
        this.seamsUpTo(at);
        const kind = events[k].kind;
        if (kind === "note") {
          if (notesThisStep >= BM_NOTES_PER_STEP) {
            this.countNote(events[k], at, L, ctx, false);
            continue;
          }
          notesThisStep++;
        } else if (kind === "glide" || kind === "bass") {
          if (extrasThisStep >= BM_EXTRA_SOUNDS_PER_STEP) {
            if (kind === "glide") this.view.glides++;
            else this.view.basses++;
            continue;
          }
          extrasThisStep++;
        }
        this.fire(ctx, events[k], at, L);
      }
    }
    this.seamsUpTo(t1);
  }

  /** `count` whole loops counted as played (their notes and their other events, none of them sounding), then the seams up to `t`. */
  private skipLoops(count: number, t: number) {
    if (!(count > 0)) return;
    this.seamsUpTo(t);
    const v = this.view;
    const per = this.perLoop;
    v.notes += count * per.note;
    v.releases += count * per.release;
    v.lifts += count * per.lift;
    v.glides += count * per.glide;
    v.basses += count * per.bass;
    v.loopNotes = per.note;
  }

  /**
   * Crosses every seam at or before `t` (a seam at exactly an event's time is crossed before the event): the first BM_LOG_CAP
   * are logged and checked against t = 0; past BM_LOOPS_PER_STEP in one call, the rest are counted at once.
   */
  private seamsUpTo(t: number) {
    const v = this.view;
    const P = v.plan.loopSec;
    if (!(P > 0)) return;
    let crossed = 0;
    while (this.nextSeam <= t + BM_TIME_EPS) {
      if (crossed++ >= BM_LOOPS_PER_STEP) {
        this.countSeams(t);
        return;
      }
      const seamT = this.nextSeam;
      if (v.seamNotes.length < BM_LOG_CAP) {
        v.seamNotes.push(v.notes);
        v.seamSounds.push(v.sounds);
      }
      if (v.seams < BM_LOG_CAP && v.plan.ballCount <= BM_SCAN_MAX) {
        const state = this.stateAt(seamT);
        let err = 0;
        for (let b = 0; b < state.length; b++) {
          const a = state[b];
          const c = this.startState[b] ?? [];
          for (let k = 0; k < Math.min(a.length, c.length); k++) err = Math.max(err, Math.abs(a[k] - c[k]));
        }
        if (err > v.seamError) v.seamError = err;
      }
      v.seams++;
      v.loopNotes = 0;
      this.nextSeam += P;
    }
  }

  /** The seams left at or before `t`, counted at once (logged while the log has room, not checked). */
  private countSeams(t: number) {
    const v = this.view;
    const P = v.plan.loopSec;
    const due = Math.max(1, Math.floor((t + BM_TIME_EPS - this.nextSeam) / P) + 1);
    for (let i = 0; i < due && v.seamNotes.length < BM_LOG_CAP; i++) {
      v.seamNotes.push(v.notes);
      v.seamSounds.push(v.sounds);
    }
    v.seams += due;
    v.loopNotes = 0;
    // the next seam after t (past t even where the loop is below the clock's resolution)
    this.nextSeam = Math.max(this.nextSeam + P, (Math.floor((t + BM_TIME_EPS) / P) + 1) * P, t + 2 * BM_TIME_EPS);
  }

  private countNote(e: BmEvent, at: number, L: number, ctx: ModeContext, report: boolean) {
    const v = this.view;
    v.notes++;
    v.loopNotes++;
    if (e.slot >= 0 && e.slot < v.lastNoteSec.length) v.lastNoteSec[e.slot] = at;
    v.lastSlot = e.slot;
    if (report && ctx.noteBounce) {
      const ball = this.ballOfNote(ctx, e, L);
      if (ball) ctx.noteBounce(ball);
    }
  }

  /** The engine ball that plays note event `e` of loop `L`: the stairs' ball, or the marble of its tube that took that note. */
  private ballOfNote(ctx: ModeContext, e: BmEvent, L: number): Ball | null {
    const plan = this.view.plan;
    let index = 0;
    if (plan.marbles) {
      const tube = plan.marbles.tubes[e.slot];
      const first = this.tubeFirst[e.slot];
      if (!tube || first < 0 || e.note < 0) return null;
      const m = tube.journeys.length;
      const K = Math.max(1, tube.count);
      // the journey's loop: a strike in loop L may belong to a release in the loop before (the event times are mod the loop)
      const jr = plan.marbles.journeys[e.note];
      const shift = Math.round((e.t - jr.strike) / plan.loopSec);
      const g = (L + shift) * m + this.notePlace[e.note];
      index = first + (((g % K) + K) % K);
      if (index >= this.ballTube.length) return null;
    }
    const id = this.firstId + index;
    for (const ball of ctx.getBalls()) if (ball.id === id) return ball;
    return null;
  }

  private fire(ctx: ModeContext, e: BmEvent, at: number, L: number) {
    const v = this.view;
    const plan = v.plan;
    switch (e.kind) {
      case "note":
        this.countNote(e, at, L, ctx, true);
        if (plan.variant === "stairs") this.emit(ctx, { type: "hit", wallIndex: 0, loop: "pluck", frequency: e.frequency, level: BM_NOTE_LEVEL, loopBright: true, melody: false });
        else this.emit(ctx, { type: "hit", wallIndex: 0, loop: "bar", frequency: e.frequency, level: BM_NOTE_LEVEL, melody: false });
        return;
      case "glide":
        v.glides++;
        this.emit(ctx, { type: "hit", wallIndex: 0, loop: "glide", frequency: e.frequency, loopTo: e.toFrequency, loopSec: e.seconds, level: BM_GLIDE_LEVEL, melody: false });
        return;
      case "bass":
        v.basses++;
        this.emit(ctx, { type: "hit", wallIndex: 0, loop: "bass", frequency: e.frequency, level: BM_BASS_LEVEL, melody: false });
        return;
      case "release":
        v.releases++;
        return;
      case "lift":
        v.lifts++;
        return;
      default:
        return;
    }
  }

  private emit(ctx: ModeContext, event: SoundEvent) {
    ctx.addPendingSoundEvent(event);
    this.view.sounds++;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize fits the machine again and puts every ball back where the plan says (the plan itself is in its own units). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.layOut(ctx);
      const t = ctx.getElapsedMs() / 1000;
      const radius = this.worldRadius();
      for (const ball of ctx.getBalls()) {
        const i = this.indexOf(ball.id);
        if (i < 0) continue;
        this.unitAt(i, t);
        ball.x = this.wx(POINT.x);
        ball.y = this.wy(POINT.y);
        ball.radius = radius;
        this.prevX[i] = ball.x;
        this.prevY[i] = ball.y;
      }
      this.startState = this.view.plan.ballCount <= BM_SCAN_MAX ? this.stateAt(0) : [];
    }
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  /** The machine loops forever (the recording's length, in whole loops, ends a clip). */
  isFinished() {
    return false;
  }
  // --- the loop contract (lib/loop/loopContract.ts): every loop is a whole number of beats, its state the run's start
  cycleSeconds(): number | null {
    return this.view.plan.loopSec;
  }
  loopSeams(ctx: ModeContext): LoopSeams | null {
    const period = this.view.plan.loopSec;
    if (!(period > 0)) return null;
    const t = ctx.getElapsedMs() / 1000;
    const count = Math.floor((t + BM_TIME_EPS) / period);
    return { count, lastMs: count > 0 ? 1000 * count * period : -1, nextMs: 1000 * (count + 1) * period };
  }
  getState() {
    const v = this.view;
    return { timeSec: v.timeSec, loop: v.loop, notes: v.notes, sounds: v.sounds, seams: v.seams, inFlight: v.inFlight };
  }
}
