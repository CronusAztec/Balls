import type { ModeId } from "@/lib/physics/types";

/*
 * --- end-hold --- (Lane E, E5) The end banner's hold. An ending whose banner comes with the run's last step (Accumulation's
 * and Portal's ESCAPED!, SHATTERED!, MATCHED, Countdown's COMPLETE, Ball Drop's SETTLED!, COUNTED DOWN!, the
 * pendulums back in line, every dot aligned, Grow's FULL! and Merge Ring's OVERFLOW) had only the recorder's half-second stop on
 * screen, so a recording or an export whose run ended in its last second cut the banner as it came in. It holds its final picture
 * END_BANNER_HOLD_MS before the end screen: the page's finish detection (Simulator.tsx), the fast export (`fastExportEndHolds()`,
 * the same holds), the found run's clip and the planner (lib/bot/planner.ts `endHoldsSec()`) all read it here, so they agree.
 *
 * Not in a clip with captions of its own (every clip the bot and the studio plan: their words are its ending, the crew's gate G2
 * holds a payoff 0.8 s, and their runs stay as they were) nor in a loop clip (its seam ends it), as Classic's ESCAPED! card. The
 * modes whose banner comes earlier keep their own holds (Glass Smash's and Journey's celebration, Merge Ring's FINAL FORM, the
 * maze's, Bullseye's, the arenas'...). Measured on the start looks, seeds 1–4: each of these banners came on the run's last frame.
 */

/** How long the final picture of such an ending stays before the end screen (ms). */
export const END_BANNER_HOLD_MS = 1500;

/** The modes whose end banner comes with the run's last step (Merge Ring: its OVERFLOW only, see `endBannerHoldMs()`). */
export const END_BANNER_HOLD_MODES: readonly ModeId[] = ["accumulation", "portal", "shatter", "colorMatch", "target", "drop", "box", "pendulum", "polyrhythm", "grow", "mergeRing", "lines", "paint", "collide", "illusion" /* --- string-art --- --- paint-full --- (Lane D, D3: STRING ART!, FULL CANVAS!, EMPTY! and IT WAS A CIRCLE! come with their runs' last step too) */];

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

/** What the end banner's hold reads of the clip: its captions of its own and the loop HUD. */
export interface EndHoldClip {
  captioned: boolean;
  loopHud: boolean;
}
/** Before the page has read its settings: no hold. */
export const NO_END_HOLD_CLIP: EndHoldClip = { captioned: true, loopHud: false };

/** What the hold reads of the engine (PhysicsEngine): its mode and how a Merge Ring run ended. */
export interface EndHoldEngine {
  getCurrentModeName(): string;
  isMergeRingMode(): boolean;
  getMergeRingView(): { overflowMs: number };
}

/** The end banner's hold of this finished run (ms): the page's finish detection and the fast export's holds read it alike. */
export function endBannerHoldOf(engine: EndHoldEngine, clip: EndHoldClip): number {
  return endBannerHoldMs({ mode: engine.getCurrentModeName(), captioned: clip.captioned, loopHud: clip.loopHud, mergeRingOverflow: engine.isMergeRingMode() && engine.getMergeRingView().overflowMs >= 0 });
}
