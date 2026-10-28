import { extractJson, validateJson, type JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { BOT_DEFAULT_FAMILIES, ENDING_STYLES, LENGTH_BUCKETS, PLATFORMS, RECIPES, type BotFamily, type BotPlatform } from "@/lib/bot/playbook";
import { captionWordsOf } from "@/lib/bot/planner"; // --- templates --- (a message read as a viewer reads it)
import { claimOfRecipe, type CrewClip } from "./clip";
import { clarityOf, failedGates, type Clarity } from "./clarity";
import { intentView, screenView, type OtherCandidate } from "./dossier";
import { confirmedDistractions, makesSenseOf, markObjection, markObjections, standing, type MarkedObjection } from "./evidence";
import { applyCompiledFix, clutterOn, compileFixes, type CompiledFix, type FinderNeed } from "./fixes";
import { pick, pickScore, type PickCandidate, type PickEntry, type Picked } from "./pick";
import { briefText, BRIEF_CHARS, researchBriefOf, researchGapOf, type ResearchDigest } from "./research";
import { sanitizeReview, type ClipReview, type ClipReviewRole, type ReviewFixState, type ReviewIssue, type ReviewNotReviewed } from "./review";
import { drawnHookText, type SimpleOptions } from "./simplicity";
import {
  brainstormFinal,
  checkBrainstorm,
  checkProducer,
  checkReview,
  checkSkeptic,
  checkViewer,
  CREW_ROLES,
  effortOf,
  normaliseBrainstorm,
  normaliseProducer,
  normaliseResearch,
  normaliseReview,
  producerFinal,
  promptHash,
  protocolOf,
  researchFinal,
  reviewFinal,
  ROLE_SPECS,
  SHARED_RUBRIC,
  SKEPTIC_FINAL,
  taskOf,
  VIEWER_FINAL,
  VIEWER_PREAMBLE,
  type BrainstormIdea,
  type BrainstormResult,
  type Confidence,
  type CrewRole,
  type Distraction,
  type FixAction,
  type MakesSense,
  type MenuItem,
  type PanelDepth,
  type PanelStage,
  type ProducedClip,
  type ProducerResult,
  type ResearchResult,
  type ReviewResult,
  type ReviewShape,
  type SkepticResult,
  type ViewerResult,
} from "./roles";

/*
 * --- crew --- The panel: one pure state machine that runs the crew on a batch of clips, the same for the app's Make videos and
 * after-save look, and for the toolbox's review tool. It never calls a model itself: `nextStep()` says what is needed next – a
 * role's call (with its brief: the prompt, the schema, the limits), the planner's plans for the ideas, or the seed search for a
 * fix – and the caller answers with `applyVerdict()`, `applyCandidates()` or `applyReplan()`. `runPanel()` is that loop with the
 * model (and the planner) as functions the caller passes, so any model plays the roles: the app's local or cloud one, or Claude.
 *
 * Before a render (stage "pre"), in this order:
 *  0. research: the brief by code (research.ts), or the researcher's pass where live research exists;
 *  1. ideas: an open request goes to the brainstormer, any other is expanded by code (the menu in order, formats mixed);
 *  2. plan (the caller): each idea becomes a candidate clip;
 *  3. measure (code): the clarity check; a failed G5 or G6 gets one rule fix (simplifyLook, oneTextAtATime), any other failure
 *     drops the candidate before a model is asked, and the rest are ranked by their rules-only pick score;
 *  4. per candidate in that order, its calls back to back (a model's cache keeps the shared prefix): the viewer (Thorough only;
 *     the screen view), the skeptic, the evidence check (code), the reviewer – at Quick only where something is in doubt (a
 *     confirmed objection, a major opinion, Playbook or Simple below 80) – and one fix round (code: fixes.ts; a fix that makes a
 *     gate fail, lowers the pick score or leaves a confirmed major objection it answers confirmed on the fixed clip is
 *     reverted, and no model is asked again);
 *  5. the stop rule: no new candidate once N are kept with medium confidence or more (a model's: a keep the rules alone
 *     weighed never counts), or 5 were reviewed, or the budget is spent – the rest are "not reviewed" (the picker takes them
 *     only to fill the N, never as seen);
 *  6. pick (code: pick.ts), then the producer's words for the kept clips (or the template's own, "copy from the template").
 * After a render (stage "post"), per saved clip: the rules again on what the render measured, the viewer's look, makesSense
 * by code, and the reviewer only when the rules, the read or the facts disagree (always at Thorough). A fix is offered there
 * ("Make the fixed version"), never applied. A clip the AI had no time to look at is "not reviewed".
 *
 * The rules are never overruled: a failed gate cannot be kept (checkReview refuses the reply, the picker never picks it), a
 * refuted objection is dropped before the reviewer sees it, a confirmed one must be accepted with a fix or the clip dropped.
 * A role whose replies stay invalid (more than maxRetries in a row), or that the budget no longer covers, falls back to the
 * rules for that step, labelled so ("rules only"). When no model answered any of a clip's roles that way – a broken skeptic
 * before a render, a broken or out-of-budget viewer after one – a keep by the rules is "not reviewed" ("broken", "budget"),
 * like a clip the budget never reached: never passed off as seen (a drop by the rules stands: a clip that fails a gate is
 * dropped whether or not a model reached it, after a render as before one). Every call and every retry
 * counts against the caps; the time and the cost are the caller's to report (the panel has no clock). A cancel ends the run at
 * the next step and queues nothing. A run may leave roles out (`off`: the role eval measures each role against the rules
 * alone, eval.ts): an off role is never asked – the skeptic and the viewer are skipped, the reviewer's place, the producer's,
 * the researcher's and the brainstormer's are the rules', each labelled "off".
 *
 * Roles exchange validated JSON only: the reviewer reads the skeptic's objections and the viewer's read as data (never their
 * notes), the skeptic never sees an idea's angle or the producer's words, and the viewer reads the screen view alone.
 * Pure and deterministic for the same verdicts: no clock, no randomness, no engine.
 */

// --- crew ---

export interface PanelCaps {
  /** Model calls in the run, retries included. */
  maxCalls: number;
  /** Candidates a model reviews before a render. */
  maxCandidates: number;
  /** The time the caller may spend on model calls (ms), null: no cap. */
  maxMs: number | null;
  /** The cost the caller may spend (US dollars, its own estimate), null: no cap. */
  maxUsd: number | null;
  /** Invalid replies in a row a role gets before the rules answer for it (runAgent's maxRetries). */
  maxRetries: number;
}

/** The defaults: 5 candidates reviewed, a 15-minute batch, $1.50 a batch, 3 retries. */
export const PANEL_DEFAULTS = { candidates: 5, ms: 15 * 60_000, usd: 1.5, retries: 3 } as const;

/**
 * The call cap of a run (retries count against it): before a render a research and a brainstorm pass when they run, two calls
 * for each of the 5 candidates a run reviews at most (three at Thorough) and the producer – 13 at Quick for an open request, as
 * the plan counts it, however many candidates there are; after a render two calls a clip.
 */
export function defaultCalls(stage: PanelStage, depth: PanelDepth, clips: number, options: { research?: boolean; brainstorm?: boolean } = {}): number {
  if (depth === "rules") return 0;
  if (stage === "post") return 2 * Math.max(0, clips);
  return (options.research ? 1 : 0) + (options.brainstorm ? 1 : 0) + PANEL_DEFAULTS.candidates * (depth === "thorough" ? 3 : 2) + 1;
}

/** The words the plan wrote for a clip (the producer's fallback: "copy from the template"). */
export interface TemplateCopy {
  name: string;
  title: string;
  caption: string;
  hashtags: string[];
}

export interface PanelCandidate {
  id: string;
  clip: CrewClip;
  post?: TemplateCopy | null;
  /** Its place in plan order (default: its place in the list). */
  order?: number;
  /** The idea it was planned from (its index in the run's ideas): never shown to a clip's roles. */
  idea?: number | null;
  /** Its Simple options (the HUDs its template keeps). */
  simple?: SimpleOptions;
}

export interface PanelRequest {
  text: string;
  /** No template, mode or recipe named: the brainstormer pitches. */
  open: boolean;
  /** The request named one template (the picker's diversity rule and the two-formats rule are off). */
  namedTemplate?: boolean;
  platform: BotPlatform;
  locale: string;
}

/** Who answered a role: a model, the rules, or nobody (not needed); null: not yet. */
export type RoleSource = "model" | "rules" | "skipped";
export interface RoleRun<T> {
  source: RoleSource | null;
  result: T | null;
  /** Why the rules or nobody answered: "depth", "quick", "budget", "broken", "notLive", "notOpen", "cancelled". */
  why: string | null;
  attempts: number;
  /** The prompt's hash (roles.ts promptHash) of the call that answered. */
  hash: string | null;
}

export interface ClipFix {
  actions: FixAction[];
  state: ReviewFixState;
  why: string | null;
  compiled: CompiledFix | null;
}

export interface PanelClip {
  id: string;
  order: number;
  idea: number | null;
  /** The clip as it stands (the fixed one after an applied fix). */
  clip: CrewClip;
  /** The clip as it came, before its rule fix or its fix round (null: unchanged). */
  original: CrewClip | null;
  post: TemplateCopy | null;
  simple: SimpleOptions;
  clarity: Clarity;
  /** The rule fix the measure step applied (a failed G5 or G6). */
  ruleFix: ("simplifyLook" | "oneTextAtATime")[];
  /** The intent view's text, fixed when its review starts (the skeptic's and the reviewer's prefix, byte for byte). */
  dossier: string | null;
  screen: string | null;
  skeptic: RoleRun<SkepticResult>;
  marks: MarkedObjection[];
  viewer: RoleRun<ViewerResult>;
  makesSense: MakesSense | null;
  /** The viewer's distractions a measure confirms. */
  distractions: Distraction[];
  reviewer: RoleRun<ReviewResult>;
  fix: ClipFix | null;
  status: "waiting" | "reviewing" | "done";
  verdict: "keep" | "fix" | "drop" | "notReviewed" | null;
  confidence: Confidence | null;
  notReviewed: ReviewNotReviewed | null;
  dropWhy: string | null;
}

export type PanelPhase = "research" | "ideas" | "plan" | "review" | "produce" | "done";

export type Pending = { kind: "call"; role: CrewRole; clipId: string | null; attempt: number; errors: string[] } | { kind: "plan" } | { kind: "replan"; clipId: string };

export interface PanelState {
  v: 1;
  stage: PanelStage;
  depth: PanelDepth;
  wanted: number;
  caps: PanelCaps;
  who: "app" | "claude";
  separation: "contexts" | "sameContext";
  /** The roles this run leaves to the rules (never asked; absent: none – a panel saved before the field had none). */
  off?: CrewRole[];
  request: PanelRequest | null;
  menu: MenuItem[];
  liveResearch: boolean;
  phase: PanelPhase;
  digest: ResearchDigest | null;
  researcher: RoleRun<ResearchResult>;
  brief: ResearchResult | null;
  brainstormer: RoleRun<BrainstormResult>;
  ideas: BrainstormIdea[];
  /** The candidates, in review order once measured. */
  clips: PanelClip[];
  current: string | null;
  pending: Pending | null;
  producer: RoleRun<ProducerResult>;
  copy: { source: "producer" | "template"; clips: ProducedClip[] } | null;
  picked: Picked | null;
  spent: { calls: number; retries: number; ms: number; usd: number };
  cancelled: boolean;
  /** What happened, in order ("skeptic c1: o2 refuted", "fix c2 reverted: pick down"…). */
  log: string[];
}

export interface PanelInput {
  stage: PanelStage;
  depth?: PanelDepth;
  /** N: the clips wanted (before a render). */
  wanted?: number;
  /** The plans (the ideas step is skipped) or, after a render, the saved clips. */
  candidates?: readonly PanelCandidate[];
  request?: PanelRequest | null;
  /** The brainstormer's menu (default: the recipes of the default families, recipeMenu()). */
  menu?: readonly MenuItem[];
  digest?: ResearchDigest | null;
  /** A model pass of the researcher (Claude in the toolbox, a cloud model with web search). */
  liveResearch?: boolean;
  caps?: Partial<PanelCaps>;
  who?: "app" | "claude";
  separation?: "contexts" | "sameContext";
  /** Roles this run never asks (see the header). */
  off?: readonly CrewRole[];
}

/** A role's brief: everything a model needs for one call, the same on every route. */
export interface RoleBrief {
  role: CrewRole;
  clipId: string | null;
  /** The job's name ("crew.skeptic"). */
  task: string;
  /** The leading system message: the rubric and the dossier (the viewer's preamble and its view), "" for none. */
  prefix: string;
  card: string;
  /** The answer's schema (the grammar's, the check's) and its shape in a line (the prompt's). */
  final: JsonSchema;
  finalHint: string;
  /** The role's data. */
  user: string;
  maxTokens: number;
  temperature: number;
  effort: "low" | "medium";
  maxSteps: 1;
  maxRetries: number;
  /** promptHash of the prompt (prefix, card, data). */
  hash: string;
}

export type PanelStep =
  | { type: "call"; role: CrewRole; clipId: string | null; brief: RoleBrief; attempt: number; errors: string[] }
  | { type: "plan"; ideas: BrainstormIdea[] }
  | { type: "replan"; clipId: string; clip: CrewClip; need: FinderNeed }
  | { type: "done"; decision: PanelDecision };

export interface PanelDecision {
  stage: PanelStage;
  depth: PanelDepth;
  cancelled: boolean;
  /** The clips to render (before a render) or the kept clips best first (after one). Empty after a cancel. */
  keeps: PickEntry[];
  left: PickEntry[];
  drops: PickEntry[];
  copy: { source: "producer" | "template"; clips: ProducedClip[] } | null;
  ideas: BrainstormIdea[];
  brief: ResearchResult | null;
  spent: PanelState["spent"];
}

const notRun = <T>(): RoleRun<T> => ({ source: null, result: null, why: null, attempts: 0, hash: null });
const LANGUAGES: Readonly<Record<string, string>> = { en: "English", pl: "Polish", es: "Spanish" };

/** The brainstormer's menu until templates exist: the playbook's recipes of the given families, each its own format by claim. */
export function recipeMenu(families: readonly BotFamily[] = BOT_DEFAULT_FAMILIES): MenuItem[] {
  return RECIPES.filter((r) => families.includes(r.family)).map((r) => ({ template: r.id, format: claimOfRecipe(r.id) ?? r.family, modes: [...r.modes], hooks: ["a"], ...(r.endings ? { endings: [...r.endings] } : {}), ...(r.buckets ? { buckets: [...r.buckets] } : {}) }));
}

/** The ideas of a request no model pitches: the menu in order, a format of each first, one idea a template, its first variant. */
export function ideasByCode(menu: readonly MenuItem[], k: number, platform: BotPlatform): BrainstormIdea[] {
  const firsts: MenuItem[] = [];
  const rest: MenuItem[] = [];
  for (const m of menu) (firsts.some((f) => f.format === m.format) ? rest : firsts).push(m);
  const bucket = PLATFORMS[platform].defaultBucket;
  return [...firsts, ...rest].slice(0, Math.max(0, k)).map((m) => {
    const buckets = m.buckets ?? LENGTH_BUCKETS;
    return { template: m.template, mode: m.modes[0], hook: m.hooks[0] ?? "a", ending: (m.endings ?? ENDING_STYLES)[0], bucket: buckets.includes(bucket) ? bucket : buckets[0], angle: "", basis: "none" };
  });
}

/** How many ideas an open request gets: twice the clips wanted, at most 6. */
export const ideasWanted = (wanted: number) => Math.max(1, Math.min(2 * Math.max(1, wanted), 6));

const candidateClip = (c: PanelCandidate, i: number): PanelClip => ({
  id: c.id,
  order: c.order ?? i,
  idea: c.idea ?? null,
  clip: c.clip,
  original: null,
  post: c.post ?? null,
  simple: c.simple ?? {},
  clarity: clarityOf(c.clip, c.simple ?? {}),
  ruleFix: [],
  dossier: null,
  screen: null,
  skeptic: notRun(),
  marks: [],
  viewer: notRun(),
  makesSense: null,
  distractions: [],
  reviewer: notRun(),
  fix: null,
  status: "waiting",
  verdict: null,
  confidence: null,
  notReviewed: null,
  dropWhy: null,
});

/** A new panel (see the header). Candidates given now skip the ideas step; after a render they are the saved clips. */
export function createPanel(input: PanelInput): PanelState {
  const depth = input.depth ?? "quick";
  const wanted = Math.max(1, Math.round(input.wanted ?? input.candidates?.length ?? 3));
  const request = input.request ?? null;
  const brainstorm = input.stage === "pre" && !input.candidates && !!request?.open;
  const clipsGuess = input.candidates?.length ?? (brainstorm ? ideasWanted(wanted) : wanted);
  const caps: PanelCaps = {
    maxCalls: defaultCalls(input.stage, depth, clipsGuess, { research: !!input.liveResearch, brainstorm }),
    maxCandidates: PANEL_DEFAULTS.candidates,
    maxMs: PANEL_DEFAULTS.ms,
    maxUsd: PANEL_DEFAULTS.usd,
    maxRetries: PANEL_DEFAULTS.retries,
    ...input.caps,
  };
  let state: PanelState = {
    v: 1,
    stage: input.stage,
    depth,
    wanted,
    caps,
    who: input.who ?? "app",
    separation: input.separation ?? "contexts",
    ...(input.off?.length ? { off: CREW_ROLES.filter((r) => input.off!.includes(r)) } : {}),
    request,
    menu: [...(input.menu ?? recipeMenu())],
    liveResearch: !!input.liveResearch,
    phase: "research",
    digest: input.digest ?? null,
    researcher: notRun(),
    brief: null,
    brainstormer: notRun(),
    ideas: [],
    clips: [],
    current: null,
    pending: null,
    producer: notRun(),
    copy: null,
    picked: null,
    spent: { calls: 0, retries: 0, ms: 0, usd: 0 },
    cancelled: false,
    log: [],
  };
  // (plans given: no ideas step, even for an empty batch)
  if (input.candidates) state = measured({ ...state, brainstormer: { ...state.brainstormer, source: "skipped", why: "planned" } }, input.candidates);
  return state;
}

/* ------------------------------------------------------------------ helpers */

const log = (s: PanelState, line: string): PanelState => ({ ...s, log: [...s.log, line] });
/** The run leaves this role to the rules (PanelInput.off). */
const roleOff = (s: PanelState, role: CrewRole) => !!s.off?.includes(role);
const clipOf = (s: PanelState, id: string | null) => s.clips.find((c) => c.id === id) ?? null;
function withClip(s: PanelState, id: string, change: (c: PanelClip) => PanelClip): PanelState {
  return { ...s, clips: s.clips.map((c) => (c.id === id ? change(c) : c)) };
}

/** The budget covers one more call. */
export function canCall(s: PanelState): boolean {
  if (s.cancelled || s.depth === "rules") return false;
  if (s.spent.calls >= s.caps.maxCalls) return false;
  if (s.caps.maxMs !== null && s.spent.ms >= s.caps.maxMs) return false;
  if (s.caps.maxUsd !== null && s.spent.usd >= s.caps.maxUsd) return false;
  return true;
}

const conf = (c: PanelClip) => (c.reviewer.source === "model" && c.reviewer.result ? c.reviewer.result.confidence : c.confidence);
const pickOf = (c: PanelClip) => pickScore(c.clarity.playbook.score, c.clarity.simple.score, c.confidence);
const templateOf = (clip: CrewClip) => clip.template ?? clip.recipe ?? clip.mode;
/** A clip the crew keeps: a keep, or a fix (applied, or reverted with nothing major left standing). */
const kept = (c: PanelClip) => c.verdict === "keep" || c.verdict === "fix";

type RuleFix = PanelClip["ruleFix"][number];
/** The measure step's rule fix (a failed G5 or G6): the calm look, then one text at a time. */
const RULE_FIXES: readonly RuleFix[] = ["simplifyLook", "oneTextAtATime"];

/** The rule fix's actions applied to a clip in order; one that does not apply there (a look calm already) is left out. */
function withRuleFix(start: CrewClip, actions: readonly RuleFix[], simple: SimpleOptions): { clip: CrewClip; applied: RuleFix[] } {
  let clip = start;
  const applied: RuleFix[] = [];
  for (const action of actions) {
    const compiled = compileFixes(clip, [{ action }], { simple });
    const fixed = compiled.ok ? applyCompiledFix(clip, compiled, { simple }) : null;
    if (fixed) {
      clip = fixed;
      applied.push(action);
    }
  }
  return { clip, applied };
}

/** The candidates measured (step 3): the rule fix where G5 or G6 fails, a drop on any other failure (before a render), ranked. */
function measured(s: PanelState, candidates: readonly PanelCandidate[]): PanelState {
  let clips = candidates.map(candidateClip);
  let next = s;
  if (s.stage === "pre") {
    clips = clips.map((pc) => {
      let c = pc;
      const failing = failedGates(c.clarity);
      if (failing.some((g) => g === "G5" || g === "G6")) {
        const { clip, applied } = withRuleFix(c.clip, RULE_FIXES, c.simple);
        if (applied.length) {
          c = { ...c, clip, original: c.clip, clarity: clarityOf(clip, c.simple), ruleFix: applied };
          next = log(next, `measure ${c.id}: rule fix ${applied.join(" + ")}`);
        }
      }
      const fails = failedGates(c.clarity);
      if (fails.length) {
        next = log(next, `measure ${c.id}: dropped, ${fails.join(", ")} fails`);
        return { ...c, status: "done", verdict: "drop", dropWhy: `gate:${fails[0]}` };
      }
      return c;
    });
  }
  // the review order: the rules-only pick score, then Simple, Playbook and plan order
  const rank = (c: PanelClip) => pickScore(c.clarity.playbook.score, c.clarity.simple.score, null);
  clips.sort((a, b) => rank(b) - rank(a) || b.clarity.simple.score - a.clarity.simple.score || b.clarity.playbook.score - a.clarity.playbook.score || a.order - b.order);
  return { ...next, clips };
}

/**
 * Why no model looked at a clip although the run asked one to: the first of its roles the rules answered for because its replies
 * stayed invalid, the budget ran out or the run was cancelled during its retries; null when a model answered one of its roles,
 * or the run left them to the rules on purpose (Rules only, roles off).
 */
function unseenWhy(c: PanelClip): ReviewNotReviewed | null {
  const runs = [c.skeptic, c.viewer, c.reviewer];
  if (runs.some((r) => r.source === "model")) return null;
  for (const r of runs) if (r.source === "rules" && (r.why === "broken" || r.why === "budget" || r.why === "cancelled")) return r.why;
  return null;
}

/** A keep no model looked at (unseenWhy) is "not reviewed": the picker takes it only to fill the N, never as seen. A drop stands. */
function unlessUnseen(c: PanelClip): PanelClip {
  const why = c.verdict === "keep" ? unseenWhy(c) : null;
  return why ? { ...c, verdict: "notReviewed", notReviewed: why, confidence: null } : c;
}

/**
 * --- crew --- (the studio's second review round, finding 4) A clip no model will look at – the stop rule reached it, the budget
 * ran out before its viewer, the run was cancelled –: a failed gate still drops it, by the rules (a drop by the rules stands);
 * only a clip the rules would keep is "not reviewed".
 */
function unreviewed(c: PanelClip, why: ReviewNotReviewed): PanelClip {
  const fails = failedGates(c.clarity);
  if (!fails.length) return { ...c, status: "done", verdict: "notReviewed", notReviewed: why };
  return { ...c, status: "done", verdict: "drop", dropWhy: `gate:${fails[0]}`, confidence: null, reviewer: { ...c.reviewer, source: c.reviewer.source ?? "rules", why: c.reviewer.why ?? why } };
}

/** The rules' verdict where no reviewer answered (see the header): a gate, a standing confirmed major objection, a misread after a render. */
function rulesVerdict(s: PanelState, c: PanelClip, why: string): PanelClip {
  const fails = failedGates(c.clarity);
  const confirmed = c.marks.find((m) => m.mark === "confirmed" && m.severity !== "minor");
  if (fails.length) return { ...c, verdict: "drop", dropWhy: `gate:${fails[0]}`, confidence: null, reviewer: { ...c.reviewer, source: c.reviewer.source ?? "rules", why: c.reviewer.why ?? why } };
  if (confirmed) return { ...c, verdict: "drop", dropWhy: `objection:${confirmed.kind}`, confidence: null, reviewer: { ...c.reviewer, source: c.reviewer.source ?? "rules", why: c.reviewer.why ?? why } };
  if (s.stage === "post" && c.makesSense === "no") return { ...c, verdict: "drop", dropWhy: "misread", confidence: null, reviewer: { ...c.reviewer, source: c.reviewer.source ?? "rules", why: c.reviewer.why ?? why } };
  return unlessUnseen({ ...c, verdict: "keep", confidence: null, reviewer: { ...c.reviewer, source: c.reviewer.source ?? "rules", why: c.reviewer.why ?? why } });
}

/** Whether a clip needs the reviewer at this depth (see the header). */
function reviewerNeeded(s: PanelState, c: PanelClip): boolean {
  if (s.depth === "thorough") return true;
  if (s.stage === "pre") {
    const st = standing(c.marks);
    return st.some((m) => m.mark === "confirmed" || m.severity !== "minor") || c.clarity.playbook.score < 80 || c.clarity.simple.score < 80 || (c.makesSense !== null && c.makesSense !== "yes");
  }
  const v = c.viewer.result;
  return !c.clarity.pass || (c.makesSense !== null && c.makesSense !== "yes") || v?.watchToEnd === "no" || c.distractions.length > 0;
}

/* ------------------------------------------------------------------ the steps */

function startClip(s: PanelState, c: PanelClip): PanelState {
  // (the other candidates still in the run: a measure-step drop is never rendered, so it is no copy to worry about)
  const others: OtherCandidate[] = s.clips.filter((o) => o.id !== c.id && o.verdict !== "drop").map((o) => ({ template: o.clip.template ?? (o.clip.recipe ? `recipe:${o.clip.recipe}` : o.clip.mode), hook: drawnHookText(o.clip) }));
  const dossier = intentView(c.clip, { clarity: c.clarity, others, research: researchGapOf(s.brief), simpleOptions: c.simple }).text;
  const screen = screenView(c.clip).text;
  return withClip({ ...s, current: c.id }, c.id, (x) => ({ ...x, status: "reviewing", dossier, screen }));
}

function finishClip(s: PanelState, id: string, change: (c: PanelClip) => PanelClip): PanelState {
  const next = withClip(s, id, (c) => ({ ...change(c), status: "done" }));
  const c = clipOf(next, id)!;
  return log({ ...next, current: null }, `verdict ${id}: ${c.verdict}${c.fix ? ` (fix ${c.fix.state}${c.fix.why ? `: ${c.fix.why}` : ""})` : ""}${c.dropWhy ? ` (${c.dropWhy})` : ""}`);
}

const call = (s: PanelState, role: CrewRole, clipId: string | null): PanelState => ({ ...s, pending: { kind: "call", role, clipId, attempt: 1, errors: [] } });

/** The fix round of a pre-render "fix" (step 4): compiled, then applied here or after the seed search. */
function fixRound(s: PanelState, c: PanelClip): PanelState {
  const result = c.reviewer.result!;
  const compiled = compileFixes(c.clip, result.fixes, { simple: c.simple });
  if (!compiled.ok) return judged(s, c.id, null, { actions: result.fixes, state: "refused", why: compiled.errors[0] ?? "refused", compiled });
  if (compiled.finder) return { ...withClip(s, c.id, (x) => ({ ...x, fix: { actions: result.fixes, state: "applied", why: null, compiled } })), pending: { kind: "replan", clipId: c.id } };
  return judged(s, c.id, applyCompiledFix(c.clip, compiled, { simple: c.simple }), { actions: result.fixes, state: "applied", why: null, compiled });
}

/** The confirmed objections at major or fatal that stand on a clip: the ones its reviewer must answer with a fix, or drop it. */
const confirmedMajor = (c: PanelClip) => c.marks.filter((m) => m.stands && m.mark === "confirmed" && m.severity !== "minor");

/**
 * A fix judged by the rules: kept when every gate passes, the pick score did not go down and the facts no longer confirm a
 * major objection it answers, else reverted (see the header).
 */
function judged(s: PanelState, id: string, fixed: CrewClip | null, fix: ClipFix): PanelState {
  const c = clipOf(s, id)!;
  const confidence = c.reviewer.result?.confidence ?? null;
  let outcome: ClipFix = fix;
  let clip = c.clip;
  let clarity = c.clarity;
  let original: CrewClip | null = c.original;
  if (fix.state !== "refused") {
    if (!fixed) outcome = { ...fix, state: "reverted", why: "it does not apply to the clip" };
    else {
      const after = clarityOf(fixed, c.simple);
      const before = pickScore(c.clarity.playbook.score, c.clarity.simple.score, confidence);
      const now = pickScore(after.playbook.score, after.simple.score, confidence);
      // --- crew --- (the studio's second review round, findings 1 and 2) the objections the fix answers, marked again on the
      // fixed clip: one the facts still confirm was not answered – a retime that leaves the payoff late, or later; a calmer look
      // that leaves two messages at once
      const left = after.pass && now >= before - 1e-9 ? confirmedMajor(c).map((m) => markObjection(m, fixed, after, c.simple)).find((m) => m.mark === "confirmed") : undefined;
      if (!after.pass) outcome = { ...fix, state: "reverted", why: `${failedGates(after).join(", ")} fails` };
      else if (now < before - 1e-9) outcome = { ...fix, state: "reverted", why: `pick ${before} -> ${now}` };
      else if (left) outcome = { ...fix, state: "reverted", why: `${left.kind} still confirmed: ${left.basis}` };
      else {
        outcome = { ...fix, state: "applied", why: null };
        original = c.original ?? c.clip;
        clip = fixed;
        clarity = after;
      }
    }
  }
  const standingMajor = confirmedMajor(c).length > 0 || (c.makesSense !== null && c.makesSense !== "yes");
  const dropped = outcome.state !== "applied" && standingMajor;
  return finishClip(s, id, (x) => ({ ...x, clip, clarity, original, fix: outcome, verdict: dropped ? "drop" : "fix", dropWhy: dropped ? (outcome.state === "refused" ? "fixRefused" : "fixReverted") : null, confidence }));
}

/** The review of the current clip, step by step: a call, the seed search, or its verdict. */
function reviewStep(s: PanelState): PanelState {
  const c = clipOf(s, s.current)!;
  if (s.depth === "rules") return finishClip(s, c.id, (x) => rulesVerdict(s, { ...x, skeptic: { ...x.skeptic, source: "rules", why: "depth" }, viewer: { ...x.viewer, source: "rules", why: "depth" } }, "depth"));
  const pre = s.stage === "pre";
  // the viewer: after a render always, before one at Thorough (first: the skeptic and the reviewer share their prefix)
  if (c.viewer.source === null) {
    if (roleOff(s, "viewer")) return withClip(s, c.id, (x) => ({ ...x, viewer: { ...x.viewer, source: "skipped", why: "off" } }));
    if (!pre || s.depth === "thorough") {
      if (canCall(s)) return call(s, "viewer", c.id);
      if (!pre) return finishClip(s, c.id, (x) => unreviewed({ ...x, viewer: { ...x.viewer, source: "rules", why: "budget" } }, "budget"));
      return withClip(s, c.id, (x) => ({ ...x, viewer: { ...x.viewer, source: "rules", why: "budget" } }));
    }
    return withClip(s, c.id, (x) => ({ ...x, viewer: { ...x.viewer, source: "skipped", why: "quick" } }));
  }
  if (pre && c.skeptic.source === null) {
    if (roleOff(s, "skeptic")) return withClip(s, c.id, (x) => ({ ...x, skeptic: { ...x.skeptic, source: "skipped", why: "off" } }));
    if (canCall(s)) return call(s, "skeptic", c.id);
    return withClip(s, c.id, (x) => ({ ...x, skeptic: { ...x.skeptic, source: "rules", why: "budget" } }));
  }
  if (!pre && c.skeptic.source === null) return withClip(s, c.id, (x) => ({ ...x, skeptic: { ...x.skeptic, source: "skipped", why: "post" } }));
  if (c.reviewer.source === null) {
    // (nothing in doubt: a keep – unless no model looked at all, its skeptic or its viewer broken or out of budget)
    if (!reviewerNeeded(s, c)) return finishClip(s, c.id, (x) => unlessUnseen({ ...x, reviewer: { ...x.reviewer, source: "skipped", why: "quick" }, verdict: "keep", confidence: "medium" }));
    if (roleOff(s, "reviewer")) return finishClip(s, c.id, (x) => rulesVerdict(s, x, "off"));
    if (canCall(s)) return call(s, "reviewer", c.id);
    return finishClip(s, c.id, (x) => rulesVerdict(s, x, "budget"));
  }
  if (c.reviewer.source !== "model" || !c.reviewer.result) return finishClip(s, c.id, (x) => rulesVerdict(s, x, x.reviewer.why ?? "broken"));
  const r = c.reviewer.result;
  if (r.verdict === "keep") return finishClip(s, c.id, (x) => ({ ...x, verdict: "keep", confidence: r.confidence }));
  if (r.verdict === "drop") return finishClip(s, c.id, (x) => ({ ...x, verdict: "drop", dropWhy: "reviewer", confidence: r.confidence }));
  if (!pre) {
    // after a render a fix is offered ("Make the fixed version"), never applied here
    const compiled = compileFixes(c.clip, r.fixes, { simple: c.simple });
    return finishClip(s, c.id, (x) => ({ ...x, verdict: "fix", confidence: r.confidence, fix: { actions: r.fixes, state: compiled.ok ? "offered" : "refused", why: compiled.ok ? null : compiled.errors[0] ?? null, compiled } }));
  }
  return fixRound(s, c);
}

/** Before a new candidate: the stop rule (see the header); the clips left get "not reviewed". */
function stopWhy(s: PanelState): ReviewNotReviewed | null {
  if (s.cancelled) return "cancelled";
  if (s.depth === "rules") return null;
  if (s.stage === "pre") {
    // (the keeps the picker can take: two of one template count once in a small batch; a keep only the rules weighed is no
    // confident one – medium confidence or more, from a model)
    const confident = s.clips.filter((c) => c.status === "done" && kept(c) && (c.confidence === "medium" || c.confidence === "high")).map(pickCandidateOf);
    if (pick(confident, s.wanted, { namedTemplate: !!s.request?.namedTemplate }).keeps.length >= s.wanted) return "enough";
    const reviewed = s.clips.filter((c) => c.status !== "waiting" && c.verdict !== "notReviewed" && c.dossier !== null).length;
    if (reviewed >= s.caps.maxCandidates) return "cap";
  }
  return canCall(s) ? null : "budget";
}

function produceStep(s: PanelState): PanelState {
  if (s.stage === "post") return { ...s, phase: "done" };
  const picked = s.picked ?? pick(s.clips.map(pickCandidateOf), s.wanted, { namedTemplate: !!s.request?.namedTemplate });
  let next: PanelState = { ...s, picked };
  if (picked.keeps.length === 0) return { ...next, phase: "done" };
  if (next.producer.source === null) {
    if (canCall(next) && !roleOff(next, "producer")) return call(next, "producer", null);
    next = { ...next, producer: { ...next.producer, source: "rules", why: next.depth === "rules" ? "depth" : next.cancelled ? "cancelled" : roleOff(next, "producer") ? "off" : "budget" } };
  }
  if (!next.copy) next = { ...next, copy: { source: "template", clips: picked.keeps.map((k) => templateCopyOf(next, k.id)) } };
  return { ...next, phase: "done" };
}

function templateCopyOf(s: PanelState, id: string): ProducedClip {
  const c = clipOf(s, id)!;
  const hook = drawnHookText(c.clip) || c.clip.hook || "";
  return { planId: id, name: c.post?.name ?? id, title: c.post?.title ?? hook, hook, caption: c.post?.caption ?? "", hashtags: c.post?.hashtags ?? [], platform: c.clip.platform };
}

/** A clip as the picker reads it. */
export function pickCandidateOf(c: PanelClip): PickCandidate {
  return {
    id: c.id,
    order: c.order,
    template: templateOf(c.clip),
    failed: failedGates(c.clarity),
    playbook: c.clarity.playbook.score,
    simple: c.clarity.simple.score,
    verdict: c.verdict === "drop" ? "drop" : c.verdict === "notReviewed" || c.verdict === null ? "notReviewed" : "keep",
    confidence: c.confidence,
    dropWhy: c.dropWhy,
  };
}

/** Every code-only step until a call, the planner, the seed search or the end is needed. */
function advance(start: PanelState): PanelState {
  let s = start;
  for (let guard = 0; guard < 10_000; guard++) {
    if (s.pending) return s;
    if (s.cancelled && s.phase !== "done") {
      s = { ...s, current: null, phase: "done", clips: s.clips.map((c) => (c.status === "done" ? c : unreviewed(c, "cancelled"))) };
      return log(s, "cancelled");
    }
    switch (s.phase) {
      case "research": {
        if (s.researcher.source === null) {
          if (s.liveResearch && s.digest && s.digest.sources.length && canCall(s) && !roleOff(s, "researcher")) return call(s, "researcher", null);
          s = { ...s, researcher: { ...s.researcher, source: s.liveResearch ? "rules" : "skipped", why: s.depth === "rules" ? "depth" : !s.liveResearch ? "notLive" : roleOff(s, "researcher") ? "off" : "budget" } };
        }
        if (!s.brief && s.digest) s = { ...s, brief: researchBriefOf(s.digest) };
        s = { ...s, phase: "ideas" };
        break;
      }
      case "ideas": {
        if (s.clips.length || s.brainstormer.why === "planned") {
          s = { ...s, phase: "review" };
          break;
        }
        if (s.brainstormer.source === null) {
          if (s.request?.open && s.menu.length && canCall(s) && !roleOff(s, "brainstormer")) return call(s, "brainstormer", null);
          s = { ...s, brainstormer: { ...s.brainstormer, source: s.request?.open ? "rules" : "skipped", why: s.depth === "rules" ? "depth" : !s.request?.open ? "notOpen" : roleOff(s, "brainstormer") ? "off" : "budget" } };
        }
        if (s.ideas.length === 0) s = { ...s, ideas: ideasByCode(s.menu, s.request?.open ? ideasWanted(s.wanted) : s.wanted, s.request?.platform ?? "reels") };
        s = { ...s, phase: "plan" };
        break;
      }
      case "plan":
        return { ...s, pending: { kind: "plan" } };
      case "review": {
        if (s.current === null) {
          const next = s.clips.find((c) => c.status === "waiting");
          if (!next) {
            s = { ...s, phase: "produce" };
            break;
          }
          const why = stopWhy(s);
          if (why) {
            s = log({ ...s, clips: s.clips.map((c) => (c.status === "waiting" ? unreviewed(c, why) : c)) }, `stop: ${why}`);
            break;
          }
          s = startClip(s, next);
          break;
        }
        s = reviewStep(s);
        break;
      }
      case "produce":
        s = produceStep(s);
        break;
      case "done":
        return s;
    }
  }
  return s;
}

/* ------------------------------------------------------------------ the briefs */

const clipPrefix = (c: PanelClip) => `${SHARED_RUBRIC}\n\nThe clip's dossier:\n${c.dossier ?? ""}`;
const SKEPTIC_USER = "Judge the clip in the dossier.";

function reviewShape(c: PanelClip): ReviewShape {
  const st = standing(c.marks);
  return { objections: st.map((m) => m.id), viewer: c.viewer.source !== "model" || !c.viewer.result ? "none" : c.makesSense !== "yes" ? "misread" : "read", clutter: clutterOn(c.clip, { simple: c.simple }) };
}

function reviewerUser(s: PanelState, c: PanelClip): string {
  const objections = standing(c.marks).map((m) => ({ id: m.id, kind: m.kind, evidence: m.evidence, severity: m.severity, mark: m.mark }));
  const v = c.viewer.source === "model" ? c.viewer.result : null;
  const viewer = v ? { whatHappens: v.whatHappens, makesSense: c.makesSense, clearBySec: v.clearBySec, distractions: v.distractions, confirmedDistractions: c.distractions, watchToEnd: v.watchToEnd } : null;
  return [
    `Objections (JSON; mark: confirmed by the facts, or opinion): ${JSON.stringify(objections)}`,
    `The viewer's read (JSON): ${viewer ? JSON.stringify(viewer) : "none (no viewer looked)"}`,
    `Stage: ${s.stage === "pre" ? "before the render (a fix is applied and measured again)" : "after the render (a fix is offered as a new version)"}.`,
    `Research: ${briefText(s.brief, BRIEF_CHARS.reviewer)}`,
    `turnOff may name: ${clutterOn(c.clip, { simple: c.simple }).join(", ") || "nothing (all off)"}.`,
  ].join("\n");
}

function brainstormUser(s: PanelState): string {
  const r = s.request!;
  const k = ideasWanted(s.wanted);
  return [
    `Request: ${JSON.stringify(r.text)}`,
    `Platform: ${r.platform}. Clip language: ${LANGUAGES[r.locale] ?? "English"}. Pitch ${k} ideas.`,
    `Research brief:\n${briefText(s.brief, BRIEF_CHARS.brainstormer)}`,
    "Menu (template (format): modes; hook variants, with their words where known):",
    ...s.menu.map((m) => `- ${m.template} (${m.format}): ${m.modes.join(", ")}; ${m.hooks.map((h) => (m.hookWords?.[h] ? `${h} ${JSON.stringify(m.hookWords[h])}` : h)).join(", ")}`),
  ].join("\n");
}

function producerUser(s: PanelState): string {
  const ids = s.picked?.keeps.map((k) => k.id) ?? [];
  const clips = ids.map((id) => {
    const c = clipOf(s, id)!;
    // --- templates --- (as a viewer reads them: a message at the bottom of the square is stacked upwards)
    const words = (role: string) => captionWordsOf(c.clip.captions, c.clip.captions.map((_, i) => (c.clip.captionRoles[i] === role ? i : -1)).filter((i) => i >= 0));
    return { planId: id, platform: c.clip.platform, mode: c.clip.mode, lengthSec: Math.round(c.clip.timing.clipSec * 10) / 10, hook: drawnHookText(c.clip) || c.clip.hook || "", payoff: words("payoff"), question: words("question"), templateCopy: c.post ? { caption: c.post.caption, hashtags: c.post.hashtags } : null };
  });
  return [`Write in ${LANGUAGES[s.request?.locale ?? "en"] ?? "English"}.`, `Kept clips (JSON): ${JSON.stringify(clips)}`, `Research: ${briefText(s.brief, BRIEF_CHARS.producer)}`].join("\n");
}

/** The brief of a role's call (see RoleBrief). */
export function briefOf(s: PanelState, role: CrewRole, clipId: string | null): RoleBrief {
  const spec = ROLE_SPECS[role];
  const c = clipOf(s, clipId);
  let prefix = "";
  let user = "";
  let final: JsonSchema;
  switch (role) {
    case "researcher":
      user = s.digest?.text ?? "";
      final = researchFinal(s.digest?.sources.map((x) => x.id) ?? []);
      break;
    case "brainstormer":
      prefix = SHARED_RUBRIC;
      user = brainstormUser(s);
      final = brainstormFinal(s.menu, ideasWanted(s.wanted), s.brief?.points.map((p) => p.id) ?? []);
      break;
    case "skeptic":
      prefix = clipPrefix(c!);
      user = SKEPTIC_USER;
      final = SKEPTIC_FINAL;
      break;
    case "viewer":
      prefix = VIEWER_PREAMBLE;
      user = c!.screen ?? "";
      final = VIEWER_FINAL;
      break;
    case "reviewer":
      prefix = clipPrefix(c!);
      user = reviewerUser(s, c!);
      final = reviewFinal(reviewShape(c!));
      break;
    case "producer": {
      prefix = SHARED_RUBRIC;
      user = producerUser(s);
      const ids = s.picked?.keeps.map((k) => k.id) ?? [];
      final = producerFinal(ids, ids.map((id) => clipOf(s, id)!.clip.platform));
      break;
    }
  }
  return {
    role,
    clipId,
    task: taskOf(role, s.depth),
    prefix,
    card: spec.card,
    final,
    finalHint: spec.finalHint,
    user,
    maxTokens: spec.maxTokens,
    temperature: spec.temperature,
    effort: effortOf(role, s.depth),
    maxSteps: 1,
    maxRetries: s.caps.maxRetries,
    hash: promptHash(`${prefix}\n\n${spec.card}\n\n${user}`),
  };
}

/** A brief as messages for a model the caller talks to directly: the prefix, the card with its protocol, the data. */
export function briefMessages(brief: RoleBrief): { role: "system" | "user"; content: string }[] {
  const out: { role: "system" | "user"; content: string }[] = [];
  if (brief.prefix) out.push({ role: "system", content: brief.prefix });
  out.push({ role: "system", content: `${brief.card}\n\n${protocolOf(brief.role)}` });
  out.push({ role: "user", content: brief.user });
  return out;
}

/* ------------------------------------------------------------------ the public steps */

/** The next step (and the state it was reached in: code-only steps run on the way). */
export function nextStep(state: PanelState): { state: PanelState; step: PanelStep } {
  const s = advance(state);
  const p = s.pending;
  if (p?.kind === "call") return { state: s, step: { type: "call", role: p.role, clipId: p.clipId, brief: briefOf(s, p.role, p.clipId), attempt: p.attempt, errors: p.errors } };
  if (p?.kind === "plan") return { state: s, step: { type: "plan", ideas: s.ideas } };
  if (p?.kind === "replan") {
    const c = clipOf(s, p.clipId)!;
    return { state: s, step: { type: "replan", clipId: p.clipId, clip: c.clip, need: c.fix!.compiled!.finder! } };
  }
  return { state: s, step: { type: "done", decision: panelDecision(s) } };
}

/** A role's answer: its reply (the model's text, or its JSON), or the error its call ended with. */
export type RoleAnswer = { role: CrewRole; clipId: string | null; reply: unknown; error?: undefined } | { role: CrewRole; clipId: string | null; error: string; reply?: undefined };

/** What one call cost: the time and the money the caller measured. */
export interface CallSpent {
  ms?: number;
  usd?: number;
}

/** The reply as a value: its JSON (a code fence or a sentence around it tolerated), the agent loop's envelope unwrapped. */
function replyValue(reply: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  let value = reply;
  if (typeof reply === "string") {
    const parsed = extractJson(reply);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    value = parsed.value;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).action === "final" && "result" in (value as Record<string, unknown>)) value = (value as Record<string, unknown>).result;
  return { ok: true, value };
}

