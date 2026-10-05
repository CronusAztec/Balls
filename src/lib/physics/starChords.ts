import { atLeastMin, ENTITY_CEILING, memoryCeiling } from "@/lib/uncap";
import { degreeToMidi } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";

/*
 * --- chord-stars --- Chord Stars: the pure side of the mode (lib/physics/modes/starChords.ts runs it, the canvas draws it with
 * components/simulator/starChordsRenderer.ts). After the loop family's "five balls, five stars, all closing at once" clip: balls
 * ride inside one circle, and a ball that bounces off a circle always meets the wall at the same angle – so ball i moves its
 * contact point by the same central angle 2π·kᵢ/nᵢ every bounce, its chords (each 2R·sin(π·kᵢ/nᵢ) long) trace the star polygon
 * {nᵢ/kᵢ}, and every one of them stays tangent to the inner circle of radius R·cos(π·kᵢ/nᵢ), which appears as the chords pile up.
 *
 * The motion is analytic, never integrated: at cycle time t ball i has made bᵢ = ⌊t·nᵢ/T⌋ bounces and sits on the chord from
 * vertex bᵢ to vertex bᵢ + 1, so its speed nᵢ·chordᵢ/T makes every star close on the same frame t = T, whatever the frame rate.
 * Then the drawing holds (`holdSec`), fades (`fadeSec`) and the next cycle starts exactly as the first: a seamless loop of
 * T + hold + fade seconds (the loop contract, lib/loop/loopContract.ts).
 *
 * Here: the geometry (vertices, chords, envelope circles), the timing (the cycle's phase, the bounces so far), the star list of a
 * run (the typed n/k pairs, extended for more balls), random coprime star sets and their score (Find Simulation searches them),
 * the cycle that fits a clip in whole loops, the per-ball pitch (A major pentatonic by speed), the palette, and the settings side
 * – fields, defaults, comfort ranges, URL keys (scn, scs, sct, sch, scf, scsp, scw, sce, scp, scv, scc), validation and presets.
 */

/* ------------------------------------------------------------------ stars */

/** A star polygon {n/k}: n points, the contact point moving k points round the circle every bounce. */
export interface StarSpec {
  n: number;
  k: number;
}

/** The default stars of the five balls (the clip's five: a pentagram, two heptagram-likes, an enneagram and a dodecagram). */
export const DEFAULT_STARS = "5/2,7/3,8/3,9/4,12/5";

/** Greatest common divisor of two whole numbers (≥ 0). */
export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y > 0) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
}

/** True when the pair is a star the finder likes: coprime, 2 ≤ k < n/2 (k = 1 is the plain polygon, k > n/2 its mirror). */
export function isProperStar(s: StarSpec): boolean {
  return s.n >= 5 && s.k >= 2 && 2 * s.k < s.n && gcd(s.n, s.k) === 1;
}

/** How many times one cycle traces the reduced star (gcd(n, k): {10/4} draws {5/2} twice). */
export function starLaps(s: StarSpec): number {
  return Math.max(1, gcd(s.n, s.k));
}

/** A star as typed: whole n ≥ 2 and a step 1 ≤ k ≤ n − 1 (a step of n or more wraps round; a step of 0 or n is no star). */
export function normalizeStar(n: number, k: number): StarSpec | null {
  if (!Number.isFinite(n) || !Number.isFinite(k) || !Number.isInteger(n) || !Number.isInteger(k)) return null;
  if (n < 2 || n > Number.MAX_SAFE_INTEGER) return null;
  const step = ((k % n) + n) % n;
  return step === 0 ? null : { n, k: step };
}

/** The most stars a list keeps (the balls' memory-safety ceiling: a star a ball). */
export const SC_STARS_MAX = ENTITY_CEILING;

/** Parses "5/2, 7/3 8/3;{9/4}" into stars (invalid entries dropped, at most SC_STARS_MAX). */
export function parseStars(text: unknown): StarSpec[] {
  if (typeof text !== "string") return [];
  const out: StarSpec[] = [];
  for (const m of text.matchAll(/(-?\d+)\s*\/\s*(-?\d+)/g)) {
    const star = normalizeStar(Number(m[1]), Number(m[2]));
    if (star) out.push(star);
    if (out.length >= SC_STARS_MAX) break;
  }
  return out;
}

