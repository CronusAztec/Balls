import { GROUND_NOTE, GROUND_RESTITUTION, holdAtDoor, landedOnGround, reachDoor, stepHomeCelebration, walkToDoor, type GlassHome, type GlassView } from "../modes/glass";
import { segmentBetween, type SegmentObstacle } from "../obstacles";
import type { Ball, ObstacleHitResult } from "../types";
import { stageGlassLevel, stageGlassView, syncField } from "./glassBits";
import { BaseStage, type StageEnv, type StageMap, type StageObstacleHit, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "home" – the last stage: Glass Smash's HOME – the ground and a doorway on a seeded side – played by Glass Smash's
 * own rules (modes/glass.ts): once the ball is down on the ground (`landedOnGround()`) it rolls to the door
 * (`walkToDoor()`), in the doorway Gerald is home (`reachDoor()`: the HOME chord) and `stepHomeCelebration()` sets off
 * the three bursts of confetti and, after CELEBRATION_MS, finishes the run. The Glass Smash renderer draws the doorway
 * (its warm light once Gerald is home) from this stage's own Glass Smash view.
 */

export class HomeStage extends BaseStage {
  readonly kind = "home" as const;
  readonly view: GlassView;
  groundY = 0;
  doorX = 0;
  doorWidth = 0;
  doorHeight = 0;
  ground: SegmentObstacle | null = null;
  landed = false;
  private confetti = 0;

  constructor(index: number, size: JourneyStageSize) {
    super(index, size);
    this.view = stageGlassView(stageGlassLevel(this.bounds, 8));
  }

  protected layout(random: () => number, r: number) {
    const b = this.bounds;
    const doorLeft = random() < 0.5;
    this.groundY = b.bottom - 0.06 * b.viewH;
    this.doorWidth = Math.max(3.4 * r, 0.2 * b.width);
    this.doorHeight = Math.min(0.3 * b.viewH, Math.max(4.5 * r, 0.17 * b.viewH));
    this.doorX = b.left + (doorLeft ? 0.25 : 0.75) * b.width;
    this.ground = segmentBetween(b.left, this.groundY, b.right, this.groundY, { restitution: GROUND_RESTITUTION });
    this.obstacles.push(this.ground);
    this.view.level = stageGlassLevel(b, r);
    this.syncHome();
    this.landed = false;
    this.confetti = 0;
    this.view.homeReached = false;
    this.view.homeAtMs = -Infinity;
    this.view.finished = false;
  }

  /** The doorway as Glass Smash's rules and renderer see it (kept in step with the stage after a shift or a rescale). */
  private get door(): GlassHome {
    return this.view.level!.home;
  }

  private syncHome() {
    const level = this.view.level;
    if (!level) return;
    syncField(level, this.bounds);
    const home = level.home;
    home.top = this.bounds.top;
    home.groundY = this.groundY;
    home.doorX = this.doorX;
    home.doorWidth = this.doorWidth;
    home.doorHeight = this.doorHeight;
    level.worldBottom = this.groundY + 0.04 * this.bounds.viewH;
  }

  /** Gerald is home (the view's HOME clock started). */
  get home() {
    return this.view.homeReached;
  }
  /** Simulation time Gerald got home (ms), −Infinity before. */
  get homeAtMs() {
    return this.view.homeAtMs;
  }

  controlsBall() {
    return this.view.homeReached;
  }
  holdsBall() {
    return this.landed;
  }
  maxBallRadius() {
    return this.doorWidth / 2 - 1;
  }
  isFinished() {
    return this.view.finished;
  }

  onObstacleHit(hit: StageObstacleHit): ObstacleHitResult | void {
    // The ground thuds (C3).
    if (hit.obstacle === this.ground) return { frequency: GROUND_NOTE };
  }

  onBallStep(env: StageEnv, ball: Ball, dtSec: number) {
    const home = this.door;
    if (this.view.homeReached) {
      holdAtDoor(home, ball);
      return;
    }
    if (!this.landed && landedOnGround(home, ball)) this.landed = true;
    if (!this.landed) return;
    if (walkToDoor(home, ball, this.bounds.viewH, dtSec)) reachDoor(this.view, home, ball, env.timeMs, env.sound);
  }

  update(env: StageEnv) {
    this.view.timeMs = env.timeMs;
    if (this.view.homeReached) this.confetti = stepHomeCelebration(this.view, this.door, env.timeMs, this.confetti, env.ctx);
  }

  protected shiftOwn(dy: number) {
    this.groundY += dy;
    this.syncHome();
  }

  protected rescaleOwn(map: StageMap) {
    this.groundY = map.y(this.groundY);
    this.doorX = map.x(this.doorX);
    this.doorWidth *= map.k;
    this.doorHeight *= map.k;
    this.syncHome();
  }

  render(painter: StagePainter) {
    painter.home(this);
  }
}
