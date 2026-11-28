/**
 * Runs after `next build` (see the "build" script in package.json) and finishes the static
 * export in ./out for GitHub Pages:
 *  - copies the localised /404 page to out/404.html, which GitHub Pages serves for every
 *    unknown URL (Next's own 404.html is the unstyled default);
 *  - writes out/.nojekyll so the _next/ folder is not ignored by Jekyll.
 *  - --- pwa --- writes out/offline.html and out/sw.js, the service worker of the installable offline app,
 *    with its precache list and a version hash of the export (scripts/pwa/build.mjs).
 *  - --- build-identity --- LAST of all, writes out/version.json (release version, commit, commit date) and the X-Build header
 *    rule in out/_headers (scripts/lib/build-info.cjs). After the worker on purpose: see the block at the end.
 *  - --- static-headers --- out/_headers starts from the committed public/_headers, and the X-Build block is folded into its
 *    /* block afterwards: Wrangler deploys one block per path (scripts/lib/headers-file.mjs).
 */
import fs from "fs";
import path from "path";
import { buildPwa, listFiles, MAX_PRECACHE_FILE_BYTES, OBFUSCATED_PREFIX, OBFUSCATION_GROWTH, oversizedScripts } from "./pwa/build.mjs";
import { isExcludedChunk, obfuscateExport } from "./obfuscate.mjs"; // --- code-obfuscation ---
import buildInfo from "./lib/build-info.cjs"; // --- build-identity ---
import { mergeHeaderFile, restoreStaticHeaders } from "./lib/headers-file.mjs"; // --- static-headers ---
import { mailtoFromHtml, securityTxt } from "./lib/security-txt.mjs"; // --- security-txt ---

const out = path.resolve(process.cwd(), "out");
if (!fs.existsSync(out)) {
  console.error("postexport: ./out not found – run `next build` first.");
  process.exit(1);
}

const localised404 = path.join(out, "404", "index.html");
if (fs.existsSync(localised404)) {
  fs.copyFileSync(localised404, path.join(out, "404.html"));
  console.log("postexport: wrote out/404.html from the localised /404 page");
} else {
  console.warn("postexport: out/404/index.html missing – keeping Next's default 404.html");
}

fs.writeFileSync(path.join(out, ".nojekyll"), "");

// --- security-txt --- /.well-known/security.txt from the support address the build knows (a dot path: never precached)
{
  const privacyPage = path.join(out, "en", "privacy", "index.html");
  const contact = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || process.env.JBL_SUPPORT_EMAIL || "").trim() || (fs.existsSync(privacyPage) ? mailtoFromHtml(fs.readFileSync(privacyPage, "utf8")) : "");
  if (contact) {
    fs.mkdirSync(path.join(out, ".well-known"), { recursive: true });
    fs.writeFileSync(path.join(out, ".well-known", "security.txt"), securityTxt({ contact, siteUrl: process.env.NEXT_PUBLIC_SITE_URL || buildInfo.siteUrlFromRobots(out) || "" }));
    console.log(`postexport: wrote out/.well-known/security.txt (contact ${contact})`);
  } else {
    console.warn("postexport: no support address (NEXT_PUBLIC_SUPPORT_EMAIL) and no mailto link on the privacy page: out/.well-known/security.txt not written");
  }
}

// --- code-obfuscation --- obfuscate the shipped JS and drop stray source maps BEFORE the service worker is built, so
// its version hash and precache (scripts/pwa/build.mjs) see the final, obfuscated files. OBFUSCATE=0 skips it (debug).
if (process.env.OBFUSCATE === "0") {
  console.log("postexport: OBFUSCATE=0 – skipping JavaScript obfuscation (debug build)");
} else {
  const o = obfuscateExport(out);
  console.log(
    `postexport: obfuscated ${o.count} chunk(s) in ${(o.ms / 1000).toFixed(1)}s ` +
      `(skipped ${o.skipped.length} loader chunk(s), removed ${o.mapsDeleted.length} .map file(s), ` +
      `${(o.bytesBefore / 1048576).toFixed(2)} → ${(o.bytesAfter / 1048576).toFixed(2)} MB of chunk JS)`,
  );
}
// --- end code-obfuscation ---

