/**
 * One-dimensional collisions on a circular track: the "Lollipops collide on a ring" variant of the
 * Collision Playground (modes/collide.ts). Every body is a disc whose centre is constrained to a circle of
 * radius `radius` around the arena centre; its state is its arc position `s` (px along the track, body at
 * the angle s / R) and its arc velocity `v` (px/s). Masses are proportional to the disc area.
 *
 * On a ring, bodies can never overtake each other while they collide, so the order around the track is
 * fixed: each body only ever touches its two neighbours in `order`, and the contact test is O(n) per pass.
 * Two discs touch when their centres are one chord of length ra + rb apart, i.e. an arc of
 * `contactArc(ra, rb, R)` = 2R·asin((ra + rb) / 2R) – slightly more than ra + rb, so drawn discs meet exactly.
 * The positions stay continuous (the last body's neighbour is the first one plus one circumference), and
 * `renormalizeRing()` shifts all of them by whole circumferences to keep the numbers small.
 *
 * All functions are pure maths over typed arrays: no allocation, no randomness, deterministic.
 */

export interface RingTrack {
  /** Radius of the track (px). */
  radius: number;
  /** Bodies on the track. */
  n: number;
  /** Arc position of each body (px along the track). */
  s: Float64Array;
  /** Arc velocity of each body (px/s, positive = increasing angle). */
  v: Float64Array;
  /** Disc radius of each body (px). */
  r: Float64Array;
  /** 1 / mass of each body (mass ∝ area). */
  invMass: Float64Array;
  /** Body indices in track order (increasing `s`, cyclic). */
  order: Int32Array;
}

export function createRingTrack(n: number, radius: number): RingTrack {
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  return { radius, n, s: new Float64Array(n), v: new Float64Array(n), r: new Float64Array(n), invMass: new Float64Array(n).fill(1), order };
}

/** Circumference of the track. */
export function ringLength(track: RingTrack): number {
  return 2 * Math.PI * track.radius;
}

/**
 * Arc distance between the centres of two discs of radii `ra` and `rb` that just touch on a track of radius
 * `trackRadius` (their chord is ra + rb). Discs too big for the track are capped at half a circumference.
 */
export function contactArc(ra: number, rb: number, trackRadius: number): number {
  if (!(trackRadius > 0)) return ra + rb;
  const half = (ra + rb) / (2 * trackRadius);
  if (half >= 1) return Math.PI * trackRadius;
  return 2 * trackRadius * Math.asin(half);
}

/** Sorts `order` by arc position (after placing the bodies). */
export function sortRingOrder(track: RingTrack) {
  const idx = Array.from(track.order.subarray(0, track.n));
  idx.sort((a, b) => track.s[a] - track.s[b] || a - b);
  for (let k = 0; k < idx.length; k++) track.order[k] = idx[k];
}

/**
 * Advances every body by `dt` seconds: semi-implicit Euler with the tangential component of a downward
 * gravity `gravity` (px/s²) – on a circle of angle θ = s / R (y pointing down) that is g · cos θ – so the
 * bodies swing like pendulums around the bottom; 0 keeps the speeds constant.
 */
export function advanceRing(track: RingTrack, dt: number, gravity: number) {
  const { n, s, v, radius } = track;
  if (gravity !== 0 && radius > 0) {
    const inv = 1 / radius;
    for (let i = 0; i < n; i++) {
      v[i] += gravity * Math.cos(s[i] * inv) * dt;
      s[i] += v[i] * dt;
    }
  } else {
    for (let i = 0; i < n; i++) s[i] += v[i] * dt;
  }
}

/**
 * Resolves the contacts between neighbours on the track: overlapping neighbours are pushed apart along the
 * track (split by inverse mass) and approaching ones exchange momentum with the coefficient of restitution
 * `restitution` (1 = elastic: 1-D elastic collisions of unequal masses; equal masses swap velocities).
 * Chains of contacts (a Newton's cradle) are handled by repeating the pass, alternating its direction, up to
 * `iterations` times or until nothing overlaps. `onImpact(a, b, speed)` is told about every rebound with
 * the approach speed. Returns the number of rebounds.
 */
export function resolveRingContacts(track: RingTrack, restitution: number, iterations = 4, onImpact?: (a: number, b: number, speed: number) => void): number {
  const { n, s, v, r, invMass, order, radius } = track;
  if (n < 2) return 0;
  const length = 2 * Math.PI * radius;
  let impacts = 0;
  for (let it = 0; it < iterations; it++) {
    let overlapping = false;
    const forward = it % 2 === 0;
    for (let step = 0; step < n; step++) {
      const k = forward ? step : n - 1 - step;
      const a = order[k];
      const b = order[k === n - 1 ? 0 : k + 1];
      const wrap = k === n - 1 ? length : 0;
      const gap = s[b] + wrap - s[a] - contactArc(r[a], r[b], radius);
      if (gap >= 0) continue;
      overlapping = true;
      const ia = invMass[a];
      const ib = invMass[b];
      const sum = ia + ib;
      if (!(sum > 0)) continue;
      // Push apart along the track: a back, b forward, by inverse mass.
      s[a] += (gap * ia) / sum;
      s[b] -= (gap * ib) / sum;
      const rel = v[b] - v[a];
      if (rel >= 0) continue; // already separating
      const j = (-(1 + restitution) * rel) / sum;
      v[a] -= j * ia;
      v[b] += j * ib;
      impacts++;
      onImpact?.(a, b, -rel);
    }
    if (!overlapping) break;
  }
  return impacts;
}

/**
 * Keeps the arc positions small: shifts all of them by whole circumferences so the first body in track order
 * lies in [0, L) (the differences, and so the order, are unchanged). With `independent` (bodies that pass
 * through each other) every position is wrapped on its own instead.
 */
export function renormalizeRing(track: RingTrack, independent = false) {
  const { n, s } = track;
  if (n === 0) return;
  const length = ringLength(track);
  if (!(length > 0)) return;
  if (independent) {
    for (let i = 0; i < n; i++) {
      if (s[i] >= length || s[i] < 0) s[i] -= Math.floor(s[i] / length) * length;
    }
    return;
  }
  const first = s[track.order[0]];
  if (first >= 0 && first < length) return;
  const shift = Math.floor(first / length) * length;
  for (let i = 0; i < n; i++) s[i] -= shift;
}

/** Total kinetic energy ½ Σ m v² (for tests and diagnostics). */
export function ringKineticEnergy(track: RingTrack): number {
  let e = 0;
  for (let i = 0; i < track.n; i++) if (track.invMass[i] > 0) e += (0.5 * track.v[i] * track.v[i]) / track.invMass[i];
  return e;
}

/** Total momentum Σ m v along the track (for tests and diagnostics). */
export function ringMomentum(track: RingTrack): number {
  let p = 0;
  for (let i = 0; i < track.n; i++) if (track.invMass[i] > 0) p += track.v[i] / track.invMass[i];
  return p;
}
