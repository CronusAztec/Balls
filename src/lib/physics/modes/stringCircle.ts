import { COUNTRIES, countryByCode, flagCodeOf, type Country } from "@/lib/countries";
import { midiToFrequency } from "@/lib/audio/scales";
import { STRING_CEILING, atLeastMin } from "@/lib/uncap";
import type { SbFighter } from "./stringBattle";

/**
 * --- string-circle --- The String Circle style of the String Battle (`sbStyle` "circle"; feature string-circle): the
 * STRING CIRCLE country fights of an arena-battle account (the README names it). Flag balls fly round a thin white circle
 * (or a hexagon), and every ball keeps anchoring strings from itself to the rim straight ahead of it – a dense FAN in its
 * colour whose rim ends are its claimed arc. A ball crossing a rival's string cuts it; every `cut` strings of one owner cut
 * take a life from that owner; a ball out of lives is out and its fan dissolves; the last flag standing wins. The fans'
 * share of the rim is the live score (thin arcs on the rim), and a title line ("STRING CIRCLE", editable) tops the
 * exported square.
 *
 * This module holds what the style adds to the battle and nothing of the battle itself (lib/physics/modes/stringBattle.ts
 * keeps the balls, the lives, the shield, the elimination, the verdict, the finale and the rig, and calls in here):
 *
 *  - the settings: the arena, the anchors a second, the strings cut per life and the title (`sbArena`, `sbRate`, `sbCut`,
 *    `sbTitle`; URL `sba`, `sbrt`, `sbc`, `sbti`), their validation and the built-in presets;
 *  - the pure geometry: the arena (a circle of the battle's ring radius, or the hexagon inscribed in it), the rim point a
 *    ball faces (`rimHit()`), the rim point at a bearing (`rimAt()`), the cut test written for thousands of strings
 *    (`scCuts()`), the anchor cadence (`anchorsDue()`) and the coverage maths (`updateCoverage()`: the fans' arcs on the rim,
 *    the newest string winning where fans overlap);
 *  - the line-up: the countries the balls past a team roster play (`circleLineup()`: the clips' flags first, the two-letter
 *    code as the name, a colour no earlier ball wears) and the sounds' pitches (a twang per anchor by team, the cut's snap).
 *
 * Pure (no DOM, no engine import at run time): the mode, the renderer, the panel and the tests all read it.
 */

/* ------------------------------------------------------------------ settings */

export const SC_ARENAS = ["circle", "hexagon"] as const;
export type ScArena = (typeof SC_ARENAS)[number];

export function isScArena(value: unknown): value is ScArena {
  return typeof value === "string" && (SC_ARENAS as readonly string[]).includes(value);
}

/** The circle style's part of the String Battle settings. */
export interface StringCircleSettings {
  /** circle | hexagon (the #hexagon clips). */
  arena: ScArena;
  /** Strings every ball anchors a second (uncapped: a typed value past the slider is kept; at least 1). */
  rate: number;
  /** Strings of one owner that must be cut to take a life from it (uncapped; at least 1). */
  cut: number;
  /** The title line at the top of the exported square; "" = the translated STRING CIRCLE. */
  title: string;
}

/**
 * The defaults: 30 strings a ball a second and 200 strings cut per life. Nearly every string a ball anchors is cut sooner or
 * later, so the fans' density is the rate times a string's life and the battle's length about lives × cut ÷ (balls × rate):
 * measured over seeds, four balls of four lives fight for about 34 s with fans of 130–330 strings, a duel of five lives for
 * about 45 s with fans of 300–700 (a lower rate makes thin fans, a lower cut a slaughter paced by the shield alone).
 */
export const DEFAULT_STRING_CIRCLE_SETTINGS: StringCircleSettings = { arena: "circle", rate: 30, cut: 200, title: "" };

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names: `STRING_BATTLE_RANGES` spreads them into `RANGES`. */
export const STRING_CIRCLE_RANGES = {
  sbRate: { min: 1, max: 120, step: 1 },
  sbCut: { min: 1, max: 1000, step: 1 },
} as const;

/** The circle style's fields of the SimulatorSettings object (URL keys sba, sbrt, sbc, sbti). */
export interface StringCircleSettingFields {
  sbArena: ScArena;
  sbRate: number;
  sbCut: number;
  sbTitle: string;
}

/** Longest title (characters). */
export const SC_TITLE_LENGTH = 40;
// Control characters and the Unicode line / paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** A title as stored: control characters and line breaks as spaces, whitespace collapsed, at most `SC_TITLE_LENGTH` characters. */
export function sanitizeScTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(CONTROL, " ").replace(/\s+/g, " ").trimStart()).slice(0, SC_TITLE_LENGTH).join("");
}

