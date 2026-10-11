import type { Ball, GameMode, LoopSeams, ModeContext } from "../types";
import { SpatialHash, createPairBuffer, type PairBuffer } from "../spatialHash";
import { POSITION_CORRECTION, POSITION_SLOP } from "./collide";
import { degreeToMidi } from "@/lib/audio/loopPitch";
import { LOOP_NOTES_PER_TICK, pluckVelocity } from "@/lib/audio/loopTones";
import { midiToFrequency } from "@/lib/audio/scales";
import { ENTITY_CEILING, atLeastMin, memoryCeiling } from "@/lib/uncap";

/*
 * --- colour-sort --- Colour Sort (the loop family's "colour-sorting rings", one-way colour gates): K concentric rings in a
 * closed circle – K − 1 gated rings and the outer wall – and K colours × N balls packed in the core. Every gated ring k is G
 * arcs and G gates of `gateWidth` degrees with a white pin at every arc end; it turns at ω_k = spin × falloff^k degrees a
 * second (alternating in direction). The balls move as a constant-speed gas (no gravity; elastic contacts between them, or
 * none with the ghost option) and the gates sort them:
 *
 *  - the arcs and the outer wall reflect every ball (a spinning arc reflects in its own frame: `reflectInMovingFrame()`);
 *  - a gate of ring k lets a ball through only by the rule (`gatePasses()`): outward and not of the ring's own colour (the
 *    reference), outward and only of its own colour, or both ways and not of its own colour; otherwise it reflects like an arc.
 *
 * With the reference rule the passages are one-way and monotone: colour c ends in band c (`targetBand()`) – red never leaves
 * the core, orange stops at the orange ring, green at the green one and blue reaches the outer band – so the balls sort
 * themselves into a bullseye. A ball counts as sorted while its centre is in its own band; the counter is that census.
 *
 * A rule that lets balls back in (both ways: `csSortSettles()`) cannot complete that sort: colour c passes inward through
 * every ring but its own, so a sorted ball wanders back into any band inside its own and the census settles at an equilibrium
 * (about 200 of the reference 360) – every ball home at once is a fluctuation that practically never comes for more than a
 * handful of balls. Under such a rule the sort also ends once it has settled (`settledCensus()`: the census's mean over the
 * last `CS_SETTLE_BLOCKS` × `CS_SETTLE_BLOCK_SEC` s no higher than over the same span before it) – on the minor chord, like a
 * time-out, since not every ball made it – so a cycle lasts ~20–40 s, not the whole time limit. The one-way rules end only
 * sorted or at the time limit (a stalled tail is still a sort to finish).
 *
 * The loop: when every ball is sorted (or the sort has settled, or at the sort's time limit) the completion chord plays; half
 * a second later the remix starts ("mixing again", `remix` s): the gates stop filtering, the contacts switch off and a
 * critically damped spring pulls every ball back to its own place of the frame-0 packing (`remixOffset()`, exact at the
 * remix's end), while each ring is eased onto an angle its gates repeat at (a whole number of gate periods from its frame-0
 * angle). At the seam – the first step at or after the remix's end – every ball takes its frame-0 place and launch velocity
 * again and the rings their frame-0 angles: the state is the run's first frame, so the next cycle replays the first exactly
 * and a recording of whole cycles loops without a seam (the loop contract: `cycleSeconds()`, `loopSeams()`). All times are
 * on the simulation clock.
 *
 * Units: sizes and speeds are given in px of the 720 × 1280 reference clip, whose outer ring is `CS_REF_RING` (304) px – the
 * arena is drawn at `CS_ARENA_FACTOR` of the shorter world side, so the look is the same at every size.
 *
 * Determinism: every random choice is `ctx.random()` at init, in this order – each gated ring's gate phase (ring 0 outward),
 * then the colours' shuffle (Fisher–Yates over the balls, last to first), then every ball's packing jitter (x, y) and launch
 * direction (ball 0 onward). Nothing random happens after init: every cycle replays the first. The physics runs in
 * `onPostSubStep()` (the engine moves the balls; the mode resolves the rings, the pins, the contacts and the speed), so the
 * engine's own walls and pair pass are off (`shouldSkipWallCollision()`, `ballsPassThrough`).
 *
 * Sound (the loop sound library, `ToneGenerator.playLoop()`): every gate pass a pentatonic pluck at its colour's fixed degree
 * of A major pentatonic (`colourSortPitch()`; at most `LOOP_NOTES_PER_TICK` colours a step, a colour's passes of a step in one
 * note at √n), the completion the chord on A2 with its 1.7 Hz tremolo, ding and sub (minor when the time limit or the
 * equilibrium ended the sort), the remix a noise wash over its length, and the seam the loop voices' hard cut.
 */

export const CS_RULES = ["outwardNotOwn", "outwardOwnOnly", "bothWaysNotOwn"] as const;
export type CsRule = (typeof CS_RULES)[number];
export type CsPhase = "sort" | "hold" | "remix";
/** How the cycle's sort ended ("" while it runs): every ball sorted, settled at its equilibrium (a rule that lets balls back in), or at the time limit. */
export type CsEnd = "" | "sorted" | "settled" | "limit";

export function isCsRule(value: unknown): value is CsRule {
  return typeof value === "string" && (CS_RULES as readonly string[]).includes(value);
}

/** What the engine runs (the page's settings resolved; lib/physics/colourSortSettings.ts holds the settings side). */
export interface ColourSortSettings {
  /** Colours – and rings: K − 1 gated rings and the outer wall (≥ 2). */
  colours: number;
  /** Balls of every colour (≥ 1). */
  perColour: number;
  /** Gates of every gated ring (≥ 1). */
  gates: number;
  /** A gate's angular width (degrees, > 0; a gate as wide as its period leaves no arc: the ring is all gate). */
  gateWidth: number;
  /** The innermost ring's spin (degrees a second; ≥ 0), × `falloff` per ring outward, alternating in direction when `alternate`. */
  spin: number;
  falloff: number;
  alternate: boolean;
  /** The balls' speed (px/s) and radius (px), both in px of the reference clip (the outer ring `CS_REF_RING` px). */
  speed: number;
  size: number;
  /** Elastic contacts between the balls (off: the ghost gas, every ball alone with the rings – the cheap way for thousands). */
  collisions: boolean;
  /** Seconds the remix (the pull back into the frame-0 packing) lasts (≥ 0; 0 snaps back at once). */
  remix: number;
  /** Which balls a gate lets through, which way. */
  rule: CsRule;
  /** The sort's time limit (s): the remix starts when every ball is sorted (or the sort has settled) or this long into the cycle. */
  limit: number;
  /** Render-only: a short flash where a ring refuses a ball. */
  flashes: boolean;
}

export const DEFAULT_COLOUR_SORT: Readonly<ColourSortSettings> = {
  colours: 4,
  perColour: 90,
  gates: 4,
  gateWidth: 35,
  spin: 31,
  falloff: 0.8,
  alternate: true,
  speed: 220,
  size: 4.5,
  collisions: false,
  remix: 2.8,
  rule: "outwardNotOwn",
  limit: 60,
  flashes: false,
};

/** The comfort ranges (the sliders' tracks; every value from the minimum up is valid – uncapped). Keyed by the settings' fields. */
export const COLOUR_SORT_RANGES = {
  csColours: { min: 2, max: 8, step: 1 },
  csPerColour: { min: 1, max: 500, step: 1 },
  csGates: { min: 1, max: 12, step: 1 },
  csGateWidth: { min: 5, max: 180, step: 1 },
  csSpin: { min: 0, max: 360, step: 1 },
  csFalloff: { min: 0, max: 2, step: 0.05 },
  csSpeed: { min: 20, max: 2000, step: 10 },
  csSize: { min: 1, max: 30, step: 0.5 },
  csRemix: { min: 0, max: 10, step: 0.1 },
  csLimit: { min: 1, max: 300, step: 1 },
} as const;

