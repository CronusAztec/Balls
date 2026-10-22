import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { MODE_IDS } from "@/lib/physics/types";
import { defaultSettings } from "@/lib/settings";
import { AGENT_TOOLS } from "@/lib/agentKit/tools";
import { globToRegExp, kebabCase, matchesAny, type CoreConfig } from "@/lib/agentKit/guardPlan";
import type { ProtectedConfig } from "@/lib/agentKit/protectedDiff";
import { findBlockTitles } from "../scripts/smoke/shards.mjs";
import en from "../messages/en.json";

/*
 * --- agent-guide --- The agent guide stays true (AGENTS.md, CLAUDE.md, docs/agents/*.md, scripts/agent/core.json): every
 * npm script, agent tool, file path and smoke block it names exists; the counts it states are the code's; the 13 core
 * functions of core.json each own real files, are proven by tests on the guard's core list and have their section in
 * CORE.md; every registration point of MODES.md, filled in with Merge Ring's names, is in its file; the line budgets hold.
 * A rename anywhere fails here until the guide follows.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const exists = (file: string) => fs.existsSync(path.join(ROOT, file));

const GUIDE = ["AGENTS.md", "CLAUDE.md", "docs/agents/CORE.md", "docs/agents/MODES.md", "docs/agents/CLI.md"] as const;
const TEXT: Record<string, string> = Object.fromEntries(GUIDE.map((f) => [f, read(f)]));
const CORE = JSON.parse(read("scripts/agent/core.json")) as CoreConfig;
const PROTECTED = JSON.parse(read("scripts/agent/protected.json")) as ProtectedConfig;
const BLOCKS = findBlockTitles(read("scripts/smoke-test.mjs"));
const SCRIPTS = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

/** The repository's files: tracked and new, never ignored ones (git decides, as the guard does). */
const TREE: string[] = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .stdout.split("\n")
  .filter(Boolean)
  .filter((f) => exists(f)); // (a file deleted in the working tree is still in the index)
const BASENAMES = new Set(TREE.map((f) => path.posix.basename(f)));

/** The code spans of a Markdown text (any run of backticks; one padding space trimmed, as CommonMark does). */
function codeSpans(text: string): string[] {
  const out: string[] = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  for (const m of text.matchAll(re)) {
    let body = m[2].replace(/\n/g, " ");
    if (body.length > 2 && body.startsWith(" ") && body.endsWith(" ")) body = body.slice(1, -1);
    out.push(body);
  }
  return out;
}

/** Folders and files that are generated or git-ignored: named in the guide, never required to exist. */
const GENERATED = /^(\.agent-out|graphify-out|node_modules|out|\.next|smoke-output)(\/|$)/;

/**
 * Whether a code span names a repository path: a file (by its extension), or a folder or glob under a top-level entry of
 * the repository, written without placeholders. (`tools/list`, an MCP method, is not a path: no extension, no such folder.)
 */
