import { CAPTION_MARGIN, defaultCaption, sanitizeCaptionText, type Caption } from "@/lib/captions";
import { startBallCount } from "@/lib/physics/ballStats";
import { HUD_BAND } from "@/lib/physics/modes/arenaGames";
import { polyrhythmCycleSeconds, polyrhythmSettingsOf } from "@/lib/physics/modes/polyrhythm";
import { RANGES, defaultSettings, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, stepPlaybackMs, type FinderRequest } from "@/lib/simulation/finder";
import { outcomeMatches, type FinderOutcome, type RunSummary } from "@/lib/simulation/outcomes";
import { recordingTextLayout } from "@/lib/recording/recorder";
import { seedParam } from "@/lib/recording/batch"; // --- low-findings --- (the `seed=` of a share link)
import { pageUrl } from "@/lib/site";
import { applyTheme } from "@/lib/themes";
import { BOT_LOCALES, copyString, fillTemplate, postCopy, recipeCopyVars, recipeText, seriesLabel, type BotCopy, type BotLocale } from "./copy";
import { DEFAULT_BOT_WORLD, finderRequestOfSettings, type BotWorld } from "./finderRequest";
import { actionSampleSec, actionTrackSteps, actionUnder, type ActionTrack, type SquareBox } from "./actionTrack"; // --- templates --- (where the run moves)
import { botRecipeById, simpleHookText, simpleLookPatch, simplePayoffText, SIMPLE_TEXT, stakeNumbersOf, TEMPLATE_LOOK, templateRecipeById, type BotLookId } from "./templates"; // --- templates ---
// --- fl-overhaul --- (Stage 6) the Fight League recipes: the KO, the cliffhanger's both-low moment, the winner's name, the holds
import { FL_WIN_HOLD_SEC, flBothLowNow, flRunSummary, flShowKind } from "@/lib/physics/modes/fightLeague";
import { FL_FINALE_SEC } from "@/lib/physics/modes/fightLeagueFx";
import { flClipWinnerName } from "@/lib/physics/modes/fightLeagueClip";
import {
  BOT_DEFAULT_FAMILIES,
  BOT_EPOCH,
  BOT_FAMILIES,
  BOT_FRAME,
  BOT_LOOK,
  BUCKET_SECONDS,
  CHECKLIST,
  CLIFF_GAP_SEC,
  FIRST_IMPACT_SEC,
  HOOK_SEC,
  INSTRUMENT_PRESETS,
  MASCOT,
  PAYOFF_BAND,
  PLATFORMS,
  RISING_MELODIES,
  SAFE_ZONE,
  SERIES_ROSTER,
  TOP_HUD_MODES,
  pick,
  powerLayersPayoffSec,
  recipeBucket,
  recipesOfFamily,
  supportsBucket,
  type BotFamily,
  type BotFamilyChoice,
  type BotPlatform,
  type BotRecipe,
  type ChecklistId,
  type CountdownKind,
  type CountdownSource,
  type EndingChoice,
  type EndingStyle,
  type InstrumentPreset,
  type LengthBucket,
  type PayoffType,
  type RecipeContext,
} from "./playbook";

/*
 * --- viral-bot --- The planner: one clip (planClip), its score (scoreClip) and a day of clips (planDay). Pure and
 * deterministic – every random choice comes from a seeded generator keyed by the inputs, and the only date is the one
 * handed in – so the page, the CLI and the tests plan the same clips for the same inputs.
 *
 * planClip builds the settings from a recipe (playbook.ts) and then searches physics seeds with the seed finder's engine
 * (`createEngineForSettings()`) and its predicates (outcomes.ts: escapes-at, never-escapes, winner; the duration search
 * for the modes that end on their own) until the payoff lands in the last 10–20 % of the clip – or, for a cut-before-the-
 * result clip, 0.5–1 s after its end. Every accepted candidate is scored (the checklist of docs/virality-playbook.md §3)
 * and the best one is kept. The search is a generator (`planClipSteps`) that yields after every seed, so the page runs it
 * in slices without freezing and the CLI and tests simply drain it (`planClip`).
 */

export const BOT_PLAN_VERSION = 1;

/* ------------------------------------------------------------------ seeded helpers */

/** FNV-1a hash of a string, as an unsigned 32-bit integer. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small, fast, seeded generator (0 ≤ x < 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A physics seed (1 – 2³¹−1) for candidate `i` of a plan. */
export function candidateSeed(planSeed: number, recipeId: string, i: number): number {
  return 1 + (hashString(`${planSeed}|${recipeId}|seed|${i}`) % 0x7ffffffe);
}

