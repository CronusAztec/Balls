import type { Ball } from "@/lib/physics/types";
import { CEILING_CONTACTS, CEILING_THICKNESS, MAX_PL_PARTICLES, PARTICLE_GRAVITY, layerHue, stackTopAt, type PlSequence, type PowerLayersView } from "@/lib/physics/modes/powerLayers";
import { WOBBLE_MAX_AGE_SEC, saturateWobble, wobbleDisplacement } from "@/lib/physics/wobble";

/**
 * Canvas side of the Power Layers mode (feature odd-power-layers; lib/physics/modes/powerLayers.ts has the physics).
 * One `PowerLayersLayer` lives with the draw loop and draws, in the oddplayground look – neon on black, a navy portrait
 * playfield with a thin grey frame, glowing things with soft colour halos:
 *  - `drawWorld()` (world space, under the ball): the playfield, the stack of rainbow layers (pre-rendered once per
 *    layer count and size into an off-screen canvas and blitted from the current top down, so 800 layers cost one
 *    `drawImage`), the glow of the top layer, the white flash of the band a hit destroyed, the ceiling bar – bending
 *    where the ball touched it with the wobbly-walls wave of lib/physics/wobble.ts – and the ball's colour halo;
 *  - `drawParticles()` (over the ball): the analytic shatter particles, clipped to the playfield;
 *  - `drawOverlay()` (screen space, part of the recording): the corner badge (SOUND ON, the flashing-lights warning or
 *    both), the two rainbow rule pills with the power and the level, and the layers left under the stack.
 * Nothing here allocates per frame beyond the canvas API's own strings: colours come from tables, gradients and the
 * pre-rendered stack are cached until the size changes.
 */

export interface PowerLayersLabels {
  /** The rule text of every sequence ("Each hit x2 the power", "fibonacci cooked this run" …). */
  rules: Record<PlSequence, string>;
  power: (n: string) => string;
  level: (n: number) => string;
  newSound: string;
  soundOn: string;
  warningTop: string;
  warningBottom: string;
  layersLeft: (n: number) => string;
  freedom: string;
  freedomSub: (hits: number, seconds: string) => string;
}

export const DEFAULT_POWER_LAYERS_LABELS: PowerLayersLabels = {
  rules: {
    double: "Each hit x2 the power",
    fibonacci: "fibonacci cooked this run",
    primes: "prime numbers took over",
    plusOne: "every hit +1",
    random: "chaos picks the power",
  },
  power: (n) => `power ${n}`,
  level: (n) => `level ${n}`,
  newSound: "new sound every level",
  soundOn: "SOUND ON",
  warningTop: "FLASHING LIGHTS",
  warningBottom: "THE END GETS INTENSE",
  layersLeft: (n) => `${n} layer${n !== 1 ? "s" : ""} left`,
  freedom: "FREEDOM!",
  freedomSub: (hits, seconds) => `${hits} hit${hits !== 1 ? "s" : ""} · ${seconds}s`,
};

export interface PowerLayersRenderOptions {
  /** The wall colour (the Wall section's colour or the rainbow), for the ceiling bar. */
  wallColor: (index: number, alpha?: number, angle?: number) => string;
  showWallGlow: boolean;
  /** Device pixel ratio of the canvas (the stack is pre-rendered at device resolution). */
  dpr: number;
}

/** The playfield colour and its thin grey frame. */
export const PL_NAVY = "#070b1f";
const PL_FRAME = "rgba(150, 156, 176, 0.5)";
/** Points along the ceiling bar while it wobbles. */
const CEILING_POINTS = 40;
/** How far the bar bends at most, in field heights. */
const CEILING_WOBBLE = 0.018;
/** Hue buckets of the colour tables (5° each). */
const HUE_BUCKETS = 72;

function hueIndex(hue: number): number {
  return ((Math.round(hue / (360 / HUE_BUCKETS)) % HUE_BUCKETS) + HUE_BUCKETS) % HUE_BUCKETS;
}

