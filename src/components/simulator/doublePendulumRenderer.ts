import { TRAIL_CAPACITY, type DoublePendulumView } from "@/lib/physics/modes/doublePendulum";

/**
 * Canvas drawing of the Double Pendulum mode (lib/physics/modes/doublePendulum.ts): the harp strings (vertical or radial,
 * rainbow by pitch or in the wall colour, each vibrating after a pluck with a decaying sine displacement), the long
 * rainbow trails of the last bobs (traced from the mode's sample buffer in bands of one hue and one opacity, fading out
 * completely at the end of the trail), the rods, pivots and bobs, the flashes of the sparring hits and the screen flash
 * of a hard hit. Everything is timed by the simulation clock (`view.timeSec`), so it freezes with a pause and replays
 * exactly in a recording; the colour strings are cached, so a frame allocates nothing once warm. Called from Canvas.tsx
 * inside the camera transform (strings, trails, bodies) and outside it (the screen flash).
 */

export interface DoublePendulumRenderOptions {
  /** The canvas' wall colour function (used for the strings when the rainbow walls are off). */
  wallColor: (index: number, alpha?: number) => string;
  /** Rainbow walls on: every string gets the hue of its pitch. */
  rainbow: boolean;
  wallThickness: number;
  showGlow: boolean;
  /** The Visual section's trail switch and thickness. */
  showTrails: boolean;
  trailThickness: number;
}

const TWO_PI = Math.PI * 2;
/** How long a bob stays brightened after it plucked a string (simulation seconds). */
export const BOB_FLASH_SEC = 0.2;
/** How long the flash of a sparring hit lasts at the contact (simulation seconds). */
export const HIT_FLASH_SEC = 0.35;
/** How long the screen flash of a hard hit lasts (simulation seconds), and the strength from which it shows. */
export const SCREEN_FLASH_SEC = 0.25;
export const SCREEN_FLASH_MIN_STRENGTH = 0.6;
/** Opacity of the trail where it leaves its bob. */
export const TRAIL_ALPHA = 0.9;
/** Bands (strokes of one hue and opacity) per trail: fewer for more pendulums, so the whole rig stays within budget. */
export function trailBands(pendulums: number): number {
  return pendulums <= 1 ? 72 : pendulums === 2 ? 56 : 40;
}

/** Hue (degrees) of a pendulum's rainbow at simulation time `t`: a full turn over the trail length (at least 2 s). */
export function trailHue(baseHue: number, t: number, trailSeconds: number): number {
  const h = baseHue + (360 * t) / Math.max(2, trailSeconds);
  return ((h % 360) + 360) % 360;
}

/** Opacity and width factor of trail samples `age` seconds old on a trail of `trailSeconds`: full at the bob, zero at the end. */
export function trailFade(age: number, trailSeconds: number): number {
  if (!(trailSeconds > 0)) return 0;
  const f = 1 - Math.max(0, age) / trailSeconds;
  return f > 0 ? f : 0;
}

/**
 * Displacement (as a fraction of the maximum) of a string `age` seconds after a pluck of strength `amp`: a sine of
 * the string's visual frequency under an exponential decay – lower strings ring slower and longer. 0 before the
 * first pluck and once it has died away.
 */
export function stringDisplacement(age: number, amp: number, rank: number): number {
  if (!(age >= 0) || !(amp > 0)) return 0;
  const tau = 0.35 + 0.45 * (1 - rank);
  const env = amp * Math.exp(-age / tau);
  if (env < 0.01) return 0;
  const freq = 7 + 9 * rank;
  return env * Math.sin(TWO_PI * freq * age);
}

/** The envelope of that vibration (for the glow): amp · e^(−age / τ). */
export function stringEnvelope(age: number, amp: number, rank: number): number {
  if (!(age >= 0) || !(amp > 0)) return 0;
  const env = amp * Math.exp(-age / (0.35 + 0.45 * (1 - rank)));
  return env < 0.01 ? 0 : env;
}

const HUES: string[] = [];
const LIGHT_HUES: string[] = [];
/** `hsl(h, 100%, 62%)` for a whole-degree hue, cached. */
function hueColor(h: number): string {
  const i = ((Math.round(h) % 360) + 360) % 360;
  return (HUES[i] ??= `hsl(${i}, 100%, 62%)`);
}
/** A lighter tint of that hue for the inner bobs and a flash. */
function lightHueColor(h: number): string {
  const i = ((Math.round(h) % 360) + 360) % 360;
  return (LIGHT_HUES[i] ??= `hsl(${i}, 100%, 84%)`);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
}

