import { normalizeHexColor } from "@/lib/themes";
import { atLeastMin } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Animated captions – overlays beyond the plain top / bottom text, drawn on the canvas (so every recording has
 * them) and animated on the simulation clock. Pure data and maths, no DOM, unit-tested in tests/captions.test.ts;
 * the drawing lives in components/simulator/captionsRenderer.ts and the panel in sections/CaptionsSection.tsx.
 *
 * - `countdown`: the time left to the end of the clip (the recording length), "0:27";
 * - `wallCounter`: walls broken / walls in play, "Wall 3/10" (hidden in the modes without rings);
 * - `progress`: a bar of the elapsed time over the clip length;
 * - `question`: a question ("Will it escape?") whose answer pops in the moment a ball escapes or the run finishes;
 * - `text`: free text with its own timing.
 *
 * Every caption has a position (top / center / bottom of the square the recorder exports), a window in seconds of
 * simulation time (`start`, `end`; an end of 0 – or one not after the start – means "until the end of the run"),
 * an entrance / exit animation (fade / slide / pop) and a style (size, text colour, background pill). The list
 * travels in links as one compact parameter (`cap`) and in presets as it is. Nothing here reaches the physics:
 * the tracker below only reads the engine, so seeds, recordings and the finder are untouched.
 */

export const CAPTION_TYPES = ["countdown", "wallCounter", "progress", "question", "text"] as const;
export type CaptionType = (typeof CAPTION_TYPES)[number];
export const CAPTION_POSITIONS = ["top", "center", "bottom"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export const CAPTION_ANIMATIONS = ["fade", "slide", "pop"] as const;
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];

export function isCaptionType(value: unknown): value is CaptionType {
  return typeof value === "string" && (CAPTION_TYPES as readonly string[]).includes(value);
}
export function isCaptionPosition(value: unknown): value is CaptionPosition {
  return typeof value === "string" && (CAPTION_POSITIONS as readonly string[]).includes(value);
}
export function isCaptionAnimation(value: unknown): value is CaptionAnimation {
  return typeof value === "string" && (CAPTION_ANIMATIONS as readonly string[]).includes(value);
}

export interface CaptionStyle {
  /** Text size as a multiple of the base caption size, 0.5–3. */
  size: number;
  /** "#rrggbb": the text (and the progress bar's fill). */
  color: string;
  /** "#rrggbb" pill behind the text (the progress bar's track), drawn at `BACKGROUND_ALPHA`; "" = none (a drop shadow keeps the text readable). */
  background: string;
}

export interface Caption {
  type: CaptionType;
  /**
   * question: the question; text: the text; countdown / wallCounter / progress: an optional label – `[time]`,
   * `[n]` / `[total]` and `[pct]` are filled in, a label without them is put in front of the value.
   */
  text: string;
  /** question: the answer revealed when a ball escapes or the run finishes ("" = no reveal). */
  answer: string;
  position: CaptionPosition;
  /** Seconds of simulation time at which the caption enters. */
  start: number;
  /** Seconds of simulation time at which it has left; 0 (or anything not after `start`) = until the end of the run. */
  end: number;
  animation: CaptionAnimation;
  style: CaptionStyle;
}

export interface CaptionSettings {
  /** The captions, drawn in this order (top ones stack downwards, bottom ones upwards); empty = none (URL `cap`). */
  captions: Caption[];
}

export function defaultCaptionSettings(): CaptionSettings {
  return { captions: [] };
}

/** The most captions a clip carries. */
export const MAX_CAPTIONS = 8;
/** Longest caption text and answer (in characters). */
export const MAX_CAPTION_TEXT_LENGTH = 80;
export const MAX_CAPTION_ANSWER_LENGTH = 40;
/** Seconds an entrance, an exit and the answer's reveal take (simulation time). */
export const CAPTION_ENTER_SEC = 0.4;
export const CAPTION_EXIT_SEC = 0.3;
export const CAPTION_REVEAL_SEC = 0.5;
/** Opacity of the background pill. */
export const BACKGROUND_ALPHA = 0.72;
/** How far (in caption heights) a sliding caption travels. */
export const SLIDE_DISTANCE = 1.2;
/** Real milliseconds the end screen (and a recording) waits after a question's answer was revealed at the finish. */
export const CAPTION_ANSWER_HOLD_MS = 2000;
/** The last seconds of a countdown pulse on every tick. */
export const COUNTDOWN_PULSE_SECONDS = 5;

