import { globToRegExp, matchesAny } from "./guardPlan";

/*
 * --- ai-guard --- The core guard's static checks of a change (base ref → working tree), pure over file texts so
 * tests/protectedDiff.test.ts can feed them fixture diffs:
 *  - the fingerprint lock: the BASELINE literal of tests/extras.test.ts (one entry per mode) and the per-mode fingerprint
 *    literals scripts/agent/protected.json lists. An added entry passes; a changed or removed one fails unless a commit in the
 *    range carries `Fingerprint-Change: <mode> - <reason>`;
 *  - the protected-path report: files and regions (a const, a message namespace) that need the owner's review. Reported,
 *    never a failure (owner decision for P0);
 *  - the test-weakening detector: a test file with fewer expect( calls than at the base (unless the statements it lost were
 *    added to another test file of the change that the runners still execute: a move), added .skip / .only / .skipIf /
 *    .runIf / .todo / .fails on a test call or a skip through a test's context (in new test files too), raised timeouts (a
 *    test's own, a const it names, vi.setConfig's, the vitest configs'), deleted test files (not a renamed or split one: its
 *    every expect reappears in a file that still runs), deleted smoke checks (by name, check by check), new entries in the
 *    allow lists (the uncap ALLOWED list) and core tests of the base that are gone. A finding fails unless a commit carries
 *    `Test-Change: <file> - <reason>` for it; an added .only on a test call always fails.
 * Comments, strings and whitespace never count: the sources are read through a small JavaScript tokenizer.
 */

/* ------------------------------------------------------------------------------------------------ tokens */

export interface Token {
  type: "ident" | "number" | "string" | "template" | "regex" | "punct";
  text: string;
  /** 1-based line of the token's first character. */
  line: number;
}

const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);
const PUNCT = ["===", "!==", "...", "**=", "&&=", "||=", "??=", "=>", "==", "!=", "<=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**"];

/**
 * JavaScript / TypeScript source as tokens, without whitespace and comments. A template literal is one token (its `${…}`
 * parts included, nesting counted); `>` is always a token of its own (so `Map<string, Array<number>>` closes twice).
 */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const prevAllowsRegex = () => {
    const prev = out[out.length - 1];
    if (!prev) return true;
    if (prev.type === "ident") return KEYWORDS_BEFORE_REGEX.has(prev.text);
    if (prev.type === "punct") return ![")", "]", "}"].includes(prev.text);
    return false;
  };
  const countLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (src.charCodeAt(k) === 10) line++;
  };
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === "﻿" || c === " ") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      countLines(i, stop);
      i = stop;
      continue;
    }
    const start = i;
    const startLine = line;
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      i++;
      out.push({ type: "string", text: src.slice(start, Math.min(i, n)), line: startLine });
      continue;
    }
    if (c === "`") {
      i++;
      let depth = 0;
      while (i < n) {
        const ch = src[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (depth === 0 && ch === "`") break;
        if (ch === "$" && src[i + 1] === "{") {
          depth++;
          i += 2;
          continue;
        }
        if (depth > 0 && ch === "}") depth--;
        else if (depth > 0 && ch === "{") depth++;
        i++;
      }
      i++;
      countLines(start, Math.min(i, n));
      out.push({ type: "template", text: src.slice(start, Math.min(i, n)), line: startLine });
      continue;
    }
    if (c === "/" && prevAllowsRegex()) {
      i++;
      let inClass = false;
      while (i < n && src[i] !== "\n") {
        const ch = src[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      out.push({ type: "regex", text: src.slice(start, i), line: startLine });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      i++;
      while (i < n && /[0-9a-zA-Z_.]/.test(src[i])) {
        if ((src[i] === "e" || src[i] === "E") && (src[i + 1] === "-" || src[i + 1] === "+")) i++;
        i++;
      }
      out.push({ type: "number", text: src.slice(start, i), line: startLine });
      continue;
    }
    if (/[A-Za-z_$\u0080-￿]/.test(c) || c === "#") {
      i++;
      while (i < n && /[A-Za-z0-9_$\u0080-￿]/.test(src[i])) i++;
      out.push({ type: "ident", text: src.slice(start, i), line: startLine });
      continue;
    }
    const op = c === ">" ? undefined : PUNCT.find((p) => src.startsWith(p, i));
    const text = op ?? c;
    i += text.length;
    out.push({ type: "punct", text, line: startLine });
  }
  return out;
}

/** Tokens as one comparable string: comments, whitespace and the line breaks gone. */
export const normalizeTokens = (tokens: readonly Token[]) => tokens.map((t) => t.text).join(" ");

/** A source's comparable form (comments and whitespace do not count). */
export const normalizeSource = (src: string) => normalizeTokens(tokenize(src));

/** A number token's value (`20_000` → 20000), NaN for anything else. */
export const numberValue = (t: Token | undefined) => (t && t.type === "number" ? Number(t.text.replace(/_/g, "")) : Number.NaN);

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSE = new Set([")", "]", "}"]);

/** The index of the token that closes the bracket at `open` (tokens.length when it never closes). */
function closingIndex(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type !== "punct") continue;
    if (OPEN[t.text]) depth++;
    else if (CLOSE.has(t.text)) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return tokens.length;
}

/**
 * The initializer of the first `const|let|var <name>` in a source: its tokens, from after the `=` to the end of the
 * declaration (`;` or `,` at its own depth, or a new line after a complete value). Null when there is no such declaration.
 */
