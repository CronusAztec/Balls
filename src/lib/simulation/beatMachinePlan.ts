import { SCALE_INTERVALS, frequencyToMidi, midiToFrequency, type ScaleId } from "@/lib/audio/scales";

/*
 * --- beat-machine --- The Beat Machines' planner (pure, no DOM, no engine): kinetic music machines in which every note is a
 * ball landing on a tuned target exactly on the beat, with a mechanical return path, so the machine loops forever. The mode
 * (lib/physics/modes/beatMachine.ts) places its engine balls from this plan every sub-step and emits the plan's events; the
 * renderer (components/simulator/beatMachineRenderer.ts) draws the same plan at the frame's own time. It follows the pattern of
 * the Beat Drop planner (lib/simulation/beatDropPlan.ts): every impact is solved backwards from its note time, nothing is
 * integrated, so a seed replays bit for bit at any frame rate, in the fast export and in the finder.
 *
 * Two variants, both in machine units (about one panel; y grows downwards) – the mode fits the plan's box into the page:
 *
 * - **stairs** – n step bars descend diagonally, step k at (k·dx, k·dy). One ball hops from step to step in identical
 *   parabolic flights of T = 60 / BPM: the gravity and the take-off speed are solved from T, the drop dy and a chosen apex
 *   (`stairsGravity()`), so each landing is a beat. After the last step it drops into a hook, rolls round a U-shaped return
 *   track at a constant speed, climbs the left side and is tipped onto step 1 exactly `returnBeats` beats after the hook – the
 *   loop is (steps + returnBeats) beats. With fewer than two return beats it flies straight back to step 1 instead.
 * - **marbles** – N tuned bars in a row (rainbow left to right, low to high), a tube above each, a floor, a ladder lift up the
 *   right edge and a top rail. A marble leaves the bottom of tube i at t_note − √(2h/g) – h the drop from the tube to the bar –
 *   so it strikes bar i on the beat; it rebounds with a small sideways kick through the gap to the floor, rolls to the lift,
 *   waits for the next free rung, rides up, rolls back along the rail and drops into its own tube (tube = colour = pitch). The
 *   tubes are first in, first out; a tube holds as many marbles as its tune needs (`tubeNeeds()`): one that could not be back
 *   before it is needed again starts with a spare.
 *
 * Rolls (the floor, the rail, the return track) are arc-length paths at a constant speed; the lift is its own segment; the
 * flights and falls are parabolas. Every trajectory is continuous at its joins. The events (`BmEvent`) – notes (a strike or a
 * landing), releases, rung pick-ups, the hook's catch, the tip, the reset glide and the phrase bass – repeat every loop.
 *
 * The phrase (`buildPhrase()`): the loaded melody, a seeded original phrase (the only random draws; see
 * `originalMarblePhrase()` / `originalStairsDegrees()` for their order), a scale run or a typed list. Pitches come from the
 * Sound section's scale and root (its "free" chromatic scale plays the machine's major pentatonic).
 */

/* ------------------------------------------------------------------ options */

export const BM_VARIANTS = ["marbles", "stairs"] as const;
export type BmVariant = (typeof BM_VARIANTS)[number];
/** Where the notes come from: a seeded original phrase, a scale run, the loaded melody or a typed list. */
export const BM_SOURCES = ["original", "scale", "melody", "custom"] as const;
export type BmSource = (typeof BM_SOURCES)[number];

