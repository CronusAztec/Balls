import type { ClipPlan, ScoreReason } from "@/lib/bot/planner";
import type { BotFamily, BotRecipe, ChecklistId, CountdownKind, EndingStyle, LengthBucket } from "@/lib/bot/playbook";
import type { SimulatorSettings } from "@/lib/settings";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";

/*
 * --- insights --- Clip genes (ClipGenes v1): what a clip was made from, as a small closed record that travels with the clip
 * from the render queue to the Library (`LibraryMeta.genes`), the posting queue (`SocialQueueItem.genes`) and the audit line
 * of every post the app created (`SocialAuditEntry.genes`, with the TikTok privacy chosen at approval and the hashtag count
 * and question of the text approved: `genesAtApproval()`). That last copy is the attribution ledger: a Postiz post id keeps
 * its genes after the Library file or the queue item is gone, so what made each post can still be read when its numbers
 * come in. The hook genes are the hook the clip draws (lib/insights/score.ts drawnHookOf), never copy it does not show.
 *
 * Who writes them: the render queue's sources (lib/desktop/queueSources.ts: a bot plan, an AI clip, a link or the page's own
 * setup with a seed), completed by the queue when it saves the file (components/simulator/desktop/useRenderQueue.ts: the
 * file's length, master or TikTok cut), and the Clip editor for a cut it saves. The app's main process runs `sanitizeGenes`
 * on every write and every load (desktop/src/library.ts, social/queue.ts, social/posting.ts, social/audit.ts), so a
 * hand-edited file or a page bug can store nothing but this record.
 *
 * The rules: closed enums, numbers clamped into the record's bounds, strings of 64 characters or fewer from a strict alphabet
 * (ids and copy keys; never free text: a hook is kept as its length), anything unknown becomes null, and the JSON is 4 KB or
 * less. Post hour and weekday are not stored: they come from the post's publish date. Nothing here leaves the PC.
 *
 * The score (C6, lib/insights/score.ts): `planScore`, each checklist item's share of its points and, when the record has them,
 * scoreClip's verdicts (`reasons`: each item's message key under `ViralBot.reasons` with its number values, never its text),
 * so the Library, the Queue and the approval card can say why without the plan. A TikTok cut gets none of it, nor any
 * measured features (`genesOfCut()`): all of them were measured on the clip it was cut from (its length, its payoff, its
 * hook), not on the cut.
 *
 * This file imports types only: the main process bundles it, and must not load the page's modules (the recipe list alone
 * pulls the Fight League roster in). The lists below mirror the playbook's; tests/insightsGenes.test.ts keeps them equal.
 */

// --- insights ---

export const GENES_VERSION = 1;
/** The most a genes record may weigh as JSON. */
export const GENES_MAX_JSON = 4096;
/** The longest id or copy key a record keeps. */
export const GENE_STRING_MAX = 64;

/** Where the clip came from: a bot plan, the app AI's plan, a link, the page's setup with a seed, or the Clip editor. */
export const GENE_SOURCES = ["plan", "ai", "link", "seed", "editor"] as const;
export type GeneSource = (typeof GENE_SOURCES)[number];
/** The bot's series (lib/bot/playbook.ts BOT_FAMILIES). */
export const GENE_FAMILIES = ["escape", "rhythm", "battle"] as const satisfies readonly BotFamily[];
/** The ending (playbook ENDING_STYLES). */
export const GENE_ENDINGS = ["resolved", "cliffhanger"] as const satisfies readonly EndingStyle[];
/** The length bucket (playbook LENGTH_BUCKETS). */
export const GENE_BUCKETS = ["short", "standard", "long"] as const satisfies readonly LengthBucket[];
/** The playbook checklist the score reads (playbook CHECKLIST ids, in its order). */
export const GENE_CHECKLIST = ["motion", "hook", "countdown", "payoff", "length", "sound", "ending", "series", "look"] as const satisfies readonly ChecklistId[];
/** The file as rendered (the master) or the TikTok cut made of it. */
export const GENE_CUTS = ["master", "tiktok"] as const;
export type GeneCut = (typeof GENE_CUTS)[number];
/** TikTok's audience as the approval card chose it (Postiz's privacy_level, lib/desktop/socialCard.ts TIKTOK_PRIVACY). */
export const GENE_PRIVACY = ["public", "friends", "followers", "self"] as const;
export type GenePrivacy = (typeof GENE_PRIVACY)[number];
/** Postiz's TikTok privacy_level values, by the gene they become. */
export const TIKTOK_PRIVACY_GENES: Readonly<Record<string, GenePrivacy>> = {
  PUBLIC_TO_EVERYONE: "public",
  MUTUAL_FOLLOW_FRIENDS: "friends",
  FOLLOWER_OF_CREATOR: "followers",
  SELF_ONLY: "self",
};
/**
 * The bucket of a length (s) when the source names none: up to the short bucket's end (15 s) short, up to 45 s (midway from
 * the standard bucket's 30 s to the long one's 60 s) standard, longer long (playbook BUCKET_SECONDS).
 */
