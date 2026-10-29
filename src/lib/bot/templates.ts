import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { RANGES, defaultSettings, type SimulatorSettings } from "@/lib/settings";
import type { FinderOutcomeKind, OutcomeContext } from "@/lib/simulation/outcomes";
import type { Claim } from "@/lib/crew/clip";
import { defaultKeptHuds, hudsOn } from "@/lib/crew/hudFlags";
import { BOT_DEFAULT_FAMILIES, BOT_FAMILIES, intBetween, pick, recipeById, snapStep, stepBetween, type BotFamily, type BotFamilyChoice, type BotRecipe, type CountdownKind, type CountdownSource, type EndingStyle, type HookVars, type LengthBucket, type PayoffStrategy, type PayoffType, type RecipeContext } from "./playbook";
import { AT_END_BUCKETS, AT_END_SEC, atEndRecordingSec, outcomeStrategyPlans } from "./outcomeStrategy"; // --- templates --- (the outcome and atEnd strategies)
import { FORMAT_FIELD, OWN_HOOK_FIELD, templateName, type BotCopy } from "./copy"; // --- templates --- (a template's name; AI studio step 6: a variant's format hook)
import { modeSettingsOfSettings } from "./finderRequest"; // --- templates --- (Perfect Fit's solution seed: the finder's own search)
import { findPerfectFitRun } from "@/lib/simulation/perfectFitFinder"; // --- templates ---
import { randomStarSet, seededRandom as starRandom, serializeStars, starSetScore } from "@/lib/physics/starChords"; // --- templates --- (AI studio step 5: Chord Stars' sets, the finder's own kind)
import { transitOnBeat } from "@/lib/simulation/ellipseFociFinder"; // --- templates --- (Focus Shot's transit on the beat)
import { ceilSteps, funnelDescentSteps } from "@/lib/physics/funnelSpin"; // --- templates --- (the vortex's last ring on a bar line)
import { BLUEPRINT_CATALOG_IDS, catalogBlueprint, type BlueprintCatalogId } from "@/lib/blueprint/catalog"; // --- templates --- (AI studio step 6: Mode Lab's games)
import { illusionCycleSeconds } from "@/lib/physics/modes/illusion"; // --- templates --- (AI studio step 6: the illusion's fixed run length)

/*
 * --- templates --- A viral template for every mode: ten formats (what a clip promises and shows) and a binding of each of
 * the 48 modes to one of them (MODE_TEMPLATES: a Record over ModeId, so a new mode without a binding fails the type check),
 * the adapter that turns a binding into a recipe the planner plans unchanged (templateRecipeById), and the Simple look
 * (SIMPLE_LOOK, the one-line-at-a-time text plan) that keeps a clip calm.
 *
 *  - A format: its idea in one sentence, its claim (what the run must visibly do: the crew's G4 and the viewer check it), its
 *    copy under `ViralBot.formats.<id>` (name, hook, hookB, hookC, cliffHook, payoff, cliffQuestion, postQuestion and its own
 *    hashtags, in en, pl and es: copy.ts formatText, its `{thing}` the mode's noun under `ViralBot.things`), where its
 *    countdown comes from and the endings it takes. A template is named "{Mode name} · {Format name}" (templateNameOf); a
 *    further variant adds its recipe's name, or without one its own (`ViralBot.variants`: "Classic · Get out · One ring").
 *  - A binding: the mode's format, how the planner times its payoff (a playbook strategy – its recipe's, or one of its own where
 *    the recipe's does not show the format's payoff: Ball Drop's last note –, the bound finder outcome's moment ("outcome") or
 *    the clip's last 1.5 s ("atEnd"): outcomeStrategy.ts), the settings it plays its recipe with (`tune`: Pendulum Wave's chord
 *    where the hook promises one) – or, without a recipe, its own (`patch` on the mode's defaults, or a seeded `generate`), with
 *    the context flag its outcome needs switched on (OUTCOME_FLAG_SETTINGS) –, the length buckets it can fill, the HUD it keeps
 *    (only the one that shows the countdown), its tier and its variants. Tiers: proven (wraps a playbook recipe, each variant
 *    one; the variants that plan pass every clarity gate at Simple 80+ and Playbook 75+), trial and experimental (the bindings
 *    of the EXPERIMENTAL table, a shrink-only list: hidden from every menu until the planning acceptance passes them). A proven
 *    binding's variant whose plans fail a gate on every seed is hidden with its reason, never kept ready by an exception: the
 *    square race (its count-in) and Grow's fill that ends the run (AI studio step 3: shown 0.5 s); Ball Drop's, hidden while its
 *    run faded out (review round 2, 21), played its rain looped from AI studio step 5 (DROP_RAIN: the beat format's payoff the
 *    clip's last 1.5 s) and is hidden again since the studio's first review round (11: that last 1.5 s plays what the whole rain
 *    did, DROP_PLAIN), and Fight League's boss rush, hidden for its hook of 8–9 words, draws its format's own since step 6
 *    ("Pick one before it starts.": a variant's own `hookKey`, wrappedRecipe). Only ready bindings plan – a proven one with a variant that plans (bind(): ready is derived, never declared) –: in
 *    this release 14 of the 16 proven ones, the square race's and Ball Drop's bindings not ready since their one variant is
 *    hidden, and 21 trial ones (AI studio step 3: Shatter, Color Match, Target and Brick Smash; step 4: the conveyor, the Maze,
 *    Territory, Land Claim, Bullseye and Bouncing Shapes, each with its own settings; step 4b: the Journey and Spiral Glass,
 *    their own overlays switched off – `journeyHud`, `sgHud`, in both looks since the first review round; step 5: Chord Stars,
 *    Focus Shot, Spinning Hoops, Bouncing Orbs, Colour Sort and the Double Pendulum Harp lined up, and Collision Playground on the
 *    beat, timed by its anti-collision drop since the first review round; step 6: the Drawing Machine's flower revealed, and Mode
 *    Lab, a variant per catalog game bp-check calls playable – Colour Conquest's hidden, its page's run parting from the
 *    planner's, watched); the other 11 are declared, experimental and hidden with the reason measured and watched – no setting
 *    answers it yet, their format's copy is written – (docs/virality-playbook.md §5): Perfect Fit, Beat Machines and the Wave Tank
 *    joined them in the studio's first review round (10 and 11). 48 of 48 are bound: every binding is ready, or experimental with
 *    its reason, or (the square race, Ball Drop) proven with its one variant hidden with its reason. A trial binding plans once it
 *    leaves the table, where its strategy can plan it. A proven binding may add a variant of its own settings (VariantOwn:
 *    Classic's one ring).
 *  - A variant: one template id (`<format>-<mode>[-<variant>]`, kebab-case: it names clip files) wrapping one recipe – or none,
 *    a binding's own settings –, or hidden with its reason (a variant that fails a gate on every plan), or narrowed to the length
 *    buckets its seed search finds the payoff in. A variant without a recipe adapts its binding (ownRecipe: the format's family,
 *    payoff, copy key and countdown, the binding's settings and strategy). Its adapter (templateRecipe; plannedRecipe whether it
 *    is offered or not) is the recipe pinned to the binding's mode, buckets (the variant's where
 *    it narrows them), endings (the format's, narrowed by the binding's), the binding's strategy and tune, and the format's
 *    words (no payoff words where its payoff speaks for itself, a stake format's number kept in the Simple hook): planClipSteps
 *    plans it like any recipe
 *    (seed search, payoff band, captions, share link, post copy) and the plan carries the template id as its recipe, which the
 *    planner's scoreClip and re-roll, and the Insights score (scoreRecipeFor), resolve back here.
 *
 * The templates sit beside RECIPES, never in it: the daily rotation (daySlots), its pinned days in tests/bot.test.ts, the
 * website's daily bot and every mode's defaults stay as they were, so no plan of today's bot and no fingerprint moves
 * (tests/botTemplates.test.ts asserts that no template id is a recipe id).
 *
 * The Simple look (look "simple", PlanOptions.look; templates plan in it unless the caller asks for the bot's): neon on a dark
 * gradient that keeps the checklist's look points, ball glow and thin single-colour trails, every charged effect off, the HUDs
 * off but the one that counts down, no name label; one text at a time – the hook (at most 7 words, 2 lines) for 2.5 s, then
 * the countdown caption where no HUD counts, then the payoff's words or the closing question –, and the series label moved to
 * the post caption. Look settings only: the physics, the payoff's timing and the run (lib/insights/score.ts runFactsSync) stay
 * the bot look's, with the seed search on too – it ranks and stops on the bot look's score (planner.ts planClipSteps), so the
 * series label's 4 points never send it to another seed. The cinematic camera stays as the mode plays it, since its slow
 * motion moves the run in 12 modes (§5).
 *
 * Pure: data and small functions, no clock, no randomness of its own (a settings generator draws from the context's).
 */

// --- templates ---

/* ------------------------------------------------------------------ the looks */

/** The looks a plan is drawn in: today's bot look (the default, unchanged) and the Simple look. */
export const BOT_LOOKS = ["bot", "simple"] as const;
export type BotLookId = (typeof BOT_LOOKS)[number];

export function isBotLook(value: unknown): value is BotLookId {
  return typeof value === "string" && (BOT_LOOKS as readonly string[]).includes(value);
}

/** The look a template is planned in unless the caller asks for another. */
export const TEMPLATE_LOOK: BotLookId = "simple";

/**
 * --- bot-templates --- (studio round 1, 3) Whether the crew's clarity rules judge a planned clip: only one drawn in the Simple look,
 * whose rules they are (G5's seven words and one text at a time, G6's Simple score). A clip in the bot's own look is busy by
 * design – its glow, trails, series label and longer hook –, so every one of them would fail G5 or G6 beside its checklist's ticks.
 */
export function clarityJudges(plan: { look?: BotLookId }): boolean {
  return plan.look === "simple";
}

/**
 * The Simple look's settings. The gradient is dark without being black: both colours stay under scoreClip's 0.12 luminance
 * (the slate #1e293b would be 0.157 and lose the look's 3 points). The trail thickness is the settings' default, the one the
 * Simple score charges nothing for (crew/simplicity.ts SIMPLE_TRAIL_THICKNESS). The neon theme's particles are sparks.
 */
export const SIMPLE_LOOK = {
  themeId: "neon",
  background: ["#05070a", "#141a24"],
  showGlow: true,
  showTrails: true,
  trailThickness: 0.8,
  colorTrail: false,
  showWallGlow: false,
  rainbowWalls: false,
  rainbowBall: false,
  reactiveBackground: false,
  screenShake: 0,
  wallBreakStyle: "shatter",
  nameLabel: false,
} as const;

/** The value that switches a HUD flag off (crew/hudFlags.ts HUD_FLAGS: Power Layers' badge has a "none", the rest are switches). */
function hudOffValue(key: string): unknown {
  return key === "plBadge" ? "none" : false;
}

/**
 * The Simple look's patch for settings that already carry the recipe's numbers: the look fields above, and every HUD flag that
 * is on switched off but the kept ones (`keepHuds`; default: the HUD that shows the countdown when the countdown is the HUD's).
 * The theme's colours stay (the bot look applied the neon theme already). Look fields only.
 */
export function simpleLookPatch(s: SimulatorSettings, countdownSource: CountdownSource, keepHuds?: readonly string[]): Partial<SimulatorSettings> {
  const L = SIMPLE_LOOK;
  const patch: Record<string, unknown> = {
    themeId: L.themeId,
    backgroundType: "gradient",
    backgroundColors: [...L.background],
    showGlow: L.showGlow,
    showTrails: L.showTrails,
    trailThickness: Math.min(s.trailThickness, L.trailThickness),
    colorTrail: L.colorTrail,
    showWallGlow: L.showWallGlow,
    rainbowWalls: L.rainbowWalls,
    rainbowBall: L.rainbowBall,
    reactiveBackground: L.reactiveBackground,
    screenShake: L.screenShake,
    wallBreakStyle: L.wallBreakStyle,
    nameLabel: L.nameLabel,
  };
  if (s.particleStyle === "confetti") patch.particleStyle = "sparks";
  const kept = new Set(keepHuds ?? defaultKeptHuds(s, countdownSource));
  for (const h of hudsOn(s)) if (h.flag && !kept.has(h.id)) patch[h.id] = hudOffValue(h.id);
  return patch as Partial<SimulatorSettings>;
}

/** The text plan of the Simple look: one text on screen at a time. */
export const SIMPLE_TEXT = {
  /** The hook is on screen from 0 to this (s): inside the playbook's 2–3 s, 1.25 s a line for two lines. */
  hookEndSec: 2.5,
  /** The hook's words at most (the crew's G5). */
  hookWordsMax: 7,
  /**
   * The payoff's words a clause cut aims at: one short line, read in the second or so a run leaves after its payoff. A cap by
   * whole clauses only – a payoff of one clause ("Znów w jednej linii.", "Liu Kang is the champion!") keeps its words –, so
   * what holds every payoff is the time a line (secPerLine) and the one line its time takes (planner.ts clipCaptions).
   */
  payoffWordsMax: 3,
  /** --- templates --- (review round 2, 13) The seconds a line of text needs on screen: the crew's G5 (clarity.ts CLARITY.secPerLine). */
  secPerLine: 1.2,
} as const;

