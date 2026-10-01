import { circleObstacle, segmentBetween, segmentObstacle, type Obstacle, type SegmentObstacle } from "./obstacles";
import { ENGINE_CEILINGS } from "@/lib/unlimited"; // --- unlimited ---

/**
 * The track of the Square Racing Grand Prix ("race" mode, modes/race.ts): a long vertical corridor generated
 * deterministically from the seed. Pure – no DOM, no wall-clock time, every random number from the `random` the caller
 * hands in (the engine's seeded generator) – so a seed always builds the same track and the seed finder can replay it.
 *
 * Layout (all in canvas px, world coordinates: the renderer scrolls the view down the track):
 *  - the field is the centred square the recorder crops to (`buildRaceField()`); its side S is the layout unit
 *    ("screen"). The corridor spans `TRACK_X0`…`TRACK_X1` of it, leaving the left of the square to the standings and
 *    the right to the mini-map;
 *  - the start grid sits above the start gate at `yStart`; a lap is `trackLength` screens long and holds obstacle rows
 *    drawn from a library (pegs, funnels, spinners, swap zones, turbo pads, pinball bumpers, narrow gates), spaced at
 *    least `MIN_ROW_GAP` apart, then the final sector: a swap zone and a full-width turbo strip before the lap line;
 *  - more laps repeat the lap's layout below it (a looping track seen as one long descent: the same rows come round
 *    again), each copy with its own swap / pad state; the finish line closes the last lap and a run-off area with a
 *    floor catches the finishers.
 *
 * `random` is consumed in a fixed order (the grid shuffle, then row by row: its kind, the gap after it and the
 * numbers of its own builder), so the same numbers always build the same track; the caller records them to lay the
 * track out afresh for a new canvas size before the first step.
 */

export const MIN_RACERS = 2;
export const MAX_RACERS = 16;

/** The obstacle mix a track is generated from: everything, or one kind featured in about half of the rows. */
export const RACE_FEATURES = ["mixed", "pegs", "funnels", "spinners", "swaps", "turbo", "bumpers", "gates"] as const;
export type RaceFeature = (typeof RACE_FEATURES)[number];

export function isRaceFeature(value: unknown): value is RaceFeature {
  return typeof value === "string" && (RACE_FEATURES as readonly string[]).includes(value);
}

/** The obstacle rows of the library. */
export const RACE_ROW_KINDS = ["pegs", "funnel", "spinner", "swap", "turbo", "bumpers", "gate"] as const;
export type RaceRowKind = (typeof RACE_ROW_KINDS)[number];

/** The row kind a featured mix favours. */
export const FEATURE_ROW_KIND: Record<Exclude<RaceFeature, "mixed">, RaceRowKind> = {
  pegs: "pegs",
  funnels: "funnel",
  spinners: "spinner",
  swaps: "swap",
  turbo: "turbo",
  bumpers: "bumpers",
  gates: "gate",
};

/** Relative frequency of each row kind in the mixed library. */
export const ROW_WEIGHTS: Record<RaceRowKind, number> = { pegs: 3, funnel: 2, spinner: 2, swap: 1.2, turbo: 1.6, bumpers: 1.6, gate: 1.3 };
/** A featured kind's weight is multiplied by this (about half of the rows). */
export const FEATURED_WEIGHT = 9;
/** A kind that just came (and is not featured) weighs this much less for the next row, so the mix varies. */
export const REPEAT_DAMPING = 0.25;

/* ------------------------------------------------------------------ layout constants (fractions of the field size S) */