/** Drains a planning generator (the CLI, the tests and anything that may block). */
export function drain<T>(steps: Generator<unknown, T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/* ------------------------------------------------------------------ dates */

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" of a Date in its local calendar (the page's "today"). */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Validates "YYYY-MM-DD" (a real calendar day); null otherwise. */
export function parseIsoDate(text: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** Days from the series epoch (BOT_EPOCH = day 0) to `date`; a Date counts by its local calendar day. */
export function dayIndexOf(date: string | Date): number {
  const iso = typeof date === "string" ? date : localIsoDate(date);
  const p = parseIsoDate(iso);
  const e = parseIsoDate(BOT_EPOCH)!;
  if (!p) throw new Error(`Not a date (YYYY-MM-DD): ${iso}`);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(e.y, e.m - 1, e.d)) / DAY_MS);
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/* ------------------------------------------------------------------ the caption layout (safe zone) */

/** Base caption font in the export (captionsRenderer.ts: max(12, 0.045 × side)). */
export function captionBaseFont(side: number = BOT_FRAME.width): number {
  return Math.max(12, 0.045 * side);
}

/**
 * Estimated width (px) of a bold sans-serif line at `fontPx` – a little wide on purpose, so a line that fits by the
 * estimate fits on screen too. Emoji count as 1.25 em.
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  let em = 0;
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0f || cp === 0x200d) continue;
    if (cp > 0x2000 && !/[\p{L}\p{N}]/u.test(ch)) em += 1.25;
    else if (/[ il.,:;'!|ıjtfr]/.test(ch)) em += 0.32;
    else if (/[mwMW@]/.test(ch)) em += 0.9;
    else if (/[A-Z0-9ĄĆĘŁŃÓŚŹŻÑÁÉÍÚ]/.test(ch)) em += 0.7;
    else em += 0.58;
  }
  return em * fontPx;
}

/** The widest a caption box may be and stay out of the right 12 % while centred: 2 × (0.88 − 0.5) of the frame width. */
export function maxSafeBoxWidth(frameWidth: number = BOT_FRAME.width): number {
  return 2 * (1 - SAFE_ZONE.right - 0.5) * frameWidth;
}

/**
 * Splits `text` into lines that each fit a safe caption box at `size` (the box adds 0.55 font sizes of padding on each
 * side, captionsRenderer.ts), with a tenth of the width to spare. A single word wider than that gets a line of its own.
 */
export function splitCaptionLines(text: string, size: number, frameWidth: number = BOT_FRAME.width): string[] {
  const fs = captionBaseFont(frameWidth) * size;
  const max = 0.9 * maxSafeBoxWidth(frameWidth) - 1.1 * fs;
  const words = sanitizeCaptionText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || estimateTextWidth(candidate, fs) <= max) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// --- templates --- (review round 1, 25) where the Simple look breaks a text of two lines
/** A word that ends a clause: a sentence's end or a colon (a closing quote or bracket after it allowed). */
const CLAUSE_END = /[.!?…:]["'”’»)\]]*$/u;
/** A part of a text a reader reads as words: a letter or a digit in it (an emoji alone is none). */
const hasWord = (words: readonly string[]) => words.some((w) => /[\p{L}\p{N}]/u.test(w));
/** The fewest words a last line keeps in a text of five words or more (fewer is an orphan). */
const ORPHAN_WORDS = 2;

/**
 * `text` broken into two lines at `size` as the Simple look breaks it, where splitCaptionLines() fills the first line
 * greedily ("15 pendulums. Wait for" / "the chord."): at a clause boundary when both parts fit the safe width, the most even
 * such break ("15 pendulums." / "Wait for the chord."); else the most even break that fits (the smallest widest line), with a
 * last line of more than two words in a text of five or more ("Every hit" / "doubles the power.", never "Every hit doubles" /
 * "the power.") where such a break fits. The first line keeps a word to read, and so does the second but after a whole sentence
 * (its emoji: "Harley Quinn wins!" / "🏆"). The greedy lines when the text takes one line or more than two, or when no two lines
 * fit (a word wider than a line).
 */
export function evenCaptionLines(text: string, size: number, frameWidth: number = BOT_FRAME.width): string[] {
  const greedy = splitCaptionLines(text, size, frameWidth);
  if (greedy.length !== 2) return greedy;
  const fs = captionBaseFont(frameWidth) * size;
  const max = 0.9 * maxSafeBoxWidth(frameWidth) - 1.1 * fs;
  const words = sanitizeCaptionText(text).split(" ").filter(Boolean);
  const breaks: { lines: [string, string]; widest: number; clause: boolean; orphan: boolean }[] = [];
  for (let i = 1; i < words.length; i++) {
    const first = words.slice(0, i);
    const last = words.slice(i);
    const clause = CLAUSE_END.test(words[i - 1]);
    // (a line of emoji alone only after a whole sentence: "Harley Quinn wins!" / "🏆", never "Harley Quinn" / "wins! 🏆")
    if (!hasWord(first) || (!hasWord(last) && !clause)) continue;
    const lines: [string, string] = [first.join(" "), last.join(" ")];
    const widest = Math.max(estimateTextWidth(lines[0], fs), estimateTextWidth(lines[1], fs));
    if (widest > max) continue;
    breaks.push({ lines, widest, clause, orphan: words.length >= 5 && last.length <= ORPHAN_WORDS });
  }
  const evenest = (pool: typeof breaks) => pool.reduce((a, b) => (b.widest < a.widest - 1e-9 ? b : a));
  const clauses = breaks.filter((b) => b.clause);
  if (clauses.length) return [...evenest(clauses).lines];
  const whole = breaks.filter((b) => !b.orphan);
  if (whole.length) return [...evenest(whole).lines];
  return breaks.length ? [...evenest(breaks).lines] : greedy;
}
// --- end templates ---

/** --- templates --- Whether two lines break at a clause boundary (the first ends one). */
const breaksAtClause = (lines: readonly string[]) => lines.length === 2 && CLAUSE_END.test(lines[0]);

/** --- templates --- Whether a text has a clause boundary a line may break at (a word to read on each side of it). */
function hasClauseBoundary(text: string): boolean {
  const words = sanitizeCaptionText(text).split(" ").filter(Boolean);
  return words.some((_, i) => i > 0 && CLAUSE_END.test(words[i - 1]) && hasWord(words.slice(0, i)) && hasWord(words.slice(i)));
}

/** --- templates --- How much smaller (size steps of 0.1) a Simple text may be drawn to break at its clause boundary. */
const CLAUSE_SHRINK_STEPS = 2;

/**
 * One caption per line at the largest size (from `size` down to 0.8) that keeps it to `maxLines` lines. --- templates --- `even`
 * (the Simple look): two lines broken where a reader would break them (evenCaptionLines) – at the same size, since the greedy
 * lines that fit are one of the breaks it chooses from – or, for a text of two clauses whose break there does not fit at that
 * size ("16 pelotas. Cada" / "clavo es una nota."), at its clause boundary a step or two smaller ("16 pelotas." / "Cada clavo es
 * una nota.").
 */
function captionLines(text: string, size: number, maxLines: number, even = false): { lines: string[]; size: number } {
  const split = even ? evenCaptionLines : splitCaptionLines; // --- templates ---
  let s = size;
  let lines = split(text, s);
  while (lines.length > maxLines && s > 0.8 + 1e-9) {
    s = Math.round((s - 0.1) * 10) / 10;
    lines = split(text, s);
  }
  // --- templates --- a clause break a step or two smaller before a break inside a clause
  if (even && lines.length === 2 && !breaksAtClause(lines) && hasClauseBoundary(text)) {
    for (let k = 1, t = s; k <= CLAUSE_SHRINK_STEPS && t > 0.8 + 1e-9; k++) {
      t = Math.round((t - 0.1) * 10) / 10;
      const smaller = evenCaptionLines(text, t);
      if (breaksAtClause(smaller)) return { lines: smaller, size: t };
    }
  }
  return { lines: lines.slice(0, Math.max(maxLines, 1)), size: s };
}

// --- templates --- (review round 2, 13) the Simple payoff's lines get their time
/** A text without its closing emoji ("Znów w jednej linii. 🎼" → "Znów w jednej linii."): the text itself when it ends on a word. */
function withoutClosingEmoji(text: string): string {
  const words = sanitizeCaptionText(text).split(" ").filter(Boolean);
  let n = words.length;
  while (n > 0 && !hasWord(words.slice(n - 1, n))) n--;
  return n > 0 && n < words.length ? words.slice(0, n).join(" ") : text;
}

/**
 * The Simple look's payoff (`words`: simplePayoffText's) on the lines it gets: the lines captionLines() breaks at 1.3 where the
 * clip's tail after the payoff (`tailSec`) gives each SIMPLE_TEXT.secPerLine (the crew's G5); else one line, the largest size
 * from 1.3 down to 0.8 that fits it, without its closing emoji – "Znów w jednej linii. 🎼" on Shorts, whose 🎼 took a line of its
 * own in the 2 s the clip leaves after the payoff, 1 s a line – and the lines it had where no one line fits.
 */
function simplePayoffLines(words: string, tailSec: number): { text: string; lines: string[]; size: number } {
  const two = captionLines(words, 1.3, 2, true);
  if (two.lines.length < 2 || tailSec / two.lines.length >= SIMPLE_TEXT.secPerLine - 1e-9) return { text: words, ...two };
  const text = withoutClosingEmoji(words);
  for (let s = 1.3; s > 0.8 - 1e-9; s = Math.round((s - 0.1) * 10) / 10) {
    const lines = evenCaptionLines(text, s);
    if (lines.length === 1) return { text, lines, size: s };
  }
  return { text: words, ...two };
}
// --- end templates ---

export interface CaptionBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where caption `index` of `captions` sits in a 1080 × 1920 frame at simulation second `t` (null: not on screen then), as the
 * canvas stacks them: inside the centred square, the top stack growing down from its top margin (below the Top Text and –
 * `topHud`, an arena game – below the mode's scoreboard band), the bottom one up from its bottom margin, the centre one
 * around the middle; each box as wide as its text plus padding.
 */
export function captionBoxAt(captions: readonly Caption[], index: number, t: number, frame: { width: number; height: number } = BOT_FRAME, topText = false, topHud = false): CaptionBox | null {
  const visible = (c: Caption) => t >= c.start && (c.end <= c.start || t < c.end);
  const c = captions[index];
  if (!c || !visible(c)) return null;
  const side = Math.min(frame.width, frame.height);
  const squareTop = (frame.height - side) / 2;
  const margin = CAPTION_MARGIN * side;
  const baseFs = captionBaseFont(side);
  const gap = 0.3 * baseFs;
  const box = (k: Caption) => {
    const fs = baseFs * k.style.size;
    const text = k.type === "wallCounter" ? k.text.replace(/\[(n|total)\]/g, "10") : k.type === "countdown" ? k.text.replace("[time]", "0:30") : k.type === "progress" ? k.text.replace("[pct]", "100%") : k.text;
    const lineH = 1.22 * fs;
    let width = estimateTextWidth(text, fs) + 1.1 * fs;
    let height = lineH + 0.6 * fs;
    if (k.type === "progress") {
      width = 0.72 * side * Math.min(1.2, k.style.size);
      height = Math.max(6, 0.018 * side) * k.style.size + 0.6 * fs + (k.text ? lineH + 0.25 * fs : 0);
    }
    return { width, height };
  };
  // The Top Text line (recorder: about 0.045 × side, a little smaller) sits at the top of the square.
  let topStart = squareTop + margin + (topText ? 1.4 * 0.045 * side : 0);
  // An arena game's scoreboard band covers the top of the square: the canvas starts the top stack below it (Canvas.tsx).
  if (topHud) topStart = Math.max(topStart, squareTop + HUD_BAND * side + 0.5 * margin);
  let y = c.position === "bottom" ? squareTop + side - margin : topStart;
  if (c.position === "center") {
    let total = 0;
    captions.forEach((k) => {
      if (k.position === "center" && visible(k)) total += box(k).height + gap;
    });
    y = frame.height / 2 - total / 2;
  }
  for (let i = 0; i < captions.length; i++) {
    const k = captions[i];
    if (k.position !== c.position || !visible(k)) continue;
    const b = box(k);
    if (i === index) {
      const top = c.position === "bottom" ? y - b.height : y;
      return { left: frame.width / 2 - b.width / 2, right: frame.width / 2 + b.width / 2, top, bottom: top + b.height };
    }
    y += c.position === "bottom" ? -(b.height + gap) : b.height + gap;
  }
  return null;
}

/** The box of the Top or Bottom Text line in the export frame, where the recorder draws it (recordingTextLayout()). */
export function edgeTextBox(text: string, where: "top" | "bottom", frame: { width: number; height: number } = BOT_FRAME, textSize = 1): CaptionBox {
  const layout = recordingTextLayout(frame.width, frame.height, textSize);
  const y = where === "top" ? layout.topY : layout.bottomY;
  const width = estimateTextWidth(text, layout.fontSize);
  return { left: frame.width / 2 - width / 2, right: frame.width / 2 + width / 2, top: y - 0.6 * layout.fontSize, bottom: y + 0.6 * layout.fontSize };
}

/** The mode's own scoreboard band covers the top of the square (TOP_HUD_MODES): no Top Text there. */
export function hasTopHud(mode: SimulatorSettings["mode"]): boolean {
  return TOP_HUD_MODES.includes(mode);
}

/** Inside the safe zone: clear of the bottom 20 % and the right 12 % of the frame (and inside it). */
export function inSafeZone(box: CaptionBox, frame: { width: number; height: number } = BOT_FRAME): boolean {
  return box.left >= 0 && box.top >= 0 && box.right <= (1 - SAFE_ZONE.right) * frame.width + 1e-6 && box.bottom <= (1 - SAFE_ZONE.bottom) * frame.height + 1e-6;
}

// --- templates --- (review round 1, 26) a text at either edge of the square, read in the order a viewer reads it
/**
 * The indices of `indices` (captions of one message) in the order a viewer reads them: a top or a centre stack downwards, in
 * the list's order; a bottom stack upwards, since the canvas stacks it from the square's bottom margin (captionsRenderer.ts,
 * captionBoxAt), so its first caption is its lowest line. Top ones first, then the centre's, then the bottom's.
 */
export function inReadingOrder(captions: readonly Pick<Caption, "position">[], indices: readonly number[]): number[] {
  const at = (p: Caption["position"]) => indices.filter((i) => captions[i]?.position === p);
  return [...at("top"), ...at("center"), ...at("bottom").reverse()];
}

/**
 * The words of captions `indices` in the order a viewer reads them (inReadingOrder), joined by a space, as scoreClip joins a
 * hook's.
 */
export function captionWordsOf(captions: readonly Pick<Caption, "position" | "text">[], indices: readonly number[]): string {
  return inReadingOrder(captions, indices)
    .map((i) => captions[i].text)
    .join(" ")
    .trim();
}

/**
 * The captions with message `indices` moved to the top or the bottom edge of the square, read as before: its lines take the
 * message's own places in the list, in the order that stack reads them in (a bottom stack's lowest line first).
 */
export function captionsAtEdge(captions: readonly Caption[], indices: readonly number[], position: "top" | "bottom"): Caption[] {
  const slots = [...indices].sort((a, b) => a - b);
  const read = inReadingOrder(captions, indices).map((i) => ({ ...captions[i], position }));
  const listed = position === "bottom" ? read.reverse() : read;
  const out = captions.slice();
  slots.forEach((slot, k) => (out[slot] = listed[k]));
  return out;
}

/**
 * The modes that draw something of their own along the bottom of the square (Canvas.tsx, the live watermark's bottom bands and
 * blocks: Fight League's ability boxes, a string battle's standings strip, Multipliers' ball counter at home, a race's standings
 * and mini-map, the Journey's clock), which captionBoxAt does not know: a Simple text stays at the top there.
 */
const BOTTOM_HUD_MODES: readonly SimulatorSettings["mode"][] = ["fightLeague", "stringBattle", "multipliers", "race", "journey"];

/**
 * Whether a Simple text may take the bottom edge of the square with these settings: not in BOTTOM_HUD_MODES, nor under the loop
 * HUD (its counter line along the bottom) or Classic's time-in-ring line under the rings.
 */
export function bottomEdgeFree(s: Pick<SimulatorSettings, "mode" | "loopHud" | "ringTimer">): boolean {
  return !BOTTOM_HUD_MODES.includes(s.mode) && !s.loopHud && !(s.mode === "classic" && s.ringTimer);
}

/** A caption's box in the exported square, as shares of its side (the action track's coordinates). */
export function squareBoxOf(box: CaptionBox, frame: { width: number; height: number } = BOT_FRAME): SquareBox {
  const side = Math.min(frame.width, frame.height);
  const left = (frame.width - side) / 2;
  const top = (frame.height - side) / 2;
  return { left: (box.left - left) / side, top: (box.top - top) / side, right: (box.right - left) / side, bottom: (box.bottom - top) / side };
}

/**
 * The seconds message `indices` of `captions` hides the run's moving balls (`track`): the samples, before `untilSec`, at which a
 * ball moves under one of its boxes as captionBoxAt lays them out (with `topText` and `topHud` as it takes them).
 */
export function actionCoverSec(captions: readonly Caption[], indices: readonly number[], track: ActionTrack, untilSec: number, topText = false, topHud = false): number {
  let sec = 0;
  for (let k = 0; k < track.samples.length; k++) {
    if (actionSampleSec(track, k) >= untilSec - 1e-9) break;
    if (actionHiddenAt(captions, indices, track, k, topText, topHud)) sec += track.stepSec;
  }
  return sec;
}

/** Whether message `indices` of `captions` hides a moving ball at sample `k` of `track` (actionCoverSec's test). */
export function actionHiddenAt(captions: readonly Caption[], indices: readonly number[], track: ActionTrack, k: number, topText = false, topHud = false): boolean {
  const t = actionSampleSec(track, k);
  return indices.some((i) => {
    const box = captionBoxAt(captions, i, t, BOT_FRAME, topText, topHud);
    return !!box && actionUnder(track, k, squareBoxOf(box));
  });
}

/** The messages of a caption list: the runs of captions with the same role, in order (a hook's lines are one). */
export function captionMessagesOf(roles: readonly CaptionRole[]): number[][] {
  const out: number[][] = [];
  roles.forEach((r, i) => {
    if (i > 0 && roles[i - 1] === r) out[out.length - 1].push(i);
    else out.push([i]);
  });
  return out;
}

/**
 * The least a text must hide the action less at the other edge of the square to be moved there (s): two samples of the track,
 * so one ball passing once does not send a text from edge to edge.
 */
export const ACTION_GAIN_SEC = 1;

/**
 * The Simple look's texts, each at the edge of the square its run leaves clearer: a message moves to the bottom when it would
 * hide the moving balls there for at least ACTION_GAIN_SEC less than at the top, over the clip (`untilSec`), its lines read as
 * before. None moves where the mode draws something of its own along the bottom (bottomEdgeFree); the others stay at the top,
 * the bot look's place. Pure: it reads the run's action track.
 */
export function placeSimpleTexts(captions: readonly Caption[], roles: readonly CaptionRole[], track: ActionTrack, settings: Pick<SimulatorSettings, "mode" | "loopHud" | "ringTimer">, untilSec: number): Caption[] {
  let out = captions.slice();
  if (!bottomEdgeFree(settings)) return out;
  const topHud = hasTopHud(settings.mode);
  for (const message of captionMessagesOf(roles)) {
    const top = captionsAtEdge(out, message, "top");
    const bottom = captionsAtEdge(out, message, "bottom");
    out = actionCoverSec(top, message, track, untilSec, false, topHud) - actionCoverSec(bottom, message, track, untilSec, false, topHud) >= ACTION_GAIN_SEC - 1e-9 ? bottom : top;
  }
  return out;
}
// --- end templates ---

/* ------------------------------------------------------------------ the plan */

export type CaptionRole = "hook" | "countdown" | "payoff" | "question";

export interface ScoreReason {
  id: ChecklistId;
  points: number;
  max: number;
  /** Message key under `ViralBot.reasons` and its values. */
  key: string;
  values: Record<string, string | number>;
}

export interface ClipPlan {
  version: number;
  /** File base: `<episode>-<recipe>-<seed>`. */
  id: string;
  /** Day number of the series (day 1 = BOT_EPOCH). */
  episode: number;
  /** "ep012-1": the day and the clip's place in it. */
  episodeCode: string;
  /** 1-based place in its plan. */
  index: number;
  date: string | null;
  recipe: string;
  family: BotFamily;
  mode: SimulatorSettings["mode"];
  platform: BotPlatform;
  bucket: LengthBucket;
  ending: EndingStyle;
  endingChoice: EndingChoice;
  locale: BotLocale;
  /** The input of the settings and the seed search (a re-roll moves it on). */
  planSeed: number;
  /** The physics seed the clip is rendered with. */
  seed: number;
  settings: SimulatorSettings;
  /** Built-in melody (lib/audio/songs.ts id) played on the bounces, null for the music-first recipes. */
  melodyId: string | null;
  instrumentPreset: InstrumentPreset;
  /** What each caption of `settings.captions` is for. */
  captionRoles: CaptionRole[];
  hook: string;
  countdown: { kind: CountdownKind; source: CountdownSource };
  payoff: {
    type: PayoffType;
    /** Clip second of the payoff (null: not measured / never within the search). */
    atSec: number | null;
    /** Payoff second ÷ clip length (resolved clips). */
    position: number | null;
    /** Seconds from the clip's end to the payoff (cut-before-the-result clips). */
    cutGapSec: number | null;
    text: string;
    /** The team or racer that wins, when the finder's winner predicate names one. */
    winner: string | null;
  };
  timing: {
    /** The Recording section's clip length (s, whole). */
    recordingDuration: number;
    /** Estimated length of the rendered clip (the run's own end, its holds and the recorder's 0.5 s, or the clip length). */
    clipSec: number;
    /** When the first sound event (impact, note) comes (s), null when not simulated. */
    firstImpactSec: number | null;
    /** A seed met the timing (else the closest one is kept). */
    found: boolean;
    seedsTested: number;
  };
  score: number;
  reasons: ScoreReason[];
  shareUrl: string;
  post: { caption: string; question: string; hashtags: string[]; keywords: string; note: string; time: string };
  series: { name: string; label: string; episode: number; roster: string[] };
  world: BotWorld;
  /** --- templates --- The template it was planned from (templates.ts; its id is the plan's `recipe` too); absent: a playbook recipe's plan. */
  template?: string;
  /** --- templates --- The look it is drawn in when it is not the bot's own: "simple" (SIMPLE_LOOK and one text at a time). */
  look?: BotLookId;
}

export interface PlanOptions {
  /** The `ViralBot` namespace of the locale's messages. */
  copy: BotCopy;
  locale?: BotLocale;
  /** A length bucket, or "auto": the platform's default. */
  bucket?: LengthBucket | "auto";
  ending?: EndingChoice;
  /** Day number of the series (planDay sets it); 1 by default. */
  episode?: number;
  /** 1-based place in the plan. */
  index?: number;
  date?: string | null;
  /** The world the page simulates in (its canvas in CSS px); 800 × 600 without one. */
  world?: BotWorld;
  /** Seeds searched at most. */
  maxSeeds?: number;
  /** false: no simulation (the timing is the target, the score says so) – fast, for previews and tests. */
  search?: boolean;
  /** Absolute site URL (with the base path) for the share link; the build's SITE_URL by default. */
  siteUrl?: string;
  /** "HH:MM" to post at; the platform's slot for the clip's place by default. */
  postingTime?: string;
  /**
   * --- templates --- The look: "bot" (today's, the default) or "simple" – the Simple look (templates.ts SIMPLE_LOOK) and its text
   * plan: one text on screen at a time, a hook of at most 7 words, the series label in the post caption instead of on the clip.
   */
  look?: BotLookId;
  /** --- templates --- The template the clip is planned from (planTemplateSteps sets it): the plan records it. */
  template?: string;
}

export interface PlanProgress {
  seedsTested: number;
  maxSeeds: number;
}

export const DEFAULT_MAX_SEEDS = 24;
/** Seeds tried per settings variant before the generator draws new settings. */
const SEEDS_PER_VARIANT = 6;
/** A candidate this good ends the search early. */
const GOOD_ENOUGH = 95;
/** Accepted candidates compared at most. */
const MAX_ACCEPTED = 3;

/* Holds the page adds after a run's end before the end screen (Simulator.tsx; the fast export follows it). */
const HOLD_SEC = { teams: 3, stringBattle: 3, arena: 3, multipliers: 2, stop: 0.5 } as const;

/** The holds after a run's own end (s), the recorder's stop included (--- insights --- exported: a scored clip's length without an export). */
export function endHoldsSec(s: SimulatorSettings): number {
  let pre = 0;
  if (s.mode === "stringBattle") pre = HOLD_SEC.stringBattle;
  else if (s.mode === "battle" || s.mode === "ctf") pre = HOLD_SEC.arena;
  else if (s.mode === "fightLeague") pre = FL_FINALE_SEC + FL_WIN_HOLD_SEC; // --- fl-overhaul --- (Stage 6) the KO finale and the winner's card
  const teamsPlay = s.teams.length > 0 && ["classic", "multiply", "lines", "grow", "shatter", "colorMatch"].includes(s.mode);
  const post = Math.max(teamsPlay ? HOLD_SEC.teams : 0, s.mode === "multipliers" ? HOLD_SEC.multipliers : 0);
  return pre + post + HOLD_SEC.stop;
}

/** The bucket a plan uses: the one asked for, or the platform's default. */
export function resolveBucket(platform: BotPlatform, bucket?: LengthBucket | "auto"): LengthBucket {
  return bucket && bucket !== "auto" ? bucket : PLATFORMS[platform].defaultBucket;
}

/** The ending a clip gets: the one asked for, or – "auto" – alternating with the day and the clip's place. */
export function resolveEnding(choice: EndingChoice | undefined, episode: number, index: number, allowed: readonly EndingStyle[] = ["resolved", "cliffhanger"]): EndingStyle {
  const wanted: EndingStyle = choice === "resolved" || choice === "cliffhanger" ? choice : mod(episode + index, 2) === 0 ? "resolved" : "cliffhanger";
  return allowed.includes(wanted) ? wanted : allowed[0];
}

const clampInt = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)));
const half = (v: number) => Math.max(0, Math.min(120, Math.round(v * 2) / 2));
const R_DUR = RANGES.recordingDuration;
/** The middle of the payoff band (85 %): where a run that goes on past its payoff is cut. */
const PAYOFF_MID = (PAYOFF_BAND.from + PAYOFF_BAND.to) / 2;

