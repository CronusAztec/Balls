import type { Ball, GameMode, ModeContext } from "../types";
import {
  ArenaSoundBudget,
  DEFAULT_CTF_SETTINGS,
  FANFARE,
  FANFARE_STEP_SEC,
  MAX_NUDGE,
  WIN_CHORD,
  arenaColor,
  arenaSpeed,
  arenaWallNote,
  boxWallPass,
  buildArenaField,
  maxSquareHalf,
  clashNote,
  createArenaView,
  ctfTimeLimitSec,
  offAxisAngle,
  pentatonicNote,
  resetArenaView,
  resolveCtfSettings,
  resolveSquarePair,
  steerToward,
  type ArenaBase,
  type ArenaField,
  type ArenaFlag,
  type ArenaView,
  type CtfSettings,
  type PairContact,
  type WallContact,
} from "./arenaGames";

/**
 * Capture the Flag ("ctf" mode, rhythm family – feature jdm-arena-games; the project.jdm "capture the flag 2-2" format).
 * Two teams of `perTeam` bouncing squares (1–4 a side) play in a box with a base at each end – team 0 (left) and
 * team 1 (right) – each holding its team's flag. A square that touches the enemy flag carries it (the flag is drawn on
 * it, and a carrier cruises a little slower); it scores when it reaches its own base, and the flag goes home. A carrier
 * hit by an enemy square drops the flag where it is: an enemy touching a dropped flag carries it again, its own team
 * touching it returns it home, and a flag left lying for `FLAG_RETURN_SEC` returns on its own. The first team to
 * `scoreToWin` captures wins; otherwise the game ends `CTF_FINALE_SEC` before the clip end ("TIME!") with the best
 * score – or a draw.
 *
 * The flag rules are pure functions (`touchFlag()`, `dropFlag()`, `captureFlag()`, `flagTimedOut()`, `ctfOutcome()`) so the
 * state machine is tested on its own; the mode runs them in fixed sub-steps. The squares are engine balls moving
 * ballistically with elastic, axis-aligned collisions (arenaGames.ts) and the physics extras; the director nudges a
 * wall rebound up to `nudge × MAX_NUDGE` toward the square's objective – the enemy flag, home with it, or the enemy
 * carrier of its own flag. No AI beyond that: the drama comes from the bounces. Every random number comes from
 * `ctx.random()`, so a seed replays exactly and Find Simulation can search the length of a game won on the score.
 *
 * Sound through the ToneGenerator: soft wall notes and clashes (team 0 low, team 1 high) in the per-frame budget; a
 * pickup, a drop and a return play accented notes, a capture the goal fanfare (three rising chords), the end an
 * accented C major chord.
 */

/* ------------------------------------------------------------------ constants */

/** Half-size of a square as a fraction of the field's smaller half extent at Ball Size 8. */
export const CTF_SQUARE = 0.055;
/** A base is this fraction of the field's width wide and of its height tall. */
export const BASE_WIDTH = 0.18;
export const BASE_HEIGHT = 0.44;
/** A flag is touched within this fraction of a square's half-size beyond the square's edge. */
export const FLAG_REACH = 0.6;
/** A dropped flag goes home by itself after this many seconds. */
export const FLAG_RETURN_SEC = 8;
/** A square that dropped the flag cannot pick it up again for this long. */
export const PICKUP_COOLDOWN_SEC = 1;
/** A carrier cruises at this fraction of its speed. */
export const CARRIER_SPEED = 0.85;
/** Fraction of the gap to its cruising speed a square makes up per 60 Hz step. */
export const CTF_SPEED_RELAX = 0.05;
/** Every square's tempo: its cruising speed is the Ball Speed × 1 ± CTF_TEMPO_SPREAD / 2. */
export const CTF_TEMPO_SPREAD = 0.2;
/** Approach speeds under this fraction of the Ball Speed are touches, not tackles (no drop, no note). */
export const TACKLE_REL = 0.1;

