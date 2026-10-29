import { BLOCK_MAX_DAYS, BLOCK_PAIRS, KEEP_P, KEEP_RATIO, NOISE_PRIOR_PAIRS, NOISE_PRIOR_SD, PRIOR_SD } from "./learnerRules";
import { hashText, normalCdf, seededDraws } from "./stats";

/*
 * --- learner --- The Trial Reel lab: fold-over blocks of up to three dials, each the best setting (level 0) against one
 * challenger (level 1). A pair is the day's two reels of a block on one Instagram channel: arm A follows the block's pattern
 * and arm B is its complement, so every pair differs in every dial of its block and the day's luck cancels inside it.
 *  - Patterns: three dials rotate 000, 011, 101 and 110; two dials 00 and 01; one dial 0. Over 8 pairs each dial gets 8
 *    balanced contrasts (x = B - A in {-1, +1}, summing to 0 over the patterns of a turn).
 *  - A broken pair (a reel dropped, failed, shared before its read or not measured) is made again with its own pattern, so
 *    the balance holds: the next pattern is the one with the fewest clean or pending pairs.
 *  - Which reel of a pair goes out first is a seeded coin, so a throttled second reel of the day is noise, not bias
 *    (sim/final.py B: none of the rates moves by more than 3 points).
 *  - The fit: D = s_B - s_A = sum over dials of x_j b_j, a Bayesian linear fit with the prior N(0, PRIOR_SD^2) on each effect
 *    and the noise variance from the least-squares residuals with a prior of NOISE_PRIOR_SD worth NOISE_PRIOR_PAIRS
 *    pseudo-pairs, in closed form (sim/merged.py fit). The pair difference needs no usual, so the lab can decide from its
 *    first block. It reads once, after BLOCK_PAIRS clean pairs, and closes "not enough clean pairs" after BLOCK_MAX_DAYS.
 *
 * Pure and deterministic: matrices of at most 3 x 3, draws from seeded generators only.
 */

// --- learner ---

export type Level = 0 | 1;

/** The fold-over patterns of arm A for one, two and three dials (arm B is the complement). */
export const FOLD_PATTERNS: Readonly<Record<1 | 2 | 3, readonly (readonly Level[])[]>> = {
  1: [[0]],
  2: [
    [0, 0],
    [0, 1],
  ],
  3: [
    [0, 0, 0],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
  ],
};

export const BLOCK_DIALS_MAX = 3;

/** The patterns of a block of `k` dials (1 to 3). */
export function patternsOf(k: number): readonly (readonly Level[])[] {
  if (k !== 1 && k !== 2 && k !== 3) throw new Error(`A block has 1 to 3 dials, not ${k}`);
  return FOLD_PATTERNS[k];
}

/** The complement of a pattern: arm B of arm A. */
export const complement = (levels: readonly Level[]): Level[] => levels.map((l) => (l === 0 ? 1 : 0));

/** A reel's arm as the post record keeps it: its levels as digits ("011"). */
export const armOf = (levels: readonly Level[]): string => levels.join("");

/** The levels of a stored arm string of a block of `k` dials, or null. */
export function levelsOf(arm: unknown, k: number): Level[] | null {
  if (typeof arm !== "string" || arm.length !== k || !/^[01]+$/.test(arm)) return null;
  return [...arm].map((c) => (c === "1" ? 1 : 0));
}

/** The contrast of a pair: B's levels less A's, each -1 or +1. */
export const contrastOf = (a: readonly Level[], b: readonly Level[]): number[] => a.map((l, j) => b[j] - l);

/** The arms of pattern `index` of a block of `k` dials. */
export function armsOfPattern(k: number, index: number): { a: Level[]; b: Level[] } {
  const p = patternsOf(k);
  const a = [...p[((index % p.length) + p.length) % p.length]];
  return { a, b: complement(a) };
}

/**
 * The patterns of the next `count` pairs: each time the pattern with the fewest clean or pending pairs so far (a broken one
 * is made again), the lowest index on a tie.
 */
