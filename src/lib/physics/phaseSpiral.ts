import { degreeToMidi, scalarDegree } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";
import { atLeastMin, ENTITY_CEILING, memoryCeiling } from "@/lib/uncap";

/*
 * --- phase-spiral --- Phase Spiral (the loopmechanics family "rings that each gain one lap on the next, winding into a spiral
 * and straightening into a line"): an extension of Metronomes & Polyrhythms (lib/physics/modes/polyrhythm.ts, layout "rings"),
 * pure and unit-tested (tests/phaseSpiral.test.ts).
 *
 * - **Arms** (`arms`, URL `prar`): every ring of the rings and spiral layouts carries k dots, evenly spaced (k spokes at the
 *   start). A dot steps one spoke – 1/k of a turn – a tick, so ring i still ticks (base + i) times a cycle and the polyrhythm,
 *   its chord and its finish are the classic one's; the k-fold picture, which repeats every 1/k of a turn, makes (base + i) of
 *   its laps a cycle – each ring gains one lap of the picture on the next – winds into a k-armed spiral, passes through its
 *   interference patterns and straightens into the k spokes exactly once a cycle, on the alignment. One arm is the classic
 *   rings run, placed exactly as before.
 * - **In line N %** (`alignMeter`, URL `prm`): the arms-fold resultant of the dot angles, |mean of e^{i·k·θ}| × 100 – the k
 *   spokes count as 100 %. A dot's k·θ is its tick phase (ticks elapsed) times 2π plus a constant, so the meter is the order
 *   parameter of the tick phases (`inLineOf()`), exact from the step counter: 100 % at every alignment, near 0 in between.
 * - **Comet tails** (`trail`, URL `prtl`, seconds of motion a tail reaches back; the classic 0.18 s by default) and the
 *   **spiral palette** (`palette` "spiral", URL `prco`: cool inside, warm outside on a dark disc, the account's look).
 * - **Loop sounds** (`loopSound`, URL `prls`; the loop foundation's voices, lib/audio/loopTones.ts through
 *   `ToneGenerator.playLoop()`): every tick a pentatonic pluck pitched by the ring (`phaseSpiralPitch()`: the inner, slow
 *   rings low, the outer, fast ones high – A major pentatonic from A3, 12 degrees, inside C3–C6), at most 6 a step at
 *   1/√n; the alignment the completion chord on A2 with its ding and sub; and the meter's **alignProgress** crossings of
 *   50, 75 and 90 % on the way up each start a riser that stops exactly on the alignment's chord (`riserSteps()`).
 *
 * The seam of an endless run (cycles 0) is the alignment itself (`polyLoopPeriod()`): the loop contract cuts recordings to
 * whole cycles, so a clip starts on the spokes and its last frame flows into them again.
 */

export const POLY_PALETTES = ["rainbow", "spiral"] as const;
export type PolyPalette = (typeof POLY_PALETTES)[number];

export function isPolyPalette(value: unknown): value is PolyPalette {
  return typeof value === "string" && (POLY_PALETTES as readonly string[]).includes(value);
}

/** The Phase Spiral part of the Metronomes & Polyrhythms settings (`PolyrhythmSettings` extends it). */
export interface PhaseSpiralSettings {
  /** Dots a ring of the rings and spiral layouts, evenly spaced (1 = the classic single dot). */
  arms: number;
  /** The "in line N %" meter (the arms-fold resultant of the dot angles). */
  alignMeter: boolean;
  /** Comet tails: the seconds of motion a dot's tail reaches back (0 = none). */
  trail: number;
  /** The loop family's voices (plucks, the completion chord, risers) instead of the instrument's notes. */
  loopSound: boolean;
  /** The dots' colours: by index round the hue circle, or cool inside and warm outside on a dark disc. */
  palette: PolyPalette;
}

/** The classic comet tail: what the rings drew before the setting existed (0.18 s of motion, at most 70°). */
export const DEFAULT_TRAIL_SEC = 0.18;

export const DEFAULT_PHASE_SPIRAL_SETTINGS: Readonly<PhaseSpiralSettings> = { arms: 1, alignMeter: false, trail: DEFAULT_TRAIL_SEC, loopSound: false, palette: "rainbow" };

/** The SimulatorSettings fields (URL keys prar, prm, prtl, prls, prco). */
export interface PhaseSpiralSettingFields {
  prArms: number;
  prAlignMeter: boolean;
  prTrail: number;
  prLoopSound: boolean;
  prPalette: PolyPalette;
}

/** The arms' comfort range (the engine reads it: spread into POLYRHYTHM_RANGES). */
export const PHASE_SPIRAL_RANGES = {
  prArms: { min: 1, max: 8, step: 1 },
} as const;

