import { CinematicDirector } from "./director";
import { MAGNUS_COEFFICIENT, breathingScale, breathingScaleAtPhase, contactSpin, gravityAngle, gravityAngleTurned, resolvePhysicsExtras, spinDecayFactor } from "./extras";
import { canSplit, mergeBalls, resolveBallInteraction, splitBall } from "./interactions";
import {
  AccumulationMode,
  BoxMode,
  ClassicMode,
  ColorMatchMode,
  DropMode,
  GrowMode,
  LinesMode,
  MultiplyMode,
  PaintMode,
  PendulumMode,
  PortalMode,
  ShatterMode,
  TargetMode,
} from "./modes";
import type { BoxSettings, BoxView, DropSettings, PendulumSettings, PendulumView, PicturePaintState } from "./modes";
// --- jdm-polyrhythm ---
import { PolyrhythmMode, type PolyrhythmSettings, type PolyrhythmView } from "./modes";
// --- jdm-collisions ---
import { CollideMode, type CollideSettings, type CollideView } from "./modes/collide";
// --- gerald-glass ---
import { GlassMode, type GlassSettings, type GlassView } from "./modes/glass";
// --- gerald-multipliers ---
import { MultipliersMode, type MultipliersSettings, type MultipliersView } from "./modes/multipliers";
// --- jdm-double-pendulum ---
import { DoublePendulumMode, type DoublePendulumSettings, type DoublePendulumView } from "./modes/doublePendulum";
import { MultiplierRuntime, copyMultipliers, cruiseSpeed, effectiveBounce, smashesWalls, type MultiplierStat, type MultiplierView } from "./multipliers";
// --- jdm-illusions --- the Circle Illusion mode and the wall-contact log of the wobbly walls
import { IllusionMode, type IllusionSettings, type IllusionView } from "./modes/illusion";
// --- odd-power-layers --- the Power Layers mode (oddplayground)
import { PowerLayersMode, type PowerLayersSettings, type PowerLayersView } from "./modes/powerLayers";
import { WallContactLog, wobbleStrength } from "./wobble";
import { StringBattleMode, type StringBattleSettings, type StringBattleView } from "./modes/stringBattle"; // --- odd-string-battle ---
// --- jdm-race ---
import { RaceMode, type RaceSettings, type RaceView } from "./modes/race";
// --- jdm-arena-games --- Bouncing Square Battle Royale and Capture the Flag
import { BattleMode } from "./modes/battle";
import { CtfMode } from "./modes/ctf";
import type { ArenaView, BattleSettings, CtfSettings } from "./modes/arenaGames";
// --- jdm-rhythm-runner --- Beat Runner and Paddle Keep-Up
import { RunnerMode, type RunnerSettings, type RunnerView } from "./modes/runner";
import { PaddleMode, type PaddleInput, type PaddleSettings, type PaddleView } from "./modes/paddle";
// --- gerald-vortex --- the Sound Vortex (a spiral funnel of sound rings)
import { VortexMode, type VortexSettings, type VortexView } from "./modes/vortex";
// --- gerald-journey --- the Journey (a multi-stage commute home)
import { JourneyMode, type JourneySettings, type JourneyView } from "./modes/journey";
// --- gerald-bullseye --- Bullseye (a scoring target under a peg field)
import { BullseyeMode, type BullseyeSettings, type BullseyeView } from "./modes/bullseye";
// --- beat-drop --- Beat Drop (obstructions that fly in on the beat)
import { BeatDropMode, type BeatDropSettings, type BeatDropView } from "./modes/beatDrop";
import { OnBeatController, type OnBeatConfig, type OnBeatStats, type OnBeatWorld } from "./onBeat"; // --- video-beats ---
import { TerritoryMode, type TerritorySettings, type TerritoryView } from "./modes/territory"; // --- odd-territory ---
import { BM_BOUNCE, BM_COLLIDE, BounceMathRuntime, bounceHitEvent, shiftedObstacleFrequency, type BounceMathView } from "./bounceMathRuntime"; // --- bounce-math ---
// --- unlimited --- No limits: soft ceilings, the crowd, finite numbers, the ate-the-arena finish
import { UnlimitedRuntime, WALL_HITS_KEPT, type LimitsHost, type UnlimitedView } from "./limits";
import type { Crowd } from "./crowd";
import { LIVE_WALL_LIMIT } from "@/lib/unlimited";
import { BOUNCIER_CLASSIC_MAX, bouncierIncrementOf } from "@/lib/uncap"; // --- uncap-all --- the uncapped Bouncier
import { MazeMode, type MazeSettings, type MazeView } from "./modes/maze"; // --- odd-maze ---
// --- gerald-conveyor --- the Conveyor Belt mode and the respawn timer of Classic and Multiply
import { ConveyorMode, type ConveyorSettings, type ConveyorView } from "./modes/conveyor";
import { RespawnTimer } from "./respawn";
import { advanceObstacles, hasSpinningObstacles, resolveBallObstacle, type Obstacle } from "./obstacles";
import { SpatialHash, createPairBuffer } from "./spatialHash"; // --- gerald-multipliers --- the ball pass of big multiplier runs
import { PAIR_STEP_BUDGET, beginPairStep } from "./spatialHash"; // --- uncap-all ---
import { ObstacleField, supportsObstacles } from "./obstacleEditor"; // --- obstacle-editor ---
import type { PaintModeOptions } from "./picturePaint";
import { spawnStyledBurst, type ParticleStyle } from "./particleStyles"; // --- themes
import { BallStatsBook, ESCAPE_MARGIN, MULTI_BALL_MODES, startBallAngle, startBallColor, startBallCount, type BallStats } from "./ballStats"; // --- teams ---
import type { BeatClockConfig } from "@/lib/simulation/beatClock";
import type { RigView } from "./rigged"; // --- rigged ---
import { TimelineRuntime, resizeGaps, type TimelineKey } from "@/lib/simulation/timeline"; // --- timeline ---
import { ExitController, type ExitView } from "./movingExits"; // --- gerald-exit-splat ---
import { SplatField } from "./splats"; // --- gerald-exit-splat ---
import type {
  Ball,
  BallInteractionConfig,
  CircularWall,
  GameMode,
  ModeContext,
  ModeId,
  NewBall,
  ObstacleHit,
  Particle,
  PhysicsConfig,
  PhysicsExtras,
  Shockwave,
  SoundEvent,
  WallBreakFlash,
  WallBreakStyle,
  WallHit,
} from "./types";
import { TWO_PI, passableGap } from "./types";
// --- review fix (security-robustness) --- soft memory-safe ceilings of the rings, Target segments and spikes
import { LIVE_SPIKE_LIMIT, LIVE_TARGET_LIMIT, liveCount, withLiveRingCount } from "./softCeilings";

/**
 * Approach speed (px/s) from which an obstacle contact counts as a hit (sound + glow); resting contacts stay
 * silent. A resting ball is pushed into its support by one sub-step of gravity every step, so under heavy
 * gravity the threshold rises to three times that per-sub-step speed (see `handleObstacleCollisions()`).
 */
export const OBSTACLE_HIT_SPEED = 40;
/**
 * --- gerald-multipliers --- With multipliers in play and more balls than this, the ball-to-ball pass finds its pairs
 * through a spatial hash – O(n) a sub-step instead of n²/2, which up to 64 sub-steps a step would multiply (Multiply's
 * children inherit the speed multiplier and crowd the ring) –; every other run keeps the plain pair loop and its exact
 * trajectories.
 */
export const HASHED_PAIRS_FROM = 64;

/**
 * The physics engine. It is deliberately framework-free so it can run in the page,
 * inside a Web Worker, or headlessly in the seed finder.
 *
 * Determinism: every random decision that affects the simulation goes through `random()`,
 * a seeded Mulberry32 generator. Given the same config, mode and seed, a run is reproducible,
 * which is what makes "Find Simulation" possible. Purely visual randomness (particles) uses
 * Math.random so it never disturbs the simulation.
 *
 * Physics extras (air drag, wind, spin, wall bounciness, breathing walls, rotating gravity)
 * arrive inside the config (see extras.ts). They are all off by default and every one of them
 * is skipped entirely at its default value, so a run without extras is identical to the plain
 * engine. Breathing walls pulse `wall.radius` in place around the base radii kept in
 * `wallBaseRadii`, so gaps, modes and the renderer follow the pulse without knowing about it.
 * The pulse is applied per sub-step and every wall remembers where it was before the move
 * (`wallPrevRadii`), so the collision pass can sweep a wall over the distance it travelled:
 * a fast, wide pulse never steps over a ball (see `processWallCollisions()`).
 *
 * Ball interactions (interactions.ts) travel in the config as well: "bounce" (the default) keeps the
 * classic pair rebound, "merge" fuses touching balls in `mergeBallPair()`, "pass" skips the pair loop
 * and "split" halves a ball at the end of the step in which it broke a wall (`reportWallBreak()` →
 * `flushSplits()`), whether the engine's own gap pass or a mode reported the break.
 *
 * Obstacles (obstacles.ts) – pegs, bars and straight walls a mode places anywhere – are resolved for
 * every ball in every sub-step (`handleObstacleCollisions()`), before the ring walls; a hit above
 * `OBSTACLE_HIT_SPEED` is reported to the mode (`onObstacleHit`), queued as a "hit" sound (with the
 * pitch the mode chose) and remembered for the canvas glow. Ball Drop is built entirely out of them.
 *
 * Bouncing Shapes (modes/box.ts) owns its playfield entirely: it activates with the "none" ring layout,
 * folds every ball back into its box in `onBallStep()` and opts out of the pair loop (`ballsPassThrough`).
 * Pendulum Wave (modes/pendulum.ts) does the same with analytic motion: its bobs are ordinary balls whose
 * positions it overwrites at every sub-step from the simulation clock.
 * Metronomes & Polyrhythms (modes/polyrhythm.ts) too: its dots are balls pinned to positions it computes
 * once per step from exact tempo fractions of the step counter.
 */
export class PhysicsEngine {
  private balls: Ball[] = [];
  private _config: PhysicsConfig;
  private extras: PhysicsExtras;
  /** Pegs, bars and straight walls in play (empty in the ring modes); see obstacles.ts. */
  private obstacles: Obstacle[] = [];
  /** True while any bar spins, i.e. while `advanceObstacles()` has work to do each sub-step. */
  private obstaclesSpin = false;
  /** Recent obstacle contacts for the canvas glow (visual only). */
  private obstacleHits: ObstacleHit[] = [];
  /** Speed (px/s) one sub-step of gravity adds to a ball of normal weight in the current step; sets the hit threshold. */
  private subStepGravity = 0;
  /** Unpulsed wall radii (breathing walls); kept in step with `circularWalls` by `syncWallBaseRadii()`. */
  private wallBaseRadii: number[] = [];
  /** The breathing multiplier currently applied to `circularWalls` (1 = base radii). */
  private breathScale = 1;
  /** Radius of every wall before `applyBreathing()` last moved it (the start of the current sweep). */
  private wallPrevRadii: number[] = [];
  /** True while the walls breathe, i.e. while the collision pass has to sweep them. */
  private breathing = false;
  /**
   * The walls moved in the current sub-step (`applyBreathing()`), so its first collision pass sweeps them: while they
   * breathe, and in the sub-step that takes them back to their base radii after a keyframe switched the breathing off.
   */
  private sweepWalls = false;
  /**
   * --- timeline --- Set while `update()` applies the keyframes at the start of a step: a breathing change they make
   * does not move the walls there (unswept) but in the step's first sub-step, whose collision pass sweeps the whole move.
   */
  private deferBreathing = false;
  /** Direction of the gravity in the last step (radians, π/2 = straight down; see `getGravityAngle()`). */
  private gravityAngleRad = Math.PI / 2;
  /** Ball interaction (bounce / merge / split / pass) and the split limits; see interactions.ts. */
  private interaction: BallInteractionConfig;
  /** Balls that broke a wall during the current step; with the "split" interaction they split at its end. */
  private pendingSplits: { ball: Ball; wallIndex: number }[] = [];
  private nextId = 0;
  private destructionMode = false;
  private infiniteMode = false;
  private infiniteTimer = 0;
  private _elapsedMs = 0;
  private circularWalls: CircularWall[] = [];
  private wallRotations: number[] = [];
  private brokenWalls = new Set<number>();
  private lastWallLayer = new Map<number, number>();
  private wallHits: WallHit[] = [];
  private particles: Particle[] = [];
  private shockwaves: Shockwave[] = [];
  private wallBreakFlashes: WallBreakFlash[] = [];
  private wallBreakStyle: WallBreakStyle = "confetti";
  // --- themes: style and colours of the confetti bursts (visual only; see particleStyles.ts)
  private particleStyle: ParticleStyle = "confetti";
  private particlePalette: readonly string[] = [];
  private readonly pushParticleFn = (p: Particle) => this.pushParticle(p);
  // --- end themes
  // --- teams --- per-ball and per-team bounces, walls broken and escapes (ballStats.ts); recording never touches the physics
  private readonly ballStats = new BallStatsBook();
  private pendingSoundEvents: SoundEvent[] = [];
  /** Wall breaks so far – every "gap" event, the engine's or a mode's (never reset). The cinematic camera shakes on it. */
  private wallBreakSerial = 0; // --- camera ---
  /** --- rigged --- A rigged-outcome rule (never escape, forced winner) is in effect this step (see rigged.ts); false = the plain code path. */
  private rigOn = false;
  private readonly MAX_PARTICLES = 200;
  private bouncierEnabled = false;
  private bounceSpeedMultiplier = 1;
  // --- uncap-all --- the rebound gain per bounce is the Bounciness − 1 (0.03 = the old switch) and has no ceiling
  private bouncierIncrement = 0.03;
  private cinematicDirector = new CinematicDirector();
  private _seed = 0;
  private _rngState = 0;
  private _customSeed: number | null = null;
  private currentMode: GameMode | null = null;
  private timeAccumulator = 0;
  private readonly FIXED_STEP_MS = 1000 / 60;

  readonly classicMode = new ClassicMode();
  readonly linesMode = new LinesMode();
  readonly paintMode = new PaintMode();
  readonly multiplyMode = new MultiplyMode();
  readonly accumulationMode = new AccumulationMode();
  readonly targetMode = new TargetMode();
  readonly portalMode = new PortalMode();
  readonly shatterMode = new ShatterMode();
  readonly colorMatchMode = new ColorMatchMode();
  readonly growMode = new GrowMode();
  readonly dropMode = new DropMode();
  readonly boxMode = new BoxMode();
  readonly pendulumMode = new PendulumMode();
  // --- jdm-polyrhythm ---
  readonly polyrhythmMode = new PolyrhythmMode();
  // --- jdm-collisions ---
  readonly collideMode = new CollideMode();
  // --- gerald-glass ---
  readonly glassMode = new GlassMode();
  // --- gerald-multipliers --- the board mode, and the run's stat multipliers (pickups, cap, smash, adaptive sub-steps, outgrow)
  readonly multipliersMode = new MultipliersMode();
  // --- jdm-double-pendulum --- the Double Pendulum Harp and sparring pendulums (RK4 chains, strings, elastic bob hits)
  readonly doublePendulumMode = new DoublePendulumMode();
  private readonly multipliers = new MultiplierRuntime({
    burst: (x, y, color, radius) => this.spawnMergeBurst(x, y, color, radius),
    breakWall: (ball, wallIndex) => this.smashWall(ball, wallIndex),
    cloned: (parent, clone) => {
      // --- teams --- a clone plays for its parent's team and does not escape again
      if (parent.team !== undefined) clone.team = parent.team;
      this.ballStats.inheritEscape(parent.id, clone.id);
      this.currentMode?.onBallSplit?.(this.ctx, parent, clone);
      this.bounceMath.inherit(parent, clone); // --- bounce-math --- (a clone keeps its parent's bounciness, hue and pitch)
    },
  });

  // --- gerald-multipliers --- the hashed ball pass: the grid, the candidate pairs and the balls' positions (reused, grown on demand)
  private readonly pairHash = new SpatialHash();
  private readonly pairBuffer = createPairBuffer(512);
  private pairXs = new Float64Array(0);
  private pairYs = new Float64Array(0);
  private pairRs = new Float64Array(0);
  // --- obstacle-editor --- the creator's pegs, bumpers, blockers and spinners (obstacleEditor.ts), built from the config
  private readonly editorObstacles = new ObstacleField();
  // --- timeline --- keyframed settings (lib/simulation/timeline.ts), applied at the start of every fixed step from the simulation clock
  private readonly timeline = new TimelineRuntime();
  /** True while the timeline writes the config itself (its values are not the page's, so they bypass `prepare()`). */
  private timelineApplying = false;
  // --- jdm-illusions --- the Circle Illusion mode, and every wall contact of the run for the canvas' wobbly walls (render-only)
  readonly illusionMode = new IllusionMode();
  private readonly wallContacts = new WallContactLog();
  // --- odd-string-battle --- the String Battle (threads anchored on the ring, cut / touch / collide combat)
  readonly stringBattleMode = new StringBattleMode();
  // --- odd-power-layers --- the Power Layers mode: a ball smashing a stack of layers with a growing power
  readonly powerLayersMode = new PowerLayersMode();
  // --- jdm-race --- the Square Racing Grand Prix (a seeded track, racers, standings, podium and cup)
  readonly raceMode = new RaceMode();
  // --- jdm-arena-games --- the two team games of bouncing squares
  readonly battleMode = new BattleMode();
  readonly ctfMode = new CtfMode();
  // --- jdm-rhythm-runner --- the Beat Runner (obstacles on the beat) and Paddle Keep-Up (a ball on a moving platform)
  readonly runnerMode = new RunnerMode();
  readonly paddleMode = new PaddleMode();
  // --- gerald-vortex ---
  readonly vortexMode = new VortexMode();
  // --- gerald-journey ---
  readonly journeyMode = new JourneyMode();
  // --- gerald-bullseye ---
  readonly bullseyeMode = new BullseyeMode();
  // --- beat-drop ---
  readonly beatDropMode = new BeatDropMode();
  // --- odd-territory --- Territory: pong-wars teams painting a tile map
  readonly territoryMode = new TerritoryMode();
  // --- odd-maze --- Maze escape (a seeded maze the balls race through, leaving a trail)
  readonly mazeMode = new MazeMode();
  // --- gerald-conveyor --- the Conveyor Belt (a belt drops a ball into the arena below every few seconds), and the respawn
  // timer of Classic and Multiply (a new ball drops in every `respawnEvery` seconds; respawn.ts)
  readonly conveyorMode = new ConveyorMode();
  private readonly respawn = new RespawnTimer();
  // --- video-beats --- On beat: the ring modes' flights retimed so the wall hits land on the beat grid (onBeat.ts)
  private readonly onBeat = new OnBeatController();
  private onBeatWorld: OnBeatWorld | null = null;
  // --- end video-beats ---
  // --- bounce-math --- rules that change a parameter on every bounce, pass, collision, break, beat, bar or second (bounceMathRuntime.ts)
  private readonly bounceMath = new BounceMathRuntime({
    ctx: () => this.ctx,
    mode: () => this.currentMode?.name,
    multipliers: () => this.multipliers,
    setWorld: (key, value) => this.setBounceMathWorld(key, value),
    airDrag: () => this.extras.airDrag,
    soundEvents: () => this.pendingSoundEvents,
  });
  // --- end bounce-math ---
  // --- unlimited --- No limits (limits.ts): soft ceilings, the crowd, finite numbers, the ate-the-arena finish
  private readonly limits = new UnlimitedRuntime();
  private readonly limitsHost: LimitsHost = {
    breakWall: (ball, wallIndex, quiet) => {
      // A burst past the step's first few: the smash without its particles and shockwave (visual only, no seeded draws).
      const style = this.wallBreakStyle;
      if (quiet) this.wallBreakStyle = "none";
      this.smashWall(ball, wallIndex);
      this.wallBreakStyle = style;
    },
  };
  // --- end unlimited ---
  // --- gerald-exit-splat --- moving exits (movingExits.ts) and splat barriers (splats.ts) of the ring modes
  private readonly exits = new ExitController();
  private readonly splats = new SplatField();
  /** The exits move by themselves this step: the rings hold still (`wallRotationRate()` is 0). */
  private exitsHoldRings = false;
  /** Wall hits leave splats this step (the splat barrier is on in a ring mode). */
  private splatsLive = false;
  /** The balls the rings do not resolve (Multiply's escaped ones): the exits and the splats leave them alone. */
  private readonly ringSkips = (ball: Ball) => this.currentMode?.shouldSkipWallCollision(ball) ?? false;
  // --- end gerald-exit-splat ---