/** The outer ring's radius in the reference clip (px of a 720-wide frame): the unit of the size and speed settings. */
export const CS_REF_RING = 304;
/** The outer ring's radius as a share of half the world's shorter side (304 of 360 in the reference clip). */
export const CS_ARENA_FACTOR = CS_REF_RING / 360;
/** The rings' stroke (reference px): the half of it is the arcs' collision margin and the pins' radius. */
export const CS_RING_STROKE = 4;
/** How much a spinning arc grips a ball it reflects (0 = a mirror): the ball is dragged a little along the ring's turn. */
export const CS_ARC_GRIP = 0.25;
/** The solid dot's share of a ball's size (its glow is the rest): the balls touch each other and the rings at the dot. */
export const CS_BODY_SHARE = 0.5;
/** The contact grid has at most this many cells a side (a coarser grid than the contact distance only adds candidates). */
const CS_GRID_CELLS = 64;
/** Passes of the contact solver per sub-step (a dilute gas needs fewer than Collide's piles). */
const CS_CONTACT_PASSES = 2;
/** Seconds between the completion and the remix (the chord blooms over a still bullseye). */
export const CS_HOLD_SEC = 0.5;
/** ω0 · T of the remix's critically damped spring: what is left of a displacement at its end is under a pixel. */
export const CS_REMIX_STIFFNESS = 8;
/** The speed governor's time constant (s): every ball's speed relaxes toward the set speed (a constant-speed gas). */
export const CS_SPEED_TAU = 0.3;
/** The most balls one run holds (all colours together): past it every colour holds `floor(CS_BALL_CEILING / colours)`. */
export const CS_BALL_CEILING = 20_000;
/** The most balls of a colour (two colours of them fill `CS_BALL_CEILING`; `MEMORY_CEILINGS.csPerColour`). */
export const CS_PER_COLOUR_CEILING = CS_BALL_CEILING / 2;
/** The most colours (rings) and gates a run builds (what a frame still draws; `MEMORY_CEILINGS.csColours`, `.csGates`). */
export const CS_COLOUR_CEILING = ENTITY_CEILING;
export const CS_GATE_CEILING = ENTITY_CEILING;
/** The refusal flashes kept (a ring buffer) and how long one shows (simulation ms). */
export const CS_FLASH_MAX = 64;
export const CS_FLASH_MS = 220;
/** The pluck's key: A major pentatonic on A2; colour 0 (the core) on degree `CS_TOP_DEGREE`, the outer colour `CS_DEGREE_SPAN` lower. */
export const CS_ROOT_MIDI = 45;
export const CS_TOP_DEGREE = 15;
export const CS_DEGREE_SPAN = 10;
/** The completion chord's root (A2, the key's tonic). */
export const CS_CHORD_HZ = 110;
/** The settle test of a rule that lets balls back in (`csSortSettles()`): the census averaged over blocks of this many seconds
 * of the cycle, and the sort settled once the last `CS_SETTLE_BLOCKS` blocks average no higher than the `CS_SETTLE_BLOCKS` before
 * them (6 s against 6 s: the earliest settle is 12 s in; the reference 360 settle at 18–36 s, median ~24 s, 51–63 % sorted). */
export const CS_SETTLE_BLOCK_SEC = 2;
export const CS_SETTLE_BLOCKS = 3;
/** A ball contact is a "ball hit" (bounce math, the impact count) from this approach speed (× the set speed). */
const CS_HIT_SPEED = 0.15;
/** Floating-point slack of the phase times (ms). */
const PHASE_EPS_MS = 0.5;
const TWO_PI = Math.PI * 2;

/** The neon palette (the reference clip's red, amber, green and blue, with the rainbow between and around them). */
export const CS_PALETTE = ["#ff5a5a", "#f7b23b", "#f2e45c", "#57e07a", "#3fd6c8", "#5b8cff", "#a77bff", "#ff6fcf"] as const;
/** Which palette entries K colours (2–8) take, inner ring outward. */
const PALETTE_PICKS: Readonly<Record<number, readonly number[]>> = {
  2: [0, 5],
  3: [0, 3, 5],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 3, 5],
  6: [0, 1, 2, 3, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
  8: [0, 1, 2, 3, 4, 5, 6, 7],
};

/* ------------------------------------------------------------------ settings */

