import { midiToFrequency } from "@/lib/audio/scales";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { TWO_PI } from "../types";

/**
 * Pendulum Wave ("pendulum" mode, the project.jdm pendulum-wave / phasing formats): no rings. A set of
 * 5–60 pendulums swings side by side with the classic tuning of the Harvard pendulum wave: pendulum *i*
 * completes `baseOscillations + i` oscillations in one cycle of `cycleSeconds`, so the row starts in
 * line, drifts out of phase into travelling waves, splits into two and three groups and snaps back in
 * line exactly once per cycle. The motion is the analytic small-angle solution
 * θᵢ(t) = A · cos(2π fᵢ t), evaluated at every sub-step from the simulation clock (no integration, no
 * drift), which keeps a run deterministic and lets the recorder replay it exactly.
 *
 * Six layouts share the same tuning and only differ in where a bob goes for a given swing:
 *  - `row`: pivots on a bar, bobs hanging below it, string lengths ∝ 1/f² (visibly different);
 *  - `arc`: pivots around a ring, every pendulum hanging toward the centre ("Pendulum Wave in a Circle");
 *  - `circle`: every bob moves along its own radius from the centre (the "sacred geometry" look) and
 *    `polygon` 3–8 maps the radii onto a slowly rotating polygon outline;
 *  - `galaxy`: the radial layout on a frame that turns once per cycle, so the trails draw spiral arms;
 *  - `sliding`: the bobs slide left–right on stacked rails;
 *  - `bouncing`: the bobs are balls bouncing on a floor – a rectified free-fall arc with the period of
 *    the series, so every ball hits the floor at its own frequency (and the slow ones bounce highest).
 * `phasing` swaps the harmonic series (fᵢ = (K + i) / T) for an arithmetic series of swing times
 * (each bob's swing lasts a fixed bit longer than the next one's – a Reich-style tempo phase shift),
 * over the same range of tempi, so the row keeps phasing instead of snapping back in line.
 *
 * Sound: a bob queues a "hit" sound event when it crosses the centre line, reaches an extreme or both
 * (`soundOn`; the floor hit and the apex for the bouncing layout), pitched by its index as a degree of a
 * major scale from C4 (low to high or high to low – `pitchDirection`); the tone generator then applies
 * the instrument, the scale snap, the beat lock and the hit sample like it does to every other hit. The
 * event times are solved analytically inside each 60 Hz step, and with `waveChord` on, bobs whose
 * events fall within `CHORD_WINDOW_SEC` of each other are queued as one chord (`SoundEvent.chord`), so
 * the in-phase moment sounds like a chord instead of a pile of notes. Everything random – the side the
 * bobs start on and the direction the frame / polygon turns – comes from `ctx.random()`.
 */

export const PENDULUM_LAYOUTS = ["row", "arc", "circle", "galaxy", "sliding", "bouncing"] as const;
export type PendulumLayout = (typeof PENDULUM_LAYOUTS)[number];

export function isPendulumLayout(value: unknown): value is PendulumLayout {
  return typeof value === "string" && (PENDULUM_LAYOUTS as readonly string[]).includes(value);
}

export const PENDULUM_SOUND_ONS = ["center", "extremes", "both"] as const;
export type PendulumSoundOn = (typeof PENDULUM_SOUND_ONS)[number];

export function isPendulumSoundOn(value: unknown): value is PendulumSoundOn {
  return typeof value === "string" && (PENDULUM_SOUND_ONS as readonly string[]).includes(value);
}

export const PENDULUM_PITCH_DIRECTIONS = ["up", "down"] as const;
export type PendulumPitchDirection = (typeof PENDULUM_PITCH_DIRECTIONS)[number];

export function isPendulumPitchDirection(value: unknown): value is PendulumPitchDirection {
  return typeof value === "string" && (PENDULUM_PITCH_DIRECTIONS as readonly string[]).includes(value);
}

/** Polygon choices of the radial layouts: 0 keeps the circle, 3–8 map the radii onto a rotating polygon. */
export const PENDULUM_POLYGONS = [0, 3, 4, 5, 6, 7, 8] as const;

export interface PendulumSettings {
  /** Pendulums, 5–60. */
  count: number;
  /** Oscillations the slowest pendulum completes per cycle (K); pendulum i completes K + i. */
  baseOscillations: number;
  /** Length of one cycle in seconds (T): the row is back in phase every T seconds. */
  cycleSeconds: number;
  /** Swing amplitude in degrees, 5–60 (the radial / sliding travel follows it; the bouncing layout ignores it). */
  amplitude: number;
  layout: PendulumLayout;
  /** 0 (circle) or 3–8: the radial layouts map the bobs onto a rotating polygon outline. */
  polygon: number;
  /** Arithmetic series of swing times instead of the harmonic (K + i) / T tuning. */
  phasing: boolean;
  /** 0–1: length of the fading trails (0 = none). */
  trails: number;
  /** Where a bob plays its note: at the centre crossing, at the extremes or both. */
  soundOn: PendulumSoundOn;
  /** "up": the slowest (longest) pendulum plays the lowest note; "down": the highest. */
  pitchDirection: PendulumPitchDirection;
  /** Bobs whose events fall within 20 ms of each other play as one chord. */
  waveChord: boolean;
  /** The run finishes after this many full cycles; 0 = never. */
  cycles: number;
}

