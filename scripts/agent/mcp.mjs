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
 * the owner-run commands (site-stats, postiz-probe) are not offered. A call runs exactly the CLI –
 * `node scripts/agent/cli.mjs <tool> --json <arguments>` as a child process with an argument array (no shell) – so it
 * keeps every CLI rule: arguments checked against the schema, paths confined to the repository, files written only under
 * .agent-out/, no network but the CLI's own localhost server, pictures and clips watermarked. There is no exec, shell or
 * file-write tool. A result is at most 200 KB of text; pictures and clips are returned as repository paths.
 */
import { spawn } from "child_process";
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

/** JSON-RPC error codes. */
export const ERR = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 };

/** Runs one CLI call as a child process: { ok, result | error } (`signal` aborts it, `timeoutMs` stops it). */
/**
 * @param {string} name
 * @param {any} args
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean, result?: any, error?: string }>}
 */
export function runCliTool(name, args, { timeoutMs, signal } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, name, "--json", JSON.stringify(args ?? {})], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
      child.kill("SIGKILL");
      finish({ ok: false, error: "cancelled" });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
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
 * the tool table, `run(name, args, { timeoutMs, signal })` runs one (the CLI child by default).
 */
/**
 * @param {{ tools: readonly { name: string, title: string, description: string, input: object, writes: string, mcp: boolean, timeoutMs: number }[], version?: string, run?: (name: string, args: any, options: { timeoutMs: number, signal: AbortSignal }) => Promise<any> }} options
 * @returns {{ handle: (msg: any) => Promise<any>, offered: any[], cancelAll: () => void }}
 */
export function createMcpHandler({ tools, version = "0.0.0", run = runCliTool }) {
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
            inputSchema: { ...t.input, type: "object" },
            annotations: { title: t.title, readOnlyHint: t.writes === "none", destructiveHint: false, idempotentHint: t.writes === "none", openWorldHint: false },
          })),
        });
      case "tools/call": {
        const spec = typeof params.name === "string" ? byName.get(params.name) : undefined;
        if (!spec) return fail(msg.id, ERR.invalidParams, `Unknown tool "${params.name}" (the tools: ${offered.map((t) => t.name).join(", ")})`);
        const args = params.arguments ?? {};
        if (!args || typeof args !== "object" || Array.isArray(args)) return fail(msg.id, ERR.invalidParams, "arguments must be an object");
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

/** The stdio transport: a line in, a line out. */
async function main() {
  const tb = await loadToolbox();
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const server = createMcpHandler({ tools: tb.AGENT_TOOLS, version });
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
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stderr.write(`${SERVER_NAME} ${version}: ${server.offered.length} tools on stdio\n`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