export const GENE_BUCKET_EDGES = { short: 15, standard: 45 } as const;
/** The seconds each bucket is planned for (playbook BUCKET_SECONDS). */
export const GENE_BUCKET_SECONDS = { short: { min: 8, max: 15 }, standard: { min: 15, max: 30 }, long: { min: 60, max: 90 } } as const satisfies Record<LengthBucket, { min: number; max: number }>;
/** How far past a bucket's ends a length still fits it (s): scoreClip's own slack for "inside the bucket". */
export const GENE_BUCKET_SLACK_SEC = 0.5;

/**
 * The measured features of the clip's fast export (C6, lib/recording/clipFeatures.ts): their scalar summary, since the
 * per-sample motion curve would not fit the record's 4 KB. Null until the export measures them.
 */
export const GENE_FEATURE_KEYS = ["sampleHz", "firstMotionSec", "peakMotionPos", "meanLuma", "meanSat", "darkShare", "soundEventsPerSec", "firstSoundSec", "gapEvents", "loopSeamDiff", "lufs"] as const;
export type GeneFeatureKey = (typeof GENE_FEATURE_KEYS)[number];
export type ClipGenesFeatures = { v: 1 } & { [K in GeneFeatureKey]: number | null };

// --- insights --- (C6) the verdicts of the score
/** The message keys of scoreClip's verdicts (lib/bot/planner.ts, `ViralBot.reasons.<key>`). */
export const GENE_REASON_KEYS = ["motionOk", "motionLate", "motionSlow", "motionUnknown", "hookOk", "hookTiming", "hookUnsafe", "hookMissing", "countdownCaption", "countdownHud", "countdownHudCovered", "countdownUnsafe", "countdownMissing", "payoffOk", "payoffTight", "payoffOff", "payoffMissing", "payoffCut", "payoffCutFar", "payoffCutWrong", "payoffNever", "lengthOk", "lengthPlatform", "lengthOut", "soundOk", "soundFlat", "endingLoop", "endingLongTail", "endingQuestion", "endingNoQuestion", "seriesOk", "seriesWeak", "seriesCovered", "lookOk", "lookOff"] as const;
export type GeneReasonKey = (typeof GENE_REASON_KEYS)[number];
/** The number values a verdict's message reads (seconds, a percentage, a bucket's ends). Its words (the hook, the series label) are never kept. */
export const GENE_REASON_NUMBERS = ["sec", "pct", "gap", "tail", "min", "max"] as const;
export type GeneReasonNumber = (typeof GENE_REASON_NUMBERS)[number];
/** The countdowns a verdict names (playbook COUNTDOWN_KINDS). */
export const GENE_COUNTDOWN_KINDS = ["walls", "lives", "layers", "percent", "timer", "hp"] as const satisfies readonly CountdownKind[];
/** One checklist item's verdict: its message key and the values of its message that are numbers or a countdown kind. */
export interface GeneReason {
  key: GeneReasonKey;
  values: { [K in GeneReasonNumber]?: number } & { kind?: CountdownKind };
}
// --- end insights ---

/** The bounds of the record's numbers (a record's, not a slider's: a clip may be any length, a record keeps up to 11 days). */
export const GENE_LIMITS = {
  durationSec: 1_000_000,
  hookChars: 10_000,
  hashtagCount: 1_000,
  episode: 1_000_000,
  planScore: 100,
  feature: 1_000_000,
} as const;

