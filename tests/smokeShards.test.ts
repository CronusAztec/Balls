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

/**
 * --- smoke-sharding --- The split of the browser smoke suite into CI shards (scripts/smoke/shards.mjs), the block runner
 * (scripts/smoke/blocks.mjs) and the shape of the suite they rely on: every block is a top-level
 * `await smokeBlock("title", async () => { … });` that the static scan finds, no work happens outside the blocks, and – for
 * N = 1…8 with the checked-in baseline – the shards are disjoint, complete, order-stable and balanced.
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
