/*
 * --- blueprint --- The Blueprint sandbox's ceilings and the shape of a spec: how many of each list a spec may hold and how
 * long its texts may be. The work and memory ceilings themselves live in lib/uncap.ts (`BLUEPRINT_CEILINGS`, with every
 * other memory-safety ceiling of the app) and are re-exported here; the counts below are the language's design: a spec that
 * fits them is small enough for a link, for a 1.5B local model's grammar and for a 500-token prompt vocabulary.
 *
 * A protected file (scripts/agent/protected.json): raising a number here changes what a stranger's link may cost a visitor's
 * tab, so it needs the owner's review.
 */
import {
  BLUEPRINT_BALL_CEILING,
  BLUEPRINT_CEILINGS,
  BLUEPRINT_EVENTS_PER_STEP,
  BLUEPRINT_JSON_MAX_BYTES,
  BLUEPRINT_OBSTACLE_CEILING,
  BLUEPRINT_RULE_CEILING,
  BLUEPRINT_RULE_FIRINGS_PER_STEP,
  BLUEPRINT_SOUNDS_PER_STEP,
  BLUEPRINT_SPAWNS_PER_STEP,
  BLUEPRINT_TILE_CEILING,
  BLUEPRINT_TIMEOUT_CEILING_SEC,
} from "@/lib/uncap";

export {
  BLUEPRINT_BALL_CEILING,
  BLUEPRINT_CEILINGS,
  BLUEPRINT_EVENTS_PER_STEP,
  BLUEPRINT_JSON_MAX_BYTES,
  BLUEPRINT_OBSTACLE_CEILING,
  BLUEPRINT_RULE_CEILING,
  BLUEPRINT_RULE_FIRINGS_PER_STEP,
  BLUEPRINT_SOUNDS_PER_STEP,
  BLUEPRINT_SPAWNS_PER_STEP,
  BLUEPRINT_TILE_CEILING,
  BLUEPRINT_TIMEOUT_CEILING_SEC,
};

/** The shape of one spec: list lengths, text lengths and the few design domains a spec's structure has. */
export const BLUEPRINT_LIMITS = {
  /** meta.name, characters. */
  nameChars: 28,
  /** meta.description, characters. */
  descriptionChars: 160,
  /** A result line (`say`) and the timeout's line, characters. */
  sayChars: 40,
  /** A HUD label and a team name, characters. */
  labelChars: 16,
  /** Ids of bodies and variables: a lower-case letter, then letters or digits. */
  idChars: 8,
  bodies: 4,
  exits: 4,
  obstaclePatterns: 8,
  vars: 4,
  spawners: 6,
  rules: BLUEPRINT_RULE_CEILING,
  actionsPerRule: 4,
  finishConditions: 3,
  hud: 2,
  /** Sliders a spec offers (`params`, Mode Lab's panel and the `blv` link key). */
  params: 4,
  palette: 6,
  teams: 6,
  /** Rings of a "rings" arena. */
  rings: 8,
  /** Tile rows and columns (their product stops at the tile ceiling). */
  tileRows: 24,
  tileCols: 48,
  /** Balls one spawner, spawn or split makes at once. */
  perSpawn: 8,
  /** The tier a ball can reach (tiers past it stay there). */
  maxTier: 99,
  /** A spawner's `maxTotal` and every other count of balls stop at the ball ceiling. */
  balls: BLUEPRINT_BALL_CEILING,
  tiles: BLUEPRINT_TILE_CEILING,
  obstacles: BLUEPRINT_OBSTACLE_CEILING,
  /** finish.timeoutSec: from 5 s (a clip) to the run ceiling. */
  minTimeoutSec: 5,
  maxTimeoutSec: BLUEPRINT_TIMEOUT_CEILING_SEC,
  /** arena.size: the part of the recorder's square the arena fills. */
  minArenaSize: 0.5,
  maxArenaSize: 0.95,
  /** The canonical JSON of one spec, UTF-8 bytes. */
  specBytes: BLUEPRINT_JSON_MAX_BYTES,
  /** How many entries of any list the sanitiser looks at (a million-entry list costs no more than this). */
  scanEntries: 64,
} as const;

/** Per-step work budgets of a run (the interpreter counts what it drops past them). */
export const BLUEPRINT_STEP_BUDGETS = {
  events: BLUEPRINT_EVENTS_PER_STEP,
  ruleFirings: BLUEPRINT_RULE_FIRINGS_PER_STEP,
  spawns: BLUEPRINT_SPAWNS_PER_STEP,
  sounds: BLUEPRINT_SOUNDS_PER_STEP,
} as const;

/** Sub-steps of one 60 Hz step: at least the engine's 4, more for fast balls, never more than this (work ceiling). */
export const BLUEPRINT_MAX_SUBSTEPS = 16;
