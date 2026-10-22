import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { MODE_IDS } from "@/lib/physics/types";
import {
  REPORT_KEYS,
  baselineUsable,
  declarationEmitOnly,
  estimateTier0,
  exitCode,
  againstBaseline,
  mergeCoreConfigs,
  missingInstalls,
  verdictOf,
  globToRegExp,
  kebabCase,
  matchesAny,
  modeOfFile,
  modeSmokeBlocks,
  editZones,
  planEscalation,
  planTier0,
  planTier1,
  planVitest,
  relatedTests,
  requiredCommands,
  smokeSignatures,
  tier1SmokeBlocks,
  type CoreConfig,
  type StepResult,
} from "@/lib/agentKit/guardPlan";
import { findBlockTitles } from "../scripts/smoke/shards.mjs";
import {
  ANNOTATIONS_PER_KIND,
  KIT_FILES,
  annotations,
  baseCandidates,
  baseNote,
  findBlockTitles as guardBlockTitles,
  importGraph,
  isMainModule,
  onlyWorkerTimeout as guardWorkerTimeout,
  reachedFromRunners,
  reportFileFor,
  safeLine,
  stepSummary,
  strictest,
  stricterStatics,
  summaryText,
  textReads,
  uncommittedChanges,
  vitestSignatures,
  walk,
} from "../scripts/agent/guard.mjs";
import { onlyWorkerTimeout } from "../scripts/test-ci.mjs";
import os from "os";

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
/** The environment of a guard this test starts: never GitHub Actions' (annotations, the job summary), whatever runs the test. */
const NOT_IN_ACTIONS = { GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" };
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
    // (and the core function that owns src/lib/physics/**: its block, core-every-mode, is on browser.smoke already)
    expect(e.items.map((i) => i.id)).toEqual(["fight-league", "mode:fightLeague", "core:modes-deterministic"]);
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
    expect(e.items).toEqual([expect.objectContaining({ id: "mode:mergeRing", tier: 1, smoke: ["merge-ring"] }), expect.objectContaining({ id: "core:modes-deterministic", tier: 1, smoke: [], browser: true })]);
    expect(e.tests).toEqual(TEST_FILES.filter((f) => f.startsWith("tests/mergeRing")));
    expect(escalate(["src/components/simulator/sections/FightLeagueSection.tsx"]).items.map((i) => i.id)).toEqual(["fight-league", "mode:fightLeague", "core:start-a-run"]);
    expect(escalate(["src/lib/physics/modes/box.ts"]).smoke).toEqual(["modes", "box-arena", "box-dvd-corner", "box-finder"]);
    expect(modeOfFile("src/lib/physics/modes/glass.ts", MODE_IDS, CORE.modeFileGlobs)).toBe("glass");
    expect(modeOfFile("src/lib/physics/modes/spiralGlass.ts", MODE_IDS, CORE.modeFileGlobs)).toBe("spiralGlass");
    expect(modeOfFile("src/lib/physics/modes/arenaGames.ts", MODE_IDS, CORE.modeFileGlobs)).toBeNull();
    expect(modeOfFile("src/lib/settings.ts", MODE_IDS, CORE.modeFileGlobs)).toBeNull();
    expect(kebabCase("doublePendulum")).toBe("double-pendulum");
  });

  it("asks for nothing beyond tier 0 for docs, a test or a plain library file", () => {
    // (a test outside the core functions: a core function's own proof test is in the core zone, below)
    for (const f of ["README.md", "tests/daily.test.ts", "src/lib/recordingHelpers/none.ts", "docs/RELEASING.md"]) expect(escalate([f]).requiredTier, f).toBe(0);
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
      ["C", ["vitest", "changelog", "smoke-list"]],
    ]);
  });

  it("keeps its state in the cache: the incremental type check, ESLint's cache, the vitest reports", () => {
    // declarations into the cache, not --noEmit: a body-only edit then re-checks no dependents (seconds, not minutes)
    expect(step("tsc").argv).toEqual(["node", "node_modules/typescript/bin/tsc", "--noEmit", "false", "--declaration", "--emitDeclarationOnly", "--outDir", "/cache/jbl-guard/tsc-dts", "--incremental", "--tsBuildInfoFile", "/cache/jbl-guard/site-dts.tsbuildinfo"]);
    expect(step("tsc").declarationEmit).toBe(true);
    // what only declaration emit raises is no type error (npm run typecheck never reports it); everything else is
    expect(declarationEmitOnly("tsc src/lib/a.ts: TS2742 The inferred type of 'x' cannot be named without a reference to '../node_modules/y'. This is likely not portable.")).toBe(true);
    expect(declarationEmitOnly("tsc src/lib/a.ts: TS4025 Exported variable 'x' has or is using private name 'Y'.")).toBe(true);
    expect(declarationEmitOnly("tsc src/lib/a.ts: TS9005 Declaration emit for this file requires using private name 'Z'.")).toBe(true);
    expect(declarationEmitOnly("tsc src/lib/a.ts: TS7056 The inferred type of this node exceeds the maximum length the compiler will serialize.")).toBe(true);
    expect(declarationEmitOnly("tsc src/lib/a.ts: TS2322 Type 'string' is not assignable to type 'number'.")).toBe(false);
    expect(declarationEmitOnly("tsc src/lib/a.ts: TS4104 The type 'readonly string[]' is 'readonly' and cannot be assigned to the mutable type 'string[]'.")).toBe(false);
    expect(declarationEmitOnly("tsc src/lib/a.ts: TS4114 This member must have an 'override' modifier because it overrides a member in the base class 'B'.")).toBe(false);
    expect(step("eslint").argv).toEqual(expect.arrayContaining(["--cache", "--cache-location", "/cache/jbl-guard/eslint/"]));
    expect(step("desktop-tsc")).toMatchObject({ cwd: "desktop", requires: { path: "desktop/node_modules" } });
    expect(step("billing-vitest")).toMatchObject({ cwd: "billing", requires: { path: "billing/node_modules" } });
  });

  it("runs vitest with .only refused, core.json's workers, no silent browser skips and a fresh-export check", () => {
    for (const id of ["vitest", "desktop-vitest", "billing-vitest"]) {
      const s = step(id);
      expect(s.argv, id).toContain("--allowOnly=false");
      expect(s.env, id).toMatchObject({ JBL_REQUIRE_BROWSER: "1", JBL_GUARD: "1" });
      expect(s.jsonReport, id).toMatch(/^\/cache\/jbl-guard\/vitest[-.]/);
    }
    expect(step("vitest").argv).toContain(`--maxWorkers=${CORE.vitest.maxWorkers}`);
    // one run: the core list in its order, then the related tests (zip is in the core list already)
    expect(step("vitest").argv.slice(-CORE.vitest.core.length - 2)).toEqual([...CORE.vitest.core.map((t) => t.file), "tests/maze.test.ts", "tests/mergeRing.test.ts"]);
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
    // no network but the guard's own 127.0.0.1 server: Next's telemetry is off for the build and the export, and in the
    // tier-2 build command it prints
    for (const s of t1.steps.slice(0, 2)) expect(s.env, s.id).toMatchObject({ NEXT_TELEMETRY_DISABLED: "1" });
    expect(CORE.tier2.find((c) => c.includes("next build"))).toMatch(/^NEXT_TELEMETRY_DISABLED=1 /);
    expect(t1.steps[2].env).toMatchObject({ BASE_URL: "http://localhost:3101/smoke", SMOKE_ONLY: smoke.join(","), OUT_DIR: "/cache/smoke" });
  });

  it("never rewrites the source: no snapshot update, no --write-timing, no fingerprint re-recording", () => {
    const all = [...lanes, planTier1({ config: CORE, smoke: ["modes"], port: 1, outDir: "x" })].flatMap((l) => l.steps).flatMap((s) => s.argv);
    for (const bad of ["-u", "--update", "--write-timing", "--write", "--fix"]) expect(all, bad).not.toContain(bad);
    const script = read("scripts/agent/guard.mjs");
    expect(script).not.toMatch(/--write-timing|"-u"|--update|changelog\.mjs", "--write"/);
  });
});

