/*
 * --- ring-arc --- (D3 review) A ring's arc that the browser always strokes.
 *
 * A ring without gaps is drawn as the arc from its turned start to that start plus 2π. Chromium strokes nothing for such an
 * arc at about 1.5 % of the angles (and for any sweep within about 1e-6 of a full turn): measured with a 4 px white ring, 58
 * of 4,000 turned starts drew no pixel, while every sweep at least 1e-5 short of a full turn and every arc from 0 to 2π drew.
 * The ring turns with the simulation clock, so the same frames lost their ring in every ring clip (Lines, Grow and the rest:
 * 47 of 1,523 frames of a Lines export, the ring and its glow gone for a frame or two). A sweep that close to a full turn is
 * drawn as the whole circle from 0 instead, which looks the same.
 */

const TWO_PI = Math.PI * 2;
/** A sweep at least this close to a full turn is the whole circle (rad): every shorter one strokes as it is. */
export const FULL_TURN_EPS = 1e-5;

/** True when the arc from `from` to `to` (clockwise, radians) is a whole ring. */
export function isFullTurn(from: number, to: number): boolean {
  return to - from >= TWO_PI - FULL_TURN_EPS;
}

/**
 * Adds the arc of radius `r` round (`cx`, `cy`) from `from` to `to` to `path` (a context's current path or a Path2D), as the
 * whole circle from 0 when it is a full turn. With `moveTo`, the arc starts a subpath of its own (a batch of rings).
 */
export function ringArc(path: CanvasRenderingContext2D | Path2D, cx: number, cy: number, r: number, from: number, to: number, moveTo = false) {
  if (isFullTurn(from, to)) {
    if (moveTo) path.moveTo(cx + r, cy);
    path.arc(cx, cy, r, 0, TWO_PI);
    return;
  }
  if (moveTo) path.moveTo(cx + Math.cos(from) * r, cy + Math.sin(from) * r);
  path.arc(cx, cy, r, from, to);
}