/** The errors of a role's reply against its schema and its checks; the value as normalised. */
function checkReply(s: PanelState, role: CrewRole, c: PanelClip | null, raw: unknown, brief: RoleBrief): { value: unknown; errors: string[] } {
  const parsed = replyValue(raw);
  if (!parsed.ok) return { value: null, errors: [parsed.error] };
  let value = parsed.value;
  if (role === "reviewer") value = normaliseReview(value);
  if (role === "brainstormer") value = normaliseBrainstorm(value); // --- crew --- (review round 2: "A" is the variant a)
  if (role === "researcher") value = normaliseResearch(value, s.digest?.sources.map((x) => x.id) ?? []);
  if (role === "producer") {
    const drawn: Record<string, string> = {};
    for (const k of s.picked?.keeps ?? []) {
      const x = clipOf(s, k.id)!;
      drawn[k.id] = drawnHookText(x.clip) || x.clip.hook || k.id;
    }
    value = normaliseProducer(value, drawn);
  }
  const errors = validateJson(brief.final, value);
  if (errors.length) return { value, errors };
  switch (role) {
    case "skeptic":
      return { value, errors: checkSkeptic(value as SkepticResult) };
    case "viewer":
      return { value, errors: checkViewer(value as ViewerResult) };
    case "brainstormer":
      return { value, errors: checkBrainstorm(value as BrainstormResult, { menu: s.menu, named: !!s.request?.namedTemplate }) };
    case "producer":
      return { value, errors: checkProducer(value as ProducerResult, s.picked?.keeps.map((k) => k.id) ?? []) };
    case "reviewer": {
      const st = standing(c!.marks);
      return {
        value,
        errors: checkReview(value as ReviewResult, {
          stage: s.stage,
          objections: st.map((m) => ({ id: m.id, kind: m.kind, severity: m.severity, mark: m.mark === "confirmed" ? "confirmed" : "opinion" })),
          viewer: c!.viewer.source === "model" && c!.makesSense ? { makesSense: c!.makesSense } : null,
          gateFails: !c!.clarity.pass,
          compile: (fixes) => compileFixes(c!.clip, fixes, { simple: c!.simple }).errors,
        }),
      };
    }
    default:
      return { value, errors: [] };
  }
}