/** A typed number: finite, lifted onto the slider's minimum and never held to its maximum (uncap-all); else `fallback`. */
function typedNumber(value: unknown, range: { min: number }, fallback: number): number {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) : fallback;
}

/**
 * Validates the circle fields of `config` into `out` (`resolveStringBattleSettings()` calls it): a known arena, a rate on
 * whole anchors a second and a whole cut count (a value below its slider lifted onto it, a big one kept), a clean title;
 * anything else keeps what `out` holds.
 */
export function resolveStringCircleInto(out: StringCircleSettings, config: Partial<Record<keyof StringCircleSettings, unknown>>) {
  if (isScArena(config.arena)) out.arena = config.arena;
  if (config.rate !== undefined) out.rate = Math.round(typedNumber(config.rate, STRING_CIRCLE_RANGES.sbRate, out.rate));
  if (config.cut !== undefined) out.cut = Math.round(typedNumber(config.cut, STRING_CIRCLE_RANGES.sbCut, out.cut));
  if (config.title !== undefined) out.title = sanitizeScTitle(config.title);
}

/** The circle settings of resolved String Battle settings (whose circle fields may be left out: the defaults). */
export function circleSettingsOf(source: Partial<StringCircleSettings>): StringCircleSettings {
  const out = { ...DEFAULT_STRING_CIRCLE_SETTINGS };
  resolveStringCircleInto(out, source);
  return out;
}

/** Writes the circle fields that differ from `base` into the URL: sba, sbrt, sbc and sbti. */
export function writeStringCircleParams(settings: StringCircleSettingFields, base: StringCircleSettingFields, params: URLSearchParams) {
  if (settings.sbArena !== base.sbArena) params.set("sba", settings.sbArena);
  if (settings.sbRate !== base.sbRate) params.set("sbrt", String(settings.sbRate));
  if (settings.sbCut !== base.sbCut) params.set("sbc", String(settings.sbCut));
  if (settings.sbTitle !== base.sbTitle) params.set("sbti", settings.sbTitle);
}

/** Reads the circle URL parameters into `next` (validated later with the rest of the battle's fields). */
export function readStringCircleParams(params: URLSearchParams, next: Partial<StringCircleSettingFields>) {
  const arena = params.get("sba");
  if (isScArena(arena)) next.sbArena = arena;
  const rate = params.get("sbrt");
  if (rate !== null && Number.isFinite(Number(rate))) next.sbRate = Number(rate);
  const cut = params.get("sbc");
  if (cut !== null && Number.isFinite(Number(cut))) next.sbCut = Number(cut);
  const title = params.get("sbti");
  if (title !== null) next.sbTitle = title;
}

/* ------------------------------------------------------------------ constants */

/**
 * The live strings one ball keeps at most – a memory-safety ceiling (uncap-all), not a design count: a ball anchors
 * `rate` strings a second for as long as nobody cuts them, and past this many the oldest fades out. Each string is a small
 * object (≈ 80 bytes), so even the battle's 256 balls hold ~20 MB; what it really bounds is work: every frame strokes every
 * string – 12 balls × 1,024 strings are 12,288 segments, what a frame still holds (the renderer thins past 3,000) – and
 * every sub-step (240 a second) re-indexes the fans a rival moved past and tests the strings in each move's direction
 * (`FanIndex`), a linear pass over every string. It is the String Battle's own thread ceiling (`STRING_CEILING` of
 * lib/uncap.ts), which the web style's Threads per Ball stops at too.
 */
export const SC_STRING_CEILING = STRING_CEILING;
/**
 * The share of a string, from its anchor on the rim, that a rival can cut. A fan's strings all meet at its ball, so a rival
 * passing near the ball would cross every one of them at once (a whole fan wiped by any pass: measured, the fans never grew
 * past a few dozen strings) – the inner half of a fan is spared, and what a rival cuts is what it slices through out toward
 * the rim: the fan's claim. 1 would be the web style's whole thread.
 */
export const SC_CUT_SPAN = 0.5;
/** The rim is scored in this many equal bins of bearing (half a degree each). */
export const SC_RIM_BINS = 720;
/** Two strings anchored one after the other by one ball (both still up) at most this far apart on the rim claim the arc between them. */
export const SC_ARC_JOIN = Math.PI / 6;
/**
 * How much a ball's flight curls: its heading turns at `curl × speed / R` radians a second (R the arena's radius), so its
 * path bends with a radius of about R / curl whatever the Ball Speed – and the rim point straight ahead of it sweeps
 * along the rim, which is what makes a fan (a straight flight would anchor every string at the same point). Each ball
 * draws its curl at the start and afresh at every wall bounce: `SC_CURL` × [1 − SPREAD, 1 + SPREAD], either way round.
 */
