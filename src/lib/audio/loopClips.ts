/*
 * --- loop-foundation --- Custom clip slots of the loop sound families (loopTones.ts): for every family's events the owner can
 * load an audio clip they licence themselves – a bounce, a bar strike, a chime, a ladder step, a landing, the bed, the impact,
 * the completion, the reset or the drone – and it plays instead of the synthesis. A clip stays on the device (decoded in the
 * session, never uploaded, never shipped, never tracked) and is mixed into recordings and exports like every other sound (the
 * ToneGenerator's offline twin copies the slots). The rules of each slot – trimming, fades, the longest it plays, its gain range
 * and default, whether it follows the event's pitch – come from the sound recipes; the maths is pure and unit-tested.
 */

export const LOOP_CLIP_SLOTS = ["bounce", "barStrike", "chime", "progressStep", "land", "bed", "impact", "completion", "reset", "drone"] as const;
export type LoopClipSlotId = (typeof LOOP_CLIP_SLOTS)[number];

export function isLoopClipSlot(value: unknown): value is LoopClipSlotId {
  return typeof value === "string" && (LOOP_CLIP_SLOTS as readonly string[]).includes(value);
}

/** How a slot plays its clip. */
export interface LoopClipRule {
  /** The longest the clip plays (s); 0 = as long as the event asks (the reset's auto-fit, a loop). */
  maxSec: number;
  fadeIn: number;
  fadeOut: number;
  /** Gain range and default, dB. */
  gainMinDb: number;
  gainMaxDb: number;
  gainDefaultDb: number;
  /** "off": never pitched; "optional": the owner may switch pitch-follow on; "default": on unless switched off. */
  pitch: "off" | "optional" | "default";
  /** Loops for as long as the bed / drone plays, crossfading over `fadeIn`. */
  loop: boolean;
  /** Trims itself to the event's duration (the reset's auto-fit; no time-stretch). */
  fit: boolean;
  /** Has a pre-roll offset field: the clip starts this early, so its transient lands on the event's frame. */
  preRoll: boolean;
}

export const LOOP_CLIP_RULES: Readonly<Record<LoopClipSlotId, LoopClipRule>> = {
  bounce: { maxSec: 1.5, fadeIn: 0.005, fadeOut: 0.02, gainMinDb: -24, gainMaxDb: 6, gainDefaultDb: -6, pitch: "optional", loop: false, fit: false, preRoll: false },
  barStrike: { maxSec: 2, fadeIn: 0.005, fadeOut: 0.005, gainMinDb: -24, gainMaxDb: 6, gainDefaultDb: -6, pitch: "default", loop: false, fit: false, preRoll: false },
  chime: { maxSec: 2, fadeIn: 0.005, fadeOut: 0.005, gainMinDb: -24, gainMaxDb: 6, gainDefaultDb: -6, pitch: "default", loop: false, fit: false, preRoll: false },
  progressStep: { maxSec: 1, fadeIn: 0.005, fadeOut: 0.02, gainMinDb: -24, gainMaxDb: 6, gainDefaultDb: -6, pitch: "optional", loop: false, fit: false, preRoll: false },
  land: { maxSec: 1, fadeIn: 0.005, fadeOut: 0.02, gainMinDb: -24, gainMaxDb: 6, gainDefaultDb: -6, pitch: "optional", loop: false, fit: false, preRoll: false },
  bed: { maxSec: 0, fadeIn: 0.05, fadeOut: 0.05, gainMinDb: -30, gainMaxDb: 0, gainDefaultDb: -12, pitch: "off", loop: true, fit: false, preRoll: false },
  impact: { maxSec: 3, fadeIn: 0.005, fadeOut: 0.02, gainMinDb: -24, gainMaxDb: 6, gainDefaultDb: -6, pitch: "off", loop: false, fit: false, preRoll: false },
  completion: { maxSec: 3, fadeIn: 0.005, fadeOut: 0.02, gainMinDb: -24, gainMaxDb: 6, gainDefaultDb: -6, pitch: "off", loop: false, fit: false, preRoll: true },
  reset: { maxSec: 0, fadeIn: 0.03, fadeOut: 0.03, gainMinDb: -30, gainMaxDb: 0, gainDefaultDb: -12, pitch: "off", loop: false, fit: true, preRoll: false },
  drone: { maxSec: 0, fadeIn: 0.1, fadeOut: 0.1, gainMinDb: -30, gainMaxDb: 0, gainDefaultDb: -12, pitch: "off", loop: true, fit: false, preRoll: false },
};