function finite(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Fills in the defaults and validates (every number from its minimum up, no maximum – uncapped; counts whole). */
export function resolveColourSortSettings(source: Partial<ColourSortSettings> | null | undefined): ColourSortSettings {
  const s = source ?? {};
  const d = DEFAULT_COLOUR_SORT;
  const num = (value: unknown, range: { min: number }, fallback: number) => atLeastMin(finite(value, fallback), range);
  return {
    colours: Math.round(num(s.colours, COLOUR_SORT_RANGES.csColours, d.colours)),
    perColour: Math.round(num(s.perColour, COLOUR_SORT_RANGES.csPerColour, d.perColour)),
    gates: Math.round(num(s.gates, COLOUR_SORT_RANGES.csGates, d.gates)),
    gateWidth: num(s.gateWidth, COLOUR_SORT_RANGES.csGateWidth, d.gateWidth),
    spin: num(s.spin, COLOUR_SORT_RANGES.csSpin, d.spin),
    falloff: num(s.falloff, COLOUR_SORT_RANGES.csFalloff, d.falloff),
    alternate: typeof s.alternate === "boolean" ? s.alternate : d.alternate,
    speed: num(s.speed, COLOUR_SORT_RANGES.csSpeed, d.speed),
    size: num(s.size, COLOUR_SORT_RANGES.csSize, d.size),
    collisions: typeof s.collisions === "boolean" ? s.collisions : d.collisions,
    remix: num(s.remix, COLOUR_SORT_RANGES.csRemix, d.remix),
    rule: isCsRule(s.rule) ? s.rule : d.rule,
    limit: num(s.limit, COLOUR_SORT_RANGES.csLimit, d.limit),
    flashes: typeof s.flashes === "boolean" ? s.flashes : d.flashes,
  };
}

/** The colours, the balls of each and in all a run builds (the memory-safety ceilings: `csColours`, `csPerColour`, the total). */
export function colourSortCounts(settings: Pick<ColourSortSettings, "colours" | "perColour">): { colours: number; perColour: number; total: number } {
  const colours = Math.max(2, Math.min(memoryCeiling("csColours", Math.round(settings.colours)), CS_COLOUR_CEILING));
  const wanted = Math.max(1, Math.min(memoryCeiling("csPerColour", Math.round(settings.perColour)), CS_PER_COLOUR_CEILING));
  const perColour = Math.max(1, Math.min(wanted, Math.floor(CS_BALL_CEILING / colours)));
  return { colours, perColour, total: colours * perColour };
}

/* ------------------------------------------------------------------ the rule */

/**
 * Whether a gate of ring `ring` lets a ball of colour `colour` through, moving `outward` (v · r̂ > 0) or inward: the rule
 * table. outwardNotOwn – outward, never the ring's own colour (the reference); outwardOwnOnly – outward, the ring's own
 * colour only; bothWaysNotOwn – either way, never the ring's own colour.
 */
export function gatePasses(rule: CsRule, outward: boolean, colour: number, ring: number): boolean {
  switch (rule) {
    case "outwardOwnOnly":
      return outward && colour === ring;
    case "bothWaysNotOwn":
      return colour !== ring;
    default:
      return outward && colour !== ring;
  }
}

/**
 * Whether `rule` lets a ball back in through a gate (both ways): then a ball in its own band can leave it again inward, so
 * "every ball in its own band at once" is not an end state but a rare fluctuation – the sort settles at an equilibrium, and
 * the run ends it there (`settledCensus()`) instead of waiting for the time limit. The one-way rules sort monotonically.
 */
export function csSortSettles(rule: CsRule): boolean {
  // an inward pass of a ball of the ring's own colour or of another one
  return gatePasses(rule, false, 0, 0) || gatePasses(rule, false, 1, 0);
}

/**
 * Whether a census averaged in blocks (`means`, oldest first, the last `count` of them valid in a ring of `means.length` from
 * `head` – the next slot to write) has settled: at least 2 × `window` blocks, and the last `window` of them average no higher
 * than the `window` before them (the count has stopped rising).
 */
export function settledCensus(means: Float64Array, head: number, count: number, window: number): boolean {
  const size = means.length;
  if (!(window >= 1) || count < 2 * window || size < 2 * window) return false;
  let last = 0;
  let before = 0;
  for (let j = 1; j <= window; j++) {
    last += means[(head - j + 2 * size) % size];
    before += means[(head - window - j + 2 * size) % size];
  }
  return last <= before;
}

/**
 * The band a ball of `colour` ends in under `rule`, starting in the core with `colours` rings (the last the closed outer
 * wall): it goes out through every ring that lets it out and stops at the first that does not – the reference rule sends
 * colour c to band c. A ball is sorted while it is in this band.
 */
export function targetBand(rule: CsRule, colour: number, colours: number): number {
  let band = 0;
  while (band < colours - 1 && gatePasses(rule, true, colour, band)) band++;
  return band;
}

/** Ring `k`'s radius in an arena of outer radius `outer` with `colours` rings: R · (k + 1) / K. */
export function csRingRadius(k: number, colours: number, outer: number): number {
  return (outer * (k + 1)) / colours;
}

/** The band of a centre `r` from the arena's centre (0 = the core … K − 1 = the outer band; past the outer wall: K − 1). */
export function csBandOf(r: number, colours: number, outer: number): number {
  if (!(outer > 0)) return 0;
  const b = Math.floor((r * colours) / outer);
  return b < 0 ? 0 : b > colours - 1 ? colours - 1 : b;
}

/** Ring `k`'s spin (rad/s): spin × falloff^k, the odd rings turning the other way when `alternate`. */
export function csRingOmega(k: number, settings: Pick<ColourSortSettings, "spin" | "falloff" | "alternate">): number {
  const sign = settings.alternate && k % 2 === 1 ? -1 : 1;
  return (sign * settings.spin * Math.pow(settings.falloff, k) * Math.PI) / 180;
}

/**
 * Whether world angle `angle` (radians) is in a gate of a ring turned by `ringAngle` whose gates are centred at `phase` + j ·
 * `period` and `width` wide (radians): within half a gate of the nearest gate's centre.
 */
export function inGate(angle: number, ringAngle: number, phase: number, period: number, width: number): boolean {
  if (!(width > 0)) return false;
  if (width >= period) return true;
  let u = (angle - ringAngle - phase) / period;
  u -= Math.round(u);
  return Math.abs(u) * period <= width / 2;
}

/**
 * A reflection off a surface moving at (ux, uy) with unit normal (nx, ny) pointing at the ball, in the surface's own frame:
 * the velocity relative to the surface has its normal part reversed (when it moves into the surface) and its tangential part
 * kept less `grip` (0 = a mirror; a spinning arc grips the ball and drags it along), then is scaled back to the speed it came
 * in with – so the speed in the surface's frame is kept – and the surface's velocity is added back. A still surface with no
 * grip is the plain mirror. Writes into `out` and returns whether it reflected.
 */
export function reflectInMovingFrame(vx: number, vy: number, nx: number, ny: number, ux: number, uy: number, out: { vx: number; vy: number }, grip = 0): boolean {
  const rx = vx - ux;
  const ry = vy - uy;
  const dot = rx * nx + ry * ny;
  if (dot >= 0) {
    out.vx = vx;
    out.vy = vy;
    return false;
  }
  const tx = rx - dot * nx;
  const ty = ry - dot * ny;
  const keep = grip > 0 ? 1 - Math.min(1, grip) : 1;
  let ox = -dot * nx + tx * keep;
  let oy = -dot * ny + ty * keep;
  if (keep !== 1) {
    const speed = Math.hypot(rx, ry);
    const len = Math.hypot(ox, oy);
    if (len > 1e-12) {
      ox *= speed / len;
      oy *= speed / len;
    }
  }
  out.vx = ox + ux;
  out.vy = oy + uy;
  return true;
}

/** Colour `colour`'s fixed degree of `colours` (the core highest, the outer colour `CS_DEGREE_SPAN` lower). */
export function colourDegree(colour: number, colours: number): number {
  if (colours <= 1) return CS_TOP_DEGREE;
  return CS_TOP_DEGREE - Math.round((colour * CS_DEGREE_SPAN) / (colours - 1));
}

/** Colour `colour`'s pluck (Hz): its degree of A major pentatonic on A2 (A3, E4, C♯5, A5 for the four reference colours). */
export function colourSortPitch(colour: number, colours: number): number {
  return midiToFrequency(degreeToMidi(colourDegree(colour, colours), CS_ROOT_MIDI, "majorPentatonic"));
}

/** The colours of a run of K colours ("#rrggbb", inner ring outward): the reference four, the rainbow, hues past eight. */
export function colourSortPalette(colours: number): string[] {
  const picks = PALETTE_PICKS[colours];
  if (picks) return picks.map((i) => CS_PALETTE[i]);
  const out: string[] = [];
  for (let i = 0; i < colours; i++) out.push(hslHex((i * 300) / Math.max(1, colours - 1), 0.85, 0.63));
  return out;
}

/** The palette entries' names (the finder's colour picker shows them, like the other modes' palette names). */
export const CS_COLOUR_NAMES = ["RED", "AMBER", "YELLOW", "GREEN", "TEAL", "BLUE", "VIOLET", "PINK"] as const;

/** The names of a run's K colours, inner ring outward (the palette's; past eight colours their numbers: "#9"). */
export function colourSortColourNames(colours: number): string[] {
  const picks = PALETTE_PICKS[colours];
  if (picks) return picks.map((i) => CS_COLOUR_NAMES[i]);
  return Array.from({ length: Math.max(0, Math.floor(colours)) }, (_, i) => `#${i + 1}`);
}

function hslHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Smoothstep (3u² − 2u³) and its derivative, on [0, 1]. */
export function smoothStep(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x * x * (3 - 2 * x);
}
function smoothStepSlope(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return 6 * x * (1 - x);
}

/**
 * The remix's displacement from a ball's frame-0 place along one axis, `tau` s into a remix of `T` s: a critically damped
 * spring (ω0 = `CS_REMIX_STIFFNESS` / T) from displacement `a` and velocity `v`, less the spring's tiny remainder at T faded in
 * with a smoothstep – exactly `a` (moving at `v`) at the start and exactly 0 at the end. Returns [offset, velocity].
 */
export function remixOffset(a: number, v: number, tau: number, T: number, out: [number, number] = [0, 0]): [number, number] {
  if (!(T > 0)) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  const t = tau < 0 ? 0 : tau > T ? T : tau;
  const w = CS_REMIX_STIFFNESS / T;
  const b = v + w * a;
  const e = Math.exp(-w * t);
  const rest = (a + b * T) * Math.exp(-w * T);
  out[0] = (a + b * t) * e - rest * smoothStep(t / T);
  out[1] = tau >= T ? 0 : (b - w * (a + b * t)) * e - (rest * smoothStepSlope(t / T)) / T;
  return out;
}

/* ------------------------------------------------------------------ the view */

/** What the canvas, the HUD, the finder and the smoke test read of a run (the same object every call). */
export interface ColourSortView {
  /** The run's settings (resolved) and its counts after the ceilings. */
  settings: ColourSortSettings;
  colours: number;
  perColour: number;
  total: number;
  /** The arena: centre, outer radius, the reference-px scale, the balls' solid radius and glow radius, the rings' half stroke (world px). */
  cx: number;
  cy: number;
  outer: number;
  scale: number;
  ballRadius: number;
  glowRadius: number;
  ringHalf: number;
  /** Ring k's radius, angle now (radians), spin (rad/s) and gate phase (radians); the gates' count, period and width (radians). */
  ringRadius: Float64Array;
  ringAngle: Float64Array;
  ringOmega: Float64Array;
  gatePhase: Float64Array;
  gates: number;
  gatePeriod: number;
  gateWidth: number;
  /** The colours ("#rrggbb", ring k's colour is colour k) and the band each colour ends in. */
  palette: string[];
  target: Int32Array;
  /** Body k (the engine ball with id `firstId + k`): its colour and band now. */
  firstId: number;
  colourOf: Uint16Array;
  band: Int32Array;
  phase: CsPhase;
  /** 0–1 through the remix (0 otherwise). */
  remixProgress: number;
  /** The census: balls in their own band now, at the cycle's start and per colour. */
  sorted: number;
  sortedAtStart: number;
  sortedByColour: Int32Array;
  /** When each colour's last ball was sorted (cycle ms; −1 while one is out). */
  colourDoneMs: Float64Array;
  /** The cycle's start (simulation ms: 0 or the last seam), its completion (simulation ms, −1 before) and whether every ball made it. */
  cycleStartMs: number;
  completeMs: number;
  completeOk: boolean;
  /** How the cycle's sort ended ("" while it runs): sorted, settled (a rule that lets balls back in) or at the time limit. */
  endReason: CsEnd;
  /** Whether the run's rule lets balls back in, so its sort settles at an equilibrium (`csSortSettles()`). */
  settles: boolean;
  /** The colour of the cycle's last ball sorted (the one that completed it; −1 before / after a time-out or a settle). */
  lastColour: number;
  /** The first cycle's completion (s; −1 before or when it timed out or settled) and its last colour. */
  firstSortSec: number;
  firstLastColour: number;
  /** How the first cycle's sort ended ("" before) and when (s into the cycle; −1 before): kept through the later cycles. */
  firstEnd: CsEnd;
  firstEndSec: number;
  /** Completions, seams (the loop's restarts), the last seam (simulation ms) and the last whole cycle (s; 0 before). */
  completions: number;
  seams: number;
  lastSeamMs: number;
  cycleSec: number;
  /** Gate passes and refusals in this cycle, ball contacts, and balls found past the outer wall (always 0). */
  passes: number;
  refusals: number;
  contacts: number;
  escaped: number;
  /** The refusal flashes: a ring buffer of (x, y, simulation ms, ring). */
  flashX: Float64Array;
  flashY: Float64Array;
  flashT: Float64Array;
  flashRing: Int32Array;
  flashCount: number;
  flashHead: number;
  /** Bumped on every init, so the renderer can drop per-run caches. */
  generation: number;
}

const EMPTY_F64 = new Float64Array(0);
const EMPTY_I32 = new Int32Array(0);
const EMPTY_U16 = new Uint16Array(0);

export class ColourSortMode implements GameMode {
  readonly name = "colourSort";
  /** The mode keeps every ball at its speed itself (no slow-ball boost) and resolves the contacts itself (no engine pair pass). */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: ColourSortSettings = { ...DEFAULT_COLOUR_SORT };
  private readonly view: ColourSortView = {
    settings: { ...DEFAULT_COLOUR_SORT },
    colours: 0,
    perColour: 0,
    total: 0,
    cx: 0,
    cy: 0,
    outer: 0,
    scale: 1,
    ballRadius: 1,
    glowRadius: 1,
    ringHalf: 1,
    ringRadius: EMPTY_F64,
    ringAngle: EMPTY_F64,
    ringOmega: EMPTY_F64,
    gatePhase: EMPTY_F64,
    gates: 0,
    gatePeriod: TWO_PI,
    gateWidth: 0,
    palette: [],
    target: EMPTY_I32,
    firstId: 0,
    colourOf: EMPTY_U16,
    band: EMPTY_I32,
    phase: "sort",
    remixProgress: 0,
    sorted: 0,
    sortedAtStart: 0,
    sortedByColour: EMPTY_I32,
    colourDoneMs: EMPTY_F64,
    cycleStartMs: 0,
    completeMs: -1,
    completeOk: false,
    endReason: "",
    settles: false,
    lastColour: -1,
    firstSortSec: -1,
    firstLastColour: -1,
    firstEnd: "",
    firstEndSec: -1,
    completions: 0,
    seams: 0,
    lastSeamMs: 0,
    cycleSec: 0,
    passes: 0,
    refusals: 0,
    contacts: 0,
    escaped: 0,
    flashX: new Float64Array(CS_FLASH_MAX),
    flashY: new Float64Array(CS_FLASH_MAX),
    flashT: new Float64Array(CS_FLASH_MAX),
    flashRing: new Int32Array(CS_FLASH_MAX),
    flashCount: 0,
    flashHead: 0,
    generation: 0,
  };
  // The arena (world px) and the world it was laid out for.
  private n = 0;
  private K = 0;
  private firstId = 0;
  private vT = 100;
  private rho = 3;
  private h = 1;
  private canvasW = 0;
  private canvasH = 0;
  // Frame 0: every body's place (offset from the centre, in outer radii) and launch velocity (in set speeds).
  private x0 = EMPTY_F64;
  private y0 = EMPTY_F64;
  private u0 = EMPTY_F64;
  private w0 = EMPTY_F64;
  // The previous positions (the ring passes judge a move from them) and the remix's start displacement and velocity.
  private px = EMPTY_F64;
  private py = EMPTY_F64;
  private ax = EMPTY_F64;
  private ay = EMPTY_F64;
  private bx = EMPTY_F64;
  private by = EMPTY_F64;
  // Phases on the simulation clock.
  private holdEndMs = -1;
  private seamMs = -1;
  private remixMs = 0;
  private lastCycleMs = 0;
  // The ring angle each ring is eased by over the remix (radians), the sub-step clock.
  private remixDelta = EMPTY_F64;
  private stepStartMs = 0;
  private stepMs = 1000 / 60;
  private subClockMs = 0;
  // The cycle's own clock (ms since its start, summed step by step from 0 in every cycle – so every cycle reads the same
  // times, bit for bit, and replays the first exactly): at the end of this step, and at the end of this sub-step.
  private cycleClockMs = 0;
  private cycleSubMs = 0;
  private subSec = 1 / 240;
  private sawBall = false;
  private lastConfigRadius = 8;
  // The settle test (a rule that lets balls back in): the census × ms of the block being summed and its length, and a ring
  // of the last 2 × CS_SETTLE_BLOCKS blocks' means (the next slot to write, how many are valid).
  private settleSum = 0;
  private settleSpanMs = 0;
  private readonly settleMeans = new Float64Array(2 * CS_SETTLE_BLOCKS);
  private settleHead = 0;
  private settleCount = 0;
  // The step's gate passes per colour (the plucks), and their speeds.
  private passCount = EMPTY_I32;
  private passSpeed = EMPTY_F64;
  // Contacts: the broad phase over the bodies.
  private readonly hash = new SpatialHash();
  private readonly pairs: PairBuffer = createPairBuffer(1024);
  private xs = EMPTY_F64;
  private ys = EMPTY_F64;
  private rs = EMPTY_F64;
  private bodyOf = EMPTY_I32;
  private touch = new Uint8Array(256);
  private readonly bounce = { vx: 0, vy: 0 };
  private readonly remixOut: [number, number] = [0, 0];

  getSettings(): ColourSortSettings {
    return this.settings;
  }
  /** Applied on the next init (the page restarts a Colour Sort run when a setting of the sort changes; the flashes follow live). */
  setSettings(patch: Partial<ColourSortSettings>) {
    this.settings = resolveColourSortSettings({ ...this.settings, ...patch });
    this.view.settings.flashes = this.settings.flashes;
  }
  /** Live state for the canvas, the HUD, the finder and the smoke test; the same object every call. */
  getView(): ColourSortView {
    return this.view;
  }

  /* -------------------------------------------------------------- layout */

  /** Lays the arena out for the world (centre, outer radius, scale, the balls' radius and speed, the rings). */
  private layout(ctx: ModeContext) {
    const v = this.view;
    const w = ctx.config.width;
    const hgt = ctx.config.height;
    this.canvasW = w;
    this.canvasH = hgt;
    v.cx = w / 2;
    v.cy = hgt / 2;
    v.outer = Math.max(10, (CS_ARENA_FACTOR * Math.min(w, hgt)) / 2);
    v.scale = v.outer / CS_REF_RING;
    const size = this.settings.size * v.scale;
    this.rho = Math.max(0.25, CS_BODY_SHARE * size);
    this.h = Math.max(0.5, (CS_RING_STROKE / 2) * v.scale);
    v.ballRadius = this.rho;
    v.glowRadius = Math.max(this.rho, size);
    v.ringHalf = this.h;
    this.vT = Math.max(1e-3, this.settings.speed * v.scale);
    for (let k = 0; k < this.K; k++) v.ringRadius[k] = csRingRadius(k, this.K, v.outer);
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    const counts = colourSortCounts(s);
    const K = counts.colours;
    const n = counts.total;
    this.K = K;
    this.n = n;
    v.settings = { ...s };
    v.generation++;
    v.colours = K;
    v.perColour = counts.perColour;
    v.total = n;
    v.ringRadius = new Float64Array(K);
    v.ringAngle = new Float64Array(K);
    v.ringOmega = new Float64Array(K);
    v.gatePhase = new Float64Array(K);
    v.palette = colourSortPalette(K);
    v.target = new Int32Array(K);
    for (let c = 0; c < K; c++) v.target[c] = targetBand(s.rule, c, K);
    v.settles = csSortSettles(s.rule);
    v.gates = Math.max(1, Math.min(memoryCeiling("csGates", s.gates), CS_GATE_CEILING));
    v.gatePeriod = TWO_PI / v.gates;
    v.gateWidth = Math.min(v.gatePeriod, (s.gateWidth * Math.PI) / 180);
    this.remixDelta = new Float64Array(K);
    this.passCount = new Int32Array(K);
    this.passSpeed = new Float64Array(K);
    v.sortedByColour = new Int32Array(K);
    v.colourDoneMs = new Float64Array(K);
    this.layout(ctx);
    for (let k = 0; k < K; k++) v.ringOmega[k] = k < K - 1 ? csRingOmega(k, s) : 0;
    // (1) every gated ring's gate phase
    for (let k = 0; k < K - 1; k++) v.gatePhase[k] = ctx.random() * v.gatePeriod;
    // (2) the colours, shuffled over the balls
    const colourOf = new Uint16Array(n);
    for (let i = 0; i < n; i++) colourOf[i] = Math.floor(i / counts.perColour);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      const t = colourOf[i];
      colourOf[i] = colourOf[j];
      colourOf[j] = t;
    }
    v.colourOf = colourOf;
    v.band = new Int32Array(n);
    this.x0 = new Float64Array(n);
    this.y0 = new Float64Array(n);
    this.u0 = new Float64Array(n);
    this.w0 = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.bx = new Float64Array(n);
    this.by = new Float64Array(n);
    this.ensureScratch(n);
    // (3) the frame-0 packing – a sunflower of the core with a small hole (a ring-shaped clump), each ball jittered – and
    // (4) the launch directions
    const core = Math.max(0, csRingRadius(0, K, v.outer) - this.h - this.rho - 0.5);
    const hole = Math.max(1, Math.round(0.1 * n));
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const rr = core * Math.sqrt((i + hole) / (n + hole));
      const a = i * golden;
      const jx = (ctx.random() - 0.5) * 0.5 * this.rho;
      const jy = (ctx.random() - 0.5) * 0.5 * this.rho;
      let x = rr * Math.cos(a) + jx;
      let y = rr * Math.sin(a) + jy;
      const d = Math.hypot(x, y);
      if (d > core && d > 0) {
        x *= core / d;
        y *= core / d;
      }
      const dir = ctx.random() * TWO_PI;
      this.x0[i] = x / v.outer;
      this.y0[i] = y / v.outer;
      this.u0[i] = Math.cos(dir);
      this.w0[i] = Math.sin(dir);
    }
    this.firstId = ctx.getNextId();
    v.firstId = this.firstId;
    this.lastConfigRadius = ctx.config.ballRadius || 8;
    for (let i = 0; i < n; i++) {
      const x = v.cx + this.x0[i] * v.outer;
      const y = v.cy + this.y0[i] * v.outer;
      ctx.addBall({ x, y, vx: this.u0[i] * this.vT, vy: this.w0[i] * this.vT, radius: this.rho, color: v.palette[colourOf[i]], gravityScale: 0, radiusScale: this.rho / this.lastConfigRadius });
    }
    // the run's counters
    v.completions = 0;
    v.seams = 0;
    v.lastSeamMs = 0;
    v.cycleSec = 0;
    v.firstSortSec = -1;
    v.firstLastColour = -1;
    v.firstEnd = "";
    v.firstEndSec = -1;
    v.contacts = 0;
    v.escaped = 0;
    v.flashCount = 0;
    v.flashHead = 0;
    this.lastCycleMs = 0;
    this.startCycle(ctx, 0);
  }

  /** The cycle's start: every ball at its frame-0 place and launch velocity, the rings at their frame-0 angles, the census. */
  private startCycle(ctx: ModeContext, atMs: number) {
    const v = this.view;
    v.phase = "sort";
    v.remixProgress = 0;
    v.cycleStartMs = atMs;
    this.cycleClockMs = 0;
    this.cycleSubMs = 0;
    v.completeMs = -1;
    v.completeOk = false;
    v.endReason = "";
    v.lastColour = -1;
    v.passes = 0;
    this.settleSum = 0;
    this.settleSpanMs = 0;
    this.settleHead = 0;
    this.settleCount = 0;
    v.refusals = 0;
    this.holdEndMs = -1;
    this.seamMs = -1;
    for (let k = 0; k < this.K; k++) {
      v.ringAngle[k] = 0;
      this.remixDelta[k] = 0;
      this.passCount[k] = 0;
      this.passSpeed[k] = 0;
      v.colourDoneMs[k] = -1;
    }
    const balls = ctx.getBalls();
    for (const ball of balls) {
      const k = ball.id - this.firstId;
      if (k < 0 || k >= this.n) continue;
      ball.x = v.cx + this.x0[k] * v.outer;
      ball.y = v.cy + this.y0[k] * v.outer;
      ball.vx = this.u0[k] * this.vT;
      ball.vy = this.w0[k] * this.vT;
      ball.radius = this.rho;
      this.px[k] = ball.x;
      this.py[k] = ball.y;
    }
    this.census(ctx);
    v.sortedAtStart = v.sorted;
    for (let c = 0; c < this.K; c++) if (v.sortedByColour[c] >= v.perColour) v.colourDoneMs[c] = 0;
  }

  /** Recomputes every ball's band from its centre and the census (balls in their own band, per colour too). */
  private census(ctx: ModeContext) {
    const v = this.view;
    v.sorted = 0;
    v.sortedByColour.fill(0);
    for (const ball of ctx.getBalls()) {
      const k = ball.id - this.firstId;
      if (k < 0 || k >= this.n) continue;
      const b = csBandOf(Math.hypot(ball.x - v.cx, ball.y - v.cy), this.K, v.outer);
      v.band[k] = b;
      const c = v.colourOf[k];
      if (b === v.target[c]) {
        v.sorted++;
        v.sortedByColour[c]++;
      }
    }
  }

  /** The census recounted from the bands (the tests check it equals the counter). */
  countSorted(): number {
    const v = this.view;
    let sorted = 0;
    for (let k = 0; k < this.n; k++) if (v.band[k] === v.target[v.colourOf[k]]) sorted++;
    return sorted;
  }

  private ensureScratch(n: number) {
    if (this.xs.length >= n) return;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.rs = new Float64Array(n);
    this.bodyOf = new Int32Array(n);
  }

  /* -------------------------------------------------------------- the clock */

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.stepMs = dtMs;
    this.stepStartMs = ctx.getElapsedMs() - dtMs;
    this.subClockMs = this.stepStartMs;
    // a live change of the page's Ball Size never resizes the sort's balls (their size is the mode's own)
    const configRadius = ctx.config.ballRadius || 8;
    if (configRadius !== this.lastConfigRadius) {
      this.lastConfigRadius = configRadius;
      for (const ball of ctx.getBalls()) {
        ball.radius = this.rho;
        ball.radiusScale = this.rho / configRadius;
      }
    }
    const v = this.view;
    const t0 = this.stepStartMs;
    if (v.phase === "hold" && t0 >= this.holdEndMs - PHASE_EPS_MS) {
      if (this.seamMs > this.holdEndMs + PHASE_EPS_MS) this.beginRemix(ctx);
      else this.seam(ctx);
    }
    if (v.phase === "remix" && t0 >= this.seamMs - PHASE_EPS_MS) this.seam(ctx);
    // the cycle's clock at this step's start (0 right after a seam) and at its end
    this.cycleSubMs = this.cycleClockMs;
    this.cycleClockMs += dtMs;
  }

  /** The engine moved a ball: the mode notes the sub-step's length (the rings are resolved for all balls in onPostSubStep). */
  onBallStep(_ctx: ModeContext, _ball: Ball, dtSec: number) {
    this.subSec = dtSec;
    this.sawBall = true;
  }

  /** The rings' angles `cycleMs` into the cycle (simulation time `tMs`; the remix eases each onto an angle its gates repeat at). */
  private turnRings(cycleMs: number, tMs: number) {
    const v = this.view;
    const tau = cycleMs / 1000;
    const remixU = v.phase === "remix" && this.remixMs > 0 ? (tMs - this.holdEndMs) / this.remixMs : 0;
    const ease = v.phase === "remix" ? smoothStep(remixU) : 0;
    for (let k = 0; k < this.K - 1; k++) {
      let a = v.ringOmega[k] * tau + this.remixDelta[k] * ease;
      if (a > TWO_PI || a < -TWO_PI) a %= TWO_PI;
      v.ringAngle[k] = a;
    }
  }

  /* -------------------------------------------------------------- one sub-step */

  onPostSubStep(ctx: ModeContext) {
    const dtSec = this.sawBall ? this.subSec : this.stepMs / 4000;
    this.subClockMs += dtSec * 1000;
    this.cycleSubMs += dtSec * 1000;
    this.sawBall = false;
    const t = this.subClockMs;
    this.turnRings(this.cycleSubMs, t);
    const v = this.view;
    const balls = ctx.getBalls();
    if (v.phase === "remix") {
      this.placeRemix(balls, t);
      return;
    }
    // (1) the rings: every ball's move judged against its band's rings (passes, arcs, refusing gates, pins)
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const k = ball.id - this.firstId;
      if (k < 0 || k >= this.n) continue;
      this.resolveRings(ctx, ball, k, true, t);
    }
    // (2) the contacts between the balls, then the rings again from where the first pass left them (silent: no bounces heard)
    if (this.settings.collisions && this.n > 1) {
      for (let i = 0; i < balls.length; i++) {
        const k = balls[i].id - this.firstId;
        if (k < 0 || k >= this.n) continue;
        this.px[k] = balls[i].x;
        this.py[k] = balls[i].y;
      }
      this.collide(ctx, balls);
      for (let i = 0; i < balls.length; i++) {
        const ball = balls[i];
        const k = ball.id - this.firstId;
        if (k < 0 || k >= this.n || (ball.x === this.px[k] && ball.y === this.py[k])) continue;
        this.resolveRings(ctx, ball, k, false, t);
      }
    }
    // (3) the speed governor (a constant-speed gas), and the positions the next sub-step's passes start from
    const keep = Math.exp(-dtSec / CS_SPEED_TAU);
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const k = ball.id - this.firstId;
      if (k < 0 || k >= this.n) continue;
      const sp = Math.hypot(ball.vx, ball.vy);
      if (sp > 1e-9) {
        const f = 1 + (this.vT / sp - 1) * (1 - keep);
        ball.vx *= f;
        ball.vy *= f;
      } else {
        // a ball brought to rest (a head-on squeeze) leaves along its own place's tangent (no random draw)
        const dx = ball.x - v.cx;
        const dy = ball.y - v.cy;
        const d = Math.hypot(dx, dy) || 1;
        ball.vx = (-dy / d) * this.vT * (1 - keep);
        ball.vy = (dx / d) * this.vT * (1 - keep);
      }
      this.px[k] = ball.x;
      this.py[k] = ball.y;
    }
  }

  /**
   * Ball `k`'s rings this sub-step: a centre that crossed its band's ring (from `px`/`py`) passes when the crossing is in a
   * gate that lets it through, else it is put back and reflected (tunnelling-proof); a ball touching a ring is reflected by
   * an arc, by a gate that refuses it (moving into it) and by the pins at the arc ends – all in the ring's moving frame, a
   * spinning arc gripping the ball a little (`CS_ARC_GRIP`). `loud`: the first pass of the sub-step (its bounces count and
   * flash); passes always count and play. The angle maths only runs for a ball near a ring.
   */
  private resolveRings(ctx: ModeContext, ball: Ball, k: number, loud: boolean, tMs: number) {
    const v = this.view;
    const K = this.K;
    const rule = this.settings.rule;
    const colour = v.colourOf[k];
    const reach = this.rho + this.h;
    const cx = v.cx;
    const cy = v.cy;
    let b = v.band[k];
    let r = Math.hypot(ball.x - cx, ball.y - cy);
    // (a) centre crossings: at most K of them in one move (a very fast ball), each a pass or a rebound
    for (let guard = 0; guard <= K; guard++) {
      const rOut = v.ringRadius[b];
      if (r > rOut) {
        const angle = this.crossingAngle(this.px[k], this.py[k], ball.x, ball.y, rOut);
        const open = b < K - 1 && this.gateOpen(b, angle);
        if (open && gatePasses(rule, true, colour, b)) {
          this.pass(ball, k, b, b + 1, tMs);
          b++;
          continue;
        }
        this.wall(ctx, ball, b, Math.cos(angle), Math.sin(angle), -1, true, rOut - reach, loud);
        if (loud && open) this.refuse(ball, b, tMs);
        r = Math.hypot(ball.x - cx, ball.y - cy);
        break;
      }
      if (b > 0 && r < v.ringRadius[b - 1]) {
        const rIn = v.ringRadius[b - 1];
        const angle = this.crossingAngle(this.px[k], this.py[k], ball.x, ball.y, rIn);
        const open = this.gateOpen(b - 1, angle);
        if (open && gatePasses(rule, false, colour, b - 1)) {
          this.pass(ball, k, b, b - 1, tMs);
          b--;
          continue;
        }
        this.wall(ctx, ball, b - 1, Math.cos(angle), Math.sin(angle), 1, true, rIn + reach, loud);
        if (loud && open) this.refuse(ball, b - 1, tMs);
        r = Math.hypot(ball.x - cx, ball.y - cy);
        break;
      }
      break;
    }
    // (b) surface contacts with the band's outer and inner ring (only a ball within reach of one)
    const rOut = v.ringRadius[b];
    if (r + reach > rOut && r > 1e-9) {
      const ex = (ball.x - cx) / r;
      const ey = (ball.y - cy) / r;
      const vr = ball.vx * ex + ball.vy * ey;
      const open = b < K - 1 && this.gateOpen(b, Math.atan2(ey, ex));
      if (!open) this.wall(ctx, ball, b, ex, ey, -1, vr > 0, rOut - reach, loud);
      else if (vr > 0 && !gatePasses(rule, true, colour, b)) {
        this.wall(ctx, ball, b, ex, ey, -1, true, rOut - reach, loud);
        if (loud) this.refuse(ball, b, tMs);
      }
      r = Math.hypot(ball.x - cx, ball.y - cy);
    }
    if (b > 0) {
      const rIn = v.ringRadius[b - 1];
      if (r - reach < rIn && r > 1e-9) {
        const ex = (ball.x - cx) / r;
        const ey = (ball.y - cy) / r;
        const vr = ball.vx * ex + ball.vy * ey;
        const open = this.gateOpen(b - 1, Math.atan2(ey, ex));
        if (!open) this.wall(ctx, ball, b - 1, ex, ey, 1, vr < 0, rIn + reach, loud);
        else if (vr < 0 && !gatePasses(rule, false, colour, b - 1)) {
          this.wall(ctx, ball, b - 1, ex, ey, 1, true, rIn + reach, loud);
          if (loud) this.refuse(ball, b - 1, tMs);
        }
        r = Math.hypot(ball.x - cx, ball.y - cy);
      }
    }
    // (c) the pins at the arc ends of the band's gated rings
    if (b < K - 1 && Math.abs(r - rOut) < reach) this.pins(ctx, ball, b, loud);
    if (b > 0 && Math.abs(r - v.ringRadius[b - 1]) < reach) this.pins(ctx, ball, b - 1, loud);
    // (d) the band holds the centre (a push may not carry it across a ring: that is only ever a pass, judged above)
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    r = Math.hypot(dx, dy);
    const hi = b === K - 1 ? v.ringRadius[b] - reach : v.ringRadius[b];
    const lo = b > 0 ? v.ringRadius[b - 1] : 0;
    const target = r > hi ? hi : r < lo ? lo : r;
    if (target !== r) {
      const f = r > 1e-9 ? target / r : 0;
      ball.x = cx + dx * f;
      ball.y = cy + dy * f;
    }
  }

  /** The angle (radians) at which the segment from (x0, y0) to (x1, y1) crosses the circle of radius `R` about the centre. */
  private crossingAngle(x0: number, y0: number, x1: number, y1: number, R: number): number {
    const cx = this.view.cx;
    const cy = this.view.cy;
    const px = x0 - cx;
    const py = y0 - cy;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const a = dx * dx + dy * dy;
    if (a < 1e-18) return Math.atan2(y1 - cy, x1 - cx);
    const bq = 2 * (px * dx + py * dy);
    const c = px * px + py * py - R * R;
    const disc = bq * bq - 4 * a * c;
    if (disc < 0) return Math.atan2(y1 - cy, x1 - cx);
    const sq = Math.sqrt(disc);
    // from inside (c < 0) the larger root, from outside the smaller one
    let t = c < 0 ? (-bq + sq) / (2 * a) : (-bq - sq) / (2 * a);
    if (!(t >= 0 && t <= 1)) t = t < 0 ? 0 : 1;
    return Math.atan2(py + t * dy, px + t * dx);
  }

  /** Whether ring `k` has a gate at world angle `angle` now (the outer wall has none). */
  private gateOpen(k: number, angle: number): boolean {
    if (k >= this.K - 1) return false;
    const v = this.view;
    return inGate(angle, v.ringAngle[k], v.gatePhase[k], v.gatePeriod, v.gateWidth);
  }

  /** A pass of ball `k` from band `from` to `to` through ring min(from, to): the census, the colour's finish, the pluck. */
  private pass(ball: Ball, k: number, from: number, to: number, tMs: number) {
    const v = this.view;
    const c = v.colourOf[k];
    const target = v.target[c];
    v.band[k] = to;
    v.passes++;
    if (from === target) {
      v.sorted--;
      v.sortedByColour[c]--;
      v.colourDoneMs[c] = -1;
    }
    if (to === target) {
      v.sorted++;
      v.sortedByColour[c]++;
      v.lastColour = c;
      if (v.sortedByColour[c] >= v.perColour) v.colourDoneMs[c] = tMs - v.cycleStartMs;
    }
    if (v.phase !== "remix") {
      this.passCount[c]++;
      this.passSpeed[c] += Math.hypot(ball.vx, ball.vy);
    }
  }

  /**
   * Ring `ring`'s surface where the ball meets it, (ex, ey) the radial unit there and `side` −1 from inside, +1 from outside:
   * the ball put at `radius` from the centre and – moving into the ring – reflected in the ring's frame (a spinning ring's
   * surface moves along itself and grips the ball; the outer wall stands still).
   */
  private wall(ctx: ModeContext, ball: Ball, ring: number, ex: number, ey: number, side: number, into: boolean, radius: number, loud: boolean) {
    const v = this.view;
    const rr = Math.max(0, radius);
    ball.x = v.cx + ex * rr;
    ball.y = v.cy + ey * rr;
    if (!into) return;
    const omega = v.ringOmega[ring];
    const speed = omega * v.ringRadius[ring];
    if (reflectInMovingFrame(ball.vx, ball.vy, side * ex, side * ey, -speed * ey, speed * ex, this.bounce, omega !== 0 ? CS_ARC_GRIP : 0)) {
      ball.vx = this.bounce.vx;
      ball.vy = this.bounce.vy;
      if (loud) ctx.noteBounce?.(ball);
    }
  }

  /** The pins of ring `k` next to the ball (the ends of the gate nearest its angle and of its neighbours'), in the ring's frame. */
  private pins(ctx: ModeContext, ball: Ball, k: number, loud: boolean) {
    const v = this.view;
    if (v.gateWidth >= v.gatePeriod || !(v.gateWidth > 0)) return;
    const R = v.ringRadius[k];
    const reach = this.rho + this.h;
    const angle = Math.atan2(ball.y - v.cy, ball.x - v.cx);
    const P = v.gatePeriod;
    let u = (angle - v.ringAngle[k] - v.gatePhase[k]) / P;
    u -= Math.round(u);
    const centre = angle - u * P;
    const half = v.gateWidth / 2;
    const omega = v.ringOmega[k];
    for (let side = 0; side < 4; side++) {
      const a = centre + (side === 0 ? -half : side === 1 ? half : side === 2 ? -(P - half) : P - half);
      const pxp = v.cx + R * Math.cos(a);
      const pyp = v.cy + R * Math.sin(a);
      const ex = ball.x - pxp;
      const ey = ball.y - pyp;
      const d2 = ex * ex + ey * ey;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-9 ? ex / d : Math.cos(angle);
      const ny = d > 1e-9 ? ey / d : Math.sin(angle);
      ball.x = pxp + nx * reach;
      ball.y = pyp + ny * reach;
      if (reflectInMovingFrame(ball.vx, ball.vy, nx, ny, -omega * R * Math.sin(a), omega * R * Math.cos(a), this.bounce)) {
        ball.vx = this.bounce.vx;
        ball.vy = this.bounce.vy;
        if (loud) ctx.noteBounce?.(ball);
      }
    }
  }

  /** A refusal flash (render-only) where the ball met ring `ring`'s gate. */
  private refuse(ball: Ball, ring: number, tMs: number) {
    const v = this.view;
    v.refusals++;
    const i = v.flashHead;
    v.flashX[i] = ball.x;
    v.flashY[i] = ball.y;
    v.flashT[i] = tMs;
    v.flashRing[i] = ring;
    v.flashHead = (i + 1) % CS_FLASH_MAX;
    if (v.flashCount < CS_FLASH_MAX) v.flashCount++;
  }

  /** Whether two balls in bands `ba` and `bb` can touch at (mx, my): the same band, or neighbours across an open gate. */
  private canTouch(ba: number, bb: number, mx: number, my: number): boolean {
    if (ba === bb) return true;
    if (Math.abs(ba - bb) !== 1) return false;
    return this.gateOpen(Math.min(ba, bb), Math.atan2(my - this.view.cy, mx - this.view.cx));
  }

  /** The contacts: a spatial hash of the sub-step's positions, then equal-mass push-outs and elastic impulses (Collide's solver). */
  private collide(ctx: ModeContext, balls: Ball[]) {
    const v = this.view;
    const m = balls.length;
    this.ensureScratch(m);
    const { xs, ys, rs, bodyOf } = this;
    let maxR = 0;
    for (let i = 0; i < m; i++) {
      const b = balls[i];
      xs[i] = b.x;
      ys[i] = b.y;
      rs[i] = b.radius;
      if (b.radius > maxR) maxR = b.radius;
      const k = b.id - this.firstId;
      bodyOf[i] = k >= 0 && k < this.n ? k : -1;
    }
    const margin = Math.max(0.25, 0.2 * maxR);
    const ext = v.outer + maxR + this.h;
    this.hash.build(xs, ys, m, Math.max(2 * maxR + margin, (2 * ext) / CS_GRID_CELLS), v.cx - ext, v.cy - ext, v.cx + ext, v.cy + ext);
    const count = this.hash.collectContacts(xs, ys, rs, margin, this.pairs, ctx.config.unlimited ? 40_000 : Infinity);
    const pairs = this.pairs.pairs;
    const hitSpeed = CS_HIT_SPEED * this.vT;
    // which candidate pairs may touch at all (the same band, or neighbours across an open gate): once per sub-step
    if (this.touch.length < count) this.touch = new Uint8Array(Math.max(count, 2 * this.touch.length));
    const touch = this.touch;
    for (let q = 0; q < count; q++) {
      const ki = bodyOf[pairs[2 * q]];
      const kj = bodyOf[pairs[2 * q + 1]];
      touch[q] = ki >= 0 && kj >= 0 && this.canTouch(v.band[ki], v.band[kj], (xs[pairs[2 * q]] + xs[pairs[2 * q + 1]]) / 2, (ys[pairs[2 * q]] + ys[pairs[2 * q + 1]]) / 2) ? 1 : 0;
    }
    for (let it = 0; it < CS_CONTACT_PASSES; it++) {
      const forward = it % 2 === 0;
      for (let q = 0; q < count; q++) {
        const p = forward ? q : count - 1 - q;
        if (touch[p] === 0) continue;
        const a = balls[pairs[2 * p]];
        const b = balls[pairs[2 * p + 1]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minD = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2);
        // coincident centres (a packed start) separate along x, deterministically
        const nx = d > 1e-9 ? dx / d : 1;
        const ny = d > 1e-9 ? dy / d : 0;
        const pen = minD - d;
        if (pen > POSITION_SLOP) {
          const corr = 0.5 * (pen - POSITION_SLOP) * POSITION_CORRECTION;
          a.x -= nx * corr;
          a.y -= ny * corr;
          b.x += nx * corr;
          b.y += ny * corr;
        }
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel >= 0) continue;
        // equal masses, perfectly elastic: the normal components swap
        a.vx += rel * nx;
        a.vy += rel * ny;
        b.vx -= rel * nx;
        b.vy -= rel * ny;
        if (it === 0 && -rel >= hitSpeed) {
          v.contacts++;
          ctx.noteCollide?.(a, b);
        }
      }
    }
  }

  /* -------------------------------------------------------------- the phases */

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const now = ctx.getElapsedMs();
    this.flushPlucks(ctx);
    // the outer wall holds every ball (counted for the smoke test: always 0)
    let escaped = 0;
    const limit = v.outer + 0.5;
    for (const ball of ctx.getBalls()) if (Math.hypot(ball.x - v.cx, ball.y - v.cy) > limit) escaped++;
    v.escaped = Math.max(v.escaped, escaped);
    if (v.phase !== "sort") return;
    const done = v.sorted >= v.total;
    const timedOut = !done && now - v.cycleStartMs >= 1000 * this.settings.limit - PHASE_EPS_MS;
    const settled = !done && !timedOut && v.settles && this.sampleSettle();
    if (done || timedOut || settled) this.complete(ctx, now, done ? "sorted" : timedOut ? "limit" : "settled");
  }

  /**
   * The settle test's step (a rule that lets balls back in): the census summed over the step into the current block on the
   * cycle's own clock; at a block's end its mean joins the ring and the test runs (`settledCensus()`). Every cycle replays it.
   */
  private sampleSettle(): boolean {
    this.settleSum += this.view.sorted * this.stepMs;
    this.settleSpanMs += this.stepMs;
    if (this.settleSpanMs < 1000 * CS_SETTLE_BLOCK_SEC - PHASE_EPS_MS) return false;
    const means = this.settleMeans;
    means[this.settleHead] = this.settleSum / this.settleSpanMs;
    this.settleHead = (this.settleHead + 1) % means.length;
    if (this.settleCount < means.length) this.settleCount++;
    this.settleSum = 0;
    this.settleSpanMs = 0;
    return settledCensus(means, this.settleHead, this.settleCount, CS_SETTLE_BLOCKS);
  }

  /** The sort is over (every ball sorted, settled at its equilibrium, or the time limit): the chord, then the hold and the remix on whole steps. */
  private complete(ctx: ModeContext, now: number, reason: Exclude<CsEnd, "">) {
    const v = this.view;
    const ok = reason === "sorted";
    v.phase = "hold";
    v.completeMs = now;
    v.completeOk = ok;
    v.endReason = reason;
    if (!ok) v.lastColour = -1;
    v.completions++;
    if (v.completions === 1) {
      v.firstSortSec = ok ? (now - v.cycleStartMs) / 1000 : -1;
      v.firstLastColour = ok ? v.lastColour : -1;
      v.firstEnd = reason;
      v.firstEndSec = (now - v.cycleStartMs) / 1000;
    }
    const step = this.stepMs > 0 ? this.stepMs : 1000 / 60;
    const holdSteps = Math.ceil((1000 * CS_HOLD_SEC) / step - 1e-9);
    const remixSteps = Math.ceil((1000 * this.settings.remix) / step - 1e-9);
    this.holdEndMs = now + holdSteps * step;
    this.remixMs = remixSteps * step;
    this.seamMs = this.holdEndMs + this.remixMs;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: CS_CHORD_HZ, level: 1, loopTremolo: true, loopMinor: !ok, melody: false });
  }

  /** The remix starts: every ball's displacement and velocity noted, each ring's ease onto its frame-0 gate angle, the wash. */
  private beginRemix(ctx: ModeContext) {
    const v = this.view;
    v.phase = "remix";
    v.remixProgress = 0;
    for (const ball of ctx.getBalls()) {
      const k = ball.id - this.firstId;
      if (k < 0 || k >= this.n) continue;
      this.ax[k] = ball.x - (v.cx + this.x0[k] * v.outer);
      this.ay[k] = ball.y - (v.cy + this.y0[k] * v.outer);
      this.bx[k] = ball.vx;
      this.by[k] = ball.vy;
    }
    // each ring ends the remix a whole number of gate periods from its frame-0 angle: its natural angle there, eased the
    // shortest way onto the nearest such angle (so the seam's reset to the frame-0 angle shows nothing)
    const endTau = (this.seamMs - v.cycleStartMs) / 1000;
    for (let k = 0; k < this.K - 1; k++) {
      const natural = v.ringOmega[k] * endTau;
      const turns = Math.round(natural / v.gatePeriod);
      this.remixDelta[k] = turns * v.gatePeriod - natural;
    }
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "wash", loopSec: this.remixMs / 1000, level: 1, melody: false });
  }

  /** The remix's positions at simulation time `tMs`: every ball on its spring back to its frame-0 place (analytic, exact at the end). */
  private placeRemix(balls: Ball[], tMs: number) {
    const v = this.view;
    const T = this.remixMs / 1000;
    const tau = (tMs - this.holdEndMs) / 1000;
    v.remixProgress = T > 0 ? Math.min(1, Math.max(0, tau / T)) : 1;
    const out = this.remixOut;
    // the outer wall still holds the balls (a ball flying out when the remix starts swings back along it, never past it)
    const wall = v.outer - this.rho - this.h;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const k = ball.id - this.firstId;
      if (k < 0 || k >= this.n) continue;
      remixOffset(this.ax[k], this.bx[k], tau, T, out);
      let x = this.x0[k] * v.outer + out[0];
      ball.vx = out[1];
      remixOffset(this.ay[k], this.by[k], tau, T, out);
      let y = this.y0[k] * v.outer + out[0];
      ball.vy = out[1];
      const d = Math.hypot(x, y);
      if (d > wall && d > 0) {
        x *= wall / d;
        y *= wall / d;
      }
      ball.x = v.cx + x;
      ball.y = v.cy + y;
      this.px[k] = ball.x;
      this.py[k] = ball.y;
    }
  }

  /** The seam: the frame-0 state again (places, launch velocities, ring angles, bands), the loop voices cut, the next cycle. */
  private seam(ctx: ModeContext) {
    const v = this.view;
    const at = this.seamMs >= 0 ? this.seamMs : this.stepStartMs;
    this.lastCycleMs = at - v.cycleStartMs;
    v.cycleSec = this.lastCycleMs / 1000;
    v.lastSeamMs = at;
    v.seams++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "cut", melody: false });
    this.startCycle(ctx, at);
  }

  /** The step's gate passes as plucks: one note per colour (√n for n passes), the busiest `LOOP_NOTES_PER_TICK` colours. */
  private flushPlucks(ctx: ModeContext) {
    const K = this.K;
    let emitted = 0;
    while (emitted < LOOP_NOTES_PER_TICK) {
      let best = -1;
      for (let c = 0; c < K; c++) if (this.passCount[c] > 0 && (best < 0 || this.passCount[c] > this.passCount[best])) best = c;
      if (best < 0) break;
      const count = this.passCount[best];
      const speedNorm = this.passSpeed[best] / count / (2 * this.vT);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: Math.min(best, K - 1), loop: "pluck", frequency: colourSortPitch(best, K), level: pluckVelocity(speedNorm) * Math.min(2, Math.sqrt(count)), loopBright: true, melody: false });
      this.passCount[best] = 0;
      this.passSpeed[best] = 0;
      emitted++;
    }
    if (emitted >= LOOP_NOTES_PER_TICK) {
      this.passCount.fill(0);
      this.passSpeed.fill(0);
    }
  }

  /* -------------------------------------------------------------- the rest of the GameMode contract */

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** The page's Ball Color repainted the balls: every ball takes its colour back (the colours are the sort). */
  onBallColorChange(ctx: ModeContext) {
    const v = this.view;
    for (const ball of ctx.getBalls()) {
      const k = ball.id - this.firstId;
      if (k >= 0 && k < this.n) ball.color = v.palette[v.colourOf[k]];
    }
  }
  /** A new world size lays the arena out again and maps every ball (and the frame-0 packing, kept in outer radii) onto it. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged || this.n === 0) return true;
    const v = this.view;
    const oldW = this.canvasW;
    const oldH = this.canvasH;
    const oldOuter = v.outer;
    this.layout(ctx);
    // the engine stretched the balls per axis about the centre: undo it and scale them with the arena instead
    const sx = oldW > 0 ? ctx.config.width / oldW : 1;
    const sy = oldH > 0 ? ctx.config.height / oldH : 1;
    const k = oldOuter > 0 ? v.outer / oldOuter : 1;
    for (const ball of ctx.getBalls()) {
      const id = ball.id - this.firstId;
      if (id < 0 || id >= this.n) continue;
      ball.x = v.cx + ((ball.x - v.cx) / (sx || 1)) * k;
      ball.y = v.cy + ((ball.y - v.cy) / (sy || 1)) * k;
      ball.vx *= k;
      ball.vy *= k;
      ball.radius = this.rho;
      this.px[id] = ball.x;
      this.py[id] = ball.y;
      this.ax[id] *= k;
      this.ay[id] *= k;
      this.bx[id] *= k;
      this.by[id] *= k;
    }
    return true;
  }
  /** The rings are the mode's own (no engine walls). */
  shouldSkipWallCollision() {
    return true;
  }
  /**
   * With contacts on, the fastest a ball may move in the next step when it outruns half its radius a sub-step (a very fast
   * sort): the engine then plans the step's sub-steps for it, so no pair of balls tunnels through each other; 0 otherwise
   * (the plain four sub-steps). The ghost gas needs no finer steps – every ring test is swept along a ball's whole path – and
   * neither does the remix (its places are analytic).
   */
  stepSpeedBound(ctx: ModeContext, stepSec: number): number {
    if (this.view.phase === "remix" || !this.settings.collisions) return 0;
    let fastest = 0;
    for (const ball of ctx.getBalls()) {
      const v2 = ball.vx * ball.vx + ball.vy * ball.vy;
      if (v2 > fastest) fastest = v2;
    }
    fastest = Math.sqrt(fastest);
    return (fastest * stepSec) / 4 > 0.5 * this.rho ? fastest : 0;
  }
  /** A Colour Sort run loops forever (the finder searches its first sort's outcomes instead of a length). */
  isFinished() {
    return false;
  }
  /** The loop contract: the last whole cycle (s), once there was one. */
  cycleSeconds(): number | null {
    return this.lastCycleMs > 0 ? this.lastCycleMs / 1000 : null;
  }
  loopSeams(): LoopSeams {
    const v = this.view;
    return { count: v.seams, lastMs: v.seams > 0 ? v.lastSeamMs : -1, nextMs: v.phase === "sort" ? -1 : this.seamMs };
  }
  getState() {
    const v = this.view;
    return { phase: v.phase, sorted: v.sorted, total: v.total, passes: v.passes, completions: v.completions, seams: v.seams, end: v.endReason };
  }
}
