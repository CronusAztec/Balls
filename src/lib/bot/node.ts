/*
 * --- viral-bot --- The planner's entry for Node: scripts/viral-bot.mjs bundles this file with esbuild (a dev dependency of
 * vitest) and imports the result, so its --dry-run plans exactly what the page plans, without a browser.
 */
export { planDay, planDaySteps, dayIndexOf, localIsoDate, parseIsoDate, scoreClip, type ClipPlan, type DayPlan } from "./planner";
export { batchTextFiles, buildManifest, captionFileName, reasonText, MANIFEST_FILE, SCHEDULE_FILE, type RenderedClip } from "./output";
export { BOT_FAMILIES, BOT_PLATFORMS, ENDING_CHOICES, LENGTH_BUCKETS, RECIPES, isBotFamily, isBotPlatform, isEndingChoice, isLengthBucket } from "./playbook";
export { BOT_LOCALES, isBotLocale, copyString } from "./copy";
export { DEFAULT_BOT_WORLD } from "./finderRequest";
export { INSTAGRAM_ENV, InstagramError, instagramConfigFromEnv, publicVideoUrl, publishReel, redact } from "./instagram";
export { RelayClient, RelayError } from "@/lib/publish/relayClient"; // --- social-publish --- the CLI's --relay path
