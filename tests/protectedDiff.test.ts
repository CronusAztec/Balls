import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { MODE_IDS } from "@/lib/physics/types";
import {
  arrayElements,
  countChecks,
  countExpects,
  expectStatements,
  extractConst,
  filesToRead,
  fingerprintChanges,
  mergeProtectedConfigs,
  modifierCounts,
  normalizeSource,
  objectEntries,
  parseTrailers,
  protectedFindings,
  testTimeouts,
  tokenize,
  weakeningFindings,
  type FileVersions,
  type FingerprintLocator,
  type ProtectedConfig,
} from "@/lib/agentKit/protectedDiff";

/*
 * --- ai-guard --- The core guard's static checks (src/lib/agentKit/protectedDiff.ts) on fixture diffs: the fingerprint lock
 * and its Fingerprint-Change trailer, the protected-path report, the test-weakening detector and its Test-Change trailer, the
 * rules joined from the base commit and the working tree – and on the real tree: every locked literal of
 * scripts/agent/protected.json resolves, and BASELINE has one entry per mode.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const PROTECTED = JSON.parse(read("scripts/agent/protected.json")) as ProtectedConfig;
const files = (entries: Record<string, [string | null, string | null]>) => new Map<string, FileVersions>(Object.entries(entries).map(([f, [base, head]]) => [f, { base, head }]));
const none = new Map<string, string[]>();

const BASELINE_SRC = `import { x } from "y";
interface Fingerprint { samples: number[][] }
/** The fingerprints. */
const BASELINE: Record<ModeId, Fingerprint> = {
  classic: { samples: [[468595,245253],[395319,386187]], broken: [0, 1], walls: [123857,145714] },
  // a comment that may change
  drop: { samples: [[386190,181061]], broken: [], walls: [] }, // trailing comment
  "spiralGlass": { samples: [[243369,453872]], broken: [], walls: [] },
};
const OTHER = 1;
`;
const LOCK: FingerprintLocator[] = [{ file: "tests/extras.test.ts", kind: "record", const: "BASELINE" }];
const lock = (head: string | null, trailers = none, base: string | null = BASELINE_SRC) => fingerprintChanges(LOCK, files({ "tests/extras.test.ts": [base, head] }), trailers);

describe("the tokenizer and the literal reader", () => {
  it("drops comments and whitespace, keeps strings, templates and regular expressions whole", () => {
    const t = tokenize('const a = "x // not a comment"; // gone\n/* gone */ const r = /[/]+\\//g; const s = `t ${a + "}"} u`;');
    expect(t.map((x) => x.text)).toEqual(["const", "a", "=", '"x // not a comment"', ";", "const", "r", "=", "/[/]+\\//g", ";", "const", "s", "=", '`t ${a + "}"} u`', ";"]);
    expect(t[5].line).toBe(2);
    expect(normalizeSource("a  =\n  [1, 2] // x")).toBe(normalizeSource("a = [1,2]"));
  });

  it("reads a const's initializer past a generic type annotation, and its object entries", () => {
    const value = extractConst(BASELINE_SRC, "BASELINE");
    expect(value).not.toBeNull();
    const entries = objectEntries(value!);
    expect([...entries.keys()]).toEqual(["classic", "drop", "spiralGlass"]);
    expect(entries.get("drop")).toBe("{ samples : [ [ 386190 , 181061 ] ] , broken : [ ] , walls : [ ] }");
    expect(extractConst(BASELINE_SRC, "OTHER")?.map((x) => x.text)).toEqual(["1"]);
    expect(extractConst(BASELINE_SRC, "MISSING")).toBeNull();
    expect(extractConst("const f: (a: number) => number = (a) => a * 2;\nconst g = 3", "f")?.map((x) => x.text).join(" ")).toBe("( a ) => a * 2");
    expect(extractConst('const A = "x"\nconst B = 2', "A")?.map((x) => x.text)).toEqual(['"x"']);
    expect(arrayElements(extractConst('const L: readonly [string, string][] = [\n  ["a", "b"], // why\n  ["c", "d"],\n];', "L")!)).toEqual(['[ "a" , "b" ]', '[ "c" , "d" ]']);
  });
});

describe("the fingerprint lock", () => {
  it("fails a changed digit of an existing entry, and only that entry", () => {
    const changes = lock(BASELINE_SRC.replace("468595", "468596"));
    expect(changes).toEqual([{ file: "tests/extras.test.ts", mode: "classic", kind: "changed", where: "BASELINE", acknowledged: false, reasons: [] }]);
  });

  it("ignores comments, whitespace and the order of the entries", () => {
    const reordered = BASELINE_SRC.replace("// a comment that may change", "// another comment").replace("broken: [0, 1]", "broken: [0,1]").replace("  // trailing comment", "");
    expect(lock(reordered)).toEqual([]);
  });

  it("passes an added entry and fails a removed one", () => {
    const added = BASELINE_SRC.replace("};\nconst OTHER", "  mergeRing: { samples: [], broken: [], walls: [] },\n};\nconst OTHER");
    expect(lock(added).map((c) => [c.mode, c.kind, c.acknowledged])).toEqual([["mergeRing", "added", true]]);
    const removed = BASELINE_SRC.replace('  drop: { samples: [[386190,181061]], broken: [], walls: [] }, // trailing comment\n', "");
    expect(lock(removed).map((c) => [c.mode, c.kind, c.acknowledged])).toEqual([["drop", "removed", false]]);
    // the whole literal gone (renamed): every entry removed
    expect(lock(BASELINE_SRC.replace("const BASELINE", "const RENAMED")).map((c) => c.kind)).toEqual(["removed", "removed", "removed"]);
    // a new file: everything added
    expect(lock(BASELINE_SRC, none, null).every((c) => c.kind === "added" && c.acknowledged)).toBe(true);
  });

  it("passes the change when a commit in the range carries `Fingerprint-Change: <mode> - <reason>`", () => {
    const head = BASELINE_SRC.replace("468595", "468596").replace("386190", "386191");
    const trailers = parseTrailers(["Retune the ring\n\nThe ring bounces higher.\n\nFingerprint-Change: classic - the ring's restitution rose to 1.02\n"], "Fingerprint-Change");
    expect(lock(head, trailers).map((c) => [c.mode, c.acknowledged, c.reasons])).toEqual([
      ["classic", true, ["the ring's restitution rose to 1.02"]],
      ["drop", false, []],
    ]);
    const both = parseTrailers(["x\n\nFingerprint-Change: classic, drop – shared step change"], "Fingerprint-Change");
    expect(lock(head, both).every((c) => c.acknowledged)).toBe(true);
  });

  it("reads trailers strictly: the name, the modes, a separator and a reason", () => {
    const t = parseTrailers(
      ["Fingerprint-Change: classic - ok reason", "fingerprint-change: drop — em dash reason", "Fingerprint-Change: box -", "Fingerprint-Change: grow no separator", "Not-A-Trailer: ctf - x y z", "  Fingerprint-Change: maze - indented line "],
      "Fingerprint-Change",
    );
    expect([...t.keys()].sort()).toEqual(["classic", "drop", "maze"]);
    expect(t.get("maze")).toEqual(["indented line"]);
  });

  it("locks single values and pinned lines per mode, and JSON files key by key", () => {
    const locators: FingerprintLocator[] = [
      { file: "a.test.ts", kind: "value", const: "PIN", mode: "starChords" },
      { file: "b.test.ts", kind: "lines", pattern: "expect\\(fingerprint\\(", mode: "territory" },
      { file: "c.json", kind: "json" },
    ];
    const changes = fingerprintChanges(
      locators,
      files({
        "a.test.ts": ['const PIN = "41be2668";', 'const PIN = "41be2669";'],
        "b.test.ts": ["expect(fingerprint({}, 1)).toEqual({ tiles: 1 });\nexpect(fingerprint({}, 2)).toEqual({ tiles: 2 });", "expect(fingerprint({}, 1)).toEqual({ tiles: 1 });\nexpect(fingerprint({}, 2)).toEqual({ tiles: 3 });"],
        "c.json": ['{ "bp1": [1, 2], "bp2": [3] }', '{ "bp1": [1, 2], "bp2": [4], "bp3": [5] }'],
      }),
      none,
    );
    expect(changes.map((c) => `${c.mode} ${c.kind} ${c.acknowledged}`)).toEqual(["starChords changed false", "territory changed false", "bp2 changed false", "bp3 added true"]);
  });
});

describe("the fingerprint lock on the real tree (scripts/agent/protected.json)", () => {
  it("finds every mode in tests/extras.test.ts' BASELINE", () => {
    const entries = objectEntries(extractConst(read("tests/extras.test.ts"), "BASELINE")!);
    expect([...entries.keys()].sort()).toEqual([...MODE_IDS].sort());
  });

  it("resolves every locked literal of protected.json in its file (the Blueprint fixture once it exists)", () => {
    for (const l of PROTECTED.fingerprints) {
      const file = path.join(ROOT, l.file);
      if (!fs.existsSync(file)) {
        expect(l.kind, `${l.file} is missing`).toBe("json");
        continue;
      }
      const src = fs.readFileSync(file, "utf8");
      if (l.kind === "lines") expect(src.split("\n").filter((x) => new RegExp(l.pattern!).test(x)).length, l.file).toBeGreaterThan(0);
      else if (l.kind === "json") expect(() => JSON.parse(src)).not.toThrow();
      else expect(extractConst(src, l.const!), `${l.file}: const ${l.const}`).not.toBeNull();
      if (l.kind !== "record" && l.kind !== "json") expect(l.mode, `${l.file} ${l.const ?? l.pattern}: the trailer's key`).toBeTruthy();
    }
  });

  it("sees one changed digit of the real BASELINE as exactly that mode's change", () => {
    const src = read("tests/extras.test.ts");
    // the first digit of classic's first sample, whatever it is today, one up
    const at = src.indexOf("classic: { samples: [[") + "classic: { samples: [[".length;
    expect(at).toBeGreaterThan(30);
    const head = `${src.slice(0, at)}${(Number(src[at]) + 1) % 10}${src.slice(at + 1)}`;
    expect(head).not.toBe(src);
    const changes = fingerprintChanges(PROTECTED.fingerprints, files({ "tests/extras.test.ts": [src, head] }), none);
    expect(changes.map((c) => `${c.mode} ${c.kind} ${c.acknowledged}`)).toEqual(["classic changed false"]);
    expect(fingerprintChanges(PROTECTED.fingerprints, files({ "tests/extras.test.ts": [src, src] }), none)).toEqual([]);
  });
});