  readonly ctx: ModeContext;

  constructor(config: PhysicsConfig) {
    config = withLiveRingCount(config); // --- review fix (security-robustness) --- (a link's wc=1000000 builds LIVE_RING_LIMIT rings)
    this._config = config;
    this.extras = resolvePhysicsExtras(config);
    this.breathing = this.extras.breathingAmplitude > 0;
    this.interaction = resolveBallInteraction(config);
    this.multipliers.setConfig(config); // --- gerald-multipliers ---
    this.editorObstacles.configure(config); // --- obstacle-editor ---
    this.timeline.prepare({ timeline: config.timeline }, config); // --- timeline --- (the config's values become the automated settings' bases)
    this.bounceMath.configure(config.bounceMath, 0); // --- bounce-math ---
    this.applyLimits(); // --- unlimited --- (the switch, the soft ceilings, the extras past their ranges)
    // --- gerald-exit-splat --- the exit behaviour and the splat barrier
    this.exits.configure(this._config);
    this.splats.configure(this._config);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.ctx = {
      get config() {
        return self._config;
      },
      getBalls: () => this.balls,
      setBalls: (balls) => {
        this.balls = balls;
      },
      addBall: (ball) => this.addBall(ball),
      getNextId: () => this.nextId,
      getCircularWalls: () => this.circularWalls,
      setCircularWalls: (walls) => {
        this.circularWalls = walls;
        this.syncWallBaseRadii();
      },
      getWallRotations: () => this.wallRotations,
      setWallRotations: (rotations) => {
        this.wallRotations = rotations;
      },
      getBrokenWalls: () => this.brokenWalls,
      getLastWallLayer: () => this.lastWallLayer,
      addWallHit: (wallIndex, angle, radius) => this.addWallHit(wallIndex, angle, radius),
      addPendingSoundEvent: (event) => {
        this.pendingSoundEvents.push(event);
        if (event.type === "gap") this.wallBreakSerial++; // --- camera ---
      },
      spawnWallBreakByStyle: (wallIndex, x, y) => this.spawnWallBreakByStyle(wallIndex, x, y),
      spawnConfetti: (x, y) => this.spawnConfetti(x, y),
      reportWallBreak: (ball, wallIndex) => this.reportWallBreak(ball, wallIndex),
      creditWallBreak: (ball) => this.ballStats.wall(ball), // --- teams ---
      isBouncierEnabled: () => this.bouncierEnabled,
      getBouncierIncrement: () => this.bouncierIncrement, // --- uncap-all ---
      getBounceSpeedMultiplier: () => this.bounceSpeedMultiplier,
      setBounceSpeedMultiplier: (value) => {
        this.bounceSpeedMultiplier = value;
      },
      setDestructionMode: (enabled) => {
        this.destructionMode = enabled;
      },
      setInfiniteMode: (enabled) => {
        this.infiniteMode = enabled;
      },
      random: () => this.random(),
      getElapsedMs: () => this._elapsedMs,
      getWallBaseRadii: () => this.wallBaseRadii,
      getPhysicsExtras: () => this.extras,
      getObstacles: () => this.obstacles,
      setObstacles: (obstacles) => this.setObstacles(obstacles),
      getMultipliers: () => this.multipliers, // --- gerald-multipliers ---
      isWallSealed: (ball, wallIndex) => this.rigOn && this.rigSeals(ball, wallIndex), // --- rigged ---
      recordWallContact: (wallIndex, angle, strength, timeMs) => this.wallContacts.record(wallIndex, angle, strength, timeMs ?? this._elapsedMs), // --- jdm-illusions ---
      // --- odd-string-battle --- a battle mode's score (bounces, the win) and its camera moments (slow motion, shake)
      creditBounce: (ball) => this.ballStats.bounce(ball),
      creditEscape: (ball) => {
        this.ballStats.escape(ball, this._elapsedMs);
      },
      noteNearMiss: () => this.cinematicDirector.noteRigNearMiss(),
      noteImpact: () => {
        this.wallBreakSerial++;
      },
      // --- end odd-string-battle ---
      shiftWorld: (dx, dy) => this.shiftWorld(dx, dy), // --- gerald-journey ---
      // --- unlimited --- spawns past the full-physics balls join the crowd
      unlimitedRoom: () => (this.limits.on ? this.limits.objectRoom(this.balls.length) : null),
      spawnCrowd: (count, x, y, speed, radius, angle, slot) => this.limits.overflow(count, x, y, speed, radius, angle, slot),
      noteArenaFull: () => this.limits.noteFull(),
    };
    // --- bounce-math --- a mode's own bounces (String Battle's credits, the `noteBounce()` of the modes that resolve their own
    // walls, pegs and arcs), its own ball-to-ball hits (`noteCollide()`) and the wall breaks it credits are bounce-math triggers too
    const creditBounce = this.ctx.creditBounce;
    const creditWallBreak = this.ctx.creditWallBreak;
    Object.assign(this.ctx, {
      creditBounce: (ball: Pick<Ball, "id" | "team">) => {
        creditBounce?.(ball);
        if (this.bounceMath.on) this.bounceMath.note(BM_BOUNCE, ball as Ball);
      },
      creditWallBreak: (ball: Ball) => {
        creditWallBreak?.(ball);
        if (this.bounceMath.on) this.bounceMath.noteBreakBall(ball);
      },
      noteBounce: (ball: Ball, rebound?: boolean) => {
        if (!this.bounceMath.on) return;
        if (rebound && ball.restitution !== undefined) this.scaleModeRebound(ball);
        this.bounceMath.note(BM_BOUNCE, ball);
      },
      noteCollide: (a: Ball, b: Ball) => {
        if (this.bounceMath.on) this.bounceMath.note(BM_COLLIDE, a, b);
      },
    });
    // --- end bounce-math ---
    this._seed = Math.floor(0x7fffffff * Math.random());
    this._rngState = this._seed;
    this.cinematicDirector.setRandom(() => this.random());
    this.initializeCircularWalls();
  }

  // ---------------------------------------------------------------- RNG / seeds

