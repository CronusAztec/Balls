import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import type { FinderOutcomeKind, OutcomeContext } from "@/lib/simulation/outcomes";
import type { Claim } from "@/lib/crew/clip";
import { defaultKeptHuds, hudsOn } from "@/lib/crew/hudFlags";
import { BOT_DEFAULT_FAMILIES, BOT_FAMILIES, recipeById, type BotFamily, type BotFamilyChoice, type BotRecipe, type EndingStyle, type LengthBucket, type PayoffStrategy, type RecipeContext } from "./playbook";

/*
 * --- templates --- A viral template for every mode: ten formats (what a clip promises and shows) and a binding of each of
 * the 48 modes to one of them (MODE_TEMPLATES: a Record over ModeId, so a new mode without a binding fails the type check),
 * the adapter that turns a binding into a recipe the planner plans unchanged (templateRecipeById), and the Simple look
 * (SIMPLE_LOOK, the one-line-at-a-time text plan) that keeps a clip calm.
 *
 *  - A format: its idea in one sentence, its claim (what the run must visibly do: the crew's G4 and the viewer check it), its
 *    copy under `ViralBot.formats.<id>` (name, hook, hookB, hookC, cliffHook, payoff, cliffQuestion, postQuestion – a later
 *    step writes it), where its countdown comes from and the endings it takes.
 *  - A binding: the mode's format, how the planner times its payoff (a playbook strategy, or – a later step – the bound finder
 *    outcome or the clip's end), the context flag that outcome needs, the length buckets it can fill, the HUD it keeps (only
 *    the one that shows the countdown), its tier and its variants. Tiers: proven (wraps a playbook recipe and passes every
 *    clarity gate at Simple 80+ and Playbook 75+), trial and experimental (hidden from every menu). Only ready bindings plan:
 *    in this release the 16 proven ones, each variant wrapping one recipe; the other 32 are declared and hidden until their
 *    strategies and copy land (docs/virality-playbook.md §5).
 *  - A variant: one template id (`<format>-<mode>[-<variant>]`, kebab-case: it names clip files) wrapping one recipe, or
 *    hidden with its reason (a variant that fails a gate on every plan). Its adapter (templateRecipe) is the recipe pinned to
 *    the binding's mode, buckets and endings (the format's, narrowed by the binding's): planClipSteps plans it like any recipe
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
 * the bot look's. The cinematic camera stays as the mode plays it, since its slow motion moves the run in 12 modes (§5).
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
export function simpleLookPatch(s: SimulatorSettings, countdownSource: "caption" | "hud", keepHuds?: readonly string[]): Partial<SimulatorSettings> {
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
  /** The payoff's words at most: one short line, read in the second or so a run leaves after its payoff. */
  payoffWordsMax: 3,
} as const;

