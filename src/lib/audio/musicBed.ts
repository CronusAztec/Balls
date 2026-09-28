/**
 * Background music bed with sidechain ducking.
 *
 * The uploaded track plays through
 *   AudioBufferSourceNode → fade GainNode → duck GainNode → volume GainNode → ToneGenerator master gain,
 * and the master gain already feeds both the speakers and the recorder's MediaStreamDestination,
 * so the bed is part of every exported clip. The ToneGenerator owns one MusicBed (like the song
 * slicer), attaches it to its audio graph and calls `duck()` at the moment every bounce or
 * wall-break sound is scheduled: the duck gain drops to `1 - ducking` instantly and swells back
 * to 1 over the release time with an exponential ramp, exactly like a sidechain compressor keyed
 * by the bounce sounds. Simulator.tsx drives play / pause / stop / restart from the run state.
 *
 * Everything that can be pure is (the envelope maths and the offset arithmetic at the top), so it
 * is unit-tested without Web Audio; `MusicBed` itself is driven through a fake AudioContext in
 * tests/musicBed.test.ts.
 */

export interface MusicBedOptions {
  /** 0–1, linear gain of the bed under the bounce sounds. */
  volume: number;
  /** 0–1, how far the bed dips on each trigger (0 = no ducking, 1 = silent for an instant). */
  ducking: number;
  /** Recovery time after a trigger, in milliseconds. */
  releaseMs: number;
  /** Start the track again when it ends. */
  loop: boolean;
  /** Seconds into the track at which playback starts (and restarts). */
  startOffset: number;
}

/** Subset of AudioParam the ducking scheduler uses (lets tests pass a plain object). */
export interface DuckParam {
  cancelScheduledValues(startTime: number): unknown;
  setValueAtTime(value: number, startTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
  /** Not in every browser: truncates a running ramp at `t` instead of dropping it. */
  cancelAndHoldAtTime?(cancelTime: number): unknown;
}

export const DEFAULT_MUSIC_OPTIONS: MusicBedOptions = { volume: 0.5, ducking: 0.6, releaseMs: 250, loop: true, startOffset: 0 };

/** Exponential ramps cannot reach 0, so a fully ducked bed sits at this gain (−60 dB) instead. */
export const DUCK_FLOOR = 0.001;
export const MIN_RELEASE_MS = 1;
/** Fade applied when the bed starts, pauses or stops, so the cut never clicks (seconds). */
export const BED_FADE_SEC = 0.015;

function clamp01(v: number) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Gain the bed drops to when a trigger fires: `1 - ducking`, never below the ramp floor. */
export function duckedLevel(ducking: number): number {
  return Math.max(DUCK_FLOOR, 1 - clamp01(ducking));
}

/**
 * Gain of the bed `elapsedMs` after a trigger. Mirrors Web Audio's exponential ramp from the
 * ducked level back to 1 over `releaseMs`: v(t) = level^(1 - t / release), and 1 once released.
 */
export function duckEnvelope(elapsedMs: number, ducking: number, releaseMs: number): number {
  const level = duckedLevel(ducking);
  if (level >= 1) return 1;
  const release = Math.max(MIN_RELEASE_MS, releaseMs);
  const t = Math.max(0, elapsedMs);
  if (t >= release) return 1;
  return Math.pow(level, 1 - t / release);
}

/**
 * Schedules one duck on a gain parameter at audio time `time` (seconds): any pending ramp is
 * cancelled (held at its current value where the browser supports it), the gain drops instantly
 * to the ducked level and recovers exponentially over the release time. Returns false, scheduling
 * nothing, when ducking is off.
 */
export function scheduleDuck(param: DuckParam, time: number, ducking: number, releaseMs: number): boolean {
  const level = duckedLevel(ducking);
  if (level >= 1) return false;
  const release = Math.max(MIN_RELEASE_MS, releaseMs) / 1000;
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(time);
  else param.cancelScheduledValues(time);
  param.setValueAtTime(level, time);
  param.exponentialRampToValueAtTime(1, time + release);
  return true;
}

/**
 * Where in the buffer playback should start for a requested position. Looping tracks wrap
 * around; a non-looping track that has already ended returns null (nothing left to play).
 */
export function resolveOffset(position: number, duration: number, loop: boolean): number | null {
  if (!(duration > 0)) return null;
  const p = Number.isFinite(position) && position > 0 ? position : 0;
  if (loop) return p % duration;
  return p >= duration ? null : p;
}

/** Track position after playing `elapsedSec` from `startPosition` (wrapped or clamped to the end). */
export function playbackPosition(startPosition: number, elapsedSec: number, duration: number, loop: boolean): number {
  if (!(duration > 0)) return 0;
  const p = Math.max(0, startPosition) + Math.max(0, elapsedSec);
  return loop ? p % duration : Math.min(duration, p);
}

/** Clamps a settings patch into valid options; invalid numbers keep the base value. */
export function normalizeMusicOptions(patch: Partial<MusicBedOptions>, base: MusicBedOptions): MusicBedOptions {
  const num = (v: number | undefined, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    volume: clamp01(num(patch.volume, base.volume)),
    ducking: clamp01(num(patch.ducking, base.ducking)),
    releaseMs: Math.max(MIN_RELEASE_MS, num(patch.releaseMs, base.releaseMs)),
    loop: typeof patch.loop === "boolean" ? patch.loop : base.loop,
    startOffset: Math.max(0, num(patch.startOffset, base.startOffset)),
  };
}

interface Voice {
  source: AudioBufferSourceNode;
  fade: GainNode;
  /**
   * True once the source has ever been allowed to loop. A looping source keeps sounding past the
   * buffer end (its playhead is `(start + elapsed) % duration`) and, when Loop is switched off
   * mid-run, carries on from that wrapped playhead to the end of the buffer – so the position
   * arithmetic must follow the loop state the source actually had, not the live option.
   */
  looped: boolean;
}

export class MusicBed {
  private context: AudioContext | null = null;
  private duckGain: GainNode | null = null;
  private volumeGain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private voice: Voice | null = null;
  private options: MusicBedOptions = { ...DEFAULT_MUSIC_OPTIONS };
  private playing = false;
  /** Audio time at which the current source started. */
  private startedAt = 0;
  /** Buffer offset at which the current source started. */
  private startPosition = 0;
  /** Where the next `play()` resumes from; null = the configured start offset. */
  private position: number | null = null;
  private lastDuckAt = -1;
  private listener: ((playing: boolean) => void) | null = null;

