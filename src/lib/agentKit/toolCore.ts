/*
 * --- agent-cli --- The agent toolbox's small entry for Node: the tool table and its argument checks, explain, the video
 * analyser's pure halves and (--- inspiration ---) the inspiration tools' – yt-dlp's command lines and parsers, the frames'
 * ffmpeg lines, the report – nothing of the engine, the settings or the modes (10 source files instead of about 200).
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
// --- inspiration --- trending, fetch-video, frames and inspire: the video sources (yt-dlp), the frames and the report
export { DEFAULT_QUERY, SHORT_MAX_SEC, checkQuery, checkVideoUrl, hasNumbers, mergeMeta, parseJsonLines, rankVideos, searchTarget, shortsFeedUrl, shortsFeedUrls, videoFileName, videoMetaOf, ytDownloadArgs, ytErrorLines, ytInfoArgs, ytListArgs, type VideoMeta } from "./videoSources";
export { FRAME_WIDTH, HOOK_SEC, HOOK_STEP_SEC, SHEET_TILE_WIDTH, frameArgs, frameTimes, hookTimes, sheetArgs, sheetGrid } from "@/lib/videoAnalysis/ffmpegArgs";
export { buildInspirationReport, datasetAppend, datasetRecord, inspirationMarkdown, runFolderName, stillsColour } from "./inspiration";
// --- inspiration --- the stills fallback: a video's public stills when its download is refused
export { STILLS_HOST, stillsAspect, videoStills } from "./videoSources";
export { STILL_WIDTH, stillArgs, stillSampleArgs } from "@/lib/videoAnalysis/ffmpegArgs";
// --- trends --- the trend summary of inspire reports (npm run trends, scripts/trends.mjs)
export { buildTrendSummary } from "./trends";
export { validateTrends } from "@/lib/trends";