const wordsOf = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * A text cut to at most `max` words by whole clauses (sentences, or the parts around a colon): the text itself when it fits,
 * else the longest run of its clauses that does and has `min` words or more – a question among them first (`preferQuestion`),
 * else one from its start – with its first letter in capitals ("Pick a side: which colour takes the board?" → "Which colour
 * takes the board?"). A text none of whose runs fits stays as it is. Only the text's own words: nothing is added, so its
 * numbers and names stay the clip's.
 */
function shortenByClauses(text: string, max: number, min: number, preferQuestion: boolean): string {
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
  const fromStart = runs.filter((r) => r.startsWith(clauses[0]));
  const pool = asks.length ? asks : fromStart.length ? fromStart : runs;
  const pick = pool.reduce((a, b) => (wordsOf(b) > wordsOf(a) ? b : a)).replace(/:$/u, ".");
  // its first letter in capitals (after an opening ¿ or ¡)
  return pick.replace(/^([¿¡"“]*)(\p{Ll})/u, (_, lead: string, first: string) => `${lead}${first.toLocaleUpperCase()}`);
}

/** The hook the Simple look draws: the recipe's own, cut to at most 7 words by whole clauses (shortenByClauses), its question first. */
export function simpleHookText(hook: string): string {
  return shortenByClauses(hook, SIMPLE_TEXT.hookWordsMax, 2, true);
}

/** The payoff's words the Simple look draws: the recipe's own, cut to at most 3 words by whole clauses ("FREE! Gerald made it 🎉" → "FREE!"). */
export function simplePayoffText(payoff: string): string {
  return shortenByClauses(payoff, SIMPLE_TEXT.payoffWordsMax, 1, false);
}

/* ------------------------------------------------------------------ the formats */

export const TEMPLATE_FORMAT_IDS = ["getOut", "smash", "fill", "count", "whoWins", "aim", "lineUp", "onTheBeat", "reveal", "labGame"] as const;
export type TemplateFormatId = (typeof TEMPLATE_FORMAT_IDS)[number];

/** Where a format's countdown comes from: the picture itself, the mode's HUD, or a caption after the hook. */
export type CountdownFrom = "picture" | "hud" | "caption";

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
}

export const TEMPLATE_FORMATS: Readonly<Record<TemplateFormatId, TemplateFormat>> = {
  getOut: { id: "getOut", idea: "Something is trapped; will it get out, and the moment it does.", claim: "out", copyKey: "getOut", countdown: ["hud", "caption"], endings: ["resolved", "cliffhanger"] },
  smash: { id: "smash", idea: "Every hit wears it down; which hit breaks it.", claim: "break", copyKey: "smash", countdown: ["hud", "caption"], endings: ["resolved", "cliffhanger"] },
  fill: { id: "fill", idea: "It grows until it fills the space.", claim: "full", copyKey: "fill", countdown: ["caption"], endings: ["resolved"] },
  count: { id: "count", idea: "One becomes many; how many by the end.", claim: "count", copyKey: "count", countdown: ["hud", "picture"], endings: ["resolved"] },
  whoWins: { id: "whoWins", idea: "Pick one before it starts; one of them wins.", claim: "winner", copyKey: "whoWins", countdown: ["hud", "picture"], endings: ["resolved", "cliffhanger"] },
  aim: { id: "aim", idea: "One shot at a target; does it hit.", claim: "hit", copyKey: "aim", countdown: ["caption"], endings: ["resolved", "cliffhanger"] },
  lineUp: { id: "lineUp", idea: "Out of step, then all in line at once.", claim: "inSync", copyKey: "lineUp", countdown: ["picture", "hud"], endings: ["resolved"] },
  onTheBeat: { id: "onTheBeat", idea: "Every bounce is a note; the drop or the last bar is the payoff.", claim: "beat", copyKey: "onTheBeat", countdown: ["picture"], endings: ["resolved"] },
  reveal: { id: "reveal", idea: "Lines pile up into a picture; guess it before it is done.", claim: "picture", copyKey: "reveal", countdown: ["picture"], endings: ["resolved"] },
  labGame: { id: "labGame", idea: "A Mode Lab game played to its own finish rule.", claim: "gameRule", copyKey: "labGame", countdown: ["hud"], endings: ["resolved"] },
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
  /** Why a variant of a ready binding is hidden (it fails a clarity gate on every plan); absent: it plans with its binding. */
  hidden?: string;
}

export interface ModeBinding {
  mode: ModeId;
  format: TemplateFormatId;
  strategy: TemplateStrategy;
  tier: TemplateTier;
  /** It plans in this release (the proven bindings); the others are declared and hidden. */
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

/** A variant's spec: the recipe it wraps, its id's suffix, why it is hidden. */
type VariantSpec = readonly [recipe: string | null, suffix?: string, hidden?: string];
type BindingSpec = Omit<ModeBinding, "mode" | "variants" | "ready"> & { variants?: readonly VariantSpec[] };

/** A binding from its spec: its variants' ids from the format and the mode; ready when proven. */
function bind(mode: ModeId, spec: BindingSpec): ModeBinding {
  const variants = (spec.variants ?? [[null]]).map(([recipe, suffix, hidden]): TemplateVariant => ({ id: templateIdOf(spec.format, mode, suffix), recipe, ...(hidden ? { hidden } : {}) }));
  return { ...spec, mode, ready: spec.tier === "proven", variants };
}

/** The run ends with the escape: a resolved clip would show it for the recorder's 0.5 s only, under the crew's G2 0.8 s. */
const ENDS_AT_ESCAPE = "the run ends with the escape (a resolved clip shows it for 0.5 s, G2 asks 0.8 s): the template cuts before it";

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
  portal: bind("portal", { format: "getOut", strategy: "escape", tier: "proven", keepHud: null, variants: [["ring-escape"], ["pip-escape", "gerald"]], buckets: ["short", "standard"], endings: ["cliffhanger"], note: `a minute-long escape needs Classic's slow grind; ${ENDS_AT_ESCAPE}` }),
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
  race: bind("race", { format: "whoWins", strategy: "finish", tier: "proven", keepHud: null, variants: [["square-race"]] }),
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
  pendulum: bind("pendulum", { format: "lineUp", strategy: "cycle", tier: "proven", keepHud: null, variants: [["pendulum-wave"]] }),
  polyrhythm: bind("polyrhythm", { format: "lineUp", strategy: "cycle", tier: "proven", keepHud: null, variants: [["polyrhythm"]] }),
  starChords: bind("starChords", later("lineUp", "outcome", { outcome: "star-set" })),
  ellipseFoci: bind("ellipseFoci", later("lineUp", "outcome", { outcome: "converge-on-beat" })),
  hoops: bind("hoops", later("lineUp", "outcome", { outcome: "all-up-by" })),
  orbGrid: bind("orbGrid", later("lineUp", "outcome", { outcome: "resolves-at" })),
  colourSort: bind("colourSort", later("lineUp", "outcome", { outcome: "sorted-by", needs: "colourSortSettles", note: "a gate rule whose sort does not only settle" })),
  doublePendulum: bind("doublePendulum", later("lineUp", "outcome", { outcome: "diverges-at", needs: "dpFan", note: "hook b: 'Same start. Watch them split.'" })),
  // onTheBeat
  drop: bind("drop", { format: "onTheBeat", strategy: "finish", tier: "proven", keepHud: null, variants: [["drop-symphony"]] }),
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
}

const INFOS: readonly TemplateInfo[] = BINDINGS.flatMap((binding) =>
  binding.variants.map((v) => {
    const recipe = v.recipe ? (recipeById(v.recipe) ?? null) : null;
    return { id: v.id, mode: binding.mode, format: TEMPLATE_FORMATS[binding.format], binding, recipe, family: recipe?.family ?? null, ready: binding.ready && !!recipe && !v.hidden };
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

/** A template's recipe: the wrapped recipe pinned to the binding's mode, its buckets and the format's endings, under the template id. */
export function templateRecipe(info: TemplateInfo): BotRecipe | null {
  const recipe = info.recipe;
  if (!info.ready || !recipe) return null;
  const buckets = info.binding.buckets ? (recipe.buckets ?? info.binding.buckets).filter((b) => info.binding.buckets!.includes(b)) : recipe.buckets;
  const ownEndings = recipe.endings ?? (["resolved", "cliffhanger"] as const);
  const endings = ownEndings.filter((e) => info.format.endings.includes(e) && (!info.binding.endings || info.binding.endings.includes(e)));
  return {
    ...recipe,
    id: info.id,
    modes: [info.mode],
    settings: pinnedSettings(recipe, info.mode),
    ...(buckets && buckets.length ? { buckets } : {}),
    endings: endings.length ? endings : ownEndings,
    wraps: recipe.id,
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
