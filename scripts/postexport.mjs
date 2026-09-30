/**
 * Runs after `next build` (see the "build" script in package.json) and finishes the static
 * export in ./out for GitHub Pages:
 *  - copies the localised /404 page to out/404.html, which GitHub Pages serves for every
 *    unknown URL (Next's own 404.html is the unstyled default);
 *  - writes out/.nojekyll so the _next/ folder is not ignored by Jekyll.
 *  - --- pwa --- writes out/offline.html and out/sw.js, the service worker of the installable offline app,
 *    with its precache list and a version hash of the export (scripts/pwa/build.mjs).
 */
import fs from "fs";
import path from "path";
import { buildPwa } from "./pwa/build.mjs";

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

// --- pwa --- offline page + service worker (last: its version hashes every other exported file)
{
  const pwa = buildPwa(out);
  console.log(
    `postexport: wrote out/offline.html and out/sw.js (version ${pwa.version}, scope ${pwa.basePath}/, ` +
      `${pwa.precache.length} files / ${(pwa.bytes / 1048576).toFixed(1)} MB precached)`,
  );
}
// --- end pwa ---
const pages = fs.readdirSync(out).filter((f) => !f.startsWith(".") && f !== "_next").length;
console.log(`postexport: done (${pages} top-level entries in out/)`);
