import { CinematicDirector } from "./director";
import { MAGNUS_COEFFICIENT, breathingScale, contactSpin, gravityAngle, resolvePhysicsExtras, spinDecayFactor } from "./extras";
import { canSplit, mergeBalls, resolveBallInteraction, splitBall } from "./interactions";
import {
  AccumulationMode,
  ClassicMode,
  ColorMatchMode,
  DropMode,
  GrowMode,
  LinesMode,
  MultiplyMode,
  PaintMode,
  PortalMode,
  ShatterMode,
  TargetMode,
} from "./modes";
import type { DropSettings, PicturePaintState } from "./modes";
import { advanceObstacles, hasSpinningObstacles, resolveBallObstacle, type Obstacle } from "./obstacles";
import type { PaintModeOptions } from "./picturePaint";
import type { BeatClockConfig } from "@/lib/simulation/beatClock";
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
import { TWO_PI } from "./types";

/**
 * Approach speed (px/s) from which an obstacle contact counts as a hit (sound + glow); resting contacts stay
 * silent. A resting ball is pushed into its support by one sub-step of gravity every step, so under heavy
 * gravity the threshold rises to three times that per-sub-step speed (see `handleObstacleCollisions()`).
 */
export const OBSTACLE_HIT_SPEED = 40;

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
  private pendingSoundEvents: SoundEvent[] = [];
  private readonly MAX_PARTICLES = 200;
  private bouncierEnabled = false;
  private bounceSpeedMultiplier = 1;
  private readonly bouncierIncrement = 0.03;
  private readonly bouncierMaxMultiplier = 3;
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

  readonly ctx: ModeContext;

  constructor(config: PhysicsConfig) {
    this._config = config;
    this.extras = resolvePhysicsExtras(config);
    this.breathing = this.extras.breathingAmplitude > 0;
    this.interaction = resolveBallInteraction(config);
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
      },
      spawnWallBreakByStyle: (wallIndex, x, y) => this.spawnWallBreakByStyle(wallIndex, x, y),
      spawnConfetti: (x, y) => this.spawnConfetti(x, y),
      reportWallBreak: (ball, wallIndex) => this.reportWallBreak(ball, wallIndex),
      isBouncierEnabled: () => this.bouncierEnabled,
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
    };
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
    return this._config;
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
      const gap = this._config.gapSize || 0.3;
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
      this.addBall({
        x: cx,
        y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: this._config.ballRadius || 8,
        color: this._config.ballColor || "#FFFFFF",
      });
      this.lastWallLayer.set(this.nextId - 1, -1);
      if (this._config.twoBalls && TWO_BALL_MODES.includes(mode.name)) {
        const b = (a + Math.PI) % TWO_PI;
        this.addBall({
          x: cx,
          y: cy,
          vx: Math.cos(b) * speed,
          vy: Math.sin(b) * speed,
          radius: this._config.ballRadius || 8,
          color: this._config.ballColor2 || "#FF3366",
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
    const gap = this._config.gapSize || 0.3;
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
    this.accumulationMode.setSpikeCount(count, this.ctx);
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
    this.targetMode.setTotal(n);
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
  /** Pegs, bars and straight walls in play (see obstacles.ts); the canvas draws them in the wall colour. */
  getObstacles() {
    return this.obstacles;
  }
  /** Obstacle contacts of the last second, for the canvas glow. */
  getObstacleHits() {
    return this.obstacleHits;
  }
  getElapsedMs() {
    return this._elapsedMs;
  }
  isSimulationFinished() {
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
  consumeSoundEvents(): SoundEvent[] {
    const events = this.pendingSoundEvents;
    this.pendingSoundEvents = [];
    return events;
  }
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

  // ---------------------------------------------------------------- balls

  addBall(ball: NewBall) {
    this.balls.push({ ...ball, id: this.nextId++, trail: [], trailIndex: 0, spin: 0, angle: 0 });
  }
  removeBall(id: number) {
    this.balls = this.balls.filter((b) => b.id !== id);
  }
  clear() {
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
    this.setObstacles([]);
  }

  private setObstacles(obstacles: Obstacle[]) {
    this.obstacles = obstacles;
    this.obstaclesSpin = hasSpinningObstacles(obstacles);
    this.obstacleHits = [];
  }

  setConfig(patch: Partial<PhysicsConfig>) {
    const oldW = this._config.width;
    const oldH = this._config.height;
    const oldWallCount = this._config.wallCount;
    const oldGap = this._config.gapSize;
    this._config = { ...this._config, ...patch };
    this.extras = resolvePhysicsExtras(this._config);
    this.breathing = this.extras.breathingAmplitude > 0;
    this.interaction = resolveBallInteraction(this._config);
    if (patch.ballColor !== undefined) for (const b of this.balls) b.color = patch.ballColor;
    // Balls with a size spread (Ball Drop) keep their ratio to the configured radius; the others take it as is.
    if (patch.ballRadius !== undefined) for (const b of this.balls) b.radius = patch.ballRadius * (b.radiusScale ?? 1);
    const sizeChanged =
      (patch.width !== undefined && patch.width !== oldW) || (patch.height !== undefined && patch.height !== oldH);
    if (sizeChanged && oldW > 0 && oldH > 0) {
      const sx = this._config.width / oldW;
      const sy = this._config.height / oldH;
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
      const handled = this.currentMode?.onConfigChange(this.ctx, sizeChanged, wallCountChanged, gapChanged);
      if (!handled) this.initializeCircularWalls();
      this.syncWallBaseRadii();
      this.brokenWalls.clear();
    }
    // Re-applies the pulse to the current walls, or restores the base radii when breathing was just switched off.
    this.applyBreathing();
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
   */
  private applyBreathing(tMs = this._elapsedMs) {
    const amplitude = this.extras.breathingAmplitude;
    if (amplitude === 0 && this.breathScale === 1) return;
    const walls = this.circularWalls;
    if (this.wallBaseRadii.length !== walls.length) this.syncWallBaseRadii();
    const scale = breathingScale(amplitude, this.extras.breathingSpeed, tMs / 1000);
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
    this.timeAccumulator += dt;
    const extras = this.extras;
    while (this.timeAccumulator >= this.FIXED_STEP_MS) {
      this.timeAccumulator -= this.FIXED_STEP_MS;
      this._elapsedMs += this.FIXED_STEP_MS;
      const stepMs = this.FIXED_STEP_MS;
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

      // Physics extras: air drag acts once per 60 Hz step; the gravity direction, wind and spin
      // terms are constant within the step and applied per sub-step below. Each is skipped at
      // its default so a run without extras takes exactly the original code path.
      if (extras.airDrag > 0) {
        const keep = 1 - extras.airDrag;
        for (const ball of this.balls) {
          ball.vx *= keep;
          ball.vy *= keep;
        }
      }
      const rotatingGravity = extras.rotatingGravity !== 0;
      const gAngle = rotatingGravity ? gravityAngle(extras.rotatingGravity, this._elapsedMs / 1000) : 0;
      const gDirX = rotatingGravity ? Math.cos(gAngle) : 0;
      const gDirY = rotatingGravity ? Math.sin(gAngle) : 1;
      const wind = extras.windX !== 0 || extras.windY !== 0;
      const spinning = extras.spinStrength > 0;
      const magnus = extras.spinStrength * MAGNUS_COEFFICIENT;
      // The ring modes keep every ball at least at its base speed; a mode whose balls may rest (Ball Drop) opts out.
      const keepMoving = !this.currentMode?.ballsMayRest;
      const hasObstacles = this.obstacles.length > 0;

      const subSteps =
        this.bouncierEnabled && this.bounceSpeedMultiplier > 1.5 ? Math.ceil(4 * this.bounceSpeedMultiplier) : 4;
      const subMs = stepMs / subSteps;
      const subSec = subMs / 1000;
      const spinDecay = spinning ? spinDecayFactor(subSec) : 1;
      const stepStartMs = this._elapsedMs - stepMs;
      if (hasObstacles) this.subStepGravity = (this._config.gravity * (this._config.ballSpeed || 400) * subSec) / 300;
      for (let s = 0; s < subSteps; s++) {
        // Breathing walls move once per sub-step (a quarter of the per-step jump or less) and the collision
        // pass below sweeps each wall over that move, so even the fastest, widest pulse cannot step over a
        // ball. The last sub-step lands exactly on the step's end time, so the radii a frame renders (and
        // `setConfig()` recomputes) are the same values the per-step pulse produced.
        if (this.breathing) this.applyBreathing(s === subSteps - 1 ? this._elapsedMs : stepStartMs + (s + 1) * subMs);
        if (this.obstaclesSpin) advanceObstacles(this.obstacles, subSec);
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
            if (speed > 0 && speed < baseSpeed) {
              const boost = 1 + 0.5 * subSec;
              ball.vx *= boost;
              ball.vy *= boost;
            }
          }
          ball.x += ball.vx * subSec;
          ball.y += ball.vy * subSec;
          this.currentMode?.onBallStep(this.ctx, ball, subSec);
          if (s === 0 && ball.lifetime !== undefined) {
            ball.lifetime -= stepMs;
            if (ball.lifetime <= 0) {
              this.balls.splice(i, 1);
              continue;
            }
          }
          if (hasObstacles) this.handleObstacleCollisions(ball, subSec);
          if (!this.currentMode?.shouldSkipWallCollision(ball)) this.handleCircularWallCollisions(ball);
        }
        this.handleBallCollisions();
        this.currentMode?.onPostSubStep(this.ctx);
      }
      this.currentMode?.onPostUpdate(this.ctx, stepMs);
      if (this.pendingSplits.length > 0) this.flushSplits();
      for (const ball of this.balls) {
        if (ball.trail.length < 20) ball.trail.push({ x: ball.x, y: ball.y });
        else {
          ball.trail[ball.trailIndex].x = ball.x;
          ball.trail[ball.trailIndex].y = ball.y;
          ball.trailIndex = (ball.trailIndex + 1) % 20;
        }
      }
    }
    this.updateParticles(frameMs / 1000);
  }

  /**
   * Resolves the ball against every obstacle (obstacles.ts): the push-out and rebound always happen; a
   * contact at `OBSTACLE_HIT_SPEED` or more is reported to the mode, queued as a "hit" sound (with the
   * pitch the mode returns, otherwise the innermost-wall tone) and remembered for the glow. The wall
   * bounciness extra scales the obstacle restitution like it scales every other rebound.
   */
  private handleObstacleCollisions(ball: Ball, dtSec: number) {
    const obstacles = this.obstacles;
    const scale = this.extras.wallBounciness;
    // A resting ball meets its support at the speed one sub-step of (its own) gravity gave it: only clearly faster contacts are hits.
    const restingSpeed = 3 * this.subStepGravity * (ball.gravityScale ?? 1);
    const hitSpeed = restingSpeed > OBSTACLE_HIT_SPEED ? restingSpeed : OBSTACLE_HIT_SPEED;
    for (let i = 0; i < obstacles.length; i++) {
      const impact = resolveBallObstacle(ball, obstacles[i], dtSec, scale);
      if (impact < hitSpeed) continue; // no contact (−1) or a soft, resting one
      const result = this.currentMode?.onObstacleHit?.(this.ctx, ball, obstacles[i], i, impact);
      if (!result?.suppressGlow) this.addObstacleHit(i, ball.x, ball.y);
      if (result?.suppressSound) continue;
      if (result?.frequency !== undefined) this.pendingSoundEvents.push({ type: "hit", wallIndex: 0, frequency: result.frequency });
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

  private handleCircularWallCollisions(ball: Ball) {
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
      if (!this.processWallCollisions(ball, cx, cy, dist, angle, this.breathing && iter === 0)) break;
    }
  }

  /**
   * Resolves the ball against every intact wall. With `swept` the walls may have moved since the ball
   * was last resolved against them (breathing walls; `wallPrevRadii` holds where each one was): the
   * ball's side is then judged against that previous radius and the hit test covers the whole move,
   * so a wall that jumped over the ball still hits it and pushes it back to the side it came from,
   * and a gap that swept past the ball's centre counts as a pass. With `prev === radius` the swept
   * test is exactly the plain one, so a run without breathing walls takes the original code path.
   */
  private processWallCollisions(ball: Ball, cx: number, cy: number, dist: number, angle: number, swept = false): boolean {
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
      if (this.brokenWalls.has(w)) continue;
      const wall = this.circularWalls[w];
      const rotation = this.wallRotations[w];
      const inner = dist - ball.radius - 2;
      const outer = dist + ball.radius + 2;
      let inside: boolean;
      /** The wall (with its gap) moved past the ball's centre since the last pass: an inside ball is now outside it. */
      let crossed = false;
      if (swept) {
        const prev = w < this.wallPrevRadii.length ? this.wallPrevRadii[w] : wall.radius;
        inside = dist < prev;
        if (inside ? outer < wall.radius : inner > wall.radius) continue;
        crossed = inside && dist >= wall.radius;
      } else {
        if (!(inner <= wall.radius && outer >= wall.radius)) continue;
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
      if (inGap) {
        const movingOut = ball.vx * nx + ball.vy * ny > 0;
        if (!inside || movingOut || crossed) {
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
          const handled = this.currentMode?.onGapPass(this.ctx, ball, w);
          if (!handled) {
            if (!this.brokenWalls.has(w)) {
              this.spawnWallBreakByStyle(w, ball.x, ball.y);
              this.pendingSoundEvents.push({ type: "gap", wallIndex: w });
              this.reportWallBreak(ball, w);
            }
            this.brokenWalls.add(w);
          }
        }
      } else {
        const push = isShatter ? ball.radius + 0.5 : ball.radius + 3;
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
        const result = this.currentMode?.onWallHit(this.ctx, ball, w, angle);
        if (!result?.suppressGlow) this.addWallHit(w, angle, wall.radius);
        this.pendingSoundEvents.push({ type: "hit", wallIndex: w });
        if (this.bouncierEnabled && !result?.resetBouncier) {
          this.bounceSpeedMultiplier = Math.min(this.bounceSpeedMultiplier + this.bouncierIncrement, this.bouncierMaxMultiplier);
        }
        if (!result?.suppressBounce) {
          const baseSpeed = this._config.ballSpeed || 400;
          // Wall bounciness (restitution) scales the rebound speed; it is 1 by default (an exact no-op).
          const speed = baseSpeed * this.bounceSpeedMultiplier * this.cinematicDirector.getSpeedMultiplier() * this.extras.wallBounciness;
          const scatter = Math.PI / 3;
          let outAngle = (inside ? Math.atan2(-ny, -nx) : Math.atan2(ny, nx)) + (2 * this.random() - 1) * scatter;
          outAngle = this.cinematicDirector.adjustRebound(ball, outAngle, wall.radius, rotation, wall.gaps);
          // A mode may steer the rebound further (Paint's guided coverage); it draws no random numbers.
          if (this.currentMode?.adjustRebound) outAngle = this.currentMode.adjustRebound(this.ctx, ball, w, outAngle);
          ball.vx = Math.cos(outAngle) * speed;
          ball.vy = Math.sin(outAngle) * speed;
        } else if (this.extras.wallBounciness !== 1) {
          // The mode set the rebound itself (Grow, Portal teleports…): restitution still applies to it.
          ball.vx *= this.extras.wallBounciness;
          ball.vy *= this.extras.wallBounciness;
        }
        collided = true;
      }
    }
    return collided;
  }

  private initializeCircularWalls() {
    const maxR = (Math.min(this._config.width, this._config.height) / 2) * 0.85;
    const count = this._config.wallCount || 7;
    this.circularWalls = [];
    this.wallRotations = [];
    for (let i = 0; i < count; i++) {
      const radius = maxR * (0.4 + (0.6 / count) * (i + 1));
      const gap = this._config.gapSize || 0.3;
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
    this.currentMode?.onBallCollision?.(this.ctx, a, b);
  }

  /**
   * Resolves every pair of balls according to the ball interaction (interactions.ts): the classic elastic
   * rebound in "bounce" and "split" mode (the halves of a split must not fly through each other), a fusion
   * in "merge" mode, nothing at all in "pass" mode.
   */
  private handleBallCollisions() {
    const interaction = this.interaction.ballInteraction;
    if (interaction === "pass") return;
    const merge = interaction === "merge";
    for (let a = 0; a < this.balls.length; a++) {
      for (let b = a + 1; b < this.balls.length; b++) {
        if (!merge) this.handleBallCollision(this.balls[a], this.balls[b]);
        else if (this.mergeBallPair(a, b)) b--; // ball b was absorbed into a and the next ball now sits at index b
      }
    }
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
    this.balls.splice(ib, 1);
    this.lastWallLayer.delete(b.id);
    this.pendingSoundEvents.push({ type: "merge", wallIndex: 0 });
    this.spawnMergeBurst(a.x, a.y, a.color, a.radius);
    return true;
  }

  /**
   * A ball just broke through (or escaped) a wall – reported by the engine's own gap pass and by the modes
   * that break walls themselves (`ctx.reportWallBreak()`). With the "split" interaction the ball is queued
   * and splits at the end of the current step: after the rebound / escape bookkeeping that follows the break,
   * outside every loop over the balls, and once per ball per step however many walls it broke.
   */
  private reportWallBreak(ball: Ball, wallIndex: number) {
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
      this.addBall({ ...second, color: ball.color, lifetime: ball.lifetime, gravityScale: ball.gravityScale });
      const half = this.balls[this.balls.length - 1];
      half.spin = ball.spin;
      half.angle = ball.angle;
      this.currentMode?.onBallSplit?.(this.ctx, ball, half);
      this.pendingSoundEvents.push({ type: "split", wallIndex });
      this.spawnSplitBurst(x, y, ball.color);
    }
    this.pendingSplits.length = 0;
  }

  private addWallHit(wallIndex: number, angle: number, radius: number) {
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
    this.particles.push(p);
  }

  spawnConfetti(x: number, y: number) {
    const colors = ["#FF6B6B", "#4ECDC4", "#FFE66D", "#95E1D3", "#F38181", "#AA96DA", "#FCBAD3", "#A8D8EA"];
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
      p.vy += 400 * dtSec;
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