describe("the speed budget (core.json's measured wall times, 4 CPUs)", () => {
  const full = planVitest({ config: CORE, related: Array.from({ length: CORE.vitest.relatedCap + 10 }, (_, i) => `tests/related${i}.test.ts`), escalated: [] });
  const none = planVitest({ config: CORE, related: [], escalated: [] });

  it("keeps tier 0 within 3 minutes cold and 60 s warm with a full set of related tests – and after a body-only edit", () => {
    expect(full.related).toHaveLength(CORE.vitest.relatedCap);
    expect(estimateTier0(CORE, full, false).total).toBeLessThanOrEqual(CORE.budget.coldSeconds);
    expect(estimateTier0(CORE, full, true).total).toBeLessThanOrEqual(CORE.budget.warmSeconds);
    expect(estimateTier0(CORE, full, "edit").total).toBeLessThanOrEqual(CORE.budget.warmSeconds);
    expect(estimateTier0(CORE, none, true).total).toBeLessThanOrEqual(CORE.budget.warmSeconds);
    expect(CORE.budget).toEqual({ coldSeconds: 180, warmSeconds: 60 });
  });

  it("estimates from wall times: start-up, every file's run and its per-file cost over the workers (calibrated, not run time alone)", () => {
    const m = CORE.measured;
    const w = CORE.vitest.maxWorkers;
    const coreRun = CORE.vitest.core.reduce((s, t) => s + t.seconds, 0);
    const nothing = estimateTier0(CORE, none, true);
    expect(nothing.C).toBeCloseTo(m.vitestStartup + (coreRun + CORE.vitest.core.length * m.vitestPerFile) / w + m.smallChecks, 6);
    expect(estimateTier0(CORE, full, true).C - nothing.C).toBeCloseTo((CORE.vitest.relatedCap * (m.relatedFile + m.vitestPerFile)) / w, 6);
    // the calibration point: the core list and 25 related files (core.json's run durations plus 82 s) took 71.7 s of wall
    // time warm on 4 CPUs with three workers; the estimate meets it within 10 %, where run time alone said 51 s
    const measured = { run: coreRun + 82, files: CORE.vitest.core.length + 25, wall: 71.7 };
    const estimated = m.vitestStartup + (measured.run + measured.files * m.vitestPerFile) / w;
    expect(Math.abs(estimated - measured.wall) / measured.wall).toBeLessThan(0.1);
    expect(m.vitestStartup + measured.run / w).toBeLessThan(measured.wall * 0.8);
    // lane A: a body-only edit re-checks no dependents (declarations to the cache)
    expect(m.tscEdit).toBeLessThan(m.tscCold / 4);
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

  it("uses a baseline only from a clean tree at the base commit or before it", () => {
    const base = "b".repeat(40);
    const head = "h".repeat(40);
    const older = "a".repeat(40);
    // history: older → base → head (the change's own commits)
    const order = [older, base, head];
    const isAncestor = (a: string, b: string) => order.indexOf(a) >= 0 && order.indexOf(a) <= order.indexOf(b);
    const rec = (at: string, dirty = false) => ({ head: at, dirty, signatures: { vitest: ["vitest tests/zip.test.ts > crc"] } });
    expect(baselineUsable(rec(base), { baseCommit: base, isAncestor })).toEqual({ ok: true });
    // --- ai-guard --- one recorded before the base: ignored (a test fixed since then, broken again by the change, would pass)
    const before = baselineUsable(rec(older), { baseCommit: base, isAncestor });
    expect(before.ok).toBe(false);
    expect(!before.ok && before.why).toMatch(/recorded before the base/);
    // baseline at HEAD with the range non-empty: ignored (a regression committed, then --baseline, then guard: never green)
    const atHead = baselineUsable(rec(head), { baseCommit: base, isAncestor });
    expect(atHead.ok).toBe(false);
    expect(!atHead.ok && atHead.why).toMatch(/after the base/);
    // recorded on a changed tree (or by an older guard that did not say): ignored
    expect(baselineUsable(rec(base, true), { baseCommit: base, isAncestor }).ok).toBe(false);
    expect(baselineUsable({ head: base, signatures: {} }, { baseCommit: base, isAncestor }).ok).toBe(false);
    expect(baselineUsable(null, { baseCommit: base, isAncestor }).ok).toBe(false);
  });

  it("never calls a run plain green when the baseline excused a failure", () => {
    const excused: StepResult = { ...step("pre-existing"), preExisting: ["vitest tests/a.test.ts > x", "vitest tests/a.test.ts > y"] };
    expect(verdictOf(0, [step("passed")])).toBe("green");
    expect(verdictOf(0, [step("passed"), excused])).toBe("green with 2 pre-existing failures excused by the baseline");
    expect(verdictOf(2, [excused])).toMatch(/^green, higher tier required with 2 pre-existing/);
    expect(verdictOf(1, [step("failed"), excused])).toBe("failed");
  });

  it("finds untracked files as well as edits when it checks for an untouched tree", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-guard-tree-"));
    try {
      const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      git("init", "-q");
      fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
      git("add", "a.txt");
      git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "a");
      expect(uncommittedChanges(dir)).toEqual([]);
      fs.writeFileSync(path.join(dir, "new.test.ts"), "x\n");
      expect(uncommittedChanges(dir)).toEqual(["?? new.test.ts"]);
      fs.writeFileSync(path.join(dir, "a.txt"), "b\n");
      expect(uncommittedChanges(dir).sort()).toEqual([" M a.txt", "?? new.test.ts"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the base commit's core tests and hub files in force until a change that drops them is merged", () => {
    const head: CoreConfig = { ...CORE, hubFiles: CORE.hubFiles.filter((g) => g !== "src/lib/settings.ts"), vitest: { ...CORE.vitest, core: CORE.vitest.core.filter((t) => t.file !== "tests/zip.test.ts") } };
    const merged = mergeCoreConfigs(CORE, head, exists);
    expect(merged.vitest.core.map((t) => t.file)).toContain("tests/zip.test.ts");
    expect(merged.hubFiles).toContain("src/lib/settings.ts");
    // a core test that is gone is the weakening detector's (test-deleted, core-test-dropped: failures), not a run that cannot start
    const gone = mergeCoreConfigs({ ...CORE, vitest: { ...CORE.vitest, core: [...CORE.vitest.core, { file: "tests/removed.test.ts", seconds: 1 }] } }, CORE, exists);
    expect(gone.vitest.core.map((t) => t.file)).not.toContain("tests/removed.test.ts");
    expect(mergeCoreConfigs(null, head, exists)).toBe(head);
    expect(mergeCoreConfigs(CORE, CORE, exists)).toEqual(CORE);
  });

  it("keeps the base's node --check globs, escalation rows, smoke blocks, mode globs, tier-2 commands and slow list in force", () => {
    const paywall = CORE.escalation.find((r) => r.id === "paywall-watermark")!;
    const head: CoreConfig = {
      ...CORE,
      nodeCheck: [],
      escalation: CORE.escalation.filter((r) => r.id !== "paywall-watermark").map((r) => (r.id === "desktop" ? { ...r, smoke: [] } : r)),
      browser: { ...CORE.browser, smoke: ["pages"] },
      modeFileGlobs: [],
      modeSmoke: { ...CORE.modeSmoke, box: [] },
      tier2: [],
      coreFunctions: CORE.coreFunctions!.slice(1).map((f) => ({ ...f, smoke: [] })),
      vitest: { ...CORE.vitest, relatedCap: 0, slow: [...CORE.vitest.slow, "tests/freeWatermark.test.ts", "tests/goLiveKit.test.ts"] },
    };
    const merged = mergeCoreConfigs(CORE, head, exists);
    expect(merged.nodeCheck).toEqual(CORE.nodeCheck);
    expect(merged.escalation.find((r) => r.id === "paywall-watermark")).toEqual(paywall);
    expect(merged.escalation.find((r) => r.id === "desktop")?.smoke).toEqual(CORE.escalation.find((r) => r.id === "desktop")!.smoke);
    expect(merged.browser.smoke).toEqual(expect.arrayContaining(CORE.browser.smoke));
    expect(merged.modeFileGlobs).toEqual(CORE.modeFileGlobs);
    expect(merged.modeSmoke.box).toEqual(CORE.modeSmoke.box);
    expect(merged.tier2).toEqual(CORE.tier2);
    expect(merged.coreFunctions!.map((f) => f.id).sort()).toEqual(CORE.coreFunctions!.map((f) => f.id).sort());
    for (const f of merged.coreFunctions!) expect(f.smoke, f.id).toEqual(CORE.coreFunctions!.find((c) => c.id === f.id)!.smoke);
    expect(merged.vitest.relatedCap).toBe(CORE.vitest.relatedCap);
    expect(merged.vitest.slow).toEqual(CORE.vitest.slow); // a test the change newly calls slow stays in tier 0
    // so the watermark edit of the finding still asks for the paywall and watermark blocks (exit 2, not 0)
    const e = planEscalation({ changed: ["src/lib/watermark/layout.ts"], config: merged, modeIds: MODE_IDS, smokeBlocks: BLOCKS, testFiles: TEST_FILES });
    expect(e.smoke).toEqual(["paywall-gate", "free-watermark", "watermark-everywhere"]);
    expect(e.requiredTier).toBe(1);
    // what the change adds applies at once
    const extra = mergeCoreConfigs(CORE, { ...CORE, nodeCheck: [...CORE.nodeCheck, "tools/*.mjs"], vitest: { ...CORE.vitest, relatedCap: 20 } }, exists);
    expect(extra.nodeCheck).toContain("tools/*.mjs");
    expect(extra.vitest.relatedCap).toBe(20);
  });

  it("never excuses a missing install with a baseline, and refuses to record one without the installs", () => {
    // the signature of a missing install describes the machine: a baseline that has it excuses nothing
    expect(againstBaseline(true, ["desktop-tsc: desktop/node_modules is missing"], ["desktop-tsc: desktop/node_modules is missing"], false)).toEqual({ status: "failed", preExisting: [] });
    expect(againstBaseline(true, ["desktop-tsc: desktop/node_modules is missing"], ["desktop-tsc: desktop/node_modules is missing"]).status).toBe("pre-existing");
    const lanes = planTier0({ config: CORE, vitest: planVitest({ config: CORE, related: [], escalated: [] }), cacheDir: "/c", nodeCheckFiles: [] });
    expect(missingInstalls(lanes, (p) => p !== "desktop/node_modules")).toEqual([{ path: "desktop/node_modules", fix: "npm ci --prefix desktop (with ELECTRON_SKIP_BINARY_DOWNLOAD=1)" }]);
    expect(missingInstalls(lanes, () => true)).toEqual([]);
    expect(missingInstalls(lanes, () => false).map((m) => m.path)).toEqual(["desktop/node_modules", "billing/node_modules"]);
    // guard.mjs: the requires branch is not excusable and is never written into a baseline
    const script = read("scripts/agent/guard.mjs");
    expect(script).toMatch(/is missing`\], \{ note: [^\n]*environment: true \}, false\);/);
    expect(script).toContain("allSteps.filter((s) => s.signatures.length && !s.environment)");
    expect(script).toMatch(/--baseline needs every install the lanes use/);
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
    expect(CORE.tier2[0]).toBe("JBL_REQUIRE_BROWSER=1 npm run test:ci");
  });

  it("prints tier-2 commands that do what CI does: no silent browser skips, a server that is up, every shard gating", () => {
    const deploy = read(".github/workflows/deploy.yml");
    // CI's unit tests run with JBL_REQUIRE_BROWSER=1, and so does the printed command
    expect(deploy).toMatch(/run: npm run test:ci\n {8}env:\n {10}JBL_REQUIRE_BROWSER: "1"/);
    expect(CORE.tier2[0]).toMatch(/^JBL_REQUIRE_BROWSER=1 npm run test:ci$/);
    // never "push to the product branch": that push deploys to production (AGENTS.md: never push or deploy unless asked)
    for (const c of CORE.tier2) expect(c).not.toMatch(/push|product branch|deploy\.yml runs/i);
    // the shard line: the server answers before the first shard, a failed shard fails the line, the server is stopped
    const shards = CORE.tier2.find((c) => c.includes("SMOKE_SHARD"))!;
    expect(shards).toContain("for i in $(seq 1 30); do curl -sf http://localhost:3000/smoke/en/ > /dev/null && break; sleep 1; done");
    const run = (smoke: string) => {
      const line = shards
        .replace("node scripts/serve-static.mjs --port 3000 --base /smoke", "sleep 30")
        .replace("curl -sf http://localhost:3000/smoke/en/ > /dev/null", "true")
        .replace("npm run smoke", "fake_smoke")
        .replace(/\s+#.*$/, "");
      return spawnSync("bash", ["-c", `ran=""; fake_smoke() { ${smoke}; }; ${line}; s=$?; echo "ran:$ran"; exit $s`], { encoding: "utf8", timeout: 20_000 });
    };
    const shard2Fails = run('ran="$ran$i"; [ "$i" != 2 ]');
    expect(shard2Fails.status, shard2Fails.stderr).not.toBe(0); // (a plain for loop would exit with shard 4's status: 0)
    expect(shard2Fails.stdout).toContain("ran:1234"); // every shard still runs
    const allPass = run('ran="$ran$i"; true');
    expect(allPass.status).toBe(0);
    expect(allPass.stdout).toContain("ran:1234");
  });

  it("--- agent-guide --- puts every changed file in its edit zone and names the core functions a change touches", () => {
    const changed = ["docs/agents/MODES.md", "src/lib/recording/fastRender.ts", "src/lib/physics/engine.ts", "src/lib/watermark/seal.ts", "messages/en.json", "src/content/gallery.ts"];
    const z = editZones({ changed, config: CORE, protectedFiles: ["src/lib/watermark/seal.ts"] });
    expect(z.files).toEqual({
      free: ["docs/agents/MODES.md", "src/content/gallery.ts"],
      core: ["src/lib/recording/fastRender.ts"],
      guarded: ["src/lib/physics/engine.ts", "messages/en.json"], // (an edit outside Privacy.* and Terms.*: the report did not flag it)
      protected: ["src/lib/watermark/seal.ts"],
    });
    const ids = z.coreFunctions.map((c) => c.id);
    expect(ids).toEqual(["start-a-run", "modes-deterministic", "record-export-batch", "watermark", "i18n"]);
    expect(z.coreFunctions.find((c) => c.id === "watermark")).toEqual({ id: "watermark", title: "Watermark", files: ["src/lib/watermark/seal.ts"], tests: CORE.coreFunctions!.find((c) => c.id === "watermark")!.tests, smoke: ["free-watermark", "watermark-everywhere"] });
    expect(editZones({ changed: [], config: CORE, protectedFiles: [] })).toEqual({ files: { free: [], core: [], guarded: [], protected: [] }, coreFunctions: [] });
    // tier 1 adds the blocks of the core functions a change touches (go-live-kit for the analytics code, which tier 1 leaves to tier 2 otherwise)
    const analytics = editZones({ changed: ["src/lib/analytics/track.ts"], config: CORE, protectedFiles: [] });
    const none = planEscalation({ changed: ["src/lib/analytics/track.ts"], config: CORE, modeIds: MODE_IDS, smokeBlocks: BLOCKS, testFiles: TEST_FILES });
    // (--- ai-guard --- the escalation itself asks for it now: a core-zone file requires tier 1 with its function's blocks)
    expect(tier1SmokeBlocks(CORE, none, BLOCKS)).toContain("go-live-kit");
    expect(tier1SmokeBlocks(CORE, none, BLOCKS, analytics.coreFunctions.flatMap((c) => c.smoke))).toContain("go-live-kit");
  });

  it("writes the report with every lane, its duration and the findings (guard.mjs --plan --json, nothing executed)", () => {
    // --- ai-guard --- into its own cache (--report): the repository's .agent-out/guard-report.json is the guard run's this
    // test may be part of (lane C, npm run test:ci), and stays as it was
    const cache = path.join(ROOT, ".agent-out", "cache", "test-plan");
    const own = path.join(ROOT, ".agent-out", "guard-report.json");
    const before = fs.existsSync(own) ? fs.readFileSync(own, "utf8") : null;
    // (--- ai-guard --- never with the Actions variables of a CI run this test may be part of: its job summary is the real guard's)
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/agent/guard.mjs"), "--plan", "--json", "--base", "HEAD", "--report", path.join(cache, "guard-report.json")], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env, ...NOT_IN_ACTIONS, JBL_GUARD_CACHE: cache } });
    // (exit 1 when the working tree itself holds an unacknowledged fingerprint change or a weakened test: the plan still reports)
    expect([0, 1], r.stderr).toContain(r.status);
    const report = JSON.parse(r.stdout) as Record<string, unknown> & { plannedLanes: { id: string; steps: { id: string }[] }[]; mode: string; reportFile: string };
    for (const key of REPORT_KEYS) expect(report, key).toHaveProperty(key);
    expect(report.mode).toBe("plan");
    expect(report.plannedLanes.map((l) => l.id)).toEqual(["A", "B", "C"]);
    expect(report.reportFile).toBe(".agent-out/cache/test-plan/guard-report.json");
    expect(JSON.parse(fs.readFileSync(path.join(cache, "guard-report.json"), "utf8")).mode).toBe("plan");
    expect(fs.existsSync(own) ? fs.readFileSync(own, "utf8") : null).toBe(before);
    // a report anywhere but .agent-out/ or the cache is refused before anything runs
    const outside = spawnSync(process.execPath, [path.join(ROOT, "scripts/agent/guard.mjs"), "--plan", "--report", "README.md"], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env, ...NOT_IN_ACTIONS, JBL_GUARD_CACHE: cache } });
    expect(outside.status).toBe(1);
    expect(outside.stderr).toMatch(/--report README\.md: the report goes under \.agent-out\/ or the guard's cache/);
    expect(reportFileFor(null, cache).file).toBe(own);
    expect(reportFileFor(".agent-out/x/r.json", "/elsewhere").file).toBe(path.join(ROOT, ".agent-out", "x", "r.json"));
    expect(reportFileFor("/elsewhere/r.json", "/elsewhere")).toEqual({ file: "/elsewhere/r.json", root: "/elsewhere" });
  });

  it("relates the tests that read a source through path.join segments, ../ literals or a root file's name", () => {
    const tree = walk("");
    const { graph, imports } = importGraph(tree);
    const testFiles = tree.filter((f) => /^tests\/.+\.test\.ts$/.test(f));
    // desktopUpdateButton reads DesktopSection.tsx as path.join(__dirname, "..", "src", "components", …, "DesktopSection.tsx")
    expect(relatedTests(["src/components/simulator/sections/DesktopSection.tsx"], graph, testFiles)).toEqual(expect.arrayContaining(["tests/desktopUpdateButton.test.ts", "tests/desktopSocial.test.ts", "tests/desktopAutopilot.test.ts"]));
    expect(relatedTests([".mcp.json"], graph, testFiles)).toContain("tests/agentMcp.test.ts");
    expect(relatedTests(["next.config.ts"], graph, testFiles)).toContain("tests/agentCli.test.ts");
    // the rules on their own
    const exists = new Set(["src/a/B.tsx", "next.config.ts", ".mcp.json", "scripts/x.mjs", "tests/helper.ts"]);
    expect(textReads("tests/t.test.ts", 'path.join(__dirname, "..", "src", "a", "B.tsx"); read("next.config.ts"); "../scripts/x.mjs"; path.join(ROOT, \'.mcp.json\'); "src/a/missing.ts"', exists)).toEqual([".mcp.json", "next.config.ts", "scripts/x.mjs", "src/a/B.tsx"]);
    expect(textReads("tests/deep/t.test.ts", 'path.resolve(__dirname, "../helper.ts")', exists)).toEqual(["tests/helper.ts"]);
    // a text read is no import: the weakening detector's "a helper a runner imports" follows imports alone
    expect(imports["tests/desktopUpdateButton.test.ts"]).not.toContain("src/components/simulator/sections/DesktopSection.tsx");
    const reached = reachedFromRunners(imports, testFiles);
    expect(reached.has("tests/fakeCanvas.ts")).toBe(true);
    expect(reached.has("src/lib/physics/engine.ts")).toBe(true);
  });

  it("measures from JBL_GUARD_BASE, origin/main or main, says when it is not origin/main, and names no session branch", () => {
    expect(baseCandidates(null, {})).toEqual(["origin/main", "main"]);
    expect(baseCandidates(null, { JBL_GUARD_BASE: "origin/release" })).toEqual(["origin/release", "origin/main", "main"]);
    expect(baseCandidates("abc123", { JBL_GUARD_BASE: "x" })).toEqual(["abc123"]);
    expect(baseNote("origin/main", null)).toBeNull();
    expect(baseNote("HEAD~3", "HEAD~3")).toBeNull();
    expect(baseNote("main", null)).toMatch(/measured from main, not origin\/main/);
    expect(baseNote("origin/release", null)).toMatch(/JBL_GUARD_BASE, origin\/main, main/);
    expect(baseNote("HEAD", null)).toMatch(/pass --base <ref>/);
    expect(read("scripts/agent/guard.mjs")).not.toMatch(/origin\/claude\//);
  });

  it("annotates errors before warnings, one warning per rule, at most 10 of a kind, and lists everything in the step summary", () => {
    const paths = ["AGENTS.md", "CLAUDE.md", ".mcp.json", "scripts/agent/core.json", "scripts/agent/guard.mjs", "scripts/agent/protected.json", "src/lib/agentKit/guardPlan.ts", "src/lib/agentKit/protectedDiff.ts", ".github/workflows/deploy.yml", "deploy/vps/jbl-deploy.sh", "wrangler.toml"];
    const protectedFindings = [...paths.map((p) => ({ path: p, rule: p, why: `why ${p}` })), { path: "messages/en.json", rule: "Privacy.*", why: "legal", keys: ["Privacy.a"] }, { path: "messages/pl.json", rule: "Privacy.*", why: "legal", keys: ["Privacy.a"] }];
    const report = {
      base: { ref: "origin/main", commit: "cebc1510000" },
      changed: { count: 40 },
      fingerprints: { changes: [{ file: "tests/extras.test.ts", mode: "classic", kind: "changed", where: "BASELINE", acknowledged: false, reasons: [] }] },
      weakening: { findings: [{ kind: "expect-drop", file: "tests/uncap.test.ts", detail: "expect calls 222 → 221", acknowledged: false, reasons: [] }, { kind: "test-moved", file: "tests/a.test.ts", detail: "moved to tests/b.test.ts", acknowledged: true, reasons: ["moved"] }] },
      protected: { findings: protectedFindings },
      notes: ["a note"],
    };
    expect(annotations(report, {})).toBe("");
    const lines = annotations(report, { GITHUB_ACTIONS: "true" }).trimEnd().split("\n");
    const errors = lines.filter((l) => l.startsWith("::error "));
    const warnings = lines.filter((l) => l.startsWith("::warning "));
    expect(lines.slice(0, errors.length)).toEqual(errors); // errors first
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(ANNOTATIONS_PER_KIND); // 12 rules: 9 of them, then "3 more"
    expect(warnings[warnings.length - 1]).toMatch(/3 more owner-review rules.*the step summary lists every finding/);
    expect(warnings.filter((w) => w.includes("Privacy.*"))).toHaveLength(0); // (the twelfth rule went into "more")
    const grouped = annotations({ ...report, protected: { findings: protectedFindings.slice(-2) } }, { GITHUB_ACTIONS: "true" }).trimEnd().split("\n");
    expect(grouped.filter((l) => l.startsWith("::warning "))).toEqual(["::warning file=messages/en.json,title=Owner review required (Privacy.*)::legal: messages/en.json, messages/pl.json"]);
    const summary = stepSummary(report);
    for (const p of paths) expect(summary, p).toContain(p);
    expect(summary).toContain("**2 violations**");
    expect(summary).toContain("| expect-drop | tests/uncap.test.ts | expect calls 222 → 221 |");
    expect(summary).toContain("moved to tests/b.test.ts (acknowledged: moved)");
    expect(summary).toContain("Privacy.*: Privacy.a");
  });

  it("joins the base commit's static checks with this run's when the change edits them: the stricter result counts", () => {
    const own = { fpChanges: [], protectedFound: [{ path: "a", rule: "a", why: "x" }], weakening: [{ kind: "test-moved", file: "tests/g.test.ts", detail: "", acknowledged: true, reasons: ["m"] }] };
    const theirs = {
      fpChanges: [{ file: "tests/extras.test.ts", mode: "classic", kind: "changed", where: "BASELINE", acknowledged: false, reasons: [] }],
      protectedFound: [{ path: "src/lib/agentKit/protectedDiff.ts", rule: "src/lib/agentKit/protectedDiff.ts", why: "y" }],
      weakening: [{ kind: "test-moved", file: "tests/g.test.ts", detail: "", acknowledged: false, reasons: [] }],
    };
    const joined = stricterStatics(own, theirs);
    expect(joined.fpChanges).toEqual([expect.objectContaining({ mode: "classic", acknowledged: false, by: "the base commit's checks" })]);
    expect(joined.protectedFound.map((p) => p.path)).toEqual(["a", "src/lib/agentKit/protectedDiff.ts"]);
    expect(joined.weakening).toEqual([expect.objectContaining({ kind: "test-moved", acknowledged: false })]);
    expect(stricterStatics(own, null)).toEqual(own);
    expect([strictest(0, 0), strictest(0, 2), strictest(2, 1), strictest(0, 1)]).toEqual([0, 2, 1, 1]);
    expect(KIT_FILES).toEqual(["src/lib/agentKit/guardPlan.ts", "src/lib/agentKit/protectedDiff.ts"]);
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

describe("the guard, round three (--- ai-guard ---)", () => {
  const escalate = (changed: string[]) => planEscalation({ changed, config: CORE, modeIds: MODE_IDS, smokeBlocks: BLOCKS, testFiles: TEST_FILES });
  const vitest = planVitest({ config: CORE, related: [], escalated: [] });
  const passed: StepResult = { id: "x", title: "x", lane: "C", status: "passed", seconds: 1, signatures: [] };
  const quiet = { fingerprintViolations: 0, weakeningViolations: 0, protectedFindings: 0 };

  it("requires a core function's smoke blocks for a file it owns, its proof tests included: tier 0 alone exits 2", () => {
    const cases: Record<string, string> = {
      "src/components/site/StatsOptOut.tsx": "go-live-kit",
      "src/lib/analytics/attribution.ts": "go-live-kit",
      "src/components/simulator/shareLinks.tsx": "project-files",
      "src/components/simulator/ringLod.ts": "uncap-all",
      "src/components/simulator/liveMarkHud.ts": "free-watermark",
      "scripts/serve-static.mjs": "static-hosting",
      "tests/zip.test.ts": "recording",
    };
    for (const [file, block] of Object.entries(cases)) {
      const e = escalate([file]);
      expect(e.requiredTier, file).toBe(1);
      expect(exitCode({ steps: [passed], statics: quiet, escalation: e, tier: 0, vitest }), file).toBe(2);
      expect(exitCode({ steps: [passed], statics: quiet, escalation: e, tier: 1, vitest }), file).toBe(0);
      expect(requiredCommands({ escalation: e, vitest, tier: 0, config: CORE })[0], file).toMatch(/^npm run guard:browser\b/);
      expect(tier1SmokeBlocks(CORE, e, BLOCKS), file).toContain(block);
    }
    // blocks tier 1 runs anyway are not listed again, and the command still says why it is needed
    expect(escalate(["scripts/serve-static.mjs"]).smoke).toEqual([]);
    expect(requiredCommands({ escalation: escalate(["scripts/serve-static.mjs"]), vitest, tier: 0, config: CORE })).toEqual(["npm run guard:browser   # the smoke blocks of the core function site-serves (on browser.smoke)"]);
    expect(requiredCommands({ escalation: escalate(["src/lib/analytics/attribution.ts"]), vitest, tier: 0, config: CORE })).toEqual(["npm run guard:browser   # adds SMOKE_ONLY=go-live-kit"]);
    // a core function's own proof test is in the core zone, not free
    expect(editZones({ changed: ["tests/freeWatermark.test.ts", "tests/daily.test.ts"], config: CORE, protectedFiles: [] }).files).toMatchObject({ core: ["tests/freeWatermark.test.ts"], free: ["tests/daily.test.ts"] });
    expect(editZones({ changed: ["tests/freeWatermark.test.ts"], config: CORE, protectedFiles: [] }).coreFunctions.map((c) => c.id)).toEqual(["watermark"]);
  });

  it("uses a baseline only of the very base commit", () => {
    const rec = (head: string) => ({ head, dirty: false, signatures: {} });
    const isAncestor = () => true;
    expect(baselineUsable(rec("b".repeat(40)), { baseCommit: "b".repeat(40), isAncestor })).toEqual({ ok: true });
    expect(baselineUsable(rec("a".repeat(40)), { baseCommit: "b".repeat(40), isAncestor }).ok).toBe(false);
    expect(baselineUsable(rec("a".repeat(40)), { baseCommit: "b".repeat(40), isAncestor: () => false }).ok).toBe(false);
  });

  it("reads the smoke run check by check: a baseline of one failed check excuses no other", () => {
    const run = (lines: string[], end = "41/42 checks passed") => ["Smoke run: 1 of 120 blocks", ...lines, "✅ pages render", "", end].join("\n");
    const base = smokeSignatures(run(["❌ asset /hitSounds/kick.wav (404) 1.25 s"]));
    expect(base).toEqual({ signatures: ["smoke asset /hitSounds/kick.wav (#) # s"], finished: true });
    // the same check with other numbers: the same signature, excused
    const again = smokeSignatures(run(["❌ asset /hitSounds/kick.wav (404) 3.5 s"]));
    expect(againstBaseline(true, again.signatures, base.signatures).status).toBe("pre-existing");
    // a new failure beside it: failed
    const more = smokeSignatures(run(["❌ asset /hitSounds/kick.wav (404) 1 s", "❌ asset /wallBreak/pop.wav (404) 1 s"]));
    expect(againstBaseline(true, more.signatures, base.signatures).status).toBe("failed");
    // a check's indented lines are part of it: another failed URL is another failure
    const urls = (u: string) => smokeSignatures(run([`❌ no failed same-origin requests `, `   404 ${u}`]));
    expect(urls("/smoke/hitSounds/kick.wav").signatures).not.toEqual(urls("/smoke/wallBreak/pop.wav").signatures);
    // a run that never printed its count did not finish (a block threw)
    expect(smokeSignatures(run(["❌ asset /a.wav (404)"], "TypeError: x is undefined")).finished).toBe(false);
    // guard.mjs: the plain steps and an unfinished smoke run are never excused
    const script = read("scripts/agent/guard.mjs");
    expect(script).toMatch(/return done\(failed, failed \? \[`\$\{step\.id\}: exit \$\{r\.code\}`\] : \[\], failed \? \{ tail: tailOf\(output\) \} : \{\}, false\);/);
    expect(script).toMatch(/return done\(true, sigs, \{ tail: tailOf\(output\) \}, !whole\);/);
    expect(planTier1({ config: CORE, smoke: ["pages"], port: 1, outDir: "x" }).steps.map((s) => s.parser)).toEqual(["plain", "plain", "smoke"]);
  });

  it("imports nothing of the tree it judges: its copies of the shard and the CI helpers equal the originals", () => {
    const script = read("scripts/agent/guard.mjs");
    const statics = [...script.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
    expect(statics.length).toBeGreaterThan(3);
    for (const m of statics) expect(m, m).toMatch(/^node:/);
    // the dynamic imports: esbuild, and the plan it bundled into the cache
    expect(script.match(/\bimport\(/g)).toHaveLength(2);
    expect(script).toContain('await import("esbuild")');
    expect(script).toContain("return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)");
    expect(script).not.toMatch(/scripts\/(test-ci|smoke\/shards)\.mjs"\)/);
    const suite = read("scripts/smoke-test.mjs");
    expect(guardBlockTitles(suite)).toEqual(findBlockTitles(suite));
    expect(guardBlockTitles('await smokeBlock("a \\"q\\"", async () => {});\nawait  smokeBlock("x", f);')).toEqual(findBlockTitles('await smokeBlock("a \\"q\\"", async () => {});\nawait  smokeBlock("x", f);'));
    const tail = (files: string, tests: string, caught: string) => ` Test Files  ${files}\n      Tests  ${tests}\nVitest caught ${caught}\nError: [vitest-worker]: Timeout calling "onTaskUpdate"\n`;
    for (const t of [tail("137 passed | 1 skipped (138)", "3179 passed | 22 skipped (3201)", "1 unhandled error"), tail("1 failed | 137 passed (138)", "3179 passed (3179)", "1 unhandled error"), tail("138 passed (138)", "3179 passed (3179)", "2 unhandled errors"), ""]) {
      expect(guardWorkerTimeout(t), t).toBe(onlyWorkerTimeout(t));
    }
    // scripts/smoke/shards.mjs decides which blocks exist and which shard runs each: owner review
    expect(matchesAny("scripts/smoke/shards.mjs", (JSON.parse(read("scripts/agent/protected.json")) as { paths: { glob: string }[] }).paths.map((p) => p.glob))).toBe(true);
  });

  it("prints no line a change could turn into a workflow command, and escapes line breaks in what it reports", () => {
    expect(safeLine("plain")).toBe("plain");
    expect(safeLine("      ::stop-commands::hidden")).toBe("      : :stop-commands::hidden");
    expect(safeLine("##[group]x")).toBe("# #[group]x");
    expect(safeLine("a\r\nb\nc")).toBe("a ⏎ b ⏎ c");
    const report = {
      tier: 0,
      base: { ref: "HEAD", commit: "e36c1e2bd3b6" },
      changed: { count: 1 },
      lanes: [],
      fingerprints: { violations: 1, changes: [{ file: "tests/extras.test.ts", mode: "mergeRing", kind: "changed", where: "BASELINE", acknowledged: false, reasons: [] }] },
      weakening: { violations: 1, findings: [{ kind: "timeout-raised", file: "tests/shareCode.test.ts", detail: 'it "x": 5000 (the default) → `parseInt ( `6000\n::stop-commands::hidden` )` ms', acknowledged: false, reasons: [] }] },
      protected: { findings: [] },
      zones: { files: { free: [], core: [], guarded: [], protected: [] }, coreFunctions: [] },
      failures: [{ lane: "C", step: "vitest", signatures: ["x"], tail: ["::warning::from a test's output"] }],
      escalation: { items: [] },
      required: [],
      notes: [],
      verdict: "failed",
      exitCode: 1,
      seconds: 1,
      reportFile: ".agent-out/guard-report.json",
    };
    const out = summaryText(report) + annotations(report, { GITHUB_ACTIONS: "true" });
    const commands = out.split("\n").filter((l) => /^\s*(::|##\[)/.test(l));
    // only the guard's own annotations, after the summary: nothing stops them
    expect(commands.map((l) => l.slice(0, 8))).toEqual(["::error ", "::error "]);
    expect(out).toContain("`6000 ⏎ ::stop-commands::hidden`");
  });

  it("adds nothing to the Actions job summary when it prints its report as JSON", () => {
    const cache = path.join(ROOT, ".agent-out", "cache", "test-plan-actions");
    fs.mkdirSync(cache, { recursive: true });
    const summary = path.join(cache, "step-summary.md");
    fs.writeFileSync(summary, "");
    const env = { ...process.env, GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summary, JBL_GUARD_CACHE: cache };
    const json = spawnSync(process.execPath, [path.join(ROOT, "scripts/agent/guard.mjs"), "--plan", "--json", "--base", "HEAD", "--report", path.join(cache, "r.json")], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env });
    expect(JSON.parse(json.stdout).mode).toBe("plan");
    expect(fs.readFileSync(summary, "utf8")).toBe("");
    const text = spawnSync(process.execPath, [path.join(ROOT, "scripts/agent/guard.mjs"), "--plan", "--base", "HEAD", "--report", path.join(cache, "r.json")], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env });
    expect(text.stdout).toMatch(/PLANNED \(NOTHING RAN\)/);
    expect(fs.readFileSync(summary, "utf8")).toMatch(/^### Core guard \(static checks\)/);
  });

  it("runs when started through a symbolic link to the repository, and reads each test file's runtime counts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-guard-link-"));
    try {
      const link = path.join(dir, "balls-link");
      fs.symlinkSync(ROOT, link);
      expect(isMainModule(`file://${path.join(ROOT, "scripts/agent/guard.mjs")}`, path.join(link, "scripts/agent/guard.mjs"))).toBe(true);
      expect(isMainModule(`file://${path.join(ROOT, "scripts/agent/guard.mjs")}`, path.join(link, "scripts/agent/cli.mjs"))).toBe(false);
      expect(isMainModule(`file://${path.join(ROOT, "scripts/agent/guard.mjs")}`, undefined)).toBe(false);
      const cache = path.join(ROOT, ".agent-out", "cache", "test-plan-link");
      const r = spawnSync(process.execPath, [path.join(link, "scripts/agent/guard.mjs"), "--plan", "--json", "--base", "HEAD", "--report", path.join(cache, "r.json")], { cwd: dir, encoding: "utf8", timeout: 60_000, env: { ...process.env, ...NOT_IN_ACTIONS, JBL_GUARD_CACHE: cache } });
      expect(r.stdout.length, r.stderr).toBeGreaterThan(100);
      expect(JSON.parse(r.stdout).mode).toBe("plan");
      // the vitest report's counts per file: tests, skipped (pending, disabled) and todo
      const report = path.join(dir, "vitest.json");
      fs.writeFileSync(report, JSON.stringify({ success: true, numTotalTests: 4, testResults: [{ name: path.join(ROOT, "tests/a.test.ts"), status: "passed", assertionResults: [{ status: "passed" }, { status: "skipped" }, { status: "pending" }, { status: "todo" }] }] }));
      expect(vitestSignatures(report, ROOT)?.counts).toEqual({ "tests/a.test.ts": { tests: 4, skipped: 2, todo: 1 } });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
