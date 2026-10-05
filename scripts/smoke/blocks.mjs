/**
 * --- smoke-sharding --- The block runner of the browser smoke suite (scripts/smoke-test.mjs). The suite is a list of blocks,
 *
 *   await smokeBlock("feature-key", async () => {
 *   // --- feature-key --- what the block checks
 *   …its checks, starting with its own page.goto() / browser.newContext()…
 *   });
 *
 * (the body is left unindented, so a block's diff stays the lines it changes) and this runner decides which of them run:
 *  - no flag: every block, in order – the suite exactly as before;
 *  - `--shard i/N` (or SMOKE_SHARD=i/N): only the blocks of shard i of N (shards.mjs: balanced by the wall times of
 *    scripts/smoke-timing.json, the same split in every run; each block runs in exactly one shard);
 *  - SMOKE_ONLY=title[,title…] (`*` for any characters): only those blocks (inside the shard, with a shard);
 *  - `--list`: prints every block with its shard and weight (N from --shard, 4 – the CI matrix – without) and nothing else, and
 *    exits before a browser starts;
 *  - `--write-timing`: refreshes scripts/smoke-timing.json with the wall times this run measured.
 * A narrowed run (a shard, SMOKE_ONLY) calls `isolate()` before every block but its first: the block that comes before it in
 * the full suite may not be in this run, so nothing a block leaves behind (its page, the browser storage, a permission) may
 * reach the next one. Every run writes OUT_DIR/smoke-timing.json (title → seconds of the blocks it ran) and
 * OUT_DIR/smoke-blocks.json (title → shard, seconds, checks, failed and inconclusive checks) after each block, so a run that
 * dies keeps what it measured, and prints its 15 slowest blocks before the final count. The checks' own lines are unchanged.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_SHARDS,
  SLOWEST_COUNT,
  assignShards,
  duplicateTitles,
  findBlockTitles,
  formatList,
  matchesOnly,
  parseSmokeArgs,
  refreshBaseline,
  round1,
  slowestLines,
  unmatchedOnly,
} from "./shards.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The suite whose blocks are split. */
export const SUITE_FILE = path.join(HERE, "..", "smoke-test.mjs");
/** The checked-in wall times of the blocks (title → seconds) the split is balanced by. */
export const BASELINE_FILE = path.join(HERE, "..", "smoke-timing.json");
/** The name of the timing file every run writes into its OUT_DIR (title → seconds). */
export const TIMING_FILE = "smoke-timing.json";
/** The name of the per-block report every run writes into its OUT_DIR (title → { shard, seconds, checks, failed }). */
export const BLOCKS_FILE = "smoke-blocks.json";