/** Stars as stored: "5/2,7/3,…". */
export function serializeStars(stars: readonly StarSpec[]): string {
  return stars.map((s) => `${s.n}/${s.k}`).join(",");
}

/** A star list as stored (parsed, invalid entries dropped); the default list when nothing valid is left. */
export function cleanStars(value: unknown): string {
  const stars = parseStars(value);
  return stars.length > 0 ? serializeStars(stars) : DEFAULT_STARS;
}

/**
 * The stars of a run of `count` balls: the typed ones, then – for every ball past the list – the next point count from 5 up that
 * no ball uses and that makes a star (a coprime step 2 ≤ k < n/2), with the step nearest 0.4·n. Deterministic (no random draws).
 */
export function starsForBalls(list: readonly StarSpec[], count: number): StarSpec[] {
  const n = Math.max(0, Math.floor(count));
  const out: StarSpec[] = list.slice(0, n).map((s) => ({ n: s.n, k: s.k }));
  const used = new Set(out.map((s) => s.n));
  let next = 5;
  while (out.length < n) {
    while (used.has(next) || starStepFor(next) === 0) next++;
    out.push({ n: next, k: starStepFor(next) });
    used.add(next);
    next++;
  }
  return out;
}

/**
 * The coprime step 2 ≤ k < n/2 nearest 0.4·n (the smaller one on a tie), or 0 when n has none (n ≤ 4 and n = 6). Searched
 * outwards from 0.4·n, so a few gcds find it whatever n is.
 */
export function starStepFor(n: number): number {
  if (!(n >= 5)) return 0;
  const maxK = Math.floor((n - 1) / 2);
  const target = 0.4 * n;
  let lo = Math.min(maxK, Math.floor(target));
  let hi = lo + 1;
  while (lo >= 2 || hi <= maxK) {
    const takeLo = lo >= 2 && (hi > maxK || target - lo <= hi - target);
    const k = takeLo ? lo-- : hi++;
    if (gcd(n, k) === 1) return k;
  }
  return 0;
}

/* ------------------------------------------------------------------ geometry */

/** The central angle (radians) the contact point moves every bounce: 2π·k/n. */
export function stepAngle(s: StarSpec): number {
  return (2 * Math.PI * s.k) / s.n;
}

/** A chord's length in a circle of radius `r`: 2r·sin(π·k/n). */
export function chordLength(r: number, s: StarSpec): number {
  return 2 * r * Math.sin((Math.PI * s.k) / s.n);
}

/** The radius of the inner circle every chord of {n/k} touches: r·|cos(π·k/n)| (the chords' distance from the centre). */
export function envelopeRadius(r: number, s: StarSpec): number {
  return r * Math.abs(Math.cos((Math.PI * s.k) / s.n));
}

/** The index (0 … n − 1) of the vertex a ball reaches after `j` bounces: (j·k) mod n, exact for whole numbers. */
export function vertexIndex(j: number, s: StarSpec): number {
  const n = s.n;
  const jj = ((j % n) + n) % n;
  const product = jj * s.k;
  if (product <= Number.MAX_SAFE_INTEGER) return product % n;
  // (huge stars: the product would lose digits – modular multiplication by halves)
  let result = 0;
  let a = jj;
  let b = s.k % n;
  while (b > 0) {
    if (b % 2 === 1) result = (result + a) % n;
    a = (a * 2) % n;
    b = Math.floor(b / 2);
  }
  return result;
}

/** The angle (radians) of vertex `j` of a ball that started at `theta0` (the contact point turning clockwise on screen). */
export function vertexAngle(theta0: number, j: number, s: StarSpec): number {
  return theta0 + (2 * Math.PI * vertexIndex(j, s)) / s.n;
}

/** The ball's speed (px/s) to draw its n chords in `cycleSec`: n·chord / T – each star closes at T. */
export function ballSpeed(r: number, s: StarSpec, cycleSec: number): number {
  return cycleSec > 0 ? (s.n * chordLength(r, s)) / cycleSec : 0;
}

