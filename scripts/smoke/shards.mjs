/**
 * --- smoke-sharding --- The partition of the browser smoke suite (scripts/smoke-test.mjs) into shards, as pure functions (no
 * Playwright, no files) so tests/smokeShards.test.ts can prove them.
 *
 * The unit is the block: every `await smokeBlock("title", async () => { … });` of the suite sets up its own page and state, so
 * any subset of blocks runs on its own. A shard is one of N parts of the suite: every block runs in exactly one of them and the
 * N parts together are the whole suite. The split comes from the block titles and their weights – the wall times of the last
 * full run in scripts/smoke-timing.json (title → seconds; a block the baseline does not know weighs the median) – by a greedy
 * longest-processing-time assignment: the blocks sorted by (weight desc, title) each go to the lightest shard so far (the lowest
 * index on a tie). No list of blocks is kept anywhere else: a new block gets a shard as soon as it is in the suite, and the split
 * is the same in every run for a given baseline and N.
 */

/** The number of shards of the CI matrix (deploy.yml, smoke.yml); `--list` without a shard shows this split. */
export const DEFAULT_SHARDS = 4;
/** How many of the slowest blocks a run prints at its end. */
export const SLOWEST_COUNT = 15;

/** Seconds rounded to tenths (the timing files' precision). @param {number} seconds */
export const round1 = (seconds) => Math.round(seconds * 10) / 10;

/**
 * "i/N" (1-based, 1 ≤ i ≤ N) → { index, total }; anything else throws.
 * @param {string | undefined} spec
 * @returns {{ index: number, total: number }}
 */
export function parseShardSpec(spec) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(spec ?? ""));
  const index = m ? Number(m[1]) : NaN;
  const total = m ? Number(m[2]) : NaN;
  if (!m || !(total >= 1) || !(index >= 1) || index > total) throw new Error(`smoke shard: expected i/N with 1 ≤ i ≤ N, got "${spec}"`);
  return { index, total };
}

/**
 * SMOKE_ONLY: comma-separated block titles, lower-cased (empty: no filter). A title may hold `*` for any run of characters
 * (`*watermark*`, `gerald-*`).
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function parseOnly(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** A SMOKE_ONLY pattern as an anchored regular expression (`*` → any characters, everything else literal). */
const onlyPattern = (pattern) => new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);

/**
 * Whether a block passes the SMOKE_ONLY patterns: its title is one of them (or matches one with `*`); no patterns: every
 * block. `SMOKE_ONLY=fight-league` runs the fight-league block and no other.
 * @param {string} title
 * @param {string[]} only
 * @returns {boolean}
 */
export function matchesOnly(title, only) {
  if (!only.length) return true;
  const t = title.toLowerCase();
  return only.some((pattern) => onlyPattern(pattern).test(t));
}

/**
 * The SMOKE_ONLY patterns that match none of the titles (a typo, or a block that is gone).
 * @param {string[]} titles
 * @param {string[]} only
 * @returns {string[]}
 */
export function unmatchedOnly(titles, only) {
  return only.filter((pattern) => !titles.some((t) => matchesOnly(t, [pattern])));
}

/**
 * The suite's options from its command line and environment: `--shard i/N` (or `--shard=i/N`; SMOKE_SHARD=i/N when no flag
 * is given – the flag wins), `--list`, `--write-timing` and SMOKE_ONLY. An unknown argument throws.
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ shard: { index: number, total: number } | null, list: boolean, writeTiming: boolean, only: string[] }}
 */
export function parseSmokeArgs(argv = [], env = {}) {
  let spec = null;
  let list = false;
  let writeTiming = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") list = true;
    else if (arg === "--write-timing") writeTiming = true;
    else if (arg === "--shard") {
      if (i + 1 >= argv.length) throw new Error("smoke shard: --shard needs i/N");
      spec = argv[++i];
    } else if (arg.startsWith("--shard=")) spec = arg.slice("--shard=".length);
    else throw new Error(`smoke: unknown argument "${arg}" (the flags are --shard i/N, --list and --write-timing)`);
  }
  if (spec === null && env.SMOKE_SHARD) spec = env.SMOKE_SHARD;
  return { shard: spec === null ? null : parseShardSpec(spec), list, writeTiming, only: parseOnly(env.SMOKE_ONLY) };
}

