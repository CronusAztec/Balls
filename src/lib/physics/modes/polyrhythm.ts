import { midiToFrequency } from "@/lib/audio/scales";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { TWO_PI } from "../types";
import { buildPendulumField, pendulumPitch, polygonRadius, type PendulumField } from "./pendulum";

/**
 * Metronomes & Polyrhythms ("polyrhythm" mode, the project.jdm polyrhythm / tempo-phase-shift formats): no
 * rings to escape. 2–400 voices each tick at their own tempo and every tick is a note; the voices drift apart
 * into polyrhythms and all line up again – the "all in phase" moment, a flash and a chord – at exactly
 * predictable times. Four layouts draw the same rhythm:
 *  - `rings`: concentric circles, each with a dot orbiting at a whole number of revolutions per cycle that ticks
 *    when it crosses the 12 o'clock line (the classic 3:4:5 visualiser); `polygon` draws every ring as a polygon
 *    with as many vertices as its ratio, turning once per cycle so a vertex meets the dot at every tick;
 *  - `arcs`: dots sliding back and forth inside a big circle – along parallel chords ("100 metronomes inside a
 *    circle") or along concentric semicircles – each at its own tempo, ticking at both ends;
 *  - `metronomes`: a grid of metronome pendulums ticking at both extremes of their swing;
 *  - `spiral`: dots orbiting the centre whose tick points lie on a spiral, tempos increasing along it, so the
 *    spiral is redrawn at every alignment.
 *
 * Tempo series (`tempos`): `harmonic` – voice i ticks i + 1 times per cycle of `cycleSeconds` (ratios 1…N);
 * `arithmetic` – voice i ticks at `baseBpm` + i · `bpmStep` beats per minute (Reich-style tempo phase shift,
 * a cycle is the time until they all line up again); `custom` – a comma list of whole-number ratios such as
 * 3,4,5,7, ticks per cycle.
 *
 * Everything is exact rational arithmetic on the step counter (`TempoSeries`): voice i ticks a[i] / D times per
 * second, so its ticks inside a 60 Hz step and the step's position of every dot are integer divisions – no
 * accumulated floating-point error, no integration, bit-identical replays whatever the voice count – and the
 * voices all tick together exactly every D / gcd(a) seconds, which is how an alignment is detected
 * analytically. The only random decision (the direction the dots turn / the side they start on) comes from
 * `ctx.random()`. All sound goes out as ordinary "hit" sound events (one per step: a note or a chord), so
 * instruments, scale snapping, the beat lock, hit samples, melodies and the music bed all apply.
 */

export const POLY_LAYOUTS = ["rings", "arcs", "metronomes", "spiral"] as const;
export type PolyLayout = (typeof POLY_LAYOUTS)[number];
export const POLY_ARC_STYLES = ["chords", "semicircles"] as const;
export type PolyArcStyle = (typeof POLY_ARC_STYLES)[number];
export const POLY_TEMPOS = ["harmonic", "arithmetic", "custom"] as const;
export type PolyTempos = (typeof POLY_TEMPOS)[number];
export const POLY_PITCH_BY = ["index", "ratio"] as const;
export type PolyPitchBy = (typeof POLY_PITCH_BY)[number];

export function isPolyLayout(value: unknown): value is PolyLayout {
  return typeof value === "string" && (POLY_LAYOUTS as readonly string[]).includes(value);
}
export function isPolyArcStyle(value: unknown): value is PolyArcStyle {
  return typeof value === "string" && (POLY_ARC_STYLES as readonly string[]).includes(value);
}
export function isPolyTempos(value: unknown): value is PolyTempos {
  return typeof value === "string" && (POLY_TEMPOS as readonly string[]).includes(value);
}
export function isPolyPitchBy(value: unknown): value is PolyPitchBy {
  return typeof value === "string" && (POLY_PITCH_BY as readonly string[]).includes(value);
}

export interface PolyrhythmSettings {
  /** Voices of the harmonic and arithmetic series, 2–400 (a custom list has one voice per entry). */
  count: number;
  layout: PolyLayout;
  /** Arcs layout: parallel chords of a circle or concentric semicircles. */
  arcStyle: PolyArcStyle;
  tempos: PolyTempos;
  /** Custom ratios (ticks per cycle), e.g. "3,4,5,7"; commas, spaces, colons or semicolons separate them. */
  custom: string;
  /** Length of a cycle in seconds for the harmonic and custom series. */
  cycleSeconds: number;
  /** Arithmetic series: tempo of the first voice (BPM) and the step between neighbours (BPM). */
  baseBpm: number;
  bpmStep: number;
  /** Rings layout: every ring is a polygon with as many vertices as its ratio, turning once per cycle. */
  polygon: boolean;
  /** Every k-th tick of a voice is accented (louder, longer); 0 = off. */
  accentEvery: number;
  /** A voice's note: a scale degree by its index, or its tempo ratio as a harmonic of C3. */
  pitchBy: PolyPitchBy;
  /** Ratio (or BPM) numbers on the dots. */
  numbers: boolean;
  /** The run finishes after this many cycles, with every voice back in phase; 0 = never. */
  cycles: number;
}

export const DEFAULT_POLY_CUSTOM = "3,4,5,7";

