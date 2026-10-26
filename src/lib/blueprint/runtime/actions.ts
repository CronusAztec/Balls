/*
 * --- blueprint --- The actions a rule fires (spawn, split, merge, remove, grow, speed, recolor, tier, team, damage, var,
 * impulse, fx, sound), and where new balls appear. An action that has nothing to act on, or a formula that gives a
 * meaningless number, is refused and counted (`refusedActions`) – never thrown. New balls are queued: they join the engine
 * at the end of the step, BLUEPRINT_SPAWNS_PER_STEP a step, never past BLUEPRINT_BALL_CEILING (run.ts drainSpawns). A tile
 * a `damage` breaks raises its tileBroken on the NEXT step (the run's `pending` queue), so rules never recurse.
 *
 * --- review fix (blueprint) --- Every result is a number the world can hold: a ball's new radius stops at
 * BLUEPRINT_RADIUS_CEILING and a radius, speed or position that is not a finite number refuses the action for that ball
 * (counted, never applied); a split checks the arena's room once and says ARENA FULL once; an action on several balls takes
 * them from the step's BLUEPRINT_ACTION_BALLS_PER_STEP (past it the action is dropped and counted), and its formula's
 * step-level slots are filled once, not once a ball.
 */
import { BLUEPRINT_LIMITS as L, BLUEPRINT_RADIUS_CEILING } from "../limits";
import type { Direction, ImpulseDirection, SpawnAt } from "../schema";
import type { CompiledAction, CompiledRule } from "./compile";
import type { BlueprintRun } from "./run";
import type { WorldBall } from "./world";

const TAU = Math.PI * 2;

/** The balls an action changes: self, other, or every ball (of the rule's body) – every ball when a global trigger says self. */
export function targets(run: BlueprintRun, rule: CompiledRule, target: string, self: WorldBall | null, other: WorldBall | null): WorldBall[] {
  if (target === "other") return other && other.alive ? [other] : [];
  if (target === "self" && self) return self.alive ? [self] : [];
  if (target === "self" && rule.spec.when === "escape") return [];
  return run.world.balls.filter((b) => b.alive && (rule.of < 0 || b.body === rule.of));
}

/** A unit direction (scaled by `speed`) for a place and a word; random ones are the run's seeded draws. */
export function velocity(run: BlueprintRun, dir: Direction | ImpulseDirection, speed: number, x: number, y: number, from?: WorldBall | null): [number, number] {
  let ux = 0;
  let uy = 0;
  const w = run.world;
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
      const a = run.random() * TAU;
      ux = Math.cos(a);
      uy = Math.sin(a);
      break;
    }
    default: {
      const a = run.random() * TAU;
      ux = Math.cos(a);
      uy = Math.sin(a);
    }
  }
  return [ux * speed, uy * speed];
}

/** A radius the world can hold: at most the radius ceiling (NaN stays NaN: the caller refuses it). */
export function holdableRadius(r: number): number {
  return r > BLUEPRINT_RADIUS_CEILING ? BLUEPRINT_RADIUS_CEILING : r;
}

