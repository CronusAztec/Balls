/*
 * --- blueprint --- The Blueprint language v1: a game mode described as data, so a new mechanic is a JSON spec run by one
 * sandboxed interpreter (lib/blueprint/runtime/) instead of new engine code. ('Blueprint', because 'recipe' already names the
 * bot's RECIPES.) This file holds the types of a resolved spec (every field present: what sanitize.ts returns and the runtime
 * reads), the vocabulary with one line of meaning per word (describe.ts, docs.ts and the JSON Schema read the same lines),
 * and the defaults a compact spec leaves out (codec.ts).
 *
 * Units. Bodies are in world px like every mode (a ball of radius 8 px, 400 px/s, gravity 300 px/s²; the world's shorter
 * side is 450 px). Arena geometry – obstacles and tile areas – is in arena units: −1…1 from the centre, 1 = the rim, so a
 * layout keeps its shape at any arena size. Angles are degrees on a clock face: 0 = top, 90 = right, 180 = bottom, 270 = left.
 *
 * Pure: no DOM, no engine, no settings import.
 */

/* ------------------------------------------------------------------ the vocabulary */

export const BLUEPRINT_VERSION = 1;

export const BLUEPRINT_FAMILIES = ["escape", "rhythm", "battle"] as const;
export type BlueprintFamily = (typeof BLUEPRINT_FAMILIES)[number];

export const BLUEPRINT_AUTHORS = ["builtin", "ai", "user"] as const;
export type BlueprintAuthor = (typeof BLUEPRINT_AUTHORS)[number];

/** Features a spec may say it needs (`meta.needs`). v1 knows none: a spec naming one is from a newer version. */
export const BLUEPRINT_FEATURES: readonly string[] = [];

export const ARENA_SHAPES = ["circle", "box", "rings"] as const;
export type ArenaShape = (typeof ARENA_SHAPES)[number];

export const BODY_COLLIDE = ["bounce", "pass"] as const;
export type BodyCollide = (typeof BODY_COLLIDE)[number];

export const TILE_LAYOUTS = ["grid", "ring"] as const;
export type TileLayout = (typeof TILE_LAYOUTS)[number];
export const TILE_STYLES = ["glass", "brick", "neon"] as const;
export type TileStyle = (typeof TILE_STYLES)[number];
export const TILE_PITCH = ["row", "col", "none"] as const;
export type TilePitch = (typeof TILE_PITCH)[number];

export const OBSTACLE_KINDS = ["peg", "bumper", "pegGrid", "pegRing", "bar", "spinner"] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export const SPAWN_AT = ["center", "top", "bottom", "left", "right", "random", "rim"] as const;
export type SpawnAt = (typeof SPAWN_AT)[number];
/** Where an action's new balls appear: a spawner's places plus the subject ball and the event's tile. */
export const ACTION_AT = ["self", "tile", ...SPAWN_AT] as const;
export type ActionAt = (typeof ACTION_AT)[number];

