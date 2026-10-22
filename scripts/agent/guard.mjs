#!/usr/bin/env node
/**
 * --- ai-guard --- The core guard: one command that says whether a change kept the core functions working.
 *
 *   npm run guard                      tier 0: the three lanes below at once, no build (under 3 min cold; about 40 s warm
 *                                      with nothing changed, under a minute with a full set of related tests)
 *   npm run guard:browser              tier 1: tier 0, then a /smoke build, the export served and the core smoke blocks
 *   npm run guard -- --baseline        tier 0 on the untouched tree: records the failures that already exist and every test
 *                                      file's skip counts (refused on a tree with any change; a later run uses it only when it
 *                                      measures from that very commit)
 *   npm run guard -- --plan            what would run and the static checks' findings, nothing executed (with --json: the report)
 *   options: --base <ref> (default: the merge base with JBL_GUARD_BASE when set, else origin/main, else main; a note says
 *            when it is not origin/main), --with-slow (the slow tests a change pulls in), --json (print the report instead of the summary),
 *            --report <file> (where the report goes, under .agent-out/ or the cache; JBL_GUARD_REPORT likewise; default
 *            .agent-out/guard-report.json), --port <n> (tier 1's server, default 3101), --help
 *
 * Lane A: the incremental type check (declarations emitted into the cache: a body-only edit re-checks in seconds). Lane B:
 * ESLint (cached), `node --check` on the scripts, the desktop app's and the billing Worker's type checks and tests. Lane C:
 * one vitest run of the core list (scripts/agent/core.json) and the tests related to the changed files (minus the slow ones,
 * capped), the changelog check and the smoke suite's --list. Before them, the static checks: the fingerprint lock
 * (Fingerprint-Change trailer), the protected-path report (owner review, a warning) and the test-weakening detector
 * (Test-Change trailer), with the rules of scripts/agent/protected.json at the base commit joined with the working tree's
 * (a change cannot switch off the check it would fail; core.json's lists likewise). The plan is
 * src/lib/agentKit/guardPlan.ts and protectedDiff.ts (pure, unit-tested), bundled here with esbuild. When the change edits
 * those two files, the base commit's versions are bundled as well and the static checks, the baseline verdicts and the
 * exit code are the stricter of the two: a change cannot rewrite the checks that judge it (CI runs the base commit's whole
 * guard for that reason). Nothing else of the tree it judges runs inside the guard: no module of it is imported. After the
 * lanes, the skips the tests' run shows are compared with the baseline's (or, without one, with the source). In GitHub Actions a missing base ref is an error (a shallow checkout would measure nothing), the
 * findings become annotations (errors first, one warning per rule) and the step summary lists them all.
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
  const opts = { browser: false, baseline: false, plan: false, json: false, withSlow: false, base: null, port: null, report: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--browser") opts.browser = true;
    else if (a === "--baseline") opts.baseline = true;
    else if (a === "--plan") opts.plan = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--with-slow") opts.withSlow = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--base" || a === "--port" || a === "--report") {
      if (i + 1 >= argv.length) throw new Error(`guard: ${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--base=")) opts.base = a.slice(7);
    else if (a.startsWith("--port=")) opts.port = a.slice(7);
    else if (a.startsWith("--report=")) opts.report = a.slice(9);
    else throw new Error(`guard: unknown argument "${a}" (--browser, --baseline, --plan, --json, --with-slow, --base <ref>, --report <file>, --port <n>, --help)`);
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

/** The guard's own plan and static checks: what a change to them could turn into a pass, so the base's versions judge too. */
export const KIT_FILES = ["src/lib/agentKit/guardPlan.ts", "src/lib/agentKit/protectedDiff.ts"];

