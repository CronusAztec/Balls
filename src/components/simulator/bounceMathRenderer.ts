import type { BounceMathView } from "@/lib/physics/bounceMathRuntime";
import { formatBounceValue } from "@/lib/simulation/bounceMath";
import { ACCENT } from "@/lib/site";

/**
 * --- bounce-math --- The canvas' side of bounce math: the rules' wall thickness and wobble (canvas parameters the engine's
 * runtime holds, so the fast export's engine replays them too), the "Show values" HUD badge – the bounciness, speed, size
 * and gravity of the ball that bounced last and every rule's fire count, inside the square the recorder crops (so clips
 * have it), clear of the other HUDs – and the `data-bm-*` mirror for tools and the smoke test. Nothing here touches the
 * physics.
 */

export interface BounceMathHudLabels {
  bounce: string;
  speed: string;
  size: string;
  gravity: string;
  /** The fire count of rule n (1-based), e.g. "#2 ×14". */
  rule: (n: number, fires: string) => string;
}

export const DEFAULT_BOUNCE_MATH_LABELS: BounceMathHudLabels = {
  bounce: "BOUNCE",
  speed: "SPEED",
  size: "SIZE",
  gravity: "GRAVITY",
  rule: (n, fires) => `#${n} ×${fires}`,
};

/** Where the badge may go inside the recorded square (screen px). */
export interface BounceMathHudPlace {
  x0: number;
  y0: number;
  side: number;
  /** The lowest y the badge may reach at the bottom (the page's buttons, the bottom text, the song bar are below it). */
  bottom: number;
  /** The highest y it may start at when it goes to the top right (bottom captions in use). */
  top: number;
  /** Bottom captions are on screen: the badge moves to the top-right corner. */
  toTop: boolean;
}

/** The most rules the badge lists one by one (more: one total). */
const MAX_RULE_CHIPS = 6;
/** How long a chip pops after its rule fired, simulation ms. */
const POP_MS = 260;

export const BOUNCE_MATH_DATA_KEYS = ["bmRules", "bmFires", "bmTotal", "bmBounce", "bmSpeed", "bmSize", "bmGravity", "bmBalls", "bmTimeScale", "bmTime", "bmHud"] as const;

export class BounceMathLayer {
  private propsFrom: object | null = null;
  private propsThickness = NaN;
  private propsOut: object | null = null;
  /** The badge drawn in the last frame (x, y, w, h), or null. */
  readonly rect = { x: 0, y: 0, w: 0, h: 0 };
  drawn = false;
  private readonly chips: { text: string; color: string; pop: boolean }[] = [];
  private readonly widths: number[] = [];

  /** The canvas props with the rules' wall thickness – the same object while no rule changed it (and the same copy per frame). */
  props<P extends { wallThickness?: number }>(p: P, view: BounceMathView): P {
    if (!view.active || Number.isNaN(view.thickness)) return p;
    if (this.propsFrom === p && this.propsThickness === view.thickness && this.propsOut) return this.propsOut as P;
    const out = { ...p, wallThickness: Math.max(0.1, view.thickness) };
    this.propsFrom = p;
    this.propsThickness = view.thickness;
    this.propsOut = out;
    return out;
  }

  /** The wobbly walls' amount: a rule's, else the page's. */
  wobble(amount: number, view: BounceMathView): number {
    return view.active && !Number.isNaN(view.wobble) ? view.wobble : amount;
  }

