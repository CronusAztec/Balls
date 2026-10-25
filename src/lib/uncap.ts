/**
 * --- uncap-all --- Uncapped everything: a number field on every parameter, no caps anywhere.
 *
 * The owner's direction: "make all parameters uncapped … so it goes so fast it can break the web app". No limits
 * (lib/unlimited.ts, lib/physics/limits.ts) made the engine survive extreme values behind a switch; this module removes
 * the switch from the limits: whatever the page, a link, a preset, a project file or a share code holds is kept exactly
 * as typed, and the engine runs it. The slider ranges in `RANGES` are **comfort ranges** only – the part of each value a
 * slider track covers – and a number next to every slider takes anything else.
 *
 * What is still refused is an **invalid** value, never a big one: not a finite number (NaN, ±Infinity, text), a negative
 * or too small value where that means nothing (a negative ball count, radius or speed), which falls back to the default.
 * The only ceilings left are **memory-safety ceilings** on what a value allocates (`MEMORY_CEILINGS`: a million crowd
 * balls in typed arrays, the rings, spikes and other entities a mode builds, keyframes…), each at a value a browser tab
 * holds comfortably; past one the run shows ARENA FULL and keeps the typed value in the link. Everything else melts: the
 * run slows down (time-slicing, lib/simulation/frameBudget.ts), draws cheaper and keeps going.
 *
 * Pure (no settings.ts or engine import): the settings, the engine, the modes and the panel all read it.
 */

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

/* ------------------------------------------------------------------ memory-safety ceilings */

/** Crowd balls (typed arrays, lib/physics/crowd.ts, ≈ 23 bytes each): a million is ~23 MB. */
export const CROWD_BALL_CEILING = 1_000_000;
/**
 * Rings the engine builds (objects with their gaps, rotations, base radii, wobble tracks; a mode like Shatter builds a
 * dozen segments on each): 10,000 rings – ten times the old No limits ceiling – are a solid disc on any screen, a few MB,
 * and a step every full-physics ball still resolves against all of them in tens of milliseconds.
 */
export const RING_CEILING = 10_000;
/**
 * Entities a mode allocates per count setting (pendulums, metronomes, shapes, panes, racers, layers, spikes, segments…):
 * each is an object with its own state, drawing and sound, stepped every sub-step – 5,000 of them hold a few MB and a
 * step of a few tens of milliseconds, so the tab stays responsive while the run crawls.
 */
export const ENTITY_CEILING = 5_000;
/** Full-physics balls one board holds (the multipliers board; `OBJECT_BALL_LIMIT` of lib/unlimited.ts): past it a clone is refused with ARENA FULL. */
export const BOARD_BALL_CEILING = 2_000;
/** Links of one pendulum chain: the integrator solves an n × n system a few times a sub-step (n² memory, n³ work). */
export const CHAIN_LINK_CEILING = 64;
/** Bobs of all the pendulum chains together (chains × links): each is integrated by an adaptive Dormand–Prince solver every sub-step. */
export const CHAIN_BOB_CEILING = 2_048;
/**
 * --- unlimited-sizes --- The work of all the pendulum chains together (chains × links²): a stage of a chain costs its links
 * (the rod-tension solve of lib/physics/pendulumChain.ts), and the error control takes about as many more sub-steps as the
 * chain has links. 4 chains of 64 links, or 64 of 16, keep a step to a few hundred milliseconds at worst. Up to 8 links the
 * bob ceiling is the tighter one, so this one only binds past them.
 */
export const CHAIN_WORK_CEILING = 16_384;
/**
 * Bodies of the modes that test every pair of their bodies each sub-step (String Battle's balls against every string,
 * the arena games' squares against each other): n² work, so their bodies stop where a step still takes a fraction of a
 * second – far past the sliders (6 balls, 20 squares, 4 flag carriers a team).
 */
export const PAIRWISE_BODY_CEILING = 256;
/**
 * Journey stages before HOME (each lays out its own obstacles – a peg field, panes, a rings chamber – and the whole
 * journey is built at the start): far past the panel's 12, where building and stepping the course still takes moments.
 */
export const JOURNEY_STAGE_CEILING = 500;
/** Glass Smash rows and stages (each stage builds its rows of panes, and every pane cracks into shards): 1,000 × 1,000 would be a million panes. */
export const PANE_CEILING = 1_000;
/** Strings a String Battle ball may keep (every ball is tested against every string, every sub-step). */
export const STRING_CEILING = 1_024;
/**
 * Racers of one Square Racing Grand Prix: every pair of racers is tested every sub-step (n² work, like the other pairwise
 * modes), so the grid stops where a step still takes a fraction of a second – --- review fix (uncap-all) --- it was the
 * slider's own 16, while the per-racer state and the roster were sized for it; both are sized for the grid at init now.
 */
