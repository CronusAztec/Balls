/*
 * --- world --- The simulation world the page's canvas runs, whatever the screen.
 *
 * The engine simulates in world px (its `width` × `height`); the stage draws that world scaled to the canvas' CSS size.
 * Before, the world *was* the canvas' CSS size, so the same seed, preset or daily challenge played out differently on a
 * laptop, a big monitor and a phone, the finder's promise held only at the size it searched at, and a bigger stage (the
 * site redesign) quietly changed every run. Now the world's shorter side is always WORLD_SIDE and its shape is the
 * frame's: 16:9 frames run an 800 × 450 world, square frames (phones) a 450 × 450 one – the size the desktop canvas had
 * when the physics was tuned – and a seed plays the same on every screen of that shape. A window resize only rescales
 * the drawing (a found seed survives it); the world changes only with the frame's shape.
 */

/** The world's shorter side (world px). */
export const WORLD_SIDE = 450;

export interface LiveWorld {
  /** The world the engine simulates (world px); integers, the frame's shape. */
  width: number;
  height: number;
  /** CSS px per world px: the scale the canvas draws the world at (0 for an unmeasured frame). */
  scale: number;
}

/** The frame shapes the stage uses (and their mirror images): a frame within SNAP of one runs exactly that world. */
const KNOWN_RATIOS = [16 / 9, 1, 4 / 3, 3 / 2, 2];
/** How far (relative) a frame may be from a known shape and still run its world: a 906 × 509 frame is 16:9 (800 × 450). */
const SNAP = 0.02;

/** The frame's width ÷ height, snapped to a known shape when it is within SNAP of one. */
export function snapRatio(ratio: number): number {
  for (const r of KNOWN_RATIOS) {
    for (const candidate of [r, 1 / r]) if (Math.abs(ratio / candidate - 1) <= SNAP) return candidate;
  }
  return ratio;
}

/**
 * The world a canvas of `rect` CSS px runs: WORLD_SIDE on the shorter side, the frame's shape (snapped to a known one,
 * so every 16:9 frame – 906 × 509, 786 × 441, 1250 × 702 – is exactly 800 × 450 and every square one 450 × 450), whole
 * world px. The drawing scale is the shorter side's; a snapped frame is at most SNAP wider or taller than its world, the
 * background fills the hair that is left. An unmeasured (0 × 0) frame gets the square world and no scale.
 */
export function liveWorldOf(rect: { width: number; height: number }): LiveWorld {
  const w = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 0;
  const h = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 0;
  if (w <= 0 || h <= 0) return { width: WORLD_SIDE, height: WORLD_SIDE, scale: 0 };
  const ratio = snapRatio(w / h);
  const width = Math.max(1, Math.round(ratio >= 1 ? ratio * WORLD_SIDE : WORLD_SIDE));
  const height = Math.max(1, Math.round(ratio >= 1 ? WORLD_SIDE : WORLD_SIDE / ratio));
  return { width, height, scale: Math.min(w, h) / WORLD_SIDE };
}
