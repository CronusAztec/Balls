import type { Ball, GameMode, ModeContext, WallHitResult } from "../types";
import { arenaRadius, passableGap } from "../types";
import { ringPassRadius, startBallAngle, startBallColor, startBallCount } from "../ballStats";
import { copyMultipliers, cruiseSpeed } from "../multipliers"; // --- gerald-multipliers ---
import { SWARM_LIMIT_DEFAULT, engagedSwarmCeiling, swarmLimitOf } from "../growthCaps"; // --- unlimited-sizes --- (the swarm's ceiling is a setting now)

/**
 * Most balls a Multiply run grows to – a soft, memory-safe ceiling on the swarm, not a setting's limit (the spawn count
 * keeps its full range). Every escape adds `spawnCount` balls, so the count grows exponentially: at the defaults (three
 * new balls an escape) a run passes 1,000 balls within about a minute, and the ball pass (n² pairs, 4+ sub-steps a step)
 * then costs 60–100 ms a step – the page freezes. With multipliers in play it comes sooner (--- gerald-multipliers --- the
 * new balls inherit the escaped ball's speed, so every escape comes earlier; up to 64 sub-steps a step). Past it an
 * escape still counts (sound, confetti, scoreboard, the broken wall) but spawns nothing. Runs that never reach it replay
 * exactly as before.
 */
export const MULTIPLY_MAX_BALLS = SWARM_LIMIT_DEFAULT; // --- unlimited-sizes --- (the default of the `swarmLimit` setting, URL swl)
/** @deprecated The ceiling applies to every Multiply run now; see `MULTIPLY_MAX_BALLS`. */
export const MULTIPLY_MAX_BALLS_WITH_MULTIPLIERS = MULTIPLY_MAX_BALLS;

// --- multiply-race ---
/*
 * What a stranger reads of a Multiply run (draw only, every run): the swarm's count and its doublings, the generation of every
 * ball (the start ball 0, its children 1 …: the canvas colours them by it), the last escape. Kept beside the physics, never
 * read by it: a run plays exactly as before.
 *
 * Race to the limit (`race`, the settings' `multiplyRace`, URL `mrace`; off by default, so every old link and plan replays):
 *  - the start ball leaves through the gap at once: init places it in the centre aimed where the gap will be when it gets
 *    there (a flight under gravity, searched over 720 directions and refined; one seeded draw picks the spot inside the gap),
 *    so the first split comes within about a second on every seed;
 *  - the swarm's own voice instead of a blip a bounce: an escape plays the rising arpeggio of the count (one per
 *    RACE_ESCAPE_GAP_MS), a bounce a soft pluck on the pentatonic ladder by the ball's generation (one per RACE_BOUNCE_GAP_MS),
 *    thicker – a fifth, then an octave over it – as the swarm doubles;
 *  - the run ends when the swarm reaches its limit (the Swarm Limit, `swarmLimitOf()`: a memory ceiling, never a slider's
 *    maximum): the crash, confetti and the completion chord at `fullMs`, the run over RACE_HOLD_MS later.
 */
/** Least simulation ms between two escape arpeggios and two bounce plucks of a race (a swarm of 200 bounces 120 times a second). */
export const RACE_ESCAPE_GAP_MS = 250;
export const RACE_BOUNCE_GAP_MS = 300;
/** How long the full swarm holds before the run is over (simulation ms): the burst and the banner. */
export const RACE_HOLD_MS = 1500;
/** The bounce plucks' ladder (C major pentatonic from C4) and the final chord's root (C3). */
export const RACE_LADDER_HZ: readonly number[] = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
export const RACE_CHORD_HZ = 130.81;
/** The aim's search: directions tried, and the flight's time step (s) and longest flight (s). */
const AIM_DIRECTIONS = 720;
const AIM_DT = 1 / 600;
const AIM_MAX_SEC = 3;

/** What the canvas reads of a Multiply run (the same object every call; draw and sound only). */
export interface MultiplyView {
  /** The swarm's size so far: the most balls (the ones flying out too, and crowd balls) on the field at once this run. */
  count: number;
  /** The swarm's limit (where a race ends); Infinity with none. */
  limit: number;
  escapes: number;
  /** Ball id → generation (the start ball 0), and the newest generation. */
  genOf: Map<number, number>;
  topGen: number;
  /** The simulation ms of the view. */
  timeMs: number;
  /** The last escape: when (−1 before) and where it left the ring. */
  escapeMs: number;
  escapeX: number;
  escapeY: number;
  /** The count's doublings: the last power of two it reached and when (−1 before). */
  doubled: number;
  doubledMs: number;
  /** Race to the limit: on, when the swarm reached its limit (−1) and whether the run is over. */
  race: boolean;
  fullMs: number;
  finished: boolean;
}

