import type { Ball, CircularWall, Gap } from "@/lib/physics/types";

/**
 * Smooth live slow motion. The engine only ever moves in whole fixed 60 Hz steps, and the slow motion only feeds it
 * less wall-clock time, so at 0.2× a step comes every fifth rendered frame: drawn as they are, the balls stand still
 * for four frames and then jump (a 12 fps stop-motion, in the recording too). `StepInterpolator` keeps the state of
 * the step before the latest one – every ball's position, size and sprite angle by id, every wall's rotation and
 * radius – and `view(alpha)` rebuilds the scene `alpha` of the way from that step to the latest one, the way the
 * escape replay's `ReplayBuffer.sample()` interpolates between its frames. The physics are never touched: this is
 * what gets drawn, one step behind the engine, as any interpolating fixed-step renderer is.
 *
 * Everything lives in typed arrays and pooled objects allocated up front (the ball pool grows once to the most
 * balls seen, up to `INTERP_MAX_BALLS`), so capturing and viewing allocate nothing per frame.
 */

/** Balls whose previous step is kept; any further ones are drawn where the engine has them. */
export const INTERP_MAX_BALLS = 256;
/** Walls whose previous rotation and radius are kept. */
export const INTERP_MAX_WALLS = 32;
/** A ball that moved further than this (world px) in one step was teleported or respawned: it is drawn where it is, not slid across. */
export const INTERP_SNAP_PX = 120;
/** Trail points of an interpolated ball – the engine's trail length. */
const TRAIL = 20;
const TWO_PI = Math.PI * 2;
/**
 * Two captures belong to consecutive steps when their times are at most one fixed step apart (1000 / 60 ms; a step
 * the multipliers' time dilation shortened is closer) – a gap of two steps or more means steps ran uncaptured.
 */
const STEP_MS = 1000 / 60;

/** Shortest signed angular difference b − a in (−π, π]. */
function angleDelta(a: number, b: number) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}

/** The scene between two steps. Owned by the interpolator and rewritten by every `view()`. */
export interface StepView {
  balls: Ball[];
  walls: CircularWall[];
  rotations: number[];
}

/** The state after one physics step. */
class StepSnapshot {
  time = NaN;
  balls = 0;
  walls = 0;
  readonly ids = new Float64Array(INTERP_MAX_BALLS);
  readonly x = new Float64Array(INTERP_MAX_BALLS);
  readonly y = new Float64Array(INTERP_MAX_BALLS);
  readonly radius = new Float64Array(INTERP_MAX_BALLS);
  readonly angle = new Float64Array(INTERP_MAX_BALLS);
  readonly rotation = new Float64Array(INTERP_MAX_WALLS);
  readonly wallRadius = new Float64Array(INTERP_MAX_WALLS);

  write(timeMs: number, balls: readonly Ball[], walls: readonly CircularWall[], rotations: readonly number[]) {
    this.time = timeMs;
    const nb = Math.min(balls.length, INTERP_MAX_BALLS);
    this.balls = nb;
    for (let k = 0; k < nb; k++) {
      const b = balls[k];
      this.ids[k] = b.id;
      this.x[k] = b.x;
      this.y[k] = b.y;
      this.radius[k] = b.radius;
      this.angle[k] = b.angle;
    }
    const nw = Math.min(walls.length, INTERP_MAX_WALLS);
    this.walls = nw;
    for (let w = 0; w < nw; w++) {
      this.rotation[w] = rotations[w] ?? 0;
      this.wallRadius[w] = walls[w].radius;
    }
  }
}

const NO_GAPS: Gap[] = [];

export class StepInterpolator {
  /** The step before the latest one, and the latest one (swapped by every capture). */
  private prev = new StepSnapshot();
  private last = new StepSnapshot();
  private readonly ballPool: Ball[] = [];
  private readonly trailPoints: { x: number; y: number }[][] = [];
  private readonly wallPool: CircularWall[] = [];
  readonly view: StepView = { balls: [], walls: [], rotations: [] };

  /** Forgets both steps (a restart): nothing is interpolated until two new consecutive steps are in. */
  reset() {
    this.prev.time = NaN;
    this.last.time = NaN;
  }

  /** Records the state after a physics step at simulation time `timeMs`; a repeated time (no step ran) is ignored. */
  capture(timeMs: number, balls: readonly Ball[], walls: readonly CircularWall[], rotations: readonly number[]) {
    if (timeMs === this.last.time) return;
    const older = this.prev;
    this.prev = this.last;
    this.last = older;
    this.last.write(timeMs, balls, walls, rotations);
  }

  /** True when the two kept steps are consecutive and the latest one is the engine's current state (`timeMs`). */
  ready(timeMs: number) {
    const gap = this.last.time - this.prev.time;
    return this.last.time === timeMs && gap > 0 && gap < STEP_MS + 1e-3;
  }