/** What one simulated candidate did (seconds; -1 = never within the run followed). */
export interface RunFacts {
  firstImpactSec: number;
  firstEscapeSec: number;
  finishSec: number;
  /** Glass Smash: the ball reached HOME. */
  homeSec: number;
  /** Grow: the ball fills its ring; Multiply: the balls fill the screen. */
  fillSec: number;
  /** Square race: the first racer crosses the finish line – the mode names its winner (callout, fanfare). */
  winSec: number;
  /** The winner the mode itself names (race, battle royale, capture the flag), −1 without one. */
  winnerIndex: number;
  /** The run as the finder's predicates see it – at the first escape for a ring race, else where the simulation stopped. */
  summary: RunSummary;
  // --- fl-overhaul --- (Stage 6)
  /** Fight League: the first moment every side standing was at or under 25 % with the fight on (s; −1 never). */
  bothLowSec?: number;
  /** Fight League: the winner the mode names (the side's names, a bracket's champion), null without one. */
  winnerName?: string | null;
  // --- templates ---
  /** The last sound of the run (s; −1 none): followed for the `lastNote` strategy only, absent otherwise. */
  lastSoundSec?: number;
  // --- crew ---
  /** What the run does around its payoff (lib/insights/score.ts payoffMomentSync): the crew's runs carry it, the bot's never. */
  moment?: PayoffMoment;
  /**
   * --- templates --- Where the run moves over the clip (actionTrack.ts: the cells of the square a moving ball touches, every
   * half second): the crew's runs carry it (lib/insights/score.ts runSync with the clip's length), the bot's never.
   */
  action?: ActionTrack;
}

/**
 * --- crew --- The run around its payoff, from the payoff MOMENT_BEFORE_SEC before to MOMENT_AFTER_SEC after (the clip's own
 * seconds): the sound events the mode plays there and the balls' motion against the run's, so the crew's gate G2 can tell a
 * payoff that lands from a silent or a still one (lib/crew/clarity.ts).
 */
export interface PayoffMoment {
  /** The payoff second it was read around. */
  atSec: number;
  /** Sound events in the window, the notes they play (a chord's each), the most in one event, one the mode accents. */
  sounds: number;
  notes: number;
  chordMax: number;
  accent: boolean;
  /** The balls' mean speed in the window and the median of the run's before it (px a second, the world's); null: no balls. */
  motion: number | null;
  motionMedian: number | null;
}

