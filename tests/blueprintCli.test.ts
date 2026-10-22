import { spawnSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";
import { BLUEPRINT_TOOLS, ENGINE_TOOLS } from "../scripts/agent/cli.mjs";
import { BLUEPRINTKIT_ENTRY, TOOLCORE_ENTRY } from "../scripts/agent/bundle.mjs";
import { AGENT_TOOLS, BLUEPRINT_INPUT_TOOLS, checkToolArgs } from "@/lib/agentKit/tools";
import { blueprintInput } from "@/lib/agentKit/blueprintKit";
import { BLUEPRINT_CATALOG_IDS, catalogBlueprint, decodeBlueprint, encodeBlueprint, sanitizeBlueprint } from "@/lib/blueprint";

/*
 * --- blueprint --- The agent toolbox's Blueprint tools end to end (`npm run -s agent -- bp-… --json '{…}'`): one JSON result a
 * call, one Blueprint a call (spec, code, catalog or lite), deterministic answers, strict errors with paths, and a bundle that
 * holds the Blueprint library and the engine it plays on (bp-check runs the real runtime) but none of a page, the settings or
 * the finder – nor does the tool core gain any of it.
 */

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "agent", "cli.mjs");

function agent(tool: string, args: unknown) {
  const r = spawnSync(process.execPath, [CLI, tool, "--json", JSON.stringify(args)], { cwd: ROOT, encoding: "utf8", timeout: 180_000 });
  const lines = r.stdout.trim().split("\n");
  return { code: r.status, stdout: r.stdout, lines, json: JSON.parse(lines[lines.length - 1] || "null") };
}

const SPEC = { v: 1, meta: { name: "Tiny" }, bodies: [{ id: "ball" }], spawners: [{ body: "ball", speed: 300 }], finish: { timeoutSec: 10 } };