/** Horizontal extent of the corridor inside the field square. */
export const TRACK_X0 = 0.35;
export const TRACK_X1 = 0.905;
/** The start gate, below the top of the field (the grid waits above it). */
export const START_Y = 0.22;
/** Open drop after the gate (and after every lap line) before the first row. */
export const FIRST_ROW_GAP = 0.34;
/** The final sector of every lap: a swap zone and then a full-width turbo strip, this far before the lap line. */
export const FINAL_ZONE_BEFORE = 0.62;
export const FINAL_STRIP_BEFORE = 0.34;
/** Space between two rows: at least MIN_ROW_GAP, plus up to ROW_GAP_SPREAD drawn from the seed. */
export const MIN_ROW_GAP = 0.1;
export const ROW_GAP_SPREAD = 0.1;
/** Run-off below the finish line (its floor catches the finishers). */
export const RUNOFF = 0.55;
/** Vertical pitch of the start grid's rows, and the most racers side by side in one. */
export const GRID_ROW_PITCH = 0.075;
export const GRID_PER_ROW = 8;
/** Heights of the fixed-size rows. */
export const SWAP_HEIGHT = 0.06;
export const TURBO_HEIGHT = 0.045;
export const FUNNEL_HEIGHT = 0.17;
export const BUMPER_ROW_HEIGHT = 0.2;
export const GATE_HEIGHT = 0.1;

/** The field: the centred square the recorder crops to, less a small margin. */
export interface RaceField {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Side of the square (px) – the layout unit ("one screen"). */
  size: number;
  cx: number;
  cy: number;
}

export function buildRaceField(width: number, height: number): RaceField {
  const margin = Math.max(4, 0.015 * Math.min(width, height));
  const size = Math.max(80, Math.min(width, height) - 2 * margin);
  const left = (width - size) / 2;
  const top = (height - size) / 2;
  return { left, top, right: left + size, bottom: top + size, size, cx: width / 2, cy: height / 2 };
}

/** The field size the Ball Size is given for: on a field this big a racer is exactly the Ball Size (default 8 px = 2 %). */
export const RACER_REFERENCE_FIELD = 400;

/**
 * Radius of a racer (its collision circle; a square is drawn inside it): the Ball Size scaled with the field, so a race
 * looks the same on every canvas size, at most 2.8 % of it. (It runs the same at the same size; another size can play
 * out differently through float rounding, so the page drops a found seed on a resize.)
 */
export function racerRadius(ballRadius: number, fieldSize: number): number {
  const r = Number.isFinite(ballRadius) && ballRadius > 0 ? ballRadius : 8;
  return Math.max(2, Math.min((r * fieldSize) / RACER_REFERENCE_FIELD, 0.028 * fieldSize));
}

/* ------------------------------------------------------------------ track data */

export type RaceObstacleRole = "peg" | "arm" | "spinner" | "bumper";

/** One solid obstacle: the collision shape (obstacles.ts), what it is for the sound and the drawing, and its hit flash. */
export interface RaceObstacle {
  shape: Obstacle;
  role: RaceObstacleRole;
  /** Index of its row in `RaceTrack.rows`. */
  row: number;
  /** Spinners: angle at time 0 (rad) and turn rate (rad/s); the mode sets the angle from the simulation clock. */
  phase: number;
  omega: number;
  /** Simulation ms of the last hard hit (−Infinity before) and the racer that made it. */
  lastHitMs: number;
  lastRacer: number;
}

/** A turbo dash pad: a racer whose centre enters it gets a speed boost, once per pad. */
export interface RacePad {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  row: number;
  /** The full-width strip of the final sector (the director may keep it for the favoured racer). */
  final: boolean;
  /** Racers already boosted here (bit i = racer i). */
  used: number;
  lastAtMs: number;
  lastRacer: number;
}

/**
 * A swap zone: the first racer through it arms it, the second one swaps positions with the first (wherever that one is
 * by then) – once. `y` is the trigger line (a racer's centre crossing it downward counts as entering).
 */
export interface RaceSwapZone {
  y0: number;
  y1: number;
  y: number;
  row: number;
  lap: number;
  /** The zone of the final sector. */
  final: boolean;
  /** The racer that armed it (−1: nobody yet). */
  first: number;
  used: boolean;
  /** The two racers swapped and when (simulation ms). */
  a: number;
  b: number;
  atMs: number;
}

export interface RaceRow {
  index: number;
  lap: number;
  kind: RaceRowKind;
  /** World y range the row occupies (everything in it, spinners at any angle included). */
  top: number;
  bottom: number;
  /** Part of the final sector of its lap. */
  final: boolean;
  obstacles: RaceObstacle[];
  pads: RacePad[];
  zone: RaceSwapZone | null;
}

