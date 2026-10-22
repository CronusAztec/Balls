#!/usr/bin/env node
/**
 * --- agent-cli --- The agent toolbox: eyes and hands for coding agents (and people) working on this repository.
 *
 *   npm run agent -- <tool> [--json '{…}'] [--pretty]
 *   npm run agent -- <tool> --json -        the arguments from stdin (any length; the MCP server calls it so)
 *   npm run agent -- --help                 the tools and their input schemas
 *
 * Prints exactly one JSON object on stdout – {"ok":true,"tool":…,"result":…} or {"ok":false,"tool":…,"error":…} – and
 * exits 0 (ok), 1 (the tool failed) or 2 (a usage error: unknown tool, bad JSON, arguments the tool's schema refuses).
 * Progress notes go to stderr. The tools (src/lib/agentKit/tools.ts has their schemas):
 *
 *   modes        the mode catalog (one mode's fields with {"mode":…})
 *   simulate     one seed of a link or mode, headless, as the seed finder runs it          (deterministic)
 *   fingerprint  a mode's determinism fingerprint against tests/extras.test.ts BASELINE    (deterministic)
 *   preview      a watermarked PNG contact sheet of a link from a local export             (Chromium)
 *   render       a watermarked clip of a link through the page's own fast export           (Chromium)
 *   site-shot    PNG screenshots of site pages from the local export                       (Chromium)
 *   analyse      numeric features of a local video file (ffmpeg)
 *   guard        the core guard (npm run guard; {"plan":true} for the static checks alone)
 *   explain      which fix a failure allows (source pin, behaviour, fingerprint…)
 *   site-stats   owner-run: aggregate numbers from the owner's Plausible or Umami (needs their key)
 *   postiz-probe owner-run: which analytics series the owner's Postiz returns (needs their key)
 *
 * Rules every tool keeps (scripts/agent/paths.mjs): it writes its results only under .agent-out/ (its caches: the private
 * agent cache in the OS temp folder, and for the guard its own, see tools.ts alsoWrites); every path argument must resolve
 * inside the repository; it never starts a shell (child processes get
 * argument arrays); it uses no network except the CLI's own localhost server for the browser tools – the browser is
 * fenced to it – and, for the two owner-run commands, the owner's own host they document. Pictures and clips carry the
 * watermark a free visitor's do: no tool installs a licence. docs/agents/CLI.md is the guide.
 */
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadToolCore, loadToolbox } from "./bundle.mjs";
import { OUT_DIR, ROOT, ensureOutDir, isInside, repoRelative } from "./paths.mjs";

export class UsageError extends Error {}
export class ToolError extends Error {}

/** The arguments' JSON text as an object, or a UsageError. */
export function parseArgsJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`--json is not valid JSON (${e.message})`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UsageError("--json must be a JSON object");
  return value;
}

/**
 * `<tool> [--json '{…}' | --json={…} | --json -] [--pretty]` → { tool, args, pretty, help } (and stdin: true). `--json -`
 * reads the object from stdin (the MCP server's way: no command-line length limit), which main() does before the call.
 */
export function parseArgv(argv) {
  const out = { tool: null, args: {}, pretty: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--pretty") out.pretty = true;
    else if (a === "--json" || a.startsWith("--json=")) {
      const text = a === "--json" ? argv[++i] : a.slice("--json=".length);
      if (text === undefined) throw new UsageError("--json needs a JSON object");
      if (text === "-") out.stdin = true;
      else out.args = parseArgsJson(text);
    } else if (a.startsWith("-")) throw new UsageError(`Unknown option ${a}`);
    else if (out.tool === null) out.tool = a;
    else throw new UsageError(`One tool at a time (got ${out.tool} and ${a})`);
  }
  return out;
}

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

/* ------------------------------------------------------------------ the tools that need no browser */

async function modesTool(tb, args) {
  const messages = readJson("messages/en.json");
  if (args.mode === undefined) return { count: tb.MODE_IDS.length, modes: tb.modeCatalog(messages) };
  const detail = tb.modeDetail(args.mode, messages);
  if (!detail) throw new ToolError(`Unknown mode "${args.mode}" (the modes: ${tb.MODE_IDS.join(", ")})`);
  return detail;
}

async function simulateTool(tb, args) {
  const run = await tb.resolveRun(args);
  if (!run.ok) throw new ToolError(run.error);
  const result = tb.simulate({ settings: run.settings, seed: run.seed, seconds: args.seconds ?? 30, world: args.world, continueAfterFinish: args.continueAfterFinish === true });
  return { link: `?${run.query}`, ...result };
}