describe("the rules a change is checked with: protected.json at the base joined with the working tree's", () => {
  const golden = 'const GOLDEN = "bc8d863e";\n';
  const goldenLock: FingerprintLocator = { file: "tests/fightLeague.test.ts", kind: "value", const: "GOLDEN", mode: "fightLeague" };
  const narrowed: ProtectedConfig = { ...PROTECTED, fingerprints: PROTECTED.fingerprints.filter((l) => l.const !== "GOLDEN"), weakening: { ...PROTECTED.weakening, tests: ["tests/none/**/*.ts"], allowLists: [] } };

  it("keeps a removed fingerprint locator in force: a re-record plus its locator's removal still fails", () => {
    expect(PROTECTED.fingerprints).toContainEqual(goldenLock);
    const versions = files({ "tests/fightLeague.test.ts": [golden, golden.replace("bc8d863e", "bc8d863f")] });
    expect(fingerprintChanges(narrowed.fingerprints, versions, none)).toEqual([]); // what the working tree's rules alone would say
    const merged = mergeProtectedConfigs(PROTECTED, narrowed);
    expect(fingerprintChanges(merged.fingerprints, versions, none).map((c) => `${c.mode} ${c.kind} ${c.acknowledged}`)).toEqual(["fightLeague changed false"]);
  });

  it("keeps the weakening rules in force: a narrowed test glob or a dropped allow list does not hide a removed expect", () => {
    const merged = mergeProtectedConfigs(PROTECTED, narrowed);
    expect(merged.weakening.tests).toEqual(expect.arrayContaining(PROTECTED.weakening.tests));
    expect(merged.weakening.allowLists).toEqual(PROTECTED.weakening.allowLists);
    const src = "it('x', () => { expect(1).toBe(1); expect(2).toBe(2); });";
    const versions = files({ "tests/engine.test.ts": [src, src.replace(" expect(2).toBe(2);", "")] });
    expect(weakeningFindings(narrowed.weakening, ["tests/engine.test.ts"], versions, none)).toEqual([]);
    expect(weakeningFindings(merged.weakening, ["tests/engine.test.ts"], versions, none).map((f) => f.kind)).toEqual(["expect-drop"]);
    // the protected paths and regions too
    const noPaths: ProtectedConfig = { ...PROTECTED, paths: [], regions: [] };
    expect(protectedFindings(mergeProtectedConfigs(PROTECTED, noPaths), ["deploy/vps/jbl-deploy.sh"], new Map()).map((f) => f.rule)).toEqual(["deploy/**"]);
  });

  it("applies a rule the change adds at once, and the working tree's alone when the base has none", () => {
    const extra: FingerprintLocator = { file: "tests/newMode.test.ts", kind: "value", const: "PIN", mode: "newMode" };
    const added = mergeProtectedConfigs(PROTECTED, { ...PROTECTED, fingerprints: [...PROTECTED.fingerprints, extra] });
    expect(added.fingerprints).toContainEqual(extra);
    expect(added.fingerprints).toHaveLength(PROTECTED.fingerprints.length + 1);
    expect(mergeProtectedConfigs(null, narrowed)).toBe(narrowed);
    expect(mergeProtectedConfigs(PROTECTED, PROTECTED)).toEqual(PROTECTED);
  });
});

