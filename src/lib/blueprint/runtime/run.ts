/*
 * --- blueprint --- One run of a Blueprint: the interpreter. Each fixed 60 Hz step:
 *
 *  1. the clock: `start` (first step), `beat` / `bar` (sound.bpm), each `timer` rule; then the spawners;
 *  2. the world steps (runtime/world.ts) and reports its events – each one counted at once (escapes, the first ball out,
 *     its voice), then queued for the rules up to BLUEPRINT_EVENTS_PER_STEP (the rest are dropped and counted);
 *  3. the rules run, the one place they run: event by event, rule by rule in list order, each firing its actions, up to
 *     BLUEPRINT_RULE_FIRINGS_PER_STEP. An event an action causes (a tile a `damage` breaks) waits for the NEXT step's queue,
 *     so a chain of rules can never recurse inside a step. `countReached` rules check their counts after the events;
 *  4. removals are swept, and queued balls (spawns, splits) join – BLUEPRINT_SPAWNS_PER_STEP a step, never past
 *     BLUEPRINT_BALL_CEILING (past it: ARENA FULL, counted);
 *  5. the finish: the first condition met (after it was once unmet), else the timeout.
 *
 * Fault containment: only the rule dispatch is wrapped – should it ever throw, the rules stop and the run ends 1 s later
 * with reason "fault". Randomness: only the run's seeded generator (Mulberry32 of the seed, or the engine's ctx.random()
 * when a mode hands it in), drawn only where the spec asks for it (a `chance` below 1, `r` in a formula, a random place,
 * direction or colour). No clock: a seed replays exactly, on any machine.
 *
 * This is the runtime the blueprint mode (Mode Lab, lib/physics/modes/blueprint.ts) steps inside the engine, and what
 * playabilityCheck (check.ts) runs headless.
 */
import { BLUEPRINT_LIMITS as L, BLUEPRINT_STEP_BUDGETS as BUDGET, BLUEPRINT_BALL_CEILING } from "../limits";
import { evaluateBlueprintFormula, SLOT } from "../formula";
import { DEFAULT_SAY, type Blueprint, type BlueprintFinishCondition, type Direction, type FxKind, type ImpulseDirection, type SpawnAt, type Trigger, type Voice } from "../schema";
import { compileBlueprint, type CompiledAction, type CompiledBlueprint, type CompiledNum, type CompiledRule } from "./compile";
import { BlueprintWorld, FIXED_STEP_SEC, MIN_HIT_SPEED, type NewWorldBall, type WorldBall, type WorldEvents } from "./world";

export type FinishReason = "condition" | "timeout" | "fault";

/** What a run counts: every number is deterministic (no clock). */
export interface RunStats {
  steps: number;
  peakBalls: number;
  /** Balls refused at the ball ceiling (ARENA FULL). */
  arenaFull: number;
  /** World events past the per-step budget. */
  droppedEvents: number;
  /** Rule firings past the per-step budget. */
  droppedFirings: number;
  /** Actions that had nothing to act on or a meaningless result (a formula giving NaN, a merge without another ball…). */
  refusedActions: number;
  faults: number;
  /** Balls that went non-finite and were taken out. */
  nanBalls: number;
  sounds: number;
  /** Sounds past the per-step budget (silent, not an error). */
  soundsCapped: number;
  /** Seconds until a ball first moves (null: never). */
  firstMotionSec: number | null;
  /** Seconds until the first payoff: a tile broken, an escape, a ring passed, a merge or a split (null: none). */
  payoffSec: number | null;
  events: number;
  firings: number;
  spawned: number;
  escaped: number;
  tilesBroken: number;
  effects: number;
  /** The world's contact tests and pair checks. */
  contacts: number;
}

export interface RunResult {
  finished: boolean;
  reason: FinishReason | null;
  /** The finish condition met (its index in finish.any), or −1. */
  condition: number;
  timeSec: number;
  /** The winning team (−1: none). */
  winner: number;
  /** The end banner's line ("RED WINS", "CLEARED", "TIME UP"…). */
  result: string;
}

export interface RunOptions {
  seed: number;
  /** The run's random numbers in [0, 1) (default: Mulberry32 of the seed; the mode hands in the engine's ctx.random()). */
  random?: () => number;
  /** Conformance tests only: firing rule i throws, to prove fault containment. */
  faultOnRule?: number;
}