/** Slider ranges of the caption editor, keyed like `RANGES` in settings.ts (which spreads them). */
export const CAPTION_RANGES = {
  captionStart: { min: 0, max: 120, step: 0.5 },
  captionEnd: { min: 0, max: 120, step: 0.5 },
  captionSize: { min: 0.5, max: 3, step: 0.1 },
} as const;

/** The look a caption of each type starts with (the panel's "Add" buttons). */
const TYPE_DEFAULTS: Record<CaptionType, Omit<Caption, "type" | "text" | "answer">> = {
  countdown: { position: "top", start: 0, end: 0, animation: "pop", style: { size: 1.2, color: "#ffffff", background: "#000000" } },
  wallCounter: { position: "top", start: 0, end: 0, animation: "slide", style: { size: 1, color: "#93d119", background: "#000000" } },
  progress: { position: "bottom", start: 0, end: 0, animation: "fade", style: { size: 1, color: "#93d119", background: "#27272a" } },
  question: { position: "top", start: 0, end: 0, animation: "pop", style: { size: 1.3, color: "#ffffff", background: "#000000" } },
  text: { position: "bottom", start: 0, end: 0, animation: "fade", style: { size: 1, color: "#ffffff", background: "" } },
};

/** A new caption of `type` with its default look, optionally with a (translated) text and answer. */
export function defaultCaption(type: CaptionType, texts: { text?: string; answer?: string } = {}): Caption {
  const d = TYPE_DEFAULTS[type];
  return { type, text: texts.text ?? "", answer: type === "question" ? (texts.answer ?? "") : "", position: d.position, start: d.start, end: d.end, animation: d.animation, style: { ...d.style } };
}

/* ------------------------------------------------------------------ validation */

// Control characters and the Unicode line / paragraph separators (the zero-width joiner and variation selectors emoji need stay).
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** A caption text as stored: no control characters, whitespace collapsed, trimmed, at most `max` characters. */
export function sanitizeCaptionText(value: unknown, max = MAX_CAPTION_TEXT_LENGTH): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(CONTROL, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Rounds to the slider step (0.5 s, 0.1×) so values survive links and presets unchanged. */
function toStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** A valid caption from anything (a preset entry, a parsed link), or null when its type is unknown. */
export function sanitizeCaption(value: unknown): Caption | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<Record<keyof Caption, unknown>>;
  if (!isCaptionType(source.type)) return null;
  const d = defaultCaption(source.type);
  const style = (source.style && typeof source.style === "object" ? source.style : {}) as Partial<Record<keyof CaptionStyle, unknown>>;
  const background = style.background === "" ? "" : (normalizeHexColor(style.background) ?? d.style.background);
  return {
    type: source.type,
    text: sanitizeCaptionText(source.text),
    answer: source.type === "question" ? sanitizeCaptionText(source.answer, MAX_CAPTION_ANSWER_LENGTH) : "",
    position: isCaptionPosition(source.position) ? source.position : d.position,
    start: toStep(clampNumber(source.start, CAPTION_RANGES.captionStart, d.start), CAPTION_RANGES.captionStart.step),
    end: toStep(clampNumber(source.end, CAPTION_RANGES.captionEnd, d.end), CAPTION_RANGES.captionEnd.step),
    animation: isCaptionAnimation(source.animation) ? source.animation : d.animation,
    style: {
      size: Math.round(10 * clampNumber(style.size, CAPTION_RANGES.captionSize, d.style.size)) / 10,
      color: normalizeHexColor(style.color) ?? d.style.color,
      background,
    },
  };
}

