#!/usr/bin/env node
/**
 * --- agent-cli --- The agent toolbox: eyes and hands for coding agents (and people) working on this repository.
 *
 *   npm run agent -- <tool> [--json '{…}'] [--pretty]
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
 * Rules every tool keeps (scripts/agent/paths.mjs): it writes only under .agent-out/ (and the agent cache outside the
 * repository); every path argument must resolve inside the repository; it never starts a shell (child processes get
 * argument arrays); it uses no network except the CLI's own localhost server for the browser tools – the browser is
 * fenced to it – and, for the two owner-run commands, the owner's own host they document. Pictures and clips carry the
 * watermark a free visitor's do: no tool installs a licence. docs/agents/CLI.md is the guide.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadToolbox } from "./bundle.mjs";
import { OUT_DIR, ROOT, ensureOutDir, repoRelative } from "./paths.mjs";

export class UsageError extends Error {}
export class ToolError extends Error {}

/** `<tool> [--json '{…}' | --json={…}] [--pretty]` → { tool, args, pretty, help }. */
export function parseArgv(argv) {
  const out = { tool: null, args: {}, pretty: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--pretty") out.pretty = true;
    else if (a === "--json" || a.startsWith("--json=")) {
      const text = a === "--json" ? argv[++i] : a.slice("--json=".length);
      if (text === undefined) throw new UsageError("--json needs a JSON object");
      let value;
      try {
        value = JSON.parse(text);
      } catch (e) {
        throw new UsageError(`--json is not valid JSON (${e.message})`);
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new UsageError("--json must be a JSON object");
      out.args = value;
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

async function explainTool(tb, args) {
  const facts = tb.testFilesIn(args.failure).map((file) => {
    const full = path.join(ROOT, file);
    const source = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
    return { file, readsAsText: tb.textReadsOf(source) };
  });
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

async function guardTool(_tb, args) {
  const cmd = guardCommand(readJson("package.json"), guardFlags(args));
  if (!cmd)
    return {
      available: false,
      message: `No core guard in this checkout: package.json has no plain \`guard\` script and ${GUARD_SCRIPT} is missing. Run npm run typecheck, npm run lint and the vitest files you touched.`,
    };
  const started = Date.now();
  process.stderr.write(`agent guard: ${cmd.shown}\n`);
  const { code, output } = await new Promise((resolve) => {
    const child = spawn(cmd.file, cmd.args, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let text = "";
    const keep = (chunk) => {
      text = (text + chunk.toString("utf8")).slice(-4 * TAIL_CHARS);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (e) => resolve({ code: null, output: `${text}\n${e.message}` }));
    child.on("close", (c) => resolve({ code: c, output: text }));
  });
  const reportFile = path.join(OUT_DIR, "guard-report.json");
  let report = null;
  try {
    if (fs.statSync(reportFile).mtimeMs >= started - 1000) report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
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

/** Runs one tool call: { ok, tool, result } or { ok: false, tool, error, usage? }. */
export async function runTool(name, rawArgs) {
  const tb = await loadToolbox();
  const check = tb.checkToolArgs(name, rawArgs);
  if (!check.ok) return { ok: false, tool: name, error: check.errors.join("; "), usage: true };
  const impl = TOOLS[name];
  if (!impl) return { ok: false, tool: name, error: `The tool ${name} has no runner in this CLI`, usage: true };
  try {
    return { ok: true, tool: name, result: await impl(tb, check.args) };
  } catch (e) {
    return { ok: false, tool: name, error: e instanceof Error ? e.message : String(e) };
  }
}

function helpText(tb) {
  return {
    usage: "npm run agent -- <tool> [--json '{…}'] [--pretty]",
    tools: tb.AGENT_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, writes: t.writes, network: t.network, input: t.input })),
    guide: "docs/agents/CLI.md",
  };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ ok: false, tool: null, error: e.message, usage: true })}\n`, () => process.exit(2));
    return;
  }
  // The one line of JSON, then exit (a browser or a child the tool left behind never keeps the process alive).
  const finish = (value, code) => process.stdout.write(`${parsed.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`, () => process.exit(code));
  if (parsed.help || !parsed.tool) return finish({ ok: true, tool: null, result: helpText(await loadToolbox()) }, 0);
  // .agent-out/ (and its own .gitignore) exists before a tool that writes there runs – the guard writes its report into it
  if ((await loadToolbox()).toolSpec(parsed.tool)?.writes === ".agent-out") ensureOutDir();
  const out = await runTool(parsed.tool, parsed.args);
  finish(out, out.ok ? 0 : out.usage ? 2 : 1);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
