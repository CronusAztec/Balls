import type { Obstacle } from "./obstacles";

/**
 * Shared types for the physics engine and its game modes.
 *
 * The engine (engine.ts) owns balls, walls, obstacles, particles and the RNG. Each game mode is a
 * small plugin that implements the GameMode interface and mutates the simulation through
 * the ModeContext it receives. To add a new mode, create a class in ./modes, register it in
 * ./modes/index.ts and add its id to MODE_IDS below.
 */

export const MODE_IDS = [
  "classic",
  "accumulation",
  "multiply",
  "lines",
  "paint",
  "target",
  "portal",
  "shatter",
  "colorMatch",
  "grow",
  "drop",
  "box",
] as const;

export type ModeId = (typeof MODE_IDS)[number];

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && (MODE_IDS as readonly string[]).includes(value);
}

export interface Point {
  x: number;
  y: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  trail: Point[];
  trailIndex: number;
  /** Remaining life in ms for temporary balls (e.g. escaped balls in Multiply mode). */
  lifetime?: number;
  frozen?: boolean;
  /** Angular velocity in rad/s (only non-zero with the "spin" physics extra; see extras.ts). */
  spin: number;
  /** Rotation of the ball's sprite in radians, integrated from `spin`; the canvas rotates images / emoji by it. */
  angle: number;
  /** Per-ball gravity multiplier (Ball Drop gives every ball its own weight); 1 when absent. */
  gravityScale?: number;
  /** Size of the ball relative to the configured ball radius (Ball Drop's size spread), so a live change of the ball size keeps the spread; 1 when absent. */
  radiusScale?: number;
}

export type NewBall = Omit<Ball, "id" | "trail" | "trailIndex" | "spin" | "angle">;

export interface Gap {
  startAngle: number;
  endAngle: number;
}

export interface CircularWall {
  radius: number;
  gaps: Gap[];
}

/**
 * Optional physics extras (all off by default, so a seed behaves identically without them).
 * Resolved with defaults by `resolvePhysicsExtras()` in extras.ts, which also documents the units.
 */
export interface PhysicsExtras {
  /** Fraction of the velocity lost per 60 Hz step (0–0.05). */
  airDrag: number;
  /** Constant sideways / vertical acceleration as a fraction of the ball speed per second (−0.5…0.5). */
  windX: number;
  windY: number;
  /** 0–1: how much wall contact spins the ball and how strongly the spin curves its flight (Magnus effect). */
  spinStrength: number;
  /** Restitution applied to the rebound speed at every wall hit (0.5–1.2; 1 = unchanged). */
  wallBounciness: number;
  /** Wall radii pulse sinusoidally by ±this fraction of their base radius (0–0.3); gaps follow. */
  breathingAmplitude: number;
  /** Breathing pulses per second (0.1–3). */
  breathingSpeed: number;
  /** Degrees per second the gravity vector rotates (0–180; 0 = gravity stays downward). */
  rotatingGravity: number;
}

/**
 * What balls do to each other (see interactions.ts): "bounce" is the classic elastic rebound, "merge"
 * fuses two touching balls into one, "split" halves a ball every time it breaks through a wall and
 * "pass" lets balls fly through each other.
 */
export const BALL_INTERACTIONS = ["bounce", "merge", "split", "pass"] as const;
export type BallInteraction = (typeof BALL_INTERACTIONS)[number];

export function isBallInteraction(value: unknown): value is BallInteraction {
  return typeof value === "string" && (BALL_INTERACTIONS as readonly string[]).includes(value);
}

/**
 * Ball interaction settings (bounce by default, so a seed behaves identically without them).
 * Resolved with defaults by `resolveBallInteraction()` in interactions.ts.
 */
export interface BallInteractionConfig {
  ballInteraction: BallInteraction;
  /** Smallest ball (radius in px) a split may produce; a ball whose halves would be smaller stays whole (4–20). */
  splitMinRadius: number;
  /** Splitting stops once this many balls are in play (2–64). */
  maxBalls: number;
}