export interface ClipGenes {
  v: 1;
  source: GeneSource | null;
  /** A RECIPES id (lib/bot/playbook.ts), "blueprint:<catalog id>" for a Mode Lab catalog game, or null. */
  recipe: string | null;
  family: BotFamily | null;
  mode: string | null;
  ending: EndingStyle | null;
  /** The plan's bucket, else the bucket of `durationSec` (GENE_BUCKET_EDGES). */
  bucket: LengthBucket | null;
  durationSec: number | null;
  /** A built-in melody id (lib/audio/songs.ts), "ladder" (the mode's own notes) or "none"; null when not known. */
  melody: string | null;
  /** The hook's copy: a bot copy key under `ViralBot` ("recipes.<copyKey>"), "custom" (written by the AI or the user) or null (no hook). */
  hookKey: string | null;
  hookChars: number | null;
  hashtagCount: number | null;
  /** The caption asks the viewer something. */
  captionQuestion: boolean | null;
  cut: GeneCut | null;
  /** The bot series' day. */
  episode: number | null;
  /** The playbook score (lib/bot/planner.ts scoreClip), 0–100. */
  planScore: number | null;
  /** Points over the most per checklist item (0–1). */
  checklist: Partial<Record<ChecklistId, number>> | null;
  /** --- insights --- (C6) scoreClip's verdict per checklist item; absent when the record keeps none (a record written before them). */
  reasons?: Partial<Record<ChecklistId, GeneReason>>;
  features: ClipGenesFeatures | null;
  /** The Blueprint the clip played (lib/blueprint/codec.ts blueprintDigest: 8 hex digits). */
  blueprintDigest: string | null;
  /** The arm or Blueprint the clip was bred from (a recipe, "blueprint:<catalog id>" or a digest). */
  parent: string | null;
  /** Recorded at approval. */
  tiktokPrivacy: GenePrivacy | null;
}

/** The copy a clip goes out with: its hook, caption and hashtags. */
export interface GenesCopy {
  hook: string | null;
  caption: string | null;
  hashtags: readonly string[];
}

const RECIPE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BLUEPRINT_ARM = /^blueprint:[A-Za-z0-9_-]{1,40}$/;
const MODE_ID = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const MELODY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COPY_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+){0,4}$/;
const DIGEST = /^[0-9a-f]{8}$/;

const own = (o: Record<string, unknown>, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined);
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const matching = (v: unknown, ...patterns: RegExp[]): string | null => (typeof v === "string" && v.length > 0 && v.length <= GENE_STRING_MAX && patterns.some((p) => p.test(v)) ? v : null);
/** A finite number inside [lo, hi] (clamped there), rounded to `decimals`; anything else null. */
function bounded(v: unknown, lo: number, hi: number, decimals = 3): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = 10 ** decimals;
  return Math.round(Math.max(lo, Math.min(hi, v)) * f) / f;
}
const count = (v: unknown, hi: number) => bounded(v, 0, hi, 0);
const characters = (text: string) => [...text].length;
const asksSomething = (text: string | null | undefined) => !!text && /[?？¿]/.test(text);

/** The bucket of a clip length (s); null for no length. */
export function bucketOfSeconds(sec: number | null | undefined): LengthBucket | null {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return null;
  return sec <= GENE_BUCKET_EDGES.short ? "short" : sec <= GENE_BUCKET_EDGES.standard ? "standard" : "long";
}

/**
 * The bucket a clip planned for `planned` is in at `sec` seconds: the planned one while the length fits it (GENE_BUCKET_SECONDS,
 * with scoreClip's slack), else the length's own; without a plan, the length's own.
 */