  setSeed(seed: number | null) {
    if (seed === null) {
      this._customSeed = null;
    } else {
      this._customSeed = seed | 0;
      this._seed = this._customSeed;
      this._rngState = this._seed;
    }
  }
  getSeed() {
    return this._seed;
  }
  // --- daily-gallery ---
  /** The seed every run starts from while one is pinned (a found run, a shared or daily seed); null: each run draws a fresh one. */
  getPinnedSeed(): number | null {
    return this._customSeed;
  }
  // --- end daily-gallery ---
  resetRng() {
    this._rngState = this._seed;
  }
  /** Mulberry32. */
  random(): number {
    let t = (this._rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  get config() {
    return this.bounceMath.publicConfig(this._config); // --- bounce-math --- (the page's gravity, spin and gap while a rule holds them)
  }

  // ---------------------------------------------------------------- mode activation

  private activateMode(mode: GameMode, layout: "classic" | "single-gap" | "solid" | "none") {
    this.clear();
    this._elapsedMs = 0;
    this._seed = this._customSeed !== null ? this._customSeed : Math.floor(0x7fffffff * Math.random());
    this.resetRng();
    this.currentMode = mode;
    this.cinematicDirector.reset();
    if (layout === "classic") {
      this.initializeCircularWalls();
    } else if (layout === "none") {
      // No rings at all: the mode builds its playfield out of obstacles in init().
      this.circularWalls = [];
      this.wallRotations = [];
    } else if (layout === "single-gap") {
      const r = (Math.min(this._config.width, this._config.height) / 2) * 0.75;
      const gap = passableGap(this._config.gapSize || 0.3, r, this.ringPassRadius());
      const start = 0.25 * Math.PI;
      this.circularWalls = [{ radius: r, gaps: [{ startAngle: start, endAngle: start + gap }] }];
      this.wallRotations = [0];
    } else {
      const r = (Math.min(this._config.width, this._config.height) / 2) * 0.75;
      this.circularWalls = [{ radius: r, gaps: [] }];
      this.wallRotations = [0];
    }
    this.syncWallBaseRadii();
    this.brokenWalls.clear();
    mode.init(this.ctx);
    if (this.balls.length === 0) {
      const cx = this._config.width / 2;
      const cy = this._config.height / 2;
      const a = this.random() * Math.PI * 2;
      const speed = this._config.ballSpeed || 400;
      // --- teams --- in the multi-ball modes every starting ball carries its slot (its team)
      const count = startBallCount(this._config, mode.name);
      const multi = MULTI_BALL_MODES.includes(mode.name);
      this.addBall({
        x: cx,
        y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: this._config.ballRadius || 8,
        color: this._config.ballColor || "#FFFFFF",
        ...(multi ? { team: 0 } : {}), // --- teams ---
      });
      this.lastWallLayer.set(this.nextId - 1, -1);
      // --- teams --- up to six balls, evenly spread (the second of two flies straight back, as it always did); no random draws
      for (let slot = 1; slot < count; slot++) {
        const b = startBallAngle(a, slot, count);
        this.addBall({
          x: cx,
          y: cy,
          vx: Math.cos(b) * speed,
          vy: Math.sin(b) * speed,
          radius: this._config.ballRadius || 8,
          color: startBallColor(slot, this._config),
          team: slot,
        });
        this.lastWallLayer.set(this.nextId - 1, -1);
      }
    }
  }

  initClassic() {
    this.activateMode(this.classicMode, "classic");
  }
  initAccumulation() {
    this.clear();
    this._elapsedMs = 0;
    this._seed = this._customSeed !== null ? this._customSeed : Math.floor(0x7fffffff * Math.random());
    this.resetRng();
    this.currentMode = this.accumulationMode;
    this.cinematicDirector.reset();
    const r = (Math.min(this._config.width, this._config.height) / 2) * 0.75;
    const gap = passableGap(this._config.gapSize || 0.3, r, this.ringPassRadius());
    const start = 0.25 * Math.PI;
    this.circularWalls = [{ radius: r, gaps: [{ startAngle: start, endAngle: start + gap }] }];
    this.wallRotations = [0];
    this.syncWallBaseRadii();
    this.brokenWalls.clear();
    this.accumulationMode.init(this.ctx);
    this.lastWallLayer.set(this.nextId - 1, -1);
  }
  initMultiply() {
    this.activateMode(this.multiplyMode, "single-gap");
  }
  initLines() {
    this.activateMode(this.linesMode, "solid");
  }
  initPaint() {
    this.activateMode(this.paintMode, "solid");
  }
  initCountdown() {
    this.activateMode(this.targetMode, "solid");
  }
  initPortal() {
    this.activateMode(this.portalMode, "solid");
  }
  initShatter() {
    this.activateMode(this.shatterMode, "classic");
  }
  initColorMatch() {
    this.activateMode(this.colorMatchMode, "solid");
  }
  initGrow() {
    this.activateMode(this.growMode, "solid");
  }
  initDrop() {
    this.activateMode(this.dropMode, "none");
  }
  initBox() {
    this.activateMode(this.boxMode, "none");
  }
  initPendulum() {
    this.activateMode(this.pendulumMode, "none");
  }
  // --- jdm-polyrhythm ---
  initPolyrhythm() {
    this.activateMode(this.polyrhythmMode, "none");
  }
  // --- jdm-collisions ---
  initCollide() {
    this.activateMode(this.collideMode, "none");
  }
  // --- gerald-glass ---
  initGlass() {
    this.activateMode(this.glassMode, "none");
  }
  // --- gerald-multipliers ---
  initMultipliers() {
    this.activateMode(this.multipliersMode, "none");
  }
  // --- jdm-double-pendulum ---
  initDoublePendulum() {
    this.activateMode(this.doublePendulumMode, "none");
  }
  // --- jdm-illusions ---
  initIllusion() {
    this.activateMode(this.illusionMode, "none");
  }
  // --- odd-string-battle --- the mode owns its ring (like the rhythm modes own their playfields)
  initStringBattle() {
    this.activateMode(this.stringBattleMode, "none");
  }
  // --- odd-power-layers ---
  initPowerLayers() {
    this.activateMode(this.powerLayersMode, "none");
  }
  // --- jdm-race ---
  initRace() {
    this.activateMode(this.raceMode, "none");
  }
  // --- jdm-arena-games ---
  initBattle() {
    this.activateMode(this.battleMode, "none");
  }
  initCtf() {
    this.activateMode(this.ctfMode, "none");
  }
  // --- jdm-rhythm-runner --- both own their playfields (no rings)
  initRunner() {
    this.activateMode(this.runnerMode, "none");
  }
  initPaddle() {
    this.activateMode(this.paddleMode, "none");
  }
  // --- gerald-vortex --- the mode owns its funnel (no rings)
  initVortex() {
    this.activateMode(this.vortexMode, "none");
  }
  // --- gerald-journey --- the mode owns its column of stages (a rings stage sets the engine's rings itself while it is active)
  initJourney() {
    this.activateMode(this.journeyMode, "none");
  }
  // --- gerald-bullseye --- the mode builds its playfield out of obstacles (no rings)
  initBullseye() {
    this.activateMode(this.bullseyeMode, "none");
  }
  // --- beat-drop --- the mode owns its scene (no rings)
  initBeatDrop() {
    this.activateMode(this.beatDropMode, "none");
  }
  // --- odd-territory --- the mode owns its tile map (no rings)
  initTerritory() {
    this.activateMode(this.territoryMode, "none");
  }
  // --- odd-maze --- the mode owns its maze (no rings)
  initMaze() {
    this.activateMode(this.mazeMode, "none");
  }
  // --- gerald-conveyor --- the mode owns its field (the rings arena sets the engine's rings itself)
  initConveyor() {
    this.activateMode(this.conveyorMode, "none");
  }

  /** Convenience: (re)start the simulation for a mode id. */
  initMode(mode: ModeId) {
    switch (mode) {
      case "classic":
        return this.initClassic();
      case "accumulation":
        return this.initAccumulation();
      case "multiply":
        return this.initMultiply();
      case "lines":
        return this.initLines();
      case "paint":
        return this.initPaint();
      case "target":
        return this.initCountdown();
      case "portal":
        return this.initPortal();
      case "shatter":
        return this.initShatter();
      case "colorMatch":
        return this.initColorMatch();
      case "grow":
        return this.initGrow();
      case "drop":
        return this.initDrop();
      case "box":
        return this.initBox();
      case "pendulum":
        return this.initPendulum();
      // --- jdm-polyrhythm ---
      case "polyrhythm":
        return this.initPolyrhythm();
      // --- jdm-collisions ---
      case "collide":
        return this.initCollide();
      // --- gerald-glass ---
      case "glass":
        return this.initGlass();
      // --- gerald-multipliers ---
      case "multipliers":
        return this.initMultipliers();
      // --- jdm-double-pendulum ---
      case "doublePendulum":
        return this.initDoublePendulum();
      // --- jdm-illusions ---
      case "illusion":
        return this.initIllusion();
      // --- odd-string-battle ---
      case "stringBattle":
        return this.initStringBattle();
      // --- odd-power-layers ---
      case "powerLayers":
        return this.initPowerLayers();
      // --- jdm-race ---
      case "race":
        return this.initRace();
      // --- jdm-arena-games ---
      case "battle":
        return this.initBattle();
      case "ctf":
        return this.initCtf();
      // --- jdm-rhythm-runner ---
      case "runner":
        return this.initRunner();
      case "paddle":
        return this.initPaddle();
      // --- gerald-vortex ---
      case "vortex":
        return this.initVortex();
      // --- gerald-journey ---
      case "journey":
        return this.initJourney();
      // --- gerald-bullseye ---
      case "bullseye":
        return this.initBullseye();
      // --- beat-drop ---
      case "beatDrop":
        return this.initBeatDrop();
      // --- odd-territory ---
      case "territory":
        return this.initTerritory();
      // --- odd-maze ---
      case "maze":
        return this.initMaze();
      // --- gerald-conveyor ---
      case "conveyor":
        return this.initConveyor();
    }
  }

  // ---------------------------------------------------------------- getters

  getCircularWalls() {
    return this.circularWalls;
  }
  getWallRotations() {
    return this.wallRotations;
  }
  getBrokenWalls() {
    return this.brokenWalls;
  }
  getShockwaves() {
    return this.shockwaves;
  }
  getWallBreakFlashes() {
    return this.wallBreakFlashes;
  }
  setWallBreakStyle(style: WallBreakStyle) {
    this.wallBreakStyle = style;
  }
  getWallBreakStyle() {
    return this.wallBreakStyle;
  }
  // --- themes
  /**
   * Style of the confetti bursts (wall breaks, portals, finished runs) and the colours they take; an empty palette
   * keeps each style's own colours, and "confetti" with an empty palette is the classic burst. Visual only.
   */
  setParticleStyle(style: ParticleStyle, palette: readonly string[] = []) {
    this.particleStyle = style;
    this.particlePalette = palette;
  }
  getParticleStyle() {
    return this.particleStyle;
  }
  // --- end themes
  getWallHits() {
    return this.wallHits;
  }
  getParticles() {
    return this.particles;
  }
  getBalls() {
    return this.balls;
  }
  setBalls(balls: Ball[]) {
    this.balls = balls;
  }
  setBouncier(enabled: boolean) {
    this.bouncierEnabled = enabled;
    if (!enabled) this.bounceSpeedMultiplier = 1;
  }
  // --- uncap-all ---
  /**
   * The numeric Bounciness (the uncapped Bouncier): every wall bounce adds (value − 1) × the Ball Speed to the rebound
   * multiplier – 1.03 is the old switch, 3 adds 200 % a bounce, 1e6 a million times – with no ceiling; 1 (or less) is off.
   * The multiplier resets on a gap pass or a wall break, as it always did.
   */
  setBounciness(value: number) {
    const increment = bouncierIncrementOf(value);
    if (increment > 0) this.bouncierIncrement = increment;
    this.setBouncier(increment > 0);
  }
  getBouncierIncrement() {
    return this.bouncierIncrement;
  }
  // --- end uncap-all ---
  isBouncierEnabled() {
    return this.bouncierEnabled;
  }
  getBounceSpeedMultiplier() {
    return this.bounceSpeedMultiplier;
  }
  setDestructionMode(enabled: boolean) {
    this.destructionMode = enabled;
  }
  setInfiniteMode(enabled: boolean) {
    this.infiniteMode = enabled;
  }
  getCurrentModeName(): ModeId {
    return this.currentMode?.name ?? "classic";
  }
  getCurrentMode() {
    return this.currentMode;
  }

  isAccumulationMode() {
    return this.currentMode === this.accumulationMode;
  }
  hasAccumulationEscaped() {
    return this.accumulationMode.hasEscaped();
  }
  getFrozenBalls() {
    return this.accumulationMode.getFrozenBalls();
  }
  getAccumulationTimer() {
    return this.accumulationMode.getTimer();
  }
  getAccumulationTimerMax() {
    return this.accumulationMode.getTimerMax();
  }
  setAccumulationTimerMax(ms: number) {
    this.accumulationMode.setTimerMax(ms);
  }
  getSpikesEnabled() {
    return this.accumulationMode.getSpikesEnabled();
  }
  getSpikeCount() {
    return this.accumulationMode.getSpikeCount();
  }
  getSpikeAngles() {
    return this.accumulationMode.getSpikeAngles();
  }
  getSpikeLength() {
    return this.accumulationMode.getSpikeLength();
  }
  setSpikesEnabled(enabled: boolean) {
    this.accumulationMode.setSpikesEnabled(enabled, this.ctx);
  }
  setSpikeCount(count: number) {
    this.accumulationMode.setSpikeCount(this.limits.ceilValue("spikeCount", liveCount(count, LIVE_SPIKE_LIMIT)), this.ctx); // --- unlimited --- (its soft ceiling) --- review fix (security-robustness) --- (also with No limits off)
  }
  isMultiplyModeActive() {
    return this.currentMode === this.multiplyMode;
  }
  getMultiplySpawnCount() {
    return this.multiplyMode.getSpawnCount();
  }
  setMultiplySpawnCount(n: number) {
    this.multiplyMode.setSpawnCount(n);
  }
  isLinesMode() {
    return this.currentMode === this.linesMode;
  }
  getBouncePoints() {
    return this.linesMode.getBouncePoints();
  }
  isPaintMode() {
    return this.currentMode === this.paintMode;
  }
  getPaintPoints() {
    return this.paintMode.getPaintPoints();
  }
  getPaintCoverage() {
    return this.paintMode.getPaintCoverage();
  }
  /** Picture Paint: brush, beat sync, guidance and pacing of the Paint mode (see physics/picturePaint.ts). */
  setPaintOptions(patch: Partial<PaintModeOptions>) {
    this.paintMode.setOptions(patch);
  }
  getPaintOptions(): PaintModeOptions {
    return this.paintMode.getOptions();
  }
  /** Picture Paint: the beat the Paint mode moves to – a detected song grid or the manual BPM (see simulation/beatClock.ts). */
  setPaintBeat(patch: Partial<BeatClockConfig>) {
    this.paintMode.setBeat(patch);
  }
  /** Live Picture Paint state (coverage, beat pulse, pacing…) for the canvas and the HUD; the same object every call. */
  getPaintState(): PicturePaintState {
    return this.paintMode.getPicturePaintState();
  }
  // --- video-beats ---
  /** On beat: the grid the ring modes land their wall hits on, the retiming range and the subdivisions allowed (onBeat.ts). */
  setOnBeat(patch: Partial<OnBeatConfig>) {
    this.onBeat.setConfig(patch);
  }
  getOnBeatConfig(): OnBeatConfig {
    return this.onBeat.getConfig();
  }
  /** How the planned hits land (the same object every call). */
  getOnBeatStats(): Readonly<OnBeatStats> {
    return this.onBeat.getStats();
  }
  /** After every 60 Hz step: plans / corrects the flights (or undoes the retiming once On beat no longer applies). */
  private stepOnBeat(stepMs: number, subSteps: number, audioIntensity: number, gDirX: number, gDirY: number, keepMoving: boolean) {
    const base = this._config.ballSpeed || 400;
    const w = (this.onBeatWorld ??= {
      mode: undefined,
      timeSec: 0,
      stepSec: 0,
      subSteps: 4,
      cx: 0,
      cy: 0,
      walls: [],
      broken: this.brokenWalls,
      gravity: 0,
      gDirX: 0,
      gDirY: 1,
      windX: 0,
      windY: 0,
      dragKeep: 1,
      keepMoving: true,
      cruise: (ball: Ball) => (ball.mult ? cruiseSpeed(ball, this._config.ballSpeed || 400) : this._config.ballSpeed || 400),
      suspended: false,
    });
    w.mode = this.currentMode?.name;
    w.timeSec = this._elapsedMs / 1000;
    w.stepSec = stepMs / 1000;
    w.subSteps = subSteps;
    w.cx = this._config.width / 2;
    w.cy = this._config.height / 2;
    w.walls = this.circularWalls;
    w.broken = this.brokenWalls;
    w.gravity = this.gravityAccel(audioIntensity);
    w.gDirX = gDirX;
    w.gDirY = gDirY;
    w.windX = this.extras.windX * base;
    w.windY = this.extras.windY * base;
    w.dragKeep = this.extras.airDrag > 0 ? Math.max(0, 1 - this.extras.airDrag) : 1; // --- uncap-all --- a drag of 1 or more stops the ball each step
    w.keepMoving = keepMoving;
    // Picture Paint's beat sync times the ball itself: On beat stands aside while it runs.
    const paint = this.currentMode === this.paintMode ? this.paintMode.getOptions() : null;
    w.suspended = !!paint && paint.picture && paint.beatSync;
    this.onBeat.afterStep(this.balls, w);
  }
  // --- end video-beats ---
  isCountdownMode() {
    return this.currentMode === this.targetMode;
  }
  getCountdownTotal() {
    return this.targetMode.getTotal();
  }
  getCountdownTarget() {
    return this.targetMode.getTarget();
  }
  getCountdownHit() {
    return this.targetMode.getHit();
  }
  getCountdownWrongFlashes() {
    return this.targetMode.getWrongFlashes();
  }
  isCountdownComplete() {
    return this.targetMode.isComplete();
  }
  isCountdownRandomOrder() {
    return this.targetMode.isRandomOrder();
  }
  getCountdownSegmentMap() {
    return this.targetMode.getSegmentMap();
  }
  setCountdownTotal(n: number) {
    this.targetMode.setTotal(this.limits.ceilValue("targetCount", liveCount(n, LIVE_TARGET_LIMIT))); // --- unlimited --- (its soft ceiling) --- review fix (security-robustness) --- (also with No limits off)
  }
  setCountdownRandomOrder(v: boolean) {
    this.targetMode.setRandomOrder(v);
  }
  isPortalMode() {
    return this.currentMode === this.portalMode;
  }
  getPortals() {
    return this.portalMode.getPortals();
  }
  getPortalTeleportCount() {
    return this.portalMode.getTeleportCount();
  }
  hasPortalEscaped() {
    return this.portalMode.hasEscaped();
  }
  getPortalCount() {
    return this.portalMode.getPortalCount();
  }
  setPortalCount(n: number) {
    this.portalMode.setPortalCount(n);
  }
  isShatterMode() {
    return this.currentMode === this.shatterMode;
  }
  getShatterSegments() {
    return this.shatterMode.getSegments();
  }
  getShatterProgress() {
    return this.shatterMode.getProgress();
  }
  hasShatterEscaped() {
    return this.shatterMode.hasEscaped();
  }
  getShatterSegmentsPerWall() {
    return this.shatterMode.getSegmentsPerWall();
  }
  setShatterSegmentsPerWall(n: number) {
    this.shatterMode.setSegmentsPerWall(n);
  }
  getShatterHpPerSegment() {
    return this.shatterMode.getHpPerSegment();
  }
  setShatterHpPerSegment(n: number) {
    this.shatterMode.setHpPerSegment(n);
  }
  isColorMatchMode() {
    return this.currentMode === this.colorMatchMode;
  }
  getColorMatchSegments() {
    return this.colorMatchMode.getSegments();
  }
  getColorMatchBallColor() {
    return this.colorMatchMode.getBallColor();
  }
  getColorMatchBallHue() {
    return this.colorMatchMode.getBallHue();
  }
  getColorMatchProgress() {
    return { broken: this.colorMatchMode.getBrokenCount(), total: this.colorMatchMode.getTotalSegments() };
  }
  hasColorMatchEscaped() {
    return this.colorMatchMode.hasEscaped();
  }
  getColorMatchSegmentCount() {
    return this.colorMatchMode.getSegmentCount();
  }
  setColorMatchSegmentCount(n: number) {
    this.colorMatchMode.setSegmentCount(n);
  }
  getColorMatchColorCount() {
    return this.colorMatchMode.getColorCount();
  }
  setColorMatchColorCount(n: number) {
    this.colorMatchMode.setColorCount(n);
  }
  isGrowMode() {
    return this.currentMode === this.growMode;
  }
  getGrowRate() {
    return this.growMode.getGrowRate();
  }
  setGrowRate(rate: number) {
    this.growMode.setGrowRate(rate);
  }
  isGrowCenterDotEnabled() {
    return this.growMode.isCenterDotEnabled();
  }
  setGrowCenterDotEnabled(enabled: boolean) {
    this.growMode.setCenterDotEnabled(enabled);
  }
  isGrowLinesEnabled() {
    return this.growMode.isLinesEnabled();
  }
  setGrowLinesEnabled(enabled: boolean) {
    this.growMode.setLinesEnabled(enabled);
  }
  getGrowBouncePoints() {
    return this.growMode.getBouncePoints();
  }
  getGrowState() {
    return this.growMode.getState() as { centerDotEnabled: boolean; centerDotRadius: number; linesEnabled: boolean };
  }
  isLinesCenterDotEnabled() {
    return this.linesMode.isCenterDotEnabled();
  }
  setLinesCenterDotEnabled(enabled: boolean) {
    this.linesMode.setCenterDotEnabled(enabled);
  }
  getLinesState() {
    return this.linesMode.getState() as { centerDotEnabled: boolean; centerDotRadius: number };
  }
  isDropMode() {
    return this.currentMode === this.dropMode;
  }
  getDropSettings(): DropSettings {
    return this.dropMode.getSettings();
  }
  /** Ball count, size / gravity spread, rows, release interval and rain; applied by the next `initDrop()`. */
  setDropSettings(settings: Partial<DropSettings>) {
    this.dropMode.setSettings(settings);
  }
  getDropProgress() {
    return this.dropMode.getProgress();
  }
  getDropLayout() {
    return this.dropMode.getLayout();
  }
  isBoxMode() {
    return this.currentMode === this.boxMode;
  }
  getBoxSettings(): BoxSettings {
    return this.boxMode.getSettings();
  }
  /** Shape count / kind, box aspect, gravity, countdown, growth and speed ratio; applied by the next `initBox()`. */
  setBoxSettings(settings: Partial<BoxSettings>) {
    this.boxMode.setSettings(settings);
  }
  /** Live Bouncing Shapes state (box, shapes, recent hits) for the canvas and the HUD; the same object every call. */
  getBoxView(): BoxView {
    return this.boxMode.getView();
  }
  getBoxProgress() {
    return this.boxMode.getProgress();
  }
  isPendulumMode() {
    return this.currentMode === this.pendulumMode;
  }
  getPendulumSettings(): PendulumSettings {
    return this.pendulumMode.getSettings();
  }
  /** Count, tuning, amplitude, layout, polygon, phasing, trails, sound and cycles of the Pendulum Wave; applied by the next `initPendulum()`. */
  setPendulumSettings(settings: Partial<PendulumSettings>) {
    this.pendulumMode.setSettings(settings);
  }
  /** Live Pendulum Wave state (rig, bobs, clock, counters) for the canvas and the HUD; the same object every call. */
  getPendulumView(): PendulumView {
    return this.pendulumMode.getView();
  }
  getPendulumProgress() {
    return this.pendulumMode.getProgress();
  }
  /** Seconds until the pendulums are next in line (Infinity with phasing on). */
  getPendulumSecondsToAlignment() {
    return this.pendulumMode.secondsToAlignment();
  }
  // --- jdm-polyrhythm ---
  isPolyrhythmMode() {
    return this.currentMode === this.polyrhythmMode;
  }
  getPolyrhythmSettings(): PolyrhythmSettings {
    return this.polyrhythmMode.getSettings();
  }
  /** Voices, tempo series, cycle and cycles of Metronomes & Polyrhythms apply on the next `initPolyrhythm()`; layout, polygons, accents, pitch mapping and numbers at once. */
  setPolyrhythmSettings(settings: Partial<PolyrhythmSettings>) {
    this.polyrhythmMode.setSettings(settings);
  }
  /** Live Metronomes & Polyrhythms state (geometry, voices, clock, counters) for the canvas and the HUD; the same object every call. */
  getPolyrhythmView(): PolyrhythmView {
    return this.polyrhythmMode.getView();
  }
  getPolyrhythmProgress() {
    return this.polyrhythmMode.getProgress();
  }
  /** Seconds until every voice ticks together again. */
  getPolyrhythmSecondsToAlignment() {
    return this.polyrhythmMode.secondsToAlignment();
  }
  // --- end jdm-polyrhythm ---
  // --- jdm-collisions ---
  isCollideMode() {
    return this.currentMode === this.collideMode;
  }
  getCollideSettings(): CollideSettings {
    return this.collideMode.getSettings();
  }
  /** Count, sizes, container, gravity, restitution, squishy, sync start, anti-collision and ring of the Collision Playground; applied by the next `initCollide()`. */
  setCollideSettings(settings: Partial<CollideSettings>) {
    this.collideMode.setSettings(settings);
  }
  /** Live Collision Playground state (container, colours, impacts, counters) for the canvas; the same object every call. */
  getCollideView(): CollideView {
    return this.collideMode.getView();
  }
  getCollideProgress() {
    return this.collideMode.getProgress();
  }
  // --- end jdm-collisions ---
  // --- gerald-multipliers ---
  isMultipliersMode() {
    return this.currentMode === this.multipliersMode;
  }
  getMultipliersSettings(): MultipliersSettings {
    return this.multipliersMode.getSettings();
  }
  /** Rows, gate mix, start balls, ball cap and count target of the multipliers board; applied by the next `initMultipliers()`. */
  setMultipliersSettings(settings: Partial<MultipliersSettings>) {
    this.multipliersMode.setSettings(settings);
  }
  /** Live multipliers-board state (board, camera, counters) for the canvas and the HUD; the same object every call. */
  getMultipliersView(): MultipliersView {
    return this.multipliersMode.getView();
  }
  getMultipliersProgress() {
    return this.multipliersMode.getProgress();
  }
  /** The stat multipliers of the run (HUD summary, pickup orbs, slow-mo, outgrow) for the canvas; the same object every call. */
  getMultiplierView(): MultiplierView {
    return this.multipliers.getView();
  }
  /** The run's multiplier runtime (config, cap, pickups); modes reach it through `ctx.getMultipliers()`. */
  getMultiplierRuntime(): MultiplierRuntime {
    return this.multipliers;
  }
  /** Stacks a stat multiplier on a ball through the cap in effect (what a pickup or a gate does); returns the factor applied. */
  applyBallMultiplier(ball: Ball, stat: MultiplierStat, factor: number): number {
    return this.multipliers.apply(ball, stat, factor);
  }
  /**
   * The run ended with a multipliers celebration the canvas draws – a ball outgrew the arena ("OUTGREW THE ARENA"), or
   * the board emptied ("N Gerald made it home") – which the page holds on screen (and in a recording) before its end
   * screen covers it. Both finish the run in the step they happen, so this is true from that step on.
   */
  endsWithMultiplierFinish(): boolean {
    return this.multipliers.isOutgrown() || (this.currentMode === this.multipliersMode && this.multipliersMode.getView().done);
  }
  // --- end gerald-multipliers ---
  // --- teams ---
  /** Bounces, walls broken and escapes of one ball (undefined until it scored anything; see ballStats.ts). */
  getBallStats(id: number): Readonly<BallStats> | undefined {
    return this.ballStats.ballStats(id);
  }
  /** Totals per team slot – `MAX_TEAMS` entries, the same objects every call, zeroed by every (re)start. */
  getTeamStats(): readonly Readonly<BallStats>[] {
    return this.ballStats.teams;
  }
  /** Bumped by every (re)start, so the canvas can tell a new run from the one it is showing. */
  getStatsGeneration(): number {
    return this.ballStats.generation;
  }
  /** True once the ball has left the arena (counted as an escape). */
  hasBallEscaped(id: number): boolean {
    return this.ballStats.hasEscaped(id);
  }
  /**
   * Live change of the ball count (the page's slider) in the multi-ball modes: the balls of the slots beyond
   * `count` (and their offspring) leave, the missing slots are added at the first ball still in the arena (the
   * centre when every ball has escaped), flying off in their start directions relative to it. Down to one ball,
   * only the first one stays (as the "two balls" switch did). Draws no random numbers; the next (re)start spawns
   * `count` balls from the centre.
   */
  setBallCount(count: number) {
    const oldPass = this.ringPassRadius();
    this._config = { ...this._config, ballCount: count };
    if (this.ringPassRadius() !== oldPass) this.refitGaps(); // (merge: more balls can fuse into a bigger one)
    const mode = this.currentMode;
    if (!mode || !MULTI_BALL_MODES.includes(mode.name)) return;
    const n = startBallCount(this._config, mode.name);
    if (n === 1) {
      if (this.balls.length > 1) this.balls = this.balls.slice(0, 1);
      return;
    }
    this.balls = this.balls.filter((b) => b.team === undefined || b.team < n);
    const anchor = this.balls.find((b) => !this.ballStats.hasEscaped(b.id));
    const a = anchor ? Math.atan2(anchor.vy, anchor.vx) : 0;
    const speed = this._config.ballSpeed || 400;
    for (let slot = 1; slot < n; slot++) {
      if (this.balls.some((b) => b.team === slot)) continue;
      const dir = startBallAngle(a, slot, n);
      this.addBall({
        x: anchor ? anchor.x : this._config.width / 2,
        y: anchor ? anchor.y : this._config.height / 2,
        vx: Math.cos(dir) * speed,
        vy: Math.sin(dir) * speed,
        radius: anchor ? anchor.radius : this._config.ballRadius || 8,
        color: startBallColor(slot, this._config),
        team: slot,
      });
    }
  }
  /**
   * Once per step: every ball beyond the outermost wall (its live radius – with breathing walls, where the pulse
   * has it now – plus the ball and `ESCAPE_MARGIN`) has escaped; the book counts each ball once. Reads positions
   * only. The modes that end on an escape (Shatter + 20 px, Color Match + 30 px) and Multiply (+ `ESCAPE_MARGIN`)
   * test the same live radius with at least this margin, and run their test in `onPostUpdate()` just before this
   * scan, so an escape that ends the run is always counted in the step that ends it (or earlier) – the scoreboard's
   * last frame and the winner never miss it.
   */
  private scanEscapes() {
    const walls = this.circularWalls;
    let outer = 0;
    for (let i = 0; i < walls.length; i++) if (walls[i].radius > outer) outer = walls[i].radius;
    const cx = this._config.width / 2;
    const cy = this._config.height / 2;
    // --- gerald-conveyor --- the Conveyor Belt's rings arena: a ball at the hatch, on the belt or in the loading tube is
    // outside the rings without having escaped them – only the balls launched into the rings count (`inRings()`)
    const conveyor = this.currentMode === this.conveyorMode;
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      if (conveyor && !this.conveyorMode.inRings(ball)) continue;
      const limit = outer + ball.radius + ESCAPE_MARGIN;
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      if (dx * dx + dy * dy > limit * limit && this.ballStats.escape(ball, this._elapsedMs)) this.cinematicDirector.rig.noteEscape(ball, this._elapsedMs); // --- rigged --- the run's first escape
    }
  }
  // --- end teams ---
  // --- gerald-glass ---
  isGlassMode() {
    return this.currentMode === this.glassMode;
  }
  getGlassSettings(): GlassSettings {
    return this.glassMode.getSettings();
  }
  /** Rows, hit points, stages, sliding panes and holes of Glass Smash; applied by the next `initGlass()`. */
  setGlassSettings(settings: Partial<GlassSettings>) {
    this.glassMode.setSettings(settings);
  }
  /** Live Glass Smash state (level, panes, cracks, shards, camera, stage, HOME) for the canvas and the HUD; the same object every call. */
  getGlassView(): GlassView {
    return this.glassMode.getView();
  }
  getGlassProgress() {
    return this.glassMode.getProgress();
  }
  // --- end gerald-glass ---
  // --- jdm-double-pendulum ---
  isDoublePendulumMode() {
    return this.currentMode === this.doublePendulumMode;
  }
  getDoublePendulumSettings(): DoublePendulumSettings {
    return this.doublePendulumMode.getSettings();
  }
  /** Rig (count, rods, lengths, masses, gravity, start, damping, sparring) applied by the next `initDoublePendulum()`; trails, strings, tuning and the end at once. */
  setDoublePendulumSettings(settings: Partial<DoublePendulumSettings>) {
    this.doublePendulumMode.setSettings(settings);
  }
  /** Live Double Pendulum state (field, chains, trails, strings, hits, clock, counters) for the canvas and the HUD; the same object every call. */
  getDoublePendulumView(): DoublePendulumView {
    return this.doublePendulumMode.getView();
  }
  getDoublePendulumProgress() {
    return this.doublePendulumMode.getProgress();
  }
  /** Relative energy drift of the run so far (|E − E₀| over Σ m·g·1): the integrator's error without friction. */
  getDoublePendulumEnergyDrift() {
    return this.doublePendulumMode.energyDrift();
  }
  // --- end jdm-double-pendulum ---
  // --- jdm-illusions ---
  isIllusionMode() {
    return this.currentMode === this.illusionMode;
  }
  getIllusionSettings(): IllusionSettings {
    return this.illusionMode.getSettings();
  }
  /** Type, counts, pattern, speed and cycles of the Circle Illusion apply on the next `initIllusion()`; the tracks and the reveal at once. */
  setIllusionSettings(settings: Partial<IllusionSettings>) {
    this.illusionMode.setSettings(settings);
  }
  /** Live Circle Illusion state (bodies, circles, rings, layers, paint, counters) for the canvas and the HUD; the same object every call. */
  getIllusionView(): IllusionView {
    return this.illusionMode.getView();
  }
  getIllusionProgress() {
    return this.illusionMode.getProgress();
  }
  /** Every wall contact of the run – the rings of the ring modes, the Circle Illusion's own circles – for the canvas' wobbly walls. */
  getWallContacts(): WallContactLog {
    return this.wallContacts;
  }
  // --- end jdm-illusions ---
  // --- odd-string-battle ---
  isStringBattleMode() {
    return this.currentMode === this.stringBattleMode;
  }
  getStringBattleSettings(): StringBattleSettings {
    return this.stringBattleMode.getSettings();
  }
  /** Balls, lives, threads, rule, clip limit and finale speed of the String Battle apply on the next `initStringBattle()`; the style, HUD, badge and wobble at once. */
  setStringBattleSettings(settings: Partial<StringBattleSettings>) {
    this.stringBattleMode.setSettings(settings);
  }
  /** Live String Battle state (ring, fighters, threads, effects, finale, verdict) for the canvas and the HUD; the same object every call. */
  getStringBattleView(): StringBattleView {
    return this.stringBattleMode.getView();
  }
  getStringBattleProgress() {
    return this.stringBattleMode.getProgress();
  }
  // --- end odd-string-battle ---
  // --- odd-power-layers ---
  isPowerLayersMode() {
    return this.currentMode === this.powerLayersMode;
  }
  getPowerLayersSettings(): PowerLayersSettings {
    return this.powerLayersMode.getSettings();
  }
  /** Layers, sequence, drift and bounce speed of Power Layers apply on the next `initPowerLayers()`; the badges and the scale at once. */
  setPowerLayersSettings(settings: Partial<PowerLayersSettings>) {
    this.powerLayersMode.setSettings(settings);
  }
  /** Live Power Layers state (field, stack, power, level, particles, freedom) for the canvas and the HUD; the same object every call. */
  getPowerLayersView(): PowerLayersView {
    return this.powerLayersMode.getView();
  }
  /** Hits, layers gone, power, level, freedom – and `plannedMs`, when the run finishes (the hit count × the bounce period + the celebration). */
  getPowerLayersProgress() {
    return this.powerLayersMode.getProgress();
  }
  // --- end odd-power-layers ---
  // --- jdm-rhythm-runner --- Beat Runner and Paddle Keep-Up (modes/runner.ts, modes/paddle.ts)
  isRunnerMode() {
    return this.currentMode === this.runnerMode;
  }
  /** The runner's course is planned at init: every setting (and the beat grid) applies on the next `initRunner()`; the scale and root at once. */
  setRunnerSettings(settings: Partial<RunnerSettings>) {
    this.runnerMode.setSettings(settings);
  }
  getRunnerSettings(): RunnerSettings {
    return this.runnerMode.getSettings();
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getRunnerView(): RunnerView {
    return this.runnerMode.getView();
  }
  getRunnerProgress() {
    return this.runnerMode.getProgress();
  }
  /** Space in the Beat Runner played by hand: the square jumps at the next sub-step (or right on landing). */
  runnerJump() {
    if (this.currentMode === this.runnerMode) this.runnerMode.requestJump(this._elapsedMs);
  }
  isPaddleMode() {
    return this.currentMode === this.paddleMode;
  }
  /** The game applies on the next `initPaddle()`; the scale and root at once. */
  setPaddleSettings(settings: Partial<PaddleSettings>) {
    this.paddleMode.setSettings(settings);
  }
  getPaddleSettings(): PaddleSettings {
    return this.paddleMode.getSettings();
  }
  getPaddleView(): PaddleView {
    return this.paddleMode.getView();
  }
  getPaddleProgress() {
    return this.paddleMode.getProgress();
  }
  /** Paddle Keep-Up played by hand: the pointer's place over the field (0–1, null = none) and the arrow keys (−1, 0, 1). */
  setPaddleInput(input: Partial<PaddleInput>) {
    this.paddleMode.setInput(input);
  }
  /** The finder's fast path for a freshly initialised paddle game: when it finishes (ms, at most `maxMs`), without the engine loop. */
  paddleRunLengthMs(maxMs: number) {
    return this.paddleMode.runLengthMs(this.ctx, maxMs);
  }
  // --- end jdm-rhythm-runner ---
  // --- jdm-race ---
  isRaceMode() {
    return this.currentMode === this.raceMode;
  }
  getRaceSettings(): RaceSettings {
    return this.raceMode.getSettings();
  }
  /** Racers, track length, laps, obstacle mix, the favourite and the cup apply on the next `initRace()`; the camera and the shape at once. */
  setRaceSettings(settings: Partial<RaceSettings>) {
    this.raceMode.setSettings(settings);
  }
  /** Live race state (track, standings, gaps, callouts, camera, podium) for the canvas and the HUD; the same object every call. */
  getRaceView(): RaceView {
    return this.raceMode.getView();
  }
  getRaceProgress() {
    return this.raceMode.getProgress();
  }
  // --- end jdm-race ---
  // --- jdm-arena-games ---
  isBattleMode() {
    return this.currentMode === this.battleMode;
  }
  getBattleSettings(): BattleSettings {
    return this.battleMode.getSettings();
  }
  /** Squares, hit points, damage, arena, shrinking zone, power-ups and nudge of the battle; applied by the next `initBattle()`. */
  setBattleSettings(settings: Partial<BattleSettings>) {
    this.battleMode.setSettings(settings);
  }
  getBattleProgress() {
    return this.battleMode.getProgress();
  }
  isCtfMode() {
    return this.currentMode === this.ctfMode;
  }
  getCtfSettings(): CtfSettings {
    return this.ctfMode.getSettings();
  }
  /** Team size, score to win and nudge of Capture the Flag apply on the next `initCtf()`; the clip length (its time limit) at once. */
  setCtfSettings(settings: Partial<CtfSettings>) {
    this.ctfMode.setSettings(settings);
  }
  getCtfProgress() {
    return this.ctfMode.getProgress();
  }
  /** Live state of the arena game in play (squares, zone, power-ups, flags, scores, result) for the canvas; null in the other modes. */
  getArenaView(): ArenaView | null {
    if (this.currentMode === this.battleMode) return this.battleMode.getView();
    if (this.currentMode === this.ctfMode) return this.ctfMode.getView();
    return null;
  }
  // --- end jdm-arena-games ---
  // --- gerald-vortex ---
  isVortexMode() {
    return this.currentMode === this.vortexMode;
  }
  getVortexSettings(): VortexSettings {
    return this.vortexMode.getSettings();
  }
  /** Balls, stagger, rings, duration, pull and loop of the Sound Vortex apply on the next `initVortex()`; the depth cue, scale and root at once. */
  setVortexSettings(settings: Partial<VortexSettings>) {
    this.vortexMode.setSettings(settings);
  }
  /** Live Sound Vortex state (funnel, rings, balls, splashes, counters) for the canvas and the HUD; the same object every call. */
  getVortexView(): VortexView {
    return this.vortexMode.getView();
  }
  getVortexProgress() {
    return this.vortexMode.getProgress();
  }
  // --- end gerald-vortex ---
  // --- gerald-journey ---
  isJourneyMode() {
    return this.currentMode === this.journeyMode;
  }
  getJourneySettings(): JourneySettings {
    return this.journeyMode.getSettings();
  }
  /** The stage list and the auto count apply on the next `initJourney()`. */
  setJourneySettings(settings: Partial<JourneySettings>) {
    this.journeyMode.setSettings(settings);
  }
  /** Live Journey state (stages, active stage, camera, banner, progress, score, HOME) for the canvas and the HUD; the same object every call. */
  getJourneyView(): JourneyView {
    return this.journeyMode.getView();
  }
  getJourneyProgress() {
    return this.journeyMode.getProgress();
  }
  /**
   * Moves the world state the engine owns by (dx, dy) – balls and trails, particles, shockwaves, recent obstacle contacts –
   * for a mode with a floating origin (`ModeContext.shiftWorld()`); obstacles belong to the mode, which moves them itself.
   */
  private shiftWorld(dx: number, dy: number) {
    for (const b of this.balls) {
      b.x += dx;
      b.y += dy;
      for (const p of b.trail) {
        p.x += dx;
        p.y += dy;
      }
    }
    for (const p of this.particles) {
      p.x += dx;
      p.y += dy;
    }
    for (const w of this.shockwaves) {
      w.x += dx;
      w.y += dy;
    }
    for (const h of this.obstacleHits) {
      h.x += dx;
      h.y += dy;
    }
  }
  // --- end gerald-journey ---
  // --- gerald-bullseye ---
  isBullseyeMode() {
    return this.currentMode === this.bullseyeMode;
  }
  getBullseyeSettings(): BullseyeSettings {
    return this.bullseyeMode.getSettings();
  }
  /** Shots, interval, chaos, rings, the moving target and the perfect shot apply on the next `initBullseye()`; the scale and root at once. */
  setBullseyeSettings(settings: Partial<BullseyeSettings>) {
    this.bullseyeMode.setSettings(settings);
  }
  /** Live Bullseye state (field, target, shots, scores, slow motion) for the canvas and the HUD; the same object every call. */
  getBullseyeView(): BullseyeView {
    return this.bullseyeMode.getView();
  }
  getBullseyeProgress() {
    return this.bullseyeMode.getProgress();
  }
  // --- end gerald-bullseye ---
  // --- beat-drop ---
  isBeatDropMode() {
    return this.currentMode === this.beatDropMode;
  }
  getBeatDropSettings(): BeatDropSettings {
    return this.beatDropMode.getSettings();
  }
  /** The mix, drift, scroll, bounce height, anticipation and beat apply on the next `initBeatDrop()`; sound, colours, trail, clip, scale and root at once. */
  setBeatDropSettings(settings: Partial<BeatDropSettings>) {
    this.beatDropMode.setSettings(settings);
  }
  /** Live Beat Drop state (the plan, the camera, landings, counters) for the canvas and the HUD; the same object every call. */
  getBeatDropView(): BeatDropView {
    return this.beatDropMode.getView();
  }
  getBeatDropProgress() {
    return this.beatDropMode.getProgress();
  }
  // --- end beat-drop ---
  // --- odd-territory ---
  isTerritoryMode() {
    return this.currentMode === this.territoryMode;
  }
  getTerritorySettings(): TerritorySettings {
    return this.territoryMode.getSettings();
  }
  /** The board, teams, balls, powers, interval, reach, countdown and pegs of Territory apply on the next `initTerritory()`; the badge and the HUD at once. */
  setTerritorySettings(settings: Partial<TerritorySettings>) {
    this.territoryMode.setSettings(settings);
  }
  /** Live Territory state (the tile map, counts, balls, flips, blasts, the verdict) for the canvas and the HUD; the same object every call. */
  getTerritoryView(): TerritoryView {
    return this.territoryMode.getView();
  }
  getTerritoryProgress() {
    return this.territoryMode.getProgress();
  }
  // --- end odd-territory ---
  // --- odd-maze ---
  isMazeMode() {
    return this.currentMode === this.mazeMode;
  }
  getMazeSettings(): MazeSettings {
    return this.mazeMode.getSettings();
  }
  /** Columns, balls, brain, hand and clip limit of the Maze apply on the next `initMaze()`; the pull, the speed and the drawing at once. */
  setMazeSettings(settings: Partial<MazeSettings>) {
    this.mazeMode.setSettings(settings);
  }
  /** Live Maze state (grid, field, runners, paint, hits, verdict) for the canvas and the HUD; the same object every call. */
  getMazeView(): MazeView {
    return this.mazeMode.getView();
  }
  getMazeProgress() {
    return this.mazeMode.getProgress();
  }
  // --- end odd-maze ---
  // --- gerald-conveyor ---
  isConveyorMode() {
    return this.currentMode === this.conveyorMode;
  }
  getConveyorSettings(): ConveyorSettings {
    return this.conveyorMode.getSettings();
  }
  /** The interval, the ball count, the arena, the freeze and the variety of the Conveyor Belt apply on the next `initConveyor()`; the scale and root at once. */
  setConveyorSettings(settings: Partial<ConveyorSettings>) {
    this.conveyorMode.setSettings(settings);
  }
  /** Live Conveyor Belt state (layout, belts, counters, frozen balls, the end) for the canvas and the HUD; the same object every call. */
  getConveyorView(): ConveyorView {
    return this.conveyorMode.getView();
  }
  getConveyorProgress() {
    return this.conveyorMode.getProgress();
  }
  /** Balls the respawn timer has dropped in this run (Classic, Multiply; `PhysicsConfig.respawnEvery`). */
  getRespawnCount(): number {
    return this.respawn.count;
  }
  // --- end gerald-conveyor ---
  /** Pegs, bars and straight walls in play (see obstacles.ts); the canvas draws them in the wall colour. */
  getObstacles() {
    return this.obstacles;
  }
  /** Obstacle contacts of the last second, for the canvas glow. */
  getObstacleHits() {
    return this.obstacleHits;
  }
  // --- obstacle-editor ---
  /** The creator's obstacles while they are in play (a ring mode with a non-empty layout), else null; the canvas draws and edits them. */
  getEditorObstacles(): ObstacleField | null {
    return this.editorObstaclesLive() ? this.editorObstacles : null;
  }
  private editorObstaclesLive(): boolean {
    return this.editorObstacles.count > 0 && supportsObstacles(this.currentMode?.name);
  }
  /**
   * Resolves `ball` against the creator's obstacles after it moved, before the ring walls (see `ObstacleField.collide()`).
   * The push-out ignores the rings, and the ring pass judges a ball's side of a ring by its centre: a push that carried
   * the centre across an intact ring would make that ring resolve the ball on the far side (a sealed ring would eject a
   * big Grow ball pressed onto a spinner). `keepRingSide()` moves such a ball back to the side it was on.
   */
  private handleEditorObstacles(ball: Ball, dtSec: number) {
    const scale = ball.mult ? this.extras.wallBounciness * effectiveBounce(ball, this.multipliers.bounceCap) : this.extras.wallBounciness; // --- unlimited --- (no cap with No limits on)
    const bounciness = ball.restitution ?? 1; // --- bounce-math --- the ball's bounciness (see handleObstacleCollisions())
    const lift = bounciness > 1 ? this.obstacleLiftSpeed(ball, scale, bounciness) : Infinity;
    const hitsBefore = this.editorObstacles.hitCount; // --- bounce-math ---
    const baseSpeed = this._config.ballSpeed || 400;
    // A ball pressed onto a bar by gravity meets it at about one sub-step of gravity: only clearly faster contacts are hits.
    const resting = (3 * this._config.gravity * baseSpeed * dtSec * (ball.gravityScale ?? 1)) / 300;
    const cx = this._config.width / 2;
    const cy = this._config.height / 2;
    const before = Math.hypot(ball.x - cx, ball.y - cy);
    this.editorObstacles.collide(ball, dtSec, scale, resting > OBSTACLE_HIT_SPEED ? resting : OBSTACLE_HIT_SPEED, baseSpeed, this._elapsedMs, this.pendingSoundEvents, bounciness, lift);
    if (this.bounceMath.on && this.editorObstacles.hitCount > hitsBefore) this.bounceMath.note(BM_BOUNCE, ball); // --- bounce-math ---
    if (this.circularWalls.length > 0) this.keepRingSide(ball, before, cx, cy);
  }

  /**
   * Undoes an obstacle push-out that carried the ball's centre across an intact ring: the ball goes back radially to
   * half a pixel on the side it was on (`before` = its distance from the centre before the push), so the ring pass
   * resolves it from there – against the innermost ring crossed on the way out, the outermost one on the way in. A
   * ring's side is judged by the radius the next ring pass judges it by (where a breathing wall was before its last
   * move). No random numbers, no allocation.
   */
  private keepRingSide(ball: Ball, before: number, cx: number, cy: number) {
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const after = Math.hypot(dx, dy);
    if (after === before || after === 0) return;
    const walls = this.circularWalls;
    const prev = this.wallPrevRadii;
    const outwards = after > before;
    let crossed = -1;
    for (let w = 0; w < walls.length; w++) {
      if (this.brokenWalls.has(w)) continue;
      const R = this.sweepWalls && w < prev.length ? prev[w] : walls[w].radius;
      if (outwards ? before < R && R <= after && (crossed < 0 || R < crossed) : before > R && R >= after && R > crossed) crossed = R;
    }
    if (crossed < 0) return;
    const k = (outwards ? crossed - 0.5 : crossed + 0.5) / after;
    ball.x = cx + dx * k;
    ball.y = cy + dy * k;
  }

  /** The balls the ring-side guard follows through a sub-step's pair pass and mode pushes, and their squared distances before (reused). */
  private sideBalls: Ball[] = [];
  private sideDists = new Float64Array(0);

  /** Notes every ball and its squared distance from the centre (before the pair pass); returns how many. No allocation once grown. */
  private recordRingSides(cx: number, cy: number): number {
    const balls = this.balls;
    if (this.sideDists.length < balls.length) this.sideDists = new Float64Array(Math.max(2 * this.sideDists.length, balls.length, 8));
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      this.sideBalls[i] = ball;
      this.sideDists[i] = dx * dx + dy * dy;
    }
    return balls.length;
  }

  /**
   * Every noted ball that a push carried across an intact ring goes back radially to the distance it had before the push
   * (keeping its new direction from the centre), so it stays on its side: the next wall pass resolves it from there – a
   * rebound, or a pass when it is in a gap. A push that crossed no ring changes nothing. A ball merged away is no longer in
   * play: moving it is harmless. No allocation.
   */
  private restoreRingSides(count: number, cx: number, cy: number) {
    const walls = this.circularWalls;
    for (let k = 0; k < count; k++) {
      const ball = this.sideBalls[k];
      const beforeSq = this.sideDists[k];
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const afterSq = dx * dx + dy * dy;
      if (afterSq === beforeSq || afterSq === 0) continue; // (most balls: the pass did not move them)
      let crossed = false;
      for (let w = 0; w < walls.length && !crossed; w++) {
        if (this.brokenWalls.has(w)) continue;
        const R2 = walls[w].radius * walls[w].radius;
        crossed = beforeSq < R2 ? R2 <= afterSq : afterSq < R2;
      }
      // (a ball the rings do not resolve – Multiply's escaped ones – goes where it was pushed)
      if (!crossed || this.currentMode?.shouldSkipWallCollision(ball)) continue;
      const scale = Math.sqrt(beforeSq / afterSq);
      ball.x = cx + dx * scale;
      ball.y = cy + dy * scale;
    }
  }
  // --- end obstacle-editor ---
  // --- gerald-exit-splat ---
  /** The moving exits as the canvas draws them (flashes, closing, fleeing; the same object every call). */
  getExitView(): ExitView {
    return this.exits.getView();
  }
  /** The splat barrier: its splats (oldest first) and counters, for the canvas and tests. */
  getSplats(): SplatField {
    return this.splats;
  }
  /** A wall hit of `ball` on ring `w` at world angle `angle` leaves a splat (Grow's in the Ball Size: its ball grows to fill the ring). */
  private addSplat(ball: Ball, w: number, angle: number, wall: CircularWall, rotation: number, approach: number) {
    const size = this.currentMode === this.growMode ? this._config.ballRadius || 8 : ball.radius;
    this.splats.add(w, angle, wall.radius, rotation, size, ball.color, approach / (this._config.ballSpeed || 400), this._elapsedMs, wall.gaps, this.pendingSoundEvents);
  }
  /**
   * Resolves `ball` against the standing splats beside it (splats.ts), like the editor's obstacles: the restitution scale,
   * the ball's bounciness, a hit's sound (its ring's tone) and bounce math's bounce; a push that carried the ball's centre
   * across an intact ring is undone (`keepRingSide()`).
   */
  private handleSplats(ball: Ball, dtSec: number) {
    const scale = ball.mult ? this.extras.wallBounciness * effectiveBounce(ball, this.multipliers.bounceCap) : this.extras.wallBounciness;
    const bounciness = ball.restitution ?? 1;
    const lift = bounciness > 1 ? this.obstacleLiftSpeed(ball, scale, bounciness) : Infinity;
    // A ball pressed onto a splat by gravity meets it at about one sub-step of gravity: only clearly faster contacts are hits.
    const resting = (3 * this._config.gravity * (this._config.ballSpeed || 400) * dtSec * (ball.gravityScale ?? 1)) / 300;
    const cx = this._config.width / 2;
    const cy = this._config.height / 2;
    const before = Math.hypot(ball.x - cx, ball.y - cy);
    const hitsBefore = this.splats.hits;
    const ring = this.splats.collide(ball, dtSec, cx, cy, scale, resting > OBSTACLE_HIT_SPEED ? resting : OBSTACLE_HIT_SPEED, this._elapsedMs, bounciness, lift);
    if (ring >= 0) this.pendingSoundEvents.push(bounceHitEvent(ring, ball));
    if (this.bounceMath.on && this.splats.hits > hitsBefore) this.bounceMath.note(BM_BOUNCE, ball);
    if (this.circularWalls.length > 0) this.keepRingSide(ball, before, cx, cy);
  }
  // --- end gerald-exit-splat ---
  getElapsedMs() {
    return this._elapsedMs;
  }
  isSimulationFinished() {
    if (this.multipliers.isOutgrown()) return true; // --- gerald-multipliers --- a ball outgrew the arena
    return this.currentMode?.isFinished(this.ctx) ?? false;
  }
  getPersonalityState() {
    return this.cinematicDirector.getPersonalityState();
  }
  getDramaTension() {
    return this.cinematicDirector.getTension();
  }
  setCinematicEnabled(enabled: boolean) {
    this.cinematicDirector.setEnabled(enabled);
  }
  isCinematicEnabled() {
    return this.cinematicDirector.isEnabled();
  }
  /** The sound events queued since the last call (the Simulator calls it once per rendered frame). */
  consumeSoundEvents(): SoundEvent[] {
    // A mode with a per-frame sound budget queues the sounds it kept across this frame's steps now.
    this.currentMode?.flushPendingSounds?.(this.ctx);
    const events = this.pendingSoundEvents;
    this.pendingSoundEvents = [];
    return this.limits.on ? this.limits.thinSounds(events) : events; // --- unlimited --- (at most MAX_SOUNDS_PER_FRAME a frame)
  }
  // --- camera ---
  /** Wall breaks so far (every "gap" event; never reset): the cinematic camera shakes when it grows. Reading it changes nothing. */
  getWallBreakSerial() {
    return this.wallBreakSerial;
  }
  /** The director's near-miss event: near misses so far (counted with the director on or off; never reset). The camera slows the clock when it grows. */
  getNearMissSerial() {
    return this.cinematicDirector.getNearMissSerial();
  }
  // --- end camera ---
  // --- rigged ---
  /** The rigged outcomes in effect (never escape, the forced winner) and their counters, plus the run's first escape; the same object every call. */
  getRigView(): RigView {
    this.cinematicDirector.rig.refreshRules(this.currentMode?.name, this._config, this.circularWalls.length);
    return this.cinematicDirector.rig.getView();
  }
  /** Simulation time (ms) of the run's first escape – a ball beyond the outermost wall – or −1 while there was none (tracked whether the rig is on or off). */
  getFirstEscapeMs(): number {
    return this.cinematicDirector.rig.getFirstEscapeMs();
  }
  /**
   * `ball` is inside wall `w` – or was at the start of the step (`heldAtStart()`: a fast ball may be past it within one
   * sub-step) – and the rig keeps that wall closed to it.
   */
  private rigSeals(ball: Ball, w: number): boolean {
    const wall = this.circularWalls[w];
    if (!wall) return false;
    const rig = this.cinematicDirector.rig;
    if (!rig.closes(ball, w)) return false;
    const dx = ball.x - this._config.width / 2;
    const dy = ball.y - this._config.height / 2;
    return dx * dx + dy * dy < wall.radius * wall.radius || rig.heldAtStart(ball, w);
  }
  // --- end rigged ---
  /** The physics extras in effect (defaults filled in, values clamped to their ranges). */
  getPhysicsExtras(): PhysicsExtras {
    return this.extras;
  }
  /** Wall radii without the breathing pulse (equal to `wall.radius` while breathing is off). */
  getWallBaseRadii() {
    return this.wallBaseRadii;
  }
  /** The ball interaction in effect (defaults filled in, split limits clamped to their ranges). */
  getBallInteraction(): BallInteractionConfig {
    return this.interaction;
  }

  // --- unlimited ---
  /**
   * Reads the No limits switch from the config: with it on the core values run at their soft ceilings, the physics
   * extras and split limits go past their ranges, the multiplier cap is off and a bounce multiplier scales without a cap.
   */
  private applyLimits() {
    this.limits.configure(this._config);
    if (this.limits.on) {
      this._config = this.limits.ceilPatch(this._config, this._config);
      this.limits.liftPhysics(this.extras, this.interaction, this._config);
      this.breathing = this.extras.breathingAmplitude > 0;
      // (--- uncap-all --- the multipliers keep the creator's own cap choice: `mpUnlimited` is on by default, uncapped)
      // Rings built from a count past the ceiling before the switch arrived: rebuilt at the ceiling.
      if (this.circularWalls.length > LIVE_WALL_LIMIT) {
        this.restoreWallRadii();
        if (!this.currentMode?.onConfigChange(this.ctx, false, true, false)) this.initializeCircularWalls();
        this.syncWallBaseRadii();
        this.brokenWalls.clear();
      }
    }
    this.multipliers.bounceCap = Infinity; // --- uncap-all --- a bounce multiplier scales every rebound without a ceiling, whatever the switch
  }
  /** What the canvas shows of a No limits run: the crowd, ARENA FULL, the ate-the-arena finish. */
  getUnlimitedView(): UnlimitedView {
    return this.limits.getView(this.balls.length);
  }
  /** The crowd's typed arrays (read-only for the renderer). */
  getCrowd(): Readonly<Crowd> {
    return this.limits.crowd;
  }
  // --- end unlimited ---

  // ---------------------------------------------------------------- balls

  addBall(ball: NewBall) {
    this.balls.push({ ...ball, id: this.nextId++, trail: [], trailIndex: 0, spin: 0, angle: 0 });
  }
  removeBall(id: number) {
    this.balls = this.balls.filter((b) => b.id !== id);
  }
  clear() {
    this.finishedAtMs = -1; // --- split-screen ---
    this.balls = [];
    this.nextId = 0;
    this.brokenWalls.clear();
    this.lastWallLayer.clear();
    this.timeAccumulator = 0;
    this.particles = [];
    this.shockwaves = [];
    this.wallBreakFlashes = [];
    this.wallHits = [];
    this.pendingSoundEvents = [];
    this.pendingSplits = [];
    this.breathScale = 1;
    this.gravityAngleRad = Math.PI / 2;
    this.setObstacles([]);
    this.multipliers.reset(); // --- gerald-multipliers ---
    this.ballStats.reset(); // --- teams ---
    this.editorObstacles.reset(); // --- obstacle-editor --- spinners back to their start angle
    this.resetBounceMath(); // --- bounce-math --- the page's gravity, spin and gap back; the rules count from zero
    // --- timeline --- every run starts from the keyframes' values at 0 s (before its rings and balls are built). The clock
    // goes back to 0 first: a keyframed value that differs at 0 s goes through setConfig(), whose breathing pulse is taken
    // at the current time – at the old run's clock it would leave a stale pulse scale that the new rings' base radii are
    // then divided by (syncWallBaseRadii()), and a restarted or replayed run would play on different rings.
    this._elapsedMs = 0;
    this.applyTimeline(0);
    this.wallContacts.clear(); // --- jdm-illusions --- a new run: the wobbly walls start still
    this.onBeat.reset(); // --- video-beats --- a new run: no flight plans, fresh hit statistics
    this.limits.reset(); // --- unlimited --- a new run: its crowd appears at the first step
    this.respawn.reset(); // --- gerald-conveyor --- a new run: the respawns count from zero
    // --- gerald-exit-splat --- a new run: no moves, no flashes, no splats
    this.exits.reset();
    this.splats.reset();
  }

  private setObstacles(obstacles: Obstacle[]) {
    this.obstacles = obstacles;
    this.obstaclesSpin = hasSpinningObstacles(obstacles);
    this.obstacleHits = [];
  }

  setConfig(patch: Partial<PhysicsConfig>) {
    patch = withLiveRingCount(patch); // --- review fix (security-robustness) --- (soft ring ceiling, softCeilings.ts)
    // --- bounce-math --- the page re-sending its own value of a world setting a rule holds (another setting of the same effect
    // changed) leaves the rule's value; a new value from the page replaces it
    if (!this.timelineApplying && this.bounceMath.worldTouched()) patch = this.bounceMath.filterPatch(patch);
    // --- timeline --- keyframed settings keep following their keyframes; the rest of the patch applies as always
    if (!this.timelineApplying && (patch.timeline !== undefined || this.timeline.active)) return this.setConfigWithTimeline(patch);
    patch = this.limits.ceilPatch(patch, this._config); // --- unlimited --- (the values the engine runs: soft ceilings with No limits on)
    const oldPass = this.ringPassRadius();
    const oldW = this._config.width;
    const oldH = this._config.height;
    const oldWallCount = this._config.wallCount;
    const oldGap = this._config.gapSize;
    this._config = { ...this._config, ...patch };
    // --- bounce-math --- new rules or a new beat grid; a value the patch sets for a world setting a rule holds becomes its page value
    if (patch.bounceMath !== undefined) this.bounceMath.configure(this._config.bounceMath, this._elapsedMs);
    this.bounceMath.notePatch(patch);
    // --- end bounce-math ---
    this.extras = resolvePhysicsExtras(this._config);
    this.breathing = this.extras.breathingAmplitude > 0;
    this.interaction = resolveBallInteraction(this._config);
    this.multipliers.setConfig(this._config); // --- gerald-multipliers ---
    this.editorObstacles.configure(this._config); // --- obstacle-editor --- (rebuilt only when the list or the canvas size changed)
    this.applyLimits(); // --- unlimited ---
    // --- gerald-exit-splat --- the exit behaviour and the splat barrier (a new world size scales the splats with the rings)
    this.exits.configure(this._config);
    this.splats.configure(this._config);
    // --- teams --- the other starting balls (and their offspring) keep the colour of their slot
    if (patch.ballColor !== undefined) for (const b of this.balls) if (!b.team) b.color = patch.ballColor;
    if (patch.ballColor2 !== undefined) for (const b of this.balls) if (b.team === 1) b.color = patch.ballColor2;
    // Balls with a size spread (Ball Drop) keep their ratio to the configured radius; the others take it as is.
    if (patch.ballRadius !== undefined) for (const b of this.balls) b.radius = patch.ballRadius * (b.radiusScale ?? 1);
    const sizeChanged =
      (patch.width !== undefined && patch.width !== oldW) || (patch.height !== undefined && patch.height !== oldH);
    if (sizeChanged && oldW > 0 && oldH > 0) {
      // The rings scale with the canvas's smaller side: in the ring modes every ball (and Accumulation's frozen balls, Lines'
      // points) scales by that same factor about the centre, so it keeps its side of every ring; the other modes follow the
      // canvas's own axes (those that map their own world – Journey, even in a rings stage – undo that per-axis stretch).
      const k = Math.min(this._config.width, this._config.height) / Math.min(oldW, oldH);
      const rings = this.circularWalls.length > 0 && supportsObstacles(this.currentMode?.name); // (the ring modes' list)
      const sx = rings ? k : this._config.width / oldW;
      const sy = rings ? k : this._config.height / oldH;
      const oldCx = oldW / 2;
      const oldCy = oldH / 2;
      const cx = this._config.width / 2;
      const cy = this._config.height / 2;
      for (const b of this.balls) {
        b.x = cx + (b.x - oldCx) * sx;
        b.y = cy + (b.y - oldCy) * sy;
        b.trail = [];
      }
      if (this.currentMode === this.accumulationMode) this.accumulationMode.repositionFrozenBalls(sx, sy, oldCx, oldCy, cx, cy);
      if (this.currentMode === this.linesMode) this.linesMode.repositionPoints(sx, sy, oldCx, oldCy, cx, cy);
    }
    const wallCountChanged = patch.wallCount !== undefined && patch.wallCount !== oldWallCount;
    const gapChanged = patch.gapSize !== undefined && patch.gapSize !== oldGap;
    if (sizeChanged || wallCountChanged || gapChanged) {
      // Modes rebuild or rescale the walls from their base radii, never from a breathing pulse.
      this.restoreWallRadii();
      const walls = this.circularWalls;
      const handled = this.currentMode?.onConfigChange(this.ctx, sizeChanged, wallCountChanged, gapChanged);
      if (!handled) {
        // The classic rings: a new wall count builds them anew; a new canvas size (a window resize) or gap size changes
        // them in place – the radii a fresh build would give, the gaps resized – so the run goes on with its broken rings.
        if (wallCountChanged) this.initializeCircularWalls();
        else {
          if (sizeChanged) this.resizeCircularWalls();
          this.refitGaps();
        }
      }
      this.syncWallBaseRadii();
      // Broken rings stay broken, unless a new wall count built the rings anew.
      if (wallCountChanged && this.circularWalls !== walls) this.brokenWalls.clear();
    } else if (this.ringPassRadius() !== oldPass) {
      this.refitGaps(); // a bigger (or merged) ball: a gap it can no longer pass is widened, in place
    }
    // Re-applies the pulse to the current walls, or restores the base radii when breathing was just switched off – but
    // not while update() applies a step's keyframes: the step's first sub-step moves the walls then, and sweeps the move.
    if (!this.deferBreathing) this.applyBreathing();
  }

  // --- timeline ---
  /**
   * `setConfig()` while keyframes are in play or arrive (`patch.timeline`): `TimelineRuntime.prepare()` keeps the
   * automated settings at their keyframed values (the page's values wait as their bases), gives a setting whose keyframes
   * are gone its base back, and new keyframes apply at once, at the current simulation time.
   */
  private setConfigWithTimeline(patch: Partial<PhysicsConfig>) {
    const { rest, gap, retimed } = this.timeline.prepare(patch, this._config);
    this.timelineApplying = true;
    try {
      this.setConfig(rest);
      if (gap !== null) this.setTimelineGap(gap);
    } finally {
      this.timelineApplying = false;
    }
    if (retimed) this.applyTimeline(this._elapsedMs);
  }

  /** Applies the keyframed values at simulation time `tMs` (the start of a fixed step, or 0 when a run starts). Allocates only when a value changes. */
  private applyTimeline(tMs: number) {
    if (!this.timeline.active) return;
    const t = tMs / 1000;
    const patch = this.timeline.patchAt(t, this._config);
    const gap = this.timeline.gapAt(t, this._config);
    if (!patch && gap === null) return;
    this.timelineApplying = true;
    try {
      if (patch) this.setConfig(patch);
      if (gap !== null) this.setTimelineGap(gap);
    } finally {
      this.timelineApplying = false;
    }
  }

  /** A keyframed gap size: the config takes it and the rings' gaps resize in place – no rebuild, so broken rings stay broken (see `resizeGaps()`). */
  private setTimelineGap(gap: number) {
    this._config = { ...this._config, gapSize: gap };
    resizeGaps(this.circularWalls, gap, this.currentMode?.name, this.ringPassRadius());
  }

  /** The gap-sized rings' gaps at the configured gap size, widened where the biggest ball could not pass (`resizeGaps()`); in place. */
  private refitGaps() {
    resizeGaps(this.circularWalls, this._config.gapSize || 0.3, this.currentMode?.name, this.ringPassRadius());
  }

  /** The biggest ball the rings must let through (the Ball Size, or all starting balls merged): see `ringPassRadius()`. */
  private ringPassRadius(): number {
    const r = this._config.ballRadius || 8;
    return this.interaction.ballInteraction === "merge" ? r * Math.sqrt(startBallCount(this._config, this.currentMode?.name ?? "classic")) : r;
  }

  /** Whether the keyframes drive `key` (its config value is then the keyframed one; the page's own waits as its base). */
  isTimelineAutomated(key: TimelineKey): boolean {
    return this.timeline.isAutomated(key);
  }

  /**
   * The phase a keyframed rate setting has reached at the current simulation time – its keyframes integrated since 0 s
   * (degrees gravity has turned for `rotatingGravity`, pulses for `breathingSpeed`), which the engine uses instead of
   * rate × t – or NaN while `key` is not a keyframed rate setting.
   */
  getTimelinePhase(key: TimelineKey): number {
    return this.timeline.active ? this.timeline.integralAt(key, this._elapsedMs / 1000) : NaN;
  }
  // --- end timeline ---

  // --- bounce-math ---
  /** A rule's gravity or ring spin speed goes into the config; a gap size resizes the rings' gaps in place (like a keyframed gap). */
  private setBounceMathWorld(key: "gravity" | "rotationSpeed" | "gapSize", value: number) {
    if (key === "gapSize") this.setTimelineGap(value);
    else this._config = { ...this._config, [key]: value };
  }

  /** A new run: the page's values of the world settings the rules changed come back, and the rules start counting again. */
  private resetBounceMath() {
    const base = this.bounceMath.takeWorldBase();
    if (base) this._config = { ...this._config, ...base };
    this.bounceMath.reset();
  }

  /** What bounce math shows: the values of the ball that bounced last, the gravity, each rule's fire count (the same object every call). */
  getBounceMathView(): BounceMathView {
    return this.bounceMath.getView();
  }

  getBounceMathRuntime(): BounceMathRuntime {
    return this.bounceMath;
  }

  /**
   * The ball's bounciness on a mirror reflection a mode without rings made itself, keeping the speed (Bouncing Shapes'
   * walls: every shape at its own speed): the speed takes the change of the bounciness since the ball's last such rebound,
   * so it carries the bounciness exactly once – its own speed × the bounciness, like the engine's ring rebounds – and never
   * compounds.
   */
  private scaleModeRebound(ball: Ball) {
    const k = this.bounceMath.modeReboundFactor(ball);
    if (k === 1 || !Number.isFinite(k)) return;
    ball.vx *= k;
    ball.vy *= k;
  }

  /**
   * The most a bounciness above 1 may lift an obstacle rebound to (obstacles.ts `rebound()`): the ball's cruising speed ×
   * the restitution scale × the bounciness – what a ring rebound sets – so a ball bouncing between pegs settles there
   * instead of gaining speed hit after hit (`reboundSpeedBound()` plans the sub-steps for it).
   */
  private obstacleLiftSpeed(ball: Ball, scale: number, bounciness: number): number {
    return cruiseSpeed(ball, this._config.ballSpeed || 400) * scale * bounciness;
  }
  // --- end bounce-math ---

  /** Direction (radians, screen coordinates: π/2 = straight down) of the gravity in the last step – rotating gravity turns it. */
  getGravityAngle(): number {
    return this.gravityAngleRad;
  }

  // ---------------------------------------------------------------- breathing walls

  /**
   * Records the unpulsed radius of every wall; call after every (re)assignment of `circularWalls`.
   * Freshly assigned walls have not swept anywhere yet, so their previous radius is their current one.
   */
  private syncWallBaseRadii() {
    const scale = this.breathScale;
    this.wallBaseRadii = this.circularWalls.map((w) => w.radius / scale);
    this.wallPrevRadii = this.circularWalls.map((w) => w.radius);
  }

  /**
   * Sets every wall radius to base × the breathing multiplier at simulation time `tMs` (the current
   * time by default) and remembers where each wall was, so the next collision pass can sweep it.
   * --- timeline --- A keyframed pulse speed has its phase integrated (`TimelineRuntime.integralAt()`: the cycles since
   * 0 s) instead of speed × t, which would run the pulse at speed + t · speed′ and jump with every step's new speed.
   */
  private applyBreathing(tMs = this._elapsedMs) {
    const amplitude = this.extras.breathingAmplitude;
    if (amplitude === 0 && this.breathScale === 1) return;
    const walls = this.circularWalls;
    if (this.wallBaseRadii.length !== walls.length) this.syncWallBaseRadii();
    const cycles = this.timeline.active ? this.timeline.integralAt("breathingSpeed", tMs / 1000) : NaN;
    const pulse = Number.isNaN(cycles) ? breathingScale(amplitude, this.extras.breathingSpeed, tMs / 1000) : breathingScaleAtPhase(amplitude, cycles);
    // --- uncap-all --- breathing past ±100 % shrinks a ring to a point, never to a negative radius (a ring has none)
    const scale = pulse > 0 ? pulse : 0;
    const prev = this.wallPrevRadii;
    for (let i = 0; i < walls.length; i++) {
      prev[i] = walls[i].radius;
      walls[i].radius = this.wallBaseRadii[i] * scale;
    }
    this.breathScale = scale;
  }

  /** Puts the walls back at their base radii (no-op while no pulse is applied). */
  private restoreWallRadii() {
    if (this.breathScale === 1) return;
    const n = Math.min(this.circularWalls.length, this.wallBaseRadii.length);
    for (let i = 0; i < n; i++) {
      this.circularWalls[i].radius = this.wallBaseRadii[i];
      this.wallPrevRadii[i] = this.wallBaseRadii[i];
    }
    this.breathScale = 1;
  }

  /** Angular speed of wall `index` in rad/s (even walls turn one way, odd walls the other). */
  private wallRotationRate(index: number) {
    if (this.exitsHoldRings) return 0; // --- gerald-exit-splat --- moving exits hold their rings still (the exits move by themselves)
    const speed = (this._config.rotationSpeed ?? 1) * 0.8;
    return index % 2 === 0 ? speed : -speed;
  }

  // ---------------------------------------------------------------- simulation step

  /**
   * Advances the simulation. `frameMs` is wall-clock time (capped), split into fixed 60 Hz
   * steps, each with 4+ sub-steps for stable collisions. `audioIntensity` (0..1) slightly
   * boosts gravity for a music-reactive feel.
   */
  update(frameMs: number, audioIntensity = 0) {
    const dt = Math.min(frameMs, 128);
    // --- gerald-multipliers --- a ball outgrew the arena: the run is over, only the confetti keeps flying
    const mult = this.multipliers;
    if (mult.isOutgrown()) {
      this.updateParticles(frameMs / 1000);
      return;
    }
    const modeName = this.currentMode?.name;
    mult.setMode(modeName);
    // --- end gerald-multipliers ---
    this.timeAccumulator += dt;
    let extras = this.extras; // --- timeline --- (re-read below after keyframes move an extra)
    const bmOn = this.bounceMath.on; // --- bounce-math ---
    while (this.timeAccumulator >= this.FIXED_STEP_MS) {
      this.timeAccumulator -= this.FIXED_STEP_MS;
      // --- timeline --- the keyframed settings at the start of this step, on the simulation clock (so the frame rate never
      // matters); a breathing change they make moves the walls in the first sub-step below, where the move is swept
      if (this.timeline.active) {
        this.deferBreathing = true;
        try {
          this.applyTimeline(this._elapsedMs);
        } finally {
          this.deferBreathing = false;
        }
        extras = this.extras;
      }
      if (bmOn) this.bounceMath.beginStep(this._elapsedMs, this.pendingSoundEvents.length); // --- bounce-math --- ("start" fires at a run's first step)
      // --- gerald-multipliers --- with multipliers in play the step is planned so no ball moves more than half its
      // radius (≤ 4 px) per sub-step; past 64 sub-steps the step itself shrinks (time dilation, SLOW-MO in the HUD).
      // Without multipliers `plan` is null and the step is exactly the fixed step, as before.
      const multActive = mult.isActive(modeName);
      const clock = this.bounceMath.clockScale(modeName); // --- bounce-math --- the "timeScale" parameter: simulated time per step (1 without one)
      // --- unlimited --- with No limits on every step is planned (bounded sub-steps, time dilation beyond) and a new run's crowd appears
      // --- uncap-all --- engaged by the config or by the run: rebounds a Bounciness grew past the old Bouncier's ×3 are
      // planned like every extreme run (sub-steps up to 64, time dilation beyond – the run slows down, never clamps)
      const limitsOn = this.limits.engage(this.bouncierEnabled && this.bounceSpeedMultiplier > BOUNCIER_CLASSIC_MAX);
      // --- review fix (uncap-all) --- the obstacle editor caps no kick and no fling any more: from its first one past what it
      // ever gave before (`ObstacleField.pastClassicLimit`; a run that never gets there replays exactly as before) every step
      // of the run is planned, its next kick and the spinners' surface speed included – sub-steps up to 64, time dilation beyond
      const editorFast = this.editorObstacles.pastClassicLimit && this.editorObstaclesLive();
      // --- review fix (uncap-all) --- a mode that moves its balls itself past what it used to clamp them to reports how fast
      // they may get this step (`GameMode.stepSpeedBound()`): the step is planned for it instead of the speed being clamped
      const modeSpeedBound = this.currentMode?.stepSpeedBound?.(this.ctx, (this.FIXED_STEP_MS * clock) / 1000) ?? 0;
      beginPairStep(limitsOn ? PAIR_STEP_BUDGET : Infinity); // --- uncap-all --- (an extreme step's pair checks are budgeted; a normal one never meets it)
      if (limitsOn) this.limits.beginStep(this.ctx, mult, this.limitsHost, 6);
      if (limitsOn && mult.isOutgrown()) break; // the ball ate the arena before the step began: the run is over
      const plan =
        multActive || limitsOn || editorFast || modeSpeedBound > 0
          ? mult.planStep(
              this.balls,
              (this.FIXED_STEP_MS * clock) / 1000,
              this.gravityAccel(audioIntensity),
              modeSpeedBound > 0 ? Math.max(this.reboundSpeedBound(), modeSpeedBound) : this.reboundSpeedBound(),
              editorFast ? this.editorObstacles.kickFactor(this.extras.wallBounciness) : 1,
              editorFast ? 2 * this.editorObstacles.flingSpeed : 0,
            )
          : null;
      if (limitsOn && plan) this.limits.boundPlan(plan, this.balls.length, this.circularWalls.length); // --- unlimited --- (thousands of fast balls, a thousand rings: a bounded step)
      const stepMs = (plan ? this.FIXED_STEP_MS * plan.dilation : this.FIXED_STEP_MS) * clock;
      if (plan && clock !== 1) mult.getView().dilation = plan.dilation * clock; // --- bounce-math --- (SLOW-MO only while the world really runs slow)
      this._elapsedMs += stepMs;
      const orbsLive = multActive && mult.pickupsLive(modeName);
      // --- end gerald-multipliers ---
      // --- gerald-exit-splat --- moving exits hold the rings still (they move by themselves, every sub-step below); splats this step
      const exitsLive = this.exits.beginStep(this.ctx, modeName);
      this.exitsHoldRings = exitsLive;
      this.splatsLive = this.splats.beginStep(modeName);
      // --- end gerald-exit-splat ---
      while (this.wallRotations.length < this.circularWalls.length) this.wallRotations.push(0);
      const stepSec = stepMs / 1000;
      for (let i = 0; i < this.circularWalls.length; i++) {
        this.wallRotations[i] += this.wallRotationRate(i) * stepSec;
        if (Math.abs(this.wallRotations[i]) > TWO_PI) this.wallRotations[i] = this.wallRotations[i] % TWO_PI;
      }
      if (this.infiniteMode) {
        this.infiniteTimer += stepMs;
        if (this.infiniteTimer > 1000) {
          this.infiniteTimer = 0;
          if (this.balls.length < 200) {
            const a = this.random() * Math.PI * 2;
            const speed = 150 + 150 * this.random();
            this.addBall({
              x: this._config.width / 2,
              y: this._config.height / 2,
              vx: Math.cos(a) * speed,
              vy: Math.sin(a) * speed,
              radius: (this._config.ballRadius || 8) + 12 * this.random(),
              color: this.getRandomColor(),
            });
          }
        }
      }
      this.cinematicDirector.update(stepMs);
      this.currentMode?.onPreUpdate(this.ctx, stepMs);
      this.respawn.step(this.ctx, modeName, this._elapsedMs); // --- gerald-conveyor --- (a no-op unless `respawnEvery` is set in Classic / Multiply)
      if (orbsLive) mult.stepPickups(this.ctx, stepMs); // --- gerald-multipliers --- spawn, drift and fade the pickup orbs

      // Physics extras: air drag acts once per 60 Hz step; the gravity direction, wind and spin
      // terms are constant within the step and applied per sub-step below. Each is skipped at
      // its default so a run without extras takes exactly the original code path.
      const airDrag = bmOn ? this.bounceMath.airDrag(extras.airDrag) : extras.airDrag; // --- bounce-math --- (the "damping" parameter)
      if (airDrag > 0) {
        const keep = Math.max(0, 1 - airDrag); // --- uncap-all --- a drag of 1 or more stops the balls each step (never reverses them)
        for (const ball of this.balls) {
          ball.vx *= keep;
          ball.vy *= keep;
        }
      }
      // --- timeline --- a keyframed turning rate turns gravity by its integral since 0 s (degrees turned so far): rate × t
      // would turn it at rate + t · rate′ – backwards while the rate falls – and jump with every step's new rate
      const turnedDeg = this.timeline.active ? this.timeline.integralAt("rotatingGravity", this._elapsedMs / 1000) : NaN;
      const gravityKeyframed = !Number.isNaN(turnedDeg);
      const rotatingGravity = gravityKeyframed ? turnedDeg !== 0 : extras.rotatingGravity !== 0;
      const gAngle = !rotatingGravity ? 0 : gravityKeyframed ? gravityAngleTurned(turnedDeg) : gravityAngle(extras.rotatingGravity, this._elapsedMs / 1000);
      this.gravityAngleRad = rotatingGravity ? gAngle : Math.PI / 2;
      const gDirX = rotatingGravity ? Math.cos(gAngle) : 0;
      const gDirY = rotatingGravity ? Math.sin(gAngle) : 1;
      const wind = extras.windX !== 0 || extras.windY !== 0;
      const spinning = extras.spinStrength > 0;
      const magnus = extras.spinStrength * MAGNUS_COEFFICIENT;
      // The ring modes keep every ball at least at its base speed; a mode whose balls may rest (Ball Drop) opts out.
      const keepMoving = !this.currentMode?.ballsMayRest;
      const hasObstacles = this.obstacles.length > 0;
      // --- rigged --- the director's hard constraints for this step (never escape, forced winner); both off = the plain path
      // (--- gerald-exit-splat --- with moving exits the rings hold still this step: the rig predicts them standing)
      this.rigOn = this.cinematicDirector.rig.beginStep(modeName, this._config, extras, this.circularWalls, this.wallRotations, this.brokenWalls, this.gravityAccel(audioIntensity), gDirX, gDirY, keepMoving, this._elapsedMs, this.exitsHoldRings);
      if (this.rigOn) {
        for (let i = 0; i < this.balls.length; i++) this.cinematicDirector.rig.guide(this.balls[i]); // mid-flight guidance
        this.cinematicDirector.rig.markInside(this.balls); // the backstop below keeps these balls in
      }

      // (--- uncap-all --- up to the old Bouncier's ×3 the sub-steps it always had – old runs replay exactly –; past it the
      // planned step above takes over: `plan.subSteps` and the time dilation, never an unbounded sub-step count)
      const bouncierSubMult = this.bounceSpeedMultiplier > BOUNCIER_CLASSIC_MAX ? BOUNCIER_CLASSIC_MAX : this.bounceSpeedMultiplier;
      let subSteps = this.bouncierEnabled && this.bounceSpeedMultiplier > 1.5 ? Math.ceil(4 * bouncierSubMult) : 4;
      if (plan && plan.subSteps > subSteps) subSteps = plan.subSteps; // --- gerald-multipliers ---
      const subMs = stepMs / subSteps;
      const subSec = subMs / 1000;
      const spinDecay = spinning ? spinDecayFactor(subSec) : 1;
      const stepStartMs = this._elapsedMs - stepMs;
      if (hasObstacles) this.subStepGravity = (this._config.gravity * (this._config.ballSpeed || 400) * subSec) / 300;
      // --- obstacle-editor --- the creator's obstacles (ring modes only)
      const editorLive = this.editorObstaclesLive();
      if (editorLive) this.editorObstacles.beginStep();
      // The ring pass judges a ball that its own move carried across a ring by where it was before the move
      // (processWallCollisions(): each ball's squared distance from this centre is noted before it moves)
      const ringCx = this._config.width / 2;
      const ringCy = this._config.height / 2;
      for (let s = 0; s < subSteps; s++) {
        // Breathing walls move once per sub-step (a quarter of the per-step jump or less) and the collision
        // pass below sweeps each wall over that move, so even the fastest, widest pulse cannot step over a
        // ball. The last sub-step lands exactly on the step's end time, so the radii a frame renders (and
        // `setConfig()` recomputes) are the same values the per-step pulse produced. (--- timeline --- The walls also
        // move – back to their base radii – in the sub-step after a keyframe switched the breathing off.)
        this.sweepWalls = this.breathing || this.breathScale !== 1;
        if (this.sweepWalls) this.applyBreathing(s === subSteps - 1 ? this._elapsedMs : stepStartMs + (s + 1) * subMs);
        if (this.obstaclesSpin) advanceObstacles(this.obstacles, subSec);
        if (editorLive) this.editorObstacles.advance(subSec); // --- obstacle-editor ---
        // --- gerald-exit-splat --- the exits move before the balls (a gap pass is judged where the exit is now); the standing
        // splats follow their rings (turned, breathing)
        if (exitsLive) this.exits.advance(this.ctx, subSec, this.ringSkips);
        const splatsSolid = this.splatsLive && this.splats.prepare(this.circularWalls, this.wallRotations, ringCx, ringCy);
        // --- end gerald-exit-splat ---
        for (let i = this.balls.length - 1; i >= 0; i--) {
          const ball = this.balls[i];
          const baseSpeed = this._config.ballSpeed || 400;
          // A ball's own weight (Ball Drop) multiplies the gravity; 1 for every other ball, which leaves the value untouched.
          const gravityScale = (baseSpeed / 300) * (1 + 0.5 * audioIntensity) * (ball.gravityScale ?? 1);
          if (rotatingGravity) {
            const g = this._config.gravity * subSec * gravityScale;
            ball.vx += g * gDirX;
            ball.vy += g * gDirY;
          } else ball.vy += this._config.gravity * subSec * gravityScale;
          if (wind) {
            ball.vx += extras.windX * baseSpeed * subSec;
            ball.vy += extras.windY * baseSpeed * subSec;
          }
          if (spinning && ball.spin !== 0) {
            // Magnus effect: the spin curves the flight sideways, a = k · spin · (−vy, vx).
            const k = magnus * ball.spin * subSec;
            const dvx = -k * ball.vy;
            const dvy = k * ball.vx;
            ball.vx += dvx;
            ball.vy += dvy;
            ball.angle += ball.spin * subSec;
            if (ball.angle > TWO_PI || ball.angle < -TWO_PI) ball.angle %= TWO_PI;
            ball.spin *= spinDecay;
          }
          if (keepMoving) {
            const speed = Math.hypot(ball.vx, ball.vy);
            const cruise = ball.mult ? cruiseSpeed(ball, baseSpeed) : baseSpeed; // --- gerald-multipliers --- the speed multiplier raises the cruising speed
            if (speed > 0 && speed < cruise) {
              const boost = 1 + 0.5 * subSec;
              ball.vx *= boost;
              ball.vy *= boost;
            }
          }
          const bx = ball.x - ringCx;
          const by = ball.y - ringCy;
          const beforeSq = this.circularWalls.length > 0 ? bx * bx + by * by : -1;
          ball.x += ball.vx * subSec;
          ball.y += ball.vy * subSec;
          this.currentMode?.onBallStep(this.ctx, ball, subSec);
          // --- gerald-multipliers --- a touched orb applies at the end of the step (--- rigged --- a forced winner's rivals do not clone themselves)
          if (orbsLive && mult.hasOrbs()) mult.touch(ball, this.rigOn && this.cinematicDirector.rig.blocksClone(ball));
          if (s === 0 && ball.lifetime !== undefined) {
            ball.lifetime -= stepMs;
            if (ball.lifetime <= 0) {
              this.balls.splice(i, 1);
              continue;
            }
          }
          if (hasObstacles) this.handleObstacleCollisions(ball, subSec);
          if (editorLive) this.handleEditorObstacles(ball, subSec); // --- obstacle-editor ---
          if (splatsSolid && !this.ringSkips(ball)) this.handleSplats(ball, subSec); // --- gerald-exit-splat ---
          if (!this.currentMode?.shouldSkipWallCollision(ball)) this.handleCircularWallCollisions(ball, beforeSq);
        }
        // The pair pass and the mode's pushes (Accumulation's frozen balls) ignore the rings: a push that carries a ball's
        // centre across an intact ring is undone radially (restoreRingSides()), so the next wall pass resolves it from its side.
        const sides = this.circularWalls.length > 0 && (this.balls.length > 1 || this.currentMode === this.accumulationMode) ? this.recordRingSides(ringCx, ringCy) : 0;
        if (this.limits.pairsAllowed(this.balls.length)) this.handleBallCollisions(multActive || limitsOn); // --- unlimited --- (every pair through the spatial hash; a clone storm passes through itself)
        this.currentMode?.onPostSubStep(this.ctx);
        if (sides > 0) this.restoreRingSides(sides, ringCx, ringCy);
      }
      if (this.rigOn) this.cinematicDirector.rig.holdInside(this.circularWalls, this.wallRotations); // --- rigged --- a closed way out is never left
      this.currentMode?.onPostUpdate(this.ctx, stepMs);
      if (this.splatsLive) this.splats.endStep(this.circularWalls, this.brokenWalls, this._elapsedMs); // --- gerald-exit-splat --- (fades, falls, the leak, the cap)
      if (this.onBeat.wants()) this.stepOnBeat(stepMs, subSteps, audioIntensity, gDirX, gDirY, keepMoving); // --- video-beats ---
      const bmFired = bmOn && this.bounceMath.endStep(this._elapsedMs); // --- bounce-math --- the step's triggers, every rule in list order
      if (multActive || (bmFired && mult.isActive(modeName))) mult.endStep(this.ctx, this.limits.cloneLimit(this.interaction.maxBalls), this.circularWalls.length > 0); // --- gerald-multipliers --- orbs taken, grown balls refitted, HUD (--- bounce-math --- also right after a rule grew or sped a ball; --- unlimited --- x2 BALLS clones past the split limit)
      // --- unlimited --- the crowd moves, non-finite balls are rescued, big balls burst their rings or eat the arena
      if (limitsOn) {
        const g = this.gravityAccel(audioIntensity);
        this.limits.endStep(this.ctx, mult, this.limitsHost, stepSec, g * gDirX, g * gDirY);
      }
      if (this.circularWalls.length > 0) this.scanEscapes(); // --- teams ---
      if (this.pendingSplits.length > 0) this.flushSplits();
      const trailCap = this.bounceMath.trailCap(); // --- bounce-math --- the "trail" parameter (20 points without one)
      for (const ball of this.balls) {
        if (ball.trail.length < trailCap) ball.trail.push({ x: ball.x, y: ball.y });
        else if (trailCap > 0) {
          ball.trail[ball.trailIndex].x = ball.x;
          ball.trail[ball.trailIndex].y = ball.y;
          ball.trailIndex = (ball.trailIndex + 1) % trailCap;
        }
      }
      if (mult.isOutgrown()) break; // --- gerald-multipliers --- the run just ended
    }
    beginPairStep(Infinity); // --- uncap-all --- (queries outside a step – a mode's init – are never budgeted)
    if (this.finishedAtMs < 0 && this.isSimulationFinished()) this.finishedAtMs = this._elapsedMs; // --- split-screen --- (the race's finish time)
    this.updateParticles(frameMs / 1000);
  }

  // --- gerald-multipliers ---
  /** Gravity (px/s²) on a ball of normal weight this step, for the sub-step plan. */
  private gravityAccel(audioIntensity: number) {
    return this._config.gravity * ((this._config.ballSpeed || 400) / 300) * (1 + 0.5 * audioIntensity);
  }

  /** The fastest rebound the rings may give a ×1 ball this step (0 in modes without the engine's ring rebounds). */
  private reboundSpeedBound() {
    // --- bounce-math --- an obstacle rebound may lift a bouncy ball to its cruising speed × its bounciness (planStep() multiplies them in)
    const lift = this.bounceMath.on && (this.obstacles.length > 0 || this.editorObstaclesLive()) ? (this._config.ballSpeed || 400) * this.extras.wallBounciness : 0;
    if (this.circularWalls.length === 0 || this.currentMode?.ballsMayRest) return lift;
    // --- uncap-all --- no ceiling: the next few bounces' gain on top of the multiplier (0.3 for the old switch's 0.03 steps)
    const bouncier = this.bouncierEnabled ? this.bounceSpeedMultiplier + Math.max(0.3, 2 * this.bouncierIncrement) : 1;
    const ring = (this._config.ballSpeed || 400) * bouncier * 1.25 * this.extras.wallBounciness;
    return ring > lift ? ring : lift;
  }

  /** A ring breaks for good under a ball (a smash from damage, or a grown ball bursting it): effect, sound, split, director. */
  private smashWall(ball: Ball, wallIndex: number) {
    if (this.brokenWalls.has(wallIndex)) return;
    if (this.rigOn && this.rigSeals(ball, wallIndex)) return; // --- rigged --- a wall closed to this ball never breaks under it
    this.spawnWallBreakByStyle(wallIndex, ball.x, ball.y);
    this.pendingSoundEvents.push({ type: "gap", wallIndex });
    this.reportWallBreak(ball, wallIndex);
    this.brokenWalls.add(wallIndex);
    this.cinematicDirector.onGapPass();
    if (this.bouncierEnabled) this.bounceSpeedMultiplier = 1;
  }
  // --- end gerald-multipliers ---

  /**
   * Resolves the ball against every obstacle (obstacles.ts): the push-out and rebound always happen; a
   * contact at `OBSTACLE_HIT_SPEED` or more is reported to the mode, queued as a "hit" sound (with the
   * pitch the mode returns, otherwise the innermost-wall tone) and remembered for the glow. The wall
   * bounciness extra scales the obstacle restitution like it scales every other rebound.
   */
  private handleObstacleCollisions(ball: Ball, dtSec: number) {
    const obstacles = this.obstacles;
    const scale = ball.mult ? this.extras.wallBounciness * effectiveBounce(ball, this.multipliers.bounceCap) : this.extras.wallBounciness; // --- gerald-multipliers --- bounce multiplier (--- unlimited --- no cap with No limits on)
    // --- bounce-math --- the ball's bounciness multiplies the capped restitution (no upper limit), lifting at most to the cruising speed × it
    const bounciness = ball.restitution ?? 1;
    const lift = bounciness > 1 ? this.obstacleLiftSpeed(ball, scale, bounciness) : Infinity;
    // A resting ball meets its support at the speed one sub-step of (its own) gravity gave it: only clearly faster contacts are hits.
    const restingSpeed = 3 * this.subStepGravity * (ball.gravityScale ?? 1);
    const hitSpeed = restingSpeed > OBSTACLE_HIT_SPEED ? restingSpeed : OBSTACLE_HIT_SPEED;
    for (let i = 0; i < obstacles.length; i++) {
      const impact = resolveBallObstacle(ball, obstacles[i], dtSec, scale, undefined, bounciness, lift);
      if (impact < hitSpeed) continue; // no contact (−1) or a soft, resting one
      if (this.bounceMath.on) this.bounceMath.note(BM_BOUNCE, ball); // --- bounce-math ---
      const result = this.currentMode?.onObstacleHit?.(this.ctx, ball, obstacles[i], i, impact);
      if (!result?.suppressGlow) this.addObstacleHit(i, ball.x, ball.y);
      if (result?.suppressSound) continue;
      const frequency = shiftedObstacleFrequency(result?.frequency, ball); // --- bounce-math --- (the ball's pitch shift)
      if (frequency !== undefined) this.pendingSoundEvents.push({ type: "hit", wallIndex: 0, frequency });
      else this.pendingSoundEvents.push({ type: "hit", wallIndex: 0 });
    }
  }

  private addObstacleHit(index: number, x: number, y: number) {
    const now = Date.now();
    this.obstacleHits.push({ index, x, y, timestamp: now });
    const cutoff = now - 1000;
    let drop = 0;
    while (drop < this.obstacleHits.length && this.obstacleHits[drop].timestamp < cutoff) drop++;
    if (drop > 0) this.obstacleHits.splice(0, drop);
  }

  /** `beforeSq`: the ball's squared distance from the centre before this sub-step moved it (−1: unknown; see `processWallCollisions()`). */
  private handleCircularWallCollisions(ball: Ball, beforeSq = -1) {
    const cx = this._config.width / 2;
    const cy = this._config.height / 2;
    for (let iter = 0; iter < 5; iter++) {
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) continue;
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += TWO_PI;
      // Keep the ball inside the arena while any intact wall still encloses it.
      if (this.circularWalls.some((w, i) => !this.brokenWalls.has(i) && w.radius >= dist)) {
        const bound =
          this.circularWalls.length > 0
            ? this.circularWalls[this.circularWalls.length - 1].radius + 50
            : Math.min(this._config.width, this._config.height) / 2;
        if (dist > bound) {
          const nx = dx / dist;
          const ny = dy / dist;
          ball.x = cx + nx * (bound - ball.radius);
          ball.y = cy + ny * (bound - ball.radius);
          const dot = ball.vx * nx + ball.vy * ny;
          ball.vx -= 2 * dot * nx;
          ball.vy -= 2 * dot * ny;
        }
      }
      // Only the first pass sweeps the walls over their last move: the later passes resolve what the
      // push-outs of the first one (or a mode's teleport) left overlapping, against the current radii.
      if (!this.processWallCollisions(ball, cx, cy, dist, angle, this.sweepWalls && iter === 0, iter === 0 ? beforeSq : -1)) break;
    }
  }

