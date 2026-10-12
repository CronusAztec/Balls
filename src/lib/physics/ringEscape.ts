import type { PhysicsConfig } from "./types";
import { atLeastMin } from "@/lib/uncap";
import { LOOP_BASE_MIDI, degreeToMidi, scalarDegree } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";

/*
 * --- ring-escape --- Ring Escape (the loop family's oldest reel, "it takes three seconds to get through the first one 🔊"): a
 * white ball works its way out through a spiral of rainbow rings. No new mode – Classic's own rings, with:
 *
 * - **Gap layout** (`gapLayout`, URL `regl`): `even` – the classic rings, gap k at 2π·k / n (the default, every old run and
 *   link replays exactly) –, `random` – gap k anywhere, drawn from the run's seeded RNG (`engine.random()`, one draw a ring,
 *   inner to outer, right after the seed is reset and before the ball's launch angle) –, `aligned` – every gap at θ0, a
 *   straight channel – or `spiral` – gap k at θ0 + k · `gapSpiralStep` (degrees, URL `ress`; 0–90 on the slider, any value from
 *   0 typed). θ0 is `RING_GAP_THETA0` (0 rad, where the classic layout starts too). The angles are taken modulo 2π, so a gap
 *   starts in [0, 2π) like the classic ones (the canvas' wall walk relies on it).
 * - **Ring spin** (`ringSpin`, URL `resp`): `alternate` – even rings one way, odd rings the other (as always) – or `together`
 *   – every ring the same way at the same speed, so a spiral stays a spiral while it turns. The rig's flight prediction turns
 *   its rings the same way (lib/physics/rigged.ts).
 * - **Rainbow by ring** (`ringRainbow`, URL `rerb`): the rings red outside, through orange, yellow and green, to cyan inside
 *   (the canvas only; `ringRainbowHue()`).
 * - **Time in ring** (`ringTimer`, URL `retm`): "ring k: t s" in amber under the rings – the time the run has spent in the
 *   ring it is in (`RingTimer`, kept by ClassicMode from the broken rings and the simulation clock), "out in t s" once the last
 *   ring is behind it; with the loop HUD on, the HUD's counter shows it instead.
 * - **Ring sounds** (`ringSound`, URL `resn`): the loop family's voices (lib/audio/loopTones.ts through `ToneGenerator.playLoop()`)
 *   – a pentatonic pluck for every wall bounce, its degree fixed by the ring (`ringPluckHz()`: the outer, bigger rings low, the
 *   inner ones high), a progress-ladder step for every ring escaped, one degree higher each time (`ringStepHz()`), the last
 *   one accented, and the completion chord when the ball is out of the last ring.
 *
 * Find Simulation searches the hook itself: **ring-at** – the first ring escaped within ±0.5 s of a target second (outcomes.ts),
 * offered in Classic while one of these options is on (`ringEscapeActive()`). The preset "Rainbow spiral, 11 rings"
 * (`RING_ESCAPE_PRESET`) is the poster's look: a pure black page, eleven thin rainbow rings, the gaps stepping round, a white
 * ball with a short white trail, no title and no counter.
 *
 * Pure: the settings, the engine, the mode, the canvas and the tests all read it.
 */

export const GAP_LAYOUTS = ["even", "random", "aligned", "spiral"] as const;
export type GapLayout = (typeof GAP_LAYOUTS)[number];
export const RING_SPINS = ["alternate", "together"] as const;
export type RingSpin = (typeof RING_SPINS)[number];

export function isGapLayout(value: unknown): value is GapLayout {
  return typeof value === "string" && (GAP_LAYOUTS as readonly string[]).includes(value);
}
export function isRingSpin(value: unknown): value is RingSpin {
  return typeof value === "string" && (RING_SPINS as readonly string[]).includes(value);
}

