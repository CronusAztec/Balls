import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { MODE_IDS } from "@/lib/physics/types";
import { BOT_FAMILIES, BOT_PLATFORMS, ENDING_CHOICES, LENGTH_BUCKETS, RECIPES, type BotFamily, type BotPlatform, type EndingChoice, type LengthBucket } from "@/lib/bot/playbook";
import type { ClipPlan } from "@/lib/bot/planner";
import { copyString, type BotCopy } from "@/lib/bot/copy";
import type { AgentTask, AgentTool, AgentTurn } from "./agent";
import type { JsonSchema } from "./jsonSchema";
import { CLIP_SETTINGS, changesSchema, describeSetting, patchFromChanges, validateSettingsPatch, type SettingChange } from "./settingsPatch";
// --- desktop-ai-fix --- reply normalisers, placeholder-free recipe hooks and the settings that matter for a request
import { CLIP_NAME_MAX, HASHTAG_MAX_CHARS, clipCutOf, clipCutSpec, fitText, normaliseCopyResult, normaliseMakeVideosResult, withoutPlaceholders, type ClipCut, type PlanFacts } from "./normalise";
import { relevantAssistantSettings } from "./settingsFilter";
// --- ai-cut --- the cut of a clip: its beats, the sound default the model starts from, its answer snapped and checked (lib/clipEdit/propose.ts)
import { CLIP_EDIT_TEXT_MAX, DEFAULT_CLIP_EDIT, type ClipEditSpec } from "@/lib/clipEdit/spec";
import { CARD_STEPS, ZOOM_STEPS, beatsOfPlan, cutProblems, describeBeats, snapClipEdit, suggestClipEdit, type ClipBeats } from "@/lib/clipEdit/propose";

export { clipCutSpec, type ClipCut } from "./normalise"; // --- ai-cut --- (the page builds a clip's full spec from a made clip's cut with it)

/*
 * --- desktop-exe --- The four jobs of the AI studio, as agent tasks (prompts, tools, answer schemas and checks):
 *
 *  - MAKE VIDEOS – the model plans clips with the viral bot's planner and the seed finder as tools (`plan_clips`,
 *    `find_simulation`, `set_clip_settings`), then answers with the clips to render, each with a name, title, hook, caption
 *    and hashtags for its platform; the page queues them in the render queue.
 *  - COPY – titles, hooks, captions and hashtag sets for the Publish block, written or rewritten per platform.
 *  - SETTINGS – "make the ball twice as fast and rainbow, no gravity" → a settings patch, checked by `validateSettingsPatch()`.
 *  - IDEAS – clip ideas grounded in the virality playbook (the chunks `selectPlaybookContext()` picked).
 * --- trends --- Make videos and ideas also read what is trending (`trendingContext()`: src/content/trends.json, the summary
 * of other creators' trending simulation videos), so the local and the cloud models propose clips shaped like them.
 *
 * The planner and the finder run in the page (they need its world and messages); `StudioPorts` hands them in, so the tools
 * are tested with stand-ins. The plans a run makes live in a `PlanStore` for the run; the final answer may only name those.
 *
 * --- desktop-ai-fix --- Small local models got these jobs wrong in 1.0.2 (see agent.ts); now every string the grammar can
 * bound is bounded (a hashtag ≤ 61 characters, a clip name ≤ 60, the copy's platforms the requested ones, one item each),
 * Make videos offers its answer only once plan_clips has made plans and then only with their ids, each job normalises its
 * answer before the checks (normalise.ts), the recipe hooks reach the prompt without "{placeholders}", the settings
 * assistant sees the settings that matter for the request (settingsFilter.ts) and set_clip_settings describes its
 * arguments in a line instead of a 2,000-token schema.
 *
 * --- ai-cut --- The AI also cuts clips for TikTok (the Clip editor's spec, lib/clipEdit/spec.ts), without seeing a frame:
 * `clipEditTask` ("cut") proposes a cut for one finished clip from its beats – first impact, payoff, cliffhanger gap, loop –
 * shown with the rule-made default of lib/clipEdit/propose.ts to adjust; and Make videos, when the run asks for cuts,
 * answers a `cut` per clip in the same shape (`CLIP_CUT`, required in the clip's schema, so the grammar makes a local model
 * write it). The model answers five fields; the address is never its (`ClipCut`, `clipCutSpec`). What it answers is snapped
 * before the checks (snapClipEdit: floors, the steps, a 60-character hook, the file's length), so a slip costs no retry; only
 * a cut that misses a known payoff is sent back. No new tool, no new IPC channel.
 */

