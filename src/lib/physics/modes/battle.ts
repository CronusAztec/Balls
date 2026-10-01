import type { Ball, GameMode, ModeContext } from "../types";
import {
  ARENA_REFERENCE_SIDE,
  ArenaSoundBudget,
  DEFAULT_BATTLE_SETTINGS,
  KO_CHORD,
  MAX_NUDGE,
  WIN_CHORD,
  arenaColor,
  arenaSpeed,
  arenaWallNote,
  boxWallPass,
  buildArenaField,
  circleWallPass,
  clashNote,
  createArenaView,
  maxSquareHalf,
  offAxisAngle,
  resetArenaView,
  resolveBattleSettings,
  resolveSquarePair,
  steerToward,
  zoneArea,
  type ArenaField,
  type ArenaPowerUp,
  type ArenaView,
  type BattleSettings,
  type PairContact,
  type PowerUpKind,
  type WallContact,
} from "./arenaGames";

/**
 * Bouncing Square BATTLE Royale ("battle" mode, rhythm family – feature jdm-arena-games; the project.jdm format). No
 * rings: 2–20 axis-aligned squares with hit points bounce around a box or a circle (the playfield of arenaGames.ts)
 * and into each other. When two squares collide, the faster one deals damage proportional to their approach speed
 * (`collisionDamage()`), the square that takes it flashes and shrinks a little (`applyHit()`), and a square at 0 HP
 * explodes – it is knocked out with a "KO" callout. The last square standing wins.
 *
 * The squares are ordinary engine balls (radius = half the side), so the engine integrates them – no gravity (a
 * top-down arena), but drag, wind and spin apply – and pause, playback speed and the recorder work unchanged. The mode
 * opts out of the engine's ball pairs (`ballsPassThrough`) and its slow-ball boost (`ballsMayRest`) and does both
 * itself: the square pairs are resolved in `onPostSubStep()` (axis of least penetration, elastic), the walls in
 * `onBallStep()`, and every square's speed relaxes toward its cruising speed each step (its own tempo within ±15 % of
 * the Ball Speed, drawn from the seed; ×1.5 with a speed power-up), so clashes stay lively without the energy growing.
 *
 * Drama: the director nudges a wall rebound up to `nudge × MAX_NUDGE` toward the nearest opponent (a hurt square toward
 * a heal or shield) – at full strength after six seconds without a clash –, the optional safe zone shrinks from 8 s on
 * and pushes the squares together (never tighter than the survivors need), and power-ups (heal, shield, speed) spawn at
 * seeded times and places. Every random number comes from `ctx.random()`, so a seed replays exactly and Find
 * Simulation can search the run length (the battle always ends once one square is left).
 *
 * Sound, all through the ToneGenerator: wall hits (soft notes per wall) and clashes (the attacker's own degree of C
 * major pentatonic, louder for harder hits) share a per-frame budget of the strongest `ARENA_SOUNDS_PER_FRAME`; a KO is
 * a "gap" event (the wall-break sound, the characters' shock, the camera shake) plus a low accent chord; a power-up
 * plays the multiplier arpeggio; the winner an accented C major chord.
 */

/* ------------------------------------------------------------------ constants */

