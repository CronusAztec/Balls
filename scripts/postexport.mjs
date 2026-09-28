/**
 * Runs after `next build` (see the "build" script in package.json) and finishes the static
 * export in ./out for GitHub Pages:
 *  - copies the localised /404 page to out/404.html, which GitHub Pages serves for every
 *    unknown URL (Next's own 404.html is the unstyled default);
 *  - writes out/.nojekyll so the _next/ folder is not ignored by Jekyll.
 */
import fs from "fs";
import path from "path";

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
const pages = fs.readdirSync(out).filter((f) => !f.startsWith(".") && f !== "_next").length;
console.log(`postexport: done (${pages} top-level entries in out/)`);
