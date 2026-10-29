import { describe, expect, it } from "vitest";
import {
  FOLD_PATTERNS,
  aFirst,
  armOf,
  armsOfPattern,
  assemblePairs,
  complement,
  contrastOf,
  dialCall,
  fitPairs,
  invert,
  labStatus,
  levelsOf,
  nextPatterns,
  patternsOf,
  readBlock,
  type LabReel,
  type Level,
} from "@/lib/insights/lab";
import { BLOCK_MAX_DAYS, BLOCK_PAIRS, KEEP_P, KEEP_RATIO, SCORE_CLIP } from "@/lib/insights/learnerRules";
import { seededDraws } from "@/lib/insights/stats";

/*
 * --- learner --- The Trial Reel lab (lib/insights/lab.ts): fold-over patterns, the closed-form fit of the pair differences
 * (pinned against sim/merged.py's numbers), pairs and their states, and seeded worlds that pin how often the lab keeps a
 * change of a given true size (the plan: 2x at least 60 %, no difference at most 18 %, 0.67x at most 4 %).
 */

// --- learner ---

/** A seeded standard normal (Box-Muller over seededDraws). */
function normals(seed: number) {
  const u = seededDraws(seed);
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

/** One block of 8 pairs in the toy world (spread `sigma`, a shared day effect of 30 %, 1 % 30x hits, clipped at ln 10). */
function blockWorld(effects: readonly number[], sigma: number, seed: number): boolean[] {
  const k = effects.length;
  const z = normals(seed);
  const u = seededDraws(seed ^ 0x5bd1e995);
  const clip = (y: number) => Math.max(-SCORE_CLIP, Math.min(SCORE_CLIP, y));
  const hit = () => (u() < 0.01 ? Math.log(30) : 0);
  const pairs: { x: number[]; d: number }[] = [];
  for (let i = 0; i < BLOCK_PAIRS; i++) {
    let { a, b } = armsOfPattern(k, i);
    if (u() < 0.5) [a, b] = [b, a];
    const day = z() * sigma * Math.sqrt(0.3);
    const s = (levels: Level[]) => clip(day + levels.reduce<number>((t, l, j) => t + l * effects[j], 0) + z() * sigma * Math.sqrt(0.7) + hit());
    const sa = s(a);
    const sb = s(b);
    pairs.push({ x: contrastOf(a, b), d: sb - sa });
  }
  const fit = fitPairs(pairs, k);
  return fit.mean.map((m, j) => dialCall(m, fit.sd[j]).keep);
}

function keptShare(k: number, lift: number, worlds: number, sigma = 1.0, seed = 20261029): { first: number; nulls: number } {
  let first = 0;
  let nulls = 0;
  for (let w = 0; w < worlds; w++) {
    const kept = blockWorld([Math.log(lift), ...new Array(k - 1).fill(0)], sigma, seed + w * 7919);
    if (kept[0]) first++;
    if (k > 1 && kept[1]) nulls++;
  }
  return { first, nulls };
}

describe("fold-over patterns", () => {
  it("arm B is arm A's complement: every pair differs in every dial of its block", () => {
    for (const k of [1, 2, 3]) {
      for (let i = 0; i < patternsOf(k).length; i++) {
        const { a, b } = armsOfPattern(k, i);
        expect(a.every((l, j) => b[j] !== l)).toBe(true);
        expect(contrastOf(a, b).every((x) => x === 1 || x === -1)).toBe(true);
      }
    }
    expect(FOLD_PATTERNS[3].map((p) => p.join(""))).toEqual(["000", "011", "101", "110"]);
    expect(FOLD_PATTERNS[2].map((p) => p.join(""))).toEqual(["00", "01"]);
    expect(() => patternsOf(4)).toThrow();
  });

  it("over 8 pairs each dial gets 8 contrasts, orthogonal to the others; three dials' are balanced too", () => {
    for (const k of [2, 3]) {
      const used: { pattern: number; state: "clean" }[] = [];
      for (const p of nextPatterns([], k, BLOCK_PAIRS)) used.push({ pattern: p, state: "clean" });
      const xs = used.map((u) => {
        const { a, b } = armsOfPattern(k, u.pattern);
        return contrastOf(a, b);
      });
      for (let j = 0; j < k; j++) expect(xs.every((x) => Math.abs(x[j]) === 1), `${k} dials, dial ${j}`).toBe(true);
      // three dials: +1 and -1 four times each; two dials: the second dial so, the first always +1 (arm A is its best: the
      // coin that orders the pair keeps that from meeting a first-reel advantage)
      for (let j = k === 3 ? 0 : 1; j < k; j++) expect(xs.reduce((s, x) => s + x[j], 0), `${k} dials, dial ${j}`).toBe(0);
      // the dials' contrasts are orthogonal, so each effect is read on its own
      for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) expect(xs.reduce((s, x) => s + x[i] * x[j], 0)).toBe(0);
    }
  });

  it("a broken pair is made again with its own pattern, so the balance holds", () => {
    const used = [
      { pattern: 0, state: "clean" as const },
      { pattern: 1, state: "broken" as const },
      { pattern: 2, state: "clean" as const },
      { pattern: 3, state: "pending" as const },
    ];
    expect(nextPatterns(used, 3, 1)).toEqual([1]);
    expect(nextPatterns(used, 3, 3)).toEqual([1, 0, 1]);
  });

  it("the order inside a pair is a seeded coin, about half and half, the same every time", () => {
    const firsts = Array.from({ length: 400 }, (_, i) => aFirst("t0.length.standard.short", "2026-11-02", i));
    expect(firsts).toEqual(Array.from({ length: 400 }, (_, i) => aFirst("t0.length.standard.short", "2026-11-02", i)));
    const share = firsts.filter(Boolean).length / firsts.length;
    expect(share).toBeGreaterThan(0.43);
    expect(share).toBeLessThan(0.57);
  });

  it("a reel's arm is stored as its levels", () => {
    expect(armOf([0, 1, 1])).toBe("011");
    expect(levelsOf("011", 3)).toEqual([0, 1, 1]);
    expect(levelsOf("011", 2)).toBeNull();
    expect(levelsOf("0a1", 3)).toBeNull();
    expect(complement([0, 1])).toEqual([1, 0]);
  });
});

