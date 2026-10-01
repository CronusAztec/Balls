import { MAX_TEAMS, MULTI_BALL_MODES, startBallCount } from "./ballStats";
import { cruiseSpeed } from "./multipliers";
import type { Ball, CircularWall, ModeId, PhysicsConfig, PhysicsExtras } from "./types";
import { TWO_PI, normalizeAngle } from "./types";

/**
 * Rigged outcomes – guaranteed results for storytelling clips ("it will NEVER escape", "Red always wins").
 *
 * Two hard constraints the cinematic director enforces on top of the physics:
 *
 * - **Never escape** (`neverEscape`, URL `ne`): the outermost intact wall – the last barrier – never lets a ball out.
 *   The director steers every rebound so that the ball's next wall contact misses the barrier's gaps (preferring the
 *   angle closest to the natural one, which lands just beside a gap: a near miss) and bends a flight no rebound set
 *   (a spawn, a deflection) away from them; a gap pass through the barrier is refused (the ball rebounds as off the
 *   wall – the safety net under the steering), a multiplier smash cannot break it, the modes that break walls
 *   themselves keep it closed (`ModeContext.isWallSealed()`: Shatter does not damage it, Color Match's last segment
 *   does not break) and a per-step backstop puts back a ball anything else pushed across it. So the modes that end
 *   with an escape never finish.
 * - **Forced winner** (`forcedWinner`, a team slot, URL `fw`): in the multi-ball escape modes the chosen ball – its
 *   team – is favoured at the gap passes: the other balls cannot pass (or damage) a wall it has not passed yet – every
 *   wall in Classic, the way out elsewhere – and a way out broken open before it passed still holds them (Color Match,
 *   Shatter); the director steers the chosen ball's rebounds through nearby gaps and everyone else's away from the
 *   closed ones. The way out opens to the others only once a ball of the chosen team has escaped (counted by the escape
 *   scan, not when it enters the gap) – and not even then in Shatter and Color Match, where that escape ends the run,
 *   or in Multiply, which never ends: there the others stay in. In Classic, where every ball escapes in the end, the
 *   others cannot clone themselves on x2 BALLS orbs either (`blocksClone()`), so they never out-escape it. The chosen
 *   team so breaks the walls first and escapes first – it tops the scoreboard. Should the chosen team lose its last
 *   ball without escaping (the merge interaction fuses balls; the engine hands the merged ball the chosen team, this is
 *   the net under that), the locks are released so the run can still end (`markInside()`). With "never escape" on
 *   nobody escapes, so the forced winner is off in the modes it wins by escaping (`WINNER_NEEDS_ESCAPE`); Classic keeps
 *   it – the walls it breaks decide there.
 *
 * Everything here is deterministic: no random numbers, only the engine's state (positions, walls, rotations, gravity)
 * and the settings, so a seed replays exactly and the seed finder – whose headless engines copy the config – finds
 * runs that play the same in the page. With both settings off the engine takes its plain code path.
 *
 * The steering predicts the ball's flight with a small "ghost" integration (gravity, wind, drag and the cruising-speed
 * boost of the ring modes; no ball-to-ball collisions or obstacles), following it through the gaps it would pass up to
 * its next bounce, and tries angles a few degrees at a time until the bounce is safe.
 */

export interface RiggedConfig {
  /** No ball ever leaves the outermost intact wall (URL `ne`). */
  neverEscape: boolean;
  /** Team slot (0 … MAX_TEAMS − 1) the director makes win in the multi-ball escape modes; −1 = off (URL `fw`). */
  forcedWinner: number;
}

export const DEFAULT_RIGGED: RiggedConfig = { neverEscape: false, forcedWinner: -1 };

/**
 * Slider / select ranges, keyed like the settings (and the finder's escape-time field) so settings.ts can spread them
 * into `RANGES`.
 */
export const RIGGED_RANGES = {
  forcedWinner: { min: -1, max: MAX_TEAMS - 1, step: 1 },
  /** Find Simulation's "escapes at" target, seconds (the clip runs a few seconds past it, within the 120 s a recording may last). */
  findEscapeAt: { min: 1, max: 115, step: 0.5 },
} as const;

/** Validates the rigged settings (URL parameters and presets alike): a non-boolean flag is off, a bad team slot is −1. */
export function resolveRiggedConfig(source?: Partial<Record<keyof RiggedConfig, unknown>> | null): RiggedConfig {
  const s = source ?? {};
  const team = Number(s.forcedWinner);
  return {
    neverEscape: s.neverEscape === true,
    forcedWinner: Number.isInteger(team) && team >= 0 && team < MAX_TEAMS ? team : DEFAULT_RIGGED.forcedWinner,
  };
}

/** Picks the rigged fields out of the settings (they travel in the physics config, so the finder's engines get them). */
export function riggedConfigOf(settings: RiggedConfig): RiggedConfig {
  return { neverEscape: settings.neverEscape, forcedWinner: settings.forcedWinner };
}

/** Modes whose balls can leave the arena through its outer wall: where "never escape" and the forced winner act. */
export const RIG_ESCAPE_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply", "portal", "shatter", "colorMatch"];