/** The start angles of `count` balls: from the top, `spread` of a full turn shared out evenly (1 = round the whole rim). */
export function startAngles(count: number, spread: number, out: Float64Array = new Float64Array(Math.max(0, count))): Float64Array {
  const n = Math.max(0, Math.floor(count));
  const s = Number.isFinite(spread) ? spread : 1;
  for (let i = 0; i < n; i++) out[i] = -Math.PI / 2 + (n > 0 ? (2 * Math.PI * i * s) / n : 0);
  return out;
}

/* ------------------------------------------------------------------ timing */

/** Time slack (s) of the phase changes and bounces on the simulation clock (floating-point steps). */
export const SC_EPS = 1e-9;

export type ScPhaseName = "draw" | "hold" | "fade";

/** Where a run is in its loop: the cycle (0 = the first), the time into it, the phase and how far through it (0–1). */
export interface ScPhase {
  index: number;
  cycleTime: number;
  phase: ScPhaseName;
  progress: number;
}

/** The loop's length: the drawing, the hold and the fade (s). */
export function periodOf(cycleSec: number, holdSec: number, fadeSec: number): number {
  return Math.max(SC_EPS, cycleSec + Math.max(0, holdSec) + Math.max(0, fadeSec));
}

/** The phase of the loop at simulation time `t` (s), written into `out`. */
export function phaseAt(t: number, cycleSec: number, holdSec: number, fadeSec: number, out: ScPhase = { index: 0, cycleTime: 0, phase: "draw", progress: 0 }): ScPhase {
  const period = periodOf(cycleSec, holdSec, fadeSec);
  const time = Number.isFinite(t) && t > 0 ? t : 0;
  const index = Math.floor((time + SC_EPS) / period);
  let tc = time - index * period;
  if (tc < 0) tc = 0;
  out.index = index;
  out.cycleTime = tc;
  const hold = Math.max(0, holdSec);
  const fade = Math.max(0, fadeSec);
  if (tc < cycleSec - SC_EPS) {
    out.phase = "draw";
    out.progress = cycleSec > 0 ? tc / cycleSec : 1;
  } else if (tc < cycleSec + hold - SC_EPS) {
    out.phase = "hold";
    out.progress = hold > 0 ? (tc - cycleSec) / hold : 1;
  } else {
    out.phase = "fade";
    out.progress = fade > 0 ? Math.min(1, Math.max(0, (tc - cycleSec - hold) / fade)) : 1;
  }
  return out;
}

/** Bounces a ball of {n/k} has made `cycleTime` s into a cycle of `cycleSec`: ⌊t·n/T⌋, all n once the star has closed. */
export function bouncesAt(cycleTime: number, n: number, cycleSec: number): number {
  if (cycleTime >= cycleSec - SC_EPS) return n;
  const b = Math.floor(((cycleTime + SC_EPS) * n) / cycleSec);
  return b < 0 ? 0 : b > n - 1 ? n - 1 : b;
}

/** Every bounce of the ball so far (a running count over the cycles): what a step's bounces are counted from. */
export function totalBouncesAt(t: number, n: number, cycleSec: number, holdSec: number, fadeSec: number, scratch: ScPhase): number {
  const p = phaseAt(t, cycleSec, holdSec, fadeSec, scratch);
  return p.index * n + bouncesAt(p.cycleTime, n, cycleSec);
}

/** The cycles whose stars have all closed by `t` (each closes at its start + T). */
export function closingsAt(t: number, cycleSec: number, holdSec: number, fadeSec: number, scratch: ScPhase): number {
  const p = phaseAt(t, cycleSec, holdSec, fadeSec, scratch);
  return p.index + (p.cycleTime >= cycleSec - SC_EPS ? 1 : 0);
}

/** The cycles whose fade has begun by `t` (at its start + T + hold). */
export function fadeStartsAt(t: number, cycleSec: number, holdSec: number, fadeSec: number, scratch: ScPhase): number {
  const p = phaseAt(t, cycleSec, holdSec, fadeSec, scratch);
  return p.index + (p.cycleTime >= cycleSec + Math.max(0, holdSec) - SC_EPS ? 1 : 0);
}

/**
 * The position of a ball `cycleTime` s into its cycle: on the chord from vertex b to vertex b + 1 (b = its bounces), at the
 * fraction of the chord the time gives; back at its start vertex once the star has closed. Written into `out` (with the
 * velocity, px/s, zero while the drawing holds and fades).
 */
