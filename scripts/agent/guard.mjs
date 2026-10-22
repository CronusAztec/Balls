#!/usr/bin/env node
/**
 * --- ai-guard --- The core guard: one command that says whether a change kept the core functions working.
 *
 *   npm run guard                      tier 0: the three lanes below at once, no build (under 3 min cold, about 1 min warm)
 *   npm run guard:browser              tier 1: tier 0, then a /smoke build, the export served and the core smoke blocks
 *   npm run guard -- --baseline        tier 0 on the untouched tree: records the failures that already exist
 *   npm run guard -- --plan            what would run and the static checks' findings, nothing executed (with --json: the report)
 *   options: --base <ref> (default: the merge base with origin/main), --with-slow (the slow tests a change pulls in),
 *            --json (print the report instead of the summary), --port <n> (tier 1's server, default 3101), --help
 *
 * Lane A: the incremental type check. Lane B: ESLint (cached), `node --check` on the scripts, the desktop app's and the
 * billing Worker's type checks and tests. Lane C: one vitest run of the core list (scripts/agent/core.json) and the tests
 * related to the changed files (minus the slow ones, capped), the changelog check and the smoke suite's --list. Before them, the static
 * checks: the fingerprint lock (Fingerprint-Change trailer), the protected-path report (owner review, a warning) and the
 * test-weakening detector (Test-Change trailer). The plan is src/lib/agentKit/guardPlan.ts and protectedDiff.ts (pure,
 * unit-tested), bundled here with esbuild.
 *
 * Read-only toward the source: it writes only its cache (node_modules/.cache/jbl-guard, or .agent-out/cache/jbl-guard when
 * node_modules is a link into another checkout; JBL_GUARD_CACHE overrides) and .agent-out/guard-report.json; tier 1 also
 * writes the build output (.next/, out/). It never updates snapshots, fingerprints or the smoke timing baseline.
 * Exit codes: 0 green, 1 failed, 2 green but a higher tier is required (the report's `required` says what to run).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const started = Date.now();

/* ------------------------------------------------------------------------------------------------ arguments */