const wordsOf = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * --- templates --- Words that promise a chord (en, pl, es, and the notes' emoji): the crew's gate G2 asks the payoff to play one
 * (lib/crew/clarity.ts), and a hook that names one to play it nowhere else as large (review round 2, 20).
 */
export const CHORD_WORDS = /chord|akord|acorde|🎼|🎹/iu;

/**
 * A text cut to at most `max` words by whole clauses (sentences, or the parts around a colon): the text itself when it fits,
 * else the longest run of its clauses that does and has `min` words or more – a question among them first (`preferQuestion`),
 * else one from its start – with its first letter in capitals ("Pick a side: which colour takes the board?" → "Which colour
 * takes the board?"). A text none of whose runs fits stays as it is. Only the text's own words: nothing is added, so its
 * numbers and names stay the clip's.
 */
function shortenByClauses(text: string, max: number, min: number, preferQuestion: boolean, stake: readonly string[] = []): string {
  const t = text.trim();
  if (wordsOf(t) <= max) return t;
  // clauses: each ends with its own punctuation (". ", "! ", "? ", "… ", ": ")
  const clauses = t.match(/[^.!?…:]+(?:[.!?…:]+|$)/gu)?.map((c) => c.trim()).filter(Boolean) ?? [t];
  const runs: string[] = [];
  for (let i = 0; i < clauses.length; i++) {
    for (let j = i; j < clauses.length; j++) {
      const run = clauses.slice(i, j + 1).join(" ");
      if (wordsOf(run) > max) break;
      if (run !== t && wordsOf(run) >= min) runs.push(run);
    }
  }
  if (runs.length === 0) return t;
  const asks = preferQuestion ? runs.filter((r) => /[?？]/u.test(r)) : [];
  // --- templates --- a stake format's number: the runs that state one of the clip's own numbers ("700 layers to go.")
  const stated = stake.length ? runs.filter((r) => (r.match(/\d+/gu) ?? []).some((d) => stake.includes(d))) : [];
  const fromStart = runs.filter((r) => r.startsWith(clauses[0]));
  const pool = asks.length ? asks : stated.length ? stated : fromStart.length ? fromStart : runs;
  const pick = pool.reduce((a, b) => (wordsOf(b) > wordsOf(a) ? b : a)).replace(/:$/u, ".");
  // its first letter in capitals (after an opening ¿ or ¡)
  return pick.replace(/^([¿¡"“]*)(\p{Ll})/u, (_, lead: string, first: string) => `${lead}${first.toLocaleUpperCase()}`);
}

/**
 * The hook the Simple look draws: the recipe's own, cut to at most 7 words by whole clauses (shortenByClauses), its question
 * first, then – a stake format's (`stake`: the clip's own numbers, stakeNumbersOf) – the clause that states one, else the
 * clauses from its start. The planner passes the stake only where nothing else on screen shows it (planner.ts assemblePlan):
 * --- templates --- (review round 2, 23) Power Layers' own HUD counts its layers down from the first frame ("layers left:
 * 700"), so its hook keeps the rule – "Every hit doubles the power." – which the picture cannot show (+1, Fibonacci and
 * doubling all open on hits of a layer or two) and a cliffhanger's "One more hit?" hangs on.
 */
export function simpleHookText(hook: string, stake?: readonly number[]): string {
  return shortenByClauses(hook, SIMPLE_TEXT.hookWordsMax, 2, true, (stake ?? []).filter((n) => Number.isInteger(n) && n > 1).map((n) => String(n)));
}

/**
 * --- templates --- (review round 2, 20) A hook that asks instead of promising a chord: the recipe hook's clauses but the ones
 * that name a chord (CHORD_WORDS), then the question `ask` without its closing emoji (a closing question's 👇 points at the
 * comments, not at the clip) – "22 pendulums. Wait for the chord." and "Do they line up? 👇" make "22 pendulums. Do they line
 * up?". Only the copy's own words, in its own language: an empty question leaves the hook as it is.
 */
export function askHookText(hook: string, ask: string): string {
  const question = ask.replace(/\s*\p{Extended_Pictographic}[\p{Extended_Pictographic}\uFE0F\u200D\s]*$/u, "").trim();
  if (!question) return hook;
  const clauses = hook.trim().match(/[^.!?…:]+(?:[.!?…:]+|$)/gu)?.map((c) => c.trim()).filter(Boolean) ?? [hook.trim()];
  return [...clauses.filter((c) => !CHORD_WORDS.test(c)), question].join(" ");
}

/** --- templates --- The clip's own numbers among a recipe's hook values (whole numbers above one): a stake format's stake. */
export function stakeNumbersOf(vars: HookVars): number[] {
  const out: number[] = [];
  for (const v of Object.values(vars)) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
    if (Number.isInteger(n) && n > 1 && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * The payoff's words the Simple look draws: the recipe's own, cut toward 3 words by whole clauses ("FREE! Gerald made it 🎉"
 * → "FREE!"); a payoff none of whose clause runs fits keeps its words ("Thor is the champion! 🏆"). Its lines get their time in
 * planner.ts clipCaptions: one line where the clip's tail is too short for two (its closing emoji left out first).
 */
export function simplePayoffText(payoff: string): string {
  return shortenByClauses(payoff, SIMPLE_TEXT.payoffWordsMax, 1, false);
}

/* ------------------------------------------------------------------ the formats */

export const TEMPLATE_FORMAT_IDS = ["getOut", "smash", "fill", "count", "whoWins", "aim", "lineUp", "onTheBeat", "reveal", "labGame"] as const;
export type TemplateFormatId = (typeof TEMPLATE_FORMAT_IDS)[number];

/**
 * Where a format's countdown comes from: the picture itself, the mode's HUD, or a caption after the hook. --- templates ---
 * (review round 2, 22) The Simple look reads it (planner.ts simpleCountdownSource): no counter caption for a format that does
 * not list "caption", and none that counts the clip's seconds (a bar, a timer) in any format – one text at a time would take
 * it off at the payoff, short of its 100 % or 0:00 ("84 %" the moment the pendulums line up).
 */
export type CountdownFrom = CountdownSource;

export interface TemplateFormat {
  id: TemplateFormatId;
  /** What the clip is, in one sentence (the crew's brainstormer and reviewer read it). */
  idea: string;
  /** What the run must visibly do (crew/clip.ts CLAIMS). */
  claim: Claim;
  /** Its copy under `ViralBot.formats.<id>` (copy.ts formatText; the proven templates speak with their recipes' copy). */
  copyKey: string;
  countdown: readonly CountdownFrom[];
  endings: readonly EndingStyle[];
  /** --- templates --- Its payoff is drawn in words (false: the moment speaks for itself – the last note of a beat). */
  payoffWords: boolean;
  /** --- templates --- Its hook's number is the stake (how many to break, to count): the Simple hook keeps the clause that states it. */
  stakeHook: boolean;
  /**
   * --- templates --- The series a binding of it without a recipe belongs to (a binding may name its own): the battles' who-wins
   * stays in the battle family, which the daily bot and the default menus leave out unless it is asked for.
   */
  family: BotFamily;
  /** --- templates --- The payoff a binding of it without a recipe shows (playbook.ts PAYOFF_TYPES). */
  payoff: PayoffType;
}

export const TEMPLATE_FORMATS: Readonly<Record<TemplateFormatId, TemplateFormat>> = {
  getOut: { id: "getOut", idea: "Something is trapped; will it get out, and the moment it does.", claim: "out", copyKey: "getOut", countdown: ["hud", "caption"], endings: ["resolved", "cliffhanger"], payoffWords: true, stakeHook: false, family: "escape", payoff: "escape" },
  smash: { id: "smash", idea: "Every hit wears it down; which hit breaks it.", claim: "break", copyKey: "smash", countdown: ["hud", "caption"], endings: ["resolved", "cliffhanger"], payoffWords: true, stakeHook: true, family: "escape", payoff: "shatter" },
  // (review round 2, 22: the ball filling its ring is the countdown; the caption bar counted the clip's seconds, not the fill)
  fill: { id: "fill", idea: "It grows until it fills the space.", claim: "full", copyKey: "fill", countdown: ["picture"], endings: ["resolved"], payoffWords: true, stakeHook: false, family: "escape", payoff: "fill" },
  count: { id: "count", idea: "One becomes many; how many by the end.", claim: "count", copyKey: "count", countdown: ["hud", "picture"], endings: ["resolved"], payoffWords: true, stakeHook: true, family: "escape", payoff: "fill" },
  whoWins: { id: "whoWins", idea: "Pick one before it starts; one of them wins.", claim: "winner", copyKey: "whoWins", countdown: ["hud", "picture"], endings: ["resolved", "cliffhanger"], payoffWords: true, stakeHook: false, family: "battle", payoff: "winner" },
  // (--- templates --- studio2 review round 1, 19: the aim and Mode Lab payoffs are their modes' own marks, planner.ts MARK_MODES – a
  // hit and a game's end –, never an escape: the dossier wrote "escape at 14.6 s" beside "no first escape in the run")
  aim: { id: "aim", idea: "One shot at a target; does it hit.", claim: "hit", copyKey: "aim", countdown: ["caption"], endings: ["resolved", "cliffhanger"], payoffWords: true, stakeHook: false, family: "escape", payoff: "hit" },
  lineUp: { id: "lineUp", idea: "Out of step, then all in line at once.", claim: "inSync", copyKey: "lineUp", countdown: ["picture", "hud"], endings: ["resolved"], payoffWords: true, stakeHook: false, family: "rhythm", payoff: "flip" },
  // (the plan's onTheBeat payoff: "none: the drop or the last bar" – the last note is heard, and no words name a chord it is not)
  onTheBeat: { id: "onTheBeat", idea: "Every bounce is a note; the drop or the last bar is the payoff.", claim: "beat", copyKey: "onTheBeat", countdown: ["picture"], endings: ["resolved"], payoffWords: false, stakeHook: false, family: "rhythm", payoff: "flip" },
  reveal: { id: "reveal", idea: "Lines pile up into a picture; guess it before it is done.", claim: "picture", copyKey: "reveal", countdown: ["picture"], endings: ["resolved"], payoffWords: true, stakeHook: false, family: "rhythm", payoff: "flip" },
  labGame: { id: "labGame", idea: "A Mode Lab game played to its own finish rule.", claim: "gameRule", copyKey: "labGame", countdown: ["hud"], endings: ["resolved"], payoffWords: true, stakeHook: false, family: "escape", payoff: "gameOver" },
};

/* ------------------------------------------------------------------ the bindings */

/**
 * How a binding times its payoff: a playbook strategy – its recipe's, Ball Drop's last note –, the bound finder outcome's moment
 * ("outcome") or the clip's last 1.5 s ("atEnd"): --- templates --- the planner plans both (outcomeStrategy.ts).
 */
export type TemplateStrategy = PayoffStrategy;
export type TemplateTier = "proven" | "trial" | "experimental";
/**
 * The finder context flags a bound outcome may need (lib/simulation/outcomes.ts OutcomeContext): on, but colourSortSettles,
 * which its outcomes need off (a gate rule whose sort completes instead of settling).
 */
export type OutcomeFlag = keyof OutcomeContext & ("growFinish" | "dpFan" | "bmMarbles" | "vortexRings" | "pfPento" | "ringEscape" | "colourSortSettles");

/**
 * --- templates --- The settings that give a binding's outcome its context flag (lib/simulation/outcomeContext.ts reads them back):
 * Grow's fill ends the run, the chaos fan, the marble xylophone, the vortex's ring waves, the pentomino rectangles, Classic's ring
 * sounds (a Ring Escape option that leaves the rings as they are), and a Colour Sort rule whose sort completes (the default's).
 * A binding's own settings take its flag's on top (ownSettingsOf), so its outcome is there to find whatever else they set.
 */
export const OUTCOME_FLAG_SETTINGS: Readonly<Record<OutcomeFlag, Partial<SimulatorSettings>>> = {
  growFinish: { growOnFill: "finish" },
  dpFan: { dpFan: true },
  bmMarbles: { bmVariant: "marbles" },
  vortexRings: { vxRelease: "rings" },
  pfPento: { pfVariant: "pento" },
  ringEscape: { ringSound: true },
  colourSortSettles: { csRule: "outwardNotOwn" },
};

/** --- templates --- Whether a context has the flag an outcome needs: on – or, for colourSortSettles, off. */
export function outcomeFlagHolds(flag: OutcomeFlag, ctx: OutcomeContext): boolean {
  return flag === "colourSortSettles" ? !ctx.colourSortSettles : ctx[flag] === true;
}

export interface TemplateVariant {
  /** The template id: `<format>-<mode>` for the binding's first variant, `-<suffix>` after it for the others. */
  id: string;
  /** The playbook recipe it wraps (null: the binding's own settings, ownSettingsOf). */
  recipe: string | null;
  /** Why a variant of a proven binding is hidden (it fails a clarity gate on every plan); absent: it plans with its binding. */
  hidden?: string;
  /** The length buckets this variant fills, narrower than its binding's: the ones its seed search finds the payoff in. */
  buckets?: readonly LengthBucket[];
  /**
   * --- templates --- (AI studio step 3) A variant without a recipe that plays its own way: what it sets over its binding (its
   * strategy, outcome, context flag, settings, endings, hook…) – Classic's one ring timed by ring-at, Grow's fill that ends the run.
   * --- templates --- (AI studio step 6) A variant that wraps a recipe sets its hook only (`hookKey`: one of its format's own three,
   * wrappedRecipe), where the recipe's own breaks a gate on every plan: Fight League's boss rush.
   */
  own?: VariantOwn;
}

/**
 * --- templates --- (AI studio step 3) What a variant without a recipe sets over its binding (variantBinding). --- templates --- (AI
 * studio step 6) Its series too (`family`): a Mode Lab game's own (Colour Conquest is a battle).
 */
export type VariantOwn = Partial<Pick<ModeBinding, "strategy" | "outcome" | "needs" | "patch" | "generate" | "countdown" | "hookVars" | "hookKey" | "payoffKey" | "endings" | "buckets" | "keepHud" | "scene" | "character" | "payoffWords" | "family" | "musicFirst" | "note">>;

export interface ModeBinding {
  mode: ModeId;
  format: TemplateFormatId;
  strategy: TemplateStrategy;
  tier: TemplateTier;
  /**
   * It plans in this release: a proven binding with at least one variant that plans (bind() derives it). The square race's is
   * proven but not ready (its one variant is hidden); the others are declared and hidden.
   */
  ready: boolean;
  variants: readonly TemplateVariant[];
  /** The finder outcome its payoff is (strategy "outcome"). */
  outcome?: FinderOutcomeKind;
  /** The context flag the outcome needs: the binding's own settings switch it on (OUTCOME_FLAG_SETTINGS). */
  needs?: OutcomeFlag;
  // --- templates --- a binding without a recipe: its own settings and what its recipe would say
  /** Its settings on the mode's defaults (one of `patch` and `generate`; neither: the defaults), every value on its RANGES step. */
  patch?: Partial<SimulatorSettings>;
  /** Its settings drawn from the planner's seeded context (its `rng` only, every value on its RANGES step, never clamped). */
  generate?: (ctx: RecipeContext) => Partial<SimulatorSettings>;
  /** Its series where it is not its format's (TemplateFormat.family). */
  family?: BotFamily;
  /** Its countdown (a caption, the mode's HUD, or the picture); the picture by default. */
  countdown?: { kind: CountdownKind; source: CountdownSource };
  /** The values its hook and captions are filled with (none by default). */
  hookVars?: (s: SimulatorSettings) => HookVars;
  /** The mode's own notes are the melody: no melody on top (BotRecipe.musicFirst). */
  musicFirst?: true;
  /** The length buckets the mode fills under this binding (all its recipe's by default). */
  buckets?: readonly LengthBucket[];
  /** The endings it takes (its format's and its recipe's by default). */
  endings?: readonly EndingStyle[];
  /** The HUD flag it keeps on (crew/hudFlags.ts HUD_FLAGS), only one that shows the countdown; null: none. */
  keepHud: string | null;
  /**
   * --- templates --- Settings it plays its recipe with, set over the recipe's draw (after every seeded choice, so the draw is
   * the recipe's): where the recipe's own would break the format's promise. Both looks play them.
   */
  tune?: Partial<SimulatorSettings>;
  /**
   * --- templates --- (review round 2, 20) The recipe's copy key of the question its hook asks in place of a chord it promises
   * (askHookText), in both looks: where the run plays that chord elsewhere too, so the hook never promises it.
   */
  hookAsk?: string;
  /**
   * The viewer's scene line where the dossier's own (crew/dossier.ts sceneOf) does not describe the mode: --- templates --- (AI
   * studio step 3) the screen view reads it (crew/dossier.ts screenView), in neutral words from the settings' numbers.
   */
  scene?: (s: SimulatorSettings) => string;
  /**
   * --- templates --- (AI studio step 3) The hook it draws in either ending: its format's `hook`, `hookB` or `hookC`
   * (FORMAT_HOOK_FIELDS). Without one a cliffhanger draws its format's `cliffHook` ("{thing} vs the clock."), else its `hook`.
   */
  hookKey?: "hook" | "hookB" | "hookC" | OwnHookKey;
  /**
   * --- templates --- (AI studio step 4b) Its payoff's own words, where its format's do not name its run's moment (copy.ts
   * OWN_PAYOFF_FIELD: `ViralBot.ownPayoffs.<key>`): the Journey's "Home! 🏠" at the door marked HOME, where get-out says "Out!".
   */
  payoffKey?: OwnPayoffKey;
  /**
   * --- templates --- (studio2 review round 1, 19) The payoff it shows where its format's is not its run's (playbook.ts PAYOFF_TYPES):
   * Paddle Keep-Up's GAME OVER under the aim format, whose payoff is a hit.
   */
  payoffType?: PayoffType;
  /** --- templates --- (AI studio step 3) Gerald plays the ball (BotRecipe.character: his face and name; the Simple look draws no label). */
  character?: true;
  /**
   * --- templates --- (AI studio step 4) No payoff words of its format's, in either look: where they would name another moment than
   * its run's ("Bullseye!" over a logo's corner, over a GAME OVER), the picture and the mode's own banner speak.
   */
  payoffWords?: false;
  /** Why it is bound this way, or what it waits for. */
  note?: string;
}

/**
 * --- templates --- (AI studio step 4) A binding's own hook (copy.ts OWN_HOOK_FIELD: `ViralBot.ownHooks.<key>`), where its format's
 * three hooks do not say what its run does: Bouncing Shapes' countdown, Merge Ring's tiers.
 */
export type OwnHookKey = `own.${"box" | "mergeRing" | "spiralGlass" | "doublePendulum" | "conveyor" /* --- templates --- (studio round 1, 12) */ | BlueprintCatalogId /* --- templates --- (AI studio step 6) a Mode Lab game's rule */}`;

/** --- templates --- (AI studio step 4b) A binding's own payoff (copy.ts OWN_PAYOFF_FIELD: `ViralBot.ownPayoffs.<key>`): the Journey's HOME. */
export type OwnPayoffKey = `ownPayoff.${"journey"}`;

const kebab = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** A template id: `<format>-<mode>`, kebab-case, with a variant's suffix. */
export function templateIdOf(format: TemplateFormatId, mode: ModeId, suffix?: string): string {
  return [kebab(format), kebab(mode), ...(suffix ? [suffix] : [])].join("-");
}

/**
 * A variant's spec: the recipe it wraps, its id's suffix, why it is hidden, the buckets it narrows its binding's to and – --- templates
 * --- a variant without a recipe that plays its own way – what it sets over its binding.
 */
type VariantSpec = readonly [recipe: string | null, suffix?: string, hidden?: string, buckets?: readonly LengthBucket[], own?: VariantOwn];
type BindingSpec = Omit<ModeBinding, "mode" | "variants" | "ready"> & { variants?: readonly VariantSpec[] };

/**
 * --- templates --- Whether a binding's strategy can plan it: every strategy but an outcome the outcome strategy has no moment
 * for (outcomeStrategy.ts OUTCOME_MOMENTS: an outcome the finder searches over settings, not seeds).
 */
export function strategyCanPlan(binding: Pick<ModeBinding, "strategy" | "outcome">): boolean {
  return binding.strategy !== "outcome" || outcomeStrategyPlans(binding.outcome);
}

/**
 * A binding from its spec: its variants' ids from the format and the mode; ready when proven and one of its variants plans
 * (wraps a recipe and is not hidden) – --- templates --- (review round 2, 14) never ready with nothing to plan, as the square race.
 * --- templates --- A binding of the EXPERIMENTAL table is experimental, whatever its spec says, and never ready; a trial one is
 * ready while one of its variants is not hidden and its strategy can plan it.
 */
function bind(mode: ModeId, spec: BindingSpec): ModeBinding {
  const variants = (spec.variants ?? [[null]]).map(([recipe, suffix, hidden, buckets, own]): TemplateVariant => ({ id: templateIdOf(spec.format, mode, suffix), recipe, ...(hidden ? { hidden } : {}), ...(buckets ? { buckets } : {}), ...(own ? { own } : {}) }));
  const tier: TemplateTier = spec.tier !== "proven" && EXPERIMENTAL[mode] !== undefined ? "experimental" : spec.tier;
  // (--- templates --- a proven binding's variant without a recipe plans its own way: AI studio step 3)
  const ready = tier === "proven" ? variants.some((v) => !v.hidden && (v.recipe !== null || strategyCanPlan({ ...spec, ...(v.own ?? {}) }))) : tier === "trial" && variants.some((v) => !v.hidden) && strategyCanPlan(spec);
  return { ...spec, tier, mode, ready, variants };
}

/**
 * --- templates --- (AI studio step 3) The binding a variant plays: its binding, with what a variant without a recipe sets over it
 * (VariantOwn: Classic's one ring timed by ring-at); a variant that wraps a recipe plays its binding as it is.
 */
export function variantBinding(binding: ModeBinding, variant: Pick<TemplateVariant, "recipe" | "own"> | undefined): ModeBinding {
  return variant && variant.recipe === null && variant.own ? { ...binding, ...variant.own } : binding;
}

/** The run ends with the escape: a resolved clip would show it for the recorder's 0.5 s only, under the crew's G2 0.8 s. */
const ENDS_AT_ESCAPE = "the run ends with the escape (a resolved clip shows it for 0.5 s, G2 asks 0.8 s): the template cuts before it";

/**
 * Gerald's Portal escape takes the standard length only: in the short one (8–15 s, Shorts' own) its seed search finds no escape
 * in time on about half the plans (3 or 4 of 8 pass every gate, on every platform), in the standard one 7 or 8 of 8 do.
 */
const GERALD_PORTAL_BUCKETS: readonly LengthBucket[] = ["standard"];

/**
 * --- templates --- (studio round 1, 1) Grow's fill takes the short length only. The fill format ends resolved, and in the standard
 * length (15–30 s, the Reels and TikTok default) the grow-fill recipe's seed search often finds no fill inside the band: it hands back
 * a 32–46 s clip that fails G7 (a standard clip's length), or one with no fill in it at all (G2 and G4). Measured on plan seeds beyond
 * the test's: 16 of 24 Reels plans passed every gate (seeds 101–124), 2 of 4 in Polish and in Spanish, 2 of 4 in the studio's
 * 800×450 world. In the short length (8–15 s, Shorts' own) every plan did, on every platform: 276 of 276 measured, in en, pl and
 * es, the 800×450 world among them (docs/virality-playbook.md §5).
 */
const GROW_FILL_BUCKETS: readonly LengthBucket[] = ["short"];

/**
 * --- templates --- Pendulum Wave as its template plays it. The recipe sounds a bob as it crosses the centre: at the realignment
 * every bob is at a turning point, so the realignment was the quietest moment of the clip (the crossings after it spread over
 * 0.1 s, never one chord). Sounding at the turning points instead, every bob plays at once there – one accented chord (the
 * mode's ACCENT_CHORD_FRACTION) with its flash under "Back in line. 🎼". The pendulums hang in a row (the recipe draws a row, an
 * arc or a circle of bobs without strings), so "Back in line." is a line. Sound and layout only: the motion, the cycle and the
 * payoff's second are the recipe's.
 *
 * (review round 2, 20) The same chord, as large and as bright, also plays at the release and at the two rows of half a cycle,
 * and half of it at each quarter: with whole oscillations per cycle every bob is at a turning point then too, and no sound
 * setting plays it at the realignment alone. So the template's hook asks the question the line answers (the binding's
 * hookAsk: "22 pendulums. Do they line up?") and never promises the chord ("Wait for the chord." heard in the first frame and
 * again, as loud, at half the cycle): the line is the payoff, the chord its accent. The crew's G2 fails a hook that promises a
 * chord the run plays as large elsewhere (Outdone).
 */
const PENDULUM_TUNE: Partial<SimulatorSettings> = { pwSoundOn: "extremes", pwLayout: "row" };

/** The square race's count-in: no plan passes G1, and no setting skips it (docs/virality-playbook.md §5). */
const COUNT_IN = "its 3-2-1-GO opens the gate at 1.8 s, so G1 (the first impact within 1 s) fails on every plan, and no setting skips the count";

/**
 * --- templates --- (review round 2, 21; AI studio step 5) Ball Drop's run fades out: its notes thin from the middle of the run on,
 * its last ball's last note is one faint tick over a board at rest (G2 Still: the balls at 6–14 % of their median motion, fewer
 * notes than the run's usual moment, none accented), then silence until the SETTLED! banner and its burst, which the recorder
 * shows for its 0.5 s only (G2 asks 0.8 s after a payoff). So no moment of the recipe's run lands at 80–90 % of the clip, and its
 * template was hidden (the `lastNote` strategy, timed by that last tick, fails G2 on every plan). The beat format's own payoff is
 * the music, not an event: with the rain looped (DROP_RAIN, the recipe's draw kept) the balls fall through the board and in
 * again, so its notes never thin out and the clip's last 1.5 s (atEnd) land on a full board, heard.
 */
const DROP_FADES = "the payoff of the recipe's own run would be the last ball's last note, a faint tick before a silent settle; looped, the rain plays to the clip's end, its last 1.5 s the payoff";

/** A binding of a later step: no recipe – its own settings and its format's copy –, trial once it leaves EXPERIMENTAL. */
const later = (format: TemplateFormatId, strategy: TemplateStrategy, extra: Partial<BindingSpec> = {}): BindingSpec => ({ format, strategy, tier: "trial", keepHud: null, ...extra });

// --- templates --- (AI studio step 3) group A's own settings: seeded from the planner's context (its rng only), every value on its
// RANGES step, never clamped, no mode default changed
/** A value per length bucket (the playbook's byBucket). */
const forBucket = <T,>(ctx: RecipeContext, values: Readonly<Record<LengthBucket, T>>): T => values[ctx.bucket];

/**
 * Shatter's rings of glass segments: the ball breaks its way out of 8–12 in a short clip (it is out 4–13 s in), of 16–20 in a
 * standard one (6–35 s): the outcome strategy's seed search picks the seed whose escape the clip cuts before.
 */
function shatterSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const walls = forBucket(ctx, { short: [8, 12], standard: [16, 20], long: [18, 20] });
  return { wallCount: intBetween(ctx.rng, walls[0], walls[1]), ballSpeed: stepBetween(ctx.rng, 380, 440, 10) };
}

/**
 * Target's numbered segments, hit in order: 5 in a short clip, 6–7 in a standard one, a fast ball without gravity, so the last
 * one goes 8–25 s in (with gravity and 10 segments it takes a minute or more).
 */
function targetSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const count = forBucket(ctx, { short: [5, 5], standard: [6, 7], long: [8, 9] });
  return { targetCount: intBetween(ctx.rng, count[0], count[1]), ballSpeed: stepBetween(ctx.rng, 600, 720, 10), gravity: 0 };
}

/**
 * Brick Smash's first smash: a new ball every `brEvery` bricks sets its pace – the last brick falls about 5 s a brick of it in
 * (2: 7–9 s, 4: 19–21 s, 6: 28–34 s) –, so it is drawn from the payoff target, with the balls' speed for the rest.
 */
function brickSmashSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { brEvery: Math.max(1, Math.round(ctx.payoffTarget / 5)), brSpeed: stepBetween(ctx.rng, 420, 520, 10) };
}

/** Perfect Fit's boxes of the twelve pentominoes, one a clip (W × H = 60): the 10 × 6, the 12 × 5 or the 15 × 4. */
const PF_ONE_BOX = ["10×6", "12×5", "15×4"] as const;
/** The solution seeds the Perfect Fit binding tests for the most pieces on the floor (the finder's own search, most-on-floor). */
const PF_FLOOR_TRIES = 6;

/**
 * Perfect Fit: one box, its twelve pieces timed so its last one lands at the payoff target (a box is full 12 pieces' time in:
 * the plan is the clock's), and the tiling with the most pieces resting on the floor of the solution seeds the finder tests from a
 * drawn start (most-on-floor: perfectFitFinder.ts). The rectangles' variant is the default and the outcome's flag.
 */
function perfectFitSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const pfBoxes = pick(ctx.rng, PF_ONE_BOX);
  const pfPieceSec = Math.max(0.05, Math.round((100 * ctx.payoffTarget) / 12) / 100);
  const base = intBetween(ctx.rng, 1, 99999 - PF_FLOOR_TRIES);
  const modeSettings = modeSettingsOfSettings({ ...defaultSettings("perfectFit"), pfVariant: "pento", pfBoxes, pfPieceSec });
  const found = findPerfectFitRun({ targetDurationSec: 2 * ctx.payoffTarget, maxSeeds: PF_FLOOR_TRIES, modeSettings, outcome: { kind: "most-on-floor", clipSec: 2 * ctx.payoffTarget } }, base);
  return { pfBoxes, pfPieceSec, pfSeed: found.seed };
}

/** Classic's one ring, its ring sounds on (ring-at's flag): a pluck a bounce, the chord at the way out. */
function oneRingSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { wallCount: 1, gapSize: stepBetween(ctx.rng, 0.15, 0.25, 0.05), ballSpeed: stepBetween(ctx.rng, 420, 560, 10), rotationSpeed: stepBetween(ctx.rng, 0.8, 1.6, 0.1), ballRadius: intBetween(ctx.rng, 8, 11) };
}

/** Grow's fill that ends the run (fills-by's flag), drawn as the grow-fill recipe draws its growth. */
function growFinishSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return {
    growRate: forBucket(ctx, { short: intBetween(ctx.rng, 7, 10), standard: intBetween(ctx.rng, 5, 8), long: 3 }),
    ballSpeed: forBucket(ctx, { short: stepBetween(ctx.rng, 500, 650, 10), standard: stepBetween(ctx.rng, 450, 600, 10), long: stepBetween(ctx.rng, 150, 250, 10) }),
    ballRadius: intBetween(ctx.rng, 6, 9),
  };
}