/** The tails' comfort range: the picture's (the canvas draws them; no engine reads it), spread into `RANGES` on its own. */
export const PHASE_SPIRAL_PICTURE_RANGES = {
  prTrail: { min: 0, max: 1, step: 0.02 },
} as const;

/** Validates the Phase Spiral part of a settings object: whole arms of at least 1 (no maximum but the memory ceiling), a trail of at least 0, real booleans, a known palette. */
export function resolvePhaseSpiralSettings(config: Partial<PhaseSpiralSettings> | null | undefined): PhaseSpiralSettings {
  const out: PhaseSpiralSettings = { ...DEFAULT_PHASE_SPIRAL_SETTINGS };
  if (!config) return out;
  if (config.arms !== undefined) {
    const n = Number(config.arms);
    if (Number.isFinite(n)) out.arms = memoryCeiling("prArms", Math.round(atLeastMin(n, PHASE_SPIRAL_RANGES.prArms)));
  }
  if (typeof config.alignMeter === "boolean") out.alignMeter = config.alignMeter;
  if (config.trail !== undefined) {
    const n = Number(config.trail);
    if (Number.isFinite(n)) out.trail = Math.round(1000 * atLeastMin(n, PHASE_SPIRAL_PICTURE_RANGES.prTrail)) / 1000;
  }
  if (typeof config.loopSound === "boolean") out.loopSound = config.loopSound;
  if (isPolyPalette(config.palette)) out.palette = config.palette;
  return out;
}

export function phaseSpiralSettingsOf(source: PhaseSpiralSettingFields): PhaseSpiralSettings {
  return { arms: source.prArms, alignMeter: source.prAlignMeter, trail: source.prTrail, loopSound: source.prLoopSound, palette: source.prPalette };
}

export function phaseSpiralSettingFields(settings: PhaseSpiralSettings): PhaseSpiralSettingFields {
  return { prArms: settings.arms, prAlignMeter: settings.alignMeter, prTrail: settings.trail, prLoopSound: settings.loopSound, prPalette: settings.palette };
}

/* ------------------------------------------------------------------ URL */

function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Writes the fields that differ from `base`: prar, prm, prtl, prls, prco. */
export function writePhaseSpiralParams(settings: PhaseSpiralSettingFields, base: PhaseSpiralSettingFields, params: URLSearchParams) {
  if (settings.prArms !== base.prArms) params.set("prar", formatNumber(settings.prArms));
  if (settings.prAlignMeter !== base.prAlignMeter) params.set("prm", settings.prAlignMeter ? "1" : "0");
  if (settings.prTrail !== base.prTrail) params.set("prtl", formatNumber(settings.prTrail));
  if (settings.prLoopSound !== base.prLoopSound) params.set("prls", settings.prLoopSound ? "1" : "0");
  if (settings.prPalette !== base.prPalette) params.set("prco", settings.prPalette);
}

/** Reads the feature's URL parameters into `settings` (validated: an invalid value keeps what it was). */
export function readPhaseSpiralParams(params: URLSearchParams, settings: PhaseSpiralSettingFields) {
  const next: Partial<PhaseSpiralSettings> = phaseSpiralSettingsOf(settings);
  const num = (key: string) => {
    const raw = params.get(key);
    return raw === null || raw.trim() === "" ? undefined : Number(raw);
  };
  const bool = (key: string) => {
    const raw = params.get(key);
    return raw === "1" ? true : raw === "0" ? false : undefined;
  };
  const arms = num("prar");
  if (arms !== undefined && Number.isFinite(arms)) next.arms = arms;
  const trail = num("prtl");
  if (trail !== undefined && Number.isFinite(trail)) next.trail = trail;
  const meter = bool("prm");
  if (meter !== undefined) next.alignMeter = meter;
  const sound = bool("prls");
  if (sound !== undefined) next.loopSound = sound;
  const palette = params.get("prco");
  if (isPolyPalette(palette)) next.palette = palette;
  Object.assign(settings, phaseSpiralSettingFields(resolvePhaseSpiralSettings(next)));
}

/* ------------------------------------------------------------------ arms */

/** Layouts whose dots orbit the centre: the ones that carry arms. */
export function orbitLayout(layout: string): boolean {
  return layout === "rings" || layout === "spiral";
}

/** The most dots a run builds (each an engine ball pinned to the clock): rings × arms stop here, whatever the settings say. */
export const DOT_CEILING = ENTITY_CEILING;

