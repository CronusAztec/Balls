/**
 * --- react-hydration-replay --- Patches the React that Next 15 bundles (node_modules/next/dist/compiled/react-dom*) with
 * React 19.3's fix for a hydration mismatch, on every plain install ("postinstall" in package.json; package-lock.json's root
 * entry records it as "hasInstallScript": true). npm runs it only for a plain `npm install` or `npm ci`: `npm install
 * <package>` (a bump of next included), `npm update`, `npm audit fix` and `--ignore-scripts` skip it, and a next they
 * reinstall is unpatched until `npm install` or this script runs (tests/hydrationReplay.test.ts fails until then).
 *
 * The bug: Next 15.5.26 bundles React 19.2.0-canary-0bdb9206-20250818. When a host element (a <div>) suspends on a lazy
 * child (a server-component row still streaming in) during hydration, and the row resolves during React's yield, React
 * replays that element (replaySuspendedUnitOfWork, its `case 5`) without rewinding the hydration cursor, so the element is
 * matched against its own first child: "Minified React error #418 (args HTML)", reported as a page error, after which React
 * throws the server HTML away and renders the page again on the client. About one page load in a thousand; it failed a
 * smoke shard on CI ("no console/page errors").
 *
 * The upstream fix (React 19.3.0, replaySuspendedUnitOfWork): right after `resetHooksOnUnwind(...)` in `case 5`, pop the
 * hydration state back to the element's parent and point the cursor at the element itself, so the replay claims it again:
 *
 *   var fiber = next;
 *   fiber === hydrationParentFiber &&
 *     (isHydrating
 *       ? (popToNextHostParent(fiber),
 *         5 === fiber.tag && null != fiber.stateNode && (nextHydratableInstance = fiber.stateNode))
 *       : (popToNextHostParent(fiber), (isHydrating = !0)));
 *
 * This script inserts exactly those lines, with each build's own name for the fiber (`next` in the production and profiling
 * builds, `unitOfWork` in the development builds, where `case 5` sits in replayBeginWork), into every build of Next's
 * compiled react-dom and react-dom-experimental that contains replaySuspendedUnitOfWork: the client builds the export and
 * `next dev` load, and the profiling and testing builds. Next's dev overlay (next/dist/compiled/next-devtools) carries a
 * minified React of its own; it only ever creates a root, never hydrates one, so it is left alone. Webpack trusts
 * node_modules by package version, so next.config.ts (--- react-hydration-replay ---) puts a digest of the bundled React into
 * Next's webpack cache version: a .next/cache built before the patch is not reused.
 *
 * Idempotent: a patched build is a no-op with a one-line note. A build whose unpatched text and patched text are both missing
 * stops the install with an error naming the file: check whether the new Next already bundles the fix. Nothing is written
 * unless every build can be patched.
 *
 * When to delete it: once `next` bundles React 19.3 or later (Next 16.2 and later). Delete this file, the "postinstall" entry in
 * package.json and with it the root "hasInstallScript" of package-lock.json (a plain `npm install` drops it), the webpack hook
 * of next.config.ts, the checks of this script in tests/hydrationReplay.test.ts and the note in README.md ("Dependencies").
 *
 * Usage: node scripts/patch-react-hydration-replay.mjs [--next-dir <the next package folder>]
 * (default: the `next` this repository resolves; --next-dir is for the tests, which patch a copy). Pure Node, no dependency.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const TAG = "patch-react-hydration-replay";
const ADVICE = `check whether this Next already bundles React 19.3 or later (Next 16.2+), which has the fix: if so, delete scripts/${TAG}.mjs and its "postinstall" entry in package.json (the header of the script lists the rest); if not, update the patch to the new code`;

/** The comment the patch leaves in front of the lines it inserts: how a patched build is told from an unpatched one. */
export const MARKER = `// --- react-hydration-replay --- inserted by scripts/${TAG}.mjs: React 19.3's fix (rewind the hydration cursor before replaying a host element)`;

/** The client build the export loads, relative to the next package: it must be among the builds found. */
export const CLIENT_BUILD = path.join("dist", "compiled", "react-dom", "cjs", "react-dom-client.production.js");

/** The lines React 19.3 has in `case 5`, for a fiber called `name`, each line starting with `indent`, after the marker. */
export function fixLines(name, indent) {
  return [
    MARKER,
    `var fiber = ${name};`,
    "fiber === hydrationParentFiber &&",
    "  (isHydrating",
    "    ? (popToNextHostParent(fiber),",
    "      5 === fiber.tag &&",
    "        null != fiber.stateNode &&",
    "        (nextHydratableInstance = fiber.stateNode))",
    "    : (popToNextHostParent(fiber), (isHydrating = !0)));",
  ].map((line) => indent + line + "\n").join("");
}

/** `case 5:` then `resetHooksOnUnwind(<fiber>);` then `default:`, as every unpatched build writes it. */
const UNPATCHED = /\n([ \t]*)case 5:\n([ \t]*)resetHooksOnUnwind\(([A-Za-z_$][\w$]*)\);\n([ \t]*)default:\n/;
/** React's own fix, without the marker: a build of React 19.3 or later. */
const UPSTREAM = /resetHooksOnUnwind\(([A-Za-z_$][\w$]*)\);\s*var fiber = \1;\s*fiber === hydrationParentFiber &&/;
/** The module-level names the inserted lines use: each build must declare them. */
const NAMES = ["hydrationParentFiber", "isHydrating", "nextHydratableInstance"];

