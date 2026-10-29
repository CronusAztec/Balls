import type { PlanOptions } from "@/lib/bot/planner";
import type { EndingStyle, LengthBucket } from "@/lib/bot/playbook";
import type { TemplateFormatId } from "@/lib/bot/templates";
import type { InsightLane } from "./stats";

/*
 * --- learner --- The dials: what the learner may change, as a closed table. Each row has its arms (a closed enum), today's
 * default arm, the plan option it sets, the lanes and platforms it applies to and its finding sentence's message key. A dial
 * only ever picks a plan option the planner already takes, so the learner never writes a setting, a number or a word of its
 * own: every clip is still planned from (options, seed) and searched by the seed finder, inside RANGES.
 *
 * L2 ships four, plus the newcomer test of the format dial:
 *  - length: short 8-15 s, standard 15-30 s, long 60-90 s (PlanOptions.bucket), never long on YouTube Shorts;
 *  - ending: resolved or cliffhanger (PlanOptions.ending), inside each template's endings;
 *  - format: today's mix of every ready format, or one format (PlanOptions.template), the mode inside a format rotating by date;
 *  - newcomer: a template that became ready (the Journey and Spiral Glass first) against its format's rotation: it joins
 *    unless the rotation clearly beats it;
 *  - post time: 12-14, 17-19 or 20-22 local, or today's spread (PlanOptions.postingTime), normal posts only.
 * L3 adds the hook wording, the payoff timing, the caption question, the sound preset and the cover, behind L3_DIALS_ON: their
 * plan options come with lib/bot/planner.ts in the plan's C8 and do not exist yet.
 *
 * The look is not a dial: the crew's gate G6 (a Simple score of at least 60) already keeps every clip Simple. Physics, mode
 * code, the seed, the watermark, the words of captions and hashtags, and TikTok's privacy choices are never dials.
 *
 * Types only are imported, and the lists that mirror the planner's (LENGTH_BUCKETS, ENDING_STYLES, TEMPLATE_FORMAT_IDS) are
 * kept equal by tests/insightsDials.test.ts, so the app's main process can bundle this file to sanitise the decision log.
 */

// --- learner ---

export const DIAL_IDS = ["length", "ending", "format", "newcomer", "postTime", "hook", "payoff", "captionQuestion", "sound", "cover"] as const;
export type DialId = (typeof DIAL_IDS)[number];

/** The length buckets (lib/bot/playbook.ts LENGTH_BUCKETS). */
export const LENGTH_ARMS = ["short", "standard", "long"] as const satisfies readonly LengthBucket[];
/** The endings (playbook ENDING_STYLES). */
export const ENDING_ARMS = ["resolved", "cliffhanger"] as const satisfies readonly EndingStyle[];
/** The template formats (lib/bot/templates.ts TEMPLATE_FORMAT_IDS). */
export const FORMAT_IDS = ["getOut", "smash", "fill", "count", "whoWins", "aim", "lineUp", "onTheBeat", "reveal", "labGame"] as const satisfies readonly TemplateFormatId[];
/** "mix": today's way, every ready format in turn (the studio's formats-first mix); else one format. */
export const FORMAT_ARMS = ["mix", ...FORMAT_IDS] as const;
/** A newcomer test: the format's rotation as it stands, or the newcomer template. */
export const NEWCOMER_ARMS = ["rotation", "newcomer"] as const;
/** "spread": today's way, the day's posts walk the noon, evening and night windows; else one window. */
export const POST_TIME_ARMS = ["spread", "noon", "evening", "night"] as const;
/** L3: the format's hook, hookB or hookC copy. */
export const HOOK_ARMS = ["a", "b", "c"] as const;
/** L3: the payoff late (80-90 % of the clip, today's) or earlier (66-80 %). */
export const PAYOFF_ARMS = ["late", "earlier"] as const;
/** L3: the caption closes with a question (today's) or does not. */
export const QUESTION_ARMS = ["asks", "none"] as const;
/** L3: the built-in sound preset. */
export const SOUND_ARMS = ["piano", "xylophone"] as const;
/** L3: the cover frame: the payoff on screen (the L1 fix for every Reel) or the start of the action. */
export const COVER_ARMS = ["payoff", "start"] as const;

/** The plan options the L2 dials set: each one exists on PlanOptions (a type error otherwise). */
export const L2_OPTIONS = ["bucket", "ending", "template", "postingTime"] as const satisfies readonly (keyof PlanOptions)[];
/** The plan options the L3 dials will set: planned for PlanOptions in the plan's C8, absent until then. */
export const L3_OPTIONS = ["hookVariant", "payoffBand", "captionQuestion", "instrument", "cover"] as const;
export type DialOption = (typeof L2_OPTIONS)[number] | (typeof L3_OPTIONS)[number];

/** The platform families a dial may change posts on (lib/insights/stats.ts platformFamily). */
export type DialPlatform = "instagram" | "tiktok" | "youtube";

export interface Dial {
  id: DialId;
  arms: readonly string[];
  defaultArm: string;
  option: DialOption;
  lanes: readonly InsightLane[];
  platforms: readonly DialPlatform[];
  level: "L2" | "L3";
  /** The clip is planned again for it (the seed search finds the payoff again); post time is free. */
  replan: boolean;
  /** The finding sentence's message key (the Learning card's copy, C6, under Learner.findings in en, pl and es). */
  finding: string;
}

const BOTH: readonly InsightLane[] = ["normal", "trialReel"];
const ALL: readonly DialPlatform[] = ["instagram", "tiktok", "youtube"];

