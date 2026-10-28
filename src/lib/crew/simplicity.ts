import type { Caption } from "@/lib/captions";
import type { SimulatorSettings } from "@/lib/settings";
import { ACTION_GAIN_SEC, actionHiddenAt, bottomEdgeFree, captionMessagesOf, captionsAtEdge, captionWordsOf, hasTopHud, type CaptionRole } from "@/lib/bot/planner";
import { actionSampleSec, isActionTrack } from "@/lib/bot/actionTrack"; // --- templates --- (where the run moves)
import { TRENDS } from "@/content/trends";
import { defaultKeptHuds, hasRingWalls, hudCounts, hudsOn } from "./hudFlags";
import { measuredFirstImpactSec, shownSecOf, type CrewClip } from "./clip";

/*
 * --- crew --- "Simple, not a lot of distractions", measured: the Simple score (0–100) of a clip and the overlay inventory it is
 * counted on. Computed from the settings and the caption timeline, before anything renders (two soft terms read a render's
 * measurement when there is one). The rules (docs/virality-playbook.md §5, "The Simple score"):
 *
 *  - Simple = 100 minus the deductions, rounded and kept within 0–100;
 *  - text at once: the most messages on screen at the same moment – a caption role group (a hook of two lines is one message),
 *    the Top and the Bottom Text, the loop HUD's title and its counter, a mode HUD's words, the name labels, the scoreboard,
 *    a TikTok cut's hook pill and address line: 1 costs 0, 2 cost 5, 3 cost 15, 4 or more cost 30;
 *  - the share of the clip with 2 or more messages: 20 × (share − 0.15), when above 0.15;
 *  - each persistent message (on screen for more than 80 % of the clip) beyond the first: 6;
 *  - the hook's words over 7: 2 each, 10 at most; a hook of more than 2 lines: 5;
 *  - a message said twice: 10 for an AI hook that differs from the drawn one, 6 for a cut's hook pill that differs from the
 *    clip's hook, 3 for a payoff line (two words or more) a hook line already says, 5 for a countdown caption next to a HUD
 *    that counts down;
 *  - effects (the ball's glow and a thin single-colour trail are free): wall glow 2, trails thicker than the template's 3, a
 *    colour-cycling trail 3, rainbow walls 4, a rainbow ball 3, a reactive background 5, screen shake 5 × min(1, shake / 0.3),
 *    the cinematic camera 3, multi-colour confetti bursts 2, a confetti (or "all") wall break 2 – the wall effects only where
 *    the mode has ring walls (hudFlags.ts RING_WALL_MODES);
 *  - HUDs: each mode HUD or badge flag that is on and that the clip does not keep: 5 (hudFlags.ts HUD_FLAGS; the ball names
 *    only past 4 names); a clip keeps, by default, the HUD that counts down when its countdown is the HUD's;
 *  - measured after a render (soft, tagged `measured`): mean motion above twice the trend summary's most viewed median 5,
 *    the first motion after 1.5 s 5 (the export's first impact, its first motion or first sound, as gate G1 reads it);
 *  - --- templates --- a text over the action, read on the run (RunFacts.action, where its balls move): 2 a second a text hides
 *    them for 1 s or more longer than it would at the square's other edge, 10 at most (textOverActionSec).
 * Not counted: the watermark badge, which is fixed and protected (the captions keep out of its corner through the safe zone).
 *
 * Monotonic: adding a caption, a HUD flag or an effect never raises the score – every term only grows with more on screen –
 * with two exceptions by design: the two duplicated-hook terms compare whole hooks, so a caption that completes the drawn hook
 * into the AI's own (or the cut's) hook removes that duplicate; and the text-over-the-action term weighs a text against the
 * other edge of the square, where another caption stacked there can change what it would hide. Bounded, deterministic, pure
 * (no clock, no randomness).
 */

// --- crew ---

/** The Simple score's weights (see the header). */
export const SIMPLE_WEIGHTS = {
  /** Deduction by the most messages at once: index = messages (4 and more: the last). */
  atOnce: [0, 0, 5, 15, 30],
  busyShareFree: 0.15,
  busyShare: 20,
  persistentShare: 0.8,
  persistent: 6,
  hookWordsFree: 7,
  hookWord: 2,
  hookWordsMax: 10,
  hookLinesFree: 2,
  hookLines: 5,
  aiHookDiffers: 10,
  cutHookDiffers: 6,
  payoffRepeatsHook: 3,
  countdownBesideHud: 5,
  wallGlow: 2,
  thickTrails: 3,
  colorTrail: 3,
  rainbowWalls: 4,
  rainbowBall: 3,
  reactiveBackground: 5,
  screenShake: 5,
  screenShakeFull: 0.3,
  cinematic: 3,
  burstParticles: 2,
  wallBreak: 2,
  hud: 5,
  measuredMotion: 5,
  measuredMotionFactor: 2,
  measuredFirstMotion: 5,
  measuredFirstMotionSec: 1.5,
  /** --- templates --- A second a text hides the run's moving balls where the square's other edge would not; at most the max. */
  textOverAction: 2,
  textOverActionMax: 10,
} as const;

