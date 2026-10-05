import { BADGE_MIN_HEIGHT, badgeCorner, badgeMetrics, badgeZone, exportSquare, type FrameRect } from "./layout";

/*
 * --- watermark-everywhere --- Where the watermark goes on the LIVE canvas – the simulator's stage, a split-screen race's
 * composed frame, the landing page's live preview – of a visitor without a Pro licence. Pure (no DOM): the live painter
 * (live.ts) draws what these functions place, tests/watermarkEverywhere.test.ts checks them.
 *
 * The mark is the free-watermark one (layout.ts places it in videos, paint.ts draws it): the same badge – the logo mark,
 * the site's name and domain on a dark pill at 70 % – and the same faint diagonal domain tiles at 4 %. On the live canvas:
 *
 *  - the badge sits in a corner of the exported square (the centred square the page recorder crops, so a recording of the
 *    canvas carries it), `LIVE_MARGIN` (1.5 %) of the square's side from its edges, `LIVE_BADGE_HEIGHT` (4.5 %) of the
 *    side tall (never below the video's 18 px), and changes side every 6 s like the video mark (`badgeCorner()`): the left
 *    corners for 0–6 s, the right ones for 6–12 s, and so on;
 *  - it keeps clear of the mode's HUD text: the canvas reports its HUD this frame (`LiveHud`) – bands along the top and the
 *    bottom of the square (a mode's title line, Fight League's names and ability boxes, the captions' stacks, the arena
 *    games' scoreboard band) and blocks (the teams' scoreboard, Journey's clock, the No limits and speed readouts, the
 *    bounce-math values, a race's standings and mini-map, a split-screen race's arena labels). The badge takes the bottom
 *    corner of its side inside the free band between those bands; when a block holds it, the top corner of the same side
 *    (so the side still alternates every 6 s); when both are held, the other side's – and only when every corner is held
 *    does it go over the HUD, in its bottom corner;
 *  - while the page recorder records the canvas, the badge goes where the video layout puts it in the export frame
 *    (layout.ts: in the platforms' safe zone, 5.2 % of the exported square, 2.5 % inset), mapped back onto the canvas: the
 *    recorder copies the canvas square into its frame and adds no badge of its own, so the clip carries exactly one, in the
 *    same place as before (and as the fast export's).
 */

/** The live badge's height as a share of the exported square's side (4.5 %, never below `BADGE_MIN_HEIGHT`). */
export const LIVE_BADGE_HEIGHT = 0.045;
/** The live badge keeps this far (a share of the exported square's side) from the edges of its band. */
export const LIVE_MARGIN = 0.015;

export type LiveCorner = "bottom-left" | "bottom-right" | "top-left" | "top-right";

const LEFT_FIRST: readonly LiveCorner[] = ["bottom-left", "top-left", "bottom-right", "top-right"];
const RIGHT_FIRST: readonly LiveCorner[] = ["bottom-right", "top-right", "bottom-left", "top-left"];

/**
 * The corners the badge tries at `clipMs`, best first: its side of the moment (left for 0–6 s, right for 6–12 s – the
 * video's `badgeCorner()`), bottom before top, then the other side.
 */
export function liveCornerOrder(clipMs: number): readonly LiveCorner[] {
  return badgeCorner(clipMs) === "bottom-left" ? LEFT_FIRST : RIGHT_FIRST;
}

const sideOf = (side: number) => (Number.isFinite(side) && side > 0 ? side : 0);

/** The live badge's height (px) for an exported square of `side` px: 4.5 % of it, at least 18 px. */
export function liveBadgeHeight(side: number): number {
  return Math.max(BADGE_MIN_HEIGHT, Math.round(LIVE_BADGE_HEIGHT * sideOf(side)));
}

/** The live badge's distance from the edges of its band (px): 1.5 % of the square's side, at least 1 px. */
export function liveMargin(side: number): number {
  return Math.max(1, Math.round(LIVE_MARGIN * sideOf(side)));
}

/**
 * The HUD a frame drew, as the canvas reports it after drawing (reset every frame; nothing is allocated per frame): the
 * lowest bottom edge of the bands along the top of the square, the highest top edge of the bands along its bottom, and
 * blocks anywhere. The canvas reports in its own drawing units; `unit` (canvas px per unit, set by `reset()`) turns them
 * into canvas px.
 */
export class LiveHud {
  unit = 1;
  /** Canvas px: where the free band starts below the top HUD (−Infinity: no top HUD). */
  top = -Infinity;
  /** Canvas px: where the free band ends above the bottom HUD (Infinity: no bottom HUD). */
  bottom = Infinity;
  /** The blocks, four numbers each (x, y, w, h in canvas px); `count` of them are this frame's. */
  readonly blocks: number[] = [];
  count = 0;

  /** Starts a frame's report in units of `unit` canvas px. */
  reset(unit = 1): this {
    this.unit = Number.isFinite(unit) && unit > 0 ? unit : 1;
    this.top = -Infinity;
    this.bottom = Infinity;
    this.count = 0;
    return this;
  }

  /** A HUD band along the top of the square, down to `y` (units). */
  topBand(y: number): void {
    if (Number.isFinite(y) && y * this.unit > this.top) this.top = y * this.unit;
  }

  /** A HUD band along the bottom of the square, up from `y` (units). */
  bottomBand(y: number): void {
    if (Number.isFinite(y) && y * this.unit < this.bottom) this.bottom = y * this.unit;
  }

