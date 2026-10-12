import type { Ball, GameMode, LoopSeams, ModeContext, SoundEvent } from "../types";
import { perfectFitBeatSec, resolvePerfectFitSettings, type PerfectFitSettings } from "../perfectFit";
import { degreeToMidi } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";
import { linesClearedAt, occupiedCells, planPerfectFit, puzzleAt, rectsDoneAt, type PerfectFitPlan, type PfEvent } from "@/lib/simulation/polyominoPlan";

/*
 * --- perfect-fit --- Perfect Fit (rhythm family; lib/simulation/polyominoPlan.ts plans it, lib/physics/perfectFit.ts holds the
 * settings): pieces dropped straight down into a container that a solver guarantees ends exactly full, with an audible progress
 * ladder – the 12 pentominoes into three rectangles (10 × 6, 12 × 5, 15 × 4), or Tetris perfect clears in a 10 × 16 well (four
 * four-line clears, then a held twelve-line finale: 70 pieces, 28 lines).
 *
 * The mode owns its playfield (the "none" ring layout) and its pieces – they are not engine balls: the plan is a pure function of
 * the simulation clock, so the canvas draws every piece at the frame's own time and a seed replays bit for bit at any frame rate,
 * in the fast export, the batch render and the finder. One engine ball stays pinned to the middle of the box (no gravity,
 * `ballsMayRest`, `ballsPassThrough`; the canvas draws the pieces instead of it): it is what bounce math's "bounce" trigger, the
 * camera and the ball tools hold on to. The run loops for ever (the loop contract: `cycleSeconds()` is the plan's loop, every
 * seam an empty box).
 *
 * The seeded choices (`ctx.random()`), in this order: one draw, the solution seed when Solution seed is 0 (auto) – drawn every
 * init, used or not; the plan's own choices (the tilings' search order, the scatter, the Tetris chunks and their mirroring) all
 * come from the solution seed.
 *
 * Sound (lib/audio/loopTones.ts through `ToneGenerator.playLoop()`, `SoundEvent.loop`), scheduled from the plan in the step that
 * holds its time: the rectangles' pieces play the progress ladder ("step", a pentatonic degree higher per piece from C5,
 * wrapping after 13, the last one +3 dB) as they leave the tray and a soft "land" thump as they land; a completed rectangle plays
 * the completion chord ("chord") with a noise crack ("impact"). Tetris pieces play the ladder on the chip voice as they land
 * (`loopChip`) over the thump; a clear plays the chord under its banner and a hard cut ("cut") silences every loop voice for the
 * 0.3 s before the next section; the finale plays the chord and the crack. Every landing is also bounce math's "bounce" trigger.
 */

/** The ladder's root (C5) and the levels of a step, a thump, a clear's chord, the completion chord and its crack. */
export const PF_LADDER_ROOT_MIDI = 72;
export const PF_STEP_LEVEL = 0.7;
export const PF_LAND_LEVEL = 0.5;
export const PF_CLEAR_LEVEL = 0.7;
export const PF_CHORD_LEVEL = 1;
export const PF_CRACK_LEVEL = 0.7;
/** The completion chord's root (G2, the key's dominant – the recipe's 98–110 Hz). */
export const PF_CHORD_HZ = 98;
/** Notes a step emits at most, other sounds at most, and loops a step plays at most (a loop far shorter than a step is counted). */
export const PF_NOTES_PER_STEP = 6;
export const PF_EXTRA_SOUNDS_PER_STEP = 4;
export const PF_LOOPS_PER_STEP = 4;
/** Seams the view logs the box's emptiness of (the smoke test's check). */
export const PF_LOG_CAP = 64;
const EPS = 1e-9;

/** The ladder's pitch of a degree (Hz): the major pentatonic up from C5. */
export function pfLadderHz(degree: number): number {
  return midiToFrequency(degreeToMidi(degree, PF_LADDER_ROOT_MIDI, "majorPentatonic"));
}

/** Where the playfield lies in the world: the page's centred square (side `side` px around `cx`, `cy`). */
export interface PerfectFitFrame {
  cx: number;
  cy: number;
  side: number;
}

