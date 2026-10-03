import type { ModeId } from "@/lib/physics/types";

/** Display order of the mode cards on the landing and simulator pages (edit to reorder). */
export const MODE_CARD_ORDER: ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "grow", "shatter", "colorMatch", "portal", "drop", "box", "pendulum", "polyrhythm", "collide"];
// --- gerald-glass ---
MODE_CARD_ORDER.push("glass");
// --- gerald-multipliers --- the multipliers board joins the escape family (Gerald uses the multipliers to get home)
MODE_CARD_ORDER.push("multipliers");
// --- jdm-double-pendulum --- with the other project.jdm modes, before the Gerald family's Glass Smash (which ends the rhythm cards)
{
  const at = MODE_CARD_ORDER.indexOf("glass");
  MODE_CARD_ORDER.splice(at >= 0 ? at : MODE_CARD_ORDER.length, 0, "doublePendulum");
}
// --- jdm-illusions --- the Circle Illusion joins the rhythm family, after the other project.jdm modes (before the Gerald ones)
MODE_CARD_ORDER.splice(MODE_CARD_ORDER.indexOf("collide") + 1, 0, "illusion");
// --- odd-string-battle --- the oddplayground String Battle opens the battle family (its cards come after the others)
MODE_CARD_ORDER.push("stringBattle");
// --- odd-power-layers --- Power Layers (oddplayground) joins the escape family – a ball working its way out through the layers – right
// before the multipliers board (which closes the escape cards)
MODE_CARD_ORDER.splice(MODE_CARD_ORDER.indexOf("multipliers") >= 0 ? MODE_CARD_ORDER.indexOf("multipliers") : MODE_CARD_ORDER.length, 0, "powerLayers");
// --- jdm-race --- the Square Racing Grand Prix joins the project.jdm modes of the rhythm family (before the Gerald family's Glass Smash)
{
  const at = MODE_CARD_ORDER.indexOf("glass");
  MODE_CARD_ORDER.splice(at >= 0 ? at : MODE_CARD_ORDER.length, 0, "race");
}
// --- jdm-arena-games --- the two team games join the rhythm family after the other project.jdm modes (before the Gerald ones)
MODE_CARD_ORDER.splice(MODE_CARD_ORDER.indexOf("illusion") + 1, 0, "battle", "ctf");
// --- jdm-rhythm-runner --- the Beat Runner and Paddle Keep-Up join the rhythm family right after the arena games
{
  const at = MODE_CARD_ORDER.indexOf("ctf");
  MODE_CARD_ORDER.splice(at >= 0 ? at + 1 : MODE_CARD_ORDER.length, 0, "runner", "paddle");
}
// --- gerald-vortex --- the Sound Vortex joins the Gerald family at the end of the rhythm cards, right before Glass Smash (which
// closes them)
{
  const at = MODE_CARD_ORDER.indexOf("glass");
  MODE_CARD_ORDER.splice(at >= 0 ? at : MODE_CARD_ORDER.length, 0, "vortex");
}
// --- gerald-journey --- the Journey opens its own family (a run through several stages to HOME), after the others
MODE_CARD_ORDER.push("journey");
// --- gerald-bullseye --- Bullseye joins the Gerald family of the rhythm cards, right before the Sound Vortex (then Glass Smash)
{
  const at = MODE_CARD_ORDER.indexOf("vortex");
  MODE_CARD_ORDER.splice(at >= 0 ? at : MODE_CARD_ORDER.length, 0, "bullseye");
}
// --- beat-drop --- Beat Drop joins the rhythm family right after the Beat Runner and Paddle Keep-Up (landings on the beat)
{
  const at = MODE_CARD_ORDER.indexOf("paddle");
  MODE_CARD_ORDER.splice(at >= 0 ? at + 1 : MODE_CARD_ORDER.length, 0, "beatDrop");
}
// --- odd-territory --- Territory joins the oddplayground battle family, right after the String Battle
{
  const at = MODE_CARD_ORDER.indexOf("stringBattle");
  MODE_CARD_ORDER.splice(at >= 0 ? at + 1 : MODE_CARD_ORDER.length, 0, "territory");
}
// --- odd-maze --- Maze escape (oddplayground) joins the battle family after the String Battle and Territory (a race to the exit)
{
  const after = MODE_CARD_ORDER.indexOf("territory");
  const at = after >= 0 ? after : MODE_CARD_ORDER.indexOf("stringBattle");
  MODE_CARD_ORDER.splice(at >= 0 ? at + 1 : MODE_CARD_ORDER.length, 0, "maze");
}
// --- gerald-conveyor --- the Conveyor Belt joins the escape family (the balls it loads work their way out of the rings), after
// the ring modes and before Power Layers and the multipliers board (which close the escape cards)
{
  const at = MODE_CARD_ORDER.indexOf("powerLayers");
  MODE_CARD_ORDER.splice(at >= 0 ? at : MODE_CARD_ORDER.length, 0, "conveyor");
}
// --- fight-league --- Fight League joins the arena games (Battle Royale, Capture the Flag) of the rhythm family, right after them
{
  const at = MODE_CARD_ORDER.indexOf("ctf");
  MODE_CARD_ORDER.splice(at >= 0 ? at + 1 : MODE_CARD_ORDER.length, 0, "fightLeague");
}

