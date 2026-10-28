import { defaultCaption, isOpenEnded, type Caption } from "@/lib/captions";
import { captionBaseFont, drain, endHoldsSec, hasTopHud, payoffSecOf, scoreClip, simulateFactsSteps, type CaptionRole, type ClipPlan, type RunFacts, type ScoreReason } from "@/lib/bot/planner";
import { BOT_FRAME, BOT_PLATFORMS, HOOK_SEC, PLATFORMS, RECIPES, type BotPlatform, type BotRecipe, type CountdownKind, type EndingStyle, type LengthBucket } from "@/lib/bot/playbook";
import { DEFAULT_BOT_WORLD, finderRequestOfSettings, type BotWorld } from "@/lib/bot/finderRequest";
import { settingsFromSearchParams, type SimulatorSettings } from "@/lib/settings";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";
import { recordingTextLayout } from "@/lib/recording/recorder";
import { linkParams } from "@/lib/recording/batch"; // --- insights --- (review fix) a Library clip's link, read for the hook it draws
import { SHARE_CODE_PARAM } from "@/lib/shareCode";
import { bucketOfPlannedLength, bucketOfSeconds, genesWithScore, type ClipGenes, type ClipGenesFeatures } from "./genes";

/*
 * --- insights --- A score on every clip (C6 part 2): the viral bot's 0–100 checklist score (lib/bot/planner.ts scoreClip,
 * docs/virality-playbook.md §3) for a clip scored from its settings and its run, so it gets the same score and the same
 * reasons as a planned clip: a link's or the page's setup with a seed, and an AI clip (its plan as the AI's tools left it:
 * set_clip_settings and find_simulation change what the run plays, so the plan's own facts are not the file's). scoreClip
 * itself is untouched: `planLikeFromSettings()` builds the few fields of a ClipPlan it reads (`ScorePlan`;
 * tests/insightsScore.test.ts proves it reads no other) from the settings and the facts.
 *
 * What the plan-like holds:
 *  - the captions' roles, inferred: a counter caption (it shows a live number: its [time], [n] / [total] or [pct]) is the
 *    countdown; else a caption that enters inside the hook's window (before 3 s, HOOK_SEC.max) is the hook – scoreClip
 *    grades one that enters after 0.05 s as badly timed (hookTiming), so a hook entering at 0.3 s is still a hook; else a
 *    question caption, or one that asks something, is the closing question while it is on screen at the clip's end (the
 *    bot's own enters 2 s before it and stays) and the payoff's words when it has left by then; a caption with a number
 *    token (a digit) is the countdown, and the rest the payoff's words (scoreClip reads no payoff role). A clip with no hook
 *    caption and a Top Text has that line as its hook (`hookedSettings()`): the viral bot's Top Text is its series label,
 *    the page's one-liner on top is what a viewer reads first. A caption that enters at or after the clip's end is never on
 *    screen: it is none of these (the payoff's words), whatever it says. The hook these roles give is the one the clip's
 *    genes describe (`drawnHookOf()`);
 *  - the plan's recipe where it has one that plays the mode, else the mode's recipe in the playbook (the first that plays
 *    it): its payoff strategy, whether the mode's own notes are the melody and the recurring cast its series uses. No recipe
 *    plays the mode: the payoff is the run's own end;
 *  - the facts: when the first impact comes, when the payoff comes and how long the clip is. The ending follows from them:
 *    a clip cut before the result has its payoff after its end, or none inside it and a question on screen at its end; a
 *    planned cliffhanger (ScoreContext.ending) with its question on screen at its end stays one with its payoff inside it
 *    (it shows the result, then asks for it: the planner's payoffCutWrong); any other clip is resolved. A payoff more than
 *    3 s after the end (SCORE_PAYOFF_REACH_SEC, as far as scoreClip grades a cut) counts as none, whatever times it: the run
 *    is followed no further, and a payoff a strategy knows without one (a pendulum's cycle) is read the same way. A payoff
 *    inside the clip comes at its end at the latest: the run's 1/60 s steps add up to a hair past a whole second, so a run
 *    that ends with the clip has its payoff at its last frame, 100 % in, never past it;
 *  - the platform the clip is for (else the one whose default bucket is the clip's), its series day and its melody, and the
 *    bucket: a plan's while the clip is the length it was planned at or its length fits it, else the bucket of the clip's
 *    length.
 * A clip that is not part of the series (series day 0) has no series label: its series item reads no Top or Bottom Text
 * (`scorePlanLike()`), so a one-off clip is never "part of a series".
 *
 * The facts come from the planner's own simulation of the seed (`simulateFacts`, here in slices so the page stays
 * responsive: `runFactsOf()`), which needs no export, and from the fast export's measurement of the file (ClipFeatures,
 * lib/recording/clipFeatures.ts): the file's real length, and its first motion or sound where the run heard no impact. The
 * export measures no payoff (nothing in its pixels says which moment it is), so a clip is scored only with a run.
 *
 * The score is the playbook's, not yet measured on the channel: advice, shown as a chip with its reasons (ScoreChip.tsx),
 * never a gate on posting. Pure but for `runFactsOf()`'s pauses (its clock times the slices, never the run).
 */