/** What the canvas, the HUD, the smoke test and the tests read of a run (the same object every call). */
export interface PerfectFitView {
  /** Bumped by every init. */
  generation: number;
  settings: PerfectFitSettings;
  plan: PerfectFitPlan;
  frame: PerfectFitFrame;
  /** Fall feel (the renderer's curve). */
  fall: number;
  /** Simulation time (s) of the last step, the loop it is in (0 = the first) and the seams crossed. */
  timeSec: number;
  loop: number;
  seams: number;
  /** Seams at which the box was empty just before and at the seam, and the occupied cells logged at each (the first PF_LOG_CAP). */
  seamsEmpty: number;
  seamCells: number[];
  /** The puzzle on show, the pieces landed in it, and in all. */
  puzzle: number;
  placed: number;
  landed: number;
  lifts: number;
  /** Rectangles completed in all and in this loop (pentominoes); lines cleared in this loop, the most in a loop, in all; clears. */
  rects: number;
  rectsLoop: number;
  rectsMax: number;
  lines: number;
  linesMax: number;
  linesTotal: number;
  clears: number;
  /** Sound events emitted. */
  sounds: number;
  /** Cells resting in the box now. */
  occupied: number;
  /** With the beat on: the furthest a landing fell from the beat grid (ms; 0 without the beat). */
  beatErrorMs: number;
  /** Engine balls placed (always 1: the anchor). */
  balls: number;
}

export class PerfectFitMode implements GameMode {
  readonly name = "perfectFit";
  /** The anchor ball is pinned: no slow-ball boost and no pair collisions may touch it. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: PerfectFitSettings = resolvePerfectFitSettings(null);
  private readonly view: PerfectFitView;
  private anchorId = -1;
  /** Events are emitted over (lastEmit, now]: contiguous whatever the steps' rounding. */
  private lastEmit = -1;
  private nextSeam = 0;

  constructor() {
    this.view = {
      generation: 0,
      settings: resolvePerfectFitSettings(null),
      plan: planPerfectFit({ variant: "pento", boxes: [], pieceSec: 0.55, sections: [], wellW: 10, wellH: 16, hold: true, beatSec: 0, seed: 1 }),
      frame: { cx: 400, cy: 225, side: 450 },
      fall: 1,
      timeSec: 0,
      loop: 0,
      seams: 0,
      seamsEmpty: 0,
      seamCells: [],
      puzzle: 0,
      placed: 0,
      landed: 0,
      lifts: 0,
      rects: 0,
      rectsLoop: 0,
      rectsMax: 0,
      lines: 0,
      linesMax: 0,
      linesTotal: 0,
      clears: 0,
      sounds: 0,
      occupied: 0,
      beatErrorMs: 0,
      balls: 0,
    };
  }