/** A role answered by the rules (its replies stayed invalid, or the budget ran out): its fallback. */
function fallback(s: PanelState, role: CrewRole, clipId: string | null, why: string, attempts: number): PanelState {
  const rules = <T>(r: RoleRun<T>): RoleRun<T> => ({ ...r, source: "rules", why, attempts });
  const next = log({ ...s, pending: null }, `${role}${clipId ? ` ${clipId}` : ""}: rules only (${why})`);
  switch (role) {
    case "researcher":
      return { ...next, researcher: rules(next.researcher) };
    case "brainstormer":
      return { ...next, brainstormer: rules(next.brainstormer) };
    case "producer":
      return { ...next, producer: rules(next.producer) };
    case "skeptic":
      return withClip(next, clipId!, (c) => ({ ...c, skeptic: rules(c.skeptic) }));
    case "viewer":
      return withClip(next, clipId!, (c) => ({ ...c, viewer: rules(c.viewer) }));
    case "reviewer":
      return withClip(next, clipId!, (c) => ({ ...c, reviewer: rules(c.reviewer) }));
  }
}

/** A valid reply recorded, and what code makes of it at once (the marks, makesSense, the brief, the ideas, the copy). */
function record(s: PanelState, role: CrewRole, clipId: string | null, value: unknown, attempts: number, hash: string): PanelState {
  const run = <T>(r: RoleRun<T>): RoleRun<T> => ({ ...r, source: "model", result: value as T, why: null, attempts, hash });
  let next: PanelState = { ...s, pending: null };
  switch (role) {
    case "researcher":
      return { ...next, researcher: run(next.researcher), brief: value as ResearchResult };
    case "brainstormer":
      return { ...next, brainstormer: run(next.brainstormer), ideas: (value as BrainstormResult).ideas };
    case "producer":
      return { ...next, producer: run(next.producer), copy: { source: "producer", clips: (value as ProducerResult).clips } };
    case "skeptic": {
      next = withClip(next, clipId!, (c) => ({ ...c, skeptic: run(c.skeptic), marks: markObjections((value as SkepticResult).objections, c.clip, c.clarity, c.simple) }));
      const c = clipOf(next, clipId)!;
      for (const m of c.marks) next = log(next, `skeptic ${clipId}: ${m.id} ${m.kind} ${m.severity} ${m.mark}${m.mark === "refuted" ? ` – ${m.basis}` : ""}`);
      return next;
    }
    case "viewer":
      return withClip(next, clipId!, (c) => {
        const v = value as ViewerResult;
        return { ...c, viewer: run(c.viewer), makesSense: makesSenseOf(v.whatHappens, c.clip.claim), distractions: confirmedDistractions(v.distractions, c.clip, c.clarity) };
      });
    case "reviewer":
      return withClip(next, clipId!, (c) => ({ ...c, reviewer: run(c.reviewer) }));
  }
}