export const RACER_CEILING = PAIRWISE_BODY_CEILING;
/** Split-screen arenas one run builds: each is a whole engine with its own world and a part of the canvas (a 6 × 6 grid). */
export const ARENA_CEILING = 36;
/** Clips one batch or one bot plan renders and keeps in memory for the ZIP / the downloads (a few MB each). */
export const CLIP_CEILING = 50;
/** Timeline keyframes (each a row of the panel and a few characters of the link). */
export const KEYFRAME_CEILING = 2_000;
/**
 * --- review fix (uncap-all) --- Trail points a ball keeps (bounce math's "trail" rule): every full-physics ball holds its
 * own, and the canvas strokes every segment of every trail each frame – 200 each for two thousand balls is 400,000 points.
 */
export const TRAIL_POINT_CEILING = 200;
/** Frames one export may hold in memory (the muxer keeps the whole file): an hour at 60 fps. */
export const EXPORT_FRAME_CEILING = 216_000;
/**
 * --- review fix (uncap-all) --- Obstacles of the obstacle editor's layout (the list setting `obstacles`): each is resolved
 * against every ball every sub-step and is a row of number fields in the panel – a thousand (forty times the old 24, a
 * frame-cost cap) hold well under a megabyte and cost a step about a millisecond per ten balls.
 */
export const OBSTACLE_CEILING = 1_000;
/**
 * --- review fix (uncap-all) --- Captions of one clip (the list setting `captions`): each is a row of the panel and a few
 * characters of the link, and the canvas lays out only the ones showing – a thousand (the old cap was 8, a design count).
 */
export const CAPTION_CEILING = 1_000;
/**
 * --- review fix (uncap-all) --- Bounce math rules of one list (the list setting `bounceMath`): each is a card of the panel
 * and a few dozen characters of the link, and every trigger runs through the list – a thousand (the old 24 was a design
 * count) stay a fraction of a millisecond a bounce.
 */
export const BOUNCE_RULE_CEILING = 1_000;

// --- blueprint ---
/**
 * The Blueprint sandbox's memory and work ceilings (lib/blueprint/: a mode described as JSON data, run by one interpreter).
 * A Blueprint arrives from a stranger's link or share code, so – unlike a slider, which only a visitor's own hand moves – its
 * structure carries fixed ceilings, each at a value a browser tab runs comfortably at 60 steps a second. They are the one
 * deliberate exception to "uncapped" (the owner's decision for the Blueprint batch), and they bound only what a spec
 * allocates and how much work a step may do: the physics scalars of a Blueprint (speeds, sizes, gravity, bounciness) take any
 * finite value, as every other setting does. Past a ceiling the run says ARENA FULL (balls), keeps its first entries (tiles,
 * obstacles, rules) or defers the rest to the next step (spawns), never freezes.
 */
