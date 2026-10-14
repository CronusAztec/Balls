/**
 * --- static-headers --- The `_headers` file of the static export (public/_headers, read by Cloudflare Workers static assets).
 *
 * Wrangler turns the file into a table keyed by path, so when two blocks name the same path (`/*` twice) only the LAST one is
 * deployed – the first block's headers are silently lost (found by serving the export with the pinned Wrangler 3.114: the security
 * headers vanished as soon as scripts/postexport.mjs appended its own `/*` block with the X-Build header). This module keeps the
 * file correct whoever adds a block:
 *  - restoreStaticHeaders: starts every postexport run from the committed public/_headers (a second run over the same out/ then
 *    finds no merged leftovers of the first);
 *  - mergeDuplicateRules: folds the blocks of one path into the last one, in order, dropping repeated identical lines;
 *  - duplicatePaths: the paths that appear more than once (the tests use it on the source file and on a built out/_headers).
 * Plain strings in, plain strings out; the same parser rules as Wrangler (a trimmed line that starts with "/" or "scheme://" is a
 * path, "#" starts a comment, every other line belongs to the path above it).
 */
import fs from "fs";
import path from "path";

const PATH_LINE = /^([^\s]+:\/\/|\/)/;

/**
 * The rules of a `_headers` text: each path with the line numbers of its own header lines (comments and blanks belong to none).
 * @param {string} text
 * @returns {{ lines: string[], rules: { path: string, pathAt: number, headerAts: number[] }[] }}
 */
export function parseRules(text) {
  const lines = String(text).split("\n");
  /** @type {{ path: string, pathAt: number, headerAts: number[] }[]} */
  const rules = [];
  /** @type {{ path: string, pathAt: number, headerAts: number[] } | null} */
  let current = null;
  lines.forEach((raw, at) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (PATH_LINE.test(line)) {
      current = { path: line, pathAt: at, headerAts: [] };
      rules.push(current);
    } else if (current) {
      current.headerAts.push(at);
    }
  });
  return { lines, rules };
}

/** The paths that more than one block names, in the order of their first appearance. */
export function duplicatePaths(text) {
  const seen = new Set();
  const repeated = new Set();
  for (const rule of parseRules(text).rules) (seen.has(rule.path) ? repeated : seen).add(rule.path);
  return [...repeated];
}

/**
 * The same text with one block per path: the headers of earlier blocks of a path move into its last block (right under the path
 * line, before that block's own headers), and a line that is already there word for word is not repeated. Comments stay where they are.
 */
export function mergeDuplicateRules(text) {
  const { lines, rules } = parseRules(text);
  const last = new Map(rules.map((rule) => [rule.path, rule]));
  const dropped = new Set();
  const moved = new Map();
  for (const rule of rules) {
    const survivor = last.get(rule.path);
    if (survivor === rule) continue;
    dropped.add(rule.pathAt);
    for (const at of rule.headerAts) dropped.add(at);
    const list = moved.get(survivor.pathAt) ?? [];
    for (const at of rule.headerAts) list.push(lines[at]);
    moved.set(survivor.pathAt, list);
  }
  if (!dropped.size) return String(text);
  const result = [];
  lines.forEach((raw, at) => {
    if (dropped.has(at)) return;
    result.push(raw);
    const survivor = rules.find((rule) => rule.pathAt === at);
    if (survivor && moved.has(at)) {
      const own = new Set(survivor.headerAts.map((i) => lines[i].trim()));
      const seen = new Set();
      for (const line of moved.get(at)) {
        const key = line.trim();
        if (own.has(key) || seen.has(key)) continue;
        seen.add(key);
        result.push(line);
      }
    }
  });
  return result.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

/** Writes out/_headers from the committed public/_headers (when there is one). Returns whether it did. */
export function restoreStaticHeaders(outDir, root = process.cwd()) {
  const source = path.join(root, "public", "_headers");
  if (!fs.existsSync(source)) return false;
  fs.writeFileSync(path.join(outDir, "_headers"), fs.readFileSync(source));
  return true;
}

/** Folds the repeated paths of out/_headers into one block each. Returns the paths it merged (none: the file is left alone). */
export function mergeHeaderFile(outDir) {
  const file = path.join(outDir, "_headers");
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const repeated = duplicatePaths(text);
  if (repeated.length) fs.writeFileSync(file, mergeDuplicateRules(text));
  return repeated;
}
