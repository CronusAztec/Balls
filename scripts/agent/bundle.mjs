/**
 * --- agent-cli --- Bundles the agent toolbox's pure TypeScript (src/lib/agentKit/toolbox.ts and what it imports: the engine,
 * the finder, the settings, the video analysis helpers) for Node with esbuild – a dev dependency already (vitest's), with @
 * aliased to src, exactly as scripts/viral-bot.mjs bundles the bot – and imports it. The bundle is cached in the agent cache
 * (paths.mjs CACHE_DIR, a private folder) with esbuild's list of its inputs; it is rebuilt only when an input's size or time
 * changed, a file was added to src/lib/agentKit or src/lib/videoAnalysis, or esbuild is another version – and whenever the
 * list of inputs is empty or lacks the entry. Nothing is written to the repository.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { ROOT, cacheDir } from "./paths.mjs";

const ENTRY = path.join(ROOT, "src", "lib", "agentKit", "toolbox.ts");
const WATCHED_DIRS = [path.join(ROOT, "src", "lib", "agentKit"), path.join(ROOT, "src", "lib", "videoAnalysis")];

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
export function fresh(meta, version, now = listing()) {
  if (!meta || typeof meta !== "object" || meta.esbuild !== version || meta.entry !== ENTRY) return false;
  if (JSON.stringify(meta.listing) !== JSON.stringify(now)) return false;
  const inputs = meta.inputs && typeof meta.inputs === "object" ? Object.entries(meta.inputs) : [];
  if (!inputs.length || !Object.hasOwn(meta.inputs, ENTRY)) return false;
  return inputs.every(([file, s]) => stamp(file) === s);
}

export { ENTRY as TOOLBOX_ENTRY, listing as toolboxListing };

let loaded = null;

/** The bundled toolbox module (built or taken from the cache). */
export async function loadToolbox() {
  if (loaded) return loaded;
  const esbuild = await esbuildModule();
  const dir = cacheDir("bundle");
  const outfile = path.join(dir, "toolbox.mjs");
  const metaFile = path.join(dir, "toolbox.meta.json");
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  } catch {
    meta = null;
  }
  if (!fs.existsSync(outfile) || !fresh(meta, esbuild.version)) {
    const tmp = `${outfile}.${process.pid}.tmp.mjs`;
    const result = await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      outfile: tmp,
      alias: { "@": path.join(ROOT, "src") },
      logLevel: "error",
      metafile: true,
      absWorkingDir: ROOT,
    });
    const inputs = {};
    for (const rel of Object.keys(result.metafile.inputs)) {
      const file = path.resolve(ROOT, rel);
      inputs[file] = stamp(file);
    }
    fs.renameSync(tmp, outfile); // atomic: a parallel call imports either the old bundle or the new one, never half of one
    fs.writeFileSync(metaFile, JSON.stringify({ esbuild: esbuild.version, entry: ENTRY, listing: listing(), inputs }));
  }
  loaded = await import(`${pathToFileURL(outfile).href}?v=${encodeURIComponent(stamp(outfile))}`);
  return loaded;
}
