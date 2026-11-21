import { midiToFrequency } from "@/lib/audio/scales";
import type { Ball, GameMode, ModeContext, Point, WallHitResult } from "../types";
import { arenaRadius } from "../types";
import { atLeastMin } from "@/lib/uncap"; // --- string-art ---

/**
 * Bounce points the Lines mode keeps (the newest; render-only, like Grow's lines). The canvas strokes a string from every
 * point to the ball each frame, and an endless run with many fast balls gathers thousands (8,000–17,000 in ten minutes),
 * so the oldest strings fade out of the picture past this many instead of slowing every frame down.
 */
export const LINES_MAX_BOUNCE_POINTS = 1000;

// --- string-art ---
/**
 * The ring as a circular keyboard: KEYS sectors from the top, clockwise, each a degree of C major pentatonic from C4 (C4 D4 E4 G4
 * A4, C5 …, up to D6), so a bounce plays the note of where it lands and the melody follows the figure the strings draw.
 */
export const LINES_KEYS = 12;
export const LINES_KEY_BASE_MIDI = 60;
const PENTATONIC = [0, 2, 4, 7, 9];
/**
 * A bounce's note: the loop family's pentatonic pluck at this level, bright (a short plain hit was a blip at a third of the
 * clip's loudness, and the end's chord set the export's peak over it).
 */
export const LINES_PLUCK_LEVEL = 0.85;
/** The finished string art's chord: the completion chord on C3, and its level. */
export const LINES_CHORD_HZ = 130.81;
export const LINES_CHORD_LEVEL = 0.8;
/** The Strings to Finish slider (URL `lns`): 0 = endless (the link base); any whole number typed. */
export const LINES_STRINGS_RANGE = { min: 0, max: 200, step: 5 } as const;