export function positionAt(cx: number, cy: number, r: number, theta0: number, s: StarSpec, cycleSec: number, cycleTime: number, out: { x: number; y: number; vx: number; vy: number }) {
  if (cycleTime >= cycleSec - SC_EPS || !(cycleSec > 0)) {
    out.x = cx + r * Math.cos(theta0);
    out.y = cy + r * Math.sin(theta0);
    out.vx = 0;
    out.vy = 0;
    return out;
  }
  const progress = (cycleTime * s.n) / cycleSec;
  let b = Math.floor(progress);
  if (b > s.n - 1) b = s.n - 1;
  if (b < 0) b = 0;
  const f = Math.min(1, Math.max(0, progress - b));
  const a0 = vertexAngle(theta0, b, s);
  const a1 = vertexAngle(theta0, b + 1, s);
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  out.x = x0 + (x1 - x0) * f;
  out.y = y0 + (y1 - y0) * f;
  out.vx = ((x1 - x0) * s.n) / cycleSec;
  out.vy = ((y1 - y0) * s.n) / cycleSec;
  return out;
}

/* ------------------------------------------------------------------ random coprime star sets (Find Simulation) */

/** Mulberry32: the finder's seeded draws (the engine's own RNG, as a function of a seed). */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** The largest point count a random set draws from: 16, or more when the balls need distinct ones. */
export function randomMaxPoints(count: number): number {
  return Math.max(16, 5 + 2 * Math.max(1, Math.floor(count)));
}

/** Draws a random proper step of `n` points: up to 16 tries of 2 ≤ k < n/2 until one is coprime, else the nearest 0.4·n. */
function randomStep(n: number, random: () => number): number {
  const maxK = Math.floor((n - 1) / 2);
  for (let attempt = 0; attempt < 16; attempt++) {
    const k = 2 + Math.floor(random() * (maxK - 1));
    if (k >= 2 && k <= maxK && gcd(n, k) === 1) return k;
  }
  return starStepFor(n);
}

/**
 * A random star set for `count` balls: distinct point counts from 5 to `randomMaxPoints()` (6 has no star and is skipped), each
 * with a random coprime step 2 ≤ k < n/2, sorted by point count. Draws (`random()`, in this order): per ball its point count (up
 * to 8 tries while taken, then the next free one up), then its step (up to 16 tries until coprime).
 */
export function randomStarSet(count: number, random: () => number): StarSpec[] {
  const n = Math.max(0, Math.floor(count));
  const maxN = randomMaxPoints(n);
  const used = new Set<number>();
  const out: StarSpec[] = [];
  let free = 5;
  for (let i = 0; i < n; i++) {
    let points = 0;
    for (let attempt = 0; attempt < 8 && points === 0; attempt++) {
      const p = 5 + Math.floor(random() * (maxN - 4));
      if (!used.has(p) && p !== 6) points = p;
    }
    if (points === 0) {
      while (used.has(free) || free === 6) free++;
      points = free;
    }
    used.add(points);
    out.push({ n: points, k: randomStep(points, random) });
  }
  return out.sort((a, b) => a.n - b.n);
}

/**
 * How good a star set looks (higher is better; −Infinity breaks the rules: point counts repeat, a step shares a factor with
 * its count or is no star): the inner circles evenly spread – the smallest gap between two of them against an even share of
 * 0.1 … 0.7 of the radius –, none a dot in the centre (below 0.08 R) or a ring near the rim (above 0.75 R), and about eight
 * chords a ball (Σn ≈ 8·count: dense enough to show the circles, light enough to read).
 */
export function starSetScore(stars: readonly StarSpec[]): number {
  const n = stars.length;
  if (n === 0) return -Infinity;
  const points = new Set<number>();
  for (const s of stars) {
    if (!isProperStar(s) || points.has(s.n)) return -Infinity;
    points.add(s.n);
  }
  const radii = stars.map((s) => Math.cos((Math.PI * s.k) / s.n)).sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < n; i++) minGap = Math.min(minGap, radii[i] - radii[i - 1]);
  const spread = n > 1 ? Math.min(1.5, minGap / (0.6 / (n - 1))) : 1;
  const edges = (radii[0] < 0.08 ? 10 * (0.08 - radii[0]) : 0) + (radii[n - 1] > 0.75 ? 10 * (radii[n - 1] - 0.75) : 0);
  let sum = 0;
  for (const s of stars) sum += s.n;
  const density = Math.abs(sum - 8 * n) / (8 * n);
  return spread - 0.5 * density - edges;
}