export const BLUEPRINT_CEILINGS = {
  /** Balls alive at once (full-physics balls: every pair is tested each sub-step through a spatial hash). */
  balls: 400,
  /** Tiles of the one tiles block (rows × columns): each a few typed numbers, a cell of the static broadphase and a pane drawn. */
  tiles: 600,
  /** Obstacles after the patterns expand (peg grids, peg rings): each resolved against nearby balls every sub-step. */
  obstacles: 48,
  /** Rules of one spec: every event runs through the rules of its trigger, in order. */
  rules: 16,
  /** The longest run (seconds): every Blueprint ends by itself, so the finder, the export and a stranger's link always stop. */
  timeoutSec: 180,
  /** The canonical JSON of one spec (UTF-8 bytes): about 8,000 base64url characters, half a share code's 16,000. */
  specBytes: 6_000,
  /** Physics events one step records (hits, breaks, escapes…); past it they are dropped and counted. */
  eventsPerStep: 512,
  /** Rule firings one step runs; past it they are dropped and counted (a rule ping-pong cannot spin a step). */
  ruleFiringsPerStep: 64,
  /** Balls one step adds (spawns and splits); the rest wait for the next steps, in order. */
  spawnsPerStep: 8,
  /** Sounds one step plays (the hit voices and the sound actions); the rest of the step's are silent. */
  soundsPerStep: 6,
  /**
   * --- review fix (blueprint) --- A ball's radius (px): half the world's shorter side (WORLD_SIDE 450), so a ball that size
   * already covers any arena (225 px × size). A body, a grow, a merge or a split stops there: past it a ball would only cover
   * more of the pair grid (a link of 400 huge balls made every pair test every other) or go infinite and stop the canvas.
   */
  ballRadius: 225,
  /**
   * --- review fix (blueprint) --- A ball's speed (px/s): 1,600 px a step, four times across the largest arena. A ball an
   * endless speed-up takes past it is taken out and counted (the playability check says broken), as a non-finite one is: no
   * sub-step plan can follow it and it would only freeze on the rim, firing a wall hit every step.
   */
  ballSpeed: 100_000,
  /**
   * --- review fix (blueprint) --- Sub-steps of one 60 Hz step: the engine plans enough that no ball moves more than half
   * its radius; past this many the step itself shortens instead (slow motion, the engine's time dilation), so 400 tiny fast
   * balls cost at most 400 × this many ball sub-steps a step.
   */
  subStepsPerStep: 16,
  /**
   * --- review fix (blueprint) --- Ball pairs one step tests for a contact (shared out over its sub-steps): 400 balls of
   * 12 px – more than the arena holds – heaped in a bowl test at most a third of it. Past it the rest of the sub-step's pairs
   * are skipped and counted (droppedPairs), so balls that all overlap cannot make a step quadratic.
   */
  pairTestsPerStep: 64_000,
  /**
   * --- review fix (blueprint) --- Pair-grid entries one step walks to find those pairs (a ball is listed in every cell it
   * covers, so a pair sharing cells is met once a cell): 400 balls of 10 px filling the arena walk a third of it, that heap
   * of 12 px balls under half. Past it the rest of the sub-step's pairs are skipped and counted, as past the pair tests:
   * medium balls heaped in the same cells cannot make the walk quadratic either.
   */
  pairVisitsPerStep: 160_000,
  /**
   * --- review fix (blueprint) --- Balls the rules' actions change in one step (an action with target "all" changes every
   * ball, and each runs its formula): past it the step's further actions are dropped and counted, like rule firings past
   * theirs (64 firings × 4 actions × 400 balls would be 100,000 formula runs a step).
   */
  actionBallsPerStep: 4_096,
} as const;
export const BLUEPRINT_BALL_CEILING = BLUEPRINT_CEILINGS.balls;
export const BLUEPRINT_TILE_CEILING = BLUEPRINT_CEILINGS.tiles;
export const BLUEPRINT_OBSTACLE_CEILING = BLUEPRINT_CEILINGS.obstacles;
export const BLUEPRINT_RULE_CEILING = BLUEPRINT_CEILINGS.rules;
export const BLUEPRINT_TIMEOUT_CEILING_SEC = BLUEPRINT_CEILINGS.timeoutSec;
export const BLUEPRINT_JSON_MAX_BYTES = BLUEPRINT_CEILINGS.specBytes;
export const BLUEPRINT_EVENTS_PER_STEP = BLUEPRINT_CEILINGS.eventsPerStep;
export const BLUEPRINT_RULE_FIRINGS_PER_STEP = BLUEPRINT_CEILINGS.ruleFiringsPerStep;
export const BLUEPRINT_SPAWNS_PER_STEP = BLUEPRINT_CEILINGS.spawnsPerStep;
export const BLUEPRINT_SOUNDS_PER_STEP = BLUEPRINT_CEILINGS.soundsPerStep;
export const BLUEPRINT_RADIUS_CEILING = BLUEPRINT_CEILINGS.ballRadius;
export const BLUEPRINT_SPEED_CEILING = BLUEPRINT_CEILINGS.ballSpeed;
export const BLUEPRINT_SUBSTEP_CEILING = BLUEPRINT_CEILINGS.subStepsPerStep;
export const BLUEPRINT_PAIR_TESTS_PER_STEP = BLUEPRINT_CEILINGS.pairTestsPerStep;
export const BLUEPRINT_PAIR_VISITS_PER_STEP = BLUEPRINT_CEILINGS.pairVisitsPerStep;
export const BLUEPRINT_ACTION_BALLS_PER_STEP = BLUEPRINT_CEILINGS.actionBallsPerStep;
// --- end blueprint ---

// --- orb-grid ---
/**
 * Bouncing Orbs: the orbs one run builds (columns × rows; lib/physics/modes/orbGrid.ts). An orb is ~70 bytes of typed state
 * (its spot, radius, distribution value, ring / row / column, delay, gravity, restitution, launch time and speed, next landing,
 * height, state) plus ~25 bytes of the renderer's projection and depth order: 250,000 orbs (a 500 × 500 field) are ~24 MB –
 * what the crowd's million balls take – and a step over all of them a few milliseconds; the canvas then draws them as points
 * in one image (orbGridRenderer.ts). Each axis alone may be that long (a line of orbs); past the product the field keeps its
 * aspect at this many orbs, the settings keep the typed values and the canvas says ARENA FULL.
 */
export const ORB_CEILING = 250_000;
// --- end orb-grid ---

/**
 * The settings whose value sizes an allocation, and the most of it a run builds (the memory-safety ceiling). The link,
 * the preset and the panel keep the typed value; the engine builds at most this many, and the canvas says ARENA FULL.
 */
