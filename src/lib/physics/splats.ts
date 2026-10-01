import type { Ball, CircularWall, Gap, ModeId, PhysicsConfig, SoundEvent } from "./types";
import { TWO_PI } from "./types";
import { resolveBallCircle, type CircleObstacle } from "./obstacles";
import { resolveExitSplatConfig, splatsSolidIn, supportsSplats, type ResolvedExitSplat } from "./exitSplat";
import { inAnyGap, wrapTwoPi } from "./movingExits";

/**
 * --- gerald-exit-splat --- The splat barrier (the character-ball account's "Splat Barrier Demo"): every wall hit of a ring
 * mode leaves a splat of paint in the ball's colour at the impact point on the inside of the wall, and every splat is a
 * solid circle of the obstacle layer (obstacles.ts `resolveBallCircle()`), so the ball gradually builds its own barrier.
 *
 * A splat's circle has `splatSize` × the ball's radius and its centre sits `SPLAT_OFFSET` of that radius beyond the wall
 * line, so it bulges `0.8 ×` its radius into the ring – a cap stuck to the wall, which the canvas draws as a blob with
 * drips (components/simulator/exitSplatRenderer.ts). It turns with its ring (its angle is the ring's own) and touches only
 * the balls inside that ring. Past `splatMax` the oldest fade out; a splat whose ring breaks, or that a moving exit's
 * opening comes over (no wall left to stick to), falls off; and when no ball has reached the wall for `SPLAT_LEAK_MS` – the
 * barrier is closed – the oldest one falls too, so a barrier never shuts a run for good. A landing queues a "splat" sound
 * event (`SoundEvent.splat`: the wet burst of `ToneGenerator.playSplat()`), a ball bouncing off a splat a hit of its ring.
 *
 * Deterministic (no random numbers, the simulation's clock) and allocation-free once warm: splat objects are pooled, and
 * the solid ones are bucketed by angle (`SPLAT_SECTORS`) every sub-step, so a ball tests only the few splats beside it.
 * In Grow the splats only paint the ring (the ball grows to fill it, a barrier would have nowhere to be).
 */

/** The circle's centre sits this fraction of its radius beyond the wall line: it bulges 1 − this of its radius into the ring. */
export const SPLAT_OFFSET = 0.2;
/** Fraction of the approach speed a splat gives back (wet paint is a little soft). */
export const SPLAT_RESTITUTION = 0.9;
/** Fraction of the sliding speed a splat takes (wet paint grips). */
export const SPLAT_FRICTION = 0.06;
/** Simulation ms a splat takes to fade out (and drip off) once it goes. */
export const SPLAT_FADE_MS = 650;
/** Simulation ms without a single new splat after which the oldest one falls (the barrier is closed: it leaks). */
export const SPLAT_LEAK_MS = 2500;
/** No splat is smaller than this (px). */
export const MIN_SPLAT_RADIUS = 1.5;
/** Splat sounds a fixed step may queue (Multiply's crowd splats a lot). */
export const MAX_SPLAT_SOUNDS_PER_STEP = 2;
/** Bounces off splats a fixed step may sound. */
export const MAX_SPLAT_HIT_SOUNDS_PER_STEP = 3;
/** Angular buckets of the solid splats (each ball tests the buckets beside it). */
export const SPLAT_SECTORS = 64;

/** One splat. It is a circle obstacle (its `x`, `y` follow its ring every sub-step) with its paint. */
export interface Splat extends CircleObstacle {
  /** 1, 2, 3 … in the order they landed this run (the canvas draws each one's blob from it). */
  serial: number;
  /** The ring it sticks to. */
  wall: number;
  /** Where it sticks: radians relative to its ring, in [0, 2π) – it turns with the ring. */
  angle: number;
  /** How far its centre sits beyond the wall line (px). */
  offset: number;
  /** The ball's colour. */
  color: string;
  /** Simulation ms it landed. */
  bornMs: number;
  /** Simulation ms its fade began; −1 while it stands. */
  fadeMs: number;
  /** Simulation ms a ball last bounced off it (−Infinity: never) – the canvas squishes it. */
  hitMs: number;
  /** False in Grow: it only paints the ring. */
  solid: boolean;
  /** Its ring's radius the last time it was placed (px): only a ball inside it touches the splat. */
  ringRadius: number;
}

