/**
 * --- unlimited-sizes --- (plan step 16) The growth caps that were fixed numbers and are live at default values, as settings
 * whose defaults are exactly those numbers – so every default run, found seed, export and pinned print plays as before, and a
 * visitor can raise (or lower) them like any other value:
 *
 *  - `swarmLimit` (URL `swl`, default 200): the most full-physics balls a swarm grows to while nothing engages the
 *    extreme-values runtime – Multiply's escapes, the respawn timer and bounce math's ball copies (`MULTIPLY_MAX_BALLS`,
 *    `RESPAWN_MAX_BALLS`). A value past its slider engages the runtime like any other, and the swarm then grows on past 200:
 *    full-physics balls up to the run's full-ball limit, the rest into the crowd (lib/physics/limits.ts).
 *  - `fullBallLimit` (URL `fbl`, default 2,000): the most full-physics balls a run with the runtime engaged holds before new
 *    ones join the crowd (`OBJECT_BALL_LIMIT`; fewer the more rings each is checked against, `objectLimitFor()`), up to its
 *    memory-safety ceiling `MEMORY_CEILINGS.fullBallLimit`.
 *
 * Both travel in the physics config only when they differ from their defaults (`growthCapConfigOf()`), so a default config
 * and a default link carry nothing new. Pure: no settings.ts import (settings.ts spreads the fields and ranges in).
 */
import type { PhysicsConfig } from "./types";
import { OBJECT_BALL_LIMIT } from "@/lib/unlimited";
import { memoryCeiling } from "@/lib/uncap";

/** The swarm's ceiling at its default: Multiply's, the respawn timer's and bounce math's 200 balls. */
export const SWARM_LIMIT_DEFAULT = 200;
/** The full-physics balls a run holds at the default: the limits runtime's 2,000. */
export const FULL_BALL_LIMIT_DEFAULT = OBJECT_BALL_LIMIT;

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names; the number fields take any whole number from 1 / 16 up. */
export const GROWTH_CAP_RANGES = {
  swarmLimit: { min: 1, max: SWARM_LIMIT_DEFAULT, step: 1 },
  fullBallLimit: { min: 16, max: FULL_BALL_LIMIT_DEFAULT, step: 1 },
} as const;

/** The fields of the SimulatorSettings object (URL `swl`, `fbl`). */
export interface GrowthCapFields {
  swarmLimit: number;
  fullBallLimit: number;
}

export function defaultGrowthCapFields(): GrowthCapFields {
  return { swarmLimit: SWARM_LIMIT_DEFAULT, fullBallLimit: FULL_BALL_LIMIT_DEFAULT };
}

function wholeFrom(value: unknown, min: number): number | null {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) && n >= min ? Math.floor(n) : null;
}

/** The swarm's ceiling a run plays with: the config's own (a whole number from 1), else the default 200. */
export function swarmLimitOf(config: Partial<Pick<PhysicsConfig, "swarmLimit">>): number {
  return wholeFrom(config.swarmLimit, GROWTH_CAP_RANGES.swarmLimit.min) ?? SWARM_LIMIT_DEFAULT;
}

/** The full-physics balls a run with the runtime engaged may hold: the config's own (from 16, at most its memory-safety ceiling), else 2,000. */
export function fullBallLimitOf(config: Partial<Pick<PhysicsConfig, "fullBallLimit">>): number {
  const n = wholeFrom(config.fullBallLimit, GROWTH_CAP_RANGES.fullBallLimit.min);
  return n === null ? FULL_BALL_LIMIT_DEFAULT : memoryCeiling("fullBallLimit", n);
}

/** The physics-config patch of the fields: only what differs from the defaults (nothing in a default config). */
export function growthCapConfigOf(s: Partial<GrowthCapFields>): Pick<PhysicsConfig, "swarmLimit" | "fullBallLimit"> {
  const out: Pick<PhysicsConfig, "swarmLimit" | "fullBallLimit"> = {};
  if (typeof s.swarmLimit === "number" && s.swarmLimit !== SWARM_LIMIT_DEFAULT) out.swarmLimit = s.swarmLimit;
  if (typeof s.fullBallLimit === "number" && s.fullBallLimit !== FULL_BALL_LIMIT_DEFAULT) out.fullBallLimit = s.fullBallLimit;
  return out;
}

/**
 * The patch a live change sends the page's engine: both keys, `undefined` at a default (the engine reads an absent and an
 * undefined key alike, so a field moved back to its default plays as it always did).
 */
export function growthCapLivePatch(s: GrowthCapFields): Pick<PhysicsConfig, "swarmLimit" | "fullBallLimit"> {
  return { swarmLimit: s.swarmLimit !== SWARM_LIMIT_DEFAULT ? s.swarmLimit : undefined, fullBallLimit: s.fullBallLimit !== FULL_BALL_LIMIT_DEFAULT ? s.fullBallLimit : undefined };
}
