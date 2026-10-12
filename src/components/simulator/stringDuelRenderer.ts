import type { StringBattleView } from "@/lib/physics/modes/stringBattle";
import { SB_DUEL_BANNER_MS, SB_DUEL_DIP_FACTOR, SB_DUEL_DIP_MS, SB_DUEL_FINAL_DIP_MS, SB_DUEL_FLASH_MS, SB_DUEL_PUNCH_MS, SB_DUEL_PUNCH_PX, SB_DUEL_TRAIL, trailPoint } from "@/lib/physics/modes/stringDuel";

/**
 * --- string-battle-alive --- The FINAL DUEL's drawing (lib/physics/modes/stringDuel.ts; the mode keeps the state), one
 * `StringDuelLayer` per draw loop, called by Canvas.tsx next to the String Battle's own layer (any of its styles):
 *
 *  - `frame()` once a frame: what the camera has to do – a short slow-motion dip for every new moment of the duel
 *    (`SB_DUEL_DIP_MS`), the longer one for the final cut (`SB_DUEL_FINAL_DIP_MS`) – read off the view's counters;
 *  - `punch()` (the world's transform): a 4 px camera punch at every moment, away from the cutter;
 *  - `drawStage()` (world space, under the balls): the ring's flash in the cutter's colour and both balls' comet trails (the
 *    last `SB_DUEL_TRAIL` positions the mode recorded, fading);
 *  - `drawBanner()` (screen space, inside the square the recorder exports, clear of its corners): FINAL DUEL in the two
 *    fighters' colours, 1.2 s, once a battle.
 *
 * Visual only: it reads the view and never writes to the engine; everything runs on the simulation clock (a recording shows the
 * same duel every time). Under `prefers-reduced-motion` the banner fades instead of popping, the punch is off, the flash and the
 * trails are softer. Steady-state frames allocate nothing: fonts are cached, the trail point is reused.
 */

export interface StringDuelLabels {
  /** "FINAL DUEL" – its first word in the first fighter's colour, the rest in the other's. */
  banner: string;
}

export const DEFAULT_STRING_DUEL_LABELS: StringDuelLabels = { banner: "FINAL DUEL" };

/** What the camera should do this frame: a slow-motion dip of `dipMs` (0: none) at `factor`. */
export interface DuelCameraCue {
  dipMs: number;
  factor: number;
}

const TWO_PI = Math.PI * 2;

export class StringDuelLayer {
  private generation = -1;
  private seenCuts = 0;
  private seenFinal = false;
  private bannerCounted = false;
  private reduced = false;
  private readonly fonts = new Map<number, string>();
  private readonly point = { x: 0, y: 0 };
  private readonly cue: DuelCameraCue = { dipMs: 0, factor: SB_DUEL_DIP_FACTOR };
  // Mirrored onto the canvas as data-sb-duel-* for tools and the smoke test.
  /** FINAL DUEL banners shown this battle (1 once the duel started), and whether one is up this frame. */
  banners = 0;
  bannerOn = false;
  /** The banner's letters last frame (screen px) – the live watermark keeps clear of them (w 0: none). */
  readonly bannerBox = { x: 0, y: 0, w: 0, h: 0 };
  /** Slow-motion dips asked of the camera this battle (one per moment, the final cut's included). */
  dips = 0;
  /** Trail points drawn last frame, ring flashes started this battle. */
  trailPoints = 0;
  flashes = 0;
  private lastFlashCut = 0;

