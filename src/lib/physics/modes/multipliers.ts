import { midiToFrequency } from "@/lib/audio/scales";
import { applyMultiplier, copyMultipliers, effectiveBounce, effectiveCap, hitDamage, resolveMultiplierConfig, type MultiplierStat } from "../multipliers";
import { circleObstacle, resolveBallObstacle, segmentBetween, segmentObstacle, type Obstacle } from "../obstacles";
import { SpatialHash, createPairBuffer, type PairBuffer } from "../spatialHash";
import type { Ball, GameMode, ModeContext } from "../types";

/**
 * Multipliers ("multipliers" mode, the geraldbounces "Gerald uses the multipliers to get home" format): a tall vertical
 * board the camera scrolls down with the lowest ball. Balls fall through rows of gates, each row split into 2–4 slots
 * labelled with what they do to every ball passing through:
 *  - count gates x2 / x3 / x5 clone the ball (clones inherit its velocity with a small seeded spread and its
 *    multipliers; never more than `maxBalls` in play; from `COUNT_GATES_CLOSE_MS` on they stop cloning, so the board drains),
 *  - speed x1.5 / x2, size x1.25 / x1.5 and damage x2 gates stack a stat multiplier (multipliers.ts – uncapped by
 *    default),
 *  - reverse gates ÷2 absorb every second ball that passes,
 *  - release gates hold the balls on a door that opens every 1.2–2.2 s, so a batch goes through in a burst;
 * plus splitter pegs over the dividers, bumpers that kick, funnels off the side walls and blockers – tilted bars with
 * hit points that the balls' damage wears down (a damage gate makes that faster). At the bottom a HOME zone counts the
 * arrivals; the run ends when every ball is home or lost ("N Gerald made it home"), or when a ball grew wider than the
 * board – or, the last ball in play, grew too big to get through and is stuck for good – (OUTGREW THE ARENA).
 *
 * The balls are ordinary engine balls (gravity, drag, wind, pause, playback speed, recording all work). The board is
 * private to the mode – thousands of balls against every obstacle would not fit the frame budget – so the mode resolves
 * each ball only against the obstacles of the rows it overlaps (bands, reusing the collision maths of obstacles.ts) in
 * `onBallStep()`, and the ball-to-ball collisions with the spatial hash of the Collision Playground (spatialHash.ts) in
 * `onPostSubStep()`. Gate passes are collected during the sub-steps and applied at the end of the step, so the engine's
 * adaptive sub-stepping (multipliers.ts) always plans for the speeds a step runs with. Everything random – the layout,
 * the start, the clone spread, the nudges of a stuck ball – comes from `ctx.random()`, so a seed replays exactly (and
 * the finder can search for a seed whose final count is within 5 % of `target`).
 */

export const GATE_KINDS = ["count", "speed", "size", "damage", "reverse", "release"] as const;
export type GateKind = (typeof GATE_KINDS)[number];

export interface MultipliersSettings {
  /** Rows of gates, 4–20. */
  rows: number;
  /** Weights (one digit 0–9 each) of count, speed, size, damage, reverse and release gates, e.g. "421111". */
  gateMix: string;
  /** Balls released at the top, 1–10. */
  startBalls: number;
  /** Most balls in play at once (count gates stop cloning there), 50–2000. */
  maxBalls: number;
  /** Rigging: the finder searches for a seed whose final count is within 5 % of this (0 = off, search by duration). */
  target: number;
}

export const DEFAULT_GATE_MIX = "421111";