/** The source from replaySuspendedUnitOfWork to the function after it and replayBeginWork (throwAndUnwindWorkLoop). */
function replayRegion(text) {
  const start = text.indexOf("function replaySuspendedUnitOfWork(");
  if (start < 0) return null;
  const end = text.indexOf("function throwAndUnwindWorkLoop(", start);
  return { start, end: end < 0 ? Math.min(text.length, start + 6000) : end };
}

/**
 * Patches one build's source. Returns { status, text }: "patched" (text is the new source), "already-patched" or
 * "upstream" (React's own fix is there), both with the text unchanged. Throws when the build has neither the old text nor
 * the fix.
 */
export function patchSource(text, label = "the build") {
  const region = replayRegion(text);
  if (!region) throw new Error(`${TAG}: ${label} has no function replaySuspendedUnitOfWork: ${ADVICE}.`);
  const body = text.slice(region.start, region.end);
  if (body.includes(MARKER)) return { status: "already-patched", text };
  if (UPSTREAM.test(body)) return { status: "upstream", text };
  const m = UNPATCHED.exec(body);
  if (!m) throw new Error(`${TAG}: ${label}: neither the unpatched "case 5: resetHooksOnUnwind(...); default:" of replaySuspendedUnitOfWork nor the fixed one was found: ${ADVICE}.`);
  if (/\bfiber\b/.test(body)) throw new Error(`${TAG}: ${label}: replaySuspendedUnitOfWork already uses the name "fiber", which the inserted "var fiber" would shadow: ${ADVICE}.`);
  const missing = NAMES.filter((name) => !new RegExp(`\\b${name} = `).test(text));
  if (!text.includes("function popToNextHostParent(")) missing.push("popToNextHostParent");
  if (missing.length) throw new Error(`${TAG}: ${label} does not declare ${missing.join(", ")}, which the fix uses: ${ADVICE}.`);
  const [whole, , bodyIndent, fiberName, defaultIndent] = m;
  const at = region.start + m.index + whole.length - (defaultIndent.length + "default:\n".length);
  return { status: "patched", text: text.slice(0, at) + fixLines(fiberName, bodyIndent) + text.slice(at) };
}

/** Every build of Next's compiled react-dom (stable and experimental) that holds replaySuspendedUnitOfWork, as absolute paths. */
export function findBuilds(nextDir) {
  const compiled = path.join(nextDir, "dist", "compiled");
  const builds = [];
  for (const dir of fs.readdirSync(compiled).filter((d) => /^react-dom(-[a-z]+)?$/.test(d)).sort()) {
    const cjs = path.join(compiled, dir, "cjs");
    if (!fs.existsSync(cjs)) continue;
    for (const file of fs.readdirSync(cjs).filter((f) => f.endsWith(".js")).sort()) {
      const full = path.join(cjs, file);
      if (fs.readFileSync(full, "utf8").includes("function replaySuspendedUnitOfWork(")) builds.push(full);
    }
  }
  return builds;
}

const NOTES = {
  patched: "patched",
  "already-patched": "already patched, nothing to do",
  upstream: "has React's own fix (React 19.3+): this script can go",
};

/**
 * Patches every build under `nextDir`. Works out every change before it writes one, so a build it cannot patch leaves all
 * of them as they were. Prints one line per build; returns one { file, status } per build.
 */
export function patchNext(nextDir, log = (line) => console.log(line)) {
  const builds = findBuilds(nextDir);
  if (!builds.includes(path.join(nextDir, CLIENT_BUILD))) {
    throw new Error(`${TAG}: ${path.join(nextDir, CLIENT_BUILD)} is missing or has no replaySuspendedUnitOfWork: ${ADVICE}.`);
  }
  const label = (file) => path.relative(path.dirname(nextDir), file);
  const changes = builds.map((file) => ({ file, ...patchSource(fs.readFileSync(file, "utf8"), label(file)) }));
  for (const { file, status, text } of changes) {
    if (status === "patched") fs.writeFileSync(file, text);
    log(`${TAG}: ${label(file)}: ${NOTES[status]}`);
  }
  return changes.map(({ file, status }) => ({ file, status }));
}

/** The `next` package folder: --next-dir, else the one this repository resolves. */
function nextDirFromArgs(argv) {
  const i = argv.indexOf("--next-dir");
  if (i >= 0) {
    if (!argv[i + 1]) throw new Error(`${TAG}: --next-dir needs a folder`);
    return path.resolve(argv[i + 1]);
  }
  return path.dirname(createRequire(import.meta.url).resolve("next/package.json"));
}

/** Run as a script, not imported by the tests: the check of scripts/agent/paths.mjs isMainModule, kept here so the script stands alone. */
function isMain() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(self);
  } catch {
    return path.resolve(process.argv[1]) === self;
  }
}

if (isMain()) {
  try {
    patchNext(nextDirFromArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