/** The baseline file as title → seconds ({} when it is missing). */
export function readBaseline(file = BASELINE_FILE) {
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file}: expected an object of block title → seconds`);
  return data;
}

/**
 * The runner. `checks()` is the number of checks recorded so far (the suite's results.length), `failures()` the number of
 * them that failed, `inconclusive()` the number of timing checks reported inconclusive (not counted as checks), `outDir()` the
 * run's output folder and `isolate()` the clean-up a narrowed run makes between two blocks; all of them are called only once
 * blocks run.
 * @param {{
 *   checks: () => number,
 *   failures?: () => number,
 *   inconclusive?: () => number,
 *   outDir: () => string,
 *   isolate?: () => Promise<void>,
 *   argv?: string[],
 *   env?: Record<string, string | undefined>,
 *   suiteFile?: string,
 *   baselineFile?: string,
 *   log?: (line: string) => void,
 * }} options
 */
export function createSmokeBlocks({
  checks,
  failures = () => 0,
  inconclusive = () => 0,
  outDir,
  isolate = async () => {},
  argv = process.argv.slice(2),
  env = process.env,
  suiteFile = SUITE_FILE,
  baselineFile = BASELINE_FILE,
  log = console.log,
}) {
  const opts = parseSmokeArgs(argv, env);
  const titles = findBlockTitles(fs.readFileSync(suiteFile, "utf8"));
  const unique = [...new Set(titles)];
  const dupes = duplicateTitles(titles);
  const baseline = readBaseline(baselineFile);
  const total = opts.shard?.total ?? DEFAULT_SHARDS;
  const plan = assignShards(titles, baseline, total);
  const sharded = opts.shard !== null;
  const filtered = opts.only.length > 0;
  const narrowed = sharded || filtered;
  const relBaseline = path.relative(process.cwd(), baselineFile) || baselineFile;

  if ((sharded || opts.list) && dupes.length) throw new Error(`smoke: block titles must be unique; repeated: ${dupes.join(", ")}`);
  const unmatched = unmatchedOnly(unique, opts.only);
  if (unmatched.length) throw new Error(`smoke: SMOKE_ONLY=${env.SMOKE_ONLY}: no block is called ${unmatched.join(", ")} (the blocks: ${unique.join(", ")})`);

  /** Whether a block runs in this run. */
  const selected = (title) => {
    if (sharded) {
      const shard = plan.shardOf.get(title);
      if (shard === undefined) throw new Error(`smoke: block "${title}" is not a plain \`await smokeBlock("title", async () => {\` line of ${path.basename(suiteFile)}, so no shard owns it`);
      if (shard !== opts.shard.index) return false;
    }
    return matchesOnly(title, opts.only);
  };
  const planned = unique.filter((t) => (!sharded || plan.shardOf.get(t) === opts.shard.index) && matchesOnly(t, opts.only));
  const what = [sharded ? `shard ${opts.shard.index}/${opts.shard.total}` : "", filtered ? `SMOKE_ONLY=${env.SMOKE_ONLY}` : ""].filter(Boolean).join(", ");

  if (narrowed && !opts.list) {
    const weight = planned.reduce((sum, t) => sum + plan.weights.get(t), 0);
    log(`Smoke ${what}: ${planned.length} of ${unique.length} blocks, about ${Math.round(weight)} s by ${relBaseline}: ${planned.join(", ")}`);
  }

  /** @type {Map<string, { seconds: number, checks: number, failed: number, inconclusive: number }>} */
  const ran = new Map();
  let outside = 0;
  let seen = null;
  let current = null;
  let ended = false;

  /** Checks recorded since the last block ended (outside any block: they run in every shard). */
  const noteOutside = () => {
    const now = checks();
    if (seen !== null && now > seen) outside += now - seen;
    seen = now;
  };
  const outFile = (name) => path.join(outDir(), name);
  const timingObject = () => Object.fromEntries([...ran].map(([t, r]) => [t, round1(r.seconds)]));
  const blocksObject = () =>
    Object.fromEntries(
      [...ran].map(([t, r]) => [t, { shard: sharded ? `${opts.shard.index}/${opts.shard.total}` : null, seconds: round1(r.seconds), checks: r.checks, failed: r.failed, inconclusive: r.inconclusive }]),
    );
  const writeFiles = () => {
    for (const [name, data] of [
      [TIMING_FILE, timingObject()],
      [BLOCKS_FILE, blocksObject()],
    ]) {
      try {
        fs.writeFileSync(outFile(name), `${JSON.stringify(data, null, 2)}\n`);
      } catch (e) {
        log(`(smoke: could not write ${outFile(name)}: ${String(e).split("\n")[0]})`);
      }
    }
  };

  /** One block of the suite: runs `fn` when this run includes `title`, and times it. */
  const block = async (title, fn) => {
    if (current !== null) throw new Error(`smoke: block "${title}" starts inside block "${current}"`);
    if (ended) throw new Error(`smoke: block "${title}" comes after smoke.endBlocks(); put it above that line`);
    noteOutside();
    if (!selected(title)) return;
    if (narrowed && ran.size) await isolate();
    const start = performance.now();
    const before = { checks: checks(), failed: failures(), inconclusive: inconclusive() };
    current = title;
    try {
      await fn();
    } finally {
      current = null;
      const r = ran.get(title) ?? { seconds: 0, checks: 0, failed: 0, inconclusive: 0 };
      r.seconds += (performance.now() - start) / 1000;
      r.checks += checks() - before.checks;
      r.failed += failures() - before.failed;
      r.inconclusive += inconclusive() - before.inconclusive;
      ran.set(title, r);
      seen = checks();
      writeFiles();
    }
  };

  /** The end of the blocks: what follows is the report every run makes (shards included). */
  const endBlocks = () => {
    if (ended) return;
    noteOutside();
    ended = true;
  };

  /** The 15 slowest blocks of this run, what a shard or filter ran, and `--write-timing`; printed before the final count. */
  const report = () => {
    endBlocks();
    writeFiles();
    const lines = [""];
    const measured = timingObject();
    if (ran.size) {
      lines.push(`The ${Math.min(SLOWEST_COUNT, ran.size)} slowest blocks of this run (wall time; all ${ran.size} in ${outFile(TIMING_FILE)}):`);
      lines.push(...slowestLines(measured, Object.fromEntries([...ran].map(([t, r]) => [t, r.checks])), SLOWEST_COUNT));
    } else lines.push("No block ran in this run.");
    if (narrowed) {
      const seconds = [...ran.values()].reduce((sum, r) => sum + r.seconds, 0);
      const blockChecks = [...ran.values()].reduce((sum, r) => sum + r.checks, 0);
      const label = what.charAt(0).toUpperCase() + what.slice(1);
      lines.push(`${label}: ${ran.size} of ${unique.length} blocks in ${round1(seconds).toFixed(1)} s, ${blockChecks} checks in them (+${checks() - blockChecks - outside} after the blocks); the other blocks ${sharded && !filtered ? "run in the other shards" : "were left out"}.`);
      const missed = planned.filter((t) => !ran.has(t));
      if (missed.length) lines.push(`Note: ${missed.length} block${missed.length === 1 ? "" : "s"} of this run never started: ${missed.join(", ")}`);
    }
    if (outside) lines.push(`Note: ${outside} check${outside === 1 ? "" : "s"} ran outside any smokeBlock(…) – such code runs in every shard; put it in a block (README "Smoke test shards").`);
    if (opts.writeTiming) {
      const next = refreshBaseline(titles, baseline, measured);
      fs.writeFileSync(baselineFile, `${JSON.stringify(next, null, 2)}\n`);
      lines.push(`Wrote ${relBaseline}: ${Object.keys(next).length} blocks, ${ran.size} measured in this run.`);
    }
    for (const line of lines) log(line);
  };

  /**
   * `--list`: every block with its shard and weight, one line each and nothing else (written synchronously: the suite exits
   * right after); returns the exit code.
   */
  const printList = () => {
    fs.writeSync(1, `${formatList(titles, baseline, total).join("\n")}\n`);
    return 0;
  };

  return { block, endBlocks, report, printList, listing: opts.list, narrowed, options: opts, titles, plan };
}
