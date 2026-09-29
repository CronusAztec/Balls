import type { Ball, CircularWall, Gap } from "@/lib/physics/types";
import { REPLAY_POST_ROLL_MS, REPLAY_WINDOW_MS } from "./camera";

/**
 * The escape replay's memory: a ring buffer of the last ~2 s of simulation, one frame per 60 Hz physics
 * step – every ball's position, size, id, sprite angle and colour, every wall's rotation and radius, which
 * walls are broken and the wall-break count. Everything lives in typed arrays allocated once, and
 * sampling writes into pooled objects, so recording and replaying allocate nothing per frame.
 *
 * `sample(t)` rebuilds the scene at any simulation time inside the buffer, interpolating between the two
 * frames around it (ball identity follows the ball id, rotations take the short way round), with a trail
 * per ball built from its recorded positions – the engine's own trail length, oldest point first. The
 * renderer draws that view instead of the live engine state while the replay plays; the engine itself is
 * never touched.
 *
 * The buffer freezes (stops recording) `REPLAY_POST_ROLL_MS` after every ball got outside the outer wall
 * (`noteEscape()`), or when told to at the end of the run (`freeze()`), so the replay shows the escape
 * itself even in Classic, whose run only ends once the ball has flown far off-screen.
 */

/** Balls recorded per frame (more are left out of the replay). */
export const REPLAY_MAX_BALLS = 24;
/** Walls recorded per frame (the broken set is a 32-bit mask). */
export const REPLAY_MAX_WALLS = 32;
/** Points in a replayed ball's trail – the engine's trail length. */
export const REPLAY_TRAIL = 20;

const BALL_FIELDS = 5; // x, y, radius, id, angle
const TWO_PI = Math.PI * 2;
const NO_GAPS: Gap[] = [];

/** The scene at one moment of the replay. Owned by the buffer and rewritten by every `sample()`. */
export interface ReplayView {
  /** Simulation time shown (ms). */
  time: number;
  balls: Ball[];
  walls: CircularWall[];
  rotations: number[];
  broken: Set<number>;
  /** The broken walls as a bit mask (bit w = wall w), to spot the walls that break during the replay. */
  brokenMask: number;
  /** The engine's wall-break count at that moment (the renderer shakes when it grows during the replay). */
  breakSerial: number;
}

/** Shortest signed angular difference b − a in (−π, π]. */
function angleDelta(a: number, b: number) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}

export class ReplayBuffer {
  readonly capacity: number;
  private readonly times: Float64Array;
  private readonly ballCounts: Uint8Array;
  private readonly ballData: Float64Array;
  private readonly ballColors: string[];
  private readonly wallCounts: Uint8Array;
  private readonly wallRotations: Float64Array;
  private readonly wallRadii: Float64Array;
  private readonly brokenMasks: Uint32Array;
  private readonly breakSerials: Float64Array;
  /** Physical index of the next write. */
  private head = 0;
  private count = 0;
  private frozen = false;
  private outsideSince = -1;
  readonly view: ReplayView;
  private readonly ballPool: Ball[] = [];
  private readonly wallPool: CircularWall[] = [];
  /** The preallocated trail points of every pooled ball (the trail arrays themselves shrink and grow). */
  private readonly trailPoints: { x: number; y: number }[][];

  /** Room for `windowMs` of simulation at `stepMs` per frame, plus a little slack. */
  constructor(windowMs = REPLAY_WINDOW_MS + REPLAY_POST_ROLL_MS, stepMs = 1000 / 60) {
    this.capacity = Math.ceil(windowMs / stepMs) + 12;
    const cap = this.capacity;
    this.times = new Float64Array(cap);
    this.ballCounts = new Uint8Array(cap);
    this.ballData = new Float64Array(cap * REPLAY_MAX_BALLS * BALL_FIELDS);
    this.ballColors = new Array<string>(cap * REPLAY_MAX_BALLS).fill("#ffffff");
    this.wallCounts = new Uint8Array(cap);
    this.wallRotations = new Float64Array(cap * REPLAY_MAX_WALLS);
    this.wallRadii = new Float64Array(cap * REPLAY_MAX_WALLS);
    this.brokenMasks = new Uint32Array(cap);
    this.breakSerials = new Float64Array(cap);
    for (let i = 0; i < REPLAY_MAX_BALLS; i++) {
      const trail: { x: number; y: number }[] = [];
      for (let j = 0; j < REPLAY_TRAIL; j++) trail.push({ x: 0, y: 0 });
      this.ballPool.push({ id: -1, x: 0, y: 0, vx: 0, vy: 0, radius: 1, color: "#ffffff", trail, trailIndex: 0, spin: 0, angle: 0 });
    }
    this.trailPoints = this.ballPool.map((b) => b.trail.slice());
    for (let i = 0; i < REPLAY_MAX_WALLS; i++) this.wallPool.push({ radius: 0, gaps: NO_GAPS });
    this.view = { time: 0, balls: [], walls: [], rotations: [], broken: new Set<number>(), brokenMask: 0, breakSerial: 0 };
  }