export const SC_CURL = 0.9;
export const SC_CURL_SPREAD = 0.4;
/** Twang notes, one per team (C-major pentatonic from C4); the ToneGenerator snaps them to the chosen scale. */
export const SC_TWANG_MIDI: readonly number[] = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86];
/** The anchors of a step are grouped into one twang event of at most this many team notes … */
export const SC_TWANG_NOTES = 3;
/** … and a twang event plays at most every this many 60 Hz steps (20 a second: a shimmer, never a buzz). */
export const SC_TWANG_GAP_STEPS = 3;
/** Loudness of a twang (a soft pluck under the battle). */
export const SC_TWANG_LEVEL = 0.5;
/** A cut's snap plays at most every this many steps; its loudness grows with the strings cut (`snapLevel()`). */
export const SC_SNAP_GAP_STEPS = 3;
/** A fan dissolving with its ball leaves at most this many dissolving strings on the canvas. */
export const SC_DISSOLVE_GHOSTS = 48;
/** One rival's slice through a fan in one sub-step leaves at most this many snapping strings on the canvas (all are cut). */
export const SC_SNAP_GHOSTS = 8;
/** The share of the exported square the title line's band takes at the top (the ring's radius leaves 12.5 % above it). */
export const SC_TITLE_BAND = 0.11;
/** The hexagon is flat-topped and inscribed in the battle's ring: its apothem is the radius times cos 30°. */
export const SC_HEX_APOTHEM = Math.cos(Math.PI / 6);

const TWO_PI = Math.PI * 2;
const BIN = TWO_PI / SC_RIM_BINS;
/** Outward normals of the hexagon's sides (flat top: the sides face 30°, 90°, 150° …). */
const HEX_NX = new Float64Array(6);
const HEX_NY = new Float64Array(6);
for (let k = 0; k < 6; k++) {
  HEX_NX[k] = Math.cos(Math.PI / 6 + (k * Math.PI) / 3);
  HEX_NY[k] = Math.sin(Math.PI / 6 + (k * Math.PI) / 3);
}

/** The sides of an arena's wall: 0 for the circle, 6 for the hexagon. */
export function arenaSides(arena: ScArena): 0 | 6 {
  return arena === "hexagon" ? 6 : 0;
}

/** The outward normal of side `k` of the hexagon (written into `out`). */
export function hexNormal(k: number, out: { x: number; y: number }) {
  const i = ((k % 6) + 6) % 6;
  out.x = HEX_NX[i];
  out.y = HEX_NY[i];
  return out;
}

/* ------------------------------------------------------------------ geometry */

/**
 * The rim point straight ahead of a ball at (px, py) heading (dx, dy) – the ray's exit from the arena (centre cx, cy, radius
 * R; `sides` 6: the inscribed hexagon) – and its bearing from the centre, written into `out`. A ball standing still faces
 * away from the centre.
 */
export function rimHit(cx: number, cy: number, R: number, sides: number, px: number, py: number, dx: number, dy: number, out: { x: number; y: number; angle: number }) {
  const qx = px - cx;
  const qy = py - cy;
  let len = Math.hypot(dx, dy);
  if (!(len > 0)) {
    dx = qx;
    dy = qy;
    len = Math.hypot(dx, dy);
    if (!(len > 0)) {
      dx = 1;
      dy = 0;
      len = 1;
    }
  }
  dx /= len;
  dy /= len;
  let t: number;
  if (sides === 6) {
    const a = R * SC_HEX_APOTHEM;
    t = Infinity;
    for (let k = 0; k < 6; k++) {
      const du = dx * HEX_NX[k] + dy * HEX_NY[k];
      if (du <= 1e-12) continue;
      const tk = (a - (qx * HEX_NX[k] + qy * HEX_NY[k])) / du;
      if (tk < t) t = tk;
    }
  } else {
    const b = qx * dx + qy * dy;
    const disc = b * b - (qx * qx + qy * qy - R * R);
    t = disc > 0 ? -b + Math.sqrt(disc) : 0;
  }
  if (!(t > 0) || !Number.isFinite(t)) t = 0;
  out.x = px + dx * t;
  out.y = py + dy * t;
  out.angle = Math.atan2(out.y - cy, out.x - cx);
  return out;
}

/** The rim point at bearing `angle` from the centre (on the circle, or on the hexagon's side there), written into `out`. */
export function rimAt(cx: number, cy: number, R: number, sides: number, angle: number, out: { x: number; y: number }) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let r = R;
  if (sides === 6) {
    let m = 0;
    for (let k = 0; k < 6; k++) {
      const d = c * HEX_NX[k] + s * HEX_NY[k];
      if (d > m) m = d;
    }
    r = m > 0 ? (R * SC_HEX_APOTHEM) / m : R;
  }
  out.x = cx + c * r;
  out.y = cy + s * r;
  return out;
}

