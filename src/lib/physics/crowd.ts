/**
 * --- unlimited --- The crowd: up to a million extra balls in typed arrays.
 *
 * With No limits on, a Ball Count beyond the few balls a mode plays with (the team balls), Multiply's children beyond
 * `OBJECT_BALL_LIMIT` and other clone storms become crowd balls. They live in pre-allocated `Float32Array`s (≈ 23 bytes a
 * ball – a million of them is ~23 MB) instead of ball objects, and one pass per 60 Hz step moves them all:
 *
 *  - gravity (the engine's, in its current direction), then a straight move over the step;
 *  - the concentric rings: every ball remembers its **lane** – the corridor between two rings (by radius) it is in –, so
 *    one step costs O(1) a ball however many rings there are, and a ball can never tunnel through a ring whatever its
 *    speed: leaving its lane across a ring either goes through (a gap under it, or a broken ring) or is reflected back
 *    and placed just inside. A rebound keeps the Ball Speed with a small deterministic turn (a hash of the ball and the
 *    bounce count – the crowd never draws from the engine's RNG, so the main balls replay exactly as without it);
 *  - past the outermost ring a ball has escaped: it flies on under gravity and is dropped once it has left the canvas.
 *
 * The crowd never breaks rings, scores or triggers a mode's rules – it is the audience, not the cast – and its balls do
 * not collide with each other (hundreds of thousands of balls cannot fit an arena anyway). Every step is a pure function
 * of the crowd and the world it is given, so a seed replays the crowd exactly too. Positions and velocities are kept
 * finite: a ball that turns NaN or ±Infinity is put back at the centre.
 */
import { TWO_PI, type CircularWall } from "./types";
import { CROWD_LIMIT } from "@/lib/unlimited";

/** What one crowd step needs from the engine. */
export interface CrowdWorld {
  cx: number;
  cy: number;
  width: number;
  height: number;
  walls: readonly CircularWall[];
  rotations: readonly number[];
  broken: ReadonlySet<number>;
  /** Gravity acceleration (px/s²) along x and y. */
  gx: number;
  gy: number;
  /** The Ball Speed (px/s): the speed of every rebound. */
  speed: number;
}

/** Most bounces per step that count towards the sound (the loudness grows with the log of the count). */
const HIT_SOUND_EVERY_MS = 90;
/** Largest turn (radians) a rebound adds to the mirror direction. */
const REBOUND_SCATTER = Math.PI / 7;
/** How far outside the canvas an escaped ball may fly before it is dropped (px). */
const ESCAPE_MARGIN = 80;

