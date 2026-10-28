import type { ScoreReason } from "@/lib/bot/planner";
import { BOT_FRAME, FIRST_IMPACT_SEC, TOP_HUD_MODES } from "@/lib/bot/playbook";
import { botRecipeById } from "@/lib/bot/templates";
import { captionBoxAt, edgeTextBox, inSafeZone } from "@/lib/bot/planner";
import { bucketsFitting, claimSeen, factNumbersOf, numbersIn, runWinnerOf, shownSecOf, type CrewClip } from "./clip";
import { drawnHookText, overlaysOf, sameWords, simpleScore, SIMPLE_BANDS, wordCount, type SimpleOptions, type SimpleScore } from "./simplicity";

/*
 * --- crew --- The clarity check: the rules that decide, for free and before any model is asked, whether a clip is clear and
 * simple enough to be worth a model's time. They are the authority on everything measurable: a model may fix or drop a clip
 * that fails a gate, never keep it. Gates (each with a message key and its values, like the Playbook score's ScoreReason):
 *
 *  G1 motionEarly – the first impact within 1 s of the plan's run; after a render, the measured first motion within 1.5 s.
 *  G2 payoffLands – resolved: the payoff between 60 % and 97 % of the clip with at least 0.8 s shown after it; cliffhanger: the
 *     cut 0–3 s before the payoff and a closing question on screen at the end.
 *  G3 oneIdea – one mode (no switch since the plan), one hook message, one ending (the payoff's words or a closing question,
 *     never both).
 *  G4 wordsMatchPicture – the drawn hook is the hook the clip's words say it has; every number in it is one of the clip's
 *     facts; a winner the payoff names is the run's; the recipe (or the template) that wrote the hook plays this mode; the
 *     run shows the claim.
 *  G5 readable – every caption and the Top / Bottom Text inside the safe zone whenever it is on screen, at most 2 lines a
 *     message, at most 7 words in the hook, at least 1.2 s a line, no Top Text over an arena's scoreboard band.
 *  G6 notTooBusy – Simple at least 60 (simplicity.ts).
 *  G7 lengthFits – the clip's length inside a bucket its platform takes.
 *  G8 rendered (after a render only) – at most 2 % lagged frames, the watermark on every free run.
 *
 * Pure and deterministic: it reads the clip (clip.ts) and nothing else.
 */

// --- crew ---

export const GATES = [
  { id: "G1", name: "motionEarly" },
  { id: "G2", name: "payoffLands" },
  { id: "G3", name: "oneIdea" },
  { id: "G4", name: "wordsMatchPicture" },
  { id: "G5", name: "readable" },
  { id: "G6", name: "notTooBusy" },
  { id: "G7", name: "lengthFits" },
  { id: "G8", name: "rendered" },
] as const;
export type GateId = (typeof GATES)[number]["id"];
export type GateName = (typeof GATES)[number]["name"];

/** The gates' numbers (see the header). */
export const CLARITY = {
  firstImpactSec: FIRST_IMPACT_SEC,
  measuredFirstMotionSec: 1.5,
  payoffFrom: 0.6,
  payoffTo: 0.97,
  shownAfterPayoffSec: 0.8,
  cutGapMaxSec: 3,
  hookWordsMax: 7,
  linesMax: 2,
  secPerLine: 1.2,
  simpleMin: SIMPLE_BANDS.aBitBusy,
  laggedShareMax: 0.02,
} as const;

export interface Gate {
  id: GateId;
  name: GateName;
  ok: boolean;
  /** Its verdict's key (`<name><Verdict>`), the first problem found when it fails. */
  key: string;
  values: Record<string, string | number>;
  /** Every problem found (the keys), the first one first; empty when it passes. */
  problems: string[];
}

export interface Clarity {
  /** Every gate passes. */
  pass: boolean;
  /** Before a render, or after one (G8 then, and the measured first motion). */
  stage: "pre" | "post";
  gates: Gate[];
  simple: SimpleScore;
  playbook: { score: number; reasons: ScoreReason[] };
}

const EPS = 1e-9;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => Math.round(100 * n);

function gate(id: GateId, problems: { key: string; values?: Record<string, string | number> }[], okKey: string, okValues: Record<string, string | number> = {}): Gate {
  const name = GATES.find((g) => g.id === id)!.name;
  if (problems.length === 0) return { id, name, ok: true, key: `${name}${okKey}`, values: okValues, problems: [] };
  return { id, name, ok: false, key: `${name}${problems[0].key}`, values: problems[0].values ?? {}, problems: problems.map((p) => `${name}${p.key}`) };
}

/** G1: motion in the first second (the plan's run), or within 1.5 s of the render. */
function motionGate(clip: CrewClip, post: boolean): Gate {
  const impact = clip.timing.firstImpactSec;
  if (post && clip.measured?.features) {
    const first = clip.measured.features.firstMotionSec;
    if (first === null) return gate("G1", [{ key: "None" }], "Ok");
    if (first > CLARITY.measuredFirstMotionSec + EPS) return gate("G1", [{ key: "MeasuredLate", values: { sec: r1(first) } }], "Ok");
    return gate("G1", [], "Ok", { sec: r1(first) });
  }
  if (impact === null) return gate("G1", [{ key: "Unknown" }], "Ok");
  if (impact > CLARITY.firstImpactSec + EPS) return gate("G1", [{ key: "Late", values: { sec: r1(impact) } }], "Ok");
  return gate("G1", [], "Ok", { sec: r1(impact) });
}