  getSettings(): PerfectFitSettings {
    return this.settings;
  }
  /** The plan's settings apply on the next init. */
  setSettings(patch: Partial<PerfectFitSettings>) {
    this.settings = resolvePerfectFitSettings({ ...this.settings, ...patch });
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): PerfectFitView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { rects: v.rects, lines: v.lines, linesMax: v.linesMax, landed: v.landed, seams: v.seams, seamsEmpty: v.seamsEmpty, loop: v.loop };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    // the seeded choices, in their documented order: one draw, the solution seed when it is auto
    const draw = Math.floor(ctx.random() * 0x7fffffff) + 1;
    const seed = s.seed > 0 ? s.seed : draw;
    const plan = planPerfectFit({ variant: s.variant, boxes: s.boxes, pieceSec: s.pieceSec, sections: s.sections, wellW: s.wellW, wellH: s.wellH, hold: s.hold, beatSec: perfectFitBeatSec(s), seed });
    v.generation++;
    v.settings = { ...s, boxes: s.boxes.map((b) => ({ ...b })), sections: [...s.sections] };
    v.plan = plan;
    v.fall = s.fall;
    v.timeSec = 0;
    v.loop = 0;
    v.seams = 0;
    v.seamsEmpty = 0;
    v.seamCells.length = 0;
    v.puzzle = 0;
    v.placed = 0;
    v.landed = 0;
    v.lifts = 0;
    v.rects = 0;
    v.rectsLoop = 0;
    v.rectsMax = 0;
    v.lines = 0;
    v.linesMax = 0;
    v.linesTotal = 0;
    v.clears = 0;
    v.sounds = 0;
    v.occupied = 0;
    v.beatErrorMs = 0;
    this.lastEmit = -1;
    this.nextSeam = plan.loopSec;
    this.layOut(ctx);
    // the anchor: one engine ball pinned to the middle of the box (the canvas draws the pieces instead)
    this.anchorId = ctx.getNextId();
    ctx.addBall({ x: v.frame.cx, y: v.frame.cy, vx: 0, vy: 0, radius: ctx.config.ballRadius || 8, color: ctx.config.ballColor || "#ffffff", gravityScale: 0 });
    v.balls = 1;
  }

  /** The playfield: the page's centred square. */
  private layOut(ctx: ModeContext) {
    const f = this.view.frame;
    const w = ctx.config.width || 800;
    const h = ctx.config.height || 450;
    f.cx = w / 2;
    f.cy = h / 2;
    f.side = Math.min(w, h);
  }

  onPreUpdate() {}

  /** The anchor stays where it is pinned. */
  onBallStep(_ctx: ModeContext, ball: Ball) {
    if (ball.id !== this.anchorId) return;
    ball.x = this.view.frame.cx;
    ball.y = this.view.frame.cy;
    ball.vx = 0;
    ball.vy = 0;
  }

  onPostSubStep() {}

  /** The plan's events of (last step, now] in time order, then the counters of the frame. */
  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const plan = v.plan;
    const t1 = ctx.getElapsedMs() / 1000;
    for (const ball of ctx.getBalls()) {
      if (ball.id !== this.anchorId) continue;
      ball.x = v.frame.cx;
      ball.y = v.frame.cy;
      ball.vx = 0;
      ball.vy = 0;
    }
    v.timeSec = t1;
    const P = plan.loopSec;
    v.loop = P > 0 ? Math.floor((t1 + EPS) / P) : 0;
    this.emitEvents(ctx, this.lastEmit, t1);
    this.lastEmit = t1;
    const at = puzzleAt(plan, t1);
    v.puzzle = Math.max(0, at.index);
    const p = at.index >= 0 ? plan.puzzles[at.index] : null;
    let placed = 0;
    if (p) for (const piece of p.pieces) if (piece.tLand <= at.local + EPS) placed++;
    v.placed = placed;
    v.occupied = occupiedCells(plan, t1);
    v.lines = linesClearedAt(plan, t1);
    if (v.lines > v.linesMax) v.linesMax = v.lines;
    v.rectsLoop = rectsDoneAt(plan, t1);
    if (v.rectsLoop > v.rectsMax) v.rectsMax = v.rectsLoop;
  }

  /** The events of (t0, t1], in time order, with the seams between them. */
  private emitEvents(ctx: ModeContext, t0: number, t1: number) {
    const plan = this.view.plan;
    const events = plan.events;
    const P = plan.loopSec;
    if (!(P > 0) || events.length === 0) {
      this.seamsUpTo(t1);
      return;
    }
    let notes = 0;
    let extras = 0;
    const L0 = Math.floor(Math.max(0, t0) / P);
    const L1 = Math.floor((t1 + EPS) / P);
    let first = L0;
    let loops = L1 - L0 + 1;
    if (!(loops <= PF_LOOPS_PER_STEP)) {
      // a loop far shorter than the step: the loops but the last few are counted (their seams too), not played
      first = L1 - (PF_LOOPS_PER_STEP - 1);
      this.skipLoops(first - L0, first * P - P / 2);
      loops = PF_LOOPS_PER_STEP;
    }
    for (let i = 0; i < loops; i++) {
      const base = (first + i) * P;
      // the first event after t0 in this loop
      let lo = 0;
      let hi = events.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].t + base <= t0 + EPS) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < events.length; k++) {
        const e = events[k];
        const at = e.t + base;
        if (at > t1 + EPS) break;
        this.seamsUpTo(at);
        const note = e.kind === "lift" || e.kind === "land";
        const sound = note ? notes < PF_NOTES_PER_STEP : extras < PF_EXTRA_SOUNDS_PER_STEP;
        if (note && sound) notes++;
        else if (sound) extras++;
        this.fire(ctx, e, at, sound);
      }
    }
    this.seamsUpTo(t1);
  }

  /** `count` whole loops counted as played (none of them sounding), then the seams up to `t`. */
  private skipLoops(count: number, t: number) {
    if (!(count > 0)) return;
    this.seamsUpTo(t);
    const v = this.view;
    const plan = v.plan;
    v.landed += count * plan.pieceCount;
    v.lifts += count * (plan.variant === "pento" ? plan.pieceCount : 0);
    v.rects += count * plan.rects;
    v.linesTotal += count * plan.lines;
    v.clears += count * plan.puzzles.filter((p) => p.variant === "tetris").length;
    if (plan.lines > v.linesMax) v.linesMax = plan.lines;
    if (plan.rects > v.rectsMax) v.rectsMax = plan.rects;
  }

  /** Crosses every seam at or before `t`: each logs the box's cells just before and at it (the first PF_LOG_CAP checked). */
  private seamsUpTo(t: number) {
    const v = this.view;
    const P = v.plan.loopSec;
    if (!(P > 0)) return;
    let crossed = 0;
    while (this.nextSeam <= t + EPS) {
      if (crossed++ >= PF_LOOPS_PER_STEP) {
        // the rest at once (a loop below the clock's resolution)
        const due = Math.max(1, Math.floor((t + EPS - this.nextSeam) / P) + 1);
        v.seams += due;
        this.nextSeam = Math.max(this.nextSeam + P, (Math.floor((t + EPS) / P) + 1) * P, t + 2 * EPS);
        return;
      }
      const seamT = this.nextSeam;
      if (v.seamCells.length < PF_LOG_CAP) {
        const cells = occupiedCells(v.plan, seamT - Math.min(1e-3, P / 4)) + occupiedCells(v.plan, seamT);
        v.seamCells.push(cells);
        if (cells === 0) v.seamsEmpty++;
      }
      v.seams++;
      this.nextSeam += P;
    }
  }

  private fire(ctx: ModeContext, e: PfEvent, at: number, sound: boolean) {
    const v = this.view;
    const plan = v.plan;
    const tetris = plan.variant === "tetris";
    switch (e.kind) {
      case "lift":
        v.lifts++;
        if (sound) this.emit(ctx, { type: "hit", wallIndex: 0, loop: "step", frequency: pfLadderHz(e.degree), level: PF_STEP_LEVEL, accent: e.last, melody: false });
        return;
      case "land": {
        v.landed++;
        if (plan.beatSec > 0) {
          const puzzle = plan.puzzles[e.puzzle];
          const grid = Math.min(plan.beatSec, puzzle ? puzzle.slot : plan.beatSec);
          const local = at - Math.floor((at + EPS) / plan.loopSec) * plan.loopSec;
          const off = Math.abs(local - Math.round(local / grid) * grid) * 1000;
          if (off > v.beatErrorMs) v.beatErrorMs = off;
        }
        if (sound) {
          if (tetris) this.emit(ctx, { type: "hit", wallIndex: 0, loop: "step", loopChip: true, frequency: pfLadderHz(e.degree), level: PF_STEP_LEVEL, accent: e.last, melody: false });
          this.emit(ctx, { type: "hit", wallIndex: 0, loop: "land", level: PF_LAND_LEVEL, melody: false });
        }
        const anchor = this.anchor(ctx);
        if (anchor && ctx.noteBounce) ctx.noteBounce(anchor);
        return;
      }
      case "complete":
        v.rects++;
        if (sound) {
          this.emit(ctx, { type: "hit", wallIndex: 0, loop: "chord", frequency: PF_CHORD_HZ, level: PF_CHORD_LEVEL, melody: false });
          this.emit(ctx, { type: "hit", wallIndex: 0, loop: "impact", chord: [], level: PF_CRACK_LEVEL, melody: false });
        }
        return;
      case "clear":
        v.clears++;
        v.linesTotal += e.lines;
        if (sound) this.emit(ctx, { type: "hit", wallIndex: 0, loop: "chord", frequency: PF_CHORD_HZ, level: PF_CLEAR_LEVEL, melody: false });
        return;
      case "final":
        v.clears++;
        v.linesTotal += e.lines;
        if (sound) {
          this.emit(ctx, { type: "hit", wallIndex: 0, loop: "chord", frequency: PF_CHORD_HZ, level: PF_CHORD_LEVEL, melody: false });
          this.emit(ctx, { type: "hit", wallIndex: 0, loop: "impact", chord: [], level: PF_CRACK_LEVEL, melody: false });
        }
        return;
      case "cut":
        if (sound) this.emit(ctx, { type: "hit", wallIndex: 0, loop: "cut", melody: false });
        return;
    }
  }

  private anchor(ctx: ModeContext): Ball | null {
    for (const ball of ctx.getBalls()) if (ball.id === this.anchorId) return ball;
    return null;
  }

  private emit(ctx: ModeContext, event: SoundEvent) {
    ctx.addPendingSoundEvent(event);
    this.view.sounds++;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize fits the playfield again (the plan is in box cells) and moves the anchor with it. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.layOut(ctx);
      for (const ball of ctx.getBalls()) {
        if (ball.id !== this.anchorId) continue;
        ball.x = this.view.frame.cx;
        ball.y = this.view.frame.cy;
      }
    }
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  /** The puzzles loop forever (the recording's length, in whole loops, ends a clip). */
  isFinished() {
    return false;
  }
  // --- the loop contract (lib/loop/loopContract.ts): every loop starts again with an empty box and a full tray
  cycleSeconds(): number | null {
    const P = this.view.plan.loopSec;
    return P > 0 ? P : null;
  }
  loopSeams(ctx: ModeContext): LoopSeams | null {
    const period = this.view.plan.loopSec;
    if (!(period > 0)) return null;
    const t = ctx.getElapsedMs() / 1000;
    const count = Math.floor((t + EPS) / period);
    return { count, lastMs: count > 0 ? 1000 * count * period : -1, nextMs: 1000 * (count + 1) * period };
  }
  getState() {
    const v = this.view;
    return { timeSec: v.timeSec, loop: v.loop, rects: v.rects, lines: v.lines, landed: v.landed, seams: v.seams };
  }
}
