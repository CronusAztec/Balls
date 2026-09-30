import type { InstrumentId } from "./instruments";

/**
 * The "pew" of the Sound Vortex (lib/physics/modes/vortex.ts): a ball swallowed by the hole plays a fast downward pitch
 * sweep – the retro laser "pew" of the geraldbounces clips. A main oscillator glides exponentially from the start pitch
 * down `drop` times lower (three octaves at the default 8) over `duration`, with a sub-oscillator an octave below it and
 * a click of an attack, then dies away. The ToneGenerator schedules it (`playPew()`) at the time it hands over – on the
 * beat grid when the beat lock is on – snaps the start pitch to the current scale through `snap` and picks the waveform
 * from the bounce instrument (`pewWaveform()`), so a chip-tune run pews in square waves; a chosen wall-break clip plays
 * instead when there is one (samples are optional). The recipe is data and the scheduling a pure function of the audio
 * graph, testable with a fake AudioContext.
 */
export interface PewTone {
  /** Seconds the sweep takes (the tail rings a little longer). */
  duration: number;
  /** Peak gain of the main oscillator. */
  gain: number;
  /** The sweep ends this many times lower than it starts. */
  drop: number;
  /** Seconds of the attack. */
  attack: number;
  /** Frequency ratio and peak gain of the sub-oscillator. */
  subRatio: number;
  subGain: number;
}

export const PEW_TONE: PewTone = { duration: 0.26, gain: 0.2, drop: 8, attack: 0.004, subRatio: 0.5, subGain: 0.1 };

/** Start pitch of a pew without one (E6). */
export const DEFAULT_PEW_FREQUENCY = 1318.5;

/** The oscillator shape of the pew for a bounce instrument: the plain waveforms keep theirs, the modelled voices glide as a triangle. */
export function pewWaveform(instrument: InstrumentId | string | undefined): OscillatorType {
  switch (instrument) {
    case "sine":
      return "sine";
    case "square":
    case "chip":
      return "square";
    case "saw":
      return "sawtooth";
    default:
      return "triangle";
  }
}

/** The sweep of a pew from `frequency` (Hz): where it starts and ends and how long it takes. */
export function pewSweep(frequency: number, tone: PewTone = PEW_TONE): { start: number; end: number; duration: number } {
  const start = frequency > 0 && Number.isFinite(frequency) ? frequency : DEFAULT_PEW_FREQUENCY;
  return { start, end: start / Math.max(1.01, tone.drop), duration: tone.duration };
}

/** Builds and starts the pew at `time` (AudioContext seconds) into `destination`. */
export function schedulePewTone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  frequency: number,
  time: number,
  snap: (frequency: number) => number = (f) => f,
  type: OscillatorType = "triangle",
  tone: PewTone = PEW_TONE,
) {
  const sweep = pewSweep(snap(frequency > 0 ? frequency : DEFAULT_PEW_FREQUENCY), tone);
  const end = time + sweep.duration;
  const main = ctx.createOscillator();
  const mainGain = ctx.createGain();
  main.type = type;
  main.frequency.value = sweep.start;
  main.frequency.setValueAtTime(sweep.start, time);
  main.frequency.exponentialRampToValueAtTime(sweep.end, end);
  mainGain.gain.setValueAtTime(0, time);
  mainGain.gain.linearRampToValueAtTime(tone.gain, time + tone.attack);
  mainGain.gain.exponentialRampToValueAtTime(0.001, end + 0.04);
  main.connect(mainGain);
  mainGain.connect(destination);
  main.start(time);
  main.stop(end + 0.06);

  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = "sine";
  sub.frequency.value = sweep.start * tone.subRatio;
  sub.frequency.setValueAtTime(sweep.start * tone.subRatio, time);
  sub.frequency.exponentialRampToValueAtTime(sweep.end * tone.subRatio, end);
  subGain.gain.setValueAtTime(0, time);
  subGain.gain.linearRampToValueAtTime(tone.subGain, time + tone.attack);
  subGain.gain.exponentialRampToValueAtTime(0.001, end);
  sub.connect(subGain);
  subGain.connect(destination);
  sub.start(time);
  sub.stop(end + 0.02);
}