  /* ------------------------------------------------------------ graph */

  /**
   * Builds the duck and volume stages on `context` and routes them into `destination` (the
   * ToneGenerator's master gain). Called whenever the host (re)creates its audio graph.
   */
  attach(context: AudioContext, destination: AudioNode) {
    if (this.context === context && this.duckGain && this.volumeGain) return;
    this.detach();
    this.context = context;
    this.duckGain = context.createGain();
    this.duckGain.gain.value = 1;
    this.volumeGain = context.createGain();
    this.volumeGain.gain.value = this.options.volume;
    this.duckGain.connect(this.volumeGain);
    this.volumeGain.connect(destination);
  }

  /** Stops playback and drops the nodes (the host is closing its context); the track stays loaded. */
  detach() {
    this.stopVoice();
    this.setPlaying(false);
    try {
      this.duckGain?.disconnect();
      this.volumeGain?.disconnect();
    } catch {
      /* nodes of a closed context */
    }
    this.duckGain = null;
    this.volumeGain = null;
    this.context = null;
  }

  isAttached(): boolean {
    return this.context !== null && this.duckGain !== null;
  }

  /* ------------------------------------------------------------ track */

  /**
   * Replaces the track (null removes it). A bed that was playing continues with the new track
   * from its start offset, so a new upload during a run is heard right away.
   */
  setBuffer(buffer: AudioBuffer | null) {
    const wasPlaying = this.playing;
    this.stop();
    this.buffer = buffer;
    if (wasPlaying && buffer) this.play();
  }

  hasTrack(): boolean {
    return this.buffer !== null;
  }