/** The best of the random star sets of the seeds `seedAt(0 … tries − 1)` (the first one on a tie). */
export function searchStarSets(count: number, tries: number, seedAt: (i: number) => number): { stars: StarSpec[]; seed: number; score: number; tested: number } {
  let best: { stars: StarSpec[]; seed: number; score: number } = { stars: [], seed: 0, score: -Infinity };
  const n = Math.max(0, Math.floor(tries));
  for (let i = 0; i < n; i++) {
    const seed = seedAt(i);
    const stars = randomStarSet(count, seededRandom(seed));
    const score = starSetScore(stars);
    if (score > best.score) best = { stars, seed, score };
  }
  return { ...best, tested: n };
}

/**
 * The drawing time T that fits a clip of `clipSec` in whole loops of T + hold + fade: as many loops as the clip holds at about
 * the current T (`preferSec`), at least one, each T at least `minSec`; null when not even one loop of `minSec` fits.
 */
export function cycleForClip(clipSec: number, holdSec: number, fadeSec: number, preferSec: number, minSec: number): { cycleSec: number; loops: number } | null {
  if (!(clipSec > 0) || !Number.isFinite(clipSec)) return null;
  const rest = Math.max(0, holdSec) + Math.max(0, fadeSec);
  const prefer = Number.isFinite(preferSec) && preferSec > 0 ? preferSec : minSec;
  let loops = Math.max(1, Math.round(clipSec / (prefer + rest)));
  let cycle = clipSec / loops - rest;
  while (cycle < minSec - 1e-9 && loops > 1) {
    loops--;
    cycle = clipSec / loops - rest;
  }
  return cycle >= minSec - 1e-9 ? { cycleSec: cycle, loops } : null;
}

/* ------------------------------------------------------------------ sound and colour */

/** The plucks' key: A major pentatonic from A3 (220 Hz). */
export const SC_ROOT_MIDI = 57;
/** The completion chord's root: A2, the key's tonic (110 Hz – the measured 98–110 Hz chord register). */
export const SC_CHORD_HZ = 110;
/** The widest span of the balls' pitches, in pentatonic degrees (2.8 octaves). */
export const SC_PITCH_SPAN = 14;

/**
 * Every ball's pitch (Hz): its speed's rank among the balls (the slowest lowest) as a degree of the A major pentatonic, two
 * degrees apart while the span allows (5 balls: A, C♯, F♯, B, E – an open 6/9 chord when they close together).
 */
export function ballPitches(speeds: ArrayLike<number>, out: Float64Array = new Float64Array(speeds.length)): Float64Array {
  const n = speeds.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => speeds[a] - speeds[b] || a - b);
  const step = n > 1 ? Math.min(2, SC_PITCH_SPAN / (n - 1)) : 0;
  order.forEach((ball, rank) => {
    out[ball] = midiToFrequency(degreeToMidi(Math.round(rank * step), SC_ROOT_MIDI, "majorPentatonic"));
  });
  return out;
}

export const SC_PALETTES = ["pastel", "rainbow", "ball"] as const;
export type ScPalette = (typeof SC_PALETTES)[number];
/** The account's pastels on navy: pink, cyan, yellow, green, lavender, then peach, sky, orchid, lime, mint, coral and sand. */
export const SC_PASTEL = ["#ff9ecf", "#7fe3ff", "#ffe27a", "#8ff0a4", "#c3a6ff", "#ffb38a", "#9cc2ff", "#f5a3e8", "#d4f57a", "#9ff3e0", "#ff8f8f", "#f3d6a0"] as const;