// --- insights ---

/** A hook that enters this early (s) is on screen from the start: scoreClip's own test (later inside the window it is a hook scored as badly timed). */
export const HOOK_START_SEC = 0.05;
/**
 * A caption that enters before this (s) is the hook: inside the 2–3 s the hook is on screen (HOOK_SEC.max). Strictly before:
 * the planner's own payoff line and closing question enter at 3 s at the earliest (its hook's end, 2.5 s or more, + 0.5 s).
 */
export const HOOK_WINDOW_SEC = HOOK_SEC.max;
/** The caption types that show a live number: the countdown. */
export const COUNTER_CAPTIONS = ["countdown", "wallCounter", "progress"] as const satisfies readonly Caption["type"][];
/** The countdown a counter caption shows (playbook COUNTDOWN_KINDS). */
const COUNTER_KIND: Record<(typeof COUNTER_CAPTIONS)[number], CountdownKind> = { countdown: "timer", wallCounter: "walls", progress: "percent" };
/** A number token in a caption's words: a counter's placeholder or a digit ("3 walls left"). */
const NUMBER_TOKEN = /\[(?:time|n|total|pct)\]|\p{Nd}/u;
const ASKS = /[?？¿]/;
/** How far past the clip's end scoreClip grades a payoff (s): up to 3 s after the cut, a clip "cut a little early" (payoffCutFar). Farther: none inside the clip. */
export const SCORE_PAYOFF_REACH_SEC = 3;
/** Ball Drop's rest (s, planner.ts DROP_REST_SEC): its run ends a second after its last ball landed, its payoff. */
const DROP_REST_SEC = 1;
/**
 * How far past the clip's end the run is followed (s): as far as a payoff is graded (SCORE_PAYOFF_REACH_SEC), and Ball Drop's
 * rest past that, since its payoff is known only when its run ends a second later. A payoff right after the cut is a clip cut
 * before it.
 */
export const SCORE_RUN_MARGIN_SEC = SCORE_PAYOFF_REACH_SEC + DROP_REST_SEC;
/** A caption that ends this close before the clip's end (s) is still on screen at the end (rounding). */
const END_SLACK_SEC = 1e-6;
/** Wall-clock ms `runFactsOf()` simulates before it lets the page breathe (the seed finder's frame budget). */
export const SCORE_SLICE_MS = 12;

/** The fields of a ClipPlan that scoreClip reads (and only those). */
export type ScorePlan = Pick<ClipPlan, "settings" | "recipe" | "platform" | "bucket" | "ending" | "episode" | "melodyId" | "captionRoles"> & {
  countdown: Pick<ClipPlan["countdown"], "kind" | "source">;
  timing: Pick<ClipPlan["timing"], "clipSec" | "firstImpactSec">;
  payoff: Pick<ClipPlan["payoff"], "atSec" | "position" | "cutGapSec">;
};
/** ScorePlan's fields, the nested ones as `parent.field` (tests/insightsScore.test.ts checks scoreClip reads these alone). */
export const SCORE_PLAN_FIELDS = ["settings", "recipe", "platform", "bucket", "ending", "episode", "melodyId", "captionRoles", "countdown.kind", "countdown.source", "timing.clipSec", "timing.firstImpactSec", "payoff.atSec", "payoff.position", "payoff.cutGapSec"] as const;