/** The bounce pluck's pitch of a ball of generation `gen` (up the ladder, an octave up past its top). */
export function racePluckHz(gen: number): number {
  const g = Math.max(0, Math.floor(gen));
  const n = RACE_LADDER_HZ.length;
  return RACE_LADDER_HZ[g % n] * Math.pow(2, Math.floor(g / n));
}

/** The notes of a bounce pluck while the swarm counts `count` balls: the note, its fifth from 16 balls, its octave from 64. */
export function raceChord(root: number, count: number): number[] {
  if (count >= 64) return [root, 1.5 * root, 2 * root];
  if (count >= 16) return [root, 1.5 * root];
  return [root];
}

/** The angle `a` brought into (−π, π]. */
function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/**
 * Where a ball launched from (cx, cy) at `speed` in direction `a`, falling at `gravity`, first meets the circle of radius
 * `reach` (its centre on it): the time (s) and the angle, or null when it never gets there within AIM_MAX_SEC.
 */
export function flightTo(a: number, speed: number, gravity: number, reach: number): { t: number; angle: number } | null {
  let x = 0;
  let y = 0;
  const vx = Math.cos(a) * speed;
  let vy = Math.sin(a) * speed;
  for (let t = 0; t < AIM_MAX_SEC; t += AIM_DT) {
    vy += gravity * AIM_DT;
    x += vx * AIM_DT;
    y += vy * AIM_DT;
    if (x * x + y * y >= reach * reach) return { t: t + AIM_DT, angle: Math.atan2(y, x) };
  }
  return null;
}

/**
 * The launch direction that brings a ball to the middle of the ring's gap (`target` radians past its middle, inside the gap) –
 * the gap turning at `spin` rad/s from `gapMid` – searched over AIM_DIRECTIONS directions and refined around the best.
 */
export function aimAtGap(speed: number, gravity: number, reach: number, gapMid: number, spin: number, target = 0): number {
  const miss = (a: number) => {
    const hit = flightTo(a, speed, gravity, reach);
    return hit ? Math.abs(wrapAngle(hit.angle - (gapMid + target + spin * hit.t))) + 1e-3 * hit.t : Infinity;
  };
  let best = 0;
  let bestMiss = Infinity;
  for (let k = 0; k < AIM_DIRECTIONS; k++) {
    const a = (2 * Math.PI * k) / AIM_DIRECTIONS;
    const m = miss(a);
    if (m < bestMiss) {
      bestMiss = m;
      best = a;
    }
  }
  const step = (2 * Math.PI) / AIM_DIRECTIONS;
  for (let k = -10; k <= 10; k++) {
    const a = best + (k * step) / 10;
    const m = miss(a);
    if (m < bestMiss) {
      bestMiss = m;
      best = a;
    }
  }
  return best;
}
// --- end multiply-race ---

/** Multiply: every ball that escapes the single ring spawns several new balls. */
export class MultiplyMode implements GameMode {
  readonly name = "multiply";
  private spawnCount = 3;
  private escapedBalls = new Set<number>();
  /** The ids of the balls in play, refilled every step to prune `escapedBalls` in O(n) (reused: no allocation per step). */
  private readonly liveIds = new Set<number>();
  // --- multiply-race ---
  private race = false;
  private lastEscapeNoteMs = -Infinity;
  private lastBounceNoteMs = -Infinity;
  private readonly view: MultiplyView = { count: 0, limit: Infinity, escapes: 0, genOf: new Map(), topGen: 0, timeMs: 0, escapeMs: -1, escapeX: 0, escapeY: 0, doubled: 1, doubledMs: -1, race: false, fullMs: -1, finished: false };
  /** Race to the limit (see above); applies from the next init (the aimed start ball). */
  setRace(on: boolean) {
    this.race = on;
  }
  getRace() {
    return this.race;
  }
  /** The run as the canvas reads it (the same object every call). */
  getView(): MultiplyView {
    return this.view;
  }
  // --- end multiply-race ---