/* ------------------------------------------------------------------ the flag rules (pure) */

/** What a square touching a flag does to it. */
export type FlagTouch = "pickup" | "return" | null;

/** The flag sits at its base. */
export function flagHome(flag: ArenaFlag, base: ArenaBase, nowMs: number) {
  flag.state = "base";
  flag.x = base.x;
  flag.y = base.y;
  flag.carrier = -1;
  flag.sinceMs = nowMs;
}

/**
 * Square `square` of `squareTeam` (carrying flag `carrying`, −1 for none; no pickups before `cooldownUntilMs`) touched
 * the flag of `flagTeam`: an enemy picks up a flag lying at its base or dropped (unless it already carries one or is
 * cooling down); the flag's own team returns a dropped flag to its base. Updates `flag` and says what happened.
 */
export function touchFlag(flag: ArenaFlag, flagTeam: number, base: ArenaBase, square: number, squareTeam: number, carrying: number, cooldownUntilMs: number, nowMs: number): FlagTouch {
  if (flag.state === "carried") return null;
  if (squareTeam === flagTeam) {
    if (flag.state !== "dropped") return null;
    flagHome(flag, base, nowMs);
    return "return";
  }
  if (carrying >= 0 || nowMs < cooldownUntilMs) return null;
  flag.state = "carried";
  flag.carrier = square;
  flag.sinceMs = nowMs;
  return "pickup";
}

/** The carrier was tackled by an enemy: the flag drops where it is. */
export function dropFlag(flag: ArenaFlag, x: number, y: number, nowMs: number) {
  flag.state = "dropped";
  flag.x = x;
  flag.y = y;
  flag.carrier = -1;
  flag.sinceMs = nowMs;
}

/** A carrier of `team` reached its own base: the captured flag goes home and the team scores. Returns the new score. */
export function captureFlag(flag: ArenaFlag, flagBase: ArenaBase, scores: number[], team: number, nowMs: number): number {
  flagHome(flag, flagBase, nowMs);
  scores[team] = (scores[team] ?? 0) + 1;
  return scores[team];
}

/** A dropped flag has lain long enough to go home by itself. */
export function flagTimedOut(flag: ArenaFlag, nowMs: number): boolean {
  return flag.state === "dropped" && nowMs - flag.sinceMs >= 1000 * FLAG_RETURN_SEC;
}

/** Whether the point (`x`, `y`) lies inside `base`. */
export function insideBase(base: ArenaBase, x: number, y: number): boolean {
  return Math.abs(x - base.x) <= base.hw && Math.abs(y - base.y) <= base.hh;
}

/**
 * The game's state: over once a team reached `scoreToWin` (it wins) or at `timeLimitSec` (the better score wins, equal
 * scores are a draw: winner −1).
 */
export function ctfOutcome(scores: readonly number[], scoreToWin: number, timeSec: number, timeLimitSec: number): { over: boolean; winner: number; byTime: boolean } {
  for (let team = 0; team < 2; team++) if ((scores[team] ?? 0) >= scoreToWin) return { over: true, winner: team, byTime: false };
  if (timeSec < timeLimitSec - 1e-9) return { over: false, winner: -1, byTime: false };
  const a = scores[0] ?? 0;
  const b = scores[1] ?? 0;
  return { over: true, winner: a > b ? 0 : b > a ? 1 : -1, byTime: true };
}

/** The two bases of a field: team 0 at the left end, team 1 at the right end, vertically centred. */
export function ctfBases(field: ArenaField): ArenaBase[] {
  const hw = BASE_WIDTH * field.halfW;
  const hh = BASE_HEIGHT * field.halfH;
  return [
    { x: field.cx - field.halfW + hw, y: field.cy, hw, hh },
    { x: field.cx + field.halfW - hw, y: field.cy, hw, hh },
  ];
}