/** Modes whose run ends with an escape (the same as the escape replay's): with "never escape" on they never end. */
export const ESCAPE_FINISH_MODES: readonly ModeId[] = ["classic", "accumulation", "portal", "shatter", "colorMatch"];

/** Multi-ball modes whose balls race out of the arena: where a forced winner can be made. */
export const WINNER_MODES: readonly ModeId[] = MULTI_BALL_MODES.filter((m) => RIG_ESCAPE_MODES.includes(m));
// --- odd-string-battle ---
/**
 * Battle modes: the winner is the last ball standing. The forced winner acts there too – enforced by the mode itself (the
 * String Battle's chosen ball never loses its last life), not by the director, whose rules stay off without rings.
 */
export const BATTLE_WINNER_MODES: readonly ModeId[] = ["stringBattle"];
// --- odd-territory --- Territory: the team with the most tiles at the countdown wins (the mode absorbs a conversion that would put a rival ahead)
(BATTLE_WINNER_MODES as ModeId[]).push("territory");
// --- odd-maze --- the Maze's winner is the first ball out (the mode's own verdict): its forced winner steers the shortest way
// and the exit stays closed to the others until it is out
(BATTLE_WINNER_MODES as ModeId[]).push("maze");

/** Modes whose run never ends: there the other teams stay in for good, so the chosen team keeps the lead. */
const LOCKED_FOR_GOOD: readonly ModeId[] = ["multiply"];

/**
 * Modes where the first escape ends the run (Shatter + 20 px, Color Match + 30 px beyond the wall): the way out stays
 * locked to the other teams until the run is over. Opening it at the chosen team's escape (+ 10 px, the escape scan)
 * would let a trailing ball slip out before the run ends – the escapes would be level and the walls would decide.
 * Unlike `LOCKED_FOR_GOOD` the chosen ball is still steered toward the gaps.
 */
const EXIT_LOCKED_TO_END: readonly ModeId[] = ["shatter", "colorMatch"];

/**
 * Modes where the forced winner wins by escaping (Multiply, Shatter, Color Match): "never escape" keeps everyone in,
 * so there the forced winner is off while it is on – the rig does not claim a win it cannot make. Classic keeps both:
 * its walls are locked until the chosen team has passed them, so it breaks them all and leads on walls.
 */
export const WINNER_NEEDS_ESCAPE: readonly ModeId[] = ["multiply", "shatter", "colorMatch"];

/**
 * Modes where a gap pass breaks the wall and the teams that all escape are ranked by the walls they broke (Classic):
 * every wall is locked to the other teams until the chosen one has passed it, so it breaks them all. Elsewhere only the
 * way out – the outermost wall – is locked (Shatter's balls dig their narrow corridors freely, the first escape ends
 * the run and ranks first).
 */
const LOCK_EVERY_WALL: readonly ModeId[] = ["classic"];

/** Whether "never escape" acts in `mode` (a mode whose balls can leave the arena). */
export function neverEscapeApplies(mode: ModeId | undefined): boolean {
  return !!mode && RIG_ESCAPE_MODES.includes(mode);
}

/**
 * Whether a forced winner `team` acts in `mode` with `ballCount` balls: a multi-ball escape mode, two balls or more, a
 * team that plays – and, with "never escape" on (`neverEscape`), a mode where the chosen team can win without escaping
 * (not `WINNER_NEEDS_ESCAPE`).
 */
export function forcedWinnerApplies(mode: ModeId | undefined, ballCount: number, team: number, neverEscape = false): boolean {
  if (!mode || !(WINNER_MODES.includes(mode) || BATTLE_WINNER_MODES.includes(mode)) /* --- odd-string-battle --- */ || !(ballCount >= 2) || !Number.isInteger(team) || team < 0 || team >= ballCount) return false;
  return !(neverEscape && WINNER_NEEDS_ESCAPE.includes(mode));
}

/** True when "never escape" switches a chosen forced winner off in `mode` (a mode where the winner has to escape). */
export function forcedWinnerBlockedByNeverEscape(mode: ModeId | undefined, neverEscape: boolean): boolean {
  return neverEscape && !!mode && WINNER_NEEDS_ESCAPE.includes(mode);
}

/** True when the rig keeps a run of `mode` from ever finishing: "never escape" in a mode that ends with an escape. */
export function rigNeverFinishes(mode: ModeId, config: Partial<RiggedConfig> | undefined): boolean {
  return config?.neverEscape === true && ESCAPE_FINISH_MODES.includes(mode);
}

/* ------------------------------------------------------------------ steering constants */

