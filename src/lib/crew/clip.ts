import type { Caption } from "@/lib/captions";
import { outcomeMatches } from "@/lib/simulation/outcomes";
import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import { inReadingOrder, type CaptionRole, type ClipPlan, type RunFacts, type ScoreReason } from "@/lib/bot/planner";
import { BUCKET_SECONDS, PLATFORMS, type BotPlatform, type CountdownKind, type CountdownSource, type EndingStyle, type LengthBucket, type PayoffType } from "@/lib/bot/playbook";
import { botRecipeById, templateClaimOf } from "@/lib/bot/templates";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";
import type { ClipGenes, ClipGenesFeatures } from "@/lib/insights/genes";
import { factsOfExport, planLikeFromSettings, scorePlanLike, scoreRecipeFor, type ScoreFacts } from "@/lib/insights/score";

/*
 * --- crew --- The clip as the crew reads it (CrewClip): one shape for a planned clip (a bot plan, a Claude studio plan) and a
 * saved one (a Library clip: its genes, its settings and the facts of its run), so the clarity check (clarity.ts), the Simple
 * score (simplicity.ts) and the dossier (dossier.ts) read the same fields whichever way the clip came.
 *
 *  - The words and the timeline are what the clip draws: a plan's captions with the roles the planner gave them; a saved
 *    clip's with the roles the score infers (lib/insights/score.ts captionRolesOf), its Top Text as its hook where the score
 *    reads it so (hookedSettings) – the score's own reading, so the crew and the Playbook score never disagree on a role.
 *  - The beats are the plan's (the planner's run) or the score's (the clip's run with the export's measurement).
 *  - `run` is the run itself (RunFacts: the winner, the first escape, the finish): handed in, since a plan does not keep it –
 *    lib/insights/score.ts runSync() simulates a plan's seed, scoreSavedClipWithFacts() keeps a saved clip's. With the payoff's
 *    second, runSync() adds what the run plays and how it moves there (RunFacts.moment: gate G2 and the dossier read it).
 *  - `measured.watermarkDomain`: the address the render's watermark draws (gate G8 refuses a local one).
 *  - `measured` is what the render measured (after a render only): the export's features, its lagged frames, the watermark.
 *  - `cut`: the TikTok cut the clip is shown as (the Clip editor's window, its hook pill, its address line and its end card).
 *
 * The claim (what the run must visibly do, the template's word for its payoff) comes from the recipe (CLAIM_OF_RECIPE: the
 * format each playbook recipe belongs to) or from the template the clip was planned from (lib/bot/templates.ts: its format's).
 *
 * Pure: no clock, no randomness, nothing simulated here.
 */

// --- crew ---

/** What a clip's run must visibly do: the payoff a format promises (the plan's claims; the viewer answers in them too). */
export const CLAIMS = ["out", "break", "full", "count", "winner", "hit", "inSync", "beat", "picture", "gameRule"] as const;
export type Claim = (typeof CLAIMS)[number];

/** The claim of each playbook recipe (the format it belongs to: getOut, smash, fill, count, whoWins, lineUp, onTheBeat). */
export const CLAIM_OF_RECIPE: Readonly<Record<string, Claim>> = {
  "ring-escape": "out",
  "pip-escape": "out",
  "glass-smash": "out",
  "grow-fill": "full",
  "clone-per-pass": "count",
  "multipliers-board": "count",
  "power-layers": "break",
  "pendulum-wave": "inSync",
  polyrhythm: "inSync",
  "drop-symphony": "beat",
  "string-battle": "winner",
  territory: "winner",
  "battle-royale": "winner",
  "square-race": "winner",
  "maze-race": "winner",
  "fight-duel": "winner",
  "fight-upset": "winner",
  "fight-bracket": "winner",
  "fight-boss": "winner",
};

