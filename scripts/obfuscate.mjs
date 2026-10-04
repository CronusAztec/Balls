/**
 * --- code-obfuscation ---
 * Build-time obfuscation of the static export (owner direction: "obfuscate code so it can't be taken and used").
 *
 * Run from scripts/postexport.mjs AFTER `next build` but BEFORE the service worker is built: the PWA build hashes
 * every exported file's contents to version the worker and precaches the /_next/static chunks (hashExport /
 * selectPrecache in scripts/pwa/build.mjs), so the chunks must be in their final, obfuscated form first – otherwise
 * the offline cache would hold the obfuscated bytes under a version computed from the readable ones.
 *
 * It obfuscates every `*.js` under out/_next/static/chunks EXCEPT the loader chunks Next's runtime bootstraps from
 * (webpack-*, framework-*, main-*, main-app-*, polyfills-* — obfuscating those breaks the bootstrap), never out/sw.js
 * (which does not exist yet at this point and lives outside chunks/ anyway), prepends a one-line proprietary banner to
 * every obfuscated chunk, and deletes any stray .map file from out/ (productionBrowserSourceMaps is off, so there
 * should be none).
 *
 * The settings are SPEED FIRST: the physics runs a fixed 60 Hz loop and the seed finder re-runs the engine for
 * thousands of seeds, and the smoke test enforces frame-rate floors and finder timeouts that must not move, so the heavy
 * transforms (control-flow flattening, dead-code injection, self-defending) stay off. The spec's string array was also
 * turned OFF after measurement: its wrapper (a call per string access) de-optimised the engine's tight step loop and
 * made the finder ~28x slower (4.7 vs 133 seeds/s) – a timing check that failed only under obfuscation – and turning the
 * array's rotate/shuffle off did not help, while the hot code sits in the simulator page chunk (so excluding it would
 * un-obfuscate the chunk the smoke must find obfuscated). Hexadecimal identifier renaming stays on for every chunk, so
 * the logic (every local, function and class name, including the engine's) is still unreadable, at native speed; see
 * obfuscatorOptions. `seed` is a stable hash of the file name, so a given source builds to the same obfuscated output
 * every time (reproducible builds, stable PWA version).
 *
 * OBFUSCATE=0 skips the whole step (debug builds); the default for `npm run build` is ON. This file is not linted
 * (scripts/** is ignored by ESLint) and is covered by tests/obfuscate.test.ts.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import JavaScriptObfuscator from "javascript-obfuscator";

/** Prepended to every obfuscated chunk (owner direction, verbatim). */
export const BANNER =
  "/*! JumpingBallsLive - proprietary software. Copying, modification, reverse engineering and reuse are prohibited. */";

/**
 * Loader chunks Next's runtime depends on, by file-name prefix: these set up webpack, the framework runtime and the
 * entry, and obfuscating them breaks the page bootstrap, so they ship un-obfuscated. ("main-app-" is already covered by
 * "main-", but it is listed to document the intent and survive a future prefix change.)
 */
export const EXCLUDED_CHUNK_PREFIXES = ["webpack-", "framework-", "main-", "main-app-", "polyfills-"];

/** True when a chunk's base name is one of the loader chunks that must never be obfuscated. */
export function isExcludedChunk(basename) {
  return EXCLUDED_CHUNK_PREFIXES.some((prefix) => basename.startsWith(prefix));
}

/** Every file under `dir` (recursively) as posix paths relative to it, matching `test` if given. */
export function walk(dir, test) {
  const out = [];
  const recur = (sub) => {
    const abs = path.join(dir, sub);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) recur(rel);
      else if (entry.isFile() && (!test || test(rel))) out.push(rel);
    }
  };
  recur("");
  return out.sort();
}

/**
 * The chunk files of an export, split into the ones to obfuscate and the loader chunks to skip. Paths are posix and
 * relative to out/_next/static/chunks. Returns { chunksDir, obfuscate, skip }.
 */
export function selectChunks(outDir) {
  const chunksDir = path.join(outDir, "_next", "static", "chunks");
  const obfuscate = [];
  const skip = [];
  for (const rel of walk(chunksDir, (f) => f.endsWith(".js"))) {
    if (isExcludedChunk(path.basename(rel))) skip.push(rel);
    else obfuscate.push(rel);
  }
  return { chunksDir, obfuscate, skip };
}

/** A stable unsigned 31-bit seed from a file name, so each file obfuscates reproducibly across builds. */
export function seedForName(name) {
  return parseInt(crypto.createHash("sha256").update(name).digest("hex").slice(0, 8), 16) % 0x7fffffff;
}

