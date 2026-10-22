import { TilesLayer, isTileStyle, rgbOf } from "./tilesRenderer";
import { noteTitleBlock, type HudSquare } from "./liveMarkHud";
import type { LiveHud } from "@/lib/watermark/liveLayout";
import { ballLabel, bannerText, type BlueprintView } from "@/lib/blueprint/runtime/view";
import { WALL_HALF } from "@/lib/blueprint/runtime/world";

/**
 * Canvas drawing of Mode Lab (feature blueprint, lib/physics/modes/blueprint.ts): a Blueprint's arena and everything in it.
 * The canvas calls, per frame:
 *  - `drawWorld()` under the balls: the arena's floor in the spec's background colour, the tiles (tilesRenderer.ts
 *    TilesLayer: glass, brick or neon), the pegs, bumpers, bars and spinners (a peg glows when hit), the rings with their
 *    turning gaps (a broken ring flashes out) and the rim with its turning exits, or the box;
 *  - `drawEffects()` over the balls: each ball's label (its tier, or its hit points) and the spec's white flash;
 *  - `drawOverlay()` in the recorder's square: the title and the HUD counters (top left), the clock counting down to the
 *    timeout (top right) and ARENA FULL when the ball ceiling refused a ball.
 * The end banner is the canvas' own `bigBanner()` with `endTitle()` / `endSub()`. Everything animates on the run's clock
 * (simulated time), so a pause freezes it and a recording replays it; strings are cached, nothing is allocated per frame.
 * Text the spec carries (its name, HUD labels, result lines, team names) is the author's; a catalog entry's comes from the
 * page's messages (`labels.catalog`), so the built-in games speak the visitor's language.
 */

export interface BlueprintRenderOptions {
  /** The wall colour with an alpha (the rim and the rings when the spec's rim colour is the wall's). */
  wallAlpha: (alpha: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
}

/** A catalog entry's texts in the page's language (every field optional: a missing one falls back to the spec's). */
export interface BlueprintCatalogLabels {
  name?: string;
  /** The HUD labels, in the spec's order. */
  hud?: string[];
  /** The result lines of the finish conditions, in order ("[winner] WINS"; the placeholders are the spec's, in brackets). */
  says?: string[];
  timeoutSay?: string;
}

export interface BlueprintLabels {
  /** The badge when the arena refused a ball at the ceiling. */
  arenaFull: string;
  /** The clock: seconds left until the timeout. */
  timeLeft: (seconds: number) => string;
  /** The banner's subline: when the run ended. */
  endedAt: (seconds: string) => string;
  /** The teams' names (palette order) for a catalog entry's {winner}. */
  teamNames: string[];
  /** "Nobody", the {winner} of a run without one. */
  nobody: string;
  /** Each catalog entry's texts, by its id. */
  catalog: Record<string, BlueprintCatalogLabels>;
}

export const DEFAULT_BLUEPRINT_LABELS: BlueprintLabels = {
  arenaFull: "ARENA FULL",
  timeLeft: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
  endedAt: (s) => `${s} s`,
  teamNames: ["RED", "BLUE", "GREEN", "GOLD", "PURPLE", "CYAN"],
  nobody: "NOBODY",
  catalog: {},
};

/** How long ARENA FULL stays up after the last refused ball, a broken ring flashes out and a peg glows (s of the run). */
export const ARENA_FULL_SEC = 1.5;
export const RING_BREAK_SEC = 0.45;
export const PEG_GLOW_SEC = 0.25;
const TWO_PI = Math.PI * 2;

/** "#rrggbb" with an alpha, as rgba(). */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = rgbOf(color);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** The square the recorder crops (world px): the shorter side, centred. */
export function recorderSquare(width: number, height: number, out: HudSquare = { x0: 0, y0: 0, side: 0 }): HudSquare {
  const side = Math.min(width, height);
  out.x0 = (width - side) / 2;
  out.y0 = (height - side) / 2;
  out.side = side;
  return out;
}

/**
 * A result line with its bracketed (a catalog's message) or braced (a spec's own) placeholders filled from the run: the
 * winner's name, the time, the counts and the spec's variables.
 */
export function fillResultLine(template: string, view: BlueprintView, labels: BlueprintLabels): string {
  const bp = view.bp;
  const world = view.world;
  if (!bp || !world) return template;
  const r = view.result;
  const own = view.catalogId === "";
  const names = own ? bp.look.teamNames : labels.teamNames;
  const value = (key: string): string | null => {
    switch (key) {
      case "winner":
        return r.winner >= 0 ? (names[r.winner] ?? bp.look.teamNames[r.winner] ?? `${r.winner + 1}`) : labels.nobody;
      case "time":
        return `${r.timeSec.toFixed(1)} s`;
      case "balls":
        return String(view.balls);
      case "escaped":
        return String(view.escaped);
      case "tiles":
        return String(view.tiles);
      case "rings":
        return String(view.rings);
      case "tier": {
        let t = 0;
        for (const b of world.balls) if (b.alive && b.tier > t) t = b.tier;
        return String(t);
      }
      default: {
        const hud = view.hud.find((h) => h.show === key);
        return hud ? hud.value : null;
      }
    }
  };
  return template.replace(/[[{]([a-z][a-z0-9]{0,7})[\]}]/g, (whole, key: string) => value(key) ?? whole);
}

/** The end banner's title: the result line, in the page's language for a catalog entry. */
export function endTitle(view: BlueprintView, labels: BlueprintLabels): string {
  const r = view.result;
  if (!r.finished || !view.bp) return "";
  const cat = view.catalogId ? labels.catalog[view.catalogId] : undefined;
  if (cat) {
    const template = r.reason === "condition" ? cat.says?.[r.condition] : r.reason === "timeout" ? cat.timeoutSay : undefined;
    if (template) return fillResultLine(template, view, labels).toUpperCase();
  }
  return bannerText(view);
}

/** The banner's subline: when the run ended. */
export function endSub(view: BlueprintView, labels: BlueprintLabels): string {
  return labels.endedAt(view.result.timeSec.toFixed(1));
}

/** The banner's colour: the winner's palette colour, else white (a timeout: a soft red). */
export function endColor(view: BlueprintView): string {
  const r = view.result;
  if (r.reason === "timeout" || r.reason === "fault") return "#fb7185";
  if (view.bp && r.winner >= 0) return view.bp.look.palette[r.winner % view.bp.look.palette.length] ?? "#f8fafc";
  return "#f8fafc";
}

export class BlueprintLayer {
  private readonly tiles = new TilesLayer();
  private readonly sq: HudSquare = { x0: 0, y0: 0, side: 0 };
  private clockKey = -1;
  private clockText = "";
  private readonly hudKeys: string[] = [];
  private readonly hudTexts: string[] = [];
  /** HUD lines drawn this frame (the watermark's title block). */
  private lines = 0;
  private arenaFullOn = false;
  private readonly exitOrder = new Int8Array(4);