describe("the protected-path report", () => {
  const config = { paths: PROTECTED.paths, regions: PROTECTED.regions };
  const privacyBase = JSON.stringify({ Privacy: { title: "Privacy", cookies: "No cookies." }, Home: { title: "Home" } });

  it("reports protected files by glob, with why", () => {
    const found = protectedFindings(config, [".github/workflows/deploy.yml", "src/lib/watermark/seal.ts", "src/lib/settings.ts", "deploy/vps/jbl-deploy.sh"], new Map());
    expect(found.map((f) => [f.path, f.rule])).toEqual([
      [".github/workflows/deploy.yml", ".github/workflows/**"],
      ["src/lib/watermark/seal.ts", "src/lib/watermark/**"],
      ["deploy/vps/jbl-deploy.sh", "deploy/**"],
    ]);
    expect(found.every((f) => f.why.length > 10)).toBe(true);
  });

  it("reports an edited Privacy.* or Terms.* message with its keys, and not an edit elsewhere in the catalog", () => {
    const privacy = protectedFindings(config, ["messages/pl.json"], files({ "messages/pl.json": [privacyBase, privacyBase.replace("No cookies.", "Some cookies.")] }));
    expect(privacy).toEqual([{ path: "messages/pl.json", rule: "Privacy.*", why: expect.any(String), keys: ["Privacy.cookies"] }]);
    expect(protectedFindings(config, ["messages/pl.json"], files({ "messages/pl.json": [privacyBase, privacyBase.replace('"Home"}', '"Start"}')] }))).toEqual([]);
  });

  it("reports an edited protected const (MEMORY_CEILINGS, ALLOWED, PRO_FEATURES), and not an edit beside it", () => {
    const uncap = 'export const MEMORY_CEILINGS: Readonly<Record<string, number>> = {\n  ballCount: 1_000_000,\n};\nexport const OTHER = 1;\n';
    expect(protectedFindings(config, ["src/lib/uncap.ts"], files({ "src/lib/uncap.ts": [uncap, uncap.replace("1_000_000", "2_000_000")] })).map((f) => f.rule)).toEqual(["MEMORY_CEILINGS"]);
    expect(protectedFindings(config, ["src/lib/uncap.ts"], files({ "src/lib/uncap.ts": [uncap, uncap.replace("OTHER = 1", "OTHER = 2")] }))).toEqual([]);
  });
});

