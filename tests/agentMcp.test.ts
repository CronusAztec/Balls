import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ERR, MAX_RESULT_CHARS, PROTOCOL_VERSIONS, SERVER_NAME, createMcpHandler, toolResult } from "../scripts/agent/mcp.mjs";
import { AGENT_TOOLS } from "@/lib/agentKit/tools";

// --- agent-cli --- The MCP wrapper (scripts/agent/mcp.mjs): JSON-RPC 2.0 over stdio, initialize / tools/list / tools/call /
// ping, the CLI's tools with their schemas (never the owner-run commands), a call's answer equal to the CLI's own.

const ROOT = path.resolve(__dirname, "..");
const MCP = path.join(ROOT, "scripts", "agent", "mcp.mjs");
const CLI = path.join(ROOT, "scripts", "agent", "cli.mjs");

type Message = { jsonrpc: string; id?: number | string | null; result?: Record<string, unknown>; error?: { code: number; message: string } };

/** Starts the server, writes `lines`, and resolves with every reply once `expected` replies (or a timeout) came back. */
function talk(lines: string[], expected: number, timeoutMs = 60_000): Promise<{ replies: Message[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
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

  it("keeps a result under 200 KB and marks a failed call as an error result", () => {
    const big = toolResult({ ok: true, result: { text: "x".repeat(MAX_RESULT_CHARS + 10) } });
    expect(big.content[0].text.length).toBeLessThan(MAX_RESULT_CHARS + 200);
    expect(big.content[0].text).toMatch(/cut at 200000 characters/);
    expect("structuredContent" in big).toBe(false);
    expect(toolResult({ ok: false, error: "no ffmpeg" })).toEqual({ content: [{ type: "text", text: "no ffmpeg" }], isError: true });
  });
});

describe("registration (--- agent-cli ---)", () => {
  it("is the project's MCP server for Claude Code and an npm script, next to the CLI; the guide names every tool", () => {
    const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers[SERVER_NAME]).toEqual({ type: "stdio", command: "node", args: ["scripts/agent/mcp.mjs"], env: {} });
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.agent).toBe("node scripts/agent/cli.mjs");
    expect(pkg.scripts["agent:mcp"]).toBe("node scripts/agent/mcp.mjs");
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@modelcontextprotocol/sdk");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("@modelcontextprotocol/sdk");
    const guide = fs.readFileSync(path.join(ROOT, "docs", "agents", "CLI.md"), "utf8");
    for (const t of AGENT_TOOLS) expect(guide, t.name).toContain(`| \`${t.name}\` |`);
  });
});
