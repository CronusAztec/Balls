import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { MODE_IDS } from "@/lib/physics/types";
import { BOT_FAMILIES, BOT_PLATFORMS, ENDING_CHOICES, LENGTH_BUCKETS, RECIPES, type BotFamily, type BotPlatform, type EndingChoice, type LengthBucket } from "@/lib/bot/playbook";
import type { ClipPlan } from "@/lib/bot/planner";
import { copyString, type BotCopy } from "@/lib/bot/copy";
import type { AgentTask, AgentTool } from "./agent";
import type { JsonSchema } from "./jsonSchema";
import { CATALOG, changesSchema, patchFromChanges, settingsCatalog, validateSettingsPatch, type SettingChange } from "./settingsPatch";

/*
 * --- desktop-exe --- The four jobs of the AI studio, as agent tasks (prompts, tools, answer schemas and checks):
 *
 *  - MAKE VIDEOS – the model plans clips with the viral bot's planner and the seed finder as tools (`plan_clips`,
 *    `find_simulation`, `set_clip_settings`), then answers with the clips to render, each with a name, title, hook, caption
 *    and hashtags for its platform; the page queues them in the render queue.
 *  - COPY – titles, hooks, captions and hashtag sets for the Publish block, written or rewritten per platform.
 *  - SETTINGS – "make the ball twice as fast and rainbow, no gravity" → a settings patch, checked by `validateSettingsPatch()`.
 *  - IDEAS – clip ideas grounded in the virality playbook (the chunks `selectPlaybookContext()` picked).
 *
 * The planner and the finder run in the page (they need its world and messages); `StudioPorts` hands them in, so the tools
 * are tested with stand-ins. The plans a run makes live in a `PlanStore` for the run; the final answer may only name those.
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

/** What the model sees of a plan. */
export function planSummary(plan: ClipPlan) {
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
    score: plan.score,
    suggestedCaption: plan.post.caption.slice(0, 300),
    suggestedHashtags: plan.post.hashtags,
  };
}

const RECIPE_IDS = RECIPES.map((r) => r.id);
/** The value types of the common settings a tool may change on a planned clip. */
const defaultSettingsForTools = defaultSettings("classic");
const HASHTAG: JsonSchema = { type: "string", pattern: "^#[^\\s#]{1,60}$" };

/** The recipes for the prompt: id (family): name – hook. */
export function recipeList(copy: BotCopy): string {
  return RECIPES.map((r) => {
    const name = copyString(copy, `recipes.${r.copyKey}.name`) || r.id;
    const hook = copyString(copy, `recipes.${r.copyKey}.hook`);
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
}

export interface MakeVideosResult {
  clips: MadeClip[];
  summary: string;
}

export const MAKE_VIDEOS_FINAL: JsonSchema = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          planId: { type: "string", minLength: 1 },
          name: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$" },
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

export function makeVideosTools(store: PlanStore, ports: StudioPorts): AgentTool[] {
  const planClips: AgentTool = {
    name: "plan_clips",
    description: "Plans clips with the viral bot (settings, a physics seed whose payoff lands at the right moment, hook, caption). Returns the plans with their planId.",
    args: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1, maximum: 10 },
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
        store.update(plan.id, { seed: answer.seed, settings: { ...plan.settings, recordingDuration }, timing: { ...plan.timing, clipSec: answer.durationSec || targetSec, found: true } });
      }
      return { planId: plan.id, found: answer.found, seed: answer.found ? answer.seed : plan.seed, durationSec: answer.durationSec, endless: answer.endless ?? false };
    },
  };
  const setClipSettings: AgentTool = {
    name: "set_clip_settings",
    description: "Changes settings of a planned clip (e.g. recordingDuration, colours, gravity) as a list of {setting, value}. Checked; invalid values are refused.",
    args: {
      type: "object",
      properties: { planId: { type: "string" }, changes: changesSchema(defaultSettingsForTools, CATALOG) },
      required: ["planId", "changes"],
      additionalProperties: false,
    },
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

export function makeVideosTask(request: string, options: { copy: BotCopy; locale: string; platform: BotPlatform; store: PlanStore; ports: StudioPorts }): AgentTask<MakeVideosResult> {
  const system = [
    "You are the video producer inside JumpingBallsLive, a satisfying ball-physics simulator that renders vertical clips for TikTok, Instagram Reels and YouTube Shorts.",
    "You plan clips with the tools, then answer with the clips to render. Never invent a planId: use the ids plan_clips returned.",
    "Workflow: 1) call plan_clips (count = how many clips the user wants, default 3; platform = the one the user names, else " + options.platform + "; recipe or family when the user names a kind of clip). 2) If the user asks for an exact length or outcome, call find_simulation for each clip. 3) Answer with every clip: a short file name, a title, a hook (the on-screen one-liner), a caption with a specific question and 5–10 hashtags for its platform.",
    `Write titles, hooks and captions in ${languageName(options.locale)}.`,
    "Recipes (id (family, modes): name – hook):",
    recipeList(options.copy),
  ].join("\n");
  return {
    system,
    user: request,
    tools: makeVideosTools(options.store, options.ports),
    final: MAKE_VIDEOS_FINAL,
    checkFinal: (result) => {
      const errors: string[] = [];
      for (const clip of result.clips) if (!options.store.has(clip.planId)) errors.push(`unknown planId "${clip.planId}" – plan the clip first`);
      return errors;
    },
    maxSteps: 12,
    temperature: 0.4,
    maxTokens: 1500,
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
    final: COPY_FINAL,
    checkFinal: (result) => {
      const wanted = new Set(options.platforms);
      return result.items.filter((i) => !wanted.has(i.platform)).map((i) => `platform "${i.platform}" was not asked for (${options.platforms.join(", ")})`);
    },
    maxSteps: 4,
    temperature: 0.8,
    maxTokens: 1200,
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
  const system = [
    // --- review fix (uncap-all) --- a number's slider range is a comfort range, not a limit: every value from its minimum up is valid
    "You change the settings of JumpingBallsLive, a ball-physics simulator. Answer with the changes: one {\"setting\", \"value\"} per setting to change, only those (numbers within their bounds: \"from N, no upper limit\" takes any value from N up – the slider range shown with it is only the comfortable part – and a plain range is a hard one; relative requests like 'twice as fast' are computed from the current value and never capped at a slider).",
    `Write the summary in ${languageName(locale)}.`,
    "Settings (name (type) = current value — meaning):",
    settingsCatalog(current),
  ].join("\n");
  return {
    system,
    user: request,
    tools: [],
    // The changes may only name the settings listed in the prompt (the grammar enforces it for the local model).
    final: { ...SETTINGS_FINAL, properties: { ...SETTINGS_FINAL.properties, changes: changesSchema(current) } },
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

export function ideasTask(request: string, options: { copy: BotCopy; locale: string; playbook: string }): AgentTask<IdeasResult> {
  const system = [
    "You pitch clip ideas for JumpingBallsLive, a ball-physics simulator, grounded in the research below. Every idea names the recipe it builds on (or custom), the simulator mode, the ending (resolved for shares and re-watches, cliffhanger for comments) and why it should work, citing the research.",
    `Write in ${languageName(options.locale)}.`,
    "Recipes:",
    recipeList(options.copy),
    "Research (virality playbook):",
    options.playbook,
  ].join("\n");
  return { system, user: request || "Give me fresh ideas for this week.", tools: [], final: IDEAS_FINAL, maxSteps: 4, temperature: 0.9, maxTokens: 1500 };
}
