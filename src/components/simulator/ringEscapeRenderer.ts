import type { CircularWall } from "@/lib/physics/types";
import { ringRainbowHue, ringRunOut, timeInRingSec, type GapLayout, type RingEscapeView, type RingSpin } from "@/lib/physics/ringEscape";
import { drawLoopHud, loopHudBands, loopHudLiveLayout, ringTimeText, type LoopHudBands, type LoopHudFrame } from "@/lib/loop/hud";

/*
 * --- ring-escape --- The canvas side of Classic's Ring Escape (lib/physics/ringEscape.ts): the rainbow by ring (a colour per
 * ring, red outside to cyan inside, cached per ring count) and the time-in-ring line ("ring 3: 1.4 s", "out in 11.2 s") – the
 * loop HUD's amber counter line (lib/loop/hud.ts), drawn under the rings on the live canvas (and so into the recorded square)
 * while the loop HUD itself is off; with the loop HUD on, its counter shows the timer instead. The canvas reports the line's
 * band to the live watermark, which keeps its badge clear of it. Also the canvas' data-ring-* attributes for the smoke test.
 */

/** What the page hands the canvas (null outside Classic): the look, the line's words and the page's language. */
export interface RingEscapeLook {
  /** The rainbow by ring. */
  rainbow: boolean;
  /** The time-in-ring line. */
  timer: boolean;
  /** "ring {ring}: {time} s" and "out in {time} s" (already translated). */
  ringText: string;
  outText: string;
  /** The page's language (the decimal separator). */
  locale?: string;
  /** A light page: the line in grey (the loop HUD's colours). */
  light: boolean;
  /** For the data attributes: the layout, the spiral's step and the spin. */
  layout: GapLayout;
  spin: RingSpin;
}

/* ------------------------------------------------------------------ the rainbow */

let rainbowCount = -1;
let rainbowSolid: string[] = [];

/** The colour of ring `index` of `count` in the rainbow by ring (alpha: the glow's layers). Cached per ring count. */
export function ringRainbowColor(index: number, count: number, alpha?: number): string {
  if (alpha !== undefined) return `hsla(${Math.round(ringRainbowHue(index, count))}, 100%, 60%, ${alpha})`;
  if (count !== rainbowCount) {
    rainbowCount = count;
    rainbowSolid = Array.from({ length: Math.max(0, Math.min(count, 100_000)) }, (_, i) => `hsl(${Math.round(ringRainbowHue(i, count))}, 100%, 60%)`);
  }
  return rainbowSolid[index] ?? `hsl(${Math.round(ringRainbowHue(index, count))}, 100%, 60%)`;
}

/* ------------------------------------------------------------------ the time in the ring */

/** The line's text at simulation time `nowMs`: "ring k: t s" (one decimal, the page's separator), "out in t s" once out; lowercase. */
export function ringTimerText(view: Readonly<RingEscapeView>, nowMs: number, look: Pick<RingEscapeLook, "ringText" | "outText" | "locale">): string {
  // (--- low-findings-2 --- the loop HUD's counter words it the same way: lib/loop/hud.ts ringTimeText())
  return ringTimeText({ ring: look.ringText, out: look.outText }, { ringSec: timeInRingSec(view, nowMs), ring: view.ring, rings: view.rings, out: ringRunOut(view) }, look.locale);
}

/** The line's text and its frame, reused (the text is formatted again only when the tenth of a second or the ring changes). */
export class RingTimerLine {
  private key = "";
  private text = "";
  private readonly frame: LoopHudFrame = { title: "", subtitle: "", counter: "", light: false };
  readonly bands: LoopHudBands = { top: -Infinity, bottom: Infinity };
  /** The centre (px) and the size of the line drawn last (−1: none). */
  y = -1;
  size = 0;

  textAt(view: Readonly<RingEscapeView>, nowMs: number, look: RingEscapeLook): string {
    const tenth = Math.floor(10 * timeInRingSec(view, nowMs) + 1e-6);
    const key = `${view.ring}|${view.outMs >= 0 ? 1 : 0}|${tenth}|${look.ringText}|${look.outText}|${look.locale ?? ""}`;
    if (key !== this.key) {
      this.key = key;
      this.text = ringTimerText(view, nowMs, look);
    }
    return this.text;
  }

  /**
   * Draws the line under the rings (`ring` px from the centre at `cy`) in a `width` × `height` canvas, the loop HUD's counter
   * style; `insetTop` keeps the HUD's title margin (unused here). Returns the band it covers (the live watermark's bottom band).
   */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, cy: number, ring: number, text: string, light: boolean): LoopHudBands {
    const layout = loopHudLiveLayout(width, height, cy, ring, 0);
    this.frame.counter = text;
    this.frame.light = light;
    drawLoopHud(ctx, width, this.frame, layout);
    loopHudBands(layout, this.frame, this.bands);
    this.y = text ? layout.counterY : -1;
    this.size = layout.counterSize;
    return this.bands;
  }
}

/* ------------------------------------------------------------------ data attributes */

const DATA_KEYS = ["ringLayout", "ringSpin", "ringRainbow", "ringTimer", "ringCount", "ringEscaped", "ringCurrent", "ringFirstMs", "ringOutMs", "ringGaps", "ringTimerText", "ringTimerY"];

let gapsWalls: readonly CircularWall[] | null = null;
let gapsText = "";

/** The rings' gap starts in whole degrees, inner to outer ("0,30,60,…"), recomputed only when the rings are rebuilt. */
export function ringGapDegrees(walls: readonly CircularWall[]): string {
  if (walls !== gapsWalls) {
    gapsWalls = walls;
    gapsText = walls
      .slice(0, 64)
      .map((w) => (w.gaps.length > 0 ? String(Math.round((w.gaps[0].startAngle * 180) / Math.PI) % 360) : "-"))
      .join(",");
  }
  return gapsText;
}

/** Writes the canvas' data-ring-* attributes (Classic only); `view` null clears them. */
export function writeRingEscapeData(setData: (key: string, value: string) => void, clear: (key: string) => void, view: Readonly<RingEscapeView> | null, look: RingEscapeLook | null, walls: readonly CircularWall[], timerText: string, timerY: number) {
  if (!view || !look) {
    for (const key of DATA_KEYS) clear(key);
    return;
  }
  setData("ringLayout", look.layout);
  setData("ringSpin", look.spin);
  setData("ringRainbow", look.rainbow ? "1" : "0");
  setData("ringTimer", look.timer ? "1" : "0");
  setData("ringCount", String(view.rings));
  setData("ringEscaped", String(view.escaped));
  setData("ringCurrent", String(view.ring));
  setData("ringFirstMs", String(Math.round(view.firstMs)));
  setData("ringOutMs", String(Math.round(view.outMs)));
  setData("ringGaps", ringGapDegrees(walls));
  setData("ringTimerText", timerText);
  setData("ringTimerY", timerY >= 0 ? timerY.toFixed(1) : "-1");
}