export const DEFAULT_PENDULUM_SETTINGS: PendulumSettings = {
  count: 15,
  baseOscillations: 51,
  cycleSeconds: 60,
  amplitude: 25,
  layout: "row",
  polygon: 0,
  phasing: false,
  trails: 0.3,
  soundOn: "center",
  pitchDirection: "up",
  waveChord: true,
  cycles: 1,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const PENDULUM_RANGES = {
  pwCount: { min: 5, max: 60, step: 1 },
  pwBaseOscillations: { min: 4, max: 80, step: 1 },
  pwCycleSeconds: { min: 10, max: 180, step: 1 },
  pwAmplitude: { min: 5, max: 60, step: 1 },
  pwPolygon: { min: 0, max: 8, step: 1 },
  pwTrails: { min: 0, max: 1, step: 0.05 },
  pwCycles: { min: 0, max: 10, step: 1 },
} as const;

/** The Pendulum Wave fields of the SimulatorSettings object (URL keys pwn, pwk, pwt, pwa, pwl, pwp, pwph, pwtr, pws, pwpd, pwch, pwc). */
export interface PendulumSettingFields {
  pwCount: number;
  pwBaseOscillations: number;
  pwCycleSeconds: number;
  pwAmplitude: number;
  pwLayout: PendulumLayout;
  pwPolygon: number;
  pwPhasing: boolean;
  pwTrails: number;
  pwSoundOn: PendulumSoundOn;
  pwPitchDirection: PendulumPitchDirection;
  pwWaveChord: boolean;
  pwCycles: number;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults and clamps every value to its range (counts become whole numbers, a polygon of 1–2 sides is the circle; unknown layouts / options and bad numbers fall back to the defaults). */
export function resolvePendulumSettings(config: Partial<PendulumSettings> | null | undefined): PendulumSettings {
  const out = { ...DEFAULT_PENDULUM_SETTINGS };
  if (!config) return out;
  if (config.count !== undefined) out.count = Math.round(clampNumber(config.count, PENDULUM_RANGES.pwCount, out.count));
  if (config.baseOscillations !== undefined) out.baseOscillations = Math.round(clampNumber(config.baseOscillations, PENDULUM_RANGES.pwBaseOscillations, out.baseOscillations));
  if (config.cycleSeconds !== undefined) out.cycleSeconds = Math.round(clampNumber(config.cycleSeconds, PENDULUM_RANGES.pwCycleSeconds, out.cycleSeconds));
  if (config.amplitude !== undefined) out.amplitude = clampNumber(config.amplitude, PENDULUM_RANGES.pwAmplitude, out.amplitude);
  if (isPendulumLayout(config.layout)) out.layout = config.layout;
  if (config.polygon !== undefined) {
    const p = Math.round(clampNumber(config.polygon, PENDULUM_RANGES.pwPolygon, out.polygon));
    out.polygon = p < 3 ? 0 : p;
  }
  if (typeof config.phasing === "boolean") out.phasing = config.phasing;
  if (config.trails !== undefined) out.trails = clampNumber(config.trails, PENDULUM_RANGES.pwTrails, out.trails);
  if (isPendulumSoundOn(config.soundOn)) out.soundOn = config.soundOn;
  if (isPendulumPitchDirection(config.pitchDirection)) out.pitchDirection = config.pitchDirection;
  if (typeof config.waveChord === "boolean") out.waveChord = config.waveChord;
  if (config.cycles !== undefined) out.cycles = Math.round(clampNumber(config.cycles, PENDULUM_RANGES.pwCycles, out.cycles));
  return out;
}

/** Picks the Pendulum Wave settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setPendulumSettings()`. */
export function pendulumSettingsOf(source: PendulumSettingFields): PendulumSettings {
  return {
    count: source.pwCount,
    baseOscillations: source.pwBaseOscillations,
    cycleSeconds: source.pwCycleSeconds,
    amplitude: source.pwAmplitude,
    layout: source.pwLayout,
    polygon: source.pwPolygon,
    phasing: source.pwPhasing,
    trails: source.pwTrails,
    soundOn: source.pwSoundOn,
    pitchDirection: source.pwPitchDirection,
    waveChord: source.pwWaveChord,
    cycles: source.pwCycles,
  };
}

/** Writes resolved Pendulum Wave settings back into the SimulatorSettings field names. */
export function pendulumSettingFields(settings: PendulumSettings): PendulumSettingFields {
  return {
    pwCount: settings.count,
    pwBaseOscillations: settings.baseOscillations,
    pwCycleSeconds: settings.cycleSeconds,
    pwAmplitude: settings.amplitude,
    pwLayout: settings.layout,
    pwPolygon: settings.polygon,
    pwPhasing: settings.phasing,
    pwTrails: settings.trails,
    pwSoundOn: settings.soundOn,
    pwPitchDirection: settings.pitchDirection,
    pwWaveChord: settings.waveChord,
    pwCycles: settings.cycles,
  };
}

/* ------------------------------------------------------------------ tuning */

/**
 * Oscillation frequency (Hz) of pendulum `index`. Classic tuning: pendulum i completes K + i oscillations
 * per cycle of T seconds, fᵢ = (K + i) / T – the frequencies are spaced 1 / T apart, so every bob is back
 * in phase with every other after exactly T. Phasing: the swing *times* form an arithmetic series from
 * T / K (bob 0) down to T / (K + n − 1) (the last bob) – the same range of tempi, but each bob's swing lasts
 * a fixed bit longer than the next one's, so neighbours drift apart by a constant time lag per swing and
 * the row never snaps back as a whole.
 */
export function pendulumFrequency(index: number, settings: Pick<PendulumSettings, "count" | "baseOscillations" | "cycleSeconds" | "phasing">): number {
  const K = settings.baseOscillations;
  const T = settings.cycleSeconds;
  const n = settings.count;
  if (!settings.phasing) return (K + index) / T;
  const first = T / K;
  const last = T / (K + n - 1);
  const period = n > 1 ? first + (index * (last - first)) / (n - 1) : first;
  return 1 / period;
}

export function pendulumFrequencies(settings: Pick<PendulumSettings, "count" | "baseOscillations" | "cycleSeconds" | "phasing">): number[] {
  const out: number[] = [];
  for (let i = 0; i < settings.count; i++) out.push(pendulumFrequency(i, settings));
  return out;
}

/** String length (or bounce height) of every pendulum relative to the slowest one: L ∝ 1 / f² (g = 4π² L f²). */
export function relativeLengths(frequencies: readonly number[]): number[] {
  const f0 = frequencies[0] || 1;
  return frequencies.map((f) => (f0 / f) * (f0 / f));
}

/** The small-angle swing angle (radians) at time `t` for a pendulum of frequency `f`: A · cos(2π f t), `sign` picks the starting side. */
export function pendulumAngle(t: number, f: number, amplitudeRad: number, sign = 1): number {
  return sign * amplitudeRad * Math.cos(TWO_PI * f * t);
}

/** Height of a ball above the floor at fraction `u` (0–1) of its bounce: the rectified free-fall arc 4 H u (1 − u), zero at both floor hits and H at the apex. */
export function bounceHeight(u: number, height: number): number {
  return 4 * height * u * (1 - u);
}

/**
 * Distance from the centre to the outline of a regular polygon with `sides` sides and circumradius
 * `circumradius`, rotated by `rotation`, along the direction `angle`: the bobs of the radial layouts are
 * mapped onto this outline so an in-phase row draws a polygon and the polygon turns as `rotation` grows.
 */
export function polygonRadius(angle: number, circumradius: number, rotation: number, sides: number): number {
  if (sides < 3) return circumradius;
  const sector = TWO_PI / sides;
  let a = (angle - rotation) % sector;
  if (a < 0) a += sector;
  return (circumradius * Math.cos(Math.PI / sides)) / Math.cos(a - Math.PI / sides);
}

/* ------------------------------------------------------------------ sound */

/** Events closer together than this (seconds) are one chord with `waveChord` on. */
export const CHORD_WINDOW_SEC = 0.02;
/** Most sound events one 60 Hz step may queue (a chord counts as one); the rest still flash. */
export const MAX_PENDULUM_SOUNDS_PER_STEP = 24;
/** Most distinct notes in one chord event. */
export const MAX_CHORD_NOTES = 16;
/** A chord of at least this fraction of the bobs is accented (louder, longer, a flash): the in-phase moment. */
export const ACCENT_CHORD_FRACTION = 0.5;

/**
 * Fractional phases (in oscillations, 0 ≤ φ < 1) at which a bob produces a sound event: the centre crossings
 * of a swing are at ¼ and ¾ of the oscillation (cos = 0), the extremes at 0 and ½ (cos = ±1); a bouncing
 * ball hits the floor at 0 and reaches its apex at ½.
 */
export function eventPhases(layout: PendulumLayout, soundOn: PendulumSoundOn): number[] {
  const bouncing = layout === "bouncing";
  const center = bouncing ? [0] : [0.25, 0.75];
  const extremes = bouncing ? [0.5] : [0, 0.5];
  if (soundOn === "center") return center;
  if (soundOn === "extremes") return extremes;
  return [...center, ...extremes].sort((a, b) => a - b);
}

/**
 * Appends to `out` every time t in [from, to) at which f · t (in oscillations) is one of `phases` modulo 1,
 * i.e. t = (k + φ) / f for a whole number k. Solved analytically, so an event is never missed or doubled
 * whatever the step size, and its exact time can be compared with other bobs' events for the chords.
 */
export function crossingTimes(f: number, from: number, to: number, phases: readonly number[], out: number[]): number[] {
  if (!(f > 0) || !(to > from)) return out;
  for (const phase of phases) {
    // Start one k early and let the strict comparisons decide: with the same `to` / `from` value on both sides
    // of a step boundary every event lands in exactly one step, however the rounding of from · f falls.
    let k = Math.ceil(from * f - phase) - 1;
    let t = (k + phase) / f;
    while (t < to) {
      if (t >= from) out.push(t);
      k++;
      t = (k + phase) / f;
    }
  }
  return out;
}

export interface PendulumNote {
  /** Simulation time of the event (seconds). */
  time: number;
  /** Index of the pendulum. */
  index: number;
}

/**
 * Groups notes (sorted by time) into chords: a note joins the chord opened by the earliest note that is
 * still within `window` seconds of it; otherwise it opens a new chord. Notes that are more than `window`
 * apart end up alone, which is how a single bob's note is played.
 */
export function groupChords(notes: readonly PendulumNote[], window = CHORD_WINDOW_SEC): PendulumNote[][] {
  const groups: PendulumNote[][] = [];
  let current: PendulumNote[] | null = null;
  for (const note of notes) {
    if (current && note.time - current[0].time <= window + 1e-9) current.push(note);
    else {
      current = [note];
      groups.push(current);
    }
  }
  return groups;
}

/** MIDI note the lowest pendulum plays (C4); the pitches climb a major scale from here. */
export const PENDULUM_BASE_MIDI = 60;
/** Semitones of the major-scale degrees within an octave. */
const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];
/** Most scale degrees the pitches span (C4 … C7, three octaves); more bobs than that share degrees. */
export const PENDULUM_MAX_DEGREES = 22;

/**
 * Pitch (Hz) of pendulum `index` of `count`: its rank (from the slow end with "up", from the fast end with
 * "down") as a degree of the C major scale from C4, spread over at most three octaves. The tone generator
 * snaps it to the chosen scale and root like every other hit, so "major from C" is only the default colour.
 */
export function pendulumPitch(index: number, count: number, direction: PendulumPitchDirection): number {
  const degrees = Math.min(Math.max(1, count), PENDULUM_MAX_DEGREES);
  const rank = direction === "up" ? index : count - 1 - index;
  const degree = count <= degrees || count <= 1 ? rank : Math.round((rank * (degrees - 1)) / (count - 1));
  const midi = PENDULUM_BASE_MIDI + 12 * Math.floor(degree / 7) + MAJOR_DEGREES[degree % 7];
  return midiToFrequency(midi);
}

/* ------------------------------------------------------------------ geometry */

export interface PendulumField {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Side of the square the rig is laid out in. */
  side: number;
  cx: number;
  cy: number;
}

/** The centred square the recorder crops to, less a small margin: every layout fits inside it, so a vertical export shows the whole rig. */
export function buildPendulumField(width: number, height: number): PendulumField {
  const margin = Math.max(6, 0.02 * Math.min(width, height));
  const side = Math.max(40, Math.min(width, height) - 2 * margin);
  const cx = width / 2;
  const cy = height / 2;
  return { left: cx - side / 2, top: cy - side / 2, right: cx + side / 2, bottom: cy + side / 2, side, cx, cy };
}

/** The bob radius the configured ball size gives on a rig of side `side` (the default 8 px ball is a fortieth of the field). */
export function pendulumBobUnit(side: number): number {
  return side / 320;
}

/** Everything the layout decides once: the bob radius, and per bob its anchor, its string length (or travel) and its rest direction. */
export interface PendulumRig {
  layout: PendulumLayout;
  bobRadius: number;
  /** Swing amplitude in radians. */
  amplitude: number;
  /** Per bob: the pivot on the bar (row) or ring (arc), the centre (radial layouts), the rail's centre (sliding) or the foot of the column on the floor (bouncing). */
  anchorX: number[];
  anchorY: number[];
  /** Per bob: string length (row, arc), radial travel (circle, galaxy), horizontal travel (sliding) or bounce height (bouncing), in px. */
  length: number[];
  /** Per bob: the direction (radians) the string hangs along at rest (arc) or the radius the bob moves on (circle, galaxy). */
  direction: number[];
  /** Row: y of the pivot bar. */
  barY: number;
  /** Arc: radius of the pivot ring. */
  ringRadius: number;
  /** Radial layouts: rest radius and radial travel of the bobs (the guide circle spans rho0 ± rhoAmp). */
  rho0: number;
  rhoAmp: number;
  /** Bouncing: y of the floor. */
  floorY: number;
  /** Sliding: horizontal travel of the bobs. */
  swingX: number;
}

/**
 * Lays the rig out for a field, a resolved settings object, the configured ball radius and the frequency series.
 * Every layout keeps every bob inside the field at any phase: the row shortens its strings as the amplitude
 * grows (the outermost bob at full swing still fits), the radial layouts cap their travel at the field's rim
 * and above the centre, and the sliders and bouncers stop short of the edges.
 */
export function buildPendulumRig(field: PendulumField, settings: PendulumSettings, ballRadius: number, frequencies: readonly number[]): PendulumRig {
  const n = frequencies.length;
  const S = field.side;
  const A = (settings.amplitude * Math.PI) / 180;
  const sinA = Math.sin(A);
  const lengths = relativeLengths(frequencies);
  const unit = pendulumBobUnit(S) * (ballRadius || 8);
  const anchorX: number[] = new Array(n).fill(0);
  const anchorY: number[] = new Array(n).fill(0);
  const length: number[] = new Array(n).fill(0);
  const direction: number[] = new Array(n).fill(0);
  const rig: PendulumRig = { layout: settings.layout, bobRadius: unit, amplitude: A, anchorX, anchorY, length, direction, barY: 0, ringRadius: 0, rho0: 0, rhoAmp: 0, floorY: 0, swingX: 0 };
  const spread = Math.max(1, n - 1);
  switch (settings.layout) {
    case "row": {
      // Pivots on a bar across the middle 40 % of the field; the longest string fits both the height and the swing of the outermost bob.
      const dx = (0.4 * S) / spread;
      const r = Math.min(unit, Math.max(2.5, 0.8 * dx));
      rig.bobRadius = r;
      rig.barY = field.top + 0.05 * S;
      const maxLength = Math.max(0.05 * S, Math.min(0.9 * S - r, (0.3 * S - r) / Math.max(sinA, 1e-3)));
      for (let i = 0; i < n; i++) {
        anchorX[i] = field.cx + (i - (n - 1) / 2) * dx;
        anchorY[i] = rig.barY;
        length[i] = maxLength * lengths[i];
      }
      break;
    }
    case "arc": {
      const spacing = (TWO_PI * 0.45 * S) / n;
      const r = Math.min(unit, Math.max(2.5, 0.35 * spacing));
      rig.bobRadius = r;
      rig.ringRadius = 0.47 * S - r;
      const maxLength = 0.92 * rig.ringRadius;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (TWO_PI * i) / n;
        anchorX[i] = field.cx + rig.ringRadius * Math.cos(a);
        anchorY[i] = field.cy + rig.ringRadius * Math.sin(a);
        direction[i] = a + Math.PI;
        length[i] = maxLength * lengths[i];
      }
      break;
    }
    case "circle":
    case "galaxy": {
      rig.rho0 = 0.25 * S;
      const spacing = (TWO_PI * rig.rho0) / n;
      const r = Math.min(unit, Math.max(2.5, 0.35 * spacing));
      rig.bobRadius = r;
      const cap = Math.max(0.02 * S, Math.min(rig.rho0 - r - 0.01 * S, 0.48 * S - rig.rho0 - r));
      rig.rhoAmp = cap * Math.min(1, sinA / 0.5);
      for (let i = 0; i < n; i++) {
        anchorX[i] = field.cx;
        anchorY[i] = field.cy;
        direction[i] = -Math.PI / 2 + (TWO_PI * i) / n;
        length[i] = rig.rhoAmp;
      }
      break;
    }
    case "sliding": {
      const spacing = S / n;
      const r = Math.min(unit, Math.max(2, 0.42 * spacing));
      rig.bobRadius = r;
      rig.swingX = Math.max(0.02 * S, Math.min(0.49 * S - r, 0.62 * S * sinA));
      for (let i = 0; i < n; i++) {
        anchorX[i] = field.cx;
        anchorY[i] = field.top + (i + 0.5) * spacing;
        length[i] = rig.swingX;
      }
      break;
    }
    case "bouncing": {
      const r = Math.min(unit, Math.max(2, (0.45 * S) / n));
      rig.bobRadius = r;
      rig.floorY = field.bottom - 0.02 * S;
      const dx = (S - 2 * r) / spread;
      const maxHeight = Math.max(0.05 * S, rig.floorY - field.top - 2 * r - 0.02 * S);
      for (let i = 0; i < n; i++) {
        anchorX[i] = n > 1 ? field.left + r + i * dx : field.cx;
        anchorY[i] = rig.floorY;
        length[i] = maxHeight * lengths[i];
      }
      break;
    }
  }
  return rig;
}