/** The harp: every string in its colour, bent by its vibration, glowing while it rings, with a peg at each end. */
export function drawDoublePendulumStrings(ctx: CanvasRenderingContext2D, view: DoublePendulumView, o: DoublePendulumRenderOptions) {
  const f = view.field;
  const g = view.harp;
  const n = view.strings.length;
  if (!f || n === 0 || g.count !== n) return;
  const s = f.scale;
  const now = view.timeSec;
  const base = Math.max(1, 0.75 * o.wallThickness);
  const radial = g.layout === "radial";
  // Room for the bend: most of the gap to the neighbours, never more than a small part of the field.
  const gap = radial ? g.angleStep * 0.5 * (g.hub + g.outer) * s : g.spacing * s;
  const maxDisp = Math.min(0.42 * gap, 0.05 * f.side);
  ctx.save();
  ctx.lineCap = "round";
  for (let k = 0; k < n; k++) {
    const st = view.strings[k];
    const rank = n > 1 ? k / (n - 1) : 0.5;
    const age = now - st.pluckTime;
    const disp = maxDisp * stringDisplacement(age, st.amp, rank);
    const env = stringEnvelope(age, st.amp, rank);
    const color = o.rainbow ? hueColor(st.hue) : o.wallColor(0);
    let x0: number;
    let y0: number;
    let x1: number;
    let y1: number;
    let nx: number;
    let ny: number;
    if (radial) {
      const a = g.firstAngle + k * g.angleStep;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      x0 = f.cx + g.hub * s * c;
      y0 = f.cy + g.hub * s * sn;
      x1 = f.cx + g.outer * s * c;
      y1 = f.cy + g.outer * s * sn;
      nx = -sn;
      ny = c;
    } else {
      const x = f.cx + (g.first + k * g.spacing) * s;
      x0 = x;
      x1 = x;
      y0 = f.cy - 0.97 * g.halfHeight * s;
      y1 = f.cy + 0.97 * g.halfHeight * s;
      nx = 1;
      ny = 0;
    }
    // A quadratic curve whose control point sits 2d off the middle bends the string by d at its middle.
    const cx = 0.5 * (x0 + x1) + 2 * disp * nx;
    const cy = 0.5 * (y0 + y1) + 2 * disp * ny;
    ctx.strokeStyle = color;
    if (env > 0 || o.showGlow) {
      ctx.globalAlpha = 0.08 + 0.3 * env;
      ctx.lineWidth = base + 4 + 6 * env;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.38 + 0.6 * env;
    ctx.lineWidth = base + 1.2 * env;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    const peg = Math.max(1.5, 0.9 * base);
    dot(ctx, x0, y0, peg);
    dot(ctx, x1, y1, peg);
  }
  ctx.restore();
}

/**
 * The trails of the last bobs, newest first: the samples of the last `trailSeconds` of simulation time, stroked in
 * bands of one hue (the pendulum's rainbow at the band's time, so the colours stay on the path they were drawn with)
 * and one opacity and width (falling to zero at the end of the trail). Nothing accumulates between frames.
 */
export function drawDoublePendulumTrails(ctx: CanvasRenderingContext2D, view: DoublePendulumView, o: DoublePendulumRenderOptions) {
  const f = view.field;
  const T = view.settings.trailSeconds;
  if (!f || !o.showTrails || !(T > 0) || view.pendulums.length === 0) return;
  const s = f.scale;
  const now = view.timeSec;
  const bandSec = T / trailBands(view.pendulums.length);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pen of view.pendulums) {
    const last = pen.chain.links - 1;
    const width = Math.max(1.2, 0.5 * pen.radius[last] * s) * o.trailThickness;
    let band = Math.floor(now / bandSec);
    let open = false;
    const stroke = () => {
      const tc = (band + 0.5) * bandSec;
      const fade = trailFade(now - Math.min(now, tc), T);
      if (fade > 0.004) {
        ctx.strokeStyle = hueColor(trailHue(pen.hue, tc, T));
        if (o.showGlow && fade > 0.5) {
          ctx.globalAlpha = 0.12 * fade;
          ctx.lineWidth = 3.2 * width * (0.4 + 0.6 * fade);
          ctx.stroke();
        }
        ctx.globalAlpha = TRAIL_ALPHA * fade;
        ctx.lineWidth = width * (0.35 + 0.65 * fade);
        ctx.stroke();
      }
    };
    ctx.beginPath();
    ctx.moveTo(f.cx + pen.bobX[last] * s, f.cy + pen.bobY[last] * s);
    for (let i = 0; i < pen.trailCount; i++) {
      const j = (pen.trailHead - 1 - i + 2 * TRAIL_CAPACITY) % TRAIL_CAPACITY;
      const t = pen.trailT[j];
      if (now - t > T) break;
      const b = Math.floor(t / bandSec);
      const x = f.cx + pen.trailX[j] * s;
      const y = f.cy + pen.trailY[j] * s;
      if (b !== band) {
        // Close the band up to this sample (so the bands join), stroke it and open the next one here.
        ctx.lineTo(x, y);
        stroke();
        band = b;
        ctx.beginPath();
        ctx.moveTo(x, y);
        open = false;
        continue;
      }
      ctx.lineTo(x, y);
      open = true;
    }
    if (open) stroke();
  }
  ctx.restore();
}

