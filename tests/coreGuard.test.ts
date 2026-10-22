import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { MODE_IDS } from "@/lib/physics/types";
import {
  REPORT_KEYS,
  estimateTier0,
  exitCode,
  againstBaseline,
  globToRegExp,
  kebabCase,
  matchesAny,
  modeOfFile,
  modeSmokeBlocks,
  planEscalation,
  planTier0,
  planTier1,
  planVitest,
  relatedTests,
  requiredCommands,
  tier1SmokeBlocks,
  type CoreConfig,
  type StepResult,
} from "@/lib/agentKit/guardPlan";
import { findBlockTitles } from "../scripts/smoke/shards.mjs";

/*
 * --- ai-guard --- The core guard's plan (src/lib/agentKit/guardPlan.ts, scripts/agent/core.json): the lanes and their
 * commands, the core list, the escalation table, the related tests and the cap, the speed budget (from the measured per-file
 * times), the exit codes and the report's shape – and scripts/agent/guard.mjs end to end in its --plan mode (nothing runs).
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const CORE = JSON.parse(read("scripts/agent/core.json")) as CoreConfig;
const BLOCKS: string[] = findBlockTitles(read("scripts/smoke-test.mjs"));
const TEST_FILES = fs
  .readdirSync(path.join(ROOT, "tests"), { recursive: true })
  .map((f) => `tests/${String(f).split(path.sep).join("/")}`)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();
const exists = (file: string) => fs.existsSync(path.join(ROOT, file));
const allFiles = (dir: string): string[] =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" ? [] : e.isDirectory() ? allFiles(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

describe("scripts/agent/core.json", () => {
  it("lists the core tests (the 44 measured files, analytics and the guard's own), each existing, none of them slow", () => {
    const files = CORE.vitest.core.map((t) => t.file);
    expect(new Set(files).size).toBe(files.length);
    expect(files.length).toBeGreaterThanOrEqual(49);
    for (const f of files) expect(exists(f), f).toBe(true);
    for (const f of ["tests/engine.test.ts", "tests/extras.test.ts", "tests/analytics.test.ts", "tests/physicsPurity.test.ts", "tests/i18nParity.test.ts", "tests/coreGuard.test.ts", "tests/protectedDiff.test.ts", "tests/releaseWorkflows.test.ts", "tests/smokeShards.test.ts"]) expect(files).toContain(f);
    expect(files.filter((f) => matchesAny(f, CORE.vitest.slow))).toEqual([]);
    for (const t of CORE.vitest.core) expect(t.seconds, t.file).toBeGreaterThan(0);
    // every slow glob still matches a test (a stale entry would hide nothing and mean nothing)
    for (const g of CORE.vitest.slow) expect(TEST_FILES.some((f) => globToRegExp(g).test(f)), g).toBe(true);
  });

  it("names hub files, escalation globs and node --check globs that match real files", () => {
    const tree = [...allFiles("src"), ...allFiles("tests"), ...allFiles("scripts"), ...allFiles("messages"), ...allFiles("desktop/src")];
    for (const g of CORE.hubFiles) expect(tree.some((f) => globToRegExp(g).test(f)), g).toBe(true);
    for (const rule of CORE.escalation) {
      expect(rule.when.some((g) => tree.some((f) => globToRegExp(g).test(f))), rule.id).toBe(true);
      for (const t of rule.tests ?? []) expect(exists(t), `${rule.id}: ${t}`).toBe(true);
    }
    expect(tree.filter((f) => matchesAny(f, CORE.nodeCheck)).length).toBeGreaterThan(25);
  });

  it("names only smoke blocks the suite has, and every mode has at least one", () => {
    for (const b of CORE.browser.smoke) expect(BLOCKS, b).toContain(b);
    for (const rule of CORE.escalation) for (const b of rule.smoke ?? []) expect(BLOCKS, `${rule.id}: ${b}`).toContain(b);
    for (const [mode, list] of Object.entries(CORE.modeSmoke)) {
      expect(MODE_IDS as readonly string[], mode).toContain(mode);
      for (const b of list) expect(BLOCKS, `${mode}: ${b}`).toContain(b);
    }
    for (const mode of MODE_IDS) expect(modeSmokeBlocks(mode, BLOCKS, CORE).length, mode).toBeGreaterThan(0);
    expect(CORE.browser.smoke).toContain("core-every-mode");
  });
});

describe("the escalation table", () => {
  const escalate = (changed: string[]) => planEscalation({ changed, config: CORE, modeIds: MODE_IDS, smokeBlocks: BLOCKS, testFiles: TEST_FILES });

  it("requires tier 2 for a hub file", () => {
    for (const hub of ["src/lib/physics/engine.ts", "src/lib/settings.ts", "src/components/simulator/Canvas.tsx", "messages/pl.json"]) {
      const e = escalate([hub]);
      expect(e.requiredTier, hub).toBe(2);
      expect(e.items[0]).toMatchObject({ id: "hub", tier: 2, files: [hub] });
    }
  });

  it("requires the balance files and the fight-league block for Fight League", () => {
    const e = escalate(["src/lib/physics/modes/fightLeagueRoster.ts"]);
    expect(e.items.map((i) => i.id)).toEqual(["fight-league", "mode:fightLeague"]);
    expect(e.tests).toEqual(expect.arrayContaining(["tests/fightLeagueBalanceGames.test.ts", "tests/fightLeagueBalanceMovies.test.ts", "tests/fightLeagueBalanceComicsAnimeShows.test.ts", "tests/fightLeague.test.ts"]));
    expect(e.smoke).toEqual(["fight-league"]);
    expect(e.requiredTier).toBe(1);
  });

  it("requires the paywall and watermark blocks for billing, the watermark or recording, and the desktop blocks for the bridge", () => {
    for (const f of ["src/lib/billing/license.ts", "src/lib/watermark/seal.ts", "src/lib/recording/fastRender.ts"]) expect(escalate([f]).smoke, f).toEqual(["paywall-gate", "free-watermark", "watermark-everywhere"]);
    for (const f of ["src/lib/desktop/contract.ts", "desktop/src/main.ts"]) expect(escalate([f]).smoke, f).toEqual(["desktop-exe", "desktop-current", "desktop-ai-fix"]);
  });

  it("maps a mode's file to tests/<id>*.test.ts and its smoke block", () => {
    const e = escalate(["src/lib/physics/modes/mergeRing.ts"]);
    expect(e.items).toEqual([expect.objectContaining({ id: "mode:mergeRing", tier: 1, smoke: ["merge-ring"] })]);
    expect(e.tests).toEqual(TEST_FILES.filter((f) => f.startsWith("tests/mergeRing")));
    expect(escalate(["src/components/simulator/sections/FightLeagueSection.tsx"]).items.map((i) => i.id)).toEqual(["fight-league", "mode:fightLeague"]);
    expect(escalate(["src/lib/physics/modes/box.ts"]).smoke).toEqual(["modes", "box-arena", "box-dvd-corner", "box-finder"]);
    expect(modeOfFile("src/lib/physics/modes/glass.ts", MODE_IDS, CORE.modeFileGlobs)).toBe("glass");
    expect(modeOfFile("src/lib/physics/modes/spiralGlass.ts", MODE_IDS, CORE.modeFileGlobs)).toBe("spiralGlass");
    expect(modeOfFile("src/lib/physics/modes/arenaGames.ts", MODE_IDS, CORE.modeFileGlobs)).toBeNull();
    expect(modeOfFile("src/lib/settings.ts", MODE_IDS, CORE.modeFileGlobs)).toBeNull();
    expect(kebabCase("doublePendulum")).toBe("double-pendulum");
  });

  it("asks for nothing beyond tier 0 for docs, a test or a plain library file", () => {
    for (const f of ["README.md", "tests/zip.test.ts", "src/lib/recordingHelpers/none.ts", "docs/RELEASING.md"]) expect(escalate([f]).requiredTier, f).toBe(0);
  });
});

describe("the vitest lists", () => {
  const graph = {
    "tests/a.test.ts": ["src/lib/a.ts"],
    "tests/b.test.ts": ["src/lib/b.ts"],
    "src/lib/b.ts": ["src/lib/a.ts"],
    "tests/c.test.ts": ["src/lib/c.ts"],
    "tests/colourSort.test.ts": ["src/lib/a.ts"],
  };
  const tests = ["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts", "tests/colourSort.test.ts"];

  it("finds the related tests through the import graph, nearest first, and the changed tests themselves", () => {
    expect(relatedTests(["src/lib/a.ts"], graph, tests)).toEqual(["tests/a.test.ts", "tests/colourSort.test.ts", "tests/b.test.ts"]);
    expect(relatedTests(["tests/c.test.ts"], graph, tests)).toEqual(["tests/c.test.ts"]);
    expect(relatedTests(["README.md"], graph, tests)).toEqual([]);
  });

  it("leaves out the core list and the slow files (listed), and caps the rest", () => {
    const plan = planVitest({ config: CORE, related: ["tests/engine.test.ts", "tests/colourSort.test.ts", "tests/a.test.ts"], escalated: [] });
    expect(plan.related).toEqual(["tests/a.test.ts"]);
    expect(plan.slowSkipped).toEqual(["tests/colourSort.test.ts"]);
    expect(planVitest({ config: CORE, related: ["tests/colourSort.test.ts"], escalated: [], withSlow: true }).related).toEqual(["tests/colourSort.test.ts"]);
    const many = Array.from({ length: 40 }, (_, i) => `tests/t${String(i).padStart(2, "0")}.test.ts`);
    const capped = planVitest({ config: CORE, related: many, escalated: ["tests/zz.test.ts"] });
    expect(capped.related).toHaveLength(CORE.vitest.relatedCap);
    expect(capped.related).toContain("tests/zz.test.ts"); // an escalated test is never capped away
    expect(capped.capped).toEqual(many.slice(CORE.vitest.relatedCap - 1));
  });
});

describe("the lanes", () => {
  const vitest = planVitest({ config: CORE, related: ["tests/zip.test.ts", "tests/mergeRing.test.ts", "tests/maze.test.ts"], escalated: [] });
  const lanes = planTier0({ config: CORE, vitest, cacheDir: "/cache/jbl-guard", nodeCheckFiles: ["scripts/a.mjs"] });
  const step = (id: string) => lanes.flatMap((l) => l.steps).find((s) => s.id === id)!;

  it("runs three lanes: the type check; lint, scripts, desktop, billing; the unit tests, changelog and smoke list", () => {
    expect(lanes.map((l) => [l.id, l.steps.map((s) => s.id)])).toEqual([
      ["A", ["tsc"]],
      ["B", ["eslint", "node-check", "desktop-tsc", "desktop-vitest", "billing-tsc", "billing-vitest"]],
      ["C", ["vitest-core", "vitest-related", "changelog", "smoke-list"]],
    ]);
  });

  it("keeps its state in the cache: the incremental type check, ESLint's cache, the vitest reports", () => {
    expect(step("tsc").argv).toEqual(["node", "node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", "/cache/jbl-guard/site.tsbuildinfo"]);
    expect(step("eslint").argv).toEqual(expect.arrayContaining(["--cache", "--cache-location", "/cache/jbl-guard/eslint/"]));
    expect(step("desktop-tsc")).toMatchObject({ cwd: "desktop", requires: { path: "desktop/node_modules" } });
    expect(step("billing-vitest")).toMatchObject({ cwd: "billing", requires: { path: "billing/node_modules" } });
  });

  it("runs vitest with .only refused, two workers, no silent browser skips and a fresh-export check", () => {
    for (const id of ["vitest-core", "vitest-related", "desktop-vitest", "billing-vitest"]) {
      const s = step(id);
      expect(s.argv, id).toContain("--allowOnly=false");
      expect(s.env, id).toMatchObject({ JBL_REQUIRE_BROWSER: "1", JBL_GUARD: "1" });
      expect(s.jsonReport, id).toMatch(/^\/cache\/jbl-guard\/vitest-/);
    }
    expect(step("vitest-core").argv).toContain(`--maxWorkers=${CORE.vitest.maxWorkers}`);
    expect(step("vitest-core").argv.slice(-CORE.vitest.core.length)).toEqual(CORE.vitest.core.map((t) => t.file));
    expect(step("vitest-related").argv.slice(-2)).toEqual(["tests/maze.test.ts", "tests/mergeRing.test.ts"]); // (zip is in the core list)
    expect(step("changelog").argv).toEqual(["node", "scripts/changelog.mjs", "--check"]);
    expect(step("smoke-list").argv).toEqual(["node", "scripts/smoke-test.mjs", "--list"]);
  });

  it("plans tier 1 as a /smoke build without Next's type check, unobfuscated, and the core blocks plus the change's", () => {
    const escalation = planEscalation({ changed: ["src/lib/physics/modes/mergeRing.ts"], config: CORE, modeIds: MODE_IDS, smokeBlocks: BLOCKS, testFiles: TEST_FILES });
    const smoke = tier1SmokeBlocks(CORE, escalation, BLOCKS);
    expect(smoke).toEqual(BLOCKS.filter((b) => [...CORE.browser.smoke, "merge-ring"].includes(b)));
    const t1 = planTier1({ config: CORE, smoke, port: 3101, outDir: "/cache/smoke" });
    expect(t1.steps.map((s) => s.id)).toEqual(["next-build", "postexport", "smoke"]);
    expect(t1.steps[0].env).toMatchObject({ NEXT_PUBLIC_BASE_PATH: "/smoke", NEXT_PUBLIC_SITE_URL: "http://localhost:3101/smoke", JBL_BUILD_SKIP_TYPECHECK: "1", OBFUSCATE: "0" });
    expect(t1.steps[2].env).toMatchObject({ BASE_URL: "http://localhost:3101/smoke", SMOKE_ONLY: smoke.join(","), OUT_DIR: "/cache/smoke" });
  });

  it("never rewrites the source: no snapshot update, no --write-timing, no fingerprint re-recording", () => {
    const all = [...lanes, planTier1({ config: CORE, smoke: ["modes"], port: 1, outDir: "x" })].flatMap((l) => l.steps).flatMap((s) => s.argv);
    for (const bad of ["-u", "--update", "--write-timing", "--write", "--fix"]) expect(all, bad).not.toContain(bad);
    const script = read("scripts/agent/guard.mjs");
    expect(script).not.toMatch(/--write-timing|"-u"|--update|changelog\.mjs", "--write"/);
  });
});

describe("the speed budget (core.json's measured times, 4 CPUs)", () => {
  it("keeps tier 0 within 3 minutes cold and 60 s warm, even with a full set of related tests", () => {
    const related = Array.from({ length: CORE.vitest.relatedCap }, (_, i) => `tests/related${i}.test.ts`);
    const plan = planVitest({ config: CORE, related, escalated: [] });
    const cold = estimateTier0(CORE, plan, false);
    const warm = estimateTier0(CORE, planVitest({ config: CORE, related: [], escalated: [] }), true);
    expect(cold.total).toBeLessThanOrEqual(CORE.budget.coldSeconds);
    expect(warm.total).toBeLessThanOrEqual(CORE.budget.warmSeconds);
    expect(CORE.budget).toEqual({ coldSeconds: 180, warmSeconds: 60 });
  });
});

describe("the verdict and the report", () => {
  const step = (status: StepResult["status"]): StepResult => ({ id: "x", title: "x", lane: "C", status, seconds: 1, signatures: [] });
  const quiet = { fingerprintViolations: 0, weakeningViolations: 0, protectedFindings: 0 };
  const noEscalation = planEscalation({ changed: [], config: CORE, modeIds: MODE_IDS, smokeBlocks: BLOCKS, testFiles: TEST_FILES });
  const hub = planEscalation({ changed: ["src/lib/physics/engine.ts"], config: CORE, modeIds: MODE_IDS, smokeBlocks: BLOCKS, testFiles: TEST_FILES });
  const mode = planEscalation({ changed: ["src/lib/physics/modes/mergeRing.ts"], config: CORE, modeIds: MODE_IDS, smokeBlocks: BLOCKS, testFiles: TEST_FILES });
  const vitest = planVitest({ config: CORE, related: [], escalated: [] });

  it("exits 0 green, 1 failed (a step, a fingerprint, a weakened test), 2 green but a higher tier required", () => {
    expect(exitCode({ steps: [step("passed"), step("pre-existing")], statics: { ...quiet, protectedFindings: 3 }, escalation: noEscalation, tier: 0, vitest })).toBe(0);
    expect(exitCode({ steps: [step("failed")], statics: quiet, escalation: noEscalation, tier: 0, vitest })).toBe(1);
    expect(exitCode({ steps: [step("passed")], statics: { ...quiet, fingerprintViolations: 1 }, escalation: noEscalation, tier: 0, vitest })).toBe(1);
    expect(exitCode({ steps: [step("passed")], statics: { ...quiet, weakeningViolations: 1 }, escalation: noEscalation, tier: 0, vitest })).toBe(1);
    expect(exitCode({ steps: [step("passed")], statics: quiet, escalation: hub, tier: 1, vitest })).toBe(2);
    expect(exitCode({ steps: [step("passed")], statics: quiet, escalation: mode, tier: 0, vitest })).toBe(2);
    expect(exitCode({ steps: [step("passed")], statics: quiet, escalation: mode, tier: 1, vitest })).toBe(0);
    expect(exitCode({ steps: [step("passed")], statics: quiet, escalation: noEscalation, tier: 0, vitest: { ...vitest, slowSkipped: ["tests/colourSort.test.ts"] } })).toBe(2);
    expect(exitCode({ steps: [step("failed")], statics: quiet, escalation: noEscalation, tier: 0, vitest, baselineRun: true })).toBe(0);
  });

  it("tells a failure the baseline recorded from a new one", () => {
    expect(againstBaseline(true, ["vitest tests/a.test.ts > x"], ["vitest tests/a.test.ts > x"])).toEqual({ status: "pre-existing", preExisting: ["vitest tests/a.test.ts > x"] });
    expect(againstBaseline(true, ["vitest tests/a.test.ts > x", "vitest tests/b.test.ts > y"], ["vitest tests/a.test.ts > x"]).status).toBe("failed");
    expect(againstBaseline(true, ["tsc x"], undefined).status).toBe("failed");
    expect(againstBaseline(false, [], ["tsc x"]).status).toBe("passed");
  });

  it("prints what to run next: tier 2's commands for a hub file, guard:browser for a feature's blocks", () => {
    expect(requiredCommands({ escalation: hub, vitest, tier: 0, config: CORE })).toEqual(CORE.tier2);
    expect(requiredCommands({ escalation: mode, vitest, tier: 0, config: CORE })).toEqual(["npm run guard:browser   # adds SMOKE_ONLY=merge-ring"]);
    expect(requiredCommands({ escalation: mode, vitest, tier: 1, config: CORE })).toEqual([]);
    expect(CORE.tier2[0]).toBe("npm run test:ci");
  });

  it("writes the report with every lane, its duration and the findings (guard.mjs --plan --json, nothing executed)", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/agent/guard.mjs"), "--plan", "--json", "--base", "HEAD"], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env, JBL_GUARD_CACHE: path.join(ROOT, ".agent-out", "cache", "test-plan") } });
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout) as Record<string, unknown> & { plannedLanes: { id: string; steps: { id: string }[] }[]; mode: string; reportFile: string };
    for (const key of REPORT_KEYS) expect(report, key).toHaveProperty(key);
    expect(report.mode).toBe("plan");
    expect(report.plannedLanes.map((l) => l.id)).toEqual(["A", "B", "C"]);
    expect(report.reportFile).toBe(".agent-out/guard-report.json");
    expect(JSON.parse(read(".agent-out/guard-report.json")).mode).toBe("plan");
  });

  it("has the npm scripts and keeps its output out of git", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.scripts.guard).toBe("node scripts/agent/guard.mjs");
    expect(pkg.scripts["guard:browser"]).toBe("node scripts/agent/guard.mjs --browser");
    expect(read(".gitignore").split("\n")).toContain("/.agent-out/");
    // the guard bundles its plan with esbuild and the parity test parses ICU: both declared, exact
    expect(pkg.devDependencies.esbuild).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies["@formatjs/icu-messageformat-parser"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