/** --- fl-overhaul --- (Stage 6) Whether settings play one Fight League match (not a series, a bracket or a boss rush). */
function flSingle(s: Pick<SimulatorSettings, "mode" | "flMatch" | "flBestOf">): boolean {
  return s.mode === "fightLeague" && flShowKind({ match: s.flMatch, bestOf: s.flBestOf }) === "single";
}

/** Ball Drop's rest window (modes/drop.ts REST_TIME_MS): its run ends that long after the last ball settled. */
const DROP_REST_SEC = 1;

/** Balls on screen that count as "filled" in Multiply. */
export const MULTIPLY_FILL_BALLS = 40;
/** The share of its ring a Grow ball fills at the payoff. */
export const GROW_FILL_SHARE = 0.95;

/** Simulates one seed the way the page's export engine plays it, collecting what the payoff timing needs. */
export function simulateFacts(request: FinderRequest, seed: number, recipe: Pick<BotRecipe, "strategy">, horizonSec: number): RunFacts {
  return drain(simulateFactsSteps(request, seed, recipe, horizonSec));
}

// --- insights ---
/** Steps simulateFactsSteps() runs between two pauses: a second of the run at 60 Hz. */
export const FACTS_SLICE_STEPS = 60;

/**
 * simulateFacts() as a generator: the same run and the same facts, with a pause (it yields the playback ms so far) every
 * FACTS_SLICE_STEPS steps, so the page can follow a heavy run in slices (lib/insights/score.ts) – drain() takes none.
 */
export function* simulateFactsSteps(request: FinderRequest, seed: number, recipe: Pick<BotRecipe, "strategy">, horizonSec: number): Generator<number, RunFacts> {
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  const step = 1000 / 60;
  const horizonMs = horizonSec * 1000;
  const facts: RunFacts = { firstImpactSec: -1, firstEscapeSec: -1, finishSec: -1, homeSec: -1, fillSec: -1, winSec: -1, winnerIndex: -1, summary: { mode: request.mode, durationMs: 0, finished: false, firstEscapeMs: -1, teams: [] }, ...(recipe.strategy === "lastNote" ? { lastSoundSec: -1 } : {}) /* --- templates --- */ };
  const teamCount = () => (request.mode === "stringBattle" ? engine.getStringBattleView().count : startBallCount(engine.config, request.mode));
  // --- low-findings --- a finished battle that ended with nobody standing (its last balls fell in the same step), as
  // simulateOutcomeRun() reports it: the mode's verdict shares the win, the finder's winner predicate takes it for nobody's
  const doubleKoOf = (finished: boolean): boolean | undefined =>
    !finished ? undefined : request.mode === "fightLeague" ? engine.getFightLeagueView().doubleKo : request.mode === "stringBattle" ? engine.getStringBattleView().alive === 0 : undefined;
  const snapshot = (elapsed: number, finished: boolean): RunSummary => {
    const doubleKo = doubleKoOf(finished);
    return {
      mode: request.mode,
      durationMs: elapsed,
      finished,
      firstEscapeMs: facts.firstEscapeSec >= 0 ? facts.firstEscapeSec * 1000 : -1,
      teams: engine.getTeamStats().slice(0, teamCount()).map((t) => ({ ...t })),
      ...(doubleKo !== undefined ? { doubleKo } : {}),
    };
  };
  const analytic = recipe.strategy === "cycle" || recipe.strategy === "fixed";
  let elapsed = 0;
  let atEscape: RunSummary | null = null;
  let steps = 0; // --- insights --- (the pauses)
  while (elapsed < horizonMs - 1e-6) {
    engine.update(step, 0);
    elapsed += stepPlaybackMs(engine, step); // --- slow-motion --- (the playback time the export renders the run in, with the switch off too)
    const events = engine.consumeSoundEvents();
    const sec = elapsed / 1000;
    // (a race's 3-2-1 beeps come before anything moves: its first impact counts from the start)
    if (facts.firstImpactSec < 0 && events.length > 0 && !(request.mode === "race" && engine.getRaceProgress().phase === "countdown")) facts.firstImpactSec = sec;
    if (facts.lastSoundSec !== undefined && events.length > 0) facts.lastSoundSec = sec; // --- templates --- (lastNote)
    if (analytic && (facts.firstImpactSec >= 0 || sec >= 2)) break; // the timing is known: only the first impact is measured
    if (facts.firstEscapeSec < 0 && engine.getFirstEscapeMs() >= 0) {
      facts.firstEscapeSec = sec;
      atEscape = snapshot(elapsed, engine.isSimulationFinished());
    }
    if (request.mode === "glass" && facts.homeSec < 0 && engine.getGlassProgress().home) facts.homeSec = sec;
    // The race names its winner as the first racer crosses the line (race.ts finish(): the "winner" callout and the
    // fanfare) – that is the payoff, not the complete podium seconds later.
    if (request.mode === "race" && facts.winSec < 0) {
      const race = engine.getRaceProgress();
      if (race.winner >= 0) {
        facts.winSec = sec;
        facts.winnerIndex = race.winner;
      }
    }
    if (recipe.strategy === "fill" && facts.fillSec < 0) {
      const balls = engine.getBalls();
      if (request.mode === "multiply" && balls.length >= MULTIPLY_FILL_BALLS) facts.fillSec = sec;
      if (request.mode === "grow" && balls.length > 0) {
        const ring = engine.getCircularWalls()[0];
        if (ring && balls[0].radius >= GROW_FILL_SHARE * (ring.radius - 2)) facts.fillSec = sec;
      }
      if (facts.fillSec >= 0) break;
    }
    // --- fl-overhaul --- (Stage 6) a fight's cliffhanger moment: every side standing at or under 25 %, the fight on
    if (request.mode === "fightLeague" && (facts.bothLowSec ?? -1) < 0 && flBothLowNow(engine.getFightLeagueView())) facts.bothLowSec = sec;
    if (engine.isSimulationFinished()) {
      facts.finishSec = sec;
      if (request.mode === "battle") facts.winnerIndex = engine.getBattleProgress().winner;
      if (request.mode === "ctf") facts.winnerIndex = engine.getCtfProgress().winner;
      // --- fl-overhaul --- (Stage 6) the fight's winner (its side, or a show's) and its name
      if (request.mode === "fightLeague") {
        const v = engine.getFightLeagueView();
        facts.winnerIndex = v.show.kind === "single" ? v.winnerTeam : v.show.winnerSide;
        facts.winnerName = flClipWinnerName(v) || null;
      }
      break;
    }
    // An escape settles the escape payoffs; follow it a few seconds to learn when the run ends.
    if ((recipe.strategy === "escape" || (recipe.strategy === "winner" && request.mode !== "stringBattle" && request.mode !== "fightLeague" /* --- fl-overhaul --- (Stage 6) */)) && facts.firstEscapeSec >= 0 && sec > facts.firstEscapeSec + Math.max(6, 0.25 * facts.firstEscapeSec)) break;
    if (++steps % FACTS_SLICE_STEPS === 0) yield elapsed; // --- insights --- (a pause between whole steps: the run is the same)
  }
  facts.summary = recipe.strategy === "winner" && request.mode !== "stringBattle" && request.mode !== "fightLeague" && atEscape ? atEscape : snapshot(elapsed, facts.finishSec >= 0);
  // --- fl-overhaul --- (Stage 6) a fight's story (RunSummary.fl, the cliffhanger's moment) and its double KO, as the finder sees them
  if (request.mode === "fightLeague") {
    const v = engine.getFightLeagueView();
    facts.summary = { ...facts.summary, fl: flRunSummary(v, facts.bothLowSec !== undefined && facts.bothLowSec >= 0 ? 1000 * facts.bothLowSec : -1), ...(facts.finishSec >= 0 ? { doubleKo: v.doubleKo } : {}) };
  }
  return facts;
}

/** The payoff second of a candidate (null: none within the run followed). */
export function payoffSecOf(recipe: Pick<BotRecipe, "strategy">, settings: SimulatorSettings, facts: RunFacts | null): number | null {
  switch (recipe.strategy) {
    case "cycle":
      return settings.mode === "polyrhythm" ? polyrhythmCycleSeconds(polyrhythmSettingsOf(settings)) : settings.pwCycleSeconds;
    case "fixed":
      return powerLayersPayoffSec(settings.plLayers, settings.plSequence, settings.plSpeed);
    default:
      break;
  }
  if (!facts) return null;
  let sec = -1;
  if (recipe.strategy === "escape") sec = facts.firstEscapeSec;
  else if (recipe.strategy === "winner") sec = settings.mode === "stringBattle" || settings.mode === "fightLeague" /* --- fl-overhaul --- (Stage 6) the final KO */ ? facts.finishSec : facts.firstEscapeSec;
  else if (recipe.strategy === "finish") {
    if (settings.mode === "glass") sec = facts.homeSec >= 0 ? facts.homeSec : facts.finishSec;
    else if (settings.mode === "race") sec = facts.winSec >= 0 ? facts.winSec : facts.finishSec;
    // Ball Drop ends once every ball has rested for a second: the last one landed that second before.
    else if (settings.mode === "drop") sec = facts.finishSec >= 0 ? Math.max(0, facts.finishSec - DROP_REST_SEC) : -1;
    else sec = facts.finishSec;
  }
  else if (recipe.strategy === "fill") sec = facts.fillSec;
  // --- templates --- the last note of a run that ended on its own (before its end it may not be the last)
  else if (recipe.strategy === "lastNote") sec = facts.finishSec >= 0 ? (facts.lastSoundSec ?? -1) : -1;
  return sec >= 0 ? sec : null;
}

/** When the run ends on its own after the payoff (s), or null when it does not within the clip (endless modes, analytic ones). */
function runEndSec(recipe: Pick<BotRecipe, "strategy">, settings: SimulatorSettings, facts: RunFacts | null, payoff: number): number | null {
  if (recipe.strategy === "fixed") return payoff + 1.8; // Power Layers: the freedom celebration, then the end
  if (recipe.strategy === "cycle" || recipe.strategy === "fill") return null;
  if (!facts || facts.finishSec < 0) return null;
  // A square race goes on after its winner crosses (the others finish, then the podium): the clip is cut at the payoff's
  // 85 % mark instead – unless the run is over (podium included) before that anyway.
  if (settings.mode === "race") return facts.finishSec + endHoldsSec(settings) <= payoff / PAYOFF_MID ? facts.finishSec : null;
  // --- templates --- after the last note the board only settles, silent: the clip is cut at the payoff's 85 % mark, or played
  // to the run's own end when that comes first
  if (recipe.strategy === "lastNote") return facts.finishSec + endHoldsSec(settings) <= payoff / PAYOFF_MID ? facts.finishSec : null;
  return facts.finishSec;
}

export interface ClipTiming {
  payoffSec: number | null;
  recordingDuration: number;
  clipSec: number;
  position: number | null;
  cutGapSec: number | null;
  /** The timing meets the ending's rule and the bucket. */
  accepted: boolean;
}

/**
 * The clip around a payoff: a resolved clip runs to the run's own end (plus the page's holds and the recorder's 0.5 s) or –
 * for a run that goes on – to the length that puts the payoff at 85 %; a cut-before-the-result clip ends 0.5–1 s before it.
 */
