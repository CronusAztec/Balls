#!/usr/bin/env node
/**
 * --- agent-cli --- The agent toolbox as an MCP server (Model Context Protocol), for agents that take tools over MCP rather
 * than a shell. A thin, hand-written wrapper – no SDK, no new dependency: JSON-RPC 2.0 over stdio, one JSON message per
 * line (stdout carries only protocol messages; notes go to stderr). Registered for Claude Code in the project's .mcp.json
 * (Claude Code asks each user to approve a project server before it starts).
 *
 * Methods: initialize, ping, tools/list, tools/call, and the notifications initialized and cancelled.
 *
 * The tools are the CLI's (src/lib/agentKit/tools.ts AGENT_TOOLS, the entries marked `mcp`), each with its JSON Schema;
 * the owner-run commands (site-stats, postiz-probe) are not offered, nor a tool's CLI-only arguments (the guard's baseline).
 * A call runs exactly the CLI – `node scripts/agent/cli.mjs <tool> --json -` as a child process with an argument array (no
 * shell), the arguments on its stdin (a command line holds 128 KiB per argument on Linux, about 32K characters in all on
 * Windows) – so it keeps every CLI rule: arguments checked against the schema, paths confined to the repository, files
 * written only under .agent-out/, no network but the CLI's own localhost server, pictures and clips watermarked. The child
 * runs in a process group of its own: a cancelled or timed-out call, or a stopped server, stops it with everything it
 * started (the guard's tsc, ESLint and vitest workers, next build, ffmpeg; taskkill /T on Windows). There is no exec, shell
 * or file-write tool. A result is at most 200 KB of text; pictures and clips are returned as repository paths.
 *
 * .mcp.json starts it from whatever folder the session opened (desktop/, say): a one-line launcher finds the repository by
 * walking up to scripts/agent/mcp.mjs and calls startServer(). Only `node scripts/agent/mcp.mjs` (or that launcher) is a
 * client's command: `npm run agent:mcp` without `-s` prints npm's banner on stdout first.
 *
 * It loads only the tool core (bundle.mjs: the tool table and the argument checks, not the engine), so it starts while an
 * edit has broken a mode; should the tool core itself not build, it still answers initialize and tools/list (with the last
 * table that built) and every call says why it cannot run, until the file is fixed. A message line longer than the largest
 * arguments a call may pass is dropped unread, with an error, and stdin is split into lines without rescanning.
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadToolCore } from "./bundle.mjs";
import { ROOT, cacheDir, isMainModule } from "./paths.mjs";

export const SERVER_NAME = "jumpingballs-agent";
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const MAX_RESULT_CHARS = 200_000;
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.mjs");

const INSTRUCTIONS =
  "JumpingBallsLive's agent toolbox: modes, simulate, fingerprint, preview, render, site-shot, analyse, guard, explain. " +
  "Results are JSON; pictures and clips are written under .agent-out/ and returned as paths. Read AGENTS.md first; " +
  "never re-record a fingerprint (a moved one is a behaviour change to fix).";

/** A tool's input schema as offered over MCP: without its CLI-only arguments (tools.ts `cliOnly`). */
function withoutCliOnly(t) {
  const drop = new Set(t.cliOnly ?? []);
  return { ...t.input, properties: Object.fromEntries(Object.entries(t.input.properties ?? {}).filter(([k]) => !drop.has(k))) };
}

/** JSON-RPC error codes. */
export const ERR = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 };

/** The largest arguments a call may pass (JSON characters): explain's 200 000-character failure with room to spare. */
export const MAX_ARGS_CHARS = 1_000_000;
/** The longest message line read (characters): the largest arguments and the JSON-RPC envelope around them. */
export const MAX_LINE_CHARS = MAX_ARGS_CHARS + 64 * 1024;
/** How long a stopped call's process group has to end after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 3000;

/** The process groups (the CLI child's pid) of the calls that may still have something running: a stopped server ends them. */
const groups = new Set();

/** Ends a process group at once: the group on Linux and macOS (SIGKILL), the process tree on Windows (taskkill /T /F). */
function killGroup(pid, signal = "SIGKILL") {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    /* gone */
  }
}