export interface PlanClipsRequest {
  count: number;
  platform: BotPlatform;
  family: BotFamily | "all";
  bucket: LengthBucket | "auto";
  ending: EndingChoice;
  recipe: string;
}

export interface FindRequest {
  targetSec: number;
  outcome: "duration" | "never-escapes" | "escapes-at";
  atSec: number | null;
}

export interface FindAnswer {
  found: boolean;
  seed: number;
  durationSec: number;
  endless?: boolean;
  /** --- ai-cut --- The found run's first escape (s) when the finder measured one: the new seed's payoff. */
  payoffSec?: number | null;
}

export interface StudioPorts {
  /** Plans clips with the viral bot's planner (in slices, cancellable). */
  planClips(request: PlanClipsRequest, signal: AbortSignal | undefined, progress: (text: string) => void): Promise<ClipPlan[]>;
  /** Searches a seed for these settings with the seed finder. */
  findSimulation(settings: SimulatorSettings, request: FindRequest, signal: AbortSignal | undefined, progress: (text: string) => void): Promise<FindAnswer>;
}

/** The plans of one run, by id. */
export class PlanStore {
  private readonly plans = new Map<string, ClipPlan>();
  add(plan: ClipPlan): void {
    this.plans.set(plan.id, plan);
  }
  get(id: string): ClipPlan | undefined {
    return this.plans.get(id);
  }
  has(id: string): boolean {
    return this.plans.has(id);
  }
  update(id: string, patch: Partial<ClipPlan>): ClipPlan | undefined {
    const plan = this.plans.get(id);
    if (!plan) return undefined;
    const next = { ...plan, ...patch };
    this.plans.set(id, next);
    return next;
  }
  all(): ClipPlan[] {
    return [...this.plans.values()];
  }
}

/** What the model sees of a plan (--- ai-cut --- with its beats and the cut the rules suggest, to start from). */
export function planSummary(plan: ClipPlan) {
  const beats = beatsOfPlan(plan);
  return {
    planId: plan.id,
    recipe: plan.recipe,
    family: plan.family,
    mode: plan.mode,
    platform: plan.platform,
    seed: plan.seed,
    lengthSec: Math.round(plan.timing.clipSec * 10) / 10,
    recordingDuration: plan.settings.recordingDuration,
    ending: plan.ending,
    hook: plan.hook,
    payoffAtSec: plan.payoff.atSec,
    // --- ai-cut ---
    firstImpactSec: beats.firstImpactSec,
    cutGapSec: beats.cutGapSec,
    loop: beats.seamlessLoop,
    suggestedCut: clipCutOf(suggestClipEdit(beats, DEFAULT_CLIP_EDIT)),
    score: plan.score,
    suggestedCaption: plan.post.caption.slice(0, 160), // --- ai-cut --- (was 300; a summary is ~800 characters with its beats and cut, so plan_clips has its own result budget, PLAN_CLIPS_RESULT_CHARS)
    suggestedHashtags: plan.post.hashtags,
  };
}

const RECIPE_IDS = RECIPES.map((r) => r.id);
/** The value types of the common settings a tool may change on a planned clip. */
const defaultSettingsForTools = defaultSettings("classic");
// --- desktop-ai-fix --- bounded, so a grammar-held model cannot run one hashtag on until the token limit (1.0.2 did)
const HASHTAG: JsonSchema = { type: "string", minLength: 2, maxLength: HASHTAG_MAX_CHARS + 1, pattern: "^#[^\\s#]{1,60}$" };
/** --- desktop-ai-fix --- What a short "default" hashtag set falls back to (the copy task's niche keywords). */
export const DEFAULT_HASHTAGS: readonly string[] = ["#physics", "#satisfying", "#bouncingball"];
/**
 * --- ai-cut --- A cut as the model answers it (lib/clipEdit/propose.ts `ClipBeats` → `snapClipEdit`). The app's grammar
 * keeps the types, the enums, the hook's length and the five required keys and drops `minimum` (desktop/src/ai/gbnf.ts), so a
 * local model can still write lengthSec 999 or startSec -2: `snapClipEdit` runs as the task's normaliser before the checks.
 */
export const CLIP_CUT: JsonSchema = {
  type: "object",
  properties: {
    startSec: { type: "number", minimum: 0 },
    lengthSec: { type: "number", minimum: 3 },
    zoom: { enum: ZOOM_STEPS },
    hook: { type: "string", maxLength: CLIP_EDIT_TEXT_MAX },
    cardSec: { enum: CARD_STEPS },
  },
  required: ["startSec", "lengthSec", "zoom", "hook", "cardSec"],
  additionalProperties: false,
};

