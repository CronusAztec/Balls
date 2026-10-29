import { isBotFamily, isBotPlatform, isEndingChoice, isLengthBucket, type BotFamily, type BotPlatform, type EndingChoice, type LengthBucket } from "./playbook";
import { BOT_PLAN_VERSION, type ClipPlan, type PlanOptions } from "./planner";
import { CLIP_CEILING } from "@/lib/uncap"; // --- uncap-all ---
import { isBotLook, readyTemplates, templateById, TEMPLATE_LOOK, type BotLookId, type TemplateInfo } from "./templates"; // --- bot-templates ---

/*
 * --- viral-bot --- The Bot section's options and its last plan, kept in this browser's localStorage (a convenience: every
 * read and write is wrapped, the panel works without storage). Plans carry their whole settings, so a stored plan opens,
 * re-rolls and renders exactly as it was planned.
 */

export const BOT_STORAGE_KEY = "jumpingballslive_viral_bot";
export const BOT_COUNT_RANGE = { min: 1, max: 20, step: 1 } as const;

export interface BotOptions {
  platform: BotPlatform;
  count: number;
  family: BotFamily | "all";
  bucket: LengthBucket | "auto";
  ending: EndingChoice;
  /**
   * --- bot-templates --- The Template choice: a ready template's id (templates.ts) that "Plan clips" plans instead of the
   * rotation; absent: Auto, the rotation as before.
   */
  template?: string;
  /**
   * --- bot-templates --- The Simple switch: "simple" draws the clips in the Simple look; "bot" (beside a chosen template only) its
   * clips in today's bot look; absent – --- bot-templates --- (studio2 review round 1, 21) – the look of what the panel plans: a
   * chosen template's own, the Simple look its clarity gates were measured in (TEMPLATE_LOOK), and Auto's today's bot look (panelLook).
   */
  look?: BotLookId;
}

export interface BotStoredPlan {
  /** The day it was planned for ("YYYY-MM-DD"). */
  date: string;
  platform: BotPlatform;
  /** "today": the canonical daily plan; "custom": planned with the panel's filters. */
  kind: "today" | "custom";
  clips: ClipPlan[];
}

export interface BotState {
  options: BotOptions;
  plan: BotStoredPlan | null;
}

export function defaultBotOptions(): BotOptions {
  return { platform: "reels", count: 3, family: "all", bucket: "auto", ending: "auto" };
}

/**
 * --- bot-templates --- A stored Template choice that still plans: a ready template's id, else undefined (Auto) – an unknown id,
 * or one a later release hid, falls back to the rotation.
 */
export function storedTemplate(value: unknown): string | undefined {
  return typeof value === "string" && templateById(value)?.ready ? value : undefined;
}

/**
 * --- bot-templates --- The templates the Template choice lists for the panel's series: the ready ones of that series – "all"
 * (the panel's All series) every one, the battle family's too, which the bot offers there today; a series its own.
 */
export function templateChoices(family: BotOptions["family"]): TemplateInfo[] {
  return readyTemplates(family);
}

/** --- bot-templates --- The template "Plan clips" plans: the choice while it is one its series lists, else undefined (Auto). */
export function chosenTemplate(options: Pick<BotOptions, "template" | "family">): string | undefined {
  const id = storedTemplate(options.template);
  return id && templateChoices(options.family).some((t) => t.id === id) ? id : undefined;
}

/**
 * --- bot-templates --- (studio2 review round 1, 21) The look the panel plans in, for both of its buttons, and the one the Simple
 * switch shows: the switch's choice, else a chosen template's own – the Simple look (TEMPLATE_LOOK): in the bot look its plans
 * fail the clarity gates it was made ready on (the Journey's 9 and Spiral Glass's 24 of 100 there) – and Auto's today's bot look,
 * as the owner asked for the rotation.
 */
export function panelLook(options: Pick<BotOptions, "template" | "family" | "look">): BotLookId {
  return options.look ?? (chosenTemplate(options) ? TEMPLATE_LOOK : "bot");
}

