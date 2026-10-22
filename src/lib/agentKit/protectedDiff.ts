import { globToRegExp, matchesAny } from "./guardPlan";

/*
 * --- ai-guard --- The core guard's static checks of a change (base ref → working tree), pure over file texts so
 * tests/protectedDiff.test.ts can feed them fixture diffs:
 *  - the fingerprint lock: the BASELINE literal of tests/extras.test.ts (one entry per mode) and the per-mode fingerprint
 *    literals scripts/agent/protected.json lists. An added entry passes; a changed or removed one fails unless a commit in the
 *    range carries `Fingerprint-Change: <mode> - <reason>`;
 *  - the protected-path report: files and regions (a const, a message namespace) that need the owner's review. Reported,
 *    never a failure (owner decision for P0);
 *  - the test-weakening detector: a net drop in expect( calls, added .skip / .only / skipIf / todo, raised timeouts, deleted
 *    test files, deleted smoke check( calls and new entries in the allow lists (the uncap ALLOWED list). A finding fails unless
 *    a commit carries `Test-Change: <file> - <reason>` for it; an added .only always fails.
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
    smokeFile: string;
    /** Allow lists whose new entries widen a guard (the uncap ALLOWED list). */
    allowLists: { file: string; const: string; why: string }[];
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
  kind: "expect-drop" | "only-added" | "skip-added" | "skipIf-added" | "todo-added" | "timeout-raised" | "test-deleted" | "check-drop" | "allow-list-widened";
  file: string;
  detail: string;
  /** A `Test-Change:` trailer names the file (never for an added .only). */
  acknowledged: boolean;
  reasons: string[];
}

/** expect(…), expect.soft(…), expect.poll(…) and expectTypeOf(…) calls: the test's assertions. */
export function countExpects(src: string): number {
  const t = tokenize(src);
  let n = 0;
  for (let k = 0; k < t.length; k++) {
    if (t[k].type !== "ident" || (t[k].text !== "expect" && t[k].text !== "expectTypeOf") || t[k - 1]?.text === ".") continue;
    if (t[k + 1]?.text === "(") n++;
    else if (t[k + 1]?.text === "." && t[k + 2]?.type === "ident" && t[k + 3]?.text === "(" && ["soft", "poll"].includes(t[k + 2].text)) n++;
  }
  return n;
}

/** The smoke suite's check(…) and timingCheck(…) calls (not their definitions). */
export function countChecks(src: string): number {
  const t = tokenize(src);
  let n = 0;
  for (let k = 0; k < t.length; k++) {
    if (t[k].type !== "ident" || (t[k].text !== "check" && t[k].text !== "timingCheck") || t[k + 1]?.text !== "(") continue;
    const prev = t[k - 1]?.text;
    if (prev === "." || prev === "function") continue;
    n++;
  }
  return n;
}

/** How often each skipping or narrowing modifier occurs: `.only`, `.skip` (ctx.skip() too), `.skipIf`, `.todo`. */
export function modifierCounts(src: string): Record<"only" | "skip" | "skipIf" | "todo", number> {
  const t = tokenize(src);
  const out = { only: 0, skip: 0, skipIf: 0, todo: 0 };
  for (let k = 1; k < t.length; k++) {
    if (t[k - 1].text !== "." || t[k].type !== "ident") continue;
    const name = t[k].text as keyof typeof out;
    if (name in out) out[name]++;
  }
  return out;
}

const TEST_CALLS = new Set(["it", "test", "describe", "suite", "bench", "beforeAll", "afterAll", "beforeEach", "afterEach"]);
const VITEST_DEFAULT_TIMEOUT_MS = 5000;

/**
 * Every test call with its own timeout (null: vitest's default): `it("title", { timeout: N }, …)`, `it("title", …, N)` and
 * the hooks' trailing number. Keyed by the call and its title (`it "boots every mode"`, `beforeAll #`), with the occurrence
 * index for a repeated key (`it "x" (2)`).
 */
