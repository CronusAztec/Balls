import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, MCP_SERVER_NAME } from "@/lib/agentKit/tools";
import { STUDIO_AGENT_TOOL, STUDIO_SKILL_NAME, studioAgentFiles, studioAgentName } from "@/lib/agentKit/studioKit";
import { matchesAny } from "@/lib/agentKit/guardPlan";
import { CREW_ROLES, FIX_ACTIONS, ROLE_SPECS, protocolOf } from "@/lib/crew";

/*
 * --- studio --- The Claude Code files of Claude's studio (C6 of the AI studio plan): a subagent per crew role
 * (.claude/agents/jbl-<role>.md) and the make-video skill (.claude/skills/jbl-make-video/SKILL.md) are generated from the crew's
 * roles by npm run studio:agents (scripts/studio-agents.mjs) and stay current; each subagent may call only the project MCP
 * server's review tool (the viewer also Read, for the sheets it looks at), carries its role's card and answer shape word for
 * word, and answers one brief; the skill names only real tools, scripts, subagents and files; both are protected paths.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const FILES = studioAgentFiles();

/** A generated file's front matter (name, description, tools, model) and its body. */
function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  expect(m).not.toBeNull();
  const fields: Record<string, string> = {};
  for (const line of m![1].split("\n")) {
    const kv = /^([a-z]+): (.*)$/.exec(line);
    expect(kv, line).not.toBeNull();
    let v = kv![2];
    if (v.startsWith("'")) {
      expect(v.endsWith("'"), line).toBe(true);
      v = v.slice(1, -1).replace(/''/g, "'");
      expect(/(^|[^'])'([^']|$)/.test(kv![2].slice(1, -1)), `${line}: a lone quote ends YAML's single-quoted string`).toBe(false);
    }
    fields[kv![1]] = v;
  }
  return { fields, body: m![2] };
}

describe("the Claude Code subagents and the make-video skill (--- studio ---)", () => {
  it("are exactly what npm run studio:agents generates", () => {
    expect(FILES.map((f) => f.path)).toEqual([...CREW_ROLES.map((r) => `.claude/agents/jbl-${r}.md`), `.claude/skills/${STUDIO_SKILL_NAME}/SKILL.md`]);
    for (const f of FILES) {
      expect(fs.existsSync(path.join(ROOT, f.path)), `${f.path} is missing: run npm run studio:agents`).toBe(true);
      expect(read(f.path) === f.text, `${f.path} is stale: run npm run studio:agents`).toBe(true);
    }
    // no other crew file lingers beside them (a renamed or removed role's)
    const agents = fs.readdirSync(path.join(ROOT, ".claude", "agents")).filter((f) => f.startsWith("jbl-"));
    expect(agents.sort()).toEqual(CREW_ROLES.map((r) => `jbl-${r}.md`).sort());
  });

  it("give each role a subagent of its own that may call only the review tool (the viewer also Read), on the same model", () => {
    expect(STUDIO_AGENT_TOOL).toBe(`mcp__${MCP_SERVER_NAME}__review`);
    const mcp = JSON.parse(read(".mcp.json")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(mcp.mcpServers)).toContain(MCP_SERVER_NAME);
    const review = AGENT_TOOLS.find((t) => t.name === "review")!;
    expect([review.mcp, review.network]).toEqual([true, "none"]);
    for (const role of CREW_ROLES) {
      const f = FILES.find((x) => x.path === `.claude/agents/${studioAgentName(role)}.md`)!;
      const { fields, body } = frontMatter(f.text);
      expect(Object.keys(fields)).toEqual(["name", "description", "tools", "model"]);
      expect(fields.name).toBe(`jbl-${role}`);
      expect(fields.model).toBe("inherit");
      const tools = fields.tools.split(",").map((t) => t.trim());
      expect([role, tools]).toEqual([role, role === "viewer" ? [STUDIO_AGENT_TOOL, "Read"] : [STUDIO_AGENT_TOOL]]);
      // the role's own card and answer shape, word for word (the app's crew reads the same)
      expect(body).toContain(ROLE_SPECS[role].card);
      expect(body).toContain(protocolOf(role));
      if (role === "reviewer") for (const fix of Object.values(FIX_ACTIONS)) expect(body).toContain(`- ${fix.id}`);
      // one brief a run, never another role's, no file written
      expect(body).toContain("Stop after one accepted answer");
      expect(body).toContain(`If \`next.role\` is not "${role}"`);
      expect(body).toMatch(/Never write a file, render, run a command, edit the repository/);
      expect(fields.description).toContain(`the ${role}`);
      expect(fields.description).toContain(STUDIO_SKILL_NAME);
    }
    // the cold viewer is not told who made the clips
    const viewer = frontMatter(FILES.find((x) => x.path.endsWith("jbl-viewer.md"))!.text).body;
    expect(viewer).not.toContain("JumpingBallsLive");
    expect(viewer).toContain("never learns what the maker meant");
  });

  it("has a skill that names only real tools, scripts, subagents and files, and states the rules", () => {
    const skill = FILES.find((f) => f.path.endsWith("SKILL.md"))!;
    const { fields, body } = frontMatter(skill.text);
    expect(Object.keys(fields)).toEqual(["name", "description"]);
    expect(fields.name).toBe(STUDIO_SKILL_NAME);
    const tools = AGENT_TOOLS.map((t) => t.name);
    const named = [...body.matchAll(/\bagent -- ([a-z][\w-]*)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(5);
    for (const t of named) expect(tools, `agent -- ${t}`).toContain(t);
    for (const t of ["research", "templates", "plan", "review", "render"]) expect(named).toContain(t);
    const scripts = Object.keys((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts);
    for (const m of body.matchAll(/\bnpm run(?: -s)? ([a-z][\w:.-]*)/g)) expect(scripts, m[0]).toContain(m[1]);
    for (const m of body.matchAll(/`(jbl-[a-z-]+)`/g)) expect(CREW_ROLES.map(studioAgentName), m[1]).toContain(m[1]);
    for (const role of CREW_ROLES) expect(body).toContain(`\`${studioAgentName(role)}\``);
    for (const m of body.matchAll(/`((?:docs|src|tests|scripts)\/[\w./-]+|AGENTS\.md)`/g)) expect(fs.existsSync(path.join(ROOT, m[1])), m[1]).toBe(true);
    for (const m of body.matchAll(/`(mcp__[\w-]+__[\w-]+)`/g)) expect(m[1]).toBe(STUDIO_AGENT_TOOL);
    // the rules: the watermark, no licence, .agent-out only, one fix round, never push or post
    for (const rule of ["carries the watermark", "Never install or use a licence", "only under `.agent-out/`", "one fix round and never a second", "Never push and never post"]) expect(body).toContain(rule);
  });

  it("are protected paths (owner review), and git keeps them (no ignore rule hides them)", () => {
    const globs = (JSON.parse(read("scripts/agent/protected.json")) as { paths: { glob: string }[] }).paths.map((p) => p.glob);
    for (const f of FILES) expect([f.path, matchesAny(f.path, globs)]).toEqual([f.path, true]);
    const ignore = read(".gitignore");
    expect(/^\/?\.claude\/?$/m.test(ignore)).toBe(false);
  });
});
