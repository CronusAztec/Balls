import { midiToFrequency } from "@/lib/audio/scales";
import { emptyStats, MAX_TEAMS, type BallStats } from "../ballStats";
import type { Ball, GameMode, ModeContext } from "../types";
import { TWO_PI, arenaRadius } from "../types";
import { wobbleStrength } from "../wobble";
import { teamResult } from "@/lib/teams";
import { rangesFor } from "@/lib/unlimited"; // --- unlimited ---

/**
 * String Battle ("stringBattle" mode, battle family – feature odd-string-battle): the oddplayground "WEB DOMINION"
 * reel (#stringbattle #circleduel). 2–6 numbered balls bounce inside one thin circular ring. Every wall bounce anchors
 * a glowing "web" string at the impact point on the ring; the string stays attached to its ball and follows it (a
 * straight thread anchor → ball), so every ball drags a fan of threads – at most `maxStrings` of them, the oldest
 * detaching with a fade. The combat rule decides who loses a life:
 *
 *  - `cut` (default): a ball crossing an enemy thread cuts it and the thread's owner loses a life (the thread snaps and
 *    plays a pluck pitched by its length);
 *  - `touch`: a ball touching an enemy thread loses a life itself (the threads are lasers – the one it touched snaps);
 *  - `collide`: ball-to-ball collisions cost the slower ball a life (the threads are decoration). Every ring bounce draws
 *    the ball's cruising speed afresh (`SB_SPEED_SPREAD`), so which ball is the slower one changes from clash to clash.
 *
 * A thread cuts and burns along its whole length, from its anchor on the ring up to its ball (`SB_CUT_SPAN`; only the
 * stub `SB_REACH_GAP` past the two balls' bodies next to its owner is spared, so touching a ball never cuts its whole
 * fan) – and only a ball's own move across it cuts (`cutsThread()`), never the thread sweeping over a ball as its owner
 * flies past.
 *
 * After a lost life a ball is shielded for a moment (`SB_INVULN_MS`: its web cannot be cut, it passes through lasers,
 * it takes no collision damage), so one slash through a fan costs one life and the battle gets its rhythm. A
 * ball at 0 lives shatters (a glass-like burst, a noise burst) and its threads dissolve; the last ball standing wins –
 * or, with a clip limit (`duration`), the survivors with the most lives when it runs out (then the most kills, the most
 * bounces). When the battle is down to two balls and one of them is one cut from elimination (or the clip limit is 6 s
 * away) the finale starts: every ball's cruising speed ramps up to `finaleSpeed`× and the canvas strobes the halos.
 *
 * The ring is the mode's own ("none" ring layout, like the other modes that own their playfield): `onBallStep()`
 * reflects a ball off it with a seeded scatter and resets its speed to its cruising speed, so the engine's slow-ball
 * boost is off (`ballsMayRest`) and the balls feel no gravity (`gravityScale` 0). Ball-to-ball rebounds are the
 * engine's pair loop (`onBallCollision()` sees them). Everything random – the spawn, the headings, the cruising speeds,
 * every rebound's scatter – comes from `ctx.random()`, so a seed replays exactly and Find Simulation can search it.
 *
 * Scores go into the engine's per-team stats (the balls carry their slot as `team`): bounces (`ctx.creditBounce`),
 * kills as "walls" (`ctx.creditWallBreak`) and the win as an "escape" (`ctx.creditEscape`) – so the teams winner
 * banner, the finder's "winner" outcome and the canvas all rank the battle with the same `teamResult()`. The rigged
 * forced winner (`config.forcedWinner`) is a hard constraint here: the chosen ball never loses its last life and never
 * falls behind another ball still in the battle (`rigAbsorbs()`; under the collide rule it wins such a clash instead), and
 * it takes a clip-limit verdict it shares.
 */

export const SB_RULES = ["cut", "touch", "collide"] as const;
export type SbRule = (typeof SB_RULES)[number];
export const SB_STYLES = ["web", "neon"] as const;
export type SbStyle = (typeof SB_STYLES)[number];

export function isSbRule(value: unknown): value is SbRule {
  return typeof value === "string" && (SB_RULES as readonly string[]).includes(value);
}
export function isSbStyle(value: unknown): value is SbStyle {
  return typeof value === "string" && (SB_STYLES as readonly string[]).includes(value);
}

export interface StringBattleSettings {
  /** Balls in the battle, 2–6. */
  balls: number;
  /** Lives every ball starts with, 1–9 (the number on the ball). */
  lives: number;
  /** Threads a ball drags at most, 3–40 (the oldest detaches with a fade). */
  maxStrings: number;
  rule: SbRule;
  /** web: numbered balls, thread segments, the HUD; neon: infinite lines painting moiré art, a jelly ring, glitch bars. */
  style: SbStyle;
  /** Seconds after which the battle is judged (the survivors with the most lives win); 0 = until one ball remains. */
  duration: number;
  /** 1–3: the cruising speed the finale ramps up to. */
  finaleSpeed: number;
  /** 0–1: how much the ring wobbles on every hit in the neon style. */
  wobble: number;
  /** The "FLASHING LIGHTS – THE END GETS INTENSE" warning badge. */
  badge: boolean;
  /** The "WEB DOMINION" HUD (a row per ball, the live threads). */
  hud: boolean;
}

