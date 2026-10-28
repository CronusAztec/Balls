import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import type { FinderOutcomeKind, OutcomeContext } from "@/lib/simulation/outcomes";
import type { Claim } from "@/lib/crew/clip";
import { defaultKeptHuds, hudsOn } from "@/lib/crew/hudFlags";
import { BOT_DEFAULT_FAMILIES, BOT_FAMILIES, PAYOFF_STRATEGIES, recipeById, type BotFamily, type BotFamilyChoice, type BotRecipe, type CountdownSource, type EndingStyle, type HookVars, type LengthBucket, type PayoffStrategy, type RecipeContext } from "./playbook";

/*
 * --- templates --- A viral template for every mode: ten formats (what a clip promises and shows) and a binding of each of
 * the 48 modes to one of them (MODE_TEMPLATES: a Record over ModeId, so a new mode without a binding fails the type check),
 * the adapter that turns a binding into a recipe the planner plans unchanged (templateRecipeById), and the Simple look
 * (SIMPLE_LOOK, the one-line-at-a-time text plan) that keeps a clip calm.
 *
 *  - A format: its idea in one sentence, its claim (what the run must visibly do: the crew's G4 and the viewer check it), its
 *    copy under `ViralBot.formats.<id>` (name, hook, hookB, hookC, cliffHook, payoff, cliffQuestion, postQuestion – a later
 *    step writes it), where its countdown comes from and the endings it takes.
 *  - A binding: the mode's format, how the planner times its payoff (a playbook strategy – its recipe's, or one of its own where
 *    the recipe's does not show the format's payoff: Ball Drop's last note –, or – a later step – the bound finder outcome or
 *    the clip's end), the settings it plays its recipe with (`tune`: Pendulum Wave's chord where the hook promises one), the
 *    context flag that outcome needs, the length buckets it can fill, the HUD it keeps (only the one that shows the
 *    countdown), its tier and its variants. Tiers: proven (wraps a playbook recipe, each variant one; the variants that plan
 *    pass every clarity gate at Simple 80+ and Playbook 75+), trial and experimental (hidden from every menu). A proven
 *    binding's variant whose plans fail a gate on every seed is hidden with its reason, never kept ready by an exception:
 *    Fight League's boss rush (its hook), the square race (its count-in) and Ball Drop (its run fades out: review round 2,
 *    21). Only ready bindings plan – a proven one with a variant that plans (bind(): ready is derived, never declared) –: in
 *    this release 14 of the 16 proven ones, the square race's and Ball Drop's bindings not ready since their one variant is
 *    hidden; the other 32 are declared and hidden until their strategies and copy land (docs/virality-playbook.md §5).
 *  - A variant: one template id (`<format>-<mode>[-<variant>]`, kebab-case: it names clip files) wrapping one recipe, or
 *    hidden with its reason (a variant that fails a gate on every plan), or narrowed to the length buckets its seed search
 *    finds the payoff in. Its adapter (templateRecipe) is the recipe pinned to the binding's mode, buckets (the variant's where
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
  /** Its copy under `ViralBot.formats.<id>` (a later step; the proven templates speak with their recipes' copy). */
  copyKey: string;
  countdown: readonly CountdownFrom[];
  endings: readonly EndingStyle[];
  /** --- templates --- Its payoff is drawn in words (false: the moment speaks for itself – the last note of a beat). */
  payoffWords: boolean;
  /** --- templates --- Its hook's number is the stake (how many to break, to count): the Simple hook keeps the clause that states it. */
  stakeHook: boolean;
}