export function parseArgs(argv) {
  const opts = { browser: false, baseline: false, plan: false, json: false, withSlow: false, base: null, port: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--browser") opts.browser = true;
    else if (a === "--baseline") opts.baseline = true;
    else if (a === "--plan") opts.plan = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--with-slow") opts.withSlow = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--base" || a === "--port") {
      if (i + 1 >= argv.length) throw new Error(`guard: ${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--base=")) opts.base = a.slice(7);
    else if (a.startsWith("--port=")) opts.port = a.slice(7);
    else throw new Error(`guard: unknown argument "${a}" (--browser, --baseline, --plan, --json, --with-slow, --base <ref>, --port <n>, --help)`);
  }
  if (opts.port !== null && !/^\d+$/.test(String(opts.port))) throw new Error("guard: --port needs a number");
  return opts;
}

/* ------------------------------------------------------------------------------------------------ the cache and the plan code */

/** The cache folder: JBL_GUARD_CACHE, else node_modules/.cache/jbl-guard when node_modules is this checkout's own folder. */
export function cacheDirFor(root, env = process.env) {
  if (env.JBL_GUARD_CACHE) return path.resolve(root, env.JBL_GUARD_CACHE);
  const nm = path.join(root, "node_modules");
  let own = false;
  try {
    own = fs.lstatSync(nm).isDirectory();
  } catch {
    own = false;
  }
  // a worktree whose node_modules links to another checkout keeps its caches to itself (the type-check state is per tree)
  return own ? path.join(nm, ".cache", "jbl-guard") : path.join(root, ".agent-out", "cache", "jbl-guard");
}

async function loadKit(cacheDir) {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    throw new Error("guard: esbuild is not installed – run `npm ci` (it is a dev dependency).");
  }
  const outfile = path.join(cacheDir, "agentKit.mjs");
  await esbuild.build({
    stdin: { contents: 'export * from "./src/lib/agentKit/guardPlan.ts";\nexport * from "./src/lib/agentKit/protectedDiff.ts";\n', resolveDir: ROOT, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    alias: { "@": path.join(ROOT, "src") },
    logLevel: "error",
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

/* ------------------------------------------------------------------------------------------------ git */

const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, ...opts });
const tryGit = (args) => {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
};

/** The base ref and commit the change is measured against, the head commit, and whether the tree has uncommitted changes. */
function gitState(requested) {
  const head = tryGit(["rev-parse", "HEAD"]);
  if (!head) throw new Error("guard: not a git checkout (git rev-parse HEAD failed)");
  const candidates = requested ? [requested] : [process.env.JBL_GUARD_BASE, "origin/main", "main", "origin/claude/optimistic-johnson-46x3qg"].filter(Boolean);
  let base = null;
  for (const ref of candidates) {
    const commit = tryGit(["merge-base", "HEAD", ref]);
    if (commit) {
      base = { ref, commit };
      break;
    }
    if (requested) throw new Error(`guard: --base ${requested}: no merge base with HEAD`);
  }
  const note = base ? null : "no base ref found (origin/main, main): the change is measured against HEAD";
  if (!base) base = { ref: "HEAD", commit: head };
  const dirty = (tryGit(["status", "--porcelain", "--untracked-files=no"]) ?? "") !== "";
  return { head, base, dirty, note };
}

/** The changed paths: tracked files that differ from the base commit (the working tree, staged or not) plus untracked ones. */
function changedFiles(baseCommit) {
  const tracked = (tryGit(["diff", "--name-only", "--no-renames", baseCommit]) ?? "").split("\n");
  const untracked = (tryGit(["ls-files", "--others", "--exclude-standard"]) ?? "").split("\n");
  return [...new Set([...tracked, ...untracked].map((s) => s.trim()).filter(Boolean))]
    .filter((f) => !/(^|\/)node_modules(\/|$)/.test(f)) // a linked install (a worktree) is not a change
    .sort();
}

function commitMessages(baseCommit) {
  const log = tryGit(["log", "--format=%B%x1e", `${baseCommit}..HEAD`]) ?? "";
  return log.split("\x1e").map((s) => s.trim()).filter(Boolean);
}

function versions(baseCommit, files) {
  const out = new Map();
  for (const file of files) {
    let base = null;
    try {
      base = git(["show", `${baseCommit}:${file}`]);
    } catch {
      base = null;
    }
    let head = null;
    try {
      head = fs.readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      head = null;
    }
    out.set(file, { base, head });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ the tree */

/** Folders never walked: installs and build or run output (by name anywhere, or by path). */
const SKIP_NAMES = new Set(["node_modules", ".git", ".next"]);
const SKIP_PATHS = new Set(["out", ".agent-out", "smoke-output", "bot-output", "graphify-out", ".wrangler", "relay-data", "scripts/out", "desktop/dist", "desktop/release", "relay/relay-data", "relay/deploy/data", "billing/.wrangler"]);

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const child = dir ? `${dir}/${e.name}` : e.name;
    if (SKIP_NAMES.has(e.name) || SKIP_PATHS.has(child)) continue;
    if (e.isDirectory()) walk(child, out);
    else if (e.isFile()) out.push(child);
  }
  return out;
}

const SOURCE_EXT = [".ts", ".tsx", ".mjs", ".js", ".cjs", ".json"];

function resolveImport(from, spec, exists) {
  let target;
  if (spec.startsWith("@/")) target = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  const tries = [target, ...SOURCE_EXT.map((e) => target + e), ...["/index.ts", "/index.tsx", "/index.js", "/index.mjs"].map((e) => target + e)];
  // a TypeScript file imported as ".js" (ESM style)
  if (/\.js$/.test(target)) tries.push(target.replace(/\.js$/, ".ts"), target.replace(/\.js$/, ".tsx"));
  return tries.find((t) => exists.has(t)) ?? null;
}

const IMPORT_RES = [/\b(?:import|export)\s[^;'"`]*?\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g, /\brequire\(\s*["']([^"']+)["']\s*\)/g, /\bvi\.mock\(\s*["']([^"']+)["']/g];
const PATH_LITERAL = /["'`]((?:src|scripts|messages|docs|public|deploy|desktop|billing|relay|worker|\.github)\/[\w./@-]+\.\w+|README\.md|CHANGELOG\.md|package\.json)["'`]/g;

/** file → the repository files it imports (and, for a test, the files it names as paths: the source-pinning tests read them). */
function importGraph(files) {
  const exists = new Set(files);
  const graph = {};
  for (const file of files) {
    if (!/\.(ts|tsx|mjs|js|cjs)$/.test(file) || !(file.startsWith("src/") || file.startsWith("tests/") || file.startsWith("scripts/") || file.startsWith("relay/") || file.startsWith("worker/"))) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    const deps = new Set();
    for (const re of IMPORT_RES) for (const m of text.matchAll(re)) {
      const target = resolveImport(file, m[1], exists);
      if (target) deps.add(target);
    }
    if (file.startsWith("tests/")) for (const m of text.matchAll(PATH_LITERAL)) if (exists.has(m[1])) deps.add(m[1]);
    graph[file] = [...deps];
  }
  return graph;
}

function modeIds() {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/physics/types.ts"), "utf8");
  return [...(/export const MODE_IDS = \[([\s\S]*?)\] as const/.exec(src)?.[1] ?? "").matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
}

/* ------------------------------------------------------------------------------------------------ running a step */

const children = new Set();
const killAll = () => {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* gone */
    }
  }
};
process.on("SIGINT", () => {
  killAll();
  process.exit(130);
});

function run(argv, { cwd, env, log }) {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd === "node" ? process.execPath : cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: "0", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    let stdout = "";
    let stderr = "";
    const out = log ? fs.createWriteStream(log, { flags: "a" }) : null;
    child.stdout.on("data", (d) => {
      stdout += d;
      out?.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      out?.write(d);
    });
    child.on("error", (err) => {
      children.delete(child);
      out?.end();
      resolve({ code: 127, stdout, stderr: `${stderr}${err.message}\n` });
    });
    child.on("close", (code) => {
      children.delete(child);
      out?.end();
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;
const tailOf = (text, n = 30) => text.replace(ANSI, "").trimEnd().split("\n").slice(-n);

function tscSignatures(output, cwd) {
  const sigs = new Set();
  for (const m of output.replace(ANSI, "").matchAll(/^(.+?)\(\d+,\d+\): error (TS\d+): (.+)$/gm)) sigs.add(`tsc ${rel(path.resolve(cwd, m[1].trim()))}: ${m[2]} ${m[3].trim()}`);
  return [...sigs];
}

function eslintSignatures(stdout) {
  try {
    const results = JSON.parse(stdout);
    const sigs = new Set();
    for (const r of results) for (const m of r.messages ?? []) if (m.severity === 2) sigs.add(`eslint ${rel(r.filePath)}: ${m.ruleId ?? m.message}`);
    return [...sigs];
  } catch {
    return null;
  }
}

function vitestSignatures(jsonFile, cwd) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } catch {
    return null;
  }
  const sigs = new Set();
  const ran = new Set();
  for (const file of data.testResults ?? []) {
    const name = rel(path.resolve(cwd, file.name));
    ran.add(name);
    const failed = (file.assertionResults ?? []).filter((a) => a.status === "failed");
    for (const a of failed) sigs.add(`vitest ${name} > ${a.fullName ?? a.title}`);
    if (file.status === "failed" && !failed.length) sigs.add(`vitest ${name}: ${String(file.message ?? "failed").split("\n")[0].slice(0, 200)}`);
  }
  return { sigs: [...sigs], ran, success: data.success !== false, total: data.numTotalTests ?? 0 };
}

let onlyWorkerTimeout = () => false;

async function runStep(step, ctx) {
  const t0 = Date.now();
  const cwd = path.join(ROOT, step.cwd || "");
  const log = path.join(ctx.logDir, `${step.id}.log`);
  fs.writeFileSync(log, `$ (cd ${step.cwd || "."} && ${step.argv.join(" ")})\n`);
  const result = { id: step.id, title: step.title, lane: ctx.lane, status: "passed", seconds: 0, signatures: [], log: rel(log) };
  const done = (failed, signatures, extra = {}) => {
    const verdict = ctx.kit.againstBaseline(failed, signatures, ctx.baseline?.signatures?.[step.id]);
    Object.assign(result, { status: verdict.status, signatures, ...(verdict.preExisting.length ? { preExisting: verdict.preExisting } : {}), seconds: (Date.now() - t0) / 1000, ...extra });
    ctx.onStep?.(result);
    return result;
  };
  if (step.requires && !fs.existsSync(path.join(ROOT, step.requires.path))) {
    return done(true, [`${step.id}: ${step.requires.path} is missing`], { note: `${step.requires.path} is missing – run ${step.requires.fix}` });
  }
  if (step.parser === "node-check") {
    const bad = [];
    const tails = [];
    for (const file of step.files ?? []) {
      const r = await run(["node", "--check", file], { cwd, log });
      if (r.code !== 0) {
        bad.push(`node-check ${file}`);
        tails.push(...tailOf(r.stderr, 8));
      }
    }
    return done(bad.length > 0, bad, bad.length ? { tail: tails.slice(-30) } : {});
  }
  if (step.jsonReport) fs.rmSync(path.resolve(ROOT, step.jsonReport), { force: true });
  const r = await run(step.argv, { cwd, env: step.env, log });
  const output = `${r.stdout}\n${r.stderr}`;
  const failed = r.code !== 0;
  if (step.parser === "tsc") {
    const sigs = tscSignatures(output, cwd);
    return done(failed, failed ? (sigs.length ? sigs : [`${step.id}: exit ${r.code}`]) : [], failed ? { tail: tailOf(output) } : {});
  }
  if (step.parser === "eslint") {
    const sigs = eslintSignatures(r.stdout);
    return done(failed, failed ? (sigs?.length ? sigs : [`${step.id}: exit ${r.code}`]) : [], failed ? { tail: sigs?.length ? sigs.slice(0, 30) : tailOf(output) } : {});
  }
  if (step.parser === "vitest") {
    const parsed = vitestSignatures(path.resolve(ROOT, step.jsonReport), cwd);
    const sigs = parsed?.sigs ?? [];
    // every file asked for ran (a renamed or deleted core test is a failure, not a smaller run)
    const asked = step.argv.slice(step.argv.findIndex((a) => a.startsWith("--outputFile.json=")) + 1);
    const missing = parsed ? asked.filter((f) => !parsed.ran.has(f)) : [];
    for (const f of missing) sigs.push(`vitest ${f}: did not run (missing or renamed?)`);
    if (failed && !sigs.length && onlyWorkerTimeout(output)) return done(false, [], { note: 'every test passed; the only error was vitest\'s "Timeout calling onTaskUpdate" (a busy machine)' });
    const bad = failed || missing.length > 0;
    return done(bad, bad ? (sigs.length ? sigs : [`${step.id}: exit ${r.code}`]) : [], bad ? { tail: tailOf(output, 40) } : { note: parsed ? `${parsed.total} tests` : undefined });
  }
  return done(failed, failed ? [`${step.id}: exit ${r.code}`] : [], failed ? { tail: tailOf(output) } : {});
}

/* ------------------------------------------------------------------------------------------------ tier 1's server */

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function pickPort(wanted) {
  for (let p = wanted; p < wanted + 50; p++) if (await portFree(p)) return p;
  throw new Error(`guard: no free port from ${wanted} to ${wanted + 49}`);
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/* ------------------------------------------------------------------------------------------------ output */

function printSummary(report) {
  const lines = [];
  const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));
  lines.push(`JBL core guard · tier ${report.tier} · base ${report.base.ref} (${report.base.commit.slice(0, 7)}) · ${report.changed.count} changed file${report.changed.count === 1 ? "" : "s"}`);
  for (const lane of report.lanes) {
    const bad = lane.steps.filter((s) => s.status === "failed").length;
    const pre = lane.steps.filter((s) => s.status === "pre-existing").length;
    lines.push(`  ${pad(lane.id, 3)}${pad(lane.title, 48)}${bad ? "FAIL" : "ok  "} ${lane.seconds.toFixed(1)} s${pre ? ` (${pre} pre-existing)` : ""}`);
    for (const s of lane.steps) if (s.status !== "passed") lines.push(`       ${s.status === "failed" ? "x" : "-"} ${s.title}: ${s.status}${s.note ? ` – ${s.note}` : ""} (${s.log ?? ""})`);
  }
  const f = report.fingerprints;
  const w = report.weakening;
  lines.push(`  static: fingerprints ${f.violations ? `FAIL (${f.violations})` : "ok"} · weakening ${w.violations ? `FAIL (${w.violations})` : "ok"} · protected: ${report.protected.findings.length ? `${report.protected.findings.length} for owner review` : "none"}`);
  for (const c of f.changes.filter((x) => !x.acknowledged)) lines.push(`       x fingerprint ${c.kind}: ${c.mode} in ${c.file} (${c.where}) – needs a commit trailer "Fingerprint-Change: ${c.mode} - <reason>" and owner review`);
  for (const c of f.changes.filter((x) => x.acknowledged && x.kind !== "added")) lines.push(`       - fingerprint ${c.kind}: ${c.mode} (${c.file}) – acknowledged: ${c.reasons.join("; ")}`);
  for (const x of w.findings) lines.push(`       ${x.acknowledged ? "-" : "x"} ${x.kind}: ${x.file} – ${x.detail}${x.acknowledged ? ` (acknowledged: ${x.reasons.join("; ")})` : x.kind === "only-added" ? " (remove the .only)" : ` – needs "Test-Change: ${x.file} - <reason>" and owner review`}`);
  for (const p of report.protected.findings) lines.push(`       ! owner review required: ${p.path} (${p.rule}) – ${p.why}${p.keys ? `: ${p.keys.slice(0, 6).join(", ")}${p.keys.length > 6 ? ", …" : ""}` : ""}`);
  if (report.failures.length) {
    lines.push("Failures:");
    for (const fl of report.failures.slice(0, 12)) {
      lines.push(`  [${fl.lane} ${fl.step}] ${fl.signatures.slice(0, 5).join(" | ")}${fl.signatures.length > 5 ? ` (+${fl.signatures.length - 5})` : ""}`);
      for (const t of (fl.tail ?? []).slice(-8)) lines.push(`      ${t}`);
    }
  }
  if (report.escalation.items.length) {
    lines.push("Escalation:");
    for (const i of report.escalation.items) lines.push(`  tier ${i.tier} ${i.id}: ${i.reason}${i.smoke.length ? ` – smoke ${i.smoke.join(",")}` : ""}${i.tests.length ? ` – tests ${i.tests.length}` : ""}`);
  }
  if (report.required.length) {
    lines.push("Required beyond this run:");
    for (const c of report.required) lines.push(`  ${c}`);
  }
  if (report.notes.length) for (const n of report.notes) lines.push(`Note: ${n}`);
  lines.push(`${report.verdict.toUpperCase()} (exit ${report.exitCode}) in ${report.seconds.toFixed(1)} s · report ${report.reportFile}`);
  console.log(lines.join("\n"));
}

/** In GitHub Actions: the owner-review findings as warnings (annotations), the violations as errors. */
function annotate(report) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  for (const p of report.protected.findings) console.log(`::warning file=${p.path},title=Owner review required (${esc(p.rule)})::${esc(p.why)}`);
  for (const c of report.fingerprints.changes.filter((x) => !x.acknowledged)) console.log(`::error file=${c.file},title=Fingerprint ${c.kind} without a trailer::${esc(`${c.mode}: add "Fingerprint-Change: ${c.mode} - <reason>" to the commit`)}`);
  for (const x of report.weakening.findings.filter((y) => !y.acknowledged)) console.log(`::error file=${x.file},title=Test weakened (${x.kind})::${esc(x.detail)}`);
}

/* ------------------------------------------------------------------------------------------------ main */

/** The header comment above, as the --help text. */
const HELP = (/\/\*\*\n([\s\S]*?)\n \*\//.exec(fs.readFileSync(fileURLToPath(import.meta.url), "utf8"))?.[1] ?? "").replace(/^ \* ?/gm, "");

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) throw new Error("guard: node_modules is missing – run `npm ci` (and npm ci --prefix desktop with ELECTRON_SKIP_BINARY_DOWNLOAD=1, npm ci --prefix billing)");
  const cacheDir = cacheDirFor(ROOT);
  const logDir = path.join(cacheDir, "logs");
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.mkdirSync(logDir, { recursive: true });
  const kit = await loadKit(cacheDir);
  ({ onlyWorkerTimeout } = await import(pathToFileURL(path.join(ROOT, "scripts/test-ci.mjs")).href));
  const { findBlockTitles } = await import(pathToFileURL(path.join(ROOT, "scripts/smoke/shards.mjs")).href);

  const core = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/agent/core.json"), "utf8"));
  const prot = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/agent/protected.json"), "utf8"));
  const notes = [];
  const state = gitState(opts.base);
  if (state.note) notes.push(state.note);
  const changed = changedFiles(state.base.commit);
  const messages = commitMessages(state.base.commit);
  const tree = walk("");
  const testFiles = tree.filter((f) => /^tests\/.+\.test\.ts$/.test(f) || /^relay\/.+\.test\.mjs$/.test(f)).sort();
  const ids = modeIds();
  const blocks = findBlockTitles(fs.readFileSync(path.join(ROOT, "scripts/smoke-test.mjs"), "utf8"));

  // static checks
  const s0 = Date.now();
  const files = versions(state.base.commit, kit.filesToRead(prot, changed));
  const fpTrailers = kit.parseTrailers(messages, "Fingerprint-Change");
  const testTrailers = kit.parseTrailers(messages, "Test-Change");
  const fpChanges = kit.fingerprintChanges(prot.fingerprints, files, fpTrailers);
  const protectedFound = kit.protectedFindings(prot, changed, files);
  const weakening = kit.weakeningFindings(prot.weakening, changed, files, testTrailers);
  const statics = {
    fingerprintViolations: fpChanges.filter((c) => !c.acknowledged).length,
    weakeningViolations: weakening.filter((w) => !w.acknowledged).length,
    protectedFindings: protectedFound.length,
  };
  const staticSeconds = (Date.now() - s0) / 1000;

  // the plan
  const graph = importGraph(tree);
  const related = kit.relatedTests(changed, graph, testFiles);
  const escalation = kit.planEscalation({ changed, config: core, modeIds: ids, smokeBlocks: blocks, testFiles });
  const vitest = kit.planVitest({ config: core, related, escalated: escalation.tests.filter((f) => testFiles.includes(f)), withSlow: opts.withSlow });
  const nodeCheckFiles = tree.filter((f) => kit.matchesAny(f, core.nodeCheck)).sort();
  const lanes = kit.planTier0({ config: core, vitest, cacheDir, nodeCheckFiles }); // (absolute: the desktop and billing steps run in their own folders)
  const tier = opts.browser ? 1 : 0;
  const baselineFile = path.join(cacheDir, "baseline.json");
  let baseline = null;
  if (!opts.baseline && fs.existsSync(baselineFile)) {
    try {
      const b = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
      const ancestor = b.head === state.head || tryGit(["merge-base", "--is-ancestor", b.head, "HEAD"]) !== null;
      if (ancestor) baseline = b;
      else notes.push(`the baseline (${String(b.head).slice(0, 7)}) is not an ancestor of HEAD: ignored`);
    } catch {
      notes.push("the baseline file is unreadable: ignored");
    }
  }

  const laneResults = [];
  if (!opts.plan) {
    const ctxBase = { kit, logDir, baseline, onStep: opts.json ? null : (r) => process.stderr.write(`  ${r.lane} ${r.status === "passed" ? "ok  " : r.status === "failed" ? "FAIL" : r.status} ${r.title} (${r.seconds.toFixed(1)} s)\n`) };
    const runLane = async (lane) => {
      const t0 = Date.now();
      const steps = [];
      for (const step of lane.steps) steps.push(await runStep(step, { ...ctxBase, lane: lane.id }));
      return { id: lane.id, title: lane.title, seconds: (Date.now() - t0) / 1000, steps };
    };
    if (!opts.json) process.stderr.write(`guard: tier ${tier}, ${changed.length} changed files, ${vitest.core.length} core + ${vitest.related.length} related test files, cache ${rel(cacheDir)}\n`);
    laneResults.push(...(await Promise.all(lanes.map(runLane))));
    if (opts.browser) {
      const laneA = laneResults.find((l) => l.id === "A");
      const smoke = kit.tier1SmokeBlocks(core, escalation, blocks);
      const port = await pickPort(opts.port ? Number(opts.port) : core.browser.port);
      const t1 = kit.planTier1({ config: core, smoke, port, outDir: rel(path.join(cacheDir, "smoke-output")) });
      const t0 = Date.now();
      const steps = [];
      if (laneA.steps.some((s) => s.status === "failed")) {
        steps.push({ id: "next-build", title: "build skipped: lane A (the type check) failed", lane: "T1", status: "skipped", seconds: 0, signatures: [] });
      } else {
        const ctx = { ...ctxBase, lane: "T1" };
        const [build, postexport, smokeStep] = t1.steps;
        steps.push(await runStep(build, ctx));
        if (steps[0].status === "passed") steps.push(await runStep(postexport, ctx));
        if (steps.every((s) => s.status === "passed")) {
          const server = spawn(process.execPath, ["scripts/serve-static.mjs", "--port", String(port), "--base", core.browser.basePath, "--host", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
          children.add(server);
          let up = false;
          for (let i = 0; i < 60 && !up; i++) {
            up = await httpOk(`http://127.0.0.1:${port}${core.browser.basePath}/en/`);
            if (!up) await new Promise((r) => setTimeout(r, 500));
          }
          if (up) steps.push(await runStep(smokeStep, ctx));
          else steps.push({ id: "serve", title: "serve-static did not answer", lane: "T1", status: "failed", seconds: 30, signatures: ["serve: no answer"] });
          server.kill("SIGTERM");
          children.delete(server);
        }
      }
      laneResults.push({ id: "T1", title: t1.title, seconds: (Date.now() - t0) / 1000, steps });
    }
  }

  const allSteps = laneResults.flatMap((l) => l.steps);
  const code = opts.plan ? (statics.fingerprintViolations || statics.weakeningViolations ? 1 : 0) : kit.exitCode({ steps: allSteps, statics, escalation, tier, vitest, baselineRun: opts.baseline });
  const reportFile = path.join(ROOT, ".agent-out", "guard-report.json");
  const estimate = { cold: kit.estimateTier0(core, vitest, false), warm: kit.estimateTier0(core, vitest, true) };
  const report = {
    schema: 1,
    tool: "jbl-guard",
    tier,
    mode: opts.plan ? "plan" : opts.baseline ? "baseline" : "check",
    verdict: opts.baseline ? "baseline recorded" : opts.plan ? "planned (nothing ran)" : kit.VERDICTS[code],
    exitCode: code,
    startedAt: new Date(started).toISOString(),
    seconds: (Date.now() - started) / 1000,
    base: state.base,
    head: { commit: state.head, dirty: state.dirty },
    changed: { count: changed.length, files: changed },
    lanes: laneResults.map((l) => ({ ...l, ok: l.steps.every((s) => s.status !== "failed") })),
    plannedLanes: lanes.map((l) => ({ id: l.id, title: l.title, steps: l.steps.map((s) => ({ id: s.id, title: s.title, cwd: s.cwd, argv: s.parser === "node-check" ? ["node", "--check", `<${(s.files ?? []).length} files>`] : s.argv })) })),
    failures: allSteps.filter((s) => s.status === "failed").map((s) => ({ lane: s.lane, step: s.id, title: s.title, signatures: s.signatures, tail: s.tail ?? [], log: s.log, note: s.note })),
    escalation,
    required: kit.requiredCommands({ escalation, vitest, tier, config: core }),
    vitest: { core: vitest.core.length, related: vitest.related, slowSkipped: vitest.slowSkipped, capped: vitest.capped },
    fingerprints: { violations: statics.fingerprintViolations, changes: fpChanges, trailers: Object.fromEntries(fpTrailers) },
    protected: { note: "owner review required; reported, never a failure (CI shows them as annotations)", findings: protectedFound },
    weakening: { violations: statics.weakeningViolations, findings: weakening, trailers: Object.fromEntries(testTrailers) },
    static: { seconds: staticSeconds },
    budget: { coldSeconds: core.budget.coldSeconds, warmSeconds: core.budget.warmSeconds, estimate },
    baseline: opts.baseline ? { recorded: true, file: rel(baselineFile) } : baseline ? { used: true, head: baseline.head, recordedAt: baseline.recordedAt } : { used: false },
    notes,
    reportFile: rel(reportFile),
  };
  if (opts.baseline && state.dirty) notes.push("the baseline was recorded on a tree with uncommitted changes");
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.copyFileSync(path.join(cacheDir, "report.json"), reportFile);
  if (opts.baseline) {
    const signatures = Object.fromEntries(allSteps.filter((s) => s.signatures.length).map((s) => [s.id, s.signatures]));
    fs.writeFileSync(baselineFile, `${JSON.stringify({ head: state.head, dirty: state.dirty, recordedAt: new Date().toISOString(), signatures }, null, 2)}\n`);
  }
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else {
    printSummary(report);
    annotate(report); // (not with --json: stdout is the report alone)
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      killAll();
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

