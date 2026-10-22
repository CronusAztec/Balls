/**
 * --- agent-cli --- Bundles the agent toolbox's pure TypeScript for Node with esbuild – a dev dependency already (vitest's),
 * with @ aliased to src, exactly as scripts/viral-bot.mjs bundles the bot – and imports it. Three bundles:
 *  - the tool core (src/lib/agentKit/toolCore.ts: the tool table and its argument checks, explain, the video analyser's
 *    pure halves; 4 source files): every call and the MCP server load it, so they work while an edit has broken the engine;
 *  - the toolbox (src/lib/agentKit/toolbox.ts: the core plus the engine, the finder, the settings and every mode): only the
 *    engine's tools load it (modes, simulate, fingerprint, preview, render);
 *  - --- blueprint --- the Blueprint kit (src/lib/agentKit/blueprintKit.ts: the Blueprint language, its interpreter and
 *    catalog, no engine): only the bp-* tools load it.
 * Each is cached in the agent cache (paths.mjs CACHE_DIR, a private folder) with esbuild's list of its inputs; it is rebuilt
 * only when an input's size or time changed, a file was added to src/lib/agentKit, src/lib/videoAnalysis or src/lib/blueprint, or esbuild is
 * another version – and whenever the list of inputs is empty or lacks the entry. The list is kept only when every input
 * was saved before the build began (a file saved while esbuild read it would be stamped new beside its old code): otherwise
 * the next call builds again. Nothing is written to the repository.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { ROOT, cacheDir } from "./paths.mjs";

const ENTRY = path.join(ROOT, "src", "lib", "agentKit", "toolbox.ts");
const CORE_ENTRY = path.join(ROOT, "src", "lib", "agentKit", "toolCore.ts");
// --- blueprint --- the Blueprint library and its catalog, for the five bp-* tools only
const BLUEPRINT_ENTRY = path.join(ROOT, "src", "lib", "agentKit", "blueprintKit.ts");
const WATCHED_DIRS = [path.join(ROOT, "src", "lib", "agentKit"), path.join(ROOT, "src", "lib", "videoAnalysis"), path.join(ROOT, "src", "lib", "blueprint"), path.join(ROOT, "src", "lib", "blueprint", "catalog")];

function stamp(file) {
  try {
    const s = fs.statSync(file);
    return `${s.size}:${Math.floor(s.mtimeMs)}`;
  } catch {
    return "missing";
  }
}

const listing = () => WATCHED_DIRS.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).sort().map((f) => path.join(d, f)) : []));

async function esbuildModule() {
  try {
    return await import("esbuild");
  } catch {
    throw new Error("esbuild is not installed – run `npm install` (it comes with the dev dependencies).");
  }
}

/**
 * True when the cached bundle was built from these very inputs: the same esbuild, entry and folder listing, and an inputs map
 * that holds the entry itself with every input's size and time unchanged (an empty map proves nothing: never fresh).
 */
export function fresh(meta, version, now = listing(), entry = ENTRY) {
  if (!meta || typeof meta !== "object" || meta.esbuild !== version || meta.entry !== entry) return false;
  if (JSON.stringify(meta.listing) !== JSON.stringify(now)) return false;
  const inputs = meta.inputs && typeof meta.inputs === "object" ? Object.entries(meta.inputs) : [];
  if (!inputs.length || !Object.hasOwn(meta.inputs, entry)) return false;
  return inputs.every(([file, s]) => stamp(file) === s);
}

/** How close to a build's start an input's time may be and still count as saved during it (coarse file-system clocks). */
export const SETTLE_MS = 2000;

/**
 * Whether every input was last written before the build started (with SETTLE_MS of slack): only then do the stamps the meta
 * records describe the code esbuild bundled. A missing input is no settled one.
 * @param {string[]} files
 * @param {number} started Date.now() before esbuild ran
 * @param {(file: string) => number | null} [mtimeOf]
 */
export function settled(files, started, mtimeOf = (f) => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return null;
  }
}) {
  return files.every((f) => {
    const t = mtimeOf(f);
    return t !== null && t < started - SETTLE_MS;
  });
}

export { ENTRY as TOOLBOX_ENTRY, CORE_ENTRY as TOOLCORE_ENTRY, BLUEPRINT_ENTRY as BLUEPRINTKIT_ENTRY, listing as toolboxListing };

/** Builds (or takes from the cache) the bundle of `entry` named `name`, and imports it. */
async function load(entry, name) {
  const esbuild = await esbuildModule();
  const dir = cacheDir("bundle");
  const outfile = path.join(dir, `${name}.mjs`);
  const metaFile = path.join(dir, `${name}.meta.json`);
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  } catch {
    meta = null;
  }
  if (!fs.existsSync(outfile) || !fresh(meta, esbuild.version, listing(), entry)) {
    const tmp = `${outfile}.${process.pid}.tmp.mjs`;
    // --- agent-cli --- what the build started from: the folder listing, and the time before esbuild read a file
    const before = listing();
    const started = Date.now();
    let result;
    try {
      result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        outfile: tmp,
        alias: { "@": path.join(ROOT, "src") },
        logLevel: "silent",
        metafile: true,
        absWorkingDir: ROOT,
      });
    } catch (e) {
      // one line per error (file:line:column: message), never esbuild's stack trace
      const errors = Array.isArray(e?.errors) ? e.errors.map((x) => `${x.location ? `${x.location.file}:${x.location.line}:${x.location.column}: ` : ""}${x.text}`) : [e instanceof Error ? e.message : String(e)];
      throw new Error(`the agent toolbox (${path.relative(ROOT, entry)}) did not build: ${errors.slice(0, 5).join("; ")}`);
    }
    const files = Object.keys(result.metafile.inputs).map((rel) => path.resolve(ROOT, rel));
    fs.renameSync(tmp, outfile); // atomic: a parallel call imports either the old bundle or the new one, never half of one
    // --- agent-cli --- an input saved while esbuild read it (its time at or after the build's start, give or take the
    // file system's clock) may be in the bundle in its old form with its new stamp: no meta then, so the next call rebuilds
    if (settled(files, started)) fs.writeFileSync(metaFile, JSON.stringify({ esbuild: esbuild.version, entry, listing: before, inputs: Object.fromEntries(files.map((f) => [f, stamp(f)])) }));
    else fs.rmSync(metaFile, { force: true });
  }
  return import(`${pathToFileURL(outfile).href}?v=${encodeURIComponent(stamp(outfile))}`);
}

let core = null;
let full = null;
let blueprint = null;

/** The tool core (tool table, argument checks, explain, video analysis): every call loads it. */
export async function loadToolCore() {
  core ??= await load(CORE_ENTRY, "toolcore");
  return core;
}

/** The whole toolbox (the core plus the engine's tools): only modes, simulate, fingerprint, preview and render load it. */
export async function loadToolbox() {
  full ??= await load(ENTRY, "toolbox");
  return full;
}

/** --- blueprint --- The Blueprint kit (src/lib/agentKit/blueprintKit.ts: the language, its runtime and catalog): only the bp-* tools load it. */
export async function loadBlueprintKit() {
  blueprint ??= await load(BLUEPRINT_ENTRY, "blueprintkit");
  return blueprint;
}
