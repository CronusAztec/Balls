import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { BLOCKS_FILE, TIMING_FILE, createSmokeBlocks } from "../scripts/smoke/blocks.mjs";
import {
  DEFAULT_SHARDS,
  assignShards,
  blockWeights,
  duplicateTitles,
  findBlockTitles,
  formatList,
  formatLoads,
  matchesOnly,
  median,
  mergeTimings,
  parseOnly,
  parseShardSpec,
  parseSmokeArgs,
  refreshBaseline,
  shardTitles,
  slowestLines,
  unmatchedOnly,
} from "../scripts/smoke/shards.mjs";
import {
  SHARD_JOB,
  TIMEOUT_MARGIN_SECONDS,
  commandData,
  jobSeconds,
  main as verdictMain,
  smokeVerdict,
  timeoutEvidence,
  workflowFile,
} from "../scripts/smoke/verdict.mjs";

/**
 * --- smoke-sharding --- The split of the browser smoke suite into CI shards (scripts/smoke/shards.mjs), the block runner
 * (scripts/smoke/blocks.mjs) and the shape of the suite they rely on: every block is a top-level
 * `await smokeBlock("title", async () => { … });` that the static scan finds, no work happens outside the blocks, and – for
 * N = 1…8 with the checked-in baseline – the shards are disjoint, complete, order-stable and balanced. Also the verdict of
 * deploy.yml's smoke-summary job (scripts/smoke/verdict.mjs): a shard that ran out of time fails it, newer run or not.
 */

const ROOT = path.resolve(__dirname, "..");
const SUITE_FILE = "scripts/smoke-test.mjs";
const SUITE = fs.readFileSync(path.join(ROOT, SUITE_FILE), "utf8");
const BASELINE: Record<string, number> = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/smoke-timing.json"), "utf8"));
const TITLES = findBlockTitles(SUITE);
const source = ts.createSourceFile(SUITE_FILE, SUITE, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const firstLine = (node: ts.Node) => `line ${lineOf(node)}: ${node.getText(source).split("\n")[0].slice(0, 110)}`;
/** What a failure in the suite's shape asks for. */
const WRAP = 'every section of the suite is a top-level `await smokeBlock("kebab-title", async () => { … });` above smoke.endBlocks() (README "Smoke test shards")';

/** The title of a top-level `await smokeBlock("title", async () => { … });` statement (null for any other statement). */
function blockTitle(statement: ts.Statement): string | null {
  if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) return null;
  const call = statement.expression.expression;
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "smokeBlock") return null;
  const [title, fn, ...rest] = call.arguments;
  if (rest.length || !title || !fn || !ts.isStringLiteral(title) || !ts.isArrowFunction(fn) || fn.parameters.length || !ts.isBlock(fn.body)) return null;
  return fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? title.text : null;
}

