import type { Ball, GameMode, LoopSeams, ModeContext, SoundEvent } from "../types";
import { midiToFrequency } from "@/lib/audio/scales";
import { atLeastMin, memoryCeiling } from "@/lib/uncap"; // --- uncap-all ---

/**
 * --- sand-plate --- Sand Plate ("sandPlate" mode, rhythm family: "every note draws a new shape"). A square metal plate seen
 * from above, sprinkled with loose sand. A note sounds and the plate rings in that note's standing wave: a Chladni figure of
 * a square plate, w(x, y) = cos(nπx)·cos(mπy) + s·cos(mπx)·cos(nπy) on the plate's unit square. Every 60 Hz step each grain
 * hops in a seeded direction, as far as the plate moves under it (|w|), so the sand leaves the shaking parts and comes to
 * rest on the still lines (w = 0): within about a second it has drawn the note's figure. Every `noteSec` the next, higher
 * note of the scale rings a finer figure: the sand leaps off the old lines and flows into the new ones. The last note is the
 * highest and its figure the finest, a centred mandala with no corner-to-corner line (`SAND_PLATE_FINALE`); `FINALE_DELAY_SEC`
 * after it the full chord lands, the plate flashes and every line floods with colour (the canvas paints the grains by where
 * they lie, every note's hue at once), and the run ends
 * `FINALE_HOLD_SEC` after the last note's own time (`cycleSec()`): the length is set by the settings, never by the seed
 * (the finder's `fixedRunDurationSec`). With Loop on, the sand is shaken back to its first scatter over the last
 * `SHAKE_SEC` and the run starts again at the seam, identical (the loop contract: `cycleSeconds()`, `loopSeams()`).
 *
 * The figures climb a ladder of intricacy (`SAND_PLATE_LADDER`, levels of similar fineness): the run starts `START_LEVEL`
 * rungs up, because the simplest figures (a cross, four arcs) are plain and settle slowly, and the hop is scaled to the
 * figure's spacing (`hopOf()`: a fine figure's lines lie close, so its grains hop less). A small floor hop keeps every grain
 * shimmering, so a settled line is a few pixels wide, not a hairline, and the picture never stands still; it follows the
 * square of how hard the plate rings (up to full), so after the chord, when the plate rings down to `FINALE_DRIVE`, the last
 * figure draws its lines thinner still and holds them to the end. No corner-to-corner line survives a note change
 * (`arrangeFigures()`: a figure whose lines take the diagonal the last one took is mirrored onto the other), so every note
 * moves the brightest stroke too.
 *
 * The grains are the mode's own state (as Bouncing Orbs and Wave Tank own theirs): two Float32Arrays of positions in plate
 * units, a byte of heat a grain for the canvas, and the first scatter kept for the loop. The engine holds one placeholder
 * ball pinned to the plate's middle (not drawn): what the camera and bounce math hold on to. Work: one pass over the grains a
 * step, two cosine products each (3,000 grains about 0.4 ms in Node); the grain count has a memory ceiling
 * (MEMORY_CEILINGS.spGrains) and so has the note count (spNotes: the figures and the dots).
 *
 * Randomness: `ctx.random()` only, all in `init()`, in this order: the grains' generator seed (one draw), the key (one draw),
 * then per note its candidate figure, its sign and its mirror (three draws, the last note's too, though its figure is the
 * rung's mandala); `arrangeFigures()` then turns the draws into the figures, with no draw of its own. The grains' first
 * scatter and every hop's direction come from that generator, seeded once (mulberry32), so a seed replays byte for byte and the engine's other draws
 * never shift it; a loop's seam reseeds it with the same seed.
 *
 * Sound (every pitched event `loopExact`: the scale is the mode's own, never snapped; all under 800 Hz): a note opens with a
 * struck bar at its pitch, and the plate's hum (the section root, an octave down) glides to it. While the sand flows, soft
 * plucks of the note's triad follow every `ARP_SEC`, as loud as the share of grains still moving, and a hiss of moving sand
 * fades as they settle (quiet means the figure is done). The finale plays the completion chord on the key's root with an
 * impact and a chime, then the hiss and the hum stop. About 3.5 events a second at the defaults; a short rest between a
 * settled figure and the next note. Every note's strike is bounce math's "bounce" trigger, on the placeholder ball.
 */

/* ------------------------------------------------------------------ settings */

export interface SandPlateSettings {
  /** Notes in a run: one figure each, 3–12. */
  notes: number;
  /** Seconds a note rings, 1–5. */
  noteSec: number;
  /** Grains of sand on the plate, 500–10,000. */
  grains: number;
  /** How hard the plate shakes: × the tuned hop, 0.3–3. */
  shake: number;
  /** Shake the sand loose after the last figure and play the run again, for ever. */
  loop: boolean;
}