/** What a render measured of the clip (after a render only). */
export interface CrewMeasured {
  /** The fast export's features (ClipFeatures), or a saved clip's scalar summary (its genes'); null: not measured. */
  features: ClipFeatures | ClipGenesFeatures | null;
  /** The file's length (s). */
  durationSec: number | null;
  /** Frames the export had to drop or repeat to keep up, and the frames it wrote (G8: at most 2 % lagged). */
  laggedFrames: number | null;
  frames: number | null;
  /** The watermark is on every frame (the render's own check); null: not known. */
  watermarked: boolean | null;
  /** The domain the watermark draws (the export's); null or absent: not known. */
  watermarkDomain?: string | null;
  /** A free run: it must carry the watermark. */
  free: boolean;
}

/** The TikTok cut a clip is shown as (lib/clipEdit/spec.ts ClipEditSpec's fields the crew reads). */
export interface CrewCut {
  startSec: number;
  lengthSec: number;
  /** The hook pill on top from the first frame ("" for none). */
  hook: string;
  /** The address line under it and on the end card ("" for none). */
  url: string;
  /** Seconds of end card after the action. */
  cardSec: number;
}

export interface CrewClip {
  from: "plan" | "saved";
  /** The clip's settings (the Simple score's effects and HUDs come from here). */
  settings: SimulatorSettings;
  /** The captions as drawn and what each is for (a saved clip's Top Text as its hook where the score reads it so). */
  captions: Caption[];
  captionRoles: CaptionRole[];
  topText: string;
  bottomText: string;
  /** The mode it was planned in (a mode switch since: settings.mode differs). */
  mode: ModeId;
  /** A RECIPES id, or null. */
  recipe: string | null;
  /** --- crew --- The template it was planned from (lib/bot/templates.ts), null: none. */
  template: string | null;
  claim: Claim | null;
  platform: BotPlatform;
  bucket: LengthBucket;
  ending: EndingStyle;
  seed: number | null;
  /** The bot series' day (0: not part of a series). */
  episode: number;
  /** The hook the clip's words say it has: the plan's, or the AI's own (meta) hook; null: none given. */
  hook: string | null;
  payoff: {
    type: PayoffType | null;
    /** Clip second of the payoff (after the clip's end on a cut), null: none within the run followed. */
    atSec: number | null;
    position: number | null;
    cutGapSec: number | null;
    /** The payoff's words (the plan's), null: none given. */
    text: string | null;
    /** The winner the words name (the plan's), null: none. */
    winner: string | null;
  };
  timing: { clipSec: number; recordingDuration: number; firstImpactSec: number | null };
  countdown: { kind: CountdownKind; source: CountdownSource } | null;
  /** The planner simulated it (a plan without the search has targets, not facts). */
  simulated: boolean;
  run: RunFacts | null;
  measured: CrewMeasured | null;
  cut: CrewCut | null;
  playbook: { score: number; reasons: ScoreReason[] };
}

