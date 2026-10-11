/*
 * --- viral-bot --- The planner's entry for Node: scripts/viral-bot.mjs bundles this file with esbuild (a dev dependency of
 * vitest) and imports the result, so its --dry-run plans exactly what the page plans, without a browser.
 */
export { planDay, planDaySteps, dayIndexOf, localIsoDate, parseIsoDate, scoreClip, type ClipPlan, type DayPlan } from "./planner";
export { daySlots, resolveBucket } from "./planner"; // --- fl-overhaul --- (Stage 6) the CLI's --plan: the week's rotation, no simulation
export { batchTextFiles, buildManifest, captionFileName, reasonText, MANIFEST_FILE, SCHEDULE_FILE, type RenderedClip } from "./output";
export { BOT_FAMILIES, BOT_PLATFORMS, ENDING_CHOICES, LENGTH_BUCKETS, RECIPES, isBotFamily, isBotPlatform, isEndingChoice, isLengthBucket } from "./playbook";
export { BOT_LOCALES, isBotLocale, copyString } from "./copy";
export { DEFAULT_BOT_WORLD } from "./finderRequest";
export { INSTAGRAM_ENV, InstagramError, instagramConfigFromEnv, publicVideoUrl, publishReel, redact } from "./instagram";
export { RelayClient, RelayError } from "@/lib/publish/relayClient"; // --- social-publish --- the CLI's --relay path
// --- paywall-gate --- the CLI reads BOT_LICENSE's plan and end before it starts (--- low-findings --- rendering needs no licence:
// without a Pro one the clips carry the free-video watermark, free-watermark's gate decides – lib/watermark/seal.ts)
export { decodeLicense, licenseExpired } from "@/lib/billing/license";
export { coverFrameOf } from "./cover"; // --- mode-thumbnails --- the clips' cover frames (Instagram's thumb_offset, the relay's coverMs)
export { LICENSE_STORAGE_KEY } from "@/lib/billing/config";
