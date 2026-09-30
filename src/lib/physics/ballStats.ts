import type { Ball, ModeId, PhysicsConfig } from "./types";

/**
 * Per-ball and per-team statistics of a run (the "Team balls with scoreboard" feature): wall bounces, walls
 * broken and escapes. The engine owns one `BallStatsBook` and records into it from the places where these
 * things already happen – the rebound branch of the wall collision, `reportWallBreak()` (the engine's own gap
 * pass, Multiply's escapes and Shatter's segment breaks), `ctx.creditWallBreak()` (Color Match's segment
 * breaks) and a once-per-step escape scan. Recording never changes a ball and draws no random numbers, so
 * seeds, the finder and "rigged" outcomes are untouched.
 *
 * A ball's team is its start slot (`Ball.team`, 0 … MAX_TEAMS − 1): the balls the engine spawns at the start
 * carry it, and so do the balls they spawn (Multiply) or split into. Balls without a team are only tracked per ball.
 */

export interface BallStats {
  /** Wall rebounds. */
  bounces: number;
  /** Walls (or wall segments) the ball broke through or broke. */
  walls: number;
  /** Times the ball (or, for a team, one of its balls) left the arena. */
  escapes: number;
  /** Simulation time (ms) of the first escape; -1 while there was none. */
  firstEscapeMs: number;
}

/** The most balls – and so teams – a run starts with. */
export const MAX_TEAMS = 6;

/** Per-ball entries are kept for this many balls (a long Multiply run spawns thousands); team totals are always kept. */
export const MAX_TRACKED_BALLS = 4096;

/** How far (px) beyond the outermost wall a ball has to be to count as escaped. */
export const ESCAPE_MARGIN = 10;

/**
 * Modes that start with several balls when the ball count asks for it (the old "two balls" modes plus Color Match,
 * whose balls share the colour to match). Multiply starts with that many and multiplies them from there.
 */
export const MULTI_BALL_MODES: readonly ModeId[] = ["classic", "multiply", "lines", "grow", "shatter", "colorMatch"];

/**
 * Multi-ball modes that hold fewer than MAX_TEAMS balls. Grow grows every ball to about the radius of its sealed
 * ring, so three or more balls crush each other through the ring (and the rest jam at hundreds of bounces a second):
 * it keeps its old limit of two balls, whose runs replay exactly as before.
 */
export const MODE_MAX_BALLS: Partial<Record<ModeId, number>> = { grow: 2 };

/** The most balls a multi-ball `mode` starts with (and so the most teams that play in it): its own cap, else MAX_TEAMS. */
export function modeBallCap(mode: ModeId): number {
  return MODE_MAX_BALLS[mode] ?? MAX_TEAMS;
}

/** Colours of the third to sixth starting ball without a team roster (the first two use the ball colours of the settings). */
export const EXTRA_BALL_COLORS: readonly string[] = ["#33CCFF", "#FFD23F", "#7CFC00", "#C77DFF"];

/**
 * How many balls a run of `mode` starts with: `ballCount` (1 – the mode's cap, `modeBallCap()`) when the config
 * carries it, else 2 with `twoBalls`.
 */
export function startBallCount(config: Pick<PhysicsConfig, "ballCount" | "twoBalls">, mode: ModeId): number {
  if (!MULTI_BALL_MODES.includes(mode)) return 1;
  const n = config.ballCount;
  if (n === undefined || !Number.isFinite(n)) return config.twoBalls ? 2 : 1;
  return Math.max(1, Math.min(modeBallCap(mode), Math.round(n)));
}

/**
 * The biggest ball the rings of `mode` must let through: the Ball Size – with the merge interaction, the ball all the
 * starting balls can fuse into (the same total area: × √count). Ring gaps are widened for it (`passableGap()`).
 */
export function ringPassRadius(config: Pick<PhysicsConfig, "ballRadius" | "ballCount" | "twoBalls" | "ballInteraction">, mode: ModeId): number {
  const r = config.ballRadius || 8;
  return config.ballInteraction === "merge" ? r * Math.sqrt(startBallCount(config, mode)) : r;
}

