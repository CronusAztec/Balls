/*
 * --- blueprint --- The actions a rule fires (spawn, split, merge, remove, grow, speed, recolor, tier, team, damage, var,
 * impulse, fx, sound), and where new balls appear. An action that has nothing to act on, or a formula that gives a
 * meaningless number, is refused and counted (`refusedActions`) – never thrown. New balls are queued: they join the engine
 * at the end of the step, BLUEPRINT_SPAWNS_PER_STEP a step, never past BLUEPRINT_BALL_CEILING (run.ts drainSpawns). A tile
 * a `damage` breaks raises its tileBroken on the NEXT step (the run's `pending` queue), so rules never recurse.
 */
import { BLUEPRINT_LIMITS as L } from "../limits";
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

/** Queues `count` balls of a body at a place, moving at `speed` towards `dir`. */
export function placeBalls(run: BlueprintRun, body: number, count: number, at: SpawnAt | "self" | "tile", self: WorldBall | null, tile: number, speed: number, dir: Direction) {
  const b = run.bp.bodies[body];
  const w = run.world;
  const R = w.R;
  const ring = count > 1 ? b.radius * Math.max(1.2, count * 0.45) : 0;
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
    const [vx, vy] = velocity(run, dir, speed, x, y);
    run.queueBall({ x, y, vx, vy, r: b.radius, gs: b.gravityScale, pass: b.collide === "pass", body, tier: b.tier, team: b.team, hp: b.hp, color: b.color });
  }
  run.voice("spawn", 0);
}

/** Fires one action of a rule. */
export function act(run: BlueprintRun, rule: CompiledRule, action: CompiledAction, self: WorldBall | null, other: WorldBall | null, tile: number) {
  const a = action.spec;
  const n = run.ruleFires[rule.index];
  const refuse = () => {
    run.stats.refusedActions++;
  };
  switch (a.act) {
    case "spawn": {
      const count = run.countOf(action.nums.count, n, self, L.perSpawn, 0);
      const speed = run.valueOf(action.nums.speed, n, self);
      if (count <= 0 || !Number.isFinite(speed)) return refuse();
      placeBalls(run, action.body, count, a.at, self, tile, speed, a.dir);
      return;
    }
    case "split": {
      const balls = targets(run, rule, a.target, self, other);
      if (!balls.length) return refuse();
      for (const b of balls) {
        const into = Math.max(2, run.countOf(action.nums.into, n, b, L.perSpawn, 2));
        b.r *= a.scale;
        if (!(b.r >= 1)) {
          b.alive = false; // (split into nothing: it pops)
          continue;
        }
        const speed = Math.hypot(b.vx, b.vy);
        const heading = speed > 0 ? Math.atan2(b.vy, b.vx) : run.random() * TAU;
        for (let k = 1; k < into; k++) {
          const h = heading + (k / into) * TAU;
          const ux = Math.cos(h);
          const uy = Math.sin(h);
          run.queueBall({ x: b.x + ux * b.r, y: b.y + uy * b.r, vx: ux * speed, vy: uy * speed, r: b.r, gs: b.gs, pass: b.pass, body: b.body, tier: b.tier, team: b.team, hp: b.hp, color: b.color });
        }
        run.effect("split", b.x, b.y, b.color, b.r);
      }
      run.payoff();
      run.sound("split", 0);
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
      run.payoff();
      run.effect("merge", self.x, self.y, self.color, self.r);
      run.sound("merge", self.tier - 1);
      return;
    }
    case "remove": {
      const balls = targets(run, rule, a.target, self, other);
      if (!balls.length) return refuse();
      for (const b of balls) {
        b.alive = false;
        run.effect("pop", b.x, b.y, b.color, b.r);
      }
      return;
    }
    case "grow": {
      const balls = targets(run, rule, a.target, self, other);
      if (!balls.length) return refuse();
      for (const b of balls) {
        const by = run.valueOf(action.nums.by, n, b);
        if (!Number.isFinite(by)) {
          refuse();
          continue;
        }
        b.r += by;
        if (!(b.r >= 1)) {
          b.alive = false; // (shrunk away: it pops)
          run.effect("pop", b.x, b.y, b.color, 1);
        }
      }
      return;
    }
    case "speed": {
      const balls = targets(run, rule, a.target, self, other);
      if (!balls.length) return refuse();
      for (const b of balls) {
        const s = run.valueOf(action.nums.scale, n, b);
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
      const balls = targets(run, rule, a.target, self, other);
      if (!balls.length) return refuse();
      const size = run.bp.look.palette.length;
      for (const b of balls) {
        if (typeof a.color === "number") b.color = a.color % size;
        else if (a.color === "next") b.color = (b.color + 1) % size;
        else if (a.color === "random") b.color = Math.floor(run.random() * size) % size;
        else if (a.color === "team") b.color = b.team % size;
        else b.color = (((b.tier - 1) % size) + size) % size;
      }
      return;
    }
    case "tier": {
      const balls = targets(run, rule, a.target, self, other);
      if (!balls.length) return refuse();
      for (const b of balls) {
        const by = run.valueOf(action.nums.by, n, b);
        if (!Number.isFinite(by)) {
          refuse();
          continue;
        }
        b.tier = Math.max(1, Math.min(L.maxTier, b.tier + Math.round(by)));
      }
      return;
    }
    case "team": {
      const balls = targets(run, rule, a.target, self, other);
      if (!balls.length) return refuse();
      for (const b of balls) {
        if (typeof a.to === "number") b.team = a.to;
        else if (a.to === "self") b.team = self ? self.team : b.team;
        else if (a.to === "other") b.team = other ? other.team : b.team;
        else b.team = (b.team + 1) % L.teams;
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
          if (!run.pending.push("tileBroken", self, null, tile, -1)) run.stats.droppedEvents++;
        }
        return;
      }
      const balls = targets(run, rule, a.target, self, other);
      for (const b of balls) {
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
      const balls = targets(run, rule, a.target, self, other);
      if (!balls.length) return refuse();
      for (const b of balls) {
        const amount = run.valueOf(action.nums.amount, n, b);
        if (!Number.isFinite(amount)) {
          refuse();
          continue;
        }
        const [vx, vy] = velocity(run, a.dir, amount, b.x, b.y, b === self ? other : self);
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
