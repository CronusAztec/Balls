import {
  BOUNCE_MAX,
  BOUNCE_MIN,
  BOUNCE_OF_SPACING,
  HOLE_WIDTH,
  PANE_RESTITUTION,
  glassPitch,
  glassReach,
  hitGlassPane,
  mapGlassPane,
  paneThickness,
  stageHue,
  stepGlassShards,
  touchGlassPane,
  updatePaneSegments,
  type GlassHitOptions,
  type GlassPane,
  type GlassPaneKind,
  type GlassView,
} from "../modes/glass";
import { segmentObstacle } from "../obstacles";
import type { Ball } from "../types";
import { rescaleShards, shiftShards, stageGlassLevel, stageGlassView, syncField } from "./glassBits";
import { BaseStage, type StageEnv, type StageMap, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "glass" – a few panes from Glass Smash across the column: 2 (small), 3 (medium) or 5 (large) panes of 1–2 hit
 * points, a large stage's later panes sometimes with a hole. Laid out from Glass Smash's own pieces – `paneThickness()`,
 * the capsules of `updatePaneSegments()`, the hop height rule, `glassPitch()` – and played by Glass Smash's own rules
 * (modes/glass.ts): `touchGlassPane()` (any contact from above is a landing, so the ball never rests on glass) and
 * `hitGlassPane()` (the crack and the hop back up, or on the last hit point the shatter – the accented note, the
 * wall-break sound, `spawnGlassShards()` – and the ball crashes through), the shards flying by `stepGlassShards()`. The
 * damage multiplier of a gate stage above takes more hit points a hit.
 */

export const GLASS_PANES: Record<JourneyStageSize, number> = { s: 2, m: 3, l: 5 };
export const GLASS_HP: Record<JourneyStageSize, number> = { s: 1, m: 2, l: 2 };
/** Chance of a hole in a large stage's panes after the first. */
export const GLASS_HOLE_CHANCE = 0.35;

export class GlassStage extends BaseStage {
  readonly kind = "glass" as const;
  readonly view: GlassView;
  panes: GlassPane[] = [];
  spacing = 0;
  bounceHeight = 0;
  private passCursor = 0;
  /** The options every pane hit shares (one object, made for the journey's env and filled in per hit). */
  private hitOptions: GlassHitOptions | null = null;
  private hitEnv: StageEnv | null = null;

  constructor(index: number, size: JourneyStageSize) {
    super(index, size);
    this.view = stageGlassView(stageGlassLevel(this.bounds, 8));
  }

  protected layout(random: () => number, r: number) {
    const b = this.bounds;
    const level = stageGlassLevel(b, r);
    const n = GLASS_PANES[this.size];
    const hp = GLASS_HP[this.size];
    const thickness = paneThickness(hp, b.viewH);
    const zoneTop = b.top + 0.24 * b.height;
    const zoneBottom = b.bottom - 0.08 * b.height;
    const spacing = Math.max(thickness + 2.6 * r + 2, (zoneBottom - zoneTop) / n);
    this.spacing = spacing;
    this.bounceHeight = Math.max(BOUNCE_MIN * b.viewH, Math.min(BOUNCE_MAX * b.viewH, BOUNCE_OF_SPACING * spacing));
    const panes: GlassPane[] = [];
    for (let j = 0; j < n; j++) {
      // Three numbers per pane whatever its kind (as Glass Smash draws them), so one pane never shifts the next.
      const u = random();
      const v = random();
      random();
      const kind: GlassPaneKind = this.size === "l" && j > 0 && u < GLASS_HOLE_CHANCE ? "hole" : "plain";
      const pane: GlassPane = {
        index: j,
        stage: this.index,
        row: j,
        kind,
        x: b.cx,
        y: zoneTop + (j + 0.5) * spacing,
        halfWidth: b.width / 2,
        thickness,
        baseX: b.cx,
        moveAmp: 0,
        movePeriod: 1,
        movePhase: 0,
        holeX: 0,
        holeHalf: 0,
        maxHp: hp,
        hp,
        hits: 0,
        cracks: [],
        lastHitMs: -Infinity,
        shattered: false,
        shatteredAtMs: -Infinity,
        cleared: false,
        hue: stageHue(this.index),
        pitch: glassPitch(this.index, j),
        segments: [segmentObstacle(b.cx, 0, 0, 0, { thickness, restitution: PANE_RESTITUTION })],
      };
      if (kind === "hole") {
        pane.holeHalf = Math.max(HOLE_WIDTH * b.width, 2 * r + thickness + 2.4 * r) / 2;
        const margin = 0.08 * b.width + pane.holeHalf;
        pane.holeX = -b.width / 2 + margin + v * Math.max(0, b.width - 2 * margin);
        pane.segments.push(segmentObstacle(b.cx, 0, 0, 0, { thickness, restitution: PANE_RESTITUTION }));
      }
      updatePaneSegments(pane);
      panes.push(pane);
    }
    this.panes = panes;
    level.panes = panes;
    this.view.level = level;
    this.view.panes = panes.length;
    this.view.shardCount = 0;
    this.view.hits = 0;
    this.view.shattered = 0;
    this.view.cleared = 0;
    this.passCursor = 0;
  }

  /** Landings and knocks on the stage's panes so far (the Glass Smash view counts them). */
  get hits() {
    return this.view.hits;
  }
  /** Panes shattered so far. */
  get shattered() {
    return this.view.shattered;
  }

  maxBallRadius() {
    let max = this.panes.length > 1 ? (this.spacing - this.panes[0].thickness) / 2 - 1 : Infinity;
    for (const pane of this.panes) if (pane.kind === "hole" && pane.holeHalf > 0) max = Math.min(max, pane.holeHalf - 1);
    return max;
  }

  onBallStep(env: StageEnv, ball: Ball, dtSec: number) {
    const reachY = glassReach(ball, dtSec);
    for (const pane of this.panes) {
      const impact = touchGlassPane(pane, ball, dtSec, reachY);
      if (impact >= 0) hitGlassPane(this.view, pane, ball, impact, this.hitOptionsFor(env, ball));
    }
  }

  private hitOptionsFor(env: StageEnv, ball: Ball): GlassHitOptions {
    let o = this.hitOptions;
    if (!o || this.hitEnv !== env) {
      o = this.hitOptions = {
        random: () => env.ctx.random(),
        sound: env.sound,
        gravity: 0,
        bounceHeight: 0,
        timeMs: 0,
        ballSpeed: 400,
        noteBounce: (b) => env.ctx.noteBounce?.(b),
      };
      this.hitEnv = env;
    }
    o.gravity = env.gravity(ball);
    o.bounceHeight = this.bounceHeight;
    o.timeMs = env.timeMs;
    o.ballSpeed = env.ctx.config.ballSpeed || 400;
    return o;
  }

  update(env: StageEnv, ball: Ball | null, dtSec: number, active: boolean) {
    this.view.timeMs = env.timeMs;
    if (this.view.shardCount > 0) stepGlassShards(this.view, dtSec, env.gravity(), this.bounds.left, this.bounds.right);
    if (!active || !ball) return;
    // Panes the ball got below (through a hole, or shattered) are cleared.
    while (this.passCursor < this.panes.length) {
      const pane = this.panes[this.passCursor];
      if (!pane.shattered && ball.y - ball.radius <= pane.y + pane.thickness / 2) break;
      pane.cleared = true;
      this.passCursor++;
    }
  }

  protected shiftOwn(dy: number) {
    for (const pane of this.panes) {
      pane.y += dy;
      updatePaneSegments(pane);
    }
    shiftShards(this.view, dy);
    if (this.view.level) syncField(this.view.level, this.bounds);
  }

  protected rescaleOwn(map: StageMap) {
    const k = map.k;
    this.spacing *= k;
    this.bounceHeight *= k;
    for (const pane of this.panes) mapGlassPane(pane, map.x, map.y, k);
    rescaleShards(this.view, map);
    if (this.view.level) syncField(this.view.level, this.bounds);
  }

  render(painter: StagePainter) {
    painter.glass(this);
  }
}
