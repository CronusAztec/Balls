/*
 * --- ai-guard --- The core guard's plan (`npm run guard`, scripts/agent/guard.mjs): which checks run in which lane, which
 * tests a change pulls in, what a change requires beyond tier 0 (escalation), the speed budget, the report's shape and the
 * exit code. Pure functions over plain data (scripts/agent/core.json, the changed files, an import graph), so
 * tests/coreGuard.test.ts proves the plan without running it; guard.mjs only executes it.
 *
 * The tiers:
 *  - tier 0 (default, no build): lane A the incremental type check; lane B ESLint (cached), `node --check` on the scripts,
 *    the desktop app's and the billing Worker's type checks and tests; lane C the core vitest list, then the tests related
 *    to the changed files (minus the slow ones, capped), the changelog check and the smoke suite's `--list`;
 *  - tier 1 (`--browser`): a /smoke-base build without Next's own type check (lane A already ran it), the export served
 *    locally and the core smoke blocks plus the changed features' blocks;
 *  - tier 2: the whole CI run (`npm run test:ci` and the four smoke shards), printed, never run here.
 * The guard never presents a subset as the whole check: what a change requires and this run did not do is listed, and the
 * exit code says so (0 green, 1 failed, 2 green but a higher tier is required).
 */

/** A test file of the core list with its measured wall time (vitest's per-file duration on a 4-CPU machine). */
export interface CoreTest {
  file: string;
  seconds: number;
}

/** A row of the escalation table: changed files matching `when` require more than tier 0. */
export interface EscalationRule {
  id: string;
  /** Globs of changed files (repository-relative, `/` separators). */
  when: string[];
  /** Why, in a sentence (printed). */
  reason: string;
  /** The whole CI run is required (hub files: most of the suite imports them). */
  tier2?: boolean;
  /** Test files that must pass: run in tier 0 unless slow (then listed as required). */
  tests?: string[];
  /** Smoke blocks that must pass: run in tier 1. */
  smoke?: string[];
}

/** scripts/agent/core.json, the guard's protected data. */
export interface CoreConfig {
  schema: 1;
  budget: { coldSeconds: number; warmSeconds: number };
  /** Measured once on a 4-CPU machine (seconds), for the speed budget. */
  measured: {
    tscCold: number;
    tscWarm: number;
    eslintCold: number;
    eslintWarm: number;
    nodeCheck: number;
    desktop: number;
    billing: number;
    vitestStartup: number;
    smallChecks: number;
  };
  vitest: {
    maxWorkers: number;
    core: CoreTest[];
    /** Globs of test files too slow for tier 0 (`--with-slow` runs them). */
    slow: string[];
    /** At most this many related test files run in tier 0; the rest are listed as required. */
    relatedCap: number;
  };
  /** Globs of the scripts `node --check` parses (lane B). */
  nodeCheck: string[];
  /** Files most of the suite imports: a change there requires tier 2. */
  hubFiles: string[];
  escalation: EscalationRule[];
  /** Folders whose files named after a mode (`<modeId>…`) belong to that mode (tests/<id>*.test.ts, its smoke block). */
  modeFileGlobs: string[];
  /** A mode's smoke blocks where the kebab-case rule (`<kebab>` or `*-<kebab>`) finds none or the wrong ones. */
  modeSmoke: Record<string, string[]>;
  browser: { basePath: string; port: number; smoke: string[] };
  tier2: string[];
}

/* ------------------------------------------------------------------------------------------------ paths and globs */

const REGEX_SPECIAL = /[.+^$()|[\]\\]/g;

/**
 * A glob as a RegExp over repository-relative paths: `**` any number of folders, `*` any characters but `/`, `?` one,
 * `{a,b}` either. A glob without a `/` matches a basename anywhere (like .gitignore), so `*.mjs` matches scripts/x.mjs.
 */
export function globToRegExp(glob: string): RegExp {
  const anchored = glob.includes("/");
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) re += "\\{";
      else {
        re += `(?:${glob
          .slice(i + 1, end)
          .split(",")
          .map((alt) => alt.replace(REGEX_SPECIAL, "\\$&").replace(/\*/g, "[^/]*"))
          .join("|")})`;
        i = end;
      }
    } else re += c.replace(REGEX_SPECIAL, "\\$&");
  }
  return new RegExp(anchored ? `^${re}$` : `(?:^|/)${re}$`);
}

