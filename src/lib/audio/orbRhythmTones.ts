/**
 * --- orb-rhythm --- Bouncing Orbs' metronome click and its IN PHASE chord (feature orb-rhythm; the mode is
 * lib/physics/modes/orbGrid.ts, its rhythm model lib/physics/modes/orbRhythm.ts). The click is a woodblock-like tick – a
 * short sine "tok" with a quickly falling pitch and a brighter, shorter partial on top – an accented one (the downbeat) a
 * fifth-and-a-bit higher and louder. It is the beat itself, so it is never put on the beat lock's grid (the lock would delay
 * a click that arrives a millisecond late by a whole grid step), never a melody note, a hit sample or a song slice, and it
 * does not duck the music bed. The page plays it through `ToneGenerator.playOrb("click", …)` – the page's sound loop, the
 * fast export's `playSoundEvent()` and the split-screen arenas' `playArenaSound()` all route `SoundEvent.orb` there.
 */

/** The click's pitch (Hz) on an ordinary beat and on the downbeat (the accent). */
export const CLICK_HZ = 1250;
export const CLICK_ACCENT_HZ = 1900;
/** The click's length (s): the "tok" and its bright partial. */
export const CLICK_DECAY_SEC = 0.05;
export const CLICK_PARTIAL_DECAY_SEC = 0.018;
/** The bright partial's ratio to the pitch and its level. */
export const CLICK_PARTIAL_RATIO = 2.63;
export const CLICK_PARTIAL_GAIN = 0.45;
/** The click's level on an ordinary beat (× the volume); the downbeat plays at the full volume. */
export const CLICK_BEAT_LEVEL = 0.7;
/** The peak gain of a click at full volume (the master bus' limiter keeps a loud one in check). */
export const CLICK_PEAK = 0.32;

/** The click's frequency for a beat: the accent on the downbeat (`beat` 0 of the bar). */
export function clickFrequency(beatInBar: number): number {
  return beatInBar === 0 ? CLICK_ACCENT_HZ : CLICK_HZ;
}

/** The click's level (0–1) for a beat at `volume` (the Click setting, 0 = silent; louder values are the limiter's business). */
export function clickLevel(beatInBar: number, volume: number): number {
  const v = Number.isFinite(volume) && volume > 0 ? volume : 0;
  return (beatInBar === 0 ? 1 : CLICK_BEAT_LEVEL) * v;
}

/**
 * Schedules one woodblock click at `time` into `destination`: a sine at `frequency` falling a fifth of an octave in 20 ms with
 * an exponential decay, and its bright partial decaying three times faster. `level` 0–1 (more is allowed; the bus limits it).
 */
export function scheduleOrbClick(ctx: BaseAudioContext, destination: AudioNode, time: number, frequency: number, level: number) {
  const peak = CLICK_PEAK * Math.max(0, level);
  if (!(peak > 0) || !(frequency > 0)) return;
  const tok = ctx.createOscillator();
  tok.type = "sine";
  tok.frequency.value = frequency; // (its pitch before the automation starts – what an inspector of the node reads)
  tok.frequency.setValueAtTime(frequency, time);
  tok.frequency.exponentialRampToValueAtTime(frequency * 0.8, time + 0.02);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_DECAY_SEC);
  tok.connect(g);
  g.connect(destination);
  tok.start(time);
  tok.stop(time + CLICK_DECAY_SEC + 0.02);
  const bright = ctx.createOscillator();
  bright.type = "triangle";
  bright.frequency.value = frequency * CLICK_PARTIAL_RATIO;
  bright.frequency.setValueAtTime(frequency * CLICK_PARTIAL_RATIO, time);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0, time);
  bg.gain.linearRampToValueAtTime(peak * CLICK_PARTIAL_GAIN, time + 0.001);
  bg.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_PARTIAL_DECAY_SEC);
  bright.connect(bg);
  bg.connect(destination);
  bright.start(time);
  bright.stop(time + CLICK_PARTIAL_DECAY_SEC + 0.02);
}

/**
 * The IN PHASE chord's degrees of the scale – every orb landing at once: the root, the third and fifth degrees (a major triad
 * in a major scale, C E A over the chromatic default's pentatonic) and the root an octave up (`octave` = the scale's length).
 */
export function inPhaseDegrees(octave: number): number[] {
  return [0, 2, 4, Math.max(5, Math.round(octave))];
}
