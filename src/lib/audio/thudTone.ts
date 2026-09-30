/**
 * The landing thud of Bullseye (lib/physics/modes/bullseye.ts, feature boris-bullseye): a ball that lands on the target
 * sticks with a short, pitched "thock" – the ring decides the pitch (the bull thuds highest), so a run's landings play a
 * little bass line under the peg notes. A sine body drops quickly from `bend` × the pitch onto it and dies away, and a
 * short triangle "knock" an octave and a fifth above gives it the attack of a dart hitting a board. The ToneGenerator
 * schedules it (`playThud()`) at the time it hands over – on the beat grid when the beat lock is on, without taking a
 * bounce's slot – snaps the pitch to the current scale through `snap`, and plays the hit sample at the thud's pitch
 * instead in sample mode. The recipe is data and the scheduling a pure function of the audio graph, testable with a fake
 * AudioContext.
 */
export interface ThudTone {
  /** Seconds the body rings. */
  duration: number;
  /** Peak gain of the body at level 1. */
  gain: number;
  /** The body starts this many times above the pitch and drops onto it over `bendTime` seconds. */
  bend: number;
  bendTime: number;
  /** Seconds of the attack. */
  attack: number;
  /** Frequency ratio, peak gain (at level 1) and length (s) of the knock. */
  knockRatio: number;
  knockGain: number;
  knockTime: number;
}

export const THUD_TONE: ThudTone = { duration: 0.32, gain: 0.42, bend: 2.2, bendTime: 0.06, attack: 0.003, knockRatio: 3, knockGain: 0.12, knockTime: 0.05 };

/** Pitch of a thud without one (C3). */
export const DEFAULT_THUD_FREQUENCY = 130.81;

/** The loudness of a thud of `level` (0–1; 1 when absent or invalid). */
export function thudLevel(level: number | undefined): number {
  return level === undefined || !Number.isFinite(level) ? 1 : Math.max(0, Math.min(1, level));
}

/** Where the thud's body starts and ends (Hz) and how long its drop takes. */
export function thudBend(frequency: number, tone: ThudTone = THUD_TONE): { start: number; end: number; time: number } {
  const end = frequency > 0 && Number.isFinite(frequency) ? frequency : DEFAULT_THUD_FREQUENCY;
  return { start: end * Math.max(1, tone.bend), end, time: tone.bendTime };
}

/** Builds and starts the thud at `time` (AudioContext seconds) into `destination`. */
export function scheduleThudTone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  frequency: number,
  time: number,
  snap: (frequency: number) => number = (f) => f,
  level = 1,
  tone: ThudTone = THUD_TONE,
) {
  const bend = thudBend(snap(frequency > 0 && Number.isFinite(frequency) ? frequency : DEFAULT_THUD_FREQUENCY), tone);
  const loud = thudLevel(level);
  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  body.type = "sine";
  body.frequency.value = bend.start;
  body.frequency.setValueAtTime(bend.start, time);
  body.frequency.exponentialRampToValueAtTime(bend.end, time + bend.time);
  bodyGain.gain.setValueAtTime(0, time);
  bodyGain.gain.linearRampToValueAtTime(Math.max(0.0015, tone.gain * loud), time + tone.attack);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, time + tone.duration);
  body.connect(bodyGain);
  bodyGain.connect(destination);
  body.start(time);
  body.stop(time + tone.duration + 0.02);

  const knock = ctx.createOscillator();
  const knockGain = ctx.createGain();
  knock.type = "triangle";
  knock.frequency.value = bend.end * tone.knockRatio;
  knockGain.gain.setValueAtTime(0, time);
  knockGain.gain.linearRampToValueAtTime(Math.max(0.0015, tone.knockGain * loud), time + tone.attack);
  knockGain.gain.exponentialRampToValueAtTime(0.001, time + tone.knockTime);
  knock.connect(knockGain);
  knockGain.connect(destination);
  knock.start(time);
  knock.stop(time + tone.knockTime + 0.02);
}
