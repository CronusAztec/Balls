import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import type { FinderOutcomeKind, OutcomeContext } from "@/lib/simulation/outcomes";
import type { Claim } from "@/lib/crew/clip";
import { defaultKeptHuds, hudsOn } from "@/lib/crew/hudFlags";
import { BOT_DEFAULT_FAMILIES, BOT_FAMILIES, intBetween, pick, recipeById, stepBetween, type BotFamily, type BotFamilyChoice, type BotRecipe, type CountdownKind, type CountdownSource, type EndingStyle, type HookVars, type LengthBucket, type PayoffStrategy, type PayoffType, type RecipeContext } from "./playbook";
import { AT_END_BUCKETS, atEndRecordingSec, outcomeStrategyPlans } from "./outcomeStrategy"; // --- templates --- (the outcome and atEnd strategies)
import { templateName, type BotCopy } from "./copy"; // --- templates --- (a template's name)
import { modeSettingsOfSettings } from "./finderRequest"; // --- templates --- (Perfect Fit's solution seed: the finder's own search)
import { findPerfectFitRun } from "@/lib/simulation/perfectFitFinder"; // --- templates ---

/*
 * --- templates --- A viral template for every mode: ten formats (what a clip promises and shows) and a binding of each of
 * the 48 modes to one of them (MODE_TEMPLATES: a Record over ModeId, so a new mode without a binding fails the type check),
 * the adapter that turns a binding into a recipe the planner plans unchanged (templateRecipeById), and the Simple look
 * (SIMPLE_LOOK, the one-line-at-a-time text plan) that keeps a clip calm.
 *
 *  - A format: its idea in one sentence, its claim (what the run must visibly do: the crew's G4 and the viewer check it), its
 *    copy under `ViralBot.formats.<id>` (name, hook, hookB, hookC, cliffHook, payoff, cliffQuestion, postQuestion, in en, pl
 *    and es: copy.ts formatText, its `{thing}` the mode's noun under `ViralBot.things`), where its countdown comes from and the
 *    endings it takes. A template is named "{Mode name} · {Format name}" (templateNameOf); a further variant adds its recipe's
 *    name, or without one its own (`ViralBot.variants`: "Classic · Get out · One ring").
 *  - A binding: the mode's format, how the planner times its payoff (a playbook strategy – its recipe's, or one of its own where
 *    the recipe's does not show the format's payoff: Ball Drop's last note –, the bound finder outcome's moment ("outcome") or
 *    the clip's last 1.5 s ("atEnd"): outcomeStrategy.ts), the settings it plays its recipe with (`tune`: Pendulum Wave's chord
 *    where the hook promises one) – or, without a recipe, its own (`patch` on the mode's defaults, or a seeded `generate`), with
 *    the context flag its outcome needs switched on (OUTCOME_FLAG_SETTINGS) –, the length buckets it can fill, the HUD it keeps
 *    (only the one that shows the countdown), its tier and its variants. Tiers: proven (wraps a playbook recipe, each variant
 *    one; the variants that plan pass every clarity gate at Simple 80+ and Playbook 75+), trial and experimental (the bindings
 *    of the EXPERIMENTAL table, a shrink-only list: hidden from every menu until the planning acceptance passes them). A proven
 *    binding's variant whose plans fail a gate on every seed is hidden with its reason, never kept ready by an exception:
 *    Fight League's boss rush (its hook), the square race (its count-in), Ball Drop (its run fades out: review round 2, 21)
 *    and Grow's fill that ends the run (AI studio step 3: shown 0.5 s). Only ready bindings plan – a proven one with a variant that plans (bind(): ready is derived, never declared) –: in
 *    this release 14 of the 16 proven ones, the square race's and Ball Drop's bindings not ready since their one variant is
 *    hidden, and 13 trial ones (AI studio step 3: Shatter, Color Match, Target, Brick Smash and Perfect Fit; step 4: the
 *    conveyor, the Maze, Territory, Land Claim, Bullseye and Bouncing Shapes, each with its own settings; step 4b: the Journey
 *    and Spiral Glass, their own overlays switched off – `journeyHud`, `sgHud`); the other 21 are
 *    declared, experimental and hidden until their settings and planning acceptance land – their
 *    format's copy is written – (docs/virality-playbook.md §5). A trial binding plans once it leaves the table, where its
 *    strategy can plan it. A proven binding may add a variant of its own settings (VariantOwn: Classic's one ring).
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
  aim: { id: "aim", idea: "One shot at a target; does it hit.", claim: "hit", copyKey: "aim", countdown: ["caption"], endings: ["resolved", "cliffhanger"], payoffWords: true, stakeHook: false, family: "escape", payoff: "escape" },
  lineUp: { id: "lineUp", idea: "Out of step, then all in line at once.", claim: "inSync", copyKey: "lineUp", countdown: ["picture", "hud"], endings: ["resolved"], payoffWords: true, stakeHook: false, family: "rhythm", payoff: "flip" },
  // (the plan's onTheBeat payoff: "none: the drop or the last bar" – the last note is heard, and no words name a chord it is not)
  onTheBeat: { id: "onTheBeat", idea: "Every bounce is a note; the drop or the last bar is the payoff.", claim: "beat", copyKey: "onTheBeat", countdown: ["picture"], endings: ["resolved"], payoffWords: false, stakeHook: false, family: "rhythm", payoff: "flip" },
  reveal: { id: "reveal", idea: "Lines pile up into a picture; guess it before it is done.", claim: "picture", copyKey: "reveal", countdown: ["picture"], endings: ["resolved"], payoffWords: true, stakeHook: false, family: "rhythm", payoff: "flip" },
  labGame: { id: "labGame", idea: "A Mode Lab game played to its own finish rule.", claim: "gameRule", copyKey: "labGame", countdown: ["hud"], endings: ["resolved"], payoffWords: true, stakeHook: false, family: "escape", payoff: "escape" },
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
   */
  own?: VariantOwn;
}