export interface PhysicsConfig extends Partial<PhysicsExtras>, Partial<BallInteractionConfig> {
  width: number;
  height: number;
  gravity: number;
  bounce: number;
  damping: number;
  ballSpeed: number;
  rotationSpeed: number;
  wallCount: number;
  gapSize: number;
  ballColor: string;
  ballRadius: number;
  audioIntensity: number;
  twoBalls?: boolean;
  ballColor2?: string;
}

export interface SoundEvent {
  /** A wall bounce, a wall break / gap pass, two balls fusing ("merge" interaction) or a ball splitting in two ("split"). */
  type: "hit" | "gap" | "merge" | "split";
  wallIndex: number;
  /** Pitch of a "hit" in Hz chosen by the mode (Ball Drop maps it from the ball's size); without it the wall index picks the pitch. */
  frequency?: number;
  /** An accented "hit" (a DVD logo hitting a corner in Bouncing Shapes): the tone generator plays it louder and longer. */
  accent?: boolean;
}

/** Recent obstacle contact for the canvas glow (visual only, wall-clock timestamps like `WallHit`). */
export interface ObstacleHit {
  index: number;
  x: number;
  y: number;
  timestamp: number;
}

export type ParticleType = "confetti" | "shard" | "spark" | "burst";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  rotation: number;
  rotationSpeed: number;
  type?: ParticleType;
}

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface WallBreakFlash {
  wallRadius: number;
  life: number;
  maxLife: number;
}

export interface WallHit {
  wallIndex: number;
  angle: number;
  radius: number;
  timestamp: number;
}

export const WALL_BREAK_STYLES = ["confetti", "shatter", "shockwave", "all", "none"] as const;
export type WallBreakStyle = (typeof WALL_BREAK_STYLES)[number];

export interface WallHitResult {
  /** Do not register a wall-glow flash for this hit. */
  suppressGlow?: boolean;
  /** The mode handled the velocity itself; skip the default rebound. */
  suppressBounce?: boolean;
  /** Reset the "bouncier" speed multiplier instead of increasing it. */
  resetBouncier?: boolean;
}

/** What a mode wants done about a ball hitting an obstacle (see obstacles.ts); the rebound itself is always applied. */
export interface ObstacleHitResult {
  /** Do not queue the "hit" sound event for this contact. */
  suppressSound?: boolean;
  /** Do not register the obstacle glow for this contact. */
  suppressGlow?: boolean;
  /** Pitch of the hit sound in Hz (Ball Drop maps it from the ball's size); without it the sound is the innermost-wall tone. */
  frequency?: number;
}

/** The API a game mode uses to talk to the engine. */
export interface ModeContext {
  readonly config: PhysicsConfig;
  getBalls(): Ball[];
  setBalls(balls: Ball[]): void;
  addBall(ball: NewBall): void;
  getNextId(): number;
  getCircularWalls(): CircularWall[];
  setCircularWalls(walls: CircularWall[]): void;
  getWallRotations(): number[];
  setWallRotations(rotations: number[]): void;
  getBrokenWalls(): Set<number>;
  getLastWallLayer(): Map<number, number>;
  addWallHit(wallIndex: number, angle: number, radius: number): void;
  addPendingSoundEvent(event: SoundEvent): void;
  spawnWallBreakByStyle(wallIndex: number, x: number, y: number): void;
  spawnConfetti(x: number, y: number): void;
  /**
   * Tells the engine that `ball` just broke through (or escaped) wall `wallIndex`. Modes that break walls
   * themselves call this next to their "gap" sound event; with the "split" interaction the ball then splits
   * in two at the end of the step (see interactions.ts).
   */
  reportWallBreak(ball: Ball, wallIndex: number): void;
  isBouncierEnabled(): boolean;
  getBounceSpeedMultiplier(): number;
  setBounceSpeedMultiplier(value: number): void;
  setDestructionMode(enabled: boolean): void;
  setInfiniteMode(enabled: boolean): void;
  /** Deterministic random in [0, 1). Always use this instead of Math.random in modes. */
  random(): number;
  getElapsedMs(): number;
  /** Wall radii without the breathing pulse (equal to the live `radius` while breathing is off). */
  getWallBaseRadii(): number[];
  /** The physics extras in effect (defaults filled in, clamped to their ranges). */
  getPhysicsExtras(): PhysicsExtras;
  /** Pegs, bars and straight walls the balls bounce off (obstacles.ts); empty in the ring modes. */
  getObstacles(): Obstacle[];
  /** Replaces the obstacle list (the engine resolves every ball against it from the next sub-step on). */
  setObstacles(obstacles: Obstacle[]): void;
}