/** The recipes for the prompt: id (family): name – hook. */
export function recipeList(copy: BotCopy): string {
  return RECIPES.map((r) => {
    const name = copyString(copy, `recipes.${r.copyKey}.name`) || r.id;
    const hook = withoutPlaceholders(copyString(copy, `recipes.${r.copyKey}.hook`)); // --- desktop-ai-fix --- (no "{seconds}" for a model to copy)
    return `- ${r.id} (${r.family}, ${r.modes.join("/")}): ${name}${hook ? ` – "${hook}"` : ""}`;
  }).join("\n");
}

const LANGUAGES: Record<string, string> = { en: "English", pl: "Polish", es: "Spanish" };
export const languageName = (locale: string) => LANGUAGES[locale] ?? "English";

/* ------------------------------------------------------------------ make videos */

export interface MadeClip {
  planId: string;
  name: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  platform: BotPlatform;
  /** --- ai-cut --- The clip's TikTok cut, when the run asked for cuts (`clipCutSpec` makes the editor's spec of it). */
  cut?: ClipCut;
}

export interface MakeVideosResult {
  clips: MadeClip[];
  summary: string;
}

/** --- ai-cut --- The most clips one Make videos run plans and answers with (plan_clips' count, the answer's clips). */
export const MAKE_VIDEOS_MAX_CLIPS = 10;
/**
 * --- ai-cut --- The answer's token budget, for the most clips it may hold: a reply cut off at the limit is unclosed JSON, and
 * every retry has the same budget. Ten clips that keep the planned 160-character caption and 8 hashtags are ~1,500 tokens on
 * Qwen2.5 and ~1,570 by the runner's estimate (desktop/src/ai/local.ts, 3.2 characters a token), so 1,800 (it was 1,500, right
 * at the edge). A cut adds ~45 tokens a clip on a tokenizer that splits digits (four numbers and a hook of up to
 * CLIP_EDIT_TEXT_MAX characters), more with the grammar's newlines and indents: 70 a clip.
 */
export const MAKE_VIDEOS_MAX_TOKENS = 1800;
export const MAKE_VIDEOS_CUT_TOKENS_PER_CLIP = 70;
export const makeVideosMaxTokens = (cut: boolean) => MAKE_VIDEOS_MAX_TOKENS + (cut ? MAKE_VIDEOS_CUT_TOKENS_PER_CLIP * MAKE_VIDEOS_MAX_CLIPS : 0);

export const MAKE_VIDEOS_FINAL: JsonSchema = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      minItems: 1,
      maxItems: MAKE_VIDEOS_MAX_CLIPS,
      items: {
        type: "object",
        properties: {
          planId: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1, maxLength: CLIP_NAME_MAX, pattern: "^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$" }, // --- desktop-ai-fix --- (maxLength: the grammar can hold it)
          title: { type: "string", minLength: 1, maxLength: 100 },
          hook: { type: "string", minLength: 1, maxLength: 120 },
          caption: { type: "string", minLength: 1, maxLength: 2200 },
          hashtags: { type: "array", minItems: 3, maxItems: 15, items: HASHTAG },
          platform: { enum: BOT_PLATFORMS },
        },
        required: ["planId", "name", "title", "hook", "caption", "hashtags", "platform"],
        additionalProperties: false,
      },
    },
    summary: { type: "string", maxLength: 600 },
  },
  required: ["clips", "summary"],
  additionalProperties: false,
};

/**
 * --- desktop-ai-fix --- The answer once plans exist: a clip's planId is one of the run's plans (an enum, which the local
 * model's grammar enforces), its platform one of theirs. --- ai-cut --- With `cut` on, each clip's `cut` (CLIP_CUT) is
 * required too – the grammar makes the local model write it, no optional-field ambiguity; off, the property does not exist.
 */
export function makeVideosFinal(planIds: readonly string[], platforms: readonly BotPlatform[], cut = false): JsonSchema {
  const base = cut ? withClipCut(MAKE_VIDEOS_FINAL) : MAKE_VIDEOS_FINAL;
  const clips = (base.properties as Record<string, JsonSchema>).clips;
  const item = clips.items as JsonSchema;
  const properties = { ...item.properties, planId: { enum: [...planIds] }, platform: { enum: [...new Set(platforms)] } };
  return {
    ...base,
    properties: {
      ...base.properties,
      clips: { ...clips, items: { ...item, properties } },
    },
  };
}