/** How far (px) a ball of radius `r` at (x, y) is past the arena's wall (≤ 0 inside), and the side's outward normal into `n`. */
export function wallOverlap(cx: number, cy: number, R: number, sides: number, x: number, y: number, r: number, n: { x: number; y: number }): number {
  const qx = x - cx;
  const qy = y - cy;
  if (sides === 6) {
    const a = R * SC_HEX_APOTHEM - r;
    let best = -Infinity;
    for (let k = 0; k < 6; k++) {
      const over = qx * HEX_NX[k] + qy * HEX_NY[k] - a;
      if (over > best) {
        best = over;
        n.x = HEX_NX[k];
        n.y = HEX_NY[k];
      }
    }
    return best;
  }
  const d = Math.hypot(qx, qy);
  if (d > 0) {
    n.x = qx / d;
    n.y = qy / d;
  } else {
    n.x = 1;
    n.y = 0;
  }
  return d - (R - r);
}

/**
 * The circle style's cut test, written for thousands of strings: whether a ball whose centre moved from (p0x, p0y) to
 * (p1x, p1y) crossed the string from its anchor (ax, ay) to its ball at (bx, by) – anywhere but the stub `reach` px long
 * next to that ball – the web style's `cutsThread()` with its whole-thread span (`SB_CUT_SPAN` 1). Returns where along the
 * string the cut is (0 at the anchor, 1 at the ball), or −1. The crossing is solved without a division or a square root
 * until both parameters are known to be on the two segments, so the misses – nearly all of the tests – cost a few
 * multiplications.
 */
export function scCuts(ax: number, ay: number, bx: number, by: number, reach: number, p0x: number, p0y: number, p1x: number, p1y: number, span = SC_CUT_SPAN): number {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = p1x - p0x;
  const sy = p1y - p0y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return -1;
  const qx = p0x - ax;
  const qy = p0y - ay;
  const tn = qx * sy - qy * sx; // t · denom: along the string
  const un = qx * ry - qy * rx; // u · denom: along the ball's move
  if (denom > 0) {
    if (un <= 0 || un > denom || tn < 0 || tn > denom) return -1;
  } else if (un >= 0 || un < denom || tn > 0 || tn < denom) return -1;
  const t = tn / denom;
  if (t > span) return -1;
  const len = Math.sqrt(rx * rx + ry * ry);
  if (!(len > reach) || t * len > len - reach) return -1;
  return t;
}

/**
 * A monotonic stand-in for the bearing of (dx, dy) – the "diamond angle", in [0, 4) where atan2 gives [0, 2π): a division
 * instead of an arc tangent, and antipodal like it (the opposite direction is 2 more, mod 4). NaN for (0, 0).
 */
export function pseudoAngle(dx: number, dy: number): number {
  const p = dx / (Math.abs(dx) + Math.abs(dy));
  return dy < 0 ? 3 + p : 1 - p;
}

/** The buckets of a fan's angular index (`FanIndex`): 128 of them round the ball. */
export const FAN_BUCKETS = 128;
const BUCKETS_PER_UNIT = FAN_BUCKETS / 4;

/**
 * An angular index of one fan for the cut test. Every string of a fan ends at its ball, so a rival's move – a pixel or two a
 * sub-step – can only cross the strings whose direction from that ball lies between the directions of the move's two ends:
 * `build()` buckets the strings by that direction (a counting sort by `pseudoAngle()`, every sub-step: the ball moves),
 * `window()` names the buckets a move may cross (one more on each side for the rounding), and only their strings get the
 * full test (`scCuts()`) – the same strings cut as testing every one, a few of them tested instead of hundreds. A move
 * that ends at the ball itself is given every bucket.
 */
export class FanIndex {
  /** Where each bucket's strings start in `items` (bucket b: `items[start[b] … start[b + 1] − 1]`, in string order). */
  readonly start = new Int32Array(FAN_BUCKETS + 1);
  items = new Int32Array(64);
  private keys = new Int32Array(64);
  private readonly fillAt = new Int32Array(FAN_BUCKETS);

