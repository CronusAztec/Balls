import type { ScoreReason } from "@/lib/bot/planner";
import { BOT_FRAME, FIRST_IMPACT_SEC, TOP_HUD_MODES } from "@/lib/bot/playbook";
import { botRecipeById, CHORD_WORDS } from "@/lib/bot/templates";
import { actionCoverSec, bannerCoverSec, captionBoxAt, captionsAtEdge, captionWordsOf, edgeTextBox, inSafeZone, squareBoxOf } from "@/lib/bot/planner";
import { actionSampleSec, bannerUnder, isActionTrack } from "@/lib/bot/actionTrack"; // --- crew --- (AI studio step 3) the modes' banners
import { MOMENT_AFTER_SEC, MOMENT_BEFORE_SEC, STILL_MOTION_SHARE } from "@/lib/insights/score";
import { countdownSeconds, formatClock, progressFraction } from "@/lib/captions";
import { bucketsFitting, claimSeen, countsIn, factNumbersOf, measuredFirstImpactSec, namesOf, payoffHoldSec, payoffUndone, runWinnerOf, shownSecOf, type CrewClip } from "./clip";
import { drawnHookText, endBannersShown, overlaysOf, sameWords, simpleScore, SIMPLE_BANDS, wordCount, type SimpleOptions, type SimpleScore } from "./simplicity";
import { hudsOn } from "./hudFlags"; // --- crew --- (studio round 1, 9) a mode's own words at the top centre

