/**
 * Shared types for the physics engine and its game modes.
 *
 * The engine (engine.ts) owns balls, walls, particles and the RNG. Each game mode is a
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
}

export type NewBall = Omit<Ball, "id" | "trail" | "trailIndex">;

export interface Gap {
  startAngle: number;
  endAngle: number;
}

export interface CircularWall {
  radius: number;
  gaps: Gap[];
}

export interface PhysicsConfig {
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
  type: "hit" | "gap";
  wallIndex: number;
}

export type ParticleType = "confetti" | "shard" | "spark";

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
  isBouncierEnabled(): boolean;
  getBounceSpeedMultiplier(): number;
  setBounceSpeedMultiplier(value: number): void;
  setDestructionMode(enabled: boolean): void;
  setInfiniteMode(enabled: boolean): void;
  /** Deterministic random in [0, 1). Always use this instead of Math.random in modes. */
  random(): number;
  getElapsedMs(): number;
}

export interface GameMode {
  readonly name: ModeId;
  init(ctx: ModeContext): void;
  onPreUpdate(ctx: ModeContext, dtMs: number): void;
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number): void;
  onPostSubStep(ctx: ModeContext): void;
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number, angle: number): WallHitResult | void;
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