/** Colour of the starting ball in slot `slot` (0 = the ball colour, 1 = the second ball colour, then EXTRA_BALL_COLORS). */
export function startBallColor(slot: number, config: Pick<PhysicsConfig, "ballColor" | "ballColor2">): string {
  if (slot <= 0) return config.ballColor || "#FFFFFF";
  if (slot === 1) return config.ballColor2 || "#FF3366";
  return EXTRA_BALL_COLORS[(slot - 2) % EXTRA_BALL_COLORS.length];
}

/** Direction (radians) of starting ball `slot` of `count`, the first flying at `a`: evenly spread, the second of two straight back as always. */
export function startBallAngle(a: number, slot: number, count: number): number {
  const TWO_PI = Math.PI * 2;
  if (slot === 0) return a;
  return count === 2 ? (a + Math.PI) % TWO_PI : (a + (slot * TWO_PI) / count) % TWO_PI;
}

export function emptyStats(): BallStats {
  return { bounces: 0, walls: 0, escapes: 0, firstEscapeMs: -1 };
}

function zero(stats: BallStats) {
  stats.bounces = 0;
  stats.walls = 0;
  stats.escapes = 0;
  stats.firstEscapeMs = -1;
}

/** The team slot of a ball, or -1 when it has none (or an invalid one). */
export function teamSlotOf(ball: Pick<Ball, "team">): number {
  const team = ball.team;
  return team !== undefined && Number.isInteger(team) && team >= 0 && team < MAX_TEAMS ? team : -1;
}

export class BallStatsBook {
  private readonly perBall = new Map<number, BallStats>();
  private readonly escaped = new Set<number>();
  /** Totals per team slot (always MAX_TEAMS entries, reused across runs). */
  readonly teams: BallStats[] = Array.from({ length: MAX_TEAMS }, emptyStats);
  /** Bumped by every `reset()`, so a renderer can tell a new run from the same one. */
  generation = 0;

  reset() {
    this.perBall.clear();
    this.escaped.clear();
    for (const team of this.teams) zero(team);
    this.generation++;
  }

  /** The ball bounced off a wall. */
  bounce(ball: Pick<Ball, "id" | "team">) {
    const own = this.entry(ball.id);
    if (own) own.bounces++;
    const slot = teamSlotOf(ball);
    if (slot >= 0) this.teams[slot].bounces++;
  }

  /** The ball broke through (or broke) a wall or a wall segment. */
  wall(ball: Pick<Ball, "id" | "team">) {
    const own = this.entry(ball.id);
    if (own) own.walls++;
    const slot = teamSlotOf(ball);
    if (slot >= 0) this.teams[slot].walls++;
  }

  /** The ball left the arena at simulation time `timeMs`; a ball escapes once (later calls are ignored). Returns true when it counted. */
  escape(ball: Pick<Ball, "id" | "team">, timeMs: number): boolean {
    if (this.escaped.has(ball.id)) return false;
    this.escaped.add(ball.id);
    const own = this.entry(ball.id);
    if (own) {
      own.escapes++;
      if (own.firstEscapeMs < 0) own.firstEscapeMs = timeMs;
    }
    const slot = teamSlotOf(ball);
    if (slot >= 0) {
      const team = this.teams[slot];
      team.escapes++;
      if (team.firstEscapeMs < 0) team.firstEscapeMs = timeMs;
    }
    return true;
  }

  hasEscaped(id: number): boolean {
    return this.escaped.has(id);
  }

  /** A ball split in two: the new half of an escaped ball is escaped too (it flies out with its parent instead of scoring again). */
  inheritEscape(parentId: number, halfId: number) {
    if (this.escaped.has(parentId)) this.escaped.add(halfId);
  }

  /** The stats of one ball (undefined when it never scored, or beyond `MAX_TRACKED_BALLS`). */
  ballStats(id: number): Readonly<BallStats> | undefined {
    return this.perBall.get(id);
  }

  /** How many balls have an entry. */
  trackedBalls(): number {
    return this.perBall.size;
  }

  private entry(id: number): BallStats | null {
    let stats = this.perBall.get(id);
    if (!stats) {
      if (this.perBall.size >= MAX_TRACKED_BALLS) return null;
      stats = emptyStats();
      this.perBall.set(id, stats);
    }
    return stats;
  }
}
