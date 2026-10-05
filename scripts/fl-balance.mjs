#!/usr/bin/env node
/**
 * --- fl-overhaul --- (Stage 2) The Fight League balance tuner's driver (Node, no dependency beyond the repo's own vitest).
 *
 *   node scripts/fl-balance.mjs                     tune every division, print the patch and the README table
 *   node scripts/fl-balance.mjs --apply             … and write the damage patch into the rows and the ratings file
 *   node scripts/fl-balance.mjs --divisions=dc,tv   only these divisions (the others' last reports are merged when present)
 *   node scripts/fl-balance.mjs --reuse --apply     skip the runs: merge the reports already in scripts/out/fl-balance/
 *   --jobs=N (parallel children, default min(4, CPUs)), --max-it=N (iterations, default 18), --arenas=square,circle
 *
 * One child per division: `npx vitest run tests/tools/flBalanceTune.test.ts` with FL_TUNE=1 FL_TUNE_DIVISIONS=<division> (the
 * tool test is skipped without FL_TUNE, which CI never sets). Each child tunes its division's damage stats on the 16 train
 * seeds and writes scripts/out/fl-balance/<division>.json (see the test file for the update rule); this parent merges them,
 * prints the patch, the README table and the pinned fighters, and with --apply rewrites `damage:` inside the matching
 * `id: "<id>"` row of src/lib/physics/modes/fightLeagueRows/<division>.ts and writes src/lib/physics/modes/fightLeagueRatings.ts
 * (FL_STRENGTH: every fighter's test-seed win % and Bradley–Terry strength, with the roster fingerprint the tests compare).
 * A run from an already tuned roster converges at iteration 0, so its patch is already applied.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "scripts", "out", "fl-balance");
const MODES_DIR = path.join(ROOT, "src", "lib", "physics", "modes");
const ROWS_DIR = path.join(MODES_DIR, "fightLeagueRows");
const ROSTER_FILE = path.join(MODES_DIR, "fightLeagueRoster.ts");
const RATINGS_FILE = path.join(MODES_DIR, "fightLeagueRatings.ts");
const TUNER = "tests/tools/flBalanceTune.test.ts";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
if (flag("help") || flag("h")) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*\n/, "").replace(/^ \* ?/gm, ""));
  process.exit(0);
}
const APPLY = flag("apply");
const REUSE = flag("reuse");
const JOBS = Math.max(1, Number(option("jobs") ?? Math.min(4, os.cpus().length)) || 1);

/** The division ids in FL_DIVISIONS order, read from the roster index (this script cannot import TypeScript). */
function rosterDivisions() {
  const src = fs.readFileSync(ROSTER_FILE, "utf8");
  const m = /export const FL_DIVISIONS = \[([^\]]*)\]/.exec(src);
  if (!m) throw new Error("FL_DIVISIONS not found in fightLeagueRoster.ts");
  return [...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]);
}

const ALL = rosterDivisions();
const TUNABLE = ALL.filter((d) => d !== "wildcard");
const wanted = (option("divisions") ?? "").split(",").map((d) => d.trim()).filter(Boolean);
for (const d of wanted) {
  if (!TUNABLE.includes(d)) {
    console.error(`unknown or untunable division "${d}" (one of: ${TUNABLE.join(", ")})`);
    process.exit(2);
  }
}
const RUN = wanted.length > 0 ? wanted : TUNABLE;