/** Whether a question caption is on screen at the clip's end. */
function questionAtEnd(clip: CrewClip): boolean {
  const end = clip.timing.clipSec;
  return clip.captions.some((c, i) => clip.captionRoles[i] === "question" && c.start < end - EPS && (c.end <= c.start || c.end >= end - 1e-6));
}

/** G2: a payoff that lands and is shown (resolved), or a cut just before it with a question (cliffhanger). */
function payoffGate(clip: CrewClip): Gate {
  const { atSec, position, cutGapSec } = clip.payoff;
  const clipSec = clip.timing.clipSec;
  if (clip.ending === "cliffhanger") {
    const problems: { key: string; values?: Record<string, string | number> }[] = [];
    if (atSec === null || cutGapSec === null) problems.push({ key: "Never" });
    else if (cutGapSec < -EPS || cutGapSec > CLARITY.cutGapMaxSec + EPS) problems.push({ key: "CutFar", values: { gap: r1(cutGapSec) } });
    if (!questionAtEnd(clip)) problems.push({ key: "NoQuestion" });
    return gate("G2", problems, "Cut", cutGapSec !== null ? { gap: r1(cutGapSec) } : {});
  }
  if (atSec === null || position === null) return gate("G2", [{ key: "Missing" }], "Ok");
  const problems: { key: string; values?: Record<string, string | number> }[] = [];
  if (position < CLARITY.payoffFrom - EPS) problems.push({ key: "Early", values: { pct: pct(position), sec: r1(atSec) } });
  else if (position > CLARITY.payoffTo + EPS) problems.push({ key: "Late", values: { pct: pct(position), sec: r1(atSec) } });
  if (clipSec - atSec < CLARITY.shownAfterPayoffSec - EPS) problems.push({ key: "NotShown", values: { after: r1(Math.max(0, clipSec - atSec)) } });
  return gate("G2", problems, "Ok", { pct: pct(position), sec: r1(atSec) });
}

/** G3: one idea – no mode switch, one hook message, one ending's words. */
function oneIdeaGate(clip: CrewClip): Gate {
  const problems: { key: string; values?: Record<string, string | number> }[] = [];
  if (clip.settings.mode !== clip.mode) problems.push({ key: "ModeSwitched", values: { from: clip.mode, to: clip.settings.mode } });
  const overlays = overlaysOf(clip);
  const hooks = overlays.filter((o) => o.kind === "hook").length;
  if (hooks > 1) problems.push({ key: "TwoHooks", values: { count: hooks } });
  const payoffs = overlays.filter((o) => o.kind === "payoff").length;
  const questions = overlays.filter((o) => o.kind === "question").length;
  // (two endings: the payoff's words and a closing question, or two questions; more texts after the hook cost Simple points)
  if (questions > 1 || (payoffs > 0 && questions > 0)) problems.push({ key: "TwoEndings", values: { payoffs, questions } });
  return gate("G3", problems, "Ok");
}

