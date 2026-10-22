import { globToRegExp, matchesAny } from "./guardPlan";

/*
 * --- ai-guard --- The core guard's static checks of a change (base ref → working tree), pure over file texts so
 * tests/protectedDiff.test.ts can feed them fixture diffs:
 *  - the fingerprint lock: the BASELINE literal of tests/extras.test.ts (one entry per mode) and the per-mode fingerprint
 *    literals scripts/agent/protected.json lists. An added entry (a new mode, a new row of a pinned table) passes; a changed
 *    or removed one fails unless a commit in the range carries `Fingerprint-Change: <mode> - <reason>` – and so does an edit
 *    of the code outside the literal that mentions it (a write after it, a decoy declaration, a changed comparison);
 *  - the protected-path report: files and regions (a const with the code that mentions it, a message namespace) that need
 *    the owner's review. Reported, never a failure (owner decision for P0);
 *  - the test-weakening detector: a test file with fewer expect( calls than at the base (unless the statements it lost were
 *    added to another test file of the change that the runners still execute: a move), an expect statement rewritten in
 *    place (the count holds, the assertion does not), added .skip / .only / .skipIf / .runIf / .todo / .fails on a test call
 *    (`it["skip"]`, an alias of `it`, a cast and a destructured modifier included) or a skip through a test's context (in new
 *    test files too), raised timeouts (a test's own, a const it names, vi.setConfig's, the vitest configs'), deleted test
 *    files (not a renamed or split one: its every expect reappears in a file that still runs), deleted smoke checks (by name,
 *    check by check), new entries in the allow lists (the uncap ALLOWED list) or an edit of the code that mentions them, core
 *    tests of the base that are gone, and – after the tests ran – skips the run shows that the source does not
 *    (runtimeSkipFindings). A finding fails unless a commit carries `Test-Change: <file> - <reason>` for it; an added .only
 *    on a test call always fails.
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

/**
 * Tokens as one comparable string: comments, whitespace and the line breaks gone, and a trailing comma before a closing
 * bracket too (a formatter adds it to a call split over lines; it changes nothing).
 */
export const normalizeTokens = (tokens: readonly Token[]) =>
  tokens
    .filter((t, i) => !(t.type === "punct" && t.text === "," && (tokens[i + 1]?.text === ")" || tokens[i + 1]?.text === "]" || tokens[i + 1]?.text === "}")))
    .map((t) => t.text)
    .join(" ");

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