/** Mulberry32: the engine's seeded generator. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface QueuedEvent {
  trigger: Trigger;
  self: WorldBall | null;
  other: WorldBall | null;
  tile: number;
  rule: number;
}

const TAU = Math.PI * 2;

export class BlueprintRun implements WorldEvents {
  readonly bp: Blueprint;
  readonly world: BlueprintWorld;
  readonly compiled: CompiledBlueprint;
  readonly vars: Float64Array;
  readonly stats: RunStats = {
    steps: 0,
    peakBalls: 0,
    arenaFull: 0,
    droppedEvents: 0,
    droppedFirings: 0,
    refusedActions: 0,
    faults: 0,
    nanBalls: 0,
    sounds: 0,
    soundsCapped: 0,
    firstMotionSec: null,
    payoffSec: null,
    events: 0,
    firings: 0,
    spawned: 0,
    escaped: 0,
    tilesBroken: 0,
    effects: 0,
    contacts: 0,
  };
  timeSec = 0;
  beats = 0;
  /** This step's sounds, in order (the blueprint mode turns them into the engine's SoundEvents; the check counts them). */
  readonly stepSounds: { voice: Voice; pitch: number }[] = [];
  /** This step's visual effects, where they happened (world px). */
  readonly stepEffects: { kind: FxKind; x: number; y: number }[] = [];
  private readonly random: () => number;
  private readonly slots: Float64Array;
  private queue: QueuedEvent[] = [];
  private pending: QueuedEvent[] = [];
  private spawnQueue: NewWorldBall[] = [];
  private firingsThisStep = 0;
  private soundsThisStep = 0;
  private readonly ruleMatches: number[];
  private readonly ruleFires: number[];
  private readonly ruleLast: number[];
  private readonly ruleTimerFired: number[];
  private readonly countWas: boolean[];
  private readonly finishArmed: boolean[];
  private readonly spawnerFired: number[];
  private readonly spawnerMade: number[];
  private readonly escapedByBody: number[];
  private firstOutTeam = -1;
  private lastOutTeam = -1;
  private rulesOff = false;
  private faultAt = -1;
  private readonly faultOnRule: number;
  private teamsSeen = 0;
  private done: RunResult = { finished: false, reason: null, condition: -1, timeSec: 0, winner: -1, result: "" };

  constructor(bp: Blueprint, options: RunOptions) {
    this.bp = bp;
    this.world = new BlueprintWorld(bp);
    this.compiled = compileBlueprint(bp);
    this.random = options.random ?? mulberry32(options.seed);
    this.faultOnRule = options.faultOnRule ?? -1;
    this.vars = Float64Array.from(bp.vars.map((v) => v.start));
    this.slots = new Float64Array(SLOT.firstVar + bp.vars.length);
    const n = bp.rules.length;
    this.ruleMatches = new Array(n).fill(0);
    this.ruleFires = new Array(n).fill(0);
    this.ruleLast = new Array(n).fill(-Infinity);
    this.ruleTimerFired = new Array(n).fill(0);
    this.countWas = new Array(n).fill(false);
    this.finishArmed = new Array(bp.finish.any.length).fill(false);
    this.spawnerFired = new Array(bp.spawners.length).fill(0);
    this.spawnerMade = new Array(bp.spawners.length).fill(0);
    this.escapedByBody = new Array(bp.bodies.length).fill(0);
    // the first balls: every spawner due at 0 s places its balls at once
    this.runSpawners(true);
    this.drainSpawns(Infinity);
    this.noteBalls();
  }

  get finished(): boolean {
    return this.done.finished;
  }

  result(): RunResult {
    return { ...this.done };
  }

  /* ------------------------------------------------------------------ the step */

  /** One fixed step (1/60 s). Does nothing once the run has finished. */
  step(): void {
    if (this.done.finished) return;
    const dt = FIXED_STEP_SEC;
    this.timeSec += dt;
    this.stats.steps++;
    this.firingsThisStep = 0;
    this.soundsThisStep = 0;
    this.stepSounds.length = 0;
    this.stepEffects.length = 0;
    // the events actions caused last step come first
    this.queue = this.pending;
    this.pending = [];
    if (this.stats.steps === 1) this.push({ trigger: "start", self: null, other: null, tile: -1, rule: -1 });
    this.clockEvents();
    this.runSpawners(false);
    this.world.advance(dt, this);
    if (!this.rulesOff) {
      try {
        this.dispatch();
        this.countRules();
      } catch {
        this.stats.faults++;
        this.rulesOff = true;
        this.faultAt = this.timeSec;
      }
    }
    this.world.sweep();
    this.drainSpawns(BUDGET.spawns);
    this.noteBalls();
    this.stats.nanBalls = this.world.nanBalls;
    this.stats.contacts = this.world.work;
    this.checkFinish();
  }

  /** Steps until the run finishes or `maxSec` of run time passed. */
  runToEnd(maxSec = this.bp.finish.timeoutSec + 2): RunResult {
    const steps = Math.ceil(maxSec / FIXED_STEP_SEC);
    for (let i = 0; i < steps && !this.done.finished; i++) this.step();
    return this.result();
  }

  private noteBalls() {
    const balls = this.world.balls;
    let alive = 0;
    let moving = false;
    for (const b of balls) {
      if (!b.alive) continue;
      alive++;
      if (!moving && b.vx * b.vx + b.vy * b.vy > 1) moving = true;
    }
    const teams = this.teamsLeft();
    if (alive > this.stats.peakBalls) this.stats.peakBalls = alive;
    if (teams > this.teamsSeen) this.teamsSeen = teams;
    if (moving && this.stats.firstMotionSec === null) this.stats.firstMotionSec = this.timeSec;
  }

  private payoff() {
    if (this.stats.payoffSec === null) this.stats.payoffSec = this.timeSec;
  }

  /* ------------------------------------------------------------------ the clock and the spawners */

  private clockEvents() {
    const t = this.timeSec;
    const bpm = this.bp.sound.bpm;
    const beatSec = 60 / bpm;
    const beats = Number.isFinite(beatSec) && beatSec > 0 ? Math.floor(t / beatSec) : 0;
    if (beats > this.beats) {
      const barNow = Math.floor(beats / 4) > Math.floor(this.beats / 4);
      this.beats = beats;
      this.push({ trigger: "beat", self: null, other: null, tile: -1, rule: -1 });
      if (barNow) this.push({ trigger: "bar", self: null, other: null, tile: -1, rule: -1 });
    }
    for (const i of this.compiled.byTrigger.timer) {
      const sec = this.compiled.rules[i].spec.sec;
      const due = Math.floor(t / sec);
      if (due > this.ruleTimerFired[i]) {
        this.ruleTimerFired[i] = due;
        this.push({ trigger: "timer", self: null, other: null, tile: -1, rule: i });
      }
    }
  }

  /** Spawners due now queue their balls (one firing a step at most, whatever their period). */
  private runSpawners(initial: boolean) {
    const t = this.timeSec;
    this.compiled.spawners.forEach((s, i) => {
      const spec = s.spec;
      if (this.spawnerMade[i] >= spec.maxTotal) return;
      let due: number;
      if (spec.onBeat) {
        if (initial || t < spec.startSec) return;
        due = this.beats;
        if (due <= this.spawnerFired[i]) return;
      } else {
        if (t + 1e-9 < spec.startSec) return;
        if (initial && spec.startSec > 0) return;
        due = spec.everySec > 0 ? Math.floor((t - spec.startSec) / spec.everySec + 1e-9) + 1 : 1;
        if (due <= this.spawnerFired[i]) return;
      }
      this.spawnerFired[i] = due;
      const n = this.spawnerFired[i];
      const count = Math.min(spec.maxTotal - this.spawnerMade[i], this.countOf(s.count, n, null, L.perSpawn, 1));
      if (count <= 0) return;
      const speed = this.valueOf(s.speed, n, null);
      if (!Number.isFinite(speed)) {
        this.stats.refusedActions++;
        return;
      }
      this.spawnerMade[i] += count;
      this.placeBalls(s.body, count, spec.at, null, -1, speed, spec.dir);
    });
  }

  /** Queues `count` balls of a body at a place, moving at `speed` towards `dir`. */
  private placeBalls(body: number, count: number, at: SpawnAt | "self" | "tile", self: WorldBall | null, tile: number, speed: number, dir: Direction) {
    const b = this.bp.bodies[body];
    const w = this.world;
    const R = w.R;
    const ring = count > 1 ? b.radius * Math.max(1.2, count * 0.45) : 0;
    const start = count > 1 ? this.random() * TAU : 0;
    for (let k = 0; k < count; k++) {
      let x = w.cx;
      let y = w.cy;
      switch (at) {
        case "self":
          if (self) {
            x = self.x;
            y = self.y;
          }
          break;
        case "tile":
          if (tile >= 0 && tile < w.tileCount) {
            x = w.tileX[tile];
            y = w.tileY[tile];
          } else if (self) {
            x = self.x;
            y = self.y;
          }
          break;
        case "top":
        case "bottom":
          x = w.cx + (this.random() * 2 - 1) * 0.35 * R;
          y = w.cy + (at === "top" ? -0.7 : 0.7) * R;
          break;
        case "left":
        case "right":
          x = w.cx + (at === "left" ? -0.7 : 0.7) * R;
          y = w.cy + (this.random() * 2 - 1) * 0.35 * R;
          break;
        case "random": {
          if (w.shape === "box") {
            x = w.cx + (this.random() * 2 - 1) * 0.75 * R;
            y = w.cy + (this.random() * 2 - 1) * 0.75 * R;
          } else {
            const rr = 0.75 * R * Math.sqrt(this.random());
            const a = this.random() * TAU;
            x = w.cx + rr * Math.cos(a);
            y = w.cy + rr * Math.sin(a);
          }
          break;
        }
        case "rim": {
          const a = this.random() * TAU;
          const rr = Math.max(0, 0.85 * R - b.radius);
          x = w.cx + rr * Math.cos(a);
          y = w.cy + rr * Math.sin(a);
          break;
        }
        default:
          break;
      }
      if (ring > 0 && (at === "center" || at === "self" || at === "tile")) {
        const a = start + (k / count) * TAU;
        x += ring * Math.cos(a);
        y += ring * Math.sin(a);
      }
      const [vx, vy] = this.velocity(dir, speed, x, y);
      this.queueBall({ x, y, vx, vy, r: b.radius, gs: b.gravityScale, pass: b.collide === "pass", body, tier: b.tier, team: b.team, hp: b.hp, color: b.color });
    }
    this.voice("spawn", 0);
  }

  private velocity(dir: Direction | ImpulseDirection, speed: number, x: number, y: number, from?: WorldBall | null): [number, number] {
    let ux = 0;
    let uy = 0;
    const w = this.world;
    switch (dir) {
      case "up":
        uy = -1;
        break;
      case "down":
        uy = 1;
        break;
      case "left":
        ux = -1;
        break;
      case "right":
        ux = 1;
        break;
      case "out":
      case "in":
      case "away": {
        const ox = dir === "away" && from ? from.x : w.cx;
        const oy = dir === "away" && from ? from.y : w.cy;
        const dx = x - ox;
        const dy = y - oy;
        const d = Math.hypot(dx, dy);
        if (d > 1e-6) {
          ux = (dir === "in" ? -dx : dx) / d;
          uy = (dir === "in" ? -dy : dy) / d;
          break;
        }
        const a = this.random() * TAU;
        ux = Math.cos(a);
        uy = Math.sin(a);
        break;
      }
      default: {
        const a = this.random() * TAU;
        ux = Math.cos(a);
        uy = Math.sin(a);
      }
    }
    return [ux * speed, uy * speed];
  }

  private queueBall(ball: NewWorldBall) {
    if (this.spawnQueue.length >= BLUEPRINT_BALL_CEILING) {
      this.stats.arenaFull++;
      return;
    }
    this.spawnQueue.push(ball);
  }

  /** Queued balls join the world in order: at most `budget` this step, never past the ball ceiling. */
  private drainSpawns(budget: number) {
    if (!this.spawnQueue.length) return;
    let alive = this.world.aliveCount();
    let added = 0;
    while (this.spawnQueue.length && added < budget) {
      const next = this.spawnQueue.shift()!;
      if (alive >= BLUEPRINT_BALL_CEILING) {
        this.stats.arenaFull++;
        continue;
      }
      this.world.addBall(next);
      alive++;
      added++;
      this.stats.spawned++;
    }
  }

  /* ------------------------------------------------------------------ the world's events */

  private push(ev: QueuedEvent) {
    if (this.queue.length >= BUDGET.events) {
      this.stats.droppedEvents++;
      return;
    }
    this.queue.push(ev);
    this.stats.events++;
  }

  wallHit(ball: WorldBall, impact: number): void {
    this.voice("wallHit", 0, impact);
    this.push({ trigger: "wallHit", self: ball, other: null, tile: -1, rule: -1 });
  }

  obstacleHit(ball: WorldBall, _obstacle: number, impact: number): void {
    this.voice("obstacleHit", 0, impact);
    this.push({ trigger: "obstacleHit", self: ball, other: null, tile: -1, rule: -1 });
  }

  tileHit(ball: WorldBall, tile: number, broke: boolean, impact: number): void {
    const pitch = this.bp.tiles?.pitchBy === "row" ? this.world.tileRow[tile] : this.bp.tiles?.pitchBy === "col" ? this.world.tileCol[tile] : 0;
    if (broke) {
      this.stats.tilesBroken++;
      this.payoff();
      this.voice("tileBroken", pitch);
    } else this.voice("tileHit", pitch, impact);
    this.push({ trigger: "tileHit", self: ball, other: null, tile, rule: -1 });
    if (broke) this.push({ trigger: "tileBroken", self: ball, other: null, tile, rule: -1 });
  }

  ballHit(a: WorldBall, b: WorldBall, impact: number): void {
    if (impact >= MIN_HIT_SPEED) this.voice("ballHit", 0, impact);
    // the faster ball is self (ties: the older one)
    const sa = a.vx * a.vx + a.vy * a.vy;
    const sb = b.vx * b.vx + b.vy * b.vy;
    const aFirst = sa > sb || (sa === sb && a.id < b.id);
    this.push({ trigger: "ballHit", self: aFirst ? a : b, other: aFirst ? b : a, tile: -1, rule: -1 });
  }

  ringPass(ball: WorldBall, ring: number): void {
    this.payoff();
    this.voice("ringPass", ring);
    this.push({ trigger: "ringPass", self: ball, other: null, tile: -1, rule: -1 });
  }

  escape(ball: WorldBall): void {
    this.stats.escaped++;
    this.escapedByBody[ball.body]++;
    if (this.firstOutTeam < 0) this.firstOutTeam = ball.team;
    this.lastOutTeam = ball.team;
    this.payoff();
    this.voice("escape", 0);
    this.push({ trigger: "escape", self: ball, other: null, tile: -1, rule: -1 });
  }

  /** A sound: a world event's voice (when the spec gives it one and the hit is a hit) or an action's. */
  private voice(trigger: keyof Blueprint["sound"]["voices"], pitch: number, impact = Infinity) {
    const v = this.bp.sound.voices[trigger];
    if (v === "none" || impact < MIN_HIT_SPEED) return;
    this.sound(v, pitch);
  }

  private sound(voice: Voice, pitch: number) {
    if (this.soundsThisStep >= BUDGET.sounds) {
      this.stats.soundsCapped++;
      return;
    }
    this.soundsThisStep++;
    this.stats.sounds++;
    this.stepSounds.push({ voice, pitch });
  }

  /* ------------------------------------------------------------------ the rules */

  private dispatch() {
    const rules = this.compiled.rules;
    for (let q = 0; q < this.queue.length; q++) {
      const ev = this.queue[q];
      const ids = ev.trigger === "timer" ? [ev.rule] : this.compiled.byTrigger[ev.trigger];
      for (const i of ids) {
        const rule = rules[i];
        if (ev.trigger === "ballHit") {
          const a = ev.self!;
          const b = ev.other!;
          if (!a.alive || !b.alive) break; // (a merge or a removal earlier this step)
          if (this.matches(rule, a, b)) this.consider(rule, a, b, ev.tile);
          else if (this.matches(rule, b, a)) this.consider(rule, b, a, ev.tile);
          continue;
        }
        const self = ev.self;
        if (self && !self.alive && ev.trigger !== "escape") break;
        // (`of` filters the event's ball; a trigger without one acts on every ball of `of` – targets())
        if (rule.of >= 0 && self && self.body !== rule.of) continue;
        this.consider(rule, self, null, ev.tile);
      }
    }
  }

  private matches(rule: CompiledRule, self: WorldBall, other: WorldBall): boolean {
    if (rule.of >= 0 && self.body !== rule.of) return false;
    if (rule.withBody >= 0) return other.body === rule.withBody;
    switch (rule.relation) {
      case "same":
        return other.body === self.body;
      case "sameTier":
        return other.tier === self.tier;
      case "sameTeam":
        return other.team === self.team;
      case "otherTeam":
        return other.team !== self.team;
      default:
        return true;
    }
  }

  /** A matching event: the rule's filters (every, chance, cooldown, maxFires), the step's budget, then its actions. */
  private consider(rule: CompiledRule, self: WorldBall | null, other: WorldBall | null, tile: number) {
    const spec = rule.spec;
    const i = rule.index;
    this.ruleMatches[i]++;
    if (this.ruleMatches[i] % spec.every !== 0) return;
    if (spec.maxFires > 0 && this.ruleFires[i] >= spec.maxFires) return;
    if (spec.cooldownSec > 0 && this.timeSec - this.ruleLast[i] < spec.cooldownSec) return;
    if (spec.chance < 1 && !(this.random() < spec.chance)) return;
    if (this.firingsThisStep >= BUDGET.ruleFirings) {
      this.stats.droppedFirings++;
      return;
    }
    this.firingsThisStep++;
    this.stats.firings++;
    this.ruleFires[i]++;
    this.ruleLast[i] = this.timeSec;
    if (i === this.faultOnRule) throw new Error("injected fault");
    for (const action of rule.actions) this.act(rule, action, self, other, tile);
  }

  /** countReached rules: each fires when its count crosses its bound (again only after it went back). */
  private countRules() {
    for (const i of this.compiled.byTrigger.countReached) {
      const rule = this.compiled.rules[i];
      const spec = rule.spec;
      const v = rule.whatVar >= 0 ? this.vars[rule.whatVar] : this.count(spec.what, rule.of);
      const met = (spec.atLeast !== null && v >= spec.atLeast) || (spec.atMost !== null && v <= spec.atMost);
      const was = this.countWas[i];
      this.countWas[i] = met;
      if (met && !was) this.consider(rule, null, null, -1);
    }
  }

  /* ------------------------------------------------------------------ the actions */

  /** The balls an action changes: self, other, or every ball (of the rule's body) – every ball when a global trigger says self. */
  private targets(rule: CompiledRule, target: string, self: WorldBall | null, other: WorldBall | null): WorldBall[] {
    if (target === "other") return other && other.alive ? [other] : [];
    if (target === "self" && self) return self.alive ? [self] : [];
    if (target === "self" && rule.spec.when === "escape") return [];
    return this.world.balls.filter((b) => b.alive && (rule.of < 0 || b.body === rule.of));
  }

  private act(rule: CompiledRule, action: CompiledAction, self: WorldBall | null, other: WorldBall | null, tile: number) {
    const a = action.spec;
    const n = this.ruleFires[rule.index];
    const refuse = () => {
      this.stats.refusedActions++;
    };
    switch (a.act) {
      case "spawn": {
        const count = this.countOf(action.nums.count, n, self, L.perSpawn, 0);
        const speed = this.valueOf(action.nums.speed, n, self);
        if (count <= 0 || !Number.isFinite(speed)) return refuse();
        this.placeBalls(action.body, count, a.at, self, tile, speed, a.dir);
        return;
      }
      case "split": {
        const balls = this.targets(rule, a.target, self, other);
        if (!balls.length) return refuse();
        for (const b of balls) {
          const into = Math.max(2, this.countOf(action.nums.into, n, b, L.perSpawn, 2));
          b.r *= a.scale;
          const speed = Math.hypot(b.vx, b.vy);
          const heading = speed > 0 ? Math.atan2(b.vy, b.vx) : this.random() * TAU;
          for (let k = 1; k < into; k++) {
            const h = heading + (k / into) * TAU;
            const ux = Math.cos(h);
            const uy = Math.sin(h);
            this.queueBall({ x: b.x + ux * b.r, y: b.y + uy * b.r, vx: ux * speed, vy: uy * speed, r: b.r, gs: b.gs, pass: b.pass, body: b.body, tier: b.tier, team: b.team, hp: b.hp, color: b.color });
          }
        }
        this.payoff();
        this.sound("split", 0);
        return;
      }
      case "merge": {
        if (!self || !other || !self.alive || !other.alive || self === other) return refuse();
        const ma = self.r * self.r;
        const mb = other.r * other.r;
        const m = ma + mb;
        self.x = (self.x * ma + other.x * mb) / m;
        self.y = (self.y * ma + other.y * mb) / m;
        self.vx = (self.vx * ma + other.vx * mb) / m;
        self.vy = (self.vy * ma + other.vy * mb) / m;
        self.r = a.scale > 0 ? Math.max(self.r, other.r) * a.scale : Math.sqrt(m);
        self.tier = Math.min(L.maxTier, Math.max(self.tier, other.tier) + 1);
        other.alive = false;
        this.payoff();
        this.sound("merge", self.tier);
        return;
      }
      case "remove": {
        const balls = this.targets(rule, a.target, self, other);
        if (!balls.length) return refuse();
        for (const b of balls) b.alive = false;
        return;
      }
      case "grow": {
        const balls = this.targets(rule, a.target, self, other);
        if (!balls.length) return refuse();
        for (const b of balls) {
          const by = this.valueOf(action.nums.by, n, b);
          if (!Number.isFinite(by)) {
            refuse();
            continue;
          }
          b.r += by;
          if (!(b.r >= 1)) b.alive = false; // (shrunk away: it pops)
        }
        return;
      }
      case "speed": {
        const balls = this.targets(rule, a.target, self, other);
        if (!balls.length) return refuse();
        for (const b of balls) {
          const s = this.valueOf(action.nums.scale, n, b);
          if (!Number.isFinite(s)) {
            refuse();
            continue;
          }
          b.vx *= s;
          b.vy *= s;
        }
        return;
      }
      case "recolor": {
        const balls = this.targets(rule, a.target, self, other);
        if (!balls.length) return refuse();
        const size = this.bp.look.palette.length;
        for (const b of balls) {
          if (typeof a.color === "number") b.color = a.color % size;
          else if (a.color === "next") b.color = (b.color + 1) % size;
          else if (a.color === "random") b.color = Math.floor(this.random() * size) % size;
          else if (a.color === "team") b.color = b.team % size;
          else b.color = (b.tier - 1) % size;
        }
        return;
      }
      case "tier": {
        const balls = this.targets(rule, a.target, self, other);
        if (!balls.length) return refuse();
        for (const b of balls) {
          const by = this.valueOf(action.nums.by, n, b);
          if (!Number.isFinite(by)) {
            refuse();
            continue;
          }
          b.tier = Math.max(1, Math.min(L.maxTier, b.tier + Math.round(by)));
        }
        return;
      }
      case "team": {
        const balls = this.targets(rule, a.target, self, other);
        if (!balls.length) return refuse();
        for (const b of balls) {
          if (typeof a.to === "number") b.team = a.to;
          else if (a.to === "self") b.team = self ? self.team : b.team;
          else if (a.to === "other") b.team = other ? other.team : b.team;
          else b.team = (b.team + 1) % L.teams;
        }
        this.payoff();
        return;
      }
      case "damage": {
        const amount = this.valueOf(action.nums.amount, n, self);
        if (!Number.isFinite(amount) || amount <= 0) return refuse();
        if (a.target === "tile") {
          if (tile < 0) return refuse();
          if (this.world.damageTile(tile, amount)) {
            this.stats.tilesBroken++;
            this.payoff();
            this.pending.push({ trigger: "tileBroken", self, other: null, tile, rule: -1 });
          }
          return;
        }
        const balls = this.targets(rule, a.target, self, other);
        for (const b of balls) {
          if (b.hp <= 0) continue;
          b.hp -= amount;
          if (b.hp <= 0) b.alive = false;
        }
        return;
      }
      case "var": {
        if (action.varIndex < 0) return refuse();
        const value = this.valueOf(action.nums.value, n, self);
        const cur = this.vars[action.varIndex];
        const next = a.op === "add" ? cur + value : a.op === "mul" ? cur * value : value;
        if (!Number.isFinite(next)) return refuse();
        this.vars[action.varIndex] = next;
        return;
      }
      case "impulse": {
        const balls = this.targets(rule, a.target, self, other);
        if (!balls.length) return refuse();
        for (const b of balls) {
          const amount = this.valueOf(action.nums.amount, n, b);
          if (!Number.isFinite(amount)) {
            refuse();
            continue;
          }
          const [vx, vy] = this.velocity(a.dir, amount, b.x, b.y, b === self ? other : self);
          b.vx += vx;
          b.vy += vy;
        }
        return;
      }
      case "fx":
        this.stats.effects++;
        this.stepEffects.push({ kind: a.kind, x: self ? self.x : this.world.cx, y: self ? self.y : this.world.cy });
        return;
      case "sound":
        this.sound(a.voice, a.pitch);
        return;
    }
  }

  /* ------------------------------------------------------------------ numbers and counts */

  /** A number slot's value: the constant, or the formula over the run's slots (self: the ball it is about). */
  private valueOf(num: CompiledNum | undefined, n: number, self: WorldBall | null): number {
    if (num === undefined) return NaN;
    if (typeof num === "number") return num;
    const s = this.slots;
    s[SLOT.n] = n;
    s[SLOT.t] = this.timeSec;
    s[SLOT.b] = this.beats;
    s[SLOT.r] = num.usesR ? this.random() : 0;
    s[SLOT.balls] = this.world.aliveCount();
    s[SLOT.tiles] = this.world.tilesAlive;
    s[SLOT.escaped] = this.stats.escaped;
    s[SLOT.tier] = self ? self.tier : 0;
    s[SLOT.size] = self ? self.r : 0;
    s[SLOT.speed] = self ? Math.hypot(self.vx, self.vy) : 0;
    for (let i = 0; i < this.vars.length; i++) s[SLOT.firstVar + i] = this.vars[i];
    return evaluateBlueprintFormula(num, s);
  }

  /** A count slot: whole, from 0 to `max` (a meaningless result: `fallback`). */
  private countOf(num: CompiledNum | undefined, n: number, self: WorldBall | null, max: number, fallback: number): number {
    const v = this.valueOf(num, n, self);
    if (!Number.isFinite(v)) return fallback;
    const k = Math.round(v);
    return k < 0 ? 0 : k > max ? max : k;
  }

  /** A count the spec names (`what`), of a body (−1: every ball). */
  count(what: string, of = -1): number {
    switch (what) {
      case "balls": {
        let k = 0;
        for (const b of this.world.balls) if (b.alive && (of < 0 || b.body === of)) k++;
        return k;
      }
      case "tiles":
        return this.world.tilesAlive;
      case "rings":
        return this.world.ringsAlive();
      case "escaped":
        return of < 0 ? this.stats.escaped : (this.escapedByBody[of] ?? 0);
      case "teams":
        return this.teamsLeft();
      case "tier": {
        let t = 0;
        for (const b of this.world.balls) if (b.alive && b.tier > t) t = b.tier;
        return t;
      }
      case "time":
        return this.timeSec;
      default: {
        const v = this.compiled.varIndex.get(what);
        return v === undefined ? 0 : this.vars[v];
      }
    }
  }

  /** Teams with a ball in the arena (no allocation: teams are 0-5). */
  teamsLeft(): number {
    let mask = 0;
    for (const b of this.world.balls) if (b.alive) mask |= 1 << (b.team & 31);
    let n = 0;
    for (; mask; mask &= mask - 1) n++;
    return n;
  }

  /** Balls per team, in team order. */
  teamCounts(): Map<number, number> {
    const m = new Map<number, number>();
    for (const b of this.world.balls) if (b.alive) m.set(b.team, (m.get(b.team) ?? 0) + 1);
    return new Map([...m].sort((x, y) => x[0] - y[0]));
  }

  /* ------------------------------------------------------------------ the finish */

  private met(c: BlueprintFinishCondition, i: number): boolean {
    switch (c.when) {
      case "escaped":
        return this.count("escaped", this.compiled.finishOf[i]) >= (c.atLeast ?? 1);
      case "tilesCleared":
        return this.world.tileCount > 0 && this.world.tilesAlive === 0;
      case "ringsCleared":
        return this.world.ringR.length > 0 && this.world.ringsAlive() === 0;
      case "count": {
        const v = this.compiled.finishVar[i] >= 0 ? this.vars[this.compiled.finishVar[i]] : this.count(c.what, this.compiled.finishOf[i]);
        return (c.atLeast !== null && v >= c.atLeast) || (c.atMost !== null && v <= c.atMost);
      }
      case "tier":
        return this.count("tier") >= (c.atLeast ?? 2);
      case "teamsLeft":
        return this.teamsSeen > (c.atMost ?? 1) && this.teamsLeft() <= (c.atMost ?? 1);
    }
  }

  private checkFinish() {
    if (this.faultAt >= 0) {
      if (this.timeSec >= this.faultAt + 1) this.finish("fault", -1);
      return;
    }
    const conds = this.bp.finish.any;
    for (let i = 0; i < conds.length; i++) {
      const m = this.met(conds[i], i);
      if (!this.finishArmed[i]) {
        // a condition finishes the run only after it was once unmet (balls not spawned yet never "cleared" anything)
        if (!m) this.finishArmed[i] = true;
        continue;
      }
      if (m) return this.finish("condition", i);
    }
    if (this.timeSec >= this.bp.finish.timeoutSec - 1e-9) this.finish("timeout", -1);
  }

  private winnerTeam(): number {
    switch (this.bp.finish.winner) {
      case "firstOut":
        return this.firstOutTeam;
      case "lastOut":
        return this.lastOutTeam;
      case "mostBalls": {
        let best = -1;
        let most = 0;
        for (const [team, k] of this.teamCounts()) if (k > most) [best, most] = [team, k];
        return best;
      }
      case "highestTier": {
        let best: WorldBall | null = null;
        for (const b of this.world.balls) if (b.alive && (!best || b.tier > best.tier)) best = b;
        return best ? best.team : -1;
      }
      case "lastBall": {
        const alive = this.world.balls.filter((b) => b.alive);
        return alive.length === 1 ? alive[0].team : -1;
      }
      default:
        return -1;
    }
  }

  private finish(reason: FinishReason, condition: number) {
    const winner = this.winnerTeam();
    const template = reason === "condition" ? this.bp.finish.any[condition].say || DEFAULT_SAY[this.bp.finish.any[condition].when] : reason === "timeout" ? this.bp.finish.timeoutSay : "STOPPED";
    this.done = { finished: true, reason, condition, timeSec: this.timeSec, winner, result: this.fill(template, winner) };
  }

  /** A result line with its placeholders filled. */
  fill(template: string, winner: number): string {
    const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const names = this.bp.look.teamNames;
    return template.replace(/\{([a-z][a-z0-9]{0,7})\}/g, (whole, key: string) => {
      switch (key) {
        case "winner":
          return winner >= 0 ? (names[winner] ?? `Team ${winner + 1}`) : "Nobody";
        case "time":
          return `${this.timeSec.toFixed(1)} s`;
        case "balls":
        case "escaped":
        case "tier":
        case "tiles":
        case "rings":
          return num(this.count(key));
        default:
          return this.compiled.varIndex.has(key) ? num(this.count(key)) : whole;
      }
    });
  }
}

/** Runs a spec headless from a seed to its end (or `maxSec`): the result and the counts. */
export function runBlueprint(bp: Blueprint, options: RunOptions & { maxSec?: number }): { result: RunResult; stats: RunStats; run: BlueprintRun } {
  const run = new BlueprintRun(bp, options);
  const result = run.runToEnd(options.maxSec);
  return { result, stats: { ...run.stats }, run };
}