/** Ball `i` of `count`'s colour: the pastels (then pastel hues a golden angle apart), a rainbow by index, or the page's Ball Color. */
export function ballColorOf(i: number, count: number, palette: ScPalette, ballColor: string): string {
  if (palette === "ball") return ballColor || "#ffffff";
  if (palette === "rainbow") return `hsl(${Math.round((360 * i) / Math.max(1, count))}, 90%, 64%)`;
  if (i < SC_PASTEL.length) return SC_PASTEL[i];
  return `hsl(${Math.round((i * 137.508) % 360)}, 85%, 78%)`;
}

/* ------------------------------------------------------------------ the engine's settings */

export const SC_ENVELOPES = ["closed", "on", "off"] as const;
/** The inner circles: drawn when the star closes, always, or never. */
export type ScEnvelope = (typeof SC_ENVELOPES)[number];
export const SC_VOICES = ["pluck", "chime", "bar", "silent"] as const;
/** The bounces' voice (lib/audio/loopTones.ts): the pentatonic pluck, the glock chime, a tuned bar, or none. */
export type ScVoice = (typeof SC_VOICES)[number];

export function isScEnvelope(value: unknown): value is ScEnvelope {
  return typeof value === "string" && (SC_ENVELOPES as readonly string[]).includes(value);
}
export function isScVoice(value: unknown): value is ScVoice {
  return typeof value === "string" && (SC_VOICES as readonly string[]).includes(value);
}
export function isScPalette(value: unknown): value is ScPalette {
  return typeof value === "string" && (SC_PALETTES as readonly string[]).includes(value);
}

/** What the mode runs (lib/physics/modes/starChords.ts); the look rides along for the canvas. */
export interface StarChordsSettings {
  /** Balls (the run builds at most the memory-safety ceiling). */
  balls: number;
  /** The typed stars, a ball each (more balls take the next free stars: `starsForBalls()`). */
  stars: StarSpec[];
  /** Seconds every star takes to close, the hold after and the fade (s). */
  cycleSec: number;
  holdSec: number;
  fadeSec: number;
  /** The share of a full turn the balls' start points spread over (1 = round the whole rim). */
  spread: number;
  /** The chords' width (world px), the inner circles, the colours. */
  lineWidth: number;
  envelope: ScEnvelope;
  palette: ScPalette;
  /** The bounces' voice and the completion chord (with its reset glide). */
  voice: ScVoice;
  chord: boolean;
}

/* ------------------------------------------------------------------ the page's settings */

/** The feature's fields of the SimulatorSettings object. */
export interface StarChordsFields {
  /** Balls, 1–12 on the slider, any whole number typed (URL `scn`). */
  scBalls: number;
  /** The stars, "n/k" a ball (URL `scs`). */
  scStars: string;
  /** Seconds to close every star, the hold and the fade (URL `sct`, `sch`, `scf`). */
  scCycle: number;
  scHold: number;
  scFade: number;
  /** The start points' spread round the rim (URL `scsp`). */
  scSpread: number;
  /** The chords' width (URL `scw`). */
  scLineWidth: number;
  /** closed | on | off (URL `sce`). */
  scEnvelope: ScEnvelope;
  /** pastel | rainbow | ball (URL `scp`). */
  scPalette: ScPalette;
  /** pluck | chime | bar | silent (URL `scv`). */
  scVoice: ScVoice;
  /** The completion chord and the reset glide (URL `scc`). */
  scChord: boolean;
}

export const DEFAULT_STAR_CHORDS_FIELDS: Readonly<StarChordsFields> = {
  scBalls: 5,
  scStars: DEFAULT_STARS,
  scCycle: 12,
  scHold: 1.2,
  scFade: 1.8,
  scSpread: 1,
  scLineWidth: 1.5,
  scEnvelope: "closed",
  scPalette: "pastel",
  scVoice: "pluck",
  scChord: true,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const SC_RANGES = {
  scBalls: { min: 1, max: 12, step: 1 },
  scCycle: { min: 1, max: 30, step: 0.5 },
  scHold: { min: 0, max: 3, step: 0.1 },
  scFade: { min: 0, max: 3, step: 0.1 },
  scSpread: { min: 0, max: 1, step: 0.01 },
  scLineWidth: { min: 0.5, max: 4, step: 0.1 },
} as const;

type NumberKey = keyof typeof SC_RANGES;
/** The fields the mode's engine reads (the run: the balls, the timing, the start points); the line width is the canvas'. */
export const SC_ENGINE_KEYS: readonly NumberKey[] = ["scBalls", "scCycle", "scHold", "scFade", "scSpread"];
/** The fields a change of which restarts a run (the rest – the look and the sound – follow live). */
export const SC_RESTART_FIELDS: readonly (keyof StarChordsFields)[] = ["scBalls", "scStars", "scCycle", "scHold", "scFade", "scSpread"];

export function defaultStarChordsFields(): StarChordsFields {
  return { ...DEFAULT_STAR_CHORDS_FIELDS };
}

/** A number of `key` from anything: finite and from the slider's minimum up (--- uncap-all --- never a maximum); counts whole. */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_STAR_CHORDS_FIELDS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const v = atLeastMin(n, SC_RANGES[key]);
  return key === "scBalls" ? Math.round(v) : v;
}