/**
 * The families of modes, each under its own heading on the mode cards (`CATEGORY_HEADINGS` in
 * components/site/ModesOverview.tsx, `Headings.modes<Family>` in messages/*.json):
 * - "escape": the ring formats (a ball working its way out of concentric walls) plus Power Layers and the Multipliers board;
 * - "rhythm": the project.jdm and Gerald sound-first formats, where every hit is a note and the physics writes a polyrhythm;
 * - "battle": the oddplayground duels, last ball standing;
 * - "journey": multi-stage runs home.
 */
export const MODE_CATEGORY_IDS = ["escape", "rhythm", "battle", "journey"] as const; // --- odd-string-battle --- ("battle": the oddplayground duels, last ball standing) --- gerald-journey --- ("journey": multi-stage runs home)
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
  // --- gerald-glass --- Glass Smash: every pane hit is a note (the ASMR piano bounces of geraldbounces), so it joins the
  // sound-first family; "escape" keeps the ten ring modes (and the multipliers board after them).
  glass: "rhythm",
  // --- gerald-multipliers ---
  multipliers: "escape",
  // --- jdm-double-pendulum --- the Double Pendulum Harp: every string a bob crosses is a note
  doublePendulum: "rhythm",
  // --- jdm-illusions ---
  illusion: "rhythm",
  // --- odd-string-battle --- balls fight until one is left: the battle family
  stringBattle: "battle",
  // --- odd-power-layers --- "800 layers between the ball and freedom": the ball escapes through the stack
  powerLayers: "escape",
  // --- jdm-race --- every obstacle a racer hits is its note, every pass a chime
  race: "rhythm",
  // --- jdm-arena-games --- Bouncing Square Battle Royale and Capture the Flag: every clash and bounce is a note
  battle: "rhythm",
  ctf: "rhythm",
  // --- jdm-rhythm-runner --- every landing on the beat / every catch is a note
  runner: "rhythm",
  paddle: "rhythm",
  // --- gerald-vortex --- every ring a ball sinks past is a note and every swallow a pew: the sound-first family
  vortex: "rhythm",
  // --- gerald-journey --- a multi-stage commute home: its own family
  journey: "journey",
  // --- gerald-bullseye --- every peg a ball bounces off is a note and every landing a thud: the sound-first family
  bullseye: "rhythm",
  // --- beat-drop --- every landing is a beat: a drum, a note, or both
  beatDrop: "rhythm",
  // --- odd-territory --- teams of balls fight over a tile map: the battle family
  territory: "battle",
  // --- odd-maze --- balls race through a maze to its exit: the oddplayground battle family
  maze: "battle",
  // --- gerald-conveyor --- a belt loads ball after ball into the rings, and each works its way out: the escape family
  conveyor: "escape",
  // --- fight-league --- weapon-wielding fighter balls duel in a square arena: with the arena games (every hit a sound, every bounce a note)
  fightLeague: "rhythm",
};

/** The modes of a category in card order. */
export function modesInCategory(category: ModeCategory): ModeId[] {
  return MODE_CARD_ORDER.filter((id) => MODE_CATEGORIES[id] === category);
}