/**
 * --- ai-cut --- The Make videos answer with each clip's `cut` (CLIP_CUT) required. Both the prompt's schema and the turn's
 * grammar are built from it: a cloud model sees only the prompt, so the schema it reads must ask for the cut too.
 */
export function withClipCut(schema: JsonSchema): JsonSchema {
  const clips = (schema.properties as Record<string, JsonSchema>).clips;
  const item = clips.items as JsonSchema;
  return { ...schema, properties: { ...schema.properties, clips: { ...clips, items: { ...item, properties: { ...item.properties, cut: CLIP_CUT }, required: [...(item.required ?? []), "cut"] } } } };
}

/** --- desktop-ai-fix --- A tool whose planId must be one of `planIds` (the grammar then cannot name another). */
function withPlanIds(tool: AgentTool, planIds: readonly string[]): AgentTool {
  const props = tool.args.properties ?? {};
  return { ...tool, args: { ...tool.args, properties: { ...props, planId: { enum: [...planIds] } } } };
}

/** --- desktop-ai-fix --- What the normaliser needs of the run's plans (their order is plan_clips' order). */
export function planFacts(store: PlanStore): PlanFacts[] {
  return store.all().map((p) => ({ id: p.id, platform: p.platform, hashtags: p.post.hashtags, vars: { seconds: Math.round(p.timing.clipSec), episode: p.episode }, beats: beatsOfPlan(p) /* --- ai-cut --- */ }));
}

/**
 * --- desktop-ai-fix --- Make videos' envelope for this turn: tool calls only until plan_clips has returned plans (1.0.2's
 * small models answered on turn 1 with planIds "1", "2", "3"), then the tools with planId enums and the answer.
 */
export function makeVideosTurn(store: PlanStore, tools: readonly AgentTool[], cut = false /* --- ai-cut --- */): AgentTurn {
  const ids = store.all().map((p) => p.id);
  if (ids.length === 0) return { tools, final: null, hint: "Call plan_clips first: the answer may only name planIds that plan_clips returns." };
  return {
    tools: tools.map((t) => (t.name === "plan_clips" ? t : withPlanIds(t, ids))),
    final: makeVideosFinal(ids, store.all().map((p) => p.platform), cut),
    hint: `planId must be one of: ${ids.join(", ")}.`,
  };
}

/** --- ai-cut --- plan_clips' result in the conversation: ten summaries of ~800 characters (beats and the suggested cut included) fit whole; the local context grows for it (desktop/src/ai/local.ts contextSizeFor). */
export const PLAN_CLIPS_RESULT_CHARS = 10_000;

