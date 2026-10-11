import { FAN_STEP_BUDGET, fanHue, fanSeparation, type ChaosFanView } from "@/lib/physics/chaosFan";
import type { DpField } from "@/lib/physics/modes/doublePendulum";

/*
 * --- chaos-fan --- Canvas drawing of the Double Pendulum's chaos fan (lib/physics/chaosFan.ts): a faint circle marking the
 * reach, the pivot, every pendulum as a thin two-segment line with a small bob – white lines and the leader's pink bob while
 * they are still one, each taking its hue by index (or the Ball Color) as it separates from the leader. Hundreds or thousands of
 * pendulums are batched: every pendulum falls into a bucket of one hue (36 of them) and one separation level (5), and each
 * bucket is one path stroked once – a 5,000-pendulum frame is a few hundred strokes. The scratch arrays are kept between frames
 * and the colours cached, so a warm frame allocates nothing. Called from doublePendulumRenderer.ts inside the camera transform;
 * the run's numbers go to the canvas' data-dp-fan-* attributes (`writeChaosFanData()`).
 */

export interface ChaosFanRenderOptions {
  /** The Visual section's Glow: a soft halo on the leader's bob. */
  showGlow: boolean;
  /** The Wall Thickness (the reach circle and the lines follow it a little). */
  wallThickness: number;
}

const TWO_PI = Math.PI * 2;
/** Hue buckets (10° each) and separation levels (together … apart) of the batched strokes. */
export const FAN_HUE_BUCKETS = 36;
export const FAN_SEP_LEVELS = 5;
/** The leader's pink: the bob of the fan while it is still one line. */
const PINK: readonly [number, number, number] = [255, 95, 162];
const WHITE: readonly [number, number, number] = [255, 255, 255];

/** The lines' opacity for a fan of `count`: nearly opaque for a few, fainter for thousands (so the spray stays legible). */
export function fanLineAlpha(count: number): number {
  if (count <= 20) return 0.95;
  const a = 1.15 - 0.18 * Math.log10(count);
  return a < 0.35 ? 0.35 : a > 0.95 ? 0.95 : a;
}

/** `[r, g, b]` (0–255) of an HSL colour (h degrees, s and l 0–1). */
export function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