function newSplat(): Splat {
  return { kind: "circle", x: 0, y: 0, radius: 1, restitution: SPLAT_RESTITUTION, friction: SPLAT_FRICTION, serial: 0, wall: 0, angle: 0, offset: 0, color: "#ffffff", bornMs: 0, fadeMs: -1, hitMs: -Infinity, solid: true, ringRadius: 0 };
}

/** The radius (px) of the splat a ball of `ballRadius` leaves at `size` × its radius. */
export function splatRadius(size: number, ballRadius: number): number {
  const r = size * ballRadius;
  return r > MIN_SPLAT_RADIUS ? r : MIN_SPLAT_RADIUS;
}

/** The centre of a splat stuck to a ring of `ringRadius` at world angle `theta` (around the arena centre `cx`, `cy`), into `out`. */
export function splatCentre(ringRadius: number, offset: number, theta: number, cx: number, cy: number, out: { x: number; y: number }): { x: number; y: number } {
  const d = ringRadius + offset;
  out.x = cx + d * Math.cos(theta);
  out.y = cy + d * Math.sin(theta);
  return out;
}

/** The sector of a world angle. */
function sectorOf(theta: number): number {
  const k = Math.floor((wrapTwoPi(theta) / TWO_PI) * SPLAT_SECTORS);
  return k >= SPLAT_SECTORS ? SPLAT_SECTORS - 1 : k;
}

/**
 * The splats of a run (see the module comment). `configure()` takes the settings from the physics config, `reset()`
 * starts a new run; the engine calls `beginStep()` every fixed step, `add()` at every wall hit, `prepare()` and
 * `collide()` every sub-step, `endStep()` at the end of the step.
 */
export class SplatField {
  /** The splats, oldest first (fading ones included until they are gone). */
  readonly splats: Splat[] = [];
  private readonly pool: Splat[] = [];
  private cfg: ResolvedExitSplat = resolveExitSplatConfig(null);
  private live = false;
  private solidMode = true;
  /** Splats that landed this run, bounces off splats this run, splats standing now (not fading). */
  created = 0;
  hits = 0;
  active = 0;
  private serial = 0;
  private lastSplatMs = 0;
  private sounds = 0;
  private hitSounds = 0;
  private width = 0;
  private height = 0;
  /** Per sub-step: the solid splats bucketed by angle (`order[sectorStart[k]…sectorStart[k + 1]]` are sector k's). */
  private readonly sectorStart = new Int32Array(SPLAT_SECTORS + 1);
  private readonly cursor = new Int32Array(SPLAT_SECTORS);
  private order = new Int32Array(64);
  private sectorIndex = new Int32Array(64);
  /** The largest solid splat's radius and the nearest any of them comes to the centre (a ball nearer than that touches none). */
  private reach = 0;
  private inner = Infinity;

  /** Takes the settings from the config; switched off, the splats go. A new world size scales them with the rings. */
  configure(config: Partial<PhysicsConfig> | null | undefined) {
    const next = resolveExitSplatConfig(config);
    if (!next.splats && this.splats.length > 0) this.reset();
    const w = config?.width ?? 0;
    const h = config?.height ?? 0;
    if (w > 0 && h > 0) {
      if (this.width > 0 && this.height > 0 && (w !== this.width || h !== this.height)) {
        const k = Math.min(w, h) / Math.min(this.width, this.height);
        if (Number.isFinite(k) && k > 0) {
          for (const s of this.splats) {
            s.radius *= k;
            s.offset *= k;
          }
        }
      }
      this.width = w;
      this.height = h;
    }
    this.cfg = next;
  }

  /** A new run: no splats. */
  reset() {
    for (const s of this.splats) this.pool.push(s);
    this.splats.length = 0;
    this.created = 0;
    this.hits = 0;
    this.active = 0;
    this.serial = 0;
    this.lastSplatMs = 0;
    this.reach = 0;
    this.inner = Infinity;
  }