export interface BobPlacement {
  x: number;
  y: number;
  /** Swing angle (row, arc), the radius' direction (radial layouts) or 0. */
  angle: number;
}

/**
 * Where bob `i` is for a swing fraction `c` = cos(2π f t) · sign (−1 … 1), the bounce fraction `u` = f t mod 1,
 * the frame rotation (galaxy) and the polygon rotation (radial layouts with `polygon` ≥ 3). Written into `out`
 * (no allocation in the hot loop).
 */
export function placeBob(rig: PendulumRig, i: number, c: number, u: number, frameAngle: number, polygonAngle: number, polygon: number, out: BobPlacement): BobPlacement {
  const L = rig.length[i];
  switch (rig.layout) {
    case "row": {
      const theta = rig.amplitude * c;
      out.x = rig.anchorX[i] + L * Math.sin(theta);
      out.y = rig.anchorY[i] + L * Math.cos(theta);
      out.angle = theta;
      return out;
    }
    case "arc": {
      const theta = rig.amplitude * c;
      const dir = rig.direction[i] + theta;
      out.x = rig.anchorX[i] + L * Math.cos(dir);
      out.y = rig.anchorY[i] + L * Math.sin(dir);
      out.angle = theta;
      return out;
    }
    case "circle":
    case "galaxy": {
      const a = rig.direction[i] + frameAngle;
      let rho = rig.rho0 + L * c;
      if (polygon >= 3) rho = polygonRadius(a, rho, polygonAngle, polygon);
      out.x = rig.anchorX[i] + rho * Math.cos(a);
      out.y = rig.anchorY[i] + rho * Math.sin(a);
      out.angle = a;
      return out;
    }
    case "sliding":
      out.x = rig.anchorX[i] + L * c;
      out.y = rig.anchorY[i];
      out.angle = 0;
      return out;
    case "bouncing":
      out.x = rig.anchorX[i];
      out.y = rig.anchorY[i] - rig.bobRadius - bounceHeight(u, L);
      out.angle = 0;
      return out;
  }
}