  /**
   * The scene `alpha` (0–1) of the way from the step before the latest one to the latest one – the engine's current
   * `balls`, `walls` and `rotations`, which must be the state `capture()` saw last at `timeMs` – or null when the two
   * steps are not both in (the first step after a restart). Balls follow their id (a ball new in the latest step, or
   * one that jumped more than `INTERP_SNAP_PX`, is drawn where it is); each keeps its live colour, team, multipliers,
   * lifetime and velocity, and its trail is the engine's with the newest point moved to where the ball is drawn.
   */
  sample(timeMs: number, balls: readonly Ball[], walls: readonly CircularWall[], rotations: readonly number[], alpha: number): StepView | null {
    if (!this.ready(timeMs)) return null;
    const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    const prev = this.prev;
    const view = this.view;
    const n = balls.length;
    view.balls.length = n;
    const pooled = Math.min(n, INTERP_MAX_BALLS);
    while (this.ballPool.length < pooled) this.growPool();
    // Balls rarely change slots; a removal shifts the later ones down by one, which `shift` follows.
    let shift = 0;
    for (let k = 0; k < n; k++) {
      const live = balls[k];
      if (k >= pooled) {
        view.balls[k] = live;
        continue;
      }
      let j = k + shift;
      if (!(j >= 0 && j < prev.balls && prev.ids[j] === live.id)) {
        j = -1;
        for (let i = 0; i < prev.balls; i++) {
          if (prev.ids[i] === live.id) {
            j = i;
            break;
          }
        }
        if (j >= 0) shift = j - k;
      }
      let x = live.x;
      let y = live.y;
      let radius = live.radius;
      let angle = live.angle;
      if (j >= 0 && a < 1) {
        const dx = live.x - prev.x[j];
        const dy = live.y - prev.y[j];
        if (dx * dx + dy * dy <= INTERP_SNAP_PX * INTERP_SNAP_PX) {
          const back = 1 - a;
          x -= dx * back;
          y -= dy * back;
          radius -= (live.radius - prev.radius[j]) * back;
          angle -= angleDelta(prev.angle[j], live.angle) * back;
        }
      }
      const ball = this.ballPool[k];
      ball.id = live.id;
      ball.x = x;
      ball.y = y;
      ball.vx = live.vx;
      ball.vy = live.vy;
      ball.radius = radius;
      ball.color = live.color;
      ball.spin = live.spin;
      ball.angle = angle;
      ball.lifetime = live.lifetime;
      ball.frozen = live.frozen;
      ball.gravityScale = live.gravityScale;
      ball.radiusScale = live.radiusScale;
      ball.team = live.team;
      ball.mult = live.mult;
      // Trail: the engine's points oldest first, the newest one (where the engine has the ball) moved to where it is drawn.
      const src = live.trail;
      const len = Math.min(src.length, TRAIL);
      const points = this.trailPoints[k];
      const trail = ball.trail;
      const start = src.length - len;
      for (let i = 0; i < len; i++) {
        const p = src[(live.trailIndex + start + i) % src.length];
        points[i].x = p.x;
        points[i].y = p.y;
        trail[i] = points[i];
      }
      if (len > 0) {
        points[len - 1].x = x;
        points[len - 1].y = y;
      }
      trail.length = len;
      ball.trailIndex = 0;
      view.balls[k] = ball;
    }

    // Walls: rotation the short way round and radius (breathing walls), while the layout is the same as a step ago.
    const nw = walls.length;
    const same = prev.walls === Math.min(nw, INTERP_MAX_WALLS);
    view.walls.length = nw;
    view.rotations.length = nw;
    while (this.wallPool.length < Math.min(nw, INTERP_MAX_WALLS)) this.wallPool.push({ radius: 0, gaps: NO_GAPS });
    for (let w = 0; w < nw; w++) {
      const rot = rotations[w] ?? 0;
      if (w >= INTERP_MAX_WALLS) {
        view.walls[w] = walls[w];
        view.rotations[w] = rot;
        continue;
      }
      const wall = this.wallPool[w];
      const back = same ? 1 - a : 0;
      wall.radius = walls[w].radius - (walls[w].radius - prev.wallRadius[w]) * back;
      wall.gaps = walls[w].gaps;
      view.walls[w] = wall;
      view.rotations[w] = rot - angleDelta(prev.rotation[w], rot) * back;
    }
    return view;
  }

  private growPool() {
    const trail: { x: number; y: number }[] = [];
    for (let j = 0; j < TRAIL; j++) trail.push({ x: 0, y: 0 });
    this.trailPoints.push(trail.slice());
    this.ballPool.push({ id: -1, x: 0, y: 0, vx: 0, vy: 0, radius: 1, color: "#ffffff", trail, trailIndex: 0, spin: 0, angle: 0 });
  }
}
