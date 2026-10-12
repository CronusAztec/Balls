#!/usr/bin/env node
/**
 * --- desktop-autorelease --- The Windows app's version: one command bumps it, CI decides from it. Three modes:
 *
 *   node scripts/release/desktop-version.mjs 1.0.4      (npm run release:desktop -- 1.0.4)
 *     writes 1.0.4 into desktop/package.json, desktop/package-lock.json (both of its version fields) and
 *     src/lib/desktop/release.ts (DESKTOP_VERSION, the download page's build-time version) and prints the three git lines that
 *     commit and push it. It refuses a version that is not semantic (1.2.3) or not higher than the current one, and it never
 *     runs git itself. Pushing that commit to the product branch is what releases the app (.github/workflows/desktop.yml).
 *
 *   node scripts/release/desktop-version.mjs --check
 *     prints the version; exits 1 with the problems listed when the four version fields disagree or are not semantic.
 *
 *   node scripts/release/desktop-version.mjs --decide   (CI only: the `decide` job of .github/workflows/desktop.yml)
 *     works out what a run of the "Windows app" workflow is – the version, whether to build, whether to release – from the
 *     event (GITHUB_EVENT_NAME, GITHUB_REF, INPUT_VERSION, INPUT_PUBLISH), desktop/package.json now and before the push
 *     (git), and whether the tag desktop-v<version> exists already (`gh api`), and writes version=, build=, release= to
 *     GITHUB_OUTPUT. A failing tag lookup other than "404 Not Found" fails the job: a release must not be skipped because of
 *     an API hiccup. Nothing else is read from the network (the previous commit of a multi-commit push may be fetched with
 *     git, see previousVersion()).
 *
 * The rules themselves are the pure decideRelease() below (tests/desktopRelease.test.ts).
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The three files that hold the app's version, relative to the repository root. */
export const VERSION_FILES = ["desktop/package.json", "desktop/package-lock.json", "src/lib/desktop/release.ts"];

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const RELEASE_TS_LINE = /^export const DESKTOP_VERSION = "([^"]+)";/m;
const TAG_PREFIX = "refs/tags/desktop-v";

/** @param {unknown} v @returns {boolean} */
export function isSemver(v) {
  return typeof v === "string" && SEMVER.test(v);
}

/** @param {string} v */
function parts(v) {
  const [main, ...rest] = v.split("-");
  return { nums: main.split(".").map((n) => Number(n)), pre: rest.length ? rest.join("-").split(".") : [] };
}

/**
 * Compares two semantic versions: numerically on major.minor.patch; a pre-release is lower than its release, two
 * pre-releases compare identifier by identifier (numbers numerically and below words). Returns -1, 0 or 1.
 * @param {string} a @param {string} b @returns {-1 | 0 | 1}
 */