export function nextPatterns(used: readonly { pattern: number; state: "clean" | "pending" | "broken" }[], k: number, count: number): number[] {
  const n = patternsOf(k).length;
  const live = new Array<number>(n).fill(0);
  for (const u of used) if (u.state !== "broken" && u.pattern >= 0 && u.pattern < n) live[u.pattern]++;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let best = 0;
    for (let p = 1; p < n; p++) if (live[p] < live[best]) best = p;
    live[best]++;
    out.push(best);
  }
  return out;
}

/** Which reel of a pair goes out first: a seeded coin from the block, the date and the pair (A first when true). */
export function aFirst(blockId: string, date: string, pair: number): boolean {
  return seededDraws(hashText(`${date}|${blockId}|pair|${pair}`))() < 0.5;
}

/* ------------------------------------------------------------------ the fit */

type Matrix = number[][];

/** The inverse of a small symmetric positive-definite matrix (Gauss-Jordan with partial pivoting). */
export function invert(m: Matrix): Matrix {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) throw new Error("singular matrix");
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

const matVec = (m: Matrix, v: readonly number[]) => m.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));

/** The residual sum of squares of the least-squares fit of D on X (a tiny ridge keeps a rank-deficient X solvable). */
function residualSS(X: readonly (readonly number[])[], D: readonly number[]): number {
  const k = X[0].length;
  const xtx: Matrix = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, x) => s + x[i] * x[j], 0) + (i === j ? 1e-9 : 0)));
  const xtd = Array.from({ length: k }, (_, i) => X.reduce((s, x, r) => s + x[i] * D[r], 0));
  const b = matVec(invert(xtx), xtd);
  return X.reduce((s, x, r) => s + (D[r] - x.reduce((t, xi, j) => t + xi * b[j], 0)) ** 2, 0);
}

export interface PairFit {
  /** The posterior mean of each dial's effect (the log ratio of its challenger to its best). */
  mean: number[];
  /** Its posterior sd. */
  sd: number[];
  /** The noise sd the fit used. */
  noiseSd: number;
  pairs: number;
}

/**
 * The closed-form fit of the pair differences (see the header): x is each pair's contrast, d its difference s_B - s_A. It
 * matches sim/merged.py's fit to the last digit (tests/insightsLab.test.ts pins three cases).
 */
export function fitPairs(pairs: readonly { x: readonly number[]; d: number }[], k: number): PairFit {
  const X = pairs.map((p) => p.x);
  const D = pairs.map((p) => p.d);
  const n = pairs.length;
  // with fewer pairs than dials there is no fit: the differences themselves are the residual (as sim/merged.py does)
  const rss = n === 0 ? 0 : n >= k ? residualSS(X, D) : D.reduce((s, d) => s + d * d, 0);
  const dof = Math.max(n - k, 0);
  const s2 = (NOISE_PRIOR_PAIRS * NOISE_PRIOR_SD ** 2 + rss) / (NOISE_PRIOR_PAIRS + dof);
  const prec: Matrix = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, x) => s + x[i] * x[j], 0) / s2 + (i === j ? 1 / PRIOR_SD ** 2 : 0)));
  const cov = invert(prec);
  const xtd = Array.from({ length: k }, (_, i) => X.reduce((s, x, r) => s + x[i] * D[r], 0) / s2);
  const mean = matVec(cov, xtd);
  return { mean, sd: cov.map((row, i) => Math.sqrt(row[i])), noiseSd: Math.sqrt(s2), pairs: n };
}

/** What a posterior N(m, sd^2) on a challenger's log ratio says, by the keep rule. */
export interface DialCall {
  /** The shrunken ratio e^m, which the card reports (the raw one overstates). */
  ratio: number;
  /** P(the challenger is better). */
  p: number;
  /** Kept: P >= KEEP_P and a ratio of at least KEEP_RATIO. */
  keep: boolean;
  /** The best is clearly better: P(best better) >= KEEP_P. */
  bestBetter: boolean;
  /** The best beats it with P >= KEEP_P and at least KEEP_RATIO (what drops a newcomer). */
  bestClearlyBetter: boolean;
}

