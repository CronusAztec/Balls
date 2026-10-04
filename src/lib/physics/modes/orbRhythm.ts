import type { OrbLayout } from "./orbGrid";

/**
 * --- orb-rhythm --- Bouncing Orbs' rhythm model (feature orb-rhythm; the mode is lib/physics/modes/orbGrid.ts). The owner's
 * direction: "bouncing orbs is clunky and not fluid like the instagram given, add metronome and polyrythms to it". In the
 * reference clips every orb bounces on its own spot FOREVER at a constant height, the heights varying smoothly across the
 * field so the set forms a travelling wave surface that falls into phase and dissolves again. The decay model (the orbs lose
 * energy and settle) stays as `model: "decay"`; this module is the new default, `model: "rhythm"`, and everything in it is
 * pure arithmetic on the simulation clock:
 *
 * - **An ideal bouncer** – orb i has a constant bounce frequency f_i (bounces a second, period T_i = 1 / f_i) and a phase
 *   φ_i (in bounces): its height is the parabola of an elastic bounce, h(t) = A_i · 4u(1 − u) with u = frac(t · f_i − φ_i),
 *   and its apex A_i = g · T_i² / 8 (`apexOf()`): faster bouncers bounce lower, as in the clips. "Equal heights" gives every
 *   orb the same apex instead. Positions are analytic in time (no integration, no step error): the engine evaluates them at
 *   its 60 Hz steps (landings, sound, counters), the page's canvas at the display's frame times (`orbRenderTimeMs()`), the
 *   fast export at the exact frame times – so the motion is smooth at any frame rate.
 * - **Polyrhythms** (`poly`) – the field is split into groups by a pattern (`groupIndex()`: rows, columns, rings from the
 *   centre, diagonals corner to corner, a checkerboard or every orb its own group) and group k bounces n_k times per cycle of
 *   L seconds (`cycleSeconds()`): f_k = n_k / L. Every orb lands together at t = 0 and at every multiple of L – the IN PHASE
 *   moment (`inPhasePeriodSec()`: exactly then, never between, as long as the counts share no common factor) – and between
 *   them the wave surface morphs through travelling waves, two groups, three groups… Rhythm presets (`rhythmCount()`): the
 *   pendulum wave (n_k = 51 + k), the ratio polyrhythms 3:2, 4:3, 5:4, 7:5 and 3:4:5 (the voices bounce r_v times a bar and
 *   meet on every downbeat), a Euclidean tempo ladder, corner to corner, centre outwards and varied (per orb, from the seed).
 *   With the polyrhythm off the whole field shares one tempo and the group's position shifts its phase: a steady travelling
 *   wave that never resolves.
 * - **The metronome** – a tempo (BPM; the Sound section's beat lock tempo while the lock is on) and beats per bar; while it is
 *   on (a visual style or a click volume) the cycle is a whole number of bars (L = bars · beats · 60 / BPM), so every IN
 *   PHASE moment lands on a downbeat and the ratio voices' landings fall on the bar's subdivisions (`beatClock()`).
 *
 * Determinism: the only random numbers are the varied preset's (one draw per orb from the seed, `planOrbRhythm()`); the rest
 * follows from the settings – the same seed and settings give the same field at any frame rate and playback speed.
 */

/* ------------------------------------------------------------------ options */

export const OG_MODELS = ["rhythm", "decay"] as const;
export type OgModel = (typeof OG_MODELS)[number];
export const OG_GROUPS = ["rows", "columns", "rings", "diagonals", "checker", "each"] as const;
export type OgGroup = (typeof OG_GROUPS)[number];
export const OG_RHYTHMS = ["pendulum", "3-2", "4-3", "5-4", "7-5", "3-4-5", "euclid", "corner", "centre", "varied"] as const;
export type OgRhythm = (typeof OG_RHYTHMS)[number];
export const OG_METROS = ["off", "bar", "ring", "dot"] as const;
export type OgMetro = (typeof OG_METROS)[number];

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);
export const isOgModel = (v: unknown): v is OgModel => isOneOf(OG_MODELS, v);
export const isOgGroup = (v: unknown): v is OgGroup => isOneOf(OG_GROUPS, v);
export const isOgRhythm = (v: unknown): v is OgRhythm => isOneOf(OG_RHYTHMS, v);
export const isOgMetro = (v: unknown): v is OgMetro => isOneOf(OG_METROS, v);

