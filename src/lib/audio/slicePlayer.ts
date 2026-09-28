import { normalizeSliceOptions, planSlice, positionAt, sliceProgress, songEnded, type SliceOptions } from "./slicer";

/**
 * Web Audio side of the song slicer. Holds the decoded song (an AudioBuffer), the cursor
 * and the slice that is currently sounding, and plays the next slice on demand through
 * whatever destination it is given (the ToneGenerator's master gain, so slices reach the
 * speakers and the recording track alike). Every slice gets a short linear fade in and
 * out, and a slice that is still playing when the next bounce arrives is faded out and the
 * cursor continues from the point where it was cut, so fast bouncing never skips music.
 */
export class SlicePlayer {
  private buffer: AudioBuffer | null = null;
  private cursor = 0;
  private enabled = false;
  private options: SliceOptions = { sliceSec: 0.25, fadeSec: 0.008, loop: true };
  private voice: { source: AudioBufferSourceNode; gain: GainNode; start: number; duration: number; startedAt: number } | null = null;
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
    // A slice still sounding is cut here; the song continues from where it actually got to.
    if (this.voice) this.cursor = this.getPosition(now);
    const plan = planSlice(this.cursor, buffer.duration, this.options);
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
      this.voice = { source, gain, start: plan.start, duration: plan.duration, startedAt: now };
      this.cursor = plan.cursorAfter;
      this.lastTriggerAt = now;
      return true;
    } catch (err) {
      console.error("Error playing song slice:", err);
      return false;
    }
  }

  /** Fades out the slice that is still playing, if any (pause, restart, new song, next bounce). */
  stop(now?: number) {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    try {
      const t = now ?? v.source.context.currentTime;
      const g = v.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + SlicePlayer.CUT_FADE_SEC);
      v.source.stop(t + SlicePlayer.CUT_FADE_SEC);
    } catch {
      /* the source may already have ended */
    }
  }
}
