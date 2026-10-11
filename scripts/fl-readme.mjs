#!/usr/bin/env node
/**
 * --- fl-overhaul --- (Stage 7) Writes the README's generated Fight League tables from the code (Node, esbuild – a vitest
 * dependency – bundles the TypeScript):
 *
 *   node scripts/fl-readme.mjs           rewrite the blocks between the markers in README.md
 *   node scripts/fl-readme.mjs --check   only compare (exit 1 and name the stale blocks)
 *
 * The blocks: `<!-- fl-roster -->` (rosterTableMarkdown() of src/lib/physics/modes/fightLeagueRoster.ts), `<!-- fl-kinds -->`,
 * `<!-- fl-primitives -->` and `<!-- fl-settings -->` (src/lib/physics/modes/fightLeagueDocs.ts); each runs to its
 * `<!-- /fl-… -->` marker. The balance table (`<!-- fl-balance -->`) is the tuner's: `node scripts/fl-balance.mjs --reuse --readme`.
 * tests/docsConsistency.test.ts fails when a block differs from the code, so re-run this after changing a row, a contract, a
 * limit or a setting.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const README = path.join(ROOT, "README.md");
const CHECK = process.argv.includes("--check");

const esbuild = await import("esbuild").catch(() => {
  console.error("esbuild is not installed – run `npm install` (it comes with the dev dependencies).");
  process.exit(1);
});
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fl-readme-")), "docs.mjs");
await esbuild.build({
  stdin: {
    contents: 'export { rosterTableMarkdown } from "./src/lib/physics/modes/fightLeagueRoster"; export * from "./src/lib/physics/modes/fightLeagueDocs";',
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile,
  alias: { "@": path.join(ROOT, "src") },
  logLevel: "error",
});
const docs = await import(pathToFileURL(outfile).href);

/** Replaces the text between `<!-- name -->` and `<!-- /name -->` (each on its own line) with `body`. */
function replaceBlock(text, name, body) {
  const open = `<!-- ${name} -->\n`;
  const close = `<!-- /${name} -->`;
  const a = text.indexOf(open);
  const b = a < 0 ? -1 : text.indexOf(close, a + open.length);
  if (a < 0 || b < 0) throw new Error(`README.md has no <!-- ${name} --> … <!-- /${name} --> block`);
  return `${text.slice(0, a + open.length)}${body}\n${text.slice(b)}`;
}

const BLOCKS = {
  "fl-roster": docs.rosterTableMarkdown(),
  "fl-kinds": docs.flKindsTableMarkdown(),
  "fl-primitives": docs.flPrimitivesTableMarkdown(),
  "fl-settings": docs.flSettingsTableMarkdown(),
};

const before = fs.readFileSync(README, "utf8");
let after = before;
const stale = [];
for (const [name, body] of Object.entries(BLOCKS)) {
  const next = replaceBlock(after, name, body);
  if (next !== after) stale.push(name);
  after = next;
}
if (CHECK) {
  if (stale.length) {
    console.error(`Stale README blocks: ${stale.join(", ")} – run node scripts/fl-readme.mjs`);
    process.exit(1);
  }
  console.log("The README's Fight League tables match the code.");
} else if (after !== before) {
  fs.writeFileSync(README, after);
  console.log(`Rewrote ${stale.join(", ")} in README.md.`);
} else console.log("The README's Fight League tables already match the code.");