/** Bundles guardPlan.ts and protectedDiff.ts from the folder `from` (the repository, or a copy of the base commit's) and imports them. */
async function loadKit(cacheDir, { from = ROOT, name = "agentKit" } = {}) {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    throw new Error("guard: esbuild is not installed – run `npm ci` (it is a dev dependency).");
  }
  const outfile = path.join(cacheDir, `${name}.mjs`);
  await esbuild.build({
    stdin: { contents: KIT_FILES.map((f) => `export * from "./${f}";\n`).join(""), resolveDir: from, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    alias: { "@": path.join(from, "src") },
    logLevel: "error",
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

/**
 * --- ai-guard --- The base commit's plan and static checks, when the change edits them (null when it does not, or the base
 * has none): copied out of git into the cache and bundled from there. Their verdicts join this run's, the stricter one
 * counting, so a change to protectedDiff.ts cannot switch off the fingerprint lock it is judged by.
 */
async function loadBaseKit(cacheDir, baseCommit, changed) {
  if (!KIT_FILES.some((f) => changed.includes(f))) return null;
  const dir = path.join(cacheDir, "base-kit");
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of KIT_FILES) {
    const text = atCommit(baseCommit, f);
    if (text === null) return null;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return loadKit(cacheDir, { from: dir, name: "agentKit-base" });
}

/**
 * --- ai-guard --- The refs tried for the base, in order, when no --base is given: JBL_GUARD_BASE (an override), origin/main, main.
 * @param {string | null} requested
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function baseCandidates(requested, env = process.env) {
  return requested ? [requested] : [env.JBL_GUARD_BASE, "origin/main", "main"].filter(Boolean);
}

/**
 * The note a run measured from another ref than origin/main carries (null for origin/main or a requested --base).
 * @param {string} ref
 * @param {string | null} requested
 * @returns {string | null}
 */
export function baseNote(ref, requested) {
  if (requested || ref === "origin/main") return null;
  if (ref === "HEAD") return "no base ref found (JBL_GUARD_BASE, origin/main, main): the change is measured against HEAD, so nothing committed is checked – pass --base <ref>";
  return `the change is measured from ${ref}, not origin/main (the order is JBL_GUARD_BASE, origin/main, main) – pass --base <ref> if that is not the branch this one goes into`;
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
  let base = null;
  for (const ref of baseCandidates(requested)) {
    const commit = tryGit(["merge-base", "HEAD", ref]);
    if (commit) {
      base = { ref, commit };
      break;
    }
    if (requested) throw new Error(`guard: --base ${requested}: no merge base with HEAD`);
  }
  // in CI a missing base means a shallow checkout: measuring against HEAD would pass every change unseen
  if (!base && process.env.GITHUB_ACTIONS === "true") throw new Error("guard: no base ref (JBL_GUARD_BASE, origin/main, main) in this checkout – fetch the history (actions/checkout with fetch-depth: 0) or pass --base <ref>");
  if (!base) base = { ref: "HEAD", commit: head };
  const note = baseNote(base.ref, requested);
  const dirty = uncommittedChanges().length > 0;
  return { head, base, dirty, note };
}

/** Every change of the working tree against HEAD – staged, unstaged and untracked (not ignored) – as `git status` lines. */
export function uncommittedChanges(cwd = ROOT) {
  const out = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  return out.split("\n").filter((l) => l.trim() && !/(^|\/)node_modules(\/|$)/.test(l.slice(3)));
}

/** A file at a commit (null: absent there, or not a git checkout). */
const atCommit = (commit, file) => {
  try {
    return git(["show", `${commit}:${file}`]);
  } catch {
    return null;
  }
};

const parseOrNull = (text) => {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
};

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
    const base = atCommit(baseCommit, file);
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

/** The repository's files, installs and build or run output aside (repository-relative, `/` separators). */
export function walk(dir, out = []) {
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
/** A string literal without escapes or `${…}` on one line. */
const STRING_LITERAL = /"([^"\\\n]+)"|'([^'\\\n]+)'|`([^`\\$\n]+)`/g;
/** path.join / path.resolve of a folder variable and string segments: `path.join(__dirname, "..", "src", "x.tsx")`, `path.join(ROOT, "next.config.ts")`. */
const PATH_CALL = /\bpath\.(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)\s*((?:,\s*(?:"[^"\\\n]*"|'[^'\\\n]*'))+)\s*,?\s*\)/g;
/** The folders whose sources the graph reads (desktop/tests and billing/tests for the weakening detector's runners). */
const GRAPH_DIRS = ["src/", "tests/", "scripts/", "relay/", "worker/", "desktop/tests/", "billing/tests/"];

/**
 * --- ai-guard --- The repository files a test names as text, so the source-pinning tests count as related to them: any
 * string literal that is an existing file (root files included: `.mcp.json`, `next.config.ts`, `package.json`), a literal
 * starting with `./` or `../` from the test's folder, and the segments of a `path.join` / `path.resolve` of `__dirname`
 * (from the test's folder) or of a root variable such as `ROOT`.
 * @param {string} file
 * @param {string} text
 * @param {ReadonlySet<string>} exists
 * @returns {string[]}
 */
export function textReads(file, text, exists) {
  const dir = path.posix.dirname(file);
  const out = new Set();
  const named = (p) => {
    const clean = path.posix.normalize(p);
    if (!clean.startsWith("../") && clean !== file && exists.has(clean)) out.add(clean);
  };
  for (const m of text.matchAll(STRING_LITERAL)) {
    const lit = m[1] ?? m[2] ?? m[3];
    if (lit.startsWith("./") || lit.startsWith("../")) named(path.posix.join(dir, lit));
    else named(lit);
  }
  for (const m of text.matchAll(PATH_CALL)) {
    const segments = [...m[2].matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'/g)].map((s) => s[1] ?? s[2]);
    const joined = path.posix.join(...segments);
    if (m[1] === "__dirname") named(path.posix.join(dir, joined));
    else {
      named(joined); // ROOT, root, repoRoot …: the repository
      named(path.posix.join(dir, joined));
    }
  }
  return [...out].sort();
}

/**
 * file → the repository files it imports (`imports`), and the same plus, for a test, the files it names as text (`graph`:
 * the source-pinning tests read them; textReads above).
 * @param {readonly string[]} files
 * @param {string} [root]
 * @returns {{ graph: Record<string, string[]>, imports: Record<string, string[]> }}
 */
export function importGraph(files, root = ROOT) {
  const exists = new Set(files);
  /** @type {Record<string, string[]>} */
  const graph = {};
  /** @type {Record<string, string[]>} */
  const imports = {};
  for (const file of files) {
    if (!/\.(ts|tsx|mjs|js|cjs)$/.test(file) || !GRAPH_DIRS.some((d) => file.startsWith(d))) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    const deps = new Set();
    for (const re of IMPORT_RES) for (const m of text.matchAll(re)) {
      const target = resolveImport(file, m[1], exists);
      if (target) deps.add(target);
    }
    imports[file] = [...deps];
    if (file.startsWith("tests/") || /\.test\.(ts|mjs)$/.test(file)) for (const f of textReads(file, text, exists)) deps.add(f);
    graph[file] = [...deps];
  }
  return { graph, imports };
}

/**
 * --- ai-guard --- Every file the test files the runners execute import, directly or through other files (a helper that still runs).
 * @param {Readonly<Record<string, readonly string[]>>} imports
 * @param {readonly string[]} runners
 * @returns {Set<string>}
 */
export function reachedFromRunners(imports, runners) {
  const reached = new Set();
  let frontier = [...runners];
  while (frontier.length) {
    const next = [];
    for (const f of frontier) for (const d of imports[f] ?? []) if (!reached.has(d)) (reached.add(d), next.push(d));
    frontier = next;
  }
  return reached;
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

/**
 * A vitest JSON report's failures (one signature per failed test), the files that ran, and each file's runtime counts.
 * @param {string} jsonFile
 * @param {string} cwd
 */
export function vitestSignatures(jsonFile, cwd) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } catch {
    return null;
  }
  const sigs = new Set();
  const ran = new Set();
  /** --- ai-guard --- per file: its tests, and those skipped or todo at run time (runtimeSkipFindings) */
  const counts = {};
  for (const file of data.testResults ?? []) {
    const name = rel(path.resolve(cwd, file.name));
    ran.add(name);
    const results = file.assertionResults ?? [];
    const failed = results.filter((a) => a.status === "failed");
    for (const a of failed) sigs.add(`vitest ${name} > ${a.fullName ?? a.title}`);
    if (file.status === "failed" && !failed.length) sigs.add(`vitest ${name}: ${String(file.message ?? "failed").split("\n")[0].slice(0, 200)}`);
    counts[name] = { tests: results.length, skipped: results.filter((a) => RUNTIME_SKIPPED.has(a.status)).length, todo: results.filter((a) => a.status === "todo").length };
  }
  return { sigs: [...sigs], ran, counts, success: data.success !== false, total: data.numTotalTests ?? 0 };
}

/*
 * --- ai-guard --- Two helpers the guard used to import from the tree it judges (scripts/test-ci.mjs, scripts/smoke/shards.mjs):
 * a change to either ran inside the guard before any check, in CI too. They are copies here, kept equal to the originals by
 * tests/coreGuard.test.ts; the guard imports no module of the working tree but its bundled plan (and, when the change edits
 * that, the base commit's too).
 */

/** "138 passed | 1 skipped (139)" → { passed: 138, skipped: 1, total: 139 }; null when it does not parse (test-ci.mjs). */
function parseCounts(segment) {
  const total = /\((\d+)\)\s*$/.exec(segment.trim());
  if (!total) return null;
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, total: Number(total[1]) };
  for (const m of segment.matchAll(/(\d+) (passed|failed|skipped|todo)\b/g)) counts[m[2]] += Number(m[1]);
  return counts;
}

/**
 * Whether a failed `vitest run` was only vitest's "Timeout calling onTaskUpdate" on a busy machine: every test file and test
 * accounted for as passed or skipped, none failed, and every unhandled error that timeout (scripts/test-ci.mjs's rule).
 * @param {string} output
 * @returns {boolean}
 */
export function onlyWorkerTimeout(output) {
  const text = String(output).replace(ANSI, "");
  const files = /^[ \t]*Test Files[ \t]+(.+)$/m.exec(text)?.[1];
  const tests = /^[ \t]*Tests[ \t]+(.+)$/m.exec(text)?.[1];
  if (!files || !tests) return false;
  for (const segment of [files, tests]) {
    const c = parseCounts(segment);
    if (!c || c.failed > 0 || c.passed + c.skipped + c.todo !== c.total || c.passed === 0) return false;
  }
  const caught = Number(/Vitest caught (\d+) unhandled errors?/.exec(text)?.[1] ?? 0);
  const timeouts = (text.match(/\[vitest-worker\]: Timeout calling "onTaskUpdate"/g) ?? []).length;
  return caught > 0 && timeouts === caught;
}

/**
 * The smoke suite's block titles, in order: every plain `await smokeBlock("title", …` line (scripts/smoke/shards.mjs's rule).
 * @param {string} source
 * @returns {string[]}
 */
export function findBlockTitles(source) {
  const titles = [];
  for (const m of String(source).matchAll(/^await smokeBlock\(\s*"((?:[^"\\\n]|\\.)*)"\s*,/gm)) titles.push(JSON.parse(`"${m[1]}"`));
  return titles;
}

/** A test file's runtime counts from vitest's JSON report: its tests, and those skipped or left to do. */
const RUNTIME_SKIPPED = new Set(["skipped", "pending", "disabled"]);

async function runStep(step, ctx) {
  const t0 = Date.now();
  const cwd = path.join(ROOT, step.cwd || "");
  const log = path.join(ctx.logDir, `${step.id}.log`);
  fs.writeFileSync(log, `$ (cd ${step.cwd || "."} && ${step.argv.join(" ")})\n`);
  const result = { id: step.id, title: step.title, lane: ctx.lane, status: "passed", seconds: 0, signatures: [], log: rel(log) };
  const done = (failed, signatures, extra = {}, excusable = true) => {
    const prior = ctx.baseline?.signatures?.[step.id];
    let verdict = ctx.kit.againstBaseline(failed, signatures, prior, excusable);
    // (the base commit's baseline rule, when the change edits guardPlan.ts: the stricter verdict counts)
    if (ctx.baseKit?.againstBaseline?.(failed, signatures, prior, excusable)?.status === "failed") verdict = { status: "failed", preExisting: [] };
    Object.assign(result, { status: verdict.status, signatures, ...(verdict.preExisting.length ? { preExisting: verdict.preExisting } : {}), seconds: (Date.now() - t0) / 1000, ...extra });
    ctx.onStep?.(result);
    return result;
  };
  // --- ai-guard --- a missing install says nothing about the code: never excused by a baseline, never recorded in one
  if (step.requires && !fs.existsSync(path.join(ROOT, step.requires.path))) {
    return done(true, [`${step.id}: ${step.requires.path} is missing`], { note: `${step.requires.path} is missing – run ${step.requires.fix}`, environment: true }, false);
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
    const all = tscSignatures(output, cwd);
    // a declaration-emitting check fails only on real type errors (the emit-only ones: a note)
    const sigs = step.declarationEmit ? all.filter((x) => !ctx.kit.declarationEmitOnly(x)) : all;
    if (failed && all.length && !sigs.length) return done(false, [], { note: `declaration emit only, no type error: ${all.slice(0, 3).join(" | ")}` });
    return done(failed, failed ? (sigs.length ? sigs : [`${step.id}: exit ${r.code}`]) : [], failed ? { tail: tailOf(output) } : {});
  }
  if (step.parser === "eslint") {
    const sigs = eslintSignatures(r.stdout);
    return done(failed, failed ? (sigs?.length ? sigs : [`${step.id}: exit ${r.code}`]) : [], failed ? { tail: sigs?.length ? sigs.slice(0, 30) : tailOf(output) } : {});
  }
  if (step.parser === "vitest") {
    const parsed = vitestSignatures(path.resolve(ROOT, step.jsonReport), cwd);
    for (const [file, c] of Object.entries(parsed?.counts ?? {})) ctx.runtime?.set(file, c);
    const sigs = parsed?.sigs ?? [];
    // every file asked for ran (a renamed or deleted core test is a failure, not a smaller run)
    const asked = step.argv.slice(step.argv.findIndex((a) => a.startsWith("--outputFile.json=")) + 1);
    const missing = parsed ? asked.filter((f) => !parsed.ran.has(f)) : [];
    for (const f of missing) sigs.push(`vitest ${f}: did not run (missing or renamed?)`);
    if (failed && !sigs.length && onlyWorkerTimeout(output)) return done(false, [], { note: 'every test passed; the only error was vitest\'s "Timeout calling onTaskUpdate" (a busy machine)' });
    const bad = failed || missing.length > 0;
    return done(bad, bad ? (sigs.length ? sigs : [`${step.id}: exit ${r.code}`]) : [], bad ? { tail: tailOf(output, 40) } : { note: parsed ? `${parsed.total} tests` : undefined });
  }
  // --- ai-guard --- the smoke run: one signature per failed check, so a baseline excuses only the checks it recorded; a run
  // that did not finish (a block threw) or failed without a check is the whole step's failure, never excused
  if (step.parser === "smoke") {
    const { signatures, finished } = ctx.kit.smokeSignatures ? ctx.kit.smokeSignatures(output) : { signatures: [], finished: false };
    if (!failed) return done(false, []);
    const whole = !finished || !signatures.length;
    const sigs = whole ? [...signatures, `${step.id}: exit ${r.code}${finished ? "" : " (the run did not finish)"}`] : signatures;
    return done(true, sigs, { tail: tailOf(output) }, !whole);
  }
  // one signature for the whole step (`changelog: exit 1`): a baseline that has it would excuse every later failure of the
  // step, so it never does
  return done(failed, failed ? [`${step.id}: exit ${r.code}`] : [], failed ? { tail: tailOf(output) } : {}, false);
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

/**
 * --- ai-guard --- One line of the human summary as it may reach stdout: a line break inside a value (a timeout's text, an
 * allow-list entry, a test's output) shown as ⏎, and a line that would start a workflow command (`::stop-commands::…`,
 * `##[…]`, after any leading space: the Actions runner trims it) broken up – so the change being judged can never hide the
 * annotations that follow, or issue a command of its own.
 * @param {string} line
 * @returns {string}
 */
export function safeLine(line) {
  return String(line)
    .replace(/\r\n|\r|\n/g, " ⏎ ")
    .replace(/^(\s*)(::|##\[)/, (_, space, cmd) => `${space}${cmd === "::" ? ": :" : "# #["}`);
}

/**
 * The human summary of a report (stdout without --json): every line through safeLine.
 * @param {any} report
 * @returns {string}
 */
export function summaryText(report) {
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
  for (const c of f.changes.filter((x) => !x.acknowledged)) lines.push(`       x fingerprint ${c.kind}: ${c.mode} in ${c.file} (${c.where})${c.detail ? ` – ${c.detail}` : ""} – needs a commit trailer "Fingerprint-Change: ${c.mode} - <reason>" and owner review`);
  for (const c of f.changes.filter((x) => x.acknowledged && x.kind !== "added")) lines.push(`       - fingerprint ${c.kind}: ${c.mode} (${c.file}) – acknowledged: ${c.reasons.join("; ")}`);
  for (const x of w.findings) lines.push(`       ${x.acknowledged ? "-" : "x"} ${x.kind}: ${x.file} – ${x.detail}${x.acknowledged ? ` (acknowledged: ${x.reasons.join("; ")})` : x.kind === "only-added" ? " (remove the .only)" : ` – needs "Test-Change: ${x.file} - <reason>" and owner review`}`);
  for (const p of report.protected.findings) lines.push(`       ! owner review required: ${p.path} (${p.rule}) – ${p.why}${p.keys ? `: ${p.keys.slice(0, 6).join(", ")}${p.keys.length > 6 ? ", …" : ""}` : ""}`);
  const z = report.zones.files;
  lines.push(`  zones: ${z.free.length} free · ${z.core.length} core · ${z.guarded.length} guarded · ${z.protected.length} protected${report.zones.coreFunctions.length ? ` · core functions: ${report.zones.coreFunctions.map((c) => c.id).join(", ")}` : ""}`);
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
  return `${lines.map(safeLine).join("\n")}\n`;
}

/**
 * --- ai-guard --- The stricter of exit codes: 1 (failed) over 2 (a higher tier is required) over 0 (green).
 * @param {...number} codes
 * @returns {0 | 1 | 2}
 */
export const strictest = (...codes) => (codes.includes(1) ? 1 : codes.includes(2) ? 2 : 0);

/**
 * --- ai-guard --- This run's static findings joined with the base commit's checks' (`theirs`; null when the change leaves
 * guardPlan.ts and protectedDiff.ts alone): a finding only one of them makes counts, and one both make is acknowledged only
 * when both say so – so editing the checks can add findings, never take one away.
 * @param {{ fpChanges: any[], protectedFound: any[], weakening: any[] }} own
 * @param {{ fpChanges: any[], protectedFound: any[], weakening: any[] } | null} theirs
 * @returns {{ fpChanges: any[], protectedFound: any[], weakening: any[] }}
 */
export function stricterStatics(own, theirs) {
  if (!theirs) return { fpChanges: own.fpChanges, protectedFound: own.protectedFound, weakening: own.weakening };
  const join = (mine, other, key) => {
    const out = mine.map((x) => ({ ...x }));
    for (const y of other) {
      const at = out.find((x) => key(x) === key(y));
      if (!at) out.push({ ...y, by: "the base commit's checks" });
      else if (at.acknowledged === true && y.acknowledged === false) Object.assign(at, { acknowledged: false, reasons: [] });
    }
    return out;
  };
  return {
    fpChanges: join(own.fpChanges, theirs.fpChanges, (c) => `${c.file}\0${c.mode}\0${c.kind}\0${c.where}`),
    protectedFound: join(own.protectedFound, theirs.protectedFound, (p) => `${p.path}\0${p.rule}`),
    weakening: join(own.weakening, theirs.weakening, (w) => `${w.kind}\0${w.file}`),
  };
}

/** Whether a path is inside the repository (by its name; links are writeOutFile's business). */
const isInsideRoot = (file) => {
  const r = path.relative(ROOT, file);
  return !r.startsWith("..") && !path.isAbsolute(r);
};

/** GitHub keeps at most this many annotations of one kind (error, warning) per step. */
export const ANNOTATIONS_PER_KIND = 10;

/**
 * --- ai-guard --- In GitHub Actions: the violations as errors first, then the owner-review findings as warnings, one per
 * rule naming its files – each kind capped at what GitHub keeps for a step, the last one saying how many more the step
 * summary lists (stepSummary below).
 * @param {any} report
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function annotations(report, env = process.env) {
  if (env.GITHUB_ACTIONS !== "true") return "";
  const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const errors = [
    ...report.fingerprints.changes.filter((x) => !x.acknowledged).map((c) => ({ file: c.file, title: `Fingerprint ${c.kind} without a trailer`, text: `${c.mode}${c.detail ? ` (${c.detail})` : ""}: add "Fingerprint-Change: ${c.mode} - <reason>" to the commit` })),
    ...report.weakening.findings.filter((y) => !y.acknowledged).map((x) => ({ file: x.file, title: `Test weakened (${x.kind})`, text: x.detail })),
  ];
  const byRule = new Map();
  for (const p of report.protected.findings) {
    if (!byRule.has(p.rule)) byRule.set(p.rule, { why: p.why, files: [] });
    if (!byRule.get(p.rule).files.includes(p.path)) byRule.get(p.rule).files.push(p.path);
  }
  const warnings = [...byRule].map(([rule, g]) => ({ file: g.files[0], title: `Owner review required (${rule})`, text: `${g.why}: ${g.files.join(", ")}` }));
  const capped = (list, what) => (list.length <= ANNOTATIONS_PER_KIND ? list : [...list.slice(0, ANNOTATIONS_PER_KIND - 1), { title: `${list.length - ANNOTATIONS_PER_KIND + 1} more ${what}`, text: `and ${list.length - ANNOTATIONS_PER_KIND + 1} more ${what}: the step summary lists every finding` }]);
  const line = (kind, a) => `::${kind} ${a.file ? `file=${prop(a.file)},` : ""}title=${prop(a.title)}::${esc(a.text)}\n`;
  return [...capped(errors, "violations").map((a) => line("error", a)), ...capped(warnings, "owner-review rules").map((a) => line("warning", a))].join("");
}

/**
 * --- ai-guard --- Every static finding of a report as Markdown, for $GITHUB_STEP_SUMMARY (the annotations are capped; this is not).
 * @param {any} report
 * @returns {string}
 */
export function stepSummary(report) {
  const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const out = [`### Core guard (static checks): base ${report.base.ref} (${report.base.commit.slice(0, 7)}), ${report.changed.count} changed files`, ""];
  const bad = [...report.fingerprints.changes.filter((x) => !x.acknowledged).map((c) => [`fingerprint ${c.kind}`, c.file, `${c.mode} (${c.where})${c.detail ? `: ${c.detail}` : ""}: needs "Fingerprint-Change: ${c.mode} - <reason>"`]), ...report.weakening.findings.filter((x) => !x.acknowledged).map((x) => [x.kind, x.file, x.detail])];
  out.push(bad.length ? `**${bad.length} violation${bad.length === 1 ? "" : "s"}**` : "No violations.", "");
  if (bad.length) out.push("| Finding | File | Detail |", "| --- | --- | --- |", ...bad.map((r) => `| ${r.map(cell).join(" | ")} |`), "");
  const notes = [...report.fingerprints.changes.filter((x) => x.acknowledged && x.kind !== "added").map((c) => [`fingerprint ${c.kind}`, c.file, `acknowledged: ${c.reasons.join("; ")}`]), ...report.weakening.findings.filter((x) => x.acknowledged).map((x) => [x.kind, x.file, `${x.detail} (acknowledged: ${x.reasons.join("; ")})`])];
  if (notes.length) out.push("| Acknowledged | File | Detail |", "| --- | --- | --- |", ...notes.map((r) => `| ${r.map(cell).join(" | ")} |`), "");
  const own = report.protected.findings;
  out.push(own.length ? `**Owner review required: ${own.length} finding${own.length === 1 ? "" : "s"}**` : "Nothing for owner review.", "");
  if (own.length) out.push("| File | Rule | Why |", "| --- | --- | --- |", ...own.map((p) => `| ${[p.path, p.keys ? `${p.rule}: ${p.keys.join(", ")}` : p.rule, p.why].map(cell).join(" | ")} |`), "");
  for (const n of report.notes ?? []) out.push(`- ${cell(n)}`);
  return `${out.join("\n")}\n`;
}

/** Throws unless `p` (or, while it does not exist yet, its nearest existing folder) really is inside `root` (the repository by default), links resolved. */
function assertInsideRepo(p, root = ROOT) {
  let at = path.resolve(p);
  while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  const r = path.relative(fs.realpathSync(root), fs.realpathSync(at));
  if (r.startsWith("..") || path.isAbsolute(r)) throw new Error(`guard: ${rel(p)} leads outside ${root === ROOT ? "the repository" : rel(root)} (a symbolic link): remove the link`);
}

/**
 * --- ai-guard --- Where the report goes: --report, else JBL_GUARD_REPORT, else .agent-out/guard-report.json – only under
 * .agent-out/ or the guard's cache (a test's run never replaces the report of the guard run it is part of).
 * @param {string | null} wanted
 * @param {string} cacheDir
 * @returns {{ file: string, root: string }}
 */
export function reportFileFor(wanted, cacheDir) {
  const fallback = path.join(ROOT, ".agent-out", "guard-report.json");
  if (!wanted) return { file: fallback, root: ROOT };
  const file = path.resolve(ROOT, wanted);
  const under = (dir) => {
    const r = path.relative(dir, file);
    return r !== "" && !r.startsWith("..") && !path.isAbsolute(r);
  };
  if (under(path.join(ROOT, ".agent-out"))) return { file, root: ROOT };
  if (under(cacheDir)) return { file, root: cacheDir };
  throw new Error(`guard: --report ${wanted}: the report goes under .agent-out/ or the guard's cache (${rel(cacheDir)})`);
}

/**
 * Writes a file under .agent-out/ (or the cache) without following a link: the folder must lead to a folder inside `root`,
 * and the file is written under a fresh name and renamed over the target, which replaces a symbolic link there instead of
 * writing through it (a checkout may carry one; the report must never land outside the repository).
 */
function writeOutFile(file, text, root = ROOT) {
  const dir = path.dirname(file);
  assertInsideRepo(dir, root);
  fs.mkdirSync(dir, { recursive: true });
  assertInsideRepo(dir, root);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text, { flag: "wx" });
  fs.renameSync(tmp, file);
}

/** Writes to stdout and waits until it is flushed (a pipe is asynchronous: an exit right after a write would cut it at 64 KB). */
const print = (text) => new Promise((resolve) => process.stdout.write(text, () => resolve()));

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
  // a stopped guard stops its lanes (tsc, eslint, vitest and its workers, next build) with it
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.on(signal, () => {
      killAll();
      process.exit(code);
    });
  }
  const cacheDir = cacheDirFor(ROOT);
  if (!process.env.JBL_GUARD_CACHE) assertInsideRepo(cacheDir); // (.agent-out/cache in a worktree: never through a link out of it)
  const report_ = reportFileFor(opts.report ?? process.env.JBL_GUARD_REPORT ?? null, cacheDir);
  const logDir = path.join(cacheDir, "logs");
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.mkdirSync(logDir, { recursive: true });
  const kit = await loadKit(cacheDir);

  const notes = [];
  const state = gitState(opts.base);
  if (state.note) notes.push(state.note);
  // a baseline is recorded only on an untouched tree: its failures must be the base's, never the change's own
  if (opts.baseline && !opts.plan) {
    const pending = uncommittedChanges();
    if (pending.length) throw new Error(`guard: --baseline needs an untouched tree, and this one has ${pending.length} change${pending.length === 1 ? "" : "s"} (${pending.slice(0, 5).map((l) => l.slice(3)).join(", ")}${pending.length > 5 ? ", …" : ""}). Commit, stash (git stash -u) or remove them first.`);
  }
  const exists = (f) => fs.existsSync(path.join(ROOT, f));
  // the rules come from the base commit too: a rule the change removes still applies until the owner merges it
  const headCore = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/agent/core.json"), "utf8"));
  const headProt = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/agent/protected.json"), "utf8"));
  const baseCore = parseOrNull(atCommit(state.base.commit, "scripts/agent/core.json"));
  const baseProt = parseOrNull(atCommit(state.base.commit, "scripts/agent/protected.json"));
  const core = kit.mergeCoreConfigs(baseCore, headCore, exists);
  const prot = kit.mergeProtectedConfigs(baseProt, headProt);
  const changed = changedFiles(state.base.commit);
  const messages = commitMessages(state.base.commit);
  // --- ai-guard --- a change to the guard's own checks is judged by the base commit's checks as well (the stricter counts)
  let baseKit = null;
  try {
    baseKit = await loadBaseKit(cacheDir, state.base.commit, changed);
  } catch (e) {
    notes.push(`the base commit's guardPlan.ts and protectedDiff.ts did not load (${e instanceof Error ? e.message.split("\n")[0] : e}): only the working tree's judged`);
  }
  if (baseKit) notes.push(`this change edits ${KIT_FILES.filter((f) => changed.includes(f)).join(" and ")}: the static checks, the baseline verdicts and the exit code also ran with the base commit's version, and the stricter result counts`);
  if (changed.includes("scripts/agent/guard.mjs")) notes.push("scripts/agent/guard.mjs differs from the base: this run's verdict comes from the changed guard (owner review); CI judges a push with the base commit's guard");
  const tree = walk("");
  const testFiles = tree.filter((f) => /^tests\/.+\.test\.ts$/.test(f) || /^relay\/.+\.test\.mjs$/.test(f)).sort();
  const ids = modeIds();
  const blocks = findBlockTitles(fs.readFileSync(path.join(ROOT, "scripts/smoke-test.mjs"), "utf8"));
  const { graph, imports } = importGraph(tree);

  // static checks
  const s0 = Date.now();
  const read = new Map();
  const filesOf = (list) => {
    for (const [f, v] of versions(state.base.commit, list.filter((f) => !read.has(f)))) read.set(f, v);
    return new Map(list.map((f) => [f, read.get(f)]));
  };
  const runners = reachedFromRunners(imports, tree.filter((f) => kit.matchesAny(f, prot.weakening.runs ?? [])));
  const statics_ = (k) => {
    const rules = k.mergeProtectedConfigs(baseProt, headProt);
    const files = filesOf(k.filesToRead(rules, changed));
    const fpTrailers = k.parseTrailers(messages, "Fingerprint-Change");
    const testTrailers = k.parseTrailers(messages, "Test-Change");
    const weakening = k.weakeningFindings(rules.weakening, changed, files, testTrailers, { imported: (f) => runners.has(f) });
    if (k.coreTestFindings) weakening.push(...k.coreTestFindings({ baseCore: (baseCore?.vitest?.core ?? []).map((t) => t.file), core: core.vitest.core.map((t) => t.file), exists, weakening, trailers: testTrailers }));
    return { fpTrailers, testTrailers, fpChanges: k.fingerprintChanges(rules.fingerprints, files, fpTrailers), protectedFound: k.protectedFindings(rules, changed, files), weakening };
  };
  const own = statics_(kit);
  let theirs = null;
  if (baseKit) {
    try {
      theirs = statics_(baseKit);
    } catch (e) {
      notes.push(`the base commit's static checks failed on this change (${e instanceof Error ? e.message : e}): only the working tree's judged`);
    }
  }
  const { fpChanges, protectedFound, weakening } = stricterStatics(own, theirs);
  const { fpTrailers, testTrailers } = own;
  const statics = {
    fingerprintViolations: fpChanges.filter((c) => !c.acknowledged).length,
    weakeningViolations: weakening.filter((w) => !w.acknowledged).length,
    protectedFindings: protectedFound.length,
  };
  const staticSeconds = (Date.now() - s0) / 1000;

  // the plan
  const related = kit.relatedTests(changed, graph, testFiles);
  const escalation = kit.planEscalation({ changed, config: core, modeIds: ids, smokeBlocks: blocks, testFiles });
  const vitest = kit.planVitest({ config: core, related, escalated: escalation.tests.filter((f) => testFiles.includes(f)), withSlow: opts.withSlow });
  // --- agent-guide --- each changed file's edit zone and the core functions it touches (AGENTS.md, docs/agents/CORE.md)
  const zones = kit.editZones({ changed, config: core, protectedFiles: protectedFound.map((x) => x.path) });
  const nodeCheckFiles = tree.filter((f) => kit.matchesAny(f, core.nodeCheck)).sort();
  const lanes = kit.planTier0({ config: core, vitest, cacheDir, nodeCheckFiles }); // (absolute: the desktop and billing steps run in their own folders)
  // --- ai-guard --- a baseline of a missing install would excuse every later failure of its checks: refused
  if (opts.baseline && !opts.plan) {
    const missing = kit.missingInstalls ? kit.missingInstalls(lanes, exists) : [];
    if (missing.length) throw new Error(`guard: --baseline needs every install the lanes use, and ${missing.map((m) => m.path).join(" and ")} ${missing.length === 1 ? "is" : "are"} missing – run ${missing.map((m) => m.fix).join(" and ")} first`);
  }
  const tier = opts.browser ? 1 : 0;
  const baselineFile = path.join(cacheDir, "baseline.json");
  let baseline = null;
  if (!opts.baseline && fs.existsSync(baselineFile)) {
    const b = parseOrNull(fs.readFileSync(baselineFile, "utf8"));
    const usable = kit.baselineUsable(b, { baseCommit: state.base.commit, isAncestor: (a, c) => /^[0-9a-f]{7,64}$/.test(a) && tryGit(["merge-base", "--is-ancestor", a, c]) !== null });
    if (usable.ok) baseline = b;
    else notes.push(usable.why);
  }
  if (opts.baseline && state.head !== state.base.commit) notes.push(`the baseline is recorded at HEAD (${state.head.slice(0, 7)}), after the base (${state.base.commit.slice(0, 7)}): a run measured from that base ignores it (its failures may be this branch's own); a run with --base ${state.head.slice(0, 7)} uses it`);

  const laneResults = [];
  /** --- ai-guard --- every test file's runtime counts (tests, skipped, todo) from the vitest reports of this run */
  const runtime = new Map();
  if (!opts.plan) {
    const ctxBase = { kit, baseKit, logDir, baseline, runtime, onStep: opts.json ? null : (r) => process.stderr.write(`  ${r.lane} ${r.status === "passed" ? "ok  " : r.status === "failed" ? "FAIL" : r.status} ${r.title} (${r.seconds.toFixed(1)} s)\n`) };
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
      const smoke = kit.tier1SmokeBlocks(core, escalation, blocks, zones.coreFunctions.flatMap((c) => c.smoke));
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

  // --- ai-guard --- the skips the run shows that the static checks cannot see (`it["skip"]`, an alias they do not follow):
  // against the baseline's counts of the base commit, else against the source's own modifiers; the base commit's rule as
  // well when the change edits protectedDiff.ts (the stricter counts)
  if (!opts.plan && !opts.baseline && runtime.size) {
    const heads = new Map(changed.filter((f) => runtime.has(f)).map((f) => [f, read.get(f)?.head ?? (exists(f) ? fs.readFileSync(path.join(ROOT, f), "utf8") : null)]));
    const input = { changed, tests: prot.weakening.tests, now: runtime, base: baseline?.counts ? new Map(Object.entries(baseline.counts)) : null, heads, trailers: testTrailers };
    const mine = kit.runtimeSkipFindings ? kit.runtimeSkipFindings(input) : [];
    let others = null;
    try {
      others = baseKit?.runtimeSkipFindings ? baseKit.runtimeSkipFindings(input) : null;
    } catch {
      others = null;
    }
    weakening.push(...stricterStatics({ fpChanges: [], protectedFound: [], weakening: mine }, others ? { fpChanges: [], protectedFound: [], weakening: others } : null).weakening);
    statics.weakeningViolations = weakening.filter((w) => !w.acknowledged).length;
    if (!input.base && changed.some((f) => runtime.has(f) && kit.matchesAny(f, prot.weakening.tests))) notes.push("the runtime skip counts of the changed test files were compared with their source alone: no baseline of the base commit (npm run guard -- --baseline on it) to compare with");
  }

  const allSteps = laneResults.flatMap((l) => l.steps);
  const verdictInput = { steps: allSteps, statics, escalation, tier, vitest, baselineRun: opts.baseline };
  let code = opts.plan ? (statics.fingerprintViolations || statics.weakeningViolations ? 1 : 0) : kit.exitCode(verdictInput);
  if (baseKit && !opts.plan) {
    try {
      code = strictest(code, baseKit.exitCode(verdictInput));
    } catch {
      /* an older base without it: this run's code */
    }
  }
  const reportFile = report_.file;
  const estimate = { cold: kit.estimateTier0(core, vitest, false), warm: kit.estimateTier0(core, vitest, true), edit: kit.estimateTier0(core, vitest, "edit") };
  const report = {
    schema: 1,
    tool: "jbl-guard",
    tier,
    mode: opts.plan ? "plan" : opts.baseline ? "baseline" : "check",
    verdict: opts.plan ? "planned (nothing ran)" : opts.baseline ? "baseline recorded" : kit.verdictOf(code, allSteps),
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
    protected: { note: "owner review required; reported, never a failure (a warning annotation where the guard runs in GitHub Actions)", findings: protectedFound },
    weakening: { violations: statics.weakeningViolations, findings: weakening, trailers: Object.fromEntries(testTrailers) },
    static: { seconds: staticSeconds },
    budget: { coldSeconds: core.budget.coldSeconds, warmSeconds: core.budget.warmSeconds, estimate },
    baseline: opts.baseline && !opts.plan ? { recorded: true, file: rel(baselineFile), head: state.head } : baseline ? { used: true, head: baseline.head, recordedAt: baseline.recordedAt } : { used: false },
    zones,
    notes,
    reportFile: isInsideRoot(reportFile) ? rel(reportFile) : reportFile,
    ...(process.env.JBL_GUARD_RUN_ID ? { runId: process.env.JBL_GUARD_RUN_ID } : {}),
  };
  fs.writeFileSync(path.join(cacheDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeOutFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, report_.root);
  if (opts.baseline && !opts.plan) {
    // (a missing install describes the machine, not the code: never recorded, so it can never be excused)
    const signatures = Object.fromEntries(allSteps.filter((s) => s.signatures.length && !s.environment).map((s) => [s.id, s.signatures]));
    // (the tree was checked untouched before the lanes ran; a change made while they ran makes it dirty after all)
    const dirty = state.dirty || uncommittedChanges().length > 0;
    // (with every test file's runtime counts: a later run compares its skips with them)
    fs.writeFileSync(baselineFile, `${JSON.stringify({ head: state.head, dirty, base: state.base, recordedAt: new Date().toISOString(), signatures, counts: Object.fromEntries(runtime) }, null, 2)}\n`);
  }
  if (opts.json) await print(`${JSON.stringify(report, null, 2)}\n`);
  else await print(summaryText(report) + annotations(report)); // (not with --json: stdout is the report alone)
  // --- ai-guard --- in Actions, every finding in the step summary (the annotations above are capped at 10 of a kind); not
  // with --json, as the annotations: a caller that takes the report (a test, the agent CLI) adds nothing to the job's page
  if (!opts.json && process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, stepSummary(report));
    } catch {
      /* no summary file: the annotations stand */
    }
  }
  return code;
}

/**
 * --- ai-guard --- Whether `metaUrl` is the module Node started (`argv1`): their real paths compared, so a start through a
 * symbolic link (macOS's /tmp, a linked home or workspace) runs the guard instead of exiting 0 having done nothing.
 * @param {string} metaUrl
 * @param {string | undefined} [argv1]
 * @returns {boolean}
 */
export function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  const self = fileURLToPath(metaUrl);
  try {
    return fs.realpathSync(path.resolve(argv1)) === fs.realpathSync(self);
  } catch {
    return path.resolve(argv1) === self;
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      killAll();
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