export function bucketKept(planned: LengthBucket | null, sec: number | null | undefined): LengthBucket | null {
  if (!planned || typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return planned ?? bucketOfSeconds(sec);
  const range = GENE_BUCKET_SECONDS[planned];
  return sec >= range.min - GENE_BUCKET_SLACK_SEC && sec <= range.max + GENE_BUCKET_SLACK_SEC ? planned : bucketOfSeconds(sec);
}

// --- insights --- (review fix) a planned clip rendered at the length it was planned at stays in its bucket
/**
 * The bucket of a planned clip at `sec` seconds when it was planned for `planned` at `plannedSec` seconds: the planned one while
 * the clip is that length (within GENE_BUCKET_SLACK_SEC: the clip the plan scored, in its bucket even where the planner's run
 * missed it, lengthOut, as the bot scores it), else `bucketKept()` (the AI's tools changed the length). No planned length:
 * `bucketKept()`.
 */
export function bucketOfPlannedLength(planned: LengthBucket | null, plannedSec: number | null | undefined, sec: number | null | undefined): LengthBucket | null {
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  return planned && finite(plannedSec) && finite(sec) && Math.abs(sec - plannedSec) <= GENE_BUCKET_SLACK_SEC ? planned : bucketKept(planned, sec);
}
// --- end insights ---

/** The gene of a Postiz TikTok privacy_level (null for any other value). */
export function tiktokPrivacyGene(level: unknown): GenePrivacy | null {
  return typeof level === "string" && Object.prototype.hasOwnProperty.call(TIKTOK_PRIVACY_GENES, level) ? TIKTOK_PRIVACY_GENES[level] : null;
}

/** A post's channel is a TikTok one: its platform, or its provider settings' type, says so. */
function isTikTokChannel(c: { platform?: unknown; settings?: unknown } | null | undefined): boolean {
  return c?.platform === "tiktok" || (isPlainObject(c?.settings) && own(c.settings, "__type") === "tiktok");
}

/** The TikTok audience of an approved post: the first TikTok channel's privacy_level (null without a TikTok channel). */
export function tiktokPrivacyOf(channels: readonly { platform?: unknown; settings?: unknown }[]): GenePrivacy | null {
  for (const c of channels) {
    if (!isTikTokChannel(c)) continue;
    const settings = isPlainObject(c?.settings) ? c.settings : null;
    const gene = tiktokPrivacyGene(settings ? own(settings, "privacy_level") : undefined);
    if (gene) return gene;
  }
  return null;
}

function sanitizeChecklist(raw: unknown): ClipGenes["checklist"] {
  if (!isPlainObject(raw)) return null;
  const out: Partial<Record<ChecklistId, number>> = {};
  for (const id of GENE_CHECKLIST) {
    const value = bounded(own(raw, id), 0, 1);
    if (value !== null) out[id] = value;
  }
  return Object.keys(out).length ? out : null;
}

// --- insights --- (C6)
function sanitizeReason(raw: unknown): GeneReason | null {
  if (!isPlainObject(raw)) return null;
  const key = oneOf(GENE_REASON_KEYS, own(raw, "key"));
  const rawValues = own(raw, "values");
  if (!key || !isPlainObject(rawValues)) return null;
  const values: GeneReason["values"] = {};
  for (const name of GENE_REASON_NUMBERS) {
    const value = bounded(own(rawValues, name), -GENE_LIMITS.feature, GENE_LIMITS.feature, 2);
    if (value !== null) values[name] = value;
  }
  const kind = oneOf(GENE_COUNTDOWN_KINDS, own(rawValues, "kind"));
  if (kind) values.kind = kind;
  return { key, values };
}

function sanitizeReasons(raw: unknown): ClipGenes["reasons"] {
  if (!isPlainObject(raw)) return undefined;
  const out: Partial<Record<ChecklistId, GeneReason>> = {};
  for (const id of GENE_CHECKLIST) {
    const reason = sanitizeReason(own(raw, id));
    if (reason) out[id] = reason;
  }
  return Object.keys(out).length ? out : undefined;
}
// --- end insights ---

function sanitizeFeatures(raw: unknown): ClipGenesFeatures | null {
  if (!isPlainObject(raw) || own(raw, "v") !== 1) return null;
  const out = { v: 1 } as ClipGenesFeatures;
  for (const key of GENE_FEATURE_KEYS) out[key] = bounded(own(raw, key), -GENE_LIMITS.feature, GENE_LIMITS.feature, 4);
  return out;
}

/** The features gene of a fast export's measurement (lib/recording/clipFeatures.ts): its scalars, without the motion curve. */
export function featureGenes(features: ClipFeatures | null | undefined): ClipGenesFeatures | null {
  return sanitizeFeatures(features);
}

/**
 * A genes record as the app stores it, or null when `raw` is not one (not an object, or not version 1). Every field is read
 * on its own: a closed enum or a strict id pattern, a number clamped into its bounds; anything else becomes null, unknown
 * keys are dropped, and a record that would still weigh more than 4 KB as JSON loses its features, then its verdicts, then
 * its checklist. The verdicts (`reasons`) are kept only when there are some: a record without them has no such key.
 */
export function sanitizeGenes(raw: unknown): ClipGenes | null {
  if (!isPlainObject(raw) || own(raw, "v") !== GENES_VERSION) return null;
  const durationSec = bounded(own(raw, "durationSec"), 0, GENE_LIMITS.durationSec, 2);
  const genes: ClipGenes = {
    v: 1,
    source: oneOf(GENE_SOURCES, own(raw, "source")),
    recipe: matching(own(raw, "recipe"), RECIPE_ID, BLUEPRINT_ARM),
    family: oneOf(GENE_FAMILIES, own(raw, "family")),
    mode: matching(own(raw, "mode"), MODE_ID),
    ending: oneOf(GENE_ENDINGS, own(raw, "ending")),
    bucket: oneOf(GENE_BUCKETS, own(raw, "bucket")) ?? bucketOfSeconds(durationSec),
    durationSec,
    melody: matching(own(raw, "melody"), MELODY_ID), // (an id, "ladder" or "none": all three spelled alike)
    hookKey: own(raw, "hookKey") === "custom" ? "custom" : matching(own(raw, "hookKey"), COPY_KEY),
    hookChars: count(own(raw, "hookChars"), GENE_LIMITS.hookChars),
    hashtagCount: count(own(raw, "hashtagCount"), GENE_LIMITS.hashtagCount),
    captionQuestion: typeof own(raw, "captionQuestion") === "boolean" ? (own(raw, "captionQuestion") as boolean) : null,
    cut: oneOf(GENE_CUTS, own(raw, "cut")),
    episode: count(own(raw, "episode"), GENE_LIMITS.episode),
    planScore: bounded(own(raw, "planScore"), 0, GENE_LIMITS.planScore, 2),
    checklist: sanitizeChecklist(own(raw, "checklist")),
    features: sanitizeFeatures(own(raw, "features")),
    reasons: sanitizeReasons(own(raw, "reasons")), // --- insights --- (C6)
    blueprintDigest: matching(own(raw, "blueprintDigest"), DIGEST),
    parent: matching(own(raw, "parent"), RECIPE_ID, BLUEPRINT_ARM, DIGEST),
    tiktokPrivacy: oneOf(GENE_PRIVACY, own(raw, "tiktokPrivacy")),
  };
  if (JSON.stringify(genes).length > GENES_MAX_JSON) genes.features = null;
  if (JSON.stringify(genes).length > GENES_MAX_JSON) genes.reasons = undefined; // --- insights --- (C6)
  if (!genes.reasons) delete genes.reasons;
  if (JSON.stringify(genes).length > GENES_MAX_JSON) genes.checklist = null;
  return JSON.stringify(genes).length <= GENES_MAX_JSON ? genes : null;
}

/** A record with every gene unknown but its source. */
function blank(source: GeneSource): ClipGenes {
  return { v: 1, source, recipe: null, family: null, mode: null, ending: null, bucket: null, durationSec: null, melody: null, hookKey: null, hookChars: null, hashtagCount: null, captionQuestion: null, cut: null, episode: null, planScore: null, checklist: null, features: null, blueprintDigest: null, parent: null, tiktokPrivacy: null };
}

/** Builds through the sanitiser, so a builder can never store what a load would not keep. */
const finish = (genes: ClipGenes): ClipGenes => sanitizeGenes(genes) ?? blank(genes.source ?? "seed");

/** Points over the most per checklist item, from scoreClip's reasons. */
export function checklistOf(reasons: readonly ScoreReason[]): ClipGenes["checklist"] {
  const out: Partial<Record<ChecklistId, number>> = {};
  for (const r of reasons) if ((GENE_CHECKLIST as readonly string[]).includes(r.id) && r.max > 0) out[r.id] = r.points / r.max;
  return Object.keys(out).length ? out : null;
}

// --- insights --- (C6)
/** scoreClip's verdicts as the record keeps them: per item its message key and the values that are numbers (a "1.2" read as 1.2) or a countdown kind. */
export function reasonsOf(reasons: readonly ScoreReason[]): ClipGenes["reasons"] {
  const raw: Record<string, unknown> = {};
  for (const r of reasons) {
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(r.values)) values[name] = typeof value === "string" && name !== "kind" && value.trim() !== "" ? Number(value) : value;
    raw[r.id] = { key: r.key, values };
  }
  return sanitizeReasons(raw);
}