/** Rotation (radians) of the polygon outline – and of the galaxy's frame – at simulation time `t`: one turn per cycle, in the seeded direction. */
export function pendulumTurn(t: number, cycleSeconds: number, rotationDir: number): number {
  return (rotationDir * TWO_PI * t) / cycleSeconds;
}

/** What `placeBobAt()` needs besides the rig: the applied settings and the seeded start side / rotation direction (a `PendulumView` has them). */
export type PendulumTiming = { settings: Pick<PendulumSettings, "layout" | "polygon" | "cycleSeconds">; startSign: number; rotationDir: number };

/**
 * Where bob `i` (frequency `f`) is at simulation time `t` (seconds): the analytic swing, bounce and rotations fed to
 * `placeBob()`. The mode writes it into the balls at every sub-step and the canvas samples the trails from it, so a
 * trail is exactly the path the bob took. Written into `out` (no allocation).
 */
export function placeBobAt(rig: PendulumRig, timing: PendulumTiming, i: number, f: number, t: number, out: BobPlacement): BobPlacement {
  const s = timing.settings;
  const phase = f * t;
  const c = timing.startSign * Math.cos(TWO_PI * phase);
  const u = phase - Math.floor(phase);
  const turn = pendulumTurn(t, s.cycleSeconds, timing.rotationDir);
  return placeBob(rig, i, c, u, s.layout === "galaxy" ? turn : 0, turn, s.polygon, out);
}