/** The arms a run builds: the setting on the orbit layouts (rings, spiral), as many as fit `DOT_CEILING` with `count` rings (at least 1); one elsewhere. */
export function effectiveArms(layout: string, arms: number, count: number): number {
  if (!orbitLayout(layout)) return 1;
  const k = Number.isFinite(arms) ? Math.max(1, Math.floor(arms)) : 1;
  return Math.max(1, Math.min(k, Math.floor(DOT_CEILING / Math.max(1, count))));
}

/**
 * A voice's tick phase modulo `arms` (ticks elapsed after `steps` steps of a voice ticking a / D times a second, in [0, arms)):
 * exact – the remainder is taken on whole numbers, like `tickPhaseMod2()`.
 */
export function tickPhaseModArms(a: number, D: number, steps: number, sps: number, arms: number): number {
  const q = sps * D;
  return ((steps * a) % (arms * q)) / q;
}

/** The angle (radians) of dot `j` of a ring whose tick point is at `tickAngle`: one spoke (2π / arms) a tick, the arms 2π / arms apart. */
export function armAngle(tickAngle: number, phaseModArms: number, j: number, arms: number, direction: number): number {
  return tickAngle + (direction * 2 * Math.PI * (phaseModArms + j)) / arms;
}

/* ------------------------------------------------------------------ the meter */

/**
 * "In line": |mean over the voices of e^{2πi·u}| with u the voice's tick phase (ticks elapsed after `steps` steps, modulo 1,
 * exact from the step counter) – the arms-fold resultant of the dot angles of the rings layout (the k dots of a ring share
 * e^{i·k·θ}; k·θ = 2π·u + a constant), so the spokes read 1 (100 %) and an even spread 0. Allocation-free.
 */
export function inLineOf(a: ArrayLike<number>, D: number, steps: number, sps: number): number {
  const n = a.length;
  if (n === 0) return 1;
  const q = sps * D;
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const u = ((steps * a[i]) % q) / q;
    const angle = 2 * Math.PI * u;
    re += Math.cos(angle);
    im += Math.sin(angle);
  }
  const r = Math.sqrt(re * re + im * im) / n;
  return r > 1 ? 1 : r;
}

/** The meter's crossings on the way up that start a riser into the alignment (the alignProgress events). */
export const ALIGN_PROGRESS_THRESHOLDS: readonly number[] = [0.5, 0.75, 0.9];

/** How many thresholds the meter crossed upward from `prev` to `cur` – each threshold t with prev < t ≤ cur – written as their indices into `out`. */
export function progressCrossings(prev: number, cur: number, out: number[]): number[] {
  out.length = 0;
  if (!(cur > prev)) return out;
  for (let i = 0; i < ALIGN_PROGRESS_THRESHOLDS.length; i++) {
    const t = ALIGN_PROGRESS_THRESHOLDS[i];
    if (prev < t && t <= cur) out.push(i);
  }
  return out;
}

/**
 * Steps from step `step` (just simulated) to the step whose sound carries the next alignment – the first multiple of D / g
 * seconds after the end of step `step`, which lands in step ⌊m·D·sps / g⌋ – so a riser started with step `step`'s sounds
 * stops exactly when the alignment's chord starts.
 */
export function stepsToNextAlignment(g: number, D: number, step: number, sps: number): number {
  const q = sps * D;
  const m = ceilWhole((step + 1) * g, q);
  const alignStep = floorWhole(m * q, g);
  return Math.max(0, alignStep - step);
}

/** ⌊p / q⌋ and ⌈p / q⌉ for whole numbers p ≥ 0, q > 0, exact below 2^53 (polyrhythm.ts' floorDiv / ceilDiv). */
function floorWhole(p: number, q: number): number {
  return (p - (p % q)) / q;
}
function ceilWhole(p: number, q: number): number {
  const r = p % q;
  return (p - r) / q + (r > 0 ? 1 : 0);
}

/* ------------------------------------------------------------------ the loop */

/**
 * The seamless period of an endless run, as mult · D / div seconds (exact): the alignment period D / g for the orbit layouts
 * (the dots are back on their tick points, the meter at 100 %), the cycle D / cycleDiv with the polygons turning, twice the
 * alignment period for the arcs and metronomes (every dot back at the end it started at), times `accentEvery` when accents
 * mark every k-th tick (so the accent rings repeat too).
 */
export function polyLoopPeriod(series: { D: number; g: number; cycleDiv: number }, layout: string, polygons: boolean, accentEvery: number): { mult: number; div: number; sec: number } {
  let mult = 1;
  let div = series.g;
  if (!orbitLayout(layout)) mult = 2;
  else if (polygons) div = series.cycleDiv;
  if (accentEvery > 0) mult *= Math.round(accentEvery);
  return { mult, div, sec: (mult * series.D) / div };
}

