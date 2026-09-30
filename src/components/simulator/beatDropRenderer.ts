import { END_HOLD_SEC, type BeatDropView } from "@/lib/physics/modes/beatDrop";
import {
  BEAT_DROP_KINDS,
  PAD_GEOMETRY,
  WEDGE_TILT,
  ballDeformAt,
  barPosition,
  beatEnergyAt,
  createBallDeform,
  createBallSample,
  createPadPose,
  landingIndexAt,
  padPoseAt,
  padSurfaceDip,
  sampleBall,
  type BeatDropPadKind,
} from "@/lib/simulation/beatDropPlan";
import { shakeAmplitude, shakeOffset } from "@/lib/simulation/camera";
import type { Ball } from "@/lib/physics/types";

/**
 * Canvas drawing of Beat Drop (feature beat-drop; lib/physics/modes/beatDrop.ts, the plan in lib/simulation/beatDropPlan.ts).
 * Everything here is analytic in time: the canvas hands `beginFrame()` the engine's clock plus its leftover accumulator
 * (the simulation time between the last step and the next one), and the ball, the obstructions, the camera, the trail and
 * the landing effects are all evaluated at that exact time from the plan – so motion is sub-frame smooth at any playback
 * speed, in a recording and in the fast export alike, and a pause freezes it. Per frame the canvas calls:
 *
 *  - `drawBackdrop()` in screen space (the dark gradient, the parallax beat lines and the focus glow pulsing with the beat)
 *    and `applyCamera()` – the mode's critically damped camera (extrapolated between steps), plus the cinematic camera's
 *    screen shake when that feature is on (it kicks on every downbeat) – in place of the classic view;
 *  - `drawWorld()` under the ball: every obstruction alive (flying in with its ease, settled, squashing on impact, glowing
 *    with the beat, sliding away with a fade) and the ball's motion trail;
 *  - `frameBalls()` for the canvas' ordinary ball pass (faces, emoji, glow): the ball where the plan has it at the frame's
 *    time, and `pushBallSquash()` around its body – squashed on impact, stretched along its flight;
 *  - `drawEffects()` over the ball: the ripple rings and particle puffs of the landings;
 *  - `drawOverlay()` in screen space: the title, the tempo, the landing counter and the bar's beats.
 *
 * Nothing is allocated per frame: poses, samples and the pooled ball are reused, colours are cached strings, and the
 * data-bd-* landing log is rebuilt only when a landing was added.
 */

export interface BeatDropRenderOptions {
  wallThickness: number;
  showWallGlow: boolean;
  /** The ball's motion trail (the mode's Trail switch and the Visual section's Trails). */
  showTrail: boolean;
  trailThickness: number;
  /** The Visual section's Colour Trail: the trail runs through the rainbow instead of the ball's colour. */
  colorTrail: boolean;
  /** The team roster's colours (the ball wears the first, "team colour" pads cycle through them); empty = none. */
  teamColors: readonly string[];
  /** The Ball Colour (the ball without a roster, and the team colour mode's fallback). */
  ballColor: string;
}

export interface BeatDropLabels {
  title: string;
  /** "♩ 120 BPM" */
  bpm: (bpm: number) => string;
  /** "12 / 58 landings" */
  landings: (n: number, total: number) => string;
  /** "SONG" badge when the beat is the loaded song's grid. */
  song: string;
  /** The banner on the last landing, and its line. */
  done: string;
  doneSub: (landings: number, errorMs: string) => string;
}

export const DEFAULT_BEAT_DROP_LABELS: BeatDropLabels = {
  title: "BEAT DROP",
  bpm: (bpm) => `♩ ${bpm} BPM`,
  landings: (n, total) => `${n} / ${total} on the beat`,
  song: "SONG",
  done: "ON BEAT!",
  doneSub: (landings, errorMs) => `${landings} landings · ${errorMs} ms off`,
};

/** Colour of each kind in the "pad" colour mode. */
export const PAD_COLORS: Record<BeatDropPadKind, string> = {
  plank: "#2de2e6",
  block: "#ff8f3d",
  spring: "#93d119",
  wedge: "#ff4fd8",
  spinner: "#ffd23f",
  drum: "#ff4d6d",
};