export const DEFAULT_MULTIPLIERS_SETTINGS: MultipliersSettings = {
  rows: 8,
  gateMix: DEFAULT_GATE_MIX,
  startBalls: 1,
  maxBalls: 500,
  target: 0,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const MULTIPLIERS_RANGES = {
  mpRows: { min: 4, max: 20, step: 1 },
  mpStartBalls: { min: 1, max: 10, step: 1 },
  mpMaxBalls: { min: 50, max: 2000, step: 50 },
  mpTarget: { min: 0, max: 5000, step: 5 },
} as const;

/** The multipliers-board fields of the SimulatorSettings object (URL keys mprw, mpgm, mpsb, mpmb, mptg). */
export interface MultipliersSettingFields {
  mpRows: number;
  mpGateMix: string;
  mpStartBalls: number;
  mpMaxBalls: number;
  mpTarget: number;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Six weight digits (missing ones 0, extra characters dropped); a mix without any weight falls back to the default. */
export function sanitizeGateMix(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_GATE_MIX;
  const digits = value.replace(/[^0-9]/g, "").slice(0, GATE_KINDS.length).padEnd(GATE_KINDS.length, "0");
  return /[1-9]/.test(digits) ? digits : DEFAULT_GATE_MIX;
}

/** The weight of every gate kind in a (sanitized) mix. */
export function parseGateMix(value: string): Record<GateKind, number> {
  const mix = sanitizeGateMix(value);
  const out = {} as Record<GateKind, number>;
  GATE_KINDS.forEach((kind, i) => (out[kind] = Number(mix[i])));
  return out;
}

/** Fills in the defaults and clamps every value (counts become whole numbers; a bad mix falls back to the default). */
export function resolveMultipliersSettings(config: Partial<MultipliersSettings> | null | undefined): MultipliersSettings {
  const out = { ...DEFAULT_MULTIPLIERS_SETTINGS };
  if (!config) return out;
  if (config.rows !== undefined) out.rows = Math.round(clampNumber(config.rows, MULTIPLIERS_RANGES.mpRows, out.rows));
  if (config.gateMix !== undefined) out.gateMix = sanitizeGateMix(config.gateMix);
  if (config.startBalls !== undefined) out.startBalls = Math.round(clampNumber(config.startBalls, MULTIPLIERS_RANGES.mpStartBalls, out.startBalls));
  if (config.maxBalls !== undefined) out.maxBalls = Math.round(clampNumber(config.maxBalls, MULTIPLIERS_RANGES.mpMaxBalls, out.maxBalls));
  if (config.target !== undefined) out.target = Math.round(clampNumber(config.target, MULTIPLIERS_RANGES.mpTarget, out.target));
  return out;
}

/** Picks the board settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setMultipliersSettings()`. */
export function multipliersSettingsOf(source: MultipliersSettingFields): MultipliersSettings {
  return { rows: source.mpRows, gateMix: source.mpGateMix, startBalls: source.mpStartBalls, maxBalls: source.mpMaxBalls, target: source.mpTarget };
}

/** Writes resolved board settings back into the SimulatorSettings field names. */
export function multipliersSettingFields(settings: MultipliersSettings): MultipliersSettingFields {
  return { mpRows: settings.rows, mpGateMix: settings.gateMix, mpStartBalls: settings.startBalls, mpMaxBalls: settings.maxBalls, mpTarget: settings.target };
}

/** The finder's tolerance for a count target: 5 % of it (at least one ball). */
export function countTolerance(target: number): number {
  return Math.max(1, 0.05 * target);
}

/* ------------------------------------------------------------------ layout (normalised: 1 = the side of the recorded square) */

export interface GateSpec {
  kind: GateKind;
  /** x2 / x3 / x5 for count gates, the stat factor for speed / size / damage, 2 for ÷2, 1 for a release gate. */
  factor: number;
  /** Release gates: seconds between openings, how long the door stays open, and the phase offset. */
  period: number;
  openFor: number;
  phase: number;
}

export interface RowSpec {
  slots: number;
  gates: GateSpec[];
  /** A slot roofed by a tilted blocker with hit points (null: none). */
  blocker: { slot: number; angle: number; hp: number } | null;
  /** Bumpers, in board units (x across the board 0–1, dy above the gate line in row gaps). */
  bumpers: { x: number; dy: number }[];
  /** Funnels off both side walls. */
  funnel: boolean;
}

export interface BoardLayout {
  rows: RowSpec[];
}

/** Board geometry in units of the recorded square's side. */
export const BOARD_WIDTH = 0.9;
export const ROW_GAP = 0.36;
export const FIRST_GATE = 0.5;
export const START_Y = 0.12;
export const HOME_BELOW_LAST = 0.27;
export const HOME_DEPTH = 0.2;
/** Height of the dividers above a gate line, in row gaps. */
export const DIVIDER_HEIGHT = 0.2;
export const PEG_RADIUS = 0.012;
export const BUMPER_RADIUS = 0.024;

function pickWeighted(weights: Record<GateKind, number>, u: number): GateKind {
  let total = 0;
  for (const k of GATE_KINDS) total += weights[k];
  let x = u * total;
  for (const k of GATE_KINDS) {
    x -= weights[k];
    if (x < 0 && weights[k] > 0) return k;
  }
  for (let i = GATE_KINDS.length - 1; i >= 0; i--) if (weights[GATE_KINDS[i]] > 0) return GATE_KINDS[i];
  return "count";
}

/** The factor a gate of `kind` gets from a uniform draw. */
export function gateFactor(kind: GateKind, u: number): number {
  switch (kind) {
    case "count":
      return u < 0.5 ? 2 : u < 0.83 ? 3 : 5;
    case "speed":
      return u < 0.5 ? 1.5 : 2;
    case "size":
      return u < 0.6 ? 1.25 : 1.5;
    case "damage":
    case "reverse":
      return 2;
    case "release":
      return 1;
  }
}

/** Draws a board from the seeded generator: slots, gate kinds (weighted by the mix) and factors, blockers, bumpers, funnels. */
export function generateBoardLayout(settings: MultipliersSettings, random: () => number): BoardLayout {
  const weights = parseGateMix(settings.gateMix);
  const rows: RowSpec[] = [];
  for (let r = 0; r < settings.rows; r++) {
    const slots = 2 + Math.min(2, Math.floor(random() * 3));
    const gates: GateSpec[] = [];
    for (let s = 0; s < slots; s++) {
      const kind = pickWeighted(weights, random());
      const factor = gateFactor(kind, random());
      const period = 1.2 + random();
      gates.push({ kind, factor, period, openFor: 0.35, phase: random() * period });
    }
    const blocker = slots >= 3 && random() < 0.35 ? { slot: Math.min(slots - 1, Math.floor(random() * slots)), angle: (random() < 0.5 ? -1 : 1) * 0.24, hp: 3 + Math.min(5, Math.floor(random() * 6)) } : null;
    const bumpers: { x: number; dy: number }[] = [];
    const nb = Math.floor(random() * 3);
    for (let b = 0; b < nb; b++) {
      const slot = Math.min(slots - 1, Math.floor(random() * slots));
      bumpers.push({ x: (slot + 0.5 + (random() - 0.5) * 0.4) / slots, dy: 0.55 + 0.15 * random() });
    }
    rows.push({ slots, gates, blocker, bumpers, funnel: random() < 0.5 });
  }
  return { rows };
}

/* ------------------------------------------------------------------ the board in pixels */

/** Obstacle kinds on the board (drawn differently, and some react to hits). */
export const OB_DIVIDER = 0;
export const OB_PEG = 1;
export const OB_BUMPER = 2;
export const OB_FUNNEL = 3;
export const OB_BLOCKER = 4;
export const OB_DOOR = 5;
export const OB_FLOOR = 6;

export interface Gate {
  row: number;
  slot: number;
  kind: GateKind;
  factor: number;
  x0: number;
  x1: number;
  y: number;
  period: number;
  openFor: number;
  phase: number;
  /** Obstacle index of a release gate's door (−1 otherwise). */
  door: number;
  /** The door is open now. */
  open: boolean;
  /** Balls that passed through, and the tick of the last one (for the flash). */
  passes: number;
  lastPassTick: number;
}

export interface Blocker {
  obstacle: number;
  gate: number;
  hp: number;
  maxHp: number;
  lastHitTick: number;
  broken: boolean;
}

export interface MultiplierBoard {
  /** Canvas the board was placed on and the recorded square inside it. */
  width: number;
  height: number;
  side: number;
  originX: number;
  originY: number;
  left: number;
  right: number;
  rowGap: number;
  dividerHeight: number;
  startY: number;
  /** Gate line of every row. */
  rowY: number[];
  homeY: number;
  floorY: number;
  /** Furthest the camera scrolls down. */
  cameraMax: number;
  gates: Gate[];
  /** First gate index of every row (gates of row r: rowGate[r] … rowGate[r + 1] − 1). */
  rowGate: number[];
  blockers: Blocker[];
  obstacles: Obstacle[];
  kind: Uint8Array;
  /** Gate (doors) or blocker (blockers) index of every obstacle, −1 otherwise. */
  ref: Int32Array;
  /** 0 = the obstacle is out of play (an open door, a broken blocker). */
  enabled: Uint8Array;
  /** Tick of the last hit (glow), −Infinity before. */
  hitTick: Float64Array;
  /** Scratch: the check an obstacle was last resolved in (an obstacle reaching into two bands is resolved once per sub-step). */
  stamp: Int32Array;
  /** Obstacles by band: band b covers (rowY[b] − rowGap, rowY[b]], the last band the home zone. */
  bandTop: number;
  bandStart: Int32Array;
  bandItems: Int32Array;
}

/** Lays a board out on a canvas of `width` × `height`: in the centred square the recorder crops to, extending downwards. */
export function placeBoard(layout: BoardLayout, width: number, height: number): MultiplierBoard {
  const side = Math.max(60, Math.min(width, height));
  const originX = width / 2 - side / 2;
  const originY = height / 2 - side / 2;
  const X = (u: number) => originX + u * side;
  const Y = (u: number) => originY + u * side;
  const left = X((1 - BOARD_WIDTH) / 2);
  const right = X((1 + BOARD_WIDTH) / 2);
  const bw = right - left;
  const rowGap = ROW_GAP * side;
  const dividerHeight = DIVIDER_HEIGHT * rowGap;
  const rowY: number[] = [];
  for (let r = 0; r < layout.rows.length; r++) rowY.push(Y(FIRST_GATE + r * ROW_GAP));
  const lastRow = rowY.length > 0 ? rowY[rowY.length - 1] : Y(FIRST_GATE);
  const homeY = lastRow + HOME_BELOW_LAST * side;
  const floorY = homeY + HOME_DEPTH * side;
  const obstacles: Obstacle[] = [];
  const kinds: number[] = [];
  const refs: number[] = [];
  const gates: Gate[] = [];
  const rowGate: number[] = [];
  const blockers: Blocker[] = [];
  const add = (o: Obstacle, kind: number, ref = -1) => {
    obstacles.push(o);
    kinds.push(kind);
    refs.push(ref);
    return obstacles.length - 1;
  };
  const pegR = Math.max(3, PEG_RADIUS * side);
  const bumperR = Math.max(6, BUMPER_RADIUS * side);
  for (let r = 0; r < layout.rows.length; r++) {
    const row = layout.rows[r];
    const gy = rowY[r];
    const sw = bw / row.slots;
    rowGate.push(gates.length);
    // Funnels off the side walls, near the top of the row.
    if (row.funnel) {
      add(segmentBetween(left, gy - 0.9 * rowGap, left + 0.13 * bw, gy - 0.74 * rowGap, { thickness: 4, restitution: 0.4, friction: 0.01 }), OB_FUNNEL);
      add(segmentBetween(right, gy - 0.9 * rowGap, right - 0.13 * bw, gy - 0.74 * rowGap, { thickness: 4, restitution: 0.4, friction: 0.01 }), OB_FUNNEL);
    }
    for (const b of row.bumpers) add(circleObstacle(left + b.x * bw, gy - b.dy * rowGap, bumperR, { restitution: 0.9, friction: 0 }), OB_BUMPER);
    for (let s = 0; s < row.slots; s++) {
      const spec = row.gates[s];
      const x0 = left + s * sw;
      const x1 = x0 + sw;
      const gate: Gate = { row: r, slot: s, kind: spec.kind, factor: spec.factor, x0, x1, y: gy, period: spec.period, openFor: spec.openFor, phase: spec.phase, door: -1, open: false, passes: 0, lastPassTick: -Infinity };
      gates.push(gate);
      if (s > 0) {
        add(segmentBetween(x0, gy - dividerHeight, x0, gy, { thickness: 3, restitution: 0.5, friction: 0.01 }), OB_DIVIDER);
        add(circleObstacle(x0, gy - dividerHeight - pegR - 0.02 * rowGap, pegR, { restitution: 0.6, friction: 0.01 }), OB_PEG);
      }
      if (spec.kind === "release") gate.door = add(segmentBetween(x0 + 2, gy - 4, x1 - 2, gy - 4, { thickness: 5, restitution: 0.3, friction: 0.05 }), OB_DOOR, gates.length - 1);
    }
    if (row.blocker) {
      const s = row.blocker.slot;
      const cx = left + (s + 0.5) * sw;
      const half = 0.58 * sw;
      const cy = gy - dividerHeight - 0.3 * rowGap;
      const blocker: Blocker = { obstacle: -1, gate: rowGate[r] + s, hp: row.blocker.hp, maxHp: row.blocker.hp, lastHitTick: -Infinity, broken: false };
      blocker.obstacle = add(segmentObstacle(cx, cy, half, row.blocker.angle, { thickness: 7, restitution: 0.35, friction: 0.01 }), OB_BLOCKER, blockers.length);
      blockers.push(blocker);
    }
  }
  add(segmentBetween(left, floorY, right, floorY, { thickness: 4, restitution: 0.3, friction: 0.05 }), OB_FLOOR);
  const n = obstacles.length;
  // Bands: (rowY[b] − rowGap, rowY[b]] for every row, then the home zone; an obstacle goes into every band it reaches.
  const bandTop = (rowY.length > 0 ? rowY[0] : homeY) - rowGap;
  const bands = rowY.length + 2;
  const lists: number[][] = Array.from({ length: bands }, () => []);
  const extent = (o: Obstacle): [number, number] => {
    if (o.kind === "circle") return [o.y - o.radius, o.y + o.radius];
    const dy = Math.abs(Math.sin(o.angle)) * o.halfLength + o.thickness;
    return [o.y - dy, o.y + dy];
  };
  for (let i = 0; i < n; i++) {
    const [y0, y1] = extent(obstacles[i]);
    const b0 = Math.max(0, Math.min(bands - 1, Math.floor((y0 - bandTop) / rowGap)));
    const b1 = Math.max(0, Math.min(bands - 1, Math.floor((y1 - bandTop) / rowGap)));
    for (let b = b0; b <= b1; b++) lists[b].push(i);
  }
  const bandStart = new Int32Array(bands + 1);
  for (let b = 0; b < bands; b++) bandStart[b + 1] = bandStart[b] + lists[b].length;
  const bandItems = new Int32Array(bandStart[bands]);
  for (let b = 0; b < bands; b++) bandItems.set(lists[b], bandStart[b]);
  const viewBottom = originY + side;
  return {
    width,
    height,
    side,
    originX,
    originY,
    left,
    right,
    rowGap,
    dividerHeight,
    startY: Y(START_Y),
    rowY,
    homeY,
    floorY,
    cameraMax: Math.max(0, floorY + 0.04 * side - viewBottom),
    gates,
    rowGate,
    blockers,
    obstacles,
    kind: Uint8Array.from(kinds),
    ref: Int32Array.from(refs),
    enabled: new Uint8Array(n).fill(1),
    hitTick: new Float64Array(n).fill(-Infinity),
    stamp: new Int32Array(n),
    bandTop,
    bandStart,
    bandItems,
  };
}

/** Whether a release door is open at simulation time `t` (seconds). */
export function doorOpenAt(gate: Pick<Gate, "period" | "openFor" | "phase">, t: number): boolean {
  if (!(gate.period > 0)) return true;
  const u = (((t + gate.phase) % gate.period) + gate.period) % gate.period;
  return u < gate.openFor;
}

/* ------------------------------------------------------------------ sound */

const PENTATONIC = [0, 2, 4, 7, 9];
/** Degrees of the plinko ladder across the board (C4 on the left wall … three octaves up on the right). */
export const BOARD_PITCH_DEGREES = 15;

/** Pitch of a hit at `u` across the board (0 = left wall, 1 = right wall): a C major pentatonic plinko piano from C4. */
export function boardPitch(u: number): number {
  const d = Math.max(0, Math.min(BOARD_PITCH_DEGREES - 1, Math.round(u * (BOARD_PITCH_DEGREES - 1))));
  return midiToFrequency(60 + 12 * Math.floor(d / 5) + PENTATONIC[d % 5]);
}

/** The note of a count gate: x2 E5, x3 G5, x5 C6. */
export function countGatePitch(factor: number): number {
  return factor >= 5 ? 1046.5 : factor >= 3 ? 783.99 : 659.25;
}

/** Most notes (hits, gates, arrivals) one rendered frame may play; the most energetic win. */
export const MAX_SOUNDS_PER_FRAME = 10;
/** A contact slower than this (px/s) is a resting one: silent, and no damage to a blocker. */
export const HIT_SPEED = 40;
/** Restitution of ball-to-ball contacts (piles on the doors settle). */
export const BALL_RESTITUTION = 0.35;
export const WALL_RESTITUTION = 0.6;
/** Extra speed (px/s) a bumper adds along its normal. */
export const BUMPER_KICK = 140;
/** A ball that has not got lower for this long gets a seeded nudge; this long and it is lost. */
export const STUCK_NUDGE_MS = 2500;
export const STUCK_GIVEUP_MS = 15000;
/**
 * --- review fix (modes-gerald-odd) --- Closing time of the count gates (simulation ms): from then on they no longer clone, so
 * the board drains and the run ends. A crowded board (big balls up to a big ball cap, count gates only) otherwise refills
 * itself as fast as balls arrive and never finishes. It is the count search's horizon (finder.ts simulates a board for at
 * most max(its clip, 240 s)), so no run the finder or a recording uses changes; the ball cap itself stays as set.
 */
export const COUNT_GATES_CLOSE_MS = 240_000;

/* ------------------------------------------------------------------ the mode */

export interface MultipliersView {
  settings: MultipliersSettings;
  board: MultiplierBoard | null;
  /** How far the camera has scrolled down (px of world), eased toward the lowest ball. */
  cameraY: number;
  /** Balls that reached HOME, were absorbed by a ÷2 gate or got stuck for good. */
  home: number;
  absorbed: number;
  lost: number;
  clones: number;
  gatePasses: number;
  blockersBroken: number;
  /** Balls in play now and at most. */
  active: number;
  peak: number;
  /** Every ball is home or gone (the run is over). */
  done: boolean;
  doneTick: number;
  /** Tick of the last arrival (the HOME flash). */
  homeTick: number;
  tick: number;
  tickMs: number;
  generation: number;
}

interface GateEvent {
  ball: Ball;
  gate: number;
}

const EMPTY_F64 = new Float64Array(0);
const EMPTY_I32 = new Int32Array(0);

export class MultipliersMode implements GameMode {
  readonly name = "multipliers";
  /** Balls fall, pile on doors and come to rest (no slow-ball boost). */
  readonly ballsMayRest = true;
  /** The mode resolves ball-to-ball collisions itself with a spatial hash (no O(n²) engine pair loop). */
  readonly ballsPassThrough = true;
  private settings: MultipliersSettings = { ...DEFAULT_MULTIPLIERS_SETTINGS };
  private layout: BoardLayout = { rows: [] };
  private readonly view: MultipliersView = {
    settings: { ...DEFAULT_MULTIPLIERS_SETTINGS },
    board: null,
    cameraY: 0,
    home: 0,
    absorbed: 0,
    lost: 0,
    clones: 0,
    gatePasses: 0,
    blockersBroken: 0,
    active: 0,
    peak: 0,
    done: false,
    doneTick: -Infinity,
    homeTick: -Infinity,
    tick: 0,
    tickMs: 0,
    generation: 0,
  };
  private ctx: ModeContext | null = null;
  // Per ball id: the last row passed, the lowest point reached, how long it has not got lower, and its state (0 in play, 1 home, 2 gone).
  private passed = new Int16Array(64);
  private lowest = new Float64Array(64);
  private stuck = new Float64Array(64);
  private state = new Uint8Array(64);
  private readonly events: GateEvent[] = [];
  private steps = 0;
  private subSec = 1 / 240;
  private hitSpeed = HIT_SPEED;
  private restitutionScale = 1;
  private ballSpeed = 400;
  private removals = 0;
  private checkStamp = 0;
  // Broad phase scratch.
  private readonly hash = new SpatialHash();
  private readonly pairs: PairBuffer = createPairBuffer(1024);
  private xs = EMPTY_F64;
  private ys = EMPTY_F64;
  private rs = EMPTY_F64;
  private idx = EMPTY_I32;
  // Per-frame sound budget.
  private readonly sndEnergy = new Float64Array(MAX_SOUNDS_PER_FRAME);
  private readonly sndFreq = new Float64Array(MAX_SOUNDS_PER_FRAME);
  private readonly sndLevel = new Float64Array(MAX_SOUNDS_PER_FRAME);
  private readonly sndAccent = new Uint8Array(MAX_SOUNDS_PER_FRAME);
  private readonly sndOrder = new Int32Array(MAX_SOUNDS_PER_FRAME);
  private sndCount = 0;
  /** The biggest stat total a gate stacked this frame (one arpeggio per frame), 0 = none. */
  private pendingArpeggio = 0;
  /** The highest stat any gate stacked so far this run (only a new record plays the arpeggio). */
  private recordStack = 1;

  getSettings(): MultipliersSettings {
    return this.settings;
  }
  /** Applied on the next init (the Simulator restarts the board when a board setting changes). */
  setSettings(patch: Partial<MultipliersSettings>) {
    this.settings = resolveMultipliersSettings({ ...this.settings, ...patch });
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): MultipliersView {
    return this.view;
  }
  getLayout(): BoardLayout {
    return this.layout;
  }
  getProgress() {
    const v = this.view;
    return { home: v.home, absorbed: v.absorbed, lost: v.lost, active: v.active, peak: v.peak, clones: v.clones, gatePasses: v.gatePasses, done: v.done, rows: v.settings.rows };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.ctx = ctx;
    const v = this.view;
    v.settings = { ...this.settings };
    v.generation++;
    v.cameraY = 0;
    v.home = 0;
    v.absorbed = 0;
    v.lost = 0;
    v.clones = 0;
    v.gatePasses = 0;
    v.blockersBroken = 0;
    v.done = false;
    v.doneTick = -Infinity;
    v.homeTick = -Infinity;
    v.tick = 0;
    v.tickMs = 0;
    this.steps = 0;
    this.sndCount = 0;
    this.pendingArpeggio = 0;
    this.recordStack = 1;
    this.events.length = 0;
    this.passed.fill(-1);
    this.lowest.fill(-Infinity);
    this.stuck.fill(0);
    this.state.fill(0);
    this.ballSpeed = ctx.config.ballSpeed || 400;
    this.layout = generateBoardLayout(this.settings, () => ctx.random());
    const board = placeBoard(this.layout, ctx.config.width, ctx.config.height);
    v.board = board;
    const n = this.settings.startBalls;
    const radius = ctx.config.ballRadius || 8;
    const bw = board.right - board.left;
    for (let k = 0; k < n; k++) {
      const x = board.left + bw * ((k + 0.5) / n) + (ctx.random() - 0.5) * 0.3 * (bw / n);
      ctx.addBall({
        x: Math.max(board.left + radius, Math.min(board.right - radius, x)),
        y: board.startY + (ctx.random() - 0.5) * 2 * radius,
        vx: (ctx.random() - 0.5) * 0.3 * this.ballSpeed,
        vy: 0.15 * this.ballSpeed,
        radius,
        color: ctx.config.ballColor || "#FFFFFF",
      });
    }
    v.active = n;
    v.peak = n;
    ctx.getMultipliers?.()?.markTouched();
  }

  /** Grows the per-id arrays to hold id `id` (doubling, so clones never allocate per frame). */
  private ensureId(id: number) {
    if (id < this.passed.length) return;
    let size = this.passed.length;
    while (size <= id) size *= 2;
    const passed = new Int16Array(size).fill(-1);
    passed.set(this.passed);
    const lowest = new Float64Array(size).fill(-Infinity);
    lowest.set(this.lowest);
    const stuck = new Float64Array(size);
    stuck.set(this.stuck);
    const state = new Uint8Array(size);
    state.set(this.state);
    this.passed = passed;
    this.lowest = lowest;
    this.stuck = stuck;
    this.state = state;
  }

  onPreUpdate(ctx: ModeContext) {
    const board = this.view.board;
    if (!board) return;
    this.ballSpeed = ctx.config.ballSpeed || 400;
    this.restitutionScale = ctx.getPhysicsExtras().wallBounciness;
    const g = ctx.config.gravity * (this.ballSpeed / 300);
    this.hitSpeed = Math.max(HIT_SPEED, 3 * g * this.subSec);
    // Release doors follow the simulation clock; an opening door plays a soft note. A door only closes once no ball is
    // half-way through it (a big ball takes longer to drop clear than the door's open time).
    const t = ctx.getElapsedMs() / 1000;
    for (let i = 0; i < board.gates.length; i++) {
      const gate = board.gates[i];
      if (gate.door < 0) continue;
      let open = doorOpenAt(gate, t);
      if (!open && gate.open && this.ballInDoor(ctx, board, gate)) open = true;
      if (open && !gate.open) this.offerSound(2e9, 392, 0.55, true);
      gate.open = open;
      board.enabled[gate.door] = open ? 0 : 1;
    }
  }

  /** A ball in play overlaps the line of the gate's door. */
  private ballInDoor(ctx: ModeContext, board: MultiplierBoard, gate: Gate): boolean {
    const doorY = gate.y - 4;
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.x < gate.x0 || b.x >= gate.x1) continue;
      if (Math.abs(b.y - doorY) < b.radius + 4 && (b.id >= this.state.length || this.state[b.id] === 0)) return true;
    }
    return false;
  }

  /** The engine moved the ball: side walls, the obstacles of the rows it overlaps, gate lines and the HOME line. */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    this.subSec = dtSec;
    this.view.tickMs = dtSec * 1000;
    const board = this.view.board;
    if (!board) return;
    const id = ball.id;
    this.ensureId(id);
    if (this.state[id] !== 0) return;
    const r = ball.radius;
    // Side walls.
    if (ball.x - r < board.left) {
      ball.x = board.left + r;
      if (ball.vx < 0) {
        const vn = -ball.vx;
        ball.vx = vn * WALL_RESTITUTION * this.restitutionScale;
        if (vn >= this.hitSpeed) this.offerSound(0.5 * vn * vn * r * r, boardPitch(0), level(vn, this.ballSpeed), false);
      }
    } else if (ball.x + r > board.right) {
      ball.x = board.right - r;
      if (ball.vx > 0) {
        const vn = ball.vx;
        ball.vx = -vn * WALL_RESTITUTION * this.restitutionScale;
        if (vn >= this.hitSpeed) this.offerSound(0.5 * vn * vn * r * r, boardPitch(1), level(vn, this.ballSpeed), false);
      }
    }
    // Obstacles of the bands the ball overlaps.
    const bands = board.bandStart.length - 1;
    const b0 = Math.max(0, Math.floor((ball.y - r - 2 - board.bandTop) / board.rowGap));
    const b1 = Math.min(bands - 1, Math.floor((ball.y + r + 2 - board.bandTop) / board.rowGap));
    const scale = this.restitutionScale * effectiveBounce(ball);
    const stamp = ++this.checkStamp;
    for (let b = b0; b <= b1; b++) {
      for (let k = board.bandStart[b]; k < board.bandStart[b + 1]; k++) {
        const i = board.bandItems[k];
        if (board.stamp[i] === stamp || board.enabled[i] === 0) continue;
        board.stamp[i] = stamp;
        const impact = resolveBallObstacle(ball, board.obstacles[i], dtSec, scale);
        if (impact < this.hitSpeed) continue;
        this.onHit(ctx, ball, i, impact);
      }
    }
    // Gate lines crossed downward.
    const prevY = ball.y - ball.vy * dtSec;
    if (ball.vy > 0 && board.rowY.length > 0) {
      const row = Math.ceil((prevY - board.rowY[0]) / board.rowGap);
      if (row >= 0 && row < board.rowY.length && row > this.passed[id]) {
        const gy = board.rowY[row];
        if (prevY < gy && ball.y >= gy) {
          this.passed[id] = row;
          const first = board.rowGate[row];
          const last = row + 1 < board.rowGate.length ? board.rowGate[row + 1] : board.gates.length;
          let gate = last - 1;
          for (let g = first; g < last; g++) {
            if (ball.x < board.gates[g].x1) {
              gate = g;
              break;
            }
          }
          this.events.push({ ball, gate });
        }
      }
    }
    // HOME.
    if (ball.y >= board.homeY) {
      this.state[id] = 1;
      this.removals++;
      const v = this.view;
      v.home++;
      v.homeTick = v.tick;
      this.offerSound(1e9, 1046.5, 0.45, false);
    }
  }

  /** A real hit on obstacle `i`: its glow, a plinko note, a bumper's kick, a blocker's lost hit points. */
  private onHit(ctx: ModeContext, ball: Ball, i: number, impact: number) {
    const board = this.view.board!;
    const tick = this.view.tick;
    board.hitTick[i] = tick;
    const o = board.obstacles[i];
    const kind = board.kind[i];
    const u = (o.x - board.left) / Math.max(1, board.right - board.left);
    this.offerSound(0.5 * impact * impact * ball.radius * ball.radius, boardPitch(u), level(impact, this.ballSpeed), false);
    if (kind === OB_BUMPER && o.kind === "circle") {
      const dx = ball.x - o.x;
      const dy = ball.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        ball.vx += (dx / d) * BUMPER_KICK;
        ball.vy += (dy / d) * BUMPER_KICK;
      }
    } else if (kind === OB_BLOCKER) {
      const blocker = board.blockers[board.ref[i]];
      if (!blocker || blocker.broken) return;
      blocker.hp -= hitDamage(ball);
      blocker.lastHitTick = tick;
      if (blocker.hp <= 0) {
        blocker.hp = 0;
        blocker.broken = true;
        board.enabled[i] = 0;
        this.view.blockersBroken++;
        ctx.spawnConfetti(o.x, o.y);
        ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
      }
    }
  }

  /** Ball-to-ball collisions of every ball in play (spatial hash, like the Collision Playground), then the side walls again. */
  onPostSubStep(ctx: ModeContext) {
    const v = this.view;
    v.tick++;
    const board = v.board;
    if (!board) return;
    const balls = ctx.getBalls();
    const m = balls.length;
    if (this.xs.length < m) {
      const size = Math.max(64, 2 * m);
      this.xs = new Float64Array(size);
      this.ys = new Float64Array(size);
      this.rs = new Float64Array(size);
      this.idx = new Int32Array(size);
    }
    const { xs, ys, rs, idx } = this;
    let n = 0;
    let maxR = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < m; i++) {
      const b = balls[i];
      if (b.id < this.state.length && this.state[b.id] !== 0) continue;
      xs[n] = b.x;
      ys[n] = b.y;
      rs[n] = b.radius;
      idx[n] = i;
      if (b.radius > maxR) maxR = b.radius;
      if (b.y < minY) minY = b.y;
      if (b.y > maxY) maxY = b.y;
      n++;
    }
    if (n < 2) return;
    const margin = Math.max(0.5, 0.2 * maxR);
    this.hash.build(xs, ys, n, 2 * maxR + margin, board.left - maxR, minY - maxR, board.right + maxR, maxY + maxR);
    const count = this.hash.collectContacts(xs, ys, rs, margin, this.pairs);
    if (count === 0) return;
    const pairs = this.pairs.pairs;
    for (let it = 0; it < 2; it++) {
      const forward = it === 0;
      for (let q = 0; q < count; q++) {
        const p = forward ? q : count - 1 - q;
        resolvePair(balls[idx[pairs[2 * p]]], balls[idx[pairs[2 * p + 1]]]);
      }
    }
    for (let k = 0; k < n; k++) {
      const b = balls[idx[k]];
      if (b.x - b.radius < board.left) b.x = board.left + b.radius;
      else if (b.x + b.radius > board.right) b.x = board.right - b.radius;
    }
  }

  /**
   * End of a 60 Hz step: the gate passes of the step (clones, stat multipliers, absorptions), arrivals leave the board,
   * stuck balls get a nudge, the camera follows the lowest ball and the run finishes once nothing is left in play.
   */
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const board = v.board;
    this.steps++;
    if (!board) return;
    const runtime = ctx.getMultipliers?.();
    const cap = effectiveCap(resolveMultiplierConfig(ctx.config));
    const maxBalls = v.settings.maxBalls;
    const balls = ctx.getBalls();
    // 1. Gate passes, in the order they happened.
    for (let e = 0; e < this.events.length; e++) {
      const { ball, gate: gi } = this.events[e];
      const gate = board.gates[gi];
      if (!gate || this.state[ball.id] !== 0) continue;
      gate.passes++;
      gate.lastPassTick = v.tick;
      v.gatePasses++;
      switch (gate.kind) {
        case "count": {
          if (ctx.getElapsedMs() >= COUNT_GATES_CLOSE_MS) break; // --- review fix (modes-gerald-odd) --- closing time: the board drains
          // Every generation of clones takes the next colour, so the crowd shows where it multiplied (and stays a few paths to draw).
          ball.color = nextCloneColor(ball.color);
          const copies = Math.round(gate.factor) - 1;
          let made = 0;
          for (let c = 0; c < copies; c++) {
            if (balls.length - this.removals >= maxBalls) break;
            this.cloneFrom(ctx, ball, gate.row);
            made++;
          }
          if (made > 0) this.offerSound(3e9 + gate.factor, countGatePitch(gate.factor), 0.8, gate.factor >= 5);
          break;
        }
        case "speed":
        case "size":
        case "damage": {
          const stat: MultiplierStat = gate.kind;
          if (runtime) runtime.apply(ball, stat, gate.factor);
          else applyMultiplier(ball, stat, gate.factor, cap);
          // The arpeggio marks a new record stack of the run (hundreds of passes would otherwise ring every frame).
          if (ball.mult && ball.mult[stat] > this.recordStack) {
            this.recordStack = ball.mult[stat];
            this.pendingArpeggio = Math.max(this.pendingArpeggio, ball.mult[stat]);
          }
          if (stat === "size") this.fitWidth(ctx, ball);
          break;
        }
        case "reverse":
          if (gate.passes % 2 === 0) {
            this.state[ball.id] = 2;
            this.removals++;
            v.absorbed++;
            this.offerSound(2.5e9, 261.63, 0.6, false);
          }
          break;
        case "release":
          break;
      }
    }
    this.events.length = 0;
    // A ball grown wider than the board (a size gate, or a multiplier from anywhere) outgrows the arena.
    const half = (board.right - board.left) / 2;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.mult && b.radius >= half && this.state[b.id] === 0) {
        this.fitWidth(ctx, b);
        return;
      }
    }
    // 2. Stuck balls: a nudge after a while, lost after much longer (a door-cup wait does not count).
    const t = ctx.getElapsedMs() / 1000;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const id = b.id;
      this.ensureId(id);
      if (this.state[id] !== 0) continue;
      if (b.y > this.lowest[id] + 1.5) {
        this.lowest[id] = b.y;
        this.stuck[id] = 0;
        continue;
      }
      // Waiting in a door's cup counts at a quarter of the rate (the door opens every couple of seconds; the stuck
      // limit is only a safety net that makes sure every run ends).
      this.stuck[id] += this.waitingAtDoor(board, b, t) ? dtMs / 4 : dtMs;
      // --- review fix (modes-gerald-odd) --- a ball grown by size gates wedges between the rows long before it is as wide as
      // the board: the last ball in play stuck for good that way has outgrown the board (the run ends with the celebration)
      // instead of silently vanishing. With other balls still in play it is lost as before, so a busy board is not cut short.
      if (this.stuck[id] >= STUCK_GIVEUP_MS && b.mult && b.mult.size > 1 && runtime && balls.length - this.removals === 1) {
        runtime.outgrow(ctx, b, half);
        b.x = (board.left + board.right) / 2;
        return;
      }
      if (this.stuck[id] >= STUCK_GIVEUP_MS) {
        this.state[id] = 2;
        this.removals++;
        v.lost++;
      } else if (this.stuck[id] >= STUCK_NUDGE_MS && !this.waitingAtDoor(board, b, t) && Math.floor((this.stuck[id] - dtMs) / 1000) !== Math.floor(this.stuck[id] / 1000)) {
        b.vx += (ctx.random() - 0.5) * 0.8 * this.ballSpeed;
        b.vy -= 0.3 * this.ballSpeed * (0.5 + ctx.random());
      }
    }
    // 3. Arrivals and absorbed balls leave the board (in-place compaction, no allocation).
    if (this.removals > 0) {
      let w = 0;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (b.id < this.state.length && this.state[b.id] !== 0) continue;
        balls[w++] = b;
      }
      balls.length = w;
      this.removals = 0;
    }
    v.active = balls.length;
    if (v.active > v.peak) v.peak = v.active;
    // 4. The camera follows the lowest ball (or settles on HOME once the board is empty).
    let lowestY = -Infinity;
    for (let i = 0; i < balls.length; i++) if (balls[i].y > lowestY) lowestY = balls[i].y;
    const viewTop = board.originY;
    const target = balls.length === 0 ? board.cameraMax : Math.max(0, Math.min(board.cameraMax, lowestY - viewTop - 0.62 * board.side));
    const ease = 1 - Math.exp((-3 * dtMs) / 1000);
    v.cameraY += (target - v.cameraY) * ease;
    // 5. The finish.
    if (!v.done && balls.length === 0) {
      v.done = true;
      v.doneTick = v.tick;
      ctx.spawnConfetti((board.left + board.right) / 2, board.homeY + 0.5 * (board.floorY - board.homeY));
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
    }
  }

  /** A ball waits on a closed release door (it is in the door's cup). */
  private waitingAtDoor(board: MultiplierBoard, ball: Ball, t: number): boolean {
    const row = this.passed[ball.id] + 1;
    if (row < 0 || row >= board.rowY.length) return false;
    const gy = board.rowY[row];
    if (ball.y > gy || ball.y < gy - board.dividerHeight - 6 * ball.radius) return false;
    const first = board.rowGate[row];
    const last = row + 1 < board.rowGate.length ? board.rowGate[row + 1] : board.gates.length;
    for (let g = first; g < last; g++) {
      const gate = board.gates[g];
      if (gate.door >= 0 && ball.x >= gate.x0 && ball.x < gate.x1) return !doorOpenAt(gate, t);
    }
    return false;
  }

  /** A clone of `ball` (a count gate): same size and multipliers, its velocity turned and scaled by a seeded spread. */
  private cloneFrom(ctx: ModeContext, ball: Ball, row: number) {
    const turn = (ctx.random() - 0.5) * 0.7;
    const scale = 0.9 + 0.2 * ctx.random();
    const c = Math.cos(turn) * scale;
    const s = Math.sin(turn) * scale;
    const offset = (ctx.random() - 0.5) * 2 * ball.radius;
    ctx.addBall({
      x: ball.x + offset,
      y: ball.y + 0.5 * ball.radius * ctx.random(),
      vx: ball.vx * c - ball.vy * s,
      vy: ball.vx * s + ball.vy * c,
      radius: ball.radius,
      color: ball.color,
      gravityScale: ball.gravityScale,
      radiusScale: ball.radiusScale,
      mult: copyMultipliers(ball.mult),
    });
    const balls = ctx.getBalls();
    const clone = balls[balls.length - 1];
    this.ensureId(clone.id);
    this.passed[clone.id] = row;
    this.lowest[clone.id] = clone.y;
    this.stuck[clone.id] = 0;
    this.state[clone.id] = 0;
    this.view.clones++;
    const board = this.view.board;
    if (board) clone.x = Math.max(board.left + clone.radius, Math.min(board.right - clone.radius, clone.x));
  }

  /** A grown ball keeps inside the side walls; wider than the board, it has outgrown the arena (the run ends). */
  private fitWidth(ctx: ModeContext, ball: Ball) {
    const board = this.view.board;
    if (!board) return;
    const half = (board.right - board.left) / 2;
    if (ball.radius >= half) {
      const runtime = ctx.getMultipliers?.();
      if (runtime) runtime.outgrow(ctx, ball, half);
      else ball.radius = half;
      ball.x = (board.left + board.right) / 2;
      return;
    }
    ball.x = Math.max(board.left + ball.radius, Math.min(board.right - ball.radius, ball.x));
  }

  /** Offers a note to the frame's budget: kept while there is room, else it replaces the weakest when it is more energetic. */
  private offerSound(energy: number, frequency: number, levelValue: number, accent: boolean) {
    let slot = this.sndCount;
    if (slot >= MAX_SOUNDS_PER_FRAME) {
      slot = 0;
      for (let i = 1; i < MAX_SOUNDS_PER_FRAME; i++) if (this.sndEnergy[i] < this.sndEnergy[slot]) slot = i;
      if (!(energy > this.sndEnergy[slot])) return;
    } else this.sndCount++;
    this.sndEnergy[slot] = energy;
    this.sndFreq[slot] = frequency;
    this.sndLevel[slot] = levelValue;
    this.sndAccent[slot] = accent ? 1 : 0;
  }

  /** Once per rendered frame (engine.consumeSoundEvents): at most `MAX_SOUNDS_PER_FRAME` notes, strongest first, and one arpeggio. */
  flushPendingSounds(ctx: ModeContext) {
    if (this.pendingArpeggio > 0) {
      ctx.addPendingSoundEvent({ type: "multiplier", wallIndex: 0, multiplier: this.pendingArpeggio });
      this.pendingArpeggio = 0;
    }
    const count = this.sndCount;
    if (count === 0) return;
    const order = this.sndOrder;
    for (let i = 0; i < count; i++) order[i] = i;
    for (let i = 1; i < count; i++) {
      const cur = order[i];
      let j = i - 1;
      while (j >= 0 && this.sndEnergy[order[j]] < this.sndEnergy[cur]) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = cur;
    }
    for (let i = 0; i < count; i++) {
      const slot = order[i];
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: this.sndFreq[slot], level: this.sndLevel[slot], accent: this.sndAccent[slot] === 1 || undefined });
    }
    this.sndCount = 0;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }

  /** A canvas resize places the same board on the new canvas and maps every ball onto it (undoing the engine's per-axis stretch). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    const old = this.view.board;
    if (!sizeChanged || !old) return true;
    const board = placeBoard(this.layout, ctx.config.width, ctx.config.height);
    // Keep the play state of the old board.
    for (let i = 0; i < board.gates.length && i < old.gates.length; i++) {
      board.gates[i].passes = old.gates[i].passes;
      board.gates[i].lastPassTick = old.gates[i].lastPassTick;
      board.gates[i].open = old.gates[i].open;
    }
    for (let i = 0; i < board.blockers.length && i < old.blockers.length; i++) {
      const b = board.blockers[i];
      b.hp = old.blockers[i].hp;
      b.broken = old.blockers[i].broken;
      if (b.broken) board.enabled[b.obstacle] = 0;
    }
    for (const gate of board.gates) if (gate.door >= 0) board.enabled[gate.door] = gate.open ? 0 : 1;
    const k = board.side / old.side;
    const sx = ctx.config.width / old.width;
    const sy = ctx.config.height / old.height;
    const oldCx = old.width / 2;
    const oldCy = old.height / 2;
    for (const ball of ctx.getBalls()) {
      // The engine already stretched the position per axis around the canvas centre: undo that, then map isotropically.
      const x = oldCx + (ball.x - ctx.config.width / 2) / (sx || 1);
      const y = oldCy + (ball.y - ctx.config.height / 2) / (sy || 1);
      ball.x = board.originX + (x - old.originX) * k;
      ball.y = board.originY + (y - old.originY) * k;
      this.lowest[ball.id] = board.originY + (this.lowest[ball.id] - old.originY) * k;
    }
    this.view.cameraY *= k;
    this.view.board = board;
    return true;
  }

  /** The board is resolved in onBallStep; there are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.done;
  }
  getState() {
    const v = this.view;
    return { home: v.home, active: v.active, clones: v.clones, absorbed: v.absorbed, lost: v.lost, done: v.done, tick: v.tick };
  }
}

/** Colours of the clone generations (a start ball keeps the Ball Colour until its first count gate). */
export const CLONE_COLORS = ["#93d119", "#22d3ee", "#a78bfa", "#f472b6", "#fbbf24", "#60a5fa", "#fb923c", "#34d399"];