/*
 * --- crew --- The clarity check: the rules that decide, for free and before any model is asked, whether a clip is clear and
 * simple enough to be worth a model's time. They are the authority on everything measurable: a model may fix or drop a clip
 * that fails a gate, never keep it. Gates (each with a message key and its values, like the Playbook score's ScoreReason):
 *
 *  G1 motionEarly – the first impact within 1 s of the plan's run; after a render, the measured first impact within 1.5 s: the
 *     export's first motion or its first sound, the earlier (the Playbook score's own reading of the file, clip.ts).
 *  G2 payoffLands – resolved: the payoff between 60 % and 97 % of the clip with at least 0.8 s shown after it, and – where
 *     the run's payoff moment is known (RunFacts.moment, lib/insights/score.ts payoffMomentSync) – a payoff that happens: a
 *     sound at it where the clip promises one (a beat, or words that name a chord), a chord where the words name one (the
 *     mode's own: an accented event, Pendulum Wave's every bob at once – a cluster of a few notes is not the chord promised),
 *     the only one of its size after a hook that promises it (no accented event as large plays after the hook, before or
 *     after the payoff), and a sound or motion at it whatever it claims (never still and quiet: the balls at a quarter of the
 *     run's median motion or less, with no sound – or, for a beat, only a few lone notes: fewer than the run's usual moment
 *     plays, none accented, no chord), and – a clip that ends without words (neither the payoff's nor, --- crew --- AI studio
 *     step 4, the mode's own end banner) – no quiet end longer than 1.5 s after it (no sound, the balls still: dead air), nor –
 *     --- crew --- (studio2 review round 2, 12) words or not – a payoff that plays no sound with no sound after it for more than
 *     1.5 s to the clip's end (the conveyor's ALL OUT!, silent, then silence under it); ---
 *     crew --- (studio round 1, 10 and 11) the payoff's state held at least 0.8 s (Perfect Fit's full box bursts a flash after it
 *     fills), and a beat's payoff that stands out from the run before it (beatStandsOut: busier than its busiest moment, a larger
 *     chord, or an accent none before matched);
 *     cliffhanger: the cut 0–3 s before the payoff and a closing question on screen at the end.
 *  G3 oneIdea – one mode (no switch since the plan), one hook message, one ending (the payoff's words or a closing question,
 *     never both).
 *  G4 wordsMatchPicture – the drawn hook is the hook the clip's words say it has; every number in it is one of the clip's
 *     facts; a winner the payoff names is the run's; the recipe (or the template) that wrote the hook plays this mode; the
 *     run shows the claim; a counter of the clip's seconds (a bar, a timer) reaches its end on screen – 100 % or 0:00, within
 *     a second of it – rather than leaving at "84 %" (the studio's second review round, 22); --- crew --- (studio2 review round
 *     2, 6) and the payoff's words leave before the run undoes what they name (clip.ts payoffUndone: Colour Sort's remix, --- crew
 *     --- 7: Brick Smash's rebuild); --- crew --- (studio2 review round 2, 9) and a beat clip's run plays its notes slowly enough
 *     to hear each as a note, at most 40 a second at its usual moment (beatWashPerSec).
 *  G5 readable – every caption and the Top / Bottom Text inside the safe zone whenever it is on screen, at most 2 lines a
 *     message, at most 7 words in the hook, at least 1.2 s a line, no Top Text over an arena's scoreboard band, and – --- crew
 *     --- (AI studio step 3) – no caption over a banner of the mode's own text while it shows (the run's action track:
 *     Glass Smash's "STAGE n", the Journey's stage banner), which would stack two texts; --- crew --- (studio round 1, 9) no Top
 *     Text on the line where the mode writes its own words for the whole run (Spiral Glass's question while its overlay shows);
 *     --- crew --- (studio2 review round 2, 8) and no hook the mode's own text pushed onto the action, hiding the moving balls on
 *     more than half its samples (hookPushedOverAction: Tier Climb's merges).
 *  G6 notTooBusy – Simple at least 60 (simplicity.ts).
 *  G7 lengthFits – the clip's length inside a bucket its platform takes.
 *  G8 rendered (after a render only) – at most 2 % lagged frames, the watermark on every free run, drawing an address a viewer
 *     can open (a public domain: never localhost, an IP or a reserved name – a clip of a local build would advertise one).
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
  /**
   * --- crew --- A still payoff: the balls' motion at it at most this share of the run's median (lib/insights/score.ts
   * STILL_MOTION_SHARE), with no sound or – the studio's second review round, 21 – only a few lone notes.
   */
  stillShareMax: STILL_MOTION_SHARE,
  /** --- crew --- (review round 2, 21) The longest quiet end (no sound, the balls still) a clip that ends without words may have. */
  quietTailMaxSec: 1.5,
  /** --- crew --- (review round 2, 22) A bar or a timer leaves the screen at most this long before its end (100 %, 0:00). */
  counterEndSec: 1,
  /**
   * --- crew --- (studio round 1, 11) A beat's payoff busier than the run before it plays at least this many times the sound events
   * of the run's busiest window of the same length (a quarter more): the payoff's window takes in one frame more than the windows
   * before it, which alone lets a run whose sound never changes – a field of colliding orbs at its ceiling of notes a frame – read
   * a few more events there (552 against 540, measured).
   */
  beatStandOutShare: 1.25,
  /**
   * --- crew --- (studio2 review round 2, 9) The most notes a second a beat clip's run may play before its payoff (the median moment's,
   * PayoffMoment.soundsMedian over its window) for its bounces to be heard as notes, a glissando's pace. Measured on the beat runs a
   * viewer hears note by note: Ball Drop's peg cascade 8–23 a second (its looped rain 20–32), the Sound Vortex's rings 19, Collision
   * Playground's ten orbs 13–15. Past it the notes run together into one texture – its 140 orbs played the sound's ceiling, 720 a
   * second (the render measured 644), under "Every bounce is a note."
   */
  beatNotesPerSecMax: 40,
} as const;

/** --- templates --- The indices of a clip's captions of one role, in the list's order. */
const rolesAt = (clip: Pick<CrewClip, "captions" | "captionRoles">, role: string): number[] => clip.captions.map((_, i) => (clip.captionRoles[i] === role ? i : -1)).filter((i) => i >= 0);

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
  /** Before a render, or after one (G8 then, and the measured first impact: motion or sound). */
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

