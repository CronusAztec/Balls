import fs from "fs";
import path from "path";

/*
 * --- learner --- Whether the app's main process can bundle a module of the page (src/lib) without the page's weight, as the
 * modules the learner and Fully autonomous share with it say of themselves. `importsOf` reads a module's own import and
 * re-export statements, `valueImportsOutside` names the ones that load values from a module a test did not allow (types are
 * erased, so they load nothing), and `mainBundleInputs` bundles the module with the main process's esbuild settings
 * (desktop/scripts/build.mjs) and lists every file that comes along, so a light module that grows a heavy import fails too.
 * Used by the tests of stats.ts, learnerRules.ts, dials.ts, learnerSettings.ts, postizErrors.ts, autonomyText.ts and
 * autonomy.ts (genes.ts, crew/review.ts and learner.ts keep their own older checks).
 */

// --- learner ---

const ROOT = path.join(__dirname, "..");

/** One import, re-export or load statement of a module, as written. */
export interface ImportStatement {
  statement: string;
  from: string;
  /** `import type` or `export type`: erased, so nothing is loaded. */
  typeOnly: boolean;
}

const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** Every static import, side-effect import, re-export, dynamic import and require of a module (repository-relative path). */
export function importsOf(file: string): ImportStatement[] {
  const source = read(file);
  const out: ImportStatement[] = [];
  const add = (re: RegExp, typeGroup: number | null, fromGroup: number) => {
    for (const m of source.matchAll(re)) out.push({ statement: m[0].trim(), from: m[fromGroup], typeOnly: typeGroup !== null && !!m[typeGroup] });
  };
  // import x from "y", import { a, type b } from "y", import type { c } from "y" (over several lines too)
  add(/^[ \t]*import[ \t\n]+(type[ \t\n]+)?[^;"'`]*?[ \t\n]from[ \t]*["']([^"']+)["']/gm, 1, 2);
  // import "y"
  add(/^[ \t]*import[ \t]*["']([^"']+)["']/gm, null, 1);
  // export { a } from "y", export * from "y", export type { b } from "y"
  add(/^[ \t]*export[ \t\n]+(type[ \t\n]+)?(?:\*|\{)[^;"'`]*?from[ \t]*["']([^"']+)["']/gm, 1, 2);
  // import("y"), require("y")
  add(/\b(?:import|require)[ \t]*\([ \t]*["'`]([^"'`]+)["'`]/g, null, 1);
  return out;
}

/** The statements that load values from a module not in `allowed` (the specifiers as the file writes them). */
export function valueImportsOutside(file: string, allowed: readonly string[]): string[] {
  return importsOf(file)
    .filter((s) => !s.typeOnly && !allowed.includes(s.from))
    .map((s) => s.statement);
}

/** Every file esbuild bundles with the module under the main process's settings, repository-relative, sorted. */
export async function mainBundleInputs(file: string): Promise<string[]> {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({ entryPoints: [path.join(ROOT, file)], bundle: true, write: false, platform: "node", target: "node22", format: "esm", alias: { "@": path.join(ROOT, "src") }, metafile: true, logLevel: "error" });
  return Object.keys(result.metafile.inputs)
    .map((f) => path.relative(ROOT, path.resolve(ROOT, f)).split(path.sep).join("/"))
    .sort();
}

// --- end learner ---