/**
 * Journey's stages before HOME: a short clip's three, a standard one's four. None of the multiplier gates or the bullseye: their
 * badges ("SPEED x1.5") and score ("10 pts") would be more texts on screen, and a calm clip keeps one idea – the way home.
 */
const JOURNEY_SHORT = ["pegs,glass,funnel,home", "glass,pegs,funnel,home", "rings-s,glass,funnel,home"] as const;
const JOURNEY_STANDARD = ["rings-s,pegs,glass,funnel,home", "glass,pegs,rings-s,funnel,home", "pegs,glass,glass-l,funnel,home"] as const;
function journeySettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { journeyStages: pick(ctx.rng, ctx.bucket === "short" ? JOURNEY_SHORT : JOURNEY_STANDARD), journeyAutoStages: 0 };
}

/** Spiral Glass's channel of glass: fewer turns and a faster queue for a shorter clip (it clears 12–20 s in). */
function spiralGlassSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return ctx.bucket === "short" ? { sgTurns: 5, sgGlassHp: 1, sgSpeed: 2 } : { sgTurns: intBetween(ctx.rng, 3, 4), sgGlassHp: 2, sgSpeed: stepBetween(ctx.rng, 1.5, 2, 0.1) };
}

/**
 * Color Match's one ring of twelve segments in two colours, the ball switching colour every bounce, faster than the default (it is
 * out 17–36 s in: the standard length's): the outcome strategy's seed search picks the seed whose escape the clip cuts before.
 */
function colorMatchSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { colorMatchColorCount: 2, ballSpeed: stepBetween(ctx.rng, 600, 800, 10) };
}

/** Paint's fastest coverage on the sliders: the biggest ball, at the top speed, without gravity (95 % painted 21–33 s in). */
const PAINT_FAST: Partial<SimulatorSettings> = { ballRadius: 30, ballSpeed: 800, gravity: 0 };
// --- end of group A's settings

// --- templates --- (AI studio step 4) group B's own settings: seeded from the planner's context (its rng only), every value on its
// RANGES step, never clamped, no mode default changed
/**
 * The conveyor's belt into Classic's rings: one ball every 2–3 s, as many as bring the last one out near the payoff target (the
 * last ball is out about balls × interval + 6.5 s in, its ALL OUT! banner 1.5 s before the run ends: measured).
 */
function conveyorSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const cvInterval = stepBetween(ctx.rng, 2, 3, 0.5);
  return { cvInterval, cvMaxBalls: Math.max(3, Math.round((ctx.payoffTarget - 6.5) / cvInterval)) };
}
/**
 * --- templates --- (studio round 1, 12) The conveyor's own hook, from its own count: "7 balls. Will they all get out?"
 * (`own.conveyor`), which its ALL OUT! banner answers at the payoff, the run's last ball out. The count format's hook, "One ball. How
 * many by the end?", described a run that multiplies: the belt loads a new ball every 2–3 s and nothing multiplies, so "One ball." stood
 * over a second ball on the belt, and the number it asked for showed only in the banner's small grey line ("Loaded 7 / Escaped 7").
 * No payoff words of the format's ("7! 🤯") in either look: the mode's banner is the one ending.
 */
const CONVEYOR_OWN_COUNT = "its run ends 1.5 s after its last ball is out (ALL OUT!): the payoff, not a loop's end; its own hook states its count and asks whether they all get out ('7 balls. Will they all get out?'), which ALL OUT! answers – the format's 'One ball. How many by the end?' asked about a run that loads balls and never multiplies";

/**
 * Merge Ring's ladder: 5 tiers in a short clip, 6 in a standard one, the drop at the slider's strongest gravity (3: the first ball
 * lands in 0.95 s – at the default 1, 1.6 s, after G1's first second), the spacing from the payoff target (its final form comes
 * about 12.6 × the spacing in with 5 tiers, 30 × with 6: measured), a short clip's final form at 10.5 s at least so 2.5 s after it
 * leave its payoff at 80 % or later.
 */
function mergeRingSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const short = ctx.bucket === "short";
  const target = short ? Math.max(ctx.payoffTarget, 10.5) : ctx.payoffTarget;
  return { mrTiers: short ? 5 : 6, mrGravity: 3, mrInterval: Math.round((10 * target) / (short ? 12.6 : 30)) / 10 };
}

/**
 * The Maze: 3 or 4 balls, each painting its way in its own colour (the default paints every way red: watched, the balls are dots a
 * viewer cannot pick a colour by), in a maze of 8–10 columns in a short clip, 11–13 in a standard one – few enough for balls a
 * viewer can follow (the first one out 2–13 s in, 4–26 s: the seed search picks one whose exit the clip times).
 */
function mazeSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const cols = forBucket(ctx, { short: [8, 10], standard: [11, 13], long: [14, 16] });
  return { mzCols: intBetween(ctx.rng, cols[0], cols[1]), mzBalls: intBetween(ctx.rng, 3, 4), mzTrailOwn: true };
}

/** Territory's countdown, on its 5 s step, at or after the payoff target: its board's verdict comes as it ends (a cut clip ends 1 s before). */
function territorySettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { tyDuration: 5 * Math.ceil(ctx.payoffTarget / 5) };
}

/**
 * Land Claim's battle under its claim rule, each block recoloured in its hitter's colour: the land a side holds is there to see
 * with its HUD off (the knock rule's walls stay white, and who leads is a blind guess: watched). Two balls a side over 12–20 rows
 * in a short clip (its verdict 10–11 s in), no new balls in a standard one (22–31 s in, 2 or 3 a side): the default's verdict
 * comes before a clip cut before it can start (the recorder's 10 s).
 */
function landClaimSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const rule = { lcRule: "claim" as const };
  return ctx.bucket === "short" ? { ...rule, lcBalls: 2, lcRows: intBetween(ctx.rng, 12, 20) } : { ...rule, lcEvery: 0, lcBalls: intBetween(ctx.rng, 2, 3), lcRows: intBetween(ctx.rng, 12, 16) };
}

/**
 * Bullseye's board: a bigger bull (4–5 rings) in a short clip, a smaller one (6–7) in a standard one so the first bullseye comes
 * later, most of the pegs in play (chaos 0.6–0.75: the first shot hits one within G1's first second; at 0.3–0.5 a short clip's
 * first shot fell clear to the board in 1.3 s on 2 of 4 Shorts plans, measured), and 16 or 20 shots spaced to go on past a clip
 * cut at its payoff's 85 % (the payoff target's clip and 4 s).
 */
function bullseyeSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const rings = forBucket(ctx, { short: [4, 5], standard: [6, 7], long: [7, 8] });
  const byShots = ctx.bucket === "short" ? 16 : 20;
  return { byRings: intBetween(ctx.rng, rings[0], rings[1]), byChaos: stepBetween(ctx.rng, 0.6, 0.75, 0.05), byShots, byInterval: Math.round((10 * (ctx.payoffTarget / 0.85 + 4)) / byShots) / 10 };
}

/**
 * Bouncing Shapes' countdown: two squares at speeds 2 : 3, each counting down a hit at a time from twice the payoff target (the
 * faster one reaches zero, and stops still, about half its count's seconds in: measured), so the other counts on past the clip's
 * end. One shape would reach zero as its run ends (COUNTED DOWN!), shown for the recorder's 0.5 s only (G2 asks 0.8 s); the DVD
 * logo's corner comes 1.4–6 s in at a speed whose first bounce is within G1's first second (400 px/s), too soon for any length.
 */
function boxCountdownSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { boxShape: "square", boxShapeCount: 2, boxSpeedRatio: "2:3", boxCountdown: Math.round(2 * ctx.payoffTarget) };
}

/** Paddle Keep-Up's one life (no MISS! before the end): a weaker player in a short clip (GAME OVER 1–19 s in), a better one in a standard one (11–69 s). */
function paddleSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { pdMisses: 0, pdSkill: ctx.bucket === "short" ? stepBetween(ctx.rng, 0.7, 0.75, 0.05) : stepBetween(ctx.rng, 0.85, 0.9, 0.05) };
}
// --- end of group B's settings

// --- templates --- (AI studio step 5) group C's own settings: seeded from the planner's context (its rng only), every value on its
// RANGES step (snapStep: from the slider's least up, never to its most), no mode default changed
/** A clip of whole seconds whose payoff target is 85 % of it, the planner's band's middle (outcomeStrategy.ts atEndRecordingSec). */
const clipOfTarget = (payoffTarget: number) => atEndRecordingSec(payoffTarget);

/**
 * Chord Stars as one loop: the stars drawn in 85 % of the clip, every one closing on the same frame (star-set's moment, the
 * close), then the hold and the fade in the rest, so the clip ends on the loop's seam. The star set is the finder's own kind (a
 * random set of distinct point counts, scored by starSetScore: physics/starChords.ts), of 4–6 balls, with one star of as many
 * points as the drawing has seconds: a ball's first bounce comes a drawing's 1/n in, inside G1's first second (the set's best
 * that has one, of 40 drawn from the context's rng; the page's own set where none does).
 */
function starChordsSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const clip = clipOfTarget(ctx.payoffTarget);
  const scCycle = snapStep(0.85 * clip, RANGES.scCycle);
  const rest = Math.round(10 * (clip - scCycle)) / 10;
  const scHold = snapStep(0.4 * rest, RANGES.scHold);
  const scFade = Math.round(10 * (rest - scHold)) / 10;
  const scBalls = intBetween(ctx.rng, 4, 6);
  const base = intBetween(ctx.rng, 1, 0x7fffffff);
  let best: { stars: string; score: number } | null = null;
  for (let i = 0; i < SC_TRIES; i++) {
    const set = randomStarSet(scBalls, starRandom((base + Math.imul(0x9e3779b1, i)) | 0));
    const score = starSetScore(set);
    if (Math.max(...set.map((s) => s.n)) >= scCycle && (!best || score > best.score)) best = { stars: serializeStars(set), score };
  }
  return { scBalls, scCycle, scHold, scFade, ...(best ? { scStars: best.stars } : {}) };
}
/** The star sets a Chord Stars clip draws from (the finder searches up to SC_FINDER_TRIES; a template keeps its plan quick). */
const SC_TRIES = 40;

/**
 * Focus Shot: one volley a clip, its transit the payoff target in whole bars of its bed (transitOnBeat: converge-on-beat, the bed's
 * tempo is the transit's own), so the balls fired from one focus all land on the other at once 85 % in; two passes a loop, so the
 * loop's seam (its refire) comes after the clip (Export whole loops keeps the clip's length). Short clips only: a standard clip's
 * target (up to 25.5 s) asks a transit past the slider's 20 s.
 */
function ellipseFociSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const efTransit = snapStep(transitOnBeat(ctx.payoffTarget, EF_TEMPLATE_BAR_SEC).transitSec, RANGES.efTransit);
  return { efTransit, efPasses: 2, efCount: stepBetween(ctx.rng, 36, 72, 12) };
}
/** The bar a Focus Shot template's transit is whole bars of (s): four beats at 120 bpm. */
const EF_TEMPLATE_BAR_SEC = 2;

/** Spinning Hoops: the spin's ramp that brings every bead up at the payoff target (every bead up 0.92 × the ramp + 0.8 s in: measured). */
function hoopsSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { hpRamp: snapStep((ctx.payoffTarget - 0.8) / 0.92, RANGES.hpRamp) };
}

/**
 * Bouncing Orbs: the field resolves in phase at its cycle (resolves-at: the accented chord and the mode's IN PHASE banner), the
 * payoff target on the cycle's step; a field of 21 × 21 orbs, calmer than the default 33 × 33 (whose motion the render measured
 * at three times the Simple score's reference: watched).
 */
function orbGridSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { ogColumns: 21, ogRows: 21, ogCycle: snapStep(ctx.payoffTarget, RANGES.ogCycle) };
}

/**
 * Colour Sort: 40 balls a colour, nearly twice the default size, so a viewer sees each ball reach its band (at the default 90 small
 * ones the sort is a haze: watched), the balls' speed that sorts them about the payoff target in (the first sort about 3500 / speed
 * s in, ±25 % by seed: measured). The remix after it pulls every ball back to its start: the clip ends on that loop's seam.
 * The balls pass through each other (`csContacts` off): with contacts the browser's run of 160 touching balls parts from the
 * planner's Node run within seconds, and the page sorted 0.8–1.1 s before the plan's second, so the payoff's words came over the
 * remix (watched: page stills at the plan's seconds); without them both runs sort on the same frame (12.37 s on the seed watched).
 */
function colourSortSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { csPerColour: 40, csSize: 8, csContacts: false, csSpeed: snapStep(3500 / ctx.payoffTarget, RANGES.csSpeed) };
}

/**
 * The Double Pendulum's chaos fan: the fan's start spread that splits it about the payoff target in (a short clip's 10⁻⁵°: 7–24 s;
 * a standard one's 10⁻⁶°: 9–24 s, by seed: measured), played forward the whole clip (no palindrome back inside it).
 */
function doublePendulumSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { dpSpreadDeg: ctx.bucket === "short" ? 0.00001 : 0.000001, dpForwardSec: RANGES.dpForwardSec.max };
}

/**
 * Beat Machines: one loop a clip, so the clip ends on the loop's seam and loops back to its first frame: a loop of the clip's
 * whole seconds at 120 bpm (two beats a second), the marble xylophone's seeded phrase (no-tube-conflict: outcomeStrategy.ts) with
 * five marbles a tube, so about every other seed's phrase needs no spare (at the auto one a tube, none of 40 seeds: measured).
 */
function beatMachineSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { bmBpm: 120, bmLoopBeats: 2 * clipOfTarget(ctx.payoffTarget), bmPerTube: 5 };
}

/**
 * The Sound Vortex's ring release: two rings (6 and 12 balls), the last one swallowed at the payoff target on a bar line of its
 * 120 bpm bed (ring-on-bar: the finder's own sum, funnelSpinFinder.ts, on the sliders' steps – the wave interval's 0.1 s, the
 * friction's 0.001): the friction that takes about half the target to descend, the interval the rest.
 */
function vortexSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const waves = "6, 12";
  const hole = defaultSettings("vortex").vxHoleSize;
  const firstLap = defaultSettings("vortex").vxFirstLap;
  const bar = (4 * 60) / defaultSettings("vortex").bpm;
  const bars = Math.max(1, Math.round(ctx.payoffTarget / bar));
  const want = bars * bar;
  const step = 1 / 60;
  let best: { interval: number; friction: number; off: number } | null = null;
  const k0 = snapStep(0.25 / (0.5 * want), RANGES.vxSpinFriction);
  for (let j = -15; j <= 15; j++) {
    const friction = Math.round(1000 * (k0 + 0.001 * j)) / 1000;
    if (!(friction > 0)) continue;
    const descent = funnelDescentSteps(hole, friction, firstLap, step) * step;
    if (!Number.isFinite(descent) || descent >= want) continue;
    const interval = snapStep(want - descent, RANGES.vxWaveInterval);
    const off = Math.abs(ceilSteps(interval, step) + descent - want);
    if (!best || off < best.off - 1e-9) best = { interval, friction, off };
  }
  return { vxWaves: waves, ...(best ? { vxWaveInterval: best.interval, vxSpinFriction: best.friction } : {}) };
}

/**
 * Collision Playground: 100–140 orbs, a third to a half of the default 300 (watched: at 300 a mass of small orbs, no one bump to
 * follow; the orbs grow as they get fewer, so the circle stays full and its measured motion stays past the Simple score's
 * reference, its 5 points charged); every collision still a note.
 * --- templates --- (studio round 1, 11) The drop: its anti-collision switch at the payoff target's whole second (the setting's step),
 * where every orb turns a new colour and stops colliding, the screen flashes, ANTI-COLLISION comes up and an accented chord plays
 * (modes/collide.ts switchToAntiCollision): the one moment of its run that stands out, timed by the "fixed" strategy (planner.ts
 * payoffSecOf). Until then a bump is a note, as many a moment as the sound takes; the clip's last 1.5 s played what every moment
 * before them had (552 events against the run's busiest 540: 0 of 12 plans stood out).
 */
function collideSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  return { cpCount: stepBetween(ctx.rng, 100, 140, 20), cpAntiCollisionAt: Math.max(1, Math.round(ctx.payoffTarget)) };
}

/** Ball Drop's rain, looped: the balls fall through the board and in again at the top, so its notes never thin out (the atEnd payoff lands on a full board). */
const DROP_RAIN: Partial<SimulatorSettings> = { dropLoop: true };
// --- end of group C's settings

// --- templates --- (AI studio step 6) group D's own settings: seeded from the planner's context (its rng only), every value on its
// RANGES step (from the slider's least up, never to its most), no mode default changed
/** `value` on its slider's step, at least `value`. */
function stepAtLeast(value: number, range: { min: number; max: number; step: number }): number {
  const v = snapStep(value, range);
  return v < value - 1e-9 ? snapStep(v + range.step, range) : v;
}

/** The years Earth and Venus draw their five-petal flower in: 8 (13 Venus years), five conjunctions (the default). */
const DM_FLOWER_YEARS = 8;
/** The drawing's hold past the clip's end (s): the rewind, which un-draws it, never starts inside the clip. */
const DM_HOLD_PAST_SEC = 0.5;
/**
 * How far into the payoff (s, at least) the planets still draw: the crew's G2 reads the moment from 0.25 s before the payoff to 0.5 s
 * after it (lib/insights/score.ts MOMENT_BEFORE_SEC, MOMENT_AFTER_SEC), and a hold from before it is a still, silent moment there –
 * the bed plays on, but no pluck: the last conjunction's comes 1.6 years before the flower closes (measured: 3 of 12 plans failed
 * G2 with the drawing done 0–0.4 s before the payoff).
 */
const DM_DRAW_INTO_PAYOFF_SEC = 0.25;

/**
 * Drawing Machines' orbits (the harmonograph's figure is no picture a viewer could name: watched): Earth and Venus over their 8
 * years, a line between them every few days, so a five-petal flower comes out of the lines – the picture the hook asks to guess.
 * The years' pace on its slider's step, up, so the last lines are drawn as the clip's last 1.5 s begin (atEnd, the payoff) and the
 * flower is done 0.25–0.65 s into them; the hold on its step, up, past the clip's end, so the rewind that un-draws it comes after
 * the clip. Its cycle (draw, hold, rewind) is then longer than the clip, which Export whole loops records at its set length.
 * --- templates --- (step 2's review round 1, 14) Its "Join the marks" switch off (dmPentagram, a drawn-only setting: the run, its
 * sounds and the mode's default stay as they were): on, five bright lines joined the conjunction marks into a five-pointed star in
 * the orbit's circle, the picture a stranger saw first – a pentacle, which some read as an occult sign –, while the notes and the
 * scene line named the flower. The marks stay; the flower is the reveal. Whether to post the star is the owner's call.
 */
function drawingMachineSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const clip = clipOfTarget(ctx.payoffTarget);
  const dmSecPerYear = stepAtLeast((clip - AT_END_SEC + DM_DRAW_INTO_PAYOFF_SEC) / DM_FLOWER_YEARS, RANGES.dmSecPerYear);
  const dmHold = stepAtLeast(clip - DM_FLOWER_YEARS * dmSecPerYear + DM_HOLD_PAST_SEC, RANGES.dmHold);
  return { dmMachine: "orbits", dmYears: DM_FLOWER_YEARS, dmSecPerYear, dmHold, dmPentagram: false };
}

/**
 * Circle Illusion's lines, its run a fixed length: whole cycles of the rolling circle (4 s each at its default tempo), as many as
 * cover the clip, so its COMPLETE! banner comes after the clip (illusion.ts illusionFixedDurationSec). Experimental: no picture to
 * guess (EXPERIMENTAL.illusion).
 */
function illusionSettings(ctx: RecipeContext): Partial<SimulatorSettings> {
  const cycle = illusionCycleSeconds({ type: "lines", speed: defaultSettings("illusion").ilSpeed });
  return { ilType: "lines", ilCycles: Math.max(1, Math.ceil(clipOfTarget(ctx.payoffTarget) / cycle - 1e-9)) };
}

/**
 * A Mode Lab game as its template plays it: the catalog's entry (`blPreset`), with its own sliders as the catalog sets them. Each
 * is one variant of the Mode Lab's binding (MODE_TEMPLATES.blueprint), its hook the game's own rule (`ViralBot.ownHooks.<id>`), its
 * series the game's own (Colour Conquest is a battle), its payoff the moment its finish rule fires (planner.ts MARK_MODES: the
 * game's end banner, held 1.5 s before its run ends).
 */
const labGameVariant = (id: BlueprintCatalogId): VariantOwn => ({ patch: { blPreset: id }, family: catalogBlueprint(id).meta.family, hookKey: `own.${id}`, scene: () => LAB_GAME_SCENES[id] });
/**
 * The length each game fills, from when its finish rule fires (bp-check's medians): Glass Hatchery's shell is cleared about 17 s in
 * and Tier Climb's tier 8 about 25 s in, so their seed search found no seed in a short clip (0 of 4 Shorts plans each) – the standard
 * length; Ring Breaker's rings are down about 8 s in, Colour Conquest's last colour stands about 8 s in, Peg Race's first ball is out
 * about 9 s in and Grow or Go ends about 14 s in, so a standard clip took the seeds that drag – four balls waiting 8 s for the last
 * rings, the racers resting 10 s on the bowl's floor for the exit, a ball 4 bounces big after 17 s (watched) – the short length.
 */
const LAB_GAME_BUCKETS: Readonly<Record<BlueprintCatalogId, readonly LengthBucket[]>> = { hatchery: ["standard"], ringBreaker: ["short"], conquer: ["short"], tierClimb: ["standard"], plinkoRace: ["short"], growEscape: ["short"] };
/**
 * The games hidden after they were watched, each with its reason: Colour Conquest's 24 balls collide and convert each other, and the
 * page's run of them parted from the planner's – rendered twice, its run ended 0.8 s after the plan's finish once, and the other time
 * had two colours left at the clip's end (13 s, the plan's last colour standing 11 s in), so its ending never came (watched). The
 * planner times a payoff on its own run of the seed (docs/agents/STUDIO.md, known gaps: the page's run and the planner's).
 */
const LAB_GAME_HIDDEN: Readonly<Partial<Record<BlueprintCatalogId, string>>> = {
  conquer: "its 24 balls collide and convert each other, and the page's run parted from the planner's: rendered twice, it ended 0.8 s after the planned finish once and had two colours left at the clip's end the other time (13 s; planned to end 11 s in), so its ending never came (watched)",
};
/** What the viewer's screen view sees of each game, in neutral words. */
const LAB_GAME_SCENES: Readonly<Record<BlueprintCatalogId, string>> = {
  hatchery: "one ball inside a round shell of glass tiles, six layers deep",
  ringBreaker: "one ball inside eight spinning rings, each with one gap",
  conquer: "balls in four colours bouncing inside a circle",
  tierClimb: "small orbs raining into a round bowl",
  plinkoRace: "four balls in four colours dropping through pegs into a bowl with one turning exit",
  growEscape: "one ball inside a turning rim with one gap",
};
// --- end of group D's settings

// --- templates --- why a binding is in the experimental table
/**
 * --- templates --- (studio round 1, 10) Perfect Fit's box is full from its last piece's landing to its burst, the 0.15 s of its flash
 * (polyominoPlan.ts PF_FLASH_SEC; on the beat, a beat's share of it): the scatter and the fade after it show the pieces flying out of
 * an emptying box, and the next loop's tray fading in. So a resolved clip shows the full box – the fill format's promise – for that
 * flash only, under the 0.8 s the crew's G2 asks a payoff to be shown, as Paint's fill (the recorder's 0.5 s) and Grow's fill that
 * ends its run; and its "Full!" came at the half second before the box was full, the last piece still falling (watched). No setting
 * holds the box full longer: 0 of 12 plans pass (G2, the payoff's state held 0.1 s).
 */
const PERFECT_FIT_FLASH = "its box is full only for the 0.15 s flash between its last piece's landing and its burst (polyominoPlan.ts PF_FLASH_SEC), so a resolved clip shows the fill that long, under the 0.8 s G2 asks, as Paint's fill; no setting holds it longer: 0 of 12 plans passed (4 plan seeds × 3 platforms; watched: 'Full!' came while the last piece was falling, the box burst a flash after it filled)";
/**
 * --- templates --- (studio round 1, 11) The beat format's payoff is the drop or the last bar: a moment that stands out from the run (the
 * crew's G2, clarity.ts beatStandsOut). Beat Machines' marble phrase is one note at a time, its motifs over again (A, A', B, A, A, A':
 * beatMachinePlan.ts), so the note its payoff was timed by – the loop's note nearest 85 % – was the bar heard at 2 s and 14 s, as loud
 * (measured on two renders: 18.0–18.75 s matched 2.0–2.75 s and 14.0–14.75 s to 0.1 dB), with no payoff words and a still picture;
 * the tonic at the loop's end is one more note. No setting accents a bar of it.
 */
const BEAT_MACHINE_PLAIN = "its marble phrase is one note at a time, its motifs over again, so the payoff (the loop's note nearest 85 %) repeats the bar heard twice before it, as loud, with no chord or accent – nothing a viewer could tell from the rest (measured on two renders: 18.0-18.75 s matched 2.0-2.75 s and 14.0-14.75 s to 0.1 dB); no setting accents a bar: 0 of 12 plans stand out (G2)";
/**
 * --- templates --- (studio round 1, 11) The Wave Tank's bells strike at the scan's rate from its first second to its last, one at a time:
 * the clip's last 1.5 s (atEnd) play what every moment before them played (7 strikes a moment against the run's busiest 7).
 */
const WAVE_TANK_PLAIN = "its bells strike at the scan's rate from the first second to the last, one at a time: the clip's last 1.5 s, its payoff, play what every moment before them played (7 strikes against the run's busiest 7), no chord, no accent; 0 of 12 plans stand out (G2)";
/**
 * --- templates --- (studio round 1, 11) Ball Drop's rain, looped (DROP_RAIN), plays as many notes at the clip's end as at its busiest
 * moments before, one at a time: its last 1.5 s are one more stretch of rain (19–46 notes a moment against the run's busiest 25–41).
 */