export interface RaceTrackSettings {
  /** Racers on the grid, 2–16. */
  racers: number;
  /** Length of a lap in screens (field heights), 3–20. */
  trackLength: number;
  /** Laps, 1–5. */
  laps: number;
  feature: RaceFeature;
}

export interface RaceTrack {
  field: RaceField;
  /** The corridor's walls (x) and width. */
  left: number;
  right: number;
  width: number;
  racerRadius: number;
  /** World y of the start gate, of the lap lines (yStart + k · lapLength) and of the finish line. */
  yStart: number;
  lapLength: number;
  laps: number;
  finishY: number;
  /** The run-off floor below the finish, and the ceiling over the grid. */
  floorY: number;
  ceilingY: number;
  rows: RaceRow[];
  /** Every solid obstacle, every pad, every swap zone and the spinners (the same objects the rows hold). */
  obstacles: RaceObstacle[];
  pads: RacePad[];
  zones: RaceSwapZone[];
  spinners: RaceObstacle[];
  /** Start grid slots (world px), front row first, and the racer in each slot (a seeded shuffle). */
  grid: { x: number; y: number }[];
  gridOrder: number[];
  /** Where racer i starts (its grid slot). */
  startX: number[];
  startY: number[];
  /** Rows of one lap (the final sector included) and how many rows of each kind a lap has outside its final sector. */
  rowsPerLap: number;
  kindCounts: Record<RaceRowKind, number>;
  /** The featured kind (null for the mixed library). */
  featured: RaceRowKind | null;
}

/* ------------------------------------------------------------------ settings of the track */

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

/**
 * The track-relevant settings, filled in and clamped (whole racers 2–16, 3–20 screens, 1–5 laps, a known mix) – --- unlimited ---
 * with No limits on the screens and laps go up to their soft ceilings (`ENGINE_CEILINGS`; the racers' per-racer state is
 * sized for MAX_RACERS, so they stay at 16).
 */
export function resolveRaceTrackSettings(settings: Partial<RaceTrackSettings> | null | undefined, unlimited = false): RaceTrackSettings {
  const s = settings ?? {};
  return {
    racers: clampInt(s.racers, MIN_RACERS, MAX_RACERS, 8),
    trackLength: clampInt(s.trackLength, 3, unlimited ? Math.max(20, ENGINE_CEILINGS.rcTrackLength) : 20, 8),
    laps: clampInt(s.laps, 1, unlimited ? Math.max(5, ENGINE_CEILINGS.rcLaps) : 5, 1),
    feature: isRaceFeature(s.feature) ? s.feature : "mixed",
  };
}

/** The weight of each row kind for a mix, after a row of kind `previous` (null at the start of a lap). */
export function rowKindWeights(feature: RaceFeature, previous: RaceRowKind | null): Record<RaceRowKind, number> {
  const featured = feature === "mixed" ? null : FEATURE_ROW_KIND[feature];
  const out = { ...ROW_WEIGHTS };
  for (const kind of RACE_ROW_KINDS) {
    if (kind === featured) out[kind] *= FEATURED_WEIGHT;
    else if (kind === previous) out[kind] *= REPEAT_DAMPING;
  }
  return out;
}

/** The row kind a uniform number `u` (0–1) picks from the weights. */
export function pickRowKind(feature: RaceFeature, previous: RaceRowKind | null, u: number): RaceRowKind {
  const weights = rowKindWeights(feature, previous);
  let total = 0;
  for (const kind of RACE_ROW_KINDS) total += weights[kind];
  let x = Math.max(0, Math.min(0.999999, u)) * total;
  for (const kind of RACE_ROW_KINDS) {
    x -= weights[kind];
    if (x < 0) return kind;
  }
  return RACE_ROW_KINDS[RACE_ROW_KINDS.length - 1];
}

/* ------------------------------------------------------------------ row builders */