/** A record with a score: scoreClip's total, each item's share of its points and its verdicts. */
export function genesWithScore(genes: ClipGenes, scored: { score: number; reasons: readonly ScoreReason[] }): ClipGenes {
  return finish({ ...genes, planScore: scored.score, checklist: checklistOf(scored.reasons), reasons: reasonsOf(scored.reasons) });
}
// --- end insights ---

/** The hook gene of a text: "custom" for words of the clip's own, null for none. */
const hookGenes = (hook: string | null | undefined, key: string | null = "custom") => {
  const text = (hook ?? "").trim();
  return { hookKey: text ? key : null, hookChars: characters(text) };
};

export interface GenesFromPlanOptions {
  /** "plan" for the viral bot's plan, "ai" for a clip the app's AI planned. */
  source?: "plan" | "ai";
  /** The plan's recipe from RECIPES: the caller looks it up (this file loads no recipe). Without it, no hook key or melody kind. */
  recipe?: Pick<BotRecipe, "copyKey" | "musicFirst"> | null;
  /**
   * --- insights --- (review fix) The recipe that plays the clip when the plan's no longer does: an AI clip whose mode
   * set_clip_settings changed, played as the mode's own recipe (lib/insights/score.ts scoreRecipeFor, the one its score
   * reads), or null when none plays the mode. Its id and family are the clip's recipe and family, and whether its mode's own
   * notes are the melody. Absent: the plan's recipe plays the clip. The hook key stays the plan's recipe's (`recipe`): the
   * hook captions are the plan's whatever mode plays under them.
   */
  playedBy?: Pick<BotRecipe, "id" | "family" | "musicFirst"> | null;
  /**
   * The copy the clip goes out with when it is not the plan's own: an AI clip's caption and hashtags, with the hook it draws
   * (lib/insights/score.ts drawnHookOf: the plan's hook captions as the AI's tools left them). The AI's own hook is drawn on
   * its TikTok cut's card alone, so it is the cut's hook gene (`genesOfCut()`), never the master's.
   */
  copy?: GenesCopy;
}

