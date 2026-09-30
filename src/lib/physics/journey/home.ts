import { CELEBRATION_MS, GROUND_NOTE, GROUND_RESTITUTION, HOME_CHORD, WALK_SPEED, glassTempo, type GlassView } from "../modes/glass";
import { segmentBetween, type SegmentObstacle } from "../obstacles";
import type { Ball, ObstacleHitResult } from "../types";
import { stageGlassLevel, stageGlassView, syncField } from "./glassBits";
import { BaseStage, type StageEnv, type StageMap, type StageObstacleHit, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "home" – the last stage: Glass Smash's HOME – the ground and a doorway on a seeded side. The ball lands, rolls to the
 * door (`WALK_SPEED`), and in the doorway the HOME chord rings, three bursts of confetti go off and, after the
 * celebration (`CELEBRATION_MS`), the run is finished. The Glass Smash renderer draws the doorway (its warm light once
 * Gerald is home) from this stage's own Glass Smash view.
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
  home = false;
  homeAtMs = -Infinity;
  finished = false;
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
    const level = stageGlassLevel(b, r);
    this.view.level = level;
    this.syncHome();
    this.landed = false;
    this.home = false;
    this.homeAtMs = -Infinity;
    this.finished = false;
    this.confetti = 0;
    this.view.homeReached = false;
    this.view.homeAtMs = -Infinity;
  }

  private syncHome() {
    const level = this.view.level;
    if (!level) return;
    syncField(level, this.bounds);
    level.home = { top: this.bounds.top, groundY: this.groundY, doorX: this.doorX, doorWidth: this.doorWidth, doorHeight: this.doorHeight };
    level.worldBottom = this.groundY + 0.04 * this.bounds.viewH;
  }

  controlsBall() {
    return this.home;
  }
  holdsBall() {
    return this.landed;
  }
  maxBallRadius() {
    return this.doorWidth / 2 - 1;
  }
  isFinished() {
    return this.finished;
  }

  onObstacleHit(hit: StageObstacleHit): ObstacleHitResult | void {
    // The ground thuds (C3).
    if (hit.obstacle === this.ground) return { frequency: GROUND_NOTE };
  }

  onBallStep(env: StageEnv, ball: Ball, dtSec: number) {
    if (this.home) {
      // Gerald stands in his doorway.
      ball.vx = 0;
      ball.vy = 0;
      ball.x = this.doorX;
      ball.y = this.groundY - ball.radius - 0.5;
      return;
    }
    if (!this.landed && ball.y + ball.radius >= this.groundY - 1) this.landed = true;
    if (!this.landed) return;
    // On the ground: roll to the door.
    const dx = this.doorX - ball.x;
    const walk = WALK_SPEED * this.bounds.viewH * glassTempo(ball);
    ball.vx = Math.abs(dx) < walk * dtSec ? dx / dtSec : Math.sign(dx) * walk;
    if (Math.abs(dx) < 0.22 * this.doorWidth && ball.y + ball.radius > this.groundY - 0.5 * this.doorHeight) this.reachHome(env, ball);
  }

  private reachHome(env: StageEnv, ball: Ball) {
    this.home = true;
    this.homeAtMs = env.timeMs;
    this.view.homeReached = true;
    this.view.homeAtMs = env.timeMs;
    ball.vx = 0;
    ball.vy = 0;
    ball.x = this.doorX;
    ball.y = this.groundY - ball.radius - 0.5;
    env.sound({ type: "hit", wallIndex: 0, frequency: HOME_CHORD[0], chord: [...HOME_CHORD], accent: true }, true);
  }

  update(env: StageEnv) {
    this.view.timeMs = env.timeMs;
    if (!this.home) return;
    // Three bursts of confetti from the doorway, then the run is over.
    const since = env.timeMs - this.homeAtMs;
    while (this.confetti < 3 && since >= this.confetti * 400) {
      env.ctx.spawnConfetti(this.doorX, this.groundY - this.doorHeight * (0.6 + 0.3 * this.confetti));
      this.confetti++;
    }
    if (since >= CELEBRATION_MS) this.finished = true;
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