export const TEMPLATE_FORMATS: Readonly<Record<TemplateFormatId, TemplateFormat>> = {
  getOut: { id: "getOut", idea: "Something is trapped; will it get out, and the moment it does.", claim: "out", copyKey: "getOut", countdown: ["hud", "caption"], endings: ["resolved", "cliffhanger"], payoffWords: true, stakeHook: false },
  smash: { id: "smash", idea: "Every hit wears it down; which hit breaks it.", claim: "break", copyKey: "smash", countdown: ["hud", "caption"], endings: ["resolved", "cliffhanger"], payoffWords: true, stakeHook: true },
  // (review round 2, 22: the ball filling its ring is the countdown; the caption bar counted the clip's seconds, not the fill)
  fill: { id: "fill", idea: "It grows until it fills the space.", claim: "full", copyKey: "fill", countdown: ["picture"], endings: ["resolved"], payoffWords: true, stakeHook: false },
  count: { id: "count", idea: "One becomes many; how many by the end.", claim: "count", copyKey: "count", countdown: ["hud", "picture"], endings: ["resolved"], payoffWords: true, stakeHook: true },
  whoWins: { id: "whoWins", idea: "Pick one before it starts; one of them wins.", claim: "winner", copyKey: "whoWins", countdown: ["hud", "picture"], endings: ["resolved", "cliffhanger"], payoffWords: true, stakeHook: false },
  aim: { id: "aim", idea: "One shot at a target; does it hit.", claim: "hit", copyKey: "aim", countdown: ["caption"], endings: ["resolved", "cliffhanger"], payoffWords: true, stakeHook: false },
  lineUp: { id: "lineUp", idea: "Out of step, then all in line at once.", claim: "inSync", copyKey: "lineUp", countdown: ["picture", "hud"], endings: ["resolved"], payoffWords: true, stakeHook: false },
  // (the plan's onTheBeat payoff: "none: the drop or the last bar" – the last note is heard, and no words name a chord it is not)
  onTheBeat: { id: "onTheBeat", idea: "Every bounce is a note; the drop or the last bar is the payoff.", claim: "beat", copyKey: "onTheBeat", countdown: ["picture"], endings: ["resolved"], payoffWords: false, stakeHook: false },
  reveal: { id: "reveal", idea: "Lines pile up into a picture; guess it before it is done.", claim: "picture", copyKey: "reveal", countdown: ["picture"], endings: ["resolved"], payoffWords: true, stakeHook: false },
  labGame: { id: "labGame", idea: "A Mode Lab game played to its own finish rule.", claim: "gameRule", copyKey: "labGame", countdown: ["hud"], endings: ["resolved"], payoffWords: true, stakeHook: false },
};

/* ------------------------------------------------------------------ the bindings */

/** How a binding times its payoff: a playbook strategy, the bound finder outcome, or the clip's last 1.5 s (a later step). */
export type TemplateStrategy = PayoffStrategy | "outcome" | "atEnd";
export type TemplateTier = "proven" | "trial" | "experimental";
/** The finder context flags a bound outcome may need (lib/simulation/outcomes.ts OutcomeContext). */
export type OutcomeFlag = keyof OutcomeContext & ("growFinish" | "dpFan" | "bmMarbles" | "vortexRings" | "pfPento" | "ringEscape" | "colourSortSettles");

export interface TemplateVariant {
  /** The template id: `<format>-<mode>` for the binding's first variant, `-<suffix>` after it for the others. */
  id: string;
  /** The playbook recipe it wraps (null: the binding's own generator, a later step). */
  recipe: string | null;
  /** Why a variant of a proven binding is hidden (it fails a clarity gate on every plan); absent: it plans with its binding. */
  hidden?: string;
  /** The length buckets this variant fills, narrower than its binding's: the ones its seed search finds the payoff in. */
  buckets?: readonly LengthBucket[];
}

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
  /** The context flag the outcome needs: the binding's settings switch it on (a later step). */
  needs?: OutcomeFlag;
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
  /** The viewer's scene line where the dossier's own (crew/dossier.ts sceneOf) does not describe the mode (a later step). */
  scene?: (s: SimulatorSettings) => string;
  /** Why it is bound this way, or what it waits for. */
  note?: string;
}