/** Validates the feature's fields (URL parameters, presets and project files alike). */
export function resolveStarChordsFields(source: Partial<Record<keyof StarChordsFields, unknown>> | null | undefined): StarChordsFields {
  const s = source ?? {};
  const d = DEFAULT_STAR_CHORDS_FIELDS;
  return {
    scBalls: numberOf("scBalls", s.scBalls),
    scStars: cleanStars(s.scStars ?? d.scStars),
    scCycle: numberOf("scCycle", s.scCycle),
    scHold: numberOf("scHold", s.scHold),
    scFade: numberOf("scFade", s.scFade),
    scSpread: numberOf("scSpread", s.scSpread),
    scLineWidth: numberOf("scLineWidth", s.scLineWidth),
    scEnvelope: isScEnvelope(s.scEnvelope) ? s.scEnvelope : d.scEnvelope,
    scPalette: isScPalette(s.scPalette) ? s.scPalette : d.scPalette,
    scVoice: isScVoice(s.scVoice) ? s.scVoice : d.scVoice,
    scChord: typeof s.scChord === "boolean" ? s.scChord : d.scChord,
  };
}

/** What the mode runs of the fields (`engine.setStarChordsSettings()`: the page, the finder, the exports). */
export function starChordsSettingsOf(s: StarChordsFields): StarChordsSettings {
  return {
    balls: s.scBalls,
    stars: parseStars(s.scStars),
    cycleSec: s.scCycle,
    holdSec: s.scHold,
    fadeSec: s.scFade,
    spread: s.scSpread,
    lineWidth: s.scLineWidth,
    envelope: s.scEnvelope,
    palette: s.scPalette,
    voice: s.scVoice,
    chord: s.scChord,
  };
}

/** The engine's settings back under the fields' names (the numbers; the tests' engine-side view). */
export function starChordsSettingFields(s: StarChordsSettings): Pick<StarChordsFields, NumberKey> {
  return { scBalls: s.balls, scCycle: s.cycleSec, scHold: s.holdSec, scFade: s.fadeSec, scSpread: s.spread, scLineWidth: s.lineWidth };
}

/** The settings the engine runs, the defaults filled in, every number valid (a ball count past its ceiling runs the ceiling). */
export function resolveStarChordsSettings(patch: Partial<StarChordsSettings> | null | undefined): StarChordsSettings {
  const base = starChordsSettingsOf(DEFAULT_STAR_CHORDS_FIELDS);
  const p = patch ?? {};
  const fields = resolveStarChordsFields({
    scBalls: p.balls ?? base.balls,
    scStars: p.stars ? serializeStars(p.stars) : DEFAULT_STARS,
    scCycle: p.cycleSec ?? base.cycleSec,
    scHold: p.holdSec ?? base.holdSec,
    scFade: p.fadeSec ?? base.fadeSec,
    scSpread: p.spread ?? base.spread,
    scLineWidth: p.lineWidth ?? base.lineWidth,
    scEnvelope: p.envelope ?? base.envelope,
    scPalette: p.palette ?? base.palette,
    scVoice: p.voice ?? base.voice,
    scChord: p.chord ?? base.chord,
  });
  const out = starChordsSettingsOf(fields);
  out.balls = memoryCeiling("scBalls", out.balls);
  return out;
}