/** Integration step of the ghost flight, seconds. */
export const FLIGHT_DT = 1 / 120;
/** How far ahead a flight is followed, seconds (a ring-mode ball meets a wall well within this). */
export const FLIGHT_HORIZON_SEC = 3;
/** Candidate rebound angles are tried this far apart (radians, 3°). */
export const STEER_STEP = (3 * Math.PI) / 180;
/** The steered rebound stays within this of the wall's normal (80°), so it always leaves the wall. */
export const MAX_REBOUND_FAN = (80 * Math.PI) / 180;
/** How far the director turns the chosen ball's rebound toward a gap it can pass (12°, the director's own bias). */
export const FAVOUR_MAX = (12 * Math.PI) / 180;
/** A closed gap is avoided by this many ball widths (angular) … */
const DANGER_BETA = 1.6;
/** … plus this much (radians) … */
const DANGER_BASE = 0.03;
/** … plus this much per second of flight (the prediction's uncertainty grows with time). */
const DANGER_PER_SEC = 0.05;
/** A bounce off a closed wall within this many ball widths of a gap edge is a near miss (the director's own test). */
const NEAR_MISS_BETA = 4;
/**
 * Flights the steering may predict per 60 Hz step, over all balls: a crowd (Multiply's teams, Shatter's balls
 * re-bouncing in a wall) keeps its frame budget; past it a rebound keeps its natural angle and the seal still holds.
 */
export const MAX_FLIGHTS_PER_STEP = 96;
/**
 * Mid-flight guidance: a ball whose flight was not set by a rebound (a fresh spawn, a deflection off another ball or a
 * frozen one) and that is heading for a closed gap within this many seconds is turned a little every step …
 */
export const GUIDE_LOOKAHEAD_SEC = 0.8;
/** … by this much (radians, 2° per 60 Hz step – a gentle curve, like spin), until its flight misses the gap. */
export const GUIDE_TURN = (2 * Math.PI) / 180;
/** Near misses closer together than this (simulation ms) are one event (a ball re-bouncing in a wall counts once). */
const NEAR_MISS_GAP_MS = 300;

/** Where a predicted flight ends: its first bounce (or none within the horizon). */
export interface Flight {
  /** Wall of the first bounce, −1 when the ghost met none (it left the arena or the horizon ran out). */
  wall: number;
  /** World angle (radians, 0 … 2π) of the contact and its time after the rebound (seconds). */
  angle: number;
  timeSec: number;
  /** The bounce is off a wall closed to this ball, inside or near one of its gaps: the move the rig must prevent. */
  closedGap: boolean;
  /** With `closedGap`: which way the contact should move to leave the gap soonest (−1 clockwise… +1 the other way). */
  away: number;
  /** Gaps the ghost passed on its way (walls open to this ball). */
  passes: number;
}

export function emptyFlight(): Flight {
  return { wall: -1, angle: 0, timeSec: 0, closedGap: false, away: 0, passes: 0 };
}

/** What the canvas mirrors (data-rig-*) and the tests read; the same object every call. */
export interface RigView {
  /** "Never escape" in effect (on, in a mode where balls can escape). */
  neverEscape: boolean;
  /** The forced winner in effect (team slot), or −1. */
  winner: number;
  /** Gap passes the rig refused this run (the safety net under the steering). */
  seals: number;
  /** Rebounds the rig turned this run. */
  steers: number;
  /** Steps in which the rig bent a flight a little (mid-flight guidance) this run. */
  guides: number;
  /** Bounces off a closed wall right beside one of its gaps this run (near misses; the camera's slow motion follows them). */
  nearMisses: number;
  /** Simulation time (ms) of the run's first escape, −1 while there was none (tracked whether the rig is on or off). */
  firstEscapeMs: number;
}

function angleDist(a: number, b: number): number {
  let d = normalizeAngle(b - a);
  if (d > Math.PI) d = TWO_PI - d;
  return d;
}

/**
 * The rig: the settings in effect this step, the run's state (which walls the chosen team has passed, whether it has
 * escaped, the first escape) and the steering. The cinematic director owns one (`CinematicDirector.rig`); the engine
 * refreshes it once per step (`beginStep()`), asks it at every gap pass, wall hit and rebound, and tells it about
 * passes and escapes. It never draws a random number.
 */
export class RigDirector {
  /** Any rig rule in effect this step (false: the engine takes its plain code path). */
  on = false;
  private neverEscape = false;
  private winner = -1;
  private lockedForGood = false;
  private lockEveryWall = false;
  /** The way out stays locked to the other teams until the run ends (`EXIT_LOCKED_TO_END`: Shatter, Color Match). */
  private exitLockedToEnd = false;
  /** Walls the chosen team has passed this run (bit i = wall i; the way out is not opened by a pass, only by an escape). */
  private passed = 0;
  /** A ball of the chosen team has escaped this run: every wall is open to everyone from then on (except in Multiply). */
  private winnerOut = false;
  /**
   * The chosen team lost its last ball without escaping (`markInside()`): nothing it could still open, so the locks are
   * released for the rest of the run (in every mode, Multiply too) and the run can end.
   */
  private released = false;
  private firstEscapeMs = -1;
  private seals = 0;
  private steers = 0;
  private nearMisses = 0;
  private guides = 0;
  private lastNearMissMs = -Infinity;
  private nowMs = 0;
  private readonly view: RigView = { neverEscape: false, winner: -1, seals: 0, steers: 0, guides: 0, nearMisses: 0, firstEscapeMs: -1 };