/** What the owner sets per slot. */
export interface LoopClipOptions {
  /** Gain in dB (clamped to the slot's range). */
  gainDb: number;
  /** Seconds trimmed off the clip's start, and the clip's end (s from its start; 0 = its end). */
  trimStart: number;
  trimEnd: number;
  /** Follow the event's pitch with the playback rate (the slots that allow it). */
  pitchFollow: boolean;
  /** Seconds the clip starts before the event (the completion's pre-roll, so its transient hits the frame). */
  preRoll: number;
}

export function defaultClipOptions(slot: LoopClipSlotId): LoopClipOptions {
  const rule = LOOP_CLIP_RULES[slot];
  return { gainDb: rule.gainDefaultDb, trimStart: 0, trimEnd: 0, pitchFollow: rule.pitch === "default", preRoll: 0 };
}

const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Validated options of `slot`: the gain in its range, trims from 0, pitch-follow only where the slot allows it. */
export function resolveClipOptions(slot: LoopClipSlotId, source: Partial<Record<keyof LoopClipOptions, unknown>> | null | undefined): LoopClipOptions {
  const rule = LOOP_CLIP_RULES[slot];
  const d = defaultClipOptions(slot);
  const s = source ?? {};
  const gainDb = Math.max(rule.gainMinDb, Math.min(rule.gainMaxDb, finite(s.gainDb, d.gainDb)));
  const trimStart = Math.max(0, finite(s.trimStart, 0));
  const trimEnd = Math.max(0, finite(s.trimEnd, 0));
  const pitchFollow = rule.pitch === "off" ? false : typeof s.pitchFollow === "boolean" ? s.pitchFollow : d.pitchFollow;
  const preRoll = rule.preRoll ? Math.max(0, finite(s.preRoll, 0)) : 0;
  return { gainDb, trimStart, trimEnd, pitchFollow, preRoll };
}

/** The part of a `bufferSec` clip a slot plays: from `offset` for `duration` seconds, with its fades; `startShift` = the pre-roll. */
export interface ClipWindow {
  offset: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  /** Seconds before the event the clip starts (the pre-roll). */
  startShift: number;
}

/**
 * The window of a clip a slot plays: the trimmed region (start / end offsets), at most the slot's longest (a one-shot), cut to
 * `eventSec` for a slot that fits itself to its event (the reset) and the whole region for a loop; the fades never overlap.
 * Null when nothing is left to play.
 */
export function clipWindow(slot: LoopClipSlotId, bufferSec: number, options: LoopClipOptions, eventSec?: number, rate = 1): ClipWindow | null {
  const rule = LOOP_CLIP_RULES[slot];
  if (!(bufferSec > 0)) return null;
  const start = Math.min(bufferSec, Math.max(0, options.trimStart));
  const end = options.trimEnd > start ? Math.min(bufferSec, options.trimEnd) : bufferSec;
  let duration = (end - start) / Math.max(1e-3, rate);
  if (rule.maxSec > 0) duration = Math.min(duration, rule.maxSec);
  if (rule.fit && eventSec !== undefined && eventSec > 0) duration = Math.min(duration, eventSec);
  if (!(duration > 0.002)) return null;
  const fadeIn = Math.min(rule.fadeIn, duration / 2);
  const fadeOut = Math.min(rule.fadeOut, duration / 2);
  return { offset: start, duration, fadeIn, fadeOut, startShift: rule.preRoll ? options.preRoll : 0 };
}

/** The playback rate that moves a clip from `refHz` to `frequency` (pitch-follow), 1 without it; clamped to 1/8 … 8. */
export function clipPlaybackRate(frequency: number | undefined, refHz: number, pitchFollow: boolean): number {
  if (!pitchFollow || !(frequency !== undefined && frequency > 0) || !(refHz > 0)) return 1;
  return Math.max(0.125, Math.min(8, frequency / refHz));
}

/** A loaded clip of a slot. */
export interface LoopClip {
  buffer: AudioBuffer;
  name: string;
  options: LoopClipOptions;
}

/** The reference pitch a pitch-following clip is taken to be at (the pitch the event's degree rule centres on). */
export const CLIP_REFERENCE_HZ: Readonly<Record<LoopClipSlotId, number>> = {
  bounce: 440,
  barStrike: 523.25,
  chime: 1318.5,
  progressStep: 1760,
  land: 110,
  bed: 1,
  impact: 1,
  completion: 1,
  reset: 1,
  drone: 1,
};