export const MEMORY_CEILINGS: Readonly<Record<string, number>> = {
  // --- merge-ring / spiral-glass --- the tiers (one emblem each), the spiral's turns (36 glass tiles a turn) and the spiral's ball cap
  mrTiers: 10,
  sgTurns: 24,
  sgMaxBalls: 500,
  ballCount: CROWD_BALL_CEILING,
  multiplySpawnCount: CROWD_BALL_CEILING,
  wallCount: RING_CEILING,
  spikeCount: ENTITY_CEILING,
  targetCount: ENTITY_CEILING,
  colorMatchColorCount: ENTITY_CEILING,
  dropBallCount: ENTITY_CEILING,
  dropRows: ENTITY_CEILING,
  boxShapeCount: ENTITY_CEILING,
  pwCount: ENTITY_CEILING,
  pwPolygon: ENTITY_CEILING,
  prCount: ENTITY_CEILING,
  cpCount: ENTITY_CEILING,
  glassRows: PANE_CEILING,
  glassStages: PANE_CEILING,
  mpRows: ENTITY_CEILING,
  mpStartBalls: ENTITY_CEILING,
  mpMaxBalls: ENTITY_CEILING,
  dpCount: ENTITY_CEILING,
  dpSegments: CHAIN_LINK_CEILING,
  dpStrings: ENTITY_CEILING,
  ilBalls: ENTITY_CEILING,
  ilRings: ENTITY_CEILING,
  ilDepth: ENTITY_CEILING, // --- review fix (uncap-all) --- the nested circles: ten typed arrays of depth + 1 and a body each (a billion crashed the tab)
  ilPainters: ENTITY_CEILING,
  sbBalls: PAIRWISE_BODY_CEILING,
  sbMaxStrings: STRING_CEILING,
  plLayers: ENTITY_CEILING,
  rcRacers: RACER_CEILING,
  rcTrackLength: ENTITY_CEILING,
  btCount: PAIRWISE_BODY_CEILING,
  ctfPerTeam: PAIRWISE_BODY_CEILING,
  runnerObstacles: ENTITY_CEILING,
  vxBalls: ENTITY_CEILING,
  vxRings: ENTITY_CEILING,
  byShots: ENTITY_CEILING,
  byRings: ENTITY_CEILING,
  journeyAutoStages: JOURNEY_STAGE_CEILING,
  arenaCount: ARENA_CEILING,
  // --- odd-territory --- Territory: the board's columns (a byte a tile, the rows follow the board's shape – 1,000 columns
  // are under a million tiles, repainted only where they flip), the teams (the start regions are halves or quadrants and the
  // per-team state is sized for four, `TY_MAX_TEAMS` of lib/physics/modes/territory.ts – a test keeps them equal – so a
  // count past them plays four) and the balls of a team (four teams of them fill the board's full-physics balls)
  tyCols: 1_000,
  tyTeams: 4,
  tyBallsPerTeam: BOARD_BALL_CEILING / 4,
  // --- end odd-territory ---
  // --- odd-maze --- Maze Escape: the maze's columns (the rows follow the portrait field – 200 columns are 286 rows, 57,200
  // cells: about 23 bytes a cell and 6 more a ball for its visits and its path, ≈ 12 MB with 32 balls, plus a paint stroke
  // the first time a ball paints a cell or a passage) and the balls (a bit each in the cells' 32-bit paint masks)
  mzCols: 200,
  mzBalls: 32,
  // --- end odd-maze ---
  // --- gerald-conveyor --- Conveyor Belt: the balls the belt loads (full-physics balls, the pile's pairs every sub-step)
  cvMaxBalls: BOARD_BALL_CEILING,
  splatMax: ENTITY_CEILING, // --- gerald-exit-splat --- the splats standing at once (each a pooled circle every ball near it is tested against)
  // --- orb-grid --- Bouncing Orbs: the field's columns and rows (each alone up to the orbs' ceiling; their product too, in the mode)
  ogColumns: ORB_CEILING,
  ogRows: ORB_CEILING,
  // --- land-claim --- Land Claim (`LC_*_CEILING` of lib/physics/modes/landClaim.ts – a test keeps them equal): the columns (a
  // dozen numbers each; 5,000 are a wall of hairlines), the blocks of a column (two bytes a block of the owner array: the rows a
  // run builds also stop at a million blocks in all), the competitors (a few counters and a line of the HUD each) and the balls
  // a competitor starts with (the board's full-physics balls – every spawn counts against the same 2,000)
  lcCols: 5_000,
  lcRows: 2_000,
  lcTeams: 1_000,
  lcBalls: BOARD_BALL_CEILING,
  // --- end land-claim ---
  // --- land-claim-pyramid --- Land Claim's pyramid (`LCP_*_CEILING` of lib/physics/landClaimPyramid.ts – a test keeps them equal):
  // the grid's side (a few numbers a column: 1,000 × 1,000 is a million columns) and the blocks in all (an Int32 a column; the
  // wall's million – a natural pyramid past it is scaled down to it)
  lcPyramidSize: 1_000,
  lcBlocks: 1_000_000,
  // --- end land-claim-pyramid ---
  // --- colour-sort --- Colour Sort (`CS_*_CEILING` of lib/physics/modes/colourSort.ts – a test keeps them equal): the colours
  // (a ring, a band and a palette entry each), the balls of a colour (two colours of them fill the 20,000 balls a run holds,
  // `CS_BALL_CEILING`: a dozen numbers each, all moved every sub-step – past it each colour holds its share) and the gates of a
  // ring (a few numbers each, every gate's edge pinned and drawn)
  csColours: ENTITY_CEILING,
  csPerColour: 10_000,
  csGates: ENTITY_CEILING,
  // --- end colour-sort ---
  // --- chord-stars --- Chord Stars: the balls (each an engine ball pinned to the clock, a star, a voice and a line of the chord
  // layer; nothing is stored per chord – a cycle's chords past SC_CHORD_CEILING fade on the canvas instead)
  scBalls: ENTITY_CEILING,
  // --- bead-hoops --- Spinning Hoops: the hoops a run builds (a bead each: an engine ball, a dozen numbers and an RK4 integration
  // a sub-step; every frame draws each hoop as an ellipse)
  hpCount: ENTITY_CEILING,
  // --- chaos-fan --- the Double Pendulum's chaos fan: its pendulums (a batch of typed arrays stepped together; the runtime step
  // budget, FAN_STEP_BUDGET of lib/physics/chaosFan.ts, holds this many at the fewest sub-steps)
  dpFanCount: ENTITY_CEILING,
  // --- phase-spiral --- Metronomes & Polyrhythms' arms: the dots of a ring (each an engine ball pinned to the clock; rings ×
  // arms stop at the same ceiling in the mode, `DOT_CEILING` of lib/physics/phaseSpiral.ts)
  prArms: ENTITY_CEILING,
  // --- ellipse-foci --- Focus Shot: the volley's balls (full engine balls pinned to the clock – the board's ball ceiling – each with a
  // ring of EF_VERTEX_CAP corners for its trail and path)
  efCount: BOARD_BALL_CEILING,
  // --- fl-overhaul --- (Stage 5) Fight League's shows: a bracket's entrants and a boss rush's challengers (a row and a bout each;
  // `FL_ENTRANT_CEILING` of lib/physics/modes/fightLeagueShow.ts – a test keeps them equal)
  flBracketSize: 256,
  flBossWaves: 256,
  // --- end fl-overhaul ---
  // --- beat-machine --- Beat Machines: the steps a staircase builds, the bars (each a tube of marbles), the marbles a tube holds
  // at least (the engine balls stop at BOARD_BALL_CEILING in the mode; the plan draws every marble) and the loop's beats (the
  // phrase's notes, each a planned trip)
  bmSteps: ENTITY_CEILING,
  bmBars: 1_000,
  bmPerTube: 200,
  bmLoopBeats: 4_096,
  // --- wave-tank --- Wave Tank: the grid's columns (its rows follow at 4/3 and its sponge at ¾ of a wavelength: ~4 M cells at the
  // ceiling – the solver lowers a grid that would still need more, WT_CELL_CEILING), the bells (each sampled, smoothed and drawn
  // every step) and the ridge lines (each up to 512 samples a frame)
  wtCols: 1_700,
  wtBells: ENTITY_CEILING,
  wtRidges: 4_096,
  // --- brick-rebuild --- Brick Smash (`BR_*_CEILING` of lib/physics/brickRebuild.ts – a test keeps them equal): the grid's
  // columns and rows (a few typed numbers a cell and a rect of the cached brick layer; their product stops at 40,000 cells in
  // the mode, the aspect kept), the start balls (full engine balls: the board's ceiling, spawns and splits included) and the
  // kaleidoscope's images (each real ball drawn that many times, every brick hit applied to that many bricks)
  brCols: 40_000,
  brRows: 40_000,
  brBalls: BOARD_BALL_CEILING,
  brSymmetry: 256,
  // --- end brick-rebuild ---
  // --- perfect-fit --- Perfect Fit's Tetris well: its columns and rows (a cell each in the drawing; the pieces a run plans stop at
  // PF_PIECE_CEILING of lib/simulation/polyominoPlan.ts, the sections past it are left out)
  pfWellW: 1_000,
  pfWellH: 2_000,
  // --- review fix (uncap-all) --- list settings: their length is what allocates (`LIST_CEILING_KEYS`)
  obstacles: OBSTACLE_CEILING,
  captions: CAPTION_CEILING,
};

