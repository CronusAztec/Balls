import type { ModeId } from "@/lib/physics/types";

/** Display order of the mode cards on the landing and simulator pages (edit to reorder). */
export const MODE_CARD_ORDER: ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "grow", "shatter", "colorMatch", "portal", "drop", "box", "pendulum", "polyrhythm", "collide"];
// --- boris-glass ---
MODE_CARD_ORDER.push("glass");
// --- boris-multipliers --- the multipliers board joins the escape family (Boris uses the multipliers to get home)
MODE_CARD_ORDER.push("multipliers");
// --- jdm-double-pendulum --- with the other project.jdm modes, before the Boris family's Glass Smash (which ends the rhythm cards)
{
  const at = MODE_CARD_ORDER.indexOf("glass");
  MODE_CARD_ORDER.splice(at >= 0 ? at : MODE_CARD_ORDER.length, 0, "doublePendulum");
}
// --- jdm-illusions --- the Circle Illusion joins the rhythm family, after the other project.jdm modes (before the Boris ones)
MODE_CARD_ORDER.splice(MODE_CARD_ORDER.indexOf("collide") + 1, 0, "illusion");
// --- jdm-race --- the Square Racing Grand Prix joins the project.jdm modes of the rhythm family (before the Boris family's Glass Smash)
{
  const at = MODE_CARD_ORDER.indexOf("glass");
  MODE_CARD_ORDER.splice(at >= 0 ? at : MODE_CARD_ORDER.length, 0, "race");
}

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
  // --- boris-glass --- Glass Smash: every pane hit is a note (the ASMR piano bounces of borisbounces), so it joins the
  // sound-first family; "escape" keeps the ten ring modes (and the multipliers board after them).
  glass: "rhythm",
  // --- boris-multipliers ---
  multipliers: "escape",
  // --- jdm-double-pendulum --- the Double Pendulum Harp: every string a bob crosses is a note
  doublePendulum: "rhythm",
  // --- jdm-illusions ---
  illusion: "rhythm",
  // --- jdm-race --- every obstacle a racer hits is its note, every pass a chime
  race: "rhythm",
};

/** The modes of a category in card order. */
export function modesInCategory(category: ModeCategory): ModeId[] {
  return MODE_CARD_ORDER.filter((id) => MODE_CATEGORIES[id] === category);
}
