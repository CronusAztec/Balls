import { defaultCaption, type Caption } from "@/lib/captions";
import { captionBaseFont, endHoldsSec, hasTopHud, payoffSecOf, scoreClip, simulateFactsSteps, type CaptionRole, type ClipPlan, type RunFacts, type ScoreReason } from "@/lib/bot/planner";
import { BOT_FRAME, BOT_PLATFORMS, PLATFORMS, RECIPES, type BotPlatform, type BotRecipe, type CountdownKind, type LengthBucket } from "@/lib/bot/playbook";
import { DEFAULT_BOT_WORLD, finderRequestOfSettings, type BotWorld } from "@/lib/bot/finderRequest";
import type { SimulatorSettings } from "@/lib/settings";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";
import { recordingTextLayout } from "@/lib/recording/recorder";
import { bucketKept, bucketOfSeconds, genesWithScore, type ClipGenes, type ClipGenesFeatures } from "./genes";

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
 *    countdown; else a caption that enters at 0.05 s or earlier is the hook (scoreClip's own "on screen from the start");
 *    else a question caption is the question, a caption with a number token (a digit) the countdown, one that asks something
 *    the question, and the rest the payoff's words (scoreClip reads no payoff role). A clip with no hook caption and a Top
 *    Text has that line as its hook (`hookedSettings()`): the viral bot's Top Text is its series label, the page's one-liner
 *    on top is what a viewer reads first;
 *  - the plan's recipe where it has one that plays the mode, else the mode's recipe in the playbook (the first that plays
 *    it): its payoff strategy, whether the mode's own notes are the melody and the recurring cast its series uses. No recipe
 *    plays the mode: the payoff is the run's own end;
 *  - the facts: when the first impact comes, when the payoff comes and how long the clip is. The ending follows from them:
 *    a clip cut before the result has its payoff after its end, or none inside it and a question on screen; any other clip
 *    is resolved;
 *  - the platform the clip is for (else the one whose default bucket is the clip's), its series day and its melody, and the
 *    bucket: a plan's while the clip's length fits it, else the bucket of the clip's length.
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

/** A caption that enters this early (s) is the hook: scoreClip's own test of a hook "on screen from the start". */
export const HOOK_START_SEC = 0.05;
/** The caption types that show a live number: the countdown. */
export const COUNTER_CAPTIONS = ["countdown", "wallCounter", "progress"] as const satisfies readonly Caption["type"][];
/** The countdown a counter caption shows (playbook COUNTDOWN_KINDS). */
const COUNTER_KIND: Record<(typeof COUNTER_CAPTIONS)[number], CountdownKind> = { countdown: "timer", wallCounter: "walls", progress: "percent" };
/** A number token in a caption's words: a counter's placeholder or a digit ("3 walls left"). */
const NUMBER_TOKEN = /\[(?:time|n|total|pct)\]|\p{Nd}/u;
const ASKS = /[?？¿]/;
/** How far past the clip's end the run is followed (s): a payoff right after the cut (CLIFF_GAP_SEC) is a clip cut before it. The planner's margin. */
export const SCORE_RUN_MARGIN_SEC = 2;
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
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The roles of a clip's captions (see the header): what scoreClip reads as its hook, countdown and question. */
export function captionRolesOf(captions: readonly Pick<Caption, "type" | "text" | "start">[]): CaptionRole[] {
  return captions.map((c) => {
    if ((COUNTER_CAPTIONS as readonly string[]).includes(c.type)) return "countdown";
    if (c.start <= HOOK_START_SEC) return "hook";
    if (c.type === "question") return "question";
    if (NUMBER_TOKEN.test(c.text)) return "countdown";
    if (ASKS.test(c.text)) return "question";
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
 */
export function hookedSettings(settings: SimulatorSettings): { settings: SimulatorSettings; roles: CaptionRole[] } {
  const roles = captionRolesOf(settings.captions);
  const top = settings.topText.trim();
  if (!top || roles.includes("hook") || hasTopHud(settings.mode)) return { settings, roles };
  const base = defaultCaption("text", { text: top });
  // the recorder's Top Text size over the captions' base size, in the frame scoreClip measures
  const size = recordingTextLayout(BOT_FRAME.width, BOT_FRAME.height, settings.textSize).fontSize / captionBaseFont(Math.min(BOT_FRAME.width, BOT_FRAME.height));
  const hook: Caption = { ...base, position: "top", start: 0, end: 0, style: { ...base.style, size } };
  return { settings: { ...settings, topText: "", captions: [hook, ...settings.captions] }, roles: ["hook", ...roles] };
}

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
  const bucket = (context.bucket ? bucketKept(context.bucket, clipSec) : bucketOfSeconds(clipSec)) ?? "short";
  const payoff = finite(facts.payoffSec) && facts.payoffSec >= 0 ? facts.payoffSec : null;
  const { settings, roles } = hookedSettings(clipSettings);
  // cut before the result: the payoff after the clip's end, or none inside it and the clip asks (the bot's never-escapes cut)
  const asks = roles.some((r, i) => r === "question" && settings.captions[i]);
  const cut = payoff !== null ? payoff > clipSec + 1e-9 : asks;
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
    payoff: payoff === null ? { atSec: null, position: null, cutGapSec: null } : cut ? { atSec: payoff, position: payoff / clipSec, cutGapSec: payoff - clipSec } : { atSec: payoff, position: payoff / clipSec, cutGapSec: null },
  };
}

/**
 * scoreClip's verdict on a plan-like (it reads only ScorePlan's fields). A clip that is not part of the series (series day 0)
 * has no series label: its series item is scoreClip's on the same plan-like without its Top and Bottom Text, so its line on
 * screen never makes it "part of a series" (a line over an arena game's scoreboard still covers it: that verdict stands).
 */
export function scorePlanLike(plan: ScorePlan): { score: number; reasons: ScoreReason[] } {
  const scored = scoreClip(plan as unknown as ClipPlan);
  const own = scored.reasons.find((r) => r.id === "series");
  if (plan.episode >= 1 || !own || own.key === "seriesCovered") return scored;
  const unlabelled = scoreClip({ ...plan, settings: { ...plan.settings, topText: "", bottomText: "" } } as unknown as ClipPlan).reasons.find((r) => r.id === "series") ?? own;
  const reasons = scored.reasons.map((r) => (r.id === "series" ? unlabelled : r));
  return { score: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
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
 * what its run plays after the plan was scored), and a bot plan's that carries no score (a job journalled before 1.6.0). A bot
 * plan's with its score keeps it: the planner's run is the one rendered.
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
 * clip, an old bot plan job), its plan's recipe, series day and bucket – that bucket kept while the file's length fits it, and
 * its ending the run's (an AI clip's new run may resolve where the plan was cut, or not). Anything else, an aborted run or a
 * failure: the genes as they were (a score can never fail a save).
 */
export async function scoreSavedClip(genes: ClipGenes, clip: SavedClipScore): Promise<ClipGenes> {
  if (!scoresFromSettings(genes)) return genes;
  try {
    const planned = genes.source === "ai" || genes.source === "plan";
    const run = await runFactsOf(clip.settings, clip.seed, { world: clip.world, clipSec: clip.durationSec, recipe: genes.recipe, signal: clip.signal, now: clip.now, pause: clip.pause });
    if (!run) return genes;
    const facts = mergeFacts(run, factsOfExport(clip.features ?? genes.features, clip.durationSec));
    const melody = genes.melody ?? (typeof clip.melody === "string" && clip.melody ? clip.melody : null);
    const like = planLikeFromSettings(clip.settings, facts, { platform: clip.platform, episode: genes.episode, melody, recipe: genes.recipe, bucket: planned ? genes.bucket : null });
    return genesWithScore({ ...genes, melody, ...(planned ? { bucket: like.bucket, ending: like.ending } : {}) }, scorePlanLike(like));
  } catch {
    return genes;
  }
}

// --- end insights ---