/** How long (s) a landing's ripple and puff last, the puff's particles and their gravity (view units / s²). */
export const RIPPLE_SEC = 0.5;
export const PUFF_SEC = 0.55;
export const PUFF_PARTICLES = 12;
const PUFF_GRAVITY = 1.6;
/** Trail: seconds of flight it shows (at most 60 % of a beat) and its points. */
export const TRAIL_SEC = 0.22;
const TRAIL_POINTS = 28;
/** Pads the drawing looks back / ahead over from the current landing (enough for any overlap of the windows). */
const LOOK_BACK = 10;
const LOOK_AHEAD = 3;
const TWO_PI = Math.PI * 2;

interface Shade {
  base: string;
  light: string;
  dark: string;
}

/** A tiny deterministic hash → [0, 1): the puff's particle directions (visual only, never the physics' stream). */
function hash01(a: number, b: number, salt: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ (salt | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export class BeatDropLayer {
  /** The frame's simulation time (s) and the camera offset (px) it draws with. */
  private t = 0;
  private camPx = 0;
  private energy = 0;
  private current = -1;
  private readonly pose = createPadPose();
  private readonly ball = createBallSample();
  private readonly deform = createBallDeform();
  private readonly trailX = new Float64Array(TRAIL_POINTS + 1);
  private readonly trailY = new Float64Array(TRAIL_POINTS + 1);
  private readonly shake = { x: 0, y: 0 };
  private readonly shadeCache = new Map<string, Shade>();
  private readonly hueCache: Shade[] = [];
  private readonly pooled: Ball = { id: -1, x: 0, y: 0, vx: 0, vy: 0, radius: 8, color: "#ffffff", trail: [], trailIndex: 0, spin: 0, angle: 0 };
  private readonly frame: Ball[] = [];
  private bgKey = "";
  private bg: CanvasGradient | null = null;
  private glowKey = -1;
  private glow: CanvasGradient | null = null;
  /** Obstructions drawn this frame (mirrored as data-bd-alive). */
  alive = 0;
  /** The landing log's text, rebuilt when a landing is added. */
  private logCount = -1;
  private logTimes = "";
  private logBeats = "";

  /** The frame's time: the engine's clock (ms) plus `aheadMs` of simulation time not stepped yet (the canvas' accumulator). */
  beginFrame(view: BeatDropView, engineMs: number, aheadMs: number) {
    const ahead = Math.max(0, Math.min(1000 / 60, Number.isFinite(aheadMs) ? aheadMs : 0));
    this.t = (engineMs + ahead) / 1000;
    const plan = view.plan;
    this.current = landingIndexAt(plan, this.t, this.current);
    this.energy = beatEnergyAt(plan, this.t, this.current);
    this.camPx = (view.camY + view.camV * (ahead / 1000)) * view.field.size;
  }

  /** The frame's simulation time (s). */
  time() {
    return this.t;
  }

  /** The mode's camera (and the cinematic camera's shake, when it has one this frame – `shakeAt`: its age in ms, or null). */
  applyCamera(ctx: CanvasRenderingContext2D, view: BeatDropView, shake: { amount: number; ageMs: number; seed: number } | null) {
    let sx = 0;
    let sy = 0;
    if (shake && shake.amount > 0) {
      shakeOffset(shake.ageMs, shakeAmplitude(shake.amount, view.field.size), shake.seed, this.shake);
      sx = this.shake.x;
      sy = this.shake.y;
    }
    ctx.translate(sx, sy - this.camPx);
  }

  /** Screen space, under everything: the dark gradient, the parallax beat lines and the focus glow on the beat. */
  drawBackdrop(ctx: CanvasRenderingContext2D, view: BeatDropView, width: number, height: number) {
    const f = view.field;
    const S = f.size;
    ctx.save();
    ctx.globalAlpha = 0.93;
    const key = `${width}|${height}`;
    if (key !== this.bgKey || !this.bg) {
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, "#050816");
      g.addColorStop(0.55, "#0b0b24");
      g.addColorStop(1, "#1a0b2e");
      this.bg = g;
      this.bgKey = key;
    }
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, width, height);
    // Beat lines scrolling at half the camera's speed (depth), brighter on the beat.
    const spacing = 0.18 * S;
    const shift = (0.5 * this.camPx) % spacing;
    ctx.globalAlpha = 0.05 + 0.07 * this.energy;
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = -shift; y < height + spacing; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    // Dust drifting at a third of the camera's speed.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#c4b5fd";
    ctx.beginPath();
    const span = height + 0.2 * S;
    for (let i = 0; i < 40; i++) {
      const x = hash01(i, 1, 7) * width;
      const y0 = hash01(i, 2, 7) * span;
      const y = ((((y0 - this.camPx / 3) % span) + span) % span) - 0.1 * S;
      const r = 0.6 + 1.4 * hash01(i, 3, 7);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TWO_PI);
    }
    ctx.fill();
    // The focus glow, pulsing with the beat: a soft flattened radial glow around where the ball lands.
    const e = this.energy;
    if (e > 0.02) {
      const R = 0.5 * S;
      if (this.glowKey !== R || !this.glow) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        g.addColorStop(0, "rgba(147, 209, 25, 0.55)");
        g.addColorStop(0.45, "rgba(147, 209, 25, 0.16)");
        g.addColorStop(1, "rgba(147, 209, 25, 0)");
        this.glow = g;
        this.glowKey = R;
      }
      ctx.globalAlpha = 0.28 * e;
      ctx.translate(f.cx, f.originY);
      ctx.scale(1, 0.28);
      ctx.fillStyle = this.glow;
      ctx.fillRect(-R, -R, 2 * R, 2 * R);
    }
    ctx.restore();
  }

  /** The colour shades of a CSS colour (hex, else used as is). */
  private shadeOf(color: string): Shade {
    let s = this.shadeCache.get(color);
    if (s) return s;
    const rgb = hexToRgb(color);
    if (rgb) {
      const mix = (k: number, to: number) => Math.round(to + (k - to) * 0.45);
      s = {
        base: color,
        light: `rgb(${mix(rgb.r, 255)}, ${mix(rgb.g, 255)}, ${mix(rgb.b, 255)})`,
        dark: `rgb(${Math.round(rgb.r * 0.4)}, ${Math.round(rgb.g * 0.4)}, ${Math.round(rgb.b * 0.4)})`,
      };
    } else s = { base: color, light: color, dark: color };
    if (this.shadeCache.size > 256) this.shadeCache.clear();
    this.shadeCache.set(color, s);
    return s;
  }

  private hueShade(hue: number): Shade {
    const h = ((Math.round(hue) % 360) + 360) % 360;
    let s = this.hueCache[h];
    if (!s) {
      s = { base: `hsl(${h}, 92%, 60%)`, light: `hsl(${h}, 95%, 80%)`, dark: `hsl(${h}, 70%, 26%)` };
      this.hueCache[h] = s;
    }
    return s;
  }

  /** The shades pad `k` is drawn in, by the colour mode. */
  private padShade(view: BeatDropView, k: number, kind: BeatDropPadKind, opts: BeatDropRenderOptions): Shade {
    const mode = view.settings.colorMode;
    if (mode === "rainbow") return this.hueShade(200 + 47 * view.plan.beatIndex[k]);
    if (mode === "team") {
      const colors = opts.teamColors;
      return this.shadeOf(colors.length > 0 ? colors[k % colors.length] : opts.ballColor || "#ffffff");
    }
    return this.shadeOf(PAD_COLORS[kind]);
  }

  /** Under the ball: every obstruction alive this frame and the ball's trail. */
  drawWorld(ctx: CanvasRenderingContext2D, view: BeatDropView, ballRadius: number, opts: BeatDropRenderOptions) {
    const plan = view.plan;
    const f = view.field;
    const S = f.size;
    const t = this.t;
    const cur = this.current;
    ctx.save();
    ctx.globalAlpha = 1;
    this.alive = 0;
    const from = Math.max(0, cur - LOOK_BACK);
    const to = Math.min(plan.count - 1, cur + LOOK_AHEAD);
    for (let k = from; k <= to; k++) {
      if (plan.arriveStart[k] > t || plan.leaveEnd[k] < t) continue;
      const pose = padPoseAt(plan, k, t, this.pose);
      if (!pose.visible || pose.alpha <= 0.01) continue;
      this.alive++;
      const kind = BEAT_DROP_KINDS[plan.kind[k]] ?? "plank";
      const shade = this.padShade(view, k, kind, opts);
      const x = f.cx + (plan.x[k] + pose.ox) * S;
      const top = f.originY + (plan.y[k] + pose.oy) * S + ballRadius;
      const glow = k === cur ? this.energy : 0.25 * this.energy;
      this.drawPad(ctx, kind, k, x, top, pose.angle, pose.squash, pose.alpha, glow, S, shade, view, opts);
    }
    if (opts.showTrail) this.drawTrail(ctx, view, ballRadius, opts);
    ctx.restore();
  }

  private drawPad(ctx: CanvasRenderingContext2D, kind: BeatDropPadKind, k: number, x: number, top: number, angle: number, squash: number, alpha: number, glow: number, S: number, shade: Shade, view: BeatDropView, opts: BeatDropRenderOptions) {
    const geo = PAD_GEOMETRY[kind];
    const hw = geo.halfWidth * S;
    const h = Math.max(3, geo.height * S);
    const sq = Math.max(-0.4, Math.min(0.8, squash));
    const line = Math.max(1, opts.wallThickness * 0.75);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, top);
    if (angle !== 0) {
      // Turn around the pad's middle (the spinner's hub).
      ctx.translate(0, h / 2);
      ctx.rotate(angle);
      ctx.translate(0, -h / 2);
    }
    // The glow with the beat: two soft layers behind the body.
    if (opts.showWallGlow && glow > 0.03) {
      ctx.fillStyle = shade.base;
      ctx.globalAlpha = alpha * 0.1 * glow;
      roundRect(ctx, -hw - 0.03 * S, -0.03 * S, 2 * hw + 0.06 * S, h + 0.06 * S, 0.03 * S);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.2 * glow;
      roundRect(ctx, -hw - 0.012 * S, -0.012 * S, 2 * hw + 0.024 * S, h + 0.024 * S, 0.016 * S);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    ctx.lineWidth = line;
    switch (kind) {
      case "plank": {
        // A bar that bends on impact.
        const bend = sq * 0.6 * h + 0.01 * S * Math.max(0, sq);
        const th = h;
        ctx.fillStyle = shade.base;
        ctx.beginPath();
        ctx.moveTo(-hw, 0);
        ctx.quadraticCurveTo(0, 2 * bend, hw, 0);
        ctx.lineTo(hw, th);
        ctx.quadraticCurveTo(0, th + 2 * bend, -hw, th);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = shade.light;
        ctx.beginPath();
        ctx.moveTo(-hw + 2, line / 2);
        ctx.quadraticCurveTo(0, 2 * bend + line / 2, hw - 2, line / 2);
        ctx.stroke();
        break;
      }
      case "block": {
        const bh = h * (1 - 0.5 * sq);
        const bw = hw * (1 + 0.25 * sq);
        const dy = h - bh;
        ctx.fillStyle = shade.dark;
        roundRect(ctx, -bw, dy, 2 * bw, bh, 0.008 * S);
        ctx.fill();
        ctx.fillStyle = shade.base;
        roundRect(ctx, -bw, dy, 2 * bw, Math.max(2, 0.45 * bh), 0.008 * S);
        ctx.fill();
        ctx.strokeStyle = shade.light;
        roundRect(ctx, -bw, dy, 2 * bw, bh, 0.008 * S);
        ctx.stroke();
        break;
      }
      case "spring": {
        // A cap on a coil on a base plate; the coil compresses (and springs back past rest) with the squash.
        const capH = Math.max(3, 0.28 * h);
        const baseH = Math.max(2, 0.18 * h);
        const drop = sq * (h - capH - baseH) * 0.9;
        const coilTop = capH + drop;
        const coilBottom = h - baseH;
        ctx.strokeStyle = shade.light;
        ctx.lineWidth = Math.max(1.5, 0.006 * S);
        ctx.beginPath();
        const turns = 5;
        const cw = 0.6 * hw;
        for (let i = 0; i <= 2 * turns; i++) {
          const yy = coilTop + ((coilBottom - coilTop) * i) / (2 * turns);
          const xx = i % 2 === 0 ? -cw : cw;
          if (i === 0) ctx.moveTo(0, coilTop);
          ctx.lineTo(i === 2 * turns ? 0 : xx, yy);
        }
        ctx.stroke();
        ctx.fillStyle = shade.dark;
        roundRect(ctx, -hw * 0.8, coilBottom, 1.6 * hw, baseH, 0.004 * S);
        ctx.fill();
        ctx.fillStyle = shade.base;
        roundRect(ctx, -hw, drop, 2 * hw, capH, 0.01 * S);
        ctx.fill();
        break;
      }
      case "wedge": {
        const dir = view.plan.facing[k] || 1;
        const s = dir * hw * Math.tan(WEDGE_TILT);
        const base = Math.abs(s) + h * 0.7;
        const dip = sq * 0.15 * h;
        ctx.fillStyle = shade.base;
        ctx.beginPath();
        ctx.moveTo(-hw, -s + dip);
        ctx.lineTo(hw, s + dip);
        ctx.lineTo(hw, base);
        ctx.lineTo(-hw, base);
        ctx.closePath();
        ctx.fill();
        // The shaded foot of the wedge.
        ctx.fillStyle = shade.dark;
        ctx.fillRect(-hw, base - 0.3 * h, 2 * hw, 0.3 * h);
        ctx.strokeStyle = shade.light;
        ctx.beginPath();
        ctx.moveTo(-hw, -s + dip);
        ctx.lineTo(hw, s + dip);
        ctx.stroke();
        // An arrow on the slope: where the ball goes next.
        ctx.fillStyle = shade.light;
        ctx.beginPath();
        const ax = dir * 0.45 * hw;
        const ay = (ax / hw) * s + 0.55 * h + dip;
        ctx.moveTo(ax + dir * 0.012 * S, ay);
        ctx.lineTo(ax - dir * 0.01 * S, ay - 0.009 * S);
        ctx.lineTo(ax - dir * 0.01 * S, ay + 0.009 * S);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "spinner": {
        // A bar spinning about its hub; faint ghosts behind it while it turns fast.
        const th = Math.max(3, h * (1 - 0.4 * sq));
        const pose = this.pose;
        const spinning = pose.phase === 0 && Math.abs(angle) > 0.05;
        if (spinning) {
          ctx.fillStyle = shade.base;
          for (let i = 1; i <= 2; i++) {
            ctx.save();
            ctx.globalAlpha = alpha * (0.18 / i);
            ctx.translate(0, h / 2);
            ctx.rotate(0.22 * i * Math.sign(angle));
            ctx.translate(0, -h / 2);
            roundRect(ctx, -hw, 0, 2 * hw, th, th / 2);
            ctx.fill();
            ctx.restore();
          }
        }
        ctx.fillStyle = shade.base;
        roundRect(ctx, -hw, (h - th) / 2, 2 * hw, th, th / 2);
        ctx.fill();
        ctx.strokeStyle = shade.light;
        roundRect(ctx, -hw, (h - th) / 2, 2 * hw, th, th / 2);
        ctx.stroke();
        ctx.fillStyle = shade.dark;
        ctx.beginPath();
        ctx.arc(0, h / 2, Math.max(2, 0.6 * th), 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = shade.light;
        ctx.beginPath();
        ctx.arc(0, h / 2, Math.max(1, 0.25 * th), 0, TWO_PI);
        ctx.fill();
        break;
      }
      case "drum": {
        // A drum: the shell, and the head (an ellipse) that dips on impact; the rim flashes with the beat.
        const ry = Math.max(2, 0.018 * S);
        const dip = Math.max(0, sq) * 0.6 * ry;
        ctx.fillStyle = shade.dark;
        ctx.beginPath();
        ctx.moveTo(-hw, 0);
        ctx.lineTo(-hw, h);
        ctx.ellipse(0, h, hw, ry, 0, Math.PI, 0, true);
        ctx.lineTo(hw, 0);
        ctx.closePath();
        ctx.fill();
        // Lugs.
        ctx.strokeStyle = shade.base;
        ctx.lineWidth = Math.max(1, 0.004 * S);
        ctx.beginPath();
        for (let i = -2; i <= 2; i++) {
          const lx = (i / 2.6) * hw;
          ctx.moveTo(lx, 0.25 * h);
          ctx.lineTo(lx, 0.85 * h + ry * Math.sqrt(Math.max(0, 1 - (lx / hw) ** 2)));
        }
        ctx.stroke();
        ctx.fillStyle = shade.light;
        ctx.beginPath();
        ctx.ellipse(0, dip, hw, ry, 0, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = shade.base;
        ctx.lineWidth = Math.max(1.5, line);
        ctx.beginPath();
        ctx.ellipse(0, 0, hw, ry, 0, 0, TWO_PI);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  /** The ball's trail: the planned arc over the last moments, tapering and fading (the bounce bends it). */
  private drawTrail(ctx: CanvasRenderingContext2D, view: BeatDropView, ballRadius: number, opts: BeatDropRenderOptions) {
    const plan = view.plan;
    const f = view.field;
    const S = f.size;
    const span = Math.min(TRAIL_SEC, 0.6 * plan.period);
    const t = this.t;
    const start = Math.max(0, t - span);
    if (!(t - start > 1e-4)) return;
    for (let i = 0; i <= TRAIL_POINTS; i++) {
      const s = sampleBall(plan, start + ((t - start) * i) / TRAIL_POINTS, this.ball, this.current);
      this.trailX[i] = f.cx + s.x * S;
      this.trailY[i] = f.originY + s.y * S;
    }
    const color = opts.teamColors[0] || opts.ballColor || "#ffffff";
    ctx.strokeStyle = color;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    const thick = Math.max(0.2, opts.trailThickness);
    // The rainbow of the Colour Trail flows along the trail with the simulation clock.
    const hue0 = 360 * ((t * 0.35) % 1);
    for (let i = 1; i <= TRAIL_POINTS; i++) {
      const u = i / TRAIL_POINTS;
      if (opts.colorTrail) ctx.strokeStyle = this.hueShade(hue0 + 140 * u).base;
      ctx.globalAlpha = 0.03 + 0.4 * u * u;
      ctx.lineWidth = Math.max(1, ballRadius * thick * (0.15 + 0.95 * u));
      ctx.beginPath();
      ctx.moveTo(this.trailX[i - 1], this.trailY[i - 1]);
      ctx.lineTo(this.trailX[i], this.trailY[i]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The ball the canvas' ball pass draws: the engine's ball moved to where the plan has it at the frame's time (the trail is
   * drawn here, so it has none), in the roster's first colour when there is a roster. The same array every frame.
   */
  frameBalls(balls: readonly Ball[], view: BeatDropView, opts: BeatDropRenderOptions): Ball[] {
    const out = this.frame;
    out.length = 0;
    const live = balls[0];
    if (!live) return out;
    const f = view.field;
    const S = f.size;
    const s = sampleBall(view.plan, this.t, this.ball, this.current);
    const b = this.pooled;
    b.id = live.id;
    b.x = f.cx + s.x * S;
    b.y = f.originY + s.y * S;
    // Pressed into a pad: the ball sinks with the pad's top as it gives.
    const k = s.flight;
    if (k >= 0 && s.since < view.plan.contact[k]) {
      const pose = padPoseAt(view.plan, k, this.t, this.pose);
      b.y += Math.max(0, padSurfaceDip(BEAT_DROP_KINDS[view.plan.kind[k]] ?? "plank", pose.squash)) * S;
    }
    b.vx = s.vx * S;
    b.vy = s.vy * S;
    b.radius = live.radius;
    b.color = opts.teamColors[0] || live.color;
    b.spin = 0;
    // The sprite rolls with the sideways travel (emoji and pictures turn as the ball drifts).
    b.angle = live.radius > 0 ? (s.x * S) / live.radius : 0;
    b.gravityScale = live.gravityScale;
    b.radiusScale = live.radiusScale;
    b.team = live.team;
    b.mult = live.mult;
    b.trail.length = 0;
    b.trailIndex = 0;
    out.push(b);
    return out;
  }

  /** Squash on impact (anchored at the ball's bottom) and stretch along the flight, around the ball's body; true when pushed. */
  pushBallSquash(ctx: CanvasRenderingContext2D, ball: Ball, view: BeatDropView): boolean {
    const d = ballDeformAt(view.plan, this.t, this.deform, this.ball);
    const squashed = Math.abs(d.squashY - 1) > 0.004;
    const stretched = d.stretch > 1.004;
    if (!squashed && !stretched) return false;
    const r = ball.radius;
    ctx.save();
    ctx.translate(ball.x, ball.y);
    if (squashed) {
      ctx.translate(0, r);
      ctx.scale(d.squashX, d.squashY);
      ctx.translate(0, -r);
    }
    if (stretched) {
      ctx.rotate(d.stretchAngle);
      ctx.scale(d.stretch, 1 / Math.sqrt(d.stretch));
      ctx.rotate(-d.stretchAngle);
    }
    ctx.translate(-ball.x, -ball.y);
    return true;
  }

  /** Over the ball: the ripple ring and the particle puff of the latest landings, in the pad's colour. */
  drawEffects(ctx: CanvasRenderingContext2D, view: BeatDropView, ballRadius: number, opts: BeatDropRenderOptions) {
    const plan = view.plan;
    const f = view.field;
    const S = f.size;
    const t = this.t;
    const cur = this.current;
    if (cur < 0) return;
    ctx.save();
    for (let k = cur; k >= Math.max(0, cur - 3); k--) {
      const age = t - plan.t[k];
      if (age < 0 || age > Math.max(RIPPLE_SEC, PUFF_SEC)) continue;
      const kind = BEAT_DROP_KINDS[plan.kind[k]] ?? "plank";
      const shade = this.padShade(view, k, kind, opts);
      const x = f.cx + plan.x[k] * S;
      const y = f.originY + plan.y[k] * S + ballRadius;
      const hw = PAD_GEOMETRY[kind].halfWidth * S;
      if (age < RIPPLE_SEC) {
        const u = age / RIPPLE_SEC;
        const e = 1 - (1 - u) * (1 - u) * (1 - u);
        ctx.globalAlpha = 0.75 * (1 - u);
        ctx.strokeStyle = shade.light;
        ctx.lineWidth = Math.max(1, 0.006 * S * (1 - 0.6 * u));
        ctx.beginPath();
        ctx.ellipse(x, y, hw * (0.6 + 1.8 * e), 0.02 * S * (0.6 + 1.8 * e), 0, 0, TWO_PI);
        ctx.stroke();
        if (plan.downbeat[k] === 1) {
          ctx.globalAlpha = 0.3 * (1 - u) * (1 - u);
          ctx.beginPath();
          ctx.ellipse(x, y, hw * (1 + 2.6 * e), 0.03 * S * (1 + 2.6 * e), 0, 0, TWO_PI);
          ctx.stroke();
        }
      }
      if (age < PUFF_SEC) {
        const u = age / PUFF_SEC;
        ctx.globalAlpha = 0.9 * (1 - u);
        ctx.fillStyle = shade.base;
        ctx.beginPath();
        for (let i = 0; i < PUFF_PARTICLES; i++) {
          const a = -Math.PI * (0.08 + 0.84 * hash01(k, i, view.salt));
          const sp = (0.25 + 0.6 * hash01(k, i + 101, view.salt)) * (plan.downbeat[k] === 1 ? 1.35 : 1);
          const px = x + (hash01(k, i + 202, view.salt) - 0.5) * 1.2 * hw + Math.cos(a) * sp * age * S;
          const py = y + (Math.sin(a) * sp * age + 0.5 * PUFF_GRAVITY * age * age) * S;
          const r = Math.max(0.8, 0.006 * S * (1 - u) * (0.6 + hash01(k, i + 303, view.salt)));
          ctx.moveTo(px + r, py);
          ctx.arc(px, py, r, 0, TWO_PI);
        }
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Screen space: the title, the tempo and the landing counter at the top of the square the recorder crops to, and the
   * bar's four beats (the current one lit, the downbeat larger); `inset` moves it below the page's buttons.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: BeatDropView, labels: BeatDropLabels, inset = 0) {
    const f = view.field;
    if (!(f.size > 0)) return;
    const S = f.size;
    const left = f.cx - S / 2 + 0.035 * S;
    const top = f.top + 0.03 * S + inset;
    const fs = Math.max(11, 0.03 * S);
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${fs.toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.fillText(labels.title, left, top + 0.6 * fs);
    ctx.font = `600 ${(0.8 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "#93d119";
    const tempo = labels.bpm(Math.round(view.bpm));
    ctx.fillText(view.song ? `${tempo} · ${labels.song}` : tempo, left, top + 1.85 * fs);
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillText(labels.landings(view.landed, view.plannedLandings), left, top + 2.95 * fs);
    // The bar: four dots, the current beat lit (the one the ball last landed on).
    const k = this.current;
    const pos = k >= 0 ? barPosition(view.plan.beatIndex[k]) : -1;
    const dotY = top + 4.05 * fs;
    for (let i = 0; i < 4; i++) {
      const on = i === pos;
      const r = (i === 0 ? 0.3 : 0.22) * fs * (on ? 1 + 0.5 * this.energy : 1);
      ctx.globalAlpha = on ? 0.5 + 0.5 * this.energy : 0.25;
      ctx.fillStyle = on ? "#93d119" : "#ffffff";
      ctx.beginPath();
      ctx.arc(left + 0.3 * fs + i * 0.85 * fs, dotY, r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /** True from the clip's last landing until the run ends (the ON BEAT! banner's window). */
  finale(view: BeatDropView): boolean {
    return view.plannedLandings > 0 && view.landed >= view.plannedLandings && view.timeMs >= view.finishMs - 1000 * END_HOLD_SEC - 1e-6;
  }

  /** The landing log's text (ms, three decimals, oldest first) and the beats they were planned for; rebuilt on a new landing. */
  landingLog(view: BeatDropView): { times: string; beats: string } {
    if (view.logCount !== this.logCount) {
      this.logCount = view.logCount;
      const n = Math.min(view.logCount, view.landingMs.length);
      const first = view.logCount - n;
      let times = "";
      let beats = "";
      for (let i = 0; i < n; i++) {
        const slot = (first + i) % view.landingMs.length;
        times += (i ? "," : "") + view.landingMs[slot].toFixed(3);
        beats += (i ? "," : "") + view.beatMs[slot].toFixed(3);
      }
      this.logTimes = times;
      this.logBeats = beats;
    }
    return { times: this.logTimes, beats: this.logBeats };
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** The data-bd-* attributes the canvas mirrors for tools and the smoke test. */
export const BEAT_DROP_DATA_KEYS = [
  "bdLanded",
  "bdPlanned",
  "bdLandingTimes",
  "bdBeatTimes",
  "bdMaxErrorMs",
  "bdBpm",
  "bdSong",
  "bdAlive",
  "bdKicks",
  "bdSnares",
  "bdHats",
  "bdNotes",
  "bdDownbeats",
  "bdScroll",
  "bdCamera",
  "bdFinished",
  "bdFinishedMs",
  "bdFinishMs",
  "bdTimeMs",
];

export function writeBeatDropDataset(view: BeatDropView, layer: BeatDropLayer, set: (key: string, value: string) => void) {
  const log = layer.landingLog(view);
  set("bdLanded", String(view.landed));
  set("bdPlanned", String(view.plannedLandings));
  set("bdLandingTimes", log.times);
  set("bdBeatTimes", log.beats);
  set("bdMaxErrorMs", view.maxErrorMs.toFixed(6));
  set("bdBpm", String(Math.round(view.bpm * 100) / 100));
  set("bdSong", view.song ? "1" : "0");
  set("bdAlive", String(layer.alive));
  set("bdKicks", String(view.kicks));
  set("bdSnares", String(view.snares));
  set("bdHats", String(view.hats));
  set("bdNotes", String(view.notes));
  set("bdDownbeats", String(view.downbeats));
  set("bdScroll", view.settings.scroll);
  set("bdCamera", view.camY.toFixed(3));
  set("bdFinished", view.finished ? "1" : "0");
  set("bdFinishedMs", String(Math.round(view.finishedMs)));
  set("bdFinishMs", String(Math.round(view.finishMs)));
  set("bdTimeMs", String(Math.round(view.timeMs)));
}