export function isBmVariant(value: unknown): value is BmVariant {
  return typeof value === "string" && (BM_VARIANTS as readonly string[]).includes(value);
}
export function isBmSource(value: unknown): value is BmSource {
  return typeof value === "string" && (BM_SOURCES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ constants (machine units: about one panel) */

/** Seconds two times may differ and still be one (floating-point steps). */
export const BM_TIME_EPS = 1e-9;
/** Stairs: a step bar's size (65 × 14 px at 720 wide) and the ball's radius. */
export const BM_STEP_W = 0.09;
export const BM_STEP_H = 0.0195;
export const BM_STAIRS_BALL_R = 0.0167;
/** Stairs: a hop's apex above its take-off, as a share of the step's drop (at least BM_APEX_MIN). */
export const BM_APEX_SHARE = 1.2;
export const BM_APEX_MIN = 0.04;
/** Stairs: the most gravity a hop solves to (units / s²) – reached only by a tempo far past its slider. */
export const BM_G_CEILING = 1e300;
/** Stairs: how far the return track's bowl runs under the hook, the bowl's corner radius and the tipping hook's radius. */
export const BM_TRACK_DROP = 0.09;
export const BM_BOWL_RADIUS = 0.06;
export const BM_TIP_RADIUS = 0.035;
/** Marbles: the bars' pitch (centre to centre), a bar's width (share of the pitch) and height, a marble's radius (share of the pitch). */
export const BM_BAR_PITCH = 0.075;
export const BM_BAR_W_SHARE = 0.6;
export const BM_BAR_H = 0.03;
export const BM_MARBLE_R_SHARE = 0.15;
/** Marbles: from the bars' top down to the floor (room for the rebound to pass between the bars). */
export const BM_FLOOR_GAP = 0.2;
/** Marbles: gravity (units / s²), the floor's, the lift's and the rail's rolling speeds (units / s). */
export const BM_MARBLE_G = 2.4;
export const BM_FLOOR_SPEED = 0.55;
export const BM_LIFT_SPEED = 0.42;
export const BM_RAIL_SPEED = 0.5;
/** Marbles: the lift stands this many bar pitches right of the last bar. */
export const BM_LIFT_OFFSET = 1.5;
/** Marbles: the lift's rungs at least this many marble radii apart (two marbles on two rungs never touch). */
export const BM_RUNG_GAP = 2.6;
/** Marbles: the weakest rebound a strike gives (a rebound of 0 still leaves the bar). */
export const BM_MIN_REBOUND = 0.05;
/** The phrase bass plays every this many beats (two bars of four). */
export const BM_BASS_BEATS = 8;
/**
 * Marbles: the most a tube holds – the Marbles per tube setting's memory-safety ceiling (`MEMORY_CEILINGS.bmPerTube`). A
 * phrase that needs more (a trip many loops long: a tempo, a drop or a rebound far past its slider) reuses its marbles.
 */
export const BM_TUBE_CEILING = 200;
/** Stairs: a ladder of pitches wraps after this many degrees (three octaves of the pentatonic), so it stays in register. */
export const BM_LADDER_WRAP = 15;
/** Beats in the original marble phrase's motif (two bars of four). */
export const BM_MOTIF_BEATS = 8;
/** The marble bars' rainbow (the clip's ten colours), left to right. */
export const BM_BAR_COLORS = ["#c0473f", "#c08a3f", "#a6b33f", "#5bb33f", "#3fb36a", "#3fc8d0", "#3f8ec8", "#3f55c8", "#6a3fc8", "#b33fc8"] as const;
/** The steps' ramp: mint to sky blue. */
export const BM_STEP_FROM = "#4be3a5";
export const BM_STEP_TO = "#4ab8e8";

/* ------------------------------------------------------------------ pitch */

/** The scale a machine plays: the Sound section's, its free (chromatic) one the major pentatonic. */
export function machineIntervals(scale: ScaleId | string | undefined): readonly number[] {
  if (!scale || scale === "chromatic" || !(scale in SCALE_INTERVALS)) return SCALE_INTERVALS.pentatonic;
  return SCALE_INTERVALS[scale as ScaleId];
}

/** The MIDI note of `degree` of `intervals` on `baseMidi` (negative degrees go down). */
export function degreeMidi(degree: number, baseMidi: number, intervals: readonly number[]): number {
  const n = Math.max(1, intervals.length);
  const d = Number.isFinite(degree) ? Math.round(degree) : 0;
  const octave = Math.floor(d / n);
  return baseMidi + 12 * octave + intervals[d - octave * n];
}

/** The machine's lowest root: the Sound section's root in the octave from G3 (55) up, so ten bars span about G3–F5. */
export function machineBaseMidi(root: number): number {
  const r = Number.isFinite(root) ? Math.round(root) : 0;
  return 55 + ((((r - 7) % 12) + 12) % 12);
}

/** The bars' pitches (Hz), low to high: degree i of the scale from the machine's root. */
export function barFrequencies(count: number, scale: ScaleId | string | undefined, root: number): number[] {
  const intervals = machineIntervals(scale);
  const base = machineBaseMidi(root);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(midiToFrequency(degreeMidi(i, base, intervals)));
  return out;
}

/** Stairs: the pitch (Hz) of ladder degree `degree` (a step's index), wrapping every BM_LADDER_WRAP degrees; a long staircase starts an octave lower. */
export function ladderFrequency(degree: number, steps: number, scale: ScaleId | string | undefined, root: number): number {
  const intervals = machineIntervals(scale);
  const base = machineBaseMidi(root) - (steps > 10 ? 12 : 0);
  const d = ((Math.round(degree) % BM_LADDER_WRAP) + BM_LADDER_WRAP) % BM_LADDER_WRAP;
  return midiToFrequency(degreeMidi(d, base, intervals));
}

/** The bar whose pitch is nearest `frequency` (the note folded by octaves into the bars' span first); 0 without bars. */
export function nearestBar(frequency: number, barHz: readonly number[]): number {
  if (barHz.length === 0 || !(frequency > 0)) return 0;
  const low = frequencyToMidi(barHz[0]);
  const high = frequencyToMidi(barHz[barHz.length - 1]);
  let m = frequencyToMidi(frequency);
  for (let i = 0; i < 16 && m < low - 0.5; i++) m += 12;
  for (let i = 0; i < 16 && m > high + 0.5; i++) m -= 12;
  let best = 0;
  let bestD = Infinity;
  for (let b = 0; b < barHz.length; b++) {
    const d = Math.abs(frequencyToMidi(barHz[b]) - m);
    if (d < bestD - 1e-9) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ the phrase */

/** One note of a phrase: the beat it sounds on (from the loop's start), the bar (marbles) or step (stairs) it is, its pitch (Hz). */
export interface BmNote {
  beat: number;
  slot: number;
  frequency: number;
}

/** A typed list's token: a slot number (1-based: a bar or a scale degree), a pitch (Hz) or a rest (null). */
export type BmToken = { slot: number } | { frequency: number } | null;

const NOTE_NAME = /^([A-Ga-g])([#b]?)(-?\d)$/;
const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** The pitch (Hz) of a note name ("C4", "F#3", "Bb5"), or null. */
export function noteNameFrequency(text: string): number | null {
  const m = NOTE_NAME.exec(text.trim());
  if (!m) return null;
  const pc = NOTE_PC[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  const octave = Number(m[3]);
  return midiToFrequency(12 * (octave + 1) + pc);
}

/** Parses a typed list ("1 3 5 - 8", "C4, E4, G4"): one token a beat; "-", "." or "_" a rest; anything unreadable is a rest too. */
export function parseNoteList(text: string | null | undefined): BmToken[] {
  if (typeof text !== "string") return [];
  const out: BmToken[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      out.push(n >= 1 ? { slot: n - 1 } : null);
      continue;
    }
    const f = noteNameFrequency(token);
    out.push(f !== null ? { frequency: f } : null);
  }
  return out;
}

/** Reflects `slot` into 0 … count − 1. */
function reflectSlot(slot: number, count: number): number {
  if (count <= 1) return 0;
  const period = 2 * (count - 1);
  const m = ((Math.round(slot) % period) + period) % period;
  return m < count ? m : period - m;
}

/** A tonic bar (a degree that is the root of the scale) nearest `slot`. */
function tonicNear(slot: number, count: number, scaleSize: number): number {
  const size = Math.max(1, scaleSize);
  let best = 0;
  for (let b = 0; b < count; b += size) if (Math.abs(b - slot) < Math.abs(best - slot)) best = b;
  return best;
}

/**
 * A seeded ORIGINAL marble phrase over `loopBeats` beats on `bars` bars (never a copied tune): two motifs of BM_MOTIF_BEATS
 * beats – each a rhythm (a quarter, two eighths or a rest a beat; the first beat always sounds) and a walk over the bars
 * (steps of −2 … +2, reflected at the ends) – laid out A, A transposed, B, A with its last note on a tonic bar. The draws, in
 * this order (fixed counts whatever they decide): motif A (1 start + 8 rhythm + 16 walk), motif B (the same 25), the
 * transposition (1).
 */
export function originalMarblePhrase(bars: number, loopBeats: number, random: () => number, scaleSize = 5): { beat: number; slot: number }[] {
  const n = Math.max(1, Math.floor(bars));
  const makeMotif = () => {
    const notes: { offset: number; slot: number }[] = [];
    let slot = Math.floor(random() * n);
    const rhythm: number[] = [];
    for (let b = 0; b < BM_MOTIF_BEATS; b++) rhythm.push(random());
    const walk: number[] = [];
    for (let j = 0; j < 2 * BM_MOTIF_BEATS; j++) walk.push(random());
    const STEPS = [-2, -1, -1, 0, 1, 1, 2];
    let w = 0;
    for (let b = 0; b < BM_MOTIF_BEATS; b++) {
      const u = b === 0 ? 0 : rhythm[b];
      const offsets = u < 0.55 ? [b] : u < 0.85 ? [b, b + 0.5] : [];
      for (const offset of offsets) {
        if (notes.length > 0) slot = reflectSlot(slot + STEPS[Math.min(STEPS.length - 1, Math.floor(walk[w] * STEPS.length))], n);
        w++;
        notes.push({ offset, slot });
      }
    }
    return notes;
  };
  const a = makeMotif();
  const b = makeMotif();
  const shiftDraw = random();
  const shift = [-2, -1, 1, 2][Math.min(3, Math.floor(shiftDraw * 4))];
  const blocks = Math.max(1, Math.ceil(loopBeats / BM_MOTIF_BEATS));
  const out: { beat: number; slot: number }[] = [];
  for (let k = 0; k < blocks; k++) {
    const form = k % 4;
    const motif = form === 2 ? b : a;
    for (let j = 0; j < motif.length; j++) {
      const beat = k * BM_MOTIF_BEATS + motif[j].offset;
      if (beat >= loopBeats - BM_TIME_EPS) continue;
      let slot = form === 1 ? reflectSlot(motif[j].slot + shift, n) : motif[j].slot;
      if (form === 3 && j === motif.length - 1) slot = tonicNear(slot, n, scaleSize);
      out.push({ beat, slot });
    }
  }
  // the loop's very last note comes home to a tonic bar
  if (out.length > 0) out[out.length - 1].slot = tonicNear(out[out.length - 1].slot, n, scaleSize);
  return out;
}

/** A scale run over the bars: up and back down one bar a beat (0, 1, …, N − 1, N − 2, …, 1, 0, …), `loopBeats` notes. */
export function scaleRunPhrase(bars: number, loopBeats: number): { beat: number; slot: number }[] {
  const n = Math.max(1, Math.floor(bars));
  const out: { beat: number; slot: number }[] = [];
  for (let beat = 0; beat < loopBeats; beat++) out.push({ beat, slot: reflectSlot(beat, n) });
  return out;
}

/**
 * A seeded ORIGINAL phrase of `steps` ladder degrees for the staircase: a walk from a degree drawn in 3 … 7 by steps of
 * −2 … +2 (within 0 … 9), ending on the root (degree 0 or 5). The draws: the start (1), then one a step (`steps`).
 */
export function originalStairsDegrees(steps: number, random: () => number): number[] {
  const n = Math.max(1, Math.floor(steps));
  const STEPS = [-2, -1, 1, 2, -1, 1];
  let degree = 3 + Math.floor(random() * 5);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const u = random();
    if (k > 0) degree = Math.max(0, Math.min(9, degree + STEPS[Math.min(STEPS.length - 1, Math.floor(u * STEPS.length))]));
    out.push(degree);
  }
  if (n > 1) out[n - 1] = Math.abs(out[n - 1] - 5) < Math.abs(out[n - 1]) ? 5 : 0;
  return out;
}

/** What a phrase is built from. */
export interface BmPhraseInput {
  variant: BmVariant;
  source: BmSource;
  /** Bars (marbles) or steps (stairs). */
  slots: number;
  /** Marbles: the loop's beats. */
  loopBeats: number;
  /** The loaded melody's pitches (Hz), in order. */
  melody: readonly number[];
  /** The typed list (`parseNoteList()`). */
  custom: string;
  scale: ScaleId | string;
  root: number;
}

/** The phrase built and the source it really came from (a loaded melody or a typed list that is empty falls back to the original). */
export interface BmPhrase {
  notes: BmNote[];
  source: BmSource;
  /** The slots' pitches (Hz): the bars' (marbles) or the ladder's (stairs). */
  slotHz: number[];
}

/**
 * The phrase of a machine. Marbles: notes on the beat grid within the loop – the original phrase, a scale run, the melody (one
 * note a beat, each on the bar nearest its pitch, the melody repeated to fill the loop) or the typed list (one token a beat:
 * a bar number or a note name on its nearest bar). Stairs: one note per step – the ladder (step k plays degree k), the
 * original phrase's degrees, the melody's k-th note (repeated) or the list's k-th token. `random` is drawn only for the
 * original phrase (and a fallback to it).
 */
export function buildPhrase(input: BmPhraseInput, random: () => number): BmPhrase {
  const intervals = machineIntervals(input.scale);
  const loopBeats = Math.max(1, Math.round(input.loopBeats));
  const melody = input.melody.filter((f) => Number.isFinite(f) && f > 0);
  const tokens = parseNoteList(input.custom);
  let source: BmSource = input.source;
  if (source === "melody" && melody.length === 0) source = "original";
  if (source === "custom" && !tokens.some((t) => t !== null)) source = "original";
  if (input.variant === "stairs") {
    const steps = Math.max(1, Math.floor(input.slots));
    const ladder: number[] = [];
    for (let k = 0; k < steps; k++) ladder.push(ladderFrequency(k, steps, input.scale, input.root));
    const notes: BmNote[] = [];
    const degrees = source === "original" ? originalStairsDegrees(steps, random) : null;
    for (let k = 0; k < steps; k++) {
      let frequency = ladder[k];
      if (degrees) frequency = ladderFrequency(degrees[k], Math.min(steps, 10), input.scale, input.root);
      else if (source === "melody") frequency = melody[k % melody.length];
      else if (source === "custom") {
        const token = tokens[k % tokens.length];
        if (token && "frequency" in token) frequency = token.frequency;
        else if (token && "slot" in token) frequency = ladderFrequency(token.slot, steps, input.scale, input.root);
      }
      notes.push({ beat: k, slot: k, frequency });
    }
    return { notes, source, slotHz: ladder };
  }
  const bars = Math.max(1, Math.floor(input.slots));
  const barHz = barFrequencies(bars, input.scale, input.root);
  let raw: { beat: number; slot: number }[];
  if (source === "scale") raw = scaleRunPhrase(bars, loopBeats);
  else if (source === "melody") {
    raw = [];
    for (let beat = 0; beat < loopBeats; beat++) raw.push({ beat, slot: nearestBar(melody[beat % melody.length], barHz) });
  } else if (source === "custom") {
    raw = [];
    for (let beat = 0; beat < loopBeats; beat++) {
      const token = tokens[beat % tokens.length];
      if (!token) continue;
      raw.push({ beat, slot: "slot" in token ? Math.min(bars - 1, token.slot) : nearestBar(token.frequency, barHz) });
    }
  } else raw = originalMarblePhrase(bars, loopBeats, random, intervals.length);
  return { notes: raw.map((n) => ({ beat: n.beat, slot: n.slot, frequency: barHz[n.slot] })), source, slotHz: barHz };
}

/* ------------------------------------------------------------------ paths and segments */

/** A polyline with its cumulative arc length (`s[i]` at point i). */
export interface BmPath {
  x: number[];
  y: number[];
  s: number[];
  length: number;
}

/** A path through `points` (consecutive duplicates dropped). */
export function makePath(points: readonly { x: number; y: number }[]): BmPath {
  const x: number[] = [];
  const y: number[] = [];
  const s: number[] = [];
  let length = 0;
  for (const p of points) {
    if (x.length > 0) {
      const d = Math.hypot(p.x - x[x.length - 1], p.y - y[y.length - 1]);
      if (d < 1e-12) continue;
      length += d;
    }
    x.push(p.x);
    y.push(p.y);
    s.push(length);
  }
  return { x, y, s, length };
}

/** The point `dist` along `path` (clamped to its ends) into `out`. */
export function pointAlong(path: BmPath, dist: number, out: { x: number; y: number }): { x: number; y: number } {
  const n = path.x.length;
  if (n === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  if (n === 1 || dist <= 0) {
    out.x = path.x[0];
    out.y = path.y[0];
    return out;
  }
  if (dist >= path.length) {
    out.x = path.x[n - 1];
    out.y = path.y[n - 1];
    return out;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.s[mid] <= dist) lo = mid;
    else hi = mid;
  }
  const span = path.s[hi] - path.s[lo];
  const u = span > 0 ? (dist - path.s[lo]) / span : 0;
  out.x = path.x[lo] + (path.x[hi] - path.x[lo]) * u;
  out.y = path.y[lo] + (path.y[hi] - path.y[lo]) * u;
  return out;
}

/** Points of a circular arc from angle a0 to a1 (radians; y down) about (cx, cy), `pieces` chords. */
function arcPoints(cx: number, cy: number, radius: number, a0: number, a1: number, pieces: number, into: { x: number; y: number }[]) {
  for (let i = 0; i <= pieces; i++) {
    const a = a0 + ((a1 - a0) * i) / pieces;
    into.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
}

export const SEG_ARC = 0;
export const SEG_PATH = 1;
export const SEG_HOLD = 2;

/**
 * A piece of a trajectory over [t0, t1] (seconds): an **arc** (a parabola: (x0, y0) at t0 with the velocity (vx, vy) and the
 * gravity g, y down), a **path** (from arc length s0 to s1 of `path` at a constant speed) or a **hold** (still at (x0, y0)).
 * `drop`: the marble's fall into its tube (the stack stops it: `marblePosition()`).
 */
export interface BmSegment {
  kind: typeof SEG_ARC | typeof SEG_PATH | typeof SEG_HOLD;
  t0: number;
  t1: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  g: number;
  path: BmPath | null;
  s0: number;
  s1: number;
  drop?: boolean;
}

function arcSegment(t0: number, t1: number, x0: number, y0: number, vx: number, vy: number, g: number): BmSegment {
  return { kind: SEG_ARC, t0, t1, x0, y0, vx, vy, g, path: null, s0: 0, s1: 0 };
}
function pathSegment(t0: number, t1: number, path: BmPath, s0 = 0, s1 = path.length): BmSegment {
  return { kind: SEG_PATH, t0, t1, x0: path.x[0] ?? 0, y0: path.y[0] ?? 0, vx: 0, vy: 0, g: 0, path, s0, s1 };
}
function holdSegment(t0: number, t1: number, x: number, y: number): BmSegment {
  return { kind: SEG_HOLD, t0, t1, x0: x, y0: y, vx: 0, vy: 0, g: 0, path: null, s0: 0, s1: 0 };
}

/** Where `seg` puts the ball at time `t` (clamped to the segment) into `out`; returns `out`. */
export function sampleSegment(seg: BmSegment, t: number, out: { x: number; y: number }): { x: number; y: number } {
  const span = seg.t1 - seg.t0;
  const tau = t <= seg.t0 ? 0 : t >= seg.t1 ? span : t - seg.t0;
  if (seg.kind === SEG_ARC) {
    out.x = seg.x0 + seg.vx * tau;
    out.y = seg.y0 + seg.vy * tau + 0.5 * seg.g * tau * tau;
    return out;
  }
  if (seg.kind === SEG_PATH && seg.path) {
    const u = span > 0 ? tau / span : 1;
    return pointAlong(seg.path, seg.s0 + (seg.s1 - seg.s0) * u, out);
  }
  out.x = seg.x0;
  out.y = seg.y0;
  return out;
}

/** The segment of `segments` (in time order, contiguous) that holds `t` – the last one starting at or before it. */
export function segmentAt(segments: readonly BmSegment[], t: number): BmSegment | null {
  if (segments.length === 0) return null;
  let lo = 0;
  let hi = segments.length - 1;
  if (t <= segments[0].t0) return segments[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo];
}

/* ------------------------------------------------------------------ events */

export const BM_EVENT_KINDS = ["note", "release", "lift", "catch", "tip", "glide", "bass"] as const;
export type BmEventKind = (typeof BM_EVENT_KINDS)[number];

/**
 * Something the machine does at `t` (seconds into the loop, 0 ≤ t < loop): a **note** (a marble strikes its bar / the ball
 * lands on a step: `slot`, `frequency`, `note` – its index in the phrase), a marble's **release** from its tube, a marble
 * picked up by a lift **rung**, the stairs' hook **catch** and **tip**, the reset **glide** (from `frequency` to `toFrequency`
 * over `seconds`, ending at the loop point) and the **bass** of the phrase (every BM_BASS_BEATS beats).
 */
export interface BmEvent {
  t: number;
  kind: BmEventKind;
  slot: number;
  frequency: number;
  note: number;
  seconds: number;
  toFrequency: number;
}

function event(t: number, kind: BmEventKind, slot = 0, frequency = 0, note = -1, seconds = 0, toFrequency = 0): BmEvent {
  return { t, kind, slot, frequency, note, seconds, toFrequency };
}

/* ------------------------------------------------------------------ the plan */

/** What a plan is made from (the mode's resolved settings and the phrase). */
export interface BmPlanInput {
  variant: BmVariant;
  bpm: number;
  /** Stairs: the steps and their offsets (% of the panel). */
  steps: number;
  stepDxPct: number;
  stepDyPct: number;
  /** Marbles: the bars, the drop (% of the panel), the rebound and the marbles a tube holds at least (0 = auto). */
  bars: number;
  dropPct: number;
  rebound: number;
  perTube: number;
  /** Stairs: beats of the return trip. */
  returnBeats: number;
  /** Marbles: the loop's beats. */
  loopBeats: number;
  /** The phrase bass every BM_BASS_BEATS beats (marbles). */
  bass: boolean;
  phrase: BmPhrase;
}

export interface BmStep {
  /** The bar's centre and the landing point (the ball's centre on it). */
  x: number;
  y: number;
  landX: number;
  landY: number;
  frequency: number;
  color: string;
}

export interface BmStairsLayout {
  radius: number;
  stepW: number;
  stepH: number;
  dx: number;
  dy: number;
  /** The hops' gravity (units / s²), take-off speed and apex. */
  g: number;
  apex: number;
  steps: BmStep[];
  /** The hook the ball drops into and the tipping hook it leaves from (the ball's centre), the return track (null: flies back). */
  hook: { x: number; y: number } | null;
  tip: { x: number; y: number } | null;
  track: BmPath | null;
  /** The ball's whole loop. */
  segments: BmSegment[];
}

export interface BmBar {
  x: number;
  top: number;
  frequency: number;
  color: string;
}

export interface BmTube {
  x: number;
  /** The bottom marble's centre (where a release starts) and the tube's open top (y). */
  exitY: number;
  topY: number;
  /** Marbles in the tube's machine, what its tune needs, and the spares added beyond the setting. */
  count: number;
  needed: number;
  spares: number;
  /** The journeys of its notes (indices into `journeys`), by release time. */
  journeys: number[];
}

/** One marble's trip for one note (loop 0's; loop L is the same L · loop later). */
export interface BmJourney {
  note: number;
  tube: number;
  release: number;
  strike: number;
  floorAt: number;
  liftAt: number;
  topAt: number;
  back: number;
  segments: BmSegment[];
}

export interface BmMarbleLayout {
  pitch: number;
  radius: number;
  barW: number;
  barH: number;
  g: number;
  dropSec: number;
  strikeY: number;
  bars: BmBar[];
  tubes: BmTube[];
  journeys: BmJourney[];
  floorY: number;
  floorBallY: number;
  floorLeft: number;
  floorRight: number;
  liftX: number;
  liftTopY: number;
  railY: number;
  railLeft: number;
  /** The rungs: one passes the lift's foot every `rungSec` (from t = 0), `rungSpacing` apart, moving up at `liftSpeed`. */
  rungSec: number;
  rungSpacing: number;
  liftSpeed: number;
  /** The stack's settle: a marble falls one slot in this long after the one under it left. */
  settleSec: number;
}

export interface BeatMachinePlan {
  variant: BmVariant;
  bpm: number;
  beatSec: number;
  loopBeats: number;
  loopSec: number;
  notes: BmNote[];
  /** The loop's events, by time (0 ≤ t < loopSec). */
  events: BmEvent[];
  /** The machine's box (units), everything drawn included. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  stairs: BmStairsLayout | null;
  marbles: BmMarbleLayout | null;
  /** Engine balls the machine needs: the stairs' ball, or every marble. */
  ballCount: number;
  /** Marbles: the spares added beyond the setting (auto: one a tube) and the tubes that needed one. */
  spares: number;
  conflicts: number;
  /** Marbles: the most out of their tubes at once in a loop. */
  inFlightMax: number;
}

/** The gravity (units / s²) of a hop of `T` seconds dropping `dy` whose apex is `apex` above its take-off. */
export function stairsGravity(T: number, dy: number, apex: number): number {
  const a = Math.max(1e-9, apex);
  const s = (Math.sqrt(2 * a) + Math.sqrt(2 * Math.max(0, a + dy))) / T;
  return s * s;
}

/** The vertical take-off speed (y down: negative is up) of a flight of `T` s falling `drop` under gravity `g`. */
export function takeOffVy(T: number, drop: number, g: number): number {
  return (drop - 0.5 * g * T * T) / T;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
/** The colour `u` (0–1) along `palette`, blended between its neighbours. */
export function paletteAt(palette: readonly string[], u: number): string {
  if (palette.length === 1) return palette[0];
  const x = Math.max(0, Math.min(1, u)) * (palette.length - 1);
  const i = Math.min(palette.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(palette[i]);
  const b = hexToRgb(palette[i + 1]);
  return rgbHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}

/** The plan of a machine (see the file's comment). */
export function planBeatMachine(input: BmPlanInput): BeatMachinePlan {
  return input.variant === "stairs" ? planStairs(input) : planMarbles(input);
}

/* ------------------------------------------------------------------ stairs */

function planStairs(input: BmPlanInput): BeatMachinePlan {
  const n = Math.max(1, Number.isFinite(input.steps) ? Math.floor(input.steps) : 8);
  const R = Math.max(0, Number.isFinite(input.returnBeats) ? Math.floor(input.returnBeats) : 4);
  const bpm = input.bpm > 0 && Number.isFinite(input.bpm) ? input.bpm : 80;
  const T = 60 / bpm;
  const loopBeats = n + R;
  const P = loopBeats * T;
  const dx = Number.isFinite(input.stepDxPct) ? Math.max(0, input.stepDxPct) / 100 : 0.075;
  const dy = Number.isFinite(input.stepDyPct) ? Math.max(0, input.stepDyPct) / 100 : 0.079;
  const r = BM_STAIRS_BALL_R;
  const apex = Math.max(BM_APEX_MIN, BM_APEX_SHARE * dy);
  // (a beat far below the clock's resolution would overflow the hop's gravity: it stops at BM_G_CEILING, a blur either way)
  const g = Math.min(stairsGravity(T, dy, apex), BM_G_CEILING);
  const vxHop = dx / T;
  const vyHop = takeOffVy(T, dy, g);
  const land = (k: number) => ({ x: k * dx, y: k * dy - BM_STEP_H / 2 - r });
  const steps: BmStep[] = [];
  const notes = input.phrase.notes;
  for (let k = 0; k < n; k++) {
    const l = land(k);
    steps.push({ x: k * dx, y: k * dy, landX: l.x, landY: l.y, frequency: notes[k]?.frequency ?? input.phrase.slotHz[k] ?? 440, color: paletteAt([BM_STEP_FROM, BM_STEP_TO], n > 1 ? k / (n - 1) : 0) });
  }
  const segments: BmSegment[] = [];
  for (let k = 0; k + 1 < n; k++) segments.push(arcSegment(k * T, (k + 1) * T, steps[k].landX, steps[k].landY, vxHop, vyHop, g));
  const last = steps[n - 1];
  let hook: { x: number; y: number } | null = null;
  let tip: { x: number; y: number } | null = null;
  let track: BmPath | null = null;
  const events: BmEvent[] = [];
  if (R >= 2) {
    hook = land(n);
    tip = land(-1);
    // the U-shaped return track: down from the hook, along the bottom, up the left side and over the tipping hook
    const pts: { x: number; y: number }[] = [];
    const xL = tip.x - BM_TIP_RADIUS;
    const yB = hook.y + BM_TRACK_DROP;
    const bowl = Math.max(1e-4, Math.min(BM_BOWL_RADIUS, (hook.x - xL) / 2, (yB - hook.y) / 1.01));
    pts.push({ x: hook.x, y: hook.y });
    arcPoints(hook.x - bowl, yB - bowl, bowl, 0, Math.PI / 2, 10, pts);
    arcPoints(xL + bowl, yB - bowl, bowl, Math.PI / 2, Math.PI, 10, pts);
    arcPoints(xL + BM_TIP_RADIUS, tip.y + BM_TIP_RADIUS, BM_TIP_RADIUS, Math.PI, 1.5 * Math.PI, 10, pts);
    track = makePath(pts);
    segments.push(arcSegment((n - 1) * T, n * T, last.landX, last.landY, vxHop, vyHop, g));
    segments.push(pathSegment(n * T, (n + R - 1) * T, track));
    segments.push(arcSegment((n + R - 1) * T, P, tip.x, tip.y, vxHop, vyHop, g));
    events.push(event(n * T, "catch"));
    events.push(event((n + R - 1) * T, "tip"));
  } else {
    // fly straight back to the first step in (R + 1) beats
    const D = (R + 1) * T;
    const first = steps[0];
    segments.push(arcSegment((n - 1) * T, P, last.landX, last.landY, (first.landX - last.landX) / D, takeOffVy(D, first.landY - last.landY, g), g));
  }
  for (let k = 0; k < n; k++) events.push(event(k * T, "note", k, steps[k].frequency, k));
  if (R >= 1) {
    const firstHz = steps[0].frequency;
    events.push(event(n * T, "glide", 0, firstHz / 4, -1, R * T, firstHz / 2));
  }
  events.sort((a, b) => a.t - b.t || BM_EVENT_KINDS.indexOf(a.kind) - BM_EVENT_KINDS.indexOf(b.kind));
  // the box: the steps, the hooks, the apexes and the track (the renderer's panel pads it)
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number, pad: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x - pad);
    x1 = Math.max(x1, x + pad);
    y0 = Math.min(y0, y - pad);
    y1 = Math.max(y1, y + pad);
  };
  for (const s of steps) {
    grow(s.x - BM_STEP_W / 2, s.y, BM_STEP_H);
    grow(s.x + BM_STEP_W / 2, s.y, BM_STEP_H);
    grow(s.landX, s.landY - apex, r);
  }
  if (track) for (let i = 0; i < track.x.length; i++) grow(track.x[i], track.y[i], 2 * r);
  if (tip) grow(tip.x, tip.y - apex, r);
  if (R < 2 && n > 1) {
    // the flight back: its apex
    const seg = segments[segments.length - 1];
    if (seg.vy < 0 && g < BM_G_CEILING) grow(seg.x0 + seg.vx * (-seg.vy / g), seg.y0 - (seg.vy * seg.vy) / (2 * g), r);
  }
  return {
    variant: "stairs",
    bpm,
    beatSec: T,
    loopBeats,
    loopSec: P,
    notes: notes.slice(0, n),
    events,
    bbox: { x0, y0, x1, y1 },
    stairs: { radius: r, stepW: BM_STEP_W, stepH: BM_STEP_H, dx, dy, g, apex, steps, hook, tip, track, segments },
    marbles: null,
    ballCount: 1,
    spares: 0,
    conflicts: 0,
    inFlightMax: 1,
  };
}

/** The stairs ball's position at simulation time `t` (any t ≥ 0: the plan repeats every loop) into `out`. */
export function stairsPosition(plan: BeatMachinePlan, t: number, out: { x: number; y: number }): { x: number; y: number } {
  const s = plan.stairs;
  if (!s) return out;
  const P = plan.loopSec;
  let tl = t - Math.floor((t + BM_TIME_EPS) / P) * P;
  if (tl < 0) tl = 0;
  const seg = segmentAt(s.segments, tl);
  if (!seg) {
    out.x = s.steps[0].landX;
    out.y = s.steps[0].landY;
    return out;
  }
  return sampleSegment(seg, tl, out);
}

/* ------------------------------------------------------------------ marbles */

/** Floor-mod. */
function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function planMarbles(input: BmPlanInput): BeatMachinePlan {
  const N = Math.max(1, Number.isFinite(input.bars) ? Math.floor(input.bars) : 10);
  const bpm = input.bpm > 0 && Number.isFinite(input.bpm) ? input.bpm : 100;
  const T = 60 / bpm;
  const loopBeats = Math.max(1, Number.isFinite(input.loopBeats) ? Math.round(input.loopBeats) : 32);
  const P = loopBeats * T;
  const p = BM_BAR_PITCH;
  const r = BM_MARBLE_R_SHARE * p;
  const barW = BM_BAR_W_SHARE * p;
  const g = BM_MARBLE_G;
  const h = Math.max(1e-4, Number.isFinite(input.dropPct) ? input.dropPct / 100 : 0.28);
  const dropSec = Math.sqrt((2 * h) / g);
  const e = Math.max(BM_MIN_REBOUND, Number.isFinite(input.rebound) ? input.rebound : 0.3);
  // vertical layout (y down, the floor's surface at 0)
  const floorY = 0;
  const floorBallY = floorY - r;
  const barTop = floorY - BM_FLOOR_GAP;
  const strikeY = barTop - r;
  const exitY = strikeY - h;
  const barHz = input.phrase.slotHz;
  const bars: BmBar[] = [];
  for (let b = 0; b < N; b++) bars.push({ x: b * p, top: barTop, frequency: barHz[b] ?? 440, color: N === BM_BAR_COLORS.length ? BM_BAR_COLORS[b] : paletteAt(BM_BAR_COLORS, N > 1 ? b / (N - 1) : 0) });
  const liftX = (N - 1) * p + BM_LIFT_OFFSET * p;
  const floorLeft = -0.6 * p;
  const floorRight = liftX + 0.45 * p;
  // the notes inside the loop, in time order
  const notes = input.phrase.notes.filter((nt) => nt.beat >= 0 && nt.beat < loopBeats - BM_TIME_EPS && nt.slot >= 0 && nt.slot < N).sort((a, b) => a.beat - b.beat || a.slot - b.slot);
  // the rebound and the floor (the same for every note of a bar)
  const vImpact = g * dropSec;
  const vy0 = e * vImpact;
  const tauUp = (2 * vy0) / g;
  const fallToFloor = floorBallY - strikeY;
  const tauFloor = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * fallToFloor)) / g;
  const reboundOf = (b: number) => {
    const xb = bars[b].x;
    const nominal = (0.5 * p) / Math.max(1e-6, tauUp);
    const reach = Math.max(0, (liftX - 2 * r - xb) / tauFloor);
    const vx = Math.min(nominal, reach);
    return { vx, landX: xb + vx * tauFloor };
  };
  // the rungs: a whole number a loop, at least BM_RUNG_GAP radii apart
  const rungTarget = (BM_RUNG_GAP * r) / BM_LIFT_SPEED;
  const rungsPerLoop = Math.max(1, Math.floor(P / rungTarget));
  const rungSec = P / rungsPerLoop;
  // the arrivals at the lift's foot, then the first free rung for each – first come, first served, the steady state of the
  // periodic schedule (loop 2 of four simulated; an overloaded lift that never settles takes the next rung, shared)
  const m = notes.length;
  const arrive: number[] = [];
  for (let j = 0; j < m; j++) {
    const s = notes[j].beat * T;
    const rb = reboundOf(notes[j].slot);
    arrive.push(s + tauFloor + (liftX - rb.landX) / BM_FLOOR_SPEED);
  }
  const wait = new Array<number>(m).fill(0);
  if (m > 0) {
    const order: { a: number; j: number; L: number }[] = [];
    for (let L = 0; L < 4; L++) for (let j = 0; j < m; j++) order.push({ a: arrive[j] + L * P, j, L });
    order.sort((x, y) => x.a - y.a || x.L - y.L || x.j - y.j);
    // (in arrival order the first free rung at or after one's own is its own or the one after the last taken: the rungs
    // taken so far run on unbroken from an earlier own rung up to the last)
    const rung2 = new Array<number>(m).fill(0);
    const rung3 = new Array<number>(m).fill(0);
    let last = -Infinity;
    for (const o of order) {
      const own = Math.ceil(o.a / rungSec - 1e-9);
      const idx = own > last ? own : last + 1;
      last = idx;
      if (o.L === 2) rung2[o.j] = idx;
      if (o.L === 3) rung3[o.j] = idx;
    }
    let steady = true;
    for (let j = 0; j < m; j++) if (rung3[j] !== rung2[j] + rungsPerLoop) steady = false;
    for (let j = 0; j < m; j++) {
      const a = arrive[j] + 2 * P;
      const at = steady ? rung2[j] * rungSec : Math.ceil(a / rungSec - 1e-9) * rungSec;
      wait[j] = Math.max(0, at - a);
    }
  }
  // the tubes' height needs the marbles they hold: plan the journeys' times first, then the counts, then the geometry above
  const liftDistBase = floorBallY; // the lift runs from the floor up to the rail (railY, set below)
  const journeysTimes = notes.map((nt, j) => {
    const s = nt.beat * T;
    const rel = s - dropSec;
    const floorAt = s + tauFloor;
    const liftAt = arrive[j] + wait[j];
    return { rel, s, floorAt, arriveAt: arrive[j], liftAt };
  });
  // the stack geometry depends on the counts, and the counts on the trip's length (the rail's height): solve with the tallest
  // tube a count can need, then settle (two passes: the second never needs more than the first allowed)
  let maxCount = 1;
  let railY = 0;
  let tubeTop = 0;
  let needed: number[] = new Array<number>(N).fill(1);
  let backs: number[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const tubeH = Math.max(3, maxCount) * 2 * r + r;
    tubeTop = exitY + r - tubeH;
    railY = tubeTop - r - 0.006;
    const liftSec = (liftDistBase - railY) / BM_LIFT_SPEED;
    const dropInSec = Math.sqrt((2 * (exitY - railY)) / g);
    backs = journeysTimes.map((jt, j) => jt.liftAt + liftSec + (liftX - bars[notes[j].slot].x) / BM_RAIL_SPEED + dropInSec);
    needed = tubeNeeds(N, notes.map((nt) => nt.slot), journeysTimes.map((jt) => jt.rel), backs, P).map((nd) => Math.min(nd, BM_TUBE_CEILING));
    const want = Math.max(1, ...needed.map((nd) => Math.max(nd, input.perTube > 0 ? Math.min(Math.round(input.perTube), BM_TUBE_CEILING) : 1)));
    if (want <= maxCount) break;
    maxCount = want;
  }
  const liftSec = (floorBallY - railY) / BM_LIFT_SPEED;
  const limit = input.perTube > 0 ? Math.max(1, Math.min(Math.round(input.perTube), BM_TUBE_CEILING)) : 1;
  const tubes: BmTube[] = [];
  let spares = 0;
  let conflicts = 0;
  for (let b = 0; b < N; b++) {
    const need = needed[b];
    const count = Math.max(limit, need);
    const extra = Math.max(0, need - limit);
    spares += extra;
    if (extra > 0) conflicts++;
    tubes.push({ x: bars[b].x, exitY, topY: tubeTop, count, needed: need, spares: extra, journeys: [] });
  }
  // the journeys
  const railPath = (xb: number) => makePath([{ x: liftX, y: railY }, { x: xb, y: railY }]);
  const liftPath = makePath([{ x: liftX, y: floorBallY }, { x: liftX, y: railY }]);
  const journeys: BmJourney[] = notes.map((nt, j) => {
    const b = nt.slot;
    const xb = bars[b].x;
    const jt = journeysTimes[j];
    const rb = reboundOf(b);
    const segs: BmSegment[] = [];
    segs.push(arcSegment(jt.rel, jt.s, xb, exitY, 0, 0, g));
    segs.push(arcSegment(jt.s, jt.floorAt, xb, strikeY, rb.vx, -vy0, g));
    segs.push(pathSegment(jt.floorAt, jt.arriveAt, makePath([{ x: rb.landX, y: floorBallY }, { x: liftX, y: floorBallY }])));
    if (jt.liftAt > jt.arriveAt) segs.push(holdSegment(jt.arriveAt, jt.liftAt, liftX, floorBallY));
    const topAt = jt.liftAt + liftSec;
    segs.push(pathSegment(jt.liftAt, topAt, liftPath));
    const railEnd = topAt + (liftX - xb) / BM_RAIL_SPEED;
    segs.push(pathSegment(topAt, railEnd, railPath(xb)));
    const dropIn = arcSegment(railEnd, backs[j], xb, railY, 0, 0, g);
    dropIn.drop = true;
    segs.push(dropIn);
    return { note: j, tube: b, release: jt.rel, strike: jt.s, floorAt: jt.floorAt, liftAt: jt.liftAt, topAt, back: backs[j], segments: segs };
  });
  for (let j = 0; j < journeys.length; j++) tubes[journeys[j].tube].journeys.push(j);
  for (const tube of tubes) tube.journeys.sort((a, b) => journeys[a].release - journeys[b].release || a - b);
  // the events (mod the loop)
  const events: BmEvent[] = [];
  for (const jr of journeys) {
    events.push(event(mod(jr.strike, P), "note", jr.tube, bars[jr.tube].frequency, jr.note));
    events.push(event(mod(jr.release, P), "release", jr.tube, 0, jr.note));
    events.push(event(mod(jr.liftAt, P), "lift", jr.tube, 0, jr.note));
  }
  if (input.bass) {
    for (let beat = 0; beat < loopBeats; beat += BM_BASS_BEATS) {
      // the window's lowest note, its pitch class in the bass register (55–110 Hz)
      let low = Infinity;
      for (const nt of notes) if (nt.beat >= beat && nt.beat < beat + BM_BASS_BEATS && nt.frequency < low) low = nt.frequency;
      if (!Number.isFinite(low)) continue;
      let f = low;
      while (f >= 110) f /= 2;
      while (f < 55) f *= 2;
      events.push(event(beat * T, "bass", 0, f));
    }
  }
  events.sort((a, b) => a.t - b.t || BM_EVENT_KINDS.indexOf(a.kind) - BM_EVENT_KINDS.indexOf(b.kind) || a.note - b.note);
  const settleSec = Math.sqrt((2 * 2 * r) / g);
  const ballCount = tubes.reduce((sum, tube) => sum + tube.count, 0);
  // (never more than the marbles: a tube past its ceiling reuses them)
  const inFlightMax = Math.min(ballCount, maxActive(journeys.map((jr) => jr.release), journeys.map((jr) => jr.back), P));
  return {
    variant: "marbles",
    bpm,
    beatSec: T,
    loopBeats,
    loopSec: P,
    notes,
    events,
    bbox: { x0: floorLeft - p * 0.3, y0: railY - 3 * r, x1: floorRight + p * 0.3, y1: floorY + 0.035 },
    stairs: null,
    marbles: {
      pitch: p,
      radius: r,
      barW,
      barH: BM_BAR_H,
      g,
      dropSec,
      strikeY,
      bars,
      tubes,
      journeys,
      floorY,
      floorBallY,
      floorLeft,
      floorRight,
      liftX,
      liftTopY: railY,
      railY,
      railLeft: -r,
      rungSec,
      rungSpacing: rungSec * BM_LIFT_SPEED,
      liftSpeed: BM_LIFT_SPEED,
      settleSec,
    },
    ballCount,
    spares,
    conflicts,
    inFlightMax,
  };
}

/**
 * The marbles each tube needs (at least 1): at every release, one more than the marbles of the same tube still out – released
 * earlier, in this loop or any before it, and not back yet (a marble back exactly at a release is in time). The schedule
 * repeats every `period`, so a trip longer than the loop counts once for every loop it spans.
 */
export function tubeNeeds(tubes: number, tubeOf: readonly number[], release: readonly number[], back: readonly number[], period: number): number[] {
  const out = new Array<number>(tubes).fill(1);
  for (let b = 0; b < tubes; b++) {
    const idx: number[] = [];
    for (let j = 0; j < tubeOf.length; j++) if (tubeOf[j] === b) idx.push(j);
    if (idx.length === 0) continue;
    for (const i of idx) {
      const at = release[i];
      let out_ = 0;
      for (const j of idx) out_ += tripsOutAt(release[j], back[j], at, period, j < i);
      if (out_ + 1 > out[b]) out[b] = out_ + 1;
    }
  }
  return out;
}

/**
 * The loops L ≥ 0 whose copy of a trip [r − L·period, bk − L·period) is under way at `at`: released at or before it and not
 * back by it (L = 0 at exactly `at` only when `before`: released earlier in the same instant). Counted, not enumerated – the
 * division places the bounds and a few exact checks of the two conditions settle them (a trip may span any number of loops).
 */
function tripsOutAt(r: number, bk: number, at: number, period: number, before: boolean): number {
  if (!(period > 0) || !Number.isFinite(r) || !Number.isFinite(bk) || !Number.isFinite(at)) return 0;
  const released = (L: number) => r - L * period <= at;
  const out = (L: number) => bk - L * period > at + BM_TIME_EPS;
  // lo: the first loop released by `at`
  let lo = Math.max(0, Math.ceil((r - at) / period));
  for (let k = 0; k < 4 && lo > 0 && released(lo - 1); k++) lo--;
  for (let k = 0; k < 4 && !released(lo); k++) lo++;
  if (lo === 0 && r === at && !before) lo = 1;
  // hi: the first loop back by `at`
  let hi = Math.max(lo, Math.ceil((bk - at - BM_TIME_EPS) / period));
  for (let k = 0; k < 4 && hi > lo && !out(hi - 1); k++) hi--;
  for (let k = 0; k < 4 && out(hi); k++) hi++;
  return Math.max(0, hi - lo);
}

/** The most trips under way at once on the periodic schedule (each [release, back), repeating every `period`). */
export function maxActive(release: readonly number[], back: readonly number[], period: number): number {
  const marks: { t: number; d: number }[] = [];
  let base = 0;
  for (let j = 0; j < release.length; j++) {
    const len = back[j] - release[j];
    if (!(len > 0)) continue;
    const full = Math.floor(len / period);
    const rem = len - full * period;
    base += full;
    if (rem <= BM_TIME_EPS) continue;
    const a = mod(release[j], period);
    const end = a + rem;
    if (end <= period) {
      marks.push({ t: a, d: 1 }, { t: end, d: -1 });
    } else {
      marks.push({ t: a, d: 1 }, { t: period, d: -1 }, { t: 0, d: 1 }, { t: end - period, d: -1 });
    }
  }
  marks.sort((x, y) => x.t - y.t || x.d - y.d);
  let count = base;
  let best = base;
  for (const mk of marks) {
    count += mk.d;
    if (count > best) best = count;
  }
  return best;
}

/** A marble's state at a time: in its tube (`idle`, `slot` from the bottom) or on a trip (`journey`, the segment's index). */
export interface BmMarbleState {
  x: number;
  y: number;
  idle: boolean;
  slot: number;
  journey: number;
  segment: number;
}

/** The latest release of `tube` at or before `t`: its global index g (loop · notes + i), −∞ … ∞ (NaN without notes). */
function lastRelease(plan: BeatMachinePlan, tube: BmTube, t: number): number {
  const mb = plan.marbles!;
  const m = tube.journeys.length;
  if (m === 0) return NaN;
  const P = plan.loopSec;
  const rel0 = mb.journeys[tube.journeys[0]].release;
  const L = Math.floor((t - rel0 + BM_TIME_EPS) / P);
  const local = t - L * P;
  let lo = 0;
  let hi = m - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (mb.journeys[tube.journeys[mid]].release <= local + BM_TIME_EPS) lo = mid;
    else hi = mid - 1;
  }
  return L * m + lo;
}

/** The release time of a tube's global release g. */
function releaseTime(plan: BeatMachinePlan, tube: BmTube, g: number): number {
  const m = tube.journeys.length;
  const L = Math.floor(g / m);
  return plan.marbles!.journeys[tube.journeys[g - L * m]].release + L * plan.loopSec;
}

/** The y of stack slot `slot` (0 = the bottom) of a tube at `t`: after a release the marbles above fall one slot (gravity). */
function stackY(plan: BeatMachinePlan, tube: BmTube, slot: number, lastG: number, t: number): number {
  const mb = plan.marbles!;
  const d = 2 * mb.radius;
  if (Number.isFinite(lastG)) {
    const since = t - releaseTime(plan, tube, lastG);
    if (since >= 0 && since < mb.settleSec) return tube.exitY - (slot + 1) * d + Math.min(d, 0.5 * mb.g * since * since);
  }
  return tube.exitY - slot * d;
}

/**
 * Marble `k` of tube `tubeIndex` at simulation time `t` (any t: the plan repeats every loop) into `out`. The tube is first in,
 * first out: its marbles take its notes in turn (note g of the endless schedule is marble g mod count), so a marble back from
 * a trip queues behind the others and a release takes the bottom one; the marbles above it fall one slot.
 */
export function marblePosition(plan: BeatMachinePlan, tubeIndex: number, k: number, t: number, out: BmMarbleState): BmMarbleState {
  const mb = plan.marbles;
  if (!mb) return out;
  const tube = mb.tubes[tubeIndex];
  const K = Math.max(1, tube.count);
  const m = tube.journeys.length;
  out.journey = -1;
  out.segment = -1;
  out.x = tube.x;
  if (m === 0) {
    out.idle = true;
    out.slot = k;
    out.y = tube.exitY - k * 2 * mb.radius;
    return out;
  }
  const G = lastRelease(plan, tube, t);
  const gk = G - mod(G - k, K);
  const L = Math.floor(gk / m);
  const i = gk - L * m;
  const jr = mb.journeys[tube.journeys[i]];
  const shift = L * plan.loopSec;
  const slot = gk + K - (G + 1);
  if (t < jr.back + shift - BM_TIME_EPS) {
    const local = t - shift;
    let si = 0;
    while (si + 1 < jr.segments.length && jr.segments[si + 1].t0 <= local) si++;
    const seg = jr.segments[si];
    sampleSegment(seg, local, out);
    out.idle = false;
    out.slot = slot;
    out.journey = tube.journeys[i];
    out.segment = si;
    if (seg.drop) {
      const stop = stackY(plan, tube, slot, G, t);
      if (out.y > stop) out.y = stop;
    }
    return out;
  }
  out.idle = true;
  out.slot = slot;
  out.y = stackY(plan, tube, slot, G, t);
  return out;
}

/** Marbles out of their tubes at `t`. */
export function marblesInFlight(plan: BeatMachinePlan, t: number, scratch: BmMarbleState): number {
  const mb = plan.marbles;
  if (!mb) return 0;
  let n = 0;
  for (let b = 0; b < mb.tubes.length; b++) for (let k = 0; k < mb.tubes[b].count; k++) if (!marblePosition(plan, b, k, t, scratch).idle) n++;
  return n;
}

/** A fresh marble state. */
export function marbleState(): BmMarbleState {
  return { x: 0, y: 0, idle: true, slot: 0, journey: -1, segment: -1 };
}