/**
 * A role's answer to the pending call. A reply out of order (another role or clip than the call asked for) is refused and
 * changes nothing; an invalid one counts as a call and comes back with its errors for a retry, until maxRetries in a row or
 * the budget's end, when the rules answer for that step.
 */
export function applyVerdict(state: PanelState, answer: RoleAnswer, spent: CallSpent = {}): { state: PanelState; ok: boolean; errors: string[] } {
  const s = advance(state);
  const p = s.pending;
  if (!p || p.kind !== "call") return { state: s, ok: false, errors: [s.phase === "done" ? "the panel is done" : "no role is asked for now"] };
  if (answer.role !== p.role || answer.clipId !== p.clipId) return { state: s, ok: false, errors: [`out of order: the panel asks for the ${p.role}${p.clipId ? ` of ${p.clipId}` : ""}, not the ${answer.role}${answer.clipId ? ` of ${answer.clipId}` : ""}`] };
  const spentNow = { ...s.spent, calls: s.spent.calls + 1, ms: s.spent.ms + Math.max(0, spent.ms ?? 0), usd: s.spent.usd + Math.max(0, spent.usd ?? 0) };
  let next: PanelState = { ...s, spent: spentNow };
  const brief = briefOf(next, p.role, p.clipId);
  const checked = answer.error !== undefined ? { value: null, errors: [`the call failed: ${answer.error}`] } : checkReply(next, p.role, clipOf(next, p.clipId), answer.reply, brief);
  if (checked.errors.length === 0) return { state: record(next, p.role, p.clipId, checked.value, p.attempt, brief.hash), ok: true, errors: [] };
  next = { ...next, spent: { ...next.spent, retries: next.spent.retries + 1 } };
  if (p.attempt > next.caps.maxRetries) return { state: fallback(next, p.role, p.clipId, "broken", p.attempt), ok: false, errors: checked.errors };
  if (!canCall(next)) return { state: fallback(next, p.role, p.clipId, next.cancelled ? "cancelled" : "budget", p.attempt), ok: false, errors: checked.errors };
  return { state: { ...next, pending: { ...p, attempt: p.attempt + 1, errors: checked.errors.slice(0, 8) } }, ok: false, errors: checked.errors };
}

