import type { LoopSeams } from "@/lib/physics/types";

/*
 * --- loop-foundation --- The loop contract. A mode with a seamless cycle reports its length (`GameMode.cycleSeconds()`, the
 * engine's `getCycleSeconds()`) and its seams (`loopSeams()`): at a seam the state equals the run's start – Grow's fill and loop
 * after the shrink, the ball back at its start size in the centre. With "Export whole loops" on, every recording path – the
 * page recorder, the fast export and through it the batch render – cuts the clip just before the seam that closes its last
 * whole cycle: the largest whole number of cycles that fits in the clip (one frame of slack), whose last frame flows into its
 * first. A recording that never meets a seam (a cycle longer than the clip) keeps its set length; a mode that does not loop
 * records exactly as before.
 *
 * The cut is decided frame by frame (the same rule live and offline), before a frame is recorded: a frame that shows a seam
 * ends the clip when the next seam, a cycle later (the cycle just measured, on the recording's own clock), would land past
 * the clip; otherwise the recording may run up to two frames past the clip to end on that next seam.
 */

/** Simulation time (ms) a frame may come before a seam and still show it (floating-point steps). */
export const SEAM_EPS_MS = 0.5;

/** One frame at `fps` (s); 60 fps for a bad value. */
export function frameSeconds(fps: number): number {
  return 1 / (Number.isFinite(fps) && fps > 0 ? fps : 60);
}

/** The largest whole number of `cycleSec` cycles in `durationSec` (+ `slackSec`) and how long they last; null when none fits. */
export function wholeLoops(durationSec: number, cycleSec: number, slackSec = 0): { cycles: number; seconds: number } | null {
  if (!(cycleSec > 0) || !(durationSec > 0) || !Number.isFinite(cycleSec) || !Number.isFinite(durationSec)) return null;
  const cycles = Math.floor((durationSec + Math.max(0, slackSec)) / cycleSec + 1e-9);
  return cycles >= 1 ? { cycles, seconds: cycles * cycleSec } : null;
}

/** How far (s) `seconds` lies from a whole number of `cycleSec` cycles (at least one); Infinity for no cycle. */
export function wholeLoopError(seconds: number, cycleSec: number): number {
  if (!(cycleSec > 0) || !Number.isFinite(seconds)) return Infinity;
  const k = Math.max(1, Math.round(seconds / cycleSec));
  return Math.abs(seconds - k * cycleSec);
}

/** Whether a recording is cut to whole loops: the switch on and a run that loops (its mode reports seams). */
export function cutsToWholeLoops(enabled: boolean, seams: LoopSeams | null | undefined): boolean {
  return enabled && !!seams;
}

/**
 * The whole-loop cut of one recording, fed every frame before it is recorded (`frame()`): "stop" ends the clip before this
 * frame. The recording starts at the run's start (a seam: the state of its first frame).
 */
export class WholeLoopCut {
  /** Seams the cut has seen (each a frame that showed the run's start again). */
  private seen = 0;
  /** When the last seam came (s into the recording; 0 = the start). */
  private lastSeamSec = 0;
  private limit: number;
  /** Whole cycles the clip holds so far, and the last one's length (s, on the recording's clock; 0 before the first seam). */
  cycles = 0;
  cycleSec = 0;
  /** True once the clip was cut on a seam (it loops); false while it runs, and for a clip cut at its set length. */
  cutOnSeam = false;

  constructor(
    readonly durationSec: number,
    readonly frameSec: number,
  ) {
    this.limit = durationSec;
  }

  /** The latest the recording runs (s): the set length, or up to two frames past the next seam it waits for. */
  get limitSec(): number {
    return this.limit;
  }

  /**
   * A frame `recordSec` into the recording, showing the run at simulation time `simMs` with `seams` (null: the run does not
   * loop): "stop" when the clip ends before this frame, "record" otherwise.
   */
  frame(recordSec: number, simMs: number, seams: LoopSeams | null): "record" | "stop" {
    let seam = false;
    if (seams) {
      if (seams.nextMs >= 0 && simMs >= seams.nextMs - SEAM_EPS_MS && this.seen === seams.count) {
        // this frame shows the seam (the hold and the shrink are over; the relaunch comes in the next step)
        this.seen = seams.count + 1;
        seam = true;
      } else if (seams.count > this.seen) {
        // the seam came between two frames (a frame rate below the simulation's): the first frame after it counts
        this.seen = seams.count;
        seam = true;
      }
    }
    if (seam && recordSec > 0) {
      const cycle = recordSec - this.lastSeamSec;
      this.lastSeamSec = recordSec;
      this.cycles++;
      this.cycleSec = cycle;
      if (recordSec + cycle > this.durationSec + this.frameSec + 1e-9) {
        this.cutOnSeam = true;
        return "stop";
      }
      // another whole cycle fits: the clip may run on to its seam, a frame or two past the set length
      this.limit = Math.max(this.durationSec, recordSec + cycle + 2 * this.frameSec);
      return "record";
    }
    return recordSec >= this.limit - 1e-9 ? "stop" : "record";
  }
}