  /**
   * Resolves the ball against every intact wall. With `swept` the walls may have moved since the ball
   * was last resolved against them (breathing walls; `wallPrevRadii` holds where each one was): the
   * ball's side is then judged against that previous radius and the hit test covers the whole move,
   * so a wall that jumped over the ball still hits it and pushes it back to the side it came from,
   * and a gap that swept past the ball's centre counts as a pass. With `prev === radius` the swept
   * test is exactly the plain one, so a run without breathing walls takes the original code path.
   * `beforeSq` (≥ 0 on the first pass of a sub-step) is the ball's squared distance from the centre before the sub-step moved it:
   * a ball whose move carried its centre across a ring (`movedAcross()`: from clear of the ring, or through solid wall –
   * a fast ball can land beyond the ±(radius + 2) hit band) is judged from the side it came from, so a solid ring pushes
   * it back and rebounds it instead of letting it through (a crossing through a gap still passes). A ball that crossed no
   * ring takes exactly the old path.
   */
  private processWallCollisions(ball: Ball, cx: number, cy: number, dist: number, angle: number, swept = false, beforeSq = -1): boolean {
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    let outermostBelow = -1;
    for (let i = 0; i < this.circularWalls.length; i++) {
      if (!this.brokenWalls.has(i) && dist > this.circularWalls[i].radius + ball.radius) outermostBelow = i;
    }
    this.lastWallLayer.set(ball.id, outermostBelow);
    const isShatter = this.currentMode?.name === "shatter";
    let collided = false;
    for (let w = 0; w < this.circularWalls.length; w++) {
      const wall = this.circularWalls[w];
      // --- rigged --- a wall broken open before the forced winner passed it still holds the other balls in
      if (this.brokenWalls.has(w) && !(this.rigOn && (dist < wall.radius || (beforeSq >= 0 && beforeSq < wall.radius * wall.radius)) && this.cinematicDirector.rig.holdsBroken(ball, w))) continue;
      const rotation = this.wallRotations[w];
      const inner = dist - ball.radius - 2;
      const outer = dist + ball.radius + 2;
      let inside: boolean;
      /** The wall (with its gap) moved past the ball's centre since the last pass: an inside ball is now outside it. */
      let crossed = false;
      /** The ball's own move took its centre across the ring (`beforeSq`): it is judged from the side it came from. */
      let crossedRing = false;
      if (swept) {
        const prev = w < this.wallPrevRadii.length ? this.wallPrevRadii[w] : wall.radius;
        inside = this.movedAcross(ball, beforeSq, dist, prev, wall, rotation, angle) ? beforeSq < prev * prev : dist < prev;
        if (inside ? outer < wall.radius : inner > wall.radius) continue;
        crossed = inside && dist >= wall.radius;
      } else {
        crossedRing = this.movedAcross(ball, beforeSq, dist, wall.radius, wall, rotation, angle);
        if (!crossedRing && !(inner <= wall.radius && outer >= wall.radius)) continue;
        inside = dist < wall.radius;
      }

      let inGap = false;
      const ballAngular = Math.atan2(ball.radius, wall.radius);
      for (const gap of wall.gaps) {
        let start = gap.startAngle + rotation;
        let end = gap.endAngle + rotation;
        start = ((start % TWO_PI) + TWO_PI) % TWO_PI;
        end = ((end % TWO_PI) + TWO_PI) % TWO_PI;
        let width = end - start;
        if (width < 0) width += TWO_PI;
        // A gap only counts when the whole ball fits through it (with a safety margin).
        if (width >= ballAngular * (isShatter ? 1.2 : 2.5)) {
          const margin = isShatter ? 0.5 * ballAngular : ballAngular;
          const a0 = start + margin;
          let a1 = end - margin;
          if (a1 < 0) a1 += TWO_PI;
          if (a1 < a0) {
            if (angle >= a0 || angle <= a1) {
              inGap = true;
              break;
            }
          } else if (angle >= a0 && angle <= a1) {
            inGap = true;
            break;
          }
        }
      }

      const nx = dx / dist;
      const ny = dy / dist;
      // --- rigged --- a wall closed to this ball (never escape's barrier, a forced winner's locked walls): its gaps do not
      // let the ball out – it rebounds as off the wall (the safety net under the director's steering)
      // (a ball inside it at the start of the step is held even when a fast sub-step already carried its centre past it)
      let sealedGap = false;
      if (inGap && this.rigOn && this.cinematicDirector.rig.closes(ball, w) && (inside || this.cinematicDirector.rig.heldAtStart(ball, w))) {
        inGap = false;
        sealedGap = true;
        if (ball.vx * nx + ball.vy * ny > 0 || crossed || !inside) this.cinematicDirector.rig.noteSeal();
        inside = true; // the push-out below puts it back inside the wall
      }
      if (inGap) {
        const movingOut = ball.vx * nx + ball.vy * ny > 0;
        if (!inside || movingOut || crossed) {
          if (this.rigOn) this.cinematicDirector.rig.notePass(ball, w); // --- rigged --- the forced winner's passes open the wall
          const gap = wall.gaps.length > 0 ? wall.gaps[0] : null;
          if (gap) {
            const adj = this.cinematicDirector.adjustGapPass(ball, wall.radius, rotation, gap, cx, cy);
            if (adj) {
              ball.vx += adj.vxAdjust;
              ball.vy += adj.vyAdjust;
            }
          }
          this.cinematicDirector.onGapPass();
          if (this.bouncierEnabled) this.bounceSpeedMultiplier = 1;
          if (this.onBeat.wants()) this.onBeat.noteContact(ball, this._elapsedMs / 1000, false); // --- video-beats --- the next flight is planned
          if (this.bounceMath.on) this.bounceMath.notePass(ball, w, this._elapsedMs); // --- bounce-math --- (once per pass)
          const handled = this.currentMode?.onGapPass(this.ctx, ball, w);
          // --- rigged --- (a wall the rig keeps closed to this ball never breaks under it, whichever side it came from)
          if (!handled && !(this.rigOn && this.cinematicDirector.rig.closes(ball, w))) {
            if (!this.brokenWalls.has(w)) {
              this.spawnWallBreakByStyle(w, ball.x, ball.y);
              this.pendingSoundEvents.push({ type: "gap", wallIndex: w });
              this.wallBreakSerial++; // --- camera ---
              this.reportWallBreak(ball, w);
            }
            this.brokenWalls.add(w);
          }
        }
      } else {
        // A move through solid wall: the ball goes back to the side it came from (a refused pass keeps it inside).
        if (crossedRing && !sealedGap) inside = beforeSq < wall.radius * wall.radius;
        // --- gerald-multipliers --- enough damage smashes the ring on contact: no gap needed
        if (ball.mult && !(this.rigOn && this.cinematicDirector.rig.closes(ball, w) && (inside || this.cinematicDirector.rig.heldAtStart(ball, w))) && smashesWalls(ball, this.multipliers.getConfig().wallSmashThreshold, this.currentMode?.name)) { // --- rigged --- (a closed wall is not smashed)
          this.smashWall(ball, w);
          this.multipliers.noteSmash();
          continue;
        }
        const push = isShatter && !sealedGap ? ball.radius + 0.5 : ball.radius + 3; // --- rigged --- a refused pass clears the gap
        if (inside) {
          ball.x = cx + nx * (wall.radius - push);
          ball.y = cy + ny * (wall.radius - push);
        } else {
          ball.x = cx + nx * (wall.radius + push);
          ball.y = cy + ny * (wall.radius + push);
        }
        if (this.extras.spinStrength > 0) {
          // Spin extra: the (rotating) wall grips the ball, which rolls against it at the contact point.
          const target = contactSpin(ball.vx, ball.vy, nx, ny, inside, this.wallRotationRate(w) * wall.radius, ball.radius);
          ball.spin += (target - ball.spin) * this.extras.spinStrength;
        }
        // --- jdm-illusions --- the contact for the canvas' wobbly walls (render-only): a ball inside pushes the wall out, one outside in
        this.wallContacts.record(w, angle, (inside ? 1 : -1) * wobbleStrength(ball.vx * nx + ball.vy * ny, this._config.ballSpeed || 400), this._elapsedMs);
        const splatApproach = this.splatsLive && inside ? ball.vx * nx + ball.vy * ny : 0; // --- gerald-exit-splat --- (how hard it lands, before the mode handles the hit)
        const result = this.currentMode?.onWallHit(this.ctx, ball, w, angle);
        // --- gerald-exit-splat --- the hit leaves a splat on the inside of the wall (not a portal's teleport, not a refused pass)
        if (this.splatsLive && inside && !sealedGap && !(result?.suppressBounce && this.currentMode === this.portalMode)) this.addSplat(ball, w, angle, wall, rotation, splatApproach);
        if (!result?.suppressGlow) this.addWallHit(w, angle, wall.radius);
        // --- rigged --- a bounce off a closed wall right beside its gap: a near miss (the camera's slow motion follows it)
        if (this.rigOn && inside && this.cinematicDirector.rig.nearMissAt(ball, w, angle, wall.radius, rotation)) this.cinematicDirector.noteRigNearMiss();
        this.pendingSoundEvents.push(bounceHitEvent(w, ball)); // --- bounce-math --- (with the ball's pitch shift, when it has one)
        this.ballStats.bounce(ball); // --- teams ---
        if (this.bouncierEnabled && !result?.resetBouncier) {
          this.bounceSpeedMultiplier = this.bounceSpeedMultiplier + this.bouncierIncrement; // --- uncap-all --- (no ceiling: faster on every bounce, forever)
        }
        if (!result?.suppressBounce) {
          const baseSpeed = this._config.ballSpeed || 400;
          // Wall bounciness (restitution) scales the rebound speed; it is 1 by default (an exact no-op).
          let speed = baseSpeed * this.bounceSpeedMultiplier * this.cinematicDirector.getSpeedMultiplier() * this.extras.wallBounciness;
          if (ball.mult) speed *= ball.mult.speed * effectiveBounce(ball, this.multipliers.bounceCap); // --- gerald-multipliers --- speed and bounce multipliers (--- unlimited --- uncapped with No limits on)
          if (ball.restitution !== undefined) speed *= ball.restitution; // --- bounce-math --- the ball's bounciness
          const scatter = Math.PI / 3;
          let outAngle = (inside ? Math.atan2(-ny, -nx) : Math.atan2(ny, nx)) + (2 * this.random() - 1) * scatter;
          outAngle = this.cinematicDirector.adjustRebound(ball, outAngle, wall.radius, rotation, wall.gaps);
          // --- rigged --- the director turns the rebound so the next bounce misses the gaps closed to this ball (and the
          // forced winner's through a gap it can pass)
          if (this.rigOn) {
            this.cinematicDirector.rig.syncWalls(this.circularWalls, this.wallRotations);
            outAngle = this.cinematicDirector.steerRigged(ball, w, inside, outAngle, speed);
          }
          // A mode may steer the rebound further (Paint's guided coverage); it draws no random numbers.
          if (this.currentMode?.adjustRebound) outAngle = this.currentMode.adjustRebound(this.ctx, ball, w, outAngle);
          ball.vx = Math.cos(outAngle) * speed;
          ball.vy = Math.sin(outAngle) * speed;
        } else if (this.extras.wallBounciness !== 1) {
          // The mode set the rebound itself (Grow, Portal teleports…): restitution still applies to it.
          ball.vx *= this.extras.wallBounciness;
          ball.vy *= this.extras.wallBounciness;
        }
        // --- bounce-math --- the ball's bounciness applies to a rebound the mode set itself too – at most once: a mode that keeps
        // the incoming speed would otherwise compound it hit after hit, so above 1 it lifts the speed up to the cruising speed ×
        // the bounciness (never slowing a ball that is already faster); below 1 the rebound loses that share of the speed
        if (result?.suppressBounce && ball.restitution !== undefined) {
          const r = ball.restitution;
          const k = r < 1 ? r : Math.max(1, Math.min(r, (cruiseSpeed(ball, this._config.ballSpeed || 400) * r) / Math.max(1e-9, Math.hypot(ball.vx, ball.vy))));
          ball.vx *= k;
          ball.vy *= k;
        }
        if (this.onBeat.wants()) this.onBeat.noteContact(ball, this._elapsedMs / 1000, !result?.suppressBounce); // --- video-beats --- a fresh rebound is at its natural speed
        if (this.bounceMath.on) this.bounceMath.note(BM_BOUNCE, ball); // --- bounce-math ---
        collided = true;
        // The rings after this one were tested against where the move left the ball, not where it is now: the next pass
        // resolves them from its new place.
        if (crossedRing) return true;
        if (this.limits.onePerPass) return true; // --- unlimited --- (packed rings: one rebound a pass, the next pass resolves the rest)
      }
    }
    return collided;
  }