  // The world of the current step (references into the engine; refreshed by beginStep()).
  private walls: readonly CircularWall[] = [];
  private rotations: readonly number[] = [];
  private broken: ReadonlySet<number> = new Set<number>();
  /** Index of the outermost wall (largest radius), and of the outermost intact one – "never escape"'s barrier. */
  private outer = -1;
  private barrier = -1;
  private cx = 0;
  private cy = 0;
  private spin = 0;
  private shatter = false;
  private baseSpeed = 400;
  private gravity = 0;
  private gDirX = 0;
  private gDirY = 1;
  private windX = 0;
  private windY = 0;
  /** Velocity kept per flight step (air drag), 1 without drag. */
  private dragKeep = 1;
  private keepMoving = true;
  private readonly flight = emptyFlight();
  /** Flights left in this step's budget (MAX_FLIGHTS_PER_STEP). */
  private flightsLeft = MAX_FLIGHTS_PER_STEP;
  /** The balls inside their closed way out at the start of the step (`markInside()`), reused every step. */
  private readonly held: Ball[] = [];
  /** The closed way out (wall index) of each ball in `held`, at the start of the step. */
  private readonly heldWalls: number[] = [];

  /** A new run: nothing passed, nobody out, counters at zero. */
  reset() {
    this.passed = 0;
    this.winnerOut = false;
    this.released = false;
    this.firstEscapeMs = -1;
    this.seals = 0;
    this.steers = 0;
    this.guides = 0;
    this.nearMisses = 0;
    this.lastNearMissMs = -Infinity;
  }

  /**
   * Refreshes the rig for the coming step: the rules in effect (from the config and the mode), the walls and the forces
   * the steering predicts with. Returns `on`. Allocation-free.
   */
  beginStep(
    mode: ModeId | undefined,
    config: PhysicsConfig,
    extras: PhysicsExtras,
    walls: readonly CircularWall[],
    rotations: readonly number[],
    broken: ReadonlySet<number>,
    gravityAccel: number,
    gDirX: number,
    gDirY: number,
    keepMoving: boolean,
    elapsedMs = 0,
  ): boolean {
    if (!this.refreshRules(mode, config, walls.length)) return false;
    this.nowMs = elapsedMs;
    this.broken = broken;
    this.syncWalls(walls, rotations);
    this.cx = config.width / 2;
    this.cy = config.height / 2;
    this.spin = (config.rotationSpeed ?? 1) * 0.8;
    this.shatter = mode === "shatter";
    this.baseSpeed = config.ballSpeed || 400;
    this.gravity = gravityAccel;
    this.gDirX = gDirX;
    this.gDirY = gDirY;
    this.windX = extras.windX * this.baseSpeed;
    this.windY = extras.windY * this.baseSpeed;
    this.dragKeep = extras.airDrag > 0 ? Math.pow(Math.max(0, 1 - extras.airDrag), 60 * FLIGHT_DT) : 1; // --- uncap-all --- drag ≥ 1 stops the flight
    this.keepMoving = keepMoving;
    this.flightsLeft = MAX_FLIGHTS_PER_STEP;
    return true;
  }

  /**
   * The rules in effect for `mode` with this config and `wallCount` walls: "never escape" in a mode whose balls can
   * escape, the forced winner in a multi-ball escape mode with that team in play (and, with "never escape" on, a mode
   * it can win without escaping). Sets and returns `on`.
   */
  refreshRules(mode: ModeId | undefined, config: PhysicsConfig, wallCount: number): boolean {
    this.neverEscape = config.neverEscape === true && wallCount > 0 && neverEscapeApplies(mode);
    const team = config.forcedWinner ?? -1;
    this.winner = team >= 0 && wallCount > 0 && mode !== undefined && forcedWinnerApplies(mode, startBallCount(config, mode), team, this.neverEscape) ? team : -1;
    this.on = this.neverEscape || this.winner >= 0;
    if (!this.on) return false; // the plain path: nothing else to work out
    this.lockedForGood = mode !== undefined && LOCKED_FOR_GOOD.includes(mode);
    this.lockEveryWall = mode !== undefined && LOCK_EVERY_WALL.includes(mode);
    this.exitLockedToEnd = mode !== undefined && EXIT_LOCKED_TO_END.includes(mode);
    return true;
  }

  /**
   * Points the rig at the engine's current walls and rotations (a mode may rebuild them mid-step – Portal opens a gap)
   * and finds the outermost wall and the outermost intact one, "never escape"'s barrier.
   */
  syncWalls(walls: readonly CircularWall[], rotations: readonly number[]) {
    this.walls = walls;
    this.rotations = rotations;
    let outer = -1;
    let barrier = -1;
    for (let i = 0; i < walls.length; i++) {
      const r = walls[i].radius;
      if (outer < 0 || r > walls[outer].radius) outer = i;
      if (!this.broken.has(i) && (barrier < 0 || r > walls[barrier].radius)) barrier = i;
    }
    this.outer = outer;
    this.barrier = barrier;
  }