interface Geometry {
  S: number;
  left: number;
  right: number;
  W: number;
  r: number;
}

interface BuiltRow {
  kind: RaceRowKind;
  height: number;
  obstacles: { shape: Obstacle; role: RaceObstacleRole; phase: number; omega: number }[];
  pads: { x0: number; x1: number; y0: number; y1: number; final: boolean }[];
  zone: { y0: number; y1: number; final: boolean } | null;
}

const PEG = { restitution: 0.5, friction: 0.01 };
const ARM = { restitution: 0.3, friction: 0.004 };
const SPINNER = { restitution: 0.55, friction: 0.02 };
const BUMPER = { restitution: 0.9, friction: 0 };

function armThickness(g: Geometry) {
  return Math.max(2, 0.01 * g.S);
}

/** Two or three staggered lines of pegs; no peg closer to a wall than a racer can pass (so nothing traps a racer). */
function buildPegs(top: number, g: Geometry, random: () => number): BuiltRow {
  const lines = random() < 0.5 ? 2 : 3;
  const shift = (random() - 0.5) * 0.3;
  const pegR = Math.max(2.5, 0.015 * g.S);
  const minPitch = 2 * pegR + 4.4 * g.r;
  const n = Math.max(2, Math.floor(g.W / Math.max(minPitch, g.W / 7)));
  const pitch = g.W / n;
  const sy = Math.max(0.06 * g.S, 4.5 * g.r + 2 * pegR);
  const clear = 2.3 * g.r;
  const obstacles: BuiltRow["obstacles"] = [];
  for (let j = 0; j < lines; j++) {
    const y = top + pegR + j * sy;
    const offset = (j % 2 === 0 ? 0.5 : 1) + (j % 2 === 0 ? shift : -shift);
    for (let i = -1; i <= n; i++) {
      const x = g.left + pitch * (i + offset);
      if (x - pegR - g.left < clear || g.right - (x + pegR) < clear) continue;
      obstacles.push({ shape: circleObstacle(x, y, pegR, PEG), role: "peg", phase: 0, omega: 0 });
    }
  }
  return { kind: "pegs", height: (lines - 1) * sy + 2 * pegR, obstacles, pads: [], zone: null };
}

/** Two sloping arms from the walls down to one opening at a seeded place. */
function buildFunnel(top: number, g: Geometry, random: () => number): BuiltRow {
  const h = FUNNEL_HEIGHT * g.S;
  const t = armThickness(g);
  const ow = Math.min(0.5 * g.W, Math.max(6.5 * g.r, 0.13 * g.S));
  const margin = 0.08 * g.W;
  const ox = g.left + margin + ow / 2 + random() * Math.max(0, g.W - 2 * margin - ow);
  const y0 = top + t / 2;
  const opts = { thickness: t, ...ARM };
  return {
    kind: "funnel",
    height: h + t,
    obstacles: [
      { shape: segmentBetween(g.left, y0, ox - ow / 2, y0 + h, opts), role: "arm", phase: 0, omega: 0 },
      { shape: segmentBetween(g.right, y0, ox + ow / 2, y0 + h, opts), role: "arm", phase: 0, omega: 0 },
    ],
    pads: [],
    zone: null,
  };
}

/** One long bar turning in the middle of the corridor, or two shorter ones turning against each other. */
function buildSpinner(top: number, g: Geometry, random: () => number): BuiltRow {
  const two = random() < 0.4;
  const omega = (1.4 + 1.8 * random()) * (random() < 0.5 ? -1 : 1);
  const phase = random() * Math.PI;
  const t = Math.max(2.5, 0.014 * g.S);
  const opts = { thickness: t, angularVelocity: omega, ...SPINNER };
  // Long enough to sweep most of its half (or the middle) of the corridor, short enough to leave a racer room past its tips.
  const halfLen = Math.max(2 * g.r, Math.min((two ? 0.18 : 0.3) * g.W, (two ? 0.25 : 0.5) * g.W - 2.4 * g.r - t));
  const cy = top + halfLen + t;
  const obstacles: BuiltRow["obstacles"] = [];
  if (two) {
    obstacles.push({ shape: segmentObstacle(g.left + 0.25 * g.W, cy, halfLen, phase, opts), role: "spinner", phase, omega });
    obstacles.push({ shape: segmentObstacle(g.left + 0.75 * g.W, cy, halfLen, phase + Math.PI / 2, { ...opts, angularVelocity: -omega }), role: "spinner", phase: phase + Math.PI / 2, omega: -omega });
  } else {
    obstacles.push({ shape: segmentObstacle(g.left + 0.5 * g.W, cy, halfLen, phase, opts), role: "spinner", phase, omega });
  }
  return { kind: "spinner", height: 2 * (halfLen + t), obstacles, pads: [], zone: null };
}

