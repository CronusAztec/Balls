import { normalizeSliceOptions, planSlice, positionAt, sliceProgress, songEnded, type SliceOptions } from "./slicer";

// --- review fix (audio) ---
/**
 * The gain of a slice `elapsed` seconds after it started: a linear fade in and out around a plateau of 1, 0 outside the slice.
 * A cut slice fades out from this value (`AudioParam.value` only holds the last rendered value, so a cut inside a fade – or
 * a slice not rendered yet, as in a fast export – would jump to the wrong level).
 */
export function sliceGainAt(elapsed: number, duration: number, fadeIn: number, fadeOut: number): number {
  if (elapsed < 0 || elapsed >= duration) return 0;
  let g = 1;
  if (fadeIn > 0 && elapsed < fadeIn) g = Math.min(g, elapsed / fadeIn);
  if (fadeOut > 0 && elapsed > duration - fadeOut) g = Math.min(g, (duration - elapsed) / fadeOut);
  return g;
}
// --- end review fix (audio) ---

/**
 * Web Audio side of the song slicer. Holds the decoded song (an AudioBuffer), the cursor
 * and the slice that is currently sounding, and plays the next slice on demand through
 * whatever destination it is given (the ToneGenerator's master gain, so slices reach the
 * speakers and the recording track alike). Every slice gets a short linear fade in and
 * out, and a slice that is still playing when it is cut short (the next bounce arrives, the
 * simulation pauses, slicing is switched off) is faded out and the cursor moves to the point
 * where it was cut, so neither fast bouncing nor pausing skips music.
 */
export class SlicePlayer {
  private buffer: AudioBuffer | null = null;
  private cursor = 0;
  private enabled = false;
  private options: SliceOptions = { sliceSec: 0.25, fadeSec: 0.008, loop: true };
  private voice: { source: AudioBufferSourceNode; gain: GainNode; start: number; duration: number; startedAt: number; fadeIn: number; fadeOut: number } | null = null;
  private lastTriggerAt = -Infinity;

  /** Bounces closer together than this (two balls, a corner rattle) share one slice. */
  private static readonly RETRIGGER_SEC = 0.04;
  /** Fade used when a slice is cut short (next bounce, pause, restart). */
  private static readonly CUT_FADE_SEC = 0.012;

  /** Replaces the song (null clears it) and rewinds. */
  setBuffer(buffer: AudioBuffer | null) {
    this.buffer = buffer;
    this.reset();
  }

  hasSong(): boolean {
    return this.buffer !== null;
  }

  /** --- fast-render --- The decoded song (null without one), for the fast export's offline copy of the player. */
  getBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  /** Song length in seconds (0 without a song). */
  getDuration(): number {
    return this.buffer?.duration ?? 0;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  setOptions(options: Partial<SliceOptions>) {
    this.options = normalizeSliceOptions(options, this.options);
  }

  getOptions(): SliceOptions {
    return this.options;
  }

  /** True while the slicer should take over the bounce sound (enabled and a song is loaded). */
  isActive(): boolean {
    return this.enabled && this.buffer !== null;
  }

  /** True once a non-looping song has been played to the end. */
  hasEnded(): boolean {
    return this.buffer !== null && !this.options.loop && songEnded(this.cursor, this.buffer.duration);
  }

  /** Rewinds to the start of the song (restart, new file). */
  reset() {
    this.stop();
    this.cursor = 0;
    this.lastTriggerAt = -Infinity;
  }

  /** Current song position in seconds; advances smoothly while a slice plays. */
  getPosition(now: number): number {
    const v = this.voice;
    return v ? positionAt(v.start, v.duration, v.startedAt, now) : this.cursor;
  }

  /** Song position as a 0–1 fraction, or null when no song is loaded. */
  getProgress(now: number): number | null {
    if (!this.buffer) return null;
    return sliceProgress(this.getPosition(now), this.buffer.duration);
  }

  /**
   * Plays the next slice. Returns true when the bounce was handled (a slice started, or a
   * bounce arrived so soon after the previous one that it shares its slice) and false when
   * the caller should play its normal bounce sound instead.
   */
  trigger(ctx: AudioContext, destination: AudioNode): boolean {
    const buffer = this.buffer;
    if (!this.enabled || !buffer) return false;
    const now = ctx.currentTime;
    if (now - this.lastTriggerAt < SlicePlayer.RETRIGGER_SEC) return true;
    // A slice still sounding is cut here (stop() moves the cursor to the cut point), so the
    // song continues from where it actually got to rather than from the end of that slice.
    const plan = planSlice(this.getPosition(now), buffer.duration, this.options);
    if (!plan) return false;
    this.stop(now);
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      const g = gain.gain;
      const end = now + plan.duration;
      if (plan.fadeIn > 0) {
        g.setValueAtTime(0, now);
        g.linearRampToValueAtTime(1, now + plan.fadeIn);
      } else g.setValueAtTime(1, now);
      if (plan.fadeOut > 0) {
        g.setValueAtTime(1, end - plan.fadeOut);
        g.linearRampToValueAtTime(0, end);
      }
      source.connect(gain);
      gain.connect(destination);
      source.onended = () => {
        gain.disconnect();
        if (this.voice?.source === source) this.voice = null;
      };
      source.start(now, plan.start, plan.duration);
      this.voice = { source, gain, start: plan.start, duration: plan.duration, startedAt: now, fadeIn: plan.fadeIn, fadeOut: plan.fadeOut };
      this.cursor = plan.cursorAfter;
      this.lastTriggerAt = now;
      return true;
    } catch (err) {
      console.error("Error playing song slice:", err);
      return false;
    }
  }

  /**
   * Fades out the slice that is still playing, if any (pause, slicing switched off, restart,
   * new song, next bounce) and moves the cursor to the point where it was cut, so the song
   * continues from there afterwards and the progress bar holds there instead of jumping to
   * the end of the cut slice.
   */
  stop(now?: number) {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    const t = now ?? v.source.context.currentTime;
    this.cursor = positionAt(v.start, v.duration, v.startedAt, t);
    try {
      const g = v.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(sliceGainAt(t - v.startedAt, v.duration, v.fadeIn, v.fadeOut), t); // --- review fix (audio) --- not g.value
      g.linearRampToValueAtTime(0, t + SlicePlayer.CUT_FADE_SEC);
      v.source.stop(t + SlicePlayer.CUT_FADE_SEC);
    } catch {
      /* the source may already have ended */
    }
  }
}