export function dialCall(m: number, sd: number): DialCall {
  const p = normalCdf(m / Math.max(sd, 1e-9));
  const ratio = Math.exp(m);
  return { ratio, p, keep: p >= KEEP_P && ratio >= KEEP_RATIO, bestBetter: 1 - p >= KEEP_P, bestClearlyBetter: 1 - p >= KEEP_P && 1 / ratio >= KEEP_RATIO };
}

/* ------------------------------------------------------------------ pairs */

/** One reel of a block as the post record and the numbers give it. */
export interface LabReel {
  pair: number;
  role: "trialA" | "trialB";
  levels: Level[];
  /** The day (local day index) it was approved for. */
  day: number;
  outcome: { kind: "scored"; score: number } | { kind: "pending" } | { kind: "broken" };
}

export interface LabPair {
  pair: number;
  /** The pattern of its arm A (-1 when the levels follow none). */
  pattern: number;
  state: "clean" | "pending" | "broken";
  a: Level[] | null;
  b: Level[] | null;
  /** s_B - s_A, for a clean pair. */
  d: number | null;
}

/**
 * The pairs of a block's reels: clean when both reels scored, broken when one is broken, when the two do not complement each
 * other, or when one reel is missing after its day ended (its card was never approved), pending otherwise.
 */
export function assemblePairs(reels: readonly LabReel[], k: number, today: number): LabPair[] {
  const byPair = new Map<number, LabReel[]>();
  for (const r of reels) byPair.set(r.pair, [...(byPair.get(r.pair) ?? []), r]);
  const pats = patternsOf(k).map((p) => p.join(""));
  const out: LabPair[] = [];
  for (const pair of [...byPair.keys()].sort((x, y) => x - y)) {
    const list = byPair.get(pair)!;
    const ra = list.find((r) => r.role === "trialA") ?? null;
    const rb = list.find((r) => r.role === "trialB") ?? null;
    const pattern = ra ? pats.indexOf(ra.levels.join("")) : rb ? pats.indexOf(complement(rb.levels).join("")) : -1;
    const base = { pair, pattern, a: ra?.levels ?? null, b: rb?.levels ?? null, d: null };
    const day = Math.min(...list.map((r) => r.day));
    if (list.some((r) => r.outcome.kind === "broken") || (ra && rb && ra.levels.some((l, j) => rb.levels[j] === l))) out.push({ ...base, state: "broken" });
    else if (!ra || !rb) out.push({ ...base, state: day < today ? "broken" : "pending" });
    else if (ra.outcome.kind === "scored" && rb.outcome.kind === "scored") out.push({ ...base, state: "clean", d: rb.outcome.score - ra.outcome.score });
    else out.push({ ...base, state: "pending" });
  }
  return out;
}

export interface LabStatus {
  clean: number;
  pending: number;
  broken: number;
  /** BLOCK_PAIRS clean pairs: the block reads now. */
  ready: boolean;
  /** BLOCK_MAX_DAYS passed without BLOCK_PAIRS clean pairs: it closes as "not enough clean pairs". */
  expired: boolean;
}

/** Where a block stands on day `today`, opened on day `openedDay`. */
export function labStatus(pairs: readonly LabPair[], openedDay: number, today: number): LabStatus {
  const clean = pairs.filter((p) => p.state === "clean").length;
  const pending = pairs.filter((p) => p.state === "pending").length;
  const ready = clean >= BLOCK_PAIRS;
  return { clean, pending, broken: pairs.length - clean - pending, ready, expired: !ready && today - openedDay >= BLOCK_MAX_DAYS };
}

/** The fit of a block's first BLOCK_PAIRS clean pairs (in pair order) and each dial's call. */
export function readBlock(pairs: readonly LabPair[], k: number): { fit: PairFit; calls: DialCall[] } {
  const clean = pairs.filter((p) => p.state === "clean" && p.a && p.b && p.d !== null).slice(0, BLOCK_PAIRS);
  const fit = fitPairs(
    clean.map((p) => ({ x: contrastOf(p.a!, p.b!), d: p.d! })),
    k,
  );
  return { fit, calls: fit.mean.map((m, j) => dialCall(m, fit.sd[j])) };
}

// --- end learner ---