/**
 * The genes of a planned clip: its recipe, family, mode, ending, bucket, planned length, melody, hook, copy, series day and
 * score, with each checklist item's share of its points. `scored` is scoreClip's verdict (the plan's own by default; an AI
 * clip whose settings the AI changed is scored again by the caller). The hook key is the recipe's hook copy
 * ("recipes.<copyKey>", its cliffhanger line on a cliffhanger where the copy has one) while the clip draws the plan's hook;
 * any other hook it draws is "custom".
 */
export function genesFromPlan(plan: ClipPlan, scored: { score: number; reasons: readonly ScoreReason[] } = plan, options: GenesFromPlanOptions = {}): ClipGenes {
  const recipe = options.recipe ?? null;
  const planKey = recipe ? `recipes.${recipe.copyKey}` : null;
  const copy = options.copy;
  const hook = copy ? copy.hook : plan.hook;
  const sameHook = !copy || (copy.hook ?? "").trim() === plan.hook.trim();
  const caption = copy ? copy.caption : [plan.post.caption, plan.post.question].filter(Boolean).join("\n\n");
  // --- insights --- (review fix) the recipe that plays it: the plan's, or the mode's own once the AI changed the mode
  const playedBy = options.playedBy;
  const arm = playedBy === undefined ? { recipe: plan.recipe, family: plan.family } : { recipe: playedBy?.id ?? null, family: playedBy?.family ?? null };
  const notes = playedBy === undefined ? recipe : playedBy; // (whether the mode's own notes are the melody)
  return finish({
    ...blank(options.source ?? "plan"),
    ...arm,
    mode: plan.mode,
    ending: plan.ending,
    bucket: plan.bucket,
    durationSec: plan.timing.clipSec,
    melody: plan.melodyId ?? (notes ? (notes.musicFirst ? "ladder" : "none") : null),
    ...hookGenes(hook, sameHook ? planKey : "custom"),
    hashtagCount: (copy ? copy.hashtags : plan.post.hashtags).length,
    captionQuestion: asksSomething(caption),
    episode: plan.episode,
    planScore: scored.score,
    checklist: checklistOf(scored.reasons),
    reasons: reasonsOf(scored.reasons), // --- insights --- (C6)
  });
}

