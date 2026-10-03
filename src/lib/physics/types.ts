import type { Obstacle } from "./obstacles";
import type { BallMultipliers, MultiplierConfig, MultiplierRuntime } from "./multipliers"; // --- gerald-multipliers ---
import type { EditorObstacle } from "./obstacleEditor"; // --- obstacle-editor ---
import type { Keyframe } from "@/lib/simulation/timeline"; // --- timeline ---
import type { BeatDropPadKind } from "@/lib/simulation/beatDropPlan"; // --- beat-drop ---
import type { BounceMathConfig } from "@/lib/simulation/bounceMath"; // --- bounce-math ---
import type { UnlimitedConfig } from "./limits"; // --- unlimited ---
import type { ExitBehavior } from "./exitSplat"; // --- gerald-exit-splat ---

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
  "pendulum",
  // --- jdm-polyrhythm ---
  "polyrhythm",
  // --- jdm-collisions ---
  "collide",
  // --- gerald-glass ---
  "glass",
  // --- gerald-multipliers ---
  "multipliers",
  // --- jdm-double-pendulum ---
  "doublePendulum",
  // --- jdm-illusions ---
  "illusion",
  // --- odd-string-battle ---
  "stringBattle",
  // --- odd-power-layers ---
  "powerLayers",
  // --- jdm-race ---
  "race",
  // --- jdm-arena-games --- Bouncing Square Battle Royale and Capture the Flag
  "battle",
  "ctf",
  // --- jdm-rhythm-runner --- Beat Runner (a Geometry Dash-style runner on the beat) and Paddle Keep-Up (a moving platform)
  "runner",
  "paddle",
  // --- gerald-vortex --- Sound Vortex
  "vortex",
  // --- gerald-journey --- Journey: a multi-stage commute home
  "journey",
  // --- gerald-bullseye --- Bullseye (a scoring target at the bottom of a peg field)
  "bullseye",
  // --- beat-drop --- Beat Drop (a ball landing on obstructions that fly in on the beat)
  "beatDrop",
  // --- odd-territory --- Territory (pong-wars teams painting a tile map)
  "territory",
  // --- odd-maze --- Maze escape (oddplayground: balls race through a seeded maze, leaving a red trail)
  "maze",
  // --- gerald-conveyor --- Conveyor Belt (a belt drops a ball into the arena below every few seconds)
  "conveyor",
  // --- orb-grid --- Bouncing Orbs (thousands of varied bouncing orbs forming a 3D wave)
  "orbGrid",
  // --- fight-league --- Fight League (weapon-wielding fighter balls duel with HP, abilities and stats; the arena games' family)
  "fightLeague",
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
  // --- teams ---
  /** Start slot of the ball (0 … 5) in the multi-ball modes – its team; balls it spawns or splits into inherit it (see ballStats.ts). */
  team?: number;
  // --- gerald-multipliers ---
  /** Stacked stat multipliers – speed, size, damage, bounce, gravity (see multipliers.ts); absent = a plain ×1 ball. */
  mult?: BallMultipliers;
  // --- bounce-math --- per-ball values of the bounce-math rules (lib/physics/bounceMathRuntime.ts); absent = untouched
  /** Restitution of the ball's rebounds – bounce math's "bounciness" (a factor on the engine's ring rebounds and obstacle hits); 1 when absent. */
  restitution?: number;
  /** Degrees bounce math has turned the ball's colour ("hue"); 0 when absent. */
  hueShift?: number;
  /** Semitones bounce math adds to the ball's bounce notes ("pitch"); 0 when absent. */
  pitchShift?: number;
  // --- end bounce-math ---
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