export interface GameMode {
  readonly name: ModeId;
  /**
   * True when balls may come to rest (Ball Drop): the engine then skips the slow-ball boost that keeps
   * a ball moving in the ring modes, so a ball can actually settle on a floor.
   */
  readonly ballsMayRest?: boolean;
  /**
   * True when balls fly through each other whatever the ball interaction says (Bouncing Shapes): the engine
   * then skips the pair loop, so a collision can never disturb the shapes' rhythms.
   */
  readonly ballsPassThrough?: boolean;
  init(ctx: ModeContext): void;
  onPreUpdate(ctx: ModeContext, dtMs: number): void;
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number): void;
  onPostSubStep(ctx: ModeContext): void;
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number, angle: number): WallHitResult | void;
  /**
   * Last word on a default rebound: called with the outgoing angle (radians) after the engine's scatter
   * and the cinematic director's nudge, right before the velocity is set. Return the angle to use (Paint
   * steers it toward the least-revealed part of a picture). Not called when `onWallHit` suppressed the bounce.
   */
  adjustRebound?(ctx: ModeContext, ball: Ball, wallIndex: number, outAngle: number): number;
  /** Return true when the mode fully handles the gap pass (no default wall break). */
  onGapPass(ctx: ModeContext, ball: Ball, wallIndex: number): boolean;
  onPostUpdate(ctx: ModeContext, dtMs: number): void;
  /** Return true when the mode rebuilt its own walls; false lets the engine rebuild classic walls. */
  onConfigChange(
    ctx: ModeContext,
    sizeChanged: boolean,
    wallCountChanged: boolean,
    gapChanged: boolean,
  ): boolean;
  shouldSkipWallCollision(ball: Ball): boolean;
  isFinished(ctx: ModeContext): boolean;
  getState(): Record<string, unknown>;
  onBallCollision?(ctx: ModeContext, a: Ball, b: Ball): void;
  /** A ball split in two (the "split" interaction): `parent` kept its id, `half` is the new ball. Copy per-ball state here. */
  onBallSplit?(ctx: ModeContext, parent: Ball, half: Ball): void;
  /**
   * `ball` hit obstacle `index` at `impactSpeed` px/s along the contact normal, hard enough to count as a hit
   * (soft resting contacts are not reported). The rebound has already been applied; return a pitch for the
   * sound or suppress the sound / glow.
   */
  onObstacleHit?(ctx: ModeContext, ball: Ball, obstacle: Obstacle, index: number, impactSpeed: number): ObstacleHitResult | void;
}

export interface PersonalityVisuals {
  state: PersonalityState;
  speedMultiplier: number;
  trailIntensity: number;
  glowPulseRate: number;
  colorShiftDeg: number;
  glowScale: number;
  tension: number;
}

export type PersonalityState = "calm" | "aggressive" | "chaotic" | "unstable" | "overcharged";

export function arenaRadius(config: PhysicsConfig, factor = 0.75): number {
  return (Math.min(config.width, config.height) / 2) * factor;
}

export const TWO_PI = Math.PI * 2;

export function normalizeAngle(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}
