import type { Obstacle } from "../obstacles";
import type { Ball, ModeContext, ObstacleHitResult, SoundEvent } from "../types";
import { glassPitch, type GlassField } from "../modes/glass";
import type { JourneyStageKind, JourneyStageSize } from "./sequence";
// Type-only imports of the stage classes the painter draws (erased at runtime, so no import cycle).
import type { RingsStage } from "./rings";
import type { GlassStage } from "./glass";
import type { PegsStage } from "./pegs";
import type { GatesStage } from "./gates";
import type { FunnelStage } from "./funnel";
import type { BullseyeStage } from "./bullseye";
import type { HomeStage } from "./home";

/**
 * The Stage interface of the Journey mode (feature boris-journey) and what every stage shares. A journey is a vertical
 * column of stages stacked top-down; each stage is an adapter around code the other modes already run – the engine's
 * own ring walls (Classic), the panes, cracks and shards of Glass Smash, the peg board of Ball Drop, the gate rows and
 * the multiplier runtime of the multipliers, the obstacle layer (funnels, platforms, the ground) and the HOME doorway of
 * Glass Smash – so the physics is never written twice. The Journey mode (modes/journey.ts) owns the ball, the gravity,
 * the camera and the transitions and asks the active stage what to do in every step:
 *
 *   init(bounds)   lay the stage out inside its band of the column (seeded numbers from the engine's generator),
 *   enter          the ball came in through the top – the stage is the active one now,
 *   onBallStep     every sub-step while active (collisions of the stage's own pieces, scripted motion),
 *   update         every 60 Hz step (moving parts, shards, timers – every stage, active or not),
 *   onBallExit     the ball left through the bottom,
 *   render         describe itself to a `StagePainter` (the canvas side implements the drawing, the physics stays DOM-free).
 *
 * Coordinates are canvas pixels. The journey keeps the active stage centred on the canvas (a floating origin: entering a
 * stage shifts the whole world – `shift()` – so the stage's centre is the canvas centre, where the engine's ring walls
 * live), and the camera scrolls between stages.
 */

/** A stage's band of the column (canvas px; `shift()` / `rescale()` move it). */
export interface StageBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  width: number;
  height: number;
  /** The layout unit: the height of the visible field (px). */
  viewH: number;
}

/** A uniform map of the world onto a resized canvas: positions through `x()` / `y()`, lengths × `k`. */
export interface StageMap {
  x(value: number): number;
  y(value: number): number;
  k: number;
}

/** What the journey hands a stage while it runs. */
export interface StageEnv {
  readonly ctx: ModeContext;
  /** Simulation time of the current step (ms). */
  readonly timeMs: number;
  /** The column the stages sit in (the visible field of the canvas). */
  readonly field: GlassField;
  /** The journey's gravity on `ball` (px/s²; the Gravity setting and the ball's speed multiplier included); a ×1 ball without one. */
  gravity(ball?: Pick<Ball, "mult"> | null): number;
  /** Queues a sound event – at most a few per step unless `always`. */
  sound(event: SoundEvent, always?: boolean): void;
  /** The largest radius the ball may grow to and still get through every stage from `from` on. */
  maxBallRadius(from: number): number;
  /** Bullseye points for the run's score. */
  addScore(points: number): void;
}

/** A hard hit on a stage's obstacle (one object, reused by the journey for every hit). */
export interface StageObstacleHit {
  env: StageEnv;
  ball: Ball;
  obstacle: Obstacle;
  /** Approach speed along the contact normal (px/s). */
  impact: number;
}

/** Draws each kind of stage (implemented by components/simulator/journeyRenderer.ts). */
export interface StagePainter {
  rings(stage: RingsStage): void;
  glass(stage: GlassStage): void;
  pegs(stage: PegsStage): void;
  gates(stage: GatesStage): void;
  funnel(stage: FunnelStage): void;
  bullseye(stage: BullseyeStage): void;
  home(stage: HomeStage): void;
}

export interface JourneyStage {
  readonly kind: JourneyStageKind;
  readonly size: JourneyStageSize;
  /** Position in the journey (0 = the first stage). */
  readonly index: number;
  readonly bounds: StageBounds;
  /** The stage's engine obstacles (pegs, bars, funnel walls, platforms, the ground); the journey hands them all to the engine. */
  readonly obstacles: Obstacle[];
  /** The stage brings its own side walls (a rings chamber wider than the column): the journey's column walls skip its band. */
  readonly ownWalls: boolean;
  /** Half the width the ball may use in this stage (the column's, or a chamber's) – the journey's safety net keeps it inside. */
  readonly reach: number;
  /** Lays the stage out inside `bounds`; every random number comes from `random` (a fixed count per kind and size). */
  init(bounds: StageBounds, random: () => number, ballRadius: number): void;
  enter?(env: StageEnv, ball: Ball): void;
  onBallStep?(env: StageEnv, ball: Ball, dtSec: number): void;
  update?(env: StageEnv, ball: Ball | null, dtSec: number, active: boolean): void;
  /** The engine reported a hard hit on one of the stage's obstacles (the rebound is done): a pitch, or suppress the sound. */
  onObstacleHit?(hit: StageObstacleHit): ObstacleHitResult | void;
  onBallExit?(env: StageEnv, ball: Ball): void;
  /** The stage scripts the ball's motion right now (no journey gravity, no stuck nudges). */
  controlsBall(): boolean;
  /** The ball is meant to stay still here for a moment (a landing waiting for the trapdoor): no stuck nudges. */
  holdsBall?(): boolean;
  /** The ball may come to rest (no slow-ball boost); false only inside live rings. */
  ballMayRest(): boolean;
  /** The engine's ring collisions are off for the ball (all but live rings). */
  skipsWallCollision(): boolean;
  /** Gravity to use instead of the journey's (the rings' Classic gravity), or −1. */
  gravityOverride?(env: StageEnv, ball: Ball): number;
  /** The largest ball radius that still gets through this stage. */
  maxBallRadius(): number;
  /** HOME: Boris is home and the celebration is over. */
  isFinished(): boolean;
  /** Moves the stage by `dy` (the floating origin). */
  shift(dy: number): void;
  /** Maps the stage onto a resized canvas. */
  rescale(map: StageMap): void;
  render(painter: StagePainter): void;
}

