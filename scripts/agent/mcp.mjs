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
 * walking up to scripts/agent/mcp.mjs and calls startServer().
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadToolbox } from "./bundle.mjs";
import { ROOT } from "./paths.mjs";

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
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean, result?: any, error?: string }>}
 */
export function runCliTool(name, args, { timeoutMs, signal } = {}) {
  return new Promise((resolve) => {
    const json = JSON.stringify(args ?? {});
    if (json.length > MAX_ARGS_CHARS) return resolve({ ok: false, error: `the arguments are ${json.length} characters of JSON; at most ${MAX_ARGS_CHARS}` });
    let child;
    try {
      // its own process group (POSIX), so stopping it stops what it started; the arguments go on stdin, never the command line
      child = spawn(process.execPath, [CLI, name, "--json", "-"], { cwd: ROOT, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
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
    child.stdout.on("data", (c) => {
      if (out.length < 64 * 1024 * 1024) out += c.toString("utf8");
    });
    child.stderr.on("data", (c) => {
      err = (err + c.toString("utf8")).slice(-4000);
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
 * @param {{ tools: readonly { name: string, title: string, description: string, input: any, writes: string, mcp: boolean, cliOnly?: readonly string[], timeoutMs: number }[], version?: string, run?: (name: string, args: any, options: { timeoutMs: number, signal: AbortSignal }) => Promise<any>, check?: (name: string, args: any) => { ok: boolean, errors?: string[] } }} options
 * @returns {{ handle: (msg: any) => Promise<any>, offered: any[], cancelAll: () => void }}
 */
export function createMcpHandler({ tools, version = "0.0.0", run = runCliTool, check }) {
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
          instructions: INSTRUCTIONS,
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
        if (cliOnly.length) return reply(msg.id, toolResult({ ok: false, error: `${cliOnly.join(", ")}: CLI only, not offered over MCP (run \`npm run ${spec.name} -- --${cliOnly[0]}\` yourself, on an untouched tree)` }));
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

/** The stdio transport: a line in, a line out (the .mcp.json launcher calls this; so does `node scripts/agent/mcp.mjs`). */
export async function startServer() {
  const tb = await loadToolbox();
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const server = createMcpHandler({ tools: tb.AGENT_TOOLS, version, check: tb.checkToolArgs });
  const send = (message) => {
    if (message) process.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const pending = new Set();
  let buffer = "";
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
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      onLine(line);
    }
  });
  process.stdin.on("end", async () => {
    if (buffer.trim()) onLine(buffer);
    await Promise.allSettled([...pending]);
    process.exit(0);
  });
  const stop = () => {
    server.cancelAll();
    process.exit(0);
  };
  process.on("exit", stopAll); // whichever way the server ends: the calls' process groups end with it
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stderr.write(`${SERVER_NAME} ${version}: ${server.offered.length} tools on stdio\n`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await startServer();