const kebab = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** A template id: `<format>-<mode>`, kebab-case, with a variant's suffix. */
export function templateIdOf(format: TemplateFormatId, mode: ModeId, suffix?: string): string {
  return [kebab(format), kebab(mode), ...(suffix ? [suffix] : [])].join("-");
}

/** A variant's spec: the recipe it wraps, its id's suffix, why it is hidden, the buckets it narrows its binding's to. */
type VariantSpec = readonly [recipe: string | null, suffix?: string, hidden?: string, buckets?: readonly LengthBucket[]];
type BindingSpec = Omit<ModeBinding, "mode" | "variants" | "ready"> & { variants?: readonly VariantSpec[] };

/**
 * A binding from its spec: its variants' ids from the format and the mode; ready when proven and one of its variants plans
 * (wraps a recipe and is not hidden) – --- templates --- (review round 2, 14) never ready with nothing to plan, as the square race.
 */
function bind(mode: ModeId, spec: BindingSpec): ModeBinding {
  const variants = (spec.variants ?? [[null]]).map(([recipe, suffix, hidden, buckets]): TemplateVariant => ({ id: templateIdOf(spec.format, mode, suffix), recipe, ...(hidden ? { hidden } : {}), ...(buckets ? { buckets } : {}) }));
  return { ...spec, mode, ready: spec.tier === "proven" && variants.some((v) => v.recipe !== null && !v.hidden), variants };
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

/** A hidden binding of a later step: a strategy of its own (outcome, atEnd) or the format's copy still to come. */
const later = (format: TemplateFormatId, strategy: TemplateStrategy, extra: Partial<BindingSpec> = {}): BindingSpec => ({ format, strategy, tier: "trial", keepHud: null, ...extra });

/**
 * Every mode's binding (the plan's coverage: getOut 7, smash 4, fill 3, count 4, whoWins 8, aim 3, lineUp 8, onTheBeat 7,
 * reveal 3, labGame 1 – 48 of 48). Looping modes never bind to "finish" (it never fires there).
 */
export const MODE_TEMPLATES: Readonly<Record<ModeId, ModeBinding>> = {
  // getOut
  classic: bind("classic", { format: "getOut", strategy: "escape", tier: "proven", keepHud: null, variants: [["ring-escape"], ["pip-escape", "gerald"]], note: "ring-at with ringEscape on is a later variant" }),
  accumulation: bind("accumulation", { format: "getOut", strategy: "escape", tier: "proven", keepHud: null, variants: [["ring-escape"]], buckets: ["short", "standard"], endings: ["cliffhanger"], note: `a minute-long escape needs Classic's slow grind; ${ENDS_AT_ESCAPE}` }),
  portal: bind("portal", { format: "getOut", strategy: "escape", tier: "proven", keepHud: null, variants: [["ring-escape"], ["pip-escape", "gerald", undefined, GERALD_PORTAL_BUCKETS]], buckets: ["short", "standard"], endings: ["cliffhanger"], note: `a minute-long escape needs Classic's slow grind; ${ENDS_AT_ESCAPE}` }),
  glass: bind("glass", { format: "getOut", strategy: "finish", tier: "proven", keepHud: null, variants: [["glass-smash"]], note: "home is the way out: 'Will Gerald make it home?'" }),
  shatter: bind("shatter", later("getOut", "outcome", { outcome: "escapes-at" })),
  colorMatch: bind("colorMatch", later("getOut", "outcome", { outcome: "escapes-at" })),
  journey: bind("journey", later("getOut", "finish", { note: "home, Gerald variant" })),
  // smash
  powerLayers: bind("powerLayers", { format: "smash", strategy: "fixed", tier: "proven", keepHud: null, variants: [["power-layers"]], note: "the layer count is the mode's own HUD" }),
  target: bind("target", later("smash", "finish")),
  brickRebuild: bind("brickRebuild", later("smash", "outcome", { outcome: "bricks-cleared-by", note: "loops forever: never 'finish'" })),
  spiralGlass: bind("spiralGlass", later("smash", "finish", { note: "if its run loops, the binding moves to atEnd or ships experimental" })),
  // fill
  grow: bind("grow", { format: "fill", strategy: "fill", tier: "proven", keepHud: null, variants: [["grow-fill"]], note: "fills-by with growFinish on is a later variant" }),
  paint: bind("paint", later("fill", "finish", { note: "100 % painted" })),
  perfectFit: bind("perfectFit", later("fill", "outcome", { outcome: "most-on-floor", needs: "pfPento", note: "or landings-on-beat" })),
  // count
  multiply: bind("multiply", { format: "count", strategy: "fill", tier: "proven", keepHud: null, variants: [["clone-per-pass"]] }),
  multipliers: bind("multipliers", { format: "count", strategy: "finish", tier: "proven", keepHud: null, variants: [["multipliers-board"]], note: "the ball counter at home is the mode's own HUD" }),
  conveyor: bind("conveyor", later("count", "atEnd", { note: "loops: never 'finish'" })),
  mergeRing: bind("mergeRing", later("count", "atEnd", { note: "loops: never 'finish'; hook b 'How far can it merge?'" })),
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
  maze: bind("maze", later("whoWins", "outcome", { outcome: "winner", note: "first one out" })),
  territory: bind("territory", later("whoWins", "outcome", { outcome: "winner" })),
  landClaim: bind("landClaim", later("whoWins", "outcome", { outcome: "winner", note: "or close" })),
  // aim
  bullseye: bind("bullseye", later("aim", "finish", { note: "'Will one hit the bullseye?'" })),
  box: bind("box", later("aim", "finish", { note: "the countdown hook until the run's facts carry the corner hit" })),
  paddle: bind("paddle", later("aim", "finish", { note: "'How long can it last?'" })),
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
  /** The family of the recipe it wraps (null: none yet). */
  family: BotFamily | null;
  ready: boolean;
  /** The length buckets it fills when narrower than its recipe's: its variant's, else its binding's. */
  buckets?: readonly LengthBucket[];
}

const INFOS: readonly TemplateInfo[] = BINDINGS.flatMap((binding) =>
  binding.variants.map((v) => {
    const recipe = v.recipe ? (recipeById(v.recipe) ?? null) : null;
    const buckets = v.buckets ?? binding.buckets;
    return { id: v.id, mode: binding.mode, format: TEMPLATE_FORMATS[binding.format], binding, recipe, family: recipe?.family ?? null, ready: binding.ready && !!recipe && !v.hidden, ...(buckets ? { buckets } : {}) };
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

/** The noun a format's `{thing}` takes for a mode: its key under `ViralBot` (a later step writes `things`). */
export function thingKeyOf(mode: ModeId): string {
  return `things.${mode}`;
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

const isPayoffStrategy = (s: TemplateStrategy): s is PayoffStrategy => (PAYOFF_STRATEGIES as readonly string[]).includes(s);

/**
 * A template's recipe: the wrapped recipe pinned to the binding's mode, its buckets (the variant's) and the format's endings,
 * under the template id – timed by the binding's strategy, played with its tune, and drawn with the format's words (no payoff
 * words where its payoff speaks for itself; a stake format's number kept in the Simple hook).
 */
export function templateRecipe(info: TemplateInfo): BotRecipe | null {
  const recipe = info.recipe;
  if (!info.ready || !recipe) return null;
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
    strategy: isPayoffStrategy(info.binding.strategy) ? info.binding.strategy : recipe.strategy,
    ...(buckets && buckets.length ? { buckets } : {}),
    endings: endings.length ? endings : ownEndings,
    wraps: recipe.id,
    ...(info.format.payoffWords ? {} : { payoffWords: false as const }),
    ...(info.format.stakeHook ? { stakeHook: true as const } : {}),
    ...(info.binding.hookAsk ? { hookAsk: info.binding.hookAsk } : {}),
    countdownFrom: info.format.countdown,
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