/** Whether a path matches any of the globs. */
export function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(file));
}

/** `mergeRing` → `merge-ring` (a mode id as a smoke block's feature key). */
export const kebabCase = (id: string) => id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * The mode a source file belongs to: a file under one of `globs` whose basename starts with a mode id (the longest that
 * fits; the next character an upper-case letter, a dot or the end), case-insensitively for components (`FightLeagueSection`).
 */
export function modeOfFile(file: string, modeIds: readonly string[], globs: readonly string[]): string | null {
  if (!matchesAny(file, globs)) return null;
  const base = file.slice(file.lastIndexOf("/") + 1);
  let best: string | null = null;
  for (const id of modeIds) {
    if (base.length < id.length || base.slice(0, id.length).toLowerCase() !== id.toLowerCase()) continue;
    const next = base[id.length];
    if (next !== undefined && next !== "." && !/[A-Z]/.test(next)) continue;
    if (best === null || id.length > best.length) best = id;
  }
  return best;
}

/** A mode's own smoke blocks: core.json's list for it, else the block named after it (`merge-ring`, `gerald-glass`). */
export function modeSmokeBlocks(modeId: string, blocks: readonly string[], config: Pick<CoreConfig, "modeSmoke">): string[] {
  const listed = config.modeSmoke[modeId];
  if (listed) return listed.filter((b) => blocks.includes(b));
  const key = kebabCase(modeId);
  return blocks.filter((b) => b === key || b.endsWith(`-${key}`));
}

/** A mode's own test files: tests/<id>*.test.ts. */
export function modeTestFiles(modeId: string, testFiles: readonly string[]): string[] {
  const re = globToRegExp(`tests/${modeId}*.test.ts`);
  return testFiles.filter((f) => re.test(f)).sort();
}

/* ------------------------------------------------------------------------------------------------ related tests */

/**
 * The test files that import a changed file, directly or through other files (`imports`: file → the files it imports,
 * resolved and repository-relative), plus the changed test files themselves: the nearest first (a changed test, then the
 * tests that import a changed file, then those one file further…), alphabetically within a distance – so a cap keeps the
 * most direct ones.
 */
export function relatedTests(changed: readonly string[], imports: Readonly<Record<string, readonly string[]>>, testFiles: readonly string[]): string[] {
  const importers = new Map<string, string[]>();
  for (const [from, list] of Object.entries(imports)) {
    for (const to of list) {
      if (!importers.has(to)) importers.set(to, []);
      importers.get(to)!.push(from);
    }
  }
  const tests = new Set(testFiles);
  const distance = new Map<string, number>();
  let frontier = [...new Set(changed)];
  for (let d = 0; frontier.length; d++) {
    const next: string[] = [];
    for (const file of frontier) {
      if (distance.has(file)) continue;
      distance.set(file, d);
      for (const parent of importers.get(file) ?? []) if (!distance.has(parent)) next.push(parent);
    }
    frontier = next;
  }
  return [...distance]
    .filter(([f]) => tests.has(f))
    .sort(([a, da], [b, db]) => da - db || a.localeCompare(b))
    .map(([f]) => f);
}

/* ------------------------------------------------------------------------------------------------ escalation */

/** What a change requires beyond what tier 0 runs by itself. */
export interface EscalationItem {
  id: string;
  reason: string;
  /** The changed files that triggered it. */
  files: string[];
  /** 1: smoke blocks (`npm run guard:browser`), 2: the whole CI run. */
  tier: 1 | 2;
  tests: string[];
  smoke: string[];
}

export interface Escalation {
  items: EscalationItem[];
  /** The highest tier any item needs (0 when nothing beyond tier 0 is required). */
  requiredTier: 0 | 1 | 2;
  /** Every smoke block the items name (the changed feature keys for tier 1). */
  smoke: string[];
  /** Every test file the items name. */
  tests: string[];
}

/**
 * The escalation of a change, from core.json's table: hub files require tier 2; the table's rows add their tests and smoke
 * blocks; a mode's file adds tests/<id>*.test.ts and the mode's smoke block. Smoke blocks the suite does not have are left out.
 */
