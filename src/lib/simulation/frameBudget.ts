/**
 * --- unlimited --- The frame budget: time-slicing by whole simulation steps.
 *
 * The page advances the fixed 60 Hz steps the wall clock asks for, one after another (Canvas.tsx). With No limits on, a
 * frame stops stepping as soon as its steps took longer than `FRAME_BUDGET_MS` (about 12 ms – a frame at 60 fps minus
 * the drawing) and drops the time it could not simulate: the simulation clock then advances less than the wall clock,
 * the run plays in slow motion under load (the canvas shows "x0.4 real time") and the main thread is never blocked for
 * much more than one step.
 *
 * Slicing happens **between** steps only – a step is never cut – so the physics result of a seed does not depend on the
 * budget, the machine or the frame rate: it only decides how many of the same steps a frame shows. The fast export and
 * the finder run without a budget (they render simulation time), so an extreme run exports correctly however slowly the
 * live preview crawls.
 */

/** Wall-clock milliseconds a frame may spend on physics before the rest of its steps is dropped. */
export const FRAME_BUDGET_MS = 12;
/** Wall-clock window (ms) the real-time ratio is measured over. */
const RATIO_WINDOW_MS = 600;
/** Below this fraction of the requested rate the "x… real time" badge shows. */
export const SLOW_BADGE_BELOW = 0.9;

export class FrameBudget {
  /** Whether the budget applies (No limits on, live page). */
  enabled = false;
  budgetMs = FRAME_BUDGET_MS;
  private startedAt = 0;
  private windowWall = 0;
  private windowSim = 0;
  private windowWanted = 0;
  /** Simulation ms per wall-clock ms over the last window (1 = real time). */
  ratio = 1;
  /** The same as a fraction of the rate the page asked for (playback speed × camera slow motion). */
  fraction = 1;
  /** Steps dropped so far (frames that ran out of budget). */
  slicedFrames = 0;

  /** The frame's physics starts now (`performance.now()`). */
  begin(nowMs: number) {
    this.startedAt = nowMs;
  }

  /** True when the frame has spent its budget: the caller drops the rest of its steps. */
  exceeded(nowMs: number): boolean {
    if (!this.enabled || !(nowMs - this.startedAt > this.budgetMs)) return false;
    this.slicedFrames++;
    return true;
  }

  /**
   * After the frame's steps: `wallMs` real time passed, the page asked for `wantedMs` of simulation time (wall time ×
   * playback speed × camera slow motion) and the engine's clock advanced by `simMs`.
   */
  note(wallMs: number, wantedMs: number, simMs: number) {
    if (!(wallMs > 0) || !(simMs >= 0) || !Number.isFinite(simMs)) return;
    this.windowWall += wallMs;
    this.windowSim += simMs;
    this.windowWanted += Math.max(0, wantedMs);
    if (this.windowWall < RATIO_WINDOW_MS) return;
    this.ratio = this.windowSim / this.windowWall;
    this.fraction = this.windowWanted > 0 ? Math.min(1, this.windowSim / this.windowWanted) : 1;
    this.windowWall = 0;
    this.windowSim = 0;
    this.windowWanted = 0;
  }

  /** A paused or restarted run: the ratio starts over at real time. */
  reset() {
    this.windowWall = 0;
    this.windowSim = 0;
    this.windowWanted = 0;
    this.ratio = 1;
    this.fraction = 1;
  }

  /** True when the badge should show: the switch is on and the clock runs noticeably slower than asked. */
  get slow(): boolean {
    return this.fraction < SLOW_BADGE_BELOW;
  }
}

/** The rate for the badge: "0.4", "0.05", "0.001" (two significant digits, no trailing zeros). */
export function formatRealTime(ratio: number): string {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return "0";
  if (ratio >= 10) return String(Math.round(ratio));
  if (ratio >= 0.1) return String(Math.round(ratio * 10) / 10);
  return String(Number(ratio.toPrecision(1)));
}