/**
 * The block titles of the suite's source in source order: one per `await smokeBlock("title", async () => {` line (the title a
 * plain double-quoted string). Duplicates are kept, so a caller can tell. tests/smokeShards.test.ts checks with a real parser
 * that these lines are all the blocks there are.
 * @param {string} source
 * @returns {string[]}
 */
export function findBlockTitles(source) {
  /** @type {string[]} */
  const titles = [];
  for (const m of String(source).matchAll(/^await smokeBlock\(\s*"((?:[^"\\\n]|\\.)*)"\s*,/gm)) titles.push(JSON.parse(`"${m[1]}"`));
  return titles;
}

/**
 * The titles that occur more than once (each once, in order).
 * @param {string[]} titles
 * @returns {string[]}
 */
export function duplicateTitles(titles) {
  const seen = new Set();
  const dupes = new Set();
  for (const t of titles) (seen.has(t) ? dupes : seen).add(t);
  return [...dupes];
}

/** A baseline entry: a finite, non-negative number of seconds (an own property of the baseline object). */
const known = (baseline, title) => Object.prototype.hasOwnProperty.call(baseline, title) && Number.isFinite(baseline[title]) && baseline[title] >= 0;

/**
 * The median of a list of numbers (the mean of the two middle ones for an even count; NaN for none).
 * @param {number[]} values
 * @returns {number}
 */
export function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The weight of every block: its seconds in the baseline, or – for a block the baseline does not know – the median weight of
 * the blocks it does know (of every baseline entry when it knows none of them; 1 s with an empty baseline).
 * @param {string[]} titles
 * @param {Record<string, number>} [baseline]
 * @returns {{ weights: Map<string, number>, median: number, missing: string[] }}
 */
export function blockWeights(titles, baseline = {}) {
  const unique = [...new Set(titles)];
  const knownValues = unique.filter((t) => known(baseline, t)).map((t) => baseline[t]);
  const allValues = Object.keys(baseline).filter((t) => known(baseline, t)).map((t) => baseline[t]);
  const mid = knownValues.length ? median(knownValues) : allValues.length ? median(allValues) : 1;
  const weights = new Map();
  const missing = [];
  for (const t of unique) {
    if (known(baseline, t)) weights.set(t, baseline[t]);
    else {
      weights.set(t, mid);
      missing.push(t);
    }
  }
  return { weights, median: mid, missing };
}

/** Code-unit order of two strings (no locale: the same on every machine). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The split of the blocks into `total` shards: greedy longest-processing-time over the blocks sorted by (weight desc, title),
 * each into the shard with the smallest load so far (the lowest index on a tie). The result does not depend on the order of
 * `titles`.
 * @param {string[]} titles
 * @param {Record<string, number>} [baseline]
 * @param {number} [total]
 * @returns {{ shardOf: Map<string, number>, loads: number[], weights: Map<string, number>, median: number, missing: string[] }}
 */
export function assignShards(titles, baseline = {}, total = DEFAULT_SHARDS) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`smoke shard: the number of shards must be a whole number ≥ 1, got ${total}`);
  const { weights, median: mid, missing } = blockWeights(titles, baseline);
  const order = [...weights.keys()].sort((a, b) => weights.get(b) - weights.get(a) || byCodeUnits(a, b));
  const loads = new Array(total).fill(0);
  const shardOf = new Map();
  for (const title of order) {
    let best = 0;
    for (let s = 1; s < total; s++) if (loads[s] < loads[best]) best = s;
    shardOf.set(title, best + 1);
    loads[best] += weights.get(title);
  }
  return { shardOf, loads, weights, median: mid, missing };
}

/**
 * The blocks of shard `index` of `total`, in suite order.
 * @param {string[]} titles
 * @param {Record<string, number>} baseline
 * @param {number} index
 * @param {number} total
 * @returns {string[]}
 */