async function fingerprintTool(tb, args) {
  const baseline = tb.parseBaselineLiteral(fs.readFileSync(path.join(ROOT, tb.BASELINE_FILE), "utf8"));
  const one = (mode) => {
    const fingerprint = tb.fingerprintOf(mode);
    const pinned = baseline[mode] ?? null;
    const diff = pinned ? tb.diffFingerprint(fingerprint, pinned) : { equal: false, differences: [`no BASELINE entry for ${mode} in ${tb.BASELINE_FILE}`] };
    return { mode, equal: diff.equal, differences: diff.differences, fingerprint, baseline: pinned };
  };
  const recipe = { file: tb.BASELINE_FILE, seed: tb.FINGERPRINT_SEED, frames: tb.FINGERPRINT_FRAMES };
  if (args.mode !== undefined) {
    if (!tb.isModeId(args.mode)) throw new ToolError(`Unknown mode "${args.mode}" (see the modes tool)`);
    return { recipe, ...one(args.mode) };
  }
  const modes = tb.MODE_IDS.map((m) => {
    const r = one(m);
    return { mode: m, equal: r.equal, differences: r.differences };
  });
  return { recipe, allEqual: modes.every((m) => m.equal), moved: modes.filter((m) => !m.equal).map((m) => m.mode), modes };
}

/**
 * The source of a test file a failure names, or "" when it is not a file inside tests/ – links resolved (a name with `..`
 * or a link that leads out of tests/ is never read: the CLI reads only inside the repository).
 */
export function testSourceOf(file, root = ROOT) {
  const testsDir = path.join(root, "tests");
  const full = path.resolve(root, file);
  if (!isInside(testsDir, full) || !fs.existsSync(full)) return "";
  const real = fs.realpathSync(full);
  if (!isInside(fs.realpathSync(testsDir), real) || !fs.statSync(real).isFile()) return "";
  return fs.readFileSync(real, "utf8");
}

async function explainTool(tb, args) {
  const facts = tb.testFilesIn(args.failure).map((file) => ({ file, readsAsText: tb.textReadsOf(testSourceOf(file)) }));
  return tb.explainFailure(args.failure, facts);
}

/* ------------------------------------------------------------------ guard */

/** Where the core guard lives once its branch is merged (`npm run guard` runs it). */
export const GUARD_SCRIPT = "scripts/agent/guard.mjs";

/**
 * How the guard is started: package.json's `guard` script when it is a plain `node <file>` command, else through npm when
 * the CLI was started by npm, else the guard script itself once it exists; null when there is no guard to run.
 *
 * @param {{ scripts?: Record<string, string> }} pkg
 * @param {string[]} extra
 * @param {{ exists?: (file: string) => boolean, npmExecPath?: string | null }} [options]
 * @returns {{ file: string, args: string[], shown: string } | null}
 */
export function guardCommand(pkg, extra, { exists = (f) => fs.existsSync(path.join(ROOT, f)), npmExecPath = process.env.npm_execpath } = {}) {
  const script = pkg?.scripts?.guard;
  if (typeof script === "string") {
    const m = /^node\s+([\w./-]+\.m?js)((?:\s+[\w=./-]+)*)\s*$/.exec(script.trim()); // plain words only: never a shell
    if (m) return { file: process.execPath, args: [m[1], ...m[2].trim().split(/\s+/).filter(Boolean), ...extra], shown: `npm run guard${extra.length ? ` -- ${extra.join(" ")}` : ""}` };
    if (npmExecPath) return { file: process.execPath, args: [npmExecPath, "run", "guard", ...(extra.length ? ["--", ...extra] : [])], shown: `npm run guard${extra.length ? ` -- ${extra.join(" ")}` : ""}` };
    return null;
  }
  if (exists(GUARD_SCRIPT)) return { file: process.execPath, args: [GUARD_SCRIPT, ...extra], shown: `node ${GUARD_SCRIPT}${extra.length ? ` ${extra.join(" ")}` : ""}` };
  return null;
}

const TAIL_CHARS = 6000;

/** The guard's own flags for the tool's arguments (every one is a flag scripts/agent/guard.mjs parses). */
export function guardFlags(args) {
  return [
    ...(args.browser ? ["--browser"] : []),
    ...(args.baseline ? ["--baseline"] : []),
    ...(args.plan ? ["--plan"] : []),
    ...(args.withSlow ? ["--with-slow"] : []),
    ...(typeof args.base === "string" ? ["--base", args.base] : []),
  ];
}

/**
 * Runs a command and keeps the end of its stdout and stderr as text: each stream decoded as UTF-8 across its chunks (a
 * character split at a 64 KB pipe boundary stays whole, never U+FFFD).
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, keepChars?: number }} [options]
 * @returns {Promise<{ code: number | null, output: string }>}
 */
export function runCaptured(file, args, { env = process.env, keepChars = 4 * TAIL_CHARS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let text = "";
    const keep = (chunk) => {
      text = (text + chunk).slice(-keepChars);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (e) => resolve({ code: null, output: `${text}\n${e.message}` }));
    child.on("close", (c) => resolve({ code: c, output: text }));
  });
}