/**
 * --- review fix (uncap-all) --- The settings of `MEMORY_CEILINGS` that are lists (their entries allocate, each a row of the
 * panel too): a link or preset keeps at most the ceiling's first entries, so a list is full – ARENA FULL where it is in
 * play – once it holds that many (`pastMemoryCeiling()`).
 */
export const LIST_CEILING_KEYS: ReadonlySet<string> = new Set(["obstacles", "captions"]);

/** The most a run builds of an allocating setting `key` (its memory-safety ceiling), the value itself otherwise (a list: its length). */
export function memoryCeiling(key: string, value: number): number {
  const ceiling = MEMORY_CEILINGS[key];
  return ceiling !== undefined && value > ceiling ? ceiling : value;
}

/**
 * True when `value` of `key` allocates more than its memory-safety ceiling (the run builds less: ARENA FULL) – or, for a
 * list setting, holds as many entries as its ceiling allows (a longer link or preset was cut there; nothing more can be added).
 */
export function pastMemoryCeiling(key: string, value: unknown): boolean {
  const ceiling = MEMORY_CEILINGS[key];
  if (ceiling === undefined) return false;
  if (Array.isArray(value)) return LIST_CEILING_KEYS.has(key) && value.length >= ceiling;
  return typeof value === "number" && value > ceiling;
}