// --- gerald-multipliers --- the stat-multiplier settings (cap, smash threshold, pickups) travel in the config too
export interface PhysicsConfig extends Partial<PhysicsExtras>, Partial<BallInteractionConfig>, Partial<MultiplierConfig>, Partial<UnlimitedConfig> /* --- unlimited --- */ {
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
  // --- teams ---
  /** Balls the multi-ball modes start with (1–6); overrides `twoBalls` when set (see ballStats.ts `startBallCount()`). */
  ballCount?: number;
  // --- obstacle-editor ---
  /** The creator's pegs, bumpers, blockers and spinners (arena-relative; obstacleEditor.ts), in play in the ring modes. */
  editorObstacles?: readonly EditorObstacle[];
  /** Speed factor a bumper gives a ball on a hard hit, 1–2. */
  bumperBoost?: number;
  // --- end obstacle-editor ---
  // --- rigged --- guaranteed outcomes (rigged.ts): the director's hard constraints, off by default
  /** No ball ever leaves the outermost intact wall (the modes that end with an escape then never finish). */
  neverEscape?: boolean;
  /** Team slot (0–5) the director makes win in the multi-ball escape modes; −1 or absent = off. */
  forcedWinner?: number;
  // --- end rigged ---
  // --- timeline ---
  /**
   * Keyframed settings (lib/simulation/timeline.ts): the engine applies them at the start of every fixed step from the
   * simulation clock, and the seed finder copies them with the rest of the config. Empty / absent = no automation.
   */
  timeline?: readonly Keyframe[];
  // --- end timeline ---
  // --- bounce-math ---
  /**
   * Bounce math (lib/simulation/bounceMath.ts): the rules, the beat grid their beat / bar triggers follow and the canvas
   * parameters' starting values. The seed finder, the arenas and the fast export copy it with the rest of the config.
   */
  bounceMath?: BounceMathConfig;
  // --- end bounce-math ---
  // --- gerald-conveyor ---
  /** Seconds between two respawns in Classic and Multiply (lib/physics/respawn.ts): a new ball drops in from the top; 0 / absent = off. */
  respawnEvery?: number;
  // --- end gerald-conveyor ---
  // --- gerald-exit-splat --- moving exits and splat barriers of the ring modes (exitSplat.ts, movingExits.ts, splats.ts); off by default
  /** How the rings' exits move: "rotate" (with their rings, as always), "jump", "flee" or "shrink" (the rings then hold still). */
  exitBehavior?: ExitBehavior;
  /** Jump: seconds between two jumps; shrink: seconds an exit takes to close. */
  exitJumpSeconds?: number;
  /** Degrees round the ring a ball may come to an exit before it jumps away or runs (0 = never). */
  exitSense?: number;
  /** Flee: the exit's top speed along its ring, degrees a second. */
  exitFleeSpeed?: number;
  /** Wall hits leave solid splats of paint (the ball builds its own barrier). */
  splatBarrier?: boolean;
  /** A splat's radius as a multiple of the ball's. */
  splatSize?: number;
  /** The most splats at once; past it the oldest fade out. */
  splatMax?: number;
  // --- end gerald-exit-splat ---
}