/** Seams an endless run passed before step `step` (a seam at the step's start is not passed yet: that frame shows it). */
export function seamsBefore(period: { mult: number; div: number }, D: number, step: number, sps: number): number {
  if (step <= 0) return 0;
  return ceilWhole(step * period.div, sps * period.mult * D) - 1;
}

/* ------------------------------------------------------------------ sound */

/** The plucks' key: A major pentatonic from A3 (MIDI 57) over `PS_SPAN` degrees (A3–B5, inside C3–C6). */
export const PS_ROOT_MIDI = 57;
export const PS_SPAN = 11;
/** The completion chord's root on an alignment: A2 (110 Hz, the tonic of the plucks' key). */
export const PS_CHORD_HZ = 110;
/** At most this many plucks a step (the loop budget's new notes a tick). */
export const PS_PLUCKS_PER_STEP = 6;
/** The risers at the 50 / 75 / 90 % crossings: from root × these (2 octaves up, so they end on A4, E5, A5), at these levels. */
export const PS_RISER_FROM: readonly number[] = [1, 1.5, 2];
export const PS_RISER_LEVELS: readonly number[] = [0.5, 0.7, 0.9];
/** A crossing further than this from the alignment starts no riser (a partial alignment on the way that falls back). */
export const PS_RISER_MAX_SEC = 3;

/** A ring's degree of the key (0 … PS_SPAN): its index spread over the span – the inner, slow rings low, the outer, fast ones high. */
export function phaseSpiralDegree(index: number, count: number): number {
  return scalarDegree(index, 0, Math.max(1, count - 1), PS_SPAN);
}

/** The pluck (Hz) of a degree of the key (A major pentatonic from A3). */
export function phaseSpiralDegreeHz(degree: number): number {
  return midiToFrequency(degreeToMidi(degree, PS_ROOT_MIDI));
}

/** A ring's pluck (Hz): its degree of the key (`phaseSpiralDegree()`). */
export function phaseSpiralPitch(index: number, count: number): number {
  return phaseSpiralDegreeHz(phaseSpiralDegree(index, count));
}

/**
 * The plucks of one step (at most PS_PLUCKS_PER_STEP): the degrees that ticked (`level[d] > 0`), in pitch order, spread evenly
 * when there are more (the lowest and the highest kept) – written as degree indices into `out`.
 */
export function pickPluckDegrees(level: ArrayLike<number>, out: number[]): number[] {
  out.length = 0;
  for (let d = 0; d < level.length; d++) if (level[d] > 0) out.push(d);
  const m = out.length;
  if (m <= PS_PLUCKS_PER_STEP) return out;
  // keep evenly spread ones (k·(m − 1) / (max − 1)), in place: every pick is at or after its slot
  for (let k = 0; k < PS_PLUCKS_PER_STEP; k++) out[k] = out[Math.round((k * (m - 1)) / (PS_PLUCKS_PER_STEP - 1))];
  out.length = PS_PLUCKS_PER_STEP;
  return out;
}

/** A ring's velocity: narrow, 0.8 + 0.2 × its speed rank (the outer rings are the fast ones). */
export function phaseSpiralLevel(index: number, count: number): number {
  return 0.8 + (0.2 * (count > 1 ? index / (count - 1) : 1));
}

/* ------------------------------------------------------------------ colours */

/** The spiral palette: blue (215°) at the centre, through cyan, green and yellow, to orange and red outside. */
export function spiralColor(index: number, count: number): string {
  const f = count > 1 ? index / (count - 1) : 0;
  const hue = (((215 - 225 * f) % 360) + 360) % 360;
  return `hsl(${Math.round(hue)}, 92%, 60%)`;
}

/** The dark disc the spiral palette draws the rings on. */
export const SPIRAL_DISC = "#05070f";

/* ------------------------------------------------------------------ the preset */

/** The "Phase spiral, 20 rings × 3 arms" preset: the account's clip – 20 harmonic rings, 3 arms, a 20 s loop, the meter, comet tails, the loop sounds and look. */
export const PHASE_SPIRAL_PRESET = {
  prLayout: "rings" as const,
  prTempos: "harmonic" as const,
  prCount: 20,
  prCycleSeconds: 20,
  prPolygon: false,
  prAccentEvery: 0,
  prNumbers: false,
  prCycles: 0,
  prArms: 3,
  prAlignMeter: true,
  prTrail: 0.6,
  prLoopSound: true,
  prPalette: "spiral" as const,
  backgroundColors: ["#0b1020", "#0b1020"] as [string, string],
  loopHud: true,
};

/** The meter's text value: a whole percentage. */
export function inLinePercent(inLine: number): number {
  return Math.round(100 * (inLine > 1 ? 1 : inLine < 0 ? 0 : inLine));
}