/** The index of the token that opens the bracket closing at `close` (-1 when it never opens). */
function openingIndex(tokens: readonly Token[], close: number): number {
  let depth = 0;
  for (let k = close; k >= 0; k--) {
    const t = tokens[k];
    if (t.type !== "punct") continue;
    if (CLOSE.has(t.text)) depth++;
    else if (OPEN[t.text]) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Where a declaration's value ends (exclusive): `;` or `,` at its own depth, a closing bracket, or a new line after a complete value. */
function valueEnd(tokens: readonly Token[], from: number): number {
  let prev: Token | undefined;
  for (let m = from; m < tokens.length; m++) {
    const t = tokens[m];
    if (t.type === "punct" && OPEN[t.text]) {
      m = closingIndex(tokens, m);
      prev = tokens[m];
      continue;
    }
    if (t.type === "punct" && (t.text === ";" || t.text === "," || CLOSE.has(t.text))) return m;
    const complete = prev && (prev.type !== "punct" || CLOSE.has(prev.text));
    const startsValue = t.type !== "punct" || OPEN[t.text] !== undefined;
    if (prev && complete && startsValue && t.line > prev.line && !(t.type === "ident" && ["as", "satisfies"].includes(t.text))) return m;
    prev = t;
  }
  return tokens.length;
}

/** The first `const|let|var <name> = …` of a token list: the declaration's first token and its value's [from, to) range. */
function constSpan(tokens: readonly Token[], name: string): { decl: number; from: number; to: number } | null {
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
    return { decl: k, from: j + 1, to: valueEnd(tokens, j + 1) };
  }
  return null;
}

/**
 * The initializer of the first `const|let|var <name>` in a source: its tokens, from after the `=` to the end of the
 * declaration (`;` or `,` at its own depth, or a new line after a complete value). Null when there is no such declaration.
 */
export function extractConst(src: string, name: string): Token[] | null {
  const tokens = tokenize(src);
  const span = constSpan(tokens, name);
  return span ? tokens.slice(span.from, span.to) : null;
}

/** Tokens after which a new line does not start a statement (the expression goes on: `}\n.then(…)`, `}\nelse {`). */
const CONTINUES = new Set([".", "?.", ",", ")", "]", "}", ":", "?", "=", "=>", "==", "===", "!=", "!==", "<", ">", "<=", "+", "-", "*", "/", "%", "**", "&&", "||", "??", "&", "|", "^", "+=", "-=", "*=", "/=", "&&=", "||=", "??="]);
const CONTINUES_WORDS = new Set(["as", "satisfies", "instanceof", "in", "of", "else", "catch", "finally", "while"]);
const startsStatement = (t: Token | undefined) => !!t && (t.type === "punct" ? !CONTINUES.has(t.text) : !(t.type === "ident" && CONTINUES_WORDS.has(t.text)));

/**
 * The token range [from, to) of the statement that holds token k: back to a `;` or an unclosed `{` (or a block that ended on
 * an earlier line), forward to a `;`, an unclosed `}` or a block that ends its line. A call or a literal the token sits in
 * belongs to it whole (`expect(x).toEqual(BASELINE[mode]);`, `for (const f of FORMATS) { … }` with its body).
 */
function statementAround(t: readonly Token[], k: number): [number, number] {
  let a = k;
  const closers: string[] = [];
  for (; a > 0; a--) {
    const p = t[a - 1];
    if (p.type !== "punct") continue;
    if (CLOSE.has(p.text)) {
      if (!closers.length && p.text === "}" && t[a].line > p.line && startsStatement(t[a])) break;
      closers.push(p.text);
    } else if (OPEN[p.text]) {
      if (closers.length) closers.pop();
      else if (p.text === "{") break;
    } else if (p.text === ";" && !closers.length) break;
  }
  let b = k + 1;
  const openers: string[] = [];
  for (; b < t.length; b++) {
    const p = t[b];
    if (p.type !== "punct") continue;
    if (OPEN[p.text]) openers.push(p.text);
    else if (CLOSE.has(p.text)) {
      if (openers.length) {
        const was = openers.pop();
        if (!openers.length && was === "{" && t[b + 1] && t[b + 1].line > p.line && startsStatement(t[b + 1])) {
          b++;
          break;
        }
      } else if (p.text === "}") break;
    } else if (p.text === ";" && !openers.length) {
      b++;
      break;
    }
  }
  return [a, b];
}

/**
 * --- ai-guard --- Every statement of a source, outside the first `const <name>` declaration, that mentions `name` (not as a
 * property: `x.name`), normalized and sorted: the writes a locked literal could be changed by after its initializer
 * (`BASELINE.conveyor = …`, `Object.assign(BASELINE, …)`, `(ALLOWED as T[]).push(…)`, a second declaration, an alias) and
 * the reads that compare with it. A statement added, changed or removed between two versions is a change of the literal.
 */
export function constUses(src: string, name: string): string[] {
  const t = tokenize(src);
  const span = constSpan(t, name);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let k = 0; k < t.length; k++) {
    if (t[k].type !== "ident" || t[k].text !== name) continue;
    if (span && k >= span.decl && k < span.to) continue;
    if (t[k - 1]?.text === "." || t[k - 1]?.text === "?.") continue;
    const [a, b] = statementAround(t, k);
    if (seen.has(`${a}:${b}`)) continue;
    seen.add(`${a}:${b}`);
    out.push(normalizeTokens(t.slice(a, b)));
  }
  return out.sort();
}

