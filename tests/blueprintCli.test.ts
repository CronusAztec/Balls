import { spawnSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";
import { BLUEPRINT_TOOLS, ENGINE_TOOLS } from "../scripts/agent/cli.mjs";
import { BLUEPRINTKIT_ENTRY, TOOLCORE_ENTRY } from "../scripts/agent/bundle.mjs";
import { AGENT_TOOLS, BLUEPRINT_INPUT_TOOLS, LINK_MAX_CHARS, checkToolArgs } from "@/lib/agentKit/tools";
import { blueprintInput } from "@/lib/agentKit/blueprintKit";
import { BLUEPRINT_CATALOG_IDS, BLUEPRINT_CODE_MAX_CHARS, BLUEPRINT_JSON_MAX_BYTES, applyBlueprintParams, blueprintDigest, blueprintJson, catalogBlueprint, decodeBlueprint, encodeBlueprint, parseParamValues, playabilityCheck, sanitizeBlueprint, validateBlueprint } from "@/lib/blueprint";

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

  // --- review fix (blueprint) --- a tuned Mode Lab link is judged as the page plays it, never as the spec's defaults
  it("reads a link's slider values (blv) and a catalog game's link (blp), and a call's params take the place of the link's", () => {
    const code = encodeBlueprint(catalogBlueprint("ringBreaker"));
    expect(blueprintInput({ code: `/en/simulator/?mode=blueprint&bls=${code}&blv=3,60` })).toMatchObject({ ok: true, source: "code", catalogId: "", params: [3, 60], paramsFrom: "link" });
    expect(blueprintInput({ code: `mode=blueprint&bls=${code}&blv=,45` })).toMatchObject({ ok: true, params: [null, 45], paramsFrom: "link" });
    expect(blueprintInput({ code })).toMatchObject({ ok: true, params: [], paramsFrom: null });
    const preset = blueprintInput({ code: "https://example.org/pl/simulator/?mode=blueprint&blp=conquer&blv=4" });
    expect(preset).toMatchObject({ ok: true, source: "catalog", catalogId: "conquer", params: [4], paramsFrom: "link" });
    expect(preset.ok && sanitizeBlueprint(preset.raw).blueprint).toEqual(catalogBlueprint("conquer"));
    expect(blueprintInput({ code: `?mode=blueprint&bls=${code}&blv=3,60`, params: "5" })).toMatchObject({ ok: true, params: [5], paramsFrom: "params" });
    expect(blueprintInput({ catalog: "ringBreaker", params: "3" })).toMatchObject({ ok: true, source: "catalog", catalogId: "ringBreaker", params: [3], paramsFrom: "params" });
    expect(blueprintInput({ code: "?mode=blueprint&blp=nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown catalog id "nope"/) });
    expect(blueprintInput({ code: "?mode=blueprint&blv=3" })).toMatchObject({ ok: false, error: expect.stringMatching(/holds no Blueprint/) });
    // (a link whose game cannot be read is refused: the page would play a catalog game in its place)
    expect(blueprintInput({ code: "?mode=blueprint&blp=conquer&bls=b1.AAAA" })).toMatchObject({ ok: false, error: expect.stringMatching(/could not be read/) });
    for (const tool of BLUEPRINT_INPUT_TOOLS) expect(checkToolArgs(tool, { catalog: "ringBreaker", params: "3,60" }).ok, tool).toBe(true);
  });

  it("bp-check, bp-validate and bp-link play a tuned link's game: Ring Breaker with 3 rings and 60° gaps, not its 8 rings", () => {
    const code = encodeBlueprint(catalogBlueprint("ringBreaker"));
    const link = `/en/simulator/?mode=blueprint&bls=${code}&blv=3,60`;
    const played = applyBlueprintParams(catalogBlueprint("ringBreaker"), parseParamValues("3,60")).blueprint;
    expect(played.arena.rings).toMatchObject({ count: 3, gapDeg: 60 });
    const expected = playabilityCheck(played);
    const check = agent("bp-check", { code: link });
    expect(check.code).toBe(0);
    expect(check.json.result).toMatchObject({ verdict: expected.verdict, medianFinishSec: expected.medianFinishSec, digest: blueprintDigest(played) });
    expect(check.json.result.params).toMatchObject({ from: "the link's blv", blv: "3,60", sliders: [{ id: "rings", value: 3, own: 8 }, { id: "gap", value: 60, own: 28 }, { id: "spin", value: 30, own: 30 }] });
    expect(check.json.result.params.note).toMatch(/the game the link plays/);
    const validate = agent("bp-validate", { code: link });
    expect(validate.json.result).toMatchObject({ valid: true, digest: blueprintDigest(played) });
    expect(validate.json.result.summary).toContain("3 spinning rings with 60° gaps");
    const tuned = agent("bp-link", { catalog: "ringBreaker", params: "3,60" });
    expect(tuned.json.result.query).toBe("mode=blueprint&blp=ringBreaker&blv=3,60");
    expect(agent("bp-link", { code: link }).json.result.query).toBe(`mode=blueprint&bls=${code}&blv=3,60`);
  }, 180_000);

  // --- review fix (blueprint) --- the largest legal game: bp-link's link is a link simulate, preview and render take
  it("plays a valid Blueprint near the 6 KB ceiling from the link bp-link gives it: simulate, preview and render take that link", () => {
    const value = `1 + 0 * (t${" + t".repeat(44)})`;
    const raw = { v: 1, meta: { name: "Near the ceiling", description: "A spec as big as a link may carry." }, bodies: [{ id: "ball", radius: 10 }], vars: [{ id: "hits" }], spawners: [{ body: "ball", speed: 400 }], rules: Array.from({ length: 12 }, () => ({ when: "wallHit", do: [{ act: "var", id: "hits", op: "add", value }, { act: "var", id: "hits", op: "add", value }] })), finish: { timeoutSec: 20, any: [{ when: "count", what: "hits", atLeast: 300 }] } };
    expect(validateBlueprint(raw)).toEqual([]);
    const { blueprint, notes } = sanitizeBlueprint(raw);
    expect(notes).toEqual([]);
    const bytes = new TextEncoder().encode(blueprintJson(blueprint)).length;
    expect(bytes).toBeGreaterThan(BLUEPRINT_JSON_MAX_BYTES - 100);
    expect(bytes).toBeLessThanOrEqual(BLUEPRINT_JSON_MAX_BYTES);
    const linked = agent("bp-link", { spec: raw });
    expect(linked.code).toBe(0);
    expect(linked.json.result.codeChars).toBeGreaterThan(7900);
    const link = `https://jumpingballs.live${linked.json.result.link}&seed=3`;
    expect(link.length).toBeGreaterThan(8000);
    // the longest legal code, in a full link with room for the other settings, fits the tools' link
    expect(LINK_MAX_CHARS).toBeGreaterThanOrEqual(BLUEPRINT_CODE_MAX_CHARS + 4000);
    for (const tool of ["simulate", "preview", "render"]) expect([tool, checkToolArgs(tool, { link }).ok]).toEqual([tool, true]);
    for (const tool of ["simulate", "preview", "render"]) expect([tool, checkToolArgs(tool, { link: `?${linked.json.result.query}` }).ok]).toEqual([tool, true]);
    const played = agent("simulate", { link, seconds: 20 });
    expect(played.code, played.stdout).toBe(0);
    expect(played.json.result).toMatchObject({ mode: "blueprint", seed: 3, finished: true });
  }, 180_000);

  it("refuses two Blueprints in one call as a usage error (exit 2), and an unknown catalog id as a failure (exit 1)", () => {
    const two = agent("bp-check", { spec: SPEC, catalog: "hatchery" });
    expect([two.code, two.json.ok, two.json.usage]).toEqual([2, false, true]);
    const unknown = agent("bp-link", { catalog: "nope" });
    expect([unknown.code, unknown.json.ok]).toEqual([1, false]);
  });
});
