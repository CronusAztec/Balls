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
import { buildPwa } from "./pwa/build.mjs";
import { obfuscateExport } from "./obfuscate.mjs"; // --- code-obfuscation ---
import buildInfo from "./lib/build-info.cjs"; // --- build-identity ---
import { mergeHeaderFile, restoreStaticHeaders } from "./lib/headers-file.mjs"; // --- static-headers ---

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