function buildSwap(top: number, g: Geometry, final = false): BuiltRow {
  const h = SWAP_HEIGHT * g.S;
  return { kind: "swap", height: h, obstacles: [], pads: [], zone: { y0: top, y1: top + h, final } };
}

/** One wide pad at a seeded place, or two narrower ones near the walls. */
function buildTurbo(top: number, g: Geometry, random: () => number): BuiltRow {
  const h = TURBO_HEIGHT * g.S;
  const pads: BuiltRow["pads"] = [];
  if (random() < 0.5) {
    const pw = 0.42 * g.W;
    const x0 = g.left + random() * (g.W - pw);
    pads.push({ x0, x1: x0 + pw, y0: top, y1: top + h, final: false });
  } else {
    const pw = 0.3 * g.W;
    const a = g.left + (0.04 + 0.1 * random()) * g.W;
    const b = g.right - pw - (0.04 + 0.1 * random()) * g.W;
    pads.push({ x0: a, x1: a + pw, y0: top, y1: top + h, final: false }, { x0: b, x1: b + pw, y0: top, y1: top + h, final: false });
  }
  return { kind: "turbo", height: h, obstacles: [], pads, zone: null };
}

function buildFinalStrip(top: number, g: Geometry): BuiltRow {
  const h = TURBO_HEIGHT * g.S;
  return { kind: "turbo", height: h, obstacles: [], pads: [{ x0: g.left, x1: g.right, y0: top, y1: top + h, final: true }], zone: null };
}

/** Two or three pinball bumpers that kick a racer away. */
function buildBumpers(top: number, g: Geometry, random: () => number): BuiltRow {
  const h = BUMPER_ROW_HEIGHT * g.S;
  const br = Math.max(1.5 * g.r, 0.03 * g.S);
  const obstacles: BuiltRow["obstacles"] = [];
  const add = (fx: number, y: number) => obstacles.push({ shape: circleObstacle(g.left + fx * g.W, y, br, BUMPER), role: "bumper", phase: 0, omega: 0 });
  if (random() < 0.5) {
    const j = random();
    add(0.3 + 0.08 * j, top + br);
    add(0.7 - 0.08 * j, top + h - br);
  } else {
    add(0.25, top + br);
    add(0.75, top + br);
    add(0.5, top + h - br);
  }
  return { kind: "bumpers", height: h, obstacles, pads: [], zone: null };
}

/** A shallow wall across the corridor with one or two openings barely wider than a racer (jams!). */
function buildGate(top: number, g: Geometry, random: () => number): BuiltRow {
  const h = GATE_HEIGHT * g.S;
  const t = armThickness(g);
  const ow = Math.max(4 * g.r, 0.065 * g.S);
  const y0 = top + t / 2;
  const y1 = y0 + h;
  const opts = { thickness: t, ...ARM };
  const obstacles: BuiltRow["obstacles"] = [];
  const arm = (x1: number, ya: number, x2: number, yb: number) => obstacles.push({ shape: segmentBetween(x1, ya, x2, yb, opts), role: "arm", phase: 0, omega: 0 });
  if (random() < 0.6) {
    const ox = g.left + 0.15 * g.W + ow / 2 + random() * Math.max(0, 0.7 * g.W - ow);
    arm(g.left, y0, ox - ow / 2, y1);
    arm(g.right, y0, ox + ow / 2, y1);
  } else {
    const o1 = g.left + (0.2 + 0.1 * random()) * g.W;
    const o2 = g.right - (0.2 + 0.1 * random()) * g.W;
    const mid = (o1 + o2) / 2;
    arm(g.left, y0, o1 - ow / 2, y1);
    arm(mid, y0, o1 + ow / 2, y1);
    arm(mid, y0, o2 - ow / 2, y1);
    arm(g.right, y0, o2 + ow / 2, y1);
  }
  return { kind: "gate", height: h + t, obstacles, pads: [], zone: null };
}

