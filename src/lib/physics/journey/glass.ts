import {
  BOUNCE_MAX,
  BOUNCE_MIN,
  BOUNCE_OF_SPACING,
  DRIFT,
  HIT_SPEED,
  HOLE_WIDTH,
  MAX_DRIFT,
  PANE_RESTITUTION,
  SHATTER_KEEP,
  glassPitch,
  glassTempo,
  hopSpeed,
  makeCrack,
  paneDamage,
  paneThickness,
  stageHue,
  updatePaneSegments,
  type GlassPane,
  type GlassPaneKind,
  type GlassView,
} from "../modes/glass";
import { hitDamage } from "../multipliers";
import { resolveBallSegment, segmentObstacle } from "../obstacles";
import type { Ball } from "../types";
import { rescaleShards, shiftShards, spawnShards, stageGlassLevel, stageGlassView, stepShards, syncField } from "./glassBits";
import { BaseStage, type StageEnv, type StageMap, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "glass" – a few panes from Glass Smash across the column: 2 (small), 3 (medium) or 5 (large) panes of 1–2 hit
 * points, a large stage's later panes sometimes with a hole. Built from Glass Smash's own pieces – `paneThickness()`,
 * the capsules of `updatePaneSegments()` resolved with `resolveBallSegment()`, `makeCrack()`, the shard counts, the
 * hop height rule, `glassPitch()` – with its landing rule: any contact from above cracks the pane and hops the ball
 * back up (so it never rests on glass), the last hit point shatters it (the accented note, the wall-break sound, the
 * shards) and the ball crashes through. The damage multiplier of a gate stage above takes more hit points a hit.
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
  hits = 0;
  shattered = 0;
  private passCursor = 0;

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
    this.hits = 0;
    this.shattered = 0;
    this.passCursor = 0;
  }

  maxBallRadius() {
    let max = this.panes.length > 1 ? (this.spacing - this.panes[0].thickness) / 2 - 1 : Infinity;
    for (const pane of this.panes) if (pane.kind === "hole" && pane.holeHalf > 0) max = Math.min(max, pane.holeHalf - 1);
    return max;
  }

  onBallStep(env: StageEnv, ball: Ball, dtSec: number) {
    const reachY = ball.radius + Math.abs(ball.vy) * dtSec + 2;
    for (const pane of this.panes) {
      if (pane.shattered || Math.abs(ball.y - pane.y) > pane.thickness / 2 + reachY) continue;
      for (const seg of pane.segments) {
        // --- bounce-math --- a knock from below rebounds with the ball's bounciness on top of the pane's (capped) restitution;
        // a landing's hop takes it in hitPane() (a landing sets the hop afresh, so nothing compounds)
        const impact = resolveBallSegment(ball, seg, dtSec, 1, undefined, ball.restitution ?? 1);
        if (impact < 0) continue;
        // Glass Smash's rule: a contact from above is always a landing; a knock from below needs HIT_SPEED.
        if (impact >= HIT_SPEED || ball.y < pane.y) this.hitPane(env, ball, pane, Math.max(impact, HIT_SPEED));
        break;
      }
    }
  }

  private hitPane(env: StageEnv, ball: Ball, pane: GlassPane, impact: number) {
    const ctx = env.ctx;
    const fromAbove = ball.y < pane.y;
    ctx.noteBounce?.(ball); // --- bounce-math --- a pane hit is a bounce
    pane.hp = Math.max(0, pane.hp - hitDamage(ball));
    pane.hits++;
    pane.lastHitMs = env.timeMs;
    this.hits++;
    this.view.hits++;
    const impactX = ball.x - pane.x;
    pane.cracks.push(makeCrack(pane, impactX, fromAbove, paneDamage(pane), env.timeMs, () => ctx.random()));
    if (pane.hp <= 0) {
      pane.shattered = true;
      pane.shatteredAtMs = env.timeMs;
      pane.cleared = true;
      this.shattered++;
      this.view.shattered++;
      spawnShards(this.view, pane, impactX, ball.vy, () => ctx.random());
      ball.vy = (fromAbove ? 1 : -1) * impact * SHATTER_KEEP;
      env.sound({ type: "hit", wallIndex: 0, frequency: pane.pitch, accent: true }, true);
      env.sound({ type: "gap", wallIndex: 0 }, true);
      return;
    }
    if (fromAbove) {
      const b = this.bounds;
      const k = glassTempo(ball);
      ball.vy = -hopSpeed(env.gravity(ball), this.bounceHeight) * (ball.restitution ?? 1); // --- bounce-math --- the ball's bounciness
      const speedScale = (ctx.config.ballSpeed || 400) / 400;
      const drift = DRIFT * b.viewH * speedScale * k;
      const cap = MAX_DRIFT * b.viewH * Math.max(0.5, speedScale) * k;
      ball.vx = Math.max(-cap, Math.min(cap, 0.5 * ball.vx + (2 * ctx.random() - 1) * drift));
    }
    env.sound({ type: "hit", wallIndex: 0, frequency: pane.pitch }, false);
  }

  update(env: StageEnv, ball: Ball | null, dtSec: number, active: boolean) {
    this.view.timeMs = env.timeMs;
    if (this.view.shardCount > 0) stepShards(this.view, dtSec, env.gravity(), this.bounds.left, this.bounds.right);
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
    for (const pane of this.panes) {
      pane.x = map.x(pane.x);
      pane.baseX = map.x(pane.baseX);
      pane.y = map.y(pane.y);
      pane.halfWidth *= k;
      pane.thickness *= k;
      pane.holeX *= k;
      pane.holeHalf *= k;
      for (const seg of pane.segments) seg.thickness = pane.thickness;
      for (const crack of pane.cracks) {
        crack.x *= k;
        crack.y *= k;
        crack.length *= k;
        for (let i = 0; i < 5 * crack.count; i++) crack.segs[i] *= k;
      }
      updatePaneSegments(pane);
    }
    rescaleShards(this.view, map);
    if (this.view.level) syncField(this.view.level, this.bounds);
  }

  render(painter: StagePainter) {
    painter.glass(this);
  }
}
