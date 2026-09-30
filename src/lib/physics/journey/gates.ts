import { GATE_Y, buildGlassGates, gateSlotAt, type GlassGateRow, type GlassStage as GlassSmashStage, type GlassView } from "../modes/glass";
import { applyMultiplier } from "../multipliers";
import { circleObstacle } from "../obstacles";
import type { Ball, ObstacleHitResult } from "../types";
import { stageGlassLevel, stageGlassView, syncField } from "./glassBits";
import { BaseStage, stagePitch, type StageEnv, type StageMap, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "multipliers" – 2–3 rows of multiplier gates across the column: Glass Smash's gate rows (`buildGlassGates()`: x2 DMG,
 * x1.5 SPEED, x1.25 SIZE in a seeded order, one slot per stat) with a splitter peg over each divider. The slot the
 * ball's centre falls through (`gateSlotAt()`) stacks its multiplier on the ball at the end of the step through the
 * run's multiplier runtime – the cap, the HUD badges, the rising arpeggio – exactly as a Glass Smash gate does, and the
 * multipliers act on the rest of the journey: damage breaks glass faster, speed runs the flight faster, size grows the
 * ball (never beyond what the stages below still let through).
 */

export const GATE_ROWS: Record<JourneyStageSize, number> = { s: 2, m: 2, l: 3 };

export class GatesStage extends BaseStage {
  readonly kind = "multipliers" as const;
  readonly view: GlassView;
  rows: GlassGateRow[] = [];
  /** First row the ball has not gone through, and first one gone through but not applied yet (they apply at the end of the step). */
  private cursor = 0;
  private applied = 0;
  passed = 0;
  pegRadius = 0;

  constructor(index: number, size: JourneyStageSize) {
    super(index, size);
    this.view = stageGlassView(stageGlassLevel(this.bounds, 8));
  }

  protected layout(random: () => number, r: number) {
    const b = this.bounds;
    const level = stageGlassLevel(b, r);
    const n = GATE_ROWS[this.size];
    const field = level.field;
    const first = b.top + 0.3 * b.height;
    const last = b.bottom - 0.18 * b.height;
    const gap = n > 1 ? (last - first) / (n - 1) : 0;
    // Glass Smash places a row GATE_Y view heights below the top of its stage: give it stages whose tops put the rows here.
    const gateY = GATE_Y * field.height;
    const stand: GlassSmashStage[] = [];
    for (let i = 0; i < n; i++) stand.push({ index: this.index, top: first + i * gap - gateY, bottom: first + i * gap, rows: 0, hp: 0, spacing: 0, bounceHeight: 0, firstPane: 0, holes: 0, moving: 0 });
    this.rows = buildGlassGates(field, stand, random);
    level.gates = this.rows;
    this.view.level = level;
    // A splitter peg over every divider, a little above its row.
    this.pegRadius = Math.max(3, Math.min(7, 0.012 * b.viewH));
    for (const row of this.rows) {
      for (let i = 0; i < row.slots.length - 1; i++) this.obstacles.push(circleObstacle(row.slots[i].x1, row.y - 0.07 * b.viewH, this.pegRadius, { restitution: 0.6 }));
    }
    this.cursor = 0;
    this.applied = 0;
    this.passed = 0;
    this.view.gatesPassed = 0;
  }

  maxBallRadius() {
    const row = this.rows[0];
    if (!row) return Infinity;
    // Between a splitter peg and a wall, or two pegs.
    return (row.slots[0].x1 - row.slots[0].x0 - this.pegRadius) / 2 - 2;
  }

  onBallStep(env: StageEnv, ball: Ball) {
    while (this.cursor < this.rows.length && ball.y >= this.rows[this.cursor].y) {
      const row = this.rows[this.cursor++];
      row.passedSlot = gateSlotAt(row, ball.x);
      row.passedAtMs = env.timeMs;
    }
  }

  onObstacleHit(): ObstacleHitResult | void {
    return { frequency: stagePitch(4 + this.index) };
  }

  update(env: StageEnv, ball: Ball | null) {
    this.view.timeMs = env.timeMs;
    while (this.applied < this.cursor) {
      const row = this.rows[this.applied++];
      if (ball && row.passedSlot >= 0) this.applyGate(env, ball, row);
    }
  }

  /** The gate the ball went through: its stat stacks through the run's multipliers (a size gate only as far as the stages below allow). */
  private applyGate(env: StageEnv, ball: Ball, row: GlassGateRow) {
    const slot = row.slots[row.passedSlot];
    let factor = slot.factor;
    if (slot.kind === "size") factor = Math.min(factor, Math.max(1, env.maxBallRadius(this.index + 1) / ball.radius));
    const runtime = env.ctx.getMultipliers?.();
    runtime?.markTouched();
    row.applied = factor > 1 ? (runtime ? runtime.apply(ball, slot.kind, factor) : applyMultiplier(ball, slot.kind, factor)) : 1;
    this.passed++;
    this.view.gatesPassed++;
    if (slot.kind === "size" && row.applied !== 1) ball.x = Math.max(this.bounds.left + ball.radius, Math.min(this.bounds.right - ball.radius, ball.x));
    if (row.applied !== 1 && ball.mult) env.sound({ type: "multiplier", wallIndex: 0, multiplier: ball.mult[slot.kind] }, true);
  }

  protected shiftOwn(dy: number) {
    for (const row of this.rows) row.y += dy;
    if (this.view.level) syncField(this.view.level, this.bounds);
  }

  protected rescaleOwn(map: StageMap) {
    this.pegRadius *= map.k;
    for (const row of this.rows) {
      row.y = map.y(row.y);
      for (const slot of row.slots) {
        slot.x0 = map.x(slot.x0);
        slot.x1 = map.x(slot.x1);
      }
    }
    if (this.view.level) syncField(this.view.level, this.bounds);
  }

  render(painter: StagePainter) {
    painter.gates(this);
  }
}
