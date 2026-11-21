import type { ModeId } from "@/lib/physics/types";

/*
 * --- end-hold --- (Lane E, E5; E5 review) The end banner's hold, as a length. An ending whose banner comes with the run's last
 * step (Accumulation's and Portal's ESCAPED!, SHATTERED!, MATCHED, Countdown's COMPLETE, Ball Drop's SETTLED!, COUNTED DOWN!,
 * the pendulums back in line, every dot aligned, Grow's FULL! and Merge Ring's OVERFLOW) keeps its final picture
 * END_BANNER_HOLD_MS before the end screen. The canvas holds it itself: its EndBannerLayer is `fresh()` that long and the canvas
 * reports it as `holdsEndScreen()`, which the page's finish detection, the fast export's end tracker, the batch render and the
 * app's render queue all wait for (components/simulator/endBanner.ts, which reads END_BANNER_HOLD_MS from here). Nothing else
 * holds it: a second timer after that one froze these endings 3.5 s (E5 review).
 *
 * What cannot draw reads the hold here instead: the planner's clip length (lib/bot/planner.ts `endHoldsSec()`, which the
 * insights' clip length reads too) and a found run's recording length (Simulator.tsx). A clip with captions of its own has no
 * such hold (the canvas holds nothing under captions: every clip the bot and the studio plan, whose words are its ending), nor
 * does a loop clip (its seam ends it). The modes whose banner comes earlier keep their own holds (Glass Smash's and Journey's
 * celebration, Merge Ring's FINAL FORM, the maze's, Bullseye's, the arenas'...). Measured on the start looks, seeds 1–4: each
 * of these banners came on the run's last frame.
 */

/** How long the final picture of such an ending stays before the end screen (ms of frame time): the canvas' banner hold. */
export const END_BANNER_HOLD_MS = 1500;

/** The modes whose end banner comes with the run's last step (Merge Ring: its OVERFLOW only, see `endBannerHoldMs()`). */
export const END_BANNER_HOLD_MODES: readonly ModeId[] = ["accumulation", "portal", "shatter", "colorMatch", "target", "drop", "box", "pendulum", "polyrhythm", "grow", "mergeRing"];

/** What decides the hold: the mode, whether the clip has captions of its own or the loop HUD, and (Merge Ring) how its run ended. */
export interface EndBannerHoldContext {
  mode: string;
  /** The clip draws captions of its own (a plan's hook and payoff words): its words are its ending. */
  captioned: boolean;
  /** The loop HUD is on: the loop's seam ends the clip. */
  loopHud: boolean;
  /** Merge Ring's run ended in an OVERFLOW (its FINAL FORM holds 2 s of its own); unknown (a plan, a link scored): none. */
  mergeRingOverflow?: boolean;
}

/** The end banner's hold of a finished run (ms): END_BANNER_HOLD_MS for such an ending, 0 otherwise. */
export function endBannerHoldMs(c: EndBannerHoldContext): number {
  if (c.captioned || c.loopHud || !(END_BANNER_HOLD_MODES as readonly string[]).includes(c.mode)) return 0;
  if (c.mode === "mergeRing" && !c.mergeRingOverflow) return 0;
  return END_BANNER_HOLD_MS;
}
