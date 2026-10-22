/*
 * --- agent-cli --- The agent toolbox's entry for Node: scripts/agent/bundle.mjs bundles this file with esbuild (@ aliased
 * to src, as scripts/viral-bot.mjs bundles the bot) and the CLI and the MCP wrapper import the result. Pure code only: the
 * file system, child processes, the browser and the network stay in scripts/agent/ (so do the owner-run commands' halves,
 * scripts/agent/owner-stats.mjs: the site's code names no statistics vendor). It is toolCore.ts (the tool table, explain,
 * the video analyser: bundled on its own for every call) plus what the engine's tools need – loaded only for modes,
 * simulate, fingerprint, preview and render, so a broken mode never stops guard, explain or analyse.
 */
export * from "./toolCore";
export { simulate, SIMULATE_MAX_SECONDS, type SimulateResult } from "./simulate";
export { jsonView, roundNumber } from "./jsonView";
export { BASELINE_FILE, FINGERPRINT_FRAMES, FINGERPRINT_SEED, diffFingerprint, fingerprintOf, parseBaselineLiteral, type Fingerprint } from "./fingerprint";
export { modeCatalog, modeDetail } from "./modeCatalog";
export { DEFAULT_SEED, normaliseLink, resolveRun } from "./runRequest";
export { MODE_IDS, isModeId } from "@/lib/physics/types";