/** The trail thickness a clip may have for free when its template names none (the settings' default). */
export const SIMPLE_TRAIL_THICKNESS = 0.8;

/** The bands: 80 or more "Simple", 60–79 "A bit busy", below 60 "Busy" (the clarity check's gate G6). */
export const SIMPLE_BANDS = { simple: 80, aBitBusy: 60 } as const;
export type SimpleBand = "simple" | "aBitBusy" | "busy";

export const SIMPLE_DEDUCTIONS = [
  "textAtOnce",
  "busyShare",
  "persistent",
  "hookWords",
  "hookLines",
  "aiHookDiffers",
  "cutHookDiffers",
  "payoffRepeatsHook",
  "countdownBesideHud",
  "wallGlow",
  "thickTrails",
  "colorTrail",
  "rainbowWalls",
  "rainbowBall",
  "reactiveBackground",
  "screenShake",
  "cinematic",
  "burstParticles",
  "wallBreak",
  "hud",
  "measuredMotion",
  "measuredFirstMotion",
  "textOverAction",
] as const;
export type SimpleDeductionId = (typeof SIMPLE_DEDUCTIONS)[number];

export interface SimpleDeduction {
  id: SimpleDeductionId;
  points: number;
  values: Record<string, string | number>;
  /** The setting that turns it off, where one does (an effect, a HUD flag). */
  key?: keyof SimulatorSettings & string;
  /** Read from a render's measurement (a soft term). */
  measured?: true;
}

export interface SimpleScore {
  score: number;
  band: SimpleBand;
  deductions: SimpleDeduction[];
}

export type OverlayKind = CaptionRole | "topText" | "bottomText" | "hud" | "nameLabel" | "cutHook" | "cutUrl" | "endCard";

/** One message on screen, in seconds of the clip as shown (a cut's: from its first frame). */
export interface Overlay {
  /** Stable within the clip: "hook@0", "topText", "hud:sbHud#0"… */
  id: string;
  kind: OverlayKind;
  start: number;
  end: number;
  /** What it says (a HUD's words in plain language). */
  words: string;
  /** Its lines (captions: one per caption of the group). */
  lines: number;
  /** The captions of its group (captions only). */
  captions?: number[];
  /** A HUD's id (hudFlags.ts HudOn.id). */
  hud?: string;
}

export interface SimpleOptions {
  /** The HUD flag ids the clip keeps (its template's); default: the HUD that counts down when the countdown is the HUD's. */
  keepHuds?: readonly string[];
  /** The trail thickness the template keeps for free (SIMPLE_TRAIL_THICKNESS). */
  trailThickness?: number;
  /** The mean motion of the most viewed (the trend summary's "motion" median): null leaves the term out. */
  motionRef?: number | null;
}