  /** The forced winner in effect this step, or −1. */
  winnerTeam(): number {
    return this.on ? this.winner : -1;
  }

  /**
   * Wall `w` is closed to `ball` (a ball inside it): its gaps do not let the ball out and it may not break it. "Never
   * escape": the outermost intact wall, for every ball. Forced winner: for the other teams, every wall (Classic) or the
   * outermost one (elsewhere) that the chosen team has not passed yet – a wall broken open before it passed (the
   * outermost) still holds them. The way out itself is never opened by a pass – the chosen ball is still inside while
   * it enters the gap – but only once a ball of the chosen team has escaped; in the modes that end with that escape
   * (Shatter, Color Match) it stays closed until the end, and in Multiply the others stay in for good. Nothing is
   * closed to them any more once the chosen team has lost its last ball without escaping (`released`).
   */
  closes(ball: Pick<Ball, "team">, w: number): boolean {
    if (!this.on) return false;
    if (this.neverEscape && w === this.barrier) return true;
    if (this.winner < 0 || this.released || ball.team === this.winner) return false;
    const exit = w === this.outer;
    if (!this.lockEveryWall && !exit) return false;
    if (this.lockedForGood || (exit && this.exitLockedToEnd)) return true;
    if (this.winnerOut) return false;
    if (!exit && w < 31 && (this.passed >>> w) & 1) return false;
    return exit || !this.broken.has(w);
  }

  /** A broken wall that still holds `ball` in (forced winner: the outermost wall until the chosen team is out). */
  holdsBroken(ball: Pick<Ball, "team">, w: number): boolean {
    return this.on && this.winner >= 0 && this.broken.has(w) && this.closes(ball, w);
  }

  /**
   * A ball of another team may not clone itself on an x2 BALLS orb: in Classic, where every ball escapes in the end and
   * the escapes rank first, a team with more balls would out-escape the chosen one. (Elsewhere the others never get out
   * before the run ends, so their clones cannot outscore it.) The engine skips such a touch – the orb floats on.
   */
  blocksClone(ball: Pick<Ball, "team">): boolean {
    return this.on && this.winner >= 0 && !this.released && this.lockEveryWall && ball.team !== this.winner;
  }

  /** A ball passed a gap of wall `w`: the chosen team's passes open that wall to everyone (the way out excepted, see `closes()`). */
  notePass(ball: Pick<Ball, "team">, w: number) {
    if (this.winner >= 0 && ball.team === this.winner && w < 31) this.passed |= 1 << w;
  }

  /** The engine refused a gap pass (the ball rebounds instead). */
  noteSeal() {
    this.seals++;
  }

  /**
   * A ball escaped the arena at simulation time `timeMs` (the engine's escape scan, whether the rig is on or off):
   * the run's first escape, and whether the chosen team is out.
   */
  noteEscape(ball: Pick<Ball, "team">, timeMs: number) {
    if (this.firstEscapeMs < 0) this.firstEscapeMs = timeMs;
    if (this.winner >= 0 && ball.team === this.winner) this.winnerOut = true;
  }

  /** Simulation time (ms) of the run's first escape, −1 while there was none. */
  getFirstEscapeMs(): number {
    return this.firstEscapeMs;
  }

  /**
   * A bounce of `ball` off wall `w` (radius `radius`, turned by `rotation`) at world angle `angle`: true when the wall
   * is closed to the ball and the bounce sits right beside one of its gaps – a near miss.
   */
  nearMissAt(ball: Ball, w: number, angle: number, radius: number, rotation: number): boolean {
    if (!this.on || !this.closes(ball, w)) return false;
    const beta = Math.atan2(ball.radius, radius);
    const clearance = this.clearance(w, angle, rotation);
    if (!(clearance > 0 && clearance < NEAR_MISS_BETA * beta) || this.nowMs - this.lastNearMissMs < NEAR_MISS_GAP_MS) return false;
    this.lastNearMissMs = this.nowMs;
    this.nearMisses++;
    return true;
  }

  /** The rig's counters and rules for the canvas (data-rig-*) and the tests; the same object every call. */
  getView(): RigView {
    const v = this.view;
    v.neverEscape = this.on && this.neverEscape;
    v.winner = this.on ? this.winner : -1;
    v.seals = this.seals;
    v.steers = this.steers;
    v.guides = this.guides;
    v.nearMisses = this.nearMisses;
    v.firstEscapeMs = this.firstEscapeMs;
    return v;
  }