  build(strings: readonly { ax: number; ay: number }[], bx: number, by: number) {
    const n = strings.length;
    if (this.items.length < n) {
      this.items = new Int32Array(Math.max(n, 2 * this.items.length));
      this.keys = new Int32Array(this.items.length);
    }
    const start = this.start;
    start.fill(0);
    for (let k = 0; k < n; k++) {
      const s = strings[k];
      const pa = pseudoAngle(s.ax - bx, s.ay - by);
      let b = pa === pa ? Math.floor(pa * BUCKETS_PER_UNIT) : 0;
      if (b >= FAN_BUCKETS) b = FAN_BUCKETS - 1;
      else if (b < 0) b = 0;
      this.keys[k] = b;
      start[b + 1]++;
    }
    for (let b = 0; b < FAN_BUCKETS; b++) start[b + 1] += start[b];
    // Fill in string order (a bucket's strings stay in the fan's order): `fill` walks each bucket's next free slot.
    const fill = this.fillAt;
    fill.set(start.subarray(0, FAN_BUCKETS));
    for (let k = 0; k < n; k++) this.items[fill[this.keys[k]]++] = k;
  }

  /**
   * The buckets a move from q0 to q1 (relative to the ball) may cross: `first` and `count` (wrapping round; `count` is
   * FAN_BUCKETS for all of them – a move from or to the ball's very centre).
   */
  window(q0x: number, q0y: number, q1x: number, q1y: number, out: { first: number; count: number }) {
    const a0 = pseudoAngle(q0x, q0y);
    const a1 = pseudoAngle(q1x, q1y);
    if (!(a0 === a0) || !(a1 === a1)) {
      out.first = 0;
      out.count = FAN_BUCKETS;
      return out;
    }
    let d = a1 - a0;
    if (d < 0) d += 4;
    // A straight move not through the ball sweeps less than a half turn: the short way (a pseudo-length under 2).
    const lo = d <= 2 ? a0 : a1;
    const len = d <= 2 ? d : 4 - d;
    const first = Math.floor(lo * BUCKETS_PER_UNIT) - 1;
    const last = Math.floor((lo + len) * BUCKETS_PER_UNIT) + 1;
    out.count = Math.min(FAN_BUCKETS, last - first + 1);
    out.first = ((first % FAN_BUCKETS) + FAN_BUCKETS) % FAN_BUCKETS;
    return out;
  }
}

/**
 * The anchors a ball owes at a cadence of `rate` a second whose next one was due at `nextMs`, by `nowMs`: how many (0 when
 * none is due yet). The caller moves `nextMs` on by that many intervals.
 */
export function anchorsDue(nextMs: number, nowMs: number, rate: number): number {
  if (!(rate > 0) || !(nowMs >= nextMs)) return 0;
  // (the nudge keeps an anchor due exactly at `nowMs` from rounding away: 1000 ÷ (1000 ÷ 30) is 29.999…)
  return Math.floor((nowMs - nextMs) / (1000 / rate) + 1e-9) + 1;
}

/** The difference b − a of two bearings, in (−π, π]. */
export function bearingDelta(a: number, b: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}

/** The rim bin of a bearing. */
export function rimBin(angle: number): number {
  let a = angle % TWO_PI;
  if (a < 0) a += TWO_PI;
  const b = Math.floor(a / BIN);
  return b >= SC_RIM_BINS ? SC_RIM_BINS - 1 : b;
}

/* ------------------------------------------------------------------ coverage */

/** What `updateCoverage()` reads of a fan's string: its bearing on the rim, when it was anchored and its place in its ball's sequence. */
export interface ScStringLike {
  angle: number;
  bornMs: number;
  serial?: number;
}

/** The rim's scoring state: the slot holding each bin (−1 none), the claim's time there (scratch), bins and share per slot. */
export interface ScCoverage {
  owner: Int16Array;
  stamp: Float64Array;
  bins: Int32Array;
  share: Float64Array;
  /** Incremented whenever a bin changed hands (the renderer redraws the rim arcs then). */
  version: number;
}

export function createCoverage(slots: number): ScCoverage {
  return { owner: new Int16Array(SC_RIM_BINS).fill(-1), stamp: new Float64Array(SC_RIM_BINS), bins: new Int32Array(Math.max(1, slots)), share: new Float64Array(Math.max(1, slots)), version: 0 };
}

/** Claims the bins from `from` to `to` (inclusive, `dir` ±1 round the rim) for `slot` where its claim at `stamp` is newer. */
function paintBins(cov: ScCoverage, slot: number, from: number, to: number, dir: number, stamp: number) {
  const owner = cov.owner;
  const stamps = cov.stamp;
  let b = from;
  for (let guard = 0; guard <= SC_RIM_BINS; guard++) {
    if (stamp > stamps[b] || owner[b] < 0) {
      stamps[b] = stamp;
      owner[b] = slot;
    }
    if (b === to) break;
    b += dir;
    if (b >= SC_RIM_BINS) b = 0;
    else if (b < 0) b = SC_RIM_BINS - 1;
  }
}