export function planEscalation(input: { changed: readonly string[]; config: CoreConfig; modeIds: readonly string[]; smokeBlocks: readonly string[]; testFiles: readonly string[] }): Escalation {
  const { changed, config, modeIds, smokeBlocks, testFiles } = input;
  const items: EscalationItem[] = [];
  const hub = changed.filter((f) => matchesAny(f, config.hubFiles));
  if (hub.length) {
    items.push({ id: "hub", reason: "a hub file changed: most of the suite imports it, so tier 0's subset is not enough", files: hub, tier: 2, tests: [], smoke: [] });
  }
  for (const rule of config.escalation) {
    const files = changed.filter((f) => matchesAny(f, rule.when));
    if (!files.length) continue;
    const smoke = (rule.smoke ?? []).filter((b) => smokeBlocks.includes(b));
    items.push({ id: rule.id, reason: rule.reason, files, tier: rule.tier2 ? 2 : 1, tests: [...(rule.tests ?? [])], smoke });
  }
  const byMode = new Map<string, string[]>();
  for (const f of changed) {
    const mode = modeOfFile(f, modeIds, config.modeFileGlobs);
    if (mode === null) continue;
    if (!byMode.has(mode)) byMode.set(mode, []);
    byMode.get(mode)!.push(f);
  }
  for (const [mode, files] of [...byMode].sort(([a], [b]) => a.localeCompare(b))) {
    items.push({
      id: `mode:${mode}`,
      reason: `a file of the ${mode} mode changed: its own tests and smoke block`,
      files,
      tier: 1,
      tests: modeTestFiles(mode, testFiles),
      smoke: modeSmokeBlocks(mode, smokeBlocks, config),
    });
  }
  const requiredTier = items.reduce<0 | 1 | 2>((t, i) => (i.tier > t ? i.tier : t), 0);
  // A tier-1 item with no smoke block and every test runnable in tier 0 asks for nothing beyond tier 0.
  const needsMore = items.some((i) => i.tier === 2 || i.smoke.length > 0);
  return {
    items,
    requiredTier: needsMore ? requiredTier : 0,
    smoke: [...new Set(items.flatMap((i) => i.smoke))],
    tests: [...new Set(items.flatMap((i) => i.tests))].sort(),
  };
}

/* ------------------------------------------------------------------------------------------------ the vitest lists */

export interface VitestPlan {
  /** The core list (core.json), in its order. */
  core: string[];
  /** Related and escalated test files run after the core list (not in it, not slow unless `withSlow`, at most the cap). */
  related: string[];
  /** Slow files a change pulled in that this run leaves out (required: `--with-slow`). */
  slowSkipped: string[];
  /** Related files past the cap (required: run them, or tier 2). */
  capped: string[];
}

/**
 * Lane C's vitest lists. Escalated tests (a mode's own, a table row's) come first and are never capped; slow files are left
 * out unless `withSlow`, and listed.
 */
export function planVitest(input: { config: CoreConfig; related: readonly string[]; escalated: readonly string[]; withSlow?: boolean }): VitestPlan {
  const { config } = input;
  const core = config.vitest.core.map((t) => t.file);
  const inCore = new Set(core);
  const wanted = [...new Set([...input.escalated, ...input.related])].filter((f) => !inCore.has(f));
  const slowSkipped = input.withSlow ? [] : wanted.filter((f) => matchesAny(f, config.vitest.slow));
  const runnable = wanted.filter((f) => !slowSkipped.includes(f));
  const escalated = new Set(input.escalated);
  const must = runnable.filter((f) => escalated.has(f));
  const rest = runnable.filter((f) => !escalated.has(f));
  const room = input.withSlow ? rest.length : Math.max(0, config.vitest.relatedCap - must.length);
  // `related` comes nearest first (relatedTests), so the cap keeps the most direct tests
  return { core, related: [...must, ...rest.slice(0, room)].sort(), slowSkipped: slowSkipped.sort(), capped: rest.slice(room).sort() };
}

/* ------------------------------------------------------------------------------------------------ lanes and steps */