  /** Track length in seconds (0 without a track). */
  getDuration(): number {
    return this.buffer?.duration ?? 0;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Called whenever `isPlaying()` changes, including when a non-looping track ends on its own. */
  setPlayingListener(listener: ((playing: boolean) => void) | null) {
    this.listener = listener;
  }

  setOptions(patch: Partial<MusicBedOptions>) {
    this.options = normalizeMusicOptions(patch, this.options);
    if (this.volumeGain && this.context) {
      // A short smoothing constant avoids zipper noise while the slider is dragged.
      this.volumeGain.gain.setTargetAtTime(this.options.volume, this.context.currentTime, 0.02);
    }
    if (this.voice) {
      this.voice.source.loop = this.options.loop;
      this.voice.looped ||= this.options.loop;
    }
  }

  getOptions(): MusicBedOptions {
    return { ...this.options };
  }

  /* ------------------------------------------------------------ transport */

  /** Starts (or resumes) the bed from the tracked position; returns true when a source started. */
  play(): boolean {
    if (this.playing) return true;
    const buffer = this.buffer;
    const ctx = this.context;
    if (!buffer || !ctx || !this.duckGain) return false;
    if (ctx.state === "suspended") void ctx.resume();
    const offset = resolveOffset(this.position ?? this.options.startOffset, buffer.duration, this.options.loop);
    if (offset === null) return false; // a non-looping track that has played to its end
    try {
      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = this.options.loop;
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(0, now);
      fade.gain.linearRampToValueAtTime(1, now + BED_FADE_SEC);
      source.connect(fade);
      fade.connect(this.duckGain);
      const voice: Voice = { source, fade, looped: source.loop };
      source.onended = () => {
        // Natural end of a non-looping track: stay silent until the simulation restarts.
        if (this.voice !== voice) return;
        this.voice = null;
        this.position = buffer.duration;
        this.setPlaying(false);
      };
      source.start(0, offset);
      this.voice = voice;
      this.startedAt = now;
      this.startPosition = offset;
      this.setPlaying(true);
      return true;
    } catch (err) {
      console.error("Failed to start the music bed:", err);
      return false;
    }
  }

  /** Fades the bed out and remembers where it was, so `play()` continues from there. */
  pause() {
    if (!this.playing) return;
    this.position = this.getPosition();
    this.stopVoice();
    this.setPlaying(false);
  }

  /** Fades the bed out; the next `play()` starts from the configured start offset. */
  stop() {
    this.stopVoice();
    this.position = null;
    this.setPlaying(false);
  }

  /** Starts over from the start offset (simulation restart). */
  restart() {
    this.stop();
    this.play();
  }

  /** Current track position in seconds (advances while playing, holds while paused). */
  getPosition(): number {
    const buffer = this.buffer;
    if (!buffer) return 0;
    // Wrap with the loop state the sounding source actually had: a source that looped stays below the
    // buffer end even after Loop is switched off, and a source that never looped cannot be past it
    // (its natural end records `duration` in onended).
    if (this.playing && this.context) return playbackPosition(this.startPosition, this.context.currentTime - this.startedAt, buffer.duration, this.voice?.looped ?? this.options.loop);
    return this.position ?? resolveOffset(this.options.startOffset, buffer.duration, this.options.loop) ?? 0;
  }

  /* ------------------------------------------------------------ sidechain */

  /**
   * Sidechain trigger: the ToneGenerator calls it for every bounce / wall-break sound it
   * schedules, at that sound's audio time (so beat-locked sounds and their ducks line up).
   */
  duck(time?: number) {
    if (!this.playing || !this.duckGain || !this.context) return;
    const now = this.context.currentTime;
    const at = Math.max(now, time ?? now);
    // Several hits in one frame share the same audio time; one duck covers them all.
    if (at === this.lastDuckAt) return;
    if (scheduleDuck(this.duckGain.gain, at, this.options.ducking, this.options.releaseMs)) this.lastDuckAt = at;
  }

  /** Current gain of the duck stage (1 = not ducked); for the level meter in the panel. */
  getDuckGain(): number {
    return this.duckGain?.gain.value ?? 1;
  }

  /* ------------------------------------------------------------ internals */

  private setPlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.lastDuckAt = -1;
    this.listener?.(playing);
  }

  /** Fades the sounding source out over BED_FADE_SEC and stops it. */
  private stopVoice() {
    const voice = this.voice;
    this.voice = null;
    if (!voice) return;
    voice.source.onended = () => {
      try {
        voice.fade.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    try {
      const now = this.context?.currentTime ?? 0;
      const g = voice.fade.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + BED_FADE_SEC);
      voice.source.stop(now + BED_FADE_SEC);
    } catch {
      /* already stopped */
    }
  }
}