const rowsFile = (division) => path.join(ROWS_DIR, `${division}.ts`);
const reportFile = (division) => path.join(OUT_DIR, `${division}.json`);
const fighterCount = (division) => (fs.readFileSync(rowsFile(division), "utf8").match(/^\s+id: "/gm) ?? []).length;

/** FNV-1a, exactly as flHash() in fightLeagueRoster.ts. */
function flHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function runChild(division) {
  return new Promise((resolve) => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const log = fs.createWriteStream(path.join(OUT_DIR, `${division}.log`));
    const env = { ...process.env, FL_TUNE: "1", FL_TUNE_DIVISIONS: division };
    if (option("max-it")) env.FL_TUNE_MAX_IT = option("max-it");
    if (option("arenas")) env.FL_TUNE_ARENAS = option("arenas");
    const started = Date.now();
    const child = spawn("npx", ["vitest", "run", TUNER, "--reporter=dot"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on("close", (code) => {
      log.end();
      const seconds = Math.round((Date.now() - started) / 1000);
      // The report is the result (it is deleted before the child starts); a non-zero exit with a report is only a warning.
      const wrote = fs.existsSync(reportFile(division));
      const status = wrote ? (code === 0 ? "done" : `done (exit ${code}: see scripts/out/fl-balance/${division}.log)`) : `FAILED (exit ${code}, no report: see scripts/out/fl-balance/${division}.log)`;
      console.log(`  ${division}: ${status} in ${seconds} s`);
      resolve(wrote);
    });
  });
}

async function runAll(divisions) {
  // The biggest round robins first, so the last child to start is a short one.
  const queue = [...divisions].sort((a, b) => fighterCount(b) - fighterCount(a));
  console.log(`Tuning ${queue.length} division(s) with ${Math.min(JOBS, queue.length)} parallel child(ren): ${queue.join(", ")}`);
  let ok = true;
  const worker = async () => {
    for (let d = queue.shift(); d !== undefined; d = queue.shift()) {
      fs.rmSync(reportFile(d), { force: true });
      ok = (await runChild(d)) && ok;
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, worker));
  return ok;
}

function readReports() {
  const reports = new Map();
  for (const d of TUNABLE) {
    if (!fs.existsSync(reportFile(d))) continue;
    reports.set(d, JSON.parse(fs.readFileSync(reportFile(d), "utf8")));
  }
  return reports;
}

/** Rewrites `damage:` inside the `stats: S(…)` of the `id: "<id>"` row; returns the new source (unchanged when already equal). */
function patchRow(src, id, damage) {
  const at = src.indexOf(`id: "${id}",`);
  if (at < 0) throw new Error(`row ${id} not found`);
  const next = src.indexOf(`id: "`, at + 5);
  const end = next < 0 ? src.length : next;
  const s = src.indexOf("stats: S(", at);
  if (s < 0 || s > end) throw new Error(`row ${id}: no stats: S(…)`);
  const open = s + "stats: S(".length;
  let depth = 1;
  let close = open;
  while (depth > 0) {
    const c = src[close++];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (close > end) throw new Error(`row ${id}: unbalanced stats`);
  }
  const inner = src.slice(open, close - 1).trim();
  const value = String(damage);
  let body;
  if (inner === "" || /^\{\s*\}$/.test(inner)) {
    if (damage === 1) return src;
    body = `{ damage: ${value} }`;
  } else if (/\bdamage:\s*[-0-9.e]+/.test(inner)) {
    body = inner.replace(/\bdamage:\s*[-0-9.e]+/, `damage: ${value}`);
  } else {
    if (damage === 1) return src;
    body = inner.replace(/\s*\}$/, `, damage: ${value} }`);
  }
  return src.slice(0, open) + body + src.slice(close - 1);
}

const fmtPct = (x) => `${(100 * x).toFixed(1)} %`;

function ratingsSource(reports) {
  const hashes = {};
  for (const d of ALL) {
    const own = reports.get(d)?.hashes?.[d];
    const any = [...reports.values()].find((r) => r.hashes?.[d])?.hashes?.[d];
    hashes[d] = own ?? any ?? "00000000";
  }
  const rosterHash = flHash(ALL.map((d) => hashes[d]).join(","));
  const lines = [];
  lines.push("/**");
  lines.push(" * --- fl-overhaul --- GENERATED by `node scripts/fl-balance.mjs --apply` (Stage 2's balance tuner) – do not edit by hand.");
  lines.push(" *");
  lines.push(" * FL_STRENGTH: every tuned fighter's win share on the balance test's seeds (both arenas, a draw half, in %) and its");
  lines.push(" * Bradley–Terry strength from the same duels, normalised to a geometric mean of 1 within its division (2 = twice the odds");
  lines.push(" * of an average division mate). FL_RATINGS_HASH is flRosterHash() of the roster the numbers were measured on; the tests");
  lines.push(" * warn (without failing) when the roster has changed since – re-run the tuner then.");
  lines.push(" */");
  lines.push("");
  lines.push("export interface FlRating {");
  lines.push("  /** Win share on the balance test's seeds, in %. */");
  lines.push("  win: number;");
  lines.push("  /** Bradley–Terry strength, geometric mean 1 per division. */");
  lines.push("  strength: number;");
  lines.push("}");
  lines.push("");
  lines.push(`export const FL_RATINGS_HASH = "${rosterHash}";`);
  lines.push("");
  lines.push("/** The division fingerprints (flDivisionHash) the ratings were measured on. */");
  lines.push("export const FL_RATINGS_DIVISION_HASHES: Readonly<Record<string, string>> = {");
  for (const d of ALL) lines.push(`  ${d}: "${hashes[d]}",`);
  lines.push("};");
  lines.push("");
  lines.push("export const FL_STRENGTH: Readonly<Record<string, FlRating>> = {");
  for (const d of ALL) {
    const r = reports.get(d);
    if (!r) continue;
    lines.push(`  // ${d}`);
    for (const id of Object.keys(r.patch)) {
      const win = Math.round(1000 * r.testWin[id]) / 10;
      lines.push(`  ${id}: { win: ${win}, strength: ${r.strength[id]} },`);
    }
  }
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  if (!REUSE) {
    const ok = await runAll(RUN);
    if (!ok) console.error("Some children failed; their divisions keep their last report (if any).");
  }
  const reports = readReports();
  if (reports.size === 0) {
    console.error("No reports in scripts/out/fl-balance/ – run without --reuse first.");
    process.exit(1);
  }
  let changed = 0;
  const patchLines = [];
  const table = ["| Division | Fighters | Iterations | Damage range | Test win % (min–max) | Median TTK square / circle | At the cap | Pinned |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  const pinnedAll = [];
  for (const d of TUNABLE) {
    const r = reports.get(d);
    if (!r) continue;
    const ids = Object.keys(r.patch);
    const wins = ids.map((id) => r.testWin[id]);
    const dmg = ids.map((id) => r.patch[id]);
    const cap = Math.max(r.testCap.square ?? 0, r.testCap.circle ?? 0);
    table.push(`| ${d} | ${ids.length} | ${r.iterations} | ${Math.min(...dmg)}–${Math.max(...dmg)} | ${(100 * Math.min(...wins)).toFixed(0)}–${(100 * Math.max(...wins)).toFixed(0)} | ${r.testTtk.square} s / ${r.testTtk.circle} s | ${fmtPct(cap)} | ${r.pinned.length ? r.pinned.join(", ") : "–"} |`);
    for (const id of r.pinned) pinnedAll.push(`${d}/${id}`);
    patchLines.push(`${d} (${r.iterations} iterations, train TTK ${r.trainTtk} s, ${r.seconds} s):`);
    const src = fs.readFileSync(rowsFile(d), "utf8");
    let out = src;
    for (const id of ids) {
      const before = r.before[id];
      const after = r.patch[id];
      out = patchRow(out, id, after);
      const mark = before === after ? " " : "*";
      patchLines.push(`  ${mark} ${id.padEnd(14)} damage ${String(before).padStart(4)} -> ${String(after).padStart(4)}   train ${fmtPct(r.train[id]).padStart(7)}   test ${fmtPct(r.testWin[id]).padStart(7)}   strength ${r.strength[id]}`);
    }
    changed += ids.filter((id) => patchRow(src, id, r.patch[id]) !== src).length;
    if (APPLY && out !== src) fs.writeFileSync(rowsFile(d), out);
  }
  console.log("\nPatch (* = a changed damage stat):");
  console.log(patchLines.join("\n"));
  console.log("\nREADME table:\n");
  console.log(table.join("\n"));
  console.log(`\nPinned (a damage at a clamp or a train win share outside 40–60 %): ${pinnedAll.length ? pinnedAll.join(", ") : "none"}`);
  console.log(changed === 0 ? "\nThe patch is already applied: every damage stat in the rows equals the tuner's." : `\n${changed} row(s) differ from the tuner's damage stat${APPLY ? " – rewritten" : " (run with --apply to write them)"}.`);
  if (APPLY) {
    fs.writeFileSync(RATINGS_FILE, ratingsSource(reports));
    console.log(`Wrote ${path.relative(ROOT, RATINGS_FILE)}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
