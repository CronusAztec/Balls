import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import os from "os";
import { ERR, MAX_LINE_CHARS, MAX_RESULT_CHARS, PROTOCOL_VERSIONS, SERVER_NAME, createLineReader, createMcpHandler, runCliTool, stopTree, toolResult } from "../scripts/agent/mcp.mjs";
import { AGENT_TOOLS, checkToolArgs } from "@/lib/agentKit/tools";

// --- agent-cli --- The MCP wrapper (scripts/agent/mcp.mjs): JSON-RPC 2.0 over stdio, initialize / tools/list / tools/call /
// ping, the CLI's tools with their schemas (never the owner-run commands), a call's answer equal to the CLI's own.

const ROOT = path.resolve(__dirname, "..");
const MCP = path.join(ROOT, "scripts", "agent", "mcp.mjs");
const CLI = path.join(ROOT, "scripts", "agent", "cli.mjs");

type Message = { jsonrpc: string; id?: number | string | null; result?: Record<string, unknown>; error?: { code: number; message: string } };

/** The server as .mcp.json starts it (Claude Code spawns it in the session's folder, which may be a subfolder). */
const REGISTERED = (JSON.parse(fs.readFileSync(path.join(ROOT, ".mcp.json"), "utf8")) as { mcpServers: Record<string, { command: string; args: string[] }> }).mcpServers[SERVER_NAME];