/** Fraction of the field the squares cover at the default Ball Size (8 px). */
export const BATTLE_FILL = 0.09;
/** A hit shrinks a square by this fraction per point of damage (at most two points' worth per hit)… */
export const SHRINK_PER_DAMAGE = 0.03;
/** …but never below this fraction of its start size. */
export const MIN_SCALE = 0.6;
/** Approach speeds under this fraction of the Ball Speed deal no damage (squares pressed together by the zone). */
export const MIN_DAMAGE_REL = 0.15;
/** Damage stops growing at this many times the Ball Speed. */
export const MAX_DAMAGE_REL = 3;
/** Fraction of the gap to its cruising speed a square makes up per 60 Hz step. */
export const SPEED_RELAX = 0.05;
/** Safety net: no square flies faster than this many times its cruising speed. */
export const SPEED_CAP = 3;
/** Every square's tempo: its cruising speed is the Ball Speed × 1 ± TEMPO_SPREAD / 2. */
export const TEMPO_SPREAD = 0.3;
/** The safe zone starts closing after this many seconds and closes over `SHRINK_SEC` to `ZONE_MIN`. */
export const SHRINK_START_SEC = 8;
export const SHRINK_SEC = 30;
export const ZONE_MIN = 0.45;
/** The zone never shrinks so far that the squares cover more than this fraction of it. */
export const ZONE_FIT = 0.35;
/** Power-ups: the first after 3–5 s, then one every 4–7 s, at most two on the field, each for 10 s. */
export const POWER_UP_FIRST_SEC = 3;
export const POWER_UP_EVERY_SEC = 4;
export const POWER_UP_JITTER_SEC = 3;
export const POWER_UP_LIFE_SEC = 10;
export const MAX_POWER_UPS = 2;
/** Heal gives back this fraction of the start HP; a shield blocks the next hit within `SHIELD_SEC`; speed is ×SPEED_BOOST for `SPEED_SEC`. */
export const HEAL_FRACTION = 0.35;
export const SHIELD_SEC = 8;
export const SPEED_SEC = 5;
export const SPEED_BOOST = 1.5;
/** A hurt square (at most this fraction of its HP) is nudged toward a heal or a shield instead of an opponent. */
export const HURT_FRACTION = 0.35;
/** Without a clash for this long the director nudges at full strength until the next one. */
export const STALEMATE_SEC = 6;

/* ------------------------------------------------------------------ the rules (pure) */

/** Damage a clash deals: `damage × approach / Ball Speed`, nothing for a soft touch, capped at MAX_DAMAGE_REL. */
export function collisionDamage(approachSpeed: number, ballSpeed: number, damage: number): number {
  const rel = approachSpeed / Math.max(1, ballSpeed);
  if (!(rel >= MIN_DAMAGE_REL) || !(damage > 0)) return 0;
  return damage * Math.min(MAX_DAMAGE_REL, rel);
}

/** A square's fighting state. */
export interface Fighter {
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Size relative to the start size (hits shrink it). */
  scale: number;
  kills: number;
  /** Simulation times (ms) a shield / speed boost lasts until (−Infinity = none). */
  shieldUntilMs: number;
  speedUntilMs: number;
}

export function createFighter(maxHp: number): Fighter {
  return { hp: maxHp, maxHp, alive: true, scale: 1, kills: 0, shieldUntilMs: -Infinity, speedUntilMs: -Infinity };
}

export type HitResult = "none" | "shielded" | "hit" | "ko";

/**
 * `attacker` deals `damage` to `defender` at `nowMs`: a live shield blocks it (and is used up), else the HP drop and the
 * square shrinks by SHRINK_PER_DAMAGE per point (two points at most, never below MIN_SCALE); at 0 HP it is knocked out
 * and the attacker (when there is one) scores the kill.
 */
export function applyHit(attacker: Fighter | null, defender: Fighter, damage: number, nowMs: number): HitResult {
  if (!defender.alive || !(damage > 0)) return "none";
  if (defender.shieldUntilMs > nowMs) {
    defender.shieldUntilMs = -Infinity;
    return "shielded";
  }
  defender.hp -= damage;
  defender.scale = Math.max(MIN_SCALE, defender.scale * (1 - SHRINK_PER_DAMAGE * Math.min(2, damage)));
  if (defender.hp > 1e-9) return "hit";
  defender.hp = 0;
  defender.alive = false;
  if (attacker) attacker.kills++;
  return "ko";
}

/** A power-up taken at `nowMs`: heal (HP back, a little size back), shield or speed. */
export function applyPowerUp(fighter: Fighter, kind: PowerUpKind, nowMs: number) {
  if (!fighter.alive) return;
  if (kind === "heal") {
    fighter.hp = Math.min(fighter.maxHp, fighter.hp + HEAL_FRACTION * fighter.maxHp);
    fighter.scale = Math.min(1, fighter.scale + 0.1);
  } else if (kind === "shield") fighter.shieldUntilMs = nowMs + 1000 * SHIELD_SEC;
  else fighter.speedUntilMs = nowMs + 1000 * SPEED_SEC;
}