describe("blueprint tools: the table", () => {
  it("lists five bp-* tools, offered over MCP, that write nothing and use no network", () => {
    const bp = AGENT_TOOLS.filter((t) => t.name.startsWith("bp-"));
    expect(bp.map((t) => t.name)).toEqual(["bp-schema", "bp-validate", "bp-check", "bp-link", "bp-docs"]);
    for (const t of bp) expect([t.mcp, t.writes, t.network], t.name).toEqual([true, "none", "none"]);
    expect([...BLUEPRINT_TOOLS]).toEqual(bp.map((t) => t.name));
    for (const t of BLUEPRINT_TOOLS) expect(ENGINE_TOOLS.has(t)).toBe(false);
  });

  it("takes exactly one Blueprint a call", () => {
    for (const tool of BLUEPRINT_INPUT_TOOLS) {
      expect(checkToolArgs(tool, {}).ok, tool).toBe(false);
      expect(checkToolArgs(tool, { spec: SPEC, catalog: "hatchery" }).ok, tool).toBe(false);
      expect(checkToolArgs(tool, { catalog: "hatchery" }).ok, tool).toBe(true);
    }
    expect(blueprintInput({ catalog: "nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown catalog id "nope"/) });
    expect(blueprintInput({ code: "b9.x" })).toMatchObject({ ok: false });
    const code = encodeBlueprint(catalogBlueprint("conquer"));
    expect(blueprintInput({ code: `https://example.org/en/simulator/?mode=blueprint&bls=${code}` })).toMatchObject({ ok: true, source: "code" });
  });

  it("bundles the Blueprint library with the engine it plays on, but no page, settings or finder, and leaves the tool core as small as it was", async () => {
    // --- blueprint --- (P4) bp-check plays a spec on the real runtime – the engine in the blueprint mode, as the page, the
    // export and the finder play it – so the kit holds the engine and its modes now; still nothing of a page or the settings.
    const esbuild = await import("esbuild");
    const inputsOf = async (entry: string) =>
      Object.keys((await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, metafile: true, alias: { "@": path.join(ROOT, "src") }, logLevel: "silent", absWorkingDir: ROOT })).metafile.inputs);
    const kit = await inputsOf(BLUEPRINTKIT_ENTRY);
    for (const file of ["src/lib/blueprint/runtime/run.ts", "src/lib/blueprint/headless.ts", "src/lib/physics/engine.ts", "src/lib/physics/modes/blueprint.ts"]) expect(kit, file).toContain(file);
    expect(kit.filter((f) => /^src\/(components|app|i18n)\/|^src\/lib\/settings\.ts$|simulation\/finder|node_modules\/(react|react-dom|next)\//.test(f))).toEqual([]);
    expect((await inputsOf(TOOLCORE_ENTRY)).filter((f) => /blueprint/.test(f))).toEqual([]);
  });
});

describe("blueprint tools: end to end", () => {
  it("bp-validate: strict errors with their paths, the sanitizer's notes, and the summary", () => {
    const broken = agent("bp-validate", { spec: { ...SPEC, spawners: [{ body: "bal" }], rules: [{ when: "wallHit", do: [{ act: "grow", by: "q * 2" }] }] } });
    expect(broken.code).toBe(0);
    expect(broken.lines).toHaveLength(1);
    expect(broken.json.result.valid).toBe(false);
    expect(broken.json.result.errors).toEqual(expect.arrayContaining(['spawners[0].body: unknown body "bal" (the bodies: ball)', expect.stringMatching(/^rules\[0\]\.do\[0\]\.by: formula: unknown name "q"/)]));
    expect(broken.json.result.sanitizerNotes.length).toBeGreaterThan(0);
    const ok = agent("bp-validate", { catalog: "tierClimb" });
    expect(ok.json.result).toMatchObject({ valid: true, errors: [], sanitizerNotes: [], source: "catalog", maxBytes: 6000 });
    expect(ok.json.result.summary).toContain("Tier Climb");
    expect(sanitizeBlueprint(ok.json.result.compact).blueprint).toEqual(catalogBlueprint("tierClimb"));
  });

  it("bp-check: the same verdict and report on every call, judged on counts", () => {
    const a = agent("bp-check", { catalog: "plinkoRace" });
    const b = agent("bp-check", { catalog: "plinkoRace" });
    expect(a.code).toBe(0);
    expect(a.json.result.verdict).toBe("playable");
    // (everything but the wall-time advisory is identical)
    expect({ ...a.json.result, advisory: null }).toEqual({ ...b.json.result, advisory: null });
    expect(typeof a.json.result.advisory.wallMs).toBe("number");
    const endless = agent("bp-check", { spec: SPEC, seeds: [1, 2] });
    expect(endless.json.result.verdict).toBe("endless");
    expect(endless.json.result.seeds).toHaveLength(2);
  }, 120_000);

  it("bp-link: a code, a link and a share code that lead back to the same spec", () => {
    const r = agent("bp-link", { catalog: "ringBreaker", locale: "es" });
    expect(r.code).toBe(0);
    expect(r.json.result.query).toBe("mode=blueprint&blp=ringBreaker");
    expect(r.json.result.link).toBe("/es/simulator/?mode=blueprint&blp=ringBreaker");
    const s = agent("bp-link", { spec: SPEC });
    expect(s.json.result.link).toMatch(/^\/en\/simulator\/\?mode=blueprint&bls=b1\./);
    const back = decodeBlueprint(s.json.result.link);
    expect(back.ok && sanitizeBlueprint(back.raw).blueprint).toEqual(sanitizeBlueprint(SPEC).blueprint);
    expect(s.json.result.shareCodeChars).toBeLessThanOrEqual(s.json.result.shareCodeMax);
  });

  it("bp-schema and bp-docs: the language and the guide, current", () => {
    const full = agent("bp-schema", {});
    expect(full.json.result.form).toBe("full");
    expect(full.json.result.catalog).toEqual([...BLUEPRINT_CATALOG_IDS]);
    expect(full.json.result.vocabulary).toMatch(/^Blueprint v1/);
    expect(agent("bp-schema", { form: "lite" }).json.result.schema.properties.gravity.enum).toEqual(["none", "low", "normal", "high", "reverse"]);
    const docs = agent("bp-docs", { markdown: false });
    expect(docs.json.result).toMatchObject({ file: "docs/agents/BLUEPRINTS.md", current: true });
    expect(docs.json.result.markdown).toBeUndefined();
  }, 120_000);

  it("refuses two Blueprints in one call as a usage error (exit 2), and an unknown catalog id as a failure (exit 1)", () => {
    const two = agent("bp-check", { spec: SPEC, catalog: "hatchery" });
    expect([two.code, two.json.ok, two.json.usage]).toEqual([2, false, true]);
    const unknown = agent("bp-link", { catalog: "nope" });
    expect([unknown.code, unknown.json.ok]).toEqual([1, false]);
  });
});