/* ------------------------------------------------------------------ the mode */

/** Per-pendulum state the renderer reads (index order; also looked up by ball id). */
export interface PendulumBobState {
  id: number;
  index: number;
  /** Rainbow hue by index (degrees). */
  hue: number;
  frequency: number;
  /** Pitch of the bob's note (Hz, before the scale snap). */
  pitch: number;
  /** Current swing angle / direction (see `BobPlacement.angle`). */
  angle: number;
  /** Sub-step tick of the bob's last note (−Infinity before the first). */
  lastNoteTick: number;
}

/** What the canvas needs: the field and rig, the bobs, the clock, the rotations and the counters. */
export interface PendulumView {
  field: PendulumField | null;
  rig: PendulumRig | null;
  /** The settings of the running rig (applied by `init()`; only the visual `trails` follows a change live). */
  settings: PendulumSettings;
  bobs: PendulumBobState[];
  byId: Map<number, PendulumBobState>;
  /** Simulation time of the last completed step (seconds); it stops at the end of the last cycle, where the row holds its final alignment. */
  timeSec: number;
  /** Sub-steps simulated so far in this run and the length of one (ms; 0 until the first step). */
  tick: number;
  tickMs: number;
  /** Rotation of the frame (galaxy) and of the polygon outline (radians). */
  frameAngle: number;
  polygonAngle: number;
  /** ±1: the side the bobs start on, and the direction the frame / polygon turns. */
  startSign: number;
  rotationDir: number;
  /** Full cycles completed. */
  cyclesDone: number;
  finished: boolean;
  /** Notes played (every bob of a chord counts) and chords played. */
  noteCount: number;
  chordCount: number;
  /** Tick and size of the last chord (for the flash), −Infinity / 0 before the first. */
  lastChordTick: number;
  lastChordSize: number;
  /** Incremented by every init (a new run). */
  generation: number;
}