/* ------------------------------------------------------------------ shared numbers */

/** Height of a stage in view heights, by kind and size (small, medium, large). */
export const STAGE_HEIGHTS: Record<JourneyStageKind, Record<JourneyStageSize, number>> = {
  rings: { s: 0.66, m: 0.78, l: 0.88 },
  glass: { s: 0.5, m: 0.66, l: 0.92 },
  pegs: { s: 0.55, m: 0.78, l: 1.1 },
  multipliers: { s: 0.46, m: 0.56, l: 0.78 },
  funnel: { s: 0.5, m: 0.66, l: 0.98 },
  bullseye: { s: 0.52, m: 0.64, l: 0.84 },
  home: { s: 0.46, m: 0.54, l: 0.66 },
};

/** Height (px) of a stage of `kind` and `size` for a view `viewH` px tall. */
export function stageHeightPx(kind: JourneyStageKind, size: JourneyStageSize, viewH: number): number {
  return STAGE_HEIGHTS[kind][size] * viewH;
}

/** Colour of each stage kind (the mini-map, the banner's accent, the stage labels). */
export const STAGE_COLORS: Record<JourneyStageKind, string> = {
  rings: "#22d3ee",
  glass: "#a5f3fc",
  pegs: "#93d119",
  multipliers: "#a78bfa",
  funnel: "#fb923c",
  bullseye: "#f87171",
  home: "#fbbf24",
};

/** Most sounds a stage may queue in one 60 Hz step (the forced ones – shatters, landings, HOME – always go). */
export const MAX_STAGE_SOUNDS_PER_STEP = 4;

/** Pitch of scale degree `degree` of C major from C4 (folded into two octaves) – Glass Smash's pane pitch, reused by every stage. */
export function stagePitch(degree: number): number {
  return glassPitch(0, degree);
}

/** Shifts an obstacle by `dy` (the floating origin). */
export function shiftObstacle(o: Obstacle, dy: number) {
  o.y += dy;
}

/** Maps an obstacle onto a resized canvas. */
export function rescaleObstacle(o: Obstacle, map: StageMap) {
  o.x = map.x(o.x);
  o.y = map.y(o.y);
  if (o.kind === "circle") o.radius *= map.k;
  else {
    o.halfLength *= map.k;
    o.thickness *= map.k;
  }
}

/** Shared defaults of the stage adapters: bounds, obstacles, shifting and rescaling them; a stage overrides what it needs. */
export abstract class BaseStage implements JourneyStage {
  abstract readonly kind: JourneyStageKind;
  readonly bounds: StageBounds = { left: 0, right: 0, top: 0, bottom: 0, cx: 0, width: 0, height: 0, viewH: 1 };
  readonly obstacles: Obstacle[] = [];
  ownWalls = false;
  reach = 0;
  protected constructor(
    readonly index: number,
    readonly size: JourneyStageSize,
  ) {}

  init(bounds: StageBounds, random: () => number, ballRadius: number): void {
    Object.assign(this.bounds, bounds);
    this.obstacles.length = 0;
    this.ownWalls = false;
    this.reach = bounds.width / 2;
    this.layout(random, Math.max(2, ballRadius));
  }
  /** Builds the stage inside `this.bounds`. */
  protected abstract layout(random: () => number, ballRadius: number): void;

  controlsBall() {
    return false;
  }
  ballMayRest() {
    return true;
  }
  skipsWallCollision() {
    return true;
  }
  maxBallRadius() {
    return Infinity;
  }
  isFinished() {
    return false;
  }
  shift(dy: number): void {
    const b = this.bounds;
    b.top += dy;
    b.bottom += dy;
    for (const o of this.obstacles) shiftObstacle(o, dy);
    this.shiftOwn?.(dy);
  }
  /** Moves the stage's own geometry (beyond its bounds and obstacles). */
  protected shiftOwn?(dy: number): void;
  rescale(map: StageMap): void {
    const b = this.bounds;
    b.left = map.x(b.left);
    b.right = map.x(b.right);
    b.top = map.y(b.top);
    b.bottom = map.y(b.bottom);
    b.cx = map.x(b.cx);
    b.width *= map.k;
    b.height *= map.k;
    b.viewH *= map.k;
    this.reach *= map.k;
    for (const o of this.obstacles) rescaleObstacle(o, map);
    this.rescaleOwn?.(map);
  }
  /** Maps the stage's own geometry (beyond its bounds and obstacles). */
  protected rescaleOwn?(map: StageMap): void;
  abstract render(painter: StagePainter): void;
}