const DROP_PLAIN = "its rain, looped, plays as many notes at the clip's end as at its busiest moments before, one at a time: its last 1.5 s, the payoff, are one more stretch of rain (19-46 notes a moment against the run's busiest 25-41), no chord, no accent; 0 of 12 plans stand out (G2)";
/**
 * --- templates --- (AI studio step 3) Paint's run ends the moment 95 % is painted (picturePaint.ts COVERAGE_DONE): a resolved clip
 * shows it for the recorder's 0.5 s only (G2 asks 0.8 s), and the fill format ends resolved only – measured: 0 of 12 plans pass.
 */
const PAINT_ENDS_AT_FILL = "its run ends the moment 95 % is painted, so a resolved clip shows the fill for the recorder's 0.5 s only (G2 asks 0.8 s), and the fill format ends resolved only: 0 of 12 plans passed (4 plan seeds × 3 platforms)";
/** --- templates --- (AI studio step 3) Grow's fill that ends the run, likewise (its fills-by variant). */
const GROW_ENDS_AT_FILL = "with Grow's fill ending the run (fills-by's flag) the clip shows the fill for the recorder's 0.5 s only (G2 asks 0.8 s), and the fill format ends resolved only: 0 of 12 plans passed; the grow-fill recipe's ring goes on after its fill";
/**
 * --- templates --- (AI studio step 4b) Spiral Glass with its own overlay off (the setting `sgHud`): step 3 hid it because its question
 * "Will the ball multiply?" over the spiral, its title, its tiles left and a progress ring in the corners stayed for the whole run,
 * which no setting switched off then. With them off, the badge at the spiral's entrance counts the balls as they multiply, and GLASS
 * CLEARED – the clear, with the balls' count and the time, 2 s before the run's end – is the payoff and its one ending. Resolved only:
 * a cut clip's closing question ("One more hit?") would ask a second question.
 * --- templates --- (studio round 1, 8) Its hook asks what GLASS CLEARED answers: "Can it clear all the glass?" (`own.spiralGlass`). The
 * overlay's own question, "Will the ball multiply?", was answered by the badge's first x2 – 44–51 % into the clip, outside the payoff
 * band, measured on two renders – and the ending then answered another question. No payoff words of the format's ("Smashed.") beside
 * the mode's banner, in either look.
 * --- templates --- (studio round 1, 9) The overlay is off in both looks (`tune`): in the bot look, the website's default, the series
 * label sat on the overlay's question for the whole clip, the two lines drawn into one ("WiSmashll mDay1ly?", watched).
 */
const SPIRAL_SIMPLE = "its own overlay off in both looks (sgHud: no title, tiles left, progress ring or question over the spiral); the hook asks what its ending answers ('Can it clear all the glass?'), the badge at the entrance counts the balls, and GLASS CLEARED, 2 s before the run's end, is the payoff and its one ending (planner.ts payoffSecOf), with no words of the format's beside it; resolved only, as a cut clip's closing question would ask a second one";
/**
 * --- templates --- (AI studio step 4b) The Journey with its own overlay off (the setting `journeyHud`): step 3 hid it because a banner
 * as each stage began ("Stage 3/5: Rings"), the stage names, a mini-map and a clock crowded the screen and its HOME! card stood beside
 * the payoff's words, none of which a setting switched off then. With them off, Gerald heads for the door marked HOME (the door's
 * sign is the picture's and stays), the hook asks the format's hook b ("Will Gerald make it home?") and the payoff's own words say
 * HOME where the card did ("Home! 🏠": its HOME is Glass Smash's, the chord, then 1.8 s of celebration). Resolved only: a cut clip's
 * closing question ("Out or not?") would ask another question than the hook.
 * --- templates --- (studio round 1, 9) The overlay is off in both looks (`tune`): in the bot look, the website's default, the hook sat on
 * the stage banner ("Stage 1/5: Pegs") and the ending stacked "Home! 🏠", the HOME! card, the door's sign, the mini-map and the clock
 * (watched).
 */
const JOURNEY_SIMPLE = "its own overlay off in both looks (journeyHud: no stage banners or names, mini-map, clock or HOME! card); Gerald heads for the door marked HOME (hook b 'Will Gerald make it home?'), and the payoff's own words say HOME where the card did ('Home! 🏠'); resolved only, as a cut clip's 'Out or not?' would ask another question";
/**
 * --- templates --- (studio round 1, 9) The settings that switch a mode's own overlay off (crew/hudFlags.ts HUD_FLAGS), which its template
 * plays in both looks (a binding's `tune`): the Simple look would switch them off anyway; the bot look keeps the series label at the top,
 * where the overlay draws its own words.
 */
const JOURNEY_OVERLAY_OFF: Partial<SimulatorSettings> = { journeyHud: false };
const SPIRAL_OVERLAY_OFF: Partial<SimulatorSettings> = { sgHud: false };
/**
 * --- templates --- (AI studio step 4) Merge Ring plans (its final form the payoff, 12 of 12 a language), but it draws a question of
 * its own under the ring for the whole run ("Will it merge into its final form?"), with its title, its merge count, its top size
 * and its ladder of sizes, which no setting switches off: a template's hook stacks a second question over it, as Spiral Glass's did
 * until its overlay switch (AI studio step 4b).
 */
const MERGE_RING_OWN_TEXT = "it draws a question of its own under the ring for the whole run (\"Will it merge into its final form?\"), with its title, its merge count, its top size and its ladder of sizes, which no setting switches off: a template's hook stacks a second question over it (watched in the render; its plans pass every gate, 12 of 12 a language)";
/**
 * --- templates --- (AI studio step 4) Paddle Keep-Up plans (its GAME OVER the payoff, 12 of 12 a language), but its score, lives
 * and streak sit in a band over its ceiling, the top of the square, which no setting switches off and the canvas does not start
 * the top captions below (Canvas.tsx modeTopHud: Paddle adds none): the hook covers the score for its 2.5 s (watched); at the bottom
 * it would cover the paddle.
 */
const PADDLE_OWN_HUD = "its score, lives and streak sit in a band over its ceiling at the top of the square, which no setting switches off and the canvas does not start the top captions below (Canvas.tsx modeTopHud: Paddle adds none): the hook covers the score for its 2.5 s (watched in the render), and at the bottom it would cover the paddle (its plans pass every gate, 12 of 12 a language)";
/** --- templates --- (AI studio step 3) A run that ends with its payoff (the escape, the last segment, the glass cleared): cut before it. */
const ENDS_AT_FINISH = "the run ends with its payoff (a resolved clip shows it for 0.5 s, G2 asks 0.8 s): the template cuts before it";

/**
 * --- templates --- (AI studio step 5) Beat Runner's first note: its square runs a second before its first take-off (runner.ts
 * LEAD_IN_SEC), then flies to a beat, so its first landing, its first note, comes 1.5 s in on every seed and setting – G1 asks a
 * first impact within 1 s, as the square race's count-in fails it. Its level is also its recording: LEVEL COMPLETE comes 0.5 s
 * before the clip's last frame (measured: 0 of 12 plans pass, each failing G1 and G2).
 */
const RUNNER_LEAD_IN = "its square runs a second before its first take-off (runner.ts LEAD_IN_SEC) and lands on a beat after it, so its first note, the plan's first impact, comes 1.5 s in on every plan and no setting moves it (G1 asks 1 s); its level is its recording, so LEVEL COMPLETE comes 0.5 s before the clip's end (G2): 0 of 12 plans passed";

/**
 * --- templates --- (AI studio step 5) Beat Drop plans (12 of 12, the clip's end its payoff: its run is its recording), but it draws a
 * HUD of its own at the top left of the square – its title, the tempo, the landings on the beat and the bar's four dots –, which no
 * setting switches off and the canvas does not start the top captions below: the hook covers its title for 2.5 s (watched), as
 * Paddle Keep-Up's score band (step 4).
 */
const BEAT_DROP_OWN_HUD = "it draws a HUD of its own at the top left of the square (BEAT DROP, the tempo, the landings on the beat and the bar's dots), which no setting switches off and the canvas does not start the top captions below: the hook covers its title for 2.5 s (watched in the render; its plans pass every gate, 12 of 12 a language)";
/**
 * --- templates --- (AI studio step 5) The Sound Vortex's ring release plans (12 of 12, its last ring swallowed on a bar line), but it
 * writes its own title in the corner – "why marbles speed up in a funnel", and the stagger release its own –, which no setting
 * switches off (with the loop HUD off the funnel draws it itself): the hook stacks over it (watched).
 */
const VORTEX_OWN_TITLE = "it writes a title of its own at the top left of the square for the whole run (the ring release's \"why marbles speed up in a funnel\"; with the loop HUD off the funnel draws it itself), which no setting switches off: the hook stacks over it (watched in the render; its plans pass every gate, 12 of 12 a language)";

/**
 * --- templates --- (AI studio step 6) Lines plans (12 of 12, the clip's last 1.5 s its payoff), but its string art is tied to the ball:
 * the canvas strokes a string from every bounce point to the moving ball, so the strings make a fan that follows it and never a
 * picture (watched: a ball and its fan at 1 s, a denser fan at 20 s). The reveal format's hooks ask to guess a picture ("Guess what it
 * draws."), and the run has none to show.
 */
const LINES_NO_PICTURE = "its plans pass every gate (12 of 12, the clip's last 1.5 s), but its strings run from every bounce point to the moving ball, so they make a fan that follows the ball and never a picture (watched: 1-20 s); the reveal format's hooks ask to guess a picture it never draws";
/**
 * --- templates --- (AI studio step 6) Circle Illusion. Its lines and rings types run a fixed length (its cycles), and plan (12 of 12 at
 * the clip's end), but draw no picture to guess (watched): the rolling circle the lines make is there from the first second, and the
 * rings line up every cycle – a line-up, not a reveal. The white-spaces type hides a picture (a heart, a star) and reveals it as its
 * run ends, shown for the recorder's 0.5 s only (G2 asks 0.8 s), and the reveal format ends resolved only – as Paint's fill.
 */
const ILLUSION_NO_REVEAL = "its lines and rings types run a fixed length and plan (12 of 12 at the clip's end), but show no picture to guess (watched: the rolling circle is there from the first second, the rings line up every cycle, a line-up); its white-spaces type's hidden picture is revealed as its run ends, shown for the recorder's 0.5 s only (G2 asks 0.8 s): 0 of 12 plans passed, as Paint's fill";

/**
 * --- templates --- The experimental table: the bindings the planning acceptance has not passed – hidden from every menu, never
 * ready –, each with its reason. Shrink only: tests/botTemplates.test.ts pins it, so a binding leaves it when it passes (with its
 * settings, its copy and the test that plans it) and none joins it without a reviewed change of that pin – the studio's first
 * review round made three such changes (Perfect Fit, Beat Machines, the Wave Tank: a payoff never seen held, or never heard
 * standing out). All 32 bindings without
 * a recipe started here; AI studio step 3 passed five (Shatter, Color Match, Target, Brick Smash, Perfect Fit) and gave Journey,
 * Paint and Spiral Glass their measured reasons; step 4 passed six (the conveyor, the Maze, Territory, Land Claim, Bullseye,
 * Bouncing Shapes) and gave Merge Ring and Paddle Keep-Up theirs; step 4b passed the Journey and Spiral Glass, once a setting
 * switched off what they draw of their own (their reasons, which no setting could answer then, are their notes now); step 5
 * passed nine (Chord Stars, Focus Shot, Spinning Hoops, Bouncing Orbs, Colour Sort, the Double Pendulum Harp, Beat Machines,
 * Collision Playground, Wave Tank) and gave Beat Drop, Beat Runner and the Sound Vortex theirs; step 6 passed the Drawing Machine
 * and Mode Lab, and gave Lines and Circle Illusion theirs – every binding is now ready or here with what was measured and watched.
 */
export const EXPERIMENTAL: Readonly<Partial<Record<ModeId, string>>> = {
  paint: PAINT_ENDS_AT_FILL,
  mergeRing: MERGE_RING_OWN_TEXT,
  paddle: PADDLE_OWN_HUD,
  beatDrop: BEAT_DROP_OWN_HUD,
  runner: RUNNER_LEAD_IN,
  vortex: VORTEX_OWN_TITLE,
  lines: LINES_NO_PICTURE,
  illusion: ILLUSION_NO_REVEAL,
  // --- templates --- (studio round 1, 10 and 11) taken out after a review: a payoff a viewer never sees held, or never hears stand out
  perfectFit: PERFECT_FIT_FLASH,
  beatMachine: BEAT_MACHINE_PLAIN,
  waveTank: WAVE_TANK_PLAIN,
};

/**
 * Every mode's binding (the plan's coverage: getOut 7, smash 4, fill 3, count 4, whoWins 8, aim 3, lineUp 8, onTheBeat 7,
 * reveal 3, labGame 1 – 48 of 48). Looping modes never bind to "finish" (it never fires there).
 */