/* ------------------------------------------------------------------ constants */

/** The pendulum wave's first count: group k bounces 51 + k times a cycle (the classic Harvard wave's ladder). */
export const PENDULUM_BASE = 51;
/** The slowest count of the corner, centre, varied and Euclidean presets (the same ladder's foot). */
export const RHYTHM_BASE = 51;
/** The ratio presets: the voices' bounces per bar (group k plays voice k mod V). */
export const RHYTHM_RATIOS: Readonly<Record<"3-2" | "4-3" | "5-4" | "7-5" | "3-4-5", readonly number[]>> = {
  "3-2": [3, 2],
  "4-3": [4, 3],
  "5-4": [5, 4],
  "7-5": [7, 5],
  "3-4-5": [3, 4, 5],
};
/** The presets whose groups come from the Groups pattern (corner, centre and varied bring their own). */
export const PATTERN_RHYTHMS: readonly OgRhythm[] = ["pendulum", "3-2", "4-3", "5-4", "7-5", "3-4-5", "euclid"];
/** The landing squash: 10 % flatter (and wider) at the landing, easing out over 60 ms (render only). */
export const SQUASH_AMOUNT = 0.1;
export const SQUASH_SEC = 0.06;
/** The IN PHASE banner shows this long after every cycle end (and stays on a clip that ends in it). */
export const IN_PHASE_HOLD_MS = 1800;
/** Clicks one 60 Hz step plays at most (a metronome typed to thousands of BPM still counts every beat). */
export const MAX_CLICKS_PER_STEP = 4;
/** Slack of the landing and cycle counters (in bounces): a landing exactly on a step's end time counts in that step. */
export const PHASE_EPS = 1e-9;
/** The lowest tempo the metronome runs at (a typed 0 or a negative tempo keeps it at this). */
export const MIN_BPM = 1;

/* ------------------------------------------------------------------ settings */

export interface OrbRhythmSettings {
  /** "rhythm" (ideal bouncers forever – the default) or "decay" (the orbs lose energy and settle). */
  model: OgModel;
  /** Every orb's apex the same (else A = g · T² / 8: the faster, the lower). */
  equalHeights: boolean;
  /** A 10 % landing squash easing out over 60 ms (render only). */
  squash: boolean;
  /** Polyrhythm: groups with whole bounce counts per cycle (off: one tempo, the phase shifting across the field). */
  poly: boolean;
  /** How the field splits into groups (pendulum, ratio and Euclidean presets). */
  group: OgGroup;
  /** The cycle (seconds) while the metronome is off: every orb lands together at its multiples. */
  cycle: number;
  rhythm: OgRhythm;
  /** Euclidean preset: the tempo ladder's steps. */
  steps: number;
  /** The metronome: tempo (BPM), beats per bar, the visual (off | bar | ring | dot), the click volume (0 = off), bars a cycle. */
  bpm: number;
  beats: number;
  metro: OgMetro;
  click: number;
  bars: number;
  /** A pitch per group from the Sound section's scale: the polyrhythm plays a tune. */
  melody: boolean;
  /** The Sound section's beat-lock tempo, which the metronome follows while the lock is on (0: its own tempo). Not a field. */
  syncBpm: number;
}

export const DEFAULT_ORB_RHYTHM_SETTINGS: OrbRhythmSettings = {
  model: "rhythm",
  equalHeights: false,
  squash: true,
  poly: true,
  group: "diagonals",
  cycle: 30,
  rhythm: "pendulum",
  steps: 16,
  bpm: 120,
  beats: 4,
  metro: "off",
  click: 0,
  bars: 16,
  melody: false,
  syncBpm: 0,
};

