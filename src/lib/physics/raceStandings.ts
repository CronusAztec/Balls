/**
 * Standings of the Square Racing Grand Prix (modes/race.ts) – pure maths, no DOM, allocation-free per step:
 *
 * - `rankRacers()` keeps the running order: finishers first in finishing order, then the racers still racing by how far
 *   down the track they are – with a hysteresis, so two racers side by side do not swap places every frame (a pass only
 *   counts once the passer is clearly ahead) – and the racers that did not finish (DNF) last;
 * - `LeaderClock` remembers when the front of the race reached every stretch of the track, so the gap of a racer is the
 *   time since the leader was where that racer is now (the interval timing of real racing, no speeds guessed);
 * - `F1_POINTS` / `pointsForPlace()` score a race for the cups (lib/raceCup.ts).
 */

/** Formula 1 points for places 1–10; everybody else (and a DNF) scores nothing. */
export const F1_POINTS: readonly number[] = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/** Points for a finishing place (1-based); 0 beyond tenth, for a DNF (−1) or no place (0). */
export function pointsForPlace(place: number): number {
  if (!Number.isInteger(place) || place < 1 || place > F1_POINTS.length) return 0;
  return F1_POINTS[place - 1];
}

/** Group of a racer in the order: 0 finished, 1 racing, 2 did not finish. */
function group(place: number): number {
  return place > 0 ? 0 : place === 0 ? 1 : 2;
}

/**
 * Re-ranks `order` (racer indices, first place first) in place for `n` racers. `place[i]` is the finishing place of
 * racer i (1-based), 0 while it is racing and −1 for a DNF; `progress[i]` is how far down the track it is (px).
 * Finishers keep their finishing order ahead of everyone, DNFs trail by progress, and a racing racer overtakes the one
 * ranked just ahead of it only once it is more than `hysteresis` px further down. Every overtake of a racing racer is
 * reported through `onPass(passer, passed, newIndex)` (newIndex: the passer's 0-based position after the pass). Returns
 * the number of passes. An `order` that does not hold 0 … n − 1 exactly once is rebuilt first (no passes reported for
 * that).
 */
export function rankRacers(
  order: number[],
  n: number,
  progress: ArrayLike<number>,
  place: ArrayLike<number>,
  hysteresis: number,
  onPass?: (passer: number, passed: number, newIndex: number) => void,
): number {
  if (!isPermutation(order, n)) {
    order.length = 0;
    for (let i = 0; i < n; i++) order.push(i);
  }
  // Stable insertion sort by group: finishers by place, racers kept in their current order, DNFs by progress.
  for (let j = 1; j < n; j++) {
    const x = order[j];
    const gx = group(place[x]);
    let k = j;
    while (k > 0) {
      const y = order[k - 1];
      const gy = group(place[y]);
      const before = gx < gy || (gx === gy && ((gx === 0 && place[x] < place[y]) || (gx === 2 && progress[x] > progress[y])));
      if (!before) break;
      order[k] = y;
      k--;
    }
    order[k] = x;
  }
  // Overtakes among the racers still racing, with the hysteresis (bubble passes until the order holds).
  let start = 0;
  while (start < n && group(place[order[start]]) === 0) start++;
  let end = start;
  while (end < n && group(place[order[end]]) === 1) end++;
  let passes = 0;
  for (let sweep = 0; sweep < n; sweep++) {
    let swapped = false;
    for (let j = start; j < end - 1; j++) {
      const ahead = order[j];
      const behind = order[j + 1];
      if (progress[behind] > progress[ahead] + hysteresis) {
        order[j] = behind;
        order[j + 1] = ahead;
        passes++;
        swapped = true;
        onPass?.(behind, ahead, j);
      }
    }
    if (!swapped) break;
  }
  return passes;
}

/** True when `order` holds 0 … n − 1 exactly once (a bit mask up to 30 racers – a race has at most 16 – a set beyond). */
function isPermutation(order: readonly number[], n: number): boolean {
  if (order.length !== n) return false;
  if (n > 30) return new Set(order).size === n && order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
  let mask = 0;
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n) return false;
    const bit = 1 << i;
    if (mask & bit) return false;
    mask |= bit;
  }
  return true;
}

/**
 * When the front of the race reached every stretch of a track `length` px long, in `bins` bins: `advance()` records the
 * front's progress after every step (times between two records are interpolated), `gapMs()` gives how long ago the
 * front was where a racer is now – the racer's gap to the leader. Reused across races (`reset()`), no allocation per step.
 */
export class LeaderClock {
  private times: Float64Array;
  private binSize = 1;
  private front = 0;
  private frontMs = 0;
  /** Highest bin whose time is known. */
  private reached = -1;

  constructor(private readonly bins = 1024) {
    this.times = new Float64Array(bins + 1);
  }

  /** A new race over `length` px, starting at time `startMs` (the gun). */
  reset(length: number, startMs = 0) {
    this.binSize = Math.max(1e-6, length / this.bins);
    this.times.fill(0);
    this.front = 0;
    this.frontMs = startMs;
    this.times[0] = startMs;
    this.reached = 0;
  }

  /** How far the front has got (px). */
  getFront() {
    return this.front;
  }

  /** The front of the race is at `progress` px at time `tMs` (a front that fell back – nothing does – is ignored). */
  advance(progress: number, tMs: number) {
    const p = Math.max(0, Math.min(progress, this.binSize * this.bins));
    if (p <= this.front) {
      this.frontMs = tMs;
      return;
    }
    const last = Math.min(this.bins, Math.floor(p / this.binSize));
    for (let b = this.reached + 1; b <= last; b++) {
      const at = b * this.binSize;
      const f = (at - this.front) / (p - this.front);
      this.times[b] = this.frontMs + Math.max(0, Math.min(1, f)) * (tMs - this.frontMs);
    }
    if (last > this.reached) this.reached = last;
    this.front = p;
    this.frontMs = tMs;
  }

  /** Time (ms) the front reached `progress`, interpolated within its bin; NaN when the front has not got there yet. */
  timeAt(progress: number): number {
    if (progress > this.front) return NaN;
    const p = Math.max(0, progress);
    const b = Math.min(this.reached, Math.floor(p / this.binSize));
    const t0 = this.times[b];
    if (b + 1 <= this.reached) {
      const t1 = this.times[b + 1];
      return t0 + ((p - b * this.binSize) / this.binSize) * (t1 - t0);
    }
    // In the front's own bin: between the bin's start and the front's latest record.
    const start = b * this.binSize;
    const span = this.front - start;
    return span > 0 ? t0 + ((p - start) / span) * (this.frontMs - t0) : this.frontMs;
  }

  /** The gap (ms) of a racer at `progress` at time `nowMs`: 0 at the front. */
  gapMs(progress: number, nowMs: number): number {
    if (progress >= this.front) return 0;
    const t = this.timeAt(progress);
    return Number.isFinite(t) ? Math.max(0, nowMs - t) : 0;
  }
}