/** The colour of the next clone generation after `color`. */
export function nextCloneColor(color: string): string {
  const i = CLONE_COLORS.indexOf(color);
  return CLONE_COLORS[(i + 1) % CLONE_COLORS.length];
}

/** Loudness of a hit note (0–1): soft for grazes, full for hard knocks. */
function level(impact: number, ballSpeed: number): number {
  const x = impact / (1.5 * Math.max(1, ballSpeed));
  return 0.35 * Math.max(0.25, Math.min(1, 0.25 + 0.75 * x)) + 0.1;
}

/** Two touching balls: push the overlap apart by inverse mass (mass ∝ radius²) and exchange momentum with a damped restitution. */
function resolvePair(a: Ball, b: Ball) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minD = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 1;
  const ny = d > 1e-9 ? dy / d : 0;
  const ima = 1 / (a.radius * a.radius);
  const imb = 1 / (b.radius * b.radius);
  const sum = ima + imb;
  const pen = minD - d;
  if (pen > 0.2) {
    const corr = ((pen - 0.2) * 0.8) / sum;
    a.x -= nx * corr * ima;
    a.y -= ny * corr * ima;
    b.x += nx * corr * imb;
    b.y += ny * corr * imb;
  }
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel >= 0) return;
  const j = (-(1 + BALL_RESTITUTION) * rel) / sum;
  a.vx -= j * ima * nx;
  a.vy -= j * ima * ny;
  b.vx += j * imb * nx;
  b.vy += j * imb * ny;
}
