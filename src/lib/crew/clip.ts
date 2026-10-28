import type { Caption } from "@/lib/captions";
import { outcomeMatches } from "@/lib/simulation/outcomes";
import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import type { CaptionRole, ClipPlan, RunFacts, ScoreReason } from "@/lib/bot/planner";
import { BUCKET_SECONDS, PLATFORMS, type BotPlatform, type CountdownKind, type CountdownSource, type EndingStyle, type LengthBucket, type PayoffType } from "@/lib/bot/playbook";
import { botRecipeById, templateClaimOf } from "@/lib/bot/templates";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";
import type { ClipGenes, ClipGenesFeatures } from "@/lib/insights/genes";
import { planLikeFromSettings, scorePlanLike, scoreRecipeFor, type ScoreFacts } from "@/lib/insights/score";

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
 *    lib/insights/score.ts runSync() simulates a plan's seed, scoreSavedClipWithFacts() keeps a saved clip's.
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
  const payoffWords = s.captions.filter((_, i) => like.captionRoles[i] === "payoff").map((c) => c.text.trim()).filter(Boolean);
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
 * The numbers a text states: digits, with a decimal point or comma. A number glued to a letter before it ("x2", "ep12") or
 * after a multiplication sign ("×4") is a label, not a count, and is left out.
 */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(^|[^\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)/gu)) {
    if (m[1] === "×") continue;
    out.push(Number(m[2].replace(",", ".")));
  }
  return out;
}

/** The buckets the platform takes that the clip's length is in (scoreClip's 0.5 s slack). */
export function bucketsFitting(platform: BotPlatform, sec: number): LengthBucket[] {
  return PLATFORMS[platform].buckets.filter((b) => sec >= BUCKET_SECONDS[b].min - 0.5 && sec <= BUCKET_SECONDS[b].max + 0.5);
}
// --- end crew ---