export interface SoundEvent {
  /**
   * A wall bounce, a wall break / gap pass, two balls fusing ("merge" interaction), a ball splitting in two ("split")
   * or a stat multiplier stacking ("multiplier": a pickup or a gate – the rising arpeggio of multipliers.ts).
   */
  type: "hit" | "gap" | "merge" | "split" | "multiplier";
  wallIndex: number;
  /** Pitch of a "hit" in Hz chosen by the mode (Ball Drop maps it from the ball's size); without it the wall index picks the pitch. */
  frequency?: number;
  /** An accented "hit" (a DVD logo hitting a corner in Bouncing Shapes, a full Pendulum Wave chord): the tone generator plays it louder and longer. */
  accent?: boolean;
  /**
   * Pitches (Hz) of a chord: several "hit"s that happen at once and are played together, as one sound in one beat-grid
   * slot with the level shared out (Pendulum Wave bobs crossing the centre together). `frequency` is its lowest note.
   */
  chord?: number[];
  // --- jdm-collisions ---
  /** Loudness of a "hit" relative to a normal one, 0–1 (Collision Playground plays soft notes scaled by the impact); 1 when absent. */
  level?: number;
  // --- gerald-multipliers ---
  /** A "multiplier" event: the stat's new total (or the ball count), which the arpeggio climbs with. */
  multiplier?: number;
  // --- obstacle-editor ---
  /** A "hit" on a bumper of the obstacle editor: the page plays the pinball ding (`ToneGenerator.playBumper()`) at `frequency`. */
  bumper?: boolean;
  // --- odd-string-battle ---
  /** A String Battle effect instead of a bounce: a thread's pluck at `frequency` or a ball's shatter (`ToneGenerator.playStringBattle()`). */
  sbSound?: "pluck" | "shatter";
  // --- jdm-race ---
  /** A "hit" that plays a tune of the race (`ToneGenerator.playRaceArpeggio()`): the rising chime of a pass, the winner's fanfare; rooted on `frequency`. */
  race?: "chime" | "fanfare";
  // --- jdm-rhythm-runner ---
  /**
   * `false`: a "hit" or "multiplier" that accompanies the tune instead of being a note of it (Paddle Keep-Up's walls, ceiling,
   * misses, game over and streak chime, the Beat Runner's crash). While a melody or the song slicer is loaded it still plays
   * its own sound – its pitch (or chord) with the bounce instrument, the arpeggio unrooted – and it never advances the melody
   * or the slicer, never waits out the melody's cooldown and never takes a beat-lock slot, so every catch / landing plays the
   * next note of the song. Absent: the hit is a note of the tune like every other.
   */
  melody?: false;
  // --- gerald-vortex ---
  /** A ball swallowed by the Sound Vortex: the page plays the "pew" (`ToneGenerator.playPew()`), a fast downward sweep from `frequency`. */
  pew?: boolean;
  // --- gerald-journey ---
  /** A Journey stage transition: the page plays the swoosh (`ToneGenerator.playSwoosh()`) – a filtered noise whoosh, not a note. */
  swoosh?: boolean;
  // --- gerald-bullseye ---
  /** A Bullseye landing: the page plays the thud (`ToneGenerator.playThud()`) at `frequency`, `level` loud. */
  thud?: boolean;
  // --- beat-drop ---
  /**
   * A Beat Drop drum hit – the kick or the snare of a landing, or an off-beat hat ("none": the pad's accent alone) – which
   * the page plays through `ToneGenerator.playBeatDrop()` instead of a bounce, with the accent of `bdPad` (the obstruction
   * the ball landed on) pitched at `frequency`. An accompaniment: it never uses up a melody note or a slicer slice.
   */
  bdDrum?: "kick" | "snare" | "hat" | "none";
  bdPad?: BeatDropPadKind;
  // --- unlimited ---
  /** A ball ate the arena (No limits): the page plays the gulp (`ToneGenerator.playArenaEaten()`) instead of a wall break. */
  ate?: boolean;
  // --- gerald-conveyor ---
  /**
   * The Conveyor Belt's machinery (`ToneGenerator.playConveyor()`, lib/audio/conveyorTones.ts) instead of a bounce: "hum" – the
   * belt's motor while it carries a ball, `cvSec` seconds long – or "click" – a ball dropping off the belt (and a respawn
   * dropping in). An accompaniment: it never uses up a melody note or a slicer slice.
   */
  conveyor?: "hum" | "click";
  cvSec?: number;
  // --- end gerald-conveyor ---
  // --- gerald-exit-splat ---
  /**
   * A splat of the splat barrier landed (splats.ts): the page plays the wet splat (`ToneGenerator.playSplat()`) at `level`
   * instead of a bounce – the hit itself sounds as its own event. Sent with `melody: false`, so a page that does not know it
   * plays an accompaniment hit, never a melody note.
   */
  splat?: boolean;
  // --- orb-grid ---
  /**
   * Bouncing Orbs' own timbres (lib/audio/orbTones.ts, `ToneGenerator.playOrb()`) instead of a bounce: "sleep" – a very soft,
   * low-passed, long note – or "metal" – a bright clink – at `frequency` (or the `chord`), `level` loud. Sent with
   * `melody: false`, so a page that does not know it plays an accompaniment hit, never a melody note. (The orbs' plain notes and
   * their composed melody are ordinary hits.)
   */
  orb?: "sleep" | "metal";
  // --- end orb-grid ---
  // --- fight-league ---
  /**
   * A Fight League sound (lib/physics/modes/fightLeague.ts) instead of a bounce: a weapon's hit by its kind – "blade" (a
   * metallic ring), "blunt" (a thud: hammers, flails, fists, tails), "arrow" (a twang), "gun" (a shot), "fire" (a whoosh),
   * "magic" (a chime) – a shield's "block", an ability's "ability" swell or a "ko" (`ToneGenerator.playFight()`, lib/audio/
   * fightTones.ts) at `frequency`, `level` loud. Sent with `melody: false`, so a page that does not know it plays an
   * accompaniment hit, never a melody note.
   */
  fight?: FightSoundKind;
  // --- end fight-league ---
}