/** What a clip did, as the score reads it (s). */
export interface ScoreFacts {
  /** When the first impact comes: the run's first sound event, else the export's first motion or sound; null: not measured. */
  firstImpactSec: number | null;
  /** When the payoff comes (after `clipSec` for a clip cut before it); null: none within the run followed. */
  payoffSec: number | null;
  /** The clip's length: the file's, else the run's own end with the page's holds, at most the clip length; null: the clip length. */
  clipSec: number | null;
}

/** What the score knows of a clip besides its settings and facts. */
export interface ScoreContext {
  /** The platform it is for (a bot plan's, a platform preset's); null: the platform whose default bucket is the clip's. */
  platform?: BotPlatform | null;
  /** The bot series' day (0 or null: not part of the series). */
  episode?: number | null;
  /** The melody it plays (the genes' `melody`): a built-in melody id, "ladder" (the mode's own notes), "none"; null: not known. */
  melody?: string | null;
  /** The plan's recipe (a RECIPES id, the genes' `recipe`): scored with it while it plays the clip's mode; null: the mode's own. */
  recipe?: string | null;
  /** The bucket the clip was planned for: kept while the clip's length fits it (genes.ts bucketKept); null: the length's own. */
  bucket?: LengthBucket | null;
  /**
   * --- insights --- (review fix) The length the clip was planned at (s, the genes' `durationSec`): at a clip length within
   * GENE_BUCKET_SLACK_SEC of it the planned bucket is kept even where the length is outside it, as the bot scores its plan
   * (lengthOut: genes.ts bucketOfPlannedLength); null: kept only while the length fits it.
   */
  bucketSec?: number | null;
  /**
   * --- insights --- (review fix) The ending the clip was planned with (the genes' `ending`): a cliffhanger with its question on
   * screen at its end stays one with its payoff inside the clip, as the planner scores that plan; null: the ending follows from
   * where the payoff falls (see the header).
   */
  ending?: EndingStyle | null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The roles of a clip's captions (see the header): what scoreClip reads as its hook, countdown and closing question.
 * `clipSec`: the clip's length, so a question that stays to it is on screen at the end; without one only a caption that stays
 * to the end of the run (no end of its own) is. A caption that enters at or after the clip's end is never on screen in it
 * (lib/captions.ts captionPhase: nothing of it before its start), so it is the payoff's words, a role scoreClip reads nothing
 * of: never the hook, the countdown or the closing question (an AI clip set_clip_settings cut short keeps its plan's captions).
 */
export function captionRolesOf(captions: readonly Pick<Caption, "type" | "text" | "start" | "end">[], clipSec?: number | null): CaptionRole[] {
  const atEnd = (c: Pick<Caption, "start" | "end">) => isOpenEnded(c) || (finite(clipSec) && c.end >= clipSec - END_SLACK_SEC);
  const unseen = (c: Pick<Caption, "start">) => finite(clipSec) && c.start >= clipSec - END_SLACK_SEC; // --- insights --- (review fix)
  return captions.map((c) => {
    if (unseen(c)) return "payoff";
    if ((COUNTER_CAPTIONS as readonly string[]).includes(c.type)) return "countdown";
    if (c.start < HOOK_WINDOW_SEC) return "hook";
    if (c.type === "question") return atEnd(c) ? "question" : "payoff";
    if (NUMBER_TOKEN.test(c.text)) return "countdown";
    if (ASKS.test(c.text)) return atEnd(c) ? "question" : "payoff";
    return "payoff";
  });
}

/** The playbook recipe of a mode: the first that plays it (the playbook's order: Ring Escape for Classic and Portal); null for none. */
export function scoreRecipeOf(mode: SimulatorSettings["mode"]): BotRecipe | null {
  return RECIPES.find((r) => r.modes.includes(mode)) ?? null;
}

/** The recipe a clip is scored with: the plan's (`id`) while it plays the mode (the AI may have changed the mode), else the mode's own. */
export function scoreRecipeFor(mode: SimulatorSettings["mode"], id?: string | null): BotRecipe | null {
  return (id ? RECIPES.find((r) => r.id === id && r.modes.includes(mode)) : undefined) ?? scoreRecipeOf(mode);
}

/**
 * The settings and caption roles scoreClip reads for a clip: its captions' inferred roles and, for a clip with no hook caption
 * and a Top Text, that line as its hook – a top caption of the Top Text's size, on screen from the start for the whole clip,
 * moved out of the series label's slot (the Top Text is drawn on top: the recorder's line). Not over an arena game's
 * scoreboard: there the Top Text covers the band and neither can be read, as scoreClip says (seriesCovered, countdownHudCovered).
 * `clipSec`: the clip's length (captionRolesOf).
 */
export function hookedSettings(settings: SimulatorSettings, clipSec?: number | null): { settings: SimulatorSettings; roles: CaptionRole[] } {
  const roles = captionRolesOf(settings.captions, clipSec);
  const top = settings.topText.trim();
  if (!top || roles.includes("hook") || hasTopHud(settings.mode)) return { settings, roles };
  const base = defaultCaption("text", { text: top });
  // the recorder's Top Text size over the captions' base size, in the frame scoreClip measures
  const size = recordingTextLayout(BOT_FRAME.width, BOT_FRAME.height, settings.textSize).fontSize / captionBaseFont(Math.min(BOT_FRAME.width, BOT_FRAME.height));
  const hook: Caption = { ...base, position: "top", start: 0, end: 0, style: { ...base.style, size } };
  return { settings: { ...settings, topText: "", captions: [hook, ...settings.captions] }, roles: ["hook", ...roles] };
}

// --- insights --- (review fix) the hook a clip draws: what its genes describe and a cut of it is told apart from
/**
 * The hook a clip draws, as the score reads it (`hookedSettings()`): the words of its hook captions, joined as scoreClip joins
 * them, else its Top Text where that line is its hook (no hook caption, no arena scoreboard under it); null for none. A bot
 * plan's is its hook (its hook captions are its lines); an AI clip's is its plan's, as the AI's tools left the plan
 * (set_clip_settings changes no caption), never the AI's own hook, which only the TikTok cut's card shows. `clipSec`: the
 * clip's length (captionRolesOf; the settings' clip length when absent).
 */
export function drawnHookOf(settings: SimulatorSettings, clipSec?: number | null): string | null {
  const { settings: hooked, roles } = hookedSettings(settings, finite(clipSec) && clipSec > 0 ? clipSec : settings.recordingDuration);
  const text = hooked.captions
    .filter((c, i) => roles[i] === "hook" && c)
    .map((c) => c.text)
    .join(" ")
    .trim();
  return text || null;
}

/**
 * The hook a Library clip shows, which the Clip editor's cut of it is told apart from (genes.ts genesOfEditorCut): a TikTok
 * cut's is its card's, its meta's hook; a master's is the hook its settings draw, read from its link (`drawnHookOf()`: an AI
 * clip's meta hook is the AI's own, drawn on its cut's card alone, and a page clip's Top Text is its hook only without a hook
 * caption). A link this cannot read at once (a short `?c=` link: its code is decoded later) gives the meta's hook.
 */
export function shownHookOf(clip: { hook?: string | null; link?: string | null; genes?: Pick<ClipGenes, "cut"> | null } | null | undefined): string | null {
  if (!clip) return null;
  const params = clip.genes?.cut !== "tiktok" && clip.link ? linkParams(clip.link) : null;
  if (!params || params.has(SHARE_CODE_PARAM)) return clip.hook ?? null;
  return drawnHookOf(settingsFromSearchParams(params));
}
// --- end insights ---

/** The platform a clip of this bucket suits best: the one whose default bucket it is, else the first it fits. */
export function platformForBucket(bucket: LengthBucket): BotPlatform {
  return BOT_PLATFORMS.find((p) => PLATFORMS[p].defaultBucket === bucket) ?? BOT_PLATFORMS.find((p) => PLATFORMS[p].buckets.includes(bucket)) ?? BOT_PLATFORMS[0];
}

/** The platform of a render-queue clip: its meta's, else its output preset's when that is one (TikTok, Reels, Shorts). */
export function platformOf(platform: string | null | undefined, preset?: string | null): BotPlatform | null {
  const named = (BOT_PLATFORMS as readonly string[]).includes(platform ?? "") ? (platform as BotPlatform) : null;
  return named ?? ((BOT_PLATFORMS as readonly string[]).includes(preset ?? "") ? (preset as BotPlatform) : null);
}

/**
 * The plan-like scoreClip reads for a clip made from settings: the inferred caption roles, the mode's recipe, the ending
 * from where the payoff falls, the bucket of the clip's length and the context (see the header).
 */
export function planLikeFromSettings(clipSettings: SimulatorSettings, facts: ScoreFacts, context: ScoreContext = {}): ScorePlan {
  const recipe = scoreRecipeFor(clipSettings.mode, context.recipe);
  const clipSec = finite(facts.clipSec) && facts.clipSec > 0 ? facts.clipSec : clipSettings.recordingDuration;
  const bucket = (context.bucket ? bucketOfPlannedLength(context.bucket, context.bucketSec, clipSec) : bucketOfSeconds(clipSec)) ?? "short"; // --- insights --- (review fix) (the plan's length)
  // (a payoff past scoreClip's reach is none inside the clip, for every strategy: see the header)
  const payoff = finite(facts.payoffSec) && facts.payoffSec >= 0 && facts.payoffSec - clipSec <= SCORE_PAYOFF_REACH_SEC ? facts.payoffSec : null;
  const { settings, roles } = hookedSettings(clipSettings, clipSec);
  // cut before the result: the payoff after the clip's end, or none inside it and the clip ends on a question (the bot's never-escapes cut)
  const asks = roles.some((r, i) => r === "question" && settings.captions[i]);
  // --- insights --- (review fix) a planned cliffhanger asking at its end with its payoff inside the clip: the result, then the question
  const cut = payoff !== null ? payoff > clipSec + 1e-9 || (context.ending === "cliffhanger" && asks) : asks;
  // --- insights --- (review fix) a payoff inside the clip comes at its last frame at the latest (the steps' sum runs a hair past it)
  const at = payoff === null ? null : cut ? payoff : Math.min(payoff, clipSec);
  const counter = settings.captions[roles.indexOf("countdown")];
  const counterKind = counter && (COUNTER_CAPTIONS as readonly string[]).includes(counter.type) ? COUNTER_KIND[counter.type as (typeof COUNTER_CAPTIONS)[number]] : null;
  const melody = context.melody && context.melody !== "none" ? context.melody : null;
  return {
    settings,
    recipe: recipe?.id ?? "",
    platform: context.platform ?? platformForBucket(bucket),
    bucket,
    ending: cut ? "cliffhanger" : "resolved",
    episode: finite(context.episode) ? context.episode : 0,
    melodyId: melody, // ("ladder" counts as a melody, as a recipe whose mode plays its own notes does)
    captionRoles: roles,
    countdown: { kind: counterKind ?? recipe?.countdown.kind ?? "timer", source: counter ? "caption" : "hud" },
    timing: { clipSec, firstImpactSec: finite(facts.firstImpactSec) && facts.firstImpactSec >= 0 ? facts.firstImpactSec : null },
    payoff: at === null ? { atSec: null, position: null, cutGapSec: null } : { atSec: at, position: at / clipSec, cutGapSec: cut ? at - clipSec : null },
  };
}

/** When scoreClip looks at where the hook sits (s): its box at 0.1 s (planner.ts captionBoxAt). */
export const HOOK_LOOK_SEC = 0.1;

/**
 * scoreClip's verdict on a plan-like (it reads only ScorePlan's fields), with two items read as the clip shows them:
 *  - a clip that is not part of the series (series day 0) has no series label: its series item is scoreClip's on the same
 *    plan-like without its Top and Bottom Text, so its line on screen never makes it "part of a series" (a line over an
 *    arena game's scoreboard still covers it: that verdict stands);
 *  - a hook that enters after scoreClip's look at 0.1 s (HOOK_LOOK_SEC) is not on screen there, which scoreClip would read as
 *    a hook outside the safe zone: its hook item is scoreClip's with that hook on screen from 0.1 s, so where it sits is
 *    measured and its late start still costs it the timing (it never enters by 0.05 s: hookTiming at best).
 * scoreClip itself is untouched; the total is the items' sum.
 */
export function scorePlanLike(plan: ScorePlan): { score: number; reasons: ScoreReason[] } {
  const scored = scoreClip(plan as unknown as ClipPlan);
  const itemOf = (id: string, like: ScorePlan) => scoreClip(like as unknown as ClipPlan).reasons.find((r) => r.id === id);
  let reasons = scored.reasons;
  const swap = (id: string, reason: ScoreReason | undefined) => {
    if (reason) reasons = reasons.map((r) => (r.id === id ? reason : r));
  };
  const own = scored.reasons.find((r) => r.id === "series");
  if (plan.episode < 1 && own && own.key !== "seriesCovered") swap("series", itemOf("series", { ...plan, settings: { ...plan.settings, topText: "", bottomText: "" } }));
  const late = plan.captionRoles.map((r, i) => r === "hook" && plan.settings.captions[i] && plan.settings.captions[i].start > HOOK_LOOK_SEC);
  if (late.some(Boolean)) swap("hook", itemOf("hook", { ...plan, settings: { ...plan.settings, captions: plan.settings.captions.map((c, i) => (late[i] ? { ...c, start: HOOK_LOOK_SEC } : c)) } }));
  return reasons === scored.reasons ? scored : { score: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

/** The playbook's score of a clip made from settings: scoreClip on `planLikeFromSettings()`. */
export function scoreOfSettings(settings: SimulatorSettings, facts: ScoreFacts, context: ScoreContext = {}): { score: number; reasons: ScoreReason[] } {
  return scorePlanLike(planLikeFromSettings(settings, facts, context));
}

/** The facts of a run the planner simulated (simulateFacts): its first impact, its payoff by the recipe's strategy, its length. */
export function factsOfRun(settings: SimulatorSettings, run: RunFacts, recipe: Pick<BotRecipe, "strategy">): ScoreFacts {
  const ownEnd = run.finishSec >= 0 ? run.finishSec + endHoldsSec(settings) : Infinity;
  return { firstImpactSec: run.firstImpactSec >= 0 ? run.firstImpactSec : null, payoffSec: payoffSecOf(recipe, settings, run), clipSec: Math.min(settings.recordingDuration, ownEnd) };
}

/** What the fast export measured that the score reads: the file's length and its first motion or sound (the earlier). */
export function factsOfExport(features: Pick<ClipFeatures | ClipGenesFeatures, "firstMotionSec" | "firstSoundSec"> | null | undefined, durationSec: number | null | undefined): Pick<ScoreFacts, "firstImpactSec" | "clipSec"> {
  const firsts = [features?.firstMotionSec, features?.firstSoundSec].filter((v): v is number => finite(v) && v >= 0);
  return { firstImpactSec: firsts.length ? Math.min(...firsts) : null, clipSec: finite(durationSec) && durationSec > 0 ? durationSec : null };
}

/** The run's facts with the export's: the file's length over the run's estimate, the run's first impact over the export's first motion. */
export function mergeFacts(run: ScoreFacts, measured: Pick<ScoreFacts, "firstImpactSec" | "clipSec"> | null): ScoreFacts {
  return { firstImpactSec: run.firstImpactSec ?? measured?.firstImpactSec ?? null, payoffSec: run.payoffSec, clipSec: measured?.clipSec ?? run.clipSec };
}

/** The strategy the score times a clip's payoff with: its recipe's (the plan's while it plays the mode), else the run's own end. */
const strategyOf = (mode: SimulatorSettings["mode"], recipe?: string | null): Pick<BotRecipe, "strategy"> => ({ strategy: scoreRecipeFor(mode, recipe)?.strategy ?? "finish" });

/** The planner's simulation of a clip's seed (the finder's request for the settings in `world`), followed SCORE_RUN_MARGIN_SEC past its length. */
function runSteps(settings: SimulatorSettings, seed: number, world: BotWorld | null | undefined, clipSec?: number | null, recipe?: string | null) {
  const horizon = (finite(clipSec) && clipSec > 0 ? Math.max(clipSec, settings.recordingDuration) : settings.recordingDuration) + SCORE_RUN_MARGIN_SEC;
  const request = finderRequestOfSettings(settings, world ?? DEFAULT_BOT_WORLD, horizon);
  return simulateFactsSteps(request, seed, strategyOf(settings.mode, recipe), horizon);
}

/** The facts of a clip's run, in one go (tests, the CLI); `recipe`: the plan's, as in RunFactsOptions. */
export function runFactsSync(settings: SimulatorSettings, seed: number, world?: BotWorld | null, recipe?: string | null): ScoreFacts {
  const steps = runSteps(settings, seed, world, undefined, recipe);
  for (;;) {
    const next = steps.next();
    if (next.done) return factsOfRun(settings, next.value, strategyOf(settings.mode, recipe));
  }
}

// --- crew ---
/**
 * The run itself (the planner's RunFacts: the winner, the first escape, the finish – what the score's facts leave out), in one
 * go: the run runFactsSync() reads, followed past `clipSec` when given (the file's length). The crew's rules and dossier read it
 * (lib/crew/clip.ts).
 */
export function runSync(settings: SimulatorSettings, seed: number, world?: BotWorld | null, recipe?: string | null, clipSec?: number | null): RunFacts {
  return drain(runSteps(settings, seed, world, clipSec, recipe));
}

/** The run of a clip's seed in slices, as runFactsOf() follows it (the same pauses); null when `signal` aborts it. */
export async function runOf(settings: SimulatorSettings, seed: number, options: RunFactsOptions = {}): Promise<RunFacts | null> {
  const now = options.now ?? clock;
  const pause = options.pause ?? breathe;
  const steps = runSteps(settings, seed, options.world, options.clipSec, options.recipe);
  let mark = now();
  for (;;) {
    if (options.signal?.aborted) return null;
    const next = steps.next();
    if (next.done) return next.value;
    if (now() - mark >= SCORE_SLICE_MS) {
      await pause();
      mark = now();
    }
  }
}
// --- end crew ---

export interface RunFactsOptions {
  /** The world the page simulates in (its canvas in CSS px), so the run is the one the export played; 800 × 600 without one. */
  world?: BotWorld | null;
  /** The clip's length (the file's): the run is followed past it. */
  clipSec?: number | null;
  /** The plan's recipe (ScoreContext.recipe): the payoff is timed by its strategy while it plays the mode. */
  recipe?: string | null;
  /** Stops the run when it reads true (an AbortSignal, or the queue's own cancel). */
  signal?: { readonly aborted: boolean };
  /** The clock that times the slices and the pause between them (injectable for tests). */
  now?: () => number;
  pause?: () => Promise<void>;
}

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * The facts of a clip's run, in slices: whole steps for SCORE_SLICE_MS, then a pause, so a heavy run never freezes the page
 * (the slices never change the run). Null when `signal` aborts it.
 */
export async function runFactsOf(settings: SimulatorSettings, seed: number, options: RunFactsOptions = {}): Promise<ScoreFacts | null> {
  const now = options.now ?? clock;
  const pause = options.pause ?? breathe;
  const steps = runSteps(settings, seed, options.world, options.clipSec, options.recipe);
  let mark = now();
  for (;;) {
    if (options.signal?.aborted) return null;
    const next = steps.next();
    if (next.done) return factsOfRun(settings, next.value, strategyOf(settings.mode, options.recipe));
    if (now() - mark >= SCORE_SLICE_MS) {
      await pause();
      mark = now();
    }
  }
}

/**
 * The clips scored here from their run when they are saved: a link's, the page's setup's and an AI clip (the AI's tools change
 * what its run plays after the plan was scored), and a bot plan's that carries no score (a job journalled before 1.6.0, or the
 * re-render of a TikTok cut, the whole clip again: a cut keeps no score, genes.ts genesOfCut). A bot plan's with its score
 * keeps it: the planner's run is the one rendered.
 */
export function scoresFromSettings(genes: ClipGenes | null | undefined): genes is ClipGenes {
  return !!genes && (genes.source === "link" || genes.source === "seed" || genes.source === "ai" || (genes.source === "plan" && genes.planScore === null));
}

export interface SavedClipScore {
  settings: SimulatorSettings;
  seed: number;
  /** The page's world (DesktopPageHooks.getWorld()). */
  world: BotWorld | null;
  /** The file's length and what the fast export measured of it (FastRenderResult.features). */
  durationSec: number | null;
  features: ClipFeatures | null | undefined;
  platform: BotPlatform | null;
  /** The melody the page played the clip with when the genes know none (DesktopPageHooks.currentMelody: a built-in id, or null). */
  melody?: string | null;
  signal?: { readonly aborted: boolean };
  now?: () => number;
  pause?: () => Promise<void>;
}

/**
 * The genes of a saved clip scored from its run (scoresFromSettings), with the playbook's score: the run of its seed in the
 * page's world, the file's length and first motion, the platform and melody it was made for and, for a planned clip (an AI
 * clip, an old bot plan job), its plan's recipe, series day, bucket and ending – that bucket the one its genes have for the
 * file (genes.ts genesOfSavedFile: kept at the planned length, or while the file's length fits it), and its ending the run's
 * (an AI clip's new run may resolve where the plan was cut, or not; a cliffhanger asking at its end stays one). Anything
 * else, an aborted run or a failure: the genes as they were (a score can never fail a save).
 */
export async function scoreSavedClip(genes: ClipGenes, clip: SavedClipScore): Promise<ClipGenes> {
  if (!scoresFromSettings(genes)) return genes;
  try {
    const planned = genes.source === "ai" || genes.source === "plan";
    const run = await runFactsOf(clip.settings, clip.seed, { world: clip.world, clipSec: clip.durationSec, recipe: genes.recipe, signal: clip.signal, now: clip.now, pause: clip.pause });
    if (!run) return genes;
    const facts = mergeFacts(run, factsOfExport(clip.features ?? genes.features, clip.durationSec));
    const melody = genes.melody ?? (typeof clip.melody === "string" && clip.melody ? clip.melody : null);
    // (--- insights --- (review fix) the bucket the genes have for this length, and the ending they were planned with)
    const like = planLikeFromSettings(clip.settings, facts, { platform: clip.platform, episode: genes.episode, melody, recipe: genes.recipe, bucket: planned ? genes.bucket : null, bucketSec: planned ? genes.durationSec : null, ending: planned ? genes.ending : null });
    return genesWithScore({ ...genes, melody, ...(planned ? { bucket: like.bucket, ending: like.ending } : {}) }, scorePlanLike(like));
  } catch {
    return genes;
  }
}

// --- crew ---
/** A saved clip's genes as scoreSavedClip() gives them, with the run they were scored from and the facts the score read. */
export interface SavedClipFacts {
  genes: ClipGenes;
  /** The run of its seed in the page's world (null: aborted, or a failure). */
  run: RunFacts | null;
  /** The run's facts with the export's (mergeFacts), null without a run. */
  facts: ScoreFacts | null;
}

/**
 * scoreSavedClip() that keeps what it measured: the genes it gives (the same record), the run of the clip's seed and the facts
 * the score read – for the crew's after-save look (lib/crew/clip.ts crewClipOfSaved), which needs the run's winner, escapes and
 * finish. Unlike scoreSavedClip(), the seed is run for every clip, a bot plan's that keeps its own score too (its genes are
 * then returned as they were). Anything else, an aborted run or a failure: the genes as they were, no run and no facts.
 */
export async function scoreSavedClipWithFacts(genes: ClipGenes, clip: SavedClipScore): Promise<SavedClipFacts> {
  try {
    const run = await runOf(clip.settings, clip.seed, { world: clip.world, clipSec: clip.durationSec, recipe: genes.recipe, signal: clip.signal, now: clip.now, pause: clip.pause });
    if (!run) return { genes, run: null, facts: null };
    const facts = mergeFacts(factsOfRun(clip.settings, run, strategyOf(clip.settings.mode, genes.recipe)), factsOfExport(clip.features ?? genes.features, clip.durationSec));
    if (!scoresFromSettings(genes)) return { genes, run, facts };
    const planned = genes.source === "ai" || genes.source === "plan";
    const melody = genes.melody ?? (typeof clip.melody === "string" && clip.melody ? clip.melody : null);
    const like = planLikeFromSettings(clip.settings, facts, { platform: clip.platform, episode: genes.episode, melody, recipe: genes.recipe, bucket: planned ? genes.bucket : null, bucketSec: planned ? genes.durationSec : null, ending: planned ? genes.ending : null });
    return { genes: genesWithScore({ ...genes, melody, ...(planned ? { bucket: like.bucket, ending: like.ending } : {}) }, scorePlanLike(like)), run, facts };
  } catch {
    return { genes, run: null, facts: null };
  }
}
// --- end crew ---

// --- end insights ---