const PLACEMENT: BobPlacement = { x: 0, y: 0, angle: 0 };

export class PendulumMode implements GameMode {
  readonly name = "pendulum";
  /** The bobs are placed analytically: no slow-ball boost and no pair collisions may touch them. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: PendulumSettings = { ...DEFAULT_PENDULUM_SETTINGS };
  private readonly bobs: PendulumBobState[] = [];
  private readonly byId = new Map<number, PendulumBobState>();
  private readonly view: PendulumView = {
    field: null,
    rig: null,
    settings: { ...DEFAULT_PENDULUM_SETTINGS },
    bobs: this.bobs,
    byId: this.byId,
    timeSec: 0,
    tick: 0,
    tickMs: 0,
    frameAngle: 0,
    polygonAngle: 0,
    startSign: 1,
    rotationDir: 1,
    cyclesDone: 0,
    finished: false,
    noteCount: 0,
    chordCount: 0,
    lastChordTick: -Infinity,
    lastChordSize: 0,
    generation: 0,
  };
  private frequencies: number[] = [];
  private phases: number[] = [];
  /** 60 Hz steps completed; the step clock is `steps × stepSec`, so consecutive steps share their boundary bit for bit. */
  private steps = 0;
  private stepStartSec = 0;
  private sub = 0;
  private lastBallRadius = 0;
  /** Simulation time the run finishes at (cycles × cycle length), Infinity when it never does. */
  private endSec = Infinity;
  private soundsThisStep = 0;
  /** Notes waiting to be grouped into chords (sorted by time when flushed). */
  private pending: PendulumNote[] = [];
  private readonly times: number[] = [];

