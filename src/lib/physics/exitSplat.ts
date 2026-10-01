import type { ModeId, PhysicsConfig } from "./types";
import { atLeastMin, memoryCeiling } from "@/lib/uncap";

/**
 * --- gerald-exit-splat --- Moving exits and splat barriers for the ring modes, after two formats of the character-ball
 * account ("solving the case of the moving exit" and "Splat Barrier Demo"). This module holds the settings – their
 * defaults, slider ranges, URL keys and validation – and the physics config they travel in; the runtime lives in
 * movingExits.ts (the exits) and splats.ts (the splats), both owned by the engine.
 *
 * - **Exit behaviour** (`exitBehavior`, URL `exit`): `rotate` – the exits turn with their rings, as they always did (the
 *   default; nothing else changes) –, `jump` – every ring's exit teleports to a new seeded angle every `exitJumpSeconds`
 *   (URL `exj`) or as soon as a ball comes within `exitSense` degrees (URL `exs`) of it –, `flee` – the exit runs away from
 *   the ball along its ring at up to `exitFleeSpeed` degrees a second (URL `exf`) while the ball is within `exitSense` – and
 *   `shrink` – the exit narrows over `exitJumpSeconds` until it closes, then opens again elsewhere. With a moving exit the
 *   rings hold still: the exit moves by itself. Classic, Accumulation and Multiply (the ring modes whose rings have one exit
 *   each); the others keep their rings as they are.
 * - **Splat barrier** (`splatBarrier`, URL `splat`): every wall hit leaves a splat of paint in the ball's colour at the
 *   impact point on the inside of the wall – `splatSize` × the ball's radius (URL `sps`) – which is a solid circle of the
 *   obstacle layer, so the ball builds its own barrier; past `splatMax` splats (URL `spm`) the oldest fade out. In the ring
 *   modes (Grow's splats only paint its ring: the ball grows to fill it).
 *
 * Everything is off by default, so a run without it takes exactly the old code path, and it is deterministic (seeded
 * through the engine's RNG), so Find Simulation, the fast export and recordings replay it.
 */

export const EXIT_BEHAVIORS = ["rotate", "jump", "flee", "shrink"] as const;
export type ExitBehavior = (typeof EXIT_BEHAVIORS)[number];

export function isExitBehavior(value: unknown): value is ExitBehavior {
  return typeof value === "string" && (EXIT_BEHAVIORS as readonly string[]).includes(value);
}

/** The ring modes whose rings have one exit each that may move: the exit behaviour applies there (the rest keep their rings). */
export const MOVING_EXIT_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply"];
/** The ring modes whose wall hits leave splats (Shatter and Color Match colour their walls themselves). */
export const SPLAT_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "grow"];

export function supportsMovingExits(mode: ModeId | null | undefined): boolean {
  return !!mode && MOVING_EXIT_MODES.includes(mode);
}

export function supportsSplats(mode: ModeId | null | undefined): boolean {
  return !!mode && SPLAT_MODES.includes(mode);
}

/** Splats are solid – the ball bounces off them – everywhere but Grow, whose ball grows to fill its ring: there they only paint it. */
export function splatsSolidIn(mode: ModeId | null | undefined): boolean {
  return supportsSplats(mode) && mode !== "grow";
}

/** The feature's fields of the SimulatorSettings object (and of the physics config, under the same names). */
export interface ExitSplatFields {
  /** rotate | jump | flee | shrink (URL `exit`). */
  exitBehavior: ExitBehavior;
  /** Jump: seconds between two jumps; shrink: seconds an exit takes to close (URL `exj`). */
  exitJumpSeconds: number;
  /** Degrees round the ring a ball may come to an exit before it reacts – jumps away or runs; 0 = never (URL `exs`). */
  exitSense: number;
  /** Flee: the exit's top speed along its ring, degrees a second (URL `exf`). */
  exitFleeSpeed: number;
  /** Wall hits leave solid splats (URL `splat`). */
  splatBarrier: boolean;
  /** A splat's radius as a multiple of the ball's (URL `sps`). */
  splatSize: number;
  /** The most splats at once; past it the oldest fade out (URL `spm`). */
  splatMax: number;
}

