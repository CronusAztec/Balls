import type { Expression } from "@/lib/character/expression";

/**
 * The voice of the cat face (lib/character): a short, synthesised meow-like chirp when the ball says "ouch", is
 * startled by a breaking wall or grins at its escape. One sawtooth oscillator through a band-pass "formant" whose
 * centre glides like the vowel of a meow ("mee-ow"), under a quick envelope – no samples, nothing to download.
 *
 * The ToneGenerator schedules it like every other sound (`playCharacterChirp()`): on the beat grid when the beat
 * lock is on, its pitch snapped to the current scale (the contour keeps its shape), into the master gain (so the
 * recording has it) and ducking the music bed. The recipes are data and `scheduleChirp()` a function of the audio
 * graph, so both are tested through a fake AudioContext.
 */
export interface ChirpRecipe {
  /** Seconds. */
  duration: number;
  /** Peak gain. */
  gain: number;
  /** Pitch (Hz) at the start, at `peakAt` and at the end. */
  pitch: readonly [number, number, number];
  /** Centre (Hz) of the band-pass formant at the same three points. */
  formant: readonly [number, number, number];
  /** Where the contour turns, as a fraction of the duration. */
  peakAt: number;
  /** Q of the formant filter. */
  q: number;
}

export const CHIRPS = {
  /** "Mew!" – short and falling, for a hard hit. */
  ouch: { duration: 0.16, gain: 0.16, pitch: [880, 820, 600], formant: [1500, 1300, 900], peakAt: 0.25, q: 4 },
  /** "Mrrp?" – rising, for a breaking wall. */
  shock: { duration: 0.22, gain: 0.15, pitch: [470, 560, 840], formant: [800, 1000, 1700], peakAt: 0.4, q: 5 },
  /** "Meow~" – up and down, for an escape or the finish. */
  grin: { duration: 0.42, gain: 0.18, pitch: [560, 880, 520], formant: [700, 1800, 850], peakAt: 0.35, q: 4.5 },
} as const satisfies Record<string, ChirpRecipe>;

export type ChirpKind = keyof typeof CHIRPS;

/**
 * Two chirps are at least this far apart (simulation ms): the cat comments now and then, it does not meow over every
 * bounce note, and a pile of balls meows, it does not scream.
 */
export const CHIRP_MIN_GAP_MS = 1000;

/** The chirp an expression event plays (none for the calm expressions). */
export function chirpForExpression(expression: Expression | null): ChirpKind | null {
  return expression === "ouch" || expression === "shock" || expression === "grin" ? expression : null;
}

/** Whether a chirp may play at `nowMs` after the last one at `lastMs` (−Infinity when none played yet). */
export function chirpAllowed(lastMs: number, nowMs: number): boolean {
  return nowMs - lastMs >= CHIRP_MIN_GAP_MS || nowMs < lastMs;
}

/** Builds and starts the chirp at `time` (AudioContext seconds) into `destination`; `snap` places its pitch on the scale. */
export function scheduleChirp(
  ctx: BaseAudioContext,
  destination: AudioNode,
  recipe: ChirpRecipe,
  time: number,
  snap: (frequency: number) => number = (f) => f,
) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  // The whole contour moves with the snapped peak, so the meow keeps its shape on any scale.
  const ratio = snap(recipe.pitch[1]) / recipe.pitch[1];
  const peak = time + recipe.peakAt * recipe.duration;
  const end = time + recipe.duration;
  osc.type = "sawtooth";
  osc.frequency.value = recipe.pitch[0] * ratio;
  osc.frequency.setValueAtTime(recipe.pitch[0] * ratio, time);
  osc.frequency.exponentialRampToValueAtTime(recipe.pitch[1] * ratio, peak);
  osc.frequency.exponentialRampToValueAtTime(recipe.pitch[2] * ratio, end);
  filter.type = "bandpass";
  filter.Q.value = recipe.q;
  filter.frequency.setValueAtTime(recipe.formant[0], time);
  filter.frequency.linearRampToValueAtTime(recipe.formant[1], peak);
  filter.frequency.linearRampToValueAtTime(recipe.formant[2], end);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(recipe.gain, time + 0.015);
  gain.gain.setValueAtTime(recipe.gain, Math.max(time + 0.015, end - 0.06));
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(end + 0.02);
}