/**
 * Where the guard writes its report: JBL_GUARD_REPORT (as the guard reads it), else .agent-out/guard-report.json.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export const guardReportFile = (env = process.env) => (env.JBL_GUARD_REPORT ? path.resolve(ROOT, env.JBL_GUARD_REPORT) : path.join(OUT_DIR, "guard-report.json"));

async function guardTool(_tb, args) {
  const cmd = guardCommand(readJson("package.json"), guardFlags(args));
  if (!cmd)
    return {
      available: false,
      message: `No core guard in this checkout: package.json has no plain \`guard\` script and ${GUARD_SCRIPT} is missing. Run npm run typecheck, npm run lint and the vitest files you touched.`,
    };
  process.stderr.write(`agent guard: ${cmd.shown}\n`);
  // --- agent-cli --- the run's own id, which the guard writes into its report: an older report (a run that died before
  // writing one, a test's plan) is never returned as this run's
  const runId = crypto.randomUUID();
  const { code, output } = await runCaptured(cmd.file, cmd.args, { env: { ...process.env, JBL_GUARD_RUN_ID: runId } });
  const reportFile = guardReportFile();
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    if (report?.runId !== runId) report = null;
  } catch {
    report = null;
  }
  // the report's own verdict when it is this run's (it knows a plan or a baseline run), else one from the exit code
  const verdict = typeof report?.verdict === "string" ? report.verdict : code === 0 ? "green" : code === 2 ? "green, a higher tier is required" : "failed";
  return { available: true, command: cmd.shown, exitCode: code, verdict, report, reportFile: report ? repoRelative(reportFile) : null, outputTail: output.slice(-TAIL_CHARS) };
}

/* ------------------------------------------------------------------ dispatch */

const TOOLS = {
  modes: modesTool,
  simulate: simulateTool,
  fingerprint: fingerprintTool,
  explain: explainTool,
  guard: guardTool,
  preview: async (tb, args) => (await import("./browser.mjs")).previewTool(tb, args),
  render: async (tb, args) => (await import("./browser.mjs")).renderTool(tb, args),
  "site-shot": async (tb, args) => (await import("./browser.mjs")).siteShotTool(tb, args),
  analyse: async (tb, args) => (await import("./analyse.mjs")).analyseTool(tb, args),
  "site-stats": async (tb, args) => (await import("./site-stats.mjs")).siteStatsTool(tb, args),
  "postiz-probe": async (tb, args) => (await import("./postiz-probe.mjs")).postizProbeTool(tb, args),
};

/** --- agent-cli --- The tools that need the engine (the whole toolbox bundle); the others run on the tool core alone. */
export const ENGINE_TOOLS = new Set(["modes", "simulate", "fingerprint", "preview", "render"]);

/** Runs one tool call: { ok, tool, result } or { ok: false, tool, error, usage? }. */
export async function runTool(name, rawArgs) {
  let core;
  try {
    core = await loadToolCore();
  } catch (e) {
    return { ok: false, tool: name, error: e instanceof Error ? e.message : String(e) };
  }
  const check = core.checkToolArgs(name, rawArgs);
  if (!check.ok) return { ok: false, tool: name, error: check.errors.join("; "), usage: true };
  const impl = TOOLS[name];
  if (!impl) return { ok: false, tool: name, error: `The tool ${name} has no runner in this CLI`, usage: true };
  try {
    // (a broken mode or engine fails these five only: guard, explain and analyse never load it)
    const tb = ENGINE_TOOLS.has(name) ? await loadToolbox() : core;
    return { ok: true, tool: name, result: await impl(tb, check.args) };
  } catch (e) {
    return { ok: false, tool: name, error: e instanceof Error ? e.message : String(e) };
  }
}

function helpText(tb) {
  return {
    usage: "npm run agent -- <tool> [--json '{…}'] [--pretty]",
    tools: tb.AGENT_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, writes: t.writes, ...(t.alsoWrites ? { alsoWrites: t.alsoWrites } : {}), network: t.network, input: t.input })),
    guide: "docs/agents/CLI.md",
  };
}

/** All of stdin as text. */
async function readStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
    if (parsed.stdin) parsed.args = parseArgsJson(await readStdin());
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ ok: false, tool: null, error: e.message, usage: true })}\n`, () => process.exit(2));
    return;
  }
  // The one line of JSON, then exit (a browser or a child the tool left behind never keeps the process alive).
  const finish = (value, code) => process.stdout.write(`${parsed.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`, () => process.exit(code));
  try {
    if (parsed.help || !parsed.tool) return finish({ ok: true, tool: null, result: helpText(await loadToolCore()) }, 0);
    // .agent-out/ (and its own .gitignore) exists before a tool that writes there runs – the guard writes its report into it
    if ((await loadToolCore()).toolSpec(parsed.tool)?.writes === ".agent-out") ensureOutDir();
  } catch (e) {
    // (an unsafe agent cache, a linked .agent-out: still the one JSON line, never a stack trace)
    return finish({ ok: false, tool: parsed.tool, error: e instanceof Error ? e.message : String(e) }, 1);
  }
  const out = await runTool(parsed.tool, parsed.args);
  finish(out, out.ok ? 0 : out.usage ? 2 : 1);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