// --- pwa --- offline page + service worker (last: its version hashes every other exported file)
{
  // --- build-identity --- a second run over the same out/ must not find the first run's version.json and X-Build rule
  buildInfo.clearBuildFiles(out);
  restoreStaticHeaders(out); // --- static-headers --- out/_headers = the committed public/_headers again, without a first run's merged X-Build line
  const pwa = buildPwa(out);
  console.log(
    `postexport: wrote out/offline.html and out/sw.js (version ${pwa.version}, scope ${pwa.basePath}/, ` +
      `${pwa.precache.length} files / ${(pwa.bytes / 1048576).toFixed(1)} MB precached: ${pwa.critical.length} files / ${(pwa.criticalBytes / 1024).toFixed(0)} KB at install, ` +
      `${pwa.deferred.length} files / ${(pwa.deferredBytes / 1048576).toFixed(1)} MB when the page asks)`,
  );
  // --- studio-chunk-split --- (finding g3-7) a script the worker leaves out for its size breaks the offline studio ("Loading chunk
  // … failed"): name each one, as an annotation in GitHub Actions. A warning, not a stop: stopping the build is the owner's call.
  // An OBFUSCATE=0 export counts each script as it would ship obfuscated (× OBFUSCATION_GROWTH), a loader chunk the obfuscator
  // skips as it is, so a local build warns before the obfuscated one breaks. A script that already carries the obfuscator's banner
  // (OBFUSCATE=0 over an export obfuscated before) counts as it is too: the same rule as the static-hosting smoke block.
  const obfuscated = process.env.OBFUSCATE !== "0";
  const scripts = listFiles(out).filter((f) => f.startsWith("_next/static/") && f.endsWith(".js"));
  const sizes = Object.fromEntries(scripts.map((f) => [f, fs.statSync(path.join(out, f)).size]));
  const bannered = (f) => fs.readFileSync(path.join(out, f), "utf8").startsWith(OBFUSCATED_PREFIX);
  const mb = (n) => (n / 1048576).toFixed(2);
  for (const s of oversizedScripts(scripts, { sizes, obfuscated, isLoader: isExcludedChunk, isObfuscated: bannered })) {
    // the lever: the studio's page chunk sheds code through scripts/lib/studio-chunks.cjs; a chunk the studio shares (the engine's,
    // which the landing's live preview loads too) is beyond that group, which never takes a shared module: it needs a group of its own
    const lever = /\/simulator\/page-[^/]*\.js$/.test(s.file)
      ? "Move code out of it (scripts/lib/studio-chunks.cjs)"
      : "Split it with a cache group of its own, the way scripts/lib/studio-chunks.cjs splits the studio's page chunk (that group never takes a module the studio shares; keep director.ts in exactly one numbered chunk)";
    const text = obfuscated
      ? `${s.file} is ${mb(s.bytes)} MB, over the service worker's ${mb(MAX_PRECACHE_FILE_BYTES)} MB precache cap: it is not precached and the offline studio cannot load it. ${lever}; never raise the cap.`
      : `${s.file} is ${mb(s.bytes)} MB, about ${mb(s.projected)} MB once obfuscated (x${OBFUSCATION_GROWTH}), over the ${mb(MAX_PRECACHE_FILE_BYTES)} MB precache cap: the obfuscated build would break the offline studio. ${lever}; never raise the cap.`;
    console.warn(process.env.GITHUB_ACTIONS === "true" ? `::warning title=offline studio::${text}` : `postexport: warning: ${text}`);
  }
  // --- build-identity --- stop the build rather than ship a worker whose install fetch 404s (a _headers file is never served)
  const unservable = pwa.precache.filter((url) => ["_headers", "_redirects", "version.json", "build.txt"].includes(url));
  if (unservable.length) {
    console.error(`postexport: the service worker would precache ${unservable.join(", ")}, which the host does not serve: add ${unservable.length > 1 ? "them" : "it"} to NOT_PRECACHED in scripts/pwa/build.mjs`);
    process.exit(1);
  }
}
// --- end pwa ---

// --- build-identity --- version.json and the X-Build rule, written LAST. buildPwa() above hashes and precaches every file that is in
// out/ when it runs. A _headers file is never served (the host reads it), so one present at that moment would be precached, the
// worker's install fetch would get a 404 and the install would fail for every visitor; version.json holds a build time, so it would
// change the worker's version on its own. Written here, after the worker, neither file is hashed or precached (scripts/pwa/build.mjs
// also lists the names as a second guard).
{
  const info = buildInfo.resolveBuildInfo();
  // (the address: the variable the build used, else what the build wrote into robots.txt – the VPS deployer runs `next build` with
  // the site's settings and this script without them – else a local address, which makes the channel "development")
  const builtFor = process.env.NEXT_PUBLIC_SITE_URL || buildInfo.siteUrlFromRobots(out) || undefined;
  const written = buildInfo.writeBuildFiles(out, info, { siteUrl: builtFor, basePath: process.env.NEXT_PUBLIC_SITE_URL ? process.env.NEXT_PUBLIC_BASE_PATH : "" });
  // --- static-headers --- Wrangler deploys only the last block of a path: the X-Build block just appended is a second /* block, so it is folded into the one from public/_headers
  const merged = mergeHeaderFile(out);
  if (merged.length) console.log(`postexport: merged the repeated header rule${merged.length > 1 ? "s" : ""} ${merged.join(", ")} in out/_headers into one block each`);
  console.log(`postexport: wrote out/version.json (${buildInfo.buildId(info)}${info.commitDate ? `, commit of ${info.commitDate.slice(0, 10)}` : ""})${written.headers ? " and the X-Build rule in out/_headers" : " (commit unknown: no X-Build header rule)"}`);
}
// --- end build-identity ---
const pages = fs.readdirSync(out).filter((f) => !f.startsWith(".") && f !== "_next").length;
console.log(`postexport: done (${pages} top-level entries in out/)`);