  /** A HUD block (units). Empty or non-finite blocks are ignored. */
  block(x: number, y: number, w: number, h: number): void {
    if (!(w > 0 && h > 0) || !Number.isFinite(x + y + w + h)) return;
    const u = this.unit;
    const i = 4 * this.count++;
    this.blocks[i] = x * u;
    this.blocks[i + 1] = y * u;
    this.blocks[i + 2] = w * u;
    this.blocks[i + 3] = h * u;
  }

  /** Whether `r` (canvas px) overlaps one of this frame's blocks. */
  overlaps(r: FrameRect): boolean {
    const b = this.blocks;
    for (let i = 0; i < 4 * this.count; i += 4) {
      if (r.x < b[i] + b[i + 2] && r.x + r.width > b[i] && r.y < b[i + 1] + b[i + 3] && r.y + r.height > b[i + 1]) return true;
    }
    return false;
  }
}

/** The page recorder's export frame (px) while it records the canvas. */
export interface LiveRecording {
  width: number;
  height: number;
}

/**
 * What the badge is placed in: `area`, the part of the canvas it goes in (canvas px; the studio's canvas gives its exported
 * square, the landing page's preview its whole phone frame) and, while the page recorder records the canvas, the recorder's
 * export frame – the recorder copies the centred square of the area into it.
 */
export interface LiveGeometry {
  area: FrameRect;
  recording?: LiveRecording | null;
}

/** The badge's height and its distance from the edges of its zone (canvas px), and the zone it goes in. */
export interface LiveBadgeBox {
  height: number;
  inset: number;
  zone: FrameRect;
}

/**
 * The badge's size and zone on the canvas: live, the area itself, the badge 4.5 % of the area's shorter side tall and 1.5 %
 * of it from the area's edges; while the page recorder records it, the video layout's (layout.ts: 5.2 % of the exported
 * square, 2.5 % from the edges of its part inside the platforms' safe zone) mapped from the export frame onto the area's
 * centred square – the recorder scales that square to fill the frame's exported square, so the clip shows the badge where
 * the video layout puts it.
 */
export function liveBadgeBox(geom: LiveGeometry, out: LiveBadgeBox = { height: 0, inset: 0, zone: { x: 0, y: 0, width: 0, height: 0 } }): LiveBadgeBox {
  const a = geom.area;
  const side = Math.max(0, Math.min(a.width, a.height));
  const sx = a.x + (a.width - side) / 2;
  const sy = a.y + (a.height - side) / 2;
  const rec = geom.recording;
  if (rec && rec.width > 0 && rec.height > 0 && side > 0) {
    const square = exportSquare(rec.width, rec.height);
    const zone = badgeZone(rec.width, rec.height, square);
    const k = side / square.width;
    const m = badgeMetrics(square.width);
    out.zone.x = sx + (zone.x - square.x) * k;
    out.zone.y = sy + (zone.y - square.y) * k;
    out.zone.width = zone.width * k;
    out.zone.height = zone.height * k;
    out.height = Math.max(1, Math.round(m.height * k));
    out.inset = m.inset * k;
    return out;
  }
  out.zone.x = a.x;
  out.zone.y = a.y;
  out.zone.width = Math.max(0, a.width);
  out.zone.height = Math.max(0, a.height);
  out.height = liveBadgeHeight(side);
  out.inset = liveMargin(side);
  return out;
}

/** Where the badge goes this frame (canvas px, whole pixels), the corner, and whether that corner is free of the HUD. */
export interface LivePlacement extends FrameRect {
  corner: LiveCorner;
  free: boolean;
}

/** The badge's rectangle in `corner` of the band [`top`, `bottom`] of `zone`, `inset` from its edges. */
function cornerRect(zone: FrameRect, top: number, bottom: number, inset: number, width: number, height: number, corner: LiveCorner, out: FrameRect): FrameRect {
  const left = corner === "bottom-left" || corner === "top-left";
  const low = corner === "bottom-left" || corner === "bottom-right";
  out.x = Math.round(left ? zone.x + inset : zone.x + zone.width - inset - width);
  out.y = Math.round(low ? bottom - inset - height : top + inset);
  out.width = width;
  out.height = height;
  return out;
}

const scratch: FrameRect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Places a `width` × `height` badge (canvas px) at `clipMs`: in the first corner of `liveCornerOrder(clipMs)` that the HUD
 * leaves free – the corners of the zone's free band, between the HUD's top and bottom bands – or, when the HUD holds every
 * corner (or leaves no band tall enough), in the side's bottom corner of the whole zone. Writes into `out`.
 */
export function placeLiveBadge(box: LiveBadgeBox, width: number, height: number, clipMs: number, hud: LiveHud | null, out: LivePlacement): LivePlacement {
  const zone = box.zone;
  const inset = box.inset;
  const zoneBottom = zone.y + zone.height;
  let top = zone.y;
  let bottom = zoneBottom;
  if (hud) {
    top = Math.max(top, hud.top);
    bottom = Math.min(bottom, hud.bottom);
  }
  const roomy = bottom - top >= height + 2 * inset;
  const order = liveCornerOrder(clipMs);
  if (roomy) {
    for (const corner of order) {
      cornerRect(zone, top, bottom, inset, width, height, corner, scratch);
      if (hud && hud.overlaps(scratch)) continue;
      out.x = scratch.x;
      out.y = scratch.y;
      out.width = width;
      out.height = height;
      out.corner = corner;
      out.free = true;
      return out;
    }
  }
  cornerRect(zone, zone.y, zoneBottom, inset, width, height, order[0], out);
  out.corner = order[0];
  out.free = false;
  return out;
}