/** A valid caption list: at most MAX_CAPTIONS entries, unknown types dropped (anything but an array is no captions). */
export function resolveCaptions(value: unknown): Caption[] {
  if (!Array.isArray(value)) return [];
  const out: Caption[] = [];
  for (const entry of value) {
    if (out.length >= MAX_CAPTIONS) break;
    const caption = sanitizeCaption(entry);
    if (caption) out.push(caption);
  }
  return out;
}

/** Validates the caption field of a preset (or any settings-like object). */
export function resolveCaptionSettings(source: Partial<Record<keyof CaptionSettings, unknown>> | null | undefined): CaptionSettings {
  return { captions: resolveCaptions(source?.captions) };
}

/** Picks the caption field out of the settings, copying the list. */
export function captionSettingsOf(settings: CaptionSettings): CaptionSettings {
  return { captions: settings.captions.map((c) => ({ ...c, style: { ...c.style } })) };
}

/** What a mode change keeps: the captions (they are overlays, independent of the mode). */
export function captionCarryOver(settings: CaptionSettings): CaptionSettings {
  return captionSettingsOf(settings);
}

/* ------------------------------------------------------------------ URL form */

const TYPE_CODES: Record<CaptionType, string> = { countdown: "cd", wallCounter: "wc", progress: "pg", question: "q", text: "tx" };
const POSITION_CODES: Record<CaptionPosition, string> = { top: "t", center: "c", bottom: "b" };
const ANIMATION_CODES: Record<CaptionAnimation, string> = { fade: "f", slide: "s", pop: "p" };

function decode<T extends string>(codes: Record<T, string>, code: string): T | undefined {
  return (Object.keys(codes) as T[]).find((key) => codes[key] === code);
}

/** `%`, `*` and `,` inside a text are percent-escaped, so the separators always split correctly. */
function escapeField(value: string): string {
  return value.replace(/[%*,]/g, (c) => (c === "%" ? "%25" : c === "*" ? "%2A" : "%2C"));
}