/**
 * The obfuscator options for one chunk. Speed-first and functional-safe: renameGlobals / renameProperties stay off
 * (property renaming breaks React and Next), the expensive transforms stay off, and the string array is off (its
 * wrapper de-optimised the physics hot loop – see the block comment inside). `seed` makes the output reproducible for a
 * given file name. `overrides` lets the caller relax or restore a setting (used by the tests).
 */
export function obfuscatorOptions(seed, overrides = {}) {
  return {
    compact: true,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    renameProperties: false,
    // --- speed vs the physics hot loop ---
    // The spec asked for stringArray true (base64, rotate, shuffle). Measured against the smoke's seed finder, which
    // re-runs the engine for thousands of seeds, that was ~28x slower than the un-obfuscated build (4.7 vs 133 seeds/s)
    // and the finder's 120 s checks timed out – a check that fails only under obfuscation. The string-array WRAPPER
    // (a function call per string access) de-optimises the engine's tight step loop; turning rotate/shuffle off did not
    // help (same 4.7 seeds/s), and the hot code lives in the simulator page chunk, so excluding "the physics chunk"
    // would un-obfuscate the very chunk the smoke must find obfuscated. So the string array is OFF: every chunk still
    // gets hexadecimal identifier renaming (PhysicsEngine / bounceMath / FinderRequest and all locals become _0x… – the
    // logic stays unreadable) and compacting, at native speed. The heavier transforms stay off for the same reason, and
    // debugProtection is off on purpose (hostile to real users). `seed` is a stable hash of the file name, so a build is
    // reproducible. See README "### Obfuscation and the licence".
    stringArray: false,
    splitStrings: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
    disableConsoleOutput: false,
    unicodeEscapeSequence: false,
    sourceMap: false,
    target: "browser",
    seed,
    ...overrides,
  };
}

/** Delete every `*.map` under `dir`. Returns the posix paths (relative to `dir`) that were removed. */
export function deleteSourceMaps(dir) {
  const maps = walk(dir, (f) => f.endsWith(".map"));
  for (const rel of maps) fs.rmSync(path.join(dir, rel), { force: true });
  return maps;
}

/**
 * Obfuscate one chunk's source and prepend the banner. Returns the new code. Already-banner'd input is returned as-is
 * (idempotent, so a second postexport pass does not double-obfuscate).
 */
export function obfuscateChunk(source, { name = "chunk.js", overrides = {} } = {}) {
  if (source.startsWith(BANNER)) return source;
  const code = JavaScriptObfuscator.obfuscate(source, obfuscatorOptions(seedForName(name), overrides)).getObfuscatedCode();
  return `${BANNER}\n${code}`;
}

/**
 * Obfuscate the export in place. Walks out/_next/static/chunks, obfuscates every chunk but the loader ones, deletes any
 * .map under out/, and returns a report: { count, skipped, mapsDeleted, bytesBefore, bytesAfter, ms }. `overrides` is
 * passed to every chunk; `onFile(rel)` is called for each obfuscated chunk (progress).
 */
export function obfuscateExport(outDir, { overrides = {}, onFile } = {}) {
  const start = Date.now();
  const { chunksDir, obfuscate, skip } = selectChunks(outDir);
  let bytesBefore = 0;
  let bytesAfter = 0;
  let count = 0;
  for (const rel of obfuscate) {
    const file = path.join(chunksDir, rel);
    const source = fs.readFileSync(file, "utf8");
    bytesBefore += Buffer.byteLength(source);
    const next = obfuscateChunk(source, { name: path.basename(rel), overrides });
    if (next !== source) {
      fs.writeFileSync(file, next);
      count += 1;
      if (onFile) onFile(rel);
    }
    bytesAfter += Buffer.byteLength(next);
  }
  const mapsDeleted = deleteSourceMaps(outDir);
  return { count, skipped: skip, mapsDeleted, bytesBefore, bytesAfter, ms: Date.now() - start };
}

// Run directly (`node scripts/obfuscate.mjs [outDir]`) to obfuscate an existing export, e.g. for debugging the step.
if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = path.resolve(process.argv[2] || "out");
  if (!fs.existsSync(outDir)) {
    console.error(`obfuscate: ${outDir} not found – run \`next build\` first.`);
    process.exit(1);
  }
  const r = obfuscateExport(outDir);
  console.log(
    `obfuscate: ${r.count} chunk(s) in ${(r.ms / 1000).toFixed(1)}s ` +
      `(skipped ${r.skipped.length} loader chunk(s), removed ${r.mapsDeleted.length} .map file(s), ` +
      `${(r.bytesBefore / 1048576).toFixed(2)} → ${(r.bytesAfter / 1048576).toFixed(2)} MB)`,
  );
}