/** The key (0 … LINES_KEYS − 1) of a bounce at `angle` (radians, canvas angles: 0 to the right, clockwise): from the top, clockwise. */
export function linesKey(angle: number): number {
  const TWO_PI = 2 * Math.PI;
  const a = (((angle + Math.PI / 2) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.min(LINES_KEYS - 1, Math.floor((a / TWO_PI) * LINES_KEYS));
}

/** The pitch (Hz) of key `k` on the pentatonic ladder. */
export function linesKeyFrequency(k: number): number {
  const key = Math.max(0, Math.min(LINES_KEYS - 1, Math.floor(k)));
  return midiToFrequency(LINES_KEY_BASE_MIDI + 12 * Math.floor(key / PENTATONIC.length) + PENTATONIC[key % PENTATONIC.length]);
}

/** A Strings to Finish value as the mode uses it: a whole number from 0 (0 = endless; no ceiling – uncapped), a bad one 0. */
export function resolveLinesStrings(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(atLeastMin(n, LINES_STRINGS_RANGE)) : 0;
}

/** What the canvas draws the string art from; the same object every call. */
export interface LinesView {
  /** The bounce points kept (the newest LINES_MAX_BOUNCE_POINTS) and the simulation ms each was struck at (same order). */
  points: Point[];
  times: number[];
  /** Strings struck so far in the run (the oldest points past the cap are gone, their count stays), and the run's goal (0: endless). */
  strings: number;
  target: number;
  /** The run reached its goal (at `finishMs`): the art is finished. */
  finished: boolean;
  finishMs: number;
  /** The key of the last bounce and when it was struck (−1 / −Infinity before the first). */
  lastKey: number;
  lastKeyMs: number;
}
// --- end string-art ---

/** Lines: every bounce point is connected to the ball, drawing string art. */
export class LinesMode implements GameMode {
  readonly name = "lines";
  private bouncePoints: Point[] = [];
  private centerDotEnabled = false;
  private centerDotRadius = 12;
  // --- string-art ---
  private bounceTimes: number[] = [];
  private target = 0;
  private readonly view: LinesView = { points: [], times: [], strings: 0, target: 0, finished: false, finishMs: -Infinity, lastKey: -1, lastKeyMs: -Infinity };

  /** Strings to Finish: the run ends after this many strings (0 = endless); applied on the next init. */
  setStrings(n: number) {
    this.target = resolveLinesStrings(n);
  }
  getStrings() {
    return this.target;
  }
  /** Live state for the canvas; the same object every call. */
  getView(): LinesView {
    return this.view;
  }
  // --- end string-art ---

  setCenterDotEnabled(enabled: boolean) {
    this.centerDotEnabled = enabled;
  }
  isCenterDotEnabled() {
    return this.centerDotEnabled;
  }

  init(ctx: ModeContext) {
    this.bouncePoints = [];
    // --- string-art ---
    this.bounceTimes = [];
    const v = this.view;
    v.points = this.bouncePoints;
    v.times = this.bounceTimes;
    v.strings = 0;
    v.target = this.target;
    v.finished = false;
    v.finishMs = -Infinity;
    v.lastKey = -1;
    v.lastKeyMs = -Infinity;
    // --- end string-art ---
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const walls = ctx.getCircularWalls();
    if (walls.length > 0) this.centerDotRadius = Math.max(5, 0.02 * walls[0].radius);
  }
  onPreUpdate() {}
  onBallStep(ctx: ModeContext, ball: Ball) {
    if (!this.centerDotEnabled || this.view.finished) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    const minDist = ball.radius + this.centerDotRadius;
    if (dist < minDist && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      ball.x = cx + nx * (minDist + 1);
      ball.y = cy + ny * (minDist + 1);
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) {
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;
      }
      this.pushBouncePoint(cx, cy, ctx.getElapsedMs());
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0 });
      this.countString(ctx); // --- string-art ---
    }
  }
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number): WallHitResult | void {
    if (this.view.finished) return; // --- string-art --- (the art is finished: the engine stops after this step)
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    const wall = ctx.getCircularWalls()[wallIndex];
    if (wall && dist > 0) {
      const now = ctx.getElapsedMs();
      this.pushBouncePoint(cx + (dx / dist) * wall.radius, cy + (dy / dist) * wall.radius, now);
      // --- string-art --- the key under the bounce plays its note (the engine's plain hit is left out; a visitor's own sound
      // plays that plain hit instead: ringVoice "contact")
      const key = linesKey(Math.atan2(dy, dx));
      this.view.lastKey = key;
      this.view.lastKeyMs = now;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex, loop: "pluck", frequency: linesKeyFrequency(key), level: LINES_PLUCK_LEVEL, loopBright: true, melody: false, ringVoice: "contact" });
      this.countString(ctx);
      return { suppressSound: true };
    }
  }

  // --- string-art ---
  /** One more string: the run's goal reached, the art is finished – its chord and confetti (the engine stops after this step). */
  private countString(ctx: ModeContext) {
    const v = this.view;
    v.strings++;
    if (v.target > 0 && !v.finished && v.strings >= v.target) {
      v.finished = true;
      v.finishMs = ctx.getElapsedMs();
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: LINES_CHORD_HZ, loopExact: true, level: LINES_CHORD_LEVEL, melody: false, ringVoice: "extra" });
      ctx.spawnConfetti(ctx.config.width / 2, ctx.config.height / 2);
    }
  }
  // --- end string-art ---

  onGapPass() {
    return false;
  }
  onPostUpdate() {}
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      const r = arenaRadius(ctx.config);
      ctx.setCircularWalls([{ radius: r, gaps: [] }]);
      ctx.setWallRotations([0]);
      this.centerDotRadius = Math.max(5, 0.02 * r);
    }
    return true;
  }
  shouldSkipWallCollision() {
    return false;
  }
  /** Endless – --- string-art --- unless Strings to Finish is set: the run ends with its last string. */
  isFinished() {
    return this.view.finished;
  }
  getState() {
    return {
      bouncePoints: this.bouncePoints,
      centerDotEnabled: this.centerDotEnabled,
      centerDotRadius: this.centerDotRadius,
    };
  }
  getBouncePoints() {
    return this.bouncePoints;
  }
  /** Keeps the newest `LINES_MAX_BOUNCE_POINTS` (the oldest point is recycled for the new one: no allocation at the cap). */
  private pushBouncePoint(x: number, y: number, ms: number) {
    if (this.bouncePoints.length >= LINES_MAX_BOUNCE_POINTS) {
      const recycled = this.bouncePoints.shift()!;
      recycled.x = x;
      recycled.y = y;
      this.bouncePoints.push(recycled);
      this.bounceTimes.shift();
    } else this.bouncePoints.push({ x, y });
    this.bounceTimes.push(ms); // --- string-art ---
  }
  repositionPoints(sx: number, sy: number, oldCx: number, oldCy: number, newCx: number, newCy: number) {
    for (const p of this.bouncePoints) {
      p.x = newCx + (p.x - oldCx) * sx;
      p.y = newCy + (p.y - oldCy) * sy;
    }
  }
}