  clear() {
    this.head = 0;
    this.count = 0;
    this.frozen = false;
    this.outsideSince = -1;
  }

  /** Frames recorded (at most `capacity`). */
  get size() {
    return this.count;
  }

  isFrozen() {
    return this.frozen;
  }

  /** Stops recording: what is in the buffer now is what the replay shows. */
  freeze() {
    this.frozen = true;
  }

  /** Simulation time of the oldest / newest frame (NaN while empty). */
  startTime() {
    return this.count > 0 ? this.times[this.phys(0)] : NaN;
  }
  endTime() {
    return this.count > 0 ? this.times[this.phys(this.count - 1)] : NaN;
  }

  /** Start of the replay window: the last `REPLAY_WINDOW_MS` of the buffer. */
  windowStart() {
    return this.count > 0 ? Math.max(this.startTime(), this.endTime() - REPLAY_WINDOW_MS) : NaN;
  }

  /** Simulation time at which every ball got outside the outer wall (−1 while one is still inside). */
  escapeTime() {
    return this.outsideSince;
  }

  private phys(i: number) {
    return (this.head - this.count + i + this.capacity) % this.capacity;
  }

  /**
   * Records the scene after a physics step at simulation time `timeMs`. Ignored once frozen or when the
   * time did not advance; a time before the newest frame means the run restarted, which empties the buffer.
   */
  record(timeMs: number, balls: readonly Ball[], walls: readonly CircularWall[], rotations: readonly number[], broken: ReadonlySet<number>, breakSerial: number) {
    if (this.count > 0) {
      const last = this.endTime();
      if (timeMs < last) this.clear();
      else if (timeMs === last) return;
    }
    if (this.frozen) return;
    const f = this.head;
    this.times[f] = timeMs;
    const nb = Math.min(balls.length, REPLAY_MAX_BALLS);
    this.ballCounts[f] = nb;
    const bBase = f * REPLAY_MAX_BALLS;
    for (let k = 0; k < nb; k++) {
      const b = balls[k];
      const o = (bBase + k) * BALL_FIELDS;
      this.ballData[o] = b.x;
      this.ballData[o + 1] = b.y;
      this.ballData[o + 2] = b.radius;
      this.ballData[o + 3] = b.id;
      this.ballData[o + 4] = b.angle;
      this.ballColors[bBase + k] = b.color;
    }
    const nw = Math.min(walls.length, REPLAY_MAX_WALLS);
    this.wallCounts[f] = nw;
    const wBase = f * REPLAY_MAX_WALLS;
    let mask = 0;
    for (let w = 0; w < nw; w++) {
      this.wallRotations[wBase + w] = rotations[w] ?? 0;
      this.wallRadii[wBase + w] = walls[w].radius;
      if (broken.has(w)) mask |= 1 << w;
    }
    this.brokenMasks[f] = mask >>> 0;
    this.breakSerials[f] = breakSerial;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /**
   * Tells the buffer whether every ball is outside the outer wall at `timeMs`. It freezes once that has
   * held for `REPLAY_POST_ROLL_MS` (a ball coming back inside – a Portal teleport – resets the clock).
   */
  noteEscape(timeMs: number, outside: boolean) {
    if (this.frozen) return;
    if (!outside) {
      this.outsideSince = -1;
      return;
    }
    if (this.outsideSince < 0) this.outsideSince = timeMs;
    else if (timeMs - this.outsideSince >= REPLAY_POST_ROLL_MS) this.frozen = true;
  }

  /** Logical index of the last frame at or before `timeMs` (0 before the first frame). */
  private frameAt(timeMs: number) {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.times[this.phys(mid)] <= timeMs) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Slot of ball `id` in physical frame `f`, trying `hint` first (balls rarely change slots); −1 when absent. */
  private slotOf(f: number, id: number, hint: number) {
    const n = this.ballCounts[f];
    const base = f * REPLAY_MAX_BALLS;
    if (hint < n && this.ballData[(base + hint) * BALL_FIELDS + 3] === id) return hint;
    for (let k = 0; k < n; k++) if (this.ballData[(base + k) * BALL_FIELDS + 3] === id) return k;
    return -1;
  }