export const DEFAULT_EXIT_SPLAT: Readonly<ExitSplatFields> = {
  exitBehavior: "rotate",
  exitJumpSeconds: 3,
  exitSense: 20,
  exitFleeSpeed: 40,
  splatBarrier: false,
  splatSize: 1,
  splatMax: 60,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const EXIT_SPLAT_RANGES = {
  exitJumpSeconds: { min: 1, max: 10, step: 0.5 },
  exitSense: { min: 0, max: 90, step: 5 },
  exitFleeSpeed: { min: 10, max: 360, step: 5 },
  splatSize: { min: 0.5, max: 2, step: 0.05 },
  splatMax: { min: 10, max: 300, step: 1 },
} as const;

/** The feature's numeric fields. */
export const EXIT_SPLAT_NUMBER_KEYS = ["exitJumpSeconds", "exitSense", "exitFleeSpeed", "splatSize", "splatMax"] as const;
type NumberKey = (typeof EXIT_SPLAT_NUMBER_KEYS)[number];
/** The numeric fields the moving exits read (the engines of `MOVING_EXIT_MODES`). */
export const EXIT_ENGINE_KEYS: readonly NumberKey[] = ["exitJumpSeconds", "exitSense", "exitFleeSpeed"];
/** The numeric fields the splat barrier reads (the engines of `SPLAT_MODES`). */
export const SPLAT_ENGINE_KEYS: readonly NumberKey[] = ["splatSize", "splatMax"];

/** The defaults of the feature's fields. */
export function defaultExitSplatFields(): ExitSplatFields {
  return { ...DEFAULT_EXIT_SPLAT };
}

/** A number of `key` from anything: finite and from the slider's minimum up (lifted onto it below; --- uncap-all --- never a maximum). */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_EXIT_SPLAT[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const v = atLeastMin(n, EXIT_SPLAT_RANGES[key]);
  return key === "splatMax" ? Math.round(v) : v;
}

/** Validates the feature's fields (URL parameters, presets and project files alike): known behaviour, real boolean, numbers from their minimum up. */
export function resolveExitSplatFields(source: Partial<Record<keyof ExitSplatFields, unknown>> | null | undefined): ExitSplatFields {
  const s = source ?? {};
  return {
    exitBehavior: isExitBehavior(s.exitBehavior) ? s.exitBehavior : DEFAULT_EXIT_SPLAT.exitBehavior,
    exitJumpSeconds: numberOf("exitJumpSeconds", s.exitJumpSeconds),
    exitSense: numberOf("exitSense", s.exitSense),
    exitFleeSpeed: numberOf("exitFleeSpeed", s.exitFleeSpeed),
    splatBarrier: typeof s.splatBarrier === "boolean" ? s.splatBarrier : DEFAULT_EXIT_SPLAT.splatBarrier,
    splatSize: numberOf("splatSize", s.splatSize),
    splatMax: numberOf("splatMax", s.splatMax),
  };
}

/** The physics config of the feature (the page's config effect, the seed finder, the arenas, the fast export and the bot all carry it). */
export function exitSplatConfigOf(s: ExitSplatFields): Pick<PhysicsConfig, keyof ExitSplatFields> {
  return {
    exitBehavior: s.exitBehavior,
    exitJumpSeconds: s.exitJumpSeconds,
    exitSense: s.exitSense,
    exitFleeSpeed: s.exitFleeSpeed,
    splatBarrier: s.splatBarrier,
    splatSize: s.splatSize,
    splatMax: s.splatMax,
  };
}

/** The feature's fields out of the settings: they carry over to the next mode (like the obstacle layout) and into the engine's config. */
export function exitSplatCarryOver(s: ExitSplatFields): ExitSplatFields {
  return {
    exitBehavior: s.exitBehavior,
    exitJumpSeconds: s.exitJumpSeconds,
    exitSense: s.exitSense,
    exitFleeSpeed: s.exitFleeSpeed,
    splatBarrier: s.splatBarrier,
    splatSize: s.splatSize,
    splatMax: s.splatMax,
  };
}

/** What the engine runs: the config's values (defaults for the missing ones), angles in radians, the splat count at its memory-safety ceiling. */
export interface ResolvedExitSplat {
  behavior: ExitBehavior;
  /** Seconds between jumps / to close, ≥ 1. */
  jumpSec: number;
  /** The exit's sense in radians (0 = never reacts; π or more = always). */
  senseRad: number;
  /** The fleeing exit's top speed in radians a second. */
  fleeRadPerSec: number;
  splats: boolean;
  /** A splat's radius ÷ the ball's. */
  splatSize: number;
  /** The most splats at once (at most `MEMORY_CEILINGS.splatMax`). */
  splatMax: number;
}

export function resolveExitSplatConfig(config: Partial<PhysicsConfig> | null | undefined): ResolvedExitSplat {
  const f = resolveExitSplatFields(config ?? {});
  return {
    behavior: f.exitBehavior,
    jumpSec: f.exitJumpSeconds,
    senseRad: (f.exitSense * Math.PI) / 180,
    fleeRadPerSec: (f.exitFleeSpeed * Math.PI) / 180,
    splats: f.splatBarrier,
    splatSize: f.splatSize,
    splatMax: memoryCeiling("splatMax", f.splatMax),
  };
}

/* ------------------------------------------------------------------ URL */

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields. */
export const EXIT_SPLAT_URL_KEYS: Readonly<Record<string, NumberKey>> = { exj: "exitJumpSeconds", exs: "exitSense", exf: "exitFleeSpeed", sps: "splatSize", spm: "splatMax" };

/** Writes the fields that differ from `base` (the mode's defaults): exit, exj, exs, exf, splat, sps, spm. */
export function writeExitSplatParams(settings: ExitSplatFields, base: ExitSplatFields, params: URLSearchParams) {
  if (settings.exitBehavior !== base.exitBehavior) params.set("exit", settings.exitBehavior);
  for (const [key, field] of Object.entries(EXIT_SPLAT_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.splatBarrier !== base.splatBarrier) params.set("splat", settings.splatBarrier ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readExitSplatParams(params: URLSearchParams, settings: ExitSplatFields) {
  const next: Partial<Record<keyof ExitSplatFields, unknown>> = { ...settings };
  const exit = params.get("exit");
  if (exit !== null) next.exitBehavior = exit;
  for (const [key, field] of Object.entries(EXIT_SPLAT_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  const splat = params.get("splat");
  if (splat === "1") next.splatBarrier = true;
  else if (splat === "0") next.splatBarrier = false;
  Object.assign(settings, resolveExitSplatFields(next));
}