export function makeVideosTools(store: PlanStore, ports: StudioPorts): AgentTool[] {
  const planClips: AgentTool = {
    name: "plan_clips",
    description: "Plans clips with the clip planner (settings, a physics seed whose payoff lands at the right moment, hook, caption). Returns the plans with their planId.",
    args: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1, maximum: MAKE_VIDEOS_MAX_CLIPS },
        platform: { enum: BOT_PLATFORMS },
        family: { enum: [...BOT_FAMILIES, "all"] },
        bucket: { enum: [...LENGTH_BUCKETS, "auto"] },
        ending: { enum: ENDING_CHOICES },
        recipe: { enum: ["", ...RECIPE_IDS] },
      },
      required: ["count", "platform"],
      additionalProperties: false,
    },
    run: async (args, ctx) => {
      const request: PlanClipsRequest = {
        count: args.count as number,
        platform: args.platform as BotPlatform,
        family: (args.family as BotFamily | "all" | undefined) ?? "all",
        bucket: (args.bucket as LengthBucket | "auto" | undefined) ?? "auto",
        ending: (args.ending as EndingChoice | undefined) ?? "auto",
        recipe: (args.recipe as string | undefined) ?? "",
      };
      const plans = await ports.planClips(request, ctx.signal, ctx.progress);
      for (const plan of plans) store.add(plan);
      return { clips: plans.map(planSummary) };
    },
    maxResultChars: PLAN_CLIPS_RESULT_CHARS, // --- ai-cut ---
  };
  const findSimulation: AgentTool = {
    name: "find_simulation",
    description: "Searches a new physics seed for a planned clip so the run lasts targetSec (duration), never escapes within it (never-escapes) or first escapes at atSec (escapes-at). Updates the plan's seed and length.",
    args: {
      type: "object",
      properties: {
        planId: { type: "string" },
        targetSec: { type: "number", minimum: 8, maximum: 120 },
        outcome: { enum: ["duration", "never-escapes", "escapes-at"] },
        atSec: { type: "number", minimum: 1, maximum: 120 },
      },
      required: ["planId", "targetSec", "outcome"],
      additionalProperties: false,
    },
    check: (args) => {
      const errors: string[] = [];
      if (!store.has(args.planId as string)) errors.push(`unknown planId "${String(args.planId)}" – use an id plan_clips returned`);
      if (args.outcome === "escapes-at" && typeof args.atSec !== "number") errors.push("escapes-at needs atSec");
      if (args.outcome === "escapes-at" && typeof args.atSec === "number" && typeof args.targetSec === "number" && args.atSec > args.targetSec) errors.push("atSec must not be after targetSec");
      return errors;
    },
    run: async (args, ctx) => {
      const plan = store.get(args.planId as string) as ClipPlan;
      const targetSec = Math.round(args.targetSec as number);
      const request: FindRequest = { targetSec, outcome: args.outcome as FindRequest["outcome"], atSec: args.outcome === "escapes-at" && typeof args.atSec === "number" ? args.atSec : null };
      const answer = await ports.findSimulation({ ...plan.settings, recordingDuration: Math.max(10, Math.min(120, targetSec)) }, request, ctx.signal, ctx.progress);
      if (answer.found) {
        const recordingDuration = Math.max(10, Math.min(120, Math.ceil(Math.max(targetSec, answer.durationSec || 0))));
        // --- ai-cut --- the new seed's beats: its escape second when the finder measured one (else the one asked for; none
        // for a run searched by length or for never escaping), no cut before the result, an unmeasured first impact – so a
        // cut is suggested and checked against this run, not the plan's old seed
        const payoffSec = answer.payoffSec ?? (request.outcome === "escapes-at" ? request.atSec : null);
        store.update(plan.id, { seed: answer.seed, settings: { ...plan.settings, recordingDuration }, timing: { ...plan.timing, clipSec: answer.durationSec || targetSec, found: true, firstImpactSec: null }, payoff: { ...plan.payoff, atSec: payoffSec, cutGapSec: null } });
      }
      const updated = store.get(plan.id) as ClipPlan;
      return { planId: plan.id, found: answer.found, seed: answer.found ? answer.seed : plan.seed, durationSec: answer.durationSec, endless: answer.endless ?? false, suggestedCut: clipCutOf(suggestClipEdit(beatsOfPlan(updated), DEFAULT_CLIP_EDIT)) /* --- ai-cut --- */ };
    },
  };
  const setClipSettings: AgentTool = {
    name: "set_clip_settings",
    description: "Changes settings of a planned clip (e.g. recordingDuration, colours, gravity) as a list of {setting, value}. Checked; invalid values are refused.",
    args: {
      type: "object",
      properties: { planId: { type: "string" }, changes: changesSchema(defaultSettingsForTools, CLIP_SETTINGS) }, // --- trends --- (the catalog and the trending look's levers)
      required: ["planId", "changes"],
      additionalProperties: false,
    },
    // --- desktop-ai-fix --- one line in the prompt instead of the changes' JSON schema (~2,000 tokens); the grammar keeps the schema
    argsHint: `{"planId": "<a planId plan_clips returned>", "changes": [{"setting": "<name>", "value": <value>}]} – settings: ${CLIP_SETTINGS.map(([key]) => key).join(", ")}`,
    check: (args) => {
      const plan = store.get(args.planId as string);
      if (!plan) return [`unknown planId "${String(args.planId)}"`];
      const checked = validateSettingsPatch(plan.settings, patchFromChanges(args.changes as SettingChange[]));
      return checked.ok ? [] : checked.errors;
    },
    run: async (args) => {
      const plan = store.get(args.planId as string) as ClipPlan;
      const checked = validateSettingsPatch(plan.settings, patchFromChanges(args.changes as SettingChange[]));
      if (!checked.ok) throw new Error(checked.errors.join("; "));
      const settings = { ...plan.settings, ...checked.patch };
      store.update(plan.id, { settings, mode: settings.mode });
      return { planId: plan.id, applied: checked.patch };
    },
  };
  return [planClips, findSimulation, setClipSettings];
}

/** --- ai-cut --- The rules of a cut, for the prompts (the standalone task's and Make videos' with cuts on). */
const CUT_RULES = `startSec where the action starts (a breath before the first motion), lengthSec 8–15 s that end about a second after the payoff (a cliffhanger ends where the source ends), zoom the crop-in, hook of at most ${CLIP_EDIT_TEXT_MAX} characters asking what the viewer waits to see, cardSec the end card's seconds (0 for a cliffhanger)`;

