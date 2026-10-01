import { BANNER_MS, CRACK_GROW_MS, paneDamage, type GlassPane, type GlassView } from "@/lib/physics/modes/glass";
import { ACCENT } from "@/lib/site";
// --- gerald-multipliers --- the gate rows speak the board's language (colours, labels)
import { MULTIPLIER_COLORS } from "@/lib/physics/multipliers";
import { DEFAULT_MULTIPLIER_LABELS, gateLabel, type MultiplierLabels } from "./multiplierRenderer";

/**
 * Canvas drawing of the Glass Smash mode (lib/physics/modes/glass.ts): the panes – thin translucent rectangles with a
 * stage tint, a bright top edge, glints, a frost that thickens with the damage and a flash on every hit – their
 * cracks (grown over `CRACK_GROW_MS` from the impact), the rails of sliding panes, the stage markers, the ground and
 * the HOME doorway (warm light once the ball is home), the multiplier gate rows (x2 DMG, x1.5 SPEED, x1.25 SIZE; the
 * slot the ball went through lights up), the flying shards, and in screen space the "STAGE n" banner and the stage dots. Canvas.tsx scrolls the world by `GlassView.cameraY` (`applyGlassCamera()`) inside its camera
 * transform, so the obstacle walls, the ball, its face, the particles and everything here share the scroll. Only
 * what is in view is drawn and the fill strings are cached per hue, so a 30-pane stage stays cheap at 1080×1920.
 */

export interface GlassRenderOptions {
  /** Colour of wall `index`, optionally with alpha – the canvas' wall colour function, so rainbow walls apply. */
  wallColor: (index: number, alpha?: number, angle?: number) => string;
  wallThickness: number;
  showGlow: boolean;
  /** "STAGE n" (translated). */
  stageLabel: (n: number) => string;
  /** The sign over the door (translated). */
  homeLabel: string;
  /** --- gerald-multipliers --- The stat words of the gate labels (x2 DMG, x1.5 SPEED, x1.25 SIZE), translated. */
  multLabels?: MultiplierLabels;
}

const TWO_PI = Math.PI * 2;
const STAGE_DASH = [4, 6];
const NO_DASH: number[] = [];
/** How long a pane flashes after a hit (simulation ms). */
export const PANE_FLASH_MS = 220;
/** How long the gate the ball went through flashes (simulation ms); it stays lit afterwards and the other slots dim. */
export const GATE_FLASH_MS = 600;

const fillCache = new Map<number, string>();
const edgeCache = new Map<number, string>();
const lowEdgeCache = new Map<number, string>();
const shardCache = new Map<number, string>();
const cached = (cache: Map<number, string>, hue: number, make: (h: number) => string) => {
  const h = Math.round(hue);
  let s = cache.get(h);
  if (s === undefined) {
    s = make(h);
    cache.set(h, s);
  }
  return s;
};
const paneFill = (hue: number) => cached(fillCache, hue, (h) => `hsla(${h}, 80%, 72%, 0.26)`);
const paneEdge = (hue: number) => cached(edgeCache, hue, (h) => `hsla(${h}, 100%, 92%, 0.95)`);
const paneLowEdge = (hue: number) => cached(lowEdgeCache, hue, (h) => `hsla(${h}, 90%, 62%, 0.65)`);
const shardFill = (hue: number) => cached(shardCache, hue, (h) => `hsla(${h}, 70%, 88%, 0.8)`);

/** Scrolls the world by the Glass Smash camera (call inside the canvas' camera transform, before the world is drawn). */
export function applyGlassCamera(ctx: CanvasRenderingContext2D, view: GlassView) {
  if (view.cameraY !== 0) ctx.translate(0, -view.cameraY);
}

