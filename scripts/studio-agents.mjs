#!/usr/bin/env node
/**
 * --- studio --- Writes the Claude Code files of Claude's studio from the code, so they never drift from the crew's roles
 * (src/lib/crew/roles.ts) and the studio's loop (src/lib/agentKit/studioKit.ts studioAgentFiles):
 *  - .claude/agents/jbl-<role>.md: a subagent per crew role (researcher, brainstormer, skeptic, viewer, reviewer, producer),
 *    each limited to the review tool of the project's MCP server (the viewer also to Read, for the sheets it looks at), each
 *    fetching and answering one brief in a context of its own;
 *  - .claude/skills/jbl-make-video/SKILL.md: the make-video skill, the whole loop and its rules.
 *   npm run studio:agents               write them (only the files that changed)
 *   npm run studio:agents -- --check    exit 1 when one is not what the code generates
 * tests/studioAgents.test.ts fails while a file is stale. These are the only files it writes; they are protected
 * (scripts/agent/protected.json): a change to them needs owner review.
 */
import fs from "fs";
import path from "path";
import { loadStudioKit } from "./agent/bundle.mjs";
import { ROOT, isMainModule } from "./agent/paths.mjs";

async function main(argv) {
  const check = argv.includes("--check");
  const unknown = argv.filter((a) => a !== "--check");
  if (unknown.length) {
    process.stderr.write("usage: npm run studio:agents [-- --check]\n");
    return 2;
  }
  const kit = await loadStudioKit();
  const stale = [];
  for (const f of kit.studioAgentFiles()) {
    const file = path.join(ROOT, f.path);
    let current = null;
    try {
      current = fs.readFileSync(file, "utf8");
    } catch {
      current = null;
    }
    if (current === f.text) continue;
    stale.push(f.path);
    if (!check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, f.text);
      process.stdout.write(`wrote ${f.path}\n`);
    }
  }
  if (check) {
    process.stdout.write(stale.length ? `stale: ${stale.join(", ")}: run npm run studio:agents\n` : "the Claude Code subagents and the skill are current\n");
    return stale.length ? 1 : 0;
  }
  if (!stale.length) process.stdout.write("the Claude Code subagents and the skill are current\n");
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