/** What a plan does not carry: its run, what its render measured, the cut it is shown as, the AI's own hook. */
export interface CrewExtras {
  run?: RunFacts | null;
  measured?: CrewMeasured | null;
  cut?: CrewCut | null;
  /** The AI's own (meta) hook, when it is not the plan's. */
  hook?: string | null;
  /** The template the clip was planned from, when the plan does not say (a plan records its own). */
  template?: string | null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The claim of a recipe – a playbook recipe's, or a template's format's (null: no recipe, or one without a claim). */
export function claimOfRecipe(recipe: string | null | undefined): Claim | null {
  return recipe && Object.prototype.hasOwnProperty.call(CLAIM_OF_RECIPE, recipe) ? CLAIM_OF_RECIPE[recipe] : templateClaimOf(recipe);
}

/** The clip a bot plan describes (its own fields), with what it does not carry. */
export function crewClipOfPlan(plan: ClipPlan, extras: CrewExtras = {}): CrewClip {
  const s = plan.settings;
  return {
    from: "plan",
    settings: s,
    captions: s.captions,
    captionRoles: [...plan.captionRoles],
    topText: s.topText,
    bottomText: s.bottomText,
    mode: plan.mode,
    recipe: plan.recipe,
    template: extras.template ?? plan.template ?? null,
    claim: claimOfRecipe(plan.recipe) ?? templateClaimOf(extras.template ?? plan.template),
    platform: plan.platform,
    bucket: plan.bucket,
    ending: plan.ending,
    seed: plan.seed,
    episode: plan.episode,
    hook: extras.hook !== undefined ? extras.hook : plan.hook,
    payoff: { type: plan.payoff.type, atSec: plan.payoff.atSec, position: plan.payoff.position, cutGapSec: plan.payoff.cutGapSec, text: plan.payoff.text, winner: plan.payoff.winner },
    timing: { clipSec: plan.timing.clipSec, recordingDuration: plan.timing.recordingDuration, firstImpactSec: plan.timing.firstImpactSec },
    countdown: { ...plan.countdown },
    simulated: plan.timing.firstImpactSec !== null || !!extras.run,
    run: extras.run ?? null,
    measured: extras.measured ?? null,
    cut: extras.cut ?? null,
    playbook: { score: plan.score, reasons: plan.reasons },
  };
}

/** A saved clip: its settings, its genes, the facts of its run and what its render measured. */
export interface SavedCrewInput {
  settings: SimulatorSettings;
  genes?: ClipGenes | null;
  /** The facts the score read (scoreSavedClipWithFacts().facts). */
  facts: ScoreFacts;
  run?: RunFacts | null;
  seed?: number | null;
  /** The platform it was made for (null: the one whose default bucket is the clip's). */
  platform?: BotPlatform | null;
  /** The clip's meta hook (the AI's own, or the plan's), null: none. */
  hook?: string | null;
  measured?: CrewMeasured | null;
  cut?: CrewCut | null;
  template?: string | null;
}

/** The clip a saved file describes, read as the score reads it (planLikeFromSettings). */
export function crewClipOfSaved(input: SavedCrewInput): CrewClip {
  const genes = input.genes ?? null;
  const planned = genes?.source === "ai" || genes?.source === "plan";
  const like = planLikeFromSettings(input.settings, input.facts, {
    platform: input.platform ?? null,
    episode: genes?.episode ?? null,
    melody: genes?.melody ?? null,
    recipe: genes?.recipe ?? null,
    bucket: planned ? genes?.bucket ?? null : null,
    bucketSec: planned ? genes?.durationSec ?? null : null,
    ending: planned ? genes?.ending ?? null : null,
  });
  const recipe = like.recipe ? like.recipe : null;
  const scored = scorePlanLike(like);
  const s = like.settings;
  const mode = (genes?.mode as ModeId | null | undefined) ?? input.settings.mode;
  // --- templates --- (as a viewer reads them: a message at the bottom of the square is stacked upwards)
  const payoffWords = inReadingOrder(s.captions, s.captions.map((_, i) => (like.captionRoles[i] === "payoff" ? i : -1)).filter((i) => i >= 0)).map((i) => s.captions[i].text.trim()).filter(Boolean);
  return {
    from: "saved",
    settings: input.settings,
    captions: s.captions,
    captionRoles: like.captionRoles,
    topText: s.topText,
    bottomText: s.bottomText,
    mode,
    recipe,
    template: input.template ?? null,
    claim: claimOfRecipe(recipe),
    platform: like.platform,
    bucket: like.bucket,
    ending: like.ending,
    seed: input.seed ?? null,
    episode: like.episode,
    hook: input.hook ?? null,
    payoff: { type: botRecipeById(recipe)?.payoff ?? null, atSec: like.payoff.atSec, position: like.payoff.position, cutGapSec: like.payoff.cutGapSec, text: payoffWords.length ? payoffWords.join(" ") : null, winner: null },
    timing: { clipSec: like.timing.clipSec, recordingDuration: input.settings.recordingDuration, firstImpactSec: like.timing.firstImpactSec },
    countdown: { ...like.countdown },
    simulated: !!input.run || input.facts.firstImpactSec !== null || input.facts.payoffSec !== null,
    run: input.run ?? null,
    measured: input.measured ?? null,
    cut: input.cut ?? null,
    playbook: scored,
  };
}

/** The clip's length on screen (s): the cut's (its action and its end card) or the clip's own. */
export function shownSecOf(clip: Pick<CrewClip, "cut" | "timing">): number {
  if (clip.cut) return Math.max(0, clip.cut.lengthSec) + Math.max(0, clip.cut.cardSec);
  return clip.timing.clipSec;
}

/**
 * The first impact a render measured: its first motion or its first sound, the earlier – the Playbook score's own reading of
 * an export (lib/insights/score.ts factsOfExport), so the crew's gate G1 and the checklist's motion item never disagree on one
 * file. The picture alone misses a small ball on the Simple look's dark background (the analyser's 16 × 16 thumbnails and its
 * MOTION_MIN): the studio's real run measured a Power Layers clip's first motion at 7.5 s and heard its first bounce at 0.83 s.
 * null: neither was measured.
 */
export function measuredFirstImpactSec(features: Pick<ClipFeatures | ClipGenesFeatures, "firstMotionSec" | "firstSoundSec">): number | null {
  return factsOfExport(features, null).firstImpactSec;
}

/** The winner the run names (its mode's own, a fight's name, or the team the finder's winner predicate picks); null: none. */
export function runWinnerOf(clip: Pick<CrewClip, "run" | "settings" | "timing">): string | null {
  const run = clip.run;
  if (!run) return null;
  if (run.winnerName) return run.winnerName;
  const teams = clip.settings.teams;
  if (run.winnerIndex >= 0) return teams[run.winnerIndex]?.name || `#${run.winnerIndex + 1}`;
  const count = run.summary.teams.length;
  if (count < 2) return null;
  for (let team = 0; team < count; team++) if (outcomeMatches({ kind: "winner", clipSec: clip.timing.clipSec, team }, run.summary)) return teams[team]?.name || `#${team + 1}`;
  return null;
}

/** Whether the run shows the claim at all (null: nothing to judge it by – no run, nothing simulated). */
export function claimSeen(clip: CrewClip): boolean | null {
  if (!clip.claim) return null;
  const run = clip.run;
  if (!run) return clip.simulated ? clip.payoff.atSec !== null : null;
  switch (clip.claim) {
    case "out":
      return run.firstEscapeSec >= 0 || run.homeSec >= 0;
    case "full":
      return run.fillSec >= 0;
    case "count":
      return run.fillSec >= 0 || run.finishSec >= 0;
    case "beat":
      return run.finishSec >= 0;
    case "winner":
      return runWinnerOf(clip) !== null;
    default:
      // analytic payoffs (a layer stack's break, a wave's realignment): the settings fix the moment
      return clip.payoff.atSec !== null;
  }
}

/** The numbers a hook may state truthfully: the recipe's own hook values, the clip's length, the day, and one. */
export function factNumbersOf(clip: Pick<CrewClip, "recipe" | "settings" | "timing" | "episode" | "mode">): number[] {
  const out = new Set<number>([1, clip.timing.recordingDuration, Math.floor(clip.timing.clipSec), Math.round(clip.timing.clipSec), Math.ceil(clip.timing.clipSec)]);
  if (clip.episode >= 1) out.add(clip.episode);
  const recipe = botRecipeById(clip.recipe) ?? scoreRecipeFor(clip.settings.mode, clip.recipe) ?? null;
  if (recipe) {
    try {
      for (const v of Object.values(recipe.hookVars(clip.settings))) {
        const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
        if (finite(n)) out.add(n);
      }
    } catch {
      // a recipe's hook values for settings it was not planned with: none
    }
  }
  return [...out].filter(finite).sort((a, b) => a - b);
}

/**
 * A number as a text writes it: digits in groups of three with one separator throughout ("1,000", "1.000", "2 500" with a
 * space, a no-break or a thin space, "1'000") and a decimal part after them in the other mark ("12,345.6", "1.234,5"); else
 * digits with a decimal point or comma ("1,5", "2.5"); then a glued k or M ("10k", "2.5M") that multiplies it.
 * (lead) (grouped: first group, separator, the rest; its decimal mark and digits) (plain) (suffix)
 */
const NUMBER_RE = /(^|[^\p{L}\p{N}.,])(?:([1-9]\d{0,2}([,.'\u2019\u00a0\u202f\u2009 ])\d{3}(?:\3\d{3})*)(?:(?!\3)[.,](\d+))?|(\d+(?:[.,]\d+)?))(?!\p{N})([kKM](?![\p{L}\p{N}]))?/gu;
const MAGNITUDE: Readonly<Record<string, number>> = { k: 1e3, K: 1e3, M: 1e6 };

/**
 * --- crew --- (the studio's second review round, finding 3) A text's decimal digits of any script – Arabic-Indic, Devanagari,
 * fullwidth, mathematical bold… – as ASCII digits, so "５０", "٥٠" and "𝟓𝟎" read as 50. Unicode assigns decimal digits only
 * in runs of ten from 0 to 9, some runs back to back (the mathematical digits), so a digit's value is its distance from the
 * start of its run of digits, modulo ten.
 */
export function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (d) => {
    const cp = d.codePointAt(0)!;
    if (cp <= 0x7f) return d;
    let k = 0;
    while (k < 100 && /\p{Nd}/u.test(String.fromCodePoint(cp - k - 1))) k++;
    return String(k % 10);
  });
}

/**
 * The numbers a text writes in digits (asciiDigits first), as a reader reads them: "1,000", "1.000" and "1 000" are a
 * thousand, "2,500" is 2500, "1,5" and "1.5" are one and a half, "10k" is ten thousand (see NUMBER_RE). A number glued to a
 * letter before it ("x2", "ep12") or after a multiplication sign ("×4") is a label, not a count, and is left out.
 */
export function numeralsIn(text: string): number[] {
  return numeralsAt(text).map((x) => x.value);
}

function numeralsAt(text: string): { at: number; value: number }[] {
  const out: { at: number; value: number }[] = [];
  for (const m of asciiDigits(text).matchAll(NUMBER_RE)) {
    if (m[1] === "×") continue;
    const n = m[2] !== undefined ? Number(`${m[2].replace(/\D/g, "")}${m[4] !== undefined ? `.${m[4]}` : ""}`) : Number(m[5].replace(",", "."));
    const value = m[6] ? n * MAGNITUDE[m[6]] : n;
    if (finite(value)) out.push({ at: (m.index ?? 0) + m[1].length, value: Math.round(value * 1e6) / 1e6 });
  }
  return out;
}

/*
 * --- crew --- (the studio's second review round, finding 3) Number words in the clip languages (en, pl, es), the way a hook
 * spells a count: the units, the teens, the tens, the hundreds, a dozen, thousand and million, in the forms a hook uses
 * (Polish cases included). A word's place says what may follow it in one number: a smaller word ("twenty one", "treinta y
 * tres", "sto dwadzieścia"), or a multiplier ("two hundred", "dwa tysiące", "dos mil", "a dozen"). Three words are a number
 * in one language and a plain word in another, and read by the text's language: "ten" (Polish "this"), "mil" (Polish
 * "miles") and "once" (English, not Spanish eleven).
 */
type NumberWord = { value: number; kind: "add" | "times" | "scale" };
const NUMBER_WORDS: ReadonlyMap<string, NumberWord> = (() => {
  const m = new Map<string, NumberWord>();
  const add = (value: number, ...words: string[]) => words.forEach((w) => m.set(w, { value, kind: "add" }));
  const times = (value: number, ...words: string[]) => words.forEach((w) => m.set(w, { value, kind: "times" }));
  const scale = (value: number, ...words: string[]) => words.forEach((w) => m.set(w, { value, kind: "scale" }));
  const each = (from: number, step: number, words: string[]) => words.forEach((w, i) => add(from + step * i, w));
  // English
  each(0, 1, ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]);
  each(10, 1, ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]);
  each(20, 10, ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]);
  times(100, "hundred", "hundreds");
  times(12, "dozen", "dozens");
  scale(1e3, "thousand", "thousands");
  scale(1e6, "million", "millions");
  // Polish (the cases a hook uses)
  add(1, "jeden", "jedna", "jedno", "jednego", "jednej", "jedną", "jednym", "jednemu");
  add(2, "dwa", "dwie", "dwóch", "dwoma", "dwu", "dwoje", "dwojga");
  add(3, "trzy", "trzech", "trzema", "troje", "trojga");
  add(4, "cztery", "czterech", "czterema", "czworo", "czworga");
  add(5, "pięć", "pięciu", "pięcioma", "pięcioro");
  add(6, "sześć", "sześciu", "sześcioma", "sześcioro");
  add(7, "siedem", "siedmiu", "siedmioma", "siedmioro");
  add(8, "osiem", "ośmiu", "ośmioma", "ośmioro");
  add(9, "dziewięć", "dziewięciu", "dziewięcioma", "dziewięcioro");
  add(10, "dziesięć", "dziesięciu", "dziesięcioma");
  each(11, 1, ["jedenaście", "dwanaście", "trzynaście", "czternaście", "piętnaście", "szesnaście", "siedemnaście", "osiemnaście", "dziewiętnaście"]);
  each(11, 1, ["jedenastu", "dwunastu", "trzynastu", "czternastu", "piętnastu", "szesnastu", "siedemnastu", "osiemnastu", "dziewiętnastu"]);
  each(20, 10, ["dwadzieścia", "trzydzieści", "czterdzieści", "pięćdziesiąt", "sześćdziesiąt", "siedemdziesiąt", "osiemdziesiąt", "dziewięćdziesiąt"]);
  each(20, 10, ["dwudziestu", "trzydziestu", "czterdziestu", "pięćdziesięciu", "sześćdziesięciu", "siedemdziesięciu", "osiemdziesięciu", "dziewięćdziesięciu"]);
  each(100, 100, ["sto", "dwieście", "trzysta", "czterysta", "pięćset", "sześćset", "siedemset", "osiemset", "dziewięćset"]);
  each(100, 100, ["stu", "dwustu", "trzystu", "czterystu", "pięciuset", "sześciuset", "siedmiuset", "ośmiuset", "dziewięciuset"]);
  times(12, "tuzin", "tuziny", "tuzinów", "tuzina");
  scale(1e3, "tysiąc", "tysiące", "tysięcy", "tysiąca");
  scale(1e6, "milion", "miliony", "milionów", "miliona");
  // Spanish
  add(0, "cero");
  add(1, "un", "uno", "una");
  each(2, 1, ["dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"]);
  each(11, 1, ["once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"]);
  each(20, 1, ["veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"]);
  add(21, "veintiún", "veintiuna");
  each(30, 10, ["treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]);
  add(100, "cien", "ciento");
  each(200, 100, ["doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"]);
  each(200, 100, ["doscientas", "trescientas", "cuatrocientas", "quinientas", "seiscientas", "setecientas", "ochocientas", "novecientas"]);
  times(12, "docena", "docenas");
  scale(1e3, "mil");
  scale(1e6, "millón", "millones");
  return m;
})();
/** A multiplier in the plural with no number before it is no count: "hundreds of balls", "tysiące kulek", "docenas de". */
const VAGUE_ALONE = new Set(["hundreds", "dozens", "thousands", "millions", "tuziny", "tuzinów", "tysiące", "tysięcy", "miliony", "milionów", "docenas", "millones"]);
/** Words that join the parts of one number: "one hundred and five", "treinta y tres". */
const NUMBER_JOINS = new Set(["and", "y"]);
/** "a" and "an" before a multiplier are one: "a hundred", "a dozen", "a thousand". */
const ONE_BEFORE = new Set(["a", "an"]);
/** A Polish text: a letter only Polish writes of the three languages, or a word only Polish has. */
const POLISH_LETTERS = /[ąćęłńśźż]/u;
const POLISH_WORDS = new Set(["czy", "się", "nie", "jak", "ile", "kto", "jest", "są", "ze", "tylko", "już", "przez", "aż", "gdzie", "kiedy", "gdy", "co", "czym", "dlaczego", "albo", "oraz", "aby", "zanim", "jeszcze", "teraz", "bardzo", "który", "która", "które", "którą", "każdy", "każda", "każde", "wszystkie", "wszystko", "kulka", "kulki", "kulek", "klip"]);
/** A Spanish text: its marks and accents, or a word only Spanish has. */
const SPANISH_LETTERS = /[ñ¿¡áéíú]/u;
const SPANISH_WORDS = new Set(["el", "la", "los", "las", "de", "del", "que", "y", "en", "por", "con", "se", "es", "son", "hasta", "sin", "cuántas", "cuántos", "cuantas", "cuantos", "quién", "quien", "qué", "cuál", "gana", "bola", "bolas", "anillo", "anillos"]);
/** Between two words of one number: spaces and hyphens only ("twenty-one"); any other mark ends it ("one, two"). */
const JOINED = /^[\s\-\u2010\u2011]*$/u;

/** The place a word fills in a number: what may come after it is smaller (a unit after "twenty", anything below 100 after "sto"). */
const placeOf = (value: number) => (value >= 100 && value % 100 === 0 ? 100 : value >= 20 && value < 100 && value % 10 === 0 ? 10 : 1);

/** --- crew --- The numbers a text spells in words (see NUMBER_WORDS), each where it starts. */
function numberWordsAt(text: string): { at: number; value: number }[] {
  const lower = text.normalize("NFC").toLocaleLowerCase("en");
  const tokens = [...lower.matchAll(/[\p{L}\p{M}]+/gu)].map((m) => ({ word: m[0], at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const polish = POLISH_LETTERS.test(lower) || tokens.some((t) => POLISH_WORDS.has(t.word));
  const spanish = SPANISH_LETTERS.test(lower) || tokens.some((t) => SPANISH_WORDS.has(t.word));
  const wordOf = (w: string): NumberWord | null => {
    if (w === "ten" && (polish || spanish)) return null; // (Polish "this", Spanish "have")
    if (w === "mil" && polish) return null; // (Polish "miles")
    if (w === "once" && !spanish) return null; // (English "once")
    return NUMBER_WORDS.get(w) ?? null;
  };
  const out: { at: number; value: number }[] = [];
  let group: { at: number; total: number; current: number; place: number } | null = null;
  const close = () => {
    if (group) out.push({ at: group.at, value: group.total + group.current });
    group = null;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i > 0 && !JOINED.test(lower.slice(tokens[i - 1].end, t.at))) close();
    const after = tokens[i + 1] && JOINED.test(lower.slice(t.end, tokens[i + 1].at)) ? wordOf(tokens[i + 1].word) : null;
    if (group && NUMBER_JOINS.has(t.word) && after?.kind === "add" && after.value < group.place) continue;
    let w = wordOf(t.word);
    if (!w && ONE_BEFORE.has(t.word) && after && after.kind !== "add") w = { value: 1, kind: "add" };
    if (w && w.kind !== "add" && VAGUE_ALONE.has(t.word) && !group) w = null;
    if (!w) {
      close();
      continue;
    }
    if (w.kind === "add" && group && !(w.value < group.place)) close();
    const g: { at: number; total: number; current: number; place: number } = group ?? { at: t.at, total: 0, current: 0, place: Infinity };
    group = g;
    if (w.kind === "add") {
      g.current += w.value;
      g.place = placeOf(w.value);
    } else if (w.kind === "times") {
      g.current = (g.current || 1) * w.value;
      g.place = w.value === 100 ? 100 : 1;
    } else {
      if (g.current === 0 && g.total > 0 && w.value > g.place) g.total *= w.value; // ("dos mil millones")
      else g.total += (g.current || 1) * w.value;
      g.current = 0;
      g.place = w.value;
    }
  }
  close();
  return out;
}

/**
 * The numbers a text states, as a reader reads them, in its order: the ones it writes in digits of any script (numeralsIn)
 * and the ones it spells in words in English, Polish or Spanish ("Fifty rings", "pięćdziesiąt", "cincuenta y tres", "a dozen").
 * --- crew --- (the studio's second review round, finding 3) A hook's numbers are checked against the clip's facts whichever
 * way they are written (gate G4, rewriteHook, the skeptic's hookUntrue).
 */
export function numbersIn(text: string): number[] {
  return [...numeralsAt(text), ...numberWordsAt(text)].sort((a, b) => a.at - b.at).map((x) => x.value);
}

/** The buckets the platform takes that the clip's length is in (scoreClip's 0.5 s slack). */
export function bucketsFitting(platform: BotPlatform, sec: number): LengthBucket[] {
  return PLATFORMS[platform].buckets.filter((b) => sec >= BUCKET_SECONDS[b].min - 0.5 && sec <= BUCKET_SECONDS[b].max + 0.5);
}
// --- end crew ---