describe("the test-weakening detector", () => {
  const W = PROTECTED.weakening;
  const TEST = `import { describe, expect, it } from "vitest";
describe("thing", () => {
  it("adds", () => {
    expect(1 + 1).toBe(2);
    expect.soft(2 + 2).toBe(4);
  });
  it("is slow", { timeout: 20_000 }, () => {
    expect(true).toBe(true);
  });
  it("runs every mode", () => {
    expect(3).toBe(3);
  }, 20_000);
  it("plain", () => {
    expect(4).toBe(4);
  });
});
`;
  const weak = (head: string | null, trailers = none, base: string | null = TEST, file = "tests/thing.test.ts") => weakeningFindings(W, [file], files({ [file]: [base, head] }), trailers);
  const kinds = (head: string | null, trailers = none) => weak(head, trailers).map((f) => `${f.kind}${f.acknowledged ? " (acknowledged)" : ""}`);

  it("counts expectations, modifiers, timeouts and smoke checks outside comments and strings", () => {
    expect(countExpects(TEST)).toBe(5);
    expect(countExpects('// expect(1)\nconst s = "expect(2)";\nexpect(3).toBe(3); expect.poll(() => 1); expectTypeOf(x).toBeNumber(); foo.expect(4);')).toBe(3);
    expect(modifierCounts("it.only('x', f); describe.skip('y', f); ctx.skip(); it.skipIf(a)('z', f); it.todo('w'); // it.only")).toEqual({ only: 1, skip: 2, skipIf: 1, todo: 1 });
    expect([...testTimeouts(TEST)]).toEqual([
      ['describe "thing"', null],
      ['it "adds"', null],
      ['it "is slow"', 20000],
      ['it "runs every mode"', 20000],
      ['it "plain"', null],
    ]);
    expect(countChecks('const check = (n, ok) => ok;\nfunction check2() {}\ncheck("a", true);\ntimingCheck("b", 1);\n// check("c")\nobj.check("d");')).toBe(2);
  });

  it("passes an untouched file, a new test and a moved expectation", () => {
    expect(weak(TEST)).toEqual([]);
    expect(weak(TEST.replace('  it("plain"', '  it("new", { timeout: 60_000 }, () => {\n    expect(5).toBe(5);\n  });\n  it("plain"'))).toEqual([]);
    // an expectation moved to another test file: no net drop
    const moved = weakeningFindings(W, ["tests/a.test.ts", "tests/b.test.ts"], files({ "tests/a.test.ts": ["expect(1);expect(2);", "expect(1);"], "tests/b.test.ts": ["expect(3);", "expect(3);expect(2);"] }), none);
    expect(moved).toEqual([]);
  });

  it("fails a removed expect(, an added .skip, .skipIf or .todo, and a raised timeout", () => {
    expect(kinds(TEST.replace("    expect.soft(2 + 2).toBe(4);\n", ""))).toEqual(["expect-drop"]);
    expect(kinds(TEST.replace('it("plain"', 'it.skip("plain"'))).toEqual(["skip-added"]);
    expect(kinds(TEST.replace('it("plain"', 'it.skipIf(process.env.CI)("plain"'))).toEqual(["skipIf-added"]);
    expect(kinds(TEST.replace('  it("plain"', '  it.todo("later");\n  it("plain"'))).toEqual(["todo-added"]);
    expect(kinds(TEST.replace("{ timeout: 20_000 }", "{ timeout: 60_000 }"))).toEqual(["timeout-raised"]);
    expect(kinds(TEST.replace("}, 20_000);", "}, 90_000);"))).toEqual(["timeout-raised"]);
    expect(kinds(TEST.replace('it("plain", () => {', 'it("plain", { timeout: 30_000 }, () => {'))).toEqual(["timeout-raised"]);
    expect(kinds(TEST.replace("{ timeout: 20_000 }", "{ timeout: 10_000 }"))).toEqual([]);
  });

  it("always fails an added .only, even with a Test-Change trailer", () => {
    const trailers = parseTrailers(["Test-Change: tests/thing.test.ts - focusing on one test"], "Test-Change");
    expect(kinds(TEST.replace('it("plain"', 'it.only("plain"'), trailers)).toEqual(["only-added"]);
  });

  it("passes a finding a `Test-Change: <file> - <reason>` trailer names (a path or a glob)", () => {
    const head = TEST.replace('it("plain"', 'it.skip("plain"');
    expect(kinds(head, parseTrailers(["Test-Change: tests/thing.test.ts - the plain case moved to thing2"], "Test-Change"))).toEqual(["skip-added (acknowledged)"]);
    expect(kinds(head, parseTrailers(["Test-Change: tests/thing*.test.ts - covered elsewhere now"], "Test-Change"))).toEqual(["skip-added (acknowledged)"]);
    expect(kinds(head, parseTrailers(["Test-Change: tests/other.test.ts - not this file"], "Test-Change"))).toEqual(["skip-added"]);
  });

  it("reads each expect statement with its matcher chain, the unit a move is matched by", () => {
    expect(expectStatements("expect(a.b()).not.toEqual(c[0]); expect.soft(x)?.toBe(1);\nexpectTypeOf(y).toBeNumber(); foo.expect(z);")).toEqual([
      "expect ( a . b ( ) ) . not . toEqual ( c [ 0 ] )",
      "expect . soft ( x ) ?. toBe ( 1 )",
      "expectTypeOf ( y ) . toBeNumber ( )",
    ]);
    expect(countExpects(TEST)).toBe(expectStatements(TEST).length);
  });

  it("never lets an expect added elsewhere offset one removed here: a new test file, or another test's new expects", () => {
    // one new file with 3 expects, and 1 expect removed from an existing file
    const existing = TEST.replace("    expect.soft(2 + 2).toBe(4);\n", "");
    const fresh = 'it("x", () => {\n  expect(7).toBe(7);\n  expect(8).toBe(8);\n  expect(9).toBe(9);\n});\n';
    const withNew = weakeningFindings(W, ["tests/new.test.ts", "tests/thing.test.ts"], files({ "tests/thing.test.ts": [TEST, existing], "tests/new.test.ts": [null, fresh] }), none);
    expect(withNew.map((f) => `${f.kind} ${f.file} ${f.acknowledged}`)).toEqual(["expect-drop tests/thing.test.ts false"]);
    // the same with the 3 new expects in another existing test
    const other = weakeningFindings(W, ["tests/other.test.ts", "tests/thing.test.ts"], files({ "tests/thing.test.ts": [TEST, existing], "tests/other.test.ts": ["expect(1);", `expect(1);\n${fresh}`] }), none);
    expect(other.map((f) => `${f.kind} ${f.file}`)).toEqual(["expect-drop tests/thing.test.ts"]);
    // an expect whose expected value changed is not a dropped one
    expect(weak(TEST.replace("expect(4).toBe(4)", "expect(4).toBe(5)"))).toEqual([]);
    // the removed statement copied into a new file: moved, not dropped
    const movedOut = weakeningFindings(W, ["tests/new.test.ts", "tests/thing.test.ts"], files({ "tests/thing.test.ts": [TEST, existing], "tests/new.test.ts": [null, `${fresh}expect.soft(2 + 2).toBe(4);\n`] }), none);
    expect(movedOut).toEqual([]);
  });

  it("treats a renamed or split test file as a move, and compares the new file with the old one", () => {
    // git mv with no content change: a note, no failure
    const renamed = weakeningFindings(W, ["tests/thing.test.ts", "tests/thingRenamed.test.ts"], files({ "tests/thing.test.ts": [TEST, null], "tests/thingRenamed.test.ts": [null, TEST] }), none);
    expect(renamed.map((f) => [f.kind, f.file, f.acknowledged])).toEqual([["test-moved", "tests/thing.test.ts", true]]);
    expect(renamed[0].detail).toContain("tests/thingRenamed.test.ts");
    // split into two new files
    const [first, second] = [TEST.slice(0, TEST.indexOf('  it("runs every mode"')) + "});\n", `describe("thing 2", () => {\n${TEST.slice(TEST.indexOf('  it("runs every mode"'))}`];
    const split = weakeningFindings(W, ["tests/thing.test.ts", "tests/thingA.test.ts", "tests/thingB.test.ts"], files({ "tests/thing.test.ts": [TEST, null], "tests/thingA.test.ts": [null, first], "tests/thingB.test.ts": [null, second] }), none);
    expect(split.map((f) => f.kind)).toEqual(["test-moved"]);
    // renamed with a .skip, or a raised timeout, added on the way: caught on the new file
    const skipped = weakeningFindings(W, ["tests/thing.test.ts", "tests/thingRenamed.test.ts"], files({ "tests/thing.test.ts": [TEST, null], "tests/thingRenamed.test.ts": [null, TEST.replace('it("plain"', 'it.skip("plain"').replace("{ timeout: 20_000 }", "{ timeout: 90_000 }")] }), none);
    expect(skipped.map((f) => `${f.kind} ${f.file}`)).toEqual(["test-moved tests/thing.test.ts", "skip-added tests/thingRenamed.test.ts", "timeout-raised tests/thingRenamed.test.ts"]);
    // a .skip the old file already had moves with it
    const SKIPPING = TEST.replace('it("plain"', 'it.skip("plain"');
    expect(weakeningFindings(W, ["tests/a.test.ts", "tests/b.test.ts"], files({ "tests/a.test.ts": [SKIPPING, null], "tests/b.test.ts": [null, SKIPPING] }), none).map((f) => f.kind)).toEqual(["test-moved"]);
    // deleted, and only part of it went anywhere: deleted
    const partly = weakeningFindings(W, ["tests/thing.test.ts", "tests/thingA.test.ts"], files({ "tests/thing.test.ts": [TEST, null], "tests/thingA.test.ts": [null, first] }), none);
    expect(partly.map((f) => f.kind)).toEqual(["test-deleted", "expect-drop"]);
  });

  it("checks a new test file's modifiers against none: a file of describe.skip is flagged", () => {
    const fresh = 'describe.skip("later", () => {\n  it("a", () => {\n    expect(1).toBe(1);\n  });\n});\nit.todo("b");\n';
    const found = weakeningFindings(W, ["tests/fresh.test.ts"], files({ "tests/fresh.test.ts": [null, fresh] }), none);
    expect(found.map((f) => `${f.kind} ${f.acknowledged}`)).toEqual(["skip-added false", "todo-added false"]);
    expect(found[0].detail).toContain("a new file");
    expect(weakeningFindings(W, ["tests/fresh.test.ts"], files({ "tests/fresh.test.ts": [null, fresh] }), parseTrailers(["Test-Change: tests/fresh.test.ts - parked until the API lands"], "Test-Change")).every((f) => f.acknowledged)).toBe(true);
    expect(weakeningFindings(W, ["tests/fresh.test.ts"], files({ "tests/fresh.test.ts": [null, 'it("a", () => {\n  expect(1).toBe(1);\n});\n'] }), none)).toEqual([]);
  });

  it("counts .only on a test call only, never a property named only", () => {
    expect(modifierCounts("it.only('a', f); test.concurrent.only('b', f); describe.only.each([1])('c', f); suite.only('d', f); bench.only('e', f);").only).toBe(5);
    expect(modifierCounts("const keep = filter.only; opts.only = true; foo.it.only('x'); this.only;").only).toBe(0);
    const reading = TEST.replace('  it("plain"', '  it("reads the block filter", () => {\n    expect(parse("a,b").only).toEqual(["a", "b"]);\n  });\n  it("plain"');
    expect(weak(reading)).toEqual([]);
  });

  it("fails a deleted test file, a deleted smoke check( and a widened allow list", () => {
    expect(weak(null).map((f) => f.kind)).toEqual(["test-deleted", "expect-drop"]);
    const smoke = 'await smokeBlock("a", async () => {\ncheck("one", true);\ncheck("two", true);\n});\n';
    expect(weakeningFindings(W, [W.smokeFile], files({ [W.smokeFile]: [smoke, smoke.replace('check("two", true);\n', "")] }), none).map((f) => f.kind)).toEqual(["check-drop"]);
    const uncap = 'const ALLOWED: readonly [string, string][] = [\n  ["lib/unlimited.ts", "Math.min(range.max"],\n];\nit("x", () => { expect(1).toBe(1); });\n';
    const widened = uncap.replace("];", '  ["lib/new.ts", "Math.min(range.max, n)"],\n];');
    expect(weakeningFindings(W, ["tests/uncap.test.ts"], files({ "tests/uncap.test.ts": [uncap, widened] }), none).map((f) => f.kind)).toEqual(["allow-list-widened"]);
    // a new test file brings its own allow list: nothing was widened
    expect(weakeningFindings(W, ["tests/uncap.test.ts"], files({ "tests/uncap.test.ts": [null, widened] }), none)).toEqual([]);
  });

  it("reads only the files the checks need", () => {
    expect(filesToRead(PROTECTED, ["README.md", "tests/extras.test.ts", "scripts/smoke-test.mjs", "messages/en.json", "src/lib/uncap.ts", "src/lib/physics/box.ts"])).toEqual([
      "messages/en.json",
      "scripts/smoke-test.mjs",
      "src/lib/uncap.ts",
      "tests/extras.test.ts",
    ]);
  });
});