function isPathSpan(span: string): boolean {
  if (/[\s<>…{}()=:$,'"]/.test(span) || GENERATED.test(span)) return false;
  if (!/^\.?[A-Za-z0-9_[\]][A-Za-z0-9_.\-[\]*/]*$/.test(span)) return false;
  if (/\.(md|json|ts|tsx|mjs|cjs|js|yml|yaml|toml|sh|webp|png)$/.test(span)) return true;
  return span.includes("/") && exists(span.split("/")[0]);
}

/** A path span resolves: a glob matches a file, a folder exists, a bare file name is somewhere in the tree. */
function resolves(span: string): boolean {
  if (span.includes("*")) return TREE.some((f) => globToRegExp(span.replace(/\/$/, "")).test(f));
  if (span.endsWith("/")) return fs.existsSync(path.join(ROOT, span)) && fs.statSync(path.join(ROOT, span)).isDirectory();
  if (!span.includes("/")) return exists(span) || BASENAMES.has(span);
  return exists(span);
}

/** One section of a Markdown text: from its heading line to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const at = text.indexOf(heading);
  expect(at, heading).toBeGreaterThanOrEqual(0);
  const level = /^#+/.exec(heading)![0].length;
  const rest = text.slice(at + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

describe("the agent guide names only things that exist (--- agent-guide ---)", () => {
  it("every npm script it names is a script of package.json", () => {
    for (const [file, text] of Object.entries(TEXT)) {
      const named = [...text.matchAll(/\bnpm run(?: -s)? ([a-z][\w:.-]*)/g)].map((m) => m[1]);
      if (file === "AGENTS.md") expect(named.length, file).toBeGreaterThan(8);
      for (const script of named) expect(Object.keys(SCRIPTS), `${file}: npm run ${script}`).toContain(script);
    }
  });

  it("every agent tool it names is one of the toolbox's, and AGENTS.md lists them all", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    for (const [file, text] of Object.entries(TEXT)) for (const m of text.matchAll(/\bagent -- ([a-z][\w-]*)/g)) expect(names, `${file}: agent -- ${m[1]}`).toContain(m[1]);
    for (const name of names) expect(TEXT["AGENTS.md"], name).toContain(`| \`${name}\` |`);
  });

  it("states what the MCP server exposes exactly: the tools marked mcp, and how to enable it", () => {
    const m = /The MCP server exposes (\d+) tools: ([\s\S]*?), each with its JSON Schema/.exec(TEXT["AGENTS.md"]);
    expect(m, "the MCP sentence").not.toBeNull();
    const mcp = AGENT_TOOLS.filter((t) => t.mcp).map((t) => t.name);
    expect(Number(m![1])).toBe(mcp.length);
    expect(codeSpans(m![2])).toEqual(mcp);
    for (const t of AGENT_TOOLS.filter((x) => !x.mcp)) expect(TEXT["AGENTS.md"]).toContain(`| \`${t.name}\` | Owner-run only`);
    const registered = JSON.parse(read(".mcp.json")) as { mcpServers: Record<string, { command: string; args: string[] }> };
    expect(Object.keys(registered.mcpServers)).toEqual(["jumpingballs-agent"]);
    expect(registered.mcpServers["jumpingballs-agent"]).toMatchObject({ command: "node", args: ["scripts/agent/mcp.mjs"] });
    for (const point of ["`.mcp.json`", "`jumpingballs-agent`", "`node scripts/agent/mcp.mjs`", "`npm run agent:mcp`"]) expect(TEXT["AGENTS.md"], point).toContain(point);
    expect(SCRIPTS["agent:mcp"]).toBe("node scripts/agent/mcp.mjs");
  });

  it("every file, folder and glob it names exists (generated folders aside)", () => {
    for (const [file, text] of Object.entries(TEXT)) {
      const paths = codeSpans(text).filter(isPathSpan);
      if (file !== "CLAUDE.md") expect(paths.length, file).toBeGreaterThan(5);
      for (const p of paths) expect(resolves(p), `${file}: \`${p}\``).toBe(true);
    }
    // the parser itself: it takes paths and globs, and leaves code, flags and placeholders alone
    expect(["src/lib/settings.ts", "messages/*.json", ".mcp.json", "desktop/", "package.json"].every(isPathSpan)).toBe(true);
    expect(["ctx.random()", "--plan", "tests/<id>.test.ts", ".only", "npm run guard", "/smoke", ".agent-out/guard-report.json", "tools/list"].some(isPathSpan)).toBe(false);
  });

  it("every smoke block it names is a block of the suite", () => {
    const wildcard = (b: string) => (b.includes("*") ? BLOCKS.some((x) => globToRegExp(b).test(x)) : BLOCKS.includes(b));
    for (const [file, text] of Object.entries(TEXT)) for (const m of text.matchAll(/SMOKE_ONLY=([\w*,-]+)/g)) for (const b of m[1].split(",")) expect(wildcard(b), `${file}: ${b}`).toBe(true);
    expect(BLOCKS).toContain("core-every-mode");
  });

  it("states the code's counts: the modes, the core functions, the locales", () => {
    for (const [file, text] of Object.entries(TEXT)) {
      for (const m of text.matchAll(/\b(\d+) modes\b/g)) expect(Number(m[1]), `${file}: ${m[0]}`).toBe(MODE_IDS.length);
      for (const m of text.matchAll(/\b(\d+) core functions\b/g)) expect(Number(m[1]), `${file}: ${m[0]}`).toBe(CORE.coreFunctions!.length);
    }
    expect(TEXT["AGENTS.md"]).toContain(`${MODE_IDS.length} modes`);
    const locales = fs.readdirSync(path.join(ROOT, "messages")).filter((f) => f.endsWith(".json")).sort();
    expect(locales).toEqual(["en.json", "es.json", "pl.json"]);
    expect(TEXT["AGENTS.md"]).toContain("three locales");
    for (const l of locales) expect(TEXT["AGENTS.md"]).toContain(`\`messages/${l}\``);
  });

  it("keeps to its line budgets, and CLAUDE.md imports AGENTS.md", () => {
    expect(TEXT["AGENTS.md"].split("\n").length).toBeLessThanOrEqual(250);
    expect(TEXT["CLAUDE.md"].split("\n").length).toBeLessThanOrEqual(60);
    expect(TEXT["CLAUDE.md"].split("\n")).toContain("@AGENTS.md");
    // the README's extension guide points at the checklist
    expect(section(read("README.md"), "### Add a game mode")).toContain("docs/agents/MODES.md");
  });

  it("protects itself: AGENTS.md, CLAUDE.md, core.json, protected.json and .mcp.json need owner review", () => {
    const globs = PROTECTED.paths.map((p) => p.glob);
    for (const f of ["AGENTS.md", "CLAUDE.md", "scripts/agent/core.json", "scripts/agent/protected.json", ".mcp.json"]) expect(matchesAny(f, globs), f).toBe(true);
    // every protected path and region names real files (a stale entry protects nothing)
    for (const p of PROTECTED.paths) expect(TREE.some((f) => globToRegExp(p.glob).test(f)), p.glob).toBe(true);
    for (const r of PROTECTED.regions) expect(TREE.some((f) => globToRegExp(r.file).test(f)), r.file).toBe(true);
  });
});

describe("the 13 core functions (scripts/agent/core.json, docs/agents/CORE.md; --- agent-guide ---)", () => {
  const functions = CORE.coreFunctions ?? [];
  const coreList = CORE.vitest.core.map((t) => t.file);

  it("are 13, each owning real files and proven by tests on the guard's core list and by real smoke blocks", () => {
    expect(functions).toHaveLength(13);
    expect(new Set(functions.map((f) => f.id)).size).toBe(functions.length);
    for (const f of functions) {
      expect(f.id, f.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(f.what.length, f.id).toBeGreaterThan(40);
      for (const g of f.code) expect(TREE.some((x) => globToRegExp(g).test(x)), `${f.id}: ${g}`).toBe(true);
      expect(f.tests.length, f.id).toBeGreaterThan(0);
      for (const t of f.tests) {
        expect(exists(t), `${f.id}: ${t}`).toBe(true);
        expect(coreList, `${f.id}: ${t} runs in tier 0`).toContain(t);
      }
      expect(f.smoke.length, f.id).toBeGreaterThan(0);
      for (const b of f.smoke) expect(BLOCKS, `${f.id}: ${b}`).toContain(b);
    }
  });

  it("cover the whole core list: every core test proves at least one function", () => {
    const claimed = new Set(functions.flatMap((f) => f.tests));
    expect(coreList.filter((t) => !claimed.has(t))).toEqual([]);
  });

  it("have their edit zones: free files no function owns, hub files guarded, protected.json protected", () => {
    const zones = CORE.editZones!;
    expect(Object.keys(zones).filter((k) => k !== "about").sort()).toEqual(["core", "free", "guarded", "protected"]);
    expect(zones.guarded.from).toBe("hubFiles");
    expect(CORE.hubFiles.length).toBeGreaterThan(5);
    expect(exists(zones.protected.from!)).toBe(true);
    for (const g of zones.free.examples ?? []) {
      const files = TREE.filter((f) => globToRegExp(g).test(f));
      expect(files.length, g).toBeGreaterThan(0);
      for (const f of files) {
        expect(matchesAny(f, CORE.hubFiles), f).toBe(false);
        expect(functions.some((c) => matchesAny(f, c.code)), f).toBe(false);
      }
    }
  });

  it("each have their section in CORE.md, in order, naming every file glob, test and smoke block", () => {
    const text = TEXT["docs/agents/CORE.md"];
    let last = -1;
    functions.forEach((f, i) => {
      const heading = `### ${i + 1}. ${f.title} (\`${f.id}\`)`;
      const at = text.indexOf(heading);
      expect(at, heading).toBeGreaterThan(last);
      last = at;
      const body = section(text, heading);
      for (const x of [...f.code, ...f.tests, ...f.smoke]) expect(body, `${f.id}: ${x}`).toContain(`\`${x}\``);
      // a block on tier 1's browser list says so, and only those
      for (const b of f.smoke) {
        const said = new RegExp(`\`${b}\`[^.;]*?\\((always in tier 1|tier 1 when touched)\\)`).exec(body)?.[1];
        expect(said, `${f.id}: ${b}`).toBe(CORE.browser.smoke.includes(b) ? "always in tier 1" : "tier 1 when touched");
      }
    });
    expect(text.match(/^### \d+\. /gm)).toHaveLength(functions.length);
  });
});

describe("the coded-mode checklist (docs/agents/MODES.md; --- agent-guide ---)", () => {
  // the placeholders, filled in with the reference mode's names (Merge Ring)
  const id = "mergeRing";
  const name = id[0].toUpperCase() + id.slice(1);
  const fill: Record<string, string> = {
    "<id>": id,
    "<Name>": name,
    "<NAME>": kebabCase(id).replace(/-/g, "_").toUpperCase(),
    "<px>": "mr",
    "<kebab>": kebabCase(id),
    "<Title>": (en as { Controls: Record<string, string> }).Controls[`mode${name}`],
  };
  const filled = (s: string) => Object.entries(fill).reduce((acc, [k, v]) => acc.split(k).join(v), s).replace(/\\\|/g, "|");
  const rows = TEXT["docs/agents/MODES.md"]
    .split("\n")
    .filter((l) => /^\| \d+ \|/.test(l))
    .map((l) => l.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim()));

  it("fills its placeholders from the code (the reference mode exists, with its prefix and title)", () => {
    expect(MODE_IDS as readonly string[]).toContain(id);
    expect(fill["<NAME>"]).toBe("MERGE_RING");
    expect(Object.keys(defaultSettings(id)).some((k) => /^mr[A-Z]/.test(k))).toBe(true);
    expect(fill["<Title>"]).toBe("Merge Ring");
  });

  it("numbers its registration points in order, each with a file, symbols, what to add and what catches a miss", () => {
    expect(rows.length).toBeGreaterThanOrEqual(24);
    rows.forEach((cells, i) => {
      expect(cells, cells.join(" | ")).toHaveLength(5);
      expect(Number(cells[0])).toBe(i + 1);
      expect(cells[3].length, cells[0]).toBeGreaterThan(10);
      expect(cells[4], cells[0]).toMatch(/^\*\*(typed|tested|partly|escalated|none)\*\*/);
    });
  });

  it("every point's file exists and holds every symbol it names, for the reference mode", () => {
    for (const [n, fileCell, lookCell] of rows) {
      const files = codeSpans(fileCell);
      expect(files, `row ${n}`).toHaveLength(1);
      const file = filled(files[0]);
      expect(exists(file), `row ${n}: ${file}`).toBe(true);
      const source = read(file);
      for (const span of codeSpans(lookCell)) expect(source, `row ${n}: ${file} holds ${filled(span)}`).toContain(filled(span));
    }
  });

  it("flags the points nothing enforces – the ones agents miss", () => {
    const caught = (symbol: string) => rows.find((r) => r[2].includes(symbol))?.[4] ?? "";
    for (const symbol of ["MODE_PREFIXES", "noteHud", "engine.set<Name>Settings(settings.<id> ?? {})", "write<Name>Params(settings, base, params)", "<id>: <id>SettingsOf(s)"]) {
      const row = rows.find((r) => r[2].includes(symbol));
      expect(row, symbol).toBeDefined();
      expect(caught(symbol), symbol).toMatch(/^\*\*none\*\*/);
    }
    expect(caught("BOUNCE_MATH_COLLIDE_MODES")).toMatch(/^\*\*partly\*\*/);
    expect(caught("`initMode(`")).toMatch(/^\*\*typed\*\*/);
  });
});
