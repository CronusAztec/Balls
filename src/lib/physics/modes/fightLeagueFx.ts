import { shakeEnvelope } from "@/lib/simulation/camera";
import { BADGE_HEIGHT, BADGE_INSET } from "@/lib/watermark/layout";
import {
  EV_HIT,
  EV_KO,
  EV_SHOCK,
  EV_SLAM,
  EV_CAST,
  EV_HEAVY,
  FB_CLASH,
  FB_CLUTCH,
  FB_COUNT,
  FB_DOUBLE_KO,
  FB_DRAW,
  FB_FIGHT,
  FB_FINAL_KO,
  FB_FIRST_BLOOD,
  FB_KO,
  FB_PERFECT,
  FB_SUDDEN,
  FB_TIME,
  FB_VS,
  FB_WIN,
  FL_ARENA_FRAC,
  FL_ARENA_TOP,
  FL_BANNER_CAP,
  FL_EVENT_CAP,
  type FightLeagueView,
  type FlBanner,
} from "./fightLeague";
// --- fl-overhaul --- (Stage 5) the story's and the shows' banners (their names for data-fl-banners; PHASE 2 a centre banner)
import { FB_BOSS_FALLS, FB_BOSS_SURVIVES, FB_CHALLENGER, FB_CHAMPION, FB_COMEBACK, FB_FINAL, FB_FINISH, FB_GAME, FB_MATCH_POINT, FB_PHASE2, FB_QUARTER_FINAL, FB_REMATCH, FB_ROUND_OF_16, FB_SEMI_FINAL, FB_SERIES_POINT, FB_SERIES_WIN, FB_UPSET, FB_WAVE } from "./fightLeague";
// --- fl-heavy --- (Stop The World) the heavy tier's threshold lives in the roster (flHeavyAbility() needs it there); re-exported here with its siblings
import { FL_HEAVY_FRAC } from "./fightLeagueRoster";
export { FL_HEAVY_FRAC } from "./fightLeagueRoster";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's visual maths: pure functions (no DOM, no clock, no random numbers) that the mode,
 * the renderer (components/simulator/fightLeague/*) and the tests share. Every value here is a function of its arguments – the
 * renderer feeds them the view and its simulation clock, so a frame is a function of (view, view.timeMs, options):
 *
 *  - the KO finale's time warp (`flFinaleScale()` 1 → 0.25 in 80 ms, held to 800 ms, back to 1 at 1200 ms; its integral
 *    `flFinaleWarp()` maps the effects' ages; `flFinaleZoom()` the 1 → 1.12 push-in),
 *  - the mode-owned screen shake (`flShakeAt()`: decaying directional shakes summed from the event ring),
 *  - the hit feedback curves (flash, squash and stretch, impact frames, the damage numbers' pop, rise and colour tiers),
 *  - --- fl-heavy --- the heavy hits (the tiers `flHeavyShare()` measures, the hit stop's and the ink flip's lengths, the zoom
 *    punch `flHeavyZoom()`, the huge number's size `flNumberFs()` and slam `flNumberSlam()`, the lead turn's and the low-HP
 *    heartbeat's thresholds, the noir opener's length),
 *  - contrast (`flNameColor()` lightens a dark pair to 4.5:1 against the ink stroke, `bodyRimWidth()` rims a body that
 *    melts into the floor),
 *  - the HUD's layout at a square of `side` px (`flHudLayout()`: the names band, the boxes – clear of the watermark badge
 *    in a portrait export –, the readability minimums the tests check at 1080 px),
 *  - the centre banners' schedule (`flBannerSchedule()`: one at a time by priority, a lower one waits ≤ 0.5 s, then drops),
 *  - the portrait plates' placement in the 9:16 bars (`flPlateLayout()`).
 */

/* ------------------------------------------------------------------ the KO finale */

/** The finale's slow phase: eased in over this long, held to `FL_FINALE_HOLD_TO`, back to real time at `FL_FINALE_MS`. */
export const FL_FINALE_EASE_IN_MS = 80;
export const FL_FINALE_HOLD_TO_MS = 800;
/** The time scale during the hold. */
export const FL_FINALE_SLOW = 0.25;
/**
 * The KO finale: after a KO verdict the survivors, the effects and the summons run slow for this long (ms). Defined here – the
 * mode (fightLeague.ts, which re-exports it) imports this module, so a constant this module needs as it loads lives here.
 */
export const FL_FINALE_MS = 1200;
/** The finale's length in seconds (the recording's extra length). */
export const FL_FINALE_SEC = FL_FINALE_MS / 1000;
/** The winner banner (and card) appears this far into the finale. */
export const FL_FINALE_BANNER_MS = 900;

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** ∫₀ᵘ smooth (the smoothstep's integral). */
const smoothInt = (u: number) => {
  const v = Math.max(0, Math.min(1, u));
  return v * v * v - 0.5 * v * v * v * v;
};

/**
 * The finale's time scale `ms` after the verdict: 1 → 0.25 eased over 80 ms, held to 800 ms, back to 1 at `total` (1200 ms;
 * a show's interlude – Stage 5 – passes 800). 1 before and after.
 */
export function flFinaleScale(ms: number, total: number = FL_FINALE_MS): number {
  if (!(ms >= 0) || !(ms < total)) return 1;
  const holdTo = Math.min(FL_FINALE_HOLD_TO_MS, total * (2 / 3));
  if (ms < FL_FINALE_EASE_IN_MS) return 1 - (1 - FL_FINALE_SLOW) * smooth(ms / FL_FINALE_EASE_IN_MS);
  if (ms < holdTo) return FL_FINALE_SLOW;
  return FL_FINALE_SLOW + (1 - FL_FINALE_SLOW) * smooth((ms - holdTo) / Math.max(1, total - holdTo));
}

/** ∫₀^ms `flFinaleScale()`: the effect time that has passed `ms` of real time after the verdict (ms itself before and after). */
export function flFinaleWarp(ms: number, total: number = FL_FINALE_MS): number {
  if (!(ms > 0)) return ms;
  const holdTo = Math.min(FL_FINALE_HOLD_TO_MS, total * (2 / 3));
  const ease = FL_FINALE_EASE_IN_MS;
  const a = Math.min(ms, ease);
  let w = a - (1 - FL_FINALE_SLOW) * ease * smoothInt(a / ease);
  if (ms <= ease) return w;
  const b = Math.min(ms, holdTo) - ease;
  w += FL_FINALE_SLOW * b;
  if (ms <= holdTo) return w;
  const span = Math.max(1, total - holdTo);
  const c = Math.min(ms, total) - holdTo;
  w += FL_FINALE_SLOW * c + (1 - FL_FINALE_SLOW) * span * smoothInt(c / span);
  if (ms <= total) return w;
  return w + (ms - total);
}

/** The finale's push-in around the KO point: 1 → 1.12 eased out over 250 ms, held, back to 1 from 900 ms to the end. */
export function flFinaleZoom(ms: number, total: number = FL_FINALE_MS): number {
  if (!(ms >= 0) || !(ms < total)) return 1;
  const peak = 1.12;
  if (ms < 250) {
    const u = ms / 250;
    return 1 + (peak - 1) * (1 - (1 - u) * (1 - u) * (1 - u));
  }
  const back = Math.min(900, total * 0.75);
  if (ms < back) return peak;
  return peak - (peak - 1) * smooth((ms - back) / Math.max(1, total - back));
}

/**
 * The effect clock of a view at `now`: the simulation clock, except during and after a KO finale, where it runs through the
 * finale's warp (`fxNow = finishMs + ∫scale`) – sparks, damage numbers and shards play in slow motion with the survivors.
 */
export function flEffectNow(view: Pick<FightLeagueView, "finale">, now: number): number {
  const f = view.finale;
  if (!(f.from >= 0) || now <= f.from) return now;
  return f.from + flFinaleWarp(now - f.from, f.until - f.from);
}

/* ------------------------------------------------------------------ the screen shake */

/** A shake's frequency (Hz) along its direction (camera.ts' envelope, stretched to each shake's length). */
export const FL_SHAKE_HZ = 22;
/** No shake ever moves the stage further than this share of the square's side. */
export const FL_SHAKE_CLAMP = 0.02;
/**
 * The shakes: amplitude (share of the square's side) and length (ms) of a hit (≥ 10 damage, × min(1, dmg/25)), a slam, an area
 * cast, a bomb, a KO and the final KO; --- fl-heavy --- a heavy hit (EV_HEAVY, along the hit direction: "FL_SHAKES.heavy {amp
 * 0.014, ms 320} along the hit direction (e.x2, e.y2), 0.016 for aux 2") and the lethal blow (`heavyKo`).
 */
export const FL_SHAKES = {
  hit: { amp: 0.0035, ms: 220, minDamage: 10 },
  slam: { amp: 0.005, ms: 240 },
  area: { amp: 0.006, ms: 300 },
  bomb: { amp: 0.007, ms: 320 },
  ko: { amp: 0.012, ms: 380 },
  finalKo: { amp: 0.016, ms: 380 },
  heavy: { amp: 0.014, ms: 320 },
  heavyKo: { amp: 0.016, ms: 320 },
} as const;
/** The default strength of the shake setting (`flShake`). */
export const FL_SHAKE_DEFAULT = 0.6;
/** Under prefers-reduced-motion the default strength is scaled by this. */
export const FL_SHAKE_REDUCED = 0.3;

/**
 * One decaying shake `age` ms old of `len` ms and amplitude `amp` (px) along the unit direction (dx, dy): camera.ts'
 * `shakeEnvelope()` stretched to the shake's length, oscillating at `FL_SHAKE_HZ` (deterministic: no random phase).
 */
export function flShakeTerm(age: number, len: number, amp: number, dx: number, dy: number, out: { x: number; y: number }) {
  if (!(age >= 0) || age >= len || !(amp > 0)) return out;
  const env = shakeEnvelope((age * 300) / Math.max(1, len));
  const s = amp * env * Math.sin(2 * Math.PI * FL_SHAKE_HZ * (age / 1000));
  out.x += dx * s;
  out.y += dy * s;
  return out;
}

/**
 * The stage's shake at `now` (screen px for a square of `side` px): the decaying directional shakes of the event ring – a
 * hit of 10+ damage, a slam into a wall, an area cast, a bomb's burst, a KO (the final KO harder), --- fl-heavy --- a heavy
 * hit along its direction (the lethal blow harder) – summed, clamped to `FL_SHAKE_CLAMP` × side and scaled by `strength` (the
 * setting; 0 = none). Pure: the same view and clock give the same shake.
 */
export function flShakeAt(view: Pick<FightLeagueView, "events" | "eventSerial">, now: number, side: number, strength: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = 0;
  out.y = 0;
  if (!(strength > 0) || !(side > 0)) return out;
  const n = Math.min(view.eventSerial, FL_EVENT_CAP);
  for (let k = 0; k < n; k++) {
    const e = view.events[k];
    const age = now - e.t;
    if (!(age >= 0) || age >= 400) continue;
    switch (e.kind) {
      case EV_HIT: {
        if (e.value < FL_SHAKES.hit.minDamage) break;
        const amp = FL_SHAKES.hit.amp * side * Math.min(1, e.value / 25);
        flShakeTerm(age, FL_SHAKES.hit.ms, amp, e.x2, e.y2, out);
        break;
      }
      case EV_SLAM: {
        const d = Math.hypot(e.x2, e.y2) || 1;
        flShakeTerm(age, FL_SHAKES.slam.ms, FL_SHAKES.slam.amp * side, e.x2 / d, e.y2 / d, out);
        break;
      }
      case EV_SHOCK:
        // a bomb's burst (aux 1) and the shockwaves of abilities (aux 0): a vertical jolt
        if (e.aux === 1) flShakeTerm(age, FL_SHAKES.bomb.ms, FL_SHAKES.bomb.amp * side, 0, 1, out);
        else if (e.aux === 0) flShakeTerm(age, FL_SHAKES.area.ms, FL_SHAKES.area.amp * side, 0.6, 0.8, out);
        break;
      case EV_CAST:
        // an area ability's cast (aux 1: its telegraph threatened an area)
        if (e.aux === 1) flShakeTerm(age, FL_SHAKES.area.ms, 0.5 * FL_SHAKES.area.amp * side, 0.8, 0.6, out);
        break;
      case EV_KO: {
        const d = Math.hypot(e.x2, e.y2);
        const dx = d > 1e-6 ? e.x2 / d : 0;
        const dy = d > 1e-6 ? e.y2 / d : 1;
        const s = e.aux === 1 ? FL_SHAKES.finalKo : FL_SHAKES.ko;
        flShakeTerm(age, s.ms, s.amp * side, dx, dy, out);
        break;
      }
      case EV_HEAVY: {
        // --- fl-heavy --- a heavy hit: along the hit direction (x2, y2: a unit vector), the lethal blow (aux 2) harder
        const d = Math.hypot(e.x2, e.y2);
        const dx = d > 1e-6 ? e.x2 / d : 0;
        const dy = d > 1e-6 ? e.y2 / d : 1;
        const s = e.aux === 2 ? FL_SHAKES.heavyKo : FL_SHAKES.heavy;
        flShakeTerm(age, s.ms, s.amp * side, dx, dy, out);
        break;
      }
      default:
        break;
    }
  }
  const max = FL_SHAKE_CLAMP * side;
  const m = Math.hypot(out.x, out.y);
  if (m > max) {
    out.x *= max / m;
    out.y *= max / m;
  }
  out.x *= strength;
  out.y *= strength;
  return out;
}

/** The shake's strength for the setting `shake` (× 0.3 under reduced motion while it is at its default; 0 while the camera's own Screen Shake is on). */
export function flShakeStrength(shake: number, reducedMotion: boolean, cameraShakeOn: boolean): number {
  if (cameraShakeOn) return 0;
  const s = Number.isFinite(shake) ? Math.max(0, shake) : FL_SHAKE_DEFAULT;
  return reducedMotion && Math.abs(s - FL_SHAKE_DEFAULT) < 1e-9 ? s * FL_SHAKE_REDUCED : s;
}

/* ------------------------------------------------------------------ hit feedback */

/** The body flash: the white silhouette 0–70 ms, then a 40 % accent tint to 150 ms. */
export const FL_FLASH_WHITE_MS = 70;
export const FL_FLASH_TINT_MS = 150;
/** Squash and stretch along the hit's direction: k from 1 to 0 over this long. */
export const FL_SQUASH_MS = 150;

/** The squash's strength `age` ms after a hit (1 → 0, eased). Along the hit: 1 + 0.18 k; across it: 1 − 0.12 k. */
export function flSquashK(age: number): number {
  if (!(age >= 0) || age >= FL_SQUASH_MS) return 0;
  const u = 1 - age / FL_SQUASH_MS;
  return u * u;
}

/** Impact frames (visual hit-stop): the hold (50 ms, 80 ms for a giant or ability hit) and the catch-up after it. */
export const FL_IMPACT_HOLD_MS = 50;
export const FL_IMPACT_HOLD_HEAVY_MS = 80;
export const FL_IMPACT_CATCH_MS = 60;
/** A hit of at least this much damage (or a giant or ability hit) holds its fighters; at most one impact a fighter per FL_IMPACT_GAP_MS. */
export const FL_IMPACT_DAMAGE = 12;
export const FL_IMPACT_GAP_MS = 400;

/**
 * How far a fighter held by an impact has caught up with where it really is, `age` ms after the impact: 0 through the hold
 * (drawn where it was hit), then 0 → 1 over `FL_IMPACT_CATCH_MS`, 1 after (and before).
 */
export function flImpactBlend(age: number, heavy: boolean): number {
  if (!(age >= 0)) return 1;
  const hold = heavy ? FL_IMPACT_HOLD_HEAVY_MS : FL_IMPACT_HOLD_MS;
  if (age < hold) return 0;
  return Math.min(1, (age - hold) / FL_IMPACT_CATCH_MS);
}

/** A damage number lives this long, rising 0.9 arena units; it pops 1.35 → 1 over its first 90 ms. */
export const FL_NUMBER_MS = 750;
export const FL_NUMBER_POP_MS = 90;
export const FL_NUMBER_RISE = 0.9;

/** A damage number's scale `age` ms after it appeared (1.35 → 1 over 90 ms). */
export function flNumberPop(age: number): number {
  if (!(age >= 0)) return 1.35;
  if (age >= FL_NUMBER_POP_MS) return 1;
  return 1.35 - 0.35 * smooth(age / FL_NUMBER_POP_MS);
}

/** The colour tier of a damage number: under 6 white, 6–12 yellow, 12–20 orange, 20 and up red. */
export function flDamageColor(value: number): string {
  if (value >= 20) return "#ef4444";
  if (value >= 12) return "#fb923c";
  if (value >= 6) return "#fde047";
  return "#ffffff";
}
/** The colours of a giant hit, a heal or drain, and damage reflected back on its attacker. */
export const FL_GIANT_COLOR = "#facc15";
export const FL_HEAL_COLOR = "#4ade80";
export const FL_REFLECT_COLOR = "#a78bfa";

/** Damage events on the same target from the same attacker within this long add into one number (one '-15' a shotgun volley). */
export const FL_DAMAGE_MERGE_MS = 150;

/** Combos: 3+ hits by one attacker on the same foe, each within 1.2 s of the last, none taken in between. */
export const FL_COMBO_MS = 1200;
export const FL_COMBO_MIN = 3;

/* ------------------------------------------------------------------ --- fl-heavy --- (Stop The World) heavy hits */

/*
 * The spec: "A phone viewer with the sound off judges a fight by one thing: does the big hit feel big." A heavy hit (a share
 * of the foe's maximum HP: `FL_HEAVY_FRAC`, re-exported above from the roster) stops the world: the page camera dips to
 * `FL_HITSTOP_FACTOR` for `FL_HITSTOP_MS` (`FL_HITSTOP_KO_MS` on the lethal blow), the arena washes white, noir flips to ink
 * on the KO blow, the bodies punch in (`flHeavyZoom()`), the stage shakes along the hit (FL_SHAKES.heavy) and the number is
 * huge and slammed (`flNumberFs()`, `flNumberSlam()`). Everything here is pure maths over (event, clock); the mode pushes the
 * EV_HEAVY and EV_TURN events, the renderer draws them, no rule reads any of it.
 */

/** A hit of this share of the target's maximum HP or more is CRITICAL (EV_HEAVY aux 1): "1 critical (>= 0.40 x maxHp)". */
export const FL_CRIT_FRAC = 0.4;
/**
 * The hit stop: "the page camera dips to factor 0.05 for FL_HITSTOP_MS 90 real ms (aux 0 and 1) or FL_HITSTOP_KO_MS 150 (aux
 * 2)" – a freeze, not a judder (about 26 ms of simulation pass inside the 90, about 44 inside the 150). Wall-clock, page side
 * only (cam.dip): never in headless tests, never in the fixed 60 Hz steps.
 */
export const FL_HITSTOP_MS = 90;
export const FL_HITSTOP_KO_MS = 150;
export const FL_HITSTOP_FACTOR = 0.05;
/** The white wash under a heavy hit: "the arena shape fills white at alpha 0.55 x (1 - t)^2 over FL_HEAVY_FLASH_MS 90 (effects clock)". */
export const FL_HEAVY_FLASH_MS = 90;
/** The noir ink flip on the lethal blow: "the arena fills #ffffff, the rim is stroked INK ... for FL_KO_FLIP_MS 100 real ms". */
export const FL_KO_FLIP_MS = 100;
/**
 * The zoom punch about the impact point: "1 + (lethal ? 0.10 : 0.07) x (1 - smoothstep(age / 400)) larger" – the bodies and
 * effects inside the arena clip only; the plate, the clip, the shake and the HUD stay still.
 */
export const FL_HEAVY_ZOOM = 0.07;
export const FL_HEAVY_ZOOM_KO = 0.1;
export const FL_HEAVY_ZOOM_MS = 400;
/**
 * The huge number: 2.4 x the base (72 px on screen at the 1080 square: the noir arena is 0.6 of the square, so the spec's 1.9
 * read 30 % smaller than the reference reels), "rising only 0.5 unit over FL_NUMBER_HEAVY_MS 1400 (the plain tier keeps 750 ms
 * and 0.9 unit)".
 */
export const FL_NUMBER_HEAVY_MS = 1400;
export const FL_NUMBER_HEAVY_SCALE = 2.4;
export const FL_NUMBER_HEAVY_RISE = 0.5;
/**
 * The lead turn (EV_TURN): "the lead changes sides on a hit of >= FL_TURN_FRAC 0.15 x target.maxHp or a heavy blow", "at most
 * once per FL_TURN_GAP_MS 2500 per attacker".
 */
export const FL_TURN_FRAC = 0.15;
export const FL_TURN_GAP_MS = 2500;
/** The low-HP heartbeat (noir, from view state, no event): "any alive fighter under 25 percent HP wears a heartbeat". */
export const FL_HEARTBEAT_FRAC = 0.25;
/** The noir opener: the discs slide in from outside the arena "easing in over 0 to FL_OPENER_MS 450 (easeOutCubic)", arriving on the first tick cue. */
export const FL_OPENER_MS = 450;

/** The share of the target's maximum HP a hit of `value` took (the heavy tiers compare it with FL_HEAVY_FRAC and FL_CRIT_FRAC). */
export function flHeavyShare(value: number, maxHp: number): number {
  return value / Math.max(1e-9, maxHp);
}

/**
 * The zoom punch `age` ms (effects clock) after a heavy hit: 1 + 0.07 (0.10 for the lethal blow) × (1 − smoothstep(age / 400)),
 * 1 outside [0, FL_HEAVY_ZOOM_MS). Held at its peak on the frozen frame (the effects clock nearly stops during the dip), easing
 * out after release. Separate from `flFinaleZoom()`, which stays 1 outside the finale.
 */
export function flHeavyZoom(age: number, lethal: boolean): number {
  if (!(age >= 0) || age >= FL_HEAVY_ZOOM_MS) return 1;
  return 1 + (lethal ? FL_HEAVY_ZOOM_KO : FL_HEAVY_ZOOM) * (1 - smooth(age / FL_HEAVY_ZOOM_MS));
}

/**
 * A huge number's slam `age` ms after it appeared: "2.6 at 0 to 0.94 at 70 ms to 1 at 140 ms (smoothstepped)", 1 after (the
 * plain tier keeps `flNumberPop()`).
 */
export function flNumberSlam(age: number): number {
  if (!(age >= 0)) return 2.6;
  if (age < 70) return 2.6 - (2.6 - 0.94) * smooth(age / 70);
  if (age < 140) return 0.94 + (1 - 0.94) * smooth((age - 70) / 70);
  return 1;
}

/**
 * A damage number's font size (px) for a hit of `value` on a fighter of `maxHp`: the base max(0.6 unit, 0.028 × the square's
 * side ÷ `dk`) divided by `noirK` (so noir matches the other stages: 30.2 px at the 1080 square instead of 24.5), × 1.9 for
 * the heavy tier (`flHeavyShare()` ≥ FL_HEAVY_FRAC) or × 0.85 + 0.35 × min(1, value / 25) for the plain one, never under 10.
 */
export function flNumberFs(value: number, maxHp: number, unit: number, sqSide: number, dk: number, noirK: number): number {
  const base = Math.max(0.6 * unit, (0.028 * sqSide) / (dk > 0 ? dk : 1)) / (noirK > 0 ? noirK : 1);
  const scale = flHeavyShare(value, maxHp) >= FL_HEAVY_FRAC ? FL_NUMBER_HEAVY_SCALE : 0.85 + 0.35 * Math.min(1, value / 25);
  return Math.max(10, base * scale);
}

/* ------------------------------------------------------------------ trails */

/**
 * The point `k` steps back (0: the newest) of a trail ring of `len` points (x, y interleaved), written once per 60 Hz step;
 * false when the ring holds fewer points.
 */
export function flTrailPoint(ring: Float32Array, head: number, count: number, k: number, out: { x: number; y: number }): boolean {
  const len = ring.length >> 1;
  if (k < 0 || k >= count || len === 0) return false;
  const i = (((head - 1 - k) % len) + len) % len;
  out.x = ring[2 * i];
  out.y = ring[2 * i + 1];
  return true;
}

/** Writes (x, y) into a trail ring at `head`; returns the next head (the count is the caller's: min(count + 1, len)). */
export function flTrailWrite(ring: Float32Array, head: number, x: number, y: number): number {
  const len = ring.length >> 1;
  ring[2 * head] = x;
  ring[2 * head + 1] = y;
  return (head + 1) % len;
}

/** A fighter draws its knockback ribbon above this many times its cruise (and 3 speed lines above `FL_SPEED_LINES_AT`). */
export const FL_TRAIL_AT = 1.35;
export const FL_SPEED_LINES_AT = 2;
/** A fighter this fast (its speed stat) always keeps a faint trail. */
export const FL_FAST_STAT = 1.5;

/* ------------------------------------------------------------------ colour and contrast */

/** The ink of the strokes and outlines; the arena's white floor. */
export const FL_INK = "#0b0b0f";
export const FL_FLOOR = "#ffffff";

/** "#rrggbb" → [r, g, b] (anything else: white). */
export function flHexRgb(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (WCAG) of "#rrggbb" (anything else: white). */
export function flLuminance(color: string): number {
  const c = flHexRgb(color).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio of two colours (1–21). */
export function flContrast(a: string, b: string): number {
  const la = flLuminance(a);
  const lb = flLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** "#rrggbb" mixed `k` (0–1) of the way toward white. */
export function flLighten(color: string, k: number): string {
  const [r, g, b] = flHexRgb(color);
  const mix = (v: number) => Math.round(v + (255 - v) * Math.max(0, Math.min(1, k)));
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(mix(r))}${hex(mix(g))}${hex(mix(b))}`;
}

/** A name stays readable on its ink stroke from this contrast up. */
export const FL_NAME_CONTRAST = 4.5;
/** A body melts into the floor below this contrast: it gets an ink rim. */
export const FL_BODY_CONTRAST = 1.5;

/**
 * The colour a fighter's name is written in (the HUD, the VS and winner cards, the tags): its body colour – its accent when
 * that reads better – lightened toward white until it holds `FL_NAME_CONTRAST` against the ink stroke around the letters.
 */
export function flNameColor(body: string, accent: string): string {
  const okBody = /^#[0-9a-f]{6}$/i.test(body);
  const okAccent = /^#[0-9a-f]{6}$/i.test(accent);
  if (!okBody && !okAccent) return "#f4f4f5";
  let pick = okBody ? body : accent;
  if (okBody && okAccent && flContrast(body, FL_INK) < FL_NAME_CONTRAST && flContrast(accent, FL_INK) > flContrast(body, FL_INK)) pick = accent;
  if (flContrast(pick, FL_INK) >= FL_NAME_CONTRAST) return pick;
  for (let k = 0.05; k <= 1.0001; k += 0.05) {
    const c = flLighten(pick, k);
    if (flContrast(c, FL_INK) >= FL_NAME_CONTRAST) return c;
  }
  return "#ffffff";
}

/** The ink rim of a body (in its radii): 0.12 R when the body is under `FL_BODY_CONTRAST` against the floor, else the plain outline. */
export function bodyRimWidth(row: { body: string }, floor: string = FL_FLOOR): number {
  return flContrast(row.body, floor) < FL_BODY_CONTRAST ? 0.12 : 0.07;
}

/* ------------------------------------------------------------------ the HUD's layout (screen px of a square `side`) */

/** Slots a renderer keeps per-slot state for (the HP bars' ghosts …): more than any match type has. */
export const FL_MAX_SLOTS = 8;

/** A rectangle (px, square-local: 0 at the square's top-left). */
export interface FlRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One ability box and its rows (square-local px). */
export interface FlBoxLayout {
  box: FlRect;
  /** The ability's name row, the meter, the stat lines (one in a compact box). */
  name: FlRect;
  meter: FlRect;
  stats: FlRect[];
  /** The mini portrait (a ball with its weapon) in the box's corner. */
  portrait: FlRect;
  compact: boolean;
  nameFs: number;
  statFs: number;
  /**
   * --- fl-overhaul --- (fl-overhaul fix) The cells a stat rect holds side by side: 2 (damage | speed …) or 1 – a slim box of a
   * two-row layout stacks its compact pair in a column of single cells.
   */
  statCells: 1 | 2;
  /** The smallest size its ability name may be drawn at (px: the readability floor, FL_BOX_NAME_MIN of the side). */
  nameMin: number;
  /** The box's row and column in the boxes' grid. */
  row: number;
  col: number;
}

/** The HUD's sizes for a square of `side` px with `n` fighters (`portrait`: a 9:16 export – the right 10 % stays free of text). */
export interface FlHudLayout {
  side: number;
  /** The names band's height and the arena's square (display px, square-local). */
  band: number;
  arena: FlRect;
  /** The right edge of text (0.965 S, or 0.88 S in a portrait export). */
  right: number;
  left: number;
  /** Names (1v1: big, ≥ 3 fighters: stacked), the HP bar under a name, the source line, the timer and the lead bar. */
  nameFs: number;
  /**
   * --- low-findings-2 --- The smallest a fighter's name in the band may be drawn (px: the readability floor, `FL_NAME_MIN` or
   * `FL_NAME_MIN_STACKED` of the side): a long name is fitted down to it, then condensed, then ellipsised (`flFitBoxName()`).
   */
  nameMin: number;
  nameRowH: number;
  /** The names' centre lines (1v1: one; stacked: two rows a side), the HP bars' tops, the source line's centre. */
  nameY: number[];
  hpBarY: number[];
  /** --- fl-overhaul --- (Stage 5) A 3v3's HP bars sit beside their names (three rows a side), not under them. */
  inlineBars?: boolean;
  sourceY: number;
  hpBarH: number;
  hpBarW: number;
  sourceFs: number;
  timerFs: number;
  /** The centre column: the small VS's centre, the timer pill's centre and height. */
  vsY: number;
  pillY: number;
  pillH: number;
  leadBar: FlRect;
  vsFs: number;
  /** The centre banners, the damage numbers (arena unit `unit`), the ball's HP number, the name tags. */
  bannerFs: number;
  unit: number;
  ballR: number;
  ballHpFs: number;
  damageFs: number;
  tagFs: number;
  boxes: FlBoxLayout[];
  boxesTop: number;
  boxesBottom: number;
  /** --- fl-overhaul --- (fl-overhaul fix) The boxes' rows: 1 (a duel, a free-for-all of 3) or 2 (four and six fighters). */
  boxRows: number;
}

/**
 * Whether `match` keeps the full ability boxes (all four stats: two lines of two): the duel and the 2v2; the free-for-alls
 * and the 3v3 use compact ones (damage and one more).
 */
export function flFullBoxes(match: string, n: number): boolean {
  // (--- fl-overhaul --- Stage 5: a 3v3's six boxes are compact – one stat pair each, like the free-for-alls')
  return n <= 2 || match === "2v2";
}

/**
 * --- low-findings-2 --- The readability floors of the names band (share of the square's side; at 1080 px: 54 px in a duel, 30 px
 * stacked): a fighter's name is never drawn under them.
 */
export const FL_NAME_MIN = 0.05;
export const FL_NAME_MIN_STACKED = 0.0278;

/** The readability floors of the HUD (share of the square's side; at 1080 px: 26 px box names, 20 px stat lines). */
export const FL_BOX_NAME_MIN = 0.0245;
export const FL_BOX_STAT_MIN = 0.0186;
/**
 * --- fl-overhaul --- (fl-overhaul fix) The narrowest a box's ability name is condensed (its width only – the letters keep
 * their height): a name still too wide at the floor's size and this squeeze is ellipsised (`flFitBoxName()`).
 */
export const FL_BOX_NAME_SQUEEZE = 0.75;
/** A slim box's stat cell (one glyph and '×1.00' in mono) in stat font sizes. */
export const FL_STAT_CELL_EM = 4.2;

/** Where slot `slot`'s ability box sits in a grid of `rows` rows of `perRow` boxes (the names band's order, mirrored). */
export function flBoxCell(match: string, slot: number, rows: number, perRow: number): { row: number; col: number } {
  if (rows < 2) return { row: 0, col: slot };
  // a 2v2: each team a column (A over B on the left, C over D on the right), as its names band stacks them
  if (match === "2v2") return { row: slot % 2, col: slot < 2 ? 0 : 1 };
  // a 3v3: each team a row (A B C over D E F); a free-for-all of 4: the corners its names band puts them in
  return { row: Math.floor(slot / perRow), col: slot % perRow };
}

/** How an ability name is drawn in its box: the text (the name, or its ellipsised start), its size and horizontal squeeze. */
export interface FlNameFit {
  text: string;
  size: number;
  /** The horizontal scale (1: as set; never under FL_BOX_NAME_SQUEEZE unless even one letter and the ellipsis do not fit). */
  squeeze: number;
  /** Whether the name was cut (ellipsised). */
  cut: boolean;
}

/**
 * --- fl-overhaul --- (fl-overhaul fix) Fits an ability name into a box's name column of `maxWidth` px WITHOUT drawing it
 * under the readability floor `minSize`: at `size` when it fits; else smaller, down to `minSize`; else at `minSize`, condensed
 * horizontally down to `minSqueeze` (the letters keep their height); else its longest start that fits that way, ellipsised
 * ('Super Mega Death…' – at a word's end when that costs at most three letters). `measure(text, size)` is the text's width.
 */
export function flFitBoxName(name: string, size: number, minSize: number, maxWidth: number, measure: (text: string, size: number) => number, minSqueeze: number = FL_BOX_NAME_SQUEEZE): FlNameFit {
  const floor = Math.min(minSize, size);
  const room = Math.max(1, maxWidth);
  let w = measure(name, size);
  if (w <= room) return { text: name, size, squeeze: 1, cut: false };
  const fs = Math.max(floor, (size * room) / w);
  w = measure(name, fs);
  let squeeze = Math.min(1, room / Math.max(1e-9, w));
  if (squeeze >= minSqueeze) return { text: name, size: fs, squeeze, cut: false };
  // the longest start that fits condensed (at most `minSqueeze`), at the floor
  let text = "";
  for (let n = name.length - 1; n >= 1; n--) {
    let start = name.slice(0, n).replace(/[\s,.:;!?/&+–—-]+$/u, "");
    if (start.length === 0) continue;
    const space = name.lastIndexOf(" ", n);
    if (space > 0 && n - space <= 3) {
      const word = name.slice(0, space).replace(/[\s,.:;!?/&+–—-]+$/u, "");
      if (word.length > 0) start = word;
    }
    const candidate = `${start}…`;
    w = measure(candidate, fs);
    text = candidate;
    squeeze = Math.min(1, room / Math.max(1e-9, w));
    if (squeeze >= minSqueeze) break;
  }
  if (text === "") {
    text = name;
    squeeze = Math.min(1, room / Math.max(1e-9, measure(name, fs)));
  }
  return { text, size: fs, squeeze, cut: text !== name };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The HUD's layout for a square of `side` px: the names band (FL_ARENA_TOP: the names, an HP bar under each, the source
 * line, the lead bar), the arena (FL_ARENA_FRAC), the ability boxes under it – ending a badge's height and inset (and a
 * hair) above the square's bottom, so the watermark badge of a portrait export (bottom corners, BADGE_INSET from the edge)
 * never covers a meter or a stat line – and the font sizes the tests hold to the readability minimums at 1080 px.
 * `ballRadius` is a size-1 fighter's radius in display px (the HP number inside it).
 *
 * --- fl-overhaul --- (fl-overhaul fix) The boxes take one row for two and three fighters and two rows for four and six
 * (`flBoxCell()`: a 2v2's teams in columns, a 3v3's in rows, a free-for-all's corners) – slim boxes whose name runs the box's
 * width beside the portrait, the meter under it and the stats stacked at the right edge (a 2v2's four in two lines of two,
 * a compact pair in one column), so a long ability name keeps its readable size (`flFitBoxName()`).
 */
export function flHudLayout(side: number, n: number, match: string, portrait: boolean, ballRadius: number): FlHudLayout {
  const S = Math.max(1, side);
  const band = FL_ARENA_TOP * S;
  const arena: FlRect = { x: (0.5 - FL_ARENA_FRAC / 2) * S, y: band, w: FL_ARENA_FRAC * S, h: FL_ARENA_FRAC * S };
  const left = 0.035 * S;
  const right = (portrait ? 0.88 : 0.965) * S;
  const stacked = n > 2;
  // --- fl-overhaul --- (Stage 5) a 3v3: three rows a side (A B C left, D E F right), each name with its HP bar beside it
  const trio = match === "3v3";
  const nameFs = (stacked ? 0.028 : 0.052) * S;
  const unit = 0.065 * arena.w;
  // the band, top down (1v1): name 0.024 S, HP bar 0.047–0.059 S, source 0.068 S, lead bar 0.077–0.089 S, the rim from 0.091 S
  const nameY = trio ? [0.016 * S, 0.044 * S, 0.072 * S] : stacked ? [0.017 * S, 0.052 * S] : [0.024 * S];
  const hpBarH = (trio ? 0.008 : stacked ? 0.006 : 0.012) * S;
  const hpBarY = trio ? nameY.map((y) => y - 0.004 * S) : stacked ? [0.032 * S, 0.067 * S] : [0.047 * S];
  const boxesTop = (FL_ARENA_TOP + FL_ARENA_FRAC) * S + 0.002 * S;
  // the boxes end a badge's height and inset (and a hair) above the square's bottom
  const boxesBottom = S * (1 - BADGE_INSET - BADGE_HEIGHT) - 0.002 * S;
  const full = flFullBoxes(match, n);
  const rows = n >= 4 ? 2 : 1;
  const perRow = Math.max(1, Math.ceil(n / rows));
  const gap = (rows > 1 ? 0.01 : 0.014) * S;
  const bandH = boxesBottom - boxesTop;
  const nameMin = FL_BOX_NAME_MIN * S;
  const boxes: FlBoxLayout[] = [];
  if (rows > 1) {
    // --- fl-overhaul --- (fl-overhaul fix) two rows of slim boxes: [portrait] [the name over the meter] [the stats]
    const rowGap = 0.003 * S;
    const h = (bandH - rowGap) / 2;
    const w = (right - left - (perRow - 1) * gap) / perRow;
    const pad = 0.004 * S;
    const nameFsBox = clamp(0.62 * h, nameMin, 0.028 * S);
    const statFs = Math.max(FL_BOX_STAT_MIN * S, Math.min(0.021 * S, 0.49 * h));
    const meterH = Math.max(3, 0.0065 * S);
    const nameGap = 0.001 * S;
    const portraitSide = Math.max(1, Math.min(h - 0.006 * S, 0.046 * S, 0.3 * w));
    const statCells: 1 | 2 = full ? 2 : 1;
    const statW = statCells * FL_STAT_CELL_EM * statFs;
    for (let i = 0; i < n; i++) {
      const { row, col } = flBoxCell(match, i, rows, perRow);
      const x = left + col * (w + gap);
      const y = boxesTop + row * (h + rowGap);
      const portraitRect: FlRect = { x: x + pad, y: y + (h - portraitSide) / 2, w: portraitSide, h: portraitSide };
      const tx = portraitRect.x + portraitSide + pad;
      const sx = x + w - pad - statW;
      const tw = Math.max(1, sx - pad - tx);
      const top = y + Math.max(0, (h - (nameFsBox + nameGap + meterH)) / 2);
      const name: FlRect = { x: tx, y: top, w: tw, h: nameFsBox };
      const meter: FlRect = { x: tx, y: top + nameFsBox + nameGap, w: tw, h: meterH };
      const sy = y + Math.max(0, (h - 2 * statFs) / 2);
      const stats: FlRect[] = [
        { x: sx, y: sy, w: statW, h: statFs },
        { x: sx, y: sy + statFs, w: statW, h: statFs },
      ];
      boxes[i] = { box: { x, y, w, h }, name, meter, stats, portrait: portraitRect, compact: !full, nameFs: nameFsBox, statFs, statCells, nameMin, row, col };
    }
  } else {
    // one row (two or three fighters): the full boxes (a duel: two stat lines) or the compact ones (one)
    const h = bandH;
    const w = (right - left - (perRow - 1) * gap) / perRow;
    for (let i = 0; i < n; i++) {
      const x = left + i * (w + gap);
      const y = boxesTop;
      const pad = 0.004 * S;
      const nameFsBox = full ? clamp(0.32 * h, FL_BOX_NAME_MIN * S, 0.028 * S) : clamp(0.36 * h, FL_BOX_NAME_MIN * S, 0.03 * S);
      const statFs = full ? clamp(0.235 * h, FL_BOX_STAT_MIN * S, 0.021 * S) : clamp(0.28 * h, FL_BOX_STAT_MIN * S, 0.022 * S);
      const meterH = Math.max(3, 0.0065 * S);
      const portraitSide = Math.min(h - 2 * pad, (full ? 0.062 : 0.046) * S, 0.3 * w);
      const portraitRect: FlRect = { x: x + pad, y: y + (h - portraitSide) / 2, w: portraitSide, h: portraitSide };
      const tx = portraitRect.x + portraitSide + pad;
      const tw = Math.max(1, x + w - pad - tx);
      let cy = y + 0.003 * S;
      const name: FlRect = { x: tx, y: cy, w: tw, h: nameFsBox };
      cy += nameFsBox + 0.0015 * S;
      const meter: FlRect = { x: tx, y: cy, w: tw, h: meterH };
      cy += meterH + 0.0015 * S;
      const stats: FlRect[] = [{ x: tx, y: cy, w: tw, h: statFs }];
      if (full) stats.push({ x: tx, y: cy + statFs + 0.0005 * S, w: tw, h: statFs });
      boxes.push({ box: { x, y, w, h }, name, meter, stats, portrait: portraitRect, compact: !full, nameFs: nameFsBox, statFs, statCells: 2, nameMin, row: 0, col: i });
    }
  }
  return {
    side: S,
    band,
    arena,
    right,
    left,
    nameFs,
    nameMin: Math.min(nameFs, (stacked ? FL_NAME_MIN_STACKED : FL_NAME_MIN) * S), // --- low-findings-2 ---
    nameRowH: stacked ? 0.035 * S : band,
    nameY,
    hpBarY,
    sourceY: 0.068 * S,
    hpBarH,
    hpBarW: (trio ? 0.1 : stacked ? 0.2 : 0.34) * S,
    inlineBars: trio,
    sourceFs: 0.018 * S,
    timerFs: 0.026 * S,
    vsY: 0.022 * S,
    pillY: stacked ? 0.042 * S : 0.058 * S,
    pillH: 0.032 * S,
    leadBar: trio ? { x: left, y: 0.0895 * S, w: right - left, h: 0.007 * S } : { x: left, y: 0.077 * S, w: right - left, h: 0.012 * S },
    vsFs: 0.026 * S,
    bannerFs: 0.085 * S,
    unit,
    ballR: ballRadius,
    ballHpFs: Math.max(0.8 * ballRadius, (34 / 1080) * S),
    damageFs: Math.max(0.6 * unit, 0.028 * S),
    tagFs: Math.max(0.45 * ballRadius, 0.021 * S),
    boxes,
    boxesTop,
    boxesBottom: boxes.length > 0 ? Math.max(...boxes.map((b) => b.box.y + b.box.h)) : boxesTop,
    boxRows: n > 0 ? rows : 0,
  };
}

/** A box's last pixel row (square-local): its meter and stat lines all end above this. */
export function flBoxContentBottom(b: FlBoxLayout): number {
  let bottom = b.meter.y + b.meter.h;
  for (const s of b.stats) bottom = Math.max(bottom, s.y + s.h);
  return bottom;
}

/* ------------------------------------------------------------------ banners */

/**
 * The banners' names (data-fl-banners) by their kind's code (a switch, read when called: the codes come from the mode, which
 * imports this module – a table built as it loads would see them undefined).
 */
export function flBannerName(kind: number): string | null {
  switch (kind) {
    case FB_VS:
      return "vs";
    case FB_COUNT:
      return "count";
    case FB_FIGHT:
      return "fight";
    case FB_FIRST_BLOOD:
      return "firstBlood";
    case FB_KO:
      return "ko";
    case FB_FINAL_KO:
      return "finalKo";
    case FB_DOUBLE_KO:
      return "doubleKo";
    case FB_DRAW:
      return "draw";
    case FB_TIME:
      return "time";
    case FB_WIN:
      return "win";
    case FB_PERFECT:
      return "perfect";
    case FB_CLUTCH:
      return "clutch";
    case FB_SUDDEN:
      return "suddenDeath";
    case FB_CLASH:
      return "clash";
    // --- fl-overhaul --- (Stage 5)
    case FB_UPSET:
      return "upset";
    case FB_COMEBACK:
      return "comeback";
    case FB_FINISH:
      return "finish";
    case FB_GAME:
      return "game";
    case FB_SERIES_POINT:
      return "seriesPoint";
    case FB_SERIES_WIN:
      return "seriesWin";
    case FB_REMATCH:
      return "rematch";
    case FB_MATCH_POINT:
      return "decider";
    case FB_ROUND_OF_16:
      return "roundOf16";
    case FB_QUARTER_FINAL:
      return "quarterFinal";
    case FB_SEMI_FINAL:
      return "semiFinal";
    case FB_FINAL:
      return "final";
    case FB_CHAMPION:
      return "champion";
    case FB_BOSS_FALLS:
      return "bossFalls";
    case FB_BOSS_SURVIVES:
      return "bossSurvives";
    case FB_PHASE2:
      return "phase2";
    case FB_WAVE:
      return "wave";
    case FB_CHALLENGER:
      return "challenger";
    default:
      return null;
  }
}

/** The centre banners' priority (higher wins): the finale's, the verdicts', a KO, first blood, the rest. 0: not a centre banner. */
export function flBannerPriority(kind: number): number {
  switch (kind) {
    case FB_FINAL_KO:
      return 5;
    case FB_DOUBLE_KO:
    case FB_DRAW:
    case FB_TIME:
    case FB_WIN:
      return 4;
    case FB_KO:
      return 3;
    case FB_FIRST_BLOOD:
    case FB_PHASE2: // --- fl-overhaul --- (Stage 5) a boss at half its HP, mid-fight
      return 2;
    case FB_SUDDEN:
      return 1;
    default:
      return 0; // the VS card's own (vs, count, fight), the winner card's tags (perfect, clutch) and the side callouts (clash)
  }
}

/** How long a centre banner plays (ms). */
export function flBannerMs(kind: number): number {
  switch (kind) {
    case FB_FIRST_BLOOD:
      return 900;
    case FB_KO:
      return 800;
    case FB_FINAL_KO:
      return FL_FINALE_BANNER_MS;
    case FB_SUDDEN:
      return 1600;
    case FB_PHASE2: // --- fl-overhaul --- (Stage 5)
      return 1200;
    case FB_DOUBLE_KO:
    case FB_DRAW:
    case FB_TIME:
    case FB_WIN:
      return 1e9; // the verdict holds to the end screen
    default:
      return 0;
  }
}

/** A lower banner waits at most this long behind a higher one, then drops. */
export const FL_BANNER_WAIT_MS = 500;

/** The banner the centre shows at `now`: its ring index, when it started showing and its kind (index −1: none). */
export interface FlBannerPick {
  index: number;
  start: number;
  kind: number;
}

/**
 * Which centre banner plays at `now` – one at a time: banners are taken in the ring's order; one whose start falls while a
 * higher-priority banner plays waits for it (at most `FL_BANNER_WAIT_MS`, then it is dropped); a higher one cuts a lower
 * one short. Pure over the ring (no state): the same view and clock pick the same banner.
 */
export function flBannerSchedule(view: Pick<FightLeagueView, "banners" | "bannerSerial">, now: number, out: FlBannerPick): FlBannerPick {
  out.index = -1;
  out.start = 0;
  out.kind = 0;
  const first = Math.max(0, view.bannerSerial - FL_BANNER_CAP);
  let curIdx = -1;
  let curStart = 0;
  let curEnd = -Infinity;
  let curPri = 0;
  for (let s = first; s < view.bannerSerial; s++) {
    const b: FlBanner = view.banners[s % FL_BANNER_CAP];
    const pri = flBannerPriority(b.kind);
    if (pri <= 0 || b.t > now) continue;
    const len = flBannerMs(b.kind);
    let start = b.t;
    if (start < curEnd) {
      if (pri > curPri) {
        // a higher banner cuts the one playing short
      } else if (curEnd - start <= FL_BANNER_WAIT_MS) start = curEnd;
      else continue; // waited too long: dropped
    }
    if (start > now) continue;
    curIdx = s % FL_BANNER_CAP;
    curStart = start;
    curEnd = start + len;
    curPri = pri;
  }
  if (curIdx >= 0 && now < curEnd) {
    out.index = curIdx;
    out.start = curStart;
    out.kind = view.banners[curIdx].kind;
  }
  return out;
}

/* ------------------------------------------------------------------ the VS card's timeline (ms from the run's start) */

export const FL_VS_VEIL_MS = 120;
export const FL_VS_PANELS_IN_MS = 260;
export const FL_VS_SLAM_MS = 300;
export const FL_VS_COUNT_MS = [450, 800, 1150] as const;
export const FL_VS_PANELS_OUT_MS = 1350;

/**
 * A free-for-all's chip on the VS and winner cards (screen px; `a` the arena's rect): 0.42 × 0.2 of the arena in the corner its
 * fighter starts in – `sx`, `sy` the side of its formation spot (−1 left / top, 0 centre / middle, 1 right / bottom), so the chip
 * sits over its own fighter –, 3 % (6 % top and bottom) in from the arena's edges, sliding in from its side as `slide` goes
 * 0 → 1 (a centred chip from the top or the bottom).
 */
export function flFfaChipRect(sx: number, sy: number, a: FlRect, slide: number, out: FlRect): FlRect {
  const w = 0.42 * a.w;
  const h = 0.2 * a.h;
  const off = (1 - Math.max(0, Math.min(1, slide))) * a.w;
  out.w = w;
  out.h = h;
  if (sx > 0) out.x = a.x + a.w - w - 0.03 * a.w + off;
  else if (sx < 0) out.x = a.x + 0.03 * a.w - off;
  else out.x = a.x + (a.w - w) / 2;
  if (sy > 0) out.y = a.y + a.h - h - 0.06 * a.h + (sx === 0 ? off : 0);
  else if (sy < 0) out.y = a.y + 0.06 * a.h - (sx === 0 ? off : 0);
  else out.y = a.y + (a.h - h) / 2;
  return out;
}

/* ------------------------------------------------------------------ telegraph previews */

/** The aim ticks of a volley of `n` over `spread` degrees around `aim` (radians) into `out` (reused). */
export function flVolleyTicks(n: number, spread: number, aim: number, out: number[]): number[] {
  out.length = 0;
  const count = Math.max(1, Math.round(n));
  const sp = (spread * Math.PI) / 180;
  for (let k = 0; k < count; k++) out.push(count > 1 ? aim + (k / (count - 1) - 0.5) * sp : aim);
  return out;
}

/** A telegraph's progress (0 → 1) from its start to its end at `now`. */
export function flTelegraphProgress(start: number, until: number, now: number): number {
  if (!(until > start)) return 1;
  return Math.max(0, Math.min(1, (now - start) / (until - start)));
}

/* ------------------------------------------------------------------ portrait plates */

/** Where the plates go in a portrait export frame: the top and bottom bars' text centres, their font size and maximum width. */
export interface FlPlateLayout {
  show: boolean;
  topY: number;
  bottomY: number;
  fontSize: number;
  subFontSize: number;
  maxWidth: number;
  centerX: number;
}

/**
 * The plates of a `width` × `height` export frame whose square lands at `squareTop`…`squareBottom`: in the bars above and
 * below it, at least 6 % of the frame from its edges and clear of the square (the owner's Top / Bottom Text lives inside the
 * square); shown only for a portrait frame with bars tall enough to hold them.
 */
export function flPlateLayout(width: number, height: number, squareTop: number, squareBottom: number): FlPlateLayout {
  const edge = 0.06 * height;
  const barTop = squareTop;
  const barBottom = height - squareBottom;
  const fontSize = Math.max(12, Math.min(0.055 * width, 0.42 * Math.min(barTop, barBottom)));
  const subFontSize = 0.5 * fontSize;
  const room = Math.min(barTop, barBottom) - edge;
  const show = height > width && room > 1.6 * fontSize;
  // top: centred in the room between the frame's top edge margin and the square; bottom likewise
  const topY = edge + Math.max(0, (barTop - edge - 1.6 * fontSize) / 2) + 0.6 * fontSize;
  const bottomY = height - edge - Math.max(0, (barBottom - edge - 1.6 * fontSize) / 2) - 0.6 * fontSize;
  return { show, topY, bottomY, fontSize, subFontSize, maxWidth: 0.88 * width, centerX: width / 2 };
}