/* ------------------------------------------------------------------ validation (never a maximum) */

/**
 * Settings that pick one entry of a fixed list by its index – the Rigged forced winner's team slot (one of the
 * `MAX_TEAMS` team colours): a value past the list names nothing, so it is invalid (not capped) and falls back to off
 * like any other invalid value. (The race's staged winner is not one: the grid has no maximum, any racer may win.)
 */
export const INDEX_KEYS: ReadonlySet<string> = new Set(["forcedWinner"]);

/**
 * Settings that are signed: a value past either end of the slider is meaningful (wind blowing the other way, a
 * pendulum started more than half a turn round, any 32-bit seed, --- orb-grid --- the orb field's camera turned −45°).
 */
export const SIGNED_KEYS: ReadonlySet<string> = new Set(["windX", "windY", "dpAngle1", "dpAngle2", "dpAngle3", "arenaSeed", "ogRotation"]);

// --- unlimited-sizes --- the meaningful floors
/**
 * The lowest value a setting still means something at, where that lies below its slider's comfort minimum: the start of a
 * slider is a comfort bound like its end, so a Spin of 0 (still walls), one target, a factor-0 slow motion (a freeze) or a
 * 3 s clip are kept as typed. `min` keeps the value itself (≥), `above` refuses it (> 0: a gap of 0 is no gap, a clip of
 * 0 s no clip). A value below the floor is as invalid as ever (lifted onto the slider's minimum, as before). A setting
 * not listed keeps its slider's minimum as its floor, and a signed one (`SIGNED_KEYS`) has none.
 */
export const MEANINGFUL_FLOORS: Readonly<Record<string, { readonly min: number; readonly above?: true }>> = {
  rotationSpeed: { min: 0 },
  gapSize: { min: 0, above: true },
  recordingDuration: { min: 0, above: true },
  findDuration: { min: 0, above: true },
  targetCount: { min: 1 },
  multiplySpawnCount: { min: 0 },
  growRate: { min: 0, above: true },
  slowMoFactor: { min: 0 },
  slowMoMs: { min: 0, above: true },
};

/** The floor of `key` (its meaningful floor, else the slider's minimum; −∞ for a signed setting) and whether the floor itself is refused. */
export function floorOf(key: string | undefined, range: { min: number }): { min: number; above: boolean } {
  if (key !== undefined && SIGNED_KEYS.has(key)) return { min: -Infinity, above: false };
  const floor = key !== undefined ? MEANINGFUL_FLOORS[key] : undefined;
  return floor && floor.min < range.min ? { min: floor.min, above: floor.above === true } : { min: range.min, above: false };
}

/** True when a finite `value` of `key` meets its floor (`floorOf()`). */
export function meetsFloor(key: string | undefined, value: number, range: { min: number }): boolean {
  const floor = floorOf(key, range);
  return floor.above ? value > floor.min : value >= floor.min;
}

/** A finite number for `key` kept from its floor up; below it lifted onto the slider's minimum (the old behaviour at the low end). */
export function atLeastFloor(n: number, key: string | undefined, range: { min: number }): number {
  return meetsFloor(key, n, range) ? n : n < range.min ? range.min : n;
}
// --- end unlimited-sizes ---

/**
 * A number from a resolver's input, kept as it is: a finite number at or above the range's minimum (lifted onto it
 * when below – the old behaviour at the low end), anything else (NaN, ±Infinity, text) the fallback. Never a maximum.
 * --- unlimited-sizes --- With its setting's `key`, from the setting's meaningful floor up (`MEANINGFUL_FLOORS`).
 */
export function uncapped(value: unknown, range: { min: number }, fallback: number, key?: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return atLeastFloor(n, key, range);
}

/** A signed number from a resolver's input: any finite number, the fallback otherwise. */
export function signedUncapped(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Whether a stored value of `key` (range `range`) is valid: finite, and not below the minimum unless the setting is signed (--- unlimited-sizes --- its meaningful floor). */
export function isValidValue(key: string, value: unknown, range: { min: number }): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return meetsFloor(key, value, range);
}

/* ------------------------------------------------------------------ the number field */

/** What a number field accepts (the setting's rules). */
export interface NumberRules {
  /** The sensible minimum (the slider's own minimum by default); none for signed settings. */
  min?: number;
  /** --- unlimited-sizes --- The minimum itself is refused (a meaningful floor of "more than 0": a gap, a clip length). */
  above?: boolean;
  /** Whole numbers only (counts): a decimal is rounded. */
  integer?: boolean;
  /**
   * --- review fix (uncap-all) --- An optional value (bounce math's min / max: none means no bound): an empty field clears
   * it instead of being refused.
   */
  optional?: boolean;
}

/** Why typed text was refused (the field keeps the old value and says why). */
export type NumberRefusal = "empty" | "notNumber" | "notFinite" | "belowMin" | "notAbove"; // --- unlimited-sizes --- (notAbove: at or below a "more than" floor)