/** The battle's result: the last square standing (−1 while more are alive, or for a draw when none is), and whether it is over. */
export function battleOutcome(fighters: readonly Fighter[]): { over: boolean; winner: number } {
  let alive = 0;
  let last = -1;
  for (let i = 0; i < fighters.length; i++) {
    if (fighters[i].alive) {
      alive++;
      last = i;
    }
  }
  return { over: fighters.length > 0 && alive <= 1, winner: alive === 1 ? last : -1 };
}

/**
 * Zone scale at `tSec`: 1 until SHRINK_START_SEC, then down to ZONE_MIN over SHRINK_SEC – never below `fit` (what the
 * survivors need) – and never growing again (`previous`).
 */
export function zoneScaleAt(tSec: number, fit: number, previous = 1): number {
  const u = Math.max(0, Math.min(1, (tSec - SHRINK_START_SEC) / SHRINK_SEC));
  const schedule = 1 - (1 - ZONE_MIN) * u;
  return Math.min(previous, Math.max(schedule, Math.min(1, fit)));
}

/**
 * The field's length unit: its side over ARENA_REFERENCE_SIDE. Every fixed margin of the battle is given in pixels of the
 * reference square and scaled by it, so a seed plays the same battle on any canvas (the speeds scale the same way).
 */
export function battleUnit(field: ArenaField): number {
  return field.side / ARENA_REFERENCE_SIDE;
}

/**
 * Half-size of the squares at the start: `count` squares cover BATTLE_FILL of the field at Ball Size 8, scaled by the Ball
 * Size (from 0.5×; --- review fix (uncap-all) --- no maximum) as far as the field holds them: past `battleSquaresFit()` they
 * stop at the most that still moves (the arena is full: ARENA FULL).
 */
export function battleSquareHalf(field: ArenaField, count: number, ballRadius: number): number {
  return Math.max(4 * battleUnit(field), Math.min(battleSquareWish(field, count, ballRadius), maxSquareHalf(field) * 0.9));
}

/** --- review fix (uncap-all) --- The half-size the Ball Size asks of `count` squares, before the field's room. */
function battleSquareWish(field: ArenaField, count: number, ballRadius: number): number {
  const n = Math.max(1, count);
  const scale = Math.max(0.5, (ballRadius || 8) / 8);
  return 0.5 * Math.sqrt((BATTLE_FILL * zoneArea(field)) / n) * scale;
}

/** --- review fix (uncap-all) --- Whether the squares the Ball Size asks for fit the field (else they are cut to fit and the run says ARENA FULL). */
export function battleSquaresFit(field: ArenaField, count: number, ballRadius: number): boolean {
  return battleSquareWish(field, count, ballRadius) <= maxSquareHalf(field) * 0.9;
}

/* ------------------------------------------------------------------ the mode */

export class BattleMode implements GameMode {
  readonly name = "battle";
  /** The mode keeps the squares at their cruising speeds itself (no engine boost). */
  readonly ballsMayRest = true;
  /** The mode resolves the square pairs itself (axis-aligned squares, not discs). */
  readonly ballsPassThrough = true;
  private settings: BattleSettings = { ...DEFAULT_BATTLE_SETTINGS };
  private readonly view: ArenaView = createArenaView("battle");
  private fighters: Fighter[] = [];
  /** Tempo of each square (its cruising speed over the Ball Speed). */
  private tempo = new Float64Array(0);
  private run: BattleSettings = { ...DEFAULT_BATTLE_SETTINGS };
  private ballSpeed = 400;
  private lastBallRadius = 8;
  private nextPowerUpMs = Infinity;
  private lastClashMs = 0;
  private koThisStep = false;
  private readonly budget = new ArenaSoundBudget();
  private readonly contact: PairContact = { nx: 0, ny: 0, approach: 0, speedA: 0, speedB: 0 };
  private readonly wall: WallContact = { wall: -1, approach: 0, nx: 0, ny: 0 };
  private readonly steer = { vx: 0, vy: 0 };
  private byIndex: (Ball | null)[] = [];