/** A 32-bit integer hash → [0, 1): the crowd's own deterministic "randomness". */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export class Crowd {
  /** Balls in play. */
  count = 0;
  private cap = 0;
  x = new Float32Array(0);
  y = new Float32Array(0);
  vx = new Float32Array(0);
  vy = new Float32Array(0);
  r = new Float32Array(0);
  /** Palette index of every ball (the renderer batches by it). */
  color = new Uint8Array(0);
  /** The corridor a ball is in (0 = inside the smallest ring); −1 = escaped. */
  private lane = new Int16Array(0);
  /** The limit of this run (≤ CROWD_LIMIT). */
  limit = CROWD_LIMIT;
  /** A spawn was refused because the crowd is at its limit ("arena full"). */
  full = false;
  /** Every rebound off a ring so far (the HUD counts them). */
  bounces = 0;
  /** Crowd balls that left the arena so far. */
  escaped = 0;
  /** Crowd balls ever spawned. */
  spawned = 0;
  /** Balls put back at the centre after their numbers went non-finite. */
  rescued = 0;
  /** Rebounds in the last step and the ring (its index in the engine's list) most of them hit. */
  hitsThisStep = 0;
  lastHitWall = -1;
  private sinceSoundMs = HIT_SOUND_EVERY_MS;
  /** The rings sorted by radius (indices into the engine's list), their radii, and whether each is open (broken). */
  private order = new Int32Array(0);
  private radii = new Float64Array(0);
  private open = new Uint8Array(0);
  private wallsRef: readonly CircularWall[] | null = null;
  private wallCount = -1;

  reset(limit = CROWD_LIMIT) {
    this.count = 0;
    this.limit = Math.max(0, Math.min(CROWD_LIMIT, Math.floor(limit)));
    this.full = false;
    this.bounces = 0;
    this.escaped = 0;
    this.spawned = 0;
    this.rescued = 0;
    this.hitsThisStep = 0;
    this.lastHitWall = -1;
    this.sinceSoundMs = HIT_SOUND_EVERY_MS;
    this.wallsRef = null;
    this.wallCount = -1;
  }

  /** Makes room for `n` balls in one go (the typed arrays are allocated once for a big crowd, not grown ball by ball). */
  reserve(n: number) {
    const need = Math.min(this.limit, Math.max(0, Math.floor(n)));
    if (need <= this.cap) return;
    const size = Math.min(this.limit, Math.max(need, Math.min(this.limit, this.cap * 2), 256));
    const grow = <T extends Float32Array | Uint8Array | Int16Array>(old: T, make: (n: number) => T): T => {
      const next = make(size);
      next.set(old.subarray(0, this.count));
      return next;
    };
    this.x = grow(this.x, (k) => new Float32Array(k));
    this.y = grow(this.y, (k) => new Float32Array(k));
    this.vx = grow(this.vx, (k) => new Float32Array(k));
    this.vy = grow(this.vy, (k) => new Float32Array(k));
    this.r = grow(this.r, (k) => new Float32Array(k));
    this.color = grow(this.color, (k) => new Uint8Array(k));
    this.lane = grow(this.lane, (k) => new Int16Array(k));
    this.cap = size;
  }

  /** Adds one ball; false (and the "arena full" flag) once the crowd is at its limit. */
  add(x: number, y: number, vx: number, vy: number, radius: number, color: number): boolean {
    if (this.count >= this.limit) {
      this.full = true;
      return false;
    }
    if (this.count >= this.cap) this.reserve(this.count + 1);
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.r[i] = radius;
    this.color[i] = color;
    this.lane[i] = -2; // placed on the next step (from its distance to the centre)
    this.spawned++;
    return true;
  }

  /**
   * Adds `n` balls at (x, y) flying out at `speed` in evenly spread directions (golden-angle steps from `angle`),
   * colours cycling through `colors` palette slots from `firstColor` (all `firstColor` when `colors` ≤ 1). Returns how many fit.
   */
  spawnBurst(n: number, x: number, y: number, speed: number, radius: number, angle: number, firstColor: number, colors: number): number {
    const want = Math.max(0, Math.floor(n));
    const room = Math.max(0, this.limit - this.count);
    const k = Math.min(want, room);
    if (want > room) this.full = true;
    if (k === 0) return 0;
    this.reserve(this.count + k);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let j = 0; j < k; j++) {
      const a = angle + golden * (j + 1);
      this.add(x, y, Math.cos(a) * speed, Math.sin(a) * speed, radius, colors > 1 ? (firstColor + j) % colors : firstColor);
    }
    return k;
  }

  /** Rebuilds the sorted ring table when the engine's ring list changed (a rebuild), and every ball's lane with it. */
  private syncRings(world: CrowdWorld) {
    const walls = world.walls;
    const n = walls.length;
    if (this.order.length < n) {
      this.order = new Int32Array(Math.max(n, 8));
      this.radii = new Float64Array(Math.max(n, 8));
      this.open = new Uint8Array(Math.max(n, 8));
    }
    const rebuilt = walls !== this.wallsRef || n !== this.wallCount;
    if (rebuilt) {
      for (let i = 0; i < n; i++) this.order[i] = i;
      const idx = Array.from(this.order.subarray(0, n)).sort((a, b) => walls[a].radius - walls[b].radius);
      for (let i = 0; i < n; i++) this.order[i] = idx[i];
      this.wallsRef = walls;
      this.wallCount = n;
    }
    for (let k = 0; k < n; k++) {
      const w = this.order[k];
      this.radii[k] = walls[w].radius;
      this.open[k] = world.broken.has(w) ? 1 : 0;
    }
    if (rebuilt) for (let i = 0; i < this.count; i++) if (this.lane[i] >= 0) this.lane[i] = -2;
  }

  /** The lane of a ball `d` from the centre: how many rings lie inside it (n = beyond them all). */
  private laneAt(d: number, n: number): number {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.radii[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** True when the ring at sorted position `k` lets a ball through at `angle` (broken, or a gap there). */
  private passes(k: number, angle: number, world: CrowdWorld): boolean {
    if (this.open[k]) return true;
    const w = this.order[k];
    const wall = world.walls[w];
    const rot = world.rotations[w] ?? 0;
    for (let g = 0; g < wall.gaps.length; g++) {
      const gap = wall.gaps[g];
      let width = gap.endAngle - gap.startAngle;
      if (width < 0) width += TWO_PI;
      let rel = (angle - gap.startAngle - rot) % TWO_PI;
      if (rel < 0) rel += TWO_PI;
      if (rel <= width) return true;
    }
    return false;
  }

  /**
   * One 60 Hz step of `stepSec` simulation seconds for every ball. Returns true when the crowd's bounces this step should
   * be heard (at most one sound every `HIT_SOUND_EVERY_MS` of simulation time).
   */
  step(stepSec: number, world: CrowdWorld): boolean {
    const n = this.count;
    this.hitsThisStep = 0;
    if (n === 0) return false;
    const rings = world.walls.length;
    this.syncRings(world);
    const { cx, cy, gx, gy } = world;
    const speed = world.speed > 0 && Number.isFinite(world.speed) ? world.speed : 400;
    const dvx = gx * stepSec;
    const dvy = gy * stepSec;
    const minX = -ESCAPE_MARGIN;
    const minY = -ESCAPE_MARGIN;
    const maxX = world.width + ESCAPE_MARGIN;
    const maxY = world.height + ESCAPE_MARGIN;
    const xs = this.x;
    const ys = this.y;
    const vxs = this.vx;
    const vys = this.vy;
    const rs = this.r;
    const lanes = this.lane;
    const radii = this.radii;
    let hits = 0;
    let hitRing = -1;
    for (let i = 0; i < this.count; i++) {
      let vx = vxs[i] + dvx;
      let vy = vys[i] + dvy;
      let x = xs[i] + vx * stepSec;
      let y = ys[i] + vy * stepSec;
      if (!(Math.abs(x) < 1e12 && Math.abs(y) < 1e12 && Math.abs(vx) < 1e15 && Math.abs(vy) < 1e15)) {
        // Non-finite (or absurdly far): back at the centre, flying out at the Ball Speed.
        const a = TWO_PI * hash01(i, this.rescued);
        x = cx;
        y = cy;
        vx = Math.cos(a) * speed;
        vy = Math.sin(a) * speed;
        lanes[i] = -2;
        this.rescued++;
      }
      let lane = lanes[i];
      if (lane === -1 || rings === 0) {
        if (x < minX || x > maxX || y < minY || y > maxY) {
          // Gone: the last ball takes this slot (the order stays a pure function of the crowd).
          const last = --this.count;
          if (i !== last) {
            xs[i] = xs[last];
            ys[i] = ys[last];
            vxs[i] = vxs[last];
            vys[i] = vys[last];
            rs[i] = rs[last];
            this.color[i] = this.color[last];
            lanes[i] = lanes[last];
            i--;
          }
          continue;
        }
        xs[i] = x;
        ys[i] = y;
        vxs[i] = vx;
        vys[i] = vy;
        continue;
      }
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      const r = rs[i];
      if (lane === -2) {
        lane = this.laneAt(Math.sqrt(d2), rings);
        if (lane >= rings) lane = -1;
        lanes[i] = lane;
        if (lane === -1) this.escaped++;
        xs[i] = x;
        ys[i] = y;
        vxs[i] = vx;
        vys[i] = vy;
        continue;
      }
      const outer = lane < rings ? radii[lane] : Infinity;
      const inner = lane > 0 ? radii[lane - 1] : 0;
      const outerLimit = outer - r;
      const innerLimit = inner + r;
      let ring = -1;
      let inward = false;
      if (outerLimit > 0 && d2 > outerLimit * outerLimit) ring = lane;
      else if (lane > 0 && d2 < innerLimit * innerLimit) {
        ring = lane - 1;
        inward = true;
      }
      if (ring >= 0) {
        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += TWO_PI;
        if (this.passes(ring, angle, world)) {
          // Through the gap (or a broken ring) into the next lane; beyond the outermost ring the ball has escaped.
          lane = inward ? lane - 1 : lane + 1;
          if (lane >= rings) {
            lane = -1;
            this.escaped++;
          } else {
            // A fast ball that flew past the next ring too stops at it: that ring is checked (gap or rebound) next step.
            const hi = radii[lane] - r;
            const lo = lane > 0 ? radii[lane - 1] + r : 0;
            const d = Math.sqrt(d2) || 1;
            if (hi > lo && (d > hi || d < lo)) {
              const at = d > hi ? hi - 0.5 : lo + 0.5;
              x = cx + (dx / d) * at;
              y = cy + (dy / d) * at;
            }
          }
          lanes[i] = lane;
        } else {
          const d = Math.sqrt(d2) || 1;
          const nx = dx / d;
          const ny = dy / d;
          const vn = vx * nx + vy * ny;
          // Mirror the radial part, then turn a little and settle at the Ball Speed.
          let rx = vx;
          let ry = vy;
          if (inward ? vn < 0 : vn > 0) {
            rx = vx - 2 * vn * nx;
            ry = vy - 2 * vn * ny;
          }
          this.bounces++;
          const turn = (2 * hash01(i, this.bounces) - 1) * REBOUND_SCATTER;
          const c = Math.cos(turn);
          const s = Math.sin(turn);
          let ox = rx * c - ry * s;
          let oy = rx * s + ry * c;
          const on = ox * nx + oy * ny;
          if (inward ? on < 0 : on > 0) {
            ox -= 2 * on * nx;
            oy -= 2 * on * ny;
          }
          const len = Math.hypot(ox, oy) || 1;
          vx = (ox / len) * speed;
          vy = (oy / len) * speed;
          // Back just inside the lane (its middle when the lane is narrower than the ball).
          const lo = innerLimit;
          const hi = outerLimit;
          const at = hi > lo ? (inward ? lo + 0.5 : hi - 0.5) : 0.5 * (inner + outer);
          x = cx + nx * at;
          y = cy + ny * at;
          hits++;
          hitRing = this.order[ring];
        }
      }
      xs[i] = x;
      ys[i] = y;
      vxs[i] = vx;
      vys[i] = vy;
    }
    this.hitsThisStep = hits;
    if (hits > 0) this.lastHitWall = hitRing;
    this.sinceSoundMs += stepSec * 1000;
    if (hits > 0 && this.sinceSoundMs >= HIT_SOUND_EVERY_MS) {
      this.sinceSoundMs = 0;
      return true;
    }
    return false;
  }

  /** Loudness (0–1) of the crowd's bounce sound for `hits` rebounds in one step: louder with the log of the count. */
  static hitLevel(hits: number): number {
    return Math.min(1, 0.25 + 0.12 * Math.log2(1 + hits));
  }
}