  init(ctx: ModeContext) {
    this.escapedBalls.clear();
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    // --- multiply-race --- a new run's view, and a race's start ball aimed at the gap
    const v = this.view;
    v.count = 0;
    v.limit = Infinity;
    v.escapes = 0;
    v.genOf.clear();
    v.topGen = 0;
    v.timeMs = 0;
    v.escapeMs = -1;
    v.escapeX = v.escapeY = 0;
    v.doubled = 1;
    v.doubledMs = -1;
    v.race = this.race;
    v.fullMs = -1;
    v.finished = false;
    this.lastEscapeNoteMs = -Infinity;
    this.lastBounceNoteMs = -Infinity;
    if (this.race) this.launchAimed(ctx);
  }
  // --- multiply-race ---
  /** The race's start ball: in the centre, aimed at a seeded spot inside the gap as the gap will be when it arrives (any others spread from it). */
  private launchAimed(ctx: ModeContext) {
    const wall = ctx.getCircularWalls()[0];
    const gap = wall?.gaps[0];
    if (!wall || !gap || ctx.getBalls().length > 0) return;
    const r = ctx.config.ballRadius || 8;
    const speed = ctx.config.ballSpeed || 400;
    const width = gap.endAngle - gap.startAngle;
    const slack = Math.max(0, width - (2 * (r + 2)) / wall.radius);
    const target = (ctx.random() - 0.5) * 0.6 * slack;
    const spin = (ctx.config.rotationSpeed ?? 1) * 0.8; // (the engine turns ring 0 this way: PhysicsEngine.wallRotationRate)
    const a = aimAtGap(speed, ctx.config.gravity ?? 0, wall.radius - r, (gap.startAngle + gap.endAngle) / 2 + (ctx.getWallRotations()[0] ?? 0), spin, target);
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    // the start balls as the engine places them (slot 0 aimed, the others spread from it: startBallAngle), each in its slot
    const count = startBallCount(ctx.config, this.name);
    for (let slot = 0; slot < count; slot++) {
      const dir = startBallAngle(a, slot, count);
      ctx.addBall({ x: cx, y: cy, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, radius: r, color: slot === 0 ? ctx.config.ballColor || "#FFFFFF" : startBallColor(slot, ctx.config), team: slot });
      ctx.getLastWallLayer().set(ctx.getNextId() - 1, -1);
    }
  }
  // --- end multiply-race ---
  onPreUpdate() {}
  onBallStep() {}
  onPostSubStep() {}
  /** --- multiply-race --- A race plays a soft pluck by the ball's generation (one per RACE_BOUNCE_GAP_MS) instead of a blip a bounce. */
  onWallHit(ctx: ModeContext, ball: Ball): WallHitResult | void {
    if (!this.race) return;
    const now = ctx.getElapsedMs();
    if (now - this.lastBounceNoteMs >= RACE_BOUNCE_GAP_MS - 1e-6 && this.view.fullMs < 0) {
      this.lastBounceNoteMs = now;
      const root = racePluckHz(this.view.genOf.get(ball.id) ?? 0);
      const chord = raceChord(root, this.view.count);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: root, ...(chord.length > 1 ? { chord } : {}), level: 0.5, melody: false });
    }
    return { suppressSound: true };
  }
  onGapPass() {
    return true;
  }
  onPostUpdate(ctx: ModeContext) {
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const wall = walls[0];
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const balls = ctx.getBalls();
    let spawned = false;
    // --- unlimited --- with No limits on the swarm has no MULTIPLY_MAX_BALLS: past the full-physics balls the new balls join the crowd
    const unlimited = (ctx.unlimitedRoom?.() ?? null) !== null;
    const swarmLimit = swarmLimitOf(ctx.config); // --- unlimited-sizes --- (MULTIPLY_MAX_BALLS unless the setting says otherwise)
    // --- review fix (unlimited-sizes) --- engaged, the setting is still the swarm's ceiling, full and crowd balls together (none at its default)
    const ceiling = unlimited ? engagedSwarmCeiling(ctx.config) : null;
    const v = this.view; // --- multiply-race ---
    const now = ctx.getElapsedMs();
    for (const ball of balls) {
      if (this.escapedBalls.has(ball.id)) continue;
      if (Math.hypot(ball.x - cx, ball.y - cy) > wall.radius + ball.radius + 10) {
        this.escapedBalls.add(ball.id);
        ball.lifetime = 2000 + 1000 * ctx.random();
        ctx.spawnConfetti(cx, cy);
        // --- multiply-race --- the escape in the view (a flash where it left), and a race's arpeggio of the count instead of the crash
        v.escapes++;
        v.escapeMs = now;
        v.escapeX = ball.x;
        v.escapeY = ball.y;
        const gen = (v.genOf.get(ball.id) ?? 0) + 1;
        const note = this.race && v.fullMs < 0 && now - this.lastEscapeNoteMs >= RACE_ESCAPE_GAP_MS - 1e-6;
        if (!this.race) ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
        ctx.reportWallBreak(ball, 0);
        const before = balls.length;
        for (let i = 0; i < this.spawnCount; i++) {
          if (!unlimited && balls.length >= swarmLimit) break; // the swarm's soft ceiling (see MULTIPLY_MAX_BALLS) (--- unlimited --- lifted with No limits on) (--- unlimited-sizes --- the setting's)
          const left = ceiling === null ? Infinity : ceiling - balls.length - (ctx.crowdBalls?.() ?? 0); // --- review fix (unlimited-sizes) ---
          if (!(left >= 1)) break;
          const a = ctx.random() * Math.PI * 2;
          // --- gerald-multipliers --- the new balls inherit the escaped ball's multipliers (speed, size, damage…)
          const speed = cruiseSpeed(ball, ctx.config.ballSpeed || 400);
          const size = ball.mult ? ball.mult.size : 1;
          // --- unlimited --- no room left for full-physics balls: the rest of this escape's balls fan out as crowd balls
          if (unlimited && (ctx.unlimitedRoom?.() ?? 1) <= 0) {
            ctx.spawnCrowd?.(Math.min(this.spawnCount - i, left), cx, cy, speed, (ctx.config.ballRadius || 8) * size, a, ball.team ?? 0);
            break;
          }
          ctx.addBall({
            x: cx,
            y: cy,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: (ctx.config.ballRadius || 8) * size,
            // --- teams --- the new balls play for the team of the ball that escaped (the other slots keep their colour)
            color: ball.team ? ball.color : ctx.config.ballColor || "#FFFFFF",
            ...(ball.team !== undefined ? { team: ball.team } : {}),
            ...(ball.mult ? { mult: copyMultipliers(ball.mult), radiusScale: size, gravityScale: ball.mult.gravity } : {}),
          });
        }
        // --- multiply-race --- the new balls' generation (the canvas colours them by it)
        for (let k = before; k < balls.length; k++) v.genOf.set(balls[k].id, gen);
        if (balls.length > before && gen > v.topGen) v.topGen = gen;
        if (note) {
          this.lastEscapeNoteMs = now;
          ctx.addPendingSoundEvent({ type: "multiplier", wallIndex: 0, multiplier: Math.max(2, balls.length + (ctx.crowdBalls?.() ?? 0)), melody: false });
        }
        spawned = true;
      }
    }
    const live = this.liveIds;
    live.clear();
    for (const b of balls) live.add(b.id);
    for (const id of this.escapedBalls) if (!live.has(id)) this.escapedBalls.delete(id);
    if (spawned) ctx.getBrokenWalls().clear();
    // --- multiply-race --- the count, its doublings and the race's end (draw and sound: nothing here moves a ball)
    for (const id of v.genOf.keys()) if (!live.has(id)) v.genOf.delete(id);
    v.timeMs = now;
    // the swarm's size so far: its peak (a ball that flew out leaves the field 2–3 s later; the count a viewer reads never drops)
    v.count = Math.max(v.count, balls.length + (ctx.crowdBalls?.() ?? 0));
    v.limit = unlimited ? (ceiling ?? Infinity) : swarmLimit;
    while (v.count >= 2 * v.doubled) {
      v.doubled *= 2;
      v.doubledMs = now;
    }
    if (!this.race) return;
    if (v.fullMs < 0 && v.count >= v.limit) {
      v.fullMs = now;
      ctx.spawnConfetti(cx, cy);
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: RACE_CHORD_HZ, level: 1, accent: true, loopTremolo: true });
      ctx.noteImpact?.();
    }
    if (v.fullMs >= 0 && !v.finished && now >= v.fullMs + RACE_HOLD_MS - 1e-6) v.finished = true;
  }
  onConfigChange(ctx: ModeContext, sizeChanged: boolean, _wallCountChanged: boolean, gapChanged: boolean) {
    if (sizeChanged || gapChanged) {
      const radius = arenaRadius(ctx.config);
      const gap = passableGap(ctx.config.gapSize || 0.3, radius, ringPassRadius(ctx.config, this.name)); // (wide enough for the ball)
      const start = 0.25 * Math.PI;
      ctx.setCircularWalls([{ radius, gaps: [{ startAngle: start, endAngle: start + gap }] }]);
      ctx.setWallRotations([0]);
    }
    return true;
  }
  shouldSkipWallCollision(ball: Ball) {
    return this.escapedBalls.has(ball.id);
  }
  /** The half of an escaped ball is escaped too: it flies out with its parent instead of counting as a new escape. */
  onBallSplit(_ctx: ModeContext, parent: Ball, half: Ball) {
    if (this.escapedBalls.has(parent.id)) this.escapedBalls.add(half.id);
  }
  isFinished() {
    return this.view.finished; // --- multiply-race --- (a race ends at the swarm's limit; otherwise never)
  }
  getState() {
    return {};
  }
  getSpawnCount() {
    return this.spawnCount;
  }
  setSpawnCount(n: number) {
    this.spawnCount = n;
  }
}