export function compareSemver(a, b) {
  if (!isSemver(a) || !isSemver(b)) throw new Error(`cannot compare '${a}' with '${b}': not semantic versions (1.2.3)`);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  if (!pa.pre.length || !pb.pre.length) return pa.pre.length === pb.pre.length ? 0 : pa.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The next patch version (1.0.4 → 1.0.5), for the messages. @param {string} v */
export function nextPatch(v) {
  if (!isSemver(v)) return "1.0.0";
  const [major, minor, patch] = parts(v).nums;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * What a run of the "Windows app" workflow does.
 * @param {{ event: string, ref: string, inputVersion?: string | null, inputPublish?: boolean | string | null, current: string, previous?: string | null, tagExists?: boolean }} input
 * @returns {{ version: string, build: boolean, release: boolean, reason: string, warning: string | null }}
 */
export function decideRelease({ event, ref, inputVersion, inputPublish, current, previous = null, tagExists = false }) {
  /** @type {{ version: string, build: boolean, release: boolean, reason: string, warning: string | null }} */
  let d;
  if (event === "push" && typeof ref === "string" && ref.startsWith(TAG_PREFIX)) {
    d = { version: ref.slice(TAG_PREFIX.length), build: true, release: true, reason: "tag", warning: null };
  } else if (event === "workflow_dispatch") {
    d = { version: inputVersion || current, build: true, release: inputPublish === true || inputPublish === "true", reason: "manual", warning: null };
  } else if (event === "pull_request") {
    d = { version: current, build: true, release: false, reason: "pull request", warning: null };
  } else if (event === "push") {
    if (current === previous) {
      d = { version: current, build: false, release: false, reason: `version unchanged (${current})`, warning: null };
    } else if (tagExists) {
      d = {
        version: current,
        build: false,
        release: false,
        reason: `desktop-v${current} exists already`,
        warning: `desktop/package.json says ${current} but the release desktop-v${current} exists already: bump to a higher version (npm run release:desktop -- ${nextPatch(current)})`,
      };
    } else {
      const lower = previous != null && isSemver(previous) && isSemver(current) && compareSemver(current, previous) <= 0;
      d = { version: current, build: true, release: true, reason: `version ${previous ?? "none"} → ${current}`, warning: lower ? `${current} is not higher than ${previous}` : null };
    }
  } else {
    d = { version: current, build: true, release: false, reason: `event ${event}`, warning: null };
  }
  if (!isSemver(d.version)) throw new Error(`'${d.version}' is not a semantic version (1.2.3)`);
  return d;
}

/** The `version` of a JSON document (a package.json). @param {string} jsonText @returns {string} */
export function readVersion(jsonText) {
  const v = JSON.parse(jsonText)?.version;
  if (typeof v !== "string") throw new Error("the JSON document has no version");
  return v;
}

/** npm's own formatting: two spaces, a final newline (key order is kept by JSON.parse / JSON.stringify). */
const npmJson = (obj) => JSON.stringify(obj, null, 2) + "\n";

/**
 * Writes `version` into the three version files under `root`; returns their relative paths. Throws (before writing anything)
 * when a file lacks the expected field or line.
 * @param {string} root @param {string} version @returns {string[]}
 */
export function bumpFiles(root, version) {
  if (!isSemver(version)) throw new Error(`'${version}' is not a semantic version (1.2.3)`);
  const [pkgFile, lockFile, tsFile] = VERSION_FILES.map((f) => path.join(root, f));
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  if (typeof pkg.version !== "string") throw new Error(`${VERSION_FILES[0]} has no "version"`);
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  if (typeof lock.version !== "string") throw new Error(`${VERSION_FILES[1]} has no "version"`);
  if (typeof lock.packages?.[""]?.version !== "string") throw new Error(`${VERSION_FILES[1]} has no packages[""].version`);
  const ts = fs.readFileSync(tsFile, "utf8");
  if (!RELEASE_TS_LINE.test(ts)) throw new Error(`${VERSION_FILES[2]} has no line export const DESKTOP_VERSION = "…";`);
  pkg.version = version;
  lock.version = version;
  lock.packages[""].version = version;
  fs.writeFileSync(pkgFile, npmJson(pkg));
  fs.writeFileSync(lockFile, npmJson(lock));
  fs.writeFileSync(tsFile, ts.replace(RELEASE_TS_LINE, `export const DESKTOP_VERSION = "${version}";`));
  return [...VERSION_FILES];
}

/**
 * The four version fields (desktop/package.json, its lock file's two, release.ts's DESKTOP_VERSION) agree and are semantic.
 * @param {string} root @returns {{ version: string | null, problems: string[] }}
 */
export function checkConsistency(root) {
  const problems = [];
  const read = (rel, get) => {
    try {
      const v = get(fs.readFileSync(path.join(root, rel), "utf8"));
      if (typeof v !== "string") throw new Error("missing");
      return v;
    } catch {
      problems.push(`${rel}: no version found`);
      return null;
    }
  };
  const fields = [
    ["desktop/package.json", read(VERSION_FILES[0], (t) => JSON.parse(t).version)],
    ["desktop/package-lock.json (version)", read(VERSION_FILES[1], (t) => JSON.parse(t).version)],
    ['desktop/package-lock.json (packages[""].version)', read(VERSION_FILES[1], (t) => JSON.parse(t).packages?.[""]?.version)],
    ["src/lib/desktop/release.ts (DESKTOP_VERSION)", read(VERSION_FILES[2], (t) => RELEASE_TS_LINE.exec(t)?.[1])],
  ];
  const version = fields[0][1];
  for (const [name, v] of fields) {
    if (v === null) continue;
    if (!isSemver(v)) problems.push(`${name} is '${v}', not a semantic version (1.2.3)`);
    if (version !== null && v !== version) problems.push(`${name} is ${v}, desktop/package.json is ${version}`);
  }
  return { version, problems };
}

/* ------------------------------------------------------------------------------------------------------------------ CLI */

/** The repository the command works on: the current directory when it holds the app, else this script's repository. */
function repoRoot() {
  const cwd = process.cwd();
  return fs.existsSync(path.join(cwd, VERSION_FILES[0])) && fs.existsSync(path.join(cwd, VERSION_FILES[2])) ? cwd : SCRIPT_ROOT;
}

function fail(message) {
  // workflow commands (::error::) go to stdout, where the Actions runner reads them
  if (message.startsWith("::")) console.log(message);
  else console.error(message);
  process.exit(1);
}

function bump(root, version) {
  if (!isSemver(version)) fail(`'${version}' is not a semantic version (1.2.3) – e.g. npm run release:desktop -- 1.0.4`);
  const current = readVersion(fs.readFileSync(path.join(root, VERSION_FILES[0]), "utf8"));
  if (isSemver(current) && compareSemver(version, current) <= 0) fail(`${version} is not higher than the current ${current} – use a higher version`);
  const files = bumpFiles(root, version);
  const { problems } = checkConsistency(root);
  if (problems.length) fail(`The version files disagree after the bump:\n  ${problems.join("\n  ")}`);
  console.log(
    [
      `Windows app: ${current} → ${version} in desktop/package.json, desktop/package-lock.json and src/lib/desktop/release.ts.`,
      "Now run:",
      `  git add ${files.join(" ")}`,
      `  git commit -m "Windows app ${version}"`,
      "  git push",
      `Then watch Actions → "Windows app" (about 6–10 minutes) and GitHub → Releases: the release desktop-v${version} appears with the installer, and installed apps update within 4 hours (or at their next start).`,
    ].join("\n"),
  );
}

function check(root) {
  const { version, problems } = checkConsistency(root);
  console.log(`Windows app version: ${version ?? "unknown"}`);
  if (problems.length) fail(`The version files disagree:\n  ${problems.join("\n  ")}\nFix them with npm run release:desktop -- <version>.`);
}

/** @param {string} root @param {string} rev @returns {string | null} */
function versionAt(root, rev) {
  try {
    return readVersion(execFileSync("git", ["show", `${rev}:desktop/package.json`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    return null;
  }
}

/**
 * desktop/package.json's version before this push: at the push's `before` commit (the event payload) when there is one –
 * fetched with git when the shallow checkout (fetch-depth 2) does not hold it, so a bump followed by other commits in one push
 * still releases – else at HEAD^. null when neither can be read (the file is new).
 * @param {string} root
 */
function previousVersion(root) {
  let before = "";
  try {
    const payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8"));
    if (typeof payload?.before === "string" && /^[0-9a-f]{40}$/.test(payload.before) && !/^0+$/.test(payload.before)) before = payload.before;
  } catch {
    /* no event payload: HEAD^ */
  }
  if (before) {
    let v = versionAt(root, before);
    if (v === null) {
      try {
        execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", before], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
        v = versionAt(root, before);
      } catch {
        /* a force-push's old head may be gone: HEAD^ */
      }
    }
    if (v !== null) return v;
  }
  return versionAt(root, "HEAD^");
}

/** @param {string} repo @param {string} version @returns {boolean} */
function tagExists(repo, version) {
  try {
    execFileSync("gh", ["api", `repos/${repo}/git/ref/tags/desktop-v${version}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (err) {
    const e = /** @type {{ stdout?: string, stderr?: string, message?: string }} */ (err);
    const text = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    if (/Not Found|404/.test(text)) return false;
    fail(`::error title=Could not look up the tag desktop-v${version}::${(e.stderr || e.message || "gh api failed").trim()} – re-run the job; a release is never skipped because of a failed lookup.`);
    return false;
  }
}

function decide(root) {
  const env = process.env;
  const event = env.GITHUB_EVENT_NAME || "";
  const ref = env.GITHUB_REF || "";
  const repo = env.GITHUB_REPOSITORY || "CronusAztec/Balls";
  const current = readVersion(fs.readFileSync(path.join(root, VERSION_FILES[0]), "utf8"));
  let previous = null;
  let exists = false;
  if (event === "push" && !ref.startsWith(TAG_PREFIX)) {
    previous = previousVersion(root);
    if (previous !== current) exists = tagExists(repo, current);
  }
  let d;
  try {
    d = decideRelease({ event, ref, inputVersion: env.INPUT_VERSION || "", inputPublish: env.INPUT_PUBLISH || "", current, previous, tagExists: exists });
  } catch (err) {
    fail(`::error title=No valid version::${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const lines = [`version=${d.version}`, `build=${d.build}`, `release=${d.release}`];
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  else console.log(lines.join("\n"));
  console.log(`::notice title=Windows app ${d.version}::${d.reason} – build ${d.build ? "yes" : "no"}, release ${d.release ? "yes" : "no"}`);
  if (d.warning) console.log(`::warning title=Windows app version::${d.warning}`);
}

function main(argv) {
  const root = repoRoot();
  const arg = argv[0];
  if (arg === "--check") return check(root);
  if (arg === "--decide") return decide(root);
  if (!arg || arg === "--help" || arg === "-h") {
    let current = "unknown";
    try {
      current = readVersion(fs.readFileSync(path.join(root, VERSION_FILES[0]), "utf8"));
    } catch {
      /* shown as unknown */
    }
    fail(`Usage: npm run release:desktop -- <version>   (the Windows app is ${current} now; e.g. npm run release:desktop -- ${nextPatch(current)})\n       node scripts/release/desktop-version.mjs --check | --decide`);
  }
  return bump(root, arg);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