export const DEFAULT_POLYRHYTHM_SETTINGS: PolyrhythmSettings = {
  count: 16,
  layout: "rings",
  arcStyle: "chords",
  tempos: "harmonic",
  custom: DEFAULT_POLY_CUSTOM,
  cycleSeconds: 30,
  baseBpm: 60,
  bpmStep: 1,
  polygon: false,
  accentEvery: 0,
  pitchBy: "index",
  numbers: false,
  cycles: 1,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const POLYRHYTHM_RANGES = {
  prCount: { min: 2, max: 400, step: 1 },
  prCycleSeconds: { min: 1, max: 300, step: 0.5 },
  prBaseBpm: { min: 20, max: 240, step: 1 },
  prBpmStep: { min: 0.1, max: 10, step: 0.1 },
  prAccentEvery: { min: 0, max: 16, step: 1 },
  prCycles: { min: 0, max: 20, step: 1 },
} as const;

/** Most voices a custom list may define, and the most characters kept of it (links and presets stay small). */
export const MAX_CUSTOM_RATIOS = 400;
export const MAX_CUSTOM_LENGTH = 1200;
/** Largest ratio a custom list may use. */
export const MAX_CUSTOM_RATIO = 999;

/** The Metronomes & Polyrhythms fields of the SimulatorSettings object (URL keys prn, prl, pras, prt, prcu, prcs, prb, prbs, prp, pra, prpb, prnum, prc). */
export interface PolyrhythmSettingFields {
  prCount: number;
  prLayout: PolyLayout;
  prArcStyle: PolyArcStyle;
  prTempos: PolyTempos;
  prCustom: string;
  prCycleSeconds: number;
  prBaseBpm: number;
  prBpmStep: number;
  prPolygon: boolean;
  prAccentEvery: number;
  prPitchBy: PolyPitchBy;
  prNumbers: boolean;
  prCycles: number;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Keeps only digits, dots and separators (commas, spaces, colons, semicolons, slashes) of a custom ratio list, at most MAX_CUSTOM_LENGTH characters; typing is never disturbed by it. */
export function sanitizeCustomRatios(text: unknown): string {
  if (typeof text !== "string") return DEFAULT_POLY_CUSTOM;
  return text.replace(/[^0-9.,;:/\s]/g, "").replace(/\s+/g, " ").slice(0, MAX_CUSTOM_LENGTH);
}

/** The whole-number ratios (1–999) of a custom list, in order; anything else is skipped. At most MAX_CUSTOM_RATIOS. */
export function parseCustomRatios(text: string): number[] {
  const out: number[] = [];
  for (const token of text.split(/[\s,;:/]+/)) {
    if (!token) continue;
    const n = Number(token);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_CUSTOM_RATIO) out.push(n);
    if (out.length >= MAX_CUSTOM_RATIOS) break;
  }
  return out;
}

/** The ratios a custom list plays: its valid entries, or the default 3,4,5,7 when it has none. */
export function customRatiosOf(text: string): number[] {
  const ratios = parseCustomRatios(text);
  return ratios.length > 0 ? ratios : parseCustomRatios(DEFAULT_POLY_CUSTOM);
}

/** Fills in the defaults and clamps every value (counts and cycles whole, the cycle length on half seconds, the step on tenths of a BPM); unknown options fall back to the defaults. */
export function resolvePolyrhythmSettings(config: Partial<PolyrhythmSettings> | null | undefined): PolyrhythmSettings {
  const out = { ...DEFAULT_POLYRHYTHM_SETTINGS };
  if (!config) return out;
  const R = POLYRHYTHM_RANGES;
  if (config.count !== undefined) out.count = Math.round(clampNumber(config.count, R.prCount, out.count));
  if (isPolyLayout(config.layout)) out.layout = config.layout;
  if (isPolyArcStyle(config.arcStyle)) out.arcStyle = config.arcStyle;
  if (isPolyTempos(config.tempos)) out.tempos = config.tempos;
  if (config.custom !== undefined) out.custom = sanitizeCustomRatios(config.custom);
  if (config.cycleSeconds !== undefined) out.cycleSeconds = Math.round(2 * clampNumber(config.cycleSeconds, R.prCycleSeconds, out.cycleSeconds)) / 2;
  if (config.baseBpm !== undefined) out.baseBpm = Math.round(clampNumber(config.baseBpm, R.prBaseBpm, out.baseBpm));
  if (config.bpmStep !== undefined) out.bpmStep = Math.round(10 * clampNumber(config.bpmStep, R.prBpmStep, out.bpmStep)) / 10;
  if (typeof config.polygon === "boolean") out.polygon = config.polygon;
  if (config.accentEvery !== undefined) out.accentEvery = Math.round(clampNumber(config.accentEvery, R.prAccentEvery, out.accentEvery));
  if (isPolyPitchBy(config.pitchBy)) out.pitchBy = config.pitchBy;
  if (typeof config.numbers === "boolean") out.numbers = config.numbers;
  if (config.cycles !== undefined) out.cycles = Math.round(clampNumber(config.cycles, R.prCycles, out.cycles));
  return out;
}

/** Picks the Metronomes & Polyrhythms settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setPolyrhythmSettings()`. */
export function polyrhythmSettingsOf(source: PolyrhythmSettingFields): PolyrhythmSettings {
  return {
    count: source.prCount,
    layout: source.prLayout,
    arcStyle: source.prArcStyle,
    tempos: source.prTempos,
    custom: source.prCustom,
    cycleSeconds: source.prCycleSeconds,
    baseBpm: source.prBaseBpm,
    bpmStep: source.prBpmStep,
    polygon: source.prPolygon,
    accentEvery: source.prAccentEvery,
    pitchBy: source.prPitchBy,
    numbers: source.prNumbers,
    cycles: source.prCycles,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function polyrhythmSettingFields(settings: PolyrhythmSettings): PolyrhythmSettingFields {
  return {
    prCount: settings.count,
    prLayout: settings.layout,
    prArcStyle: settings.arcStyle,
    prTempos: settings.tempos,
    prCustom: settings.custom,
    prCycleSeconds: settings.cycleSeconds,
    prBaseBpm: settings.baseBpm,
    prBpmStep: settings.bpmStep,
    prPolygon: settings.polygon,
    prAccentEvery: settings.accentEvery,
    prPitchBy: settings.pitchBy,
    prNumbers: settings.numbers,
    prCycles: settings.cycles,
  };
}

/* ------------------------------------------------------------------ exact tempo arithmetic */

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** ⌊p / q⌋ for whole numbers p ≥ 0, q > 0, exact for every p below 2^53 (no rounding of p / q). */
export function floorDiv(p: number, q: number): number {
  return (p - (p % q)) / q;
}

/** ⌈p / q⌉ for whole numbers p ≥ 0, q > 0, exact like `floorDiv()`. */
export function ceilDiv(p: number, q: number): number {
  const r = p % q;
  return (p - r) / q + (r > 0 ? 1 : 0);
}

/**
 * The tempo of every voice as an exact fraction: voice i ticks `a[i] / D` times per second (its k-th tick,
 * k = 0, 1, 2…, is at k · D / a[i] seconds). With g = gcd(a), every voice ticks at every multiple of D / g
 * seconds and at no earlier common time – the alignment period. A cycle (what `cycles` counts, and what the
 * polygons turn once per) is D / `cycleDiv` seconds: the cycle length for the harmonic and custom series, the
 * alignment period for the arithmetic one; voice i ticks `perCycle[i]` times per cycle.
 */
export interface TempoSeries {
  count: number;
  a: number[];
  D: number;
  g: number;
  cycleDiv: number;
  perCycle: number[];
  /** Ticks per minute of every voice. */
  bpm: number[];
  cycleSec: number;
  alignSec: number;
}

/** The exact tempo series of resolved settings (see `TempoSeries`). */
export function buildTempoSeries(settings: Pick<PolyrhythmSettings, "tempos" | "count" | "custom" | "cycleSeconds" | "baseBpm" | "bpmStep">): TempoSeries {
  let a: number[];
  let D: number;
  let cycleDiv: number;
  if (settings.tempos === "arithmetic") {
    // Tempos in tenths of a BPM: a tick rate of b tenths per minute is b / 600 ticks per second.
    const base = Math.round(10 * settings.baseBpm);
    const step = Math.round(10 * settings.bpmStep);
    a = [];
    for (let i = 0; i < settings.count; i++) a.push(base + i * step);
    D = 600;
    cycleDiv = 0; // the alignment period, set below
  } else {
    const ratios = settings.tempos === "custom" ? customRatiosOf(settings.custom) : Array.from({ length: settings.count }, (_, i) => i + 1);
    // The cycle length in tenths of a second keeps half-second cycles whole: n ticks per T seconds is 10 n / (10 T).
    D = Math.max(1, Math.round(10 * settings.cycleSeconds));
    a = ratios.map((n) => 10 * n);
    cycleDiv = 10;
  }
  let g = 0;
  for (const x of a) g = gcd(g, x);
  g = Math.max(1, g);
  if (cycleDiv === 0) cycleDiv = g;
  return {
    count: a.length,
    a,
    D,
    g,
    cycleDiv,
    perCycle: a.map((x) => x / cycleDiv),
    bpm: a.map((x) => (60 * x) / D),
    cycleSec: D / cycleDiv,
    alignSec: D / g,
  };
}

/** Length (seconds) of one cycle of these settings: the cycle length, or the alignment period of an arithmetic series. */
export function polyrhythmCycleSeconds(settings: Partial<PolyrhythmSettings> | null | undefined): number {
  return buildTempoSeries(resolvePolyrhythmSettings(settings)).cycleSec;
}

/** Seconds between two moments at which every voice ticks together. */
export function polyrhythmAlignSeconds(settings: Partial<PolyrhythmSettings> | null | undefined): number {
  return buildTempoSeries(resolvePolyrhythmSettings(settings)).alignSec;
}

/** The ticks [first, end) of a voice ticking a / D times per second inside step `step` – [step / sps, (step + 1) / sps) seconds. */
export function ticksInStep(a: number, D: number, step: number, sps: number, out: { first: number; end: number }) {
  const q = sps * D;
  out.first = ceilDiv(step * a, q);
  out.end = ceilDiv((step + 1) * a, q);
  return out;
}

/** How many alignments (multiples of D / g seconds) fall inside step `step` (0 or 1 at 60 Hz). */
export function alignmentsInStep(g: number, D: number, step: number, sps: number): number {
  const q = sps * D;
  return ceilDiv((step + 1) * g, q) - ceilDiv(step * g, q);
}

/** A voice's phase in ticks, modulo 2, after `steps` steps (exact: the remainder is taken on whole numbers). */
export function tickPhaseMod2(a: number, D: number, steps: number, sps: number): number {
  const q = sps * D;
  return ((steps * a) % (2 * q)) / q;
}

/** Fraction (0–1) of the current cycle after `steps` steps. */
export function cycleFraction(series: TempoSeries, steps: number, sps: number): number {
  const q = sps * series.D;
  return ((steps * series.cycleDiv) % q) / q;
}

/** The last step of a run of `cycles` cycles: the step that contains the final alignment. */
export function finalStep(series: TempoSeries, cycles: number, sps: number): number {
  return floorDiv(cycles * series.D * sps, series.cycleDiv);
}

/* ------------------------------------------------------------------ pitch */

/** MIDI note of the "ratio 1" pitch (C3); the ratio pitches are its harmonics, folded into four octaves. */
export const POLY_RATIO_BASE_MIDI = 48;
/** The ratio pitches are folded down by octaves until they are below the base × this (four octaves). */
export const POLY_RATIO_SPAN = 16;

/**
 * Pitch (Hz) of voice `index`: by `index`, its rank as a degree of the C major scale from C4 (spread over at
 * most three octaves, like the Pendulum Wave); by `ratio`, `ratio` as a harmonic of C3, folded into four
 * octaves. The mode passes a harmonic or custom voice's own tempo ratio – its ticks per cycle, so 3:4:5 plays
 * G4, C5, E5, the chord the rhythm is – and a BPM-steps voice its tempo relative to the slowest voice. The tone
 * generator snaps either to the chosen scale.
 */
export function polyrhythmPitch(index: number, count: number, ratio: number, pitchBy: PolyPitchBy): number {
  if (pitchBy === "index") return pendulumPitch(index, count, "up");
  const base = midiToFrequency(POLY_RATIO_BASE_MIDI);
  let f = base * (ratio > 0 ? ratio : 1);
  while (f >= base * POLY_RATIO_SPAN) f /= 2;
  return f;
}

/** Most distinct pitches in the chord of one step (an alignment may use more). */
export const MAX_STEP_PITCHES = 8;
export const MAX_ALIGN_PITCHES = 16;

/** Picks at most `max` pitches from sorted, distinct `pitches`, evenly spread and always keeping the lowest and the highest. */
export function spreadPitches(pitches: readonly number[], max: number): number[] {
  if (pitches.length <= max) return pitches.slice();
  const out: number[] = [];
  for (let k = 0; k < max; k++) out.push(pitches[Math.round((k * (pitches.length - 1)) / (max - 1))]);
  return out;
}

/* ------------------------------------------------------------------ geometry */

/** Where every voice lives on the canvas: laid out once per layout / size change, read by `placeVoice()` and the renderer. */
export interface PolyGeometry {
  layout: PolyLayout;
  arcStyle: PolyArcStyle;
  field: PendulumField;
  count: number;
  cx: number;
  cy: number;
  dotRadius: number;
  /** rings, spiral, semicircles: orbit / arc radius; chords: half the chord length the dot travels. */
  radius: Float64Array;
  /** chords: y of the chord; metronomes: the pivot of the arm. */
  anchorX: Float64Array;
  anchorY: Float64Array;
  /** rings: −π/2 (12 o'clock); spiral: the angle of the voice's tick point on the spiral. */
  tickAngle: Float64Array;
  /** arcs: radius of the big circle (chords) / the outer semicircle; rings, spiral: the outer radius. */
  outerRadius: number;
  innerRadius: number;
  /** Semicircles: y of the baseline the dots tick on. */
  baselineY: number;
  /** Metronomes: grid cell, arm length, distance of the weight from the pivot, swing amplitude (radians). */
  cell: number;
  armLength: number;
  weightDistance: number;
  amplitude: number;
  cols: number;
  rows: number;
}

/** Turns of the spiral the tick points lie on. */
export const SPIRAL_TURNS = 1;
/** Swing amplitude of the metronome arms (radians). */
export const METRONOME_AMPLITUDE = 0.5;

/** The dot radius the configured ball size gives on a field of side `side` (the default 8 px ball is a fortieth of it). */
export function polyDotUnit(side: number): number {
  return side / 320;
}

function spreadAt(i: number, n: number) {
  return n > 1 ? i / (n - 1) : 0.5;
}

/**
 * Lays the voices out in the centred square the recorder crops to (see `buildPendulumField()`): ring radii,
 * chords, semicircles, the metronome grid or the spiral, with a dot radius that follows the Ball Size but never
 * lets neighbouring dots overlap. Every dot stays inside the field at any phase.
 */
export function buildPolyGeometry(width: number, height: number, layout: PolyLayout, arcStyle: PolyArcStyle, count: number, ballRadius: number, direction = 1): PolyGeometry {
  const field = buildPendulumField(width, height);
  const S = field.side;
  const n = Math.max(1, count);
  const unit = polyDotUnit(S) * (ballRadius || 8);
  const g: PolyGeometry = {
    layout,
    arcStyle,
    field,
    count: n,
    cx: field.cx,
    cy: field.cy,
    dotRadius: unit,
    radius: new Float64Array(n),
    anchorX: new Float64Array(n),
    anchorY: new Float64Array(n),
    tickAngle: new Float64Array(n).fill(-Math.PI / 2),
    outerRadius: 0,
    innerRadius: 0,
    baselineY: 0,
    cell: 0,
    armLength: 0,
    weightDistance: 0,
    amplitude: METRONOME_AMPLITUDE,
    cols: 0,
    rows: 0,
  };
  const minDot = Math.max(1, 0.0015 * S);
  switch (layout) {
    case "rings":
    case "spiral": {
      const outer = 0.46 * S;
      const inner = n > 1 ? 0.07 * S : 0.3 * S;
      const spacing = n > 1 ? (outer - inner) / (n - 1) : outer;
      const r = Math.max(minDot, Math.min(unit, 0.42 * spacing, 0.03 * S));
      g.dotRadius = r;
      g.outerRadius = outer - r;
      g.innerRadius = Math.min(inner, g.outerRadius);
      for (let i = 0; i < n; i++) {
        g.radius[i] = g.innerRadius + (g.outerRadius - g.innerRadius) * spreadAt(i, n);
        if (layout === "spiral") g.tickAngle[i] = -Math.PI / 2 + direction * TWO_PI * SPIRAL_TURNS * spreadAt(i, n);
      }
      break;
    }
    case "arcs": {
      if (arcStyle === "chords") {
        const R = 0.46 * S;
        const span = 0.92 * R;
        const spacing = n > 1 ? (2 * span) / (n - 1) : R;
        const r = Math.max(minDot, Math.min(unit, 0.42 * spacing, 0.03 * S));
        g.dotRadius = r;
        g.outerRadius = R;
        for (let i = 0; i < n; i++) {
          const dy = n > 1 ? -span + 2 * span * spreadAt(i, n) : 0;
          g.anchorX[i] = field.cx;
          g.anchorY[i] = field.cy + dy;
          g.radius[i] = Math.max(r, Math.sqrt(Math.max(0, R * R - dy * dy)) - r - 1);
        }
      } else {
        const outer = 0.46 * S;
        const inner = n > 1 ? 0.06 * S : 0.3 * S;
        const spacing = n > 1 ? (outer - inner) / (n - 1) : outer;
        const r = Math.max(minDot, Math.min(unit, 0.42 * spacing, 0.03 * S));
        g.dotRadius = r;
        g.outerRadius = outer - r;
        g.innerRadius = Math.min(inner, g.outerRadius);
        // The baseline sits low enough that the outer semicircle and the dots on it stay inside the field.
        g.baselineY = field.cy + 0.22 * S;
        for (let i = 0; i < n; i++) g.radius[i] = g.innerRadius + (g.outerRadius - g.innerRadius) * spreadAt(i, n);
      }
      break;
    }
    case "metronomes": {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const cell = (0.96 * S) / Math.max(cols, rows);
      g.cols = cols;
      g.rows = rows;
      g.cell = cell;
      g.armLength = 0.62 * cell;
      g.weightDistance = 0.66 * g.armLength;
      g.dotRadius = Math.max(minDot, Math.min(unit, 0.1 * cell));
      const x0 = field.cx - (cols * cell) / 2;
      const y0 = field.cy - (rows * cell) / 2;
      for (let i = 0; i < n; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // A short last row is centred.
        const inRow = row === rows - 1 ? n - row * cols : cols;
        const shift = ((cols - inRow) * cell) / 2;
        g.anchorX[i] = x0 + shift + (col + 0.5) * cell;
        g.anchorY[i] = y0 + (row + 0.5) * cell + 0.34 * cell;
      }
      break;
    }
  }
  return g;
}

export interface VoicePlacement {
  x: number;
  y: number;
  /** rings, spiral: the dot's angle; arcs: its position −1…1 along the path; metronomes: the arm angle. */
  param: number;
}

/** Triangle wave through the ticks: +1 at even tick counts, −1 at odd ones, linear in between (`u2` = ticks mod 2). */
export function tickTriangle(u2: number): number {
  return u2 <= 1 ? 1 - 2 * u2 : -3 + 2 * u2;
}

/**
 * Where voice `i` is at tick phase `u2` (ticks elapsed, modulo 2) – every layout ticks at a whole number of
 * ticks: at the 12 o'clock line (rings) or its tick point on the spiral, at either end of its chord or
 * semicircle, at either extreme of its swing. `polygonAngle` / `sides` put a rings dot on its rotating polygon.
 * Written into `out` (no allocation in the hot loop).
 */
export function placeVoice(geom: PolyGeometry, i: number, u2: number, direction: number, polygonAngle: number, sides: number, out: VoicePlacement): VoicePlacement {
  switch (geom.layout) {
    case "rings":
    case "spiral": {
      const turn = u2 >= 1 ? u2 - 1 : u2;
      const a = geom.tickAngle[i] + direction * TWO_PI * turn;
      let rho = geom.radius[i];
      if (sides >= 3) rho = polygonRadius(a, rho, polygonAngle, sides);
      out.x = geom.cx + rho * Math.cos(a);
      out.y = geom.cy + rho * Math.sin(a);
      out.param = a;
      return out;
    }
    case "arcs": {
      const s = direction * tickTriangle(u2);
      if (geom.arcStyle === "chords") {
        out.x = geom.anchorX[i] + geom.radius[i] * s;
        out.y = geom.anchorY[i];
      } else {
        const alpha = (Math.PI / 2) * (1 - s);
        out.x = geom.cx + geom.radius[i] * Math.cos(alpha);
        out.y = geom.baselineY - geom.radius[i] * Math.sin(alpha);
      }
      out.param = s;
      return out;
    }
    case "metronomes": {
      const theta = direction * geom.amplitude * Math.cos(Math.PI * u2);
      out.x = geom.anchorX[i] + geom.weightDistance * Math.sin(theta);
      out.y = geom.anchorY[i] - geom.weightDistance * Math.cos(theta);
      out.param = theta;
      return out;
    }
  }
}

/** Sides of the polygon a rings voice with `perCycle` ticks per cycle is drawn on (0 = a circle: ratios below 3 or above 48). */
export function polygonSides(perCycle: number): number {
  return Number.isInteger(perCycle) && perCycle >= 3 && perCycle <= 48 ? perCycle : 0;
}

/* ------------------------------------------------------------------ the mode */

/** What the canvas needs; the same object for the life of the mode (the arrays are replaced when the voice count changes). */
export interface PolyrhythmView {
  settings: PolyrhythmSettings;
  series: TempoSeries | null;
  geometry: PolyGeometry | null;
  count: number;
  /** Position and layout parameter (see `VoicePlacement.param`) of every voice at the end of the last step. */
  x: Float64Array;
  y: Float64Array;
  param: Float64Array;
  /** Step count after the voice's last tick (−1 before the first) and whether that tick was accented. */
  lastTickStep: Float64Array;
  lastTickAccent: Uint8Array;
  /** Polygon sides per voice (0 = circle), colours (hsl) and number labels. */
  sides: Int32Array;
  colors: string[];
  labels: string[];
  pitch: number[];
  /** Steps simulated in this run, the length of one (ms; 0 before the first) and the simulation time (s). */
  step: number;
  stepMs: number;
  timeSec: number;
  /** Rotation of the polygons (radians; a vertex is at 12 o'clock at every tick of its voice). */
  polygonAngle: number;
  /** ±1: the direction the dots turn / the side they start on (from the seed). */
  direction: number;
  cyclesDone: number;
  finished: boolean;
  /** Ticks played (every voice of a chord counts), sound events (notes or chords) and alignments (the start counts). */
  tickCount: number;
  eventCount: number;
  alignCount: number;
  /** Step count after the last alignment and after the last tick of any voice (−1 before). */
  lastAlignStep: number;
  lastAnyTickStep: number;
  /** Incremented by every init. */
  generation: number;
}

const PLACEMENT: VoicePlacement = { x: 0, y: 0, param: 0 };
const TICKS = { first: 0, end: 0 };

/** Colour of voice `index` of `count` (rainbow by index). */
export function voiceColor(index: number, count: number): string {
  const hue = count > 1 ? (360 * index) / count : 0;
  return `hsl(${Math.round(hue)}, 90%, 62%)`;
}

/** The number drawn on a dot: its ratio (ticks per cycle), or its BPM for the arithmetic series. */
export function voiceLabel(series: TempoSeries, index: number, tempos: PolyTempos): string {
  if (tempos === "arithmetic") {
    const bpm = series.bpm[index];
    return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
  }
  return String(series.perCycle[index]);
}

export class PolyrhythmMode implements GameMode {
  readonly name = "polyrhythm";
  /** The dots are placed analytically: no slow-ball boost and no pair collisions may touch them. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: PolyrhythmSettings = { ...DEFAULT_POLYRHYTHM_SETTINGS };
  private readonly view: PolyrhythmView = {
    settings: { ...DEFAULT_POLYRHYTHM_SETTINGS },
    series: null,
    geometry: null,
    count: 0,
    x: new Float64Array(0),
    y: new Float64Array(0),
    param: new Float64Array(0),
    lastTickStep: new Float64Array(0),
    lastTickAccent: new Uint8Array(0),
    sides: new Int32Array(0),
    colors: [],
    labels: [],
    pitch: [],
    step: 0,
    stepMs: 0,
    timeSec: 0,
    polygonAngle: -Math.PI / 2,
    direction: 1,
    cyclesDone: 0,
    finished: false,
    tickCount: 0,
    eventCount: 0,
    alignCount: 0,
    lastAlignStep: -1,
    lastAnyTickStep: -1,
    generation: 0,
  };
  private sps = 60;
  private endStep = Infinity;
  private firstId = 0;
  private initialized = false;
  private width = 800;
  private height = 600;
  private ballRadius = 8;
  /** The balls' radii / positions have to follow a live layout change on the next step. */
  private ballsDirty = false;
  private readonly stepPitches: number[] = [];

  getSettings(): PolyrhythmSettings {
    return this.settings;
  }

  /**
   * The tempo fields (count, series, custom list, cycle length, BPMs) and the cycles take effect on the next init
   * (the Simulator re-inits the mode when one of them changes). The layout, arc style, polygons, accents, pitch
   * mapping and numbers apply at once – positions are functions of the clock, so the rhythm carries on.
   */
  setSettings(patch: Partial<PolyrhythmSettings>) {
    this.settings = resolvePolyrhythmSettings({ ...this.settings, ...patch });
    if (!this.initialized) return;
    const v = this.view;
    const s = this.settings;
    const live = v.settings;
    const layoutChanged = live.layout !== s.layout || live.arcStyle !== s.arcStyle;
    const soundChanged = live.pitchBy !== s.pitchBy;
    v.settings = { ...live, layout: s.layout, arcStyle: s.arcStyle, polygon: s.polygon, accentEvery: s.accentEvery, pitchBy: s.pitchBy, numbers: s.numbers };
    if (soundChanged) this.computePitches();
    if (layoutChanged || live.polygon !== s.polygon) {
      this.rebuildGeometry();
      this.placeAll();
      this.ballsDirty = true;
    }
  }

  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): PolyrhythmView {
    return this.view;
  }

  getProgress() {
    const v = this.view;
    return { cycles: v.cyclesDone, total: v.settings.cycles, ticks: v.tickCount, alignments: v.alignCount, count: v.count, finished: v.finished };
  }

  /** Seconds until every voice ticks together again. */
  secondsToAlignment(): number {
    const series = this.view.series;
    if (!series) return 0;
    const t = this.view.timeSec;
    const period = series.alignSec;
    return Math.max(0, (Math.floor(t / period + 1e-9) + 1) * period - t);
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    const series = buildTempoSeries(s);
    v.series = series;
    const n = series.count;
    if (v.count !== n || v.x.length !== n) {
      v.x = new Float64Array(n);
      v.y = new Float64Array(n);
      v.param = new Float64Array(n);
      v.lastTickStep = new Float64Array(n);
      v.lastTickAccent = new Uint8Array(n);
      v.sides = new Int32Array(n);
    }
    v.count = n;
    v.lastTickStep.fill(-1);
    v.lastTickAccent.fill(0);
    v.colors = [];
    v.labels = [];
    for (let i = 0; i < n; i++) {
      v.colors.push(voiceColor(i, n));
      v.labels.push(voiceLabel(series, i, s.tempos));
      v.sides[i] = polygonSides(series.perCycle[i]);
    }
    v.step = 0;
    v.stepMs = 0;
    v.timeSec = 0;
    v.cyclesDone = 0;
    v.finished = false;
    v.tickCount = 0;
    v.eventCount = 0;
    v.alignCount = 0;
    v.lastAlignStep = -1;
    v.lastAnyTickStep = -1;
    v.generation++;
    this.sps = 60;
    this.endStep = s.cycles > 0 ? finalStep(series, s.cycles, this.sps) : Infinity;
    // The only random decision: the direction the dots turn (rings, spiral) / the side they start on (arcs, metronomes).
    v.direction = ctx.random() < 0.5 ? -1 : 1;
    this.width = ctx.config.width;
    this.height = ctx.config.height;
    this.ballRadius = ctx.config.ballRadius || 8;
    this.initialized = true;
    this.computePitches();
    this.rebuildGeometry();
    this.placeAll();
    const r = v.geometry!.dotRadius;
    this.firstId = ctx.getNextId();
    for (let i = 0; i < n; i++) {
      ctx.addBall({ x: v.x[i], y: v.y[i], vx: 0, vy: 0, radius: r, color: v.colors[i], gravityScale: 0, radiusScale: r / this.ballRadius });
    }
    this.ballsDirty = false;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const sps = Math.max(1, Math.round(1000 / dtMs));
    if (sps !== this.sps) {
      // Another step length (only ever the engine's 60 Hz in practice): the final step moves with it.
      this.sps = sps;
      const v = this.view;
      if (v.series) this.endStep = v.settings.cycles > 0 ? finalStep(v.series, v.settings.cycles, sps) : Infinity;
    }
    // A live change of the ball size re-sizes the dots (and the spacing that depends on them).
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.ballRadius) {
      this.ballRadius = radius;
      this.rebuildGeometry();
      this.placeAll();
      this.ballsDirty = true;
    }
    if (this.ballsDirty) this.applyBalls(ctx);
  }

  /** The engine moved the dot by its (zero) velocity; pin it where the clock says it is. */
  onBallStep(_ctx: ModeContext, ball: Ball) {
    const i = ball.id - this.firstId;
    if (i >= 0 && i < this.view.count) {
      ball.x = this.view.x[i];
      ball.y = this.view.y[i];
    }
    ball.vx = 0;
    ball.vy = 0;
  }

  onPostSubStep() {}

  /** Solves the ticks and the alignment of the step exactly, queues its sound, advances the clock and places every dot. */
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const series = v.series;
    if (!series || v.finished) return;
    const s = v.settings;
    const sps = this.sps;
    const step = v.step;
    const after = step + 1;
    // A lone voice is trivially "in phase" at every tick: an alignment needs two voices or more.
    const aligned = v.count > 1 && alignmentsInStep(series.g, series.D, step, sps) > 0;
    const pitches = this.stepPitches;
    pitches.length = 0;
    let ticks = 0;
    let accent = aligned;
    for (let i = 0; i < v.count; i++) {
      ticksInStep(series.a[i], series.D, step, sps, TICKS);
      const k = TICKS.end - TICKS.first;
      if (k <= 0) continue;
      ticks += k;
      v.lastTickStep[i] = after;
      let accented = 0;
      if (s.accentEvery > 0) {
        // Is one of the ticks first … end − 1 a multiple of accentEvery?
        const lastMultiple = TICKS.end - 1 - ((TICKS.end - 1) % s.accentEvery);
        if (lastMultiple >= TICKS.first) accented = 1;
      }
      v.lastTickAccent[i] = accented;
      if (accented) accent = true;
      const p = v.pitch[i];
      if (!pitches.includes(p)) pitches.push(p);
    }
    v.step = after;
    v.stepMs = dtMs;
    v.timeSec = after / sps;
    v.cyclesDone = floorDiv(after * series.cycleDiv, sps * series.D);
    if (ticks > 0) {
      v.tickCount += ticks;
      v.lastAnyTickStep = after;
      v.eventCount++;
      pitches.sort((x, y) => x - y);
      const chosen = spreadPitches(pitches, aligned ? MAX_ALIGN_PITCHES : MAX_STEP_PITCHES);
      const event: SoundEvent = { type: "hit", wallIndex: 0, frequency: chosen[0] };
      if (chosen.length > 1) event.chord = chosen;
      if (accent) event.accent = true;
      ctx.addPendingSoundEvent(event);
    }
    if (aligned) {
      v.alignCount++;
      v.lastAlignStep = after;
    }
    if (step >= this.endStep) {
      v.finished = true;
      v.cyclesDone = s.cycles;
      const g = v.geometry;
      if (g) ctx.spawnConfetti(g.cx, g.cy);
    }
    this.placeAll();
    for (const ball of ctx.getBalls()) {
      const i = ball.id - this.firstId;
      if (i >= 0 && i < v.count) {
        ball.x = v.x[i];
        ball.y = v.y[i];
        if (ticks > 0 && v.lastTickStep[i] === after) ctx.noteBounce?.(ball); // --- bounce-math --- a dot's tick (it turns at the end of its arc) is its bounce
      }
    }
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize re-lays the voices out and puts every dot back where the clock says. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.width = ctx.config.width;
      this.height = ctx.config.height;
      if (this.initialized) {
        this.rebuildGeometry();
        this.placeAll();
        this.applyBalls(ctx);
      }
    }
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { timeSec: v.timeSec, step: v.step, cyclesDone: v.cyclesDone, tickCount: v.tickCount, alignCount: v.alignCount, eventCount: v.eventCount, finished: v.finished };
  }

  private computePitches() {
    const v = this.view;
    const series = v.series;
    if (!series) return;
    let minA = Infinity;
    for (const x of series.a) minA = Math.min(minA, x);
    // The harmonic and custom series play their own ratios (ticks per cycle: 3:4:5 is G–C–E); BPM steps have no
    // small whole ratios, so a voice plays its tempo relative to the slowest one.
    const arithmetic = v.settings.tempos === "arithmetic";
    v.pitch = series.a.map((x, i) => polyrhythmPitch(i, series.count, arithmetic ? x / minA : series.perCycle[i], v.settings.pitchBy));
  }

  private rebuildGeometry() {
    const v = this.view;
    v.geometry = buildPolyGeometry(this.width, this.height, v.settings.layout, v.settings.arcStyle, v.count, this.ballRadius, v.direction);
  }

  /** Places every voice at the current step (exact phases from the step counter). */
  private placeAll() {
    const v = this.view;
    const g = v.geometry;
    const series = v.series;
    if (!g || !series) return;
    const sps = this.sps;
    const polygons = v.settings.polygon && v.settings.layout === "rings";
    v.polygonAngle = -Math.PI / 2 + v.direction * TWO_PI * cycleFraction(series, v.step, sps);
    for (let i = 0; i < v.count; i++) {
      const u2 = tickPhaseMod2(series.a[i], series.D, v.step, sps);
      placeVoice(g, i, u2, v.direction, v.polygonAngle, polygons ? v.sides[i] : 0, PLACEMENT);
      v.x[i] = PLACEMENT.x;
      v.y[i] = PLACEMENT.y;
      v.param[i] = PLACEMENT.param;
    }
  }

  /** Writes the dot radius and position into every ball (`radiusScale` keeps the size right across `setConfig({ ballRadius })`). */
  private applyBalls(ctx: ModeContext) {
    const v = this.view;
    const g = v.geometry;
    if (!g) return;
    for (const ball of ctx.getBalls()) {
      const i = ball.id - this.firstId;
      if (i < 0 || i >= v.count) continue;
      ball.radius = g.dotRadius;
      ball.radiusScale = g.dotRadius / this.ballRadius;
      ball.x = v.x[i];
      ball.y = v.y[i];
    }
    this.ballsDirty = false;
  }
}