export const DEFAULT_SAND_PLATE_SETTINGS: SandPlateSettings = {
  notes: 8, // --- review fix (C3) --- (eight notes of 2 s: a new figure every 2 s, the run 17.8 s)
  noteSec: 2,
  grains: 3000,
  shake: 1,
  loop: false,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const SAND_PLATE_RANGES = {
  spNotes: { min: 3, max: 12, step: 1 },
  spNoteSec: { min: 1, max: 5, step: 0.1 },
  spGrains: { min: 500, max: 10000, step: 100 },
  spShake: { min: 0.3, max: 3, step: 0.1 },
} as const;

/** The Sand Plate fields of the SimulatorSettings object (URL keys spn, sps, spg, spk, spl). */
export interface SandPlateFields {
  spNotes: number;
  spNoteSec: number;
  spGrains: number;
  spShake: number;
  spLoop: boolean;
}

function clampNumber(value: unknown, range: { min: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Rounds onto a slider's step, two decimals at most. */
function onStep(value: number, step: number) {
  return Math.round(Math.round(value / step) * step * 100) / 100;
}

/** Fills in the defaults and puts every value on its slider's step (the counts whole, at most their memory ceilings); bad values fall back to the defaults. */
export function resolveSandPlateSettings(config: Partial<SandPlateSettings> | null | undefined): SandPlateSettings {
  const out = { ...DEFAULT_SAND_PLATE_SETTINGS };
  if (!config) return out;
  const R = SAND_PLATE_RANGES;
  if (config.notes !== undefined) out.notes = memoryCeiling("spNotes", Math.round(clampNumber(config.notes, R.spNotes, out.notes))); // --- uncap-all --- MEMORY_CEILINGS.spNotes
  if (config.noteSec !== undefined) out.noteSec = onStep(clampNumber(config.noteSec, R.spNoteSec, out.noteSec), R.spNoteSec.step);
  if (config.grains !== undefined) out.grains = memoryCeiling("spGrains", Math.round(clampNumber(config.grains, R.spGrains, out.grains))); // --- uncap-all --- MEMORY_CEILINGS.spGrains
  if (config.shake !== undefined) out.shake = onStep(clampNumber(config.shake, R.spShake, out.shake), R.spShake.step);
  if (typeof config.loop === "boolean") out.loop = config.loop;
  return out;
}

/** Picks the Sand Plate settings out of a bigger object for `engine.setSandPlateSettings()`. */
export function sandPlateSettingsOf(source: SandPlateFields): SandPlateSettings {
  return { notes: source.spNotes, noteSec: source.spNoteSec, grains: source.spGrains, shake: source.spShake, loop: source.spLoop };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function sandPlateSettingFields(settings: SandPlateSettings): SandPlateFields {
  return { spNotes: settings.notes, spNoteSec: settings.noteSec, spGrains: settings.grains, spShake: settings.shake, spLoop: settings.loop };
}

/** The defaults of the feature's fields. */
export function defaultSandPlateFields(): SandPlateFields {
  return sandPlateSettingFields(DEFAULT_SAND_PLATE_SETTINGS);
}

/** The core settings Sand Plate overrides when it is the page's mode: none (its placeholder ball is the page's own). */
export function sandPlateModeDefaults(mode: string): Record<never, never> {
  void mode;
  return {};
}

/** Validates the feature's fields (URL parameters and presets alike): numbers on their steps, a real boolean. */
export function resolveSandPlateFields(source: Partial<SandPlateFields>): SandPlateFields {
  return sandPlateSettingFields(resolveSandPlateSettings({ notes: source.spNotes, noteSec: source.spNoteSec, grains: source.spGrains, shake: source.spShake, loop: source.spLoop }));
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { spn: "spNotes", sps: "spNoteSec", spg: "spGrains", spk: "spShake" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: spn, sps, spg, spk and spl. */
export function writeSandPlateParams(settings: SandPlateFields, base: SandPlateFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.spLoop !== base.spLoop) params.set("spl", settings.spLoop ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readSandPlateParams(params: URLSearchParams, settings: SandPlateFields) {
  const next: Partial<SandPlateFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const loop = params.get("spl");
  if (loop === "1") next.spLoop = true;
  else if (loop === "0") next.spLoop = false;
  Object.assign(settings, resolveSandPlateFields(next));
}

/* ------------------------------------------------------------------ the figures, the run's clock and the scale */

/**
 * The ladder of figures (m, n): each rung a few figures of about the same fineness, the seed picking one; higher rungs have
 * more lines, closer together. A run of N notes plays rungs START_LEVEL … START_LEVEL + N − 1 (past the top the last rung
 * again, its figures alternating).
 */
export const SAND_PLATE_LADDER: readonly (readonly (readonly [number, number])[])[] = [
  [[1, 2]],
  [[1, 3]],
  [[2, 3]],
  [[1, 4], [2, 3]],
  [[3, 4], [2, 5]],
  [[3, 5], [1, 6]],
  [[4, 5], [2, 7]],
  [[5, 6], [3, 7]],
  [[4, 7], [3, 8]],
  [[5, 7], [5, 8]],
  [[6, 7], [4, 9]],
  [[7, 8], [6, 9]],
];
/**
 * --- review fix (C3) --- The last note's figure, by its rung: a mandala (m + n even, the sign +1), symmetric about both
 * diagonals and with no line along either, as fine as its rung or finer, so the finale reads as a centred picture unlike the
 * figures before it. (3, 5) is a circle on a cross, (5, 7) rings within rings, (7, 9) rounded squares within squares.
 */
export const SAND_PLATE_FINALE: readonly (readonly [number, number])[] = [[3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 7], [5, 7], [5, 7], [5, 7], [7, 9], [7, 9]];
/** The rung the first note rings: the simplest figures are plain and settle slowly. */
export const START_LEVEL = 3;
/** The hop at full amplitude (plate widths a 60 Hz step) of a figure whose larger index is 3, before the Shake setting. */
export const BASE_HOP = 0.09;
/** The floor hop every grain takes each step (plate widths): a settled line stays a few pixels wide and shimmers. */
export const FLOOR_HOP = 0.0009;
/** A grain moves less than this share of its figure's hop: it is resting on a line (the moving share, the canvas' heat). */
export const SETTLE_SHARE = 0.12;
/** The heat of a grain: resting, sliding, flying (the canvas colours by it). */
export const HEAT_WARM_SHARE = 0.3;
/** The onset kick: the plate rings this much harder at a note's start, decaying over KICK_SEC. */
export const KICK = 0.45;
export const KICK_SEC = 0.15;
/** After the last note: the chord lands FINALE_DELAY_SEC in, and the run ends FINALE_HOLD_SEC after the note's own time. */
export const FINALE_DELAY_SEC = 1.3;
export const FINALE_HOLD_SEC = 1.8;
/** The plate rings down over this long after the chord, to FINALE_DRIVE: the figure holds, crisp, still shimmering a little. */
export const FINALE_DAMP_SEC = 0.5;
/** --- review fix (C3) --- How hard the plate still rings after the chord: the floor hop follows its square, so the last lines grow thinner, never wider. */
export const FINALE_DRIVE = 0.3;
/** With Loop on: the sand is shaken back to its first scatter over the cycle's last SHAKE_SEC. */
export const SHAKE_SEC = 0.6;
/** The keys the seed picks from (MIDI roots: G3, A3, B♭3, C4, D4) and the major scale's steps. */
export const SAND_PLATE_KEYS = [55, 57, 58, 60, 62] as const;
const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
/** No pitch above this (Hz): a held or repeated tone above it is shrill on a phone. */
export const MAX_HZ = 800;
/** Plucks while the sand flows: every ARP_SEC, at most ARP_COUNT a note, only while this share of the grains moves. */
export const ARP_SEC = 0.45;
export const ARP_COUNT = 3;
export const ARP_MIN_MOVING = 0.12;
/** Below this moving share the hiss drops to its floor (the figure is done). */
export const QUIET_MOVING = 0.14;
/** Sound levels: the bar, the hum, a pluck (its floor and its range), the hiss, the chord, the impact, the chime. */
export const BAR_LEVEL = 0.75;
export const HUM_LEVEL = 0.55;
export const PLUCK_FLOOR = 0.22;
export const PLUCK_RANGE = 0.55;
export const HISS_LEVEL = 0.85;
export const HISS_FLOOR = 0.06;
/** Sounds one step emits at most (a note shorter than a step plays its onsets, not every pluck). */
export const SOUNDS_PER_STEP = 8;
const EPS = 1e-9;
const TWO_PI = Math.PI * 2;

/** One note's figure: the indices, the sign of the second term and whether it is mirrored left to right. */
export interface SandFigure {
  m: number;
  n: number;
  sign: 1 | -1;
  mirror: boolean;
}

/** The plate's displacement at (x, y) (plate units, 0 … 1) for a figure: −2 … 2. */
export function plateWave(f: SandFigure, x: number, y: number): number {
  const u = f.mirror ? 1 - x : x;
  return Math.cos(f.n * Math.PI * u) * Math.cos(f.m * Math.PI * y) + f.sign * Math.cos(f.m * Math.PI * u) * Math.cos(f.n * Math.PI * y);
}

/**
 * --- review fix (C3) --- The corner-to-corner lines of a figure as drawn: 1 the diagonal from the top left, 2 the one from the
 * top right, 3 both, 0 none. With m + n odd a figure has exactly one (the sign picks which, the mirror swaps it); with m + n
 * even, both (sign −1) or none (sign +1).
 */
export function figureDiagonals(f: SandFigure): number {
  const bits = (f.m + f.n) % 2 === 1 ? (f.sign < 0 ? 1 : 2) : f.sign < 0 ? 3 : 0;
  return f.mirror && (bits === 1 || bits === 2) ? 3 - bits : bits;
}

/**
 * --- review fix (C3) --- Turns a run's drawn figures into the ones it plays (in place, no draw of its own): the last note rings
 * its rung's mandala (`SAND_PLATE_FINALE`), and no corner-to-corner line survives a note change. A figure with one diagonal
 * that the note before had too is mirrored onto the other; a figure with m + n even keeps both diagonals only when neither
 * neighbour has one to share (else the sign +1 leaves it none).
 */
export function arrangeFigures(figures: SandFigure[]) {
  const N = figures.length;
  for (let k = 0; k < N; k++) {
    const f = figures[k];
    if (k === N - 1) {
      const [m, n] = SAND_PLATE_FINALE[rungOf(k)];
      f.m = m;
      f.n = n;
      f.sign = 1;
      f.mirror = false;
      continue;
    }
    const before = k > 0 ? figureDiagonals(figures[k - 1]) : 0;
    if ((f.m + f.n) % 2 === 0) {
      const next = figures[k + 1];
      const nextHasOne = k + 1 < N - 1 && (next.m + next.n) % 2 === 1;
      if (before !== 0 || nextHasOne) f.sign = 1;
    } else if (figureDiagonals(f) & before) f.mirror = !f.mirror;
  }
}

/** The hop at full amplitude for a figure (plate widths a step): BASE_HOP scaled to its spacing and by the Shake setting. */
export function hopOf(f: Pick<SandFigure, "m" | "n">, shake: number): number {
  return (BASE_HOP * shake * 4) / (Math.max(f.m, f.n) + 1);
}

/** The ladder rung of note `k` (0-based): START_LEVEL up, the top rung past the ladder's end. */
export function rungOf(k: number): number {
  return Math.min(SAND_PLATE_LADDER.length - 1, START_LEVEL + k);
}

/** A run's length (s): its notes, then the finale's hold. With Loop on it is the cycle. */
export function sandPlateCycleSec(s: Pick<SandPlateSettings, "notes" | "noteSec">): number {
  return s.notes * s.noteSec + FINALE_HOLD_SEC;
}

/** The second the full chord lands (the payoff), from the run's start. */
export function sandPlateChordSec(s: Pick<SandPlateSettings, "notes" | "noteSec">): number {
  return (s.notes - 1) * s.noteSec + Math.min(FINALE_DELAY_SEC, s.noteSec + FINALE_HOLD_SEC - 0.2);
}

/** The pitch (Hz) of note `k` from a key's root: up the major scale, an octave down while above MAX_HZ. */
export function sandNoteHz(rootMidi: number, k: number): number {
  const midi = rootMidi + 12 * Math.floor(k / 7) + MAJOR[k % 7];
  let hz = midiToFrequency(midi);
  while (hz > MAX_HZ) hz /= 2;
  return hz;
}

/** The pitch (Hz) of pluck `j` of note `k`'s triad (the root, the third, the fifth), an octave down while above MAX_HZ. */
export function sandPluckHz(rootMidi: number, k: number, j: number): number {
  const degree = k + 2 * (j % 3);
  const midi = rootMidi + 12 * Math.floor(degree / 7) + MAJOR[degree % 7];
  let hz = midiToFrequency(midi);
  while (hz > MAX_HZ) hz /= 2;
  return hz;
}

/** The seeded generator of the grains (mulberry32): the first scatter and every hop's direction. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Folds any coordinate back onto the plate (0 … 1), as a reflection off its edges however far the hop. */
export function foldUnit(v: number): number {
  if (v >= 0 && v <= 1) return v;
  let r = v % 2;
  if (r < 0) r += 2;
  return r > 1 ? 2 - r : r;
}

/* ------------------------------------------------------------------ the view */

/** Where the plate lies in the world: a square of side `side` with its top-left corner at (`left`, `top`). */
export interface SandPlateFrame {
  /** The page's centred square. */
  cx: number;
  cy: number;
  square: number;
  /** The plate. */
  left: number;
  top: number;
  side: number;
}

/** The plate's share of the square's side, and how far its middle sits above the square's (a share of the side): the dots go under it. */
export const PLATE_SHARE = 0.84;
export const PLATE_RAISE = 0.035;

/** What the canvas, the smoke test and the tests read of a run (the same object every call). */
export interface SandPlateView {
  /** Bumped by every init. */
  generation: number;
  settings: SandPlateSettings;
  frame: SandPlateFrame;
  /** The grains: positions in plate units and a heat each (0 resting, 1 sliding, 2 flying). */
  count: number;
  gx: Float32Array;
  gy: Float32Array;
  heat: Uint8Array;
  /** Every note's figure and pitch, in playing order, and the key's root (MIDI). */
  figures: SandFigure[];
  noteHz: number[];
  keyMidi: number;
  /** The simulation clock (s), the time within the cycle, the cycle's length, the note ringing (0-based) and when it began (cycle time). */
  timeSec: number;
  localSec: number;
  cycleSec: number;
  note: number;
  noteStartSec: number;
  /** How hard the plate rings now (FINALE_DRIVE … 1 + KICK). */
  drive: number;
  /** --- review fix (C3) --- The cycle time the plate was last struck (a note's bar or a pluck that sounded; −1 before): the canvas' glow flashes with it. */
  strikeSec: number;
  /** The share of grains still moving, and the most of a note so far (the canvas' flow). */
  moving: number;
  /** The chord: the cycle time it landed (−1 before), and how many chords landed in all. */
  chordSec: number;
  chords: number;
  /** With Loop on: shaking the sand back now. */
  shaking: boolean;
  /** Seams crossed (a new cycle each), and the largest gap between a grain at a seam and its first scatter (must be 0). */
  seams: number;
  seamError: number;
  /** The run is over (Loop off). */
  finished: boolean;
  /** Sound events emitted, and notes rung, in all. */
  sounds: number;
  onsets: number;
  /** Engine balls placed (always 1: the placeholder). */
  balls: number;
}

/* ------------------------------------------------------------------ the mode */

export class SandPlateMode implements GameMode {
  readonly name = "sandPlate";
  /** The placeholder ball is pinned: no slow-ball boost and no pair collisions may touch it. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: SandPlateSettings = resolveSandPlateSettings(null);
  private readonly view: SandPlateView;
  private anchorId = -1;
  /** The grains' generator, its seed (kept for the loop's seam) and the first scatter. */
  private rng: () => number = mulberry32(1);
  private grainSeed = 1;
  private x0 = new Float32Array(0);
  private y0 = new Float32Array(0);
  /** The note whose onset sounded last (−1 before the first), the plucks it played, its hiss state, the cycle. */
  private soundedNote = -1;
  private plucks = 0;
  private hissQuiet = false;
  private hissMid = false;
  private hissStopped = false;
  private humStopped = false;
  private cycle = 0;
  private stepSounds = 0;

  constructor() {
    const s = resolveSandPlateSettings(null);
    this.view = {
      generation: 0,
      settings: s,
      frame: { cx: 400, cy: 225, square: 450, left: 0, top: 0, side: 0 },
      count: 0,
      gx: new Float32Array(0),
      gy: new Float32Array(0),
      heat: new Uint8Array(0),
      figures: [],
      noteHz: [],
      keyMidi: SAND_PLATE_KEYS[0],
      timeSec: 0,
      localSec: 0,
      cycleSec: sandPlateCycleSec(s),
      note: 0,
      noteStartSec: 0,
      drive: 0,
      strikeSec: -1,
      moving: 1,
      chordSec: -1,
      chords: 0,
      shaking: false,
      seams: 0,
      seamError: 0,
      finished: false,
      sounds: 0,
      onsets: 0,
      balls: 0,
    };
  }

  getSettings(): SandPlateSettings {
    return this.settings;
  }
  /** Every setting applies on the next init. */
  setSettings(patch: Partial<SandPlateSettings>) {
    this.settings = resolveSandPlateSettings({ ...this.settings, ...patch });
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): SandPlateView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { note: v.note, notes: v.settings.notes, moving: v.moving, chordSec: v.chordSec, chords: v.chords, seams: v.seams, finished: v.finished };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    // the seeded choices, in their documented order: the grains' seed, the key, then per note its figure, sign and mirror
    this.grainSeed = Math.floor(ctx.random() * 4294967296) | 0;
    v.keyMidi = SAND_PLATE_KEYS[Math.min(SAND_PLATE_KEYS.length - 1, Math.floor(ctx.random() * SAND_PLATE_KEYS.length))];
    v.figures = [];
    v.noteHz = [];
    for (let k = 0; k < s.notes; k++) {
      const rung = SAND_PLATE_LADDER[rungOf(k)];
      const pick = rung[Math.min(rung.length - 1, Math.floor(ctx.random() * rung.length))];
      const sign: 1 | -1 = ctx.random() < 0.5 ? 1 : -1;
      const mirror = ctx.random() < 0.5;
      v.figures.push({ m: pick[0], n: pick[1], sign, mirror });
      v.noteHz.push(sandNoteHz(v.keyMidi, k));
    }
    arrangeFigures(v.figures); // --- review fix (C3) --- (the mandala at the end, a new diagonal at every note)
    v.generation++;
    v.settings = { ...s };
    v.timeSec = 0;
    v.localSec = 0;
    v.cycleSec = sandPlateCycleSec(s);
    v.note = 0;
    v.noteStartSec = 0;
    v.drive = 0;
    v.strikeSec = -1;
    v.moving = 1;
    v.chordSec = -1;
    v.chords = 0;
    v.shaking = false;
    v.seams = 0;
    v.seamError = 0;
    v.finished = false;
    v.sounds = 0;
    v.onsets = 0;
    this.soundedNote = -1;
    this.plucks = 0;
    this.hissQuiet = false;
    this.hissMid = false;
    this.hissStopped = false;
    this.humStopped = false;
    this.cycle = 0;
    this.stepSounds = 0;
    // the grains: a fresh scatter from their own generator (the arrays kept when the count is unchanged)
    const n = s.grains;
    if (v.gx.length !== n) {
      v.gx = new Float32Array(n);
      v.gy = new Float32Array(n);
      v.heat = new Uint8Array(n);
      this.x0 = new Float32Array(n);
      this.y0 = new Float32Array(n);
    }
    v.count = n;
    this.scatter();
    this.layOut(ctx);
    // the placeholder: one engine ball pinned to the plate's middle (the canvas draws the sand instead)
    this.anchorId = ctx.getNextId();
    ctx.addBall({ x: v.frame.cx, y: v.frame.cy, vx: 0, vy: 0, radius: ctx.config.ballRadius || 8, color: ctx.config.ballColor || "#ffffff", gravityScale: 0 });
    v.balls = 1;
  }

  /** The first scatter (and every seam's): the generator reseeded, the grains strewn evenly, kept for the loop. */
  private scatter() {
    const v = this.view;
    this.rng = mulberry32(this.grainSeed);
    for (let i = 0; i < v.count; i++) {
      const x = this.rng();
      const y = this.rng();
      v.gx[i] = x;
      v.gy[i] = y;
      this.x0[i] = x;
      this.y0[i] = y;
      v.heat[i] = 2;
    }
  }

  /** The plate: PLATE_SHARE of the page's centred square, raised a little to leave room for the note dots under it. */
  private layOut(ctx: ModeContext) {
    const f = this.view.frame;
    const w = ctx.config.width || 800;
    const h = ctx.config.height || 450;
    f.cx = w / 2;
    f.cy = h / 2;
    f.square = Math.min(w, h);
    f.side = PLATE_SHARE * f.square;
    f.left = f.cx - f.side / 2;
    f.top = f.cy - PLATE_RAISE * f.square - f.side / 2;
  }

  onPreUpdate() {}

  /** The placeholder stays where it is pinned. */
  onBallStep(_ctx: ModeContext, ball: Ball) {
    if (ball.id !== this.anchorId) return;
    this.pin(ball);
  }

  private pin(ball: Ball) {
    const f = this.view.frame;
    ball.x = f.left + f.side / 2;
    ball.y = f.top + f.side / 2;
    ball.vx = 0;
    ball.vy = 0;
  }

  onPostSubStep() {}

  /** One step of the plate: the clock, the seams, the sounds due, then every grain's hop. */
  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const s = v.settings;
    for (const ball of ctx.getBalls()) if (ball.id === this.anchorId) this.pin(ball);
    const t = ctx.getElapsedMs() / 1000;
    v.timeSec = t;
    if (v.finished) return;
    this.stepSounds = 0;
    const C = v.cycleSec;
    // the cycle (Loop on): every seam starts the run again from the first scatter, with the generator reseeded
    if (s.loop && C > 0) {
      const cycle = Math.floor((t + EPS) / C);
      if (cycle > this.cycle) {
        this.cycle = cycle;
        this.seam();
      }
    }
    const local = s.loop && C > 0 ? t - this.cycle * C : Math.min(t, C);
    v.localSec = local;
    const S = s.noteSec;
    const N = s.notes;
    const k = Math.max(0, Math.min(N - 1, Math.floor((local + EPS) / S)));
    v.note = k;
    v.noteStartSec = k * S;
    const tau = local - k * S;
    // the chord: the last note's figure is drawn, FINALE_DELAY_SEC in
    const chordAt = sandPlateChordSec(s);
    const chord = k === N - 1 && local + EPS >= chordAt;
    // how hard the plate rings: the onset's kick, then steady; after the chord it rings down to FINALE_DRIVE over FINALE_DAMP_SEC
    let drive = 1 + KICK * Math.exp(-tau / KICK_SEC);
    if (chord) drive = FINALE_DRIVE + (drive - FINALE_DRIVE) * Math.max(0, 1 - (local - chordAt) / FINALE_DAMP_SEC);
    v.drive = drive;
    // the loop's shake: the cycle's last SHAKE_SEC carries every grain back to its first scatter
    const shakeFrom = C - SHAKE_SEC;
    v.shaking = s.loop && local + EPS >= shakeFrom;
    if (v.shaking) this.shakeBack(C - local);
    else this.hop(v.figures[k], drive);
    this.sounds(ctx, k, tau, chord, chordAt, local);
    if (!s.loop && t + EPS >= C) {
      v.finished = true;
      this.stopHeld(ctx);
    }
  }

  /** Every grain hops once: as far as the plate moves under it, in its generator's next direction, folded back onto the plate. */
  private hop(f: SandFigure, drive: number) {
    const v = this.view;
    const K = hopOf(f, v.settings.shake);
    const settle = SETTLE_SHARE * K;
    const warm = HEAT_WARM_SHARE * K;
    const quiet = Math.min(1, drive);
    const floor = FLOOR_HOP * quiet * quiet;
    let moving = 0;
    const gx = v.gx;
    const gy = v.gy;
    const heat = v.heat;
    const rng = this.rng;
    for (let i = 0; i < v.count; i++) {
      const x = gx[i];
      const y = gy[i];
      const a = (0.5 * Math.abs(plateWave(f, x, y))) * drive;
      const d = K * a;
      if (d > settle) moving++;
      heat[i] = d > warm ? 2 : d > settle ? 1 : 0;
      const th = rng() * TWO_PI;
      // (--- review fix (C3) --- the floor hop follows the square of the plate's ring, up to full: a quieter plate draws thinner lines)
      const step = d + floor;
      gx[i] = foldUnit(x + step * Math.cos(th));
      gy[i] = foldUnit(y + step * Math.sin(th));
    }
    v.moving = v.count > 0 ? moving / v.count : 0;
  }

  /** The loop's shake: each grain a share of the way back to its first scatter (`left` s to the seam), all flying. */
  private shakeBack(left: number) {
    const v = this.view;
    const steps = Math.max(1, Math.round(left * 60));
    const share = 1 / steps;
    for (let i = 0; i < v.count; i++) {
      v.gx[i] += (this.x0[i] - v.gx[i]) * share;
      v.gy[i] += (this.y0[i] - v.gy[i]) * share;
      v.heat[i] = 2;
    }
    v.moving = 1;
  }

  /** A seam: the run starts again exactly as it began (the scatter, the generator, the sounds' state). */
  private seam() {
    const v = this.view;
    let err = 0;
    for (let i = 0; i < v.count; i++) err = Math.max(err, Math.abs(v.gx[i] - this.x0[i]), Math.abs(v.gy[i] - this.y0[i]));
    v.seamError = Math.max(v.seamError, err);
    this.scatter();
    v.seams++;
    v.chordSec = -1;
    v.strikeSec = -1;
    this.soundedNote = -1;
    this.plucks = 0;
    this.hissQuiet = false;
    this.hissMid = false;
    this.hissStopped = false;
    this.humStopped = false;
  }

  /** The sounds due this step: a note's onset, its plucks and the hiss, the chord, and the held voices' end. */
  private sounds(ctx: ModeContext, k: number, tau: number, chord: boolean, chordAt: number, local: number) {
    const v = this.view;
    const s = v.settings;
    // the onsets of every note begun since the last step (a note shorter than a step still rings its bar)
    while (this.soundedNote < k) {
      this.soundedNote++;
      this.plucks = 0;
      this.hissQuiet = false;
      this.hissMid = false;
      v.onsets++;
      v.strikeSec = local;
      const hz = v.noteHz[this.soundedNote];
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "bar", frequency: hz, level: BAR_LEVEL, loopExact: true, melody: false });
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "root", frequency: hz / 2, level: HUM_LEVEL, loopExact: true, melody: false });
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "hiss", level: HISS_LEVEL, melody: false });
      // the plate is struck: bounce math's "bounce" trigger (the placeholder ball stands for the plate)
      if (ctx.noteBounce) for (const ball of ctx.getBalls()) if (ball.id === this.anchorId) ctx.noteBounce(ball);
      this.humStopped = false;
      this.hissStopped = false;
    }
    if (v.chordSec < 0) {
      // the plucks while the sand flows, as loud as the share still moving; the hiss halfway and when it settles
      while (this.plucks < ARP_COUNT && tau + EPS >= (this.plucks + 1) * ARP_SEC && !chord) {
        const j = this.plucks++;
        if (v.moving < ARP_MIN_MOVING) continue;
        v.strikeSec = local;
        this.emit(ctx, { type: "hit", wallIndex: 0, loop: "pluck", frequency: sandPluckHz(v.keyMidi, k, j), level: PLUCK_FLOOR + PLUCK_RANGE * v.moving, loopExact: true, melody: false });
        if (j === 1 && !this.hissMid) {
          this.hissMid = true;
          this.emit(ctx, { type: "hit", wallIndex: 0, loop: "hiss", level: HISS_LEVEL * v.moving, melody: false });
        }
      }
      if (!this.hissQuiet && tau > ARP_SEC && v.moving < QUIET_MOVING) {
        this.hissQuiet = true;
        this.emit(ctx, { type: "hit", wallIndex: 0, loop: "hiss", level: HISS_FLOOR, melody: false });
      }
    }
    // the finale: the full chord on the key's root, an impact and a chime an octave up
    if (chord && v.chordSec < 0) {
      v.chordSec = chordAt;
      v.chords++;
      const root = midiToFrequency(v.keyMidi - 12);
      const chordHz = [0, 4, 7, 12].map((st) => root * Math.pow(2, st / 12));
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "chord", frequency: root, chord: chordHz, level: 1, loopExact: true, accent: true, melody: false });
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "impact", chord: [], level: 0.8, melody: false });
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "chime", frequency: v.noteHz[v.noteHz.length - 1], level: 0.7, loopExact: true, melody: false });
    }
    // the hiss stops once the chord has rung a moment; the hum near the run's end (or before the loop's shake)
    if (v.chordSec >= 0 && !this.hissStopped && local >= v.chordSec + FINALE_DAMP_SEC) {
      this.hissStopped = true;
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "hissStop", melody: false });
    }
    if (s.loop && v.shaking && !this.humStopped) {
      this.humStopped = true;
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "wash", loopSec: SHAKE_SEC, level: 0.5, melody: false });
    }
  }

  /** The held voices stop when the run ends. */
  private stopHeld(ctx: ModeContext) {
    if (!this.hissStopped) {
      this.hissStopped = true;
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "hissStop", melody: false });
    }
    if (!this.humStopped) {
      this.humStopped = true;
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "rootStop", level: 0, melody: false });
    }
  }

  private emit(ctx: ModeContext, event: SoundEvent) {
    if (this.stepSounds >= SOUNDS_PER_STEP) return;
    this.stepSounds++;
    ctx.addPendingSoundEvent(event);
    this.view.sounds++;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize fits the plate again (the grains are in plate units) and moves the placeholder with it. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.layOut(ctx);
      for (const ball of ctx.getBalls()) if (ball.id === this.anchorId) this.pin(ball);
    }
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  /** Loop off: the run ends after the last figure's hold. Loop on: never (the recording's length ends a clip). */
  isFinished() {
    return this.view.finished;
  }
  // --- the loop contract (lib/loop/loopContract.ts): every cycle starts again from the first scatter
  cycleSeconds(): number | null {
    const C = this.view.cycleSec;
    return this.view.settings.loop && C > 0 ? C : null;
  }
  loopSeams(ctx: ModeContext): LoopSeams | null {
    const C = this.view.cycleSec;
    if (!this.view.settings.loop || !(C > 0)) return null;
    const t = ctx.getElapsedMs() / 1000;
    const count = Math.floor((t + EPS) / C);
    return { count, lastMs: count > 0 ? 1000 * count * C : -1, nextMs: 1000 * (count + 1) * C };
  }
  getState() {
    const v = this.view;
    return { timeSec: v.timeSec, note: v.note, moving: v.moving, chordSec: v.chordSec, seams: v.seams, finished: v.finished };
  }
}