/** The feature's fields of the SimulatorSettings object. */
export interface RingEscapeFields {
  /** even | random | aligned | spiral (URL `regl`). */
  gapLayout: GapLayout;
  /** Degrees between two neighbouring rings' gaps in the spiral layout; 0–90 on the slider, any value from 0 typed (URL `ress`). */
  gapSpiralStep: number;
  /** alternate | together (URL `resp`). */
  ringSpin: RingSpin;
  /** The rings in a rainbow by ring: red outside to cyan inside (URL `rerb`). */
  ringRainbow: boolean;
  /** The "ring k: t s" line under the rings (URL `retm`). */
  ringTimer: boolean;
  /** Plucks per bounce, a rising step per ring escaped, the chord at the way out (URL `resn`). */
  ringSound: boolean;
}

export const DEFAULT_RING_ESCAPE_FIELDS: Readonly<RingEscapeFields> = {
  gapLayout: "even",
  gapSpiralStep: 30,
  ringSpin: "alternate",
  ringRainbow: false,
  ringTimer: false,
  ringSound: false,
};

export function defaultRingEscapeFields(): RingEscapeFields {
  return { ...DEFAULT_RING_ESCAPE_FIELDS };
}

/** The slider's comfort range (the value is uncapped from its minimum: 120° or 720° steps are spirals too). */
export const RING_ESCAPE_RANGES = {
  gapSpiralStep: { min: 0, max: 90, step: 0.5 },
} as const;

/*
 * The spiral's step is an angle: any value is a layout, never an extreme, so it is not one of the engine keys that engage the
 * extreme-values runtime (settings.ts' MODE_ENGINE_KEYS) – a 120° or a 720° step runs the plain physics, like 30°.
 */

/** Where the aligned and the spiral layouts put the innermost ring's gap (rad): where the classic layout starts. */
export const RING_GAP_THETA0 = 0;

const TWO_PI = Math.PI * 2;

/** Validates the fields (links, presets and project files alike): known layouts and spins, a step from 0 up (no maximum), real booleans. */
export function resolveRingEscapeFields(source: Partial<Record<keyof RingEscapeFields, unknown>> | null | undefined): RingEscapeFields {
  const s = source ?? {};
  const d = DEFAULT_RING_ESCAPE_FIELDS;
  const step = typeof s.gapSpiralStep === "number" && Number.isFinite(s.gapSpiralStep) ? atLeastMin(s.gapSpiralStep, RING_ESCAPE_RANGES.gapSpiralStep) : d.gapSpiralStep;
  return {
    gapLayout: isGapLayout(s.gapLayout) ? s.gapLayout : d.gapLayout,
    gapSpiralStep: step,
    ringSpin: isRingSpin(s.ringSpin) ? s.ringSpin : d.ringSpin,
    ringRainbow: typeof s.ringRainbow === "boolean" ? s.ringRainbow : d.ringRainbow,
    ringTimer: typeof s.ringTimer === "boolean" ? s.ringTimer : d.ringTimer,
    ringSound: typeof s.ringSound === "boolean" ? s.ringSound : d.ringSound,
  };
}

/** True when one of the feature's options is on (the panel's ring-at outcome of Find Simulation is offered then). */
export function ringEscapeActive(s: RingEscapeFields): boolean {
  const d = DEFAULT_RING_ESCAPE_FIELDS;
  return s.gapLayout !== d.gapLayout || s.ringSpin !== d.ringSpin || s.ringRainbow || s.ringTimer || s.ringSound;
}

/* ------------------------------------------------------------------ the physics config */

/** The config the engine runs Classic's rings with (every value: the page's live updates set them back to the defaults too). */
export function ringEscapeConfigOf(s: Pick<RingEscapeFields, "gapLayout" | "gapSpiralStep" | "ringSpin" | "ringSound">): Required<Pick<PhysicsConfig, "gapLayout" | "gapSpiralStep" | "ringSpin" | "ringSound">> {
  return { gapLayout: s.gapLayout, gapSpiralStep: s.gapSpiralStep, ringSpin: s.ringSpin, ringSound: s.ringSound };
}

