import { liveBadgeBox, type LiveBadgeBox, type LiveGeometry, type LiveHud, type LiveRecording } from "@/lib/watermark/liveLayout"; // (--- fl-card-badge --- liveBadgeBox)
import { TRACK_X0, TRACK_X1 } from "@/lib/physics/raceTrack";
import { PD_CEILING } from "@/lib/physics/modes/paddle";
import { SHOT_LANDED, type BullseyeView } from "@/lib/physics/modes/bullseye"; // --- badge-clear ---
import type { CollideView } from "@/lib/physics/modes/collide"; // --- badge-clear ---
import type { PendulumView } from "@/lib/physics/modes/pendulum"; // --- badge-clear ---
import { POPUP_REACH, popupFontSize } from "./bullseyeRenderer"; // --- badge-clear --- (B-g3 review: the score popups' reach)

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

// --- badge-clear --- (round two, B7a) The payoffs the badge kept landing on, drawn in the world rather than in a HUD corner: the
// multipliers board's HOME zone, Bullseye's target and its landed pile, Collision Playground's heap under a pouring jar and Pendulum
// Wave's support bar. A band or a block each, from the same geometry their renderers draw with; the world ones mapped to the screen
// through the frame's view (`HudView`), so a zoom or a follow camera moves them with the picture.

/** Where the world is drawn this frame (canvas units): screen = world × `scale` + (`tx`, `ty`) – the camera's zoom and follow. */
export interface HudView {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * The multipliers board's HOME zone (multiplierRenderer.ts `drawMultipliersBoard`: the green band across the board with HOME and
 * its count in the middle), its top at `homeTop` (screen): a band along the bottom of the square while it is on screen, so the
 * badge sits above it instead of on the count (a payoff number) – the corner chip `noteHomeCounter()` reports is the count while
 * the zone is below the screen.
 */
export function noteHomeBand(hud: LiveHud, sq: HudSquare, homeTop: number): void {
  if (homeTop > sq.y0 && homeTop < sq.y0 + sq.side) hud.bottomBand(homeTop);
}

/**
 * Bullseye's target and the balls that landed (bullseyeRenderer.ts `drawWorld`: the dartboard lying on the landing line, the shots
 * stuck where they landed, stacked where they met): a band along the bottom of the square from the top of the target's ellipse or
 * of the highest landed ball, whichever is higher, so the badge keeps above the pile at the target's ends – raised by the reach of
 * the score popups (`drawEffects`: each landing's "+N" rises from it for `POPUP_MS`), so the badge keeps above the popups of the
 * shots landed at the ends too. A fixed reach rather than each popup while it shows: the badge holds still instead of jumping for
 * a second at every landing.
 */
export function noteBullseyePile(hud: LiveHud, view: Pick<BullseyeView, "layout" | "shots" | "shotState" | "shotY">, world: HudView): void {
  const L = view.layout;
  if (!L) return;
  let top = L.floorY - L.targetDepth;
  for (let k = 0; k < view.shots; k++) if (view.shotState[k] === SHOT_LANDED && view.shotY[k] - L.ballRadius < top) top = view.shotY[k] - L.ballRadius;
  top -= POPUP_REACH * popupFontSize(L.fieldHeight); // (B-g3 review)
  hud.bottomBand(top * world.scale + world.ty);
}

/**
 * Collision Playground's heap (collideRenderer.ts, --- collide-pour ---): once the jar pours, the orbs out of it heap on the catch
 * floor under it – the square's sides and bottom – so from the first orb out the floor under the jar is a block, and the badge
 * takes its side's top corner beside the jar instead of the heap.
 */
export function noteCollideHeap(hud: LiveHud, view: Pick<CollideView, "field" | "pourActive" | "left" | "count">, world: HudView): void {
  const f = view.field;
  if (!f || !view.pourActive || !(view.left < view.count)) return;
  const s = world.scale;
  hud.block(f.catchLeft * s + world.tx, f.bottom * s + world.ty, (f.catchRight - f.catchLeft) * s, (f.catchBottom - f.bottom) * s);
}

/**
 * Pendulum Wave's support bar (pendulumRenderer.ts `drawPendulumRig`, the row layout: the bar from three bob radii left of the first
 * pivot to three right of the last, its pivots on it): a block a bob radius above and below it, so when IN LINE! takes the bottom
 * of the square the badge no longer moves onto the bar. The other layouts have no bar.
 */