function buildRow(kind: RaceRowKind, top: number, g: Geometry, random: () => number): BuiltRow {
  switch (kind) {
    case "pegs":
      return buildPegs(top, g, random);
    case "funnel":
      return buildFunnel(top, g, random);
    case "spinner":
      return buildSpinner(top, g, random);
    case "swap":
      return buildSwap(top, g);
    case "turbo":
      return buildTurbo(top, g, random);
    case "bumpers":
      return buildBumpers(top, g, random);
    case "gate":
      return buildGate(top, g, random);
  }
}

/* ------------------------------------------------------------------ the track */

function cloneObstacle(o: Obstacle, dy: number): Obstacle {
  return { ...o, y: o.y + dy };
}

/**
 * Builds the whole track for a canvas of `width` × `height` with racers of the Ball Size `ballRadius`. `random` is the
 * engine's seeded generator (see the module comment for the order the numbers are drawn in).
 */
export function buildRaceTrack(width: number, height: number, settingsIn: Partial<RaceTrackSettings>, ballRadius: number, random: () => number, unlimited = false): RaceTrack {
  const settings = resolveRaceTrackSettings(settingsIn, unlimited); // --- unlimited --- (as the mode resolved them)
  const field = buildRaceField(width, height);
  const S = field.size;
  const left = field.left + TRACK_X0 * S;
  const right = field.left + TRACK_X1 * S;
  const W = right - left;
  const r = racerRadius(ballRadius, S);
  const g: Geometry = { S, left, right, W, r };
  const yStart = field.top + START_Y * S;
  const L = settings.trackLength * S;

  // The start grid: up to eight racers a row, front row just above the gate; the racers draw their slots.
  const n = settings.racers;
  const perRow = Math.min(n, GRID_PER_ROW);
  const gridRows = Math.ceil(n / perRow);
  const cell = W / perRow;
  const grid: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / perRow);
    const col = k % perRow;
    const inRow = Math.min(perRow, n - row * perRow);
    grid.push({ x: left + W / 2 + (col - (inRow - 1) / 2) * cell, y: yStart - (0.055 + row * GRID_ROW_PITCH) * S });
  }
  const gridOrder = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    const k = gridOrder[i];
    gridOrder[i] = gridOrder[j];
    gridOrder[j] = k;
  }
  const startX = new Array<number>(n).fill(0);
  const startY = new Array<number>(n).fill(0);
  gridOrder.forEach((racer, slot) => {
    startX[racer] = grid[slot].x;
    startY[racer] = grid[slot].y;
  });

  // One lap's rows (relative to the lap's start), then the final sector.
  const lapRows: BuiltRow[] = [];
  const lapTops: number[] = [];
  const kindCounts = Object.fromEntries(RACE_ROW_KINDS.map((k) => [k, 0])) as Record<RaceRowKind, number>;
  const limit = L - (FINAL_ZONE_BEFORE + MIN_ROW_GAP) * S;
  let y = FIRST_ROW_GAP * S;
  let previous: RaceRowKind | null = null;
  for (;;) {
    const kind = pickRowKind(settings.feature, previous, random());
    const gap = (MIN_ROW_GAP + ROW_GAP_SPREAD * random()) * S;
    const built = buildRow(kind, y, g, random);
    if (y + built.height > limit) break;
    lapRows.push(built);
    lapTops.push(y);
    kindCounts[kind]++;
    previous = kind;
    y += built.height + gap;
  }
  const finalCount = lapRows.length;
  lapRows.push(buildSwap(L - FINAL_ZONE_BEFORE * S, g, true));
  lapTops.push(L - FINAL_ZONE_BEFORE * S);
  lapRows.push(buildFinalStrip(L - FINAL_STRIP_BEFORE * S, g));
  lapTops.push(L - FINAL_STRIP_BEFORE * S);

  // Every lap gets its own copy of the rows (own obstacles, pads and swap state), offset by the lap length.
  const rows: RaceRow[] = [];
  const obstacles: RaceObstacle[] = [];
  const pads: RacePad[] = [];
  const zones: RaceSwapZone[] = [];
  const spinners: RaceObstacle[] = [];
  for (let lap = 0; lap < settings.laps; lap++) {
    const dy = yStart + lap * L;
    lapRows.forEach((built, j) => {
      const index = rows.length;
      const top = dy + lapTops[j];
      const row: RaceRow = { index, lap, kind: built.kind, top, bottom: top + built.height, final: j >= finalCount, obstacles: [], pads: [], zone: null };
      for (const o of built.obstacles) {
        const ob: RaceObstacle = { shape: cloneObstacle(o.shape, dy), role: o.role, row: index, phase: o.phase, omega: o.omega, lastHitMs: -Infinity, lastRacer: -1 };
        row.obstacles.push(ob);
        obstacles.push(ob);
        if (ob.role === "spinner") spinners.push(ob);
      }
      for (const p of built.pads) {
        const pad: RacePad = { x0: p.x0, x1: p.x1, y0: p.y0 + dy, y1: p.y1 + dy, row: index, final: p.final, used: 0, lastAtMs: -Infinity, lastRacer: -1 };
        row.pads.push(pad);
        pads.push(pad);
      }
      if (built.zone) {
        const z = built.zone;
        const zone: RaceSwapZone = { y0: z.y0 + dy, y1: z.y1 + dy, y: (z.y0 + z.y1) / 2 + dy, row: index, lap, final: z.final, first: -1, used: false, a: -1, b: -1, atMs: -Infinity };
        row.zone = zone;
        zones.push(zone);
      }
      rows.push(row);
    });
  }
  const finishY = yStart + settings.laps * L;
  const ceilingY = yStart - (0.055 + gridRows * GRID_ROW_PITCH + 0.02) * S;
  return {
    field,
    left,
    right,
    width: W,
    racerRadius: r,
    yStart,
    lapLength: L,
    laps: settings.laps,
    finishY,
    floorY: finishY + RUNOFF * S,
    ceilingY: Math.min(ceilingY, field.top + 0.01 * S),
    rows,
    obstacles,
    pads,
    zones,
    spinners,
    grid,
    gridOrder,
    startX,
    startY,
    rowsPerLap: lapRows.length,
    kindCounts,
    featured: settings.feature === "mixed" ? null : FEATURE_ROW_KIND[settings.feature],
  };
}

/** Index of the first row whose bottom is at or below world y `y` (rows are sorted top-down and never overlap). */
export function firstRowFrom(rows: readonly RaceRow[], y: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].bottom < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sets every spinner's angle for simulation time `tSec` (analytic: phase + ω·t, so any step size gives the same angle). */
export function setSpinnerAngles(track: RaceTrack, tSec: number) {
  for (const o of track.spinners) {
    const shape = o.shape as SegmentObstacle;
    let a = o.phase + o.omega * tSec;
    a -= Math.floor((a + Math.PI) / (2 * Math.PI)) * 2 * Math.PI;
    shape.angle = a;
  }
}

/** Which row kind a track features most outside its final sectors (the featured one, else the most common), for the automatic cup title. */
export function dominantRowKind(track: Pick<RaceTrack, "kindCounts" | "featured">): RaceRowKind {
  if (track.featured) return track.featured;
  let best: RaceRowKind = "pegs";
  for (const kind of RACE_ROW_KINDS) if (track.kindCounts[kind] > track.kindCounts[best]) best = kind;
  return best;
}