/**
 * The fans' share of the rim. Two strings a ball anchored one after the other (consecutive serials, both still up) at most
 * `SC_ARC_JOIN` apart on the rim claim the arc between their anchors – a sweeping fan claims the arc it swept, a cut string
 * breaks it –, a string without such a neighbour claims its own bin; where fans overlap, the newer claim wins (the later
 * of a pair's two strings; a dead heat stays with the lower slot). Writes the owner of every rim bin, the bins and the share
 * of every slot, and bumps `version` when a bin changed hands. Deterministic: a pure function of the live strings.
 */
export function updateCoverage(cov: ScCoverage, fans: readonly { alive: boolean; strings: readonly ScStringLike[] }[]) {
  const owner = cov.owner;
  const prevHash = coverageHash(owner);
  owner.fill(-1);
  cov.stamp.fill(-Infinity);
  for (let slot = 0; slot < fans.length; slot++) {
    const f = fans[slot];
    if (!f.alive) continue;
    const list = f.strings;
    let joinedPrev = false;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      const next = k + 1 < list.length ? list[k + 1] : null;
      const d = next && s.serial !== undefined && next.serial === s.serial + 1 ? bearingDelta(s.angle, next.angle) : NaN;
      if (Math.abs(d) <= SC_ARC_JOIN) {
        paintBins(cov, slot, rimBin(s.angle), rimBin(next!.angle), d >= 0 ? 1 : -1, next!.bornMs);
        joinedPrev = true;
      } else {
        if (!joinedPrev) paintBins(cov, slot, rimBin(s.angle), rimBin(s.angle), 1, s.bornMs);
        joinedPrev = false;
      }
    }
  }
  const bins = cov.bins;
  bins.fill(0);
  for (let b = 0; b < SC_RIM_BINS; b++) if (owner[b] >= 0 && owner[b] < bins.length) bins[owner[b]]++;
  for (let i = 0; i < bins.length; i++) cov.share[i] = bins[i] / SC_RIM_BINS;
  if (coverageHash(owner) !== prevHash) cov.version++;
}