export const DIALS: Readonly<Record<DialId, Dial>> = {
  length: { id: "length", arms: LENGTH_ARMS, defaultArm: "standard", option: "bucket", lanes: BOTH, platforms: ALL, level: "L2", replan: true, finding: "Learner.findings.length" },
  ending: { id: "ending", arms: ENDING_ARMS, defaultArm: "resolved", option: "ending", lanes: BOTH, platforms: ALL, level: "L2", replan: true, finding: "Learner.findings.ending" },
  format: { id: "format", arms: FORMAT_ARMS, defaultArm: "mix", option: "template", lanes: BOTH, platforms: ALL, level: "L2", replan: true, finding: "Learner.findings.format" },
  newcomer: { id: "newcomer", arms: NEWCOMER_ARMS, defaultArm: "rotation", option: "template", lanes: BOTH, platforms: ALL, level: "L2", replan: true, finding: "Learner.findings.newcomer" },
  postTime: { id: "postTime", arms: POST_TIME_ARMS, defaultArm: "spread", option: "postingTime", lanes: ["normal"], platforms: ["instagram", "tiktok"], level: "L2", replan: false, finding: "Learner.findings.postTime" },
  hook: { id: "hook", arms: HOOK_ARMS, defaultArm: "a", option: "hookVariant", lanes: BOTH, platforms: ALL, level: "L3", replan: true, finding: "Learner.findings.hook" },
  payoff: { id: "payoff", arms: PAYOFF_ARMS, defaultArm: "late", option: "payoffBand", lanes: BOTH, platforms: ALL, level: "L3", replan: true, finding: "Learner.findings.payoff" },
  captionQuestion: { id: "captionQuestion", arms: QUESTION_ARMS, defaultArm: "asks", option: "captionQuestion", lanes: ["normal"], platforms: ALL, level: "L3", replan: false, finding: "Learner.findings.captionQuestion" },
  sound: { id: "sound", arms: SOUND_ARMS, defaultArm: "piano", option: "instrument", lanes: BOTH, platforms: ALL, level: "L3", replan: true, finding: "Learner.findings.sound" },
  cover: { id: "cover", arms: COVER_ARMS, defaultArm: "payoff", option: "cover", lanes: BOTH, platforms: ["instagram"], level: "L3", replan: false, finding: "Learner.findings.cover" },
};

/** The L3 dials are off until their plan options exist (the plan's C8). */
export const L3_DIALS_ON = false;

/** The dials in use: the L2 ones, and the L3 ones once switched on. */
export function activeDials(l3: boolean = L3_DIALS_ON): DialId[] {
  return DIAL_IDS.filter((id) => DIALS[id].level === "L2" || l3);
}

/** Whether `arm` is one of the dial's arms. */
export function isDialArm(dial: DialId, arm: unknown): arm is string {
  return typeof arm === "string" && DIALS[dial].arms.includes(arm);
}

export function isDialId(value: unknown): value is DialId {
  return typeof value === "string" && (DIAL_IDS as readonly string[]).includes(value);
}

/**
 * The order questions are asked in, which the owner can skip from (never reorder).
 *  - trialReel: the lab, new and risky changes on strangers first: the newcomers (the Journey and Spiral Glass first), the
 *    length, the format challengers in the order of the crew's pick score, the ending on templates that allow both, then L3.
 *  - normal, while the lab runs: what only followers can tell, post time; the checks of the lab's winners come first.
 *  - normal, without Trial Reels: the whole list, newcomers and formats on at most 1 normal clip in 5.
 */
export const TEST_ORDER = {
  trialReel: ["newcomer", "length", "format", "ending", "hook", "payoff", "sound", "cover"],
  normal: ["postTime", "captionQuestion"],
  normalWithoutTrials: ["length", "ending", "newcomer", "format", "postTime", "hook", "payoff", "captionQuestion", "sound", "cover"],
} as const satisfies Record<string, readonly DialId[]>;

/**
 * The templates the learner treats as newcomers, in the order it tries them: each gets one newcomer test before it joins its
 * format's rotation. Every other ready template is in its format's rotation from the start. Merge Ring and Paddle join this
 * list once their overlays get switches; a caller may also mark a ready template as a newcomer (LearnerTemplate.newcomer).
 */
export const NEWCOMER_TEMPLATES = ["get-out-journey", "smash-spiral-glass"] as const;

/** A template id (kebab-case, as lib/bot/templates.ts templateIdOf writes them). */
export const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/;

/**
 * The key of a question: the dial, its two arms in a fixed order and, for a newcomer, its template. A verdict rests the
 * question whichever arm was the best, so a change that won is not asked back the other way at once.
 */
export function questionKey(dial: DialId, a: string, b: string, subject?: string | null): string {
  const pair = [a, b].sort().join("~");
  return subject ? `${dial}:${pair}:${subject}` : `${dial}:${pair}`;
}

/** The challengers of a dial whose best is `best`, in the order they are asked (the format's by `formatOrder`). */
export function challengersOf(dial: DialId, best: string, formatOrder: readonly string[] = FORMAT_IDS): string[] {
  switch (dial) {
    case "format":
      return [...formatOrder.filter((f) => f !== best && f !== "mix"), ...(best !== "mix" ? ["mix"] : [])];
    case "newcomer":
      return [];
    case "postTime":
      return [...POST_TIME_ARMS.filter((a) => a !== best && a !== "spread"), ...(best !== "spread" ? ["spread"] : [])];
    default:
      return DIALS[dial].arms.filter((a) => a !== best);
  }
}

// --- end learner ---