/** What the genes of a clip made from settings read besides them: its copy, its length and the Blueprint it plays. */
export interface GenesMeta {
  /**
   * The on-screen hook: the hook the clip draws, by the score's rule (lib/insights/score.ts drawnHookOf: its hook caption, else
   * its Top Text where that line is its hook), which the app's callers pass (lib/desktop/queueSources.ts settingsGenes); the
   * settings' Top Text when absent (this file reads no caption roles).
   */
  hook?: string | null;
  caption?: string | null;
  hashtags?: readonly string[];
  /** The clip's length (s); the settings' clip length when absent. */
  durationSec?: number | null;
  /** The melody the clip plays: an id, null for none; absent when the page plays whatever it has loaded (not known). */
  melodyId?: string | null;
  /** Mode Lab: the catalog game played (null for a spec of a link) and the spec's digest, resolved by the page. */
  blueprint?: { catalogId: string | null; digest: string | null } | null;
}

/**
 * The genes of a clip made from settings (a link, the page's setup with a seed): the mode, the length and its bucket, the
 * hook, caption and hashtags it goes out with and, in Mode Lab, the catalog game as its recipe ("blueprint:<id>") and the
 * spec's digest. No plan, so no family, ending, series day or score (an export's measurement adds them later).
 */
export function genesFromSettings(settings: Pick<SimulatorSettings, "mode" | "recordingDuration" | "topText" | "blPreset" | "blSpec">, meta: GenesMeta = {}, source: GeneSource = "seed"): ClipGenes {
  const durationSec = typeof meta.durationSec === "number" && Number.isFinite(meta.durationSec) && meta.durationSec > 0 ? meta.durationSec : settings.recordingDuration;
  const blueprint = settings.mode === "blueprint" ? (meta.blueprint ?? { catalogId: settings.blSpec ? null : settings.blPreset, digest: null }) : null;
  return finish({
    ...blank(source),
    recipe: blueprint?.catalogId ? `blueprint:${blueprint.catalogId}` : null,
    mode: settings.mode,
    durationSec,
    bucket: bucketOfSeconds(durationSec),
    melody: meta.melodyId === undefined ? null : (meta.melodyId ?? "none"),
    ...hookGenes(meta.hook !== undefined ? meta.hook : settings.topText),
    hashtagCount: (meta.hashtags ?? []).length,
    captionQuestion: asksSomething(meta.caption),
    blueprintDigest: blueprint?.digest ?? null,
  });
}

/**
 * The genes of the file the queue saved: its real length and master or cut. A bot plan's bucket is kept (the length it was
 * planned for: the planner fits its run to it); an AI clip's while the file is the length its genes were planned at, or while
 * the file's length fits it (`bucketOfPlannedLength()`: the AI's set_clip_settings and find_simulation may have changed the
 * length since the plan was made, and a 70 s file of a standard plan is a long clip, but a plan the AI left as it was is the
 * bot's clip, in the bot's bucket); any other is the file's own (a link's clip may end before its clip length, a re-rendered
 * cut is the whole clip again).
 * `features` is what the export measured of this file (FastRenderResult.features; null when it measured nothing): it replaces
 * whatever the genes carried (a re-render measures its own file). Absent: the genes' features are kept.
 */
export function genesOfSavedFile(genes: ClipGenes, file: { durationSec: number | null; cut: GeneCut; features?: ClipFeatures | null }): ClipGenes {
  const durationSec = typeof file.durationSec === "number" && Number.isFinite(file.durationSec) && file.durationSec > 0 ? file.durationSec : genes.durationSec;
  const planned = (genes.source === "plan" || genes.source === "ai") && genes.cut !== "tiktok" && genes.bucket !== null;
  const bucket = !planned ? bucketOfSeconds(durationSec) : genes.source === "ai" ? bucketOfPlannedLength(genes.bucket, genes.durationSec, durationSec) /* --- insights --- (review fix) */ : genes.bucket;
  const features = file.features === undefined ? genes.features : featureGenes(file.features); // --- insights --- (C6)
  return finish({ ...genes, durationSec, bucket, cut: file.cut, features });
}

/**
 * The genes of a TikTok cut made of a clip: the clip's, as a cut of its own length (and that length's bucket), with the cut's
 * hook ("custom" when it is not the clip's own hook). No measured features and no score: the clip's were measured on its own
 * frames, not on the cut's (a part of them, under a hook card) – its length, its payoff's place and its hook are not the
 * cut's, so the cut's Library item and approval card show no chip, and the audit line of its post keeps no score.
 */
