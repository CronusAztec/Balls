import { isBotFamily, isBotPlatform, isEndingChoice, isLengthBucket, type BotFamily, type BotPlatform, type EndingChoice, type LengthBucket } from "./playbook";
import { BOT_PLAN_VERSION, type ClipPlan } from "./planner";
import { CLIP_CEILING } from "@/lib/uncap"; // --- uncap-all ---

/*
 * --- viral-bot --- The Bot section's options and its last plan, kept in this browser's localStorage (a convenience: every
 * read and write is wrapped, the panel works without storage). Plans carry their whole settings, so a stored plan opens,
 * re-rolls and renders exactly as it was planned.
 */

export const BOT_STORAGE_KEY = "jumpingballslive_viral_bot";
export const BOT_COUNT_RANGE = { min: 1, max: 20, step: 1 } as const;

export interface BotOptions {
  platform: BotPlatform;
  count: number;
  family: BotFamily | "all";
  bucket: LengthBucket | "auto";
  ending: EndingChoice;
}

export interface BotStoredPlan {
  /** The day it was planned for ("YYYY-MM-DD"). */
  date: string;
  platform: BotPlatform;
  /** "today": the canonical daily plan; "custom": planned with the panel's filters. */
  kind: "today" | "custom";
  clips: ClipPlan[];
}

export interface BotState {
  options: BotOptions;
  plan: BotStoredPlan | null;
}

export function defaultBotOptions(): BotOptions {
  return { platform: "reels", count: 3, family: "all", bucket: "auto", ending: "auto" };
}

/** Stored options, validated: unknown values fall back to the defaults, the count is clamped. */
export function parseBotOptions(raw: unknown): BotOptions {
  const d = defaultBotOptions();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const count = Math.round(Number(r.count));
  return {
    platform: isBotPlatform(r.platform) ? r.platform : d.platform,
    count: Number.isFinite(count) ? (count < BOT_COUNT_RANGE.min ? BOT_COUNT_RANGE.min : count > CLIP_CEILING ? CLIP_CEILING : count) : d.count, // --- uncap-all --- (the slider's 20 is a comfort bound; the clips' memory-safety ceiling)
    family: r.family === "all" || isBotFamily(r.family) ? r.family : d.family,
    bucket: r.bucket === "auto" || isLengthBucket(r.bucket) ? r.bucket : d.bucket,
    ending: isEndingChoice(r.ending) ? r.ending : d.ending,
  };
}

const looksLikePlan = (value: unknown): value is ClipPlan => {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ClipPlan>;
  return p.version === BOT_PLAN_VERSION && typeof p.id === "string" && typeof p.recipe === "string" && typeof p.seed === "number" && !!p.settings && typeof p.settings === "object" && Array.isArray(p.captionRoles);
};

/** A stored state, validated (plans of another version are dropped). */
export function parseBotState(raw: unknown): BotState {
  const state: BotState = { options: defaultBotOptions(), plan: null };
  if (!raw || typeof raw !== "object") return state;
  const r = raw as Record<string, unknown>;
  state.options = parseBotOptions(r.options);
  const plan = r.plan as Partial<BotStoredPlan> | null | undefined;
  if (plan && typeof plan === "object" && typeof plan.date === "string" && isBotPlatform(plan.platform) && Array.isArray(plan.clips)) {
    const clips = plan.clips.filter(looksLikePlan);
    if (clips.length > 0) state.plan = { date: plan.date, platform: plan.platform, kind: plan.kind === "today" ? "today" : "custom", clips };
  }
  return state;
}

export function loadBotState(): BotState {
  if (typeof window === "undefined") return parseBotState(null);
  try {
    const raw = localStorage.getItem(BOT_STORAGE_KEY);
    return parseBotState(raw ? JSON.parse(raw) : null);
  } catch {
    return parseBotState(null);
  }
}

export function saveBotState(state: BotState): void {
  try {
    localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage disabled or full: the plan lives until the page is closed */
  }
}