describe("the fit", () => {
  it("inverts small matrices", () => {
    const m = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    const inv = invert(m);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(m[i].reduce((s, x, t) => s + x * inv[t][j], 0)).toBeCloseTo(i === j ? 1 : 0, 12);
    expect(() =>
      invert([
        [1, 2],
        [2, 4],
      ]),
    ).toThrow();
  });

  it("matches sim/merged.py's fit (two dials, three dials, fewer pairs than dials)", () => {
    const two = fitPairs(
      [0.9, 0.1, 1.2, -0.3, 0.5, 0.4, 1.1, 0.0].map((d, i) => ({ x: i % 2 === 0 ? [1, 1] : [1, -1], d })),
      2,
    );
    expect(two.mean[0]).toBeCloseTo(0.35264863235626553, 10);
    expect(two.mean[1]).toBeCloseTo(0.316479541858187, 10);
    expect(two.sd[0]).toBeCloseTo(0.26297252234712165, 10);
    expect(two.noiseSd).toBeCloseTo(0.8745236798776044, 10);
    const X3 = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ];
    const three = fitPairs(
      [0.8, -0.2, 0.3, 0.1, 1.4, 0.6, -0.5, 0.2].map((d, i) => ({ x: X3[i % 4], d })),
      3,
    );
    expect(three.mean.map((m) => Number(m.toFixed(10)))).toEqual([0.2123470136, 0.1104204471, 0.1953592525]);
    expect(three.sd[2]).toBeCloseTo(0.283058985190271, 10);
    expect(three.noiseSd).toBeCloseTo(0.9712339854769574, 10);
    const one = fitPairs([{ x: [1, 1], d: 0.7 }], 2);
    expect(one.mean[0]).toBeCloseTo(0.08656224237427865, 10);
    expect(one.sd[0]).toBeCloseTo(0.4680650739349793, 10);
    expect(one.noiseSd).toBeCloseTo(1.2335585379975555, 10);
  });

  it("keeps a change at 80 % certainty and 1.25x, and says when the best is clearly better", () => {
    const sd = 0.2;
    expect(dialCall(Math.log(1.3), sd)).toMatchObject({ keep: true, bestBetter: false });
    expect(dialCall(Math.log(1.2), sd).keep).toBe(false); // certain enough, too small
    expect(dialCall(Math.log(1.3), 1).keep).toBe(false); // big enough, too unsure
    expect(dialCall(0.8416212335729143 * sd + 1e-9, sd).p).toBeGreaterThanOrEqual(KEEP_P);
    expect(dialCall(-Math.log(1.3), sd)).toMatchObject({ keep: false, bestBetter: true, bestClearlyBetter: true });
    expect(dialCall(-Math.log(1.1), 0.05)).toMatchObject({ bestBetter: true, bestClearlyBetter: false });
    expect(dialCall(Math.log(KEEP_RATIO), 0.01).ratio).toBeCloseTo(KEEP_RATIO, 12);
  });
});

