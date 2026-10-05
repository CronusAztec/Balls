import { shakeEnvelope } from "@/lib/simulation/camera";
import { BADGE_HEIGHT, BADGE_INSET } from "@/lib/watermark/layout";
import {
  EV_HIT,
  EV_KO,
  EV_SHOCK,
  EV_SLAM,
  EV_CAST,
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

/**
 * --- fl-overhaul --- (Stage 3) Fight League's visual maths: pure functions (no DOM, no clock, no random numbers) that the mode,
 * the renderer (components/simulator/fightLeague/*) and the tests share. Every value here is a function of its arguments – the
 * renderer feeds them the view and its simulation clock, so a frame is a function of (view, view.timeMs, options):
 *
 *  - the KO finale's time warp (`flFinaleScale()` 1 → 0.25 in 80 ms, held to 800 ms, back to 1 at 1200 ms; its integral
 *    `flFinaleWarp()` maps the effects' ages; `flFinaleZoom()` the 1 → 1.12 push-in),
 *  - the mode-owned screen shake (`flShakeAt()`: decaying directional shakes summed from the event ring),
 *  - the hit feedback curves (flash, squash and stretch, impact frames, the damage numbers' pop, rise and colour tiers),
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
/** The shakes: amplitude (share of the square's side) and length (ms) of a hit (≥ 10 damage, × min(1, dmg/25)), a slam, an area cast, a bomb, a KO and the final KO. */
export const FL_SHAKES = {
  hit: { amp: 0.0035, ms: 220, minDamage: 10 },
  slam: { amp: 0.005, ms: 240 },
  area: { amp: 0.006, ms: 300 },
  bomb: { amp: 0.007, ms: 320 },
  ko: { amp: 0.012, ms: 380 },
  finalKo: { amp: 0.016, ms: 380 },
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
 * hit of 10+ damage, a slam into a wall, an area cast, a bomb's burst, a KO (the final KO harder) – summed, clamped to
 * `FL_SHAKE_CLAMP` × side and scaled by `strength` (the setting; 0 = none). Pure: the same view and clock give the same shake.
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
  nameRowH: number;
  /** The names' centre lines (1v1: one; stacked: two rows a side), the HP bars' tops, the source line's centre. */
  nameY: number[];
  hpBarY: number[];
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
}

/** Whether `match` keeps the full ability boxes (two stat lines): the duel and the 2v2; the free-for-alls use compact ones. */
export function flFullBoxes(match: string, n: number): boolean {
  return n <= 2 || match === "2v2";
}

/** The readability floors of the HUD (share of the square's side; at 1080 px: 26 px box names, 20 px stat lines). */
export const FL_BOX_NAME_MIN = 0.0245;
export const FL_BOX_STAT_MIN = 0.0186;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The HUD's layout for a square of `side` px: the names band (FL_ARENA_TOP: the names, an HP bar under each, the source
 * line, the lead bar), the arena (FL_ARENA_FRAC), the ability boxes under it – one row, ending a badge's height and inset
 * (and a hair) above the square's bottom, so the watermark badge of a portrait export (bottom corners, BADGE_INSET from the
 * edge) never covers a meter or a stat line – and the font sizes the tests hold to the readability minimums at 1080 px.
 * `ballRadius` is a size-1 fighter's radius in display px (the HP number inside it).
 */
export function flHudLayout(side: number, n: number, match: string, portrait: boolean, ballRadius: number): FlHudLayout {
  const S = Math.max(1, side);
  const band = FL_ARENA_TOP * S;
  const arena: FlRect = { x: (0.5 - FL_ARENA_FRAC / 2) * S, y: band, w: FL_ARENA_FRAC * S, h: FL_ARENA_FRAC * S };
  const left = 0.035 * S;
  const right = (portrait ? 0.88 : 0.965) * S;
  const stacked = n > 2;
  const nameFs = (stacked ? 0.028 : 0.052) * S;
  const unit = 0.065 * arena.w;
  // the band, top down (1v1): name 0.024 S, HP bar 0.047–0.059 S, source 0.068 S, lead bar 0.077–0.089 S, the rim from 0.091 S
  const nameY = stacked ? [0.017 * S, 0.052 * S] : [0.024 * S];
  const hpBarH = (stacked ? 0.006 : 0.012) * S;
  const hpBarY = stacked ? [0.032 * S, 0.067 * S] : [0.047 * S];
  const boxesTop = (FL_ARENA_TOP + FL_ARENA_FRAC) * S + 0.002 * S;
  // the boxes end a badge's height and inset (and a hair) above the square's bottom
  const boxesBottom = S * (1 - BADGE_INSET - BADGE_HEIGHT) - 0.002 * S;
  const full = flFullBoxes(match, n);
  const perRow = Math.max(1, n);
  const gap = 0.014 * S;
  const h = boxesBottom - boxesTop;
  const w = (right - left - (perRow - 1) * gap) / perRow;
  const boxes: FlBoxLayout[] = [];
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
    boxes.push({ box: { x, y, w, h }, name, meter, stats, portrait: portraitRect, compact: !full, nameFs: nameFsBox, statFs });
  }
  return {
    side: S,
    band,
    arena,
    right,
    left,
    nameFs,
    nameRowH: stacked ? 0.035 * S : band,
    nameY,
    hpBarY,
    sourceY: 0.068 * S,
    hpBarH,
    hpBarW: (stacked ? 0.2 : 0.34) * S,
    sourceFs: 0.018 * S,
    timerFs: 0.026 * S,
    vsY: 0.022 * S,
    pillY: stacked ? 0.042 * S : 0.058 * S,
    pillH: 0.032 * S,
    leadBar: { x: left, y: 0.077 * S, w: right - left, h: 0.012 * S },
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