/** A rounded-rectangle path (arcTo, so it works where `roundRect` does not). */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/** A power for the pill: whole numbers, thousands grouped with thin spaces. */
export function formatPower(n: number): string {
  const v = Math.max(0, Math.round(n));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export class PowerLayersLayer {
  private stack: HTMLCanvasElement | null = null;
  private stackKey = "";
  private readonly halos: (HTMLCanvasElement | null)[] = new Array(HUE_BUCKETS).fill(null);
  private haloKey = "";
  private readonly solid: string[] = [];
  private readonly glow: string[] = [];
  private readonly wobble = new Float32Array(CEILING_POINTS + 1);
  private readonly pillGradients: ({ key: string; gradient: CanvasGradient } | null)[] = [null, null];
  /** Particles drawn in the last frame (mirrored for tools and the smoke test). */
  particlesDrawn = 0;

  constructor() {
    for (let i = 0; i < HUE_BUCKETS; i++) {
      const h = i * (360 / HUE_BUCKETS);
      this.solid.push(`hsl(${h}, 100%, 62%)`);
      this.glow.push(`hsla(${h}, 100%, 70%, 0.9)`);
    }
  }

  /** Pre-renders every layer of the stack (device pixels) into an off-screen canvas; rebuilt when the count or the size changes. */
  private stackImage(view: PowerLayersView, dpr: number): HTMLCanvasElement | null {
    const f = view.field;
    const w = Math.max(1, Math.round(f.width * dpr));
    const h = Math.max(1, Math.round((f.stackBottom - f.stackTop) * dpr));
    const key = `${view.layers}|${w}|${h}`;
    if (this.stack && this.stackKey === key) return this.stack;
    if (typeof document === "undefined") return null;
    const canvas = this.stack ?? document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return null;
    const L = Math.max(1, view.layers);
    const spacing = h / L;
    const core = Math.max(1, 0.55 * spacing);
    const halo = Math.max(core + 1, 1.8 * spacing);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < L; i++) {
      const hue = Math.round(layerHue(i, L));
      const y = (i + 0.5) * spacing;
      g.fillStyle = `hsla(${hue}, 100%, 58%, 0.22)`;
      g.fillRect(0, y - halo / 2, w, halo);
      g.fillStyle = `hsl(${hue}, 100%, 62%)`;
      g.fillRect(0, y - core / 2, w, core);
    }
    this.stack = canvas;
    this.stackKey = key;
    return canvas;
  }

  /** A soft radial halo of hue bucket `bucket` for a ball of radius `r` (cached per bucket until the whole-pixel size changes). */
  private halo(bucket: number, r: number, dpr: number): HTMLCanvasElement | null {
    const radius = Math.max(1, Math.round(r));
    const key = `${radius}|${dpr}`;
    if (key !== this.haloKey) {
      this.halos.fill(null);
      this.haloKey = key;
    }
    const cached = this.halos[bucket];
    if (cached) return cached;
    if (typeof document === "undefined") return null;
    const R = 4.5 * radius;
    const size = Math.max(2, Math.ceil(2 * R * dpr));
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    if (!g) return null;
    const h = bucket * (360 / HUE_BUCKETS);
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `hsla(${h}, 100%, 70%, 0.55)`);
    grad.addColorStop(0.35, `hsla(${h}, 100%, 60%, 0.22)`);
    grad.addColorStop(1, `hsla(${h}, 100%, 55%, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    this.halos[bucket] = c;
    return c;
  }

  /** The playfield, the stack, the flashes, the ceiling bar and the ball's halo (world space, before the balls). */
  drawWorld(ctx: CanvasRenderingContext2D, view: PowerLayersView, balls: readonly Ball[], o: PowerLayersRenderOptions) {
    const f = view.field;
    const t = view.timeSec;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PL_NAVY;
    ctx.fillRect(f.left, f.top, f.width, f.height);
    ctx.strokeStyle = PL_FRAME;
    ctx.lineWidth = 1;
    ctx.strokeRect(f.left + 0.5, f.top + 0.5, f.width - 1, f.height - 1);

    // The stack from its current top down.
    const top = stackTopAt(f, view.gone, view.layers);
    const stackH = f.stackBottom - f.stackTop;
    if (view.gone < view.layers && stackH > 0) {
      const img = this.stackImage(view, o.dpr);
      if (img) {
        const sy = Math.max(0, Math.min(img.height - 1, ((top - f.stackTop) / stackH) * img.height));
        const sh = img.height - sy;
        if (sh >= 0.5) ctx.drawImage(img, 0, sy, img.width, sh, f.left, top, f.width, f.stackBottom - top);
      }
      // The top layer glows – brighter for a moment after a hit.
      const since = t - view.lastHitSec;
      const pulse = since >= 0 && since < 0.4 ? 1 - since / 0.4 : 0;
      const hue = hueIndex(layerHue(view.gone, view.layers));
      const spacing = stackH / Math.max(1, view.layers);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.25 + 0.35 * pulse;
      ctx.fillStyle = this.solid[hue];
      const band = Math.max(4, 3 * spacing) * (1 + 1.5 * pulse);
      ctx.fillRect(f.left, top - band / 2, f.width, band);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = this.glow[hue];
      ctx.fillRect(f.left, top - 0.75, f.width, Math.max(1.5, 0.6 * spacing));
      ctx.globalCompositeOperation = "source-over";
    }
    // The band the last hit destroyed flashes white, and a big hit lights up the whole field.
    const flashAge = t - view.lastHitSec;
    if (flashAge >= 0 && flashAge < 0.35 && view.flashTo > view.flashFrom) {
      const y0 = stackTopAt(f, view.flashFrom, view.layers);
      const y1 = stackTopAt(f, view.flashTo, view.layers);
      const k = 1 - flashAge / 0.35;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.85 * k * k;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(f.left, y0 - 1, f.width, Math.max(2, y1 - y0 + 2));
      ctx.globalCompositeOperation = "source-over";
    }
    const bigAge = t - view.lastBigSec;
    if (bigAge >= 0 && bigAge < 0.3) {
      ctx.globalAlpha = 0.16 * (1 - bigAge / 0.3);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(f.left, f.top, f.width, f.height);
    }

    this.drawCeiling(ctx, view, o);

    // The ball's soft halo in the colour of the layer it is about to hit.
    const ball = balls.length > 0 ? balls[0] : null;
    if (ball && !view.freed) {
      const bucket = hueIndex(layerHue(Math.min(view.gone, view.layers - 1), view.layers));
      const sprite = this.halo(bucket, ball.radius, o.dpr);
      if (sprite) {
        const R = 4.5 * ball.radius;
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(sprite, ball.x - R, ball.y - R, 2 * R, 2 * R);
        ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.restore();
  }

  /** The ceiling bar: glowing in the wall colour, brighter and bent upward where the ball just touched it. */
  private drawCeiling(ctx: CanvasRenderingContext2D, view: PowerLayersView, o: PowerLayersRenderOptions) {
    const f = view.field;
    const t = view.timeSec;
    const thick = Math.max(3, CEILING_THICKNESS * f.height);
    const y = f.ceiling - thick / 2;
    // The wobble of the recent contacts (the ring-wall wave of wobble.ts, the bar mapped onto half a turn).
    let moving = false;
    let touch = 0;
    for (let c = 0; c < CEILING_CONTACTS; c++) {
      const age = t - view.ceilingSec[c];
      if (age >= 0 && age < WOBBLE_MAX_AGE_SEC) moving = true;
      if (age >= 0 && age < 0.5) touch = Math.max(touch, 1 - age / 0.5);
    }
    const amp = CEILING_WOBBLE * f.height;
    const ys = this.wobble;
    for (let i = 0; i <= CEILING_POINTS; i++) {
      let d = 0;
      if (moving) {
        const phi = (Math.PI * i) / CEILING_POINTS;
        for (let c = 0; c < CEILING_CONTACTS; c++) {
          const age = t - view.ceilingSec[c];
          if (age >= 0 && age < WOBBLE_MAX_AGE_SEC) d += wobbleDisplacement(phi, Math.PI * view.ceilingX[c], age, 1);
        }
      }
      ys[i] = y - amp * saturateWobble(d);
    }
    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i <= CEILING_POINTS; i++) {
        const x = f.left + (f.width * i) / CEILING_POINTS;
        if (i === 0) ctx.moveTo(x, ys[i]);
        else ctx.lineTo(x, ys[i]);
      }
    };
    ctx.save();
    // The glow stays inside the playfield.
    ctx.beginPath();
    ctx.rect(f.left, f.top, f.width, f.height);
    ctx.clip();
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    const color = o.wallColor(0, undefined, 0);
    if (o.showWallGlow) {
      // A soft neon glow: the bar blurred once, added onto the navy (brighter for a moment after a touch).
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.45 + 0.4 * touch;
      ctx.shadowColor = color;
      ctx.shadowBlur = thick * (2.5 + 2 * touch);
      ctx.lineWidth = thick;
      ctx.strokeStyle = color;
      trace();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = thick;
    ctx.strokeStyle = color;
    trace();
    ctx.stroke();
    // A white core along the underside, where the ball bounces.
    ctx.lineWidth = Math.max(1, 0.25 * thick);
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.55 + 0.45 * touch).toFixed(2)})`;
    trace();
    ctx.stroke();
    ctx.restore();
  }

  /** The shatter particles, analytic in time, clipped to the playfield (over the ball). */
  drawParticles(ctx: CanvasRenderingContext2D, view: PowerLayersView) {
    const f = view.field;
    const t = view.timeSec;
    let drawn = 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.left, f.top, f.width, f.height);
    ctx.clip();
    for (let i = 0; i < MAX_PL_PARTICLES; i++) {
      const age = t - view.partT0[i];
      const life = view.partLife[i];
      if (!(age >= 0 && age < life)) continue;
      const x = f.left + (view.partX[i] + view.partVx[i] * age) * f.width;
      const y = f.top + (view.partY[i] + view.partVy[i] * age + 0.5 * PARTICLE_GRAVITY * age * age) * f.height;
      const size = Math.max(1, view.partSize[i] * f.height);
      ctx.globalAlpha = 1 - age / life;
      ctx.fillStyle = this.solid[hueIndex(view.partHue[i])];
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      drawn++;
    }
    ctx.restore();
    this.particlesDrawn = drawn;
  }

  /** A rainbow pill centred at `cy` with `text`, shrunk to fit the playfield; `slot` keys its cached gradient. Returns its bottom edge (screen y). */
  private pill(ctx: CanvasRenderingContext2D, view: PowerLayersView, text: string, cy: number, slot: number): number {
    const f = view.field;
    let fs = Math.max(9, 0.027 * f.height);
    ctx.font = `700 ${fs}px sans-serif`;
    let tw = ctx.measureText(text).width;
    const maxW = 0.94 * f.width - 1.6 * fs;
    if (tw > maxW && tw > 0) {
      fs = Math.max(7, (fs * maxW) / tw);
      ctx.font = `700 ${fs}px sans-serif`;
      tw = ctx.measureText(text).width;
    }
    const w = tw + 1.6 * fs;
    const h = 1.75 * fs;
    const x0 = f.cx - w / 2;
    const y0 = cy - h / 2;
    const key = `${Math.round(x0)}|${Math.round(w)}`;
    let entry = this.pillGradients[slot];
    if (!entry || entry.key !== key) {
      const gradient = ctx.createLinearGradient(x0, 0, x0 + w, 0);
      for (let i = 0; i <= 6; i++) gradient.addColorStop(i / 6, `hsl(${Math.round((i * 300) / 6)}, 100%, 62%)`);
      entry = { key, gradient };
      this.pillGradients[slot] = entry;
    }
    roundedRect(ctx, x0, y0, w, h, h / 2);
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = "rgba(8, 12, 34, 0.9)";
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1.5, 0.12 * fs);
    ctx.strokeStyle = entry.gradient;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, f.cx, cy + 0.05 * fs);
    return y0 + h;
  }

  /** "SOUND ON" with a little speaker, top-left (or top-right when the warning takes the left corner). Returns its bottom edge. */
  private soundBadge(ctx: CanvasRenderingContext2D, view: PowerLayersView, text: string, right: boolean): number {
    const f = view.field;
    const fs = Math.max(8, 0.02 * f.height);
    ctx.font = `800 ${fs}px sans-serif`;
    const icon = 1.1 * fs;
    const w = ctx.measureText(text).width + icon + 1.9 * fs;
    const h = 1.9 * fs;
    const pad = 0.025 * f.width;
    const x0 = right ? f.right - pad - w : f.left + pad;
    const y0 = f.top + 0.022 * f.height;
    roundedRect(ctx, x0, y0, w, h, 0.45 * h);
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.stroke();
    // The speaker: a box, a cone and two sound arcs.
    const sx = x0 + 0.7 * fs;
    const sy = y0 + h / 2;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(sx, sy - 0.2 * icon);
    ctx.lineTo(sx + 0.25 * icon, sy - 0.2 * icon);
    ctx.lineTo(sx + 0.55 * icon, sy - 0.45 * icon);
    ctx.lineTo(sx + 0.55 * icon, sy + 0.45 * icon);
    ctx.lineTo(sx + 0.25 * icon, sy + 0.2 * icon);
    ctx.lineTo(sx, sy + 0.2 * icon);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, 0.1 * fs);
    for (let k = 1; k <= 2; k++) {
      ctx.beginPath();
      ctx.arc(sx + 0.55 * icon, sy, 0.22 * icon * k, -Math.PI / 4, Math.PI / 4);
      ctx.stroke();
    }
    ctx.textAlign = "left";
    ctx.fillText(text, sx + icon + 0.35 * fs, sy + 0.05 * fs);
    ctx.textAlign = "center";
    return y0 + h;
  }

  /** The flashing-lights warning: a yellow triangle and two lines, top-left. Returns its bottom edge. */
  private warningBadge(ctx: CanvasRenderingContext2D, view: PowerLayersView, top: string, bottom: string): number {
    const f = view.field;
    const fs = Math.max(7, 0.017 * f.height);
    ctx.font = `800 ${fs}px sans-serif`;
    const icon = 1.9 * fs;
    const w = Math.max(ctx.measureText(top).width, ctx.measureText(bottom).width) + icon + 1.6 * fs;
    const h = 3.1 * fs;
    const x0 = f.left + 0.025 * f.width;
    const y0 = f.top + 0.022 * f.height;
    roundedRect(ctx, x0, y0, w, h, 0.3 * fs);
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#facc15";
    ctx.stroke();
    const tx = x0 + 0.5 * fs;
    const ty = y0 + h / 2;
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(tx + icon / 2, ty - 0.45 * icon);
    ctx.lineTo(tx + icon, ty + 0.4 * icon);
    ctx.lineTo(tx, ty + 0.4 * icon);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#000000";
    ctx.font = `900 ${0.9 * fs}px sans-serif`;
    ctx.fillText("!", tx + icon / 2, ty + 0.12 * icon);
    ctx.font = `800 ${fs}px sans-serif`;
    ctx.fillStyle = "#facc15";
    ctx.textAlign = "left";
    ctx.fillText(top, tx + icon + 0.45 * fs, ty - 0.62 * fs);
    ctx.fillText(bottom, tx + icon + 0.45 * fs, ty + 0.68 * fs);
    ctx.textAlign = "center";
    return y0 + h;
  }

  /**
   * The badges, the rule pills and the layers left (screen space, inside the recorded square). Returns the screen y of the
   * lowest of the top items drawn – the second rule pill, else the corner badge – (0: none), which the top captions start below.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: PowerLayersView, labels: PowerLayersLabels): number {
    const f = view.field;
    const s = view.settings;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let topBottom = 0; // --- review fix (modes-gerald-odd) --- the lowest top item, for the captions
    if (s.badge === "warning" || s.badge === "both") topBottom = Math.max(topBottom, this.warningBadge(ctx, view, labels.warningTop, labels.warningBottom));
    if (s.badge === "sound" || s.badge === "both") topBottom = Math.max(topBottom, this.soundBadge(ctx, view, labels.soundOn, s.badge === "both"));
    if (s.pills) {
      topBottom = Math.max(topBottom, this.pill(ctx, view, `${labels.rules[view.sequence]} · ${labels.power(formatPower(view.power))}`, f.top + 0.125 * f.height, 0));
      topBottom = Math.max(topBottom, this.pill(ctx, view, `${labels.level(view.level)} · ${labels.newSound}`, f.top + 0.195 * f.height, 1));
    }
    if (!view.freed) {
      const fs = Math.max(8, 0.021 * f.height);
      ctx.font = `600 ${fs}px sans-serif`;
      const text = labels.layersLeft(view.layers - view.gone);
      const y = f.bottom - 0.018 * f.height;
      ctx.lineWidth = Math.max(2, 0.2 * fs);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.strokeText(text, f.cx, y);
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.fillText(text, f.cx, y);
    }
    ctx.restore();
    return topBottom;
  }
}