export function extractConst(src: string, name: string): Token[] | null {
  const tokens = tokenize(src);
  for (let k = 0; k + 1 < tokens.length; k++) {
    if (tokens[k].type !== "ident" || !["const", "let", "var"].includes(tokens[k].text) || tokens[k + 1].text !== name || tokens[k + 1].type !== "ident") continue;
    // the type annotation (generics, function types) up to the `=` at depth 0
    let j = k + 2;
    let depth = 0;
    for (; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type !== "punct") continue;
      if (t.text === "(" || t.text === "[" || t.text === "{" || t.text === "<") depth++;
      else if (t.text === ")" || t.text === "]" || t.text === "}" || t.text === ">") depth--;
      else if (depth === 0 && t.text === "=") break;
      else if (depth === 0 && (t.text === ";" || t.text === ",")) return null;
    }
    if (j >= tokens.length) return null;
    const from = j + 1;
    const value: Token[] = [];
    for (let m = from; m < tokens.length; m++) {
      const t = tokens[m];
      if (t.type === "punct" && OPEN[t.text]) {
        const close = closingIndex(tokens, m);
        value.push(...tokens.slice(m, close + 1));
        m = close;
        continue;
      }
      if (t.type === "punct" && (t.text === ";" || t.text === "," || CLOSE.has(t.text))) break;
      const prev = value[value.length - 1];
      const complete = prev && (prev.type !== "punct" || CLOSE.has(prev.text));
      const startsValue = t.type !== "punct" || OPEN[t.text] !== undefined;
      if (prev && complete && startsValue && t.line > prev.line && !(t.type === "ident" && ["as", "satisfies"].includes(t.text))) break;
      value.push(t);
    }
    return value;
  }
  return null;
}

/** The top-level `key: value` entries of an object literal's tokens (`{ … }`): key → its value's normalized text. */
export function objectEntries(tokens: readonly Token[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!tokens.length || tokens[0].text !== "{") return out;
  const end = closingIndex(tokens, 0);
  let k = 1;
  while (k < end) {
    const keyTok = tokens[k];
    if (keyTok.text === ",") {
      k++;
      continue;
    }
    const key = keyTok.type === "string" ? keyTok.text.slice(1, -1) : keyTok.text;
    if (tokens[k + 1]?.text !== ":") {
      // a shorthand property or a spread: its own entry
      let m = k;
      while (m < end && tokens[m].text !== ",") m = tokens[m].type === "punct" && OPEN[tokens[m].text] ? closingIndex(tokens, m) + 1 : m + 1;
      out.set(normalizeTokens(tokens.slice(k, m)), normalizeTokens(tokens.slice(k, m)));
      k = m;
      continue;
    }
    let m = k + 2;
    const from = m;
    while (m < end && tokens[m].text !== ",") m = tokens[m].type === "punct" && OPEN[tokens[m].text] ? closingIndex(tokens, m) + 1 : m + 1;
    out.set(key, normalizeTokens(tokens.slice(from, m)));
    k = m;
  }
  return out;
}

