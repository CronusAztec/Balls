/**
 * --- desktop-exe --- Bundles the app's main process (ESM) and preload script (CommonJS: a sandboxed preload cannot be a
 * module) with esbuild into dist/. The site's shared modules (../src/lib/desktop) are bundled in; the packages with native
 * parts or their own file lookups (node-llama-cpp, ffmpeg-static, electron-store, electron-updater) stay external and ship
 * in node_modules.
 */
import { build } from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const alias = { "@": path.resolve(root, "../src") };
const common = { bundle: true, platform: "node", target: "node22", sourcemap: true, logLevel: "info", alias, absWorkingDir: root };
// --- desktop-autorelease --- the public site the app's Help menu opens (main.ts SITE_URL): the address its site export was built
// for (DESKTOP_SITE_URL, which desktop.yml takes from .github/actions/site-url – the custom domain once CUSTOM_DOMAIN is set)
const SITE_URL = (process.env.DESKTOP_SITE_URL || "https://cronusaztec.github.io/Balls").replace(/\/+$/, "");

await build({
  ...common,
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  format: "esm",
  external: ["electron", "node-llama-cpp", "ffmpeg-static", "electron-store", "electron-updater"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: { "process.env.JBL_SITE_URL": JSON.stringify(SITE_URL) }, // --- desktop-autorelease ---
});

await build({
  ...common,
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.cjs",
  format: "cjs",
  external: ["electron"],
});