  constructor() {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const q = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reduced = q.matches;
      q.addEventListener?.("change", (e) => {
        this.reduced = e.matches;
      });
    }
  }

  get reducedMotion() {
    return this.reduced;
  }

  private font(px: number): string {
    const size = Math.max(8, Math.round(px));
    let f = this.fonts.get(size);
    if (!f) {
      f = `900 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      this.fonts.set(size, f);
    }
    return f;
  }

  /** A new battle starts the counts over. */
  private sync(view: StringBattleView) {
    if (view.generation === this.generation) return;
    this.generation = view.generation;
    this.seenCuts = view.duelCuts;
    this.seenFinal = view.duelFinal;
    this.bannerCounted = false;
    this.banners = 0;
    this.dips = 0;
    this.flashes = 0;
    this.lastFlashCut = view.duelCuts;
  }

  /**
   * Once a frame (after the physics): the camera's cue – a dip of `SB_DUEL_DIP_MS` for every new moment of the duel, of
   * `SB_DUEL_FINAL_DIP_MS` for its final cut – or null. Counted in `dips`.
   */
  frame(view: StringBattleView): DuelCameraCue | null {
    this.sync(view);
    let dip = 0;
    if (view.duelCuts > this.seenCuts) {
      this.seenCuts = view.duelCuts;
      dip = SB_DUEL_DIP_MS;
    } else if (view.duelCuts < this.seenCuts) this.seenCuts = view.duelCuts;
    if (view.duelFinal && !this.seenFinal) dip = SB_DUEL_FINAL_DIP_MS;
    this.seenFinal = view.duelFinal;
    if (!(dip > 0)) return null;
    this.dips++;
    this.cue.dipMs = dip;
    this.cue.factor = SB_DUEL_DIP_FACTOR;
    return this.cue;
  }

  /** The camera punch at `nowMs` (simulation ms), written into `out`: 4 px away from the cutter, decaying; false when there is none. */
  punch(view: StringBattleView, nowMs: number, out: { x: number; y: number }): boolean {
    out.x = 0;
    out.y = 0;
    if (this.reduced || view.duelCuts === 0) return false;
    const age = nowMs - view.lastDuelCutMs;
    if (!(age >= 0 && age < SB_DUEL_PUNCH_MS)) return false;
    const cutter = view.fighters[view.lastDuelCutter];
    const victim = view.fighters[view.lastDuelVictim];
    let dx = 1;
    let dy = 0;
    if (cutter && victim) {
      dx = victim.x - cutter.x;
      dy = victim.y - cutter.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        dx /= d;
        dy /= d;
      } else {
        dx = 1;
        dy = 0;
      }
    }
    const k = 1 - age / SB_DUEL_PUNCH_MS;
    const amp = SB_DUEL_PUNCH_PX * k * k;
    out.x = dx * amp;
    out.y = dy * amp;
    return true;
  }

  /** Traces the arena's wall at `scale` × its radius (the circle, or the circle style's hexagon). */
  private wallPath(ctx: CanvasRenderingContext2D, view: StringBattleView, scale: number) {
    const R = view.radius * scale;
    ctx.beginPath();
    if (view.circle && view.circle.sides === 6) {
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        if (k === 0) ctx.moveTo(view.cx + R * Math.cos(a), view.cy + R * Math.sin(a));
        else ctx.lineTo(view.cx + R * Math.cos(a), view.cy + R * Math.sin(a));
      }
      ctx.closePath();
    } else ctx.arc(view.cx, view.cy, R, 0, TWO_PI);
  }

  /** World space, before the balls: the ring's flash in the cutter's colour and the comet trails. */
  drawStage(ctx: CanvasRenderingContext2D, view: StringBattleView, colorOf: (slot: number) => string, nowMs: number) {
    this.sync(view);
    this.trailPoints = 0;
    if (!view.duel) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // The flash: the ring in the cutter's colour, glowing, over SB_DUEL_FLASH_MS.
    const age = nowMs - view.lastDuelCutMs;
    if (view.duelCuts > 0 && age >= 0 && age < SB_DUEL_FLASH_MS && view.lastDuelCutter >= 0) {
      if (view.duelCuts !== this.lastFlashCut) {
        this.lastFlashCut = view.duelCuts;
        this.flashes++;
      }
      const k = 1 - age / SB_DUEL_FLASH_MS;
      const color = colorOf(view.lastDuelCutter);
      ctx.globalAlpha = (this.reduced ? 0.45 : 0.95) * k;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 + (this.reduced ? 2 : 6) * k;
      if (!this.reduced) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 26 * k;
      }
      this.wallPath(ctx, view, 1);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // The trails: every ball still in, its last positions from the oldest (thin, faint) to the newest (its body's width).
    if (!view.finished) {
      const p = this.point;
      for (const f of view.fighters) {
        if (!f.alive) continue;
        const n = view.trails.count[f.slot] ?? 0;
        if (n < 2) continue;
        ctx.strokeStyle = colorOf(f.slot);
        let px = 0;
        let py = 0;
        for (let k = 0; k < n; k++) {
          if (!trailPoint(view.trails, f.slot, k, p)) break;
          if (k > 0) {
            const u = k / (SB_DUEL_TRAIL - 1);
            ctx.globalAlpha = (this.reduced ? 0.25 : 0.55) * u;
            ctx.lineWidth = Math.max(1, f.radius * 1.4 * u);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            this.trailPoints++;
          }
          px = p.x;
          py = p.y;
        }
        // the last segment reaches the ball itself
        ctx.globalAlpha = this.reduced ? 0.25 : 0.55;
        ctx.lineWidth = Math.max(1, f.radius * 1.4);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(f.x, f.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Screen space: the FINAL DUEL banner for `SB_DUEL_BANNER_MS` after the duel started, centred in the square of `side` px at
   * (`sx`, `sy`) – far from its corners, where the watermark badge goes –, its first word in the first fighter's colour and the
   * rest in the other's. Pops in (fades with reduced motion). Returns whether it was drawn; `bannerBox` holds its letters.
   */
  drawBanner(ctx: CanvasRenderingContext2D, view: StringBattleView, colorOf: (slot: number) => string, nowMs: number, sx: number, sy: number, side: number, labels: StringDuelLabels): boolean {
    this.sync(view);
    this.bannerOn = false;
    this.bannerBox.w = 0;
    if (!view.duel || view.twoLeftMs < 0) return false;
    const age = nowMs - view.twoLeftMs;
    if (!(age >= 0 && age < SB_DUEL_BANNER_MS)) return false;
    if (!this.bannerCounted) {
      this.bannerCounted = true;
      this.banners++;
    }
    const pair: number[] = [];
    for (const f of view.fighters) if (f.alive && pair.length < 2) pair.push(f.slot);
    const colorA = pair.length > 0 ? colorOf(pair[0]) : "#ffffff";
    const colorB = pair.length > 1 ? colorOf(pair[1]) : colorA;
    const text = labels.banner || DEFAULT_STRING_DUEL_LABELS.banner;
    const space = text.indexOf(" ");
    const first = space > 0 ? text.slice(0, space) : text;
    const rest = space > 0 ? text.slice(space) : "";
    // in over 180 ms, held, out over the last 250 ms
    const tIn = Math.min(1, age / 180);
    const tOut = Math.min(1, (SB_DUEL_BANNER_MS - age) / 250);
    const alpha = Math.max(0, Math.min(tIn, tOut));
    const scale = this.reduced ? 1 : tIn < 1 ? 0.7 + 0.3 * tIn + 0.12 * Math.sin(tIn * Math.PI) : 1;
    let fs = Math.max(18, 0.085 * side);
    ctx.save();
    ctx.font = this.font(fs);
    let wA = ctx.measureText(first).width;
    let wB = rest ? ctx.measureText(rest).width : 0;
    const maxW = 0.8 * side;
    if (wA + wB > maxW) {
      fs *= maxW / (wA + wB);
      ctx.font = this.font(fs);
      wA = ctx.measureText(first).width;
      wB = rest ? ctx.measureText(rest).width : 0;
    }
    const cx = sx + side / 2;
    const cy = sy + side / 2;
    const w = wA + wB;
    this.bannerBox.x = cx - (scale * w) / 2;
    this.bannerBox.y = cy - (scale * 0.62 * fs);
    this.bannerBox.w = scale * w;
    this.bannerBox.h = scale * 1.24 * fs;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, 0.14 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    const x0 = -w / 2;
    ctx.strokeText(first, x0, 0);
    if (rest) ctx.strokeText(rest, x0 + wA, 0);
    ctx.shadowBlur = this.reduced ? 0 : 20;
    ctx.shadowColor = colorA;
    ctx.fillStyle = colorA;
    ctx.fillText(first, x0, 0);
    if (rest) {
      ctx.shadowColor = colorB;
      ctx.fillStyle = colorB;
      ctx.fillText(rest, x0 + wA, 0);
    }
    ctx.restore();
    this.bannerOn = true;
    return true;
  }
}

/** The canvas data keys the duel adds (data-sb-*); Canvas.tsx removes them with the battle's own. */
export const STRING_DUEL_DATA_KEYS = ["sbDuel", "sbFinaleFactor", "sbSurge", "sbDuelCuts", "sbDuelBanner", "sbDuelBannerOn", "sbDuelBannerBox", "sbDuelTrails", "sbDuelDips", "sbDuelFlashes", "sbDuelBeats", "sbDuelSounds", "sbDuelHomings", "sbDuelMaxHoming", "sbDuelFinal", "sbDuelReduced"];

/**
 * Mirrors the duel onto the canvas (data-sb-*): whether it is on, the speed factor and the surge, its moments, the banner
 * (shown, up now, its box in screen px), the trail points drawn, the camera dips and ring flashes, the heartbeats and sound
 * events, the homing turns (count, the largest in degrees), the final cut and reduced motion.
 */
export function writeStringDuelDataset(view: StringBattleView, layer: StringDuelLayer, set: (key: string, value: string) => void) {
  set("sbDuel", view.duel ? "1" : "0");
  set("sbFinaleFactor", view.finaleFactor.toFixed(3));
  set("sbSurge", view.surge.toFixed(3));
  set("sbDuelCuts", String(view.duelCuts));
  set("sbDuelBanner", String(layer.banners));
  set("sbDuelBannerOn", layer.bannerOn ? "1" : "0");
  const b = layer.bannerBox;
  set("sbDuelBannerBox", b.w > 0 ? [b.x, b.y, b.w, b.h].map((v) => v.toFixed(1)).join(",") : "");
  set("sbDuelTrails", String(layer.trailPoints));
  set("sbDuelDips", String(layer.dips));
  set("sbDuelFlashes", String(layer.flashes));
  set("sbDuelBeats", String(view.beats));
  set("sbDuelSounds", String(view.duelSounds));
  set("sbDuelHomings", String(view.homings));
  set("sbDuelMaxHoming", ((view.maxHoming * 180) / Math.PI).toFixed(2));
  set("sbDuelFinal", view.duelFinal ? "1" : "0");
  set("sbDuelReduced", layer.reducedMotion ? "1" : "0");
}