/** The planner's candidates for the ideas (the plan step); measured and ranked at once. */
export function applyCandidates(state: PanelState, candidates: readonly PanelCandidate[]): PanelState {
  const s = advance(state);
  if (s.pending?.kind !== "plan") return s;
  return measured({ ...s, pending: null, phase: "review" }, candidates);
}

/**
 * The seed search's clip for a fix (null: it found none): the measure step's rule fix again (the search plans in the template's
 * own look, so the clip comes back as the reviewed one stood before its rule fix), then the fix's look and text, then judged by
 * the rules – against the clip the reviewer saw, never against a look it did not have.
 */
export function applyReplan(state: PanelState, clipId: string, clip: CrewClip | null): PanelState {
  const s = advance(state);
  if (s.pending?.kind !== "replan" || s.pending.clipId !== clipId) return s;
  const c = clipOf(s, clipId)!;
  const fix = c.fix!;
  const next = { ...s, pending: null };
  if (!clip) return judged(next, clipId, null, { ...fix, state: "applied" });
  const base = c.ruleFix.length ? withRuleFix(clip, c.ruleFix, c.simple).clip : clip;
  return judged(next, clipId, applyCompiledFix(base, fix.compiled!, { simple: c.simple }), { ...fix, state: "applied" });
}

/**
 * Clips rendered after a post-render panel began (stage "post"): one with a new id joins as a candidate, one rendered again (a
 * new clip under an id the panel has) starts over in its place, and each brings its own calls (defaultCalls). The clips the
 * panel looked at keep their look; a panel that was done takes the review up again. Before a render it changes nothing.
 */