/** A hash of the rim's owners (FNV-1a), to tell a changed rim from the same one. */
function coverageHash(owner: Int16Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < owner.length; i++) {
    h ^= owner[i] & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Of the slots that take a clip-limit verdict (the survivors with the most lives), the ones holding the most rim. */
export function coverageLeaders(leaders: readonly number[], bins: Int32Array): number[] {
  if (leaders.length <= 1) return leaders.slice();
  let best = -1;
  for (const slot of leaders) if ((bins[slot] ?? 0) > best) best = bins[slot] ?? 0;
  return leaders.filter((slot) => (bins[slot] ?? 0) === best);
}

/* ------------------------------------------------------------------ line-up, colours and sounds */

/**
 * The flags the balls past a team roster play, in order: the countries of the clips (Turkey, India, the USA, Iran, Germany,
 * Canada, Japan, China, Vietnam, Sri Lanka, Pakistan, Bangladesh, Afghanistan), then the rest of the built-in list.
 */
export const SC_LINEUP: readonly string[] = (() => {
  const clips = ["TR", "IN", "US", "IR", "DE", "CA", "JP", "CN", "VN", "LK", "PK", "BD", "AF"];
  const out = clips.filter((code) => countryByCode(code));
  for (const c of COUNTRIES) if (!out.includes(c.code)) out.push(c.code);
  return out;
})();

/** One ball's look: its name, colour and badge (a flag emoji – its two-letter code where the fonts have none). */
export interface ScLook {
  name: string;
  color: string;
  emoji: string;
  /** The flag's two-letter code ("" for a roster emoji that is not a flag). */
  code: string;
}

function hexRgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The RGB distance between two colours (0 – 441). */
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Whether two colours are too alike for two fans of thin lines (an RGB distance under 80: red and crimson, not orange and yellow). */
export function colorsClash(a: string, b: string): boolean {
  return colorDistance(a, b) < 80;
}

/** "#rrggbb" of an HSL colour (h in degrees, s and l 0–1). */
function hslHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/**
 * A flag colour a fan can wear next to `taken`: the country's first colour, else its second (not white), else a golden-angle
 * hue at one of three lightnesses that none of them is near – and when every one is near something (a crowd past a few
 * dozen), the one farthest from its nearest.
 */
function distinctColor(country: Country, taken: readonly string[], seed: number): string {
  for (const c of country.colors) {
    if (c.toLowerCase() === "#ffffff" && country.colors[0] !== c) continue;
    if (!taken.some((t) => colorsClash(t, c))) return c;
  }
  let best = "";
  let bestGap = -1;
  for (let k = 0; k < 72; k++) {
    const c = hslHex(((seed + k) * 137.508) % 360, 0.82, LIGHTNESS[k % LIGHTNESS.length]);
    let gap = Infinity;
    for (const t of taken) gap = Math.min(gap, colorDistance(t, c));
    if (gap >= 80) return c;
    if (gap > bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  return best;
}
const LIGHTNESS = [0.58, 0.74, 0.46];

/**
 * The looks of `count` balls: the roster's first (its names, colours and emoji – a flag's code read off the emoji), then
 * the line-up's countries the roster does not field yet, each named by its two-letter code ("beyond the roster's names the
 * palette and codes take over") in a flag colour no earlier ball wears. Past the line-up it starts over.
 */
export function circleLineup(roster: readonly { name: string; color: string; emoji: string }[], count: number): ScLook[] {
  const out: ScLook[] = [];
  const used = new Set<string>();
  const n = Math.max(0, Math.floor(count));
  for (let i = 0; i < Math.min(roster.length, n); i++) {
    const t = roster[i];
    const code = flagCodeOf(t.emoji);
    if (code) used.add(code);
    out.push({ name: t.name, color: t.color, emoji: t.emoji, code });
  }
  let cursor = 0;
  let pass = 0;
  while (out.length < n) {
    if (cursor >= SC_LINEUP.length) {
      cursor = 0;
      pass++;
      used.clear();
    }
    const code = SC_LINEUP[cursor++];
    if (pass === 0 && used.has(code)) continue;
    const country = countryByCode(code)!;
    used.add(code);
    const taken = out.map((l) => l.color);
    out.push({ name: code, color: distinctColor(country, taken, out.length), emoji: country.flag, code });
  }
  return out;
}

/** The twang note of team `slot` (Hz): one degree of the pentatonic ladder per team, round again past twelve. */
export function twangFrequency(slot: number): number {
  const n = SC_TWANG_MIDI.length;
  return midiToFrequency(SC_TWANG_MIDI[((Math.round(slot) % n) + n) % n]);
}

/** The snap of a cut through team `slot`'s fan (Hz): an octave above its twang. */
export function snapFrequency(slot: number): number {
  return 2 * twangFrequency(slot);
}

/** The loudness of a snap that cut `strings` strings at once (0.4 for one, louder with more, at most 1). */
export function snapLevel(strings: number): number {
  return Math.min(1, 0.4 + 0.04 * Math.max(0, strings - 1));
}

/* ------------------------------------------------------------------ the battle's circle state */

/**
 * What the circle style keeps besides the battle's view (`StringBattleView.circle`; null in the web and neon styles). The
 * per-slot arrays are sized to the battle's balls at its start.
 */
export interface StringCircleState {
  /** 0: the circle; 6: the hexagon. */
  sides: 0 | 6;
  /** The anchors a second and the strings cut per life the battle started with. */
  rate: number;
  cut: number;
  /** Strings anchored so far (all balls), strings cut so far, lives the cuts took, twang and snap events queued. */
  anchors: number;
  cuts: number;
  lives: number;
  twangs: number;
  snaps: number;
  /** Per slot: when its next string is due (simulation ms) and its next string's serial. */
  nextAnchorMs: Float64Array;
  serial: Float64Array;
  /** Per slot: its curl (signed, see `SC_CURL`). */
  curl: Float64Array;
  /** Per slot: where its ball was, and its heading, at the end of the previous step (the anchors in between are interpolated). */
  stepX: Float64Array;
  stepY: Float64Array;
  stepHeading: Float64Array;
  /** Per slot: its strings cut since its last lost life (toward `cut`), all of its strings cut, and the strings it cut. */
  toward: Int32Array;
  lost: Int32Array;
  cutBy: Int32Array;
  /** The rim's scoring. */
  coverage: ScCoverage;
  /** The sounds of this step: the teams that anchored (a flag each), the strings cut and whose most. */
  anchored: Uint8Array;
  twangCursor: number;
  stepsSinceTwang: number;
  stepCuts: Int32Array;
  stepsSinceSnap: number;
}

export function createCircleState(slots: number, settings: StringCircleSettings): StringCircleState {
  const n = Math.max(1, slots);
  return {
    sides: arenaSides(settings.arena),
    rate: settings.rate,
    cut: settings.cut,
    anchors: 0,
    cuts: 0,
    lives: 0,
    twangs: 0,
    snaps: 0,
    nextAnchorMs: new Float64Array(n),
    serial: new Float64Array(n),
    curl: new Float64Array(n),
    stepX: new Float64Array(n),
    stepY: new Float64Array(n),
    stepHeading: new Float64Array(n),
    toward: new Int32Array(n),
    lost: new Int32Array(n),
    cutBy: new Int32Array(n),
    coverage: createCoverage(n),
    anchored: new Uint8Array(n),
    twangCursor: 0,
    stepsSinceTwang: SC_TWANG_GAP_STEPS,
    stepCuts: new Int32Array(n),
    stepsSinceSnap: SC_SNAP_GAP_STEPS,
  };
}

/** The coverage of every slot in percent with one decimal ("12.5,30,0,…"): `data-sb-coverage`. */
export function coverageText(state: StringCircleState, count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) out += `${i > 0 ? "," : ""}${Math.round(1000 * (state.coverage.share[i] ?? 0)) / 10}`;
  return out;
}

/** The live strings of every slot ("120,96,0,…"): `data-sb-fans`. */
export function fanText(fighters: readonly Pick<SbFighter, "strings" | "alive">[]): string {
  let out = "";
  for (let i = 0; i < fighters.length; i++) out += `${i > 0 ? "," : ""}${fighters[i].alive ? fighters[i].strings.length : 0}`;
  return out;
}

/* ------------------------------------------------------------------ built-in presets */

export const SC_PRESET_IDS = ["indiaUsa", "countries4", "mega12", "hexagon6", "classic5"] as const;
export type ScPresetId = (typeof SC_PRESET_IDS)[number];

export function isScPresetId(value: unknown): value is ScPresetId {
  return typeof value === "string" && (SC_PRESET_IDS as readonly string[]).includes(value);
}

interface ScPreset {
  /** The roster: a country's code and the colour its fan wears (one of its flag's, picked apart from the others). */
  roster: readonly (readonly [code: string, color: string])[];
  balls: number;
  arena: ScArena;
  lives: number;
  rate: number;
  cut: number;
  /** The clip the preset sets (seconds): the battles it plays, with the winner banner's hold. */
  clip: number;
}

// The fans' colours are the flags', picked so no two of a preset clash (`colorsClash()`): Turkey red, India saffron, Iran
// green, Germany's gold (a yellow one, apart from the saffron), the USA's blue (its red would be Turkey's), Canada's white;
// in the hexagon China red, Vietnam's star yellow, Pakistan green, Japan white.
const TR = ["TR", "#e30a17"] as const;
const IN = ["IN", "#ff9933"] as const;
const US = ["US", "#3c5cd6"] as const;
const IR = ["IR", "#239f40"] as const;
const DE = ["DE", "#ffe600"] as const;
const CA = ["CA", "#ffffff"] as const;
const JP = ["JP", "#ffffff"] as const;
const CN = ["CN", "#ee1c25"] as const;
const PK = ["PK", "#1f9d55"] as const;
const VN = ["VN", "#ffde00"] as const;

const SC_PRESETS: Readonly<Record<ScPresetId, ScPreset>> = {
  // "INDIA USA STRING FIGHT": a duel.
  indiaUsa: { roster: [IN, US], balls: 2, arena: "circle", lives: 5, rate: 30, cut: 200, clip: 55 },
  // "BATTLE OF COUNTRIES": the four flags of the thumbnails.
  countries4: { roster: [TR, IN, US, IR], balls: 4, arena: "circle", lives: 4, rate: 30, cut: 200, clip: 45 },
  // "MEGA COUNTRY FIGHT": twelve flags – the roster's six, then the line-up's next six by their codes.
  mega12: { roster: [TR, IN, US, IR, DE, CA], balls: 12, arena: "circle", lives: 3, rate: 30, cut: 200, clip: 35 },
  // The #hexagon clips: six flags in a hexagon.
  hexagon6: { roster: [CN, IN, VN, PK, US, JP], balls: 6, arena: "hexagon", lives: 3, rate: 30, cut: 200, clip: 35 },
  // "STRING ARENA": the five flags whose fans paint the five-pointed star.
  classic5: { roster: [TR, IN, US, IR, DE], balls: 5, arena: "circle", lives: 4, rate: 30, cut: 200, clip: 42 },
};

/** The settings patch of a built-in preset: the circle style and its numbers, its roster of countries (`nameOf` localises a name) and its clip. */
export function stringCirclePresetPatch(
  id: ScPresetId,
  nameOf: (code: string, english: string) => string = (_, english) => english,
): StringCircleSettingFields & {
  sbStyle: "circle";
  sbBalls: number;
  sbLives: number;
  sbDuration: number;
  sbBadge: boolean;
  sbHud: boolean;
  teams: { name: string; color: string; emoji: string }[];
  recordingDuration: number;
} {
  const p = SC_PRESETS[id];
  const teams = p.roster.map(([code, color]) => {
    const c = countryByCode(code) ?? COUNTRIES[0];
    return { name: nameOf(c.code, c.name), color, emoji: c.flag };
  });
  return { sbStyle: "circle", sbArena: p.arena, sbRate: p.rate, sbCut: p.cut, sbTitle: "", sbBalls: p.balls, sbLives: p.lives, sbDuration: 0, sbBadge: false, sbHud: true, teams, recordingDuration: p.clip };
}
