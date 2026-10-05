import type { LiveHud } from "@/lib/watermark/liveLayout";
import { TRACK_X0, TRACK_X1 } from "@/lib/physics/raceTrack";
import { PD_CEILING } from "@/lib/physics/modes/paddle";

/*
 * --- watermark-everywhere --- What the canvas tells the live watermark about the HUD it drew this frame (lib/watermark/
 * liveLayout.ts `LiveHud`), for the HUD pieces whose renderers do not report their extent themselves: where the readouts,
 * clocks, standings, mini-maps and title blocks of the modes sit, from the same proportions their renderers draw them with
 * (the renderer named on each function). Generous rather than exact – the badge only has to keep clear of them – and free
 * of allocations (it runs every frame). Canvas.tsx reports the rest itself: the modes' top HUD bands (`modeTopHud`), Fight
 * League's ability boxes, the String Circle's standings strip, the arena games' scoreboard band, the teams' scoreboard, the
 * bounce-math values, the captions' stacks and the song bar.
 */

/** The square the HUD is laid out in (canvas units): its top-left corner and side. */
export interface HudSquare {
  x0: number;
  y0: number;
  side: number;
}

/**
 * A stack of readout badges in a bottom corner of the square (uncapRenderer.ts `drawUncapHud`: the speed and NUMBERS
 * OVERFLOWED, bottom left; unlimitedRenderer.ts `drawHud`: the crowd, real time and ARENA FULL, bottom right): `rows` badges
 * of 1.6 font sizes, `bottomInset` above the square's bottom edge, at most half the square wide.
 */
export function noteCornerReadouts(hud: LiveHud, sq: HudSquare, right: boolean, rows: number, bottomInset: number): void {
  if (rows <= 0) return;
  const fs = Math.max(11, 0.032 * sq.side);
  const pad = 0.025 * sq.side;
  const h = 1.6 * fs;
  const gap = 0.4 * fs;
  const height = rows * h + (rows - 1) * gap;
  const width = 0.5 * sq.side;
  const bottom = sq.y0 + sq.side - pad - bottomInset;
  hud.block(right ? sq.x0 + sq.side - pad - width : sq.x0 + pad, bottom - height, width, height);
}

/**
 * A title block in a top corner of the square (vortexRenderer.ts, beatDropRenderer.ts: top left; conveyorRenderer.ts: top
 * right; bullseyeRenderer.ts: both): `lines` lines of 1.1 font sizes (3 % of the square) from 3 % below its top, `inset`
 * lower live, at most half the square wide.
 */
export function noteTitleBlock(hud: LiveHud, sq: HudSquare, inset: number, lines: number, corner: "left" | "right" | "both"): void {
  const fs = Math.max(11, 0.03 * sq.side);
  const top = sq.y0 + inset;
  const height = 0.03 * sq.side + (lines + 0.5) * 1.1 * fs;
  const width = 0.5 * sq.side;
  if (corner !== "right") hud.block(sq.x0, top, width, height);
  if (corner !== "left") hud.block(sq.x0 + sq.side - width, top, width, height);
}

/** The square race's standings column (left) and mini-map strip (right) – raceRenderer.ts `drawStandings` / `drawMiniMap`. */
export function noteRaceHud(
  hud: LiveHud,
  view: { racers: number; phase: string; track: { field: { left: number; top: number; bottom: number; size: number } } | null },
  options: { showStandings?: boolean; showMiniMap?: boolean } | null,
  insetTop: number,
): void {
  const f = view.track?.field;
  if (!f || view.phase === "podium" || view.phase === "cup" || view.phase === "done") return;
  const S = f.size;
  if (options?.showStandings !== false) {
    const y0 = f.top + 0.012 * S + insetTop;
    const avail = f.bottom - 0.02 * S - y0;
    const n = Math.max(1, Math.min(view.racers, Math.floor(avail / 9 - 1.3)));
    const rh = Math.max(9, Math.min(0.05 * S, avail / (n + 1.3)));
    hud.block(f.left + 0.01 * S, y0, (TRACK_X0 - 0.022) * S, (1.5 + n) * rh);
  }
  if (options?.showMiniMap !== false) {
    const cx = f.left + (TRACK_X1 + (1 - TRACK_X1) / 2) * S;
    const w = 0.03 * S;
    hud.block(cx - w / 2, f.top + 0.08 * S, w, f.bottom - f.top - 0.16 * S);
  }
}

/**
 * The Journey's clock and score in the bottom-left corner of the square and the mini-map of the stages at its right edge –
 * journeyRenderer.ts `drawOverlay` (the field's height is the square's side).
 */
export function noteJourneyHud(hud: LiveHud, field: { cx: number; top: number; bottom: number; height: number } | null): void {
  if (!field) return;
  const side = field.height;
  const cfs = Math.max(12, 0.036 * side);
  const clockX = field.cx - 0.44 * side;
  const clockY = field.bottom - 0.05 * side;
  hud.block(clockX - 2.6 * cfs, clockY - 2.1 * cfs, 5.2 * cfs, 2.8 * cfs);
  const mx = field.cx + 0.47 * side;
  const mw = Math.max(5, 0.016 * side);
  const gfs = Math.max(9, 0.024 * side);
  hud.block(mx - mw - 1.6 * gfs, field.top + 0.08 * side, mw + 1.6 * gfs + 1.2 * mw, 0.84 * side);
}

/** The multipliers board's HOME counter in the bottom-left corner of the square – multiplierRenderer.ts `drawMultiplierHud`. */
export function noteHomeCounter(hud: LiveHud, sq: HudSquare): void {
  const big = Math.max(16, 0.06 * sq.side);
  const pad = 0.025 * sq.side;
  const h = 1.5 * big * 1.12; // (it pops 12 % larger on a new arrival)
  hud.block(sq.x0 + pad, sq.y0 + sq.side - pad - h, 0.4 * sq.side, h);
}

/** Beat Runner's progress bar and Paddle Keep-Up's score band, across the top of the square – jdmRhythmRenderer.ts. */
export function noteRhythmBand(hud: LiveHud, sq: HudSquare, inset: number, kind: "runner" | "paddle"): void {
  hud.topBand(kind === "runner" ? sq.y0 + inset + 0.05 * sq.side + 0.018 * sq.side + 2.2 * Math.max(11, 0.032 * sq.side) : sq.y0 + PD_CEILING * sq.side);
}

/**
 * The Top / Bottom Text lines (centred on `cx`, `fontSize` tall – the canvas' own, or while recording the recorder's lines
 * mapped onto the canvas): blocks as wide as their text is about to be.
 */
export function noteEdgeText(hud: LiveHud, cx: number, lines: { topY: number; bottomY: number; fontSize: number }, top: string, bottom: string): void {
  const fs = lines.fontSize;
  if (!(fs > 0)) return;
  if (top) {
    const half = 0.31 * fs * top.length + fs;
    hud.block(cx - half, lines.topY - 0.8 * fs, 2 * half, 1.6 * fs);
  }
  if (bottom) {
    const half = 0.31 * fs * bottom.length + fs;
    hud.block(cx - half, lines.bottomY - 0.8 * fs, 2 * half, 1.6 * fs);
  }
}
