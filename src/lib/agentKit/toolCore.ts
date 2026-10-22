/*
 * --- agent-cli --- The agent toolbox's small entry for Node: the tool table and its argument checks, explain, and the video
 * analyser's pure halves – nothing of the engine, the settings or the modes (4 source files instead of about 200).
 * scripts/agent/bundle.mjs bundles it on its own, so the MCP server starts, lists its tools and runs guard, explain and
 * analyse even while an edit has broken the engine or a mode; toolbox.ts (the engine's tools: modes, simulate, fingerprint,
 * preview, render) is bundled only for those calls.
 */
export { AGENT_TOOLS, checkToolArgs, toolSpec, type AgentToolSpec } from "./tools";
export { PINNED_HUB_FILES, explainFailure, testFilesIn, textReadsOf } from "./explain";
// --- agent-cli --- (video analysis) the analyser's pure halves (the app's reference shelf reuses them)
export { PCM_RATE, SAMPLE_BYTES, audioStatsArgs, cutsArgs, infoArgs, lastFramesArgs, pcmArgs, sampleFramesArgs } from "@/lib/videoAnalysis/ffmpegArgs";
export { parseCuts, parseIntegratedLufs, parseMediaInfo, parseSilences, pcmSamples, splitFrames } from "@/lib/videoAnalysis/ffmpegParse";
export { buildVideoFeatures, soundFeatures, type VideoFeatures } from "@/lib/videoAnalysis/features";