/** Starts the server, writes `lines`, and resolves with every reply once `expected` replies (or a timeout) came back. */
function talk(lines: string[], expected: number, timeoutMs = 60_000, start: { args: string[]; cwd: string } = { args: [MCP], cwd: ROOT }): Promise<{ replies: Message[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, start.args, { cwd: start.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const replies: Message[] = [];
    let out = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`only ${replies.length} of ${expected} replies: ${out} ${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (c) => {
      out += c.toString("utf8");
      let at;
      while ((at = out.indexOf("\n")) >= 0) {
        replies.push(JSON.parse(out.slice(0, at)));
        out = out.slice(at + 1);
      }
      if (replies.length >= expected) {
        clearTimeout(timer);
        child.stdin.end();
        child.kill();
        resolve({ replies, stderr });
      }
    });
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    for (const line of lines) child.stdin.write(`${line}\n`);
  });
}

describe("the MCP wrapper over stdio (--- agent-cli ---)", () => {
  it("answers initialize, tools/list, tools/call and ping – a call gives exactly the CLI's result", async () => {
    const simulateArgs = { mode: "spiralGlass", seed: 12345, seconds: 10 };
    const { replies, stderr } = await talk(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1" } } }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "simulate", arguments: simulateArgs } }),
        JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" }),
        JSON.stringify({ jsonrpc: "2.0", id: 5, method: "resources/list" }),
        "this is not json",
        JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "site-stats", arguments: {} } }),
        JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "analyse", arguments: { path: "https://example.com/a.mp4" } } }),
      ],
      8,
    );
    const byId = new Map(replies.map((r) => [r.id, r]));
    expect(byId.get(1)?.result).toEqual({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: SERVER_NAME, version: expect.any(String) }, instructions: expect.stringMatching(/AGENTS\.md/) });
    const tools = (byId.get(2)?.result?.tools ?? []) as { name: string; inputSchema: { type: string }; description: string }[];
    expect(tools.map((t) => t.name)).toEqual(AGENT_TOOLS.filter((t) => t.mcp).map((t) => t.name));
    expect(tools.map((t) => t.name)).toEqual(["modes", "simulate", "fingerprint", "preview", "render", "site-shot", "analyse", "guard", "explain"]);
    for (const t of tools) expect(t.inputSchema.type, t.name).toBe("object");
    // the call is the CLI: the same JSON, as text and as structured content
    const cli = spawnSync(process.execPath, [CLI, "simulate", "--json", JSON.stringify(simulateArgs)], { cwd: ROOT, encoding: "utf8" });
    const cliResult = JSON.parse(cli.stdout).result;
    const call = byId.get(3)?.result as { content: { type: string; text: string }[]; structuredContent: unknown; isError: boolean };
    expect(call.isError).toBe(false);
    expect(call.structuredContent).toEqual(cliResult);
    expect(call.content[0]).toEqual({ type: "text", text: JSON.stringify(cliResult) });
    expect(byId.get(4)?.result).toEqual({});
    expect(byId.get(5)?.error?.code).toBe(ERR.methodNotFound);
    expect(byId.get(null)?.error?.code).toBe(ERR.parse);
    expect(byId.get(6)?.error).toMatchObject({ code: ERR.invalidParams, message: expect.stringMatching(/Unknown tool "site-stats"/) });
    expect(byId.get(7)?.result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/never fetch/) }] });
    // stdout carries only protocol messages
    expect(replies.every((r) => r.jsonrpc === "2.0")).toBe(true);
    expect(stderr).toMatch(/9 tools on stdio/);
  }, 120_000);
});

describe("the MCP wrapper's limits and its children (--- agent-cli ---)", () => {
  it("passes long arguments on stdin: an explain call far past a command line's limit answers, never spawn E2BIG", async () => {
    const long = `FAIL tests/zip.test.ts > crc\n${"x".repeat(140_000)}`;
    const wide = `FAIL tests/zip.test.ts > crc\n${"é".repeat(70_000)}`;
    const { replies } = await talk(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "explain", arguments: { failure: long } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "explain", arguments: { failure: wide } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "explain", arguments: { failure: "y".repeat(200_001) } } }),
      ],
      3,
    );
    const byId = new Map(replies.map((r) => [r.id, r]));
    for (const id of [1, 2]) {
      expect(byId.get(id)?.error, `call ${id}`).toBeUndefined();
      expect(byId.get(id)?.result, `call ${id}`).toMatchObject({ isError: false, structuredContent: { files: [expect.objectContaining({ file: "tests/zip.test.ts" })] } });
    }
    // past the schema's own limit: refused before anything starts, as an error result
    expect(byId.get(3)?.result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/at most 200000 characters/) }] });
  }, 120_000);

  it("refuses arguments the schema does not allow before it starts the CLI", async () => {
    const started: string[] = [];
    const h = createMcpHandler({ tools: [...AGENT_TOOLS], check: checkToolArgs, run: async (name: string) => (started.push(name), { ok: true, result: {} }) });
    const bad = await h.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "simulate", arguments: { mode: "classic", constructor: 1 } } });
    expect(bad?.result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/unknown field "constructor"/) }] });
    expect(started).toEqual([]);
  });

  it("stops a call's whole process group: the CLI and everything it started", async () => {
    // a stand-in CLI that starts a grandchild and ignores SIGTERM, as a busy guard lane might
    const script = 'const { spawn } = require("child_process"); process.on("SIGTERM", () => {}); const g = spawn(process.execPath, ["-e", "process.on(\'SIGTERM\', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(g.pid); setInterval(() => {}, 1000);';
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"], detached: true });
    const grandchild = await new Promise<number>((resolve) => child.stdout.once("data", (d) => resolve(Number(String(d).trim()))));
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive(child.pid!) && alive(grandchild)).toBe(true);
    stopTree(child, 200);
    const until = Date.now() + 10_000;
    while ((alive(child.pid!) || alive(grandchild)) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    expect(alive(grandchild), "the grandchild").toBe(false);
    expect(alive(child.pid!), "the CLI").toBe(false);
  }, 20_000);

  it("starts from a subfolder of the repository, as Claude Code does in a session opened in desktop/", async () => {
    expect(REGISTERED.command).toBe("node");
    const { replies, stderr } = await talk([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })], 1, 60_000, { args: REGISTERED.args, cwd: path.join(ROOT, "desktop") });
    expect(replies[0]?.result).toMatchObject({ serverInfo: { name: SERVER_NAME } });
    expect(stderr).toMatch(/9 tools on stdio/);
  }, 60_000);
});

describe("the MCP protocol handler (--- agent-cli ---)", () => {
  const tools = [...AGENT_TOOLS];

  it("negotiates the protocol version, answers nothing to notifications and refuses bad requests", async () => {
    const h = createMcpHandler({ tools, version: "9.9.9", run: async () => ({ ok: true, result: {} }) });
    expect((await h.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }))?.result?.protocolVersion).toBe("2024-11-05");
    expect((await h.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }))?.result?.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    expect(await h.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await h.handle({ id: 1, method: "ping" }))?.error?.code).toBe(ERR.invalidRequest);
    expect((await h.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "simulate", arguments: [1] } }))?.error?.code).toBe(ERR.invalidParams);
    expect((await h.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "postiz-probe" } }))?.error?.code).toBe(ERR.invalidParams);
  });

  it("passes a call to the CLI with the tool's own time limit, and drops the answer of a cancelled call", async () => {
    const seen: { name: string; args: unknown; timeoutMs: number }[] = [];
    let release: () => void = () => {};
    const h = createMcpHandler({
      tools,
      run: (name: string, args: unknown, o: { timeoutMs: number; signal: AbortSignal }) => {
        seen.push({ name, args, timeoutMs: o.timeoutMs });
        return new Promise((resolve) => {
          release = () => resolve({ ok: true, result: { done: true } });
          o.signal.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }));
        });
      },
    });
    const pending = h.handle({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "render", arguments: { mode: "classic" } } });
    expect(seen).toEqual([{ name: "render", args: { mode: "classic" }, timeoutMs: AGENT_TOOLS.find((t) => t.name === "render")?.timeoutMs }]);
    expect(await h.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9 } })).toBeNull();
    expect(await pending).toBeNull();
    const next = h.handle({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "modes", arguments: {} } });
    release();
    expect((await next)?.result).toEqual({ content: [{ type: "text", text: '{"done":true}' }], structuredContent: { done: true }, isError: false });
  });

  it("never offers or runs the guard's baseline: recording one is a person's step on an untouched tree, CLI only", async () => {
    const seen: unknown[] = [];
    const h = createMcpHandler({ tools, run: async (_name: string, args: unknown) => (seen.push(args), { ok: true, result: {} }) });
    const listed = ((await h.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }))?.result?.tools ?? []) as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
    const guard = listed.find((t) => t.name === "guard")!;
    expect(Object.keys(guard.inputSchema.properties).sort()).toEqual(["browser", "plan", "withSlow"]);
    expect(AGENT_TOOLS.find((t) => t.name === "guard")?.input.properties).toHaveProperty("baseline"); // the CLI keeps it
    const refused = await h.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "guard", arguments: { baseline: true } } });
    expect(refused?.result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/baseline: CLI only/) }] });
    expect(seen).toEqual([]);
    await h.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "guard", arguments: { plan: true } } });
    expect(seen).toEqual([{ plan: true }]);
  });

  it("never offers or runs the guard's base either: base HEAD would hide every committed weakened test and re-recorded fingerprint", async () => {
    const seen: unknown[] = [];
    const h = createMcpHandler({ tools, check: checkToolArgs, run: async (_name: string, args: unknown) => (seen.push(args), { ok: true, result: {} }) });
    for (const args of [{ plan: true, base: "HEAD" }, { base: "main" }]) {
      const refused = await h.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "guard", arguments: args } });
      expect(refused?.result, JSON.stringify(args)).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/base: CLI only, not offered over MCP/) }] });
    }
    expect(seen).toEqual([]);
    expect(AGENT_TOOLS.find((t) => t.name === "guard")?.cliOnly).toEqual(["baseline", "base"]);
    expect(checkToolArgs("guard", { plan: true, base: "HEAD" }).ok).toBe(true); // (the CLI keeps it, for a person)
  });

  it("keeps a result under 200 KB and marks a failed call as an error result", () => {
    const big = toolResult({ ok: true, result: { text: "x".repeat(MAX_RESULT_CHARS + 10) } });
    expect(big.content[0].text.length).toBeLessThan(MAX_RESULT_CHARS + 200);
    expect(big.content[0].text).toMatch(/cut at 200000 characters/);
    expect("structuredContent" in big).toBe(false);
    expect(toolResult({ ok: false, error: "no ffmpeg" })).toEqual({ content: [{ type: "text", text: "no ffmpeg" }], isError: true });
  });
});

describe("the MCP wrapper's transport (--- agent-cli ---)", () => {
  it("splits stdin into lines without rescanning, and drops a line past the limit unread, the next lines still read", () => {
    const lines: string[] = [];
    const big: number[] = [];
    const r = createLineReader({ maxChars: 10, onLine: (l) => lines.push(l), onOversize: (n) => big.push(n) });
    r.push('{"a"');
    r.push(":1}\n{}\n");
    r.push("x".repeat(8));
    r.push("y".repeat(8)); // past 10 characters: dropped as it arrives, reported once
    r.push("z".repeat(50));
    r.push('zz\n{"b":2}\n0123456789AB\n');
    r.push("tail");
    r.end();
    expect(lines).toEqual(['{"a":1}', "{}", '{"b":2}', "tail"]);
    expect(big).toEqual([16, 12]);
    expect(MAX_LINE_CHARS).toBeGreaterThan(1_000_000);
  });

  it("answers a message past the limit with an error, without parsing it, and keeps answering the next ones", async () => {
    const huge = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "explain", arguments: { failure: "x".repeat(MAX_LINE_CHARS) } } });
    const t0 = Date.now();
    const { replies } = await talk([huge, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })], 2);
    expect(replies[0]).toMatchObject({ id: null, error: { code: ERR.invalidRequest, message: expect.stringMatching(/message too large/) } });
    expect(replies[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    expect(Date.now() - t0).toBeLessThan(30_000);
  }, 60_000);

  it("decodes the CLI's output as one UTF-8 stream: a character split between two 64 KB pipe reads stays whole", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-mcp-utf8-"));
    try {
      // a stand-in CLI: one result line of 1.6 MB of en dashes, crosses and arrows (3 bytes each), after an odd prefix
      const stub = path.join(dir, "cli.mjs");
      fs.writeFileSync(stub, 'const notes = Array.from({ length: 20000 }, (_, i) => `note ${i} – the lane × failed ❯ “quoted”`);\nprocess.stdout.write(JSON.stringify({ ok: true, result: { pad: "a", notes } }) + "\\n");\n');
      const answer = await runCliTool("guard", {}, { cli: stub, timeoutMs: 60_000 });
      expect(answer.ok).toBe(true);
      const text = JSON.stringify(answer.result);
      expect(text.length).toBeGreaterThan(64 * 1024 * 10);
      expect(text).not.toContain("\uFFFD");
      expect(answer.result.notes[12475]).toBe("note 12475 – the lane × failed ❯ “quoted”");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("starts, lists its tools and runs explain while the engine does not build; says why the engine's tools cannot run", async () => {
    // a copy of the toolbox without src/lib/physics (as when an edit breaks the engine or a mode): the full toolbox cannot
    // build, the tool core can
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-mcp-broken-"));
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-mcp-cache-"));
    try {
      for (const d of ["scripts/agent", "src/lib/agentKit", "src/lib/videoAnalysis"]) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
      for (const f of ["package.json", "src/lib/desktop/ai/jsonSchema.ts", "src/lib/audio/beats.ts"]) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
      }
      fs.mkdirSync(path.join(dir, "tests"));
      fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
      const env = { ...process.env, JBL_AGENT_CACHE: cache };
      const lines = [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "explain", arguments: { failure: "FAIL tests/zip.test.ts > crc\nexpected 1 to be 2" } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "simulate", arguments: { mode: "classic", seconds: 1 } } }),
      ];
      const first = await serve(path.join(dir, "scripts/agent/mcp.mjs"), dir, env, lines, 4);
      const byId = new Map(first.map((r) => [r.id, r]));
      expect(byId.get(1)?.result).toMatchObject({ serverInfo: { name: SERVER_NAME } });
      expect(((byId.get(2)?.result?.tools ?? []) as unknown[]).length).toBe(9);
      expect(byId.get(3)?.result).toMatchObject({ isError: false, structuredContent: { kind: "behaviour" } });
      expect(byId.get(4)?.result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/did not build/) }] });
      // the tool core itself broken: initialize and tools/list (the last table that built) still answer, a call says why
      fs.appendFileSync(path.join(dir, "src/lib/agentKit/tools.ts"), "\nexport const broken = ;\n");
      const second = await serve(path.join(dir, "scripts/agent/mcp.mjs"), dir, env, lines, 4);
      const again = new Map(second.map((r) => [r.id, r]));
      expect(again.get(1)?.result).toMatchObject({ serverInfo: { name: SERVER_NAME }, instructions: expect.stringMatching(/tool core did not build/) });
      expect(((again.get(2)?.result?.tools ?? []) as unknown[]).length).toBe(9);
      expect(again.get(3)?.result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/tools\.ts:\d+:\d+/) }] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(cache, { recursive: true, force: true });
    }
  }, 120_000);
});

/** Starts a server script with its own folder and environment, writes `lines`, resolves with `expected` replies. */
function serve(script: string, cwd: string, env: NodeJS.ProcessEnv, lines: string[], expected: number): Promise<Message[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const replies: Message[] = [];
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`only ${replies.length} of ${expected} replies: ${out} ${err}`));
    }, 100_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      out += c;
      let at;
      while ((at = out.indexOf("\n")) >= 0) {
        replies.push(JSON.parse(out.slice(0, at)));
        out = out.slice(at + 1);
      }
      if (replies.length >= expected) {
        clearTimeout(timer);
        child.stdin.end();
        child.kill();
        resolve(replies);
      }
    });
    child.stderr.on("data", (c) => (err += c));
    for (const line of lines) child.stdin.write(`${line}\n`);
  });
}

describe("registration (--- agent-cli ---)", () => {
  it("is the project's MCP server for Claude Code and an npm script, next to the CLI; the guide names every tool", () => {
    const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, ".mcp.json"), "utf8"));
    // a launcher that finds the repository from any folder of it (no cwd-relative script path), then the server's startServer()
    expect(mcp.mcpServers[SERVER_NAME]).toEqual({ type: "stdio", command: "node", args: ["--input-type=module", "-e", expect.stringContaining("scripts/agent/mcp.mjs")], env: {} });
    expect(mcp.mcpServers[SERVER_NAME].args[2]).toMatch(/process\.cwd\(\)[\s\S]*path\.dirname\(dir\)[\s\S]*\.startServer\(\)/);
    expect(mcp.mcpServers[SERVER_NAME].args[2]).not.toMatch(/["`$]/); // (no shell, no quoting, nothing Claude Code would expand)
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.agent).toBe("node scripts/agent/cli.mjs");
    expect(pkg.scripts["agent:mcp"]).toBe("node scripts/agent/mcp.mjs");
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@modelcontextprotocol/sdk");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("@modelcontextprotocol/sdk");
    const guide = fs.readFileSync(path.join(ROOT, "docs", "agents", "CLI.md"), "utf8");
    for (const t of AGENT_TOOLS) expect(guide, t.name).toContain(`| \`${t.name}\` |`);
  });
});
