import type { ModeId } from "@/lib/physics/types";

/** Display order of the mode cards on the landing and simulator pages (edit to reorder). */
export const MODE_CARD_ORDER: ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "grow", "shatter", "colorMatch", "portal", "drop", "box", "pendulum", "polyrhythm", "collide"];

/**
 * The two families of modes, shown under their own headings: "escape" is the original ring formats (a ball
 * working its way out of concentric walls), "rhythm" the project.jdm-style formats built around sound
 * (Ball Drop, Bouncing Shapes, Pendulum Wave) where every hit is a note and the physics writes a polyrhythm.
 */
export const MODE_CATEGORY_IDS = ["escape", "rhythm"] as const;
export type ModeCategory = (typeof MODE_CATEGORY_IDS)[number];

export const MODE_CATEGORIES: Record<ModeId, ModeCategory> = {
  classic: "escape",
  accumulation: "escape",
  multiply: "escape",
  lines: "escape",
  paint: "escape",
  target: "escape",
  portal: "escape",
  shatter: "escape",
  colorMatch: "escape",
  grow: "escape",
  drop: "rhythm",
  box: "rhythm",
  pendulum: "rhythm",
  // --- jdm-polyrhythm ---
  polyrhythm: "rhythm",
  // --- jdm-collisions ---
  collide: "rhythm",
};

/** The modes of a category in card order. */
export function modesInCategory(category: ModeCategory): ModeId[] {
  return MODE_CARD_ORDER.filter((id) => MODE_CATEGORIES[id] === category);
}
