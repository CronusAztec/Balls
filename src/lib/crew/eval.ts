import type { Caption } from "@/lib/captions";
import { captionWordsOf, type CaptionRole } from "@/lib/bot/planner";
import { HOOK_SEC } from "@/lib/bot/playbook";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { factNumbersOf, numbersIn, type Claim, type CrewClip } from "./clip";
import { clarityOf, failedGates, type GateId } from "./clarity";
import { markObjection } from "./evidence";
import { hookCaptionsOf, hookEdgeOf, playbookOf } from "./fixes";
import { hasRingWalls } from "./hudFlags";
import { applyCandidates, applyReplan, applyVerdict, createPanel, nextStep, type PanelCandidate, type PanelClip, type PanelState, type RoleBrief } from "./panel";
import { FIXES_FOR_KIND, MEASURABLE_KINDS, promptHash, type BrainstormIdea, type CrewRole, type Distraction, type FixId, type MenuItem, type ObjectionKind, type PanelDepth } from "./roles";
import { drawnHookText, SIMPLE_BANDS, simpleScore } from "./simplicity";

/*
 * --- crew --- The role eval: which of the crew's roles earn their cost (docs/agents/CREW-EVAL.md). A corpus of clips with known
 * answers – clean template plans, and the same plans with one defect planted by a named transform – is reviewed by the panel
 * (panel.ts, the app's own state machine) in several runs that each ask a different set of roles, the rest left to the rules:
 *
 *  - rules: no model at all (the clarity check and the rules' verdict);
 *  - skeptic / viewer / reviewer: that role alone, the rules deciding in the reviewer's place where it is off;
 *  - quick: the default depth (the skeptic, the reviewer where something is in doubt);
 *  - all: Thorough (the viewer, the skeptic and the reviewer on every clip);
 *  - brainstormer: open requests pitched by the brainstormer against the ideas the code picks (ideasByCode).
 *
 * Nine defect classes, three planted clips each (DEFECTS). Four fail exactly one gate (the rules catch them for free, before
 * any model); five pass every gate and leave only a judgement – or a measure below a gate's line – to the roles. A clean
 * clip passes every gate and crosses no evidence threshold beyond its template's own (softClean: a template that keeps a HUD
 * beside its hook has two messages on screen at once, which confirms a tooBusy objection by the evidence check's line while
 * Simple stays 80 or more), so an objection to it is a false alarm – a confirmed one included, and the tables say how many.
 *
 * What counts:
 *  - caught: a planted clip that does not reach the keeps as it came – dropped, or changed by a fix that answers its defect
 *    (FIXES_FOR_KIND of the defect's kinds; a rule fix included). The recall of a run is caught / planted.
 *  - flagged: the defect was named – its gate fails, an objection of its kinds stands, the viewer misread a clip whose defect
 *    is about what it shows, or a distraction it names is confirmed by a measure.
 *  - clean dropped, clean objected to (a standing objection), clean misread: the false alarms.
 *  - fixes: those the reviewer asked for, kept by the rules, reverted, refused, or needing the seed search – which the eval does
 *    not run (it has no planner), so such a fix is reverted and the panel's rule drops a clip whose major objection stands.
 *  - calls per kept clip: the model calls of a run (retries included) over the clips it kept.
 *
 * The answers come from a function (the model): scripted ones in tests/crewEval.test.ts, recorded ones of a real run (a
 * model's replies kept by their brief's prompt hash, tests/fixtures/crew/runs/). The fixtures are generated, never edited by
 * hand (scripts/crew-fixtures.mjs, the studio kit's planner and plantDefect here). Pure and deterministic: no clock, no
 * randomness; the same answers give the same numbers.
 */

// --- crew ---

export const DEFECT_CLASSES = ["slowStart", "payoffCut", "hookUntrue", "textUnreadable", "payoffLate", "tooBusy", "hookMismatch", "twoIdeas", "endingConfusing"] as const;
export type DefectClass = (typeof DEFECT_CLASSES)[number];

export interface DefectSpec {
  id: DefectClass;
  /** The gate it fails (and no other), or null: it passes every gate. */
  gate: GateId | null;
  /** The objection kinds that name it. */
  kinds: readonly ObjectionKind[];
  /** A viewer's misread names it (it is about what the clip seems to show). */
  misread: boolean;
  /** The viewer's distractions that name it when a measure confirms them. */
  distractions: readonly Distraction[];
  /** What was planted, in a line. */
  what: string;
}