export function genesOfCut(genes: ClipGenes, cut: { durationSec: number | null; hook: string | null; sameHook: boolean }): ClipGenes {
  const durationSec = typeof cut.durationSec === "number" && Number.isFinite(cut.durationSec) && cut.durationSec > 0 ? cut.durationSec : null;
  const hook = cut.sameHook ? { hookKey: genes.hookKey, hookChars: genes.hookChars } : hookGenes(cut.hook);
  return finish({ ...genes, ...hook, durationSec, bucket: bucketOfSeconds(durationSec), cut: "tiktok", features: null, planScore: null, checklist: null, reasons: undefined });
}

/** The genes of a cut the Clip editor saved of a clip that carries none (an older Library item, a page clip). */
export function editorGenes(clip: { mode: string | null; durationSec: number | null; copy: GenesCopy }): ClipGenes {
  const durationSec = typeof clip.durationSec === "number" && Number.isFinite(clip.durationSec) && clip.durationSec > 0 ? clip.durationSec : null;
  return finish({ ...blank("editor"), mode: clip.mode, durationSec, bucket: bucketOfSeconds(durationSec), ...hookGenes(clip.copy.hook), hashtagCount: clip.copy.hashtags.length, captionQuestion: asksSomething(clip.copy.caption), cut: "tiktok" });
}

/**
 * The genes of a cut the Clip editor saves: a cut of the clip's own genes when the clip it was opened on carries them (a
 * Library item, or the Publish block's clip of one: lib/publish/clips.ts PublishClipLibrary), its hook measured against the
 * hook that clip shows (`clip.hook`: lib/insights/score.ts shownHookOf, the hook a master draws or a cut's card, not an AI
 * clip's own hook, which its master never draws); else the editor's own (`editorGenes`).
 */
export function genesOfEditorCut(clip: { genes?: ClipGenes | null; hook?: string | null } | null | undefined, cut: { mode: string | null; durationSec: number | null; copy: GenesCopy }): ClipGenes {
  if (!clip?.genes) return editorGenes(cut);
  const hook = cut.copy.hook ?? "";
  return genesOfCut(clip.genes, { durationSec: cut.durationSec, hook, sameHook: hook.trim() === (clip.hook ?? "").trim() });
}

// --- insights --- (review fix) the copy a post went out with: the card's text, not the clip's copy at render time
/**
 * The hashtags of a post's text, counted as the approval card counts them (lib/desktop/socialCard.ts hashtagCount: a "#" at
 * the start or after a space, then anything but a space or another "#"; this file loads no page module, so
 * tests/insightsGenes.test.ts keeps the two equal).
 */
export function hashtagsIn(text: string): number {
  return (text.match(/(^|\s)#[^\s#]+/g) ?? []).length;
}

/**
 * The text an approved post went out with, which its copy genes describe: its first TikTok channel's (the channel whose
 * audience the record keeps), else its first channel's; null when no channel has a text. The autopilot writes each channel's
 * text (and its hashtags) itself and the card may change it again, so the clip's own caption is not what was posted.
 */
export function approvedTextOf(channels: readonly { platform?: unknown; settings?: unknown; text?: unknown }[]): string | null {
  const texts = channels.filter((c) => typeof c?.text === "string");
  const chosen = texts.find(isTikTokChannel) ?? texts[0];
  return chosen ? (chosen.text as string) : null;
}

/**
 * The genes an approved post keeps in the audit: the clip's, with the TikTok audience the card chose (null without TikTok)
 * and the copy genes of the text it went out with (`approvedTextOf()`: its hashtag count and whether it asks something, no
 * words); a request with no text keeps the clip's.
 */
export function genesAtApproval(raw: unknown, channels: readonly { platform?: unknown; settings?: unknown; text?: unknown }[]): ClipGenes | null {
  const genes = sanitizeGenes(raw);
  if (!genes) return null;
  const text = approvedTextOf(channels);
  const copy = text === null ? {} : { hashtagCount: hashtagsIn(text), captionQuestion: asksSomething(text) };
  return finish({ ...genes, ...copy, tiktokPrivacy: tiktokPrivacyOf(channels) });
}

// --- end insights ---