export function clipTiming(recipe: Pick<BotRecipe, "strategy">, settings: SimulatorSettings, facts: RunFacts | null, ending: EndingStyle, bucket: LengthBucket, payoffOverride?: number | null): ClipTiming {
  const range = BUCKET_SECONDS[bucket];
  const payoff = payoffOverride !== undefined ? payoffOverride : payoffSecOf(recipe, settings, facts);
  if (payoff === null) {
    // No payoff within the run followed: a cut clip of the bucket's length that never shows one (never-escapes).
    const d = clampInt((range.min + range.max) / 2, Math.max(R_DUR.min, range.min), Math.min(R_DUR.max, range.max));
    return { payoffSec: null, recordingDuration: d, clipSec: d, position: null, cutGapSec: null, accepted: false };
  }
  if (ending === "cliffhanger") {
    const d = Math.floor(payoff - CLIFF_GAP_SEC.min + 1e-9);
    const gap = payoff - d;
    const recordingDuration = clampInt(d, R_DUR.min, R_DUR.max);
    const ok = recordingDuration === d && gap >= CLIFF_GAP_SEC.min - 1e-9 && gap <= CLIFF_GAP_SEC.max + 1e-9 && d >= Math.max(R_DUR.min, range.min) && d <= range.max;
    return { payoffSec: payoff, recordingDuration, clipSec: recordingDuration, position: payoff / recordingDuration, cutGapSec: payoff - recordingDuration, accepted: ok };
  }
  const end = runEndSec(recipe, settings, facts, payoff);
  let recordingDuration: number;
  let clipSec: number;
  if (flSingle(settings)) {
    // --- fl-overhaul --- (Stage 6) one fight: the clip puts the KO at 85 % and is cut in the winner's card (it never runs past
    // the run's own end: the finale, the card's hold and the recorder's stop)
    recordingDuration = clampInt(Math.max(payoff / PAYOFF_MID, payoff + 1), R_DUR.min, R_DUR.max);
    clipSec = Math.min(recordingDuration, payoff + endHoldsSec(settings));
  } else if (end !== null) {
    const natural = end + endHoldsSec(settings);
    recordingDuration = clampInt(Math.ceil(natural), R_DUR.min, R_DUR.max);
    clipSec = Math.min(recordingDuration, natural);
  } else {
    const target = payoff / PAYOFF_MID;
    recordingDuration = clampInt(Math.max(target, payoff + 1), R_DUR.min, R_DUR.max);
    clipSec = recordingDuration;
  }
  const position = payoff / clipSec;
  const ok = payoff <= clipSec && position >= PAYOFF_BAND.from - 1e-9 && position <= PAYOFF_BAND.accept + 1e-9 && clipSec >= range.min - 0.5 && clipSec <= range.max + 0.5;
  return { payoffSec: payoff, recordingDuration, clipSec, position, cutGapSec: null, accepted: ok };
}

/**
 * Whether a candidate passes the seed finder's predicates for its ending: the payoff of a resolved escape comes inside the
 * clip's last 20 % (escapes-at, at the band's middle ± half its width), a cut clip shows no escape (never-escapes) and has
 * it 0.5–1 s after its end (escapes-at); a ring race names its winner (winner). Recipes without escapes pass on the timing.
 */
export function passesFinderPredicates(recipe: Pick<BotRecipe, "strategy" | "outcome">, facts: RunFacts | null, timing: ClipTiming, ending: EndingStyle, teamCount: number): { ok: boolean; winner: number } {
  let winner = -1;
  // --- fl-overhaul --- (Stage 6) a fight: its own predicates (the KO in the clip, the recipe's outcome, the cliffhanger's both-low-at)
  if (facts && facts.summary.mode === "fightLeague") return { ok: fightPredicates(recipe, facts, timing, ending), winner: facts.winnerIndex };
  if (facts && recipe.strategy === "winner" && teamCount >= 2) {
    for (let team = 0; team < teamCount; team++) {
      const outcome: FinderOutcome = { kind: "winner", clipSec: timing.clipSec, team };
      if (outcomeMatches(outcome, facts.summary)) winner = team;
    }
  }
  if (!facts || (recipe.strategy !== "escape" && !(recipe.strategy === "winner" && facts.summary.mode !== "stringBattle"))) return { ok: timing.accepted, winner };
  if (timing.payoffSec === null) return { ok: false, winner };
  const run = { ...facts.summary, durationMs: Math.max(facts.summary.durationMs, 1000 * timing.clipSec) };
  if (ending === "cliffhanger") {
    const never: FinderOutcome = { kind: "never-escapes", clipSec: timing.recordingDuration };
    const cut = { ...run, durationMs: 1000 * timing.recordingDuration, finished: false, firstEscapeMs: facts.firstEscapeSec * 1000 >= 1000 * timing.recordingDuration ? -1 : facts.firstEscapeSec * 1000 };
    const at: FinderOutcome = { kind: "escapes-at", clipSec: timing.recordingDuration, atSec: timing.recordingDuration + (CLIFF_GAP_SEC.min + CLIFF_GAP_SEC.max) / 2, toleranceSec: (CLIFF_GAP_SEC.max - CLIFF_GAP_SEC.min) / 2 };
    return { ok: timing.accepted && outcomeMatches(never, cut) && outcomeMatches(at, run), winner };
  }
  const mid = ((PAYOFF_BAND.from + PAYOFF_BAND.accept) / 2) * timing.clipSec;
  const at: FinderOutcome = { kind: "escapes-at", clipSec: timing.clipSec, atSec: mid, toleranceSec: ((PAYOFF_BAND.accept - PAYOFF_BAND.from) / 2) * timing.clipSec };
  return { ok: timing.accepted && outcomeMatches(at, run), winner };
}

// --- fl-overhaul --- (Stage 6)
/** How far before a fight cliffhanger's cut every side may have gone low (s): the last seconds of the clip show it. */
export const FIGHT_CLIFF_LOW_SEC = 3;

/**
 * A fight's predicates (the finder's, outcomes.ts): a resolved clip shows a finished fight – and the recipe's outcome (an upset)
 * when it has one; a cliffhanger is cut 0.5–1 s before the KO with every side already low in its last FIGHT_CLIFF_LOW_SEC
 * seconds (the both-low-at outcome, its window ending at the cut).
 */
export function fightPredicates(recipe: Pick<BotRecipe, "outcome">, facts: RunFacts, timing: ClipTiming, ending: EndingStyle): boolean {
  if (!timing.accepted || facts.finishSec < 0) return false;
  if (ending === "cliffhanger") {
    const cut = timing.recordingDuration;
    const low: FinderOutcome = { kind: "both-low-at", clipSec: cut, atSec: cut - FIGHT_CLIFF_LOW_SEC / 2, toleranceSec: FIGHT_CLIFF_LOW_SEC / 2 };
    return outcomeMatches(low, facts.summary) && facts.finishSec > cut;
  }
  if (recipe.outcome) return outcomeMatches({ kind: recipe.outcome, clipSec: timing.clipSec }, facts.summary);
  return facts.summary.finished;
}

/** The daily plan the running matchup episodes are counted over: the scheduled job's (3 clips, every family). */
export const MATCHUP_DAY_COUNT = 3;

/**
 * The running episode of a recipe's matchup on day `episode` (1 = BOT_EPOCH): one more than the days before it whose daily plan
 * (MATCHUP_DAY_COUNT clips, every family) played the same matchup – "Thor vs Loki #3". 1 for a recipe without matchups.
 */
export function matchupEpisode(recipe: Pick<BotRecipe, "id" | "matchup" | "wraps">, key: string, episode: number): number {
  if (!recipe.matchup) return 1;
  const series = recipe.wraps ?? recipe.id; // --- templates --- (a template's matchups count its recipe's days)
  let n = 1;
  for (let day = 0; day < episode - 1; day++) {
    for (const slot of daySlots(day, MATCHUP_DAY_COUNT)) if (slot.recipe.id === series && recipe.matchup(slot.planSeed).key === key) n++;
  }
  return n;
}
// --- end fl-overhaul ---

/* ------------------------------------------------------------------ settings and captions */

interface BuiltSettings {
  settings: SimulatorSettings;
  melodyId: string | null;
  preset: InstrumentPreset;
}

/**
 * The settings of a recipe for one variant: the mode's defaults, the bot's look and sound, the recipe's numbers – and, for the
 * Simple look (--- templates ---), SIMPLE_LOOK over them: look fields only, drawn after every seeded choice, so the numbers, the
 * sound and the run are the bot look's.
 */
export function recipeSettings(recipe: BotRecipe, ctx: RecipeContext, look: BotLookId = "bot"): BuiltSettings {
  const patch = recipe.settings(ctx);
  let s: SimulatorSettings = defaultSettings(patch.mode);
  // §3.9 neon on black, glow and trails
  s = applyTheme(s, BOT_LOOK.themeId);
  s.backgroundType = "gradient";
  s.backgroundColors = [...BOT_LOOK.background];
  s.showGlow = true;
  s.showWallGlow = true;
  s.showTrails = true;
  s.colorTrail = true;
  s.screenShake = recipe.family === "rhythm" ? 0 : 0.3;
  // §3.6 a note per bounce: piano or xylophone, snapped to a scale, a climbing public-domain melody on top
  const preset: InstrumentPreset = ctx.rng() < 0.6 ? "piano" : "xylophone";
  Object.assign(s, INSTRUMENT_PRESETS[preset]);
  s.rootNote = pick(ctx.rng, [0, 2, 5, 7]);
  const melodyId = recipe.musicFirst ? null : pick(ctx.rng, RISING_MELODIES);
  // §3.8 vertical 1080 × 1920 at 60 fps
  s.recordingResolution = BOT_FRAME.resolution;
  s.fastExportFps = BOT_FRAME.fps;
  // §1 geraldbounces: a character with a face and a name
  if (recipe.character) {
    s.ballFace = MASCOT.face;
    s.ballName = MASCOT.name;
    s.nameLabel = true;
    s.ballColor = MASCOT.color;
  }
  Object.assign(s, patch);
  if (look === "simple") Object.assign(s, simpleLookPatch(s, recipe.countdown.source)); // --- templates ---
  return { settings: s, melodyId, preset };
}

const hookStyle = { size: 1.2, color: "#ffffff", background: "#000000" };
const LIME = "#93d119";

/** --- templates --- How a clip's texts follow each other: stacked (the bot's: the countdown on from the start) or one at a time. */
export type TextPlan = "stack" | "oneLine";

/**
 * The captions of a clip (§3.2–3.5) and what each is for: the hook, the countdown, the payoff text or the closing question.
 * --- low-findings --- `payoffKey`: the recipe's copy of the payoff (`payoffKeyOf()`: a double KO's own words).
 * --- templates --- `textPlan` "oneLine" (the Simple look): one text at a time – the countdown caption comes after the hook and
 * leaves when the payoff's words or the closing question come, so no two texts are on screen together – and the payoff's words
 * cut by whole clauses toward 3 (templates.ts simplePayoffText), on one line where the clip's tail after them is too short for
 * two at 1.2 s a line (simplePayoffLines). `payoffText`: the payoff's words as drawn (null: none drawn).
 */