/** One command of a lane: argv[0] "node" is the running Node; paths are repository-relative unless `cwd` says otherwise. */
export interface GuardStep {
  id: string;
  title: string;
  argv: string[];
  /** Working directory, repository-relative ("" = the root). */
  cwd: string;
  env?: Record<string, string>;
  /** A folder that must exist first (an install), with what to run when it does not. */
  requires?: { path: string; fix: string };
  /** How guard.mjs reads the output: failure signatures and details. */
  parser: "tsc" | "eslint" | "vitest" | "plain" | "node-check";
  /** For the vitest parser: the JSON report it writes (repository-relative or absolute). */
  jsonReport?: string;
  /** For node-check: the files (resolved by guard.mjs from config.nodeCheck). */
  files?: string[];
}

export interface GuardLane {
  id: "A" | "B" | "C" | "T1";
  title: string;
  steps: GuardStep[];
}

/** The environment every test command of the guard runs with: no silent browser skips, a stale export fails perfGuards. */
export const GUARD_TEST_ENV: Readonly<Record<string, string>> = { JBL_REQUIRE_BROWSER: "1", JBL_GUARD: "1" };

const vitestArgv = (bin: string, files: readonly string[], workers: number, json: string) => [
  "node",
  bin,
  "run",
  "--allowOnly=false",
  `--maxWorkers=${workers}`,
  "--minWorkers=1",
  "--reporter=dot",
  "--reporter=json",
  `--outputFile.json=${json}`,
  ...files,
];

/**
 * Tier 0's three lanes. `cacheDir` holds the incremental type-check state, ESLint's cache and the vitest reports (absolute or
 * repository-relative); `nodeCheckFiles` are the scripts to parse.
 */
export function planTier0(input: { config: CoreConfig; vitest: VitestPlan; cacheDir: string; nodeCheckFiles: readonly string[] }): GuardLane[] {
  const { config, vitest, cacheDir } = input;
  const cache = (name: string) => `${cacheDir.replace(/\/+$/, "")}/${name}`;
  const desktopFix = "npm ci --prefix desktop (with ELECTRON_SKIP_BINARY_DOWNLOAD=1)";
  const billingFix = "npm ci --prefix billing";
  const laneC: GuardStep[] = [
    {
      id: "vitest-core",
      title: `vitest: the core list (${vitest.core.length} files)`,
      argv: vitestArgv("node_modules/vitest/vitest.mjs", vitest.core, config.vitest.maxWorkers, cache("vitest-core.json")),
      cwd: "",
      env: { ...GUARD_TEST_ENV },
      parser: "vitest",
      jsonReport: cache("vitest-core.json"),
    },
  ];
  if (vitest.related.length) {
    laneC.push({
      id: "vitest-related",
      title: `vitest: tests related to the change (${vitest.related.length} files)`,
      argv: vitestArgv("node_modules/vitest/vitest.mjs", vitest.related, config.vitest.maxWorkers, cache("vitest-related.json")),
      cwd: "",
      env: { ...GUARD_TEST_ENV },
      parser: "vitest",
      jsonReport: cache("vitest-related.json"),
    });
  }
  laneC.push(
    { id: "changelog", title: "changelog: CHANGELOG.md matches src/content/changelog.json", argv: ["node", "scripts/changelog.mjs", "--check"], cwd: "", parser: "plain" },
    { id: "smoke-list", title: "smoke suite: every block parses and has a shard (--list, no browser)", argv: ["node", "scripts/smoke-test.mjs", "--list"], cwd: "", env: { SMOKE_SHARD: "", SMOKE_ONLY: "" }, parser: "plain" },
  );
  return [
    {
      id: "A",
      title: "type check (site)",
      steps: [{ id: "tsc", title: "tsc --noEmit (incremental)", argv: ["node", "node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", cache("site.tsbuildinfo")], cwd: "", parser: "tsc" }],
    },
    {
      id: "B",
      title: "lint, scripts, desktop app, billing Worker",
      steps: [
        { id: "eslint", title: "eslint . (cached)", argv: ["node", "node_modules/eslint/bin/eslint.js", ".", "--cache", "--cache-location", `${cache("eslint")}/`, "--format", "json"], cwd: "", parser: "eslint" },
        { id: "node-check", title: `node --check on the scripts (${input.nodeCheckFiles.length} files)`, argv: ["node", "--check"], cwd: "", parser: "node-check", files: [...input.nodeCheckFiles] },
        {
          id: "desktop-tsc",
          title: "desktop: tsc --noEmit -p tsconfig.json",
          argv: ["node", "node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json", "--incremental", "--tsBuildInfoFile", cache("desktop.tsbuildinfo")],
          cwd: "desktop",
          requires: { path: "desktop/node_modules", fix: desktopFix },
          parser: "tsc",
        },
        {
          id: "desktop-vitest",
          title: "desktop: vitest run",
          argv: vitestArgv("node_modules/vitest/vitest.mjs", [], 1, cache("vitest-desktop.json")),
          cwd: "desktop",
          env: { ...GUARD_TEST_ENV },
          requires: { path: "desktop/node_modules", fix: desktopFix },
          parser: "vitest",
          jsonReport: cache("vitest-desktop.json"),
        },
        { id: "billing-tsc", title: "billing: tsc --noEmit", argv: ["node", "node_modules/typescript/bin/tsc", "--noEmit"], cwd: "billing", requires: { path: "billing/node_modules", fix: billingFix }, parser: "tsc" },
        {
          id: "billing-vitest",
          title: "billing: vitest run",
          argv: vitestArgv("node_modules/vitest/vitest.mjs", [], 1, cache("vitest-billing.json")),
          cwd: "billing",
          env: { ...GUARD_TEST_ENV },
          requires: { path: "billing/node_modules", fix: billingFix },
          parser: "vitest",
          jsonReport: cache("vitest-billing.json"),
        },
      ],
    },
    { id: "C", title: "unit tests, changelog, smoke list", steps: laneC },
  ];
}