  getSettings(): BattleSettings {
    return this.settings;
  }
  /** Applied on the next init (the Simulator re-inits the mode when a battle setting changes). */
  setSettings(patch: Partial<BattleSettings>) {
    this.settings = resolveBattleSettings({ ...this.settings, ...patch });
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): ArenaView {
    return this.view;
  }
  /** The fighters (for tests and diagnostics). */
  getFighters(): readonly Fighter[] {
    return this.fighters;
  }
  getProgress() {
    const v = this.view;
    let alive = 0;
    for (let i = 0; i < v.count; i++) alive += v.alive[i];
    return { total: v.count, alive, kos: v.kos.length, hits: v.hits, pickups: v.pickups, zone: v.zone, finished: v.finished, winner: v.winner };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    this.run = { ...s };
    const field = buildArenaField(ctx.config.width, ctx.config.height, s.arena);
    const n = s.count;
    const firstId = ctx.getNextId();
    resetArenaView(this.view, n, firstId, field, s.hp);
    this.ballSpeed = arenaSpeed(field, ctx.config.ballSpeed);
    this.lastBallRadius = ctx.config.ballRadius || 8;
    this.budget.clear();
    this.koThisStep = false;
    this.lastClashMs = 0;
    this.fighters = [];
    this.tempo = new Float64Array(n);
    this.byIndex = new Array(n).fill(null);
    const half = battleSquareHalf(field, n, this.lastBallRadius);
    if (!battleSquaresFit(field, n, this.lastBallRadius)) ctx.noteArenaFull?.(); // --- review fix (uncap-all) --- (cut to fit the field)
    // Spots that overlap nothing placed so far (up to 60 tries each), launched away from the axes. The margins are in
    // reference pixels (× the field's unit), so the same seed finds the same spots – relative to the field – on any canvas.
    const u = battleUnit(field);
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let x = field.cx;
      let y = field.cy;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (field.kind === "circle") {
          const room = Math.max(0, field.radius - half * Math.SQRT2 - 4 * u);
          const rho = room * Math.sqrt(ctx.random());
          const a = 2 * Math.PI * ctx.random();
          x = field.cx + rho * Math.cos(a);
          y = field.cy + rho * Math.sin(a);
        } else {
          x = field.cx + (2 * ctx.random() - 1) * Math.max(0, field.halfW - half - 4 * u);
          y = field.cy + (2 * ctx.random() - 1) * Math.max(0, field.halfH - half - 4 * u);
        }
        let free = true;
        for (let j = 0; j < k && free; j++) if (Math.abs(xs[j] - x) < 2 * half + 6 * u && Math.abs(ys[j] - y) < 2 * half + 6 * u) free = false;
        if (free) break;
      }
      xs[k] = x;
      ys[k] = y;
    }
    for (let k = 0; k < n; k++) {
      this.view.team[k] = k;
      this.fighters.push(createFighter(s.hp));
      this.tempo[k] = 1 + TEMPO_SPREAD * (ctx.random() - 0.5);
      const a = offAxisAngle(ctx.random(), ctx.random());
      const speed = this.ballSpeed * this.tempo[k];
      ctx.addBall({ x: xs[k], y: ys[k], vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, radius: half, color: arenaColor(k), gravityScale: 0, radiusScale: half / this.lastBallRadius });
    }
    this.nextPowerUpMs = s.powerUps ? 1000 * (POWER_UP_FIRST_SEC + 2 * ctx.random()) : Infinity;
    this.syncView();
  }

  /** The engine ball of every square (null once knocked out), rebuilt from the ball list. */
  private indexBalls(ctx: ModeContext) {
    const byIndex = this.byIndex;
    byIndex.fill(null);
    const first = this.view.firstId;
    for (const ball of ctx.getBalls()) {
      const k = ball.id - first;
      if (k >= 0 && k < byIndex.length) byIndex[k] = ball;
    }
  }

  onPreUpdate(ctx: ModeContext) {
    const v = this.view;
    const now = ctx.getElapsedMs();
    v.timeMs = now;
    this.koThisStep = false;
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.lastBallRadius) this.lastBallRadius = radius;
    this.indexBalls(ctx);
    const field = v.field;
    if (!field) return;
    const speed = arenaSpeed(field, ctx.config.ballSpeed);
    this.ballSpeed = speed;
    // Every square relaxes toward its cruising speed (its tempo, ×1.5 with a speed boost), keeping its direction.
    const cap = maxSquareHalf(field);
    for (let k = 0; k < v.count; k++) {
      const ball = this.byIndex[k];
      const f = this.fighters[k];
      if (!ball || !f.alive) continue;
      const cruise = speed * this.tempo[k] * (f.speedUntilMs > now ? SPEED_BOOST : 1);
      const s = Math.hypot(ball.vx, ball.vy);
      if (s < 1e-6) {
        const a = offAxisAngle(ctx.random(), ctx.random());
        ball.vx = Math.cos(a) * cruise;
        ball.vy = Math.sin(a) * cruise;
      } else {
        const next = Math.min(SPEED_CAP * cruise, s + (cruise - s) * SPEED_RELAX);
        ball.vx *= next / s;
        ball.vy *= next / s;
      }
      // A live Ball Size change (the engine scales every square) never lets a square outgrow the zone (the arena is full).
      if (ball.radius > cap) {
        ball.radius = cap;
        ball.radiusScale = cap / radius;
        ctx.noteArenaFull?.(); // --- review fix (uncap-all) ---
      }
    }
    if (v.finished) return;
    const t = now / 1000;
    if (this.run.shrink) {
      let area = 0;
      let biggest = 0;
      for (let k = 0; k < v.count; k++) {
        const ball = this.byIndex[k];
        if (!ball || !this.fighters[k].alive) continue;
        area += 4 * ball.radius * ball.radius;
        if (ball.radius > biggest) biggest = ball.radius;
      }
      // The survivors cover at most ZONE_FIT of the zone, and the biggest keeps 2.5 times its reach of room.
      const fitArea = Math.sqrt(area / (ZONE_FIT * zoneArea(field)));
      const reach = biggest * (field.kind === "circle" ? Math.SQRT2 : 1) + 8 * battleUnit(field);
      const fitSize = (2.5 * reach) / (field.kind === "circle" ? field.radius : Math.min(field.halfW, field.halfH));
      const next = zoneScaleAt(t, Math.max(fitArea, fitSize), v.zone);
      v.zoneShrinking = next < v.zone - 1e-9;
      v.zone = next;
    }
    this.stepPowerUps(ctx, now);
  }

  /** Spawns (at seeded times and places), expires and keeps the power-ups inside the zone. */
  private stepPowerUps(ctx: ModeContext, now: number) {
    const v = this.view;
    const field = v.field;
    if (!field) return;
    for (let i = v.powerUps.length - 1; i >= 0; i--) {
      const p = v.powerUps[i];
      if (now >= p.expireMs || !this.insideZone(p.x, p.y, p.r)) v.powerUps.splice(i, 1);
    }
    if (now < this.nextPowerUpMs) return;
    this.nextPowerUpMs = now + 1000 * (POWER_UP_EVERY_SEC + POWER_UP_JITTER_SEC * ctx.random());
    const kind = (["heal", "shield", "speed"] as const)[Math.min(2, Math.floor(3 * ctx.random()))];
    const u = ctx.random();
    const w = ctx.random();
    if (v.powerUps.length >= MAX_POWER_UPS) return;
    const r = 0.55 * battleSquareHalf(field, v.count, this.lastBallRadius);
    const margin = 6 * battleUnit(field);
    let x: number;
    let y: number;
    if (field.kind === "circle") {
      const room = Math.max(0, field.radius * v.zone - r - margin);
      const rho = room * Math.sqrt(u);
      x = field.cx + rho * Math.cos(2 * Math.PI * w);
      y = field.cy + rho * Math.sin(2 * Math.PI * w);
    } else {
      x = field.cx + (2 * u - 1) * Math.max(0, field.halfW * v.zone - r - margin);
      y = field.cy + (2 * w - 1) * Math.max(0, field.halfH * v.zone - r - margin);
    }
    const p: ArenaPowerUp = { kind, x, y, r, spawnMs: now, expireMs: now + 1000 * POWER_UP_LIFE_SEC };
    v.powerUps.push(p);
  }

  private insideZone(x: number, y: number, r: number): boolean {
    const f = this.view.field;
    if (!f) return false;
    const z = this.view.zone;
    if (f.kind === "circle") return Math.hypot(x - f.cx, y - f.cy) <= f.radius * z - r;
    return Math.abs(x - f.cx) <= f.halfW * z - r && Math.abs(y - f.cy) <= f.halfH * z - r;
  }

  /** The engine moved the square: keep it inside the zone; a real hit is a note, a glow and – maybe – the director's nudge. */
  onBallStep(ctx: ModeContext, ball: Ball) {
    const v = this.view;
    const k = ball.id - v.firstId;
    if (k < 0 || k >= v.count || !this.fighters[k]?.alive) return;
    if (!this.wallPass(ctx, ball)) return;
    const w = this.wall;
    if (w.approach < 0.2 * this.ballSpeed) return;
    ctx.noteBounce?.(ball); // --- bounce-math --- a real wall hit is a bounce
    v.wallHits++;
    v.wallHitMs[w.wall] = v.timeMs;
    const field = v.field!;
    this.budget.offer(w.approach * w.approach, arenaWallNote(field.kind, w.wall), 0.3 * Math.min(1, w.approach / this.ballSpeed));
    if (!v.finished) this.nudge(ball, k, w.nx, w.ny);
  }

  /** Resolves one square against the zone's walls (restitution × the wall-bounciness extra). */
  private wallPass(ctx: ModeContext, ball: Ball): boolean {
    const f = this.view.field;
    if (!f) return false;
    const z = this.view.zone;
    const e = ctx.getPhysicsExtras().wallBounciness;
    return f.kind === "circle" ? circleWallPass(ball, f.cx, f.cy, f.radius * z, e, this.wall) : boxWallPass(ball, f.cx, f.cy, f.halfW * z, f.halfH * z, e, this.wall);
  }

  /** The director turns the rebound toward the nearest opponent (a hurt square toward a heal or a shield). */
  private nudge(ball: Ball, k: number, nx: number, ny: number) {
    const v = this.view;
    const stalemate = v.timeMs - this.lastClashMs >= 1000 * STALEMATE_SEC;
    const strength = stalemate ? 1 : this.run.nudge;
    if (!(strength > 0)) return;
    let tx = 0;
    let ty = 0;
    let best = Infinity;
    const f = this.fighters[k];
    if (f.hp <= HURT_FRACTION * f.maxHp) {
      for (const p of v.powerUps) {
        if (p.kind === "speed") continue;
        const d = (p.x - ball.x) ** 2 + (p.y - ball.y) ** 2;
        if (d < best) {
          best = d;
          tx = p.x - ball.x;
          ty = p.y - ball.y;
        }
      }
    }
    if (best === Infinity) {
      for (let j = 0; j < v.count; j++) {
        const other = this.byIndex[j];
        if (j === k || !other || !this.fighters[j].alive) continue;
        const d = (other.x - ball.x) ** 2 + (other.y - ball.y) ** 2;
        if (d < best) {
          best = d;
          tx = other.x - ball.x;
          ty = other.y - ball.y;
        }
      }
    }
    if (best === Infinity) return;
    steerToward(ball.vx, ball.vy, tx, ty, strength * MAX_NUDGE, nx, ny, this.steer);
    ball.vx = this.steer.vx;
    ball.vy = this.steer.vy;
  }

  /** Every sub-step: the square pairs (clashes, damage, KOs), then the walls again (silently) and the power-ups. */
  onPostSubStep(ctx: ModeContext) {
    const v = this.view;
    const n = v.count;
    const byIndex = this.byIndex;
    const e = ctx.getPhysicsExtras().wallBounciness;
    let touched = false;
    for (let i = 0; i < n; i++) {
      const a = byIndex[i];
      if (!a || !this.fighters[i].alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = byIndex[j];
        if (!b || !this.fighters[j].alive || !this.fighters[i].alive) continue;
        if (!resolveSquarePair(a, b, Math.min(1, e), this.contact)) continue;
        touched = true;
        if (this.contact.approach > 0) this.clash(ctx, i, j, a, b);
      }
    }
    if (touched) for (let i = 0; i < n; i++) if (byIndex[i] && this.fighters[i].alive) this.wallPass(ctx, byIndex[i]!);
    if (!v.finished && v.powerUps.length > 0) this.takePowerUps(ctx);
  }

  /** Squares i and j collided: the faster one deals the damage (both half of it when they are equally fast). */
  private clash(ctx: ModeContext, i: number, j: number, a: Ball, b: Ball) {
    const v = this.view;
    const c = this.contact;
    const now = v.timeMs;
    const rel = c.approach / Math.max(1, this.ballSpeed);
    if (rel < MIN_DAMAGE_REL) return;
    ctx.noteCollide?.(a, b); // --- bounce-math --- a clash is a ball hit
    v.hits++;
    this.lastClashMs = now;
    const attackerIndex = c.speedA > c.speedB + 1e-6 ? i : c.speedB > c.speedA + 1e-6 ? j : -1;
    const loud = 0.55 + 0.45 * Math.min(1, rel / 2);
    this.budget.offer(10 * c.approach * c.approach, clashNote(v.team[attackerIndex >= 0 ? attackerIndex : i]), loud, rel >= 1.6);
    if (v.finished) return;
    const damage = collisionDamage(c.approach, this.ballSpeed, this.run.damage);
    if (attackerIndex >= 0) {
      const defender = attackerIndex === i ? j : i;
      this.dealDamage(ctx, attackerIndex, defender, attackerIndex === i ? b : a, damage);
    } else {
      this.dealDamage(ctx, j, i, a, damage / 2);
      this.dealDamage(ctx, i, j, b, damage / 2);
    }
  }

  private dealDamage(ctx: ModeContext, attacker: number, defender: number, ball: Ball, damage: number) {
    const v = this.view;
    const f = this.fighters[defender];
    if (!f.alive) return;
    const oldScale = f.scale;
    const result = applyHit(this.fighters[attacker], f, damage, v.timeMs);
    if (result === "none") return;
    v.clashMs[attacker] = v.timeMs;
    if (result === "shielded") {
      v.hitMs[defender] = v.timeMs;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: 1046.5, accent: true });
      return;
    }
    v.hitMs[defender] = v.timeMs;
    if (f.scale !== oldScale) {
      ball.radius *= f.scale / oldScale;
      ball.radiusScale = ball.radius / this.lastBallRadius;
    }
    if (result === "ko") {
      v.kos.push({ index: defender, x: ball.x, y: ball.y, half: ball.radius, timeMs: v.timeMs });
      this.koThisStep = true;
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: KO_CHORD[0], accent: true, chord: [...KO_CHORD] });
    }
    this.syncFighter(defender);
    this.syncFighter(attacker);
  }

  /** A square that overlaps a power-up takes it (the multiplier arpeggio plays); a heal gives some size back. */
  private takePowerUps(ctx: ModeContext) {
    const v = this.view;
    for (let p = v.powerUps.length - 1; p >= 0; p--) {
      const pu = v.powerUps[p];
      for (let k = 0; k < v.count; k++) {
        const ball = this.byIndex[k];
        const f = this.fighters[k];
        if (!ball || !f.alive) continue;
        const dx = Math.max(0, Math.abs(pu.x - ball.x) - ball.radius);
        const dy = Math.max(0, Math.abs(pu.y - ball.y) - ball.radius);
        if (dx * dx + dy * dy > pu.r * pu.r) continue;
        const oldScale = f.scale;
        applyPowerUp(f, pu.kind, v.timeMs);
        if (f.scale !== oldScale) {
          ball.radius *= f.scale / oldScale;
          ball.radiusScale = ball.radius / this.lastBallRadius;
        }
        this.syncFighter(k);
        v.pickups++;
        v.powerUps.splice(p, 1);
        ctx.addPendingSoundEvent({ type: "multiplier", wallIndex: 0, multiplier: pu.kind === "speed" ? 2 : pu.kind === "shield" ? 1.5 : 1.25 });
        break;
      }
    }
  }

  private syncFighter(k: number) {
    const f = this.fighters[k];
    const v = this.view;
    v.hp[k] = f.hp;
    v.alive[k] = f.alive ? 1 : 0;
    v.kills[k] = f.kills;
    v.shieldUntilMs[k] = f.shieldUntilMs;
    v.speedUntilMs[k] = f.speedUntilMs;
  }

  private syncView() {
    for (let k = 0; k < this.fighters.length; k++) this.syncFighter(k);
  }

  /** End of a 60 Hz step: knocked-out squares leave the ball list; the last one standing wins. */
  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    if (this.koThisStep) {
      const first = v.firstId;
      ctx.setBalls(ctx.getBalls().filter((b) => {
        const k = b.id - first;
        return k < 0 || k >= v.count || this.fighters[k].alive;
      }));
      this.indexBalls(ctx);
    }
    if (v.finished) return;
    const outcome = battleOutcome(this.fighters);
    if (!outcome.over) return;
    v.finished = true;
    v.finishMs = v.timeMs;
    v.winner = outcome.winner;
    v.powerUps.length = 0;
    v.zoneShrinking = false;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: WIN_CHORD[0], accent: true, chord: [...WIN_CHORD] });
    const ball = outcome.winner >= 0 ? this.byIndex[outcome.winner] : null;
    const f = v.field;
    ctx.spawnConfetti(ball ? ball.x : (f?.cx ?? 0), ball ? ball.y : (f?.cy ?? 0));
  }

  /** Called once per rendered frame: the frame's strongest wall and clash notes. */
  flushPendingSounds(ctx: ModeContext) {
    this.view.notes += this.budget.flush((frequency, level, accent) => ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency, level, ...(accent ? { accent: true } : {}) }));
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }

  /**
   * A canvas resize lays the field out again and maps the squares and power-ups onto it (undoing the engine's per-axis stretch).
   * The squares' speeds scale with the field too (by its side, never per axis), so a found battle plays on unchanged.
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    const v = this.view;
    const old = v.field;
    if (!sizeChanged || !old) return true;
    const field = buildArenaField(ctx.config.width, ctx.config.height, old.kind);
    const k = field.side / old.side;
    const sx = ctx.config.width / old.canvasWidth;
    const sy = ctx.config.height / old.canvasHeight;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const ocx = old.canvasWidth / 2;
    const ocy = old.canvasHeight / 2;
    for (const ball of ctx.getBalls()) {
      ball.x = cx + ((ball.x - cx) * k) / (sx || 1);
      ball.y = cy + ((ball.y - cy) * k) / (sy || 1);
      ball.radius *= k;
      ball.vx *= k; // --- review fix (modes-rhythm) --- (the speeds follow the field, like Race's rescale())
      ball.vy *= k;
      ball.radiusScale = ball.radius / (ctx.config.ballRadius || 8);
    }
    for (const p of v.powerUps) {
      p.x = cx + (p.x - ocx) * k;
      p.y = cy + (p.y - ocy) * k;
      p.r *= k;
    }
    for (const ko of v.kos) {
      ko.x = cx + (ko.x - ocx) * k;
      ko.y = cy + (ko.y - ocy) * k;
      ko.half *= k;
    }
    v.field = field;
    return true;
  }

  /** The zone is handled in onBallStep; there are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const p = this.getProgress();
    return { ...p, time: this.view.timeMs };
  }
}