/**
 * The slots of one ToneGenerator (and copied into its offline twin): the decoded clips by slot, and `play()`, which starts a
 * slot's clip at an event (its window, fades, gain and pitch) and says whether it did – the synthesis plays otherwise.
 */
export class LoopClipSlots {
  private readonly clips = new Map<LoopClipSlotId, LoopClip>();
  private readonly loops = new Map<LoopClipSlotId, { source: AudioBufferSourceNode; gain: GainNode }>();

  has(slot: LoopClipSlotId): boolean {
    return this.clips.has(slot);
  }

  get(slot: LoopClipSlotId): LoopClip | null {
    return this.clips.get(slot) ?? null;
  }

  set(slot: LoopClipSlotId, buffer: AudioBuffer, name: string, options?: Partial<LoopClipOptions>) {
    this.clips.set(slot, { buffer, name, options: resolveClipOptions(slot, { ...defaultClipOptions(slot), ...(options ?? {}) }) });
  }

  setOptions(slot: LoopClipSlotId, patch: Partial<LoopClipOptions>) {
    const clip = this.clips.get(slot);
    if (clip) clip.options = resolveClipOptions(slot, { ...clip.options, ...patch });
  }

  clear(slot: LoopClipSlotId) {
    this.clips.delete(slot);
  }

  /** The slots with a clip, for the offline twin and the panel. */
  entries(): [LoopClipSlotId, LoopClip][] {
    return [...this.clips.entries()];
  }

  /**
   * Plays `slot`'s clip at `time` into `out`: its window (`clipWindow()`), 5–30 ms fades, the gain (dB) × `level`, and – where
   * the slot follows pitch and the owner left it on – the playback rate that moves it to `frequency`. False without a clip.
   */
  play(ctx: BaseAudioContext, out: AudioNode, slot: LoopClipSlotId, time: number, opts: { frequency?: number; level?: number; durationSec?: number } = {}): boolean {
    const clip = this.clips.get(slot);
    if (!clip) return false;
    const rule = LOOP_CLIP_RULES[slot];
    const rate = rule.pitch === "off" ? 1 : clipPlaybackRate(opts.frequency, CLIP_REFERENCE_HZ[slot], clip.options.pitchFollow);
    const win = clipWindow(slot, clip.buffer.duration, clip.options, opts.durationSec, rate);
    if (!win) return false;
    const level = Math.pow(10, clip.options.gainDb / 20) * (typeof opts.level === "number" && Number.isFinite(opts.level) ? Math.max(0, opts.level) : 1);
    const at = Math.max(0, time - win.startShift);
    const source = ctx.createBufferSource();
    source.buffer = clip.buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + win.fadeIn);
    if (rule.loop) {
      source.loop = true;
      source.loopStart = win.offset;
      source.loopEnd = win.offset + win.duration * rate;
      source.start(at, win.offset);
      this.stopLoop(slot, at);
      this.loops.set(slot, { source, gain });
    } else {
      gain.gain.setValueAtTime(level, at + win.duration - win.fadeOut);
      gain.gain.linearRampToValueAtTime(0, at + win.duration);
      source.start(at, win.offset, win.duration * rate);
      source.stop(at + win.duration + 0.01);
    }
    source.connect(gain);
    gain.connect(out);
    return true;
  }

  /** Fades out and stops a looping slot (the bed, the drone) at `time`. */
  stopLoop(slot: LoopClipSlotId, time: number) {
    const live = this.loops.get(slot);
    if (!live) return;
    this.loops.delete(slot);
    const fade = LOOP_CLIP_RULES[slot].fadeOut;
    try {
      live.gain.gain.cancelScheduledValues(time);
      live.gain.gain.setTargetAtTime(0, time, fade / 3);
      live.source.stop(time + fade + 0.05);
    } catch {
      /* already stopped */
    }
  }

  /** Scales a looping slot's level (the drone's energy, a duck of the bed) from `time`. */
  setLoopLevel(slot: LoopClipSlotId, factor: number, time: number) {
    const live = this.loops.get(slot);
    const clip = this.clips.get(slot);
    if (!live || !clip) return;
    live.gain.gain.setTargetAtTime(Math.pow(10, clip.options.gainDb / 20) * Math.max(0, factor), time, 0.05);
  }

  /** A copy for another context (the offline twin): the same decoded clips and options, nothing playing. */
  copy(): LoopClipSlots {
    const twin = new LoopClipSlots();
    for (const [slot, clip] of this.clips) twin.clips.set(slot, { buffer: clip.buffer, name: clip.name, options: { ...clip.options } });
    return twin;
  }
}