/** G4: the words match the picture. */
function wordsGate(clip: CrewClip): Gate {
  const problems: { key: string; values?: Record<string, string | number> }[] = [];
  const drawn = drawnHookText(clip);
  if (clip.hook !== null && clip.hook.trim() && !sameWords(clip.hook, drawn)) problems.push({ key: "HookNotDrawn" });
  const facts = factNumbersOf(clip);
  const untrue = numbersIn(drawn).filter((n) => !facts.some((f) => Math.abs(f - n) < 1e-6));
  if (untrue.length) problems.push({ key: "HookNumber", values: { number: untrue[0] } });
  // a winner the payoff names is the run's
  const runWinner = runWinnerOf(clip);
  const names = clip.settings.teams.map((t) => t.name).filter((n) => n.trim().length > 0);
  const payoffWords = clip.captions.filter((_, i) => clip.captionRoles[i] === "payoff").map((c) => c.text).join(" ");
  const named = names.filter((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(payoffWords));
  if (clip.run) {
    if (clip.payoff.winner && runWinner !== null && clip.payoff.winner !== runWinner) problems.push({ key: "WrongWinner", values: { said: clip.payoff.winner, run: runWinner } });
    else if (clip.payoff.winner && runWinner === null) problems.push({ key: "NoWinner", values: { said: clip.payoff.winner } });
    const other = named.find((n) => n !== runWinner);
    if (other && !problems.some((p) => p.key === "WrongWinner" || p.key === "NoWinner")) problems.push({ key: runWinner === null ? "NoWinner" : "WrongWinner", values: runWinner === null ? { said: other } : { said: other, run: runWinner } });
  }
  // the hook's author plays this mode
  const recipe = botRecipeById(clip.recipe);
  if (clip.recipe && recipe && !recipe.modes.includes(clip.mode)) problems.push({ key: "HookElsewhere", values: { mode: clip.mode } });
  const seen = claimSeen(clip);
  if (clip.claim && seen === false) problems.push({ key: "ClaimUnseen", values: { claim: clip.claim } });
  if (clip.claim && seen === null) problems.push({ key: "ClaimUnmeasured", values: { claim: clip.claim } });
  return gate("G4", problems, "Ok");
}

/** The times to look at the text: every caption's entry (a little after it) and the start. */
function lookTimes(clip: CrewClip): number[] {
  const end = clip.timing.clipSec;
  const times = new Set<number>([0.1]);
  for (const c of clip.captions) if (c.start < end) times.add(Math.max(0, c.start) + 0.1);
  return [...times].filter((t) => t < end).sort((a, b) => a - b);
}

/** G5: readable – safe zone, lines, hook words, time per line, no Top Text over a scoreboard band. */
function readableGate(clip: CrewClip): Gate {
  const problems: { key: string; values?: Record<string, string | number> }[] = [];
  const topText = !!clip.topText.trim();
  const topHud = TOP_HUD_MODES.includes(clip.settings.mode);
  const unsafe = new Set<number>();
  for (const t of lookTimes(clip)) {
    clip.captions.forEach((_, i) => {
      if (unsafe.has(i)) return;
      const box = captionBoxAt(clip.captions, i, t, BOT_FRAME, topText, topHud);
      if (box && !inSafeZone(box)) unsafe.add(i);
    });
  }
  if (unsafe.size) problems.push({ key: "Unsafe", values: { caption: [...unsafe][0] + 1, count: unsafe.size } });
  for (const [text, where] of [[clip.topText, "top"], [clip.bottomText, "bottom"]] as const) {
    if (text.trim() && !inSafeZone(edgeTextBox(text.trim(), where, BOT_FRAME, clip.settings.textSize))) problems.push({ key: "EdgeUnsafe", values: { where } });
  }
  if (topText && topHud) problems.push({ key: "OverBand" });
  const groups = overlaysOf(clip).filter((o) => o.captions && o.captions.length > 0);
  const long = groups.find((g) => g.lines > CLARITY.linesMax);
  if (long) problems.push({ key: "Lines", values: { lines: long.lines } });
  const words = wordCount(drawnHookText(clip));
  if (words > CLARITY.hookWordsMax) problems.push({ key: "HookWords", values: { words } });
  const hurried = groups.find((g) => (g.end - g.start) / g.lines < CLARITY.secPerLine - EPS);
  if (hurried) problems.push({ key: "Hurried", values: { sec: r1((hurried.end - hurried.start) / hurried.lines), lines: hurried.lines } });
  return gate("G5", problems, "Ok");
}

/** G7: the length is one the platform takes. */
function lengthGate(clip: CrewClip): Gate {
  const sec = shownSecOf(clip);
  const fits = bucketsFitting(clip.platform, sec);
  return fits.length ? gate("G7", [], "Ok", { sec: r1(sec), bucket: fits[0] }) : gate("G7", [{ key: "Out", values: { sec: r1(sec), platform: clip.platform } }], "Ok");
}

/** G8: the render kept up and carries the watermark (a free run). */
function renderGate(clip: CrewClip): Gate {
  const m = clip.measured!;
  const problems: { key: string; values?: Record<string, string | number> }[] = [];
  if (m.laggedFrames !== null && m.frames !== null && m.frames > 0 && m.laggedFrames / m.frames > CLARITY.laggedShareMax + EPS) problems.push({ key: "Lagged", values: { pct: r1((100 * m.laggedFrames) / m.frames) } });
  if (m.free && m.watermarked !== true) problems.push({ key: m.watermarked === false ? "NoWatermark" : "WatermarkUnknown" });
  return gate("G8", problems, "Ok");
}

/** The clarity check of a clip (see the header). After a render (`clip.measured`) it adds G8 and reads the measured motion. */
export function clarityOf(clip: CrewClip, options: SimpleOptions = {}): Clarity {
  const post = !!clip.measured;
  const simple = simpleScore(clip, options);
  const gates: Gate[] = [
    motionGate(clip, post),
    payoffGate(clip),
    oneIdeaGate(clip),
    wordsGate(clip),
    readableGate(clip),
    simple.score >= CLARITY.simpleMin ? gate("G6", [], "Ok", { simple: simple.score }) : gate("G6", [{ key: "Busy", values: { simple: simple.score } }], "Ok"),
    lengthGate(clip),
  ];
  if (post) gates.push(renderGate(clip));
  return { pass: gates.every((g) => g.ok), stage: post ? "post" : "pre", gates, simple, playbook: clip.playbook };
}

/** The ids of the gates a clarity check failed. */
export function failedGates(clarity: Pick<Clarity, "gates">): GateId[] {
  return clarity.gates.filter((g) => !g.ok).map((g) => g.id);
}
// --- end crew ---
