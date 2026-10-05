import { heroMomentSec, type HeroMomentSource } from "@/lib/thumbnails/heroMoments";
import type { ClipPlan } from "./planner";

/*
 * --- mode-thumbnails --- The cover frame of a bot clip: the platforms show a Reel's or a TikTok's cover in the grid and the
 * feed, and left alone they take the first frame – an empty ring, a ball at rest. The cover is the clip's hero moment
 * instead, picked like the mode cards' pictures (lib/thumbnails/heroMoments.ts `heroMomentSec()`): the payoff on screen
 * (a quarter second after it lands), the last moment before the cut of a cliffhanger, else the mode's own hero second. It
 * goes out as Instagram's `thumb_offset` (the CLI's --post and the relay) and TikTok's `video_cover_timestamp_ms` (the
 * relay), into manifest.json, the caption file and the posting schedule (for posting by hand: pick that frame as the cover).
 */

export interface CoverFrame {
  /** The clip second of the cover. */
  atSec: number;
  /** The same in whole milliseconds (what the platforms take). */
  ms: number;
  /** Why this frame: the payoff on screen, the moment before a cut, the mode's card second or the payoff band. */
  source: HeroMomentSource;
}

/**
 * The cover of a clip: its hero moment within the clip as planned – or, once rendered, within the clip's real length
 * (`renderedSec`, which can end earlier when the run finished sooner).
 */
export function coverFrameOf(plan: Pick<ClipPlan, "mode" | "payoff" | "timing">, renderedSec?: number | null): CoverFrame {
  const clipSec = typeof renderedSec === "number" && Number.isFinite(renderedSec) && renderedSec > 0 ? renderedSec : plan.timing.clipSec;
  const { sec, source } = heroMomentSec({ mode: plan.mode, clipSec, payoffSec: plan.payoff.atSec, cutGapSec: plan.payoff.cutGapSec });
  return { atSec: sec, ms: Math.round(sec * 1000), source };
}