const EPS = 1e-9;
const round1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Text compared as a viewer reads it: case and spacing aside. */
export const sameWords = (a: string, b: string): boolean => normText(a) === normText(b);
function normText(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}
/** Letters and digits only, lower case (for "the payoff says what the hook said"). */
const bare = (text: string) => text.normalize("NFC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Words a reader counts: tokens with a letter or a digit (an emoji alone is no word). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The trend summary's mean motion of the most viewed (the default reference of the measured motion term). */
export function trendsMotionRef(): number | null {
  const n = TRENDS?.numbers.find((x) => x.trait === "motion");
  return n && typeof n.top === "number" && Number.isFinite(n.top) && n.top > 0 ? n.top : null;
}

/** The hook the clip draws: its hook captions' words, joined as scoreClip joins them; "" for none. */
export function drawnHookText(clip: Pick<CrewClip, "captions" | "captionRoles" | "timing">): string {
  // --- templates --- (in the order a viewer reads them: a hook at the bottom of the square is stacked upwards)
  return captionWordsOf(
    clip.captions,
    clip.captions.map((c, i) => (clip.captionRoles[i] === "hook" && c.start < clip.timing.clipSec ? i : -1)).filter((i) => i >= 0),
  );
}

/**
 * The messages on screen (the overlay inventory): the caption role groups, the Top and Bottom Text, the HUDs' words, the name
 * label, and a cut's hook pill, address line and end card – each with the seconds it is on screen in the clip as shown.
 */
export function overlaysOf(clip: CrewClip): Overlay[] {
  const out: Overlay[] = [];
  const clipSec = clip.timing.clipSec;
  const offset = clip.cut ? Math.max(0, clip.cut.startSec) : 0;
  const actionEnd = clip.cut ? Math.max(0, Math.min(clip.cut.lengthSec, clipSec - offset)) : clipSec;
  const shown = (start: number, end: number): [number, number] | null => {
    const a = Math.max(0, start - offset);
    const b = Math.min(actionEnd, end - offset);
    return b > a + EPS ? [a, b] : null;
  };
  // the caption role groups: the captions of one role on screen over the same window are one message
  const groups = new Map<string, Overlay>();
  clip.captions.forEach((c, i) => {
    const role: CaptionRole = clip.captionRoles[i] ?? "payoff";
    const end = c.end > c.start ? Math.min(c.end, clipSec) : clipSec;
    const window = shown(Math.max(0, c.start), end);
    if (!window) return;
    const key = `${role}|${c.position}|${window[0]}|${window[1]}`;
    const group = groups.get(key);
    if (group) {
      group.words = `${group.words} ${c.text}`.trim();
      group.lines++;
      group.captions!.push(i);
      return;
    }
    const overlay: Overlay = { id: `${role}@${r3(window[0])}`, kind: role, start: window[0], end: window[1], words: c.text.trim(), lines: 1, captions: [i] };
    groups.set(key, overlay);
    out.push(overlay);
  });
  // --- templates --- a message at the bottom of the square reads upwards (its first caption is its lowest line)
  for (const g of groups.values()) if (g.captions!.some((i) => clip.captions[i].position === "bottom")) g.words = captionWordsOf(clip.captions, g.captions!);
  const whole = shown(0, clipSec);
  if (whole) {
    if (clip.topText.trim()) out.push({ id: "topText", kind: "topText", start: whole[0], end: whole[1], words: clip.topText.trim(), lines: 1 });
    if (clip.bottomText.trim()) out.push({ id: "bottomText", kind: "bottomText", start: whole[0], end: whole[1], words: clip.bottomText.trim(), lines: 1 });
    for (const h of hudsOn(clip.settings)) for (let k = 0; k < h.texts; k++) out.push({ id: `hud:${h.id}#${k}`, kind: "hud", start: whole[0], end: whole[1], words: h.words, lines: 1, hud: h.id });
    if (clip.settings.nameLabel && clip.settings.ballName.trim()) out.push({ id: "nameLabel", kind: "nameLabel", start: whole[0], end: whole[1], words: clip.settings.ballName.trim(), lines: 1 });
  }
  if (clip.cut && actionEnd > EPS) {
    if (clip.cut.hook.trim()) out.push({ id: "cutHook", kind: "cutHook", start: 0, end: actionEnd, words: clip.cut.hook.trim(), lines: 1 });
    if (clip.cut.url.trim()) out.push({ id: "cutUrl", kind: "cutUrl", start: 0, end: actionEnd, words: clip.cut.url.trim(), lines: 1 });
  }
  if (clip.cut && clip.cut.cardSec > EPS) out.push({ id: "endCard", kind: "endCard", start: actionEnd, end: actionEnd + clip.cut.cardSec, words: clip.cut.url.trim(), lines: 1 });
  return out;
}

/**
 * --- templates --- (the studio's first review round, finding 26) The seconds the clip's texts hide the run's moving balls
 * (RunFacts.action, lib/bot/actionTrack.ts) beyond what each would hide at the square's other edge – the bottom for a top text,
 * where nothing of the mode's own is drawn along the bottom (planner.ts bottomEdgeFree), the top for a bottom one –, by
 * ACTION_GAIN_SEC or more, over the clip as shown: Ball Drop's balls entering under a top hook while the bottom of the square
 * is empty. The Simple look's planner puts every text at the edge that hides less by that much (placeSimpleTexts), so its
 * plans owe none of it. Null without the run's track (a plan with no run, a saved clip whose run was not read to its end). A
 * text in the middle of the square is not compared.
 */
export function textOverActionSec(clip: CrewClip): number | null {
  const track = clip.run?.action;
  if (!isActionTrack(track)) return null;
  const topText = !!clip.topText.trim();
  const topHud = hasTopHud(clip.settings.mode);
  const offset = clip.cut ? Math.max(0, clip.cut.startSec) : 0;
  const end = clip.cut ? offset + Math.max(0, Math.min(clip.cut.lengthSec, clip.timing.clipSec - offset)) : clip.timing.clipSec;
  const coverSec = (captions: readonly Caption[], message: readonly number[]) => {
    let sec = 0;
    for (let k = 0; k < track.samples.length; k++) {
      const t = actionSampleSec(track, k);
      if (t >= end - EPS) break;
      if (t >= offset - EPS && actionHiddenAt(captions, message, track, k, topText, topHud)) sec += track.stepSec;
    }
    return sec;
  };
  let sec = 0;
  for (const message of captionMessagesOf(clip.captionRoles)) {
    const position = clip.captions[message[0]]?.position;
    if (position !== "top" && position !== "bottom") continue;
    const other = position === "top" ? "bottom" : "top";
    if (other === "bottom" && !bottomEdgeFree(clip.settings)) continue;
    const gain = coverSec(clip.captions, message) - coverSec(captionsAtEdge(clip.captions, message, other), message);
    if (gain >= ACTION_GAIN_SEC - EPS) sec += gain;
  }
  return sec;
}

/** The most messages on screen at once and the share of the clip with 2 or more. */
export function crowding(overlays: readonly Overlay[], shownSec: number): { most: number; busyShare: number } {
  if (!(shownSec > 0)) return { most: 0, busyShare: 0 };
  const times = [...new Set([0, shownSec, ...overlays.flatMap((o) => [o.start, o.end])])].filter((t) => t >= 0 && t <= shownSec).sort((a, b) => a - b);
  let most = 0;
  let busy = 0;
  for (let i = 0; i + 1 < times.length; i++) {
    const a = times[i];
    const b = times[i + 1];
    if (b - a <= EPS) continue;
    const mid = (a + b) / 2;
    const n = overlays.filter((o) => o.start <= mid && mid < o.end).length;
    most = Math.max(most, n);
    if (n >= 2) busy += b - a;
  }
  return { most, busyShare: Math.min(1, busy / shownSec) };
}

/** The Simple score of a clip (see the header). */
export function simpleScore(clip: CrewClip, options: SimpleOptions = {}): SimpleScore {
  const W = SIMPLE_WEIGHTS;
  const s = clip.settings;
  const deductions: SimpleDeduction[] = [];
  const add = (d: SimpleDeduction) => {
    if (d.points > EPS) deductions.push({ ...d, points: round1(d.points) });
  };
  const shownSec = shownSecOf(clip);
  const overlays = overlaysOf(clip);
  // the text on screen
  const { most, busyShare } = crowding(overlays, shownSec);
  add({ id: "textAtOnce", points: W.atOnce[Math.min(most, W.atOnce.length - 1)], values: { most } });
  add({ id: "busyShare", points: busyShare > W.busyShareFree ? W.busyShare * (busyShare - W.busyShareFree) : 0, values: { pct: Math.round(100 * busyShare) } });
  const persistent = overlays.filter((o) => o.end - o.start > W.persistentShare * shownSec + EPS).length;
  add({ id: "persistent", points: persistent > 1 ? W.persistent * (persistent - 1) : 0, values: { count: persistent } });
  // the hook
  const hookIdx = clip.captions.map((c, i) => (clip.captionRoles[i] === "hook" && c.start < clip.timing.clipSec ? i : -1)).filter((i) => i >= 0);
  const drawn = drawnHookText(clip);
  const words = wordCount(drawn);
  add({ id: "hookWords", points: words > W.hookWordsFree ? Math.min(W.hookWordsMax, W.hookWord * (words - W.hookWordsFree)) : 0, values: { words } });
  add({ id: "hookLines", points: hookIdx.length > W.hookLinesFree ? W.hookLines : 0, values: { lines: hookIdx.length } });
  // a message said twice
  const aiHook = (clip.hook ?? "").trim();
  if (aiHook && !sameWords(aiHook, drawn)) add({ id: "aiHookDiffers", points: W.aiHookDiffers, values: { words: wordCount(aiHook) } });
  const cutHook = (clip.cut?.hook ?? "").trim();
  if (cutHook && drawn && !sameWords(cutHook, drawn)) add({ id: "cutHookDiffers", points: W.cutHookDiffers, values: { words: wordCount(cutHook) } });
  const hookTexts = hookIdx.map((i) => bare(clip.captions[i].text)).filter(Boolean);
  // (a payoff line of two words or more that a hook line already says: one word in common is no repeat)
  const repeats = clip.captions.some((c, i) => {
    if (clip.captionRoles[i] !== "payoff") return false;
    const p = bare(c.text);
    return wordCount(p) >= 2 && hookTexts.some((h) => ` ${h} `.includes(` ${p} `));
  });
  if (repeats) add({ id: "payoffRepeatsHook", points: W.payoffRepeatsHook, values: {} });
  const countdownCaption = clip.captions.some((c, i) => clip.captionRoles[i] === "countdown" && c.start < clip.timing.clipSec);
  if (countdownCaption && hudCounts(s)) add({ id: "countdownBesideHud", points: W.countdownBesideHud, values: {} });
  // effects
  const ring = hasRingWalls(s.mode);
  const trailRef = options.trailThickness ?? SIMPLE_TRAIL_THICKNESS;
  if (ring && s.showWallGlow) add({ id: "wallGlow", points: W.wallGlow, values: {}, key: "showWallGlow" });
  if (s.showTrails && s.trailThickness > trailRef + EPS) add({ id: "thickTrails", points: W.thickTrails, values: { thickness: s.trailThickness }, key: "trailThickness" });
  if (s.showTrails && s.colorTrail) add({ id: "colorTrail", points: W.colorTrail, values: {}, key: "colorTrail" });
  if (ring && s.rainbowWalls) add({ id: "rainbowWalls", points: W.rainbowWalls, values: {}, key: "rainbowWalls" });
  if (s.rainbowBall) add({ id: "rainbowBall", points: W.rainbowBall, values: {}, key: "rainbowBall" });
  if (s.reactiveBackground) add({ id: "reactiveBackground", points: W.reactiveBackground, values: {}, key: "reactiveBackground" });
  if (ring && s.screenShake > 0) add({ id: "screenShake", points: W.screenShake * Math.min(1, s.screenShake / W.screenShakeFull), values: { shake: s.screenShake }, key: "screenShake" });
  if (s.cinematicEnabled) add({ id: "cinematic", points: W.cinematic, values: {}, key: "cinematicEnabled" });
  if (s.particleStyle === "confetti") add({ id: "burstParticles", points: W.burstParticles, values: {}, key: "particleStyle" });
  if (ring && (s.wallBreakStyle === "confetti" || s.wallBreakStyle === "all")) add({ id: "wallBreak", points: W.wallBreak, values: { style: s.wallBreakStyle }, key: "wallBreakStyle" });
  // HUDs
  const kept = new Set(options.keepHuds ?? defaultKeptHuds(s, clip.countdown?.source ?? null));
  for (const h of hudsOn(s)) if (h.flag && h.costs && !kept.has(h.id)) add({ id: "hud", points: W.hud, values: { flag: h.id }, key: h.id as keyof SimulatorSettings & string });
  // --- templates --- a text over the action, where the other edge of the square would leave it in sight
  const hiddenSec = textOverActionSec(clip);
  if (hiddenSec !== null) add({ id: "textOverAction", points: Math.min(W.textOverActionMax, W.textOverAction * hiddenSec), values: { sec: round1(hiddenSec) } });
  // measured after a render
  const features = clip.measured?.features ?? null;
  if (features) {
    const motion = "motion" in features && Array.isArray(features.motion) ? features.motion : null;
    const ref = options.motionRef === undefined ? trendsMotionRef() : options.motionRef;
    if (motion && motion.length > 1 && ref !== null && ref > 0) {
      const mean = motion.slice(1).reduce((a, b) => a + b, 0) / (motion.length - 1);
      if (mean > W.measuredMotionFactor * ref + EPS) add({ id: "measuredMotion", points: W.measuredMotion, values: { mean: r3(mean), ref: r3(ref) }, measured: true });
    }
    const first = measuredFirstImpactSec(features);
    if (first === null || first > W.measuredFirstMotionSec + EPS) add({ id: "measuredFirstMotion", points: W.measuredFirstMotion, values: { sec: first === null ? "none" : round1(first) }, measured: true });
  }
  const total = deductions.reduce((sum, d) => sum + d.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - total)));
  return { score, band: bandOf(score), deductions };
}

export function bandOf(score: number): SimpleBand {
  return score >= SIMPLE_BANDS.simple ? "simple" : score >= SIMPLE_BANDS.aBitBusy ? "aBitBusy" : "busy";
}
// --- end crew ---
