import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "@/lib/agentKit/tools";
import { ACTIONS, BLUEPRINT_CATALOG_IDS, BLUEPRINT_DOCS_FILE, FINISH_KINDS, TRIGGERS, renderBlueprintDocs } from "@/lib/blueprint";

/*
 * --- blueprint --- docs/agents/BLUEPRINTS.md is generated from the code (src/lib/blueprint/docs.ts) and stays current: a
 * change to the vocabulary, a ceiling, the Lite form or a catalog entry fails here until `npm run blueprints:docs` rewrites
 * the guide. Like the agent guide (tests/agentDocs.test.ts), every command, script and path it names exists.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("blueprint guide (docs/agents/BLUEPRINTS.md)", () => {
  const committed = read(BLUEPRINT_DOCS_FILE);

  it("is exactly what the code generates (run npm run blueprints:docs after a change)", () => {
    const generated = renderBlueprintDocs();
    if (committed !== generated) {
      const a = committed.split("\n");
      const b = generated.split("\n");
      const at = a.findIndex((line, i) => line !== b[i]);
      expect({ firstDifferentLine: at + 1, committed: a[at], generated: b[at] }, "docs/agents/BLUEPRINTS.md is stale: run npm run blueprints:docs").toEqual({ firstDifferentLine: 0, committed: undefined, generated: undefined });
    }
    expect(committed).toBe(generated);
  }, 60_000);

  it("covers every trigger, action, finish and catalog entry", () => {
    for (const word of [...TRIGGERS, ...ACTIONS, ...FINISH_KINDS]) expect(committed, word).toContain(`| \`${word}\` |`);
    for (const id of BLUEPRINT_CATALOG_IDS) expect(committed, id).toContain(`(\`${id}\`)`);
  });

  it("names only real tools, scripts and files", () => {
    const tools = AGENT_TOOLS.map((t) => t.name);
    for (const m of committed.matchAll(/\bagent -- ([a-z][\w-]*)/g)) expect(tools, m[0]).toContain(m[1]);
    const scripts = Object.keys((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts);
    for (const m of committed.matchAll(/\bnpm run(?: -s)? ([a-z][\w:.-]*)/g)) expect(scripts, m[0]).toContain(m[1]);
    for (const m of committed.matchAll(/`((?:src|tests|scripts|docs)\/[\w./-]+?)`/g)) expect(fs.existsSync(path.join(ROOT, m[1].replace(/\/$/, ""))), m[1]).toBe(true);
    for (const t of ["bp-schema", "bp-validate", "bp-check", "bp-link"]) expect(committed, t).toContain(`agent -- ${t}`);
  });
});