/**
 * Half-size of the squares for a field and Ball Size (from 0.5× the default; --- review fix (uncap-all) --- no maximum) as
 * far as the field holds them: past `ctfSquaresFit()` they stop at the most that still moves (ARENA FULL).
 */
export function ctfSquareHalf(field: ArenaField, ballRadius: number): number {
  return Math.max(4, Math.min(ctfSquareWish(field, ballRadius), maxSquareHalf(field)));
}

/** --- review fix (uncap-all) --- The half-size the Ball Size asks of the squares, before the field's room. */
function ctfSquareWish(field: ArenaField, ballRadius: number): number {
  const scale = Math.max(0.5, (ballRadius || 8) / 8);
  return CTF_SQUARE * Math.min(field.halfW, field.halfH) * scale;
}

/** --- review fix (uncap-all) --- Whether the squares the Ball Size asks for fit the field (else they are cut to fit: ARENA FULL). */
export function ctfSquaresFit(field: ArenaField, ballRadius: number): boolean {
  return ctfSquareWish(field, ballRadius) <= maxSquareHalf(field);
}

/* ------------------------------------------------------------------ the mode */

export class CtfMode implements GameMode {
  readonly name = "ctf";
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: CtfSettings = { ...DEFAULT_CTF_SETTINGS };
  private run: CtfSettings = { ...DEFAULT_CTF_SETTINGS };
  private readonly view: ArenaView = createArenaView("ctf");
  private tempo = new Float64Array(0);
  private cooldownUntil = new Float64Array(0);
  private byIndex: (Ball | null)[] = [];
  private ballSpeed = 400;
  private lastBallRadius = 8;
  private fanfareStartMs = -Infinity;
  private fanfareStep = FANFARE.length;
  private readonly budget = new ArenaSoundBudget();
  private readonly contact: PairContact = { nx: 0, ny: 0, approach: 0, speedA: 0, speedB: 0 };
  private readonly wall: WallContact = { wall: -1, approach: 0, nx: 0, ny: 0 };
  private readonly steer = { vx: 0, vy: 0 };