/** --- templates --- (AI studio step 3) What a variant without a recipe sets over its binding (variantBinding). */
export type VariantOwn = Partial<Pick<ModeBinding, "strategy" | "outcome" | "needs" | "patch" | "generate" | "countdown" | "hookVars" | "hookKey" | "payoffKey" | "endings" | "buckets" | "keepHud" | "scene" | "character" | "payoffWords" | "note">>;

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
export type OwnHookKey = `own.${"box" | "mergeRing" | "spiralGlass"}`;

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
 * --- templates --- (review round 2, 21) Ball Drop's run fades out: its notes thin from the middle of the run on, its last ball's
 * last note is one faint tick over a board at rest (G2 Still: the balls at 6–14 % of their median motion, fewer notes than the
 * run's usual moment, none accented), then silence until the SETTLED! banner and its burst, which the recorder shows for its
 * 0.5 s only (G2 asks 0.8 s after a payoff). No moment at 80–90 % of the clip lands, so the variant is hidden until a payoff
 * that does (the drop of a beat format, a later step).
 */
const FADES_OUT = "its run fades out: the last ball's last note is one faint tick over a board at rest (G2 Still), then silence until the SETTLED! banner, which the recorder shows for 0.5 s (G2 asks 0.8 s): no moment at 80–90 % of the clip lands";

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

// --- templates --- why a binding is in the experimental table
/**
 * --- templates --- (AI studio step 3) Paint's run ends the moment 95 % is painted (picturePaint.ts COVERAGE_DONE): a resolved clip
 * shows it for the recorder's 0.5 s only (G2 asks 0.8 s), and the fill format ends resolved only – measured: 0 of 12 plans pass.
 */
const PAINT_ENDS_AT_FILL = "its run ends the moment 95 % is painted, so a resolved clip shows the fill for the recorder's 0.5 s only (G2 asks 0.8 s), and the fill format ends resolved only: 0 of 12 plans passed (4 plan seeds × 3 platforms)";
/** --- templates --- (AI studio step 3) Grow's fill that ends the run, likewise (its fills-by variant). */
const GROW_ENDS_AT_FILL = "with Grow's fill ending the run (fills-by's flag) the clip shows the fill for the recorder's 0.5 s only (G2 asks 0.8 s), and the fill format ends resolved only: 0 of 12 plans passed; the grow-fill recipe's ring goes on after its fill";
/**
 * --- templates --- (AI studio step 4b) Spiral Glass with its own overlay off (the setting `sgHud`, a HUD flag the Simple look switches
 * off as the others): step 3 hid it because its question "Will the ball multiply?" over the spiral, its title, its tiles left and a
 * progress ring in the corners stayed for the whole run, which no setting switched off then. With them off, the hook asks the
 * question the overlay asked, the badge at the spiral's entrance counts the balls as they multiply, and GLASS CLEARED – the clear,
 * with the balls' count and the time, 2 s before the run's end – is the payoff and its one ending. Resolved only: a cut clip's
 * closing question ("One more hit?") would ask a second question.
 */
const SPIRAL_SIMPLE = "its own overlay off in the Simple look (sgHud: no title, tiles left, progress ring or question over the spiral); the hook asks the question the overlay asked ('Will the ball multiply?'), the badge at the entrance counts the balls, and GLASS CLEARED, 2 s before the run's end, is the payoff and its one ending (planner.ts payoffSecOf); resolved only, as a cut clip's closing question would ask a second one";
/**
 * --- templates --- (AI studio step 4b) The Journey with its own overlay off (the setting `journeyHud`): step 3 hid it because a banner
 * as each stage began ("Stage 3/5: Rings"), the stage names, a mini-map and a clock crowded the screen and its HOME! card stood beside
 * the payoff's words, none of which a setting switched off then. With them off, Gerald heads for the door marked HOME (the door's
 * sign is the picture's and stays), the hook asks the format's hook b ("Will Gerald make it home?") and the payoff's own words say
 * HOME where the card did ("Home! 🏠": its HOME is Glass Smash's, the chord, then 1.8 s of celebration). Resolved only: a cut clip's
 * closing question ("Out or not?") would ask another question than the hook.
 */
const JOURNEY_SIMPLE = "its own overlay off in the Simple look (journeyHud: no stage banners or names, mini-map, clock or HOME! card); Gerald heads for the door marked HOME (hook b 'Will Gerald make it home?'), and the payoff's own words say HOME where the card did ('Home! 🏠'); resolved only, as a cut clip's 'Out or not?' would ask another question";
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

/** Its strategy can plan it (the outcome's moment, the clip's end, the run's finish); it waits for the rest. */
const AWAITS = "waits for its own settings and the planning acceptance (every binding planned at DEFAULT_MAX_SEEDS for 4 plan seeds, accepted on 3)";
/** Its outcome is found over settings, not seeds: the outcome strategy has no seed's moment for it (outcomeStrategy.ts). */
const OWN_SEARCH = "its outcome is searched over settings by its own finder, not over seeds: the outcome strategy cannot plan it, and it waits for that search as well as its settings and the planning acceptance";

/**
 * --- templates --- The experimental table: the bindings the planning acceptance has not passed – hidden from every menu, never
 * ready –, each with its reason. Shrink only: tests/botTemplates.test.ts pins it, so a binding leaves it when it passes (with its
 * settings, its copy and the test that plans it) and none joins it without a reviewed change of that pin. All 32 bindings without
 * a recipe started here; AI studio step 3 passed five (Shatter, Color Match, Target, Brick Smash, Perfect Fit) and gave Journey,
 * Paint and Spiral Glass their measured reasons; step 4 passed six (the conveyor, the Maze, Territory, Land Claim, Bullseye,
 * Bouncing Shapes) and gave Merge Ring and Paddle Keep-Up theirs; step 4b passed the Journey and Spiral Glass, once a setting
 * switched off what they draw of their own (their reasons, which no setting could answer then, are their notes now).
 */
export const EXPERIMENTAL: Readonly<Partial<Record<ModeId, string>>> = {
  paint: PAINT_ENDS_AT_FILL,
  mergeRing: MERGE_RING_OWN_TEXT,
  paddle: PADDLE_OWN_HUD,
  starChords: OWN_SEARCH,
  ellipseFoci: OWN_SEARCH,
  hoops: AWAITS,
  orbGrid: AWAITS,
  colourSort: AWAITS,
  doublePendulum: AWAITS,
  beatDrop: AWAITS,
  beatMachine: OWN_SEARCH,
  runner: AWAITS,
  vortex: OWN_SEARCH,
  collide: AWAITS,
  waveTank: AWAITS,
  lines: AWAITS,
  drawingMachine: AWAITS,
  illusion: AWAITS,
  blueprint: AWAITS,
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
  journey: bind("journey", later("getOut", "finish", { generate: journeySettings, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hookB", payoffKey: "ownPayoff.journey", character: true, note: JOURNEY_SIMPLE, scene: (s) => `one ball with a face at the top of a column of ${s.journeyStages.split(",").length - 1} stages, a door marked HOME at the bottom` })),
  // smash
  powerLayers: bind("powerLayers", { format: "smash", strategy: "fixed", tier: "proven", keepHud: null, variants: [["power-layers"]], note: "the layer count is the mode's own HUD" }),
  target: bind("target", later("smash", "finish", { generate: targetSettings, buckets: ["short", "standard"], endings: ["cliffhanger"], hookVars: (s) => ({ count: s.targetCount }), note: ENDS_AT_FINISH, scene: (s) => `one ball inside a ring of ${s.targetCount} numbered segments, a big number in the middle` })),
  brickRebuild: bind("brickRebuild", later("smash", "outcome", { outcome: "bricks-cleared-by", generate: brickSmashSettings, buckets: ["short", "standard"], note: "loops forever: never 'finish'", scene: () => "a few small balls under a wall of bricks that draws a picture" })),
  spiralGlass: bind("spiralGlass", later("smash", "finish", { generate: spiralGlassSettings, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "own.spiralGlass", note: SPIRAL_SIMPLE, scene: () => "balls running along a spiral channel of frosted glass, a badge with a number at its entrance" })),
  // fill
  grow: bind("grow", { format: "fill", strategy: "fill", tier: "proven", keepHud: null, variants: [["grow-fill"], [null, "fills", GROW_ENDS_AT_FILL, undefined, { strategy: "outcome", outcome: "fills-by", needs: "growFinish", generate: growFinishSettings, note: "the fill that ends the run (fills-by)" }]] }),
  paint: bind("paint", later("fill", "finish", { patch: PAINT_FAST, note: "95 % painted" })),
  perfectFit: bind("perfectFit", later("fill", "outcome", { outcome: "most-on-floor", needs: "pfPento", generate: perfectFitSettings, buckets: ["short", "standard"], note: "one box, its tiling with the most pieces on the floor; landings-on-beat would need the page's tempo", scene: () => "twelve puzzle pieces in a tray at the top, an empty rectangular box below them" })),
  // count
  multiply: bind("multiply", { format: "count", strategy: "fill", tier: "proven", keepHud: null, variants: [["clone-per-pass"]] }),
  multipliers: bind("multipliers", { format: "count", strategy: "finish", tier: "proven", keepHud: null, variants: [["multipliers-board"]], note: "the ball counter at home is the mode's own HUD" }),
  // (--- templates --- AI studio step 4: the plan had both on atEnd, as loops; the code's both end – the conveyor once its last ball is
  // out, Merge Ring 2 s after its final form or an overflow –, so each is timed by its own moment, its run's end inside the clip)
  conveyor: bind("conveyor", later("count", "finish", { generate: conveyorSettings, buckets: ["standard"], hookVars: (s) => ({ count: s.cvMaxBalls }), note: "its run ends 1.5 s after its last ball is out (ALL OUT!): the payoff, not a loop's end", scene: () => "a belt at the top drops balls one by one into rings with turning gaps, a counter in the top right corner" })),
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
    variants: [["fight-duel"], ["fight-upset", "upset"], ["fight-bracket", "bracket"], ["fight-boss", "boss", "its hook names the boss and the division in one clause, 8–9 words, over the Simple look's 7 (G5): it waits for the format's own hook"]],
    note: "third-party names: the battle family's legal opt-in",
  }),
  maze: bind("maze", later("whoWins", "outcome", { outcome: "winner", generate: mazeSettings, buckets: ["short", "standard"], hookKey: "hook", note: "first one out (outcomeStrategy.ts OWN_RUN_MODE_MOMENTS)", scene: (s) => `${s.mzBalls} balls in ${s.mzBalls} colours dropping into a glowing green maze, an exit at the bottom` })),
  territory: bind("territory", later("whoWins", "outcome", { outcome: "winner", generate: territorySettings, buckets: ["short", "standard"], endings: ["cliffhanger"], hookKey: "hook", note: `its board's verdict comes as its countdown ends; ${ENDS_AT_FINISH}`, scene: (s) => `a board of tiles in ${s.tyTeams} colours, balls of each colour bouncing over it and painting it` })),
  landClaim: bind("landClaim", later("whoWins", "outcome", { outcome: "winner", generate: landClaimSettings, buckets: ["short", "standard"], endings: ["cliffhanger"], hookKey: "hook", note: `or close; ${ENDS_AT_FINISH}`, scene: (s) => `columns of white blocks around an arena, balls in ${s.lcTeams} colours painting each block they hit in their colour` })),
  // aim (--- templates --- AI studio step 4: each timed by its run's own moment, planner.ts MARK_MODES)
  bullseye: bind("bullseye", later("aim", "finish", { generate: bullseyeSettings, buckets: ["short", "standard"], hookKey: "hookB", note: "'Will one hit the bullseye?': the first bullseye, its BULLSEYE! callout", scene: () => "balls fired from the top, one after another, through a few pegs onto a dartboard lying at the bottom" })),
  box: bind("box", later("aim", "finish", { generate: boxCountdownSettings, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "own.box", payoffWords: false, hookVars: (s) => ({ count: s.boxCountdown, zero: 0 }), note: "the countdown hook ('It stops at zero.'): the first shape at zero (planner.ts MARK_MODES); its corner comes too soon for any length", scene: (s) => `${s.boxShapeCount} squares gliding in straight lines inside a tall box, each showing a number` })),
  paddle: bind("paddle", later("aim", "finish", { generate: paddleSettings, buckets: ["short", "standard"], endings: ["resolved"], hookKey: "hookC", payoffWords: false, note: "'How long can it last?': one life, its GAME OVER", scene: () => "one ball bouncing on a platform near the bottom that slides left and right to catch it" })),
  // lineUp
  pendulum: bind("pendulum", { format: "lineUp", strategy: "cycle", tier: "proven", keepHud: null, variants: [["pendulum-wave"]], tune: PENDULUM_TUNE, hookAsk: "cliffQuestion", note: "the hook asks whether they line up (its chord plays at the release and every half cycle too, so it promises none); every bob sounds at its turning points, so the realignment is one accented chord; pendulums in a row, so 'back in line' is a line" }),
  polyrhythm: bind("polyrhythm", { format: "lineUp", strategy: "cycle", tier: "proven", keepHud: null, variants: [["polyrhythm"]] }),
  starChords: bind("starChords", later("lineUp", "outcome", { outcome: "star-set" })),
  ellipseFoci: bind("ellipseFoci", later("lineUp", "outcome", { outcome: "converge-on-beat" })),
  hoops: bind("hoops", later("lineUp", "outcome", { outcome: "all-up-by" })),
  orbGrid: bind("orbGrid", later("lineUp", "outcome", { outcome: "resolves-at" })),
  colourSort: bind("colourSort", later("lineUp", "outcome", { outcome: "sorted-by", needs: "colourSortSettles", note: "a gate rule whose sort does not only settle" })),
  doublePendulum: bind("doublePendulum", later("lineUp", "outcome", { outcome: "diverges-at", needs: "dpFan", note: "hook b: 'Same start. Watch them split.'" })),
  // onTheBeat
  drop: bind("drop", { format: "onTheBeat", strategy: "lastNote", tier: "proven", keepHud: null, variants: [["drop-symphony", undefined, FADES_OUT]], note: "the payoff would be the last ball's last note, a faint tick before a silent settle: hidden until a payoff that lands" }),
  beatDrop: bind("beatDrop", later("onTheBeat", "finish")),
  beatMachine: bind("beatMachine", later("onTheBeat", "outcome", { outcome: "no-tube-conflict", needs: "bmMarbles" })),
  runner: bind("runner", later("onTheBeat", "finish")),
  vortex: bind("vortex", later("onTheBeat", "outcome", { outcome: "ring-on-bar", needs: "vortexRings" })),
  collide: bind("collide", later("onTheBeat", "atEnd")),
  waveTank: bind("waveTank", later("onTheBeat", "atEnd")),
  // reveal
  lines: bind("lines", later("reveal", "atEnd")),
  drawingMachine: bind("drawingMachine", later("reveal", "atEnd")),
  illusion: bind("illusion", later("reveal", "atEnd", { note: "fixed run length" })),
  // labGame
  blueprint: bind("blueprint", later("labGame", "finish", { note: "one variant per built-in Mode Lab game that bp-check calls playable" })),
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
    // (--- templates --- a variant without a recipe plans its binding's own settings)
    const family = v.recipe === null ? familyOfBinding(binding) : (recipe?.family ?? null);
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

/** --- templates --- (AI studio step 3) A further variant's key: its id's suffix after its binding's first id ("ring" of get-out-classic-ring). */
export function variantKeyOf(info: Pick<TemplateInfo, "id" | "binding">): string {
  const base = info.binding.variants[0]?.id ?? "";
  return info.id.startsWith(`${base}-`) ? info.id.slice(base.length + 1) : info.id;
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
  return {
    ...recipe,
    id: info.id,
    modes: [info.mode],
    settings: tune ? (ctx: RecipeContext) => ({ ...pinned(ctx), ...tune, mode: info.mode }) : pinned,
    strategy: info.binding.strategy,
    ...(buckets && buckets.length ? { buckets } : {}),
    endings: endings.length ? endings : ownEndings,
    wraps: recipe.id,
    ...(info.format.payoffWords ? {} : { payoffWords: false as const }),
    ...(info.format.stakeHook ? { stakeHook: true as const } : {}),
    ...(info.binding.hookAsk ? { hookAsk: info.binding.hookAsk } : {}),
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
    payoff: f.payoff,
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
