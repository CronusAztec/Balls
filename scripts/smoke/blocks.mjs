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
 *  - SMOKE_ONLY=word[,word…]: only the blocks whose title contains one of the words (inside the shard, with a shard);
 *  - `--list`: prints every block with its shard (N from --shard, 4 – the CI matrix – without) and exits before a browser starts;
 *  - `--write-timing`: refreshes scripts/smoke-timing.json with the wall times this run measured.
 * Every run writes OUT_DIR/smoke-timing.json (title → seconds of the blocks it ran, after each block, so a run that dies keeps
 * what it measured) and prints its 15 slowest blocks before the final count. The checks' own lines are unchanged.
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
  formatLoads,
  matchesOnly,
  parseSmokeArgs,
  refreshBaseline,
  round1,
  slowestLines,
} from "./shards.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The suite whose blocks are split. */
export const SUITE_FILE = path.join(HERE, "..", "smoke-test.mjs");
/** The checked-in wall times of the blocks (title → seconds) the split is balanced by. */
export const BASELINE_FILE = path.join(HERE, "..", "smoke-timing.json");
/** The name of the timing file every run writes into its OUT_DIR. */
export const TIMING_FILE = "smoke-timing.json";

/** The baseline file as title → seconds ({} when it is missing). */
export function readBaseline(file = BASELINE_FILE) {
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file}: expected an object of block title → seconds`);
  return data;
}

/**
 * The runner. `checks()` is the number of checks recorded so far (the suite's results.length) and `outDir()` the run's output
 * folder; both are read only once blocks run.
 */
export function createSmokeBlocks({ checks, outDir, argv = process.argv.slice(2), env = process.env, suiteFile = SUITE_FILE, baselineFile = BASELINE_FILE, log = console.log }) {
  const opts = parseSmokeArgs(argv, env);
  const titles = findBlockTitles(fs.readFileSync(suiteFile, "utf8"));
  const dupes = duplicateTitles(titles);
  const baseline = readBaseline(baselineFile);
  const total = opts.shard?.total ?? DEFAULT_SHARDS;
  const plan = assignShards(titles, baseline, total);
  const sharded = opts.shard !== null;
  const filtered = opts.only.length > 0;
  const relBaseline = path.relative(process.cwd(), baselineFile) || baselineFile;

  if ((sharded || opts.list) && dupes.length) throw new Error(`smoke: block titles must be unique; repeated: ${dupes.join(", ")}`);
  if (filtered && !titles.some((t) => matchesOnly(t, opts.only))) throw new Error(`smoke: SMOKE_ONLY=${env.SMOKE_ONLY} matches no block (the blocks: ${titles.join(", ")})`);

  /** Whether a block runs in this run. */
  const selected = (title) => {
    if (sharded) {
      const shard = plan.shardOf.get(title);
      if (shard === undefined) throw new Error(`smoke: block "${title}" is not a plain \`await smokeBlock("title", async () => {\` line of ${path.basename(suiteFile)}, so no shard owns it`);
      if (shard !== opts.shard.index) return false;
    }
    return matchesOnly(title, opts.only);
  };
  const planned = [...new Set(titles)].filter((t) => (!sharded || plan.shardOf.get(t) === opts.shard.index) && matchesOnly(t, opts.only));

  if ((sharded || filtered) && !opts.list) {
    const what = [sharded ? `shard ${opts.shard.index}/${opts.shard.total}` : "", filtered ? `SMOKE_ONLY=${env.SMOKE_ONLY}` : ""].filter(Boolean).join(", ");
    const weight = planned.reduce((sum, t) => sum + plan.weights.get(t), 0);
    log(`Smoke ${what}: ${planned.length} of ${new Set(titles).size} blocks, about ${Math.round(weight)} s by ${relBaseline}: ${planned.join(", ")}`);
  }

  const timings = new Map();
  const blockChecks = new Map();
  const ran = [];
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
  const timingFile = () => path.join(outDir(), TIMING_FILE);
  const timingObject = () => Object.fromEntries([...timings].map(([t, s]) => [t, round1(s)]));
  const writeTiming = () => {
    try {
      fs.writeFileSync(timingFile(), `${JSON.stringify(timingObject(), null, 2)}\n`);
    } catch (e) {
      log(`(smoke: could not write ${timingFile()}: ${String(e).split("\n")[0]})`);
    }
  };

  /** One block of the suite: runs `fn` when this run includes `title`, and times it. */
  const block = async (title, fn) => {
    if (current !== null) throw new Error(`smoke: block "${title}" starts inside block "${current}"`);
    if (ended) throw new Error(`smoke: block "${title}" comes after smoke.endBlocks(); put it above that line`);
    noteOutside();
    if (!selected(title)) return;
    const start = performance.now();
    const before = checks();
    current = title;
    try {
      await fn();
    } finally {
      current = null;
      timings.set(title, (timings.get(title) ?? 0) + (performance.now() - start) / 1000);
      blockChecks.set(title, (blockChecks.get(title) ?? 0) + checks() - before);
      if (!ran.includes(title)) ran.push(title);
      seen = checks();
      writeTiming();
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
    writeTiming();
    const lines = [""];
    const measured = timingObject();
    if (ran.length) {
      lines.push(`The ${Math.min(SLOWEST_COUNT, ran.length)} slowest blocks of this run (wall time; all ${ran.length} in ${timingFile()}):`);
      lines.push(...slowestLines(measured, Object.fromEntries(blockChecks), SLOWEST_COUNT));
    } else lines.push("No block ran in this run.");
    if (sharded || filtered) {
      const seconds = ran.reduce((sum, t) => sum + timings.get(t), 0);
      const blockCheckCount = ran.reduce((sum, t) => sum + blockChecks.get(t), 0);
      const what = [sharded ? `Shard ${opts.shard.index}/${opts.shard.total}` : "", filtered ? `SMOKE_ONLY=${env.SMOKE_ONLY}` : ""].filter(Boolean).join(", ");
      lines.push(`${what}: ${ran.length} of ${new Set(titles).size} blocks in ${round1(seconds).toFixed(1)} s, ${blockCheckCount} checks in them (+${checks() - blockCheckCount - outside} after the blocks); the other blocks ${sharded && !filtered ? "run in the other shards" : "were left out"}.`);
      const missed = planned.filter((t) => !ran.includes(t));
      if (missed.length) lines.push(`Note: ${missed.length} block${missed.length === 1 ? "" : "s"} of this run never started: ${missed.join(", ")}`);
    }
    if (outside) lines.push(`Note: ${outside} check${outside === 1 ? "" : "s"} ran outside any smokeBlock(…) – such code runs in every shard; put it in a block (README "Smoke test shards").`);
    if (opts.writeTiming) {
      const next = refreshBaseline(titles, baseline, measured);
      fs.writeFileSync(baselineFile, `${JSON.stringify(next, null, 2)}\n`);
      lines.push(`Wrote ${relBaseline}: ${Object.keys(next).length} blocks, ${ran.length} measured in this run.`);
    }
    for (const line of lines) log(line);
  };

  /**
   * `--list`: every block with its shard and weight on stdout, the shards' totals on stderr (written synchronously: the suite
   * exits right after); returns the exit code.
   */
  const printList = () => {
    fs.writeSync(1, `${formatList(titles, baseline, total).join("\n")}\n`);
    fs.writeSync(2, `${formatLoads(titles, baseline, total).join("\n")}\n`);
    return 0;
  };

  return { block, endBlocks, report, printList, listing: opts.list, options: opts, titles, plan };
}