  getSettings(): CtfSettings {
    return this.settings;
  }
  /** Team size, score to win and nudge apply on the next init; the clip length (the time limit) at once. */
  setSettings(patch: Partial<CtfSettings>) {
    this.settings = resolveCtfSettings({ ...this.settings, ...patch });
    this.run = { ...this.run, clipSeconds: this.settings.clipSeconds };
    if (this.view.field) this.view.timeLimitSec = ctfTimeLimitSec(this.run.clipSeconds);
  }
  getView(): ArenaView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { scores: [v.scores[0], v.scores[1]], captures: v.captures, drops: v.drops, returns: v.returns, flags: v.flags.map((f) => f.state), finished: v.finished, winner: v.winner, byTime: v.byTime, timeLimitSec: v.timeLimitSec };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    this.run = { ...s };
    const field = buildArenaField(ctx.config.width, ctx.config.height, "box");
    const per = s.perTeam;
    const n = 2 * per;
    resetArenaView(this.view, n, ctx.getNextId(), field, 1);
    const v = this.view;
    v.timeLimitSec = ctfTimeLimitSec(s.clipSeconds);
    v.bases = ctfBases(field);
    v.flags = v.bases.map((b) => ({ state: "base" as const, x: b.x, y: b.y, carrier: -1, sinceMs: 0 }));
    this.ballSpeed = arenaSpeed(field, ctx.config.ballSpeed);
    this.lastBallRadius = ctx.config.ballRadius || 8;
    this.budget.clear();
    this.fanfareStartMs = -Infinity;
    this.fanfareStep = FANFARE.length;
    this.tempo = new Float64Array(n);
    this.cooldownUntil = new Float64Array(n).fill(-Infinity);
    this.byIndex = new Array(n).fill(null);
    const half = ctfSquareHalf(field, this.lastBallRadius);
    if (!ctfSquaresFit(field, this.lastBallRadius)) ctx.noteArenaFull?.(); // --- review fix (uncap-all) --- (cut to fit the field)
    const lane = (2 * field.halfH) / (per + 1);
    for (let k = 0; k < n; k++) {
      const team = k < per ? 0 : 1;
      const slot = team === 0 ? k : k - per;
      v.team[k] = team;
      this.tempo[k] = 1 + CTF_TEMPO_SPREAD * (ctx.random() - 0.5);
      // Each team starts in its own third, one square per lane, and heads for the other end (12°–55° off the axis).
      const depth = field.halfW * (0.35 + 0.3 * ctx.random());
      const x = field.cx + (team === 0 ? -1 : 1) * depth;
      const y = field.cy - field.halfH + lane * (slot + 1) + (ctx.random() - 0.5) * 0.3 * lane;
      const off = ((12 + 43 * ctx.random()) * Math.PI) / 180 * (ctx.random() < 0.5 ? -1 : 1);
      const a = (team === 0 ? 0 : Math.PI) + off;
      const speed = this.ballSpeed * this.tempo[k];
      ctx.addBall({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, radius: half, color: arenaColor(team), gravityScale: 0, radiusScale: half / this.lastBallRadius });
    }
  }

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
    const speed = v.field ? arenaSpeed(v.field, ctx.config.ballSpeed) : ctx.config.ballSpeed || 400;
    this.ballSpeed = speed;
    this.lastBallRadius = ctx.config.ballRadius || 8;
    this.indexBalls(ctx);
    for (let k = 0; k < v.count; k++) {
      const ball = this.byIndex[k];
      if (!ball) continue;
      const cruise = speed * this.tempo[k] * (v.carrying[k] >= 0 ? CARRIER_SPEED : 1);
      const s = Math.hypot(ball.vx, ball.vy);
      if (s < 1e-6) {
        const a = offAxisAngle(ctx.random(), ctx.random());
        ball.vx = Math.cos(a) * cruise;
        ball.vy = Math.sin(a) * cruise;
      } else {
        const next = Math.min(3 * cruise, s + (cruise - s) * CTF_SPEED_RELAX);
        ball.vx *= next / s;
        ball.vy *= next / s;
      }
    }
    if (v.finished) return;
    // A flag left lying too long goes home by itself.
    for (let team = 0; team < v.flags.length; team++) {
      const flag = v.flags[team];
      if (flagTimedOut(flag, now)) {
        flagHome(flag, v.bases[team], now);
        v.returns++;
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: pentatonicNote(team === 0 ? 2 : 7, 72), accent: true });
      }
    }
  }

  onBallStep(ctx: ModeContext, ball: Ball) {
    const v = this.view;
    const k = ball.id - v.firstId;
    const f = v.field;
    if (k < 0 || k >= v.count || !f) return;
    if (!boxWallPass(ball, f.cx, f.cy, f.halfW, f.halfH, ctx.getPhysicsExtras().wallBounciness, this.wall)) return;
    const w = this.wall;
    if (w.approach < 0.2 * this.ballSpeed) return;
    ctx.noteBounce?.(ball); // --- bounce-math --- a real wall hit is a bounce
    v.wallHits++;
    v.wallHitMs[w.wall] = v.timeMs;
    this.budget.offer(w.approach * w.approach, arenaWallNote("box", w.wall), 0.3 * Math.min(1, w.approach / this.ballSpeed));
    if (!v.finished) this.nudge(ball, k, w.nx, w.ny);
  }

  /** Where square k heads: home with the flag, the enemy flag, or the enemy carrier of its own flag. */
  private objective(k: number, ball: Ball, out: { vx: number; vy: number }): boolean {
    const v = this.view;
    const team = v.team[k];
    const enemy = 1 - team;
    let x: number;
    let y: number;
    const own = v.flags[team];
    const theirs = v.flags[enemy];
    const firstOfTeam = team === 0 ? 0 : v.count / 2;
    const attacker = k === firstOfTeam;
    if (v.carrying[k] >= 0) {
      x = v.bases[team].x;
      y = v.bases[team].y;
    } else if (own.state === "carried" && !attacker) {
      const carrier = this.byIndex[own.carrier];
      if (!carrier) return false;
      x = carrier.x;
      y = carrier.y;
    } else if (own.state === "dropped" && !attacker) {
      x = own.x;
      y = own.y;
    } else if (theirs.state !== "carried") {
      x = theirs.x;
      y = theirs.y;
    } else if (own.state === "carried") {
      const carrier = this.byIndex[own.carrier];
      if (!carrier) return false;
      x = carrier.x;
      y = carrier.y;
    } else {
      // A team-mate has the flag: escort it home by heading for the square nearest to it among the enemies.
      const mate = this.byIndex[theirs.carrier];
      if (!mate) return false;
      let best = Infinity;
      x = mate.x;
      y = mate.y;
      for (let j = 0; j < v.count; j++) {
        const other = this.byIndex[j];
        if (!other || v.team[j] === team) continue;
        const d = (other.x - mate.x) ** 2 + (other.y - mate.y) ** 2;
        if (d < best) {
          best = d;
          x = other.x;
          y = other.y;
        }
      }
    }
    out.vx = x - ball.x;
    out.vy = y - ball.y;
    return true;
  }

  private readonly target = { vx: 0, vy: 0 };

  private nudge(ball: Ball, k: number, nx: number, ny: number) {
    if (!(this.run.nudge > 0) || !this.objective(k, ball, this.target)) return;
    steerToward(ball.vx, ball.vy, this.target.vx, this.target.vy, this.run.nudge * MAX_NUDGE, nx, ny, this.steer);
    ball.vx = this.steer.vx;
    ball.vy = this.steer.vy;
  }

  onPostSubStep(ctx: ModeContext) {
    const v = this.view;
    const n = v.count;
    const f = v.field;
    if (!f) return;
    const e = Math.min(1, ctx.getPhysicsExtras().wallBounciness);
    let touched = false;
    for (let i = 0; i < n; i++) {
      const a = this.byIndex[i];
      if (!a) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.byIndex[j];
        if (!b || !resolveSquarePair(a, b, e, this.contact)) continue;
        touched = true;
        if (this.contact.approach > 0) this.clash(ctx, i, j, a, b);
      }
    }
    if (touched) for (let i = 0; i < n; i++) if (this.byIndex[i]) boxWallPass(this.byIndex[i]!, f.cx, f.cy, f.halfW, f.halfH, e, this.wall);
    if (v.finished) return;
    this.flagContacts(ctx);
  }

  /** Squares i and j collided: a note, and a carrier tackled by an enemy drops the flag. */
  private clash(ctx: ModeContext, i: number, j: number, a: Ball, b: Ball) {
    const v = this.view;
    const c = this.contact;
    const rel = c.approach / Math.max(1, this.ballSpeed);
    if (rel < TACKLE_REL) return;
    ctx.noteCollide?.(a, b); // --- bounce-math --- a clash is a ball hit
    v.hits++;
    this.budget.offer(10 * c.approach * c.approach, clashNote(v.team[i] === 0 ? 2 + (i % 4) : 10 + (i % 4)), 0.5 + 0.4 * Math.min(1, rel / 2), rel >= 1.6);
    if (v.finished || v.team[i] === v.team[j]) return;
    if (v.carrying[i] >= 0) this.drop(ctx, i, a);
    if (v.carrying[j] >= 0) this.drop(ctx, j, b);
  }

  private drop(ctx: ModeContext, k: number, ball: Ball) {
    const v = this.view;
    const flag = v.flags[v.carrying[k]];
    dropFlag(flag, ball.x, ball.y, v.timeMs);
    v.carrying[k] = -1;
    v.hitMs[k] = v.timeMs;
    this.cooldownUntil[k] = v.timeMs + 1000 * PICKUP_COOLDOWN_SEC;
    v.drops++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: pentatonicNote(0, 48), accent: true });
  }

  /** Pickups, returns and captures of the sub-step, and the carried flags follow their carriers. */
  private flagContacts(ctx: ModeContext) {
    const v = this.view;
    const now = v.timeMs;
    for (let k = 0; k < v.count; k++) {
      const ball = this.byIndex[k];
      if (!ball) continue;
      const team = v.team[k];
      const reach = ball.radius * (1 + FLAG_REACH);
      for (let flagTeam = 0; flagTeam < v.flags.length; flagTeam++) {
        const flag = v.flags[flagTeam];
        if (flag.state === "carried" || Math.abs(flag.x - ball.x) > reach || Math.abs(flag.y - ball.y) > reach) continue;
        const touch = touchFlag(flag, flagTeam, v.bases[flagTeam], k, team, v.carrying[k], this.cooldownUntil[k], now);
        if (touch === "pickup") {
          v.carrying[k] = flagTeam;
          v.clashMs[k] = now;
          ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: pentatonicNote(team === 0 ? 4 : 9, 72), accent: true });
        } else if (touch === "return") {
          v.returns++;
          ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: pentatonicNote(team === 0 ? 2 : 7, 72), accent: true });
        }
      }
      const carried = v.carrying[k];
      if (carried < 0) continue;
      const flag = v.flags[carried];
      flag.x = ball.x;
      flag.y = ball.y - ball.radius;
      if (insideBase(v.bases[team], ball.x, ball.y)) {
        const score = captureFlag(flag, v.bases[carried], v.scores, team, now);
        v.carrying[k] = -1;
        v.captures++;
        v.lastCaptureMs = now;
        v.lastCaptureTeam = team;
        this.fanfareStartMs = now;
        this.fanfareStep = 0;
        ctx.spawnConfetti(ball.x, ball.y);
        void score;
      }
    }
  }

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    // The goal fanfare: three rising chords a short step apart, on the simulation clock.
    while (this.fanfareStep < FANFARE.length && v.timeMs >= this.fanfareStartMs + 1000 * FANFARE_STEP_SEC * this.fanfareStep - 1e-6) {
      const chord = FANFARE[this.fanfareStep++];
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: chord[0], accent: true, chord: [...chord] });
    }
    if (v.finished) return;
    const outcome = ctfOutcome(v.scores, this.run.scoreToWin, v.timeMs / 1000, v.timeLimitSec);
    if (!outcome.over) return;
    v.finished = true;
    v.finishMs = v.timeMs;
    v.winner = outcome.winner;
    v.byTime = outcome.byTime;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: WIN_CHORD[0], accent: true, chord: [...WIN_CHORD] });
    const f = v.field;
    if (f) {
      const base = outcome.winner >= 0 ? v.bases[outcome.winner] : null;
      ctx.spawnConfetti(base ? base.x : f.cx, base ? base.y : f.cy);
    }
  }

  flushPendingSounds(ctx: ModeContext) {
    this.view.notes += this.budget.flush((frequency, level, accent) => ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency, level, ...(accent ? { accent: true } : {}) }));
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }

  /**
   * A canvas resize lays the field out again and maps the squares, bases and flags onto it. The squares' speeds scale with
   * the field too (by its side, never per axis), so a found game plays on unchanged.
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    const v = this.view;
    const old = v.field;
    if (!sizeChanged || !old) return true;
    const field = buildArenaField(ctx.config.width, ctx.config.height, "box");
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
    for (const flag of v.flags) {
      flag.x = cx + (flag.x - ocx) * k;
      flag.y = cy + (flag.y - ocy) * k;
    }
    v.field = field;
    v.bases = ctfBases(field);
    return true;
  }

  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { scores: [v.scores[0], v.scores[1]], captures: v.captures, finished: v.finished, time: v.timeMs };
  }
}