function unescapeField(value: string): string {
  return value.replace(/%(25|2A|2C)/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/**
 * The compact URL form: per caption `type*position*start*end*animation*size*color*background*text*answer`
 * (short codes, colours without "#", an empty background = none, empty trailing texts left out), captions joined
 * by commas – e.g. `q*t*0*0*p*1.3*ffffff*000000*Will it escape?*YES!,cd*b*0*0*p*1.2*ffffff*000000`.
 */
export function serializeCaptions(captions: readonly Caption[]): string {
  return resolveCaptions(captions)
    .map((c) => {
      const fields = [
        TYPE_CODES[c.type],
        POSITION_CODES[c.position],
        formatNumber(c.start),
        formatNumber(c.end),
        ANIMATION_CODES[c.animation],
        formatNumber(c.style.size),
        c.style.color.slice(1),
        c.style.background.slice(1),
        escapeField(c.text),
        escapeField(c.answer),
      ];
      while (fields.length > 8 && fields[fields.length - 1] === "") fields.pop();
      return fields.join("*");
    })
    .join(",");
}

/** Reads the URL form back: unknown types are skipped, every other bad field falls back to the type's default. */
export function parseCaptions(text: string | null | undefined): Caption[] {
  if (!text) return [];
  const out: Caption[] = [];
  for (const part of text.split(",")) {
    if (out.length >= MAX_CAPTIONS) break;
    if (!part) continue;
    const [typeCode = "", pos = "", start = "", end = "", anim = "", size = "", color = "", background, captionText = "", answer = ""] = part.split("*");
    const type = decode(TYPE_CODES, typeCode);
    if (!type) continue;
    const caption = sanitizeCaption({
      type,
      text: unescapeField(captionText),
      answer: unescapeField(answer),
      position: decode(POSITION_CODES, pos),
      start,
      end,
      animation: decode(ANIMATION_CODES, anim),
      style: { size, color, background: background === "" ? "" : background === undefined ? undefined : `#${background}` },
    });
    if (caption) out.push(caption);
  }
  return out;
}

/** Writes `cap` when there are captions (the default – none – keeps links short). */
export function writeCaptionParams(settings: CaptionSettings, params: URLSearchParams): void {
  if (settings.captions.length > 0) params.set("cap", serializeCaptions(settings.captions));
}

/** Reads `cap` into `settings` (no parameter = no captions). */
export function readCaptionParams(params: URLSearchParams, settings: CaptionSettings): void {
  settings.captions = parseCaptions(params.get("cap"));
}

/* ------------------------------------------------------------------ timing and animation */

/** True when the caption stays until the end of the run (end 0, or not after the start). */
export function isOpenEnded(caption: Pick<Caption, "start" | "end">): boolean {
  return !(caption.end > caption.start);
}

/**
 * How far the answer of a question caption has popped in at simulation second `t` (0–1): 0 without an answer or
 * before the reveal (`revealAtSec` < 0 = not yet), counted from the reveal – or from the caption's start, when the
 * reveal came first.
 */
export function questionReveal(caption: Pick<Caption, "type" | "answer" | "start">, t: number, revealAtSec: number): number {
  if (caption.type !== "question" || !caption.answer.trim() || !(revealAtSec >= 0)) return 0;
  const from = Math.max(revealAtSec, caption.start);
  if (!(t >= from)) return 0;
  return Math.min(1, (t - from) / CAPTION_REVEAL_SEC);
}

/** The phase of a caption: how far it has entered, how far it is from having left (both 0–1, 1 = fully shown) and the answer's reveal. */
export interface CaptionPhase {
  enter: number;
  exit: number;
  reveal: number;
}

export function emptyPhase(): CaptionPhase {
  return { enter: 0, exit: 0, reveal: 0 };
}

/**
 * Where a caption stands at simulation second `t` (written into `out`, which is returned): it enters over
 * `CAPTION_ENTER_SEC` from its start and leaves over `CAPTION_EXIT_SEC` up to its end (a short window splits
 * itself between the two). A question whose answer is revealed stays until the end of the run – and comes back
 * with its answer when its window had already closed.
 */
export function captionPhase(caption: Caption, t: number, revealAtSec: number, out: CaptionPhase = emptyPhase()): CaptionPhase {
  out.reveal = questionReveal(caption, t, revealAtSec);
  const start = caption.start;
  const open = isOpenEnded(caption);
  const span = open ? Infinity : caption.end - start;
  const enterSec = Math.min(CAPTION_ENTER_SEC, span / 2);
  const exitSec = Math.min(CAPTION_EXIT_SEC, span / 2);
  out.enter = !(t >= start) ? 0 : enterSec > 0 ? Math.min(1, (t - start) / enterSec) : 1;
  out.exit = open ? 1 : t >= caption.end ? 0 : exitSec > 0 ? Math.min(1, (caption.end - t) / exitSec) : 1;
  if (out.reveal > 0) {
    // The answer holds the caption on screen; a window that closed before the reveal re-opens with it.
    if (!open && Math.max(revealAtSec, start) >= caption.end) out.enter = out.reveal;
    out.exit = 1;
  }
  return out;
}

/**
 * Whether a finished run should keep the end screen back (and a recording running) so the answer of a question can
 * be seen: while the answer was revealed less than `CAPTION_ANSWER_HOLD_MS` of real time ago. A run whose answer came
 * with an escape well before its finish (Classic) is not held at all.
 */
export function holdsForAnswer(revealed: boolean, finished: boolean, msSinceReveal: number): boolean {
  return revealed && finished && msSinceReveal < CAPTION_ANSWER_HOLD_MS;
}

/** True when the phase shows anything. */
export function phaseVisible(phase: CaptionPhase): boolean {
  return Math.min(phase.enter, phase.exit) > 0;
}

export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
export const easeInCubic = (x: number) => x * x * x;
/** Overshoots to ~1.1 before settling at 1 (the pop). */
export const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

/** How a caption is drawn this frame: opacity, vertical offset (in caption heights, + = down) and scale. */
export interface CaptionFrame {
  alpha: number;
  dy: number;
  scale: number;
  /** 0–1: how much room the caption takes in its stack (eased), so the others make way smoothly. */
  room: number;
}

export function emptyFrame(): CaptionFrame {
  return { alpha: 0, dy: 0, scale: 1, room: 0 };
}

/**
 * The entrance / exit animation (written into `out`): **fade** eases the opacity; **slide** also moves the
 * caption in from its edge of the frame – from above at the top, from below at the center and the bottom – and
 * back out; **pop** scales it up past full size and back on the way in (`easeOutBack`) and shrinks it on the way out.
 */
export function animateCaption(animation: CaptionAnimation, position: CaptionPosition, phase: CaptionPhase, out: CaptionFrame = emptyFrame()): CaptionFrame {
  const p = Math.max(0, Math.min(1, Math.min(phase.enter, phase.exit)));
  const entering = phase.enter < 1 && phase.enter <= phase.exit;
  out.room = easeOutCubic(p);
  out.alpha = easeOutCubic(p);
  out.dy = 0;
  out.scale = 1;
  if (animation === "slide") {
    const dir = position === "top" ? -1 : 1;
    out.dy = dir * SLIDE_DISTANCE * (1 - (entering ? easeOutCubic(p) : 1 - easeInCubic(1 - p)));
  } else if (animation === "pop") {
    out.alpha = entering ? Math.min(1, 3 * p) : easeOutCubic(p);
    out.scale = entering ? Math.max(0, easeOutBack(p)) : 0.6 + 0.4 * p;
  }
  return out;
}

/* ------------------------------------------------------------------ texts */

/** Whole seconds left to the end of a clip of `clipSec` at simulation second `t` (rounded up, never below 0). */
export function countdownSeconds(clipSec: number, t: number): number {
  const left = clipSec - t;
  return left > 0 ? Math.ceil(left - 1e-9) : 0;
}

/** "0:27", "1:05", "12:00". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Fills `[token]`s in a label; a label without any of them gets the value appended ("Time left 0:27"). */
export function fillLabel(label: string, tokens: Record<string, string>, value: string): string {
  const text = label.trim();
  if (!text) return value;
  let used = false;
  const filled = text.replace(/\[(\w+)\]/g, (whole, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(tokens, key)) return whole; // --- review fix (security-robustness) --- ([constructor] is no token)
    used = true;
    return tokens[key];
  });
  return used ? filled : `${filled} ${value}`;
}

/** The countdown's text: the clock, or the caption's label with `[time]` filled in. */
export function countdownText(caption: Pick<Caption, "text">, clipSec: number, t: number): string {
  const time = formatClock(countdownSeconds(clipSec, t));
  return fillLabel(caption.text, { time }, time);
}

/** Scale bump of a countdown in its last `COUNTDOWN_PULSE_SECONDS`: 1.2 on every whole-second tick, easing back to 1 within a quarter second. */
export function countdownPulse(clipSec: number, t: number): number {
  const left = clipSec - t;
  if (!(left > 0) || left > COUNTDOWN_PULSE_SECONDS) return 1;
  const sinceTick = Math.ceil(left - 1e-9) - left;
  return 1 + 0.2 * Math.max(0, 1 - sinceTick / 0.25) ** 2;
}

/** Walls broken and walls in play as the wall counter shows them (never more broken than there are walls). */
export function wallCount(broken: number, total: number): { broken: number; total: number } {
  const t = Math.max(0, Math.floor(total));
  return { broken: Math.max(0, Math.min(t, Math.floor(broken))), total: t };
}

/**
 * The wall counter's text: the caption's label – or the translated default, "Wall [n]/[total]" – with the walls
 * broken and the walls in play filled in; null in a mode without rings (nothing to count).
 */
export function wallCounterText(caption: Pick<Caption, "text">, broken: number, total: number, defaultLabel: string): string | null {
  const counts = wallCount(broken, total);
  if (counts.total === 0) return null;
  const tokens = { n: String(counts.broken), total: String(counts.total) };
  return fillLabel(caption.text || defaultLabel, tokens, `${counts.broken}/${counts.total}`);
}

/** Elapsed share of the clip at simulation second `t` (0–1). */
export function progressFraction(clipSec: number, t: number): number {
  if (!(clipSec > 0)) return 0;
  return Math.max(0, Math.min(1, t / clipSec));
}

/** The progress bar's label ("" = none): the caption's text with `[pct]` filled in (no value is appended). */
export function progressLabel(caption: Pick<Caption, "text">, fraction: number): string {
  const text = caption.text.trim();
  if (!text) return "";
  const pct = `${Math.round(100 * fraction)}%`;
  return text.replace(/\[pct\]/g, pct);
}

/* ------------------------------------------------------------------ the clip clock and the layout */

/**
 * The clock (seconds) the countdown and the progress bar run on. While a clip is being recorded it is the real time
 * since Record was pressed (`clipSec` ≥ 0): the recorder stops after the recording duration of real time, so the
 * countdown reaches 0:00 and the bar fills as the clip ends – also when Record was pressed in a run that had already
 * started, at 2×–8× or in the camera's slow motion. Otherwise (`clipSec` < 0: the live preview) it is the run's own
 * clock, `runSec`. The caption windows (start, end) and the answer's reveal always follow the run.
 */
export function captionClock(runSec: number, clipSec: number): number {
  return clipSec >= 0 ? clipSec : runSec;
}

/** Room between the caption stacks and the edges of the exported square, as a share of its side. */
export const CAPTION_MARGIN = 0.035;

/** Width of the column the captions are centred in (their widest line), as a share of the exported square's side. */
export const CAPTION_COLUMN = 0.84;

/**
 * --- review fix (modes-gerald-odd) --- Whether a screen rectangle from `x` to `x + w` reaches into the caption column of a square
 * `side` px wide centred on `cx`: a mode HUD in a corner that stays clear of the column does not push the top captions down.
 */
export function inCaptionColumn(x: number, w: number, cx: number, side: number): boolean {
  const half = (CAPTION_COLUMN * side) / 2;
  return x < cx + half && x + w > cx - half;
}

/** Font size (px) of the page's Top / Bottom Text in a live view whose exported square is `side` px (Canvas.tsx draws it at this size). */
export function edgeTextFontSize(side: number, textSize: number): number {
  return Math.max(14, 0.045 * side) * textSize;
}

/** Distance (px) from the arena centre to the centre of the live Top / Bottom Text line: the ring's radius `arena` plus 0.6 font sizes. */
export function edgeTextDistance(arena: number, fontSize: number): number {
  return arena + 0.6 * fontSize;
}

/** The page's Top / Bottom Text as drawn over a view (screen px): which lines are shown, their centres and their font size. */
export interface EdgeTextLines {
  top: boolean;
  bottom: boolean;
  topY: number;
  bottomY: number;
  fontSize: number;
}

export function emptyEdgeTextLines(): EdgeTextLines {
  return { top: false, bottom: false, topY: 0, bottomY: 0, fontSize: 0 };
}

/** The lines as the canvas draws them live: centred `edgeTextDistance()` above and below the arena centre `cy`. */
export function liveEdgeTextLines(side: number, cy: number, arena: number, textSize: number, top: boolean, bottom: boolean, out: EdgeTextLines): EdgeTextLines {
  const fontSize = edgeTextFontSize(side, textSize);
  const d = edgeTextDistance(arena, fontSize);
  out.top = top;
  out.bottom = bottom;
  out.topY = cy - d;
  out.bottomY = cy + d;
  out.fontSize = fontSize;
  return out;
}

/**
 * The lines the recorder draws into an export frame of `exportWidth` × `exportHeight` – `layout` in export px, see
 * `recordingTextLayout()` in recording/recorder.ts: a little smaller than live, and kept inside the frame – mapped back
 * into the view it records, whose exported square is `side` px with its top edge at `squareTop`.
 */
export function exportEdgeTextLines(layout: { fontSize: number; topY: number; bottomY: number }, exportWidth: number, exportHeight: number, side: number, squareTop: number, top: boolean, bottom: boolean, out: EdgeTextLines): EdgeTextLines {
  const square = Math.min(exportWidth, exportHeight);
  const k = square > 0 ? side / square : 1;
  const dy = (exportHeight - square) / 2;
  out.top = top;
  out.bottom = bottom;
  out.topY = squareTop + (layout.topY - dy) * k;
  out.bottomY = squareTop + (layout.bottomY - dy) * k;
  out.fontSize = layout.fontSize * k;
  return out;
}

/** What the caption stacks keep clear of, in screen px. */
export interface CaptionBounds {
  /** Live view: room left for the page's buttons over the top and bottom edges of the square (0 in a recording). */
  insetTop: number;
  insetBottom: number;
  /** Screen y the top captions stay below (the teams' scoreboard, the Top Text); 0 = none. */
  topMin: number;
  /** Screen y the bottom captions stay above (the Bottom Text); Infinity = none. */
  bottomMax: number;
}

/**
 * Sets `out.topMin` and `out.bottomMax` for the Top / Bottom Text `lines`: a line's glyphs reach about half a font size
 * around its centre, and the limits keep another 0.2 font sizes clear of them. `topMin` is at least `scoreboardBottom`
 * (the teams' scoreboard, 0 = none) – and just that without a Top Text; `bottomMax` is Infinity without a Bottom Text.
 */
export function edgeTextBounds(lines: EdgeTextLines, scoreboardBottom: number, out: CaptionBounds): CaptionBounds {
  out.topMin = lines.top ? Math.max(scoreboardBottom, lines.topY + 0.7 * lines.fontSize) : scoreboardBottom;
  out.bottomMax = lines.bottom ? lines.bottomY - 0.7 * lines.fontSize : Infinity;
  return out;
}

/**
 * Where the caption stacks start in a view of `width` × `height`: `top` is the upper edge of the first top caption (the
 * stack grows downwards), `bottom` the lower edge of the first bottom caption (it grows upwards) – a margin inside the
 * centred square the recorder crops, clear of the page's buttons (live), the scoreboard and the Top / Bottom Text.
 */
export function captionStackStarts(width: number, height: number, bounds: CaptionBounds, out: { top: number; bottom: number }): { top: number; bottom: number } {
  const side = Math.min(width, height);
  const cy = height / 2;
  const margin = CAPTION_MARGIN * side;
  out.top = Math.max(cy - side / 2 + margin + bounds.insetTop, bounds.topMin > 0 ? bounds.topMin + 0.5 * margin : 0);
  out.bottom = Math.min(cy + side / 2 - margin - bounds.insetBottom, bounds.bottomMax - 0.5 * margin);
  return out;
}

/**
 * Greedy word wrap into at most `maxLines` lines no wider than `maxWidth` (by `measure`): a word wider than the line
 * gets a line of its own, and what does not fit on the last line is cut with an ellipsis.
 */
export function wrapCaptionText(text: string, measure: (s: string) => number, maxWidth: number, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  let lineStart = 0;
  for (let i = 0; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (!line || measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) {
      // The last line takes the rest (cut below).
      line = words.slice(lineStart).join(" ");
      break;
    }
    lines.push(line);
    line = words[i];
    lineStart = i;
  }
  if (measure(line) > maxWidth && lines.length === maxLines - 1) {
    const chars = Array.from(line);
    while (chars.length > 1 && measure(`${chars.join("")}…`) > maxWidth) chars.pop();
    line = `${chars.join("").trimEnd()}…`;
  }
  lines.push(line);
  return lines;
}

/* ------------------------------------------------------------------ the run, read from the engine */

/** What the tracker reads from the engine (PhysicsEngine has all of it). */
export interface CaptionEngineView {
  getElapsedMs(): number;
  isSimulationFinished(): boolean;
  getCircularWalls(): readonly unknown[];
  getBrokenWalls(): ReadonlySet<number>;
  getBalls(): readonly { id: number }[];
  hasBallEscaped(id: number): boolean;
  getStatsGeneration(): number;
  /** Shatter builds its walls out of segments with hit points (see `CaptionTracker.update()`). */
  isShatterMode(): boolean;
  getShatterSegments(): readonly (readonly { hp: number }[])[];
}

export interface CaptionRunState {
  /** Simulation seconds since the run started. */
  timeSec: number;
  /**
   * Walls broken this run (the most seen – Multiply rebuilds its ring after every escape; in Shatter every wall with a
   * destroyed segment, the hole the ball escapes through) and walls in play.
   */
  wallsBroken: number;
  wallsTotal: number;
  finished: boolean;
  /** A ball has left the arena this run. */
  escaped: boolean;
  /** Simulation second of the first frame a ball had escaped or the run was over; -1 before. */
  revealAtSec: number;
}

/**
 * Follows a run for the captions, once per frame: the clock, the walls broken, and the moment the answer of a
 * question is revealed. A new run (the engine's stats generation, bumped by every restart and mode change) starts
 * it over. Reads the engine only – no random numbers, no writes – and allocates nothing per frame.
 */
export class CaptionTracker {
  readonly state: CaptionRunState = { timeSec: 0, wallsBroken: 0, wallsTotal: 0, finished: false, escaped: false, revealAtSec: -1 };
  private generation = -1;

  reset() {
    const s = this.state;
    s.timeSec = 0;
    s.wallsBroken = 0;
    s.wallsTotal = 0;
    s.finished = false;
    s.escaped = false;
    s.revealAtSec = -1;
  }

  /** Reads the engine; `watchEscapes` = false skips the (per-ball) escape scan while no caption needs it. */
  update(engine: CaptionEngineView, watchEscapes = true): CaptionRunState {
    const generation = engine.getStatsGeneration();
    if (generation !== this.generation) {
      this.generation = generation;
      this.reset();
    }
    const s = this.state;
    s.timeSec = engine.getElapsedMs() / 1000;
    const total = engine.getCircularWalls().length;
    s.wallsTotal = total;
    let broken = engine.getBrokenWalls().size;
    // Shatter only counts a wall broken once every segment of it is gone, while the ball escapes through the first hole
    // it digs: there a wall is broken as soon as any of its segments is.
    if (total > 0 && engine.isShatterMode()) {
      const walls = engine.getShatterSegments();
      let breached = 0;
      for (let w = 0; w < walls.length; w++) {
        const segments = walls[w];
        for (let i = 0; i < segments.length; i++) {
          if (segments[i].hp <= 0) {
            breached++;
            break;
          }
        }
      }
      if (breached > broken) broken = breached;
    }
    s.wallsBroken = Math.min(total, Math.max(s.wallsBroken, broken));
    s.finished = engine.isSimulationFinished();
    if (!s.escaped && watchEscapes && total > 0) {
      const balls = engine.getBalls();
      for (let i = 0; i < balls.length; i++) {
        if (engine.hasBallEscaped(balls[i].id)) {
          s.escaped = true;
          break;
        }
      }
    }
    if (s.revealAtSec < 0 && (s.finished || s.escaped)) s.revealAtSec = s.timeSec;
    return s;
  }
}

/* ------------------------------------------------------------------ what the canvas gets */

/** Translated canvas texts: the wall counter's default label ("Wall [n]/[total]") and a question without text. */
export interface CaptionLabels {
  wall: string;
  question: string;
}

export const DEFAULT_CAPTION_LABELS: CaptionLabels = { wall: "Wall [n]/[total]", question: "Will it escape?" };

export interface CaptionRenderOptions {
  captions: Caption[];
  /** The clip length (the recording duration) the countdown and the progress bar run to, in seconds. */
  clipSec: number;
  labels: CaptionLabels;
}

/** What the canvas draws, or null without captions. */
export function captionRenderOptions(settings: CaptionSettings & { recordingDuration: number }, labels: CaptionLabels = DEFAULT_CAPTION_LABELS): CaptionRenderOptions | null {
  const captions = resolveCaptions(settings.captions);
  if (captions.length === 0) return null;
  const clipSec = Number.isFinite(settings.recordingDuration) && settings.recordingDuration > 0 ? settings.recordingDuration : 30;
  return { captions, clipSec, labels };
}