export const DEFECTS: Readonly<Record<DefectClass, DefectSpec>> = {
  slowStart: { id: "slowStart", gate: "G1", kinds: ["slowStart"], misread: false, distractions: ["nothingHappens"], what: "the first impact moved past 1 s (1.4, 1.9 or 2.4 s)" },
  payoffCut: { id: "payoffCut", gate: "G2", kinds: ["payoffMissing", "payoffLate"], misread: false, distractions: [], what: "the clip ends 0.6-1.4 s before its payoff" },
  hookUntrue: { id: "hookUntrue", gate: "G4", kinds: ["hookUntrue", "hookMismatch"], misread: false, distractions: [], what: "a number in the hook the run does not have" },
  textUnreadable: { id: "textUnreadable", gate: "G5", kinds: ["textUnreadable", "tooBusy"], misread: false, distractions: ["text"], what: "a hook of 9-10 words" },
  payoffLate: { id: "payoffLate", gate: null, kinds: ["payoffLate"], misread: false, distractions: [], what: "the clip trimmed so the payoff lands at 92-95 % (gate G2 still passes)" },
  tooBusy: { id: "tooBusy", gate: null, kinds: ["tooBusy"], misread: false, distractions: ["effects", "background", "shake", "hud", "text"], what: "charged effects on until Simple is 60-78 (gate G6 still passes)" },
  hookMismatch: { id: "hookMismatch", gate: null, kinds: ["hookMismatch"], misread: true, distractions: [], what: "the hook of another format (no number, so gate G4 passes)" },
  twoIdeas: { id: "twoIdeas", gate: null, kinds: ["twoIdeas", "hookMismatch"], misread: true, distractions: [], what: "a hook asking two different questions" },
  endingConfusing: { id: "endingConfusing", gate: null, kinds: ["endingConfusing", "hookMismatch", "twoIdeas"], misread: true, distractions: [], what: "the payoff's words of another format" },
};

/** Planted clips per class. */
export const PLANTED_PER_CLASS = 3;
/** Clean clips in the corpus. */
export const CLEAN_COUNT = 40;

/** The fixes that answer a defect (an applied one counts as catching it). */
export function remediesOf(defect: DefectClass): FixId[] {
  return [...new Set(DEFECTS[defect].kinds.flatMap((k) => FIXES_FOR_KIND[k]))];
}

/* ------------------------------------------------------------------ the fixtures */

export interface EvalFixture {
  /** f01…: in an order that says nothing of the defect. */
  id: string;
  /** The clean plan it comes from: "<template>#<plan seed>". */
  source: string;
  defect: DefectClass | null;
  /** Which of the class's transforms (0-2); 0 for a clean clip. */
  variant: number;
  clip: CrewClip;
}

