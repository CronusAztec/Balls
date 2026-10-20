import { CLEAR_HOLD_MS, POP_MS, TILES_PER_TURN, TILE_FLASH_MS, bandInner, bandOuter, lineHue, linePoint, pointOf, type SpiralGlassView } from "@/lib/physics/modes/spiralGlass";

/**
 * Canvas drawing of Spiral Glass (feature spiral-glass, lib/physics/modes/spiralGlass.ts). The canvas calls, per frame:
 * `drawWorld()` under the balls (the glass tiles – frosted sectors of the spiral band, tinted after the line's hue at a
 * low saturation, fading with their hit points, flashing white when hit – and the spiral line itself: a thin stroke whose
 * hue cycles slowly, the wall colour with the rainbow off, flashing white at GLASS CLEARED), `drawEffects()` over the
 * balls (the shards, the pops of the multiplies and the entrance badge with its "x n") and `drawOverlay()` in screen space
 * (the title and the tiles left in the top-left corner, the progress ring in the top-right one, the caption over the
 * spiral). Everything animates on the mode's clock (`view.timeMs`), so a pause freezes it and a recording replays it;
 * nothing is allocated per frame (strings cached).
 */

export interface SpiralGlassRenderOptions {
  /** The wall colour with an alpha (the line without the rainbow). */
  wallAlpha: (alpha: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
}

export interface SpiralGlassLabels {
  /** The HUD's title. */
  title: string;
  /** The caption over the spiral. */
  caption: string;
  /** "TILES 12/216" */
  tiles: (left: number, total: number) => string;
  /** The badge: "x7" */
  count: (n: number) => string;
  /** The end banners. */
  clearedTitle: string;
  clearedSub: (count: number, seconds: string) => string;
  timeoutTitle: string;
  timeoutSub: (tilesLeft: number) => string;
}

export const DEFAULT_SPIRAL_GLASS_LABELS: SpiralGlassLabels = {
  title: "SPIRAL GLASS",
  caption: "Will the ball multiply?",
  tiles: (left, total) => `TILES ${left}/${total}`,
  count: (n) => `x${n}`,
  clearedTitle: "GLASS CLEARED",
  clearedSub: (count, seconds) => `x${count} in ${seconds}s`,
  timeoutTitle: "TIME'S UP",
  timeoutSub: (tilesLeft) => `${tilesLeft} tiles left`,
};

/** Points per turn the line is drawn with, the clear flash and the badge's size (× the pitch). */
export const LINE_POINTS_PER_TURN = 72;
export const FLASH_MS = 700;
export const BADGE_AT = 0.42;
const TWO_PI = Math.PI * 2;

/** The glass tint for a line hue `hue` and hit points `hp` of `maxHp`: a greyish frost (`saturation` %, 0 with the rainbow off), lighter than the background, thinner as it cracks. */
export function tileFill(hue: number, hp: number, maxHp: number, saturation = 18): string {
  const frac = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
  return `hsla(${Math.round(hue)}, ${saturation}%, 74%, ${(0.16 + 0.2 * frac).toFixed(3)})`;
}

/** The shard's fill: the ball's hue, or white for a hue below 0. */
export function shardFill(hue: number, life: number): string {
  const a = Math.max(0, Math.min(1, 1.6 * life)).toFixed(3);
  return hue < 0 ? `rgba(255, 255, 255, ${a})` : `hsla(${Math.round(hue)}, 80%, 72%, ${a})`;
}

/** A pop `ageMs` after its multiply: its ring's scale (× the ball radius) and alpha; null once it is gone. */
export function popAt(ageMs: number): { scale: number; alpha: number } | null {
  if (!(ageMs >= 0) || ageMs >= POP_MS) return null;
  const u = ageMs / POP_MS;
  const ease = 1 - (1 - u) * (1 - u);
  return { scale: 1.2 + 2.6 * ease, alpha: 0.9 * (1 - u) };
}

/** The line's flash `ageMs` after GLASS CLEARED (0 … 1, 0 before and after). */
export function flashAt(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= FLASH_MS) return 0;
  return 1 - ageMs / FLASH_MS;
}

/** The share of the glass still standing (1 at the start, 0 when cleared). */
export function glassLeft(view: Pick<SpiralGlassView, "hpLeft" | "hpTotal">): number {
  return view.hpTotal > 0 ? Math.max(0, Math.min(1, view.hpLeft / view.hpTotal)) : 0;
}

const fillCache = new Map<number, string>();

export class SpiralGlassLayer {
  private tilesKey = -1;
  private tilesText = "";
  private countKey = -1;
  private countText = "";
  private hueKey = -1;
  private lineColor = "";