export function joinCandidates(state: PanelState, candidates: readonly PanelCandidate[]): PanelState {
  if (state.stage !== "post" || candidates.length === 0) return state;
  const fresh = measured({ ...state, clips: [] }, candidates.map((c, i) => ({ ...c, order: c.order ?? state.clips.length + i }))).clips;
  const ids = new Set(fresh.map((c) => c.id));
  const stale = state.current !== null && ids.has(state.current);
  const next: PanelState = {
    ...state,
    clips: [...state.clips.filter((c) => !ids.has(c.id)), ...fresh],
    caps: { ...state.caps, maxCalls: state.caps.maxCalls + defaultCalls("post", state.depth, fresh.length) },
    current: stale ? null : state.current,
    pending: stale || (state.pending?.kind === "call" && state.pending.clipId !== null && ids.has(state.pending.clipId)) ? null : state.pending,
    phase: state.phase === "done" ? "review" : state.phase,
  };
  return log(next, `joined after the render: ${fresh.map((c) => c.id).join(", ")}`);
}

/** Cancels the run: it ends at the next step and queues nothing. */
export function cancelPanel(state: PanelState): PanelState {
  return { ...state, cancelled: true, pending: null };
}

/** The run's decision (see PanelDecision). */
export function panelDecision(s: PanelState): PanelDecision {
  const base = { stage: s.stage, depth: s.depth, cancelled: s.cancelled, copy: s.cancelled ? null : s.copy, ideas: s.ideas, brief: s.brief, spent: s.spent };
  if (s.stage === "post") {
    const all = pick(s.clips.map(pickCandidateOf), s.clips.length, { namedTemplate: true });
    return { ...base, keeps: s.cancelled ? [] : all.keeps, left: all.left, drops: all.drops };
  }
  const picked = s.picked ?? pick(s.clips.map(pickCandidateOf), s.wanted, { namedTemplate: !!s.request?.namedTemplate });
  return { ...base, keeps: s.cancelled ? [] : picked.keeps, left: s.cancelled ? [...picked.keeps.map((k) => ({ ...k, reason: "cancelled" })), ...picked.left] : picked.left, drops: picked.drops };
}