  /** Under the balls: the floor, the tiles, the obstacles, the rings and the rim. */
  drawWorld(ctx: CanvasRenderingContext2D, view: BlueprintView, opts: BlueprintRenderOptions) {
    const bp = view.bp;
    const w = view.world;
    if (!bp || !w) return;
    const palette = bp.look.palette;
    const rim = palette[bp.look.rim] ?? palette[0] ?? "#ffffff";
    const t = view.timeSec;
    const lw = Math.max(2, Math.min(6, opts.wallThickness));
    ctx.save();
    ctx.globalAlpha = 1;
    // the floor: the spec's background inside the arena
    ctx.fillStyle = withAlpha(bp.look.background, 0.9);
    ctx.beginPath();
    if (w.shape === "box") ctx.rect(w.cx - w.R, w.cy - w.R, 2 * w.R, 2 * w.R);
    else ctx.arc(w.cx, w.cy, w.R, 0, TWO_PI);
    ctx.fill();
    // the tiles
    if (bp.tiles && w.tileCount > 0) this.tiles.draw(ctx, w.tiles, { style: isTileStyle(bp.tiles.style) ? bp.tiles.style : "glass", palette, colorBy: bp.tiles.pitchBy === "col" ? "col" : "row" });
    // pegs and bumpers
    for (let i = 0; i < w.pegX.length; i++) {
      const glow = Math.max(0, 1 - (t - w.pegHitAt[i]) / PEG_GLOW_SEC);
      const bumper = w.pegKick[i] !== 0;
      ctx.beginPath();
      ctx.arc(w.pegX[i], w.pegY[i], w.pegR[i], 0, TWO_PI);
      ctx.fillStyle = glow > 0 ? withAlpha("#ffffff", 0.5 + 0.5 * glow) : bumper ? withAlpha(rim, 0.85) : "rgba(226, 232, 240, 0.8)";
      if (glow > 0 && opts.showWallGlow) {
        ctx.shadowColor = rim;
        ctx.shadowBlur = 12 * glow;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      if (bumper) {
        ctx.lineWidth = Math.max(1.5, 0.25 * w.pegR[i]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.stroke();
      }
    }
    // bars and spinners: capsules
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(226, 232, 240, 0.85)";
    for (let i = 0; i < w.barAx.length; i++) {
      ctx.lineWidth = Math.max(1, 2 * w.barHalf[i]);
      ctx.beginPath();
      ctx.moveTo(w.barAx[i], w.barAy[i]);
      ctx.lineTo(w.barBx[i], w.barBy[i]);
      ctx.stroke();
    }
    ctx.strokeStyle = withAlpha(rim, 0.95);
    for (let i = 0; i < w.spinX.length; i++) {
      const c = Math.cos(w.spinAngle[i]) * w.spinLen[i];
      const s = Math.sin(w.spinAngle[i]) * w.spinLen[i];
      ctx.lineWidth = Math.max(1, 2 * w.spinHalf[i]);
      ctx.beginPath();
      ctx.moveTo(w.spinX[i] - c, w.spinY[i] - s);
      ctx.lineTo(w.spinX[i] + c, w.spinY[i] + s);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(w.spinX[i], w.spinY[i], Math.max(1.5, w.spinHalf[i]), 0, TWO_PI);
      ctx.fill();
    }
    // the walls
    ctx.lineWidth = lw;
    if (opts.showWallGlow) {
      ctx.shadowColor = rim;
      ctx.shadowBlur = 8;
    }
    ctx.strokeStyle = rim;
    if (w.shape === "box") {
      ctx.strokeRect(w.cx - w.R - WALL_HALF, w.cy - w.R - WALL_HALF, 2 * (w.R + WALL_HALF), 2 * (w.R + WALL_HALF));
    } else if (w.shape === "rings") {
      for (let k = 0; k < w.ringR.length; k++) {
        const r = w.ringR[k];
        if (w.ringAlive[k]) {
          const hue = palette[k % palette.length] ?? rim;
          ctx.strokeStyle = hue;
          if (opts.showWallGlow) ctx.shadowColor = hue;
          const gap = w.ringGapAt[k];
          ctx.beginPath();
          ctx.arc(w.cx, w.cy, r, gap + w.ringGapHalf, gap - w.ringGapHalf + TWO_PI);
          ctx.stroke();
        } else {
          const age = t - w.ringBrokeAt[k];
          if (w.ringBrokeAt[k] >= 0 && age >= 0 && age < RING_BREAK_SEC) {
            const u = age / RING_BREAK_SEC;
            ctx.strokeStyle = withAlpha("#ffffff", 0.9 * (1 - u));
            ctx.lineWidth = lw * (1 + 3 * u);
            ctx.beginPath();
            ctx.arc(w.cx, w.cy, r * (1 + 0.08 * u), 0, TWO_PI);
            ctx.stroke();
            ctx.lineWidth = lw;
          }
        }
      }
    } else {
      // the rim, with its exits as turning openings
      const n = w.exitAt.length;
      if (n === 0) {
        ctx.beginPath();
        ctx.arc(w.cx, w.cy, w.R + WALL_HALF, 0, TWO_PI);
        ctx.stroke();
      } else {
        // the openings in angle order, so the arcs between them are drawn in turn (an insertion sort of at most 4 exits)
        const order = this.exitOrder;
        const start = (i: number) => (((w.exitAt[i] + w.rimAngle - w.exitHalf[i]) % TWO_PI) + TWO_PI) % TWO_PI;
        for (let k = 0; k < n; k++) {
          let m = k;
          order[m] = k;
          while (m > 0 && start(order[m - 1]) > start(order[m])) {
            const tmp = order[m - 1];
            order[m - 1] = order[m];
            order[m] = tmp;
            m--;
          }
        }
        for (let k = 0; k < n; k++) {
          const i = order[k];
          const j = order[(k + 1) % n];
          const from = start(i) + 2 * w.exitHalf[i];
          let to = start(j);
          if (to <= from) to += TWO_PI;
          if (to - from > 1e-3) {
            ctx.beginPath();
            ctx.arc(w.cx, w.cy, w.R + WALL_HALF, from, to);
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  }

  /** Over the balls: their labels (tier or hit points) and the spec's white flash. */
  drawEffects(ctx: CanvasRenderingContext2D, view: BlueprintView) {
    const w = view.world;
    if (!w) return;
    ctx.save();
    if (view.showTiers || view.showHp) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
      ctx.lineJoin = "round";
      for (const b of w.balls) {
        if (!b.alive || b.r < 6) continue;
        const text = ballLabel(view, b);
        if (!text) continue;
        const fs = Math.max(8, Math.min(28, 0.95 * b.r));
        ctx.font = `800 ${fs.toFixed(1)}px sans-serif`;
        ctx.lineWidth = Math.max(1.5, 0.18 * fs);
        ctx.strokeText(text, b.x, b.y + 0.04 * fs);
        ctx.fillText(text, b.x, b.y + 0.04 * fs);
      }
    }
    const flash = 1 - (view.timeSec - view.flashAtSec) / 0.3;
    if (flash > 0) {
      ctx.fillStyle = withAlpha("#ffffff", 0.35 * flash);
      ctx.beginPath();
      if (w.shape === "box") ctx.rect(w.cx - w.R, w.cy - w.R, 2 * w.R, 2 * w.R);
      else ctx.arc(w.cx, w.cy, w.R, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * The recorder's square: the title and up to two HUD counters in the top-left corner, the clock in the top-right one and
   * ARENA FULL under it; `inset` moves them below the page's buttons.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: BlueprintView, labels: BlueprintLabels, inset = 0) {
    const bp = view.bp;
    const w = view.world;
    if (!bp || !w) return;
    const sq = recorderSquare(w.width, w.height, this.sq);
    const fs = Math.max(11, 0.03 * sq.side);
    const top = sq.y0 + 0.03 * sq.side + inset;
    const pad = 0.04 * sq.side;
    const cat = view.catalogId ? labels.catalog[view.catalogId] : undefined;
    const accent = bp.look.palette[bp.look.rim] ?? "#22d3ee";
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 4;
    ctx.font = `800 ${(0.9 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText((cat?.name ?? bp.meta.name).toUpperCase(), sq.x0 + pad, top + 0.5 * fs);
    this.lines = 1;
    for (let i = 0; i < view.hud.length; i++) {
      const h = view.hud[i];
      const label = cat?.hud?.[i] ?? h.label ?? h.show;
      const key = `${label}|${h.value}`;
      if (this.hudKeys[i] !== key) {
        this.hudKeys[i] = key;
        this.hudTexts[i] = label ? `${label.toUpperCase()} ${h.value}` : h.value;
      }
      ctx.font = `700 ${(0.78 * fs).toFixed(1)}px sans-serif`;
      ctx.fillStyle = i === 0 ? accent : "rgba(255, 255, 255, 0.8)";
      ctx.fillText(this.hudTexts[i], sq.x0 + pad, top + (0.5 + 1.1 * (i + 1)) * fs);
      this.lines++;
    }
    // the clock: seconds left until the timeout
    const left = Math.max(0, Math.ceil(view.timeoutSec - view.timeSec));
    if (left !== this.clockKey) {
      this.clockKey = left;
      this.clockText = labels.timeLeft(left);
    }
    ctx.textAlign = "right";
    ctx.font = `700 ${(0.85 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = left <= 5 && !view.result.finished ? "#fb7185" : "rgba(255, 255, 255, 0.8)";
    ctx.fillText(this.clockText, sq.x0 + sq.side - pad, top + 0.5 * fs);
    this.arenaFullOn = view.timeSec - view.arenaFullAtSec < ARENA_FULL_SEC;
    if (this.arenaFullOn) {
      ctx.font = `800 ${(0.75 * fs).toFixed(1)}px sans-serif`;
      ctx.fillStyle = "#fbbf24";
      ctx.fillText(labels.arenaFull, sq.x0 + sq.side - pad, top + 1.6 * fs);
    }
    ctx.restore();
  }

  /** The HUD this frame drew, so the live watermark badge keeps clear of it (the title block in both top corners). */
  noteHud(hud: LiveHud, sq: HudSquare, inset: number) {
    noteTitleBlock(hud, sq, inset, Math.max(this.lines, this.arenaFullOn ? 2 : 1), "both");
  }
}

/** The data-blueprint-* attributes the canvas mirrors for tools and the smoke test. */
export const BLUEPRINT_DATA_KEYS = ["blueprintName", "blueprintCatalog", "blueprintFinished", "blueprintReason", "blueprintResult", "blueprintBalls", "blueprintTiles", "blueprintTime", "blueprintSteps", "blueprintDropped", "blueprintFault", "blueprintEscaped"];

/** Writes the view's state into the data-blueprint-* attributes (`set` only writes a changed value). */
export class BlueprintDataset {
  write(view: BlueprintView, set: (key: string, value: string) => void) {
    set("blueprintName", view.bp?.meta.name ?? "");
    set("blueprintCatalog", view.catalogId);
    set("blueprintFinished", view.result.finished ? "1" : "0");
    set("blueprintReason", view.result.reason ?? "");
    set("blueprintResult", view.result.result);
    set("blueprintBalls", String(view.balls));
    set("blueprintTiles", String(view.tiles));
    set("blueprintTime", view.timeSec.toFixed(1));
    set("blueprintSteps", String(view.steps));
    set("blueprintDropped", String(view.dropped));
    set("blueprintFault", view.faults > 0 ? "1" : "0");
    set("blueprintEscaped", String(view.escaped));
  }
}