/** The statements of `after` that `before` does not have, and those it lost (as multisets). */
function usesDiff(before: readonly string[], after: readonly string[]): { added: string[]; gone: string[] } {
  return { added: bagMinus(after, before), gone: bagMinus(before, after) };
}

/** A statement for a finding's text: at most `max` characters. */
const clip = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

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
  /** What changed, when the entry alone does not say: an edit outside the literal, the rows of a pinned table. */
  detail?: string;
}

/**
 * --- ai-guard --- A literal's comparable parts: its entries (an object's keys, an array's elements in order, else the whole
 * value) and its tail – what follows the brackets in the initializer (`[…].slice(0, 0)`, `{…} && {}`), which changes the
 * value without changing an entry.
 */
interface LiteralParts {
  shape: "object" | "array" | "scalar";
  keys: Map<string, string>;
  items: string[];
  tail: string;
}

function literalParts(value: readonly Token[]): LiteralParts {
  const first = value[0]?.text;
  if (first === "{" || first === "[") {
    const tail = normalizeTokens(value.slice(closingIndex(value, 0) + 1));
    return first === "{" ? { shape: "object", keys: objectEntries(value), items: [], tail } : { shape: "array", keys: new Map(), items: arrayElements(value), tail };
  }
  return { shape: "scalar", keys: new Map(), items: [normalizeTokens(value)], tail: "" };
}

/** Whether `small`'s items occur in `big` in the same order (others may come between and after them). */
function isSubsequence(small: readonly string[], big: readonly string[]): boolean {
  let i = 0;
  for (const x of big) if (i < small.length && x === small[i]) i++;
  return i === small.length;
}

/**
 * --- ai-guard --- How a locked value changed, element by element: rows added to a pinned table (in an array, its old rows
 * still there in their order; in an object, new keys) are "added"; a row changed, reordered or gone is "changed" or
 * "removed"; a scalar compares whole. Null: unchanged.
 */
function valueChange(before: LiteralParts | null, after: LiteralParts | null): { kind: FingerprintChange["kind"]; detail?: string } | null {
  if (!before && !after) return null;
  if (!before) return { kind: "added" };
  if (!after) return { kind: "removed" };
  if (before.shape !== after.shape || before.tail !== after.tail) return { kind: "changed", detail: before.tail !== after.tail ? "the code after the literal changed" : undefined };
  if (before.shape === "object") {
    const gone = [...before.keys.keys()].filter((k) => !after.keys.has(k));
    const changed = [...before.keys].filter(([k, v]) => after.keys.has(k) && after.keys.get(k) !== v).map(([k]) => k);
    const added = [...after.keys.keys()].filter((k) => !before.keys.has(k));
    if (changed.length || gone.length) return { kind: changed.length ? "changed" : "removed", detail: `${[...changed, ...gone].slice(0, 6).join(", ")}` };
    return added.length ? { kind: "added", detail: `${added.length} new entr${added.length === 1 ? "y" : "ies"}` } : null;
  }
  const a = before.items;
  const b = after.items;
  if (a.length === b.length && a.every((x, i) => x === b[i])) return null;
  if (isSubsequence(a, b)) return { kind: "added", detail: `${b.length - a.length} new row${b.length - a.length === 1 ? "" : "s"}` };
  if (isSubsequence(b, a)) return { kind: "removed", detail: `${a.length - b.length} row${a.length - b.length === 1 ? "" : "s"} gone` };
  return { kind: "changed", detail: before.shape === "array" ? "rows changed or reordered" : undefined };
}

/** The entries of a JSON or a lines locator (a const's literal is literalParts' business). */
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
  return null;
}

/**
 * The fingerprint lock over the listed literals: every changed, removed and added entry, the first two acknowledged when a
 * `Fingerprint-Change:` trailer names their mode. `files` maps a path to its two versions.
 *
 * --- ai-guard --- A const's literal is judged with the code around it: a statement outside the initializer that mentions the
 * const (a write after it, `Object.assign(BASELINE, …)`, a cast and a push, an earlier decoy declaration, an alias, a changed
 * comparison) added, changed or removed is a change of the literal, keyed by the locator's mode (by the const's name for a
 * record: the trailer `Fingerprint-Change: BASELINE - <reason>`). A value locator (a pinned table) compares row by row:
 * an added row passes, a changed or removed one fails.
 */