/** G1: motion in the first second (the plan's run), or a first impact within 1.5 s of the render (its motion or its sound). */
function motionGate(clip: CrewClip, post: boolean): Gate {
  const impact = clip.timing.firstImpactSec;
  if (post && clip.measured?.features) {
    const first = measuredFirstImpactSec(clip.measured.features);
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
  else {
    // --- crew --- (studio round 1, 10) the payoff's state held as long as a payoff is shown: Perfect Fit's full box bursts a flash after
    // it fills, seconds before the clip ends (clip.ts payoffHoldSec), as Paint's fill ended its run in the recorder's 0.5 s
    const held = payoffHoldSec(clip);
    if (held !== null && held < CLARITY.shownAfterPayoffSec - EPS) problems.push({ key: "Brief", values: { held: r1(held) } });
  }
  problems.push(...momentProblems(clip, atSec));
  return gate("G2", problems, "Ok", { pct: pct(position), sec: r1(atSec) });
}

/** --- crew --- (review round 2, 20) When a clip's hook leaves the screen (s): its latest line's end, the clip's end for one that stays. */
function hookEndSecOf(clip: Pick<CrewClip, "captions" | "captionRoles" | "timing">): number {
  const hooks = rolesAt(clip, "hook").map((i) => clip.captions[i]);
  if (hooks.length === 0) return 0;
  return Math.max(...hooks.map((c) => (c.end > c.start ? c.end : clip.timing.clipSec)));
}

/**
 * --- crew --- What the run does at a resolved payoff, against what the clip promises (the run's moment around the payoff the
 * clip times; none known, or read around another second: nothing to judge by). Unheard: a beat, or words that name a chord,
 * and not one sound there. NoChord: words that name a chord, and no chord the mode plays as one there – an accented event (a
 * Pendulum Wave sounding at its centre crossings has clusters of up to 7 of its 21 notes around the realignment and never the
 * chord). Outdone (the studio's second review round, 20): a hook that promises a chord, and an accented event as large as the
 * payoff's played after the hook, before or after it – the promised chord heard before it comes, or again after it (a
 * Pendulum Wave sounding at its turning points plays every bob at once at half a cycle too). Still: the balls' motion at most
 * a quarter of the run's median, and no sound or – review round 2, 21, a beat's payoff, which is heard – only lone notes,
 * fewer than the run's usual moment plays (its windows' median), none accented and no chord: Ball Drop's last note, one faint
 * tick over a board at rest, is no payoff (a payoff the picture carries – Power Layers' break, its banner and its shards –
 * may be drawn beyond the balls' motion, so only silence counts there). DeadTail (review round 2, 21): a clip that ends
 * without words (no payoff's words on screen at its end) and ends on a quiet stretch longer than 1.5 s after its payoff – no
 * sound, the balls still: dead air where nothing is left to read. --- crew --- (studio2 review round 2, 12) SilentEnd: a payoff
 * that plays no sound, after which the clip ends on more than 1.5 s with no sound at all, whatever moves and whatever words are
 * on screen (PayoffMoment.silentTailSec): its climax unheard, then nothing to hear (a clip that ends without words and still is
 * DeadTail's already).
 */
function momentProblems(clip: CrewClip, atSec: number): { key: string; values?: Record<string, string | number> }[] {
  const m = clip.run?.moment;
  if (!m || Math.abs(m.atSec - atSec) > 0.01) return [];
  const hook = drawnHookText(clip);
  const words = [hook, captionWordsOf(clip.captions, rolesAt(clip, "payoff"))].join(" ");
  const chordPromised = CHORD_WORDS.test(words);
  const out: { key: string; values?: Record<string, string | number> }[] = [];
  if (m.sounds === 0 && (clip.claim === "beat" || chordPromised)) out.push({ key: "Unheard", values: { sec: r1(atSec) } });
  else if (chordPromised && !m.accent) out.push({ key: "NoChord", values: { sec: r1(atSec), notes: m.chordMax } });
  else if (CHORD_WORDS.test(hook) && m.accent) {
    // --- crew --- (review round 2, 20) the promised chord, as large, after the hook and away from the payoff
    const hookEnd = hookEndSecOf(clip);
    const rival = (m.accents ?? []).find(([sec, notes]) => sec >= hookEnd - EPS && sec <= clip.timing.clipSec + EPS && notes >= m.chordMax);
    if (rival) out.push({ key: "Outdone", values: { sec: r1(rival[0]), notes: rival[1], payoffNotes: m.chordMax } });
  }
  // (a beat's payoff is heard, so a few lone notes are as quiet as none there: fewer than the run's usual moment, none
  // accented, no chord – a payoff the picture carries, a layer stack's break or an escape, may be drawn beyond the balls' motion,
  // so only silence counts there; a run without the windows' count, an older record, keeps the old reading: no sound at all)
  const quiet = m.sounds === 0 || (clip.claim === "beat" && !m.accent && m.chordMax <= 1 && typeof m.soundsMedian === "number" && m.sounds < m.soundsMedian);
  if (quiet && m.motion !== null && m.motionMedian !== null && m.motionMedian > 0 && m.motion <= CLARITY.stillShareMax * m.motionMedian + EPS) out.push({ key: "Still", values: { sec: r1(atSec), pct: pct(m.motion / m.motionMedian), sounds: m.sounds } });
  // --- crew --- (studio round 1, 11) a beat's payoff, heard and not still, that plays nothing the run had not played before it (an
  // older record, without the run's busiest window, keeps the old reading)
  else if (clip.claim === "beat" && m.sounds > 0 && typeof m.soundsMax === "number" && !beatStandsOut(m)) out.push({ key: "Plain", values: { sec: r1(atSec), sounds: m.sounds, most: m.soundsMax } });
  // --- crew --- (review round 2, 21) dead air at the end of a clip with no words left to read
  const end = clip.timing.clipSec;
  // (--- crew --- AI studio step 4: the mode's own end banner on screen at the end is words to read, as the payoff's are, where
  // it covers the quiet tail – one that comes after the silence, Ball Drop's SETTLED! in its last 0.5 s, leaves the dead air)
  const tailFrom = typeof m.quietTailSec === "number" ? end - m.quietTailSec + CLARITY.quietTailMaxSec : end;
  const wordsAtEnd = rolesAt(clip, "payoff").some((i) => clip.captions[i].start < end - EPS && (clip.captions[i].end <= clip.captions[i].start || clip.captions[i].end >= end - 1e-6)) || endBannersShown(clip).some((b) => b.end >= end - 1e-6 && b.start <= tailFrom + EPS);
  if (!wordsAtEnd && typeof m.quietTailSec === "number" && m.quietTailSec > CLARITY.quietTailMaxSec + EPS) out.push({ key: "DeadTail", values: { sec: r1(m.quietTailSec) } });
  // --- crew --- (studio2 review round 2, 12) a payoff that plays no sound, and a clip that ends on silence after it, words on screen or
  // not: the conveyor's ALL OUT! came in silent and its clip ended on 2.3 s of silence under it (watched and measured) – a banner is
  // words to read, but a climax a viewer with the sound on hears nothing at, then nothing more, is no payoff heard
  else if (m.sounds === 0 && typeof m.silentTailSec === "number" && m.silentTailSec > CLARITY.quietTailMaxSec + EPS) out.push({ key: "SilentEnd", values: { sec: r1(atSec), tail: r1(m.silentTailSec) } });
  return out;
}

/**
 * --- crew --- (studio round 1, 11) Whether a beat's payoff stands out from the run before it, as the format's "the drop or the last bar"
 * promises: a quarter more sound events than the run's busiest window of the same length before it (CLARITY.beatStandOutShare), a
 * chord larger than any it played before,
 * or an accented event no accent before it matched. A note of a phrase heard twice already (Beat Machines' 86 % note, the same bar
 * as at 2 s and 14 s), the steady rain of a looped Ball Drop or a field of colliding orbs plays nothing new there.
 */
export function beatStandsOut(m: Pick<NonNullable<NonNullable<CrewClip["run"]>["moment"]>, "atSec" | "sounds" | "chordMax" | "accent" | "accents" | "soundsMax" | "chordBefore">): boolean {
  if (typeof m.soundsMax === "number" && m.sounds > m.soundsMax && m.sounds >= CLARITY.beatStandOutShare * m.soundsMax - EPS) return true;
  if (m.chordMax >= 2 && m.chordMax > (m.chordBefore ?? 0)) return true;
  const before = (m.accents ?? []).filter(([sec]) => sec < m.atSec - MOMENT_BEFORE_SEC - EPS);
  return m.accent && !before.some(([, notes]) => notes >= m.chordMax);
}

/**
 * --- crew --- (studio2 review round 2, 9) The notes a second a beat clip's run plays at its usual moment before the payoff, where that is
 * more than a viewer hears as notes (CLARITY.beatNotesPerSecMax); null: not a beat clip, no moment read around its payoff, an older
 * record without the windows' count, or few enough. The moment's windows are MOMENT_BEFORE_SEC + MOMENT_AFTER_SEC long.
 */
export function beatWashPerSec(clip: Pick<CrewClip, "claim" | "run" | "payoff">): number | null {
  const m = clip.run?.moment;
  if (clip.claim !== "beat" || !m || clip.payoff.atSec === null || Math.abs(m.atSec - clip.payoff.atSec) > 0.01 || typeof m.soundsMedian !== "number") return null;
  const perSec = m.soundsMedian / (MOMENT_BEFORE_SEC + MOMENT_AFTER_SEC);
  return perSec > CLARITY.beatNotesPerSecMax + EPS ? perSec : null;
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

/**
 * --- crew --- (review round 2, 22) A counter of the clip's seconds that leaves the screen short of its end: what it reads as it
 * goes (a bar's share, a timer's time left), or null. A bar and a timer count to the recording's end (lib/captions.ts
 * progressFraction, countdownSeconds), so one taken off at the payoff stops at "84 %" or "0:04": a viewer told to wait for
 * 100 % never sees it. The wall counter counts the walls broken, not time: it may leave at any moment.
 */
export function counterCutReading(clip: Pick<CrewClip, "captions" | "settings" | "timing">): string | null {
  const total = clip.settings.recordingDuration;
  if (!(total > 0)) return null;
  for (const c of clip.captions) {
    if (c.type !== "progress" && c.type !== "countdown") continue;
    const until = Math.min(c.end > c.start ? c.end : Infinity, clip.timing.clipSec);
    if (c.start >= until - EPS) continue;
    if (total - until > CLARITY.counterEndSec + EPS) return c.type === "progress" ? `${Math.round(100 * progressFraction(total, until))}%` : formatClock(countdownSeconds(total, until));
  }
  return null;
}

/** G4: the words match the picture. */
function wordsGate(clip: CrewClip): Gate {
  const problems: { key: string; values?: Record<string, string | number> }[] = [];
  const drawn = drawnHookText(clip);
  if (clip.hook !== null && clip.hook.trim() && !sameWords(clip.hook, drawn)) problems.push({ key: "HookNotDrawn" });
  const facts = factNumbersOf(clip);
  // (--- crew --- studio round 1, 4: a number inside the clip's own names is no count, "Sub-Zero" and "Eleven" included)
  const untrue = countsIn(drawn, namesOf(clip)).filter((n) => !facts.some((f) => Math.abs(f - n) < 1e-6));
  if (untrue.length) problems.push({ key: "HookNumber", values: { number: untrue[0] } });
  // a winner the payoff names is the run's
  const runWinner = runWinnerOf(clip);
  const names = clip.settings.teams.map((t) => t.name).filter((n) => n.trim().length > 0);
  const payoffWords = captionWordsOf(clip.captions, rolesAt(clip, "payoff")); // --- templates --- (as a viewer reads them)
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
  // --- crew --- (studio2 review round 2, 9) a beat whose bounces are too many to hear as notes: the run's usual moment before the payoff
  // plays more than CLARITY.beatNotesPerSecMax a second (a run read without the windows' count, an older record, keeps the old reading)
  const wash = beatWashPerSec(clip);
  if (wash !== null) problems.push({ key: "BeatWash", values: { perSec: Math.round(wash) } });
  if (clip.claim && seen === null) problems.push({ key: "ClaimUnmeasured", values: { claim: clip.claim } });
  const cut = counterCutReading(clip); // --- crew --- (review round 2, 22)
  if (cut !== null) problems.push({ key: "CounterCut", values: { reads: cut } });
  // --- crew --- (studio2 review round 2, 6) the payoff's words still on screen once the run undoes what they name (clip.ts
  // payoffUndone: Colour Sort's remix mixing the balls again, "There it is. ✨" over them to the clip's end)
  const undone = payoffUndone(clip);
  if (undone !== null && rolesAt(clip, "payoff").some((i) => (clip.captions[i].end > clip.captions[i].start ? clip.captions[i].end : clip.timing.clipSec) > undone.sec + EPS)) problems.push({ key: "OverUndone", values: { sec: r1(undone.sec) } });
  return gate("G4", problems, "Ok");
}

/** The times to look at the text: every caption's entry (a little after it) and the start. */
function lookTimes(clip: CrewClip): number[] {
  const end = clip.timing.clipSec;
  const times = new Set<number>([0.1]);
  for (const c of clip.captions) if (c.start < end) times.add(Math.max(0, c.start) + 0.1);
  return [...times].filter((t) => t < end).sort((a, b) => a - b);
}

/**
 * --- crew --- (AI studio step 3) The first caption drawn over a banner of the mode's own text while that shows (the run's action
 * track, RunFacts.action.banners: Glass Smash's "STAGE n" under the template's hook, the studio's first known gap): the caption
 * (1-based) and the second, or null – none, or no run read.
 */
function captionOverBanner(clip: CrewClip, topText: boolean, topHud: boolean): { caption: number; sec: number } | null {
  const track = clip.run?.action;
  if (!track || !isActionTrack(track) || !track.banners) return null;
  for (let k = 0; k < track.samples.length; k++) {
    const t = actionSampleSec(track, k);
    if (t >= clip.timing.clipSec - EPS) break;
    for (let i = 0; i < clip.captions.length; i++) {
      const box = captionBoxAt(clip.captions, i, t, BOT_FRAME, topText, topHud);
      if (box && bannerUnder(track, k, squareBoxOf(box))) return { caption: i + 1, sec: r1(t) };
    }
  }
  return null;
}

/**
 * --- crew --- (studio2 review round 2, 8) A hook the mode's own text pushed onto the action: the mode draws a banner of its own at the
 * other edge of the square while the hook is up (ActionTrack.banners: Mode Lab's title block in the top left corner), so the Simple look
 * put the hook at this edge (planner.ts placeSimpleTexts), and here it hides the run's moving balls on more than half of its samples –
 * Tier Climb's "Matching orbs merge into a bigger one." over the bottom of its bowl, where the orbs merge into 3 and 4 behind it
 * (watched). Neither edge is clear there: the other one has the mode's text (and, at Tier Climb's top, the rain and its first merge).
 * The seconds it hides them, or null – no run read, no banner at the other edge, or half its samples or fewer (Glass Smash's hooks
 * under its STAGE banners hide its falling ball for 0.5–1 s of their 2: measured on every plan).
 */
export function hookPushedOverAction(clip: Pick<CrewClip, "run" | "captions" | "captionRoles" | "timing" | "topText" | "settings">): { sec: number } | null {
  const track = clip.run?.action;
  if (!track || !isActionTrack(track) || !track.banners) return null;
  const hook = rolesAt(clip, "hook");
  if (hook.length === 0) return null;
  const edge = clip.captions[hook[0]].position;
  if (edge !== "top" && edge !== "bottom") return null;
  const until = Math.min(hookEndSecOf(clip), clip.timing.clipSec);
  const topText = !!clip.topText.trim();
  const topHud = TOP_HUD_MODES.includes(clip.settings.mode);
  const other = captionsAtEdge(clip.captions, hook, edge === "top" ? "bottom" : "top");
  if (bannerCoverSec(other, hook, track, until, topText, topHud) <= EPS) return null;
  let samples = 0;
  while (actionSampleSec(track, samples) < until - 1e-9) samples++;
  const hidden = actionCoverSec(clip.captions, hook, track, until, topText, topHud);
  return samples > 0 && hidden > 0.5 * samples * track.stepSec + EPS ? { sec: r1(hidden) } : null;
}

/** G5: readable – safe zone, lines, hook words, time per line, no Top Text over a scoreboard band, no caption over a mode's banner. */
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
  // --- crew --- (studio round 1, 9) the Top Text on the line where the mode writes its own words (Spiral Glass's question while its
  // overlay shows): two texts drawn into one for the whole clip
  const ownTop = topText ? hudsOn(clip.settings).find((h) => h.topCentre) : undefined;
  if (ownTop) problems.push({ key: "OverModeText", values: { hud: ownTop.id } });
  const groups = overlaysOf(clip).filter((o) => o.captions && o.captions.length > 0);
  const long = groups.find((g) => g.lines > CLARITY.linesMax);
  if (long) problems.push({ key: "Lines", values: { lines: long.lines } });
  const words = wordCount(drawnHookText(clip));
  if (words > CLARITY.hookWordsMax) problems.push({ key: "HookWords", values: { words } });
  const hurried = groups.find((g) => (g.end - g.start) / g.lines < CLARITY.secPerLine - EPS);
  if (hurried) problems.push({ key: "Hurried", values: { sec: r1((hurried.end - hurried.start) / hurried.lines), lines: hurried.lines } });
  const banner = captionOverBanner(clip, topText, topHud); // --- crew --- (AI studio step 3)
  if (banner) problems.push({ key: "OverBanner", values: banner });
  const pushed = hookPushedOverAction(clip); // --- crew --- (studio2 review round 2, 8)
  if (pushed) problems.push({ key: "HookOverAction", values: pushed });
  return gate("G5", problems, "Ok");
}

/** G7: the length is one the platform takes. */
function lengthGate(clip: CrewClip): Gate {
  const sec = shownSecOf(clip);
  const fits = bucketsFitting(clip.platform, sec);
  return fits.length ? gate("G7", [], "Ok", { sec: r1(sec), bucket: fits[0] }) : gate("G7", [{ key: "Out", values: { sec: r1(sec), platform: clip.platform } }], "Ok");
}

/** The top-level names no viewer's address ends in (RFC 6761 and 2606, mDNS, home networks). */
const RESERVED_TLDS = new Set(["localhost", "local", "test", "invalid", "example", "internal", "lan", "home", "arpa"]);

/**
 * --- crew --- Whether a watermark's domain is an address a viewer can open: a host name of two labels or more with a
 * letters-only top level, no port, path or scheme, never localhost, an IP address or a reserved name ("localhost:3000",
 * "127.0.0.1", "studio.local" are not; "jumpingballslive.com" is).
 */
export function publicDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return false;
  const labels = d.split(".");
  if (labels.some((l) => !l || l.startsWith("-") || l.endsWith("-"))) return false;
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,}$/.test(tld) && !RESERVED_TLDS.has(tld) && !labels.includes("localhost");
}

/** G8: the render kept up and carries the watermark (a free run), with an address a viewer can open. */
function renderGate(clip: CrewClip): Gate {
  const m = clip.measured!;
  const problems: { key: string; values?: Record<string, string | number> }[] = [];
  if (m.laggedFrames !== null && m.frames !== null && m.frames > 0 && m.laggedFrames / m.frames > CLARITY.laggedShareMax + EPS) problems.push({ key: "Lagged", values: { pct: r1((100 * m.laggedFrames) / m.frames) } });
  if (m.free && m.watermarked !== true) problems.push({ key: m.watermarked === false ? "NoWatermark" : "WatermarkUnknown" });
  // --- crew --- a local build's watermark: the clip would advertise an address nobody can open
  else if (m.free && typeof m.watermarkDomain === "string" && !publicDomain(m.watermarkDomain)) problems.push({ key: "WatermarkLocal", values: { domain: m.watermarkDomain } });
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