/** --- bot-templates --- (studio2 review round 1, 21) What the Simple switch stores when pressed: "simple", or off – "bot" beside a template, else nothing (Auto's own). */
export function lookSwitched(options: Pick<BotOptions, "template" | "family" | "look">): Pick<BotOptions, "look"> {
  return { look: panelLook(options) === "simple" ? (chosenTemplate(options) ? "bot" : undefined) : "simple" };
}

/** --- bot-templates --- (studio2 review round 1, 21) What a new Template choice stores: the template, and no "bot" look beside Auto (its own already). */
export function templateSwitched(options: Pick<BotOptions, "look">, template: string | undefined): Pick<BotOptions, "template" | "look"> {
  return { template, look: !template && options.look === "bot" ? undefined : options.look };
}

/**
 * --- bot-templates --- (studio2 review round 1, 21) What the panel asks the planner for (useViralBot.ts): "Plan clips" a chosen
 * template, both buttons the panel's look – nothing for the rotation in today's bot look, so its plans stay byte for byte as before.
 */
export function panelPlanChoice(options: Pick<BotOptions, "template" | "family" | "look">, custom: boolean): Pick<PlanOptions, "look" | "template"> {
  const template = custom ? chosenTemplate(options) : undefined;
  const look = panelLook(options);
  return template ? { template, look } : look === "simple" ? { look } : {};
}

/** Stored options, validated: unknown values fall back to the defaults, the count is clamped. */
export function parseBotOptions(raw: unknown): BotOptions {
  const d = defaultBotOptions();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const count = Math.round(Number(r.count));
  return {
    platform: isBotPlatform(r.platform) ? r.platform : d.platform,
    count: Number.isFinite(count) ? (count < BOT_COUNT_RANGE.min ? BOT_COUNT_RANGE.min : count > CLIP_CEILING ? CLIP_CEILING : count) : d.count, // --- uncap-all --- (the slider's 20 is a comfort bound; the clips' memory-safety ceiling)
    family: r.family === "all" || isBotFamily(r.family) ? r.family : d.family,
    bucket: r.bucket === "auto" || isLengthBucket(r.bucket) ? r.bucket : d.bucket,
    ending: isEndingChoice(r.ending) ? r.ending : d.ending,
    // --- bot-templates --- kept only when they differ from the defaults (Auto, the bot look): an older state reads as before
    ...(storedTemplate(r.template) ? { template: storedTemplate(r.template) } : {}),
    // (--- bot-templates --- studio2 review round 1, 21: the bot look stored only beside a template, whose own look is the Simple one)
    ...(isBotLook(r.look) && (r.look !== "bot" || storedTemplate(r.template)) ? { look: r.look } : {}),
  };
}

const looksLikePlan = (value: unknown): value is ClipPlan => {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ClipPlan>;
  return p.version === BOT_PLAN_VERSION && typeof p.id === "string" && typeof p.recipe === "string" && typeof p.seed === "number" && !!p.settings && typeof p.settings === "object" && Array.isArray(p.captionRoles);
};

/** A stored state, validated (plans of another version are dropped). */
export function parseBotState(raw: unknown): BotState {
  const state: BotState = { options: defaultBotOptions(), plan: null };
  if (!raw || typeof raw !== "object") return state;
  const r = raw as Record<string, unknown>;
  state.options = parseBotOptions(r.options);
  const plan = r.plan as Partial<BotStoredPlan> | null | undefined;
  if (plan && typeof plan === "object" && typeof plan.date === "string" && isBotPlatform(plan.platform) && Array.isArray(plan.clips)) {
    const clips = plan.clips.filter(looksLikePlan);
    if (clips.length > 0) state.plan = { date: plan.date, platform: plan.platform, kind: plan.kind === "today" ? "today" : "custom", clips };
  }
  return state;
}

export function loadBotState(): BotState {
  if (typeof window === "undefined") return parseBotState(null);
  try {
    const raw = localStorage.getItem(BOT_STORAGE_KEY);
    return parseBotState(raw ? JSON.parse(raw) : null);
  } catch {
    return parseBotState(null);
  }
}

export function saveBotState(state: BotState): void {
  try {
    localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage disabled or full: the plan lives until the page is closed */
  }
}