export const MODE_TEMPLATES: Readonly<Record<ModeId, ModeBinding>> = {
  // getOut
  classic: bind("classic", {
    format: "getOut",
    strategy: "escape",
    tier: "proven",
    keepHud: null,
    variants: [["ring-escape"], ["pip-escape", "gerald"], [null, "ring", undefined, undefined, { strategy: "outcome", outcome: "ring-at", needs: "ringEscape", generate: oneRingSettings, hookKey: "hook", scene: () => "one ball inside one spinning ring with one gap", note: "one ring with the Ring Escape sounds: its first ring is its way out (ring-at)" }]],
  }),
  accumulation: bind("accumulation", { format: "getOut", strategy: "escape", tier: "proven", keepHud: null, variants: [["ring-escape"]], buckets: ["short", "standard"], endings: ["cliffhanger"], note: `a minute-long escape needs Classic's slow grind; ${ENDS_AT_ESCAPE}` }),
  portal: bind("portal", { format: "getOut", strategy: "escape", tier: "proven", keepHud: null, variants: [["ring-escape"], ["pip-escape", "gerald", undefined, GERALD_PORTAL_BUCKETS]], buckets: ["short", "standard"], endings: ["cliffhanger"], note: `a minute-long escape needs Classic's slow grind; ${ENDS_AT_ESCAPE}` }),
  glass: bind("glass", { format: "getOut", strategy: "finish", tier: "proven", keepHud: null, variants: [["glass-smash"]], note: "home is the way out: 'Will Gerald make it home?'" }),
  shatter: bind("shatter", later("getOut", "outcome", { outcome: "escapes-at", generate: shatterSettings, buckets: ["short", "standard"], endings: ["cliffhanger"], hookKey: "hook", note: ENDS_AT_ESCAPE })),
  colorMatch: bind("colorMatch", later("getOut", "outcome", { outcome: "escapes-at", generate: colorMatchSettings, buckets: ["standard"], endings: ["cliffhanger"], hookKey: "hook", note: ENDS_AT_ESCAPE, scene: (s) => `one ball inside a ring of 12 segments in ${s.colorMatchColorCount} colours, a counter in the middle` })),
  journey: bind("journey", later("getOut", "finish", { generate: journeySettings, tune: JOURNEY_OVERLAY_OFF, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hookB", payoffKey: "ownPayoff.journey", character: true, note: JOURNEY_SIMPLE, scene: (s) => `one ball with a face at the top of a column of ${s.journeyStages.split(",").length - 1} stages, a door marked HOME at the bottom` })),
  // smash
  powerLayers: bind("powerLayers", { format: "smash", strategy: "fixed", tier: "proven", keepHud: null, variants: [["power-layers"]], note: "the layer count is the mode's own HUD" }),
  target: bind("target", later("smash", "finish", { generate: targetSettings, buckets: ["short", "standard"], endings: ["cliffhanger"], hookVars: (s) => ({ count: s.targetCount }), note: ENDS_AT_FINISH, scene: (s) => `one ball inside a ring of ${s.targetCount} numbered segments, a big number in the middle` })),
  brickRebuild: bind("brickRebuild", later("smash", "outcome", { outcome: "bricks-cleared-by", generate: brickSmashSettings, buckets: ["short", "standard"], note: "loops forever: never 'finish'", scene: () => "a few small balls under a wall of bricks that draws a picture" })),
  spiralGlass: bind("spiralGlass", later("smash", "finish", { generate: spiralGlassSettings, tune: SPIRAL_OVERLAY_OFF, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "own.spiralGlass", payoffWords: false, note: SPIRAL_SIMPLE, scene: () => "balls running along a spiral channel of frosted glass, a badge with a number at its entrance" })),
  // fill
  grow: bind("grow", { format: "fill", strategy: "fill", tier: "proven", keepHud: null, variants: [["grow-fill", undefined, undefined, GROW_FILL_BUCKETS], [null, "fills", GROW_ENDS_AT_FILL, undefined, { strategy: "outcome", outcome: "fills-by", needs: "growFinish", generate: growFinishSettings, note: "the fill that ends the run (fills-by)" }]] }),
  paint: bind("paint", later("fill", "finish", { patch: PAINT_FAST, note: "95 % painted" })),
  perfectFit: bind("perfectFit", later("fill", "outcome", { outcome: "most-on-floor", needs: "pfPento", generate: perfectFitSettings, buckets: ["short", "standard"], note: "one box, its tiling with the most pieces on the floor; landings-on-beat would need the page's tempo", scene: () => "twelve puzzle pieces in a tray at the top, an empty rectangular box below them" })),
  // count
  multiply: bind("multiply", { format: "count", strategy: "fill", tier: "proven", keepHud: null, variants: [["clone-per-pass"]] }),
  multipliers: bind("multipliers", { format: "count", strategy: "finish", tier: "proven", keepHud: null, variants: [["multipliers-board"]], note: "the ball counter at home is the mode's own HUD" }),
  // (--- templates --- AI studio step 4: the plan had both on atEnd, as loops; the code's both end – the conveyor once its last ball is
  // out, Merge Ring 2 s after its final form or an overflow –, so each is timed by its own moment, its run's end inside the clip)
  conveyor: bind("conveyor", later("count", "finish", { generate: conveyorSettings, buckets: ["standard"], hookKey: "own.conveyor", payoffWords: false, hookVars: (s) => ({ count: s.cvMaxBalls }), note: CONVEYOR_OWN_COUNT, scene: () => "a belt at the top drops balls one by one into rings with turning gaps, a counter in the top right corner" })),
  mergeRing: bind("mergeRing", later("count", "finish", { generate: mergeRingSettings, buckets: ["short", "standard"], hookKey: "own.mergeRing", note: "its run ends 2 s after its final form (FINAL FORM): the payoff, not a loop's end; hook 'How far can it merge?'", scene: () => "balls of numbered sizes dropping through a chute into a ring, where two of a size fuse into a bigger one" })),
  // whoWins (the battle family: offered only where the battle family is asked for, as the daily bot's BOT_DEFAULT_FAMILIES)
  race: bind("race", { format: "whoWins", strategy: "finish", tier: "proven", keepHud: null, variants: [["square-race", undefined, COUNT_IN]], note: "it waits for a race whose gate opens within the first second" }),
  ctf: bind("ctf", { format: "whoWins", strategy: "finish", tier: "proven", keepHud: null, variants: [["territory"]] }),
  battle: bind("battle", { format: "whoWins", strategy: "finish", tier: "proven", keepHud: null, variants: [["battle-royale"]] }),
  stringBattle: bind("stringBattle", { format: "whoWins", strategy: "winner", tier: "proven", keepHud: "sbHud", variants: [["string-battle"]] }),
  fightLeague: bind("fightLeague", {
    format: "whoWins",
    strategy: "winner",
    tier: "proven",
    keepHud: "flHud",
    variants: [["fight-duel"], ["fight-upset", "upset"], ["fight-bracket", "bracket"], ["fight-boss", "boss", undefined, undefined, { hookKey: "hookB" }]],
    note: "third-party names: the battle family's legal opt-in",
  }),
  maze: bind("maze", later("whoWins", "outcome", { outcome: "winner", generate: mazeSettings, buckets: ["short", "standard"], hookKey: "hook", note: "first one out (outcomeStrategy.ts OWN_RUN_MODE_MOMENTS)", scene: (s) => `${s.mzBalls} balls in ${s.mzBalls} colours dropping into a glowing green maze, an exit at the bottom` })),
  territory: bind("territory", later("whoWins", "outcome", { outcome: "winner", generate: territorySettings, buckets: ["short", "standard"], endings: ["cliffhanger"], hookKey: "hook", note: `its board's verdict comes as its countdown ends; ${ENDS_AT_FINISH}`, scene: (s) => `a board of tiles in ${s.tyTeams} colours, balls of each colour bouncing over it and painting it` })),
  landClaim: bind("landClaim", later("whoWins", "outcome", { outcome: "winner", generate: landClaimSettings, buckets: ["short", "standard"], endings: ["cliffhanger"], hookKey: "hook", note: `or close; ${ENDS_AT_FINISH}`, scene: (s) => `columns of white blocks around an arena, balls in ${s.lcTeams} colours painting each block they hit in their colour` })),
  // aim (--- templates --- AI studio step 4: each timed by its run's own moment, planner.ts MARK_MODES)
  bullseye: bind("bullseye", later("aim", "finish", { generate: bullseyeSettings, buckets: ["short", "standard"], hookKey: "hookB", note: "'Will one hit the bullseye?': the first bullseye, its BULLSEYE! callout", scene: () => "balls fired from the top, one after another, through a few pegs onto a dartboard lying at the bottom" })),
  box: bind("box", later("aim", "finish", { generate: boxCountdownSettings, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "own.box", payoffWords: false, hookVars: (s) => ({ count: s.boxCountdown, zero: 0 }), note: "the countdown hook ('It stops at zero.'): the first shape at zero (planner.ts MARK_MODES); its corner comes too soon for any length", scene: (s) => `${s.boxShapeCount} squares gliding in straight lines inside a tall box, each showing a number` })),
  paddle: bind("paddle", later("aim", "finish", { generate: paddleSettings, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hookC", payoffWords: false, payoffType: "gameOver", note: "'How long can it last?': one life, its GAME OVER", scene: () => "one ball bouncing on a platform near the bottom that slides left and right to catch it" })),
  // lineUp
  pendulum: bind("pendulum", { format: "lineUp", strategy: "cycle", tier: "proven", keepHud: null, variants: [["pendulum-wave"]], tune: PENDULUM_TUNE, hookAsk: "cliffQuestion", note: "the hook asks whether they line up (its chord plays at the release and every half cycle too, so it promises none); every bob sounds at its turning points, so the realignment is one accented chord; pendulums in a row, so 'back in line' is a line" }),
  polyrhythm: bind("polyrhythm", { format: "lineUp", strategy: "cycle", tier: "proven", keepHud: null, variants: [["polyrhythm"]] }),
  // (--- templates --- AI studio step 5: group C, each its mode's own notes the music – musicFirst –, timed by its run's moment)
  starChords: bind("starChords", later("lineUp", "outcome", { outcome: "star-set", generate: starChordsSettings, musicFirst: true, buckets: ["short"], endings: ["resolved"], hookKey: "hookC", note: "one loop a clip: every star closes on the same frame 85 % in, then the hold and the fade to the loop's seam (star-set's close, a run of its own)", scene: (s) => `${s.scBalls} small balls inside one circle, each drawing a star of straight lines` })),
  ellipseFoci: bind("ellipseFoci", later("lineUp", "outcome", { outcome: "converge-on-beat", generate: ellipseFociSettings, musicFirst: true, buckets: ["short"], endings: ["resolved"], hookKey: "hook", note: "one volley: fired from one focus, every ball lands on the other at once, its transit whole bars of its bed (a run of its own)", scene: (s) => `${s.efCount} small balls at one point inside an oval, fired outwards all at once` })),
  hoops: bind("hoops", later("lineUp", "outcome", { outcome: "all-up-by", generate: hoopsSettings, musicFirst: true, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hook", note: "the spin ramps up until every bead has climbed (all-up-by)", scene: (s) => `${s.hpCount} hoops of different sizes spinning slowly, a bead resting at the bottom of each` })),
  orbGrid: bind("orbGrid", later("lineUp", "outcome", { outcome: "resolves-at", generate: orbGridSettings, musicFirst: true, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hookC", note: "the field bounces out of step until it lands in phase at its cycle (resolves-at, the accented chord)", scene: () => "a large square field of small orbs, each bouncing on its own spot" })),
  colourSort: bind("colourSort", later("lineUp", "outcome", { outcome: "sorted-by", needs: "colourSortSettles", generate: colourSortSettings, musicFirst: true, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hook", note: "a gate rule whose sort completes (the default's), timed by the balls' speed", scene: (s) => `${s.csColours * s.csPerColour} balls of ${s.csColours} colours mixed together inside rings with gaps` })),
  doublePendulum: bind("doublePendulum", later("lineUp", "outcome", { outcome: "diverges-at", needs: "dpFan", generate: doublePendulumSettings, musicFirst: true, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "own.doublePendulum", note: "its own hook, the plan's hook b: 'Same start. Watch them split.' (the chaos fan, played forward)", scene: (s) => `${s.dpFanCount} double pendulums started on top of one another, swinging over a row of strings` })),
  // onTheBeat (--- templates --- AI studio step 5: Ball Drop's rain loops, so its notes never thin out; the clip's end is its payoff)
  drop: bind("drop", { format: "onTheBeat", strategy: "atEnd", tier: "proven", keepHud: null, variants: [["drop-symphony", undefined, DROP_PLAIN]], tune: DROP_RAIN, note: DROP_FADES }),
  beatDrop: bind("beatDrop", later("onTheBeat", "atEnd", { musicFirst: true, hookKey: "hookB", note: "its run is its recording: the last landing a second before the clip's end, its banner on it (atEnd: the plan's 'finish' never comes before the clip does)", scene: () => "one ball bouncing down from platform to platform as each flies in" })),
  beatMachine: bind("beatMachine", later("onTheBeat", "outcome", { outcome: "no-tube-conflict", needs: "bmMarbles", generate: beatMachineSettings, musicFirst: true, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hook", note: "one loop a clip, its seeded phrase one no tube needs a spare marble for (a run of its own: a note of its last bars)", scene: () => "marbles dropping from tubes onto a row of tuned bars and rolling back" })),
  runner: bind("runner", later("onTheBeat", "finish", { musicFirst: true, note: "LEVEL COMPLETE 1.6 s before its run's end" })),
  vortex: bind("vortex", later("onTheBeat", "outcome", { outcome: "ring-on-bar", needs: "vortexRings", generate: vortexSettings, musicFirst: true, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hook", note: "two rings, the last one swallowed on a bar line (a run of its own), the final banner a second later", scene: () => "rings of balls spiralling down a whirlpool towards a hole in its middle" })),
  collide: bind("collide", later("onTheBeat", "fixed", { generate: collideSettings, musicFirst: true, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hookB", note: "the drop: its anti-collision switch at the payoff, every orb a new colour, a flash, ANTI-COLLISION and an accented chord (studio round 1, 11: its clip's end had played what the whole run did)", scene: (s) => `${s.cpCount} orbs of different sizes bumping around inside a circle` })),
  waveTank: bind("waveTank", later("onTheBeat", "atEnd", { musicFirst: true, hookKey: "hook", scene: () => "water waves rolling through gaps in a wall, a row of bells along the far side" })),
  // reveal (--- templates --- AI studio step 6: the picture the hook asks to guess, the clip's last 1.5 s)
  lines: bind("lines", later("reveal", "atEnd")),
  drawingMachine: bind("drawingMachine", later("reveal", "atEnd", { generate: drawingMachineSettings, musicFirst: true, hookKey: "hook", note: "Earth and Venus's five-petal flower, its marks left unjoined (no five-pointed star over it), done as the clip's last 1.5 s begin and held past its end", scene: () => "a sun with two small planets circling it, a line drawn between them every few days and a dot where they pass closest" })),
  illusion: bind("illusion", later("reveal", "atEnd", { generate: illusionSettings, note: "fixed run length: whole cycles that cover the clip" })),
  // labGame (--- templates --- AI studio step 6: one variant per built-in Mode Lab game that bp-check calls playable, each timed by its
  // finish rule – planner.ts MARK_MODES – and ended resolved, its own end banner the one ending)
  blueprint: bind("blueprint", later("labGame", "finish", { musicFirst: true, endings: ["resolved"], buckets: ["short", "standard"], note: "one variant per built-in Mode Lab game that bp-check calls playable: its hook the game's rule, its payoff the moment its finish rule fires", variants: BLUEPRINT_CATALOG_IDS.map((id, i): VariantSpec => [null, i === 0 ? undefined : kebab(id), LAB_GAME_HIDDEN[id], LAB_GAME_BUCKETS[id], labGameVariant(id)]) })),
};

/** Every binding, in MODE_IDS order. */
export const BINDINGS: readonly ModeBinding[] = MODE_IDS.map((m) => MODE_TEMPLATES[m]);

/** A template as a menu lists it: its id, its binding, its format and the recipe it wraps. */
export interface TemplateInfo {
  id: string;
  mode: ModeId;
  format: TemplateFormat;
  binding: ModeBinding;
  recipe: BotRecipe | null;
  /** The family of the recipe it wraps, or – --- templates --- a variant without one – its binding's (null: its recipe is unknown). */
  family: BotFamily | null;
  ready: boolean;
  /** The length buckets it fills when narrower than its recipe's: its variant's, else its binding's. */
  buckets?: readonly LengthBucket[];
}

/** --- templates --- The series of a binding without a recipe: its own, else its format's. */
const familyOfBinding = (binding: ModeBinding): BotFamily => binding.family ?? TEMPLATE_FORMATS[binding.format].family;

const INFOS: readonly TemplateInfo[] = BINDINGS.flatMap((binding) =>
  binding.variants.map((v) => {
    const recipe = v.recipe ? (recipeById(v.recipe) ?? null) : null;
    const buckets = v.buckets ?? v.own?.buckets ?? binding.buckets;
    // (--- templates --- a variant without a recipe plans its binding's own settings; AI studio step 6: in its own series where it names one)
    const family = v.recipe === null ? familyOfBinding(variantBinding(binding, v)) : (recipe?.family ?? null);
    // (--- templates --- a variant without a recipe plans while its own way can: AI studio step 3)
    return { id: v.id, mode: binding.mode, format: TEMPLATE_FORMATS[binding.format], binding, recipe, family, ready: binding.ready && !v.hidden && (v.recipe === null ? strategyCanPlan(variantBinding(binding, v)) : !!recipe), ...(buckets ? { buckets } : {}) };
  }),
);
const INFO_BY_ID = new Map(INFOS.map((t) => [t.id, t]));

/** Every template, ready or hidden, in MODE_IDS order (a binding's variants in turn). */
export function allTemplates(): readonly TemplateInfo[] {
  return INFOS;
}

export function templateById(id: string | null | undefined): TemplateInfo | undefined {
  return id ? INFO_BY_ID.get(id) : undefined;
}

/** The templates that plan, of a family choice: one family, "all", or the "default" set (BOT_DEFAULT_FAMILIES: no battle family). */
export function readyTemplates(family: BotFamilyChoice = "default"): TemplateInfo[] {
  const families: readonly BotFamily[] = family === "all" ? BOT_FAMILIES : family === "default" ? BOT_DEFAULT_FAMILIES : [family];
  return INFOS.filter((t) => t.ready && t.family !== null && families.includes(t.family));
}

/** The noun a format's `{thing}` takes for a mode: its key under `ViralBot` ("things.shatter": "the ball", "piłka", "la pelota"). */
export function thingKeyOf(mode: ModeId): string {
  return `things.${mode}`;
}

/**
 * --- templates --- A template's name in the copy's language (copy.ts templateName): "{Mode name} · {Format name}" ("Shatter · Get
 * out"), and for a binding's further variant the name of the recipe it wraps after it ("Classic · Get out · Gerald escapes").
 * `modeName`: the site's name of its mode (`Modes.<id>.name`), which the caller reads. --- templates --- (AI studio step 3) A further
 * variant without a recipe adds its own name ("Classic · Get out · One ring": `ViralBot.variants`).
 */
export function templateNameOf(info: TemplateInfo, copy: BotCopy, modeName: string): string {
  const first = info.binding.variants[0]?.id === info.id;
  // (--- templates --- AI studio step 3: a further variant without a recipe is named by its own key, its id's suffix)
  return templateName(copy, modeName, info.format.id, first ? null : info.recipe ?? { variant: variantKeyOf(info) });
}

/**
 * --- templates --- (AI studio step 3) A further variant's key: its id's suffix after its binding's first id ("ring" of
 * get-out-classic-ring) – --- templates --- (AI studio step 6) in camelCase, as the copy's keys are ("ringBreaker" of
 * lab-game-blueprint-ring-breaker, `ViralBot.variants.ringBreaker`).
 */
export function variantKeyOf(info: Pick<TemplateInfo, "id" | "binding">): string {
  const base = info.binding.variants[0]?.id ?? "";
  const suffix = info.id.startsWith(`${base}-`) ? info.id.slice(base.length + 1) : info.id;
  return suffix.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/* ------------------------------------------------------------------ the adapter */

/** How many times a multi-mode recipe's generator is asked for the binding's mode before the mode is set by hand. */
const MODE_DRAWS = 12;

/**
 * A recipe's settings generator pinned to one of its modes: a recipe that picks among its modes (Ring Escape: Classic, Portal,
 * Accumulation) is asked again – from the same seeded generator, so deterministically – until it picks this one, so the numbers
 * are the ones it tunes for that mode; after MODE_DRAWS tries the mode is set on the last draw.
 */
function pinnedSettings(recipe: BotRecipe, mode: ModeId): BotRecipe["settings"] {
  if (recipe.modes.length === 1) return recipe.settings;
  return (ctx: RecipeContext) => {
    let patch = recipe.settings(ctx);
    for (let k = 1; k < MODE_DRAWS && patch.mode !== mode; k++) patch = recipe.settings(ctx);
    return patch.mode === mode ? patch : { ...patch, mode };
  };
}

/**
 * A template's recipe, the one the planner plans while it is offered (ready): its wrapped recipe's adapter or its binding's own
 * (plannedRecipe); null for a hidden template.
 */
export function templateRecipe(info: TemplateInfo): BotRecipe | null {
  return info.ready ? plannedRecipe(info) : null;
}

/**
 * --- templates --- A template's recipe whether it is offered or not, as the planning acceptance plans a binding before it is ready
 * (tests/botTemplates.test.ts): the wrapped recipe's adapter (wrappedRecipe), or – a variant without a recipe – its binding's own
 * (ownRecipe). Null where there is nothing to plan: an unknown recipe, or an outcome the outcome strategy has no moment for.
 */
export function plannedRecipe(info: TemplateInfo): BotRecipe | null {
  const own = info.binding.variants.find((v) => v.id === info.id);
  if (own?.recipe === null) return ownRecipe(info);
  return info.recipe ? wrappedRecipe(info, info.recipe) : null;
}

/**
 * A wrapped recipe's adapter: the recipe pinned to the binding's mode, its buckets (the variant's) and the format's endings,
 * under the template id – timed by the binding's strategy, played with its tune, and drawn with the format's words (no payoff
 * words where its payoff speaks for itself; a stake format's number kept in the Simple hook).
 */
function wrappedRecipe(info: TemplateInfo, recipe: BotRecipe): BotRecipe {
  const narrow = info.buckets;
  const buckets = narrow ? (recipe.buckets ?? narrow).filter((b) => narrow.includes(b)) : recipe.buckets;
  const ownEndings = recipe.endings ?? (["resolved", "cliffhanger"] as const);
  const endings = ownEndings.filter((e) => info.format.endings.includes(e) && (!info.binding.endings || info.binding.endings.includes(e)));
  const pinned = pinnedSettings(recipe, info.mode);
  const tune = info.binding.tune;
  // --- templates --- (AI studio step 5) a recipe timed by the clip's end (Ball Drop's rain): its clip's length drawn from the payoff
  // target, resolved only, in the buckets whose payoff lands in the band (outcomeStrategy.ts), as a binding's own atEnd recipe has them
  const atEnd = info.binding.strategy === "atEnd";
  const played = tune || atEnd ? (ctx: RecipeContext) => ({ ...pinned(ctx), ...(tune ?? {}), ...(atEnd ? { recordingDuration: atEndRecordingSec(ctx.payoffTarget) } : {}), mode: info.mode }) : pinned;
  const fills = atEnd ? (buckets ?? AT_END_BUCKETS).filter((b) => AT_END_BUCKETS.includes(b)) : buckets;
  const ends = atEnd ? (["resolved"] as const) : endings;
  // --- templates --- (AI studio step 6) a variant's own hook: one of its format's three, in place of the recipe's (copy.ts FORMAT_FIELD)
  const formatHook = info.binding.variants.find((v) => v.id === info.id)?.own?.hookKey;
  return {
    ...recipe,
    id: info.id,
    modes: [info.mode],
    settings: played,
    strategy: info.binding.strategy,
    ...(fills && fills.length ? { buckets: fills } : {}),
    endings: ends.length ? ends : ownEndings,
    wraps: recipe.id,
    ...(info.format.payoffWords ? {} : { payoffWords: false as const }),
    ...(info.format.stakeHook ? { stakeHook: true as const } : {}),
    ...(info.binding.hookAsk ? { hookAsk: info.binding.hookAsk } : {}),
    ...(formatHook && !formatHook.startsWith(OWN_HOOK_FIELD) ? { hookKey: `${FORMAT_FIELD}${info.format.copyKey}.${formatHook}` } : {}),
    countdownFrom: info.format.countdown,
  };
}

/**
 * --- templates --- A binding's own settings (a binding without a recipe): its seeded `generate`, else its `patch`, with the flag
 * its outcome needs on top (OUTCOME_FLAG_SETTINGS), its `tune`, and – atEnd – the clip's length drawn from the payoff target
 * (outcomeStrategy.ts atEndRecordingSec), in its mode. The planner lays them over the mode's defaults (planner.ts recipeSettings).
 */
export function ownSettingsOf(binding: ModeBinding): BotRecipe["settings"] {
  const flag = binding.needs ? OUTCOME_FLAG_SETTINGS[binding.needs] : {};
  return (ctx: RecipeContext) => ({
    ...(binding.generate ? binding.generate(ctx) : { ...(binding.patch ?? {}) }),
    ...flag,
    ...(binding.tune ?? {}),
    ...(binding.strategy === "atEnd" ? { recordingDuration: atEndRecordingSec(ctx.payoffTarget) } : {}),
    mode: binding.mode,
  });
}

/**
 * --- templates --- A binding's own recipe (a variant without one): its format's family (or its own), payoff, copy key, endings and
 * countdown sources, its own settings (ownSettingsOf), strategy, outcome, countdown and hook values, under the template id – and
 * the format's words as a wrapped recipe has them. An atEnd binding ends resolved only (no event comes to cut before) and fills
 * the buckets whose payoff lands in the planner's band (AT_END_BUCKETS). Its copy is its format's (`ViralBot.formats.<id>`,
 * BotRecipe.formatCopy: copy.ts formatText), its `{thing}` its mode's noun (thingKeyOf). Null for an outcome the outcome
 * strategy has no moment for.
 */
function ownRecipe(info: TemplateInfo): BotRecipe | null {
  const b = variantBinding(info.binding, info.binding.variants.find((v) => v.id === info.id)); // --- templates --- (a variant's own way)
  const f = info.format;
  if (!strategyCanPlan(b)) return null;
  const atEnd = b.strategy === "atEnd";
  const endings = atEnd ? (["resolved"] as const) : f.endings.filter((e) => !b.endings || b.endings.includes(e));
  const narrow = info.buckets;
  const buckets = atEnd ? AT_END_BUCKETS.filter((x) => !narrow || narrow.includes(x)) : narrow;
  return {
    id: info.id,
    copyKey: f.copyKey,
    family: familyOfBinding(b),
    modes: [b.mode],
    payoff: b.payoffType ?? f.payoff, // --- templates --- (studio2 review round 1, 19) a binding's own where its format's is not its run's
    countdown: b.countdown ?? { kind: "timer", source: "picture" },
    strategy: b.strategy,
    ...(b.outcome ? { outcome: b.outcome } : {}),
    ...(b.musicFirst ? { musicFirst: true } : {}),
    endings: endings.length ? endings : f.endings,
    ...(buckets && buckets.length ? { buckets } : {}),
    settings: ownSettingsOf(b),
    hookVars: b.hookVars ?? (() => ({})),
    ...(b.hookKey ? { hookKey: b.hookKey } : {}), // --- templates --- (AI studio step 3) its hook variant, in either ending
    ...(b.payoffKey ? { payoffKey: b.payoffKey } : {}), // --- templates --- (AI studio step 4b) its own payoff's words
    ...(b.character ? { character: true } : {}),
    formatCopy: true, // --- templates --- (its format's words, its mode's noun)
    copyVars: () => ({ thing: thingKeyOf(b.mode) }),
    ...(f.payoffWords && b.payoffWords !== false /* --- templates --- (AI studio step 4) */ ? {} : { payoffWords: false as const }),
    ...(f.stakeHook ? { stakeHook: true as const } : {}),
    ...(b.hookAsk ? { hookAsk: b.hookAsk } : {}),
    countdownFrom: f.countdown,
  };
}

const ADAPTERS = new Map<string, BotRecipe>(INFOS.flatMap((t) => {
  const r = templateRecipe(t);
  return r ? [[t.id, r] as const] : [];
}));

/** The recipe of a ready template (planner.ts plans it like any recipe); undefined for a hidden or unknown one. */
export function templateRecipeById(id: string | null | undefined): BotRecipe | undefined {
  return id ? ADAPTERS.get(id) : undefined;
}

/** A plan's recipe: a playbook recipe, or a ready template's (the plan carries either id). */
export function botRecipeById(id: string | null | undefined): BotRecipe | undefined {
  return recipeById(id) ?? templateRecipeById(id);
}

/** The claim a plan's recipe id makes through its template's format (null: not a template). */
export function templateClaimOf(id: string | null | undefined): Claim | null {
  return templateById(id)?.format.claim ?? null;
}
// --- end templates ---