export function testTimeouts(src: string): Map<string, number | null> {
  const t = tokenize(src);
  const out = new Map<string, number | null>();
  const seen = new Map<string, number>();
  for (let k = 0; k < t.length; k++) {
    if (t[k].type !== "ident" || !TEST_CALLS.has(t[k].text) || t[k - 1]?.text === "." || t[k - 1]?.text === "function") continue;
    let open = k + 1;
    while (t[open]?.text === "." && t[open + 1]?.type === "ident") {
      open += 2;
      if (t[open]?.text === "(" && t[closingIndex(t, open) + 1]?.text === "(") open = closingIndex(t, open) + 1; // .skipIf(cond)(…), .each(table)(…)
    }
    if (t[open]?.text !== "(") continue;
    const close = closingIndex(t, open);
    const first = t[open + 1];
    const title = first && (first.type === "string" || first.type === "template") ? JSON.stringify(first.text.slice(1, -1)) : "#";
    const base = `${t[k].text} ${title}`;
    const nth = (seen.get(base) ?? 0) + 1;
    seen.set(base, nth);
    const key = nth > 1 ? `${base} (${nth})` : base;
    let timeout: number | null = null;
    // an options object among the call's own arguments ({ timeout: N } right after `(` or a `,`)
    for (let m = open + 1; m < close; m++) {
      const tok = t[m];
      if (tok.type !== "punct" || !OPEN[tok.text]) continue;
      const end = closingIndex(t, m);
      if (tok.text === "{" && (t[m - 1].text === "(" || t[m - 1].text === ",")) {
        for (let q = m + 1; q < end; q++) {
          if (t[q].type === "punct" && OPEN[t[q].text]) {
            q = closingIndex(t, q);
            continue;
          }
          if (t[q].type === "ident" && t[q].text === "timeout" && t[q + 1]?.text === ":" && !Number.isNaN(numberValue(t[q + 2]))) timeout = numberValue(t[q + 2]);
        }
      }
      m = end;
    }
    // a trailing number argument: `…, N)`
    if (timeout === null && t[close - 2]?.text === "," && !Number.isNaN(numberValue(t[close - 1]))) timeout = numberValue(t[close - 1]);
    out.set(key, timeout);
  }
  return out;
}

/** Whether a `Test-Change:` trailer names the file (a path or a glob). */
function testAck(file: string, trailers: ReadonlyMap<string, string[]>): string[] {
  const reasons: string[] = [];
  for (const [key, list] of trailers) if (key === file || globToRegExp(key).test(file)) reasons.push(...list);
  return reasons;
}

/**
 * The weakening findings of a change: `files` holds both versions of every changed path, `changed` the paths.
 */
export function weakeningFindings(config: ProtectedConfig["weakening"], changed: readonly string[], files: ReadonlyMap<string, FileVersions>, trailers: ReadonlyMap<string, string[]>): WeakeningFinding[] {
  const out: WeakeningFinding[] = [];
  const add = (kind: WeakeningFinding["kind"], file: string, detail: string) => {
    const reasons = kind === "only-added" ? [] : testAck(file, trailers);
    out.push({ kind, file, detail, acknowledged: reasons.length > 0, reasons });
  };
  const testFiles = changed.filter((f) => matchesAny(f, config.tests)).sort();
  let net = 0;
  const drops: [string, number, number][] = [];
  for (const file of testFiles) {
    const v = files.get(file);
    if (!v) continue;
    const before = v.base === null ? 0 : countExpects(v.base);
    const after = v.head === null ? 0 : countExpects(v.head);
    net += after - before;
    if (after < before) drops.push([file, before, after]);
    if (v.base !== null && v.head === null) add("test-deleted", file, `deleted (${before} expect calls)`);
    if (v.base === null || v.head === null) continue;
    const a = modifierCounts(v.base);
    const b = modifierCounts(v.head);
    if (b.only > a.only) add("only-added", file, `.only ${a.only} → ${b.only}`);
    if (b.skip > a.skip) add("skip-added", file, `.skip ${a.skip} → ${b.skip}`);
    if (b.skipIf > a.skipIf) add("skipIf-added", file, `.skipIf ${a.skipIf} → ${b.skipIf}`);
    if (b.todo > a.todo) add("todo-added", file, `.todo ${a.todo} → ${b.todo}`);
    // a raised timeout: a test (or hook) that existed before now waits longer (a new test may bring its own)
    const ta = testTimeouts(v.base);
    for (const [key, ms] of testTimeouts(v.head)) {
      if (!ta.has(key) || ms === null) continue;
      const old = ta.get(key) ?? VITEST_DEFAULT_TIMEOUT_MS;
      if (ms > old) add("timeout-raised", file, `${key}: ${ta.get(key) ?? `${VITEST_DEFAULT_TIMEOUT_MS} (the default)`} → ${ms} ms`);
    }
  }
  if (net < 0) for (const [file, before, after] of drops) add("expect-drop", file, `expect calls ${before} → ${after} (net ${net} over the changed test files)`);
  const smoke = files.get(config.smokeFile);
  if (smoke && changed.includes(config.smokeFile)) {
    const before = smoke.base === null ? 0 : countChecks(smoke.base);
    const after = smoke.head === null ? 0 : countChecks(smoke.head);
    if (after < before) add("check-drop", config.smokeFile, `check( calls ${before} → ${after}`);
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

/** The paths whose two versions the static checks read: the changed ones they care about and every locked literal's file. */
export function filesToRead(config: ProtectedConfig, changed: readonly string[]): string[] {
  const wanted = new Set<string>();
  for (const f of changed) {
    if (matchesAny(f, config.weakening.tests) || f === config.weakening.smokeFile) wanted.add(f);
    if (config.regions.some((r) => globToRegExp(r.file).test(f))) wanted.add(f);
    if (config.weakening.allowLists.some((l) => l.file === f)) wanted.add(f);
  }
  for (const l of config.fingerprints) if (changed.includes(l.file)) wanted.add(l.file);
  return [...wanted].sort();
}