// --- fight-league --- the sound families of Fight League's weapons, abilities and KOs
export type FightSoundKind = "blade" | "blunt" | "arrow" | "gun" | "fire" | "magic" | "ability" | "ko" | "block";

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
  // --- themes: a styled burst particle (lib/physics/particleStyles.ts) – how the theme renderer draws it and a
  // multiplier of the particle gravity (1 when absent; bubbles rise, petals float). Visual only.
  style?: "sparks" | "petals" | "pixels" | "bubbles";
  gravity?: number;
  // --- end themes
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
  // --- teams ---
  /** Credits `ball` with a broken wall segment in the per-ball stats only (no split): Color Match's segment breaks. */
  creditWallBreak?(ball: Ball): void;
  isBouncierEnabled(): boolean;
  /** --- uncap-all --- The rebound gain per bounce of the Bounciness (0.03 = the old Bouncier), with no ceiling. */
  getBouncierIncrement?(): number;
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
  // --- gerald-multipliers ---
  /** The run's stat multipliers (cap, pickups, outgrow): modes stack multipliers through it (see multipliers.ts). */
  getMultipliers?(): MultiplierRuntime;
  // --- rigged ---
  /**
   * True while the rigged outcomes keep wall `wallIndex` closed to `ball` (a ball inside it): a mode that breaks walls
   * itself must not break it open for that ball (Shatter takes no damage, Color Match keeps its last segment).
   */
  isWallSealed?(ball: Ball, wallIndex: number): boolean;
  // --- jdm-illusions ---
  /**
   * Records a wall contact for the canvas' wobbly walls (render-only, see wobble.ts): wall `wallIndex` (a mode that
   * draws its own circles numbers them itself) was hit at `angle` (radians, seen from the wall's centre) with
   * `strength` (positive pushes the wall outward, negative inward; 1 = a head-on hit at the ball speed), at simulation
   * time `timeMs` (the current time when left out). Never changes the physics.
   */
  recordWallContact?(wallIndex: number, angle: number, strength: number, timeMs?: number): void;
  // --- end jdm-illusions ---
  // --- odd-string-battle --- a mode that keeps its own score and walls (the battle modes)
  /** Credits `ball` with a wall bounce in the per-ball / per-team stats (a mode resolving its own walls). */
  creditBounce?(ball: Pick<Ball, "id" | "team">): void;
  /** Credits `ball` with an escape at the current simulation time – a battle mode's win: the teams banner and the finder's "winner" rank it first. */
  creditEscape?(ball: Pick<Ball, "id" | "team">): void;
  /** The camera's near-miss event (slow motion when that feature is on), for a mode's own dramatic moment. */
  noteNearMiss?(): void;
  /** The camera's impact event (a screen shake when that feature is on), like a wall break – without its sound. */
  noteImpact?(): void;
  // --- end odd-string-battle ---
  // --- gerald-journey ---
  /**
   * Moves the engine's world state by (dx, dy): every ball and its trail, the particles, the shockwaves and the recent
   * obstacle contacts – a floating origin for a mode that scrolls through a long world (the Journey keeps its active stage
   * centred on the canvas, where the ring walls live). The mode moves its own obstacles; the physics is unchanged.
   */
  shiftWorld?(dx: number, dy: number): void;
  // --- bounce-math ---
  /**
   * A mode that resolves its own walls reports a bounce of `ball` (bounce math's "bounce" trigger). `rebound`: the mode has
   * just reflected the ball keeping its speed (Bouncing Shapes' walls) – the ball's bounce-math bounciness then applies to
   * that rebound once; without it nothing else changes.
   */
  noteBounce?(ball: Ball, rebound?: boolean): void;
  /** A mode that resolves its own ball-to-ball contacts reports a hit of `a` and `b` (bounce math's "ball hit" trigger). */
  noteCollide?(a: Ball, b: Ball): void;
  // --- end bounce-math ---
  // --- unlimited ---
  /** With No limits on, how many more full-physics balls the run may hold; null while the switch is off (the modes' own caps apply). */
  unlimitedRoom?(): number | null;
  /** With No limits on, adds `count` balls to the crowd at (x, y), fanned out from `angle` at `speed`; false once the crowd is full. */
  spawnCrowd?(count: number, x: number, y: number, speed: number, radius: number, angle: number, slot: number): boolean;
  /** With No limits on, a mode refused a clone at its ball limit (a mode without a crowd): the canvas shows ARENA FULL. A no-op while the switch is off. */
  noteArenaFull?(): void;
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
  /**
   * Called by `engine.consumeSoundEvents()` right before it hands the queue over – once per consumed batch, i.e.
   * once per rendered frame however many 60 Hz steps the frame ran (1–8+ with the playback speed). A mode that
   * budgets its sounds per frame (Collision Playground: the 12 most energetic collisions) collects them across the
   * steps and queues them here with `ctx.addPendingSoundEvent()`. Must not touch the physics (determinism).
   */
  flushPendingSounds?(ctx: ModeContext): void;
  /**
   * --- review fix (uncap-all) --- The fastest (px/s) a ball of the mode may move within the next step when that may outrun
   * the engine's own sub-steps (0 = nothing to plan): instead of clamping a user-driven speed, a mode that moves its balls
   * itself (Collision Playground's restitution, the Journey's fall) reports it and the engine plans the step for it –
   * enough sub-steps that no ball moves more than half its radius, time dilation past 64 (`planStep()`). A mode reports 0
   * while its balls stay under what it used to clamp them to, so those runs replay exactly as before.
   */
  stepSpeedBound?(ctx: ModeContext, stepSec: number): number;
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