export const DEFAULT_STRING_BATTLE_SETTINGS: StringBattleSettings = {
  balls: 4,
  lives: 4,
  maxStrings: 12,
  rule: "cut",
  style: "web",
  duration: 0,
  finaleSpeed: 1.5,
  wobble: 0.6,
  badge: true,
  hud: true,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const STRING_BATTLE_RANGES = {
  sbBalls: { min: 2, max: MAX_TEAMS, step: 1 },
  sbLives: { min: 1, max: 9, step: 1 },
  sbMaxStrings: { min: 3, max: 40, step: 1 },
  sbDuration: { min: 0, max: 180, step: 5 },
  sbFinaleSpeed: { min: 1, max: 3, step: 0.1 },
  sbWobble: { min: 0, max: 1, step: 0.05 },
} as const;

/** The String Battle fields of the SimulatorSettings object (URL keys sbn, sbl, sbm, sbr, sbst, sbd, sbf, sbw, sbb, sbh). */
export interface StringBattleSettingFields {
  sbBalls: number;
  sbLives: number;
  sbMaxStrings: number;
  sbRule: SbRule;
  sbStyle: SbStyle;
  sbDuration: number;
  sbFinaleSpeed: number;
  sbWobble: number;
  sbBadge: boolean;
  sbHud: boolean;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults and clamps every value (counts and the duration whole, the finale speed on its 0.1 steps); unknown options and non-boolean flags fall back to the defaults. */
export function resolveStringBattleSettings(config: Partial<StringBattleSettings> | null | undefined, unlimited = false): StringBattleSettings {
  const out = { ...DEFAULT_STRING_BATTLE_SETTINGS };
  if (!config) return out;
  const R = rangesFor(STRING_BATTLE_RANGES, unlimited); // --- unlimited --- (past the sliders up to the soft ceilings with No limits on)
  if (config.balls !== undefined) out.balls = Math.round(clampNumber(config.balls, R.sbBalls, out.balls));
  if (config.lives !== undefined) out.lives = Math.round(clampNumber(config.lives, R.sbLives, out.lives));
  if (config.maxStrings !== undefined) out.maxStrings = Math.round(clampNumber(config.maxStrings, R.sbMaxStrings, out.maxStrings));
  if (isSbRule(config.rule)) out.rule = config.rule;
  if (isSbStyle(config.style)) out.style = config.style;
  if (config.duration !== undefined) out.duration = Math.round(clampNumber(config.duration, R.sbDuration, out.duration));
  if (config.finaleSpeed !== undefined) out.finaleSpeed = Math.round(10 * clampNumber(config.finaleSpeed, R.sbFinaleSpeed, out.finaleSpeed)) / 10;
  if (config.wobble !== undefined) out.wobble = Math.round(100 * clampNumber(config.wobble, R.sbWobble, out.wobble)) / 100;
  if (typeof config.badge === "boolean") out.badge = config.badge;
  if (typeof config.hud === "boolean") out.hud = config.hud;
  return out;
}

/** Picks the String Battle settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setStringBattleSettings()`. */
export function stringBattleSettingsOf(source: StringBattleSettingFields): StringBattleSettings {
  return {
    balls: source.sbBalls,
    lives: source.sbLives,
    maxStrings: source.sbMaxStrings,
    rule: source.sbRule,
    style: source.sbStyle,
    duration: source.sbDuration,
    finaleSpeed: source.sbFinaleSpeed,
    wobble: source.sbWobble,
    badge: source.sbBadge,
    hud: source.sbHud,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function stringBattleSettingFields(settings: StringBattleSettings): StringBattleSettingFields {
  return {
    sbBalls: settings.balls,
    sbLives: settings.lives,
    sbMaxStrings: settings.maxStrings,
    sbRule: settings.rule,
    sbStyle: settings.style,
    sbDuration: settings.duration,
    sbFinaleSpeed: settings.finaleSpeed,
    sbWobble: settings.wobble,
    sbBadge: settings.badge,
    sbHud: settings.hud,
  };
}

/* ------------------------------------------------------------------ settings, URL and presets (settings.ts calls these) */

/** The defaults of the feature's fields. */
export function defaultStringBattleFields(): StringBattleSettingFields {
  return stringBattleSettingFields(DEFAULT_STRING_BATTLE_SETTINGS);
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers, known options, real booleans. */
export function resolveStringBattleFields(source: Partial<StringBattleSettingFields>): StringBattleSettingFields {
  return stringBattleSettingFields(
    resolveStringBattleSettings({
      balls: source.sbBalls,
      lives: source.sbLives,
      maxStrings: source.sbMaxStrings,
      rule: source.sbRule,
      style: source.sbStyle,
      duration: source.sbDuration,
      finaleSpeed: source.sbFinaleSpeed,
      wobble: source.sbWobble,
      badge: source.sbBadge,
      hud: source.sbHud,
    }),
  );
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { sbn: "sbBalls", sbl: "sbLives", sbm: "sbMaxStrings", sbd: "sbDuration", sbf: "sbFinaleSpeed", sbw: "sbWobble" } as const;
const BOOLEAN_KEYS = { sbb: "sbBadge", sbh: "sbHud" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: sbn, sbl, sbm, sbr, sbst, sbd, sbf, sbw, sbb and sbh. */
export function writeStringBattleParams(settings: StringBattleSettingFields, base: StringBattleSettingFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.sbRule !== base.sbRule) params.set("sbr", settings.sbRule);
  if (settings.sbStyle !== base.sbStyle) params.set("sbst", settings.sbStyle);
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readStringBattleParams(params: URLSearchParams, settings: StringBattleSettingFields) {
  const next: Partial<StringBattleSettingFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const rule = params.get("sbr");
  if (isSbRule(rule)) next.sbRule = rule;
  const style = params.get("sbst");
  if (isSbStyle(style)) next.sbStyle = style;
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  Object.assign(settings, resolveStringBattleFields(next));
}

/* ------------------------------------------------------------------ constants */

/** The default palette (colour and name per ball) when no team roster is set: oddplayground's neon on black. */
export const SB_PALETTE: readonly { name: string; color: string }[] = [
  { name: "HOTPINK", color: "#ff2d95" },
  { name: "AQUA", color: "#22e4ff" },
  { name: "ACID", color: "#b6ff1a" },
  { name: "VIOLET", color: "#a45bff" },
  { name: "SUN", color: "#ffc61a" },
  { name: "MINT", color: "#3dffb4" },
];
/** A ball's radius is the Ball Size setting times this (the reels' balls are big next to the ring). */
export const SB_BALL_SCALE = 2;
/** The balls start evenly spread on a circle of this fraction of the ring's radius. */
export const SB_SPAWN_RADIUS = 0.45;
/** The balls cruise at this fraction of the Ball Speed setting (the reels' duels are unhurried: a ball crosses the ring in two to three seconds). */
export const SB_SPEED_SCALE = 0.4;
/**
 * Each ball cruises at the Ball Speed times a seeded factor in [1 − SPREAD, 1 + SPREAD], drawn afresh at every ring bounce
 * (the collide rule needs a slower ball – and a different one from clash to clash, not the one that spawned slowest).
 */
export const SB_SPEED_SPREAD = 0.1;
/** Largest random turn (radians) added to a mirror rebound off the ring. */
export const SB_SCATTER = 0.3;
/** A rebound always leaves the ring at least this far (radians) off the tangent. */
export const SB_MIN_INCIDENCE = 0.22;
/** A ball slower than its cruising speed (after a collision) speeds up by this factor per second. */
export const SB_RECOVER = 1.5;
/** A thread is cuttable up to its ball's radius plus the cutter's radius plus this (px) short of its ball: touching a ball's body never cuts its whole fan. */
export const SB_REACH_GAP = 2;
/**
 * The shield after a lost life, per rule (simulation ms): the cut rule's web cannot be cut, the touch rule's ball passes
 * through lasers and the collide rule's ball takes no damage – one slash through a fan costs one life, and the battle
 * gets a rhythm (a ball that lost a life blinks, then is fair game again).
 */
export const SB_INVULN_MS: Record<SbRule, number> = { cut: 2500, touch: 2500, collide: 800 };
/**
 * The share of a thread, from its anchor, that can be cut or burns: the whole thread (`cuttableSpan()` still spares the
 * stub next to its ball, `SB_REACH_GAP` past the two bodies). The shield after a lost life (`SB_INVULN_MS`) sets the
 * battle's pace – a battle of the defaults lasts about 10–20 s and every seed plays out differently. The helpers take a
 * smaller share as an argument (a ring-side-only variant).
 */
export const SB_CUT_SPAN = 1;
/** Lifetimes (simulation ms) of a detached thread's fade, a snapped thread's recoil, a dissolving fan and a shatter burst. */
export const SB_FADE_MS = 450;
export const SB_SNAP_MS = 380;
export const SB_DISSOLVE_MS = 800;
export const SB_BURST_MS = 1400;
/** The finale ramps the cruising speed over this long (simulation ms). */
export const SB_FINALE_RAMP_MS = 2500;
/** With a clip limit the finale starts this long before it (simulation ms). */
export const SB_FINALE_LAST_MS = 6000;
/** Plucks queued per 60 Hz step at most (a slash through a fan snaps many threads at once). */
export const SB_MAX_PLUCKS_PER_STEP = 3;
/** Visual effects (fading / snapped / dissolving threads) kept at most, and shatter bursts. */
export const SB_MAX_GHOSTS = 200;
export const SB_MAX_BURSTS = 8;
/** Bounce notes, one scale degree per ball (C-major pentatonic from C5): the ToneGenerator snaps them to the chosen scale. */
export const SB_BOUNCE_MIDI: readonly number[] = [72, 74, 76, 79, 81, 84];

/* ------------------------------------------------------------------ pure helpers (unit-tested) */

/** The palette name of ball `slot` ("HOTPINK", "AQUA"…): the name it goes by without a team roster. */
export function stringBattleBallName(slot: number): string {
  const n = SB_PALETTE.length;
  return SB_PALETTE[((Math.round(slot) % n) + n) % n].name;
}

/** Whether the WEB DOMINION HUD is drawn: the web style with the HUD switched on (the neon style is the bare art). */
export function sbHudShown(settings: Pick<StringBattleSettings, "hud" | "style">): boolean {
  return settings.hud && settings.style === "web";
}

/** The bounce note of ball `slot` (Hz). */
export function bounceFrequency(slot: number): number {
  const n = SB_BOUNCE_MIDI.length;
  return midiToFrequency(SB_BOUNCE_MIDI[((Math.round(slot) % n) + n) % n]);
}

/** The pluck of a thread of `length` px in a ring of `radius`: D6 for a stub, C4 for a thread across the whole ring (Hz). */
export function pluckFrequency(length: number, radius: number): number {
  const t = radius > 0 ? Math.max(0, Math.min(1, length / (2 * radius))) : 0;
  return midiToFrequency(Math.round(86 - 26 * t));
}

/** The anchor on the ring (centre cx, cy, radius r) of a bounce at (px, py): the ring point on the same radius. Written into `out`. */
export function anchorPoint(cx: number, cy: number, r: number, px: number, py: number, out: { x: number; y: number; angle: number }) {
  const angle = Math.atan2(py - cy, px - cx);
  out.x = cx + r * Math.cos(angle);
  out.y = cy + r * Math.sin(angle);
  out.angle = angle;
  return out;
}

/**
 * The cuttable length of a thread of `len` px: its anchor-side `share` (`SB_CUT_SPAN`: all of it), and never closer than
 * `reach` px to its ball (the part next to the ball's body – an enemy touching the ball must not cut its whole fan at once).
 */
export function cuttableSpan(len: number, reach: number, share = SB_CUT_SPAN): number {
  return Math.min(len - reach, share * len);
}

/**
 * Squared distance from the point (px, py) to the cuttable part of the thread from its anchor (ax, ay) to its ball at
 * (bx, by) (`cuttableSpan()`; `share` of it from the anchor, at most up to `reach` px short of the ball). Infinity when
 * nothing of it is cuttable. The closest point goes into `out` when given.
 */
export function threadDistanceSq(ax: number, ay: number, bx: number, by: number, px: number, py: number, reach: number, out?: { x: number; y: number }, share = SB_CUT_SPAN): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const span = cuttableSpan(len, reach, share);
  if (!(span > 0)) return Infinity;
  const ux = dx / len;
  const uy = dy / len;
  let t = (px - ax) * ux + (py - ay) * uy;
  if (t < 0) t = 0;
  else if (t > span) t = span;
  const qx = ax + ux * t;
  const qy = ay + uy * t;
  if (out) {
    out.x = qx;
    out.y = qy;
  }
  const ex = px - qx;
  const ey = py - qy;
  return ex * ex + ey * ey;
}

/** Whether a ball of `radius` at (px, py) touches the burning part of the thread anchor (ax, ay) → ball (bx, by) whose ball has `ownerRadius` (the touch rule). */
export function touchesThread(ax: number, ay: number, bx: number, by: number, ownerRadius: number, px: number, py: number, radius: number, share = SB_CUT_SPAN): boolean {
  return threadDistanceSq(ax, ay, bx, by, px, py, ownerRadius + radius + SB_REACH_GAP, undefined, share) < radius * radius;
}

/**
 * The cut rule's test: whether a ball whose centre moved from (p0x, p0y) to (p1x, p1y) crossed the cuttable part of the
 * thread from its anchor (ax, ay) toward its ball at (bx, by) (`cuttableSpan()`). Only the ball's own move cuts: a thread
 * swinging over a ball as its owner flies past does not. The cut point goes into `out`.
 */
export function cutsThread(ax: number, ay: number, bx: number, by: number, reach: number, p0x: number, p0y: number, p1x: number, p1y: number, out?: { x: number; y: number }, share = SB_CUT_SPAN): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const span = cuttableSpan(len, reach, share);
  if (!(span > 0)) return false;
  const rx = (dx / len) * span;
  const ry = (dy / len) * span;
  const sx = p1x - p0x;
  const sy = p1y - p0y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return false;
  const qx = p0x - ax;
  const qy = p0y - ay;
  const t = (qx * sy - qy * sx) / denom; // along the thread
  const u = (qx * ry - qy * rx) / denom; // along the ball's move
  if (t < 0 || t > 1 || u <= 0 || u > 1) return false;
  if (out) {
    out.x = ax + t * rx;
    out.y = ay + t * ry;
  }
  return true;
}

/**
 * The part of the infinite line through (x0, y0) and (x1, y1) inside the rectangle [left, right] × [top, bottom] – the
 * neon style draws every thread as that line. Written into `out`; false when the line misses the rectangle or the two
 * points coincide.
 */
export function lineThroughRect(x0: number, y0: number, x1: number, y1: number, left: number, top: number, right: number, bottom: number, out: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return false;
  // Liang–Barsky on the parametric line p(t) = p0 + t·d, t unbounded.
  let tMin = -Infinity;
  let tMax = Infinity;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > tMin) tMin = r;
    } else if (r < tMax) tMax = r;
    return true;
  };
  if (!clip(-dx, x0 - left) || !clip(dx, right - x0) || !clip(-dy, y0 - top) || !clip(dy, bottom - y0)) return false;
  if (!(tMin <= tMax) || !Number.isFinite(tMin) || !Number.isFinite(tMax)) return false;
  out.x1 = x0 + tMin * dx;
  out.y1 = y0 + tMin * dy;
  out.x2 = x0 + tMax * dx;
  out.y2 = y0 + tMax * dy;
  return true;
}

/** The finale's speed factor `sinceMs` after it started: a smooth ramp from 1 to `finaleSpeed` over `SB_FINALE_RAMP_MS`. */
export function finaleFactor(sinceMs: number, finaleSpeed: number): number {
  const top = Number.isFinite(finaleSpeed) ? Math.max(1, finaleSpeed) : 1;
  if (!(sinceMs > 0)) return 1;
  const x = Math.min(1, sinceMs / SB_FINALE_RAMP_MS);
  return 1 + (top - 1) * x * x * (3 - 2 * x);
}

/**
 * Whether the finale is due: two balls left and one of them one cut from elimination, or – with a clip limit of
 * `durationSec` – the last `SB_FINALE_LAST_MS` of it. Never once the battle is down to one ball.
 */
export function finaleDue(alive: number, minLives: number, elapsedMs: number, durationSec: number): boolean {
  if (alive <= 1) return false;
  if (alive === 2 && minLives <= 1) return true;
  return durationSec > 0 && elapsedMs >= 1000 * durationSec - SB_FINALE_LAST_MS;
}

/** The effective forced winner of a battle of `balls` balls: the rigged slot when it plays, else −1. */
export function battleForcedWinner(forcedWinner: number | undefined, balls: number): number {
  const w = forcedWinner ?? -1;
  return Number.isInteger(w) && w >= 0 && w < balls ? w : -1;
}

/**
 * The rig's hard constraint: whether a hit on `victim` is absorbed – the chosen ball (`forcedWinner`) never loses its
 * last life and never falls behind (fewer lives than) another ball still in the battle, so it is always the last one
 * standing and always among the leaders of a clip-limit verdict.
 */
export function rigAbsorbs(victim: number, forcedWinner: number, fighters: readonly { alive: boolean; lives: number }[]): boolean {
  if (forcedWinner < 0 || victim !== forcedWinner) return false;
  const me = fighters[victim];
  if (!me) return false;
  if (me.lives <= 1) return true;
  let maxOther = 0;
  for (let i = 0; i < fighters.length; i++) if (i !== victim && fighters[i].alive && fighters[i].lives > maxOther) maxOther = fighters[i].lives;
  return me.lives - 1 < maxOther;
}

/** The slots that take a clip-limit verdict: the survivors with the most lives – just the rig's chosen ball when it is one of them. */
export function timeoutLeaders(fighters: readonly { alive: boolean; lives: number }[], forcedWinner: number): number[] {
  let best = 0;
  for (const f of fighters) if (f.alive && f.lives > best) best = f.lives;
  const out: number[] = [];
  fighters.forEach((f, i) => {
    if (f.alive && f.lives === best && best > 0) out.push(i);
  });
  if (forcedWinner >= 0 && out.includes(forcedWinner)) return [forcedWinner];
  return out;
}

/* ------------------------------------------------------------------ state and view */

/** A thread: anchored on the ring at (ax, ay) (angle `angle` from the centre), attached to its ball. */
export interface SbString {
  ax: number;
  ay: number;
  angle: number;
  bornMs: number;
}

/** A thread that left the battle, drawn for a moment: detached (fade), cut (snap: both halves recoil from the cut) or dissolving with its shattered ball. */
export interface SbGhost {
  kind: "fade" | "snap" | "dissolve";
  slot: number;
  ax: number;
  ay: number;
  /** Where its ball was when it left. */
  bx: number;
  by: number;
  /** The cut point (snap). */
  qx: number;
  qy: number;
  /** Simulation time (ms) it left. */
  t0: number;
}

/** A ball shattering: where, whose, when (simulation ms) and the seed its shards fly from. */
export interface SbBurst {
  slot: number;
  x: number;
  y: number;
  radius: number;
  t0: number;
  seed: number;
}

export interface SbFighter {
  slot: number;
  /** The engine ball's id. */
  id: number;
  /** Palette colour (the canvas uses the team roster's when one is set). */
  color: string;
  lives: number;
  kills: number;
  alive: boolean;
  /** Simulation time (ms) it was eliminated; −1 while it fights. */
  eliminatedMs: number;
  /** Simulation time (ms) of its last hit (a lost life or a hit the rig absorbed): the invulnerability window and the blink. */
  hurtMs: number;
  /** Cruising speed as a multiple of the Ball Speed (seeded; drawn afresh at every ring bounce). */
  cruise: number;
  /** Speed (px/s) after its latest move, before the sub-step's collisions (the collide rule compares it). */
  preSpeed: number;
  /** Latest position (where it shatters when its ball is gone). */
  x: number;
  y: number;
  /** Position at the end of the previous sub-step (the cut rule tests the move from there). */
  px: number;
  py: number;
  radius: number;
  /** Live threads, oldest first. */
  strings: SbString[];
  /** Its scoreboard: bounces, kills ("walls"), the win ("escapes") – what the engine's team stats get. */
  stats: BallStats;
}

export interface StringBattleView {
  /** The settings of the last init, with the display fields (style, HUD, badge, wobble) applied at once. */
  settings: StringBattleSettings;
  /** Incremented by every init. */
  generation: number;
  cx: number;
  cy: number;
  /** The ring's radius, px. */
  radius: number;
  /** Balls the battle started with. */
  count: number;
  fighters: SbFighter[];
  /** Fading, snapped and dissolving threads (use `ghostCount`). */
  ghosts: SbGhost[];
  ghostCount: number;
  bursts: SbBurst[];
  alive: number;
  /** Threads attached right now. */
  liveStrings: number;
  /** Threads cut or snapped so far. */
  cuts: number;
  /** Lives lost so far (the neon style glitches on every one). */
  livesLost: number;
  /** Simulation time (ms) and slot of the latest lost life (−1 / −Infinity before the first). */
  lastHurtMs: number;
  lastHurtSlot: number;
  bounces: number;
  /** The rig's chosen ball (−1 off) and the hits it absorbed. */
  forcedWinner: number;
  shields: number;
  finale: boolean;
  finaleStartMs: number;
  finaleFactor: number;
  finished: boolean;
  finishedMs: number;
  /** The winning slot (−1 while the battle goes on, or for a dead heat). */
  winner: number;
  tie: boolean;
  /** Slow-motion and shake requests made (the camera's near-miss and impact hooks). */
  slowMos: number;
  impacts: number;
}

function createView(): StringBattleView {
  return {
    settings: { ...DEFAULT_STRING_BATTLE_SETTINGS },
    generation: 0,
    cx: 0,
    cy: 0,
    radius: 0,
    count: 0,
    fighters: [],
    ghosts: [],
    ghostCount: 0,
    bursts: [],
    alive: 0,
    liveStrings: 0,
    cuts: 0,
    livesLost: 0,
    lastHurtMs: -Infinity,
    lastHurtSlot: -1,
    bounces: 0,
    forcedWinner: -1,
    shields: 0,
    finale: false,
    finaleStartMs: 0,
    finaleFactor: 1,
    finished: false,
    finishedMs: -1,
    winner: -1,
    tie: false,
    slowMos: 0,
    impacts: 0,
  };
}

/** How long a ghost of `kind` is drawn (simulation ms). */
export function ghostLifeMs(kind: SbGhost["kind"]): number {
  return kind === "fade" ? SB_FADE_MS : kind === "snap" ? SB_SNAP_MS : SB_DISSOLVE_MS;
}

/* ------------------------------------------------------------------ the mode */

export class StringBattleMode implements GameMode {
  readonly name = "stringBattle" as const;
  /** The mode keeps each ball at its own cruising speed itself: no engine slow-ball boost toward one base speed. */
  readonly ballsMayRest = true;
  private settings: StringBattleSettings = { ...DEFAULT_STRING_BATTLE_SETTINGS };
  private readonly view: StringBattleView = createView();
  /** The engine ball of each slot this sub-step (null once it is gone). */
  private readonly ballOf: (Ball | null)[] = new Array<Ball | null>(MAX_TEAMS).fill(null);
  /** Slots that reached 0 lives this sub-step, and who took their last life (−1: nobody). */
  private readonly pending: number[] = [];
  private killerOf = new Int32Array(MAX_TEAMS).fill(-1); // (--- unlimited --- grown at init for more balls than the slider's MAX_TEAMS)
  private readonly spareStrings: SbString[] = [];
  private readonly spareGhosts: SbGhost[] = [];
  private readonly scratch = { x: 0, y: 0, angle: 0 };
  private plucksThisStep = 0;

  getSettings(): StringBattleSettings {
    return { ...this.settings };
  }

  /** Balls, lives, threads, rule, clip limit and finale speed apply on the next init; the style, HUD, badge and wobble at once. --- unlimited --- With `unlimited` (No limits on) the unlimited settings run past their sliders, up to their soft ceilings. */
  setSettings(patch: Partial<StringBattleSettings>, unlimited = false) {
    this.settings = resolveStringBattleSettings({ ...this.settings, ...patch }, unlimited);
    const live = this.view.settings;
    live.style = this.settings.style;
    live.hud = this.settings.hud;
    live.badge = this.settings.badge;
    live.wobble = this.settings.wobble;
  }

  /** Live battle state for the canvas and the HUD; the same object every call. */
  getView(): StringBattleView {
    return this.view;
  }

  getProgress() {
    const v = this.view;
    return { count: v.count, alive: v.alive, cuts: v.cuts, livesLost: v.livesLost, liveStrings: v.liveStrings, finished: v.finished, winner: v.winner, tie: v.tie, finale: v.finale };
  }

  /** The team stats of every slot (bounces, kills as walls, the win as an escape): what `teamResult()` ranks. */
  getTeamStats(): BallStats[] {
    return this.view.fighters.map((f) => f.stats);
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    v.generation++;
    const cfg = ctx.config;
    v.cx = cfg.width / 2;
    v.cy = cfg.height / 2;
    v.radius = arenaRadius(cfg);
    v.count = s.balls;
    for (const f of v.fighters) for (const str of f.strings) this.spareStrings.push(str);
    v.fighters.length = 0;
    v.ghostCount = 0;
    v.bursts.length = 0;
    v.alive = s.balls;
    v.liveStrings = 0;
    v.cuts = 0;
    v.livesLost = 0;
    v.lastHurtMs = -Infinity;
    v.lastHurtSlot = -1;
    v.bounces = 0;
    v.forcedWinner = battleForcedWinner(cfg.forcedWinner, s.balls);
    v.shields = 0;
    v.finale = false;
    v.finaleStartMs = 0;
    v.finaleFactor = 1;
    v.finished = false;
    v.finishedMs = -1;
    v.winner = -1;
    v.tie = false;
    this.pending.length = 0;
    this.ballOf.fill(null);
    if (this.killerOf.length < s.balls) this.killerOf = new Int32Array(s.balls).fill(-1); // --- unlimited --- (No limits: more balls than MAX_TEAMS; a typed array never grows by itself)
    this.plucksThisStep = 0;
    const base = (cfg.ballSpeed || 400) * SB_SPEED_SCALE;
    const radius = (cfg.ballRadius || 8) * SB_BALL_SCALE;
    const theta0 = ctx.random() * TWO_PI;
    for (let i = 0; i < s.balls; i++) {
      const a = theta0 + (TWO_PI * i) / s.balls;
      const rho = SB_SPAWN_RADIUS * v.radius;
      const x = v.cx + Math.cos(a) * rho;
      const y = v.cy + Math.sin(a) * rho;
      const heading = ctx.random() * TWO_PI;
      const cruise = 1 - SB_SPEED_SPREAD + 2 * SB_SPEED_SPREAD * ctx.random();
      const color = SB_PALETTE[i % SB_PALETTE.length].color;
      const id = ctx.getNextId();
      ctx.addBall({ x, y, vx: Math.cos(heading) * base * cruise, vy: Math.sin(heading) * base * cruise, radius, radiusScale: SB_BALL_SCALE, gravityScale: 0, color, team: i });
      v.fighters.push({ slot: i, id, color, lives: s.lives, kills: 0, alive: true, eliminatedMs: -1, hurtMs: -Infinity, cruise, preSpeed: base * cruise, x, y, px: x, py: y, radius, strings: [], stats: emptyStats() });
    }
  }

  private fighterOf(ball: Ball): SbFighter | null {
    const t = ball.team;
    if (t === undefined || t < 0 || t >= this.view.fighters.length) return null;
    const f = this.view.fighters[t];
    return f.id === ball.id ? f : null;
  }

  onPreUpdate(ctx: ModeContext) {
    const v = this.view;
    // The rig follows the config (the page may pick a forced winner mid-battle); the seed finder's engines carry it from the start.
    v.forcedWinner = battleForcedWinner(ctx.config.forcedWinner, v.count);
    if (v.finale && !v.finished) v.finaleFactor = finaleFactor(ctx.getElapsedMs() - v.finaleStartMs, v.settings.finaleSpeed);
    this.plucksThisStep = 0;
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const f = this.fighterOf(ball);
    if (!f) return;
    const v = this.view;
    // The cruising speed without the ball's own factor (the finale, a speed pickup), and with it.
    const scale = (ctx.config.ballSpeed || 400) * SB_SPEED_SCALE * v.finaleFactor * (ball.mult ? ball.mult.speed : 1);
    const cruise = scale * f.cruise;
    // A ball a collision slowed down picks its speed up again (no random numbers: the seed decides only at the ring).
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 0 && speed < cruise) {
      const k = Math.min(cruise / speed, 1 + SB_RECOVER * dtSec);
      ball.vx *= k;
      ball.vy *= k;
    } else if (speed === 0) ball.vx = cruise;
    const dx = ball.x - v.cx;
    const dy = ball.y - v.cy;
    const d = Math.hypot(dx, dy);
    const limit = v.radius - ball.radius;
    if (d > limit && d > 0) {
      const nx = dx / d;
      const ny = dy / d;
      ball.x = v.cx + nx * Math.max(0, limit);
      ball.y = v.cy + ny * Math.max(0, limit);
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn > 0) this.bounce(ctx, ball, f, nx, ny, vn, scale);
    }
    f.x = ball.x;
    f.y = ball.y;
    f.radius = ball.radius;
    f.preSpeed = Math.hypot(ball.vx, ball.vy);
  }

  /**
   * A rebound off the ring: mirror + seeded scatter at a freshly drawn cruising speed (`scale` × the ball's new factor –
   * the collide rule's slower ball changes from clash to clash), a new thread, a note, a wobble.
   */
  private bounce(ctx: ModeContext, ball: Ball, f: SbFighter, nx: number, ny: number, vn: number, scale: number) {
    const v = this.view;
    const now = ctx.getElapsedMs();
    const rvx = ball.vx - 2 * vn * nx;
    const rvy = ball.vy - 2 * vn * ny;
    let a = Math.atan2(rvy, rvx) + (2 * ctx.random() - 1) * SB_SCATTER;
    const inward = Math.atan2(-ny, -nx);
    let off = a - inward;
    off -= TWO_PI * Math.round(off / TWO_PI);
    const maxOff = Math.PI / 2 - SB_MIN_INCIDENCE;
    if (off > maxOff) off = maxOff;
    else if (off < -maxOff) off = -maxOff;
    a = inward + off;
    f.cruise = 1 - SB_SPEED_SPREAD + 2 * SB_SPEED_SPREAD * ctx.random();
    const out = scale * f.cruise * ctx.getPhysicsExtras().wallBounciness;
    ball.vx = Math.cos(a) * out;
    ball.vy = Math.sin(a) * out;
    const angle = Math.atan2(ny, nx);
    const ax = v.cx + nx * v.radius;
    const ay = v.cy + ny * v.radius;
    // The new thread; beyond the limit the oldest detaches (and fades where it was).
    let str: SbString | undefined;
    if (f.strings.length >= v.settings.maxStrings) {
      str = f.strings.shift()!;
      this.addGhost("fade", f.slot, str.ax, str.ay, ball.x, ball.y, str.ax, str.ay, now);
    } else str = this.spareStrings.pop();
    if (!str) str = { ax, ay, angle, bornMs: now };
    str.ax = ax;
    str.ay = ay;
    str.angle = angle;
    str.bornMs = now;
    f.strings.push(str);
    ctx.recordWallContact?.(0, angle, wobbleStrength(vn, ctx.config.ballSpeed || 400), now);
    ctx.addWallHit(0, angle, v.radius);
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: bounceFrequency(f.slot) });
    f.stats.bounces++;
    v.bounces++;
    ctx.creditBounce?.(ball);
  }

  private addGhost(kind: SbGhost["kind"], slot: number, ax: number, ay: number, bx: number, by: number, qx: number, qy: number, t0: number) {
    const v = this.view;
    if (v.ghostCount >= SB_MAX_GHOSTS) {
      // Full: the oldest goes (they are kept in time order).
      const first = v.ghosts[0];
      v.ghosts.copyWithin(0, 1, v.ghostCount);
      v.ghosts[v.ghostCount - 1] = first;
      v.ghostCount--;
    }
    let g = v.ghosts[v.ghostCount];
    if (!g) {
      g = { kind, slot, ax, ay, bx, by, qx, qy, t0 };
      v.ghosts[v.ghostCount] = g;
    } else {
      g.kind = kind;
      g.slot = slot;
      g.ax = ax;
      g.ay = ay;
      g.bx = bx;
      g.by = by;
      g.qx = qx;
      g.qy = qy;
      g.t0 = t0;
    }
    v.ghostCount++;
  }

  onPostSubStep(ctx: ModeContext) {
    const v = this.view;
    if (v.finished) return;
    const now = ctx.getElapsedMs();
    const balls = ctx.getBalls();
    // Which ball each slot has now; a slot whose ball vanished (fused by the "merge" interaction) is out of the battle.
    for (const f of v.fighters) {
      if (!f.alive) {
        this.ballOf[f.slot] = null;
        continue;
      }
      let found: Ball | null = null;
      for (let i = 0; i < balls.length; i++) {
        if (balls[i].id === f.id) {
          found = balls[i];
          break;
        }
      }
      this.ballOf[f.slot] = found;
      if (!found && !this.pending.includes(f.slot)) {
        f.lives = 0;
        this.killerOf[f.slot] = -1;
        this.pending.push(f.slot);
      }
    }
    if (v.settings.rule !== "collide") this.crossings(ctx, now);
    for (const f of v.fighters) {
      const B = this.ballOf[f.slot];
      if (!B) continue;
      f.px = B.x;
      f.py = B.y;
    }
    if (this.pending.length > 0) this.eliminate(ctx, now);
  }

  /** The cut / touch rule: every ball against every enemy thread. */
  private crossings(ctx: ModeContext, now: number) {
    const v = this.view;
    const touch = v.settings.rule === "touch";
    const invuln = SB_INVULN_MS[v.settings.rule];
    const q = this.scratch;
    for (const a of v.fighters) {
      if (!a.alive) continue;
      const A = this.ballOf[a.slot];
      if (!A) continue;
      if (touch && now - a.hurtMs < invuln) continue; // a laser-struck ball passes through lasers for a moment
      const r2 = A.radius * A.radius;
      for (const o of v.fighters) {
        if (o === a || !o.alive || o.strings.length === 0) continue;
        if (!touch && now - o.hurtMs < invuln) continue; // a shielded web cannot be cut: the next cut waits for the shield to drop
        const B = this.ballOf[o.slot];
        if (!B) continue;
        const reach = B.radius + A.radius + SB_REACH_GAP;
        let longest = -1;
        for (let k = o.strings.length - 1; k >= 0; k--) {
          const s = o.strings[k];
          if (touch ? threadDistanceSq(s.ax, s.ay, B.x, B.y, A.x, A.y, reach, q) >= r2 : !cutsThread(s.ax, s.ay, B.x, B.y, reach, a.px, a.py, A.x, A.y, q)) continue;
          const len = Math.hypot(B.x - s.ax, B.y - s.ay);
          if (len > longest) longest = len;
          this.addGhost("snap", o.slot, s.ax, s.ay, B.x, B.y, q.x, q.y, now);
          o.strings.splice(k, 1);
          this.spareStrings.push(s);
          v.cuts++;
          if (touch) break; // one laser at a time
        }
        if (longest < 0) continue;
        this.pluck(ctx, pluckFrequency(longest, v.radius));
        if (!touch) this.damage(o, a, now);
        else if (this.damage(a, o, now) || now - a.hurtMs < invuln) break; // struck: no more lasers for it this sub-step
      }
    }
  }

  private pluck(ctx: ModeContext, frequency: number) {
    if (this.plucksThisStep >= SB_MAX_PLUCKS_PER_STEP) return;
    this.plucksThisStep++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency, sbSound: "pluck" });
  }

  /** `victim` loses a life to `attacker` (null: nobody) unless it is invulnerable or the rig absorbs it. True when a life was lost. */
  private damage(victim: SbFighter, attacker: SbFighter | null, now: number): boolean {
    const v = this.view;
    if (v.finished || !victim.alive || victim.lives <= 0) return false;
    if (now - victim.hurtMs < SB_INVULN_MS[v.settings.rule]) return false;
    victim.hurtMs = now;
    if (rigAbsorbs(victim.slot, v.forcedWinner, v.fighters)) {
      v.shields++;
      return false;
    }
    victim.lives--;
    v.livesLost++;
    v.lastHurtMs = now;
    v.lastHurtSlot = victim.slot;
    if (victim.lives <= 0) {
      victim.lives = 0;
      this.killerOf[victim.slot] = attacker ? attacker.slot : -1;
      if (!this.pending.includes(victim.slot)) this.pending.push(victim.slot);
    }
    return true;
  }

  /** The balls that reached 0 lives shatter: kill credit, dissolving threads, the burst, the sound, the camera; then the verdict. */
  private eliminate(ctx: ModeContext, now: number) {
    const v = this.view;
    let removed = false;
    for (const slot of this.pending) {
      const f = v.fighters[slot];
      if (!f || !f.alive) continue;
      f.alive = false;
      f.eliminatedMs = now;
      v.alive--;
      const B = this.ballOf[slot];
      const x = B ? B.x : f.x;
      const y = B ? B.y : f.y;
      const killer = this.killerOf[slot];
      if (killer >= 0 && killer !== slot) {
        const k = v.fighters[killer];
        k.kills++;
        k.stats.walls++;
        const K = this.ballOf[killer];
        if (K) ctx.creditWallBreak?.(K);
      }
      for (const s of f.strings) {
        this.addGhost("dissolve", slot, s.ax, s.ay, x, y, s.ax, s.ay, now);
        this.spareStrings.push(s);
      }
      f.strings.length = 0;
      if (v.bursts.length >= SB_MAX_BURSTS) v.bursts.shift();
      v.bursts.push({ slot, x, y, radius: f.radius, t0: now, seed: (v.generation * 7919 + slot * 104729 + Math.round(now)) | 0 });
      if (B) removed = true;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, sbSound: "shatter" });
      ctx.noteImpact?.();
      v.impacts++;
    }
    this.pending.length = 0;
    if (removed) ctx.setBalls(ctx.getBalls().filter((b) => b.team === undefined || b.team < 0 || b.team >= v.fighters.length || v.fighters[b.team].alive || v.fighters[b.team].id !== b.id));
    if (v.alive <= 1 && !v.finished) {
      // The last one standing wins; when the last two went down together they share the verdict (then kills, bounces).
      const leaders: number[] = [];
      for (const f of v.fighters) if (f.alive) leaders.push(f.slot);
      if (leaders.length === 0) for (const f of v.fighters) if (f.eliminatedMs === now) leaders.push(f.slot);
      this.finish(ctx, leaders, now);
      // Slow motion on the final cut (the camera's near-miss hook).
      ctx.noteNearMiss?.();
      v.slowMos++;
    }
  }

  /** The battle is over: `leaders` take the win (an escape in the team stats) and the verdict is ranked like the scoreboard. */
  private finish(ctx: ModeContext, leaders: readonly number[], now: number) {
    const v = this.view;
    for (const slot of leaders) {
      const f = v.fighters[slot];
      if (!f || f.stats.escapes > 0) continue;
      f.stats.escapes = 1;
      f.stats.firstEscapeMs = now;
      ctx.creditEscape?.(this.ballOf[slot] ?? { id: f.id, team: f.slot });
    }
    v.finished = true;
    v.finishedMs = now;
    const result = teamResult(this.getTeamStats(), v.fighters.length);
    v.tie = result.tie;
    v.winner = result.tie ? -1 : result.winner;
  }

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const now = ctx.getElapsedMs();
    if (!v.finished) {
      // The clip limit: the survivors with the most lives take the verdict.
      if (v.settings.duration > 0 && now >= 1000 * v.settings.duration) {
        for (const f of v.fighters) this.ballOf[f.slot] = f.alive ? (ctx.getBalls().find((b) => b.id === f.id) ?? null) : null;
        this.finish(ctx, timeoutLeaders(v.fighters, v.forcedWinner), now);
      } else if (!v.finale) {
        let minLives = Infinity;
        for (const f of v.fighters) if (f.alive && f.lives < minLives) minLives = f.lives;
        if (finaleDue(v.alive, minLives, now, v.settings.duration)) {
          v.finale = true;
          v.finaleStartMs = now;
        }
      }
    }
    // Retire the effects that have played out (kept in time order, so from the front); their objects are reused.
    let drop = 0;
    while (drop < v.ghostCount && now - v.ghosts[drop].t0 >= ghostLifeMs(v.ghosts[drop].kind)) drop++;
    if (drop > 0) {
      const spare = this.spareGhosts;
      for (let i = 0; i < drop; i++) spare[i] = v.ghosts[i];
      v.ghosts.copyWithin(0, drop, v.ghostCount);
      v.ghostCount -= drop;
      for (let i = 0; i < drop; i++) v.ghosts[v.ghostCount + i] = spare[i];
    }
    while (v.bursts.length > 0 && now - v.bursts[0].t0 >= SB_BURST_MS) v.bursts.shift();
    let live = 0;
    for (const f of v.fighters) live += f.strings.length;
    v.liveStrings = live;
  }

  onBallCollision(ctx: ModeContext, a: Ball, b: Ball) {
    const v = this.view;
    if (v.settings.rule !== "collide" || v.finished) return;
    const fa = this.fighterOf(a);
    const fb = this.fighterOf(b);
    if (!fa || !fb || !fa.alive || !fb.alive) return;
    let loser: SbFighter;
    let winner: SbFighter;
    if (fa.preSpeed < fb.preSpeed - 1e-6) {
      loser = fa;
      winner = fb;
    } else if (fb.preSpeed < fa.preSpeed - 1e-6) {
      loser = fb;
      winner = fa;
    } else return;
    // The rig: the chosen ball wins every clash it could not afford to lose (a level one it still may).
    if (loser.slot === v.forcedWinner && rigAbsorbs(loser.slot, v.forcedWinner, v.fighters)) {
      const chosen = loser;
      loser = winner;
      winner = chosen;
    }
    const now = ctx.getElapsedMs();
    if (this.damage(loser, winner, now)) this.pluck(ctx, bounceFrequency(loser.slot) / 2);
  }

  onWallHit() {
    return undefined;
  }

  onGapPass() {
    return true;
  }

  /**
   * A resize: the ring, its anchors, the balls and the effects follow the arena, all scaled with the ring. The engine
   * stretched the balls with the canvas (x and y apart – a portrait-to-landscape turn would push them out of the ring),
   * so they are put back where they were in the ring; and a ball's previous position moves with it, so the cut rule
   * never sees the resize as a move across the arena (a slash through every thread on its way).
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    const v = this.view;
    const oldCx = v.cx;
    const oldCy = v.cy;
    const oldR = v.radius;
    v.cx = ctx.config.width / 2;
    v.cy = ctx.config.height / 2;
    v.radius = arenaRadius(ctx.config);
    const k = oldR > 0 ? v.radius / oldR : 1;
    const mx = (x: number) => v.cx + (x - oldCx) * k;
    const my = (y: number) => v.cy + (y - oldCy) * k;
    for (const f of v.fighters) {
      for (const s of f.strings) {
        s.ax = v.cx + v.radius * Math.cos(s.angle);
        s.ay = v.cy + v.radius * Math.sin(s.angle);
      }
      f.x = mx(f.x);
      f.y = my(f.y);
      f.px = mx(f.px);
      f.py = my(f.py);
    }
    // The balls: undo the engine's stretch (it scaled x by width / old width about the canvas centre, y likewise), then
    // scale with the ring (a ball keeps its size, so in a smaller ring it is kept inside) – every fighter and its previous
    // position on its ball.
    const ux = v.cx > 0 && oldCx > 0 ? oldCx / v.cx : 1;
    const uy = v.cy > 0 && oldCy > 0 ? oldCy / v.cy : 1;
    for (const b of ctx.getBalls()) {
      const f = this.fighterOf(b);
      if (!f) continue;
      b.x = mx(oldCx + (b.x - v.cx) * ux);
      b.y = my(oldCy + (b.y - v.cy) * uy);
      const dx = b.x - v.cx;
      const dy = b.y - v.cy;
      const d = Math.hypot(dx, dy);
      const limit = Math.max(0, v.radius - b.radius);
      if (d > limit) {
        b.x = v.cx + (dx / d) * limit;
        b.y = v.cy + (dy / d) * limit;
      }
      f.x = f.px = b.x;
      f.y = f.py = b.y;
    }
    for (let i = 0; i < v.ghostCount; i++) {
      const g = v.ghosts[i];
      g.ax = mx(g.ax);
      g.ay = my(g.ay);
      g.bx = mx(g.bx);
      g.by = my(g.by);
      g.qx = mx(g.qx);
      g.qy = my(g.qy);
    }
    for (const b of v.bursts) {
      b.x = mx(b.x);
      b.y = my(b.y);
    }
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
    return { alive: v.alive, count: v.count, cuts: v.cuts, livesLost: v.livesLost, winner: v.winner, finished: v.finished };
  }
}