/** A clip's review record (review.ts ClipReview, sanitised). `model`: the model's id; `date`: the caller's. */
export function clipReviewOf(s: PanelState, clipId: string, meta: { model?: string | null; date?: string | null } = {}): ClipReview | null {
  const c = clipOf(s, clipId);
  if (!c) return null;
  const st = standing(c.marks);
  const worst = st.some((m) => m.severity === "fatal") ? "fatal" : st.some((m) => m.severity === "major") ? "major" : st.length ? "minor" : "none";
  const v = c.viewer.result;
  const issues: ReviewIssue[] = [...st.map((m) => m.kind), ...(c.makesSense && c.makesSense !== "yes" ? ["misread" as const] : []), ...(v?.watchToEnd === "no" ? ["wouldScroll" as const] : []), ...c.distractions];
  const line = (role: ClipReviewRole["role"], run: RoleRun<unknown>, verdict: string | null, note: string): ClipReviewRole => ({ role, source: run.source ?? "skipped", verdict: run.source === "model" ? verdict : null, note: run.source === "model" ? note : run.why ?? "" });
  const r = c.reviewer.result;
  return sanitizeReview({
    v: 1,
    depth: s.depth,
    stage: s.stage,
    verdict: c.verdict ?? "notReviewed",
    confidence: c.confidence ?? conf(c),
    makesSense: c.makesSense,
    simple: c.clarity.simple.score,
    playbook: c.clarity.playbook.score,
    pick: pickOf(c),
    gates: failedGates(c.clarity),
    issues,
    fixes: c.fix ? c.fix.actions.map((a) => a.action) : [],
    fixState: c.fix?.state ?? null,
    notReviewed: c.notReviewed,
    roles: [line("skeptic", c.skeptic, worst, c.skeptic.result?.oneIdea ?? ""), line("viewer", c.viewer, v?.whatHappens ?? null, v?.understood ?? ""), line("reviewer", c.reviewer, r?.verdict ?? null, r?.why ?? "")],
    model: meta.model ?? null,
    promptHash: c.reviewer.hash ?? c.skeptic.hash ?? c.viewer.hash,
    date: meta.date ?? null,
    who: s.who,
    separation: s.separation,
  });
}