/** The look a fresh Chord Stars page starts with: the account's navy page, a thin lavender circle, the loop HUD on. */
export const STAR_CHORDS_LOOK = {
  backgroundColors: ["#0b1020", "#0b1020"] as [string, string],
  circleColor: "#b9a8ff",
  rainbowWalls: false,
  loopHud: true,
};

/** The mode's own defaults beside the feature's fields (in Chord Stars only): its look. */
export function starChordsModeDefaults(mode: string): Partial<typeof STAR_CHORDS_LOOK> {
  return mode === "starChords" ? { ...STAR_CHORDS_LOOK, backgroundColors: [...STAR_CHORDS_LOOK.backgroundColors] } : {};
}

/* ------------------------------------------------------------------ presets */

export const SC_PRESET_IDS = ["fiveStars", "sevenBloom", "heptagramDuel"] as const;
export type ScPresetId = (typeof SC_PRESET_IDS)[number];

/** Translation keys (Controls namespace) of the presets' names. */
export const SC_PRESET_LABELS: Readonly<Record<ScPresetId, string>> = {
  fiveStars: "scPresetFiveStars",
  sevenBloom: "scPresetSevenBloom",
  heptagramDuel: "scPresetHeptagramDuel",
};

export function isScPresetId(value: unknown): value is ScPresetId {
  return typeof value === "string" && (SC_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * A preset's fields with the account's look: Five stars (the clip: 5/2, 7/3, 8/3, 9/4, 12/5 round the rim), Seven-point bloom
 * (seven heptagrams {7/3}, each a seventh of a point further round – a 49-point bloom over one inner circle) and Heptagram duel
 * ({7/2} against {7/3} from opposite sides).
 */
export function starChordsPresetPatch(id: ScPresetId): StarChordsFields & typeof STAR_CHORDS_LOOK {
  const look = { ...STAR_CHORDS_LOOK, backgroundColors: [...STAR_CHORDS_LOOK.backgroundColors] as [string, string] };
  if (id === "sevenBloom") return { ...defaultStarChordsFields(), scBalls: 7, scStars: "7/3,7/3,7/3,7/3,7/3,7/3,7/3", scSpread: 1 / 7, scEnvelope: "on", scVoice: "chime", ...look };
  if (id === "heptagramDuel") return { ...defaultStarChordsFields(), scBalls: 2, scStars: "7/2,7/3", scCycle: 10, scHold: 1.5, scFade: 1.5, ...look };
  return { ...defaultStarChordsFields(), ...look };
}

/* ------------------------------------------------------------------ URL */

/** Up to six decimals, trailing zeros dropped, so slider values (and a preset's 1/7) survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields. */
export const SC_URL_KEYS: Readonly<Record<string, NumberKey>> = { scn: "scBalls", sct: "scCycle", sch: "scHold", scf: "scFade", scsp: "scSpread", scw: "scLineWidth" };

/** Writes the fields that differ from `base` (the mode's defaults): scn, scs, sct, sch, scf, scsp, scw, sce, scp, scv, scc. */
export function writeStarChordsParams(settings: StarChordsFields, base: StarChordsFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(SC_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.scStars !== base.scStars) params.set("scs", settings.scStars);
  if (settings.scEnvelope !== base.scEnvelope) params.set("sce", settings.scEnvelope);
  if (settings.scPalette !== base.scPalette) params.set("scp", settings.scPalette);
  if (settings.scVoice !== base.scVoice) params.set("scv", settings.scVoice);
  if (settings.scChord !== base.scChord) params.set("scc", settings.scChord ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readStarChordsParams(params: URLSearchParams, settings: StarChordsFields) {
  const next: Partial<Record<keyof StarChordsFields, unknown>> = { ...settings };
  for (const [key, field] of Object.entries(SC_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  const stars = params.get("scs");
  if (stars !== null) next.scStars = stars;
  const envelope = params.get("sce");
  if (envelope !== null) next.scEnvelope = envelope;
  const palette = params.get("scp");
  if (palette !== null) next.scPalette = palette;
  const voice = params.get("scv");
  if (voice !== null) next.scVoice = voice;
  const chord = params.get("scc");
  if (chord === "1") next.scChord = true;
  else if (chord === "0") next.scChord = false;
  Object.assign(settings, resolveStarChordsFields(next));
}