/** Every call of smokeBlock anywhere in the suite. */
function smokeBlockCalls(): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "smokeBlock") calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/** Whether evaluating a statement does work – an `await` or a check – outside the functions it only defines. */
function doesWork(node: ts.Node): boolean {
  let work = false;
  const visit = (n: ts.Node) => {
    if (work || ts.isFunctionLike(n)) return;
    if (ts.isAwaitExpression(n) || (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ["check", "timingCheck", "inconclusive"].includes(n.expression.text))) {
      work = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return work;
}

const statements = [...source.statements];
const firstBlock = statements.findIndex((s) => blockTitle(s) !== null);
const endMarker = statements.findIndex((s) => ts.isExpressionStatement(s) && s.expression.getText(source) === "smoke.endBlocks()");

/** A seeded shuffle (a small LCG), so a failing order is reproducible. */
function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("the suite's blocks (scripts/smoke-test.mjs)", () => {
  it("are exactly the top-level smokeBlock statements the static scan finds, each title once and in kebab-case", () => {
    const parsed = statements.map(blockTitle).filter((t): t is string => t !== null);
    expect(TITLES, WRAP).toEqual(parsed);
    // no smokeBlock call anywhere else (nested in a block, in a loop, with a computed title…): the scan would miss it
    expect(smokeBlockCalls().map(firstLine), WRAP).toHaveLength(parsed.length);
    expect(duplicateTitles(TITLES), "block titles are the keys of the split and the baseline: each one once").toEqual([]);
    for (const title of TITLES) expect(title).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(TITLES.length).toBeGreaterThanOrEqual(80);
    // the scan reaches the first section and the last ones
    for (const title of ["static-hosting", "pages", "modes", "desktop-ai-fix", "mode-thumbnails"]) expect(TITLES).toContain(title);
  });

  it("do all the work: between the first block and smoke.endBlocks() every statement is a block or a declaration that only defines", () => {
    expect(firstBlock).toBeGreaterThan(0);
    expect(endMarker).toBeGreaterThan(firstBlock);
    const outside = statements
      .slice(firstBlock, endMarker)
      .filter((s) => blockTitle(s) === null && !ts.isFunctionDeclaration(s) && !ts.isEmptyStatement(s) && !(ts.isVariableStatement(s) && !doesWork(s)));
    // code here would run in every shard (twice the checks, four times the time): wrap it in a block of its own
    expect(outside.map(firstLine), WRAP).toEqual([]);
  });

  it("run no check before the first block, and the report after smoke.endBlocks() opens no page", () => {
    expect(statements.slice(0, firstBlock).filter(doesWork).filter((s) => /\b(check|timingCheck|inconclusive)\(/.test(s.getText(source))).map(firstLine)).toEqual([]);
    expect(statements.slice(0, firstBlock).filter(doesWork).filter((s) => /\bpage\.goto\(/.test(s.getText(source))).map(firstLine)).toEqual([]);
    expect(statements.slice(endMarker).filter((s) => /\bpage\.goto\(|\.newPage\(|\.newContext\(/.test(s.getText(source))).map(firstLine), WRAP).toEqual([]);
    // the report (the slowest blocks, what a shard ran) comes after the blocks – directly or in a function the suite calls there
    expect(statements.slice(endMarker).some((s) => /\bsmoke\.report\(\)/.test(s.getText(source)))).toBe(true);
  });

  it("have a baseline of title → seconds that times most of them (a new block weighs the median until the next refresh)", () => {
    for (const [title, seconds] of Object.entries(BASELINE)) {
      expect(typeof seconds, title).toBe("number");
      expect(seconds, title).toBeGreaterThanOrEqual(0);
    }
    expect(TITLES.filter((t) => Object.prototype.hasOwnProperty.call(BASELINE, t)).length).toBeGreaterThanOrEqual(TITLES.length / 2);
  });
});

describe("the split of the real suite with the checked-in baseline", () => {
  for (let n = 1; n <= 8; n++) {
    it(`${n} shard${n === 1 ? "" : "s"}: disjoint, complete, order-stable and balanced (the heaviest at most 1.6 × the mean)`, () => {
      const shards = Array.from({ length: n }, (_, i) => shardTitles(TITLES, BASELINE, i + 1, n));
      const all = shards.flat();
      // disjoint and complete: every block in exactly one shard
      expect(new Set(all).size).toBe(all.length);
      expect([...all].sort()).toEqual([...TITLES].sort());
      expect(shards.every((shard) => shard.length > 0)).toBe(true);
      // order-stable: a shard runs its blocks in the suite's order, and the split depends neither on the order the blocks are
      // listed in nor on anything but the baseline and N
      for (const shard of shards) expect(shard).toEqual(TITLES.filter((t) => shard.includes(t)));
      const { shardOf, loads, weights } = assignShards(TITLES, BASELINE, n);
      expect(assignShards(TITLES, BASELINE, n).loads).toEqual(loads);
      for (const seed of [3, 9, 42]) {
        const again = assignShards(shuffled(TITLES, seed), BASELINE, n).shardOf;
        for (const title of TITLES) expect(again.get(title), title).toBe(shardOf.get(title));
      }
      // the loads are the shards' weights, and the heaviest shard is at most 1.6 × the mean
      shards.forEach((shard, i) => expect(loads[i]).toBeCloseTo(shard.reduce((sum, t) => sum + (weights.get(t) ?? NaN), 0), 6));
      const mean = loads.reduce((a, b) => a + b, 0) / n;
      expect(Math.max(...loads), formatLoads(TITLES, BASELINE, n).join("\n")).toBeLessThanOrEqual(1.6 * mean);
    });
  }

  it("narrows with SMOKE_ONLY inside every shard: the filtered shards are disjoint and together the filtered suite", () => {
    const only = parseOnly("fight-league, *WATERMARK* ,review-fix-*");
    const wanted = TITLES.filter((t) => matchesOnly(t, only));
    expect(wanted).toContain("fight-league");
    expect(wanted).toContain("free-watermark");
    expect(wanted.filter((t) => t.startsWith("review-fix-")).length).toBeGreaterThanOrEqual(4);
    const picked = Array.from({ length: DEFAULT_SHARDS }, (_, i) => shardTitles(TITLES, BASELINE, i + 1, DEFAULT_SHARDS).filter((t) => matchesOnly(t, only))).flat();
    expect([...picked].sort()).toEqual([...wanted].sort());
    expect(new Set(picked).size).toBe(picked.length);
  });

  it("gives a block the baseline does not know the median weight and a shard of its own", () => {
    const withNew = [...TITLES, "zz-new-feature"];
    const { weights, missing, median: mid } = blockWeights(withNew, BASELINE);
    expect(missing).toContain("zz-new-feature");
    expect(weights.get("zz-new-feature")).toBe(mid);
    expect(mid).toBe(median(TITLES.filter((t) => t in BASELINE).map((t) => BASELINE[t])));
    for (let n = 1; n <= 8; n++) {
      const owners = Array.from({ length: n }, (_, i) => shardTitles(withNew, BASELINE, i + 1, n)).filter((s) => s.includes("zz-new-feature"));
      expect(owners).toHaveLength(1);
    }
  });

  it("lists every block with its shard of the CI matrix, the size the workflows run", () => {
    const lines = formatList(TITLES, BASELINE);
    expect(lines).toHaveLength(TITLES.length);
    lines.forEach((line, i) => {
      expect(line).toMatch(new RegExp(`^ ?\\d+/${DEFAULT_SHARDS} +\\d+\\.\\d s  `));
      expect(line).toContain(TITLES[i]);
    });
    for (const file of [".github/workflows/deploy.yml", ".github/workflows/smoke.yml"]) {
      const workflow = fs.readFileSync(path.join(ROOT, file), "utf8");
      expect(workflow, file).toContain(`shard: [${Array.from({ length: DEFAULT_SHARDS }, (_, i) => i + 1).join(", ")}]`);
      expect(workflow, file).toContain(`SMOKE_SHARD: \${{ matrix.shard }}/${DEFAULT_SHARDS}`);
      expect(workflow, file).toContain(`name: smoke (shard \${{ matrix.shard }} of ${DEFAULT_SHARDS})`);
      expect(workflow, file).toContain("fail-fast: false");
      expect(workflow, file).toContain("name: smoke-screenshots-${{ matrix.shard }}");
      expect(workflow, file).toMatch(/\n {2}smoke-summary:\n {4}needs: smoke\n {4}if: always\(\)/);
      expect(workflow, file).toContain("run: node scripts/smoke/summary.mjs smoke-screenshots");
    }
    // the deploy waits for the verdict on all the shards
    expect(fs.readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8")).toContain("needs: [build, smoke, smoke-summary]");
  });
});

describe("the partition helpers", () => {
  it("parse a shard as i/N, 1-based", () => {
    expect(parseShardSpec("1/4")).toEqual({ index: 1, total: 4 });
    expect(parseShardSpec(" 2 / 4 ")).toEqual({ index: 2, total: 4 });
    expect(parseShardSpec("1/1")).toEqual({ index: 1, total: 1 });
    for (const bad of ["0/4", "5/4", "1/0", "a/b", "1", "", "1/4/2", "1.5/4", "-1/4", undefined]) expect(() => parseShardSpec(bad), String(bad)).toThrow(/i\/N/);
  });

  it("read the flags and the environment: --shard beats SMOKE_SHARD, unknown flags throw", () => {
    expect(parseSmokeArgs([], {})).toEqual({ shard: null, list: false, writeTiming: false, only: [] });
    expect(parseSmokeArgs(["--shard", "2/4"], {}).shard).toEqual({ index: 2, total: 4 });
    expect(parseSmokeArgs(["--shard=3/4"], {}).shard).toEqual({ index: 3, total: 4 });
    expect(parseSmokeArgs([], { SMOKE_SHARD: "1/2" }).shard).toEqual({ index: 1, total: 2 });
    expect(parseSmokeArgs(["--shard", "2/2"], { SMOKE_SHARD: "1/2" }).shard).toEqual({ index: 2, total: 2 });
    expect(parseSmokeArgs(["--list", "--write-timing"], { SMOKE_ONLY: " Fight-League,, pwa " })).toEqual({ shard: null, list: true, writeTiming: true, only: ["fight-league", "pwa"] });
    expect(() => parseSmokeArgs(["--shards", "1/4"], {})).toThrow(/unknown argument/);
    expect(() => parseSmokeArgs(["--shard"], {})).toThrow(/i\/N/);
    expect(() => parseSmokeArgs([], { SMOKE_SHARD: "9/4" })).toThrow(/i\/N/);
  });

  it("match SMOKE_ONLY by whole title, with * for any characters", () => {
    const titles = ["teams", "teams-camera", "camera", "fight-league", "free-watermark", "watermark-everywhere"];
    const pick = (value: string) => titles.filter((t) => matchesOnly(t, parseOnly(value)));
    expect(pick("")).toEqual(titles);
    expect(pick("teams")).toEqual(["teams"]);
    expect(pick("camera")).toEqual(["camera"]);
    expect(pick("Fight-League")).toEqual(["fight-league"]);
    expect(pick("teams*")).toEqual(["teams", "teams-camera"]);
    expect(pick("*watermark*")).toEqual(["free-watermark", "watermark-everywhere"]);
    expect(pick("teams,camera")).toEqual(["teams", "camera"]);
    expect(pick("fight.league")).toEqual([]); // "." is a dot, not any character
    expect(unmatchedOnly(titles, parseOnly("teams, nope, *water*"))).toEqual(["nope"]);
  });

  it("split greedily by weight and title (longest first, into the lightest shard, the lowest index on a tie)", () => {
    const titles = ["a", "b", "c", "d", "e", "f"];
    const baseline = { a: 10, b: 5, c: 7, d: 1, e: 3 };
    // f weighs the median of the known blocks (5); order: a 10, c 7, b 5, f 5, e 3, d 1
    const { shardOf, loads } = assignShards(titles, baseline, 2);
    expect(Object.fromEntries(shardOf)).toEqual({ a: 1, c: 2, b: 2, f: 1, e: 2, d: 1 });
    expect(loads).toEqual([16, 15]);
    expect(shardTitles(titles, baseline, 1, 2)).toEqual(["a", "d", "f"]);
    // equal weights: by title, round robin over the shards
    expect(Object.fromEntries(assignShards(["d", "c", "b", "a"], {}, 2).shardOf)).toEqual({ a: 1, b: 2, c: 1, d: 2 });
    expect(() => assignShards(titles, baseline, 0)).toThrow();
  });

  it("weigh unknown blocks by the median of the known ones (of the whole baseline when none is known; 1 s without one)", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(blockWeights(["x"], { a: 2, b: 4, c: 9 }).median).toBe(4);
    expect(blockWeights(["x"], {}).median).toBe(1);
    expect(blockWeights(["a", "x"], { a: 2, b: 40, broken: -1 }).weights.get("x")).toBe(2);
  });

  it("find the block titles of a source by its `await smokeBlock(\"title\", async () => {` lines only", () => {
    const src = [
      'await smokeBlock("first-block", async () => {',
      "});",
      '// await smokeBlock("in-a-comment", async () => {',
      '  await smokeBlock("indented", async () => {',
      'await smokeBlock( "with \\"quotes\\"" , async () => {',
      'await smokeBlock("first-block", async () => {',
    ].join("\n");
    const titles = findBlockTitles(src);
    expect(titles).toEqual(["first-block", 'with "quotes"', "first-block"]);
    expect(duplicateTitles(titles)).toEqual(["first-block"]);
  });

  it("print the slowest blocks, merge the shards' timings and refresh the baseline in suite order", () => {
    expect(slowestLines({ a: 1.04, b: 30, c: 30, d: 0.2 }, { a: 1, b: 2 }, 3)).toEqual(["     30.0 s  b (2 checks)", "     30.0 s  c", "      1.0 s  a (1 check)"]);
    expect(mergeTimings([{ a: 1 }, { a: 2, b: 3 }, { c: Number.NaN }])).toEqual({ merged: { a: 2, b: 3 }, duplicates: ["a"] });
    expect(refreshBaseline(["b", "a", "z", "b"], { a: 1, b: 2, gone: 3 }, { b: 2.26 })).toEqual({ b: 2.3, a: 1 });
    expect(Object.keys(refreshBaseline(["b", "a"], { a: 1, b: 2 }, {}))).toEqual(["b", "a"]);
  });
});

describe("the block runner (scripts/smoke/blocks.mjs)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-shards-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const suiteFile = path.join(tmp, "suite.mjs");
  fs.writeFileSync(suiteFile, ["a", "b", "c", "d"].map((t) => `await smokeBlock("${t}", async () => {\n});`).join("\n"));
  const BASE = { a: 10, b: 5, c: 7, d: 1 };
  /** Checks per block of the fake suite (the second check of c fails; d also has a timing check that comes out inconclusive). */
  const CHECKS: Record<string, boolean[]> = { a: [true, true], b: [true], c: [true, false, true], d: [true] };

  /** Runs the fake suite like smoke-test.mjs does: the four blocks in order, then the report (and one check after it). */
  async function run(argv: string[], env: Record<string, string> = {}, extra: { outside?: boolean } = {}) {
    const name = [...argv, ...Object.entries(env).map(([k, v]) => `${k}=${v}`)].join("_").replace(/[^a-z0-9]+/gi, "-") || "full";
    const outDir = path.join(tmp, `out-${name}`);
    const baselineFile = path.join(tmp, `baseline-${name}.json`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(baselineFile, JSON.stringify(BASE));
    const results: boolean[] = [];
    const ran: string[] = [];
    const logs: string[] = [];
    let isolations = 0;
    let inconclusive = 0;
    const smoke = createSmokeBlocks({
      checks: () => results.length,
      failures: () => results.filter((ok) => !ok).length,
      inconclusive: () => inconclusive,
      outDir: () => outDir,
      isolate: async () => {
        isolations++;
      },
      argv,
      env,
      suiteFile,
      baselineFile,
      log: (line: string) => logs.push(line),
    });
    for (const title of ["a", "b", "c", "d"]) {
      if (extra.outside && title === "c") results.push(true);
      await smoke.block(title, async () => {
        ran.push(title);
        results.push(...CHECKS[title]);
        if (title === "d") inconclusive++;
      });
    }
    smoke.endBlocks();
    results.push(true); // a final check, as the suite's request and console checks
    smoke.report();
    const read = (file: string) => JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8"));
    return { ran, logs, isolations, timing: read(TIMING_FILE), blocks: read(BLOCKS_FILE), baseline: JSON.parse(fs.readFileSync(baselineFile, "utf8")), smoke };
  }

  it("without a flag runs every block in order, unisolated, and writes the timing and block files", async () => {
    const r = await run([]);
    expect(r.ran).toEqual(["a", "b", "c", "d"]);
    expect(r.isolations).toBe(0);
    expect(r.smoke.narrowed).toBe(false);
    expect(Object.keys(r.timing)).toEqual(["a", "b", "c", "d"]);
    expect(r.blocks.c).toMatchObject({ shard: null, checks: 3, failed: 1, inconclusive: 0 });
    expect(r.blocks.a).toMatchObject({ checks: 2, failed: 0, inconclusive: 0 });
    expect(r.blocks.d).toMatchObject({ checks: 1, failed: 0, inconclusive: 1 });
    expect(r.logs.some((l) => /^The 4 slowest blocks of this run/.test(l))).toBe(true);
    expect(r.logs.some((l) => /^Shard|SMOKE_ONLY/.test(l))).toBe(false);
    expect(r.baseline).toEqual(BASE); // only --write-timing touches the baseline
  });

  it("with --shard i/N runs exactly that shard's blocks, each but the first after a clean slate", async () => {
    const shards = [await run(["--shard", "1/2"]), await run([], { SMOKE_SHARD: "2/2" })];
    expect(shards.map((s) => s.ran)).toEqual([
      ["a", "d"],
      ["b", "c"],
    ]);
    for (const s of shards) {
      expect(s.isolations).toBe(s.ran.length - 1);
      expect(s.smoke.narrowed).toBe(true);
    }
    expect(shards[0].blocks.a.shard).toBe("1/2");
    expect(shards[1].blocks.c.shard).toBe("2/2");
    expect(shards[0].logs[0]).toMatch(/^Smoke shard 1\/2: 2 of 4 blocks, about 11 s by .*: a, d$/);
    expect(shards[1].logs.find((l) => l.startsWith("Shard 2/2: "))).toMatch(/^Shard 2\/2: 2 of 4 blocks in \d+\.\d s, 4 checks in them \(\+1 after the blocks\); the other blocks run in the other shards\.$/);
  });

  it("with SMOKE_ONLY runs the named blocks (inside the shard, with one) and refuses a name no block has", async () => {
    expect((await run([], { SMOKE_ONLY: "c" })).ran).toEqual(["c"]);
    expect((await run([], { SMOKE_ONLY: "b,d" })).ran).toEqual(["b", "d"]);
    expect((await run(["--shard", "1/2"], { SMOKE_ONLY: "b,d" })).ran).toEqual(["d"]);
    await expect(run([], { SMOKE_ONLY: "zz" })).rejects.toThrow(/no block is called zz/);
  });

  it("notes checks outside the blocks and refreshes the baseline with --write-timing", async () => {
    const r = await run(["--write-timing"], {}, { outside: true });
    expect(r.logs.some((l) => /^Note: 1 check ran outside any smokeBlock/.test(l))).toBe(true);
    expect(Object.keys(r.baseline)).toEqual(["a", "b", "c", "d"]);
    for (const seconds of Object.values(r.baseline)) expect(seconds).toBeGreaterThanOrEqual(0);
    expect(r.logs.some((l) => /^Wrote .*: 4 blocks, 4 measured in this run\.$/.test(l))).toBe(true);
  });

  it("refuses a block inside a block and a block after smoke.endBlocks()", async () => {
    const smoke = createSmokeBlocks({ checks: () => 0, outDir: () => tmp, argv: [], env: {}, suiteFile, baselineFile: path.join(tmp, "none.json"), log: () => {} });
    await expect(smoke.block("a", () => smoke.block("b", async () => {}))).rejects.toThrow(/starts inside block "a"/);
    smoke.endBlocks();
    await expect(smoke.block("c", async () => {})).rejects.toThrow(/after smoke.endBlocks/);
  });
});

/**
 * --- smoke-sharding (review fix) --- The verdict of deploy.yml's smoke-summary job. GitHub ends a job that hits its
 * timeout-minutes with the conclusion `cancelled`, the same as a shard that a newer push cancels through its concurrency group,
 * so `needs.smoke.result` alone cannot tell a hung shard from a superseded run: the old step passed any cancelled run with a
 * notice as soon as a newer run of deploy.yml existed – and on the default branch, where a push comes every hour or so and a
 * timed-out shard ends some 50 minutes after its own push, one often does. The fixtures are this repository's runs as the API
 * answers for them: run 183, whose smoke job ran 20:38:07 → 21:23:14 into its 45-minute limit ("The job has exceeded the maximum
 * execution time of 45m0s"), and run 174, whose smoke job run 175 cancelled after 19 minutes ("Canceling since a higher
 * priority waiting request … exists") – verbatim (one `smoke` job, before the shards) and laid out as today's four shards.
 */
describe("the smoke-summary verdict (scripts/smoke/verdict.mjs)", () => {
  const REPO = "CronusAztec/Balls";
  const BRANCH = "claude/optimistic-johnson-46x3qg";
  const WORKFLOW_REF = `${REPO}/.github/workflows/deploy.yml@refs/heads/${BRANCH}`;
  const RUN_174 = 37206311440;
  const RUN_175 = 37207397522;
  const RUN_183 = 37232540357;
  const RUN_184 = 37236047468;
  const RUN_200 = 37273497598;
  const jobsPath = (run: number) => `repos/${REPO}/actions/runs/${run}/jobs?filter=latest&per_page=100`;
  const annotationsPath = (id: number) => `repos/${REPO}/check-runs/${id}/annotations?per_page=100`;
  const NEWEST_PATH = `repos/${REPO}/actions/workflows/deploy.yml/runs?branch=${encodeURIComponent(BRANCH)}&per_page=1`;
  const TIMEOUT_NOTE = "The job has exceeded the maximum execution time of 45m0s";
  const CANCEL_NOTE = "The operation was canceled.";
  const RUNNER_NOTE = '"The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026. For more information, see https://github.com/actions/runner-images/issues/14748"';
  const supersededNote = (group: string) => `Canceling since a higher priority waiting request for ${group} exists`;
  const TIMED_OUT_MESSAGE = `smoke (shard 3 of 4) ran out of time ("${TIMEOUT_NOTE}") – a shard that times out fails the smoke test, even when a newer run supersedes this one`;
  const supersededMessage = (run: number) => `the smoke shards were cancelled before their time limit: run ${run}, a newer push, supersedes this run; nothing is deployed`;
  const PASSED_MESSAGE = "All the smoke shards passed, every block of the suite in exactly one of them.";

  type Job = { id: number; name: string; status: string; conclusion: string | null; started_at: string | null; completed_at: string | null };
  type Routes = Record<string, unknown>;
  const job = (id: number, name: string, conclusion: string | null, started_at: string | null, completed_at: string | null): Job => ({
    id,
    name,
    status: conclusion ? "completed" : started_at ? "in_progress" : "queued",
    conclusion,
    started_at,
    completed_at,
  });
  const shard = (i: number) => `smoke (shard ${i} of 4)`;
  const annotations = (...messages: string[]) =>
    messages.map((message) => ({ path: ".github", start_line: 1, end_line: 1, annotation_level: message === RUNNER_NOTE ? "notice" : "failure", title: "", message, raw_details: "" }));
  const newestRuns = (...ids: number[]) => ({ total_count: ids.length, workflow_runs: ids.map((id) => ({ id, head_branch: BRANCH, event: "push", path: ".github/workflows/deploy.yml" })) });

  /** Run 183 verbatim: its one smoke job ran into its 45-minute limit; run 200 is the newest run on the branch now. */
  const REAL_183: Routes = {
    [jobsPath(RUN_183)]: {
      total_count: 3,
      jobs: [
        job(111525103262, "build", "success", "2026-10-04T20:33:14Z", "2026-10-04T20:38:04Z"),
        job(111526012579, "smoke", "cancelled", "2026-10-04T20:38:07Z", "2026-10-04T21:23:14Z"),
        job(111534764440, "deploy", "skipped", "2026-10-04T21:23:15Z", "2026-10-04T21:23:15Z"),
      ],
    },
    [annotationsPath(111526012579)]: annotations(TIMEOUT_NOTE, CANCEL_NOTE, RUNNER_NOTE),
    [NEWEST_PATH]: newestRuns(RUN_200),
  };
  /** Run 174 verbatim: run 175 cancelled its one smoke job after 19 minutes. */
  const REAL_174: Routes = {
    [jobsPath(RUN_174)]: {
      total_count: 3,
      jobs: [
        job(111448113977, "build", "success", "2026-10-04T13:38:05Z", "2026-10-04T13:42:26Z"),
        job(111448887110, "smoke", "cancelled", "2026-10-04T13:42:28Z", "2026-10-04T14:01:32Z"),
        job(111452352713, "deploy", "skipped", "2026-10-04T14:01:32Z", "2026-10-04T14:01:32Z"),
      ],
    },
    [annotationsPath(111448887110)]: annotations(supersededNote(`smoke-refs/heads/${BRANCH}`), CANCEL_NOTE, RUNNER_NOTE),
    [NEWEST_PATH]: newestRuns(RUN_200),
  };

  /** Run 183 as four shards: shard 3 hung into the limit (the real job's times), the other three passed; run 184 is pushed. */
  const HUNG_SHARD = 111526012579;
  const SHARDED_183: Job[] = [
    job(111525103262, "build", "success", "2026-10-04T20:33:14Z", "2026-10-04T20:38:04Z"),
    job(111526012571, shard(1), "success", "2026-10-04T20:38:07Z", "2026-10-04T20:51:12Z"),
    job(111526012575, shard(2), "success", "2026-10-04T20:38:08Z", "2026-10-04T20:52:01Z"),
    job(HUNG_SHARD, shard(3), "cancelled", "2026-10-04T20:38:07Z", "2026-10-04T21:23:14Z"),
    job(111526012583, shard(4), "success", "2026-10-04T20:38:07Z", "2026-10-04T20:50:44Z"),
    job(111534764431, "smoke-summary", null, "2026-10-04T21:23:16Z", null),
    job(111534764440, "deploy", null, null, null),
  ];
  const timedOut = (over: Routes = {}, jobs: Job[] = SHARDED_183): Routes => ({
    [jobsPath(RUN_183)]: { total_count: jobs.length, jobs },
    [annotationsPath(HUNG_SHARD)]: annotations(TIMEOUT_NOTE, CANCEL_NOTE, RUNNER_NOTE),
    [NEWEST_PATH]: newestRuns(RUN_184),
    ...over,
  });
  /** Run 174 as four shards: shard 4 had passed when run 175's shards cancelled the other three after 19 minutes. */
  const CANCELLED_SHARDS = [111448887101, 111448887102, 111448887103];
  const SHARDED_174: Job[] = [
    job(111448113977, "build", "success", "2026-10-04T13:38:05Z", "2026-10-04T13:42:26Z"),
    ...CANCELLED_SHARDS.map((id, i) => job(id, shard(i + 1), "cancelled", "2026-10-04T13:42:28Z", "2026-10-04T14:01:32Z")),
    job(111448887104, shard(4), "success", "2026-10-04T13:42:29Z", "2026-10-04T13:55:40Z"),
    job(111452352700, "smoke-summary", null, "2026-10-04T14:01:34Z", null),
    job(111452352713, "deploy", null, null, null),
  ];
  const superseded = (over: Routes = {}, jobs: Job[] = SHARDED_174): Routes => ({
    [jobsPath(RUN_174)]: { total_count: jobs.length, jobs },
    ...Object.fromEntries(CANCELLED_SHARDS.map((id, i) => [annotationsPath(id), annotations(supersededNote(`smoke-refs/heads/${BRANCH}-${i + 1}`), CANCEL_NOTE)])),
    [NEWEST_PATH]: newestRuns(RUN_175),
    ...over,
  });

  /** A fake `api`: the answer for a path from `routes` (a 404 for a path it has none for); every path asked in `calls`. */
  function fakeApi(routes: Routes) {
    const calls: string[] = [];
    const api = async (p: string) => {
      calls.push(p);
      if (routes[p] === undefined) throw new Error(`gh api ${p}: gh: Not Found (HTTP 404)`);
      return structuredClone(routes[p]);
    };
    return { api, calls };
  }
  async function verdict(routes: Routes, runId: number, result = "cancelled", summary = "success") {
    const { api, calls } = fakeApi(routes);
    return { ...(await smokeVerdict({ result, summary, timeoutMinutes: 45, repo: REPO, runId, branch: BRANCH, workflow: "deploy.yml", api })), calls };
  }

  it("fails a run whose shard ran out of time although a newer run exists (GitHub reports the timeout as cancelled)", async () => {
    // run 183 as four shards with run 184 already pushed: the old step saw only the newer run and passed with a notice
    const v = await verdict(timedOut(), RUN_183);
    expect(v).toMatchObject({ pass: false, level: "error", message: TIMED_OUT_MESSAGE });
    // the timeout decides before the newest run is asked for
    expect(v.calls).toEqual([jobsPath(RUN_183), annotationsPath(HUNG_SHARD)]);
    // every shard that hung is named
    const allHung = SHARDED_183.map((j) => (SHARD_JOB.test(j.name) ? { ...j, conclusion: "cancelled", completed_at: "2026-10-04T21:23:14Z" } : j));
    const all = await verdict(timedOut({}, allHung), RUN_183);
    expect(all.pass).toBe(false);
    for (let i = 1; i <= 4; i++) expect(all.message).toContain(`${shard(i)} ran out of time`);
    // the real run 183 (one smoke job, before the shards) with today's newest run: a failure as well
    const real = await verdict(REAL_183, RUN_183);
    expect(real).toMatchObject({ pass: false, level: "error" });
    expect(real.message).toBe(`smoke ran out of time ("${TIMEOUT_NOTE}") – a shard that times out fails the smoke test, even when a newer run supersedes this one`);
  });

  it("tells a timeout by the run time when the annotations cannot be read or do not name it: 44 of the 45 minutes", async () => {
    // unreadable (a 404, or no checks permission): 45.1 minutes of a 45-minute limit
    const blind = await verdict(timedOut({ [annotationsPath(HUNG_SHARD)]: undefined }), RUN_183);
    expect(blind.pass).toBe(false);
    expect(blind.message).toContain("smoke (shard 3 of 4) ran out of time (it ran 45.1 of its 45 minutes)");
    expect(blind.calls).not.toContain(NEWEST_PATH);
    // readable but without GitHub's wording (should it ever change)
    const reworded = await verdict(timedOut({ [annotationsPath(HUNG_SHARD)]: annotations(CANCEL_NOTE) }), RUN_183);
    expect(reworded).toMatchObject({ pass: false, message: expect.stringContaining("(it ran 45.1 of its 45 minutes)") });
    // a shard that a newer push cancels after 44 minutes had hung all the same; one cancelled a second sooner had not
    const endingAt = (end: string) => SHARDED_174.map((j) => (j.name === shard(2) ? { ...j, completed_at: end } : j));
    const late = await verdict(superseded({}, endingAt("2026-10-04T14:26:28Z")), RUN_174);
    expect(late).toMatchObject({ pass: false, level: "error" });
    expect(late.message).toContain("smoke (shard 2 of 4) ran out of time (it ran 44.0 of its 45 minutes)");
    expect(await verdict(superseded({}, endingAt("2026-10-04T14:26:27Z")), RUN_174)).toMatchObject({ pass: true, level: "notice" });
  });

  it("passes a run whose shards a newer push cancelled before their limit, with a notice that names the newer run", async () => {
    const v = await verdict(superseded(), RUN_174);
    expect(v).toMatchObject({ pass: true, level: "notice", message: supersededMessage(RUN_175) });
    expect(v.calls).toEqual([jobsPath(RUN_174), ...CANCELLED_SHARDS.map((id) => annotationsPath(id)), NEWEST_PATH]);
    // the same when their annotations cannot be read: 19 minutes are far from the limit
    const blind = superseded(Object.fromEntries(CANCELLED_SHARDS.map((id) => [annotationsPath(id), undefined])));
    expect(await verdict(blind, RUN_174)).toMatchObject({ pass: true, level: "notice" });
    // the real run 174 (one smoke job) with today's newest run
    expect(await verdict(REAL_174, RUN_174)).toMatchObject({ pass: true, level: "notice", message: supersededMessage(RUN_200) });
  });

  it("fails a cancelled run that no newer run supersedes, and one whose jobs or newest run cannot be read", async () => {
    // this run is still the newest on the branch (a person cancelled it), an older one is listed first, or none is
    for (const answer of [newestRuns(RUN_174), newestRuns(RUN_174 - 1), newestRuns()]) {
      expect(await verdict(superseded({ [NEWEST_PATH]: answer }), RUN_174)).toMatchObject({
        pass: false,
        level: "error",
        message: `a smoke shard was cancelled before its time limit, but no newer run of deploy.yml on ${BRANCH} supersedes this run – see the 'smoke (shard x of 4)' jobs`,
      });
    }
    for (const answer of [undefined, { message: "Bad credentials" }]) {
      const v = await verdict(superseded({ [NEWEST_PATH]: answer }), RUN_174);
      expect(v.pass).toBe(false);
      expect(v.message).toMatch(/the newest run of deploy\.yml on claude\/optimistic-johnson-46x3qg could not be read to tell whether a newer push supersedes this run \((gh api .*\(HTTP 404\)|the answer lists no runs)\)$/);
    }
    // this run's jobs unreadable or malformed: no telling a timeout from a newer push
    for (const answer of [undefined, { message: "Resource not accessible by integration" }]) {
      const v = await verdict(superseded({ [jobsPath(RUN_174)]: answer }), RUN_174);
      expect(v).toMatchObject({ pass: false, level: "error", calls: [jobsPath(RUN_174)] });
      expect(v.message).toMatch(/^a smoke shard was cancelled, and this run's jobs could not be read to tell a shard that ran out of time from one a newer push cancelled/);
    }
  });

  it("fails a failed shard among cancelled ones and a cancelled result without a cancelled shard; only the smoke jobs are shards", async () => {
    const failed = SHARDED_174.map((j) => (j.name === shard(4) ? { ...j, conclusion: "failure" } : j));
    expect(await verdict(superseded({}, failed), RUN_174)).toMatchObject({ pass: false, level: "error", message: "smoke (shard 4 of 4) ended with 'failure' – see that job" });
    const passed = SHARDED_174.map((j) => (SHARD_JOB.test(j.name) ? { ...j, conclusion: "success" } : j));
    expect((await verdict(superseded({}, passed), RUN_174)).message).toMatch(/^the smoke shards ended 'cancelled', but none of this run's 4 shard jobs is cancelled/);
    expect(SHARDED_174.filter((j) => SHARD_JOB.test(j.name)).map((j) => j.name)).toEqual([1, 2, 3, 4].map(shard));
    for (const name of ["smoke", "smoke (shard 12 of 16)"]) expect(SHARD_JOB.test(name), name).toBe(true);
    for (const name of ["smoke-summary", "build", "deploy", "smoke (shard x of 4)", "smoke (shard 1 of 4) ", "my smoke"]) expect(SHARD_JOB.test(name), name).toBe(false);
  });

  it("decides a run whose result needs no lookup without asking the API", async () => {
    expect(await verdict({}, RUN_183, "success", "success")).toEqual({ pass: true, level: "info", message: PASSED_MESSAGE, calls: [] });
    const incomplete = await verdict({}, RUN_183, "success", "failure");
    expect(incomplete).toMatchObject({ pass: false, level: "error", calls: [] });
    expect(incomplete.message).toMatch(/not every block of the suite ran in exactly one of them/);
    expect(await verdict({}, RUN_183, "skipped")).toMatchObject({ pass: true, level: "notice", calls: [] });
    for (const result of ["failure", "", "timed_out"]) {
      expect(await verdict(timedOut(), RUN_183, result), result).toEqual({
        pass: false,
        level: "error",
        message: `a smoke shard ended with '${result}' – see the failing 'smoke (shard x of 4)' job`,
        calls: [],
      });
    }
  });

  it("reads a timeout from GitHub's annotation, or from a run time within a minute of the limit", () => {
    const START = "2026-10-04T20:00:00Z";
    const ran = (seconds: number) => job(1, shard(1), "cancelled", START, new Date(Date.parse(START) + seconds * 1000).toISOString());
    expect(TIMEOUT_MARGIN_SECONDS).toBe(60);
    expect(jobSeconds(ran(1144))).toBe(1144);
    expect(jobSeconds(job(1, shard(1), "cancelled", null, START))).toBeNaN();
    expect(jobSeconds(job(1, shard(1), "cancelled", START, null))).toBeNaN();
    expect(timeoutEvidence(ran(44 * 60 - 1), null, 45)).toBeNull();
    expect(timeoutEvidence(ran(44 * 60), null, 45)).toBe("it ran 44.0 of its 45 minutes");
    expect(timeoutEvidence(ran(45 * 60 + 7), [CANCEL_NOTE], 45)).toBe("it ran 45.1 of its 45 minutes");
    expect(timeoutEvidence(ran(29 * 60), [], 30)).toBe("it ran 29.0 of its 30 minutes"); // the limit is the workflow's
    expect(timeoutEvidence(ran(19 * 60), [supersededNote("smoke-refs/heads/main-1"), CANCEL_NOTE], 45)).toBeNull();
    expect(timeoutEvidence(job(1, shard(1), "cancelled", null, null), null, 45)).toBeNull();
    // the annotation decides on its own, in today's wording and in an older one
    expect(timeoutEvidence(ran(180), [TIMEOUT_NOTE, CANCEL_NOTE], 45)).toBe(`"${TIMEOUT_NOTE}"`);
    const older = "The job running on runner GitHub Actions 2 has exceeded the maximum execution time of 45 minutes.";
    expect(timeoutEvidence(ran(180), [older], 45)).toBe(`"${older}"`);
    expect(workflowFile(WORKFLOW_REF)).toBe("deploy.yml");
    expect(workflowFile("o/r/.github/workflows/smoke.yml@refs/pull/7/merge")).toBe("smoke.yml");
    expect(workflowFile(undefined)).toBe("deploy.yml");
    expect(commandData("50% done\r\nnext")).toBe("50%25 done%0D%0Anext");
  });

  it("main: the verdict on the run the step's environment describes, as a workflow command and an exit code", async () => {
    const env = { RESULT: "cancelled", SUMMARY: "success", SHARD_TIMEOUT_MINUTES: "45", GITHUB_REPOSITORY: REPO, BRANCH, GITHUB_WORKFLOW_REF: WORKFLOW_REF };
    const run = async (vars: Record<string, string | undefined>, routes: Routes) => {
      const lines: string[] = [];
      const { api, calls } = fakeApi(routes);
      const code = await verdictMain(vars, api, (line: string) => lines.push(line));
      return { code, lines, calls };
    };
    expect(await run({ ...env, GITHUB_RUN_ID: String(RUN_183) }, timedOut())).toMatchObject({ code: 1, lines: [`::error title=Smoke test::${TIMED_OUT_MESSAGE}`] });
    expect(await run({ ...env, GITHUB_RUN_ID: String(RUN_174) }, superseded())).toMatchObject({ code: 0, lines: [`::notice title=Smoke test::${supersededMessage(RUN_175)}`] });
    // GITHUB_REF_NAME stands in for BRANCH
    expect((await run({ ...env, BRANCH: undefined, GITHUB_REF_NAME: BRANCH, GITHUB_RUN_ID: String(RUN_174) }, superseded())).code).toBe(0);
    expect(await run({ ...env, RESULT: "success", GITHUB_RUN_ID: String(RUN_183) }, {})).toEqual({ code: 0, lines: [PASSED_MESSAGE], calls: [] });
    // a message is escaped for the runner: the URL-encoded branch of a failed lookup shows as it is
    const lookupFailed = await run({ ...env, GITHUB_RUN_ID: String(RUN_174) }, superseded({ [NEWEST_PATH]: undefined }));
    expect(lookupFailed.code).toBe(1);
    expect(lookupFailed.lines[0]).toContain("branch=claude%252Foptimistic-johnson-46x3qg&per_page=1");
    // the shards' timeout-minutes is required: a run time cannot be judged without it
    for (const bad of [undefined, "", "0", "-5", "soon"]) {
      expect(await run({ ...env, SHARD_TIMEOUT_MINUTES: bad, GITHUB_RUN_ID: String(RUN_174) }, superseded()), String(bad)).toEqual({
        code: 1,
        lines: [`::error title=Smoke test::SHARD_TIMEOUT_MINUTES must be the smoke shards' timeout-minutes, got '${bad ?? ""}'`],
        calls: [],
      });
    }
  });

  it.skipIf(process.platform === "win32")("runs as the workflow step runs it: node scripts/smoke/verdict.mjs, the API through gh", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-verdict-"));
    try {
      // a fake GitHub CLI first on PATH: it answers `gh api <path>` from a routes file and logs its arguments and token
      const bin = path.join(tmp, "bin");
      fs.mkdirSync(bin);
      fs.writeFileSync(
        path.join(bin, "gh"),
        [
          "#!/usr/bin/env node",
          'const fs = require("fs");',
          "const args = process.argv.slice(2);",
          'fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, token: process.env.GH_TOKEN ?? null }) + "\\n");',
          'const routes = JSON.parse(fs.readFileSync(process.env.FAKE_GH_ROUTES, "utf8"));',
          'if (args.length === 2 && args[0] === "api" && Object.prototype.hasOwnProperty.call(routes, args[1])) process.stdout.write(JSON.stringify(routes[args[1]]));',
          'else { process.stdout.write(JSON.stringify({ message: "Not Found" })); process.stderr.write("gh: Not Found (HTTP 404)\\n"); process.exit(1); }',
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const step = (name: string, vars: Record<string, string>, routes: Routes) => {
        const log = path.join(tmp, `${name}.log`);
        const routesFile = path.join(tmp, `${name}.json`);
        fs.writeFileSync(routesFile, JSON.stringify(routes));
        // only what the step's env gives it (no GITHUB_* of the machine the tests run on; NODE_ENV as the test runner has it)
        const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/smoke/verdict.mjs")], {
          cwd: ROOT,
          encoding: "utf8",
          timeout: 60_000,
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: [bin, path.dirname(process.execPath), process.env.PATH ?? ""].join(path.delimiter),
            FAKE_GH_LOG: log,
            FAKE_GH_ROUTES: routesFile,
            GH_TOKEN: "token-of-the-step",
            SUMMARY: "success",
            SHARD_TIMEOUT_MINUTES: "45",
            GITHUB_REPOSITORY: REPO,
            BRANCH,
            GITHUB_WORKFLOW_REF: WORKFLOW_REF,
            ...vars,
          },
        });
        const asked = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
        return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim(), asked };
      };
      const asked = (...paths: string[]) => paths.map((p) => ({ args: ["api", p], token: "token-of-the-step" }));
      expect(step("timed-out", { RESULT: "cancelled", GITHUB_RUN_ID: String(RUN_183) }, timedOut())).toEqual({
        status: 1,
        stdout: `::error title=Smoke test::${TIMED_OUT_MESSAGE}`,
        stderr: "",
        asked: asked(jobsPath(RUN_183), annotationsPath(HUNG_SHARD)),
      });
      expect(step("superseded", { RESULT: "cancelled", GITHUB_RUN_ID: String(RUN_174) }, superseded())).toEqual({
        status: 0,
        stdout: `::notice title=Smoke test::${supersededMessage(RUN_175)}`,
        stderr: "",
        asked: asked(jobsPath(RUN_174), ...CANCELLED_SHARDS.map((id) => annotationsPath(id)), NEWEST_PATH),
      });
      // gh fails on the annotations (no checks permission): the run time still catches the hung shard
      const blind = step("blind", { RESULT: "cancelled", GITHUB_RUN_ID: String(RUN_183) }, timedOut({ [annotationsPath(HUNG_SHARD)]: undefined }));
      expect(blind).toMatchObject({ status: 1, stderr: "" });
      expect(blind.stdout).toContain("smoke (shard 3 of 4) ran out of time (it ran 45.1 of its 45 minutes)");
      // a run whose shards all passed asks nothing
      expect(step("passed", { RESULT: "success", GITHUB_RUN_ID: String(RUN_183) }, {})).toEqual({ status: 0, stdout: PASSED_MESSAGE, stderr: "", asked: [] });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("is the step deploy.yml runs: the shards' timeout-minutes, the permissions it reads with, the shard job names", () => {
    const deploy = fs.readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8");
    /** The lines of one job of the workflow, from `  <job>:` to the next job. */
    const jobSection = (name: string) => {
      const lines = deploy.split("\n");
      const start = lines.indexOf(`  ${name}:`);
      expect(start, name).toBeGreaterThan(-1);
      let end = start + 1;
      while (end < lines.length && !/^ {2}[\w-]+:\s*$/.test(lines[end])) end++;
      return lines.slice(start, end).join("\n");
    };
    const smokeJob = jobSection("smoke");
    const summaryJob = jobSection("smoke-summary");
    const limit = /\n {4}timeout-minutes: (\d+)\n/.exec(smokeJob)?.[1];
    expect(limit, "the smoke job's timeout-minutes").toMatch(/^\d+$/);
    const step = summaryJob.slice(summaryJob.indexOf("      - name: Every shard passed\n"));
    expect(step).toMatch(/^ {6}- name: Every shard passed\n {8}if: always\(\)\n {8}env:\n/);
    // the verdict judges a shard's run time by the limit the shards really have
    expect(step).toContain(`\n          SHARD_TIMEOUT_MINUTES: ${limit}\n`);
    for (const line of ["RESULT: ${{ needs.smoke.result }}", "SUMMARY: ${{ steps.summary.outcome }}", "GH_TOKEN: ${{ github.token }}", "BRANCH: ${{ github.ref_name }}"]) {
      expect(step).toContain(`\n          ${line}\n`);
    }
    expect(step).toMatch(/\n {8}run: node scripts\/smoke\/verdict\.mjs\s*$/);
    // this run's jobs and the newest run (actions), a cancelled shard's annotations (checks)
    expect(summaryJob).toMatch(/\n {4}permissions:\n {6}contents: read\n {6}actions: read\b[^\n]*\n {6}checks: read\b/);
    // the shard jobs are found by their name, and no other job of the workflow has one like it
    const name = /\n {4}name: (.+)\n/.exec(smokeJob)?.[1] ?? "";
    const matrix = (/\n {8}shard: \[([\d, ]+)\]\n/.exec(smokeJob)?.[1] ?? "").split(",").map((s) => s.trim());
    expect(matrix).toEqual(["1", "2", "3", "4"]);
    for (const i of matrix) expect(SHARD_JOB.test(name.replace("${{ matrix.shard }}", i)), name).toBe(true);
    for (const other of ["build", "smoke-summary", "deploy"]) {
      expect(jobSection(other), other).not.toMatch(/\n {4}name:/);
      expect(SHARD_JOB.test(other), other).toBe(false);
    }
    // a newer push cancels a shard through the shard's own concurrency group
    expect(smokeJob).toMatch(/\n {4}concurrency:\n {6}group: smoke-\$\{\{ github\.ref \}\}-\$\{\{ matrix\.shard \}\}\n {6}cancel-in-progress: true\n/);
    // the README says the same
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8").replace(/\s+/g, " ");
    expect(readme).toContain("a run whose shards a newer push cancelled deploys nothing and is not reported as a failure – unless one of them ran out of time");
    expect(readme).toContain("(`scripts/smoke/verdict.mjs`)");
  });
});