  /** Whether wall hits leave splats this step (the splat barrier is on in a ring mode). */
  beginStep(mode: ModeId | undefined): boolean {
    this.live = this.cfg.splats && supportsSplats(mode);
    this.solidMode = splatsSolidIn(mode);
    this.sounds = 0;
    this.hitSounds = 0;
    return this.live;
  }

  /** The most splats at once in effect. */
  get max(): number {
    return this.cfg.splatMax;
  }

  /**
   * A ball of `ballRadius` (px) and `color` hit ring `wall` (radius `ringRadius`, turned by `rotation`) at world angle
   * `angle`, at `level` of the ball speed: a splat lands there – unless the spot is in one of the ring's `gaps` – and a
   * splat sound is queued into `events` (at most `MAX_SPLAT_SOUNDS_PER_STEP` a step). Returns the splat, or null.
   */
  add(wall: number, angle: number, ringRadius: number, rotation: number, ballRadius: number, color: string, level: number, nowMs: number, gaps: readonly Gap[], events: SoundEvent[]): Splat | null {
    if (!this.live) return null;
    const rel = wrapTwoPi(angle - rotation);
    if (!Number.isFinite(rel) || inAnyGap(rel, gaps)) return null;
    const radius = splatRadius(this.cfg.splatSize, ballRadius);
    if (!Number.isFinite(radius)) return null;
    const s = this.pool.pop() ?? newSplat();
    s.serial = ++this.serial;
    s.wall = wall;
    s.angle = rel;
    s.radius = radius;
    s.offset = SPLAT_OFFSET * radius;
    s.color = color;
    s.bornMs = nowMs;
    s.fadeMs = -1;
    s.hitMs = -Infinity;
    s.solid = this.solidMode;
    s.ringRadius = ringRadius;
    s.restitution = SPLAT_RESTITUTION;
    s.friction = SPLAT_FRICTION;
    splatCentre(ringRadius, s.offset, angle, this.width / 2, this.height / 2, s);
    this.splats.push(s);
    this.created++;
    this.active++;
    this.lastSplatMs = nowMs;
    this.enforceMax(nowMs);
    if (this.sounds < MAX_SPLAT_SOUNDS_PER_STEP) {
      this.sounds++;
      const loud = level > 1 ? 1 : level > 0.25 ? level : 0.25;
      events.push({ type: "hit", wallIndex: wall, splat: true, melody: false, level: Number.isFinite(loud) ? loud : 0.6 });
    }
    return s;
  }