/** One stretch of solid glass of a pane, from x0 to x1: tinted fill, frost and hit flash, bright edges and two glints. */
function drawPanePart(ctx: CanvasRenderingContext2D, pane: GlassPane, x0: number, x1: number, y0: number, damage: number, flash: number) {
  const w = x1 - x0;
  if (w <= 0) return;
  const T = pane.thickness;
  ctx.globalAlpha = 1;
  ctx.fillStyle = paneFill(pane.hue);
  ctx.fillRect(x0, y0, w, T);
  if (damage > 0 || flash > 0) {
    // Frost thickens with the damage; a hit flashes the glass white.
    ctx.globalAlpha = Math.min(0.85, 0.22 * damage + 0.55 * flash);
    ctx.fillStyle = "#e8f7ff";
    ctx.fillRect(x0, y0, w, T);
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = paneEdge(pane.hue);
  ctx.beginPath();
  ctx.moveTo(x0, y0 + 0.5);
  ctx.lineTo(x1, y0 + 0.5);
  ctx.moveTo(x0 + 0.5, y0);
  ctx.lineTo(x0 + 0.5, y0 + T);
  ctx.moveTo(x1 - 0.5, y0);
  ctx.lineTo(x1 - 0.5, y0 + T);
  ctx.stroke();
  ctx.strokeStyle = paneLowEdge(pane.hue);
  ctx.beginPath();
  ctx.moveTo(x0, y0 + T - 0.5);
  ctx.lineTo(x1, y0 + T - 0.5);
  ctx.stroke();
  if (w > 3 * T) {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(x0 + 0.16 * w, y0 + T - 1);
    ctx.lineTo(x0 + 0.16 * w + 0.8 * T, y0 + 1);
    ctx.moveTo(x0 + 0.24 * w, y0 + T - 1);
    ctx.lineTo(x0 + 0.24 * w + 0.8 * T, y0 + 1);
    ctx.stroke();
  }
}

/**
 * The world between `viewTop` and `viewBottom` (world y): stage markers, rails, panes, cracks, the ground and the
 * doorway. Drawn before the ball, inside the scrolled transform.
 */
export function drawGlassWorld(ctx: CanvasRenderingContext2D, view: GlassView, opts: GlassRenderOptions, viewTop: number, viewBottom: number) {
  const level = view.level;
  if (!level) return;
  const f = level.field;
  const now = view.timeMs;
  ctx.save();
  // Stage markers: a faint dashed line where each stage begins and its name at the wall.
  ctx.setLineDash(STAGE_DASH);
  ctx.lineWidth = 1;
  const labelSize = Math.max(9, 0.022 * f.height);
  ctx.font = `600 ${labelSize}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let s = 1; s < level.stages.length; s++) {
    const y = level.stages[s].top;
    if (y < viewTop - 20 || y > viewBottom + 20) continue;
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(f.left, y);
    ctx.lineTo(f.right, y);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(opts.stageLabel(s + 1), f.left + 6, y + 4);
  }
  ctx.setLineDash(NO_DASH);
  ctx.globalAlpha = 1;

  if (level.gates.length > 0) drawGlassGates(ctx, view, opts, viewTop, viewBottom);

  // Panes.
  for (const pane of level.panes) {
    if (pane.shattered) continue;
    const half = pane.thickness / 2;
    if (pane.y + half < viewTop || pane.y - half > viewBottom) continue;
    const y0 = pane.y - half;
    if (pane.kind === "moving") {
      // The rail it slides on.
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = paneEdge(pane.hue);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(f.left, pane.y);
      ctx.lineTo(f.right, pane.y);
      ctx.stroke();
    }
    const damage = paneDamage(pane);
    const age = now - pane.lastHitMs;
    const flash = age >= 0 && age < PANE_FLASH_MS ? 1 - age / PANE_FLASH_MS : 0;
    const left = pane.x - pane.halfWidth;
    const right = pane.x + pane.halfWidth;
    if (pane.kind === "hole" && pane.holeHalf > 0) {
      drawPanePart(ctx, pane, left, pane.x + pane.holeX - pane.holeHalf, y0, damage, flash);
      drawPanePart(ctx, pane, pane.x + pane.holeX + pane.holeHalf, right, y0, damage, flash);
    } else drawPanePart(ctx, pane, left, right, y0, damage, flash);
  }
  ctx.globalAlpha = 1;

  // Cracks: every visible crack in one path, each grown to its current length.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.88)";
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.beginPath();
  let any = false;
  for (const pane of level.panes) {
    if (pane.shattered || pane.cracks.length === 0) continue;
    if (pane.y + pane.thickness < viewTop || pane.y - pane.thickness > viewBottom) continue;
    for (const crack of pane.cracks) {
      const grow = Math.max(0, Math.min(1, (now - crack.atMs) / CRACK_GROW_MS));
      const grown = crack.length * grow;
      const segs = crack.segs;
      for (let i = 0; i < crack.count; i++) {
        const o = 5 * i;
        const x1 = segs[o];
        const y1 = segs[o + 1];
        const x2 = segs[o + 2];
        const y2 = segs[o + 3];
        const end = segs[o + 4];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const start = end - len;
        if (start >= grown) continue;
        const t = end <= grown || len <= 0 ? 1 : (grown - start) / len;
        ctx.moveTo(pane.x + x1, pane.y + y1);
        ctx.lineTo(pane.x + x1 + (x2 - x1) * t, pane.y + y1 + (y2 - y1) * t);
        any = true;
      }
    }
  }
  if (any) ctx.stroke();

  // HOME: the ground's floor, the doorway and its sign.
  const home = level.home;
  if (home.groundY - home.doorHeight * 2 < viewBottom && home.groundY > viewTop - 40) {
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(f.left, home.groundY, f.width, Math.max(0, level.worldBottom - home.groundY));
    ctx.globalAlpha = 1;
    const w = home.doorWidth;
    const h = home.doorHeight;
    const x0 = home.doorX - w / 2;
    const y0 = home.groundY - h;
    const since = view.homeReached ? now - view.homeAtMs : -1;
    // The door: dark until Gerald is home, then warm light pouring out.
    ctx.beginPath();
    ctx.moveTo(x0, home.groundY);
    ctx.lineTo(x0, y0 + w / 2);
    ctx.arc(home.doorX, y0 + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x0 + w, home.groundY);
    ctx.closePath();
    if (since >= 0) {
      const pulse = 0.75 + 0.25 * Math.sin(since / 120);
      ctx.save();
      ctx.shadowColor = "rgba(255, 200, 90, 0.9)";
      ctx.shadowBlur = 30 * pulse;
      ctx.fillStyle = `rgba(255, 214, 120, ${(0.55 + 0.35 * pulse).toFixed(3)})`;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(20, 20, 24, 0.95)";
      ctx.fill();
    }
    ctx.lineWidth = Math.max(2, opts.wallThickness);
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
    // Door panels and the knob (the door stands open once the ball is home).
    if (since < 0) {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.strokeStyle = ACCENT;
      ctx.strokeRect(x0 + 0.2 * w, y0 + 0.62 * w, 0.6 * w, 0.32 * h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(x0 + 0.78 * w, y0 + 0.62 * h, Math.max(1.5, 0.05 * w), 0, TWO_PI);
      ctx.fill();
    }
    // The roof and the sign.
    ctx.beginPath();
    ctx.moveTo(x0 - 0.3 * w, y0 + 0.02 * h);
    ctx.lineTo(home.doorX, y0 - 0.45 * w);
    ctx.lineTo(x0 + 1.3 * w, y0 + 0.02 * h);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(2, opts.wallThickness);
    ctx.stroke();
    const fs = Math.max(10, 0.3 * w);
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = ACCENT;
    if (since >= 0 || opts.showGlow) {
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = since >= 0 ? 16 : 8;
    }
    ctx.fillText(opts.homeLabel, home.doorX, y0 - 0.5 * w - 4);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

/**
 * --- gerald-multipliers --- The gate rows in view: per slot a tinted band under the gate line and its label (shrunk to
 * fit its slot, an outline for contrast). The slot the ball went through flashes and stays lit; the others dim.
 */
function drawGlassGates(ctx: CanvasRenderingContext2D, view: GlassView, opts: GlassRenderOptions, viewTop: number, viewBottom: number) {
  const level = view.level!;
  const f = level.field;
  const labels = opts.multLabels ?? DEFAULT_MULTIPLIER_LABELS;
  const bandH = Math.max(14, 0.04 * f.height);
  const fs = Math.max(10, 0.028 * f.height);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const row of level.gates) {
    if (row.y + bandH < viewTop || row.y - bandH > viewBottom) continue;
    const age = view.timeMs - row.passedAtMs;
    const flash = age >= 0 && age < GATE_FLASH_MS ? 1 - age / GATE_FLASH_MS : 0;
    for (let i = 0; i < row.slots.length; i++) {
      const slot = row.slots[i];
      const color = MULTIPLIER_COLORS[slot.kind];
      const taken = row.passedSlot === i;
      const dim = row.passedSlot >= 0 && !taken;
      const x0 = slot.x0 + 3;
      const w = slot.x1 - slot.x0 - 6;
      if (w <= 0) continue;
      ctx.globalAlpha = dim ? 0.05 : taken ? 0.3 + 0.45 * flash : 0.16;
      ctx.fillStyle = color;
      ctx.fillRect(x0, row.y, w, bandH);
      ctx.globalAlpha = dim ? 0.3 : 0.95;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (taken && flash > 0.05 && opts.showGlow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 18 * flash;
      }
      ctx.beginPath();
      ctx.moveTo(x0, row.y);
      ctx.lineTo(x0 + w, row.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const text = gateLabel(slot.kind, slot.factor, labels);
      let size = fs;
      ctx.font = `900 ${size.toFixed(1)}px sans-serif`;
      const tw = ctx.measureText(text).width;
      if (tw > w - 6) {
        size *= Math.max(0.3, (w - 6) / tw);
        ctx.font = `900 ${size.toFixed(1)}px sans-serif`;
      }
      const lx = (slot.x0 + slot.x1) / 2;
      const ly = row.y + 0.5 * bandH;
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.lineWidth = Math.max(2, 0.18 * size);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
      ctx.strokeText(text, lx, ly);
      ctx.fillStyle = taken && flash > 0.5 ? "#ffffff" : color;
      ctx.fillText(text, lx, ly);
    }
  }
  ctx.restore();
}

/** The flying shards (world space, drawn over the ball). */
export function drawGlassShards(ctx: CanvasRenderingContext2D, view: GlassView, viewTop: number, viewBottom: number) {
  if (view.shardCount === 0) return;
  ctx.save();
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  const shape = view.shardShape;
  for (let i = 0; i < view.shardCount; i++) {
    const x = view.shardX[i];
    const y = view.shardY[i];
    const size = view.shardSize[i];
    if (y + size < viewTop || y - size > viewBottom) continue;
    const life = view.shardMaxLife[i] > 0 ? view.shardLife[i] / view.shardMaxLife[i] : 0;
    ctx.globalAlpha = Math.max(0, Math.min(1, 1.6 * life));
    ctx.fillStyle = shardFill(view.shardHue[i]);
    const c = Math.cos(view.shardRot[i]) * size;
    const s = Math.sin(view.shardRot[i]) * size;
    const o = 8 * i;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const ux = shape[o + 2 * k];
      const uy = shape[o + 2 * k + 1];
      const px = x + ux * c - uy * s;
      const py = y + ux * s + uy * c;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Screen space: the stage dots over the shaft and the "STAGE n" banner when a stage begins. Returns the screen y of the dots'
 * bottom edge (0: no dots), which the top captions start below.
 */
export function drawGlassOverlay(ctx: CanvasRenderingContext2D, view: GlassView, opts: GlassRenderOptions): number {
  const level = view.level;
  if (!level) return 0;
  const f = level.field;
  const n = level.stages.length;
  let topBottom = 0; // --- review fix (modes-gerald-odd) --- the dots' bottom, for the captions
  ctx.save();
  if (n > 1) {
    const r = Math.max(2.5, 0.007 * f.height);
    topBottom = f.top + 4 * r;
    const gap = 3.6 * r;
    const y = f.top + 3 * r;
    const x0 = f.cx - ((n - 1) * gap) / 2;
    for (let s = 0; s < n; s++) {
      const x = x0 + s * gap;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TWO_PI);
      if (s < view.stage) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fill();
      } else if (s === view.stage) {
        ctx.fillStyle = ACCENT;
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
        ctx.stroke();
      }
    }
  }
  const age = view.timeMs - view.bannerAtMs;
  if (!view.homeReached && age >= 0 && age < BANNER_MS) {
    const alpha = age < 180 ? age / 180 : age > BANNER_MS - 400 ? (BANNER_MS - age) / 400 : 1;
    const scale = 1 + 0.25 * Math.max(0, 1 - age / 180);
    const fs = Math.max(20, 0.085 * f.height) * scale;
    const text = opts.stageLabel(view.bannerStage + 1);
    const y = f.top + 0.15 * f.height;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `900 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, 0.12 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.strokeText(text, f.cx, y);
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 18;
    ctx.fillText(text, f.cx, y);
  }
  ctx.restore();
  return topBottom;
}