  /**
   * The ball's own move (from √`beforeSq` to `dist`; −1 = unknown) took its centre across the ring at radius `R` through solid
   * wall – a tunnelling move, judged from the side it came from. Not when it was already touching the ring inside the span
   * of a gap: a ball straddling the ring in a gap keeps the judgement by its centre it always had (it passes the gap's
   * edge). Allocation-free; the gaps are only looked at for such a straddling crossing.
   */
  private movedAcross(ball: Ball, beforeSq: number, dist: number, R: number, wall: CircularWall, rotation: number, angle: number): boolean {
    if (beforeSq < 0 || (beforeSq < R * R) === (dist < R)) return false;
    if (Math.abs(Math.sqrt(beforeSq) - R) > ball.radius + 2) return true;
    for (const gap of wall.gaps) {
      const start = (((gap.startAngle + rotation) % TWO_PI) + TWO_PI) % TWO_PI;
      let width = gap.endAngle - gap.startAngle;
      if (width >= TWO_PI) return false;
      width = ((width % TWO_PI) + TWO_PI) % TWO_PI;
      let rel = angle - start;
      if (rel < 0) rel += TWO_PI;
      if (rel <= width) return false;
    }
    return true;
  }

  /** The classic rings' radii for the current canvas, exactly as `initializeCircularWalls()` builds them; gaps, rotations and broken rings stay. */
  private resizeCircularWalls() {
    const maxR = (Math.min(this._config.width, this._config.height) / 2) * 0.85;
    const count = this.circularWalls.length;
    for (let i = 0; i < count; i++) this.circularWalls[i].radius = maxR * (0.4 + (0.6 / count) * (i + 1));
  }