  /** The HUD badge: one row of value chips and one of rule fire counts, wrapping inside the square. */
  drawHud(ctx: CanvasRenderingContext2D, view: BounceMathView, labels: BounceMathHudLabels, place: BounceMathHudPlace, nowMs: number) {
    this.drawn = false;
    if (!view.active || !view.showValues) return;
    const chips = this.chips;
    chips.length = 0;
    if (view.hasBall) {
      chips.push({ text: `${labels.bounce} ${formatBounceValue(view.bounciness)}`, color: "#fbbf24", pop: false });
      chips.push({ text: `${labels.speed} ${formatBounceValue(view.speed)}`, color: "#22d3ee", pop: false });
      chips.push({ text: `${labels.size} ${formatBounceValue(view.size)}`, color: "#a78bfa", pop: false });
    }
    chips.push({ text: `${labels.gravity} ${formatBounceValue(view.gravity)}`, color: "#60a5fa", pop: false });
    const firstRuleChip = chips.length;
    const age = nowMs - view.lastFireMs;
    const popping = age >= 0 && age < POP_MS;
    if (view.fires.length <= MAX_RULE_CHIPS) {
      for (let i = 0; i < view.fires.length; i++) chips.push({ text: labels.rule(i + 1, formatBounceValue(view.fires[i])), color: ACCENT, pop: popping && view.lastRule === i });
    } else chips.push({ text: `Σ ×${formatBounceValue(view.totalFires)}`, color: ACCENT, pop: popping });

    const { x0, y0, side } = place;
    const fs = Math.max(10, 0.028 * side);
    const pad = 0.025 * side;
    const h = 1.55 * fs;
    const gap = 0.35 * fs;
    ctx.save();
    ctx.font = `800 ${fs.toFixed(1)}px sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    // Lay the chips out in rows (values first, a new row for the rule counts), right to left in the top-right corner.
    const maxW = side - 2 * pad;
    let rows = 1;
    let rowW = 0;
    const widths = this.widths;
    widths.length = 0;
    for (let i = 0; i < chips.length; i++) {
      const w = ctx.measureText(chips[i].text).width + 1.1 * fs;
      widths.push(w);
      const newRow = i === firstRuleChip || (rowW > 0 && rowW + gap + w > maxW);
      if (newRow && rowW > 0) {
        rows++;
        rowW = w;
      } else rowW += (rowW > 0 ? gap : 0) + w;
    }
    const totalH = rows * h + (rows - 1) * gap;
    let y = place.toTop ? Math.max(y0 + pad, place.top) : Math.min(y0 + side - pad, place.bottom) - totalH;
    const left = x0 + pad;
    const right = x0 + side - pad;
    let x = place.toTop ? right : left;
    let minX = Infinity;
    let maxX = -Infinity;
    const startY = y;
    rowW = 0;
    for (let i = 0; i < chips.length; i++) {
      const w = widths[i];
      const newRow = i === firstRuleChip || (rowW > 0 && rowW + gap + w > maxW);
      if (newRow && rowW > 0) {
        y += h + gap;
        x = place.toTop ? right : left;
        rowW = 0;
      }
      const cx = place.toTop ? x - w : x;
      const chip = chips[i];
      const scale = chip.pop ? 1 + 0.18 * (1 - age / POP_MS) : 1;
      ctx.save();
      ctx.translate(cx + w / 2, y + h / 2);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(8, 8, 10, 0.72)";
      ctx.beginPath();
      roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = chip.color;
      if (chip.pop) {
        ctx.shadowColor = chip.color;
        ctx.shadowBlur = 16;
      }
      ctx.stroke();
      ctx.fillStyle = chip.pop ? "#ffffff" : chip.color;
      ctx.fillText(chip.text, -w / 2 + 0.55 * fs, 0);
      ctx.restore();
      if (cx < minX) minX = cx;
      if (cx + w > maxX) maxX = cx + w;
      if (place.toTop) x -= w + gap;
      else x += w + gap;
      rowW += (rowW > 0 ? gap : 0) + w;
    }
    ctx.restore();
    this.rect.x = minX;
    this.rect.y = startY;
    this.rect.w = maxX - minX;
    this.rect.h = totalH;
    this.drawn = true;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Mirrors the readout onto the canvas element (`data-bm-*`, `data-bm-time`: the simulation clock in s) for tools and the smoke test. */
export function writeBounceMathDataset(view: BounceMathView, layer: BounceMathLayer, set: (key: string, value: string) => void, elapsedMs: number) {
  set("bmRules", String(view.fires.length));
  set("bmFires", view.fires.join(","));
  set("bmTotal", String(view.totalFires));
  set("bmBounce", view.hasBall ? String(Math.round(view.bounciness * 1000) / 1000) : "");
  set("bmSpeed", view.hasBall ? String(Math.round(view.speed)) : "");
  set("bmSize", view.hasBall ? String(Math.round(view.size * 100) / 100) : "");
  set("bmGravity", String(Math.round(view.gravity * 100) / 100));
  set("bmBalls", String(view.balls));
  set("bmTimeScale", String(Math.round(view.timeScale * 1000) / 1000));
  set("bmTime", (elapsedMs / 1000).toFixed(3));
  set("bmHud", layer.drawn ? `${Math.round(layer.rect.x)},${Math.round(layer.rect.y)},${Math.round(layer.rect.w)},${Math.round(layer.rect.h)}` : "");
}