export type NumberCheck = { ok: true; value: number } | { ok: false; reason: NumberRefusal; min?: number };

const SUFFIX_FACTORS: Readonly<Record<string, number>> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15 };

/**
 * Typed text → a number, or null. Accepts what people type: `1e6`, `1.5e-3`, `-4`, `.5`, `1,5` (a decimal comma),
 * `1 000 000` / `1_000_000` / `1,000,000` (grouping), `2.5k`, `1.2M`, `3B` (the HUD's short forms), `∞` is refused (not finite).
 */
export function parseTypedNumber(text: string): number | null {
  let s = text.trim().replace(/[\s_  ]/g, "");
  if (s === "") return null;
  if (/^[+-]?(∞|inf(inity)?)$/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
  let factor = 1;
  const suffix = s.slice(-1).toLowerCase();
  if (SUFFIX_FACTORS[suffix] !== undefined && /\d\.?$/.test(s.slice(0, -1))) {
    factor = SUFFIX_FACTORS[suffix];
    s = s.slice(0, -1);
  }
  if (s.includes(",")) {
    // "1,000,000" groups thousands; "1,5" is a decimal comma (Polish, Spanish).
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) s = s.replace(/,/g, "");
    else if (!s.includes(".") && (s.match(/,/g) ?? []).length === 1) s = s.replace(",", ".");
    else return null;
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s) * factor;
  return Number.isNaN(n) ? null : n;
}

/** Checks a parsed number against a setting's rules: invalid values are refused with the reason, big ones never. */
export function checkNumber(value: number | null, rules: NumberRules = {}): NumberCheck {
  if (value === null) return { ok: false, reason: "notNumber" };
  if (!Number.isFinite(value)) return { ok: false, reason: "notFinite" };
  const v = rules.integer ? Math.round(value) : value;
  if (rules.min !== undefined && v < rules.min) return { ok: false, reason: rules.above ? "notAbove" : "belowMin", min: rules.min };
  if (rules.min !== undefined && rules.above && v <= rules.min) return { ok: false, reason: "notAbove", min: rules.min }; // --- unlimited-sizes ---
  return { ok: true, value: v };
}

/** Typed text checked against a setting's rules (the number field's commit). */
export function checkTypedNumber(text: string, rules: NumberRules = {}): NumberCheck {
  if (text.trim() === "") return { ok: false, reason: "empty" };
  return checkNumber(parseTypedNumber(text), rules);
}

/**
 * The next value for an arrow key: ±`step` inside the comfort range, and – beyond it, where one step would take forever –
 * a step of about a tenth of the value's own size (1,000,000 → 1,100,000). `coarse` (Shift) takes ten steps, `fine`
 * (Alt) a tenth of one. The result respects the rules (a value below the minimum stops at it).
 */
export function stepNumber(value: number, direction: 1 | -1, range: NumericRange, rules: NumberRules = {}, modifier: "coarse" | "fine" | null = null): number {
  const base = Number.isFinite(value) ? value : range.min;
  let step = range.step > 0 ? range.step : 1;
  const magnitude = Math.abs(base);
  if (magnitude > range.max * 2 && magnitude > 0) step = Math.max(step, Math.pow(10, Math.floor(Math.log10(magnitude)) - 1));
  if (modifier === "coarse") step *= 10;
  else if (modifier === "fine" && !rules.integer) step /= 10;
  let next = base + direction * step;
  // Keep the steps on a readable grid (0.1 + 0.2 is 0.30000000000000004).
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  if (decimals > 0 && decimals < 16) next = Number(next.toFixed(decimals));
  if (rules.integer) next = Math.round(next);
  if (rules.min !== undefined && next < rules.min) next = rules.min;
  // --- unlimited-sizes --- a "more than" floor: a step down onto it is not taken (the value stays; a smaller one can be typed)
  if (rules.min !== undefined && rules.above && next <= rules.min) next = base;
  return next;
}

/** The text a number field shows for a value: exact (the whole value, never rounded), exponent notation when huge or tiny. */
export function formatExact(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const text = String(value);
  return text.replace("e+", "e");
}

/** True when `value` lies outside the slider's comfort range (the track pins at its end, the field is tinted). */
export function beyondSlider(value: number, range: { min: number; max: number }): boolean {
  return value > range.max || value < range.min;
}

/* ------------------------------------------------------------------ compact numbers for HUDs and badges */