export function clipCaptions(recipe: BotRecipe, copy: BotCopy, hook: string, vars: Record<string, string | number>, timing: ClipTiming, ending: EndingStyle, hookEndSec: number, payoffKey = "payoff", textPlan: TextPlan = "stack"): { captions: Caption[]; roles: CaptionRole[]; payoffText: string | null } {
  const captions: Caption[] = [];
  const roles: CaptionRole[] = [];
  const add = (caption: Caption, role: CaptionRole) => {
    captions.push(caption);
    roles.push(role);
  };
  const oneLine = textPlan === "oneLine"; // --- templates --- (and its lines broken where a reader breaks them)
  let payoffText: string | null = null; // the payoff's words as drawn (none: no payoff words)
  const hookParts = captionLines(hook, hookStyle.size, 2, oneLine);
  for (const line of hookParts.lines) add({ ...defaultCaption("text", { text: line }), position: "top", start: 0, end: hookEndSec, animation: "pop", style: { ...hookStyle, size: hookParts.size } }, "hook");
  const clip = timing.recordingDuration;
  // when the closing question and the payoff's words come in (--- templates --- one text at a time: a question of two lines
  // gets 2.5 s, 1.25 s a line)
  const q = ending === "cliffhanger" ? captionLines(recipeText(copy, recipe, "cliffQuestion", vars), 1.2, 2, oneLine) : null;
  const questionStart = half(Math.max(hookEndSec + 0.5, clip - (oneLine && q && q.lines.length > 1 ? 2.5 : 2)));
  const payoffStart = timing.payoffSec !== null ? half(Math.max(hookEndSec + 0.5, Math.floor(timing.payoffSec * 2) / 2)) : null;
  if (recipe.countdown.source === "caption") {
    const label = copyString(copy, `countdown.${recipe.countdown.kind}`);
    const type = recipe.countdown.kind === "walls" ? "wallCounter" : recipe.countdown.kind === "percent" ? "progress" : "countdown";
    const base = defaultCaption(type, { text: label });
    // --- templates --- (one text at a time: from the hook's end to the next text, or to the clip's end without one)
    const window = oneLine ? { start: hookEndSec, end: ending === "cliffhanger" ? questionStart : (payoffStart ?? 0) } : { start: 0, end: 0 };
    add({ ...base, position: "top", start: window.start, end: window.end, style: { ...base.style, size: 1, color: LIME, background: type === "progress" ? "#27272a" : "#000000" } }, "countdown");
  }
  if (q) {
    for (const line of q.lines) add({ ...defaultCaption("question", { text: line }), position: "top", start: questionStart, end: 0, animation: "pop", style: { size: q.size, color: "#ffffff", background: "#000000" } }, "question");
  } else if (payoffStart !== null && recipe.payoffWords !== false /* --- templates --- */) {
    const words = recipeText(copy, recipe, payoffKey, vars);
    // --- templates --- (the Simple look: its words cut by clauses, on the lines the clip's tail after them has time for)
    const p = oneLine ? simplePayoffLines(simplePayoffText(words), Math.min(timing.clipSec, clip) - payoffStart) : { text: words, ...captionLines(words, 1.3, 2) };
    for (const line of p.lines) add({ ...defaultCaption("text", { text: line }), position: "top", start: payoffStart, end: 0, animation: "pop", style: { size: p.size, color: LIME, background: "#000000" } }, "payoff");
    payoffText = p.text;
  }
  return { captions, roles, payoffText };
}

/** The share link of a clip: the simulator with its settings and its seed (`seed=` pins the run). */
export function clipShareUrl(settings: SimulatorSettings, seed: number, locale: BotLocale, siteUrl?: string): string {
  const base = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/${locale}/simulator/` : pageUrl(locale, "/simulator");
  const params = settingsToSearchParams(settings);
  params.set("seed", seedParam(seed)); // --- low-findings --- (the engine's value, as parseSeed() reads it back)
  return `${base}?${params.toString()}`;
}

/** "ep012-1". */
export function episodeCode(episode: number, index: number): string {
  return `ep${String(Math.max(0, episode)).padStart(3, "0")}-${index}`;
}

/** The posting time of clip `index` (1-based) of a day on `platform`: its slots in turn, then evenly between 09:00 and 22:00. */
export function postingTimeFor(platform: BotPlatform, index: number, count: number): string {
  const slots = PLATFORMS[platform].postingTimes;
  if (count <= slots.length) return slots[Math.max(0, Math.min(slots.length - 1, index - 1))];
  const minutes = Math.round(9 * 60 + ((22 - 9) * 60 * (index - 1)) / Math.max(1, count - 1));
  const m = Math.round(minutes / 15) * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * --- low-findings --- The recipe's copy of a clip's payoff: "payoff" ("{winner} wins! 🏆"), or – for a battle whose last balls
 * fell in the same step, a double KO – its "payoffDoubleKo" ("Double KO – the last two fell together!") where the recipe has
 * one: the mode's own verdict still shares the win between them (its banner, the teams' stats), but nobody was left standing,
 * so the clip's words name no winner.
 */
export function payoffKeyOf(copy: BotCopy, recipe: Pick<BotRecipe, "copyKey">, facts: Pick<RunFacts, "summary"> | null): string {
  return facts?.summary.doubleKo === true && copyString(copy, `recipes.${recipe.copyKey}.payoffDoubleKo`) ? "payoffDoubleKo" : "payoff";
}

/* ------------------------------------------------------------------ planClip */

/** Builds the plan of one candidate (everything but the search). */
function assemblePlan(recipe: BotRecipe, built: BuiltSettings, seed: number, planSeed: number, platform: BotPlatform, bucket: LengthBucket, ending: EndingStyle, facts: RunFacts | null, timing: ClipTiming, winner: number, found: boolean, seedsTested: number, hookEndSec: number, options: PlanOptions): ClipPlan {
  const copy = options.copy;
  const locale = options.locale ?? "en";
  const episode = options.episode ?? 1;
  const index = options.index ?? 1;
  const settings: SimulatorSettings = { ...built.settings, recordingDuration: timing.recordingDuration };
  const simple = options.look === "simple"; // --- templates --- (the Simple look's text plan)
  // --- fl-overhaul --- (Stage 6) a matchup's series label: "Thor vs Loki #3" (its running episode), else the day's
  const matchupVars = recipe.matchup ? { ...recipe.hookVars(settings), ...recipeCopyVars(copy, recipe, settings), ep: matchupEpisode(recipe, recipe.matchup(planSeed).key, episode) } : null;
  const label = matchupVars && copyString(copy, `recipes.${recipe.copyKey}.seriesMatchup`) ? recipeText(copy, recipe, "seriesMatchup", matchupVars) : seriesLabel(copy, recipe, episode);
  // The series label is the Top Text – but an arena game's scoreboard band is where the recorder draws that line, so there
  // it is the Bottom Text (still above the bottom 20 % of the frame). --- templates --- The Simple look draws neither: the
  // label goes in the post caption.
  if (simple) {
    settings.topText = "";
    settings.bottomText = "";
  } else if (hasTopHud(settings.mode)) {
    settings.topText = "";
    settings.bottomText = sanitizeCaptionText(label, 60);
  } else settings.topText = sanitizeCaptionText(label, 60);
  const vars = { seconds: timing.recordingDuration, name: settings.ballName || MASCOT.name, ...recipe.hookVars(settings), ...recipeCopyVars(copy, recipe, settings), episode };
  const fullHook = recipeText(copy, recipe, ending === "cliffhanger" && copyString(copy, `recipes.${recipe.copyKey}.cliffHook`) ? "cliffHook" : "hook", vars);
  // --- templates --- (at most 7 words on the clip, a stake format's number kept; the whole hook in the post)
  const hook = simple ? simpleHookText(fullHook, recipe.stakeHook ? stakeNumbersOf(recipe.hookVars(settings)) : undefined) : fullHook;
  const winnerName = facts?.winnerName ? facts.winnerName /* --- fl-overhaul --- (Stage 6) a fight's winner */ : winner >= 0 ? (settings.teams[winner]?.name ?? `#${winner + 1}`) : null;
  const payoffKey = payoffKeyOf(copy, recipe, facts); // --- low-findings --- (a double KO names nobody: both fell)
  const payoffText = recipe.payoffWords === false ? "" : recipeText(copy, recipe, payoffKey, { ...vars, winner: winnerName ?? "" }); // --- templates --- (none drawn)
  // --- templates --- one text at a time: no countdown caption where a HUD on screen counts down already (the HUD is the countdown)
  const textRecipe: BotRecipe = simple && recipe.countdown.source === "caption" && hudShowsCountdown(settings) ? { ...recipe, countdown: { ...recipe.countdown, source: "hud" } } : recipe;
  const { captions, roles, payoffText: drawnPayoff } = clipCaptions(textRecipe, copy, hook, { ...vars, winner: winnerName ?? "" }, timing, ending, hookEndSec, payoffKey, simple ? "oneLine" : "stack");
  settings.captions = captions;
  const id = `${episodeCode(episode, index)}-${recipe.id}-${seed}`;
  const time = options.postingTime ?? PLATFORMS[platform].postingTimes[0];
  const bucketLabel = copyString(copy, `buckets.${bucket}`) || bucket;
  const answer = ending === "cliffhanger" ? (winnerName ?? (timing.payoffSec !== null ? payoffText : "")) : "";
  const post = postCopy(copy, { recipe, platform, ending, hook: fullHook, episode, vars, postingTime: time, bucketLabel, answer, ...(simple ? { series: label } : {}) /* --- templates --- */ });
  const plan: ClipPlan = {
    version: BOT_PLAN_VERSION,
    id,
    episode,
    episodeCode: episodeCode(episode, index),
    index,
    date: options.date ?? null,
    recipe: recipe.id,
    family: recipe.family,
    mode: settings.mode,
    platform,
    bucket,
    ending,
    endingChoice: options.ending ?? "auto",
    locale,
    planSeed,
    seed,
    settings,
    melodyId: built.melodyId,
    instrumentPreset: built.preset,
    captionRoles: roles,
    hook,
    countdown: { ...textRecipe.countdown },
    payoff: { type: recipe.payoff, atSec: timing.payoffSec, position: timing.position, cutGapSec: timing.cutGapSec, text: simple ? (drawnPayoff ?? simplePayoffText(payoffText)) : payoffText /* --- templates --- (the words it draws) */, winner: winnerName },
    timing: { recordingDuration: timing.recordingDuration, clipSec: timing.clipSec, firstImpactSec: facts && facts.firstImpactSec >= 0 ? facts.firstImpactSec : null, found, seedsTested },
    score: 0,
    reasons: [],
    shareUrl: clipShareUrl(settings, seed, locale, options.siteUrl),
    post: { caption: post.caption, question: post.question, hashtags: post.hashtags, keywords: post.keywords, note: post.note, time },
    series: { name: recipeText(copy, recipe, "series"), label, episode, roster: recipe.teams ? settings.teams.map((t) => t.name) : recipe.character ? [MASCOT.name] : [] },
    world: options.world ?? DEFAULT_BOT_WORLD,
    ...(options.template ? { template: options.template } : {}), // --- templates ---
    ...(simple ? { look: "simple" as const } : {}),
  };
  const scored = scoreClip(plan);
  plan.score = scored.score;
  plan.reasons = scored.reasons;
  return plan;
}

