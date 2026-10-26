import type { ClipPlan, ScoreReason } from "@/lib/bot/planner";
import type { BotFamily, BotRecipe, ChecklistId, EndingStyle, LengthBucket } from "@/lib/bot/playbook";
import type { SimulatorSettings } from "@/lib/settings";

/*
 * --- insights --- Clip genes (ClipGenes v1): what a clip was made from, as a small closed record that travels with the clip
 * from the render queue to the Library (`LibraryMeta.genes`), the posting queue (`SocialQueueItem.genes`) and the audit line
 * of every post the app created (`SocialAuditEntry.genes`, with the TikTok privacy chosen at approval). That last copy is the
 * attribution ledger: a Postiz post id keeps its genes after the Library file or the queue item is gone, so what made each
 * post can still be read when its numbers come in.
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

/**
 * The measured features of the clip's fast export (C6, lib/recording/clipFeatures.ts): their scalar summary, since the
 * per-sample motion curve would not fit the record's 4 KB. Null until the export measures them.
 */
export const GENE_FEATURE_KEYS = ["sampleHz", "firstMotionSec", "peakMotionPos", "meanLuma", "meanSat", "darkShare", "soundEventsPerSec", "firstSoundSec", "gapEvents", "loopSeamDiff", "lufs"] as const;
export type GeneFeatureKey = (typeof GENE_FEATURE_KEYS)[number];
export type ClipGenesFeatures = { v: 1 } & { [K in GeneFeatureKey]: number | null };

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

/** The gene of a Postiz TikTok privacy_level (null for any other value). */
export function tiktokPrivacyGene(level: unknown): GenePrivacy | null {
  return typeof level === "string" && Object.prototype.hasOwnProperty.call(TIKTOK_PRIVACY_GENES, level) ? TIKTOK_PRIVACY_GENES[level] : null;
}

/** The TikTok audience of an approved post: the first TikTok channel's privacy_level (null without a TikTok channel). */
export function tiktokPrivacyOf(channels: readonly { platform?: unknown; settings?: unknown }[]): GenePrivacy | null {
  for (const c of channels) {
    const settings = isPlainObject(c?.settings) ? c.settings : null;
    if (c?.platform !== "tiktok" && own(settings ?? {}, "__type") !== "tiktok") continue;
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

function sanitizeFeatures(raw: unknown): ClipGenesFeatures | null {
  if (!isPlainObject(raw) || own(raw, "v") !== 1) return null;
  const out = { v: 1 } as ClipGenesFeatures;
  for (const key of GENE_FEATURE_KEYS) out[key] = bounded(own(raw, key), -GENE_LIMITS.feature, GENE_LIMITS.feature, 4);
  return out;
}

/**
 * A genes record as the app stores it, or null when `raw` is not one (not an object, or not version 1). Every field is read
 * on its own: a closed enum or a strict id pattern, a number clamped into its bounds; anything else becomes null, unknown
 * keys are dropped, and a record that would still weigh more than 4 KB as JSON loses its features, then its checklist.
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
    blueprintDigest: matching(own(raw, "blueprintDigest"), DIGEST),
    parent: matching(own(raw, "parent"), RECIPE_ID, BLUEPRINT_ARM, DIGEST),
    tiktokPrivacy: oneOf(GENE_PRIVACY, own(raw, "tiktokPrivacy")),
  };
  if (JSON.stringify(genes).length > GENES_MAX_JSON) genes.features = null;
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
  /** The copy the clip goes out with when it is not the plan's own (an AI clip's hook, caption and hashtags). */
  copy?: GenesCopy;
}

/**
 * The genes of a planned clip: its recipe, family, mode, ending, bucket, planned length, melody, hook, copy, series day and
 * score, with each checklist item's share of its points. `scored` is scoreClip's verdict (the plan's own by default; an AI
 * clip whose settings the AI changed is scored again by the caller). The hook key is the recipe's hook copy
 * ("recipes.<copyKey>", its cliffhanger line on a cliffhanger where the copy has one): an AI clip that wrote its own hook
 * gets "custom".
 */
export function genesFromPlan(plan: ClipPlan, scored: { score: number; reasons: readonly ScoreReason[] } = plan, options: GenesFromPlanOptions = {}): ClipGenes {
  const recipe = options.recipe ?? null;
  const planKey = recipe ? `recipes.${recipe.copyKey}` : null;
  const copy = options.copy;
  const hook = copy ? copy.hook : plan.hook;
  const sameHook = !copy || (copy.hook ?? "").trim() === plan.hook.trim();
  const caption = copy ? copy.caption : [plan.post.caption, plan.post.question].filter(Boolean).join("\n\n");
  return finish({
    ...blank(options.source ?? "plan"),
    recipe: plan.recipe,
    family: plan.family,
    mode: plan.mode,
    ending: plan.ending,
    bucket: plan.bucket,
    durationSec: plan.timing.clipSec,
    melody: plan.melodyId ?? (recipe ? (recipe.musicFirst ? "ladder" : "none") : null),
    ...hookGenes(hook, sameHook ? planKey : "custom"),
    hashtagCount: (copy ? copy.hashtags : plan.post.hashtags).length,
    captionQuestion: asksSomething(caption),
    episode: plan.episode,
    planScore: scored.score,
    checklist: checklistOf(scored.reasons),
  });
}

/** What the genes of a clip made from settings read besides them: its copy, its length and the Blueprint it plays. */
export interface GenesMeta {
  /** The on-screen hook (the settings' Top Text when absent). */
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
 * The genes of the file the queue saved: its real length and master or cut. A plan's bucket is kept (the length it was planned
 * for); any other is the file's own (a link's clip may end before its clip length, a re-rendered cut is the whole clip again).
 */