/* ------------------------------------------------------------------ the loop, with the model as a function */

/** One call of a role: its brief, which attempt this is and the errors of the one before. */
export interface RoleRequest {
  brief: RoleBrief;
  attempt: number;
  errors: string[];
  signal?: AbortSignal;
}

/** A model: a role's request in, its reply out (text or JSON), with what it cost when the caller knows. */
export type CrewModel = (request: RoleRequest) => Promise<{ reply: unknown; usd?: number }>;

export interface PanelDriver {
  model: CrewModel;
  /** The planner: the ideas in, the candidate clips out (none: an empty batch). */
  plan?: (ideas: readonly BrainstormIdea[]) => Promise<readonly PanelCandidate[]> | readonly PanelCandidate[];
  /** The seed search for a fix: the clip and what the fix needs in, the re-planned clip out (null: none found). */
  replan?: (clip: CrewClip, need: FinderNeed) => Promise<CrewClip | null> | CrewClip | null;
  /** The caller's clock (ms), so the time cap counts; without one the calls cost no time. */
  clock?: () => number;
  signal?: AbortSignal;
  onStep?: (step: PanelStep, state: PanelState) => void;
}

/** Runs the panel to its end with the caller's model, planner and seed search (see the header). */
export async function runPanel(start: PanelState, driver: PanelDriver): Promise<PanelState> {
  let state = start;
  for (let guard = 0; guard < 10_000; guard++) {
    if (driver.signal?.aborted && !state.cancelled) state = cancelPanel(state);
    const { state: s, step } = nextStep(state);
    state = s;
    driver.onStep?.(step, state);
    if (step.type === "done") return state;
    if (step.type === "plan") {
      state = applyCandidates(state, driver.plan ? await driver.plan(step.ideas) : []);
      continue;
    }
    if (step.type === "replan") {
      state = applyReplan(state, step.clipId, driver.replan ? await driver.replan(step.clip, step.need) : null);
      continue;
    }
    const t0 = driver.clock?.() ?? 0;
    let answer: RoleAnswer;
    let usd = 0;
    try {
      const out = await driver.model({ brief: step.brief, attempt: step.attempt, errors: step.errors, signal: driver.signal });
      answer = { role: step.role, clipId: step.clipId, reply: out?.reply };
      usd = typeof out?.usd === "number" && Number.isFinite(out.usd) ? out.usd : 0;
    } catch (err) {
      if (driver.signal?.aborted) {
        state = cancelPanel(state);
        continue;
      }
      answer = { role: step.role, clipId: step.clipId, error: err instanceof Error ? err.message : String(err) };
    }
    const ms = driver.clock ? Math.max(0, driver.clock() - t0) : 0;
    state = applyVerdict(state, answer, { ms, usd }).state;
  }
  return state;
}
// --- end crew ---
