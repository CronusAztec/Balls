/**
 * --- smoke-sharding --- The summary of a sharded smoke run (the smoke-summary job of deploy.yml and smoke.yml):
 *
 *   node scripts/smoke/summary.mjs <folder>
 *
 * reads every smoke-timing.json (and the smoke-blocks.json next to it) under <folder> – the shards' artifacts, one sub-folder
 * each –, prints each shard's blocks, seconds and checks, the 15 slowest blocks of all of them, the blocks that had a failed
 * check, and whether every block of scripts/smoke-test.mjs ran in exactly one shard; writes the merged times as a ready
 * baseline (<folder>/smoke-timing.merged.json: copy it over scripts/smoke-timing.json to rebalance the split) and adds the
 * tables to the job's summary page. Exits 1 when a block ran in no shard or in more than one.
 */
import fs from "fs";
import path from "path";
import { BLOCKS_FILE, SUITE_FILE, TIMING_FILE, readBaseline } from "./blocks.mjs";
import { SLOWEST_COUNT, findBlockTitles, mergeTimings, refreshBaseline, round1, slowestLines } from "./shards.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/smoke/summary.mjs <folder with the shards' smoke-timing.json files>");
  process.exit(2);
}

/** Every smoke-timing.json under `root`, sorted. */
const timingFiles = (root) => {
  const found = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === TIMING_FILE) found.push(p);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return found.sort();
};
/** A JSON file's object ({} when it is missing or broken – said on stderr). */
const readJson = (file) => {
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (e) {
    console.error(`${file}: ${String(e).split("\n")[0]}`);
    return {};
  }
};

const sum = (values) => values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
const runs = timingFiles(dir).map((file) => {
  const timings = readJson(file);
  const blocks = readJson(path.join(path.dirname(file), BLOCKS_FILE));
  const checks = sum(Object.values(blocks).map((b) => b?.checks));
  const inconclusive = sum(Object.values(blocks).map((b) => b?.inconclusive));
  const failedBlocks = Object.entries(blocks).filter(([, b]) => b?.failed > 0);
  return { name: path.relative(dir, path.dirname(file)) || ".", timings, blocks, checks, inconclusive, failedBlocks };
});
const { merged, duplicates } = mergeTimings(runs.map((r) => r.timings));
const titles = findBlockTitles(fs.readFileSync(SUITE_FILE, "utf8"));
const blocks = [...new Set(titles)];
const missing = blocks.filter((t) => !Object.prototype.hasOwnProperty.call(merged, t));
const unknown = Object.keys(merged).filter((t) => !blocks.includes(t));
const checkCounts = Object.assign({}, ...runs.map((r) => Object.fromEntries(Object.entries(r.blocks).map(([t, b]) => [t, b?.checks]))));
const slowest = slowestLines(merged, checkCounts, SLOWEST_COUNT);
const failed = runs.flatMap((r) => r.failedBlocks.map(([t, b]) => `${t} (${r.name}: ${b.failed} of ${b.checks} checks failed)`));

const out = [`Smoke shards: ${runs.length} timing file${runs.length === 1 ? "" : "s"} under ${dir}`];
const inconclusiveNote = (n) => (n ? `, ${n} inconclusive` : "");
for (const r of runs) out.push(`  ${r.name}: ${Object.keys(r.timings).length} blocks, ${round1(sum(Object.values(r.timings))).toFixed(1)} s, ${r.checks} checks in them${inconclusiveNote(r.inconclusive)}`);
out.push(`  all shards: ${Object.keys(merged).length} blocks, ${sum(runs.map((r) => r.checks))} checks in them${inconclusiveNote(sum(runs.map((r) => r.inconclusive)))} (each shard also runs the final request and console checks)`);
out.push("", `The ${slowest.length} slowest blocks of all shards (wall time):`, ...slowest, "");
if (failed.length) out.push(`Blocks with a failed check: ${failed.join("; ")}`);
const complete = !missing.length && !duplicates.length;
out.push(`${blocks.length - missing.length} of ${blocks.length} blocks of ${path.basename(SUITE_FILE)} ran${complete ? ", each in one shard" : ""}.`);
if (missing.length) out.push(`Blocks that ran in no shard: ${missing.join(", ")}`);
if (duplicates.length) out.push(`Blocks that ran in more than one shard: ${duplicates.join(", ")}`);
if (unknown.length) out.push(`Timings of blocks the suite no longer has: ${unknown.join(", ")}`);
const mergedFile = path.join(dir, "smoke-timing.merged.json");
if (runs.length) {
  try {
    fs.writeFileSync(mergedFile, `${JSON.stringify(refreshBaseline(titles, readBaseline(), merged), null, 2)}\n`);
    out.push(`Wrote ${mergedFile}: these times as a baseline (copy it over scripts/smoke-timing.json to rebalance the shards).`);
  } catch (e) {
    out.push(`(could not write ${mergedFile}: ${String(e).split("\n")[0]})`);
  }
}
console.log(out.join("\n"));

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    "### Smoke shards",
    "",
    "| Shard | Blocks | Seconds | Checks |",
    "| --- | ---: | ---: | ---: |",
    ...runs.map((r) => `| ${r.name} | ${Object.keys(r.timings).length} | ${round1(sum(Object.values(r.timings))).toFixed(1)} | ${r.checks} |`),
    "",
    `${blocks.length - missing.length} of ${blocks.length} blocks ran${complete ? ", each in one shard" : ""}.${missing.length ? ` No shard ran: ${missing.join(", ")}.` : ""}${duplicates.length ? ` More than one shard ran: ${duplicates.join(", ")}.` : ""}${failed.length ? ` A check failed in: ${failed.join("; ")}.` : ""}`,
    "",
    `### The ${slowest.length} slowest blocks`,
    "",
    "| Seconds | Block | Checks |",
    "| ---: | --- | ---: |",
    ...Object.entries(merged)
      .sort(([ta, a], [tb, b]) => b - a || (ta < tb ? -1 : ta > tb ? 1 : 0))
      .slice(0, SLOWEST_COUNT)
      .map(([t, s]) => `| ${round1(s).toFixed(1)} | ${t} | ${Number.isFinite(checkCounts[t]) ? checkCounts[t] : ""} |`),
    "",
  ];
  try {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join("\n")}\n`);
  } catch {
    // the step summary is a convenience
  }
}
process.exit(complete ? 0 : 1);