  getSettings(): PendulumSettings {
    return this.settings;
  }
  /**
   * Applied on the next init (the Simulator re-inits the mode when a Pendulum Wave setting changes), except the
   * trails: they only change how the canvas draws the run, so they follow at once without restarting it.
   */
  setSettings(patch: Partial<PendulumSettings>) {
    this.settings = resolvePendulumSettings({ ...this.settings, ...patch });
    this.view.settings.trails = this.settings.trails;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): PendulumView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { cycles: v.cyclesDone, total: v.settings.cycles, notes: v.noteCount, chords: v.chordCount, count: v.settings.count, finished: v.finished };
  }
  /** Seconds until the row is next in line (the end of the current cycle; 0 once a finished row holds its alignment); Infinity with phasing on, which never realigns. */
  secondsToAlignment(): number {
    const s = this.view.settings;
    if (s.phasing) return Infinity;
    if (this.view.finished) return 0;
    const T = s.cycleSeconds;
    const t = this.view.timeSec;
    return Math.max(0, (Math.floor(t / T + 1e-9) + 1) * T - t);
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    this.bobs.length = 0;
    this.byId.clear();
    this.pending.length = 0;
    v.timeSec = 0;
    v.tick = 0;
    v.tickMs = 0;
    v.frameAngle = 0;
    v.polygonAngle = 0;
    v.cyclesDone = 0;
    v.finished = false;
    v.noteCount = 0;
    v.chordCount = 0;
    v.lastChordTick = -Infinity;
    v.lastChordSize = 0;
    v.generation++;
    this.steps = 0;
    this.stepStartSec = 0;
    this.sub = 0;
    this.soundsThisStep = 0;
    this.endSec = s.cycles > 0 ? s.cycles * s.cycleSeconds : Infinity;
    // The only random decisions: the side every bob starts on and the direction the frame / polygon turns.
    v.startSign = ctx.random() < 0.5 ? -1 : 1;
    v.rotationDir = ctx.random() < 0.5 ? -1 : 1;
    this.frequencies = pendulumFrequencies(s);
    this.phases = eventPhases(s.layout, s.soundOn);
    this.lastBallRadius = ctx.config.ballRadius || 8;
    const rig = this.rebuildRig(ctx);
    for (let i = 0; i < s.count; i++) {
      const p = this.placeIndex(rig, i, 0);
      ctx.addBall({ x: p.x, y: p.y, vx: 0, vy: 0, radius: rig.bobRadius, color: bobColor((360 * i) / s.count), gravityScale: 0, radiusScale: rig.bobRadius / this.lastBallRadius });
      const id = ctx.getNextId() - 1;
      const st: PendulumBobState = { id, index: i, hue: (360 * i) / s.count, frequency: this.frequencies[i], pitch: pendulumPitch(i, s.count, s.pitchDirection), angle: p.angle, lastNoteTick: -Infinity };
      this.bobs.push(st);
      this.byId.set(id, st);
    }
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.stepStartSec = this.steps * (dtMs / 1000);
    this.sub = 0;
    this.soundsThisStep = 0;
    // A live change of the ball size re-sizes the bobs (and the strings that depend on the bob radius).
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.lastBallRadius) {
      this.lastBallRadius = radius;
      this.rebuildRig(ctx);
      this.applySizes(ctx);
    }
  }

  /**
   * The engine moved the bob by its velocity (zero, plus any wind or spin); put it where the analytic swing says it
   * is at this sub-step's time. The clock stops at the end of the last cycle, so a finished row holds its alignment.
   */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const rig = this.view.rig;
    const st = this.byId.get(ball.id);
    if (!rig || !st) return;
    this.view.tickMs = dtSec * 1000;
    const t = Math.min(this.stepStartSec + (this.sub + 1) * dtSec, this.endSec);
    const p = this.placeIndex(rig, st.index, t);
    ball.x = p.x;
    ball.y = p.y;
    ball.vx = 0;
    ball.vy = 0;
    st.angle = p.angle;
  }

  onPostSubStep() {
    this.sub++;
    this.view.tick++;
  }

  /**
   * Solves the events of the step, finishes the run at the end of the last cycle and queues the notes / chords.
   * Once finished nothing moves or sounds any more: the row holds the final alignment under the end screen.
   */
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    if (v.finished) return;
    const s = v.settings;
    const from = this.stepStartSec;
    this.steps++;
    const to = this.steps * (dtMs / 1000);
    const end = this.endSec;
    const finishing = to >= end - 1e-6;
    const now = Math.min(to, end);
    v.timeSec = now;
    const turn = pendulumTurn(now, s.cycleSeconds, v.rotationDir);
    v.polygonAngle = turn;
    v.frameAngle = s.layout === "galaxy" ? turn : 0;
    v.cyclesDone = Math.floor(now / s.cycleSeconds + 1e-6);
    // The events of every bob inside this step (up to the end of the run, so the final alignment is heard).
    const windowEnd = finishing ? Math.max(to, end + 1e-6) : to;
    const times = this.times;
    for (let i = 0; i < this.bobs.length; i++) {
      times.length = 0;
      crossingTimes(this.frequencies[i], from, windowEnd, this.phases, times);
      for (let k = 0; k < times.length; k++) this.pending.push({ time: times[k], index: i });
    }
    if (this.pending.length > 0) this.flushNotes(ctx, to, finishing);
    if (finishing) {
      v.finished = true;
      v.cyclesDone = s.cycles;
      if (v.field) ctx.spawnConfetti(v.field.cx, v.field.cy);
    }
  }

  /**
   * Queues the pending notes as sound events. With the wave chord on, notes within `CHORD_WINDOW_SEC` of each
   * other become one chord; a chord is only emitted once no later note can still join it (its window has
   * closed before the end of this step), so a chord that straddles two steps is still one chord. Without
   * it every note goes out on its own.
   */
  private flushNotes(ctx: ModeContext, now: number, all: boolean) {
    const s = this.view.settings;
    const pending = this.pending;
    pending.sort((a, b) => a.time - b.time || a.index - b.index);
    if (!s.waveChord) {
      for (const note of pending) this.emit(ctx, [note]);
      pending.length = 0;
      return;
    }
    const groups = groupChords(pending);
    let kept = 0;
    for (const group of groups) {
      if (all || group[0].time + CHORD_WINDOW_SEC < now) this.emit(ctx, group);
      else {
        for (const note of group) pending[kept++] = note;
      }
    }
    pending.length = kept;
  }

  /** One sound event for a note or a chord: the bookkeeping always happens, the event only within the per-step cap. */
  private emit(ctx: ModeContext, notes: readonly PendulumNote[]) {
    const v = this.view;
    const tick = v.tick;
    v.noteCount += notes.length;
    for (const note of notes) this.bobs[note.index].lastNoteTick = tick;
    // --- bounce-math --- a bob's note (it crosses the centre line or turns at an extreme) counts as its bounce
    if (ctx.noteBounce) {
      for (const ball of ctx.getBalls()) {
        const index = this.byId.get(ball.id)?.index;
        if (index === undefined) continue;
        for (const note of notes) if (note.index === index) ctx.noteBounce(ball);
      }
    }
    const chord = notes.length > 1;
    if (chord) {
      v.chordCount++;
      v.lastChordTick = tick;
      v.lastChordSize = notes.length;
    }
    if (this.soundsThisStep >= MAX_PENDULUM_SOUNDS_PER_STEP) return;
    this.soundsThisStep++;
    const first = this.bobs[notes[0].index];
    if (!chord) {
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: first.pitch });
      return;
    }
    const pitches: number[] = [];
    for (const note of notes) {
      const p = this.bobs[note.index].pitch;
      if (!pitches.includes(p)) pitches.push(p);
      if (pitches.length >= MAX_CHORD_NOTES) break;
    }
    pitches.sort((a, b) => a - b);
    const event: SoundEvent = { type: "hit", wallIndex: 0, frequency: pitches[0], chord: pitches };
    if (notes.length >= Math.max(3, ACCENT_CHORD_FRACTION * this.view.settings.count)) event.accent = true;
    ctx.addPendingSoundEvent(event);
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize re-lays the rig out and puts every bob back where the swing says. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.rebuildRig(ctx);
      this.applySizes(ctx);
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
    return { timeSec: v.timeSec, cyclesDone: v.cyclesDone, noteCount: v.noteCount, chordCount: v.chordCount, finished: v.finished, tick: v.tick };
  }

  private rebuildRig(ctx: ModeContext): PendulumRig {
    const field = buildPendulumField(ctx.config.width, ctx.config.height);
    const rig = buildPendulumRig(field, this.view.settings, ctx.config.ballRadius || 8, this.frequencies);
    this.view.field = field;
    this.view.rig = rig;
    return rig;
  }

  /** Writes the rig's bob radius into every ball (`radiusScale` keeps it right across `setConfig({ ballRadius })`) and re-places the bobs at the current time. */
  private applySizes(ctx: ModeContext) {
    const rig = this.view.rig;
    if (!rig) return;
    const base = ctx.config.ballRadius || 8;
    for (const ball of ctx.getBalls()) {
      const st = this.byId.get(ball.id);
      if (!st) continue;
      ball.radius = rig.bobRadius;
      ball.radiusScale = rig.bobRadius / base;
      const p = this.placeIndex(rig, st.index, this.view.timeSec);
      ball.x = p.x;
      ball.y = p.y;
      st.angle = p.angle;
    }
  }

  /** The analytic position of bob `i` at time `t` (seconds), in the shared scratch placement. */
  private placeIndex(rig: PendulumRig, i: number, t: number): BobPlacement {
    return placeBobAt(rig, this.view, i, this.frequencies[i], t, PLACEMENT);
  }
}

/** Colour of a bob for a hue (rainbow by index). */
export function bobColor(hue: number): string {
  return `hsl(${Math.round(hue)}, 90%, 62%)`;
}