export const DIRECTIONS = ["random", "up", "down", "left", "right", "out", "in"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const IMPULSE_DIRECTIONS = [...DIRECTIONS, "away"] as const;
export type ImpulseDirection = (typeof IMPULSE_DIRECTIONS)[number];

export const TRIGGERS = ["start", "timer", "beat", "bar", "wallHit", "obstacleHit", "tileHit", "tileBroken", "ballHit", "escape", "ringPass", "countReached"] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** One line per trigger: what fires it and which ball it is about ("self"). */
export const TRIGGER_DOCS: Readonly<Record<Trigger, string>> = {
  start: "once, when the run starts (after the first balls appear)",
  timer: "every `sec` seconds",
  beat: "on every beat of `sound.bpm`",
  bar: "on every fourth beat",
  wallHit: "a ball (self) bounces off the rim, a box wall or a ring",
  obstacleHit: "a ball (self) hits a peg, bumper, bar or spinner",
  tileHit: "a ball (self) hits a tile (every hit chips 1 HP off it)",
  tileBroken: "a ball (self) breaks a tile (the `tile` spawn point is where it was)",
  ballHit: "two balls start to touch (once a contact): self is the one that was faster before (or the one `of` names), other the second",
  escape: "a ball (self) leaves the arena through an exit or past the last ring",
  ringPass: "a ball (self) passes outward through a ring's gap",
  countReached: "a count (`what`) crosses `atLeast` or `atMost` (fires again only after it goes back)",
};

/** Triggers that are about a ball: their actions' `self` is that ball (the others act on every ball of `of`). */
export const BALL_TRIGGERS: ReadonlySet<Trigger> = new Set(["wallHit", "obstacleHit", "tileHit", "tileBroken", "ballHit", "escape", "ringPass"]);

/** `with` of a ballHit rule: a body id, or one of these relations of the other ball to self. */
export const WITH_RELATIONS = ["any", "same", "sameTier", "sameTeam", "otherTeam"] as const;
export type WithRelation = (typeof WITH_RELATIONS)[number];

/** What a count reads (countReached, a count finish, the HUD): these, or a variable's id. */
export const COUNT_REFS = ["balls", "tiles", "rings", "escaped", "teams", "tier", "time", "fit"] as const;
export type CountRef = (typeof COUNT_REFS)[number];
export const COUNT_DOCS: Readonly<Record<CountRef, string>> = {
  balls: "balls in the arena (of `of`, when given)",
  tiles: "tiles left",
  rings: "rings left",
  escaped: "balls that escaped (of `of`, when given)",
  teams: "teams with a ball in the arena",
  tier: "the highest tier of a ball in the arena",
  time: "seconds of the run",
  // --- review fix (blueprint) --- (a growing ball's escape ends when it no longer fits: `count fit atMost 0`)
  fit: "balls in the arena small enough to pass between the edges of a rim exit (of `of`, when given; none without exits)",
};

export const ACTIONS = ["spawn", "split", "merge", "remove", "grow", "speed", "recolor", "tier", "team", "damage", "var", "impulse", "fx", "sound"] as const;
export type ActionKind = (typeof ACTIONS)[number];

/** One line per action. `target` (self | other | all) picks the balls a ball action changes; formulas are allowed where a number says "(f)". */
export const ACTION_DOCS: Readonly<Record<ActionKind, string>> = {
  spawn: "new balls: body, count (f), at self|tile|center|top|bottom|left|right|random|rim, speed (f, px/s), dir",
  split: "the ball becomes `into` (f, 2-8) balls fanned out, each radius × `scale`",
  merge: "other merges into self: tier + 1, radius = max × `scale` (default: areas add up)",
  remove: "the ball disappears (no escape)",
  grow: "radius + `by` px (f; negative shrinks; below 1 px the ball pops)",
  speed: "velocity × `scale` (f)",
  recolor: "colour = palette index, or next|random|team|tier",
  tier: "tier + `by` (f)",
  team: "team = 0-5, or self|other|next",
  damage: "`amount` (f) HP off the event's tile (target tile) or off a ball with HP (a ball at 0 HP pops)",
  var: "variable `id` add|set|mul `value` (f)",
  impulse: "push `amount` px/s (f) towards dir (or away from the other ball)",
  fx: "a visual effect: burst|flash|shake|confetti|slowmo (the camera's near-miss slow motion; nothing while Slow motion is off)", // (--- slow-motion ---)
  sound: "a note: voice hit|gap|merge|split, `pitch` scale steps up",
};

export const ACTION_TARGETS = ["self", "other", "all"] as const;
export type ActionTarget = (typeof ACTION_TARGETS)[number];
export const DAMAGE_TARGETS = ["tile", "self", "other", "all"] as const;
export type DamageTarget = (typeof DAMAGE_TARGETS)[number];
export const RECOLOR_MODES = ["next", "random", "team", "tier"] as const;
export const TEAM_MODES = ["self", "other", "next"] as const;
export const VAR_OPS = ["add", "set", "mul"] as const;
export type VarOp = (typeof VAR_OPS)[number];
export const FX_KINDS = ["burst", "flash", "shake", "confetti", "slowmo"] as const;
export type FxKind = (typeof FX_KINDS)[number];
export const VOICES = ["hit", "gap", "merge", "split"] as const;
export type Voice = (typeof VOICES)[number];

export const FINISH_KINDS = ["escaped", "tilesCleared", "ringsCleared", "count", "tier", "teamsLeft"] as const;
export type FinishKind = (typeof FINISH_KINDS)[number];
export const FINISH_DOCS: Readonly<Record<FinishKind, string>> = {
  escaped: "`atLeast` balls (of `of`) escaped (default 1)",
  tilesCleared: "every tile is broken",
  ringsCleared: "every ring is broken",
  count: "a count (`what`, `of`) reaches `atLeast` or `atMost`",
  tier: "a ball reaches tier `atLeast`",
  teamsLeft: "at most `atMost` teams have balls left (default 1)",
};

export const WINNERS = ["none", "firstOut", "lastOut", "mostBalls", "highestTier", "lastBall"] as const;
export type Winner = (typeof WINNERS)[number];
export const WINNER_DOCS: Readonly<Record<Winner, string>> = {
  none: "no winner",
  firstOut: "the team of the first ball out",
  lastOut: "the team of the last ball out",
  mostBalls: "the team with the most balls left",
  highestTier: "the team of the highest-tier ball",
  lastBall: "the team of the last ball left",
};

/** Sounds a world event plays on its own (a voice, or none), before any rule's `sound` action. */
export const VOICE_TRIGGERS = ["wallHit", "obstacleHit", "tileHit", "tileBroken", "ballHit", "escape", "ringPass", "spawn"] as const;
export type VoiceTrigger = (typeof VOICE_TRIGGERS)[number];

export const SOUND_SCALES = ["chromatic", "major", "minor", "pentatonic", "blues", "wholeTone"] as const;
export type SoundScale = (typeof SOUND_SCALES)[number];

/** The formula variables every slot reads (then the spec's own variable ids, in order). */
export const FORMULA_NAMES = ["n", "t", "b", "r", "balls", "tiles", "escaped", "tier", "size", "speed"] as const;
export const FORMULA_NAME_DOCS: Readonly<Record<(typeof FORMULA_NAMES)[number], string>> = {
  n: "how many times this rule or spawner has fired (1 the first time)",
  t: "seconds of the run",
  b: "beats so far",
  r: "a seeded random number in [0, 1)",
  balls: "balls in the arena",
  tiles: "tiles left",
  escaped: "balls escaped",
  tier: "self's tier (0 without a ball)",
  size: "self's radius in px",
  speed: "self's speed in px/s",
};

/* ------------------------------------------------------------------ the resolved spec */

/** A number slot that also takes a formula (text, compiled with compileFormulaWith over FORMULA_NAMES and the variable ids). */
export type Num = number | string;

export interface BlueprintMeta {
  name: string;
  description: string;
  family: BlueprintFamily;
  author: BlueprintAuthor;
  needs: string[];
}

export interface BlueprintExit {
  /** Where on the rim (clock degrees). */
  atDeg: number;
  /** How wide (degrees of the rim), 1-180. */
  widthDeg: number;
}

export interface BlueprintRings {
  count: number;
  gapDeg: number;
  spinDegPerSec: number;
  /** Neighbouring rings spin opposite ways. */
  alternate: boolean;
  /** A ring breaks when a ball passes outward through its gap. */
  breakOnPass: boolean;
  /** The innermost ring's radius (arena units); the outermost is the rim. */
  inner: number;
  /**
   * --- review fix (blueprint) --- A solid rim round the rings that never breaks: the rings sit inside it (the outermost at
   * RINGS_RIM_OUTER) and no ball ever escapes – once every ring is down, the balls stay in the arena.
   */
  rim: boolean;
}

/** --- review fix (blueprint) --- Where the outermost ring sits inside a solid rim (arena units). */
export const RINGS_RIM_OUTER = 0.88;

export interface BlueprintArena {
  shape: ArenaShape;
  size: number;
  restitution: number;
  gravity: { x: number; y: number };
  spinDegPerSec: number;
  exits: BlueprintExit[];
  rings: BlueprintRings | null;
}

export interface BlueprintBody {
  id: string;
  radius: number;
  /** A palette index (look.palette). */
  color: number;
  gravityScale: number;
  /** Hit points (0: the ball takes no damage). */
  hp: number;
  tier: number;
  team: number;
  collide: BodyCollide;
}

export interface BlueprintArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BlueprintTiles {
  layout: TileLayout;
  rows: number;
  cols: number;
  hp: number;
  /** Extra HP per row (row 0 first: the top row of a grid, the inner ring of a ring layout). */
  hpStep: number;
  /** A ball that breaks a tile flies on through it. */
  pierce: boolean;
  style: TileStyle;
  pitchBy: TilePitch;
  /** The grid's rectangle (arena units, top-left corner and size). */
  area: BlueprintArea;
  /** The ring layout's inner and outer radius (arena units). */
  inner: number;
  outer: number;
}

export type BlueprintObstacle =
  | { kind: "peg"; x: number; y: number; r: number }
  | { kind: "bumper"; x: number; y: number; r: number; kick: number }
  | { kind: "pegGrid"; x: number; y: number; w: number; h: number; rows: number; cols: number; r: number; stagger: boolean }
  | { kind: "pegRing"; x: number; y: number; radius: number; count: number; r: number }
  | { kind: "bar"; x: number; y: number; len: number; angleDeg: number; thick: number }
  | { kind: "spinner"; x: number; y: number; len: number; angleDeg: number; spinDegPerSec: number; thick: number };

export interface BlueprintVar {
  id: string;
  start: number;
}

export interface BlueprintSpawner {
  body: string;
  at: SpawnAt;
  count: Num;
  speed: Num;
  dir: Direction;
  startSec: number;
  /** Seconds between spawns after the first (0: once). */
  everySec: number;
  /** Spawn on every beat instead (after startSec). */
  onBeat: boolean;
  /** Balls this spawner makes in all. */
  maxTotal: number;
}

export type BlueprintAction =
  | { act: "spawn"; body: string; count: Num; at: ActionAt; speed: Num; dir: Direction }
  | { act: "split"; target: ActionTarget; into: Num; scale: number }
  | { act: "merge"; scale: number }
  | { act: "remove"; target: ActionTarget }
  | { act: "grow"; target: ActionTarget; by: Num }
  | { act: "speed"; target: ActionTarget; scale: Num }
  | { act: "recolor"; target: ActionTarget; color: number | (typeof RECOLOR_MODES)[number] }
  | { act: "tier"; target: ActionTarget; by: Num }
  | { act: "team"; target: ActionTarget; to: number | (typeof TEAM_MODES)[number] }
  | { act: "damage"; target: DamageTarget; amount: Num }
  | { act: "var"; id: string; op: VarOp; value: Num }
  | { act: "impulse"; target: ActionTarget; dir: ImpulseDirection; amount: Num }
  | { act: "fx"; kind: FxKind }
  | { act: "sound"; voice: Voice; pitch: number };

export interface BlueprintRule {
  when: Trigger;
  /** Self must be a ball of this body (null: any). */
  of: string | null;
  /** ballHit: the other ball's body id or relation. */
  with: string;
  /** timer: seconds between fires. */
  sec: number;
  /** countReached: what is counted. */
  what: string;
  atLeast: number | null;
  atMost: number | null;
  /** Fire on every n-th matching event. */
  every: number;
  /** Probability of firing (a seeded draw only when below 1). */
  chance: number;
  cooldownSec: number;
  /** 0: no limit. */
  maxFires: number;
  do: BlueprintAction[];
}

export interface BlueprintFinishCondition {
  when: FinishKind;
  of: string | null;
  what: string;
  atLeast: number | null;
  atMost: number | null;
  /** The result line ({winner}, {time}, {balls}, {escaped}, {tier}, {tiles}, {rings} and the variable ids fill in). */
  say: string;
}

export interface BlueprintFinish {
  any: BlueprintFinishCondition[];
  timeoutSec: number;
  winner: Winner;
  timeoutSay: string;
}

export interface BlueprintHud {
  show: string;
  label: string;
}

export interface BlueprintLook {
  palette: string[];
  background: string;
  trail: boolean;
  /** The rim's palette index. */
  rim: number;
  teamNames: string[];
}

export interface BlueprintSound {
  scale: SoundScale;
  /** 0 = C … 11 = B. */
  root: number;
  bpm: number;
  voices: Record<VoiceTrigger, Voice | "none">;
}

/**
 * A slider the spec offers (Mode Lab's panel, the `blv` link key): it sets one number of the resolved spec – `at` is its path,
 * such as `tiles.rows`, `spawners[0].count` or `finish.any[0].atLeast` – and the result is sanitized again, so a value past
 * a ceiling or a design domain is put back in range there (the slider's `min` and `max` only shape the slider).
 */
export interface BlueprintParam {
  id: string;
  label: string;
  at: string;
  min: number;
  max: number;
  step: number;
}

/** A resolved Blueprint v1: every field present (sanitizeBlueprint's output; codec.ts compacts it for links). */
export interface Blueprint {
  v: 1;
  meta: BlueprintMeta;
  arena: BlueprintArena;
  bodies: BlueprintBody[];
  tiles: BlueprintTiles | null;
  obstacles: BlueprintObstacle[];
  vars: BlueprintVar[];
  spawners: BlueprintSpawner[];
  rules: BlueprintRule[];
  finish: BlueprintFinish;
  hud: BlueprintHud[];
  look: BlueprintLook;
  sound: BlueprintSound;
  params: BlueprintParam[];
}

/* ------------------------------------------------------------------ defaults (what a compact spec leaves out) */

export const DEFAULT_PALETTE: readonly string[] = ["#ff4d6d", "#4dabf7", "#51cf66", "#ffd43b", "#b197fc", "#22d3ee"];
export const DEFAULT_TEAM_NAMES: readonly string[] = ["Red", "Blue", "Green", "Gold", "Purple", "Cyan"];

export const DEFAULT_VOICES: Readonly<Record<VoiceTrigger, Voice | "none">> = {
  wallHit: "hit",
  obstacleHit: "hit",
  tileHit: "hit",
  tileBroken: "gap",
  ballHit: "hit",
  escape: "gap",
  ringPass: "gap",
  spawn: "none",
};

export const DEFAULTS = {
  meta: { description: "", family: "escape" as BlueprintFamily, author: "user" as BlueprintAuthor, needs: [] as string[] },
  arena: { shape: "circle" as ArenaShape, size: 0.9, restitution: 1, gravity: { x: 0, y: 0 }, spinDegPerSec: 0 },
  rings: { count: 5, gapDeg: 40, spinDegPerSec: 30, alternate: true, breakOnPass: true, inner: 0.35, rim: false },
  body: { radius: 10, color: 0, gravityScale: 1, hp: 0, tier: 1, team: 0, collide: "bounce" as BodyCollide },
  tiles: {
    layout: "grid" as TileLayout,
    rows: 3,
    cols: 8,
    hp: 1,
    hpStep: 0,
    pierce: false,
    style: "glass" as TileStyle,
    pitchBy: "row" as TilePitch,
    area: { x: -0.7, y: -0.7, w: 1.4, h: 0.4 },
    inner: 0.5,
    outer: 0.8,
  },
  spawner: { at: "center" as SpawnAt, count: 1, speed: 300, dir: "random" as Direction, startSec: 0, everySec: 0, onBeat: false, maxTotal: 100 },
  rule: { with: "any", sec: 1, what: "balls", every: 1, chance: 1, cooldownSec: 0, maxFires: 0 },
  finish: { timeoutSec: 60, winner: "none" as Winner, timeoutSay: "TIME UP" },
  look: { background: "#0b0b14", trail: false, rim: 0 },
  sound: { scale: "major" as SoundScale, root: 0, bpm: 120 },
} as const;

/** The result line a finish condition says when it has no `say` of its own. */
export const DEFAULT_SAY: Readonly<Record<FinishKind, string>> = {
  escaped: "ESCAPED",
  tilesCleared: "CLEARED",
  ringsCleared: "ALL RINGS DOWN",
  count: "DONE",
  tier: "TIER {tier}",
  teamsLeft: "{winner} WINS",
};

/** Each action's fields and their defaults (`act` aside; a field without a default – spawn's body, var's id – is required). */
export const ACTION_DEFAULTS: { readonly [K in ActionKind]: Readonly<Omit<Extract<BlueprintAction, { act: K }>, "act">> } = {
  spawn: { body: "", count: 1, at: "self", speed: 250, dir: "random" },
  split: { target: "self", into: 2, scale: 1 },
  merge: { scale: 0 },
  remove: { target: "self" },
  grow: { target: "self", by: 2 },
  speed: { target: "self", scale: 1.1 },
  recolor: { target: "self", color: "next" },
  tier: { target: "self", by: 1 },
  team: { target: "self", to: "next" },
  damage: { target: "tile", amount: 1 },
  var: { id: "", op: "add", value: 1 },
  impulse: { target: "self", dir: "out", amount: 200 },
  fx: { kind: "burst" },
  sound: { voice: "hit", pitch: 0 },
};

/** Each obstacle kind's fields (`kind` aside) and their defaults; x and y default to the centre (0). */
export const OBSTACLE_DEFAULTS: { readonly [K in ObstacleKind]: Readonly<Omit<Extract<BlueprintObstacle, { kind: K }>, "kind">> } = {
  peg: { x: 0, y: 0, r: 0.04 },
  bumper: { x: 0, y: 0, r: 0.06, kick: 150 },
  pegGrid: { x: 0, y: 0, w: 1.2, h: 0.8, rows: 4, cols: 5, r: 0.03, stagger: true },
  pegRing: { x: 0, y: 0, radius: 0.5, count: 8, r: 0.04 },
  bar: { x: 0, y: 0, len: 0.4, angleDeg: 0, thick: 0.03 },
  spinner: { x: 0, y: 0, len: 0.5, angleDeg: 0, spinDegPerSec: 90, thick: 0.03 },
};

/** The obstacles one pattern expands to. */
export function obstacleCount(o: BlueprintObstacle): number {
  if (o.kind === "pegGrid") return o.rows * o.cols;
  if (o.kind === "pegRing") return o.count;
  return 1;
}

/* ------------------------------------------------------------------ parameter paths */

/** A parameter's path: up to four dotted fields, each with an optional list index (`rules[2].do[0].by`). */
export const PARAM_PATH = /^[a-z][a-zA-Z]{0,15}(?:\[\d{1,2}\])?(?:\.[a-z][a-zA-Z]{0,15}(?:\[\d{1,2}\])?){0,4}$/;
/** The sections a parameter may set a number of (never `v`, `meta` or the parameters themselves). */
export const PARAM_SECTIONS = ["arena", "bodies", "tiles", "obstacles", "vars", "spawners", "rules", "finish", "look", "sound"] as const;

/** A path's steps: field names and list indexes, in order (null for a path PARAM_PATH refuses). */
export function paramPathSteps(path: string): (string | number)[] | null {
  if (typeof path !== "string" || !PARAM_PATH.test(path)) return null;
  const steps: (string | number)[] = [];
  for (const part of path.split(".")) {
    const m = /^([a-zA-Z]+)(?:\[(\d+)\])?$/.exec(part);
    if (!m) return null;
    steps.push(m[1]);
    if (m[2] !== undefined) steps.push(Number(m[2]));
  }
  return (PARAM_SECTIONS as readonly string[]).includes(steps[0] as string) ? steps : null;
}

// --- unlimited-sizes --- one spelling per number
/**
 * A path as the sanitizer's walker spells it (`bodies[00].radius` → `bodies[0].radius`: names joined by dots, an index as
 * `[n]`), or null for a path PARAM_PATH refuses. A parameter's `at` is stored this way, so its bound is found by it and two
 * sliders never share one number under two spellings.
 */
export function canonicalParamPath(path: string): string | null {
  const steps = paramPathSteps(path);
  if (!steps) return null;
  return steps.reduce<string>((out, s) => (typeof s === "number" ? `${out}[${s}]` : out ? `${out}.${s}` : s), "");
}

/** The container a path's last step is in and that step (own properties only; null when the path does not reach). */
function paramSlot(root: unknown, path: string): { holder: Record<string, unknown> | unknown[]; key: string | number } | null {
  const steps = paramPathSteps(path);
  if (!steps) return null;
  let at: unknown = root;
  for (let i = 0; i < steps.length - 1; i++) {
    const k = steps[i];
    if (typeof k === "number") at = Array.isArray(at) && k < at.length ? at[k] : undefined;
    else at = typeof at === "object" && at !== null && !Array.isArray(at) && Object.hasOwn(at, k) ? (at as Record<string, unknown>)[k] : undefined;
    if (at === undefined || at === null) return null;
  }
  const key = steps[steps.length - 1];
  if (typeof key === "number") return Array.isArray(at) && key < at.length ? { holder: at, key } : null;
  return typeof at === "object" && at !== null && !Array.isArray(at) && Object.hasOwn(at, key) ? { holder: at as Record<string, unknown>, key } : null;
}

/** The number a path names in a spec, or undefined (a path that does not reach, or a value that is not a finite number). */
export function numberAt(spec: unknown, path: string): number | undefined {
  const slot = paramSlot(spec, path);
  if (!slot) return undefined;
  const v = typeof slot.key === "number" ? (slot.holder as unknown[])[slot.key] : (slot.holder as Record<string, unknown>)[slot.key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Sets the number a path names (only where a number already is); true when it did. */
export function setNumberAt(spec: unknown, path: string, value: number): boolean {
  if (numberAt(spec, path) === undefined || !Number.isFinite(value)) return false;
  const slot = paramSlot(spec, path)!;
  if (typeof slot.key === "number") (slot.holder as unknown[])[slot.key] = value;
  else (slot.holder as Record<string, unknown>)[slot.key] = value;
  return true;
}