export function makeVideosTask(request: string, options: { copy: BotCopy; locale: string; platform: BotPlatform; store: PlanStore; ports: StudioPorts; cut?: boolean /* --- ai-cut --- */; trending?: string /* --- trends --- */ }): AgentTask<MakeVideosResult> {
  const cut = options.cut === true;
  const system = [
    "You are the video producer inside JumpingBallsLive, a satisfying ball-physics simulator that renders vertical clips for TikTok, Instagram Reels and YouTube Shorts.",
    "You plan clips with the tools, then answer with the clips to render. Never invent a planId: use the ids plan_clips returned.",
    "Workflow: 1) call plan_clips (count = how many clips the user wants, default 3; platform = the one the user names, else " + options.platform + "; recipe or family when the user names a kind of clip). 2) If the user asks for an exact length or outcome, call find_simulation for each clip. 3) Answer with every clip: a short file name, a title, a hook (the on-screen one-liner), a caption with a specific question and 5–10 hashtags for its platform.",
    // --- ai-cut --- the cut per clip, from the plan's suggestedCut
    cut ? `Every clip also gets its TikTok cut (cut): ${CUT_RULES}. Start from the plan's suggestedCut and change it only with a reason.` : "",
    `Write titles, hooks and captions in ${languageName(options.locale)}.`,
    "Recipes (id (family, modes): name – hook):",
    recipeList(options.copy),
    // --- trends --- what other creators' trending simulation videos do: pick recipes, lengths and titles toward it
    options.trending ? "When the user names no recipe, length or look, lean toward what is trending:" : "",
    options.trending ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  const tools = makeVideosTools(options.store, options.ports);
  return {
    system,
    user: request,
    tools,
    final: cut ? withClipCut(MAKE_VIDEOS_FINAL) : MAKE_VIDEOS_FINAL, // --- ai-cut --- (the prompt's schema, which is all a cloud model sees)
    checkFinal: (result) => {
      const errors: string[] = [];
      for (const clip of result.clips) {
        const plan = options.store.get(clip.planId);
        if (!plan) errors.push(`unknown planId "${clip.planId}" – plan the clip first`);
        // --- ai-cut --- a cut that misses the plan's payoff goes back (everything else was snapped)
        else if (cut && clip.cut) errors.push(...cutProblems(clipCutSpec(clip.cut), beatsOfPlan(plan)).map((problem) => `${clip.planId}: ${problem}`));
      }
      return errors;
    },
    maxSteps: 12,
    temperature: 0.4,
    maxTokens: makeVideosMaxTokens(cut), // --- ai-cut --- (ten clips with their cuts: the local context grows with it, desktop/src/ai/local.ts contextSizeFor)
    // --- desktop-ai-fix ---
    name: "videos",
    turn: () => makeVideosTurn(options.store, tools, cut),
    normaliseFinal: (result) => normaliseMakeVideosResult(result, planFacts(options.store)),
  };
}

/* ------------------------------------------------------------------ --- ai-cut --- the cut of one finished clip */

/** The cut task's answer: the five fields of a cut (`clipCutSpec` makes the editor's spec of them) and a line about it. */
export interface ClipCutResult extends ClipCut {
  summary: string;
}

export const CLIP_CUT_FINAL: JsonSchema = {
  ...CLIP_CUT,
  properties: { ...CLIP_CUT.properties, summary: { type: "string", maxLength: 200 } },
  required: [...(CLIP_CUT.required ?? []), "summary"],
};

/**
 * The standalone task ("Suggest with AI" in the Clip editor): a cut for one finished clip from its beats, the rule-made
 * default shown to adjust, the hook examples the dialog offers. `base` is the user's remembered spec (its crop-in, card
 * and address are the defaults; the address is never the model's). Normalised with snapClipEdit before the checks; only a
 * cut that misses a known payoff is sent back. ~250 prompt tokens: the answer's shape goes in a line (finalHint).
 */
export function clipEditTask(request: string, options: { locale: string; beats: ClipBeats; base: ClipEditSpec; ideas: readonly string[] }): AgentTask<ClipCutResult> {
  const suggested = clipCutOf(suggestClipEdit(options.beats, options.base));
  const system = [
    `You cut a finished JumpingBallsLive ball-physics clip for TikTok: ${CUT_RULES}.`,
    `The clip: ${describeBeats(options.beats)}.`,
    `A sound default: ${JSON.stringify(suggested)}. Change it only with a reason.`,
    `${options.ideas.length ? `Hook examples: ${options.ideas.map((i) => `"${i}"`).join(", ")}. ` : ""}Write the hook and the summary in ${languageName(options.locale)}.`,
  ].join("\n");
  return {
    system,
    user: request || "Propose the cut.",
    tools: [],
    final: CLIP_CUT_FINAL,
    finalHint: `{"startSec":<seconds>,"lengthSec":<seconds>,"zoom":<${ZOOM_STEPS.join("|")}>,"hook":"<at most ${CLIP_EDIT_TEXT_MAX} characters>","cardSec":<${CARD_STEPS.join("|")}>,"summary":"<one short sentence>"}`,
    normaliseFinal: (result) => {
      const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
      const summary = typeof r.summary === "string" ? fitText(r.summary, 200) : "";
      return { ...clipCutOf(snapClipEdit(r, options.beats, options.base)), summary };
    },
    checkFinal: (result) => cutProblems(clipCutSpec(result, options.base), options.beats),
    name: "cut",
    maxSteps: 3,
    temperature: 0.5,
    maxTokens: 400, // the envelope's note (up to 400 characters, which the local grammar does not make optional), the hook and the summary
  };
}

/* ------------------------------------------------------------------ copy for the Publish block */

export interface CopyItem {
  platform: BotPlatform;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
}

export interface CopyResult {
  items: CopyItem[];
}

export const COPY_FINAL: JsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          platform: { enum: BOT_PLATFORMS },
          title: { type: "string", minLength: 1, maxLength: 100 },
          hook: { type: "string", minLength: 1, maxLength: 120 },
          caption: { type: "string", minLength: 1, maxLength: 2200 },
          hashtags: { type: "array", minItems: 3, maxItems: 15, items: HASHTAG },
        },
        required: ["platform", "title", "hook", "caption", "hashtags"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/**
 * --- desktop-ai-fix --- The copy's answer for these platforms: each item's platform one of them and exactly one item per
 * platform (what the local model's grammar is held to; the normaliser maps a repeated or unrequested platform onto a missing
 * one before the checks).
 */
export function copyFinal(platforms: readonly BotPlatform[]): JsonSchema {
  const wanted = platforms.length ? [...new Set(platforms)] : [...BOT_PLATFORMS];
  const items = (COPY_FINAL.properties as Record<string, JsonSchema>).items;
  const item = items.items as JsonSchema;
  return {
    ...COPY_FINAL,
    properties: { ...COPY_FINAL.properties, items: { ...items, minItems: wanted.length, maxItems: wanted.length, items: { ...item, properties: { ...item.properties, platform: { enum: wanted } } } } },
  };
}

/** A short description of the clip on the page for the copywriter. */
export function describeClip(s: SimulatorSettings): string {
  const parts = [`mode ${s.mode}`, `${s.recordingDuration} s`, `${s.wallCount} rings`, `ball speed ${s.ballSpeed}`, s.rainbowBall ? "rainbow ball" : `ball ${s.ballColor}`, s.themeId ? `theme ${s.themeId}` : "", s.gravity === 0 ? "no gravity" : "", s.topText ? `top text "${s.topText}"` : "", s.bottomText ? `bottom text "${s.bottomText}"` : ""];
  return parts.filter(Boolean).join(", ");
}

export function copyTask(request: string, options: { locale: string; platforms: readonly BotPlatform[]; settings: SimulatorSettings; existing: string }): AgentTask<CopyResult> {
  const system = [
    "You write short-form video copy for JumpingBallsLive ball-physics clips: a title, the hook (an on-screen one-liner the viewer understands in one second), a caption that ends with a specific question, and 5–10 niche hashtags with natural keywords (bouncing ball, physics simulation, satisfying).",
    `Platforms: ${options.platforms.join(", ")} – one item per platform, adapted to it (TikTok: punchy; Reels: keywords in the caption; Shorts: a searchable title).`,
    `Write in ${languageName(options.locale)}. The clip: ${describeClip(options.settings)}.`,
    options.existing ? `Rewrite / improve this existing copy: ${options.existing.slice(0, 1500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    system,
    user: request || "Write the copy.",
    tools: [],
    final: copyFinal(options.platforms), // --- desktop-ai-fix --- (was COPY_FINAL: any platform, any number of items)
    checkFinal: (result) => {
      const wanted = new Set(options.platforms);
      return result.items.filter((i) => !wanted.has(i.platform)).map((i) => `platform "${i.platform}" was not asked for (${options.platforms.join(", ")})`);
    },
    maxSteps: 4,
    temperature: 0.8,
    maxTokens: 1200,
    // --- desktop-ai-fix ---
    name: "copy",
    normaliseFinal: (result) => normaliseCopyResult(result, options.platforms, DEFAULT_HASHTAGS),
  };
}

/* ------------------------------------------------------------------ settings assistant */

export interface SettingsResult {
  changes: SettingChange[];
  summary: string;
}

export const SETTINGS_FINAL: JsonSchema = {
  type: "object",
  properties: { changes: { type: "array", minItems: 1 }, summary: { type: "string", maxLength: 300 } },
  required: ["changes", "summary"],
  additionalProperties: false,
};

export function settingsTask(request: string, current: SimulatorSettings, locale: string): AgentTask<SettingsResult> {
  // --- desktop-ai-fix --- only the settings that matter for this request (the core ones and those it points at): the
  // prompt was ~3,800 tokens with every setting, 40 s of reading on a CPU before the first word
  const relevant = relevantAssistantSettings(current, request);
  const system = [
    // --- review fix (uncap-all) --- a number's slider range is a comfort range, not a limit: every value from its minimum up is valid
    "You change the settings of JumpingBallsLive, a ball-physics simulator. Answer with the changes: one {\"setting\", \"value\"} per setting to change, only those (numbers within their bounds: \"from N, no upper limit\" takes any value from N up – the slider range shown with it is only the comfortable part – and a plain range is a hard one; relative requests like 'twice as fast' are computed from the current value and never capped at a slider).",
    `Write the summary in ${languageName(locale)}.`,
    "Settings (name (type) = current value — meaning):",
    relevant.map(([key, d]) => describeSetting(key, current, d)).join("\n"),
  ].join("\n");
  return {
    system,
    user: request,
    tools: [],
    name: "settings", // --- desktop-ai-fix ---
    // --- desktop-ai-fix --- the answer's shape in a line: its JSON schema repeats the whole list above (~900 tokens)
    finalHint: '{"changes":[{"setting":"<a setting from the list>","value":<its new value>}, …one entry per setting to change],"summary":"<one short sentence>"}',
    // The changes may only name the settings listed in the prompt (the grammar enforces it for the local model).
    final: { ...SETTINGS_FINAL, properties: { ...SETTINGS_FINAL.properties, changes: changesSchema(current, relevant) } },
    checkFinal: (result) => {
      const checked = validateSettingsPatch(current, patchFromChanges(result.changes));
      return checked.ok ? [] : checked.errors;
    },
    maxSteps: 5,
    temperature: 0.2,
    maxTokens: 600,
  };
}

/* ------------------------------------------------------------------ idea generator */

export interface Idea {
  title: string;
  hook: string;
  recipe: string;
  mode: string;
  ending: "resolved" | "cliffhanger";
  why: string;
}

export interface IdeasResult {
  ideas: Idea[];
}

export const IDEAS_FINAL: JsonSchema = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 100 },
          hook: { type: "string", minLength: 1, maxLength: 120 },
          recipe: { enum: [...RECIPE_IDS, "custom"] },
          mode: { enum: MODE_IDS },
          ending: { enum: ["resolved", "cliffhanger"] },
          why: { type: "string", minLength: 1, maxLength: 400 },
        },
        required: ["title", "hook", "recipe", "mode", "ending", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
};

/** --- trends --- The idea generator's research budget (characters): the playbook excerpt and what is trending together. */
export const IDEAS_RESEARCH_CHARS = 4500;

export function ideasTask(request: string, options: { copy: BotCopy; locale: string; playbook: string; trending?: string /* --- trends --- */ }): AgentTask<IdeasResult> {
  const system = [
    "You pitch clip ideas for JumpingBallsLive, a ball-physics simulator, grounded in the research below. Every idea names the recipe it builds on (or custom), the simulator mode, the ending (resolved for shares and re-watches, cliffhanger for comments) and why it should work, citing the research.",
    `Write in ${languageName(options.locale)}.`,
    "Recipes:",
    recipeList(options.copy),
    "Research (virality playbook):",
    options.playbook,
    options.trending ?? "", // --- trends ---
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user: request || "Give me fresh ideas for this week.", tools: [], final: IDEAS_FINAL, maxSteps: 4, temperature: 0.9, maxTokens: 1500, name: "ideas" /* --- desktop-ai-fix --- */ };
}