/** Slider comfort ranges, keyed by the SimulatorSettings field names (settings.ts spreads them into `RANGES` through orbGrid.ts). */
export const ORB_RHYTHM_RANGES = {
  ogCycle: { min: 0.5, max: 120, step: 0.5 },
  ogSteps: { min: 1, max: 32, step: 1 },
  ogBpm: { min: 20, max: 300, step: 1 },
  ogBeats: { min: 1, max: 12, step: 1 },
  ogBars: { min: 1, max: 64, step: 1 },
  ogClick: { min: 0, max: 1, step: 0.05 },
} as const;

/** The rhythm fields of the SimulatorSettings object; the URL keys are the field names (ogModel, ogEq, ogSquash, …). */
export interface OrbRhythmFields {
  ogModel: OgModel;
  ogEq: boolean;
  ogSquash: boolean;
  ogPoly: boolean;
  ogGroup: OgGroup;
  ogCycle: number;
  ogRhythm: OgRhythm;
  ogSteps: number;
  ogBpm: number;
  ogBeats: number;
  ogMetro: OgMetro;
  ogClick: number;
  ogBars: number;
  ogMelody: boolean;
}

/**
 * The rhythm fields the run reads (settings.ts' engine keys of the mode). A change of one restarts the run and drops a found
 * seed – but the click volume only when it switches the metronome on or off (`metronomeOn()`: that moves the cycle); the
 * squash, the visual metronome's style and the melody follow live.
 */
export const ORB_RHYTHM_PHYSICS_FIELDS = ["ogModel", "ogEq", "ogPoly", "ogGroup", "ogCycle", "ogRhythm", "ogSteps", "ogBpm", "ogBeats", "ogBars", "ogClick"] as const satisfies readonly (keyof OrbRhythmFields)[];

/** URL keys: numbers, options, switches (the field names themselves). */
export const RHYTHM_NUMERIC_KEYS = { ogCycle: "ogCycle", ogSteps: "ogSteps", ogBpm: "ogBpm", ogBeats: "ogBeats", ogBars: "ogBars", ogClick: "ogClick" } as const;
export const RHYTHM_OPTION_KEYS = { ogModel: "ogModel", ogGroup: "ogGroup", ogRhythm: "ogRhythm", ogMetro: "ogMetro" } as const;
export const RHYTHM_SWITCH_KEYS = { ogEq: "ogEq", ogSquash: "ogSquash", ogPoly: "ogPoly", ogMelody: "ogMelody" } as const;