/** The same, only the values that differ from the defaults (nothing for a classic run: the bot's plans stay as they were). */
export function ringEscapeConfigIfSet(s: Pick<RingEscapeFields, "gapLayout" | "gapSpiralStep" | "ringSpin" | "ringSound">): Partial<PhysicsConfig> {
  const d = DEFAULT_RING_ESCAPE_FIELDS;
  const out: Partial<PhysicsConfig> = {};
  if (s.gapLayout !== d.gapLayout) out.gapLayout = s.gapLayout;
  if (s.gapLayout === "spiral" && s.gapSpiralStep !== d.gapSpiralStep) out.gapSpiralStep = s.gapSpiralStep;
  if (s.ringSpin !== d.ringSpin) out.ringSpin = s.ringSpin;
  if (s.ringSound) out.ringSound = true;
  return out;
}

/* ------------------------------------------------------------------ URL */

function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Writes the fields that differ from `base`: regl, ress, resp, rerb, retm, resn. */
export function writeRingEscapeParams(settings: RingEscapeFields, base: RingEscapeFields, params: URLSearchParams) {
  if (settings.gapLayout !== base.gapLayout) params.set("regl", settings.gapLayout);
  if (settings.gapSpiralStep !== base.gapSpiralStep) params.set("ress", formatNumber(settings.gapSpiralStep));
  if (settings.ringSpin !== base.ringSpin) params.set("resp", settings.ringSpin);
  if (settings.ringRainbow !== base.ringRainbow) params.set("rerb", settings.ringRainbow ? "1" : "0");
  if (settings.ringTimer !== base.ringTimer) params.set("retm", settings.ringTimer ? "1" : "0");
  if (settings.ringSound !== base.ringSound) params.set("resn", settings.ringSound ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` (validated: an invalid value keeps what it was). */
export function readRingEscapeParams(params: URLSearchParams, settings: RingEscapeFields) {
  // (only the feature's own fields: the settings object is large, and a link is parsed often)
  const next: Partial<Record<keyof RingEscapeFields, unknown>> = { gapLayout: settings.gapLayout, gapSpiralStep: settings.gapSpiralStep, ringSpin: settings.ringSpin, ringRainbow: settings.ringRainbow, ringTimer: settings.ringTimer, ringSound: settings.ringSound };
  const layout = params.get("regl");
  if (isGapLayout(layout)) next.gapLayout = layout;
  const rawStep = params.get("ress");
  if (rawStep !== null && rawStep.trim() !== "") {
    const step = Number(rawStep);
    if (Number.isFinite(step)) next.gapSpiralStep = step;
  }
  const spin = params.get("resp");
  if (isRingSpin(spin)) next.ringSpin = spin;
  const bool = (key: string, field: "ringRainbow" | "ringTimer" | "ringSound") => {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  };
  bool("rerb", "ringRainbow");
  bool("retm", "ringTimer");
  bool("resn", "ringSound");
  Object.assign(settings, resolveRingEscapeFields(next));
}

/* ------------------------------------------------------------------ the gaps */

/** A gap layout as the engine builds it: the layout and the spiral's step in radians. */
export interface RingGapPlan {
  layout: GapLayout;
  stepRad: number;
}

/** The layout of `config` for Classic's rings, or null for the classic even one (the engine then takes its own formula, unchanged). */
export function ringGapPlanOf(config: Pick<PhysicsConfig, "gapLayout" | "gapSpiralStep">): RingGapPlan | null {
  const layout = isGapLayout(config.gapLayout) ? config.gapLayout : "even";
  if (layout === "even") return null;
  const deg = typeof config.gapSpiralStep === "number" && Number.isFinite(config.gapSpiralStep) ? atLeastMin(config.gapSpiralStep, RING_ESCAPE_RANGES.gapSpiralStep) : DEFAULT_RING_ESCAPE_FIELDS.gapSpiralStep;
  return { layout, stepRad: (deg * Math.PI) / 180 };
}

/** An angle in [0, 2π). */
export function wrapAngle(angle: number): number {
  const a = angle % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/**
 * Where ring `index` (0 = the innermost) of `count` starts its gap (rad, in [0, 2π)): even 2π·index / count, aligned θ0,
 * spiral θ0 + index · step, random 2π · `draw()` (one draw a ring – call it inner to outer).
 */
export function ringGapStart(layout: GapLayout, index: number, count: number, stepRad: number, draw: () => number): number {
  switch (layout) {
    case "random":
      return wrapAngle(TWO_PI * draw());
    case "aligned":
      return wrapAngle(RING_GAP_THETA0);
    case "spiral":
      return wrapAngle(RING_GAP_THETA0 + index * stepRad);
    default:
      return (TWO_PI * index) / Math.max(1, count);
  }
}

/* ------------------------------------------------------------------ the rainbow */

/** The hue (degrees) of ring `index` of `count` in the rainbow by ring: 180 (cyan) for the innermost, 0 (red) for the outermost. */
export function ringRainbowHue(index: number, count: number): number {
  if (!(count > 1)) return 0;
  const i = index < 0 ? 0 : index > count - 1 ? count - 1 : index;
  return (180 * (count - 1 - i)) / (count - 1);
}

/* ------------------------------------------------------------------ the time in the ring */

/** What the run has done with its rings (ClassicMode's `RingTimer`; the canvas, the HUD, the finder and the tests read it). */
export interface RingEscapeView {
  /** Rings the run has (0 before the rings are built). */
  rings: number;
  /** Rings escaped so far. */
  escaped: number;
  /** The ring the run is in, from 1 (the innermost); rings + 1 once it is out. */
  ring: number;
  /** Simulation time (ms) the run entered its current ring (0: the start). */
  enteredMs: number;
  /** Simulation time (ms) of the first escape, −1 before it. */
  firstMs: number;
  /** Simulation time (ms) the last ring was escaped, −1 before it. */
  outMs: number;
}

/**
 * The time the run spends in each ring: fed once a fixed step with the broken rings and the simulation clock (allocation-free
 * but for a push on an escape). A ring broken under the ball is an escape (Classic breaks a ring when a ball passes its gap);
 * rings built anew (a new wall count) start the count over from the rings broken then.
 */
export class RingTimer {
  private readonly view: RingEscapeView = { rings: 0, escaped: 0, ring: 1, enteredMs: 0, firstMs: -1, outMs: -1 };
  /** Simulation time (ms) of every escape so far, in order. */
  readonly escapes: number[] = [];

  reset(rings = 0) {
    const v = this.view;
    v.rings = Math.max(0, rings);
    v.escaped = 0;
    v.ring = 1;
    v.enteredMs = 0;
    v.firstMs = -1;
    v.outMs = -1;
    this.escapes.length = 0;
  }

  /** One step: `broken` rings of `rings` at simulation time `nowMs`. Returns how many rings were escaped in this step. */
  step(broken: number, rings: number, nowMs: number): number {
    const v = this.view;
    v.rings = Math.max(0, rings);
    const b = Math.max(0, Math.min(broken, v.rings));
    if (b < v.escaped) {
      // the rings were built anew: the run is in the ring after the ones broken now, from now on
      v.escaped = b;
      v.enteredMs = nowMs;
      v.outMs = -1;
      this.escapes.length = Math.min(this.escapes.length, b);
    }
    const fresh = b - v.escaped;
    for (let i = 0; i < fresh; i++) this.escapes.push(nowMs);
    if (fresh > 0) {
      if (v.firstMs < 0) v.firstMs = nowMs;
      v.escaped = b;
      v.enteredMs = nowMs;
      if (v.rings > 0 && b >= v.rings) v.outMs = nowMs;
    }
    v.ring = v.escaped + 1;
    return fresh;
  }

  /** The rings were built anew between steps (a new wall count before the run starts): the view counts them at once. */
  syncRings(rings: number) {
    this.view.rings = Math.max(0, rings);
  }

  getView(): Readonly<RingEscapeView> {
    return this.view;
  }
}

/** Seconds the run has spent in its current ring at `nowMs` (frozen at the way out: the time of the last escape). */
export function timeInRingSec(view: Readonly<RingEscapeView>, nowMs: number): number {
  if (view.outMs >= 0) return view.outMs / 1000;
  return Math.max(0, nowMs - view.enteredMs) / 1000;
}

/** True once the run has left its last ring. */
export function ringRunOut(view: Readonly<RingEscapeView>): boolean {
  return view.rings > 0 && view.outMs >= 0;
}

/* ------------------------------------------------------------------ the sounds */

/** The plucks' span of pentatonic degrees over the rings (2.4 octaves from C3: C3–E5, inside C3–C6). */
export const RING_PLUCK_SPAN = 12;
/** The ladder's root (C5): its first step sits on G5 (degree 3), its eleventh on G7 – inside the 1–3.5 kHz of the recipe's steps. */
export const RING_STEP_ROOT_MIDI = 72;
export const RING_STEP_FIRST_DEGREE = 3;
/** The ladder wraps after this many degrees (2.6 octaves), so a thousand rings stay in register. */
export const RING_STEP_WRAP = 13;
/** The completion chord's root: G2, the dominant of C (inside the recipe's 98–110 Hz). */
export const RING_CHORD_HZ = 97.999;

/** The pluck of a bounce off ring `index` of `count` (Hz): the ring's fixed degree of C major pentatonic, the outer rings low. */
export function ringPluckHz(index: number, count: number): number {
  const degree = scalarDegree(index, 0, Math.max(1, count - 1), RING_PLUCK_SPAN, true);
  return midiToFrequency(degreeToMidi(degree, LOOP_BASE_MIDI));
}

/** The ladder step of the `k`-th ring escaped (0 = the first): one pentatonic degree higher each time, wrapping in register. */
export function ringStepHz(k: number): number {
  const step = Number.isFinite(k) && k > 0 ? Math.floor(k) % RING_STEP_WRAP : 0;
  return midiToFrequency(degreeToMidi(RING_STEP_FIRST_DEGREE + step, RING_STEP_ROOT_MIDI));
}

/** A bounce's pluck level from its radial speed: 0.8 + 0.2 × the speed over the Ball Speed (narrow, as measured). */
export function ringPluckLevel(radialSpeed: number, ballSpeed: number): number {
  const norm = ballSpeed > 0 && Number.isFinite(radialSpeed) ? Math.min(1, Math.abs(radialSpeed) / ballSpeed) : 0;
  return 0.8 + 0.2 * norm;
}

/* ------------------------------------------------------------------ the preset */

/**
 * "Rainbow spiral, 11 rings": the poster's look – a pure black page, eleven thin rainbow rings whose gaps step round in a spiral
 * and turn together, a white ball with a short white trail, the ring sounds; no title, no counter.
 */
export const RING_ESCAPE_PRESET = {
  wallCount: 11,
  // the gaps a little wider and the ball a little faster than Classic's own: the first ring takes about 1.7 s at the median (one
  // seed in seven gets through it at 3 ± 0.5 s – Find Simulation's ring-at finds one in a few dozen) and the way out about 30 s
  gapSize: 0.8,
  ballSpeed: 500,
  gapLayout: "spiral" as GapLayout,
  gapSpiralStep: 30,
  ringSpin: "together" as RingSpin,
  ringRainbow: true,
  ringTimer: false,
  ringSound: true,
  rotationEnabled: true,
  rotationSpeed: 1,
  wallThickness: 2,
  showWallGlow: false,
  showGlow: false,
  rainbowWalls: false,
  ballColor: "#FFFFFF",
  showTrails: true,
  colorTrail: false,
  trailThickness: 0.6,
  reactiveBackground: false,
  themeId: "",
  backgroundType: "solid" as const,
  backgroundColors: ["#000000", "#000000"] as string[],
  loopHud: false,
};
