// --- studio-chunk-split --- (finding g3-7) The studio's mode drawing in a chunk of its own. Obfuscated, the studio's page
// chunk (app/[locale]/simulator/page-*.js) had grown to 4.4 MB, over the service worker's 4 MiB precache cap
// (scripts/pwa/build.mjs MAX_PRECACHE_FILE_BYTES), so the worker left it out and the studio did not load offline ("Loading
// chunk 7676 failed"). This webpack cache group moves every mode renderer (src/components/simulator/*Renderer.ts) and every
// .ts file directly in Fight League's folder (src/components/simulator/fightLeague/*.ts: its drawing and makeClip.ts, the Make
// me a clip planner, whose finder imports stay in the engine's shared chunk) out of the page chunk into one numbered chunk
// (<n>-<hash>.js) that the same page loads in parallel as an initial script. The imports stay static, so the load order and
// the first frame do not change; each file is obfuscated and capped on its own (about 67 % and 39 % of the cap on f6b78b9).
// What stays in the page chunk: Canvas.tsx, Simulator.tsx, the panel, the recorder, liveMarkHud.ts, splitScreenCanvas.tsx.
// The engine and the director stay in their shared numbered chunk (the smoke's code-obfuscation check needs exactly one
// with "near-disaster"). Not splitChunks.maxSize: its pass renames the entry (several simulator/page-<key>-*.js), splits by
// path order and counts pre-minify bytes. Never give the group a `name`: a numbered chunk is obfuscated like every chunk,
// and a name that starts with a loader prefix (scripts/obfuscate.mjs EXCLUDED_CHUNK_PREFIXES) would ship it readable.
// Plain CommonJS like build-info.cjs: next.config.ts is compiled to CommonJS, and tests/studioChunks.test.ts imports it.
"use strict";

/** The studio's page entry as Next names it (from src/app/[locale]/simulator/page.tsx). */
const STUDIO_PAGE_ENTRY = "app/[locale]/simulator/page";
/** The modules that move: every src/components/simulator/*Renderer.ts and every .ts file directly in src/components/simulator/fightLeague/. */
const STUDIO_DRAW_MODULE = /[\\/]src[\\/]components[\\/]simulator[\\/](?:fightLeague[\\/][^\\/]+|[^\\/]+Renderer)\.ts$/;
/** Below webpack's default group (-20): a module the studio shares with another page stays in the shared chunk it is in. */
const STUDIO_DRAW_PRIORITY = -30;

/** The cache group: only the studio's entry, always split (enforce: past minSize and maxInitialRequests), unnamed. */
function studioDrawCacheGroup() {
  return {
    chunks: (chunk) => chunk.name === STUDIO_PAGE_ENTRY,
    test: STUDIO_DRAW_MODULE,
    enforce: true,
    priority: STUDIO_DRAW_PRIORITY,
  };
}

/** Adds the group to a client production webpack config (next.config.ts's hook). Returns whether it did. */
function studioChunkSplit(config, { dev, isServer }) {
  if (dev || isServer) return false;
  const split = config && config.optimization && config.optimization.splitChunks;
  if (!split || typeof split !== "object") return false;
  split.cacheGroups = { ...(split.cacheGroups || {}), studioDraw: studioDrawCacheGroup() };
  return true;
}

module.exports = { STUDIO_PAGE_ENTRY, STUDIO_DRAW_MODULE, STUDIO_DRAW_PRIORITY, studioDrawCacheGroup, studioChunkSplit };