export function shardTitles(titles, baseline, index, total) {
  const { shardOf } = assignShards(titles, baseline, total);
  return [...new Set(titles)].filter((t) => shardOf.get(t) === index);
}

/**
 * `--list`: one line per block in suite order – its shard, its weight and its title (a block without a baseline time says it
 * weighs the median).
 * @param {string[]} titles
 * @param {Record<string, number>} baseline
 * @param {number} [total]
 * @returns {string[]}
 */
export function formatList(titles, baseline, total = DEFAULT_SHARDS) {
  const { shardOf, weights, missing } = assignShards(titles, baseline, total);
  const width = String(total).length;
  return [...new Set(titles)].map(
    (t) => `${String(shardOf.get(t)).padStart(width)}/${total} ${weights.get(t).toFixed(1).padStart(7)} s  ${t}${missing.includes(t) ? "  (not in the baseline: the median)" : ""}`,
  );
}

/**
 * The per-shard totals of a split, for people (`--list` prints them on stderr).
 * @param {string[]} titles
 * @param {Record<string, number>} baseline
 * @param {number} [total]
 * @returns {string[]}
 */
export function formatLoads(titles, baseline, total = DEFAULT_SHARDS) {
  const { shardOf, loads } = assignShards(titles, baseline, total);
  const counts = new Array(total).fill(0);
  for (const s of shardOf.values()) counts[s - 1]++;
  const mean = loads.reduce((a, b) => a + b, 0) / total;
  const max = Math.max(...loads);
  return [
    ...loads.map((load, i) => `shard ${i + 1}/${total}: ${counts[i]} blocks, ${load.toFixed(1)} s`),
    `max ${max.toFixed(1)} s = ${mean > 0 ? (max / mean).toFixed(2) : "1.00"} × the mean ${mean.toFixed(1)} s`,
  ];
}

/**
 * The `count` slowest blocks of `timings` (title → seconds) as table lines, slowest first (ties by title); `checks` (title →
 * number of checks) adds the check counts.
 * @param {Record<string, number>} timings
 * @param {Record<string, number> | null} [checks]
 * @param {number} [count]
 * @returns {string[]}
 */
export function slowestLines(timings, checks = null, count = SLOWEST_COUNT) {
  return Object.entries(timings)
    .sort(([ta, a], [tb, b]) => b - a || byCodeUnits(ta, tb))
    .slice(0, count)
    .map(([t, s]) => {
      const n = checks?.[t];
      return `  ${round1(s).toFixed(1).padStart(7)} s  ${t}${Number.isFinite(n) ? ` (${n} check${n === 1 ? "" : "s"})` : ""}`;
    });
}

/**
 * Several runs' timings merged (the shards of one CI run): title → seconds, the longest if a title is in more than one of them
 * – `duplicates` lists those (a block that ran in two shards).
 * @param {Array<Record<string, number>>} list
 * @returns {{ merged: Record<string, number>, duplicates: string[] }}
 */
export function mergeTimings(list) {
  /** @type {Record<string, number>} */
  const merged = {};
  /** @type {string[]} */
  const duplicates = [];
  for (const timings of list) {
    for (const [t, s] of Object.entries(timings ?? {})) {
      if (!Number.isFinite(s)) continue;
      if (Object.prototype.hasOwnProperty.call(merged, t)) {
        if (!duplicates.includes(t)) duplicates.push(t);
        merged[t] = Math.max(merged[t], s);
      } else merged[t] = s;
    }
  }
  return { merged, duplicates };
}

/**
 * The baseline after a run: in suite order, every block's new time where the run measured it and its old one otherwise; titles
 * no longer in the suite are dropped (blocks never measured stay out and weigh the median).
 * @param {string[]} titles
 * @param {Record<string, number>} [baseline]
 * @param {Record<string, number>} [timings]
 * @returns {Record<string, number>}
 */
export function refreshBaseline(titles, baseline = {}, timings = {}) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const t of new Set(titles)) {
    if (Object.prototype.hasOwnProperty.call(timings, t) && Number.isFinite(timings[t])) out[t] = round1(timings[t]);
    else if (known(baseline, t)) out[t] = baseline[t];
  }
  return out;
}