  private initializeCircularWalls() {
    const maxR = (Math.min(this._config.width, this._config.height) / 2) * 0.85;
    const count = this._config.wallCount || 7;
    const passRadius = this.ringPassRadius();
    this.circularWalls = [];
    this.wallRotations = [];
    for (let i = 0; i < count; i++) {
      const radius = maxR * (0.4 + (0.6 / count) * (i + 1));
      // (widened only where the ball could never pass it – see passableGap(); every gap a ball fits through stays as set)
      const gap = passableGap(this._config.gapSize || 0.3, radius, passRadius);
      const start = (TWO_PI * i) / count;
      this.circularWalls.push({ radius, gaps: [{ startAngle: start, endAngle: start + gap }] });
      this.wallRotations.push(0);
    }
    this.syncWallBaseRadii();
  }

  private handleBallCollision(a: Ball, b: Ball) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const minDist = a.radius + b.radius;
    if (dist >= minDist || dist === 0) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;
    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel > 0) return;
    const impulse = rel; // equal masses
    a.vx += nx * impulse;
    a.vy += ny * impulse;
    b.vx -= nx * impulse;
    b.vy -= ny * impulse;
    if (this.bounceMath.on) this.bounceMath.note(BM_COLLIDE, a, b); // --- bounce-math ---
    this.currentMode?.onBallCollision?.(this.ctx, a, b);
  }

  /**
   * Resolves every pair of balls according to the ball interaction (interactions.ts): the classic elastic
   * rebound in "bounce" and "split" mode (the halves of a split must not fly through each other), a fusion
   * in "merge" mode, nothing at all in "pass" mode.
   */
  private handleBallCollisions(multipliersActive = false) {
    const interaction = this.interaction.ballInteraction;
    if (interaction === "pass" || this.currentMode?.ballsPassThrough) return;
    const merge = interaction === "merge";
    // --- gerald-multipliers --- a crowd in a multiplier run (Multiply's fast children): the pairs come from a grid
    if (multipliersActive && !merge && this.balls.length > HASHED_PAIRS_FROM) {
      this.handleBallCollisionsHashed();
      return;
    }
    for (let a = 0; a < this.balls.length; a++) {
      for (let b = a + 1; b < this.balls.length; b++) {
        if (!merge) this.handleBallCollision(this.balls[a], this.balls[b]);
        else if (this.mergeBallPair(a, b)) b--; // ball b was absorbed into a and the next ball now sits at index b
      }
    }
  }

  /**
   * --- gerald-multipliers --- The rebound pass through a spatial hash: the balls are binned into cells three of the
   * biggest radii wide, the pairs that touch – or nearly: a one-radius margin, as the pass itself pushes balls about –
   * come out in grid order (deterministic: it only depends on the positions) and each gets the pair loop's elastic
   * rebound. The grid covers the canvas and a few cells around it; balls flung further out (Multiply's escaped ones) are
   * clamped into its border cells, still next to anything they touch. Allocation-free once the buffers have grown.
   */
  private handleBallCollisionsHashed() {
    const balls = this.balls;
    const n = balls.length;
    if (this.pairXs.length < n) {
      const size = Math.max(2 * this.pairXs.length, n);
      this.pairXs = new Float64Array(size);
      this.pairYs = new Float64Array(size);
      this.pairRs = new Float64Array(size);
    }
    const xs = this.pairXs;
    const ys = this.pairYs;
    const rs = this.pairRs;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      xs[i] = b.x;
      ys[i] = b.y;
      rs[i] = b.radius;
      if (b.x < minX) minX = b.x;
      if (b.x > maxX) maxX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.y > maxY) maxY = b.y;
      if (b.radius > maxR) maxR = b.radius;
    }
    if (!(maxX >= minX) || !(maxY >= minY) || !(maxR > 0) || !Number.isFinite(maxR)) return; // nothing sensible to pair
    const margin = maxR;
    const cell = 2 * maxR + margin;
    const pad = 3 * cell;
    const x0 = Math.max(minX, -pad) - maxR;
    const y0 = Math.max(minY, -pad) - maxR;
    const x1 = Math.max(x0 + cell, Math.min(maxX, this._config.width + pad) + maxR);
    const y1 = Math.max(y0 + cell, Math.min(maxY, this._config.height + pad) + maxR);
    this.pairHash.build(xs, ys, n, cell, x0, y0, x1, y1);
    const count = this.pairHash.collectContacts(xs, ys, rs, margin, this.pairBuffer);
    const pairs = this.pairBuffer.pairs;
    for (let k = 0; k < count; k++) this.handleBallCollision(balls[pairs[2 * k]], balls[pairs[2 * k + 1]]);
  }

  /**
   * "Merge" interaction: fuses the balls at indices `ia` < `ib` when they overlap while approaching each other
   * (balls that merely drift apart – e.g. freshly spawned at the same point – are left alone, as a bounce would
   * leave them). The first ball becomes the merged one and keeps its id, trail and lifetime; the second is
   * removed. Returns true when the balls merged.
   */
  private mergeBallPair(ia: number, ib: number): boolean {
    const a = this.balls[ia];
    const b = this.balls[ib];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= a.radius + b.radius || dist === 0) return false;
    if ((b.vx - a.vx) * dx + (b.vy - a.vy) * dy > 0) return false;
    const merged = mergeBalls(a, b);
    a.x = merged.x;
    a.y = merged.y;
    a.vx = merged.vx;
    a.vy = merged.vy;
    a.radius = merged.radius;
    a.color = merged.color;
    // --- timeline --- the merged size is kept relative to the Ball Size, so a keyframed (or dragged) Ball Size scales it instead of resetting it
    a.radiusScale = merged.radius / (this._config.ballRadius || 8);
    // --- rigged --- the forced winner's ball is never absorbed out of the story: the merged ball plays on for its team
    if (this.rigOn && b.team !== undefined && b.team === this.cinematicDirector.rig.winnerTeam() && a.team !== b.team) {
      a.team = b.team;
      a.color = b.color;
    }
    // --- review fix (modes-gerald-odd) --- the String Battle knows a fighter by its ball's id and has no rings (the rig above is off
    // there): a merge that would absorb the forced winner's own ball gives the merged ball that identity instead, so the chosen
    // fighter plays on with it and the other one is the fighter that is out
    let goneId = b.id;
    if (this.currentMode === this.stringBattleMode && b.team !== undefined && a.team !== b.team) {
      const battle = this.stringBattleMode.getView();
      if (b.team === battle.forcedWinner && battle.fighters[b.team]?.id === b.id) {
        goneId = a.id;
        a.id = b.id;
        a.team = b.team;
        a.color = b.color;
      }
    }
    this.balls.splice(ib, 1);
    this.lastWallLayer.delete(goneId);
    this.pendingSoundEvents.push({ type: "merge", wallIndex: 0 });
    this.spawnMergeBurst(a.x, a.y, a.color, a.radius);
    if (this.bounceMath.on) this.bounceMath.note(BM_COLLIDE, a, null); // --- bounce-math --- (a merge is a collision too)
    return true;
  }

  /**
   * A ball just broke through (or escaped) a wall – reported by the engine's own gap pass and by the modes
   * that break walls themselves (`ctx.reportWallBreak()`). With the "split" interaction the ball is queued
   * and splits at the end of the current step: after the rebound / escape bookkeeping that follows the break,
   * outside every loop over the balls, and once per ball per step however many walls it broke.
   */
  private reportWallBreak(ball: Ball, wallIndex: number) {
    this.ballStats.wall(ball); // --- teams ---
    if (this.bounceMath.on) this.bounceMath.noteBreakBall(ball); // --- bounce-math --- (the ball behind the step's next "gap" event)
    if (this.interaction.ballInteraction !== "split") return;
    for (const pending of this.pendingSplits) if (pending.ball === ball) return;
    this.pendingSplits.push({ ball, wallIndex });
  }

  /**
   * Splits every queued ball that still exists and may split (`canSplit()`: both halves at least
   * `splitMinRadius`, fewer than `maxBalls` balls). The ball itself becomes one half – keeping its id, trail,
   * lifetime and spin – and a new ball is added for the other; the mode copies per-ball state to it in
   * `onBallSplit()` (Multiply marks the half of an escaped ball as escaped too).
   */
  private flushSplits() {
    const { splitMinRadius, maxBalls } = this.interaction;
    for (const { ball, wallIndex } of this.pendingSplits) {
      if (!this.balls.includes(ball) || !canSplit(ball.radius, splitMinRadius, this.balls.length, maxBalls)) continue;
      const x = ball.x;
      const y = ball.y;
      const [first, second] = splitBall(ball, this.ctx.random);
      ball.x = first.x;
      ball.y = first.y;
      ball.vx = first.vx;
      ball.vy = first.vy;
      ball.radius = first.radius;
      // --- timeline --- both halves keep their size relative to the Ball Size, so a keyframed (or dragged) Ball Size scales them instead of regrowing them
      ball.radiusScale = first.radius / (this._config.ballRadius || 8);
      this.addBall({ ...second, color: ball.color, lifetime: ball.lifetime, gravityScale: ball.gravityScale, radiusScale: second.radius / (this._config.ballRadius || 8) });
      const half = this.balls[this.balls.length - 1];
      if (ball.mult) half.mult = copyMultipliers(ball.mult); // --- gerald-multipliers --- the halves keep the multipliers
      this.bounceMath.inherit(ball, half); // --- bounce-math --- (and the bounciness, hue and pitch)
      half.spin = ball.spin;
      half.angle = ball.angle;
      // --- teams --- the half plays for its parent's team, and the half of an escaped ball does not escape again
      if (ball.team !== undefined) half.team = ball.team;
      this.ballStats.inheritEscape(ball.id, half.id);
      this.currentMode?.onBallSplit?.(this.ctx, ball, half);
      this.pendingSoundEvents.push({ type: "split", wallIndex });
      this.spawnSplitBurst(x, y, ball.color);
    }
    this.pendingSplits.length = 0;
  }

  private addWallHit(wallIndex: number, angle: number, radius: number) {
    if (this.limits.on && this.wallHits.length >= WALL_HITS_KEPT) this.wallHits.splice(0, this.wallHits.length >> 1); // --- unlimited --- (thousands of hits a second: the newest few hundred light the walls; the glow is visual only)
    this.wallHits.push({ wallIndex, angle, radius, timestamp: Date.now() });
    const cutoff = Date.now() - 1000;
    let drop = 0;
    while (drop < this.wallHits.length && this.wallHits[drop].timestamp < cutoff) drop++;
    if (drop > 0) this.wallHits.splice(0, drop);
  }

  private getRandomColor() {
    const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B500", "#E74C3C", "#3498DB", "#2ECC71"];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // ---------------------------------------------------------------- effects

  spawnWallBreakByStyle(wallIndex: number, x: number, y: number) {
    const style = this.wallBreakStyle;
    const isShatter = this.currentMode?.name === "shatter";
    const all = style === "all";
    if (style === "confetti" || all) this.spawnConfetti(x, y);
    if (style === "shatter" || all) {
      if (isShatter) this.spawnLocalizedShardEffect(wallIndex, x, y);
      else this.spawnWallBreakEffect(wallIndex, x, y);
    }
    if (style === "shockwave" || all) {
      if (isShatter) this.spawnLocalizedShockwaveEffect(wallIndex, x, y);
      else this.spawnShockwaveEffect(wallIndex);
    }
  }

  private spawnShockwaveEffect(wallIndex: number) {
    const wall = this.circularWalls[wallIndex];
    if (!wall) return;
    this.shockwaves.push({
      x: this._config.width / 2,
      y: this._config.height / 2,
      radius: wall.radius,
      maxRadius: wall.radius + 80,
      life: 0.5,
      maxLife: 0.5,
      color: "#FFFFFF",
    });
    this.wallBreakFlashes.push({ wallRadius: wall.radius, life: 0.2, maxLife: 0.2 });
  }

  private spawnLocalizedShockwaveEffect(_wallIndex: number, x: number, y: number) {
    this.shockwaves.push({ x, y, radius: 5, maxRadius: 60, life: 0.4, maxLife: 0.4, color: "#FFFFFF" });
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TWO_PI;
      const speed = 80 + 150 * Math.random();
      this.pushParticle({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        color: "#FFFFFF",
        size: 1.5 + 2 * Math.random(),
        life: 0.3 + 0.3 * Math.random(),
        maxLife: 0.6,
        rotation: 0,
        rotationSpeed: 0,
        type: "spark",
      });
    }
  }

  private static readonly SHARD_COLORS = ["#FFFFFF", "#C8E6FF", "#A8D4FF", "#E0F0FF", "#88CCFF", "#DDEEFF"];

  private spawnWallBreakEffect(wallIndex: number, x: number, y: number) {
    const wall = this.circularWalls[wallIndex];
    if (!wall) return;
    const cx = this._config.width / 2;
    const cy = this._config.height / 2;
    const colors = PhysicsEngine.SHARD_COLORS;
    for (let i = 0; i < 40; i++) {
      const a = (TWO_PI * i) / 40 + (Math.random() - 0.5) * 0.3;
      const px = cx + Math.cos(a) * wall.radius;
      const py = cy + Math.sin(a) * wall.radius;
      const radial = 100 + 250 * Math.random();
      const tangential = (Math.random() - 0.5) * 100;
      this.pushParticle({
        x: px,
        y: py,
        vx: Math.cos(a) * radial + Math.cos(a + Math.PI / 2) * tangential,
        vy: Math.sin(a) * radial + Math.sin(a + Math.PI / 2) * tangential,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 3 + 8 * Math.random(),
        life: 1 + 0.8 * Math.random(),
        maxLife: 1.8,
        rotation: Math.random() * TWO_PI,
        rotationSpeed: (Math.random() - 0.5) * 15,
        type: "shard",
      });
    }
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * TWO_PI;
      const speed = 200 + 300 * Math.random();
      this.pushParticle({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        color: "#FFFFFF",
        size: 1.5 + 2.5 * Math.random(),
        life: 0.4 + 0.4 * Math.random(),
        maxLife: 0.8,
        rotation: 0,
        rotationSpeed: 0,
        type: "spark",
      });
    }
  }

  private spawnLocalizedShardEffect(_wallIndex: number, x: number, y: number) {
    const cx = this._config.width / 2;
    const cy = this._config.height / 2;
    const baseAngle = Math.atan2(y - cy, x - cx);
    const colors = PhysicsEngine.SHARD_COLORS;
    for (let i = 0; i < 12; i++) {
      const a = baseAngle + (Math.PI / 2) * (Math.random() - 0.5);
      const radial = 80 + 200 * Math.random();
      const tangential = (Math.random() - 0.5) * 60;
      this.pushParticle({
        x,
        y,
        vx: Math.cos(a) * radial + Math.cos(a + Math.PI / 2) * tangential,
        vy: Math.sin(a) * radial + Math.sin(a + Math.PI / 2) * tangential,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 2 + 5 * Math.random(),
        life: 0.8 + 0.6 * Math.random(),
        maxLife: 1.4,
        rotation: Math.random() * TWO_PI,
        rotationSpeed: (Math.random() - 0.5) * 15,
        type: "shard",
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = baseAngle + (Math.random() - 0.5) * Math.PI;
      const speed = 150 + 200 * Math.random();
      this.pushParticle({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        color: "#FFFFFF",
        size: 1 + 2 * Math.random(),
        life: 0.3 + 0.3 * Math.random(),
        maxLife: 0.6,
        rotation: 0,
        rotationSpeed: 0,
        type: "spark",
      });
    }
  }

  private pushParticle(p: Particle) {
    if (this.particles.length >= this.MAX_PARTICLES) return;
    if (this.particles.length >= this.particleCap) return; // --- split-screen ---
    this.particles.push(p);
  }

  // --- split-screen --- the arenas of a split-screen race share the particle budget (lib/simulation/multi.ts); visual only
  private particleCap = Infinity;
  /** Simulation time (ms) at the end of the step the run finished on (−1 while it runs): what the finder counts as its length. */
  private finishedAtMs = -1;
  /** When the run finished on its own clock, exact to the step however late a frame notices it (−1 while it runs). */
  getFinishedAtMs(): number {
    return this.finishedAtMs;
  }
  /** Caps the live particles at `max` (null: only the engine's own cap). Split-screen arenas share one budget. Visual only. */
  setParticleBudget(max: number | null) {
    this.particleCap = max === null || !Number.isFinite(max) ? Infinity : Math.max(1, Math.floor(max));
  }
  // --- end split-screen ---

  spawnConfetti(x: number, y: number) {
    // --- themes: sparks, petals, pixels and bubbles, or confetti in a theme's colours; the classic burst below stays the default
    if (this.particleStyle !== "confetti" || this.particlePalette.length > 0) {
      spawnStyledBurst(this.particleStyle, this.particlePalette, x, y, this.pushParticleFn);
      return;
    }
    // --- end themes
    const colors =["#FF6B6B", "#4ECDC4", "#FFE66D", "#95E1D3", "#F38181", "#AA96DA", "#FCBAD3", "#A8D8EA"];
    for (let i = 0; i < 30; i++) {
      const a = (TWO_PI * i) / 30 + 0.5 * Math.random();
      const speed = 150 + 200 * Math.random();
      this.pushParticle({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + 6 * Math.random(),
        life: 1.5,
        maxLife: 1.5,
        rotation: Math.random() * TWO_PI,
        rotationSpeed: (Math.random() - 0.5) * 10,
        type: "confetti",
      });
    }
  }

  /** "Merge" interaction: a ring of glowing dots in the merged ball's colour. Visual only, so Math.random like the other effects. */
  private spawnMergeBurst(x: number, y: number, color: string, radius: number) {
    for (let i = 0; i < 14; i++) {
      const a = (TWO_PI * i) / 14 + 0.3 * Math.random();
      const speed = 60 + 120 * Math.random();
      this.pushParticle({
        x: x + Math.cos(a) * radius,
        y: y + Math.sin(a) * radius,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        color,
        size: 2 + 2.5 * Math.random(),
        life: 0.4 + 0.3 * Math.random(),
        maxLife: 0.7,
        rotation: 0,
        rotationSpeed: 0,
        type: "burst",
      });
    }
  }

  /** "Split" interaction: a few sparks and coloured dots flying out of the point the ball split at. */
  private spawnSplitBurst(x: number, y: number, color: string) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TWO_PI;
      const speed = 80 + 160 * Math.random();
      this.pushParticle({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        color,
        size: 1.5 + 2 * Math.random(),
        life: 0.3 + 0.3 * Math.random(),
        maxLife: 0.6,
        rotation: 0,
        rotationSpeed: 0,
        type: i % 2 === 0 ? "spark" : "burst",
      });
    }
  }

  private updateParticles(dtSec: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vy += 400 * (p.gravity ?? 1) * dtSec; // --- themes: per-particle gravity (bubbles rise, petals float)
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.rotation += p.rotationSpeed * dtSec;
      p.life -= dtSec;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dtSec;
      const t = 1 - s.life / s.maxLife;
      s.radius = s.radius + (s.maxRadius - s.radius) * t;
      if (s.life <= 0) this.shockwaves.splice(i, 1);
    }
    for (let i = this.wallBreakFlashes.length - 1; i >= 0; i--) {
      const f = this.wallBreakFlashes[i];
      f.life -= dtSec;
      if (f.life <= 0) this.wallBreakFlashes.splice(i, 1);
    }
  }
}

/** Modes that support the optional second ball. */
export const TWO_BALL_MODES: ModeId[] = ["classic", "multiply", "lines", "grow", "shatter"];