export function notePendulumBar(hud: LiveHud, view: Pick<PendulumView, "rig">, world: HudView): void {
  const rig = view.rig;
  if (!rig || rig.layout !== "row") return;
  const n = rig.anchorX.length;
  if (n === 0) return;
  const r = Math.max(3, rig.bobRadius);
  const x0 = rig.anchorX[0] - 3 * r;
  const x1 = rig.anchorX[n - 1] + 3 * r;
  const s = world.scale;
  hud.block(x0 * s + world.tx, (rig.barY - r) * s + world.ty, (x1 - x0) * s, 2 * r * s);
}
// --- end badge-clear ---

// --- fl-card-badge --- (round two, B7b) Fight League's end card covers the whole arena, and the free band between the title (or the
// names band) and the ability boxes holds no corner beside it: the badge sat on the card's lower corner, and in its right-hand
// window over the end of the card's line ("HP left · hits · 14.2 s"). Under the boxes, flHudLayout() keeps a strip a badge's height
// and inset tall for a portrait export's badge; while the card is up the HUD report sends the badge there.

/** Fight League's layer as the HUD report reads it (fightLeagueRenderer.ts `FightLeagueLayer`, the last frame's; screen units). */
export interface FlCardHud {
  boxesTop: number;
  boxesBottom: number;
  card: { x: number; y: number; w: number; h: number };
  fanLine: { x: number; y: number; w: number; h: number };
}

const flGeom: LiveGeometry = { area: { x: 0, y: 0, width: 0, height: 0 }, recording: null };
const flBox: LiveBadgeBox = { height: 0, inset: 0, zone: { x: 0, y: 0, width: 0, height: 0 } };

/**
 * While Fight League's end card is up (fightLeague/cards.ts `drawVerdict`, the champion's in shows.ts) and the strip under the
 * ability boxes holds the badge in this frame's layout (liveLayout.ts `liveBadgeBox()`: the live square, or the export frame the
 * page records or the fast export renders): the card, the boxes and the fan-made line in the strip as blocks, the boxes no longer
 * a band along the bottom, so the badge takes a bottom corner of the strip clear of all three. A square or landscape export's safe
 * zone ends above the strip and leaves no corner free of the card: nothing is reported there, the caller reports the boxes' band
 * as before, and the badge keeps its corner beside the card rather than falling back over the boxes. Returns whether it reported.
 */
export function noteFightLeagueCard(hud: LiveHud, sq: HudSquare, fl: FlCardHud, recording: LiveRecording | null): boolean {
  if (!flCardHoldsStrip(hud.unit, sq, fl, recording)) return false;
  hud.block(fl.card.x, fl.card.y, fl.card.w, fl.card.h);
  hud.block(sq.x0, fl.boxesTop, sq.side, fl.boxesBottom - fl.boxesTop);
  hud.block(fl.fanLine.x, fl.fanLine.y, fl.fanLine.w, fl.fanLine.h);
  return true;
}

/**
 * Whether Fight League's end card is up and the strip under the ability boxes holds the badge in this frame's layout (`unit` canvas
 * px per unit): what `noteFightLeagueCard()` and `noteFlCardCaptions()` report on.
 */
export function flCardHoldsStrip(unit: number, sq: HudSquare, fl: FlCardHud, recording: LiveRecording | null): boolean {
  if (!(fl.card.w > 0) || !Number.isFinite(fl.boxesTop) || !Number.isFinite(fl.boxesBottom)) return false;
  flGeom.area.x = sq.x0 * unit;
  flGeom.area.y = sq.y0 * unit;
  flGeom.area.width = flGeom.area.height = sq.side * unit;
  flGeom.recording = recording;
  const box = liveBadgeBox(flGeom, flBox);
  return box.zone.y + box.zone.height - box.inset - box.height >= fl.boxesBottom * unit;
}

/**
 * (B-g3 review) The bottom captions while the end card holds the strip (`flCardHoldsStrip()`): they keep above the boxes (the canvas
 * caps their stack there), so a band along the bottom from their top would end the free band above the strip, leave no corner off
 * the card and send the badge to its fallback – over the fan-made line in a longer language's right-hand window. A block where they
 * are instead, from `top` to `bottom` (the stack's upper and lower edges) across the canvas' `width`, so the badge keeps the strip.
 * Returns whether it reported them; else the caller reports their band, as before.
 */
export function noteFlCardCaptions(hud: LiveHud, sq: HudSquare, fl: FlCardHud, recording: LiveRecording | null, width: number, top: number, bottom: number): boolean {
  if (!flCardHoldsStrip(hud.unit, sq, fl, recording)) return false;
  hud.block(0, top, width, bottom - top);
  return true;
}
// --- end fl-card-badge ---

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