  /**
   * Places every standing solid splat on its ring as it is now (turned, breathing, resized) around the centre (`cx`,
   * `cy`) and buckets them by angle. Returns false when none stands (nothing to collide with this sub-step).
   */
  prepare(walls: readonly CircularWall[], rotations: readonly number[], cx: number, cy: number): boolean {
    const list = this.splats;
    this.reach = 0;
    this.inner = Infinity;
    if (this.active === 0 || !this.solidMode) return false;
    if (this.order.length < list.length) {
      this.order = new Int32Array(Math.max(2 * this.order.length, list.length));
      this.sectorIndex = new Int32Array(this.order.length);
    }
    const start = this.sectorStart;
    start.fill(0);
    let count = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const wall = walls[s.wall];
      if (!wall || s.fadeMs >= 0 || !s.solid) {
        this.sectorIndex[i] = -1;
        continue;
      }
      const theta = s.angle + (rotations[s.wall] ?? 0);
      s.ringRadius = wall.radius;
      splatCentre(wall.radius, s.offset, theta, cx, cy, s);
      const k = sectorOf(theta);
      this.sectorIndex[i] = k;
      start[k + 1]++;
      count++;
      if (s.radius > this.reach) this.reach = s.radius;
      const inner = wall.radius + s.offset - s.radius;
      if (inner < this.inner) this.inner = inner;
    }
    if (count === 0) return false;
    for (let k = 0; k < SPLAT_SECTORS; k++) {
      start[k + 1] += start[k];
      this.cursor[k] = start[k];
    }
    for (let i = 0; i < list.length; i++) {
      const k = this.sectorIndex[i];
      if (k >= 0) this.order[this.cursor[k]++] = i;
    }
    return true;
  }

  /**
   * Resolves `ball` against the standing splats beside it (after `prepare()`): push-out and rebound (restitution ×
   * `restitutionScale`, the ball's own bounciness and lift as for every obstacle). A contact at `hitSpeed` or more counts
   * as a hit (the canvas squishes the splat). Returns the ring of a hit that should sound (at most
   * `MAX_SPLAT_HIT_SOUNDS_PER_STEP` a step), or −1.
   */
  collide(ball: Ball, dtSec: number, cx: number, cy: number, restitutionScale: number, hitSpeed: number, nowMs: number, ballRestitution = 1, liftSpeed = Infinity): number {
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!(dist + ball.radius > this.inner)) return -1; // (also a ball whose position is not a number)
    const span = dist > 1e-9 ? (ball.radius + this.reach) / dist : Math.PI;
    let from = 0;
    let to = SPLAT_SECTORS - 1;
    if (span < Math.PI) {
      const a = Math.atan2(dy, dx);
      from = Math.floor(((a - span) / TWO_PI) * SPLAT_SECTORS);
      to = Math.floor(((a + span) / TWO_PI) * SPLAT_SECTORS);
      if (to - from >= SPLAT_SECTORS) {
        from = 0;
        to = SPLAT_SECTORS - 1;
      }
    }
    let sound = -1;
    for (let k = from; k <= to; k++) {
      const sector = ((k % SPLAT_SECTORS) + SPLAT_SECTORS) % SPLAT_SECTORS;
      for (let j = this.sectorStart[sector]; j < this.sectorStart[sector + 1]; j++) {
        const s = this.splats[this.order[j]];
        if (dist >= s.ringRadius) continue; // only the balls inside its ring
        const impact = resolveBallCircle(ball, s, dtSec, restitutionScale, undefined, ballRestitution, liftSpeed);
        if (impact < hitSpeed) continue; // no contact (−1) or a soft one
        this.hits++;
        s.hitMs = nowMs;
        if (this.hitSounds < MAX_SPLAT_HIT_SOUNDS_PER_STEP) {
          this.hitSounds++;
          sound = s.wall;
        }
      }
    }
    return sound;
  }

  /**
   * The end of a step: a faded splat is gone, a standing one falls off a broken ring or out of an exit that came over it,
   * the oldest falls when the barrier has kept every ball off the wall for `SPLAT_LEAK_MS`, and past `splatMax` the oldest
   * fade.
   */
  endStep(walls: readonly CircularWall[], broken: ReadonlySet<number>, nowMs: number) {
    const list = this.splats;
    for (const s of list) {
      if (s.fadeMs >= 0) continue;
      const wall = walls[s.wall];
      if (!wall || broken.has(s.wall) || inAnyGap(s.angle, wall.gaps)) this.fade(s, nowMs);
    }
    if (this.active > 0 && nowMs - this.lastSplatMs >= SPLAT_LEAK_MS) {
      this.fadeOldest(nowMs);
      this.lastSplatMs = nowMs;
    }
    this.enforceMax(nowMs);
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.fadeMs >= 0 && nowMs - s.fadeMs >= SPLAT_FADE_MS) {
        this.pool.push(s);
        continue;
      }
      list[j++] = s;
    }
    list.length = j;
  }

  private fade(s: Splat, nowMs: number) {
    if (s.fadeMs >= 0) return;
    s.fadeMs = nowMs;
    this.active--;
  }

  /** Fades the oldest standing splat; false when none stands. */
  private fadeOldest(nowMs: number): boolean {
    for (const s of this.splats) {
      if (s.fadeMs < 0) {
        this.fade(s, nowMs);
        return true;
      }
    }
    return false;
  }

  /** Past `splatMax` standing splats the oldest fade. */
  private enforceMax(nowMs: number) {
    const max = this.cfg.splatMax;
    while (this.active > max && this.fadeOldest(nowMs));
  }
}