/** Tier 1's smoke blocks: core.json's browser list plus the change's feature blocks, in the suite's order, each once. */
export function tier1SmokeBlocks(config: CoreConfig, escalation: Escalation, blocks: readonly string[]): string[] {
  const wanted = new Set([...config.browser.smoke, ...escalation.smoke]);
  return blocks.filter((b) => wanted.has(b));
}

/**
 * Tier 1 (`--browser`): build under the smoke base path without Next's own type check (lane A ran it), export without
 * obfuscation, then run the smoke blocks against the served export. guard.mjs serves `out/` itself between the two steps.
 */
export function planTier1(input: { config: CoreConfig; smoke: readonly string[]; port: number; outDir: string }): GuardLane {
  const base = input.config.browser.basePath;
  const url = `http://localhost:${input.port}${base}`;
  const buildEnv = { NEXT_PUBLIC_BASE_PATH: base, NEXT_PUBLIC_SITE_URL: url, JBL_BUILD_SKIP_TYPECHECK: "1", OBFUSCATE: "0" };
  return {
    id: "T1",
    title: "browser: build, serve, core smoke blocks",
    steps: [
      { id: "next-build", title: "next build --no-lint (type check skipped: lane A ran it)", argv: ["node", "node_modules/next/dist/bin/next", "build", "--no-lint"], cwd: "", env: buildEnv, parser: "plain" },
      { id: "postexport", title: "postexport (OBFUSCATE=0)", argv: ["node", "scripts/postexport.mjs"], cwd: "", env: buildEnv, parser: "plain" },
      {
        id: "smoke",
        title: `smoke: ${input.smoke.length} blocks`,
        argv: ["node", "scripts/smoke-test.mjs"],
        cwd: "",
        env: { BASE_URL: url, SMOKE_ONLY: input.smoke.join(","), SMOKE_SHARD: "", OUT_DIR: input.outDir, OBFUSCATE: "0" },
        parser: "plain",
      },
    ],
  };
}

/* ------------------------------------------------------------------------------------------------ the speed budget */

export interface LaneEstimate {
  A: number;
  B: number;
  C: number;
  /** The lanes run at once: the slowest one. */
  total: number;
}

/** The expected wall time of tier 0 from core.json's measurements: cold (no caches) or warm (caches, nothing changed). */
export function estimateTier0(config: CoreConfig, plan: VitestPlan, warm: boolean): LaneEstimate {
  const m = config.measured;
  const seconds = new Map(config.vitest.core.map((t) => [t.file, t.seconds]));
  const median = (() => {
    const s = config.vitest.core.map((t) => t.seconds).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 1;
  })();
  const testTime = (files: readonly string[]) => files.reduce((sum, f) => sum + (seconds.get(f) ?? median), 0);
  const workers = Math.max(1, config.vitest.maxWorkers);
  const vitestWall = (files: readonly string[]) => (files.length ? m.vitestStartup + testTime(files) / workers : 0);
  const A = warm ? m.tscWarm : m.tscCold;
  const B = (warm ? m.eslintWarm : m.eslintCold) + m.nodeCheck + m.desktop + m.billing;
  const C = vitestWall(plan.core) + vitestWall(plan.related) + m.smallChecks;
  return { A, B, C, total: Math.max(A, B, C) };
}

