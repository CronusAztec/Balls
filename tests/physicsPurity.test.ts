import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * --- ai-guard --- Physics purity: a mode's simulation draws its randomness from ctx.random() (the engine's seeded Mulberry32)
 * and its time from the fixed 60 Hz steps, never from the machine. Math.random, Date.now, performance.now, the Date
 * constructor, eval and the Function constructor make a seed play differently on each run, which breaks the determinism
 * fingerprints (tests/extras.test.ts), the share links, the finder and the exports. This scans the source with the TypeScript
 * parser, so comments and strings never count, and fails on any such call outside the ALLOWED list below.
 *
 * Scanned: src/lib/physics/modes/** today; src/lib/blueprint/** and src/lib/physics/tiles.ts as soon as they exist (the
 * Blueprint interpreter and its tiles must be as pure as a mode). The visual-only randomness of engine.ts (sparks, confetti)
 * is out of scope by design: it never feeds back into a ball.
 */

const ROOT = path.resolve(__dirname, "..");
/** Folders scanned recursively and single files, relative to the repository root (a missing one is skipped until it exists). */
const SCANNED = ["src/lib/physics/modes", "src/lib/blueprint", "src/lib/physics/tiles.ts"];

/**
 * The only impure calls allowed, each with its reason: file → a snippet of the line it is on. A stale entry fails the test,
 * so the list only shrinks. Adding an entry is a protected change (owner review).
 */
const ALLOWED: readonly { file: string; snippet: string; why: string }[] = [
  {
    file: "src/lib/physics/modes/orbGrid.ts",
    snippet: "seed: Date.now() | 0",
    why: "Find Simulation's instant answer for a rhythm field: every seed resolves on the cycle's clock, so the seed it hands back is any seed, not a physics input",
  },
];

/** A forbidden call: `kind` names it, `line` is 1-based. */
interface Hit {
  file: string;
  line: number;
  kind: string;
  text: string;
}

function sourceFiles(rel: string): string[] {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return /\.(ts|tsx)$/.test(full) ? [rel] : [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(child));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(child);
  }
  return out.sort();
}

/** `a.b.c` of a property-access chain or an identifier (null for anything else). */
function dotted(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const left = dotted(node.expression);
    return left === null ? null : `${left}.${node.name.text}`;
  }
  if (ts.isParenthesizedExpression(node)) return dotted(node.expression);
  return null;
}

/** The name with the global prefixes dropped (`globalThis.Math.random` → `Math.random`). */
const unglobal = (name: string) => name.replace(/^(?:globalThis|window|self|global)\./, "");

/** Every forbidden call in one file's source. */
function impureCalls(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const add = (node: ts.Node, kind: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ file, line: line + 1, kind, text: source.split("\n")[line].trim() });
  };
  const visit = (node: ts.Node) => {
    // Math.random / Date.now / performance.now / crypto's random sources, called or only referenced (an alias is a call later)
    if (ts.isPropertyAccessExpression(node)) {
      const name = dotted(node);
      if (name !== null) {
        const bare = unglobal(name);
        if (["Math.random", "Date.now", "performance.now", "crypto.getRandomValues", "crypto.randomUUID"].includes(bare)) add(node, bare);
      }
    }
    // new Date(…) / new Function(…)
    if (ts.isNewExpression(node)) {
      const name = dotted(node.expression);
      if (name !== null && ["Date", "Function"].includes(unglobal(name))) add(node, `new ${unglobal(name)}`);
    }
    // eval(…) / Function(…) / Date() (the current time as a string)
    if (ts.isCallExpression(node)) {
      const name = dotted(node.expression);
      if (name !== null && ["eval", "Function", "Date"].includes(unglobal(name))) add(node, `${unglobal(name)}()`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const isAllowed = (hit: Hit) => ALLOWED.some((a) => a.file === hit.file && hit.text.includes(a.snippet));

describe("physics purity: no machine randomness or clock in the simulation", () => {
  const files = SCANNED.flatMap(sourceFiles);
  const hits = files.flatMap((file) => impureCalls(file, fs.readFileSync(path.join(ROOT, file), "utf8")));

  it("scans every mode file (src/lib/physics/modes/**, recursively)", () => {
    expect(files.filter((f) => f.startsWith("src/lib/physics/modes/")).length).toBeGreaterThanOrEqual(60);
    expect(files).toContain("src/lib/physics/modes/fightLeagueRows/action.ts");
  });

  it("finds no Math.random, Date.now, performance.now, new Date(), eval or new Function outside the ALLOWED list", () => {
    const bad = hits.filter((h) => !isAllowed(h)).map((h) => `${h.file}:${h.line} ${h.kind} – ${h.text}`);
    expect(bad, "use ctx.random() for randomness and the engine's elapsed time (ctx.getElapsedMs()) for time").toEqual([]);
  });

  it("keeps the ALLOWED list exact: every entry still matches a call, and says why", () => {
    for (const a of ALLOWED) {
      expect(a.why.length, a.file).toBeGreaterThan(20);
      expect(hits.some((h) => h.file === a.file && h.text.includes(a.snippet)), `${a.file}: "${a.snippet}" no longer occurs – remove the entry`).toBe(true);
    }
  });

  it("catches each forbidden form, and ignores comments and strings", () => {
    const sample = [
      "// Math.random() in a comment",
      "/* Date.now() in a block comment */",
      'const s = "performance.now() in a string";',
      "const a = Math.random();",
      "const b = globalThis.Date.now();",
      "const c = performance.now();",
      "const d = new Date();",
      "const e = eval('1');",
      "const f = new Function('return 1');",
      "const g = Math.random;",
      "const h = window.crypto.getRandomValues(new Uint8Array(4));",
      "const i = Date();",
      "const ok = ctx.random() + Math.floor(2.5) + ctx.getElapsedMs();",
    ].join("\n");
    expect(impureCalls("sample.ts", sample).map((h) => `${h.line} ${h.kind}`)).toEqual([
      "4 Math.random",
      "5 Date.now",
      "6 performance.now",
      "7 new Date",
      "8 eval()",
      "9 new Function",
      "10 Math.random",
      "11 crypto.getRandomValues",
      "12 Date()",
    ]);
  });
});