describe("pairs", () => {
  const reel = (pair: number, role: "trialA" | "trialB", levels: Level[], outcome: LabReel["outcome"], day = 10): LabReel => ({ pair, role, levels, day, outcome });

  it("clean when both reels scored, pending while one waits, broken when one is broken or the arms do not complement", () => {
    const pairs = assemblePairs(
      [
        reel(1, "trialA", [0, 0], { kind: "scored", score: 0.1 }),
        reel(1, "trialB", [1, 1], { kind: "scored", score: 0.6 }),
        reel(2, "trialA", [0, 1], { kind: "scored", score: 0 }),
        reel(2, "trialB", [1, 0], { kind: "pending" }),
        reel(3, "trialA", [0, 0], { kind: "broken" }),
        reel(3, "trialB", [1, 1], { kind: "scored", score: 1 }),
        reel(4, "trialA", [0, 1], { kind: "scored", score: 0 }),
        reel(4, "trialB", [1, 1], { kind: "scored", score: 1 }),
      ],
      2,
      10,
    );
    expect(pairs.map((p) => [p.pair, p.pattern, p.state])).toEqual([
      [1, 0, "clean"],
      [2, 1, "pending"],
      [3, 0, "broken"],
      [4, 1, "broken"],
    ]);
    expect(pairs[0].d).toBeCloseTo(0.5, 12);
  });

  it("a reel whose sibling was never approved breaks its pair once its day is over", () => {
    expect(assemblePairs([reel(5, "trialA", [0, 0], { kind: "pending" }, 10)], 2, 10)[0].state).toBe("pending");
    expect(assemblePairs([reel(5, "trialA", [0, 0], { kind: "pending" }, 10)], 2, 11)[0].state).toBe("broken");
    expect(assemblePairs([reel(6, "trialB", [1, 0], { kind: "pending" }, 10)], 2, 10)[0].pattern).toBe(1);
  });

  it("reads after 8 clean pairs, and closes as not enough clean pairs after 21 days", () => {
    const clean = Array.from({ length: BLOCK_PAIRS }, (_, i) => ({ pair: i, pattern: i % 2, state: "clean" as const, a: armsOfPattern(2, i).a, b: armsOfPattern(2, i).b, d: 0.5 }));
    expect(labStatus(clean.slice(0, 7), 0, 5)).toMatchObject({ clean: 7, ready: false, expired: false });
    expect(labStatus(clean, 0, 5)).toMatchObject({ clean: 8, ready: true, expired: false });
    expect(labStatus(clean.slice(0, 7), 0, BLOCK_MAX_DAYS)).toMatchObject({ ready: false, expired: true });
    expect(labStatus(clean.slice(0, 7), 0, BLOCK_MAX_DAYS - 1).expired).toBe(false);
    // every clean pair of a block's first 8, read in pair order
    const { calls } = readBlock([...clean, { ...clean[0], pair: 99, d: -9 }], 2);
    expect(calls[0].keep).toBe(true); // a steady 0.5 in both dials' direction: the first dial is the one that differs every time
  });
});

describe("seeded worlds: how often the lab keeps a change", () => {
  const W = 1500;
  // Pinned: the same seeds give the same worlds. sim/l0.py (no misses) printed 2x 0.69, 1.5x 0.45, 1.0 0.14, 0.67x 0.03 for
  // two dials and 0.67, 0.42, 0.14, 0.03 for three; these worlds agree within their noise.
  it("two dials (block 1: the Journey and the length), spread 1.0", () => {
    const shares = [2, 1.5, 1, 0.67].map((lift) => keptShare(2, lift, W));
    expect(shares.map((s) => s.first)).toEqual([1063, 682, 239, 43]);
    expect(shares.map((s) => s.nulls)).toEqual([224, 222, 222, 223]); // the second dial truly does nothing
    const [twice, , none, worse] = shares.map((s) => s.first / W);
    expect(twice).toBeGreaterThanOrEqual(0.6);
    expect(none).toBeLessThanOrEqual(0.18);
    expect(worse).toBeLessThanOrEqual(0.04);
    for (const s of shares) expect(s.nulls / W).toBeLessThanOrEqual(0.18);
  });

  it("three dials, spread 1.0", () => {
    const shares = [2, 1.5, 1, 0.67].map((lift) => keptShare(3, lift, W));
    expect(shares.map((s) => s.first)).toEqual([1034, 657, 203, 26]);
    const [twice, , none, worse] = shares.map((s) => s.first / W);
    expect(twice).toBeGreaterThanOrEqual(0.6);
    expect(none).toBeLessThanOrEqual(0.18);
    expect(worse).toBeLessThanOrEqual(0.04);
    for (const s of shares) expect(s.nulls / W).toBeLessThanOrEqual(0.18);
  });
});

// --- end learner ---