/**
 * Plans one clip of `recipe` for `platform`: settings from the recipe (seeded by `planSeed`), a physics seed whose payoff
 * lands where the ending wants it (the finder's engine and predicates), the captions, the share link and the post. A
 * generator: it yields after every seed it simulates; `planClip()` drains it.
 */
export function* planClipSteps(recipe: BotRecipe, planSeed: number, platform: BotPlatform, options: PlanOptions): Generator<PlanProgress, ClipPlan> {
  const bucket = recipeBucket(recipe, resolveBucket(platform, options.bucket));
  const episode = options.episode ?? 1;
  const index = options.index ?? 1;
  const ending = resolveEnding(options.ending, episode, index, recipe.endings);
  const world = options.world ?? DEFAULT_BOT_WORLD;
  const look: BotLookId = options.look ?? "bot"; // --- templates ---
  const maxSeeds = Math.max(1, Math.round(options.maxSeeds ?? DEFAULT_MAX_SEEDS));
  const search = options.search !== false;
  const range = BUCKET_SECONDS[bucket];
  let best: ClipPlan | null = null;
  // --- templates --- what the search ranks by and stops on: the bot look's score of the candidate, whatever look it is drawn
  // in. The Simple look charges points the bot look does not (the series label goes to the post), so ranked on its own score a
  // first seed of 96 would read 92, miss GOOD_ENOUGH and send the search on to other seeds and other numbers: the Simple look
  // would then change the physics, the payoff's timing and the run, which it promises to leave as they are.
  let bestRank = -Infinity;
  let bestAccepted = false;
  let accepted = 0;
  let tested = 0;
  const analytic = recipe.strategy === "cycle" || recipe.strategy === "fixed";
  const seedsPerVariant = analytic || !search ? 1 : SEEDS_PER_VARIANT;
  for (let variant = 0; tested < maxSeeds; variant++) {
    const rng = seededRandom(hashString(`${planSeed}|${recipe.id}|${platform}|${bucket}|${ending}|v${variant}`));
    // Where the payoff should come: a clip length drawn inside the bucket (at least the recorder's 10 s for a cut clip).
    const clipTarget = Math.max(ending === "cliffhanger" ? R_DUR.min : range.min, range.min + rng() * (range.max - range.min));
    const payoffTarget = ending === "cliffhanger" ? Math.floor(clipTarget) + (CLIFF_GAP_SEC.min + CLIFF_GAP_SEC.max) / 2 : clipTarget * ((PAYOFF_BAND.from + PAYOFF_BAND.to) / 2);
    const ctx: RecipeContext = { rng, bucket, ending, payoffTarget, roster: SERIES_ROSTER, planSeed /* --- fl-overhaul --- (Stage 6) */ };
    const botBuilt = recipeSettings(recipe, ctx, "bot");
    // --- templates --- the Simple look over the same draw (recipeSettings' own patch: look fields only)
    const built: BuiltSettings = look === "simple" ? { ...botBuilt, settings: { ...botBuilt.settings, ...simpleLookPatch(botBuilt.settings, recipe.countdown.source) } } : botBuilt;
    const drawnHookEnd = rng() < 0.5 ? HOOK_SEC.min + 0.5 : HOOK_SEC.max;
    const hookEndSec = look === "simple" ? SIMPLE_TEXT.hookEndSec : drawnHookEnd; // --- templates --- (the draw is made either way: the same generator after it)
    // The simulation runs a little past where the latest acceptable payoff could come.
    const horizon = Math.min(R_DUR.max + 5, (ending === "cliffhanger" ? range.max + 2 : range.max / PAYOFF_BAND.from) + 2);
    const request = finderRequestOfSettings({ ...built.settings, recordingDuration: Math.min(R_DUR.max, Math.ceil(horizon)) }, world, horizon, recipe.outcome ? { kind: recipe.outcome, clipSec: horizon } : undefined /* --- fl-overhaul --- (Stage 6) */);
    for (let k = 0; k < seedsPerVariant && tested < maxSeeds; k++) {
      const seed = candidateSeed(planSeed, recipe.id, tested);
      tested++;
      const facts = search ? simulateFacts(request, seed, recipe, horizon) : null;
      const override = search ? undefined : analytic ? undefined : payoffTarget;
      const timing = clipTiming(recipe, built.settings, facts, ending, bucket, override);
      const teamCount = facts ? facts.summary.teams.length : 0;
      const verdict = search ? passesFinderPredicates(recipe, facts, timing, ending, teamCount) : { ok: false, winner: -1 };
      const winner = verdict.winner >= 0 ? verdict.winner : (facts?.winnerIndex ?? -1);
      const plan = assemblePlan(recipe, built, seed, planSeed, platform, bucket, ending, facts, timing, winner, verdict.ok, tested, hookEndSec, options);
      // --- templates --- (the bot look's plan of this candidate, for its score: see bestRank)
      const rank = look === "bot" ? plan.score : assemblePlan(recipe, botBuilt, seed, planSeed, platform, bucket, ending, facts, timing, winner, verdict.ok, tested, drawnHookEnd, { ...options, look: "bot" }).score;
      if (verdict.ok) accepted++;
      if (!best || (verdict.ok && !bestAccepted) || (verdict.ok === bestAccepted && rank > bestRank)) {
        best = plan;
        bestRank = rank;
        bestAccepted = verdict.ok;
      }
      yield { seedsTested: tested, maxSeeds };
      if (!search || (bestAccepted && (bestRank >= GOOD_ENOUGH || accepted >= MAX_ACCEPTED))) {
        best.timing.seedsTested = tested;
        return look === "simple" && search ? yield* placedSimple(best, options, maxSeeds) : best; // --- templates ---
      }
    }
  }
  best!.timing.seedsTested = tested;
  return look === "simple" && search ? yield* placedSimple(best!, options, maxSeeds) : best!; // --- templates ---
}

/**
 * --- templates --- (review round 1, 26) A Simple plan with its texts where its run leaves the square clear (placeSimpleTexts):
 * its seed played again to the clip's end for its action track (pausing as the search does), and the plan's link and score
 * read again when a text moved. Only a searched plan: a plan without the search has no run to read.
 */
function* placedSimple(plan: ClipPlan, options: PlanOptions, maxSeeds: number): Generator<PlanProgress, ClipPlan> {
  if (!bottomEdgeFree(plan.settings)) return plan;
  const steps = actionTrackSteps(plan.settings, plan.seed, plan.world, plan.timing.clipSec);
  let track: ActionTrack;
  for (;;) {
    const next = steps.next();
    if (next.done) {
      track = next.value;
      break;
    }
    yield { seedsTested: plan.timing.seedsTested, maxSeeds };
  }
  const captions = placeSimpleTexts(plan.settings.captions, plan.captionRoles, track, plan.settings, plan.timing.clipSec);
  if (JSON.stringify(captions) === JSON.stringify(plan.settings.captions)) return plan;
  const settings: SimulatorSettings = { ...plan.settings, captions };
  const placed: ClipPlan = { ...plan, settings, shareUrl: clipShareUrl(settings, plan.seed, plan.locale, options.siteUrl) };
  const scored = scoreClip(placed);
  return { ...placed, score: scored.score, reasons: scored.reasons };
}

export function planClip(recipe: BotRecipe, planSeed: number, platform: BotPlatform, options: PlanOptions): ClipPlan {
  return drain(planClipSteps(recipe, planSeed, platform, options));
}

// --- templates ---
/**
 * Plans one clip of a ready template (templates.ts): its recipe – the wrapped one pinned to the template's mode, buckets and
 * endings – planned like any other, in the template's look (Simple) unless `options.look` names another; the plan records the
 * template. Throws for a hidden or unknown template.
 */
export function* planTemplateSteps(templateId: string, planSeed: number, platform: BotPlatform, options: PlanOptions): Generator<PlanProgress, ClipPlan> {
  const recipe = templateRecipeById(templateId);
  if (!recipe) throw new Error(`Not a ready template: ${templateId}`);
  return yield* planClipSteps(recipe, planSeed, platform, { ...options, look: options.look ?? TEMPLATE_LOOK, template: templateId });
}

export function planTemplate(templateId: string, planSeed: number, platform: BotPlatform, options: PlanOptions): ClipPlan {
  return drain(planTemplateSteps(templateId, planSeed, platform, options));
}
// --- end templates ---

/* ------------------------------------------------------------------ scoreClip */

const hudShowsCountdown = (s: SimulatorSettings): boolean => {
  if (s.mode === "stringBattle") return s.sbHud;
  if (s.mode === "fightLeague") return s.flHud; // --- fl-overhaul --- (Stage 6) the HP bars
  return ["powerLayers", "battle", "race", "ctf", "glass", "multipliers"].includes(s.mode);
};

const luminance = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

/**
 * Scores a plan 0–100 against the checklist of docs/virality-playbook.md §3 (CHECKLIST): motion in the first second, the
 * hook on screen and inside the safe zone, a visible countdown, the payoff in the last 20 % (or 0.5–1 s after a cut), a
 * length that fits the bucket and the platform, sound with a melody, the ending, series continuity and the look. Pure: it
 * reads the plan only, so it ranks candidates and shows the user why a clip was picked.
 */