/* ------------------------------------------------------------------------------------------------ results, report, exit */

export type StepStatus = "passed" | "failed" | "pre-existing" | "skipped";

export interface StepResult {
  id: string;
  title: string;
  lane: GuardLane["id"] | "S";
  status: StepStatus;
  seconds: number;
  /** One line per distinct failure (a test, a type error, a lint rule in a file), stable across line shifts: the baseline's key. */
  signatures: string[];
  /** Failure signatures that a `--baseline` run recorded on the untouched tree. */
  preExisting?: string[];
  /** The last lines of the output, for a failed step. */
  tail?: string[];
  log?: string;
  note?: string;
}

/**
 * A step's status against the baseline: failed when it has a failure signature the baseline does not, "pre-existing" when
 * every one of its failures was recorded by `--baseline` (the change did not cause it).
 */
export function againstBaseline(failed: boolean, signatures: readonly string[], baseline: readonly string[] | undefined): { status: StepStatus; preExisting: string[] } {
  if (!failed) return { status: "passed", preExisting: [] };
  if (!baseline || !signatures.length) return { status: "failed", preExisting: [] };
  const known = new Set(baseline);
  const pre = signatures.filter((s) => known.has(s));
  return { status: pre.length === signatures.length ? "pre-existing" : "failed", preExisting: pre };
}

/** The static checks' verdicts (protectedDiff.ts): whether each one fails the guard. */
export interface StaticVerdicts {
  /** A changed or removed fingerprint without its Fingerprint-Change trailer. */
  fingerprintViolations: number;
  /** A weakened test without its Test-Change trailer (an added .only always). */
  weakeningViolations: number;
  /** Protected paths and regions: reported for owner review, never a failure (owner decision for P0). */
  protectedFindings: number;
}

/** 0 green, 1 failed, 2 green but a higher tier is required (or required tests were left out). */
export function exitCode(input: { steps: readonly StepResult[]; statics: StaticVerdicts; escalation: Escalation; tier: 0 | 1; vitest: VitestPlan; baselineRun?: boolean }): 0 | 1 | 2 {
  if (input.baselineRun) return 0;
  if (input.steps.some((s) => s.status === "failed")) return 1;
  if (input.statics.fingerprintViolations > 0 || input.statics.weakeningViolations > 0) return 1;
  const required = input.escalation.requiredTier;
  if (required === 2) return 2;
  if (required === 1 && input.tier < 1) return 2;
  if (input.vitest.slowSkipped.length || input.vitest.capped.length) return 2;
  return 0;
}

export const VERDICTS = { 0: "green", 1: "failed", 2: "green, higher tier required" } as const;

/** The commands a reader runs next for what this run did not cover. */
export function requiredCommands(input: { escalation: Escalation; vitest: VitestPlan; tier: 0 | 1; config: CoreConfig }): string[] {
  // tier 2 runs the whole suite and every smoke block: it covers the rest
  if (input.escalation.requiredTier === 2) return [...input.config.tier2];
  const out: string[] = [];
  const left = [...input.vitest.slowSkipped, ...input.vitest.capped];
  if (left.length) out.push(`npx vitest run ${left.join(" ")}`);
  if (input.tier < 1 && input.escalation.smoke.length) out.push(`npm run guard:browser   # adds SMOKE_ONLY=${input.escalation.smoke.join(",")}`);
  return out;
}

/** The report's top-level keys (report.json, .agent-out/guard-report.json); tests/coreGuard.test.ts pins them. */
export const REPORT_KEYS = [
  "schema",
  "tool",
  "tier",
  "verdict",
  "exitCode",
  "startedAt",
  "seconds",
  "base",
  "head",
  "changed",
  "lanes",
  "failures",
  "escalation",
  "required",
  "vitest",
  "fingerprints",
  "protected",
  "weakening",
  "budget",
  "baseline",
] as const;
