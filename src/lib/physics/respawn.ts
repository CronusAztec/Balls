import type { ModeContext, ModeId, PhysicsConfig } from "./types";
import { startBallColor, startBallCount } from "./ballStats";

/**
 * --- gerald-conveyor --- Timed respawns for Classic and Multiply (the character-ball account's "Gerald respawns every
 * 3 seconds"): with `respawnEvery` (seconds, 0 = off) a new ball drops in from the top every N seconds of the simulation
 * clock – the k-th one in the 60 Hz step whose end first reaches k × N seconds – into the innermost ring still standing,
 * falling at a share of the Ball Speed in a seeded direction within `RESPAWN_SPREAD` of straight down. The drop plays the
 * conveyor's click (`SoundEvent.conveyor`). It is a physics value: it travels in `PhysicsConfig.respawnEvery`, so the page's
 * config effects, the seed finder (which copies the page engine's config), the fast export, the batch render and the
 * split-screen arenas (`arenaPhysicsConfig()` in lib/simulation/multi.ts) all run it, and a seed replays exactly with it.
 * Nothing changes while it is 0 – no random number is drawn – so every run without it replays as before.
 *
 * Classic stops respawning once every ring is broken (there is nothing left to escape, and the run can end); Multiply's ring
 * is never broken for good, so it respawns as long as it runs. A run holds at most `RESPAWN_MAX_BALLS` balls (a soft,
 * memory-safe ceiling like Multiply's own): a respawn due past it is skipped. A shorter period chosen mid-run never drops a
 * backlog – one ball per step at most, and the count moves on to the schedule.
 */

/** The modes the respawn timer applies to (its slider shows in their Ball section). */
export const RESPAWN_MODES: readonly ModeId[] = ["classic", "multiply"];

/** The slider's comfort range (seconds; 0 = off). The number field takes any value from 0 up. */
export const RESPAWN_RANGES = {
  respawnEvery: { min: 0, max: 10, step: 0.5 },
} as const;

export const DEFAULT_RESPAWN_EVERY = 0;

/** Most balls a respawning run holds (Multiply's own swarm ceiling): a respawn due past it is skipped. */
export const RESPAWN_MAX_BALLS = 200;
/** The new ball appears this share of the innermost standing ring's radius above the centre … */
export const RESPAWN_DROP_AT = 0.55;
/** … falling at this share of the Ball Speed … */
export const RESPAWN_DROP_SPEED = 0.6;
/** … in a direction at most this many radians either side of straight down (seeded). */
export const RESPAWN_SPREAD = 0.45;

/** The respawn period of a stored value: a finite number from 0 up (uncapped), anything else is off. */
export function resolveRespawnEvery(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Whether a run of `mode` respawns with a period of `everySec`. */
export function respawnApplies(mode: ModeId | undefined, everySec: number | undefined): boolean {
  return !!mode && RESPAWN_MODES.includes(mode) && typeof everySec === "number" && everySec > 0 && Number.isFinite(everySec);
}

/** How many respawns are due by simulation time `elapsedMs` with a period of `everySec` (the first at N s, the k-th at k × N s). */
export function respawnDue(elapsedMs: number, everySec: number): number {
  if (!(everySec > 0) || !Number.isFinite(everySec) || !(elapsedMs > 0)) return 0;
  return Math.floor((elapsedMs + 1e-6) / (everySec * 1000));
}

/** The simulation times (s) of the first `count` respawns with a period of `everySec`. */
export function respawnSchedule(everySec: number, count: number): number[] {
  const out: number[] = [];
  if (!(everySec > 0) || !Number.isFinite(everySec)) return out;
  for (let k = 1; k <= count; k++) out.push(k * everySec);
  return out;
}

/** The physics-config patch of the setting (the page's config effect, the bot's and the live preview's config): always the value, 0 = off. */
export function respawnConfigOf(source: { respawnEvery?: number }): Pick<PhysicsConfig, "respawnEvery"> {
  return { respawnEvery: resolveRespawnEvery(source.respawnEvery) };
}

/** The respawn timer of one engine: counts the run's respawns (reset with every run) and drops the due ones in. */
export class RespawnTimer {
  /** Respawns due so far this run (made or skipped). */
  private done = 0;
  /** Balls dropped in so far this run. */
  private made = 0;

  reset() {
    this.done = 0;
    this.made = 0;
  }

  /** Balls dropped in so far this run. */
  get count(): number {
    return this.made;
  }

  /**
   * Once per 60 Hz step, after the mode's `onPreUpdate()` (`elapsedMs`: the simulation clock at the end of the step): drops
   * in the respawn that is due, if any. Draws one random number per ball dropped in, none otherwise.
   */
  step(ctx: ModeContext, mode: ModeId | undefined, elapsedMs: number) {
    const every = ctx.config.respawnEvery;
    if (!respawnApplies(mode, every)) return;
    const due = respawnDue(elapsedMs, every!);
    if (due <= this.done) return;
    this.done = due; // (one ball a step: a backlog from a period shortened mid-run is skipped)
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const broken = ctx.getBrokenWalls();
    let inner = -1;
    for (let i = 0; i < walls.length; i++) {
      if (broken.has(i)) continue;
      if (inner < 0 || walls[i].radius < walls[inner].radius) inner = i;
    }
    if (inner < 0) return; // every ring broken: nothing left to escape
    const balls = ctx.getBalls();
    if (balls.length >= RESPAWN_MAX_BALLS) return;
    const radius = ctx.config.ballRadius || 8;
    const R = walls[inner].radius;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const lift = Math.max(0, Math.min(R * RESPAWN_DROP_AT, R - radius - 4));
    const u = ctx.random();
    const a = Math.PI / 2 + (2 * u - 1) * RESPAWN_SPREAD;
    const speed = (ctx.config.ballSpeed || 400) * RESPAWN_DROP_SPEED;
    // The team slots take turns (the first respawn plays for the second team with two balls); one ball: Gerald again.
    const teams = mode ? startBallCount(ctx.config, mode) : 1;
    const slot = teams > 1 ? due % teams : 0;
    ctx.addBall({
      x: cx,
      y: cy - lift,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      radius,
      color: startBallColor(slot, ctx.config),
      team: slot,
    });
    ctx.getLastWallLayer().set(ctx.getNextId() - 1, -1);
    this.made++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, conveyor: "click", level: 0.8, melody: false });
  }
}