/** The top-level elements of an array literal's tokens (`[ … ]`), each normalized. */
export function arrayElements(tokens: readonly Token[]): string[] {
  if (!tokens.length || tokens[0].text !== "[") return [];
  const end = closingIndex(tokens, 0);
  const out: string[] = [];
  let k = 1;
  while (k < end) {
    if (tokens[k].text === ",") {
      k++;
      continue;
    }
    let m = k;
    while (m < end && tokens[m].text !== ",") m = tokens[m].type === "punct" && OPEN[tokens[m].text] ? closingIndex(tokens, m) + 1 : m + 1;
    out.push(normalizeTokens(tokens.slice(k, m)));
    k = m;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ trailers */

/**
 * The commit trailers `<name>: <keys> - <reason>` in the messages (keys comma-separated: modes, or files and globs): key →
 * its reasons. The separator may be a hyphen, an en dash or an em dash; a trailer without a reason does not count.
 */
export function parseTrailers(messages: readonly string[], name: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = new RegExp(`^${name.replace(/[-]/g, "\\-")}:\\s*(.+?)\\s+[-–—]\\s+(.+?)\\s*$`, "i");
  for (const message of messages) {
    for (const lineText of message.split("\n")) {
      const m = re.exec(lineText.trim());
      if (!m || m[2].length < 3) continue;
      for (const key of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!out.has(key)) out.set(key, []);
        out.get(key)!.push(m[2]);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ protected.json */

/** A fingerprint literal the lock watches. */
export interface FingerprintLocator {
  file: string;
  /** record: a `const <name> = { mode: … }` (each key a mode); value: the whole const, for `mode`; lines: the lines matching
   *  `pattern`, for `mode`; json: a JSON file whose top-level keys are modes. */
  kind: "record" | "value" | "lines" | "json";
  const?: string;
  mode?: string;
  pattern?: string;
  why?: string;
}

/** A part of a file that needs the owner's review: a const's initializer, or a namespace of the message catalogs. */
export interface ProtectedRegion {
  /** A file, or a glob (messages/*.json). */
  file: string;
  const?: string;
  namespace?: string;
  why: string;
}

/** scripts/agent/protected.json. */
export interface ProtectedConfig {
  schema: 1;
  paths: { glob: string; why: string }[];
  regions: ProtectedRegion[];
  fingerprints: FingerprintLocator[];
  weakening: {
    /** Globs of the test sources (helpers included: they hold expectations too). */
    tests: string[];
    /**
     * Globs of the test files the runners execute (vitest's `include` of the site, the desktop app and the billing Worker,
     * the relay's tests). Expectations count as moved only into one of these, or into a helper one of them imports: a test
     * renamed to `tests/x.ts`, or expects moved into a fixture no test imports, no longer run.
     */
    runs?: string[];
    /** The vitest configs whose `testTimeout` and `hookTimeout` must not rise. */
    configs?: string[];
    smokeFile: string;
    /** Allow lists whose new entries widen a guard (the uncap ALLOWED list). */
    allowLists: { file: string; const: string; why: string }[];
  };
}

/** The runners' test files when protected.json names none (an older base): files named *.test.*. */
const DEFAULT_RUNS = ["**/*.test.ts", "**/*.test.mjs"];

/**
 * The rules a change is checked with: the base commit's protected.json joined with the working tree's. A rule the change adds
 * applies at once; one it removes or narrows (a fingerprint locator, a protected path or region, a weakening glob, an allow
 * list) still applies until the change is merged, so a change cannot switch off the check it would fail – its edit of
 * protected.json is reported for the owner's review. Where the two name a different smoke file, the base's holds. The
 * runners' globs (`runs`) are the two lists' common ones: a glob the change adds would accept more move targets.
 */
export function mergeProtectedConfigs(base: ProtectedConfig | null, head: ProtectedConfig): ProtectedConfig {
  if (!base) return head;
  const union = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined, key: (x: T) => string): T[] => {
    const seen = new Set<string>();
    return [...(a ?? []), ...(b ?? [])].filter((x) => {
      const k = key(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    ...head,
    paths: union(head.paths, base.paths, (p) => p.glob),
    regions: union(head.regions, base.regions, (r) => `${r.file}\0${r.const ?? ""}\0${r.namespace ?? ""}`),
    fingerprints: union(head.fingerprints, base.fingerprints, (l) => `${l.file}\0${l.kind}\0${l.const ?? ""}\0${l.pattern ?? ""}\0${l.mode ?? ""}`),
    weakening: {
      tests: union(head.weakening.tests, base.weakening?.tests, (g) => g),
      runs: base.weakening?.runs && head.weakening.runs ? head.weakening.runs.filter((g) => base.weakening.runs!.includes(g)) : (base.weakening?.runs ?? head.weakening.runs),
      configs: union(head.weakening.configs, base.weakening?.configs, (g) => g),
      smokeFile: base.weakening?.smokeFile ?? head.weakening.smokeFile,
      allowLists: union(head.weakening.allowLists, base.weakening?.allowLists, (l) => `${l.file}\0${l.const}`),
    },
  };
}

/** A file's text at the base ref and in the working tree (null: absent there). */
export interface FileVersions {
  base: string | null;
  head: string | null;
}

/* ------------------------------------------------------------------------------------------------ the fingerprint lock */

export interface FingerprintChange {
  file: string;
  /** The mode (the trailer's key). */
  mode: string;
  kind: "changed" | "removed" | "added";
  /** Which literal: BASELINE, a const, a pattern. */
  where: string;
  acknowledged: boolean;
  reasons: string[];
}

function lockedEntries(locator: FingerprintLocator, src: string | null): Map<string, string> | null {
  if (src === null) return null;
  if (locator.kind === "json") {
    try {
      const data = JSON.parse(src) as Record<string, unknown>;
      return new Map(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
    } catch {
      return new Map([["(unparsable JSON)", src]]);
    }
  }
  if (locator.kind === "lines") {
    const re = new RegExp(locator.pattern ?? "$^");
    const lines = new Map<string, string>();
    for (const lineText of src.split("\n")) if (re.test(lineText)) lines.set(normalizeSource(lineText), normalizeSource(lineText));
    return lines;
  }
  const value = extractConst(src, locator.const ?? "");
  if (value === null) return null;
  if (locator.kind === "record") return objectEntries(value);
  return new Map([[locator.mode ?? locator.const ?? "?", normalizeTokens(value)]]);
}

/**
 * The fingerprint lock over the listed literals: every changed, removed and added entry, the first two acknowledged when a
 * `Fingerprint-Change:` trailer names their mode. `files` maps a path to its two versions.
 */
export function fingerprintChanges(locators: readonly FingerprintLocator[], files: ReadonlyMap<string, FileVersions>, trailers: ReadonlyMap<string, string[]>): FingerprintChange[] {
  const out: FingerprintChange[] = [];
  for (const locator of locators) {
    const versions = files.get(locator.file);
    if (!versions) continue;
    const where = locator.kind === "lines" ? `lines /${locator.pattern}/` : locator.kind === "json" ? "the file" : (locator.const ?? "?");
    const before = lockedEntries(locator, versions.base);
    const after = lockedEntries(locator, versions.head);
    if (before === null && after === null) continue;
    const modeOf = (key: string) => (locator.kind === "record" || locator.kind === "json" ? key : (locator.mode ?? key));
    const push = (key: string, kind: FingerprintChange["kind"]) => {
      const mode = modeOf(key);
      const reasons = trailers.get(mode) ?? [];
      out.push({ file: locator.file, mode, kind, where, acknowledged: kind === "added" || reasons.length > 0, reasons });
    };
    if (locator.kind === "lines") {
      // a pinned line that is gone: changed (or removed); the lines are not keyed, so one entry per locator
      const gone = [...(before ?? new Map()).keys()].filter((k) => !(after ?? new Map()).has(k));
      const added = [...(after ?? new Map()).keys()].filter((k) => !(before ?? new Map()).has(k));
      if (gone.length) push(locator.mode ?? "?", added.length ? "changed" : "removed");
      else if (added.length) push(locator.mode ?? "?", "added");
      continue;
    }
    for (const [key, value] of before ?? new Map<string, string>()) {
      if (!after || !after.has(key)) push(key, "removed");
      else if (after.get(key) !== value) push(key, "changed");
    }
    for (const key of after?.keys() ?? []) if (!before || !before.has(key)) push(key, "added");
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ the protected report */

export interface ProtectedFinding {
  path: string;
  /** The glob, or the region (`ALLOWED`, `Privacy.*`). */
  rule: string;
  why: string;
  /** For a namespace: the keys added, changed or removed. */
  keys?: string[];
}

/** Every leaf of a JSON value with its dotted key. */
function flattenJson(node: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(node)) node.forEach((v, i) => flattenJson(v, `${prefix}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
  else out.set(prefix, JSON.stringify(node));
  return out;
}

const parseJson = (text: string | null): unknown => {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The protected paths and regions a change touches (owner review required). `changed` are the changed paths. */
export function protectedFindings(config: Pick<ProtectedConfig, "paths" | "regions">, changed: readonly string[], files: ReadonlyMap<string, FileVersions>): ProtectedFinding[] {
  const out: ProtectedFinding[] = [];
  for (const file of changed) {
    for (const p of config.paths) if (globToRegExp(p.glob).test(file)) out.push({ path: file, rule: p.glob, why: p.why });
    for (const region of config.regions) {
      if (!globToRegExp(region.file).test(file)) continue;
      const v = files.get(file);
      if (!v) continue;
      if (region.const) {
        const a = v.base === null ? null : extractConst(v.base, region.const);
        const b = v.head === null ? null : extractConst(v.head, region.const);
        const same = (a === null && b === null) || (a !== null && b !== null && normalizeTokens(a) === normalizeTokens(b));
        if (!same) out.push({ path: file, rule: region.const, why: region.why });
      } else if (region.namespace) {
        const ns = region.namespace;
        const pick = (text: string | null) => {
          const data = parseJson(text) as Record<string, unknown> | undefined;
          return flattenJson(data && typeof data === "object" ? data[ns] : undefined, ns);
        };
        const a = pick(v.base);
        const b = pick(v.head);
        const keys = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();
        if (keys.length) out.push({ path: file, rule: `${ns}.*`, why: region.why, keys });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ the weakening detector */

export interface WeakeningFinding {
  /** test-moved: a deleted test file whose every expect reappears in the change's other test files (a rename, a split, a
   *  merge) – a note, acknowledged by itself. core-test-dropped: a test of the base commit's core list that is gone and did
   *  not move to a test of the core list. */
  kind:
    | "expect-drop"
    | "only-added"
    | "skip-added"
    | "skipIf-added"
    | "runIf-added"
    | "todo-added"
    | "fails-added"
    | "timeout-raised"
    | "test-deleted"
    | "test-moved"
    | "check-drop"
    | "allow-list-widened"
    | "core-test-dropped";
  file: string;
  detail: string;
  /** For test-moved: the file its expects went to (the one with the most of them). */
  target?: string;
  /** A `Test-Change:` trailer names the file (never for an added .only). */
  acknowledged: boolean;
  reasons: string[];
}

/**
 * The assertions of a source, each as its normalized statement: expect(…), expect.soft(…), expect.poll(…) and
 * expectTypeOf(…) with the matcher chain after it (`expect ( a ) . not . toBe ( 1 )`) – the unit a moved expect is matched by.
 */
export function expectStatements(src: string): string[] {
  const t = tokenize(src);
  const out: string[] = [];
  for (let k = 0; k < t.length; k++) {
    if (t[k].type !== "ident" || (t[k].text !== "expect" && t[k].text !== "expectTypeOf") || t[k - 1]?.text === ".") continue;
    let end: number;
    if (t[k + 1]?.text === "(") end = closingIndex(t, k + 1);
    else if (t[k + 1]?.text === "." && t[k + 2]?.type === "ident" && t[k + 3]?.text === "(" && ["soft", "poll"].includes(t[k + 2].text)) end = closingIndex(t, k + 3);
    else continue;
    // the matcher chain: `.not`, `.resolves`, `.toBe(…)`, `[key]`
    while (end + 1 < t.length) {
      const next = t[end + 1];
      if ((next.text === "." || next.text === "?.") && t[end + 2]?.type === "ident") end += 2;
      else if (next.text === "(" || next.text === "[") end = closingIndex(t, end + 1);
      else break;
    }
    out.push(normalizeTokens(t.slice(k, Math.min(end, t.length - 1) + 1)));
  }
  return out;
}

/** expect(…), expect.soft(…), expect.poll(…) and expectTypeOf(…) calls: the test's assertions. */
export const countExpects = (src: string): number => expectStatements(src).length;

/** A multiset of strings (statement → how often). */
function bag(items: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const x of items) out.set(x, (out.get(x) ?? 0) + 1);
  return out;
}

/** The items of `a` that `b` does not have (as multisets): the statements a file lost. */
function bagMinus(a: readonly string[], b: readonly string[]): string[] {
  const left = bag(b);
  const out: string[] = [];
  for (const x of a) {
    const n = left.get(x) ?? 0;
    if (n > 0) left.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

/** Takes `items` (at most `limit` of them) out of the multiset `pool` where it has them; how many it took. */
function take(pool: Map<string, number>, items: readonly string[], limit = Number.POSITIVE_INFINITY): number {
  let n = 0;
  for (const x of items) {
    if (n >= limit) break;
    const c = pool.get(x) ?? 0;
    if (c > 0) {
      pool.set(x, c - 1);
      n++;
    }
  }
  return n;
}

/** The token indices of the smoke suite's check(…) and timingCheck(…) calls (not their definitions). */
function checkCalls(t: readonly Token[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < t.length; k++) {
    if (t[k].type !== "ident" || (t[k].text !== "check" && t[k].text !== "timingCheck") || t[k + 1]?.text !== "(") continue;
    const prev = t[k - 1]?.text;
    if (prev === "." || prev === "function") continue;
    out.push(k);
  }
  return out;
}

/** The smoke suite's check(…) and timingCheck(…) calls (not their definitions). */
export const countChecks = (src: string): number => checkCalls(tokenize(src)).length;

/**
 * --- ai-guard --- Each smoke check by its name: the call and its first argument when that is a string or a template
 * (`check "the end screen waits for the escape replay"`, quotes aside), else the whole normalized call – the unit a deleted
 * check is found by, so a check added in another block never offsets one removed here (a net count would).
 */
export function checkNames(src: string): string[] {
  const t = tokenize(src);
  return checkCalls(t).map((k) => {
    const close = closingIndex(t, k + 1);
    const first = t[k + 2];
    const alone = t[k + 3]?.text === "," || k + 3 === close;
    if (first && alone && first.type === "string") return `${t[k].text} ${JSON.stringify(first.text.slice(1, -1))}`;
    if (first && alone && first.type === "template") return `${t[k].text} ${first.text}`;
    return normalizeTokens(t.slice(k, close + 1));
  });
}

/** The calls a test file declares tests and suites with (the root of `it.only`, `describe.skip.each`, `test.concurrent.only`). */
const FOCUSABLE_CALLS = new Set(["it", "test", "describe", "suite", "bench"]);
const HOOKS = new Set(["beforeAll", "afterAll", "beforeEach", "afterEach"]);

/** The test calls of a source: vitest's own and the ones `test.extend(…)` makes (`const myTest = test.extend({ … })`). */
function testCallNames(t: readonly Token[]): Set<string> {
  const names = new Set(FOCUSABLE_CALLS);
  for (let pass = 0; pass < 2; pass++) {
    // (twice: an extension of an extension)
    for (let k = 0; k + 5 < t.length; k++) {
      if (!["const", "let", "var"].includes(t[k].text) || t[k + 1].type !== "ident" || t[k + 2].text !== "=") continue;
      if (names.has(t[k + 3].text) && t[k + 4].text === "." && t[k + 5].text === "extend") names.add(t[k + 1].text);
    }
  }
  return names;
}

/** Whether the modifier at token k ends a dotted chain rooted at a test call (`it.only`, `describe.concurrent.skip`), not a property (`filter.only`, `queue.skip`). */
function onTestCall(t: readonly Token[], k: number, calls: ReadonlySet<string> = FOCUSABLE_CALLS): boolean {
  let j = k - 1; // the "." before the modifier
  while (t[j]?.text === "." && t[j - 1]?.type === "ident") {
    j -= 2;
    if (t[j]?.text !== ".") return calls.has(t[j + 1].text);
  }
  return false;
}

/** The index of the `(` that opens a test call's own arguments: past its modifiers (`it.concurrent.skipIf(c)(…)`, `.each(table)(…)`); -1 when it is not a call. */
function testCallOpen(t: readonly Token[], k: number): number {
  let open = k + 1;
  while (t[open]?.text === "." && t[open + 1]?.type === "ident") {
    open += 2;
    if (t[open]?.text === "(" && t[closingIndex(t, open) + 1]?.text === "(") open = closingIndex(t, open) + 1;
  }
  return t[open]?.text === "(" ? open : -1;
}

/** The top-level arguments of the call whose `(` is at `open`, each as [first token, end) indices. */
function callArgs(t: readonly Token[], open: number): [number, number][] {
  const close = closingIndex(t, open);
  const out: [number, number][] = [];
  let from = open + 1;
  for (let m = open + 1; m < close; m++) {
    const tok = t[m];
    if (tok.type === "punct" && OPEN[tok.text]) {
      m = closingIndex(t, m);
      continue;
    }
    if (tok.text === ",") {
      out.push([from, m]);
      from = m + 1;
    }
  }
  if (from < close) out.push([from, close]);
  return out;
}

/** Whether the argument starting at token a is a function: `function …`, `async …`, `(…) =>`, `x =>`. */
function isFunctionArg(t: readonly Token[], a: number): boolean {
  const x = t[a];
  if (!x) return false;
  if (x.text === "function" || x.text === "async") return true;
  if (x.text === "(") return t[closingIndex(t, a) + 1]?.text === "=>";
  return x.type === "ident" && t[a + 1]?.text === "=>";
}

/**
 * The names a test's or a hook's callback gives its context (`async (ctx) => { … ctx.skip() }`) and the names a
 * destructured `skip` takes (`({ skip }) => { skip() }`): a skip through them skips the test as `it.skip` does.
 */
function testContexts(t: readonly Token[], calls: ReadonlySet<string>): { receivers: Set<string>; bare: Set<string> } {
  const receivers = new Set<string>();
  const bare = new Set<string>();
  for (let k = 0; k < t.length; k++) {
    if (t[k].type !== "ident" || !(calls.has(t[k].text) || HOOKS.has(t[k].text)) || t[k - 1]?.text === "." || t[k - 1]?.text === "function") continue;
    const open = testCallOpen(t, k);
    if (open < 0) continue;
    for (const [a] of callArgs(t, open)) {
      if (!isFunctionArg(t, a)) continue;
      let p = a;
      if (t[p].text === "async") p++;
      if (t[p]?.text === "function") p += t[p + 1]?.type === "ident" ? 2 : 1;
      if (t[p]?.type === "ident" && t[p + 1]?.text === "=>") receivers.add(t[p].text);
      else if (t[p]?.text === "(") {
        const first = t[p + 1];
        if (first?.type === "ident") receivers.add(first.text);
        else if (first?.text === "{") {
          const end = closingIndex(t, p + 1);
          for (let q = p + 2; q < end; q++) {
            if (t[q].text !== "skip" || t[q - 1].text === ":") continue;
            bare.add(t[q + 1]?.text === ":" && t[q + 2]?.type === "ident" ? t[q + 2].text : "skip");
          }
        }
      }
      break; // (a test has one callback)
    }
  }
  return { receivers, bare };
}

/** How often each skipping or narrowing modifier occurs. */
export type ModifierCounts = Record<"only" | "skip" | "skipIf" | "runIf" | "todo" | "fails", number>;
const MODIFIERS = new Set(["only", "skip", "skipIf", "runIf", "todo", "fails"]);
const NO_MODIFIERS: ModifierCounts = { only: 0, skip: 0, skipIf: 0, runIf: 0, todo: 0, fails: 0 };

/**
 * How often each skipping or narrowing modifier occurs on a test call (`it.only`, `describe.skip.each`,
 * `describe.runIf(false)`, `it.fails`, a `test.extend(…)` fixture's `.skip`), and a skip through a test's context
 * (`ctx.skip()`, a destructured `skip()`). A property or a method of the same name is not one: `filter.only`,
 * `queue.skip("q1")`. `.runIf(cond)` narrows like `.skipIf`; `.fails` inverts a test, so a broken assertion passes.
 */
export function modifierCounts(src: string): ModifierCounts {
  const t = tokenize(src);
  const calls = testCallNames(t);
  const ctx = testContexts(t, calls);
  const out: ModifierCounts = { ...NO_MODIFIERS };
  for (let k = 1; k < t.length; k++) {
    const tok = t[k];
    if (tok.type !== "ident") continue;
    const dot = t[k - 1].text === "." || t[k - 1].text === "?.";
    if (dot && MODIFIERS.has(tok.text)) {
      const name = tok.text as keyof ModifierCounts;
      if (t[k - 1].text === "." && onTestCall(t, k, calls)) out[name]++;
      else if (name === "skip" && t[k - 2]?.type === "ident" && ctx.receivers.has(t[k - 2].text) && t[k - 3]?.text !== "." && t[k - 3]?.text !== "?.") out.skip++;
    } else if (!dot && ctx.bare.has(tok.text) && t[k + 1]?.text === "(" && t[k - 1].text !== "function") out.skip++;
  }
  return out;
}

/** How many tests, suites and benchmarks a source declares (it(…), describe.each(…)(…), a fixture's test(…)). */
function testCallCount(src: string): number {
  const t = tokenize(src);
  const calls = testCallNames(t);
  let n = 0;
  for (let k = 0; k < t.length; k++) if (t[k].type === "ident" && calls.has(t[k].text) && t[k - 1]?.text !== "." && t[k - 1]?.text !== "function" && testCallOpen(t, k) >= 0) n++;
  return n;
}

const TEST_CALLS = new Set([...FOCUSABLE_CALLS, ...HOOKS]);
const VITEST_DEFAULT_TIMEOUT_MS = 5000;
/** vitest's defaults for the file- and config-level keys. */
const DEFAULT_TIMEOUTS: Record<string, number> = { testTimeout: 5000, hookTimeout: 10000 };

/** A timeout: milliseconds, or the normalized text of an expression the detector cannot read (`process.env.CI ? 9e5 : 2e4`). */
export type TimeoutValue = number | string;

/**
 * The value of an argument's tokens as a timeout: a number, arithmetic on numbers (`30_000 * 2`), or a const of the same
 * source that holds one (`SLOW`, through extractConst). A function or an object is no timeout (null); anything else is kept
 * as its text, so a timeout the detector cannot read still counts as changed when its text changes.
 */
function timeoutValue(src: string, tokens: readonly Token[], depth = 0): TimeoutValue | null {
  if (!tokens.length || tokens.some((x) => x.text === "=>" || x.text === "function" || x.text === "{" || x.text === "class")) return null;
  let i = 0;
  let unreadable = false;
  const fail = () => {
    unreadable = true;
    return Number.NaN;
  };
  const ident = (name: string): number => {
    const value = depth < 4 ? extractConst(src, name) : null;
    const v = value ? timeoutValue(src, value, depth + 1) : null;
    return typeof v === "number" ? v : fail();
  };
  const factor = (): number => {
    const tk = tokens[i++];
    if (!tk) return fail();
    if (tk.type === "number") return numberValue(tk);
    if (tk.type === "ident") return ident(tk.text);
    if (tk.text === "-") return -factor();
    if (tk.text === "(") {
      const v = expr();
      return tokens[i++]?.text === ")" ? v : fail();
    }
    return fail();
  };
  const term = (): number => {
    let v = factor();
    while (tokens[i]?.text === "*" || tokens[i]?.text === "/") v = tokens[i++].text === "*" ? v * factor() : v / factor();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (tokens[i]?.text === "+" || tokens[i]?.text === "-") v = tokens[i++].text === "+" ? v + term() : v - term();
    return v;
  };
  const v = expr();
  return unreadable || i !== tokens.length || !Number.isFinite(v) ? normalizeTokens(tokens) : v;
}

/** The value of `key:` in the object literal at token `open` (`{ timeout: SLOW }`; shorthand `{ timeout }` reads the const). */
function objectKeyValue(src: string, t: readonly Token[], open: number, key: string): TimeoutValue | null | undefined {
  const end = closingIndex(t, open);
  for (let q = open + 1; q < end; q++) {
    if (t[q].type === "punct" && OPEN[t[q].text]) {
      q = closingIndex(t, q);
      continue;
    }
    if (t[q].type !== "ident" || t[q].text !== key || (t[q - 1].text !== "{" && t[q - 1].text !== ",")) continue;
    if (t[q + 1]?.text === "," || q + 1 === end) return timeoutValue(src, [t[q]]);
    if (t[q + 1]?.text !== ":") continue;
    let m = q + 2;
    while (m < end && t[m].text !== ",") m = t[m].type === "punct" && OPEN[t[m].text] ? closingIndex(t, m) + 1 : m + 1;
    return timeoutValue(src, t.slice(q + 2, m));
  }
  return undefined;
}

/**
 * Every test call with its own timeout (null: vitest's default): `it("title", { timeout: N }, …)`, `it("title", …, N)`, the
 * hooks' trailing argument – a number, a const (`}, SLOW)`, `{ timeout: SLOW }`) or arithmetic on them. Keyed by the call
 * and its title (`it "boots every mode"`, `beforeAll #`), with the occurrence index for a repeated key (`it "x" (2)`). A
 * file-wide `vi.setConfig({ testTimeout, hookTimeout })` is the keys `vi.setConfig testTimeout` and `vi.setConfig hookTimeout`.
 */
export function testTimeouts(src: string): Map<string, TimeoutValue | null> {
  const t = tokenize(src);
  const calls = testCallNames(t);
  const out = new Map<string, TimeoutValue | null>();
  const seen = new Map<string, number>();
  const keyed = (base: string) => {
    const nth = (seen.get(base) ?? 0) + 1;
    seen.set(base, nth);
    return nth > 1 ? `${base} (${nth})` : base;
  };
  for (let k = 0; k < t.length; k++) {
    if (t[k].type !== "ident" || t[k - 1]?.text === "." || t[k - 1]?.text === "function") continue;
    // --- ai-guard --- the file's own defaults: vi.setConfig({ testTimeout: …, hookTimeout: … })
    if (t[k].text === "vi" && t[k + 1]?.text === "." && t[k + 2]?.text === "setConfig" && t[k + 3]?.text === "(" && t[k + 4]?.text === "{") {
      for (const key of ["testTimeout", "hookTimeout"]) {
        const v = objectKeyValue(src, t, k + 4, key);
        if (v !== undefined) out.set(keyed(`vi.setConfig ${key}`), v);
      }
      continue;
    }
    if (!TEST_CALLS.has(t[k].text) && !calls.has(t[k].text)) continue;
    const open = testCallOpen(t, k);
    if (open < 0) continue;
    const args = callArgs(t, open);
    const first = t[open + 1];
    const title = first && (first.type === "string" || first.type === "template") ? JSON.stringify(first.text.slice(1, -1)) : "#";
    const key = keyed(`${t[k].text} ${title}`);
    let timeout: TimeoutValue | null = null;
    // an options object among the call's own arguments ({ timeout: N } before or after the callback)
    for (const [a] of args) {
      if (t[a].text !== "{") continue;
      const v = objectKeyValue(src, t, a, "timeout");
      if (v !== undefined) timeout = v;
    }
    // the argument after the callback (`…, N)`); with no callback literal, the third (a hook's second)
    if (timeout === null) {
      const fnAt = args.findIndex(([a]) => isFunctionArg(t, a));
      const arg = args[fnAt >= 0 ? fnAt + 1 : HOOKS.has(t[k].text) ? 1 : 2];
      if (arg && t[arg[0]].text !== "{") timeout = timeoutValue(src, t.slice(arg[0], arg[1]));
    }
    out.set(key, timeout);
  }
  return out;
}

/** A vitest config's `testTimeout` and `hookTimeout` entries (vitest.config.ts, desktop/vitest.config.ts), keyed by name. */
export function configTimeouts(src: string): Map<string, TimeoutValue | null> {
  const t = tokenize(src);
  const out = new Map<string, TimeoutValue | null>();
  const seen = new Map<string, number>();
  for (let k = 0; k + 1 < t.length; k++) {
    if (t[k].type !== "ident" || !Object.hasOwn(DEFAULT_TIMEOUTS, t[k].text) || t[k + 1].text !== ":") continue;
    let m = k + 2;
    while (m < t.length && t[m].text !== "," && !CLOSE.has(t[m].text)) m = t[m].type === "punct" && OPEN[t[m].text] ? closingIndex(t, m) + 1 : m + 1;
    const nth = (seen.get(t[k].text) ?? 0) + 1;
    seen.set(t[k].text, nth);
    out.set(nth > 1 ? `${t[k].text} (${nth})` : t[k].text, timeoutValue(src, t.slice(k + 2, m)));
  }
  return out;
}

/** Whether a timeout rose: a longer one, or one the detector cannot read whose text changed. `fallback`: what applied before. */
function timeoutRaised(before: TimeoutValue, now: TimeoutValue | null): boolean {
  if (now === null) return false;
  if (typeof now === "number" && typeof before === "number") return now > before;
  return now !== before;
}

const showTimeout = (v: TimeoutValue | null | undefined, fallback: number) => (v === null || v === undefined ? `${fallback} (the default)` : typeof v === "number" ? String(v) : `\`${v}\``);

/** Whether a `Test-Change:` trailer names the file (a path or a glob). */
function testAck(file: string, trailers: ReadonlyMap<string, string[]>): string[] {
  const reasons: string[] = [];
  for (const [key, list] of trailers) if (key === file || globToRegExp(key).test(file)) reasons.push(...list);
  return reasons;
}

/** What the weakening detector needs beyond the file texts. */
export interface WeakeningOptions {
  /**
   * Whether a test source that no `runs` glob names (a helper, a fixture) is imported, directly or through other files, by
   * a test file the runners execute – in the working tree. guard.mjs answers from the import graph; without it, none is.
   */
  imported?: (file: string) => boolean;
}

/**
 * The weakening findings of a change: `files` holds both versions of every changed path, `changed` the paths.
 *
 * The expect( count is judged per file: a test file that has fewer expect calls than at the base dropped some, unless the
 * very statements it lost (their normalized tokens) were added to another test file of the change that still runs – a test
 * file the runners execute (`runs`) or a helper one of them imports – a test moved, renamed, split or merged. So an expect
 * added anywhere else (a new file, another test) never offsets one removed here, and one moved into a file no runner reaches
 * (`tests/x.ts`, an unimported fixture) is dropped. A deleted test file whose every expect reappears in such a file is a
 * move (a `test-moved` note, no failure); a new file it moved to is compared with it, as a modified file would be. A deleted
 * helper with no expect and no test call cannot weaken anything: no finding. Any other new test file is checked for
 * modifiers against none.
 */
export function weakeningFindings(
  config: ProtectedConfig["weakening"],
  changed: readonly string[],
  files: ReadonlyMap<string, FileVersions>,
  trailers: ReadonlyMap<string, string[]>,
  options: WeakeningOptions = {},
): WeakeningFinding[] {
  const out: WeakeningFinding[] = [];
  const add = (kind: WeakeningFinding["kind"], file: string, detail: string, acknowledged?: string[], target?: string) => {
    const reasons = acknowledged ?? (kind === "only-added" ? [] : testAck(file, trailers));
    out.push({ kind, file, detail, ...(target ? { target } : {}), acknowledged: reasons.length > 0, reasons });
  };
  const runs = config.runs ?? DEFAULT_RUNS;
  /** A test source the runners still reach in the working tree: a move target. */
  const executed = (f: string) => (files.get(f)?.head ?? null) !== null && (matchesAny(f, runs) || options.imported?.(f) === true);
  const testFiles = changed.filter((f) => matchesAny(f, config.tests)).sort();
  const statements = new Map<string, { before: string[]; after: string[]; added: string[] }>();
  for (const file of testFiles) {
    const v = files.get(file);
    if (!v || (v.base === null && v.head === null)) continue;
    const before = v.base === null ? [] : expectStatements(v.base);
    const after = v.head === null ? [] : expectStatements(v.head);
    statements.set(file, { before, after, added: bagMinus(after, before) });
  }
  const isNew = (f: string) => files.get(f)!.base === null;
  // every statement the change adds to a test file that still runs: where a removed one may have moved
  let pool = bag([...statements].filter(([f]) => executed(f)).flatMap(([, x]) => x.added));
  const pairedWith = new Map<string, string>();
  for (const [file, { before, after }] of statements) {
    const v = files.get(file)!;
    if (v.base === null) continue;
    const deficit = before.length - after.length;
    if (v.head !== null && deficit <= 0) continue;
    // a deleted helper with no assertion and no test of its own (merged into another helper): nothing weakened
    if (v.head === null && !before.length && !testCallCount(v.base)) continue;
    const removed = bagMinus(before, after);
    const trial = new Map(pool);
    const matched = take(trial, removed, Math.max(0, deficit));
    const kept = matched >= deficit;
    if (kept) pool = trial;
    if (v.head === null) {
      // a deleted file moved when its every expect is in a file that still runs (one without any: when such a file holds its
      // very source – a new one by itself, or an existing one it was merged into)
      const base = normalizeSource(v.base);
      const candidates = [...statements.keys()].filter((f) => f !== file && executed(f));
      const same =
        candidates.find((f) => isNew(f) && !pairedWith.has(f) && normalizeSource(files.get(f)!.head!) === base) ??
        (before.length ? undefined : candidates.find((f) => normalizeSource(files.get(f)!.head!).includes(base)));
      const score = (f: string) => take(bag(statements.get(f)!.added), removed);
      const target = same ?? (before.length && kept ? candidates.filter((f) => score(f) > 0).sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0] : undefined);
      if (target) {
        if (isNew(target)) pairedWith.set(target, file);
        add("test-moved", file, `moved to ${target} (${before.length} expect calls)`, [`its ${before.length} expect calls are all in test files the runners still execute`], target);
        continue;
      }
      add("test-deleted", file, `deleted (${before.length} expect calls${testFiles.some((f) => f !== file && !executed(f) && isNew(f)) ? "; a file no runner executes is no move target" : ""})`);
    }
    if (!kept) add("expect-drop", file, `expect calls ${before.length} → ${after.length} (${deficit - matched} removed and added to no other test file of the change that still runs)`);
  }
  for (const file of statements.keys()) {
    const v = files.get(file)!;
    if (v.head === null) continue;
    // a new file is compared with the file it was moved from, else with nothing
    const baseSrc = v.base ?? (pairedWith.has(file) ? files.get(pairedWith.get(file)!)!.base : null);
    const a = baseSrc === null ? NO_MODIFIERS : modifierCounts(baseSrc);
    const b = modifierCounts(v.head);
    const was = v.base === null ? (baseSrc === null ? " (a new file)" : ` (moved from ${pairedWith.get(file)})`) : "";
    if (b.only > a.only) add("only-added", file, `.only ${a.only} → ${b.only}${was}`);
    if (b.skip > a.skip) add("skip-added", file, `.skip ${a.skip} → ${b.skip}${was}`);
    if (b.skipIf > a.skipIf) add("skipIf-added", file, `.skipIf ${a.skipIf} → ${b.skipIf}${was}`);
    if (b.runIf > a.runIf) add("runIf-added", file, `.runIf ${a.runIf} → ${b.runIf}${was}`);
    if (b.todo > a.todo) add("todo-added", file, `.todo ${a.todo} → ${b.todo}${was}`);
    if (b.fails > a.fails) add("fails-added", file, `.fails ${a.fails} → ${b.fails}${was} (an inverted test passes while its assertion fails)`);
    if (baseSrc === null) continue;
    // a raised timeout: a test (or hook) that existed before now waits longer (a new test may bring its own); a file-wide
    // vi.setConfig counts against vitest's default when the base had none
    const ta = testTimeouts(baseSrc);
    for (const [key, now] of testTimeouts(v.head)) {
      const fileWide = key.startsWith("vi.setConfig ");
      if (!ta.has(key) && !fileWide) continue;
      const fallback = fileWide ? DEFAULT_TIMEOUTS[key.split(" ")[1]] : VITEST_DEFAULT_TIMEOUT_MS;
      const before = ta.get(key) ?? fallback;
      if (timeoutRaised(before, now)) add("timeout-raised", file, `${key}: ${showTimeout(ta.get(key), fallback)} → ${showTimeout(now, fallback)} ms`);
    }
  }
  // --- ai-guard --- the vitest configs' own defaults (a raised testTimeout there lengthens every test of the suite)
  for (const file of config.configs ?? []) {
    const v = files.get(file);
    if (!v || !changed.includes(file) || v.base === null || v.head === null) continue;
    const ta = configTimeouts(v.base);
    for (const [key, now] of configTimeouts(v.head)) {
      const fallback = DEFAULT_TIMEOUTS[key.split(" ")[0]];
      if (timeoutRaised(ta.get(key) ?? fallback, now)) add("timeout-raised", file, `${key}: ${showTimeout(ta.get(key), fallback)} → ${showTimeout(now, fallback)} ms`);
    }
  }
  const smoke = files.get(config.smokeFile);
  if (smoke && changed.includes(config.smokeFile)) {
    // --- ai-guard --- judged check by check: a check removed from one block is not offset by one added to another
    const before = smoke.base === null ? [] : checkNames(smoke.base);
    const after = smoke.head === null ? [] : checkNames(smoke.head);
    const gone = bagMinus(before, after);
    if (gone.length) add("check-drop", config.smokeFile, `check( calls ${before.length} → ${after.length}; gone: ${gone.slice(0, 5).map((g) => g.slice(0, 100)).join(" | ")}${gone.length > 5 ? ` (+${gone.length - 5})` : ""}`);
  }
  for (const list of config.allowLists) {
    const v = files.get(list.file);
    // (a new file brings a new guard with its exceptions: nothing was widened)
    if (!v || !changed.includes(list.file) || v.head === null || v.base === null) continue;
    const a = arrayElements(extractConst(v.base, list.const) ?? []);
    const b = arrayElements(extractConst(v.head, list.const) ?? []);
    const added = b.filter((e) => !a.includes(e));
    if (added.length) add("allow-list-widened", list.file, `${list.const}: ${added.length} new entr${added.length === 1 ? "y" : "ies"} – ${added.map((e) => e.slice(0, 120)).join(" | ")}`);
  }
  return out;
}

/**
 * --- ai-guard --- The base commit's core tests that are gone from the working tree: a failure (core-test-dropped) unless
 * the test moved to a test file on the core list the change is checked with (`core`), or a `Test-Change:` trailer names it.
 * A core test that still exists stays on that list (mergeCoreConfigs keeps it), so tier 0 keeps running it.
 */
export function coreTestFindings(input: { baseCore: readonly string[]; core: readonly string[]; exists: (file: string) => boolean; weakening: readonly WeakeningFinding[]; trailers: ReadonlyMap<string, string[]> }): WeakeningFinding[] {
  const out: WeakeningFinding[] = [];
  for (const file of input.baseCore) {
    if (input.exists(file)) continue;
    const moved = input.weakening.find((w) => w.kind === "test-moved" && w.file === file);
    if (moved?.target && input.core.includes(moved.target)) continue;
    const reasons = testAck(file, input.trailers);
    const detail = moved?.target ? `a core test moved to ${moved.target}, which is not on the core list: tier 0 no longer runs it` : "a core test of the base commit is gone: tier 0 no longer runs it";
    out.push({ kind: "core-test-dropped", file, detail, acknowledged: reasons.length > 0, reasons });
  }
  return out;
}

/** The paths whose two versions the static checks read: the changed ones they care about and every locked literal's file. */
export function filesToRead(config: ProtectedConfig, changed: readonly string[]): string[] {
  const wanted = new Set<string>();
  for (const f of changed) {
    if (matchesAny(f, config.weakening.tests) || f === config.weakening.smokeFile) wanted.add(f);
    if ((config.weakening.configs ?? []).includes(f)) wanted.add(f);
    if (config.regions.some((r) => globToRegExp(r.file).test(f))) wanted.add(f);
    if (config.weakening.allowLists.some((l) => l.file === f)) wanted.add(f);
  }
  for (const l of config.fingerprints) if (changed.includes(l.file)) wanted.add(l.file);
  return [...wanted].sort();
}