/** Rods, pivots and bobs (rainbow at the trail's head hue, brightened for a moment after a pluck), and the sparring hit flashes. */
export function drawDoublePendulumBodies(ctx: CanvasRenderingContext2D, view: DoublePendulumView, o: DoublePendulumRenderOptions) {
  const f = view.field;
  if (!f || view.pendulums.length === 0) return;
  const s = f.scale;
  const now = view.timeSec;
  const T = view.settings.trailSeconds;
  const rod = Math.max(1.5, 1.1 * o.wallThickness);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pen of view.pendulums) {
    const n = pen.chain.links;
    const pivotX = f.cx + pen.pivotX * s;
    const pivotY = f.cy + pen.pivotY * s;
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = rod;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    for (let k = 0; k < n; k++) ctx.lineTo(f.cx + pen.bobX[k] * s, f.cy + pen.bobY[k] * s);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    dot(ctx, pivotX, pivotY, Math.max(2.5, 1.6 * rod));
    const hue = trailHue(pen.hue, now, T);
    for (let k = 0; k < n; k++) {
      const x = f.cx + pen.bobX[k] * s;
      const y = f.cy + pen.bobY[k] * s;
      const r = pen.radius[k] * s;
      const age = now - pen.pluckTime[k];
      const flash = age >= 0 && age < BOB_FLASH_SEC ? 1 - age / BOB_FLASH_SEC : 0;
      const glow = (o.showGlow ? 0.55 : 0) + 0.7 * flash;
      if (glow > 0.01) {
        ctx.fillStyle = hueColor(hue);
        ctx.globalAlpha = 0.22 * glow;
        dot(ctx, x, y, 1.4 * r + 2);
        ctx.globalAlpha = 0.1 * glow;
        dot(ctx, x, y, 1.9 * r + 4);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = flash > 0.3 || k < n - 1 ? lightHueColor(hue) : hueColor(hue);
      dot(ctx, x, y, r);
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.35 + 0.5 * flash).toFixed(2)})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  // Sparring: a white core and an expanding ring at every recent contact.
  for (const hit of view.hits) {
    const age = now - hit.time;
    if (!(age >= 0 && age < HIT_FLASH_SEC)) continue;
    const k = 1 - age / HIT_FLASH_SEC;
    const x = f.cx + hit.x * s;
    const y = f.cy + hit.y * s;
    const reach = (0.06 + 0.1 * hit.strength) * f.side;
    ctx.globalAlpha = 0.8 * k;
    ctx.fillStyle = "#ffffff";
    dot(ctx, x, y, (0.01 + 0.02 * hit.strength) * f.side * k + 1);
    ctx.globalAlpha = 0.7 * k;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1 + 3 * k;
    ctx.beginPath();
    ctx.arc(x, y, reach * (1 - k) + 2, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.restore();
}

/** The white full-screen flash of a hard sparring hit (screen space, outside the camera transform). */
export function drawDoublePendulumFlash(ctx: CanvasRenderingContext2D, width: number, height: number, view: DoublePendulumView) {
  if (view.lastHitStrength < SCREEN_FLASH_MIN_STRENGTH) return;
  const age = view.timeSec - view.lastHitTime;
  if (!(age >= 0 && age < SCREEN_FLASH_SEC)) return;
  const a = 0.28 * view.lastHitStrength * (1 - age / SCREEN_FLASH_SEC);
  if (a < 0.005) return;
  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