export function fingerprintChanges(locators: readonly FingerprintLocator[], files: ReadonlyMap<string, FileVersions>, trailers: ReadonlyMap<string, string[]>): FingerprintChange[] {
  const out: FingerprintChange[] = [];
  for (const locator of locators) {
    const versions = files.get(locator.file);
    if (!versions) continue;
    const where = locator.kind === "lines" ? `lines /${locator.pattern}/` : locator.kind === "json" ? "the file" : (locator.const ?? "?");
    const modeOf = (key: string) => (locator.kind === "record" || locator.kind === "json" ? key : (locator.mode ?? key));
    const push = (key: string, kind: FingerprintChange["kind"], detail?: string, at = where) => {
      const mode = modeOf(key);
      const reasons = trailers.get(mode) ?? [];
      out.push({ file: locator.file, mode, kind, where: at, acknowledged: kind === "added" || reasons.length > 0, reasons, ...(detail ? { detail } : {}) });
    };
    if (locator.kind === "value" || locator.kind === "record") {
      const name = locator.const ?? "";
      const valueOf = (src: string | null) => {
        const v = src === null ? null : extractConst(src, name);
        return v === null ? null : literalParts(v);
      };
      const before = valueOf(versions.base);
      const after = valueOf(versions.head);
      if (locator.kind === "value") {
        const change = valueChange(before, after);
        if (change) push(locator.mode ?? name, change.kind, change.detail);
      } else {
        const a = before?.keys ?? new Map<string, string>();
        const b = after?.keys ?? new Map<string, string>();
        for (const [key, value] of a) {
          if (!b.has(key)) push(key, "removed");
          else if (b.get(key) !== value) push(key, "changed");
        }
        for (const key of b.keys()) if (!a.has(key)) push(key, "added");
        // the literal's shape or what follows it (`{ … } && {}`): every entry may have changed
        if (before && after && (before.shape !== after.shape || before.tail !== after.tail)) push(name, "changed", "the code after the literal changed", `${name} (as a whole)`);
      }
      // the code outside the literal that mentions it
      const uses = usesDiff(versions.base === null ? [] : constUses(versions.base, name), versions.head === null ? [] : constUses(versions.head, name));
      if ((before || after) && (uses.added.length || uses.gone.length)) {
        const shown = [...uses.added.map((s) => `+ ${clip(s)}`), ...uses.gone.map((s) => `- ${clip(s)}`)].slice(0, 3).join(" | ");
        push(locator.kind === "record" ? name : (locator.mode ?? name), "changed", `code outside the literal that mentions ${name}: ${shown}`, `${name} (outside the literal)`);
      }
      continue;
    }
    const before = lockedEntries(locator, versions.base);
    const after = lockedEntries(locator, versions.head);
    if (before === null && after === null) continue;
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
        // --- ai-guard --- and the code outside the literal that mentions it (a push after it, an alias, a decoy declaration)
        const uses = usesDiff(v.base === null ? [] : constUses(v.base, region.const), v.head === null ? [] : constUses(v.head, region.const));
        const around = (a !== null || b !== null) && (uses.added.length > 0 || uses.gone.length > 0);
        if (!same) out.push({ path: file, rule: region.const, why: region.why });
        else if (around) out.push({ path: file, rule: region.const, why: `${region.why} (an edit of the code outside the literal that mentions ${region.const})` });
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
    | "expect-changed"
    | "skip-runtime"
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

/** Takes each of `items` out of the multiset `pool` where it has it; the items it did not find. */
function takeEach(pool: Map<string, number>, items: readonly string[]): string[] {
  const missing: string[] = [];
  for (const x of items) {
    const c = pool.get(x) ?? 0;
    if (c > 0) pool.set(x, c - 1);
    else missing.push(x);
  }
  return missing;
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

/** A string token's or a plain template token's text (`"skip"`, `'skip'`, `` `skip` `` → skip), null for anything else. */
const literalText = (t: Token | undefined) => (t && (t.type === "string" || (t.type === "template" && !t.text.includes("${"))) ? t.text.slice(1, -1) : null);

/**
 * --- ai-guard --- The name at the root of the expression that ends at token j, through `.x`, `?.x`, `["x"]`, a non-null `!`
 * and a cast in brackets: `it.concurrent["skip"]`, `(test as T).only` and `check.skip` lead to `it`, `test` and `check`.
 * Null for a call's result (`it.skipIf(c)`) or anything else.
 */
function chainRoot(t: readonly Token[], j: number): string | null {
  for (let guard = 0; j >= 0 && guard < 64; guard++) {
    const tok = t[j];
    if (tok.type === "ident") {
      const before = t[j - 1]?.text;
      if (before === "." || before === "?.") {
        j -= 2;
        continue;
      }
      return tok.text;
    }
    if (tok.text === "!") {
      j--;
      continue;
    }
    if (tok.text === "]") {
      const open = openingIndex(t, j);
      if (open !== j - 2 || literalText(t[j - 1]) === null) return null;
      j = open - 1;
      continue;
    }
    if (tok.text === ")") {
      const open = openingIndex(t, j);
      const before = t[open - 1];
      // a call's result, not a bracketed expression
      if (open < 0 || (before && ((before.type === "ident" && !KEYWORDS_BEFORE_REGEX.has(before.text)) || before.text === ")" || before.text === "]"))) return null;
      let end = j - 1;
      for (let m = open + 1; m < j; m++) {
        if (t[m].type === "punct" && OPEN[t[m].text]) {
          m = closingIndex(t, m);
          continue;
        }
        if (t[m].type === "ident" && (t[m].text === "as" || t[m].text === "satisfies")) {
          end = m - 1;
          break;
        }
      }
      j = end;
      continue;
    }
    return null;
  }
  return null;
}

/** The modifier a member access at token k names (`.skip`, `?.only`, `["skip"]`) and where its receiver ends; null when it names none. */
function modifierAt(t: readonly Token[], k: number): { name: keyof ModifierCounts; receiverEnd: number } | null {
  const tok = t[k];
  if (tok.type === "ident" && MODIFIERS.has(tok.text) && (t[k - 1]?.text === "." || t[k - 1]?.text === "?.")) return { name: tok.text as keyof ModifierCounts, receiverEnd: k - 2 };
  const text = literalText(tok);
  if (text !== null && MODIFIERS.has(text) && t[k - 1]?.text === "[" && t[k + 1]?.text === "]") return { name: text as keyof ModifierCounts, receiverEnd: k - 2 };
  return null;
}

/**
 * The test calls of a source and its aliases of modifiers: vitest's own calls, the ones `test.extend(…)` makes (`const
 * myTest = test.extend({ … })`), any name a test call is assigned to (`const check = it`, `const t = (it as any)`,
 * `const c = it.concurrent`, `const { each } = it`), and the names a modifier is assigned to (`const s = it.skip`,
 * `const { skip } = it`, `const o = test["only"]`).
 */
function testAliases(t: readonly Token[]): { calls: Set<string>; mods: Map<string, keyof ModifierCounts> } {
  const calls = new Set(FOCUSABLE_CALLS);
  const mods = new Map<string, keyof ModifierCounts>();
  for (let pass = 0; pass < 3; pass++) {
    // (more than once: an alias of an alias)
    for (let k = 0; k + 3 < t.length; k++) {
      if (!["const", "let", "var"].includes(t[k].text) || t[k].type !== "ident") continue;
      if (t[k + 1].type === "ident" && t[k + 2].text === "=") {
        const name = t[k + 1].text;
        if (calls.has(t[k + 3].text) && t[k + 4]?.text === "." && t[k + 5]?.text === "extend") {
          calls.add(name);
          continue;
        }
        // the value up to its end, before a top-level `as` / `satisfies`
        const end = valueEnd(t, k + 3);
        let last = end - 1;
        for (let m = k + 3; m < end; m++) {
          if (t[m].type === "punct" && OPEN[t[m].text]) {
            m = closingIndex(t, m);
            continue;
          }
          if (t[m].type === "ident" && (t[m].text === "as" || t[m].text === "satisfies")) {
            last = m - 1;
            break;
          }
        }
        if (last < k + 3) continue;
        const mod = modifierAt(t, last);
        if (mod) {
          const root = chainRoot(t, mod.receiverEnd);
          if (root !== null && calls.has(root)) mods.set(name, mod.name);
          continue;
        }
        const root = chainRoot(t, last);
        if (root !== null && calls.has(root)) calls.add(name);
      } else if (t[k + 1].text === "{") {
        // a destructuring of a test call: `const { skip, only: o, concurrent } = it`
        const close = closingIndex(t, k + 1);
        if (t[close + 1]?.text !== "=") continue;
        const end = valueEnd(t, close + 2);
        const root = chainRoot(t, end - 1);
        if (root === null || !calls.has(root)) continue;
        for (let m = k + 2; m < close; m++) {
          if (t[m].type !== "ident" || (t[m - 1].text !== "{" && t[m - 1].text !== ",")) continue;
          const local = t[m + 1]?.text === ":" && t[m + 2]?.type === "ident" ? t[m + 2].text : t[m].text;
          if (MODIFIERS.has(t[m].text)) mods.set(local, t[m].text as keyof ModifierCounts);
          else calls.add(local);
        }
      }
    }
  }
  return { calls, mods };
}

/** The test calls of a source (testAliases' `calls`). */
const testCallNames = (t: readonly Token[]): Set<string> => testAliases(t).calls;

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
  const { calls, mods } = testAliases(t);
  const ctx = testContexts(t, calls);
  const out: ModifierCounts = { ...NO_MODIFIERS };
  for (let k = 1; k < t.length; k++) {
    const tok = t[k];
    // --- ai-guard --- `it.skip`, `it?.skip`, `it["skip"]`, `(it as any).skip`, an alias's `check.skip`
    const mod = modifierAt(t, k);
    if (mod) {
      const root = chainRoot(t, mod.receiverEnd);
      if (root !== null && calls.has(root)) out[mod.name]++;
      else if (mod.name === "skip" && t[mod.receiverEnd]?.type === "ident" && ctx.receivers.has(t[mod.receiverEnd].text) && t[mod.receiverEnd - 1]?.text !== "." && t[mod.receiverEnd - 1]?.text !== "?.") out.skip++;
      continue;
    }
    if (tok.type !== "ident" || t[k - 1].text === "." || t[k - 1].text === "?." || t[k - 1].text === "function") continue;
    // a skip through a test's destructured context, or a modifier's alias called (`const s = it.skip; s("x", …)`)
    if (ctx.bare.has(tok.text) && t[k + 1]?.text === "(") out.skip++;
    else if (mods.has(tok.text) && (t[k + 1]?.text === "(" || t[k + 1]?.text === ".")) out[mods.get(tok.text)!]++;
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
    const removed = bagMinus(before, after);
    // (nothing the file had is gone: no expect dropped or rewritten)
    if (v.head !== null && !removed.length) continue;
    // a deleted helper with no assertion and no test of its own (merged into another helper): nothing weakened
    if (v.head === null && !before.length && !testCallCount(v.base)) continue;
    const trial = new Map(pool);
    // every statement the file lost that the change added to a file that still runs: moved, not lost
    const unmatched = takeEach(trial, removed);
    const matched = removed.length - unmatched.length;
    const kept = matched >= deficit;
    // --- ai-guard --- of the rest, those the count does not miss were rewritten in place (`expect(f(x)).toBe(1)` →
    // `expect(1).toBe(1)`): the file lost them and gained others (a deleted file gains none)
    const rewritten = unmatched.length - Math.max(0, deficit - matched);
    if (kept && !rewritten) pool = trial;
    if (rewritten > 0) {
      const gone = unmatched.slice(0, 2).map((s) => clip(s, 100));
      add("expect-changed", file, `${rewritten} expect statement${rewritten === 1 ? "" : "s"} rewritten in place (the count holds, the assertion does not; added to no other test file of the change that still runs): ${gone.join(" | ")}${unmatched.length > 2 ? " …" : ""}`);
    }
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
    const a = listItems(extractConst(v.base, list.const) ?? []);
    const b = listItems(extractConst(v.head, list.const) ?? []);
    const added = b.filter((e) => !a.includes(e));
    if (added.length) add("allow-list-widened", list.file, `${list.const}: ${added.length} new entr${added.length === 1 ? "y" : "ies"} – ${added.map((e) => e.slice(0, 120)).join(" | ")}`);
    // --- ai-guard --- the code outside the literal that mentions the list: a push after it, a decoy declaration, an alias, a
    // changed check that reads it (one only removed narrows nothing)
    const uses = usesDiff(constUses(v.base, list.const), constUses(v.head, list.const));
    if (uses.added.length) add("allow-list-widened", list.file, `${list.const}: code outside the literal that mentions it changed – ${uses.added.slice(0, 3).map((s) => clip(s)).join(" | ")}`);
  }
  return out;
}

/** An allow list's entries: an array's elements, or an object's `key: value` entries (`SIZES_NOTHING`). */
function listItems(tokens: readonly Token[]): string[] {
  if (tokens[0]?.text === "{") return [...objectEntries(tokens)].map(([k, v]) => `${k}: ${v}`);
  return arrayElements(tokens);
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

/** A test file's counts in one run of vitest (its JSON report): every test, and those skipped or left to do. */
export interface RuntimeCounts {
  tests: number;
  skipped: number;
  todo: number;
}

/**
 * --- ai-guard --- The skips the tests' run shows that the source does not: for each changed test file the run executed,
 *  - against the baseline's counts of the same file (`base`: a baseline recorded on the base commit, in the guard's
 *    environment), more tests skipped or left to do than there;
 *  - without them, tests skipped or left to do while the file's source has no modifier the static detector reads (`.skip`,
 *    `.skipIf`, `.runIf`, `.todo`, a context's skip): a skip it cannot see (a computed member, an alias it does not follow).
 * Each is a `skip-runtime` finding, acknowledged by a `Test-Change:` trailer that names the file.
 */
export function runtimeSkipFindings(input: { changed: readonly string[]; tests: readonly string[]; now: ReadonlyMap<string, RuntimeCounts>; base: ReadonlyMap<string, RuntimeCounts> | null; heads: ReadonlyMap<string, string | null>; trailers: ReadonlyMap<string, string[]> }): WeakeningFinding[] {
  const out: WeakeningFinding[] = [];
  for (const file of input.changed) {
    const now = input.now.get(file);
    if (!now || !matchesAny(file, input.tests)) continue;
    const idle = now.skipped + now.todo;
    const was = input.base?.get(file);
    let detail: string | null = null;
    if (was) {
      const before = was.skipped + was.todo;
      if (idle > before) detail = `skipped or todo tests at run time ${before} → ${idle} of ${now.tests} (against the baseline of the base commit)`;
    } else if (idle > 0) {
      const head = input.heads.get(file) ?? null;
      const m = head === null ? NO_MODIFIERS : modifierCounts(head);
      if (m.skip + m.skipIf + m.runIf + m.todo === 0) detail = `${idle} of ${now.tests} tests skipped or todo at run time, and the source has no skip the detector reads (no baseline of the base commit to compare with)`;
    }
    if (detail === null) continue;
    const reasons = testAck(file, input.trailers);
    out.push({ kind: "skip-runtime", file, detail, acknowledged: reasons.length > 0, reasons });
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