const COMPACT: readonly [number, string][] = [
  [1e15, "Q"],
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/** A short label for a big number: 1,200,000 → "1.2M", 12,345 → "12.3K", 1e21 → "1e21"; small numbers as they are. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "-∞" : "NaN";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e18) return `${sign}${a.toExponential(1).replace("e+", "e").replace(".0e", "e")}`;
  for (const [unit, suffix] of COMPACT) {
    if (a >= unit) {
      const v = a / unit;
      const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
      return `${sign}${Number(v.toFixed(digits))}${suffix}`;
    }
  }
  if (a >= 100 || Number.isInteger(a)) return `${sign}${Math.round(a)}`;
  if (a > 0 && a < 0.001) return `${sign}${a.toExponential(1).replace(".0e", "e")}`;
  return `${sign}${Number(a.toPrecision(3))}`;
}

/* ------------------------------------------------------------------ Bounciness (the uncapped Bouncier) */

/** The Bounciness the old Bouncier switch meant: each bounce adds 3 % of the Ball Speed (`bounce=1` in old links). */
export const BOUNCIER_ON = 1.03;
/** Bounciness off: every rebound at the Ball Speed. */
export const BOUNCINESS_OFF = 1;
/** The rebound multiplier the old Bouncier stopped at; the engine keeps its old sub-steps up to it (old runs replay exactly). */
export const BOUNCIER_CLASSIC_MAX = 3;
/** The Bounciness slider's comfort range; the number field takes any value from 1 up (1.5, 3, 100, 1e6…). */
export const BOUNCINESS_RANGE: NumericRange = { min: 1, max: 2, step: 0.01 };

/** The Bounciness of a settings object: its number, or – for settings from before it existed – what the switch meant. */
export function bouncinessOf(source: { bounciness?: unknown; bouncierEnabled?: unknown }): number {
  const n = source.bounciness;
  if (typeof n === "number" && Number.isFinite(n) && n >= BOUNCINESS_RANGE.min) return n;
  return source.bouncierEnabled === true ? BOUNCIER_ON : BOUNCINESS_OFF;
}

/** The rebound gain per bounce of a Bounciness: 1.03 → +0.03 × the Ball Speed a bounce (the old Bouncier), 3 → +2. */
export function bouncierIncrementOf(bounciness: number): number {
  return Number.isFinite(bounciness) && bounciness > 1 ? bounciness - 1 : 0;
}

/* ------------------------------------------------------------------ the resolvers' shared floor */

/**
 * --- uncap-all --- What every settings resolver applies to a finite number now: the range's minimum as a floor (a value
 * below it is lifted onto it, as before) and **no maximum** – the slider's end is a comfort bound, not a limit.
 */
export function atLeastMin(n: number, range: { min: number }): number {
  return n < range.min ? range.min : n;
}

/* ------------------------------------------------------------------ the number field's behaviour (pure, for NumberField.tsx) */

/** What a number field holds between renders: the text being typed (null = showing the value) and the last refusal. */
export interface NumberFieldState {
  draft: string | null;
  error: { reason: NumberRefusal; min?: number; text?: string } | null;
}

export const IDLE_FIELD: NumberFieldState = { draft: null, error: null };

/** What happened in the field. */
export type NumberFieldEvent =
  | { type: "type"; text: string }
  | { type: "commit" }
  | { type: "blur" }
  | { type: "step"; direction: 1 | -1; modifier?: "coarse" | "fine" | null }
  | { type: "cancel" };

/**
 * The number field as a pure function: typing only changes the draft (nothing reaches the settings yet), Enter commits
 * a valid draft, leaving the field commits it too, an arrow key steps the value (or the valid draft) and commits at
 * once, Escape drops the draft. Invalid text is never committed: the value stays as it was and `error` says why (on
 * blur the field shows the value again, with the error kept until the next edit). Returns the next state and, when
 * something is committed, the value – or, for an optional value (`rules.optional`) left empty, `clear` (no value).
 */
export function numberFieldReduce(state: NumberFieldState, event: NumberFieldEvent, value: number, range: NumericRange, rules: NumberRules = {}): { state: NumberFieldState; commit?: number; clear?: true } {
  switch (event.type) {
    case "type":
      return { state: { draft: event.text, error: null } };
    case "cancel":
      return { state: IDLE_FIELD };
    case "commit":
    case "blur": {
      if (state.draft === null) return { state: event.type === "blur" ? { draft: null, error: state.error } : state };
      if (rules.optional && state.draft.trim() === "") return { state: IDLE_FIELD, clear: true }; // --- review fix (uncap-all) ---
      const check = checkTypedNumber(state.draft, rules);
      if (!check.ok) {
        const error = { reason: check.reason, min: check.min, text: state.draft };
        return { state: event.type === "blur" ? { draft: null, error } : { draft: state.draft, error } };
      }
      return { state: IDLE_FIELD, commit: check.value };
    }
    case "step": {
      const typed = state.draft !== null ? checkTypedNumber(state.draft, rules) : null;
      const from = typed && typed.ok ? typed.value : value;
      return { state: IDLE_FIELD, commit: stepNumber(from, event.direction, range, rules, event.modifier ?? null) };
    }
  }
}

/** What the field shows for a value: the exact text, whether it lies beyond the slider, and its short form for readouts. */
export function fieldDisplay(value: number, range: { min: number; max: number }): { text: string; beyond: boolean; compact: string } {
  return { text: formatExact(value), beyond: beyondSlider(value, range), compact: formatCompact(value) };
}