  /**
   * The rebound angle for `ball`, which just hit wall `w` from inside (`inside`) or outside, flying off at `speed`:
   * `angle` itself when its predicted flight is fine, else the nearest angle (3° at a time, within 80° of the wall's
   * normal) whose flight does not bounce off a closed wall in or next to a gap. The chosen ball of a forced winner is
   * also turned (by at most 12°) through a gap it can pass. Deterministic, allocation-free.
   */
  steer(ball: Ball, w: number, inside: boolean, angle: number, speed: number): number {
    if (!this.on || !(speed > 0) || this.flightsLeft <= 0) return angle;
    // Multiply's chosen team leads for good anyway: turning its (many) balls through the gap would only feed the crowd.
    const favoured = this.winner >= 0 && ball.team === this.winner && !this.lockedForGood;
    const guarded = this.neverEscape || (this.winner >= 0 && !this.released && ball.team !== this.winner);
    if (!favoured && !guarded) return angle;
    const f = this.fly(ball, angle, speed, this.flight);
    const bad = f.closedGap;
    if (!bad && (!favoured || f.passes > 0)) return angle;
    const dx = ball.x - this.cx;
    const dy = ball.y - this.cy;
    const normal = inside ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx);
    /** The chosen ball's nearest safe angle when none within FAVOUR_MAX passes a gap. */
    let safe = Number.NaN;
    for (let k = 1; k * STEER_STEP <= Math.PI; k++) {
      const offset = k * STEER_STEP;
      const favourRange = favoured && offset <= FAVOUR_MAX;
      if (!bad && !favourRange) break; // only favouring, and nothing passable close by: keep the natural angle
      if (bad && !favourRange && !Number.isNaN(safe)) break; // the chosen ball takes the nearest safe angle
      for (let side = 0; side < 2; side++) {
        const candidate = side === 0 ? angle + offset : angle - offset;
        if (angleDist(candidate, normal) > MAX_REBOUND_FAN) continue;
        if (this.flightsLeft <= 0) return Number.isNaN(safe) ? angle : this.steered(safe); // out of budget this step
        const c = this.fly(ball, candidate, speed, this.flight);
        if (c.closedGap) continue;
        if (favourRange && c.passes > 0) return this.steered(candidate); // through a gap it can pass
        if (bad) {
          if (!favoured) return this.steered(candidate); // the nearest angle that misses the closed gaps
          if (Number.isNaN(safe)) safe = candidate;
        }
      }
    }
    if (!Number.isNaN(safe)) return this.steered(safe);
    return angle; // nothing safe in reach: the engine's seal holds the ball anyway
  }

  private steered(angle: number): number {
    this.steers++;
    return angle;
  }

  /** The wall that is `ball`'s closed way out – never escape's barrier, or the locked outermost wall of a forced winner's other teams – or −1. */
  private exitWall(ball: Ball): number {
    if (this.neverEscape) return this.barrier;
    if (this.winner >= 0 && this.outer >= 0 && this.closes(ball, this.outer)) return this.outer;
    return -1;
  }

  /**
   * Start of a step (after `beginStep()`): notes the balls that are inside their closed way out. Also the safety net of
   * the forced winner: when no ball of the chosen team is left in play and none has escaped (the merge interaction fused
   * its last ball into another team's – the engine normally hands the merged ball the chosen team), nothing could ever
   * open the walls it keeps closed, so the locks are released for the rest of the run instead of holding the others in
   * forever. Allocation-free.
   */
  markInside(balls: readonly Ball[]) {
    this.held.length = 0;
    this.heldWalls.length = 0;
    if (!this.on) return;
    if (this.winner >= 0 && !this.winnerOut && !this.released) {
      let inPlay = false;
      for (let i = 0; i < balls.length && !inPlay; i++) inPlay = balls[i].team === this.winner;
      if (!inPlay) this.released = true;
    }
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const w = this.exitWall(ball);
      if (w < 0 || !this.walls[w]) continue;
      const limit = this.walls[w].radius + 2;
      const dx = ball.x - this.cx;
      const dy = ball.y - this.cy;
      if (dx * dx + dy * dy < limit * limit) {
        this.held.push(ball);
        this.heldWalls.push(w);
      }
    }
  }

  /**
   * `ball` was inside wall `w`, its closed way out, at the start of the step (`markInside()`). The engine refuses a gap pass
   * through such a wall even when a fast sub-step already carried the ball's centre past it, so the guarantee does not hang
   * on the collision band's width. O(held) – asked only for a ball found outside a closed wall. Allocation-free.
   */
  heldAtStart(ball: Ball, w: number): boolean {
    for (let i = 0; i < this.held.length; i++) if (this.held[i] === ball) return this.heldWalls[i] === w;
    return false;
  }

  /**
   * The backstop, after the step's sub-steps: a noted ball whose centre ended up beyond its closed way out – whatever
   * pushed it there (a deflection off a frozen ball, a pair correction) – is put back just inside, heading in, before the
   * mode or the escape scan can count it out. Counted as a seal. Allocation-free.
   */
  holdInside(walls: readonly CircularWall[], rotations: readonly number[]) {
    if (this.held.length === 0) return;
    this.syncWalls(walls, rotations);
    for (let i = 0; i < this.held.length; i++) {
      const ball = this.held[i];
      const w = this.exitWall(ball);
      if (w < 0 || !this.walls[w]) continue;
      const radius = this.walls[w].radius;
      const dx = ball.x - this.cx;
      const dy = ball.y - this.cy;
      const d = Math.hypot(dx, dy);
      if (d <= radius) continue;
      const nx = dx / d;
      const ny = dy / d;
      const back = Math.max(0, radius - ball.radius - 3);
      ball.x = this.cx + nx * back;
      ball.y = this.cy + ny * back;
      const out = ball.vx * nx + ball.vy * ny;
      if (out > 0) {
        ball.vx -= 2 * out * nx;
        ball.vy -= 2 * out * ny;
      }
      this.seals++;
    }
    this.held.length = 0;
    this.heldWalls.length = 0;
  }

  /**
   * Mid-flight guidance, once per step for every ball: a ball the rig guards (never escape; the other teams of a forced
   * winner) that is flying outward and would bounce off a closed wall in or next to a gap within GUIDE_LOOKAHEAD_SEC
   * has its velocity turned by GUIDE_TURN toward the gap's nearer edge. Catches the flights no rebound set (a spawn, a
   * deflection off another ball) – a slight curve instead of a bounce off thin air. Deterministic.
   */
  guide(ball: Ball) {
    if (!this.on || this.flightsLeft <= 0 || ball.frozen) return;
    if (!this.neverEscape && !(this.winner >= 0 && !this.released && ball.team !== this.winner)) return;
    const dx = ball.x - this.cx;
    const dy = ball.y - this.cy;
    if (dx * ball.vx + dy * ball.vy <= 0) return; // not heading out
    const speed = Math.hypot(ball.vx, ball.vy);
    if (!(speed > 0)) return;
    const d = Math.hypot(dx, dy);
    const next = this.barrierAbove(ball, d);
    if (next < 0 || !this.closes(ball, next)) return;
    const reach = speed * GUIDE_LOOKAHEAD_SEC + 0.5 * Math.abs(this.gravity) * GUIDE_LOOKAHEAD_SEC * GUIDE_LOOKAHEAD_SEC;
    if (this.walls[next].radius - d - ball.radius > reach) return; // too far to matter yet
    const f = this.fly(ball, Math.atan2(ball.vy, ball.vx), speed, this.flight);
    if (!f.closedGap || f.timeSec > GUIDE_LOOKAHEAD_SEC) return;
    const turn = f.away * GUIDE_TURN;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const vx = ball.vx;
    ball.vx = vx * c - ball.vy * s;
    ball.vy = vx * s + ball.vy * c;
    this.guides++;
  }

  /* ------------------------------------------------------------------ prediction */

  /** Angular distance from `angle` to the nearest gap of wall `w` turned by `rotation` (0 inside one, Infinity without gaps). */
  private clearance(w: number, angle: number, rotation: number): number {
    const wall = this.walls[w];
    if (!wall) return Infinity;
    const a = normalizeAngle(angle);
    let best = Infinity;
    for (const gap of wall.gaps) {
      const start = normalizeAngle(gap.startAngle + rotation);
      let width = normalizeAngle(gap.endAngle + rotation) - start;
      if (width < 0) width += TWO_PI;
      const into = normalizeAngle(a - start);
      if (into <= width) return 0;
      const d = Math.min(TWO_PI - into, into - width);
      if (d < best) best = d;
    }
    return best;
  }

  /** The engine's gap test: `angle` lies in a gap of wall `w` (turned by `rotation`) that the whole ball fits through. */
  private passable(w: number, angle: number, rotation: number, beta: number): boolean {
    const wall = this.walls[w];
    if (!wall) return false;
    const a = normalizeAngle(angle);
    const need = beta * (this.shatter ? 1.2 : 2.5);
    const margin = this.shatter ? 0.5 * beta : beta;
    for (const gap of wall.gaps) {
      const start = normalizeAngle(gap.startAngle + rotation);
      let width = normalizeAngle(gap.endAngle + rotation) - start;
      if (width < 0) width += TWO_PI;
      if (width < need) continue;
      const into = normalizeAngle(a - start);
      if (into >= margin && into <= width - margin) return true;
    }
    return false;
  }

  /** Wall `i` stops `ball` in the ghost flight (intact, or broken but holding it). */
  private isBarrier(ball: Ball, i: number): boolean {
    return !this.broken.has(i) || this.holdsBroken(ball, i);
  }

  /** The barrier just outside radius `d` (smallest radius above it), −1 when none. */
  private barrierAbove(ball: Ball, d: number): number {
    let best = -1;
    for (let i = 0; i < this.walls.length; i++) {
      const r = this.walls[i].radius;
      if (r > d && this.isBarrier(ball, i) && (best < 0 || r < this.walls[best].radius)) best = i;
    }
    return best;
  }

  /** The barrier just inside radius `d` (largest radius below it), −1 when none. */
  private barrierBelow(ball: Ball, d: number): number {
    let best = -1;
    for (let i = 0; i < this.walls.length; i++) {
      const r = this.walls[i].radius;
      if (r < d && this.isBarrier(ball, i) && (best < 0 || r > this.walls[best].radius)) best = i;
    }
    return best;
  }

  /**
   * Predicts the flight of `ball` leaving at `angle` with `speed` up to its first bounce: gravity (with the ball's own
   * weight), wind, air drag and the ring modes' cruising-speed boost, integrated at FLIGHT_DT like the engine's
   * sub-steps; the walls turn as they do in the engine. A gap the ball fits through on a wall open to it is passed
   * (counted in `passes`); a bounce off a wall closed to it inside or near a gap (the danger margin grows with the
   * flight time) is `closedGap`. Writes into `out`.
   */
  fly(ball: Ball, angle: number, speed: number, out: Flight): Flight {
    this.flightsLeft--;
    out.wall = -1;
    out.angle = 0;
    out.timeSec = 0;
    out.closedGap = false;
    out.passes = 0;
    const walls = this.walls;
    if (walls.length === 0) return out;
    let x = ball.x - this.cx;
    let y = ball.y - this.cy;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    const r = ball.radius;
    const g = this.gravity * (ball.gravityScale ?? 1);
    const ax = g * this.gDirX + this.windX;
    const ay = g * this.gDirY + this.windY;
    const cruise = this.keepMoving ? cruiseSpeed(ball, this.baseSpeed) : 0;
    const boost = 1 + 0.5 * FLIGHT_DT;
    const drag = this.dragKeep;
    const dt = FLIGHT_DT;
    let d = Math.hypot(x, y);
    let outer = this.barrierAbove(ball, d);
    let inner = this.barrierBelow(ball, d);
    /** The wall just passed, ignored until the ball has cleared it (it is still overlapping it for a few steps). */
    let skip = -1;
    const steps = Math.ceil(FLIGHT_HORIZON_SEC / dt);
    const far = walls[this.outer >= 0 ? this.outer : 0].radius + 4 * r + 20;
    for (let i = 1; i <= steps; i++) {
      vx += ax * dt;
      vy += ay * dt;
      if (cruise > 0) {
        const s = Math.hypot(vx, vy);
        if (s > 0 && s < cruise) {
          vx *= boost;
          vy *= boost;
        }
      }
      if (drag !== 1) {
        vx *= drag;
        vy *= drag;
      }
      x += vx * dt;
      y += vy * dt;
      d = Math.hypot(x, y);
      const t = i * dt;
      if (skip >= 0 && Math.abs(d - walls[skip].radius) > r + 3) skip = -1;
      /** Radial velocity: a contact only counts while the ball moves toward the wall (a fresh rebound may still touch it). */
      const radial = x * vx + y * vy;
      if (outer >= 0 && outer !== skip && radial > 0 && d + r + 2 >= walls[outer].radius) {
        const w = outer;
        const a = Math.atan2(y, x);
        const rotation = (this.rotations[w] ?? 0) + this.rate(w) * t;
        const beta = Math.atan2(r, walls[w].radius);
        const closed = this.closes(ball, w);
        if (!closed && this.passable(w, a, rotation, beta)) {
          out.passes++;
          skip = w;
          inner = w;
          outer = this.barrierAbove(ball, walls[w].radius + 0.5);
          continue;
        }
        return this.contact(out, w, a, t, closed, rotation, beta);
      }
      if (inner >= 0 && inner !== skip && radial < 0 && d - r - 2 <= walls[inner].radius) {
        const w = inner;
        const a = Math.atan2(y, x);
        const rotation = (this.rotations[w] ?? 0) + this.rate(w) * t;
        const beta = Math.atan2(r, walls[w].radius);
        if (this.passable(w, a, rotation, beta)) {
          // Passing a gap inward is always allowed (the rig only keeps balls from getting out).
          out.passes++;
          skip = w;
          outer = w;
          inner = this.barrierBelow(ball, walls[w].radius - 0.5);
          continue;
        }
        return this.contact(out, w, a, t, false, rotation, beta);
      }
      if (outer < 0 && d > far) break; // out of the arena: no more bounces
    }
    return out;
  }

  private contact(out: Flight, w: number, angle: number, t: number, closed: boolean, rotation: number, beta: number): Flight {
    out.wall = w;
    out.angle = normalizeAngle(angle);
    out.timeSec = t;
    out.away = 0;
    if (!closed) return out;
    const margin = DANGER_BETA * beta + DANGER_BASE + DANGER_PER_SEC * t;
    // The gap the contact is in or nearest to, and the way out of it: toward its nearer edge.
    const wall = this.walls[w];
    let best = Infinity;
    for (const gap of wall.gaps) {
      const start = normalizeAngle(gap.startAngle + rotation);
      let width = normalizeAngle(gap.endAngle + rotation) - start;
      if (width < 0) width += TWO_PI;
      const into = normalizeAngle(out.angle - start);
      // Inside: the nearer edge; outside: the edge on the contact's side (distance 0 means "inside").
      const inside = into <= width;
      const toStart = inside ? into : TWO_PI - into;
      const toEnd = inside ? width - into : into - width;
      const dist = inside ? 0 : Math.min(toStart, toEnd);
      if (dist < best) {
        best = dist;
        out.away = toStart <= toEnd ? -1 : 1;
      }
    }
    out.closedGap = best < margin;
    return out;
  }

  /** Angular speed (rad/s) of wall `w`, as the engine turns it: even walls one way, odd walls the other. */
  private rate(w: number): number {
    return w % 2 === 0 ? this.spin : -this.spin;
  }
}