/** A number from its range's minimum up (never a maximum), the fallback for anything invalid. */
function atLeast(value: unknown, min: number, fallback: number): number {
  const n = typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

/** Validates the rhythm settings (known options, real booleans, numbers from their minimum up and never capped; counts whole). */
export function resolveOrbRhythmSettings(config: Partial<OrbRhythmSettings> | null | undefined, base: OrbRhythmSettings = DEFAULT_ORB_RHYTHM_SETTINGS): OrbRhythmSettings {
  const out = { ...base };
  if (!config) return out;
  const R = ORB_RHYTHM_RANGES;
  if (isOgModel(config.model)) out.model = config.model;
  if (typeof config.equalHeights === "boolean") out.equalHeights = config.equalHeights;
  if (typeof config.squash === "boolean") out.squash = config.squash;
  if (typeof config.poly === "boolean") out.poly = config.poly;
  if (isOgGroup(config.group)) out.group = config.group;
  if (config.cycle !== undefined) out.cycle = atLeast(config.cycle, R.ogCycle.min, out.cycle);
  if (isOgRhythm(config.rhythm)) out.rhythm = config.rhythm;
  if (config.steps !== undefined) out.steps = Math.round(atLeast(config.steps, R.ogSteps.min, out.steps));
  if (config.bpm !== undefined) out.bpm = atLeast(config.bpm, R.ogBpm.min, out.bpm);
  if (config.beats !== undefined) out.beats = Math.round(atLeast(config.beats, R.ogBeats.min, out.beats));
  if (isOgMetro(config.metro)) out.metro = config.metro;
  if (config.click !== undefined) out.click = atLeast(config.click, R.ogClick.min, out.click);
  if (config.bars !== undefined) out.bars = Math.round(atLeast(config.bars, R.ogBars.min, out.bars));
  if (typeof config.melody === "boolean") out.melody = config.melody;
  if (config.syncBpm !== undefined) {
    const n = Number(config.syncBpm);
    out.syncBpm = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return out;
}

/** The fields → the rhythm settings. */
export function orbRhythmSettingsOf(source: OrbRhythmFields): Omit<OrbRhythmSettings, "syncBpm"> {
  return {
    model: source.ogModel,
    equalHeights: source.ogEq,
    squash: source.ogSquash,
    poly: source.ogPoly,
    group: source.ogGroup,
    cycle: source.ogCycle,
    rhythm: source.ogRhythm,
    steps: source.ogSteps,
    bpm: source.ogBpm,
    beats: source.ogBeats,
    metro: source.ogMetro,
    click: source.ogClick,
    bars: source.ogBars,
    melody: source.ogMelody,
  };
}

/** The rhythm settings → the fields. */
export function orbRhythmFieldsOf(s: Omit<OrbRhythmSettings, "syncBpm">): OrbRhythmFields {
  return {
    ogModel: s.model,
    ogEq: s.equalHeights,
    ogSquash: s.squash,
    ogPoly: s.poly,
    ogGroup: s.group,
    ogCycle: s.cycle,
    ogRhythm: s.rhythm,
    ogSteps: s.steps,
    ogBpm: s.bpm,
    ogBeats: s.beats,
    ogMetro: s.metro,
    ogClick: s.click,
    ogBars: s.bars,
    ogMelody: s.melody,
  };
}

/* ------------------------------------------------------------------ the clock: metronome, cycle, in-phase moments */

/** Whether the metronome is on: a visual style or a click (it snaps the cycle to whole bars). */
export function metronomeOn(s: Pick<OrbRhythmSettings, "metro" | "click">): boolean {
  return s.metro !== "off" || s.click > 0;
}

/** The tempo the metronome runs at: the beat lock's while it is on, else its own (BPM, at least `MIN_BPM`). */
export function metronomeBpm(s: Pick<OrbRhythmSettings, "bpm" | "syncBpm">): number {
  const bpm = s.syncBpm > 0 ? s.syncBpm : s.bpm;
  return Number.isFinite(bpm) && bpm >= MIN_BPM ? bpm : MIN_BPM;
}

export interface BeatClock {
  bpm: number;
  beatSec: number;
  beats: number;
  barSec: number;
  /** The metronome is on (the cycle is `bars` whole bars). */
  on: boolean;
  /** Bars a cycle: the setting while the metronome is on, else the cycle in (rounded) bars of the tempo – the ratio voices' unit. */
  bars: number;
  /** The cycle L (seconds). */
  cycleSec: number;
}

/** The metronome's beat, bar and the cycle: L = bars · beats · 60 / BPM while the metronome is on, else the Cycle setting. */
export function beatClock(s: Pick<OrbRhythmSettings, "bpm" | "syncBpm" | "beats" | "bars" | "metro" | "click" | "cycle">): BeatClock {
  const bpm = metronomeBpm(s);
  const beatSec = 60 / bpm;
  const beats = Math.max(1, Math.round(Number.isFinite(s.beats) ? s.beats : 1));
  const barSec = beats * beatSec;
  const on = metronomeOn(s);
  const setBars = Math.max(1, Math.round(Number.isFinite(s.bars) ? s.bars : 1));
  const cycleSec = on ? setBars * barSec : Number.isFinite(s.cycle) && s.cycle > 0 ? s.cycle : DEFAULT_ORB_RHYTHM_SETTINGS.cycle;
  const bars = on ? setBars : Math.max(1, Math.round(cycleSec / barSec));
  return { bpm, beatSec, beats, barSec, on, bars, cycleSec };
}

/** The cycle length L (seconds) of these settings. */
export function cycleSeconds(s: Pick<OrbRhythmSettings, "bpm" | "syncBpm" | "beats" | "bars" | "metro" | "click" | "cycle">): number {
  return beatClock(s).cycleSec;
}

/** The greatest common divisor of two whole numbers (0 with 0 is 0). */
export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y > 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * How often the whole field is in phase (seconds): L / gcd of the counts – L for every preset whose counts share no factor
 * (the pendulum wave, corner, centre, Euclidean, varied), a bar for the ratio presets (their voices meet on every
 * downbeat); Infinity with the polyrhythm off (one tempo, shifted phases: never all on the slab at once).
 */
export function inPhasePeriodSec(counts: ArrayLike<number>, cycleSec: number, poly: boolean): number {
  if (!poly || !(cycleSec > 0)) return Infinity;
  let g = 0;
  for (let i = 0; i < counts.length; i++) g = gcd(g, counts[i]);
  return g > 0 ? cycleSec / g : cycleSec;
}

/** The cycle ends at or before `t` (seconds): ⌊t / L⌋ – the IN PHASE moments counted so far (t = 0 is the start, not one). */
export function cycleEndsUpTo(t: number, cycleSec: number): number {
  if (!(cycleSec > 0) || !(t > 0)) return 0;
  return Math.floor(t / cycleSec + PHASE_EPS);
}

/** Beats (metronome clicks) at or before `t` (seconds): the downbeat at 0 is the first. */
export function beatsUpTo(t: number, beatSec: number): number {
  if (!(beatSec > 0) || !(t >= 0)) return 0;
  return Math.floor(t / beatSec + PHASE_EPS) + 1;
}

/* ------------------------------------------------------------------ the ideal bouncer */

/** The apex (field widths) of an elastic bounce of period `periodSec` under gravity `g` (field widths / s²): g · T² / 8. */
export function apexOf(g: number, periodSec: number): number {
  return (g * periodSec * periodSec) / 8;
}

/** The share of its bounce an orb has flown at `t` (0 = on the slab, 0.5 = the apex): frac(t · f − φ). */
export function bouncePhase(t: number, freq: number, phase: number): number {
  const x = t * freq - phase;
  return x - Math.floor(x);
}

/** The height of an ideal bouncer: A · 4u(1 − u), u = frac(t · f − φ) (0 on the slab, A at the apex). */
export function bounceHeight(t: number, apex: number, freq: number, phase: number): number {
  const u = bouncePhase(t, freq, phase);
  return apex * 4 * u * (1 - u);
}

/** Landings at or before `t` (seconds; the start is none): ⌊t · f − φ⌋ – the slack makes a landing exactly at `t` count. */
export function landingsUpTo(t: number, freq: number, phase: number): number {
  return Math.floor(t * freq - phase + PHASE_EPS);
}

/** The landing squash (0–1) of an orb `u` of its bounce past its landing: 1 at the landing, easing out over `SQUASH_SEC`. */
export function squashOf(u: number, freq: number): number {
  if (!(freq > 0)) return 0;
  const since = u / freq;
  if (since >= SQUASH_SEC) return 0;
  const k = 1 - since / SQUASH_SEC;
  return k * k;
}

/* ------------------------------------------------------------------ groups and counts */

/** The Euclidean rhythm E(pulses, steps) as onset positions (`floor(i · steps / pulses)`, the Bresenham form; pulses ≤ steps). */
export function euclidOnsets(pulses: number, steps: number): number[] {
  const p = Math.max(0, Math.round(pulses));
  const n = Math.max(1, Math.round(steps));
  const out: number[] = [];
  for (let i = 0; i < Math.min(p, n); i++) out.push(Math.floor((i * n) / Math.min(p, n)));
  return out;
}

/** The Euclidean rhythm E(pulses, steps) as a pattern of 1s (onsets) and 0s. */
export function euclidPattern(pulses: number, steps: number): number[] {
  const n = Math.max(1, Math.round(steps));
  const out = new Array<number>(n).fill(0);
  for (const o of euclidOnsets(pulses, n)) out[o] = 1;
  return out;
}

/** The group pattern a preset uses: the Groups setting for the pattern presets, diagonals (corner), rings (centre), every orb (varied). */
export function effectiveGroup(rhythm: OgRhythm, group: OgGroup): OgGroup {
  if (rhythm === "corner") return "diagonals";
  if (rhythm === "centre") return "rings";
  if (rhythm === "varied") return "each";
  return group;
}

/**
 * The group of orb `i` and the number of groups: rows, columns, rings (a disc's or octagons' own rings, a grid's circles of
 * one spacing from the centre), diagonals corner to corner (row + column), a checkerboard (2) or every orb its own.
 */
export function groupIndex(layout: OrbLayout, group: OgGroup, i: number): number {
  switch (group) {
    case "rows":
      return layout.row[i];
    case "columns":
      return layout.col[i];
    case "rings":
      return layout.arrangement === "disc" || layout.arrangement === "octagons" ? layout.ring[i] : Math.floor(Math.hypot(layout.x[i], layout.y[i]) / Math.max(1e-12, layout.spacing) + 0.5);
    case "diagonals":
      return layout.row[i] + layout.col[i];
    case "checker":
      return (layout.row[i] + layout.col[i]) % 2;
    case "each":
      return i;
  }
}

/**
 * Each group's bounces per cycle (poly on): the pendulum wave 51 + k; a ratio preset r_(k mod V) × bars (V voices, r_v a
 * bar); the Euclidean ladder 51 + ⌊k · steps / K⌋ (the onsets of E(K, steps) for K ≤ steps; more groups share the steps
 * maximally evenly); corner and centre 51 · (1 + spread · k / (K − 1)), rounded. (The varied preset draws per orb: see
 * `planOrbRhythm()`.)
 */
export function rhythmCount(rhythm: OgRhythm, k: number, groups: number, s: { spread: number; steps: number; bars: number }): number {
  const x = groups > 1 ? k / (groups - 1) : 0;
  switch (rhythm) {
    case "pendulum":
      return PENDULUM_BASE + k;
    case "3-2":
    case "4-3":
    case "5-4":
    case "7-5":
    case "3-4-5": {
      const voices = RHYTHM_RATIOS[rhythm];
      return voices[k % voices.length] * Math.max(1, Math.round(s.bars));
    }
    case "euclid": {
      const steps = Math.max(1, Math.round(s.steps));
      return RHYTHM_BASE + Math.floor((k * steps) / Math.max(1, groups));
    }
    case "corner":
    case "centre":
    case "varied":
      return Math.max(1, Math.round(RHYTHM_BASE * (1 + Math.max(0, s.spread) * x)));
  }
}

/** The slowest count a preset gives (the one tempo of the field with the polyrhythm off). */
export function slowestCount(rhythm: OgRhythm, bars: number): number {
  const voices = (RHYTHM_RATIOS as Record<string, readonly number[] | undefined>)[rhythm];
  return voices ? Math.min(...voices) * Math.max(1, Math.round(bars)) : RHYTHM_BASE;
}

/* ------------------------------------------------------------------ the plan */

export interface OrbRhythmPlan {
  count: number;
  /** Per orb: bounce frequency (bounces a second), phase (bounces), apex (field widths), group, and its count a cycle. */
  freq: Float64Array;
  phase: Float64Array;
  apex: Float32Array;
  group: Int32Array;
  /** Groups, each group's count a cycle and its melody degree (0 … `degrees`: the slowest low). */
  groups: number;
  groupCount: Float64Array;
  groupDegree: Int32Array;
  /** The distinct counts (tempos), the slowest and the fastest. */
  tempos: number;
  minCount: number;
  maxCount: number;
  /** The clock: the cycle, how often the field is in phase (Infinity: never), the metronome. */
  clock: BeatClock;
  periodSec: number;
  /** The gravity of the field (field widths / s²; the apexes follow it unless the heights are equal) and the highest apex. */
  gravity: number;
  maxApex: number;
}

/** Inputs of the plan beyond the rhythm settings: the drop height (the slowest orb's apex at the reference gravity) and the spread. */
export interface OrbRhythmPlanInput extends OrbRhythmSettings {
  dropHeight: number;
  spread: number;
}

/**
 * Plans a rhythm field on `layout`: groups, counts, frequencies, phases and apexes. `gravityScale` is the Gravity setting
 * over its reference (1 at the default): the field's gravity g puts the slowest orb's apex at the drop height × that scale
 * (g = 8 · H · scale / T_max²), every other apex is g · T² / 8 – or all of them H × scale with equal heights. `random` is the
 * seed's generator (the varied preset draws one number per orb; null: a fixed sequence, for the panel's summary).
 * `degrees`: the melody's degree span (the slowest group 0, the fastest `degrees`).
 */
export function planOrbRhythm(s: OrbRhythmPlanInput, layout: OrbLayout, gravityScale: number, random: (() => number) | null, degrees = 14): OrbRhythmPlan {
  const n = layout.count;
  const clock = beatClock(s);
  const L = clock.cycleSec;
  const pattern = effectiveGroup(s.rhythm, s.group);
  const group = new Int32Array(n);
  let groups = 0;
  for (let i = 0; i < n; i++) {
    const k = groupIndex(layout, pattern, i);
    group[i] = k;
    if (k + 1 > groups) groups = k + 1;
  }
  groups = Math.max(1, groups);
  const spread = Math.max(0, s.spread);
  const ctx = { spread, steps: s.steps, bars: clock.bars };
  const groupCount = new Float64Array(groups);
  for (let k = 0; k < groups; k++) groupCount[k] = rhythmCount(s.rhythm, k, groups, ctx);
  const freq = new Float64Array(n);
  const phase = new Float64Array(n);
  const count = new Float64Array(n);
  let fixed = 0.5;
  const rnd = random ?? (() => (fixed = (fixed * 9301 + 0.49297) % 1));
  const varied = s.rhythm === "varied";
  const variedSpan = Math.max(0, Math.round(RHYTHM_BASE * spread));
  const one = slowestCount(s.rhythm, clock.bars);
  for (let i = 0; i < n; i++) {
    const k = group[i];
    const r = varied ? rnd() : 0;
    if (s.poly) {
      const c = varied ? RHYTHM_BASE + Math.min(variedSpan, Math.floor(r * (variedSpan + 1))) : groupCount[k];
      count[i] = c;
      freq[i] = c / L;
      phase[i] = 0;
    } else {
      // One tempo for the whole field; the phase shifts with the group's position (or the seed's draw): a travelling wave.
      count[i] = one;
      freq[i] = one / L;
      const x = varied ? r : groups > 1 ? k / (groups - 1) : 0;
      const p = spread * x;
      phase[i] = p - Math.floor(p);
    }
  }
  // The varied preset's groups are its distinct counts (the melody's pitches, the sound's groups).
  let minCount = Infinity;
  let maxCount = 0;
  for (let i = 0; i < n; i++) {
    if (count[i] < minCount) minCount = count[i];
    if (count[i] > maxCount) maxCount = count[i];
  }
  if (!Number.isFinite(minCount)) minCount = maxCount = 0;
  const distinct = Array.from(new Set(Array.from(count))).sort((a, b) => a - b);
  if (varied && s.poly) {
    const rank = new Map(distinct.map((c, j) => [c, j] as const));
    groups = Math.max(1, distinct.length);
    for (let i = 0; i < n; i++) group[i] = rank.get(count[i]) ?? 0;
  }
  const finalGroupCount = varied && s.poly ? Float64Array.from(distinct.length ? distinct : [0]) : s.poly ? groupCount : new Float64Array(groups).fill(one);
  // Melody degrees: the slowest tempo lowest, the fastest `degrees` up (equal counts share a pitch); with one tempo, by position.
  const groupDegree = new Int32Array(groups);
  if (s.poly) {
    const tempos = Array.from(new Set(Array.from(finalGroupCount))).sort((a, b) => a - b);
    const rank = new Map(tempos.map((c, j) => [c, j] as const));
    for (let k = 0; k < groups; k++) groupDegree[k] = tempos.length > 1 ? Math.round(((rank.get(finalGroupCount[k]) ?? 0) / (tempos.length - 1)) * degrees) : 0;
  } else for (let k = 0; k < groups; k++) groupDegree[k] = groups > 1 ? Math.round((k / (groups - 1)) * degrees) : 0;
  // The apexes: the slowest orb at the drop height × the gravity scale, the others by g · T² / 8 (or all equal).
  const H = Math.max(0, s.dropHeight) * Math.max(0, gravityScale);
  const fMin = minCount > 0 && L > 0 ? minCount / L : 0;
  const tMax = fMin > 0 ? 1 / fMin : 0;
  const g = tMax > 0 ? (8 * H) / (tMax * tMax) : 0;
  const apex = new Float32Array(n);
  let maxApex = 0;
  for (let i = 0; i < n; i++) {
    const a = s.equalHeights ? H : freq[i] > 0 ? apexOf(g, 1 / freq[i]) : 0;
    apex[i] = a;
    if (a > maxApex) maxApex = a;
  }
  return {
    count: n,
    freq,
    phase,
    apex,
    group,
    groups,
    groupCount: finalGroupCount,
    groupDegree,
    tempos: s.poly ? distinct.length : 1,
    minCount,
    maxCount,
    clock,
    periodSec: inPhasePeriodSec(s.poly ? distinct : [one], L, s.poly),
    gravity: g,
    maxApex,
  };
}

/* ------------------------------------------------------------------ the finder's instant answer */

export interface RhythmResolveAnswer {
  /** The run is in phase within the tolerance of the target (at `atSec`). */
  found: boolean;
  /** The in-phase moment nearest the target (seconds; NaN: the field is never in phase – the polyrhythm off). */
  atSec: number;
  /** The cycle L (seconds): the IN PHASE moments are its multiples. */
  cycleSec: number;
}

/**
 * "In phase at" for a rhythm field, by the cycle maths alone (no seed to search – every seed falls into phase on the same
 * clock): the nearest IN PHASE moment k · L (k ≥ 1) to `targetSec`, and whether it is within `toleranceSec`.
 */
export function rhythmResolveAnswer(cycleSec: number, poly: boolean, targetSec: number, toleranceSec: number): RhythmResolveAnswer {
  if (!poly || !(cycleSec > 0)) return { found: false, atSec: NaN, cycleSec };
  const k = Math.max(1, Math.round(targetSec / cycleSec));
  const at = k * cycleSec;
  return { found: Math.abs(at - targetSec) <= toleranceSec + 1e-9, atSec: at, cycleSec };
}

/* ------------------------------------------------------------------ render time */

/** The engine's fixed step (ms). */
export const ORB_STEP_MS = 1000 / 60;

/**
 * The simulation time (ms) a frame is drawn at: what the page (or the fast export) has fed the engine so far – the engine's
 * time, the part of a step it holds and the page's own leftover – one fixed step behind, so the frame shows the step that
 * made its sound; `stepMs` is the engine's last step (the bounce-math "timeScale" rule stretches it). It moves on by exactly
 * the frame's time every frame (a 120 Hz display draws 120 distinct heights a second), never more than a step away from the
 * engine's time, never below 0 and never past the end of a finished run (`endMs` ≥ 0).
 */
export function orbRenderTimeMs(elapsedMs: number, engineRemainderMs: number, pageLeftoverMs: number, stepMs: number, endMs = -1): number {
  const step = stepMs > 0 && Number.isFinite(stepMs) ? stepMs : ORB_STEP_MS;
  const scale = step / ORB_STEP_MS;
  let t = elapsedMs + (engineRemainderMs + pageLeftoverMs - ORB_STEP_MS) * scale;
  if (t > elapsedMs + step) t = elapsedMs + step;
  if (t < elapsedMs - step) t = elapsedMs - step;
  if (endMs >= 0 && t > endMs) t = endMs;
  return t > 0 ? t : 0;
}
