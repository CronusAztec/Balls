/*
 * --- agent-cli --- The agent toolbox's entry for Node: scripts/agent/bundle.mjs bundles this file with esbuild (@ aliased
 * to src, as scripts/viral-bot.mjs bundles the bot) and the CLI and the MCP wrapper import the result. Pure code only: the
 * file system, child processes, the browser and the network stay in scripts/agent/ (so do the owner-run commands' halves,
 * scripts/agent/owner-stats.mjs: the site's code names no statistics vendor).
 */
export { AGENT_TOOLS, checkToolArgs, toolSpec, type AgentToolSpec } from "./tools";
export { simulate, SIMULATE_MAX_SECONDS, type SimulateResult } from "./simulate";
export { jsonView, roundNumber } from "./jsonView";
export { BASELINE_FILE, FINGERPRINT_FRAMES, FINGERPRINT_SEED, diffFingerprint, fingerprintOf, parseBaselineLiteral, type Fingerprint } from "./fingerprint";
export { modeCatalog, modeDetail } from "./modeCatalog";
export { PINNED_HUB_FILES, explainFailure, testFilesIn, textReadsOf } from "./explain";
export { DEFAULT_SEED, normaliseLink, resolveRun } from "./runRequest";
export { MODE_IDS, isModeId } from "@/lib/physics/types";
// --- agent-cli --- (video analysis) the analyser's pure halves (the app's reference shelf reuses them)
export { PCM_RATE, SAMPLE_BYTES, audioStatsArgs, cutsArgs, infoArgs, lastFramesArgs, pcmArgs, sampleFramesArgs } from "@/lib/videoAnalysis/ffmpegArgs";
export { parseCuts, parseIntegratedLufs, parseMediaInfo, parseSilences, pcmSamples, splitFrames } from "@/lib/videoAnalysis/ffmpegParse";
export { buildVideoFeatures, soundFeatures, type VideoFeatures } from "@/lib/videoAnalysis/features";
