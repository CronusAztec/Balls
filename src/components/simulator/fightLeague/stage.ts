import { DC_CRACK, DC_SCAR, DC_SCORCH, EV_RIM, FL_DECAL_CAP, FL_EVENT_CAP, type FightLeagueView } from "@/lib/physics/modes/fightLeague";
import type { FlFrame } from "./frame";
import { INK, matchDivision, withAlpha, type FlArenaLook, type FlStagePalette } from "./palette";
import { TWO_PI, hash, makeSprite, newCanvas, polygonPath, type Sprite } from "./sprites";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's stage: the backdrop the mode paints over the whole canvas (lilac: a vertical
 * gradient with faint 45° stripes; night: near-black with a vignette; theme: nothing – the page's theme shows, today's
 * look), the same backdrop in the letterbox bars of an export, and the arena as a pre-rendered plate (its soft drop shadow,
 * the floor and the style's motif, the rim) drawn with one drawImage, under the live overlays: the slow-time veil and its
 * clock wipe, the decals (cracks, scorches, scars), the rim flashes and – during sudden death – the lost ground.
 *
 * The backdrop is rendered once per stage, size and scale on its own canvas (its gradient, stripes and vignette) and blitted
 * – the whole canvas on the page, only the bars round the square in an export: no gradient or pattern on a steady frame, no
 * full-frame shader fill a recorded frame; the plate is rebuilt only when the field, the scale, the stage or the style changes.
 */

/** A backdrop pre-rendered once per stage and size (and scale): one blit a frame instead of gradient and pattern fills. */
interface Backdrop {
  key: string;
  canvas: HTMLCanvasElement | null;
}

const emptyBackdrop = (): Backdrop => ({ key: "", canvas: null });

/** The square an export draws over its backdrop (frame px): only the bars around it are blitted. */
export interface FlExportSquare {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export class FlStagePainter {
  private readonly live = emptyBackdrop();
  private readonly exported = emptyBackdrop();
  private tile: HTMLCanvasElement | null = null;
  private plate: Sprite | null = null;
  private plateKey = "";
  private scorch: Sprite | null = null;

  /** The 64 px stripe tile (3 % white at 45°), built once. */
  private stripeTile(color: string): HTMLCanvasElement | null {
    if (this.tile) return this.tile;
    const c = newCanvas(64, 64);
    const g = c?.getContext("2d");
    if (!c || !g) return null;
    g.strokeStyle = color;
    g.lineWidth = 16;
    g.beginPath();
    for (let k = -1; k <= 1; k++) {
      g.moveTo(k * 64 - 8, 72);
      g.lineTo(k * 64 + 72, -8);
    }
    g.stroke();
    this.tile = c;
    return c;
  }

  /**
   * The stage's backdrop at `w` × `h` (× `scale` device px), rendered once on its own canvas – the vertical gradient, the
   * faint stripes, the night's vignette – and kept until the stage, the size or the scale changes (null on the theme stage).
   */
  private backdrop(cache: Backdrop, pal: FlStagePalette, w: number, h: number, scale: number): HTMLCanvasElement | null {
    if (!pal.backdropTop || !pal.backdropBottom || !(w > 0) || !(h > 0)) return null;
    const k = Math.max(0.25, Number.isFinite(scale) ? scale : 1);
    const key = `${pal.stage}|${w}|${h}|${k}`;
    if (cache.key === key) return cache.canvas;
    cache.key = key;
    cache.canvas = null;
    const c = newCanvas(w * k, h * k);
    const g = c?.getContext("2d");
    if (!c || !g) return null;
    g.setTransform(k, 0, 0, k, 0, 0);
    const grad = typeof g.createLinearGradient === "function" ? g.createLinearGradient(0, 0, 0, h) : null;
    if (grad) {
      grad.addColorStop(0, pal.backdropTop);
      grad.addColorStop(1, pal.backdropBottom);
    }
    g.fillStyle = grad ?? pal.backdropTop;
    g.fillRect(0, 0, w, h);
    const tile = pal.stripe ? this.stripeTile(pal.stripe) : null;
    const stripes = tile && typeof g.createPattern === "function" ? g.createPattern(tile, "repeat") : null;
    if (stripes) {
      g.fillStyle = stripes;
      g.fillRect(0, 0, w, h);
    }
    if (pal.vignette && typeof g.createRadialGradient === "function") {
      const vignette = g.createRadialGradient(w / 2, h / 2, 0.25 * Math.min(w, h), w / 2, h / 2, 0.75 * Math.hypot(w, h));
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
      g.fillStyle = vignette;
      g.fillRect(0, 0, w, h);
    }
    cache.canvas = c;
    return c;
  }

  /** The stage's backdrop over the whole canvas (`w` × `h` CSS px drawn at `scale` device px each; nothing on the theme stage): one blit. */
  drawBackdrop(ctx: CanvasRenderingContext2D, pal: FlStagePalette, w: number, h: number, scale = 1) {
    const c = this.backdrop(this.live, pal, w, h, scale);
    if (!c) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(c, 0, 0, w, h);
    ctx.restore();
  }

  /**
   * The backdrop in an export frame's bars (`w` × `h` frame px; the letterbox continues the page): only the regions round the
   * `square` are blitted – the square is drawn over the rest – or the whole frame without one.
   */
  paintExport(ctx: CanvasRenderingContext2D, pal: FlStagePalette, w: number, h: number, square: FlExportSquare | null = null) {
    const c = this.backdrop(this.exported, pal, w, h, 1);
    if (!c) return;
    ctx.save();
    ctx.globalAlpha = 1;
    if (!square) ctx.drawImage(c, 0, 0, w, h);
    else {
      const blit = (x: number, y: number, bw: number, bh: number) => {
        const x0 = Math.max(0, Math.floor(x));
        const y0 = Math.max(0, Math.floor(y));
        const x1 = Math.min(w, Math.ceil(x + bw));
        const y1 = Math.min(h, Math.ceil(y + bh));
        if (x1 - x0 >= 1 && y1 - y0 >= 1) ctx.drawImage(c, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      };
      const { dx, dy, dw, dh } = square;
      blit(0, 0, w, dy); // above the square
      blit(0, dy + dh, w, h - dy - dh); // below it
      blit(0, dy, dx, dh); // left of it
      blit(dx + dw, dy, w - dx - dw, dh); // right of it
    }
    ctx.restore();
  }

  /** The arena plate (its shadow, floor, motif and rim), one drawImage; the lost ground while sudden death shrinks it. */
  drawPlate(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const field = view.field;
    if (!field) return;
    const look = fr.look;
    const half = field.fullHalf > 0 ? field.fullHalf : field.half;
    const side = 2 * half;
    const rim = Math.max(2, 0.012 * side);
    const division = matchDivision(view) ?? "none";
    const key = `${field.kind}|${field.cx}|${field.cy}|${half}|${fr.px}|${fr.pal.stage}|${look.floor}|${look.rim}|${look.motif}|${look.glow}|${division}`;
    if (key !== this.plateKey) {
      this.plateKey = key;
      const pad = rim + 0.06 * side;
      this.plate = makeSprite({ x0: field.cx - half - pad, y0: field.cy - half - pad, x1: field.cx + half + pad, y1: field.cy + half + pad }, fr.px, (g) => paintPlate(g, field.kind, field.cx, field.cy, half, rim, look, fr.pal));
    }
    if (this.plate) {
      const p = this.plate;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(p.canvas, p.x0, p.y0, p.w, p.h);
      ctx.restore();
    }
    // sudden death: the ground outside the shrinking arena is lost (dark, hatched) and the live rim marks the edge
    if (field.half < half - 0.5) {
      ctx.save();
      ctx.beginPath();
      if (field.kind === "circle") {
        ctx.arc(field.cx, field.cy, half, 0, TWO_PI);
        ctx.arc(field.cx, field.cy, field.half, 0, TWO_PI, true);
      } else {
        ctx.rect(field.cx - half, field.cy - half, 2 * half, 2 * half);
        ctx.rect(field.cx + field.half, field.cy - field.half, -2 * field.half, 2 * field.half);
      }
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#3b0d0d";
      ctx.fill("evenodd");
      ctx.restore();
      ctx.save();
      ctx.lineWidth = rim;
      ctx.strokeStyle = "#ef4444";
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(fr.now / 120);
      ctx.beginPath();
      if (field.kind === "circle") ctx.arc(field.cx, field.cy, field.half + rim / 2, 0, TWO_PI);
      else ctx.rect(field.cx - field.half - rim / 2, field.cy - field.half - rim / 2, 2 * field.half + rim, 2 * field.half + rim);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** A scorch: a soft dark blot (one radial gradient, on its own sprite, once). */
  private scorchSprite(): Sprite | null {
    if (this.scorch) return this.scorch;
    this.scorch = makeSprite({ x0: -1, y0: -1, x1: 1, y1: 1 }, 64, (g) => {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, "rgba(28, 25, 23, 0.75)");
      grad.addColorStop(0.55, "rgba(28, 25, 23, 0.35)");
      grad.addColorStop(1, "rgba(28, 25, 23, 0)");
      g.fillStyle = grad;
      g.fillRect(-1, -1, 2, 2);
    });
    return this.scorch;
  }

  /** The live overlays on the floor: the slow-time veil, the decals and the rim flashes (inside the arena's clip). */
  drawOverlays(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const field = view.field;
    if (!field) return;
    const now = fr.now;
    // slow time: a cool teal veil and a clock hand sweeping round the arena (a wipe in its first 400 ms)
    if (now < view.slowTimeUntil) {
      let start = -Infinity;
      for (const f of view.fighters) if (f.team === view.slowTimeTeam && f.lastCastMs > start && f.lastCastMs <= now) start = f.lastCastMs;
      const age = now - start;
      const wipe = Number.isFinite(age) && age >= 0 && age < 400 ? age / 400 : 1;
      ctx.save();
      ctx.globalAlpha = 0.14 + 0.03 * Math.sin(now / 140);
      ctx.fillStyle = "#0d9488";
      ctx.beginPath();
      ctx.moveTo(field.cx, field.cy);
      ctx.arc(field.cx, field.cy, 1.5 * field.half, -Math.PI / 2, -Math.PI / 2 + wipe * TWO_PI);
      ctx.closePath();
      ctx.fill();
      const hand = -Math.PI / 2 + ((now / 1000) * 0.6 * TWO_PI) % TWO_PI;
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "#ccfbf1";
      ctx.lineWidth = Math.max(1.5, 0.01 * field.side);
      ctx.beginPath();
      ctx.moveTo(field.cx, field.cy);
      ctx.lineTo(field.cx + Math.cos(hand) * field.half, field.cy + Math.sin(hand) * field.half);
      ctx.stroke();
      ctx.restore();
    }
    // the decals
    const nd = Math.min(view.decalSerial, FL_DECAL_CAP);
    for (let k = 0; k < nd; k++) {
      const d = view.decals[k];
      if (!(now >= d.t) || now >= d.until) continue;
      const life = Math.max(1, d.until - d.t);
      const a = Math.min(1, (d.until - now) / (0.3 * life));
      ctx.save();
      ctx.globalAlpha = a;
      if (d.kind === DC_SCORCH) {
        const s = this.scorchSprite();
        if (s) ctx.drawImage(s.canvas, d.x - d.r, d.y - d.r, 2 * d.r, 2 * d.r);
      } else if (d.kind === DC_SCAR) {
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(30, 27, 46, 0.55)";
        ctx.lineWidth = Math.max(2, 0.35 * d.r);
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x2, d.y2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(220, 38, 38, 0.5)";
        ctx.lineWidth = Math.max(1, 0.12 * d.r);
        ctx.stroke();
      } else if (d.kind === DC_CRACK) {
        ctx.strokeStyle = withAlpha(/^#[0-9a-f]{6}$/i.test(d.color) ? d.color : INK, 0.7);
        ctx.lineWidth = Math.max(1, 0.08 * d.r);
        ctx.lineJoin = "round";
        ctx.beginPath();
        const seed = Math.floor(d.t) + k;
        for (let q = 0; q < 6; q++) {
          const a0 = (q / 6) * TWO_PI + hash(q, seed);
          let px = d.x;
          let py = d.y;
          ctx.moveTo(px, py);
          for (let s = 1; s <= 3; s++) {
            const a1 = a0 + (hash(q * 7 + s, seed) - 0.5) * 0.9;
            const len = (d.r / 3) * (0.7 + 0.6 * hash(q + s, seed + 3));
            px += Math.cos(a1) * len;
            py += Math.sin(a1) * len;
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    // the rim flashes: a 0.6 R segment of the rim in the fighter's colour for 250 ms where it bounced
    const n = Math.min(view.eventSerial, FL_EVENT_CAP);
    for (let k = 0; k < n; k++) {
      const e = view.events[k];
      if (e.kind !== EV_RIM) continue;
      const age = now - e.t;
      if (!(age >= 0) || age >= 250) continue;
      const f = view.fighters[e.slot];
      const r = f ? f.r : 10;
      ctx.save();
      ctx.globalAlpha = 1 - age / 250;
      ctx.strokeStyle = f ? f.row.body : e.color;
      ctx.lineWidth = Math.max(2, 0.3 * r);
      ctx.lineCap = "round";
      ctx.beginPath();
      if (field.kind === "circle") {
        const a = Math.atan2(e.y - field.cy, e.x - field.cx);
        const span = (0.6 * r) / Math.max(1, field.half);
        ctx.arc(field.cx, field.cy, field.half - 0.5 * ctx.lineWidth, a - span, a + span);
      } else {
        const dx = (e.x - field.cx) / field.half;
        const dy = (e.y - field.cy) / field.half;
        const inset = 0.5 * ctx.lineWidth;
        if (Math.abs(dx) >= Math.abs(dy)) {
          const wx = field.cx + Math.sign(dx) * (field.half - inset);
          ctx.moveTo(wx, e.y - 0.6 * r);
          ctx.lineTo(wx, e.y + 0.6 * r);
        } else {
          const wy = field.cy + Math.sign(dy) * (field.half - inset);
          ctx.moveTo(e.x - 0.6 * r, wy);
          ctx.lineTo(e.x + 0.6 * r, wy);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** The plate: a soft drop shadow, the floor, the style's motif (clipped to the floor) and the rim (a neon glow line). */
function paintPlate(g: CanvasRenderingContext2D, kind: string, cx: number, cy: number, half: number, rim: number, look: FlArenaLook, pal: FlStagePalette) {
  const side = 2 * half;
  const path = () => {
    g.beginPath();
    if (kind === "circle") g.arc(cx, cy, half, 0, TWO_PI);
    else g.rect(cx - half, cy - half, side, side);
  };
  // the shadow, baked here once
  g.save();
  g.shadowColor = pal.shadow;
  g.shadowBlur = 0.04 * side;
  g.shadowOffsetY = 0.012 * side;
  g.fillStyle = look.floor;
  path();
  g.fill();
  g.restore();
  g.fillStyle = look.floor;
  path();
  g.fill();
  g.save();
  path();
  g.clip();
  paintMotif(g, cx, cy, half, look);
  g.restore();
  if (look.glow) {
    g.save();
    g.shadowColor = look.glow;
    g.shadowBlur = 2.5 * rim;
    g.strokeStyle = look.glow;
    g.lineWidth = 0.5 * rim;
    g.beginPath();
    if (kind === "circle") g.arc(cx, cy, half + 1.6 * rim, 0, TWO_PI);
    else g.rect(cx - half - 1.6 * rim, cy - half - 1.6 * rim, side + 3.2 * rim, side + 3.2 * rim);
    g.stroke();
    g.restore();
  }
  g.lineWidth = rim;
  g.strokeStyle = look.rim;
  g.beginPath();
  if (kind === "circle") g.arc(cx, cy, half + rim / 2, 0, TWO_PI);
  else g.rect(cx - half - rim / 2, cy - half - rim / 2, side + rim, side + rim);
  g.stroke();
}

/** A style's generic floor motif (3–5 % ink; geometry hashed, never an emblem). */
function paintMotif(g: CanvasRenderingContext2D, cx: number, cy: number, half: number, look: FlArenaLook) {
  const side = 2 * half;
  const x0 = cx - half;
  const y0 = cy - half;
  g.strokeStyle = look.motifColor;
  g.fillStyle = look.motifColor;
  g.lineWidth = Math.max(1, 0.003 * side);
  switch (look.motif) {
    case "grid": {
      const cells = 8;
      const step = side / cells;
      g.beginPath();
      for (let k = 1; k < cells; k++) {
        g.moveTo(x0 + k * step, y0);
        g.lineTo(x0 + k * step, y0 + side);
        g.moveTo(x0, y0 + k * step);
        g.lineTo(x0 + side, y0 + k * step);
      }
      g.stroke();
      return;
    }
    case "halftone": {
      const step = 0.05 * side;
      for (let y = y0 + step / 2; y < y0 + side; y += step) {
        for (let x = x0 + step / 2; x < x0 + side; x += step) {
          const u = ((x - x0) + (y - y0)) / (2 * side);
          const r = step * 0.08 + step * 0.22 * u;
          g.beginPath();
          g.arc(x, y, r, 0, TWO_PI);
          g.fill();
        }
      }
      return;
    }
    case "rings":
      g.lineWidth = Math.max(1, 0.006 * side);
      for (let k = 1; k <= 4; k++) {
        g.beginPath();
        g.arc(cx, cy, (k / 4.4) * half, 0, TWO_PI);
        g.stroke();
      }
      return;
    case "hex": {
      const R = 0.07 * side;
      const w = Math.sqrt(3) * R;
      for (let row = 0, y = y0; y < y0 + side + R; row++, y += 1.5 * R) {
        for (let x = x0 + (row % 2 === 0 ? 0 : w / 2); x < x0 + side + w; x += w) {
          polygonPath(g, x, y, R, 6, Math.PI / 6);
          g.stroke();
        }
      }
      return;
    }
    case "lines": {
      const step = 0.08 * side;
      g.beginPath();
      for (let y = y0 + step; y < y0 + side; y += step) {
        g.moveTo(x0, y);
        g.lineTo(x0 + side, y);
      }
      g.stroke();
      return;
    }
    case "speed":
      g.lineWidth = Math.max(1, 0.004 * side);
      g.beginPath();
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * TWO_PI + 0.1 * hash(k, 3);
        g.moveTo(cx + Math.cos(a) * 0.25 * half, cy + Math.sin(a) * 0.25 * half);
        g.lineTo(cx + Math.cos(a) * 1.5 * half, cy + Math.sin(a) * 1.5 * half);
      }
      g.stroke();
      return;
    case "stars":
      for (let k = 0; k < 70; k++) {
        const x = x0 + hash(k, 21) * side;
        const y = y0 + hash(k, 22) * side;
        g.beginPath();
        g.arc(x, y, (0.002 + 0.004 * hash(k, 23)) * side, 0, TWO_PI);
        g.fill();
      }
      return;
    case "dots": {
      const step = 0.1 * side;
      for (let y = y0 + step / 2; y < y0 + side; y += step) {
        for (let x = x0 + step / 2; x < x0 + side; x += step) {
          g.beginPath();
          g.arc(x, y, 0.012 * side, 0, TWO_PI);
          g.fill();
        }
      }
      return;
    }
    case "hatch": {
      const step = 0.045 * side;
      g.beginPath();
      for (let d = -side; d < side; d += step) {
        g.moveTo(x0 + d, y0 + side);
        g.lineTo(x0 + d + side, y0);
      }
      g.stroke();
      return;
    }
    case "stripes": {
      const step = 0.16 * side;
      for (let d = -side; d < side; d += step) {
        g.beginPath();
        g.moveTo(x0 + d, y0 + side);
        g.lineTo(x0 + d + 0.07 * side, y0 + side);
        g.lineTo(x0 + d + 0.07 * side + side, y0);
        g.lineTo(x0 + d + side, y0);
        g.closePath();
        g.fill();
      }
      return;
    }
    case "circle":
      // a centre circle and the half-way line (never a split in two colours)
      g.lineWidth = Math.max(1, 0.008 * side);
      g.beginPath();
      g.arc(cx, cy, 0.22 * half, 0, TWO_PI);
      g.moveTo(x0, cy);
      g.lineTo(x0 + side, cy);
      g.stroke();
      return;
    case "blocks": {
      const step = 0.1 * side;
      for (let j = 0, y = y0; y < y0 + side; j++, y += step) {
        for (let i = 0, x = x0; x < x0 + side; i++, x += step) {
          if ((i + j) % 2 === 0 && hash(i * 31 + j, 5) > 0.35) g.fillRect(x, y, step, step);
        }
      }
      return;
    }
    default:
      return;
  }
}