/** A fixture as its file keeps it: the settings as the keys that differ from the mode's defaults (the mode always). */
export interface EvalFixtureJson {
  id: string;
  source: string;
  defect: DefectClass | null;
  variant: number;
  clip: Omit<CrewClip, "settings" | "captions" | "topText" | "bottomText"> & { settingsPatch: Record<string, unknown> };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function fixtureToJson(f: EvalFixture): EvalFixtureJson {
  const { settings, captions, topText, bottomText, ...rest } = f.clip;
  if (!sameJson(captions, settings.captions) || topText !== settings.topText || bottomText !== settings.bottomText) throw new Error(`${f.id}: the clip's captions and edge texts must be its settings' own`);
  const base = defaultSettings(settings.mode) as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = { mode: settings.mode };
  for (const [k, v] of Object.entries(settings)) if (k !== "mode" && !sameJson(v, base[k])) patch[k] = v;
  return { id: f.id, source: f.source, defect: f.defect, variant: f.variant, clip: { ...rest, settingsPatch: patch } };
}

export function fixtureOfJson(json: EvalFixtureJson): EvalFixture {
  const { settingsPatch, ...rest } = json.clip;
  const mode = settingsPatch.mode as SimulatorSettings["mode"];
  const settings = { ...defaultSettings(mode), ...settingsPatch } as SimulatorSettings;
  return { id: json.id, source: json.source, defect: json.defect, variant: json.variant, clip: { ...rest, settings, captions: settings.captions, topText: settings.topText, bottomText: settings.bottomText } as CrewClip };
}

/** A corpus file's text (tests/fixtures/crew/clean.json or planted.json): indented JSON, a final newline. */
export function corpusFileText(kind: "clean" | "planted", fixtures: readonly EvalFixture[]): string {
  const about =
    kind === "clean"
      ? "The role eval's clean clips (docs/agents/CREW-EVAL.md): template plans that pass every gate and cross no evidence threshold. Generated by npm run crew:fixtures (scripts/crew-fixtures.mjs): never edit by hand."
      : "The role eval's planted clips (docs/agents/CREW-EVAL.md): clean plans with one defect planted by a named transform (lib/crew/eval.ts plantDefect). Generated by npm run crew:fixtures (scripts/crew-fixtures.mjs): never edit by hand.";
  return `${JSON.stringify({ v: 1, about, fixtures: fixtures.map(fixtureToJson) }, null, 1)}\n`;
}

/** A corpus's fingerprint (its two files' texts): a recorded run names the corpus it answered. */
export function corpusHash(cleanText: string, plantedText: string): string {
  return promptHash(`${cleanText}\n${plantedText}`);
}

/* ------------------------------------------------------------------ clean and planted */

const MEASURE_PROBE = { id: "o1" as const, evidence: ["gates" as const], severity: "major" as const, note: "" };

/** The measurable objection kinds this clip's facts confirm (what an objection of that kind would be marked). */
export function confirmedKinds(clip: CrewClip): ObjectionKind[] {
  const clarity = clarityOf(clip);
  return MEASURABLE_KINDS.filter((kind) => markObjection({ ...MEASURE_PROBE, kind }, clip, clarity).mark === "confirmed");
}

/**
 * The measurable kinds a clip's facts confirm beyond its template's own: tooBusy confirmed by the two-messages-at-once line
 * alone (a HUD the template keeps beside its hook, Simple still 80 or more) is the template's, not a defect of the clip.
 */
export function confirmedBeyondTemplate(clip: CrewClip): ObjectionKind[] {
  const busy = simpleScore(clip).score < SIMPLE_BANDS.simple;
  return confirmedKinds(clip).filter((k) => k !== "tooBusy" || busy);
}

/**
 * A clean clip: every gate passes and no evidence threshold is crossed beyond its template's own (confirmedBeyondTemplate):
 * an objection to it is an opinion, or the two-at-once line on a template that keeps a HUD beside its hook.
 */
export function softClean(clip: CrewClip): boolean {
  return clarityOf(clip).pass && confirmedBeyondTemplate(clip).length === 0;
}

/** Whether a clip carries a class's defect exactly: its gate alone fails, or (a soft class) every gate passes and only its own measure, if any, is crossed. */
export function defectHolds(clip: CrewClip, defect: DefectClass): boolean {
  const spec = DEFECTS[defect];
  const failed = failedGates(clarityOf(clip));
  if (spec.gate) return sameJson(failed, [spec.gate]);
  if (failed.length) return false;
  const confirmed = confirmedBeyondTemplate(clip);
  if (defect === "payoffLate") return sameJson(confirmed, ["payoffLate"]);
  if (defect === "tooBusy") return sameJson(confirmed, ["tooBusy"]);
  return confirmed.length === 0;
}

const EPS = 1e-9;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const rescored = (clip: CrewClip): CrewClip => ({ ...clip, playbook: playbookOf(clip) });
const withCaptions = (clip: CrewClip, captions: Caption[], roles: CaptionRole[]): CrewClip => ({ ...clip, captions, captionRoles: roles, settings: { ...clip.settings, captions } });

/** The end of the hook's window (its captions' own, or the middle of the playbook's 2-3 s). */
function hookEnd(clip: CrewClip): number {
  const hooks = clip.captions.filter((_, i) => clip.captionRoles[i] === "hook");
  if (!hooks.length || hooks.some((c) => !(c.end > c.start))) return (HOOK_SEC.min + HOOK_SEC.max) / 2;
  return Math.max(...hooks.map((c) => c.end));
}

/** The clip with these hook lines in place of its own (and its words saying so: the meta hook is the drawn one). */
function withHookLines(clip: CrewClip, lines: Caption[], text: string): CrewClip {
  const at = clip.captionRoles.indexOf("hook");
  const keep = clip.captionRoles.map((r) => r !== "hook");
  const rest = clip.captions.filter((_, i) => keep[i]);
  const restRoles = clip.captionRoles.filter((_, i) => keep[i]);
  const insert = at < 0 ? 0 : clip.captionRoles.slice(0, at).filter((r) => r !== "hook").length;
  const captions = [...rest.slice(0, insert), ...lines, ...rest.slice(insert)];
  const roles: CaptionRole[] = [...restRoles.slice(0, insert), ...lines.map(() => "hook" as const), ...restRoles.slice(insert)];
  return rescored({ ...withCaptions(clip, captions, roles), hook: text });
}

/** A new hook drawn as the planner draws one (two lines at most), or null when it does not fit. */
function withHook(clip: CrewClip, text: string): CrewClip | null {
  const lines = hookCaptionsOf(text, hookEnd(clip), clip.timing.recordingDuration, hookEdgeOf(clip)); // --- templates --- (where the hook was)
  if (captionWordsOf(lines, lines.map((_, k) => k)) !== text) return null;
  return withHookLines(clip, lines, text);
}

/** A long hook in two lines of the clip's own hook style (the planner would never draw it: it is the defect). */
function withLongHook(clip: CrewClip, text: string): CrewClip | null {
  const first = clip.captions.find((_, i) => clip.captionRoles[i] === "hook");
  if (!first) return null;
  const words = text.split(" ");
  const half = Math.ceil(words.length / 2);
  const end = hookEnd(clip);
  const read = [words.slice(0, half).join(" "), words.slice(half).join(" ")].map((t) => ({ ...first, text: t, start: 0, end }));
  // --- templates --- (a hook at the bottom of the square: its lines stacked upwards, its lowest first, read as before)
  return withHookLines(clip, first.position === "bottom" ? read.slice().reverse() : read, text);
}

/** The payoff's words replaced by these (its first caption kept, in its place and style). */
function withPayoffText(clip: CrewClip, text: string): CrewClip | null {
  const at = clip.captionRoles.indexOf("payoff");
  if (at < 0) return null;
  const captions: Caption[] = [];
  const roles: CaptionRole[] = [];
  clip.captions.forEach((c, i) => {
    if (clip.captionRoles[i] !== "payoff") {
      captions.push(c);
      roles.push(clip.captionRoles[i]);
    } else if (i === at) {
      captions.push({ ...c, text });
      roles.push("payoff");
    }
  });
  return rescored({ ...withCaptions(clip, captions, roles), payoff: { ...clip.payoff, text } });
}

/** Another format's hook for each claim (hookMismatch): no number, so the words' gate cannot see it. */
const OTHER_HOOKS: Readonly<Record<Claim, readonly string[]>> = {
  out: ["Can it fill the whole ring?", "Which colour wins?", "Watch them all line up."],
  break: ["Will it get out?", "Pick a colour.", "Can it fill the screen?"],
  full: ["Will it get out?", "Which colour wins?", "Every hit cracks it."],
  count: ["Will it break the wall?", "Which colour wins?", "Watch them line up."],
  winner: ["Will it get out?", "Can it fill the ring?", "Wait for them to line up."],
  hit: ["Will it get out?", "Which colour wins?", "Can it fill the ring?"],
  inSync: ["Which one wins the race?", "Will it get out?", "Every hit cracks it."],
  beat: ["Will it get out?", "Which colour wins?", "Can it fill the ring?"],
  picture: ["Will it get out?", "Which colour wins?", "Every hit cracks it."],
  gameRule: ["Will it get out?", "Which colour wins?", "Can it fill the ring?"],
};

/** Two questions in one hook (twoIdeas): the clip's own and another format's. */
const TWO_IDEA_HOOKS: Readonly<Record<Claim, readonly string[]>> = {
  out: ["Will it escape, or fill up?", "Get out, or break the wall?", "Escape first, or who wins?"],
  break: ["Break it, or get out?", "Will it break, or fill up?", "Smash it, or count the balls?"],
  full: ["Fill it, or break out?", "Will it fill, or escape?", "Fill up, or who wins?"],
  count: ["How many, and who escapes?", "Count them, or watch it fill?", "More balls, or a winner?"],
  winner: ["Who wins, and how many escape?", "Who wins, or does it fill?", "A winner, or a jailbreak?"],
  hit: ["Hit it, or get out?", "Bullseye, or who wins?", "Hit it, or fill it?"],
  inSync: ["Line up, or race to win?", "In sync, or who escapes?", "Watch them sync, or count?"],
  beat: ["Hear the song, or count balls?", "On the beat, or who wins?", "Music, or an escape?"],
  picture: ["A picture, or an escape?", "Guess the drawing, or who wins?", "Draw it, or break it?"],
  gameRule: ["Win the game, or escape?", "Who wins, or does it fill?", "Play it, or break it?"],
};

/** Another format's payoff words (endingConfusing). */
const OTHER_PAYOFFS: Readonly<Record<Claim, readonly string[]>> = {
  out: ["FULL!", "Smashed.", "In sync!"],
  break: ["ESCAPED!", "FULL!", "In sync!"],
  full: ["ESCAPED!", "Smashed.", "Bullseye!"],
  count: ["Smashed.", "In sync!", "Bullseye!"],
  winner: ["FULL!", "Smashed.", "In sync!"],
  hit: ["ESCAPED!", "FULL!", "In sync!"],
  inSync: ["ESCAPED!", "Smashed.", "FULL!"],
  beat: ["ESCAPED!", "Smashed.", "FULL!"],
  picture: ["ESCAPED!", "Smashed.", "FULL!"],
  gameRule: ["ESCAPED!", "Smashed.", "FULL!"],
};

/** A hook with a number for each claim (hookUntrue, when the clip's own hook has none): {n} is a number the run does not have. */
const NUMBER_HOOKS: Readonly<Record<Claim, string>> = {
  out: "It escapes in {n} seconds.",
  break: "It takes {n} hits to break.",
  full: "It fills the ring in {n} seconds.",
  count: "One ball becomes {n}.",
  winner: "{n} balls, one winner.",
  hit: "It hits in {n} bounces.",
  inSync: "They line up after {n} swings.",
  beat: "{n} notes, one song.",
  picture: "{n} lines, one picture.",
  gameRule: "{n} tries to win.",
};

/** Long hooks (textUnreadable): nine and ten words, no number. */
const LONG_HOOKS = ["Wait for it, because what happens next is wild", "You will not believe how this one ends, honestly", "Keep watching until the very end to see what happens"];

/** Numbers the clip's facts do not have (of a fixed list, in its order). */
function untrueNumbers(clip: CrewClip): number[] {
  const facts = factNumbersOf(clip);
  return [7, 9, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43].filter((n) => !facts.some((f) => Math.abs(f - n) < 1e-6));
}

/** The look settings tooBusy turns on, in order (never the cinematic camera: it moves the run). */
function busyLook(s: SimulatorSettings): Partial<SimulatorSettings>[] {
  const ring = hasRingWalls(s.mode);
  const steps: Partial<SimulatorSettings>[] = [];
  if (ring) steps.push({ showWallGlow: true }, { rainbowWalls: true }, { screenShake: 0.3 });
  steps.push({ reactiveBackground: true }, { showTrails: true, colorTrail: true }, { particleStyle: "confetti" }, { rainbowBall: true }, { showTrails: true, trailThickness: 2 });
  if (ring) steps.push({ wallBreakStyle: "confetti" });
  steps.push({ loopHud: true });
  return steps;
}

/** The Simple score tooBusy brings a clip to, by variant: at most 78, 72 or 66 (never below 60: gate G6 passes). */
const BUSY_TARGETS = [78, 72, 66];
/** The payoff's share of the clip payoffLate trims it to, by variant (gate G2's line is 97 %). */
const LATE_POSITIONS = [0.93, 0.94, 0.95];

/**
 * A clean clip with one defect planted (see DEFECTS), variant 0-2; null when the transform does not apply to it (a
 * cliffhanger for a payoff transform, a hook that does not fit, a look that cannot be brought into the band). The caller keeps
 * only clips where defectHolds().
 */
export function plantDefect(clip: CrewClip, defect: DefectClass, variant: number): CrewClip | null {
  const k = Math.max(0, Math.min(2, Math.round(variant)));
  const claim: Claim = clip.claim ?? "out";
  const resolved = clip.ending === "resolved";
  const p = clip.payoff;
  switch (defect) {
    case "slowStart": {
      const sec = 1.4 + 0.5 * k;
      return rescored({ ...clip, timing: { ...clip.timing, firstImpactSec: sec }, run: clip.run ? { ...clip.run, firstImpactSec: sec } : null });
    }
    case "payoffCut": {
      if (!resolved || p.atSec === null) return null;
      const clipSec = r3(p.atSec - (0.6 + 0.4 * k));
      if (!(clipSec > 0)) return null;
      return rescored({ ...clip, timing: { ...clip.timing, clipSec }, payoff: { ...p, position: r3(p.atSec / clipSec) } });
    }
    case "payoffLate": {
      if (!resolved || p.atSec === null) return null;
      for (let j = k; j >= 0; j--) {
        const clipSec = r3(p.atSec / LATE_POSITIONS[j]);
        if (clipSec - p.atSec >= 0.85 - EPS) return rescored({ ...clip, timing: { ...clip.timing, clipSec }, payoff: { ...p, position: r3(p.atSec / clipSec) } });
      }
      return null;
    }
    case "hookUntrue": {
      // (the clip's own hook with its number changed, or a numbered hook of its claim)
      const own = drawnHookText(clip);
      const n = untrueNumbers(clip)[k];
      if (n === undefined) return null;
      return withHook(clip, numbersIn(own).length ? own.replace(/\d+(?:[.,]\d+)?/, String(n)) : NUMBER_HOOKS[claim].replace("{n}", String(n)));
    }
    case "textUnreadable":
      return withLongHook(clip, LONG_HOOKS[k]);
    case "tooBusy": {
      let s = clip;
      for (const step of busyLook(clip.settings).slice(k)) {
        const next: CrewClip = { ...s, settings: { ...s.settings, ...step } };
        const score = simpleScore(next).score;
        if (score < SIMPLE_BANDS.aBitBusy) continue;
        s = next;
        if (score <= BUSY_TARGETS[k]) return rescored(s);
      }
      return null;
    }
    case "hookMismatch":
      return withHook(clip, OTHER_HOOKS[claim][k]);
    case "twoIdeas":
      return withHook(clip, TWO_IDEA_HOOKS[claim][k]);
    case "endingConfusing":
      return resolved ? withPayoffText(clip, OTHER_PAYOFFS[claim][k]) : null;
  }
}

/* ------------------------------------------------------------------ the runs */

export const EVAL_CONFIG_IDS = ["rules", "skeptic", "viewer", "reviewer", "quick", "all"] as const;
export type EvalConfigId = (typeof EVAL_CONFIG_IDS)[number];

export interface EvalConfig {
  id: EvalConfigId;
  depth: PanelDepth;
  /** The roles this run leaves to the rules (panel.ts PanelInput.off). */
  off: readonly CrewRole[];
  /** Who is asked, in words (the table's). */
  asks: string;
}

export const EVAL_CONFIGS: readonly EvalConfig[] = [
  { id: "rules", depth: "rules", off: [], asks: "no model: the rules alone" },
  { id: "skeptic", depth: "quick", off: ["reviewer", "producer"], asks: "the skeptic; the rules decide" },
  { id: "viewer", depth: "thorough", off: ["skeptic", "reviewer", "producer"], asks: "the viewer; the rules decide" },
  { id: "reviewer", depth: "thorough", off: ["skeptic", "viewer", "producer"], asks: "the reviewer alone" },
  { id: "quick", depth: "quick", off: ["producer"], asks: "Quick: the skeptic, the reviewer where in doubt" },
  { id: "all", depth: "thorough", off: ["producer"], asks: "Thorough: the viewer, the skeptic, the reviewer" },
];

/** The order the briefs are asked in: the cold viewer first (before any intent dossier is read), the skeptic next. */
export const EVAL_ASK_ORDER: readonly EvalConfigId[] = ["viewer", "skeptic", "quick", "all", "reviewer"];

/** One brief the eval needs answered. */
export interface EvalAsk {
  /** The run that asks it first (the same brief in another run is the same answer). */
  config: EvalConfigId | "brainstormer";
  /** The fixture id, or the request's id for the brainstormer ("r1"…). */
  item: string;
  role: CrewRole;
  /** The panel's clip the call is about (the fixture id), null for the brainstormer. */
  clipId: string | null;
  brief: RoleBrief;
  attempt: number;
  errors: string[];
}

/** The model of an eval: a brief in, its reply out; undefined when no answer is known yet (the run stops there). */
export type EvalAnswer = (ask: EvalAsk) => unknown;

/** A panel of one fixture in one run, driven as far as the answers go. */
export function runEvalPanel(f: EvalFixture, config: EvalConfig, answer: EvalAnswer): { state: PanelState; missing: EvalAsk | null } {
  let state = createPanel({ stage: "pre", depth: config.depth, wanted: 1, candidates: [{ id: f.id, clip: f.clip, post: null }], who: "claude", off: config.off, digest: null });
  for (let guard = 0; guard < 200; guard++) {
    const { state: s, step } = nextStep(state);
    state = s;
    if (step.type === "done") return { state, missing: null };
    if (step.type === "replan") {
      // (the eval runs no planner: a fix that needs the seed search is reverted)
      state = applyReplan(state, step.clipId, null);
      continue;
    }
    if (step.type === "plan") {
      state = applyCandidates(state, []);
      continue;
    }
    const ask: EvalAsk = { config: config.id, item: f.id, role: step.role, clipId: step.clipId, brief: step.brief, attempt: step.attempt, errors: step.errors };
    const reply = answer(ask);
    if (reply === undefined) return { state, missing: ask };
    state = applyVerdict(state, { role: step.role, clipId: step.clipId, reply }).state;
  }
  return { state, missing: null };
}

/** What one fixture came to in one run. */
export interface EvalOutcome {
  fixture: string;
  defect: DefectClass | null;
  verdict: PanelClip["verdict"];
  dropWhy: string | null;
  /** The fixes applied to it (the rule fix and the fix round's, when the rules kept it). */
  applied: FixId[];
  caught: boolean;
  flagged: boolean;
  /** Its standing objections. */
  standing: ObjectionKind[];
  misread: boolean;
  fix: { asked: boolean; state: string | null; needsSearch: boolean };
  calls: number;
  retries: number;
}

export function outcomeOf(f: EvalFixture, state: PanelState): EvalOutcome {
  const c = state.clips.find((x) => x.id === f.id)!;
  const applied: FixId[] = [...c.ruleFix, ...(c.fix?.state === "applied" && c.original !== null ? c.fix.actions.map((a) => a.action) : [])];
  const standing = c.marks.filter((m) => m.stands).map((m) => m.kind);
  const misread = c.makesSense !== null && c.makesSense !== "yes";
  const spec = f.defect ? DEFECTS[f.defect] : null;
  const caught = !!spec && (c.verdict === "drop" || applied.some((a) => remediesOf(spec.id).includes(a)));
  const flagged =
    !!spec &&
    ((spec.gate !== null && failedGates(c.clarity).includes(spec.gate)) || standing.some((k) => spec.kinds.includes(k)) || (spec.misread && misread) || c.distractions.some((d) => spec.distractions.includes(d)));
  const asked = c.reviewer.source === "model" && c.reviewer.result?.verdict === "fix";
  return {
    fixture: f.id,
    defect: f.defect,
    verdict: c.verdict,
    dropWhy: c.dropWhy,
    applied,
    caught,
    flagged,
    standing,
    misread,
    fix: { asked, state: asked ? c.fix?.state ?? null : null, needsSearch: asked && !!c.fix?.compiled?.finder },
    calls: state.spent.calls,
    retries: state.spent.retries,
  };
}

export interface ClassCount {
  n: number;
  caught: number;
  flagged: number;
}

export interface ConfigMetrics {
  config: EvalConfigId;
  asks: string;
  planted: ClassCount;
  byClass: Record<DefectClass, ClassCount>;
  clean: { n: number; dropped: number; objected: number; misread: number; changed: number };
  fixes: { asked: number; applied: number; reverted: number; refused: number; needsSearch: number };
  calls: number;
  retries: number;
  kept: number;
  /** Model calls over kept clips (null: none kept). */
  callsPerKept: number | null;
  /** Briefs the run still needs (an unfinished run's numbers are partial). */
  missing: number;
}

export interface BrainstormMetrics {
  config: "rules" | "brainstormer";
  requests: number;
  ideas: number;
  /** Ideas that became candidates (a ready template on its mode). */
  planned: number;
  /** Candidates that pass every gate before a render. */
  passing: number;
  /** Mean distinct formats a request. */
  formats: number;
  calls: number;
  retries: number;
  /** Replies valid on their first try. */
  firstTry: number;
  missing: number;
}

export interface EvalMetrics {
  v: 1;
  corpus: { clean: number; planted: number; classes: number };
  configs: ConfigMetrics[];
  brainstorm: BrainstormMetrics[];
}

const emptyCount = (): ClassCount => ({ n: 0, caught: 0, flagged: 0 });

/** The numbers of one run over the corpus (see the header). */
export function configMetrics(fixtures: readonly EvalFixture[], config: EvalConfig, answer: EvalAnswer): { metrics: ConfigMetrics; missing: EvalAsk[] } {
  const byClass = Object.fromEntries(DEFECT_CLASSES.map((d) => [d, emptyCount()])) as Record<DefectClass, ClassCount>;
  const planted = emptyCount();
  const clean = { n: 0, dropped: 0, objected: 0, misread: 0, changed: 0 };
  const fixes = { asked: 0, applied: 0, reverted: 0, refused: 0, needsSearch: 0 };
  let calls = 0;
  let retries = 0;
  let kept = 0;
  const missing: EvalAsk[] = [];
  for (const f of fixtures) {
    const run = runEvalPanel(f, config, answer);
    if (run.missing) {
      missing.push(run.missing);
      continue;
    }
    const o = outcomeOf(f, run.state);
    calls += o.calls;
    retries += o.retries;
    if (o.verdict === "keep" || o.verdict === "fix") kept++;
    if (o.fix.asked) {
      fixes.asked++;
      if (o.fix.needsSearch) fixes.needsSearch++;
      if (o.fix.state === "applied" && o.applied.length > 0) fixes.applied++;
      else if (o.fix.state === "refused") fixes.refused++;
      else fixes.reverted++;
    }
    if (o.defect) {
      for (const c of [planted, byClass[o.defect]]) {
        c.n++;
        if (o.caught) c.caught++;
        if (o.flagged) c.flagged++;
      }
    } else {
      clean.n++;
      if (o.verdict === "drop") clean.dropped++;
      if (o.standing.length) clean.objected++;
      if (o.misread) clean.misread++;
      if (o.applied.length) clean.changed++;
    }
  }
  return {
    metrics: { config: config.id, asks: config.asks, planted, byClass, clean, fixes, calls, retries, kept, callsPerKept: kept ? Math.round((100 * calls) / kept) / 100 : null, missing: missing.length },
    missing,
  };
}

/* ------------------------------------------------------------------ the brainstormer */

/** The open requests the brainstormer is measured on (its ideas against the code's). */
export const EVAL_REQUESTS: readonly { id: string; text: string }[] = [
  { id: "r1", text: "Three satisfying clips for Reels" },
  { id: "r2", text: "Something calm with music" },
  { id: "r3", text: "Clips where something gets out or breaks" },
];

/** The planner of the brainstorm runs: the ideas in, the candidates out (the studio kit plans them; a test scripts it). */
export type EvalPlanner = (ideas: readonly BrainstormIdea[]) => readonly PanelCandidate[];

/** One open request in one brainstorm run, to the end of its plan step (no clip role is asked). */
export function runEvalBrainstorm(request: { id: string; text: string }, config: "rules" | "brainstormer", menu: readonly MenuItem[], plan: EvalPlanner, answer: EvalAnswer): { state: PanelState; missing: EvalAsk | null } {
  let state = createPanel({ stage: "pre", depth: "quick", wanted: 3, request: { text: request.text, open: true, platform: "reels", locale: "en" }, menu, who: "claude", off: config === "rules" ? ["brainstormer", "skeptic", "viewer", "reviewer", "producer"] : ["skeptic", "viewer", "reviewer", "producer"], digest: null });
  for (let guard = 0; guard < 200; guard++) {
    const { state: s, step } = nextStep(state);
    state = s;
    if (step.type === "done") return { state, missing: null };
    if (step.type === "plan") {
      state = applyCandidates(state, plan(step.ideas));
      continue;
    }
    if (step.type === "replan") {
      state = applyReplan(state, step.clipId, null);
      continue;
    }
    const ask: EvalAsk = { config: "brainstormer", item: request.id, role: step.role, clipId: step.clipId, brief: step.brief, attempt: step.attempt, errors: step.errors };
    const reply = answer(ask);
    if (reply === undefined) return { state, missing: ask };
    state = applyVerdict(state, { role: step.role, clipId: step.clipId, reply }).state;
  }
  return { state, missing: null };
}

export function brainstormMetrics(config: "rules" | "brainstormer", menu: readonly MenuItem[], plan: EvalPlanner, answer: EvalAnswer): { metrics: BrainstormMetrics; missing: EvalAsk[] } {
  const m: BrainstormMetrics = { config, requests: 0, ideas: 0, planned: 0, passing: 0, formats: 0, calls: 0, retries: 0, firstTry: 0, missing: 0 };
  const missing: EvalAsk[] = [];
  let formats = 0;
  for (const r of EVAL_REQUESTS) {
    const run = runEvalBrainstorm(r, config, menu, plan, answer);
    if (run.missing) {
      missing.push(run.missing);
      continue;
    }
    const s = run.state;
    m.requests++;
    m.ideas += s.ideas.length;
    m.planned += s.clips.length;
    m.passing += s.clips.filter((c) => c.clarity.pass).length;
    formats += new Set(s.ideas.map((i) => menu.find((x) => x.template === i.template)?.format ?? i.template)).size;
    m.calls += s.spent.calls;
    m.retries += s.spent.retries;
    if (s.brainstormer.source === "model" && s.brainstormer.attempts === 1) m.firstTry++;
  }
  m.formats = m.requests ? Math.round((100 * formats) / m.requests) / 100 : 0;
  m.missing = missing.length;
  return { metrics: m, missing };
}

/** Every run's numbers over the corpus (and the brainstorm requests when a menu and a planner are given), and what is still unanswered. */
export function evalMetrics(fixtures: readonly EvalFixture[], answer: EvalAnswer, brainstorm?: { menu: readonly MenuItem[]; plan: EvalPlanner }): { metrics: EvalMetrics; missing: EvalAsk[] } {
  const missing: EvalAsk[] = [];
  const configs = EVAL_CONFIGS.map((c) => {
    const r = configMetrics(fixtures, c, answer);
    missing.push(...r.missing);
    return r.metrics;
  });
  const bs: BrainstormMetrics[] = [];
  if (brainstorm) {
    for (const config of ["rules", "brainstormer"] as const) {
      const r = brainstormMetrics(config, brainstorm.menu, brainstorm.plan, answer);
      missing.push(...r.missing);
      bs.push(r.metrics);
    }
  }
  return { metrics: { v: 1, corpus: { clean: fixtures.filter((f) => !f.defect).length, planted: fixtures.filter((f) => f.defect).length, classes: DEFECT_CLASSES.length }, configs, brainstorm: bs }, missing };
}

/** The next brief to answer: the first missing one in the ask order (the cold viewer's first, the brainstormer's last). */
export function nextEvalAsk(fixtures: readonly EvalFixture[], answer: EvalAnswer, brainstorm?: { menu: readonly MenuItem[]; plan: EvalPlanner }): EvalAsk | null {
  for (const id of EVAL_ASK_ORDER) {
    const config = EVAL_CONFIGS.find((c) => c.id === id)!;
    for (const f of fixtures) {
      const run = runEvalPanel(f, config, answer);
      if (run.missing) return run.missing;
    }
  }
  if (brainstorm) for (const r of EVAL_REQUESTS) {
    const run = runEvalBrainstorm(r, "brainstormer", brainstorm.menu, brainstorm.plan, answer);
    if (run.missing) return run.missing;
  }
  return null;
}

/** Whether a reply to this brief is taken (the panel's own checks, at the point the eval asked it), and why not. */
export function checkEvalReply(fixtures: readonly EvalFixture[], ask: EvalAsk, reply: unknown, answer: EvalAnswer, brainstorm?: { menu: readonly MenuItem[]; plan: EvalPlanner }): { ok: boolean; errors: string[] } {
  let run: { state: PanelState; missing: EvalAsk | null } | null = null;
  if (ask.config === "brainstormer") {
    const request = EVAL_REQUESTS.find((r) => r.id === ask.item);
    if (request && brainstorm) run = runEvalBrainstorm(request, "brainstormer", brainstorm.menu, brainstorm.plan, answer);
  } else {
    const f = fixtures.find((x) => x.id === ask.item);
    const config = EVAL_CONFIGS.find((c) => c.id === ask.config);
    if (f && config) run = runEvalPanel(f, config, answer);
  }
  if (!run?.missing || run.missing.brief.hash !== ask.brief.hash || run.missing.attempt !== ask.attempt) return { ok: false, errors: ["the eval does not ask this brief now"] };
  const r = applyVerdict(run.state, { role: ask.role, clipId: ask.clipId, reply });
  return { ok: r.ok, errors: r.errors };
}

/* ------------------------------------------------------------------ recorded answers */

/** A real run's answers: each brief's replies in order (a refused reply, then the retry), by the brief's prompt hash. */
export interface EvalRecordAnswer {
  role: CrewRole;
  item: string;
  replies: unknown[];
}

/** The model of a recorded run: the reply for this brief and attempt, undefined when there is none yet. */
export function recordedAnswer(answers: Readonly<Record<string, EvalRecordAnswer>>): EvalAnswer {
  return (ask) => {
    const a = Object.hasOwn(answers, ask.brief.hash) ? answers[ask.brief.hash] : undefined;
    return a && a.role === ask.role ? a.replies[ask.attempt - 1] : undefined;
  };
}

/* ------------------------------------------------------------------ the tables */

const share = (a: number, n: number) => (n ? `${a} of ${n} (${Math.round((100 * a) / n)}%)` : "none");

/** The results as Markdown tables (docs/agents/CREW-EVAL.md's generated sections). */
export function renderEvalTables(m: EvalMetrics): string {
  const lines: string[] = [];
  lines.push(`Corpus: ${m.corpus.clean} clean clips, ${m.corpus.planted} planted (${m.corpus.classes} classes).`, "");
  lines.push("| Run | Who is asked | Defects caught | Defects named | Clean dropped | Clean changed | Clean objected to | Clean misread | Fixes kept / asked | Calls per kept clip |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of m.configs) {
    const fixes = c.fixes.asked ? `${c.fixes.applied} / ${c.fixes.asked}${c.fixes.needsSearch ? ` (${c.fixes.needsSearch} need the seed search)` : ""}` : "none asked";
    lines.push(`| ${c.config} | ${c.asks} | ${share(c.planted.caught, c.planted.n)} | ${share(c.planted.flagged, c.planted.n)} | ${share(c.clean.dropped, c.clean.n)} | ${share(c.clean.changed, c.clean.n)} | ${share(c.clean.objected, c.clean.n)} | ${share(c.clean.misread, c.clean.n)} | ${fixes} | ${c.callsPerKept === null ? "-" : c.callsPerKept}${c.missing ? ` (${c.missing} briefs unanswered)` : ""} |`);
  }
  lines.push("", `| Defect (${PLANTED_PER_CLASS} each) | Gate | ${m.configs.map((c) => c.config).join(" | ")} |`);
  lines.push(`| --- | --- | ${m.configs.map(() => "---").join(" | ")} |`);
  for (const d of DEFECT_CLASSES) lines.push(`| ${d} | ${DEFECTS[d].gate ?? "none"} | ${m.configs.map((c) => `${c.byClass[d].caught}/${c.byClass[d].n}`).join(" | ")} |`);
  if (m.brainstorm.length) {
    lines.push("", "| Ideas for open requests | Requests | Ideas | Planned | Pass every gate | Formats a request | Calls | Valid first time |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const b of m.brainstorm) lines.push(`| ${b.config === "rules" ? "by code (ideasByCode)" : "the brainstormer"} | ${b.requests} | ${b.ideas} | ${b.planned} | ${share(b.passing, b.planned)} | ${b.formats} | ${b.calls} | ${b.config === "rules" ? "-" : `${b.firstTry} of ${b.requests}`}${b.missing ? ` (${b.missing} unanswered)` : ""} |`);
  }
  return lines.join("\n");
}

// --- end crew ---