  /**
   * Rebuilds the scene at simulation time `timeMs` (clamped to the buffer) into `view` and returns it, or
   * null while the buffer is empty. `liveWalls` lends the gap layout of each wall (gaps are not recorded).
   */
  sample(timeMs: number, liveWalls: readonly CircularWall[]): ReplayView | null {
    if (this.count === 0) return null;
    const view = this.view;
    const i = this.frameAt(timeMs);
    const f = this.phys(i);
    const hasNext = i + 1 < this.count;
    const g = hasNext ? this.phys(i + 1) : f;
    const t0 = this.times[f];
    const t1 = this.times[g];
    const a = hasNext && t1 > t0 ? Math.max(0, Math.min(1, (timeMs - t0) / (t1 - t0))) : 0;
    view.time = hasNext ? t0 + a * (t1 - t0) : t0;

    // Balls: interpolated toward the same ball (by id) in the next frame, with a trail of recorded positions.
    const nb = this.ballCounts[f];
    view.balls.length = nb;
    const data = this.ballData;
    for (let k = 0; k < nb; k++) {
      const o = (f * REPLAY_MAX_BALLS + k) * BALL_FIELDS;
      const id = data[o + 3];
      const ball = this.ballPool[k];
      let x = data[o];
      let y = data[o + 1];
      let radius = data[o + 2];
      let angle = data[o + 4];
      const kn = hasNext ? this.slotOf(g, id, k) : -1;
      const between = kn >= 0 && a > 0;
      if (between) {
        const on = (g * REPLAY_MAX_BALLS + kn) * BALL_FIELDS;
        x += (data[on] - x) * a;
        y += (data[on + 1] - y) * a;
        radius += (data[on + 2] - radius) * a;
        angle += angleDelta(angle, data[on + 4]) * a;
      }
      ball.id = id;
      ball.x = x;
      ball.y = y;
      ball.radius = radius;
      ball.angle = angle;
      ball.color = this.ballColors[f * REPLAY_MAX_BALLS + k];
      // Trail: the ball's positions in the frames up to this one (oldest first), then – between two frames –
      // where it is now.
      const points = this.trailPoints[k];
      const trail = ball.trail;
      let n = 0;
      const first = Math.max(0, i - (REPLAY_TRAIL - (between ? 2 : 1)));
      let hint = k;
      for (let j = first; j <= i; j++) {
        const pf = this.phys(j);
        const slot = this.slotOf(pf, id, hint);
        if (slot < 0) continue;
        hint = slot;
        const po = (pf * REPLAY_MAX_BALLS + slot) * BALL_FIELDS;
        points[n].x = data[po];
        points[n].y = data[po + 1];
        trail[n] = points[n];
        n++;
      }
      if (between) {
        points[n].x = x;
        points[n].y = y;
        trail[n] = points[n];
        n++;
      }
      trail.length = n;
      ball.trailIndex = 0;
      view.balls[k] = ball;
    }

    // Walls: rotation (the short way round) and radius interpolated; the broken set of this frame.
    const nw = this.wallCounts[f];
    const nwNext = hasNext ? this.wallCounts[g] : 0;
    view.walls.length = nw;
    view.rotations.length = nw;
    for (let w = 0; w < nw; w++) {
      let rot = this.wallRotations[f * REPLAY_MAX_WALLS + w];
      let radius = this.wallRadii[f * REPLAY_MAX_WALLS + w];
      if (w < nwNext && a > 0) {
        rot += angleDelta(rot, this.wallRotations[g * REPLAY_MAX_WALLS + w]) * a;
        radius += (this.wallRadii[g * REPLAY_MAX_WALLS + w] - radius) * a;
      }
      const wall = this.wallPool[w];
      wall.radius = radius;
      wall.gaps = w < liveWalls.length ? liveWalls[w].gaps : NO_GAPS;
      view.walls[w] = wall;
      view.rotations[w] = rot;
    }
    const mask = this.brokenMasks[f];
    view.broken.clear();
    for (let w = 0; w < nw; w++) if (mask & (1 << w)) view.broken.add(w);
    view.brokenMask = mask;
    view.breakSerial = this.breakSerials[f];
    return view;
  }
}