/**
 * Stops a CLI child and everything it started: its process group on Linux and macOS – SIGTERM (the guard passes it on to its
 * lanes, Playwright closes its browser), then SIGKILL after a grace period – or its process tree on Windows.
 */
export function stopTree(child, graceMs = KILL_GRACE_MS) {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    killGroup(pid);
    groups.delete(pid);
    return;
  }
  killGroup(pid, "SIGTERM");
  const timer = setTimeout(() => {
    killGroup(pid, "SIGKILL");
    groups.delete(pid);
  }, graceMs);
  timer.unref?.();
}

/** Ends every process group a call of this server started and that may still run (the server is going away). */
export function stopAll() {
  for (const pid of groups) killGroup(pid, "SIGKILL");
  groups.clear();
}

/** Runs one CLI call as a child process: { ok, result | error } (`signal` aborts it, `timeoutMs` stops it). */
/**
 * @param {string} name
 * @param {any} args
 * @param {{ timeoutMs?: number, signal?: AbortSignal, cli?: string }} [options] (`cli`: another CLI script, for tests)
 * @returns {Promise<{ ok: boolean, result?: any, error?: string }>}
 */
export function runCliTool(name, args, { timeoutMs, signal, cli = CLI } = {}) {
  return new Promise((resolve) => {
    const json = JSON.stringify(args ?? {});
    if (json.length > MAX_ARGS_CHARS) return resolve({ ok: false, error: `the arguments are ${json.length} characters of JSON; at most ${MAX_ARGS_CHARS}` });
    let child;
    try {
      // its own process group (POSIX), so stopping it stops what it started; the arguments go on stdin, never the command line
      child = spawn(process.execPath, [cli, name, "--json", "-"], { cwd: ROOT, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    } catch (e) {
      return resolve({ ok: false, error: `the tool could not start: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (child.pid) groups.add(child.pid);
    let stopped = false;
    child.stdin.on("error", () => {}); // (a child that exits before reading them: its answer says why)
    child.stdin.end(json);
    let out = "";
    let err = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      stopped = true;
      stopTree(child);
      finish({ ok: false, error: "cancelled" });
    };
    const timer = setTimeout(() => {
      stopped = true;
      stopTree(child);
      finish({ ok: false, error: `the tool took longer than ${Math.round(timeoutMs / 1000)} s and was stopped` });
    }, timeoutMs ?? 120_000);
    signal?.addEventListener("abort", onAbort);
    // one UTF-8 decoder per stream: a character split between two 64 KB pipe reads stays whole (never U+FFFD)
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      if (out.length < 64 * 1024 * 1024) out += c;
    });
    child.stderr.on("data", (c) => {
      err = (err + c).slice(-4000);
    });
    child.on("error", (e) => finish({ ok: false, error: e.message }));
    child.on("close", () => {
      if (!stopped) groups.delete(child.pid); // (a stopped call's group keeps its SIGKILL to come)
      const line = out.trim().split("\n").pop() ?? "";
      try {
        finish(JSON.parse(line));
      } catch {
        finish({ ok: false, error: `the tool printed no result${err ? ` (${err.trim().split("\n").pop()})` : ""}` });
      }
    });
  });
}

/** The MCP result of a CLI answer: its JSON as text (and as structured content), at most MAX_RESULT_CHARS. */
/**
 * @param {{ ok: boolean, result?: any, error?: string }} answer
 * @returns {{ content: { type: "text", text: string }[], structuredContent?: any, isError: boolean }}
 */
export function toolResult(answer) {
  if (!answer.ok) return { content: [{ type: "text", text: String(answer.error ?? "failed") }], isError: true };
  const text = JSON.stringify(answer.result);
  if (text.length <= MAX_RESULT_CHARS) return { content: [{ type: "text", text }], structuredContent: answer.result, isError: false };
  return { content: [{ type: "text", text: `${text.slice(0, MAX_RESULT_CHARS)}… [cut at ${MAX_RESULT_CHARS} characters of ${text.length}; ask for less, e.g. one mode]` }], isError: false };
}

/**
 * The protocol, without the transport: `handle(message)` answers one JSON-RPC message (null for a notification). `tools` is
 * the tool table, `run(name, args, { timeoutMs, signal })` runs one (the CLI child by default), `check(name, args)` (the
 * toolbox's checkToolArgs) refuses arguments the schema does not allow before anything starts.
 */
/**
 * @param {{ tools: readonly { name: string, title: string, description: string, input: any, writes: string, mcp: boolean, cliOnly?: readonly string[], timeoutMs: number }[], version?: string, run?: (name: string, args: any, options: { timeoutMs: number, signal: AbortSignal }) => Promise<any>, check?: (name: string, args: any) => { ok: boolean, errors?: string[] }, notice?: string }} options
 * @returns {{ handle: (msg: any) => Promise<any>, offered: any[], cancelAll: () => void }}
 */
export function createMcpHandler({ tools, version = "0.0.0", run = runCliTool, check, notice }) {
  const offered = tools.filter((t) => t.mcp);
  const byName = new Map(offered.map((t) => [t.name, t]));
  const running = new Map();
  const reply = (id, result) => ({ jsonrpc: "2.0", id, result });
  const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  async function handle(msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return fail(msg && typeof msg === "object" && "id" in msg ? msg.id : null, ERR.invalidRequest, "Not a JSON-RPC 2.0 request");
    }
    const isRequest = "id" in msg && msg.id !== null && msg.id !== undefined;
    const params = msg.params && typeof msg.params === "object" ? msg.params : {};
    if (!isRequest) {
      if (msg.method === "notifications/cancelled") running.get(params.requestId)?.abort();
      return null; // notifications/initialized and any other notification: nothing to answer
    }
    switch (msg.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSIONS[0];
        return reply(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version },
          instructions: notice ? `${INSTRUCTIONS} ${notice}` : INSTRUCTIONS,
        });
      }
      case "ping":
        return reply(msg.id, {});
      case "tools/list":
        return reply(msg.id, {
          tools: offered.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: { ...withoutCliOnly(t), type: "object" },
            annotations: { title: t.title, readOnlyHint: t.writes === "none", destructiveHint: false, idempotentHint: t.writes === "none", openWorldHint: false },
          })),
        });
      case "tools/call": {
        const spec = typeof params.name === "string" ? byName.get(params.name) : undefined;
        if (!spec) return fail(msg.id, ERR.invalidParams, `Unknown tool "${params.name}" (the tools: ${offered.map((t) => t.name).join(", ")})`);
        const args = params.arguments ?? {};
        if (!args || typeof args !== "object" || Array.isArray(args)) return fail(msg.id, ERR.invalidParams, "arguments must be an object");
        const cliOnly = (spec.cliOnly ?? []).filter((k) => Object.hasOwn(args, k));
        if (cliOnly.length) return reply(msg.id, toolResult({ ok: false, error: `${cliOnly.join(", ")}: CLI only, not offered over MCP (a person runs \`npm run ${spec.name} -- --${cliOnly[0]}\` on purpose)` }));
        const checked = check?.(spec.name, args);
        if (checked && !checked.ok) return reply(msg.id, toolResult({ ok: false, error: (checked.errors ?? ["the arguments do not match the tool's schema"]).join("; ") }));
        const controller = new AbortController();
        running.set(msg.id, controller);
        try {
          const answer = await run(spec.name, args, { timeoutMs: spec.timeoutMs, signal: controller.signal });
          if (controller.signal.aborted) return null; // cancelled: no answer is sent
          return reply(msg.id, toolResult(answer));
        } finally {
          running.delete(msg.id);
        }
      }
      default:
        return fail(msg.id, ERR.methodNotFound, `Method not found: ${msg.method}`);
    }
  }

  return { handle, offered, cancelAll: () => [...running.values()].forEach((c) => c.abort()) };
}

/**
 * --- agent-cli --- Splits a text stream into lines without rescanning it: each chunk is searched for "\n" once and the pieces
 * of an unfinished line are kept in a list (joined once, at its end). A line longer than `maxChars` is dropped as it arrives –
 * up to its newline, never held whole or parsed – and reported once with `onOversize`.
 *
 * @param {{ maxChars: number, onLine: (line: string) => void, onOversize: (chars: number) => void }} options
 * @returns {{ push: (chunk: string) => void, end: () => void }}
 */
export function createLineReader({ maxChars, onLine, onOversize }) {
  let parts = [];
  let size = 0;
  let dropping = false;
  const reset = () => {
    parts = [];
    size = 0;
  };
  return {
    push(chunk) {
      let from = 0;
      for (let at = chunk.indexOf("\n"); at >= 0; at = chunk.indexOf("\n", from)) {
        const piece = chunk.slice(from, at);
        if (dropping) dropping = false;
        else if (size + piece.length > maxChars) onOversize(size + piece.length);
        else onLine(parts.length ? parts.join("") + piece : piece);
        reset();
        from = at + 1;
      }
      const rest = chunk.slice(from);
      if (!rest || dropping) return;
      if (size + rest.length > maxChars) {
        dropping = true;
        onOversize(size + rest.length);
        reset();
        return;
      }
      parts.push(rest);
      size += rest.length;
    },
    end() {
      if (!dropping && size) onLine(parts.join(""));
      dropping = false;
      reset();
    },
  };
}

/** The last tool table that built, in the agent cache: what tools/list offers while the tool core itself does not build. */
function lastToolTable(tools) {
  try {
    const file = path.join(cacheDir("bundle"), "tools.json");
    if (tools) fs.writeFileSync(file, JSON.stringify(tools));
    else return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* no cache (yet), or an unsafe one: nothing to offer from it */
  }
  return tools ?? [];
}

/** The tool core, or why it did not build (with the last table that did). */
async function toolTable() {
  try {
    const core = await loadToolCore();
    return { core, tools: lastToolTable(core.AGENT_TOOLS), error: null };
  } catch (e) {
    return { core: null, tools: lastToolTable(null), error: e instanceof Error ? e.message : String(e) };
  }
}

/** The stdio transport: a line in, a line out (the .mcp.json launcher calls this; so does `node scripts/agent/mcp.mjs`). */
export async function startServer() {
  let version = "0.0.0";
  try {
    version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  } catch {
    /* (a broken package.json: the server still answers) */
  }
  let table = await toolTable();
  const server = createMcpHandler({
    tools: table.tools,
    version,
    notice: table.error ? `The tool core did not build, so every call answers with its error until it does: ${table.error}` : undefined,
    check: (name, args) => (table.core ? table.core.checkToolArgs(name, args) : { ok: true }),
    run: async (name, args, options) => {
      if (!table.core) {
        // (the agent may have fixed the file since the server started)
        const again = await toolTable();
        if (!again.core) return { ok: false, error: again.error };
        table = again;
        const checked = table.core.checkToolArgs(name, args);
        if (!checked.ok) return { ok: false, error: checked.errors.join("; ") };
      }
      return runCliTool(name, args, options);
    },
  });
  const send = (message) => {
    if (message) process.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const pending = new Set();
  const onLine = (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: ERR.parse, message: "Parse error" } });
      return;
    }
    const work = (Array.isArray(msg) ? Promise.all(msg.map((m) => server.handle(m))).then((rs) => rs.filter(Boolean)).then((rs) => (rs.length ? rs : null)) : server.handle(msg))
      .then(send)
      .catch((e) => send({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: ERR.internal, message: e instanceof Error ? e.message : String(e) } }));
    pending.add(work);
    work.finally(() => pending.delete(work));
  };
  const reader = createLineReader({
    maxChars: MAX_LINE_CHARS,
    onLine,
    onOversize: (chars) => send({ jsonrpc: "2.0", id: null, error: { code: ERR.invalidRequest, message: `message too large: more than ${MAX_LINE_CHARS} characters (${chars} so far), dropped unread` } }),
  });
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => reader.push(chunk));
  process.stdin.on("end", async () => {
    reader.end();
    await Promise.allSettled([...pending]);
    // --- agent-cli --- once stdout is flushed: a pipe is written asynchronously, and an exit right away cuts an answer
    // past its first 64 KB
    process.stdout.write("", () => process.exit(0));
  });
  const stop = () => {
    server.cancelAll();
    process.exit(0);
  };
  process.on("exit", stopAll); // whichever way the server ends: the calls' process groups end with it
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stderr.write(`${SERVER_NAME} ${version}: ${server.offered.length} tools on stdio${table.error ? ` (the tool core did not build: ${table.error})` : ""}\n`);
}

const invoked = isMainModule(import.meta.url); // (--- agent-cli --- real paths: a start through a symbolic link runs too)
if (invoked) await startServer();