  /** Under the balls: the glass tiles, then the spiral line. */
  drawWorld(ctx: CanvasRenderingContext2D, view: SpiralGlassView, opts: SpiralGlassRenderOptions) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    const hue = view.settings.rainbow ? lineHue(now) : 0;
    const maxHp = view.settings.glassHp;
    ctx.save();
    ctx.globalAlpha = 1;
    // The tiles: each a sector of its band between the two spiral walls (the band's inner wall is the centre for band 0).
    const sector = TWO_PI / TILES_PER_TURN;
    const STEPS = 3;
    for (let c = 0; c < L.turns; c++) {
      for (let i = 0; i < TILES_PER_TURN; i++) {
        const t = c * TILES_PER_TURN + i;
        const hp = view.hp[t];
        if (hp <= 0) continue;
        const key = (view.settings.rainbow ? Math.round(hue / 4) * 4 : -1) * 16 + Math.min(15, Math.round((15 * hp) / Math.max(1, maxHp)));
        let fill = fillCache.get(key);
        if (fill === undefined) {
          fill = view.settings.rainbow ? tileFill(hue, hp, maxHp) : tileFill(0, hp, maxHp, 0);
          fillCache.set(key, fill);
        }
        const p0 = i * sector;
        ctx.beginPath();
        for (let k = 0; k <= STEPS; k++) {
          const phi = p0 + (sector * k) / STEPS;
          const q = pointOf(L, bandOuter(L, c, phi), phi);
          if (k === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        }
        for (let k = STEPS; k >= 0; k--) {
          const phi = p0 + (sector * k) / STEPS;
          const q = pointOf(L, bandInner(L, c, phi), phi);
          ctx.lineTo(q.x, q.y);
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        const age = now - view.hitMs[t];
        if (age >= 0 && age < TILE_FLASH_MS) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 * (1 - age / TILE_FLASH_MS)).toFixed(3)})`;
          ctx.fill();
        }
      }
    }
    // The line: from the centre out to the mouth, the hue cycling, flashing white at the clear.
    const width = Math.max(1.2, 0.6 * opts.wallThickness);
    if (view.settings.rainbow) {
      const hk = Math.round(hue);
      if (hk !== this.hueKey) {
        this.hueKey = hk;
        this.lineColor = `hsl(${hk}, 100%, 66%)`;
      }
    } else this.lineColor = opts.wallAlpha(0.9);
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = this.lineColor;
    if (opts.showWallGlow) {
      ctx.shadowColor = this.lineColor;
      ctx.shadowBlur = 3 * width + 6;
    }
    const total = L.turns + L.tail;
    const n = Math.ceil(total * LINE_POINTS_PER_TURN);
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const q = linePoint(L, (total * k) / n);
      if (k === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    const f = flashAt(now - view.clearedMs);
    if (view.clearedMs >= 0 && f > 0) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.95 * f).toFixed(3)})`;
      ctx.lineWidth = width + 5 * f;
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = opts.showWallGlow ? 24 * f : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  /** Over the balls: the shards, the pops of the multiplies and the entrance badge. */
  drawEffects(ctx: CanvasRenderingContext2D, view: SpiralGlassView, labels: SpiralGlassLabels) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    ctx.save();
    // The shards: small quads flying off the face, fading.
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    for (let i = 0; i < view.shardCount; i++) {
      const size = view.shardSize[i];
      const life = view.shardMaxLife[i] > 0 ? view.shardLife[i] / view.shardMaxLife[i] : 0;
      const c = Math.cos(view.shardRot[i]) * size;
      const s = Math.sin(view.shardRot[i]) * size;
      const x = view.shardX[i];
      const y = view.shardY[i];
      ctx.fillStyle = shardFill(view.shardHue[i], life);
      ctx.beginPath();
      ctx.moveTo(x + c, y + s);
      ctx.lineTo(x - 0.6 * s, y + 0.6 * c);
      ctx.lineTo(x - c, y - s);
      ctx.lineTo(x + 0.4 * s, y - 0.4 * c);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // The pops: a ring growing out of the ball that lapped, with the new count.
    ctx.lineWidth = Math.max(1.5, 0.004 * L.side);
    const pfs = Math.max(10, 0.028 * L.side);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < view.popMs.length; i++) {
      const p = popAt(now - view.popMs[i]);
      if (!p) continue;
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(view.popX[i], view.popY[i], L.ballRadius * p.scale, 0, TWO_PI);
      ctx.stroke();
      ctx.font = `800 ${pfs.toFixed(1)}px sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(labels.count(view.popCount[i]), view.popX[i], view.popY[i] - L.ballRadius * p.scale - 0.6 * pfs);
    }
    ctx.globalAlpha = 1;
    // The badge at the entrance: a disc on the entrance ray at the outer band, "x n" inside.
    const br = Math.max(9, BADGE_AT * L.pitch);
    const at = pointOf(L, L.pitch * (L.turns - 0.5), 0);
    ctx.fillStyle = "#fde68a";
    ctx.strokeStyle = "#1e3a8a";
    ctx.lineWidth = Math.max(1, 0.12 * br);
    ctx.shadowColor = "#fde68a";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(at.x, at.y, br, 0, TWO_PI);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#0ea5e9";
    ctx.beginPath();
    ctx.arc(at.x, at.y, 0.82 * br, 0, TWO_PI);
    ctx.fill();
    if (view.count !== this.countKey) {
      this.countKey = view.count;
      this.countText = labels.count(view.count);
    }
    ctx.font = `800 ${(this.countText.length > 3 ? 0.62 : 0.78) * br}px sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(this.countText, at.x, at.y + 0.04 * br);
    ctx.restore();
  }

  /**
   * Screen space: the title and the tiles left in the top-left corner of the square, the progress ring in the top-right one
   * and the caption centred over the spiral; `inset` moves them below the page's buttons.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: SpiralGlassView, labels: SpiralGlassLabels, inset = 0) {
    const L = view.layout;
    if (!L) return;
    const side = L.side;
    const fs = Math.max(11, 0.03 * side);
    const top = L.top + 0.02 * side + inset;
    const pad = 0.04 * side;
    const right = L.left + side;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.textAlign = "left";
    ctx.font = `800 ${(0.8 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillText(labels.title, L.left + pad, top + 0.5 * fs);
    if (view.tilesLeft !== this.tilesKey) {
      this.tilesKey = view.tilesLeft;
      this.tilesText = labels.tiles(view.tilesLeft, view.tilesTotal);
    }
    ctx.font = `700 ${(0.75 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "#e879f9";
    ctx.fillText(this.tilesText, L.left + pad, top + 1.6 * fs);
    // The progress ring: the glass left, as an arc that empties clockwise.
    const left = glassLeft(view);
    const rr = 0.9 * fs;
    const rx = right - pad - rr;
    const ry = top + 1.05 * fs;
    ctx.lineWidth = Math.max(2, 0.28 * rr);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.beginPath();
    ctx.arc(rx, ry, rr, 0, TWO_PI);
    ctx.stroke();
    if (left > 0) {
      ctx.strokeStyle = view.settings.rainbow ? `hsl(${Math.round(lineHue(view.timeMs))}, 90%, 65%)` : "#e879f9";
      ctx.beginPath();
      ctx.arc(rx, ry, rr, -Math.PI / 2, -Math.PI / 2 + TWO_PI * left);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.font = `700 ${(0.55 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText(`${Math.round(100 * left)}%`, rx, ry);
    // The caption over the spiral.
    const cfs = Math.max(11, 0.034 * side);
    ctx.font = `600 ${cfs.toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 6;
    ctx.fillText(labels.caption, L.cx, Math.max(top + 0.5 * cfs, L.cy - L.outerRadius - 0.03 * side - 0.5 * cfs));
    ctx.restore();
  }
}

/** The data-spiral-* attributes the canvas mirrors for tools and the smoke test. */
export const SPIRAL_GLASS_DATA_KEYS = ["spiralCount", "spiralBalls", "spiralTiles", "spiralTilesTotal", "spiralHp", "spiralChips", "spiralShatters", "spiralNotes", "spiralCleared", "spiralTimeout", "spiralFinished", "spiralFinishedMs"];

/** Writes the view's state into the data-spiral-* attributes (`set` only writes a changed value). */
export class SpiralGlassDataset {
  write(view: SpiralGlassView, set: (key: string, value: string) => void) {
    set("spiralCount", String(view.count));
    set("spiralBalls", String(view.balls));
    set("spiralTiles", String(view.tilesLeft));
    set("spiralTilesTotal", String(view.tilesTotal));
    set("spiralHp", String(view.hpLeft));
    set("spiralChips", String(view.chips));
    set("spiralShatters", String(view.shatters));
    set("spiralNotes", String(view.notes));
    set("spiralCleared", view.clearedMs >= 0 ? "1" : "0");
    set("spiralTimeout", view.timeoutMs >= 0 ? "1" : "0");
    set("spiralFinished", view.finished ? "1" : "0");
    set("spiralFinishedMs", String(Math.round(view.finishedMs)));
  }
}

/** Seconds of the run from the clear, for the banner (CLEAR_HOLD_MS after it the run is over). */
export function clearedSeconds(view: Pick<SpiralGlassView, "clearedMs">): string {
  return (Math.max(0, view.clearedMs) / 1000).toFixed(1);
}

export { CLEAR_HOLD_MS };