/** Queues `count` balls of a body at a place, moving at `speed` towards `dir`. */
export function placeBalls(run: BlueprintRun, body: number, count: number, at: SpawnAt | "self" | "tile", self: WorldBall | null, tile: number, speed: number, dir: Direction) {
  const b = run.bp.bodies[body];
  const w = run.world;
  const R = w.R;
  const radius = holdableRadius(b.radius);
  const ring = count > 1 ? radius * Math.max(1.2, count * 0.45) : 0;
  const start = count > 1 ? run.random() * TAU : 0;
  for (let k = 0; k < count; k++) {
    let x = w.cx;
    let y = w.cy;
    switch (at) {
      case "self":
        // (a ball that just escaped is outside: its new balls start at the centre, not out there)
        if (self && w.insideArena(self.x, self.y)) {
          x = self.x;
          y = self.y;
        }
        break;
      case "tile":
        if (tile >= 0 && tile < w.tileCount) {
          x = w.tiles.px[tile];
          y = w.tiles.py[tile];
        } else if (self && w.insideArena(self.x, self.y)) {
          x = self.x;
          y = self.y;
        }
        break;
      case "top":
      case "bottom":
        x = w.cx + (run.random() * 2 - 1) * 0.35 * R;
        y = w.cy + (at === "top" ? -0.7 : 0.7) * R;
        break;
      case "left":
      case "right":
        x = w.cx + (at === "left" ? -0.7 : 0.7) * R;
        y = w.cy + (run.random() * 2 - 1) * 0.35 * R;
        break;
      case "random": {
        if (w.shape === "box") {
          x = w.cx + (run.random() * 2 - 1) * 0.75 * R;
          y = w.cy + (run.random() * 2 - 1) * 0.75 * R;
        } else {
          const rr = 0.75 * R * Math.sqrt(run.random());
          const a = run.random() * TAU;
          x = w.cx + rr * Math.cos(a);
          y = w.cy + rr * Math.sin(a);
        }
        break;
      }
      case "rim": {
        const a = run.random() * TAU;
        const rr = Math.max(0, 0.85 * R - radius);
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
    const [vx, vy] = velocity(run, dir, speed, x, y);
    run.queueBall({ x, y, vx, vy, r: radius, gs: b.gravityScale, pass: b.collide === "pass", body, tier: b.tier, team: b.team, hp: b.hp, color: b.color });
  }
  run.voice("spawn", 0);
}

/** The actions that change balls (they take them from the step's action budget). */
const BALL_ACTIONS: ReadonlySet<string> = new Set(["split", "remove", "grow", "speed", "recolor", "tier", "team", "damage", "impulse"]);

/** Fires one action of a rule. */
export function act(run: BlueprintRun, rule: CompiledRule, action: CompiledAction, self: WorldBall | null, other: WorldBall | null, tile: number) {
  const a = action.spec;
  const n = run.ruleFires[rule.index];
  const refuse = () => {
    run.stats.refusedActions++;
  };
  /** The balls an action changes, taken from the step's action budget ([] – dropped and counted – past it). */
  const changing = (balls: WorldBall[]): WorldBall[] => (balls.length && !run.spendActionBalls(balls.length) ? [] : balls);
  // (the step's action budget spent: an action on balls is dropped before it even lists them)
  if (BALL_ACTIONS.has(a.act) && !(a.act === "damage" && a.target === "tile") && run.actionBudgetSpent()) {
    run.stats.droppedActions++;
    return;
  }
  switch (a.act) {
    case "spawn": {
      const count = run.countOf(action.nums.count, n, self, L.perSpawn);
      const speed = run.valueOf(action.nums.speed, n, self);
      if (count <= 0 || !Number.isFinite(speed)) return refuse(); // (none, or a count or a speed that means nothing)
      placeBalls(run, action.body, count, a.at, self, tile, speed, a.dir);
      return;
    }
    case "split": {
      const all = targets(run, rule, a.target, self, other);
      if (!all.length) return refuse();
      const balls = changing(all);
      if (!balls.length) return;
      // the arena's room, once: a full arena refuses the split (ARENA FULL once, not once a child)
      let room = run.ballRoom();
      if (room <= 0) {
        run.noteArenaFull();
        return refuse();
      }
      run.prepareSlots(action.nums.into, n);
      let split = false;
      for (const b of balls) {
        const want = run.countOfSlot(action.nums.into, b, L.perSpawn);
        // (an `into` that means nothing – a formula giving NaN – refuses this ball's split: counted, never applied)
        if (want < 0) {
          refuse();
          continue;
        }
        const into = Math.max(2, want);
        const r = holdableRadius(b.r * a.scale);
        if (!(r >= 1)) {
          if (Number.isNaN(r)) {
            refuse();
            continue;
          }
          b.alive = false; // (split into nothing: it pops)
          split = true;
          continue;
        }
        if (room < into - 1) {
          run.noteArenaFull(); // (no room for this ball's halves: it and the rest stay whole)
          break;
        }
        b.r = r;
        const speed = Math.hypot(b.vx, b.vy);
        const heading = speed > 0 ? Math.atan2(b.vy, b.vx) : run.random() * TAU;
        for (let k = 1; k < into; k++) {
          const h = heading + (k / into) * TAU;
          const ux = Math.cos(h);
          const uy = Math.sin(h);
          if (run.queueBall({ x: b.x + ux * b.r, y: b.y + uy * b.r, vx: ux * speed, vy: uy * speed, r: b.r, gs: b.gs, pass: b.pass, body: b.body, tier: b.tier, team: b.team, hp: b.hp, color: b.color })) room--;
        }
        split = true;
        run.effect("split", b.x, b.y, b.color, b.r);
      }
      if (!split) return;
      run.payoff();
      run.sound("split", 0);
      return;
    }
    case "merge": {
      if (!self || !other || !self.alive || !other.alive || self === other) return refuse();
      const ma = self.r * self.r;
      const mb = other.r * other.r;
      const m = ma + mb;
      const r = holdableRadius(a.scale > 0 ? Math.max(self.r, other.r) * a.scale : Math.sqrt(m));
      const x = (self.x * ma + other.x * mb) / m;
      const y = (self.y * ma + other.y * mb) / m;
      const vx = (self.vx * ma + other.vx * mb) / m;
      const vy = (self.vy * ma + other.vy * mb) / m;
      if (!(Number.isFinite(r) && r > 0 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(vx) && Number.isFinite(vy))) return refuse();
      self.x = x;
      self.y = y;
      self.vx = vx;
      self.vy = vy;
      self.r = r;
      const tier = Math.min(L.maxTier, Math.max(self.tier, other.tier) + 1);
      if (tier !== self.tier) self.factsStep = run.world.step; // (its contacts start afresh: --- review fix (blueprint) ---)
      self.tier = tier;
      other.alive = false;
      run.payoff();
      run.effect("merge", self.x, self.y, self.color, self.r);
      run.sound("merge", self.tier - 1);
      return;
    }
    case "remove": {
      const all = targets(run, rule, a.target, self, other);
      if (!all.length) return refuse();
      for (const b of changing(all)) {
        b.alive = false;
        run.effect("pop", b.x, b.y, b.color, b.r);
      }
      return;
    }
    case "grow": {
      const all = targets(run, rule, a.target, self, other);
      if (!all.length) return refuse();
      const balls = changing(all);
      run.prepareSlots(action.nums.by, n);
      for (const b of balls) {
        const by = run.slotValue(action.nums.by, b);
        const r = holdableRadius(b.r + by);
        if (!Number.isFinite(by) || Number.isNaN(r)) {
          refuse();
          continue;
        }
        b.r = r;
        if (!(b.r >= 1)) {
          b.alive = false; // (shrunk away: it pops)
          run.effect("pop", b.x, b.y, b.color, 1);
        }
      }
      return;
    }
    case "speed": {
      const all = targets(run, rule, a.target, self, other);
      if (!all.length) return refuse();
      const balls = changing(all);
      run.prepareSlots(action.nums.scale, n);
      for (const b of balls) {
        const s = run.slotValue(action.nums.scale, b);
        // (a speed past the speed ceiling is the step's cull's: the ball is taken out and counted)
        if (!Number.isFinite(s) || !Number.isFinite(b.vx * s) || !Number.isFinite(b.vy * s)) {
          refuse();
          continue;
        }
        b.vx *= s;
        b.vy *= s;
      }
      return;
    }
    case "recolor": {
      const all = targets(run, rule, a.target, self, other);
      if (!all.length) return refuse();
      const size = run.bp.look.palette.length;
      for (const b of changing(all)) {
        if (typeof a.color === "number") b.color = a.color % size;
        else if (a.color === "next") b.color = (b.color + 1) % size;
        else if (a.color === "random") b.color = Math.floor(run.random() * size) % size;
        else if (a.color === "team") b.color = b.team % size;
        else b.color = (((b.tier - 1) % size) + size) % size;
      }
      return;
    }
    case "tier": {
      const all = targets(run, rule, a.target, self, other);
      if (!all.length) return refuse();
      const balls = changing(all);
      run.prepareSlots(action.nums.by, n);
      for (const b of balls) {
        const by = run.slotValue(action.nums.by, b);
        if (!Number.isFinite(by)) {
          refuse();
          continue;
        }
        const tier = Math.max(1, Math.min(L.maxTier, b.tier + Math.round(by)));
        if (tier !== b.tier) b.factsStep = run.world.step;
        b.tier = tier;
      }
      return;
    }
    case "team": {
      const all = targets(run, rule, a.target, self, other);
      if (!all.length) return refuse();
      for (const b of changing(all)) {
        const was = b.team;
        if (typeof a.to === "number") b.team = a.to;
        else if (a.to === "self") b.team = self ? self.team : b.team;
        else if (a.to === "other") b.team = other ? other.team : b.team;
        else b.team = (b.team + 1) % L.teams;
        if (b.team !== was) b.factsStep = run.world.step;
      }
      run.payoff();
      return;
    }
    case "damage": {
      const amount = run.valueOf(action.nums.amount, n, self);
      if (!Number.isFinite(amount) || amount <= 0) return refuse();
      if (a.target === "tile") {
        if (tile < 0) return refuse();
        if (run.world.damageTile(tile, amount)) {
          run.stats.tilesBroken++;
          run.payoff();
          // (queued only when a rule listens: --- review fix (blueprint) --- an event no rule reads never uses the budget)
          if (run.compiled.byTrigger.tileBroken.length > 0 && !run.pending.push("tileBroken", self, null, tile, -1)) run.stats.droppedEvents++;
        }
        return;
      }
      for (const b of changing(targets(run, rule, a.target, self, other))) {
        if (b.hp <= 0) continue;
        b.hp -= amount;
        if (b.hp <= 0) {
          b.alive = false;
          run.effect("pop", b.x, b.y, b.color, b.r);
        }
      }
      return;
    }
    case "var": {
      if (action.varIndex < 0) return refuse();
      const value = run.valueOf(action.nums.value, n, self);
      const cur = run.vars[action.varIndex];
      const next = a.op === "add" ? cur + value : a.op === "mul" ? cur * value : value;
      if (!Number.isFinite(next)) return refuse();
      run.vars[action.varIndex] = next;
      return;
    }
    case "impulse": {
      const all = targets(run, rule, a.target, self, other);
      if (!all.length) return refuse();
      const balls = changing(all);
      run.prepareSlots(action.nums.amount, n);
      for (const b of balls) {
        const amount = run.slotValue(action.nums.amount, b);
        if (!Number.isFinite(amount)) {
          refuse();
          continue;
        }
        const [vx, vy] = velocity(run, a.dir, amount, b.x, b.y, b === self ? other : self);
        if (!(Number.isFinite(b.vx + vx) && Number.isFinite(b.vy + vy))) {
          refuse();
          continue;
        }
        b.vx += vx;
        b.vy += vy;
      }
      return;
    }
    case "fx":
      run.stats.effects++;
      run.effect(a.kind, self ? self.x : run.world.cx, self ? self.y : run.world.cy, self ? self.color : 0, self ? self.r : 0);
      return;
    case "sound":
      run.sound(a.voice, a.pitch);
      return;
  }
}