/** `[r, g, b]` of a CSS hex colour (#rgb or #rrggbb); white for anything else. */
export function hexRgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: readonly number[], b: readonly number[], t: number): string {
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

/** The separation level (0 … FAN_SEP_LEVELS − 1) of a pendulum `devPx` from the leader with the split at `divergePx`. */
export function fanSepLevel(devPx: number, divergePx: number): number {
  return Math.min(FAN_SEP_LEVELS - 1, Math.round(fanSeparation(devPx, divergePx) * (FAN_SEP_LEVELS - 1)));
}

/** The hue bucket of pendulum i of n (the single-colour fan uses bucket 0 for all). */
export function fanHueBucket(i: number, n: number): number {
  return Math.floor(fanHue(i, n) / (360 / FAN_HUE_BUCKETS)) % FAN_HUE_BUCKETS;
}

/** The colour caches: lines (white → hue) and bobs (pink → hue) per bucket, for the rainbow and for one single colour. */
const lineIndex: string[] = [];
const bobIndex: string[] = [];
let singleKey = "";
const lineSingle: string[] = [];
const bobSingle: string[] = [];

function bucketHue(hb: number): [number, number, number] {
  return hslRgb((hb + 0.5) * (360 / FAN_HUE_BUCKETS), 0.9, 0.62);
}

function lineColor(bucket: number, single: boolean): string {
  if (single) return lineSingle[bucket % FAN_SEP_LEVELS];
  const hb = Math.floor(bucket / FAN_SEP_LEVELS);
  const sep = bucket % FAN_SEP_LEVELS;
  return (lineIndex[bucket] ??= mix(WHITE, bucketHue(hb), sep / (FAN_SEP_LEVELS - 1)));
}

function bobColor(bucket: number, single: boolean): string {
  if (single) return bobSingle[bucket % FAN_SEP_LEVELS];
  const hb = Math.floor(bucket / FAN_SEP_LEVELS);
  const sep = bucket % FAN_SEP_LEVELS;
  return (bobIndex[bucket] ??= mix(PINK, bucketHue(hb), sep / (FAN_SEP_LEVELS - 1)));
}

function prepareSingle(color: string) {
  if (color === singleKey) return;
  singleKey = color;
  const rgb = hexRgb(color);
  for (let l = 0; l < FAN_SEP_LEVELS; l++) {
    lineSingle[l] = mix(WHITE, rgb, l / (FAN_SEP_LEVELS - 1));
    bobSingle[l] = mix(rgb, rgb, 0);
  }
}

/** Scratch of the batched strokes: every pendulum's bucket, the buckets' counts and starts, the pendulums in bucket order. */
let bucketOf = new Int32Array(0);
let order = new Int32Array(0);
const counts = new Int32Array(FAN_HUE_BUCKETS * FAN_SEP_LEVELS + 1);
const starts = new Int32Array(FAN_HUE_BUCKETS * FAN_SEP_LEVELS + 1);

/** Sorts the pendulums into their buckets (a counting sort into `order`); returns the bucket count. */
export function bucketFan(fan: ChaosFanView): number {
  const n = fan.count;
  if (bucketOf.length < n) {
    bucketOf = new Int32Array(n);
    order = new Int32Array(n);
  }
  const single = fan.colourBy === "single";
  const buckets = single ? FAN_SEP_LEVELS : FAN_HUE_BUCKETS * FAN_SEP_LEVELS;
  counts.fill(0);
  for (let i = 0; i < n; i++) {
    const sep = fanSepLevel(fan.devPx[i], fan.divergePx);
    const b = single ? sep : fanHueBucket(i, n) * FAN_SEP_LEVELS + sep;
    bucketOf[i] = b;
    counts[b]++;
  }
  let at = 0;
  for (let b = 0; b < buckets; b++) {
    starts[b] = at;
    at += counts[b];
  }
  for (let i = 0; i < n; i++) order[starts[bucketOf[i]]++] = i;
  // starts[] now holds each bucket's end: put the starts back
  for (let b = 0; b < buckets; b++) starts[b] -= counts[b];
  return buckets;
}

/** Draws the fan (reach circle, lines, bobs, pivot) in the field's pixels. */
export function drawChaosFan(ctx: CanvasRenderingContext2D, fan: ChaosFanView, f: DpField, o: ChaosFanRenderOptions) {
  const n = fan.count;
  if (n <= 0) return;
  const s = f.scale;
  const cx = f.cx;
  const cy = f.cy;
  const single = fan.colourBy === "single";
  if (single) prepareSingle(fan.singleColor);
  const buckets = bucketFan(fan);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // the reach: a faint circle one chain from the pivot
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
  ctx.lineWidth = Math.max(1, 0.0016 * f.side + 0.2 * (o.wallThickness - 2));
  ctx.beginPath();
  ctx.arc(cx, cy, s, 0, TWO_PI);
  ctx.stroke();
  // the lines, one path per bucket
  ctx.globalAlpha = fanLineAlpha(n);
  ctx.lineWidth = Math.max(1, 0.0016 * f.side);
  for (let b = 0; b < buckets; b++) {
    const c = counts[b];
    if (c === 0) continue;
    ctx.strokeStyle = lineColor(b, single);
    ctx.beginPath();
    for (let k = starts[b], end = starts[b] + c; k < end; k++) {
      const i = order[k];
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + fan.x1[i] * s, cy + fan.y1[i] * s);
      ctx.lineTo(cx + fan.x2[i] * s, cy + fan.y2[i] * s);
    }
    ctx.stroke();
  }
  // the bobs, one path per bucket (squares past a few thousand or when tiny: cheaper, the same at that size)
  const r = Math.max(1, fan.bobPx);
  const squares = n > 2000 || r < 2.5;
  ctx.globalAlpha = 1;
  for (let b = 0; b < buckets; b++) {
    const c = counts[b];
    if (c === 0) continue;
    ctx.fillStyle = bobColor(b, single);
    ctx.beginPath();
    for (let k = starts[b], end = starts[b] + c; k < end; k++) {
      const i = order[k];
      if (i === 0) continue; // (the leader last, on top)
      const x = cx + fan.x2[i] * s;
      const y = cy + fan.y2[i] * s;
      if (squares) ctx.rect(x - r, y - r, 2 * r, 2 * r);
      else {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TWO_PI);
      }
    }
    ctx.fill();
  }
  // the leader: its bob on top, with a soft halo when the glow is on
  const lx = cx + fan.x2[0] * s;
  const ly = cy + fan.y2[0] * s;
  const leader = single ? bobSingle[0] : bobColor(fanHueBucket(0, n) * FAN_SEP_LEVELS, false);
  ctx.fillStyle = leader;
  if (o.showGlow) {
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(lx, ly, 2.2 * r + 2, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.arc(lx, ly, r, 0, TWO_PI);
  ctx.fill();
  // the pivot
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, 0.6 * r), 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** The canvas' data-dp-fan-* attributes (camelCase dataset keys), for tools and the smoke test. */
export const CHAOS_FAN_DATA_KEYS = ["dpFan", "dpFanCount", "dpFanSpread", "dpFanRunning", "dpFanStep", "dpFanCycles", "dpFanSplit", "dpFanSplits", "dpFanHome", "dpFanHomes", "dpFanReverses", "dpFanSwings", "dpFanSubsteps", "dpFanEvals", "dpFanBudget", "dpFanTape", "dpFanColours"] as const;

/** Mirrors the fan's run into the canvas' dataset (or removes the attributes when no fan runs). */
export function writeChaosFanData(fan: ChaosFanView | null, set: (key: string, value: string) => void, dataset: DOMStringMap) {
  if (!fan) {
    if (dataset.dpFan !== undefined) for (const key of CHAOS_FAN_DATA_KEYS) delete dataset[key];
    return;
  }
  set("dpFan", "1");
  set("dpFanCount", String(fan.count));
  set("dpFanSpread", fan.spreadPx.toFixed(1));
  set("dpFanRunning", fan.running);
  set("dpFanStep", String(fan.cycleStep));
  set("dpFanCycles", String(fan.cycles));
  set("dpFanSplit", fan.splitSec >= 0 ? fan.splitSec.toFixed(3) : "");
  set("dpFanSplits", String(fan.splits));
  set("dpFanHome", fan.homeSec >= 0 ? fan.homeSec.toFixed(3) : "");
  set("dpFanHomes", String(fan.homes));
  set("dpFanReverses", String(fan.reverses));
  set("dpFanSwings", String(fan.swings));
  set("dpFanSubsteps", String(fan.subSteps));
  set("dpFanEvals", String(fan.evals));
  set("dpFanBudget", String(FAN_STEP_BUDGET));
  set("dpFanTape", String(fan.tapeStride));
  set("dpFanColours", fan.colourBy);
}