export function genesOfSavedFile(genes: ClipGenes, file: { durationSec: number | null; cut: GeneCut }): ClipGenes {
  const durationSec = typeof file.durationSec === "number" && Number.isFinite(file.durationSec) && file.durationSec > 0 ? file.durationSec : genes.durationSec;
  const planned = (genes.source === "plan" || genes.source === "ai") && genes.cut !== "tiktok" && genes.bucket !== null;
  return finish({ ...genes, durationSec, bucket: planned ? genes.bucket : bucketOfSeconds(durationSec), cut: file.cut });
}

/**
 * The genes of a TikTok cut made of a clip: the clip's, as a cut of its own length (and that length's bucket), with the cut's
 * hook ("custom" when it is not the clip's own hook).
 */
export function genesOfCut(genes: ClipGenes, cut: { durationSec: number | null; hook: string | null; sameHook: boolean }): ClipGenes {
  const durationSec = typeof cut.durationSec === "number" && Number.isFinite(cut.durationSec) && cut.durationSec > 0 ? cut.durationSec : null;
  const hook = cut.sameHook ? { hookKey: genes.hookKey, hookChars: genes.hookChars } : hookGenes(cut.hook);
  return finish({ ...genes, ...hook, durationSec, bucket: bucketOfSeconds(durationSec), cut: "tiktok" });
}

/** The genes of a cut the Clip editor saved of a clip that carries none (an older Library item, a page clip). */
export function editorGenes(clip: { mode: string | null; durationSec: number | null; copy: GenesCopy }): ClipGenes {
  const durationSec = typeof clip.durationSec === "number" && Number.isFinite(clip.durationSec) && clip.durationSec > 0 ? clip.durationSec : null;
  return finish({ ...blank("editor"), mode: clip.mode, durationSec, bucket: bucketOfSeconds(durationSec), ...hookGenes(clip.copy.hook), hashtagCount: clip.copy.hashtags.length, captionQuestion: asksSomething(clip.copy.caption), cut: "tiktok" });
}

/** The genes an approved post keeps in the audit: the clip's, with the TikTok audience the card chose (null without TikTok). */
export function genesAtApproval(raw: unknown, channels: readonly { platform?: unknown; settings?: unknown }[]): ClipGenes | null {
  const genes = sanitizeGenes(raw);
  return genes ? finish({ ...genes, tiktokPrivacy: tiktokPrivacyOf(channels) }) : null;
}

// --- end insights ---
