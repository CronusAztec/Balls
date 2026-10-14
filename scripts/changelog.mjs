#!/usr/bin/env node
// --- changelog --- CHANGELOG.md and release notes from the one file that holds what changed: src/content/changelog.json (the
// same data the site's /changelog page shows; the English texts are used here). No dependencies, so a release job that has only
// the scripts folder and src/content can run it.
//   node scripts/changelog.mjs --write                    rewrite CHANGELOG.md at the repository root from the JSON
//   node scripts/changelog.mjs --check                    exit 1 when CHANGELOG.md differs from what --write would write
//   node scripts/changelog.mjs --notes <site|app> <x.y.z>  print that release's notes as Markdown (the headline, then one bullet
//                                                         per item) for the body of a GitHub release; exit 1 when there is none
// `npm run changelog` is --write and `npm run changelog:check` is --check; tests/changelog.test.ts runs --check, so a changed
// entry cannot reach the repository without its CHANGELOG.md. The functions below are pure and exported for the tests and for
// scripts/release/publish-downloads.mjs, which uses releaseNotes() for the body of the Windows app's public release.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_FILE = path.join(ROOT, "src", "content", "changelog.json");
export const MARKDOWN_FILE = path.join(ROOT, "CHANGELOG.md");

/** SITE_NAME of src/lib/site.ts, for the {siteName} placeholder of an entry (tests/changelog.test.ts keeps the two equal). */
export const SITE_NAME = "JumpingBallsLive";
/** The product names the page, CHANGELOG.md and the notes use. */
export const PRODUCT_NAMES = { site: "Website", app: "Windows app" };
/** The kinds of item, in the order they are listed. */
export const KIND_NAMES = { new: "New", improved: "Improved", fixed: "Fixed" };

export const HEADER = [
  "# Changelog",
  "",
  `The releases of ${SITE_NAME}, newest first: the website ("Website x.y.z") and the Windows app ("Windows app x.y.z").`,
  "The website's version is the `version` in `package.json`, the Windows app's is the one in `desktop/package.json`.",
  "The site shows the same list, in English, Polish and Spanish, at `/changelog`.",
  "",
  "This file is generated from `src/content/changelog.json`. Do not edit it by hand: change the entry there, then run `npm run changelog`.",
  "`npm run changelog:check` fails when this file is out of date.",
].join("\n");

/** The releases of the data file, newest first (the file's order). @param {string} [file] */
export function readReleases(file = DATA_FILE) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data || !Array.isArray(data.releases)) throw new Error(`${file} has no "releases" list`);
  return data.releases;
}

/** An entry's text with {siteName} filled in. @param {string} text */
export function fill(text) {
  return String(text).replaceAll("{siteName}", SITE_NAME);
}

/** Markdown control characters in plain text, escaped so the text reads as written. @param {string} text */
export function mdEscape(text) {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

/** The English text of an entry's localized value, ready for Markdown. @param {{ en: string }} localized */
function english(localized) {
  return mdEscape(fill(localized.en));
}

/** "Website 1.10.0" / "Windows app 1.3.0". @param {{ product: string, version: string }} release */
export function releaseTitle(release) {
  return `${PRODUCT_NAMES[release.product] ?? release.product} ${release.version}`;
}

/** The items of a release by kind, in the order of KIND_NAMES (the file's order inside a kind). @param {{ items: { kind: string }[] }} release */
function itemsByKind(release) {
  return Object.keys(KIND_NAMES)
    .map((kind) => ({ kind, items: release.items.filter((item) => item.kind === kind) }))
    .filter((group) => group.items.length > 0);
}

/** One release of CHANGELOG.md: its heading with the date, the headline, then a list per kind. */
export function renderRelease(release) {
  const lines = [`## ${releaseTitle(release)} · ${release.date}`, "", english(release.headline)];
  for (const { kind, items } of itemsByKind(release)) {
    lines.push("", `### ${KIND_NAMES[kind]}`, "");
    for (const item of items) lines.push(`- ${english(item.text)}`);
  }
  return lines.join("\n");
}

/** The whole CHANGELOG.md (ends with one newline). */
export function renderChangelog(releases) {
  return `${[HEADER, ...releases.map(renderRelease)].join("\n\n")}\n`;
}

/** The release of a product at a version, or undefined. @param {string} product @param {string} version */
export function findRelease(releases, product, version) {
  return releases.find((r) => r.product === product && r.version === version);
}

/**
 * The notes of one release as Markdown for a release body: the headline, then a bullet per item that starts with its kind.
 * No front matter, no heading (the release has its own title), no link to the source repository.
 * @returns {string | null} null when the release has no entry
 */
export function releaseNotes(releases, product, version) {
  const release = findRelease(releases, product, version);
  if (!release) return null;
  const lines = [english(release.headline), ""];
  for (const { kind, items } of itemsByKind(release)) for (const item of items) lines.push(`- **${KIND_NAMES[kind]}:** ${english(item.text)}`);
  return lines.join("\n");
}

/** Whether the file holds exactly what --write would write. @param {string} [file] */
export function checkChangelog(releases, file = MARKDOWN_FILE) {
  const expected = renderChangelog(releases);
  const actual = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  return { ok: actual === expected, expected, actual };
}

const USAGE = "usage: node scripts/changelog.mjs --write | --check | --notes <site|app> <x.y.z>";

/**
 * The command line. @param {string[]} argv
 * @param {{ out?: (text: string) => void, err?: (text: string) => void, dataFile?: string, markdownFile?: string }} [io]
 * @returns {number} the exit code
 */
export function run(argv, io = {}) {
  const out = io.out ?? ((text) => process.stdout.write(`${text}\n`));
  const err = io.err ?? ((text) => process.stderr.write(`${text}\n`));
  const [command, product, version] = argv;
  try {
    if (command === "--write") {
      const releases = readReleases(io.dataFile);
      fs.writeFileSync(io.markdownFile ?? MARKDOWN_FILE, renderChangelog(releases));
      out(`CHANGELOG.md written: ${releases.length} releases`);
      return 0;
    }
    if (command === "--check") {
      const { ok } = checkChangelog(readReleases(io.dataFile), io.markdownFile);
      if (!ok) {
        err("CHANGELOG.md is out of date. Run: npm run changelog");
        return 1;
      }
      out("CHANGELOG.md is up to date");
      return 0;
    }
    if (command === "--notes") {
      if (!["site", "app"].includes(product) || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
        err(USAGE);
        return 2;
      }
      const notes = releaseNotes(readReleases(io.dataFile), product, version);
      if (notes === null) {
        err(`no changelog entry for ${product} ${version}`);
        return 1;
      }
      out(notes);
      return 0;
    }
    err(USAGE);
    return 2;
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = run(process.argv.slice(2));