/**
 * The gap (radians) a ring of radius `ringRadius` gets for the configured `gap` when a ball of radius `ballRadius` must be
 * able to pass it. The wall pass only counts a gap spanning 2.5 × the ball's angular radius (`atan2(r, R)`), so a gap too
 * narrow for the ball – a big Ball Size, a merged ball, a small inner ring – is widened to that plus 0.01 rad; a gap the
 * ball fits through keeps exactly its configured size (and every run with it replays as before).
 */
export function passableGap(gap: number, ringRadius: number, ballRadius: number): number {
  if (!(ballRadius > 0) || !(ringRadius > 0)) return gap;
  const need = 2.5 * Math.atan2(ballRadius, ringRadius);
  return gap >= need ? gap : need + 0.01;
}

export const TWO_PI = Math.PI * 2;

export function normalizeAngle(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Where the walk around a ring's wall starts (radians, unrotated): 0 – or, when the last of its gaps (sorted, each starting
 * in [0, 2π)) runs past 2π, the angle past 0 where that gap ends. The canvas strokes the wall from there to the first gap,
 * between the gaps and on to that start + 2π, so a gap across 0 is left open like the others.
 */
export function gapWrap(gaps: readonly Gap[]): number {
  const last = gaps.length > 0 ? gaps[gaps.length - 1] : null;
  return last && last.endAngle > TWO_PI ? last.endAngle - TWO_PI : 0;
}
