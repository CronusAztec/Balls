/*
 * --- blueprint --- The events of a run: what the world reports while the engine steps it (`WorldEvents`), and the queue the
 * rules read them from. The queue is preallocated (BLUEPRINT_EVENTS_PER_STEP slots, written in place), so the physics
 * callbacks only record – they never allocate and never run a rule. Past the budget an event is dropped and counted.
 *
 * Two queues take turns: `now` holds this step's events (the rules run over it in onPostUpdate, the one place they run) and
 * `next` the events an action causes (a tile a `damage` breaks), which wait for the NEXT step – so a chain of rules can
 * never recurse inside a step.
 */
import type { Trigger } from "../schema";
import type { WorldBall } from "./world";

/** What the world reports while it steps (the interpreter queues these as events). */
export interface WorldEvents {
  wallHit(ball: WorldBall, impact: number): void;
  obstacleHit(ball: WorldBall, obstacle: number, impact: number): void;
  tileHit(ball: WorldBall, tile: number, broke: boolean, impact: number): void;
  ballHit(a: WorldBall, b: WorldBall, impact: number): void;
  ringPass(ball: WorldBall, ring: number): void;
  escape(ball: WorldBall): void;
}

/** One queued event: its trigger, the ball it is about (`self`), the other ball (ballHit), the tile (−1: none) and the timer rule (−1). */
export interface QueuedEvent {
  trigger: Trigger;
  self: WorldBall | null;
  other: WorldBall | null;
  tile: number;
  rule: number;
}

/** A queue of at most `capacity` events, its slots allocated once and overwritten in place. */
export class EventQueue {
  readonly capacity: number;
  readonly slots: QueuedEvent[];
  length = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.slots = Array.from({ length: capacity }, () => ({ trigger: "start" as Trigger, self: null, other: null, tile: -1, rule: -1 }));
  }

  /** Records an event; false (and nothing recorded) when the queue is full. */
  push(trigger: Trigger, self: WorldBall | null, other: WorldBall | null, tile: number, rule: number): boolean {
    if (this.length >= this.capacity) return false;
    const e = this.slots[this.length++];
    e.trigger = trigger;
    e.self = self;
    e.other = other;
    e.tile = tile;
    e.rule = rule;
    return true;
  }

  /** Empties the queue (the slots drop their balls, so a removed ball is not kept alive by an old event). */
  clear() {
    for (let i = 0; i < this.length; i++) {
      this.slots[i].self = null;
      this.slots[i].other = null;
    }
    this.length = 0;
  }
}