export function scoreClip(plan: ClipPlan): { score: number; reasons: ScoreReason[] } {
  const s = plan.settings;
  const recipe = botRecipeById(plan.recipe); // --- templates --- (a playbook recipe, or a template's: its sound and its cast)
  const reasons: ScoreReason[] = [];
  const max = (id: ChecklistId) => CHECKLIST.find((c) => c.id === id)!.points;
  const add = (id: ChecklistId, points: number, key: string, values: Record<string, string | number> = {}) => reasons.push({ id, points: Math.max(0, Math.min(max(id), points)), max: max(id), key, values });
  const topText = !!s.topText.trim();
  // The Top Text over an arena game's scoreboard band: neither can be read.
  const topHud = hasTopHud(s.mode);
  const covered = topText && topHud;

  // 1. motion in the first second
  const impact = plan.timing.firstImpactSec;
  if (impact === null) add("motion", 5, "motionUnknown");
  else if (impact <= FIRST_IMPACT_SEC) add("motion", 10, "motionOk", { sec: impact.toFixed(1) });
  else if (impact <= 2 * FIRST_IMPACT_SEC) add("motion", 5, "motionLate", { sec: impact.toFixed(1) });
  else add("motion", 0, "motionSlow", { sec: impact.toFixed(1) });

  // 2. the hook: on screen from the start for 2–3 s, inside the safe zone
  const hookIdx = plan.captionRoles.map((r, i) => (r === "hook" ? i : -1)).filter((i) => i >= 0 && s.captions[i]);
  const hookCaps = hookIdx.map((i) => s.captions[i]);
  const hookText = captionWordsOf(s.captions, hookIdx); // --- templates --- (a bottom stack's lines read upwards)
  if (!hookText) add("hook", 0, "hookMissing");
  else {
    const timed = hookCaps.every((c) => c.start <= 0.05 && c.end >= HOOK_SEC.min - 1e-9 && c.end <= HOOK_SEC.max + 0.5 + 1e-9);
    const safe = hookIdx.every((i) => {
      const box = captionBoxAt(s.captions, i, 0.1, BOT_FRAME, topText, topHud);
      return !!box && inSafeZone(box);
    });
    add("hook", (timed ? 8 : 3) + (safe ? 7 : 0), safe ? (timed ? "hookOk" : "hookTiming") : "hookUnsafe", { text: hookText });
  }

  // 3. a visible countdown
  const cdIdx = plan.captionRoles.findIndex((r) => r === "countdown");
  if (cdIdx >= 0 && s.captions[cdIdx]) {
    const box = captionBoxAt(s.captions, cdIdx, Math.max(0.1, (s.captions[cdIdx].start || 0) + 0.1), BOT_FRAME, topText, topHud);
    add("countdown", box && inSafeZone(box) ? 10 : 5, box && inSafeZone(box) ? "countdownCaption" : "countdownUnsafe", { kind: plan.countdown.kind });
  } else if (plan.countdown.source === "hud" && hudShowsCountdown(s)) {
    if (covered) add("countdown", 3, "countdownHudCovered", { kind: plan.countdown.kind });
    else add("countdown", 10, "countdownHud", { kind: plan.countdown.kind });
  }
  else add("countdown", 0, "countdownMissing");

  // 4. the payoff: the last 10–20 % of a resolved clip, 0.5–1 s after the end of a cut one
  const p = plan.payoff;
  if (plan.ending === "resolved") {
    if (p.position === null || p.atSec === null) add("payoff", 0, "payoffMissing");
    else {
      const pct = Math.round(100 * p.position);
      if (p.position >= PAYOFF_BAND.from - 1e-9 && p.position <= PAYOFF_BAND.to + 1e-9) add("payoff", 20, "payoffOk", { sec: p.atSec.toFixed(1), pct });
      else if (p.position > PAYOFF_BAND.to && p.position <= PAYOFF_BAND.accept + 1e-9) add("payoff", 16, "payoffTight", { sec: p.atSec.toFixed(1), pct });
      else if (p.position >= 0.7 && p.position <= 1) add("payoff", 8, "payoffOff", { sec: p.atSec.toFixed(1), pct });
      else add("payoff", 0, "payoffOff", { sec: p.atSec.toFixed(1), pct });
    }
  } else if (p.cutGapSec === null) add("payoff", 12, "payoffNever");
  else if (p.cutGapSec >= CLIFF_GAP_SEC.min - 1e-9 && p.cutGapSec <= CLIFF_GAP_SEC.max + 1e-9) add("payoff", 20, "payoffCut", { gap: p.cutGapSec.toFixed(1) });
  else if (p.cutGapSec > 0 && p.cutGapSec <= 3) add("payoff", 10, "payoffCutFar", { gap: p.cutGapSec.toFixed(1) });
  else add("payoff", 0, "payoffCutWrong", { gap: p.cutGapSec.toFixed(1) });

  // 5. length: inside the bucket, a bucket that suits the platform
  const range = BUCKET_SECONDS[plan.bucket];
  const clip = plan.timing.clipSec;
  const inBucket = clip >= range.min - 0.5 && clip <= range.max + 0.5;
  const platform = PLATFORMS[plan.platform];
  const fits = platform.buckets.includes(plan.bucket);
  const lengthPoints = (inBucket ? 5 : 0) + (fits ? 3 : 0) + (plan.bucket === platform.defaultBucket ? 2 : 0);
  add("length", lengthPoints, inBucket ? (fits ? "lengthOk" : "lengthPlatform") : "lengthOut", { sec: clip.toFixed(1), min: range.min, max: range.max });

  // 6. sound: a melody (or the mode's own note ladder), on a scale, piano or xylophone
  const melodic = !!plan.melodyId || !!recipe?.musicFirst;
  const scaled = s.scale !== "chromatic";
  const voice = Object.values(INSTRUMENT_PRESETS).some((v) => v.instrument === s.instrument && v.melodyInstrument === s.melodyInstrument);
  add("sound", (melodic ? 5 : 0) + (scaled ? 3 : 0) + (voice ? 2 : 0), melodic && scaled ? "soundOk" : "soundFlat", { melody: plan.melodyId ?? "" });

  // 7. the ending: a tight tail after a resolved payoff (the loop), the question on a cut clip
  if (plan.ending === "resolved") {
    // The mode's own end screen (a winner banner) belongs to the payoff; the tail beyond it is what breaks the loop.
    const tail = p.atSec === null ? Infinity : clip - p.atSec;
    const allowance = endHoldsSec(s) - HOLD_SEC.stop;
    add("ending", tail <= 2.5 + allowance ? 10 : tail <= 4 + allowance ? 6 : 2, tail <= 4 + allowance ? "endingLoop" : "endingLongTail", { tail: Number.isFinite(tail) ? tail.toFixed(1) : "–" });
  } else {
    const q = plan.captionRoles.findIndex((r) => r === "question");
    add("ending", q >= 0 && s.captions[q] ? 10 : 4, q >= 0 ? "endingQuestion" : "endingNoQuestion");
  }

  // 8. series: the label on the clip (the Top Text, or the Bottom Text under an arena game's scoreboard) where it can be read,
  // the episode, the recurring cast
  const castOk = recipe?.teams ? s.teams.length > 0 && s.teams.every((t) => SERIES_ROSTER.some((r) => r.name === t.name && r.color === t.color)) : recipe?.character ? s.ballName === MASCOT.name : true;
  const label = topText ? s.topText.trim() : s.bottomText.trim();
  const labelShown = !!label && !covered && inSafeZone(edgeTextBox(label, topText ? "top" : "bottom", BOT_FRAME, s.textSize));
  add("series", (labelShown ? 4 : 0) + (plan.episode >= 1 ? 3 : 0) + (castOk ? 3 : 0), covered ? "seriesCovered" : labelShown && castOk ? "seriesOk" : "seriesWeak", { label });

  // 9. the look: neon on black, glow and trails
  const dark = s.backgroundColors.every((c) => luminance(c) < 0.12);
  add("look", (s.themeId === BOT_LOOK.themeId && dark ? 3 : 0) + (s.showGlow && s.showTrails ? 2 : 0), s.themeId === BOT_LOOK.themeId && dark ? "lookOk" : "lookOff");

  return { score: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

/* ------------------------------------------------------------------ a day of clips */

export interface DaySlot {
  recipe: BotRecipe;
  /** 1-based place in the day. */
  index: number;
  planSeed: number;
}

/**
 * The recipes of day `dayIndex` (pure, no simulation): the families take turns clip by clip, led by a different family each
 * day, and every family's recipes are split into two alternating halves – even days use one, odd days the other – so no
 * recipe is planned two days in a row, whatever the count. Within its half a family's recipes rotate every other day.
 */
export function daySlots(dayIndex: number, count: number, family?: BotFamilyChoice, salt = "", bucket?: LengthBucket): DaySlot[] {
  // --- legal-audit --- "default" (the CLI without --family) keeps the rotation but leaves the battle family out; only "all" and "battle" plan the Fight League recipes
  const rotation = [0, 1, 2].map((k) => BOT_FAMILIES[mod(dayIndex + k, BOT_FAMILIES.length)]);
  const families: BotFamily[] = !family || family === "all" ? rotation : family === "default" ? rotation.filter((f) => BOT_DEFAULT_FAMILIES.includes(f)) : [family];
  const parity = mod(dayIndex, 2);
  // Today's half of each family – the recipes that can fill the bucket asked for, when some can (a subset keeps the halves apart).
  const pools = families.map((f) => {
    const half = recipesOfFamily(f).filter((_, i) => i % 2 === parity);
    const fitting = bucket ? half.filter((r) => supportsBucket(r, bucket)) : half;
    return fitting.length > 0 ? fitting : half;
  });
  const slots: DaySlot[] = [];
  const turn = Math.floor(dayIndex / 2);
  for (let i = 0; slots.length < count && i < count * families.length + families.length; i++) {
    const f = i % families.length;
    const pool = pools[f];
    if (pool.length === 0) continue;
    const round = Math.floor(i / families.length);
    const recipe = pool[mod(turn + round, pool.length)];
    slots.push({ recipe, index: slots.length + 1, planSeed: hashString(`day|${dayIndex}|${slots.length}|${recipe.id}${salt ? `|${salt}` : ""}`) });
  }
  return slots;
}

export interface DayPlan {
  version: number;
  date: string;
  dayIndex: number;
  episode: number;
  platform: BotPlatform;
  clips: ClipPlan[];
}

export interface DayOptions extends Omit<PlanOptions, "episode" | "index" | "date" | "postingTime"> {
  family?: BotFamilyChoice;
  /** Anything but "" plans a different set of clips for the same day (the panel's "Plan clips"; "Today's plan" has none). */
  salt?: string;
}

/** Plans day `date` ("YYYY-MM-DD", or a Date's local day): the same date gives the same plan. A generator, like planClipSteps. */
export function* planDaySteps(date: string | Date, platform: BotPlatform, count: number, options: DayOptions): Generator<PlanProgress & { clip: number; clips: number }, DayPlan> {
  const iso = typeof date === "string" ? date.trim() : localIsoDate(date);
  const dayIndex = dayIndexOf(iso);
  const episode = Math.max(1, dayIndex + 1);
  const slots = daySlots(dayIndex, clampInt(count, 1, 50), options.family, options.salt ?? "", resolveBucket(platform, options.bucket));
  const clips: ClipPlan[] = [];
  for (const slot of slots) {
    const steps = planClipSteps(slot.recipe, slot.planSeed, platform, { ...options, episode, index: slot.index, date: iso, postingTime: postingTimeFor(platform, slot.index, slots.length) });
    for (;;) {
      const next = steps.next();
      if (next.done) {
        clips.push(next.value);
        break;
      }
      yield { ...next.value, clip: slot.index, clips: slots.length };
    }
  }
  return { version: BOT_PLAN_VERSION, date: iso, dayIndex, episode, platform, clips };
}

export function planDay(date: string | Date, platform: BotPlatform, count: number, options: DayOptions): DayPlan {
  return drain(planDaySteps(date, platform, count, options));
}

/** The next plan seed of a re-roll. */
export function rerollSeed(planSeed: number): number {
  return hashString(`reroll|${planSeed}`);
}

/**
 * Plans the clip again with the next plan seed – new settings and a new physics seed, the same place, day and ending choice.
 * --- templates --- A template's plan is re-planned from its template, in its own look.
 */
export function* rerollClipSteps(plan: ClipPlan, options: Omit<PlanOptions, "episode" | "index" | "date">): Generator<PlanProgress, ClipPlan> {
  const recipe = botRecipeById(plan.recipe);
  if (!recipe) throw new Error(`Unknown recipe ${plan.recipe}`);
  return yield* planClipSteps(recipe, rerollSeed(plan.planSeed), plan.platform, {
    ...options,
    bucket: plan.bucket,
    ending: plan.ending,
    episode: plan.episode,
    index: plan.index,
    date: plan.date,
    postingTime: plan.post.time,
    look: plan.look ?? "bot", // --- templates ---
    template: plan.template,
  });
}

/** The locales the bot writes in (messages/*.json). */
export const PLANNER_LOCALES = BOT_LOCALES;

/** A copy template filled in (re-exported for the page and the CLI). */
export { fillTemplate };
